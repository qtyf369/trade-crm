import { useEffect, useState } from 'react';
import { GitMerge, Upload, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SyncState {
  webdav_url: string;
  webdav_user: string;
  webdav_pass_saved: boolean;
  auto_sync: boolean;
}

interface Fingerprint {
  size: number;
  mtime: number;
}

interface InspectResult {
  bound?: boolean;
  status: 'no_remote' | 'same' | 'local_newer' | 'remote_newer' | 'diverged'
        | 'remote_empty' | 'unbound' | 'error';
  local?: Fingerprint;
  remote?: Fingerprint;
  local_counts?: { customers: number; followups: number };
  remote_counts?: { customers: number; followups: number };
  message?: string;
}

/** 坚果云 WebDAV 同步设置（从 CustomersPage 拆出） */
export default function SyncSettingsDialog({ open, onOpenChange }: Props) {
  const [state, setState] = useState<SyncState | null>(null);
  const [url, setUrl] = useState('https://dav.jianguoyun.com/dav');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 延后一帧执行，避免在 effect 中同步 setState 触发级联渲染
    const t = setTimeout(() => {
      fetch('/api/sync/config')
        .then((r) => r.json())
        .then((d: SyncState) => {
          setState(d);
          if (d.webdav_url) setUrl(d.webdav_url);
          if (d.webdav_user) setUser(d.webdav_user);
          setPass('');
        })
        .catch(() => {});
      setTestResult(null);
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const bound = !!state?.webdav_pass_saved;

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/sync/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webdav_url: url, webdav_user: user, webdav_pass: pass }),
      });
      setTestResult(await res.json());
    } catch {
      setTestResult({ ok: false, message: '请求失败' });
    } finally {
      setTesting(false);
    }
  };

  const bind = async () => {
    try {
      const res = await fetch('/api/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webdav_url: url, webdav_user: user, webdav_pass: pass, auto_sync: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.detail || `绑定失败：HTTP ${res.status}`);
        return;
      }
      // 本地有未同步的昵称/头像时，绑定后立刻整体推送（以本地为准）
      const hasPending = localStorage.getItem('crm:profile_pending') === '1';
      if (hasPending) {
        await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nickname: localStorage.getItem('crm:nickname') || '',
            avatar: localStorage.getItem('crm:avatar') || '',
          }),
        }).then((r) => {
          if (r.ok) {
            localStorage.removeItem('crm:profile_pending');
            toast.success('本地昵称/头像已同步到坚果云');
          } else {
            toast.error('昵称/头像同步失败，可在侧栏点击「待同步」重试');
          }
        }).catch(() => {
          toast.error('昵称/头像同步失败，联网后可在侧栏点击「待同步」重试');
        });
      }
      onOpenChange(false);
      // 绑定完成后立即对比两端数据，让用户选择如何处理
      setMergeOpen(true);
      setInspecting(true);
      fetch('/api/sync/inspect')
        .then((r) => r.json())
        .then((d: InspectResult) => {
          setInspect(d);
        })
        .catch(() => setInspect({ status: 'error' }))
        .finally(() => setInspecting(false));
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : '网络错误'}`);
    }
  };

  const doSync = async (choice: 'local' | 'remote' | 'merge') => {
    setBusy(true);
    try {
      const res = await fetch('/api/sync/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        toast.error(data.detail || data.message || '操作失败');
        return;
      }
      const msg =
        choice === 'remote' ? '已用云端数据覆盖本地'
          : choice === 'merge'
            ? `融合完成：新增 ${data.added ?? 0}，更新 ${data.updated ?? 0}，跟进 +${data.followups_added ?? 0}`
            : '已用本地数据覆盖云端';
      toast.success(msg);
      setMergeOpen(false);
      setTimeout(() => window.location.reload(), 600);
    } catch {
      toast.error('操作失败，请检查网络');
    } finally {
      setBusy(false);
    }
  };

  /** 打开同步面板时先探测两端状态 */
  const openSyncPanel = async () => {
    setMergeOpen(true);
    setInspecting(true);
    setInspect(null);
    try {
      const res = await fetch('/api/sync/inspect');
      const data = await res.json();
      setInspect(data);
    } catch {
      setInspect({ status: 'error' } as InspectResult);
    } finally {
      setInspecting(false);
    }
  };

  const fmtTime = (ts?: number) => {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>数据同步设置</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {bound ? (
              <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="font-medium">已连接</span>
                </div>
                <div className="text-sm text-muted-foreground mt-1">账号：{state?.webdav_user}</div>
                <div className="text-sm text-muted-foreground mt-1 break-all">{state?.webdav_url}</div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>坚果云WebDAV地址</Label>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://dav.jianguoyun.com/dav/" />
                </div>
                <div className="space-y-2">
                  <Label>坚果云账号（邮箱）</Label>
                  <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="your@email.com" />
                </div>
                <div className="space-y-2">
                  <Label>应用密码（不是登录密码，坚果云里生成）</Label>
                  <Input
                    type="password"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    placeholder="在坚果云安全选项里生成应用密码"
                  />
                </div>
                {testResult && (
                  <p className={`text-sm ${testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                    {testResult.message}
                  </p>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
            {bound ? (
              <>
                <Button
                  variant="outline"
                  onClick={openSyncPanel}
                >
                  同步数据
                </Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    try {
                      await fetch('/api/sync/logout', { method: 'POST' });
                      toast.success('已登出');
                      onOpenChange(false);
                      window.location.reload();
                    } catch {
                      toast.error('操作失败');
                    }
                  }}
                >
                  登出
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={testConnection} disabled={testing || !url || !user}>
                  {testing ? '测试中…' : '测试连接'}
                </Button>
                <Button onClick={bind} disabled={!url || !user || !pass}>
                  绑定并保存
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 同步方式选择 */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>数据同步</DialogTitle>
          </DialogHeader>

          {inspecting ? (
            <p className="py-6 text-center text-sm text-muted-foreground">正在对比本地与云端数据…</p>
          ) : (
            <div className="space-y-4">
              {/* 两端状态对比 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-medium text-muted-foreground">本地数据</div>
                  <div className="mt-1 text-lg font-semibold">
                    {inspect?.local_counts?.customers ?? '—'}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">个客户</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {inspect?.local_counts?.followups ?? '—'} 条跟进
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    更新于 {fmtTime(inspect?.local?.mtime)}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-medium text-muted-foreground">云端数据</div>
                  <div className="mt-1 text-lg font-semibold">
                    {inspect?.remote_counts?.customers != null && inspect.remote_counts.customers >= 0
                      ? inspect.remote_counts.customers
                      : inspect?.remote?.size === 0 ? 0 : '—'}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">个客户</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {inspect?.remote_counts?.followups != null && inspect.remote_counts.followups >= 0
                      ? `${inspect.remote_counts.followups} 条跟进`
                      : inspect?.remote?.size === 0 ? '无数据' : '—'}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    更新于 {fmtTime(inspect?.remote?.mtime)}
                  </div>
                </div>
              </div>

              {/* 状态提示 */}
              {inspect?.status === 'same' && (
                <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
                  ✓ 本地与云端完全一致，无需同步
                </p>
              )}
              {inspect?.status === 'remote_empty' && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  ⚠ 云端数据库为空（0 字节），建议「以本地为准」上传修复
                </p>
              )}
              {inspect?.status === 'local_newer' && (
                <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                  本地数据较新，建议上传到云端
                </p>
              )}
              {inspect?.status === 'remote_newer' && (
                <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                  云端数据较新，建议从云端更新本地
                </p>
              )}
              {inspect?.status === 'diverged' && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  ⚠ 两端都有改动，推荐用「融合」保留双方数据
                </p>
              )}
              {inspect?.status === 'no_remote' && (
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  云端还没有数据库，上传后即可多端使用
                </p>
              )}

              {/* 操作选项 */}
              <div className="space-y-2">
                <Button
                  className="w-full justify-start" disabled={busy}
                  onClick={() => doSync('merge')}
                >
                  <GitMerge className="h-4 w-4" />
                  融合（推荐）：两端合并，数据都不丢
                </Button>
                <Button
                  variant="outline" className="w-full justify-start" disabled={busy}
                  onClick={() => doSync('local')}
                >
                  <Upload className="h-4 w-4" />
                  以本地为准：上传本地覆盖云端
                </Button>
                <Button
                  variant="outline" className="w-full justify-start" disabled={busy}
                  onClick={() => doSync('remote')}
                >
                  <Download className="h-4 w-4" />
                  以云端为准：下载云端覆盖本地
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                覆盖操作会自动备份本地数据库；融合后两端数据保持一致。
              </p>
              {busy && <p className="text-sm text-muted-foreground">处理中，请稍候…</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)} disabled={busy}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
