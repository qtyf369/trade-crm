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

# 随绿色版一起分发的中文说明（写成常量便于维护）
README_TEXT = """外贸 CRM  使用说明
================================================

【第一次用】就三步
    1. 双击「启动外贸CRM.exe」
    2. 等 2 秒，浏览器会自动打开
    3. 直接用（客户数据会自动从云端同步下来）

    就这样，不用注册、不用登录、不用设置任何东西。

    以后想再打开：双击桌面上的「外贸CRM」图标即可
    （第一次启动时会自动帮你创建）。


【数据在哪】
    就在本文件夹的 data 文件夹里。整个文件夹拷走 = 完整备份。


【换电脑】
    把整个文件夹复制到新电脑，双击启动，数据自动同步。


【更新版本】
    1. 先退出：右下角托盘图标 → 右键 →「退出程序」
    2. 把新版本里的文件全部复制到本文件夹，选「覆盖」
       ※ 千万别删 data 文件夹，那是你的数据
    3. 启动即可


【其他小提示】
    · 字太小？ 在浏览器里按住 Ctrl 滚动滚轮，或按 Ctrl + 加号/减号，
      浏览器会记住，下次打开还是这个大小。
    · 想手动备份/还原：界面左侧「设置」→「数据备份」。
    · 第一次启动如果 Windows 提示「已保护你的电脑」，
      点「更多信息」→「仍要运行」。
    · 不要把本文件夹放在 C:\\Program Files 里，放到 D 盘或桌面都行。
"""


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

    # 是否单文件模式（默认 onedir 绿色版）
    onefile = "--onefile" in sys.argv

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
        "--onedir" if not onefile else "--onefile",
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

    if onefile:
        exe = os.path.join(DIST_DIR, f"{APP_NAME}.exe")
        if not os.path.exists(exe):
            sys.exit("打包失败：未找到生成的 exe")
        size_mb = os.path.getsize(exe) / (1024 * 1024)
        print()
        print("打包完成（单文件模式）！")
        print(f"  文件：{exe}")
        print(f"  体积：{size_mb:.1f} MB")
        print("  注意：单文件每次启动需解压到 C 盘临时目录，较慢。")
        return

    # ---------- onedir 绿色版：整理成可直接分发的文件夹 ----------
    app_dir = os.path.join(DIST_DIR, APP_NAME)
    if not os.path.isdir(app_dir):
        sys.exit("打包失败：未生成目录")

    # 主程序改名更直观
    src_exe = os.path.join(app_dir, f"{APP_NAME}.exe")
    if os.path.exists(src_exe):
        os.replace(src_exe, os.path.join(app_dir, "启动外贸CRM.exe"))

    # 预置坚果云配置：随包分发，用户解压后无需再手动绑定
    src_cfg = os.path.join(BASE, "config.json")
    if os.path.exists(src_cfg):
        import json as _json
        try:
            with open(src_cfg, "r", encoding="utf-8-sig") as f:
                cfg = _json.load(f)
            preset = {
                "webdav_url": cfg.get("webdav_url", ""),
                "webdav_user": cfg.get("webdav_user", ""),
                "webdav_pass": cfg.get("webdav_pass", ""),
                "auto_sync": True,
            }
            # 放到 data 目录：首次启动即视为已绑定，自动拉取云端数据
            preset_dir = os.path.join(app_dir, "data")
            os.makedirs(preset_dir, exist_ok=True)
            with open(os.path.join(preset_dir, "config.json"), "w", encoding="utf-8") as f:
                _json.dump(preset, f, ensure_ascii=False, indent=2)
            print("  已预置坚果云配置（用户无需手动绑定）")
        except Exception as e:
            print(f"  警告：预置配置失败 {e}")

    # 放入使用说明
    readme = os.path.join(app_dir, "使用说明.txt")
    with open(readme, "w", encoding="utf-8-sig") as f:
        f.write(README_TEXT)

    # 创建桌面快捷方式脚本（可选）
    mk_link = os.path.join(app_dir, "创建桌面快捷方式.bat")
    with open(mk_link, "wb") as f:
        f.write((
            "@echo off\r\n"
            "chcp 936 >nul 2>&1\r\n"
            'set "EXE=%~dp0启动外贸CRM.exe"\r\n'
            'powershell -NoProfile -Command ^\r\n'
            '  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath(\'Desktop\')+\'\\外贸CRM.lnk\');'
            ' $s.TargetPath=\'%EXE%\'; $s.WorkingDirectory=\'%~dp0\'; $s.IconLocation=\'%EXE%\'; $s.Save()"\r\n'
            "echo 桌面快捷方式已创建。\r\n"
            "pause\r\n"
        ).encode("gbk", errors="replace"))

    total = sum(
        os.path.getsize(os.path.join(r, fn))
        for r, _, fs in os.walk(app_dir) for fn in fs
    )
    print()
    print("打包完成（绿色版文件夹）！")
    print(f"  目录：{app_dir}")
    print(f"  体积：{total / (1024 * 1024):.1f} MB")
    print()
    print("分发方式：")
    print("  1) 把整个文件夹压缩成 zip 发给对方；")
    print("  2) 对方解压到任意位置，双击「启动外贸CRM.exe」即可使用；")
    print("  3) 数据保存在文件夹内 data 子目录，整个文件夹可拷贝备份。")
    print()
    print("如需单个 exe： python build_exe.py --onefile")


if __name__ == "__main__":
    main()
