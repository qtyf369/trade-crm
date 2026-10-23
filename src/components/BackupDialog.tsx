import { useEffect, useState } from 'react';
import { Archive, Download, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface BackupItem {
  file: string;
  size: number;
  mtime: number;
  created_at?: string;
  tag?: string;
  counts?: { customers: number; followups: number };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TAG_LABEL: Record<string, string> = {
  manual: '手动',
  auto: '每日自动',
  before_restore: '恢复前',
};

function fmtTime(ts: number) {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 备份与恢复面板：备份含数据库 + 全部设置 */
export default function BackupDialog({ open, onOpenChange }: Props) {
  const [items, setItems] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/backup/list');
      const data = await res.json();
      setItems(data.backups || []);
    } catch {
      toast.error('读取备份列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    // 延后一帧，避免在 effect 内同步 setState 触发级联渲染
    const t = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const createBackup = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/backup/create', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.detail || '备份失败');
        return;
      }
      toast.success(`已创建备份（${data.counts?.customers ?? 0} 个客户）`);
      await load();
    } catch {
      toast.error('备份失败');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (file: string) => {
    if (!window.confirm('将用该备份覆盖当前数据，确定继续吗？\n（恢复前会自动备份当前状态）')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.detail || '恢复失败');
        return;
      }
      toast.success(`已恢复（${data.counts?.customers ?? 0} 个客户）`);
      setTimeout(() => window.location.reload(), 800);
    } catch {
      toast.error('恢复失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>备份与恢复</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            每份备份包含<strong>全部客户数据</strong>、跟进记录和所有设置（主题、配色、坚果云配置），
            可拷贝到其它电脑恢复。
          </p>

          <Button onClick={createBackup} disabled={busy || loading} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            立即备份一份
          </Button>

          <div className="max-h-[300px] space-y-2 overflow-y-auto">
            {loading && (
              <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
            )}
            {!loading && items.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">还没有备份</p>
            )}
            {items.map((b) => (
              <div key={b.file} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{fmtTime(b.mtime)}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {TAG_LABEL[b.tag || ''] || b.tag || '备份'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {b.counts?.customers != null && b.counts.customers >= 0
                        ? `${b.counts.customers} 客户 · ${b.counts.followups} 跟进 · `
                        : ''}
                      {(b.size / 1024).toFixed(0)} KB
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost" size="icon" title="恢复此备份"
                      disabled={busy}
                      onClick={() => restore(b.file)}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" title="下载备份文件"
                      asChild
                    >
                      <a href={`/api/backup/download?file=${encodeURIComponent(b.file)}`}>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
