@echo off
setlocal EnableExtensions
title Data Gateway - Gerar executavel e instalador

rem ============================================================
rem  Gera em "release\":
rem   - DataGateway-Setup-<versao>.exe    (instalador NSIS)
rem   - DataGateway-Portable-<versao>.exe (executavel portatil)
rem   - win-unpacked\Data Gateway.exe     (aplicativo sem instalar)
rem  Requisito: Node.js 20 ou 22 (https://nodejs.org)
rem ============================================================

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale a versao LTS em https://nodejs.org
  goto :fim
)

echo.
echo === 1/3 Instalando dependencias ===
if exist package-lock.json (
  call npm ci || goto :erro
) else (
  call npm install || goto :erro
)

echo.
echo === 2/3 Compilando o painel ===
call npm run build:renderer || goto :erro

echo.
echo === 3/3 Gerando executavel e instalador ===
call npx electron-builder --win || goto :erro

echo.
echo [OK] Arquivos gerados na pasta "release":
dir /b release\*.exe
start "" "%~dp0release"
goto :fim

:erro
echo.
echo [ERRO] A geracao falhou. Verifique a mensagem acima.

:fim
echo.
pause
endlocal
