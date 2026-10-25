"""Aba Pagamentos: contas pagas no mês por plano de contas -> grupo -> conta contábil.

Compara com o mês anterior no mesmo intervalo de dias:
  mês fechado      -> mês inteiro x mês anterior inteiro
  mês em andamento -> dia 1 até D-1 x mês anterior do dia 1 até o mesmo dia
Usa as mesmas regras do card "Contas pagas" (kpis.py), então os totais batem.
"""
from datetime import date, datetime, timedelta

import classificacao
import db
import kpis

NAO_CLASSIFICADOS = "PAGAMENTOS NÃO CLASSIFICADOS"


def _mes_anterior(p):
    ini = p["ini"]
    ini_ant = (ini - timedelta(days=1)).replace(day=1)
    if p["status"] == "fechado":
        return ini_ant, ini
    return ini_ant, min(ini_ant + timedelta(days=p["dias_decorridos"]), ini)


def _origem(conta_corrente, emissao, pagamento):
    if str(conta_corrente or "").strip() == "2":
        return "Transferência"
    if not emissao or not pagamento:
        return "Outros"
    if (emissao.year, emissao.month) == (pagamento.year, pagamento.month):
        return "Mesmo mês"
    if (emissao.year, emissao.month) < (pagamento.year, pagamento.month):
        return "Meses anteriores"
    return "Outros"


def _consultar(conn, ini, fim, ini_ant, fim_ant):
    contas_sql, contas_par = kpis.filtro_contas()
    base = f"""
        FROM Contas_Pagar cp
        LEFT JOIN Conta_Contabil cc ON cc.Codigo = cp.Conta_Contabil
        WHERE cp.Pago = 'S' AND cp.Data_Exclusao IS NULL AND {contas_sql}
          AND cp.Data_Pagamento >= ? AND cp.Data_Pagamento < ?"""

    cur = conn.cursor()
    cur.execute(f"""
        SELECT cp.Codigo, ISNULL(pe.Nome, '') AS Fornecedor, ISNULL(cc.Descricao, '') AS Conta,
               cp.Data_Emissao, cp.Data_Vencimento, cp.Data_Pagamento, ISNULL(cp.Valor_Pago, 0) AS Valor,
               cp.Conta_Corrente, ISNULL(cp.N_Doc_Merc, '') AS Documento, cp.Parcela,
               LEFT(ISNULL(cp.Observacao, ''), 300) AS Observacao
        FROM Contas_Pagar cp
        LEFT JOIN Conta_Contabil cc ON cc.Codigo = cp.Conta_Contabil
        LEFT JOIN Pessoa pe ON pe.Codigo = cp.Codigo_Fornecedor
        WHERE cp.Pago = 'S' AND cp.Data_Exclusao IS NULL AND {contas_sql}
          AND cp.Data_Pagamento >= ? AND cp.Data_Pagamento < ?""",
        *contas_par, ini, fim)
    atuais = cur.fetchall()

    cur.execute(f"SELECT ISNULL(cc.Descricao, '') AS Conta, SUM(ISNULL(cp.Valor_Pago, 0)) {base} GROUP BY cc.Descricao",
                *contas_par, ini_ant, fim_ant)
    anteriores = cur.fetchall()
    return atuais, anteriores


def calcular(ano, mes):
    p = kpis.periodo(ano, mes)
    ini, fim = p["ini"], p["corte"]
    ini_ant, fim_ant = _mes_anterior(p)

    conn = db.conectar()
    try:
        atuais, anteriores = _consultar(conn, kpis.dt(ini), kpis.dt(fim), kpis.dt(ini_ant), kpis.dt(fim_ant))
    finally:
        db.fechar(conn)

    plano = classificacao.contas()
    contas = {}

    def conta(nome):
        chave = classificacao.normalizar(nome) or "(SEMCONTA)"
        if chave not in contas:
            info = plano.get(chave)
            contas[chave] = {
                "chave": chave,
                "conta": " ".join(nome.split()) or "(sem conta contábil)",
                "plano": info["plano"] if info else NAO_CLASSIFICADOS,
                "grupo": info["grupo"] if info else NAO_CLASSIFICADOS,
                "classificado": bool(info),
                "anterior": 0.0, "atual": 0.0, "qtde": 0,
            }
        return contas[chave]

    lancamentos = []
    for r in atuais:
        c = conta(r.Conta)
        valor = float(r.Valor)
        c["atual"] += valor
        c["qtde"] += 1
        iso = lambda d: d.date().isoformat() if d else None
        lancamentos.append({
            "chave": c["chave"], "codigo": r.Codigo, "fornecedor": " ".join(r.Fornecedor.split()),
            "emissao": iso(r.Data_Emissao), "vencimento": iso(r.Data_Vencimento), "pagamento": iso(r.Data_Pagamento),
            "valor": round(valor, 2), "origem": _origem(r.Conta_Corrente, r.Data_Emissao, r.Data_Pagamento),
            "documento": str(r.Documento).strip(), "parcela": r.Parcela,
            "observacao": " ".join(str(r.Observacao).split()),
        })
    for nome, valor in anteriores:
        conta(nome)["anterior"] += float(valor or 0)

    linhas = [
        {**c, "anterior": round(c["anterior"], 2), "atual": round(c["atual"], 2)}
        for c in contas.values() if c["anterior"] or c["atual"]
    ]
    iso = lambda d: d.isoformat()
    tem_dias = fim > ini
    return {
        "periodo": {
            "ano": ano, "mes": mes, "status": p["status"],
            "dias_decorridos": p["dias_decorridos"], "dias_mes": p["dias_mes"],
            "atual": {"ini": iso(ini), "ate": iso(fim - timedelta(days=1)) if tem_dias else None},
            "anterior": {"ini": iso(ini_ant), "ate": iso(fim_ant - timedelta(days=1)) if fim_ant > ini_ant else None},
        },
        "linhas": linhas,
        "lancamentos": lancamentos,
        "totais": {
            "anterior": round(sum(l["anterior"] for l in linhas), 2),
            "atual": round(sum(l["atual"] for l in linhas), 2),
        },
        "planilha_carregada": bool(plano),
        "atualizado_em": datetime.now().isoformat(timespec="seconds"),
    }
