# Relatório gerencial · Morada do Sol

Dashboard com os KPIs de receitas, resultado e pagamentos da loja Morada do Sol, feito para o gerente (Lincoln).
Os dados são consultados ao vivo no SQL Server do SISMOURA, só com leitura.

- **Porta:** 3005 (pode ser alterada pela variável `PORT` no `.env`)
- **Stack:** Python 3.10+ e Flask, servido pelo Waitress no servidor. O banco é acessado pelo `mssql-python`, o driver oficial da Microsoft, que não exige instalar o ODBC Driver.

## Como iniciar (neste computador)

1. Copie `.env.example` para `.env`, preencha a conexão com o banco e gere a `SECRET_KEY` (o comando está no próprio arquivo).
2. Crie seu usuário: `python usuarios.py criar` (veja [Login](#login)).
3. Dê dois cliques em **`Iniciar Relatorio.bat`**. Na primeira vez ele instala as dependências.
4. Acesse `http://localhost:3005` e entre com seu login. Nesse modo, só este computador tem acesso.

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
3. Crie o `.env` a partir do `.env.example`, com uma `SECRET_KEY` nova.
4. Clique duas vezes em `servidor\instalar.bat` e confirme o pedido de administrador.
5. Crie o primeiro superusuário com o Python do `.venv`, na pasta do sistema: `.venv\Scripts\python.exe usuarios.py criar --admin`. Os outros usuários ele cadastra pela aba **Usuários**.

O sistema sobe sozinho ao ligar o computador, pela tarefa agendada "Relatorio gerencial Lincoln (3005)", e reinicia se cair.
O acesso fica em `http://NOME-DO-SERVIDOR:3005`, e o log em `logs\servidor.log`.

- **Para atualizar:** copie os arquivos novos e rode o `instalar.bat` de novo. Não sobrescreva a pasta `dados/` do servidor, porque nela estão as provisões lançadas e os usuários.
- **Para remover:** rode `servidor\desinstalar.bat`. Ele não apaga dados.
- **Backup:** inclua `dados/provisoes.db` e `dados/usuarios.db` no backup do servidor.

## Login

Todas as páginas e a API exigem login. O nome do usuário aparece no topo do painel ("Relatório gerencial · Lincoln"), e o botão de saída fica ao lado dos filtros.

Os usuários ficam em `dados/usuarios.db` (SQLite, fora do Git). A senha é guardada só em hash, nunca em texto.

### Aba Usuários (só superusuário)

A aba só aparece para superusuários. A página e a API recusam qualquer outro usuário, mesmo que ele digite o endereço direto.

- **Cadastrar:** informe o nome (o login é sugerido a partir dele, ex.: "Maria José Silva" vira `maria.jose`), a senha de 6 dígitos (o botão **Gerar** cria uma aleatória) e o tipo de acesso. Depois de cadastrar, aparece um quadro com o login e a senha para entregar à pessoa, com o botão **Copiar**. A senha não aparece de novo.
- **Editar:** muda nome, login, tipo de acesso e, se a nova senha for preenchida, a senha. Senha em branco mantém a atual.
- **Excluir:** pede um segundo clique para confirmar. Quem é excluído perde o acesso na próxima ação.
- **Proteções:** ninguém exclui a própria conta nem tira o próprio acesso de superusuário, e o sistema nunca fica sem nenhum superusuário.
- Toda criação, alteração e exclusão fica registrada em `logs\servidor.log`, com quem fez.

### Pelo terminal

O primeiro superusuário é criado no terminal, na pasta do sistema. Os comandos também servem se ninguém conseguir entrar:

```bash
python usuarios.py criar             # pede login, nome exibido no painel e senha
python usuarios.py criar --admin     # o mesmo, criando um superusuário
python usuarios.py senha <login>     # troca a senha
python usuarios.py listar            # mostra os usuários, o tipo e o último acesso
python usuarios.py remover <login>   # pede confirmação
```

- A senha tem **exatamente 6 dígitos**, só números. Na tela de login, o celular abre o teclado numérico.
- O login não diferencia maiúsculas e minúsculas.
- O superusuário vê tudo o que os outros usuários veem, mais a aba Usuários.
- A sessão dura `SESSAO_HORAS` horas (padrão 12). Depois disso, o sistema pede login de novo e volta para a página em que você estava.
- A `SECRET_KEY` do `.env` assina o cookie da sessão. Sem ela, todos precisam entrar de novo a cada reinício do servidor. Se ela for trocada, todas as sessões abertas caem.
- Depois de 5 senhas erradas em 15 minutos, aquele computador fica bloqueado por 15 minutos. Tentativas recusadas ficam registradas em `logs\servidor.log`.
- O acesso é por HTTP na rede interna, então use senhas que não sejam usadas em outros sistemas. Uma senha de 6 dígitos tem 1 milhão de combinações, e o bloqueio por tentativas é o que impede quem tenta adivinhar.

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

Todas as contas a pagar ignoram títulos excluídos (`Data_Exclusao`) e as contas contábeis listadas em `CONTAS_EXCLUIDAS`.
A comparação dos nomes ignora acentos, maiúsculas e espaços.

**Regras de desconsideração (iguais às do Painel Gerencial):** `CONTAS_EXCLUIDAS` recebe a mesma lista do Painel, que junta as contas `contas_excluidas_pagamentos` e `contas_ignoradas` de `config/unidades.json`. Fazem parte dela, por exemplo, empréstimos, compra de imóvel (com haveres e ITBI), distribuição de sócios, JC Garcia, contas da Loja Flores e Falcão. Quando o Painel mudar essa lista, copie-a para o `.env`.

**Lançamentos e fornecedores ignorados (por loja):** os códigos são de cada banco, então valem só para a loja configurada no `.env`. Eles saem de todos os cards de pagamento (pagas, vencidas, a pagar, previstas e próximo mês) e da aba Pagamentos.

| Variável | O que tira | Equivale no Painel | Ponta Negra | Morada do Sol |
| --- | --- | --- | --- | --- |
| `LANCAMENTOS_IGNORADOS` | Lançamentos de `Contas_Pagar` pelo código | `lancamentos_ignorados` | `90097;91105;91106;91113` (terreno e cartório) | vazio |
| `FORNECEDORES_IGNORADOS` | Todos os pagamentos de um fornecedor (`Codigo_Fornecedor`) | `despesas_socios.fornecedores` | `3448` (JC Participações) | vazio |

Para desconsiderar um pagamento novo:
1. Ache o código na aba **Pagamentos**, abrindo a conta.
2. Acrescente o código em `LANCAMENTOS_IGNORADOS`.
3. Reinicie o sistema. No servidor, rode o `servidor\instalar.bat` de novo.

Um valor que não seja número impede o sistema de subir, e a mensagem aparece em `logs\servidor.log`.

As outras regras do Painel (despesas dos sócios pela observação, transferências marcadas para a Flores, observação de outra loja e fator por conta) não existem aqui. Elas valem só para Parque Dez, Flores e CD.

## PDF da Visão geral

O botão **PDF**, ao lado dos filtros da Visão geral, abre a impressão do navegador. Em "Destino", escolha **Salvar como PDF**.

- O PDF sai em uma página A4 deitada, com as 4 seções em grade de até 6 cards.
- O topo da folha mostra a loja, o mês, a situação do período e a data e hora em que foi gerado, com o nome de quem gerou.
- Os filtros, as abas e os botões não aparecem, e o PDF sai sempre em tema claro, mesmo com o painel no escuro.
- O nome do arquivo sugerido é "Relatório gerencial - Morada do Sol - Outubro 2026".
- O botão só fica ativo depois que os dados do mês carregam. O atalho Ctrl+P também usa este layout.
- Os estilos da impressão ficam em `static/css/impressao.css`.

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
usuarios.py         usuários do login (SQLite local), regras da aba Usuários e comandos de cadastro no terminal
templates/usuarios.html  aba Usuários (static/js/usuarios.js e static/css/usuarios.css)
templates/login.html  tela de login (static/css/login.css)
db.py               conexão somente leitura com o SQL Server
config.py           leitura do .env
dados/              planilha do plano de contas e banco das provisões (fora do Git)
templates/          base.html (topo, abas, filtros) + uma página por aba
static/js/comum.js  filtros, tema, formatação e carregamento compartilhados
static/js/app.js    cards da Visão geral
static/js/pagamentos.js  matriz da aba Pagamentos
static/js/provisoes.js   formulário e lista da aba Provisões
static/css/         style.css (geral), pagamentos.css, provisoes.css, login.css e impressao.css (PDF da Visão geral)
.env.example        variáveis necessárias (sem valores reais)
Iniciar Relatorio.bat    atalho para rodar neste computador
servidor/           publicação no servidor Windows (config.ps1 é o único que muda entre sistemas)
logs/               log do servidor (criado na instalação, fora do Git)
```

## Segurança

- Credenciais e regras ficam no `.env`, que está no `.gitignore`.
- A conexão roda em `READ UNCOMMITTED` e termina com rollback: o sistema nunca grava no banco e não trava o PDV.
- O relatório tem informação sensível, então mantenha o acesso restrito à rede interna.
