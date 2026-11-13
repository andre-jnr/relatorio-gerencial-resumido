// Aba Usuários (só superusuário): cadastrar, editar, trocar senha e excluir.
(() => {
  'use strict';

  const { el, escapar, api, linha } = Comum;
  const $ = (s) => document.querySelector(s);

  let lista = [];
  let eu = null;          // id de quem está logado
  let editando = null;    // usuário sendo editado no formulário
  let loginTocado = false; // depois que o login é digitado à mão, para de sugerir pelo nome

  // ---------- Utilidades ----------
  let tempoAviso;
  function avisar(texto, tipo = 'ok') {
    let t = $('#aviso-rapido');
    if (!t) {
      t = document.createElement('div');
      t.id = 'aviso-rapido';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = texto;
    t.className = `aviso-rapido aviso-rapido--${tipo} aviso-rapido--visivel`;
    clearTimeout(tempoAviso);
    tempoAviso = setTimeout(() => t.classList.remove('aviso-rapido--visivel'), 2600);
  }

  // "André Luiz" -> "andre.luiz"
  const sugerirLogin = (nome) => Comum.normalizar(nome).toLowerCase().trim()
    .replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');

  const iniciais = (nome) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  function gerarSenha() {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    return String(n[0] % 1000000).padStart(6, '0');
  }

  function quando(iso) {
    if (!iso) return '<span class="u-muted">nunca entrou</span>';
    const d = new Date(iso);
    const dias = Math.floor((Date.now() - d) / 86400000);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (dias < 1 && new Date().getDate() === d.getDate()) return `hoje às ${hora}`;
    if (dias < 2) return `ontem às ${hora}`;
    return d.toLocaleDateString('pt-BR');
  }

  // ---------- Formulário ----------
  function formHtml() {
    return `
      <form id="u-form" class="painel u-form" novalidate autocomplete="off">
        <div class="u-form__cab">
          <h3 id="u-form-titulo">Novo usuário</h3>
          <p id="u-form-sub">Preencha os dados e entregue o login e a senha para a pessoa.</p>
        </div>
        <div class="u-form__campos">
          <label class="campo">
            <span class="campo__rotulo">Nome exibido no painel</span>
            <input name="nome" maxlength="60" placeholder="Ex.: Lincoln Souza" required>
          </label>
          <label class="campo">
            <span class="campo__rotulo">Login</span>
            <input name="login" maxlength="30" placeholder="Ex.: lincoln" autocapitalize="none" spellcheck="false" required>
            <small class="u-dica">Sem espaços e sem acentos. É o que a pessoa digita para entrar.</small>
          </label>
          <label class="campo">
            <span class="campo__rotulo" id="u-rotulo-senha">Senha (6 dígitos)</span>
            <span class="u-senha">
              <input name="senha" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="new-password">
              <button type="button" class="btn-texto" id="u-gerar" title="Gerar uma senha aleatória de 6 dígitos">Gerar</button>
            </span>
            <small class="u-dica" id="u-dica-senha">Só números. Use "Gerar" para criar uma aleatória.</small>
          </label>
          <fieldset class="u-tipo">
            <legend class="campo__rotulo">Tipo de acesso</legend>
            <label class="u-opcao">
              <input type="radio" name="admin" value="0" checked>
              <span><b>Usuário</b><small>Vê os relatórios e lança provisões</small></span>
            </label>
            <label class="u-opcao">
              <input type="radio" name="admin" value="1">
              <span><b>Superusuário</b><small>Também cadastra e remove usuários</small></span>
            </label>
          </fieldset>
        </div>
        <div class="u-form__rodape">
          <p id="u-erro" class="form-erro" role="alert"></p>
          <button type="button" id="u-cancelar" class="btn-texto" hidden>Cancelar</button>
          <button type="submit" id="u-salvar" class="btn-primario">Cadastrar usuário</button>
        </div>
      </form>
      <div id="u-criado" class="u-criado" hidden></div>`;
  }

  function preencherForm(u) {
    const f = $('#u-form');
    editando = u;
    loginTocado = !!u;
    f.reset();
    f.nome.value = u ? u.nome : '';
    f.login.value = u ? u.login : '';
    f.senha.value = '';
    f.admin.value = u && u.admin ? '1' : '0';
    const proprio = u && u.id === eu;
    // não dá para tirar o próprio acesso de superusuário
    f.querySelectorAll('input[name="admin"]').forEach((r) => { r.disabled = proprio; });
    $('#u-form-titulo').textContent = u ? `Editar ${u.nome}` : 'Novo usuário';
    $('#u-form-sub').textContent = u
      ? (proprio ? 'Esta é a sua conta: você não pode tirar o seu acesso de superusuário.' : 'Altere o que precisar e salve.')
      : 'Preencha os dados e entregue o login e a senha para a pessoa.';
    $('#u-rotulo-senha').textContent = u ? 'Nova senha (opcional)' : 'Senha (6 dígitos)';
    $('#u-dica-senha').textContent = u ? 'Deixe em branco para manter a senha atual.' : 'Só números. Use "Gerar" para criar uma aleatória.';
    f.senha.placeholder = u ? 'manter a atual' : '000000';
    $('#u-salvar').textContent = u ? 'Salvar alterações' : 'Cadastrar usuário';
    $('#u-cancelar').hidden = !u;
    $('#u-erro').textContent = '';
    f.classList.toggle('u-form--editando', !!u);
    document.querySelectorAll('.u-linha--editando').forEach((tr) => tr.classList.remove('u-linha--editando'));
    if (u) {
      document.querySelector(`.u-linha[data-id="${u.id}"]`)?.classList.add('u-linha--editando');
      f.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    }
    f.nome.focus({ preventScroll: !!u });
  }

  function mostrarCriado(login, senha) {
    const caixa = $('#u-criado');
    caixa.hidden = false;
    caixa.innerHTML = `
      <div>
        <b>Usuário criado.</b> Entregue estes dados para a pessoa. A senha não aparece de novo depois que você sair desta tela.
        <dl>
          <div><dt>Login</dt><dd>${escapar(login)}</dd></div>
          <div><dt>Senha</dt><dd>${escapar(senha)}</dd></div>
        </dl>
      </div>
      <div class="u-criado__acoes">
        <button type="button" class="btn-texto" id="u-copiar">Copiar</button>
        <button type="button" class="btn-texto" id="u-fechar" aria-label="Fechar">Fechar</button>
      </div>`;
    $('#u-copiar').addEventListener('click', async () => {
      const texto = `Relatório gerencial - ${window.APP.loja}\nEndereço: ${location.origin}\nLogin: ${login}\nSenha: ${senha}`;
      try { await navigator.clipboard.writeText(texto); avisar('Dados copiados'); } catch (e) { avisar('Não consegui copiar. Anote os dados.', 'erro'); }
    });
    $('#u-fechar').addEventListener('click', () => { caixa.hidden = true; caixa.innerHTML = ''; });
  }

  async function salvar(e) {
    e.preventDefault();
    const f = e.target;
    const erro = $('#u-erro');
    const dados = { nome: f.nome.value.trim(), login: f.login.value.trim() };
    const senha = f.senha.value.trim();
    if (!editando || editando.id !== eu) dados.admin = f.admin.value === '1';

    if (!dados.nome) { erro.textContent = 'Informe o nome.'; f.nome.focus(); return; }
    if (!/^[A-Za-z0-9._-]{2,30}$/.test(dados.login)) {
      erro.textContent = 'O login precisa ter de 2 a 30 caracteres, sem espaços nem acentos.'; f.login.focus(); return;
    }
    if ((!editando || senha) && !/^\d{6}$/.test(senha)) {
      erro.textContent = 'A senha precisa ter exatamente 6 números.'; f.senha.focus(); return;
    }
    if (senha) dados.senha = senha;

    const botao = $('#u-salvar');
    botao.disabled = true;
    try {
      if (editando) {
        await api(`/api/usuarios/${editando.id}`, { method: 'PATCH', body: dados });
        avisar(senha ? 'Usuário e senha atualizados' : 'Usuário atualizado');
        if (editando.id === eu) setTimeout(() => location.reload(), 600); // nome do topo
      } else {
        await api('/api/usuarios', { method: 'POST', body: dados });
        mostrarCriado(dados.login, senha);
        avisar('Usuário cadastrado');
      }
      preencherForm(null);
      await recarregar();
    } catch (err) {
      erro.textContent = err.message;
    } finally {
      botao.disabled = false;
    }
  }

  // ---------- Lista ----------
  function listaHtml() {
    const linhas = lista.map((u) => {
      const proprio = u.id === eu;
      return `
        <tr class="u-linha${editando?.id === u.id ? ' u-linha--editando' : ''}" data-id="${u.id}">
          <td>
            <span class="u-pessoa">
              <span class="u-avatar${u.admin ? ' u-avatar--admin' : ''}" aria-hidden="true">${escapar(iniciais(u.nome))}</span>
              <span>
                <span class="u-nome">${escapar(u.nome)}${proprio ? ' <span class="selo u-voce">você</span>' : ''}</span>
                <span class="u-login">${escapar(u.login)}</span>
              </span>
            </span>
          </td>
          <td>${u.admin ? '<span class="selo u-selo-admin">Superusuário</span>' : '<span class="selo u-selo">Usuário</span>'}</td>
          <td class="u-quando">${quando(u.ultimo_login)}</td>
          <td class="u-quando">${new Date(u.criado_em).toLocaleDateString('pt-BR')}</td>
          <td class="u-acoes">
            <button type="button" class="btn-texto" data-acao="editar">Editar</button>
            <button type="button" class="btn-texto u-excluir" data-acao="excluir"
              ${proprio ? 'disabled title="Você não pode excluir a sua própria conta"' : ''}>Excluir</button>
          </td>
        </tr>`;
    }).join('');
    return `
      <div class="tabela-rolagem">
        <table class="u-tabela">
          <thead><tr>
            <th scope="col">Pessoa</th><th scope="col">Acesso</th><th scope="col">Último acesso</th>
            <th scope="col">Criado em</th><th scope="col"><span class="sr">Ações</span></th>
          </tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }

  async function recarregar() {
    const r = await api('/api/usuarios');
    lista = r.usuarios;
    eu = r.eu;
    $('#u-lista').innerHTML = listaHtml();
    $('#u-contagem').textContent = `${lista.length} ${lista.length === 1 ? 'pessoa' : 'pessoas'} · ${lista.filter((u) => u.admin).length} superusuário(s)`;
  }

  const confirmando = new Map(); // id -> timeout do "Confirmar exclusão?"

  async function acaoLista(e) {
    const alvo = e.target.closest('[data-acao]');
    if (!alvo || alvo.disabled) return;
    const id = Number(alvo.closest('[data-id]').dataset.id);
    const u = lista.find((x) => x.id === id);
    if (!u) return;

    if (alvo.dataset.acao === 'editar') return preencherForm(u);

    // excluir: primeiro clique pede confirmação, o segundo exclui
    if (!confirmando.has(id)) {
      alvo.textContent = 'Confirmar exclusão?';
      alvo.classList.add('u-excluir--confirmar');
      confirmando.set(id, setTimeout(() => {
        alvo.textContent = 'Excluir';
        alvo.classList.remove('u-excluir--confirmar');
        confirmando.delete(id);
      }, 3500));
      return;
    }
    clearTimeout(confirmando.get(id));
    confirmando.delete(id);
    try {
      await api(`/api/usuarios/${id}`, { method: 'DELETE' });
      if (editando?.id === id) preencherForm(null);
      avisar(`${u.nome} foi excluído`);
      await recarregar();
    } catch (err) {
      avisar(err.message, 'erro');
      await recarregar();
    }
  }

  // ---------- Página ----------
  async function iniciar() {
    el.conteudo.innerHTML = `
      <section class="secao">
        <div class="secao__cab">
          <span class="secao__num">01</span>
          <h2 class="secao__titulo">Cadastrar usuário</h2>
          <p class="secao__desc">Cada pessoa entra com o próprio login e vê o nome dela no topo do painel</p>
        </div>
        ${formHtml()}
      </section>
      <section class="secao">
        <div class="secao__cab">
          <span class="secao__num">02</span>
          <h2 class="secao__titulo">Usuários cadastrados</h2>
          <p class="secao__desc" id="u-contagem"></p>
        </div>
        <div class="painel" id="u-lista"><div style="padding:20px">${linha('100%', 40)}${linha('100%', 40, 'margin-top:12px')}</div></div>
      </section>`;

    const f = $('#u-form');
    f.addEventListener('submit', salvar);
    f.nome.addEventListener('input', () => { if (!loginTocado) f.login.value = sugerirLogin(f.nome.value); });
    f.login.addEventListener('input', () => { loginTocado = f.login.value !== ''; f.login.value = f.login.value.replace(/\s/g, ''); });
    f.senha.addEventListener('input', () => { f.senha.value = f.senha.value.replace(/\D/g, '').slice(0, 6); });
    $('#u-gerar').addEventListener('click', () => { f.senha.value = gerarSenha(); f.senha.focus(); });
    $('#u-cancelar').addEventListener('click', () => preencherForm(null));
    $('#u-lista').addEventListener('click', acaoLista);

    try {
      await recarregar();
    } catch (err) {
      $('#u-lista').innerHTML = `<p class="u-falha">${escapar(err.message)}</p>`;
    }
  }

  iniciar();
})();
