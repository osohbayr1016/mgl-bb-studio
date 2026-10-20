@echo off
chcp 65001 >nul
title MGL Revit AI tuslah
cd /d "%~dp0.."
if not exist "server\.venv\Scripts\python.exe" (
  echo [ALDAA] server\.venv olsongui.
  echo Ehleed:  py -3.12 -m venv server\.venv
  echo Daraa ni: server\.venv\Scripts\python.exe -m pip install -e server claude-agent-sdk
  pause
  exit /b 1
)
echo.
echo  MGL Revit AI tuslah asch baina...
echo  Ene tsonhig HAAHGUI orhino uu.
echo  Revit-ee neegeed "MGL tuslah" deer bicheerei.
echo.
"server\.venv\Scripts\python.exe" "agent\mgl_agent.py"
echo.
echo  Agent zogslloo. Enter darj haana uu.
pause >nul
