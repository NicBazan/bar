@echo off
rem Apaga el MVP del bar (Docker queda prendido)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mvp\stop-mvp.ps1"
pause
