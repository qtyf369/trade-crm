"""
一键打包：递增版本号 → 重新构建前端 → 打包绿色版 + 安装器 → 生成 zip

用法：
    python release.py            # 修订号 +1（0.3.0 -> 0.3.1）
    python release.py minor      # 0.3.0 -> 0.4.0
    python release.py major      # 0.3.0 -> 1.0.0
    python release.py set 0.4.0 # 指定版本

产物（都在 dist_exe/）：
    外贸CRM/                      绿色版文件夹
    外贸CRM安装器_vX.Y.Z.exe      安装器（发给客户）
    trade-crm-vX.Y.Z-win64.zip   绿色版压缩包
    release_notes.txt            本次改动摘要（可自行补充）
"""
import os
import re
import subprocess
import sys
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(BASE, "dist_exe")
NODE = r"C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"


def run(cmd, label, cwd=BASE):
    print(f"\n=== {label} ===")
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print((r.stdout or "")[-1500:])
        print((r.stderr or "")[-1500:])
        sys.exit(f"{label} 失败")
    return r.stdout or ""


def main() -> None:
    # 1) 版本号
    out = run([sys.executable, os.path.join(BASE, "bump_version.py")]
              + sys.argv[1:], "递增版本号")
    m = re.search(r"版本号:\s*([\d.]+)\s*->\s*([\d.]+)", out)
    ver = m.group(2) if m else "0.0.0"
    print(f"当前版本: v{ver}")

    # 2) 前端
    if os.path.isdir(os.path.join(BASE, "node_modules")):
        run([NODE, os.path.join(BASE, "node_modules", "vite", "bin", "vite.js"), "build"],
            "构建前端")
    else:
        print("[跳过] 没装 node_modules，前端产物沿用现有的")

    # 3) 绿色版
    run([sys.executable, os.path.join(BASE, "build_exe.py")], "打包绿色版")

    # 4) 安装器
    run([sys.executable, os.path.join(BASE, "build_installer.py")], "打包安装器")

    # 5) zip
    zip_path = os.path.join(DIST, f"trade-crm-v{ver}-win64.zip")
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        app = os.path.join(DIST, "外贸CRM")
        for root, _, files in os.walk(app):
            for fn in files:
                full = os.path.join(root, fn)
                zf.write(full, os.path.relpath(full, app))

    print("\n" + "=" * 56)
    print(f"  打包完成  v{ver}")
    print("=" * 56)
    for name in (f"外贸CRM安装器_v{ver}.exe", f"trade-crm-v{ver}-win64.zip"):
        p = os.path.join(DIST, name)
        if os.path.exists(p):
            print(f"  {name:34s} {os.path.getsize(p)/1024/1024:5.1f} MB")
    print()
    print("  下一步：把「安装器」上传到 GitHub Release，或直接发给客户。")


if __name__ == "__main__":
    main()
