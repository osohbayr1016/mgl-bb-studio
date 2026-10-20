@echo off
title MGL AI
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1"
exit /b %ERRORLEVEL%
