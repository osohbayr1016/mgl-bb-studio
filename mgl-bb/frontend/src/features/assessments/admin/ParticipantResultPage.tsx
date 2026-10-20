import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { EmptyState } from '@/shared/components/EmptyState';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Label } from '@/ui/label';
import { Switch } from '@/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';

import {
  assessmentKeys,
  fetchParticipantResult,
  fetchRoundResults,
  type ParticipantResult,
} from '../api';
import type { AssessmentLevelBand } from '../types';
import { DEFAULT_LEVELS } from '../lib/score';
import { captureParts, chartKeyFor, toChartSections } from '../lib/chartImage';
import { averageParts, buildCohort, sidesPresent, type ResultPart } from '../lib/aggregate';
import { buildAnswerRows, exportParticipantXlsx, fmtPoints } from '../lib/exportAssessmentXlsx';
import { LevelUpPlanCard } from '../components/LevelUpPlanCard';
import { USERS_ASSESSMENTS_TAB } from './AssessmentsAdminTab';
import { PartResultCard } from './PartResultCard';

function computeBenchmark(
  result: ParticipantResult,
  allResults: ParticipantResult[],
  levels: AssessmentLevelBand[],
): ResultPart[] | null {
  let scope = allResults;
  if (result.team_code) {
    const teamMembers = allResults.filter((r) => r.team_code === result.team_code);
    if (teamMembers.length >= 2) scope = teamMembers;
  }
  const cohort = buildCohort(scope);
  if (cohort.members.length < 2) return null;
  return averageParts(cohort.members, levels);
}

export default function ParticipantResultPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { roundId, userId } = useParams<{ roundId: string; userId: string }>();
  const location = useLocation();
  const chartsRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [detailNumbers, setDetailNumbers] = useState(true);

  const rId = Number(roundId);
  const uId = Number(userId);
  const valid = Number.isInteger(rId) && rId > 0 && Number.isInteger(uId) && uId > 0;
  const isAdmin = user?.role === 'admin';

  const query = useQuery({
    queryKey: assessmentKeys.roundResults(rId),
    queryFn: () => fetchRoundResults(rId),
    enabled: isAdmin && valid,
  });

  /**
   * «Түвшин ахих зам» нь ЗӨВХӨН нэг хүний гарцаас ирнэ — жагсаалтын гарц
   * оролцогч бүрийнхийг цувуулбал хариулт олон дахин том болно (сервер талд
   * хаасан).  Жагсаалтыг орлуулж БОЛОХГҮЙ: benchmark нь бүх cohort-ыг шаардна.
   */
  const detailQuery = useQuery({
    queryKey: assessmentKeys.participantResult(rId, uId),
    queryFn: () => fetchParticipantResult(rId, uId),
    enabled: isAdmin && valid,
  });

  const data = query.data;
  const result = useMemo(
    () => data?.results.find((r) => r.user_id === uId) ?? null,
    [data, uId],
  );
  const levelUpParts = detailQuery.data?.result.level_up ?? null;
  const levels = data?.schema.levels?.length ? data.schema.levels : DEFAULT_LEVELS;
  const parts = result?.parts ?? [];
  const sides = useMemo(() => sidesPresent(parts), [parts]);
  const showAverage = sides.self && sides.senior;

  const benchmarkParts = useMemo(
    () => (result && data ? computeBenchmark(result, data.results, levels) : null),
    [result, data, levels],
  );

  const benchCount = useMemo(() => {
    if (!result || !data) return 0;
    let scope = data.results;
    if (result.team_code) {
      const team = data.results.filter((r) => r.team_code === result.team_code);
      if (team.length >= 2) scope = team;
    }
    return buildCohort(scope).members.length;
  }, [result, data]);

  const answerRows = useMemo(
    () => (data && result ? buildAnswerRows(data.schema, result) : []),
    [data, result],
  );

  const backTo = `/app/admin/assessments/${rId}${location.search}`;

  const handleExport = async () => {
    if (!data || !result) return;
    setExporting(true);
    try {
      const charts = await captureParts(
        chartsRef.current,
        parts,
        'detail',
        formatDisplayName(result.full_name),
        t('assessments.chartRadarExportSuffix'),
      );
      if (charts.some((c) => !c.dataUrl)) toast.warn(t('assessments.exportNoCharts'));
      await exportParticipantXlsx({ round: data.round, schema: data.schema, result, charts, t });
      toast.success(t('assessments.exportDone'));
    } catch {
      toast.error(t('assessments.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  if (!isAdmin) return <Navigate to="/app" replace />;
  if (!valid) return <Navigate to={USERS_ASSESSMENTS_TAB} replace />;

  return (
    <PageContainer>
      <PageHeader
        backTo={backTo}
        backLabel={t('assessments.backToRound')}
        title={result ? formatDisplayName(result.full_name) : t('assessments.loading')}
        description={
          result && data
            ? [
                result.position,
                result.team_code,
                `${data.round.name} · ${data.round.period}`,
                result.senior_evaluators.length
                  ? `${t('assessments.colEvaluator')}: ${result.senior_evaluators
                      .map((e) => (e.full_name ? formatDisplayName(e.full_name) : null))
                      .filter(Boolean)
                      .join(', ')}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        actions={
          result ? (
            <Button variant="outline" size="sm" disabled={exporting} onClick={() => void handleExport()}>
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
              {t('assessments.exportExcel')}
            </Button>
          ) : undefined
        }
      />

      {query.isLoading && (
        <div className="flex justify-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {query.isError && (
        <EmptyState title={t('assessments.loadFailed')} description={t('assessments.loadFailedHint')} />
      )}

      {data && !result && !query.isLoading && (
        <EmptyState
          title={t('assessments.participantNotFound')}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={backTo}>{t('assessments.backToRound')}</Link>
            </Button>
          }
        />
      )}

      {result && data && (
        <div ref={chartsRef} className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={result.self_submitted ? 'default' : 'outline'}>
              {t('assessments.sideSelf')}: {result.self_submitted ? t('assessments.yes') : t('assessments.no')}
            </Badge>
            <Badge variant={result.senior_submitted ? 'default' : 'outline'}>
              {t('assessments.sideSenior')}: {result.senior_submitted ? t('assessments.yes') : t('assessments.no')}
            </Badge>
            {benchmarkParts && (
              <span className="text-micro text-muted-foreground">
                {t('assessments.benchmarkNote', {
                  scope: result.team_code
                    ? t('assessments.benchmarkScopeTeam', { team: result.team_code })
                    : t('assessments.benchmarkScopeAll'),
                  count: benchCount,
                })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch id="p-detail-numbers" checked={detailNumbers} onCheckedChange={setDetailNumbers} />
            <Label htmlFor="p-detail-numbers">{t('assessments.detailNumbersToggle')}</Label>
          </div>

          {parts.map((part) => {
            const benchPart = benchmarkParts?.find((p) => p.part_id === part.part_id);
            const benchSections = benchPart ? toChartSections(benchPart) : undefined;
            // «Түвшин ахих зам» — хөгжлийн ярианы суурь.  Ажилтны хардаг
            // картын ЯГ ИЖИЛ бүрэлдэхүүн (сервер нэг л газраас бодно) тул
            // админ, ажилтан хоёр өөр зөвлөмж хэзээ ч харахгүй.
            const levelUp = levelUpParts?.find((p) => p.part_id === part.part_id);
            return (
              <div key={part.part_id} className="space-y-4">
                <PartResultCard
                  part={part}
                  levels={levels}
                  showSelf={sides.self}
                  showSenior={sides.senior}
                  showAverage={showAverage}
                  showBenchmark={!!benchSections}
                  benchmarkSections={benchSections}
                  seriesCounts={benchSections ? { benchmark: benchCount } : undefined}
                  chartKey={chartKeyFor('detail', part.part_id)}
                  chartScope="detail"
                  detailNumbers={detailNumbers}
                />
                {levelUp && <LevelUpPlanCard part={levelUp} />}
              </div>
            );
          })}

          <section className="space-y-3">
            <h3 className="text-section">{t('assessments.answersTitle')}</h3>
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('assessments.colSection')}</TableHead>
                  <TableHead>{t('assessments.colGroup')}</TableHead>
                  <TableHead>{t('assessments.colQuestion')}</TableHead>
                  <TableHead className="text-right">{t('assessments.colSelfScore')}</TableHead>
                  <TableHead className="text-right">{t('assessments.colSeniorScore')}</TableHead>
                  <TableHead className="text-right">{t('assessments.colAverageScore')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {answerRows.map((row, i) => (
                  <TableRow key={`${row.section}-${i}`}>
                    <TableCell className="text-muted-foreground">{row.section}</TableCell>
                    <TableCell className="text-muted-foreground">{row.group}</TableCell>
                    <TableCell>{row.question}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.self ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.senior ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtPoints(row.average)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </div>
      )}
    </PageContainer>
  );
}
