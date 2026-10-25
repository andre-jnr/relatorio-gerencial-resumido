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

app = Flask(__name__)
log = logging.getLogger("relatorio")

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


def _responder(calculo):
    hoje = date.today()
    try:
        ano = int(request.args.get("ano", hoje.year))
        mes = int(request.args.get("mes", hoje.month))
        if not (2000 <= ano <= hoje.year + 1 and 1 <= mes <= 12):
            raise ValueError
    except ValueError:
        return jsonify(erro="Mês ou ano inválido."), 400

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


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if "--dev" in sys.argv:
        app.run(host="127.0.0.1", port=config.PORT, debug=True)
    else:
        from waitress import serve

        log.info("Relatório gerencial em http://%s:%s", config.HOST, config.PORT)
        serve(app, host=config.HOST, port=config.PORT, threads=8)
