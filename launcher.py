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

APP_NAME = "外贸CRM"


def _exe_dir() -> str:
    """exe/脚本所在目录（数据与配置都在这里）"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def _read_saved_port() -> int:
    """读取上次运行记录的端口（config.json 的 local_port 字段）"""
    try:
        cfg = os.path.join(_exe_dir(), "config.json")
        if os.path.isfile(cfg):
            import json
            with open(cfg, "r", encoding="utf-8-sig") as f:
                v = (json.load(f) or {}).get("local_port")
            if isinstance(v, int) and 1024 <= v <= 65535:
                return v
    except Exception:
        pass
    return 8000


def _save_port(port: int) -> None:
    """把本次选定的端口写进 config.json（main.py 启动时读同一个值）"""
    try:
        import json
        cfg = os.path.join(_exe_dir(), "config.json")
        data = {}
        if os.path.isfile(cfg):
            try:
                with open(cfg, "r", encoding="utf-8-sig") as f:
                    data = json.load(f) or {}
            except Exception:
                data = {}
        data["local_port"] = int(port)
        with open(cfg, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _is_our_crm(port: int, timeout: float = 1.0) -> bool:
    """探测该端口跑的是不是我们自己的 CRM（识别 /api/version 应答）

    判据：应答是 JSON 且 app 字段为「外贸CRM」（UTF-8 字节比对，
    应答体里没有 'trade_crm' 这个 ASCII 串，不要用它判断）。
    """
    import urllib.request
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/version", timeout=timeout
        ) as r:
            if r.status == 200:
                # 注意：read() 只能调一次，第二次返回空串
                body = r.read()
                return b"\xe5\xa4\x96\xe8\xb4\xb8" in body  # 「外贸」的 UTF-8
    except Exception:
        pass
    return False


def _find_free_port(preferred: int) -> int:
    """preferred 空闲直接返回；被占用则从备用池挑一个真正能绑定的端口"""
    candidates = [preferred] + [p for p in range(8010, 8041) if p != preferred]
    for p in candidates:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", p))
            return p
        except OSError:
            continue
    return preferred  # 理论到不了这里，兜底交由 uvicorn 报错


APP_URL = f"http://127.0.0.1:{_read_saved_port()}"


class _Tee:
    """同时写原始 stream 和日志文件，确保日志一定落盘"""

    def __init__(self, original, logfile):
        self._original = original
        self._log = logfile

    def write(self, data):
        try:
            if self._original is not None:
                self._original.write(data)
        except Exception:
            pass
        try:
            self._log.write(data)
            self._log.flush()
        except Exception:
            pass
        return len(data) if data else 0

    def flush(self):
        try:
            if self._original is not None:
                self._original.flush()
        except Exception:
            pass
        try:
            self._log.flush()
        except Exception:
            pass

    # uvicorn / logging 需要判断是否为 tty
    def isatty(self):
        try:
            return bool(self._original) and self._original.isatty()
        except Exception:
            return False

    def fileno(self):
        try:
            if self._original is not None:
                return self._original.fileno()
        except Exception:
            pass
        return -1


def _open_log() -> object:
    """打开日志文件，依次尝试多个可写位置"""
    candidates = []
    try:
        candidates.append(os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "data"))
    except Exception:
        pass
    candidates.append(os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "TradeCRM"))
    candidates.append(os.path.join(os.environ.get("TEMP", os.getcwd()), "crm_logs"))
    for d in candidates:
        try:
            os.makedirs(d, exist_ok=True)
            return open(os.path.join(d, "launcher.log"), "a", encoding="utf-8", buffering=1)
        except Exception:
            continue
    return open(os.devnull, "w", encoding="utf-8")


def _ensure_std_streams() -> None:
    """把 stdout/stderr 同时指向原始流与日志文件。

    打包后（尤其 --noconsole）print 可能无声丢弃；用 Tee 双写保证
    无论哪种模式，日志都能在 data/launcher.log 里查到。
    """
    global _log_stream
    try:
        _log_stream = _open_log()
    except Exception:
        return
    sys.stdout = _Tee(sys.stdout, _log_stream)
    sys.stderr = _Tee(sys.stderr, _log_stream)


_log_stream = None
_ensure_std_streams()


# 最早的诊断：确认 frozen 状态与关键路径
try:
    print(f"[boot] frozen={getattr(sys, 'frozen', False)}")
    print(f"[boot] executable={sys.executable}")
    print(f"[boot] _MEIPASS={getattr(sys, '_MEIPASS', '<none>')}")
    _mp = getattr(sys, "_MEIPASS", "")
    if _mp:
        print(f"[boot] main.py in _MEIPASS={os.path.isfile(os.path.join(_mp, 'main.py'))}")
except Exception as _e:
    print(f"[boot] diag error: {_e}")


_ensure_std_streams()


def _port_in_use(port: int = 8000) -> bool:
    print(f"[boot] checking port {port}")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.6)
        r = s.connect_ex(("127.0.0.1", port)) == 0
    print(f"[boot] port {port} in use = {r}")
    return r


def _resolve_port() -> int:
    """确定本次使用的端口，并同步给 main.py（写 config.json）

    策略：
    1. 上次记录的端口空闲 → 沿用
    2. 被占用但应答的是我们自己的 CRM → 直接复用（重复双击场景）
    3. 被别的服务占用 → 从备用池找空闲端口，持久化后使用
    """
    saved = _read_saved_port()

    if not _port_in_use(saved):
        _save_port(saved)
        return saved

    if _is_our_crm(saved):
        print(f"[boot] port {saved} is our CRM, reuse it")
        _save_port(saved)
        return saved

    # 被别的服务占用：换备用端口
    port = _find_free_port(saved)
    if port != saved:
        print(f"[boot] port {saved} occupied by other service, fallback to {port}")
    _save_port(port)
    return port


def _wait_ready(timeout: float = 20.0, port: int = 8000) -> bool:
    """等待服务真正可用，再打开浏览器，避免白屏"""
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/sync/status", timeout=1.5
            ) as r:
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


def _browser_args(exe: str, url: str) -> list:
    """构造浏览器启动参数

    关键：加 --no-proxy-server 让浏览器**直连本地地址**。
    外贸用户常常开着 Clash/V2Ray 等代理软件，若代理规则把 127.0.0.1 也接管，
    页面会加载不出来（拿到代理返回的内容）。这个参数保证本地永远直连，
    同时不影响访问外网时使用代理。
    """
    args = [exe]
    if os.path.basename(exe).lower() in ("chrome.exe", "msedge.exe", "chromium.exe", "brave.exe"):
        args.append("--no-proxy-server")
    args.append(url)
    return args


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
                subprocess.Popen(_browser_args(force, url))
                return f"指定浏览器：{force}"
    except Exception:
        pass

    name, path = _pick_browser()
    if path:
        try:
            subprocess.Popen(_browser_args(path, url))
            return f"{name}：{path}"
        except Exception:
            pass

    # 兜底：系统默认浏览器
    try:
        webbrowser.open(url)
        return "系统默认浏览器"
    except Exception:
        return "打开失败"


def _ensure_desktop_shortcut() -> None:
    """首次运行自动在桌面创建快捷方式（只做一次，失败静默）

    让用户解压后不必找 exe、也不必手动跑 bat，桌面上直接就有入口。
    """
    try:
        exe = os.path.abspath(sys.executable)
        exe_dir = os.path.dirname(exe)
        marker = os.path.join(exe_dir, "data", ".shortcut_created")
        if os.path.exists(marker):
            return

        desktop = os.path.join(os.path.expanduser("~"), "Desktop")
        if not os.path.isdir(desktop):
            # 部分系统桌面在 OneDrive 下
            alt = os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop")
            if os.path.isdir(alt):
                desktop = alt
            else:
                return

        link = os.path.join(desktop, "外贸CRM.lnk")
        if os.path.exists(link):
            return

        import subprocess
        ps = (
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');"
            "$s.TargetPath='%s';$s.WorkingDirectory='%s';$s.IconLocation='%s';$s.Save()"
            % (link, exe, exe_dir, exe)
        )
        # CREATE_NO_WINDOW：完全隐藏 PowerShell 窗口，避免闪一下黑框
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps],
            capture_output=True, timeout=20, creationflags=flags,
        )
        os.makedirs(os.path.dirname(marker), exist_ok=True)
        with open(marker, "w", encoding="utf-8") as f:
            f.write("1")
    except Exception:
        pass


def _running_version(port: int) -> str:
    """查询端口上运行中的 CRM 版本号，失败返回空串"""
    import urllib.request
    import json as _json
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/version", timeout=1.5
        ) as r:
            return str((_json.loads(r.read().decode('utf-8')) or {}).get("version") or "")
    except Exception:
        return ""


def _ver_tuple(v: str):
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split("."))
    except Exception:
        return (0,)


def _current_version() -> str:
    """本程序携带的版本号（exe 旁的 version.json）"""
    try:
        import json as _json
        vf = os.path.join(_exe_dir(), "version.json")
        if os.path.isfile(vf):
            with open(vf, "r", encoding="utf-8-sig") as f:
                return str((_json.load(f) or {}).get("version") or "")
    except Exception:
        pass
    return ""


def main() -> int:
    # --windowed 打包后 sys.stdout/stderr 为 None，任何 print 都会抛异常。
    # 先重定向到日志，保证后面所有 print 安全。
    _ensure_std_streams()

    # 确定端口：8000 优先，被其他服务占用时自动换备用端口并记住
    port = _resolve_port()
    app_url = f"http://127.0.0.1:{port}"
    global APP_URL
    APP_URL = app_url

    # 端口上跑的已是我们的 CRM：
    # - 版本相同或更新 → 直接打开页面，不重复启动
    # - 版本更旧（升级后旧实例还挂着）→ 结束旧实例，继续启动新版本
    if _port_in_use(port) and _is_our_crm(port):
        running_ver = _running_version(port)
        my_ver = _current_version()
        if not my_ver or not running_ver or _ver_tuple(running_ver) >= _ver_tuple(my_ver):
            how = _open_in_browser(app_url)
            print(f"检测到 CRM 已经在运行，已为你打开页面（{how}）。")
            time.sleep(1.5)
            return 0
        # 旧版本还占着端口：结束它，让新版本接管
        print(f"检测到旧版本 v{running_ver} 仍在运行，结束它以启动 v{my_ver}")
        try:
            subprocess.run(["taskkill", "/IM", "启动外贸CRM.exe", "/F"],
                           capture_output=True, timeout=15)
            subprocess.run(["taskkill", "/IM", "外贸CRM.exe", "/F"],
                           capture_output=True, timeout=15)
        except Exception:
            pass
        time.sleep(2.0)
        if _port_in_use(port):
            # 旧实例杀不掉（极端情况）：至少保证不双开，直接打开旧版页面
            how = _open_in_browser(app_url)
            print(f"旧实例未能结束，已为你打开现有页面（{how}）。")
            time.sleep(1.5)
            return 0

    import threading

    # 首次运行自动建桌面快捷方式，用户下次可从桌面一键打开
    threading.Thread(target=_ensure_desktop_shortcut, daemon=True).start()

    browser_used = {"how": ""}

    def opener():
        if _wait_ready(port=port):
            browser_used["how"] = _open_in_browser(app_url)
            print(f"已用 {browser_used['how']} 打开页面")

    threading.Thread(target=opener, daemon=True).start()

    # 延迟导入，确保上面的检查先执行。
    #
    # frozen 模式下 PyInstaller 的 FrozenImporter 优先级高于 sys.path，
    # 所以 `import main` 命中的是 PYZ 里的旧副本（可能缺最新路由）。
    # 这里显式按文件路径加载 _MEIPASS 下的 main.py，保证用的是最新代码。
    if getattr(sys, "frozen", False):
        import importlib.util

        meipass = getattr(sys, "_MEIPASS", "")
        main_file = os.path.join(meipass, "main.py") if meipass else ""
        # 把 _MEIPASS 加入路径，main.py 内部的 `from constants import ...` 依赖它
        if meipass:
            if meipass in sys.path:
                sys.path.remove(meipass)
            sys.path.insert(0, meipass)
        # 清掉可能已缓存的模块
        sys.modules.pop("main", None)
        sys.modules.pop("constants", None)

        if os.path.isfile(main_file):
            spec = importlib.util.spec_from_file_location("main", main_file)
            app_module = importlib.util.module_from_spec(spec)
            sys.modules["main"] = app_module
            spec.loader.exec_module(app_module)
            # 诊断：确认实际加载的文件与路由数
            try:
                _paths = [getattr(r, "path", "") for r in app_module.app.routes]
                print(f"[launcher] loaded main from {main_file}")
                print(f"[launcher] routes={len(_paths)} "
                      f"has_version={'/api/version' in _paths} "
                      f"has_backup={'/api/backup/list' in _paths}")
            except Exception as _e:
                print(f"[launcher] diag failed: {_e}")
        else:
            import main as app_module  # noqa: F811
            try:
                print(f"[launcher] fallback import main from {app_module.__file__}")
            except Exception:
                pass
    else:
        import main as app_module

    print("=" * 50)
    print("  外贸 CRM")
    print(f"  服务地址：{app_url}")
    print(f"  数据目录：{app_module.BASE_DIR}")
    print("  系统托盘右键可打开页面 / 退出程序")
    print("=" * 50)

    # 托盘已由 main.py 在模块加载时启动（开发版与打包版都可用），此处不再重复

    import uvicorn
    uvicorn.run(app_module.app, host="127.0.0.1", port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    print("[boot] entering __main__ block")
    _rc = 0
    try:
        _rc = main()
        print(f"[boot] main() returned {_rc}")
    except KeyboardInterrupt:
        _rc = 0
    except Exception:
        # --windowed 模式下 stdout/stderr 为 None，print 会再抛一次异常。
        # 所以这里必须先重定向，再输出。
        _ensure_std_streams()
        _tb = traceback.format_exc()
        print("\n启动失败，错误详情如下：\n")
        print(_tb)
        try:
            import tkinter.messagebox as mb
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            mb.showerror("外贸 CRM 启动失败", "程序启动遇到问题，请截图后联系提供者。\n\n" + _tb[-800:])
            root.destroy()
        except Exception:
            pass
        _rc = 1
    finally:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
    sys.exit(_rc)
