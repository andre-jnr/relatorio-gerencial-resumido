"""Configuração lida do .env (nada sensível fica no código)."""
import os
from pathlib import Path

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent
load_dotenv(RAIZ / ".env", encoding="utf-8")


def _lista(nome):
    return [x.strip() for x in os.getenv(nome, "").split(";") if x.strip()]


DB_SERVER = os.getenv("DB_SERVER", "")
DB_DATABASE = os.getenv("DB_DATABASE", "")
DB_USER = os.getenv("DB_USER", "")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_TIMEOUT = int(os.getenv("DB_TIMEOUT", "60"))

PORT = int(os.getenv("PORT", "3005"))
CACHE_MINUTOS = float(os.getenv("CACHE_MINUTOS", "5"))

# Login: SECRET_KEY assina o cookie da sessão (sem ela, todos saem a cada reinício do servidor)
SECRET_KEY = os.getenv("SECRET_KEY", "")
SESSAO_HORAS = float(os.getenv("SESSAO_HORAS", "12"))

LOJA_NOME = os.getenv("LOJA_NOME", "Morada do Sol")
TRANSF_CFOPS = _lista("TRANSF_CFOPS") or ["5.152", "5.409", "5.557", "5.552"]
BONIF_CFOPS = _lista("BONIF_CFOPS") or ["1.910", "2.910"]
CONTAS_EXCLUIDAS = _lista("CONTAS_EXCLUIDAS")


def _codigos(nome):
    """Lista de códigos numéricos (separados por ;). Um valor inválido impede o sistema de subir."""
    try:
        return [int(x) for x in _lista(nome)]
    except ValueError:
        raise SystemExit(f"ERRO no .env: {nome} aceita só números separados por ; (ex.: 90097;91105)")


# Lançamentos de Contas_Pagar (Codigo) e fornecedores (Codigo_Fornecedor) fora dos pagamentos.
# Os códigos são de cada banco: valem só para a loja configurada neste .env.
LANCAMENTOS_IGNORADOS = _codigos("LANCAMENTOS_IGNORADOS")
FORNECEDORES_IGNORADOS = _codigos("FORNECEDORES_IGNORADOS")
# caminho relativo é a partir da pasta do projeto
PLANILHA_CLASSIFICACAO = str(RAIZ / os.getenv("PLANILHA_CLASSIFICACAO", "dados/classificacao_pagamentos.xlsx"))
PROVISOES_DB = str(RAIZ / os.getenv("PROVISOES_DB", "dados/provisoes.db"))
USUARIOS_DB = str(RAIZ / os.getenv("USUARIOS_DB", "dados/usuarios.db"))
