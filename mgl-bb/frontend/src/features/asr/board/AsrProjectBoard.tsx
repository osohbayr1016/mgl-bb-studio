import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarSearch, FileText, ListFilter, X } from 'lucide-react';
import { EmptyState } from '@/shared/components/EmptyState';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { todayUB } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { AsrList } from '@/features/projects/asr/AsrList';
import { useAsrVisits } from '@/features/projects/asr/api';
import {
  ASR_REPORT_TYPES,
  asrAttendeeIds,
  reportTypeOf,
  type AsrReport,
  type AsrReportType,
  type AsrStatus,
  type AsrTeamOption,
} from '@/features/projects/asr/types';
import { AsrTeamGroups } from '../AsrTeamGroups';
import { AsrSummaryButton } from '../summary/AsrSummaryDialog';
import { AsrTypeFilter } from '../AsrTypeFilter';
import {
  allMarks,
  buildNameMap,
  countSiteVisits,
  isCountedReport,
  peopleOf,
  summarize,
  teamCodesOf,
  teamsOf,
} from '../lib/asrBoard';
import {
  ALL_RANGE,
  axisDomain,
  inRange,
  isAllRange,
  monthRange,
  shiftRange,
} from '../lib/asrRange';
import { AsrBoardKpis } from './AsrBoardKpis';
import { AsrRangeBar } from './AsrRangeBar';
import { AsrReportTimeline } from './AsrReportTimeline';
import { AsrTeamBreakdown } from './AsrTeamBreakdown';
import { AsrWhoWhenChart } from './AsrWhoWhenChart';
import { useAsrRangeParam } from './useAsrRangeParam';

type View = 'timeline' | 'teams' | 'table';

const STATUS_FILTERS: { value: AsrStatus | 'all'; key: string }[] = [
  { value: 'all', key: 'asr.filterAll' },
  { value: 'draft', key: 'asr.statusDraft' },
  { value: 'submitted', key: 'asr.statusSubmitted' },
  { value: 'approved', key: 'asr.statusApproved' },
  { value: 'rejected', key: 'asr.statusRejected' },
];

/**
 * Нэг төслийн зохиогчийн хяналтын САМБАР — дээрээс доош нэг урсгал:
 *
 *   1. Хугацаа (◀ «2026 оны 9-р сар» ▶, товчнууд, «Эхлэх – Дуусах») —
 *      доорх БҮХ зүйл үүгээр шүүгдэнэ;
 *   2. товч тоо: хэдэн очилт, хэдэн хүн, сүүлд хэзээ, батлалт хүлээж буй;
 *   3. «Хэн хэзээ явсан» — хүн бүрийн очилт огноогоор + «Багаар»;
 *   4. тайлангууд — он цагаар (өгөгдмөл), багаар (админ), хүснэгтээр.
 *
 * Бүх тоо аль хэдийн татагдсан жагсаалтаас (`useAsrList`) клиент дээр
 * бодогдоно — серверийн `visits` endpoint хугацааны параметргүй, нэг
 * төслийн тайлан хэдэн арваар л тоологддог.  Дүрэм нь `lib/asrBoard.ts`.
 *
 * `/app/asr?project=` (`AsrProjectWorkspace`) ба төслийн «ЗХ» таб (`AsrTab`)
 * хоёулаа үүнийг хэрэглэнэ — хоёр гадаргуу зөрөхгүй.
 */
export function AsrProjectBoard({
  projectId,
  entries,
  teams,
  isAdmin,
  onOpen,
  onDelete,
  rangeParams = ['from', 'to'],
  empty,
}: {
  projectId: number;
  entries: AsrReport[];
  teams: AsrTeamOption[];
  isAdmin: boolean;
  onOpen: (row: AsrReport) => void;
  /** Зөвхөн админд. */
  onDelete?: (row: AsrReport) => void;
  /** URL параметрийн нэр — төслийн хуудасны табуудтай мөргөлдөхгүйн тулд. */
  rangeParams?: readonly [string, string];
  /** Төсөлд нэг ч тайлан байхгүй үед. */
  empty: ReactNode;
}) {
  const { t } = useLanguage();
  const today = todayUB();
  const [range, setRange] = useAsrRangeParam(rangeParams[0], rangeParams[1]);
  const [status, setStatus] = useState<AsrStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<AsrReportType | null>(null);
  const [personId, setPersonId] = useState<number | null>(null);
  const [teamCode, setTeamCode] = useState<string | null>(null);
  const [view, setView] = useState<View>('timeline');
  const reportsRef = useRef<HTMLElement>(null);

  // Хамт явсан хүний нэрийг id-тай нь найдвартай өгдөг цорын ганц эх сурвалж.
  const visits = useAsrVisits(projectId);
  const names = useMemo(
    () => buildNameMap(entries, visits.data?.by_person ?? []),
    [entries, visits.data?.by_person],
  );
  const nameOf = useCallback((id: number) => names.get(id), [names]);

  const inRangeEntries = useMemo(
    () => entries.filter((r) => inRange(r.report_date, range)),
    [entries, range],
  );
  const summary = useMemo(() => summarize(inRangeEntries), [inRangeEntries]);
  const prevSite = useMemo(() => {
    const prev = shiftRange(range, -1);
    return prev ? countSiteVisits(entries.filter((r) => inRange(r.report_date, prev))) : null;
  }, [entries, range]);
  const people = useMemo(() => peopleOf(inRangeEntries, names), [inRangeEntries, names]);
  const all = useMemo(() => allMarks(inRangeEntries), [inRangeEntries]);
  const teamRows = useMemo(
    () => teamsOf(inRangeEntries, teams.map((o) => o.code)),
    [inRangeEntries, teams],
  );

  const [dataFirst, dataLast] = useMemo(() => {
    let first: string | null = null;
    let last: string | null = null;
    for (const r of entries) {
      if (first == null || r.report_date < first) first = r.report_date;
      if (last == null || r.report_date > last) last = r.report_date;
    }
    return [first, last] as const;
  }, [entries]);

  const domain = useMemo(
    () =>
      axisDomain(
        range,
        entries.filter(isCountedReport).map((r) => r.report_date),
        today,
      ),
    [entries, range, today],
  );

  // Төрлөөс БУСАД шүүлт — төрлийн товчны тоо эндээс (дарахад гарах мөрийн тоотой таарна).
  const scoped = useMemo(
    () =>
      inRangeEntries.filter((r) => {
        if (status !== 'all' && r.status !== status) return false;
        if (personId != null && !asrAttendeeIds(r).includes(personId)) return false;
        if (teamCode != null && !teamCodesOf(r).includes(teamCode)) return false;
        return true;
      }),
    [inRangeEntries, status, personId, teamCode],
  );
  const listEntries = useMemo(
    () => (typeFilter == null ? scoped : scoped.filter((r) => reportTypeOf(r) === typeFilter)),
    [scoped, typeFilter],
  );
  // Төлөвийн товчны тоо — төлөвөөс БУСАД шүүлттэй (дарахад гарах мөрийн тоо).
  const statusCounts = useMemo(() => {
    const counts: Record<AsrStatus, number> = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
    for (const r of inRangeEntries) {
      if (personId != null && !asrAttendeeIds(r).includes(personId)) continue;
      if (teamCode != null && !teamCodesOf(r).includes(teamCode)) continue;
      if (typeFilter != null && reportTypeOf(r) !== typeFilter) continue;
      counts[r.status] += 1;
    }
    return counts;
  }, [inRangeEntries, personId, teamCode, typeFilter]);
  const typeCounts = useMemo(() => {
    const counts = Object.fromEntries(ASR_REPORT_TYPES.map((tp) => [tp, 0])) as Record<AsrReportType, number>;
    for (const r of scoped) counts[reportTypeOf(r)] += 1;
    return counts;
  }, [scoped]);

  const anyFilter = status !== 'all' || typeFilter != null || personId != null || teamCode != null;
  const clearFilters = () => {
    setStatus('all');
    setTypeFilter(null);
    setPersonId(null);
    setTeamCode(null);
  };

  const scrollToReports = () =>
    reportsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (entries.length === 0) return <>{empty}</>;

  const personName = personId != null ? (names.get(personId) ?? `#${personId}`) : null;
  const views: [View, string][] = [
    ['timeline', 'asr.board.viewTimeline'],
    ...(isAdmin ? ([['teams', 'asr.viewByTeam']] as [View, string][]) : []),
    ['table', 'asr.board.viewTable'],
  ];
  const activeView: View = view === 'teams' && !isAdmin ? 'timeline' : view;

  return (
    <div className="space-y-4" data-testid="asr-project-board">
      <AsrRangeBar
        range={range}
        onChange={setRange}
        today={today}
        dataFirst={dataFirst}
        dataLast={dataLast}
      />

      <div className="space-y-1.5">
        <AsrBoardKpis
          summary={summary}
          prevSite={prevSite}
          topPerson={people[0] ?? null}
          today={today}
          onShowAwaiting={() => {
            setStatus('submitted');
            setTypeFilter(null);
            scrollToReports();
          }}
        />
        <p className="px-1 text-micro text-muted-foreground">{t('asr.board.countRule')}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <AsrWhoWhenChart
          className="xl:col-span-2"
          domain={domain}
          all={all}
          people={people}
          today={today}
          activePersonId={personId}
          onSelectPerson={setPersonId}
          onOpenReport={onOpen}
          onShowAll={isAllRange(range) ? undefined : () => setRange(ALL_RANGE)}
        />
        <AsrTeamBreakdown
          rows={teamRows}
          teams={teams}
          totalSite={summary.site}
          activeCode={teamCode}
          onSelect={setTeamCode}
        />
      </div>

      <section
        ref={reportsRef}
        id="sec-asr-project-reports"
        className="scroll-mt-24 space-y-3"
        aria-labelledby="asr-board-reports-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="asr-board-reports-title" className="flex items-center gap-2 text-base font-semibold">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t('asr.board.reportsTitle')}
            <span className="text-sm font-normal text-muted-foreground tabular-nums" data-testid="asr-reports-count">
              {t('asr.board.reportsCount', { n: listEntries.length })}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* НЭГТГЭЛ тайлан — энэ төсөл, самбарын одоогийн хугацаа/төрөл/төлөвөөс эхэлнэ (зөвхөн админ). */}
            {isAdmin && (
              <AsrSummaryButton
                size="sm"
                lockedProject={{ id: projectId }}
                initial={{
                  from: range.from,
                  to: range.to,
                  reportType: typeFilter,
                  status: status === 'approved' ? 'approved' : 'counted',
                }}
              />
            )}
            <div role="group" aria-label={t('asr.viewLabel')} className="flex gap-1 rounded-full border p-0.5">
              {views.map(([value, key]) => (
                <Button
                  key={value}
                  type="button"
                  size="xs"
                  variant={activeView === value ? 'default' : 'ghost'}
                  aria-pressed={activeView === value}
                  onClick={() => setView(value)}
                  className="rounded-full"
                  data-testid={`asr-view-${value}`}
                >
                  {t(key)}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-border bg-card p-3">
          <FilterRow label={t('asr.board.filterType')}>
            <AsrTypeFilter value={typeFilter} onChange={setTypeFilter} counts={typeCounts} total={scoped.length} />
          </FilterRow>
          <FilterRow label={t('asr.status')}>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <Button
                  key={f.value}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={status === f.value}
                  onClick={() => setStatus(f.value)}
                  data-testid={`asr-status-${f.value}`}
                  className={cn(
                    'rounded-full text-xs font-normal',
                    status === f.value
                      ? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15 hover:text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(f.key)}
                  {f.value !== 'all' && (
                    <span className="tabular-nums opacity-70">{statusCounts[f.value]}</span>
                  )}
                </Button>
              ))}
            </div>
          </FilterRow>
          {(personName || teamCode || anyFilter) && (
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
              <ListFilter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {personName && (
                <ActiveChip
                  label={t('asr.board.filterPerson', { name: formatDisplayName(personName) })}
                  onClear={() => setPersonId(null)}
                />
              )}
              {teamCode && (
                <ActiveChip label={t('asr.board.filterTeam', { code: teamCode })} onClear={() => setTeamCode(null)} />
              )}
              {anyFilter && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={clearFilters}
                  data-testid="asr-clear-filters"
                >
                  {t('asr.visitsClear')}
                </Button>
              )}
            </div>
          )}
        </div>

        {listEntries.length === 0 ? (
          <EmptyState
            icon={CalendarSearch}
            title={inRangeEntries.length === 0 ? t('asr.board.emptyRange') : t('asr.board.emptyFiltered')}
            description={t('asr.board.emptyHint')}
            action={
              inRangeEntries.length === 0 ? (
                isAllRange(range) ? undefined : (
                  <Button type="button" size="sm" variant="outline" onClick={() => setRange(ALL_RANGE)}>
                    {t('asr.board.showAll')}
                  </Button>
                )
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={clearFilters}>
                  {t('asr.visitsClear')}
                </Button>
              )
            }
          />
        ) : activeView === 'teams' ? (
          <AsrTeamGroups
            entries={listEntries}
            teams={teams}
            onlyTeam={teamCode}
            onOpen={onOpen}
            onDelete={onDelete}
          />
        ) : activeView === 'table' ? (
          <AsrList entries={listEntries} onOpen={onOpen} onDelete={onDelete} empty={null} />
        ) : (
          <AsrReportTimeline
            entries={listEntries}
            nameOf={nameOf}
            onOpen={onOpen}
            onDelete={onDelete}
            onPickMonth={(y, m) => {
              setRange(monthRange(y, m));
              // `<main>` өөрөө гүйлгэгддэг (Layout) — `window.scrollTo` ажиллахгүй.
              document
                .getElementById('sec-asr-project-range')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />
        )}
      </section>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
      {label}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onClear}
        aria-label={t('asr.visitsClear')}
        className="size-5 rounded-full text-primary hover:bg-primary/15 hover:text-primary pointer-coarse:size-7"
      >
        <X className="size-3" />
      </Button>
    </span>
  );
}
