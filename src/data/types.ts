// EXPORTS: ICustomer, IFollowUp, CustomerLevel, CustomerStatus, FollowUpType, CUSTOMER_STATUS_META, CUSTOMER_LEVEL_META, FOLLOWUP_TYPE_META

export type CustomerLevel = '' | 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | '低质' | '优质';
export type CustomerStatus = 'lead' | 'contacted' | 'quoted' | 'negotiating' | 'deal' | 'lost';
export type FollowUpType = 'email' | 'whatsapp' | 'phone' | 'visit' | 'other';

export interface ICustomerContact {
  name: string;
  email: string;
  phone: string;
  social: string;
  socialAccount: string;
  position: string;
}

export interface ICustomer {
  id: string;
  company: string;
  contact: string;
  country: string;
  email: string;
  phone: string;
  source: string;
  level: CustomerLevel;
  status: CustomerStatus;
  note: string;
  products: string;
  contacts: ICustomerContact[];
  created_at: string;
  starred?: number;
  data_issues?: string;
}

export interface IFollowUp {
  id: string;
  customer_id: string;
  type: FollowUpType;
  content: string;
  next_follow_up_at: string;
  created_at: string;
}

export const CUSTOMER_STATUS_META: Record<CustomerStatus, { label: string; color: string }> = {
  lead: { label: '新线索', color: 'bg-gray-100 text-gray-600' },
  contacted: { label: '初步沟通', color: 'bg-blue-100 text-blue-700' },
  quoted: { label: '已报价', color: 'bg-amber-100 text-amber-700' },
  negotiating: { label: '谈判中', color: 'bg-orange-100 text-orange-700' },
  deal: { label: '已成交', color: 'bg-green-100 text-green-700' },
  lost: { label: '已流失', color: 'bg-gray-100 text-gray-500' },
};

export const CUSTOMER_LEVEL_META: Record<string, { label: string; color: string }> = {
  '': { label: '未分级', color: 'bg-gray-100 text-gray-500' },
  L0: { label: 'L0', color: 'bg-gray-100 text-gray-600' },
  L1: { label: 'L1', color: 'bg-blue-100 text-blue-700' },
  L2: { label: 'L2', color: 'bg-amber-100 text-amber-700' },
  L3: { label: 'L3', color: 'bg-orange-100 text-orange-700' },
  L4: { label: 'L4', color: 'bg-green-100 text-green-700' },
  '低质': { label: '低质', color: 'bg-red-100 text-red-700' },
  '优质': { label: '优质', color: 'bg-emerald-100 text-emerald-700' },
};

export const FOLLOWUP_TYPE_META: Record<FollowUpType, { label: string }> = {
  email: { label: '邮件' },
  whatsapp: { label: 'WhatsApp' },
  phone: { label: '电话' },
  visit: { label: '拜访' },
  other: { label: '其他' },
};
