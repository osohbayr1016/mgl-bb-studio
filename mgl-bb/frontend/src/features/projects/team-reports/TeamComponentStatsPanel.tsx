import { useMemo } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { T } from '@/features/performance-reports/lib/reportText';
import type { ProjectDetailResponse } from '@/shared/types';

/* =============================================================
 * TeamComponentStatsPanel — flat aggregated stats per team.
 * -------------------------------------------------------------
 * Used in three places via the same component:
 *   - Inside the on-screen Тайлан pane of TeamReportShell.
 *   - Inside the per-team print page when ?mode=client (PDF).
 *   - Inside Section 3 + Section 4 of the project-wide PDF.
 *
 * Aggregation: components with the same name across every block /
 * drawing under the team are merged into one row.  Weights are
 * summed, progress is the weighted task average. Tasks are kept
 * as separate rows underneath each aggregated component — we
 * don't try to merge tasks by name. The visual matches the
 * screenshot the user shared: one team header above, one flat
 * table below (no drawing subheaders).
 *
 * Exception: HIERARCHICAL_TEAMS дахь багууд (одоогоор IZ) хавтгай
 * нэгтгэлгүй — блок бүр толгой мөртэй, доор нь тухайн блокийн БҮХ
 * ажил шууд жагсана (Зураг/Бүрдэл түвшний гарчгийн мөр гаргахгүй;
 * бүрдлийн нэр ажлын мөрөнд бүдэг тэмдэглэгээ болно). Интерьерийн
 * блокууд давхар/бүсээ илэрхийлдэг тул нэрээр нэгтгэх нь мэдээллийг
 * алддаг байсан; 4 түвшний бүтэн мод нь хэт гүн байсан тул хэрэглэгчийн
 * хүсэлтээр Блок → Ажил болгож хялбарчилсан
 * (docs/superpowers/specs/2026-07-06-iz-team-report-block-hierarchy-design.md).
 *
 * Navy brand color #0F243E is used for the table header, the
 * accent underline, and the progress bar fill — consistent with
 * the project-wide Гүйцэтгэлийн тайлан PDF the user receives at
 * each period boundary.
 *
 * -------------------------------------------------------------
 * A4 ХУУДАСЛАЛТ (`data-a4-item`)
 * -------------------------------------------------------------
 * Гүйцэтгэлийн тайлангийн WYSIWYG урьдчилан харах (`A4Paginator`)
 * нь `[data-a4-item]` элементүүдийг хэмжиж, хуудасны заагт унасныг
 * нь дараагийн хуудас руу түлхдэг.  Энэ хүснэгт нэг A4-ээс УРТ
 * болдог нь мэдэгдэж байгаа (`performance-reports/components/
 * styles.ts` дахь `@media print` дүрэм үүнийг зориудаар урсгадаг)
 * тул тэмдэглэгээг **`<tr>` бүрд** тавьсан — хүснэгт дээр БИШ.
 * Хүснэгт бүхэлдээ нэг item болбол нэг A4-д багтахгүй тул түлхэлт
 * огт үйлчлэхгүй (эсвэл өмнөх хуудсыг хоосон орхино).
 * `<thead>` нь хуудас бүрд давтагддаг тул түүнд item тавихгүй.
 * ⚠️ Үүрлэсэн item хийхгүй: `<table>` / `<tbody>` дээр давхар
 * `data-a4-item` тавьбал paginator зөвхөн гаднахыг нь тооцно.
 *
 * -------------------------------------------------------------
 * ЗАСВАРЛАГДАХ СТАТИК ТЕКСТ (`<T>`)
 * -------------------------------------------------------------
 * Гарчиг / баганын толгой / нэгж зэрэг ХАТУУ бичигдсэн шошгуудыг
 * `<T k="stats.…">` -ээр ороосон.  `ReportTextContext` provider
 * байхгүй үед (Багийн тайлангийн таб, хэвлэх зам) `T` нь энгийн
 * текст рүү уначих тул тэнд харагдац ЯГ ХЭВЭЭР үлдэнэ.
 * ============================================================= */

export interface TeamComponentStatsPanelProps {
  projectId: number;
  teamCode: string;
}

/** Багууд нь хавтгай нэгтгэлийн оронд Блок → Зураг → Бүрдэл → Ажил
 *  бүрэн задаргаагаар харагдана. */
const HIERARCHICAL_TEAMS: ReadonlySet<string> = new Set(['IZ']);

interface TaskRowVm {
  name: string;
  /** Raw `weight_percent` within its drawing-component — used as the
   *  weighting for the component's progress average. */
  weight: number;
  progress: number;
  /** The task's share of the TEAM's total work, shown in the "Жин"
   *  column. Derived from the component's normalised weight, split across
   *  its tasks proportionally to `weight`, so a component's task weights
   *  sum to the component weight and all tasks sum to 100. Set in
   *  `buildRows` after component weights are normalised. */
  displayWeight: number;
}

interface ComponentRowVm {
  name: string;
  tasks: TaskRowVm[];
  /** The component's share of the TEAM's total work, normalised to 100%
   *  across all rows. Derived from the weighted hierarchy
   *  (block% × drawing% × component%, summed by name) — the same weighting
   *  the dashboard uses for progress — so the column is a real distribution
   *  that sums to 100, not the raw per-drawing %s (which summed to
   *  drawings × 100 and read wrong). */
  weight: number;
  /** Weighted task-progress average for the aggregated row. */
  progress: number;
}

export function TeamComponentStatsPanel({ projectId, teamCode }: TeamComponentStatsPanelProps) {
  const projectQuery = useApiQuery<ProjectDetailResponse>(
    ['/projects', projectId],
    `/projects/${projectId}`,
    { enabled: !!projectId },
  );

  const tree = HIERARCHICAL_TEAMS.has(teamCode);
  const vm = useMemo(
    () =>
      tree
        ? ({ kind: 'tree', rows: buildBlockRows(projectQuery.data, teamCode) } as const)
        : ({ kind: 'flat', rows: buildRows(projectQuery.data, teamCode) } as const),
    [projectQuery.data, teamCode, tree],
  );

  if (projectQuery.isLoading && !projectQuery.data) {
    return (
      <div className="team-stats-doc team-stats-doc--placeholder" data-a4-item>
        <T k="stats.txt.loading">Ачаалж байна…</T>
      </div>
    );
  }
  if (projectQuery.error) {
    return (
      <div className="team-stats-doc team-stats-doc--placeholder" data-a4-item>
        <T k="stats.txt.error">Статистикийг ачаалж чадсангүй:</T>{' '}
        {projectQuery.error.message}
      </div>
    );
  }
  if (!vm.rows || vm.rows.length === 0) {
    return (
      <div className="team-stats-doc team-stats-doc--placeholder" data-a4-item>
        <T k="stats.txt.empty">Энэ багт зургийн бүрдэл бүртгэгдээгүй байна.</T>
      </div>
    );
  }

  return (
    <article className="team-stats-doc">
      {/* Гарчиг нь өөрөө нэг item — хуудасны заагт унавал бүхэлдээ
       * дараагийн хуудас руу шилжинэ. */}
      <h2 className="team-stats-doc__title" data-a4-item>
        <T k="stats.h.title">ЯВЦЫН ТОЙМ</T>
      </h2>

      <table
        className={
          vm.kind === 'tree'
            ? 'team-stats-doc__table team-stats-doc__table--tree'
            : 'team-stats-doc__table'
        }
      >
        {/* thead нь хуудас бүрд давтагддаг тул `data-a4-item` тавихгүй. */}
        <thead>
          <tr>
            <th className="team-stats-doc__col-name">
              {vm.kind === 'tree' ? (
                <T k="stats.col.name.tree">Блок / Ажил</T>
              ) : (
                <T k="stats.col.name.flat">Зургийн бүрдэл / Ажил</T>
              )}
            </th>
            <th className="team-stats-doc__col-num-r">
              <T k="stats.col.weight">Жин</T>
            </th>
            <th className="team-stats-doc__col-progress">
              <T k="stats.col.progress">Биелэлт</T>
            </th>
          </tr>
        </thead>
        <tbody>
          {vm.kind === 'tree'
            ? vm.rows.map((block, idx) => (
                <BlockTreeRows key={`${block.name}-${idx}`} block={block} />
              ))
            : vm.rows.map((row, idx) => <ComponentBlock key={`${row.name}-${idx}`} row={row} />)}
        </tbody>
      </table>
    </article>
  );
}

/* Блок задаргаат горимын мөрүүд: блокийн navy толгой мөр, дор нь тухайн
 * блокийн БҮХ ажил шууд жагсана. Бүрдлийн нэр ажлын мөрөнд бүдэг
 * тэмдэглэгээ болно (ижил нэртэй ажлуудыг ялгахад хангалттай, гарчгийн
 * мөрийн шуугиангүйгээр). */
function BlockTreeRows({ block }: { block: TreeBlockVm }) {
  return (
    <>
      <tr className="team-stats-doc__row team-stats-doc__row--block" data-a4-item>
        <td className="team-stats-doc__col-name">
          {block.name}
          <span className="team-stats-doc__row-meta--block">
            {' · '}
            {block.tasks.length} <T k="stats.lbl.tasksunit">ажил</T>
          </span>
        </td>
        <td className="team-stats-doc__col-num-r">{fmtPct(block.weight)}</td>
        <td className="team-stats-doc__col-progress">
          <ProgressCell progress={block.progress} />
        </td>
      </tr>
      {block.tasks.map((task, ti) => (
        <tr
          key={`${task.name}-${ti}`}
          className="team-stats-doc__row team-stats-doc__row--task"
          data-a4-item
        >
          <td className="team-stats-doc__col-name">
            {task.name}
            {task.component && task.component !== task.name && (
              <span className="team-stats-doc__row-meta--task"> · {task.component}</span>
            )}
          </td>
          <td className="team-stats-doc__col-num-r">{fmtPct(task.weight)}</td>
          <td className="team-stats-doc__col-progress">
            <ProgressCell progress={task.progress} />
          </td>
        </tr>
      ))}
    </>
  );
}

/* Component header row followed by one row per task. The component row keeps
 * the aggregated weight + progress (see `buildRows`); each task row shows the
 * task's own progress and its share of the team weight (`displayWeight`). */
function ComponentBlock({ row }: { row: ComponentRowVm }) {
  return (
    <>
      <tr className="team-stats-doc__row team-stats-doc__row--component" data-a4-item>
        <td className="team-stats-doc__col-name">
          {row.name}
          <span className="team-stats-doc__row-meta">
            {' · '}
            {row.tasks.length} <T k="stats.lbl.tasksunit">ажил</T>
          </span>
        </td>
        <td className="team-stats-doc__col-num-r">{fmtPct(row.weight)}</td>
        <td className="team-stats-doc__col-progress">
          <ProgressCell progress={row.progress} />
        </td>
      </tr>
      {row.tasks.map((task, i) => (
        <tr
          key={`${task.name}-${i}`}
          className="team-stats-doc__row team-stats-doc__row--task"
          data-a4-item
        >
          <td className="team-stats-doc__col-name">{task.name}</td>
          <td className="team-stats-doc__col-num-r">{fmtPct(task.displayWeight)}</td>
          <td className="team-stats-doc__col-progress">
            <ProgressCell progress={task.progress} />
          </td>
        </tr>
      ))}
    </>
  );
}

function ProgressCell({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className="team-stats-doc__progress">
      <div className="team-stats-doc__bar">
        <div className="team-stats-doc__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="team-stats-doc__bar-label">{pct}%</span>
    </div>
  );
}

function fmtPct(n: number): string {
  return `${(Number.isFinite(n) ? n : 0).toFixed(2)}%`;
}

/* ─────────────────── derivation ─────────────────── */

interface TreeTaskVm {
  name: string;
  /** Ажлын харьяалагдах бүрдлийн нэр — блок доор шууд жагсахад ижил
   *  нэртэй ажлуудыг ялгах бүдэг тэмдэглэгээ. */
  component: string;
  /** Багийн нийт ажлын доторх хувь (блок → зураг → бүрдэл → ажлын
   *  гинжээр хуваарилагдсан). */
  weight: number;
  progress: number;
}

interface TreeBlockVm {
  name: string;
  weight: number;
  progress: number;
  tasks: TreeTaskVm[];
}

/** Parent-ийн жинг хүүхдүүдэд өөрсдийнх нь raw жингээр хувь тэнцүүлж
 *  хуваарилна; бүх жин 0 үед тэнцүү хуваана (хавтгай горимын fallback-тай
 *  ижил зарчим — багана хэзээ ч дан тэгээр дүүрэхгүй). */
function distributeWeights<T>(parentWeight: number, items: T[], raw: (item: T) => number): number[] {
  const total = items.reduce((sum, item) => sum + Math.max(0, raw(item)), 0);
  if (total > 0) return items.map((item) => (Math.max(0, raw(item)) / total) * parentWeight);
  return items.map(() => parentWeight / items.length);
}

/** HIERARCHICAL_TEAMS-ийн мод: багийн блокуудыг нэгтгэлгүй, блок бүрийн
 *  доор түүний БҮХ ажлыг иерархийн дарааллаар нь шууд жагсаана (Зураг/
 *  Бүрдэл түвшний мөр гаргахгүй — тэдгээрийн жин ажлууд руугаа гинжээр
 *  хуваарилагдана). «Биелэлт» нь блок мөрөнд серверийн rolled-up
 *  `progress`, ажлын мөрөнд ажлын өөрийн progress; «Жин» нь хоёр түвшинд
 *  хоёуланд нь багийн нийт ажлын хувь (блокууд 100 болтол нормчлогдож,
 *  блокийн жин нь доторх ажлууддаа бүрэн хуваарилагдана). */
function buildBlockRows(
  data: ProjectDetailResponse | undefined,
  teamCode: string,
): TreeBlockVm[] | null {
  if (!data) return null;
  const share = data.team_shares?.find((ts) => ts.team_code === teamCode);
  if (!share) return null;
  const blocks = data.blocks.filter((b) => b.team_id === share.team_id);
  if (blocks.length === 0) return null;

  const blockWeights = distributeWeights(100, blocks, (b) => Number(b.weight_percent) || 0);
  return blocks.map((b, bi) => {
    const tasks: TreeTaskVm[] = [];
    const drawings = b.drawings ?? [];
    const drawWeights = distributeWeights(
      blockWeights[bi] ?? 0,
      drawings,
      (d) => Number(d.weight_percent) || 0,
    );
    drawings.forEach((d, di) => {
      const components = d.components ?? [];
      const compWeights = distributeWeights(
        drawWeights[di] ?? 0,
        components,
        (c) => Number(c.weight_percent) || 0,
      );
      components.forEach((c, ci) => {
        const compTasks = c.tasks ?? [];
        const taskWeights = distributeWeights(
          compWeights[ci] ?? 0,
          compTasks,
          (t) => Number(t.weight_percent) || 0,
        );
        compTasks.forEach((t, ti) => {
          tasks.push({
            name: t.name || 'Ажил',
            component: c.name || '',
            weight: taskWeights[ti] ?? 0,
            progress: Number(t.progress) || 0,
          });
        });
      });
    });
    return {
      name: b.name || 'Блок',
      weight: blockWeights[bi] ?? 0,
      progress: Number(b.progress) || 0,
      tasks,
    };
  });
}

function buildRows(
  data: ProjectDetailResponse | undefined,
  teamCode: string,
): ComponentRowVm[] | null {
  if (!data) return null;
  const share = data.team_shares?.find((ts) => ts.team_code === teamCode);
  if (!share) return null;
  const teamId = share.team_id;
  const blocks = data.blocks.filter((b) => b.team_id === teamId);
  if (blocks.length === 0) return null;

  // Bin by component name. Insertion order is preserved by Map, so
  // components surface in the order the admin set them up in the
  // first block they appear in — predictable and stable.
  const byName = new Map<string, ComponentRowVm>();
  for (const b of blocks) {
    const blockW = Number(b.weight_percent) || 0;
    for (const d of b.drawings ?? []) {
      const drawW = Number(d.weight_percent) || 0;
      for (const c of d.components ?? []) {
        const name = c.name || 'Бүрдэл';
        const incomingTasks: TaskRowVm[] = (c.tasks ?? []).map((t) => ({
          name: t.name || 'Ажил',
          weight: Number(t.weight_percent) || 0,
          progress: Number(t.progress) || 0,
          displayWeight: 0, // filled in below once component weights are normalised
        }));
        // This occurrence's share of the TEAM's total work = block% ×
        // drawing% × component% (the same weighted hierarchy the dashboard
        // uses for progress). Summed by name, then normalised to 100 below
        // — so the column is a real weight distribution instead of the raw
        // per-drawing %s, which add up to (drawings × 100) and read wrong.
        const effW = (blockW / 100) * (drawW / 100) * ((Number(c.weight_percent) || 0) / 100);
        const existing = byName.get(name);
        if (existing) {
          existing.tasks.push(...incomingTasks);
          existing.weight += effW;
          existing.progress = weightedAvg(existing.tasks);
        } else {
          byName.set(name, {
            name,
            tasks: incomingTasks,
            weight: effW,
            progress: weightedAvg(incomingTasks),
          });
        }
      }
    }
  }

  const rows = Array.from(byName.values());
  if (rows.length === 0) return null;
  // Normalise to 100% so the "Жин" column is a proper share distribution.
  // Fallback to an equal split when the hierarchy carries no weights at all
  // (mis-configured project) so the column never shows all-zeros.
  const totalW = rows.reduce((s, r) => s + r.weight, 0);
  if (totalW > 0) {
    for (const r of rows) r.weight = (r.weight / totalW) * 100;
  } else {
    for (const r of rows) r.weight = 100 / rows.length;
  }
  // Distribute each component's (now-normalised) weight across its tasks in
  // proportion to the task's raw weight. A component's task weights then sum
  // to the component weight, and all tasks across the table sum to 100 — so
  // the "Жин" column reads consistently at both levels. When a component's
  // tasks carry no weight at all, split it equally (same fallback spirit as
  // the component-level normalisation above) so the column never shows zeros.
  for (const r of rows) {
    const taskTotal = r.tasks.reduce((s, t) => s + t.weight, 0);
    if (taskTotal > 0) {
      for (const t of r.tasks) t.displayWeight = (t.weight / taskTotal) * r.weight;
    } else if (r.tasks.length > 0) {
      for (const t of r.tasks) t.displayWeight = r.weight / r.tasks.length;
    }
  }
  return rows;
}

function weightedAvg(tasks: TaskRowVm[]): number {
  let tw = 0;
  let acc = 0;
  for (const t of tasks) {
    tw += t.weight;
    acc += t.weight * t.progress;
  }
  return tw > 0 ? acc / tw : 0;
}

/* =============================================================
 * Styles — exported so the print pages can inject them into their
 * own <style> tags (Tailwind doesn't carry into the print HTML's
 * shadow context). Theme color is the same navy `#0F243E` used by
 * the project-wide Гүйцэтгэлийн тайлан PDF.
 * ============================================================= */
export const TEAM_STATS_DOC_STYLES = `
.team-stats-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.5; max-width: 760px; margin: 18px auto; padding: 0 16px; }
.team-stats-doc--placeholder { font-style: italic; color: #888; padding: 20px 16px; text-align: center; }
.team-stats-doc__title {
  text-align: center;
  font-size: 15pt;
  font-weight: 700;
  margin: 0 0 14px;
  letter-spacing: 0.04em;
  color: #0F243E;
  border-bottom: 2px solid #0F243E;
  padding-bottom: 6px;
}

.team-stats-doc__table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
.team-stats-doc__table th, .team-stats-doc__table td { padding: 5px 8px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
.team-stats-doc__table th {
  font-weight: 600;
  text-align: left;
  background: #0F243E;
  color: #fff;
  border-bottom: 1px solid #0F243E;
}

.team-stats-doc__col-num-r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; width: 90px; }
.team-stats-doc__col-name { width: auto; }
.team-stats-doc__col-progress { width: 180px; }

.team-stats-doc__row--component td {
  background: #f1f4f9;
  color: #0F243E;
  font-weight: 600;
  border-bottom: 1px solid #d8dee8;
}
.team-stats-doc__row--component .team-stats-doc__row-meta {
  font-weight: 400;
  color: #5a6478;
  font-size: 9.5pt;
}

/* Блок задаргаат горимын толгой мөр — зөвхөн HIERARCHICAL_TEAMS.
 * Дэвсгэр нь thead-ийн #0F243E-ээс арай цайвар navy: эхний блокийн мөр
 * толгойтой нийлж уншигдахаас сэргийлнэ; цайвар хүрээ нь хоосон блокууд
 * зэрэгцэхэд заагийг ялгана. */
.team-stats-doc__row--block td {
  background: #1B3A5F;
  color: #fff;
  font-weight: 700;
  border-bottom: 1px solid rgba(255, 255, 255, 0.35);
}
.team-stats-doc__row--block .team-stats-doc__bar { background: rgba(255, 255, 255, 0.25); }
.team-stats-doc__row--block .team-stats-doc__bar-fill { background: #fff; }
.team-stats-doc__row--block .team-stats-doc__bar-label { color: #fff; }
.team-stats-doc__row-meta--block { font-weight: 400; color: rgba(255, 255, 255, 0.75); font-size: 9.5pt; }

/* Ажлын мөрөн дэх бүрдлийн бүдэг тэмдэглэгээ (блок доор шууд жагссан
 * ажлуудыг ялгах контекст). */
.team-stats-doc__row-meta--task { font-weight: 400; color: #9aa3b2; font-size: 8.5pt; }

/* Task rows sit under their component header — indented, lighter, smaller. */
.team-stats-doc__row--task td {
  background: #fff;
  font-weight: 400;
  color: #333;
  font-size: 9.5pt;
  border-bottom: 1px solid #eee;
}
.team-stats-doc__row--task .team-stats-doc__col-name {
  padding-left: 24px;
  position: relative;
  color: #444;
}
.team-stats-doc__row--task .team-stats-doc__col-name::before {
  content: "•";
  position: absolute;
  left: 10px;
  color: #9aa3b2;
}
.team-stats-doc__progress { display: flex; align-items: center; gap: 8px; }
.team-stats-doc__bar { position: relative; flex: 1; background: #eee; border-radius: 6px; height: 10px; min-width: 0; }
.team-stats-doc__bar-fill { position: absolute; top: 0; left: 0; bottom: 0; background: #0F243E; border-radius: 6px; }
.team-stats-doc__bar-label { font-size: 9.5pt; font-variant-numeric: tabular-nums; color: #333; min-width: 36px; text-align: right; flex-shrink: 0; }

@media print {
  .team-stats-doc { max-width: none; padding: 0; }
  .team-stats-doc__row--component,
  .team-stats-doc__row--block { break-after: avoid-page; }
  .team-stats-doc__bar-fill,
  .team-stats-doc__row--block .team-stats-doc__bar,
  .team-stats-doc__table th,
  .team-stats-doc__row--component td,
  .team-stats-doc__row--block td {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;
