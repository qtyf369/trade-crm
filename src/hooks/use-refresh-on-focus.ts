import { useEffect, useRef } from 'react';

/**
 * 当浏览器标签页重新获得焦点时，调用回调刷新数据。
 * 防止用户在多个标签页之间切换时用过时数据操作。
 *
 * @param refresh 刷新函数（如 reload / loadCustomers）
 * @param minIntervalMs 最小刷新间隔（默认 3000ms），避免频繁切换标签时反复请求
 */
export function useRefreshOnFocus(refresh: () => void, minIntervalMs = 3000) {
  const lastRefresh = useRef(Date.now());
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRefresh.current < minIntervalMs) return;
      lastRefresh.current = now;
      refreshRef.current();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [minIntervalMs]);
}
