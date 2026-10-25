"""Provisões: pagamentos previstos lançados à mão (ex.: adiantamento de salário, transferências do CD).

Ficam num SQLite local (o SISMOURA é só leitura). Enquanto pendente, a provisão entra
nas contas previstas do mês da data prevista; marcada como concluída, sai da previsão,
porque o pagamento real já aparece em Contas_Pagar.
"""
import calendar
import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

import config

_trava = threading.Lock()

LIMITES = {"descricao": 120, "categoria": 60, "observacao": 300}


def _conectar():
    Path(config.PROVISOES_DB).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.PROVISOES_DB)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def _sessao():
    """Conexão que grava ao sair sem erro (ou desfaz) e sempre fecha."""
    conn = _conectar()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def iniciar_banco():
    with _trava, _sessao() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS provisoes (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                descricao     TEXT NOT NULL,
                categoria     TEXT NOT NULL DEFAULT '',
                valor         REAL NOT NULL,
                data_prevista TEXT NOT NULL,          -- AAAA-MM-DD
                observacao    TEXT NOT NULL DEFAULT '',
                concluida     INTEGER NOT NULL DEFAULT 0,
                concluida_em  TEXT,
                criado_em     TEXT NOT NULL,
                atualizado_em TEXT NOT NULL
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_provisoes_data ON provisoes (data_prevista)")


def _agora():
    return datetime.now().isoformat(timespec="seconds")


def _mes(ano, mes):
    ini = date(ano, mes, 1)
    return ini, ini + timedelta(days=calendar.monthrange(ano, mes)[1])


def _dict(row):
    d = dict(row)
    d["concluida"] = bool(d["concluida"])
    return d


# ---------- Validação ----------
class ErroValidacao(ValueError):
    pass


def validar(dados, parcial=False):
    """Confere e limpa os campos enviados pela tela. parcial=True aceita só alguns campos."""
    limpo = {}
    for campo in ("descricao", "categoria", "observacao"):
        if campo in dados or (not parcial and campo == "descricao"):
            texto = " ".join(str(dados.get(campo) or "").split())
            if campo == "descricao" and not texto:
                raise ErroValidacao("Informe a descrição.")
            if len(texto) > LIMITES[campo]:
                raise ErroValidacao(f"{campo.capitalize()} pode ter no máximo {LIMITES[campo]} caracteres.")
            limpo[campo] = texto

    if "valor" in dados or not parcial:
        try:
            valor = round(float(dados.get("valor")), 2)
        except (TypeError, ValueError):
            raise ErroValidacao("Valor inválido.")
        if not 0 < valor < 1e9:
            raise ErroValidacao("O valor precisa ser maior que zero.")
        limpo["valor"] = valor

    if "data_prevista" in dados or not parcial:
        try:
            limpo["data_prevista"] = date.fromisoformat(str(dados.get("data_prevista"))).isoformat()
        except ValueError:
            raise ErroValidacao("Data prevista inválida.")

    if "concluida" in dados:
        limpo["concluida"] = 1 if dados["concluida"] else 0
    return limpo


# ---------- Consultas ----------
def listar(ano, mes):
    ini, fim = _mes(ano, mes)
    with _sessao() as conn:
        rows = conn.execute(
            "SELECT * FROM provisoes WHERE data_prevista >= ? AND data_prevista < ? "
            "ORDER BY concluida, data_prevista, descricao",
            (ini.isoformat(), fim.isoformat()),
        ).fetchall()
        categorias = [r[0] for r in conn.execute(
            "SELECT DISTINCT categoria FROM provisoes WHERE categoria <> '' ORDER BY categoria")]
    return [_dict(r) for r in rows], categorias


def total_pendente(ini, fim):
    """Soma e quantidade das provisões pendentes com data prevista em [ini, fim)."""
    with _sessao() as conn:
        total, qtde = conn.execute(
            "SELECT COALESCE(SUM(valor), 0), COUNT(*) FROM provisoes "
            "WHERE concluida = 0 AND data_prevista >= ? AND data_prevista < ?",
            (ini.isoformat(), fim.isoformat()),
        ).fetchone()
    return float(total), int(qtde)


def resumo(ano, mes):
    itens, categorias = listar(ano, mes)
    hoje = date.today().isoformat()
    pendentes = [i for i in itens if not i["concluida"]]
    concluidas = [i for i in itens if i["concluida"]]
    return {
        "periodo": {"ano": ano, "mes": mes},
        "itens": itens,
        "categorias": categorias,
        "totais": {
            "pendente": round(sum(i["valor"] for i in pendentes), 2),
            "qtde_pendente": len(pendentes),
            "concluido": round(sum(i["valor"] for i in concluidas), 2),
            "qtde_concluida": len(concluidas),
            "atrasadas": sum(1 for i in pendentes if i["data_prevista"] < hoje),
        },
        "hoje": hoje,
        "atualizado_em": _agora(),
    }


# ---------- Alterações ----------
def criar(dados):
    campos = validar(dados)
    agora = _agora()
    with _trava, _sessao() as conn:
        cur = conn.execute(
            "INSERT INTO provisoes (descricao, categoria, valor, data_prevista, observacao, criado_em, atualizado_em) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (campos["descricao"], campos.get("categoria", ""), campos["valor"], campos["data_prevista"],
             campos.get("observacao", ""), agora, agora),
        )
        return _dict(conn.execute("SELECT * FROM provisoes WHERE id = ?", (cur.lastrowid,)).fetchone())


def atualizar(id_, dados):
    campos = validar(dados, parcial=True)
    if not campos:
        raise ErroValidacao("Nada para alterar.")
    if "concluida" in campos:
        campos["concluida_em"] = _agora() if campos["concluida"] else None
    campos["atualizado_em"] = _agora()
    sets = ", ".join(f"{c} = ?" for c in campos)
    with _trava, _sessao() as conn:
        cur = conn.execute(f"UPDATE provisoes SET {sets} WHERE id = ?", (*campos.values(), id_))
        if not cur.rowcount:
            return None
        return _dict(conn.execute("SELECT * FROM provisoes WHERE id = ?", (id_,)).fetchone())


def excluir(id_):
    with _trava, _sessao() as conn:
        return conn.execute("DELETE FROM provisoes WHERE id = ?", (id_,)).rowcount > 0


def copiar_mes_anterior(ano, mes):
    """Repete no mês as provisões do mês anterior (mesmo dia, como pendentes).
    Não duplica: pula a que já existe com a mesma descrição e data."""
    ini, fim = _mes(ano, mes)
    ini_ant = (ini - timedelta(days=1)).replace(day=1)
    dias_mes = calendar.monthrange(ano, mes)[1]
    agora = _agora()
    copiadas = 0
    with _trava, _sessao() as conn:
        origem = conn.execute(
            "SELECT * FROM provisoes WHERE data_prevista >= ? AND data_prevista < ? ORDER BY data_prevista",
            (ini_ant.isoformat(), ini.isoformat()),
        ).fetchall()
        for p in origem:
            dia = min(date.fromisoformat(p["data_prevista"]).day, dias_mes)  # 31 -> 30 em meses curtos
            nova_data = date(ano, mes, dia).isoformat()
            existe = conn.execute(
                "SELECT 1 FROM provisoes WHERE descricao = ? AND data_prevista = ?", (p["descricao"], nova_data)
            ).fetchone()
            if existe:
                continue
            conn.execute(
                "INSERT INTO provisoes (descricao, categoria, valor, data_prevista, observacao, criado_em, atualizado_em) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (p["descricao"], p["categoria"], p["valor"], nova_data, p["observacao"], agora, agora),
            )
            copiadas += 1
    return {"copiadas": copiadas, "no_mes_anterior": len(origem)}
