@echo off
cd /d "%~dp0"
title Trade CRM Server

echo.
echo  ============================================
echo    Trade CRM - Local Edition (v0.2)
echo    Data: trade_crm.db
echo    Close this window to stop
echo  ============================================
echo.

REM 检查python是否可用
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found!
    echo.
    echo  请先安装 Python 3.10+，然后执行：
    echo    pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

REM 检查依赖是否安装（首次运行最常见的问题）
python -c "import fastapi, uvicorn, openpyxl, requests, multipart" >nul 2>&1
if errorlevel 1 (
    echo [INFO] 检测到缺少依赖，正在自动安装...
    echo.
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [ERROR] 依赖安装失败，请手动执行：
        echo    pip install -r requirements.txt
        echo.
        pause
        exit /b 1
    )
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
