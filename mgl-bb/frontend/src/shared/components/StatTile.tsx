import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info';

/** Дельтагийн өнгө. `auto` = өсөлт сайн. Буурах нь сайн үзүүлэлтэд `inverse`. */
type DeltaPolarity = 'auto' | 'inverse' | 'neutral';

const TONE_BAR: Record<Tone, string> = {
  default: 'bg-border',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

interface StatTileProps {
  /** Богино шошго. Том үсгээр автоматаар гарна (`text-label`). */
  label: string;
  /** Гол утга. Тоо бол `tabular-nums` автоматаар (`text-metric`). */
  value: ReactNode;
  /** Утганы ард жижгээр гарах нэгж — «ц», «%», «хүн». */
  unit?: string;
  /** Өмнөх үетэй харьцуулсан хувь/тоон өөрчлөлт. */
  delta?: number;
  /** Дельтагийн тайлбар — «7 хоногт». */
  deltaLabel?: string;
  /**
   * Өсөлт сайн уу муу юу. Ирц/явцад `auto`, хоцролт/зөрчилд `inverse`,
   * саармаг тоонд `neutral`.
   */
  deltaPolarity?: DeltaPolarity;
  icon?: LucideIcon;
  /** Зүүн ирмэгийн өнгөт зурвас. */
  tone?: Tone;
  /** Өгвөл бүхэл хавтан холбоос болно. */
  to?: string;
  /** Утганы доор гарах нэмэлт мөр. */
  hint?: ReactNode;
  className?: string;
}

/**
 * Өтгөн метрик хавтан — «инженерийн багаж» чиглэлийн үндсэн барилга.
 *
 * Шатлал нь ЗАЙгаар биш: шошго нь 11px/600/uppercase/бүдэг, утга нь
 * 24px/600/tabular. Босоо padding 10px тул 1600px дээр 4-өөр, 360px дээр
 * 2-оор багтана (сүлжээг `StatRow` өгнө).
 */
export function StatTile({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  deltaPolarity = 'auto',
  icon: Icon,
  tone = 'default',
  to,
  hint,
  className,
}: StatTileProps) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const DeltaIcon = !hasDelta ? Minus : delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;

  // Тэг өөрчлөлт үргэлж саармаг — «0% өсөлт»-ийг ногоон болгох нь худал мэдээлэл.
  const deltaTone =
    !hasDelta || delta === 0 || deltaPolarity === 'neutral'
      ? 'text-muted-foreground'
      : (delta > 0) === (deltaPolarity === 'auto')
        ? 'text-success'
        : 'text-danger';

  const body = (
    <>
      {/* Өнгөт зурвас — `tone="default"` үед ердийн ирмэг болно. */}
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-0.5 rounded-l-lg', TONE_BAR[tone])}
      />
      <div className="flex items-start justify-between gap-2">
        <span className="text-label text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 shrink-0 text-muted-subtle" aria-hidden />}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-metric text-foreground">{value}</span>
        {unit && <span className="text-micro text-muted-foreground">{unit}</span>}
      </div>
      {(hasDelta || hint) && (
        <div className="text-micro mt-1 flex items-center gap-1">
          {hasDelta && (
            <span className={cn('inline-flex items-center gap-0.5 tabular-nums', deltaTone)}>
              <DeltaIcon className="size-3" aria-hidden />
              {delta > 0 ? '+' : ''}
              {delta}
            </span>
          )}
          {deltaLabel && <span className="text-muted-foreground">{deltaLabel}</span>}
          {hint && <span className="truncate text-muted-foreground">{hint}</span>}
        </div>
      )}
    </>
  );

  const shell = cn(
    'relative overflow-hidden rounded-lg border border-border bg-card px-3 py-2.5',
    className,
  );

  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          shell,
          'block transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/**
 * `StatTile`-уудын сүлжээ. 360px дээр 2, sm-д 3, lg-д 4 багана —
 * `Layout`-ийн 1600px-ийн хүрээнд 4 хавтан тав тухтай багтана.
 */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4', className)}>
      {children}
    </div>
  );
}
