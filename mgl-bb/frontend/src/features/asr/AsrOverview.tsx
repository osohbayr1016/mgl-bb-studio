/**
 * `/app/asr`-ийн эхний давхарга — «Компани» хуудасны хэв маягтай самбар.
 *
 * Бүх тоо `GET /author-supervision/stats`-аас (`statsApi.ts`); төслийн
 * жагсаалт `useAsrProjectSummaries`-аас хэвээр.  Тоо бүрийн тодорхойлолт
 * `backend/src/routes/authorSupervisionStats.ts`-ийн толгойд — товчхондоо
 * «очилт» = илгээгдсэн + батлагдсан ТАЛБАЙН ХЯНАЛТ (0362), ноорог хэзээ ч
 * тоологдохгүй.  Цахим/оффис уулзалт, зургийн өөрчлөлт нь «Төрлөөр»
 * самбарт тусдаа (эзний шийдвэр 2026-09-29).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FolderKanban,
  HardHat,
  Loader2,
  Layers,
  Paperclip,
  Pencil,
  PenLine,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { KpiStrip, PANEL, SectionHead } from '@/shared/components/DashboardPanel';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/time';
import { teamChipClass } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { asrProjectName } from '@/features/projects/asr/asrProjectName';
import { AsrRedBookBadge, AsrStatusBadge } from '@/features/projects/asr/AsrStatusBadge';
import { AsrTypeBadge } from '@/features/projects/asr/AsrList';
import {
  ASR_REPORT_TYPES,
  REPORT_TYPE_KEY,
  type AsrProjectSummary,
  type AsrReportType,
} from '@/features/projects/asr/types';
import { AsrProjectNameDialog, type AsrProjectNameTarget } from './AsrProjectNameDialog';
import { AsrSafetyCard } from './AsrSafetyCard';
import { AsrTypeFilter } from './AsrTypeFilter';
import { AsrTypeResults } from './AsrTypeResults';
import { ASR_TYPE_ICON } from './lib/typeIcons';
import { useAsrStats, type AsrStatsRecent, type AsrStatsResponse } from './statsApi';

/** Хоёр `YYYY-MM-DD`-ийн зөрүү (хоног). */
/** Төслийн төлөв → i18n (Төслүүд хуудасны `STATUS_CONFIG`-ийн ижил түлхүүрүүд);
 *  танигдахгүй төлөв түүхий утгаараа гарна. */
const PROJECT_STATUS_KEY: Record<string, string> = {
  active: 'projectsPage.statusActive',
  completed: 'projectsPage.statusCompleted',
  archived: 'projectsPage.statusArchived',
};

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

export function AsrOverview({
  projects,
  projectsLoading,
  onSelectProject,
  onOpenReport,
}: {
  projects: AsrProjectSummary[];
  projectsLoading: boolean;
  onSelectProject: (id: number) => void;
  /** `AsrStatsRecent` (сүүлийн тайлан) болон `AsrReport` (төрлөөр шүүсэн жагсаалт) хоёулаа тохирно. */
  onOpenReport: (row: Pick<AsrStatsRecent, 'id' | 'project_id'>) => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const stats = useAsrStats();
  /*
   * Тайлангийн ТӨРЛӨӨР шүүх (`?type=online` гэх мэт) — нэг товчоор.  Төрөл
   * сонгосон үед самбар (KPI, төслүүд, график) ОРОГДОЖ, тэр төрлийн бүх
   * төслийн тайлангийн жагсаалт гарна; «Бүгд» нь өмнөх самбар.  Танигдахгүй
   * утга «Бүгд».  `replace` — товч бүр history-д мөр нэмэхгүй.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const typeParam = searchParams.get('type');
  const type: AsrReportType | null = (ASR_REPORT_TYPES as readonly string[]).includes(typeParam ?? '')
    ? (typeParam as AsrReportType)
    : null;
  const setType = (next: AsrReportType | null) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next) p.set('type', next);
        else p.delete('type');
        return p;
      },
      { replace: true },
    );
  const typeFilter = (
    <AsrTypeFilter
      value={type}
      onChange={setType}
      total={stats.data?.totals.reports}
      counts={Object.fromEntries((stats.data?.by_type ?? []).map((r) => [r.type, r.total]))}
    />
  );
  /*
   * «Бүрдэл» — ЗӨВХӨН админд (эзний шийдвэр 2026-09-29).  Сервер бусдад тэр
   * өгөгдлийг огт буцаадаггүй; энд нуух нь зөвхөн байршил — нуугдсан самбарын
   * оронд үлдсэн самбар бүтэн өргөнөөр.  «Багаар», «Хамгийн идэвхтэй
   * зохиогчид» самбарууд эзний хүсэлтээр (2026-09-29) хуудаснаас ХАСАГДСАН —
   * `/stats`-ийн `by_team`/`by_person` одоо frontend-д уншигчгүй.
   */
  const isAdmin = user?.role === 'admin';
  const [renaming, setRenaming] = useState<AsrProjectNameTarget | null>(null);

  if (type != null) {
    return (
      <div className="space-y-4">
        {typeFilter}
        <AsrTypeResults key={type} type={type} onOpenReport={onOpenReport} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {typeFilter}

      {stats.isError ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : (
        <KpiSection data={stats.data ?? null} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section
          id="sec-asr-projects"
          className={cn(PANEL, 'overflow-hidden scroll-mt-24 lg:col-span-2')}
        >
          <SectionHead
            icon={FolderKanban}
            title={t('asr.statsProjects')}
            count={projects.length || undefined}
          />
          <ProjectTable
            rows={projects}
            loading={projectsLoading}
            today={stats.data?.today}
            onSelect={onSelectProject}
            onRename={isAdmin ? setRenaming : undefined}
          />
        </section>

        <div className="space-y-6">
          <AsrSafetyCard />
          <TypePanel data={stats.data ?? null} />
        </div>
      </div>

      {/* Графикийн панел баруун баганатай ижил өндөрт сунахгүй — `items-start`. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
        <section
          id="sec-asr-monthly"
          className={cn(PANEL, 'scroll-mt-24', isAdmin ? 'lg:col-span-2' : 'lg:col-span-3')}
        >
          <SectionHead
            icon={TrendingUp}
            title={t('asr.statsMonthly')}
            count={t('asr.statsMonthlyLast12')}
          />
          <div className="px-2 pb-4 sm:px-4">
            {stats.data ? (
              <MonthChart data={stats.data.by_month} />
            ) : (
              <div className="flex h-56 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
          </div>
        </section>

        {isAdmin && <CompletenessPanel data={stats.data ?? null} />}
      </div>

      <section id="sec-asr-recent" className={cn(PANEL, 'overflow-hidden scroll-mt-24')}>
        <SectionHead
          icon={ClipboardCheck}
          title={t('asr.statsRecent')}
          count={stats.data?.recent.length || undefined}
        />
        <RecentList
          rows={stats.data?.recent ?? []}
          loading={stats.isPending}
          onOpen={onOpenReport}
        />
      </section>

      <p className="text-micro text-muted-foreground">
        {t('asr.statsCountedNote')}
        {!isAdmin && ` ${t('asr.teamScopeNote')}`}
      </p>

      <AsrProjectNameDialog target={renaming} onOpenChange={(v) => !v && setRenaming(null)} />
    </div>
  );
}

/* =====================  KPI  ===================== */

function KpiSection({ data }: { data: AsrStatsResponse | null }) {
  const { t } = useLanguage();
  const totals = data?.totals;
  const rb = data?.red_book;
  return (
    <KpiStrip
      id="sec-asr-kpi"
      items={[
        {
          icon: HardHat,
          label: t('asr.statsTotalVisits'),
          value: totals?.visits ?? 0,
          sub: totals
            ? t('asr.statsProjectsAuthors', {
                projects: totals.projects_visited,
                authors: totals.authors,
              })
            : undefined,
        },
        {
          icon: CalendarDays,
          label: t('asr.statsThisMonth'),
          value: totals?.this_month ?? 0,
          sub: totals ? t('asr.statsPrevMonth', { n: totals.prev_month }) : undefined,
        },
        {
          icon: CheckCircle2,
          label: t('asr.statsApproved'),
          value: totals?.approved ?? 0,
          sub: totals
            ? `${t('asr.statsAwaiting', { n: totals.awaiting_review })} · ${t('asr.statsMyDrafts', { n: totals.my_drafts })}`
            : undefined,
        },
        {
          icon: BookOpenCheck,
          label: t('asr.statsRedBookMissing'),
          value: rb?.missing ?? 0,
          danger: true,
          sub: rb
            ? t('asr.statsRedBookSub', { verified: rb.verified, signed: rb.signed }) +
              (rb.absent ? ` · ${t('asr.redBookAbsent')} ${rb.absent}` : '')
            : undefined,
        },
      ]}
    />
  );
}

/* =====================  төслүүд  ===================== */

/** Админы «Нэр засах» товч — мөрийн дарааллыг (төсөл нээх) өдөөхгүй. */
function RenameButton({ row, onRename }: { row: AsrProjectSummary; onRename: (t: AsrProjectNameTarget) => void }) {
  const { t } = useLanguage();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={t('asr.renameProject')}
      aria-label={t('asr.renameProject')}
      onClick={(e) => {
        e.stopPropagation();
        onRename({
          id: row.id,
          base_name: row.base_name ?? row.name,
          asr_name: row.asr_name ?? null,
          asr_contract_no: row.asr_contract_no ?? null,
        });
      }}
      className="shrink-0 text-muted-foreground"
    >
      <Pencil className="h-3.5 w-3.5" />
    </Button>
  );
}

function ProjectTable({
  rows,
  loading,
  today,
  onSelect,
  onRename,
}: {
  rows: AsrProjectSummary[];
  loading: boolean;
  today?: string;
  onSelect: (id: number) => void;
  /** Зөвхөн админд — ЗХ-д харагдах нэр засах (0358). */
  onRename?: (target: AsrProjectNameTarget) => void;
}) {
  const { t } = useLanguage();
  if (loading) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="px-4 pb-6">
        <EmptyState
          icon={HardHat}
          title={t('asr.projectListEmpty')}
          description={t('asr.projectListEmptyHint')}
        />
      </div>
    );
  }
  return (
    <>
      {/* Утсанд карт — хүснэгт 390px-д хэвтээ гүйлгээ болж очилтын багана далд ордог. */}
      <ul className="divide-y divide-border/60 border-t border-border sm:hidden">
        {rows.map((p) => {
          const since = p.last_visit && today ? daysBetween(p.last_visit, today) : null;
          return (
            <li key={p.id} className="flex items-center">
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{asrProjectName(p.name)}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro text-muted-foreground">
                    {p.shifr && <span>{p.shifr}</span>}
                    {p.last_visit ? (
                      <span className="tabular-nums">
                        {formatDate(p.last_visit)}
                        {since != null &&
                          since > 0 &&
                          ` · ${t('asr.daysSinceVisit', { n: since })}`}
                        {since === 0 && ` · ${t('asr.visitedToday')}`}
                      </span>
                    ) : (
                      <span className="italic">{t('asr.noVisitsYet')}</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-base font-semibold tabular-nums">{p.total_visits}</div>
                  <div className="text-micro text-muted-foreground">{t('asr.statsVisitUnit')}</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
              {onRename && (
                <div className="shrink-0 pr-2">
                  <RenameButton row={p} onRename={onRename} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium sm:px-5">{t('asr.project')}</th>
              <th className="w-24 px-3 py-2.5 text-right font-medium">{t('asr.colVisits')}</th>
              <th className="hidden w-40 whitespace-nowrap px-3 py-2.5 font-medium sm:table-cell">
                {t('asr.colLastVisit')}
              </th>
              <th className="w-8 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const since = p.last_visit && today ? daysBetween(p.last_visit, today) : null;
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                >
                  {/* `w-full max-w-0` — хүснэгтийн автомат өргөнд нэрийн багана үлдсэн
                      зайг л авч, урт нэр «…» болж таслагдана (эс бөгөөс админы
                      «Нэр засах» товч хүснэгтийг панелаас хальтруулна). */}
                  <td className="w-full min-w-[220px] max-w-0 px-4 py-3 sm:px-5">
                    <div className="flex min-w-0 items-center gap-1">
                      {/* `min-w-0` — эс бөгөөс flex хүүхэд бүтэн нэрийн өргөнөөр
                          тэлж «Сүүлийн очилт» баганыг хавчина. */}
                      <div className="min-w-0 truncate font-medium">{asrProjectName(p.name)}</div>
                      {onRename && <RenameButton row={p} onRename={onRename} />}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {p.status && (
                        <Badge variant="secondary" className="text-micro px-1.5 py-0">
                          {t(PROJECT_STATUS_KEY[p.status] ?? p.status)}
                        </Badge>
                      )}
                      {p.shifr && (
                        <span className="text-micro text-muted-foreground">{p.shifr}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="text-base font-semibold tabular-nums">{p.total_visits}</span>
                    {p.report_count !== p.total_visits && (
                      <div className="text-micro tabular-nums text-muted-foreground">
                        {t('asr.colReportsN', { n: p.report_count })}
                      </div>
                    )}
                  </td>
                  {/* `whitespace-nowrap` — админы «Нэр засах» товч нэрийн баганыг
                      өргөсгөхөд огноо хоёр мөр болж хугарахгүй; нэр нь таслагдана. */}
                  <td className="hidden whitespace-nowrap px-3 py-3 sm:table-cell">
                    {p.last_visit ? (
                      <div className="text-xs">
                        <div className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {formatDate(p.last_visit)}
                        </div>
                        {since != null && (
                          <div
                            className={cn(
                              'mt-0.5 text-micro',
                              since > 30 ? 'text-warning font-medium' : 'text-muted-foreground',
                            )}
                          >
                            {since === 0
                              ? t('asr.visitedToday')
                              : t('asr.daysSinceVisit', { n: since })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs italic text-muted-foreground">
                        {t('asr.noVisitsYet')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* =====================  төрлөөр (0362)  ===================== */

/**
 * «Төрлөөр» — 4 төрөл ҮРГЭЛЖ (0-тэй ч), тогтмол дараалалтай.  «Очилт» (KPI,
 * сарын график) нь ЗӨВХӨН талбайн хяналт тул бусад гурвыг
 * эндээс л харна (эзний шийдвэр 2026-09-29: «самбарт тусад нь тоолно»).
 */
function TypePanel({ data }: { data: AsrStatsResponse | null }) {
  const { t } = useLanguage();
  const rows = data?.by_type ?? [];
  return (
    <section id="sec-asr-types" className={cn(PANEL, 'scroll-mt-24')} data-testid="asr-type-panel">
      <SectionHead icon={Layers} title={t('asr.type.statsTitle')} />
      <div className="px-4 pb-5 sm:px-5">
        {!data ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('asr.statsEmpty')}</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => {
              const Icon = ASR_TYPE_ICON[r.type] ?? HardHat;
              return (
                <li key={r.type} className="flex items-center gap-2.5" data-testid={`asr-type-row-${r.type}`}>
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{t(REPORT_TYPE_KEY[r.type] ?? r.type)}</div>
                    <div className="text-micro tabular-nums text-muted-foreground">
                      {t('asr.type.statsThisMonth', { n: r.this_month })}
                      {r.last_date && ` · ${t('asr.visitsLast', { date: formatDate(r.last_date) })}`}
                    </div>
                  </div>
                  <span className="shrink-0 text-base font-semibold tabular-nums">{r.total}</span>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > 0 && (
          <p className="mt-3 text-micro text-muted-foreground">{t('asr.type.statsHint')}</p>
        )}
      </div>
    </section>
  );
}

/* =====================  бүрдэл  ===================== */

function CompletenessPanel({ data }: { data: AsrStatsResponse | null }) {
  const { t } = useLanguage();
  // Улаан дэвтэр, гарын үсэг, зураг нь БҮХ төрлийн тайлан дээр (0362) —
  // хуваарь ч бүх тайлан.  Хуучин worker `reports`-гүй → очилт.
  const total = data?.totals.reports ?? data?.totals.visits ?? 0;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return (
    <section id="sec-asr-completeness" className={cn(PANEL, 'scroll-mt-24')}>
      <SectionHead icon={ClipboardCheck} title={t('asr.statsCompleteness')} />
      <div className="px-4 pb-5 sm:px-5">
        {!data || !data.review || !data.signatures ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">{t('asr.statsReview')}</span>
                {data.review.sample > 0 && data.review.avg_days != null ? (
                  <span className="font-semibold tabular-nums">
                    {t('asr.statsReviewAvg', { days: data.review.avg_days })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t('asr.statsReviewNone')}</span>
                )}
              </div>
              {data.review.sample > 0 && (
                <div className="mt-0.5 text-micro text-muted-foreground">
                  {t('asr.statsReviewSample', { n: data.review.sample })}
                  {data.review.max_days != null &&
                    ` · ${t('asr.statsReviewMax', { days: data.review.max_days })}`}
                </div>
              )}
            </div>

            <Meter
              icon={BookOpenCheck}
              label={t('asr.redBookVerified')}
              value={data.red_book.verified}
              total={total}
              pct={pct(data.red_book.verified)}
              hint={
                `${t('asr.redBookSigned')} ${data.red_book.signed} · ${t('asr.redBookMissing')} ${data.red_book.missing}` +
                (data.red_book.absent ? ` · ${t('asr.redBookAbsent')} ${data.red_book.absent}` : '')
              }
            />
            <Meter
              icon={PenLine}
              label={t('asr.statsSigBoth')}
              value={data.signatures.both}
              total={total}
              pct={pct(data.signatures.both)}
              hint={`${t('asr.statsSigArch')} ${data.signatures.arch} · ${t('asr.statsSigSite')} ${data.signatures.site}`}
            />
            <div className="flex items-baseline justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" />
                {t('asr.statsPhotos')}
              </span>
              <span className="font-semibold tabular-nums">
                {data.totals.photos_total}
                {total > 0 && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({(data.totals.photos_total / total).toFixed(1)} / {t('asr.statsReportUnit')})
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Meter({
  icon: Icon,
  label,
  value,
  total,
  pct,
  hint,
}: {
  icon: typeof BookOpenCheck;
  label: string;
  value: number;
  total: number;
  pct: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className="font-semibold tabular-nums">
          {value}/{total}
          <span className="ml-1 font-normal text-muted-foreground">{pct}%</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            pct >= 80 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-danger',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {hint && <div className="text-micro text-muted-foreground">{hint}</div>}
    </div>
  );
}

/* =====================  сарын график  ===================== */

function MonthChart({ data }: { data: AsrStatsResponse['by_month'] }) {
  const { t } = useLanguage();
  const rows = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        label: `${Number(d.month.slice(5, 7))}${t('asr.monthShortSuffix')}`,
        pending: d.visits - d.approved,
      })),
    [data, t],
  );
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
          barCategoryGap="30%"
        >
          <CartesianGrid strokeDasharray="0" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={32}
          />
          <RechartsTooltip
            cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return (
                <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold">{p.month}</div>
                  <div className="mt-1 text-muted-foreground">
                    {t('asr.statsTotalVisits')}{' '}
                    <span className="text-foreground tabular-nums">{p.visits}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {t('asr.statsApproved')}{' '}
                    <span className="text-foreground tabular-nums">{p.approved}</span>
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="approved" stackId="v" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
          <Bar
            dataKey="pending"
            stackId="v"
            fill="hsl(var(--primary))"
            fillOpacity={0.35}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center gap-4 px-2 text-micro text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-primary" />
          {t('asr.statusApproved')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-primary/35" />
          {t('asr.statusSubmitted')}
        </span>
      </div>
    </div>
  );
}

/* =====================  сүүлийн тайлангууд  ===================== */

function RecentList({
  rows,
  loading,
  onOpen,
}: {
  rows: AsrStatsRecent[];
  loading: boolean;
  onOpen: (row: AsrStatsRecent) => void;
}) {
  const { t } = useLanguage();
  if (loading) return <Spinner className="py-10" />;
  if (rows.length === 0) {
    return (
      <div className="px-6 py-10 text-center text-sm italic text-muted-foreground">
        {t('asr.statsEmpty')}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((r) => {
        const codes = (r.team_codes ?? '').split(',').filter(Boolean);
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpen(r)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 sm:px-5"
            >
              <div className="w-[4.5rem] shrink-0 sm:w-24">
                <div className="font-mono text-xs font-semibold sm:text-sm">{r.doc_no ?? '—'}</div>
                <div className="text-micro tabular-nums text-muted-foreground">
                  {formatDate(r.report_date)}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{asrProjectName(r.project_name)}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-micro text-muted-foreground">
                  {r.author_name && <span className="truncate">{r.author_name}</span>}
                  <AsrTypeBadge r={r} />
                  {codes.map((code) => (
                    <span
                      key={code}
                      className={cn(
                        'rounded-full border px-1.5 py-0 text-[10px] font-medium',
                        teamChipClass(code),
                      )}
                    >
                      {code}
                    </span>
                  ))}
                  {r.photo_count > 0 && (
                    <span className="inline-flex items-center gap-0.5 tabular-nums">
                      <Paperclip className="h-3 w-3" />
                      {r.photo_count}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <AsrStatusBadge status={r.status} />
                <AsrRedBookBadge status={r.red_book_status} className="hidden sm:inline-flex" />
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex justify-center py-6', className)}>
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
