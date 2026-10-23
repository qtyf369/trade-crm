import { useCallback, useEffect, useState } from 'react';

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
const ZOOM_KEY = 'crm-ui-zoom';

/** 可选界面缩放比例（%） */
export const ZOOM_LEVELS = [100, 90, 80, 75, 67, 50] as const;
export type ZoomLevel = typeof ZOOM_LEVELS[number];

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
  // 移除旧的配色 data 属性，设置新的
  document.documentElement.setAttribute('data-color-scheme', scheme);
}

/**
 * 应用界面缩放。
 *
 * 浏览器自身的 Ctrl+滚轮 缩放无法被网页脚本控制，这里用 CSS zoom 实现等效效果：
 * 整个应用按比例缩放，且能随配置保存。用 zoom 而非 transform:scale，
 * 是因为 zoom 会同时改变布局占位，滚动与定位都保持正常。
 */
function applyZoom(percent: number) {
  const root = document.documentElement;
  if (percent === 100) {
    root.style.zoom = '';
    root.removeAttribute('data-ui-zoom');
    return;
  }
  root.style.zoom = String(percent / 100);
  root.setAttribute('data-ui-zoom', String(percent));
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

  const [zoom, setZoom] = useState<number>(() => {
    const saved = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOM_LEVELS.includes(saved as ZoomLevel) ? saved : 100;
  });

  // 应用 mode + 跟随系统变化
  useEffect(() => {
    applyMode(resolve(mode));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (mode === 'system') applyMode(resolve('system')); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  // 应用配色方案
  useEffect(() => {
    applyScheme(scheme);
  }, [scheme]);

  // 应用界面缩放
  useEffect(() => {
    applyZoom(zoom);
  }, [zoom]);

  const changeMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(MODE_KEY, next);
    setMode(next);
  }, []);

  const changeScheme = useCallback((next: ColorScheme) => {
    localStorage.setItem(SCHEME_KEY, next);
    setScheme(next);
  }, []);

  const changeZoom = useCallback((next: number) => {
    if (!ZOOM_LEVELS.includes(next as ZoomLevel)) return;
    localStorage.setItem(ZOOM_KEY, String(next));
    setZoom(next);
  }, []);

  return {
    mode, resolved: resolve(mode), changeMode,
    scheme, changeScheme,
    zoom, changeZoom,
  };
}
