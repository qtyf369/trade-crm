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
README_TEXT = """外贸 CRM 绿色版
========================

一、怎么启动
    双击本文件夹里的「启动外贸CRM.exe」
    等 1-2 秒会自动打开浏览器，看到界面就可以用了。
    退出：右下角系统托盘图标 → 右键 →「退出程序」

    想要桌面图标：双击「创建桌面快捷方式.bat」，桌面上就会出现「外贸CRM」。


二、数据存在哪
    全部在 本文件夹\\data 文件夹里：
        trade_crm.db     客户和跟进记录
        config.json      坚果云账号
        ui_settings.json 主题、配色
        backups\\         自动备份

    整个文件夹复制走 = 完整备份。可以放 U 盘直接带走使用。


三、换电脑 / 多台电脑用
    1. 把整个文件夹复制到新电脑，双击启动；
    2. 在左上角头像菜单里绑定坚果云（首次需要）；
    3. 点「同步数据」→ 选「融合」，把云端数据拉下来。

    绑定坚果云后，各台电脑的数据会自动保持一致。


四、更新到新版本（重要，请看清楚）

    【推荐做法】保留数据更新 —— 数据不会丢
        1) 先退出程序（托盘右键 → 退出程序）
        2) 把新版本文件夹里的所有内容，复制到旧文件夹里，
           选择「覆盖」。  ※ 不要动 data 文件夹
        3) 启动即可，数据都在。

    【不推荐】直接删掉旧文件夹再放新文件夹 —— 数据会被清空！
        如果已经这么做了，用下面的办法找回：
          a) 看旧文件夹还在不在回收站，还原出来即可；
          b) 或者从坚果云同步回来：绑定坚果云后点「同步数据」→ 选「融合」。

    更新前建议先在 设置 → 数据备份 里点一次「立即备份一份」。


五、其他说明
    · 显示大小：在浏览器里按 Ctrl + 加号/减号，浏览器会记住，下次一样。
    · 备份与恢复：设置 → 数据备份，可以随时备份和还原。
    · 请勿把本文件夹放在 C:\\Program Files 这类没有写入权限的位置，
      否则数据会改存到 C:\\Users\\你的用户名\\AppData\\Local\\TradeCRM。
    · 首次启动 Windows 可能弹出「已保护你的电脑」，点「更多信息」→「仍要运行」。
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
