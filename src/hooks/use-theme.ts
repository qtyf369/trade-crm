import { useCallback, useEffect, useRef, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export type ColorScheme =
  | 'ocean'    // 海洋蓝（默认）
  | 'emerald'  // 翡翠绿
  | 'rose'     // 玫瑰红
  | 'amber'    // 琥珀金
  | 'violet'   // 薰衣紫
  | 'celadon'; // 青瓷

export const COLOR_SCHEME_META: Record<ColorScheme, { label: string; emoji: string }> = {
  ocean:   { label: '海洋蓝', emoji: '🌊' },
  emerald: { label: '翡翠绿', emoji: '💎' },
  rose:    { label: '玫瑰红', emoji: '🌹' },
  amber:   { label: '琥珀金', emoji: '✨' },
  violet:  { label: '薰衣紫', emoji: '🔮' },
  celadon: { label: '青瓷',   emoji: '🫖' },
};

export const COLOR_SCHEMES: ColorScheme[] = ['ocean', 'emerald', 'rose', 'amber', 'violet', 'celadon'];

const MODE_KEY = 'crm-theme';
const SCHEME_KEY = 'crm-color-scheme';

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

function applyMode(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

function applyScheme(scheme: ColorScheme) {
  document.documentElement.setAttribute('data-color-scheme', scheme);
}

/** 把设置推送到后端（本地必定落盘，已绑定时同步到坚果云） */
function pushSettings(payload: { mode?: ThemeMode; scheme?: ColorScheme }) {
  const merged = {
    mode: payload.mode ?? (localStorage.getItem(MODE_KEY) as ThemeMode) ?? 'system',
    scheme: payload.scheme ?? (localStorage.getItem(SCHEME_KEY) as ColorScheme) ?? 'ocean',
  };
  // 失败静默：本地已保存，不打扰用户
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: merged }),
  }).catch(() => {});
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(MODE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });

  const [scheme, setScheme] = useState<ColorScheme>(() => {
    const saved = localStorage.getItem(SCHEME_KEY);
    return COLOR_SCHEMES.includes(saved as ColorScheme) ? (saved as ColorScheme) : 'ocean';
  });

  /** 云端设置是否已合并过，避免重复请求 */
  const pulled = useRef(false);

  // 启动时拉取云端设置（本地已有值也覆盖，云端为跨设备权威）
  useEffect(() => {
    if (pulled.current) return;
    pulled.current = true;
    let alive = true;
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (!alive || !res || !res.settings) return;
        const s = res.settings;
        if (s.mode === 'light' || s.mode === 'dark' || s.mode === 'system') {
          localStorage.setItem(MODE_KEY, s.mode);
          setMode(s.mode);
        }
        if (COLOR_SCHEMES.includes(s.scheme)) {
          localStorage.setItem(SCHEME_KEY, s.scheme);
          setScheme(s.scheme);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // 应用 mode + 跟随系统变化
  useEffect(() => {
    applyMode(resolve(mode));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (mode === 'system') applyMode(resolve('system')); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  useEffect(() => { applyScheme(scheme); }, [scheme]);

  const changeMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(MODE_KEY, next);
    setMode(next);
    pushSettings({ mode: next });
  }, []);

  const changeScheme = useCallback((next: ColorScheme) => {
    localStorage.setItem(SCHEME_KEY, next);
    setScheme(next);
    pushSettings({ scheme: next });
  }, []);

  return {
    mode, resolved: resolve(mode), changeMode,
    scheme, changeScheme,
  };
}
