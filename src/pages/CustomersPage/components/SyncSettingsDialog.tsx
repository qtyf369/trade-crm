import { useEffect, useState } from 'react';
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

type MergeChoice = 'download' | 'merge' | 'upload';

/** 坚果云 WebDAV 同步设置（从 CustomersPage 拆出） */
export default function SyncSettingsDialog({ open, onOpenChange }: Props) {
  const [state, setState] = useState<SyncState | null>(null);
  const [url, setUrl] = useState('https://dav.jianguoyun.com/dav');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [remoteHasData, setRemoteHasData] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadState = () => {
    fetch('/api/sync/config')
      .then((r) => r.json())
      .then((d: SyncState) => {
        setState(d);
        if (d.webdav_url) setUrl(d.webdav_url);
        if (d.webdav_user) setUser(d.webdav_user);
        setPass('');
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (open) {
      loadState();
      setTestResult(null);
    }
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
      await fetch('/api/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webdav_url: url, webdav_user: user, webdav_pass: pass, auto_sync: true,
        }),
      });
      const check = await (await fetch('/api/sync/check_remote', { method: 'POST' })).json();
      setRemoteHasData(!!check.has_remote);
      setMergeOpen(true);
      onOpenChange(false);
    } catch {
      toast.error('保存失败');
    }
  };

  const doSync = async (choice: MergeChoice) => {
    setBusy(true);
    try {
      const endpoint =
        choice === 'download' ? '/api/sync/download'
          : choice === 'merge' ? '/api/sync/merge'
            : '/api/sync/upload';
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        toast.error(data.detail || data.message || '操作失败');
        return;
      }
      const msg =
        choice === 'download' ? '已从云端下载数据'
          : choice === 'merge' ? `融合完成，新增 ${data.added ?? 0} 个客户`
            : '已上传本地数据到云端';
      toast.success(msg);
      setMergeOpen(false);
      window.location.reload();
    } catch {
      toast.error('操作失败');
    } finally {
      setBusy(false);
    }
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
                  onClick={() => { setRemoteHasData(true); setMergeOpen(true); }}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>选择数据同步方式</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {remoteHasData
                ? '检测到云端已有数据库，请选择同步方式（操作前会自动备份本地数据库）：'
                : '云端没有数据库，将把本地数据上传到云端。'}
            </p>
            <div className="space-y-2">
              {remoteHasData && (
                <>
                  <Button
                    variant="outline" className="w-full justify-start" disabled={busy}
                    onClick={() => doSync('download')}
                  >
                    以云端为准：下载云端数据，覆盖本地
                  </Button>
                  <Button
                    variant="outline" className="w-full justify-start" disabled={busy}
                    onClick={() => doSync('merge')}
                  >
                    融合合并：两边数据合并，新增的都保留，两端一致
                  </Button>
                </>
              )}
              <Button
                variant="outline" className="w-full justify-start" disabled={busy}
                onClick={() => doSync('upload')}
              >
                以本地为准：上传本地数据，覆盖云端
              </Button>
            </div>
            {busy && <p className="text-sm text-muted-foreground">处理中，请稍候…</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)} disabled={busy}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
