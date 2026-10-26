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
    # 业务模块必须显式声明：launcher.py 里是函数内延迟 import，
    # 某些 PyInstaller 版本不会收集到，会导致打出来的 exe 用旧代码或缺路由
    "main",
    "constants",
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
    # 拼音搜索
    "pypinyin",
    "pypinyin.contrib",
    "pypinyin.style",
    "pypinyin.phonetic_data",
    "pypinyin.phonetic_data.phrases_dict",
    "pypinyin.phonetic_data.pinyin_dict",
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
    # main.py 也作为数据文件打入，确保代码一定是最新的
    (os.path.join(BASE, "main.py"), "."),
]

EXCLUDES = [
    "tkinter.test", "test", "unittest", "pydoc_data",
    "numpy", "pandas", "matplotlib", "scipy",
]

# 随绿色版一起分发的中文说明（写成常量便于维护）
README_TEXT = """外贸 CRM  使用说明
================================================

【第一次用】三步
    1. 双击「启动外贸CRM.exe」（不会弹出黑色窗口，请放心）
    2. 等 2 秒，浏览器会自动打开
    3. 直接开始用（首次打开是空白账本，可先录入自己的客户）

    以后想再打开：
      · 双击桌面上的「外贸CRM」图标（第一次启动时会自动帮你创建）
      · 或双击屏幕右下角托盘里的蓝色圆形图标
    托盘图标悬停可以看到当前版本号；右键托盘图标可以
    打开页面 / 手动同步 / 打开数据文件夹 / 退出程序。
    退出程序后，后台服务同时关闭。


【想要多台电脑同步】绑定自己的坚果云
    1. 点左上角头像 →「绑定坚果云账号」
    2. 填入你自己的坚果云邮箱和应用密码
       应用密码在坚果云网页：账户信息 → 安全选项 → 添加应用 → 生成密码
    3. 保存后点「同步数据」，选择：
         · 融合   —— 两端数据合并，都不会丢（推荐）
         · 以本地为准 —— 用本机的覆盖云端
         · 以云端为准 —— 用云端的覆盖本机

    绑定之后，各台电脑的改动会自动同步，不用再手动操作。


【数据在哪】
    就在本文件夹的 data 文件夹里。
    整个文件夹拷走 = 完整备份。


【换电脑】
    把整个文件夹复制到新电脑，双击启动，
    再绑定同一个坚果云账号、点「融合」即可。


【更新版本】
    用新版「安装器」升级：双击新版安装器 exe，
    它会自动找到已安装的位置，点「一键升级」即可。
    你的数据（data 文件夹）和设置都会完整保留，
    升级完成后会自动启动新版。

    程序界面里没有联网自动更新功能，请通过安装器升级。


【其他小提示】
    · 字太小？ 在浏览器里按住 Ctrl 滚动滚轮，或按 Ctrl + 加号/减号，
      浏览器会记住，下次打开还是这个大小。
    · 想备份/还原数据：界面左侧「设置」里可以操作。
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
        "--windowed",             # 无黑框：启动时不再弹 cmd 控制台窗口
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

    # 安全：绝不能把开发者的坚果云账号密码打进发布包。
    # 每个用户首次启动都是全新空白账本（离线），绑定自己的坚果云后再同步。
    leaked = os.path.join(app_dir, "data", "config.json")
    if os.path.exists(leaked):
        os.remove(leaked)
    # 同时清理任何残留的用户数据，确保发布包干净
    stale_data = os.path.join(app_dir, "data")
    if os.path.isdir(stale_data) and not os.listdir(stale_data):
        os.rmdir(stale_data)

    # 写入版本号（自动更新用来比对）
    import re as _re
    m = _re.search(r"APP_VERSION\s*=\s*\"([^\"]+)\"", open(os.path.join(BASE, "main.py"), encoding="utf-8").read())
    ver = m.group(1) if m else "0.0.0"
    with open(os.path.join(app_dir, "version.json"), "w", encoding="utf-8") as f:
        f.write('{"version": "%s"}\n' % ver)
    print("  版本号:", ver)

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

    # 发布前安全审计：确保包里不含任何个人凭据或历史数据
    forbidden = ["config.json", "trade_crm.db", "ui_settings.json", "sync_state.json", "profile.json"]
    hits = []
    for r, _, fs in os.walk(app_dir):
        for fn in fs:
            if fn in forbidden:
                hits.append(os.path.join(r, fn))
    if hits:
        sys.exit(
            "打包中止：发布包中检测到个人数据，请勿分发！\n  " + "\n  ".join(hits)
        )

    total = sum(
        os.path.getsize(os.path.join(r, fn))
        for r, _, fs in os.walk(app_dir) for fn in fs
    )
    print()
    print("打包完成（绿色版文件夹）！")
    print(f"  目录：{app_dir}")
    print(f"  体积：{total / (1024 * 1024):.1f} MB")
    print("  安全审计：通过（不含账号密码与任何历史数据）")
    print()
    print("分发方式：")
    print("  1) 把整个文件夹压缩成 zip 发给对方；")
    print("  2) 对方解压到任意位置，双击「启动外贸CRM.exe」即可使用；")
    print("  3) 首次打开是空白账本，绑定自己的坚果云后才多端同步。")
    print()
    print("如需单个 exe： python build_exe.py --onefile")


if __name__ == "__main__":
    main()
