"""
CRM 公共常量与数据字典

集中管理前后端共用的合法值集合、映射表，避免在 main.py 中重复定义。
前端有同源的 src/data/countries.ts 与类型定义（src/data/types.ts），
改动这里的枚举时请同步前端。
"""

from typing import Dict, List

# ---------- 合法值集合（权威定义） ----------

SOURCES: List[str] = ['阿里巴巴国际站', '展会', 'Google', '其他']

# 后端状态机：key 存库，label 用于导出/展示
STATUS_MAP: Dict[str, str] = {
    'lead': '新线索',
    'contacted': '初步沟通',
    'quoted': '已报价未成交',
    'negotiating': '谈判中',
    'deal': '已成交',
    'lost': '已流失',
}
VALID_STATUSES = set(STATUS_MAP.keys())

# 中文状态 -> 内部 key（导入 Excel 时反查）
STATUS_REVERSE_MAP: Dict[str, str] = {v: k for k, v in STATUS_MAP.items()}
# 兼容旧数据里的简写
STATUS_REVERSE_MAP['已报价'] = 'quoted'

LEVELS: List[str] = ['', 'L0', 'L1', 'L2', 'L3', 'L4', '低质', '优质']
VALID_LEVELS = set(LEVELS)

SOCIAL_MAP: Dict[str, str] = {
    'wechat': '微信',
    'whatsapp': 'WhatsApp',
}
SOCIAL_REVERSE_MAP: Dict[str, str] = {v: k for k, v in SOCIAL_MAP.items()}

FOLLOWUP_TYPES: List[str] = ['email', 'whatsapp', 'phone', 'visit', 'other']

# 数据导出 Excel 的表头（17 列）
EXPORT_HEADERS: List[str] = [
    '序号', '公司名称', '国家', '来源', '等级', '状态',
    '主要产品', '备注',
    '联系人姓名', '职位', '邮箱', '电话', '社交软件', '社交账号',
    '最近跟进日期', '最近跟进内容',
    '创建时间',
]

# ---------- 国家字典（英文 -> 中文） ----------

COUNTRY_EN_TO_CN: Dict[str, str] = {
    'china': '中国', 'usa': '美国', 'united states': '美国', 'america': '美国', 'us': '美国',
    'canada': '加拿大', 'mexico': '墨西哥', 'brazil': '巴西', 'argentina': '阿根廷', 'chile': '智利',
    'peru': '秘鲁', 'colombia': '哥伦比亚', 'venezuela': '委内瑞拉',
    'uk': '英国', 'united kingdom': '英国', 'england': '英国', 'britain': '英国',
    'france': '法国', 'germany': '德国', 'italy': '意大利', 'spain': '西班牙', 'portugal': '葡萄牙',
    'netherlands': '荷兰', 'holland': '荷兰', 'belgium': '比利时', 'switzerland': '瑞士',
    'austria': '奥地利', 'sweden': '瑞典', 'norway': '挪威', 'denmark': '丹麦', 'finland': '芬兰',
    'ireland': '爱尔兰', 'poland': '波兰', 'czech': '捷克', 'russia': '俄罗斯', 'turkey': '土耳其',
    'japan': '日本', 'korea': '韩国', 'south korea': '韩国', 'india': '印度', 'thailand': '泰国',
    'vietnam': '越南', 'malaysia': '马来西亚', 'singapore': '新加坡', 'indonesia': '印度尼西亚',
    'philippines': '菲律宾', 'australia': '澳大利亚', 'new zealand': '新西兰', 'south africa': '南非',
    'egypt': '埃及', 'nigeria': '尼日利亚', 'kenya': '肯尼亚', 'morocco': '摩洛哥', 'algeria': '阿尔及利亚',
    'saudi arabia': '沙特阿拉伯', 'uae': '阿联酋', 'united arab emirates': '阿联酋',
    'israel': '以色列', 'pakistan': '巴基斯坦', 'bangladesh': '孟加拉国',
}

# 常见国家白名单（与国家输入联想下拉同源，比全量 COUNTRIES 小，用于宽松校验）
COMMON_COUNTRIES: List[str] = [
    '未知',
    '中国', '美国', '加拿大', '墨西哥', '巴西', '阿根廷', '智利', '秘鲁', '哥伦比亚', '委内瑞拉',
    '英国', '法国', '德国', '意大利', '西班牙', '葡萄牙', '荷兰', '比利时', '瑞士', '奥地利',
    '瑞典', '挪威', '丹麦', '芬兰', '爱尔兰', '波兰', '捷克', '俄罗斯', '土耳其',
    '日本', '韩国', '印度', '泰国', '越南', '马来西亚', '新加坡', '印度尼西亚', '菲律宾',
    '澳大利亚', '新西兰', '南非', '埃及', '摩洛哥', '阿尔及利亚', '沙特阿拉伯', '阿联酋', '以色列',
    '巴基斯坦', '孟加拉国',
]
VALID_COUNTRIES = set(COMMON_COUNTRIES)

# 带城市后缀的国家前缀，用于从"美国纽约市"这类值中提取国家
CITY_COUNTRY_PREFIXES: List[str] = [
    '美国', '德国', '法国', '英国', '意大利', '西班牙', '荷兰', '日本', '韩国', '加拿大', '澳大利亚',
]
