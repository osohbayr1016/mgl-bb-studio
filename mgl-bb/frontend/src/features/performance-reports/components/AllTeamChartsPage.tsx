import {
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LabelList,
} from 'recharts';
import { PageHeader, PageFooter } from '@/features/performance-reports/components/TableOfContents';
import { T } from '@/features/performance-reports/lib/reportText';
import type { TeamSnapshotItem } from '@/features/performance-reports/types/performanceReport';
import type { ProjectDetailResponse, ProjectPassport } from '@/shared/types';

/* Project-level headline counts shown as a KPI strip on the charts page. */
export interface ChartProjectStats {
  drawings: number;
  components: number;
  tasks: number;
  teams: number;
  members: number;
  durationDays: number | null;
}

/* Derive the KPI counts from the already-fetched project detail + passport
 * (no extra round trip). Matches the backend overview: tasks/components/
 * drawings walked from the block hierarchy, members = project_members,
 * duration = inclusive calendar days between passport start/finish. */
export function computeChartStats(
  project: ProjectDetailResponse,
  passport: ProjectPassport,
  activeTeamCount: number,
): ChartProjectStats {
  let drawings = 0;
  let components = 0;
  let tasks = 0;
  // Headcount = explicitly-added members (project_members) UNION anyone
  // assigned to a task, deduped — same definition as the backend
  // member_count and the project detail header, so the report agrees with
  // the rest of the app instead of counting only the project_members roster.
  const memberIds = new Set<number>();
  for (const m of project.members ?? []) memberIds.add(m.id);
  for (const b of project.blocks ?? []) {
    for (const d of b.drawings ?? []) {
      drawings += 1;
      for (const c of d.components ?? []) {
        components += 1;
        const compTasks = c.tasks ?? [];
        tasks += compTasks.length;
        for (const t of compTasks) {
          for (const a of t.assignees ?? []) memberIds.add(a.user_id);
        }
      }
    }
  }
  let durationDays: number | null = null;
  if (passport.start_date && passport.finish_date) {
    const s = new Date(passport.start_date).getTime();
    const e = new Date(passport.finish_date).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      durationDays = Math.round((e - s) / 86_400_000) + 1;
    }
  }
  return {
    drawings,
    components,
    tasks,
    teams: activeTeamCount,
    members: memberIds.size,
    durationDays,
  };
}

/* =============================================================
 * Багуудын нэгтгэсэн график — тайлангийн хамгийн сүүлийн хуудас.
 * -------------------------------------------------------------
 *   • Хэвтээ баганан — баг бүрийн гүйцэтгэл %. Баганууд тайлангийн
 *     navy палитрын дотор (харанавтараас цайвар руу сүүдэр) тул баг
 *     бүр ялгаатай хэрнээ тайлантай нийцтэй харагдана.
 *
 * PRINT-SAFE recharts (Cloudflare Browser Rendering-д заавал):
 *   • ResponsiveContainer БИШ — fixed px width/height (headless
 *     Chromium-д ResizeObserver найдваргүй → SVG хоосон гарах эрсдэл).
 *   • Бүх цуврал isAnimationActive={false} — анимаци `data-print-ready`
 *     гарцтай уралдана.
 * ============================================================= */

/* Report navy ramp (dark #0F243E → light slate) so each bar stays in the
 * report's palette while reading as a distinct shade. */
function navyShade(i: number, n: number): string {
  const t = n > 1 ? i / (n - 1) : 0;
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${lerp(15, 125)}, ${lerp(36, 147)}, ${lerp(62, 179)})`;
}

export interface AllTeamChartsPageProps {
  reportNo: number;
  reportDocNo: string | null;
  reportDate: string;
  teams: TeamSnapshotItem[];
  /** Project-wide progress % (dashboard headline) for the gauge below. */
  overallProgress: number;
  /** Project headline counts shown as a KPI strip at the top. */
  stats: ChartProjectStats;
}

/* Custom Y-axis tick: team name in the report's navy (consistent + readable
 * against the navy bars, instead of per-team rainbow colours). */
function TeamNameTick(props: {
  x?: number;
  y?: number;
  payload?: { value: string };
  nameByCode: Record<string, string>;
}) {
  const { x = 0, y = 0, payload, nameByCode } = props;
  const code = payload?.value ?? '';
  return (
    <text x={x - 6} y={y} dy={3} textAnchor="end" fontSize={9} fontWeight={700} fill="#0F243E">
      {nameByCode[code] ?? code}
    </text>
  );
}

export function AllTeamChartsPage({
  reportNo,
  reportDocNo,
  reportDate,
  teams,
  overallProgress,
  stats,
}: AllTeamChartsPageProps) {
  if (teams.length === 0) return null;

  const overall = Math.max(0, Math.min(100, Number(overallProgress) || 0));
  /* `k` — засварлагдах шошгын түлхүүр (`lib/reportText.tsx`).  Энэ хуудас нь
   * БЛОК БИШ тул баримтын түвшний `ReportTextContext`-д унана — иймд
   * `charts.` угтвар ЗААВАЛ (танилцуулгын блокийн түлхүүртэй мөргөлдөхгүй). */
  const statItems: Array<{ k: string; label: string; value: string }> = [
    { k: 'charts.lbl.drawings', label: 'Зураг', value: String(stats.drawings) },
    { k: 'charts.lbl.tasks', label: 'Ажил', value: String(stats.tasks) },
    { k: 'charts.lbl.teams', label: 'Идэвхт баг', value: String(stats.teams) },
    { k: 'charts.lbl.members', label: 'Ажилчид', value: String(stats.members) },
    {
      k: 'charts.lbl.duration',
      label: 'Хугацаа (өдөр)',
      value: stats.durationDays != null ? String(Math.round(stats.durationDays)) : '—',
    },
    { k: 'charts.lbl.overall', label: 'Төслийн нийт явц', value: `${overall.toFixed(1)}%` },
  ];

  const nameByCode: Record<string, string> = {};
  teams.forEach((t) => {
    nameByCode[t.team_code] = t.team_name_mn;
  });

  // Horizontal bar: per-team completion %.
  const barData = teams.map((t) => ({
    code: t.team_code,
    progress: Math.round(Number(t.progress) * 10) / 10,
  }));
  const barHeight = teams.length * 30 + 28;

  return (
    <div className="perf-page" data-toc="charts">
      <PageHeader reportNo={reportNo} reportDocNo={reportDocNo} reportDate={reportDate} />

      <div className="perf-intro__section-num" data-a4-item>
        <T k="charts.h.section">Багуудын нэгтгэсэн график</T>
      </div>

      {/* ─── Төслийн товч үзүүлэлт (KPI strip) ───
          ⚠️ `flex-wrap` мөр — ХУВААГДВАЛ картууд хоёр хуудсанд тарна.
          Бүхэлдээ НЭГ нэгж; `.perf-stats__item` дээр тэмдэглэгээ ТАВИХГҮЙ. */}
      <div className="perf-stats" data-a4-item>
        {statItems.map((s) => (
          <div key={s.k} className="perf-stats__item">
            <div className="perf-stats__num">{s.value}</div>
            <div className="perf-stats__label">
              <T k={s.k}>{s.label}</T>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Явцын chart (дээр): хэвтээ баганан ───
          Гарчиг + SVG нь ХУВААГДАХ БОЛОМЖГҮЙ нэгж (recharts-ийн SVG-г
          таслах боломжгүй) — багийн тоо олон бол бүхэлдээ шинэ хуудсанд. */}
      <div className="perf-charts__block" data-a4-item>
        <div className="perf-charts__title">
          <T k="charts.h.bar">Багуудын гүйцэтгэл (%)</T>
        </div>
        <BarChart
          layout="vertical"
          width={640}
          height={barHeight}
          data={barData}
          margin={{ top: 6, right: 52, bottom: 6, left: 8 }}
        >
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} />
          <YAxis
            type="category"
            dataKey="code"
            width={150}
            interval={0}
            tickLine={false}
            axisLine={false}
            tick={<TeamNameTick nameByCode={nameByCode} />}
          />
          <Bar dataKey="progress" isAnimationActive={false} radius={[0, 3, 3, 0]} barSize={18}>
            {barData.map((d, i) => (
              <Cell key={d.code} fill={navyShade(i, barData.length)} />
            ))}
            <LabelList
              dataKey="progress"
              position="right"
              formatter={(v) => `${v}%`}
              style={{ fontSize: 10, fill: '#374151', fontWeight: 700 }}
            />
          </Bar>
        </BarChart>
      </div>

      <PageFooter />
    </div>
  );
}

/* Injected by the print/preview pages alongside the other report
 * stylesheets (one big concatenated <style>). */
export const ALL_TEAM_CHARTS_STYLES = `
/* Project KPI strip — navy-accented count cards. */
.perf-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  border: 1px solid #d4d9e0;
  border-radius: 4px;
  overflow: hidden;
  margin: 4mm 0 2mm;
}
.perf-stats__item {
  flex: 1 1 0;
  min-width: 70px;
  text-align: center;
  padding: 4mm 2mm;
  border-right: 1px solid #e4e8ee;
  background: #f7f9fb;
}
.perf-stats__item:last-child { border-right: none; }
.perf-stats__num {
  font-size: 17pt;
  font-weight: 700;
  color: #0F243E;
  line-height: 1;
}
.perf-stats__label {
  font-size: 8.5pt;
  color: #6b7785;
  margin-top: 2mm;
}
.perf-charts__block { margin-top: 6mm; }
.perf-charts__title {
  font-size: 10pt;
  font-weight: 700;
  color: #0F243E;
  margin-bottom: 3mm;
}
/* Overall-progress gauge (navy ring + centred %). */
.perf-charts__gauge {
  position: relative;
  width: 200px;
  height: 200px;
}
.perf-charts__gauge-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.perf-charts__gauge-value {
  font-size: 28pt;
  font-weight: 700;
  color: #0F243E;
  line-height: 1;
}
.perf-charts__gauge-sub {
  font-size: 9pt;
  color: #6b7785;
  margin-top: 3px;
}
.perf-charts__block .recharts-wrapper { margin-left: -8px; }
`;
