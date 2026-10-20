import { useMemo } from 'react';
import { CheckCircle2, Sparkles, FileText, Building2, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Progress } from '@/ui/progress';
import { teamChipClass } from '@/shared/lib/team-colors';
import { formatDate } from '@/shared/lib/time';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import type { BlockProgress, ProjectTeamShare, TaskProgress } from '@/shared/types';

/* Subset of `project_team_reports` we pull from for the facts panel.
 * Each team's `answers` is a free-form Record<string, unknown> JSON blob
 * since the per-team templates evolve independently; we narrow at the
 * extraction step instead of typing every team's shape in this file. */
interface TeamReportSummaryRow {
  project_id: number;
  team_code: string;
  building_type: string | null;
  answers: Record<string, unknown>;
  updated_at: string;
  updated_by_id: number | null;
}

interface TeamReportsListResponse {
  reports: TeamReportSummaryRow[];
}

/** Strict string-from-answers helper. Returns null for missing/blank
 *  values so the rendering side can `??` to a placeholder cleanly. */
function readStr(answers: Record<string, unknown> | undefined, key: string): string | null {
  if (!answers) return null;
  const v = answers[key];
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** Parse a numeric string out of an answer field. Used by the loads
 *  bar chart which needs comparable values across teams. */
function readNum(answers: Record<string, unknown> | undefined, key: string): number | null {
  const s = readStr(answers, key);
  if (!s) return null;
  const n = Number(s.replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const PURPOSE_LABEL_MN: Record<string, string> = {
  residential: 'Орон сууцны',
  public: 'Олон нийтийн',
  service: 'Үйлчилгээтэй орон сууцны',
  industrial: 'Үйлдвэрийн',
  mixed_use: 'Холимог зориулалттай',
};

const LATERAL_LABEL_MN: Record<string, string> = {
  cast_in_place: 'Бүрэн цутгамал',
  rc_frame: 'Рам-холбоост ТБ',
  shear_wall: 'ТБ ханан даацт',
  steel_frame: 'Металл каркас',
  hybrid: 'Холимог',
};

const FOUNDATION_LABEL_MN: Record<string, string> = {
  mat: 'Нил хавтан',
  strip: 'Шугаман',
  cup: 'Аяган',
  pile: 'Шонгийн',
  hybrid: 'Холимог',
};

const HEAT_SOURCE_LABEL_MN: Record<string, string> = {
  district: 'Хотын дулаан',
  central_own: 'Барилгын төвлөрсөн',
  boiler: 'Уурын зуух',
  heat_pump: 'Дулааны насос',
  electric: 'Цахилгаан',
};

/* =============================================================
 * ProjectSummaryTab — "Хураангуй" sub-tab of the Тайлан tab.
 * -------------------------------------------------------------
 * Auto-aggregates the project's completed tasks (latest approved
 * entry at 100 %) into per-team → per-block bullets, using the
 * AI completion summary cached on `tasks.ai_completion_summary`
 * (see backend/src/lib/taskCompletionAi.ts).  Nothing here writes
 * data — it just re-shapes what `GET /projects/:id` already
 * returns, so the report stays in sync with the rest of the page
 * with no extra fetch.
 *
 * Falls back gracefully when:
 *   - a team has no blocks on this project (skipped entirely)
 *   - a block has no completed tasks ("Дууссан ажил алга байна")
 *   - a completed task has no AI summary yet (shows a hint that
 *     the summary is still being generated)
 * ============================================================= */

interface ProjectSummaryTabProps {
  projectName: string;
  projectId: number;
  blocks: BlockProgress[];
  teamShares: ProjectTeamShare[];
}

export function ProjectSummaryTab({
  projectName,
  projectId,
  blocks,
  teamShares,
}: ProjectSummaryTabProps) {
  const { t } = useLanguage();
  // Pull every saved Тайлбар бичиг for this project in a single call.
  // The endpoint already exists (used by the badge query in
  // TeamReportsTab) — we re-use the same query key so TanStack Query
  // dedupes when both panels are mounted.
  const reportsQuery = useApiQuery<TeamReportsListResponse>(
    ['/projects/team-reports', projectId] as const,
    `/projects/${projectId}/team-reports`,
  );
  const reportByCode = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of reportsQuery.data?.reports ?? []) {
      m.set(r.team_code.toUpperCase(), r.answers ?? {});
    }
    return m;
  }, [reportsQuery.data]);

  // BA carries the project-level TEZ values + classification.  Other
  // teams contribute operational loads + their own choice of system
  // (foundation, lateral, heat source, etc.) which read nicely as a
  // "design choices" table.
  const ba = reportByCode.get('BA');
  const bb = reportByCode.get('BB');
  const has = reportByCode.get('HAS');
  const cbu = reportByCode.get('TSBU');
  const tsah = reportByCode.get('TSAH');
  // Project-level (баг бус) нэгтгэсэн хэсгүүд: барилгын ангилал → GENERAL,
  // галын усны нөөц → FIRE (өмнө BA / TSBU-д байсныг зөөсөн).
  const general = reportByCode.get('GENERAL');
  const fire = reportByCode.get('FIRE');

  // Facts panel — only show the fields the BA team has actually filled,
  // never a sea of "—" placeholders.
  const facts = useMemo(() => {
    if (!ba && !general) return null;
    return {
      // Ангилал нь "Үндэслэл, ангилал" (GENERAL) хэсэгт зөөгдсөн.
      purpose: readStr(general, 'building_purpose_category'),
      fire_class: readStr(general, 'fire_safety_class'),
      seismic: readStr(general, 'seismic_intensity_balls'),
      lifetime: readStr(general, 'building_lifetime_years'),
      floor_count: readStr(ba, 'tez_floor_count'),
      capacity: readStr(ba, 'tez_capacity'),
      volume: readStr(ba, 'tez_volume_m3'),
      built_area: readStr(ba, 'tez_built_area_m2'),
      useful_area: readStr(ba, 'tez_useful_area_m2'),
      working_area: readStr(ba, 'tez_working_area_m2'),
      design_year: readStr(ba, 'design_year'),
      design_month: readStr(ba, 'design_month'),
    };
  }, [ba, general]);

  // Operational loads chart data.  Mixed units (kW + m³/day + m³)
  // would compress badly on a shared scale, so we render two separate
  // groups instead — kW loads and water-volume loads — each scaled to
  // its own row max.
  const loadsKw = useMemo(() => {
    const rows: Array<{ team: string; label: string; value: number; unit: string }> = [];
    const heatLoad = readNum(has, 'heat_load_total');
    const elInstalled = readNum(tsah, 'source_load_total');
    const elCalc = readNum(tsah, 'source_load_calculated');
    if (heatLoad != null)
      rows.push({ team: 'HAS', label: t('projectSummaryTab.heating'), value: heatLoad, unit: 'кВт' });
    if (elInstalled != null)
      rows.push({ team: 'TSAH', label: t('projectSummaryTab.elInstalled'), value: elInstalled, unit: 'кВт' });
    if (elCalc != null)
      rows.push({ team: 'TSAH', label: t('projectSummaryTab.elCalculated'), value: elCalc, unit: 'кВт' });
    return rows;
  }, [has, tsah, t]);

  const loadsWater = useMemo(() => {
    const rows: Array<{ team: string; label: string; value: number; unit: string }> = [];
    const water = readNum(cbu, 'water_demand_total');
    // Галын усны нөөц "Галын аюулгүй байдал" (FIRE) хэсэгт зөөгдсөн.
    const fireReserve = readNum(fire, 'fire_reserve_volume');
    if (water != null)
      rows.push({ team: 'TSBU', label: t('projectSummaryTab.waterDemand'), value: water, unit: 'м³/хоног' });
    if (fireReserve != null)
      rows.push({ team: 'TSBU', label: t('projectSummaryTab.fireReserve'), value: fireReserve, unit: 'м³' });
    return rows;
  }, [cbu, fire, t]);

  // Engineering choices table — pulled from the right team per row.
  // Shown only when at least one row has a value so the panel doesn't
  // appear with empty cells for a fresh project.
  const choices = useMemo(() => {
    return {
      lateral: readStr(bb, 'lateral_system'),
      foundation: readStr(bb, 'foundation_type'),
      concrete: readStr(bb, 'concrete_grade_main'),
      rebar: readStr(bb, 'rebar_grade_main'),
      heat_source: readStr(has, 'heat_source_kind'),
      bms_proto: readStr(reportByCode.get('AU'), 'bms_protocol'),
    };
  }, [bb, has, reportByCode]);
  const hasAnyChoice = Object.values(choices).some((v) => v != null);

  // Hide the whole "design facts + loads + choices" stack when nothing
  // has been filled anywhere; engineers shouldn't see a forest of
  // placeholders just because no Тайлбар бичиг has been started yet.
  const showFactsBlock =
    facts != null || loadsKw.length > 0 || loadsWater.length > 0 || hasAnyChoice;
  // Build per-team groupings up front so the rendering loop is plain.
  // We order teams by share_percent desc (the biggest discipline
  // for the project shows up first), then within a team sort blocks
  // by their weight desc so the report reads top-down by importance.
  const groups = useMemo(() => {
    const byTeam = new Map<number, BlockProgress[]>();
    for (const b of blocks) {
      if (b.team_id == null) continue;
      const arr = byTeam.get(b.team_id) ?? [];
      arr.push(b);
      byTeam.set(b.team_id, arr);
    }
    return teamShares
      .slice()
      .sort((a, b) => b.share_percent - a.share_percent)
      .map((ts) => {
        const teamBlocks = (byTeam.get(ts.team_id) ?? [])
          .slice()
          .sort((a, b) => b.weight_percent - a.weight_percent);
        // Blocks weight to 100 within a team → team progress is just
        // Σ(weight × progress)/100. Empty teams render as 0 % and the
        // panel below shows the "no blocks" placeholder instead.
        const teamProgress =
          teamBlocks.length === 0
            ? 0
            : teamBlocks.reduce((acc, b) => acc + (b.weight_percent * b.progress) / 100, 0);
        return { share: ts, blocks: teamBlocks, progress: teamProgress };
      });
  }, [blocks, teamShares]);

  const completedCount = useMemo(
    () =>
      blocks.reduce((acc, b) => acc + (b.tasks ?? []).filter((t) => t.progress >= 100).length, 0),
    [blocks],
  );

  return (
    <div className="space-y-4">
      {/* Cover card — project + completion tally. Mirrors what the
          eventual printable PDF will lead with. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> {t('projectSummaryTab.summary')}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {t('projectSummaryTab.summaryDesc')}
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SummaryStat label={t('projectSummaryTab.project')} value={projectName} tone="text-foreground" />
            <SummaryStat
              label={t('projectSummaryTab.completedTasks')}
              value={`${completedCount}`}
              tone="text-success"
            />
            <SummaryStat label={t('projectSummaryTab.responsibleTeams')} value={`${groups.length}`} tone="text-primary" />
          </div>
        </CardContent>
      </Card>

      {/* Project facts panel — auto-extracted from the BA Тайлбар бичиг
          (TEZ + classification fields). Hidden until at least one of
          BA / BB / HAS / ЦБУ / ЦАХ has been saved, so a fresh project
          doesn't lead with a panel full of placeholders. */}
      {showFactsBlock && facts && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" /> {t('projectSummaryTab.buildingIntro')}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {t('projectSummaryTab.buildingIntroDesc')}
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {facts.purpose && (
                <FactCard
                  label={t('projectSummaryTab.factPurpose')}
                  value={PURPOSE_LABEL_MN[facts.purpose] ?? facts.purpose}
                />
              )}
              {facts.floor_count && <FactCard label={t('projectSummaryTab.factFloorCount')} value={facts.floor_count} />}
              {facts.capacity && <FactCard label={t('projectSummaryTab.factCapacity')} value={facts.capacity} />}
              {facts.built_area && (
                <FactCard label={t('projectSummaryTab.factBuiltArea')} value={`${facts.built_area} м²`} />
              )}
              {facts.useful_area && (
                <FactCard label={t('projectSummaryTab.factUsefulArea')} value={`${facts.useful_area} м²`} />
              )}
              {facts.working_area && (
                <FactCard label={t('projectSummaryTab.factWorkingArea')} value={`${facts.working_area} м²`} />
              )}
              {facts.volume && <FactCard label={t('projectSummaryTab.factVolume')} value={`${facts.volume} м³`} />}
              {facts.fire_class && (
                <FactCard label={t('projectSummaryTab.factFireClass')} value={`${facts.fire_class} ${t('projectSummaryTab.classUnit')}`} />
              )}
              {facts.seismic && <FactCard label={t('projectSummaryTab.factSeismic')} value={`${facts.seismic} ${t('projectSummaryTab.ballUnit')}`} />}
              {facts.lifetime && <FactCard label={t('projectSummaryTab.factLifetime')} value={`${facts.lifetime} ${t('projectSummaryTab.yearUnit')}`} />}
              {(facts.design_year || facts.design_month) && (
                <FactCard
                  label={t('projectSummaryTab.factDesigned')}
                  value={`${facts.design_year ?? '—'}/${facts.design_month ?? '—'}`}
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Operational loads — small CSS-bar chart. Separate groups by
          unit (kW, m³) so the bars compare meaningfully within each
          row group. Uses plain divs instead of recharts to keep the
          ProjectDetailPage route chunk free of the recharts dep. */}
      {(loadsKw.length > 0 || loadsWater.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> {t('projectSummaryTab.loadDistribution')}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {t('projectSummaryTab.loadDistributionDesc')}
            </p>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            {loadsKw.length > 0 && (
              <LoadBars title={t('projectSummaryTab.loadKwTitle')} rows={loadsKw} />
            )}
            {loadsWater.length > 0 && <LoadBars title={t('projectSummaryTab.loadWaterTitle')} rows={loadsWater} />}
          </CardContent>
        </Card>
      )}

      {/* Engineering choices — small table pulling the canonical system
          decisions across BB / HAS / АУ. Useful for the cover-page
          one-liner: "Бүрэн цутгамал, нил хавтан суурь, B30, BACnet…" */}
      {hasAnyChoice && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> {t('projectSummaryTab.engineeringChoices')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {choices.lateral && (
                <ChoiceRow
                  team="BB"
                  label={t('projectSummaryTab.choiceLateral')}
                  value={LATERAL_LABEL_MN[choices.lateral] ?? choices.lateral}
                />
              )}
              {choices.foundation && (
                <ChoiceRow
                  team="BB"
                  label={t('projectSummaryTab.choiceFoundation')}
                  value={FOUNDATION_LABEL_MN[choices.foundation] ?? choices.foundation}
                />
              )}
              {choices.concrete && (
                <ChoiceRow team="BB" label={t('projectSummaryTab.choiceConcrete')} value={choices.concrete} />
              )}
              {choices.rebar && (
                <ChoiceRow team="BB" label={t('projectSummaryTab.choiceRebar')} value={choices.rebar} />
              )}
              {choices.heat_source && (
                <ChoiceRow
                  team="HAS"
                  label={t('projectSummaryTab.choiceHeatSource')}
                  value={HEAT_SOURCE_LABEL_MN[choices.heat_source] ?? choices.heat_source}
                />
              )}
              {choices.bms_proto && (
                <ChoiceRow team="AU" label={t('projectSummaryTab.choiceBms')} value={choices.bms_proto.toUpperCase()} />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-team panels.  Teams that don't actually own any blocks on
          this project are filtered out so the panel doesn't show empty
          discipline placeholders for unrelated teams. */}
      {groups.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('projectSummaryTab.noTeamsAssigned')}
          </CardContent>
        </Card>
      )}

      {groups.map(({ share, blocks: teamBlocks, progress }) => (
        <Card key={share.team_id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <Badge variant="outline" className={teamChipClass(share.team_code)}>
                  {share.team_code}
                </Badge>
                <span className="truncate">{share.team_name_mn}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  · {t('projectSummaryTab.ownsPercent', { percent: share.share_percent })}
                </span>
              </CardTitle>
              <div className="flex items-center gap-2 min-w-[180px]">
                <Progress value={progress} className="w-32 h-2" />
                <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                  {Math.round(progress)}%
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {teamBlocks.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                {t('projectSummaryTab.noBlocksForTeam')}
              </p>
            ) : (
              teamBlocks.map((block) => <BlockSection key={block.id} block={block} />)
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Per-block section: header with the block name + progress, then a list of
 *  completed tasks. Renders a soft "nothing done yet" hint instead of being
 *  silent so the editor knows the row is intentionally empty. */
function BlockSection({ block }: { block: BlockProgress }) {
  const { t } = useLanguage();
  const completed = (block.tasks ?? []).filter((tk) => tk.progress >= 100);
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{block.name}</span>
          <span className="text-micro text-muted-foreground shrink-0">
            · {t('projectSummaryTab.weightPercent', { percent: block.weight_percent })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Progress value={block.progress} className="w-20 h-1.5" />
          <span className="text-micro tabular-nums text-muted-foreground w-9 text-right">
            {Math.round(block.progress)}%
          </span>
        </div>
      </div>

      {completed.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{t('projectSummaryTab.noCompletedTasks')}</p>
      ) : (
        <ul className="space-y-2">
          {completed.map((tk) => (
            <CompletedTaskItem key={tk.id} task={tk} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One completed task bullet. Shows the AI summary when ready; otherwise a
 *  neutral hint so the reader knows the row is mid-processing rather than
 *  thinking the engineer left it blank. */
function CompletedTaskItem({ task }: { task: TaskProgress }) {
  const { t } = useLanguage();
  const summary = task.ai_completion_summary?.trim();
  return (
    <li className="flex gap-2 items-start">
      <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight">{task.name}</div>
        {summary ? (
          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap leading-relaxed">
            {summary}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground italic mt-1">
            {t('projectSummaryTab.aiSummaryGenerating')}
          </p>
        )}
        {task.ai_completion_summary_at && (
          <div className="text-micro text-muted-subtle mt-1">
            {formatDate(task.ai_completion_summary_at)}
          </div>
        )}
      </div>
    </li>
  );
}

/** One value cell for the Барилгын танилцуулга grid.  Uses the same
 *  soft-border look as the existing SummaryStat but keeps the value
 *  on a separate line so longer values (e.g. "36,415 м²") wrap nicely. */
function FactCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-label text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

/** Horizontal bar group.  Each row's width is `value / rowMax × 100%`
 *  so the longest bar in the group fills the line and the others scale
 *  proportionally.  Stays as pure CSS — no chart library dep so this
 *  panel works in the print route too. */
function LoadBars({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ team: string; label: string; value: number; unit: string }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      <div className="text-label text-muted-foreground">{title}</div>
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const pct = Math.max(2, Math.round((r.value / max) * 100));
          return (
            <div key={i} className="grid grid-cols-[80px_1fr_auto] gap-2 items-center">
              <Badge
                variant="outline"
                className={`${teamChipClass(r.team)} justify-self-start text-micro`}
              >
                {r.team}
              </Badge>
              <div className="relative h-5 rounded-md bg-muted/40 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-primary/40"
                  style={{ width: `${pct}%` }}
                />
                <div className="relative px-2 text-micro leading-5 truncate">{r.label}</div>
              </div>
              <div className="text-xs tabular-nums text-foreground font-medium whitespace-nowrap">
                {r.value.toLocaleString()} {r.unit}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One row in the "Инженерийн шийдэл" grid. Carries a team chip so
 *  the reader knows which discipline owns the decision. */
function ChoiceRow({ team, label, value }: { team: string; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 flex items-center gap-3">
      <Badge variant="outline" className={`${teamChipClass(team)} text-micro`}>
        {team}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="text-label text-muted-foreground">{label}</div>
        <div className="text-sm font-medium text-foreground truncate">{value}</div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-label text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 truncate ${tone}`}>{value}</div>
    </div>
  );
}
