@echo off
rem Arranca el MVP del bar (Docker, API, carta, panel y tuneles) y abre la pagina con links y QR
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mvp\start-mvp.ps1" %*
pause
