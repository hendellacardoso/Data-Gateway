@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Data Gateway - Enviar para o GitHub

rem ============================================================
rem  Envia o projeto para:
rem  https://github.com/hendellacardoso/api-gateway-desktop.git
rem  Uso: de dois cliques neste arquivo (na pasta do projeto).
rem ============================================================

set "REPO=https://github.com/hendellacardoso/api-gateway-desktop.git"
set "BRANCH=main"

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Git nao encontrado. Instale em https://git-scm.com/download/win e tente novamente.
  goto :fim
)

echo.
echo === Data Gateway - envio para o GitHub ===
echo Pasta:       %CD%
echo Repositorio: %REPO%
echo.

rem --- Inicializa o repositorio na primeira execucao ---
if not exist ".git" (
  echo Inicializando repositorio Git...
  git init || goto :erro
  git branch -M %BRANCH%
)

rem --- Garante o remote "origin" apontando para o repositorio correto ---
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "%REPO%" || goto :erro
) else (
  git remote set-url origin "%REPO%" || goto :erro
)

rem --- Identidade do autor (pergunta somente se ainda nao configurada) ---
for /f "delims=" %%i in ('git config user.name 2^>nul') do set "GITNAME=%%i"
if not defined GITNAME (
  set /p "GITNAME=Seu nome para os commits: "
  git config user.name "!GITNAME!"
)
for /f "delims=" %%i in ('git config user.email 2^>nul') do set "GITEMAIL=%%i"
if not defined GITEMAIL (
  set /p "GITEMAIL=Seu e-mail para os commits: "
  git config user.email "!GITEMAIL!"
)

rem --- Mensagem do commit ---
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set "HOJE=%%a-%%b-%%c"
set "MSG="
set /p "MSG=Mensagem do commit (Enter = 'Atualizacao !HOJE! %time:~0,5%'): "
if not defined MSG set "MSG=Atualizacao !HOJE! %time:~0,5%"

rem --- Adiciona e cria o commit (node_modules, dist, release e bancos .db ficam fora via .gitignore) ---
git add -A || goto :erro
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "!MSG!" || goto :erro
) else (
  echo Nenhuma alteracao nova para commitar.
)

rem --- Se o repositorio remoto ja tiver commits (ex.: README criado no GitHub), integra antes de enviar ---
git ls-remote --exit-code --heads origin %BRANCH% >nul 2>nul
if not errorlevel 1 (
  echo Sincronizando com o remoto...
  git pull origin %BRANCH% --allow-unrelated-histories --no-rebase --no-edit
  if errorlevel 1 (
    echo.
    echo [ATENCAO] Houve conflito ao sincronizar. Resolva os arquivos indicados,
    echo           execute "git add ." e "git commit", e rode este arquivo novamente.
    goto :fim
  )
)

echo Enviando para o GitHub...
git push -u origin %BRANCH% || goto :erro

echo.
echo [OK] Projeto enviado com sucesso para %REPO%
goto :fim

:erro
echo.
echo [ERRO] O envio falhou. Verifique a mensagem acima.
echo  - Se pedir login, autentique-se no GitHub na janela que abrir.
echo  - Confirme que o repositorio existe e que voce tem permissao de escrita.

:fim
echo.
pause
endlocal
