import { useEffect, useMemo, useState } from 'react';
import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import { api } from '@/data/api';
import type { ICustomer, IFollowUp, FollowUpType } from '@/data/types';
import { FOLLOWUP_TYPE_META } from '@/data/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function FollowUpsPage() {
  const [followups, setFollowups] = useState<IFollowUp[]>([]);
  const [customers, setCustomers] = useState<ICustomer[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    customerId: '',
    type: 'email' as FollowUpType,
    content: '',
    nextFollowUpAt: '',
  });

  useEffect(() => {
    api.listFollowups().then(setFollowups).catch(console.error);
    api.listCustomers().then(setCustomers).catch(console.error);
  }, []);

  const customerMap = useMemo(() => {
    const map: Record<string, ICustomer> = {};
    customers.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [customers]);

  const loadFollowups = () => {
    api.listFollowups().then(setFollowups).catch(console.error);
  };

  const sorted = [...followups].sort(
    (a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime()
  );

  const openAdd = () => {
    setForm({
      customerId: customers[0]?.id || '',
      type: 'email',
      content: '',
      nextFollowUpAt: '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.customerId) {
      toast.error('请选择客户');
      return;
    }
    if (!form.content.trim()) {
      toast.error('跟进内容不能为空');
      return;
    }

    try {
      await api.createFollowup({
        customer_id: form.customerId,
        type: form.type,
        content: form.content,
        next_follow_up_at: form.nextFollowUpAt,
      });
      setDialogOpen(false);
      toast.success('跟进记录已添加');
      loadFollowups();
    } catch {
      toast.error('保存失败，请重试');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteFollowup(id);
      toast.success('记录已删除');
      loadFollowups();
    } catch {
      toast.error('删除失败');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">跟进记录</h1>
          <p className="text-muted-foreground text-sm mt-1">共 {followups.length} 条记录</p>
        </div>
        <Button onClick={openAdd} disabled={customers.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          添加跟进
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">今日跟进</p>
            <p className="text-2xl font-semibold mt-1">
              {followups.filter((f) => f.created_at && new Date(f.created_at).toDateString() === new Date().toDateString()).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">本周跟进</p>
            <p className="text-2xl font-semibold mt-1">
              {followups.filter((f) => {
                if (!f.created_at) return false;
                const d = new Date(f.created_at);
                const now = new Date();
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                return d >= weekAgo;
              }).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">总跟进记录</p>
            <p className="text-2xl font-semibold mt-1">{followups.length}</p>
          </CardContent>
        </Card>
      </div>

      {customers.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          请先在「客户管理」中添加客户，再记录跟进
        </div>
      )}

      {/* 跟进记录列表 */}
      <div className="space-y-3">
        {sorted.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            还没有跟进记录
          </div>
        ) : (
          sorted.map((f) => {
            const customer = customerMap[f.customer_id];
            return (
              <div
                key={f.id}
                className="flex items-start gap-4 p-4 rounded-lg border border-border bg-card"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{customer?.company || '未知客户'}</span>
                    <Badge variant="outline" className="text-xs">
                      {FOLLOWUP_TYPE_META[f.type as FollowUpType]?.label || f.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {f.created_at ? new Date(f.created_at).toLocaleDateString('zh-CN') : ''}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/90">{f.content}</p>
                  {f.next_follow_up_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      下次跟进：{new Date(f.next_follow_up_at).toLocaleDateString('zh-CN')}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive shrink-0"
                  onClick={() => handleDelete(f.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })
        )}
      </div>

      {/* 添加跟进弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>添加跟进记录</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>客户 *</Label>
              <Select
                value={form.customerId}
                onValueChange={(v) => setForm({ ...form, customerId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择客户" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>跟进方式</Label>
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
            <div className="grid gap-2">
              <Label htmlFor="content">跟进内容 *</Label>
              <Textarea
                id="content"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="记录沟通内容、客户反馈、下一步计划..."
                rows={4}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nextFollowUpAt">下次跟进时间</Label>
              <Input
                id="nextFollowUpAt"
                type="date"
                value={form.nextFollowUpAt}
                onChange={(e) => setForm({ ...form, nextFollowUpAt: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSubmit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
