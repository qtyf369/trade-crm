"""
外贸 CRM 安装器（双击即用）

设计目标：用户只需要「双击」，其余全自动。

行为：
1. 检测本机是否已装过外贸 CRM（扫描常见位置 + 桌面快捷方式）
2. 未安装 → 选目录全新安装（默认 D:\\外贸CRM），建桌面快捷方式，装完启动
3. 已安装 → 一键升级：自动找到旧目录，结束旧进程，替换程序文件
   （data 数据目录原样保留），升级后自动启动新版

安装器自身由 PyInstaller 打成单 exe，内部携带绿色版程序文件。
"""
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import tkinter as tk
import zipfile
from tkinter import filedialog, messagebox, ttk


def resource_dir() -> str:
    """携带的程序文件目录（打包后在 _MEIPASS/app 内）"""
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
        return os.path.join(base, "app")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist_exe", "外贸CRM")


def app_name() -> str:
    return "外贸CRM"


# ---------------- 安装位置探测 ----------------

def candidate_dirs():
    """所有可能的安装位置（按优先级）"""
    dirs = []
    home = os.path.expanduser("~")
    for base in ("D:\\", "E:\\", "C:\\"):
        dirs.append(os.path.join(base, "外贸CRM"))
    dirs.append(os.path.join(home, "Desktop", "外贸CRM"))
    dirs.append(os.path.join(home, "外贸CRM"))
    return dirs


def desktop() -> str:
    for d in (os.path.join(os.path.expanduser("~"), "Desktop"),
              os.path.join(os.path.expanduser("~"), "OneDrive", "桌面"),
              os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop")):
        if os.path.isdir(d):
            return d
    return ""


def shortcut_target(lnk_path: str) -> str:
    """读取快捷方式指向的 exe 路径（用 PowerShell，避免依赖 win32com）"""
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(New-Object -ComObject WScript.Shell).CreateShortcut('{lnk_path}').TargetPath"],
            capture_output=True, text=True, timeout=15,
        )
        p = (r.stdout or "").strip().strip('"')
        return p if p and os.path.exists(p) else ""
    except Exception:
        return ""


def find_existing() -> list:
    """返回所有已安装位置（有 启动外贸CRM.exe 的目录）

    探测顺序（越靠前越可靠）：
    1. 桌面快捷方式指向的目录（安装器自己创建的，最可靠）
    2. 各磁盘根目录下的 外贸CRM 文件夹
    3. 用户目录下的 外贸CRM 文件夹
    """
    found = []
    seen = set()

    def add(d):
        if not d:
            return
        key = os.path.normcase(os.path.abspath(d))
        if key in seen:
            return
        if os.path.isfile(os.path.join(d, "启动外贸CRM.exe")):
            seen.add(key)
            found.append(d)

    # 0. 安装时记录的路径（最可靠）
    add(remembered_install_path())

    # 1. 桌面快捷方式（最可靠：安装时必定创建）
    dn = desktop()
    if dn:
        for lnk in ("外贸CRM.lnk", "外贸 CRM.lnk"):
            t = shortcut_target(os.path.join(dn, lnk))
            if t:
                add(os.path.dirname(t))
        # 开始菜单
        for base in (os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu"),
                     os.path.join(os.environ.get("PROGRAMDATA", ""), "Microsoft", "Windows", "Start Menu")):
            if base:
                for root, _, files in os.walk(base):
                    for f in files:
                        if f.endswith(".lnk") and "外贸" in f:
                            t = shortcut_target(os.path.join(root, f))
                            if t:
                                add(os.path.dirname(t))
                    if len(found) > 6:
                        break

    # 2. 各磁盘根目录
    for letter in ("D", "E", "F", "C"):
        add(os.path.join(f"{letter}:\\", "外贸CRM"))
        add(os.path.join(f"{letter}:\\", "贸易CRM"))

    # 3. 用户目录与桌面
    home = os.path.expanduser("~")
    add(os.path.join(home, "外贸CRM"))
    add(os.path.join(home, "Desktop", "外贸CRM"))
    add(os.path.join(home, "桌面", "外贸CRM"))
    add(os.path.join(home, "OneDrive", "桌面", "外贸CRM"))
    add(os.path.join(home, "Documents", "外贸CRM"))

    # 4. 最后兜底：各盘一级子目录快速扫描（深度 2，限制耗时）
    if not found:
        for letter in ("D", "E", "C"):
            root_dir = f"{letter}:\\"
            if not os.path.isdir(root_dir):
                continue
            try:
                for entry in os.scandir(root_dir):
                    if not entry.is_dir():
                        continue
                    sub = os.path.join(entry.path, "外贸CRM")
                    add(sub)
                    if len(found) >= 8:
                        break
            except Exception:
                continue
            if found:
                break

    return found


def read_installed_version(app_dir: str) -> str:
    try:
        import json
        with open(os.path.join(app_dir, "version.json"), "r", encoding="utf-8-sig") as f:
            return str((json.load(f) or {}).get("version", ""))
    except Exception:
        return "0.2.0"   # 早期版本没有 version.json


def read_new_version() -> str:
    try:
        import json
        with open(os.path.join(resource_dir(), "version.json"), "r", encoding="utf-8-sig") as f:
            return str((json.load(f) or {}).get("version", ""))
    except Exception:
        return "0.0.0"


# ---------------- 安装 / 升级动作 ----------------

def kill_running() -> bool:
    """结束正在运行的外贸 CRM（托盘退出 + 兜底杀进程）"""
    ok = True
    for name in ("启动外贸CRM", "外贸CRM"):
        try:
            subprocess.run(["taskkill", "/IM", f"{name}.exe", "/F"],
                           capture_output=True, timeout=15)
        except Exception:
            ok = False
    time.sleep(1.5)
    return ok


def install_to(target: str, status=None) -> str:
    """把携带的程序文件复制到 target（升级时跳过 data 与用户配置）"""
    def say(msg):
        if status:
            status(msg)

    src = resource_dir()
    if not os.path.isdir(src):
        raise RuntimeError("安装器内部缺少程序文件（打包异常）")

    say("创建目录…")
    os.makedirs(target, exist_ok=True)

    say("复制程序文件…")
    preserve = {"data"}
    preserve_files = {"config.json", "ui_settings.json", "sync_state.json"}
    n = 0
    for root, dirs, files in os.walk(src):
        rel = os.path.relpath(root, src)
        dst_root = target if rel == "." else os.path.join(target, rel)
        os.makedirs(dst_root, exist_ok=True)
        for d in dirs:
            if d in preserve and rel == ".":
                continue
        for f in files:
            if f in preserve_files and rel == ".":
                continue
            shutil.copy2(os.path.join(root, f), os.path.join(dst_root, f))
            n += 1
    say(f"已复制 {n} 个文件")
    return target


def remember_install_path(target: str) -> None:
    """把安装路径写到 %APPDATA%\\TradeCRM\\install.txt，升级时优先读取"""
    try:
        d = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "TradeCRM")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "install.txt"), "w", encoding="utf-8") as f:
            f.write(target)
    except Exception:
        pass


def remembered_install_path() -> str:
    """读取安装时记录的路径"""
    try:
        p = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "TradeCRM", "install.txt")
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8-sig") as f:
                d = f.read().strip()
            if d and os.path.isfile(os.path.join(d, "启动外贸CRM.exe")):
                return d
    except Exception:
        pass
    return ""


def make_shortcut(target: str) -> None:
    dn = desktop()
    if not dn:
        return
    exe = os.path.join(target, "启动外贸CRM.exe")
    ps = (
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');"
        "$s.TargetPath='%s';$s.WorkingDirectory='%s';$s.IconLocation='%s';$s.Save()"
        % (os.path.join(dn, "外贸CRM.lnk"), exe, target, exe)
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
                       capture_output=True, timeout=20)
    except Exception:
        pass
    remember_install_path(target)


def launch(target: str):
    exe = os.path.join(target, "启动外贸CRM.exe")
    if os.path.exists(exe):
        subprocess.Popen([exe], cwd=target, close_fds=True)


# ---------------- GUI ----------------

class InstallerApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("外贸 CRM 安装")
        self.root.geometry("520x430")
        self.root.resizable(False, False)
        self.target = None
        self._build_ui()

    def _build_ui(self):
        pad = {"padx": 18, "pady": 6}
        tk.Label(self.root, text="外贸 CRM 安装", font=("Microsoft YaHei", 16, "bold")).pack(pady=(18, 4))
        self.sub = tk.Label(self.root, text="正在检测本机安装情况…", fg="#666")
        self.sub.pack()

        self.frame = ttk.Frame(self.root)
        self.frame.pack(fill="both", expand=True, **pad)

        self.progress = ttk.Progressbar(self.frame, mode="indeterminate", length=460)
        self.status = tk.Label(self.frame, text="", fg="#444", wraplength=460, justify="left")
        self.btn = ttk.Button(self.frame, text="安装", command=self.on_install, state="disabled")
        self.choice = tk.StringVar()

        self._refresh()

    def _refresh(self):
        """检测已安装位置，渲染对应 UI"""
        for w in self.frame.winfo_children():
            w.destroy()

        found = find_existing()
        new_ver = read_new_version()

        if len(found) >= 1:
            old = found[0]
            old_ver = read_installed_version(old)
            self.target = old
            self.sub.config(text=f"检测到已安装 v{old_ver}")

            if len(found) > 1:
                tk.Label(self.frame, text="检测到多个安装位置，请选择要升级的一个：",
                         fg="#333").pack(anchor="w", pady=(4, 2))
                for d in found:
                    ttk.Radiobutton(
                        self.frame, value=d,
                        text=f"{d}  （v{read_installed_version(d)}）",
                        variable=self.choice,
                        command=lambda dd=d: setattr(self, "target", dd),
                    ).pack(anchor="w", pady=2)
                if not self.choice.get():
                    self.choice.set(found[0])
                self.target = found[0]
            else:
                tk.Label(self.frame, text=f"安装位置：{old}", fg="#333", wraplength=460,
                         justify="left").pack(anchor="w", pady=(4, 2))
                tk.Label(self.frame, text=f"点击下方按钮升级到 v{new_ver}\n"
                                          f"你的客户数据、设置都会完整保留。",
                         fg="#2a6", justify="left").pack(anchor="w", pady=4)

            # 兜底：检测不对时允许手动指定
            row = ttk.Frame(self.frame)
            row.pack(fill="x", pady=(8, 0))
            ttk.Button(row, text="手动选择安装目录…", command=self.pick_existing).pack(side="left")
            if len(found) > 1:
                ttk.Button(row, text="改选为全新安装", command=self._force_fresh).pack(side="left", padx=8)

            self.btn = ttk.Button(self.frame, text=f"一键升级到 v{new_ver}",
                                  command=self.on_install)
            self.btn.pack(pady=8)
        else:
            self._render_fresh()

        self.progress = ttk.Progressbar(self.frame, mode="indeterminate", length=460)
        self.status = tk.Label(self.frame, text="", fg="#444", wraplength=460, justify="left")

    def _force_fresh(self):
        """放弃升级，改为全新安装"""
        self.choice.set("")
        self._render_fresh()

    def pick_existing(self):
        """手动指定已安装的目录（自动检测失败时的兜底）"""
        d = filedialog.askdirectory(initialdir="D:\\", title="选择已安装的外贸 CRM 文件夹")
        if d and os.path.isfile(os.path.join(d, "启动外贸CRM.exe")):
            self.target = d
            self.sub.config(text=f"已选择：{d}")
            self.status.config(text=f"将升级：{d}")
            remember_install_path(d)
        elif d:
            messagebox.showwarning("提示", "所选文件夹里没有「启动外贸CRM.exe」，请重新选择。")

    def _render_fresh(self):
        """渲染全新安装界面"""
        for w in self.frame.winfo_children():
            w.destroy()
        default = "D:\\外贸CRM"
        for letter in ("D", "E", "C"):
            if os.path.isdir(f"{letter}:\\"):
                default = os.path.join(f"{letter}:\\", "外贸CRM")
                break
        self.target = default
        self.choice.set(default)
        self.sub.config(text="本机未安装，将进行全新安装")
        row = ttk.Frame(self.frame)
        row.pack(fill="x", pady=6)
        tk.Label(row, text="安装到：").pack(side="left")
        e = ttk.Entry(row, textvariable=self.choice)
        e.pack(side="left", fill="x", expand=True, padx=4)
        ttk.Button(row, text="浏览…", command=self.pick_dir).pack(side="right")
        self.choice.trace_add("write", lambda *_: setattr(self, "target", self.choice.get()))
        tk.Label(self.frame, text="安装完成后会自动创建桌面快捷方式并启动。",
                 fg="#666", justify="left").pack(anchor="w", pady=4)
        self.btn = ttk.Button(self.frame, text="安装", command=self.on_install)
        self.btn.pack(pady=8)
        self.progress = ttk.Progressbar(self.frame, mode="indeterminate", length=460)
        self.status = tk.Label(self.frame, text="", fg="#444", wraplength=460, justify="left")

    def pick_dir(self):
        d = filedialog.askdirectory(initialdir="D:\\", title="选择安装位置")
        if d:
            self.choice.set(os.path.join(d, "外贸CRM"))

    def on_install(self):
        if not self.target:
            messagebox.showwarning("提示", "请先选择安装位置")
            return
        self.btn.config(state="disabled")
        self.progress.pack(pady=6)
        self.status.pack(anchor="w")
        self.progress.start(12)
        threading.Thread(target=self._do_install, daemon=True).start()

    def _do_install(self):
        try:
            target = self.target
            upgrading = os.path.isfile(os.path.join(target, "启动外贸CRM.exe"))
            if upgrading:
                self._say("结束正在运行的程序…")
                kill_running()
            install_to(target, self._say)
            self._say("创建桌面快捷方式…")
            make_shortcut(target)
            self._say("完成！正在启动外贸 CRM…")
            time.sleep(0.6)
            launch(target)
            self.root.after(300, self.root.destroy)
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("安装失败", str(e)))
            self.btn.config(state="normal")

    def _say(self, msg):
        self.root.after(0, lambda m=msg: self.status.config(text=m))

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    InstallerApp().run()
