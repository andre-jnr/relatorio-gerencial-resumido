"""Relatório gerencial da Morada do Sol (Lincoln).

Desenvolvimento:  python app.py --dev
Produção:         python app.py            (Waitress, acessível pela rede)
"""
import logging
import sys
import threading
import time
from datetime import date

from flask import Flask, jsonify, render_template, request

import config
import kpis
import pagamentos
import provisoes

app = Flask(__name__)
log = logging.getLogger("relatorio")
provisoes.iniciar_banco()

_cache = {}
_trava = threading.Lock()


def _com_cache(calculo, ano, mes, forcar):
    chave = (calculo.__module__, ano, mes)
    agora = time.time()
    with _trava:
        item = _cache.get(chave)
        if item and not forcar and agora - item[0] < config.CACHE_MINUTOS * 60:
            return item[1]
    dados = calculo(ano, mes)
    with _trava:
        _cache[chave] = (agora, dados)
    return dados


def _pagina(template, aba):
    hoje = date.today()
    return render_template(
        template,
        aba=aba,
        loja=config.LOJA_NOME,
        gerente=config.GERENTE_NOME,
        ano_atual=hoje.year,
        mes_atual=hoje.month,
    )


@app.get("/")
def index():
    return _pagina("index.html", "visao")


@app.get("/pagamentos")
def pagina_pagamentos():
    return _pagina("pagamentos.html", "pagamentos")


@app.get("/provisoes")
def pagina_provisoes():
    return _pagina("provisoes.html", "provisoes")


def _ano_mes(origem):
    """(ano, mes) validados, ou None."""
    hoje = date.today()
    try:
        ano = int(origem.get("ano", hoje.year))
        mes = int(origem.get("mes", hoje.month))
    except (TypeError, ValueError):
        return None
    return (ano, mes) if 2000 <= ano <= hoje.year + 1 and 1 <= mes <= 12 else None


def _responder(calculo):
    periodo = _ano_mes(request.args)
    if not periodo:
        return jsonify(erro="Mês ou ano inválido."), 400
    ano, mes = periodo

    try:
        return jsonify(_com_cache(calculo, ano, mes, request.args.get("atualizar") == "1"))
    except Exception:
        log.exception("Falha ao consultar o banco")
        return jsonify(erro="Não foi possível consultar o banco da loja. Tente novamente em instantes."), 502


@app.get("/api/kpis")
def api_kpis():
    return _responder(kpis.calcular)


@app.get("/api/pagamentos")
def api_pagamentos():
    return _responder(pagamentos.calcular)


# ---------- Provisões (SQLite local) ----------
def _limpar_cache_kpis():
    # os KPIs somam as provisões pendentes: depois de mudar uma, recalcula
    with _trava:
        for chave in [c for c in _cache if c[0] == kpis.calcular.__module__]:
            del _cache[chave]


def _alteracao(funcao):
    try:
        resposta = funcao()
    except provisoes.ErroValidacao as e:
        return jsonify(erro=str(e)), 400
    _limpar_cache_kpis()
    return resposta


@app.get("/api/provisoes")
def api_provisoes():
    periodo = _ano_mes(request.args)
    if not periodo:
        return jsonify(erro="Mês ou ano inválido."), 400
    return jsonify(provisoes.resumo(*periodo))


@app.post("/api/provisoes")
def api_provisoes_criar():
    return _alteracao(lambda: (jsonify(provisoes.criar(request.get_json(silent=True) or {})), 201))


@app.patch("/api/provisoes/<int:id_>")
def api_provisoes_alterar(id_):
    def alterar():
        item = provisoes.atualizar(id_, request.get_json(silent=True) or {})
        return jsonify(item) if item else (jsonify(erro="Provisão não encontrada."), 404)
    return _alteracao(alterar)


@app.delete("/api/provisoes/<int:id_>")
def api_provisoes_excluir(id_):
    return _alteracao(lambda: ("", 204) if provisoes.excluir(id_) else (jsonify(erro="Provisão não encontrada."), 404))


@app.post("/api/provisoes/copiar")
def api_provisoes_copiar():
    periodo = _ano_mes(request.get_json(silent=True) or {})
    if not periodo:
        return jsonify(erro="Mês ou ano inválido."), 400
    return _alteracao(lambda: jsonify(provisoes.copiar_mes_anterior(*periodo)))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if "--dev" in sys.argv:
        app.run(host="127.0.0.1", port=config.PORT, debug=True)
    else:
        from waitress import serve

        log.info("Relatório gerencial em http://%s:%s", config.HOST, config.PORT)
        serve(app, host=config.HOST, port=config.PORT, threads=8)
