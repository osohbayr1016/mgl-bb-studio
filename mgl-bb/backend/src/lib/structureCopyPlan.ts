/**
 * Төслийн БҮТЭЦ хуулах ЦЭВЭР төлөвлөгч (planner).
 *
 * Засварын гэрээ (`ZA` ангилал) нэг барилга дээр дахин ирэхэд admin блок →
 * зураг → бүрэлдэхүүн → ажил гэсэн бүх шатлалыг гараар дахин байгуулдаг.
 * Энэ модуль нь ЭХ төслийн мод + сонголтыг аваад, ЯМАР мөр үүсэх, тэдгээр нь
 * төслийн хэдэн хувийн ТААЗ (`ceiling_pct`) өгөхийг тооцоолж буцаана.
 *
 * ⚠️ ЖИН ХЭВЭЭРЭЭ ХУУЛАГДАНА («keep» горим).  Эзний шийдвэр: дахин
 *    хуваарилахгүй, масштаблахгүй, дугуйлахгүй, таслахгүй.  7 мэргэжлээс
 *    2-ыг л хуулбал багийн эзэмшлийн нийлбэр 41 болж, төсөл хэзээ ч 41%-иас
 *    дээш заахгүй — энэ нь АЛДАА биш, ухамсартай сонголт.  Тиймээс
 *    `ceiling_pct`-ийг ил гаргаж UI дээр тодоор харуулах ёстой.
 *
 * ⚠️ ЭНЭ ФАЙЛ DB-д хүрэхгүй, `routes/`-оос юу ч импортлохгүй.  Ижил оролт →
 *    яг ижил гаралт (Date, Math.random хэрэглэхгүй).
 */

/* ------------------------------------------------------------------ */
/*  Оролт                                                              */
/* ------------------------------------------------------------------ */

export interface CopySourceTree {
  team_shares: {
    team_id: number;
    team_code: string;
    team_name: string;
    share_percent: number;
    sort_order: number;
  }[];
  blocks: {
    id: number;
    name: string;
    weight_percent: number;
    sort_order: number;
    team_id: number | null;
    responsible_name: string | null;
  }[];
  drawings: {
    id: number;
    block_id: number;
    name: string;
    weight_percent: number;
    sort_order: number;
  }[];
  components: {
    id: number;
    drawing_id: number;
    name: string;
    weight_percent: number;
    sort_order: number;
  }[];
  tasks: {
    id: number;
    component_id: number;
    name: string;
    weight_percent: number;
    sort_order: number;
  }[];
}

/** null / undefined = «энэ түвшинд БҮГД сонгогдсон». */
export interface CopySelection {
  team_ids?: number[] | null;
  block_ids?: number[] | null;
  drawing_ids?: number[] | null;
  component_ids?: number[] | null;
  task_ids?: number[] | null;
}

/* ------------------------------------------------------------------ */
/*  Гаралт                                                             */
/* ------------------------------------------------------------------ */

/**
 * `NOT_SELECTED` нь гэрээнд байгаа ч ЭНЭ төлөвлөгч хэзээ ч бичихгүй: admin
 * өөрөө салгасан мөрийг `pruned`-д жагсаах нь зүгээр л шуугиан.  Зөвхөн
 * КАСКАД (хоосорсоны улмаас) устгалт бүртгэгдэнэ.
 */
export type PruneReason =
  | 'NOT_SELECTED'
  | 'NO_TASKS'
  | 'NO_DRAWINGS'
  | 'NO_COMPONENTS'
  | 'NO_BLOCKS';

export interface PlannedTask {
  src_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
}
export interface PlannedComponent {
  src_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
  tasks: PlannedTask[];
}
export interface PlannedDrawing {
  src_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
  components: PlannedComponent[];
}
export interface PlannedBlock {
  src_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
  team_id: number | null;
  team_code: string | null;
  responsible_name: string | null;
  drawings: PlannedDrawing[];
}

export type CopyWarningCode =
  | 'CEILING_BELOW_100'
  | 'ZERO_WEIGHT_DRAWING'
  | 'ZERO_WEIGHT_BLOCK'
  | 'TEAM_WITHOUT_BLOCKS'
  | 'BLOCK_WITHOUT_TEAM'
  | 'TASK_WEIGHTS_UNDER_BUDGET'
  | 'TASK_WEIGHTS_OVER_BUDGET';

export interface CopyWarning {
  code: CopyWarningCode;
  count?: number;
  detail?: string;
}

export interface CopyPlan {
  team_shares: {
    team_id: number;
    team_code: string;
    team_name: string;
    share_percent: number;
    sort_order: number;
  }[];
  blocks: PlannedBlock[];
  counts: { teams: number; blocks: number; drawings: number; components: number; tasks: number };
  pruned: {
    teams: { team_id: number; team_code: string; reason: PruneReason }[];
    blocks: { src_id: number; name: string; reason: PruneReason }[];
    drawings: { src_id: number; name: string; reason: PruneReason }[];
    components: { src_id: number; name: string; reason: PruneReason }[];
  };
  /** Хуулагдсан БҮХ ажил 100% болбол төсөл хэдэн хувь заахыг (2 орон). */
  ceiling_pct: number;
  warnings: CopyWarning[];
}

/* ------------------------------------------------------------------ */
/*  Туслахууд                                                          */
/* ------------------------------------------------------------------ */

/**
 * Зургийн ажлын жингүүд өөрийнх нь төсөвтэй таарч байгаа эсэхийн хүлцэл.
 * Frontend-ийн `features/projects/setup/weights.ts` → `WEIGHT_EPSILON = 0.5`-ийн
 * ихэр.  Хоёулаа хамт хөдлөх ёстой.
 */
const WEIGHT_TOLERANCE = 0.5;

/** `null`/`undefined` = бүгд сонгогдсон; эс бөгөөс id-гийн Set. */
function toSelector(ids: number[] | null | undefined): Set<number> | null {
  if (ids === null || ids === undefined) return null;
  return new Set(ids);
}

function isSelected(sel: Set<number> | null, id: number): boolean {
  return sel === null || sel.has(id);
}

/** D1-ийн REAL нь онолын хувьд NaN байж болно — тооцоог хордуулахгүй. */
function num(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Дараалал: `(sort_order, id)`.  Бодит өгөгдөлд `sort_order` нь MAX+1 болон
 * (i+1)*10 гэсэн ХОЁР янзын утга хольсон байдаг тул дангаараа бүрэн эрэмбэ
 * биш — id-гаар тогтворжуулна.
 */
function bySortThenId<T extends { sort_order: number; id: number }>(a: T, b: T): number {
  return num(a.sort_order) - num(b.sort_order) || a.id - b.id;
}

/* ------------------------------------------------------------------ */
/*  Төлөвлөгч                                                          */
/* ------------------------------------------------------------------ */

export function planStructureCopy(tree: CopySourceTree, selection: CopySelection): CopyPlan {
  const teamSel = toSelector(selection.team_ids);
  const blockSel = toSelector(selection.block_ids);
  const drawingSel = toSelector(selection.drawing_ids);
  const componentSel = toSelector(selection.component_ids);
  const taskSel = toSelector(selection.task_ids);

  // ── Эх модыг эрэмбэлж, эцгээр нь бүлэглэнэ ─────────────────────────
  const srcBlocks = [...tree.blocks].sort(bySortThenId);
  const srcDrawings = [...tree.drawings].sort(bySortThenId);
  const srcComponents = [...tree.components].sort(bySortThenId);
  const srcTasks = [...tree.tasks].sort(bySortThenId);

  const drawingsByBlock = new Map<number, typeof srcDrawings>();
  for (const d of srcDrawings) {
    const list = drawingsByBlock.get(d.block_id);
    if (list) list.push(d);
    else drawingsByBlock.set(d.block_id, [d]);
  }
  const componentsByDrawing = new Map<number, typeof srcComponents>();
  for (const cmp of srcComponents) {
    const list = componentsByDrawing.get(cmp.drawing_id);
    if (list) list.push(cmp);
    else componentsByDrawing.set(cmp.drawing_id, [cmp]);
  }
  const tasksByComponent = new Map<number, typeof srcTasks>();
  for (const t of srcTasks) {
    const list = tasksByComponent.get(t.component_id);
    if (list) list.push(t);
    else tasksByComponent.set(t.component_id, [t]);
  }

  const srcShares = [...tree.team_shares].sort(
    (a, b) => num(a.sort_order) - num(b.sort_order) || a.team_id - b.team_id,
  );
  const shareByTeam = new Map<number, (typeof srcShares)[number]>();
  for (const s of srcShares) shareByTeam.set(s.team_id, s);

  const pruned: CopyPlan['pruned'] = { teams: [], blocks: [], drawings: [], components: [] };

  const blocks: PlannedBlock[] = [];
  let componentCount = 0;
  let taskCount = 0;
  let zeroWeightDrawings = 0;
  let zeroWeightBlocks = 0;
  let blocksWithoutTeam = 0;
  let underBudgetDrawings = 0;
  let overBudgetDrawings = 0;
  const teamsWithBlocks = new Set<number>();

  for (const block of srcBlocks) {
    if (!isSelected(blockSel, block.id)) continue; // admin өөрөө салгасан — pruned БИШ

    // Багийн (мэргэжлийн) шүүлт.  `team_ids` өгөгдсөн бол БАГТАЙ блокийн баг
    // заавал түүнд байх ёстой.  ГЭХДЭЭ баггүй (team_id = NULL) блок ЯМАР Ч
    // мэргэжилд харьяалагдахгүй тул мэргэжлийн шүүлт түүнийг ХЭЗЭЭ Ч хасахгүй —
    // түүний хувь заяаг зөвхөн дээрх ил `block_ids` жагсаалт шийднэ (UI нь
    // баггүй блокуудыг «—» бүлэгт харуулж, яг үүний тулд `block_ids`-ийг
    // тодорхой илгээдэг).
    //
    // ⚠️ Үр дагавар: rollup нь БАГИЙН ЭЗЭМШЛЭЭР (`project_team_shares`) явдаг тул
    //    баггүй блок `ceiling_pct`-д ямар ч тохиолдолд 0 оруулна (`computeCeiling`
    //    дотор `share = 0`).  Тиймээс түүнийг үлдээх нь ҮНЭНЧ: admin-ы хүссэн
    //    ажлын мөрүүдийг хуулна, гэхдээ байхгүй жинг зохиож нэмэхгүй.  Нөгөө
    //    талаас `BLOCK_WITHOUT_TEAM` сануулга хэвээр гарч байдал ил үлдэнэ.
    if (teamSel !== null && block.team_id !== null && !teamSel.has(block.team_id)) continue;

    const drawings: PlannedDrawing[] = [];
    for (const drawing of drawingsByBlock.get(block.id) ?? []) {
      if (!isSelected(drawingSel, drawing.id)) continue;

      const components: PlannedComponent[] = [];
      for (const component of componentsByDrawing.get(drawing.id) ?? []) {
        if (!isSelected(componentSel, component.id)) continue;

        const tasks: PlannedTask[] = [];
        for (const task of tasksByComponent.get(component.id) ?? []) {
          if (!isSelected(taskSel, task.id)) continue;
          // ⚠️ Жин ЯГ ЭХ УТГААРАА — дугуйлахгүй, дахин хуваарилахгүй.
          tasks.push({
            src_id: task.id,
            name: task.name,
            weight_percent: task.weight_percent,
            sort_order: task.sort_order,
          });
        }

        if (tasks.length === 0) {
          pruned.components.push({
            src_id: component.id,
            name: component.name,
            reason: 'NO_TASKS',
          });
          continue;
        }
        components.push({
          src_id: component.id,
          name: component.name,
          weight_percent: component.weight_percent,
          sort_order: component.sort_order,
          tasks,
        });
      }

      if (components.length === 0) {
        pruned.drawings.push({ src_id: drawing.id, name: drawing.name, reason: 'NO_COMPONENTS' });
        continue;
      }
      drawings.push({
        src_id: drawing.id,
        name: drawing.name,
        weight_percent: drawing.weight_percent,
        sort_order: drawing.sort_order,
        components,
      });
    }

    if (drawings.length === 0) {
      pruned.blocks.push({ src_id: block.id, name: block.name, reason: 'NO_DRAWINGS' });
      continue;
    }

    // ── Энэ блок үлдлээ: тоолуур + сануулгын статистик ────────────────
    if (num(block.weight_percent) <= 0) zeroWeightBlocks += 1;
    if (block.team_id === null) blocksWithoutTeam += 1;
    else teamsWithBlocks.add(block.team_id);

    for (const drawing of drawings) {
      const drawingWeight = num(drawing.weight_percent);
      let taskSum = 0;
      for (const cmp of drawing.components) {
        componentCount += 1;
        for (const t of cmp.tasks) {
          taskCount += 1;
          taskSum += num(t.weight_percent);
        }
      }
      if (drawingWeight <= 0) {
        // Жин 0 зураг rollup-д ЮУ Ч нэмэхгүй (`calcProjectProgress`-ийн ELSE 0)
        // — түүний ажлын төсвийг шалгах нь утгагүй тул зөвхөн энэ сануулга.
        zeroWeightDrawings += 1;
        continue;
      }
      // ⚠️ Бүрэлдэхүүний жин rollup-д ОРОЛЦОХГҮЙ — ажлын жин шууд зургийн
      //    төсвөөр хуваагдана (`calcProjectProgress`).
      if (taskSum < drawingWeight - WEIGHT_TOLERANCE) underBudgetDrawings += 1;
      else if (taskSum > drawingWeight + WEIGHT_TOLERANCE) overBudgetDrawings += 1;
    }

    const share = block.team_id === null ? null : (shareByTeam.get(block.team_id) ?? null);
    blocks.push({
      src_id: block.id,
      name: block.name,
      weight_percent: block.weight_percent,
      sort_order: block.sort_order,
      team_id: block.team_id,
      team_code: share ? share.team_code : null,
      responsible_name: block.responsible_name,
      drawings,
    });
  }

  // ── Багийн эзэмшил: сонгогдсон БА үлдсэн блоктой багууд ────────────
  const teamShares: CopyPlan['team_shares'] = [];
  for (const s of srcShares) {
    if (!isSelected(teamSel, s.team_id)) continue; // admin өөрөө салгасан — pruned БИШ
    if (!teamsWithBlocks.has(s.team_id)) {
      pruned.teams.push({ team_id: s.team_id, team_code: s.team_code, reason: 'NO_BLOCKS' });
      continue;
    }
    // ⚠️ share_percent мөн ЯГ ЭХ УТГААРАА — нийлбэрийг 100 болгож «засахгүй».
    teamShares.push({
      team_id: s.team_id,
      team_code: s.team_code,
      team_name: s.team_name,
      share_percent: s.share_percent,
      sort_order: s.sort_order,
    });
  }

  const ceiling = computeCeiling(blocks, teamShares);

  /* ---------------- Сануулгууд (код тус бүр ЗӨВХӨН НЭГ УДАА) -------- */
  const warnings: CopyWarning[] = [];
  if (ceiling < 99.5) warnings.push({ code: 'CEILING_BELOW_100', detail: String(ceiling) });
  if (zeroWeightBlocks > 0) warnings.push({ code: 'ZERO_WEIGHT_BLOCK', count: zeroWeightBlocks });
  if (zeroWeightDrawings > 0) {
    warnings.push({ code: 'ZERO_WEIGHT_DRAWING', count: zeroWeightDrawings });
  }
  if (blocksWithoutTeam > 0) warnings.push({ code: 'BLOCK_WITHOUT_TEAM', count: blocksWithoutTeam });
  if (pruned.teams.length > 0) {
    warnings.push({ code: 'TEAM_WITHOUT_BLOCKS', count: pruned.teams.length });
  }
  if (underBudgetDrawings > 0) {
    warnings.push({ code: 'TASK_WEIGHTS_UNDER_BUDGET', count: underBudgetDrawings });
  }
  if (overBudgetDrawings > 0) {
    warnings.push({ code: 'TASK_WEIGHTS_OVER_BUDGET', count: overBudgetDrawings });
  }

  return {
    team_shares: teamShares,
    blocks,
    counts: {
      teams: teamShares.length,
      blocks: blocks.length,
      drawings: blocks.reduce((acc, b) => acc + b.drawings.length, 0),
      components: componentCount,
      tasks: taskCount,
    },
    pruned,
    ceiling_pct: ceiling,
    warnings,
  };
}

/**
 * ТААЗ = хуулагдсан бүх ажил 100% болбол төсөл хэдэн хувь заах вэ.
 *
 * ⚠️ Энэ бол `routes/progress.ts`-ийн `computeProgressFromMap` (өөрөө нь
 *    `calcProjectProgress` SQL-ийн санах ойн ихэр) функцийн МӨР МӨРӨӨР
 *    хуулбар — зөвхөн `taskPct` бүрийг 100 гэж авсан.  Энэ модуль DB-д
 *    хүрдэггүй, `routes/`-оос импортлохгүй тул арифметикийг нь яг хэвээр
 *    давтав.  Тэр функцийг өөрчилвөл ЭНЭ ХОЁУЛАА хамт өөрчлөгдөнө.
 *
 * Хаалтууд (бүгд санаатай):
 *   • share <= 0 эсвэл блокийн жин <= 0  → блок 0 оруулна,
 *   • зургийн жин <= 0                   → зураг 0 оруулна (SQL-д NULLIF),
 *   • бүрэлдэхүүний жин                  → ОГТ оролцохгүй.
 * Хязгаарлалт (clamp) БАЙХГҮЙ: эх төслийн жин 100-аас хэтэрсэн бол тааз ч
 * мөн 100-аас дээш гарах ёстой — муу жингийн өгөгдөл нуугдаж болохгүй.
 */
function computeCeiling(blocks: PlannedBlock[], teamShares: CopyPlan['team_shares']): number {
  const shareByTeam = new Map<number, number>();
  for (const s of teamShares) shareByTeam.set(s.team_id, num(s.share_percent));

  let projectProgress = 0;
  for (const block of blocks) {
    const share = block.team_id === null ? 0 : (shareByTeam.get(block.team_id) ?? 0);
    const blockWeight = num(block.weight_percent);
    if (share <= 0 || blockWeight <= 0) continue;

    let blockProgress = 0;
    for (const drawing of block.drawings) {
      const drawingWeight = num(drawing.weight_percent);
      if (drawingWeight <= 0) continue;
      let weightedTaskSum = 0;
      for (const component of drawing.components) {
        for (const task of component.tasks) {
          // taskPct = 100 (тааз) → (w × 100) / 100
          weightedTaskSum += (num(task.weight_percent) * 100) / 100;
        }
      }
      const drawProgress = (weightedTaskSum * 100) / drawingWeight;
      blockProgress += (drawingWeight * drawProgress) / 100;
    }
    projectProgress += ((blockWeight * blockProgress) / 100) * (share / 100);
  }
  // 2 орон хүртэл дугуйлна (−0 гарахаас сэргийлж 0 нэмэв).
  return Math.round(projectProgress * 100) / 100 + 0;
}
