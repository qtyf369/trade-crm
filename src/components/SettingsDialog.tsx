import { useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const OPTIONS: { mode: ThemeMode; label: string; desc: string; icon: typeof Sun }[] = [
  { mode: 'light', label: '浅色', desc: '明亮配色', icon: Sun },
  { mode: 'dark', label: '深色', desc: '夜间护眼', icon: Moon },
  { mode: 'system', label: '跟随系统', desc: '与 Windows 设置一致', icon: Monitor },
];

/** 通用设置（主题等）。账号与同步在左上角头像菜单里 */
export default function SettingsDialog({ open, onOpenChange }: Props) {
  const { mode, change } = useTheme();
  const [local, setLocal] = useState<ThemeMode | null>(null);
  const current = local ?? mode;

  const pick = (m: ThemeMode) => {
    change(m);
    setLocal(m);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <p className="text-sm font-medium mb-3">主题</p>
          <div className="grid grid-cols-3 gap-3">
            {OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = current === opt.mode;
              return (
                <button
                  key={opt.mode}
                  onClick={() => pick(opt.mode)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all duration-200 hover:shadow-md active:scale-[0.97] ${
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/30'
                  }`}
                >
                  <Icon className={`h-6 w-6 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div>
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-6 pt-4 border-t border-border text-xs text-muted-foreground space-y-1">
            <p>账号与数据同步（坚果云）在左上角头像菜单中设置。</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
