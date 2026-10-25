// Aba Provisões: pagamentos previstos lançados à mão (adiantamento de salário,
// transferências do CD...). Pendentes entram na previsão de resultado; concluídas saem.
(() => {
  'use strict';

  const { MESES, el, moeda, centavos, decimal, ddmmaa, diaSemana, escapar, linha, api } = Comum;
  const $ = (s) => document.querySelector(s);

  let dados = null;    // última resposta de /api/provisoes
  let editando = null; // provisão sendo editada no formulário

  // ---------- Valores ----------
  // aceita "1.234,56", "1234,56", "1234.56" e "1.234"
  function lerValor(texto) {
    const t = String(texto).replace(/[R$\s]/g, '');
    if (!t) return NaN;
    if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
    return Number(t);
  }

  const limitesMes = (ano, mes) => {
    const ultimo = new Date(ano, mes, 0).getDate();
    const mm = String(mes).padStart(2, '0');
    return { min: `${ano}-${mm}-01`, max: `${ano}-${mm}-${String(ultimo).padStart(2, '0')}`, ultimo };
  };

  function dataPadrao(ano, mes) {
    const { min, max } = limitesMes(ano, mes);
    const hoje = dados?.hoje || new Date().toISOString().slice(0, 10);
    return hoje >= min && hoje <= max ? hoje : min;
  }

  // ---------- Avisos rápidos ----------
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

  // ---------- Resumo ----------
  function cardsHtml(d) {
    const t = d.totais;
    const card = (rotulo, valorHtml, sub, classes = '', i = 0) => `
      <article class="card ${classes}" style="--i:${i}">
        <div class="card__topo"><span class="card__rotulo">${rotulo}</span></div>
        <div class="card__valor">${valorHtml}</div>
        <div class="card__sub">${sub}</div>
      </article>`;
    const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
    return [
      card('Provisões pendentes', moeda(t.pendente),
        `${plural(t.qtde_pendente, 'provisão', 'provisões')} · <b>somam na previsão de resultado</b>`, 'card--destaque', 0),
      card('Concluídas', moeda(t.concluido),
        `${plural(t.qtde_concluida, 'provisão', 'provisões')} · já pagas, fora da previsão`, '', 1),
      card('Atrasadas', `${t.atrasadas}`,
        t.atrasadas ? 'Pendentes com data passada. Já foram pagas? Marque como concluídas.' : 'Nenhuma pendente com data passada',
        t.atrasadas ? 'card--neg card--alerta' : '', 2),
    ].join('');
  }

  // ---------- Lista ----------
  function listaHtml(d) {
    if (!d.itens.length) {
      const { ano, mes } = d.periodo;
      return `
        <div class="vazio-prov">
          <p><b>Nenhuma provisão em ${MESES[mes - 1].toLowerCase()} de ${ano}.</b></p>
          <p>Lance acima ou repita as provisões do mês anterior.</p>
          <button type="button" class="btn-texto" data-acao="copiar">Copiar do mês anterior</button>
        </div>`;
    }
    const linhas = d.itens.map((p) => {
      const atrasada = !p.concluida && p.data_prevista < d.hoje;
      const editandoEsta = editando?.id === p.id;
      return `
        <tr class="prov${p.concluida ? ' prov--concluida' : ''}${editandoEsta ? ' prov--editando' : ''}" data-id="${p.id}">
          <td class="prov__check">
            <label class="check" title="${p.concluida ? 'Desmarcar (volta para a previsão)' : 'Marcar como concluída (sai da previsão)'}">
              <input type="checkbox" data-acao="concluir" ${p.concluida ? 'checked' : ''} aria-label="Concluída: ${escapar(p.descricao)}">
              <span class="check__caixa"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg></span>
            </label>
          </td>
          <td class="prov__data">
            <span class="prov__dia">${ddmmaa(p.data_prevista)}</span>
            <small>${diaSemana(p.data_prevista)}</small>
          </td>
          <td class="prov__desc">
            <span class="prov__titulo">${escapar(p.descricao)}</span>
            ${atrasada ? '<span class="selo selo--atrasada">atrasada</span>' : ''}
            ${p.concluida ? '<span class="selo selo--fechado">concluída</span>' : ''}
            ${p.observacao ? `<span class="prov__obs">${escapar(p.observacao)}</span>` : ''}
          </td>
          <td class="prov__cat">${p.categoria ? `<span class="etiqueta">${escapar(p.categoria)}</span>` : '<span class="prov__vazio">—</span>'}</td>
          <td class="num prov__valor">${centavos(p.valor)}</td>
          <td class="prov__acoes">
            <button type="button" class="btn-icone btn-icone--peq" data-acao="editar" title="Editar" aria-label="Editar ${escapar(p.descricao)}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            </button>
            <button type="button" class="btn-icone btn-icone--peq btn-excluir" data-acao="excluir" title="Excluir" aria-label="Excluir ${escapar(p.descricao)}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
              <span class="btn-excluir__texto">Excluir?</span>
            </button>
          </td>
        </tr>`;
    }).join('');
    const t = d.totais;
    return `
      <div class="tabela-rolagem">
        <table class="prov-tabela">
          <thead><tr>
            <th scope="col"><span class="sr">Concluída</span></th><th scope="col">Data prevista</th><th scope="col">Descrição</th>
            <th scope="col">Categoria</th><th scope="col" class="num">Valor</th><th scope="col"><span class="sr">Ações</span></th>
          </tr></thead>
          <tbody>${linhas}</tbody>
          <tfoot><tr>
            <td></td><th scope="row" colspan="3">Pendente na previsão</th>
            <td class="num">${centavos(t.pendente)}</td><td></td>
          </tr></tfoot>
        </table>
      </div>`;
  }

  function desenharDados(d) {
    dados = d;
    $('#prov-cards').innerHTML = cardsHtml(d);
    $('#prov-lista').innerHTML = listaHtml(d);
    $('#categorias').innerHTML = d.categorias.map((c) => `<option value="${escapar(c)}"></option>`).join('');
    $('#btn-copiar').hidden = !d.itens.length;
  }

  async function recarregar() {
    const { ano, mes } = pagina.periodo();
    desenharDados(await api(`/api/provisoes?ano=${ano}&mes=${mes}`));
  }

  // ---------- Formulário ----------
  function formHtml(ano, mes) {
    const { min, max } = limitesMes(ano, mes);
    return `
      <form id="prov-form" class="painel prov-form" novalidate>
        <div class="prov-form__cab">
          <h3 id="form-titulo">Nova provisão</h3>
          <p>Pagamento previsto para ${MESES[mes - 1].toLowerCase()}. Enquanto pendente, soma nas contas previstas.</p>
        </div>
        <div class="prov-form__campos">
          <label class="campo campo--desc">
            <span class="campo__rotulo">Descrição</span>
            <input name="descricao" maxlength="120" required placeholder="Ex.: Adiantamento salarial do dia 20" autocomplete="off">
          </label>
          <label class="campo campo--cat">
            <span class="campo__rotulo">Categoria</span>
            <input name="categoria" maxlength="60" list="categorias" placeholder="Ex.: Folha de pagamento" autocomplete="off">
            <datalist id="categorias"></datalist>
          </label>
          <label class="campo campo--valor">
            <span class="campo__rotulo">Valor</span>
            <span class="entrada-moeda"><span>R$</span><input name="valor" inputmode="decimal" required placeholder="0,00" autocomplete="off"></span>
          </label>
          <label class="campo campo--data">
            <span class="campo__rotulo">Data prevista</span>
            <input name="data_prevista" type="date" required min="${min}" max="${max}" value="${dataPadrao(ano, mes)}">
          </label>
          <label class="campo campo--obs">
            <span class="campo__rotulo">Observação <em>(opcional)</em></span>
            <input name="observacao" maxlength="300" placeholder="Ex.: valor aproximado, conferir com o RH" autocomplete="off">
          </label>
        </div>
        <div class="prov-form__rodape">
          <p id="form-erro" class="form-erro" role="alert"></p>
          <button type="button" id="btn-cancelar" class="btn-texto" hidden>Cancelar</button>
          <button type="submit" id="btn-salvar" class="btn-primario">Adicionar provisão</button>
        </div>
      </form>`;
  }

  function preencherForm(p) {
    const f = $('#prov-form');
    editando = p;
    const { ano, mes } = pagina.periodo();
    f.descricao.value = p ? p.descricao : '';
    f.categoria.value = p ? p.categoria : '';
    f.valor.value = p ? decimal(p.valor) : '';
    f.data_prevista.value = p ? p.data_prevista : dataPadrao(ano, mes);
    f.observacao.value = p ? p.observacao : '';
    $('#form-titulo').textContent = p ? 'Editar provisão' : 'Nova provisão';
    $('#btn-salvar').textContent = p ? 'Salvar alterações' : 'Adicionar provisão';
    $('#btn-cancelar').hidden = !p;
    $('#form-erro').textContent = '';
    f.classList.toggle('prov-form--editando', !!p);
    document.querySelectorAll('.prov--editando').forEach((tr) => tr.classList.remove('prov--editando'));
    if (p) {
      document.querySelector(`.prov[data-id="${p.id}"]`)?.classList.add('prov--editando');
      f.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      f.descricao.focus({ preventScroll: true });
    }
  }

  async function salvar(e) {
    e.preventDefault();
    const f = e.target;
    const erro = $('#form-erro');
    const valor = lerValor(f.valor.value);
    const corpo = {
      descricao: f.descricao.value.trim(),
      categoria: f.categoria.value.trim(),
      valor,
      data_prevista: f.data_prevista.value,
      observacao: f.observacao.value.trim(),
    };
    if (!corpo.descricao) { erro.textContent = 'Informe a descrição.'; f.descricao.focus(); return; }
    if (!(valor > 0)) { erro.textContent = 'Informe um valor maior que zero.'; f.valor.focus(); return; }
    if (!corpo.data_prevista || corpo.data_prevista < f.data_prevista.min || corpo.data_prevista > f.data_prevista.max) {
      erro.textContent = `A data precisa estar em ${MESES[pagina.periodo().mes - 1].toLowerCase()}. Para outro mês, troque o filtro.`;
      f.data_prevista.focus();
      return;
    }

    const botao = $('#btn-salvar');
    botao.disabled = true;
    try {
      if (editando) await api(`/api/provisoes/${editando.id}`, { method: 'PATCH', body: corpo });
      else await api('/api/provisoes', { method: 'POST', body: corpo });
      avisar(editando ? 'Provisão atualizada' : 'Provisão adicionada');
      preencherForm(null);
      await recarregar();
      f.descricao.focus();
    } catch (err) {
      erro.textContent = err.message;
    } finally {
      botao.disabled = false;
    }
  }

  // ---------- Ações da lista ----------
  const confirmando = new Map(); // id -> timeout do "Excluir?"

  async function acaoLista(e) {
    const alvo = e.target.closest('[data-acao]');
    if (!alvo) return;
    const acao = alvo.dataset.acao;

    if (acao === 'copiar') return copiar(alvo);

    const id = Number(alvo.closest('[data-id]')?.dataset.id);
    const item = dados.itens.find((p) => p.id === id);
    if (!item) return;

    try {
      if (acao === 'concluir') {
        await api(`/api/provisoes/${id}`, { method: 'PATCH', body: { concluida: alvo.checked } });
        avisar(alvo.checked ? 'Concluída: saiu da previsão' : 'Voltou para a previsão');
        await recarregar();
      } else if (acao === 'editar') {
        preencherForm(item);
      } else if (acao === 'excluir') {
        // primeiro clique pede confirmação; o segundo exclui
        if (!confirmando.has(id)) {
          alvo.classList.add('btn-excluir--confirmar');
          confirmando.set(id, setTimeout(() => { alvo.classList.remove('btn-excluir--confirmar'); confirmando.delete(id); }, 3000));
          return;
        }
        clearTimeout(confirmando.get(id));
        confirmando.delete(id);
        await api(`/api/provisoes/${id}`, { method: 'DELETE' });
        if (editando?.id === id) preencherForm(null);
        avisar('Provisão excluída');
        await recarregar();
      }
    } catch (err) {
      avisar(err.message, 'erro');
      if (acao === 'concluir') alvo.checked = !alvo.checked;
    }
  }

  async function copiar(botao) {
    const { ano, mes } = pagina.periodo();
    botao.disabled = true;
    try {
      const r = await api('/api/provisoes/copiar', { method: 'POST', body: { ano, mes } });
      const mesAnt = MESES[(mes + 10) % 12].toLowerCase();
      if (!r.no_mes_anterior) avisar(`Não há provisões em ${mesAnt} para copiar`, 'erro');
      else if (!r.copiadas) avisar('Todas as provisões do mês anterior já estão neste mês');
      else avisar(`${r.copiadas} ${r.copiadas === 1 ? 'provisão copiada' : 'provisões copiadas'} de ${mesAnt}`);
      await recarregar();
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  }

  // ---------- Página ----------
  function render(d) {
    const { ano, mes } = d.periodo;
    editando = null;
    el.conteudo.innerHTML = `
      <section class="secao">
        <div class="grade grade--prov" id="prov-cards"></div>
      </section>
      <section class="secao">
        <div class="secao__cab">
          <span class="secao__num">01</span>
          <h2 class="secao__titulo">Lançar provisão</h2>
          <p class="secao__desc">Pagamentos quase fixos que só entram no sistema no dia em que são pagos</p>
        </div>
        ${formHtml(ano, mes)}
      </section>
      <section class="secao">
        <div class="secao__cab secao__cab--acoes">
          <span class="secao__num">02</span>
          <h2 class="secao__titulo">Provisões do mês</h2>
          <p class="secao__desc">Marque como concluída quando o pagamento real for lançado</p>
          <button type="button" id="btn-copiar" class="btn-texto" data-acao="copiar">Copiar do mês anterior</button>
        </div>
        <div class="painel" id="prov-lista"></div>
      </section>`;

    desenharDados(d);
    $('#prov-form').addEventListener('submit', salvar);
    $('#btn-cancelar').addEventListener('click', () => preencherForm(null));
    $('#prov-form').valor.addEventListener('blur', (e) => {
      const v = lerValor(e.target.value);
      if (v > 0) e.target.value = decimal(v);
    });
    // botões pelo "click"; o checkbox só pelo "change" (o clique nele dispara os dois)
    $('#prov-lista').addEventListener('click', (e) => { if (!e.target.closest('[data-acao="concluir"]')) acaoLista(e); });
    $('#prov-lista').addEventListener('change', (e) => { if (e.target.matches('[data-acao="concluir"]')) acaoLista(e); });
    $('#btn-copiar').addEventListener('click', (e) => copiar(e.currentTarget));

    // faixa do período (dias fechados do mês, como nas outras abas)
    const { ultimo } = limitesMes(ano, mes);
    const hoje = Comum.data(d.hoje);
    const ini = new Date(ano, mes - 1, 1), fim = new Date(ano, mes, 1);
    const status = hoje >= fim ? 'fechado' : hoje < ini ? 'futuro' : 'aberto';
    const dias = status === 'fechado' ? ultimo : status === 'futuro' ? 0 : hoje.getDate() - 1;
    Comum.faixa({
      status,
      html: `<b>${MESES[mes - 1]} de ${ano}</b> · provisões com data prevista no mês`,
      diasDecorridos: dias, diasMes: ultimo, atualizadoEm: d.atualizado_em,
    });
  }

  function esqueleto() {
    const cards = Array.from({ length: 3 }, () => `
      <article class="card card--esqueleto">
        ${linha('55%', 12)}${linha('70%', 28, 'margin-top:10px')}${linha('45%', 10, 'margin-top:auto')}
      </article>`).join('');
    return `
      <section class="secao"><div class="grade grade--prov">${cards}</div></section>
      <section class="secao"><div class="painel" style="padding:20px">${linha('40%', 18)}${linha('100%', 40, 'margin-top:16px')}</div></section>`;
  }

  const pagina = Comum.iniciar({ endpoint: '/api/provisoes', render, esqueleto });
})();
