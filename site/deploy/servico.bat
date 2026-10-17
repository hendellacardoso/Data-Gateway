@echo off
setlocal EnableExtensions
title Site Data Gateway - Servico

rem ============================================================================
rem  Controle rapido do servico SiteDataGateway (sem recompilar)
rem  Uso:  servico.bat [status|iniciar|parar|reiniciar|logs|remover]
rem        sem parametro = menu
rem ============================================================================

set "SERVICO=SiteDataGateway"
set "RAIZ=%~dp0.."
for %%i in ("%RAIZ%") do set "RAIZ=%%~fi"
set "LOGS=%RAIZ%\logs"
set "NSSM=%~dp0tools\nssm.exe"
if not exist "%NSSM%" for /f "delims=" %%i in ('where nssm 2^>nul') do set "NSSM=%%i"
if not exist "%NSSM%" (
  echo NSSM nao encontrado. Rode primeiro o publicar.bat.
  pause
  exit /b 1
)

net session >nul 2>&1
if errorlevel 1 (
  if "%~1"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  ) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%~1' -Verb RunAs"
  )
  exit /b
)

set "ACAO=%~1"
if "%ACAO%"=="" (
  echo.
  echo  Site Data Gateway - servico %SERVICO%
  echo  -------------------------------------
  echo   1 - Status
  echo   2 - Iniciar
  echo   3 - Parar
  echo   4 - Reiniciar
  echo   5 - Ver logs ^(ultimas linhas^)
  echo   6 - Remover servico
  echo.
  set /p "OP=Escolha: "
)
if "%ACAO%"=="" (
  if "%OP%"=="1" set "ACAO=status"
  if "%OP%"=="2" set "ACAO=iniciar"
  if "%OP%"=="3" set "ACAO=parar"
  if "%OP%"=="4" set "ACAO=reiniciar"
  if "%OP%"=="5" set "ACAO=logs"
  if "%OP%"=="6" set "ACAO=remover"
)

if /i "%ACAO%"=="status"    ("%NSSM%" status "%SERVICO%" & goto :fim)
if /i "%ACAO%"=="iniciar"   ("%NSSM%" start "%SERVICO%" & goto :fim)
if /i "%ACAO%"=="parar"     ("%NSSM%" stop "%SERVICO%" & goto :fim)
if /i "%ACAO%"=="reiniciar" ("%NSSM%" restart "%SERVICO%" & goto :fim)
if /i "%ACAO%"=="logs" (
  echo ===== %LOGS%\servico.log =====
  powershell -NoProfile -Command "if (Test-Path '%LOGS%\servico.log') { Get-Content '%LOGS%\servico.log' -Tail 30 }"
  echo.
  echo ===== %LOGS%\servico-erros.log =====
  powershell -NoProfile -Command "if (Test-Path '%LOGS%\servico-erros.log') { Get-Content '%LOGS%\servico-erros.log' -Tail 30 }"
  goto :fim
)
if /i "%ACAO%"=="remover" (
  "%NSSM%" stop "%SERVICO%" >nul 2>&1
  "%NSSM%" remove "%SERVICO%" confirm
  goto :fim
)
echo Opcao invalida: %ACAO%

:fim
echo.
pause
