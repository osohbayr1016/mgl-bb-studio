/**
 * АНГИЛЛЫН ЗАГВАР ТӨСӨЛ — шинэ төслийн бүтцийг автоматаар бэлдэх.
 *
 * Эзэн 2026-10-06: «Төсөл 75 бол EZ (Эскиз зураг).  Дараа дараагийн удаа
 * эскиз зургийн төсөл үүсгэхэд одоо байгаа төслийн ажлын хуваарилалтыг
 * автоматаар ашигладаг болгоно — 75-ын хуваарилалт, бүтэц нь загвар.»
 *
 * Загвар = ЖИНХЭНЭ төсөл (snapshot БИШ).  `app_settings` дахь ганц мөр
 * `project_template.<АНГИЛАЛ>` = төслийн id.  Шинэ төсөл тэр ангиллаар
 * үүсэхэд (`POST /api/projects`) загвар төслийн ОДООГИЙН модыг хуулна:
 *   багийн хувь → блок → зураг → бүрэлдэхүүн → ажил, ЖИН ЯГ ХЭВЭЭР.
 * Загвар төслийн бүтцийг засвал дараагийн шинэ төсөл шинэ хэлбэрийг авна —
 * эзэн «75-ын бүтэц бол загвар» гэсэн, тусдаа хуулбар хадгалахгүй.
 *
 * Хуулалт нь `POST /:id/copy-structure`-тэй ЯГ НЭГ төлөвлөгч
 * (`structureCopyPlan.ts`) ба бичигч (`structureCopyWrite.ts`)-ээр явна, тиймээс
 * 0254-ийн эзний шийдвэрүүд энд ч хүчинтэй: ГҮЙЦЭТГЭГЧ, ОГНОО, ЯВЦ, ЦАГ,
 * ХУВААРИЛАЛТ (task_allocations) ХЭЗЭЭ Ч хуулагдахгүй, мэдэгдэл ТЭГ.
 *
 * ⚠️ Загвар нь ЗӨВХӨН ӨӨРИЙН ангиллын шинэ төсөлд хэрэглэгдэнэ — дараа нь
 * загвар төслийн ангиллыг сольсон бол (EZ → AZ) тэр мөр чимээгүй хүчингүй
 * (`resolveCategoryTemplate` ангиллыг дахин шалгана).  Зохиогчийн хяналтын
 * бүрхүүл (`asr_only`) төсөл загвар болохгүй.  Архивласан төсөл загвар
 * хэвээр үлдэнэ (дууссан төсөл бол хамгийн сайн загвар).
 */
import { isProjectCategory, type ProjectCategory } from './projectCategories';
import { planStructureCopy, type CopyPlan } from './structureCopyPlan';
import {
  MAX_COPY_TASKS,
  copyRunBatched,
  deleteCreatedBlocksDeep,
  insertPlannedStructure,
  loadCopySourceTree,
} from './structureCopyWrite';

export const CATEGORY_TEMPLATE_PREFIX = 'project_template.';

export function categoryTemplateKey(category: ProjectCategory): string {
  return `${CATEGORY_TEMPLATE_PREFIX}${category}`;
}

/** `app_settings.value` → эерэг бүхэл id, бусад нь null. */
export function parseTemplateProjectId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** `project_template.EZ` → 'EZ'; танигдахгүй түлхүүр → null. */
export function categoryOfTemplateKey(key: string): ProjectCategory | null {
  if (!key.startsWith(CATEGORY_TEMPLATE_PREFIX)) return null;
  const cat = key.slice(CATEGORY_TEMPLATE_PREFIX.length);
  return isProjectCategory(cat) ? cat : null;
}

export interface TemplateCounts {
  teams: number;
  blocks: number;
  drawings: number;
  components: number;
  tasks: number;
}

export interface CategoryTemplateInfo {
  category: ProjectCategory;
  project_id: number;
  name: string;
  status: string;
  counts: TemplateCounts;
  /** Загвар төслийн багийн хувь (UI-д «EZ 100%» гэж харуулна). */
  team_shares: { team_code: string; share_percent: number }[];
}

interface TemplateProjectRow {
  id: number;
  name: string;
  category: string | null;
  status: string;
  asr_only: number | null;
}

/** Мөрийг ЗАГВАР болох эсэх: байгаа, ангилал таарсан, ЗХ бүрхүүл биш. */
function isUsableTemplate(row: TemplateProjectRow | null | undefined, category: ProjectCategory) {
  return !!row && row.category === category && (row.asr_only ?? 0) === 0;
}

/**
 * Ангиллын загвар төслийг шийднэ.  Тохируулаагүй, төсөл устсан, ангилал нь
 * өөрчлөгдсөн, ЗХ бүрхүүл бол null — тэр үед шинэ төсөл ангиллын өгөгдмөл
 * багийн хувиар л (хуучин зан төлөв) үүснэ.
 */
export async function resolveCategoryTemplate(
  db: D1Database,
  category: ProjectCategory,
): Promise<{ project_id: number; name: string } | null> {
  const setting = await db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(categoryTemplateKey(category))
    .first<{ value: string }>();
  const id = parseTemplateProjectId(setting?.value);
  if (id === null) return null;
  const row = await db
    .prepare('SELECT id, name, category, status, asr_only FROM projects WHERE id = ?')
    .bind(id)
    .first<TemplateProjectRow>();
  if (!row || !isUsableTemplate(row, category)) return null;
  return { project_id: row.id, name: row.name };
}

/** Тохируулсан БҮХ ангиллын загвар (хүчинтэйг нь л) — тоо, багийн хувьтай. */
export async function loadCategoryTemplates(db: D1Database): Promise<CategoryTemplateInfo[]> {
  const settings = await db
    .prepare('SELECT key, value FROM app_settings WHERE key LIKE ?')
    .bind(`${CATEGORY_TEMPLATE_PREFIX}%`)
    .all<{ key: string; value: string }>();
  const wanted: Array<{ category: ProjectCategory; id: number }> = [];
  for (const r of settings.results ?? []) {
    const category = categoryOfTemplateKey(r.key);
    const id = parseTemplateProjectId(r.value);
    if (category && id !== null) wanted.push({ category, id });
  }
  if (wanted.length === 0) return [];

  const ids = Array.from(new Set(wanted.map((w) => w.id)));
  const ph = ids.map(() => '?').join(',');
  const [projRes, sharesRes] = await Promise.all([
    db
      .prepare(
        `SELECT p.id, p.name, p.category, p.status, p.asr_only,
           (SELECT COUNT(*) FROM project_team_shares s WHERE s.project_id = p.id) AS teams,
           (SELECT COUNT(*) FROM blocks b WHERE b.project_id = p.id) AS blocks,
           (SELECT COUNT(*) FROM drawings d INNER JOIN blocks b ON b.id = d.block_id
             WHERE b.project_id = p.id) AS drawings,
           (SELECT COUNT(*) FROM components co
             INNER JOIN drawings d ON d.id = co.drawing_id
             INNER JOIN blocks b ON b.id = d.block_id
             WHERE b.project_id = p.id) AS components,
           (SELECT COUNT(*) FROM tasks t
             INNER JOIN components co ON co.id = t.component_id
             INNER JOIN drawings d ON d.id = co.drawing_id
             INNER JOIN blocks b ON b.id = d.block_id
             WHERE b.project_id = p.id) AS tasks
         FROM projects p WHERE p.id IN (${ph})`,
      )
      .bind(...ids)
      .all<TemplateProjectRow & TemplateCounts>(),
    db
      .prepare(
        `SELECT pts.project_id, t.code AS team_code, pts.share_percent
         FROM project_team_shares pts
         INNER JOIN teams t ON t.id = pts.team_id
         WHERE pts.project_id IN (${ph})
         ORDER BY pts.sort_order, pts.id`,
      )
      .bind(...ids)
      .all<{ project_id: number; team_code: string; share_percent: number }>(),
  ]);
  const byId = new Map((projRes.results ?? []).map((r) => [r.id, r]));
  const out: CategoryTemplateInfo[] = [];
  for (const w of wanted) {
    const row = byId.get(w.id);
    if (!row || !isUsableTemplate(row, w.category)) continue;
    out.push({
      category: w.category,
      project_id: row.id,
      name: row.name,
      status: row.status,
      counts: {
        teams: Number(row.teams) || 0,
        blocks: Number(row.blocks) || 0,
        drawings: Number(row.drawings) || 0,
        components: Number(row.components) || 0,
        tasks: Number(row.tasks) || 0,
      },
      team_shares: (sharesRes.results ?? [])
        .filter((s) => s.project_id === row.id)
        .map((s) => ({ team_code: s.team_code, share_percent: Number(s.share_percent) || 0 })),
    });
  }
  out.sort((a, b) => a.category.localeCompare(b.category));
  return out;
}

/** Загвар болгохоор сонгосон төслийн модыг шалгах (хоосон / хэт том бол). */
export async function planTemplateCopy(db: D1Database, projectId: number): Promise<CopyPlan> {
  return planStructureCopy(await loadCopySourceTree(db, projectId), {});
}

export type TemplateApplyResult =
  | {
      applied: true;
      source_project_id: number;
      source_name: string;
      counts: CopyPlan['counts'];
      ceiling_pct: number;
      /** Загвар багийн хувьтай байсан эсэх — false бол дуудагч ангиллын
       *  өгөгдмөл ростерыг суулгана. */
      team_shares_written: boolean;
    }
  | {
      applied: false;
      source_project_id: number;
      source_name: string;
      reason: 'EMPTY' | 'TOO_LARGE' | 'FAILED';
    };

/**
 * Загвар төслийн модыг ШИНЭ (хоосон) төсөлд хуулна.
 *
 * ⚠️ Зорилтот төсөл нь ДӨНГӨЖ үүссэн, бүтэцгүй гэж үзнэ — `POST /api/projects`
 * л дуудна.  Бэлэн бүтэцтэй төсөлд хэрэглэх бол `copy-structure`-ийн
 * HAS_PROGRESS / ROOT_PROTECTED / confirm_replace хаалтууд хэрэгтэй.
 *
 * Унавал ЭНЭ дуудлагын бичсэн БҮХ мөрийг (багийн хувь + блокоос доош) буцааж
 * устгаад `applied: false` буцаана — төсөл өөрөө амжилттай үлдэнэ, admin
 * тохиргооны хуудаснаас «Бүтэц татах»-аар дахин оролдоно.
 */
export async function applyCategoryTemplate(
  db: D1Database,
  targetId: number,
  template: { project_id: number; name: string },
): Promise<TemplateApplyResult> {
  const base = { source_project_id: template.project_id, source_name: template.name };
  const createdBlockIds: number[] = [];
  let sharesWritten = false;
  try {
    const plan = await planTemplateCopy(db, template.project_id);
    if (plan.blocks.length === 0) return { ...base, applied: false, reason: 'EMPTY' };
    if (plan.counts.tasks > MAX_COPY_TASKS) return { ...base, applied: false, reason: 'TOO_LARGE' };

    /* Багийн хувь БЛОКООС ӨМНӨ (`insertPlannedStructure`-ийн тайлбарыг үз).
     * Загвар ростергүй бол хөндөхгүй — дуудагч ангиллын өгөгдмөлийг суулгана. */
    if (plan.team_shares.length > 0) {
      sharesWritten = true;
      const shareStmt = db.prepare(
        'INSERT INTO project_team_shares (project_id, team_id, share_percent, sort_order) VALUES (?, ?, ?, ?)',
      );
      await copyRunBatched(
        db,
        plan.team_shares.map((ts) =>
          shareStmt.bind(targetId, ts.team_id, ts.share_percent, ts.sort_order),
        ),
      );
    }
    await insertPlannedStructure(db, targetId, plan, createdBlockIds);
    return {
      ...base,
      applied: true,
      counts: plan.counts,
      ceiling_pct: plan.ceiling_pct,
      team_shares_written: sharesWritten,
    };
  } catch (err) {
    console.error(`category template ${template.project_id} → project ${targetId} failed:`, err);
    try {
      await deleteCreatedBlocksDeep(db, createdBlockIds);
      if (sharesWritten) {
        await db.prepare('DELETE FROM project_team_shares WHERE project_id = ?').bind(targetId).run();
      }
    } catch (cleanupErr) {
      console.error(`category template cleanup failed for project ${targetId}:`, cleanupErr);
    }
    return { ...base, applied: false, reason: 'FAILED' };
  }
}
