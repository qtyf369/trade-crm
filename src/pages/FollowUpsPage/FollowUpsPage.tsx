import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, MessageSquare, Trash2, Pencil, Check, X, RefreshCw } from 'lucide-react';
import { api } from '@/data/api';
import type { ICustomer, IFollowUp, FollowUpType } from '@/data/types';
import { FOLLOWUP_TYPE_META } from '@/data/types';
import { FOLLOWUP_TYPES } from '@/data/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { handleConflictError } from '@/lib/conflict';

/** 后端时间格式是 'YYYY-MM-DD HH:MM:SS'，new Date 需要先转成 ISO */
function parseDt(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function FollowUpsPage() {
  const navigate = useNavigate();
  const [followups, setFollowups] = useState<IFollowUp[]>([]);
  const [total, setTotal] = useState(0);
  const [customerMap, setCustomerMap] = useState<Record<string, ICustomer>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IFollowUp | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IFollowUp | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    customerId: '', type: 'email' as FollowUpType, content: '', nextFollowUpAt: '', createdAt: '',
  });

  // 分页
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadFollowups = useCallback(() => {
    setLoading(true);
    api.listFollowups({ page, page_size: pageSize })
      .then((r) => {
        setFollowups(r.items);
        setTotal(r.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, pageSize]);

  useEffect(() => {
    loadFollowups();
  }, [loadFollowups]);

  // 客户列表只需加载一次
  useEffect(() => {
    api.listCustomers({ page: 1, page_size: 500 })
      .then((c) => {
        const map: Record<string, ICustomer> = {};
        c.items.forEach((x) => { map[x.id] = x; });
        setCustomerMap(map);
      })
      .catch(() => {});
  }, []);

  const reload = () => {
    loadFollowups();
  };

  // 标签页聚焦时自动刷新
  useRefreshOnFocus(reload);

  // 挂载时取一次时间基准
  const [nowTs] = useState(() => Date.now());

  const stats = useMemo(() => {
    const today = new Date(nowTs).toDateString();
    const weekAgo = nowTs - 7 * 86400000;
    let todayCount = 0;
    let weekCount = 0;
    for (const f of followups) {
      const d = parseDt(f.created_at);
      if (!d) continue;
      if (d.toDateString() === today) todayCount++;
      if (d.getTime() >= weekAgo) weekCount++;
    }
    return { todayCount, weekCount, total };
  }, [followups, nowTs, total]);

  const openAdd = () => {
    setEditing(null);
    setForm({
      customerId: Object.keys(customerMap)[0] || '',
      type: 'email', content: '', nextFollowUpAt: '', createdAt: '',
    });
    setDialogOpen(true);
  };

  const openEdit = (f: IFollowUp) => {
    setEditing(f);
    setForm({
      customerId: f.customer_id,
      type: f.type,
      content: f.content,
      nextFollowUpAt: f.next_follow_up_at || '',
      createdAt: f.created_at ? f.created_at.slice(0, 16) : '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.customerId) return toast.error('请选择客户');
    if (!form.content.trim()) return toast.error('跟进内容不能为空');
    try {
      if (editing) {
        await api.updateFollowup(editing.id, {
          customer_id: form.customerId,
          type: form.type,
          content: form.content,
          next_follow_up_at: form.nextFollowUpAt,
          created_at: form.createdAt || undefined,
          updated_at: editing.updated_at, // 乐观锁
        });
        toast.success('跟进记录已更新');
      } else {
        await api.createFollowup({
          customer_id: form.customerId,
          type: form.type,
          content: form.content,
          next_follow_up_at: form.nextFollowUpAt,
          created_at: form.createdAt || undefined,
        });
        toast.success('跟进记录已添加');
      }
      setDialogOpen(false);
      reload();
    } catch (e) {
      if (!handleConflictError(e, reload)) {
        toast.error(e instanceof Error ? e.message : '保存失败');
      }
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteFollowup(id);
      toast.success('记录已删除');
      setDeleteTarget(null);
      reload();
    } catch {
      toast.error('删除失败');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto h-full flex flex-col">
      {/* 页头 — 不滚动 */}
      <div className="shrink-0 -mx-6 px-6 -mt-6 pt-6 pb-4 bg-background border-b border-border/50">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold">跟进记录</h1>
            <p className="text-muted-foreground text-sm mt-1">共 {stats.total} 条记录</p>
          </div>
          <Button onClick={openAdd} disabled={Object.keys(customerMap).length === 0}>
            <Plus className="mr-2 h-4 w-4" />
            添加跟进
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <MiniStat label="今日跟进" value={stats.todayCount} />
          <MiniStat label="本周跟进" value={stats.weekCount} />
          <MiniStat label="总跟进记录" value={stats.total} />
        </div>
      </div>

      {Object.keys(customerMap).length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          请先在「客户管理」中添加客户，再记录跟进
        </div>
      )}

      {/* 记录列表 — 可滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-3">
        {followups.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm border border-dashed rounded-lg">
            还没有跟进记录
          </div>
        ) : (
          followups.map((f) => {
            const customer = customerMap[f.customer_id];
            const next = parseDt(f.next_follow_up_at);
            return (
              <div key={f.id} className="flex items-start gap-4 p-4 rounded-lg border border-border bg-card hover:border-primary/20 hover:shadow-sm transition-all duration-200 group">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <button
                      className="font-medium hover:text-primary rounded px-1 -mx-1 hover:bg-primary/10 transition-colors duration-150 cursor-pointer"
                      onClick={() => navigate(`/customers/${f.customer_id}`)}
                    >
                      {customer?.company || '未知客户'}
                    </button>
                    <Badge variant="outline" className="text-xs">
                      {FOLLOWUP_TYPE_META[f.type as FollowUpType]?.label || f.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {parseDt(f.created_at)?.toLocaleDateString('zh-CN') || ''}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{f.content}</p>
                  {f.next_follow_up_at && next && (
                    <p className="text-xs text-muted-foreground mt-1">
                      下次跟进：{next.toLocaleDateString('zh-CN')}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(f)} aria-label="编辑">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(f)}
                    aria-label="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 分页 — 固定在底部 */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 pt-4 mt-4 border-t border-border/50">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : 'invisible'}`} />
          共 {total} 条记录
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">每页</span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <span className="text-sm text-muted-foreground">条</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <span className="text-sm mx-2">
              第 {page} / {totalPages} 页
            </span>
            <Button
              variant="outline" size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              下一页
            </Button>
          </div>
        </div>
      </div>

      {/* 添加/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑跟进记录' : '添加跟进记录'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>客户 *</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                aria-label="客户"
              >
                {Object.values(customerMap).map((c) => (
                  <option key={c.id} value={c.id}>{c.company}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>跟进方式</Label>
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
            <div className="grid gap-2">
              <Label htmlFor="fu-content">跟进内容 *</Label>
              <Textarea
                id="fu-content"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="记录沟通内容、客户反馈、下一步计划..."
                rows={4}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="fu-time">跟进时间（留空=现在）</Label>
                <Input
                  id="fu-time"
                  type="datetime-local"
                  value={form.createdAt}
                  onChange={(e) => setForm({ ...form, createdAt: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fu-next">下次跟进时间</Label>
                <Input
                  id="fu-next"
                  type="date"
                  value={form.nextFollowUpAt}
                  onChange={(e) => setForm({ ...form, nextFollowUpAt: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      {deleteTarget && (
        <Dialog open onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>确认删除</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">确定要删除这条跟进记录吗？删除后无法恢复。</p>
            <div className="text-sm bg-muted/50 rounded p-3 line-clamp-3">{deleteTarget.content}</div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>取消</Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(deleteTarget.id)}>
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="hover:shadow-md transition-all duration-200">
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
