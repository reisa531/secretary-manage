@echo off
rem Secretary Manage Platform launcher: check health -> start if down -> open browser
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-platform.ps1"
