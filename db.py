"""Acesso SOMENTE LEITURA ao SQL Server (SISMOURA)."""
import pyodbc

import config


def _escapar(valor):
    # valores com ; ou } precisam ir entre chaves na connection string ODBC
    return "{" + valor.replace("}", "}}") + "}"


def conectar():
    cs = (
        f"DRIVER={{{config.DB_DRIVER}}};SERVER={config.DB_SERVER};DATABASE={config.DB_DATABASE};"
        f"UID={_escapar(config.DB_USER)};PWD={_escapar(config.DB_PASSWORD)};"
        "APP=RelatorioGerencialLincoln;"
    )
    conn = pyodbc.connect(cs, timeout=config.DB_TIMEOUT, autocommit=False)
    conn.timeout = 300  # timeout de execução de cada consulta (s)
    cur = conn.cursor()
    cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")  # não trava o PDV
    return conn


def valor(conn, sql, params=()):
    """Executa uma consulta que devolve um único número."""
    row = conn.cursor().execute(sql, params).fetchone()
    return float(row[0] or 0) if row else 0.0


def fechar(conn):
    try:
        conn.rollback()  # nada é gravado
    finally:
        conn.close()
