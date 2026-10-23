import { useEffect, useRef, useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, MessageSquare, Settings, Cloud, LogOut, ChevronDown, Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/data/api';
import { useAccountState } from '@/hooks/use-account';
import { useProfile } from '@/hooks/use-profile';
import SettingsDialog from '@/components/SettingsDialog';
import SyncSettingsDialog from '@/pages/CustomersPage/components/SyncSettingsDialog';

const navItems = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard, end: true },
  { path: '/customers', label: '客户管理', icon: Users, end: false },
  { path: '/followups', label: '跟进记录', icon: MessageSquare, end: false },
];

export default function Layout() {
  const account = useAccountState();
  const profile = useProfile(account.bound);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncKey, setSyncKey] = useState(0);
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setSyncKey((k) => k + 1);
    setSyncOpen(true);
    setMenuOpen(false);
  };

  const isBound = account.bound;
  const statusDot = isBound ? 'bg-emerald-400' : 'bg-red-400';
  const statusLabel = account.loading
    ? '检查中…'
    : isBound
      ? '云同步已开启'
      : '离线模式 · 数据仅存本地';

  /** 头像占位文字：优先昵称前两字，否则邮箱前两字 */
  const initials = profile.nickname
    ? profile.nickname.slice(0, 2)
    : account.email
      ? account.email.split('@')[0].slice(0, 2).toUpperCase()
      : '我';

  const startEditNick = () => {
    setNickDraft(profile.nickname);
    setEditingNick(true);
  };

  const commitNick = () => {
    const trimmed = nickDraft.trim();
    if (trimmed && trimmed !== profile.nickname) {
      profile.saveNickname(trimmed);
    }
    setEditingNick(false);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col shrink-0 overflow-y-auto">
        {/* 标题 + 头像 + 账号菜单 */}
        <div className="relative border-b border-sidebar-border" ref={menuRef}>
          {/* "我的CRM" 标题 */}
          <div className="px-5 pt-4 pb-1">
            <h1 className="text-base font-bold tracking-wide text-sidebar-foreground">我的CRM</h1>
          </div>

          {/* 头像行 */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-sidebar-accent/40 transition-colors"
          >
            {/* 头像 */}
            <div className="relative shrink-0 group">
              {profile.avatar ? (
                <img src={profile.avatar} alt="头像" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-primary/80 flex items-center justify-center text-primary-foreground text-sm font-semibold">
                  {initials}
                </div>
              )}
              {/* 状态点 */}
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${statusDot} rounded-full border-2 border-sidebar`}
                title={statusLabel}
              />
              {/* 悬浮相机（仅云端可用） */}
              {isBound && (
                <div
                  className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <Camera className="h-4 w-4 text-white" />
                </div>
              )}
              {/* 移除头像 */}
              {isBound && profile.avatar && (
                <button
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); profile.removeAvatar(); }}
                  title="移除头像"
                >
                  <X className="h-2.5 w-2.5 text-white" />
                </button>
              )}
            </div>

            {/* 昵称 + 状态 */}
            <div className="flex-1 min-w-0 text-left">
              {isBound ? (
                <>
                  {/* 昵称行 */}
                  {editingNick ? (
                    <input
                      autoFocus
                      className="w-full text-sm font-semibold bg-transparent border-b border-sidebar-foreground/30 outline-none text-sidebar-foreground"
                      value={nickDraft}
                      onChange={(e) => setNickDraft(e.target.value)}
                      onBlur={commitNick}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitNick(); if (e.key === 'Escape') setEditingNick(false); }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div
                      className="text-sm font-semibold truncate cursor-pointer hover:text-sidebar-accent-foreground transition-colors group/nick"
                      onClick={(e) => { e.stopPropagation(); startEditNick(); }}
                      title="点击修改昵称"
                    >
                      {profile.nickname || '点击设置昵称'}
                      <span className="ml-1 text-[10px] text-sidebar-foreground/40 opacity-0 group-hover/nick:opacity-100 transition-opacity">✏</span>
                    </div>
                  )}
                  {/* 云同步状态 — 独立小行 */}
                  <div className="text-xs text-sidebar-foreground/50 truncate mt-0.5">
                    {profile.saving ? (
                      '同步昵称/头像中…'
                    ) : profile.pending ? (
                      <button
                        className="text-amber-400/90 hover:underline"
                        onClick={(e) => { e.stopPropagation(); profile.retrySync(); }}
                        title="点击重新上传到坚果云"
                      >
                        待同步 · 点击重试
                      </button>
                    ) : statusLabel}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-medium truncate">离线使用</div>
                  <div className="text-xs text-sidebar-foreground/40 truncate mt-0.5">数据仅存本地</div>
                </>
              )}
            </div>

            <ChevronDown className={`h-4 w-4 shrink-0 text-sidebar-foreground/40 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* 隐藏文件选择器 */}          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) profile.saveAvatar(file);
              e.target.value = '';
            }}
          />

          {/* 下拉菜单 */}
          {menuOpen && (
            <div className="absolute top-full left-3 right-3 mt-1 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg py-1 z-50">
              <button
                onClick={openSync}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <Cloud className="h-4 w-4 text-muted-foreground" />
                {isBound ? '账号与数据同步' : '绑定坚果云账号'}
              </button>
              {isBound && (
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    try {
                      await api.syncLogout();
                      toast.success('已登出（本地昵称/头像已保留，重新绑定后自动恢复）');
                      window.location.reload();
                    } catch {
                      toast.error('登出失败');
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-destructive hover:bg-muted transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  登出坚果云
                </button>
              )}
            </div>
          )}
        </div>

        {/* 导航 */}
        <nav className="flex-1 py-3 px-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-200 ${
                  isActive && !settingsOpen
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground hover:translate-x-0.5'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}

          {/* 设置入口（侧栏直接显示） */}
          <button
            onClick={() => setSettingsOpen(true)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-200 ${
              settingsOpen
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground hover:translate-x-0.5'
            }`}
          >
            <Settings className="h-4 w-4" />
            设置
          </button>
        </nav>

        <div className="p-4 text-xs text-sidebar-foreground/40 border-t border-sidebar-border flex items-center gap-2">
          外贸CRM v0.2 · 单人离线版
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 min-w-0 bg-background overflow-y-auto">
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
