@echo off
chcp 65001 >nul
title IA Analytics Pro
cd /d "%~dp0"

rem --- Atalho para rodar o app em qualquer maquina (precisa do Node.js) ---
rem --- Sempre entrega a ultima versao aprovada: reconstroi quando o commit mudou. ---

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo Instale o Node.js LTS em https://nodejs.org/ e rode este atalho de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Instalando dependencias [pode demorar na primeira vez]...
  call npm install
  if errorlevel 1 ( echo [ERRO] npm install falhou. & pause & exit /b 1 )
)

rem --- Decide se precisa reconstruir ---
rem 1. Sem build ainda -> constroi.
rem 2. Com git disponivel: commit atual diferente do carimbo do ultimo build -> reconstroi.
rem    (Sem git na maquina, mantem o comportamento antigo: so constroi se nao existir.)
set "NEED_BUILD="
set "CURRENT_REV="
set "STORED_REV="

if not exist ".next\standalone\server.js" set "NEED_BUILD=1"

where git >nul 2>nul
if errorlevel 1 goto apos_verificacao
for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set "CURRENT_REV=%%i"
if not defined CURRENT_REV goto apos_verificacao
if exist ".next\build-stamp.txt" set /p STORED_REV=<".next\build-stamp.txt"
if not "%STORED_REV%"=="%CURRENT_REV%" set "NEED_BUILD=1"
:apos_verificacao

if not defined NEED_BUILD goto iniciar

echo Atualizando o app para a versao mais recente [pode demorar um pouco]...
call npm install
if errorlevel 1 ( echo [ERRO] npm install falhou. & pause & exit /b 1 )
call npm run build
if errorlevel 1 ( echo [ERRO] build falhou. & pause & exit /b 1 )
if defined CURRENT_REV >".next\build-stamp.txt" echo %CURRENT_REV%

:iniciar
echo.
echo Iniciando o servidor em http://localhost:3000
echo (Feche esta janela para encerrar o app.)
echo.

rem Abre o navegador alguns segundos depois, dando tempo do servidor subir.
start "" /min cmd /c "timeout /t 4 >nul & start http://localhost:3000"

set PORT=3000
call npm run start
