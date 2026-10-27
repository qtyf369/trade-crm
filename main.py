"""
外贸CRM 单人离线版
启动方式：python main.py
然后浏览器打开 http://localhost:8000

优化版（v0.2）：
- 常量与数据字典收敛到 constants.py
- 日期统一为 YYYY-MM-DD HH:MM:SS
- 搜索/筛选/排序/分页下推到 SQL
- 批量操作单接口，替代前端串行循环
- data_issues 统一由 validate_customer 计算
- 同步操作加进程内锁，避免并发写坏数据库
"""

import sqlite3
import io
import os
import re
import json
import uuid
import shutil
import hashlib
import tempfile
import threading
import webbrowser
import zipfile
import sys
from contextlib import contextmanager
from datetime import datetime, date
from typing import Optional, List, Dict, Any, Tuple, Union

from fastapi import FastAPI, HTTPException, UploadFile, File, Query, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from constants import (
    SOURCES, STATUS_MAP, STATUS_REVERSE_MAP, VALID_STATUSES,
    LEVELS, VALID_LEVELS, LEVEL_LEGACY_MAP,
    SOCIAL_MAP, SOCIAL_REVERSE_MAP, FOLLOWUP_TYPES, EXPORT_HEADERS,
    COUNTRY_EN_TO_CN, COMMON_COUNTRIES, VALID_COUNTRIES, CITY_COUNTRY_PREFIXES,
)

# ---------- 路径 ----------

def _is_frozen() -> bool:
    """是否为 PyInstaller 打包后的 exe 运行"""
    return getattr(sys, "frozen", False)


def _resolve_base_dir() -> str:
    """数据目录（数据库/配置/备份/导出都放这里）

    - 源码运行：项目目录
    - 打包运行：exe 同目录下的 data 文件夹（便携，整个文件夹可搬走）
      若 exe 所在目录不可写（如装在 Program Files），退回到 %LOCALAPPDATA%\\TradeCRM
    """
    if not _is_frozen():
        return os.path.dirname(os.path.abspath(__file__))
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    candidate = os.path.join(exe_dir, "data")
    try:
        os.makedirs(candidate, exist_ok=True)
        probe = os.path.join(candidate, ".write_test")
        with open(probe, "w", encoding="utf-8") as f:
            f.write("ok")
        os.unlink(probe)
        return candidate
    except OSError:
        fallback = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "TradeCRM")
        os.makedirs(fallback, exist_ok=True)
        return fallback


def _resolve_resource_dir() -> str:
    """只读资源目录（前端 dist）

    - 源码运行：项目目录
    - 打包运行：PyInstaller 解压出的临时目录 _MEIPASS
    """
    if _is_frozen():
        return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(sys.executable)))
    return os.path.dirname(os.path.abspath(__file__))


BASE_DIR = _resolve_base_dir()
RESOURCE_DIR = _resolve_resource_dir()

DB_PATH = os.path.join(BASE_DIR, "trade_crm.db")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
DIST_DIR = os.path.join(RESOURCE_DIR, "dist", "output")
ASSETS_DIR = os.path.join(RESOURCE_DIR, "dist", "output_resource")
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
SETTINGS_PATH = os.path.join(BASE_DIR, "ui_settings.json")

os.makedirs(BASE_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)


# ---------- 代理处理（外贸场景常见：用户开着 Clash 等代理软件） ----------
#
# 隐患：Windows 的系统代理会被 urllib/requests 读取。若用户的代理配置里
# 没把本地地址加进「不使用代理的列表」，访问 127.0.0.1:8000 也会被转发给
# 代理服务器，导致拿到代理返回的 HTML 而不是接口数据，表现为「页面空白、
# 接口报 JSON 解析错误」等怪问题。
#
# 对策：
# 1) 明确把本地地址写进 no_proxy，保证程序访问自己永远直连
# 2) 坚果云（外网）保持走系统代理，这样即使墙内也能连上
def _setup_proxy_env() -> None:
    local_hosts = "127.0.0.1,localhost,::1"
    existing = os.environ.get("no_proxy") or os.environ.get("NO_PROXY") or ""
    parts = [p.strip() for p in existing.split(",") if p.strip()]
    for h in ("127.0.0.1", "localhost", "::1"):
        if h not in parts:
            parts.append(h)
    value = ",".join(parts)
    os.environ["no_proxy"] = value
    os.environ["NO_PROXY"] = value


_setup_proxy_env()

# ---------- 拼音搜索 ----------

try:
    from pypinyin import lazy_pinyin, Style
    _HAS_PINYIN = True
except ImportError:
    _HAS_PINYIN = False


def _build_search_text(company: str, contact: str, products: str = '') -> str:
    """构造客户的可搜索文本：原文 + 全拼 + 拼音首字母（小写）

    例：公司「永康市华艺工贸」->
        原文   永康市华艺工贸
        全拼   yongkangshi...（连打）+ yongkangshi huayi gongmao（分词）
        首字母  ykshygm

    pypinyin 缺失时退化为纯原文（搜索仍可用，只是没有拼音匹配）。
    """
    parts = [company or '', contact or '', products or '']
    if not _HAS_PINYIN:
        return ' '.join(p for p in parts if p).lower()

    out = []
    for text in parts:
        if not text:
            continue
        out.append(text)
        try:
            full = lazy_pinyin(text, style=Style.NORMAL)            # 每个字/词的拼音
            initials = lazy_pinyin(text, style=Style.FIRST_LETTER)  # 首字母
            out.append(''.join(full))       # 连打：yongkangshi...
            out.append(' '.join(full))      # 分词：yongkangshi huayi
            out.append(''.join(initials))   # 首字母：ykshygm
        except Exception:
            pass
    return ' '.join(o for o in out if o).lower()


def _is_ascii_letters(s: str) -> bool:
    """搜索词是否纯英文字母（决定要不要做拼音匹配）"""
    return bool(s) and all('a' <= ch <= 'z' for ch in s.lower())

# ---------- 数据库 ----------

# 单连接多线程共享由 SQLite 自身串行化；这里再加一把进程内锁，
# 保证「上传/下载/融合」这类涉及文件替换的操作不会互相踩踏。
_db_lock = threading.RLock()


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def now_str() -> str:
    """统一时间格式：YYYY-MM-DD HH:MM:SS（本地时区）"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def normalize_dt(value: Optional[str]) -> str:
    """
    把各种来源的时间字符串统一成 YYYY-MM-DD HH:MM:SS。

    兼容：ISO 格式（2026-10-20T10:44:58.193012）、datetime-local
    （2026-10-20T10:44）、纯日期（2026-10-20）、以及已规范的格式。
    空值返回空串。
    """
    if not value:
        return ''
    v = str(value).strip()
    if not v:
        return ''
    # datetime-local 的 'T' 换成空格，并去掉毫秒/时区
    v = v.replace('T', ' ')
    v = v.split('.')[0]
    v = re.sub(r'(Z|[+-]\d{2}:?\d{2})$', '', v)
    v = v.strip()
    # 只到日期
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', v)
    if m:
        return f"{v} 00:00:00"
    # 到分钟
    m = re.match(r'^(\d{4}-\d{2}-\d{2})[ ](\d{2}):(\d{2})$', v)
    if m:
        return f"{m.group(1)} {m.group(2)}:{m.group(3)}:00"
    # 到秒
    m = re.match(r'^(\d{4}-\d{2}-\d{2})[ ](\d{2}:\d{2}:\d{2})$', v)
    if m:
        return v
    # 其他格式尝试解析，失败则退回当前时间
    try:
        return datetime.fromisoformat(v.replace(' ', 'T')).strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return now_str()


def date_only(value: Optional[str]) -> str:
    """取 YYYY-MM-DD 部分"""
    if not value:
        return ''
    return str(value).strip()[:10]


# ---------- 初始化 / 迁移 ----------

def init_db():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS customers (
                id TEXT PRIMARY KEY,
                company TEXT NOT NULL,
                contact TEXT DEFAULT '',
                country TEXT DEFAULT '',
                email TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                source TEXT DEFAULT '',
                level TEXT DEFAULT 'L0',
                status TEXT DEFAULT 'potential',
                note TEXT DEFAULT '',
                contacts TEXT DEFAULT '[]',
                created_at TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS followups (
                id TEXT PRIMARY KEY,
                customer_id TEXT NOT NULL,
                type TEXT DEFAULT 'email',
                content TEXT DEFAULT '',
                next_follow_up_at TEXT DEFAULT '',
                created_at TEXT DEFAULT '',
                FOREIGN KEY (customer_id) REFERENCES customers(id)
            );

            CREATE INDEX IF NOT EXISTS idx_followups_customer ON followups(customer_id);
            CREATE INDEX IF NOT EXISTS idx_followups_created ON followups(created_at);
            CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company);
        """)

        # --- 列迁移：幂等，字段已存在就忽略 ---
        for ddl in (
            "ALTER TABLE customers ADD COLUMN contacts TEXT DEFAULT '[]'",
            "ALTER TABLE customers ADD COLUMN products TEXT DEFAULT ''",
            "ALTER TABLE customers ADD COLUMN starred INTEGER DEFAULT 0",
            "ALTER TABLE customers ADD COLUMN data_issues TEXT DEFAULT '[]'",
            "ALTER TABLE customers ADD COLUMN updated_at TEXT DEFAULT ''",
            "ALTER TABLE customers ADD COLUMN search_text TEXT DEFAULT ''",
            "ALTER TABLE followups ADD COLUMN updated_at TEXT DEFAULT ''",
        ):
            try:
                db.execute(ddl)
            except sqlite3.OperationalError:
                pass

        # 索引也要在这里补一次（老库可能缺）
        db.execute("CREATE INDEX IF NOT EXISTS idx_followups_customer ON followups(customer_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_followups_created ON followups(created_at)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_customers_search ON customers(search_text)")

        # 回填 updated_at：老数据该字段为空，用 created_at 兜底
        db.execute("UPDATE customers SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''")
        db.execute("UPDATE followups SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''")

        _backfill_search_text(db)

        migrate_countries(db)
        migrate_legacy_contacts(db)
        migrate_levels(db)
        migrate_statuses(db)
        normalize_datetimes(db)


def _backfill_search_text(db) -> None:
    """重算全部客户的 search_text（幂等；换库/升级/融合后调用）

    直接全量重算，避免依赖旧值判断是否为空——融合后字段可能被覆盖，
    只查空值会漏掉 company 变了但 search_text 还是旧拼音的行。
    """
    rows = db.execute(
        "SELECT id, company, contact, products FROM customers"
    ).fetchall()
    for r in rows:
        st = _build_search_text(r['company'], r['contact'], r['products'] or '')
        db.execute("UPDATE customers SET search_text = ? WHERE id = ?", (st, r['id']))


def _update_search_text(db, cid: str) -> None:
    """客户增改后重算该客户的 search_text"""
    r = db.execute(
        "SELECT company, contact, products FROM customers WHERE id = ?", (cid,)
    ).fetchone()
    if r:
        st = _build_search_text(r['company'], r['contact'], r['products'] or '')
        db.execute("UPDATE customers SET search_text = ? WHERE id = ?", (st, cid))


def migrate_countries(db):
    """英文国家名 -> 中文，并剥离城市后缀"""
    rows = db.execute("SELECT id, country FROM customers").fetchall()
    for row in rows:
        cid, raw = row['id'], row['country']
        if not raw:
            continue
        new = normalize_country(raw)
        if new and new != raw:
            db.execute("UPDATE customers SET country = ? WHERE id = ?", (new, cid))


def migrate_legacy_contacts(db):
    """把旧的 contact/email/phone 单联系人字段填充进 contacts 数组"""
    rows = db.execute(
        "SELECT id, contact, email, phone, contacts FROM customers"
    ).fetchall()
    for row in rows:
        cid = row['id']
        try:
            contacts = json.loads(row['contacts'] or '[]')
        except (ValueError, TypeError):
            contacts = []
        if len(contacts) == 0 and (row['contact'] or row['email'] or row['phone']):
            contacts = [{
                "name": row['contact'] or "",
                "email": row['email'] or "",
                "phone": row['phone'] or "",
            }]
            db.execute(
                "UPDATE customers SET contacts = ? WHERE id = ?",
                (json.dumps(contacts, ensure_ascii=False), cid),
            )


def migrate_levels(db):
    """旧等级 A/B/C -> L0-L4"""
    db.execute("UPDATE customers SET level = 'L3' WHERE level = 'A'")
    db.execute("UPDATE customers SET level = 'L1' WHERE level = 'B'")
    db.execute("UPDATE customers SET level = 'L2' WHERE level = 'C'")


def migrate_statuses(db):
    """旧状态 potential/following -> lead/contacted"""
    db.execute("UPDATE customers SET status = 'lead' WHERE status = 'potential'")
    db.execute("UPDATE customers SET status = 'contacted' WHERE status = 'following'")


def normalize_datetimes(db):
    """把 ISO 格式等不规范时间统一为 YYYY-MM-DD HH:MM:SS"""
    rows = db.execute("SELECT id, created_at FROM customers").fetchall()
    for row in rows:
        raw = row['created_at']
        if raw and not re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$', raw):
            db.execute(
                "UPDATE customers SET created_at = ? WHERE id = ?",
                (normalize_dt(raw), row['id']),
            )
    rows = db.execute("SELECT id, created_at FROM followups").fetchall()
    for row in rows:
        raw = row['created_at']
        if raw and not re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$', raw):
            db.execute(
                "UPDATE followups SET created_at = ? WHERE id = ?",
                (normalize_dt(raw), row['id']),
            )
    # next_follow_up_at 历史上被误写成完整时间戳，统一成日期
    rows = db.execute("SELECT id, next_follow_up_at FROM followups").fetchall()
    for row in rows:
        raw = row['next_follow_up_at']
        if raw and not re.match(r'^\d{4}-\d{2}-\d{2}$', raw):
            db.execute(
                "UPDATE followups SET next_follow_up_at = ? WHERE id = ?",
                (date_only(raw), row['id']),
            )


def seed_if_empty():
    """首次运行插入示例数据"""
    with get_db() as db:
        count = db.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        if count:
            return
        now = now_str()
        samples = [
            ("c1", "ABC Trading Co.", "John Smith", "美国", "john@abctrading.com", "+1 555-0100",
             "阿里巴巴国际站", "L3", "contacted", "对不锈钢餐具感兴趣，已寄样品"),
            ("c2", "EuroSteel GmbH", "Hans Mueller", "德国", "hans@eurosteel.de", "+49 30-123456",
             "展会", "L1", "lead", "正在比价，等待回复"),
            ("c3", "Marina Distributors", "Maria Garcia", "西班牙", "maria@marina.es", "+34 91-555-0199",
             "Google", "L2", "lost", "价格太高，暂时搁置"),
        ]
        for cid, company, contact, country, email, phone, source, level, status, note in samples:
            db.execute(
                "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, contacts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (cid, company, contact, country, email, phone, source, level, status, note,
                 json.dumps([{"name": contact, "email": email, "phone": phone}], ensure_ascii=False), now, now),
            )
        for fid, cid, typ, content in [
            ("f1", "c1", "email", "发送了不锈钢餐具报价单，等待客户确认"),
            ("f2", "c2", "whatsapp", "WhatsApp沟通了MOQ要求，客户需要10000件起订"),
        ]:
            db.execute(
                "INSERT INTO followups (id, customer_id, type, content, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                (fid, cid, typ, content, now, now),
            )


# 示例客户的固定 id（见 seed_if_empty）
SEED_CUSTOMER_IDS = ("c1", "c2", "c3")


def _is_only_seed_data() -> bool:
    """判断本地是否只有示例数据（没有任何用户自己录入的记录）

    为 True 时，首次绑定可以直接用云端数据接管本地；
    为 False 时说明用户已经录了数据，必须走融合流程让用户自己选，
    否则用户刚录入的客户会被云端旧数据覆盖掉。
    """
    try:
        with get_db() as db:
            rows = db.execute("SELECT id FROM customers").fetchall()
        if not rows:
            return True
        return all((r['id'] or '') in SEED_CUSTOMER_IDS for r in rows)
    except Exception:
        return False


# ---------- 数据校验 ----------

def normalize_country(raw: Optional[str]) -> str:
    """英文->中文、剥离城市后缀、去空白；无法识别返回原值"""
    if not raw:
        return ''
    val = str(raw).strip()
    if not val:
        return ''
    lower = val.lower()
    if lower in COUNTRY_EN_TO_CN:
        return COUNTRY_EN_TO_CN[lower]
    for prefix in CITY_COUNTRY_PREFIXES:
        if val.startswith(prefix) and val != prefix:
            return prefix
    return val


def parse_contacts(raw: Any) -> List[Dict[str, str]]:
    """把 contacts 字段统一解析成 dict 列表"""
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, str):
        try:
            items = json.loads(raw or '[]')
        except (ValueError, TypeError):
            items = []
    else:
        items = []
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        out.append({
            'name': str(it.get('name') or ''),
            'email': str(it.get('email') or ''),
            'phone': str(it.get('phone') or ''),
            'social': str(it.get('social') or ''),
            'socialAccount': str(it.get('socialAccount') or ''),
            'position': str(it.get('position') or ''),
        })
    return out


def validate_customer(db, data: Dict[str, Any], cid: Optional[str] = None) -> List[str]:
    """
    客户数据校验，返回问题列表（写入 data_issues）。

    新建与更新共用同一入口，保证规则一致。
    """
    issues: List[str] = []

    country = normalize_country(data.get('country') or '')
    if country not in VALID_COUNTRIES:
        issues.append(f"国家不规范：{data.get('country') or '(空)'}，导入后已标红待处理")

    # 来源：自由文本，留空即留空（不强行填默认值）；展示层空值显示「—」
    data['source'] = (data.get('source') or '').strip()

    status = (data.get('status') or '').strip()
    if status not in VALID_STATUSES:
        issues.append(f"状态不规范：{status or '(空)'}")

    # 等级：L0-L4（阿里专用）/ 1星-5星（通用）均合法；旧值「低质/优质」自动转星，乱值记未分级
    level = (data.get('level') or '').strip()
    data['level'] = LEVEL_LEGACY_MAP.get(level, level if level in VALID_LEVELS else '')

    # 邮箱重复：与其它客户的任一联系人比对（精确匹配，指出重复对象）
    emails = [
        (c.get('email') or '').strip().lower()
        for c in parse_contacts(data.get('contacts'))
        if (c.get('email') or '').strip()
    ]
    if emails:
        email_set = set(emails)
        # 先粗筛：JSON 里含该邮箱字符串的行（缩小扫描范围）
        params: List[Any] = []
        clauses = []
        for e in email_set:
            clauses.append("contacts LIKE ?")
            params.append(f'%{e}%')
        where = "(" + " OR ".join(clauses) + ")"
        if cid:
            where += " AND id != ?"
            params.append(cid)
        rows = db.execute(
            f"SELECT id, company, contacts FROM customers WHERE {where}", params
        ).fetchall()
        seen = set()
        for row in rows:
            for oc in parse_contacts(row['contacts']):
                oe = (oc.get('email') or '').strip().lower()
                # 精确比对，避免 LIKE 通配符误匹配
                if oe in email_set and oe not in seen:
                    seen.add(oe)
                    issues.append(
                        f"邮箱重复：{oe}（与{row['company']}的{oc.get('name') or '未知联系人'}重复）"
                    )
    return issues


# ---------- Pydantic 模型 ----------

class CustomerContact(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    social: str = ""
    socialAccount: str = ""
    position: str = ""


class Customer(BaseModel):
    id: Optional[str] = None
    company: str
    contact: str = ""
    country: str = ""
    email: str = ""
    phone: str = ""
    source: str = ""
    level: str = ""
    status: str = "lead"
    note: str = ""
    products: str = ""
    contacts: List[CustomerContact] = []
    starred: int = 0
    # 列表/详情接口把 data_issues 解析成数组返回，前端会原样回传；
    # 这里两种形态都接受（实际落库永远以 validate_customer 的重算结果为准）
    data_issues: Union[str, List[str], None] = "[]"
    last_followup_at: Optional[str] = None
    updated_at: Optional[str] = None


class FollowUp(BaseModel):
    id: Optional[str] = None
    customer_id: str
    type: str = "email"
    content: str = ""
    next_follow_up_at: str = ""
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class BatchIds(BaseModel):
    ids: List[str] = Field(default_factory=list)


class BatchAction(BaseModel):
    """批量操作：delete / star / unstar"""
    ids: List[str] = Field(default_factory=list)
    action: str = Field(..., description="delete | star | unstar")


class SyncConfig(BaseModel):
    webdav_url: str = ""
    webdav_user: str = ""
    webdav_pass: str = ""
    auto_sync: bool = True


class ProfileData(BaseModel):
    nickname: str = ""
    avatar: str = ""  # base64 data URL


class SyncResolve(BaseModel):
    """同步处理方式：local 以本地为准 / remote 以云端为准 / merge 双向融合"""
    choice: str = Field(..., description="local | remote | merge")


class SettingsPayload(BaseModel):
    """界面偏好（主题模式、配色方案等），键值任意"""
    settings: Dict[str, Any] = Field(default_factory=dict)


class BackupRestore(BaseModel):
    """从备份恢复：file 为 backups 目录下的备份文件名"""
    file: str = Field(..., description="如 backup_20261023_150000_manual.zip")


# ---------- 备份与恢复 ----------
#
# 备份为单文件 zip（内含数据库 + 全部配置 + 界面设置），便于拷贝到其它电脑。
# 文件名带时间戳，可保留多份；恢复前会自动把当前状态再备份一次。

BACKUP_KEEP = 20
BACKUP_MANIFEST = "manifest.json"


def _collect_backup_files() -> List[Tuple[str, str]]:
    items: List[Tuple[str, str]] = []
    if os.path.exists(DB_PATH):
        items.append(("trade_crm.db", DB_PATH))
    if os.path.exists(CONFIG_PATH):
        items.append(("config.json", CONFIG_PATH))
    if os.path.exists(SETTINGS_PATH):
        items.append(("ui_settings.json", SETTINGS_PATH))
    return items


def create_backup(tag: str = "manual") -> Dict[str, Any]:
    """创建一份完整备份（数据库用一致性快照）"""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{stamp}_{tag}.zip"
    path = os.path.join(BACKUP_DIR, filename)

    files = _collect_backup_files()
    if not any(arc == "trade_crm.db" for arc, _ in files):
        raise HTTPException(500, "本地数据库不存在，无法备份")

    snapshot = _snapshot_db()
    manifest: Dict[str, Any] = {"created_at": now_str(), "tag": tag, "app": "外贸CRM", "files": []}
    try:
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            for arc, src_path in files:
                use = snapshot if arc == "trade_crm.db" else src_path
                zf.write(use, arc)
                manifest["files"].append({"name": arc, "size": os.path.getsize(use)})
            manifest["counts"] = _counts(snapshot)
            zf.writestr(BACKUP_MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2))
    finally:
        try:
            os.unlink(snapshot)
        except OSError:
            pass

    _prune_backups()
    return {"ok": True, "file": filename, "size": os.path.getsize(path),
            "counts": manifest.get("counts")}


def _prune_backups() -> None:
    """只清理自动备份，保留最近的若干份；手动备份不自动删除"""
    try:
        entries = []
        for name in os.listdir(BACKUP_DIR):
            if name.startswith("backup_") and name.endswith(".zip") and "_auto" in name:
                p = os.path.join(BACKUP_DIR, name)
                entries.append((os.path.getmtime(p), p))
        entries.sort(reverse=True)
        for _, p in entries[BACKUP_KEEP:]:
            try:
                os.unlink(p)
            except OSError:
                pass
    except OSError:
        pass


def _cleanup_old_db_backups(days: int = 7) -> None:
    """清理旧的单文件数据库备份"""
    try:
        for name in os.listdir(BACKUP_DIR):
            if not (name.startswith("trade_crm_") and name.endswith(".db")):
                continue
            try:
                file_date = datetime.strptime(
                    name[len("trade_crm_"):-len(".db")], "%Y%m%d").date()
            except ValueError:
                continue
            if (date.today() - file_date).days > days:
                try:
                    os.unlink(os.path.join(BACKUP_DIR, name))
                except OSError:
                    pass
    except OSError:
        pass


def auto_backup() -> Dict[str, Any]:
    """启动时自动备份（每天一次）：数据库 + 全部设置，打包为 zip"""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH):
        return {"ok": False, "reason": "db missing"}

    today = date.today().strftime("%Y%m%d")
    created = False
    existing = [
        n for n in os.listdir(BACKUP_DIR)
        if n.startswith(f"backup_{today}") and "_auto" in n and n.endswith(".zip")
    ]
    if not existing:
        try:
            create_backup(tag="auto")
            created = True
        except Exception:
            created = False

    _cleanup_old_db_backups()
    return {"ok": True, "created": created}


def _list_backups() -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    try:
        for name in os.listdir(BACKUP_DIR):
            if not (name.startswith("backup_") and name.endswith(".zip")):
                continue
            p = os.path.join(BACKUP_DIR, name)
            item: Dict[str, Any] = {
                "file": name, "size": os.path.getsize(p),
                "mtime": int(os.path.getmtime(p)),
                "counts": {"customers": -1, "followups": -1},
                "created_at": "", "tag": "",
            }
            try:
                with zipfile.ZipFile(p) as zf:
                    if BACKUP_MANIFEST in zf.namelist():
                        m = json.loads(zf.read(BACKUP_MANIFEST).decode("utf-8"))
                        item["counts"] = m.get("counts") or item["counts"]
                        item["created_at"] = m.get("created_at") or ""
                        item["tag"] = m.get("tag") or ""
            except Exception:
                pass
            result.append(item)
    except OSError:
        pass
    result.sort(key=lambda x: x["mtime"], reverse=True)
    return result


def _restore_backup(filename: str) -> Dict[str, Any]:
    """从备份恢复；恢复前先把当前状态另存一份，避免误操作无法回退"""
    safe = os.path.basename(filename)
    path = os.path.join(BACKUP_DIR, safe)
    if not safe.startswith("backup_") or not safe.endswith(".zip") or not os.path.isfile(path):
        raise HTTPException(404, "备份文件不存在")

    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        if "trade_crm.db" not in names:
            raise HTTPException(400, "备份文件不完整（缺少数据库）")

        try:
            create_backup(tag="before_restore")
        except Exception:
            pass

        with _db_lock:
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
            tmp.write(zf.read("trade_crm.db"))
            tmp.close()
            try:
                _validate_db_file(tmp.name)
            except HTTPException:
                os.unlink(tmp.name)
                raise
            shutil.move(tmp.name, DB_PATH)

        restored = ["trade_crm.db"]
        for name, target in (("config.json", CONFIG_PATH), ("ui_settings.json", SETTINGS_PATH)):
            if name in names:
                with open(target, "wb") as f:
                    f.write(zf.read(name))
                restored.append(name)

    with get_db() as db:
        migrate_countries(db)
        normalize_datetimes(db)
    return {"ok": True, "restored": restored, "counts": _counts(DB_PATH)}


# ---------- FastAPI 实例 ----------

app = FastAPI(title="外贸CRM")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()
seed_if_empty()
auto_backup()

# 国家名规范化只在启动时做一次（历史数据修正）。
# 旧实现在每次客户列表请求里执行一次全表 UPDATE，既拖慢列表，
# 又会与用户的增删改并发争抢 SQLite 写锁，导致偶发响应异常。
try:
    with _db_lock:
        with get_db() as _db:
            migrate_countries(_db)
            normalize_datetimes(_db)
except Exception:
    pass


# ---------- 查询构造 ----------

# 允许排序的字段 -> SQL 表达式
SORTABLE = {
    'company': 'c.company',
    'country': 'c.country',
    'level': 'c.level',
    'status': 'c.status',
    'source': 'c.source',
    'starred': 'c.starred',
    'created_at': 'c.created_at',
    'last_followup_at': 'last_followup_at',
}


def row_to_customer(row) -> Dict[str, Any]:
    d = dict(row)
    d.pop('search_text', None)  # 内部索引字段，不下发给前端
    d['contacts'] = parse_contacts(d.get('contacts'))
    d['starred'] = int(d.get('starred') or 0)
    try:
        d['data_issues'] = json.loads(d.get('data_issues') or '[]')
    except (ValueError, TypeError):
        d['data_issues'] = []
    return d


def query_customers(
    db,
    search: str = '',
    countries: Optional[List[str]] = None,
    levels: Optional[List[str]] = None,
    statuses: Optional[List[str]] = None,
    sources: Optional[List[str]] = None,
    starred_only: bool = False,
    issues_only: bool = False,
    sort_by: str = 'company',
    sort_asc: bool = True,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[Dict[str, Any]], int]:
    """服务端搜索/筛选/排序/分页。返回 (当前页数据, 符合条件的总数)。"""
    where: List[str] = []
    params: List[Any] = []

    if search:
        term = search.strip()
        like = f"%{term}%"
        # 原文匹配：公司/联系人/国家/联系人明细/产品/备注相关字段
        text_clause = (
            "(c.company LIKE ? OR c.contact LIKE ? OR c.country LIKE ? "
            "OR c.contacts LIKE ? OR c.products LIKE ?)"
        )
        if _is_ascii_letters(term) and _HAS_PINYIN:
            # 纯英文字母：额外匹配拼音（全拼连打 / 首字母），
            # 如 ykshygm 命中「永康市华艺」、huayi 命中「华艺」
            where.append(
                f"({text_clause} OR c.search_text LIKE ?)"
            )
            params.extend([like, like, like, like, like, f"%{term.lower()}%"])
        else:
            where.append(text_clause)
            params.extend([like, like, like, like, like])

    for column, values in (
        ('c.country', countries),
        ('c.level', levels),
        ('c.status', statuses),
        ('c.source', sources),
    ):
        if values:
            # 支持把 '' 当作"未分级/空值"传入
            has_empty = '' in values
            real = [v for v in values if v != '']
            clause = []
            if real:
                clause.append(f"{column} IN ({','.join('?' * len(real))})")
                params.extend(real)
            if has_empty:
                clause.append(f"({column} IS NULL OR {column} = '')")
            where.append("(" + " OR ".join(clause) + ")")

    if starred_only:
        where.append("c.starred = 1")

    if issues_only:
        where.append("c.data_issues IS NOT NULL AND c.data_issues NOT IN ('[]', '')")

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    order_col = SORTABLE.get(sort_by, 'c.company')
    direction = 'ASC' if sort_asc else 'DESC'
    # 次级排序保证顺序稳定
    order_sql = f" ORDER BY {order_col} {direction}, c.company {direction}"

    total = db.execute(
        f"SELECT COUNT(*) FROM ("
        f"SELECT c.id FROM customers c "
        f"LEFT JOIN followups f ON c.id = f.customer_id "
        f"{where_sql} GROUP BY c.id)"
        if where_sql else "SELECT COUNT(*) FROM customers",
        params if where_sql else [],
    ).fetchone()[0]

    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 50), 500))
    offset = (page - 1) * page_size

    # 注意：SQLite 在 GROUP BY + LIMIT + ORDER BY 混用时，LIMIT 会先于分组生效，
    # 导致只返回一行。这里先用子查询完成聚合，外层再排序分页。
    # 子查询已 flatten，外层不能再带 c. 别名，这里统一剥掉表前缀。
    outer_order_sql = re.sub(r'\bc\.', '', order_sql)
    rows = db.execute(
        f"""
        SELECT * FROM (
            SELECT c.*, MAX(f.created_at) as last_followup_at
            FROM customers c
            LEFT JOIN followups f ON c.id = f.customer_id
            {where_sql}
            GROUP BY c.id
        )
        {outer_order_sql}
        LIMIT ? OFFSET ?
        """,
        params + [page_size, offset],
    ).fetchall()

    return [row_to_customer(r) for r in rows], total


def build_query_params(
    search: str = '',
    country: str = '',
    level: str = '',
    status: str = '',
    source: str = '',
    starred: bool = False,
    issues: bool = False,
    sort_by: str = 'company',
    sort_asc: bool = True,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """把逗号分隔的多选参数转成列表"""
    def split(v: str) -> List[str]:
        return [x for x in (v or '').split(',') if x != ''] if v else []

    return dict(
        search=search,
        countries=split(country),
        levels=split(level),
        statuses=split(status),
        sources=split(source),
        starred_only=starred,
        issues_only=issues,
        sort_by=sort_by,
        sort_asc=sort_asc,
        page=page,
        page_size=page_size,
    )


# ---------- 客户 API ----------

@app.get("/api/customers")
def list_customers(
    search: str = '',
    country: str = '',
    level: str = '',
    status: str = '',
    source: str = '',
    starred: bool = False,
    issues: bool = False,
    sort_by: str = 'company',
    sort_asc: bool = True,
    page: int = 1,
    page_size: int = 50,
):
    """分页客户列表（含总数），供前端表格直接使用"""
    # 用 _db_lock 串行化读，避免与增删改并发争抢 SQLite 写锁
    with _db_lock:
        with get_db() as db:
            items, total = query_customers(
                db, **build_query_params(
                    search, country, level, status, source, starred, issues,
                    sort_by, sort_asc, page, page_size,
                )
            )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


# 旧接口保留一段时间：返回全量数组（前端老版本/导出在用）
@app.get("/api/customers/all")
def list_customers_all():
    with get_db() as db:
        rows = db.execute("""
            SELECT * FROM (
                SELECT c.*, MAX(f.created_at) as last_followup_at
                FROM customers c
                LEFT JOIN followups f ON c.id = f.customer_id
                GROUP BY c.id
            )
            ORDER BY company
        """).fetchall()
    return [row_to_customer(r) for r in rows]


_migrate_country_lock = threading.Lock()
_migrate_country_last: Dict[str, Any] = {}


def migrate_countries_tick():
    """
    国家名修正：仅在启动时执行一次（见 init_db 之后的调用）。

    旧实现在每次列表请求里做一次全表 UPDATE，会与用户的增删改并发争抢
    SQLite 写锁，导致偶发响应异常。现在改为启动时一次，之后不再触碰。
    """


@app.get("/api/customers/{cid}/detail")
def customer_detail(cid: str):
    with get_db() as db:
        customer = db.execute("SELECT * FROM customers WHERE id = ?", (cid,)).fetchone()
        if not customer:
            raise HTTPException(404, "客户不存在")
        followups = db.execute(
            "SELECT * FROM followups WHERE customer_id = ? ORDER BY created_at DESC, id DESC",
            (cid,),
        ).fetchall()
    return {
        "customer": row_to_customer(customer),
        "followups": [dict(f) for f in followups],
    }


@app.post("/api/customers")
def create_customer(c: Customer):
    with get_db() as db:
        data = c.model_dump()
        issues = validate_customer(db, data)
        country = normalize_country(data.get('country') or '')
        contacts = [x.model_dump() for x in c.contacts] or [
            {"name": data.get('contact') or "", "email": data.get('email') or "",
             "phone": data.get('phone') or ""}
        ]
        cid = f"c{uuid.uuid4().hex[:8]}"
        ts = now_str()
        db.execute(
            "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, products, contacts, created_at, starred, data_issues, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                cid, c.company, data.get('contact') or '', country,
                data.get('email') or '', data.get('phone') or '',
                c.source, c.level, c.status, c.note, c.products,
                json.dumps(contacts, ensure_ascii=False), ts,
                int(c.starred or 0), json.dumps(issues, ensure_ascii=False), ts,
            ),
        )
        _update_search_text(db, cid)
    return {"id": cid}


@app.put("/api/customers/{cid}")
def update_customer(cid: str, c: Customer):
    with get_db() as db:
        existing = db.execute("SELECT id, updated_at FROM customers WHERE id = ?", (cid,)).fetchone()
        if not existing:
            raise HTTPException(404, "客户不存在")

        # 乐观锁：如果前端传了 updated_at，校验是否与数据库一致
        if c.updated_at and existing['updated_at'] and c.updated_at != existing['updated_at']:
            raise HTTPException(409, "数据已被其他操作修改，请刷新后重试")

        data = c.model_dump()
        issues = validate_customer(db, data, cid=cid)
        country = normalize_country(data.get('country') or '')
        contacts = [x.model_dump() for x in c.contacts]
        ts = now_str()

        db.execute(
            "UPDATE customers SET company=?, contact=?, country=?, email=?, phone=?, source=?, level=?, status=?, note=?, products=?, contacts=?, starred=?, data_issues=?, updated_at=? WHERE id=?",
            (
                c.company, data.get('contact') or '', country,
                data.get('email') or '', data.get('phone') or '',
                c.source, c.level, c.status, c.note, c.products,
                json.dumps(contacts, ensure_ascii=False), int(c.starred or 0),
                json.dumps(issues, ensure_ascii=False), ts, cid,
            ),
        )
        _update_search_text(db, cid)
    return {"ok": True, "updated_at": ts}


@app.delete("/api/customers/{cid}")
def delete_customer(cid: str):
    with get_db() as db:
        # 先删跟进记录再删客户，否则外键约束会拦住
        db.execute("DELETE FROM followups WHERE customer_id = ?", (cid,))
        db.execute("DELETE FROM customers WHERE id = ?", (cid,))
    return {"ok": True}


# ---------- 批量操作 ----------

@app.post("/api/customers/batch")
def batch_customers(body: BatchAction):
    """
    单接口完成批量删除 / 加星标 / 取消星标。
    前端不再逐条发请求，避免 N 次往返把界面卡住。
    """
    ids = [i for i in (body.ids or []) if i]
    if not ids:
        raise HTTPException(400, "没有选择客户")
    action = (body.action or '').strip().lower()
    if action not in ('delete', 'star', 'unstar'):
        raise HTTPException(400, f"不支持的操作：{action}")

    placeholders = ",".join("?" * len(ids))
    with get_db() as db:
        existing = {
            r['id'] for r in db.execute(
                f"SELECT id FROM customers WHERE id IN ({placeholders})", ids
            ).fetchall()
        }
        if not existing:
            raise HTTPException(404, "客户不存在")

        if action == 'delete':
            # 先删跟进记录，避免外键约束失败
            db.execute(
                f"DELETE FROM followups WHERE customer_id IN ({placeholders})", ids
            )
            db.execute(f"DELETE FROM customers WHERE id IN ({placeholders})", ids)
        else:
            db.execute(
                f"UPDATE customers SET starred = ?, updated_at = ? WHERE id IN ({placeholders})",
                [1 if action == 'star' else 0, now_str()] + ids,
            )
    return {"ok": True, "affected": len(existing), "action": action}


# ---------- Excel 导出 ----------

FONT_NAME = "微软雅黑"

# 导出样式常量
EXPORT_STYLES = {
    'title_font': Font(name=FONT_NAME, size=16, bold=True, color="1F4E79"),
    'subtitle_font': Font(name=FONT_NAME, size=9, color="808080"),
    'header_font': Font(name=FONT_NAME, size=10, bold=True, color="FFFFFF"),
    'header_fill': PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid"),
    'zebra_fill': PatternFill(start_color="EAF1F8", end_color="EAF1F8", fill_type="solid"),
    'data_font': Font(name=FONT_NAME, size=10, color="333333"),
    'status_font': Font(name=FONT_NAME, size=10, bold=True, color="333333"),
    'header_border': Border(bottom=Side(style='medium', color="1F4E79")),
    'bottom_border': Border(bottom=Side(style='thin', color="D0D0D0")),
    'header_alignment': Alignment(horizontal="center", vertical="center", wrap_text=True),
    'center_alignment': Alignment(horizontal="center", vertical="center", wrap_text=True),
    'title_alignment': Alignment(horizontal="left", vertical="center"),
    'subtitle_alignment': Alignment(horizontal="left", vertical="center"),
    'status_fills': {
        '新线索': PatternFill(start_color="D6E4F0", end_color="D6E4F0", fill_type="solid"),
        '初步沟通': PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid"),
        '已报价未成交': PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid"),
        '谈判中': PatternFill(start_color="E4DFEC", end_color="E4DFEC", fill_type="solid"),
        '已成交': PatternFill(start_color="D9EAD3", end_color="D9EAD3", fill_type="solid"),
        '已流失': PatternFill(start_color="F4CCCC", end_color="F4CCCC", fill_type="solid"),
    },
    'col_widths': {
        'A': 6, 'B': 28, 'C': 12, 'D': 16, 'E': 8, 'F': 14,
        'G': 22, 'H': 28, 'I': 12, 'J': 12, 'K': 28, 'L': 16,
        'M': 12, 'N': 16, 'O': 13, 'P': 35, 'Q': 12,
    },
}

HEADER_ROW = 4

# 模板/导入共用的列说明（与 EXPORT_HEADERS 顺序一一对应，不含"序号"列）
# (表头, 是否必填, 填写说明)
TEMPLATE_COLUMNS: List[Tuple[str, bool, str]] = [
    ('公司名称', True,  '必填。同一公司的多个联系人写多行，公司名可只在第一行填写'),
    ('国家', False, '中文国家名，如「美国」「德国」。留空视为「未知」'),
    ('来源', False, '自由填写，如：阿里巴巴国际站、展会、Google、老客户介绍。留空即留空（列表显示「—」）'),
    ('等级', False, '阿里客户填 L0-L4；其他客户填 1星-5星。匹配不上（旧的「低质/优质」自动转星）记未分级'),
    ('状态', False, '可选值：新线索、初步沟通、已报价未成交、谈判中、已成交、已流失。默认「新线索」'),
    ('主要产品', False, '如：不锈钢餐具、保温杯'),
    ('备注', False, '客户偏好、沟通要点等自由文本'),
    ('联系人姓名', False, '第一个联系人会作为主要联系人；多个联系人写多行'),
    ('职位', False, '如：采购经理'),
    ('邮箱', False, '如 john@company.com。同一邮箱出现在多个公司会被标记提醒'),
    ('电话', False, '建议文本格式填写，避免号码变成科学计数法'),
    ('社交软件', False, '可选值：WhatsApp、微信、其他'),
    ('社交账号', False, '对应社交软件的账号'),
    ('最近跟进日期', False, '每行一条跟进记录；同一客户多写几行即可导入多条。格式随意：2026-1-8、2026/1/8、Excel 日期都行'),
    ('最近跟进内容', False, '该次跟进说了什么；与日期配套填写'),
    ('创建时间', False, '留空则自动记为导入时间'),
]


@app.get("/api/import/template")
def import_template():
    """生成导入模板 Excel：说明页 + 填写页（表头、示例、下拉、日期保护）"""
    wb = Workbook()

    # ===== 第 1 页：填写说明 =====
    ws0 = wb.active
    ws0.title = "填写说明"
    ws0.column_dimensions['A'].width = 14
    ws0.column_dimensions['B'].width = 10
    ws0.column_dimensions['C'].width = 90

    t = ws0.cell(row=1, column=1, value="外贸CRM · 导入模板")
    t.font = Font(name=FONT_NAME, size=16, bold=True, color="1F4E79")
    tips = [
        "1. 在「客户数据」表里填写客户信息，蓝色表头列不要删改、不要调整顺序。",
        "2. 灰色示例行（前 3 行）填完自己的数据后可以删掉。",
        "3. 同一公司有多个联系人：写多行，公司名只在第一行填写（往下留空自动沿用上一行）。",
        "4. 同一公司有多条跟进记录：也是写多行，每行一条「日期+内容」，重复的会自动去重。",
        "5. 只想录入部分列？其他列留空即可，不必删除表头。",
        "6. 日期列不挑格式：2026-1-8、2026/1/8、2026年1月8日、Excel 日期单元格都能识别。",
        "7. 电话、邮箱列已预设文本格式，长号码不会变成科学计数法。",
        "8. 「状态」「社交软件」列已设置下拉选项；来源和等级自由填写，系统会自动匹配。",
        "9. 国家系统会自动匹配常见国家名；匹配不上的会在列表里标红提示，导入后再补充。",
        "10. 填完后保存，回到系统点「导入Excel」选择这个文件。",
        "11. 公司名与已有客户重复的行会自动跳过，不会重复导入。",
    ]
    for i, tip in enumerate(tips, 3):
        c = ws0.cell(row=i, column=1, value=tip)
        c.font = Font(name=FONT_NAME, size=11)
        c.alignment = Alignment(vertical="center", wrap_text=False)
        ws0.row_dimensions[i].height = 22

    ws0.cell(row=14, column=1, value="各列填写说明：").font = Font(
        name=FONT_NAME, size=12, bold=True, color="1F4E79")
    hdr = ws0.cell(row=15, column=1, value="列名")
    hdr.font = Font(name=FONT_NAME, size=10, bold=True, color="FFFFFF")
    hdr.fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    req = ws0.cell(row=15, column=2, value="必填")
    req.font = Font(name=FONT_NAME, size=10, bold=True, color="FFFFFF")
    req.fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    desc = ws0.cell(row=15, column=3, value="说明")
    desc.font = Font(name=FONT_NAME, size=10, bold=True, color="FFFFFF")
    desc.fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    for i, (name, required, note) in enumerate(TEMPLATE_COLUMNS, 16):
        ws0.cell(row=i, column=1, value=name).font = Font(name=FONT_NAME, size=10)
        rc = ws0.cell(row=i, column=2, value="是" if required else "")
        rc.font = Font(name=FONT_NAME, size=10, color="C00000" if required else "999999")
        rc.alignment = Alignment(horizontal="center")
        nc = ws0.cell(row=i, column=3, value=note)
        nc.font = Font(name=FONT_NAME, size=10, color="555555")
        nc.alignment = Alignment(vertical="center", wrap_text=True)
        ws0.row_dimensions[i].height = 20

    # ===== 第 2 页：客户数据 =====
    ws = wb.create_sheet("客户数据")
    S = EXPORT_STYLES
    headers = [c[0] for c in TEMPLATE_COLUMNS]  # 不含"序号"，导入时按表头名定位
    num_cols = len(headers)

    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=HEADER_ROW, column=col, value=h)
        cell.font = S['header_font']
        cell.fill = S['header_fill']
        cell.alignment = S['header_alignment']
        cell.border = S['header_border']
    ws.row_dimensions[HEADER_ROW].height = 28

    # 示例行（灰底斜体，导入时后端按"示例公司"自动忽略）
    # 第 5 行：客户 A 的第一个联系人（含全部时间列示例）
    # 第 6 行：同一客户 A 的第二个联系人 —— 公司/国家等列留空，自动沿用上一行
    # 第 7 行：客户 B，时间列演示三种等价格式（2026-1-8、Excel 日期、2026/1/10）
    from datetime import date as _date
    samples = [
        ["示例公司A（填完删掉这3行）", "美国", "阿里巴巴国际站", "L2", "初步沟通",
         "保温杯、不锈钢餐具", "样品单客户，已寄样", "John Smith", "采购经理",
         "john@example.com", "555-0100-123", "WhatsApp", "+15550100",
         "2026-1-8", "问了价格和MOQ", "2026-1-2"],
        ["", "", "", "", "", "", "", "Jane Roe", "业务员",
         "jane@example.com", "555-0100-456", "", "",
         "", "换了个对接人继续谈", ""],
        ["示例公司B", "德国", "老客户介绍", "4星", "已报价未成交",
         "不锈钢餐具", "", "Hans", "总经理",
         "hans@example.com", "49-170-1234567", "WhatsApp", "+491701234",
         _date(2026, 1, 10), "日期格式：文本、斜杠、Excel日期格都能识别", "2026/1/3"],
    ]
    for r, sample in enumerate(samples, HEADER_ROW + 1):
        for col, v in enumerate(sample, 1):
            c = ws.cell(row=r, column=col, value=v)
            c.font = Font(name=FONT_NAME, size=10, italic=True, color="999999")
            c.fill = PatternFill(start_color="F2F2F2", end_color="F2F2F2", fill_type="solid")
            c.alignment = S['center_alignment']
        # 时间列示例统一为文本格式显示，避免用户看到示例被 Excel 转成自己的区域格式
        for col in (15, 17):  # 最近跟进日期 O、创建时间 Q
            ws.cell(row=r, column=col).number_format = '@'

    # 数据区：电话/邮箱列设为文本格式，防止长号码变科学计数法
    from openpyxl.utils import get_column_letter
    text_cols = {11, 12}  # 邮箱 K、电话 L
    for col in text_cols:
        letter = get_column_letter(col)
        for r in range(HEADER_ROW + 1, HEADER_ROW + 201):
            ws.cell(row=r, column=col).number_format = '@'

    # 下拉选项（状态 / 社交软件）：来源与等级自由填写，靠导入匹配兜底
    dvs = [
        ('F', '"新线索,初步沟通,已报价未成交,谈判中,已成交,已流失"'),
        ('M', '"WhatsApp,微信,其他"'),
    ]
    from openpyxl.worksheet.datavalidation import DataValidation
    for letter, formula in dvs:
        dv = DataValidation(type="list", formula1=formula, allow_blank=True, showErrorMessage=False)
        ws.add_data_validation(dv)
        dv.add(f"{letter}{HEADER_ROW + 1}:{letter}{HEADER_ROW + 200}")

    # 列宽
    widths = {'A': 26, 'B': 12, 'C': 16, 'D': 18, 'E': 8, 'F': 14,
              'G': 22, 'H': 30, 'I': 12, 'J': 12, 'K': 26, 'L': 16,
              'M': 12, 'N': 16, 'O': 13, 'P': 35, 'Q': 12}
    for letter, w in widths.items():
        if letter <= get_column_letter(num_cols):
            ws.column_dimensions[letter].width = w

    # 冻结表头；默认激活「客户数据」sheet（用户打开先看到要填的表）
    ws.freeze_panes = f"A{HEADER_ROW + 3}"
    wb.active = wb.sheetnames.index("客户数据")

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return Response(
        content=out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=import_template.xlsx"},
    )


@app.get("/api/export")
def export_excel(
    ids: str = "",
    start: int = Query(1, ge=1),
    end: int = Query(0, ge=0),
    search: str = '',
    country: str = '',
    level: str = '',
    status: str = '',
    source: str = '',
    starred: bool = False,
    issues: bool = False,
    sort_by: str = 'company',
    sort_asc: bool = True,
):
    """
    导出 Excel。支持：ids=逗号分隔 / 序号范围 start-end / 全量。

    序号范围模式沿用与列表接口相同的筛选与排序参数，保证"序号 N"
    与客户列表里看到的序号一致。Excel 内的序号列按导出范围重新从 1
    编号（纯展示用途，与内部 id 无关）；导入时按公司名称识别重复，
    完全不读序号列。
    """
    with get_db() as db:
        rows: List[Dict[str, Any]] = []
        if ids:
            id_list = [x for x in ids.split(',') if x]
            placeholders = ",".join("?" * len(id_list))
            raw = db.execute(
                f"""
                SELECT * FROM (
                    SELECT c.*, MAX(f.created_at) as last_followup_at
                    FROM customers c
                    LEFT JOIN followups f ON c.id = f.customer_id
                    WHERE c.id IN ({placeholders})
                    GROUP BY c.id
                )
                ORDER BY company
                """,
                id_list,
            ).fetchall()
            rows = [row_to_customer(r) for r in raw]
        else:
            # 复用列表查询逻辑（同样的筛选/排序），page_size 拉到上限拿全量
            page_size = 500
            page = 1
            while True:
                items, total = query_customers(
                    db,
                    **build_query_params(
                        search, country, level, status, source,
                        starred, issues, sort_by, sort_asc,
                        page, page_size,
                    ),
                )
                rows.extend(items)
                if len(rows) >= total or not items:
                    break
                page += 1
            if start and end:
                rows = rows[max(0, start - 1):end]
            elif start > 1:
                rows = rows[start - 1:]

        # 预取所有跟进记录，避免 N+1 查询
        followup_by_customer: Dict[str, Any] = {}
        for f in db.execute("""
            SELECT * FROM followups
            WHERE id IN (SELECT MAX(id) FROM followups GROUP BY customer_id)
        """).fetchall():
            followup_by_customer[f['customer_id']] = f

    wb = Workbook()
    ws = wb.active
    ws.title = "客户总表"
    S = EXPORT_STYLES
    num_cols = len(EXPORT_HEADERS)

    # 标题
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=num_cols)
    t = ws.cell(row=1, column=1, value="外贸CRM客户总表")
    t.font = S['title_font']
    t.alignment = S['title_alignment']
    ws.row_dimensions[1].height = 30

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=num_cols)
    st = ws.cell(row=2, column=1,
                 value=f"导出日期：{datetime.now().strftime('%Y年%m月%d日')}")
    st.font = S['subtitle_font']
    st.alignment = S['subtitle_alignment']
    ws.row_dimensions[2].height = 20
    ws.row_dimensions[3].height = 10

    for col, h in enumerate(EXPORT_HEADERS, 1):
        cell = ws.cell(row=HEADER_ROW, column=col, value=h)
        cell.font = S['header_font']
        cell.fill = S['header_fill']
        cell.alignment = S['header_alignment']
        cell.border = S['header_border']
    ws.row_dimensions[HEADER_ROW].height = 28

    row_idx = HEADER_ROW + 1
    # 序号按导出范围重新编号 1..N：纯展示用途，多联系人客户占多行但共享同一序号
    for seq, c in enumerate(rows, 1):
        contacts = c.get('contacts') or []
        if not contacts:
            contacts = [{}]
        last_followup = followup_by_customer.get(c['id'])
        followup_date = date_only(last_followup['created_at']) if last_followup else ''
        followup_content = last_followup['content'] if last_followup else ''
        created_date = date_only(c['created_at'])

        for contact in contacts:
            values = [
                seq, c['company'], c['country'], c['source'], c['level'],
                STATUS_MAP.get(c['status'], c['status']), c['products'], c['note'],
                contact.get('name', ''), contact.get('position', ''),
                contact.get('email', ''), contact.get('phone', ''),
                SOCIAL_MAP.get(contact.get('social', ''), contact.get('social', '')),
                contact.get('socialAccount', ''),
                followup_date, followup_content, created_date,
            ]
            for col, v in enumerate(values, 1):
                ws.cell(row=row_idx, column=col, value=v)
            row_idx += 1

    # 数据行样式
    for row_num in range(HEADER_ROW + 1, row_idx):
        is_zebra = (row_num - (HEADER_ROW + 1)) % 2 == 1
        for col_num in range(1, num_cols + 1):
            cell = ws.cell(row=row_num, column=col_num)
            cell.font = S['data_font']
            cell.border = S['bottom_border']
            cell.alignment = S['center_alignment']
            if is_zebra:
                cell.fill = S['zebra_fill']
        status_cell = ws.cell(row=row_num, column=6)
        if status_cell.value in S['status_fills']:
            status_cell.fill = S['status_fills'][status_cell.value]
            status_cell.font = S['status_font']
        ws.row_dimensions[row_num].height = 22

    for col_letter, width in S['col_widths'].items():
        ws.column_dimensions[col_letter].width = width

    ws.sheet_view.showGridLines = False
    ws.freeze_panes = f"A{HEADER_ROW + 1}"

    filepath = os.path.join(BASE_DIR, "crm_export.xlsx")
    wb.save(filepath)
    filename = f"CRM客户导出_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return FileResponse(filepath, filename=filename)


# ---------- Excel 导入 ----------

def _cell_str(v: Any) -> str:
    """单元格值转干净的文本：去首尾空白，浮点整数去掉 .0，None/纯空返回空串"""
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return '' if s.lower() == 'none' else s


def _excel_serial_to_date(serial: float) -> str:
    """Excel 日期序列号（1900 体系）转 YYYY-MM-DD"""
    try:
        from datetime import timedelta
        base = datetime(1899, 12, 30)  # Excel 纪元修正
        return (base + timedelta(days=int(serial))).strftime("%Y-%m-%d")
    except (ValueError, OverflowError):
        return ''


def _cell_date(v: Any) -> str:
    """日期列归一：datetime 对象 / Excel 序列号 / 各种文本格式 → YYYY-MM-DD"""
    if v is None or v == '':
        return ''
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, (int, float)) and 20000 < float(v) < 80000:
        # 合理的 Excel 日期序列号范围（1954~2119 年）
        return _excel_serial_to_date(float(v))
    s = _cell_str(v)
    if not s:
        return ''
    # 2026/1/30、2026-1-30、2026.1.30 → 2026-01-30
    m = re.match(r'^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?$', s)
    if m:
        try:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return d.strftime("%Y-%m-%d")
        except ValueError:
            return s
    return date_only(s)


def _cell_datetime(v: Any) -> str:
    """时间列归一：datetime 对象 / 序列号 / 文本 → YYYY-MM-DD HH:MM:SS"""
    if v is None or v == '':
        return ''
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, (int, float)) and 20000 < float(v) < 80000:
        d = _excel_serial_to_date(float(v))
        return f"{d} 00:00:00" if d else ''
    s = _cell_str(v)
    return normalize_dt(s) if s else ''


def _cell_phone(v: Any) -> str:
    """电话/号码列归一：Excel 数字单元格里 5550100123 会读成浮点 5550100123.0，
    直接 str() 没问题，但 1.2E+10 这类科学计数法要还原成整串数字"""
    if v is None:
        return ''
    if isinstance(v, (int, float)):
        if float(v).is_integer():
            return str(int(v))
        return repr(v).rstrip('0').rstrip('.')
    return _cell_str(v)


@app.post("/api/import")
async def import_excel(file: UploadFile = File(...)):
    """导入导出的 Excel。同名公司跳过；不合规数据记入 data_issues。

    单元格容错：Excel 里手动输入的日期可能是 datetime 对象、数字（1900 序列）、
    浮点电话号码（5550100123.0）等，这里统一做类型归一，避免乱码/科学计数法入库。
    """
    if not file.filename or not file.filename.lower().endswith('.xlsx'):
        raise HTTPException(400, "请上传 .xlsx 文件")

    content = await file.read()
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            wb = load_workbook(tmp_path, read_only=True, data_only=True)
        except Exception:
            raise HTTPException(400, "无法读取 Excel 文件，请确认文件未损坏")
        # 模板有两个 sheet（填写说明/客户数据）：优先找带表头的那个
        ws = None
        header_row = None
        for sheet in wb.worksheets:
            for row_idx in range(1, 11):
                first = _cell_str(sheet.cell(row=row_idx, column=1).value)
                if first == '序号' or first == '公司名称':
                    ws, header_row = sheet, row_idx
                    break
            if ws:
                break
        if not ws:
            raise HTTPException(400, "未找到表头行。请使用系统导出的Excel或导入模板（表头行不能删改）")

        # 按表头列名定位各字段列（模板与导出格式都兼容），找不到的列取 None
        col_map: Dict[str, int] = {}
        for col_idx in range(1, 25):
            name = _cell_str(ws.cell(row=header_row, column=col_idx).value)
            if name:
                col_map[name] = col_idx

        def val(row, name: str) -> Any:
            idx = col_map.get(name)
            return row[idx - 1] if idx and idx - 1 < len(row) else None

        # 按公司名分组，兼容空公司名（继承上一行）
        customers_map: Dict[str, Dict[str, Any]] = {}
        last_company = None
        for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
            company = _cell_str(val(row, '公司名称'))
            # 跳过模板自带的示例行
            if company.startswith('示例公司'):
                continue
            if not company:
                company = last_company
                if not company:
                    continue
            else:
                last_company = company

            entry = customers_map.setdefault(company, {
                'company': company,
                'country': _cell_str(val(row, '国家')),
                'source': _cell_str(val(row, '来源')),
                'level': _cell_str(val(row, '等级')),
                'status': STATUS_REVERSE_MAP.get(_cell_str(val(row, '状态')), 'lead'),
                'products': _cell_str(val(row, '主要产品')),
                'note': _cell_str(val(row, '备注')),
                'contacts': [],
                'followups': [],  # 该客户的全部跟进（每行一条，去重后入库）
                'created_at': _cell_datetime(val(row, '创建时间')),
            })

            # 跟进记录：每个 Excel 行都可以带一条「日期+内容」，
            # 同一客户写多行（公司名留空沿用）即可导入多条历史跟进
            fu_date = _cell_date(val(row, '最近跟进日期'))
            fu_content = _cell_str(val(row, '最近跟进内容'))
            if fu_date or fu_content:
                entry['followups'].append({
                    'date': fu_date,
                    'content': fu_content,
                })

            contact_name = _cell_str(val(row, '联系人姓名'))
            if contact_name:
                entry['contacts'].append({
                    'name': contact_name,
                    'position': _cell_str(val(row, '职位')),
                    'email': _cell_str(val(row, '邮箱')),
                    'phone': _cell_phone(val(row, '电话')),
                    'social': SOCIAL_REVERSE_MAP.get(_cell_str(val(row, '社交软件')), _cell_str(val(row, '社交软件'))),
                    'socialAccount': _cell_phone(val(row, '社交账号')),
                })
        wb.close()

        # 表内邮箱重复统计：记录邮箱 -> [(公司, 联系人姓名)]
        email_owners: Dict[str, List[Tuple[str, str]]] = {}
        for company, data in customers_map.items():
            for ct in data['contacts']:
                e = (ct.get('email') or '').strip().lower()
                if e:
                    email_owners.setdefault(e, []).append((company, ct.get('name') or '未知联系人'))

        imported = 0
        skipped = 0
        with get_db() as db:
            existing = {
                r['company'] for r in db.execute("SELECT company FROM customers").fetchall()
            }
            for company, data in customers_map.items():
                if company in existing:
                    skipped += 1
                    continue

                issues = validate_customer(db, data)
                # 表内邮箱重复：明确指出与哪个公司的哪个联系人重复
                seen_emails = set()
                for ct in data['contacts']:
                    e = (ct.get('email') or '').strip().lower()
                    if not e or e in seen_emails:
                        continue
                    owners = email_owners.get(e, [])
                    if len(owners) > 1:
                        # 找出除自己之外的第一条
                        others = [o for o in owners if o[0] != company] or owners
                        other_company, other_name = others[0]
                        issues.append(f"邮箱重复：{e}（与{other_company}的{other_name}重复）")
                        seen_emails.add(e)

                cid = f"c{uuid.uuid4().hex[:8]}"
                ts = now_str()
                db.execute(
                    "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, products, contacts, created_at, data_issues, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        cid, company,
                        data['contacts'][0]['name'] if data['contacts'] else '',
                        normalize_country(data['country']),
                        data['contacts'][0]['email'] if data['contacts'] else '',
                        data['contacts'][0]['phone'] if data['contacts'] else '',
                        data['source'], data['level'], data['status'],
                        data['note'], data['products'],
                        json.dumps(data['contacts'], ensure_ascii=False),
                        data['created_at'] or ts,
                        json.dumps(issues, ensure_ascii=False), ts,
                    ),
                )
                _update_search_text(db, cid)
                # 跟进记录：按 (日期, 内容) 去重后全部入库；日期空的内容行记导入时间
                seen_fu = set()
                for fu in data.get('followups', []):
                    sig = (fu['date'], fu['content'])
                    if sig in seen_fu or (not fu['date'] and not fu['content']):
                        continue
                    seen_fu.add(sig)
                    fu_ts = fu['date'] and f"{fu['date']} 12:00:00" or ts
                    db.execute(
                        "INSERT INTO followups (id, customer_id, type, content, next_follow_up_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                        (
                            f"f{uuid.uuid4().hex[:8]}", cid, 'other',
                            fu['content'], '',
                            fu_ts, fu_ts,
                        ),
                    )
                imported += 1

        return {"imported": imported, "skipped": skipped, "total": len(customers_map)}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ---------- 跟进记录 API ----------

@app.get("/api/followups")
def list_followups(
    customer_id: str = '',
    page: int = 1,
    page_size: int = 100,
):
    """跟进记录，可按客户过滤，默认按时间倒序"""
    where = "WHERE customer_id = ?" if customer_id else ""
    params: List[Any] = [customer_id] if customer_id else []
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 100), 500))
    offset = (page - 1) * page_size
    with get_db() as db:
        total = db.execute(f"SELECT COUNT(*) FROM followups {where}", params).fetchone()[0]
        rows = db.execute(
            f"SELECT * FROM followups {where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            params + [page_size, offset],
        ).fetchall()
    return {"items": [dict(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@app.post("/api/followups")
def create_followup(f: FollowUp):
    fid = f"f{uuid.uuid4().hex[:8]}"
    created_at = normalize_dt(f.created_at) if f.created_at else now_str()
    next_at = date_only(f.next_follow_up_at)
    with get_db() as db:
        exists = db.execute(
            "SELECT id FROM customers WHERE id = ?", (f.customer_id,)
        ).fetchone()
        if not exists:
            raise HTTPException(404, "客户不存在")
        db.execute(
            "INSERT INTO followups (id, customer_id, type, content, next_follow_up_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (fid, f.customer_id, f.type, f.content, next_at, created_at, created_at),
        )
    return {"id": fid}


@app.put("/api/followups/{fid}")
def update_followup(fid: str, f: FollowUp):
    """跟进记录可编辑"""
    with get_db() as db:
        existing = db.execute("SELECT id, updated_at FROM followups WHERE id = ?", (fid,)).fetchone()
        if not existing:
            raise HTTPException(404, "跟进记录不存在")

        # 乐观锁
        if f.updated_at and existing['updated_at'] and f.updated_at != existing['updated_at']:
            raise HTTPException(409, "数据已被其他操作修改，请刷新后重试")

        # 未提供时间则保留原值
        created_at = (
            normalize_dt(f.created_at)
            if f.created_at
            else db.execute("SELECT created_at FROM followups WHERE id = ?", (fid,)).fetchone()['created_at']
        )
        ts = now_str()
        db.execute(
            "UPDATE followups SET type=?, content=?, next_follow_up_at=?, created_at=?, updated_at=? WHERE id=?",
            (
                f.type, f.content, date_only(f.next_follow_up_at),
                created_at, ts, fid,
            ),
        )
    return {"ok": True, "updated_at": ts}


@app.delete("/api/followups/{fid}")
def delete_followup(fid: str):
    with get_db() as db:
        db.execute("DELETE FROM followups WHERE id = ?", (fid,))
    return {"ok": True}


@app.post("/api/followups/batch")
def batch_followups(body: BatchIds):
    ids = [i for i in (body.ids or []) if i]
    if not ids:
        raise HTTPException(400, "没有选择记录")
    placeholders = ",".join("?" * len(ids))
    with get_db() as db:
        cur = db.execute(f"DELETE FROM followups WHERE id IN ({placeholders})", ids)
    return {"ok": True, "affected": cur.rowcount}


# ---------- WebDAV 同步 ----------

def load_config() -> Dict[str, Any]:
    try:
        # utf-8-sig 兼容带 BOM 的文件（用户手工编辑过配置的常见情况）
        with open(CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_config(config: Dict[str, Any]) -> None:
    """配置文件权限收紧：仅当前用户可读写（Windows 上用 ACL 近似处理）"""
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    try:
        os.chmod(CONFIG_PATH, 0o600)
    except OSError:
        pass  # Windows 上 chmod 语义有限，尽力而为


@app.get("/api/sync/config")
def get_sync_config():
    config = load_config()
    return {
        "webdav_url": config.get("webdav_url", ""),
        "webdav_user": config.get("webdav_user", ""),
        "webdav_pass_saved": bool(config.get("webdav_pass", "")),
        "auto_sync": config.get("auto_sync", True),
    }


@app.post("/api/sync/config")
def update_sync_config(config: SyncConfig):
    """局部更新同步配置：空字段保留原值，避免重新绑定时把已有配置冲掉"""
    current = load_config()
    merged = {
        "webdav_url": (config.webdav_url or current.get("webdav_url", "")).rstrip('/'),
        "webdav_user": config.webdav_user or current.get("webdav_user", ""),
        "webdav_pass": config.webdav_pass or current.get("webdav_pass", ""),
        "auto_sync": config.auto_sync,
    }
    save_config(merged)
    # 绑定成功的瞬间立即做一次「首次同步」：
    # 用户是「先启动、后绑定」的，后台线程的首次拉取早在绑定前就跳过了，
    # 这里补上，否则会出现「绑定了但没反应、也没让用户选择」的情况。
    first_run_pulled = False
    try:
        first_run_pulled = _first_run_pull()
    except Exception:
        pass
    try:
        return {"ok": True, "first_run_pulled": first_run_pulled, "inspect": sync_inspect()}
    except Exception:
        return {"ok": True, "first_run_pulled": first_run_pulled, "inspect": None}


@app.post("/api/sync/test")
def sync_test(config: SyncConfig):
    if not config.webdav_url or not config.webdav_user:
        return {"ok": False, "message": "请先填写地址和账号"}
    try:
        folder_url = f"{config.webdav_url}/crm/"
        wd_request('MKCOL', folder_url, config, timeout=10)
        test_url = f"{config.webdav_url}/crm/.crm_test"
        res = wd_request('PUT', test_url, config, data=b'test',
                              headers={'Content-Type': 'text/plain'}, timeout=10)
        if res.status_code in (200, 201, 204):
            wd_request('DELETE', test_url, config, timeout=10)
            return {"ok": True, "message": "连接成功！账号密码正确"}
        if res.status_code == 401:
            return {"ok": False, "message": "账号或密码错误（注意要用应用密码，不是登录密码）"}
        return {"ok": False, "message": f"连接失败：HTTP {res.status_code}"}
    except Exception as e:
        return {"ok": False, "message": f"连接失败：{e}"}


def _remote_db_url(config: Dict[str, Any]) -> str:
    return f"{config['webdav_url']}/crm/trade_crm.db"


# ---------- WebDAV 请求统一封装（代理友好） ----------

def _wd_auth(config: Any):
    """取 WebDAV 认证信息，兼容 dict 与 pydantic 模型两种传法"""
    if isinstance(config, dict):
        return (config.get("webdav_user", ""), config.get("webdav_pass", ""))
    return (getattr(config, "webdav_user", ""), getattr(config, "webdav_pass", ""))


def wd_request(method: str, url: str, config: Dict[str, Any], **kwargs):
    """发起 WebDAV 请求。

    先按系统代理设置请求（用户开了代理时才能连外网）；
    若因代理导致的连接失败，自动改为直连再试一次。

    这样无论用户的代理怎么配，要么走代理连上，要么直连连上。
    """
    import requests

    kwargs.setdefault("timeout", 30)
    auth = _wd_auth(config)
    last_exc = None

    # 第一次：走系统代理（requests 默认会读 Windows 注册表的代理设置）
    try:
        return requests.request(method, url, auth=auth, **kwargs)
    except Exception as e:
        last_exc = e

    # 第二次：绕过代理直连
    try:
        s = requests.Session()
        s.trust_env = False
        return s.request(method, url, auth=auth, **kwargs)
    except Exception:
        raise last_exc if last_exc else Exception("请求失败")


def _db_fingerprint(path: str) -> Dict[str, Any]:
    """本地数据库指纹：大小 + 修改时间 + 校验和，用于判断两端是否一致"""
    st = os.stat(path)
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return {
        "size": st.st_size,
        "mtime": int(st.st_mtime),
        "md5": h.hexdigest(),
    }


def _remote_fingerprint_ex(config: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], str]:
    """云端数据库指纹（PROPFIND），返回 (指纹, 错误信息)

    - 指纹 None 且错误为空 → 云端确实没有该文件
    - 指纹 None 且错误非空 → 网络不通或鉴权失败（绝不能当成「云端为空」）

    注意：坚果云 HEAD 会返回错误的 Content-Length，必须用 PROPFIND。
    """
    import requests
    import re as _re
    try:
        res = wd_request('PROPFIND', f"{config['webdav_url']}/crm/", config,
                         headers={'Depth': '1'}, timeout=20)
    except Exception as e:
        return None, f"网络不可达：{type(e).__name__}"
    if res.status_code == 401:
        return None, "账号或应用密码无效"
    if res.status_code == 404:
        return None, ""
    if res.status_code not in (200, 207):
        return None, f"HTTP {res.status_code}"
    body = res.text
    m = _re.search(
        r"<[dD]:href>[^<]*trade_crm\.db</[dD]:href>(.*?)</[dD]:response>", body, _re.S)
    if not m:
        return None, ""
    block = m.group(0)
    size_m = _re.search(r"<[dD]:getcontentlength>(\d+)</[dD]:getcontentlength>", block)
    mod_m = _re.search(r"<[dD]:getlastmodified>([^<]+)</[dD]:getlastmodified>", block)
    size = int(size_m.group(1)) if size_m else 0
    mtime_raw = mod_m.group(1).strip() if mod_m else ""
    mtime = 0
    if mtime_raw:
        try:
            from email.utils import parsedate_to_datetime
            mtime = int(parsedate_to_datetime(mtime_raw).timestamp())
        except Exception:
            mtime = 0
    return {"size": size, "mtime": mtime, "last_modified": mtime_raw}, ""


def _remote_fingerprint(config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """云端数据库指纹（简单版）：拿不到返回 None"""
    fp, _ = _remote_fingerprint_ex(config)
    return fp


def _snapshot_db() -> str:
    """生成数据库一致性快照（VACUUM INTO），避免直接上传正在写入的库导致损坏/0 字节。
    返回快照临时文件路径，调用方负责删除。"""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
    tmp.close()
    os.unlink(tmp.name)  # VACUUM INTO 要求目标不存在
    with _db_lock:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        try:
            conn.execute("VACUUM INTO ?", (tmp.name,))
        finally:
            conn.close()
    return tmp.name


def _validate_db_file(path: str) -> None:
    """校验下载到的数据库可用；损坏/空文件直接拒绝，避免覆盖本地好数据"""
    if not os.path.exists(path):
        raise HTTPException(500, "下载的文件不存在")
    size = os.path.getsize(path)
    if size == 0:
        raise HTTPException(500, "云端数据库文件为空（0 字节），已拒绝覆盖本地数据")
    try:
        conn = sqlite3.connect(path)
        try:
            tables = {r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            if "customers" not in tables:
                raise HTTPException(500, "云端数据库缺少 customers 表，已拒绝覆盖本地数据")
            conn.execute("SELECT COUNT(*) FROM customers").fetchone()
        finally:
            conn.close()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"云端数据库文件损坏（{e}），已拒绝覆盖本地数据")


def _download_remote_db(config: Dict[str, Any]) -> Optional[str]:
    """下载云端数据库到临时文件并校验；不存在返回 None"""
    import requests
    res = wd_request('GET', _remote_db_url(config), config, timeout=60)
    if res.status_code == 404:
        return None
    if res.status_code != 200:
        raise HTTPException(500, f"下载失败：HTTP {res.status_code}")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
    tmp.write(res.content)
    tmp.close()
    try:
        _validate_db_file(tmp.name)
    except HTTPException:
        os.unlink(tmp.name)
        raise
    return tmp.name


def _upload_db(config: Dict[str, Any]) -> Dict[str, Any]:
    """上传本地数据库（先做一致性快照，失败不污染云端）"""
    import requests
    snapshot = _snapshot_db()
    try:
        size = os.path.getsize(snapshot)
        if size == 0:
            raise HTTPException(500, "本地数据库为空，已取消上传以避免覆盖云端数据")
        with open(snapshot, 'rb') as f:
            res = wd_request('PUT', _remote_db_url(config), config, data=f,
                             headers={"Content-Type": "application/octet-stream"}, timeout=120)
        if res.status_code not in (200, 201, 204):
            raise HTTPException(500, f"上传失败：HTTP {res.status_code} - {res.text[:200]}")
        return {"ok": True, "size": size}
    finally:
        try:
            os.unlink(snapshot)
        except OSError:
            pass



@app.post("/api/sync/upload")
def sync_upload():
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        raise HTTPException(400, "请先配置WebDAV账号")
    try:
        import requests
        wd_request('MKCOL', f"{config['webdav_url']}/crm/", config, timeout=10)
        return _upload_db(config)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"上传失败：{e}")


@app.post("/api/sync/download")
def sync_download():
    """以云端为准：下载覆盖本地。覆盖前保留带时间戳的备份。"""
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        raise HTTPException(400, "请先配置WebDAV账号")
    tmp_path = None
    backup_path = None
    try:
        with _db_lock:
            tmp_path = _download_remote_db(config)
            if tmp_path is None:
                return {"ok": True, "message": "服务器上还没有数据库文件"}
            if os.path.exists(DB_PATH):
                stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                backup_path = os.path.join(BASE_DIR, f"trade_crm.db.bak_{stamp}")
                shutil.copy2(DB_PATH, backup_path)
            shutil.move(tmp_path, DB_PATH)
            tmp_path = None
        # 换库后重建连接相关的初始化（索引/迁移）保证结构一致
        with get_db() as db:
            migrate_countries(db)
            normalize_datetimes(db)
            _backfill_search_text(db)
        return {"ok": True, "size": os.path.getsize(DB_PATH), "backup": backup_path}
    except HTTPException:
        _restore(backup_path)
        raise
    except Exception as e:
        _restore(backup_path)
        raise HTTPException(500, f"下载失败：{e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _restore(backup_path: Optional[str]):
    if backup_path and os.path.exists(backup_path) and not os.path.exists(DB_PATH):
        try:
            shutil.copy2(backup_path, DB_PATH)
        except OSError:
            pass


def _merge_databases(config: Dict[str, Any], prefer_local: bool = True) -> Dict[str, Any]:
    """双向融合本地与云端数据库，结果写回本地并上传，使两端一致。

    规则：
    - 客户按 company（去空格小写）匹配；id 不同但公司名相同视为同一客户
    - 同一客户两边都有：逐字段取「updated_at 较新」的一方；时间相同则按 prefer_local
    - 只在一端存在的客户：直接并入
    - 跟进记录按 (customer_id, created_at, content) 去重合并
    - 操作前自动备份本地库
    """
    tmp_remote = None
    backup_path = None
    try:
        with _db_lock:
            tmp_remote = _download_remote_db(config)
            if tmp_remote is None:
                raise HTTPException(404, "云端没有数据库文件")
            if not os.path.exists(DB_PATH):
                raise HTTPException(500, "本地数据库不存在")

            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            os.makedirs(BACKUP_DIR, exist_ok=True)
            backup_path = os.path.join(BACKUP_DIR, f"before_merge_{stamp}.db")
            shutil.copy2(DB_PATH, backup_path)

            local_db = sqlite3.connect(DB_PATH)
            local_db.row_factory = sqlite3.Row
            remote_db = sqlite3.connect(tmp_remote)
            remote_db.row_factory = sqlite3.Row

            def cols(conn, table):
                return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]

            lcols = cols(local_db, "customers")
            rcols = cols(remote_db, "customers")
            common_cols = [c for c in lcols if c in rcols]
            # 不含主键 id：id 由本地决定，避免主键冲突
            merge_cols = [c for c in common_cols if c != "id"]

            def key(company: str) -> str:
                return re.sub(r"\s+", "", (company or "")).lower()

            def get(row, name):
                try:
                    return row[name]
                except (IndexError, KeyError):
                    return ""

            local_rows = local_db.execute("SELECT * FROM customers").fetchall()
            remote_rows = remote_db.execute("SELECT * FROM customers").fetchall()

            local_by_key = {key(r["company"]): r for r in local_rows}
            remote_by_key = {key(r["company"]): r for r in remote_rows}

            added = 0
            updated = 0

            # 1) 云端独有 → 插入本地
            for k, rc in remote_by_key.items():
                if k in local_by_key:
                    continue
                new_id = rc["id"] or f"c{uuid.uuid4().hex[:8]}"
                # 极端情况：id 冲突但公司不同，换新 id
                if local_db.execute("SELECT 1 FROM customers WHERE id=?", (new_id,)).fetchone():
                    new_id = f"c{uuid.uuid4().hex[:8]}"
                values = [get(rc, c) for c in merge_cols]
                local_db.execute(
                    f"INSERT INTO customers (id, {', '.join(merge_cols)}) "
                    f"VALUES ({', '.join(['?'] * (len(merge_cols) + 1))})",
                    [new_id] + values,
                )
                added += 1
                local_by_key[k] = local_db.execute(
                    "SELECT * FROM customers WHERE id=?", (new_id,)).fetchone()

            # 2) 两端都有 → 字段级合并
            for k, lr in list(local_by_key.items()):
                if not isinstance(lr, sqlite3.Row):
                    continue
                rc = remote_by_key.get(k)
                if rc is None:
                    continue
                l_upd = get(lr, "updated_at") or get(lr, "created_at") or ""
                r_upd = get(rc, "updated_at") or get(rc, "created_at") or ""
                if l_upd == r_upd:
                    local_wins = prefer_local
                else:
                    local_wins = l_upd > r_upd
                if local_wins:
                    continue
                # 云端更新 → 用云端字段覆盖本地（保留本地 id，避免跟进记录失联）
                sets = ", ".join(f"{c}=?" for c in merge_cols)
                local_db.execute(
                    f"UPDATE customers SET {sets} WHERE id=?",
                    [get(rc, c) for c in merge_cols] + [lr["id"]],
                )
                updated += 1

            # 3) 跟进记录：按 (customer, created_at, content) 去重后并入
            lcols_f = cols(local_db, "followups")
            rcols_f = cols(remote_db, "followups")
            f_cols = [c for c in lcols_f if c in rcols_f and c != "id"]

            local_fu = {
                (get(r, "customer_id"), get(r, "created_at"), (get(r, "content") or "").strip())
                for r in local_db.execute("SELECT * FROM followups").fetchall()
            }
            fu_added = 0
            for fu in remote_db.execute("SELECT * FROM followups").fetchall():
                cid = get(fu, "customer_id")
                # 云端客户 id 可能被映射到本地 id
                if not local_db.execute("SELECT 1 FROM customers WHERE id=?", (cid,)).fetchone():
                    rcomp = remote_db.execute(
                        "SELECT company FROM customers WHERE id=?", (cid,)).fetchone()
                    if not rcomp:
                        continue
                    lrow = local_db.execute(
                        "SELECT id FROM customers WHERE lower(replace(company,' ',''))=?",
                        (key(rcomp["company"]),)).fetchone()
                    if not lrow:
                        continue
                    cid = lrow["id"]
                sig = (cid, get(fu, "created_at"), (get(fu, "content") or "").strip())
                if sig in local_fu:
                    continue
                local_db.execute(
                    f"INSERT INTO followups (id, {', '.join(f_cols)}) "
                    f"VALUES ({', '.join(['?'] * (len(f_cols) + 1))})",
                    [f"f{uuid.uuid4().hex[:8]}"] + [
                        cid if c == "customer_id" else get(fu, c) for c in f_cols
                    ],
                )
                local_fu.add(sig)
                fu_added += 1

            # 融合改动了客户（新增/字段覆盖），全部重算 search_text
            for row in local_db.execute("SELECT id FROM customers").fetchall():
                _update_search_text(local_db, row["id"])

            local_db.commit()
            local_db.close()
            remote_db.close()

        # 上传融合结果，使两端完全一致
        _upload_db(config)
        return {
            "added": added,
            "updated": updated,
            "followups_added": fu_added,
            "backup": backup_path,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"融合失败：{e}")
    finally:
        if tmp_remote and os.path.exists(tmp_remote):
            try:
                os.unlink(tmp_remote)
            except OSError:
                pass


@app.post("/api/sync/merge")
def sync_merge():
    """双向融合合并：两端数据取并集，冲突字段按 updated_at 较新的一方，最后上传使两端一致"""
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        raise HTTPException(400, "请先配置WebDAV账号")
    res = _merge_databases(config, prefer_local=True)
    _mark_synced()
    return {"ok": True, **res}


@app.post("/api/sync/check_remote")
def check_remote():
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        return {"has_remote": False}
    # 注意：坚果云 HEAD 返回的 Content-Length 不可靠，改用 PROPFIND
    fp = _remote_fingerprint(config)
    return {"has_remote": fp is not None and fp.get("size", 0) > 0}


@app.post("/api/sync/logout")
def sync_logout():
    """登出：只清本地凭据，云端 profile.json 与 trade_crm.db 均保留"""
    save_config({"webdav_url": "", "webdav_user": "", "webdav_pass": "", "auto_sync": True})
    return {"ok": True}


@app.get("/api/sync/status")
def sync_status():
    """只读：是否已绑定坚果云（不返回密码）"""
    config = load_config()
    return {"bound": bool(config.get("webdav_url") and config.get("webdav_user") and config.get("webdav_pass"))}


# ---------- 同步状态探测与自动同步 ----------

# 记录上次与云端一致时的指纹，避免每次启动都重复询问
SYNC_STATE_PATH = os.path.join(BASE_DIR, "sync_state.json")


def _load_sync_state() -> Dict[str, Any]:
    try:
        with open(SYNC_STATE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_sync_state(state: Dict[str, Any]) -> None:
    try:
        with open(SYNC_STATE_PATH, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except OSError:
        pass


def _counts(path: str) -> Dict[str, int]:
    """库内记录数，用于同步摘要"""
    try:
        conn = sqlite3.connect(path)
        try:
            c = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
            f = conn.execute("SELECT COUNT(*) FROM followups").fetchone()[0]
            return {"customers": c, "followups": f}
        finally:
            conn.close()
    except Exception:
        return {"customers": -1, "followups": -1}


@app.get("/api/sync/inspect")
def sync_inspect():
    """对比本地与云端：是否一致、各自时间与记录数，供前端决定如何处理

    - status: no_remote 云端无库 / same 完全一致 / local_newer 本地较新 /
              remote_newer 云端较新 / diverged 两端都有改动
    - 已确认一致（md5 相同）时不会重复询问
    """
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user") or not config.get("webdav_pass"):
        return {"bound": False, "status": "unbound"}

    local = _db_fingerprint(DB_PATH) if os.path.exists(DB_PATH) else {"size": 0, "mtime": 0, "md5": ""}
    remote, remote_err = _remote_fingerprint_ex(config)
    if remote is None:
        # 断网不能报成 no_remote，否则用户会误以为云端是空的
        if remote_err:
            return {"bound": True, "status": "offline", "local": local,
                    "local_counts": _counts(DB_PATH),
                    "message": f"无法连接云端（{remote_err}），本地改动已保存，恢复网络后会自动同步"}
        return {"bound": True, "status": "no_remote", "local": local,
                "local_counts": _counts(DB_PATH)}

    # 云端 0 字节：异常状态，提示用户上传覆盖
    if remote["size"] == 0:
        return {"bound": True, "status": "remote_empty", "local": local, "remote": remote,
                "local_counts": _counts(DB_PATH),
                "message": "云端数据库为空（0 字节），建议以本地为准上传"}

    state = _load_sync_state()
    same_size = local["size"] == remote["size"]
    same_meta = same_size and local["mtime"] == remote["mtime"]

    local_counts = _counts(DB_PATH)

    # 预取云端记录数（同时用于数据量判断与展示）
    remote_counts = {"customers": -1, "followups": -1}
    try:
        tmp = _download_remote_db(config)
        if tmp:
            try:
                remote_counts = _counts(tmp)
            finally:
                os.unlink(tmp)
    except HTTPException:
        pass

    if same_meta:
        return {"bound": True, "status": "same", "local": local, "remote": remote,
                "local_counts": local_counts, "remote_counts": remote_counts}

    # 内容层面的差异：两端记录数不同 → 一定不是同一份数据
    if (remote_counts.get("customers", -1) >= 0
            and local_counts.get("customers", -1) >= 0
            and remote_counts["customers"] != local_counts["customers"]):
        return {"bound": True, "status": "diverged", "local": local, "remote": remote,
                "local_counts": local_counts, "remote_counts": remote_counts,
                "message": "本地与云端的数据不同，请选择如何处理"}

    # 记录过上次同步点：两端都没离开过该点 = 一致
    base = state.get("base") or {}
    if base.get("local_mtime") and base.get("remote_mtime"):
        local_unchanged = local["mtime"] == base["local_mtime"] and local["size"] == base.get("local_size")
        remote_unchanged = remote["mtime"] == base["remote_mtime"] and remote["size"] == base.get("remote_size")
        if local_unchanged and remote_unchanged:
            return {"bound": True, "status": "same", "local": local, "remote": remote,
                    "local_counts": local_counts, "remote_counts": remote_counts}
        if local_unchanged:
            status = "remote_newer"
        elif remote_unchanged:
            status = "local_newer"
        else:
            status = "diverged"
    elif same_size:
        status = "same"
    else:
        # 无同步记录时不能只看文件时间：新建的空库时间一定最新，
        # 但数据量为 0，若直接判 local_newer 会诱导用户用空库覆盖云端。
        lc = local_counts.get("customers", 0)
        rc = remote_counts.get("customers", -1)
        if rc > 0 and lc == 0:
            status = "remote_newer"          # 本地空库，云端有数据
        elif lc > 0 and rc == 0:
            status = "local_newer"           # 云端空库，本地有数据
        elif lc > 0 and rc > 0 and lc != rc:
            # 两端都有数据且数量不同 → 一定是两份不同的数据，必须让用户决定，
            # 不能按「谁多谁新」自动判定（本地可能只是还没录入多少客户，
            # 云端可能只是旧数据多，按数量判会诱导用户覆盖掉本地数据）
            status = "diverged"
        else:
            status = "local_newer" if local["mtime"] >= remote["mtime"] else "remote_newer"

    return {
        "bound": True,
        "status": status,
        "local": local,
        "remote": remote,
        "local_counts": local_counts,
        "remote_counts": remote_counts,
    }


def _mark_synced() -> None:
    """记录当前两端状态为一致基线"""
    config = load_config()
    local = _db_fingerprint(DB_PATH)
    remote = _remote_fingerprint(config) or {}
    _save_sync_state({
        "base": {
            "local_mtime": local["mtime"], "local_size": local["size"],
            "remote_mtime": remote.get("mtime"), "remote_size": remote.get("size"),
        },
        "synced_at": now_str(),
    })


@app.post("/api/sync/mark")
def sync_mark():
    _mark_synced()
    return {"ok": True}


@app.post("/api/sync/auto")
def sync_auto():
    """一键自动同步：按时间取较新的一方作为主，再双向融合，最后上传使两端一致

    - 云端无库 → 直接上传本地
    - 云端为空(0字节) → 以本地覆盖
    - 两端一致 → 不做改动
    - 否则 → 以「更新时间较新」的一方为基准，融合另一方独有的数据，再上传
    """
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user") or not config.get("webdav_pass"):
        raise HTTPException(400, "请先绑定坚果云账号")

    local = _db_fingerprint(DB_PATH) if os.path.exists(DB_PATH) else {"mtime": 0, "size": 0}
    remote = _remote_fingerprint(config)

    # 云端没有 或 为空 → 上传本地
    if remote is None or remote["size"] == 0:
        result = _upload_db(config)
        _mark_synced()
        return {"ok": True, "action": "uploaded", "detail": "云端无有效数据，已上传本地", **result}

    same_size = local["size"] == remote["size"]
    if same_size and local["mtime"] == remote["mtime"]:
        _mark_synced()
        return {"ok": True, "action": "same", "detail": "两端已一致"}

    # 以「数据更完整 / 更新」的一方为基准做双向融合
    # 注意：本地空库的修改时间往往比云端新，不能只比时间，否则空库会赢
    local_counts = _counts(DB_PATH)
    lc = local_counts.get("customers", 0)
    prefer_local: Optional[bool] = None
    try:
        tmp = _download_remote_db(config)
        if tmp:
            try:
                rc = _counts(tmp).get("customers", 0)
            finally:
                os.unlink(tmp)
            if lc == 0 and rc > 0:
                prefer_local = False
            elif rc == 0 and lc > 0:
                prefer_local = True
            elif lc > 0 and rc > 0 and max(lc, rc) >= max(1, min(lc, rc)) * 3:
                prefer_local = lc > rc
    except HTTPException:
        pass
    if prefer_local is None:
        prefer_local = local["mtime"] >= remote["mtime"]

    result = _merge_databases(config, prefer_local=prefer_local)
    _mark_synced()
    return {
        "ok": True,
        "action": "merged",
        "detail": "已按最新时间为基准融合并同步",
        "base_on": "local" if prefer_local else "remote",
        **result,
    }


@app.post("/api/sync/resolve")
def sync_resolve(body: SyncResolve):
    """按用户选择处理：local 以本地为准 / remote 以云端为准 / merge 双向融合

    - local  : 上传本地覆盖云端
    - remote : 下载云端覆盖本地（覆盖前自动备份）
    - merge  : 双向融合（取并集，冲突按时间新的优先），再上传
    """
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user") or not config.get("webdav_pass"):
        raise HTTPException(400, "请先绑定坚果云账号")

    choice = (body.choice or "").strip().lower()
    if choice == "local":
        res = _upload_db(config)
        _mark_synced()
        return {"ok": True, "action": "uploaded", "detail": "已用本地数据覆盖云端", **res}

    if choice == "remote":
        tmp = None
        backup = None
        try:
            with _db_lock:
                tmp = _download_remote_db(config)
                if tmp is None:
                    raise HTTPException(404, "云端没有数据库文件")
                stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                backup = os.path.join(BACKUP_DIR, f"before_download_{stamp}.db")
                os.makedirs(BACKUP_DIR, exist_ok=True)
                if os.path.exists(DB_PATH):
                    shutil.copy2(DB_PATH, backup)
                shutil.move(tmp, DB_PATH)
                tmp = None
            with get_db() as db:
                migrate_countries(db)
                normalize_datetimes(db)
            _mark_synced()
            return {"ok": True, "action": "downloaded", "detail": "已用云端数据覆盖本地",
                    "backup": backup, "size": os.path.getsize(DB_PATH)}
        except Exception:
            _restore(backup)
            raise
        finally:
            if tmp and os.path.exists(tmp):
                try:
                    os.unlink(tmp)
                except OSError:
                    pass

    if choice == "merge":
        res = _merge_databases(config, prefer_local=True)
        _mark_synced()
        return {"ok": True, "action": "merged", "detail": "已双向融合并同步", **res}

    raise HTTPException(400, "无效的选择（应为 local / remote / merge）")





# ---------- 用户画像（昵称 + 头像）存坚果云 ----------

def _remote_profile_url(config: Dict[str, Any]) -> str:
    return f"{config['webdav_url']}/crm/profile.json"


@app.get("/api/profile")
def get_profile():
    """从坚果云读取用户画像（昵称 + 头像 base64）

    返回 exists: True=云端有 profile.json；False=云端确实没有；None=读取失败（网络/鉴权）
    """
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user") or not config.get("webdav_pass"):
        return {"bound": False, "exists": False, "nickname": "", "avatar": ""}
    try:
        import requests
        res = wd_request('GET', _remote_profile_url(config), config, timeout=10)
        if res.status_code == 404:
            return {"bound": True, "exists": False, "nickname": "", "avatar": ""}
        if res.status_code != 200:
            return {"bound": True, "exists": None, "nickname": "", "avatar": "",
                    "error": f"读取云端画像失败：HTTP {res.status_code}"}
        data = res.json()
        return {
            "bound": True,
            "exists": True,
            "nickname": data.get("nickname", "") or "",
            "avatar": data.get("avatar", "") or "",
        }
    except Exception:
        # 出错时用 exists=None 让前端区分“云端没有”与“读取失败”，避免误覆盖云端
        return {"bound": True, "exists": None, "nickname": "", "avatar": "",
                "error": "读取云端画像失败"}


@app.post("/api/profile")
def save_profile(profile: ProfileData):
    """保存用户画像到坚果云（昵称 + 头像整体覆盖，前端负责合并两个字段）"""
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user") or not config.get("webdav_pass"):
        raise HTTPException(400, "请先绑定坚果云账号")
    try:
        import requests
        # 确保 /crm/ 文件夹存在
        wd_request('MKCOL', f"{config['webdav_url']}/crm/", config, timeout=10)
        payload = json.dumps({"nickname": profile.nickname, "avatar": profile.avatar}, ensure_ascii=False)
        res = wd_request('PUT', _remote_profile_url(config), config,
                          data=payload.encode('utf-8'),
                          headers={'Content-Type': 'application/json'}, timeout=15)
        if res.status_code not in (200, 201, 204):
            raise HTTPException(500, f"保存失败：HTTP {res.status_code}")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"保存失败：{e}")


@app.delete("/api/profile")
def delete_profile():
    """清空云端用户画像（仅删除 profile.json，不影响 trade_crm.db 和绑定配置）"""
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user") or not config.get("webdav_pass"):
        raise HTTPException(400, "请先绑定坚果云账号")
    try:
        import requests
        res = wd_request('DELETE', _remote_profile_url(config), config, timeout=15)
        if res.status_code not in (200, 204, 404):
            raise HTTPException(500, f"清除失败：HTTP {res.status_code}")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"清除失败：{e}")


@app.post("/api/fix/countries")
def fix_countries():
    """手动批量修正国家名"""
    with get_db() as db:
        before = db.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        migrate_countries(db)
        after = db.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
    return {"ok": True, "fixed": before, "remaining": after}


# ---------- 界面偏好设置（主题/配色/缩放）同步 ----------
# 策略：本地始终保存一份（离线可用），已绑定坚果云时同时写入 timezone 无关的云端
# settings.json，实现多端一致。读取时以「更新时间较新」的一方为准。

# SETTINGS_PATH 已在文件头部路径区定义（备份功能需在启动时即可访问）


def _remote_settings_url(config: Dict[str, Any]) -> str:
    return f"{config['webdav_url']}/crm/settings.json"


def _read_local_settings() -> Dict[str, Any]:
    try:
        # utf-8-sig 兼容带 BOM 的文件，避免手工编辑后读取失败
        with open(SETTINGS_PATH, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except (OSError, ValueError):
        pass
    return {}


def _write_local_settings(data: Dict[str, Any]) -> None:
    try:
        with open(SETTINGS_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except OSError:
        pass


@app.get("/api/settings")
def get_settings():
    """读取界面偏好：合并本地与云端，取 updated_at 较新者

    返回 { settings: {...}, source: 'local'|'remote'|'default', bound: bool }
    """
    local = _read_local_settings()
    config = load_config()
    bound = bool(config.get("webdav_url") and config.get("webdav_user") and config.get("webdav_pass"))
    if not bound:
        return {"settings": local, "source": "local" if local else "default", "bound": False}

    remote: Dict[str, Any] = {}
    try:
        import requests
        res = wd_request('GET', _remote_settings_url(config), config, timeout=10)
        if res.status_code == 200:
            parsed = res.json()
            if isinstance(parsed, dict):
                remote = parsed
    except Exception:
        # 云端不可达：回退本地，保证离线可用
        return {"settings": local, "source": "local" if local else "default",
                "bound": True, "offline": True}

    def ts(d: Dict[str, Any]) -> int:
        try:
            return int(d.get("updated_at") or 0)
        except (TypeError, ValueError):
            return 0

    if remote and ts(remote) >= ts(local):
        # 云端更新：回写本地缓存，保证下次离线也能用
        _write_local_settings(remote)
        return {"settings": remote, "source": "remote", "bound": True}
    if local:
        return {"settings": local, "source": "local", "bound": True}
    return {"settings": {}, "source": "default", "bound": True}


@app.post("/api/settings")
def save_settings(payload: SettingsPayload):
    """保存界面偏好：先写本地（必定成功），已绑定时再上传云端"""
    import time as _time
    data = dict(payload.settings or {})
    data["updated_at"] = int(_time.time())
    _write_local_settings(data)

    config = load_config()
    if not (config.get("webdav_url") and config.get("webdav_user") and config.get("webdav_pass")):
        return {"ok": True, "synced": False, "reason": "unbound"}

    try:
        import requests
        wd_request('MKCOL', f"{config['webdav_url']}/crm/", config, timeout=10)
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        res = wd_request('PUT', _remote_settings_url(config), config, data=body,
                          headers={'Content-Type': 'application/json'}, timeout=15)
        if res.status_code not in (200, 201, 204):
            return {"ok": True, "synced": False, "reason": f"HTTP {res.status_code}"}
        return {"ok": True, "synced": True}
    except Exception as e:
        # 云端失败不影响本地保存，下次改动会重试
        return {"ok": True, "synced": False, "reason": str(e)}


# ---------- 备份接口 ----------

@app.get("/api/backup/list")
def backup_list():
    """列出所有备份（含客户数、时间、大小）"""
    return {"backups": _list_backups(), "dir": BACKUP_DIR}


@app.post("/api/backup/create")
def backup_create():
    """立即创建一份完整备份（数据库 + 全部设置）"""
    return create_backup(tag="manual")


@app.post("/api/backup/restore")
def backup_restore(body: BackupRestore):
    """从指定备份恢复；恢复前会自动再备份一份当前状态"""
    return _restore_backup(body.file)


@app.get("/api/backup/download")
def backup_download(file: str = Query(..., description="备份文件名")):
    """下载备份文件到本地（便于拷到其它电脑）"""
    safe = os.path.basename(file)
    p = os.path.join(BACKUP_DIR, safe)
    if not safe.startswith("backup_") or not safe.endswith(".zip") or not os.path.isfile(p):
        raise HTTPException(404, "备份文件不存在")
    return FileResponse(p, filename=safe, media_type="application/zip")


# ---------- 后台自动同步 ----------

SYNC_INTERVAL = 120  # 秒；启动后每 2 分钟检查一次云端是否变化


def _first_run_pull() -> bool:
    """首次绑定/启动时自动从云端拉取数据，做到「绑定完就能看到自己的客户」

    判定首次：本地从未同步过（无同步基线）。
    返回 True 表示本次确实用云端接管了本地（用于前端提示用户）。

    关键区分本地是不是「只有示例数据」：
    - 本地仅有示例数据（seed 的 3 条）→ 直接用云端覆盖，用户看不到中间态
    - 本地已有用户自己的数据 → 不覆盖，改为走融合，把选择权交给用户，
      否则用户刚录入的客户会被云端旧数据冲掉
    """
    try:
        config = load_config()
        if not (config.get("webdav_url") and config.get("webdav_user") and config.get("webdav_pass")):
            return False
        if _load_sync_state().get("base"):
            return False   # 已同步过，不再自动覆盖

        local_counts = _counts(DB_PATH)
        remote, _err = _remote_fingerprint_ex(config)
        if remote is None or remote.get("size", 0) == 0:
            return False

        tmp = None
        try:
            tmp = _download_remote_db(config)
            if not tmp:
                return False
            remote_count = _counts(tmp).get("customers", 0)
            # 本地只有示例数据时，云端数据可以直接接管；
            # 本地有真实数据时不动，交给 sync_inspect 提示用户选择
            if remote_count > local_counts.get("customers", 0) and _is_only_seed_data():
                with _db_lock:
                    shutil.copy2(tmp, DB_PATH)
                with get_db() as db:
                    migrate_countries(db)
                    normalize_datetimes(db)
                # 已被云端完全接管，两端此时就是同一份数据，记录基线
                _mark_synced()
                return True
            # 否则（本地有真实数据）不记录基线：还没真正同步过，
            # 等用户选完「融合/以本地为准/以云端为准」后再由对应流程记录，
            # 否则基线会等于当前状态，后续同步判断就看不出变化了
            return False
        finally:
            if tmp and os.path.exists(tmp):
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
    except Exception:
        return False


def _sync_worker() -> None:
    """后台线程：首次自动拉取，之后定期双向同步

    - 只有本地变了 → 自动上传（含断网期间积累的改动）
    - 只有云端变了 → 自动拉取融合
    - 两端都变了 → 留给用户选择，避免误覆盖
    - 任何异常都静默忽略，绝不影响主进程
    """
    import time as _time
    _time.sleep(5)   # 稍等，避免与首屏请求抢资源
    _first_run_pull()
    while True:
        try:
            config = load_config()
            if (config.get("auto_sync", True)
                    and config.get("webdav_url") and config.get("webdav_user")
                    and config.get("webdav_pass")):
                local = _db_fingerprint(DB_PATH) if os.path.exists(DB_PATH) else None
                remote, _err = _remote_fingerprint_ex(config)
                if local and remote and remote.get("size", 0) > 0:
                    state = _load_sync_state().get("base") or {}
                    same = (local["size"] == remote["size"]
                            and local["mtime"] == remote["mtime"])
                    known = (state.get("remote_mtime") == remote["mtime"]
                             and state.get("remote_size") == remote["size"])
                    local_clean = (state.get("local_mtime") == local["mtime"]
                                   and state.get("local_size") == local["size"])
                    if not same:
                        if known and not local_clean:
                            # 只有本地变了（含断网期间积累的改动）→ 自动上传
                            try:
                                _upload_db(config)
                                _mark_synced()
                            except Exception:
                                pass
                        elif local_clean and not known:
                            # 只有云端变了 → 自动拉取融合
                            try:
                                sync_auto()
                            except Exception:
                                pass
                        # 两端都变 → 留给用户选择，避免误覆盖
        except Exception:
            pass
        _time.sleep(SYNC_INTERVAL)


def _open_browser_when_ready(url: str, timeout: float = 15.0) -> None:
    """轮询直到服务可访问，再打开默认浏览器"""
    import time as _time
    import urllib.request as _urlreq
    deadline = _time.time() + timeout
    while _time.time() < deadline:
        try:
            with _urlreq.urlopen(f"{url}/api/sync/status", timeout=1.5) as r:
                if r.status == 200:
                    break
        except Exception:
            _time.sleep(0.3)
    try:
        webbrowser.open(url)
    except Exception:
        pass


# ---------- 前端静态文件 ----------

# 注意：以下接口必须注册在 catch-all 的 serve_frontend 之前，
# 否则会被前端路由拦截，返回 HTML 而不是 JSON。
@app.get("/api/version")
def get_version():
    """前端显示当前版本用；更新方式为运行新版安装器"""
    return {"version": read_local_version(), "app": "外贸CRM"}


if os.path.exists(DIST_DIR):
    if os.path.exists(os.path.join(ASSETS_DIR, "assets")):
        app.mount("/assets", StaticFiles(directory=os.path.join(ASSETS_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        file_path = os.path.join(DIST_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        resource_path = os.path.join(ASSETS_DIR, full_path)
        if os.path.isfile(resource_path):
            return FileResponse(resource_path)
        return FileResponse(
            os.path.join(DIST_DIR, "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )


# ---------- 系统托盘（所有启动方式都可用） ----------

def _tray_icon_image():
    """生成托盘图标（蓝色圆环 + C 形缺口）"""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (64, 64), (37, 99, 235))
    d = ImageDraw.Draw(img)
    d.ellipse((14, 14, 50, 50), outline="white", width=7)
    d.rectangle((44, 28, 52, 38), fill=(37, 99, 235))
    return img


def start_tray(open_url: str = "") -> bool:
    """启动托盘图标，返回是否成功

    open_url 留空时用 LOCAL_PORT 拼接（托盘在 main.py 模块加载时启动，
    而 LOCAL_PORT 定义在文件尾部；这里延迟计算保证拿到正确端口）。

    菜单项：
      打开 CRM      —— 在默认浏览器里打开界面
      立即同步      —— 立刻与坚果云同步一次
      打开数据文件夹 —— 直接打开数据目录（方便整包拷到别的电脑）
      退出程序
    失败时静默返回 False，不影响主功能。
    """
    if not open_url:
        open_url = f"http://127.0.0.1:{_local_port()}"
    try:
        import pystray
    except Exception:
        return False

    def do_open(icon=None, item=None):
        try:
            webbrowser.open(open_url)
        except Exception:
            pass

    def do_sync(icon=None, item=None):
        """托盘里手动触发一次同步"""
        def work():
            try:
                cfg = load_config()
                if not (cfg.get("webdav_url") and cfg.get("webdav_user")):
                    return
                sync_auto()
            except Exception:
                pass
        threading.Thread(target=work, daemon=True).start()

    def do_folder(icon=None, item=None):
        try:
            os.startfile(BASE_DIR)  # noqa: S606
        except Exception:
            pass

    def do_quit(icon=None, item=None):
        try:
            icon.stop()
        except Exception:
            pass
        os._exit(0)

    try:
        icon = pystray.Icon(
            "trade_crm",
            _tray_icon_image(),
            f"外贸 CRM v{read_local_version()}（运行中）\n双击打开页面 · 右键更多操作",
            menu=pystray.Menu(
                pystray.MenuItem("打开 CRM", do_open, default=True),
                pystray.MenuItem("立即同步", do_sync),
                pystray.MenuItem("打开数据文件夹", do_folder),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("退出程序", do_quit),
            ),
        )
        # run_detached 不阻塞主线程，便于在后台线程里调用
        icon.run_detached()
        # 「单击打开」改「双击打开」：pystray 的 Windows 后端在收到
        # WM_LBUTTONUP（单击）时就触发 default 菜单项，容易误触。
        # 注意 pystray 注册的托盘窗口类没有 CS_DBLCLKS 样式，
        # 系统不会发 WM_LBUTTONDBLCLK，所以这里自己计时判定：
        # 两次左键单击的间隔小于系统双击时间（默认 500ms）才算双击。
        try:
            import ctypes
            from pystray._util import win32 as _win32
            _dblclick_ms = ctypes.windll.user32.GetDoubleClickTime() or 500
            _state = {"last_up": 0.0}
            # 关键：分发器查的是 _message_handlers 字典里存的引用，
            # 只改 icon._on_notify 属性是无效的，必须替换字典里的条目。
            _orig_on_notify = icon._message_handlers[_win32.WM_NOTIFY]

            def _on_notify_dblclick(wparam, lparam):
                if lparam == _win32.WM_LBUTTONUP:
                    import time as _time
                    now = _time.monotonic()
                    if now - _state["last_up"] <= _dblclick_ms / 1000.0:
                        _state["last_up"] = 0.0  # 防三连击触发两次
                        try:
                            do_open()
                        except Exception:
                            pass
                    else:
                        _state["last_up"] = now
                    return
                _orig_on_notify(wparam, lparam)

            icon._message_handlers[_win32.WM_NOTIFY] = _on_notify_dblclick
        except Exception:
            # 检测失败就退回默认行为（单击打开），不影响使用
            pass
        globals()["_tray_icon"] = icon
        return True
    except Exception:
        return False


def _start_tray_thread() -> None:
    """在独立线程启动托盘，失败不影响主流程"""
    try:
        threading.Thread(target=lambda: start_tray(), daemon=True).start()
    except Exception:
        pass


# ---------- 版本信息（更新由独立的安装器完成，见 installer.py） ----------

APP_VERSION = "0.5.2"
VERSION_FILE = os.path.join(BASE_DIR, "version.json")


def read_local_version() -> str:
    """读取本机版本号（打包后会写入 version.json）"""
    try:
        with open(VERSION_FILE, "r", encoding="utf-8-sig") as f:
            v = (json.load(f) or {}).get("version")
        if v:
            return str(v)
    except (OSError, ValueError):
        pass
    return APP_VERSION


def _ver_tuple(v: str):
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split("."))
    except Exception:
        return (0,)


# ---------- 后台自动同步（模块级启动） ----------
#
# 注意：必须在这里启动，不能只放在 `if __name__ == "__main__"` 里。
# 打包后入口是 launcher.py，它以 `import main` 的方式加载本模块，
# 此时 __name__ 为 "main"，main 块不会执行 —— 会导致后台同步线程
# 在 exe 版本里根本不启动（首次自动拉取也不会发生）。
def _start_sync_thread() -> None:
    try:
        threading.Thread(target=_sync_worker, daemon=True).start()
    except Exception:
        pass


# ---------- 本地服务端口 ----------
#
# 8000 是首选端口；若被用户机器上的其他服务占用，launcher.py 会选定一个
# 备用端口并写进 config.json 的 local_port 字段，这里读取同一个值，
# 保证托盘菜单、自动开浏览器、uvicorn 三者端口一致。
# 环境变量 CRM_PORT 优先（开发/调试用），其次 config.json，最后默认 8000。

def _local_port() -> int:
    try:
        env = os.environ.get("CRM_PORT")
        if env and env.isdigit() and 1024 <= int(env) <= 65535:
            return int(env)
    except Exception:
        pass
    try:
        v = load_config().get("local_port")
        if isinstance(v, int) and 1024 <= v <= 65535:
            return v
    except Exception:
        pass
    return 8000


LOCAL_PORT = _local_port()

_start_sync_thread()
_start_tray_thread()


if __name__ == "__main__":
    import uvicorn

    url = f"http://127.0.0.1:{LOCAL_PORT}"
    print("=" * 46)
    print(f"  外贸 CRM  v{read_local_version()}")
    print(f"  网址：{url}")
    print(f"  数据：{DB_PATH}")
    print("  关闭本窗口即退出程序")
    print("=" * 46)

    # 自动打开浏览器（打包后由 exe 触发）
    if os.environ.get("CRM_NO_BROWSER") != "1":
        threading.Thread(target=_open_browser_when_ready, args=(url,), daemon=True).start()

    uvicorn.run(app, host="127.0.0.1", port=LOCAL_PORT, log_level="warning")
