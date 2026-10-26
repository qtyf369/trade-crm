"""打包安装器：单 exe，内嵌完整绿色版程序

产物：dist_exe/外贸CRM安装器_v{ver}.exe
用户拿到这一个文件，双击 → 选目录（或自动检测升级）→ 完成。
"""
import os
import re
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(BASE, "dist_exe")
WORK = os.path.join(BASE, "build_installer")
APP_DIR = os.path.join(DIST, "外贸CRM")

# 读取当前版本号
m = re.search(r'"version"\s*:\s*"([^"]+)"',
              open(os.path.join(APP_DIR, "version.json"), encoding="utf-8-sig").read())
VER = m.group(1) if m else "0.0.0"

HIDDEN = ["pystray", "pystray._win32", "PIL", "PIL.Image", "PIL.ImageDraw",
          "tkinter", "tkinter.messagebox", "tkinter.filedialog", "tkinter.ttk"]


def run(cmd):
    print(">>", " ".join(cmd[:8]), "...")
    res = subprocess.run(cmd, cwd=BASE)
    if res.returncode != 0:
        sys.exit(res.returncode)


def main():
    if not os.path.isfile(os.path.join(APP_DIR, "启动外贸CRM.exe")):
        sys.exit("缺少绿色版程序，请先运行 build_exe.py")

    for d in (WORK, os.path.join(DIST, "installer")):
        if os.path.isdir(d):
            import shutil
            shutil.rmtree(d, ignore_errors=True)

    sep = ";"
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean",
        "--onefile",
        "--windowed",             # 安装器用 GUI，无黑框
        "--name", "外贸CRM安装器",
        "--distpath", os.path.join(DIST, "installer"),
        "--workpath", WORK,
        "--specpath", WORK,
        "--noupx",
    ]
    for mod in HIDDEN:
        cmd += ["--hidden-import", mod]
    # 内嵌整个绿色版（解压后由 installer 资源目录读取）
    cmd += ["--add-data", f"{APP_DIR}{sep}app"]
    cmd.append(os.path.join(BASE, "installer.py"))
    run(cmd)

    out = os.path.join(DIST, "installer", "外贸CRM安装器.exe")
    if not os.path.exists(out):
        sys.exit("安装器打包失败")

    final = os.path.join(DIST, f"外贸CRM安装器_v{VER}.exe")
    os.replace(out, final)

    size = os.path.getsize(final) / 1024 / 1024
    print()
    print(f"安装器已生成：{final}")
    print(f"大小：{size:.1f} MB")
    print()
    print("使用方式：把这一个 exe 发给用户，双击即可安装/升级。")


if __name__ == "__main__":
    main()
