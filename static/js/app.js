(() => {
  'use strict';

  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
    'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const ANO_INICIAL = 2023;

  const $ = (s) => document.querySelector(s);
  const el = {
    mes: $('#filtro-mes'), ano: $('#filtro-ano'), atualizar: $('#btn-atualizar'), tema: $('#btn-tema'),
    conteudo: $('#conteudo'), status: $('#periodo-status'), texto: $('#periodo-texto'),
    progresso: $('#periodo-progresso span'), hora: $('#atualizado'),
  };

  // ---------- Formatação ----------
  const fmtInteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const fmtCentavos = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const moeda = (v) => `<small>R$</small>${fmtInteiro.format(v)}`;
  const moedaTexto = (v) => `R$ ${fmtInteiro.format(v)}`;
  const pct = (v) => (v == null ? '—' : `${fmtPct.format(v)}<small style="margin-left:2px">%</small>`);

  const data = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
  const ddmm = (iso) => data(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const diaSemana = (iso) => {
    const s = data(iso).toLocaleDateString('pt-BR', { weekday: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Ícones (traço 2px, 24x24) ----------
  const ICONES = {
    dia: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    sacola: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
    caminhao: '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    soma: '<path d="M18 4H6l6 8-6 8h12"/>',
    alvo: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
    saida: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    balanca: '<path d="M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
    pct: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    alerta: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    relogio: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    lista: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    proximo: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  };
  const icone = (nome) => `<span class="card__icone"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES[nome]}</svg></span>`;

  // ---------- Cards ----------
  const tom = (v) => (v == null || v === 0 ? '' : v > 0 ? 'card--pos' : 'card--neg');

  function card({ rotulo, valor, tipo = 'moeda', sub = '', ico, classes = '', barra = null }, i) {
    const html = tipo === 'pct' ? pct(valor) : moeda(valor);
    const titulo = tipo === 'pct' ? '' : ` title="${fmtCentavos.format(valor)}"`;
    const largura = barra == null ? '' : `<div class="barra"><span style="width:${Math.max(0, Math.min(100, barra))}%"></span></div>`;
    return `
      <article class="card ${classes}" style="--i:${i}">
        <div class="card__topo"><span class="card__rotulo">${rotulo}</span>${icone(ico)}</div>
        <div class="card__valor"${titulo}>${html}</div>
        ${largura}
        <div class="card__sub">${sub}</div>
      </article>`;
  }

  function secao(num, titulo, desc, cards, offset) {
    return `
      <section class="secao">
        <div class="secao__cab">
          <span class="secao__num">${num}</span>
          <h2 class="secao__titulo">${titulo}</h2>
          <p class="secao__desc">${desc}</p>
        </div>
        <div class="grade">${cards.map((c, i) => card(c, offset + i)).join('')}</div>
      </section>`;
  }

  function render(d) {
    const p = d.periodo, r = d.receitas, rd = d.resultado_dia, pg = d.pagamentos, g = d.resultado_geral;
    const temDias = p.dias_decorridos > 0;
    const faixa = temDias ? `${ddmm(p.ini)} a ${ddmm(p.ate)}` : 'sem dias fechados';
    const nomeProx = MESES[data(p.proximo_mes).getMonth()].toLowerCase();

    const secoes = [
      ['01', 'Receitas', `Vendas e transferências de ${faixa}`, [
        { rotulo: 'Venda do dia anterior', valor: r.venda_dia_anterior, ico: 'dia',
          sub: p.dia_anterior ? `${diaSemana(p.dia_anterior)}, ${ddmm(p.dia_anterior)}` : 'Nenhum dia fechado no mês' },
        { rotulo: 'Venda do período', valor: r.venda_periodo, ico: 'sacola',
          sub: temDias ? `${faixa} · ${p.dias_decorridos} dia${p.dias_decorridos > 1 ? 's' : ''}` : '—' },
        { rotulo: 'Transferências enviadas', valor: r.transferencias, ico: 'caminhao',
          sub: 'NF de transferência autorizadas' },
        { rotulo: 'Faturamento total', valor: r.faturamento_total, ico: 'soma', classes: 'card--destaque',
          sub: 'Venda do período + transferências' },
        { rotulo: 'Projeção de faturamento', valor: r.projecao_faturamento, ico: 'alvo',
          sub: `Média de <b>${moedaTexto(r.media_diaria)}</b>/dia × ${p.dias_mes} dias` },
      ]],
      ['02', 'Resultado do período', 'Faturamento menos as contas pagas até D-1', [
        { rotulo: 'Contas pagas do período', valor: rd.contas_pagas, ico: 'saida', sub: `Pagamentos de ${faixa}` },
        { rotulo: 'Faturamento do período', valor: rd.faturamento, ico: 'soma', sub: 'Faturamento total' },
        { rotulo: 'Resultado do período', valor: rd.resultado, ico: 'balanca',
          classes: `card--destaque ${tom(rd.resultado)}`, sub: 'Faturamento − contas pagas' },
        { rotulo: 'Lucratividade do período', valor: rd.lucratividade, tipo: 'pct', ico: 'pct',
          classes: tom(rd.lucratividade), barra: rd.lucratividade == null ? null : Math.abs(rd.lucratividade) * 2.5,
          sub: 'Resultado ÷ faturamento' },
      ]],
      ['03', 'Pagamentos', `Contas do mês de ${MESES[p.mes - 1].toLowerCase()}`, [
        { rotulo: 'Contas pagas', valor: pg.contas_pagas, ico: 'saida', sub: `Pagas de ${faixa}` },
        { rotulo: 'Contas vencidas', valor: pg.contas_vencidas, ico: 'alerta',
          classes: pg.contas_vencidas > 0 ? 'card--alerta' : '',
          sub: pg.vencidas_meses_anteriores > 0
            ? `Em aberto, vencidas no mês · <b>+ ${moedaTexto(pg.vencidas_meses_anteriores)}</b> de meses anteriores`
            : 'Em aberto, vencidas no mês' },
        { rotulo: 'Contas a pagar do mês', valor: pg.contas_a_pagar, ico: 'relogio',
          sub: p.status === 'fechado' ? 'Mês encerrado' : 'Em aberto, a vencer até o fim do mês' },
        { rotulo: 'Contas previstas', valor: pg.contas_previstas, ico: 'lista', classes: 'card--destaque',
          sub: 'Pagas + vencidas + a pagar' },
      ]],
      ['04', 'Resultado geral', 'Previsão de fechamento do mês', [
        { rotulo: 'Contas previstas', valor: g.contas_previstas, ico: 'lista', sub: 'Total de pagamentos do mês' },
        { rotulo: 'Previsão de faturamento + transferências', valor: g.previsao_faturamento, ico: 'alvo',
          sub: 'Projeção de vendas + transferências enviadas' },
        { rotulo: 'Resultado (previsão)', valor: g.resultado_previsto, ico: 'balanca',
          classes: `card--destaque ${tom(g.resultado_previsto)}`, sub: 'Previsão de faturamento − contas previstas' },
        { rotulo: 'Previsão do resultado', valor: g.previsao_resultado, tipo: 'pct', ico: 'pct',
          classes: tom(g.previsao_resultado), barra: g.previsao_resultado == null ? null : Math.abs(g.previsao_resultado) * 2.5,
          sub: 'Resultado previsto ÷ previsão de faturamento' },
        { rotulo: 'Pagamentos próximo mês', valor: g.pagamentos_proximo_mes, ico: 'proximo',
          sub: `Em aberto com vencimento em ${nomeProx}` },
      ]],
    ];

    let offset = 0;
    el.conteudo.innerHTML = secoes.map(([n, t, de, cards]) => {
      const html = secao(n, t, de, cards, offset);
      offset += cards.length;
      return html;
    }).join('');

    // faixa do período
    const ROTULO = { aberto: 'Em andamento', fechado: 'Mês fechado', futuro: 'Mês futuro' };
    el.status.textContent = ROTULO[p.status];
    el.status.className = `selo selo--${p.status}`;
    el.texto.innerHTML = `<b>${MESES[p.mes - 1]} de ${p.ano}</b> · ${temDias ? `dados de ${faixa}` : 'ainda sem dias fechados'} · ${p.dias_decorridos} de ${p.dias_mes} dias`;
    el.progresso.style.width = `${(p.dias_decorridos / p.dias_mes) * 100}%`;
    const hora = new Date(d.atualizado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    el.hora.textContent = `Consultado às ${hora}`;
  }

  function esqueleto() {
    const bloco = (n) => `
      <section class="secao">
        <div class="secao__cab"><span class="linha" style="width:180px;height:28px"></span></div>
        <div class="grade">${Array.from({ length: n }, () => `
          <article class="card card--esqueleto">
            <span class="linha" style="width:55%;height:12px"></span>
            <span class="linha" style="width:75%;height:28px;margin-top:auto"></span>
            <span class="linha" style="width:45%;height:10px"></span>
          </article>`).join('')}</div>
      </section>`;
    el.conteudo.innerHTML = [5, 4, 4, 5].map(bloco).join('');
  }

  function erro(msg) {
    el.conteudo.innerHTML = `
      <div class="aviso" role="alert">
        <h2>Não foi possível carregar o relatório</h2>
        <p>${escapar(msg)}</p>
        <button type="button" id="btn-tentar">Tentar de novo</button>
      </div>`;
    $('#btn-tentar').addEventListener('click', () => carregar(true));
    el.texto.textContent = 'Sem dados';
  }

  // ---------- Dados ----------
  let pedidoAtual = 0;

  async function carregar(forcar = false) {
    const id = ++pedidoAtual;
    const ano = el.ano.value, mes = el.mes.value;
    if (!el.conteudo.children.length || forcar === 'filtro') esqueleto();
    el.atualizar.classList.add('girando');
    el.texto.textContent = 'Consultando o banco…';
    try {
      const qs = new URLSearchParams({ ano, mes, ...(forcar === true ? { atualizar: '1' } : {}) });
      const resp = await fetch(`/api/kpis?${qs}`);
      const json = await resp.json();
      if (id !== pedidoAtual) return; // chegou uma resposta mais nova
      if (!resp.ok) throw new Error(json.erro || 'Erro desconhecido.');
      render(json);
      salvar({ ano, mes });
    } catch (e) {
      if (id === pedidoAtual) erro(e.message || 'Falha de conexão com o servidor.');
    } finally {
      if (id === pedidoAtual) el.atualizar.classList.remove('girando');
    }
  }

  // ---------- Filtros ----------
  function salvar(v) { try { sessionStorage.setItem('periodo', JSON.stringify(v)); } catch (e) { /* opcional */ } }
  function lerSalvo() { try { return JSON.parse(sessionStorage.getItem('periodo')); } catch (e) { return null; } }

  function montarFiltros() {
    const { anoAtual, mesAtual } = window.APP;
    el.mes.innerHTML = MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
    const anos = [];
    for (let a = anoAtual; a >= ANO_INICIAL; a--) anos.push(`<option value="${a}">${a}</option>`);
    el.ano.innerHTML = anos.join('');
    const salvo = lerSalvo();
    el.mes.value = salvo?.mes || mesAtual;
    el.ano.value = salvo?.ano || anoAtual;
    el.mes.addEventListener('change', () => carregar('filtro'));
    el.ano.addEventListener('change', () => carregar('filtro'));
    el.atualizar.addEventListener('click', () => carregar(true));
  }

  // ---------- Tema ----------
  el.tema.addEventListener('click', () => {
    const escuroAgora = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const novo = escuroAgora ? 'light' : 'dark';
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem('tema', novo); } catch (e) { /* opcional */ }
  });

  montarFiltros();
  carregar();
})();
