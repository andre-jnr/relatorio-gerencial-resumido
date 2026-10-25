// Aba Pagamentos: contas pagas por plano de contas -> grupo -> conta contábil,
// comparadas com o mesmo intervalo do mês anterior. Clicar numa conta mostra os lançamentos.
(() => {
  'use strict';

  const { MESES, el, moeda, centavos, decimal, pctTexto, ddmm, ddmmaa, escapar, normalizar, linha } = Comum;
  const NAO_CLASSIFICADOS = 'PAGAMENTOS NÃO CLASSIFICADOS';
  const CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

  const estado = {
    dados: null,
    comPlano: lerPreferencia('comPlano', true),
    busca: '',
    ordem: { coluna: 'atual', direcao: 'desc' },
    abertos: new Set(),
    textoBusca: new Map(), // chave da conta -> texto normalizado (conta, grupo, plano, fornecedores)
  };

  function lerPreferencia(nome, padrao) {
    try { const v = localStorage.getItem(`pag.${nome}`); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; }
  }
  function salvarPreferencia(nome, valor) {
    try { localStorage.setItem(`pag.${nome}`, JSON.stringify(valor)); } catch (e) { /* opcional */ }
  }

  // ---------- Árvore ----------
  function arvore() {
    const { linhas } = estado.dados;
    const termos = normalizar(estado.busca).split(/\s+/).filter(Boolean);
    const visiveis = termos.length
      ? linhas.filter((l) => termos.every((t) => estado.textoBusca.get(l.chave).includes(t)))
      : linhas;

    const raiz = { filhos: new Map() };
    const no = (pai, id, nome, tipo) => {
      if (!pai.filhos.has(id)) pai.filhos.set(id, { id, nome, tipo, anterior: 0, atual: 0, filhos: new Map() });
      return pai.filhos.get(id);
    };
    for (const l of visiveis) {
      const caminho = [];
      if (estado.comPlano) caminho.push(no(raiz, `p:${l.plano}`, l.plano, 'plano'));
      const pai = caminho.length ? caminho[0] : raiz;
      const idGrupo = `g:${estado.comPlano ? l.plano : ''}|${l.grupo}`;
      caminho.push(no(pai, idGrupo, l.grupo, 'grupo'));
      const conta = no(caminho[caminho.length - 1], `c:${l.chave}`, l.conta, 'conta');
      conta.linha = l;
      for (const n of [...caminho, conta]) { n.anterior += l.anterior; n.atual += l.atual; }
    }
    return { nos: ordenar([...raiz.filhos.values()]), filtrando: termos.length > 0, visiveis };
  }

  function valorOrdem(n, coluna) {
    if (coluna === 'nome') return n.nome;
    if (coluna === 'dif') return n.atual - n.anterior;
    if (coluna === 'var') return n.anterior ? (n.atual - n.anterior) / Math.abs(n.anterior) : (n.atual ? Infinity : 0);
    return n[coluna];
  }

  function ordenar(nos) {
    const { coluna, direcao } = estado.ordem;
    const sinal = direcao === 'asc' ? 1 : -1;
    nos.sort((a, b) => {
      // não classificados sempre no fim
      const naoA = a.nome === NAO_CLASSIFICADOS, naoB = b.nome === NAO_CLASSIFICADOS;
      if (naoA !== naoB) return naoA ? 1 : -1;
      const va = valorOrdem(a, coluna), vb = valorOrdem(b, coluna);
      if (coluna === 'nome') return sinal * va.localeCompare(vb, 'pt-BR');
      return sinal * (va - vb);
    });
    for (const n of nos) n.lista = ordenar([...n.filhos.values()]);
    return nos;
  }

  // ---------- Matriz ----------
  function diferenca(n) {
    const valor = n.atual - n.anterior;
    const plano = Math.abs(valor) < 0.005;
    const classe = plano ? '' : valor > 0 ? 'dif--sobe' : 'dif--desce';
    const sinal = plano ? '' : valor > 0 ? '+' : '−';
    let variacao;
    if (!n.anterior) variacao = n.atual ? 'novo' : '—';
    else variacao = `${sinal}${decimal(Math.abs(valor / n.anterior) * 100)}%`;
    return { texto: `${sinal}${centavos(Math.abs(valor))}`, variacao, classe };
  }

  function linhaHtml(n, nivel, total, filtrando) {
    const d = diferenca(n);
    const temFilhos = n.tipo === 'conta' ? n.linha.qtde > 0 : n.lista.length > 0;
    const aberto = estado.abertos.has(n.id) || (filtrando && n.tipo !== 'conta');
    const part = total ? (n.atual / total) * 100 : 0;
    const botao = temFilhos
      ? `<button type="button" class="seta${aberto ? ' seta--aberta' : ''}" data-alternar="${escapar(n.id)}" aria-expanded="${aberto}" aria-label="${aberto ? 'Recolher' : 'Expandir'} ${escapar(n.nome)}">${CHEVRON}</button>`
      : '<span class="seta seta--vazia"></span>';
    const extra = n.tipo === 'conta'
      ? `<span class="matriz__qtde">${n.linha.qtde} lanç.</span>${n.linha.classificado ? '' : '<span class="selo selo--alerta">sem classificação</span>'}`
      : '';

    let html = `
      <tr class="nivel nivel--${n.tipo}" style="--nivel:${nivel}">
        <th scope="row" class="matriz__nome">
          <span class="matriz__rotulo">${botao}<span class="matriz__texto" title="${escapar(n.nome)}">${escapar(n.nome)}</span>${extra}</span>
        </th>
        <td class="num">${centavos(n.anterior)}</td>
        <td class="num num--forte">${centavos(n.atual)}</td>
        <td class="num ${d.classe}">${d.texto}</td>
        <td class="num ${d.classe} col-var">${d.variacao}</td>
        <td class="num col-part"><span class="part"><span class="part__barra"><span style="width:${Math.min(100, part)}%"></span></span>${decimal(part)}%</span></td>
      </tr>`;

    if (!aberto) return html;
    if (n.tipo === 'conta') return html + lancamentosHtml(n.linha.chave, nivel + 1);
    return html + n.lista.map((f) => linhaHtml(f, nivel + 1, total, filtrando)).join('');
  }

  function lancamentosHtml(chave, nivel) {
    const itens = estado.dados.lancamentos
      .filter((l) => l.chave === chave)
      .sort((a, b) => (b.pagamento || '').localeCompare(a.pagamento || '') || b.valor - a.valor);
    const corpo = itens.map((l) => `
      <tr>
        <td class="lanc__forn">
          <span class="lanc__nome">${escapar(l.fornecedor || '(sem fornecedor)')}</span>
          ${l.observacao ? `<span class="lanc__obs" title="${escapar(l.observacao)}">${escapar(l.observacao)}</span>` : ''}
        </td>
        <td>${escapar(l.documento || '—')}${l.parcela > 1 ? ` <span class="lanc__parc">/${l.parcela}</span>` : ''}</td>
        <td>${ddmmaa(l.emissao)}</td>
        <td>${ddmmaa(l.vencimento)}</td>
        <td>${ddmmaa(l.pagamento)}</td>
        <td><span class="origem origem--${normalizar(l.origem).replace(/\s+/g, '-').toLowerCase()}">${escapar(l.origem)}</span></td>
        <td class="num num--forte">${centavos(l.valor)}</td>
      </tr>`).join('');
    return `
      <tr class="detalhe" style="--nivel:${nivel}">
        <td colspan="6">
          <div class="lanc">
            <table class="lanc__tabela">
              <thead><tr><th>Fornecedor</th><th>Documento</th><th>Emissão</th><th>Vencimento</th><th>Pagamento</th><th>Origem</th><th class="num">Valor pago</th></tr></thead>
              <tbody>${corpo}</tbody>
            </table>
          </div>
        </td>
      </tr>`;
  }

  const COLUNAS = [
    ['nome', () => (estado.comPlano ? 'Plano de contas / grupo / conta' : 'Grupo / conta')],
    ['anterior', () => 'Mês anterior'],
    ['atual', () => 'Mês selecionado'],
    ['dif', () => 'Diferença'],
    ['var', () => 'Var. %'],
    ['part', () => 'Part. %'],
  ];

  function desenharMatriz() {
    const { nos, filtrando, visiveis } = arvore();
    const total = nos.reduce((s, n) => s + n.atual, 0);
    const anterior = nos.reduce((s, n) => s + n.anterior, 0);
    const p = estado.dados.periodo;

    const cab = COLUNAS.map(([col, rotulo]) => {
      const ativa = estado.ordem.coluna === col || (col === 'part' && estado.ordem.coluna === 'atual');
      const ordenavel = col !== 'part';
      const sort = estado.ordem.coluna === col ? (estado.ordem.direcao === 'asc' ? 'ascending' : 'descending') : 'none';
      const sub = col === 'anterior' ? rotuloIntervalo(p.anterior) : col === 'atual' ? rotuloIntervalo(p.atual) : '';
      const conteudo = `<span>${rotulo()}</span>${sub ? `<small>${sub}</small>` : ''}`;
      const classe = `${col === 'nome' ? '' : 'num'} ${col === 'var' ? 'col-var' : ''} ${col === 'part' ? 'col-part' : ''}`;
      return ordenavel
        ? `<th scope="col" class="${classe}" aria-sort="${sort}"><button type="button" class="ordenar${ativa ? ' ordenar--ativa' : ''}" data-ordenar="${col}">${conteudo}<span class="ordenar__seta">${sort === 'ascending' ? '↑' : '↓'}</span></button></th>`
        : `<th scope="col" class="${classe}"><span class="ordenar ordenar--fixa">${conteudo}</span></th>`;
    }).join('');

    const corpo = nos.length
      ? nos.map((n) => linhaHtml(n, 0, total, filtrando)).join('')
      : `<tr><td colspan="6" class="vazio">${filtrando ? 'Nenhuma conta encontrada para essa busca.' : 'Nenhum pagamento no período.'}</td></tr>`;

    const d = diferenca({ anterior, atual: total });
    document.querySelector('#matriz').innerHTML = `
      <thead><tr>${cab}</tr></thead>
      <tbody>${corpo}</tbody>
      <tfoot><tr>
        <th scope="row">Total${filtrando ? ` <span class="matriz__qtde">${visiveis.length} conta${visiveis.length === 1 ? '' : 's'} na busca</span>` : ''}</th>
        <td class="num">${centavos(anterior)}</td>
        <td class="num num--forte">${centavos(total)}</td>
        <td class="num ${d.classe}">${d.texto}</td>
        <td class="num ${d.classe} col-var">${d.variacao}</td>
        <td class="num col-part">${total ? '100,00%' : '—'}</td>
      </tr></tfoot>`;
  }

  const rotuloIntervalo = (i) => (i.ate ? `${ddmm(i.ini)} a ${ddmm(i.ate)}` : 'sem dias');

  // ---------- Resumo e distribuição ----------
  function cardResumo({ rotulo, valorHtml, titulo = '', sub, classes = '' }, i) {
    return `
      <article class="card ${classes}" style="--i:${i}">
        <div class="card__topo"><span class="card__rotulo">${rotulo}</span></div>
        <div class="card__valor"${titulo ? ` title="${titulo}"` : ''}>${valorHtml}</div>
        <div class="card__sub">${sub}</div>
      </article>`;
  }

  function resumoHtml(d) {
    const p = d.periodo, { anterior, atual } = d.totais;
    const dif = atual - anterior;
    const varPct = anterior ? (dif / anterior) * 100 : null;
    const qtde = d.lancamentos.length;

    const grupos = new Map();
    for (const l of d.linhas) if (l.grupo !== NAO_CLASSIFICADOS) grupos.set(l.grupo, (grupos.get(l.grupo) || 0) + l.atual);
    const [maiorNome, maiorValor] = [...grupos.entries()].sort((a, b) => b[1] - a[1])[0] || ['—', 0];

    const cards = [
      { rotulo: 'Pago no período', valorHtml: moeda(atual), titulo: centavos(atual), classes: 'card--destaque',
        sub: `${rotuloIntervalo(p.atual)} · <b>${qtde}</b> lançamento${qtde === 1 ? '' : 's'}` },
      { rotulo: 'Mesmo período do mês anterior', valorHtml: moeda(anterior), titulo: centavos(anterior),
        sub: `${MESES[(p.mes + 10) % 12]} · ${rotuloIntervalo(p.anterior)}` },
      { rotulo: 'Variação', valorHtml: `${dif > 0 ? '+' : dif < 0 ? '−' : ''}${moeda(Math.abs(dif))}`, titulo: centavos(dif),
        classes: dif > 0.005 ? 'card--neg' : dif < -0.005 ? 'card--pos' : '',
        sub: varPct == null ? 'Sem pagamentos no mês anterior' : `<b>${pctTexto(varPct)}</b> ${dif > 0 ? 'a mais' : 'a menos'} que no mês anterior` },
      { rotulo: 'Maior grupo', valorHtml: moeda(maiorValor), titulo: centavos(maiorValor),
        sub: `<b>${escapar(maiorNome)}</b> · ${pctTexto(atual ? (maiorValor / atual) * 100 : null)} do pago` },
    ];
    return cards.map(cardResumo).join('');
  }

  function distribuicaoHtml(d) {
    const planos = new Map();
    for (const l of d.linhas) planos.set(l.plano, (planos.get(l.plano) || 0) + l.atual);
    const total = d.totais.atual;
    const itens = [...planos.entries()].filter(([, v]) => v > 0)
      .sort((a, b) => (a[0] === NAO_CLASSIFICADOS) - (b[0] === NAO_CLASSIFICADOS) || b[1] - a[1]);
    if (!total || !itens.length) return '';
    const cor = (i, nome) => (nome === NAO_CLASSIFICADOS ? 'var(--serie-nc)' : `var(--serie-${(i % 5) + 1})`);
    return `
      <div class="distribuicao">
        <div class="distribuicao__barra" role="img" aria-label="Distribuição do pago por plano de contas">
          ${itens.map(([nome, v], i) => `<span style="flex-grow:${v};background:${cor(i, nome)}" title="${escapar(nome)}: ${centavos(v)}"></span>`).join('')}
        </div>
        <ul class="distribuicao__legenda">
          ${itens.map(([nome, v], i) => `
            <li><span class="ponto" style="background:${cor(i, nome)}"></span>
              <span class="distribuicao__nome">${escapar(nome)}</span>
              <b>${pctTexto((v / total) * 100)}</b>
              <span class="distribuicao__valor">${centavos(v)}</span></li>`).join('')}
        </ul>
      </div>`;
  }

  // ---------- Página ----------
  function render(d) {
    estado.dados = d;
    estado.textoBusca = new Map(d.linhas.map((l) => [l.chave, normalizar(`${l.conta} ${l.grupo} ${l.plano}`)]));
    for (const l of d.lancamentos) estado.textoBusca.set(l.chave, `${estado.textoBusca.get(l.chave)} ${normalizar(l.fornecedor)}`);
    if (!estado.abertos.size) d.linhas.forEach((l) => estado.abertos.add(`p:${l.plano}`));

    const p = d.periodo;
    el.conteudo.innerHTML = `
      <section class="secao">
        <div class="grade grade--resumo">${resumoHtml(d)}</div>
      </section>
      <section class="secao">
        <div class="secao__cab">
          <span class="secao__num">01</span>
          <h2 class="secao__titulo">Plano de contas</h2>
          <p class="secao__desc">Pago por conta contábil · ${rotuloIntervalo(p.atual)} comparado com ${rotuloIntervalo(p.anterior)}</p>
        </div>
        ${distribuicaoHtml(d)}
        <div class="painel">
          <div class="ferramentas">
            <label class="busca">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
              <input id="busca" type="search" placeholder="Buscar conta, grupo ou fornecedor" value="${escapar(estado.busca)}" autocomplete="off">
            </label>
            <label class="chave">
              <input id="com-plano" type="checkbox" ${estado.comPlano ? 'checked' : ''}>
              <span class="chave__trilho"><span></span></span>
              Plano de contas
            </label>
            <div class="ferramentas__botoes">
              <button type="button" class="btn-texto" data-acao="expandir">Expandir tudo</button>
              <button type="button" class="btn-texto" data-acao="recolher">Recolher</button>
            </div>
          </div>
          <div class="tabela-rolagem"><table id="matriz" class="matriz"></table></div>
        </div>
        ${d.planilha_carregada ? '' : '<p class="nota">Planilha de classificação não encontrada: todas as contas aparecem como não classificadas.</p>'}
      </section>`;

    desenharMatriz();
    ligarEventos();

    Comum.faixa({
      status: p.status,
      html: `<b>${MESES[p.mes - 1]} de ${p.ano}</b> · pagamentos de ${rotuloIntervalo(p.atual)} · ${p.dias_decorridos} de ${p.dias_mes} dias`,
      diasDecorridos: p.dias_decorridos, diasMes: p.dias_mes, atualizadoEm: d.atualizado_em,
    });
  }

  function ligarEventos() {
    let espera;
    document.querySelector('#busca').addEventListener('input', (e) => {
      clearTimeout(espera);
      espera = setTimeout(() => { estado.busca = e.target.value; desenharMatriz(); }, 150);
    });
    document.querySelector('#com-plano').addEventListener('change', (e) => {
      estado.comPlano = e.target.checked;
      salvarPreferencia('comPlano', estado.comPlano);
      desenharMatriz();
    });
    document.querySelector('.ferramentas__botoes').addEventListener('click', (e) => {
      const acao = e.target.closest('[data-acao]')?.dataset.acao;
      if (!acao) return;
      estado.abertos.clear();
      if (acao === 'expandir') {
        for (const l of estado.dados.linhas) {
          estado.abertos.add(`p:${l.plano}`);
          estado.abertos.add(`g:${estado.comPlano ? l.plano : ''}|${l.grupo}`);
        }
      }
      desenharMatriz();
    });
    document.querySelector('#matriz').addEventListener('click', (e) => {
      const alternar = e.target.closest('[data-alternar]');
      if (alternar) {
        const id = alternar.dataset.alternar;
        estado.abertos.has(id) ? estado.abertos.delete(id) : estado.abertos.add(id);
        desenharMatriz();
        document.querySelector(`[data-alternar="${CSS.escape(id)}"]`)?.focus();
        return;
      }
      const ordenar = e.target.closest('[data-ordenar]');
      if (ordenar) {
        const col = ordenar.dataset.ordenar;
        estado.ordem = estado.ordem.coluna === col
          ? { coluna: col, direcao: estado.ordem.direcao === 'asc' ? 'desc' : 'asc' }
          : { coluna: col, direcao: col === 'nome' ? 'asc' : 'desc' };
        desenharMatriz();
      }
    });
  }

  function esqueleto() {
    const cards = Array.from({ length: 4 }, () => `
      <article class="card card--esqueleto">
        ${linha('55%', 12)}${linha('75%', 28, 'margin-top:10px')}${linha('45%', 10, 'margin-top:auto')}
      </article>`).join('');
    const linhas = Array.from({ length: 8 }, (_, i) => linha(`${90 - (i % 3) * 15}%`, 16, 'margin:14px 0')).join('');
    return `
      <section class="secao"><div class="grade grade--resumo">${cards}</div></section>
      <section class="secao">
        <div class="secao__cab">${linha('200px', 28)}</div>
        <div class="painel" style="padding:12px 20px">${linhas}</div>
      </section>`;
  }

  Comum.iniciar({ endpoint: '/api/pagamentos', render, esqueleto });
})();
