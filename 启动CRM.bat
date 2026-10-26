@echo off
chcp 936 >nul 2>&1
cd /d "%~dp0"

REM 若已在运行，直接打开页面，避免端口占用报错
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo 检测到 CRM 已在运行，正在为你打开页面...
    start "" "http://localhost:8000"
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
start "" pythonw main.py
exit /b 0