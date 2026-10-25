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

app = Flask(__name__)
log = logging.getLogger("relatorio")

_cache = {}
_trava = threading.Lock()


def _kpis_com_cache(ano, mes, forcar):
    chave = (ano, mes)
    agora = time.time()
    with _trava:
        item = _cache.get(chave)
        if item and not forcar and agora - item[0] < config.CACHE_MINUTOS * 60:
            return item[1]
    dados = kpis.calcular(ano, mes)
    with _trava:
        _cache[chave] = (agora, dados)
    return dados


@app.get("/")
def index():
    hoje = date.today()
    return render_template(
        "index.html",
        loja=config.LOJA_NOME,
        gerente=config.GERENTE_NOME,
        ano_atual=hoje.year,
        mes_atual=hoje.month,
    )


@app.get("/api/kpis")
def api_kpis():
    hoje = date.today()
    try:
        ano = int(request.args.get("ano", hoje.year))
        mes = int(request.args.get("mes", hoje.month))
        if not (2000 <= ano <= hoje.year + 1 and 1 <= mes <= 12):
            raise ValueError
    except ValueError:
        return jsonify(erro="Mês ou ano inválido."), 400

    try:
        return jsonify(_kpis_com_cache(ano, mes, request.args.get("atualizar") == "1"))
    except Exception:
        log.exception("Falha ao consultar o banco")
        return jsonify(erro="Não foi possível consultar o banco da loja. Tente novamente em instantes."), 502


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if "--dev" in sys.argv:
        app.run(host="127.0.0.1", port=config.PORT, debug=True)
    else:
        from waitress import serve

        log.info("Relatório gerencial em http://%s:%s", config.HOST, config.PORT)
        serve(app, host=config.HOST, port=config.PORT, threads=8)
