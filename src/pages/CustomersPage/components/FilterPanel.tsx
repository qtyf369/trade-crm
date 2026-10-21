import { useEffect, useState } from 'react';
import { X, Star, AlertTriangle } from 'lucide-react';
import { CUSTOMER_LEVELS, CUSTOMER_STATUSES, STATUS_LABELS, LEVEL_LABELS } from '@/data/constants';
import { Button } from '@/components/ui/button';

interface Props {
  selectedCountries: string[];
  setSelectedCountries: (v: string[]) => void;
  selectedLevels: string[];
  setSelectedLevels: (v: string[]) => void;
  selectedStatuses: string[];
  setSelectedStatuses: (v: string[]) => void;
  selectedSources: string[];
  setSelectedSources: (v: string[]) => void;
  starredOnly: boolean;
  setStarredOnly: (v: boolean) => void;
  issuesOnly: boolean;
  setIssuesOnly: (v: boolean) => void;
  onReset: () => void;
}

const SOURCES = ['阿里巴巴国际站', '展会', 'Google', '其他'];

/** 多选 checkbox 列表，抽出来避免每个维度重复四遍 */
function CheckGroup({
  options, value, onChange, labelFor,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  labelFor: (v: string) => string;
}) {
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className="space-y-1">
      {options.map((opt) => (
        <label key={opt || 'empty'} className="flex items-center gap-2 text-sm hover:bg-muted p-1 rounded cursor-pointer">
          <input
            type="checkbox"
            className="rounded"
            checked={value.includes(opt)}
            onChange={() => toggle(opt)}
          />
          {labelFor(opt)}
        </label>
      ))}
    </div>
  );
}

export default function FilterPanel(props: Props) {
  const {
    selectedCountries, setSelectedCountries,
    selectedLevels, setSelectedLevels,
    selectedStatuses, setSelectedStatuses,
    selectedSources, setSelectedSources,
    starredOnly, setStarredOnly,
    issuesOnly, setIssuesOnly,
    onReset,
  } = props;

  return (
    <div className="mb-4 p-4 border rounded-lg bg-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">筛选条件</h3>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <X className="mr-1 h-3 w-3" />
          重置
        </Button>
      </div>

      <div className="mb-3 pb-3 border-b border-border flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="rounded" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} />
          <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          只看星标客户
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="rounded" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} />
          <AlertTriangle className="h-4 w-4 text-red-500" />
          只看有数据问题的客户
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <div className="text-sm font-medium mb-2">国家</div>
          <div className="max-h-40 overflow-y-auto">
            <CountryFilter value={selectedCountries} onChange={setSelectedCountries} />
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-2">等级</div>
          <CheckGroup
            options={[...CUSTOMER_LEVELS]}
            value={selectedLevels}
            onChange={setSelectedLevels}
            labelFor={(v) => LEVEL_LABELS[v] ?? v}
          />
        </div>
        <div>
          <div className="text-sm font-medium mb-2">来源</div>
          <CheckGroup
            options={SOURCES}
            value={selectedSources}
            onChange={setSelectedSources}
            labelFor={(v) => v}
          />
        </div>
        <div>
          <div className="text-sm font-medium mb-2">状态</div>
          <CheckGroup
            options={[...CUSTOMER_STATUSES]}
            value={selectedStatuses}
            onChange={setSelectedStatuses}
            labelFor={(v) => STATUS_LABELS[v] ?? v}
          />
        </div>
      </div>
    </div>
  );
}

/** 国家筛选：选项来自数据库里实际出现过的国家，需要单独拉一次 */
function CountryFilter({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [countries, setCountries] = useState(() => [] as string[]);

  useEffect(() => {
    let alive = true;
    fetch('/api/customers?page=1&page_size=500')
      .then((r) => r.json())
      .then((d: { items: { country: string }[] }) => {
        if (alive) setCountries([...new Set(d.items.map((c) => c.country).filter(Boolean))].sort());
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const toggle = (c: string) =>
    onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);

  return (
    <div className="space-y-1">
      {countries.map((c) => (
        <label key={c} className="flex items-center gap-2 text-sm hover:bg-muted p-1 rounded cursor-pointer">
          <input type="checkbox" className="rounded" checked={value.includes(c)} onChange={() => toggle(c)} />
          {c}
        </label>
      ))}
    </div>
  );
}
