# Relatório gerencial · Morada do Sol

Dashboard com os KPIs de receitas, resultado e pagamentos da loja Morada do Sol, feito para o gerente (Lincoln).
Os dados são consultados ao vivo no SQL Server do SISMOURA, só com leitura.

- **Porta:** 3005 (pode ser alterada pela variável `PORT` no `.env`)
- **Stack:** Python 3 + Flask, servido pelo Waitress · pyodbc (ODBC Driver 17 for SQL Server)

## Como iniciar

1. Copie `.env.example` para `.env` e preencha a conexão com o banco.
2. Dê dois cliques em **`Iniciar Relatorio.bat`**. Na primeira vez ele instala as dependências.
3. Acesse `http://localhost:3005`. Outras máquinas da rede acessam por `http://NOME_DO_SERVIDOR:3005`.

Pelo terminal:

```bash
pip install -r requirements.txt
python app.py          # produção (Waitress, 0.0.0.0:3005)
python app.py --dev    # desenvolvimento (Flask com recarga automática, só localhost)
```

## Período

O filtro escolhe **mês** e **ano**, e o período escolhido vale para as duas abas (Visão geral e Pagamentos).

| Mês selecionado | Dados considerados |
| --- | --- |
| Mês em andamento | Do dia 1 até **ontem (D-1)** |
| Mês fechado | O mês inteiro |
| Mês futuro | Sem vendas; mostra só as contas em aberto |

Cada mês fica 5 minutos em cache (`CACHE_MINUTOS`). O botão de atualizar consulta o banco de novo.

## KPIs

**Receitas**

| Card | Cálculo |
| --- | --- |
| Venda do dia anterior | `SUM(Venda.Valor_Final)` do último dia fechado (`Cancelada = 'N'`) |
| Venda do período | Vendas do dia 1 até D-1 |
| Transferências enviadas | `SUM(Fiscal_NF.Total_NF)` com NFe `AUTORIZADA` e CFOP em `TRANSF_CFOPS` |
| Faturamento total | Venda do período + transferências |
| Projeção de faturamento | (Venda do período ÷ dias decorridos) × dias do mês |

**Resultado do período**

| Card | Cálculo |
| --- | --- |
| Contas pagas do período | `SUM(Contas_Pagar.Valor_Pago)` por `Data_Pagamento`, do dia 1 até D-1 |
| Faturamento do período | Faturamento total |
| Resultado do período | Faturamento − contas pagas |
| Lucratividade do período | Resultado ÷ faturamento |

**Pagamentos**

| Card | Cálculo |
| --- | --- |
| Contas pagas | Igual a "Contas pagas do período" |
| Contas vencidas | Em aberto, com vencimento no mês e antes de hoje. A legenda mostra as vencidas de meses anteriores |
| Contas a pagar do mês | Em aberto, com vencimento de hoje até o fim do mês |
| Contas previstas | Pagas + vencidas + a pagar |

**Resultado geral**

| Card | Cálculo |
| --- | --- |
| Contas previstas | Mesmo valor acima |
| Previsão de faturamento + transferências | Projeção de faturamento + transferências enviadas |
| Resultado (previsão) | Previsão de faturamento + transferências − contas previstas |
| Previsão do resultado | Resultado (previsão) ÷ previsão de faturamento + transferências |
| Pagamentos próximo mês | Em aberto, com vencimento no mês seguinte |

Todas as contas a pagar ignoram títulos excluídos (`Data_Exclusao`) e as contas contábeis listadas em `CONTAS_EXCLUIDAS`, com as mesmas regras do Painel Gerencial.
A comparação dos nomes ignora acentos, maiúsculas e espaços.

## Aba Pagamentos

Mostra as contas pagas no período numa matriz **plano de contas → grupo → conta contábil**, comparada com o mesmo intervalo do mês anterior. O total é igual ao card "Contas pagas" da Visão geral.

| Mês selecionado | Comparação |
| --- | --- |
| Mês fechado | Mês inteiro × mês anterior inteiro |
| Mês em andamento | Dia 1 até D-1 × mês anterior do dia 1 até o mesmo dia |

- No topo ficam o pago no período, o pago no mês anterior, a variação e o maior grupo. Abaixo, uma barra mostra quanto cada plano de contas representa do total.
- As colunas da matriz são: mês anterior, mês selecionado, diferença em R$, variação em % e participação no total. Clique no título de uma coluna para ordenar por ela. Aumento de pagamento aparece em vermelho e redução em verde.
- Clicar na seta de uma **conta** mostra os lançamentos dela: fornecedor, documento, emissão, vencimento, pagamento, origem (mesmo mês, meses anteriores ou transferência) e valor.
- A busca procura em conta, grupo, plano de contas e fornecedor, sem diferenciar acentos nem maiúsculas.
- A chave **Plano de contas** tira esse nível da matriz, que passa a ser grupo → conta.

### Planilha do plano de contas

O plano e o grupo de cada conta vêm de `dados/classificacao_pagamentos.xlsx`, uma cópia da planilha do Painel Gerencial. O caminho pode ser trocado em `PLANILHA_CLASSIFICACAO`.

- As colunas usadas são `PAGAMENTOS` (nome da conta contábil), `GRUPO` e `PLANO DE CONTAS`.
- A planilha é relida sozinha quando o arquivo muda, sem reiniciar o servidor.
- Conta paga que não estiver na planilha aparece em **Pagamentos não classificados**, marcada como "sem classificação". Para corrigir, inclua a conta na planilha.
- A planilha tem dados internos, então fica fora do Git (`dados/*.xlsx`). Ao clonar o projeto, copie a planilha para `dados/`.

## Estrutura

```
app.py              servidor Flask (páginas + /api/kpis e /api/pagamentos ?ano=&mes=)
kpis.py             consultas e cálculo dos KPIs (Visão geral)
pagamentos.py       consultas da aba Pagamentos (plano de contas e lançamentos)
classificacao.py    leitura da planilha do plano de contas
db.py               conexão somente leitura com o SQL Server
config.py           leitura do .env
dados/              planilha do plano de contas (fora do Git)
templates/          base.html (topo, abas, filtros) + uma página por aba
static/js/comum.js  filtros, tema, formatação e carregamento compartilhados
static/js/app.js    cards da Visão geral
static/js/pagamentos.js  matriz da aba Pagamentos
static/css/         style.css (geral) e pagamentos.css
.env.example        variáveis necessárias (sem valores reais)
Iniciar Relatorio.bat
```

## Segurança

- Credenciais e regras ficam no `.env`, que está no `.gitignore`.
- A conexão roda em `READ UNCOMMITTED` e termina com rollback: o sistema nunca grava no banco e não trava o PDV.
- O relatório tem informação sensível, então mantenha o acesso restrito à rede interna.
