import { useEffect, useState } from 'react';
import { api } from '@/data/api';
import { parseIssues } from '@/data/constants';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 数据问题列表：只拉有问题的客户，跳转到详情页修改 */
export default function IssuesDialog({ open, onOpenChange }: Props) {
  const [items, setItems] = useState<{ id: string; company: string; issues: string[] }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.listCustomers({ issues: true, page: 1, page_size: 500 })
      .then((r) =>
        setItems(
          r.items.map((c) => ({
            id: c.id,
            company: c.company,
            issues: parseIssues(c.data_issues),
          })),
        ),
      )
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-amber-500">⚠</span>
            数据问题列表（共 {items.length} 条）
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-center py-8 text-muted-foreground text-sm">加载中…</p>
          ) : items.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground text-sm">没有数据问题的客户</p>
          ) : (
            items.map((c) => (
              <div
                key={c.id}
                className="flex items-start justify-between gap-3 py-2 px-3 border-b border-border/50 hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm">{c.company}</div>
                  <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                    {c.issues.join('；')}
                  </div>
                </div>
                <Button
                  variant="outline" size="sm"
                  onClick={() => { window.location.href = `/customers/${c.id}`; }}
                >
                  去修改
                </Button>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
