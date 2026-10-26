import { useMemo, useState, useEffect } from 'react';
import { Pencil, Star, ArrowUpDown, Columns3, GripVertical, Eye, EyeOff, RotateCcw } from 'lucide-react';
import type { ICustomer } from '@/data/types';
import { CUSTOMER_STATUS_META, CUSTOMER_LEVEL_META } from '@/data/types';
import { STALE_DAYS, parseIssues } from '@/data/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ALL_COLUMNS, COLUMN_SORT_KEY, loadColumns, saveColumns, defaultColumns,
  pullColumnsRemote, type ColumnDef, type ColumnsState,
} from './columns';

export type SortKey = 'company' | 'country' | 'level' | 'status' | 'source' | 'last_followup_at' | 'created_at' | 'starred';

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
  /** 星标优先模式是否激活（表头星标按钮高亮） */
  starSortActive: boolean;
  /** 点击星标表头：切换"星标客户优先"，再点还原之前的排序 */
  onToggleStarSort: () => void;
  onEdit: (c: ICustomer) => void;
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

/** 列配置下拉：显示/隐藏 + 上下移动调顺序 */
function ColumnPicker({ state, onChange }: {
  state: ColumnsState;
  onChange: (s: ColumnsState) => void;
}) {
  const [open, setOpen] = useState(false);
  const defs = useMemo(() => new Map(ALL_COLUMNS.map((c) => [c.key, c])), []);

  const toggle = (key: string) => {
    const next = new Set(state.visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const ns = { ...state, visible: next };
    saveColumns(ns);
    onChange(ns);
  };
  const move = (key: string, dir: -1 | 1) => {
    const order = [...state.order];
    const i = order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const ns = { ...state, order };
    saveColumns(ns);
    onChange(ns);
  };
  const reset = () => {
    const ns = defaultColumns();
    saveColumns(ns);
    onChange(ns);
  };

  return (
    <div className="relative">
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOpen((v) => !v)}>
        <Columns3 className="h-3.5 w-3.5" />
        列设置
      </Button>
      {open && (
        <>
          {/* 点外面关闭 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-2">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-xs font-medium text-muted-foreground">列显示与顺序</span>
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={reset}
              >
                <RotateCcw className="h-3 w-3" />
                还原默认
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {state.order.map((key, idx) => {
                const def = defs.get(key) as ColumnDef | undefined;
                if (!def) return null;
                const visible = state.visible.has(key);
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-1.5 rounded px-1 py-1 text-sm ${visible ? '' : 'opacity-50'}`}
                  >
                    <div className="flex flex-col">
                      <button
                        className="text-muted-foreground/70 hover:text-foreground leading-none disabled:opacity-20"
                        disabled={idx === 0}
                        onClick={() => move(key, -1)}
                        aria-label={`上移${def.label}`}
                      >
                        <GripVertical className="h-3 w-3 rotate-180" />
                      </button>
                      <button
                        className="text-muted-foreground/70 hover:text-foreground leading-none disabled:opacity-20"
                        disabled={idx === state.order.length - 1}
                        onClick={() => move(key, 1)}
                        aria-label={`下移${def.label}`}
                      >
                        <GripVertical className="h-3 w-3" />
                      </button>
                    </div>
                    <label className="flex flex-1 cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted">
                      <Checkbox checked={visible} onCheckedChange={() => toggle(key)} />
                      {def.label}
                    </label>
                    <button
                      className="p-1 text-muted-foreground hover:text-foreground"
                      onClick={() => toggle(key)}
                      aria-label={visible ? `隐藏${def.label}` : `显示${def.label}`}
                    >
                      {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="px-1 pt-2 text-[11px] text-muted-foreground">
              显示不下时表格可左右滑动查看后面的列
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default function CustomerTable({
  items, loading, now, startIndex, batchMode, selected, setSelected,
  sortBy, sortAsc, onSort, starSortActive, onToggleStarSort,
  onEdit, onStar, onOpen,
}: Props) {
  const allChecked = items.length > 0 && items.every((c) => selected.has(c.id));
  const [columnsState, setColumnsState] = useState<ColumnsState>(() => loadColumns());

  // 启动时用云端（坚果云）列配置覆盖本地——全设备一套配置
  useEffect(() => {
    let alive = true;
    pullColumnsRemote().then((remote) => {
      if (alive && remote) setColumnsState(remote);
    });
    return () => { alive = false; };
  }, []);

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

  // 当前显示的列（按配置顺序，只取 visible）
  const visibleCols = columnsState.order.filter((k) => columnsState.visible.has(k));
  // 表头/单元格宽度提示（截断 + 悬停看全文）
  const colWidth: Record<string, string> = {
    company: 'max-w-[220px]',
    contact: 'max-w-[160px]',
    country: 'max-w-[120px]',
    source: 'max-w-[100px]',
    products: 'max-w-[180px]',
    level: '',
    status: '',
    last_followup_at: '',
    created_at: 'max-w-[120px]',
  };

  const renderCell = (c: ICustomer, key: string) => {
    const daysSince = c.last_followup_at
      ? Math.floor((now - new Date(c.last_followup_at).getTime()) / 86400000)
      : null;
    const stale =
      daysSince !== null && daysSince > STALE_DAYS &&
      c.status !== 'deal' && c.status !== 'lost';

    switch (key) {
      case 'company':
        return (
          <button
            onClick={() => onOpen(c.id)}
            title={c.company}
            className="block max-w-[220px] truncate text-primary text-left font-medium rounded px-1 -mx-1 py-0.5 -my-0.5 hover:bg-primary/10 hover:text-primary transition-colors duration-150"
          >
            {c.company}
          </button>
        );
      case 'contact':
        return (
          <div>
            <div className="text-sm" title={c.contact || ''}>{c.contact || '—'}</div>
            <div className="text-xs text-muted-foreground max-w-[160px] truncate" title={c.email}>{c.email}</div>
          </div>
        );
      case 'country':
        return <span className="block max-w-[120px] truncate" title={c.country || ''}>{c.country || '—'}</span>;
      case 'source':
        return <span className="block max-w-[100px] truncate" title={c.source || ''}>{c.source || '—'}</span>;
      case 'products':
        return <span className="block max-w-[180px] truncate" title={c.products || ''}>{c.products || '—'}</span>;
      case 'level':
        return (
          <Badge
            className={CUSTOMER_LEVEL_META[c.level as keyof typeof CUSTOMER_LEVEL_META]?.color || ''}
            variant="secondary"
          >
            {CUSTOMER_LEVEL_META[c.level as keyof typeof CUSTOMER_LEVEL_META]?.label || c.level || '未分级'}
          </Badge>
        );
      case 'status':
        return (
          <Badge
            className={CUSTOMER_STATUS_META[c.status as keyof typeof CUSTOMER_STATUS_META]?.color || ''}
            variant="secondary"
          >
            {CUSTOMER_STATUS_META[c.status as keyof typeof CUSTOMER_STATUS_META]?.label || c.status}
          </Badge>
        );
      case 'last_followup_at':
        return c.last_followup_at ? (
          <span
            className={stale ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}
            title={new Date(c.last_followup_at).toLocaleString()}
          >
            {daysSince === 0 ? '今天' : `${daysSince}天前`}
          </span>
        ) : (
          <span className="text-muted-foreground">未跟进</span>
        );
      case 'created_at':
        return (
          <span className="block max-w-[120px] truncate text-muted-foreground" title={c.created_at}>
            {(c.created_at || '').slice(0, 10) || '—'}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 列设置行 */}
      <div className="shrink-0 flex justify-end px-3 pt-2">
        <ColumnPicker state={columnsState} onChange={setColumnsState} />
      </div>

      {/* 表格：横向滚动，列多时往右滑 */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-0 z-[2] bg-card">
            <tr className="border-b border-border text-muted-foreground">
              {batchMode && (
                <th className="px-3 py-3 w-10 border-b border-border bg-card">
                  <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="全选" />
                </th>
              )}
              <th className="px-3 py-3 w-10 text-center font-medium border-b border-border bg-card">序号</th>
              <th className="px-3 py-3 w-10 text-center font-medium border-b border-border bg-card">
                <button
                  onClick={onToggleStarSort}
                  title={starSortActive ? '星标客户优先中，点击还原排序' : '将星标客户排到最前'}
                  aria-label={starSortActive ? '取消星标优先排序' : '星标客户优先排序'}
                  className={`inline-flex items-center justify-center p-1.5 rounded-md transition-colors hover:bg-muted ${
                    starSortActive ? 'bg-amber-100 dark:bg-amber-950/40' : ''
                  }`}
                >
                  <Star
                    className={`h-4 w-4 ${
                      starSortActive
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-muted-foreground/60'
                    }`}
                  />
                  {starSortActive && <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">优先</span>}
                </button>
              </th>
              {visibleCols.map((key) => {
                const def = ALL_COLUMNS.find((d) => d.key === key);
                const sortKey = COLUMN_SORT_KEY[key];
                return (
                  <th key={key} className="px-3 py-3 text-left font-medium border-b border-border bg-card">
                    {sortKey ? (
                      <SortButton
                        label={def?.label ?? key}
                        active={sortBy === sortKey}
                        asc={sortAsc}
                        onClick={() => onSort(sortKey)}
                      />
                    ) : (
                      (def?.label ?? key)
                    )}
                  </th>
                );
              })}
              <th className="px-3 py-3 text-right font-medium border-b border-border bg-card">操作</th>
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
            {items.length === 0 ? (
              <tr>
                <td colSpan={batchMode ? visibleCols.length + 4 : visibleCols.length + 3} className="text-center py-12 text-muted-foreground">
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
                      'transition-colors duration-150 ' +
                      (hasIssue
                        ? 'bg-red-100/80 dark:bg-red-950/30 border-l-4 border-l-red-500 hover:bg-red-200/70 dark:hover:bg-red-950/40'
                        : stale
                          ? 'bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100/50 dark:hover:bg-amber-950/30'
                          : 'hover:bg-primary/8')
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
                      <button onClick={() => onStar(c)} className="p-1 hover:bg-primary/10 rounded transition-colors duration-150" aria-label="星标">
                        <Star
                          className={`h-4 w-4 ${c.starred ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`}
                        />
                      </button>
                    </td>
                    {visibleCols.map((key) => (
                      <td key={key} className="px-3 py-3">
                        {renderCell(c, key)}
                      </td>
                    ))}
                    <td className="px-3 py-3">
                      <div className="flex justify-end">
                        <Button variant="ghost" size="icon" onClick={() => onEdit(c)} aria-label="编辑">
                          <Pencil className="h-4 w-4" />
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
    </div>
  );
}
