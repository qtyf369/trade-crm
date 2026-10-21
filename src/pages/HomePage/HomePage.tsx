import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserPlus, Clock, CheckCircle, ArrowRight, MessageSquare } from 'lucide-react';
import { api } from '@/data/api';
import type { ICustomer, IFollowUp } from '@/data/types';
import { CUSTOMER_STATUS_META } from '@/data/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function HomePage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<ICustomer[]>([]);
  const [followups, setFollowups] = useState<IFollowUp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.listCustomers({ page: 1, page_size: 5, sort_by: 'created_at', sort_asc: false }),
      api.listFollowups({ page: 1, page_size: 100 }),
    ])
      .then(([c, f]) => {
        if (!alive) return;
        setCustomers(c.items);
        setFollowups(f.items);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // 挂载时取一次时间基准（React Compiler 要求渲染过程保持纯净）
  const [nowTs] = useState(() => Date.now());

  const todayFollowups = followups.filter((f) => {
    if (!f.created_at) return false;
    return new Date(f.created_at.replace(' ', 'T')).toDateString() === new Date(nowTs).toDateString();
  }).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">仪表盘</h1>
          <p className="text-muted-foreground text-sm mt-1">外贸客户管理概览</p>
        </div>
        <Button onClick={() => navigate('/customers')}>
          管理客户
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {/* 统计卡片：总数类指标单独请求 total，避免拉全量 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title="客户总数" icon={Users} color="text-blue-600" bg="bg-blue-50 dark:bg-blue-950/40" />
        <StatCard
          title="跟进中"
          icon={Clock}
          color="text-amber-600"
          bg="bg-amber-50 dark:bg-amber-950/40"
          query={{ status: 'contacted,quoted,negotiating' }}
        />
        <StatCard
          title="已成交"
          icon={CheckCircle}
          color="text-green-600"
          bg="bg-green-50 dark:bg-green-950/40"
          query={{ status: 'deal' }}
        />
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/followups')}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">今日已跟进</p>
                <p className="text-3xl font-semibold mt-1">{todayFollowups}</p>
              </div>
              <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/40">
                <UserPlus className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 最近客户 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>最近添加的客户</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/customers')}>查看全部</Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-center py-8 text-sm">加载中…</p>
            ) : customers.length === 0 ? (
              <p className="text-muted-foreground text-center py-8 text-sm">还没有客户，点击"管理客户"添加第一个吧</p>
            ) : (
              <div className="space-y-3">
                {customers.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer"
                    onClick={() => navigate(`/customers/${c.id}`)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-primary font-medium">{c.company.charAt(0)}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{c.company}</p>
                        <p className="text-sm text-muted-foreground truncate">{c.contact} · {c.country}</p>
                      </div>
                    </div>
                    <Badge
                      className={CUSTOMER_STATUS_META[c.status as keyof typeof CUSTOMER_STATUS_META]?.color || ''}
                      variant="secondary"
                    >
                      {CUSTOMER_STATUS_META[c.status as keyof typeof CUSTOMER_STATUS_META]?.label || c.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 最近跟进 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>最近跟进</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/followups')}>查看全部</Button>
          </CardHeader>
          <CardContent>
            {followups.length === 0 ? (
              <p className="text-muted-foreground text-center py-8 text-sm">还没有跟进记录</p>
            ) : (
              <div className="space-y-3">
                {followups.slice(0, 5).map((f) => (
                  <div key={f.id} className="flex gap-3 p-3 rounded-lg border border-border">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <MessageSquare className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {f.created_at ? new Date(f.created_at.replace(' ', 'T')).toLocaleString('zh-CN') : ''}
                      </p>
                      <p className="text-sm truncate">{f.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** 只显示一个数字的统计卡：用 total 字段，不拉全量数据 */
function StatCard({
  title, icon, color, bg, query,
}: {
  title: string;
  icon: typeof Users;
  color: string;
  bg: string;
  query?: Parameters<typeof api.listCustomers>[0];
}) {
  const [value, setValue] = useState<number | '…'>('…');

  useEffect(() => {
    let alive = true;
    api.listCustomers({ page: 1, page_size: 1, ...query })
      .then((r) => { if (alive) setValue(r.total); })
      .catch(() => { if (alive) setValue(0); });
    return () => { alive = false; };
  }, [query]);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-3xl font-semibold mt-1">{value}</p>
          </div>
          <div className={`p-3 rounded-lg ${bg}`}>
            {(() => { const Icon = icon; return <Icon className={`h-6 w-6 ${color}`} />; })()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
