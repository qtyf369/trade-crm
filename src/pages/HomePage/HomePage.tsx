import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserPlus, Clock, CheckCircle, ArrowRight } from 'lucide-react';
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

  useEffect(() => {
    api.listCustomers().then(setCustomers).catch(console.error);
    api.listFollowups().then(setFollowups).catch(console.error);
  }, []);

  const today = new Date().toDateString();
  const todayFollowups = followups.filter((f) => {
    if (!f.created_at) return false;
    return new Date(f.created_at).toDateString() === today;
  }).length;

  const stats = [
    {
      title: '客户总数',
      value: customers.length,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: '跟进中',
      value: customers.filter((c) => ['contacted', 'quoted', 'negotiating'].includes(c.status)).length,
      icon: Clock,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      title: '已成交',
      value: customers.filter((c) => c.status === 'deal').length,
      icon: CheckCircle,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      title: '今日已跟进',
      value: todayFollowups,
      icon: UserPlus,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
      onClick: () => navigate('/followups'),
    },
  ];

  const recentCustomers = customers.slice(0, 5);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* 页头 */}
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

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Card
            key={stat.title}
            className={stat.onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}
            onClick={stat.onClick}
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  <p className="text-3xl font-semibold mt-1">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-lg ${stat.bg}`}>
                  <stat.icon className={`h-6 w-6 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 最近客户 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>最近添加的客户</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate('/customers')}>
            查看全部
          </Button>
        </CardHeader>
        <CardContent>
          {recentCustomers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">还没有客户，点击"管理客户"添加第一个吧</p>
          ) : (
            <div className="space-y-3">
              {recentCustomers.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => navigate('/customers')}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-primary font-medium">{c.company.charAt(0)}</span>
                    </div>
                    <div>
                      <p className="font-medium">{c.company}</p>
                      <p className="text-sm text-muted-foreground">{c.contact} · {c.country}</p>
                    </div>
                  </div>
                  <Badge className={CUSTOMER_STATUS_META[c.status as keyof typeof CUSTOMER_STATUS_META]?.color || ''} variant="secondary">
                    {CUSTOMER_STATUS_META[c.status as keyof typeof CUSTOMER_STATUS_META]?.label || c.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
