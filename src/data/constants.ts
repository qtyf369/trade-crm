// 客户相关的合法值集合（与后端 constants.py 保持同步）

export const CUSTOMER_SOURCES = ['阿里巴巴国际站', '展会', 'Google', '其他'] as const;

/** 等级：L0-L4（阿里专用）+ 1星-5星（通用），旧值「低质/优质」仅展示兼容 */
export const CUSTOMER_LEVELS = ['', 'L0', 'L1', 'L2', 'L3', 'L4', '1星', '2星', '3星', '4星', '5星'] as const;

/** 旧等级 -> 星级（历史数据展示兼容） */
export const LEVEL_LEGACY_MAP: Record<string, string> = {
  '低质': '1星', '优质': '5星',
};

export const FOLLOWUP_TYPES = ['email', 'whatsapp', 'phone', 'visit', 'other'] as const;

export const CUSTOMER_STATUSES = ['lead', 'contacted', 'quoted', 'negotiating', 'deal', 'lost'] as const;

export const STATUS_LABELS: Record<string, string> = {
  lead: '新线索',
  contacted: '初步沟通',
  quoted: '已报价未成交',
  negotiating: '谈判中',
  deal: '成交客户',
  lost: '已流失',
};

export const LEVEL_LABELS: Record<string, string> = {
  '': '未分级',
  L0: 'L0', L1: 'L1', L2: 'L2', L3: 'L3', L4: 'L4',
  '1星': '1星', '2星': '2星', '3星': '3星', '4星': '4星', '5星': '5星',
  // 旧等级展示兼容
  '低质': '1星', '优质': '5星',
};

export const SOCIAL_LABELS: Record<string, string> = {
  wechat: '微信',
  whatsapp: 'WhatsApp',
};

/** 多少天未跟进就算"需要跟进" */
export const STALE_DAYS = 7;

/** 解析 data_issues：后端现在返回数组，但也兼容历史 JSON 字符串 */
export function parseIssues(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function hasIssues(raw: unknown): boolean {
  return parseIssues(raw).length > 0;
}
