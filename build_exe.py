"""
一键打包脚本：把外贸 CRM 打成单文件 exe（绿色版）

用法： python build_exe.py
产物： dist_exe/外贸CRM.exe

打包内容：
- launcher.py 作为入口（负责重复启动检测、自动开浏览器、异常兜底）
- main.py、constants.py 业务代码
- dist/output 与 dist/output_resource（前端构建产物）
- 隐藏导入：uvicorn 运行时动态加载的模块（否则打出来的包启动即崩）
"""
import os
import shutil
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
APP_NAME = "外贸CRM"
DIST_DIR = os.path.join(BASE, "dist_exe")
BUILD_DIR = os.path.join(BASE, "build_exe")

# uvicorn / 标准库动态导入所需的隐藏依赖
HIDDEN_IMPORTS = [
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "h11",
    "anyio",
    "sniffio",
    "email.mime",
    "email.utils",
    "sqlite3",
    "openpyxl",
    "openpyxl.cell._writer",
    "multipart",
    "python_multipart",
    "requests",
    "urllib3",
    "charset_normalizer",
    "idna",
    "certifi",
    "pystray",
    "pystray._win32",
    "PIL",
    "PIL.Image",
    "PIL.ImageDraw",
    "tkinter",
    "tkinter.messagebox",
]

# 需要一并打进 exe 的静态资源（源路径 -> exe 内目标路径）
DATAS = [
    (os.path.join(BASE, "dist", "output"), "dist/output"),
    (os.path.join(BASE, "dist", "output_resource"), "dist/output_resource"),
    (os.path.join(BASE, "constants.py"), "."),
]

EXCLUDES = [
    "tkinter.test", "test", "unittest", "pydoc_data",
    "numpy", "pandas", "matplotlib", "scipy",
]


def run(cmd):
    print(">>", " ".join(cmd))
    res = subprocess.run(cmd, cwd=BASE)
    if res.returncode != 0:
        sys.exit(res.returncode)


def main() -> None:
    # 0. 前置检查
    for p in ["launcher.py", "main.py", "constants.py"]:
        if not os.path.exists(os.path.join(BASE, p)):
            sys.exit(f"缺少文件：{p}")
    front = os.path.join(BASE, "dist", "output", "index.html")
    if not os.path.exists(front):
        sys.exit("缺少前端产物，请先执行： npm run build")

    # 1. 清理旧产物
    for d in (DIST_DIR, BUILD_DIR):
        if os.path.isdir(d):
            shutil.rmtree(d, ignore_errors=True)

    # 2. 组装 PyInstaller 参数
    sep = ";" if os.name == "nt" else ":"
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name", APP_NAME,
        "--distpath", DIST_DIR,
        "--workpath", BUILD_DIR,
        "--specpath", BUILD_DIR,
        "--noconsole",          # 无黑框：双击直接开浏览器
        "--noupx",
    ]
    for mod in HIDDEN_IMPORTS:
        cmd += ["--hidden-import", mod]
    for mod in EXCLUDES:
        cmd += ["--exclude-module", mod]
    for src, dst in DATAS:
        cmd += ["--add-data", f"{src}{sep}{dst}"]
    cmd.append(os.path.join(BASE, "launcher.py"))

    run(cmd)

    exe = os.path.join(DIST_DIR, f"{APP_NAME}.exe")
    if not os.path.exists(exe):
        sys.exit("打包失败：未找到生成的 exe")
    size_mb = os.path.getsize(exe) / (1024 * 1024)
    print()
    print("打包完成！")
    print(f"  文件：{exe}")
    print(f"  体积：{size_mb:.1f} MB")
    print()
    print("分发方式：把 exe 发给对方，双击即可运行。")
    print("首次运行会在 exe 同目录自动创建 data 文件夹存放数据。")


if __name__ == "__main__":
    main()
