/**
 * 配色方案对应的可爱小人 SVG 插画（v2）
 *
 * 设计要点：
 * - 画布 64×64，主体占比更大，缩小显示时依然清晰
 * - 统一 1.2 描边（深色半透明），避免小尺寸下发虚
 * - 每个场景都有明确动作与夸张表情，更活灵活现：
 *   海洋=读书看入迷 / 翡翠=举花献宝 / 玫瑰=放爱心 / 琥珀=提灯照亮
 *   薰衣=打呼噜抱枕睡 / 青瓷=端着热茶眯眼笑
 */
import type { ColorScheme } from '@/hooks/use-theme';

interface Props {
  scheme: ColorScheme;
  className?: string;
}

/** 统一色值，与 SCHEME_PREVIEW 对应 */
const C: Record<ColorScheme, {
  main: string; light: string; skin: string; hair: string; shade: string;
}> = {
  ocean:   { main: '#3b82f6', light: '#93c5fd', skin: '#fde8d0', hair: '#4a3728', shade: '#1e40af' },
  emerald: { main: '#059669', light: '#6ee7b7', skin: '#fde8d0', hair: '#3b2f2f', shade: '#065f46' },
  rose:    { main: '#e11d48', light: '#fda4af', skin: '#fde8d0', hair: '#5c3a21', shade: '#9f1239' },
  amber:   { main: '#d97706', light: '#fcd34d', skin: '#fde8d0', hair: '#4a3728', shade: '#92400e' },
  violet:  { main: '#7c3aed', light: '#c4b5fd', skin: '#fde8d0', hair: '#2d1b4e', shade: '#4c1d95' },
  celadon: { main: '#0d9488', light: '#5eead4', skin: '#fde8d0', hair: '#3b2f2f', shade: '#115e59' },
};

/** 描边样式：小尺寸下保留轮廓 */
const OUT = { stroke: 'rgba(55,65,81,0.45)', strokeWidth: 1.2, strokeLinejoin: 'round' as const };

export default function SchemeAvatar({ scheme, className }: Props) {
  const c = C[scheme];
  const svgProps = { viewBox: '0 0 64 64', className, fill: 'none' as const };

  switch (scheme) {
    // 读书看入迷：双手捧书、身体露出来、眼睛发亮，头上飘个惊叹号
    case 'ocean':
      return (
        <svg {...svgProps}>
          {/* 地面 */}
          <ellipse cx="32" cy="57" rx="18" ry="3" fill={c.main} opacity="0.16" />
          {/* 腿（盘腿坐） */}
          <path d="M24 48 Q28 53 32 51 Q36 53 40 48" stroke={c.skin} strokeWidth="4.6" strokeLinecap="round" {...OUT} />
          {/* 身体：完整可见 */}
          <path d="M24 33 Q32 29.5 40 33 L41.5 47 Q32 50 22.5 47 Z" fill={c.main} {...OUT} />
          {/* 双臂捧书（从身体两侧伸出，托住书） */}
          <path d="M24.5 38 Q24 43 27 44.5" stroke={c.skin} strokeWidth="4.2" strokeLinecap="round" {...OUT} />
          <path d="M39.5 38 Q40 43 37 44.5" stroke={c.skin} strokeWidth="4.2" strokeLinecap="round" {...OUT} />
          {/* 摊开的书（举在身体前方，不遮挡腿） */}
          <path d="M24 40 L32 38.5 L40 40 L40 46 L32 48 L24 46 Z" fill={c.light} {...OUT} />
          <path d="M32 38.5 L32 48" stroke={c.shade} strokeWidth="1" opacity="0.55" />
          <path d="M26 41.6 L30 42.4 M26 43.6 L30 44.4" stroke={c.shade} strokeWidth="0.9" opacity="0.5" strokeLinecap="round" />
          <path d="M34 42.4 L38 41.6 M34 44.4 L38 43.6" stroke={c.shade} strokeWidth="0.9" opacity="0.5" strokeLinecap="round" />
          {/* 头 */}
          <circle cx="32" cy="19" r="13" fill={c.skin} {...OUT} />
          {/* 头发：蓬松蘑菇头 */}
          <path d="M19 19c0-7.5 5.8-12 13-12s13 4.5 13 12c0-4.5-4-7.5-13-7.5S19 14.5 19 19z" fill={c.hair} />
          <path d="M20.5 17.5c1.5-4 6-6 11.5-6s10 2 11.5 6c-2-2.5-6-3.8-11.5-3.8s-9.5 1.3-11.5 3.8z" fill={c.hair} opacity="0.85" />
          {/* 眼睛：超大星星眼（看入迷到发光） */}
          <ellipse cx="26.5" cy="19.5" rx="3.2" ry="3.6" fill="#2d3748" />
          <ellipse cx="37.5" cy="19.5" rx="3.2" ry="3.6" fill="#2d3748" />
          <circle cx="27.6" cy="18.3" r="1.5" fill="#fff" />
          <circle cx="38.6" cy="18.3" r="1.5" fill="#fff" />
          <circle cx="25.4" cy="21.2" r="0.7" fill="#fff" opacity="0.8" />
          <circle cx="36.4" cy="21.2" r="0.7" fill="#fff" opacity="0.8" />
          {/* 眉毛高挑（惊讶） */}
          <path d="M23.5 14.4 Q27 12.4 30 14" stroke={c.hair} strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
          <path d="M34 14 Q37 12.4 40.5 14.4" stroke={c.hair} strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
          {/* 腮红加大 */}
          <ellipse cx="21.8" cy="23.4" rx="3.3" ry="2.1" fill={c.light} opacity="0.85" />
          <ellipse cx="42.2" cy="23.4" rx="3.3" ry="2.1" fill={c.light} opacity="0.85" />
          {/* 张大嘴惊叹 */}
          <ellipse cx="32" cy="25" rx="2.8" ry="2.6" fill="#8d5b4c" />
          <ellipse cx="32" cy="26.2" rx="1.5" ry="1" fill="#c97a6a" />
          {/* 头顶惊叹号（加大） */}
          <g transform="rotate(12 48 10)">
            <rect x="46.4" y="1.5" width="4.2" height="9.5" rx="2.1" fill={c.main} />
            <circle cx="48.5" cy="14.2" r="2.2" fill={c.main} />
          </g>
          {/* 小汗滴 */}
          <path d="M14.5 12.5 Q16 15.5 14.5 17 Q13 15.5 14.5 12.5 Z" fill={c.light} opacity="0.9" />
        </svg>
      );

    // 举花献宝：双手举花过头，单脚跳，笑得眯眼
    case 'emerald':
      return (
        <svg {...svgProps}>
          {/* 地面 */}
          <ellipse cx="32" cy="57" rx="19" ry="3" fill={c.main} opacity="0.16" />
          {/* 小花（高举右手） */}
          <path d="M45 26 Q47 20 45.5 15" stroke={c.shade} strokeWidth="1.8" strokeLinecap="round" />
          <g>
            <circle cx="45.5" cy="11" r="3.4" fill={c.main} />
            <circle cx="41.6" cy="13" r="3" fill={c.light} />
            <circle cx="49.4" cy="13" r="3" fill={c.light} />
            <circle cx="43" cy="7.2" r="3" fill={c.light} />
            <circle cx="48" cy="7.2" r="3" fill={c.light} />
            <circle cx="45.5" cy="10.6" r="2.2" fill="#fcd34d" />
          </g>
          {/* 叶子 */}
          <ellipse cx="41.5" cy="20" rx="3.6" ry="1.8" fill={c.main} opacity="0.8" transform="rotate(-28 41.5 20)" />
          {/* 身体（跳起） */}
          <path d="M25 34 Q32 31 39 34 L40.5 47 Q32 50 23.5 47 Z" fill={c.main} {...OUT} />
          {/* 左臂上举 */}
          <path d="M25 35 Q21 31 21.5 26" stroke={c.skin} strokeWidth="4.2" strokeLinecap="round" {...OUT} />
          {/* 右臂高举握花 */}
          <path d="M39 35 Q43 30 45 26.5" stroke={c.skin} strokeWidth="4.2" strokeLinecap="round" {...OUT} />
          {/* 腿（单脚踮起） */}
          <path d="M29 48.5 L28.5 54" stroke={c.skin} strokeWidth="3.6" strokeLinecap="round" {...OUT} />
          <path d="M35 48.5 Q37 52 36 54.5" stroke={c.skin} strokeWidth="3.6" strokeLinecap="round" {...OUT} />
          {/* 头 */}
          <circle cx="32" cy="20" r="12.5" fill={c.skin} {...OUT} />
          {/* 头发 + 叶饰 */}
          <path d="M19.5 20c0-7 5.6-11.5 12.5-11.5S44.5 13 44.5 20c0-4.4-4-7.2-12.5-7.2S19.5 15.6 19.5 20z" fill={c.hair} />
          <ellipse cx="41" cy="10.5" rx="3.4" ry="1.7" fill={c.main} opacity="0.85" transform="rotate(28 41 10.5)" />
          <ellipse cx="37.5" cy="8" rx="2.8" ry="1.4" fill={c.light} transform="rotate(-12 37.5 8)" />
          {/* 笑得眯眼 ^ ^（加大） */}
          <path d="M22.8 20.5 Q26.5 16.6 30.2 20.5" stroke="#2d3748" strokeWidth="2.3" strokeLinecap="round" fill="none" />
          <path d="M33.8 20.5 Q37.5 16.6 41.2 20.5" stroke="#2d3748" strokeWidth="2.3" strokeLinecap="round" fill="none" />
          {/* 腮红 */}
          <ellipse cx="21.5" cy="24.8" rx="3.4" ry="2.2" fill={c.light} opacity="0.9" />
          <ellipse cx="42.5" cy="24.8" rx="3.4" ry="2.2" fill={c.light} opacity="0.9" />
          {/* 大笑（张嘴露牙，更夸张） */}
          <path d="M25.6 25 Q32 32.5 38.4 25 Z" fill="#8d5b4c" />
          <path d="M27.4 25.9 Q32 27.6 36.6 25.9" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          <ellipse cx="32" cy="29.6" rx="2.6" ry="1.7" fill="#c97a6a" />
        </svg>
      );

    // 放爱心：双手捧着飞出的爱心，眨眼俏皮
    case 'rose':
      return (
        <svg {...svgProps}>
          {/* 地面 */}
          <ellipse cx="32" cy="57" rx="17" ry="3" fill={c.main} opacity="0.16" />
          {/* 飞出的大爱心（右上方） */}
          <path d="M47 12c-2.6-3.4-7.4-2.6-8 1.4-.6-4-5.4-4.8-8-1.4-2 4.2 6.6 9.4 8 10.2 1.4-.8 10-6 8-10.2z" fill={c.main} {...OUT} />
          <ellipse cx="35.5" cy="12.5" rx="1.5" ry="2" fill="#fff" opacity="0.6" transform="rotate(-25 35.5 12.5)" />
          {/* 小爱心 */}
          <path d="M53 26c-1.3-1.7-3.7-1.3-4 .7-.3-2-2.7-2.4-4-.7-1 2.1 3.3 4.7 4 5.1.7-.4 5-3 4-5.1z" fill={c.light} opacity="0.9" />
          {/* 身体 */}
          <path d="M24 33 Q32 30 40 33 L41.5 48 Q32 51 22.5 48 Z" fill={c.main} {...OUT} />
          {/* 双臂捧心 */}
          <path d="M24.5 36 Q20.5 40 22 44" stroke={c.skin} strokeWidth="4.2" strokeLinecap="round" {...OUT} />
          <path d="M39.5 36 Q43.5 40 42 44" stroke={c.skin} strokeWidth="4.2" strokeLinecap="round" {...OUT} />
          {/* 腿 */}
          <path d="M28.5 49 L28 54.5" stroke={c.skin} strokeWidth="3.6" strokeLinecap="round" {...OUT} />
          <path d="M35.5 49 L36 54.5" stroke={c.skin} strokeWidth="3.6" strokeLinecap="round" {...OUT} />
          {/* 头 */}
          <circle cx="32" cy="19" r="12.5" fill={c.skin} {...OUT} />
          {/* 头发 + 双马尾 + 蝴蝶结 */}
          <path d="M19.5 19c0-7 5.6-11.5 12.5-11.5S44.5 12 44.5 19c0-4.4-4-7.2-12.5-7.2S19.5 14.6 19.5 19z" fill={c.hair} />
          <path d="M19.8 19c-2.4 4.5-1.6 10 1 13" stroke={c.hair} strokeWidth="3.4" strokeLinecap="round" />
          <path d="M44.2 19c2.4 4.5 1.6 10-1 13" stroke={c.hair} strokeWidth="3.4" strokeLinecap="round" />
          <g>
            <path d="M40.5 7.5c-2.6-2.4-5.2.2-3.6 2.6 1-1.4 3-1.6 3.6-2.6z" fill={c.light} />
            <path d="M40.5 7.5c2.4-2.4 5 .2 3.4 2.6-.8-1.4-2.8-1.6-3.4-2.6z" fill={c.light} />
            <circle cx="40.4" cy="8.4" r="1.3" fill={c.shade} />
          </g>
          {/* 左眼超大 + 右眼眨眼 😉 */}
          <ellipse cx="26.5" cy="19.5" rx="3.2" ry="3.6" fill="#2d3748" />
          <circle cx="27.6" cy="18.3" r="1.5" fill="#fff" />
          <circle cx="25.4" cy="21.2" r="0.7" fill="#fff" opacity="0.8" />
          <path d="M33.8 19.8 Q37.5 15.8 41.2 19.8" stroke="#2d3748" strokeWidth="2.3" strokeLinecap="round" fill="none" />
          {/* 眉毛俏皮挑起 */}
          <path d="M23 14.6 Q26.5 12.8 30 14.2" stroke={c.hair} strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
          {/* 腮红加大 */}
          <ellipse cx="21.2" cy="23.8" rx="3.6" ry="2.3" fill={c.light} opacity="0.9" />
          <ellipse cx="42.8" cy="23.8" rx="3.6" ry="2.3" fill={c.light} opacity="0.9" />
          {/* 俏皮小嘴（吐舌） */}
          <path d="M28.8 24.9 Q32 28.2 35.2 24.9" stroke="#8d5b4c" strokeWidth="1.9" strokeLinecap="round" fill="none" />
          <path d="M31 27.2 Q32 29.4 33 27.2 Z" fill="#f472b6" />
        </svg>
      );

    // 提灯照亮：提灯笼侧身走，灯光晕开，得意笑
    case 'amber':
      return (
        <svg {...svgProps}>
          {/* 光晕 */}
          <circle cx="48" cy="20" r="13" fill={c.light} opacity="0.22" />
          <circle cx="48" cy="20" r="8" fill={c.light} opacity="0.3" />
          {/* 灯笼 */}
          <line x1="48" y1="8" x2="48" y2="12" stroke={c.shade} strokeWidth="1.3" />
          <path d="M42.5 12 Q48 9 53.5 12 L54.5 24 Q48 27.5 41.5 24 Z" fill={c.main} {...OUT} />
          <path d="M44 14 Q48 12.5 52 14 L52.7 22 Q48 23.8 43.3 22 Z" fill={c.light} opacity="0.75" />
          <line x1="41.5" y1="24" x2="54.5" y2="24" stroke={c.shade} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="48" y1="24" x2="48" y2="27" stroke={c.shade} strokeWidth="1.2" />
          {/* 光芒 */}
          <g stroke={c.light} strokeWidth="1.4" strokeLinecap="round" opacity="0.75">
            <line x1="48" y1="2.5" x2="48" y2="5" />
            <line x1="57" y1="12" x2="59.5" y2="10.6" />
            <line x1="39" y1="12" x2="36.5" y2="10.6" />
          </g>
          {/* 身体（微微侧身） */}
          <path d="M20 34 Q28 30.5 36 34 L37 48 Q28 51 19 48 Z" fill={c.main} {...OUT} />
          {/* 右臂提灯 */}
          <path d="M34.5 36 Q40 33 43.5 28" stroke={c.skin} strokeWidth="4.2" strokeLinecap="round" {...OUT} />
          {/* 左臂叉腰（得意） */}
          <path d="M20.5 37 Q16 40 19.5 43" stroke={c.skin} strokeWidth="4.2" strokeLinecap="round" {...OUT} />
          {/* 腿 */}
          <path d="M25 49 L23.5 55" stroke={c.skin} strokeWidth="3.6" strokeLinecap="round" {...OUT} />
          <path d="M32 49 L34 55" stroke={c.skin} strokeWidth="3.6" strokeLinecap="round" {...OUT} />
          {/* 头 */}
          <circle cx="28" cy="20" r="12.5" fill={c.skin} {...OUT} />
          {/* 头发 */}
          <path d="M15.5 20c0-7 5.6-11.5 12.5-11.5S40.5 13 40.5 20c0-4.4-4-7.2-12.5-7.2S15.5 15.6 15.5 20z" fill={c.hair} />
          {/* 小毡帽 */}
          <path d="M17.5 15 Q28 6 38.5 15 Z" fill={c.main} {...OUT} />
          <path d="M15.5 15.2 L40.5 15.2" stroke={c.shade} strokeWidth="2.6" strokeLinecap="round" />
          {/* 得意眼（一高一低）+ 眨眼 */}
          <ellipse cx="22.6" cy="20.2" rx="3" ry="3.4" fill="#2d3748" />
          <circle cx="23.6" cy="19" r="1.4" fill="#fff" />
          <path d="M30.8 20.4 Q33.6 17.4 36.4 20.4" stroke="#2d3748" strokeWidth="2.3" strokeLinecap="round" fill="none" />
          {/* 挑眉（夸张） */}
          <path d="M18.8 15.2 Q23 12.8 27.2 14.8" stroke={c.hair} strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
          <path d="M30.6 14.4 Q33.6 13.2 36.8 15" stroke={c.hair} strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
          {/* 腮红 */}
          <ellipse cx="16.8" cy="24.2" rx="3.2" ry="2.1" fill={c.light} opacity="0.9" />
          <ellipse cx="39.2" cy="24.2" rx="3.2" ry="2.1" fill={c.light} opacity="0.9" />
          {/* 咧嘴大笑露牙 */}
          <path d="M24 25 Q28 30.4 32 25 Z" fill="#8d5b4c" />
          <path d="M25.4 25.9 Q28 27.2 30.6 25.9" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );

    // 打呼噜抱枕睡：头枕枕头、闭眼张嘴打呼，头顶飘 Zzz
    case 'violet':
      return (
        <svg {...svgProps}>
          {/* 床 */}
          <path d="M6 52 Q32 48 58 52 L58 57 Q32 60 6 57 Z" fill={c.main} opacity="0.3" />
          <path d="M6 52 Q32 48 58 52" stroke={c.shade} strokeWidth="1.4" opacity="0.45" />
          {/* 枕头（在头下方，不遮脸） */}
          <path d="M13 45 Q24 41 37 45 L37 53 Q24 56 13 53 Z" fill="#fff" {...OUT} />
          <path d="M16 47.5 Q24 45 34 47.5" stroke={c.shade} strokeWidth="1" opacity="0.3" strokeLinecap="round" />
          {/* 被子 */}
          <path d="M26 47 Q42 43 55 48 L55 56 Q42 59 26 56 Z" fill={c.main} {...OUT} />
          <path d="M31 50 Q42 47.5 50 50" stroke={c.light} strokeWidth="1.4" opacity="0.7" strokeLinecap="round" />
          {/* 头（完整露出，压在枕头上） */}
          <circle cx="26" cy="29" r="12.5" fill={c.skin} {...OUT} />
          {/* 蓬松头发 */}
          <path d="M13.5 29c0-7 5.6-11.5 12.5-11.5S38.5 22 38.5 29c0-4.4-4-7.2-12.5-7.2S13.5 24.6 13.5 29z" fill={c.hair} />
          <circle cx="16" cy="19" r="3.4" fill={c.hair} />
          <circle cx="22" cy="16" r="3.6" fill={c.hair} />
          <circle cx="29" cy="17" r="3.2" fill={c.hair} />
          {/* 闭眼（睡得香） */}
          <path d="M18.4 29.5 Q21.5 32.6 24.6 29.5" stroke="#2d3748" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <path d="M27.4 29.5 Q30.5 32.6 33.6 29.5" stroke="#2d3748" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          {/* 腮红 */}
          <ellipse cx="15.8" cy="34" rx="3.4" ry="2.2" fill={c.light} opacity="0.9" />
          <ellipse cx="36.2" cy="34" rx="3.4" ry="2.2" fill={c.light} opacity="0.9" />
          {/* 张嘴 O 形打呼（加大） */}
          <ellipse cx="26" cy="35.8" rx="2.9" ry="3.3" fill="#8d5b4c" />
          <ellipse cx="26" cy="37.2" rx="1.6" ry="1.4" fill="#c97a6a" />
          {/* 口水泡泡 */}
          <circle cx="35" cy="39.5" r="2.2" fill={c.light} opacity="0.9" />
          <circle cx="39" cy="42.5" r="1.5" fill={c.light} opacity="0.65" />
          <circle cx="42" cy="45" r="1" fill={c.light} opacity="0.45" />
          {/* Zzz（加大） */}
          <g fill={c.shade} opacity="0.8" fontFamily="sans-serif" fontWeight="bold">
            <text x="41" y="15" fontSize="11">z</text>
            <text x="48" y="8.5" fontSize="8.5">z</text>
            <text x="54" y="3.5" fontSize="6.5">z</text>
          </g>
          {/* 小星星 */}
          <text x="5" y="14" fontSize="6.5" fill={c.light} opacity="0.85">✦</text>
        </svg>
      );

    // 端茶眯眼笑：双手捧着热茶杯举在身前，蒸汽袅袅，满足地眯眼
    case 'celadon':
      return (
        <svg {...svgProps}>
          {/* 地面 */}
          <ellipse cx="32" cy="57" rx="19" ry="3" fill={c.main} opacity="0.16" />
          {/* 腿（盘腿坐） */}
          <path d="M23 48 Q28 53 32 51 Q37 53 41 48" stroke={c.skin} strokeWidth="4.4" strokeLinecap="round" {...OUT} />
          {/* 身体 */}
          <path d="M18 33 Q26 29.5 34 33 L35.5 47 Q26 50 17 47 Z" fill={c.main} {...OUT} />
          {/* 双臂向前捧杯 */}
          <path d="M32.5 36 Q37 38 38 42" stroke={c.skin} strokeWidth="4.2" strokeLinecap="round" {...OUT} />
          <path d="M20 37 Q25 39.5 28 42" stroke={c.skin} strokeWidth="4.2" strokeLinecap="round" {...OUT} />
          {/* 茶杯（在双手之间、身体前方） */}
          <path d="M30 36 L42 36 L40.8 45 Q36 47.4 31.2 45 Z" fill={c.main} {...OUT} />
          <path d="M31.2 37.4 L40.8 37.4 L39.9 43.4 Q36 44.8 32.1 43.4 Z" fill={c.light} opacity="0.65" />
          {/* 杯把 */}
          <path d="M42 38.5 Q46.5 38.5 46.5 41.5 Q46.5 44.5 42 44.5" stroke={c.shade} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          {/* 茶托 */}
          <ellipse cx="36" cy="46.5" rx="8" ry="2.2" fill={c.shade} opacity="0.4" />
          {/* 蒸汽 */}
          <path d="M33 33 Q35 29.5 33 26 Q31 22.5 33 19" stroke={c.light} strokeWidth="1.7" strokeLinecap="round" fill="none" opacity="0.85" />
          <path d="M38.5 32.5 Q40.5 29 38.5 25.5 Q36.5 22 38.5 18.5" stroke={c.light} strokeWidth="1.7" strokeLinecap="round" fill="none" opacity="0.6" />
          {/* 头 */}
          <circle cx="26" cy="20" r="12.5" fill={c.skin} {...OUT} />
          {/* 头发 + 丸子头 + 簪子 */}
          <path d="M13.5 20c0-7 5.6-11.5 12.5-11.5S38.5 13 38.5 20c0-4.4-4-7.2-12.5-7.2S13.5 15.6 13.5 20z" fill={c.hair} />
          <circle cx="26" cy="7" r="5.2" fill={c.hair} />
          <line x1="21.5" y1="7" x2="30.5" y2="7" stroke={c.main} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="31" cy="7" r="1.6" fill={c.light} />
          {/* 眯眼笑 ^ ^（加大，满足到眯成缝） */}
          <path d="M17.8 21 Q21 17.4 24.2 21" stroke="#2d3748" strokeWidth="2.3" strokeLinecap="round" fill="none" />
          <path d="M27.8 21 Q31 17.4 34.2 21" stroke="#2d3748" strokeWidth="2.3" strokeLinecap="round" fill="none" />
          {/* 满足的腮红 */}
          <ellipse cx="15.8" cy="25.8" rx="3.6" ry="2.3" fill={c.light} opacity="0.9" />
          <ellipse cx="36.2" cy="25.8" rx="3.6" ry="2.3" fill={c.light} opacity="0.9" />
          {/* 微笑（更明显） */}
          <path d="M21.6 26 Q26 29.8 30.4 26" stroke="#8d5b4c" strokeWidth="2.1" strokeLinecap="round" fill="none" />
          {/* 冒出的小爱心（幸福感） */}
          <path d="M44 12c-1.2-1.6-3.5-1.2-3.8.7-.3-1.9-2.6-2.3-3.8-.7-1 2 3.2 4.5 3.8 4.9.6-.4 4.8-2.9 3.8-4.9z" fill={c.light} opacity="0.85" />
        </svg>
      );
  }
}
