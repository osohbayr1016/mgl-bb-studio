import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import { isAdminRole } from '../types';
import type {
  Env,
  AppVariables,
  AssessmentTemplateRow,
  AssessmentRoundRow,
  AssessmentResponseRow,
} from '../types';
import { createNotification } from '../lib/notify';
import { bandForMean, nextBandForMean } from '../lib/behaviorScale';
import {
  EMPTY_SCHEMA,
  MAX_ANSWERS_BYTES,
  parseSchema,
  sanitizeAnswers,
  utf8Length,
  validateSchema,
} from '../lib/assessmentSchema';
import type {
  AssessmentAnswers,
  AssessmentLevelBand,
  AssessmentSchema,
  EvaluatorKind,
  ResponseStatus,
  RoundStatus,
  TemplateStatus,
} from '../lib/assessmentSchema';
import {
  countAnswered,
  DEFAULT_LEVELS,
  levelForPct,
  nextLevelFor,
  schemaItemCount,
  scoreAssessment,
} from '../lib/assessmentScore';
import type { SectionScore } from '../lib/assessmentScore';
import { buildLevelUpPlan } from '../lib/assessmentGap';
import type { LevelUpTarget, PartLevelUpPlan, SectionLevelUp } from '../lib/assessmentGap';
/* Оролцогчийн жагсаалтын БҮХ дүрэм `lib/assessmentRoster.ts`-д амьдардаг —
 * `routes/users.ts` мөн тэндээс уншдаг тул ажилтны амьдралын мөчлөг ба
 * судалгааны жагсаалт хоёр хэзээ ч зөрөхгүй.  Энд ДАХИН бичиж БОЛОХГҮЙ. */
import {
  ACTIVE_PARTICIPANT_SQL,
  ASSESSMENT_LINK,
  PARTICIPANT_ROLES,
  buildEvaluatorResolver,
  cohortSpecOf,
  enrollMembers,
  enrollStatements,
  isCohortKnown,
  jsonTextToIds,
  jsonTextToStrings,
  placeholders,
  resolveCohortIds,
  runBatched,
  toJsonText,
} from '../lib/assessmentRoster';

/* ============================================================
 * /api/assessments — Ур чадвар / зан чанарын үнэлгээ.
 *
 *   template (админ зохионо)
 *     → round (ээлж; template-ийн схемийг SNAPSHOT хийж хуулна)
 *       → participant (оролцогч + түүнийг үнэлэх багийн ахлагч)
 *         → response × 2 (self = ажилтан өөрөө, senior = багийн ахлагч)
 *
 * Харах эрх (docs/dev/assessments-spec.md §3) — СЕРВЕР тал бол жинхэнэ хаалт:
 *   • ажилтан  → өөрийн маягт + илгээсний дараа ӨӨРИЙН level, ӨӨРИЙН хувь,
 *                дараагийн түвшин хүртэлх зөрүү, мөн жингээр эрэмбэлсэн
 *                сул/хүчтэй 3 хэсэг (`/my/results`).  2026-08-аас эхлэн
 *                өөрийн хувь НЭЭЛТТЭЙ (эзний шийдвэр) — доорх «зөвхөн
 *                өөрийн» хилийг үз.  Өөрийн болон ахлагчийн оноог САЛГАСАН
 *                задаргаа (`self`/`senior`/`self_pct`/`senior_pct`/`must`/
 *                түүхий хариулт), бусад хүний тоо, багийн дундаж / benchmark
 *                нь хариунд БАЙХГҮЙ,
 *   • senior   → түүнд оногдсон маягтууд; үнэлж буй хүнийхээ бодогдсон
 *                хувь/оноог ХАРАХГҮЙ (senior бол admin БИШ),
 *   • admin    → бүх хүний бүх тоо / хувь / level / түүхий хариулт (Excel).
 *
 * `client` ба `worker` role БҮХ гарцад 403 (worker нь `lib/workerScope.ts`-ийн
 * цагаан жагсаалтад БАЙХГҮЙ тул тэндээс аль хэдийн хаагдана — энэ нь давхар
 * хамгаалалт).
 * ============================================================ */

const assessments = new Hono<{ Bindings: Env; Variables: AppVariables }>();


const TEMPLATE_STATUSES: TemplateStatus[] = ['draft', 'active', 'archived'];
const ROUND_STATUSES: RoundStatus[] = ['draft', 'open', 'closed'];
/**
 * `/api/assessments`-д ХАНДАХ эрхгүй role-ууд.  Энэ нь модулийн 403 хаалт
 * (`assessments.use('*')`) — оролцогчийн жагсаалттай ХОЛБООГҮЙ.
 *
 * ⚠️ Энд `admin` НЭМЖ БОЛОХГҮЙ: тэр хаалт админыг загвар засах, үр дүн харах
 *    зэрэг БҮХ гарцнаас түгжинэ.  «Админ үнэлүүлэх үү» гэдэг нь доорх
 *    `PARTICIPANT_ROLES`-ийн асуудал.
 */
const EXCLUDED_ROLES = ['client', 'worker'];



// ---------------------------------------------------------------------------
// Туслах функцүүд
// ---------------------------------------------------------------------------



/** `schema_json` → схем. Гэмтэлтэй бол хоосон схем (route унахгүй). */
function schemaOf(json: string | null | undefined): AssessmentSchema {
  return parseSchema(json ?? '') ?? EMPTY_SCHEMA;
}

/** `answers_json` → тоон утгатай хавтгай map. */
function answersOf(json: string | null | undefined): AssessmentAnswers {
  try {
    const parsed = JSON.parse(json || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: AssessmentAnswers = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function parseId(raw: string | undefined): number | null {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? n : null;
}

function trimmed(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** null-ийг зөвшөөрдөг огноо/текст талбар (PATCH-д хэрэглэнэ). */
function nullableText(v: unknown): string | null {
  const s = trimmed(v);
  return s ? s : null;
}



/** Хүсэлтийн `string[]` талбар → цэвэрлэсэн, давхардалгүй массив. */
function bodyStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(trimmed).filter((s) => s.length > 0))];
}

/** Хүсэлтийн `number[]` талбар → цэвэрлэсэн, давхардалгүй массив. */
function bodyIds(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set((v as unknown[]).filter((n): n is number => Number.isInteger(n)))];
}


// ---------------------------------------------------------------------------
// Серилайз хийх туслахууд
// ---------------------------------------------------------------------------

function templateSummary(row: AssessmentTemplateRow) {
  const schema = schemaOf(row.schema_json);
  return {
    id: row.id,
    code: row.code,
    title_mn: row.title_mn,
    title_en: row.title_en,
    description: row.description,
    status: row.status,
    item_count: schemaItemCount(schema),
    section_count: schema.parts.reduce((n, p) => n + p.sections.length, 0),
    /** Анхдагч баг — раунд үүсгэхэд урьдчилан бөглөгдөнө (migration 0146). */
    team_codes: jsonTextToStrings(row.team_codes),
    /** Анхдагч үнэлэгчид — мөн адил урьдчилан бөглөгдөнө (migration 0147). */
    senior_user_ids: jsonTextToIds(row.senior_user_ids),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function templateDetail(row: AssessmentTemplateRow) {
  return { ...templateSummary(row), schema: schemaOf(row.schema_json) };
}

/** `AssessmentRoundSummary` — тоолуурууд дэд query-ээр нэг дор ирнэ. */
interface RoundSummaryRow extends AssessmentRoundRow {
  participant_count: number;
  self_submitted_count: number;
  senior_submitted_count: number;
}

/**
 * ⚠️ ГУРВУУЛАА `users`-т нэгдэж `ACTIVE_PARTICIPANT_SQL`-ээр шүүнэ.
 *    `fetchParticipants` мөн адил шүүдэг тул жагсаалтын тоо ба хүснэгтийн
 *    мөрийн тоо ХЭЗЭЭ Ч зөрөхгүй.  (Өмнө нь тоолуурууд `users`-т огт
 *    нэгддэггүй байсан — идэвхгүй хүн хүснэгтээс алга болмогц «19/21» гэсэн
 *    тайлагдашгүй харьцаа гарч ирнэ.)
 */
const ROUND_SUMMARY_SQL = `
  SELECT ro.*,
         (SELECT COUNT(*) FROM assessment_participants p
            JOIN users u ON u.id = p.user_id
           WHERE p.round_id = ro.id AND ${ACTIVE_PARTICIPANT_SQL}) AS participant_count,
         (SELECT COUNT(*) FROM assessment_responses r
            JOIN users u ON u.id = r.subject_user_id
           WHERE r.round_id = ro.id AND r.evaluator_kind = 'self'
             AND r.status = 'submitted' AND ${ACTIVE_PARTICIPANT_SQL}) AS self_submitted_count,
         (SELECT COUNT(*) FROM assessment_responses r
            JOIN users u ON u.id = r.subject_user_id
           WHERE r.round_id = ro.id AND r.evaluator_kind = 'senior'
             AND r.status = 'submitted' AND ${ACTIVE_PARTICIPANT_SQL}) AS senior_submitted_count
    FROM assessment_rounds ro`;

function roundSummary(row: RoundSummaryRow) {
  return {
    id: row.id,
    template_id: row.template_id,
    name: row.name,
    period: row.period,
    status: row.status,
    opens_at: row.opens_at,
    closes_at: row.closes_at,
    participant_count: row.participant_count ?? 0,
    self_submitted_count: row.self_submitted_count ?? 0,
    senior_submitted_count: row.senior_submitted_count ?? 0,
    /** Раунд ямар багт явсан (migration 0146). */
    team_codes: jsonTextToStrings(row.team_codes),
    /** Раунд даяар үнэлэх senior-ууд (migration 0146). */
    senior_user_ids: jsonTextToIds(row.senior_user_ids),
    created_at: row.created_at,
  };
}

/**
 * Раунд даяарх senior-уудын нэр — нэг query.  `senior_user_ids` нь JSON
 * текст тул SQL-ээс JOIN хийж болохгүй, id-уудыг кодоор задалж татна.
 */
async function fetchSeniorUsers(db: D1Database, ids: number[]) {
  if (!ids.length) return [] as { user_id: number; full_name: string }[];
  const { results } = await db
    .prepare(
      `SELECT id AS user_id, full_name FROM users
        WHERE id IN (${placeholders(ids.length)}) ORDER BY full_name ASC`,
    )
    .bind(...ids)
    .all<{ user_id: number; full_name: string }>();
  return results ?? [];
}

/** Round-ын оролцогчийн нэг мөр (хэрэглэгчийн мэдээлэл + 2 маягтын төлөв). */
interface ParticipantRow {
  user_id: number;
  full_name: string;
  employee_id: string | null;
  profile_image: string | null;
  position: string | null;
  team_code: string | null;
  team_name_mn: string | null;
  evaluator_user_id: number | null;
  evaluator_name: string | null;
  self_response_id: number | null;
  self_status: ResponseStatus | null;
  senior_response_id: number | null;
  /**
   * Хуучин ганц-ахлагчийн талбар.  Хэд хэдэн ахлагчтай үед «БҮГД илгээсэн»
   * үед л `'submitted'` болно — хагас дутуу байхад «дууссан» гэж харагдахгүй.
   */
  senior_status: ResponseStatus | null;
  /** Оноогдсон ахлагчийн тоо / тэдгээрээс илгээсний тоо. */
  senior_total: number;
  senior_submitted: number;
}

/**
 * Оролцогчийн жагсаалт.  `includeOrphans=true` үед оролцогчийн жагсаалтаас
 * ХАСАГДСАН ч submitted маягттай хүмүүсийг мөн оруулна — PUT
 * /rounds/:id/participants нь submitted маягтыг зориуд үлдээдэг тул тайлан
 * тэднийг алдахгүй байх ёстой (spec §6).
 *
 * ⚠️ 2026-08-19: ЭЦСИЙН шүүлт нь `ACTIVE_PARTICIPANT_SQL` — идэвхгүй болсон
 *    хүн `includeOrphans`-ийн UNION-оор ч буцаж ОРЖ ИРЭХГҮЙ.  Энэ нь эзний
 *    шийдвэр («хаана ч байсан бүрэн арилгана») бөгөөд нэг мэдэгдэхүйц үр
 *    дагавартай: раундын ЦОРЫН ГАНЦ илгээсэн ахлагчийн маягт нь идэвхгүй
 *    болсон хүнийх бол тухайн раундын график дээрх «Ахлагчийн үнэлгээ» ба
 *    «Дундаж» цуврал алга болно (`RoundResultsView`-ийн `showAverageSeries`).
 *    Өгөгдөл нь DB-д бүтэн үлдэх тул дансыг `active` болгомогц буцаж гарна.
 */
async function fetchParticipants(
  db: D1Database,
  roundId: number,
  includeOrphans: boolean,
): Promise<ParticipantRow[]> {
  const roster = includeOrphans
    ? `SELECT user_id FROM assessment_participants WHERE round_id = ?1
       UNION
       SELECT subject_user_id AS user_id FROM assessment_responses
        WHERE round_id = ?1 AND status = 'submitted'`
    : `SELECT user_id FROM assessment_participants WHERE round_id = ?1`;

  // ⚠️ `senior` маягтыг LEFT JOIN-оор татаж БОЛОХГҮЙ: migration 0142-оос хойш
  //    нэг ажилтанд хэд хэдэн 'senior' мөр байж болох тул JOIN нь оролцогчийг
  //    ахлагчийн тоогоор ДАВХАРДУУЛНА (жагсаалтад нэг хүн 2 удаа гарна).
  //    Тиймээс корреляц дэд query-ээр нэгтгэж авна.
  const seniorWhere = `n.round_id = ?1 AND n.subject_user_id = roster.user_id
                       AND n.evaluator_kind = 'senior'`;
  const { results } = await db
    .prepare(
      `WITH roster(user_id) AS (${roster})
       SELECT u.id AS user_id, u.full_name, u.employee_id, u.profile_image, u.position,
              pt.code AS team_code, pt.name_mn AS team_name_mn,
              p.evaluator_user_id AS evaluator_user_id,
              ev.full_name AS evaluator_name,
              sr.id AS self_response_id, sr.status AS self_status,
              (SELECT n.id FROM assessment_responses n
                WHERE ${seniorWhere} ORDER BY n.id ASC LIMIT 1) AS senior_response_id,
              (SELECT COUNT(*) FROM assessment_responses n
                WHERE ${seniorWhere}) AS senior_total,
              (SELECT COUNT(*) FROM assessment_responses n
                WHERE ${seniorWhere} AND n.status = 'submitted') AS senior_submitted
         FROM roster
         JOIN users u ON u.id = roster.user_id
         LEFT JOIN assessment_participants p
                ON p.round_id = ?1 AND p.user_id = roster.user_id
         LEFT JOIN user_teams ut ON ut.user_id = u.id AND ut.is_primary = 1
         LEFT JOIN teams pt ON pt.id = ut.team_id
         LEFT JOIN users ev ON ev.id = p.evaluator_user_id
         LEFT JOIN assessment_responses sr
                ON sr.round_id = ?1 AND sr.subject_user_id = roster.user_id
               AND sr.evaluator_kind = 'self'
        WHERE ${ACTIVE_PARTICIPANT_SQL}
        ORDER BY u.full_name ASC`,
    )
    .bind(roundId)
    .all<Omit<ParticipantRow, 'senior_status'>>();

  return (results ?? []).map((row) => ({
    ...row,
    senior_total: row.senior_total ?? 0,
    senior_submitted: row.senior_submitted ?? 0,
    // «Бүгд илгээсэн» үед л submitted — 2 ахлагчийн 1 нь бөглөсөн байхад
    // хүснэгт «дууссан» гэж хуурч харуулах ёсгүй.
    senior_status:
      (row.senior_total ?? 0) === 0
        ? null
        : (row.senior_submitted ?? 0) >= (row.senior_total ?? 0)
          ? ('submitted' as ResponseStatus)
          : ('draft' as ResponseStatus),
  }));
}

/** Раундын БҮХ 'senior' маягт, ажилтан тус бүрээр бүлэглэсэн (админы хүснэгтэд). */
async function fetchSeniorAssignments(db: D1Database, roundId: number) {
  const { results } = await db
    .prepare(
      `SELECT r.subject_user_id, r.evaluator_user_id, r.id AS response_id, r.status,
              ev.full_name AS evaluator_name
         FROM assessment_responses r
         LEFT JOIN users ev ON ev.id = r.evaluator_user_id
        WHERE r.round_id = ? AND r.evaluator_kind = 'senior'
        ORDER BY ev.full_name ASC, r.id ASC`,
    )
    .bind(roundId)
    .all<{
      subject_user_id: number;
      evaluator_user_id: number | null;
      response_id: number;
      status: ResponseStatus;
      evaluator_name: string | null;
    }>();

  const map = new Map<
    number,
    { user_id: number | null; full_name: string | null; response_id: number; status: ResponseStatus }[]
  >();
  for (const row of results ?? []) {
    const list = map.get(row.subject_user_id) ?? [];
    list.push({
      user_id: row.evaluator_user_id,
      full_name: row.evaluator_name,
      response_id: row.response_id,
      status: row.status,
    });
    map.set(row.subject_user_id, list);
  }
  return map;
}

/** `AssessmentParticipant` (api.ts) хэлбэр. */
function participantOut(
  row: ParticipantRow,
  seniors: {
    user_id: number | null;
    full_name: string | null;
    response_id: number;
    status: ResponseStatus;
  }[] = [],
) {
  return {
    user_id: row.user_id,
    full_name: row.full_name,
    employee_id: row.employee_id,
    profile_image: row.profile_image,
    team_code: row.team_code,
    team_name_mn: row.team_name_mn,
    evaluator_user_id: row.evaluator_user_id,
    evaluator_name: row.evaluator_name,
    self_status: row.self_status,
    self_response_id: row.self_response_id,
    senior_status: row.senior_status,
    senior_response_id: row.senior_response_id,
    senior_total: row.senior_total,
    senior_submitted: row.senior_submitted,
    /** Оноогдсон ахлагч бүр — нэр, түүний маягтын id, төлөв. */
    seniors,
  };
}

/** `AssessmentRoundDetail` — summary + snapshot схем + оролцогчид. */
async function roundDetail(db: D1Database, roundId: number) {
  const row = await db
    .prepare(`${ROUND_SUMMARY_SQL} WHERE ro.id = ?`)
    .bind(roundId)
    .first<RoundSummaryRow>();
  if (!row) return null;
  const summary = roundSummary(row);
  const [participants, seniorMap, seniorUsers] = await Promise.all([
    fetchParticipants(db, roundId, false),
    fetchSeniorAssignments(db, roundId),
    fetchSeniorUsers(db, summary.senior_user_ids),
  ]);
  return {
    ...summary,
    senior_users: seniorUsers,
    schema: schemaOf(row.schema_json),
    participants: participants.map((p) => participantOut(p, seniorMap.get(p.user_id) ?? [])),
  };
}

// ---------------------------------------------------------------------------
// Эрхийн хаалт
// ---------------------------------------------------------------------------

// `client` / `worker` — судалгаанд огт хамаарахгүй.
assessments.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (EXCLUDED_ROLES.includes(user.role)) {
    return c.json({ error: 'Forbidden: энэ хэсэгт хандах эрхгүй' }, 403);
  }
  return next();
});

// Template / round / үр дүн — бүгд ЗӨВХӨН admin.  (`/my*` ба `/responses/*`
// нь энэ хаалтаас гадуур — тэдгээр нь эзний өөрийн шалгалттай.)
assessments.use('/templates', requireAdmin());
assessments.use('/templates/*', requireAdmin());
assessments.use('/rounds', requireAdmin());
assessments.use('/rounds/*', requireAdmin());

// ---------------------------------------------------------------------------
// Админ — асуулгын загвар (template)
// ---------------------------------------------------------------------------

// GET /api/assessments/templates — бүх загвар (мөр/хэсгийн тоотой).
assessments.get('/templates', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM assessment_templates ORDER BY updated_at DESC, id DESC`,
  ).all<AssessmentTemplateRow>();
  return c.json({ templates: (results ?? []).map(templateSummary) });
});

// GET /api/assessments/templates/:id — схемтэй нь бүтнээр.
assessments.get('/templates/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(`SELECT * FROM assessment_templates WHERE id = ?`)
    .bind(id)
    .first<AssessmentTemplateRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ template: templateDetail(row) });
});

// POST /api/assessments/templates — шинэ загвар (Word import эсвэл гараар).
assessments.post('/templates', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const code = trimmed(body.code).toUpperCase();
  if (!code) return c.json({ error: 'Код (code) хоосон байна' }, 400);
  const titleMn = trimmed(body.title_mn);
  if (!titleMn) return c.json({ error: 'Монгол нэр хоосон байна' }, 400);

  const status: TemplateStatus = TEMPLATE_STATUSES.includes(body.status as TemplateStatus)
    ? (body.status as TemplateStatus)
    : 'draft';

  const checked = validateSchema(body.schema ?? EMPTY_SCHEMA);
  if (!checked.ok) return c.json({ error: checked.error }, 400);

  const duplicate = await c.env.DB.prepare(`SELECT id FROM assessment_templates WHERE code = ?`)
    .bind(code)
    .first<{ id: number }>();
  if (duplicate) {
    return c.json({ error: 'Ийм кодтой загвар аль хэдийн байна', template_id: duplicate.id }, 409);
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO assessment_templates
       (code, title_mn, title_en, description, schema_json, status,
        team_codes, senior_user_ids, created_by_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      code,
      titleMn,
      nullableText(body.title_en),
      nullableText(body.description),
      JSON.stringify(checked.schema),
      status,
      toJsonText(bodyStrings(body.team_codes)),
      toJsonText(bodyIds(body.senior_user_ids)),
      user.sub,
    )
    .first<AssessmentTemplateRow>();
  if (!row) return c.json({ error: 'Failed to create' }, 500);

  return c.json({ template: templateDetail(row) }, 201);
});

// PUT /api/assessments/templates/:id — хэсэгчилсэн засвар (илгээсэн талбар нь л солигдоно).
assessments.put('/templates/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);

  const existing = await c.env.DB.prepare(`SELECT * FROM assessment_templates WHERE id = ?`)
    .bind(id)
    .first<AssessmentTemplateRow>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (body.code !== undefined) {
    const code = trimmed(body.code).toUpperCase();
    if (!code) return c.json({ error: 'Код (code) хоосон байна' }, 400);
    if (code !== existing.code) {
      const duplicate = await c.env.DB.prepare(
        `SELECT id FROM assessment_templates WHERE code = ? AND id != ?`,
      )
        .bind(code, id)
        .first<{ id: number }>();
      if (duplicate) return c.json({ error: 'Ийм кодтой загвар аль хэдийн байна' }, 409);
    }
    sets.push('code = ?');
    binds.push(code);
  }
  if (body.title_mn !== undefined) {
    const titleMn = trimmed(body.title_mn);
    if (!titleMn) return c.json({ error: 'Монгол нэр хоосон байна' }, 400);
    sets.push('title_mn = ?');
    binds.push(titleMn);
  }
  if (body.title_en !== undefined) {
    sets.push('title_en = ?');
    binds.push(nullableText(body.title_en));
  }
  if (body.description !== undefined) {
    sets.push('description = ?');
    binds.push(nullableText(body.description));
  }
  if (body.status !== undefined) {
    if (!TEMPLATE_STATUSES.includes(body.status as TemplateStatus)) {
      return c.json({ error: 'Төлөв буруу байна' }, 400);
    }
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (body.schema !== undefined) {
    const checked = validateSchema(body.schema);
    if (!checked.ok) return c.json({ error: checked.error }, 400);
    sets.push('schema_json = ?');
    binds.push(JSON.stringify(checked.schema));
  }
  if (body.team_codes !== undefined) {
    sets.push('team_codes = ?');
    binds.push(toJsonText(bodyStrings(body.team_codes)));
  }
  if (body.senior_user_ids !== undefined) {
    sets.push('senior_user_ids = ?');
    binds.push(toJsonText(bodyIds(body.senior_user_ids)));
  }

  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    await c.env.DB.prepare(`UPDATE assessment_templates SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  }

  const updated = await c.env.DB.prepare(`SELECT * FROM assessment_templates WHERE id = ?`)
    .bind(id)
    .first<AssessmentTemplateRow>();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json({ template: templateDetail(updated) });
});

// DELETE /api/assessments/templates/:id — round-той бол ХОРИГЛОНО.
//   `assessment_rounds.template_id` нь ON DELETE CASCADE тул загварыг устгавал
//   бүх ээлж, маягт, хариулт чимээгүй устана — тайлан алдагдахаас сэргийлж 409.
assessments.delete('/templates/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);

  const used = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM assessment_rounds WHERE template_id = ?`,
  )
    .bind(id)
    .first<{ n: number }>();
  if ((used?.n ?? 0) > 0) {
    return c.json(
      { error: 'Энэ загвараар авсан судалгаа байна — эхлээд ээлжүүдийг устгана уу' },
      409,
    );
  }

  await c.env.DB.prepare(`DELETE FROM assessment_templates WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Админ — судалгааны ээлж (round)
// ---------------------------------------------------------------------------

// GET /api/assessments/rounds — бүх ээлж (оролцогч/илгээсний тоотой).
assessments.get('/rounds', async (c) => {
  const { results } = await c.env.DB.prepare(
    `${ROUND_SUMMARY_SQL} ORDER BY ro.created_at DESC, ro.id DESC`,
  ).all<RoundSummaryRow>();
  return c.json({ rounds: (results ?? []).map(roundSummary) });
});

// ---------------------------------------------------------------------------
// Хамрах хүрээ (cohort) ба бүртгэл (enrollment) — ГАНЦ эх сурвалж
// ---------------------------------------------------------------------------







/**
 * POST /api/assessments/rounds — шинэ ээлж.
 *
 *   1. template-ийн `schema_json`-г SNAPSHOT болгож хуулна (дараа template
 *      засагдсан ч энэ ээлж өөрчлөгдөхгүй),
 *   2. оролцогчдыг `user_ids` ∪ `team_codes` ∪ `roles`-оор бүрдүүлж,
 *      client/worker болон идэвхгүй хэрэглэгчийг ХАСНА,
 *   3. үнэлэгчдийг тогтооно — ХОЁР ГОРИМ:
 *        • `senior_user_ids` илгээсэн бол ТЭР senior-ууд раунд ДАЯАР бүх
 *          оролцогчийг үнэлнэ (өөрийгөө үнэлэхээс бусад).  Зөвхөн идэвхтэй
 *          `role='senior'` хэрэглэгч зөвшөөрөгдөнө — бусдыг чимээгүй хаяна.
 *        • илгээгээгүй бол хуучин зан төлөв: хүн бүрийн үнэлэгч нь үндсэн
 *          багийн `teams.lead_user_id` (нэг хүн).
 *   4. self + senior маягтуудыг draft-аар урьдчилан үүсгэнэ,
 *   5. оролцогч бүр + ахлагч бүрд мэдэгдэл илгээнэ.
 *
 * Мэдэгдэл эндээс явдаг тул ээлж анхдагчаар шууд `open` төлөвтэй үүснэ;
 * зориуд бэлтгэх бол `status: 'draft'` дамжуулна (тэгвэл мэдэгдэл явахгүй).
 */
assessments.post('/rounds', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));

  const templateId = Number(body.template_id);
  if (!Number.isFinite(templateId)) return c.json({ error: 'template_id буруу байна' }, 400);
  const name = trimmed(body.name);
  if (!name) return c.json({ error: 'Ээлжийн нэр хоосон байна' }, 400);
  const period = trimmed(body.period);
  if (!period) return c.json({ error: 'Хугацаа (period) хоосон байна' }, 400);

  const status: RoundStatus = body.status === 'draft' ? 'draft' : 'open';

  const template = await db
    .prepare(`SELECT * FROM assessment_templates WHERE id = ?`)
    .bind(templateId)
    .first<AssessmentTemplateRow>();
  if (!template) return c.json({ error: 'Загвар олдсонгүй' }, 404);

  const snapshot = parseSchema(template.schema_json);
  if (!snapshot) return c.json({ error: 'Загварын схем гэмтэлтэй байна' }, 400);
  if (!schemaItemCount(snapshot)) {
    return c.json({ error: 'Загварт нэг ч асуулт алга' }, 400);
  }

  /* ---- Оролцогчдыг бүрдүүлэх ---- */
  const userIds = Array.isArray(body.user_ids)
    ? (body.user_ids as unknown[]).filter((n): n is number => Number.isInteger(n))
    : [];
  const teamCodes = Array.isArray(body.team_codes)
    ? (body.team_codes as unknown[]).map(trimmed).filter((s) => s.length > 0)
    : [];
  // Зөвхөн ОРОЛЦОГЧ болох role-ууд (`admin` энд орохгүй — 2026-08-19).
  const roles = Array.isArray(body.roles)
    ? (body.roles as unknown[]).map(trimmed).filter((s) => PARTICIPANT_ROLES.includes(s))
    : [];

  if (!userIds.length && !teamCodes.length && !roles.length) {
    return c.json({ error: 'Оролцогч сонгоогүй байна' }, 400);
  }

  const members = await resolveCohortIds(db, { userIds, teamCodes, roles });
  if (!members.length) return c.json({ error: 'Тохирох оролцогч олдсонгүй' }, 400);

  /* ---- Үнэлэгчид ----
   *  А) `senior_user_ids` илгээсэн бол ТЭД раунд даяар бүгдийг үнэлнэ.
   *  Б) илгээгээгүй бол хүн тус бүрийн үндсэн багийн ахлагч (хуучин зам). */
  const memberIds = members.map((m) => m.id);
  const requestedSeniors = bodyIds(body.senior_user_ids);

  /** Раунд даяар үнэлэх, ШАЛГАГДСАН senior-ууд (хоосон бол Б горим). */
  let roundSeniors: number[] = [];
  if (requestedSeniors.length) {
    const { results: seniorRows } = await db
      .prepare(
        `SELECT id FROM users
          WHERE id IN (${placeholders(requestedSeniors.length)})
            AND status = 'active' AND role = 'senior'`,
      )
      .bind(...requestedSeniors)
      .all<{ id: number }>();
    roundSeniors = (seniorRows ?? []).map((r) => r.id);
    if (!roundSeniors.length) {
      return c.json({ error: 'Сонгосон үнэлэгчид senior эрхтэй биш байна' }, 400);
    }
  }

  /** Тухайн ажилтныг үнэлэх бүх senior. Өөрийгөө «ахлагчийн нүдээр» үнэлэхгүй. */
  const evaluatorsFor = await buildEvaluatorResolver(db, memberIds, roundSeniors);

  /* ---- Ээлж + маягтуудыг үүсгэх ---- */
  const round = await db
    .prepare(
      `INSERT INTO assessment_rounds
         (template_id, name, period, status, schema_json, opens_at, closes_at,
          team_codes, senior_user_ids, roles, user_ids, created_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(
      templateId,
      name,
      period,
      status,
      JSON.stringify(snapshot),
      nullableText(body.opens_at),
      nullableText(body.closes_at),
      toJsonText(teamCodes),
      toJsonText(roundSeniors),
      // `roles` / `user_ids` (migration 0182) — хамрах хүрээг БҮТНЭЭР нь
      // хадгална.  Өмнө нь зөвхөн `team_codes` хадгалагддаг байсан тул
      // role-оор үүсгэсэн раунд «хэн нар байх ёстой вэ»-гээ мартдаг, улмаар
      // дараа орсон ажилтныг нөхөж бүртгэх боломжгүй байв.
      toJsonText(roles),
      toJsonText(userIds),
      user.sub,
    )
    .first<AssessmentRoundRow>();
  if (!round) return c.json({ error: 'Failed to create round' }, 500);

  const { stmts, evaluatorLoad } = enrollStatements(db, round.id, memberIds, evaluatorsFor);
  await runBatched(db, stmts);

  /* ---- Мэдэгдэл ---- */
  if (status === 'open') {
    await Promise.all([
      ...members.map((m) =>
        createNotification(
          db,
          m.id,
          'assessment_assigned',
          'Ур чадварын үнэлгээ',
          `${round.name} — өөрийн үнэлгээгээ бөглөнө үү`,
          ASSESSMENT_LINK,
        ),
      ),
      // Ахлагч бүр яг хэдэн хүн үнэлэхээ шууд мэдэх нь чухал — раунд даяарх
      // горимд «өөрөөсөө бусад бүгд», ахлагчийн горимд «өөрийн багийнхан».
      // Тиймээс дээр цуглуулсан бодит ачааллыг бичнэ (таамаглахгүй).
      ...[...evaluatorLoad].map(([id, n]) =>
        createNotification(
          db,
          id,
          'assessment_assigned',
          'Багийнхаа үнэлгээг хийнэ үү',
          `${round.name} — танд ${n} ажилтны үнэлгээ оногдлоо`,
          ASSESSMENT_LINK,
        ),
      ),
    ]);
  }

  const detail = await roundDetail(db, round.id);
  if (!detail) return c.json({ error: 'Failed to create round' }, 500);
  return c.json({ round: detail }, 201);
});

// GET /api/assessments/rounds/:id — snapshot схем + оролцогчид.
assessments.get('/rounds/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const detail = await roundDetail(c.env.DB, id);
  if (!detail) return c.json({ error: 'Not found' }, 404);
  return c.json({ round: detail });
});

/**
 * Раунд `draft → open` болоход мэдэгдэл илгээх.
 *
 * `POST /rounds` нь шууд `open` төлөвтэй үүсгэхдээ өөрөө мэдэгддэг тул энэ
 * нь ЗӨВХӨН дараа нь гараар нээсэн тохиолдолд ажиллана — эс бөгөөс ноорог
 * раунд нээгдсэн ч хэн ч мэдэхгүй үлдэнэ.  Хүлээн авагчдыг аль хэдийн
 * үүссэн маягтуудаас (self → ажилтан, senior → үнэлэгч) шууд уншина.
 */
async function notifyRoundOpened(db: D1Database, roundId: number, roundName: string) {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT evaluator_user_id AS user_id, evaluator_kind
         FROM assessment_responses
        WHERE round_id = ? AND evaluator_user_id IS NOT NULL`,
    )
    .bind(roundId)
    .all<{ user_id: number; evaluator_kind: EvaluatorKind }>();

  const selfIds = new Set<number>();
  const seniorIds = new Set<number>();
  for (const row of results ?? []) {
    if (row.evaluator_kind === 'self') selfIds.add(row.user_id);
    else seniorIds.add(row.user_id);
  }

  await Promise.all([
    ...[...selfIds].map((id) =>
      createNotification(
        db,
        id,
        'assessment_assigned',
        'Ур чадварын үнэлгээ',
        `${roundName} — өөрийн үнэлгээгээ бөглөнө үү`,
        ASSESSMENT_LINK,
      ),
    ),
    ...[...seniorIds].map((id) =>
      createNotification(
        db,
        id,
        'assessment_assigned',
        'Багийнхаа үнэлгээг хийнэ үү',
        `${roundName} — танд оногдсон ажилтнуудын үнэлгээ нээгдлээ`,
        ASSESSMENT_LINK,
      ),
    ),
  ]);
}

/**
 * PATCH /api/assessments/rounds/:id — нэр / period / нээх-хаах / огноо.
 *
 * ⚠️ Ээлжийн `name` нь загварын гарчгаас ТУСДАА багана.  Загварыг сольсон ч
 *    энд автоматаар дамжихгүй (нэг загвараар олон ээлж явуулдаг тул зориуд),
 *    иймд админ ЭНД гараар засна — `AssessmentAdminPage`-ийн харандаа товч.
 */
assessments.patch('/rounds/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT id, name, status FROM assessment_rounds WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: number; name: string; status: RoundStatus }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (body.name !== undefined) {
    const name = trimmed(body.name);
    if (!name) return c.json({ error: 'Ээлжийн нэр хоосон байна' }, 400);
    sets.push('name = ?');
    binds.push(name);
  }
  // `period` нь NOT NULL (0139_assessments.sql) — хоосон утга оруулж болохгүй.
  // Энэ салбар 2026-08-19-д НЭМЭГДСЭН: өмнө нь байхгүй байсан тул нэр засах
  // цонх `{name, period}` илгээхэд сервер 200 буцаагаад `period`-ыг ЧИМЭЭГҮЙ
  // хаядаг байв.
  if (body.period !== undefined) {
    const period = trimmed(body.period);
    if (!period) return c.json({ error: 'Хугацаа (period) хоосон байна' }, 400);
    sets.push('period = ?');
    binds.push(period);
  }
  if (body.status !== undefined) {
    if (!ROUND_STATUSES.includes(body.status as RoundStatus)) {
      return c.json({ error: 'Төлөв буруу байна' }, 400);
    }
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (body.opens_at !== undefined) {
    sets.push('opens_at = ?');
    binds.push(nullableText(body.opens_at));
  }
  if (body.closes_at !== undefined) {
    sets.push('closes_at = ?');
    binds.push(nullableText(body.closes_at));
  }

  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    await c.env.DB.prepare(`UPDATE assessment_rounds SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  }

  const row = await c.env.DB.prepare(`${ROUND_SUMMARY_SQL} WHERE ro.id = ?`)
    .bind(id)
    .first<RoundSummaryRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  // Ноорогоос АНХ УДАА нээгдэж байгаа бол мэдэгдэнэ.  `closed → open` (дахин
  // нээх) үед мэдэгдэхгүй — тэр нь ихэвчлэн засварын зорилготой бөгөөд бүх
  // ажилтныг дахин чирэх ёсгүй.
  if (existing.status === 'draft' && row.status === 'open') {
    await notifyRoundOpened(c.env.DB, id, row.name);
  }

  return c.json({ round: roundSummary(row) });
});

// DELETE /api/assessments/rounds/:id — оролцогч/маягтууд FK cascade-аар устана.
assessments.delete('/rounds/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  await c.env.DB.prepare(`DELETE FROM assessment_rounds WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Админ — оролцогчийн жагсаалтыг ЗАСВАРЛАХ (roster)
//
// 2026-08-19-д НЭМЭГДСЭН.  Үүнээс өмнө раундын жагсаалтыг үүсгэсний ДАРАА
// засах ямар ч гарц UI-д байгаагүй (`PUT /rounds/:id/participants` нь
// байсан ч түүнийг дуудах нэг ч дуудагч frontend-д хэзээ ч байгаагүй).
// Тиймээс админд гурван л сонголт байв: буруу хүнийг үлдээх, эсвэл
// РАУНДЫГ БҮХЭЛД НЬ устгах (илгээсэн бүх үнэлгээ хамт цаасддаг).
// ---------------------------------------------------------------------------

/** Жагсаалтад БАЙГАА хүн бүр — идэвхгүйг нь ч оруулаад (аудитын зорилгоор). */
interface RosterAuditRow {
  user_id: number;
  full_name: string;
  role: string;
  user_status: string;
  team_code: string | null;
  submitted_count: number;
}

/**
 * Раундын одоогийн жагсаалтыг БҮТНЭЭР нь (идэвхгүй хүнийг ч) уншина.
 *
 * ⚠️ `fetchParticipants` нь `ACTIVE_PARTICIPANT_SQL`-ээр шүүдэг тул тэндээс
 *    идэвхгүй хүн ХАРАГДАХГҮЙ.  Админ «хэн хуучирсан бэ»-г харж, дарж
 *    хасахын тулд шүүлтгүй эх жагсаалт хэрэгтэй — энэ функц ЯГ ТҮҮНД зориулагдсан.
 */
async function fetchRosterAudit(db: D1Database, roundId: number) {
  const { results } = await db
    .prepare(
      `SELECT p.user_id AS user_id, u.full_name, u.role, u.status AS user_status,
              (SELECT t.code FROM user_teams ut JOIN teams t ON t.id = ut.team_id
                WHERE ut.user_id = u.id AND ut.is_primary = 1 LIMIT 1) AS team_code,
              (SELECT COUNT(*) FROM assessment_responses r
                WHERE r.round_id = p.round_id AND r.subject_user_id = p.user_id
                  AND r.status = 'submitted') AS submitted_count
         FROM assessment_participants p
         JOIN users u ON u.id = p.user_id
        WHERE p.round_id = ?
        ORDER BY u.full_name ASC`,
    )
    .bind(roundId)
    .all<RosterAuditRow>();
  return results ?? [];
}

/** `stale` мөрийн шалтгаан — UI шууд орчуулж харуулна. */
type StaleReason = 'inactive' | 'role' | 'out_of_cohort' | 'excluded';

/**
 * Раундын жагсаалтыг хамрах хүрээтэй нь тулгана.
 *
 *   missing — хамрах хүрээнд тохирох ч бүртгэгдээгүй (шинэ ажилтан),
 *   stale   — бүртгэлтэй ч байх ёсгүй болсон (гарсан / role нь тохирохгүй /
 *             хамрах хүрээнээс гарсан / админ зориуд хассан).
 */
async function auditRoster(db: D1Database, round: AssessmentRoundRow) {
  const spec = cohortSpecOf(round);
  const excluded = new Set(jsonTextToIds(round.excluded_user_ids));
  const [eligible, current] = await Promise.all([
    resolveCohortIds(db, spec),
    fetchRosterAudit(db, round.id),
  ]);
  const enrolled = new Set(current.map((r) => r.user_id));

  const missing = eligible.filter((m) => !enrolled.has(m.id) && !excluded.has(m.id));

  // Хамрах хүрээ ТОДОРХОЙЛОГДООГҮЙ (гурвуулаа хоосон) раундад «хүрээнээс
  // гарсан» гэж дүгнэж БОЛОХГҮЙ — тэр үед бүх хүн буруугаар stale болно.
  const cohortKnown = isCohortKnown(spec);
  const eligibleIds = new Set(eligible.map((m) => m.id));

  const stale = current
    .map((row) => {
      let reason: StaleReason | null = null;
      if (excluded.has(row.user_id)) reason = 'excluded';
      else if (row.user_status !== 'active') reason = 'inactive';
      else if (!PARTICIPANT_ROLES.includes(row.role)) reason = 'role';
      else if (cohortKnown && !eligibleIds.has(row.user_id)) reason = 'out_of_cohort';
      return reason ? { ...row, reason } : null;
    })
    .filter((r): r is RosterAuditRow & { reason: StaleReason } => r !== null);

  return { missing, stale, cohortKnown };
}

/**
 * GET /api/assessments/rounds/:id/candidates — жагсаалтын аудит (уншина л).
 *
 * Админы «Ростер» самбар үүнийг харуулна: нэмэх ёстой шинэ ажилтан, хасах
 * ёстой хуучирсан бүртгэл.  Ямар ч бичилт хийхгүй.
 */
assessments.get('/rounds/:id/candidates', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const round = await c.env.DB.prepare(`SELECT * FROM assessment_rounds WHERE id = ?`)
    .bind(id)
    .first<AssessmentRoundRow>();
  if (!round) return c.json({ error: 'Not found' }, 404);

  const { missing, stale, cohortKnown } = await auditRoster(c.env.DB, round);
  return c.json({
    round_status: round.status,
    auto_enroll: round.auto_enroll === 1,
    /** false бол хамрах хүрээ мэдэгдэхгүй хуучин раунд — sync юу ч хийхгүй. */
    cohort_known: cohortKnown,
    missing: missing.map((m) => ({
      user_id: m.id,
      full_name: m.full_name,
      role: m.role,
      team_code: m.team_code,
    })),
    stale: stale.map((s) => ({
      user_id: s.user_id,
      full_name: s.full_name,
      role: s.role,
      user_status: s.user_status,
      team_code: s.team_code,
      reason: s.reason,
      /** >0 бол хасахад ч тайланд `includeOrphans`-аар үлдэнэ — UI үүнийг хэлнэ. */
      submitted_count: s.submitted_count ?? 0,
    })),
  });
});


/**
 * POST /api/assessments/rounds/:id/sync — хамрах хүрээнд тохирох ч
 * бүртгэгдээгүй хүмүүсийг НӨХӨЖ бүртгэнэ.
 *
 * ⚠️ ЗӨВХӨН НЭМНЭ, хэзээ ч хасахгүй.  Жагсаалт бол агшны хуулбар: үүсгэх үед
 *    оролцож байгаад хожим баг сольсон (эсвэл аль хэдийн үнэлгээгээ илгээсэн)
 *    хүнийг автомат ажил хэзээ ч устгах ёсгүй.  Хасалт нь ҮРГЭЛЖ админы
 *    зориудын үйлдэл (`DELETE …/participants/:userId`).
 */
assessments.post('/rounds/:id/sync', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const round = await db
    .prepare(`SELECT * FROM assessment_rounds WHERE id = ?`)
    .bind(id)
    .first<AssessmentRoundRow>();
  if (!round) return c.json({ error: 'Not found' }, 404);
  // Хаагдсан раундын түүхэн тайланг хэзээ ч өөрчлөхгүй.
  if (round.status === 'closed') {
    return c.json({ error: 'Хаагдсан ээлжид оролцогч нэмэх боломжгүй' }, 409);
  }

  const { missing } = await auditRoster(db, round);
  const added = await enrollMembers(
    db,
    round,
    missing.map((m) => m.id),
  );

  const detail = await roundDetail(db, id);
  if (!detail) return c.json({ error: 'Not found' }, 404);
  return c.json({ added, round: detail });
});

/**
 * POST /api/assessments/rounds/:id/participants/:userId — нэг хүн нэмнэ.
 *
 * Идэмхгүй/буруу role-той хүнийг сервер тал хаана.  Өмнө нь зориуд хассан
 * байсан бол `excluded_user_ids`-ээс гаргана (админ санаагаа өөрчилсөн).
 */
assessments.post('/rounds/:id/participants/:userId', async (c) => {
  const id = parseId(c.req.param('id'));
  const userId = parseId(c.req.param('userId'));
  if (id === null || userId === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;

  const round = await db
    .prepare(`SELECT * FROM assessment_rounds WHERE id = ?`)
    .bind(id)
    .first<AssessmentRoundRow>();
  if (!round) return c.json({ error: 'Not found' }, 404);
  if (round.status === 'closed') {
    return c.json({ error: 'Хаагдсан ээлжид оролцогч нэмэх боломжгүй' }, 409);
  }

  const target = await db
    .prepare(
      `SELECT id, full_name, role, status FROM users
        WHERE id = ? AND status = 'active'
          AND role IN (${placeholders(PARTICIPANT_ROLES.length)})`,
    )
    .bind(userId, ...PARTICIPANT_ROLES)
    .first<{ id: number; full_name: string; role: string; status: string }>();
  if (!target) {
    return c.json(
      { error: 'Энэ хэрэглэгч судалгаанд оролцох боломжгүй (идэвхгүй эсвэл эрх нь тохирохгүй)' },
      400,
    );
  }

  // Гараар нэмсэн хүнийг «зориуд хассан» жагсаалтаас гаргана, эс бөгөөс
  // аудит түүнийг тэр дороо дахин «хасах ёстой» гэж тэмдэглэнэ.
  const excluded = jsonTextToIds(round.excluded_user_ids).filter((n) => n !== userId);
  await db
    .prepare(
      `UPDATE assessment_rounds SET excluded_user_ids = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(toJsonText(excluded), id)
    .run();

  await enrollMembers(db, round, [userId]);

  const detail = await roundDetail(db, id);
  if (!detail) return c.json({ error: 'Not found' }, 404);
  return c.json({ round: detail });
});

/**
 * DELETE /api/assessments/rounds/:id/participants/:userId — нэг хүнийг хасна.
 *
 * ⚠️ ЯГ ЮУ УСТГАХ ВЭ:
 *      • оролцогчийн мөр,
 *      • түүний БӨГЛӨӨГҮЙ (`draft`) self/senior маягтууд,
 *      • түүнийг үнэлэх ахлагчийн БӨГЛӨӨГҮЙ маягтууд (энэ нь ахлагчийн
 *        «Миний үнэлэх хүмүүс» жагсаалтыг цэвэрлэдэг — хуучин `PUT` энэ
 *        талыг ОРХИГДУУЛДАГ байсан).
 *    ИЛГЭЭСЭН (`submitted`) маягтыг ХЭЗЭЭ Ч устгахгүй — тэр бол бодит
 *    тайлангийн өгөгдөл.  Ийм хүн `includeOrphans`-аар тайланд үлдэх тул
 *    хариуд нь `kept_submitted` буцаана; UI үүнийг ил хэлэх ёстой,
 *    «хассан» гэж хуурч БОЛОХГҮЙ.
 *
 * ⚠️ Яагаад одоо байгаа `PUT /rounds/:id/participants`-ыг ашиглаагүй вэ:
 *    тэр нь ЖАГСААЛТЫГ БҮХЭЛД НЬ солидог тул нэг мөрийн товчинд туйлын
 *    аюултай — `participants` талбаргүй дуудвал бүх жагсаалт арилна,
 *    `senior_user_ids: []` дамжуулбал бүх үнэлэгч цэвэрлэгдэнэ, мөн
 *    `status='active'` шүүлт нь ХАМААРАЛГҮЙ идэвхгүй хүмүүсийг чимээгүй
 *    хамт хаядаг.  Тиймээс энэ гарц ЗӨВХӨН нэг хүнд хамаарна.
 */
assessments.delete('/rounds/:id/participants/:userId', async (c) => {
  const id = parseId(c.req.param('id'));
  const userId = parseId(c.req.param('userId'));
  if (id === null || userId === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;

  const round = await db
    .prepare(`SELECT * FROM assessment_rounds WHERE id = ?`)
    .bind(id)
    .first<AssessmentRoundRow>();
  if (!round) return c.json({ error: 'Not found' }, 404);

  const kept = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM assessment_responses
        WHERE round_id = ? AND subject_user_id = ? AND status = 'submitted'`,
    )
    .bind(id, userId)
    .first<{ n: number }>();

  await runBatched(db, [
    db
      .prepare(
        `DELETE FROM assessment_responses
          WHERE round_id = ? AND subject_user_id = ? AND status = 'draft'`,
      )
      .bind(id, userId),
    db
      .prepare(
        `DELETE FROM assessment_responses
          WHERE round_id = ? AND evaluator_user_id = ? AND evaluator_kind = 'senior'
            AND status = 'draft'`,
      )
      .bind(id, userId),
    db
      .prepare(`DELETE FROM assessment_participants WHERE round_id = ? AND user_id = ?`)
      .bind(id, userId),
  ]);

  // Sync дахин нэмэхээс сэргийлж «зориуд хассан» жагсаалтад бичнэ.
  const excluded = [...new Set([...jsonTextToIds(round.excluded_user_ids), userId])];
  await db
    .prepare(
      `UPDATE assessment_rounds SET excluded_user_ids = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(toJsonText(excluded), id)
    .run();

  const detail = await roundDetail(db, id);
  if (!detail) return c.json({ error: 'Not found' }, 404);
  return c.json({ removed: true, kept_submitted: kept?.n ?? 0, round: detail });
});

/**
 * PUT /api/assessments/rounds/:id/participants — жагсаалтыг БҮХЭЛД НЬ солино.
 *
 * Хасагдсан хүний draft маягт устана, submitted маягт нь ҮЛДЭНЭ (тайлан
 * алдагдахгүй — `/results` нь ийм «өнчин» submitted маягтыг ч түүнэ).
 *
 * Үнэлэгчийг ХОЁР янзаар өгч болно (`POST /rounds`-тэй ижил):
 *   • `senior_user_ids` — раунд ДАЯАР: сонгосон senior бүр бүх оролцогчийг
 *     үнэлнэ.  Илгээвэл оролцогч мөрийн `evaluator_user_id` үл хэрэгсэгдэнэ.
 *   • эс бөгөөс оролцогч бүрийн `evaluator_user_id` (ганц ахлагч, хуучин зам).
 */
assessments.put('/rounds/:id/participants', async (c) => {
  const roundId = parseId(c.req.param('id'));
  if (roundId === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;

  const round = await db
    .prepare(`SELECT id FROM assessment_rounds WHERE id = ?`)
    .bind(roundId)
    .first<{ id: number }>();
  if (!round) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const raw = Array.isArray(body.participants) ? (body.participants as unknown[]) : [];

  /* ---- Раунд даяарх senior-ууд (сонголттой) ---- */
  const roundWide = body.senior_user_ids !== undefined;
  let roundSeniors: number[] = [];
  if (roundWide) {
    const requested = bodyIds(body.senior_user_ids);
    if (requested.length) {
      const { results } = await db
        .prepare(
          `SELECT id FROM users
            WHERE id IN (${placeholders(requested.length)})
              AND status = 'active' AND role = 'senior'`,
        )
        .bind(...requested)
        .all<{ id: number }>();
      roundSeniors = (results ?? []).map((r) => r.id);
    }
  }

  // Хүсэлтийн мөрүүдийг цэвэрлэж, user_id-аар давхардлыг арилгана.
  const wanted = new Map<number, number | null>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const userId = Number(rec.user_id);
    if (!Number.isInteger(userId)) continue;
    const evaluatorRaw = rec.evaluator_user_id;
    const evaluator =
      evaluatorRaw === null || evaluatorRaw === undefined || !Number.isInteger(Number(evaluatorRaw))
        ? null
        : Number(evaluatorRaw);
    // Хэн ч өөрийгөө «ахлагчийн нүдээр» үнэлэхгүй.
    wanted.set(userId, evaluator === userId ? null : evaluator);
  }

  // client/worker болон идэвхгүй хэрэглэгчийг сервер талд ХАСНА.
  // ⚠️ `PARTICIPANT_ROLES` (цагаан жагсаалт), `EXCLUDED_ROLES` (хар жагсаалт)
  //    БИШ.  Хар жагсаалт нь `admin`-г нэвтрүүлдэг байсан бөгөөд production
  //    дээр яг ЭНЭ гарцаар нэг админ 2-р раундад орж ирсэн (2026-08-06).
  //    Хамрах хүрээний бусад бүх зам `resolveCohortIds`-ээр явдаг тул энэ нь
  //    цагаан жагсаалтад шилжээгүй үлдсэн ганц гарц байлаа.
  const wantedIds = [...wanted.keys()];
  const allowedIds = new Set<number>();
  if (wantedIds.length) {
    const { results } = await db
      .prepare(
        `SELECT id FROM users
          WHERE id IN (${placeholders(wantedIds.length)})
            AND status = 'active'
            AND role IN (${placeholders(PARTICIPANT_ROLES.length)})`,
      )
      .bind(...wantedIds, ...PARTICIPANT_ROLES)
      .all<{ id: number }>();
    for (const row of results ?? []) allowedIds.add(row.id);
  }

  const { results: currentRows } = await db
    .prepare(`SELECT user_id FROM assessment_participants WHERE round_id = ?`)
    .bind(roundId)
    .all<{ user_id: number }>();
  const current = new Set((currentRows ?? []).map((r) => r.user_id));

  const stmts: D1PreparedStatement[] = [];

  // 1) Хасагдсан хүмүүс — draft маягт + оролцогчийн мөр устана.
  for (const userId of current) {
    if (allowedIds.has(userId)) continue;
    stmts.push(
      db
        .prepare(
          `DELETE FROM assessment_responses
            WHERE round_id = ? AND subject_user_id = ? AND status = 'draft'`,
        )
        .bind(roundId, userId),
      db
        .prepare(`DELETE FROM assessment_participants WHERE round_id = ? AND user_id = ?`)
        .bind(roundId, userId),
    );
  }

  // 2) Үлдсэн + шинэ хүмүүс — upsert, дараа нь маягтуудыг зэрэгцүүлнэ.
  for (const userId of allowedIds) {
    // Хэн ч өөрийгөө «ахлагчийн нүдээр» үнэлэхгүй.
    const evaluators = roundWide
      ? roundSeniors.filter((id) => id !== userId)
      : [wanted.get(userId) ?? null].filter((id): id is number => id !== null);
    const primary = evaluators[0] ?? null;

    stmts.push(
      db
        .prepare(
          `INSERT INTO assessment_participants (round_id, user_id, evaluator_user_id)
           VALUES (?, ?, ?)
           ON CONFLICT(round_id, user_id)
           DO UPDATE SET evaluator_user_id = excluded.evaluator_user_id`,
        )
        .bind(roundId, userId, primary),
      db
        .prepare(
          `INSERT OR IGNORE INTO assessment_responses
             (round_id, subject_user_id, evaluator_user_id, evaluator_kind)
           VALUES (?, ?, ?, 'self')`,
        )
        .bind(roundId, userId, userId),
    );

    // Жагсаалтаас хасагдсан ахлагчийн БӨГЛӨӨГҮЙ маягт устана; илгээснийг нь
    // хэзээ ч устгахгүй (тайлангийн өгөгдөл).
    if (evaluators.length) {
      stmts.push(
        db
          .prepare(
            `DELETE FROM assessment_responses
              WHERE round_id = ? AND subject_user_id = ? AND evaluator_kind = 'senior'
                AND status = 'draft'
                AND (evaluator_user_id IS NULL
                     OR evaluator_user_id NOT IN (${placeholders(evaluators.length)}))`,
          )
          .bind(roundId, userId, ...evaluators),
      );
      for (const evaluator of evaluators) {
        stmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO assessment_responses
                 (round_id, subject_user_id, evaluator_user_id, evaluator_kind)
               VALUES (?, ?, ?, 'senior')`,
            )
            .bind(roundId, userId, evaluator),
        );
      }
    } else {
      stmts.push(
        db
          .prepare(
            `DELETE FROM assessment_responses
              WHERE round_id = ? AND subject_user_id = ? AND evaluator_kind = 'senior'
                AND status = 'draft'`,
          )
          .bind(roundId, userId),
      );
    }
  }

  // Раунд даяарх сонголтыг раунд дээр нь тэмдэглэнэ (дараа нээхэд/засахад эх сурвалж).
  if (roundWide) {
    stmts.push(
      db
        .prepare(
          `UPDATE assessment_rounds SET senior_user_ids = ?, updated_at = datetime('now')
            WHERE id = ?`,
        )
        .bind(toJsonText(roundSeniors), roundId),
    );
  }

  await runBatched(db, stmts);

  const detail = await roundDetail(db, roundId);
  if (!detail) return c.json({ error: 'Not found' }, 404);
  return c.json({ round: detail });
});

// ---------------------------------------------------------------------------
// Админ — үр дүн
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// «Түвшин ахих зам» — `lib/assessmentGap.ts`-ийн гарцыг snake_case болгоно.
// ---------------------------------------------------------------------------

/**
 * ⚠️ Энэ хэлбэр нь ажилтны (`/my/results`) ба админы (`/rounds/:id/results*`)
 *    ХОЁУЛАНД нь ижил явна.  Ажилтанд нээлттэй байхад асуудалгүй гэдгийг
 *    (spec §3a) ингэж баталсан: доорх бүх тоо нь ажилтны ӨӨРИЙН хариулт,
 *    схемийн жин/шатлал, мөн аль хэдийн буцаадаг `pct` гурваас ГАРНА.
 *    Өөрөөр хэлбэл `covered`/`total_gain` нь ажилтны хувьд ШИНЭ мэдээлэл
 *    БИШ — тэр эдгээрийг өөрийн өгөгдлөөс аль хэдийн бодож чадна (I4-ийн
 *    баримтжуулсан хязгаартай ижил логик).  Бусад ХҮНИЙ ямар ч тоо энд
 *    ОРООГҮЙ бөгөөд оруулж БОЛОХГҮЙ (I2).
 */
function levelUpTargetOut(target: LevelUpTarget) {
  return {
    unit: target.unit,
    current: target.current,
    current_level: target.currentLevel,
    next_level: target.nextLevel,
    // Дээд түвшинд байгаа хүнд `next_level` null — UI «дутуу» гэж 0 БИШ,
    // «дараагийн түвшин байхгүй» гэж уншина.
    at_top_level: target.atTopLevel,
    gap: target.gap,
    total_gain: target.totalGain,
    covered: target.covered,
    steps: target.steps.map((g) => ({
      section_id: g.sectionId,
      code: g.code,
      title: g.title,
      weight: g.weight,
      from: g.from,
      to: g.to,
      item_count: g.itemCount,
      gain: g.gain,
      examples: g.examples,
    })),
  };
}

function levelUpSectionOut(section: SectionLevelUp) {
  return {
    section_id: section.sectionId,
    code: section.code,
    title: section.title,
    weight: section.weight,
    item_count: section.itemCount,
    leverage: section.leverage,
    ...levelUpTargetOut(section),
  };
}

function levelUpPartsOut(parts: PartLevelUpPlan[]) {
  return parts.map((part) => ({
    part_id: part.partId,
    title: part.title,
    weighted: part.weighted,
    overall: part.overall ? levelUpTargetOut(part.overall) : null,
    sections: part.sections.map(levelUpSectionOut),
  }));
}

/**
 * `ParticipantResult` (api.ts) хэлбэр — оноог `assessmentScore.ts` бодно.
 *
 * `includeLevelUp` нь ЗӨВХӨН нэг хүний дэлгэрэнгүй гарцад (`/rounds/:id/
 * results/:userId`) true.  Жагсаалтын гарц (`/rounds/:id/results`) нь
 * оролцогч БҮРИЙН төлөвлөгөөг цувуулах ба түүнийг ямар ч дэлгэц уншдаггүй —
 * 30 хүнтэй раундад хариултыг 3.6–5.2 дахин үлээлгэдэг тул хаалттай.
 */
function participantResult(
  schema: AssessmentSchema,
  row: ParticipantRow,
  selfRow: AssessmentResponseRow | undefined,
  seniorRows: (AssessmentResponseRow & { evaluator_name?: string | null })[],
  includeLevelUp = false,
) {
  // Spec §1: ЗӨВХӨН submitted тал оноонд ордог. Хагас бөглөсөн draft-ыг
  // тооцвол дундаж хиймлээр буурна. Хэд хэдэн ахлагч байвал ЗӨВХӨН
  // илгээсэн хэсэг нь оноонд орж, `scoreAssessment` тэднийг дундажилна.
  const selfAnswers = selfRow?.status === 'submitted' ? answersOf(selfRow.answers_json) : null;
  const submittedSeniorRows = seniorRows.filter((r) => r.status === 'submitted');
  const seniorAnswersList = submittedSeniorRows.map((r) => answersOf(r.answers_json));
  const sides = { self: selfAnswers, senior: seniorAnswersList };
  const score = scoreAssessment(schema, sides);
  // «Түвшин ахих зам» — ЯГ ижил `sides`-аас бодогдоно, тиймээс доорх
  // `overall_pct` ба `level_up.overall.current` хоёр хэзээ ч зөрөхгүй.
  // (Энэ гарц хувийг ТҮҮХИЙГЭЭР буцаадаг тул `roundPct` дамжуулахгүй —
  //  `/my/results` бол эсрэгээрээ, тэнд `pct1` заавал явна.)
  const levelUp = includeLevelUp && selfAnswers ? buildLevelUpPlan(schema, sides) : null;

  return {
    user_id: row.user_id,
    full_name: row.full_name,
    employee_id: row.employee_id,
    profile_image: row.profile_image,
    team_code: row.team_code,
    team_name_mn: row.team_name_mn,
    position: row.position,
    self_submitted: selfAnswers !== null,
    senior_submitted: submittedSeniorRows.length > 0,
    senior_submitted_count: submittedSeniorRows.length,
    senior_total_count: seniorRows.length,
    evaluator_name: row.evaluator_name,
    parts: score.parts.map((part) => ({
      part_id: part.partId,
      title: part.title,
      chart: part.chart,
      weighted: part.weighted,
      weight_sum: part.weightSum,
      overall_pct: part.overallPct,
      overall_level: part.overallLevel,
      totals: part.totals,
      sections: part.sections.map((s) => ({
        section_id: s.sectionId,
        code: s.code,
        title: s.title,
        weight: s.weight,
        item_count: s.itemCount,
        must: s.must,
        self: s.self,
        senior: s.senior,
        average: s.average,
        self_pct: s.selfPct,
        senior_pct: s.seniorPct,
        pct: s.pct,
        level: s.level,
      })),
    })),
    /**
     * Дараагийн түвшинд хүрэхэд ЯГ ЮУ ХИЙХ ВЭ — мөр түвшний зөвлөмж
     * (`lib/assessmentGap.ts`).  `self` илгээгээгүй бол null (юуг ахиулахыг
     * мэдэхгүй).  Дээд түвшинд байгаа хүнд `overall.at_top_level = true`
     * бөгөөд `steps` хоосон байна — тэнд «дараагийн түвшин» гэж байхгүй.
     */
    level_up: levelUp ? levelUpPartsOut(levelUp.parts) : null,
    // Excel-ийн дэлгэрэнгүй хуудсанд — оноонд орсон талуудын түүхий хариулт.
    // `senior` нь хэд хэдэн ахлагчийн (илгээсэн) хариултын массив — хэн
    // юу гэж хариулсныг ялгаж харуулахад (senior1/senior2 багана).
    answers: {
      self: selfAnswers ?? {},
      senior: seniorAnswersList,
    },
    // Ахлагч бүрийн нэр — dashboard/Excel-д "Ахлагч 1: <нэр>" гэх мэт харуулахад.
    senior_evaluators: seniorRows.map((r) => ({
      user_id: r.evaluator_user_id,
      full_name: r.evaluator_name ?? null,
      submitted: r.status === 'submitted',
    })),
  };
}

/**
 * Round-ын бүх маягтыг НЭГ query-ээр татаж, (subject → kind) болгож
 * бүлэглэнэ. `senior` нь одоо АРРАЙ — нэг ажилтныг хэд хэдэн ахлагч
 * зэрэгцэн үнэлж болно (migration 0142).
 */
async function fetchResponseIndex(db: D1Database, roundId: number) {
  const { results } = await db
    .prepare(
      `SELECT r.*, ev.full_name AS evaluator_name
         FROM assessment_responses r
         LEFT JOIN users ev ON ev.id = r.evaluator_user_id
        WHERE r.round_id = ?`,
    )
    .bind(roundId)
    .all<AssessmentResponseRow & { evaluator_name: string | null }>();
  const index = new Map<
    number,
    { self?: AssessmentResponseRow; senior: (AssessmentResponseRow & { evaluator_name: string | null })[] }
  >();
  for (const row of results ?? []) {
    const bucket = index.get(row.subject_user_id) ?? { senior: [] };
    if (row.evaluator_kind === 'self') bucket.self = row;
    else bucket.senior.push(row);
    index.set(row.subject_user_id, bucket);
  }
  return index;
}

// GET /api/assessments/rounds/:id/results — бүх оролцогчийн бүрэн үр дүн (admin).
assessments.get('/rounds/:id/results', async (c) => {
  const roundId = parseId(c.req.param('id'));
  if (roundId === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;

  const roundRow = await db
    .prepare(`${ROUND_SUMMARY_SQL} WHERE ro.id = ?`)
    .bind(roundId)
    .first<RoundSummaryRow>();
  if (!roundRow) return c.json({ error: 'Not found' }, 404);

  const schema = schemaOf(roundRow.schema_json);
  const participants = await fetchParticipants(db, roundId, true);
  const index = await fetchResponseIndex(db, roundId);

  const results = participants.map((p) => {
    const bucket = index.get(p.user_id) ?? { senior: [] };
    return participantResult(schema, p, bucket.self, bucket.senior);
  });

  return c.json({ round: roundSummary(roundRow), schema, results });
});

// GET /api/assessments/rounds/:id/results/:userId — нэг хүний дэлгэрэнгүй (admin).
assessments.get('/rounds/:id/results/:userId', async (c) => {
  const roundId = parseId(c.req.param('id'));
  const userId = parseId(c.req.param('userId'));
  if (roundId === null || userId === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;

  const roundRow = await db
    .prepare(`${ROUND_SUMMARY_SQL} WHERE ro.id = ?`)
    .bind(roundId)
    .first<RoundSummaryRow>();
  if (!roundRow) return c.json({ error: 'Not found' }, 404);

  const participants = await fetchParticipants(db, roundId, true);
  const row = participants.find((p) => p.user_id === userId);
  if (!row) return c.json({ error: 'Оролцогч олдсонгүй' }, 404);

  const schema = schemaOf(roundRow.schema_json);
  const index = await fetchResponseIndex(db, roundId);
  const bucket = index.get(userId) ?? { senior: [] };

  return c.json({
    round: roundSummary(roundRow),
    schema,
    result: participantResult(schema, row, bucket.self, bucket.senior, true),
  });
});

// ---------------------------------------------------------------------------
// Ажилтан / senior — надад оногдсон маягтууд
// ---------------------------------------------------------------------------

/** `/my` ба `/my/reviews`-ийн нэгдсэн мөр. */
interface AssignmentRow {
  response_id: number;
  round_id: number;
  evaluator_kind: EvaluatorKind;
  status: ResponseStatus;
  submitted_at: string | null;
  updated_at: string;
  answers_json: string;
  subject_user_id: number;
  subject_name: string;
  round_name: string;
  round_period: string;
  round_status: RoundStatus;
  schema_json: string;
  template_title: string;
}

const ASSIGNMENT_SQL = `
  SELECT r.id AS response_id, r.round_id, r.evaluator_kind, r.status, r.submitted_at,
         r.updated_at, r.answers_json, r.subject_user_id,
         su.full_name AS subject_name,
         ro.name AS round_name, ro.period AS round_period, ro.status AS round_status,
         ro.schema_json,
         tpl.title_mn AS template_title
    FROM assessment_responses r
    JOIN assessment_rounds ro ON ro.id = r.round_id
    JOIN assessment_templates tpl ON tpl.id = ro.template_id
    JOIN users su ON su.id = r.subject_user_id
   WHERE r.evaluator_user_id = ? AND r.evaluator_kind = ?
     AND ro.status IN ('open', 'closed')
     AND su.status = 'active'
   ORDER BY ro.created_at DESC, su.full_name ASC, r.id DESC`;
/* `AND su.status = 'active'` (2026-08-19) — ҮНЭЛҮҮЛЭГЧ идэвхгүй болбол түүний
 * маягт хэн ч бөглөх ёсгүй.  Үүнгүйгээр ажлаас гарсан хүний ноорог маягт
 * ахлагчийн «Миний үнэлэх хүмүүс» жагсаалтад үүрд өлгөөтэй үлдэж, профайл
 * дээрх «бөглөөгүй» тоолуур (`usePendingAssessmentCount`) хэзээ ч тэглэгдэхгүй.
 * ⚠️ Энэ нь `su` (subject) талын шүүлт — `r.evaluator_user_id` талыг шүүхгүй:
 *    өөрөө идэвхгүй болсон хүн ямар ч байсан нэвтэрч чадахгүй, харин түүний
 *    ИЛГЭЭСЭН үнэлгээ бусдын оноонд үлдэх ёстой. */

/** Маягтын жагсаалтыг `AssessmentAssignment[]` болгоно (схемийг round тус бүрд нэг л удаа парслана). */
function assignmentsOut(rows: AssignmentRow[]) {
  const schemaCache = new Map<number, AssessmentSchema>();
  return rows.map((row) => {
    let schema = schemaCache.get(row.round_id);
    if (!schema) {
      schema = schemaOf(row.schema_json);
      schemaCache.set(row.round_id, schema);
    }
    return {
      response_id: row.response_id,
      round_id: row.round_id,
      round_name: row.round_name,
      round_period: row.round_period,
      round_status: row.round_status,
      template_title: row.template_title,
      subject_user_id: row.subject_user_id,
      subject_name: row.subject_name,
      evaluator_kind: row.evaluator_kind,
      status: row.status,
      submitted_at: row.submitted_at,
      updated_at: row.updated_at,
      answered_count: countAnswered(schema, answersOf(row.answers_json)),
      total_count: schemaItemCount(schema),
    };
  });
}

// GET /api/assessments/my — өөрийн бөглөх маягтууд.
assessments.get('/my', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(ASSIGNMENT_SQL)
    .bind(user.sub, 'self')
    .all<AssignmentRow>();
  return c.json({ assignments: assignmentsOut(results ?? []) });
});

// GET /api/assessments/my/reviews — багийн ахлагчийн үнэлэх хүмүүс.
assessments.get('/my/reviews', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(ASSIGNMENT_SQL)
    .bind(user.sub, 'senior')
    .all<AssignmentRow>();
  return c.json({ assignments: assignmentsOut(results ?? []) });
});

// ---------------------------------------------------------------------------
// `/my/results`-ийн туслахууд (2026-08: ажилтан ӨӨРИЙН хувиа харна)
// ---------------------------------------------------------------------------

/** Хувийг 1 аравтын орон хүртэл бөөрөнхийлнө (харуулах нарийвчлал). */
function pct1(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 10) / 10;
}

/**
 * Дараагийн шатлал хүртэлх зөрүү. ХАРУУЛСАН (1 аравтын орон хүртэл
 * бөөрөнхийлсөн) хувиас бодно — ингэснээр дэлгэц дээрх арифметик таарна
 * («78.4% + 6.6% = 85%»), бөөрөнхийллийн 0.1-ийн зөрүү гарахгүй.
 */
function gapOut(shownPct: number | null, next: AssessmentLevelBand | null): number | null {
  if (shownPct === null || !next) return null;
  return pct1(Math.max(0, next.minPct - shownPct));
}

/**
 * ХАРУУЛАХ гурвал: бөөрөнхийлсөн хувь + түүнээс гарсан одоогийн шатлал,
 * дараагийн шатлал, хүртэлх зөрүү.
 *
 * ⚠️ ДӨРВҮҮЛЭЭ ЯГ НЭГ тооноос гарна: ЭХЛЭЭД бөөрөнхийлж (`pct1`), ДАРАА нь
 *    band-д хуваарилна.  Түүхий хувиас band-ыг, бөөрөнхийлсөнөөс зөрүүг бодвол
 *    band бүрийн ирмэгийн доод 0.05-ийн цонхонд карт ӨӨРТЭЙГӨӨ ЗӨРЧИЛДӨНӨ —
 *    жишээ нь түүхий 84.96 үед «85.0%, Middle, Senior хүртэл 0.0%» гээд
 *    LevelLadder-ийн Senior band нь (85.0 ≥ 85) аль хэдийн асчихсан байдаг.
 *    Тиймээс энэ туслахыг ТОЙРЧ `levelForPct`/`nextLevelFor`-ыг түүхий хувь
 *    дээр шууд дуудаж болохгүй (`/my/results` дотор).
 */
function shownBands(levels: AssessmentLevelBand[], raw: number | null) {
  const pct = pct1(raw);
  const level = levelForPct(levels, pct);
  const next = nextLevelFor(levels, pct);
  return { pct, level, next, gap: gapOut(pct, next) };
}

/**
 * GET /api/assessments/my/results — ажилтны ӨӨРИЙН үр дүн.
 *
 * ⚠️ ХИЛ НЬ 2026-08-д ӨӨРЧЛӨГДСӨН (эзний зөвшөөрөл). Өмнө нь энэ гарц
 * ЯМАР Ч хувь буцаадаггүй, зөвхөн level-ийн нэр/өнгө өгдөг байсан. Одоо
 * ажилтан ӨӨРИЙН хувь, ӨӨРИЙН түвшин, дараагийн түвшинд хүрэхэд хэдэн
 * хувь дутуу байгааг хардаг. Энэ нь «дутуу мэдээлэл» байсан гэж үзэж
 * нээсэн зүйл — буцааж хаах хэрэггүй.
 *
 * ГЭХДЭЭ хил нь АРИЛААГҮЙ, зөвхөн НАРИЙССАН: **зөвхөн өөрийн**. Дараах
 * таван инвариантыг зөрчих ямар ч өөрчлөлт нь энэ шийдвэрийн ГАДНА:
 *
 *   I1. Энэ query-ийн `subject_user_id` нь ҮРГЭЛЖ `user.sub`-т bind
 *       хийгдэнэ. `?user_id=` / `?subject=` маягийн параметр ХЭЗЭЭ Ч
 *       нэмэхгүй — тэр агшинд гарц нь «өөрийн» байхаа болино.
 *   I2. Rank / percentile / cohort / «багийн дундаж» талбар нэмэхгүй.
 *       Эдгээр нь бусад ажилтны оноог ШУУД БУС задруулна. (`benchmark`
 *       цуврал нь frontend-ийн ЗӨВХӨН `assessments/admin/*` хуудсуудад
 *       дамждаг — тэр байдлаараа үлдэнэ.)
 *   I3. `/rounds/*` (бусдын үр дүн) `requireAdmin()` доор хэвээр.
 *   I4. **`senior` бол admin БИШ.** Ахлагч өөрийн бөглөсөн түүхий
 *       хариултаа `/responses/:id`-ээр хардаг ч, үнэлж буй хүнийхээ
 *       БОДОГДСОН хувийг хардаггүй — тэр зөвхөн admin-д.
 *   I5. Зан чанарын (weighted:false) хэсэгт pct ОГТ гаргахгүй. Тэнд
 *       үнэлгээ нь 1.0–5.0 дундаж (`BEHAVIOR_BANDS`) — өөр системийн
 *       хэмжигдэхүүнийг хувь мэт харуулбал хүн өөрийгөө буруу үнэлнэ.
 *       Тиймээс тэнд `mean` + дараагийн шатлал хүртэлх зөрүү л явна.
 *
 * Тоог энд ШИНЭЭР бододоггүй — `scoreAssessment()` аль хэдийн бүгдийг
 * бодсон байдаг, өмнө нь энэ mapper түүнийг хаядаг байсан.  Гагцхүү
 * ХАРУУЛАХ бөөрөнхийлөлт нь `shownBands()`-аар дамжина (доорхыг үз).
 *
 * ⚠️ ТАЛБАР БУЦААХГҮЙ ≠ МЭДЭЭЛЭЛ НУУГДАНА — I4-ийг НАРИЙВЧЛАН УНШ
 *    (2026-08-10, review-ээр илэрсэн; ЗОРИУДААР хүлээн зөвшөөрсөн хязгаар):
 *      · ахлагч илгээхээс ӨМНӨ `average = self` тул буцааж буй `pct` нь яг
 *        ажилтны ӨӨРИЙН self-хувь — задруулах зүйлгүй ч «дүгнэгдсэн үр дүн»
 *        БИШ.  UI үүнийг «түр зуурын» гэж заавал тэмдэглэнэ
 *        (`assessments.myResultPending`, LevelProgressCard + MyResultChartsPage).
 *      · ахлагч илгээсний ДАРАА `pct = (self + senior) / 2`.  Ажилтан өөрийн
 *        хариултаа `GET /responses/:id`-ээр (эзний эрхээр) уншиж `self_pct`-ээ
 *        бодож чадах тул `senior_pct = 2 × pct − self_pct` гэж СЭРГЭЭГДЭНЭ.
 *        Өөрөөр хэлбэл I4-ийн «ахлагчийн багана нууц» гэдэг нь ажилтан
 *        ӨӨРИЙН тоог хардаг энэ дэглэмд МАТЕМАТИКААР баталгаажихгүй.  Жинхэнэ
 *        хаах цорын ганц зам бол жигнэсэн хувийг огт буцаахгүй байх — тэр нь
 *        2026-08-ны бүтээгдэхүүний шийдвэрийг буцаана гэсэн үг тул кодоор дур
 *        мэдэн хийхгүй.  Шинэ тоон талбар нэмэхийн өмнө энэ хязгаарыг эргэж унш.
 */
assessments.get('/my/results', async (c) => {
  const user = c.get('user');

  interface MyRow {
    round_id: number;
    evaluator_kind: EvaluatorKind;
    status: ResponseStatus;
    submitted_at: string | null;
    answers_json: string;
    round_name: string;
    round_period: string;
    round_created_at: string;
    round_status: RoundStatus;
    schema_json: string;
  }

  const { results } = await c.env.DB.prepare(
    `SELECT r.round_id, r.evaluator_kind, r.status, r.submitted_at, r.answers_json,
            ro.name AS round_name, ro.period AS round_period,
            ro.created_at AS round_created_at, ro.status AS round_status, ro.schema_json
       FROM assessment_responses r
       JOIN assessment_rounds ro ON ro.id = r.round_id
      WHERE r.subject_user_id = ?
      ORDER BY ro.created_at DESC, ro.id DESC`,
  )
    .bind(user.sub)
    .all<MyRow>();

  // round бүрээр бүлэглэнэ (эрэмбэ хадгалагдана). `senior` нь АРРАЙ — нэг
  // round-д хэд хэдэн ахлагч зэрэгцэн үнэлж болно (migration 0142).
  const byRound = new Map<number, { meta: MyRow; self?: MyRow; senior: MyRow[] }>();
  for (const row of results ?? []) {
    const bucket = byRound.get(row.round_id) ?? { meta: row, senior: [] };
    if (row.evaluator_kind === 'self') bucket.self = row;
    else bucket.senior.push(row);
    byRound.set(row.round_id, bucket);
  }

  const rounds = [];
  for (const bucket of byRound.values()) {
    const selfRow = bucket.self;
    // Өөрөө илгээгээгүй бол үр дүн үзүүлэхгүй.
    if (!selfRow || selfRow.status !== 'submitted') continue;

    const schema = schemaOf(bucket.meta.schema_json);
    const submittedSeniorRows = bucket.senior.filter((r) => r.status === 'submitted');
    const levels = schema.levels?.length ? schema.levels : DEFAULT_LEVELS;
    const sides = {
      self: answersOf(selfRow.answers_json),
      senior: submittedSeniorRows.map((r) => answersOf(r.answers_json)),
    };
    const score = scoreAssessment(schema, sides);
    /**
     * «Дараагийн түвшинд юу дутуу вэ» — мөр түвшний ТОДОРХОЙ төлөвлөгөө.
     *
     * I1–I5 зөрчихгүй гэдгийг `levelUpTargetOut`-ийн толгойд баталсан:
     * бүх тоо нь ЭНЭ ажилтны өөрийн хариулт + схемийн жин/шатлалаас гарна,
     * бусад хүний өгөгдөл огт оролцохгүй.  Дээд түвшинд байгаа хүнд
     * `at_top_level: true` бөгөөд `steps` хоосон — «0% дутуу» гэсэн
     * төөрөгдүүлсэн мөр гарахгүй.
     *
     * ⚠️ `roundPct`-ийг ЗААВАЛ дамжуулна.  Энэ гарцын бусад БҮХ хувь
     *    `shownBands()`-аар (эхлээд `pct1`, дараа нь band) явдаг тул
     *    төлөвлөгөө нь ТҮҮХИЙ хувь дээр band хуваарилвал band-ын ирмэгийн
     *    0.05-ийн цонхонд нэг хариултын дотор ХОЁР өөр түвшин зэрэг гарна
     *    (түүхий 84.96 → «85.0% Senior» ба «Middle, Senior хүртэл 0.0%»).
     */
    const levelUp = buildLevelUpPlan(schema, sides, { roundPct: (v) => pct1(v) ?? v });

    // Зан чанарын (weighted: false) part-д pct-суурьт level байхгүй — spec §1.
    const weightedParts = score.parts.filter((part) => part.weighted);

    /**
     * Ур чадварын хэсгийн «түвшин + дараагийн түвшин хүртэлх зөрүү».
     *
     * ⚠️ Тоонууд нь `shownBands()`-аар дамжина — ЭХЛЭЭД бөөрөнхийлж, ДАРАА нь
     *    band-д хуваарилна.  Түүхий хувиас band-ыг, бөөрөнхийлсөнөөс зөрүүг
     *    бодвол band бүрийн ирмэгийн 0.05-ийн цонхонд карт ӨӨРТЭЙГӨӨ
     *    ЗӨРЧИЛДӨНӨ (түүхий 84.96 → «85.0%, Middle, Senior хүртэл 0.0%»).
     */
    const skillLevelBlock = (s: SectionScore | { pct: number | null }) => {
      const shown = shownBands(levels, s.pct);
      return {
        // ЗӨВХӨН ӨӨРИЙН хувь (I1/I2) — бусадтай харьцуулах ямар ч талбар алга.
        pct: shown.pct,
        level_code: shown.level?.code ?? null,
        level_label: shown.level?.label ?? null,
        level_color: shown.level?.color ?? null,
        next_level_code: shown.next?.code ?? null,
        next_level_label: shown.next?.label ?? null,
        next_level_color: shown.next?.color ?? null,
        next_level_min_pct: shown.next?.minPct ?? null,
        // Хамгийн дээд түвшинд (EXPERT) байгаа хүнд null — «дутуу» гэж
        // 0 харуулбал дээд түвшинд хүрсэн нь ойлгогдохгүй.
        pct_to_next: shown.gap,
      };
    };

    const sections = weightedParts.flatMap((part) =>
      part.sections.map((s) => ({
        section_id: s.sectionId,
        code: s.code,
        title: s.title,
        weight: s.weight,
        ...skillLevelBlock(s),
      })),
    );

    // Сул / хүчтэй 3 хэсэг — зөвхөн жинтэй, хувь нь бодогдсон хэсгүүдээс.
    // ⚠️ Эрэмбэ нь ЖИНГЭЭР жигнэгдэнэ: shortfall = (100 − pct) × weight.
    //    Detail Drawing (жин 40) сул байвал Collaborate (жин 6) сулаас ӨМНӨ
    //    гарна — «юуг нь түрүүлж засах вэ» гэдэг нийт хувьд үзүүлэх нөлөөгөөр
    //    шийдэгдэх ёстой, зөвхөн хувийн хэмжээгээр биш.
    const rankPool = weightedParts.flatMap((part) =>
      part.sections.flatMap((s) => {
        if (s.pct === null) return [];
        const raw = s.pct;
        const shortfall = (100 - raw) * (s.weight || 0);
        const shown = shownBands(levels, raw);
        return [
          {
            raw,
            shortfall,
            out: {
              section_id: s.sectionId,
              code: s.code,
              title: s.title,
              pct: shown.pct,
              weight: s.weight,
              level_code: shown.level?.code ?? null,
              level_label: shown.level?.label ?? null,
              level_color: shown.level?.color ?? null,
              shortfall: pct1(shortfall),
            },
          },
        ];
      }),
    );
    // ⚠️ «Сул 3» нь ЗАСАХ ЗҮЙЛТЭЙ хэсгүүд л байна — 100%-д хүрсэн хэсэг
    //    3 хүрэхгүй байгаа жагсаалтыг «дүүргэж» болохгүй (эзэмшсэн чадвар
    //    «Сайжруулах чадвар» гарчиг доор, зэрэгцээ «Хүчтэй» самбарт нэгэн
    //    зэрэг гарч ирнэ).  Жин 0 хэсгийн shortfall нь хувиас үл хамааран 0
    //    тул зөвхөн shortfall-аар шүүвэл жинхэнэ сул (жишээ 5%) хэсэг ч
    //    хасагдана — тиймээс шүүлт нь «хувь < 100», эрэмбэ нь shortfall,
    //    тэнцвэл ЖИНХЭНЭ хувиар (бага нь эхэнд).
    const weakest = [...rankPool]
      .filter((r) => r.raw < 100)
      .sort((a, b) => b.shortfall - a.shortfall || a.raw - b.raw)
      .slice(0, 3)
      .map((r) => r.out);
    const strongest = [...rankPool]
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 3)
      .map((r) => r.out);

    // Level-band график зурахад: weighted эсэхээс үл хамааран БҮХ part.
    // ⚠️ weighted part (ур чадвар) → schema.levels-ийн pct-суурьт band
    //    (`s.level`, EXPERT/SENIOR/MIDDLE/JUNIOR/INTERN).
    //    non-weighted part (зан чанар) → 1.0-5.0 дундаж-суурьт
    //    BEHAVIOR_BANDS (Илрэхгүй/Тогтворгүй/Суурь хангасан/Тогтвортой/
    //    Үлгэр жишээ) — `s.level` ХЭРЭГЛЭХГҮЙ, тэр pct-ээс бодогдсон өөр
    //    системийн шошго тул зан чанарт буруу үг хэллэг өгнө.
    const parts = score.parts.map((part) => {
      const partShown = part.weighted ? shownBands(levels, part.overallPct) : null;
      return {
        part_id: part.partId,
        title: part.title,
        chart: part.chart,
        weighted: part.weighted,
        // Part-ын нийт хувь — зөвхөн weighted part-д утгатай (зан чанарын
        // part-д Σ(pct × weight) гэж юу ч байхгүй, тэнд дундаж л бий).
        overall_pct: partShown?.pct ?? null,
        overall_level_code: partShown?.level?.code ?? null,
        overall_level_label: partShown?.level?.label ?? null,
        overall_level_color: partShown?.level?.color ?? null,
        overall_next_level_label: partShown?.next?.label ?? null,
        overall_next_level_min_pct: partShown?.next?.minPct ?? null,
        overall_pct_to_next: partShown?.gap ?? null,
        sections: part.sections.map((s) => {
          if (part.weighted) {
            return {
              section_id: s.sectionId,
              code: s.code,
              title: s.title,
              weight: s.weight,
              ...skillLevelBlock(s),
            };
          }
          // I5: зан чанарт pct БИШ, 1.0–5.0 дундаж.
          const mean = s.itemCount > 0 && s.average != null ? s.average / s.itemCount : null;
          const band = bandForMean(mean);
          const nextBand = nextBandForMean(mean);
          return {
            section_id: s.sectionId,
            code: s.code,
            title: s.title,
            weight: null,
            pct: null,
            level_code: band?.code ?? null,
            level_label: band?.label ?? null,
            level_color: band?.color ?? null,
            next_level_code: nextBand?.code ?? null,
            next_level_label: nextBand?.label ?? null,
            next_level_color: nextBand?.color ?? null,
            next_level_min_pct: null,
            pct_to_next: null,
            // Зан чанарын хэмжигдэхүүнүүд — pct-ийн ОРОНД эдгээрийг харуулна.
            mean,
            scale_max: s.itemCount > 0 ? s.must / s.itemCount : null,
            next_band_min_mean: nextBand?.minMean ?? null,
            mean_to_next: nextBand && mean !== null ? nextBand.minMean - mean : null,
          };
        }),
      };
    });

    // Раундын нийт хувь — weighted part-уудын дундаж (`scoreAssessment`).
    const overall = shownBands(levels, score.overallPct);

    rounds.push({
      round_id: bucket.meta.round_id,
      round_name: bucket.meta.round_name,
      round_period: bucket.meta.round_period,
      round_status: bucket.meta.round_status,
      submitted_at: selfRow.submitted_at,
      senior_submitted: submittedSeniorRows.length > 0,
      overall_pct: overall.pct,
      overall_level_code: overall.level?.code ?? null,
      overall_level_label: overall.level?.label ?? null,
      overall_level_color: overall.level?.color ?? null,
      overall_next_level_code: overall.next?.code ?? null,
      overall_next_level_label: overall.next?.label ?? null,
      overall_next_level_min_pct: overall.next?.minPct ?? null,
      overall_pct_to_next: overall.gap,
      // Жингээр эрэмбэлсэн «юуг түрүүлж засах вэ» / «юу нь хүчтэй вэ» —
      // ЗӨВХӨН өөрийн хэсгүүд (I2-ыг зөрчихгүй: бусадтай харьцуулалт алга).
      weakest,
      strongest,
      sections,
      levels,
      parts,
      level_up: levelUpPartsOut(levelUp.parts),
    });
  }

  return c.json({ rounds });
});

// ---------------------------------------------------------------------------
// Маягт бөглөх (эзэн) — татах / autosave / илгээх
// ---------------------------------------------------------------------------

interface ResponseJoinRow extends AssessmentResponseRow {
  round_name: string;
  round_period: string;
  round_status: RoundStatus;
  schema_json: string;
  subject_name: string;
}

async function loadResponse(db: D1Database, id: number): Promise<ResponseJoinRow | null> {
  const row = await db
    .prepare(
      `SELECT r.*, ro.name AS round_name, ro.period AS round_period,
              ro.status AS round_status, ro.schema_json,
              su.full_name AS subject_name
         FROM assessment_responses r
         JOIN assessment_rounds ro ON ro.id = r.round_id
         JOIN users su ON su.id = r.subject_user_id
        WHERE r.id = ?`,
    )
    .bind(id)
    .first<ResponseJoinRow>();
  return row ?? null;
}

// GET /api/assessments/responses/:id — схем + хариулт.  Эзэн, эсвэл admin (зөвхөн УНШИНА).
assessments.get('/responses/:id', async (c) => {
  const user = c.get('user');
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);

  const row = await loadResponse(c.env.DB, id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.evaluator_user_id !== user.sub && !isAdminRole(user.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return c.json({
    response: {
      id: row.id,
      round_id: row.round_id,
      round_name: row.round_name,
      round_period: row.round_period,
      round_status: row.round_status,
      subject_user_id: row.subject_user_id,
      subject_name: row.subject_name,
      evaluator_kind: row.evaluator_kind,
      status: row.status,
      submitted_at: row.submitted_at,
      answers: answersOf(row.answers_json),
      schema: schemaOf(row.schema_json),
      // Admin ЗӨВХӨН УНШИЖ болно (дээрх шалгалт) — `assertWritable` эзэн
      // биш бол PUT/submit-ийг 403-оор хааж байгааг клиент урьдчилж мэдэж,
      // wizard-аа зөвхөн харах горимд оруулах ёстой (эс бөгөөс fields нь
      // ажиллах мэт харагдаад autosave чимээгүй 403-даж, хариулт бүрмөсөн
      // алга болно).
      is_owner: row.evaluator_user_id === user.sub,
    },
  });
});

/** Бичих эрх: ЗӨВХӨН эзэн, зөвхөн draft маягт, зөвхөн нээлттэй ээлж. */
function assertWritable(row: ResponseJoinRow, userId: number) {
  if (row.evaluator_user_id !== userId) return { code: 403 as const, error: 'Forbidden' };
  if (row.status !== 'draft') {
    return { code: 409 as const, error: 'Маягт аль хэдийн илгээгдсэн — засах боломжгүй' };
  }
  if (row.round_status !== 'open') {
    return { code: 409 as const, error: 'Судалгаа нээлттэй биш байна' };
  }
  return null;
}

// PUT /api/assessments/responses/:id — autosave.
assessments.put('/responses/:id', async (c) => {
  const user = c.get('user');
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);

  const row = await loadResponse(c.env.DB, id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const blocked = assertWritable(row, user.sub);
  if (blocked) return c.json({ error: blocked.error }, blocked.code);

  const body = await c.req.json().catch(() => ({}));
  const schema = schemaOf(row.schema_json);
  // Схемд байхгүй түлхүүр, тоо биш утга, хязгаараас гарсан оноо энд шүүгдэнэ.
  const answers = sanitizeAnswers(body.answers, schema);
  const answersJson = JSON.stringify(answers);
  if (utf8Length(answersJson) > MAX_ANSWERS_BYTES) {
    return c.json({ error: 'Хариулт хэт урт байна' }, 413);
  }

  await c.env.DB.prepare(
    `UPDATE assessment_responses
        SET answers_json = ?, updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(answersJson, id)
    .run();

  const updated = await c.env.DB.prepare(
    `SELECT updated_at FROM assessment_responses WHERE id = ?`,
  )
    .bind(id)
    .first<{ updated_at: string }>();

  return c.json({
    ok: true,
    updated_at: updated?.updated_at ?? null,
    answered_count: countAnswered(schema, answers),
  });
});

// POST /api/assessments/responses/:id/submit — эцэслэн илгээх.
//   БҮХ мөрд хариулсан байх ЁСТОЙ — хагас маягт 422-оор буцаана.
assessments.post('/responses/:id/submit', async (c) => {
  const user = c.get('user');
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;

  const row = await loadResponse(db, id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const blocked = assertWritable(row, user.sub);
  if (blocked) return c.json({ error: blocked.error }, blocked.code);

  // Бүх асуултад хариулсан эсэхийг СЕРВЕР талд шалгана — хагас маягт илгээгдэхгүй.
  const schema = schemaOf(row.schema_json);
  const answers = answersOf(row.answers_json);
  const total = schemaItemCount(schema);
  const answered = countAnswered(schema, answers);
  if (answered < total) {
    return c.json(
      {
        error: 'Бүх асуултад хариулаагүй байна',
        code: 'ASSESSMENT_INCOMPLETE',
        remaining: total - answered,
        answered,
        total,
      },
      422,
    );
  }

  await db
    .prepare(
      `UPDATE assessment_responses
          SET status = 'submitted', submitted_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ? AND status = 'draft'`,
    )
    .bind(id)
    .run();

  const saved = await db
    .prepare(`SELECT submitted_at FROM assessment_responses WHERE id = ?`)
    .bind(id)
    .first<{ submitted_at: string | null }>();

  // Ажилтан өөрийн үнэлгээгээ илгээмэгц ХЭД ХЭДЭН ахлагч байвал БҮГДЭД нь
  // мэдэгдэнэ (migration 0142 — нэг субьектэд олон 'senior' мөр байж болно).
  if (row.evaluator_kind === 'self') {
    const { results: seniors } = await db
      .prepare(
        `SELECT DISTINCT evaluator_user_id FROM assessment_responses
          WHERE round_id = ? AND subject_user_id = ? AND evaluator_kind = 'senior'
            AND evaluator_user_id IS NOT NULL`,
      )
      .bind(row.round_id, row.subject_user_id)
      .all<{ evaluator_user_id: number }>();
    await Promise.all(
      (seniors ?? [])
        .filter((s) => s.evaluator_user_id !== user.sub)
        .map((s) =>
          createNotification(
            db,
            s.evaluator_user_id,
            'assessment_submitted',
            'Ажилтан үнэлгээгээ илгээлээ',
            `${row.subject_name} — ${row.round_name}. Таны үнэлгээг хүлээж байна`,
            ASSESSMENT_LINK,
          ),
        ),
    );
  }

  return c.json({ ok: true, submitted_at: saved?.submitted_at ?? null });
});

export default assessments;
