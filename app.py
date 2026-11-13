"""Relatório gerencial da Morada do Sol (Lincoln).

Local:     python app.py              (só este computador; --dev liga a recarga automática)
Servidor:  python app.py --producao   (Waitress em 0.0.0.0, acessível pela rede)
"""
import logging
import secrets
import socket
import sys
import threading
import time
from datetime import date, timedelta

from flask import Flask, g, jsonify, redirect, render_template, request, session, url_for

import config
import kpis
import pagamentos
import provisoes
import usuarios

app = Flask(__name__)
log = logging.getLogger("relatorio")
provisoes.iniciar_banco()
usuarios.iniciar_banco()

if not config.SECRET_KEY:
    log.warning("SECRET_KEY não definida no .env: as sessões caem a cada reinício do servidor.")
app.config.update(
    SECRET_KEY=config.SECRET_KEY or secrets.token_hex(32),
    SESSION_COOKIE_NAME="gerencial_sessao",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=config.SESSAO_HORAS),
)


# ---------- Login ----------
TENTATIVAS_MAX = 5
BLOQUEIO_SEG = 15 * 60
_falhas = {}  # ip -> [horários das falhas recentes]
_trava_falhas = threading.Lock()

ROTAS_LIVRES = {"login", "static"}


def _bloqueado(ip):
    agora = time.time()
    with _trava_falhas:
        recentes = [t for t in _falhas.get(ip, []) if agora - t < BLOQUEIO_SEG]
        _falhas[ip] = recentes
        return len(recentes) >= TENTATIVAS_MAX


def _registrar_falha(ip):
    with _trava_falhas:
        _falhas.setdefault(ip, []).append(time.time())


def _destino_seguro(destino):
    # só caminhos deste site (evita redirecionar para outro endereço)
    return destino if destino and destino.startswith("/") and not destino.startswith("//") else url_for("index")


@app.before_request
def exigir_login():
    if request.endpoint in ROTAS_LIVRES:
        return None
    usuario = usuarios.buscar(session["usuario_id"]) if "usuario_id" in session else None
    if not usuario:
        session.clear()
        if request.path.startswith("/api/"):
            return jsonify(erro="Sua sessão expirou. Entre de novo."), 401
        return redirect(url_for("login", proximo=request.full_path.rstrip("?")))
    g.usuario = usuario
    return None


@app.route("/login", methods=["GET", "POST"])
def login():
    erro = None
    login_digitado = ""
    if request.method == "POST":
        ip = request.remote_addr or "?"
        login_digitado = request.form.get("login", "").strip()
        if _bloqueado(ip):
            erro = "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo."
        else:
            usuario = usuarios.autenticar(login_digitado, request.form.get("senha", ""))
            if usuario:
                session.clear()
                session.permanent = True
                session["usuario_id"] = usuario["id"]
                log.info("Login de '%s' a partir de %s", usuario["login"], ip)
                return redirect(_destino_seguro(request.form.get("proximo")))
            _registrar_falha(ip)
            log.warning("Login recusado para '%s' a partir de %s", login_digitado, ip)
            erro = "Usuário ou senha incorretos."
    elif "usuario_id" in session and usuarios.buscar(session["usuario_id"]):
        return redirect(url_for("index"))

    return render_template(
        "login.html",
        loja=config.LOJA_NOME,
        erro=erro,
        login_digitado=login_digitado,
        proximo=request.values.get("proximo", ""),
        sem_usuarios=not usuarios.existe_algum(),
    ), (401 if erro else 200)


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

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
        usuario=g.usuario,
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


# ---------- Usuários (só superusuário) ----------
@app.get("/usuarios")
def pagina_usuarios():
    if not g.usuario["admin"]:
        return redirect(url_for("index"))
    return _pagina("usuarios.html", "usuarios")


def _so_admin(funcao):
    """Executa a ação da API se quem pediu é superusuário; erros de cadastro viram 400."""
    if not g.usuario["admin"]:
        return jsonify(erro="Só o superusuário pode gerenciar usuários."), 403
    try:
        return funcao()
    except usuarios.ErroUsuario as e:
        return jsonify(erro=str(e)), 400


def _dados_usuario():
    d = request.get_json(silent=True) or {}
    return {c: d[c] for c in ("nome", "login", "senha", "admin") if c in d}


@app.get("/api/usuarios")
def api_usuarios():
    return _so_admin(lambda: jsonify(usuarios=usuarios.listar(), eu=g.usuario["id"]))


@app.post("/api/usuarios")
def api_usuarios_criar():
    def criar():
        d = _dados_usuario()
        id_ = usuarios.criar(d.get("login"), d.get("nome"), d.get("senha"), bool(d.get("admin")))
        log.info("'%s' criou o usuário '%s'", g.usuario["login"], d.get("login"))
        return jsonify(id=id_), 201
    return _so_admin(criar)


@app.patch("/api/usuarios/<int:id_>")
def api_usuarios_alterar(id_):
    def alterar():
        d = _dados_usuario()
        if "admin" in d:
            d["admin"] = bool(d["admin"])
        if not usuarios.atualizar(id_, g.usuario["id"], **d):
            return jsonify(erro="Usuário não encontrado."), 404
        log.info("'%s' alterou o usuário %s (%s)", g.usuario["login"], id_, ", ".join(sorted(d)))
        return jsonify(ok=True)
    return _so_admin(alterar)


@app.delete("/api/usuarios/<int:id_>")
def api_usuarios_excluir(id_):
    def excluir():
        if not usuarios.remover(id_, g.usuario["id"]):
            return jsonify(erro="Usuário não encontrado."), 404
        log.info("'%s' excluiu o usuário %s", g.usuario["login"], id_)
        return "", 204
    return _so_admin(excluir)


PORTA_OCUPADA = 3  # código de saída usado por servidor/iniciar.ps1 para não ficar tentando de novo


def porta_em_uso(porta):
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", porta)) == 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if porta_em_uso(config.PORT):
        print(f"ERRO: a porta {config.PORT} já está em uso.", file=sys.stderr)
        sys.exit(PORTA_OCUPADA)
    if "--producao" in sys.argv:
        from waitress import serve

        log.info("Escutando na rede: http://%s:%s", socket.gethostname(), config.PORT)
        serve(app, host="0.0.0.0", port=config.PORT, threads=8)
    else:
        app.run(host="127.0.0.1", port=config.PORT, debug="--dev" in sys.argv)
