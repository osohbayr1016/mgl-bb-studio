/** Цагаар бодогддог засварын төслийн (`progress_mode = 'hours'`) АЖИЛЛАСАН ЦАГ
 *  (2026-09-24).  Засварын ажил ХУВИАР биш ЦАГААР хэмжигдэнэ: төслийн хуудсанд
 *  «А — 3 цаг, Б — 5 цаг», таскийн мөрөнд таск тус бүрийн цаг.  Өгөгдөл нь
 *  `GET /api/repair/hours?project_id=` (backend lib/repairHours.ts). */
import { useId, useState } from 'react';
import { ChevronDown, Clock, Users2 } from 'lucide-react';

import type { RepairHoursSummary } from '@/shared/types';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import type { TaskHoursInfo } from './types';

/** Таскийн мөрийн цагийн нүд: «8 цаг» + «Энхзул 3 · Намуунзул 5». */
export function TaskHoursInline({
  info,
  className,
}: {
  info: TaskHoursInfo | undefined;
  className?: string;
}) {
  const { t } = useLanguage();
  if (!info || info.hours <= 0) {
    return <span className={cn('text-xs text-muted-foreground', className)}>—</span>;
  }
  const people = info.people
    .map((p) => `${formatDisplayName(p.full_name)} ${t('repair.hoursValue', { hours: p.hours })}`)
    .join(' · ');
  return (
    <span
      className={cn('flex min-w-0 items-center gap-1.5 text-xs', className)}
      title={people}
      data-testid="task-worked-hours"
    >
      <Clock className="h-3 w-3 shrink-0 text-primary" />
      <span className="shrink-0 font-semibold tabular-nums text-foreground">
        {t('repair.hoursValue', { hours: info.hours })}
      </span>
      <span className="min-w-0 truncate text-micro text-muted-foreground">{people}</span>
    </span>
  );
}

/** Нэг хүний мөр: дугаар · нэр · цаг, доор нь хамгийн их цагтай харьцуулсан зурвас. */
function PersonHoursRow({
  rank,
  name,
  hours,
  max,
}: {
  rank: number;
  name: string;
  hours: number;
  max: number;
}) {
  const { t } = useLanguage();
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-sm">
      <span className="text-right text-xs tabular-nums text-muted-foreground">{rank}</span>
      <span className="truncate text-foreground">{formatDisplayName(name)}</span>
      <span className="font-semibold tabular-nums text-foreground">
        {t('repair.hoursValue', { hours })}
      </span>
      {/* Урт нь бусадтайгаа харьцуулсан ЦАГ — хувь биш, тоо бичихгүй. */}
      <span className="col-start-2 col-end-4 h-1 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-primary/70"
          style={{ width: `${max > 0 ? (hours / max) * 100 : 0}%` }}
        />
      </span>
    </li>
  );
}

/** Төслийн «Ажилласан цаг» карт — нийт цаг, хүн бүрийн цаг, таскгүй цаг.
 *
 *  Эзний хүсэлт (2026-09-29): нээхэд ХУРААЛТТАЙ — нийт цаг + хамгийн их цагтай
 *  ГАНЦ хүн л харагдана; толгой эсвэл доорх товчийг дарахад бусад нь гөлгөр
 *  хөдөлгөөнтэй доош задарна.  Хөдөлгөөн нь `grid-template-rows: 0fr ↔ 1fr`
 *  шилжилт — өндрийг хэмжихгүй, агуулга хаагдсан үедээ ч DOM-д үлдэх тул хаах
 *  хөдөлгөөн ч гөлгөр (Radix Collapsible хаахдаа агуулгаа устгадаг).  Хаалттай
 *  үед `inert` — Tab/дэлгэц уншигч нуугдсан мөрүүдэд орохгүй. */
export function RepairHoursCard({
  summary,
  loading,
}: {
  summary: RepairHoursSummary | undefined;
  loading: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const people = summary?.people ?? [];
  const max = people.reduce((m, p) => Math.max(m, p.hours), 0);
  const top = people[0];
  const rest = people.slice(1);
  const unlinked = summary?.unlinked_hours ?? 0;
  // Задлах зүйл: бусад хүмүүс, тайлбар, таскгүй цагийн тэмдэглэл.
  const canExpand = !loading && people.length > 0;
  const toggle = () => setOpen((v) => !v);

  const header = (
    <>
      <span className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">{t('repair.hoursCardTitle')}</span>
      </span>
      <span className="inline-flex items-center gap-2">
        {summary && summary.total_hours > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
            <span className="font-semibold text-foreground" data-testid="repair-hours-total">
              {t('repair.hoursValue', { hours: summary.total_hours })}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Users2 className="h-3.5 w-3.5" />
              {t('repair.hoursPeopleCount', { count: people.length })}
            </span>
          </span>
        )}
        {canExpand && (
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-300 ease-out motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        )}
      </span>
    </>
  );

  return (
    <Card className="border-border/60" data-testid="repair-hours-card" data-open={open ? 'true' : 'false'}>
      <CardContent className="space-y-3 p-4">
        {canExpand ? (
          // Толгой бүхэлдээ дарагдана.  Button-ы өндөр/padding-ийг дарахдаа
          // `pointer-coarse:` ба `has-[>svg]:` хувилбарыг ХАМТ бичнэ — tailwind-merge
          // variant-тай классыг дардаггүй (мэдрэгчтэй дэлгэц дээр 44px-д хавчигдана).
          <Button
            type="button"
            variant="ghost"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={regionId}
            className="-mx-2 -my-1 h-auto w-[calc(100%+1rem)] flex-wrap justify-between whitespace-normal px-2 py-1 text-left pointer-coarse:h-auto has-[>svg]:px-2 motion-safe:active:scale-100"
            data-testid="repair-hours-toggle"
          >
            {header}
          </Button>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">{header}</div>
        )}

        {loading ? (
          <div className="h-10 animate-pulse rounded-md bg-muted/40" />
        ) : !top ? (
          <p className="py-2 text-sm text-muted-foreground">{t('repair.hoursCardEmpty')}</p>
        ) : (
          // Нэг блок: хаалттай бүс (0 өндөр) `space-y-3`-ийн зайг авч дээд мөр ба
          // товчны хооронд хоосон зай үлдээхгүйн тулд зай нь БҮСИЙН ДОТОР.
          <div>
            <ul>
              <PersonHoursRow rank={1} name={top.full_name} hours={top.hours} max={max} />
            </ul>

            <div
              id={regionId}
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none',
                open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
              inert={!open}
              data-testid="repair-hours-rest"
            >
              <div className="min-h-0 overflow-hidden">
                <div className="space-y-3 pt-1.5">
                  {rest.length > 0 && (
                    <ul className="space-y-1.5">
                      {rest.map((p, i) => (
                        <PersonHoursRow
                          key={p.user_id}
                          rank={i + 2}
                          name={p.full_name}
                          hours={p.hours}
                          max={max}
                        />
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">{t('repair.hoursCardHint')}</p>
                  {/* Таскгүй цаг (0341-ээс өмнөх бүх бүртгэл) — блок/таскийн мөр «0 цаг»
                      харагдах шалтгааныг бүх цаг таскгүй үед ч хэлнэ. */}
                  {unlinked > 0 && (
                    <p className="text-micro text-muted-foreground">
                      {t('repair.hoursCardUnlinked', { hours: unlinked })}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={toggle}
              aria-expanded={open}
              aria-controls={regionId}
              className="mt-2 h-auto px-0 pointer-coarse:h-auto has-[>svg]:px-0"
              data-testid="repair-hours-more"
            >
              {open
                ? t('repair.hoursShowLess')
                : rest.length > 0
                  ? t('repair.hoursShowAll', { count: people.length })
                  : t('repair.hoursShowDetails')}
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 transition-transform duration-300 ease-out motion-reduce:transition-none',
                  open && 'rotate-180',
                )}
                aria-hidden
              />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
