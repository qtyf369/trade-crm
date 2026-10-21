"""
外贸CRM 单人离线版
启动方式：python main.py
然后浏览器打开 http://localhost:8000
"""

import sqlite3
import os
from contextlib import contextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

# ---------- 数据库 ----------

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "trade_crm.db")

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

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
        """)

        # 迁移：给已有 customers 表加 contacts 字段
        try:
            db.execute("ALTER TABLE customers ADD COLUMN contacts TEXT DEFAULT '[]'")
        except:
            pass  # 字段已存在就忽略

        # 迁移：加主要需要产品字段
        try:
            db.execute("ALTER TABLE customers ADD COLUMN products TEXT DEFAULT ''")
        except:
            pass

        # 迁移：加星标字段
        try:
            db.execute("ALTER TABLE customers ADD COLUMN starred INTEGER DEFAULT 0")
        except:
            pass

        # 迁移：加数据问题标记字段
        try:
            db.execute("ALTER TABLE customers ADD COLUMN data_issues TEXT DEFAULT '[]'")
        except:
            pass

        # 迁移：英文国家名转中文
        COUNTRY_MAP = {
            'United States': '美国', 'USA': '美国', 'US': '美国',
            'United Kingdom': '英国', 'UK': '英国', 'England': '英国',
            'Germany': '德国',
            'France': '法国',
            'Italy': '意大利',
            'Spain': '西班牙',
            'Portugal': '葡萄牙',
            'Netherlands': '荷兰',
            'Belgium': '比利时',
            'Switzerland': '瑞士',
            'Austria': '奥地利',
            'Sweden': '瑞典',
            'Norway': '挪威',
            'Denmark': '丹麦',
            'Finland': '芬兰',
            'Ireland': '爱尔兰',
            'Poland': '波兰',
            'Czech': '捷克',
            'Russia': '俄罗斯',
            'Turkey': '土耳其',
            'Japan': '日本',
            'Korea': '韩国', 'South Korea': '韩国',
            'India': '印度',
            'Thailand': '泰国',
            'Vietnam': '越南',
            'Malaysia': '马来西亚',
            'Singapore': '新加坡',
            'Indonesia': '印度尼西亚',
            'Philippines': '菲律宾',
            'Australia': '澳大利亚',
            'New Zealand': '新西兰',
            'Canada': '加拿大',
            'Mexico': '墨西哥',
            'Brazil': '巴西',
            'Argentina': '阿根廷',
            'Chile': '智利',
            'Peru': '秘鲁',
            'Colombia': '哥伦比亚',
            'Egypt': '埃及',
            'South Africa': '南非',
            'Nigeria': '尼日利亚',
            'Kenya': '肯尼亚',
            'Morocco': '摩洛哥',
            'Algeria': '阿尔及利亚',
            'Saudi Arabia': '沙特阿拉伯',
            'UAE': '阿联酋', 'United Arab Emirates': '阿联酋',
            'Israel': '以色列',
            'Pakistan': '巴基斯坦',
            'Bangladesh': '孟加拉国',
        }
        rows = db.execute("SELECT id, country FROM customers").fetchall()
        for row in rows:
            cid, old_country = row
            if old_country in COUNTRY_MAP:
                new_country = COUNTRY_MAP[old_country]
                db.execute("UPDATE customers SET country = ? WHERE id = ?", (new_country, cid))

        # 迁移：把旧的 contact/email/phone 填充到 contacts 数组
        import json
        rows = db.execute("SELECT id, contact, email, phone, contacts FROM customers").fetchall()
        for row in rows:
            cid, contact, email, phone, contacts_str = row
            try:
                contacts = json.loads(contacts_str or '[]')
            except:
                contacts = []
            # 如果 contacts 为空，且旧字段有值，就填充第一个联系人
            if len(contacts) == 0 and (contact or email or phone):
                contacts = [{"name": contact or "", "email": email or "", "phone": phone or ""}]
                db.execute("UPDATE customers SET contacts = ? WHERE id = ?", (json.dumps(contacts, ensure_ascii=False), cid))

        # 迁移旧等级数据 A/B/C -> L0-L4
        db.execute("UPDATE customers SET level = 'L3' WHERE level = 'A'")
        db.execute("UPDATE customers SET level = 'L1' WHERE level = 'B'")
        db.execute("UPDATE customers SET level = 'L2' WHERE level = 'C'")

        # 迁移旧状态数据
        db.execute("UPDATE customers SET status = 'lead' WHERE status = 'potential'")
        db.execute("UPDATE customers SET status = 'contacted' WHERE status = 'following'")

        # 首次运行时插入示例数据
        count = db.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        if count == 0:
            now = now_str()
            db.execute(
                "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("c1", "ABC Trading Co.", "John Smith", "United States", "john@abctrading.com", "+1 555-0100", "Alibaba", "L3", "following", "对不锈钢餐具感兴趣，已寄样品", now)
            )
            db.execute(
                "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("c2", "EuroSteel GmbH", "Hans Mueller", "Germany", "hans@eurosteel.de", "+49 30-123456", "展会", "L1", "potential", "正在比价，等待回复", now)
            )
            db.execute(
                "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("c3", "Marina Distributors", "Maria Garcia", "Spain", "maria@marina.es", "+34 91-555-0199", "Google", "L2", "lost", "价格太高，暂时搁置", now)
            )
            db.execute(
                "INSERT INTO followups (id, customer_id, type, content, next_follow_up_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("f1", "c1", "email", "发送了不锈钢餐具报价单，等待客户确认", now, now)
            )
            db.execute(
                "INSERT INTO followups (id, customer_id, type, content, next_follow_up_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("f2", "c2", "whatsapp", "WhatsApp沟通了MOQ要求，客户需要10000件起订", now, now)
            )

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
    contacts: list[CustomerContact] = []
    starred: int = 0
    data_issues: str = "[]"

class FollowUp(BaseModel):
    id: Optional[str] = None
    customer_id: str
    type: str = "email"
    content: str = ""
    next_follow_up_at: str = ""
    created_at: Optional[str] = None

# ---------- API ----------

# 启动时自动备份
import datetime
def auto_backup():
    """自动备份，保留最近7天"""
    backup_dir = os.path.join(os.path.dirname(DB_PATH), "backups")
    os.makedirs(backup_dir, exist_ok=True)

    # 今天的备份
    today = datetime.date.today().strftime("%Y%m%d")
    backup_file = os.path.join(backup_dir, f"trade_crm_{today}.db")

    # 如果今天已经备份过了，就不重复备份
    if not os.path.exists(backup_file):
        import shutil
        shutil.copy2(DB_PATH, backup_file)

    # 清理7天前的备份
    for f in os.listdir(backup_dir):
        if f.startswith("trade_crm_") and f.endswith(".db"):
            try:
                date_str = f.replace("trade_crm_", "").replace(".db", "")
                file_date = datetime.datetime.strptime(date_str, "%Y%m%d").date()
                if (datetime.date.today() - file_date).days > 7:
                    os.unlink(os.path.join(backup_dir, f))
            except:
                pass

auto_backup()

app = FastAPI(title="外贸CRM")

# 允许本地开发时前端跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

# 客户 CRUD
def auto_fix_countries(db):
    """自动修正英文国家名"""
    COUNTRY_EN_TO_CN = {
        'china': '中国', 'usa': '美国', 'united states': '美国', 'america': '美国', 'us': '美国',
        'canada': '加拿大', 'mexico': '墨西哥', 'brazil': '巴西', 'argentina': '阿根廷', 'chile': '智利',
        'peru': '秘鲁', 'colombia': '哥伦比亚', 'venezuela': '委内瑞拉',
        'uk': '英国', 'united kingdom': '英国', 'england': '英国', 'britain': '英国',
        'france': '法国', 'germany': '德国', 'italy': '意大利', 'spain': '西班牙', 'portugal': '葡萄牙',
        'netherlands': '荷兰', 'holland': '荷兰', 'belgium': '比利时', 'switzerland': '瑞士',
        'austria': '奥地利', 'sweden': '瑞典', 'norway': '挪威', 'denmark': '丹麦', 'finland': '芬兰',
        'ireland': '爱尔兰', 'poland': '波兰', 'russia': '俄罗斯', 'turkey': '土耳其',
        'japan': '日本', 'korea': '韩国', 'india': '印度', 'thailand': '泰国', 'vietnam': '越南',
        'malaysia': '马来西亚', 'singapore': '新加坡', 'indonesia': '印度尼西亚', 'philippines': '菲律宾',
        'australia': '澳大利亚', 'new zealand': '新西兰', 'south africa': '南非', 'egypt': '埃及',
        'morocco': '摩洛哥', 'saudi arabia': '沙特阿拉伯', 'uae': '阿联酋', 'united arab emirates': '阿联酋',
        'israel': '以色列',
    }
    # 带城市的国家，提取国家部分
    import re
    rows = db.execute("SELECT id, country FROM customers").fetchall()
    fixed = 0
    for r in rows:
        country_val = r['country'].strip()
        if not country_val:
            continue
        # 先转小写查映射
        lower = country_val.lower()
        if lower in COUNTRY_EN_TO_CN:
            new_country = COUNTRY_EN_TO_CN[lower]
            db.execute("UPDATE customers SET country = ? WHERE id = ?", (new_country, r['id']))
            fixed += 1
        else:
            # 处理"美国纽约市"这种带城市的，提取前面的国家名
            for cn_country in ['美国', '德国', '法国', '英国', '意大利', '西班牙', '荷兰']:
                if country_val.startswith(cn_country) and country_val != cn_country:
                    db.execute("UPDATE customers SET country = ? WHERE id = ?", (cn_country, r['id']))
                    fixed += 1
                    break
    if fixed > 0:
        db.commit()

@app.get("/api/customers")
def list_customers():
    import json
    with get_db() as db:
        # 先自动修正国家
        auto_fix_countries(db)

        rows = db.execute("""
            SELECT c.*, MAX(f.created_at) as last_followup_at
            FROM customers c
            LEFT JOIN followups f ON c.id = f.customer_id
            GROUP BY c.id
            ORDER BY c.created_at DESC
        """).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d['contacts'] = json.loads(d.get('contacts', '[]'))
            except:
                d['contacts'] = []
            result.append(d)
        return result

@app.get("/api/customers/{cid}/detail")
def customer_detail(cid: str):
    import json
    with get_db() as db:
        customer = db.execute("SELECT * FROM customers WHERE id = ?", (cid,)).fetchone()
        if not customer:
            raise HTTPException(404, "客户不存在")
        c = dict(customer)
        try:
            c['contacts'] = json.loads(c.get('contacts', '[]'))
        except:
            c['contacts'] = []
        followups = db.execute(
            "SELECT * FROM followups WHERE customer_id = ? ORDER BY created_at DESC",
            (cid,)
        ).fetchall()
        return {
            "customer": c,
            "followups": [dict(f) for f in followups],
        }

@app.post("/api/customers")
def create_customer(c: Customer):
    import uuid, json
    cid = f"c{uuid.uuid4().hex[:8]}"
    with get_db() as db:
        db.execute(
            "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, products, contacts, created_at, starred) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (cid, c.company, c.contact, c.country, c.email, c.phone, c.source, c.level, c.status, c.note, c.products, json.dumps([x.dict() for x in c.contacts], ensure_ascii=False), now_str(), c.starred)
        )
    return {"id": cid}

@app.put("/api/customers/{cid}")
def update_customer(cid: str, c: Customer):
    import json
    with get_db() as db:
        result = db.execute("SELECT id FROM customers WHERE id = ?", (cid,)).fetchone()
        if not result:
            raise HTTPException(404, "客户不存在")

        # ===== 重新校验数据 =====
        VALID_SOURCES = {'阿里巴巴国际站', '展会', 'Google', '其他'}
        VALID_STATUSES = {'lead', 'contacted', 'quoted', 'negotiating', 'deal', 'lost'}
        VALID_LEVELS = {'', 'L0', 'L1', 'L2', 'L3', 'L4', '低质', '优质'}
        COMMON_COUNTRIES = {'中国', '美国', '加拿大', '墨西哥', '巴西', '阿根廷', '智利', '秘鲁', '哥伦比亚',
            '英国', '法国', '德国', '意大利', '西班牙', '葡萄牙', '荷兰', '比利时', '瑞士', '奥地利',
            '瑞典', '挪威', '丹麦', '芬兰', '爱尔兰', '波兰', '俄罗斯', '土耳其',
            '日本', '韩国', '印度', '泰国', '越南', '马来西亚', '新加坡', '印度尼西亚', '菲律宾',
            '澳大利亚', '新西兰', '南非', '埃及', '摩洛哥', '沙特阿拉伯', '阿联酋', '以色列', '未知'}

        # 英文国家名映射
        COUNTRY_EN_TO_CN = {
            'china': '中国', 'usa': '美国', 'united states': '美国', 'america': '美国', 'us': '美国',
            'canada': '加拿大', 'mexico': '墨西哥', 'brazil': '巴西', 'argentina': '阿根廷', 'chile': '智利',
            'peru': '秘鲁', 'colombia': '哥伦比亚',
            'uk': '英国', 'united kingdom': '英国', 'england': '英国', 'britain': '英国',
            'france': '法国', 'germany': '德国', 'italy': '意大利', 'spain': '西班牙', 'portugal': '葡萄牙',
            'netherlands': '荷兰', 'holland': '荷兰', 'belgium': '比利时', 'switzerland': '瑞士',
            'austria': '奥地利', 'sweden': '瑞典', 'norway': '挪威', 'denmark': '丹麦', 'finland': '芬兰',
            'ireland': '爱尔兰', 'poland': '波兰', 'russia': '俄罗斯', 'turkey': '土耳其',
            'japan': '日本', 'korea': '韩国', 'india': '印度', 'thailand': '泰国', 'vietnam': '越南',
            'malaysia': '马来西亚', 'singapore': '新加坡', 'indonesia': '印度尼西亚', 'philippines': '菲律宾',
            'australia': '澳大利亚', 'new zealand': '新西兰', 'south africa': '南非', 'egypt': '埃及',
            'morocco': '摩洛哥', 'saudi arabia': '沙特阿拉伯', 'uae': '阿联酋', 'united arab emirates': '阿联酋',
            'israel': '以色列',
        }

        issues = []
        # 国家校验：先检查是不是英文，转换后再检查
        country_val = c.country
        if country_val.lower() in COUNTRY_EN_TO_CN:
            country_val = COUNTRY_EN_TO_CN[country_val.lower()]
            # 自动修正为中文
            db.execute("UPDATE customers SET country = ? WHERE id = ?", (country_val, cid))
            db.commit()
        if country_val not in COMMON_COUNTRIES:
            issues.append(f"国家不规范：{c.country}")
        if c.source not in VALID_SOURCES:
            issues.append(f"来源不规范：{c.source}")
        if c.status not in VALID_STATUSES:
            issues.append(f"状态不规范：{c.status}")
        if c.level not in VALID_LEVELS:
            issues.append(f"等级不规范：{c.level}")

        # 邮箱重复检测（查全表）
        contacts_list = [x.dict() for x in c.contacts]
        for contact in contacts_list:
            email = contact.get('email', '').strip().lower()
            if email:
                # 查其他客户有没有这个邮箱
                others = db.execute(
                    "SELECT id, company, contacts FROM customers WHERE id != ? AND contacts LIKE ?",
                    (cid, f'%"{email}"%')
                ).fetchall()
                if others:
                    # 找出是哪个客户的哪个联系人
                    for o in others:
                        try:
                            o_contacts = json.loads(o['contacts'])
                            for oc in o_contacts:
                                if oc.get('email', '').strip().lower() == email:
                                    issues.append(f"邮箱重复：{email}（与{o['company']}的{oc.get('name', '未知联系人')}重复）")
                                    break
                        except:
                            pass
                    break

        db.execute(
            "UPDATE customers SET company=?, contact=?, country=?, email=?, phone=?, source=?, level=?, status=?, note=?, products=?, contacts=?, starred=?, data_issues=? WHERE id=?",
            (c.company, c.contact, c.country, c.email, c.phone, c.source, c.level, c.status, c.note, c.products, json.dumps(contacts_list, ensure_ascii=False), c.starred, json.dumps(issues, ensure_ascii=False), cid)
        )
    return {"ok": True}

@app.delete("/api/customers/{cid}")
def delete_customer(cid: str):
    with get_db() as db:
        db.execute("DELETE FROM customers WHERE id = ?", (cid,))
        db.execute("DELETE FROM followups WHERE customer_id = ?", (cid,))
    return {"ok": True}

@app.get("/api/export")
def export_excel(start: int = 1, end: int = 0, ids: str = ""):
    import json
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from datetime import datetime

    # 状态和等级映射
    STATUS_MAP = {
        'lead': '新线索',
        'contacted': '初步沟通',
        'quoted': '已报价未成交',
        'negotiating': '谈判中',
        'deal': '已成交',
        'lost': '已流失',
    }
    SOCIAL_MAP = {
        'wechat': '微信',
        'whatsapp': 'WhatsApp',
    }

    wb = Workbook()
    ws = wb.active
    ws.title = "客户总表"

    headers = [
        "序号", "公司名称", "国家", "来源", "等级", "状态",
        "主要产品", "备注",
        "联系人姓名", "职位", "邮箱", "电话", "社交软件", "社交账号",
        "最近跟进日期", "最近跟进内容",
        "创建时间",
    ]
    NUM_COLS = len(headers)

    # ===== 专业报表样式定义 =====
    FONT_NAME = "微软雅黑"

    # 标题行样式
    title_font = Font(name=FONT_NAME, size=16, bold=True, color="1F4E79")
    title_alignment = Alignment(horizontal="left", vertical="center")

    # 副标题（导出日期）
    subtitle_font = Font(name=FONT_NAME, size=9, color="808080")
    subtitle_alignment = Alignment(horizontal="left", vertical="center")

    # 表头样式
    header_font = Font(name=FONT_NAME, size=10, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # 数据行样式
    data_font = Font(name=FONT_NAME, size=10, color="333333")
    left_align = Alignment(horizontal="left", vertical="center", wrap_text=True)
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # 斑马纹背景（浅蓝）
    zebra_fill = PatternFill(start_color="EAF1F8", end_color="EAF1F8", fill_type="solid")

    # 边框：只保留水平线（更干净）
    bottom_border = Border(
        bottom=Side(style='thin', color="D0D0D0")
    )
    header_bottom_border = Border(
        bottom=Side(style='medium', color="1F4E79")
    )

    # ===== 写标题行 =====
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=NUM_COLS)
    title_cell = ws.cell(row=1, column=1, value="外贸CRM客户总表")
    title_cell.font = title_font
    title_cell.alignment = title_alignment
    ws.row_dimensions[1].height = 30

    # 副标题：导出日期
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=NUM_COLS)
    today_str = datetime.now().strftime("%Y年%m月%d日")
    subtitle_cell = ws.cell(row=2, column=1, value=f"导出日期：{today_str}")
    subtitle_cell.font = subtitle_font
    subtitle_cell.alignment = subtitle_alignment
    ws.row_dimensions[2].height = 20

    # 空一行
    ws.row_dimensions[3].height = 10

    # ===== 写表头（第4行）=====
    HEADER_ROW = 4
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=HEADER_ROW, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = header_bottom_border
    ws.row_dimensions[HEADER_ROW].height = 28

    with get_db() as db:
        # 获取客户列表（按公司名排序）
        customers = db.execute("""
            SELECT c.*, MAX(f.created_at) as last_followup_at
            FROM customers c
            LEFT JOIN followups f ON c.id = f.customer_id
            GROUP BY c.id
            ORDER BY c.company
        """).fetchall()

        # 应用筛选
        if ids:
            # 勾选模式：按ID筛选
            id_list = ids.split(',')
            selected = [c for c in customers if c['id'] in id_list]
        else:
            # 序号范围模式
            total = len(customers)
            if end == 0 or end > total:
                end = total
            start_idx = max(0, start - 1)
            end_idx = min(total, end)
            selected = customers[start_idx:end_idx]

        row_idx = HEADER_ROW + 1  # 数据从第5行开始
        for seq, c in enumerate(selected, start):
            # 获取最近一条跟进记录
            last_followup = db.execute(
                "SELECT * FROM followups WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1",
                (c['id'],)
            ).fetchone()

            # 解析联系人
            try:
                contacts = json.loads(c['contacts'] or '[]')
            except:
                contacts = []
            if not contacts:
                contacts = [{}]  # 至少一行

            for contact in contacts:
                # 每行都写基本信息（公司名、国家等），这样导入不会有歧义
                ws.cell(row=row_idx, column=1, value=seq)
                ws.cell(row=row_idx, column=2, value=c['company'])
                ws.cell(row=row_idx, column=3, value=c['country'])
                ws.cell(row=row_idx, column=4, value=c['source'])
                ws.cell(row=row_idx, column=5, value=c['level'])
                ws.cell(row=row_idx, column=6, value=STATUS_MAP.get(c['status'], c['status']))
                ws.cell(row=row_idx, column=7, value=c['products'])
                ws.cell(row=row_idx, column=8, value=c['note'])
                # 最近跟进
                if last_followup:
                    followup_date = last_followup['created_at'][:10] if last_followup['created_at'] else ''
                    ws.cell(row=row_idx, column=15, value=followup_date)
                    ws.cell(row=row_idx, column=16, value=last_followup['content'])
                # 创建时间只保留年月日
                created_date = c['created_at'][:10] if c['created_at'] else ''
                ws.cell(row=row_idx, column=17, value=created_date)
                # 联系人信息
                ws.cell(row=row_idx, column=9, value=contact.get('name', ''))
                ws.cell(row=row_idx, column=10, value=contact.get('position', ''))
                ws.cell(row=row_idx, column=11, value=contact.get('email', ''))
                ws.cell(row=row_idx, column=12, value=contact.get('phone', ''))
                social = contact.get('social', '')
                ws.cell(row=row_idx, column=13, value=SOCIAL_MAP.get(social, social))
                ws.cell(row=row_idx, column=14, value=contact.get('socialAccount', ''))
                row_idx += 1

    # 状态标签样式（柔和的浅色背景）
    STATUS_FILL = {
        '新线索': PatternFill(start_color="D6E4F0", end_color="D6E4F0", fill_type="solid"),
        '初步沟通': PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid"),
        '已报价未成交': PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid"),
        '谈判中': PatternFill(start_color="E4DFEC", end_color="E4DFEC", fill_type="solid"),
        '已成交': PatternFill(start_color="D9EAD3", end_color="D9EAD3", fill_type="solid"),
        '已流失': PatternFill(start_color="F4CCCC", end_color="F4CCCC", fill_type="solid"),
    }

    # 给数据行加样式
    data_start_row = HEADER_ROW + 1
    data_end_row = row_idx - 1
    for row_num in range(data_start_row, data_end_row + 1):
        # 斑马纹：每隔一行加浅蓝背景
        is_zebra = (row_num - data_start_row) % 2 == 1
        for col_num in range(1, NUM_COLS + 1):
            cell = ws.cell(row=row_num, column=col_num)
            cell.font = data_font
            cell.border = bottom_border  # 只加底部细线
            cell.alignment = center_align  # 全部居中

            # 斑马纹背景
            if is_zebra:
                cell.fill = zebra_fill

        # 状态列特殊颜色（第6列）
        status_cell = ws.cell(row=row_num, column=6)
        if status_cell.value in STATUS_FILL:
            status_cell.fill = STATUS_FILL[status_cell.value]
            status_cell.font = Font(name=FONT_NAME, size=10, bold=True, color="333333")

        # 行高
        ws.row_dimensions[row_num].height = 22

    # 调整列宽
    col_widths = {
        'A': 6,   # 序号
        'B': 28,  # 公司名称
        'C': 12,  # 国家
        'D': 16,  # 来源
        'E': 8,   # 等级
        'F': 14,  # 状态
        'G': 22,  # 主要产品
        'H': 28,  # 备注
        'I': 12,  # 联系人姓名
        'J': 12,  # 职位
        'K': 28,  # 邮箱
        'L': 16,  # 电话
        'M': 12,  # 社交软件
        'N': 16,  # 社交账号
        'O': 13,  # 最近跟进日期
        'P': 35,  # 最近跟进内容
        'Q': 12,  # 创建时间
    }
    for col_letter, width in col_widths.items():
        ws.column_dimensions[col_letter].width = width

    # 隐藏网格线（更干净）
    ws.sheet_view.showGridLines = False

    # 冻结表头（第4行及以上）
    ws.freeze_panes = f'A{HEADER_ROW + 1}'

    # 保存到临时文件
    filepath = os.path.join(os.path.dirname(__file__), "crm_export.xlsx")
    wb.save(filepath)
    # 文件名带日期时间
    export_filename = f"CRM客户导出_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return FileResponse(filepath, filename=export_filename)

@app.post("/api/import")
async def import_excel(file: UploadFile = File(...)):
    import json
    import uuid
    from openpyxl import load_workbook

    # 状态映射（中文转英文）
    STATUS_MAP_REVERSE = {
        '新线索': 'lead',
        '初步沟通': 'contacted',
        '已报价未成交': 'quoted',
        '已报价': 'quoted',
        '谈判中': 'negotiating',
        '已成交': 'deal',
        '已流失': 'lost',
    }
    SOCIAL_MAP_REVERSE = {
        '微信': 'wechat',
        'WhatsApp': 'whatsapp',
    }

    # 保存上传的文件
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    wb = load_workbook(tmp_path)
    ws = wb.active

    # 找到表头行（跳过标题行和导出日期行）
    header_row = None
    for row_idx in range(1, 10):
        cell_value = ws.cell(row=row_idx, column=1).value
        if cell_value == '序号':
            header_row = row_idx
            break

    if not header_row:
        os.unlink(tmp_path)
        raise HTTPException(400, "未找到表头，请使用导出的Excel模板")

    # 读取所有数据行
    rows = []
    for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
        if row[1]:  # 公司名称不为空
            rows.append(row)

    # 按公司名分组（兼容空公司名：继承上一行的公司名）
    customers_map = {}
    last_company = None
    for row in rows:
        company = (row[1] or '').strip()
        if not company:
            # 公司名为空，继承上一行的公司名
            if last_company:
                company = last_company
            else:
                continue
        else:
            last_company = company

        if company not in customers_map:
            customers_map[company] = {
                'company': company,
                'country': row[2] or '',
                'source': row[3] or '',
                'level': row[4] or '',
                'status': STATUS_MAP_REVERSE.get(row[5], 'lead'),
                'products': row[6] or '',
                'note': row[7] or '',
                'contacts': [],
                'last_followup_date': row[14] or '',
                'last_followup_content': row[15] or '',
                'created_at': row[16] or '',
            }

        # 加联系人
        contact_name = row[8] or ''
        if contact_name:
            customers_map[company]['contacts'].append({
                'name': contact_name,
                'position': row[9] or '',
                'email': row[10] or '',
                'phone': row[11] or '',
                'social': SOCIAL_MAP_REVERSE.get(row[12], row[12] or ''),
                'socialAccount': row[13] or '',
            })

    # 合法值列表（用于校验）
    VALID_SOURCES = {'阿里巴巴国际站', '展会', 'Google', '其他'}
    VALID_STATUSES = {'lead', 'contacted', 'quoted', 'negotiating', 'deal', 'lost'}
    VALID_LEVELS = {'', 'L0', 'L1', 'L2', 'L3', 'L4', '低质', '优质'}
    # 常见国家列表（简单校验，实际以前端的COUNTRIES为准）
    COMMON_COUNTRIES = {'中国', '美国', '加拿大', '墨西哥', '巴西', '阿根廷', '智利', '秘鲁', '哥伦比亚',
        '英国', '法国', '德国', '意大利', '西班牙', '葡萄牙', '荷兰', '比利时', '瑞士', '奥地利',
        '瑞典', '挪威', '丹麦', '芬兰', '爱尔兰', '波兰', '俄罗斯', '土耳其',
        '日本', '韩国', '印度', '泰国', '越南', '马来西亚', '新加坡', '印度尼西亚', '菲律宾',
        '澳大利亚', '新西兰', '南非', '埃及', '摩洛哥', '沙特阿拉伯', '阿联酋', '以色列',
        '未知'}

    # ===== 邮箱重复检测 =====
    all_emails = {}
    for company, data in customers_map.items():
        for contact in data['contacts']:
            email = contact.get('email', '').strip().lower()
            if email:
                if email not in all_emails:
                    all_emails[email] = []
                all_emails[email].append(company)

    # 写入数据库
    imported_count = 0
    with get_db() as db:
        for company, data in customers_map.items():
            # 检查公司是否已存在
            existing = db.execute("SELECT id FROM customers WHERE company = ?", (company,)).fetchone()
            if existing:
                continue  # 跳过已存在的

            # ===== 数据校验 =====
            issues = []
            # 国家校验
            if data['country'] not in COMMON_COUNTRIES:
                issues.append(f"国家不规范：{data['country']}")
            # 来源校验
            if data['source'] not in VALID_SOURCES:
                issues.append(f"来源不规范：{data['source']}")
            # 状态校验
            if data['status'] not in VALID_STATUSES:
                issues.append(f"状态不规范：{data['status']}")
            # 等级校验
            if data['level'] not in VALID_LEVELS:
                issues.append(f"等级不规范：{data['level']}")

            # 邮箱重复校验
            for contact in data['contacts']:
                email = contact.get('email', '').strip().lower()
                if email and len(all_emails.get(email, [])) > 1:
                    issues.append(f"邮箱重复：{email}")
                    break

            cid = f"c{uuid.uuid4().hex[:8]}"
            created_at = data['created_at'] if data['created_at'] else now_str()

            db.execute(
                "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, products, contacts, created_at, data_issues) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    cid,
                    data['company'],
                    data['contacts'][0]['name'] if data['contacts'] else '',
                    data['country'],
                    data['contacts'][0]['email'] if data['contacts'] else '',
                    data['contacts'][0]['phone'] if data['contacts'] else '',
                    data['source'],
                    data['level'],
                    data['status'],
                    data['note'],
                    data['products'],
                    json.dumps(data['contacts'], ensure_ascii=False),
                    created_at,
                    json.dumps(issues, ensure_ascii=False)
                )
            )

            # 如果有跟进记录，写入
            if data['last_followup_content']:
                fid = f"f{uuid.uuid4().hex[:8]}"
                followup_date = data['last_followup_date'] + ' 12:00:00' if data['last_followup_date'] else now_str()
                db.execute(
                    "INSERT INTO followups (id, customer_id, type, content, next_follow_up_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (fid, cid, 'other', data['last_followup_content'], '', followup_date)
                )

            imported_count += 1

    os.unlink(tmp_path)
    return {"imported": imported_count, "total": len(customers_map)}

# 跟进记录 CRUD
@app.get("/api/followups")
def list_followups():
    with get_db() as db:
        rows = db.execute("SELECT * FROM followups ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

@app.post("/api/followups")
def create_followup(f: FollowUp):
    import uuid
    from datetime import datetime
    fid = f"f{uuid.uuid4().hex[:8]}"
    if f.created_at:
        # 统一格式：YYYY-MM-DDTHH:MM -> YYYY-MM-DD HH:MM:SS
        dt = datetime.fromisoformat(f.created_at)
        created_at = dt.strftime("%Y-%m-%d %H:%M:%S")
    else:
        created_at = now_str()
    with get_db() as db:
        db.execute(
            "INSERT INTO followups (id, customer_id, type, content, next_follow_up_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (fid, f.customer_id, f.type, f.content, f.next_follow_up_at, created_at)
        )
    return {"id": fid}

@app.delete("/api/followups/{fid}")
def delete_followup(fid: str):
    with get_db() as db:
        db.execute("DELETE FROM followups WHERE id = ?", (fid,))
    return {"ok": True}

# ---------- WebDAV 同步配置 ----------
def load_config():
    import json
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_config(config: dict):
    import json
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

class SyncConfig(BaseModel):
    webdav_url: str = ""
    webdav_user: str = ""
    webdav_pass: str = ""
    auto_sync: bool = True

@app.get("/api/sync/config")
def get_sync_config():
    config = load_config()
    return {
        "webdav_url": config.get("webdav_url", ""),
        "webdav_user": config.get("webdav_user", ""),
        "webdav_pass_saved": bool(config.get("webdav_pass", "")),  # 只返回有没有保存密码
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

@app.post("/api/sync/upload")
def sync_upload():
    import requests
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        raise HTTPException(400, "请先配置WebDAV账号")

    # 自动创建crm文件夹
    folder_url = f"{config['webdav_url']}/crm/"
    requests.request('MKCOL', folder_url, auth=(config['webdav_user'], config['webdav_pass']), timeout=10)

    url = f"{config['webdav_url']}/crm/trade_crm.db"
    try:
        with open(DB_PATH, 'rb') as f:
            res = requests.put(
                url,
                data=f,
                auth=(config['webdav_user'], config['webdav_pass']),
                headers={"Content-Type": "application/octet-stream"},
                timeout=30
            )
        if res.status_code in (200, 201, 204):
            return {"ok": True, "size": os.path.getsize(DB_PATH)}
        else:
            raise HTTPException(500, f"上传失败：HTTP {res.status_code} - {res.text[:200]}")
    except Exception as e:
        raise HTTPException(500, f"上传失败：{str(e)}")

@app.post("/api/sync/test")
def sync_test(config: SyncConfig):
    import requests
    if not config.webdav_url or not config.webdav_user:
        return {"ok": False, "message": "请先填写地址和账号"}

    try:
        # 测试方式：创建crm文件夹，上传测试文件
        folder_url = f"{config.webdav_url}/crm/"
        requests.request('MKCOL', folder_url, auth=(config.webdav_user, config.webdav_pass), timeout=10)

        test_url = f"{config.webdav_url}/crm/.crm_test"
        res = requests.put(
            test_url,
            data=b'test',
            auth=(config.webdav_user, config.webdav_pass),
            headers={"Content-Type": "text/plain"},
            timeout=10
        )
        if res.status_code in (200, 201, 204):
            # 上传成功，删掉测试文件
            requests.delete(test_url, auth=(config.webdav_user, config.webdav_pass), timeout=10)
            return {"ok": True, "message": "连接成功！账号密码正确"}
        elif res.status_code == 401:
            return {"ok": False, "message": "账号或密码错误（注意要用应用密码，不是登录密码）"}
        else:
            return {"ok": False, "message": f"连接失败：HTTP {res.status_code}"}
    except Exception as e:
        return {"ok": False, "message": f"连接失败：{str(e)}"}

@app.post("/api/fix/countries")
def fix_countries():
    """批量修正英文国家名"""
    COUNTRY_EN_TO_CN = {
        'china': '中国', 'usa': '美国', 'united states': '美国', 'america': '美国', 'us': '美国',
        'canada': '加拿大', 'mexico': '墨西哥', 'brazil': '巴西', 'argentina': '阿根廷', 'chile': '智利',
        'peru': '秘鲁', 'colombia': '哥伦比亚',
        'uk': '英国', 'united kingdom': '英国', 'england': '英国', 'britain': '英国',
        'france': '法国', 'germany': '德国', 'italy': '意大利', 'spain': '西班牙', 'portugal': '葡萄牙',
        'netherlands': '荷兰', 'holland': '荷兰', 'belgium': '比利时', 'switzerland': '瑞士',
        'austria': '奥地利', 'sweden': '瑞典', 'norway': '挪威', 'denmark': '丹麦', 'finland': '芬兰',
        'ireland': '爱尔兰', 'poland': '波兰', 'russia': '俄罗斯', 'turkey': '土耳其',
        'japan': '日本', 'korea': '韩国', 'india': '印度', 'thailand': '泰国', 'vietnam': '越南',
        'malaysia': '马来西亚', 'singapore': '新加坡', 'indonesia': '印度尼西亚', 'philippines': '菲律宾',
        'australia': '澳大利亚', 'new zealand': '新西兰', 'south africa': '南非', 'egypt': '埃及',
        'morocco': '摩洛哥', 'saudi arabia': '沙特阿拉伯', 'uae': '阿联酋', 'united arab emirates': '阿联酋',
        'israel': '以色列',
    }

    fixed = 0
    with get_db() as db:
        customers = db.execute("SELECT id, country FROM customers").fetchall()
        for c in customers:
            country_val = c['country']
            if country_val.lower() in COUNTRY_EN_TO_CN:
                new_country = COUNTRY_EN_TO_CN[country_val.lower()]
                db.execute("UPDATE customers SET country = ? WHERE id = ?", (new_country, c['id']))
                fixed += 1
        db.commit()

    return {"ok": True, "fixed": fixed}

@app.post("/api/sync/logout")
def sync_logout():
    # 清除配置，只保留空配置
    save_config({
        "webdav_url": "",
        "webdav_user": "",
        "webdav_pass": "",
        "auto_sync": True,
    })
    return {"ok": True}

@app.post("/api/sync/check_remote")
def check_remote():
    """检查云端有没有数据库"""
    import requests
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        return {"has_remote": False}

    url = f"{config['webdav_url']}/crm/trade_crm.db"
    try:
        res = requests.head(
            url,
            auth=(config['webdav_user'], config['webdav_pass']),
            timeout=10
        )
        return {"has_remote": res.status_code == 200}
    except:
        return {"has_remote": False}

@app.post("/api/sync/merge")
def sync_merge():
    """融合合并本地和云端数据"""
    import requests
    import shutil
    import sqlite3
    import json
    import uuid

    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        raise HTTPException(400, "请先配置WebDAV账号")

    # 1. 下载云端数据库到临时文件
    remote_url = f"{config['webdav_url']}/crm/trade_crm.db"
    res = requests.get(
        remote_url,
        auth=(config['webdav_user'], config['webdav_pass']),
        timeout=30
    )
    if res.status_code != 200:
        raise HTTPException(404, "云端没有数据库文件")

    import tempfile
    tmp_remote = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
    tmp_remote.write(res.content)
    tmp_remote.close()

    # 2. 备份本地数据库
    backup_path = DB_PATH + ".merge_bak"
    shutil.copy2(DB_PATH, backup_path)

    try:
        # 3. 读取本地所有客户
        local_db = sqlite3.connect(DB_PATH)
        local_db.row_factory = sqlite3.Row
        local_customers = local_db.execute("SELECT * FROM customers").fetchall()
        local_companies = {c['company']: c['id'] for c in local_customers}

        # 4. 读取云端所有客户
        remote_db = sqlite3.connect(tmp_remote.name)
        remote_db.row_factory = sqlite3.Row
        remote_customers = remote_db.execute("SELECT * FROM customers").fetchall()

        # 5. 合并：云端有但本地没有的，加进来
        added = 0
        for rc in remote_customers:
            if rc['company'] not in local_companies:
                # 新增这个客户
                new_id = f"c{uuid.uuid4().hex[:8]}"
                local_db.execute(
                    "INSERT INTO customers (id, company, contact, country, email, phone, source, level, status, note, products, contacts, created_at, starred, data_issues) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        new_id,
                        rc['company'],
                        rc['contact'],
                        rc['country'],
                        rc['email'],
                        rc['phone'],
                        rc['source'],
                        rc['level'],
                        rc['status'],
                        rc['note'],
                        rc['products'],
                        rc['contacts'],
                        rc['created_at'],
                        rc['starred'],
                        rc['data_issues'],
                    )
                )
                added += 1

                # 复制跟进记录
                remote_followups = remote_db.execute(
                    "SELECT * FROM followups WHERE customer_id = ?", (rc['id'],)
                ).fetchall()
                for fu in remote_followups:
                    new_fid = f"f{uuid.uuid4().hex[:8]}"
                    local_db.execute(
                        "INSERT INTO followups (id, customer_id, type, content, next_follow_up_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (new_fid, new_id, fu['type'], fu['content'], fu['next_follow_up_at'], fu['created_at'])
                    )

        local_db.commit()
        local_db.close()
        remote_db.close()

        # 6. 上传合并后的数据库到云端
        with open(DB_PATH, 'rb') as f:
            res2 = requests.put(
                remote_url,
                data=f,
                auth=(config['webdav_user'], config['webdav_pass']),
                headers={"Content-Type": "application/octet-stream"},
                timeout=30
            )

        os.unlink(tmp_remote.name)
        return {"ok": True, "added": added}

    except Exception as e:
        # 恢复备份
        shutil.copy2(backup_path, DB_PATH)
        os.unlink(tmp_remote.name)
        raise HTTPException(500, f"融合失败：{str(e)}")

@app.post("/api/sync/download")
def sync_download():
    import requests
    import shutil
    config = load_config()
    if not config.get("webdav_url") or not config.get("webdav_user"):
        raise HTTPException(400, "请先配置WebDAV账号")

    url = f"{config['webdav_url']}/crm/trade_crm.db"
    try:
        # 先备份当前数据库
        backup_path = DB_PATH + ".bak"
        if os.path.exists(DB_PATH):
            shutil.copy2(DB_PATH, backup_path)

        # 下载最新的
        res = requests.get(
            url,
            auth=(config['webdav_user'], config['webdav_pass']),
            timeout=30
        )
        if res.status_code == 200:
            with open(DB_PATH, 'wb') as f:
                f.write(res.content)
            return {"ok": True, "size": len(res.content)}
        elif res.status_code == 404:
            return {"ok": True, "message": "服务器上还没有数据库文件"}
        else:
            raise HTTPException(500, f"下载失败：HTTP {res.status_code}")
    except Exception as e:
        if os.path.exists(backup_path):
            shutil.copy2(backup_path, DB_PATH)
        raise HTTPException(500, f"下载失败：{str(e)}")

# ---------- 前端静态文件 ----------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
DIST_DIR = os.path.join(BASE_DIR, "dist", "output")
ASSETS_DIR = os.path.join(BASE_DIR, "dist", "output_resource")

if os.path.exists(DIST_DIR):
    # 静态资源目录
    if os.path.exists(os.path.join(ASSETS_DIR, "assets")):
        app.mount("/assets", StaticFiles(directory=os.path.join(ASSETS_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        # 先找 output 目录下的文件
        file_path = os.path.join(DIST_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        # 再找 output_resource 下的文件
        resource_path = os.path.join(ASSETS_DIR, full_path)
        if os.path.isfile(resource_path):
            return FileResponse(resource_path)
        # 都找不到就返回 index.html（SPA 路由），禁止缓存
        return FileResponse(
            os.path.join(DIST_DIR, "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

if __name__ == "__main__":
    import uvicorn
    print("=" * 40)
    print("  Trade CRM - Local Edition")
    print("  URL: http://localhost:8000")
    print("  Data file: trade_crm.db")
    print("  Close this window to stop")
    print("=" * 40)
    uvicorn.run(app, host="127.0.0.1", port=8000)
