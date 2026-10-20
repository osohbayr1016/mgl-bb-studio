/**
 * «Хугацаа» зурвас — Dashboard-ийн ХУАНЛИЙН ДЭЭР сууна.
 *
 * Google-ийн хуанли нь ГАДААД iframe тул түүн рүү мөр нэмэх боломжгүй
 * (өөр домэйн).  Оронд нь хуанлийн ЯГ ДЭЭР нягт зурвас тавьж, нүд нь
 * «юу яаралтай вэ» → «энэ сар ямар харагдаж байна вэ» гэсэн дарааллаар
 * уншина.
 *
 * ⚠️ ХАМГИЙН ИХДЭЭ ГУРВАН МӨР.  Энэ бол ЖАГСААЛТ БИШ — «яаралтай гурав»
 *    гэсэн дохио.  Бүтэн жагсаалт нь хуудасны доод талын
 *    `DashboardDeadlinesCard` ба `/app/timeline` хуудас дээр байна.
 *    Мөрийн тоог нэмбэл хуанли доош түлхэгдэж, хоёулаа нурна.
 *
 * ⚠ Өнгө ХЭЗЭЭ Ч ганцаараа мэдээлэл дамжуулахгүй (`riskDisplay.ts`-ийн
 *   дүрэм): тоолуур бүр текст шошготой, мөр бүр «N хоног» бичигтэй.
 */
import { useState } from 'react';
import { ArrowRight, CalendarClock, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/shared/context/AuthContext';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { RISK_TONE, riskDetail, riskLabelKey } from '@/features/timeline/lib/riskDisplay';

import { useUpcomingDeadlines } from './api';
import type { DeadlineItem } from './types';

/** Зурвасын харах цонх.  Хуанли нь сарын харагдацтай тул 30 хоног
 *  байгалийн хэмжээ; хугацаа хэтэрсэн мөр цонхноос үл хамааран ордог. */
const WINDOW_DAYS = 30;
const MAX_ROWS = 3;

/** «7 хоногт» тоолуурт орох төлөвүүд — `overdue` ЭНД ОРОХГҮЙ, тэр өөрийн
 *  тоолууртай (хоёр тоолуур давхцвал нийлбэр нь утгагүй болно). */
const SOON_STATES = ['due_1', 'due_3', 'due_7'] as const;

function StripRow({ item }: { item: DeadlineItem }) {
  const { t } = useLanguage();
  const tone = RISK_TONE[item.risk_state];
  const detail = riskDetail(t, item.risk_state, item.days_left, null, item.days_to_start);

  const href =
    item.kind === 'project'
      ? `/app/projects/${item.id}`
      : item.project_id
        ? `/app/projects/${item.project_id}${item.kind === 'milestone' ? '?tab=deadlines' : ''}`
        : // Төсөл нь мэдэгдэхгүй мөр — хуваарийн хуудас руу (тусдаа «Хугацаа»
          // хуудас 2026-08-13-нд устсан).
          '/app/timeline';

  return (
    <Link
      to={href}
      className="group flex items-center gap-2 rounded-md py-1 pl-0 pr-1 transition-colors hover:bg-muted/60"
    >
      {/* Зүүн ирмэгийн өнгөт зураас — эрсдэлийн төлөв. */}
      <span className={cn('h-7 w-0.5 flex-none rounded-full', tone.bar)} aria-hidden="true" />
      <span className="w-11 flex-none text-[11px] tabular-nums text-muted-foreground">
        {item.due_date?.slice(5) ?? '—'}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.title}</span>
      {item.project_title && (
        <span className="hidden max-w-[7rem] flex-none truncate text-[11px] text-muted-foreground sm:block">
          {item.project_title}
        </span>
      )}
      <span
        className={cn(
          'flex-none rounded border px-1 py-px text-[10px] font-medium',
          tone.chip,
        )}
      >
        {detail || t(riskLabelKey(item.risk_state))}
      </span>
      <ChevronRight className="h-3 w-3 flex-none text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Нэг тоолуур — өнгөт цэг + тоо + текст шошго. */
function Counter({ dot, count, label }: { dot: string; count: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden="true" />
      <span className="font-semibold tabular-nums text-foreground">{count}</span>
      {label}
    </span>
  );
}

export function DeadlineStrip({ className }: { className?: string } = {}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const canSeeAll = user?.role === 'admin' || user?.role === 'senior';
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const effectiveScope = canSeeAll ? scope : 'mine';

  const { data, isLoading } = useUpcomingDeadlines(effectiveScope, WINDOW_DAYS);
  const items = data?.items ?? [];

  const overdue = items.filter((i) => i.risk_state === 'overdue').length;
  const soon = items.filter((i) =>
    (SOON_STATES as readonly string[]).includes(i.risk_state),
  ).length;

  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card px-3 py-2.5 shadow-apple',
        className,
      )}
    >
      {/* Толгой — гарчиг, хамрах хүрээний сэлгүүр, бүтэн жагсаалтын холбоос. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <CalendarClock className="h-3.5 w-3.5 text-brand-copper" />
          {t('deadlines.stripTitle')}
        </div>
        <div className="flex items-center gap-1.5">
          {/* `scope=all` нь admin/senior-т л зөвшөөрөгдөнө (бусдад сервер 403). */}
          {canSeeAll && (
            <div className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
              {(['mine', 'all'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => setScope(s)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                    scope === s
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  {t(s === 'mine' ? 'deadlines.scopeMine' : 'deadlines.scopeAll')}
                </button>
              ))}
            </div>
          )}
          <Link
            to="/app/timeline"
            className="flex items-center gap-1 text-[11px] text-brand-copper hover:underline"
          >
            {t('dashboardPage.allLink')} <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Тоолуурууд. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Counter
          dot={RISK_TONE.overdue.dot}
          count={overdue}
          label={t('deadlines.countOverdue')}
        />
        <Counter dot={RISK_TONE.due_3.dot} count={soon} label={t('deadlines.countSoon')} />
        <Counter
          dot={RISK_TONE.on_track.dot}
          count={items.length}
          label={t('deadlines.countOpen')}
        />
      </div>

      {/* Яаралтай гурав.  Сервер тал аль хэдийн эрсдэлээр эрэмбэлсэн тул
          энд ЗӨВХӨН тасална — дахин эрэмбэлбэл хоёр талын дараалал зөрнө. */}
      <div className="mt-1.5 space-y-0.5 border-t border-border/40 pt-1.5">
        {isLoading ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="h-7 animate-pulse rounded-md bg-muted/40" />
          ))
        ) : items.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground">
            {t('deadlines.stripEmpty', { days: WINDOW_DAYS })}
          </p>
        ) : (
          items.slice(0, MAX_ROWS).map((item) => <StripRow key={item.key} item={item} />)
        )}
      </div>
    </div>
  );
}

export default DeadlineStrip;
