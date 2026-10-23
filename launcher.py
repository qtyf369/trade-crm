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
        webbrowser.open(APP_URL)

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
        webbrowser.open(APP_URL)
        print("检测到 CRM 已经在运行，已为你打开页面。")
        time.sleep(1.5)
        return 0

    import threading

    def opener():
        if _wait_ready():
            webbrowser.open(APP_URL)

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
