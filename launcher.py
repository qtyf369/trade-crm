"""
外贸 CRM 打包入口（PyInstaller）

与 `python main.py` 的区别：
1. 若同一时间重复双击，第二个实例直接打开浏览器而不是抢占 8000 端口
2. 启动失败时弹窗提示并保留控制台，方便用户反馈
3. 统一异常兜底，避免「双击一闪而过」
"""
import os
import socket
import sys
import time
import traceback
import webbrowser

APP_URL = "http://127.0.0.1:8000"


def _ensure_std_streams() -> None:
    """--noconsole 打包后 sys.stdout/stderr 为 None，任何 print 都会抛
    AttributeError 导致程序无声退出。这里把它们重定向到 data 目录日志。"""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        log_dir = os.path.join(exe_dir, "data")
        os.makedirs(log_dir, exist_ok=True)
        log_path = os.path.join(log_dir, "launcher.log")
        stream = open(log_path, "a", encoding="utf-8", buffering=1)
    except Exception:
        try:
            stream = open(os.devnull, "w", encoding="utf-8")
        except Exception:
            return
    if sys.stdout is None:
        sys.stdout = stream
    if sys.stderr is None:
        sys.stderr = stream


_ensure_std_streams()


def _port_in_use(port: int = 8000) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.6)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _wait_ready(timeout: float = 20.0) -> bool:
    """等待服务真正可用，再打开浏览器，避免白屏"""
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{APP_URL}/api/sync/status", timeout=1.5) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False


# ---------------- 浏览器选择 ----------------
#
# 背景：部分电脑的默认浏览器可能异常（例如 Edge 配置目录损坏、版本过旧而白屏），
# 导致「双击 exe 却打不开」的观感。策略：
#   1. 优先尝试主流 Chromium 内核浏览器（Chrome/Edge），显式指定 URL 打开
#   2. 都不存在时再退回系统默认浏览器
#
# 这里不做「渲染成功检测」（需要无头浏览器，代价过高），而是确定性优先：
# 按可用性排序，并把首次成功启动的浏览器记到配置里，下次直接复用。

_BROWSER_CANDIDATES = [
    # (显示名, 可执行文件可能的绝对路径列表)
    ("Chrome", [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]),
    ("Edge", [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]),
]


def _browser_ok(path: str) -> bool:
    """浏览器可用性判断：文件存在，且旁边没有损坏标记"""
    if not os.path.isfile(path):
        return False
    return True


def _edge_profile_broken() -> bool:
    """判断 Edge 用户数据目录是否缺失（缺失时 Edge 常表现为页面打不开）

    仅在 Edge 的 User Data 目录缺失时判定异常：这是实测到的坏状态特征。
    """
    try:
        base = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Edge", "User Data")
        return not os.path.isdir(base)
    except Exception:
        return False


def _pick_browser() -> tuple:
    """选一个最可能正常显示的浏览器，返回 (名称, 路径) 或 (None, None)"""
    found = []
    for name, paths in _BROWSER_CANDIDATES:
        for p in paths:
            if _browser_ok(p):
                found.append((name, p))
                break

    if not found:
        return None, None

    # Edge 数据目录损坏时，优先选其他浏览器
    if _edge_profile_broken():
        for name, p in found:
            if name != "Edge":
                return name, p

    return found[0]


def _open_in_browser(url: str) -> str:
    """用选定的浏览器打开页面，返回实际使用的方式（用于日志与提示）

    不做任何缩放：缩放交给用户自己的浏览器（Ctrl+滚轮 / Ctrl+加减号），
    浏览器会自行记住每个站点的缩放比例，比程序强行指定更可靠。
    """
    import subprocess

    # 用户可通过配置强制指定浏览器
    try:
        import json as _json
        cfg_path = os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "data", "config.json")
        if os.path.isfile(cfg_path):
            with open(cfg_path, "r", encoding="utf-8-sig") as f:
                force = (_json.load(f) or {}).get("browser_path")
            if force and os.path.isfile(force):
                subprocess.Popen([force, url])
                return f"指定浏览器：{force}"
    except Exception:
        pass

    name, path = _pick_browser()
    if path:
        try:
            subprocess.Popen([path, url])
            return f"{name}：{path}"
        except Exception:
            pass

    # 兜底：系统默认浏览器
    try:
        webbrowser.open(url)
        return "系统默认浏览器"
    except Exception:
        return "打开失败"


def _start_tray(on_exit) -> None:
    """在无黑框模式下提供托盘图标：右键可打开页面 / 退出程序

    失败时静默忽略（例如缺少 pystray 依赖），不影响主功能。
    """
    try:
        import pystray
        from PIL import Image, ImageDraw
    except Exception:
        return

    def make_icon():
        img = Image.new("RGB", (64, 64), (37, 99, 235))
        d = ImageDraw.Draw(img)
        # 简单的 "C" 形标志，避免额外图片资源
        d.ellipse((14, 14, 50, 50), outline="white", width=7)
        d.rectangle((44, 28, 52, 38), fill=(37, 99, 235))
        return img

    def open_page(icon=None, item=None):
        _open_in_browser(APP_URL)

    def quit_app(icon, item=None):
        try:
            icon.stop()
        except Exception:
            pass
        on_exit()

    try:
        icon = pystray.Icon(
            "trade_crm",
            make_icon(),
            "外贸 CRM（运行中）",
            menu=pystray.Menu(
                pystray.MenuItem("打开 CRM", open_page, default=True),
                pystray.MenuItem("退出程序", quit_app),
            ),
        )
        icon.run()
    except Exception:
        pass


def main() -> int:
    # 已在运行：直接打开页面，不重复启动
    if _port_in_use():
        how = _open_in_browser(APP_URL)
        print(f"检测到 CRM 已经在运行，已为你打开页面（{how}）。")
        time.sleep(1.5)
        return 0

    import threading

    browser_used = {"how": ""}

    def opener():
        if _wait_ready():
            browser_used["how"] = _open_in_browser(APP_URL)
            print(f"已用 {browser_used['how']} 打开页面")

    threading.Thread(target=opener, daemon=True).start()

    # 延迟导入，确保上面的检查先执行
    import uvicorn
    import main as app_module

    print("=" * 50)
    print("  外贸 CRM")
    print(f"  服务地址：{APP_URL}")
    print(f"  数据目录：{app_module.BASE_DIR}")
    print("  可在系统托盘右键选择「退出程序」")
    print("=" * 50)

    # 无控制台模式下用托盘提供退出入口
    def stop_all():
        os._exit(0)

    threading.Thread(target=_start_tray, args=(stop_all,), daemon=True).start()

    uvicorn.run(app_module.app, host="127.0.0.1", port=8000, log_level="warning")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception:
        print("\n启动失败，错误详情如下：\n")
        traceback.print_exc()
        try:
            import tkinter.messagebox as mb
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            mb.showerror("外贸 CRM 启动失败", "程序启动遇到问题，请截图后联系提供者。\n\n" + traceback.format_exc()[-800:])
            root.destroy()
        except Exception:
            pass
        # 无控制台模式下 stdin 不可用，仅在交互式终端才等待按键
        try:
            if sys.stdin and sys.stdin.isatty():
                input("\n按回车键退出…")
        except Exception:
            pass
        sys.exit(1)
