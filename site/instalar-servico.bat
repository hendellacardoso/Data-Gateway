@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Site Data Gateway - Instalar servico

rem ============================================================================
rem  Instala o site como SERVICO DO WINDOWS (SiteDataGateway) na porta 5010.
rem  - Inicia junto com o Windows (mesmo sem ninguem logado)
rem  - Reinicia sozinho se cair
rem  Basta dar dois cliques. Pode rodar de novo quantas vezes quiser.
rem ============================================================================

set "SERVICO=SiteDataGateway"
set "PORTA=5010"
set "SITE=%~dp0"
if "%SITE:~-1%"=="\" set "SITE=%SITE:~0,-1%"
set "LOGS=%SITE%\logs"

rem ---------------------------------------------------------------- administrador
net session >nul 2>&1
if errorlevel 1 (
  echo Solicitando permissao de Administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%SITE%"
if not exist "%LOGS%" mkdir "%LOGS%"
if not exist "%SITE%\downloads" mkdir "%SITE%\downloads"

echo.
echo ==============================================================
echo   SITE DATA GATEWAY - INSTALAR SERVICO
echo   Pasta: %SITE%
echo ==============================================================

rem ---------------------------------------------------------------- Node
where node >nul 2>&1 || (echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org & goto :falha)
for /f "delims=" %%i in ('where node') do if not defined NODE_EXE set "NODE_EXE=%%i"
echo Node: %NODE_EXE%
if not exist "%SITE%\server.js" (echo [ERRO] server.js nao encontrado em %SITE% & goto :falha)

rem ---------------------------------------------------------------- NSSM
set "NSSM=%SITE%\deploy\tools\nssm.exe"
if not exist "%NSSM%" (
  set "NSSM="
  for /f "delims=" %%i in ('where nssm 2^>nul') do if not defined NSSM set "NSSM=%%i"
  if not defined NSSM if exist "C:\nssm\win64\nssm.exe" set "NSSM=C:\nssm\win64\nssm.exe"
  if not defined NSSM if exist "C:\nssm\nssm.exe" set "NSSM=C:\nssm\nssm.exe"
  if not defined NSSM if exist "C:\Painel de Chamado\Projeto\deploy\tools\nssm.exe" set "NSSM=C:\Painel de Chamado\Projeto\deploy\tools\nssm.exe"
  if not defined NSSM (
    echo Baixando NSSM...
    set "NSSM=%SITE%\deploy\tools\nssm.exe"
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SITE%\deploy\obter-nssm.ps1" -Destino "!NSSM!"
    if not exist "!NSSM!" (
      echo [ERRO] NSSM nao encontrado. Baixe em https://nssm.cc/download e copie win64\nssm.exe para
      echo        %SITE%\deploy\tools\nssm.exe
      goto :falha
    )
  )
)
echo NSSM: %NSSM%

rem ---------------------------------------------------------------- para o servico (se existir)
sc query "%SERVICO%" >nul 2>&1
if not errorlevel 1 (
  echo Parando o servico atual...
  "%NSSM%" stop "%SERVICO%" >nul 2>&1
  timeout /t 2 /nobreak >nul
)

rem porta ocupada? (ex.: janela do iniciar-local.bat aberta)
set "PID_PORTA="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORTA% .*LISTENING"') do set "PID_PORTA=%%p"
if defined PID_PORTA (
  echo.
  echo [ERRO] A porta %PORTA% esta em uso pelo processo PID !PID_PORTA!:
  tasklist /fi "PID eq !PID_PORTA!" | findstr /v /c:"====="
  echo        Feche a janela do iniciar-local.bat ^(ou o programa acima^) e rode de novo.
  goto :falha
)

rem ---------------------------------------------------------------- cria/atualiza o servico
echo Configurando o servico %SERVICO%...
sc query "%SERVICO%" >nul 2>&1
if errorlevel 1 (
  "%NSSM%" install "%SERVICO%" "%NODE_EXE%" "server.js" >nul || (echo [ERRO] Falha ao criar o servico. & goto :falha)
)
"%NSSM%" set "%SERVICO%" Application "%NODE_EXE%" >nul
"%NSSM%" set "%SERVICO%" AppParameters "server.js" >nul
"%NSSM%" set "%SERVICO%" AppDirectory "%SITE%" >nul
"%NSSM%" set "%SERVICO%" DisplayName "Site Data Gateway (api2dev.com.br)" >nul
"%NSSM%" set "%SERVICO%" Description "Site de download do Data Gateway - 127.0.0.1:%PORTA% (publicado pelo Caddy em https://api2dev.com.br)." >nul
"%NSSM%" set "%SERVICO%" Start SERVICE_AUTO_START >nul
"%NSSM%" set "%SERVICO%" AppEnvironmentExtra NODE_ENV=production PORT=%PORTA% HOST=127.0.0.1 >nul
"%NSSM%" set "%SERVICO%" AppStdout "%LOGS%\servico.log" >nul
"%NSSM%" set "%SERVICO%" AppStderr "%LOGS%\servico-erros.log" >nul
"%NSSM%" set "%SERVICO%" AppRotateFiles 1 >nul
"%NSSM%" set "%SERVICO%" AppRotateOnline 1 >nul
"%NSSM%" set "%SERVICO%" AppRotateBytes 10485760 >nul
"%NSSM%" set "%SERVICO%" AppExit Default Restart >nul
"%NSSM%" set "%SERVICO%" AppRestartDelay 3000 >nul

echo Iniciando...
"%NSSM%" start "%SERVICO%" >nul 2>&1

set "OK=0"
for /l %%n in (1,1,15) do (
  if "!OK!"=="0" (
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:%PORTA%/saude'; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (set "OK=1") else (timeout /t 1 /nobreak >nul)
  )
)
if "%OK%"=="0" (
  echo [ERRO] O servico nao respondeu. Ultimas linhas do log de erros:
  powershell -NoProfile -Command "if (Test-Path '%LOGS%\servico-erros.log') { Get-Content '%LOGS%\servico-erros.log' -Tail 25 }"
  goto :falha
)

echo.
echo ==============================================================
echo   SERVICO INSTALADO E RODANDO
echo   Servico: %SERVICO%  ^(inicia com o Windows^)
echo   Site:    http://127.0.0.1:%PORTA%/
echo   Logs:    %LOGS%
echo   Controle: deploy\servico.bat  ^(status, parar, reiniciar, remover^)
echo ==============================================================
start "" http://127.0.0.1:%PORTA%/
echo.
pause
exit /b 0

:falha
echo.
echo   INSTALACAO NAO CONCLUIDA - veja a mensagem acima
echo.
pause
exit /b 1
