"""Acesso SOMENTE LEITURA ao SQL Server (SISMOURA).

Usa o mssql-python (driver oficial da Microsoft): tem pacote pronto para qualquer
versão do Python e dispensa instalar o ODBC Driver no servidor.
"""
import mssql_python

import config


def _escapar(valor):
    # valores com ; ou } precisam ir entre chaves na connection string
    return "{" + valor.replace("}", "}}") + "}"


def conectar():
    cs = (
        f"Server={config.DB_SERVER};Database={config.DB_DATABASE};"
        f"UID={_escapar(config.DB_USER)};PWD={_escapar(config.DB_PASSWORD)};"
        "Encrypt=yes;TrustServerCertificate=yes;"
    )
    conn = mssql_python.connect(cs, timeout=config.DB_TIMEOUT, autocommit=False)
    conn.timeout = 300  # timeout de execução de cada consulta (s)
    cur = conn.cursor()
    cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")  # não trava o PDV
    return conn


def valor(conn, sql, params=()):
    """Executa uma consulta que devolve um único número."""
    cur = conn.cursor()
    cur.execute(sql, *params)
    row = cur.fetchone()
    return float(row[0] or 0) if row else 0.0


def fechar(conn):
    try:
        conn.rollback()  # nada é gravado
    finally:
        conn.close()
