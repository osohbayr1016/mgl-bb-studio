import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { isAdminRole } from '../types';
import { requireRole, requireAdmin } from '../middleware/auth';
import { PROJECT_LIST_SQL } from './projects';
import { NOT_ASR_ONLY_SQL } from '../lib/asrEligible';
import { computeRisk, isIsoDate, riskRank, type RiskState } from '../lib/projectRisk';
import { applyScheduleToTimelineRows, parseTimelineJson } from '../lib/passportTimeline';
import {
  extensionRequiredBody,
  isLaterThan,
  recordDeadlineCorrection,
  NOTE_MAX as DEADLINE_NOTE_MAX,
} from '../lib/deadlineExtensions';
import { notifyProjectResponsible } from '../lib/notify';
import { todayInUB } from '../lib/time';
import { projectLastActivitySql } from '../lib/progressLatest';

/* ============================================================
 *  «Төслийн хуваарь» (portfolio Gantt) — /app/timeline
 * ============================================================
 *  Нэг МӨР = нэг ТӨСӨЛ (таск БИШ) огнооны тэнхлэг дээр.  Хажуугаар нь
 *  «аль ажлыг хийх ёстой вэ» гэдгийг эрэмбэлэх эрсдэлийн хөдөлгүүр явна.
 *
 *  Эрсдэлийн төлөв нь ШИНЭ багана биш — паспортын start_date / finish_date,
 *  нэгтгэсэн явц, сүүлийн батлагдсан хөдөлгөөнөөс УРГУУЛЖ бодогдоно
 *  (lib/projectRisk.ts).  Тиймээс энд «pending» гэх мэт lifecycle багана
 *  байхгүй: finish_date байхгүй бол 'unscheduled', start_date ирээдүйд бол
 *  'not_started'.
 *
 *  ХАНДАЛТ (2026-08-13-нд өөрчлөгдсөн — «Хугацаа» хуудас устаж, эцсийн
 *  хугацааны ЦОРЫН ГАНЦ гадаргуу энэ хуудас болсон):
 *
 *    УНШИХ  — admin · senior · engineer · architect.  Ажилтан өөрийн
 *             ажлын хуваарь, эцсийн хугацааг хаанаас ч харахгүй болохоос
 *             сэргийлж хуудсыг нээв.  `client` нь өөрийн shell-тэй тул
 *             ЗОРИУДААР ороогүй; `worker` нь `lib/workerScope.ts`-ийн
 *             allowlist-д `timeline` байхгүй тул API түвшинд 403 авна.
 *    БИЧИХ  — ЗӨВХӨН admin (доорх гурван route дээрх `requireAdmin()`).
 *             Өмнө нь `requireManager()` байсан буюу senior ч хуваарь
 *             тавьж, сануулга илгээж чаддаг байв.
 *
 *  ⚠️ Уншигчийн хүрээ өргөссөн тул `is_pending` (гэрээ хэлэлцээрийн шат)
 *     ЗААВАЛ шүүгдэнэ — `loadTimelineProjects`-ийн `seesPending` аргументыг
 *     үз.  Тэр нь `routes/projects.ts`-ийн жагсаалттай ИЖИЛ дүрэм; эс
 *     бөгөөс энэ хуудас түүний нөхөж чадахгүй нүх болно.
 *
 *  CEO нь id 2, role `admin` тул бүх зүйлд дамжин орно (lib/ceo.ts-ийг үз).
 */
const timeline = new Hono<{ Bindings: Env; Variables: AppVariables }>();

timeline.use('*', requireRole('admin', 'senior', 'engineer', 'architect'));

/* ------------------------------------------------------------------ */
/*  Гаралтын хэлбэр (frontend/src/features/timeline/types.ts-ийн ихэр)  */
/* ------------------------------------------------------------------ */

export interface TimelineLead {
  id: number;
  full_name: string;
}

export interface TimelineProject {
  id: number;
  name: string;
  display_title: string | null;
  category: string | null;
  status: 'active' | 'completed' | 'archived';
  is_asap: number;
  /** Гэрээ хэлэлцээрийн шатанд — Timeline дээр шараар тодорно. */
  is_pending: number;
  progress: number;
  manual_progress: number | null;
  has_breakdown: boolean;
  start_date: string | null;
  finish_date: string | null;
  last_activity_at: string | null;
  /* ── Төслийн ЖАГСААЛТ хуудастай ижил мэдээлэл (2026-08-13) ────────────
   * Хуваарийн мөр дээр «энэ ямар төсөл вэ» гэдгийг хэлэхийн тулд
   * `PROJECT_LIST_SQL` аль хэдийн буцаадаг баганууд.  Шинэ асуулга
   * НЭМЭЭГҮЙ — зөвхөн урьд нь хаядаг байсан талбаруудыг уншив. */
  description: string | null;
  created_at: string | null;
  member_count: number;
  /** ЗӨВХӨН admin-д дүүрнэ (бусдад `null`).  Энэ нь дотоод гүйцэтгэлийн
   *  жин тул senior/инженер рүү задрах ёсгүй — `ProjectsPage`-ийн
   *  `isAdminTier` шүүлттэй ЯГ ИЖИЛ хил. */
  complexity_pct: number | null;
  // ⚠️ Баг (`teams`) ба гишүүдийн тоо (`member_count`) энд ЗОРИУДААР
  // БАЙХГҮЙ.  Хуваарийн хуудас нэг л өнгөний хэлээр ярина — ЭРСДЭЛ.  Баг
  // бүрийн өөрийн өнгө (shared/lib/team-colors.ts) нь эрсдэлийн chip-тэй
  // зэрэгцэн хоёр дахь өнгөний хэл үүсгэж «улаан баар = ямар утгатай вэ?»
  // гэдгийг ойлгомжгүй болгож байсан.  Хариуцагч хүн (`leads`) л үлдэнэ —
  // сануулга тэр рүү очдог тул тэр нь баг биш, ХҮН.
  leads: TimelineLead[];
  risk_state: RiskState;
  days_left: number | null;
  stale_days: number | null;
  days_to_start: number | null;
  /** Хугацаа хэдэн удаа сунгагдсан (migration 0337).  0 = сунгаагүй. */
  extension_count: number;
  /** Анхны дуусах хугацаа — зөвхөн сунгагдсан төсөлд (эхний сунгалтын
   *  `from_date`); сунгаагүй бол null (= `finish_date` өөрөө). */
  original_finish_date: string | null;
}

/* ------------------------------------------------------------------ */
/*  Дотоод мөрийн төрлүүд                                              */
/* ------------------------------------------------------------------ */

/** PROJECT_LIST_SQL-ийн SELECT-ээс бидэнд хэрэгтэй дэд олонлог.
 *  `complexity_pct` нь дотоод гүйцэтгэлийн жин — уншигчийн хүрээ
 *  инженер/архитектор хүртэл өргөссөн тул мөрөөс УНШИГДАХ ч гарцад
 *  ЗӨВХӨН admin-д (`showComplexity`) л гарна. */
type ListRow = {
  id: number;
  name: string;
  description: string | null;
  status: string | null;
  category: string | null;
  is_asap: number | null;
  is_pending: number | null;
  progress: number | null;
  complexity_pct: number | null;
  member_count: number | null;
  created_at: string | null;
  start_date: string | null;
  finish_date: string | null;
};

type MetaRow = {
  id: number;
  display_title: string | null;
  manual_progress: number | null;
  has_breakdown: number;
};

type ActivityRow = {
  project_id: number;
  last_activity_at: string | null;
};

type ExtensionRow = {
  project_id: number;
  n: number;
  original_finish_date: string | null;
};

/** Багийн хуваарилалтаар дамжсан ХАРИУЦАГЧИЙН мөр.  Баг өөрөө гарцад
 *  гардаггүй — `project_team_shares` нь зөвхөн «хэн хариуцах вэ» гэдгийг
 *  олох зам болж үлдэнэ. */
type TeamLeadRow = {
  project_id: number;
  lead_id: number | null;
  lead_name: string | null;
};

type SeniorRow = {
  project_id: number;
  user_id: number;
  full_name: string;
};

/** Паспортын огооны багана нь баталгаажаагүй чөлөөт текст — production-д
 *  '-' гэх мэт утга бодитоор байдаг.  ISO биш бүхнийг NULL болгож
 *  цэвэрлэнэ (эрсдэлийн хөдөлгүүр ч, frontend-ийн тэнхлэг ч ижил ханддаг). */
function isoOrNull(v: string | null): string | null {
  return isIsoDate(v) ? v : null;
}

function clampPercent(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * Хуваарийн бүх мөрийг угсарна — эрсдэлээр эрэмбэлсэн.
 *
 * Route болон өдөр тутмын сануулгын sweep (lib/deadlineSweep.ts) ХОЁУЛАА
 * үүнийг дуудна: эрсдэлийн логик нэг дор, хоёр газарт хуулагдахгүй.
 * `viewerId` нь зөвхөн PROJECT_LIST_SQL-ийн `is_member` / `is_team_assigned`
 * тэмдэглэгээнд хэрэгтэй (бид уншдаггүй) — cron-оос 0 дамжуулна.
 *
 * @param seesPending     Гэрээ хэлэлцээрийн шатны төслүүдийг ҮЗҮҮЛЭХ эсэх.
 *   `routes/projects.ts`-ийн жагсаалттай ИЖИЛ дүрэм: зөвхөн admin + senior.
 *   Анхдагч `true` — sweep (cron) нь бүх төслийн хугацааг мэдэх ёстой тул
 *   өөрчлөгдөхгүй.
 * @param showComplexity  `complexity_pct`-ыг гарцад оруулах эсэх (ЗӨВХӨН
 *   admin).  Анхдагч `false` — шинэ дуудагч санамсаргүйгээр задруулахгүй.
 */
export async function loadTimelineProjects(
  db: D1Database,
  viewerId: number,
  todayIso: string,
  seesPending = true,
  showComplexity = false,
): Promise<TimelineProject[]> {
  // Дөрвөн бие даасан асуулгыг зэрэг явуулж JS дээр нэгтгэнэ.  Аварга нэг
  // CTE бичихээс зориуд татгалзав: PROJECT_LIST_SQL нь аль хэдийн таван
  // түвшний жинлэсэн rollup-ыг хийж байгаа бөгөөд түүнийг ХЭВЭЭР нь дахин
  // ашиглах нь хуудас хоорондын явцын зөрүүг бүрмөсөн үгүй хийнэ.
  const [listRes, metaRes, activityRes, teamRes, seniorRes, extRes] = await Promise.all([
    // (a) Таван түвшний жинлэсэн явц + паспортын огноо.
    //     Staff хувилбар (forUser=false) нь `user.sub`-ыг ЯГ 3 удаа
    //     bind хийнэ — routes/projects.ts:334-342-ыг үз.
    db
      .prepare(PROJECT_LIST_SQL(false, seesPending))
      .bind(viewerId, viewerId, viewerId)
      .all<ListRow>(),
    // (b) Гарчиг, гар явц, задаргаа байгаа эсэх.
    db
      .prepare(
        `SELECT p.id,
                p.display_title,
                p.manual_progress,
                CASE WHEN EXISTS (SELECT 1 FROM blocks b WHERE b.project_id = p.id)
                     THEN 1 ELSE 0 END AS has_breakdown
           FROM projects p
          WHERE ${NOT_ASR_ONLY_SQL}`,
      )
      .all<MetaRow>(),
    // (c) Сүүлийн батлагдсан явцын бүртгэл (stale тооцоолол).
    db
      .prepare(
        // 2026-09-11: 48 223 → 9 890 мөр (lib/progressLatest.ts).
        projectLastActivitySql(true),
      )
      .all<ActivityRow>(),
    // (d) Хариуцагч (багийн батлах ахлагч).  Ахлагч нь active `senior` байх
    //     ёстой — lib/notify.ts-ийн шатлалтай ижил.  Багийн код/нэр/хувийг
    //     УНШИХАА БОЛИВ (хуудас баг харуулахаа больсон), гэхдээ `teams`
    //     JOIN нь `lead_user_id`-д хүрэх ганц зам тул хэвээр.  ORDER BY ч
    //     хэвээр — хариуцагчдын дараалал тогтвортой байх ёстой.
    db
      .prepare(
        `SELECT pts.project_id            AS project_id,
                lead.id                   AS lead_id,
                lead.full_name            AS lead_name
           FROM project_team_shares pts
           JOIN teams tm  ON tm.id = pts.team_id
           LEFT JOIN users lead ON lead.id = tm.lead_user_id
                               AND lead.status = 'active'
                               AND lead.role = 'senior'
          ORDER BY pts.project_id, pts.sort_order, tm.code`,
      )
      .all<TeamLeadRow>(),
    // (e) Ахлагчгүй төслийн нөөц хариуцагч — тухайн багуудын active senior
    //     гишүүд.  Зөвхөн нэг ч ахлагч олдоогүй үед хэрэглэнэ.
    db
      .prepare(
        `SELECT DISTINCT pts.project_id AS project_id,
                u.id                    AS user_id,
                u.full_name             AS full_name
           FROM project_team_shares pts
           JOIN user_teams ut ON ut.team_id = pts.team_id
           JOIN users u       ON u.id = ut.user_id
                             AND u.status = 'active'
                             AND u.role = 'senior'`,
      )
      .all<SeniorRow>(),
    // (f) Хугацааны сунгалтын тоо + анхны хугацаа (migration 0337) — мөр
    //     дээр «сунгасан ×N» тэмдэг, самбарт анхны огноо харуулна.
    db
      .prepare(
        `SELECT c.project_id,
                COUNT(*) AS n,
                (SELECT f.from_date FROM project_deadline_changes f
                  WHERE f.project_id = c.project_id AND f.kind = 'extension'
                  ORDER BY f.id LIMIT 1) AS original_finish_date
           FROM project_deadline_changes c
          WHERE c.kind = 'extension'
          GROUP BY c.project_id`,
      )
      .all<ExtensionRow>(),
  ]);

  const extById = new Map<number, ExtensionRow>();
  for (const e of extRes.results ?? []) extById.set(e.project_id, e);

  const metaById = new Map<number, MetaRow>();
  for (const m of metaRes.results ?? []) metaById.set(m.id, m);

  const activityById = new Map<number, string | null>();
  for (const a of activityRes.results ?? []) activityById.set(a.project_id, a.last_activity_at);

  const leadsById = new Map<number, TimelineLead[]>();
  for (const row of teamRes.results ?? []) {
    if (row.lead_id != null) {
      const leads = leadsById.get(row.project_id) ?? [];
      // Нэг хүн хэд хэдэн багийн ахлагч байж болно — id-гаар давхардлыг арилгана.
      if (!leads.some((l) => l.id === row.lead_id)) {
        leads.push({ id: row.lead_id, full_name: row.lead_name ?? '' });
      }
      leadsById.set(row.project_id, leads);
    }
  }

  const fallbackLeadsById = new Map<number, TimelineLead[]>();
  for (const row of seniorRes.results ?? []) {
    const list = fallbackLeadsById.get(row.project_id) ?? [];
    if (!list.some((l) => l.id === row.user_id)) {
      list.push({ id: row.user_id, full_name: row.full_name });
    }
    fallbackLeadsById.set(row.project_id, list);
  }

  const projects: TimelineProject[] = (listRes.results ?? []).map((row) => {
    const meta = metaById.get(row.id);
    const manual = meta?.manual_progress ?? null;
    // Гар явц БАЙВАЛ ДАВАМГАЙЛНА — задаргаагүй жижиг засварын ажил эс
    // бөгөөс мөнхөд 0% харагдана (migration 0141-ийг үз).  PROJECT_LIST_SQL
    // өөрөө аль хэдийн COALESCE хийдэг тул энэ нь давхар хамгаалалт: хоёул
    // ижил утга өгнө.
    //
    // Тооцоолсон явцыг 100-д ТАГЛАХГҮЙ: жингийн нийлбэр 100-аас давсан төсөл
    // 100-аас их хувь өгөх нь зөв бөгөөд ил байх ёстой.  Тагласан тохиолдолд
    // Timeline ба төслийн карт өөр тоо хэвлэх байсан.  Гараар оруулсан явц нь
    // админы оролт тул хэвээр таглагдана (бичих зам дээр ч мөн адил).
    const computed = Number(row.progress ?? 0);
    const progress =
      manual != null
        ? clampPercent(Number(manual))
        : Number.isFinite(computed)
          ? Math.max(0, computed)
          : 0;
    const start_date = isoOrNull(row.start_date);
    const finish_date = isoOrNull(row.finish_date);
    const last_activity_at = activityById.get(row.id) ?? null;
    const status: TimelineProject['status'] =
      row.status === 'completed' || row.status === 'archived' ? row.status : 'active';

    const risk = computeRisk(
      { start_date, finish_date, progress, status, last_activity_at },
      todayIso,
    );

    return {
      id: row.id,
      name: row.name,
      display_title: meta?.display_title ?? null,
      category: row.category,
      status,
      is_asap: row.is_asap ? 1 : 0,
      is_pending: row.is_pending ? 1 : 0,
      progress,
      manual_progress: manual != null ? clampPercent(Number(manual)) : null,
      has_breakdown: (meta?.has_breakdown ?? 0) === 1,
      start_date,
      finish_date,
      last_activity_at,
      description: row.description,
      created_at: row.created_at,
      member_count: Number(row.member_count) || 0,
      // Гарцад ЗӨВХӨН admin үед л орно — доод дүрүүд `null` авна.
      complexity_pct:
        showComplexity && row.complexity_pct != null ? Number(row.complexity_pct) : null,
      leads: leadsById.get(row.id) ?? fallbackLeadsById.get(row.id) ?? [],
      risk_state: risk.state,
      days_left: risk.days_left,
      stale_days: risk.stale_days,
      days_to_start: risk.days_to_start,
      extension_count: Number(extById.get(row.id)?.n ?? 0) || 0,
      original_finish_date: isoOrNull(extById.get(row.id)?.original_finish_date ?? null),
    };
  });

  // Эрэмбэ: эрсдэл (хамгийн яаралтай нь эхэнд) → ASAP → дуусах огноо.
  // Огноогүй нь эцэст (эрсдэлийн эрэмбэ аль хэдийн тэднийг тусгаарладаг ч
  // ижил төлөвтэй мөрүүдийн дотор тогтвортой байлгана).
  projects.sort((a, b) => {
    const byRisk = riskRank(a.risk_state) - riskRank(b.risk_state);
    if (byRisk !== 0) return byRisk;
    if (a.is_asap !== b.is_asap) return b.is_asap - a.is_asap;
    if (a.finish_date && b.finish_date) return a.finish_date < b.finish_date ? -1 : a.finish_date > b.finish_date ? 1 : 0;
    if (a.finish_date) return -1;
    if (b.finish_date) return 1;
    return a.id - b.id;
  });

  return projects;
}

/* ------------------------------------------------------------------ */
/*  GET /api/timeline                                                  */
/* ------------------------------------------------------------------ */

// ⚠️ ЗОРИУДААР `withEdgeCache`-гүй: огноо/гар явц зассан ДАРУЙД мөр шинэ
// байрлалдаа үсрэх ёстой.  `projects:list` кэш нь bust хийгддэггүй (30 сек
// TTL дээр тулгуурладаг) тул түүнтэй ижил зан чанар энд ойлгомжгүй байдал
// («хадгалсан ч хуучин огноо харагдана») үүсгэнэ.
timeline.get('/', async (c) => {
  const user = c.get('user');
  const today = todayInUB();
  const isAdmin = isAdminRole(user.role);
  // Гэрээ хэлэлцээрийн шатны САНУУЛГА төслүүд нь бодит ажил БИШ — зөвхөн
  // admin + senior төлөвлөлтдөө хардаг.  `routes/projects.ts:354`-тэй ЯГ
  // ИЖИЛ мөр; хоёр газар зөрвөл энэ хуудас тэр шүүлтийн нүх болно.
  const seesPending = isAdmin || user.role === 'senior';
  const projects = await loadTimelineProjects(c.env.DB, user.sub, today, seesPending, isAdmin);
  // `can_edit` нь UI-д товч харуулах эсэхийг шийднэ — дүрийн шалгалтыг
  // frontend дахин бичихгүйн тулд сервер тал өөрөө хэлнэ (бичих замууд
  // өөрсдөө `requireAdmin()`-ээр хаалттай хэвээр).
  return c.json({ today, can_edit: isAdmin, projects });
});

/* ------------------------------------------------------------------ */
/*  PUT /api/timeline/projects/:id/schedule                            */
/* ------------------------------------------------------------------ */

interface SchedulePayload {
  start_date?: string | null;
  finish_date?: string | null;
  /** Дуусах огноог ХОЙШЛУУЛАХ нь өгөгдмөлөөр 409 `EXTENSION_REQUIRED` —
   *  сунгалт бол `/api/deadlines/project/:id/extensions` (батлагчтай).
   *  `'correction'` = буруу бичсэн огноог залруулж байна: зөвшөөрч,
   *  түүхэнд `correction` мөр бичнэ (migration 0337). */
  change_kind?: 'correction';
  /** Засварын тайлбар (сонголттой) — түүхийн мөрөнд үлдэнэ. */
  note?: string;
}

/** `undefined` = хөндөхгүй, `null` = цэвэрлэх, ISO мөр = тавих.
 *  Формат буруу бол `{ error: true }` буцаана. */
function readDateField(
  raw: string | null | undefined,
): { error: true } | { error: false; touched: boolean; value: string | null } {
  if (raw === undefined) return { error: false, touched: false, value: null };
  if (raw === null) return { error: false, touched: true, value: null };
  const s = String(raw).trim();
  if (s.length === 0) return { error: false, touched: true, value: null };
  if (!isIsoDate(s)) return { error: true };
  return { error: false, touched: true, value: s };
}

// ⚠️ `requireManager()` БИШ `requireAdmin()` (2026-08-13).  Хуудсыг бүх
// ажилтанд нээхэд хамт тавьсан хил: хуваарь тавих, гар явц бичих, сануулга
// илгээх гурав нь удирдлагын үйлдэл тул зөвхөн admin.
timeline.put('/projects/:id/schedule', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Төслийн дугаар буруу' }, 400);
  const user = c.get('user');
  const body = await c.req.json<SchedulePayload>().catch(() => ({}) as SchedulePayload);

  const start = readDateField(body.start_date);
  const finish = readDateField(body.finish_date);
  if (start.error || finish.error) return c.json({ error: 'Огноо буруу форматтай' }, 400);

  const exists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'Төсөл олдсонгүй' }, 404);

  // Хөндөөгүй талыг одоогийн паспортоос авна — «зөвхөн дуусах огноог
  // өөрчлөх» үед ч эхлэл/төгсгөлийн дараалал шалгагдана.  1.3 хүснэгтийг
  // хамт уншина: доор түүнийг ч зэрэг шинэчилнэ (lib/passportTimeline.ts).
  const current = await c.env.DB.prepare(
    'SELECT start_date, finish_date, extension_date, timeline_json FROM project_passport WHERE project_id = ?',
  )
    .bind(id)
    .first<{
      start_date: string | null;
      finish_date: string | null;
      extension_date: string | null;
      timeline_json: string | null;
    }>();

  // ⚠️ Хөндөөгүй талыг ТҮҮХИЙ чигээр нь буцааж бичнэ.  Паспортын огноо нь
  // баталгаажаагүй чөлөөт текст (продакшнд '-' ба '2026.07.09' хоёул
  // байдаг) тул `isoOrNull`-аар цэвэрлэвэл «зөвхөн дуусах огноог өөрчлөх»
  // дуудлага эхлэх огноог чимээгүй устгана — 1.3 хүснэгтийн мөр ч хамт
  // хоосорно.  Цэвэрлэгээ нь ЗӨВХӨН дарааллын шалгалтад л хэрэгтэй.
  const nextStart = start.touched ? start.value : (current?.start_date ?? null);
  const nextFinish = finish.touched ? finish.value : (current?.finish_date ?? null);

  const cmpStart = isoOrNull(nextStart);
  const cmpFinish = isoOrNull(nextFinish);
  if (cmpStart && cmpFinish && cmpFinish < cmpStart) {
    return c.json({ error: 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй' }, 400);
  }

  /* ⚠️ ХОЙШЛУУЛАХ = СУНГАЛТ (migration 0337).  Тогтоосон хугацааг хойш нь
   * зөөх нь батлагч + шалтгаантай түүхийн мөр шаарддаг тул энэ зам түүнийг
   * ХААНА; зөвхөн «Засвар» гэж ил тэмдэглэсэн (буруу бичсэн огноо) үед
   * зөвшөөрч, `correction` гэж бүртгэнэ.  Урагшлуулах, хоослох, анх тогтоох
   * нь сунгалт биш — хэвийн замаараа явж, мөн correction гэж үлдэнэ. */
  const isCorrection = body.change_kind === 'correction';
  if (finish.touched && !isCorrection && isLaterThan(finish.value, current?.finish_date)) {
    return c.json(extensionRequiredBody(current?.finish_date), 409);
  }

  /* ⚠️ БАГАНА ба 1.3 ХҮСНЭГТ хоёрыг ХАМТ бичнэ (2026-09-03).
   *
   * Урьд нь энэ route зөвхөн `start_date` / `finish_date` БАГАНА-г бичдэг
   * байсан.  Гүйцэтгэлийн тайлангийн §1 (`introAuto.ts`) нь `timeline_json`
   * хүснэгтийг ЭХЭЛЖ уншдаг тул 1.3-аа нэг удаа бөглөсөн төсөл дээр эндээс
   * тавьсан огноо тайланд ХАРАГДАХГҮЙ, харин захиалагчийн PDF (багана
   * уншдаг) ХАРУУЛДАГ байв — нэг төсөл хоёр өөр хугацаа хэвлэдэг.
   * Frontend-ийн `mergeTimelineWithLegacy` нь зөвхөн хүн «Мэдээлэл» табыг
   * нээж ХАДГАЛСАН үед л нөхдөг тул засвар биш байлаа.
   *
   * Мөрүүд нь байран дээрээ засагдана (шошго, нэмэлт сунгалтын мөрүүд
   * хэвээр).  Хүснэгт огт байхгүй бол `defaultTimelineRows()`-ийн гурван
   * мөр үүснэ — id, шошго нь `passportSections.ts`-тэй ЯГ ижил. */
  /* ⚠️ Гурав дахь аргумент (ҮР) нь хүснэгт ШИНЭЭР үүсэх үед л уншигдана.
   * Продакшны 15 паспорт БҮГД `timeline_json IS NULL` тул энд үүсэх нь
   * ЖИРИЙН зам, ховор тохиолдол БИШ.  `extension_date`-ыг өгөхгүй бол
   * шинэ 1.3 хүснэгт «Сунгалт»-ыг хоосон гэж зарлаж, багана дээр байгаа
   * сунгалтын огноог тайлан/PDF-ээс алга болгоно (дараа нь паспорт
   * хадгалахад багана нь ч устана).  Хөндөөгүй эхлэх/дуусах талыг мөн
   * баганаас нь авч, шинэ хүснэгт хоосон төрөхөөс сэргийлнэ. */
  const nextRows = applyScheduleToTimelineRows(
    parseTimelineJson(current?.timeline_json),
    {
      start_date: start.touched ? start.value : undefined,
      finish_date: finish.touched ? finish.value : undefined,
    },
    {
      start_date: current?.start_date ?? null,
      finish_date: current?.finish_date ?? null,
      extension_date: current?.extension_date ?? null,
    },
  );
  // Хоосон үр дүн = «үүсгэх зүйл алга» (хоёр огноо хоёул хоосон, хүснэгт
  // урьд ч байгаагүй).  Тийм үед баганыг ТҮҮХИЙ чигээр нь буцааж бичнэ —
  // задалж чадаагүй хуучин JSON байсан ч алдагдахгүй.
  const nextTimelineJson =
    nextRows.length > 0 ? JSON.stringify(nextRows) : (current?.timeline_json ?? null);

  // ЗӨВХӨН start_date / finish_date / timeline_json / updated_at-д хүрнэ:
  // паспортын үлдсэн талбарууд (гарчиг, захирал, тэмдэглэл…) өөр хуудсаар
  // засагддаг тул энд дарж бичих ёсгүй.  `updated_by_id` нь зөвхөн МӨР
  // ШИНЭЭР үүсэхэд бичигдэнэ (DO UPDATE-д ороогүй).
  await c.env.DB.prepare(
    `INSERT INTO project_passport (project_id, start_date, finish_date, timeline_json, updated_at, updated_by_id)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(project_id) DO UPDATE SET
       start_date    = excluded.start_date,
       finish_date   = excluded.finish_date,
       timeline_json = excluded.timeline_json,
       updated_at    = datetime('now')`,
  )
    .bind(id, nextStart, nextFinish, nextTimelineJson, user.sub)
    .run();

  // Хуваарь дахин тавигдсан тул илгээгдсэн сануулгын бүртгэлийг цэвэрлэнэ —
  // шинэ огноон дээр 7/3/1 хоногийн сануулга дахин ажиллах эрхтэй болно
  // (lib/deadlineSweep.ts нь project_reminders-ээр давхардлыг шүүдэг).
  await c.env.DB.prepare('DELETE FROM project_reminders WHERE project_id = ?').bind(id).run();

  // Дуусах огноо бодитоор өөрчлөгдсөн бол түүхэнд `correction` мөр (0337) —
  // хуучин утга хаана ч алдагдахгүй.  Утга ижил бол функц өөрөө алгасна.
  if (finish.touched) {
    const note =
      typeof body.note === 'string' ? body.note.trim().slice(0, DEADLINE_NOTE_MAX) || null : null;
    await recordDeadlineCorrection(c.env.DB, {
      project_id: id,
      from_date: current?.finish_date ?? null,
      to_date: nextFinish,
      created_by: user.sub,
      note,
    });
  }

  return c.json({ success: true, start_date: nextStart, finish_date: nextFinish });
});

/* ------------------------------------------------------------------ */
/*  PUT /api/timeline/projects/:id/manual-progress                     */
/* ------------------------------------------------------------------ */

timeline.put('/projects/:id/manual-progress', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Төслийн дугаар буруу' }, 400);
  const body = await c.req
    .json<{ manual_progress?: number | null }>()
    .catch(() => ({}) as { manual_progress?: number | null });

  const raw = body.manual_progress;
  let value: number | null;
  if (raw === null || raw === undefined) {
    value = null; // цэвэрлэх → автомат тооцоолол руу буцна
  } else if (typeof raw === 'number' && Number.isFinite(raw)) {
    value = clampPercent(raw);
  } else {
    return c.json({ error: 'Явц 0-100 хооронд тоо байх ёстой' }, 400);
  }

  const exists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'Төсөл олдсонгүй' }, 404);

  await c.env.DB.prepare(
    `UPDATE projects SET manual_progress = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(value, id)
    .run();

  return c.json({ success: true, manual_progress: value });
});

/* ------------------------------------------------------------------ */
/*  POST /api/timeline/projects/:id/nudge                              */
/* ------------------------------------------------------------------ */

const NUDGE_NOTE_MAX = 500;

timeline.post('/projects/:id/nudge', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Төслийн дугаар буруу' }, 400);
  const user = c.get('user');
  const body = await c.req.json<{ note?: string }>().catch(() => ({}) as { note?: string });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, NUDGE_NOTE_MAX) : '';

  const [project, sender, sentToday] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, display_title FROM projects WHERE id = ?')
      .bind(id)
      .first<{ id: number; name: string; display_title: string | null }>(),
    c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?')
      .bind(user.sub)
      .first<{ full_name: string }>(),
    // created_at нь UTC (datetime('now')) — УБ-ийн өдрөөр харьцуулахын тулд
    // +8 цаг нэмнэ (Монголд зуны цаг байхгүй тул тогтмол шилжилт хангалттай).
    c.env.DB.prepare(
      `SELECT id FROM project_nudges
        WHERE project_id = ? AND from_user_id = ?
          AND date(datetime(created_at, '+8 hours')) = ?
        LIMIT 1`,
    )
      .bind(id, user.sub, todayInUB())
      .first<{ id: number }>(),
  ]);

  if (!project) return c.json({ error: 'Төсөл олдсонгүй' }, 404);
  if (sentToday) {
    return c.json({ error: 'Энэ төсөл дээр өнөөдөр аль хэдийн сануулга илгээсэн байна' }, 409);
  }

  const title = project.display_title?.trim() || project.name;
  const senderName = sender?.full_name?.trim() || 'Удирдлага';
  const notified = await notifyProjectResponsible(
    c.env.DB,
    id,
    'project_nudge',
    `«${title}» — явцаа шинэчилнэ үү`,
    note ? `${senderName}: ${note}` : `${senderName} төслийн явцыг шинэчлэхийг хүслээ.`,
    `/app/projects/${id}`,
    { excludeUserId: user.sub },
  );

  if (notified.length > 0) {
    const stmt = c.env.DB.prepare(
      'INSERT INTO project_nudges (project_id, from_user_id, to_user_id, note) VALUES (?, ?, ?, ?)',
    );
    await c.env.DB.batch(
      notified.map((u) => stmt.bind(id, user.sub, u.id, note || null)),
    );
  }

  return c.json({ success: true, notified });
});

export default timeline;
