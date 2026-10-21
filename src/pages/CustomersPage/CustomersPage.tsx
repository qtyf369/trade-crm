import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, Pencil, Trash2, Filter, X, Star, Settings, Upload, Download,
  AlertTriangle, CheckSquare, RefreshCw,
} from 'lucide-react';
import { api, type BatchAction } from '@/data/api';
import type { ICustomer, CustomerLevel, CustomerStatus } from '@/data/types';
import { CUSTOMER_STATUS_META, CUSTOMER_LEVEL_META } from '@/data/types';
import { COUNTRIES } from '@/data/countries';
import {
  CUSTOMER_SOURCES, CUSTOMER_LEVELS, CUSTOMER_STATUSES, STATUS_LABELS,
  LEVEL_LABELS, STALE_DAYS, parseIssues,
} from '@/data/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import CustomerTable from './components/CustomerTable';
import CustomerFormDialog from './components/CustomerFormDialog';
import BatchExportDialog from './components/BatchExportDialog';
import IssuesDialog from './components/IssuesDialog';
import FilterPanel from './components/FilterPanel';
import SyncSettingsDialog from './components/SyncSettingsDialog';

type SortKey = 'company' | 'country' | 'level' | 'status' | 'last_followup_at' | 'created_at';

const emptyCustomer = {
  company: '',
  contact: '',
  country: '',
  email: '',
  phone: '',
  source: '阿里巴巴国际站',
  level: '' as CustomerLevel,
  status: 'lead' as CustomerStatus,
  note: '',
  products: '',
  contacts: [],
};

export default function CustomersPage() {
  const navigate = useNavigate();

  // ---- 数据 ----
  const [items, setItems] = useState<ICustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // ---- 查询条件 ----
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('company');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [starredOnly, setStarredOnly] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);

  // ---- 弹窗 ----
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<ICustomer | null>(null);
  const [form, setForm] = useState(emptyCustomer);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [batchExportOpen, setBatchExportOpen] = useState(false);
  const [issuesDialogOpen, setIssuesDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // ---- 批量模式 ----
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const activeFilterCount =
    selectedCountries.length + selectedLevels.length +
    selectedStatuses.length + selectedSources.length;

  // 预先算好各维度筛选的字符串 key，供 useCallback 依赖使用
  // （依赖数组不允许放表达式）
  const countryKey = selectedCountries.join(',');
  const levelKey = selectedLevels.join(',');
  const statusKey = selectedStatuses.join(',');
  const sourceKey = selectedSources.join(',');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listCustomers({
        search: debouncedSearch,
        country: countryKey,
        level: levelKey,
        status: statusKey,
        source: sourceKey,
        starred: starredOnly,
        issues: issuesOnly,
        sort_by: sortBy,
        sort_asc: sortAsc,
        page,
        page_size: pageSize,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [
    debouncedSearch, countryKey, levelKey, statusKey, sourceKey,
    starredOnly, issuesOnly, sortBy, sortAsc, page, pageSize,
  ]);

  // 查询依赖变化时重新加载；用 setTimeout 脱离同步渲染阶段
  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // 切换筛选条件时回到第一页（延后到下一帧，避免级联渲染）
  const filterKey = [countryKey, levelKey, statusKey, sourceKey, starredOnly, issuesOnly].join('|');
  useEffect(() => {
    const t = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(t);
  }, [filterKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 有数据问题的客户数（单独拉一次，仅用于顶部提醒条）
  const [issueCount, setIssueCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.listCustomers({ issues: true, page: 1, page_size: 1 })
        .then((r) => { if (alive) setIssueCount(r.total); })
        .catch(() => {});
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortAsc((v) => !v);
    } else {
      setSortBy(key);
      setSortAsc(true);
    }
  };

  const openAdd = () => {
    setEditingCustomer(null);
    setForm(emptyCustomer);
    setDialogOpen(true);
  };

  const openEdit = (customer: ICustomer) => {
    setEditingCustomer(customer);
    setForm({
      company: customer.company,
      contact: customer.contact,
      country: customer.country,
      email: customer.email,
      phone: customer.phone,
      source: customer.source,
      level: customer.level as CustomerLevel,
      status: customer.status as CustomerStatus,
      note: customer.note,
      products: customer.products || '',
      contacts: customer.contacts || [],
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.company.trim()) {
      toast.error('公司名称不能为空');
      return;
    }
    try {
      if (editingCustomer) {
        await api.updateCustomer(editingCustomer.id, form);
        toast.success('客户已更新');
      } else {
        await api.createCustomer(form);
        toast.success('客户已添加');
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteCustomer(id);
      setDeleteConfirm(null);
      toast.success('客户已删除');
      setSelected((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      load();
    } catch {
      toast.error('删除失败');
    }
  };

  const toggleStar = async (customer: ICustomer) => {
    const next = customer.starred ? 0 : 1;
    // 乐观更新，失败回滚
    setItems((list) => list.map((c) => (c.id === customer.id ? { ...c, starred: next } : c)));
    try {
      await api.updateCustomer(customer.id, { ...customer, starred: next });
    } catch {
      setItems((list) =>
        list.map((c) => (c.id === customer.id ? { ...c, starred: customer.starred } : c)),
      );
      toast.error('操作失败');
    }
  };

  const runBatch = async (action: BatchAction, confirmText?: string) => {
    if (selected.size === 0) return;
    if (confirmText && !confirm(confirmText)) return;
    setBatchBusy(true);
    try {
      const res = await api.batchCustomers(Array.from(selected), action);
      toast.success(
        action === 'delete'
          ? `已删除 ${res.affected} 个客户`
          : action === 'star'
            ? `已加星标 ${res.affected} 个客户`
            : `已取消星标 ${res.affected} 个客户`,
      );
      setSelected(new Set());
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '批量操作失败');
    } finally {
      setBatchBusy(false);
    }
  };

  const handleImport = async (file: File) => {
    try {
      const res = await api.importExcel(file);
      const parts = [`新增 ${res.imported} 个客户`];
      if (res.skipped) parts.push(`跳过已存在 ${res.skipped} 个`);
      toast.success(`导入成功：${parts.join('，')}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败，请检查文件格式');
    }
  };

  const resetFilters = () => {
    setSelectedCountries([]);
    setSelectedLevels([]);
    setSelectedStatuses([]);
    setSelectedSources([]);
    setStarredOnly(false);
    setIssuesOnly(false);
  };

  // 页面挂载时取一次时间基准，用于"最近跟进"天数计算
  const [now] = useState(() => Date.now());

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">客户管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {debouncedSearch || activeFilterCount || starredOnly || issuesOnly
              ? `筛选出 ${total} 个客户`
              : `共 ${total} 个客户`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.open(api.exportUrl(), '_blank')}>
            <Download className="mr-2 h-4 w-4" />
            导出全部
          </Button>
          <Button variant="outline" onClick={() => setBatchExportOpen(true)}>
            批量导出
          </Button>
          <label>
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = '';
              }}
            />
            <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 cursor-pointer">
              <Upload className="mr-2 h-4 w-4" />
              导入Excel
            </span>
          </label>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            新增客户
          </Button>
          <Button
            variant={batchMode ? 'default' : 'outline'}
            onClick={() => {
              setBatchMode((v) => !v);
              setSelected(new Set());
            }}
          >
            <CheckSquare className="mr-2 h-4 w-4" />
            {batchMode ? '退出批量' : '批量操作'}
          </Button>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 批量操作栏 */}
      {batchMode && (
        <div className="mb-4 p-3 bg-primary/5 border border-primary/20 rounded-lg flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-primary">
            已选中 <strong>{selected.size}</strong> 个客户
            {batchBusy && <span className="ml-2 text-muted-foreground">处理中…</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline" size="sm"
              disabled={selected.size === 0}
              onClick={() => window.open(api.exportUrl({ ids: Array.from(selected).join(',') }), '_blank')}
            >
              导出选中
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={selected.size === 0 || batchBusy}
              onClick={() => runBatch('star')}
            >
              加星标
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={selected.size === 0 || batchBusy}
              onClick={() => runBatch('unstar')}
            >
              取消星标
            </Button>
            <Button
              variant="outline" size="sm"
              className="text-destructive hover:text-destructive"
              disabled={selected.size === 0 || batchBusy}
              onClick={() => runBatch('delete', `确定删除选中的 ${selected.size} 个客户吗？跟进记录会一并删除，无法恢复。`)}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              删除选中
            </Button>
          </div>
        </div>
      )}

      {/* 数据问题提醒 */}
      {issueCount > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between dark:bg-amber-950/30 dark:border-amber-900">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">
              有 <strong>{issueCount}</strong> 条客户数据存在问题需要完善
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // 点击"查看"直接筛选出有数据问题的客户（保持原版行为）
              setIssuesOnly(true);
              setShowFilterPanel(true);
              setPage(1);
              setIssuesDialogOpen(true);
            }}
          >
            查看
          </Button>
        </div>
      )}

      {/* 搜索栏 */}
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索公司名、联系人、国家、产品或备注..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant={showFilterPanel || activeFilterCount > 0 ? 'default' : 'outline'}
          onClick={() => setShowFilterPanel((v) => !v)}
        >
          <Filter className="mr-2 h-4 w-4" />
          筛选
          {activeFilterCount > 0 && (
            <span className="ml-2 bg-primary-foreground/20 rounded-full px-2 text-xs">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {showFilterPanel && (
        <FilterPanel
          selectedCountries={selectedCountries}
          setSelectedCountries={setSelectedCountries}
          selectedLevels={selectedLevels}
          setSelectedLevels={setSelectedLevels}
          selectedStatuses={selectedStatuses}
          setSelectedStatuses={setSelectedStatuses}
          selectedSources={selectedSources}
          setSelectedSources={setSelectedSources}
          starredOnly={starredOnly}
          setStarredOnly={setStarredOnly}
          issuesOnly={issuesOnly}
          setIssuesOnly={setIssuesOnly}
          onReset={resetFilters}
        />
      )}

      {/* 表格 */}
      <div className="rounded-lg border border-border bg-card">
        <CustomerTable
          items={items}
          loading={loading}
          now={now}
          batchMode={batchMode}
          selected={selected}
          setSelected={setSelected}
          sortBy={sortBy}
          sortAsc={sortAsc}
          onSort={toggleSort}
          onEdit={openEdit}
          onDelete={setDeleteConfirm}
          onStar={toggleStar}
          onOpen={(id) => navigate(`/customers/${id}`)}
        />

        {/* 分页 */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : 'invisible'}`} />
            共 {total} 个客户
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
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
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
      </div>

      {/* 新增/编辑 */}
      <CustomerFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editingCustomer}
        form={form}
        setForm={setForm}
        onSubmit={handleSubmit}
      />

      {/* 删除确认 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-lg p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-2">确认删除</h3>
            <p className="text-sm text-muted-foreground mb-4">
              删除后该客户的所有信息和跟进记录将无法恢复，确定要删除吗？
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>
                取消
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(deleteConfirm)}>
                删除
              </Button>
            </div>
          </div>
        </div>
      )}

      <BatchExportDialog
        open={batchExportOpen}
        onOpenChange={setBatchExportOpen}
        currentIds={items.map((c) => c.id)}
        onExport={(ids) => window.open(api.exportUrl({ ids: ids.join(',') }), '_blank')}
      />

      <IssuesDialog open={issuesDialogOpen} onOpenChange={setIssuesDialogOpen} />

      <SyncSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
