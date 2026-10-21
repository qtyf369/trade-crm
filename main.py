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
import os
import re
import json
import uuid
import shutil
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, date
from typing import Optional, List, Dict, Any, Tuple

from fastapi import FastAPI, HTTPException, UploadFile, File, Query, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from constants import (
    SOURCES, STATUS_MAP, STATUS_REVERSE_MAP, VALID_STATUSES, LEVELS, VALID_LEVELS,
    SOCIAL_MAP, SOCIAL_REVERSE_MAP, FOLLOWUP_TYPES, EXPORT_HEADERS,
    COUNTRY_EN_TO_CN, COMMON_COUNTRIES, VALID_COUNTRIES, CITY_COUNTRY_PREFIXES,
)

# ---------- 路径 ----------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "trade_crm.db")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
DIST_DIR = os.path.join(BASE_DIR, "dist", "output")
ASSETS_DIR = os.path.join(BASE_DIR, "dist", "output_resource")
BACKUP_DIR = os.path.join(BASE_DIR, "backups")

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
        ):
            try:
                db.execute(ddl)
            except sqlite3.OperationalError:
                pass

        # 索引也要在这里补一次（老库可能缺）
        db.execute("CREATE INDEX IF NOT EXISTS idx_followups_customer ON followups(customer_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_followups_created ON followups(created_at)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company)")

        migrate_countries(db)
        migrate_legacy_contacts(db)
        migrate_levels(db)
        migrate_statuses(db)
        normalize_datetimes(db)


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
                "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, contacts, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (cid, company, contact, country, email, phone, source, level, status, note,
                 json.dumps([{"name": contact, "email": email, "phone": phone}], ensure_ascii=False), now),
            )
        for fid, cid, typ, content in [
            ("f1", "c1", "email", "发送了不锈钢餐具报价单，等待客户确认"),
            ("f2", "c2", "whatsapp", "WhatsApp沟通了MOQ要求，客户需要10000件起订"),
        ]:
            db.execute(
                "INSERT INTO followups (id, customer_id, type, content, created_at) VALUES (?,?,?,?,?)",
                (fid, cid, typ, content, now),
            )


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
        issues.append(f"国家不规范：{data.get('country') or '(空)'}")

    source = (data.get('source') or '').strip()
    if source not in SOURCES:
        issues.append(f"来源不规范：{source or '(空)'}")

    status = (data.get('status') or '').strip()
    if status not in VALID_STATUSES:
        issues.append(f"状态不规范：{status or '(空)'}")

    level = data.get('level') or ''
    if level not in VALID_LEVELS:
        issues.append(f"等级不规范：{level}")

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
    data_issues: str = "[]"
    last_followup_at: Optional[str] = None


class FollowUp(BaseModel):
    id: Optional[str] = None
    customer_id: str
    type: str = "email"
    content: str = ""
    next_follow_up_at: str = ""
    created_at: Optional[str] = None


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


# ---------- 自动备份 ----------

def auto_backup() -> Dict[str, Any]:
    """启动时自动备份，保留最近 7 天，同一天只备份一次"""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH):
        return {"ok": False, "reason": "db missing"}

    today = date.today().strftime("%Y%m%d")
    backup_file = os.path.join(BACKUP_DIR, f"trade_crm_{today}.db")
    created = False
    if not os.path.exists(backup_file):
        shutil.copy2(DB_PATH, backup_file)
        created = True

    for name in os.listdir(BACKUP_DIR):
        if not (name.startswith("trade_crm_") and name.endswith(".db")):
            continue
        try:
            file_date = datetime.strptime(
                name[len("trade_crm_"):-len(".db")], "%Y%m%d"
            ).date()
        except ValueError:
            continue
        if (date.today() - file_date).days > 7:
            try:
                os.unlink(os.path.join(BACKUP_DIR, name))
            except OSError:
                pass
    return {"ok": True, "created": created}


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
        like = f"%{search.strip()}%"
        where.append(
            "(c.company LIKE ? OR c.contact LIKE ? OR c.country LIKE ? "
            "OR c.contacts LIKE ? OR c.products LIKE ?)"
        )
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
    migrate_countries_tick()
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
    migrate_countries_tick()
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
    节流执行国家名修正：最多每 60 秒一次，避免每次列表请求都全表扫描。
    """
    now = datetime.now()
    with _migrate_country_lock:
        last = _migrate_country_last.get('at')
        if last and (now - last).total_seconds() < 60:
            return
        _migrate_country_last['at'] = now
    with get_db() as db:
        migrate_countries(db)


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
        db.execute(
            "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, products, contacts, created_at, starred, data_issues) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                cid, c.company, data.get('contact') or '', country,
                data.get('email') or '', data.get('phone') or '',
                c.source, c.level, c.status, c.note, c.products,
                json.dumps(contacts, ensure_ascii=False), now_str(),
                int(c.starred or 0), json.dumps(issues, ensure_ascii=False),
            ),
        )
    return {"id": cid}


@app.put("/api/customers/{cid}")
def update_customer(cid: str, c: Customer):
    with get_db() as db:
        existing = db.execute("SELECT id FROM customers WHERE id = ?", (cid,)).fetchone()
        if not existing:
            raise HTTPException(404, "客户不存在")

        data = c.model_dump()
        issues = validate_customer(db, data, cid=cid)
        country = normalize_country(data.get('country') or '')
        contacts = [x.model_dump() for x in c.contacts]

        db.execute(
            "UPDATE customers SET company=?, contact=?, country=?, email=?, phone=?, source=?, level=?, status=?, note=?, products=?, contacts=?, starred=?, data_issues=? WHERE id=?",
            (
                c.company, data.get('contact') or '', country,
                data.get('email') or '', data.get('phone') or '',
                c.source, c.level, c.status, c.note, c.products,
                json.dumps(contacts, ensure_ascii=False), int(c.starred or 0),
                json.dumps(issues, ensure_ascii=False), cid,
            ),
        )
    return {"ok": True}


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
                f"UPDATE customers SET starred = ? WHERE id IN ({placeholders})",
                [1 if action == 'star' else 0] + ids,
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


@app.get("/api/export")
def export_excel(
    ids: str = "",
    start: int = Query(1, ge=1),
    end: int = Query(0, ge=0),
    search: str = '',
):
    """导出 Excel。支持：ids=逗号分隔 / 序号范围 start-end / 全量。"""
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
            # 复用查询逻辑，page_size 拉到上限拿全量（单机数据量可控）
            page_size = 500
            page = 1
            while True:
                items, total = query_customers(
                    db, search=search, page=page, page_size=page_size,
                    sort_by='company', sort_asc=True,
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

@app.post("/api/import")
async def import_excel(file: UploadFile = File(...)):
    """导入导出的 Excel。同名公司跳过；不合规数据记入 data_issues。"""
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
        ws = wb.active

        header_row = None
        for row_idx in range(1, 11):
            if ws.cell(row=row_idx, column=1).value == '序号':
                header_row = row_idx
                break
        if not header_row:
            raise HTTPException(400, "未找到表头，请使用导出的Excel模板")

        # 按公司名分组，兼容空公司名（继承上一行）
        customers_map: Dict[str, Dict[str, Any]] = {}
        last_company = None
        for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
            company = str(row[1] or '').strip()
            if not company:
                company = last_company
                if not company:
                    continue
            else:
                last_company = company

            entry = customers_map.setdefault(company, {
                'company': company,
                'country': row[2] or '',
                'source': row[3] or '',
                'level': row[4] or '',
                'status': STATUS_REVERSE_MAP.get(str(row[5] or '').strip(), 'lead'),
                'products': row[6] or '',
                'note': row[7] or '',
                'contacts': [],
                'last_followup_date': date_only(row[14]) if row[14] else '',
                'last_followup_content': row[15] or '',
                'created_at': normalize_dt(row[16]) if row[16] else '',
            })

            contact_name = str(row[8] or '').strip()
            if contact_name:
                entry['contacts'].append({
                    'name': contact_name,
                    'position': str(row[9] or ''),
                    'email': str(row[10] or ''),
                    'phone': str(row[11] or ''),
                    'social': SOCIAL_REVERSE_MAP.get(str(row[12] or '').strip(), str(row[12] or '')),
                    'socialAccount': str(row[13] or ''),
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
                db.execute(
                    "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, products, contacts, created_at, data_issues) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        cid, company,
                        data['contacts'][0]['name'] if data['contacts'] else '',
                        normalize_country(data['country']),
                        data['contacts'][0]['email'] if data['contacts'] else '',
                        data['contacts'][0]['phone'] if data['contacts'] else '',
                        data['source'], data['level'], data['status'],
                        data['note'], data['products'],
                        json.dumps(data['contacts'], ensure_ascii=False),
                        data['created_at'] or now_str(),
                        json.dumps(issues, ensure_ascii=False),
                    ),
                )
                if data['last_followup_content']:
                    db.execute(
                        "INSERT INTO followups (id, customer_id, type, content, next_follow_up_at, created_at) VALUES (?,?,?,?,?,?)",
                        (
                            f"f{uuid.uuid4().hex[:8]}", cid, 'other',
                            data['last_followup_content'], '',
                            data['last_followup_date'] or now_str(),
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
            "INSERT INTO followups (id, customer_id, type, content, next_follow_up_at, created_at) VALUES (?,?,?,?,?,?)",
            (fid, f.customer_id, f.type, f.content, next_at, created_at),
        )
    return {"id": fid}


@app.put("/api/followups/{fid}")
def update_followup(fid: str, f: FollowUp):
    """跟进记录可编辑"""
    with get_db() as db:
        existing = db.execute("SELECT id FROM followups WHERE id = ?", (fid,)).fetchone()
        if not existing:
            raise HTTPException(404, "跟进记录不存在")
        # 未提供时间则保留原值
        created_at = (
            normalize_dt(f.created_at)
            if f.created_at
            else db.execute("SELECT created_at FROM followups WHERE id = ?", (fid,)).fetchone()['created_at']
        )
        db.execute(
            "UPDATE followups SET type=?, content=?, next_follow_up_at=?, created_at=? WHERE id=?",
            (
                f.type, f.content, date_only(f.next_follow_up_at),
                created_at, fid,
            ),
        )
    return {"ok": True}


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
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
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
    save_config({
        "webdav_url": config.webdav_url.rstrip('/'),
        "webdav_user": config.webdav_user,
        "webdav_pass": config.webdav_pass,
        "auto_sync": config.auto_sync,
    })
    return {"ok": True}


@app.post("/api/sync/test")
def sync_test(config: SyncConfig):
    if not config.webdav_url or not config.webdav_user:
        return {"ok": False, "message": "请先填写地址和账号"}
    try:
        import requests
        folder_url = f"{config.webdav_url}/crm/"
        requests.request('MKCOL', folder_url,
                         auth=(config.webdav_user, config.webdav_pass), timeout=10)
        test_url = f"{config.webdav_url}/crm/.crm_test"
        res = requests.put(test_url, data=b'test',
                           auth=(config.webdav_user, config.webdav_pass),
                           headers={"Content-Type": "text/plain"}, timeout=10)
        if res.status_code in (200, 201, 204):
            requests.delete(test_url, auth=(config.webdav_user, config.webdav_pass), timeout=10)
            return {"ok": True, "message": "连接成功！账号密码正确"}
        if res.status_code == 401:
            return {"ok": False, "message": "账号或密码错误（注意要用应用密码，不是登录密码）"}
        return {"ok": False, "message": f"连接失败：HTTP {res.status_code}"}
    except Exception as e:
        return {"ok": False, "message": f"连接失败：{e}"}


def _remote_db_url(config: Dict[str, Any]) -> str:
    return f"{config['webdav_url']}/crm/trade_crm.db"


def _download_remote_db(config: Dict[str, Any]) -> Optional[str]:
    """下载云端数据库到临时文件，不存在返回 None"""
    import requests
    res = requests.get(_remote_db_url(config),
                       auth=(config['webdav_user'], config['webdav_pass']), timeout=30)
    if res.status_code == 404:
        return None
    if res.status_code != 200:
        raise HTTPException(500, f"下载失败：HTTP {res.status_code}")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
    tmp.write(res.content)
    tmp.close()
    return tmp.name


def _upload_db(config: Dict[str, Any]) -> Dict[str, Any]:
    import requests
    with _db_lock:
        with open(DB_PATH, 'rb') as f:
            res = requests.put(_remote_db_url(config), data=f,
                               auth=(config['webdav_user'], config['webdav_pass']),
                               headers={"Content-Type": "application/octet-stream"}, timeout=30)
    if res.status_code in (200, 201, 204):
        return {"ok": True, "size": os.path.getsize(DB_PATH)}
    raise HTTPException(500, f"上传失败：HTTP {res.status_code} - {res.text[:200]}")


@app.post("/api/sync/upload")
def sync_upload():
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        raise HTTPException(400, "请先配置WebDAV账号")
    try:
        import requests
        requests.request('MKCOL', f"{config['webdav_url']}/crm/",
                         auth=(config['webdav_user'], config['webdav_pass']), timeout=10)
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


@app.post("/api/sync/merge")
def sync_merge():
    """融合合并：以公司名去重，云端有本地没有的拉回来，再上传合并结果。"""
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        raise HTTPException(400, "请先配置WebDAV账号")

    tmp_remote = None
    backup_path = None
    try:
        with _db_lock:
            tmp_remote = _download_remote_db(config)
            if tmp_remote is None:
                raise HTTPException(404, "云端没有数据库文件")

            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = os.path.join(BASE_DIR, f"trade_crm.db.merge_bak_{stamp}")
            shutil.copy2(DB_PATH, backup_path)

            local_db = sqlite3.connect(DB_PATH)
            local_db.row_factory = sqlite3.Row
            local_companies = {
                r['company'] for r in local_db.execute("SELECT company FROM customers").fetchall()
            }

            remote_db = sqlite3.connect(tmp_remote)
            remote_db.row_factory = sqlite3.Row
            remote_customers = remote_db.execute("SELECT * FROM customers").fetchall()

            added = 0
            for rc in remote_customers:
                if rc['company'] in local_companies:
                    continue
                new_id = f"c{uuid.uuid4().hex[:8]}"
                local_db.execute(
                    "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, products, contacts, created_at, starred, data_issues) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        new_id, rc['company'], rc['contact'], rc['country'], rc['email'],
                        rc['phone'], rc['source'], rc['level'], rc['status'], rc['note'],
                        rc['products'], rc['contacts'], rc['created_at'],
                        rc['starred'], rc['data_issues'],
                    ),
                )
                added += 1
                for fu in remote_db.execute(
                    "SELECT * FROM followups WHERE customer_id = ?", (rc['id'],)
                ).fetchall():
                    local_db.execute(
                        "INSERT INTO followups (id, customer_id, type, content, next_follow_up_at, created_at) VALUES (?,?,?,?,?,?)",
                        (f"f{uuid.uuid4().hex[:8]}", new_id, fu['type'], fu['content'],
                         fu['next_follow_up_at'], fu['created_at']),
                    )
            local_db.commit()
            local_db.close()
            remote_db.close()

            with open(DB_PATH, 'rb') as f:
                import requests
                res = requests.put(
                    _remote_db_url(config), data=f,
                    auth=(config['webdav_user'], config['webdav_pass']),
                    headers={"Content-Type": "application/octet-stream"}, timeout=30,
                )
            if res.status_code not in (200, 201, 204):
                raise HTTPException(500, f"上传合并结果失败：HTTP {res.status_code}")

        return {"ok": True, "added": added, "backup": backup_path}
    except HTTPException:
        _restore(backup_path)
        raise
    except Exception as e:
        _restore(backup_path)
        raise HTTPException(500, f"融合失败：{e}")
    finally:
        if tmp_remote and os.path.exists(tmp_remote):
            try:
                os.unlink(tmp_remote)
            except OSError:
                pass


@app.post("/api/sync/check_remote")
def check_remote():
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        return {"has_remote": False}
    try:
        import requests
        res = requests.head(_remote_db_url(config),
                            auth=(config['webdav_user'], config['webdav_pass']), timeout=10)
        return {"has_remote": res.status_code == 200}
    except Exception:
        return {"has_remote": False}


@app.post("/api/sync/logout")
def sync_logout():
    save_config({"webdav_url": "", "webdav_user": "", "webdav_pass": "", "auto_sync": True})
    return {"ok": True}


@app.post("/api/fix/countries")
def fix_countries():
    """手动批量修正国家名"""
    with get_db() as db:
        before = db.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        migrate_countries(db)
        after = db.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
    return {"ok": True, "fixed": before, "remaining": after}


# ---------- 前端静态文件 ----------

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


if __name__ == "__main__":
    import uvicorn
    print("=" * 40)
    print("  Trade CRM - Local Edition (v0.2)")
    print("  URL: http://localhost:8000")
    print(f"  Data file: {DB_PATH}")
    print("  Close this window to stop")
    print("=" * 40)
    uvicorn.run(app, host="127.0.0.1", port=8000)
