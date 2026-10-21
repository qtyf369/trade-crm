// EXPORTS: api

import type { ICustomer, IFollowUp } from './types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

export const api = {
  // 客户
  listCustomers: () => request<ICustomer[]>('/customers'),
  createCustomer: (data: Omit<ICustomer, 'id' | 'created_at'>) =>
    request<{ id: string }>('/customers', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomer: (id: string, data: Partial<ICustomer>) =>
    request<{ ok: boolean }>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCustomer: (id: string) =>
    request<{ ok: boolean }>(`/customers/${id}`, { method: 'DELETE' }),

  // 跟进记录
  listFollowups: () => request<IFollowUp[]>('/followups'),
  createFollowup: (data: Omit<IFollowUp, 'id' | 'created_at'> & { created_at?: string }) =>
    request<{ id: string }>('/followups', { method: 'POST', body: JSON.stringify(data) }),
  deleteFollowup: (id: string) =>
    request<{ ok: boolean }>(`/followups/${id}`, { method: 'DELETE' }),
};
