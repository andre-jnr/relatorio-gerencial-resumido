"""Cálculo dos KPIs do relatório gerencial.

Período de um mês selecionado:
  ini   = dia 1 do mês
  corte = hoje (mês em andamento: dados até ontem, D-1)
          ou dia 1 do mês seguinte (mês já fechado)
  fim   = dia 1 do mês seguinte

Regras (as mesmas do Painel Gerencial):
  Vendas         = SUM(Venda.Valor_Final), Cancelada = 'N'
  Transferências = SUM(Fiscal_NF.Total_NF), NFe AUTORIZADA, CFOPs de TRANSF_CFOPS
  Contas         = Contas_Pagar sem Data_Exclusao e fora das CONTAS_EXCLUIDAS
  Bonificações   = SUM(Entrada_Produto_Itens.Valor_Total) com CFOP de BONIF_CFOPS, por Data_Entrada
                   (informativo: não entra no resultado)
  Provisões      = lançadas na aba Provisões; as pendentes somam nas contas previstas
                   (mês da data prevista) e nos pagamentos do próximo mês
"""
import calendar
from datetime import date, datetime, timedelta

import config
import db
import provisoes


def _normalizar(texto):
    # mesmo critério do SQL: sem espaços; acentos e maiúsculas tratados pelo COLLATE
    return texto.replace(" ", "")


def filtro_contas():
    """Trecho WHERE que tira as contas contábeis excluídas (precisa do alias cc)."""
    nomes = [_normalizar(n) for n in config.CONTAS_EXCLUIDAS]
    if not nomes:
        return "1 = 1", []
    marcas = ", ".join("?" for _ in nomes)
    return (
        f"REPLACE(ISNULL(cc.Descricao, ''), ' ', '') COLLATE Latin1_General_CI_AI NOT IN ({marcas})",
        nomes,
    )


def dt(d):
    return datetime(d.year, d.month, d.day)


def periodo(ano, mes, hoje=None):
    hoje = hoje or date.today()
    ini = date(ano, mes, 1)
    dias_mes = calendar.monthrange(ano, mes)[1]
    fim = ini + timedelta(days=dias_mes)

    if fim <= hoje:
        status, corte = "fechado", fim
    elif ini < hoje:
        status, corte = "aberto", hoje
    else:
        # mês futuro, ou hoje é dia 1 (ainda não há dia fechado)
        status, corte = ("futuro" if ini > hoje else "aberto"), ini

    dias = (corte - ini).days
    prox_fim = fim + timedelta(days=calendar.monthrange(fim.year, fim.month)[1])
    return {
        "ini": ini, "corte": corte, "fim": fim, "prox_fim": prox_fim,
        "dia_anterior": corte - timedelta(days=1) if dias > 0 else None,
        "dias_decorridos": dias, "dias_mes": dias_mes, "status": status,
    }


def _consultar(conn, p):
    contas_sql, contas_par = filtro_contas()
    cfops = ", ".join("?" for _ in config.TRANSF_CFOPS)
    ini, corte, fim, prox_fim = (dt(p[k]) for k in ("ini", "corte", "fim", "prox_fim"))

    sql_vendas = "SELECT SUM(Valor_Final) FROM Venda WHERE Cancelada = 'N' AND Data >= ? AND Data < ?"

    sql_transf = f"""
        SELECT SUM(nf.Total_NF)
        FROM Fiscal_NF nf
        INNER JOIN Fiscal_NFe nfe ON nfe.Codigo_Fiscal_NF = nf.Codigo
        WHERE nfe.Situacao = 'AUTORIZADA' AND nf.CFOP IN ({cfops})
          AND nf.Data_Emissao >= ? AND nf.Data_Emissao < ?"""

    sql_pagas = f"""
        SELECT SUM(ISNULL(cp.Valor_Pago, 0))
        FROM Contas_Pagar cp
        LEFT JOIN Conta_Contabil cc ON cc.Codigo = cp.Conta_Contabil
        WHERE cp.Pago = 'S' AND cp.Data_Exclusao IS NULL AND {contas_sql}
          AND cp.Data_Pagamento >= ? AND cp.Data_Pagamento < ?"""

    # contas em aberto por vencimento
    sql_abertas = f"""
        SELECT SUM(cp.Valor)
        FROM Contas_Pagar cp
        LEFT JOIN Conta_Contabil cc ON cc.Codigo = cp.Conta_Contabil
        WHERE ISNULL(cp.Pago, 'N') <> 'S' AND cp.Data_Exclusao IS NULL AND {contas_sql}
          AND cp.Data_Vencimento >= ? AND cp.Data_Vencimento < ?"""

    # bonificações recebidas: itens das notas de entrada com CFOP de bonificação, pela data de entrada
    bonif_cfops = ", ".join("?" for _ in config.BONIF_CFOPS)
    sql_bonif = f"""
        SELECT SUM(i.Valor_Total)
        FROM Entrada_Produto_Itens i
        INNER JOIN Entrada_Produto e ON e.Chave = i.Chave
        WHERE i.CFOP IN ({bonif_cfops}) AND e.Data_Entrada >= ? AND e.Data_Entrada < ?"""
    sql_bonif_notas = sql_bonif.replace("SUM(i.Valor_Total)", "COUNT(DISTINCT i.Chave)")

    q = lambda sql, *par: db.valor(conn, sql, par)
    dia = dt(p["dia_anterior"]) if p["dia_anterior"] else corte
    # vencidas antes do mês selecionado (num mês futuro, só o que já venceu até hoje)
    limite_anteriores = min(ini, dt(date.today()))
    return {
        "venda_dia": q(sql_vendas, dia, corte),
        "vendas": q(sql_vendas, ini, corte),
        "transf": q(sql_transf, *config.TRANSF_CFOPS, ini, corte),
        "pagas": q(sql_pagas, *contas_par, ini, corte),
        "vencidas": q(sql_abertas, *contas_par, ini, corte),
        "vencidas_anteriores": q(sql_abertas, *contas_par, datetime(2000, 1, 1), limite_anteriores),
        "a_pagar": q(sql_abertas, *contas_par, corte, fim),
        "proximo_mes": q(sql_abertas, *contas_par, fim, prox_fim),
        "bonificacoes": q(sql_bonif, *config.BONIF_CFOPS, ini, corte),
        "bonificacoes_notas": int(q(sql_bonif_notas, *config.BONIF_CFOPS, ini, corte)),
    }


def _pct(parte, total):
    return parte / total * 100 if total else None


def calcular(ano, mes):
    p = periodo(ano, mes)
    conn = db.conectar()
    try:
        v = _consultar(conn, p)
    finally:
        db.fechar(conn)

    # provisões pendentes (lançadas à mão na aba Provisões)
    prov, prov_qtde = provisoes.total_pendente(p["ini"], p["fim"])
    prov_prox, prov_prox_qtde = provisoes.total_pendente(p["fim"], p["prox_fim"])

    faturamento = v["vendas"] + v["transf"]
    media_dia = v["vendas"] / p["dias_decorridos"] if p["dias_decorridos"] else 0.0
    projecao = media_dia * p["dias_mes"]
    resultado = faturamento - v["pagas"]
    previstas = v["pagas"] + v["vencidas"] + v["a_pagar"] + prov
    previsao_fat = projecao + v["transf"]
    resultado_prev = previsao_fat - previstas

    iso = lambda d: d.isoformat() if d else None
    return {
        "periodo": {
            "ano": ano, "mes": mes, "status": p["status"],
            "ini": iso(p["ini"]), "ate": iso(p["corte"] - timedelta(days=1)) if p["dias_decorridos"] else None,
            "dia_anterior": iso(p["dia_anterior"]),
            "dias_decorridos": p["dias_decorridos"], "dias_mes": p["dias_mes"],
            "proximo_mes": iso(p["fim"]),
        },
        "receitas": {
            "venda_dia_anterior": v["venda_dia"],
            "venda_periodo": v["vendas"],
            "transferencias": v["transf"],
            "faturamento_total": faturamento,
            "media_diaria": media_dia,
            "projecao_faturamento": projecao,
        },
        "resultado_dia": {
            "contas_pagas": v["pagas"],
            "faturamento": faturamento,
            "resultado": resultado,
            "lucratividade": _pct(resultado, faturamento),
        },
        "pagamentos": {
            "contas_pagas": v["pagas"],
            "contas_vencidas": v["vencidas"],
            "vencidas_meses_anteriores": v["vencidas_anteriores"],
            "contas_a_pagar": v["a_pagar"],
            "provisoes": prov,
            "provisoes_qtde": prov_qtde,
            "contas_previstas": previstas,
        },
        "resultado_geral": {
            "contas_previstas": previstas,
            "previsao_faturamento": previsao_fat,
            "bonificacoes": v["bonificacoes"],
            "bonificacoes_notas": v["bonificacoes_notas"],
            "resultado_previsto": resultado_prev,
            "previsao_resultado": _pct(resultado_prev, previsao_fat),
            "pagamentos_proximo_mes": v["proximo_mes"] + prov_prox,
            "provisoes_proximo_mes": prov_prox,
            "provisoes_proximo_mes_qtde": prov_prox_qtde,
        },
        "loja": config.LOJA_NOME,
        "atualizado_em": datetime.now().isoformat(timespec="seconds"),
    }
