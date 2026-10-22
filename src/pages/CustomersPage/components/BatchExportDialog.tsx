import { useEffect, useState } from 'react';
import { api } from '@/data/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前筛选/搜索下的客户总数（序号范围的上界参考） */
  currentTotal: number;
  /** 当前页客户 id，勾选模式默认勾选本页 */
  currentIds: string[];
  /** 勾选导出 */
  onExport: (ids: string[]) => void;
  /** 序号范围导出（沿用当前列表的筛选与排序，序号与列表序号列一致） */
  onExportRange: (start: number, end: number) => void;
}

type Mode = 'range' | 'check';

/**
 * 批量导出：序号范围 / 勾选客户两种模式。
 * 序号范围沿用当前列表的筛选与排序（与列表序号列一致）；
 * Excel 内的序号列由后端按导出范围重新从 1 编号，纯展示、与内部 id 无关。
 * 勾选模式只加载一次全量公司名用于勾选，避免大数据量下卡顿。
 */
export default function BatchExportDialog({
  open, onOpenChange, currentTotal, currentIds, onExport, onExportRange,
}: Props) {
  const [mode, setMode] = useState<Mode>('range');
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [list, setList] = useState<{ id: string; company: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 延后一帧，避免在 effect 中同步 setState
    const t = setTimeout(() => setChecked(new Set(currentIds)), 0);
    return () => clearTimeout(t);
  }, [open, currentIds]);

  useEffect(() => {
    if (!open || mode !== 'check' || list.length > 0) return;
    const t = setTimeout(() => {
      setLoading(true);
      api.listCustomers({ page: 1, page_size: 500, sort_by: 'company' })
        .then((r) => setList(r.items.map((c) => ({ id: c.id, company: c.company }))))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(t);
  }, [open, mode, list.length]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () => {
    if (mode === 'range') {
      const from = Math.max(1, start || 1);
      const to = end && end >= from ? end : currentTotal;
      onExportRange(from, to);
    } else {
      if (checked.size === 0) return;
      onExport(Array.from(checked));
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>批量导出Excel</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="flex gap-2">
            <Button size="sm" variant={mode === 'range' ? 'default' : 'outline'} onClick={() => setMode('range')}>
              序号范围
            </Button>
            <Button size="sm" variant={mode === 'check' ? 'default' : 'outline'} onClick={() => setMode('check')}>
              勾选客户
            </Button>
          </div>

          {mode === 'range' ? (
            <>
              <p className="text-sm text-muted-foreground">
                序号与当前列表一致（含筛选与排序），共 {currentTotal} 个客户。
                Excel 内序号按导出范围重新从 1 编号。
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>开始序号</Label>
                  <Input type="number" min={1} value={start} onChange={(e) => setStart(Number(e.target.value))} />
                </div>
                <div className="grid gap-2">
                  <Label>结束序号（0 = 到最后）</Label>
                  <Input type="number" min={0} value={end} onChange={(e) => setEnd(Number(e.target.value))} />
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                已选 {checked.size} 个客户
                {currentTotal > list.length && `（仅加载前 ${list.length} / ${currentTotal}）`}
              </p>
              <div className="max-h-60 overflow-y-auto border rounded-md">
                {loading ? (
                  <p className="text-center py-6 text-sm text-muted-foreground">加载中…</p>
                ) : (
                  list.map((c, idx) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted cursor-pointer border-b border-border/50"
                    >
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={checked.has(c.id)}
                        onChange={() => toggle(c.id)}
                      />
                      <span className="text-muted-foreground w-8">{idx + 1}.</span>
                      {c.company}
                    </label>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={mode === 'check' && checked.size === 0}>
            导出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
