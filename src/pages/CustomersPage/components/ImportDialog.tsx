import { useRef } from 'react';
import { Download, FileUp, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 用户选好了文件 */
  onFile: (file: File) => void;
}

/**
 * 导入 Excel 前的引导弹窗：
 * 1. 首次使用 → 下载模板（带表头说明、下拉选项、日期/号码格式保护）
 * 2. 已有模板/导出文件 → 直接选择文件导入
 */
export default function ImportDialog({ open, onOpenChange, onFile }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = () => fileRef.current?.click();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>导入 Excel</DialogTitle>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              onOpenChange(false);
              onFile(f);
            }
            e.target.value = '';
          }}
        />

        <div className="space-y-3 py-1">
          <p className="text-sm text-muted-foreground">
            第一次导入？建议先下载模板，按模板的列和格式填写，导入更顺利。
          </p>

          <div className="grid gap-2">
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3"
              onClick={() => window.open('/api/import/template', '_blank')}
            >
              <Download className="mr-2 h-4 w-4 shrink-0" />
              <span className="text-left">
                <span className="block font-medium">下载导入模板</span>
                <span className="block text-xs text-muted-foreground">
                  含每列的填写说明、下拉选项和示例行
                </span>
              </span>
            </Button>

            <Button
              className="w-full justify-start h-auto py-3"
              onClick={pickFile}
            >
              <FileUp className="mr-2 h-4 w-4 shrink-0" />
              <span className="text-left">
                <span className="block font-medium">选择文件导入</span>
                <span className="block text-xs text-muted-foreground/80">
                  已有模板或之前导出的 Excel
                </span>
              </span>
            </Button>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
            公司名与现有客户重复的行会自动跳过，不会重复导入。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
