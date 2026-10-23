import { toast } from 'sonner';

/**
 * 处理乐观锁冲突（409）和记录已删除（404）错误。
 * 返回 true 表示是冲突错误（已处理），false 表示其他错误（未处理）。
 */
export function handleConflictError(error: unknown, onRefresh?: () => void): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message || '';

  if (msg.includes('409') || msg.includes('已被其他操作修改') || msg.includes('已被修改')) {
    toast.error('数据冲突', {
      description: '该记录已被其他操作修改，请刷新页面查看最新数据后重试。',
      duration: 5000,
    });
    onRefresh?.();
    return true;
  }

  if (msg.includes('404') || msg.includes('不存在') || msg.includes('已删除')) {
    toast.error('记录不存在', {
      description: '该记录可能已被删除，请刷新页面。',
      duration: 5000,
    });
    onRefresh?.();
    return true;
  }

  return false;
}
