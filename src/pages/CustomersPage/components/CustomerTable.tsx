import { Pencil, Trash2, Star, ArrowUpDown } from 'lucide-react';
import type { ICustomer } from '@/data/types';
import { CUSTOMER_STATUS_META, CUSTOMER_LEVEL_META } from '@/data/types';
import { STALE_DAYS, parseIssues } from '@/data/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export type SortKey = 'company' | 'country' | 'level' | 'status' | 'source' | 'last_followup_at' | 'created_at';

interface Props {
  items: ICustomer[];
  loading: boolean;
  now: number;
  /** 当前页第一行的全局序号（(page-1)*pageSize），用于显示连续序号 */
  startIndex: number;
  batchMode: boolean;
  selected: Set<string>;
  setSelected: (fn: (prev: Set<string>) => Set<string>) => void;
  sortBy: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
  onEdit: (c: ICustomer) => void;
  onDelete: (id: string) => void;
  onStar: (c: ICustomer) => void;
  onOpen: (id: string) => void;
}

function SortButton({
  label, active, asc, onClick,
}: { label: string; active: boolean; asc: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 hover:text-foreground">
      {label}
      {active ? (asc ? '↑' : '↓') : <ArrowUpDown className="h-3 w-3 opacity-30" />}
    </button>
  );
}

export default function CustomerTable({
  items, loading, now, startIndex, batchMode, selected, setSelected,
  sortBy, sortAsc, onSort, onEdit, onDelete, onStar, onOpen,
}: Props) {
  const allChecked = items.length > 0 && items.every((c) => selected.has(c.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) items.forEach((c) => next.delete(c.id));
      else items.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {batchMode && (
              <th className="px-3 py-3 w-10">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="全选" />
              </th>
            )}
            <th className="px-3 py-3 w-10 text-center font-medium">序号</th>
            <th className="px-3 py-3 w-10 text-center">星标</th>
            <th className="px-3 py-3 text-left font-medium">
              <SortButton label="公司名称" active={sortBy === 'company'} asc={sortAsc} onClick={() => onSort('company')} />
            </th>
            <th className="px-3 py-3 text-left font-medium">联系人</th>
            <th className="px-3 py-3 text-left font-medium">
              <SortButton label="国家" active={sortBy === 'country'} asc={sortAsc} onClick={() => onSort('country')} />
            </th>
            <th className="px-3 py-3 text-left font-medium">
              <SortButton label="来源" active={sortBy === 'source'} asc={sortAsc} onClick={() => onSort('source')} />
            </th>
            <th className="px-3 py-3 text-left font-medium">
              <SortButton label="等级" active={sortBy === 'level'} asc={sortAsc} onClick={() => onSort('level')} />
            </th>
            <th className="px-3 py-3 text-left font-medium">
              <SortButton label="状态" active={sortBy === 'status'} asc={sortAsc} onClick={() => onSort('status')} />
            </th>
            <th className="px-3 py-3 text-left font-medium">
              <SortButton label="最近跟进" active={sortBy === 'last_followup_at'} asc={sortAsc} onClick={() => onSort('last_followup_at')} />
            </th>
            <th className="px-3 py-3 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody className={loading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
          {items.length === 0 ? (
            <tr>
              <td colSpan={batchMode ? 11 : 10} className="text-center py-12 text-muted-foreground">
                没有找到匹配的客户
              </td>
            </tr>
          ) : (
            items.map((c, idx) => {
              const issues = parseIssues(c.data_issues);
              const hasIssue = issues.length > 0;
              const daysSince = c.last_followup_at
                ? Math.floor((now - new Date(c.last_followup_at).getTime()) / 86400000)
                : null;
              const stale =
                daysSince !== null && daysSince > STALE_DAYS &&
                c.status !== 'deal' && c.status !== 'lost';

              return (
                <tr
                  key={c.id}
                  className={
                    'border-b border-border/50 ' +
                    (hasIssue
                      ? 'bg-red-100/80 dark:bg-red-950/30 border-l-4 border-l-red-500'
                      : stale
                        ? 'bg-amber-50/60 dark:bg-amber-950/20'
                        : 'hover:bg-muted/40')
                  }
                >
                  {batchMode && (
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={selected.has(c.id)}
                        onCheckedChange={() => toggleOne(c.id)}
                        aria-label={`选择 ${c.company}`}
                      />
                    </td>
                  )}
                  <td className="px-3 py-3 text-center text-muted-foreground tabular-nums">
                    {startIndex + idx + 1}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button onClick={() => onStar(c)} className="p-1 hover:bg-muted rounded" aria-label="星标">
                      <Star
                        className={`h-4 w-4 ${c.starred ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`}
                      />
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => onOpen(c.id)}
                      className="block max-w-[220px] truncate text-primary hover:underline text-left font-medium"
                    >
                      {c.company}
                    </button>
                    {hasIssue && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-0.5 max-w-[260px] truncate" title={issues.join('、')}>
                        {issues.join('、')}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-sm">{c.contact || '—'}</div>
                    <div className="text-xs text-muted-foreground max-w-[160px] truncate">{c.email}</div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="block max-w-[120px] truncate">{c.country || '—'}</span>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    <span className="block max-w-[100px] truncate">{c.source || '—'}</span>
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      className={CUSTOMER_LEVEL_META[c.level as keyof typeof CUSTOMER_LEVEL_META]?.color || ''}
                      variant="secondary"
                    >
                      {CUSTOMER_LEVEL_META[c.level as keyof typeof CUSTOMER_LEVEL_META]?.label || c.level || '未分级'}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      className={CUSTOMER_STATUS_META[c.status as keyof typeof CUSTOMER_STATUS_META]?.color || ''}
                      variant="secondary"
                    >
                      {CUSTOMER_STATUS_META[c.status as keyof typeof CUSTOMER_STATUS_META]?.label || c.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-sm">
                    {c.last_followup_at ? (
                      <span className={stale ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}>
                        {daysSince === 0 ? '今天' : `${daysSince}天前`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">未跟进</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => onEdit(c)} aria-label="编辑">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => onDelete(c.id)}
                        aria-label="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
