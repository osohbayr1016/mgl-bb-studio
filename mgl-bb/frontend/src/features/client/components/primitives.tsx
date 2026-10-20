/**
 * Захиалагчийн порталын дизайны суурь элементүүд.
 *
 * Хэл: архитектурын студийн editorial хэв маяг — цаасан дэвсгэр, бэхэн бичвэр,
 * 1px шугам, хурц өнцөг, дугаарласан хэсэг.  Сүүдэр, бөөрөнхий карт БАЙХГҮЙ;
 * бүтэц нь шугам + зайгаар гарна.  Өнгө нь зөвхөн семантик токен
 * (`text-foreground`, `border-foreground/10`, `text-success` …) + брэндийн
 * зэс (`brand-copper`) — `npm run lint:tokens`-ийн дүрэмд нийцнэ.
 */
import type { ReactNode } from 'react';
import { m } from 'motion/react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

import { clampPct } from '../lib/clientFormat';

/** «01 — Тойм» маягийн жижиг гарчиг. */
export function Eyebrow({
  index,
  children,
  className,
}: {
  index?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-center gap-2.5 font-mono text-label uppercase tracking-[0.16em] text-muted-foreground',
        className,
      )}
    >
      {index ? <span className="text-foreground">{index}</span> : null}
      {index ? <span aria-hidden className="h-px w-6 bg-foreground/30" /> : null}
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

/**
 * Хэсгийн толгой — дээр нь бүтэн бэхэн шугам, зүүн баганад дугаар, баруунд
 * том гарчиг.  Архитектурын сайтуудын «шошгоны багана + бичвэр» тор.
 */
export function SectionHeader({
  index,
  eyebrow,
  title,
  description,
  aside,
  className,
}: {
  index?: string;
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'grid gap-5 border-t border-foreground pt-5 md:grid-cols-12 md:gap-8',
        className,
      )}
    >
      <div className="md:col-span-3">
        <Eyebrow index={index}>{eyebrow}</Eyebrow>
      </div>
      <div className="flex flex-col gap-5 md:col-span-9 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <h2 className="font-display text-3xl font-light leading-[1.05] tracking-[-0.025em] text-foreground md:text-4xl lg:text-5xl">
            {title}
          </h2>
          {description ? (
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
    </header>
  );
}

/** Хэсэг доторх дэд гарчиг — нимгэн шугам + eyebrow + баруун талын үйлдэл. */
export function SubHeader({
  title,
  meta,
  action,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-3 border-b border-foreground/15 pb-3',
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <h3 className="font-display text-xl font-normal tracking-[-0.015em] text-foreground md:text-2xl">
          {title}
        </h3>
        {meta ? (
          <span className="font-mono text-micro tabular-nums text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** Том тоон үзүүлэлт. */
export function Figure({
  label,
  value,
  unit,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col justify-between gap-6', className)}>
      <span className="font-mono text-label uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="font-display text-4xl font-light leading-none tracking-[-0.035em] tabular-nums text-foreground md:text-5xl">
        {value}
        {unit ? (
          <span className="ml-1.5 align-baseline text-base tracking-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Явцын шугам.  `scaleX`-ээр хөдөлдөг тул `prefers-reduced-motion`-ийг
 * `MotionConfig reducedMotion="user"` автоматаар хүндэтгэнэ.
 */
export function ProgressLine({
  value,
  size = 'thin',
  tone = 'ink',
  color,
  className,
  label,
}: {
  value: number;
  size?: 'hair' | 'thin' | 'bold';
  tone?: 'ink' | 'copper' | 'inverse';
  /** Багийн өнгө гэх мэт тодорхой өнгө (tone-ийг дарна). */
  color?: string;
  className?: string;
  /** Дэлгэц уншигчид — өгөхгүй бол зөвхөн чимэглэл. */
  label?: string;
}) {
  const v = clampPct(value);
  return (
    <div
      className={cn(
        'relative w-full overflow-hidden',
        tone === 'inverse' ? 'bg-background/25' : 'bg-foreground/10',
        size === 'hair' ? 'h-px' : size === 'thin' ? 'h-[3px]' : 'h-1.5',
        className,
      )}
      {...(label
        ? {
            role: 'progressbar',
            'aria-label': label,
            'aria-valuenow': Math.round(v),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
          }
        : { 'aria-hidden': true })}
    >
      <m.div
        className={cn(
          'absolute inset-0 origin-left',
          tone === 'copper' ? 'bg-brand-copper' : tone === 'inverse' ? 'bg-background' : 'bg-foreground',
        )}
        style={color ? { backgroundColor: color } : undefined}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: v / 100 }}
        transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
      />
    </div>
  );
}

/** Шууд холболтын төлөв. */
export function LiveIndicator({ live, className }: { live: boolean; className?: string }) {
  const { t } = useLanguage();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-mono text-label uppercase tracking-[0.14em]',
        live ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
      title={live ? t('clientRoom.liveHint') : t('clientRoom.offlineHint')}
    >
      <span className="relative flex h-2 w-2">
        {live ? (
          <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
        ) : null}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            live ? 'bg-success' : 'border border-muted-subtle',
          )}
        />
      </span>
      {live ? t('clientRoom.live') : t('clientRoom.offline')}
    </span>
  );
}

/** Ажлын төлвийн цэг: дууссан / хийгдэж буй / эхлээгүй. */
export function WorkDot({ progress, className }: { progress: number; className?: string }) {
  const cls =
    progress >= 100 ? 'bg-success' : progress > 0 ? 'bg-brand-copper' : 'border border-muted-subtle';
  return <span aria-hidden className={cn('inline-block h-2 w-2 shrink-0 rounded-full', cls, className)} />;
}

/** Хоосон төлөв — editorial: том бүдэг гарчиг + тайлбар. */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-4 border border-dashed border-foreground/20 px-6 py-12 md:px-10 md:py-16',
        className,
      )}
    >
      <p className="font-display text-2xl font-light tracking-[-0.02em] text-foreground md:text-3xl">
        {title}
      </p>
      {body ? <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}

/** Ачаалах/сүлжээний алдаа — «Дахин оролдох» товчтой. */
export function ErrorState({
  message,
  onRetry,
  retrying,
  className,
}: {
  message?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-4 border border-danger/30 bg-danger/5 px-6 py-6 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} />
        <div>
          <p className="text-sm font-medium text-foreground">{t('clientRoom.loadFailed')}</p>
          {message ? <p className="mt-1 text-body text-muted-foreground">{message}</p> : null}
        </div>
      </div>
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          className="rounded-none border-foreground/30 bg-transparent"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', retrying && 'motion-safe:animate-spin')} />
          {t('clientRoom.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** Ачаалж байх үеийн нимгэн араг. */
export function SkeletonBar({ className }: { className?: string }) {
  return <div aria-hidden className={cn('bg-foreground/[0.06] motion-safe:animate-pulse', className)} />;
}

/** Товч бичвэр шошго (материалын төрөл г.м.). */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center border border-foreground/20 px-2 py-0.5 font-mono text-label uppercase tracking-[0.12em] text-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}
