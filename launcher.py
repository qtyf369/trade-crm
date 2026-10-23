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
    print("  注意：关闭此窗口即退出程序")
    print("=" * 50)

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
        input("\n按回车键退出…")
        sys.exit(1)
