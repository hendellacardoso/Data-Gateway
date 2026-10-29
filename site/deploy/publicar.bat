@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Site Data Gateway - Publicar

rem ============================================================================
rem  Site do Data Gateway (download) - publica e sobe atras do Caddy
rem
rem   1. Para o servico SiteDataGateway (se existir)
rem   2. Copia os executaveis da versao atual (..\release) para site\downloads
rem   3. Envia o codigo para o GitHub (commit + pull --rebase + push)
rem   4. Instala/atualiza o servico com NSSM (inicia com o Windows, reinicia se cair)
rem   5. Inicia o servico e testa http://127.0.0.1:5010/saude
rem   6. Gera caddy\site-datagateway.caddy, inclui no C:\Caddy\Caddyfile e recarrega o Caddy
rem
rem  Uso: clique duas vezes (pede permissao de Administrador)
rem       publicar.bat /semgit        -> nao mexe no git
rem       publicar.bat /semcaddy      -> nao mexe no Caddy
rem       publicar.bat /semexe        -> nao copia os executaveis de ..\release
rem ============================================================================

set "SERVICO=SiteDataGateway"
set "PORTA=5010"
set "DOMINIO=api2dev.com.br"
set "GIT_REMOTO=https://github.com/hendellacardoso/Data-Gateway.git"
set "GIT_BRANCH=main"
set "SITE=%~dp0.."
for %%i in ("%SITE%") do set "SITE=%%~fi"
set "PROJETO=%SITE%\.."
for %%i in ("%PROJETO%") do set "PROJETO=%%~fi"
set "LOGS=%SITE%\logs"
set "DOWNLOADS=%SITE%\downloads"
set "NSSM=%~dp0tools\nssm.exe"
set "SEMGIT=0"
set "SEMCADDY=0"
set "SEMEXE=0"
for %%a in (%*) do (
  if /i "%%a"=="/semgit" set "SEMGIT=1"
  if /i "%%a"=="/semcaddy" set "SEMCADDY=1"
  if /i "%%a"=="/semexe" set "SEMEXE=1"
)

rem ---------------------------------------------------------------- administrador
net session >nul 2>&1
if errorlevel 1 (
  echo Solicitando permissao de Administrador...
  if "%~1"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  ) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  )
  exit /b
)

cd /d "%SITE%"
if not exist "%LOGS%" mkdir "%LOGS%"
if not exist "%DOWNLOADS%" mkdir "%DOWNLOADS%"

echo.
echo ==============================================================
echo   SITE DATA GATEWAY - PUBLICACAO   %date% %time:~0,8%
echo   Pasta:    %SITE%
echo   Endereco: https://%DOMINIO%  -^>  127.0.0.1:%PORTA%
echo ==============================================================

rem ---------------------------------------------------------------- pre-requisitos
where node >nul 2>&1 || (echo [ERRO] Node.js nao encontrado. Instale o Node 18+ ^(https://nodejs.org^). & goto :falha)
for /f "delims=" %%i in ('where node') do if not defined NODE_EXE set "NODE_EXE=%%i"
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
echo Node: %NODE_VER%  (%NODE_EXE%)
if not exist "%SITE%\server.js" (echo [ERRO] server.js nao encontrado em %SITE% & goto :falha)

rem ---------------------------------------------------------------- NSSM
if not exist "%NSSM%" (
  for /f "delims=" %%i in ('where nssm 2^>nul') do if not defined NSSM_PATH set "NSSM_PATH=%%i"
  if not defined NSSM_PATH if exist "C:\nssm\win64\nssm.exe" set "NSSM_PATH=C:\nssm\win64\nssm.exe"
  if not defined NSSM_PATH if exist "C:\nssm\nssm.exe" set "NSSM_PATH=C:\nssm\nssm.exe"
  if defined NSSM_PATH (
    set "NSSM=!NSSM_PATH!"
  ) else (
    echo.
    echo Baixando NSSM ^(gerenciador de servicos^)...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0obter-nssm.ps1" -Destino "%NSSM%"
    if not exist "%NSSM%" (
      echo [ERRO] Nao foi possivel baixar o NSSM.
      echo        Baixe em https://nssm.cc/download e copie o win64\nssm.exe para:
      echo        %~dp0tools\nssm.exe
      goto :falha
    )
  )
)
echo NSSM: %NSSM%

rem ---------------------------------------------------------------- para o servico
echo.
echo [1/6] Parando o servico %SERVICO%...
sc query "%SERVICO%" >nul 2>&1
if not errorlevel 1 (
  "%NSSM%" stop "%SERVICO%" >nul 2>&1
  timeout /t 2 /nobreak >nul
) else (
  echo       Servico ainda nao existe - sera criado.
)

rem porta ocupada por outro programa?
set "PID_PORTA="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"127.0.0.1:%PORTA% .*LISTENING" /c:"0.0.0.0:%PORTA% .*LISTENING" /c:"\[::\]:%PORTA% .*LISTENING"') do set "PID_PORTA=%%p"
if defined PID_PORTA (
  echo [ERRO] A porta %PORTA% ja esta em uso pelo processo PID !PID_PORTA!:
  tasklist /fi "PID eq !PID_PORTA!" | findstr /v /c:"====="
  echo        Encerre esse programa ou troque a porta no inicio deste arquivo.
  goto :falha
)

rem ---------------------------------------------------------------- executaveis
echo.
if "%SEMEXE%"=="1" (
  echo [2/6] Copia dos executaveis ignorada ^(/semexe^).
) else (
  call :copiar_exes
)

rem ---------------------------------------------------------------- codigo (GitHub)
echo.
if "%SEMGIT%"=="1" (
  echo [3/6] Git ignorado ^(/semgit^).
) else (
  call :git_enviar
)

rem ---------------------------------------------------------------- servico
echo.
echo [4/6] Configurando o servico %SERVICO%...
sc query "%SERVICO%" >nul 2>&1
if errorlevel 1 (
  "%NSSM%" install "%SERVICO%" "%NODE_EXE%" "server.js" >nul || (echo [ERRO] Falha ao criar o servico. & goto :falha)
)
"%NSSM%" set "%SERVICO%" Application "%NODE_EXE%" >nul
"%NSSM%" set "%SERVICO%" AppParameters "server.js" >nul
"%NSSM%" set "%SERVICO%" AppDirectory "%SITE%" >nul
"%NSSM%" set "%SERVICO%" DisplayName "Site Data Gateway (api2dev.com.br)" >nul
"%NSSM%" set "%SERVICO%" Description "Site de download do Data Gateway - https://%DOMINIO% (Caddy) -> 127.0.0.1:%PORTA%." >nul
"%NSSM%" set "%SERVICO%" Start SERVICE_AUTO_START >nul
"%NSSM%" set "%SERVICO%" AppEnvironmentExtra NODE_ENV=production PORT=%PORTA% HOST=127.0.0.1 >nul
"%NSSM%" set "%SERVICO%" AppStdout "%LOGS%\servico.log" >nul
"%NSSM%" set "%SERVICO%" AppStderr "%LOGS%\servico-erros.log" >nul
"%NSSM%" set "%SERVICO%" AppRotateFiles 1 >nul
"%NSSM%" set "%SERVICO%" AppRotateOnline 1 >nul
"%NSSM%" set "%SERVICO%" AppRotateBytes 10485760 >nul
"%NSSM%" set "%SERVICO%" AppExit Default Restart >nul
"%NSSM%" set "%SERVICO%" AppRestartDelay 3000 >nul
"%NSSM%" set "%SERVICO%" AppStopMethodConsole 5000 >nul

echo.
echo [5/6] Iniciando e testando http://127.0.0.1:%PORTA%/saude ...
"%NSSM%" start "%SERVICO%" >nul 2>&1
set "OK=0"
for /l %%n in (1,1,20) do (
  if "!OK!"=="0" (
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:%PORTA%/saude'; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (set "OK=1") else (timeout /t 1 /nobreak >nul)
  )
)
if "%OK%"=="0" (
  echo [ERRO] O site nao respondeu. Ultimas linhas do log de erros:
  powershell -NoProfile -Command "if (Test-Path '%LOGS%\servico-erros.log') { Get-Content '%LOGS%\servico-erros.log' -Tail 25 }"
  goto :falha
)
echo       Site respondendo na porta %PORTA%.

rem ---------------------------------------------------------------- Caddy
echo.
if "%SEMCADDY%"=="1" (
  echo [6/6] Caddy ignorado ^(/semcaddy^).
) else (
  echo [6/6] Configurando o Caddy para https://%DOMINIO% ...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0adicionar-ao-caddy.ps1" -Dominio "%DOMINIO%" -Porta %PORTA%
  if errorlevel 1 (
    echo [AVISO] O Caddy nao foi atualizado ^(veja acima^). O site ja esta no ar em http://127.0.0.1:%PORTA%/
    echo         Depois de resolver, rode deploy\caddy.bat
    set "AVISO_CADDY=1"
  )
)

echo.
echo ==============================================================
if defined AVISO_CADDY (
echo   PUBLICADO - COM AVISO NO CADDY ^(veja acima^)
) else (
echo   PUBLICADO COM SUCESSO
)
echo   Local:     http://127.0.0.1:%PORTA%/
echo   Internet:  https://%DOMINIO%/
echo   Downloads: %DOWNLOADS%
echo   Logs:      %LOGS%
echo ==============================================================
echo.
if not defined NAO_PAUSAR pause
exit /b 0

:falha
echo.
echo ==============================================================
echo   PUBLICACAO NAO CONCLUIDA - veja a mensagem acima
echo ==============================================================
if not defined NAO_PAUSAR pause
exit /b 1

rem ============================================================================
rem  Copia DataGateway-Setup/Portable-<versao>.exe de ..\release para downloads.
rem  A versao vem do package.json do aplicativo. Versoes antigas vao para
rem  downloads\antigos (o site sempre oferece a mais nova).
rem ============================================================================
:copiar_exes
echo [2/6] Executaveis para download...
set "VERSAO="
for /f "delims=" %%v in ('powershell -NoProfile -Command "try { (Get-Content -Raw -Encoding UTF8 '%PROJETO%\package.json' | ConvertFrom-Json).version } catch { '' }"') do set "VERSAO=%%v"
if not defined VERSAO (
  echo       [AVISO] Nao achei a versao em %PROJETO%\package.json - copia ignorada.
  exit /b 0
)
echo       Versao do aplicativo: %VERSAO%
set "COPIOU=0"
for %%t in (Setup Portable) do (
  set "ARQ=DataGateway-%%t-%VERSAO%.exe"
  if exist "%PROJETO%\release\!ARQ!" (
    robocopy "%PROJETO%\release" "%DOWNLOADS%" "!ARQ!" /njh /njs /ndl /nc /ns /np >nul
    if errorlevel 8 (
      echo       [ERRO] Falha ao copiar !ARQ!
    ) else (
      echo       OK  !ARQ!
      set "COPIOU=1"
    )
  ) else if exist "%DOWNLOADS%\!ARQ!" (
    echo       OK  !ARQ! ^(ja estava em downloads^)
    set "COPIOU=1"
  ) else (
    echo       [AVISO] !ARQ! nao encontrado em %PROJETO%\release
  )
)
if "%COPIOU%"=="0" (
  echo       [AVISO] Nenhum executavel da versao %VERSAO%. Rode o gerar-instalador.bat na pasta do projeto
  echo               ou copie os .exe para %DOWNLOADS%. O site mostra "Em breve" ate la.
  exit /b 0
)
rem move versoes antigas
for %%f in ("%DOWNLOADS%\DataGateway-*.exe") do (
  echo %%~nxf | findstr /i /c:"-%VERSAO%.exe" >nul || (
    if not exist "%DOWNLOADS%\antigos" mkdir "%DOWNLOADS%\antigos"
    move /y "%%~ff" "%DOWNLOADS%\antigos\" >nul && echo       Versao antiga movida: %%~nxf -^> downloads\antigos
  )
)
exit /b 0

rem ============================================================================
rem  Envia o codigo ao GitHub (repositorio do projeto inteiro). So gera AVISO.
rem  downloads, dados, logs, caddy e deploy\tools do site ficam fora (.gitignore).
rem ============================================================================
:git_enviar
where git >nul 2>&1 || (echo [3/6] [AVISO] Git nao instalado - envio ao GitHub ignorado. & exit /b 0)
echo [3/6] Enviando codigo para o GitHub ^(%GIT_REMOTO%^)...
set "G=git -c safe.directory=* -C "%PROJETO%""
if not exist "%PROJETO%\.git" (
  %G% init -b %GIT_BRANCH% >nul || (echo [AVISO] git init falhou. & exit /b 0)
)
%G% remote get-url origin >nul 2>&1 && (
  %G% remote set-url origin "%GIT_REMOTO%"
) || (
  %G% remote add origin "%GIT_REMOTO%"
)
for /f "delims=" %%n in ('%G% config user.name 2^>nul') do set "GIT_NOME=%%n"
if not defined GIT_NOME %G% config user.name "Hendell Alves Cardoso"
for /f "delims=" %%m in ('%G% config user.email 2^>nul') do set "GIT_EMAIL=%%m"
if not defined GIT_EMAIL %G% config user.email "hendellacardoso@gmail.com"

%G% add -A
%G% diff --cached --quiet && (
  echo       Nenhuma alteracao nova para commit.
) || (
  %G% commit -q -m "Site: publicacao %date% %time:~0,5%" && echo       Commit criado.
)
%G% ls-remote --exit-code --heads origin %GIT_BRANCH% >nul 2>&1 && (
  %G% pull --rebase --autostash -q origin %GIT_BRANCH% || (
    echo [AVISO] Conflito ao atualizar com o GitHub. Resolva com "git status" na pasta do projeto.
    %G% rebase --abort >nul 2>&1
    exit /b 0
  )
)
%G% push -u origin %GIT_BRANCH% && (
  echo       Codigo enviado ao GitHub.
) || (
  echo [AVISO] Nao foi possivel enviar ao GitHub ^(login/permissao?^). A publicacao continua.
)
exit /b 0
