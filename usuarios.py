"""Usuários do relatório (SQLite local, senha só em hash).

Cadastro pelo terminal, na pasta do projeto (no servidor, use o Python do .venv):
  python usuarios.py criar             pede login, nome e senha
  python usuarios.py senha <login>     troca a senha
  python usuarios.py listar
  python usuarios.py remover <login>
"""
import getpass
import sqlite3
import sys
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from werkzeug.security import check_password_hash, generate_password_hash

import config

SENHA_MINIMA = 8
# comparado quando o login não existe, para a resposta levar o mesmo tempo
_HASH_FALSO = generate_password_hash("senha-que-nao-existe")


@contextmanager
def _sessao():
    Path(config.USUARIOS_DB).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.USUARIOS_DB)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def iniciar_banco():
    with _sessao() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS usuarios (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                login        TEXT NOT NULL UNIQUE COLLATE NOCASE,
                nome         TEXT NOT NULL,
                senha_hash   TEXT NOT NULL,
                criado_em    TEXT NOT NULL,
                ultimo_login TEXT
            )""")


def _agora():
    return datetime.now().isoformat(timespec="seconds")


def existe_algum():
    with _sessao() as conn:
        return conn.execute("SELECT 1 FROM usuarios LIMIT 1").fetchone() is not None


def autenticar(login, senha):
    """Devolve {id, login, nome} se login e senha conferem; senão None."""
    with _sessao() as conn:
        u = conn.execute("SELECT * FROM usuarios WHERE login = ?", ((login or "").strip(),)).fetchone()
        if not u:
            check_password_hash(_HASH_FALSO, senha or "")
            return None
        if not check_password_hash(u["senha_hash"], senha or ""):
            return None
        conn.execute("UPDATE usuarios SET ultimo_login = ? WHERE id = ?", (_agora(), u["id"]))
        return {"id": u["id"], "login": u["login"], "nome": u["nome"]}


def buscar(id_):
    with _sessao() as conn:
        u = conn.execute("SELECT id, login, nome FROM usuarios WHERE id = ?", (id_,)).fetchone()
    return dict(u) if u else None


# ---------- Terminal ----------
def _pedir_senha():
    while True:
        senha = getpass.getpass(f"Senha (mínimo {SENHA_MINIMA} caracteres): ")
        if len(senha) < SENHA_MINIMA:
            print(f"  A senha precisa ter pelo menos {SENHA_MINIMA} caracteres.")
            continue
        if getpass.getpass("Repita a senha: ") != senha:
            print("  As senhas não conferem.")
            continue
        return senha


def _criar():
    login = input("Login (ex.: lincoln): ").strip()
    nome = " ".join(input("Nome exibido no painel (ex.: Lincoln): ").split())
    if not login or not nome or " " in login:
        sys.exit("ERRO: informe login (sem espaços) e nome.")
    senha = _pedir_senha()
    try:
        with _sessao() as conn:
            conn.execute(
                "INSERT INTO usuarios (login, nome, senha_hash, criado_em) VALUES (?, ?, ?, ?)",
                (login, nome, generate_password_hash(senha), _agora()),
            )
    except sqlite3.IntegrityError:
        sys.exit(f"ERRO: o login '{login}' já existe.")
    print(f"Usuário '{login}' criado.")


def _trocar_senha(login):
    senha = _pedir_senha()
    with _sessao() as conn:
        n = conn.execute("UPDATE usuarios SET senha_hash = ? WHERE login = ?",
                         (generate_password_hash(senha), login)).rowcount
    print("Senha alterada." if n else f"ERRO: login '{login}' não encontrado.")


def _listar():
    with _sessao() as conn:
        linhas = conn.execute("SELECT login, nome, criado_em, ultimo_login FROM usuarios ORDER BY login").fetchall()
    if not linhas:
        print("Nenhum usuário cadastrado. Crie com: python usuarios.py criar")
    for u in linhas:
        print(f"{u['login']:<20} {u['nome']:<30} último acesso: {u['ultimo_login'] or 'nunca'}")


def _remover(login):
    if input(f"Remover o usuário '{login}'? Digite SIM para confirmar: ").strip() != "SIM":
        sys.exit("Cancelado.")
    with _sessao() as conn:
        n = conn.execute("DELETE FROM usuarios WHERE login = ?", (login,)).rowcount
    print("Usuário removido." if n else f"ERRO: login '{login}' não encontrado.")


if __name__ == "__main__":
    iniciar_banco()
    args = sys.argv[1:]
    comando = args[0] if args else ""
    if comando == "criar":
        _criar()
    elif comando == "senha" and len(args) == 2:
        _trocar_senha(args[1])
    elif comando == "listar":
        _listar()
    elif comando == "remover" and len(args) == 2:
        _remover(args[1])
    else:
        print(__doc__)
