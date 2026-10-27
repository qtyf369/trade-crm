@echo off
chcp 936 >nul 2>&1
cd /d "%~dp0"

REM 读取上次使用的端口（config.json 的 local_port），默认 8000
set "PORT=8000"
python -c "import json;v=(json.load(open('config.json',encoding='utf-8-sig')) or {}).get('local_port');print(v if isinstance(v,int) and 1024<=v<=65535 else 8000)" > "%TEMP%\crm_port.txt" 2>nul
set /p PORT=<"%TEMP%\crm_port.txt"
del "%TEMP%\crm_port.txt" >nul 2>&1

REM 该端口上如果跑的已经是本 CRM（有 /api/version 应答），直接打开页面
curl -s -o nul -m 2 "http://127.0.0.1:%PORT%/api/version" >nul 2>&1
if not errorlevel 1 (
    start "" "http://127.0.0.1:%PORT%"
    exit /b 0
)

python --version >nul 2>&1
if errorlevel 1 (
    echo 未找到 Python，请先安装 Python 3.10+ 并加入 PATH。
    pause
    exit /b 1
)

REM 依赖齐全则直接启动；缺失时自动补装（仅首次较慢）
python -c "import fastapi, uvicorn, openpyxl, requests, python_multipart" >nul 2>&1
if errorlevel 1 (
    echo 正在安装依赖，请稍候...
    python -m pip install -q --disable-pip-version-check -r requirements.txt
    if errorlevel 1 (
        echo 依赖安装失败，请手动执行：
        echo     python -m pip install -r requirements.txt
        pause
        exit /b 1
    )
)

REM 用 pythonw 启动：无控制台黑框；托盘图标右键退出 = 完全退出
REM 端口冲突由 main.py/launcher 的备用端口逻辑处理
start "" pythonw main.py
exit /b 0