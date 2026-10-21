import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, MessageSquare, Ship } from 'lucide-react';

const navItems = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard, end: true },
  { path: '/customers', label: '客户管理', icon: Users, end: false },
  { path: '/followups', label: '跟进记录', icon: MessageSquare, end: false },
];

export default function Layout() {
  return (
    <div className="flex min-h-screen">
      {/* 侧边栏 */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col shrink-0">
        <div className="h-16 flex items-center gap-2 px-6 border-b border-sidebar-border">
          <Ship className="h-6 w-6 text-sidebar-accent-foreground" />
          <span className="font-semibold text-lg">外贸CRM</span>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 text-xs text-sidebar-foreground/40 border-t border-sidebar-border">
          单人离线版 v0.1
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 min-w-0 bg-background">
        <Outlet />
      </main>
    </div>
  );
}
