import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, MessageSquare, Mail, Phone, Globe, MapPin, User, FileText, Pencil, Trash2, X, Check } from 'lucide-react';
import { api } from '@/data/api';
import type { ICustomer, ICustomerContact, IFollowUp, FollowUpType, CustomerLevel, CustomerStatus } from '@/data/types';
import { CUSTOMER_STATUS_META, CUSTOMER_LEVEL_META, FOLLOWUP_TYPE_META } from '@/data/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<ICustomer | null>(null);
  const [followups, setFollowups] = useState<IFollowUp[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [editing, setEditing] = useState(false);
  const [editingContacts, setEditingContacts] = useState(false);
  const [editForm, setEditForm] = useState<Partial<ICustomer>>({});
  const [contactsForm, setContactsForm] = useState<ICustomerContact[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<IFollowUp | null>(null);
  const [form, setForm] = useState({
    type: 'email' as FollowUpType,
    content: '',
    nextFollowUpAt: '',
  });

  const loadDetail = () => {
    if (!id) return;
    fetch(`/api/customers/${id}/detail`)
      .then((r) => r.json())
      .then((data) => {
        setCustomer(data.customer);
        setFollowups(data.followups);
      })
      .catch(console.error);
  };

  useEffect(() => {
    loadDetail();
  }, [id]);

  const handleAddFollowUp = async () => {
    if (!id || !form.content.trim()) {
      toast.error('请填写跟进内容');
      return;
    }
    try {
      await api.createFollowup({
        customer_id: id,
        type: form.type,
        content: form.content,
        next_follow_up_at: form.nextFollowUpAt,
        created_at: customTime || undefined,
      });
      setShowAddForm(false);
      setForm({ type: 'email', content: '', nextFollowUpAt: '' });
      setCustomTime('');
      toast.success('跟进记录已添加');
      loadDetail();
    } catch {
      toast.error('保存失败');
    }
  };

  const startEdit = () => {
    if (!customer) return;
    setEditForm({ ...customer });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!id || !editForm.company?.trim()) {
      toast.error('公司名称不能为空');
      return;
    }
    try {
      await api.updateCustomer(id, { ...editForm, contacts: customer.contacts || [] });
      setEditing(false);
      toast.success('基本信息已更新');
      loadDetail();
    } catch {
      toast.error('保存失败');
    }
  };

  const startEditContacts = () => {
    if (!customer) return;
    setContactsForm([...(customer.contacts || [])]);
    setEditingContacts(true);
  };

  const saveContacts = async () => {
    if (!id || !customer) return;
    try {
      await api.updateCustomer(id, { ...customer, contacts: contactsForm });
      setEditingContacts(false);
      toast.success('联系人已更新');
      loadDetail();
    } catch {
      toast.error('保存失败');
    }
  };

  const addContact = () => {
    setContactsForm([...contactsForm, { name: '', email: '', phone: '', social: '', socialAccount: '', position: '' }]);
  };

  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null);

  const removeContact = (idx: number) => {
    if (pendingDeleteIdx === idx) {
      setContactsForm(contactsForm.filter((_, i) => i !== idx));
      setPendingDeleteIdx(null);
    } else {
      setPendingDeleteIdx(idx);
    }
  };

  const updateContact = (idx: number, field: keyof ICustomerContact, value: string) => {
    const newContacts = [...contactsForm];
    newContacts[idx] = { ...newContacts[idx], [field]: value };
    setContactsForm(newContacts);
  };

  if (!customer) {
    return <div className="p-6 text-muted-foreground">加载中...</div>;
  }

  const contacts = editForm.contacts || customer.contacts || [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 返回按钮 */}
      <Button variant="ghost" onClick={() => navigate('/customers')} className="mb-4 pl-0">
        <ArrowLeft className="mr-2 h-4 w-4" />
        返回客户列表
      </Button>

      {/* 客户基本信息卡片 */}
      <Card className="mb-6 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            {editing ? (
              <Input
                value={editForm.company || ''}
                onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                className="text-xl font-semibold h-10"
              />
            ) : (
              <CardTitle className="text-xl">{customer.company}</CardTitle>
            )}
            <div className="flex gap-2 items-center">
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
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">国家</Label>
                  <Input
                    value={editForm.country || ''}
                    onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                    placeholder="国家"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">来源</Label>
                  <Select
                    value={editForm.source || '阿里巴巴国际站'}
                    onValueChange={(v) => setEditForm({ ...editForm, source: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="阿里巴巴国际站">阿里巴巴国际站</SelectItem>
                      <SelectItem value="展会">展会</SelectItem>
                      <SelectItem value="Google">Google</SelectItem>
                      <SelectItem value="其他">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">客户等级</Label>
                  <Select
                    value={editForm.level || ''}
                    onValueChange={(v) => setEditForm({ ...editForm, level: v as CustomerLevel })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择等级" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">未分级</SelectItem>
                      <SelectItem value="L0">L0</SelectItem>
                      <SelectItem value="L1">L1</SelectItem>
                      <SelectItem value="L2">L2</SelectItem>
                      <SelectItem value="L3">L3</SelectItem>
                      <SelectItem value="L4">L4</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">客户状态</Label>
                  <Select
                    value={editForm.status || 'lead'}
                    onValueChange={(v) => setEditForm({ ...editForm, status: v as CustomerStatus })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead">新线索</SelectItem>
                      <SelectItem value="contacted">初步沟通</SelectItem>
                      <SelectItem value="quoted">已报价未成交</SelectItem>
                      <SelectItem value="negotiating">谈判中</SelectItem>
                      <SelectItem value="deal">已成交</SelectItem>
                      <SelectItem value="lost">已流失</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">主要需要产品</Label>
                  <Input
                    value={editForm.products || ''}
                    onChange={(e) => setEditForm({ ...editForm, products: e.target.value })}
                    placeholder="如不锈钢餐具、保温杯..."
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
                  <Badge className={CUSTOMER_LEVEL_META[customer.level as keyof typeof CUSTOMER_LEVEL_META]?.color || ''} variant="secondary">
                    {CUSTOMER_LEVEL_META[customer.level as keyof typeof CUSTOMER_LEVEL_META]?.label || customer.level || '未分级'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={CUSTOMER_STATUS_META[customer.status as keyof typeof CUSTOMER_STATUS_META]?.color || ''} variant="secondary">
                    {CUSTOMER_STATUS_META[customer.status as keyof typeof CUSTOMER_STATUS_META]?.label || customer.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 md:col-span-2">
                  <span className="text-muted-foreground">主要产品：</span>
                  <span>{customer.products || '-'}</span>
                </div>
                <div className="flex items-center gap-2 md:col-span-2">
                  <span className="text-muted-foreground">创建时间：</span>
                  <span>{customer.created_at ? customer.created_at.slice(0, 10) : '-'}</span>
                </div>
              </>
            )}
            {editing ? (
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs text-muted-foreground">备注</Label>
                <Textarea
                  value={editForm.note || ''}
                  onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                  placeholder="客户备注..."
                  rows={2}
                />
              </div>
            ) : (
              customer.note && (
                <div className="flex items-start gap-2 md:col-span-2">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <span className="text-muted-foreground">{customer.note}</span>
                </div>
              )
            )}
          </div>
        </CardContent>
      </Card>

      {/* 联系人卡片 */}
      <Card className="mb-6 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">联系人 ({contacts.length})</CardTitle>
            {editingContacts ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={addContact}>
                  <Plus className="mr-1 h-4 w-4" />
                  添加联系人
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingContacts(false)}>
                  取消
                </Button>
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
                          onChange={(e) => updateContact(idx, 'name', e.target.value)}
                          placeholder="姓名"
                          className="h-8"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            value={contact.email}
                            onChange={(e) => updateContact(idx, 'email', e.target.value)}
                            placeholder="邮箱"
                            className="h-8"
                          />
                          <Input
                            value={contact.phone}
                            onChange={(e) => updateContact(idx, 'phone', e.target.value)}
                            placeholder="电话"
                            className="h-8"
                          />
                          <Input
                            value={contact.position}
                            onChange={(e) => updateContact(idx, 'position', e.target.value)}
                            placeholder="职位"
                            className="h-8"
                          />
                          <Select
                            value={contact.social || ''}
                            onValueChange={(v) => updateContact(idx, 'social', v)}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="社交软件" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">无</SelectItem>
                              <SelectItem value="wechat">微信</SelectItem>
                              <SelectItem value="whatsapp">WhatsApp</SelectItem>
                            </SelectContent>
                          </Select>
                          {contact.social && (
                            <Input
                              value={contact.socialAccount || ''}
                              onChange={(e) => updateContact(idx, 'socialAccount', e.target.value)}
                              placeholder={`${contact.social === 'wechat' ? '微信号' : 'WhatsApp账号'}`}
                              className="h-8 col-span-2"
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
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
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
                              {contact.social === 'wechat' ? '微信' : 'WhatsApp'}
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
                      variant={pendingDeleteIdx === idx ? "destructive" : "ghost"}
                      className="h-8 text-xs"
                      onClick={() => removeContact(idx)}
                    >
                      {pendingDeleteIdx === idx ? '确认删除？' : <Trash2 className="h-4 w-4" />}
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
        <Button size="sm" onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="mr-2 h-4 w-4" />
          添加跟进
        </Button>
      </div>

      {/* 添加跟进表单 */}
      {showAddForm && (
        <Card className="mb-4 border-primary/20 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">跟进方式</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm({ ...form, type: v as FollowUpType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">邮件</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="phone">电话</SelectItem>
                    <SelectItem value="visit">拜访</SelectItem>
                    <SelectItem value="other">其他</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">跟进时间（留空=现在）</Label>
                <Input
                  type="datetime-local"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">下次跟进时间</Label>
                <Input
                  type="date"
                  value={form.nextFollowUpAt}
                  onChange={(e) => setForm({ ...form, nextFollowUpAt: e.target.value })}
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
              <Button variant="outline" size="sm" onClick={() => setShowAddForm(false)}>取消</Button>
              <Button size="sm" onClick={handleAddFollowUp}>保存</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 跟进时间线 */}
      <div className="space-y-3">
        {followups.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
            还没有跟进记录，点击上方"添加跟进"开始记录
          </div>
        ) : (
          <>
          {(expanded ? followups : followups.slice(0, 5)).map((f, idx) => (
            <div key={f.id} className="flex gap-4">
              {/* 时间线竖线 */}
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-4 w-4 text-primary" />
                </div>
                {idx < followups.length - 1 && (
                  <div className="w-px flex-1 bg-border mt-2" />
                )}
              </div>
              {/* 内容 */}
              <div className="flex-1 pb-4 group">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">
                    {FOLLOWUP_TYPE_META[f.type as FollowUpType]?.label || f.type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {f.created_at ? new Date(f.created_at).toLocaleString('zh-CN') : ''}
                  </span>
                  <button
                    onClick={() => setDeleteTarget(f)}
                    className="ml-auto opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    删除
                  </button>
                </div>
                <p className="text-sm">{f.content}</p>
                {f.next_follow_up_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    下次跟进：{new Date(f.next_follow_up_at).toLocaleDateString('zh-CN')}
                  </p>
                )}
              </div>
            </div>
          ))}
          {followups.length > 5 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full py-2 text-sm text-muted-foreground hover:text-foreground border border-dashed rounded-lg"
            >
              {expanded ? '收起' : `展开全部 ${followups.length} 条记录`}
            </button>
          )}
          </>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-lg p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-2">确认删除</h3>
            <p className="text-sm text-muted-foreground mb-4">
              确定要删除这条跟进记录吗？删除后无法恢复。
            </p>
            <div className="text-sm bg-muted/50 rounded p-3 mb-4 line-clamp-2">
              {deleteTarget.content}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  try {
                    await api.deleteFollowup(deleteTarget.id);
                    toast.success('已删除');
                    setDeleteTarget(null);
                    loadDetail();
                  } catch {
                    toast.error('删除失败');
                  }
                }}
              >
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
