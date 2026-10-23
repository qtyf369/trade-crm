import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/data/api';

const LS_KEY_NICK = 'crm:nickname';
const LS_KEY_AVATAR = 'crm:avatar';
/** 本地改动待上传标记：离线/失败时置 1，上传成功后清除 */
const LS_KEY_PENDING = 'crm:profile_pending';

export interface ProfileState {
  /** 昵称 */
  nickname: string;
  /** 头像 base64 data URL */
  avatar: string;
  /** 正在加载云端数据 */
  loading: boolean;
  /** 正在保存 */
  saving: boolean;
  /** 是否有本地改动尚未同步到云端 */
  pending: boolean;
}

const readLocal = () => ({
  nickname: localStorage.getItem(LS_KEY_NICK) || '',
  avatar: localStorage.getItem(LS_KEY_AVATAR) || '',
  pending: localStorage.getItem(LS_KEY_PENDING) === '1',
});

const setPending = (v: boolean) => {
  if (v) localStorage.setItem(LS_KEY_PENDING, '1');
  else localStorage.removeItem(LS_KEY_PENDING);
};

/**
 * 用户画像管理：
 * - 本地 localStorage 始终缓存，确保即时显示（离线也能改）
 * - 保存时用 ref 里的「最新值」合并上传，避免旧闭包把另一字段覆盖成空
 * - bound=true 时上传云端（/crm/profile.json）；失败显式提示并保留待上传标记
 * - 绑定成功后若本地有待上传内容，自动推送上去
 */
export function useProfile(bound: boolean) {
  const [state, setState] = useState<ProfileState>(() => {
    const local = readLocal();
    return { nickname: local.nickname, avatar: local.avatar, loading: true, saving: false, pending: local.pending };
  });

  /** 始终指向最新值的镜像，避免 useCallback 闭包拿到旧 state */
  const latest = useRef({ nickname: state.nickname, avatar: state.avatar });

  const writeLocal = useCallback((next: { nickname?: string; avatar?: string }) => {
    if (next.nickname !== undefined) {
      if (next.nickname) localStorage.setItem(LS_KEY_NICK, next.nickname);
      else localStorage.removeItem(LS_KEY_NICK);
    }
    if (next.avatar !== undefined) {
      if (next.avatar) localStorage.setItem(LS_KEY_AVATAR, next.avatar);
      else localStorage.removeItem(LS_KEY_AVATAR);
    }
    latest.current = {
      nickname: next.nickname !== undefined ? next.nickname : latest.current.nickname,
      avatar: next.avatar !== undefined ? next.avatar : latest.current.avatar,
    };
    setState((s) => ({ ...s, ...next }));
  }, []);

  /** 把本地最新画像整体推到云端；返回是否成功 */
  const pushToCloud = useCallback(async (): Promise<boolean> => {
    setState((s) => ({ ...s, saving: true }));
    try {
      await api.saveProfile({
        nickname: latest.current.nickname,
        avatar: latest.current.avatar,
      });
      setPending(false);
      setState((s) => ({ ...s, saving: false, pending: false }));
      return true;
    } catch (e) {
      setPending(true);
      setState((s) => ({ ...s, saving: false, pending: true }));
      toast.error(
        `昵称/头像已存到本机，但同步到坚果云失败：${e instanceof Error ? e.message : '未知错误'}。` +
        '数据没有丢，联网或重新绑定后会自动重传。',
      );
      return false;
    }
  }, []);

  // 启动 / bound 变化：已绑定则拉云端，否则只用本地缓存
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (!bound) {
        if (alive) setState((s) => ({ ...s, loading: false }));
        return;
      }
      // 本地有未上传的改动：优先推送本地，避免被云端旧数据覆盖
      if (localStorage.getItem(LS_KEY_PENDING) === '1') {
        const ok = await pushToCloud();
        if (alive) setState((s) => ({ ...s, loading: false, saving: false, pending: !ok }));
        return;
      }
      try {
        const res = await api.getProfile();
        if (!alive) return;
        // exists=null 表示读取失败：保留本地缓存，绝不拿空值覆盖
        if (res.exists === null) {
          toast.error('读取云端昵称/头像失败，暂时使用本地缓存');
          setState((s) => ({ ...s, loading: false }));
          return;
        }
        // 云端确实没有（首次使用）：把本地已有的推送上去
        if (res.exists === false) {
          const local = latest.current;
          if (local.nickname || local.avatar) {
            const ok = await pushToCloud();
            if (alive) setState((s) => ({ ...s, loading: false, saving: false, pending: !ok }));
            return;
          }
          setState({ nickname: '', avatar: '', loading: false, saving: false, pending: false });
          return;
        }
        const nick = res.nickname || '';
        const av = res.avatar || '';
        writeLocal({ nickname: nick, avatar: av });
        setPending(false);
        setState({ nickname: nick, avatar: av, loading: false, saving: false, pending: false });
      } catch {
        // 请求本身失败（断网/后端未启动）：只保留本地缓存，绝不上传，
        // 否则会拿本地旧值覆盖云端（可能还更新）的数据。用户手动重试或下次启动再同步。
        setState((s) => ({ ...s, loading: false }));
      }
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [bound, pushToCloud, writeLocal]);

  /** 保存昵称（本地先落盘，再上传） */
  const saveNickname = useCallback(async (nickname: string) => {
    writeLocal({ nickname });
    if (!bound) {
      setPending(true);
      setState((s) => ({ ...s, pending: true }));
      toast.info('已保存到本机；绑定坚果云后会自动同步到云端');
      return;
    }
    await pushToCloud();
  }, [bound, pushToCloud, writeLocal]);

  /** 保存头像（自动压缩到 256×256，本地先落盘，再上传） */
  const saveAvatar = useCallback(async (file: File): Promise<string | null> => {
    const dataUrl = await compressImage(file);
    if (!dataUrl) {
      toast.error('图片读取失败，请换一张图片');
      return null;
    }
    writeLocal({ avatar: dataUrl });
    if (!bound) {
      setPending(true);
      setState((s) => ({ ...s, pending: true }));
      toast.info('头像已保存到本机；绑定坚果云后会自动同步到云端');
      return dataUrl;
    }
    await pushToCloud();
    return dataUrl;
  }, [bound, pushToCloud, writeLocal]);

  /** 移除头像 */
  const removeAvatar = useCallback(async () => {
    writeLocal({ avatar: '' });
    if (!bound) {
      setPending(true);
      setState((s) => ({ ...s, pending: true }));
      return;
    }
    await pushToCloud();
  }, [bound, pushToCloud, writeLocal]);

  /** 手动重试上传（有未同步改动时用） */
  const retrySync = useCallback(async () => {
    if (!bound) {
      toast.error('请先绑定坚果云账号');
      return;
    }
    const ok = await pushToCloud();
    if (ok) toast.success('昵称/头像已同步到云端');
  }, [bound, pushToCloud]);

  /** 刷新（绑定/解绑坚果云后调用） */
  const refresh = useCallback(async () => {
    if (!bound) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await api.getProfile();
      if (res.exists === null) {
        toast.error('读取云端昵称/头像失败，暂时使用本地缓存');
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      if (res.exists === false) {
        setState((s) => ({ ...s, loading: false }));
        await pushToCloud();
        return;
      }
      const nick = res.nickname || '';
      const av = res.avatar || '';
      writeLocal({ nickname: nick, avatar: av });
      setPending(false);
      setState({ nickname: nick, avatar: av, loading: false, saving: false, pending: false });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [bound, pushToCloud, writeLocal]);

  return { ...state, saveNickname, saveAvatar, removeAvatar, refresh, retrySync };
}

/** 压缩图片到 256×256，返回 base64 data URL */
function compressImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 256;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          const scale = MAX / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}
