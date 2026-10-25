"""Configuração lida do .env (nada sensível fica no código)."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env", encoding="utf-8")


def _lista(nome):
    return [x.strip() for x in os.getenv(nome, "").split(";") if x.strip()]


DB_DRIVER = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")
DB_SERVER = os.getenv("DB_SERVER", "")
DB_DATABASE = os.getenv("DB_DATABASE", "")
DB_USER = os.getenv("DB_USER", "")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_TIMEOUT = int(os.getenv("DB_TIMEOUT", "60"))

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "3005"))
CACHE_MINUTOS = float(os.getenv("CACHE_MINUTOS", "5"))

LOJA_NOME = os.getenv("LOJA_NOME", "Morada do Sol")
GERENTE_NOME = os.getenv("GERENTE_NOME", "")
TRANSF_CFOPS = _lista("TRANSF_CFOPS") or ["5.152", "5.409", "5.557", "5.552"]
CONTAS_EXCLUIDAS = _lista("CONTAS_EXCLUIDAS")
