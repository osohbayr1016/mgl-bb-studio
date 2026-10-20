import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { EmptyState } from '@/shared/components/EmptyState';
import { PageHeader } from '@/shared/components/PageHeader';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Label } from '@/ui/label';
import { Switch } from '@/ui/switch';

import { assessmentKeys, fetchRoundResults } from '../api';
import { DEFAULT_LEVELS } from '../lib/score';
import { captureParts, chartKeyFor } from '../lib/chartImage';
import {
  averageParts,
  buildCohort,
  checkAverageInvariant,
  hasSharedDenominator,
  seriesMemberCounts,
  sidesPresent,
  type CohortMode,
} from '../lib/aggregate';
import { exportRoundXlsx, fmtPct, type RoundXlsxGroup } from '../lib/exportAssessmentXlsx';
import { LevelTag } from '../components/LevelTag';
import { CohortPanel } from './CohortPanel';
import { BehaviorResultsSection } from './BehaviorResultsSection';
import { PartResultCard } from './PartResultCard';
import {
  ALL_TEAMS,
  NO_TEAM,
  type SubFilter,
  type TeamOption,
} from '../lib/participantFilters';
import { ParticipantsResultsTable } from './ParticipantsResultsTable';
import { RosterPanel } from './RosterPanel';
import { USERS_ASSESSMENTS_TAB } from './AssessmentsAdminTab';

export interface RoundResultsViewProps {
  roundId: number;
  backTo?: string;
}

export function RoundResultsView({ roundId, backTo = USERS_ASSESSMENTS_TAB }: RoundResultsViewProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const chartsRef = useRef<HTMLDivElement>(null);

  const [teamCode, setTeamCode] = useState(() => searchParams.get('team') ?? ALL_TEAMS);
  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState<SubFilter>('all');
  const [cohortMode, setCohortMode] = useState<CohortMode | null>(null);
  const [detailNumbers, setDetailNumbers] = useState(true);
  const [exporting, setExporting] = useState(false);

  const query = useQuery({
    queryKey: assessmentKeys.roundResults(roundId),
    queryFn: () => fetchRoundResults(roundId),
  });

  const data = query.data;
  const results = useMemo(() => data?.results ?? [], [data]);
  const levels = data?.schema.levels?.length ? data.schema.levels : DEFAULT_LEVELS;

  const teamOptions = useMemo<TeamOption[]>(() => {
    const map = new Map<string, string>();
    for (const r of results) {
      const code = r.team_code ?? NO_TEAM;
      const label =
        r.team_code && r.team_name_mn
          ? `${r.team_code} — ${r.team_name_mn}`
          : (r.team_code ?? t('assessments.noTeam'));
      if (!map.has(code)) map.set(code, label);
    }
    return [...map.entries()].map(([code, label]) => ({ code, label }));
  }, [results, t]);

  const cohortFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results.filter((r) => {
      if (teamCode !== ALL_TEAMS && (r.team_code ?? NO_TEAM) !== teamCode) return false;
      if (!q) return true;
      return `${r.full_name} ${r.employee_id ?? ''} ${r.position ?? ''}`.toLowerCase().includes(q);
    });
  }, [results, teamCode, search]);

  const cohort = useMemo(() => {
    const requested = buildCohort(cohortFiltered, cohortMode ?? undefined);
    if (requested.mode === 'both' && !requested.bothAvailable) return buildCohort(cohortFiltered);
    return requested;
  }, [cohortFiltered, cohortMode]);

  const cohortCounts = useMemo(() => {
    let both = 0;
    let self = 0;
    for (const r of cohortFiltered) {
      if (r.self_submitted) self += 1;
      if (r.self_submitted && r.senior_submitted) both += 1;
    }
    return { both, self };
  }, [cohortFiltered]);

  const displayParts = useMemo(
    () => averageParts(cohort.members, levels),
    [cohort.members, levels],
  );

  const skillParts = useMemo(
    () => displayParts.filter((p) => p.weighted),
    [displayParts],
  );

  const sides = useMemo(() => sidesPresent(skillParts), [skillParts]);
  const showAverageSeries = sides.self && sides.senior;
  // Цуваа тус бүр ӨӨРИЙН нэрлэгчтэй: «Ахлагчийн үнэлгээ (3)» гэж легендэд
  // гарснаар 11 хүний дундажийг 3 хүний шугамтай харьцуулж байгаа нь
  // нүдэнд илэрхий болно.
  const seriesCounts = useMemo(() => seriesMemberCounts(cohort.members), [cohort.members]);

  const overallPart = displayParts.find((p) => p.weighted) ?? displayParts[0] ?? null;
  const teamLabel =
    teamCode === ALL_TEAMS
      ? t('assessments.allTeams')
      : (teamOptions.find((o) => o.code === teamCode)?.label ?? t('assessments.noTeam'));
  const viewLabel = `${teamLabel} · ${t('assessments.averageView')}`;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // Нэрлэгч ялгаатай үед «дундаж нь хоёрын хооронд» гэдэг инвариант
    // ХАМААРАХГҮЙ (aggregate.ts-ийн толгойг үз) — дэмий сэрэмжлүүлэхгүй.
    if (!hasSharedDenominator(seriesCounts)) return;
    const problems = checkAverageInvariant(displayParts);
    if (problems.length) console.warn('[assessments] дундажийн инвариант:', problems);
  }, [displayParts, seriesCounts]);

  const buildGroups = (): RoundXlsxGroup[] => {
    const groups: RoundXlsxGroup[] = [];
    const push = (label: string, list: typeof results) => {
      const members = buildCohort(list, cohort.mode).members;
      if (!members.length) return;
      groups.push({ label, memberCount: members.length, parts: averageParts(members, levels) });
    };
    push(t('assessments.allParticipants'), cohortFiltered);
    const byTeam = new Map<string, typeof results>();
    for (const r of cohortFiltered) {
      const code = r.team_code ?? NO_TEAM;
      const bucket = byTeam.get(code);
      if (bucket) bucket.push(r);
      else byTeam.set(code, [r]);
    }
    for (const [code, teamMembers] of byTeam) {
      push(teamOptions.find((o) => o.code === code)?.label ?? t('assessments.noTeam'), teamMembers);
    }
    return groups;
  };

  const handleExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const charts = await captureParts(
        chartsRef.current,
        displayParts,
        'round',
        viewLabel,
        t('assessments.chartRadarExportSuffix'),
      );
      const missing = charts.some((c) => !c.dataUrl);
      if (missing) toast.warn(t('assessments.exportNoCharts'));
      await exportRoundXlsx({
        round: data.round,
        schema: data.schema,
        results: cohortFiltered,
        groups: buildGroups(),
        charts,
        t,
      });
      toast.success(t('assessments.exportDone'));
    } catch {
      toast.error(t('assessments.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const openParticipant = (userId: number) => {
    const team = teamCode !== ALL_TEAMS ? `?team=${encodeURIComponent(teamCode)}` : '';
    navigate(`/app/admin/assessments/${roundId}/${userId}${team}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={backTo}
        title={data?.round.name ?? t('assessments.loading')}
        description={
          data
            ? `${data.round.period} · ${t('assessments.participantsCount', { count: results.length })}`
            : undefined
        }
        actions={
          <Button variant="outline" size="sm" disabled={exporting || !data} onClick={() => void handleExport()}>
            {exporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <FileSpreadsheet className="size-4" aria-hidden />
            )}
            {t('assessments.exportExcel')}
          </Button>
        }
      />

      {query.isLoading && (
        <div className="flex justify-center py-20 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </div>
      )}

      {query.isError && (
        <EmptyState
          title={t('assessments.loadFailed')}
          description={t('assessments.loadFailedHint')}
          action={
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      )}

      {data && (
        <>
          {/* Жагсаалтын аудит — нэмэх/хасах ёстой хүн байхад Л гарч ирнэ. */}
          <RosterPanel roundId={roundId} />

          <Card>
            <CardContent className="p-0">
              <ParticipantsResultsTable
                roundId={roundId}
                results={results}
                teamCode={teamCode}
                onTeamCodeChange={setTeamCode}
                teamOptions={teamOptions}
                search={search}
                onSearchChange={setSearch}
                subFilter={subFilter}
                onSubFilterChange={setSubFilter}
              />
            </CardContent>
          </Card>

          <div className="flex items-center gap-2">
            <Switch id="detail-numbers" checked={detailNumbers} onCheckedChange={setDetailNumbers} />
            <Label htmlFor="detail-numbers">{t('assessments.detailNumbersToggle')}</Label>
          </div>

          <div ref={chartsRef} className="space-y-6">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-section">{viewLabel}</h3>
              <span className="text-micro text-muted-foreground">
                {t('assessments.participantsCount', { count: cohort.members.length })}
              </span>
              {overallPart?.weighted && (
                <span className="ml-auto inline-flex items-baseline gap-2">
                  <span className="text-2xl font-bold tabular-nums">
                    {fmtPct(overallPart.overall_pct)}
                  </span>
                  <LevelTag level={overallPart.overall_level} />
                </span>
              )}
            </div>

            <CohortPanel
              cohort={cohort}
              bothCount={cohortCounts.both}
              selfCount={cohortCounts.self}
              onModeChange={setCohortMode}
              onSelectUser={(r) => openParticipant(r.user_id)}
            />

            {!skillParts.length && (
              <EmptyState compact title={t('assessments.noResults')} description={t('assessments.noResultsHint')} />
            )}

            {skillParts.map((part) => (
              <PartResultCard
                key={part.part_id}
                part={part}
                levels={levels}
                showSelf={sides.self}
                showSenior={sides.senior}
                showAverage={showAverageSeries}
                seriesCounts={seriesCounts}
                chartKey={chartKeyFor('round', part.part_id)}
                chartScope="round"
                detailNumbers={detailNumbers}
              />
            ))}

            <BehaviorResultsSection
              round={data.round}
              schema={data.schema}
              cohortFiltered={cohortFiltered}
              cohort={cohort}
              teamLabel={teamLabel}
              levels={levels}
              detailNumbers={detailNumbers}
              onOpenPerson={openParticipant}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default RoundResultsView;
