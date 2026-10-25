// Partes comuns às páginas: formatação, filtros de mês/ano, tema e carregamento da API.
window.Comum = (() => {
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
  const fmtDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCentavos = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const moeda = (v) => `<small>R$</small>${fmtInteiro.format(v)}`;
  const moedaTexto = (v) => `R$ ${fmtInteiro.format(v)}`;
  const centavos = (v) => fmtCentavos.format(v);
  const decimal = (v) => fmtDecimal.format(v);
  const pct = (v) => (v == null ? '—' : `${fmtDecimal.format(v)}<small style="margin-left:2px">%</small>`);
  const pctTexto = (v) => (v == null ? '—' : `${fmtDecimal.format(v)}%`);

  const data = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
  const ddmm = (iso) => data(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const ddmmaa = (iso) => (iso ? data(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
  const diaSemana = (iso) => {
    const s = data(iso).toLocaleDateString('pt-BR', { weekday: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  // ---------- Faixa do período ----------
  const ROTULO_STATUS = { aberto: 'Em andamento', fechado: 'Mês fechado', futuro: 'Mês futuro' };

  function faixa({ status, html, diasDecorridos, diasMes, atualizadoEm }) {
    el.status.textContent = ROTULO_STATUS[status];
    el.status.className = `selo selo--${status}`;
    el.texto.innerHTML = html;
    el.progresso.style.width = `${(diasDecorridos / diasMes) * 100}%`;
    const hora = new Date(atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    el.hora.textContent = `Consultado às ${hora}`;
  }

  function erro(msg, tentar) {
    el.conteudo.innerHTML = `
      <div class="aviso" role="alert">
        <h2>Não foi possível carregar o relatório</h2>
        <p>${escapar(msg)}</p>
        <button type="button" id="btn-tentar">Tentar de novo</button>
      </div>`;
    $('#btn-tentar').addEventListener('click', tentar);
    el.texto.textContent = 'Sem dados';
  }

  // ---------- Filtros (o período escolhido vale para todas as abas) ----------
  function salvar(v) { try { sessionStorage.setItem('periodo', JSON.stringify(v)); } catch (e) { /* opcional */ } }
  function lerSalvo() { try { return JSON.parse(sessionStorage.getItem('periodo')); } catch (e) { return null; } }

  function montarFiltros(aoMudar) {
    const { anoAtual, mesAtual } = window.APP;
    el.mes.innerHTML = MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
    const anos = [];
    for (let a = anoAtual; a >= ANO_INICIAL; a--) anos.push(`<option value="${a}">${a}</option>`);
    el.ano.innerHTML = anos.join('');
    const salvo = lerSalvo();
    el.mes.value = salvo?.mes || mesAtual;
    el.ano.value = salvo?.ano || anoAtual;
    el.mes.addEventListener('change', () => aoMudar('filtro'));
    el.ano.addEventListener('change', () => aoMudar('filtro'));
    el.atualizar.addEventListener('click', () => aoMudar(true));
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

  // ---------- Carregamento ----------
  // pagina = { endpoint, render(json), esqueleto() }
  function iniciar(pagina) {
    let pedidoAtual = 0;

    async function carregar(forcar = false) {
      const id = ++pedidoAtual;
      const ano = el.ano.value, mes = el.mes.value;
      if (!el.conteudo.children.length || forcar === 'filtro') el.conteudo.innerHTML = pagina.esqueleto();
      el.atualizar.classList.add('girando');
      el.texto.textContent = 'Consultando o banco…';
      try {
        const qs = new URLSearchParams({ ano, mes, ...(forcar === true ? { atualizar: '1' } : {}) });
        const resp = await fetch(`${pagina.endpoint}?${qs}`);
        const json = await resp.json();
        if (id !== pedidoAtual) return; // chegou uma resposta mais nova
        if (!resp.ok) throw new Error(json.erro || 'Erro desconhecido.');
        pagina.render(json);
        salvar({ ano, mes });
      } catch (e) {
        if (id === pedidoAtual) erro(e.message || 'Falha de conexão com o servidor.', () => carregar(true));
      } finally {
        if (id === pedidoAtual) el.atualizar.classList.remove('girando');
      }
    }

    montarFiltros(carregar);
    carregar();
  }

  // bloco cinza de carregamento
  const linha = (largura, altura, extra = '') => `<span class="linha" style="width:${largura};height:${altura}px;${extra}"></span>`;

  return {
    MESES, el, moeda, moedaTexto, centavos, decimal, pct, pctTexto,
    data, ddmm, ddmmaa, diaSemana, escapar, normalizar, faixa, iniciar, linha,
  };
})();
