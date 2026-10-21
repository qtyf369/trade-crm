@echo off
cd /d "%~dp0"
title Trade CRM Server

echo.
echo  ============================================
echo    Trade CRM - Local Edition
echo    Data: trade_crm.db
echo    Close this window to stop
echo  ============================================
echo.

REM 检查python是否可用
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found! Please install Python first.
    pause
    exit /b 1
)

REM 检查main.py是否存在
if not exist main.py (
    echo [ERROR] main.py not found in %cd%
    pause
    exit /b 1
)

echo Starting server...
echo.

start "" "%~dp0loading.html"

python main.py

echo.
echo Server stopped.
pause
