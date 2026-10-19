@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Site - Publicar API2Dev Backup

rem ============================================================================
rem  Publica os executaveis do API2Dev Backup em https://api2dev.com.br/backup
rem
rem   1. Copia API2Dev-Backup-Setup-<versao>.exe e API2Dev-Backup-Portatil-<versao>.exe
rem      de C:\Sistema de Backup\release para site\downloads
rem      (versoes antigas vao para site\downloads\antigos)
rem   2. Reinicia o servico SiteDataGateway (carrega o server.js novo)
rem   3. Testa http://127.0.0.1:5010/api/backup/versao
rem
rem  Uso: clique duas vezes (pede permissao de Administrador)
rem       publicar-backup.bat "D:\outra\pasta"   -> usa outra pasta de origem
rem ============================================================================

set "SERVICO=SiteDataGateway"
set "PORTA=5010"
set "ORIGEM=C:\Sistema de Backup\release"
if not "%~1"=="" set "ORIGEM=%~1"
set "SITE=%~dp0.."
for %%i in ("%SITE%") do set "SITE=%%~fi"
set "DOWNLOADS=%SITE%\downloads"

rem ---------------------------------------------------------------- administrador
net session >nul 2>&1
if errorlevel 1 (
  echo Solicitando permissao de Administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '\"%ORIGEM%\"' -Verb RunAs"
  exit /b
)

echo.
echo ==============================================================
echo   PUBLICAR API2Dev BACKUP   %date% %time:~0,8%
echo   Origem:   %ORIGEM%
echo   Destino:  %DOWNLOADS%
echo ==============================================================
echo.

if not exist "%ORIGEM%" (
  echo [ERRO] Pasta de origem nao encontrada: %ORIGEM%
  echo        Gere os executaveis com "C:\Sistema de Backup\gerar-tudo.bat"
  echo        ou informe a pasta: publicar-backup.bat "C:\pasta\com\os\exe"
  goto :falha
)
if not exist "%DOWNLOADS%" mkdir "%DOWNLOADS%"
if not exist "%DOWNLOADS%\antigos" mkdir "%DOWNLOADS%\antigos"

set "COPIADOS=0"
for %%T in (Setup Portatil) do (
  set "NOVO="
  for /f "delims=" %%F in ('dir /b /o:n "%ORIGEM%\API2Dev-Backup-%%T-*.exe" 2^>nul') do set "NOVO=%%F"
  if defined NOVO (
    rem move versoes antigas (nome diferente do novo) para antigos
    for /f "delims=" %%A in ('dir /b "%DOWNLOADS%\API2Dev-Backup-%%T-*.exe" 2^>nul') do (
      if /i not "%%A"=="!NOVO!" (
        echo Arquivando %%A
        move /y "%DOWNLOADS%\%%A" "%DOWNLOADS%\antigos\" >nul
      )
    )
    echo Copiando !NOVO!
    copy /y "%ORIGEM%\!NOVO!" "%DOWNLOADS%\" >nul || (echo [ERRO] Falha ao copiar !NOVO! & goto :falha)
    set /a COPIADOS+=1
  ) else (
    echo [AVISO] Nenhum API2Dev-Backup-%%T-*.exe em %ORIGEM%
  )
)
if "%COPIADOS%"=="0" (echo [ERRO] Nenhum executavel copiado. & goto :falha)

rem ---------------------------------------------------------------- reinicia o site
echo.
sc query "%SERVICO%" >nul 2>&1
if errorlevel 1 (
  echo [AVISO] Servico %SERVICO% nao encontrado. Rode site\instalar-servico.bat ou deploy\publicar.bat.
) else (
  echo Reiniciando o servico %SERVICO%...
  net stop "%SERVICO%" >nul 2>&1
  net start "%SERVICO%" >nul 2>&1 || (echo [ERRO] Nao foi possivel iniciar o servico %SERVICO%. & goto :falha)
  timeout /t 2 /nobreak >nul
)

rem ---------------------------------------------------------------- teste
echo.
echo Testando http://127.0.0.1:%PORTA%/api/backup/versao ...
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:%PORTA%/api/backup/versao' -TimeoutSec 10; Write-Host ('Versao: ' + $r.versao + '   Downloads: ' + $r.downloads); $r.arquivos | ForEach-Object { Write-Host (' - ' + $_.nome + '  (' + [math]::Round($_.tamanho/1MB,1) + ' MB)') }; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (echo [ERRO] O site nao respondeu. & goto :falha)

echo.
echo [OK] Publicado. Pagina: https://api2dev.com.br/backup
start "" "https://api2dev.com.br/backup"
pause
exit /b 0

:falha
echo.
echo Publicacao NAO concluida.
pause
exit /b 1
