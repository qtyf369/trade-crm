"""
版本管理：一键递增版本号并重新打包

用法：
    python bump_version.py            # 递增修订号 0.3.0 -> 0.3.1
    python bump_version.py minor      # 0.3.0 -> 0.4.0
    python bump_version.py major      # 0.3.0 -> 1.0.0
    python bump_version.py set 0.4.0 # 指定版本

版本号只存在一处：main.py 的 APP_VERSION。
打包时 build_exe.py 会读取它，写进 version.json 供自动更新判断用。
"""
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(BASE, "main.py")
APP_RE = re.compile(r'^(APP_VERSION\s*=\s*")([^"]+)(")', re.M)


def read_version() -> str:
    with open(MAIN, "r", encoding="utf-8") as f:
        m = APP_RE.search(f.read())
    return m.group(2) if m else "0.0.0"


def write_version(v: str) -> None:
    with open(MAIN, "r", encoding="utf-8") as f:
        src = f.read()
    src2 = APP_RE.sub(lambda m: m.group(1) + v + m.group(3), src, count=1)
    with open(MAIN, "w", encoding="utf-8", newline="\n") as f:
        f.write(src2)


def main() -> None:
    cur = read_version()
    parts = [int(x) for x in cur.split(".")] + [0, 0]
    major, minor, patch = parts[0], parts[1], parts[2]

    args = sys.argv[1:]
    if not args:
        kind = "patch"
    else:
        kind = args[0]

    if kind == "set":
        if len(args) < 2:
            print("用法: python bump_version.py set 0.4.0")
            sys.exit(1)
        new = args[1]
    elif kind == "major":
        new = f"{major + 1}.0.0"
    elif kind == "minor":
        new = f"{major}.{minor + 1}.0"
    elif kind == "patch":
        new = f"{major}.{minor}.{patch + 1}"
    else:
        print("用法: python bump_version.py [patch|minor|major|set X.Y.Z]")
        sys.exit(1)

    write_version(new)
    print(f"版本号: {cur} -> {new}")
    print("接下来执行：")
    print("  python build_exe.py          # 打包绿色版")
    print("  python build_installer.py    # 打包安装器")
    print("  python publish_release.py    # 上传到 GitHub Release（可选）")


if __name__ == "__main__":
    main()
