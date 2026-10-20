/**
 * Самбарын («Компани» хуудасны) хэв маягийн үндсэн барилга — хавтгай карт,
 * чимээгүй хэсгийн гарчиг, KPI зурвас.
 *
 * `features/dashboard/CompanyDashboardPage.tsx`-ийн `PANEL` / `SectionHead` /
 * `KpiRollup`-ийн ЕРӨНХИЙ хувилбар: тэнд `id="sec-company-kpi"` хатуу
 * бичигдсэн тул шууд дахин хэрэглэх боломжгүй байсан.  Компани хуудас
 * өөрийн хуулбараа хэвээр хэрэглэж байгаа — тийш шилжүүлэх нь тусдаа
 * өөрчлөлт.  Шинэ самбар (ЗХ) эндээс авна, тэгснээр хоёр хуудас нэг
 * харагдацтай байна.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AnimatedNumber } from '@/shared/components/motion';
import { cn } from '@/shared/lib/utils';

/** Notion-clean гадаргуу: нэг нарийн хүрээ, сүүдэргүй — зай нь тусгаарлана. */
export const PANEL = 'rounded-xl border border-border bg-card';

/** Хэсгийн гарчиг: жижиг бүдэг icon + гарчиг + тоолуур/үйлдэл, зураасгүй. */
export function SectionHead({
  icon: Icon,
  iconClassName,
  title,
  count,
  action,
  className,
}: {
  icon?: LucideIcon;
  iconClassName?: string;
  title: string;
  count?: number | string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3', className)}
    >
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon className={cn('h-4 w-4 shrink-0 text-muted-foreground', iconClassName)} />}
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {count != null && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
        )}
      </div>
      {action}
    </div>
  );
}

export interface KpiItem {
  icon: LucideIcon;
  label: string;
  value: number;
  suffix?: string;
  sub?: ReactNode;
  /** `true` + утга > 0 бол улаан (хоцролт, дутагдал). */
  danger?: boolean;
  /** Утгыг товшиход — жишээ нь шүүлтүүр асаах. */
  onClick?: () => void;
}

/**
 * KPI зурвас — нэг хавтгай гадаргуу, `gap-px + bg-border` аргаар нарийн
 * зааг (утсанд 2×2, дэлгэцэнд 1×4 сүлжээнд хоёуланд нь тогтвортой).
 */
export function KpiStrip({
  items,
  id,
  className,
}: {
  items: KpiItem[];
  id?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-border scroll-mt-24',
        className,
      )}
    >
      <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
        {items.map((it) => {
          const decimals = Number.isInteger(it.value) ? 0 : 1;
          const danger = it.danger && it.value > 0;
          const body = (
            <>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <it.icon className={cn('h-3.5 w-3.5', danger && 'text-danger')} />
                <span className="truncate">{it.label}</span>
              </div>
              <div className="mt-2.5 flex items-baseline gap-1">
                <AnimatedNumber
                  value={it.value}
                  decimals={decimals}
                  className={cn(
                    'text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl',
                    danger ? 'text-danger' : 'text-foreground',
                  )}
                />
                {it.suffix && (
                  <span className="text-lg font-medium text-muted-foreground">{it.suffix}</span>
                )}
              </div>
              {it.sub && (
                <div className="mt-1 text-xs leading-snug text-muted-foreground">{it.sub}</div>
              )}
            </>
          );
          return it.onClick ? (
            <button
              key={it.label}
              type="button"
              onClick={it.onClick}
              className="bg-card p-4 text-left transition-colors hover:bg-muted/40 sm:p-5"
            >
              {body}
            </button>
          ) : (
            <div key={it.label} className="bg-card p-4 sm:p-5">
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
