// EXPORTS: api

import type { ICustomer, IFollowUp } from './types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let detail = `API error: ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === 'string') detail = body.detail;
    } catch {
      // 非 JSON 响应，保留默认错误信息
    }
    throw new Error(detail);
  }
  return res.json();
}

/** 分页列表响应 */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** 列表查询参数（多选用逗号分隔） */
export interface CustomerQuery {
  search?: string;
  country?: string;
  level?: string;
  status?: string;
  source?: string;
  starred?: boolean;
  issues?: boolean;
  sort_by?: string;
  sort_asc?: boolean;
  page?: number;
  page_size?: number;
}

function toQuery(params: CustomerQuery = {}): string {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.country) q.set('country', params.country);
  if (params.level) q.set('level', params.level);
  if (params.status) q.set('status', params.status);
  if (params.source) q.set('source', params.source);
  if (params.starred) q.set('starred', 'true');
  if (params.issues) q.set('issues', 'true');
  if (params.sort_by) q.set('sort_by', params.sort_by);
  if (params.sort_asc !== undefined) q.set('sort_asc', String(params.sort_asc));
  if (params.page) q.set('page', String(params.page));
  if (params.page_size) q.set('page_size', String(params.page_size));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export type BatchAction = 'delete' | 'star' | 'unstar';

export const api = {
  // 客户
  listCustomers: (params: CustomerQuery = {}) =>
    request<Paged<ICustomer>>(`/customers${toQuery(params)}`),

  /** 全量列表（导出/统计用，数据量大时慎用） */
  listAllCustomers: () => request<ICustomer[]>('/customers/all'),

  createCustomer: (data: Omit<ICustomer, 'id' | 'created_at'>) =>
    request<{ id: string }>('/customers', { method: 'POST', body: JSON.stringify(data) }),

  updateCustomer: (id: string, data: Partial<ICustomer>) =>
    request<{ ok: boolean }>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteCustomer: (id: string) =>
    request<{ ok: boolean }>(`/customers/${id}`, { method: 'DELETE' }),

  /** 批量操作：删除 / 加星标 / 取消星标，单次请求完成 */
  batchCustomers: (ids: string[], action: BatchAction) =>
    request<{ ok: boolean; affected: number }>(
      '/customers/batch',
      { method: 'POST', body: JSON.stringify({ ids, action }) },
    ),

  customerDetail: (id: string) =>
    request<{ customer: ICustomer; followups: IFollowUp[] }>(`/customers/${id}/detail`),

  // 跟进记录
  listFollowups: (params: { customer_id?: string; page?: number; page_size?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.customer_id) q.set('customer_id', params.customer_id);
    if (params.page) q.set('page', String(params.page));
    if (params.page_size) q.set('page_size', String(params.page_size));
    const s = q.toString();
    return request<Paged<IFollowUp>>(`/followups${s ? `?${s}` : ''}`);
  },

  createFollowup: (data: Omit<IFollowUp, 'id' | 'created_at'> & { created_at?: string }) =>
    request<{ id: string }>('/followups', { method: 'POST', body: JSON.stringify(data) }),

  updateFollowup: (id: string, data: Partial<IFollowUp> & { created_at?: string }) =>
    request<{ ok: boolean }>(`/followups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteFollowup: (id: string) =>
    request<{ ok: boolean }>(`/followups/${id}`, { method: 'DELETE' }),

  // 导入导出
  exportUrl: (params: { ids?: string; start?: number; end?: number; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.ids) q.set('ids', params.ids);
    if (params.start) q.set('start', String(params.start));
    if (params.end) q.set('end', String(params.end));
    if (params.search) q.set('search', params.search);
    const s = q.toString();
    return `${BASE}/export${s ? `?${s}` : ''}`;
  },

  importExcel: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/import`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || '导入失败');
    return data as { imported: number; skipped: number; total: number };
  },
};
