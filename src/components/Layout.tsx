import { useEffect, useRef, useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, MessageSquare, Ship, Cloud, LogOut, Settings, ChevronDown } from 'lucide-react';
import { useAccountState } from '@/hooks/use-account';
import SettingsDialog from '@/components/SettingsDialog';
import SyncSettingsDialog from '@/pages/CustomersPage/components/SyncSettingsDialog';

const navItems = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard, end: true },
  { path: '/customers', label: '客户管理', icon: Users, end: false },
  { path: '/followups', label: '跟进记录', icon: MessageSquare, end: false },
];

export default function Layout() {
  const account = useAccountState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncKey, setSyncKey] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点外面关菜单
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const openSync = () => {
    setSyncKey((k) => k + 1); // 每次打开重挂载，刷新账号状态
    setSyncOpen(true);
    setMenuOpen(false);
  };

  const displayName = account.email
    ? account.email.split('@')[0].slice(0, 2).toUpperCase()
    : '我';

  const statusColor = account.bound ? 'bg-green-500' : 'bg-red-500';
  const statusText = account.loading
    ? '检查中…'
    : account.bound
      ? `已绑定坚果云${account.hasRemote ? '（云端有数据）' : ''}`
      : '离线模式 · 数据仅存本地';

  return (
    <div className="flex min-h-screen">
      {/* 侧边栏 */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col shrink-0">
        {/* 头像 + 账号菜单 */}
        <div className="relative border-b border-sidebar-border" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-full h-16 flex items-center gap-3 px-5 hover:bg-sidebar-accent/40 transition-colors"
          >
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-full bg-primary/90 flex items-center justify-center text-primary-foreground text-sm font-semibold">
                {displayName}
              </div>
              {/* 状态点：离线红 / 已绑定绿 */}
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${statusColor} rounded-full border-2 border-sidebar`}
                title={statusText}
              />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium truncate">
                {account.bound ? '云同步已开启' : '本地账户'}
              </div>
              <div className="text-xs text-sidebar-foreground/50 truncate">{statusText}</div>
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 text-sidebar-foreground/40 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <div className="absolute top-full left-3 right-3 mt-1 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg py-1 z-50">
              <button
                onClick={openSync}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <Cloud className="h-4 w-4 text-muted-foreground" />
                {account.bound ? '账号与数据同步' : '绑定坚果云账号'}
              </button>
              <button
                onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                设置
              </button>
              {account.bound && (
                <button
                  onClick={openSync}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-destructive hover:bg-muted transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  登出坚果云
                </button>
              )}
            </div>
          )}
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

        <div className="p-4 text-xs text-sidebar-foreground/40 border-t border-sidebar-border flex items-center gap-2">
          <Ship className="h-3.5 w-3.5" />
          外贸CRM v0.2 · 单人离线版
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 min-w-0 bg-background">
        <Outlet />
      </main>

      {/* 全局弹窗 */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {syncOpen && (
        <SyncSettingsDialog key={syncKey} open={syncOpen} onOpenChange={setSyncOpen} />
      )}
    </div>
  );
}
