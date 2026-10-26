import { useEffect, useRef, useState } from 'react';
import type { ICustomer, ICustomerContact, CustomerLevel, CustomerStatus } from '@/data/types';
import { COUNTRIES } from '@/data/countries';
import { CUSTOMER_LEVELS, CUSTOMER_SOURCES, STATUS_LABELS, SOCIAL_LABELS } from '@/data/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

export interface CustomerForm {
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
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ICustomer | null;
  form: CustomerForm;
  setForm: (fn: (prev: CustomerForm) => CustomerForm) => void;
  onSubmit: () => void;
  /** 编辑模式下的删除入口（行内删除按钮已移除，统一并入这里） */
  onDelete?: () => void;
}

const emptyContact: ICustomerContact = {
  name: '', email: '', phone: '', social: '', socialAccount: '', position: '',
};

/** 国家输入框：带联想下拉，值不在列表内时提示将自动设为"未知" */
function CountryInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const matches = value && !COUNTRIES.includes(value)
    ? COUNTRIES.filter((c) => c.includes(value))
    : [];

  return (
    <div className="relative" ref={ref}>
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="输入搜索国家..."
        aria-label="国家"
      />
      {open && matches.length > 0 && (
        <div className="absolute top-full mt-1 w-full bg-card border border-border rounded-md shadow-lg z-10 max-h-48 overflow-y-auto">
          {matches.map((c) => (
            <div
              key={c}
              className="px-3 py-2 text-sm hover:bg-muted cursor-pointer"
              onClick={() => { onChange(c); setOpen(false); }}
            >
              {c}
            </div>
          ))}
        </div>
      )}
      {open && value && !COUNTRIES.includes(value) && matches.length === 0 && (
        <div className="absolute top-full mt-1 w-full bg-card border border-border rounded-md shadow-lg z-10 px-3 py-2 text-sm text-muted-foreground">
          未找到匹配国家，将自动设为"未知"
        </div>
      )}
    </div>
  );
}

/** 来源输入框：可自由输入，聚焦时下拉展示全部预设（阿里巴巴国际站/展会/Google/其他），打字过滤联想 */
export function SourceInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // 联想：按输入过滤预设；无输入时展示全部
  const matches = value
    ? CUSTOMER_SOURCES.filter((s) => s.includes(value) && s !== value)
    : [...CUSTOMER_SOURCES];

  return (
    <div className="relative" ref={ref}>
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="点击选择或直接输入，如 展会名片（可留空）"
        aria-label="来源"
      />
      {open && matches.length > 0 && (
        <div className="absolute top-full mt-1 w-full bg-card border border-border rounded-md shadow-lg z-10 max-h-48 overflow-y-auto">
          {matches.map((s) => (
            <div
              key={s}
              className="px-3 py-2 text-sm hover:bg-muted cursor-pointer"
              onMouseDown={(e) => { e.preventDefault(); onChange(s); setOpen(false); }}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CustomerFormDialog({
  open, onOpenChange, editing, form, setForm, onSubmit, onDelete,
}: Props) {
  const update = (patch: Partial<CustomerForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const updateContact = (idx: number, patch: Partial<ICustomerContact>) =>
    setForm((prev) => {
      const contacts = [...prev.contacts];
      contacts[idx] = { ...contacts[idx], ...patch };
      return { ...prev, contacts };
    });

  const addContact = () =>
    setForm((prev) => ({ ...prev, contacts: [...prev.contacts, { ...emptyContact }] }));

  const removeContact = (idx: number) =>
    setForm((prev) => ({ ...prev, contacts: prev.contacts.filter((_, i) => i !== idx) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑客户' : '新增客户'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="company">公司名称 *</Label>
            <Input
              id="company"
              value={form.company}
              onChange={(e) => update({ company: e.target.value })}
              placeholder="例如：ABC Trading Co."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="contact">联系人</Label>
              <Input
                id="contact"
                value={form.contact}
                onChange={(e) => update({ contact: e.target.value })}
                placeholder="张三"
              />
            </div>
            <div className="grid gap-2">
              <Label>国家</Label>
              <CountryInput value={form.country} onChange={(v) => update({ country: v })} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => update({ email: e.target.value })}
                placeholder="info@example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">电话</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => update({ phone: e.target.value })}
                placeholder="+1 555-0100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label>客户等级</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.level}
                onChange={(e) => update({ level: e.target.value as CustomerLevel })}
                aria-label="客户等级"
              >
                {CUSTOMER_LEVELS.map((l) => (
                  <option key={l || 'none'} value={l}>{l || '未分级'}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>状态</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.status}
                onChange={(e) => update({ status: e.target.value as CustomerStatus })}
                aria-label="状态"
              >
                {Object.entries(STATUS_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="source">来源</Label>
              {/* 可输入联想框：既能打字又能点选预设，无模式切换 */}
              <SourceInput value={form.source} onChange={(v) => update({ source: v })} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="products">主要需要产品</Label>
            <Input
              id="products"
              value={form.products}
              onChange={(e) => update({ products: e.target.value })}
              placeholder="如不锈钢餐具、保温杯..."
            />
          </div>

          {/* 多联系人 */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>联系人明细（{form.contacts.length}）</Label>
              <Button type="button" variant="outline" size="sm" onClick={addContact}>
                添加联系人
              </Button>
            </div>
            {form.contacts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                未添加明细联系人时，将自动用上方的"联系人/邮箱/电话"创建第一个联系人。
              </p>
            )}
            {form.contacts.map((c, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-lg border border-border bg-muted/30">
                <Input
                  value={c.name}
                  onChange={(e) => updateContact(idx, { name: e.target.value })}
                  placeholder="姓名"
                  aria-label={`联系人${idx + 1}姓名`}
                />
                <Input
                  value={c.position}
                  onChange={(e) => updateContact(idx, { position: e.target.value })}
                  placeholder="职位"
                  aria-label={`联系人${idx + 1}职位`}
                />
                <Input
                  value={c.email}
                  onChange={(e) => updateContact(idx, { email: e.target.value })}
                  placeholder="邮箱"
                  aria-label={`联系人${idx + 1}邮箱`}
                />
                <Input
                  value={c.phone}
                  onChange={(e) => updateContact(idx, { phone: e.target.value })}
                  placeholder="电话"
                  aria-label={`联系人${idx + 1}电话`}
                />
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={c.social}
                  onChange={(e) => updateContact(idx, { social: e.target.value })}
                  aria-label={`联系人${idx + 1}社交软件`}
                >
                  <option value="">无社交软件</option>
                  {Object.entries(SOCIAL_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
                {c.social && (
                  <Input
                    value={c.socialAccount}
                    onChange={(e) => updateContact(idx, { socialAccount: e.target.value })}
                    placeholder={c.social === 'wechat' ? '微信号' : 'WhatsApp账号'}
                    aria-label={`联系人${idx + 1}社交账号`}
                  />
                )}
                <div className="sm:col-span-2 flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeContact(idx)}>
                    移除
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="note">备注</Label>
            <Textarea
              id="note"
              value={form.note}
              onChange={(e) => update({ note: e.target.value })}
              placeholder="客户偏好、沟通要点..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {/* 编辑模式：左侧删除入口（危险操作，二次确认在父级处理） */}
          {editing && onDelete ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={onDelete}
            >
              删除该客户
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={onSubmit}>保存</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
