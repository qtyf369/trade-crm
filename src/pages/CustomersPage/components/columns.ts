// 列定义与持久化：客户表的列显示/顺序配置
// 存储策略：localStorage 做本地缓存（秒读），同时并入 /api/settings（坚果云同步，全端一套）
import type { SortKey } from './CustomerTable';

export interface ColumnDef {
  key: string;
  label: string;
  /** 默认是否显示 */
  defaultVisible: boolean;
  /** 默认排序（下标越小越靠前） */
  defaultOrder: number;
}

/** 全部可用列（含未来可能新增的，超出宽度的靠横向滚动查看） */
export const ALL_COLUMNS: ColumnDef[] = [
  { key: 'company', label: '公司名称', defaultVisible: true, defaultOrder: 0 },
  { key: 'contact', label: '联系人', defaultVisible: true, defaultOrder: 1 },
  { key: 'country', label: '国家', defaultVisible: true, defaultOrder: 2 },
  { key: 'source', label: '来源', defaultVisible: true, defaultOrder: 3 },
  { key: 'products', label: '主要产品', defaultVisible: true, defaultOrder: 4 },
  { key: 'level', label: '等级', defaultVisible: true, defaultOrder: 5 },
  { key: 'status', label: '状态', defaultVisible: true, defaultOrder: 6 },
  { key: 'last_followup_at', label: '最近跟进', defaultVisible: true, defaultOrder: 7 },
  { key: 'created_at', label: '创建时间', defaultVisible: false, defaultOrder: 8 },
];

const STORAGE_KEY = 'crm:columns:v1';

export interface ColumnsState {
  /** 按 displayOrder 排好的 key 列表（含隐藏列） */
  order: string[];
  visible: Set<string>;
}

/** 默认配置（还原用） */
export function defaultColumns(): ColumnsState {
  const order = [...ALL_COLUMNS]
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((c) => c.key);
  const visible = new Set(
    ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
  );
  return { order, visible };
}

function sanitize(saved: { order?: string[]; visible?: string[] }): ColumnsState {
  const known = ALL_COLUMNS.map((c) => c.key);
  const order = [
    ...(saved.order ?? []).filter((k) => known.includes(k)),
    ...known.filter((k) => !(saved.order ?? []).includes(k)),
  ];
  const visible = new Set((saved.visible ?? []).filter((k) => known.includes(k)));
  return { order, visible };
}

/** 读取列配置：先 localStorage（快），云端合并由 useColumns 启动时做 */
export function loadColumns(): ColumnsState {
  const fallback = defaultColumns();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return sanitize(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

function saveLocal(state: ColumnsState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ order: state.order, visible: [...state.visible] }),
    );
  } catch {
    // 存不了就仅本次会话生效
  }
}

/** 保存：写本地缓存 + 推送到 /api/settings（坚果云同步） */
export function saveColumns(state: ColumnsState) {
  saveLocal(state);
  try {
    // 与主题设置同一存储桶，后端整体打包同步到坚果云
    const raw = localStorage.getItem(STORAGE_KEY);
    const columns = raw ? JSON.parse(raw) : {};
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { columns } }),
    }).catch(() => {});
  } catch {
    // 静默
  }
}

/** 从 /api/settings 合并云端列配置（启动时调用一次；云端为权威） */
export function pullColumnsRemote(): Promise<ColumnsState | null> {
  return fetch('/api/settings')
    .then((r) => (r.ok ? r.json() : null))
    .then((res) => {
      const cols = res?.settings?.columns;
      if (!cols || (!Array.isArray(cols.order) && !Array.isArray(cols.visible))) return null;
      const state = sanitize(cols);
      saveLocal(state);
      return state;
    })
    .catch(() => null);
}

/** CustomerTable 用的排序 key 与列 key 的映射（不匹配的列不支持点击排序） */
export const COLUMN_SORT_KEY: Partial<Record<string, SortKey>> = {
  company: 'company',
  country: 'country',
  level: 'level',
  status: 'status',
  source: 'source',
  last_followup_at: 'last_followup_at',
  created_at: 'created_at',
};
