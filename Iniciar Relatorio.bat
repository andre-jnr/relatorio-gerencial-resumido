@echo off
title Relatorio gerencial - Morada do Sol
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Python nao encontrado. Instale em https://www.python.org
  pause
  exit /b 1
)

if not exist ".env" (
  echo [ERRO] Arquivo .env nao encontrado. Copie .env.example para .env e preencha.
  pause
  exit /b 1
)

python -c "import flask, waitress, mssql_python, dotenv, openpyxl" >nul 2>nul
if errorlevel 1 (
  echo Instalando dependencias pela primeira vez...
  python -m pip install -r requirements.txt
)

echo.
echo  Iniciando o relatorio... a janela pode ser minimizada, mas nao fechada.
echo  Acesse:  http://localhost:3005
echo.

start "" http://localhost:3005
python app.py
pause
