import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, MessageSquare, Mail, Phone, MapPin, Globe, User,
  FileText, Pencil, Trash2, X, Check, Star, AlertTriangle,
} from 'lucide-react';
import { api } from '@/data/api';
import type {
  ICustomer, ICustomerContact, IFollowUp, FollowUpType, CustomerLevel, CustomerStatus,
} from '@/data/types';
import { CUSTOMER_STATUS_META, CUSTOMER_LEVEL_META, FOLLOWUP_TYPE_META } from '@/data/types';
import {
  CUSTOMER_LEVELS, FOLLOWUP_TYPES, STATUS_LABELS, LEVEL_LABELS, SOCIAL_LABELS, parseIssues,
} from '@/data/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { handleConflictError } from '@/lib/conflict';

/** 后端 'YYYY-MM-DD HH:MM:SS' -> Date（Safari 不认空格格式，必须替换成 T） */
function parseDt(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const emptyContact: ICustomerContact = {
  name: '', email: '', phone: '', social: '', socialAccount: '', position: '',
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<ICustomer | null>(null);
  const [followups, setFollowups] = useState<IFollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // 基本信息编辑
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<ICustomer>>({});
  // 联系人编辑
  const [editingContacts, setEditingContacts] = useState(false);
  const [contactsForm, setContactsForm] = useState<ICustomerContact[]>([]);
  // 跟进
  const [showAddForm, setShowAddForm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [editingFollowUp, setEditingFollowUp] = useState<IFollowUp | null>(null);
  const [deleteFollowUpTarget, setDeleteFollowUpTarget] = useState<IFollowUp | null>(null);
  const [pendingDeleteContact, setPendingDeleteContact] = useState<number | null>(null);
  const [form, setForm] = useState({
    type: 'email' as FollowUpType, content: '', nextFollowUpAt: '',
  });

  const loadDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api.customerDetail(id);
      setCustomer(data.customer);
      setFollowups(data.followups);
      setNotFound(false);
    } catch (e) {
      if (e instanceof Error && e.message.includes('404')) setNotFound(true);
      else toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    // 异步回调里 setState 是 React 推荐的加载模式；
    // 这里用 queueMicrotask 包一层，明确脱离同步渲染阶段
    const t = setTimeout(() => {
      setLoading(true);
      api.customerDetail(id)
        .then((data) => {
          setCustomer(data.customer);
          setFollowups(data.followups);
          setNotFound(false);
        })
        .catch((e) => {
          if (e instanceof Error && e.message.includes('404')) setNotFound(true);
          else toast.error('加载失败');
        })
        .finally(() => setLoading(false));
    }, 0);

    // 离开页面时重置编辑态，避免下次进入残留
    return () => {
      clearTimeout(t);
      setEditing(false);
      setEditingContacts(false);
      setShowAddForm(false);
      setExpanded(false);
    };
  }, [id]);

  // 标签页聚焦时自动刷新
  useRefreshOnFocus(loadDetail);

  if (notFound) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <Button variant="ghost" onClick={() => navigate('/customers')} className="mb-4 pl-0">
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回客户列表
        </Button>
        <p className="text-muted-foreground">客户不存在或已被删除。</p>
      </div>
    );
  }

  if (!customer) {
    return <div className="p-6 text-muted-foreground text-sm">加载中…</div>;
  }

  const issues = parseIssues(customer.data_issues);

  // ---- 基本信息 ----
  const startEdit = () => {
    setEditForm({
      company: customer.company,
      contact: customer.contact,
      country: customer.country,
      email: customer.email,
      phone: customer.phone,
      source: customer.source,
      level: customer.level,
      status: customer.status,
      note: customer.note,
      products: customer.products,
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!id || !editForm.company?.trim()) {
      toast.error('公司名称不能为空');
      return;
    }
    try {
      // 只提交基本信息字段，联系人单独走 saveContacts，避免互相覆盖
      await api.updateCustomer(id, {
        company: editForm.company,
        contact: editForm.contact ?? '',
        country: editForm.country ?? '',
        email: editForm.email ?? '',
        phone: editForm.phone ?? '',
        source: editForm.source ?? '',
        level: editForm.level as CustomerLevel,
        status: editForm.status as CustomerStatus,
        note: editForm.note ?? '',
        products: editForm.products ?? '',
        contacts: customer.contacts ?? [],
        starred: customer.starred ?? 0,
        updated_at: customer.updated_at, // 乐观锁
      });
      setEditing(false);
      toast.success('基本信息已更新');
      loadDetail();
    } catch (e) {
      if (!handleConflictError(e, loadDetail)) {
        toast.error(e instanceof Error ? e.message : '保存失败');
      }
    }
  };

  // ---- 联系人 ----
  const startEditContacts = () => {
    setContactsForm([...(customer.contacts || [])]);
    setEditingContacts(true);
    setPendingDeleteContact(null);
  };

  const saveContacts = async () => {
    if (!id) return;
    try {
      await api.updateCustomer(id, { ...customer, contacts: contactsForm, updated_at: customer.updated_at });
      setEditingContacts(false);
      toast.success('联系人已更新');
      loadDetail();
    } catch (e) {
      if (!handleConflictError(e, loadDetail)) {
        toast.error(e instanceof Error ? e.message : '保存失败');
      }
    }
  };

  const addContact = () =>
    setContactsForm((prev) => [...prev, { ...emptyContact }]);

  const removeContact = (idx: number) => {
    if (pendingDeleteContact === idx) {
      setContactsForm((prev) => prev.filter((_, i) => i !== idx));
      setPendingDeleteContact(null);
    } else {
      setPendingDeleteContact(idx);
    }
  };

  const updateContact = (idx: number, patch: Partial<ICustomerContact>) =>
    setContactsForm((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });

  // ---- 星标 ----
  const toggleStar = async () => {
    if (!id) return;
    const next = customer.starred ? 0 : 1;
    setCustomer({ ...customer, starred: next });
    try {
      await api.updateCustomer(id, { ...customer, starred: next, updated_at: customer.updated_at });
    } catch (e) {
      setCustomer({ ...customer, starred: customer.starred });
      if (!handleConflictError(e, loadDetail)) {
        toast.error('操作失败');
      }
    }
  };

  // ---- 跟进 ----
  const submitFollowUp = async () => {
    if (!id || !form.content.trim()) {
      toast.error('请填写跟进内容');
      return;
    }
    try {
      if (editingFollowUp) {
        await api.updateFollowup(editingFollowUp.id, {
          type: form.type,
          content: form.content,
          next_follow_up_at: form.nextFollowUpAt,
          created_at: customTime || editingFollowUp.created_at,
          updated_at: editingFollowUp.updated_at, // 乐观锁
        });
        toast.success('跟进记录已更新');
        setEditingFollowUp(null);
      } else {
        await api.createFollowup({
          customer_id: id,
          type: form.type,
          content: form.content,
          next_follow_up_at: form.nextFollowUpAt,
          created_at: customTime || undefined,
        });
        toast.success('跟进记录已添加');
      }
      setShowAddForm(false);
      setForm({ type: 'email', content: '', nextFollowUpAt: '' });
      setCustomTime('');
      loadDetail();
    } catch (e) {
      if (!handleConflictError(e, loadDetail)) {
        toast.error(e instanceof Error ? e.message : '保存失败');
      }
    }
  };

  const openEditFollowUp = (f: IFollowUp) => {
    setEditingFollowUp(f);
    setForm({ type: f.type, content: f.content, nextFollowUpAt: f.next_follow_up_at || '' });
    setCustomTime(f.created_at ? f.created_at.slice(0, 16) : '');
    setShowAddForm(true);
  };

  const confirmDeleteFollowUp = async () => {
    if (!deleteFollowUpTarget) return;
    try {
      await api.deleteFollowup(deleteFollowUpTarget.id);
      toast.success('已删除');
      setDeleteFollowUpTarget(null);
      loadDetail();
    } catch {
      toast.error('删除失败');
    }
  };

  const contacts = customer.contacts || [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Button variant="ghost" onClick={() => navigate('/customers')} className="mb-4 pl-0">
        <ArrowLeft className="mr-2 h-4 w-4" />
        返回客户列表
      </Button>

      {/* 数据问题提醒 */}
      {issues.length > 0 && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <div className="text-sm text-red-700 dark:text-red-300">
            <p className="font-medium">该客户数据存在问题：</p>
            <ul className="list-disc list-inside mt-1">
              {issues.map((i, idx) => <li key={idx}>{i}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* 基本信息 */}
      <Card className="mb-6 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {editing ? (
              <Input
                value={editForm.company || ''}
                onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                className="text-xl font-semibold h-10 max-w-sm"
                aria-label="公司名称"
              />
            ) : (
              <CardTitle className="text-xl">{customer.company}</CardTitle>
            )}
            <div className="flex gap-2 items-center">
              <button
                onClick={toggleStar}
                className="p-1.5 hover:bg-muted rounded"
                aria-label="星标"
              >
                <Star className={`h-5 w-5 ${customer.starred ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
              </button>
              {editing ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                    <X className="mr-1 h-4 w-4" />
                    取消
                  </Button>
                  <Button size="sm" onClick={saveEdit}>
                    <Check className="mr-1 h-4 w-4" />
                    保存
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={startEdit}>
                  <Pencil className="mr-1 h-4 w-4" />
                  编辑
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {editing ? (
              <>
                <Field label="国家">
                  <Input
                    value={editForm.country || ''}
                    onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                    placeholder="国家"
                    aria-label="国家"
                  />
                </Field>
                <Field label="联系人">
                  <Input
                    value={editForm.contact || ''}
                    onChange={(e) => setEditForm({ ...editForm, contact: e.target.value })}
                    aria-label="联系人"
                  />
                </Field>
                <Field label="邮箱">
                  <Input
                    type="email"
                    value={editForm.email || ''}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    aria-label="邮箱"
                  />
                </Field>
                <Field label="电话">
                  <Input
                    value={editForm.phone || ''}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    aria-label="电话"
                  />
                </Field>
                <Field label="来源">
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={editForm.source || ''}
                    onChange={(e) => setEditForm({ ...editForm, source: e.target.value })}
                    aria-label="来源"
                  >
                    {['阿里巴巴国际站', '展会', 'Google', '其他'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="客户等级">
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={editForm.level || ''}
                    onChange={(e) => setEditForm({ ...editForm, level: e.target.value as CustomerLevel })}
                    aria-label="客户等级"
                  >
                    {CUSTOMER_LEVELS.map((l) => (
                      <option key={l || 'none'} value={l}>{LEVEL_LABELS[l] ?? l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="客户状态">
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={editForm.status || 'lead'}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value as CustomerStatus })}
                    aria-label="客户状态"
                  >
                    {Object.entries(STATUS_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="主要需要产品">
                  <Input
                    value={editForm.products || ''}
                    onChange={(e) => setEditForm({ ...editForm, products: e.target.value })}
                    placeholder="如不锈钢餐具、保温杯..."
                    aria-label="主要需要产品"
                  />
                </Field>
                <div className="md:col-span-2">
                  <Label className="text-xs text-muted-foreground">备注</Label>
                  <Textarea
                    value={editForm.note || ''}
                    onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                    placeholder="客户备注..."
                    rows={2}
                    className="mt-1"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{customer.country || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span>来源：{customer.source || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    className={CUSTOMER_LEVEL_META[customer.level as keyof typeof CUSTOMER_LEVEL_META]?.color || ''}
                    variant="secondary"
                  >
                    {CUSTOMER_LEVEL_META[customer.level as keyof typeof CUSTOMER_LEVEL_META]?.label || customer.level || '未分级'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    className={CUSTOMER_STATUS_META[customer.status as keyof typeof CUSTOMER_STATUS_META]?.color || ''}
                    variant="secondary"
                  >
                    {CUSTOMER_STATUS_META[customer.status as keyof typeof CUSTOMER_STATUS_META]?.label || customer.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{customer.email || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{customer.phone || '-'}</span>
                </div>
                <div className="flex items-start gap-2 md:col-span-2">
                  <span className="text-muted-foreground shrink-0">主要产品：</span>
                  <span>{customer.products || '-'}</span>
                </div>
                <div className="flex items-center gap-2 md:col-span-2">
                  <span className="text-muted-foreground">创建时间：</span>
                  <span>{customer.created_at ? customer.created_at.slice(0, 10) : '-'}</span>
                </div>
                {customer.note && (
                  <div className="flex items-start gap-2 md:col-span-2">
                    <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <span className="text-muted-foreground whitespace-pre-wrap">{customer.note}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 联系人 */}
      <Card className="mb-6 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">联系人 ({contacts.length})</CardTitle>
            {editingContacts ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={addContact}>
                  <Plus className="mr-1 h-4 w-4" />
                  添加联系人
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingContacts(false)}>取消</Button>
                <Button size="sm" onClick={saveContacts}>
                  <Check className="mr-1 h-4 w-4" />
                  保存
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={startEditContacts}>
                <Pencil className="mr-1 h-4 w-4" />
                编辑联系人
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 && !editingContacts ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              还没有联系人，点击右上角"编辑联系人"添加
            </div>
          ) : (
            <div className="space-y-3">
              {(editingContacts ? contactsForm : contacts).map((contact, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/30">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 space-y-1">
                    {editingContacts ? (
                      <>
                        <Input
                          value={contact.name}
                          onChange={(e) => updateContact(idx, { name: e.target.value })}
                          placeholder="姓名"
                          className="h-8"
                          aria-label={`联系人${idx + 1}姓名`}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            value={contact.email}
                            onChange={(e) => updateContact(idx, { email: e.target.value })}
                            placeholder="邮箱"
                            className="h-8"
                            aria-label={`联系人${idx + 1}邮箱`}
                          />
                          <Input
                            value={contact.phone}
                            onChange={(e) => updateContact(idx, { phone: e.target.value })}
                            placeholder="电话"
                            className="h-8"
                            aria-label={`联系人${idx + 1}电话`}
                          />
                          <Input
                            value={contact.position}
                            onChange={(e) => updateContact(idx, { position: e.target.value })}
                            placeholder="职位"
                            className="h-8"
                            aria-label={`联系人${idx + 1}职位`}
                          />
                          <select
                            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                            value={contact.social || ''}
                            onChange={(e) => updateContact(idx, { social: e.target.value })}
                            aria-label={`联系人${idx + 1}社交软件`}
                          >
                            <option value="">无</option>
                            {Object.entries(SOCIAL_LABELS).map(([v, label]) => (
                              <option key={v} value={v}>{label}</option>
                            ))}
                          </select>
                          {contact.social && (
                            <Input
                              value={contact.socialAccount || ''}
                              onChange={(e) => updateContact(idx, { socialAccount: e.target.value })}
                              placeholder={contact.social === 'wechat' ? '微信号' : 'WhatsApp账号'}
                              className="h-8 col-span-2"
                              aria-label={`联系人${idx + 1}社交账号`}
                            />
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{contact.name || '未命名'}</span>
                          {contact.position && (
                            <span className="text-xs text-muted-foreground">({contact.position})</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                          {contact.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {contact.email}
                            </span>
                          )}
                          {contact.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {contact.phone}
                            </span>
                          )}
                          {contact.social && (
                            <span className="flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              {SOCIAL_LABELS[contact.social] || contact.social}
                              {contact.socialAccount && `: ${contact.socialAccount}`}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {editingContacts && (
                    <Button
                      size="sm"
                      variant={pendingDeleteContact === idx ? 'destructive' : 'ghost'}
                      className="h-8 text-xs"
                      onClick={() => removeContact(idx)}
                    >
                      {pendingDeleteContact === idx ? '确认删除？' : <Trash2 className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 跟进记录 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">跟进记录 ({followups.length})</h2>
        <Button
          size="sm"
          variant={showAddForm ? 'outline' : 'default'}
          onClick={() => {
            if (showAddForm) {
              setShowAddForm(false);
              setEditingFollowUp(null);
              setForm({ type: 'email', content: '', nextFollowUpAt: '' });
              setCustomTime('');
            } else {
              setEditingFollowUp(null);
              setForm({ type: 'email', content: '', nextFollowUpAt: '' });
              setCustomTime('');
              setShowAddForm(true);
            }
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          添加跟进
        </Button>
      </div>

      {showAddForm && (
        <Card className="mb-4 border-primary/20 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">跟进方式</Label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as FollowUpType })}
                  aria-label="跟进方式"
                >
                  {FOLLOWUP_TYPES.map((t) => (
                    <option key={t} value={t}>{FOLLOWUP_TYPE_META[t as FollowUpType].label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">跟进时间（留空=现在）</Label>
                <Input
                  type="datetime-local"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                  aria-label="跟进时间"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">下次跟进时间</Label>
                <Input
                  type="date"
                  value={form.nextFollowUpAt}
                  onChange={(e) => setForm({ ...form, nextFollowUpAt: e.target.value })}
                  aria-label="下次跟进时间"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">跟进内容</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="记录沟通内容、客户反馈、下一步计划..."
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingFollowUp(null);
                }}
              >
                取消
              </Button>
              <Button size="sm" onClick={submitFollowUp}>
                {editingFollowUp ? '保存修改' : '保存'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 时间线 */}
      <div className="space-y-3">
        {followups.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm border border-dashed rounded-lg">
            还没有跟进记录，点击上方"添加跟进"开始记录
          </div>
        ) : (
          <>
            {(expanded ? followups : followups.slice(0, 5)).map((f, idx) => {
              const dt = parseDt(f.created_at);
              const next = parseDt(f.next_follow_up_at);
              return (
                <div key={f.id} className="flex gap-4 group">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <MessageSquare className="h-4 w-4 text-primary" />
                    </div>
                    {idx < followups.length - 1 && <div className="w-px flex-1 bg-border mt-2" />}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">
                        {FOLLOWUP_TYPE_META[f.type as FollowUpType]?.label || f.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {dt ? dt.toLocaleString('zh-CN') : f.created_at}
                      </span>
                      <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditFollowUp(f)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => setDeleteFollowUpTarget(f)}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{f.content}</p>
                    {next && (
                      <p className="text-xs text-muted-foreground mt-1">
                        下次跟进：{next.toLocaleDateString('zh-CN')}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            {followups.length > 5 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full py-2 text-sm text-muted-foreground hover:text-foreground border border-dashed rounded-lg"
              >
                {expanded ? '收起' : `展开全部 ${followups.length} 条记录`}
              </button>
            )}
          </>
        )}
      </div>

      {/* 删除跟进确认 */}
      {deleteFollowUpTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-lg p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-2">确认删除</h3>
            <p className="text-sm text-muted-foreground mb-4">确定要删除这条跟进记录吗？删除后无法恢复。</p>
            <div className="text-sm bg-muted/50 rounded p-3 mb-4 line-clamp-3">{deleteFollowUpTarget.content}</div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteFollowUpTarget(null)}>取消</Button>
              <Button variant="destructive" size="sm" onClick={confirmDeleteFollowUp}>确认删除</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
