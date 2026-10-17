@echo off
setlocal EnableExtensions
title Site Data Gateway - Caddy

rem ============================================================================
rem  Gera caddy\site-datagateway.caddy, inclui no Caddyfile principal e recarrega o Caddy.
rem  Uso: caddy.bat                          (https://api2dev.com.br -> 127.0.0.1:5010)
rem       caddy.bat -CorrigirAcentos         (tambem conserta acentos estragados do Caddyfile)
rem       caddy.bat -Caddyfile "C:\Caddy\Caddyfile" -CaddyExe "C:\Caddy\caddy.exe"
rem       caddy.bat -SemRecarregar           (so gera o arquivo)
rem ============================================================================

net session >nul 2>&1
if errorlevel 1 (
  if "%~1"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  ) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  )
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0adicionar-ao-caddy.ps1" -Dominio api2dev.com.br -Porta 5010 %*
echo.
pause
