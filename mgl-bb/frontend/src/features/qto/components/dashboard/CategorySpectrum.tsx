import { useMemo } from 'react';
import { useReducedMotion } from 'motion/react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

import { fmtNum } from '../../lib/pivots';

export interface SpectrumSegment {
  key: string;
  label: string;
  color: string;
  count: number;
}

/** 0.5%-иас бага сегментүүд нэг «Бусад» сегментэд нугалагдана. */
const FOLD_THRESHOLD = 0.005;

interface DisplaySegment extends SpectrumSegment {
  /** Нугалсан сегментийн бүрэлдэхүүн key-үүд (dimming-д хэрэгтэй). */
  memberKeys: string[];
}

/**
 * Категорийн спектр — hero-гийн доорх нэг судал. Сегментийн өргөн нь тухайн
 * категорийн элементийн эзлэх хувь; 2px завсраар хуудасны дэвсгэр нэвт харагдана.
 * Chip-ээр сонгоход өргөн ХЭЗЭЭ Ч өөрчлөгдөхгүй — сонгогдоогүй нь бүдгэрнэ л.
 */
export function CategorySpectrum({
  segments,
  total,
  selected,
}: {
  /** count desc эрэмбэтэй, файлын шүүлтийн дараах dataset. */
  segments: SpectrumSegment[];
  total: number;
  /** Хоосон = бүгд идэвхтэй. */
  selected: Set<string>;
}) {
  const { t } = useLanguage();
  const reduce = useReducedMotion();

  const display = useMemo<DisplaySegment[]>(() => {
    if (total <= 0) return [];
    const big: DisplaySegment[] = [];
    const foldedKeys: string[] = [];
    let foldedCount = 0;
    for (const s of segments) {
      if (s.count / total < FOLD_THRESHOLD) {
        foldedKeys.push(s.key);
        foldedCount += s.count;
      } else {
        big.push({ ...s, memberKeys: [s.key] });
      }
    }
    if (foldedCount > 0) {
      big.push({
        key: '__other__',
        label: t('qtoPage.dashOtherSegment'),
        color: 'hsl(var(--qto-cat-neutral))',
        count: foldedCount,
        memberKeys: foldedKeys,
      });
    }
    return big;
  }, [segments, total, t]);

  if (display.length === 0) return null;

  const hasSelection = selected.size > 0;

  return (
    <div
      role="img"
      aria-label={t('qtoPage.dashSpectrumLabel')}
      className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
    >
      {display.map((s) => {
        const pct = (s.count / total) * 100;
        const pctText = pct.toLocaleString('en-US', { maximumFractionDigits: 1 });
        const dimmed = hasSelection && !s.memberKeys.some((k) => selected.has(k));
        const title = `${s.label} — ${fmtNum(s.count, 0)} · ${pctText}%`;
        return (
          <Tooltip key={s.key}>
            <TooltipTrigger asChild>
              <div
                tabIndex={0}
                aria-label={title}
                className={cn(
                  'h-full min-w-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  !reduce && 'transition-[flex-basis,opacity] duration-500',
                  dimmed && 'opacity-30',
                )}
                style={{ flexBasis: `${pct}%`, backgroundColor: s.color }}
              />
            </TooltipTrigger>
            <TooltipContent>{title}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
