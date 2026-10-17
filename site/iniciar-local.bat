@echo off
rem Abre o site sem servico, so para testar: http://127.0.0.1:5010/
cd /d "%~dp0.."
start "" http://127.0.0.1:5010/
node server.js
pause
