@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Data Gateway - Preparar repositorio (GitHub Actions + assinatura)

rem ============================================================
rem  Prepara o projeto para compilar e assinar pelo GitHub:
rem   1. move mover-para-github-workflows\build.yml
rem      para .github\workflows\build.yml
rem   2. tira a pasta "Claude outputs" do Git (o arquivo continua no disco)
rem   3. (opcional) aumenta a versao no package.json
rem   4. (opcional) envia ao GitHub e publica a versao (tag)
rem ============================================================

cd /d "%~dp0"
echo.
echo === Data Gateway - preparar repositorio ===
echo Pasta: %CD%
echo.

rem ---------------------------------------------------------------- 1. workflow
set "ORIGEM=mover-para-github-workflows\build.yml"
set "DESTINO=.github\workflows\build.yml"
if exist "%ORIGEM%" (
  if not exist ".github\workflows" mkdir ".github\workflows" || goto :erro
  move /y "%ORIGEM%" "%DESTINO%" >nul || goto :erro
  rmdir "mover-para-github-workflows" 2>nul
  echo [OK] Workflow movido para %DESTINO%
) else if exist "%DESTINO%" (
  echo [OK] Workflow ja esta em %DESTINO%
) else (
  echo [ERRO] Nao encontrei %ORIGEM% nem %DESTINO%.
  goto :fim
)
if exist "mover-para-github-workflows" (
  echo [AVISO] A pasta mover-para-github-workflows ainda tem arquivos; confira e apague manualmente.
)

rem ---------------------------------------------------------------- 2. git
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo [AVISO] Git nao encontrado. Instale em https://git-scm.com/download/win
  echo         e depois rode o enviar-git.bat.
  goto :fim
)
if exist ".git" (
  git ls-files --error-unmatch "Claude outputs" >nul 2>nul
  if not errorlevel 1 (
    git rm -r -q --cached "Claude outputs" >nul 2>nul && echo [OK] "Claude outputs" removida do Git ^(continua no disco^).
  )
)

rem ---------------------------------------------------------------- conferencia
echo.
set "FALTA="
for %%f in (LICENSE CODE_SIGNING_POLICY.md ASSINATURA.md publicar-versao.bat .signpath\artifact-configuration.xml .github\workflows\build.yml) do (
  if exist "%%f" (echo   [ok] %%f) else (echo   [FALTA] %%f & set "FALTA=1")
)
if defined FALTA (
  echo.
  echo [ERRO] Faltam arquivos acima. Nada foi enviado.
  goto :fim
)

rem ---------------------------------------------------------------- 3. versao
for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content -Raw -Encoding UTF8 package.json | ConvertFrom-Json).version"') do set "VERSAO=%%v"
echo.
echo Versao atual no package.json: %VERSAO%
set "NOVA="
set /p "NOVA=Nova versao (Enter = manter %VERSAO%; ex.: 1.2.1): "
if defined NOVA (
  echo !NOVA!| findstr /r "^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$" >nul || (echo [ERRO] Versao invalida: !NOVA! ^(use o formato 1.2.1^) & goto :fim)
  set "GW_NOVA=!NOVA!"
  powershell -NoProfile -Command "$p='package.json'; $t=[IO.File]::ReadAllText($p); $t=([regex]'(\x22version\x22\s*:\s*\x22)[^\x22]+').Replace($t, '${1}' + $env:GW_NOVA, 1); [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding($false)))" || goto :erro
  powershell -NoProfile -Command "$p='src\renderer\layouts\MainLayout.jsx'; if (Test-Path $p) { $t=[IO.File]::ReadAllText($p); $t=[regex]::Replace($t, 'Data Gateway \d+\.\d+\.\d+ ', 'Data Gateway ' + $env:GW_NOVA + ' '); [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding($false))) }"
  set "VERSAO=!NOVA!"
  echo [OK] Versao alterada para !NOVA!
)

rem ---------------------------------------------------------------- 4. enviar / publicar
echo.
echo Proximo passo:
echo   1 - Enviar ao GitHub ^(enviar-git.bat^) - o Actions compila e testa
echo   2 - Enviar e PUBLICAR a versao %VERSAO% ^(publicar-versao.bat^) - cria o Release
echo   3 - Nao enviar agora
set "OP="
set /p "OP=Escolha (1/2/3): "
if "%OP%"=="1" (
  call "%~dp0enviar-git.bat"
  goto :final
)
if "%OP%"=="2" (
  call "%~dp0publicar-versao.bat"
  goto :final
)
echo Nada enviado. Quando quiser, rode enviar-git.bat ou publicar-versao.bat.
goto :fim

:final
echo.
echo Acompanhe em: https://github.com/hendellacardoso/Data-Gateway/actions
echo Passo a passo da assinatura: ASSINATURA.md
goto :fim

:erro
echo.
echo [ERRO] Falha na preparacao. Veja a mensagem acima.

:fim
echo.
pause
endlocal
