import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, Loader2, Wrench } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { formatProjectShortName } from '@/shared/lib/formatting';
import type { MyProgressEntry } from '@/shared/types';
import { fmtRate, type RepairLogItem } from '@/features/users/hoursLog';
import { fmtHours, fmtSigned } from '../lib/format';

/**
 * «Явцын бичлэгүүд» — сонгосон цонхонд ажилтан юу дээр, хэдэн хувь, ямар
 * тэмдэглэлтэй ажилласныг өдрөөр бүлэглэж харуулна (`/profiles/:id/activity`).
 * Төлөв: батлагдсан / хүлээгдэж буй (100 % хаалт) / татгалзсан; амралтын
 * өдрийн бичлэг тусдаа шошготой.
 *
 * Засварын бүртгэл (цаг — `/profiles/:id/hours-log` `repairs`) ч тэр өдрийн
 * бүлэгт орно (2026-09-28): 0348-аас хойш ZA төсөл хувиар биш «Ажилласан»
 * тэмдэглэгээгээр явдаг тул эс бөгөөс тэр ажил энд огт харагдахгүй.  Мөр бүр
 * хадгалсан snapshot-оо л харуулна — цаг + өдрийн дундаж × цаг / 8 = олгосон хувь.
 */
const PAGE = 40;

type Item =
  | { kind: 'progress'; key: string; date: string; at: string; e: MyProgressEntry }
  | { kind: 'repair'; key: string; date: string; at: string; r: RepairLogItem };

interface DayGroup {
  date: string;
  items: Item[];
  /** Явцын бичлэгүүдийн хувийн өөрчлөлт (татгалзсан / амралт орохгүй). */
  delta: number;
  /** Засварын цаг. */
  repairHours: number;
  /** Засвараас бүтээмжид олгосон хувь (өдрийн дундаж × цаг / 8). */
  repairCredited: number;
}

export function EmployeeActivityCard({
  entries,
  repairs = [],
  isLoading,
  windowFrom,
  windowTo,
}: {
  entries: MyProgressEntry[];
  repairs?: RepairLogItem[];
  isLoading: boolean;
  windowFrom: string;
  windowTo: string;
}) {
  const { t } = useLanguage();
  const [limit, setLimit] = useState(PAGE);

  // Өдөр буурахаар; өдөр дотроо явцын бичлэг эхэнд, дараа нь засвар — бүлгийн дараалалтай ижил,
  // тиймээс «Цааш харах» хуудаслалт бүлгийг дундуур нь тасалж болох ч дарааллыг эвдэхгүй.
  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...entries.map((e): Item => ({ kind: 'progress', key: `p-${e.id}`, date: e.date, at: e.created_at ?? '', e })),
      ...repairs.map((r): Item => ({ kind: 'repair', key: `r-${r.kind}-${r.id}`, date: r.date, at: r.created_at ?? '', r })),
    ];
    return all.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.kind !== b.kind) return a.kind === 'progress' ? -1 : 1;
      return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
    });
  }, [entries, repairs]);

  const groups = useMemo(() => {
    const byDate = new Map<string, DayGroup>();
    for (const it of items) {
      let g = byDate.get(it.date);
      if (!g) {
        g = { date: it.date, items: [], delta: 0, repairHours: 0, repairCredited: 0 };
        byDate.set(it.date, g);
      }
      g.items.push(it);
      if (it.kind === 'progress') {
        if (it.e.status !== 'rejected' && !it.e.is_rest_day) g.delta += it.e.delta_pct ?? 0;
      } else {
        g.repairHours += it.r.hours;
        g.repairCredited += it.r.computed_pct ?? 0;
      }
    }
    return [...byDate.values()];
  }, [items]);

  const shownGroups = useMemo(() => {
    const keys = new Set(items.slice(0, limit).map((it) => it.key));
    return groups.map((g) => ({ ...g, items: g.items.filter((it) => keys.has(it.key)) })).filter((g) => g.items.length > 0);
  }, [groups, items, limit]);

  const totals = useMemo(() => {
    let approved = 0;
    let pending = 0;
    let rejected = 0;
    let rest = 0;
    for (const e of entries) {
      if (e.is_rest_day) rest += 1;
      else if (e.status === 'approved') approved += 1;
      else if (e.status === 'pending') pending += 1;
      else rejected += 1;
    }
    const repairHours = repairs.reduce((s, r) => s + r.hours, 0);
    return { approved, pending, rejected, rest, repairs: repairs.length, repairHours, days: groups.length };
  }, [entries, repairs, groups]);

  return (
    <Card id="sec-reports-activity" className="scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <History className="h-4 w-4 text-primary" />
          {t('reportsPage.activityTitle')}
          <span className="text-xs font-normal text-muted-foreground">
            {t('reportsPage.activitySummary', { n: items.length, days: totals.days })}
          </span>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
          <span>{t('reportsPage.periodRange', { from: windowFrom, to: windowTo })}</span>
          <Badge variant="outline" className="border-success/40 text-[10px] text-success">
            {t('reportsPage.entryApproved')} {totals.approved}
          </Badge>
          {totals.pending > 0 && (
            <Badge variant="outline" className="border-warning/50 text-[10px] text-warning">
              {t('reportsPage.entryPending')} {totals.pending}
            </Badge>
          )}
          {totals.rejected > 0 && (
            <Badge variant="outline" className="border-danger/40 text-[10px] text-danger">
              {t('reportsPage.entryRejected')} {totals.rejected}
            </Badge>
          )}
          {totals.rest > 0 && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {t('reportsPage.entryRest')} {totals.rest}
            </Badge>
          )}
          {totals.repairs > 0 && (
            <Badge variant="outline" className="border-primary/40 text-[10px] text-primary" data-testid="activity-repair-total">
              {t('reportsPage.entryRepair')} {totals.repairs} · {fmtHours(totals.repairHours)}
            </Badge>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('reportsPage.activityNone')}</p>
        ) : (
          <ol className="space-y-3">
            {shownGroups.map((g) => (
              <li key={g.date}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold tabular-nums">{g.date}</span>
                  <span className="text-muted-foreground">
                    {t('reportsPage.activityDay', { n: g.items.length })}
                  </span>
                  {g.delta !== 0 && (
                    <span className={cn('tabular-nums font-medium', g.delta > 0 ? 'text-success' : 'text-danger')}>{fmtSigned(g.delta, '%')}</span>
                  )}
                  {g.repairHours > 0 && (
                    <span className="inline-flex items-center gap-1 font-medium tabular-nums text-primary" title={t('reportsPage.activityRepairHoursTitle')}>
                      <Wrench className="h-3 w-3" />
                      {fmtHours(g.repairHours)}
                    </span>
                  )}
                  {g.repairCredited > 0 && (
                    <span className="font-medium tabular-nums text-info" title={t('reportsPage.activityRepairCreditedTitle')}>
                      +{fmtRate(g.repairCredited)}
                    </span>
                  )}
                </div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {g.items.map((it) => (it.kind === 'progress' ? <ProgressRow key={it.key} entry={it.e} /> : <RepairRow key={it.key} item={it.r} />))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        {items.length > limit && (
          <div className="mt-3 text-center">
            <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              {t('reportsPage.showMore', { n: items.length - limit })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProgressRow({ entry: e }: { entry: MyProgressEntry }) {
  const { t } = useLanguage();
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">{e.task_name ?? '—'}</span>
          <EntryStatus entry={e} />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {e.project_id ? (
            <Link to={`/app/projects/${e.project_id}`} className="hover:underline">
              {formatProjectShortName(e.project_name)}
            </Link>
          ) : (
            (e.project_name ?? '')
          )}
          {e.block_name && ` › ${e.block_name}`}
          {e.component_name && ` › ${e.component_name}`}
        </div>
        {e.notes && <p className="mt-0.5 line-clamp-2 text-xs text-foreground/80">{e.notes}</p>}
        {e.status === 'rejected' && e.review_note && (
          <p className="mt-0.5 text-xs text-danger">
            {t('reportsPage.reviewNote')}: {e.review_note}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <div className="font-semibold">{Math.round(e.percentage * 10) / 10}%</div>
        {!e.is_rest_day && e.delta_pct != null && e.delta_pct !== 0 && (
          <div className={cn('text-[11px]', e.delta_pct > 0 ? 'text-success' : 'text-danger')}>{fmtSigned(e.delta_pct, '%')}</div>
        )}
      </div>
    </li>
  );
}

/** Засварын нэг бүртгэл — цаг + (snapshot) өдрийн дундаж × цаг / 8 = олгосон хувь. */
function RepairRow({ item: r }: { item: RepairLogItem }) {
  const { t } = useLanguage();
  const isMark = r.kind === 'mark';
  const isBackfill = r.hours_source === 'backfill';
  const projectName = formatProjectShortName(r.project_name);
  const project =
    r.project_id && projectName ? (
      <Link to={`/app/projects/${r.project_id}`} className="hover:underline">
        {projectName}
      </Link>
    ) : (
      (projectName ?? '')
    );

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-1.5 text-sm" data-testid="activity-repair">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate font-medium">{r.task_name ?? (project || t('userProfileViewPage.unnamedItem'))}</span>
          </span>
          <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">
            {r.is_repair_project ? t('userProfileViewPage.kindRepairProject') : t('userProfileViewPage.kindRepair')}
          </Badge>
          {r.hours_source === 'auto' && !isMark && (
            <Badge variant="outline" className="border-info/40 text-[10px] text-info">
              {t('userProfileViewPage.hoursAuto')}
            </Badge>
          )}
          {isBackfill && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {t('userProfileViewPage.hoursBackfill')}
            </Badge>
          )}
        </div>
        {r.task_name && project && <div className="truncate text-xs text-muted-foreground">{project}</div>}
        {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-foreground/80">{r.description}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {isMark
            ? t('userProfileViewPage.repairMarkZero')
            : isBackfill || r.daily_rate == null
              ? t('userProfileViewPage.repairBackfillNote')
              : t('userProfileViewPage.rateLine', {
                  rate: fmtRate(r.daily_rate),
                  hours: Math.round(r.hours * 100) / 100,
                  pct: fmtRate(r.computed_pct ?? 0),
                })}
        </p>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <div className="font-semibold">{r.hours > 0 ? fmtHours(r.hours) : '—'}</div>
        {!isBackfill && (r.computed_pct ?? 0) > 0 && <div className="text-[11px] text-info">+{fmtRate(r.computed_pct)}</div>}
      </div>
    </li>
  );
}

function EntryStatus({ entry: e }: { entry: MyProgressEntry }) {
  const { t } = useLanguage();
  if (e.is_rest_day)
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        {t('reportsPage.entryRest')}
      </Badge>
    );
  if (e.status === 'pending')
    return (
      <Badge variant="outline" className="border-warning/50 text-[10px] text-warning">
        {t('reportsPage.entryPending')}
      </Badge>
    );
  if (e.status === 'rejected')
    return (
      <Badge variant="outline" className="border-danger/40 text-[10px] text-danger">
        {t('reportsPage.entryRejected')}
      </Badge>
    );
  return null;
}
