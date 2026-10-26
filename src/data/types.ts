// EXPORTS: ICustomer, IFollowUp, CustomerLevel, CustomerStatus, FollowUpType, CUSTOMER_STATUS_META, CUSTOMER_LEVEL_META, FOLLOWUP_TYPE_META

export type CustomerLevel = '' | 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | '1星' | '2星' | '3星' | '4星' | '5星' | '低质' | '优质';
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
  /** 后端已规范为字符串数组（历史数据可能是 JSON 字符串，用 parseIssues 兼容） */
  data_issues?: string[] | string;
  /** 列表接口附带：最近一条跟进时间 */
  last_followup_at?: string;
  /** 乐观锁：上次更新时间，更新时回传给后端校验 */
  updated_at?: string;
}

export interface IFollowUp {
  id: string;
  customer_id: string;
  type: FollowUpType;
  content: string;
  next_follow_up_at: string;
  created_at: string;
  /** 乐观锁：上次更新时间，更新时回传给后端校验 */
  updated_at?: string;
}

export const CUSTOMER_STATUS_META: Record<CustomerStatus, { label: string; color: string }> = {
  lead: { label: '新线索', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  contacted: { label: '初步沟通', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  quoted: { label: '已报价', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  negotiating: { label: '谈判中', color: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  deal: { label: '成交客户', color: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
  lost: { label: '已流失', color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
};

export const CUSTOMER_LEVEL_META: Record<string, { label: string; color: string }> = {
  '': { label: '未分级', color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  // 阿里专用等级
  L0: { label: 'L0', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  L1: { label: 'L1', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  L2: { label: 'L2', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  L3: { label: 'L3', color: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  L4: { label: 'L4', color: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
  // 通用星级
  '1星': { label: '1星', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  '2星': { label: '2星', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  '3星': { label: '3星', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  '4星': { label: '4星', color: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  '5星': { label: '5星', color: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
  // 旧等级展示兼容
  '低质': { label: '1星', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  '优质': { label: '5星', color: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
};

export const FOLLOWUP_TYPE_META: Record<FollowUpType, { label: string }> = {
  email: { label: '邮件' },
  whatsapp: { label: 'WhatsApp' },
  phone: { label: '电话' },
  visit: { label: '拜访' },
  other: { label: '其他' },
};
