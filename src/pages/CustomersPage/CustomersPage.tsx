import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Pencil, Trash2, Filter, X, Star } from 'lucide-react';
import { api } from '@/data/api';
import type { ICustomer, CustomerLevel, CustomerStatus } from '@/data/types';
import { CUSTOMER_STATUS_META, CUSTOMER_LEVEL_META } from '@/data/types';
import { COUNTRIES } from '@/data/countries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { toast } from 'sonner';

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

type SortKey = 'company' | 'country' | 'level' | 'status' | 'last_followup_at';

export default function CustomersPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<ICustomer[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('company');
  const [sortAsc, setSortAsc] = useState(true);
  const [now] = useState(() => Date.now());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<ICustomer | null>(null);
  const [form, setForm] = useState(emptyCustomer);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [batchExportOpen, setBatchExportOpen] = useState(false);
  const [batchStart, setBatchStart] = useState(1);
  const [batchEnd, setBatchEnd] = useState(0);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [issuesDialogOpen, setIssuesDialogOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set());
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [exportMode, setExportMode] = useState<'range' | 'check'>('range');
  const [checkedCustomers, setCheckedCustomers] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncConfig, setSyncConfig] = useState({
    webdav_url: 'https://dav.jianguoyun.com/dav/',
    webdav_user: '',
    webdav_pass: '',
    auto_sync: true,
  });
  const [testStatus, setTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // 打开设置时自动加载已保存的配置
  const openSettings = async () => {
    setSettingsOpen(true);
    setTestStatus(null);
    try {
      const res = await fetch('/api/sync/config');
      const data = await res.json();
      setIsBound(!!data.webdav_pass_saved);
      if (data.webdav_url) {
        setSyncConfig({
          webdav_url: data.webdav_url,
          webdav_user: data.webdav_user,
          webdav_pass: '', // 密码不回显
          auto_sync: data.auto_sync,
        });
      }
    } catch {}
  };

  const [isBound, setIsBound] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [remoteHasData, setRemoteHasData] = useState(false);

  // 加载绑定状态
  useEffect(() => {
    fetch('/api/sync/config')
      .then(res => res.json())
      .then(data => {
        setIsBound(!!data.webdav_pass_saved);
      })
      .catch(() => {});
  }, []);

  const loadCustomers = () => {
    api.listCustomers().then(setCustomers).catch(console.error);
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const filtered = customers
    .filter(
      (c) =>
        c.company.toLowerCase().includes(search.toLowerCase()) ||
        c.contact.toLowerCase().includes(search.toLowerCase()) ||
        c.country.toLowerCase().includes(search.toLowerCase())
    )
    .filter((c) => {
      if (showStarredOnly && !(c as any).starred) return false;
      if (showIssuesOnly) {
        try {
          const issues = JSON.parse(c.data_issues || '[]');
          if (issues.length === 0) return false;
        } catch {
          return false;
        }
      }
      if (selectedCountries.length > 0 && !selectedCountries.includes(c.country)) return false;
      if (selectedLevels.length > 0 && !selectedLevels.includes(c.level)) return false;
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(c.status)) return false;
      if (selectedSources.length > 0 && !selectedSources.includes(c.source)) return false;
      return true;
    })
    .sort((a, b) => {
      let av: any, bv: any;
      if (sortBy === 'last_followup_at') {
        av = (a as any).last_followup_at || '';
        bv = (b as any).last_followup_at || '';
      } else {
        av = a[sortBy] || '';
        bv = b[sortBy] || '';
      }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(key);
      setSortAsc(true);
    }
  };

  // 分页
  const totalPages = Math.ceil(filtered.length / pageSize);
  const startIdx = (currentPage - 1) * pageSize;
  const paged = filtered.slice(startIdx, startIdx + pageSize);

  // 有数据问题的客户数量
  const customersWithIssues = customers.filter(c => {
    try {
      const issues = JSON.parse(c.data_issues || '[]');
      return issues.length > 0;
    } catch {
      return false;
    }
  });

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

    // 国家校验：不在列表里的自动变成"未知"
    const finalForm = {
      ...form,
      country: COUNTRIES.includes(form.country) ? form.country : '未知',
    };

    // 同步 contacts 数组：把主联系人信息同步到第一个联系人
    const contacts = [...(finalForm.contacts || [])];
    if (contacts.length === 0) {
      // 如果没有联系人，创建一个
      contacts.push({
        name: finalForm.contact,
        email: finalForm.email,
        phone: finalForm.phone,
        position: '',
        social: '',
        socialAccount: '',
      });
    } else {
      // 更新第一个联系人
      contacts[0] = {
        ...contacts[0],
        name: finalForm.contact || contacts[0].name,
        email: finalForm.email || contacts[0].email,
        phone: finalForm.phone || contacts[0].phone,
      };
    }
    finalForm.contacts = contacts;

    try {
      if (editingCustomer) {
        await api.updateCustomer(editingCustomer.id, finalForm);
        toast.success('客户已更新');
      } else {
        await api.createCustomer(finalForm);
        toast.success('客户已添加');
      }
      setDialogOpen(false);
      loadCustomers();
    } catch {
      toast.error('操作失败，请重试');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteCustomer(id);
      setDeleteConfirm(null);
      toast.success('客户已删除');
      loadCustomers();
    } catch {
      toast.error('删除失败');
    }
  };

  const toggleStar = async (id: string) => {
    try {
      const customer = customers.find(c => c.id === id);
      if (!customer) return;
      const newStarred = (customer.starred ? 0 : 1);
      await api.updateCustomer(id, { ...customer, starred: newStarred });
      loadCustomers();
    } catch {
      toast.error('操作失败');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`导入成功：新增 ${data.imported} 个客户`);
        loadCustomers();
      } else {
        toast.error(data.detail || '导入失败');
      }
    } catch {
      toast.error('导入失败，请检查文件格式');
    }

    // 重置input，允许重复上传同一文件
    e.target.value = '';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">客户管理</h1>
          <p className="text-muted-foreground text-sm mt-1">共 {customers.length} 个客户</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.open('/api/export', '_blank')}>
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
              onChange={handleImport}
            />
            <div className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 cursor-pointer">
              导入Excel
            </div>
          </label>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            新增客户
          </Button>
          <Button
            variant={batchMode ? 'default' : 'outline'}
            onClick={() => {
              setBatchMode(!batchMode);
              setSelectedCustomers(new Set());
            }}
          >
            {batchMode ? '退出批量模式' : '批量操作'}
          </Button>
          <Button variant="outline" onClick={openSettings}>
            设置
          </Button>
        </div>
      </div>

      {/* 批量操作栏 */}
      {batchMode && (
        <div className="mb-4 p-3 bg-primary/5 border border-primary/20 rounded-lg flex items-center justify-between">
          <div className="text-sm text-primary">
            已选中 <strong>{selectedCustomers.size}</strong> 个客户
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={selectedCustomers.size === 0}
              onClick={() => {
                const ids = Array.from(selectedCustomers).join(',');
                window.open(`/api/export?ids=${ids}`, '_blank');
              }}
            >
              导出选中
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={selectedCustomers.size === 0}
              onClick={async () => {
                if (!confirm(`确定删除选中的 ${selectedCustomers.size} 个客户吗？`)) return;
                for (const id of selectedCustomers) {
                  await api.deleteCustomer(id);
                }
                toast.success('删除成功');
                setSelectedCustomers(new Set());
                loadCustomers();
              }}
            >
              删除选中
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={selectedCustomers.size === 0}
              onClick={async () => {
                for (const id of selectedCustomers) {
                  const c = customers.find(x => x.id === id);
                  if (c) {
                    await api.updateCustomer(id, { ...c, starred: 1 });
                  }
                }
                toast.success('已加星标');
                loadCustomers();
              }}
            >
              加星标
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={selectedCustomers.size === 0}
              onClick={async () => {
                for (const id of selectedCustomers) {
                  const c = customers.find(x => x.id === id);
                  if (c) {
                    await api.updateCustomer(id, { ...c, starred: 0 });
                  }
                }
                toast.success('已取消星标');
                loadCustomers();
              }}
            >
              取消星标
            </Button>
          </div>
        </div>
      )}

      {/* 离线模式提醒 */}
      {!isBound && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-800">
            <span className="text-amber-600">⚠</span>
            <span className="text-sm">当前处于离线模式，数据仅保存在本地。绑定坚果云可实现多端同步。</span>
          </div>
          <Button variant="outline" size="sm" onClick={openSettings}>
            立即绑定
          </Button>
        </div>
      )}

      {/* 数据问题通知栏 */}
      {customersWithIssues.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-800">
            <span className="text-amber-500">⚠</span>
            <span className="text-sm">
              有 <strong>{customersWithIssues.length}</strong> 条客户数据存在问题需要完善
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowIssuesOnly(true)}
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
            placeholder="搜索公司名、联系人或国家..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant={showFilterPanel ? 'default' : 'outline'}
          onClick={() => setShowFilterPanel(!showFilterPanel)}
        >
          <Filter className="mr-2 h-4 w-4" />
          筛选
          {(selectedCountries.length > 0 || selectedLevels.length > 0 || selectedStatuses.length > 0 || selectedSources.length > 0) && (
            <span className="ml-2 bg-primary-foreground/20 rounded-full px-2 text-xs">
              {selectedCountries.length + selectedLevels.length + selectedStatuses.length + selectedSources.length}
            </span>
          )}
        </Button>
      </div>

      {/* 筛选面板 */}
      {showFilterPanel && (
        <div className="mb-4 p-4 border rounded-lg bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">筛选条件</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedCountries([]);
                setSelectedLevels([]);
                setSelectedStatuses([]);
                setSelectedSources([]);
                setShowStarredOnly(false);
                setShowIssuesOnly(false);
              }}
            >
              <X className="mr-1 h-3 w-3" />
              重置
            </Button>
          </div>
          {/* 星标和问题筛选 */}
          <div className="mb-3 pb-3 border-b border-border flex gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={showStarredOnly}
                onChange={(e) => setShowStarredOnly(e.target.checked)}
              />
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              只看星标客户
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={showIssuesOnly}
                onChange={(e) => setShowIssuesOnly(e.target.checked)}
              />
              <span className="text-red-500">⚠</span>
              只看有数据问题的客户
            </label>
          </div>

          <div className="grid grid-cols-4 gap-4">
            {/* 国家筛选 */}
            <div>
              <div className="text-sm font-medium mb-2">国家</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {[...new Set(customers.map(c => c.country).filter(Boolean))].sort().map((country) => (
                  <label key={country} className="flex items-center gap-2 text-sm hover:bg-muted p-1 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedCountries.includes(country)}
                      onChange={() => {
                        setSelectedCountries(
                          selectedCountries.includes(country)
                            ? selectedCountries.filter(c => c !== country)
                            : [...selectedCountries, country]
                        );
                      }}
                    />
                    {country}
                  </label>
                ))}
              </div>
            </div>
            {/* 等级筛选 */}
            <div>
              <div className="text-sm font-medium mb-2">等级</div>
              <div className="space-y-1">
                {['', 'L0', 'L1', 'L2', 'L3', 'L4', '低质', '优质'].map((level) => (
                  <label key={level || 'none'} className="flex items-center gap-2 text-sm hover:bg-muted p-1 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedLevels.includes(level)}
                      onChange={() => {
                        setSelectedLevels(
                          selectedLevels.includes(level)
                            ? selectedLevels.filter(l => l !== level)
                            : [...selectedLevels, level]
                        );
                      }}
                    />
                    {level || '未分级'}
                  </label>
                ))}
              </div>
            </div>
            {/* 来源筛选 */}
            <div>
              <div className="text-sm font-medium mb-2">来源</div>
              <div className="space-y-1">
                {['阿里巴巴国际站', '展会', 'Google', '其他'].map((source) => (
                  <label key={source} className="flex items-center gap-2 text-sm hover:bg-muted p-1 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedSources.includes(source)}
                      onChange={() => {
                        setSelectedSources(
                          selectedSources.includes(source)
                            ? selectedSources.filter(s => s !== source)
                            : [...selectedSources, source]
                        );
                      }}
                    />
                    {source}
                  </label>
                ))}
              </div>
            </div>
            {/* 状态筛选 */}
            <div>
              <div className="text-sm font-medium mb-2">状态</div>
              <div className="space-y-1">
                {Object.entries(CUSTOMER_STATUS_META).map(([value, meta]) => (
                  <label key={value} className="flex items-center gap-2 text-sm hover:bg-muted p-1 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStatuses.includes(value)}
                      onChange={() => {
                        setSelectedStatuses(
                          selectedStatuses.includes(value)
                            ? selectedStatuses.filter(s => s !== value)
                            : [...selectedStatuses, value]
                        );
                      }}
                    />
                    {meta.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 客户表格 */}
      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {batchMode && (
                  <TableHead className="whitespace-nowrap w-12 text-center">
                    <input
                      type="checkbox"
                      className="w-5 h-5 cursor-pointer rounded"
                      checked={paged.length > 0 && paged.every(c => selectedCustomers.has(c.id))}
                      onChange={() => {
                        const newSet = new Set(selectedCustomers);
                        const allChecked = paged.every(c => selectedCustomers.has(c.id));
                        if (allChecked) {
                          paged.forEach(c => newSet.delete(c.id));
                        } else {
                          paged.forEach(c => newSet.add(c.id));
                        }
                        setSelectedCustomers(newSet);
                      }}
                    />
                  </TableHead>
                )}
                <TableHead className="whitespace-nowrap w-10">星标</TableHead>
                <TableHead className="whitespace-nowrap w-12">序号</TableHead>
                <TableHead className="whitespace-nowrap">
                  <button onClick={() => toggleSort('company')} className="flex items-center gap-1 hover:text-foreground">
                    公司名称
                    {sortBy === 'company' && <span>{sortAsc ? '↑' : '↓'}</span>}
                  </button>
                </TableHead>
                <TableHead className="whitespace-nowrap">联系人</TableHead>
                <TableHead className="whitespace-nowrap">
                  <button onClick={() => toggleSort('country')} className="flex items-center gap-1 hover:text-foreground">
                    国家
                    {sortBy === 'country' && <span>{sortAsc ? '↑' : '↓'}</span>}
                  </button>
                </TableHead>
                <TableHead className="whitespace-nowrap">来源</TableHead>
                <TableHead className="whitespace-nowrap">
                  <button onClick={() => toggleSort('level')} className="flex items-center gap-1 hover:text-foreground">
                    等级
                    {sortBy === 'level' && <span>{sortAsc ? '↑' : '↓'}</span>}
                  </button>
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  <button onClick={() => toggleSort('status')} className="flex items-center gap-1 hover:text-foreground">
                    状态
                    {sortBy === 'status' && <span>{sortAsc ? '↑' : '↓'}</span>}
                  </button>
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  <button onClick={() => toggleSort('last_followup_at')} className="flex items-center gap-1 hover:text-foreground">
                    最近跟进
                    {sortBy === 'last_followup_at' && <span>{sortAsc ? '↑' : '↓'}</span>}
                  </button>
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    {search ? '没有找到匹配的客户' : '还没有客户，点击右上角"新增客户"添加'}
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((c, idx) => {
                  const lastFollowup = (c as any).last_followup_at;
                  const daysSince = lastFollowup
                    ? Math.floor((now - new Date(lastFollowup).getTime()) / (1000 * 60 * 60 * 24))
                    : null;
                  const needFollowUp = daysSince !== null && daysSince > 7 && c.status !== 'deal' && c.status !== 'lost';
                  const globalSeq = startIdx + idx + 1;
                  const hasIssues = (() => {
                    try {
                      const issues = JSON.parse(c.data_issues || '[]');
                      return issues.length > 0;
                    } catch {
                      return false;
                    }
                  })();
                  return (
                    <TableRow key={c.id} className={
                      hasIssues ? 'bg-red-100/80 border-l-4 border-l-red-500' :
                      needFollowUp ? 'bg-amber-50/50' : ''
                    }>
                      {batchMode && (
                        <TableCell className="text-center w-12">
                          <input
                            type="checkbox"
                            className="w-5 h-5 cursor-pointer rounded"
                            checked={selectedCustomers.has(c.id)}
                            onChange={() => {
                              const newSet = new Set(selectedCustomers);
                              if (newSet.has(c.id)) {
                                newSet.delete(c.id);
                              } else {
                                newSet.add(c.id);
                              }
                              setSelectedCustomers(newSet);
                            }}
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        <button
                          onClick={() => toggleStar(c.id)}
                          className="p-1 hover:bg-muted rounded"
                        >
                          <Star
                            className={`h-4 w-4 ${
                              (c as any).starred
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-gray-300'
                            }`}
                          />
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{globalSeq}</TableCell>
                      <TableCell className="font-medium">
                        <button
                          onClick={() => navigate(`/customers/${c.id}`)}
                          className="block max-w-[200px] truncate text-primary hover:underline text-left"
                        >
                          {c.company}
                        </button>
                        {hasIssues && (() => {
                          let issues: string[] = [];
                          try {
                            issues = JSON.parse(c.data_issues || '[]');
                          } catch {}
                          return (
                            <div className="text-xs text-red-600 mt-1">
                              {issues.join('、')}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm">{c.contact}</p>
                          <p className="text-xs text-muted-foreground">{c.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-[120px] truncate">{c.country}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <span className="block max-w-[100px] truncate">{c.source}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={CUSTOMER_LEVEL_META[c.level as CustomerLevel]?.color || ''} variant="secondary">
                          {CUSTOMER_LEVEL_META[c.level as CustomerLevel]?.label || c.level}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={CUSTOMER_STATUS_META[c.status as CustomerStatus]?.color || ''} variant="secondary">
                          {CUSTOMER_STATUS_META[c.status as CustomerStatus]?.label || c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {lastFollowup ? (
                          <span className={needFollowUp ? 'text-amber-600 font-medium' : 'text-muted-foreground'}>
                            {daysSince === 0 ? '今天' : `${daysSince}天前`}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">未跟进</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirm(c.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {/* 分页控件 */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="text-sm text-muted-foreground">
            共 {filtered.length} 个客户
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">每页</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-20 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">条</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                上一页
              </Button>
              <span className="text-sm mx-2">
                第 {currentPage} / {totalPages || 1} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCustomer ? '编辑客户' : '新增客户'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="company">公司名称 *</Label>
              <Input
                id="company"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="例如：ABC Trading Co."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="contact">联系人</Label>
                <Input
                  id="contact"
                  value={form.contact}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  placeholder="张三"
                />
              </div>
              <div className="grid gap-2 relative">
                <Label htmlFor="country">国家</Label>
                <Input
                  id="country"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  placeholder="输入搜索国家..."
                />
                {form.country && !COUNTRIES.includes(form.country) && (
                  <div className="absolute top-full mt-1 w-full bg-card border border-border rounded-md shadow-lg z-10 max-h-48 overflow-y-auto">
                    {COUNTRIES.filter(c => c.includes(form.country)).length > 0 ? (
                      COUNTRIES.filter(c => c.includes(form.country)).map((c) => (
                        <div
                          key={c}
                          className="px-3 py-2 text-sm hover:bg-muted cursor-pointer"
                          onClick={() => setForm({ ...form, country: c })}
                        >
                          {c}
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        未找到匹配国家，将自动设为"未知"
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="info@example.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">电话</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1 555-0100"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>客户等级</Label>
                <Select
                  value={form.level}
                  onValueChange={(v) => setForm({ ...form, level: v as CustomerLevel })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">未分级</SelectItem>
                    <SelectItem value="L0">L0</SelectItem>
                    <SelectItem value="L1">L1</SelectItem>
                    <SelectItem value="L2">L2</SelectItem>
                    <SelectItem value="L3">L3</SelectItem>
                    <SelectItem value="L4">L4</SelectItem>
                    <SelectItem value="低质">低质</SelectItem>
                    <SelectItem value="优质">优质</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>状态</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as CustomerStatus })}
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
              <div className="grid gap-2">
                <Label>来源</Label>
                <Select
                  value={form.source}
                  onValueChange={(v) => setForm({ ...form, source: v })}
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
            </div>
            <div className="grid gap-2">
              <Label htmlFor="products">主要需要产品</Label>
              <Input
                id="products"
                value={form.products}
                onChange={(e) => setForm({ ...form, products: e.target.value })}
                placeholder="如不锈钢餐具、保温杯..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="note">备注</Label>
              <Textarea
                id="note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="客户偏好、沟通要点..."
                rows={3}
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

      {/* 删除确认弹窗 */}
      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="py-4 text-sm text-muted-foreground">
            删除后该客户的所有信息和跟进记录将无法恢复，确定要删除吗？
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量导出弹窗 */}
      <Dialog open={batchExportOpen} onOpenChange={setBatchExportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>批量导出Excel</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* 模式切换 */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={exportMode === 'range' ? 'default' : 'outline'}
                onClick={() => setExportMode('range')}
              >
                序号范围
              </Button>
              <Button
                size="sm"
                variant={exportMode === 'check' ? 'default' : 'outline'}
                onClick={() => setExportMode('check')}
              >
                勾选客户
              </Button>
            </div>

            {exportMode === 'range' ? (
              <>
                <p className="text-sm text-muted-foreground">
                  总共有 {filtered.length} 个客户。选择要导出的序号范围：
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>开始序号</Label>
                    <Input
                      type="number"
                      min={1}
                      value={batchStart}
                      onChange={(e) => setBatchStart(Number(e.target.value))}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>结束序号</Label>
                    <Input
                      type="number"
                      min={1}
                      value={batchEnd || filtered.length}
                      onChange={(e) => setBatchEnd(Number(e.target.value))}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  勾选要导出的客户（已选 {checkedCustomers.size} 个）：
                </p>
                <div className="max-h-60 overflow-y-auto border rounded-md">
                  {filtered.map((c, idx) => (
                    <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted cursor-pointer border-b border-border/50">
                      <input
                        type="checkbox"
                        checked={checkedCustomers.has(c.id)}
                        onChange={() => {
                          const newSet = new Set(checkedCustomers);
                          if (newSet.has(c.id)) {
                            newSet.delete(c.id);
                          } else {
                            newSet.add(c.id);
                          }
                          setCheckedCustomers(newSet);
                        }}
                      />
                      <span className="text-muted-foreground w-8">{idx + 1}.</span>
                      {c.company}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchExportOpen(false)}>
              取消
            </Button>
            <Button onClick={() => {
              if (exportMode === 'range') {
                window.open(`/api/export?start=${batchStart}&end=${batchEnd || filtered.length}`, '_blank');
              } else {
                // 勾选模式导出
                const ids = Array.from(checkedCustomers).join(',');
                window.open(`/api/export?ids=${ids}`, '_blank');
              }
              setBatchExportOpen(false);
            }}>
              导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 问题客户弹窗 */}
      <Dialog open={issuesDialogOpen} onOpenChange={setIssuesDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-amber-500">⚠</span>
              数据问题列表（共 {customersWithIssues.length} 条）
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {customersWithIssues.map((c) => {
              let issues: string[] = [];
              try {
                issues = JSON.parse(c.data_issues || '[]');
              } catch (e) {
                // ignore parse errors
              }
              return (
                <div key={c.id} className="flex items-start justify-between py-2 px-3 border-b border-border/50 hover:bg-muted/50">
                  <div>
                    <div className="font-medium text-sm">{c.company}</div>
                    <div className="text-xs text-red-600 mt-1">
                      {issues.join('；')}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      window.location.href = `/customers/${c.id}`;
                    }}
                  >
                    去修改
                  </Button>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssuesDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 设置弹窗 - WebDAV同步 */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>数据同步设置</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {isBound ? (
              /* 已绑定状态 */
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2 text-green-700">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span className="font-medium">已连接</span>
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  账号：{syncConfig.webdav_user}
                </div>
              </div>
            ) : (
              /* 未绑定状态 */
              <>
                <div className="space-y-2">
                  <Label>坚果云WebDAV地址</Label>
                  <Input
                    value={syncConfig.webdav_url}
                    onChange={(e) => setSyncConfig({ ...syncConfig, webdav_url: e.target.value })}
                    placeholder="https://dav.jianguoyun.com/dav/"
                  />
                </div>
                <div className="space-y-2">
                  <Label>坚果云账号（邮箱）</Label>
                  <Input
                    value={syncConfig.webdav_user}
                    onChange={(e) => setSyncConfig({ ...syncConfig, webdav_user: e.target.value })}
                    placeholder="your@email.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>应用密码（不是登录密码，坚果云里生成）</Label>
                  <Input
                    type="password"
                    value={syncConfig.webdav_pass}
                    onChange={(e) => setSyncConfig({ ...syncConfig, webdav_pass: e.target.value })}
                    placeholder="在坚果云安全选项里生成应用密码"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              关闭
            </Button>
            {isBound ? (
              <Button
                variant="destructive"
                onClick={async () => {
                  try {
                    await fetch('/api/sync/logout', { method: 'POST' });
                    toast.success('已登出');
                    setIsBound(false);
                    setSettingsOpen(false);
                  } catch {
                    toast.error('操作失败');
                  }
                }}
              >
                登出
              </Button>
            ) : (
              <Button
                onClick={async () => {
                  try {
                    await fetch('/api/sync/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(syncConfig),
                    });
                    // 检查云端有没有数据
                    const checkRes = await fetch('/api/sync/check_remote', { method: 'POST' });
                    const checkData = await checkRes.json();
                    setRemoteHasData(checkData.has_remote);
                    setMergeDialogOpen(true);
                    setSettingsOpen(false);
                  } catch {
                    toast.error('保存失败');
                  }
                }}
              >
                绑定并保存
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 融合选择弹窗 */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>选择数据同步方式</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {remoteHasData ? (
              <p className="text-sm text-muted-foreground">
                检测到云端已有数据库，请选择同步方式：
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                云端没有数据库，将把本地数据上传到云端。
              </p>
            )}
            <div className="space-y-2">
              {remoteHasData && (
                <>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={async () => {
                      // 以云端为准：下载
                      try {
                        const res = await fetch('/api/sync/download', { method: 'POST' });
                        const data = await res.json();
                        if (data.ok) {
                          toast.success('已从云端下载数据');
                          window.location.reload();
                        } else {
                          toast.error(data.detail || '下载失败');
                        }
                      } catch {
                        toast.error('下载失败');
                      }
                    }}
                  >
                    以云端为准：下载云端数据，覆盖本地
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={async () => {
                      // 融合合并
                      try {
                        const res = await fetch('/api/sync/merge', { method: 'POST' });
                        const data = await res.json();
                        if (data.ok) {
                          toast.success(`融合完成，新增 ${data.added} 个客户，两端已同步`);
                          window.location.reload();
                        } else {
                          toast.error(data.detail || '融合失败');
                        }
                      } catch {
                        toast.error('融合失败');
                      }
                    }}
                  >
                    融合合并：两边数据合并，新增的都保留，两端一致
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={async () => {
                  // 以本地为准：上传
                  try {
                    const res = await fetch('/api/sync/upload', { method: 'POST' });
                    const data = await res.json();
                    if (data.ok) {
                      toast.success('已上传本地数据到云端');
                      window.location.reload();
                    } else {
                      toast.error(data.detail || '上传失败');
                    }
                  } catch {
                    toast.error('上传失败');
                  }
                }}
              >
                以本地为准：上传本地数据，覆盖云端
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
