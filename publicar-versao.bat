@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Data Gateway - Publicar versao

rem ============================================================
rem  Publica uma versao nova no GitHub:
rem   1. le a versao do package.json (ex.: 1.2.1)
rem   2. envia as alteracoes (commit + push na main)
rem   3. cria a tag v1.2.1 e envia -> o GitHub Actions compila,
rem      testa, pede a assinatura no SignPath e cria o Release.
rem  Antes: atualize "version" no package.json.
rem ============================================================

set "BRANCH=main"
cd /d "%~dp0"

where git >nul 2>nul || (echo [ERRO] Git nao encontrado. & goto :fim)
if not exist ".git" (echo [ERRO] Rode primeiro o enviar-git.bat para criar o repositorio. & goto :fim)

for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content -Raw -Encoding UTF8 package.json | ConvertFrom-Json).version"') do set "VERSAO=%%v"
if not defined VERSAO (echo [ERRO] Nao consegui ler a versao do package.json. & goto :fim)
set "TAG=v%VERSAO%"

echo.
echo === Data Gateway - publicar versao %VERSAO% ===
echo.

git rev-parse -q --verify "refs/tags/%TAG%" >nul 2>nul
if not errorlevel 1 (
  echo [ERRO] A tag %TAG% ja existe. Aumente "version" no package.json ^(ex.: 1.2.1 -^> 1.2.2^).
  goto :fim
)
git ls-remote --exit-code --tags origin "refs/tags/%TAG%" >nul 2>nul
if not errorlevel 1 (
  echo [ERRO] A tag %TAG% ja existe no GitHub. Aumente "version" no package.json.
  goto :fim
)

set "OK="
set /p "OK=Confirma publicar a versao %VERSAO%? (S/N): "
if /i not "!OK!"=="S" goto :fim

git add -A || goto :erro
git diff --cached --quiet
if errorlevel 1 git commit -m "Versao %VERSAO%" || goto :erro

git pull origin %BRANCH% --no-rebase --no-edit || (echo [ATENCAO] Conflito ao sincronizar. Resolva e rode de novo. & goto :fim)
git push origin %BRANCH% || goto :erro

git tag -a "%TAG%" -m "Data Gateway %VERSAO%" || goto :erro
git push origin "%TAG%" || goto :erro

echo.
echo [OK] Tag %TAG% enviada.
echo  Acompanhe a compilacao em: https://github.com/hendellacardoso/Data-Gateway/actions
echo  Quando o SignPath pedir, aprove a assinatura em https://app.signpath.io
echo  O Release aparece em:      https://github.com/hendellacardoso/Data-Gateway/releases
goto :fim

:erro
echo.
echo [ERRO] A publicacao falhou. Verifique a mensagem acima.

:fim
echo.
pause
endlocal
