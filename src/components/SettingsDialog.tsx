import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import {
  useTheme, type ThemeMode, COLOR_SCHEMES, COLOR_SCHEME_META, type ColorScheme,
} from '@/hooks/use-theme';
import SchemeAvatar from '@/components/SchemeAvatar';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MODE_OPTIONS: { mode: ThemeMode; label: string; desc: string; icon: typeof Sun }[] = [
  { mode: 'light', label: '浅色', desc: '明亮配色', icon: Sun },
  { mode: 'dark', label: '深色', desc: '夜间护眼', icon: Moon },
  { mode: 'system', label: '跟随系统', desc: '与系统一致', icon: Monitor },
];

/** 配色方案对应的色块预览色值 */
const SCHEME_PREVIEW: Record<ColorScheme, string> = {
  ocean:   'hsl(221 83% 45%)',
  emerald: 'hsl(160 84% 35%)',
  rose:    'hsl(346 77% 42%)',
  amber:   'hsl(38 92% 40%)',
  violet:  'hsl(262 52% 47%)',
  celadon: 'hsl(174 77% 35%)',
};

/** 配色方案场景描述 */
const SCHEME_SCENE: Record<ColorScheme, string> = {
  ocean:   '静心学习',
  emerald: '花间漫步',
  rose:    '满心欢喜',
  amber:   '掌灯夜行',
  violet:  '甜美梦乡',
  celadon: '品茗静坐',
};

/** 分节标题：小号大写感标签，参考 macOS 系统设置 / VS Code 设置页的分组标题 */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2.5 px-0.5 text-sm font-medium text-muted-foreground sm:text-[15px]">
      {children}
    </p>
  );
}

/** 通用设置（主题等）。账号与同步在左上角头像菜单里 */
export default function SettingsDialog({ open, onOpenChange }: Props) {
  // 主题即时生效并持久化，无需「保存」；「完成」仅用于关闭面板
  const { mode, changeMode, scheme, changeScheme } = useTheme();

  // 当前版本号（更新方式：运行新版本安装器，一键完成）
  const [version, setVersion] = useState('');

  useEffect(() => {
    if (!open) return;
    fetch('/api/version')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.version) setVersion(d.version); })
      .catch(() => {});
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 头部/底栏固定，仅中间内容区在极端矮视口下可滚，滚动条隐藏 */}
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[min(720px,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0">
        <DialogHeader className="shrink-0 px-7 pt-5 pb-3 sm:px-8 sm:pt-6 sm:pb-4">
          <DialogTitle className="text-[22px] sm:text-2xl">设置</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 pb-4 [-ms-overflow-style:none] [scrollbar-width:none] sm:space-y-6 sm:px-8 sm:pb-5 [&::-webkit-scrollbar]:hidden">
          {/* 外观模式 */}
          <section>
            <SectionLabel>外观模式</SectionLabel>
            <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
              {MODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = mode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    aria-pressed={active}
                    onClick={() => changeMode(opt.mode)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-1.5 py-2 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:gap-2.5 sm:px-3.5 sm:py-2.5 sm:text-left ${
                      active
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/40 hover:bg-muted/50'
                    }`}
                  >
                    {/* 窄屏纵向排列，宽屏恢复横向 */}
                    <Icon className={`shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'} h-[18px] w-[18px] sm:h-[19px] sm:w-[19px]`} />
                    <span className="w-full min-w-0 sm:flex-1">
                      {/* whitespace-nowrap：中文标签不允许被拆成单字竖排 */}
                      <span className="block whitespace-nowrap text-[15px] font-medium leading-tight sm:text-[17px]">
                        {opt.label}
                      </span>
                      <span className="mt-1 block whitespace-nowrap text-[13px] leading-tight text-muted-foreground sm:text-[15px]">
                        {opt.desc}
                      </span>
                    </span>
                    <Check
                      className={`hidden h-4 w-4 shrink-0 text-primary transition-opacity sm:block ${active ? 'opacity-100' : 'opacity-0'}`}
                      strokeWidth={3}
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {/* 配色方案：紧凑的横向卡片（比原设计大 20%，保证可读性） */}
          <section>
            <SectionLabel>配色方案</SectionLabel>
            {/* 列数随宽度自适应：窄屏 1 列 → 中屏 2 列 → 宽屏 3 列，避免卡片被压窄导致逐字换行 */}
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 md:gap-2.5">
              {COLOR_SCHEMES.map((s) => {
                const meta = COLOR_SCHEME_META[s];
                const active = scheme === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => changeScheme(s)}
                    className={`flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:gap-3 md:px-4 md:py-2.5 ${
                      active
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/40 hover:bg-muted/50'
                    }`}
                  >
                    {/* 小人：窄屏 56px / 宽屏 72px，尽量占满卡片左侧 */}
                    <SchemeAvatar scheme={s} className="h-14 w-14 shrink-0 md:h-[72px] md:w-[72px]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="whitespace-nowrap text-[15px] font-medium leading-tight md:text-[17px]">
                          {meta.label}
                        </span>
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/5 ring-inset md:h-3 md:w-3"
                          style={{ backgroundColor: SCHEME_PREVIEW[s] }}
                          title={SCHEME_SCENE[s]}
                        />
                      </span>
                      <span className="mt-0.5 block whitespace-nowrap text-[13px] leading-tight text-muted-foreground md:text-[15px]">
                        {SCHEME_SCENE[s]}
                      </span>
                    </span>
                    <Check
                      className={`h-[18px] w-[18px] shrink-0 text-primary transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
                      strokeWidth={3}
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {/* 界面大小：交给浏览器原生缩放，浏览器会自动记住 */}
          <section>
            <SectionLabel>界面大小</SectionLabel>
            <p className="text-sm leading-relaxed text-muted-foreground">
              在浏览器中按 <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">Ctrl</kbd>
              {' + '}
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">−</kbd>
              {' / '}
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">+</kbd>
              调整页面大小，浏览器会记住这个网站的比例，下次打开保持一致。
            </p>
          </section>
          {/* 换电脑 / 迁移数据 */}
          <section>
            <SectionLabel>换电脑</SectionLabel>
            <p className="text-sm leading-relaxed text-muted-foreground">
              把整个安装文件夹（包含 <code className="rounded bg-muted px-1 py-0.5 text-xs">data</code>
              文件夹）整个复制到新电脑，双击启动即可，
              客户数据、设置、坚果云账号都会一起过去。
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              如果已经绑定了坚果云，也可以不复制：在新电脑装好后绑定同一个账号，
              点「同步数据」→「融合」，数据会从云端拉回来。
            </p>
          </section>

          {/* 版本信息 */}
          <section>
            <SectionLabel>版本</SectionLabel>
            <p className="text-sm text-muted-foreground">
              当前版本 <span className="font-medium text-foreground">v{version || '…'}</span>
              <span className="ml-2 text-xs">
                （更新方式：拿到新版的安装包后双击运行即可，程序和数据都会自动处理）
              </span>
            </p>
          </section>
        </div>

        <DialogFooter className="shrink-0 border-t bg-muted/30 px-7 py-3 sm:items-center sm:justify-between sm:px-8 sm:py-3.5">
          {/* 说明文字缩小、强制单行，避免在窄屏下折行 */}
          <p className="whitespace-nowrap text-xs text-muted-foreground max-sm:hidden">
            账号与数据同步（坚果云）在左上角头像菜单中设置
          </p>
          <DialogClose asChild>
            <Button className="min-w-28 text-base max-sm:w-full">完成</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>

    </Dialog>
  );
}
