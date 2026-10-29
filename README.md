# Relatório gerencial · Morada do Sol

Dashboard com os KPIs de receitas, resultado e pagamentos da loja Morada do Sol, feito para o gerente (Lincoln).
Os dados são consultados ao vivo no SQL Server do SISMOURA, só com leitura.

- **Porta:** 3005 (pode ser alterada pela variável `PORT` no `.env`)
- **Stack:** Python 3.10+ e Flask, servido pelo Waitress no servidor. O banco é acessado pelo `mssql-python`, o driver oficial da Microsoft, que não exige instalar o ODBC Driver.

## Como iniciar (neste computador)

1. Copie `.env.example` para `.env` e preencha a conexão com o banco.
2. Dê dois cliques em **`Iniciar Relatorio.bat`**. Na primeira vez ele instala as dependências.
3. Acesse `http://localhost:3005`. Nesse modo, só este computador tem acesso.

Pelo terminal:

```bash
pip install -r requirements.txt
python app.py              # local: só este computador
python app.py --dev        # local, com recarga automática ao editar o código
python app.py --producao   # servidor: Waitress em 0.0.0.0, acessível pela rede
```

Se a porta já estiver em uso, o sistema não sobe e sai com o código 3.

## Publicar no servidor (Windows)

1. Copie a pasta do projeto para o servidor, incluindo `dados/classificacao_pagamentos.xlsx`, que fica fora do Git.
2. Tenha o Python 3.10 ou mais novo instalado. No instalador do python.org, marque "Add python.exe to PATH".
3. Crie o `.env` a partir do `.env.example`.
4. Clique duas vezes em `servidor\instalar.bat` e confirme o pedido de administrador.

O sistema sobe sozinho ao ligar o computador, pela tarefa agendada "Relatorio gerencial Lincoln (3005)", e reinicia se cair.
O acesso fica em `http://NOME-DO-SERVIDOR:3005`, e o log em `logs\servidor.log`.

- **Para atualizar:** copie os arquivos novos e rode o `instalar.bat` de novo. Não sobrescreva a pasta `dados/` do servidor, porque nela estão as provisões lançadas.
- **Para remover:** rode `servidor\desinstalar.bat`. Ele não apaga dados.
- **Backup:** inclua `dados/provisoes.db` no backup do servidor.

## Período

O filtro escolhe **mês** e **ano**, e o período escolhido vale para todas as abas (Visão geral, Pagamentos e Provisões).

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
| Provisões pendentes | Provisões não concluídas com data prevista no mês (aba Provisões) |
| Contas previstas | Pagas + vencidas + a pagar + provisões pendentes |

**Resultado geral**

| Card | Cálculo |
| --- | --- |
| Contas previstas | Mesmo valor acima |
| Previsão de faturamento + transferências | Projeção de faturamento + transferências enviadas |
| Bonificações | `SUM(Entrada_Produto_Itens.Valor_Total)` dos itens com CFOP em `BONIF_CFOPS` (1.910 e 2.910), pela data de entrada da nota, do dia 1 até D-1. É informativo e não entra no resultado |
| Resultado (previsão) | Previsão de faturamento + transferências − contas previstas |
| Previsão do resultado | Resultado (previsão) ÷ previsão de faturamento + transferências |
| Pagamentos próximo mês | Em aberto, com vencimento no mês seguinte, + provisões pendentes do mês seguinte |

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

## Aba Provisões

Serve para lançar pagamentos quase fixos que só entram no SISMOURA no dia em que são pagos, como o adiantamento salarial do dia 20 e as transferências do CD. Assim eles já aparecem na previsão de resultado.

Cada provisão tem descrição, categoria (com sugestões das categorias já usadas), valor, data prevista e uma observação opcional.

| Situação | Efeito nos KPIs |
| --- | --- |
| **Pendente**, com data prevista no mês | Soma no card "Provisões pendentes" e em **Contas previstas**, portanto entra no resultado previsto |
| **Pendente**, com data prevista no mês seguinte | Soma em **Pagamentos próximo mês** |
| **Concluída** | Sai da previsão, porque o pagamento real já está em Contas pagas |

- Marque a caixa da provisão quando o pagamento real for lançado no sistema. Desmarcar coloca o valor de volta na previsão.
- Provisões pendentes com data passada aparecem como **atrasadas**, para lembrar de conferir se já foram pagas.
- **Copiar do mês anterior** repete no mês selecionado as provisões do mês anterior, no mesmo dia e como pendentes. Ele não duplica as que já existem com a mesma descrição e data.
- Excluir pede um segundo clique de confirmação, e a exclusão é definitiva.
- As provisões ficam em `dados/provisoes.db` (SQLite), fora do Git. Inclua esse arquivo no backup do servidor.
- Qualquer pessoa que acesse o relatório pela rede pode lançar e alterar provisões.

## Estrutura

```
app.py              servidor Flask (páginas + /api/kpis e /api/pagamentos ?ano=&mes=)
kpis.py             consultas e cálculo dos KPIs (Visão geral)
pagamentos.py       consultas da aba Pagamentos (plano de contas e lançamentos)
classificacao.py    leitura da planilha do plano de contas
provisoes.py        provisões (SQLite local): cadastro, conclusão e cópia do mês anterior
db.py               conexão somente leitura com o SQL Server
config.py           leitura do .env
dados/              planilha do plano de contas e banco das provisões (fora do Git)
templates/          base.html (topo, abas, filtros) + uma página por aba
static/js/comum.js  filtros, tema, formatação e carregamento compartilhados
static/js/app.js    cards da Visão geral
static/js/pagamentos.js  matriz da aba Pagamentos
static/js/provisoes.js   formulário e lista da aba Provisões
static/css/         style.css (geral), pagamentos.css e provisoes.css
.env.example        variáveis necessárias (sem valores reais)
Iniciar Relatorio.bat    atalho para rodar neste computador
servidor/           publicação no servidor Windows (config.ps1 é o único que muda entre sistemas)
logs/               log do servidor (criado na instalação, fora do Git)
```

## Segurança

- Credenciais e regras ficam no `.env`, que está no `.gitignore`.
- A conexão roda em `READ UNCOMMITTED` e termina com rollback: o sistema nunca grava no banco e não trava o PDV.
- O relatório tem informação sensível, então mantenha o acesso restrito à rede interna.
