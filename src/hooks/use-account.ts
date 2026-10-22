import { useEffect, useState } from 'react';
import { api } from '@/data/api';

export interface AccountState {
  /** 坚果云已绑定（有账号+密码） */
  bound: boolean;
  /** 云端有数据库文件（可用于同步判断） */
  hasRemote: boolean;
  loading: boolean;
  email: string;
}

/** 侧栏头像用的账号状态：离线=红点，已绑坚果云=绿点 */
export function useAccountState(): AccountState {
  const [state, setState] = useState<AccountState>({
    bound: false, hasRemote: false, loading: true, email: '',
  });

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const cfg = await api.getSyncConfig();
        if (!alive) return;
        const bound = !!cfg.webdav_pass_saved;
        let hasRemote = false;
        if (bound) {
          try {
            const check = await api.checkRemote();
            hasRemote = !!check.has_remote;
          } catch { /* 忽略网络失败，按无远端处理 */ }
        }
        setState({ bound, hasRemote, loading: false, email: cfg.webdav_user || '' });
      } catch {
        if (alive) setState({ bound: false, hasRemote: false, loading: false, email: '' });
      }
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, []);

  return state;
}
