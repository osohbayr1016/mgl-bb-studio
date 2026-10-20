import { Hono } from 'hono';
import { ADMIN_ROLES } from '../types';
import type { Env, AppVariables, UserRole } from '../types';
import { requireAdmin, requireManager, requireRole } from '../middleware/auth';
import {
  CASE_CLASSES,
  CONFLICT_KINDS,
  EXPECT_VERDICTS,
  SEVERITIES,
  SEVERITY_RANK,
  TEST_SOURCE_KINDS,
  emptyBuildContext,
  factNamesOf,
  isBoundaryLocation,
  isCaseClass,
  isConflictKind,
  isConflictPrecedence,
  isCoordinateSystem,
  isExpectVerdict,
  isHeightBasis,
  isIssueClass,
  isProjectPhase,
  isSeverity,
  isTestSourceKind,
  isUnit,
  isVerificationState,
  normalizeConflictPair,
  semanticHash,
  type BuildContext,
  type ConflictEntry,
  type Severity,
} from '../lib/complianceModel';
import {
  LINK_TRANSFORM_CAPABILITY_SHIPPED,
  PACK_CONTRACT,
  RULE_COLUMNS,
  buildPack,
  parseRuleRow,
  validateRuleForPack,
  type ParsedRule,
  type RuleDbRow,
} from '../lib/rulePack';
// ⚠️ `bim.compliance.*` дугуйнуудын ЦОРЫН ГАНЦ уншигч (0228 + 0230).  Энд
//    ДАХИН зарлахгүй — 0228-ийн толгойн «уншигчгүй дугуй бүү үлдээ» дүрмийн
//    хос нь «ХОЁР УНШИГЧ бүү үүсгэ»: хоёр анхдагч орших нь эзэн D1 дээр
//    утга солиход зөвхөн НЭГ тал өөрчлөгдөх өдөр л илэрнэ.
import { loadComplianceConfig } from './learning';
// ⚠️ 2-6 · v2 §79/§80 ЧАДВАРЫН БҮРТГЭЛИЙН УНШИГЧ.  Эрхийн түвшний НЭР ба
//    ЭРХҮҮД нь `lib/complianceAuthority.ts`-д амьдардаг ба `modelCapability`
//    түүнээс RE-EXPORT-лон уншина — ЭНД хоёр дахь `AUTHORITY_CAPS`
//    ЗАРЛАХГҮЙ.  Хоёр таазан хүснэгт орших нь `surface` нэг талдаа true,
//    нөгөө талдаа false болох өдөр л илэрнэ.
import {
  MAX_GRANTABLE_AUTHORITY,
  MAX_SCHEMA_AUTHORITY,
  assertCapability,
  authorityLevelOf,
  capsOf,
  evalRunApproves,
  grantedLevelOf,
  isCapabilityStatus,
} from '../lib/modelCapability';
// ⚠️ `team_code` ХЭЛБЭРИЙН шалгалт — `teams`-ийн АМЬД мөртэй хамт ХОЁР
//    ДАВХАР.  Найман салбарын жагсаалтыг ЭНД ХЭЗЭЭ Ч бичихгүй.
import { isTeamCodeShape } from '../lib/teamContext';

/**
 * НИЙЦЛИЙН ДҮРМИЙН ЗАГВАРЫН HTTP ГАРЦ — `2-2-rule-model` (миграц 0220–0223).
 *
 * ⚠️ ЭНЭ ФАЙЛЫГ ЗУРГААН СЕСС ХУВААЛЦАНА.  Буулгах ЦУВАА (README.md):
 *     2-2 → 2-4 → 2-3 → 2-6 → 2-5 → 2-7
 * Дараагийн сесс бүр өөрийн МАРШРУТАА ФАЙЛЫН ТӨГСГӨЛД нэмнэ, дээрхийг
 * ХӨНДӨХГҮЙ.  `new Hono()`, `use('*')` хамгаалалт, `export default` нь
 * ЭНЭ СЕССИЙНХ — ДАХИН зарлахгүй.
 *
 * ⚠️ `lib/workerScope.ts`-д `/api/compliance`-ЫГ НЭМЭХГҮЙ.
 * `WORKER_ALLOWED_PREFIXES` нь ЦАГААН ЖАГСААЛТ — нэмэхгүй байх нь `worker`
 * role-ыг ЗӨВ ХААНА.  Нэмэх нь хаахгүй, НЭЭНЭ.
 *
 * ⚠️ MCP ХОС ГАРЦ ҮҮСГЭХГҮЙ.  `/mcp` нь root зам бөгөөд `workerScopeGuard`,
 * `entitlementGuard`, tenant `tid` шалгалт — ГУРВУУЛАНГ НЬ зэрэг тойрдог
 * (`routes/learning.ts`-ийн толгойд бүтнээр бичигдсэн).
 *
 * ⚠️ `withEdgeCache` ЭНД ХЭРЭГЛЭХГҮЙ.  `/pack` нь `?have=` товчлолоор
 * ажиллана — edge cache нэмбэл багцын хувилбарыг хуучин болгож, инженерүүд
 * өөр өөр дүрмээр ажиллана.
 */

/** Эрх: `routes/learning.ts`-ийн ЯГ ИЖИЛ дөрвөн үүрэг.  `client` энд 403;
 *  `worker` нь `lib/workerScope.ts`-ийн хаалттай-анхдагч цагаан жагсаалтаар
 *  АВТОМАТААР 403. */
const COMPLIANCE_ROLES: UserRole[] = ['engineer', 'architect', 'senior', 'admin'];

const MAX_STR = 256;
const MAX_TEXT = 8 * 1024;
const MAX_JSON = 32 * 1024;

/**
 * §67 — НИЙТЛЭХ ХААЛГА.  `CRITICAL` дүрэм нь `HUMAN_VERIFIED` БАС таван
 * заавал ёстой тест кейсгүйгээр ХЭЗЭЭ Ч `published` болохгүй.
 */
const MIN_TESTS_BY_SEVERITY: Record<Severity, number> = {
  CRITICAL: 5, HIGH: 5, MEDIUM: 3, LOW: 1, INFO: 0,
};

/** §63-ын гол таван кейс — `CRITICAL` / `HIGH` дүрэмд ЗААВАЛ. */
const REQUIRED_CASE_CLASSES = [
  'threshold_minus', 'threshold', 'threshold_plus', 'zero', 'missing_input',
] as const;

/**
 * ⚠️ КООРДИНАТЫН ХААЛГА — `lib/rulePack.ts`-ийн ижил нэртэй тогтмолын ХОС.
 * Маршрут нь ЗОХИОГЧИЙГ хаана, `rulePack.ts` нь ӨГӨГДЛИЙН САНГИЙН БОДИТ
 * ТӨЛӨВИЙГ хаана (гараар `UPDATE rules SET status='published'` хийсэн мөр).
 * Давхардал биш — хоёр өөр халдлагын зам.
 */
const LINK_TRANSFORM_CAPABILITY_SHIPPED_ROUTE = LINK_TRANSFORM_CAPABILITY_SHIPPED;

const compliance = new Hono<{ Bindings: Env; Variables: AppVariables }>();

compliance.use('*', requireRole(...COMPLIANCE_ROLES));

/* ================================================================== */
/*  Туслахууд                                                          */
/* ================================================================== */

function str(v: unknown, max = MAX_STR): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > max ? s.slice(0, max) : s;
}

function strOrNull(v: unknown, max = MAX_STR): string | null {
  const s = str(v, max);
  return s.length > 0 ? s : null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** JSON бичвэрийг хүлээж авна — обьект/цуваа хоёулаа мөр болж хадгалагдана. */
function jsonText(v: unknown, fallback: string): string | null {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'string') {
    if (v.length > MAX_JSON) return null;
    try {
      JSON.parse(v);
      return v;
    } catch {
      return null;
    }
  }
  try {
    const s = JSON.stringify(v);
    if (typeof s !== 'string' || s.length > MAX_JSON) return null;
    return s;
  } catch {
    return null;
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

interface TeamRow { code: string }

/**
 * ⚠️ Салбарын олонлогийг `teams.code`-оос АЖИЛЛАХ ҮЕД уншина.  Тоог (7/8/9/11)
 * ХЭЗЭЭ Ч хатуу бичихгүй — шинэ салбар нэмэгдэх нь `teams`-д НЭГ INSERT,
 * кодын өөрчлөлт БАЙХ ЁСГҮЙ.
 */
async function knownTeamCodes(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare('SELECT code FROM teams').all<TeamRow>();
  return new Set((results ?? []).map((r) => r.code));
}

/* ------------------------------------------------------------------ */
/*  §82-4 — ХӨНДЛӨН-БАГИЙН АЛДАГДАЛ ТЭГ БАЙХ ХААЛГА                    */
/* ------------------------------------------------------------------ */

/**
 * `requireManager()`-ийн ХОС — ЗӨВХӨН ЭНЭ ФАЙЛД, `routes/revit.ts:132`-ийн
 * ЯГ ИЖИЛ тодорхойлолт.  ⛔ `requireManager`-ыг ӨРГӨТГӨХГҮЙ: тэрээр өөрөө
 * багийн шалгалтгүй бөгөөд түүнийг өргөтгөх нь ӨӨР асуудал.
 */
function isManagerRole(role: string): boolean {
  return (ADMIN_ROLES as string[]).includes(role) || role === 'senior';
}

/**
 * Дуудагчийн БҮХ багийн код (`user_teams`-ийн АЛЬ Ч мөр).
 *
 * ⚠️ `is_primary = 1` гэж ШҮҮХГҮЙ — `routes/revit.ts:1004`-ийн шийдвэрийг
 *    БАЙТ БАЙТААР давтав: «хүн өөрийн ХОЁРДОГЧ багаа сонгож болно».  Хоёр
 *    багт харьяалагдах инженер (BA + IZ гэх мэт) нь `resolveTeamContext`-ээр
 *    хоёрдогч багийнхаа баримт дээр ажиллаж БАЙГАА тул `is_primary`-гээр
 *    шүүвэл түүний add-in дүрмийн багц татаж чадахаа болино — тэр нь ~20
 *    компьютер дээр ЧИМЭЭГҮЙ унтарна.  Хамгаалж буй зүйл нь ХӨНДЛӨН-багийн
 *    алдагдал бөгөөд гишүүнчлэлийн ЯМАР Ч мөр түүнийг барина.
 */
async function callerTeamCodes(db: D1Database, userId: number): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT t.code AS code
         FROM user_teams ut
         JOIN teams t ON t.id = ut.team_id
        WHERE ut.user_id = ?1`,
    )
    .bind(userId)
    .all<TeamRow>()
    .catch(() => ({ results: [] as TeamRow[] }));
  return new Set((results ?? []).map((r) => String(r.code)));
}

/**
 * §82-4 — «шинэ гадаргуу бүр ӨӨРИЙН багийн хамрах хүрээг шалгана»
 * (`2-0-OWNER-BRIEF.md:439`).
 *
 * ⚠️ ЭНЭ НЬ `2-2-rule-model.md:1273`-ЫГ ДАРНА.  Тэр баримт `/pack`-ыг
 *    НЭЭЛТТЭЙ гэж зохиосон; 2-0 нь өөрийн §0-ээр УДИРДАХ баримт тул
 *    зөрчилдөөнд 2-0 ЯЛНА.  Хамгаалж буй зүйл нь ЗӨВХӨН дүрмийн текст БИШ:
 *    `team_rule_scope` мөрүүд нь `source_kind = 'company_practice'` ба
 *    ЧӨЛӨӨТ БИЧВЭР `practice_origin` агуулдаг — өөрөөр хэлбэл ӨӨР БАГИЙН
 *    дотоод шийдвэрийн түүх.
 *
 * ⚠️ 404-ийг 403-аас ӨМНӨ шалгана (дуудагч талд).  Багийн КОД нь аль
 *    хэдийн нийтийн (`GET /api/teams`) тул «ийм баг байхгүй» нь нууц БИШ,
 *    харин «ямар дүрэмтэй вэ» нь НУУЦ.
 */
function canReadTeamRules(
  role: string,
  teamCode: string,
  callerTeams: ReadonlySet<string>,
): boolean {
  return isManagerRole(role) || callerTeams.has(teamCode);
}

/** §82-4-ийн ЖИГД хариу — гадаргуу бүр ИЖИЛ мессеж буцаана. */
const TEAM_SCOPE_FORBIDDEN = {
  error: 'team_not_member',
  message_mn: 'Энэ багийн дүрмийн багцыг харах эрхгүй байна.',
  message_en: 'You are not a member of this team.',
} as const;

async function loadBuildContext(
  db: D1Database,
  projectId: number,
  docUid: string,
): Promise<BuildContext | null> {
  const row = await db
    .prepare(
      `SELECT project_id, doc_uid, building_type, occupancy_class, occupant_load,
              gross_area_m2, height_m, height_basis, grade_level_name, top_level_name,
              stories_above_grade, stories_below_grade, jurisdiction, project_phase,
              fire_safety_class, seismic_intensity, room_boundary_location,
              special_requirements_json
         FROM project_build_context
        WHERE project_id = ? AND doc_uid = ?`,
    )
    .bind(projectId, docUid)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const special = safeParse(String(row['special_requirements_json'] ?? '[]'));
  return {
    projectId,
    docUid,
    buildingType: strOrNull(row['building_type']),
    occupancyClass: strOrNull(row['occupancy_class']),
    occupantLoad: intOrNull(row['occupant_load']),
    grossAreaM2: numOrNull(row['gross_area_m2']),
    heightM: numOrNull(row['height_m']),
    heightBasis: isHeightBasis(row['height_basis']) ? row['height_basis'] : 'unknown',
    gradeLevelName: strOrNull(row['grade_level_name']),
    topLevelName: strOrNull(row['top_level_name']),
    storiesAboveGrade: intOrNull(row['stories_above_grade']),
    storiesBelowGrade: intOrNull(row['stories_below_grade']),
    jurisdiction: str(row['jurisdiction']) || 'MN',
    projectPhase: isProjectPhase(row['project_phase']) ? row['project_phase'] : null,
    fireSafetyClass: strOrNull(row['fire_safety_class']),
    seismicIntensity: strOrNull(row['seismic_intensity']),
    roomBoundaryLocation: isBoundaryLocation(row['room_boundary_location'])
      ? row['room_boundary_location']
      : null,
    specialRequirements: Array.isArray(special)
      ? special.filter((x): x is string => typeof x === 'string')
      : [],
  };
}

interface ConflictDbRow {
  rule_uid_a: string;
  rule_uid_b: string;
  conflict_kind: string;
  scope: string;
  precedence: string | null;
  note_mn: string | null;
}

function conflictFromDb(r: ConflictDbRow): ConflictEntry | null {
  if (!isConflictKind(r.conflict_kind)) return null;
  if (r.scope !== 'intra_pack' && r.scope !== 'cross_discipline') return null;
  return {
    ruleUidA: r.rule_uid_a,
    ruleUidB: r.rule_uid_b,
    conflictKind: r.conflict_kind,
    scope: r.scope,
    precedence: isConflictPrecedence(r.precedence) ? r.precedence : null,
    noteMn: r.note_mn,
  };
}

/**
 * ⚠️ ЗОНДЫН ТҮРИЙВЧ — `ruleset_version` ба `generated_at`-ын ОРОНД тавигдах
 * ТОГТМОЛ.  Хоосон мөр байх нь ЗОРИУДЫН: `packSha256` (§7.2) нь
 * `generated_at`-ыг АЛЬ ХЭДИЙН хоосон мөр болгож маскална, тиймээс зонд нь
 * бодит багцаас ЗӨВХӨН `ruleset_version`-оороо ялгаатай — өөрөөр хэлбэл
 * зондын хэш нь «хувилбараас БУСАД БҮХ агуулга».
 */
const RULESET_VERSION_PROBE = '';

/**
 * `ruleset_version` нь БАГЦЫН АГУУЛГЫН ЦЭВЭР ФУНКЦ: `r<дүрмийн тоо>.<хэш12>`.
 *
 * ⚠️ СИСТЕМИЙН ЦАГ ЭНД ХЭЗЭЭ Ч ОРОХГҮЙ.  Өмнөх хувилбар нь
 * `<өнөөдрийн огноо>.<contentKey>` буцаадаг байсан бөгөөд `ruleset_version`
 * нь ХЭШЛЭГДЭХ биед ордог (§7.5, `packSha256` түүнийг МАСКЛАХГҮЙ) тул UTC
 * шөнө дунд бүрд `pack_sha256` ГАЗАРГҮЙ ХӨДӨЛДӨГ байв.  Гурван үр дагавар,
 * гурвуулаа хэмжигдсэн:
 *   · `2-3`-ын ГУРАВДАХЬ хуучруулах өдөөгч нь `pack_sha256` — өдөр бүр
 *     төсөл БҮРИЙН олдвор БҮР `stale_reason='ruleset'` болно, дүрэм НЭГ Ч
 *     өөрчлөгдөөгүй байхад.
 *   · `?have=` товчлол өдрийн ЭХНИЙ хүсэлт бүрд ОНОХГҮЙ → ~20 машин багцаа
 *     өдөр бүр дахин татна.
 *   · `ON CONFLICT (team_code, ruleset_version) DO NOTHING` ХЭЗЭЭ Ч ажиллахгүй
 *     → `rule_pack_versions` баг тутамд ӨДӨР ТУТМЫН мөр хуримтлуулна.
 *
 * ⚠️ ХЭШ НЬ БАГЦЫН БҮТЭН БИЕИЙГ хамрах ЁСТОЙ, зөвхөн `semantic_hash`-ыг БИШ.
 * `semanticHash` нь `applicability` + `check` + `unit`-ыг Л нэрлэдэг тул
 * `severity` / `recommendation_mn` / `exceptions` / ЗӨРЧИЛДӨӨН зэрэг багцад
 * ЯВДАГ гишүүд өөрчлөгдөхөд хувилбар ХӨДӨЛӨХГҮЙ байх байсан — тэгвэл
 * `?have=` «unchanged» гэж хариулж, шинэ агуулга ~20 машин руу ХЭЗЭЭ Ч
 * ХҮРЭХГҮЙ.  Тиймээс хувилбарыг ЗОНД БАГЦААС гаргана: `buildPack`-ыг
 * хувилбарын оронд хоосон түрийвчтэйгээр нэг удаа дуудаж, түүний
 * `pack_sha256`-ыг хувилбарын үрээр авна.  Ингэснээр `PACK_CONTRACT`,
 * `team_code`, дүрмийн УТАСНЫ БҮХ гишүүн ба зөрчилдөөн — БҮГД хамрагдана.
 *
 * ⚠️ ЗОНД нь `context: null`-ТАЙ БАЙХ ЁСТОЙ.  `ruleset_version` нь ДҮРМИЙН
 * агуулгын функц, ТӨСЛИЙНХ БИШ (`/pack`-ын толгойн тэмдэглэл) — `?project=`
 * өгсөн клиент ба өгөөгүй клиент ИЖИЛ хувилбарын нэр харах ЁСТОЙ, эс бөгөөс
 * `?have=` төсөл сольсон бүрд оногүй болно.
 *
 * ⚠️ Хувилбар нь ХЭШЛЭГДЭХ биед орно (§7.5), тиймээс түүнийг бодит багц
 * угсрахаас ӨМНӨ тооцно.
 *
 * ⚠️ ЭКСПОРТЛОГДСОН нь ЗӨВХӨН ТЕСТИЙН УЧРААС (`compliance.rulesetVersion.test.ts`)
 * — маршрутаас ГАДУУР дуудагч БАЙХГҮЙ, БҮҮ НЭМ.
 */
export async function rulesetVersionOf(
  teamCode: string,
  rules: readonly ParsedRule[],
  conflicts: readonly ConflictEntry[],
): Promise<string> {
  const probe = await buildPack({
    teamCode,
    rulesetVersion: RULESET_VERSION_PROBE,
    generatedAt: RULESET_VERSION_PROBE,
    context: null,
    rules,
    conflicts,
  });
  return `r${probe.ruleCount}.${probe.packSha256.slice(0, 12)}`;
}

/* ================================================================== */
/*  GET /api/compliance/pack — багц татах                              */
/* ================================================================== */

/**
 * ⚠️ БАГИЙН ТУСГААРЛАЛТ нь ЭНЭ ГАНЦ ПРЕДИКАТ дээр зогсоно:
 *     `team_code = ?1 OR team_code IS NULL`
 * BA-ийн сесс IZ-ийн дүрмийг ХЭЗЭЭ Ч ХАРАХГҮЙ — эзний R3/R5/R6-ийн механик
 * хэрэгжилт.  `team_code IS NULL` = БҮХ КОМПАНИД.
 *
 * ⚠️ КООРДИНАТЫН ХААЛГА ЭНД ДАВХАР: `coordinate_system = 'none'` нөхцөл нь
 * SQL-д ил бичигдсэн тул гараар `published` болгосон мөр ч багцад ОРОХГҮЙ.
 *
 * `?project=` / `?doc=` нь СОНГОЛТ: өгвөл `project_build_context` нь багцын
 * `project_context` блокт бөглөгдөнө.  ⚠️ Тэр тохиолдолд `pack_sha256`
 * өөрчлөгдөнө (§7.5) — тэр нь ЗӨВ, контекст өөрчлөгдөх нь хамаарал
 * өөрчлөгдөх.  ГЭХДЭЭ `rule_pack_versions`-д ЗӨВХӨН АНХДАГЧ (контекстгүй)
 * багц хадгалагдана: `ruleset_version` нь дүрмийн агуулгын функц, төслийнх БИШ
 * (`rulesetVersionOf`-ын зонд нь ҮРГЭЛЖ `context: null`).
 */
compliance.get('/pack', async (c) => {
  const viewer = c.get('user');
  const team = str(c.req.query('team'), 16).toUpperCase();
  if (!team) return c.json({ error: 'team is required' }, 400);

  const teams = await knownTeamCodes(c.env.DB);
  if (!teams.has(team)) return c.json({ error: 'unknown team' }, 404);

  // ⚠️ §82-4.  Өмнө нь ЗӨВХӨН `knownTeamCodes` шалгагддаг байсан тул дурын
  //    инженер `?team=IZ` гэж бичээд IZ-ийн БҮТЭН багцыг татаж чаддаг байв.
  //    Багийн ТУСГААРЛАЛТЫГ SQL-ийн `team_code = ?1` предикат дээр Л
  //    түшиглэх нь ХАНГАЛТГҮЙ: тэр предикат нь «аль багийнх вэ»-г шийднэ,
  //    «хэн харах эрхтэй вэ»-г БИШ.
  if (!canReadTeamRules(viewer.role, team, await callerTeamCodes(c.env.DB, viewer.sub))) {
    return c.json({ ...TEAM_SCOPE_FORBIDDEN, team }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT ${RULE_COLUMNS}
       FROM rules
      WHERE status = 'published'
        AND coordinate_system = 'none'
        AND (team_code = ?1 OR team_code IS NULL)
      ORDER BY rule_uid, version`,
  )
    .bind(team)
    .all<RuleDbRow>();

  const parsed: ParsedRule[] = [];
  const rejected: string[] = [];
  for (const row of results ?? []) {
    const p = parseRuleRow(row);
    if (!p) {
      rejected.push(`${row.rule_uid}: задлагдахгүй`);
      continue;
    }
    const errors = validateRuleForPack(p);
    if (errors.length > 0) {
      rejected.push(`${row.rule_uid}: ${errors.join('; ')}`);
      continue;
    }
    parsed.push(p);
  }

  // ⚠️ ЧИМЭЭГҮЙ ХАСАЛТ БАЙХГҮЙ — нэг дүрэм ч унасан бол БҮХ БАГЦ УНАНА,
  //    өмнөх нийтлэгдсэн хувилбар үйлчилсээр байна (Хавсралт §10).
  if (rejected.length > 0) {
    return c.json({ error: 'pack_invalid', rejected }, 409);
  }

  // ⚠️ ЗӨРЧИЛДӨӨНИЙГ `?have=` ТОВЧЛОЛООС ӨМНӨ уншина.  Тэдгээр нь багцын
  //    БИЕД явдаг тул `ruleset_version`-ы ОРОЛТ мөн — доош нь зөөвөл зөрчил
  //    нэмэх/хасахад хувилбар ХӨДӨЛӨХГҮЙ, `?have=` «unchanged» гэж хариулж,
  //    шинэ зөрчилдөөн ~20 машин руу ХЭЗЭЭ Ч хүрэхгүй.
  const uids = new Set(parsed.map((p) => p.def.ruleUid));
  const { results: conflictRows } = await c.env.DB.prepare(
    `SELECT rule_uid_a, rule_uid_b, conflict_kind, scope, precedence, note_mn
       FROM rule_conflicts WHERE scope = 'intra_pack'`,
  ).all<ConflictDbRow>();
  const conflicts: ConflictEntry[] = [];
  for (const r of conflictRows ?? []) {
    if (!uids.has(r.rule_uid_a) || !uids.has(r.rule_uid_b)) continue;
    const e = conflictFromDb(r);
    if (e) conflicts.push(e);
  }

  const rulesetVersion = await rulesetVersionOf(team, parsed, conflicts);
  const have = str(c.req.query('have'), 64);
  if (have && have === rulesetVersion) {
    return c.json({ version: rulesetVersion, unchanged: true });
  }

  const projectId = intOrNull(c.req.query('project'));
  const docUid = str(c.req.query('doc'), 128);
  const context =
    projectId !== null && projectId > 0
      ? (await loadBuildContext(c.env.DB, projectId, docUid)) ??
        emptyBuildContext(projectId, docUid)
      : null;

  const pack = await buildPack({
    teamCode: team,
    rulesetVersion,
    generatedAt: new Date().toISOString(),
    context,
    rules: parsed,
    conflicts,
  });

  // Анхдагч (контекстгүй) багцыг Л бүртгэнэ.  ⚠️ ХООСОН багц бүртгэгдэхгүй —
  // дүрмийн багцгүй баг (MGMT / EZ / GT) `rule_pack_versions`-д мөргүй үлдэнэ.
  //
  // ⚠️ `DO NOTHING` нь ОДОО ҮНЭХЭЭР АЖИЛЛАНА.  `ruleset_version` нь ЯГ ЭНЭ
  //    (контекстгүй) багцын агуулгаас гардаг тул ижил хувилбарын нэртэй мөр
  //    нь ижил `pack_sha256` / `body_json`-той байх нь БАТАЛГААТАЙ — өөр байх
  //    цорын ганц зам нь гараар `UPDATE`.  Тиймээс энд ДАХИН БИЧИХ хэрэггүй:
  //    ХЭДИЙНЭЭ НИЙТЛЭГДСЭН МӨРИЙГ ХЭВЭЭР нь үлдээж, дахин ашиглана.
  //    (Өмнө нь хувилбар нь системийн цагаас хамаардаг байсан тул мөргөлдөөн
  //    ХЭЗЭЭ Ч гарахгүй, баг тутамд ӨДӨР БҮР шинэ мөр нэмэгддэг байв.)
  if (context === null && pack.ruleCount > 0) {
    await c.env.DB.prepare(
      `INSERT INTO rule_pack_versions
         (team_code, ruleset_version, pack_sha256, pack_contract, rule_count, body_json, status, published_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'published', datetime('now'))
       ON CONFLICT (team_code, ruleset_version) DO NOTHING`,
    )
      .bind(team, rulesetVersion, pack.packSha256, PACK_CONTRACT, pack.ruleCount, pack.bodyJson)
      .run();
  }

  // ⚠️ НИЙТЛЭГДСЭН БАЙТЫГ ЯГ ТЭР ХЭВЭЭР буцаана — дахин цуваарилах бүр нь
  //    тоо/зайны зөрүү оруулах боломж (§7.5).
  return new Response(pack.bodyJson, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
});

/* ================================================================== */
/*  Дүрэм — жагсаах / үүсгэх / засах / нийтлэх                          */
/* ================================================================== */

/**
 * ⚠️ §82-4 — ЭНЭ ГАДАРГУУ ХОЁР ЗАМААР ГООЖДОГ БАЙВ:
 *    (1) `?team=IZ` — ямар ч шалгалтгүй, өөр багийн бүх дүрэм;
 *    (2) `team` ОГТ ӨГӨӨГҮЙ — компанийн БҮХ дүрэм НЭГ хариултаар.
 *    Одоо ахлагч биш дуудагч нь ӨӨРИЙН багуудаар (+ `team_code IS NULL`
 *    буюу КОМПАНИЙН НИЙТ дүрэм) хязгаарлагдана.  `team_code IS NULL` нь
 *    зориудаар үлдэнэ: тэр нь бүх багт хамаарах дүрэм (`/pack`-ын
 *    предикатын хос) бөгөөд түүнийг хасвал багц ба жагсаалт ЗӨРНӨ.
 */
compliance.get('/rules', async (c) => {
  const viewer = c.get('user');
  const team = str(c.req.query('team'), 16).toUpperCase();
  const status = str(c.req.query('status'), 16) || 'published';

  const manager = isManagerRole(viewer.role);
  const mine = manager ? new Set<string>() : await callerTeamCodes(c.env.DB, viewer.sub);
  if (team && !canReadTeamRules(viewer.role, team, mine)) {
    return c.json({ ...TEAM_SCOPE_FORBIDDEN, team }, 403);
  }

  const binds: (string | number)[] = [status];
  let where = 'status = ?1';
  if (team) {
    binds.push(team);
    where += ` AND (team_code = ?${binds.length} OR team_code IS NULL)`;
  } else if (!manager) {
    // ⚠️ Гишүүнчлэлгүй хэрэглэгч (`user_teams` хоосон) нь ЗӨВХӨН компанийн
    //    нийт дүрмийг харна — ХООСОН олонлог нь `IN ()` болж SQL-ийн
    //    синтаксыг эвдэх тул салаа нь ИЛ бичигдэв.
    const marks = [...mine].map((code) => {
      binds.push(code);
      return `?${binds.length}`;
    });
    where += marks.length > 0
      ? ` AND (team_code IN (${marks.join(', ')}) OR team_code IS NULL)`
      : ` AND team_code IS NULL`;
  }

  const { results } = await c.env.DB.prepare(
    `SELECT ${RULE_COLUMNS} FROM rules WHERE ${where} ORDER BY rule_uid, version`,
  )
    .bind(...binds)
    .all<RuleDbRow>();
  return c.json({ rules: results ?? [] });
});

interface RuleBody {
  rule_uid?: unknown;
  version?: unknown;
  team_code?: unknown;
  title_mn?: unknown;
  title_en?: unknown;
  document_uid?: unknown;
  clause_uid?: unknown;
  edition_ref?: unknown;
  effective_from?: unknown;
  verification_state?: unknown;
  issue_class?: unknown;
  severity?: unknown;
  unit?: unknown;
  coordinate_system?: unknown;
  expect_applicable?: unknown;
  requires_context?: unknown;
  applicability?: unknown;
  check?: unknown;
  requires_params?: unknown;
  requires_triggered?: unknown;
  exceptions?: unknown;
  recommendation_mn?: unknown;
}

compliance.post('/rules', requireAdmin(), async (c) => {
  const body = await c.req.json<RuleBody>().catch(() => ({}) as RuleBody);
  const ruleUid = str(body.rule_uid, 64);
  const titleMn = str(body.title_mn, MAX_STR);
  if (!ruleUid || !titleMn) return c.json({ error: 'rule_uid and title_mn are required' }, 400);

  const teamCode = strOrNull(body.team_code, 16);
  if (teamCode !== null) {
    const teams = await knownTeamCodes(c.env.DB);
    if (!teams.has(teamCode.toUpperCase())) return c.json({ error: 'unknown team_code' }, 400);
  }

  const unit = isUnit(body.unit) ? body.unit : 'NONE';
  const severity = isSeverity(body.severity) ? body.severity : 'MEDIUM';
  const issueClass = isIssueClass(body.issue_class) ? body.issue_class : 'REGULATORY_VIOLATION';
  const coordinateSystem = isCoordinateSystem(body.coordinate_system)
    ? body.coordinate_system
    : 'none';
  // ⚠️ `verification_state`-ыг POST-оор ахиулж БОЛОХГҮЙ — 0221-ийн CHECK нь
  //    clause_uid/edition_ref/effective_from-гүйгээр татгалзана, гэхдээ 400-г
  //    хэрэглэгчид ойлгомжтой хэлбэрээр өгье.
  const verificationState = isVerificationState(body.verification_state)
    ? body.verification_state
    : 'UNVERIFIED';
  const clauseUid = strOrNull(body.clause_uid, 128);
  const editionRef = strOrNull(body.edition_ref, 64);
  const effectiveFrom = strOrNull(body.effective_from, 32);
  if (verificationState !== 'UNVERIFIED' && (!clauseUid || !editionRef || !effectiveFrom)) {
    return c.json(
      { error: 'clause_uid, edition_ref, effective_from are required unless UNVERIFIED' },
      400,
    );
  }

  const applicability = jsonText(body.applicability, '{}');
  const check = jsonText(body.check, '{}');
  const requiresContext = jsonText(body.requires_context, '[]');
  const requiresParams = jsonText(body.requires_params, '[]');
  const requiresTriggered = jsonText(body.requires_triggered, '[]');
  const exceptions = jsonText(body.exceptions, '[]');
  if (!applicability || !check || !requiresContext || !requiresParams || !requiresTriggered || !exceptions) {
    return c.json({ error: 'invalid json field' }, 400);
  }

  let hash: string;
  try {
    hash = await semanticHash(safeParse(applicability), safeParse(check), unit);
  } catch {
    return c.json({ error: 'invalid_expression', reason: 'number profile' }, 400);
  }

  const version = intOrNull(body.version) ?? 1;
  const viewer = c.get('user');

  try {
    await c.env.DB.prepare(
      `INSERT INTO rules
         (rule_uid, version, semantic_hash, team_code, title_mn, title_en, document_uid,
          clause_uid, edition_ref, effective_from, verification_state, issue_class, severity,
          unit, coordinate_system, expect_applicable, requires_context_json, applicability_json,
          check_json, requires_params_json, requires_triggered_json, exceptions_json,
          recommendation_mn, status, authored_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
               ?17, ?18, ?19, ?20, ?21, ?22, ?23, 'draft', ?24)`,
    )
      .bind(
        ruleUid,
        version,
        hash,
        teamCode ? teamCode.toUpperCase() : null,
        titleMn,
        strOrNull(body.title_en, MAX_STR),
        strOrNull(body.document_uid, 64),
        clauseUid,
        editionRef,
        effectiveFrom,
        verificationState,
        issueClass,
        severity,
        unit,
        coordinateSystem,
        body.expect_applicable === true ? 1 : 0,
        requiresContext,
        applicability,
        check,
        requiresParams,
        requiresTriggered,
        exceptions,
        strOrNull(body.recommendation_mn, MAX_TEXT),
        viewer.sub,
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return c.json({ error: 'EXISTS' }, 409);
    return c.json({ error: 'insert_failed', detail: msg.slice(0, 200) }, 400);
  }

  return c.json({ rule_uid: ruleUid, version, semantic_hash: hash, status: 'draft' }, 201);
});

/** Ноорог засах.  ⚠️ `semantic_hash` нь `applicability`/`check`/`unit` өөрчлөгдвөл
 *  ДАХИН тооцогдоно — гараар илгээсэн hash-ыг ХҮЛЭЭЖ АВАХГҮЙ. */
compliance.patch('/rules/:uid', requireManager(), async (c) => {
  const uid = c.req.param('uid');
  const version = intOrNull(c.req.query('version')) ?? 1;
  const body = await c.req.json<RuleBody>().catch(() => ({}) as RuleBody);

  const current = await c.env.DB.prepare(
    `SELECT ${RULE_COLUMNS} FROM rules WHERE rule_uid = ?1 AND version = ?2`,
  )
    .bind(uid, version)
    .first<RuleDbRow>();
  if (!current) return c.json({ error: 'not found' }, 404);

  const applicability = jsonText(body.applicability, current.applicability_json);
  const check = jsonText(body.check, current.check_json);
  const requiresContext = jsonText(body.requires_context, current.requires_context_json);
  const requiresParams = jsonText(body.requires_params, current.requires_params_json);
  const requiresTriggered = jsonText(body.requires_triggered, current.requires_triggered_json);
  const exceptions = jsonText(body.exceptions, current.exceptions_json);
  if (!applicability || !check || !requiresContext || !requiresParams || !requiresTriggered || !exceptions) {
    return c.json({ error: 'invalid json field' }, 400);
  }

  const unit = isUnit(body.unit) ? body.unit : (isUnit(current.unit) ? current.unit : 'NONE');
  const severity = isSeverity(body.severity) ? body.severity : current.severity;
  const issueClass = isIssueClass(body.issue_class) ? body.issue_class : current.issue_class;
  const coordinateSystem = isCoordinateSystem(body.coordinate_system)
    ? body.coordinate_system
    : current.coordinate_system;
  const verificationState = isVerificationState(body.verification_state)
    ? body.verification_state
    : current.verification_state;
  const clauseUid =
    body.clause_uid === undefined ? current.clause_uid : strOrNull(body.clause_uid, 128);
  const editionRef =
    body.edition_ref === undefined ? current.edition_ref : strOrNull(body.edition_ref, 64);
  const effectiveFrom =
    body.effective_from === undefined ? current.effective_from : strOrNull(body.effective_from, 32);
  if (verificationState !== 'UNVERIFIED' && (!clauseUid || !editionRef || !effectiveFrom)) {
    return c.json(
      { error: 'clause_uid, edition_ref, effective_from are required unless UNVERIFIED' },
      400,
    );
  }

  let hash: string;
  try {
    hash = await semanticHash(safeParse(applicability), safeParse(check), unit);
  } catch {
    return c.json({ error: 'invalid_expression', reason: 'number profile' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE rules SET
        title_mn = ?3, title_en = ?4, document_uid = ?5, clause_uid = ?6, edition_ref = ?7,
        effective_from = ?8, verification_state = ?9, issue_class = ?10, severity = ?11,
        unit = ?12, coordinate_system = ?13, expect_applicable = ?14,
        requires_context_json = ?15, applicability_json = ?16, check_json = ?17,
        requires_params_json = ?18, requires_triggered_json = ?19, exceptions_json = ?20,
        recommendation_mn = ?21, semantic_hash = ?22
      WHERE rule_uid = ?1 AND version = ?2`,
  )
    .bind(
      uid,
      version,
      str(body.title_mn, MAX_STR) || current.title_mn,
      body.title_en === undefined ? current.title_en : strOrNull(body.title_en, MAX_STR),
      body.document_uid === undefined ? current.document_uid : strOrNull(body.document_uid, 64),
      clauseUid,
      editionRef,
      effectiveFrom,
      verificationState,
      issueClass,
      severity,
      unit,
      coordinateSystem,
      body.expect_applicable === undefined
        ? current.expect_applicable
        : body.expect_applicable === true
          ? 1
          : 0,
      requiresContext,
      applicability,
      check,
      requiresParams,
      requiresTriggered,
      exceptions,
      body.recommendation_mn === undefined
        ? current.recommendation_mn
        : strOrNull(body.recommendation_mn, MAX_TEXT),
      hash,
    )
    .run();

  return c.json({ rule_uid: uid, version, semantic_hash: hash });
});

interface CaseClassRow { case_class: string }

/**
 * §3.11 — НИЙТЛЭХ ХААЛГА.  ДӨРВИЙН аль нэг нь биелэхгүй бол 409 + нэрлэсэн
 * шалтгаан.  Тавдугаарт: `invalid_expression` (Хавсралт §10-ийн V-шалгуурууд).
 *
 * ⚠️ Зөрчилдөөн бүртгэх нь нийтлэхийг ЗОГСООХГҮЙ (v2 §64 нь зөрчилдөөнийг
 * ИЛЭРХИЙЛЭГДЭХ ТӨЛӨВ болгохыг шаарддаг, хориглохыг БИШ).
 */
compliance.post('/rules/:uid/publish', requireAdmin(), async (c) => {
  const uid = c.req.param('uid');
  const version = intOrNull(c.req.query('version')) ?? 1;

  const row = await c.env.DB.prepare(
    `SELECT ${RULE_COLUMNS} FROM rules WHERE rule_uid = ?1 AND version = ?2`,
  )
    .bind(uid, version)
    .first<RuleDbRow>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (!isSeverity(row.severity)) return c.json({ error: 'invalid severity' }, 400);

  // (4) КООРДИНАТЫН ХААЛГА — эхлээд, учир нь энэ нь ЧАДВАРЫН дутагдал,
  //     зохиогчийн алдаа биш.
  if (row.coordinate_system !== 'none' && !LINK_TRANSFORM_CAPABILITY_SHIPPED_ROUTE) {
    return c.json({ error: 'publish_blocked', reason: 'coordinate_capability_missing' }, 409);
  }

  // (3) `CRITICAL` бол `HUMAN_VERIFIED`.
  if (row.severity === 'CRITICAL' && row.verification_state !== 'HUMAN_VERIFIED') {
    return c.json({ error: 'publish_blocked', reason: 'unverified_critical' }, 409);
  }

  const { results: caseRows } = await c.env.DB.prepare(
    'SELECT case_class FROM rule_test_cases WHERE rule_uid = ?1 AND rule_version = ?2',
  )
    .bind(uid, version)
    .all<CaseClassRow>();
  const classes = new Set((caseRows ?? []).map((r) => r.case_class));

  // (1) тестийн тоо.
  const need = MIN_TESTS_BY_SEVERITY[row.severity];
  if ((caseRows ?? []).length < need) {
    return c.json(
      { error: 'publish_blocked', reason: 'insufficient_tests', need, have: (caseRows ?? []).length },
      409,
    );
  }

  // (2) `CRITICAL`/`HIGH` бол таван заавал ангилал.
  if (row.severity === 'CRITICAL' || row.severity === 'HIGH') {
    const missing = REQUIRED_CASE_CLASSES.filter((cls) => !classes.has(cls));
    if (missing.length > 0) {
      return c.json({ error: 'publish_blocked', reason: 'missing_case_class', missing }, 409);
    }
  }

  // (5) Илэрхийллийн шалгуурууд — багц угсрахтай ЯГ ижил.
  const parsed = parseRuleRow(row);
  if (!parsed) {
    return c.json({ error: 'publish_blocked', reason: 'invalid_expression' }, 409);
  }
  const errors = validateRuleForPack(parsed);
  if (errors.length > 0) {
    return c.json({ error: 'publish_blocked', reason: 'invalid_expression', errors }, 409);
  }

  // `authoring_check` — НИЙТЛЭХИЙН ӨМНӨХ зөрчилдөөний илрүүлэлт.
  // ⚠️ Мөр бичих нь нийтлэхийг ЗОГСООХГҮЙ.
  const detected = await detectAuthoringConflicts(c.env.DB, row);

  const viewer = c.get('user');
  await c.env.DB.prepare(
    `UPDATE rules SET status = 'published', reviewed_by = ?3, reviewed_at = datetime('now')
      WHERE rule_uid = ?1 AND version = ?2`,
  )
    .bind(uid, version, viewer.sub)
    .run();

  return c.json({ rule_uid: uid, version, status: 'published', reason: null, conflicts: detected });
});

/**
 * Нэр дэвшигч дүрмийг ижил `document_uid` ЭСВЭЛ ижил элементийн ангилал дээр
 * АЛЬ ХЭДИЙН нийтлэгдсэн дүрмүүдтэй тулгана.  `semantic_hash` ижил (яг ижил
 * логик) эсвэл хамаарлын огтлолцолтой боловч босго зөрөх бол мөр бичнэ.
 */
async function detectAuthoringConflicts(db: D1Database, row: RuleDbRow): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT ${RULE_COLUMNS} FROM rules
        WHERE status = 'published' AND rule_uid <> ?1
          AND (document_uid IS NOT NULL AND document_uid = ?2)`,
    )
    .bind(row.rule_uid, row.document_uid)
    .all<RuleDbRow>();

  const mine = parseRuleRow(row);
  if (!mine) return 0;
  const mineFacts = new Set(
    mine.def.applicability ? factNamesOfSafe(mine) : [],
  );

  let written = 0;
  for (const other of results ?? []) {
    const theirs = parseRuleRow(other);
    if (!theirs) continue;
    const overlap = theirs.def.applicability
      ? factNamesOfSafe(theirs).some((f) => mineFacts.has(f))
      : mineFacts.size === 0;
    if (!overlap) continue;
    // Ижил логик бол зөрчилдөөн биш — давхардал.  Босго зөрсөн үед Л бүртгэнэ.
    if (theirs.def.semanticHash === mine.def.semanticHash) continue;

    const pair = normalizeConflictPair(row.rule_uid, other.rule_uid);
    const scope = row.team_code === other.team_code ? 'intra_pack' : 'cross_discipline';
    await db
      .prepare(
        `INSERT INTO rule_conflicts (rule_uid_a, rule_uid_b, conflict_kind, scope, precedence, note_mn, detected_by)
         VALUES (?1, ?2, 'threshold', ?3, 'unknown', ?4, 'authoring_check')
         ON CONFLICT (rule_uid_a, rule_uid_b, conflict_kind)
         DO UPDATE SET note_mn = excluded.note_mn`,
      )
      .bind(
        pair[0],
        pair[1],
        scope,
        'Нийтлэхийн өмнөх тулгалт: ижил баримт дээр босго зөрөв.',
      )
      .run();
    written += 1;
  }
  return written;
}

function factNamesOfSafe(parsed: ParsedRule): readonly string[] {
  const out = new Set<string>();
  for (const n of [parsed.def.applicability, parsed.def.check]) {
    if (!n) continue;
    for (const f of factNamesOf(n)) out.add(f);
  }
  return [...out];
}

/* ================================================================== */
/*  Баримт ба заалт                                                    */
/* ================================================================== */

compliance.get('/documents', async (c) => {
  const [{ results: docs }, { results: clauses }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT doc_uid, code, title_mn, title_en, doc_family, jurisdiction, edition,
              effective_from, superseded_by, status, norm_item_key, source_url
         FROM regulatory_documents ORDER BY code, edition`,
    ).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT clause_uid, document_uid, clause_no, page_no, table_no, text_source, verified_at
         FROM rule_clauses ORDER BY document_uid, clause_no`,
    ).all<Record<string, unknown>>(),
  ]);
  return c.json({ documents: docs ?? [], clauses: clauses ?? [] });
});

compliance.post('/documents', requireAdmin(), async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const docUid = str(body['doc_uid'], 64);
  const code = str(body['code'], 64);
  const titleMn = str(body['title_mn'], MAX_STR);
  if (!docUid || !code || !titleMn) {
    return c.json({ error: 'doc_uid, code, title_mn are required' }, 400);
  }
  const viewer = c.get('user');
  try {
    await c.env.DB.prepare(
      `INSERT INTO regulatory_documents
         (doc_uid, code, title_mn, title_en, doc_family, jurisdiction, edition, effective_from,
          superseded_by, status, norm_item_key, source_url, acquired_by, acquired_at)
       VALUES (?1, ?2, ?3, ?4, COALESCE(?5, 'BNBD'), COALESCE(?6, 'MN'), ?7, ?8, ?9,
               COALESCE(?10, 'unconfirmed'), ?11, ?12, ?13, datetime('now'))`,
    )
      .bind(
        docUid,
        code,
        titleMn,
        strOrNull(body['title_en'], MAX_STR),
        strOrNull(body['doc_family'], 16),
        strOrNull(body['jurisdiction'], 8),
        strOrNull(body['edition'], 64),
        strOrNull(body['effective_from'], 32),
        strOrNull(body['superseded_by'], 64),
        strOrNull(body['status'], 16),
        strOrNull(body['norm_item_key'], 64),
        strOrNull(body['source_url'], 512),
        viewer.sub,
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return c.json({ error: 'EXISTS' }, 409);
    return c.json({ error: 'insert_failed', detail: msg.slice(0, 200) }, 400);
  }
  return c.json({ doc_uid: docUid }, 201);
});

/* ================================================================== */
/*  Төслийн контекст (§61-ийн 12 оролт)                                */
/* ================================================================== */

compliance.get('/context/:projectId', async (c) => {
  const projectId = intOrNull(c.req.param('projectId'));
  if (projectId === null) return c.json({ error: 'bad projectId' }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM project_build_context WHERE project_id = ?1 ORDER BY doc_uid`,
  )
    .bind(projectId)
    .all<Record<string, unknown>>();
  return c.json({ contexts: results ?? [] });
});

compliance.put(
  '/context/:projectId',
  requireRole('admin', 'architect', 'senior'),
  async (c) => {
    const projectId = intOrNull(c.req.param('projectId'));
    if (projectId === null) return c.json({ error: 'bad projectId' }, 400);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const docUid = str(body['doc_uid'], 128);
    const special = jsonText(body['special_requirements'], '[]');
    const proposed = body['proposed'] === undefined ? null : jsonText(body['proposed'], '{}');
    if (!special || (body['proposed'] !== undefined && !proposed)) {
      return c.json({ error: 'invalid json field' }, 400);
    }
    const viewer = c.get('user');

    await c.env.DB.prepare(
      `INSERT INTO project_build_context
         (project_id, doc_uid, building_type, occupancy_class, occupant_load, gross_area_m2,
          height_m, height_basis, grade_level_name, top_level_name, stories_above_grade,
          stories_below_grade, jurisdiction, project_phase, fire_safety_class, seismic_intensity,
          room_boundary_location, special_requirements_json, authored_by, authored_at, proposed_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE(?8,'unknown'), ?9, ?10, ?11, ?12,
               COALESCE(?13,'MN'), ?14, ?15, ?16, ?17, ?18, ?19, datetime('now'), ?20)
       ON CONFLICT (project_id, doc_uid) DO UPDATE SET
          building_type = excluded.building_type,
          occupancy_class = excluded.occupancy_class,
          occupant_load = excluded.occupant_load,
          gross_area_m2 = excluded.gross_area_m2,
          height_m = excluded.height_m,
          height_basis = excluded.height_basis,
          grade_level_name = excluded.grade_level_name,
          top_level_name = excluded.top_level_name,
          stories_above_grade = excluded.stories_above_grade,
          stories_below_grade = excluded.stories_below_grade,
          jurisdiction = excluded.jurisdiction,
          project_phase = excluded.project_phase,
          fire_safety_class = excluded.fire_safety_class,
          seismic_intensity = excluded.seismic_intensity,
          room_boundary_location = excluded.room_boundary_location,
          special_requirements_json = excluded.special_requirements_json,
          authored_by = excluded.authored_by,
          authored_at = excluded.authored_at,
          proposed_json = excluded.proposed_json,
          updated_at = datetime('now')`,
    )
      .bind(
        projectId,
        docUid,
        strOrNull(body['building_type'], MAX_STR),
        strOrNull(body['occupancy_class'], MAX_STR),
        intOrNull(body['occupant_load']),
        numOrNull(body['gross_area_m2']),
        numOrNull(body['height_m']),
        isHeightBasis(body['height_basis']) ? body['height_basis'] : null,
        strOrNull(body['grade_level_name'], MAX_STR),
        strOrNull(body['top_level_name'], MAX_STR),
        intOrNull(body['stories_above_grade']),
        intOrNull(body['stories_below_grade']),
        strOrNull(body['jurisdiction'], 8),
        isProjectPhase(body['project_phase']) ? body['project_phase'] : null,
        strOrNull(body['fire_safety_class'], 64),
        strOrNull(body['seismic_intensity'], 64),
        isBoundaryLocation(body['room_boundary_location']) ? body['room_boundary_location'] : null,
        special,
        viewer.sub,
        proposed,
      )
      .run();

    return c.json({ project_id: projectId, doc_uid: docUid });
  },
);

/* ================================================================== */
/*  Тест кейс — §3.11-ийн мухардлыг хаах БИЧИХ ЗАМ                     */
/* ================================================================== */

/**
 * ⚠️ РЕЛИЗ N-д КУРАЦИЙН UI БАЙХГҮЙ (тэр нь `2-5`-ынх).  Бичих ЗАМ нь ЭНЭ
 * СЕССИД ЗААВАЛ гарна: §3.11-ийн хаалга ≥5 тест шаарддаг тул бичих замгүйгээр
 * `CRITICAL`/`HIGH` дүрэм ХЭЗЭЭ Ч нийтлэгдэхгүй, v2 §70/§63/§66 гурвуулаа
 * хүчингүй болно.
 *
 * ⚠️ ЗОХИОГЧ ба БАТАЛГААЖУУЛАГЧ нь ХОЁР ӨӨР ЭРХ: POST нь `requireManager()`,
 * PATCH нь `requireAdmin()`.  POST нь `verified`-ыг ХЭЗЭЭ Ч 1 болгохгүй.
 */
compliance.get('/tests', requireManager(), async (c) => {
  const rule = str(c.req.query('rule'), 64);
  const stmt = rule
    ? c.env.DB.prepare(
        `SELECT case_uid, rule_uid, rule_version, case_class, inputs_json, expect_verdict,
                expect_value, source_kind, source_note, verified, verified_by, verified_at
           FROM rule_test_cases WHERE rule_uid = ?1 ORDER BY case_class, case_uid`,
      ).bind(rule)
    : c.env.DB.prepare(
        `SELECT case_uid, rule_uid, rule_version, case_class, inputs_json, expect_verdict,
                expect_value, source_kind, source_note, verified, verified_by, verified_at
           FROM rule_test_cases ORDER BY rule_uid, case_class, case_uid`,
      );
  const { results } = await stmt.all<Record<string, unknown>>();
  return c.json({ tests: results ?? [] });
});

compliance.post('/tests', requireManager(), async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const caseUid = str(body['case_uid'], 128);
  const ruleUid = str(body['rule_uid'], 64);
  if (!caseUid || !ruleUid) return c.json({ error: 'case_uid and rule_uid are required' }, 400);

  // ⚠️ 0222-ын CHECK олонлогуудтай ЯГ таарахыг СЕРВЕР шалгана — DB-д ХҮРЭХГҮЙ.
  if (!isCaseClass(body['case_class'])) {
    return c.json({ error: 'bad case_class', allowed: CASE_CLASSES }, 400);
  }
  if (!isExpectVerdict(body['expect_verdict'])) {
    return c.json({ error: 'bad expect_verdict', allowed: EXPECT_VERDICTS }, 400);
  }
  const sourceKind = body['source_kind'] === undefined ? 'authored' : body['source_kind'];
  if (!isTestSourceKind(sourceKind)) {
    return c.json({ error: 'bad source_kind', allowed: TEST_SOURCE_KINDS }, 400);
  }
  const inputs = jsonText(body['inputs_json'] ?? body['inputs'], '{}');
  if (!inputs) return c.json({ error: 'invalid inputs_json' }, 400);

  try {
    await c.env.DB.prepare(
      `INSERT INTO rule_test_cases
         (case_uid, rule_uid, rule_version, case_class, inputs_json, expect_verdict,
          expect_value, source_kind, source_note, verified)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)`,
    )
      .bind(
        caseUid,
        ruleUid,
        intOrNull(body['rule_version']) ?? 1,
        body['case_class'],
        inputs,
        body['expect_verdict'],
        numOrNull(body['expect_value']),
        sourceKind,
        strOrNull(body['source_note'], MAX_TEXT),
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return c.json({ error: 'EXISTS' }, 409);
    return c.json({ error: 'insert_failed', detail: msg.slice(0, 200) }, 400);
  }
  // ⚠️ `verified` нь ҮРГЭЛЖ 0-оор эхэлнэ — POST нь баталгаажуулж ЧАДАХГҮЙ.
  return c.json({ case_uid: caseUid, verified: 0 }, 201);
});

compliance.patch('/tests/:caseUid', requireAdmin(), async (c) => {
  const caseUid = c.req.param('caseUid');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);

  const current = await c.env.DB.prepare(
    'SELECT case_uid, inputs_json, expect_verdict FROM rule_test_cases WHERE case_uid = ?1',
  )
    .bind(caseUid)
    .first<{ case_uid: string; inputs_json: string; expect_verdict: string }>();
  if (!current) return c.json({ error: 'not found' }, 404);

  const inputs = jsonText(body['inputs_json'] ?? body['inputs'], current.inputs_json);
  if (!inputs) return c.json({ error: 'invalid inputs_json' }, 400);
  const expectVerdict = isExpectVerdict(body['expect_verdict'])
    ? body['expect_verdict']
    : current.expect_verdict;

  // ⚠️ Баталгаажсан тест ЧИМЭЭГҮЙ ӨӨРЧЛӨГДӨЖ БОЛОХГҮЙ: агуулга засагдвал
  //    `verified` нь 0 руу АВТОМАТААР унана.
  const contentChanged = inputs !== current.inputs_json || expectVerdict !== current.expect_verdict;
  const wantVerified = body['verified'] === 1 || body['verified'] === true;
  const verified = contentChanged ? 0 : wantVerified ? 1 : 0;
  const viewer = c.get('user');

  await c.env.DB.prepare(
    `UPDATE rule_test_cases SET
        inputs_json = ?2, expect_verdict = ?3, verified = ?4,
        verified_by = CASE WHEN ?4 = 1 THEN ?5 ELSE NULL END,
        verified_at = CASE WHEN ?4 = 1 THEN datetime('now') ELSE NULL END
      WHERE case_uid = ?1`,
  )
    .bind(caseUid, inputs, expectVerdict, verified, viewer.sub)
    .run();

  return c.json({ case_uid: caseUid, verified });
});

/* ================================================================== */
/*  Зөрчилдөөн (§64) — БҮРТГЭЛ, шийдвэр БИШ                            */
/* ================================================================== */

compliance.get('/conflicts', requireManager(), async (c) => {
  const rule = str(c.req.query('rule'), 64);
  const stmt = rule
    ? c.env.DB.prepare(
        `SELECT rc.rule_uid_a, rc.rule_uid_b, rc.conflict_kind, rc.scope, rc.precedence,
                rc.note_mn, rc.detected_by, rc.created_at,
                ra.edition_ref AS a_edition_ref, ra.applicability_json AS a_applicability,
                ra.verification_state AS a_verification_state, ra.severity AS a_severity,
                rb.edition_ref AS b_edition_ref, rb.applicability_json AS b_applicability,
                rb.verification_state AS b_verification_state, rb.severity AS b_severity
           FROM rule_conflicts rc
           LEFT JOIN rules ra ON ra.rule_uid = rc.rule_uid_a AND ra.status = 'published'
           LEFT JOIN rules rb ON rb.rule_uid = rc.rule_uid_b AND rb.status = 'published'
          WHERE rc.rule_uid_a = ?1 OR rc.rule_uid_b = ?1
          ORDER BY rc.id`,
      ).bind(rule)
    : c.env.DB.prepare(
        `SELECT rc.rule_uid_a, rc.rule_uid_b, rc.conflict_kind, rc.scope, rc.precedence,
                rc.note_mn, rc.detected_by, rc.created_at,
                ra.edition_ref AS a_edition_ref, ra.applicability_json AS a_applicability,
                ra.verification_state AS a_verification_state, ra.severity AS a_severity,
                rb.edition_ref AS b_edition_ref, rb.applicability_json AS b_applicability,
                rb.verification_state AS b_verification_state, rb.severity AS b_severity
           FROM rule_conflicts rc
           LEFT JOIN rules ra ON ra.rule_uid = rc.rule_uid_a AND ra.status = 'published'
           LEFT JOIN rules rb ON rb.rule_uid = rc.rule_uid_b AND rb.status = 'published'
          ORDER BY rc.id`,
      );
  const { results } = await stmt.all<Record<string, unknown>>();
  return c.json({ conflicts: results ?? [] });
});

/**
 * ⚠️ `detected_by = 'human'` нь ЭНД ХАТУУ.  `verdict_stream` нь `2-3`-ынх —
 * РЕЛИЗ N-д тэр утгатай НЭГ Ч МӨР БИЧИГДЭХГҮЙ (§6-ийн шалгуур).
 * ⚠️ Хос нь ordinal-аар нормчлогдоно, эс бөгөөс `idx_rule_conflicts_pair`
 * UNIQUE индекс давхардлыг барихаа болино.
 */
compliance.post('/conflicts', requireAdmin(), async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const a = str(body['rule_uid_a'], 64);
  const b = str(body['rule_uid_b'], 64);
  if (!a || !b || a === b) return c.json({ error: 'two distinct rule uids required' }, 400);
  const kind = body['conflict_kind'] === undefined ? 'threshold' : body['conflict_kind'];
  if (!isConflictKind(kind)) return c.json({ error: 'bad conflict_kind', allowed: CONFLICT_KINDS }, 400);
  const scopeRaw = body['scope'] === undefined ? 'intra_pack' : body['scope'];
  if (scopeRaw !== 'intra_pack' && scopeRaw !== 'cross_discipline') {
    return c.json({ error: 'bad scope' }, 400);
  }
  const precedence =
    body['precedence'] === undefined || body['precedence'] === null
      ? null
      : isConflictPrecedence(body['precedence'])
        ? body['precedence']
        : undefined;
  if (precedence === undefined) return c.json({ error: 'bad precedence' }, 400);

  const pair = normalizeConflictPair(a, b);
  const viewer = c.get('user');
  const existing = await c.env.DB.prepare(
    'SELECT id FROM rule_conflicts WHERE rule_uid_a = ?1 AND rule_uid_b = ?2 AND conflict_kind = ?3',
  )
    .bind(pair[0], pair[1], kind)
    .first<{ id: number }>();

  await c.env.DB.prepare(
    `INSERT INTO rule_conflicts (rule_uid_a, rule_uid_b, conflict_kind, scope, precedence, note_mn, detected_by, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'human', ?7)
     ON CONFLICT (rule_uid_a, rule_uid_b, conflict_kind)
     DO UPDATE SET precedence = excluded.precedence, note_mn = excluded.note_mn`,
  )
    .bind(
      pair[0],
      pair[1],
      kind,
      scopeRaw,
      precedence,
      strOrNull(body['note_mn'], MAX_TEXT),
      viewer.sub,
    )
    .run();

  return c.json(
    { rule_uid_a: pair[0], rule_uid_b: pair[1], conflict_kind: kind, detected_by: 'human' },
    existing ? 200 : 201,
  );
});

/* ================================================================== */
/*  ⬇⬇⬇  ДАРААГИЙН СЕССҮҮД ЭНДЭЭС ДООШ НЭМНЭ (2-4 → 2-3 → 2-6 → 2-5 → 2-7) */
/* ================================================================== */

/* ================================================================== */
/*  §76 — МЭДЭГДЛИЙН ЯДАРГААНЫ ТӨЛӨВ (`2-4-nonblocking-runtime` §3.5)   */
/* ================================================================== */

/**
 * ⚠️ ЭНЭ ГУРВАН HANDLER НЬ `2-4`-ЫНХ.  Дээрх БҮХ маршрут (`/pack`, `/rules`,
 * `/documents`, `/context`, `/tests`, `/conflicts`) нь `2-2-rule-model`-ынх —
 * энэ сесс тэдгээрийг ХӨНДӨӨГҮЙ.  `new Hono()`, файлын түвшний `requireRole`,
 * `index.ts`-ийн `app.route` ба `lib/modules.ts`-ийн ангилал БҮГД `2-2`-ынх.
 *
 * ⚠️ SELF-VIEW-ONLY.  Гурван маршрут бүр `user_id = viewer.sub` эсвэл АГРЕГАТ.
 *    Хүн тус бүрийн зөрчлийн тоо ХААНА Ч, АДМИНД Ч рендерлэгдэхгүй —
 *    0201:23-32, 0203:27, 0205:44 ба 0227-ийн толгойд ДӨРВӨН удаа бичигдсэн
 *    инвариант.  ⚠️ `?user=` мэт параметр ХЭЗЭЭ Ч НЭМЭХГҮЙ.
 *
 * ⚠️ MCP ТУСГААР ХУВИЛБАР БАЙХГҮЙ.  `/mcp` нь root зам бөгөөд
 *    `workerScopeGuard`, `entitlementGuard` ба tenant `tid` шалгалт
 *    ГУРВУУЛАНГ НЬ зэрэг тойрдог (`routes/learning.ts`-ийн толгой).
 *
 * ⚠️ `lib/workerScope.ts`-ийн `WORKER_ALLOWED_PREFIXES`-д `/api/compliance`
 *    НЭМЭГДЭХГҮЙ — тэр нь хаалттай-анхдагч цагаан жагсаалт тул `worker` дүр
 *    автоматаар 403 авна, энэ нь ЗӨВ.
 */

/** POST-оор бичигдэх төлөвүүд.  `new` нь DB-ийн анхдагч — POST-д БАЙХГҮЙ. */
const NOTICE_STATES = ['shown', 'acknowledged', 'snoozed', 'dismissed'] as const;
type NoticeState = (typeof NOTICE_STATES)[number];

const isNoticeState = (v: unknown): v is NoticeState =>
  typeof v === 'string' && (NOTICE_STATES as readonly string[]).includes(v);

/**
 * «НЭЭЛТТЭЙ»-ийн тодорхойлолт — жагсаалт ба тоолуурын ГАНЦ эх сурвалж.
 *
 * `new` / `shown` нь нээлттэй.  `snoozed` нь хугацаа ДУУСМАГЦ дахин нээгдэнэ.
 * `acknowledged` ба `dismissed` нь ХААЛТТАЙ; тэднийг буцааж нээх ЦОРЫН ГАНЦ
 * зам нь дүрмийн ШИНЭ хувилбартай `shown` (доорх upsert-ийн `CASE`).
 *
 * ⚠️ Хоёр маршрут ЗААВАЛ ИЖИЛ предикат хэрэглэнэ — эс бөгөөс ribbon-ий
 *    caption дээрх тоо самбарын мөрийн тоотой таарахгүй болж, инженер
 *    «алга болсон» зөрчил хайж эхэлнэ.
 */
const OPEN_NOTICE_SQL = `
  user_id = ?1
  AND (
    state IN ('new','shown')
    OR (state = 'snoozed' AND (snooze_until IS NULL OR snooze_until <= datetime('now')))
  )`;

/**
 * ⚠️ `SEVERITY_RANK` (`lib/complianceModel.ts:128`)-ийн SQL ХОС — ХАМТ хөдөлнө.
 *    Эрэмбийг JS талд хийвэл `LIMIT`-ээс ГАДНА үлдсэн `CRITICAL` мөр чимээгүй
 *    унана, тиймээс эрэмбэ нь SQL-д байх ЁСТОЙ.
 */
const SEVERITY_ORDER_SQL = `CASE severity
    WHEN 'CRITICAL' THEN 5 WHEN 'HIGH' THEN 4 WHEN 'MEDIUM' THEN 3
    WHEN 'LOW' THEN 2 ELSE 1 END`;

const NOTICE_COLUMNS = `dedup_key, state, severity, rule_uid, rule_version, ruleset_version,
       ack_rule_version, team_code, doc_uid, root_dedup_key, shown_count,
       first_shown_at, last_shown_at, ack_at, snooze_until, created_at, updated_at`;

/** Нэг татацын мөрийн дээд тоо.  Бүтэн тоо нь `/notices/count`-д. */
const MAX_NOTICE_ROWS = 200;

/**
 * `GET /api/compliance/notices` — МИНИЙ нээлттэй мэдэгдлүүд (badge-ийн эх сурвалж).
 *
 * ⚠️ PULL, PUSH БИШ.  Вэб push-аар ХЭЗЭЭ Ч явуулахгүй: `lib/pushSweep.ts`-ийн
 *    `CATEGORY_OF` нь `Record<NotificationType, …>` (шинэ төрөл = эмхэтгэлийн
 *    алдаа) ба `VAPID_PUBLIC_KEY` эргүүлэх нь бүх захиалгыг эргэлт буцалтгүй
 *    хүчингүй болгоно.
 *
 * `?doc_uid=` — нэг баримтаар шүүнэ (add-in идэвхтэй `DocUid`-аа өгнө).
 * `?min_severity=` — ноцтой байдлын ШАЛ.  Өгөөгүй бол
 * `bim.compliance.min_severity` (0228, анхдагч `HIGH`).  Шалнаас доогуур мөрийг
 * харах шаардлагатай самбар `?min_severity=INFO` дамжуулна — тэдгээр мөр
 * тоолуурт БАЙСААР байна (§76: «доогуур нь зөвхөн жагсаалтад орно, тоолуурт
 * нөлөөлнө, ХЭЗЭЭ Ч түлхэхгүй»).
 */
compliance.get('/notices', async (c) => {
  const viewer = c.get('user');
  const cfg = await loadComplianceConfig(c.env.DB);

  const asked = str(c.req.query('min_severity'), 16).toUpperCase();
  const floor: Severity = isSeverity(asked) ? asked : cfg.minSeverity;
  const allowed = SEVERITIES.filter((s) => SEVERITY_RANK[s] >= SEVERITY_RANK[floor]);

  // ⚠️ Bind дугаарлалт: ?1 = `user_id` (`OPEN_NOTICE_SQL` дотор), дараа нь
  //    ноцтой байдлын жагсаалт, эцэст нь заавал биш `doc_uid`.
  const binds: (string | number)[] = [viewer.sub, ...allowed];
  const sevPlaceholders = allowed.map((_, i) => `?${i + 2}`).join(', ');
  const docUid = str(c.req.query('doc_uid'), 128);

  let sql = `SELECT ${NOTICE_COLUMNS}
       FROM compliance_notice_state
      WHERE ${OPEN_NOTICE_SQL}
        AND severity IN (${sevPlaceholders})`;
  if (docUid) {
    binds.push(docUid);
    sql += `\n        AND doc_uid = ?${binds.length}`;
  }
  sql += `\n      ORDER BY ${SEVERITY_ORDER_SQL} DESC,
               COALESCE(last_shown_at, created_at) DESC, id DESC
      LIMIT ${MAX_NOTICE_ROWS}`;

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<Record<string, unknown>>();

  return c.json({
    notices: results ?? [],
    min_severity: floor,
    snooze_hours: cfg.snoozeHours,
  });
});

/**
 * `GET /api/compliance/notices/count` — ribbon товчны caption-ий тоо.
 *
 * Самбар ХААЛТТАЙ үед ч харагдах ЦОРЫН ГАНЦ гадаргуу тул `min_severity` ЭНД
 * ХЭРЭГЛЭГДЭХГҮЙ: шалнаас доогуур мөр ТООЛУУРТ НӨЛӨӨЛНӨ, зөвхөн түлхэлт
 * хийгдэхгүй.  `total` нь БҮХ нээлттэй мөр.
 *
 * ⚠️ Замын дараалал: `/notices/count` нь ХОЁР сегмент тул ГУРВАН сегменттэй
 *    `/notices/:dedupKey/state`-тай МӨРГӨЛДӨХГҮЙ.  `/notices/:key` хэлбэрийн
 *    маршрут дараа нэмэгдвэл түүнийг ЭНЭ мөрийн ДООР бүртгэ.
 */
compliance.get('/notices/count', async (c) => {
  const viewer = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT severity, COUNT(*) AS n
       FROM compliance_notice_state
      WHERE ${OPEN_NOTICE_SQL}
      GROUP BY severity`,
  )
    .bind(viewer.sub)
    .all<{ severity: string; n: number }>();

  let critical = 0;
  let high = 0;
  let total = 0;
  for (const r of results ?? []) {
    const n = Number(r.n) || 0;
    total += n;
    if (r.severity === 'CRITICAL') critical += n;
    else if (r.severity === 'HIGH') high += n;
  }
  return c.json({ critical, high, total });
});

interface NoticeStateBody {
  state?: unknown;
  severity?: unknown;
  rule_uid?: unknown;
  rule_version?: unknown;
  ruleset_version?: unknown;
  team_code?: unknown;
  doc_uid?: unknown;
  root_dedup_key?: unknown;
}

/**
 * `POST /api/compliance/notices/:dedupKey/state` — нэг мэдэгдлийн төлөв.
 *
 * `dedup_key` = `sha256(rule_uid || 0x00 || element_uid)`-ийн эхний 16 тэмдэгт
 * (0227-ийн толгой).  ⚠️ Тэр нь ХЭРЭГЛЭГЧЭЭР ХУВААГДДАГГҮЙ — ижил дүрэм ба
 * ижил элемент нь хүн бүрд ИЖИЛ түлхүүр өгнө.  Тусгаарлалт нь
 * `UNIQUE(user_id, dedup_key)` дээр зогсох тул энд ЗӨВХӨН `viewer.sub`-ийн
 * мөр бичигдэнэ.
 *
 * ⚠️ ХОЁР ӨӨР БИЧИЛТ:
 *   · `shown` нь UPSERT — мэдэгдлийг ХАРУУЛСАН мөч бол мөрийг ҮҮСГЭДЭГ ЦОРЫН
 *     ГАНЦ үйл явдал.  Үүнгүйгээр релиз N-д мөр ХЭЗЭЭ Ч үүсэхгүй ба 0227 нь
 *     бүхэлдээ уншигчгүй хүснэгт болно.
 *   · `acknowledged` / `snoozed` / `dismissed` нь ЗӨВХӨН UPDATE — байхгүй мөр
 *     дээр **404**.  Өөр хүний хариултыг өөрчлөх зам БАЙХГҮЙ (`WHERE user_id =
 *     ?1`), тиймээс энэ нь 403 БИШ 404: мөр нь ЗҮГЭЭР Л ОЛДОХГҮЙ.  Харагдаагүй
 *     зүйлийг «ойлголоо» гэж хэлэх боломжгүй, мөн 403 нь тэр мөр өөр хүн дээр
 *     ОРШИН БАЙГААГ ил болгоно.
 *
 * ⚠️ `shown` нь ХААЛТТАЙ мөрийг ДАХИН НЭЭХГҮЙ.  Тэгвэл дүгнэлт дахин илрэх
 *    бүрд ack утгаа алдаж, §76-ын БҮХ ядаргааны хяналт хүчингүй болно.  Ганц
 *    үл хамаарах зүйл: `ack_rule_version`-оос ӨӨР дүрмийн хувилбар ирвэл ack
 *    хүчингүй болно (0227: «ack нь ЗӨВХӨН тухайн дүрэм өөрчлөгдөхөд хүчингүй
 *    болно») — тэр үед л мөр `shown` руу буцна.
 */
compliance.post('/notices/:dedupKey/state', async (c) => {
  const viewer = c.get('user');
  const dedupKey = str(c.req.param('dedupKey'), 64);
  if (!dedupKey) return c.json({ error: 'dedup_key is required' }, 400);

  const body = await c.req.json<NoticeStateBody>().catch(() => ({}) as NoticeStateBody);
  if (!isNoticeState(body.state)) {
    return c.json({ error: 'bad state', allowed: NOTICE_STATES }, 400);
  }
  const state: NoticeState = body.state;
  const ruleVersion = intOrNull(body.rule_version);

  if (state === 'shown') {
    const severity: Severity = isSeverity(body.severity) ? body.severity : 'INFO';
    await c.env.DB.prepare(
      `INSERT INTO compliance_notice_state
         (user_id, dedup_key, state, severity, rule_uid, rule_version, ruleset_version,
          team_code, doc_uid, root_dedup_key, shown_count, first_shown_at, last_shown_at)
       VALUES (?1, ?2, 'shown', ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, datetime('now'), datetime('now'))
       ON CONFLICT (user_id, dedup_key) DO UPDATE SET
          state = CASE
                    WHEN compliance_notice_state.state = 'acknowledged'
                     AND compliance_notice_state.ack_rule_version IS NOT NULL
                     AND excluded.rule_version IS NOT NULL
                     AND excluded.rule_version <> compliance_notice_state.ack_rule_version
                      THEN 'shown'
                    WHEN compliance_notice_state.state IN ('new','shown') THEN 'shown'
                    ELSE compliance_notice_state.state
                  END,
          severity = excluded.severity,
          rule_uid = COALESCE(excluded.rule_uid, compliance_notice_state.rule_uid),
          rule_version = COALESCE(excluded.rule_version, compliance_notice_state.rule_version),
          ruleset_version = COALESCE(excluded.ruleset_version, compliance_notice_state.ruleset_version),
          team_code = COALESCE(excluded.team_code, compliance_notice_state.team_code),
          doc_uid = COALESCE(excluded.doc_uid, compliance_notice_state.doc_uid),
          root_dedup_key = COALESCE(excluded.root_dedup_key, compliance_notice_state.root_dedup_key),
          shown_count = compliance_notice_state.shown_count + 1,
          first_shown_at = COALESCE(compliance_notice_state.first_shown_at, datetime('now')),
          last_shown_at = datetime('now'),
          updated_at = datetime('now')`,
    )
      .bind(
        viewer.sub,
        dedupKey,
        severity,
        strOrNull(body.rule_uid, 64),
        ruleVersion,
        strOrNull(body.ruleset_version, 64),
        strOrNull(body.team_code, 16),
        strOrNull(body.doc_uid, 128),
        strOrNull(body.root_dedup_key, 64),
      )
      .run();
  } else {
    // ⚠️ `snooze_hours` нь СЕРВЕРИЙН дугуй (0228) — биеэс ХҮЛЭЭЖ АВАХГҮЙ, эс
    //    бөгөөс add-in өөрөө «10000 цаг» бичээд §76-ын хяналтыг тойрч гарна.
    const cfg = await loadComplianceConfig(c.env.DB);
    const res = await c.env.DB.prepare(
      `UPDATE compliance_notice_state SET
          state = ?3,
          ack_at = CASE WHEN ?3 = 'acknowledged' THEN datetime('now') ELSE ack_at END,
          ack_rule_version = CASE WHEN ?3 = 'acknowledged'
                                  THEN COALESCE(?4, rule_version)
                                  ELSE ack_rule_version END,
          snooze_until = CASE WHEN ?3 = 'snoozed' THEN datetime('now', ?5) ELSE NULL END,
          updated_at = datetime('now')
        WHERE user_id = ?1 AND dedup_key = ?2`,
    )
      .bind(viewer.sub, dedupKey, state, ruleVersion, `+${cfg.snoozeHours} hours`)
      .run();

    if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'not found' }, 404);
  }

  // ⚠️ Хадгалагдсан мөрийг БУЦААЖ УНШИНА — `shown` нь ХААЛТТАЙ мөрийн төлөвийг
  //    ЗОРИУД өөрчлөхгүй тул дуудагч «юу болсныг» таамаглах ЁСГҮЙ.
  const row = await c.env.DB.prepare(
    `SELECT ${NOTICE_COLUMNS} FROM compliance_notice_state
      WHERE user_id = ?1 AND dedup_key = ?2`,
  )
    .bind(viewer.sub, dedupKey)
    .first<Record<string, unknown>>();

  return c.json({ notice: row ?? null });
});

/* ================================================================== */
/*  ⬇⬇⬇  2-3 → 2-6 → 2-5 → 2-7 ЭНДЭЭС ДООШ                             */
/* ================================================================== */

/* ================================================================== */
/*  §56/§57/§58 — ОЛДВОРЫН АМЬД ТӨЛӨВ (`2-3-compliance-engine` §3.12)   */
/* ================================================================== */

/**
 * ⚠️ ЭНЭ БЛОК НЬ `2-3`-ЫНХ.  Дээрх `/pack`, `/rules`, `/documents`,
 * `/context`, `/tests`, `/conflicts` нь `2-2`-ынх, `/notices*` нь `2-4`-ийнх —
 * энэ сесс тэдгээрийг ХӨНДӨӨГҮЙ.  `new Hono()`, файлын түвшний
 * `requireRole`, `index.ts`-ийн `app.route` ба `lib/modules.ts`-ийн ангилал
 * БҮГД `2-2`-ынх, ЭНД ДАХИН зарлагдахгүй.
 *
 * ⚠️ ИМПОРТ НЬ ФАЙЛЫН ТӨГСГӨЛД.  ESM-ийн `import` нь модулийн дээд түвшинд
 * хаана ч байж болно (hoist хийгддэг).  Дээрх импортын блокт хүрэхгүй байх
 * нь ЗОРИУДЫН: тэр нь `2-2`-ын мөр бөгөөд зургаан сесс ЗЭРЭГ ажиллаж байна.
 * ⚠️ Дээр АЛЬ ХЭДИЙН импортлогдсон нэрийг (`isIssueClass`, `isSeverity`,
 * `SEVERITIES`, `SEVERITY_RANK`, `Severity`) ЭНД ДАХИН импортлохгүй —
 * `duplicate identifier` нь файлыг компайл болиулна.
 */
import {
  ALLOWED_TRANSITIONS,
  LIFECYCLE_STATES,
  OPEN_LIFECYCLE_STATES,
  STALEABLE_LIFECYCLE_STATES,
  STALE_REASONS,
  UNCERTAIN_REASONS,
  canTransition,
  dedupKeyOf,
  evaluationStateOf,
  isCoverage,
  isEvidenceLevel,
  isFindingElementRole,
  isLedgerSkipReason,
  isLifecycleState,
  isStaleReason,
  isVerdict,
  type Coverage,
  type EvidenceLevel,
  type FindingElementRole,
  type IssueClass,
  type LifecycleState,
  type Verdict,
} from '../lib/complianceModel';
import {
  writeBimBatch,
  stampTeam,
  partsForEvent,
  type LearningEventRow,
  type TeamSourceValue,
} from '../lib/bimEvents';

/* ------------------------------------------------------------------ */
/*  Хязгаарууд                                                         */
/* ------------------------------------------------------------------ */

/** Нэг POST-д хүлээж авах олдворын дээд тоо — `0208:27`-ийн `txn_batch_max`-тай нэг мөрөнд. */
const MAX_FINDINGS_PER_BATCH = 200;
/** Нэг POST-д хүлээж авах гүйлтийн бүртгэлийн мөрийн дээд тоо. */
const MAX_LEDGER_PER_BATCH = 200;
/** Нэг олдворт хамаарах элементийн дээд тоо (subject + context). */
const MAX_ELEMENTS_PER_FINDING = 32;
/** `GET /findings` / `GET /state`-ийн жагсаалтын дээд урт. */
const MAX_FINDING_ROWS = 200;
const MAX_STATE_LIST_ROWS = 50;
/** `IN (...)`-д нэг statement-д хийх түлхүүрийн дээд тоо (`routes/revit.ts:75`-ийн заншил). */
const KEYS_PER_LOOKUP = 50;
/** Ирмэг гаргаж авахад нэг багцаас авах элементийн uid-ийн дээд тоо. */
const MAX_EDGE_UIDS = 400;

/** `compliance_findings`-ийн УНШИХ баганын жагсаалт — гурван маршрут ХУВААЛЦАНА. */
const FINDING_COLUMNS = `id, finding_uid, project_id, doc_uid, session_id, owner_team_code,
       rule_uid, rule_version, ruleset_version, pack_sha256, semantic_hash,
       verdict, issue_class, evidence_level, severity, lifecycle_state, dedup_key,
       coverage, uncertain_reason, conflict_rule_uids_json, calc_json, evidence_json,
       recommendation_mn, model_state_hash, scan_generation,
       first_detected_at, last_evaluated_at, resolved_at, stale_at, stale_reason,
       ack_rule_version, updated_at`;

/** §58-ын хуучруулж БОЛОХ төлөвүүдийн SQL хэлбэр (`STALEABLE_LIFECYCLE_STATES`-ийн хос). */
const STALEABLE_SQL = STALEABLE_LIFECYCLE_STATES.map((s) => `'${s}'`).join(', ');
/** «НЭЭЛТТЭЙ»-ийн SQL хэлбэр (`OPEN_LIFECYCLE_STATES`-ийн хос). */
const OPEN_STATES_SQL = OPEN_LIFECYCLE_STATES.map((s) => `'${s}'`).join(', ');

function chunked<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** ISO-8601 UTC.  Клиентийн цаг хүчинтэй бол түүнийг, эс бөгөөс серверийнхийг. */
function isoOrNow(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length >= 10 && s.length <= 40 && !Number.isNaN(Date.parse(s))) return s;
  return new Date().toISOString();
}

const isUncertainReasonValue = (v: unknown): boolean =>
  typeof v === 'string' && (UNCERTAIN_REASONS as readonly string[]).includes(v);

/**
 * §3.9-ийн `ComplianceState.Apply`-ийн СЕРВЕР ТАЛ — амьдралын мөчлөгийн
 * ДАРААГИЙН төлөв.  ЦЭВЭР ФУНКЦ, ГАНЦ ХЭРЭГЖИЛТ.
 *
 * ⚠️ ХҮНИЙ ШИЙДВЭР ХОЖИНО.  `DISMISSED` / `INVALIDATED` нь дахин
 *    илрүүлэлтээр ХЭЗЭЭ Ч буцаж нээгдэхгүй — эс бөгөөс §76-ын ядаргааны
 *    хяналт бүхэлдээ хүчингүй болно (0227-ийн `shown` upsert-ийн ижил
 *    дүрэм).  Тэднийг нээх ЦОРЫН ГАНЦ зам нь `2-5`-ын override.
 *    ⚠️ Энэ хамгаалалт SQL-д ДАВХАР бичигдэнэ (`ON CONFLICT` дахь `CASE`) —
 *    JS ба DB-ийн хооронд уралдаан гарвал DB нь эцсийн шүүгч.
 * ⚠️ `ACKNOWLEDGED` нь дүрмийн ХУВИЛБАР өөрчлөгдөхөд Л хүчингүй болно
 *    (0227-ийн `ack_rule_version` гэрээ) — «ойлголоо» гэсэн хариулт нь
 *    засвар үйлчилгээний дахин нийтлэлт бүрд алдагдах ЁСГҮЙ.
 * ⚠️ `PASS` нь мөрийг УСТГАХГҮЙ — §56-ийн «аль нь засагдав» асуулт нь
 *    ТҮҮХ шаарддаг.
 */
function nextLifecycleState(
  prev: { lifecycle_state: string; ack_rule_version: number | null } | null,
  verdict: Verdict,
  ruleVersion: number,
): LifecycleState {
  if (prev === null) {
    if (verdict === 'PASS') return 'FIXED';
    return verdict === 'UNCERTAIN' ? 'UNCERTAIN' : 'OPEN';
  }
  const cur = prev.lifecycle_state;
  if (cur === 'DISMISSED' || cur === 'INVALIDATED') return cur;
  if (verdict === 'PASS') return 'FIXED';
  if (cur === 'FIXED') return 'REOPENED';
  if (cur === 'ACKNOWLEDGED') {
    const ack = prev.ack_rule_version;
    if (ack === null || ack === ruleVersion) return 'ACKNOWLEDGED';
    return verdict === 'UNCERTAIN' ? 'UNCERTAIN' : 'OPEN';
  }
  if (cur === 'REOPENED') return 'REOPENED';
  return verdict === 'UNCERTAIN' ? 'UNCERTAIN' : 'OPEN';
}

/* ------------------------------------------------------------------ */
/*  Сессийн БАГ — сервер шийднэ, клиент ХЭЗЭЭ Ч мэдүүлэхгүй             */
/* ------------------------------------------------------------------ */

interface SessionTeam {
  sessionId: number | null;
  projectId: number | null;
  teamCode: string | null;
  teamSource: TeamSourceValue;
  teamConfidence: number;
  attributionId: number | null;
}

/**
 * ⚠️ КЛИЕНТ БАГ ЗАРЛАЖ ЧАДАХГҮЙ (`learning.ts:338-340`-ийн заншил).  Багийг
 * `bim_sessions`-оос, §73-ын ГАРААР ЗАЛРУУЛСАН attribution-ыг түүний
 * ДЭЭГҮҮР авна — хүний залруулга ҮРГЭЛЖ ЯЛНА.
 *
 * ⚠️ ӨӨР ХҮНИЙ СЕССИЙГ ХҮЛЭЭЖ АВАХГҮЙ.  `session_id` нь дурын бүхэл тоо
 * байж болох ба хүлээн авбал өөр багийн `team_code` ЭНЭ хэрэглэгчийн
 * олдворт наалдана.  Таарахгүй бол сесс нь БАЙХГҮЙ мэт (баг `uncertain`) —
 * тэр нь `readiness_inputs.unattributed_findings`-ээр ИЛ гарна, ЧИМЭЭГҮЙ
 * алга болохгүй.
 *
 * ⚠️ ДҮРМИЙН БАГЦГҮЙ БАГ (`MGMT` / `EZ` / `GT`) нь ЭНД ЯЛГААГҮЙ — тэдний
 * БОДИТ код буцна.  «Багц бичигдээгүй» ба «баг тодорхойгүй» хоёр ӨӨР зүйл
 * (`2-1 §3.4`): эхнийх нь `team_code` бүхий мөр + `rule_run_ledger`-т мөргүй,
 * хоёр дахь нь `team_code IS NULL`.
 */
async function resolveSessionTeam(
  db: D1Database,
  userId: number,
  sessionId: number | null,
  knownTeams: ReadonlySet<string>,
): Promise<SessionTeam> {
  const out: SessionTeam = {
    sessionId: null,
    projectId: null,
    teamCode: null,
    teamSource: 'uncertain',
    teamConfidence: 0,
    attributionId: null,
  };

  const row = sessionId
    ? await db
        .prepare(
          `SELECT id, user_id, project_id, revit_document_id, team_code, team_source,
                  team_confidence
             FROM bim_sessions WHERE id = ?`,
        )
        .bind(sessionId)
        .first<Record<string, unknown>>()
    : null;

  let revitDocumentId: number | null = null;
  if (row && Number(row['user_id']) === userId) {
    out.sessionId = Number(row['id']);
    out.projectId = intOrNull(row['project_id']);
    revitDocumentId = intOrNull(row['revit_document_id']);
    const code = str(row['team_code'], 16);
    if (code && knownTeams.has(code)) {
      out.teamCode = code;
      out.teamSource = (str(row['team_source'], 32) || 'uncertain') as TeamSourceValue;
      out.teamConfidence = numOrNull(row['team_confidence']) ?? 0;
    }
  }

  // §73 — ХҮНИЙ залруулга ҮРГЭЛЖ ЯЛНА, мөн БИЧИХ МӨЧИД ХӨЛДӨНӨ.
  const live = await db
    .prepare(
      `SELECT id, verified_team_code
         FROM team_attributions
        WHERE user_id = ?
          AND superseded_at IS NULL
          AND verified_team_code IS NOT NULL
          AND COALESCE(revit_document_id, -1) IN (-1, COALESCE(?, -1))
        ORDER BY id DESC
        LIMIT 1`,
    )
    .bind(userId, revitDocumentId)
    .first<{ id: number; verified_team_code: string }>()
    .catch(() => null);

  if (live && knownTeams.has(live.verified_team_code)) {
    out.teamCode = live.verified_team_code;
    out.teamSource = 'manual';
    out.teamConfidence = 1;
    out.attributionId = live.id;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  POST /api/compliance/findings — add-in-ээс багц UPSERT              */
/* ------------------------------------------------------------------ */

interface RawFindingElement {
  element_uid?: unknown;
  element_id?: unknown;
  category?: unknown;
  level_name?: unknown;
  role?: unknown;
}

interface RawFindingItem {
  finding_uid?: unknown;
  dedup_key?: unknown;
  rule_uid?: unknown;
  rule_version?: unknown;
  ruleset_version?: unknown;
  pack_sha256?: unknown;
  semantic_hash?: unknown;
  verdict?: unknown;
  prev_verdict?: unknown;
  issue_class?: unknown;
  evidence_level?: unknown;
  severity?: unknown;
  coverage?: unknown;
  uncertain_reason?: unknown;
  conflict_rule_uids?: unknown;
  calc?: unknown;
  evidence?: unknown;
  recommendation_mn?: unknown;
  model_state_hash?: unknown;
  occurred_at?: unknown;
  elements?: unknown;
}

interface RawLedgerItem {
  rule_uid?: unknown;
  ruleset_version?: unknown;
  pack_sha256?: unknown;
  considered?: unknown;
  applicable?: unknown;
  evaluated?: unknown;
  skipped_reason?: unknown;
  aborted?: unknown;
}

interface FindingsBody {
  doc_uid?: unknown;
  project_id?: unknown;
  session_id?: unknown;
  scan_generation?: unknown;
  items?: unknown;
  ledger?: unknown;
}

interface ParsedElement {
  elementUid: string;
  elementId: number | null;
  category: string;
  levelName: string;
  role: FindingElementRole;
}

interface ParsedFinding {
  findingUid: string;
  dedupKey: string;
  ruleUid: string;
  ruleVersion: number;
  rulesetVersion: string;
  packSha256: string | null;
  semanticHash: string | null;
  verdict: Verdict;
  prevVerdict: Verdict | null;
  issueClass: IssueClass;
  evidenceLevel: EvidenceLevel;
  severity: Severity;
  coverage: Coverage;
  uncertainReason: string | null;
  conflictJson: string;
  calcJson: string;
  evidenceJson: string;
  recommendationMn: string | null;
  modelStateHash: string | null;
  occurredAt: string;
  elements: ParsedElement[];
  subjectUid: string;
  subjectElementId: number | null;
}

/**
 * `POST /api/compliance/findings` — өсөлтөт мөчлөгийн ГАРАЛТЫГ хүлээж авна.
 *
 * СЕРВЕРИЙН ЗААВАЛ ХИЙХ ДӨРӨВ (§3.12):
 *  1. `detected_by` нь ТОКЕНООС, клиентээс ХЭЗЭЭ Ч.
 *  2. `dedup_key`-г сервер ДАХИН тооцоолж, таарахгүй бол **400**.
 *  3. ДҮГНЭЛТ ӨӨРЧЛӨГДСӨН мөр бүрд ЯГ НЭГ `learning_events` мөр —
 *     `lib/bimEvents.ts`-ийн бичих ГАНЦ гарцаар.  ⚠️ `compliance.ts` нь
 *     `learning_events`-д ШУУД SQL БИЧИХГҮЙ (`check-bim-events.mjs` барина).
 *  4. ГУРВАН холбоос хүснэгтэд бичих — `finding_elements`, `finding_teams`,
 *     `finding_edges`.  Бичигчгүй орхивол `2-7`-ийн `INNER JOIN
 *     finding_teams` нь ЭЗЭМШИГЧ БАГТ Ч тэг мөр буцаана, §77-ийн граф МӨНХ
 *     ХООСОН үлдэнэ — ба алдаа нь 200 буцаах тул ХАРАГДАХГҮЙ.
 *
 * ⚠️ «ҮНЭЛГЭЭ БҮРТ» БИШ, «ТӨЛӨВ ӨӨРЧЛӨГДӨХ БҮРТ» (§3.4).  Ижил дүгнэлтийг
 * дахин илгээвэл `learning_events` ӨСӨХГҮЙ.  Шалтгаан нь арифметик: 2000
 * элементийн буулгалт x 5 хамаарах дүрэм = 10 000 мөр, дөчин Ctrl+Z нь
 * түүнийг дөч дахин давтана.  Өөрчлөлтийг СЕРВЕР шийднэ (хадгалагдсан
 * мөртэй харьцуулж), клиентийн `prev_verdict`-ээр БИШ — клиент худал
 * зарлаж чадна.
 *
 * ⚠️ ХАТУУ БАТАЛГААЖУУЛАЛТ.  Нэг ч зүйл буруу бол БҮХ багц 400 авна ба
 * НЭГ Ч мөр бичигдэхгүй.  Хэсэгчилсэн хүлээн авалт нь «хагас бичигдсэн
 * олдвор» үүсгэх ба тэр нь `2-5`-ын жагсаалтад заах юмгүй мөр болно.
 */
compliance.post('/findings', async (c) => {
  const viewer = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<FindingsBody>().catch(() => ({}) as FindingsBody);

  const docUid = str(body.doc_uid, 128);
  if (!docUid) return c.json({ error: 'doc_uid is required' }, 400);

  const rawItems: RawFindingItem[] = Array.isArray(body.items)
    ? (body.items as RawFindingItem[])
    : [];
  const rawLedger: RawLedgerItem[] = Array.isArray(body.ledger)
    ? (body.ledger as RawLedgerItem[])
    : [];

  if (rawItems.length > MAX_FINDINGS_PER_BATCH || rawLedger.length > MAX_LEDGER_PER_BATCH) {
    return c.json(
      { error: 'batch too large', max_items: MAX_FINDINGS_PER_BATCH, max_ledger: MAX_LEDGER_PER_BATCH },
      413,
    );
  }

  const scanGeneration = Math.max(0, intOrNull(body.scan_generation) ?? 0);
  const knownTeams = await knownTeamCodes(db);
  const session = await resolveSessionTeam(db, viewer.sub, intOrNull(body.session_id), knownTeams);
  const projectId = intOrNull(body.project_id) ?? session.projectId;

  /* ---- 1) ХАТУУ БАТАЛГААЖУУЛАЛТ ---------------------------------- */

  const parsed: ParsedFinding[] = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const raw = rawItems[i];
    if (!raw || typeof raw !== 'object') {
      return c.json({ error: 'bad item', index: i }, 400);
    }
    const findingUid = str(raw.finding_uid, 64);
    const ruleUid = str(raw.rule_uid, 64);
    if (!findingUid || !ruleUid) {
      return c.json({ error: 'finding_uid and rule_uid are required', index: i }, 400);
    }
    if (!isVerdict(raw.verdict)) return c.json({ error: 'bad verdict', index: i }, 400);
    if (!isIssueClass(raw.issue_class)) return c.json({ error: 'bad issue_class', index: i }, 400);
    if (!isEvidenceLevel(raw.evidence_level)) {
      return c.json({ error: 'bad evidence_level', index: i }, 400);
    }
    if (!isSeverity(raw.severity)) return c.json({ error: 'bad severity', index: i }, 400);

    // §3.8 — «үнэлж чадаагүй нь ХЭЗЭЭ Ч зөрчил биш».  `UNCERTAIN` мөр бүр
    // ЯАГААДаа хэлэх ЁСТОЙ: тэр нь тухайн дүрмийг засах ЦОРЫН ГАНЦ мөр.
    const uncertainReason = strOrNull(raw.uncertain_reason, 32);
    if (uncertainReason !== null && !isUncertainReasonValue(uncertainReason)) {
      return c.json({ error: 'bad uncertain_reason', index: i, allowed: UNCERTAIN_REASONS }, 400);
    }
    if (raw.verdict === 'UNCERTAIN' && uncertainReason === null) {
      return c.json(
        { error: 'uncertain_reason is required for UNCERTAIN', index: i, allowed: UNCERTAIN_REASONS },
        400,
      );
    }

    // ⚠️ `elements[]` ХООСОН бол 400.  `role='subject'` мөргүй олдвор нь
    //    `goto_element` хийх юмгүй, §58-ын 2-р гох (`edit`) нь тааруулах
    //    элементгүй, `2-5`-ын жагсаалт нь заах юмгүй болно.
    const rawElements = Array.isArray(raw.elements) ? (raw.elements as RawFindingElement[]) : [];
    if (rawElements.length === 0 || rawElements.length > MAX_ELEMENTS_PER_FINDING) {
      return c.json(
        { error: 'elements must hold 1..N entries', index: i, max: MAX_ELEMENTS_PER_FINDING },
        400,
      );
    }
    const elements: ParsedElement[] = [];
    const seenUids = new Set<string>();
    for (const rawEl of rawElements) {
      const elementUid = str(rawEl?.element_uid, 128);
      if (!elementUid || seenUids.has(elementUid)) continue;
      seenUids.add(elementUid);
      elements.push({
        elementUid,
        elementId: intOrNull(rawEl?.element_id),
        category: str(rawEl?.category, 64),
        levelName: str(rawEl?.level_name, 64),
        role: isFindingElementRole(rawEl?.role) ? rawEl.role : 'subject',
      });
    }
    // `subject` эхэнд: `idx_fe_uniq` нь (finding_id, element_uid) тул нэг uid
    // хоёр үүрэгтэй ирвэл ЭХНИЙХ нь үлдэнэ — тэр нь `subject` байх ёстой.
    elements.sort((a, b) => (a.role === b.role ? 0 : a.role === 'subject' ? -1 : 1));
    const subjects = elements.filter((e) => e.role === 'subject');
    if (subjects.length === 0) {
      return c.json({ error: 'at least one subject element is required', index: i }, 400);
    }

    // ⚠️ `dedup_key`-г СЕРВЕР ДАХИН ТООЦНО.  Түлхүүрийг клиент чөлөөтэй
    //    зохиовол `(doc_uid, detected_by, dedup_key)` дээрх UPSERT-ээр
    //    өөрийнхөө өөр олдворыг дарж бичиж чадна.  Олон `subject`-тэй
    //    олдворын хувьд АЛЬ НЭГ subject-ээс гарсан түлхүүр таарвал хангалттай
    //    — клиент нь дүрэм ажилласан элементийг сонгодог, сервер тэр
    //    сонголтыг ТААМАГЛАХГҮЙ, зөвхөн БАТАЛГААЖУУЛНА.
    const claimed = str(raw.dedup_key, 64);
    if (!claimed) return c.json({ error: 'dedup_key is required', index: i }, 400);
    let matchedSubject: ParsedElement | null = null;
    for (const s of subjects) {
      const computed = await dedupKeyOf(ruleUid, s.elementUid);
      if (computed === claimed) {
        matchedSubject = s;
        break;
      }
    }
    if (matchedSubject === null) {
      return c.json({ error: 'dedup_key does not match rule_uid + subject element', index: i }, 400);
    }

    const conflictJson = jsonText(raw.conflict_rule_uids ?? [], '[]');
    const calcJson = jsonText(raw.calc ?? {}, '{}');
    const evidenceJson = jsonText(raw.evidence ?? {}, '{}');
    if (conflictJson === null || calcJson === null || evidenceJson === null) {
      return c.json({ error: 'bad json payload', index: i }, 400);
    }

    parsed.push({
      findingUid,
      dedupKey: claimed,
      ruleUid,
      ruleVersion: Math.max(1, intOrNull(raw.rule_version) ?? 1),
      rulesetVersion: str(raw.ruleset_version, 64),
      packSha256: strOrNull(raw.pack_sha256, 64),
      semanticHash: strOrNull(raw.semantic_hash, 64),
      verdict: raw.verdict,
      prevVerdict: isVerdict(raw.prev_verdict) ? raw.prev_verdict : null,
      issueClass: raw.issue_class,
      evidenceLevel: raw.evidence_level,
      severity: raw.severity,
      coverage: isCoverage(raw.coverage) ? raw.coverage : 'full',
      uncertainReason,
      conflictJson,
      calcJson,
      evidenceJson,
      recommendationMn: strOrNull(raw.recommendation_mn, MAX_TEXT),
      modelStateHash: strOrNull(raw.model_state_hash, 64),
      occurredAt: isoOrNow(raw.occurred_at),
      elements,
      subjectUid: matchedSubject.elementUid,
      subjectElementId: matchedSubject.elementId,
    });
  }

  /* ---- 2) ГҮЙЛТИЙН БҮРТГЭЛ (0229) -------------------------------- */

  interface ParsedLedger {
    ruleUid: string;
    rulesetVersion: string;
    packSha256: string | null;
    considered: number;
    applicable: number;
    evaluated: number;
    skippedReason: string | null;
    aborted: number;
  }
  const ledger: ParsedLedger[] = [];
  for (let i = 0; i < rawLedger.length; i += 1) {
    const raw = rawLedger[i];
    const ruleUid = str(raw?.rule_uid, 64);
    if (!ruleUid) return c.json({ error: 'ledger.rule_uid is required', index: i }, 400);

    // ⚠️ ТООЛУУРЫН ДАРААЛАЛ нь ГЭРЭЭ: considered >= applicable >= evaluated.
    //    Клиентээс ирсэн зөрчлийг ТАТГАЛЗАХ биш ХАВЧИНА — бүртгэлийн мөр
    //    алдагдвал §69-ийн ногоон нь НОТОЛГООГҮЙ болно, тэр нь дутуу
    //    тоолуураас хамаагүй ДОР.
    const considered = Math.max(0, intOrNull(raw?.considered) ?? 0);
    const applicable = Math.min(considered, Math.max(0, intOrNull(raw?.applicable) ?? 0));
    const evaluated = Math.min(applicable, Math.max(0, intOrNull(raw?.evaluated) ?? 0));
    const aborted = Math.max(0, intOrNull(raw?.aborted) ?? 0);

    // ⚠️ `applicable = 0` бол ЯАГААД гэдэг нь ЗААВАЛ бичигдэнэ.  NULL үлдээвэл
    //    «хэзээ ч ажиллаагүй дүрэм» нь ЧИМЭЭГҮЙ болж, §69 нь түүнийг «цэвэр»
    //    гэж уншина.  Клиент шалтгаан мэдүүлээгүй бол `not_reported` —
    //    ХУДАЛ шалтгаан зохиохгүй, гэхдээ NULL ч үлдээхгүй.
    const claimedReason = strOrNull(raw?.skipped_reason, 32);
    let skippedReason: string | null = null;
    if (claimedReason !== null) {
      if (!isLedgerSkipReason(claimedReason)) {
        return c.json({ error: 'bad ledger.skipped_reason', index: i }, 400);
      }
      skippedReason = claimedReason;
    } else if (applicable === 0) {
      skippedReason = 'not_reported';
    }

    ledger.push({
      ruleUid,
      rulesetVersion: str(raw?.ruleset_version, 64),
      packSha256: strOrNull(raw?.pack_sha256, 64),
      considered,
      applicable,
      evaluated,
      skippedReason,
      aborted,
    });
  }

  if (parsed.length === 0 && ledger.length === 0) {
    return c.json({ accepted: 0, changed: 0, ledger_rows: 0, events: 0 });
  }

  /* ---- 3) ӨМНӨХ ТӨЛӨВ — «өөрчлөгдсөн үү» гэдгийг СЕРВЕР шийднэ ---- */

  interface PrevRow {
    id: number;
    dedup_key: string;
    verdict: string;
    severity: string;
    lifecycle_state: string;
    ack_rule_version: number | null;
    first_detected_at: string;
  }
  const prevByKey = new Map<string, PrevRow>();
  for (const part of chunked(parsed.map((p) => p.dedupKey), KEYS_PER_LOOKUP)) {
    const marks = part.map((_, i) => `?${i + 3}`).join(', ');
    const { results } = await db
      .prepare(
        `SELECT id, dedup_key, verdict, severity, lifecycle_state, ack_rule_version,
                first_detected_at
           FROM compliance_findings
          WHERE doc_uid = ?1 AND detected_by = ?2 AND dedup_key IN (${marks})`,
      )
      .bind(docUid, viewer.sub, ...part)
      .all<PrevRow>();
    for (const r of results ?? []) prevByKey.set(r.dedup_key, r);
  }

  const now = new Date().toISOString();
  const upserts: D1PreparedStatement[] = [];
  const changed: { item: ParsedFinding; prev: PrevRow | null; lifecycle: LifecycleState }[] = [];

  for (const item of parsed) {
    const prev = prevByKey.get(item.dedupKey) ?? null;
    const lifecycle = nextLifecycleState(prev, item.verdict, item.ruleVersion);

    // §3.4 — ижил дүгнэлт нь ЮУ Ч БИЧИХГҮЙ (үйл явдлын хувьд).  Мөр нь
    // ЗААВАЛ шинэчлэгдэнэ: `last_evaluated_at` ба §58-ын `stale_at = NULL`.
    const isChanged =
      prev === null ||
      prev.verdict !== item.verdict ||
      prev.severity !== item.severity ||
      prev.lifecycle_state !== lifecycle;
    if (isChanged) changed.push({ item, prev, lifecycle });

    const resolvedAt = item.verdict === 'PASS' ? now : null;

    upserts.push(
      db
        .prepare(
          `INSERT INTO compliance_findings (
             finding_uid, project_id, doc_uid, session_id, detected_by, owner_team_code,
             rule_uid, rule_version, ruleset_version, pack_sha256, semantic_hash,
             verdict, issue_class, evidence_level, severity, lifecycle_state, dedup_key,
             coverage, uncertain_reason, conflict_rule_uids_json, calc_json, evidence_json,
             recommendation_mn, model_state_hash, scan_generation,
             first_detected_at, last_evaluated_at, resolved_at, stale_at, stale_reason, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                   ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?26, ?27, NULL, NULL, datetime('now'))
           ON CONFLICT (doc_uid, detected_by, dedup_key) DO UPDATE SET
             project_id      = COALESCE(excluded.project_id, compliance_findings.project_id),
             session_id      = COALESCE(excluded.session_id, compliance_findings.session_id),
             owner_team_code = COALESCE(excluded.owner_team_code, compliance_findings.owner_team_code),
             rule_version    = excluded.rule_version,
             ruleset_version = excluded.ruleset_version,
             pack_sha256     = excluded.pack_sha256,
             semantic_hash   = excluded.semantic_hash,
             verdict         = excluded.verdict,
             issue_class     = excluded.issue_class,
             evidence_level  = excluded.evidence_level,
             severity        = excluded.severity,
             lifecycle_state = CASE
                                 WHEN compliance_findings.lifecycle_state IN ('DISMISSED','INVALIDATED')
                                   THEN compliance_findings.lifecycle_state
                                 ELSE excluded.lifecycle_state
                               END,
             coverage        = excluded.coverage,
             uncertain_reason = excluded.uncertain_reason,
             conflict_rule_uids_json = excluded.conflict_rule_uids_json,
             calc_json       = excluded.calc_json,
             evidence_json   = excluded.evidence_json,
             recommendation_mn = excluded.recommendation_mn,
             model_state_hash  = excluded.model_state_hash,
             scan_generation = excluded.scan_generation,
             last_evaluated_at = excluded.last_evaluated_at,
             resolved_at     = CASE
                                 WHEN excluded.verdict = 'PASS'
                                   THEN COALESCE(compliance_findings.resolved_at, excluded.resolved_at)
                                 ELSE NULL
                               END,
             stale_at        = NULL,
             stale_reason    = NULL,
             updated_at      = datetime('now')`,
        )
        .bind(
          item.findingUid,
          projectId,
          docUid,
          session.sessionId,
          viewer.sub,
          session.teamCode,
          item.ruleUid,
          item.ruleVersion,
          item.rulesetVersion,
          item.packSha256,
          item.semanticHash,
          item.verdict,
          item.issueClass,
          item.evidenceLevel,
          item.severity,
          lifecycle,
          item.dedupKey,
          item.coverage,
          item.uncertainReason,
          item.conflictJson,
          item.calcJson,
          item.evidenceJson,
          item.recommendationMn,
          item.modelStateHash,
          scanGeneration,
          now,
          resolvedAt,
        ),
    );
  }

  /* ---- 4) ГҮЙЛТИЙН БҮРТГЭЛИЙН INSERT ----------------------------- */

  // 13 bind / мөр → `floor(100 / 14) = 7` мөр / statement (D1-ийн 100 bind таг).
  const LEDGER_ROWS_PER_STATEMENT = 7;
  const ledgerStatements: D1PreparedStatement[] = [];
  for (const part of chunked(ledger, LEDGER_ROWS_PER_STATEMENT)) {
    const tuple = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const binds: (string | number | null)[] = [];
    for (const l of part) {
      binds.push(
        projectId,
        docUid,
        session.sessionId,
        scanGeneration,
        l.ruleUid,
        l.rulesetVersion,
        l.packSha256,
        session.teamCode,
        l.considered,
        l.applicable,
        l.evaluated,
        l.skippedReason,
        l.aborted,
      );
    }
    ledgerStatements.push(
      db
        .prepare(
          `INSERT INTO rule_run_ledger
             (project_id, doc_uid, session_id, scan_generation, rule_uid, ruleset_version,
              pack_sha256, team_code, considered, applicable, evaluated, skipped_reason, aborted)
           VALUES ${part.map(() => tuple).join(', ')}`,
        )
        .bind(...binds),
    );
  }

  if (upserts.length > 0 || ledgerStatements.length > 0) {
    await db.batch([...upserts, ...ledgerStatements]);
  }

  /* ---- 5) id-г буцааж уншина (холбоос хүснэгтүүдэд хэрэгтэй) ------ */

  const idByKey = new Map<string, number>();
  const keyById = new Map<number, ParsedFinding>();
  for (const part of chunked(parsed.map((p) => p.dedupKey), KEYS_PER_LOOKUP)) {
    const marks = part.map((_, i) => `?${i + 3}`).join(', ');
    const { results } = await db
      .prepare(
        `SELECT id, dedup_key FROM compliance_findings
          WHERE doc_uid = ?1 AND detected_by = ?2 AND dedup_key IN (${marks})`,
      )
      .bind(docUid, viewer.sub, ...part)
      .all<{ id: number; dedup_key: string }>();
    for (const r of results ?? []) idByKey.set(r.dedup_key, r.id);
  }
  for (const p of parsed) {
    const id = idByKey.get(p.dedupKey);
    if (id !== undefined) keyById.set(id, p);
  }

  /* ---- 6) ЗААВАЛ БИЧИХ ХОЛБООС — elements + owner team ----------- */

  const linkStatements: D1PreparedStatement[] = [];

  // 6 bind / мөр → `floor(100 / 7) = 14` мөр / statement.
  const ELEMENT_ROWS_PER_STATEMENT = 14;
  interface ElementBind {
    findingId: number;
    el: ParsedElement;
  }
  const elementBinds: ElementBind[] = [];
  for (const p of parsed) {
    const fid = idByKey.get(p.dedupKey);
    if (fid === undefined) continue;
    for (const el of p.elements) elementBinds.push({ findingId: fid, el });
  }
  for (const part of chunked(elementBinds, ELEMENT_ROWS_PER_STATEMENT)) {
    const binds: (string | number | null)[] = [];
    for (const b of part) {
      binds.push(b.findingId, b.el.elementUid, b.el.elementId, b.el.category, b.el.levelName, b.el.role);
    }
    linkStatements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO finding_elements
             (finding_id, element_uid, element_id, category, level_name, role)
           VALUES ${part.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
        )
        .bind(...binds),
    );
  }

  // ⚠️ `owner` мөр нь баг ШИЙДЭГДСЭН олдвор бүрд ЯМАР Ч НӨХЦӨЛГҮЙ бичигдэнэ.
  //    Сессийн баг `uncertain` бол мөр БИЧИГДЭХГҮЙ — тэр нь ЗӨВ: буруу багт
  //    хамааруулснаас харагдахгүй нь дээр.  ГЭХДЭЭ энэ тохиолдол
  //    `readiness_inputs.unattributed_findings`-ээр ИЛ гарна.
  if (session.teamCode !== null) {
    const TEAM_ROWS_PER_STATEMENT = 25;
    const ids = parsed
      .map((p) => idByKey.get(p.dedupKey))
      .filter((v): v is number => v !== undefined);
    for (const part of chunked(ids, TEAM_ROWS_PER_STATEMENT)) {
      const binds: (string | number)[] = [];
      for (const fid of part) binds.push(fid, session.teamCode, 'owner');
      linkStatements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO finding_teams (finding_id, team_code, relation)
             VALUES ${part.map(() => '(?, ?, ?)').join(', ')}`,
          )
          .bind(...binds),
      );
    }
  }

  if (linkStatements.length > 0) await db.batch(linkStatements);

  /* ---- 7) ИРМЭГ ГАРГАЖ АВАХ — ГУРВАН ДЕТЕРМИНИСТ ДҮРЭМ ----------- */

  const edges = await deriveFindingEdges(db, {
    docUid,
    batchIds: new Set(idByKey.values()),
    batchUids: [...new Set(parsed.flatMap((p) => p.elements.map((e) => e.elementUid)))].slice(
      0,
      MAX_EDGE_UIDS,
    ),
    batchDedupKeys: parsed.map((p) => p.dedupKey),
  });
  if (edges.statements.length > 0) await db.batch(edges.statements);

  /* ---- 8) `learning_events` — ЗӨВХӨН ӨӨРЧЛӨГДСӨН МӨР -------------- */

  let eventsWritten = 0;
  if (changed.length > 0) {
    // ⚠️ `verification_state` нь БИЧИХ МӨЧИД ХӨЛДӨНӨ (§3.4).  `learning_events`
    //    нь 0206-ын trigger-ээр ХӨДӨЛШГҮЙ тул хожим JOIN-оор шийдэх нь
    //    түүхийг ЧИМЭЭГҮЙ дахин шошголно.  ⚠️ Дүрэм ОЛДОХГҮЙ бол
    //    `UNVERIFIED` — хамгийн БАГА нэхэмжлэл (эзний Ш4-ийн дараа `rules`
    //    ХООСОН тул энэ нь ХЭВИЙН зам, ирмэгийн тохиолдол БИШ).
    const verifByRule = new Map<string, string>();
    const ruleUids = [...new Set(changed.map((ch) => ch.item.ruleUid))];
    for (const part of chunked(ruleUids, KEYS_PER_LOOKUP)) {
      const marks = part.map(() => '?').join(', ');
      const { results } = await db
        .prepare(
          `SELECT rule_uid, verification_state FROM rules WHERE rule_uid IN (${marks})`,
        )
        .bind(...part)
        .all<{ rule_uid: string; verification_state: string }>()
        .catch(() => ({ results: [] as { rule_uid: string; verification_state: string }[] }));
      for (const r of results ?? []) verifByRule.set(r.rule_uid, r.verification_state);
    }

    // ⚠️ `UNIQUE(stream_id, seq)` (0205:168).  Урсгалыг СЕССИ x ҮЕ-ээр
    //    тусгаарлана: ижил багцыг дахин илгээвэл `stream_id`, `seq` ба
    //    `event_uid` ГУРВУУЛАА ижил гарч `ON CONFLICT (event_uid) DO NOTHING`
    //    түүнийг чимээгүй залгина.  Revit дахин эхлэхэд `session_id` шинэ
    //    болдог тул үеийн тоолуур тэглэгдэх нь мөргөлдөөн үүсгэхгүй.
    const streamId = `cf:${session.sessionId ?? `u${viewer.sub}`}:${scanGeneration}`.slice(0, 64);

    const events: LearningEventRow[] = changed.map((ch, idx) => {
      const item = ch.item;
      const payload = stampTeam(
        {
          // ⚠️ ХОЁР ЗААВАЛ ТҮЛХҮҮР.  `rule_id` нь 0209:27-ийн GENERATED
          //    VIRTUAL багана, `passed` нь `bimEvents.ts:741`-ийн хоёр дахь
          //    нөхцөл — хоёулаа байж байж `RULE_VERDICT` бит асна.
          rule_id: item.ruleUid,
          passed: item.verdict === 'PASS',
          finding_uid: item.findingUid,
          verdict: item.verdict,
          prev_verdict: ch.prev ? ch.prev.verdict : null,
          lifecycle_state: ch.lifecycle,
          issue_class: item.issueClass,
          evidence_level: item.evidenceLevel,
          severity: item.severity,
          coverage: item.coverage,
          uncertain_reason: item.uncertainReason,
          scan_generation: scanGeneration,
          verification_state: verifByRule.get(item.ruleUid) ?? 'UNVERIFIED',
          rule_version: item.ruleVersion,
          ruleset_version: item.rulesetVersion,
          pack_sha256: item.packSha256,
          element_uid: item.subjectUid,
          doc_uid: docUid,
        },
        {
          team_code: session.teamCode,
          team_source: session.teamSource,
          team_confidence: session.teamConfidence,
          attribution_id: session.attributionId,
        },
      );

      const { expected, present } = partsForEvent({
        kind: 'RULE_VALIDATION',
        artifactResolved: false,
        txn: 'none',
        parent: 'none',
        payload,
      });

      return {
        session_id: session.sessionId,
        stream_id: streamId,
        seq: idx,
        event_uid: `cf-${viewer.sub}-${item.dedupKey}-${scanGeneration}-${item.verdict}`.slice(0, 64),
        kind: 'RULE_VALIDATION',
        actor_kind: 'rule',
        actor_user_id: viewer.sub,
        project_id: projectId,
        task_id: null,
        doc_uid: docUid,
        txn_uid: null,
        element_id: item.subjectElementId,
        parent_event_uid: null,
        causal_event_uid: null,
        artifact_id: null,
        payload_json: JSON.stringify(payload),
        parts_expected: expected,
        parts_present: present,
        // ⚠️ Ingest нь ГАРАЛ ҮҮСЛИЙГ ХЭЗЭЭ Ч дээшлүүлэхгүй.  `RULE_VERIFIED`
        //    нь ЗӨВХӨН курацийн UI-аас ирнэ — add-in өөрийгөө
        //    «баталгаажсан» гэж зарлаж чадах ЁСГҮЙ.
        provenance: 'MACHINE_GENERATED',
        model_version: null,
        ruleset_version: item.rulesetVersion || null,
        occurred_at: item.occurredAt,
      };
    });

    const result = await writeBimBatch(db, { txns: [], touches: [], events });
    eventsWritten = result.accepted.events;
  }

  return c.json({
    accepted: parsed.length,
    changed: changed.length,
    ledger_rows: ledger.length,
    events: eventsWritten,
    edges: edges.counts,
    team_code: session.teamCode,
    // ⚠️ Баг ШИЙДЭГДЭЭГҮЙ нь ЧИМЭЭГҮЙ БАЙЖ БОЛОХГҮЙ — клиент ч мэдэх ёстой.
    unattributed: session.teamCode === null,
  });
});

/* ------------------------------------------------------------------ */
/*  §3.12 — ИРМЭГ ГАРГАЖ АВАХ ГУРВАН ДЕТЕРМИНИСТ ДҮРЭМ                  */
/* ------------------------------------------------------------------ */

interface EdgeInput {
  docUid: string;
  batchIds: ReadonlySet<number>;
  batchUids: readonly string[];
  batchDedupKeys: readonly string[];
}

interface EdgeOutput {
  statements: D1PreparedStatement[];
  counts: { causes: number; duplicates: number; conflicts_with: number };
}

/**
 * ⚠️ ГУРВУУЛАА ДЕТЕРМИНИСТ, LLM БАЙХГҮЙ.  Элементийн хамаарлаас гарахгүй
 * ирмэг нь МӨР БОЛОХГҮЙ — граф хоосон байх нь буруу ирмэгээс ДЭЭР.
 *
 * ⚠️ ХАМРАХ ХҮРЭЭ: ирмэг тус бүрийн НЭГ тал нь ЭНЭ багцад ирсэн олдвор байх
 * ЁСТОЙ, нөгөө тал нь ижил `doc_uid` доторх аль ч олдвор байж болно.  Ингэснээр
 * өртөг нь `багцын хэмжээ x индексийн хайлт` болно, бүтэн баримтын хөндлөн
 * үржвэр БИШ — ба хоёр дахь инженер хожим илгээхэд ирмэг нь ХОЙШ БУС, тэр
 * мөчид үүснэ.
 *
 * ⚠️ ЧИГЛЭЛ: `from` = ҮНДЭС, `to` = ҮР ДАГАВАР.  `2-7` нь
 * `to_finding_id`-ыг `caused_by_count` гэж уншина, `2-5` нь `causes`-ийн
 * дээгүүр ДЭЭШ явж үндсийг олно.  Урвуулбал §77-ийн «1 үндэс + N үр дагавар»
 * толин тусгал болж, хоёр уншигч хоёулаа мөр буцаах тул ХЭН Ч анзаарахгүй.
 *
 * ⚠️ Бүгд `INSERT OR IGNORE` (`idx_fedge_uniq`) тул давтан илгээлт мөр
 * НЭМЭХГҮЙ.
 */
async function deriveFindingEdges(db: D1Database, input: EdgeInput): Promise<EdgeOutput> {
  const counts = { causes: 0, duplicates: 0, conflicts_with: 0 };
  const seen = new Set<string>();
  const rows: { from: number; to: number; kind: string }[] = [];

  const add = (from: number, to: number, kind: 'causes' | 'duplicates' | 'conflicts_with') => {
    if (from === to) return;
    const key = `${from}|${to}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ from, to, kind });
    counts[kind] += 1;
  };

  /* -- (а) `causes` — A-ийн subject нь B-ийн context дунд байвал A → B -- */
  interface ElemRow {
    finding_id: number;
    element_uid: string;
    role: string;
    rule_uid: string;
  }
  const byUid = new Map<string, ElemRow[]>();
  if (input.batchUids.length > 0) {
    for (const part of chunked(input.batchUids, KEYS_PER_LOOKUP)) {
      const marks = part.map((_, i) => `?${i + 2}`).join(', ');
      const { results } = await db
        .prepare(
          `SELECT e.finding_id, e.element_uid, e.role, f.rule_uid
             FROM finding_elements e
             JOIN compliance_findings f ON f.id = e.finding_id
            WHERE f.doc_uid = ?1 AND e.element_uid IN (${marks})`,
        )
        .bind(input.docUid, ...part)
        .all<ElemRow>();
      for (const r of results ?? []) {
        const list = byUid.get(r.element_uid);
        if (list) list.push(r);
        else byUid.set(r.element_uid, [r]);
      }
    }
  }

  for (const list of byUid.values()) {
    for (const a of list) {
      if (a.role !== 'subject') continue;
      for (const b of list) {
        if (b.role !== 'context') continue;
        // Ирмэгийн НЭГ тал нь энэ багцынх байх ЁСТОЙ (хамрах хүрээний дүрэм).
        if (!input.batchIds.has(a.finding_id) && !input.batchIds.has(b.finding_id)) continue;
        add(a.finding_id, b.finding_id, 'causes');
      }
    }
  }

  /* -- (б) `conflicts_with` — ижил элемент дээрх бүртгэгдсэн зөрчил ---- */
  // ⚠️ `rules` ХООСОН үед `rule_conflicts` ч хоосон тул энэ бүхэн NO-OP —
  //    алдаа БИШ, эзний Ш4-ийн ХЭВИЙН эхлэлийн төлөв.
  const conflictPairs = new Set<string>();
  const conflictWinner = new Map<string, string>();
  {
    const { results } = await db
      .prepare(`SELECT rule_uid_a, rule_uid_b, precedence FROM rule_conflicts`)
      .all<{ rule_uid_a: string; rule_uid_b: string; precedence: string | null }>()
      .catch(() => ({ results: [] as { rule_uid_a: string; rule_uid_b: string; precedence: string | null }[] }));
    for (const r of results ?? []) {
      const [lo, hi] = r.rule_uid_a <= r.rule_uid_b
        ? [r.rule_uid_a, r.rule_uid_b]
        : [r.rule_uid_b, r.rule_uid_a];
      const key = `${lo}|${hi}`;
      conflictPairs.add(key);
      // v2 §64 «hierarchy IF KNOWN» — `precedence` мэдэгдэхгүй бол ЯЛАГЧ
      // БАЙХГҮЙ ба `responsible` мөр БИЧИГДЭХГҮЙ.
      if (r.precedence === 'a_wins') conflictWinner.set(key, r.rule_uid_a);
      else if (r.precedence === 'b_wins') conflictWinner.set(key, r.rule_uid_b);
    }
  }

  const conflictingFindingRules = new Map<number, string>();
  // olдвор → ЯЛСАН дүрмийн uid.  ⚠️ ЯЛАГЧ нь ХОЁУЛАНГ НЬ шошголно: «хэн
  // шийднэ» гэдэг нь ялсан талд Л биш, ялагдсан талд Ч хэрэгтэй хариулт.
  const winnerRuleByFinding = new Map<number, string>();
  if (conflictPairs.size > 0) {
    for (const list of byUid.values()) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i];
          const b = list[j];
          if (!a || !b) continue;
          if (a.rule_uid === b.rule_uid) continue;
          if (!input.batchIds.has(a.finding_id) && !input.batchIds.has(b.finding_id)) continue;
          const [lo, hi] = a.rule_uid <= b.rule_uid ? [a, b] : [b, a];
          if (!conflictPairs.has(`${lo.rule_uid}|${hi.rule_uid}`)) continue;
          // Хоёр чиглэлд НЭГ мөр — `from` нь ordinal-аар бага `rule_uid`-тай
          // олдвор (тогтвортой, багцын дараалалаас ҮЛ ХАМААРНА).
          add(lo.finding_id, hi.finding_id, 'conflicts_with');
          conflictingFindingRules.set(lo.finding_id, lo.rule_uid);
          conflictingFindingRules.set(hi.finding_id, hi.rule_uid);
          const winner = conflictWinner.get(`${lo.rule_uid}|${hi.rule_uid}`);
          if (winner) {
            winnerRuleByFinding.set(lo.finding_id, winner);
            winnerRuleByFinding.set(hi.finding_id, winner);
          }
        }
      }
    }
  }

  /* -- (в) `duplicates` — ижил dedup_key, ӨӨР detected_by --------------- */
  if (input.batchDedupKeys.length > 0) {
    const dupByKey = new Map<string, { id: number; detected_by: number }[]>();
    for (const part of chunked([...new Set(input.batchDedupKeys)], KEYS_PER_LOOKUP)) {
      const marks = part.map((_, i) => `?${i + 2}`).join(', ');
      const { results } = await db
        .prepare(
          `SELECT id, dedup_key, detected_by FROM compliance_findings
            WHERE doc_uid = ?1 AND dedup_key IN (${marks})`,
        )
        .bind(input.docUid, ...part)
        .all<{ id: number; dedup_key: string; detected_by: number }>();
      for (const r of results ?? []) {
        const list = dupByKey.get(r.dedup_key);
        if (list) list.push({ id: r.id, detected_by: r.detected_by });
        else dupByKey.set(r.dedup_key, [{ id: r.id, detected_by: r.detected_by }]);
      }
    }
    for (const list of dupByKey.values()) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i];
          const b = list[j];
          if (!a || !b) continue;
          if (a.detected_by === b.detected_by) continue;
          if (!input.batchIds.has(a.id) && !input.batchIds.has(b.id)) continue;
          const lo = a.id < b.id ? a.id : b.id;
          const hi = a.id < b.id ? b.id : a.id;
          add(lo, hi, 'duplicates');
        }
      }
    }
  }

  /* -- ирмэгийн statement-үүд ба зөрчилдсөн БАГУУДЫН мөр ---------------- */
  const statements: D1PreparedStatement[] = [];
  const EDGE_ROWS_PER_STATEMENT = 25;
  for (const part of chunked(rows, EDGE_ROWS_PER_STATEMENT)) {
    const binds: (string | number)[] = [];
    for (const e of part) binds.push(e.from, e.to, e.kind);
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO finding_edges (from_finding_id, to_finding_id, kind)
           VALUES ${part.map(() => '(?, ?, ?)').join(', ')}`,
        )
        .bind(...binds),
    );
  }

  // §60-R3 — САЛБАР ХООРОНДЫН зөрчил илэрвэл ЗӨРЧИЛДӨГЧ ДҮРМИЙН баг
  // ХОЁУЛАА `affected` мөр авна, `precedence` мэдэгдэж байвал ЯЛСАН дүрмийн
  // баг `responsible` мөр авна.
  if (conflictingFindingRules.size > 0) {
    const uids = [
      ...new Set([...conflictingFindingRules.values(), ...winnerRuleByFinding.values()]),
    ];
    const teamByRule = new Map<string, string>();
    for (const part of chunked(uids, KEYS_PER_LOOKUP)) {
      const marks = part.map(() => '?').join(', ');
      const { results } = await db
        .prepare(`SELECT rule_uid, team_code FROM rules WHERE rule_uid IN (${marks})`)
        .bind(...part)
        .all<{ rule_uid: string; team_code: string | null }>()
        .catch(() => ({ results: [] as { rule_uid: string; team_code: string | null }[] }));
      for (const r of results ?? []) if (r.team_code) teamByRule.set(r.rule_uid, r.team_code);
    }

    const teamRows: { fid: number; team: string; relation: string }[] = [];
    for (const [fid, ruleUid] of conflictingFindingRules) {
      const team = teamByRule.get(ruleUid);
      if (team) teamRows.push({ fid, team, relation: 'affected' });
      // v2 §64 «hierarchy IF KNOWN» — `precedence` нь NULL / 'unknown' бол
      // мөр БИЧИГДЭХГҮЙ.  Хуурамч эрх мэдэл зохиохоос хоосон үлдэх нь ДЭЭР.
      const winnerRule = winnerRuleByFinding.get(fid);
      const winnerTeam = winnerRule ? teamByRule.get(winnerRule) : undefined;
      if (winnerTeam) teamRows.push({ fid, team: winnerTeam, relation: 'responsible' });
    }
    for (const part of chunked(teamRows, 25)) {
      const binds: (string | number)[] = [];
      for (const t of part) binds.push(t.fid, t.team, t.relation);
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO finding_teams (finding_id, team_code, relation)
             VALUES ${part.map(() => '(?, ?, ?)').join(', ')}`,
          )
          .bind(...binds),
      );
    }
  }

  return { statements, counts };
}

/* ------------------------------------------------------------------ */
/*  POST /api/compliance/findings/stale — §58-ын 1 ба 2-р гохын СЕРВЕР   */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЯАГААД ТУСДАА МАРШРУТ ВЭ.  `POST /findings` нь ЗӨВХӨН клиентийн ДАХИН
 * ИЛГЭЭСЭН мөрийг хөндөнө, харин хуучруулалтын БҮХ УТГА нь клиент яг одоо
 * үнэлээгүй байгаа мөрүүдэд байна: BB нь sync хийхэд BA-ийн олдвор нь дахин
 * үнэлэгдээгүй ЧИГЭЭРЭЭ эргэлзээтэй болно.  UPSERT-ээр үүнийг илэрхийлэх
 * арга БАЙХГҮЙ.  Энэ маршрутгүйгээр `stale_at` ба `idx_cf_stale` нь
 * БИЧИГЧГҮЙ үлдэж, `2-7`-ийн `AND f.stale_at IS NULL` шүүлт NO-OP болно.
 *
 * ⚠️ `detected_by = viewer.sub` шүүлт нь ЗААВАЛ — эс тэгвээс нэг инженерийн
 * «Reload Latest» нь тэр төв загвар дээр ажиллаж буй БҮХ хүний олдворыг
 * саарал болгоно.
 *
 * ⚠️ ХААЛТТАЙ (`FIXED` / `DISMISSED` / `INVALIDATED`) мөр хуучирдаггүй —
 * зассан ажлыг эргэлзээтэй мэт харуулах нь §58-ын зорилгын ЭСРЭГ.
 */
compliance.post('/findings/stale', async (c) => {
  const viewer = c.get('user');
  const body = await c.req
    .json<{ doc_uid?: unknown; reason?: unknown; dedup_keys?: unknown }>()
    .catch(() => ({}) as { doc_uid?: unknown; reason?: unknown; dedup_keys?: unknown });

  const docUid = str(body.doc_uid, 128);
  if (!docUid) return c.json({ error: 'doc_uid is required' }, 400);
  if (!isStaleReason(body.reason)) {
    return c.json({ error: 'bad reason', allowed: STALE_REASONS }, 400);
  }
  const reason = body.reason;

  const keys = Array.isArray(body.dedup_keys)
    ? [...new Set((body.dedup_keys as unknown[]).map((k) => str(k, 64)).filter((k) => k.length > 0))]
    : [];
  if (keys.length > MAX_FINDINGS_PER_BATCH) {
    return c.json({ error: 'too many dedup_keys', max: MAX_FINDINGS_PER_BATCH }, 413);
  }

  let staled = 0;
  if (keys.length === 0) {
    // `dedup_keys` БАЙХГҮЙ = тухайн БАРИМТЫН БҮГД (гох 1, `sync`).
    const res = await c.env.DB.prepare(
      `UPDATE compliance_findings
          SET stale_at = datetime('now'), stale_reason = ?2, updated_at = datetime('now')
        WHERE doc_uid = ?1
          AND detected_by = ?3
          AND stale_at IS NULL
          AND lifecycle_state IN (${STALEABLE_SQL})`,
    )
      .bind(docUid, reason, viewer.sub)
      .run();
    staled = res.meta.changes ?? 0;
  } else {
    for (const part of chunked(keys, KEYS_PER_LOOKUP)) {
      const marks = part.map((_, i) => `?${i + 4}`).join(', ');
      const res = await c.env.DB.prepare(
        `UPDATE compliance_findings
            SET stale_at = datetime('now'), stale_reason = ?2, updated_at = datetime('now')
          WHERE doc_uid = ?1
            AND detected_by = ?3
            AND stale_at IS NULL
            AND lifecycle_state IN (${STALEABLE_SQL})
            AND dedup_key IN (${marks})`,
      )
        .bind(docUid, reason, viewer.sub, ...part)
        .run();
      staled += res.meta.changes ?? 0;
    }
  }

  return c.json({ staled });
});

/* ------------------------------------------------------------------ */
/*  §58-ын ГУРАВ ДАХЬ ГОХ — `ruleset` / `central`, УНШИХ ҮЕД             */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ CRON БИШ.  `wrangler.toml`-д ЯГ ХОЁР `crons` илэрхийлэл байна ба
 * `index.ts`-ийн `scheduled` салаа нь `'* * * * *'`-ЭЭС БУСАД БҮХ мөрд дөрвөн
 * ажлыг ажиллуулдаг — гурав дахь илэрхийлэл нэмэх нь тэр дөрвийг ДАВХАР
 * ажиллуулна.  Тиймээс хуучруулалт нь УНШИХ ҮЕД (stale-on-read).
 *
 * `ruleset` — ХОЁР бие даасан шалгуур, ХОЁУЛАА ЗААВАЛ:
 *   (1) олдворын `pack_sha256` нь `rule_pack_versions`-ийн НИЙТЛЭГДСЭН
 *       мөрүүдийн дунд БАЙХГҮЙ бол багц солигдсон.  ⚠️ `pack_sha256` нь
 *       ОДОО агуулгаас гардаг (`rulesetVersionOf`-ийн зонд `generated_at`-ыг
 *       маскална) — өмнөх хувилбар нь UTC шөнө дунд бүрд хөдөлж, ӨДӨР БҮР
 *       БҮХ олдворыг шалтгаангүй хуучруулдаг байв.
 *   (2) дүрмийн `semantic_hash` өөрчлөгдсөн бол дүрэм өөрөө ӨӨР асуулт
 *       болсон.  Хавсралт §8.5: `clause_uid` бөглөх нь `semantic_hash`-ыг
 *       ХӨДӨЛГӨХГҮЙ тул (1)-гүйгээр (2) ГАНЦААРАА хангалтгүй.
 *
 * ⚠️ `pack_sha256 IS NULL` мөр (дүрмийн багцгүй, эсвэл хуучин клиент) нь
 *    ХУУЧРАХГҮЙ — «багц мэдэгдэхгүй» нь «багц солигдсон» гэсэн үг БИШ.
 *    Эзний Ш4-ийн дараа (rules ХООСОН) `rule_pack_versions` ч хоосон тул
 *    энэ UPDATE нь бүхэлдээ NO-OP — ба тэр нь ЗӨВ: нийтлэгдсэн багц
 *    байхгүй үед «багц солигдсон» гэж хэлэх боломжгүй.
 *
 * `central` — олдворын сессээс ХОЙШ ижил баримт дээр ижил хэрэглэгчийн ӨӨР
 * `central_path_hash`-тай сесс нээгдсэн бол төв загвар солигдсон
 * (`bim_sessions.central_path_hash`, `0202:62`).
 */
async function applyReadTimeStaleness(
  db: D1Database,
  userId: number,
  projectId: number,
  docUid: string,
): Promise<{ ruleset: number; central: number }> {
  const docFilter = `AND (?3 = '' OR doc_uid = ?3)`;

  const rulesetRes = await db
    .prepare(
      `UPDATE compliance_findings
          SET stale_at = datetime('now'), stale_reason = 'ruleset', updated_at = datetime('now')
        WHERE project_id = ?1
          AND detected_by = ?2
          ${docFilter}
          AND stale_at IS NULL
          AND lifecycle_state IN (${STALEABLE_SQL})
          AND (
            (pack_sha256 IS NOT NULL
             AND EXISTS (SELECT 1 FROM rule_pack_versions p WHERE p.status = 'published')
             AND NOT EXISTS (SELECT 1 FROM rule_pack_versions p
                              WHERE p.status = 'published'
                                AND p.pack_sha256 = compliance_findings.pack_sha256))
            OR
            (semantic_hash IS NOT NULL
             AND EXISTS (SELECT 1 FROM rules r
                          WHERE r.rule_uid = compliance_findings.rule_uid
                            AND r.status = 'published'
                            AND r.semantic_hash <> compliance_findings.semantic_hash))
          )`,
    )
    .bind(projectId, userId, docUid)
    .run()
    .catch(() => null);

  const centralRes = await db
    .prepare(
      `UPDATE compliance_findings
          SET stale_at = datetime('now'), stale_reason = 'central', updated_at = datetime('now')
        WHERE project_id = ?1
          AND detected_by = ?2
          ${docFilter}
          AND stale_at IS NULL
          AND session_id IS NOT NULL
          AND lifecycle_state IN (${STALEABLE_SQL})
          AND EXISTS (
            SELECT 1
              FROM bim_sessions s0
              JOIN bim_sessions s1
                ON s1.doc_uid = s0.doc_uid
               AND s1.user_id = s0.user_id
               AND s1.id > s0.id
             WHERE s0.id = compliance_findings.session_id
               AND s0.central_path_hash IS NOT NULL
               AND s1.central_path_hash IS NOT NULL
               AND s1.central_path_hash <> s0.central_path_hash
          )`,
    )
    .bind(projectId, userId, docUid)
    .run()
    .catch(() => null);

  return {
    ruleset: rulesetRes?.meta.changes ?? 0,
    central: centralRes?.meta.changes ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/*  GET /api/compliance/projects/:id/state — §56-ийн ДОЛООН АСУУЛТ       */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХ.  Элементийн түвшний БҮХ тоо нь
 * `detected_by = viewer.sub`.  Ганц үл хамаарах зүйл нь `rule_run_ledger` —
 * тэр хүснэгтэд ХЭРЭГЛЭГЧИЙН БАГАНА БАЙХГҮЙ (0229-ийн толгой) тул түүний
 * нийлбэр нь тодорхойлолтоороо НЭГТГЭСЭН.
 *
 * ⚠️ `readiness_inputs` нь ТҮҮХИЙ ОРОЛТ, ШИЙДВЭР БИШ.  «Баталгаажлаа» гэсэн
 * үг ЭНД ХЭЗЭЭ Ч БИЧИГДЭХГҮЙ (§69-R3) — ногоон/улаан нь `2-7`-ынх.
 *
 * ⚠️ `evaluation_state` нь ЭНЭ ХАРИУЛТЫН ХАМГИЙН ЧУХАЛ талбар.  Эзний Ш4-ийн
 * дараа (rules хүснэгт ХООСОН шипнэ) `open` нь БҮХ төсөл дээр тэг байна —
 * `evaluation_state = 'no_rule_pack'` гэсэн мөргүйгээр тэр тэг нь «нийцсэн»
 * гэж уншигдана, ба тэр нь системийн гаргаж болох ХАМГИЙН МУУ ХУДАЛ
 * мэдэгдэл.
 */
compliance.get('/projects/:id/state', async (c) => {
  const viewer = c.get('user');
  const db = c.env.DB;
  const projectId = intOrNull(c.req.param('id'));
  if (projectId === null || projectId <= 0) return c.json({ error: 'bad project id' }, 400);

  const docUid = str(c.req.query('doc_uid'), 128);
  const since = Math.max(0, intOrNull(c.req.query('since_generation')) ?? 0);

  // §58-ын ГУРАВ ДАХЬ ГОХ — БУЦААХААС ӨМНӨ.  Дараалал нь ГЭРЭЭ: хуучирсан
  // мөрийг тэмдэглэхээс өмнө уншвал тэр мөр «одоогийн дүгнэлт» мэт харагдана.
  const staled = await applyReadTimeStaleness(db, viewer.sub, projectId, docUid);

  const scalars = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM compliance_findings
           WHERE project_id = ?1 AND detected_by = ?2 AND (?3 = '' OR doc_uid = ?3)
             AND scan_generation > ?4) AS changed_since,
         (SELECT COUNT(*) FROM compliance_findings
           WHERE project_id = ?1 AND detected_by = ?2 AND (?3 = '' OR doc_uid = ?3)
             AND stale_at IS NULL AND scan_generation <= ?4
             AND lifecycle_state IN (${OPEN_STATES_SQL})) AS remaining,
         (SELECT COALESCE(MAX(scan_generation), 0) FROM compliance_findings
           WHERE project_id = ?1 AND detected_by = ?2 AND (?3 = '' OR doc_uid = ?3)) AS scan_generation,
         (SELECT COUNT(*) FROM compliance_findings
           WHERE project_id = ?1 AND detected_by = ?2 AND (?3 = '' OR doc_uid = ?3)
             AND stale_at IS NOT NULL) AS stale_count,
         (SELECT COUNT(DISTINCT scan_generation) FROM compliance_findings
           WHERE project_id = ?1 AND detected_by = ?2 AND (?3 = '' OR doc_uid = ?3)
             AND coverage = 'partial') AS partial_passes,
         (SELECT COUNT(*) FROM compliance_findings
           WHERE project_id = ?1 AND detected_by = ?2 AND (?3 = '' OR doc_uid = ?3)
             AND coverage = 'partial') AS partial_findings,
         (SELECT COUNT(*) FROM compliance_findings f
           WHERE f.project_id = ?1 AND f.detected_by = ?2 AND (?3 = '' OR f.doc_uid = ?3)
             AND NOT EXISTS (SELECT 1 FROM finding_teams t
                              WHERE t.finding_id = f.id AND t.relation = 'owner')) AS unattributed,
         (SELECT COUNT(*) FROM compliance_findings f
           WHERE f.project_id = ?1 AND f.detected_by = ?2 AND (?3 = '' OR f.doc_uid = ?3)
             AND f.pack_sha256 IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM rule_pack_versions p
                              WHERE p.pack_sha256 = f.pack_sha256
                                AND p.status = 'published')) AS unpublished_pack,
         (SELECT COUNT(*) FROM rule_run_ledger WHERE project_id = ?1) AS ledger_rows,
         (SELECT COALESCE(SUM(considered), 0) FROM rule_run_ledger WHERE project_id = ?1) AS rules_considered,
         (SELECT COALESCE(SUM(applicable), 0) FROM rule_run_ledger WHERE project_id = ?1) AS rules_applicable,
         (SELECT COALESCE(SUM(evaluated), 0) FROM rule_run_ledger WHERE project_id = ?1) AS rules_evaluated,
         (SELECT COALESCE(SUM(aborted), 0) FROM rule_run_ledger WHERE project_id = ?1) AS rules_aborted,
         (SELECT COUNT(DISTINCT team_code) FROM rule_run_ledger
           WHERE project_id = ?1 AND team_code IS NOT NULL) AS teams_with_ledger,
         (SELECT COUNT(*) FROM rules WHERE status = 'published') AS rules_published,
         (SELECT COUNT(*) FROM rule_pack_versions WHERE status = 'published') AS packs_published`,
    )
    .bind(projectId, viewer.sub, docUid, since)
    .first<Record<string, unknown>>();

  const n = (key: string): number => Number(scalars?.[key] ?? 0) || 0;

  const openRows = await db
    .prepare(
      `SELECT severity, COUNT(*) AS n
         FROM compliance_findings
        WHERE project_id = ?1 AND detected_by = ?2 AND (?3 = '' OR doc_uid = ?3)
          AND stale_at IS NULL
          AND lifecycle_state IN (${OPEN_STATES_SQL})
        GROUP BY severity`,
    )
    .bind(projectId, viewer.sub, docUid)
    .all<{ severity: string; n: number }>();

  const open: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  for (const r of openRows.results ?? []) {
    if (isSeverity(r.severity)) open[r.severity] = Number(r.n) || 0;
  }

  // ⚠️ «ШИНЭЭР ГАРСАН» нь `first_detected_at = last_evaluated_at` дээр
  //    зогсоно.  Мөр ҮҮСЭХ үед сервер ХОЁУЛАНГ НЬ ижил тэмдэгээр бичдэг
  //    (`?26` хоёр удаа), дараагийн ТӨЛӨВ ӨӨРЧЛӨГДӨХ бичилт бүр зөвхөн
  //    `last_evaluated_at`-ыг хөдөлгөнө.  Тиймээс тэнцүү байх нь «энэ мөр
  //    төрснөөсөө хойш өөрчлөгдөөгүй» гэсэн ЯГ утга.  Цагийн тэмдэг
  //    ГАНЦААРАА «шинээр гарсан» ба «бид дөнгөж хармагцаа анх харагдсан»
  //    хоёрыг ЯЛГАЖ ЧАДАХГҮЙ — тиймээс `scan_generation` хоёр дахь нөхцөл.
  const newlyRows = await db
    .prepare(
      `SELECT finding_uid, rule_uid, severity, verdict, issue_class, dedup_key
         FROM compliance_findings
        WHERE project_id = ?1 AND detected_by = ?2 AND (?3 = '' OR doc_uid = ?3)
          AND scan_generation > ?4
          AND first_detected_at = last_evaluated_at
          AND stale_at IS NULL
          AND lifecycle_state IN (${OPEN_STATES_SQL})
        ORDER BY scan_generation DESC, id DESC
        LIMIT ${MAX_STATE_LIST_ROWS}`,
    )
    .bind(projectId, viewer.sub, docUid, since)
    .all<Record<string, unknown>>();

  const fixedRows = await db
    .prepare(
      `SELECT finding_uid, rule_uid, severity, resolved_at
         FROM compliance_findings
        WHERE project_id = ?1 AND detected_by = ?2 AND (?3 = '' OR doc_uid = ?3)
          AND lifecycle_state = 'FIXED'
          AND scan_generation > ?4
        ORDER BY scan_generation DESC, id DESC
        LIMIT ${MAX_STATE_LIST_ROWS}`,
    )
    .bind(projectId, viewer.sub, docUid, since)
    .all<Record<string, unknown>>();

  const uncertainRows = await db
    .prepare(
      `SELECT finding_uid, rule_uid, severity, uncertain_reason AS reason, issue_class
         FROM compliance_findings
        WHERE project_id = ?1 AND detected_by = ?2 AND (?3 = '' OR doc_uid = ?3)
          AND stale_at IS NULL
          AND (verdict = 'UNCERTAIN' OR lifecycle_state = 'UNCERTAIN')
          AND lifecycle_state NOT IN ('FIXED','DISMISSED','INVALIDATED')
        ORDER BY id DESC
        LIMIT ${MAX_STATE_LIST_ROWS}`,
    )
    .bind(projectId, viewer.sub, docUid)
    .all<Record<string, unknown>>();

  const evaluationState = evaluationStateOf({
    rulesPublished: n('rules_published'),
    packsPublished: n('packs_published'),
    ledgerRows: n('ledger_rows'),
    aborted: n('rules_aborted'),
    partialFindings: n('partial_findings'),
    staleFindings: n('stale_count'),
  });

  return c.json({
    scan_generation: n('scan_generation'),
    as_of: new Date().toISOString(),
    since_generation: since,

    // 1. Одоо юу буруу байна?
    open,
    // 2. Сүүлийн скангаас хойш юу өөрчлөгдөв?
    changed_since: n('changed_since'),
    // 3. Аль нь ШИНЭЭР гарав?
    newly_introduced: newlyRows.results ?? [],
    // 4. Аль нь ЗАСАГДАВ?
    fixed: fixedRows.results ?? [],
    // 5. Аль нь ҮЛДСЭН?
    remaining: n('remaining'),
    // 6. Аль хэсэг нь ТОДОРХОЙГҮЙ хэвээр?
    uncertain: uncertainRows.results ?? [],

    // 7. Дотоод хяналтад бэлэн үү?  ⚠️ ТҮҮХИЙ ОРОЛТ ЗӨВХӨН — `2-7` шийднэ.
    readiness_inputs: {
      stale_count: n('stale_count'),
      staled_on_read: staled,
      partial_coverage_passes: n('partial_passes'),
      rules_considered: n('rules_considered'),
      rules_applicable: n('rules_applicable'),
      rules_evaluated: n('rules_evaluated'),
      rules_aborted: n('rules_aborted'),
      // ⚠️ `rules_considered < rules_total` нь §52-ийн ГОХНЫ ИНДЕКС ажиллаж
      //    байгаагийн НОТОЛГОО (бүтэн сканы оронд), АЛДАА БИШ.
      rules_total: n('rules_published'),
      ledger_rows: n('ledger_rows'),
      packs_published: n('packs_published'),
      teams_with_ledger: n('teams_with_ledger'),
      unpublished_pack: n('unpublished_pack') > 0,
      // ⚠️ Баг ШИЙДЭГДЭЭГҮЙ сессээс ирсэн олдвор.  Тэднийг багийн харагдац
      //    ХЭЗЭЭ Ч харуулахгүй — ЭНЭ тоолуур нь тэдгээрийг ЧИМЭЭГҮЙ АЛГА
      //    БОЛОХООС хамгаална.
      unattributed_findings: n('unattributed'),
      // ⚠️ «Дүрмийн багц байхгүй» ба «шалгаад цэвэр» хоёрын ЯЛГАА.
      evaluation_state: evaluationState,
    },
  });
});

/* ------------------------------------------------------------------ */
/*  GET /api/compliance/findings — ЭЛЕМЕНТИЙН ТҮВШНИЙ, ЗӨВХӨН ӨӨРИЙНХ   */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ `detected_by = viewer.sub` нь ХАТУУ, ХАСАГДАШГҮЙ.  `0201:23-32`,
 * `0203:27`, `0205:44` ба `revitNoteAi.test.ts:262`-ын үл хөдлөх дүрэм.
 * ⚠️ `?user=` МЭТ ПАРАМЕТР ХЭЗЭЭ Ч НЭМЭХГҮЙ.  Багийн харагдац нь `2-7`-ынх
 * бөгөөд тэр нь `detected_by`-г ОГТ буцаадаггүй, `finding_teams.team_code`-оор
 * хамрах хүрээгээ тогтоодог, гишүүнчлэлийн хаалттай, ба `dedup_key`-ээр
 * НЭГТГЭДЭГ өөр асуулга.  Хоёрыг НЭГ маршрут болговол аль нэг нь заавал
 * эвдэрнэ.
 */
compliance.get('/findings', async (c) => {
  const viewer = c.get('user');
  const db = c.env.DB;

  const docUid = str(c.req.query('doc_uid'), 128);
  const projectId = intOrNull(c.req.query('project_id'));
  const stateFilter = str(c.req.query('state'), 32).toUpperCase();
  const includeStale = str(c.req.query('stale'), 8) !== 'exclude';
  const askedSeverity = str(c.req.query('min_severity'), 16).toUpperCase();
  const floor: Severity = isSeverity(askedSeverity) ? askedSeverity : 'INFO';
  const allowed = SEVERITIES.filter((s) => SEVERITY_RANK[s] >= SEVERITY_RANK[floor]);
  const limit = Math.min(MAX_FINDING_ROWS, Math.max(1, intOrNull(c.req.query('limit')) ?? 100));

  const binds: (string | number)[] = [viewer.sub];
  let sql = `SELECT ${FINDING_COLUMNS} FROM compliance_findings WHERE detected_by = ?1`;
  if (docUid) {
    binds.push(docUid);
    sql += `\n   AND doc_uid = ?${binds.length}`;
  }
  if (projectId !== null) {
    binds.push(projectId);
    sql += `\n   AND project_id = ?${binds.length}`;
  }
  if (stateFilter === 'OPEN_ONLY') {
    sql += `\n   AND lifecycle_state IN (${OPEN_STATES_SQL})`;
  } else if (isLifecycleState(stateFilter)) {
    binds.push(stateFilter);
    sql += `\n   AND lifecycle_state = ?${binds.length}`;
  }
  if (!includeStale) sql += `\n   AND stale_at IS NULL`;
  const sevMarks = allowed.map((s) => {
    binds.push(s);
    return `?${binds.length}`;
  });
  sql += `\n   AND severity IN (${sevMarks.join(', ')})
     ORDER BY stale_at IS NOT NULL ASC, ${SEVERITY_ORDER_SQL} DESC, last_evaluated_at DESC, id DESC
     LIMIT ${limit}`;

  const { results } = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  const findings = results ?? [];

  // ⚠️ Элементгүй олдвор нь `goto_element` хийх юмгүй — жагсаалт нь ҮРГЭЛЖ
  //    элементээ авчирна, эс бөгөөс `2-5` мөр тутамд нэмэлт дуудлага хийнэ.
  const ids = findings.map((f) => Number(f['id'])).filter((v) => Number.isFinite(v));
  const elementsById = new Map<number, Record<string, unknown>[]>();
  for (const part of chunked(ids, KEYS_PER_LOOKUP)) {
    const marks = part.map(() => '?').join(', ');
    const rows = await db
      .prepare(
        `SELECT finding_id, element_uid, element_id, category, level_name, role
           FROM finding_elements WHERE finding_id IN (${marks})
          ORDER BY role ASC, id ASC`,
      )
      .bind(...part)
      .all<Record<string, unknown>>();
    for (const r of rows.results ?? []) {
      const fid = Number(r['finding_id']);
      const list = elementsById.get(fid);
      if (list) list.push(r);
      else elementsById.set(fid, [r]);
    }
  }

  /* ⚠️ §65-ИЙН ХАВЧААР — ЭНД БАС.  Өмнө нь энэ маршрут `compliance_findings`-ийн
   *    ТҮҮХИЙ баганыг шууд цацдаг байсан тул `POST /findings` дээр
   *    `evidence_level = 'MODEL_DERIVED'` + `verdict = 'VIOLATION'` гэж
   *    хадгалагдсан мөр ЯГ ТЭР ХЭВЭЭР клиент рүү очдог байв, ба `AI_INFERRED`
   *    мөрийн `evidence_json` дотор нормын КОД/ЗААЛТ ил явдаг байв.  Хоёулаа
   *    `2-5` §6-ийн ил шалгуурыг УНАГААНА.
   *
   *    ⚠️ Хадгалагдсан мөр ХӨНДӨГДӨХГҮЙ — `raw_verdict` нь §68-ийн аудитын
   *    үндэс тул ҮРГЭЛЖ хамт явна (`/findings/surface`-ийн ЯГ ИЖИЛ гэрээ).
   *    ⚠️ `evidence_json` нь БҮХЭЛДЭЭ ХАСАГДАНА: түүнийг илгээгээд «бүү
   *    харуул» гэж хэлэх нь нууц БИШ (хөтчийн сүлжээний таб түүнийг харна).
   *    Зөвшөөрөгдсөн үед л `citation` болж эргэж орно. */
  const authority = await readAuthority(db);

  return c.json({
    findings: findings.map((f) => {
      const evidenceRaw = String(f['evidence_level'] ?? '');
      const evidenceLevel: EvidenceLevel = isEvidenceLevel(evidenceRaw) ? evidenceRaw : 'UNKNOWN';
      const verdictRaw = String(f['verdict'] ?? '');
      const verdict: Verdict = isVerdict(verdictRaw) ? verdictRaw : 'UNCERTAIN';
      const clamp = clampByEvidence({ verdict, evidenceLevel });
      const { evidence_json: evidenceJson, recommendation_mn: recommendation, ...rest } = f;
      return {
        ...rest,
        verdict: clamp.verdict,
        raw_verdict: clamp.rawVerdict,
        verdict_clamped: clamp.clamped,
        evidence_level: evidenceLevel,
        evidence_label_mn: clamp.labelMn,
        evidence_label_en: clamp.labelEn,
        // ⚠️ `null` нь «эшлэл байхгүй» БИШ, «эшлэх ЭРХГҮЙ» (§65).
        citation: citationOf(evidenceJson, clamp.citation && authority.caps.explain),
        // ⚠️ Засварын зөвлөмж нь LEVEL 2 (RECOMMEND)-оос эхэлнэ; чимээгүй
        //    `null` нь «зөвлөмж бичигдээгүй» гэж уншигдах тул ЯАГААДЫГ ил хэлнэ.
        recommendation_mn: authority.caps.recommend ? recommendation ?? null : null,
        recommendation_withheld: !authority.caps.recommend,
        counts_for_readiness: EVIDENCE_RENDER[evidenceLevel].countsForReadiness,
        elements: elementsById.get(Number(f['id'])) ?? [],
      };
    }),
    min_severity: floor,
    limit,
    authority_level: authority.level,
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /api/compliance/findings/:finding_uid — §57 шилжилт            */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЗАМЫН ДАРААЛАЛ.  `POST /findings/stale` нь ХОЁР сегменттэй бөгөөд
 * ЭНЭ маршрут нь `PATCH` тул мөргөлдөхгүй.  ⚠️ Хэрэв хожим
 * `POST /findings/:uid/...` нэмбэл түүнийг `/findings/stale`-ЫН ДООР бүртгэ.
 *
 * ⚠️ `DISMISSED` рүү шилжих нь ЭНД ХОРИОТОЙ (400).  §68-ын override нь
 * ШАЛТГААН + АУДИТЫН МӨР шаарддаг ба тэр нь `finding_overrides` (`2-5`,
 * өөрийн append-only trigger-тэй).  Энэ маршрутаар хийвэл «хэн, яагаад
 * хаав» гэсэн асуултад хариулах юу ч үлдэхгүй.
 *
 * ⚠️ `last_evaluated_at`-Д ХҮРЭХГҮЙ.  Тэр нь ДҮРМИЙН ҮНЭЛГЭЭНИЙ цаг бөгөөд
 * `GET /state`-ийн «шинээр гарав уу» предикат (`first_detected_at =
 * last_evaluated_at`) түүн дээр зогсоно — хүний товшилт түүнийг хөдөлгөвөл
 * олдвор нь «шинээр гарсан» жагсаалтаас ЧИМЭЭГҮЙ унана.
 */
compliance.patch('/findings/:findingUid', async (c) => {
  const viewer = c.get('user');
  const db = c.env.DB;
  const findingUid = str(c.req.param('findingUid'), 64);
  if (!findingUid) return c.json({ error: 'finding_uid is required' }, 400);

  const body = await c.req
    .json<{ lifecycle_state?: unknown; ack_rule_version?: unknown }>()
    .catch(() => ({}) as { lifecycle_state?: unknown; ack_rule_version?: unknown });

  if (!isLifecycleState(body.lifecycle_state)) {
    return c.json({ error: 'bad lifecycle_state', allowed: LIFECYCLE_STATES }, 400);
  }
  const target = body.lifecycle_state;
  if (target === 'DISMISSED') {
    return c.json(
      { error: 'DISMISSED requires an override record', hint: 'POST /api/compliance/findings/:uid/override' },
      400,
    );
  }

  const row = await db
    .prepare(
      `SELECT id, lifecycle_state, verdict, severity, rule_uid, rule_version, ruleset_version,
              pack_sha256, issue_class, evidence_level, coverage, uncertain_reason,
              scan_generation, doc_uid, project_id, session_id, owner_team_code, dedup_key
         FROM compliance_findings
        WHERE finding_uid = ?1 AND detected_by = ?2`,
    )
    .bind(findingUid, viewer.sub)
    .first<Record<string, unknown>>();

  // ⚠️ 404, 403 БИШ.  403 нь тэр мөр ӨӨР ХҮН ДЭЭР ОРШИН БАЙГААГ ил болгоно
  //    (0227-ийн `/notices/:key/state`-ийн ижил шийдвэр).
  if (!row) return c.json({ error: 'not found' }, 404);

  const current = String(row['lifecycle_state']);
  if (!isLifecycleState(current)) return c.json({ error: 'corrupt lifecycle_state' }, 500);
  if (!canTransition(current, target)) {
    return c.json(
      { error: 'illegal transition', from: current, to: target, allowed: ALLOWED_TRANSITIONS[current] },
      409,
    );
  }
  if (current === target) {
    return c.json({ finding_uid: findingUid, lifecycle_state: current, changed: false });
  }

  const ackVersion = intOrNull(body.ack_rule_version) ?? intOrNull(row['rule_version']);
  const res = await db
    .prepare(
      `UPDATE compliance_findings SET
          lifecycle_state = ?3,
          ack_rule_version = CASE WHEN ?3 = 'ACKNOWLEDGED' THEN ?4 ELSE ack_rule_version END,
          resolved_at = CASE
                          WHEN ?3 = 'FIXED' THEN COALESCE(resolved_at, datetime('now'))
                          WHEN ?3 = 'REOPENED' THEN NULL
                          ELSE resolved_at
                        END,
          updated_at = datetime('now')
        WHERE finding_uid = ?1 AND detected_by = ?2 AND lifecycle_state = ?5`,
    )
    .bind(findingUid, viewer.sub, target, ackVersion, current)
    .run();

  // ⚠️ Уралдааны хамгаалалт (`progress.ts`-ийн `AND status='pending'` заншил):
  //    хоёр таб нэгэн зэрэг шилжүүлэхэд ХОЁУЛАА амжилттай гэж хэлэх ЁСГҮЙ.
  if ((res.meta.changes ?? 0) === 0) {
    return c.json({ error: 'state changed concurrently', from: current, to: target }, 409);
  }

  // §3.4 — ТӨЛӨВ ӨӨРЧЛӨГДӨХ БҮРТ нэг `learning_events` мөр.  Хүний товшилт ч
  // мөн адил төлөвийн өөрчлөлт — аудитын мөр нь ХУВИРАМТГАЙ хүснэгтийн
  // НӨХӨН ТӨЛБӨР (0224-ийн толгой).
  const streamId = `cf-patch:${viewer.sub}:${findingUid}`.slice(0, 64);
  const seqRow = await db
    .prepare(`SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM learning_events WHERE stream_id = ?`)
    .bind(streamId)
    .first<{ next: number }>()
    .catch(() => null);
  const seq = Math.max(0, Number(seqRow?.next ?? 0) || 0);

  const payload = {
    rule_id: String(row['rule_uid'] ?? ''),
    passed: String(row['verdict'] ?? '') === 'PASS',
    finding_uid: findingUid,
    verdict: String(row['verdict'] ?? ''),
    prev_verdict: String(row['verdict'] ?? ''),
    lifecycle_state: target,
    prev_lifecycle_state: current,
    issue_class: String(row['issue_class'] ?? ''),
    evidence_level: String(row['evidence_level'] ?? ''),
    severity: String(row['severity'] ?? ''),
    coverage: String(row['coverage'] ?? 'full'),
    uncertain_reason: strOrNull(row['uncertain_reason'], 32),
    scan_generation: intOrNull(row['scan_generation']) ?? 0,
    // ⚠️ Хүний товшилт нь дүрмийн ҮНЭЛГЭЭ БИШ — `decided_by` нь тэр ялгааг
    //    сургалтын корпуст ил үлдээнэ.
    decided_by: 'human',
    rule_version: intOrNull(row['rule_version']) ?? 1,
    ruleset_version: str(row['ruleset_version'], 64),
    pack_sha256: strOrNull(row['pack_sha256'], 64),
    team_code: strOrNull(row['owner_team_code'], 16),
    doc_uid: str(row['doc_uid'], 128),
  };
  const { expected, present } = partsForEvent({
    kind: 'RULE_VALIDATION',
    artifactResolved: false,
    txn: 'none',
    parent: 'none',
    payload,
  });

  await writeBimBatch(db, {
    txns: [],
    touches: [],
    events: [
      {
        session_id: intOrNull(row['session_id']),
        stream_id: streamId,
        seq,
        event_uid: `cfp-${viewer.sub}-${str(row['dedup_key'], 64)}-${seq}-${target}`.slice(0, 64),
        kind: 'RULE_VALIDATION',
        actor_kind: 'human',
        actor_user_id: viewer.sub,
        project_id: intOrNull(row['project_id']),
        task_id: null,
        doc_uid: str(row['doc_uid'], 128) || null,
        txn_uid: null,
        element_id: null,
        parent_event_uid: null,
        causal_event_uid: null,
        artifact_id: null,
        payload_json: JSON.stringify(payload),
        parts_expected: expected,
        parts_present: present,
        provenance: 'MACHINE_GENERATED',
        model_version: null,
        ruleset_version: str(row['ruleset_version'], 64) || null,
        occurred_at: new Date().toISOString(),
      },
    ],
  });

  return c.json({ finding_uid: findingUid, lifecycle_state: target, changed: true });
});

/* ================================================================== */
/*  ⬇⬇⬇  2-6 → 2-5 → 2-7 ЭНДЭЭС ДООШ                                   */
/* ================================================================== */

/* ================================================================== */
/*  2-6 · БАГИЙН ДҮРМИЙН ХАМРАХ ХҮРЭЭ + §79 ЧАДВАРЫН БҮРТГЭЛ           */
/* ================================================================== */
/**
 * ⚠️ ЭНЭ БЛОК НЬ ФАЙЛЫН ТӨГСГӨЛД.  Буулгах цуваа: 2-2 → 2-4 → 2-3 → 2-6
 *    → 2-5 → 2-7.  Дараагийн сесс өөрийн маршрутаа ЭНЭ БЛОКИЙН ДООР нэмнэ;
 *    дээрх нэг ч мөр хөндөгдөөгүй.
 *
 * ⚠️ ХООСОН БҮРТГЭЛҮҮД — ЭНЭ БОЛ РЕЛИЗ N-ИЙН БОДИТ ТӨЛӨВ.  `rules`,
 *    `team_rule_scope`, `model_capabilities` ГУРВУУЛАА ХООСОН нийлүүлэгдэнэ
 *    (эзэн БНбД баримтуудаа өөрөө өгнө).  Тиймээс энэ блокийн БҮХ уншигч нь
 *    «ДҮРМИЙН БАГЦГҮЙ» ба «ШАЛГААД ЦЭВЭР» хоёрыг ЯЛГАХ ЁСТОЙ: тэглэсэн
 *    тоолуур нь «зөрчилгүй» ГЭСЭН ҮГ БИШ.  Ялгаа нь `has_pack` /
 *    `compliance_state` / `no_row` гэсэн ИЛ талбаруудаар илэрхийлэгдэнэ —
 *    тоог тайлбарлах ажлыг клиентэд үлдээвэл хэн нэгэн 0-ыг ногооноор будна.
 */

/** `team_rule_scope.mode` — 0240-ийн CHECK-ийн ГУРВАН утга. */
const RULE_SCOPE_MODES = ['own', 'shared', 'advisory'] as const;
/** `team_rule_scope.source_kind` — 0240-ийн CHECK-ийн ГУРВАН утга. */
const RULE_SOURCE_KINDS = ['norm', 'company_practice', 'team_standard'] as const;

/**
 * Багц угсрахад ОРОХ горимууд.  `advisory` нь ХАРАГДАНА ч ОРОХГҮЙ —
 * v2 §76-ийн ядаргааны эх сурвалж: өөр багийн ажлыг чиний олдвор болгох.
 */
const PACKED_SCOPE_MODES: readonly string[] = ['own', 'shared'];

interface ScopeRow {
  rule_uid: string;
  team_code: string;
  mode: string;
  source_kind: string;
  practice_origin: string | null;
  note: string | null;
}

/**
 * GET /api/compliance/rule-scope?team=BA
 *
 * ⚠️ `advisory` мөрийг БУЦААНА ч `packed: false` гэж ТЭМДЭГЛЭНЭ — клиент
 *    багц татахад тэднийг ОРУУЛАХГҮЙ.  Хоёр жагсаалт биш, НЭГ жагсаалт +
 *    ИЛ туг: хоёр болговол клиент аль нэгийг нь мартана.
 *
 * ⚠️ `has_pack` НЬ ЭНЭ ГАРЦЫН ХАМГИЙН ЧУХАЛ ТАЛБАР.  `false` нь «энэ багт
 *    дүрмийн багц БАЙХГҮЙ ⇒ нийцлийн шалгалт АЛГАСАГДАНА» гэсэн үг, ба тэр
 *    нь «шалгаад цэвэр» ГЭСЭН ҮГ БИШ.  ⚠️ Мөн `TEAM = UNCERTAIN` ч БИШ:
 *    багийн илрүүлэлт АМЖИЛТТАЙ болсон, `team_code` нь ЖИНХЭНЭ кодоороо
 *    үлдэж, мөр цуглагдсаар байна — зөвхөн ТУЛГАХ зүйл байхгүй.  MGMT · EZ ·
 *    GT нь ЗӨВ, БАЙНГЫН `has_pack: false` кейс (эзэн 2026-08-30-нд
 *    баталсан) — алдаа БИШ.  ⛔ ӨӨР БАГИЙН дүрэм рүү «ойролцоо» гэж
 *    унагаах ЗАМ БАЙХГҮЙ бөгөөд байх ч ЁСГҮЙ.
 */
compliance.get('/rule-scope', async (c) => {
  const viewer = c.get('user');
  const team = str(c.req.query('team'), 16).toUpperCase();
  if (!team) return c.json({ error: 'team is required' }, 400);

  const teams = await knownTeamCodes(c.env.DB);
  if (!teams.has(team)) return c.json({ error: 'unknown team' }, 404);

  // ⚠️ §82-4.  ЭНЭ ГАДАРГУУ НЬ `/pack`-ААС Ч ИЛҮҮ МЭДРЭМТГИЙ:
  //    `team_rule_scope` нь `source_kind = 'company_practice'` ба ЧӨЛӨӨТ
  //    БИЧВЭР `practice_origin` буцаадаг — өөрөөр хэлбэл ӨӨР БАГИЙН дотоод
  //    шийдвэрийн эх сурвалж («МАКС ӨРГӨӨ хурлын зөвлөмжийн дагуу…» гэх мэт).
  if (!canReadTeamRules(viewer.role, team, await callerTeamCodes(c.env.DB, viewer.sub))) {
    return c.json({ ...TEAM_SCOPE_FORBIDDEN, team }, 403);
  }

  const [{ results: scope }, pack] = await Promise.all([
    c.env.DB.prepare(
      `SELECT rule_uid, team_code, mode, source_kind, practice_origin, note
         FROM team_rule_scope
        WHERE team_code = ?1
        ORDER BY mode, rule_uid`,
    )
      .bind(team)
      .all<ScopeRow>(),
    // ⚠️ БАГЦ НИЙТЛЭГДСЭН ЭСЭХ нь `rule_pack_versions` (0223)-аас — ЭНЭ
    //    хүснэгтийн мөрийн тооноос БИШ.  Хамрах хүрээ зарлагдсан ч багц
    //    хараахан угсрагдаагүй байж БОЛНО, ба сургалтын тэнцэх нөхцөл 5
    //    (`packPublished`, `lib/trainingRelevance.ts`) нь НИЙТЛЭГДСЭНийг
    //    шаарддаг, ЗАРЛАГДСАНыг БИШ.
    c.env.DB.prepare(
      `SELECT ruleset_version, pack_sha256, rule_count, published_at
         FROM rule_pack_versions
        WHERE team_code = ?1 AND status = 'published'
        ORDER BY id DESC LIMIT 1`,
    )
      .bind(team)
      .first<{
        ruleset_version: string;
        pack_sha256: string;
        rule_count: number;
        published_at: string | null;
      }>(),
  ]);

  const rows = scope ?? [];
  const packedCount = rows.filter((r) => PACKED_SCOPE_MODES.includes(r.mode)).length;

  return c.json({
    team,
    scope: rows.map((r) => ({
      rule_uid: r.rule_uid,
      mode: r.mode,
      source_kind: r.source_kind,
      practice_origin: r.practice_origin,
      note: r.note,
      // Клиент өөрөө `mode`-ыг тайлбарлах ёсгүй — сервер шийднэ.
      packed: PACKED_SCOPE_MODES.includes(r.mode),
    })),
    scoped_rules: rows.length,
    packed_rules: packedCount,
    // ⚠️ ХОЁР ӨӨР АСУУЛТ, ХОЁР ӨӨР ТАЛБАР.  `has_scope` = «хэн нэгэн энэ
    //    багт дүрэм оноосон уу»; `has_pack` = «тэр багц НИЙТЛЭГДСЭН үү».
    //    Хоёуланг нь буцаах нь «зарласан боловч угсраагүй» гэсэн завсрын
    //    төлөвийг ИЛ болгоно — эс бөгөөс тэр нь «багцгүй»-тэй нийлж,
    //    админ юу дутууг мэдэхгүй.
    has_scope: rows.length > 0,
    has_pack: pack !== null,
    pack: pack ?? null,
    // ⚠️ ИЛ ТАЙЛБАР — тоог клиент тайлбарлахгүй.  «0 зөрчил» нь ногоон
    //    гэсэн үг БИШ бол сервер тэрийг ХЭЛЭХ ЁСТОЙ.
    compliance_state: pack !== null ? 'checked' : 'skipped_no_pack',
  });
});

/**
 * POST /api/compliance/rule-scope — дүрмийг багт оноох (idempotent).
 *
 * ⚠️ `source_kind` нь `verification_state`-ЭЭС ТУСДАА ТЭНХЛЭГ.
 *    `verification_state` = «эх сурвалж баталгаажсан уу»;
 *    `source_kind` = «энэ ЯМАР ТӨРЛИЙН эрх мэдэл вэ».  Хэмжсэн шалтгаан:
 *    `bb/template.ts:173` нь «МАКС ӨРГӨӨ хурлын зөвлөмжийн дагуу…» гэсэн
 *    КОМПАНИЙН ДАДЛЫГ БНбД иш татсан бусад hint-тэй ЯГ ИЖИЛ утасгүй
 *    мөрөнд хадгалдаг.  AI хурлын тэмдэглэлийг ӨНДӨР БАРИЛГЫН ХУУЛЬ гэж
 *    иш татах нь UX-ийн алдаа биш, ХАРИУЦЛАГЫН асуудал.
 */
compliance.post('/rule-scope', requireAdmin(), async (c) => {
  const viewer = c.get('user');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: 'invalid json' }, 400);

  const ruleUid = str(body.rule_uid, 128);
  if (!ruleUid) return c.json({ error: 'rule_uid is required' }, 400);

  const team = str(body.team_code, 16).toUpperCase();
  // ⚠️ ХОЁР ДАВХАР: ХЭЛБЭР (`isTeamCodeShape` — нөөцлөгдсөн хуурамч кодыг ч
  //    хаана) ба АМЬД БҮРТГЭЛ (`teams.code`).  Тоог (7 · 8 · 9 · 11) ЭНД
  //    ХЭЗЭЭ Ч бичихгүй — баг нэмэгдэх нь `teams`-д НЭГ INSERT байх ёстой,
  //    кодын өөрчлөлт БИШ.
  if (!isTeamCodeShape(team)) return c.json({ error: 'invalid team_code' }, 400);
  const teams = await knownTeamCodes(c.env.DB);
  if (!teams.has(team)) return c.json({ error: 'unknown team' }, 400);

  const mode = str(body.mode, 16) || 'own';
  if (!(RULE_SCOPE_MODES as readonly string[]).includes(mode)) {
    return c.json({ error: 'invalid mode', allowed: RULE_SCOPE_MODES }, 400);
  }

  const sourceKind = str(body.source_kind, 24) || 'norm';
  if (!(RULE_SOURCE_KINDS as readonly string[]).includes(sourceKind)) {
    return c.json({ error: 'invalid source_kind', allowed: RULE_SOURCE_KINDS }, 400);
  }

  const practiceOrigin = strOrNull(body.practice_origin, MAX_STR);
  // ⚠️ ХОЁР ТАЛТАЙ АЛБАДЛАГА, ЗОРИУД.  'norm' дээр гарал үүсэл бичих нь
  //    БНбД-д хурлын огноо наана; 'company_practice' / 'team_standard' дээр
  //    ХООСОН үлдээх нь ЯГ ТЭР эргэлзээг эргүүлж авчирна («энэ хаанаас
  //    гарав?»), тэр нь энэ баганын оршин байх ганц шалтгаан.
  if (sourceKind === 'norm' && practiceOrigin !== null) {
    return c.json({ error: 'practice_origin must be null when source_kind = norm' }, 400);
  }
  if (sourceKind !== 'norm' && practiceOrigin === null) {
    return c.json({ error: 'practice_origin is required for non-norm source_kind' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO team_rule_scope
       (rule_uid, team_code, mode, source_kind, practice_origin, note, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (rule_uid, team_code) DO UPDATE SET
       mode            = excluded.mode,
       source_kind     = excluded.source_kind,
       practice_origin = excluded.practice_origin,
       note            = excluded.note`,
  )
    .bind(
      ruleUid,
      team,
      mode,
      sourceKind,
      practiceOrigin,
      strOrNull(body.note, MAX_TEXT),
      viewer.sub,
    )
    .run();

  return c.json({ rule_uid: ruleUid, team_code: team, mode, source_kind: sourceKind }, 201);
});

/* ------------------------------------------------------------------ */
/*  v2 §79 · ЗАГВАРЫН ЧАДВАРЫН БҮРТГЭЛ                                  */
/* ------------------------------------------------------------------ */

interface CapabilityDbRow {
  id: number;
  task: string;
  model_version: string;
  team_scope: string | null;
  input_types: string;
  output_types: string;
  confidence: number | null;
  evaluation_status: string;
  allowed_actions: string;
  authority_level: number;
  eval_run_json: string | null;
  eval_dataset_version: string | null;
  is_active: number;
  note: string | null;
  granted_by: number | null;
  created_at: string;
}

const CAPABILITY_COLUMNS =
  `id, task, model_version, team_scope, input_types, output_types, confidence,
   evaluation_status, allowed_actions, authority_level, eval_run_json,
   eval_dataset_version, is_active, note, granted_by, created_at`;

/**
 * `team_scope`-ийн ЦОРЫН ГАНЦ валидац — NULL (компани даяар) ЭСВЭЛ АМЬД
 * `teams.code`.  ⚠️ Найман салбарын жагсаалт ЭНД ХАТУУ БИЧИГДЭХГҮЙ: эзний
 * 2026-08-30-ны шийдвэр нь ТӨЛӨВЛӨЛТИЙН баримт, эмхэтгэх тогтмол БИШ.
 */
async function validateTeamScope(
  db: D1Database,
  raw: unknown,
): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  const code = str(raw, 16).toUpperCase();
  if (!isTeamCodeShape(code)) return { ok: false, error: 'invalid team_scope' };
  const teams = await knownTeamCodes(db);
  if (!teams.has(code)) return { ok: false, error: 'unknown team_scope' };
  return { ok: true, value: code };
}

/**
 * ГУРВАН ВАЛИДАЦ, БҮГД СЕРВЕР талд (v2 §79/§80).  Аль нэг унавал 400.
 *
 * 1. `team_scope` — АМЬД `teams`-ээс (дээрх `validateTeamScope`).
 * 2. `authority_level >= 3` → 400.  v2 §40-R4 нь MVP-г LEVEL 2 (RECOMMEND)
 *    -оор ТАСАЛНА.  0239-ийн CHECK нь 5 хүртэл зөвшөөрдөг нь ИРЭЭДҮЙН
 *    СХЕМИЙН ЗАЙ, зөвшөөрөл БИШ.  Энэ 400-г зөөлрүүлэх нь admin-д нэг
 *    POST-оор LEVEL 4 (HUMAN-APPROVED EXECUTE) олгох боломж өгнө.
 * 3. `evaluation_status = 'approved'` → `eval_run_json` нь ГУРВАН нөхцөлийг
 *    хангана (`evalRunApproves`): `passed === true`, `blocked` хоосон, ба
 *    гүйлтийн `model_version` нь МӨРИЙН `model_version`-той ТААРНА.
 *
 * ⚠️ ВАЛИДАЦ 3 НЬ ӨНӨӨДӨР `task = 'rule_eval'` ДЭЭР ДАВАГДАШГҮЙ:
 *    `eval/golden/rules.json` ХООСОН ба `run_golden.py --kind rules` нь
 *    `sys.exit(2)` өгдөг (хоосон шаардлагатай хуваарь = ХАТУУ БЛОК).
 *    Тэр нь ЗӨВ: хэмжигдээгүй дүрмийн хөдөлгүүр ногоон харагдах ёсгүй.
 *    Хөнгөлөлт хэрэгтэй бол ЭНД, ИЛЭЭР — чимээгүй тойрох зам БАЙХГҮЙ.
 */
function validateCapabilityBody(
  body: Record<string, unknown>,
  modelVersion: string,
): { ok: true } | { ok: false; error: string; detail?: unknown } {
  const level = intOrNull(body.authority_level);
  if (level !== null) {
    if (level < 0 || level > MAX_SCHEMA_AUTHORITY) {
      return { ok: false, error: 'authority_level out of range' };
    }
    if (level > MAX_GRANTABLE_AUTHORITY) {
      return {
        ok: false,
        error: 'authority_level_capped',
        detail: {
          max: MAX_GRANTABLE_AUTHORITY,
          why: 'MVP нь LEVEL 2 (RECOMMEND)-оор тасарна (v2 §40-R4)',
        },
      };
    }
  }

  const status = body.evaluation_status;
  if (status !== undefined && !isCapabilityStatus(status)) {
    return { ok: false, error: 'invalid evaluation_status' };
  }
  if (status === 'approved') {
    const raw = body.eval_run_json;
    // ⚠️ Задлалт нь ЭНД — гэмтэлтэй JSON нь 400 болно, чимээгүй `false` БИШ.
    let parsed: unknown = null;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, error: 'eval_run_json is not valid JSON' };
      }
    } else if (raw !== undefined && raw !== null) {
      parsed = raw;
    }
    const verdict = evalRunApproves(parsed, modelVersion);
    if (!verdict.ok) {
      return { ok: false, error: 'eval_run_rejected', detail: { reason: verdict.reason } };
    }
  }
  return { ok: true };
}

/**
 * GET /api/compliance/capabilities?task=&team=
 *
 * ⚠️ `authority_level >= 3` мөрийг ЖАГСААНА — ГЭХДЭЭ ҮҮСГЭХ зам БАЙХГҮЙ
 *    (POST/PATCH нь 400 өгнө).  Жагсаах нь АУДИТ: гараар SQL бичсэн мөрийг
 *    ИЛРҮҮЛНЭ.  Шүүж хаявал тэр яг мөр Л ХАРАГДАХГҮЙ болно.
 */
compliance.get('/capabilities', requireAdmin(), async (c) => {
  const task = str(c.req.query('task'), 64);
  const team = str(c.req.query('team'), 16).toUpperCase();

  const where: string[] = [];
  const capBinds: unknown[] = [];
  if (task) {
    where.push(`task = ?${capBinds.length + 1}`);
    capBinds.push(task);
  }
  if (team) {
    // ⚠️ Компани даяарын мөрийг ОРУУЛНА — тэр нь тэр багт ч хамаарна.
    //    `decideCapability`-ийн хамрах хүрээний дараалалтай ЯГ ИЖИЛ багц.
    where.push(`(team_scope = ?${capBinds.length + 1} OR team_scope IS NULL)`);
    capBinds.push(team);
  }
  const sql =
    `SELECT ${CAPABILITY_COLUMNS} FROM model_capabilities` +
    (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY task, team_scope IS NULL, team_scope, id DESC';

  const stmt = c.env.DB.prepare(sql);
  const { results } = await (capBinds.length > 0 ? stmt.bind(...capBinds) : stmt)
    .all<CapabilityDbRow>();
  const rows = results ?? [];

  // ⚠️ АУДИТЫН ТУГ.  Схем 5 хүртэл зөвшөөрдөг, маршрут 2 хүртэл — тиймээс
  //    3+ мөр нь ЗӨВХӨН гараар SQL бичиж үүсэх боломжтой.  Түүнийг
  //    ЖАГСААЛТЫН ДЭЭД ТҮВШИНД нэрлэнэ, эс бөгөөс 200 мөрийн дунд алга болно.
  const overCap = rows.filter((r) => r.authority_level > MAX_GRANTABLE_AUTHORITY);

  return c.json({
    capabilities: rows,
    count: rows.length,
    // «Мөр байхгүй» = БҮХ чадвар ТАТГАЛЗСАН.  Хоосон нь «зөвшөөрөгдсөн»
    // ГЭСЭН ҮГ БИШ (`decideCapability` → `no_row`).
    registry_empty: rows.length === 0,
    max_grantable_authority: MAX_GRANTABLE_AUTHORITY,
    over_cap: overCap.map((r) => ({
      id: r.id,
      task: r.task,
      authority_level: r.authority_level,
    })),
  });
});

compliance.post('/capabilities', requireAdmin(), async (c) => {
  const viewer = c.get('user');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: 'invalid json' }, 400);

  const task = str(body.task, 64);
  const modelVersion = str(body.model_version, 64);
  if (!task || !modelVersion) {
    return c.json({ error: 'task and model_version are required' }, 400);
  }

  const scope = await validateTeamScope(c.env.DB, body.team_scope);
  if (!scope.ok) return c.json({ error: scope.error }, 400);

  const check = validateCapabilityBody(body, modelVersion);
  if (!check.ok) return c.json({ error: check.error, detail: check.detail ?? null }, 400);

  const inputTypes = jsonText(body.input_types, '[]');
  const outputTypes = jsonText(body.output_types, '[]');
  const allowedActions = jsonText(body.allowed_actions, '["read-only"]');
  const evalRun = body.eval_run_json === undefined ? 'null' : jsonText(body.eval_run_json, 'null');
  if (inputTypes === null || outputTypes === null || allowedActions === null || evalRun === null) {
    return c.json({ error: 'invalid json field' }, 400);
  }

  // ⚠️ ДАВХАРДАЛ 409.  `(task, model_version, team_scope)` дээр DB өвөрмөц
  //    индекс ТАВИАГҮЙ — SQLite-д NULL нь өөртэйгөө тэнцэхгүй тул
  //    `team_scope IS NULL` мөрүүд өвөрмөц индексээр хамгаалагдахгүй, ба
  //    `IFNULL(...)` илэрхийллийн индекс нь 0239-ийг 5 statement болгоно.
  //    Тиймээс шалгалт ЭНД, ил, `IS`-ээр (NULL дээр ч ажилладаг цорын ганц
  //    харьцуулагч — `=` нь NULL дээр ҮРГЭЛЖ NULL буцаана).
  const dup = await c.env.DB.prepare(
    `SELECT id FROM model_capabilities
      WHERE task = ?1 AND model_version = ?2 AND team_scope IS ?3`,
  )
    .bind(task, modelVersion, scope.value)
    .first<{ id: number }>();
  if (dup) return c.json({ error: 'EXISTS', id: dup.id }, 409);

  const res = await c.env.DB.prepare(
    `INSERT INTO model_capabilities
       (task, model_version, team_scope, input_types, output_types, confidence,
        evaluation_status, allowed_actions, authority_level, eval_run_json,
        eval_dataset_version, is_active, note, granted_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  )
    .bind(
      task,
      modelVersion,
      scope.value,
      inputTypes,
      outputTypes,
      numOrNull(body.confidence),
      isCapabilityStatus(body.evaluation_status) ? body.evaluation_status : 'untested',
      allowedActions,
      intOrNull(body.authority_level) ?? 0,
      evalRun === 'null' ? null : evalRun,
      strOrNull(body.eval_dataset_version, 64),
      body.is_active === true || body.is_active === 1 ? 1 : 0,
      strOrNull(body.note, MAX_TEXT),
      viewer.sub,
    )
    .run();

  return c.json(
    {
      id: res.meta?.last_row_id ?? null,
      task,
      model_version: modelVersion,
      team_scope: scope.value,
    },
    201,
  );
});

/**
 * PATCH /api/compliance/capabilities/:id
 *
 * ⚠️ `task` ба `model_version` нь ХӨДӨЛГӨӨНГҮЙ — өөр даалгавар бол ӨӨР МӨР
 *    (§79-ийн кардинал: нэг загвар, ОЛОН чадвар).  Тэднийг PATCH-аар
 *    сольж болдог байсан бол «BA-д батлагдсан rule_eval» мөр маргааш
 *    «бүх багт батлагдсан note_prose» болж чадна — бүртгэлийн бүх утга
 *    устана.
 */
compliance.patch('/capabilities/:id', requireAdmin(), async (c) => {
  const id = intOrNull(c.req.param('id'));
  if (id === null || id <= 0) return c.json({ error: 'invalid id' }, 400);

  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: 'invalid json' }, 400);

  const current = await c.env.DB.prepare(
    `SELECT ${CAPABILITY_COLUMNS} FROM model_capabilities WHERE id = ?1`,
  )
    .bind(id)
    .first<CapabilityDbRow>();
  if (!current) return c.json({ error: 'not found' }, 404);

  // ⚠️ Гурав дахь валидац нь МӨРИЙН `model_version`-той тулгана — биеийн
  //    зарласантай БИШ (тэр багана PATCH-д ХӨДӨЛГӨӨНГҮЙ).
  const check = validateCapabilityBody(body, current.model_version);
  if (!check.ok) return c.json({ error: check.error, detail: check.detail ?? null }, 400);

  const scope =
    body.team_scope === undefined
      ? ({ ok: true, value: current.team_scope } as const)
      : await validateTeamScope(c.env.DB, body.team_scope);
  if (!scope.ok) return c.json({ error: scope.error }, 400);

  const inputTypes =
    body.input_types === undefined ? current.input_types : jsonText(body.input_types, '[]');
  const outputTypes =
    body.output_types === undefined ? current.output_types : jsonText(body.output_types, '[]');
  const allowedActions =
    body.allowed_actions === undefined
      ? current.allowed_actions
      : jsonText(body.allowed_actions, '["read-only"]');
  if (inputTypes === null || outputTypes === null || allowedActions === null) {
    return c.json({ error: 'invalid json field' }, 400);
  }
  let evalRun = current.eval_run_json;
  if (body.eval_run_json !== undefined) {
    if (body.eval_run_json === null) {
      evalRun = null;
    } else {
      const next = jsonText(body.eval_run_json, 'null');
      if (next === null) return c.json({ error: 'invalid json field' }, 400);
      evalRun = next === 'null' ? null : next;
    }
  }

  await c.env.DB.prepare(
    `UPDATE model_capabilities
        SET team_scope           = ?2,
            input_types          = ?3,
            output_types         = ?4,
            confidence           = ?5,
            evaluation_status    = ?6,
            allowed_actions      = ?7,
            authority_level      = ?8,
            eval_run_json        = ?9,
            eval_dataset_version = ?10,
            is_active            = ?11,
            note                 = ?12
      WHERE id = ?1`,
  )
    .bind(
      id,
      scope.value,
      inputTypes,
      outputTypes,
      body.confidence === undefined ? current.confidence : numOrNull(body.confidence),
      isCapabilityStatus(body.evaluation_status)
        ? body.evaluation_status
        : current.evaluation_status,
      allowedActions,
      intOrNull(body.authority_level) ?? current.authority_level,
      evalRun,
      body.eval_dataset_version === undefined
        ? current.eval_dataset_version
        : strOrNull(body.eval_dataset_version, 64),
      body.is_active === undefined
        ? current.is_active
        : body.is_active === true || body.is_active === 1
          ? 1
          : 0,
      body.note === undefined ? current.note : strOrNull(body.note, MAX_TEXT),
    )
    .run();

  return c.json({ id, updated: true });
});

/**
 * GET /api/compliance/capability-check?task=rule_eval&team=BA&need=2
 *
 * ⚠️ ЭНЭ БОЛ БҮРТГЭЛИЙН УНШИГЧ ХААЛГА — v2 §79-ийн зорилго («prevent
 *    experimental AI from silently gaining production authority») нь
 *    ЗӨВХӨН уншигчаар л биелнэ.  Бичигчгүй, уншигчгүй хүснэгт нь хаалга
 *    биш, зүгээр л баримтжуулалт.
 *
 * ⚠️ ЯАГААД ТУСДАА МАРШРУТ, `GET /pack`-ийн ДОТОР БИШ ВЭ (ил тэмдэглэв):
 *    `GET /pack` нь `buildPack`-ийн БАЙТЫГ ЯГ ТЭР ХЭВЭЭР буцаадаг ба тэр
 *    байтын sha256 нь `rule_pack_versions`-д НИЙТЛЭГДДЭГ.  Биед
 *    `authority_level` нэмэх нь `pack_sha256`-ыг өөрчилж, аль хэдийн
 *    нийтлэгдсэн багцын бүрэн бүтэн байдлын хяналтыг эвдэнэ — тэр нь
 *    `2-2`-ын эзэмшил, энэ сессийн хамрах хүрээнээс ГАДУУР.  Тиймээс
 *    эрхийн шийдвэрийг ХАЖУУГИЙН гарцаар өгнө: add-in багцаа татаад,
 *    эрхээ ЭНДЭЭС асууна.  ⚠️ ХОЁРЫГ ХОЛИХГҮЙ — багц нь ЮУ шалгахыг, эрх
 *    нь ҮР ДҮНГ ЯАЖ харуулахыг хэлнэ.
 *
 * ⚠️ ТАТГАЛЗАЛ НЬ АЛДАА БИШ.  Бүртгэлгүй баг → LEVEL 0 (OBSERVE) →
 *    `caps.surface === false` → олдвор ЦУГЛАГДАНА, ХАРАГДАХГҮЙ.  Тэр нь
 *    «шалгаад цэвэр» гэж ХУДАЛ НОГООН харуулахаас хамаагүй дээр.
 *    `reason` нь ҮРГЭЛЖ нэрлэгдсэн: `no_row` / `inactive` / `not_approved`
 *    / `level_too_low` — админ «яагаад» гэдэгт хариулж чадна.
 */
compliance.get('/capability-check', async (c) => {
  const task = str(c.req.query('task'), 64);
  if (!task) return c.json({ error: 'task is required' }, 400);

  const rawTeam = str(c.req.query('team'), 16).toUpperCase();
  const team = rawTeam && isTeamCodeShape(rawTeam) ? rawTeam : null;
  const need = intOrNull(c.req.query('need')) ?? 0;
  if (need < 0 || need > MAX_SCHEMA_AUTHORITY) {
    return c.json({ error: 'invalid need' }, 400);
  }

  const verdict = await assertCapability(c.env.DB, task, team, need);
  return c.json({
    task,
    team,
    need,
    ok: verdict.ok,
    reason: verdict.ok ? null : verdict.reason,
    granted: grantedLevelOf(verdict),
    authority_level: authorityLevelOf(verdict),
    caps: capsOf(verdict),
  });
});

/* ================================================================== */
/*  2-5 · ДҮГНЭЛТИЙН ГАДАРГУУ — НОТОЛГОО, ҮНДСЭН ШАЛТГААН, ХҮЧИНГҮЙ    */
/*        БОЛГОЛТ, ЭРХИЙН ТҮВШИН                                       */
/*                                                                     */
/*  ⚠️ ЭНЭ БЛОК НЬ ФАЙЛЫН ТӨГСГӨЛД.  Дээрх маршрутууд нь `2-2` /       */
/*  `2-4` / `2-3` / `2-6`-ынх — тэдгээрийг ХӨНДӨӨГҮЙ, ДАРААЛЛЫГ НЬ     */
/*  ӨӨРЧЛӨӨГҮЙ.  `2-7` нь ЗӨВХӨН ЭНЭ БЛОКИЙН ДООР нэмнэ.               */
/*                                                                     */
/*  ⚠️ `GET /findings` (2-3, дээр) ЭНД ДАХИН ЗАРЛАГДАХГҮЙ.  Hono нь    */
/*  эхэлж бүртгэгдсэн таарцыг авдаг тул хоёр дахь нь ҮХСЭН КОД болно.  */
/*  Тиймээс энэ сессийн жагсаалт нь ТУСДАА зам: `/findings/surface`.   */
/*  Хоёрын ялгаа нь ЗОРИЛГО: `/findings` нь ТҮҮХИЙ мөр (add-in өөрөө   */
/*  эрэмбэлж, нугалж, шүүнэ), `/findings/surface` нь ХАРАГДАХ БЭЛЭН    */
/*  бүтэц (эрхийн түвшин, нотолгооны хавчаар, үндэс рүү нугалалт,      */
/*  ТӨСӨВ) — вэб ба самбарын ХАРАГДАЦ ижил дүрмээр гарахын тулд.       */
/*                                                                     */
/*  ⚠️ ЗАМЫН ДАРААЛАЛ: `/findings/surface` нь `/findings/:findingRef`- */
/*  ЭЭС ДЭЭР бүртгэгдэнэ, эс бөгөөс «surface» гэдэг үг параметр болж   */
/*  залгигдана.  Доорх параметрийн хандлагч мөн `surface`-ыг ил        */
/*  татгалзана — маршрутын дараалал санамсаргүй өөрчлөгдвөл 404 нь     */
/*  чимээгүй 200-аас ДЭЭР.                                             */
/*                                                                     */
/*  ⚠️ ӨӨРИЙГӨӨ л ХАРАХ ИНВАРИАНТ.  0201:23-32, 0203:27, 0205:44 ба    */
/*  `revitNoteAi.test.ts:262`-д түгжигдсэн: элементийн түвшний уншилт  */
/*  бүр `detected_by = viewer.sub` эсвэл ЦЭВЭР НЭГТГЭЛ.  Багийн «хэн   */
/*  хамгийн олон зөрчилтэй вэ» харагдац ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ.           */
/*  ⚠️ ГАНЦ ҮЛ ХАМААРАХ ЗҮЙЛ нь ХҮЧИНГҮЙ БОЛГОЛТЫН ХЯНАЛТ              */
/*  (`GET /overrides`, `requireManager`): тэр нь §68-ийн АУДИТ бөгөөд  */
/*  элементийн байрлал, өрөөний нэр, `detected_by`-г БУЦААХГҮЙ —       */
/*  зөвхөн дүрэм, шалтгаан, хувилбар.                                  */
/* ================================================================== */

import {
  AUTHORITY_GATES,
  EVIDENCE_RENDER,
  MAX_OVERRIDE_REASON_LEN,
  MIN_OVERRIDE_REASON_LEN,
  OVERRIDE_KINDS,
  OVERRIDE_MEANING,
  REVIEW_DECISIONS,
  SURFACE_RENDER,
  authorityIndexOf,
  clampByEvidence,
  groupByRootCause,
  isOverrideKind,
  isOverrideTrainingEligible,
  isReviewDecision,
  isReviewState,
  resolveRootCause,
  surfaceStateOf,
  type EvaluationState,
  type FindingDisplayRow,
  type FindingEdge,
  type SurfaceState,
} from '../lib/complianceModel';
// ⚠️ ЭРХИЙН ДАВХАРГЫН ЦОРЫН ГАНЦ ЭХ СУРВАЛЖ.  `complianceModel.ts` нь
//    түүнийг ДАМЖУУЛАН экспортлодог — хоёр зам, НЭГ хүснэгт.  ЭНД
//    хоёр дахь `AUTHORITY_CAPS` ЗАРЛАХГҮЙ.
import {
  AUTHORITY_LEVELS,
  authorityCaps,
  type AuthorityCaps,
  type AuthorityLevel,
} from '../lib/complianceAuthority';

/* ------------------------------------------------------------------ */
/*  Төсөв — add-in-ийн `FindingFeed`-тэй ХАМТ хөдөлнө                  */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭДГЭЭР ТООНУУД `revit-mcp/addin/FindingFeed.cs`-ийн `MaxVisible` /
 *    `MaxConsequencesShown`-ТОЙ ТААРНА.  Хоёр талд хоёр өөр төсөв байвал
 *    самбарын «эхний 40» ба вэбийн «эхний 40» өөр өөр мөр харуулж, ХОЁУЛАА
 *    үнэн шиг харагдана.
 * ⚠️ ЭНЭ НЬ ХЭМЖИГДЭЭГҮЙ ТААМАГ (§9.3-5): нэг инженер өдөрт хэдэн дүгнэлт
 *    хүлээж авахыг ХЭН Ч тоолоогүй.  Тоог өөрчлөх бол ХОЁУЛАНГ НЬ зэрэг.
 */
const MAX_SURFACE_GROUPS = 40;
const MAX_SURFACE_CONSEQUENCES = 9;
/** ЭРЭМБЭЛЭХ, НУГАЛАХААС ӨМНӨ уншиж авах мөрийн дээд тоо. */
const MAX_SURFACE_SCAN_ROWS = 200;
/** ХҮЧИНГҮЙ БОЛГОЛТЫН хяналтын жагсаалтын дээд урт. */
const MAX_OVERRIDE_ROWS = 100;
/**
 * ⚠️ D1-ийн нэг мэдэгдэлд 100 BIND.  Ирмэгийн асуулга нь ижил түлхүүрийн
 *    багцыг ХОЁР УДАА холбодог (`from IN (...) OR to IN (...)`) тул хэсгийн
 *    хэмжээ нь `KEYS_PER_LOOKUP` (50) БАЙЖ БОЛОХГҮЙ — тэр нь яг 100 bind
 *    болж хязгаарын ирмэг дээр зогсоно.  40 → 80 bind.
 */
const EDGE_KEYS_PER_LOOKUP = 40;

/** `finding_overrides`-ийн УНШИХ баганууд — хоёр маршрут ХУВААЛЦАНА. */
const OVERRIDE_COLUMNS = `id, finding_id, finding_uid, dedup_key, override_kind, reason,
       evidence_artifact_id, evidence_note, verdict_at_override, severity_at_override,
       evidence_level_at_override, issue_class_at_override, rule_uid, rule_version,
       ruleset_version, pack_sha256, semantic_hash, model_version, addin_version,
       team_code, created_by, created_at, review_state, reviewed_by, reviewed_at, review_note`;

/**
 * ЯГ ИЖИЛ баганууд, `o.` угтвартай — `GET /overrides`-ийн JOIN-д.
 *
 * ⚠️ ГАРААР БИЧСЭН ХОСЫГ ЗОРИУД СОНГОВ: угтварыг ажиллах үед `replace()`-ээр
 *    наах нь `review_note` доторх «review» гэх мэт дэд мөрийг ч гуйвуулж
 *    ЧАДНА.  Багана нэмэх бол ХОЁУЛАНГ НЬ зэрэг.
 */
const OVERRIDE_COLUMNS_O = `o.id, o.finding_id, o.finding_uid, o.dedup_key, o.override_kind,
       o.reason, o.evidence_artifact_id, o.evidence_note, o.verdict_at_override,
       o.severity_at_override, o.evidence_level_at_override, o.issue_class_at_override,
       o.rule_uid, o.rule_version, o.ruleset_version, o.pack_sha256, o.semantic_hash,
       o.model_version, o.addin_version, o.team_code, o.created_by, o.created_at,
       o.review_state, o.reviewed_by, o.reviewed_at, o.review_note`;

/** `SEVERITY_ORDER_SQL`-ийн `f.` угтвартай хос — JOIN доторх эрэмбэд. */
const SEVERITY_ORDER_SQL_F = `CASE f.severity
    WHEN 'CRITICAL' THEN 5 WHEN 'HIGH' THEN 4 WHEN 'MEDIUM' THEN 3
    WHEN 'LOW' THEN 2 ELSE 1 END`;

interface AuthorityView {
  readonly level: AuthorityLevel;
  readonly index: number;
  readonly caps: AuthorityCaps;
  readonly rolloutPct: number;
  readonly minSeverity: Severity;
}

/**
 * `app_settings`-ийн эрхийн түвшинг УНШИНА.
 *
 * ⚠️ КЭШ БАЙХГҮЙ (`withEdgeCache` ЭНД ХЭРЭГЛЭГДЭХГҮЙ).  Эзэн LEVEL 1 рүү
 *    дэвшүүлсний ДАРААХ дуудлага ШУУД харуулах ёстой — 60 секунд хүлээх нь
 *    «дэвшилт ажиллахгүй байна» гэсэн буруу дүгнэлт төрүүлнэ.  Мөн эсрэгээр:
 *    буцаах (LEVEL 1 → 0) нь ШУУД үйлчлэх ЁСТОЙ, тэр нь §75-ийн унтраах товч.
 */
async function readAuthority(db: D1Database): Promise<AuthorityView> {
  const cfg = await loadComplianceConfig(db);
  const level = AUTHORITY_LEVELS[cfg.authorityLevel] ?? 'OBSERVE';
  return {
    level,
    index: authorityIndexOf(level),
    caps: authorityCaps(level),
    rolloutPct: cfg.rolloutPct,
    minSeverity: cfg.minSeverity,
  };
}

/**
 * §69-ийн ТҮҮХИЙ ОРОЛТ — «энэ төслийг ҮНЭХЭЭР шалгасан уу».
 *
 * ⚠️ ЭНЭ АСУУЛГА НЬ `GET /projects/:id/state`-ийн (2-3) ДЭД ОЛОНЛОГ бөгөөд
 *    ЗОРИУД ЖИЖИГ: гадаргуунд «дүрмийн багц алга» ба «шалгаад цэвэр» хоёрыг
 *    ЯЛГАХАД л хэрэгтэй.  Бүтэн `state`-ыг дуудвал нэг самбарын татацад
 *    хорь орчим дэд асуулга нэмэгдэнэ.
 * ⚠️ `rules` ХООСОН шипнэ (эзний шийдвэр Ш4) тул `rulesPublished = 0` нь
 *    ХЭВИЙН эхлэлийн төлөв — алдаа БИШ, гэхдээ «цэвэр» ч БИШ.
 */
async function evaluationStateFor(
  db: D1Database,
  viewerId: number,
  projectId: number | null,
  docUid: string,
): Promise<EvaluationState> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM rules WHERE status = 'published') AS rules_published,
         (SELECT COUNT(*) FROM rule_pack_versions WHERE status = 'published') AS packs_published,
         (SELECT COUNT(*) FROM rule_run_ledger
           WHERE (?1 IS NULL OR project_id = ?1) AND (?3 = '' OR doc_uid = ?3)) AS ledger_rows,
         (SELECT COALESCE(SUM(aborted), 0) FROM rule_run_ledger
           WHERE (?1 IS NULL OR project_id = ?1) AND (?3 = '' OR doc_uid = ?3)) AS aborted,
         (SELECT COUNT(*) FROM compliance_findings
           WHERE detected_by = ?2 AND (?1 IS NULL OR project_id = ?1)
             AND (?3 = '' OR doc_uid = ?3) AND coverage = 'partial') AS partial_findings,
         (SELECT COUNT(*) FROM compliance_findings
           WHERE detected_by = ?2 AND (?1 IS NULL OR project_id = ?1)
             AND (?3 = '' OR doc_uid = ?3) AND stale_at IS NOT NULL) AS stale_findings`,
    )
    .bind(projectId, viewerId, docUid)
    .first<Record<string, unknown>>()
    .catch(() => null);

  const n = (key: string): number => Number(row?.[key] ?? 0) || 0;
  return evaluationStateOf({
    rulesPublished: n('rules_published'),
    packsPublished: n('packs_published'),
    ledgerRows: n('ledger_rows'),
    aborted: n('aborted'),
    partialFindings: n('partial_findings'),
    staleFindings: n('stale_findings'),
  });
}

/**
 * §69-ийн ТӨСӨЛД ХАМААРАХ үнэлгээний төлөв — ХАРАГЧААС ХАМААРАХГҮЙ.
 *
 * ⚠️ ЯАГААД `evaluationStateFor`-ЫГ ДАХИН АШИГЛАХГҮЙ ВЭ.  Тэр функц нь
 *    `GET /findings/surface`-д зориулагдсан бөгөөд `partial_findings` ба
 *    `stale_findings`-ыг `detected_by = <харагч>` гэж шүүдэг — ӨӨРИЙН
 *    гадаргуу дээр тэр нь ЗӨВ.  Гэвч `readiness` нь ТӨСЛИЙН ХААЛГА:
 *    түүний ноцтой байдлын, цоорхойн, багийн асуулга бүр `detected_by`-гүй,
 *    ТӨСӨЛД хамаарна.  Хоёрыг холивол хаалганы ӨНГӨ нь ХЭН ХАРЖ БАЙГААГААС
 *    хамаарна: хуучирсан мөрүүдийг эзэмшдэг инженер A нь `UNKNOWN`, тэр
 *    мөрийг эзэмшдэггүй ахлах B нь `READY` харна.  Нэг төсөл, нэг баримт,
 *    хоёр өөр хариулт — тэр нь §69-ийн хаалгыг утгагүй болгоно.
 *
 * ⚠️ ХАРИН `/findings/surface`-ийн ӨӨРИЙН-Л семантикийг ХӨНДӨХГҮЙ:
 *    `evaluationStateFor` нь ХЭВЭЭР үлдэнэ, энэ нь ТУСДАА функц.
 *
 * Тоолуурууд нь ЗӨВХӨН төлөв гаргахад БИШ — `computeReadiness` руу ТООГООР
 * дамжина (`ReadinessBlocker.count`), тул хаалга «яагаад» гэдгийг ТООТОЙ
 * хэлнэ, зөвхөн enum-аар БИШ.
 */
async function projectEvaluationDetail(
  db: D1Database,
  projectId: number,
): Promise<{
  state: EvaluationState;
  partialFindings: number;
  staleFindings: number;
  aborted: number;
  ledgerRows: number;
}> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM rules WHERE status = 'published') AS rules_published,
         (SELECT COUNT(*) FROM rule_pack_versions WHERE status = 'published') AS packs_published,
         (SELECT COUNT(*) FROM rule_run_ledger WHERE project_id = ?1) AS ledger_rows,
         (SELECT COALESCE(SUM(aborted), 0) FROM rule_run_ledger WHERE project_id = ?1) AS aborted,
         (SELECT COUNT(*) FROM compliance_findings
           WHERE project_id = ?1 AND coverage = 'partial') AS partial_findings,
         (SELECT COUNT(*) FROM compliance_findings
           WHERE project_id = ?1 AND stale_at IS NOT NULL) AS stale_findings`,
    )
    .bind(projectId)
    .first<Record<string, unknown>>()
    .catch(() => null);

  const n = (key: string): number => Number(row?.[key] ?? 0) || 0;
  const partialFindings = n('partial_findings');
  const staleFindings = n('stale_findings');
  const aborted = n('aborted');
  const ledgerRows = n('ledger_rows');
  return {
    state: evaluationStateOf({
      rulesPublished: n('rules_published'),
      packsPublished: n('packs_published'),
      ledgerRows,
      aborted,
      partialFindings,
      staleFindings,
    }),
    partialFindings,
    staleFindings,
    aborted,
    ledgerRows,
  };
}

/** Гадаргуугийн төлөвийг хариултын НЭГ хэлбэрээр савлана. */
function surfaceEnvelope(state: SurfaceState): {
  surface_state: SurfaceState;
  label_mn: string;
  label_en: string;
  lists_findings: boolean;
} {
  const render = SURFACE_RENDER[state];
  return {
    surface_state: state,
    label_mn: render.labelMn,
    label_en: render.labelEn,
    lists_findings: render.listsFindings,
  };
}

/**
 * `evidence_json`-оос ЭШЛЭЛИЙГ гаргана — нотолгооны түвшин зөвшөөрсөн үед Л.
 *
 * ⚠️ ЗӨВШӨӨРӨӨГҮЙ үед `null` буцаана, ХООСОН ОБЬЕКТ БИШ.  Хоосон обьект нь
 *    «эшлэл байхгүй» гэж уншигдах ба UI нь «эх сурвалж олдсонгүй» гэсэн ӨӨР
 *    мессеж гаргана.  Ялгаа нь: эшлэл БАЙГАА ч ХЭВЛЭХ ЭРХГҮЙ (§65).
 * ⚠️ Нормын код / заалт / хэвлэл нь ХАРИУЛТААС БҮРЭН хасагдана — клиент рүү
 *    илгээгээд «нуу» гэж хэлэх нь нууц БИШ: `assistant_logs` ба хөтчийн
 *    сүлжээний таб хоёулаа түүнийг харна.
 */
function citationOf(
  evidenceJson: unknown,
  allowed: boolean,
): { document_uid: string | null; clause: string | null; edition: string | null } | null {
  if (!allowed) return null;
  const raw = typeof evidenceJson === 'string' ? safeParse(evidenceJson) : evidenceJson;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const doc = strOrNull(obj['document_uid'], 128);
  const clause = strOrNull(obj['clause'], 64);
  const edition = strOrNull(obj['edition'], 64);
  if (doc === null && clause === null && edition === null) return null;
  return { document_uid: doc, clause, edition };
}

/* ------------------------------------------------------------------ */
/*  GET /api/compliance/authority — ЭРХИЙН ТҮВШИН БА ХААЛГА            */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭНЭ МАРШРУТ НЬ ХЭЗЭЭ Ч 403 ӨГӨХГҮЙ.  Эрхийн түвшнийг МЭДЭХ нь
 *    дүгнэлтийг ХАРАХ БИШ: LEVEL 0 дээр самбар «Ажиглалт горим» гэж
 *    ЯЛГАЖ хэлж чадах ёстой, эс бөгөөс тэр нь «дүгнэлт алга» гэсэн ӨӨР
 *    төлөвөөс ялгагдахгүй.  Тэр хоёрыг холих нь энэ бүх дизайны шийдэж
 *    буй ГОЛ АСУУДАЛ.
 * ⚠️ `gates` нь ТУНХАГ, хэрэгжүүлэгч БИШ (`AUTHORITY_GATES`-ийн тайлбар).
 *    Хаалгыг бодитоор барих нь `assertCapability` ба нийтлэлийн гурван
 *    нөхцөл (`revit.ts:1970-1973`).
 */
compliance.get('/authority', async (c) => {
  const db = c.env.DB;
  const authority = await readAuthority(db);

  // ⚠️ ЗӨВХӨН НЭГТГЭЛ — `ruleset_version` нь БАГИЙН хэмжигдэхүүн тул
  //    хамгийн сүүлд нийтлэгдсэн багцуудыг л жагсаана.  Хэрэглэгчийн
  //    дүгнэлтийн тоо ЭНД ГАРАХГҮЙ.
  const packs = await db
    .prepare(
      `SELECT team_code, ruleset_version, pack_sha256, rule_count, published_at
         FROM rule_pack_versions
        WHERE status = 'published'
        ORDER BY published_at DESC, id DESC
        LIMIT 32`,
    )
    .all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));

  const publishedRules = await db
    .prepare(`SELECT COUNT(*) AS n FROM rules WHERE status = 'published'`)
    .first<{ n: number }>()
    .catch(() => null);

  return c.json({
    level: authority.level,
    level_index: authority.index,
    caps: authority.caps,
    rollout_pct: authority.rolloutPct,
    min_severity: authority.minSeverity,
    // ⚠️ `surface === false` үед add-in нь ribbon-ы тоолуурыг ХАРАНХУЙ
    //    үлдээнэ (`set_compliance_badge` дуудахгүй).  Энэ туг нь тэр
    //    шийдвэрийн ГАНЦ эх сурвалж — DLL дотор хатуу бичихгүй.
    surfacing_enabled: authority.caps.surface,
    // ⚠️ ХАРУУЛАХГҮЙ үед ЯАГААДЫГ ил хэлнэ.  `null` нь «шалтгаангүй» гэсэн
    //    үг — тэр нь «дүгнэлт алга» гэж уншигдана.
    notice: authority.caps.surface ? null : surfaceEnvelope('suppressed_by_authority'),
    gates: AUTHORITY_LEVELS.map((lvl) => AUTHORITY_GATES[lvl]),
    // ⚠️ ХООСОН ДҮРМИЙН БАГЦ НЬ ХЭВИЙН (эзний шийдвэр Ш4).  `rules_published
    //    = 0` нь «шалгалт хийгдээгүй» гэсэн үг — «нийцэж байна» БИШ.
    rules_published: Number(publishedRules?.n ?? 0) || 0,
    packs: packs.results ?? [],
  });
});

/* ------------------------------------------------------------------ */
/*  GET /api/compliance/findings/surface — ХАРАГДАХ БЭЛЭН БҮТЭЦ        */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭРЭМБЭ → НУГАЛАЛТ → ТАСЛАЛТ, ЯГ ЭНЭ ДАРААЛЛААР.  Урвуулбал
 *    `ChangeReport.cs:56-60`-ийн тэмдэглэсэн регресс давтагдана: хэрэглэгч
 *    «санамсаргүй N»-г БҮРЭН жагсаалт гэж үзээд үлдсэн зөрчлийг ЗАСАХГҮЙ.
 *    Тиймээс SQL нь ноцтой байдлаар эрэмбэлж 200 мөр авчирна, JS нь
 *    `compareFindingsForDisplay`-ээр ДАХИН эрэмбэлж (үндэс/хуучрал ордог),
 *    дараа нь Л таслана, ба таслагдсаныг `truncated` ИЛ хэлнэ.
 *
 * ⚠️ LEVEL 0 (OBSERVE) дээр ЭРТ БУЦНА — D1 руу дүгнэлтийн асуулга ОГТ
 *    явуулахгүй.  «Цуглуулна, харуулахгүй» гэдэг нь ЯГ ЭНЭ: мөрүүд
 *    хадгалагдсан хэвээр, зүгээр л уншигдахгүй.  Хариулт нь `groups: []`
 *    БОЛОВЧ `surface_state = 'suppressed_by_authority'` — «юу ч олдсонгүй»
 *    гэж УНШИГДАХ БОЛОМЖГҮЙ.
 */
compliance.get('/findings/surface', async (c) => {
  const viewer = c.get('user');
  const db = c.env.DB;

  const docUid = str(c.req.query('doc_uid'), 128);
  const projectId = intOrNull(c.req.query('project_id'));
  const authority = await readAuthority(db);

  if (!authority.caps.surface) {
    return c.json({
      authority: { level: authority.level, level_index: authority.index, caps: authority.caps },
      ...surfaceEnvelope('suppressed_by_authority'),
      groups: [],
      truncated: 0,
      // ⚠️ ТООЛУУР Ч ГАРАХГҮЙ.  «17 асуудал байгаа ч харуулахгүй» гэдэг нь
      //    өөрөө ХАРУУЛСАН хэрэг — LEVEL 0 нь тэр эрхийг ч өгөөгүй.
      visible_count: null,
      evaluation_state: null,
    });
  }

  const askedSeverity = str(c.req.query('min_severity'), 16).toUpperCase();
  const floor: Severity = isSeverity(askedSeverity) ? askedSeverity : authority.minSeverity;
  const allowed = SEVERITIES.filter((s) => SEVERITY_RANK[s] >= SEVERITY_RANK[floor]);

  const binds: (string | number)[] = [viewer.sub];
  let sql = `SELECT ${FINDING_COLUMNS} FROM compliance_findings WHERE detected_by = ?1`;
  if (docUid) {
    binds.push(docUid);
    sql += `\n   AND doc_uid = ?${binds.length}`;
  }
  if (projectId !== null) {
    binds.push(projectId);
    sql += `\n   AND project_id = ?${binds.length}`;
  }
  const sevMarks = allowed.map((s) => {
    binds.push(s);
    return `?${binds.length}`;
  });
  sql += `\n   AND lifecycle_state IN (${OPEN_STATES_SQL})
     AND severity IN (${sevMarks.join(', ')})
     ORDER BY ${SEVERITY_ORDER_SQL} DESC, last_evaluated_at DESC, id DESC
     LIMIT ${MAX_SURFACE_SCAN_ROWS}`;

  const { results } = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  const rows = results ?? [];
  const ids = rows.map((r) => Number(r['id'])).filter((v) => Number.isFinite(v));

  // §77 — ЗӨВХӨН `causes` ирмэг.  `duplicates` / `conflicts_with` нь ӨӨР
  // асуултууд (§64, §76-R3) ба тэднийг үндэс болгон нугалах нь хоёр өөр
  // элемент дээрх хоёр өөр зөрчлийг НЭГ мөр болгож нуух явдал.
  const edges: FindingEdge[] = [];
  for (const part of chunked(ids, EDGE_KEYS_PER_LOOKUP)) {
    const marks = part.map(() => '?').join(', ');
    const rs = await db
      .prepare(
        `SELECT from_finding_id, to_finding_id, kind
           FROM finding_edges
          WHERE kind = 'causes'
            AND (from_finding_id IN (${marks}) OR to_finding_id IN (${marks}))`,
      )
      .bind(...part, ...part)
      .all<{ from_finding_id: number; to_finding_id: number; kind: string }>()
      .catch(() => ({ results: [] as { from_finding_id: number; to_finding_id: number; kind: string }[] }));
    for (const e of rs.results ?? []) {
      edges.push({ from: Number(e.from_finding_id), to: Number(e.to_finding_id), kind: 'causes' });
    }
  }

  interface SurfaceRow extends FindingDisplayRow {
    readonly payload: Record<string, unknown>;
  }

  const display: SurfaceRow[] = [];
  for (const r of rows) {
    const id = Number(r['id']);
    if (!Number.isFinite(id)) continue;
    const severityRaw = String(r['severity'] ?? '');
    const severity: Severity = isSeverity(severityRaw) ? severityRaw : 'INFO';
    const evidenceRaw = String(r['evidence_level'] ?? '');
    const evidenceLevel: EvidenceLevel = isEvidenceLevel(evidenceRaw) ? evidenceRaw : 'UNKNOWN';
    const verdictRaw = String(r['verdict'] ?? '');
    const verdict: Verdict = isVerdict(verdictRaw) ? verdictRaw : 'UNCERTAIN';

    // ⚠️ ИЛЭРХИЙЛЭЛИЙН ХАВЧААР — УНШИХ үед.  Хадгалагдсан мөр ХӨНДӨГДӨХГҮЙ:
    //    `raw_verdict` нь машины ЖИНХЭНЭ дүгнэлт бөгөөд §68-ийн аудитын
    //    үндэс.  UI нь `verdict`-ыг харуулж, `clamped` үед «хүн шалгана»
    //    гэж нэмнэ.
    const clamp = clampByEvidence({ verdict, evidenceLevel });
    const rootId = resolveRootCause(id, edges).rootId;

    display.push({
      id,
      dedupKey: str(r['dedup_key'], 64),
      severity,
      rootId: rootId === id ? null : rootId,
      isStale: r['stale_at'] !== null && r['stale_at'] !== undefined,
      detectedAtMs: Date.parse(String(r['last_evaluated_at'] ?? '')) || 0,
      payload: {
        id,
        finding_uid: str(r['finding_uid'], 64),
        dedup_key: str(r['dedup_key'], 64),
        doc_uid: str(r['doc_uid'], 128),
        project_id: intOrNull(r['project_id']),
        rule_uid: str(r['rule_uid'], 64),
        rule_version: intOrNull(r['rule_version']) ?? 1,
        ruleset_version: str(r['ruleset_version'], 64),
        team_code: strOrNull(r['owner_team_code'], 16),
        verdict: clamp.verdict,
        raw_verdict: clamp.rawVerdict,
        verdict_clamped: clamp.clamped,
        issue_class: str(r['issue_class'], 32),
        severity,
        lifecycle_state: str(r['lifecycle_state'], 32),
        evidence_level: evidenceLevel,
        evidence_label_mn: clamp.labelMn,
        evidence_label_en: clamp.labelEn,
        // ⚠️ `citation === null` нь «эшлэл байхгүй» БИШ, «эшлэх эрхгүй».
        citation: citationOf(r['evidence_json'], clamp.citation && authority.caps.explain),
        // ⚠️ ЗАСВАРЫГ САНАЛ БОЛГОХ нь LEVEL 2 (RECOMMEND)-оос эхэлнэ.
        //    LEVEL 1 дээр текстийг хассан ба ЯАГААДЫГ ил хэлнэ — чимээгүй
        //    `null` нь «зөвлөмж бичигдээгүй» гэж уншигдана.
        recommendation_mn: authority.caps.recommend ? strOrNull(r['recommendation_mn'], MAX_TEXT) : null,
        recommendation_withheld: !authority.caps.recommend,
        coverage: str(r['coverage'], 16),
        uncertain_reason: strOrNull(r['uncertain_reason'], 32),
        counts_for_readiness: EVIDENCE_RENDER[evidenceLevel].countsForReadiness,
        is_stale: r['stale_at'] !== null && r['stale_at'] !== undefined,
        stale_reason: strOrNull(r['stale_reason'], 32),
        last_evaluated_at: str(r['last_evaluated_at'], 40),
      },
    });
  }

  const grouped = groupByRootCause(display, edges, {
    maxGroups: MAX_SURFACE_GROUPS,
    maxConsequences: MAX_SURFACE_CONSEQUENCES,
  });

  const evaluationState = await evaluationStateFor(db, viewer.sub, projectId, docUid);

  /* ⚠️ ШҮҮЛТЭД УНАСАН МӨРИЙГ ТООЛНО — «цэвэр» гэж бичихээс ӨМНӨ.
   *
   * Дээрх асуулга нь `severity IN (<floor-оос дээш>)` гэж шүүдэг тул
   * `min_severity`-ийн ДООРХ нээлттэй зөрчил хариултаас БҮРМӨСӨН гардаг.
   * `surfaceStateOf` нь зөвхөн `visibleCount` хардаг байсан тул тэр ТЭГ нь
   * `clean` болж, гадаргуу «Дүрмийн багцаар шалгав — анхаарах зүйл
   * олдсонгүй.» гэж бичдэг байв.  Хэмжсэн (2026-08-31): бүтэн скан +
   * ГУРВАН нээлттэй MEDIUM `VIOLATION`, `min_severity = 'HIGH'` (0228-ийн
   * анхдагч) → гадаргуу `clean`, ХАРИН §69-ийн хаалга ЯГ ТЭР үед
   * `NOT_READY` + `MEDIUM: 3`.  Хоёр гадаргуу ижил баримт дээр ЭСРЭГ
   * хариулт өгч байлаа.
   *
   * ⚠️ Энэ тоолуур нь ЖАГСААЛТЫГ өөрчлөхгүй — шүүлт нь хэрэглэгчийн
   *    сонголт ба ХҮНДЭТГЭГДЭНЭ.  Зөвхөн «ЦЭВЭР» гэж ЗАРЛАХ эрхийг хаана. */
  const hiddenBinds: (string | number)[] = [viewer.sub];
  let hiddenSql = `SELECT COUNT(*) AS n FROM compliance_findings WHERE detected_by = ?1`;
  if (docUid) {
    hiddenBinds.push(docUid);
    hiddenSql += `
   AND doc_uid = ?${hiddenBinds.length}`;
  }
  if (projectId !== null) {
    hiddenBinds.push(projectId);
    hiddenSql += `
   AND project_id = ?${hiddenBinds.length}`;
  }
  const hiddenMarks = allowed.map((sev) => {
    hiddenBinds.push(sev);
    return `?${hiddenBinds.length}`;
  });
  hiddenSql += `
   AND lifecycle_state IN (${OPEN_STATES_SQL})
     AND severity NOT IN (${hiddenMarks.join(', ')})`;
  const hiddenRow = await db
    .prepare(hiddenSql)
    .bind(...hiddenBinds)
    .first<{ n: number }>()
    .catch(() => null);
  const hiddenBelowFloor = Number(hiddenRow?.n ?? 0) || 0;

  const state = surfaceStateOf({
    authority: authority.level,
    evaluationState,
    visibleCount: grouped.groups.length,
    hiddenCount: hiddenBelowFloor,
  });

  return c.json({
    authority: { level: authority.level, level_index: authority.index, caps: authority.caps },
    ...surfaceEnvelope(state),
    evaluation_state: evaluationState,
    min_severity: floor,
    visible_count: display.length,
    // ⚠️ ШҮҮЛТЭД УНАСАН МӨРИЙН ТОО — ИЛ.  0-ээс их байвал UI нь «N мөр
    //    таны ноцтой байдлын шүүлтээс доор» гэж бичих ЁСТОЙ; эс бөгөөс
    //    хоосон жагсаалт нь «зөрчил алга» гэж уншигдана.
    hidden_below_min_severity: hiddenBelowFloor,
    // ⚠️ ТАСЛАГДСАНЫГ ИЛ ХЭЛНЭ.  0 биш байвал UI нь «+N бүлэг харагдаагүй»
    //    гэж бичих ЁСТОЙ — эс бөгөөс жагсаалт БҮРЭН мэт уншигдана.
    truncated: grouped.truncated,
    scan_capped: rows.length >= MAX_SURFACE_SCAN_ROWS,
    groups: grouped.groups.map((g) => ({
      primary: g.primary.payload,
      consequences: g.consequences.map((x) => x.payload),
      consequence_total: g.consequenceTotal,
      // ⚠️ `promoted` = жинхэнэ үндэс нь ЭНЭ жагсаалтад БАЙХГҮЙ (өөр хүн
      //    илрүүлсэн, хаагдсан, эсвэл шүүлтэд унасан).  UI нь «Үндсэн
      //    шалтгаан» гэж бичих ЭРХГҮЙ.
      promoted: g.promoted,
    })),
  });
});

/* ------------------------------------------------------------------ */
/*  GET /api/compliance/findings/:findingRef — НЭГ ДҮГНЭЛТИЙН ДЭЛГЭРЭНГҮЙ */
/* ------------------------------------------------------------------ */

/**
 * `:findingRef` нь `finding_uid` (тогтвортой) ЭСВЭЛ бүхэл тоон `id`.
 *
 * ⚠️ ХОЁУЛАНГ НЬ хүлээж авах шалтгаан: add-in нь `finding_uid`-ээ мэддэг
 *    (өөрөө үүсгэсэн), харин `finding_edges` нь `id`-аар холбогддог тул
 *    үндэс рүү үсрэх холбоос нь ЗӨВХӨН `id`-тэй.  Хоёр маршрут барих нь
 *    ижил эрхийн шалгалтыг хоёр газар бичих гэсэн үг.
 * ⚠️ `detected_by = viewer.sub` — 404, 403 БИШ.  403 нь тэр мөр ӨӨР ХҮН
 *    дээр ОРШИН БАЙГААГ ил болгоно (0227-ийн `/notices/:key/state`-ийн
 *    ижил шийдвэр).
 */
compliance.get('/findings/:findingRef', async (c) => {
  const viewer = c.get('user');
  const db = c.env.DB;
  const ref = str(c.req.param('findingRef'), 64);
  // ⚠️ Маршрутын дараалал өөрчлөгдвөл «surface» энд ирнэ — ил татгалзана.
  if (!ref || ref === 'surface' || ref === 'stale') return c.json({ error: 'not found' }, 404);

  const authority = await readAuthority(db);
  if (!authority.caps.surface) {
    // ⚠️ 403 БИШ, 200.  Энэ бол эрхийн асуудал БИШ, ГОРИМЫН асуудал —
    //    add-in нь мөрийг ХАРУУЛААГҮЙ учир хүн энэ рүү орох ёсгүй, гэвч
    //    хуучин холбоос дарагдвал «Ажиглалт горим» гэж ТАЙЛБАРЛАХ нь
    //    401/403-ын тайлбаргүй улаанаас дээр.
    return c.json({ ...surfaceEnvelope('suppressed_by_authority'), finding: null });
  }

  const numeric = /^[0-9]+$/.test(ref) ? Number(ref) : null;
  const finding = await db
    .prepare(
      `SELECT ${FINDING_COLUMNS} FROM compliance_findings
        WHERE detected_by = ?1 AND (finding_uid = ?2 OR (?3 IS NOT NULL AND id = ?3))
        LIMIT 1`,
    )
    .bind(viewer.sub, ref, numeric)
    .first<Record<string, unknown>>();
  if (!finding) return c.json({ error: 'not found' }, 404);

  const id = Number(finding['id']);
  const evidenceRaw = String(finding['evidence_level'] ?? '');
  const evidenceLevel: EvidenceLevel = isEvidenceLevel(evidenceRaw) ? evidenceRaw : 'UNKNOWN';
  const verdictRaw = String(finding['verdict'] ?? '');
  const verdict: Verdict = isVerdict(verdictRaw) ? verdictRaw : 'UNCERTAIN';
  const clamp = clampByEvidence({ verdict, evidenceLevel });

  // §77 — ҮНДЭС ба ДАГАВАР.  Хоёр асуулга: дээшлэх зам (`to = id`) ба
  // доошлох зам (`from = <үндэс>`).  ⚠️ Мөчлөгөөс `resolveRootCause` дотор
  // хамгаалагдсан; SQL нь ЗӨВХӨН нэг түвшин авчирна.
  const upRows = await db
    .prepare(
      `SELECT from_finding_id, to_finding_id, kind FROM finding_edges
        WHERE kind = 'causes' AND to_finding_id = ?1`,
    )
    .bind(id)
    .all<{ from_finding_id: number; to_finding_id: number }>()
    .catch(() => ({ results: [] as { from_finding_id: number; to_finding_id: number }[] }));

  const upEdges: FindingEdge[] = (upRows.results ?? []).map((e) => ({
    from: Number(e.from_finding_id),
    to: Number(e.to_finding_id),
    kind: 'causes' as const,
  }));
  const root = resolveRootCause(id, upEdges);

  const downRows = await db
    .prepare(
      `SELECT f.id, f.finding_uid, f.rule_uid, f.severity, f.verdict, f.evidence_level,
              f.issue_class, f.lifecycle_state, f.dedup_key
         FROM finding_edges e
         JOIN compliance_findings f ON f.id = e.to_finding_id
        WHERE e.kind = 'causes' AND e.from_finding_id = ?1 AND f.detected_by = ?2
        ORDER BY ${SEVERITY_ORDER_SQL_F} DESC, f.id ASC
        LIMIT ${MAX_SURFACE_CONSEQUENCES + 1}`,
    )
    .bind(root.rootId, viewer.sub)
    .all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));

  const elements = await db
    .prepare(
      `SELECT element_uid, element_id, category, level_name, role
         FROM finding_elements WHERE finding_id = ?1 ORDER BY role ASC, id ASC
        LIMIT ${MAX_ELEMENTS_PER_FINDING}`,
    )
    .bind(id)
    .all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));

  // ⚠️ ХҮЧИНГҮЙ БОЛГОЛТУУД НЬ ЖАГСААЛТ, ГАНЦ МӨР БИШ.  Хүн нэг дүгнэлтийг
  //    хоёр удаа хаасан бол ХОЁУЛАА түүхэнд үлдэнэ (0237 нь нэмэгдэх-л).
  const overrides = await db
    .prepare(
      `SELECT ${OVERRIDE_COLUMNS} FROM finding_overrides
        WHERE finding_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 20`,
    )
    .bind(id)
    .all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));

  return c.json({
    authority: { level: authority.level, level_index: authority.index, caps: authority.caps },
    finding: {
      ...finding,
      verdict: clamp.verdict,
      raw_verdict: clamp.rawVerdict,
      verdict_clamped: clamp.clamped,
      evidence_label_mn: clamp.labelMn,
      evidence_label_en: clamp.labelEn,
      counts_for_readiness: EVIDENCE_RENDER[evidenceLevel].countsForReadiness,
      recommendation_mn: authority.caps.recommend
        ? strOrNull(finding['recommendation_mn'], MAX_TEXT)
        : null,
      recommendation_withheld: !authority.caps.recommend,
      // ⚠️ ТҮҮХИЙ `evidence_json` нь ЭШЛЭХ ЭРХГҮЙ үед хариултаас БҮРЭН
      //    хасагдана — саарал болгож харуулах зам БАЙХГҮЙ (§65).
      evidence_json: clamp.citation && authority.caps.explain ? finding['evidence_json'] : null,
    },
    citation: citationOf(finding['evidence_json'], clamp.citation && authority.caps.explain),
    elements: elements.results ?? [],
    root: {
      root_id: root.rootId,
      is_root: root.rootId === id,
      chain: root.chain,
      // ⚠️ Мөчлөг илэрсэн бол UI нь «граф бүрэн бус» гэж хэлэх ёстой —
      //    чимээгүй дурын үндэс сонгох нь ХУДАЛ шалтгаан заана.
      cyclic: root.cyclic,
    },
    consequences: downRows.results ?? [],
    overrides: overrides.results ?? [],
  });
});

/* ------------------------------------------------------------------ */
/*  POST /api/compliance/findings/:findingRef/override — §68           */
/* ------------------------------------------------------------------ */

/**
 * ГАР ХҮЧИНГҮЙ БОЛГОЛТ — НЭМЭЛТ, UPDATE БИШ.
 *
 * ⚠️ ДҮГНЭЛТИЙГ ХЭЗЭЭ Ч ЗАСАХГҮЙ.  `UPDATE`-ийн `SET` хэсэгт `verdict`,
 *    `severity`, `evidence_level`, `calc_json`, `evidence_json` БАЙХГҮЙ —
 *    ЗӨВХӨН `lifecycle_state`.  Хүний санал зөрөлдөөн нь машины ЖИНХЭНЭ
 *    дүгнэлтийг УСТГАХ ЁСГҮЙ: §66-ийн худал дохионы хэмжүүр, §70-ийн
 *    регрессийн тест, §68-ийн аудит ГУРВУУЛАА тэр анхны утга дээр зогсоно.
 *
 * ⚠️ ХӨЛДӨӨХ УТГУУД СЕРВЕРЭЭС ГАРНА, КЛИЕНТЭЭС БИШ (`learning.ts:338-340`-ийн
 *    жишиг).  Хувилбар, хүнд байдал, нотолгооны түвшинг клиент зарлавал
 *    хүчингүй болголтын түүх ЗОХИОМОЛ болно — «ямар дүрмийн ямар хувилбар
 *    дээр санал нийлээгүй вэ» гэдэг нь хожим ЯМАР Ч аргаар сэргээгдэхгүй.
 *
 * ⚠️ ДАРААЛАЛ АЧААЛАЛТАЙ: override мөр ЭХЛЭЭД, дараа нь дүгнэлтийн төлөв.
 *    Урвуулбал бичилт таслагдахад дүгнэлт хаагдсан ч ЯАГААД гэдэг нь
 *    ХЭЗЭЭ Ч мэдэгдэхгүй болно.
 */
compliance.post('/findings/:findingRef/override', async (c) => {
  const viewer = c.get('user');
  const db = c.env.DB;
  const ref = str(c.req.param('findingRef'), 64);
  if (!ref || ref === 'surface' || ref === 'stale') return c.json({ error: 'not found' }, 404);

  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);

  // 1. ТӨРӨЛ ба ШАЛТГААН ЗААВАЛ.  ⚠️ Хоосон шалтгааныг DB CHECK хүртэл
  //    хүргэхгүй: хэрэглэгчид харагдах алдаа нь DB-ийнх байх ЁСГҮЙ, ба
  //    `NOT NULL` нь хоосон мөрийг ямар ч байсан барихгүй.
  const kindRaw: unknown = body['override_kind'];
  if (!isOverrideKind(kindRaw)) {
    return c.json({ error: 'override_kind буруу', allowed: OVERRIDE_KINDS }, 400);
  }
  const overrideKind = kindRaw;
  const reason = str(body['reason'], MAX_OVERRIDE_REASON_LEN);
  if (reason.length < MIN_OVERRIDE_REASON_LEN) {
    return c.json(
      { error: `Шалтгаан заавал (наад зах нь ${MIN_OVERRIDE_REASON_LEN} тэмдэгт)` },
      400,
    );
  }

  // 2. ДҮГНЭЛТИЙГ УНШИНА.  `bim_sessions` руу LEFT JOIN хийж `model_version` /
  //    `addin_version`-ыг СЕРВЕР дээр гаргана — §68-ийн 7 дахь элемент.
  const numeric = /^[0-9]+$/.test(ref) ? Number(ref) : null;
  const f = await db
    .prepare(
      `SELECT cf.id, cf.finding_uid, cf.dedup_key, cf.verdict, cf.severity, cf.evidence_level,
              cf.issue_class, cf.rule_uid, cf.rule_version, cf.ruleset_version, cf.pack_sha256,
              cf.semantic_hash, cf.owner_team_code, cf.detected_by, cf.lifecycle_state,
              cf.doc_uid, cf.project_id, cf.session_id,
              s.model_version AS session_model_version,
              s.addin_version AS session_addin_version
         FROM compliance_findings cf
         LEFT JOIN bim_sessions s ON s.id = cf.session_id
        WHERE cf.finding_uid = ?1 OR (?2 IS NOT NULL AND cf.id = ?2)
        LIMIT 1`,
    )
    .bind(ref, numeric)
    .first<Record<string, unknown>>();
  if (!f) return c.json({ error: 'олдсонгүй' }, 404);

  // 3. ЭРХ: дүгнэлтийг ИЛРҮҮЛСЭН хүн ӨӨРӨӨ, эсвэл менежер (admin|senior).
  //    ⚠️ Өөрийгөө л харах инвариантын шууд үр дагавар — өөр инженерийн
  //    дүгнэлтийг хаах нь түүний ажлын талаар шийдвэр гаргаж байгаа хэрэг.
  //    ⚠️ ЗӨВХӨН МЕНЕЖЕР болговол инженер өөрийн «худал дохио»-г тэмдэглэж
  //    чадахгүй ба §66-ийн ХАМГИЙН ХЯМД эх сурвалж алдагдана (§9.4-7).
  const isManager = viewer.role === 'admin' || viewer.role === 'senior';
  const detectedBy = intOrNull(f['detected_by']);
  if (!isManager && detectedBy !== viewer.sub) return c.json({ error: 'эрх хүрэхгүй' }, 403);

  const currentRaw = String(f['lifecycle_state'] ?? '');
  const current: LifecycleState = isLifecycleState(currentRaw) ? currentRaw : 'OPEN';
  // ⚠️ `FIXED` / `INVALIDATED`-аас `DISMISSED` рүү зам БАЙХГҮЙ
  //    (`ALLOWED_TRANSITIONS`, 2-3).  Зассан ажлыг «хүчингүй» гэж
  //    дахин тэмдэглэх нь түүхийг гуйвуулна.
  if (current !== 'DISMISSED' && !canTransition(current, 'DISMISSED')) {
    return c.json(
      { error: 'illegal transition', from: current, to: 'DISMISSED', allowed: ALLOWED_TRANSITIONS[current] },
      409,
    );
  }

  const findingId = Number(f['id']);
  // 4. НЭМНЭ — ХӨЛДӨӨСӨН утгууд БҮГД серверийн мөрөөс.
  const ins = await db
    .prepare(
      `INSERT INTO finding_overrides
         (finding_id, finding_uid, dedup_key, override_kind, reason, evidence_note,
          evidence_artifact_id, verdict_at_override, severity_at_override,
          evidence_level_at_override, issue_class_at_override,
          rule_uid, rule_version, ruleset_version, pack_sha256, semantic_hash,
          model_version, addin_version, team_code, created_by)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`,
    )
    .bind(
      findingId,
      str(f['finding_uid'], 64),
      str(f['dedup_key'], 64),
      overrideKind,
      reason,
      strOrNull(body['evidence_note'], 2000),
      intOrNull(body['evidence_artifact_id']),
      String(f['verdict'] ?? ''),
      String(f['severity'] ?? ''),
      String(f['evidence_level'] ?? ''),
      strOrNull(f['issue_class'], 32),
      strOrNull(f['rule_uid'], 64),
      intOrNull(f['rule_version']),
      strOrNull(f['ruleset_version'], 64),
      strOrNull(f['pack_sha256'], 64),
      strOrNull(f['semantic_hash'], 64),
      strOrNull(f['session_model_version'], 64),
      strOrNull(f['session_addin_version'], 32),
      strOrNull(f['owner_team_code'], 16),
      viewer.sub,
    )
    .run();

  const overrideId = Number(ins.meta.last_row_id ?? 0) || null;

  // 5. ДҮГНЭЛТИЙГ ХААНА.  ⚠️ SET хэсэгт `verdict`, `severity`,
  //    `evidence_level` БАЙХГҮЙ (§68-R2).  `resolved_at` нь хаагдсан
  //    цагийг барина — 0224-д `dismissed_at` багана БАЙХГҮЙ.
  const upd = await db
    .prepare(
      `UPDATE compliance_findings
          SET lifecycle_state = 'DISMISSED',
              resolved_at = COALESCE(resolved_at, datetime('now')),
              updated_at = datetime('now')
        WHERE id = ?1 AND lifecycle_state <> 'DISMISSED'`,
    )
    .bind(findingId)
    .run();
  const changed = (upd.meta.changes ?? 0) > 0;

  // 6. ТӨЛӨВ ӨӨРЧЛӨЛТИЙН ҮЙЛ ЯВДАЛ — `RULE_VALIDATION` мөр (2-3-ийн ялгагч).
  //    ⚠️ Үнэлгээ бүрд БИШ, ЗӨВХӨН төлөв солигдоход.  Хоёр дахь удаагаа
  //    хаахад (`changed === false`) үйл явдал БИЧИГДЭХГҮЙ — эс бөгөөс
  //    сургалтын корпуст ижил шилжилт олон удаа орно.
  if (changed) {
    const streamId = `cf-override:${viewer.sub}:${str(f['finding_uid'], 64)}`.slice(0, 64);
    const seqRow = await db
      .prepare(`SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM learning_events WHERE stream_id = ?`)
      .bind(streamId)
      .first<{ next: number }>()
      .catch(() => null);
    const seq = Math.max(0, Number(seqRow?.next ?? 0) || 0);

    const payload = {
      rule_id: String(f['rule_uid'] ?? ''),
      passed: String(f['verdict'] ?? '') === 'PASS',
      finding_uid: str(f['finding_uid'], 64),
      // ⚠️ ЖИНХЭНЭ дүгнэлт — хавчсан нь БИШ.  Сургалтын корпус нь
      //    ХАРАГДАЦЫН дүрмээр биш, МАШИНЫ гаргалтаар суралцана.
      verdict: String(f['verdict'] ?? ''),
      prev_verdict: String(f['verdict'] ?? ''),
      lifecycle_state: 'DISMISSED',
      prev_lifecycle_state: current,
      issue_class: String(f['issue_class'] ?? ''),
      evidence_level: String(f['evidence_level'] ?? ''),
      severity: String(f['severity'] ?? ''),
      override_id: overrideId,
      override_kind: overrideKind,
      // ⚠️ §66-ийн хэмжүүрийн шууд оролт.  `ACCEPTED_RISK` нь ХУДАЛ ДОХИО
      //    БИШ — тэр ялгааг ЭНД алдвал худал дохионы хувь хэмжигдэхээ болино.
      false_signal: OVERRIDE_MEANING[overrideKind].falseSignal,
      decided_by: 'human',
      rule_version: intOrNull(f['rule_version']) ?? 1,
      ruleset_version: str(f['ruleset_version'], 64),
      pack_sha256: strOrNull(f['pack_sha256'], 64),
      team_code: strOrNull(f['owner_team_code'], 16),
      doc_uid: str(f['doc_uid'], 128),
    };
    const { expected, present } = partsForEvent({
      kind: 'RULE_VALIDATION',
      artifactResolved: false,
      txn: 'none',
      parent: 'none',
      payload,
    });

    await writeBimBatch(db, {
      txns: [],
      touches: [],
      events: [
        {
          session_id: intOrNull(f['session_id']),
          stream_id: streamId,
          seq,
          event_uid: `cfo-${viewer.sub}-${str(f['dedup_key'], 64)}-${overrideId ?? seq}`.slice(0, 64),
          kind: 'RULE_VALIDATION',
          actor_kind: 'human',
          actor_user_id: viewer.sub,
          project_id: intOrNull(f['project_id']),
          task_id: null,
          doc_uid: str(f['doc_uid'], 128) || null,
          txn_uid: null,
          element_id: null,
          parent_event_uid: null,
          causal_event_uid: null,
          artifact_id: null,
          payload_json: JSON.stringify(payload),
          parts_expected: expected,
          parts_present: present,
          provenance: 'MACHINE_GENERATED',
          model_version: null,
          ruleset_version: str(f['ruleset_version'], 64) || null,
          occurred_at: new Date().toISOString(),
        },
      ],
    });
  }

  return c.json(
    {
      override_id: overrideId,
      finding_uid: str(f['finding_uid'], 64),
      lifecycle_state: 'DISMISSED',
      changed,
      review_state: 'pending',
      // ⚠️ UI-Д ЯГ ЭНЭ МӨР ГАРНА.  «устгагдлаа» гэж ХЭЗЭЭ Ч бичихгүй —
      //    дүгнэлт нь түүхэнд үлдэж, §66/§70-д ажилласаар байна.
      message_mn: 'Хаагдлаа. Дүгнэлт устаагүй — түүхэнд үлдэнэ.',
      message_en: 'Closed. The finding is not deleted — it stays in the record.',
    },
    201,
  );
});

/* ------------------------------------------------------------------ */
/*  GET /api/compliance/overrides — ХЯНАЛТЫН ЖАГСААЛТ (§68-R4)         */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ КУРАЦИЙН ХУУДСЫН ДӨРӨВ ДЭХ ТАБЫН ЭХ СУРВАЛЖ.  ХОЁР ДАХЬ хянах
 *    гадаргуу барихгүй (`AssistantCurationPage.tsx:44-79`) — §68-ийн
 *    бүртгэлийг хоёр газар хуваавал татгалзлын үгсийн сан хоёр болж,
 *    `2-6`-ийн тэнцэх дүрэм тодорхойгүй болно.
 * ⚠️ ЭНЭ ЖАГСААЛТ `detected_by`, элементийн uid, өрөөний нэрийг БУЦААХГҮЙ.
 *    Хянагчид хэрэгтэй нь ДҮРЭМ, ШАЛТГААН, ХУВИЛБАР — «хэн хамгийн олон
 *    зөрчилтэй вэ» гэсэн харагдац ХЭЗЭЭ Ч үүсэхгүй.
 */
compliance.get('/overrides', requireManager(), async (c) => {
  const db = c.env.DB;
  // ⚠️ ХОЁР НЭР, НЭГ УТГА.  `OverridesTab.tsx` нь `?state=` илгээдэг, энэ
  //    маршрут `?review_state=`-ыг Л уншдаг байсан тул `isReviewState()`
  //    ХЭЗЭЭ Ч үнэн болохгүй, `WHERE` нь `1 = 1` хэвээр үлдэж, ДӨРВӨН дэд
  //    таб (pending / reviewed / verified / rejected) БҮГД ЯГ ИЖИЛ
  //    «хамгийн сүүлийн N» жагсаалтыг харуулж байв — §68-R4-ийн сургалтын
  //    хаалганы дараалал нь ДАРААЛАЛ БИШ болсон гэсэн үг.
  //    ЗАСВАР СЕРВЕР ТАЛД: хоёулаа хүлээж авна (`review_state` нь ТЭРГҮҮН,
  //    аль хэдийн бичигдсэн дуудагчийг эвдэхгүй) тул frontend-д ЗАСВАР
  //    ШААРДАХГҮЙ.
  const stateFilter = str(c.req.query('review_state') || c.req.query('state'), 16);
  const kindFilter = str(c.req.query('override_kind'), 32).toUpperCase();
  const askedLimit = intOrNull(c.req.query('limit')) ?? 50;
  const limit = Math.min(MAX_OVERRIDE_ROWS, Math.max(1, askedLimit));

  const binds: (string | number)[] = [];
  let where = '1 = 1';
  if (isReviewState(stateFilter)) {
    binds.push(stateFilter);
    where += ` AND o.review_state = ?${binds.length}`;
  }
  if (isOverrideKind(kindFilter)) {
    binds.push(kindFilter);
    where += ` AND o.override_kind = ?${binds.length}`;
  }

  const { results } = await db
    .prepare(
      `SELECT ${OVERRIDE_COLUMNS_O},
              cu.full_name AS created_by_name,
              ru.full_name AS reviewed_by_name,
              cf.lifecycle_state AS finding_lifecycle_state
         FROM finding_overrides o
         LEFT JOIN users cu ON cu.id = o.created_by
         LEFT JOIN users ru ON ru.id = o.reviewed_by
         LEFT JOIN compliance_findings cf ON cf.id = o.finding_id
        WHERE ${where}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ${limit}`,
    )
    .bind(...binds)
    .all<Record<string, unknown>>();

  const rows = results ?? [];
  return c.json({
    // ⚠️ `false_signal` нь мөр бүрд СЕРВЕР дээр тооцоологдоно — frontend нь
    //    `FALSE_POSITIVE` гэсэн МӨРИЙГ дахин тайлбарлах ЁСГҮЙ.  Хоёр газар
    //    тайлбарлавал §66-ийн хэмжүүр UI-ийн хувилбараас хамаарна.
    overrides: rows.map((r) => {
      const kind = String(r['override_kind'] ?? '');
      const meaning = isOverrideKind(kind) ? OVERRIDE_MEANING[kind] : null;
      return { ...r, meaning };
    }),
    limit,
    // ⚠️ ТАСАЛДСАНЫГ ЧИМЭЭГҮЙ БҮҮ ХИЙ.  `?limit=200` нь 100 болж
    //    таслагдана; клиент «бүгд ирлээ» гэж бодохгүйн тулд ХҮСЭЛТИЙН тоо
    //    ба ДЭЭД хязгаар хоёулаа ил гарна.
    limit_requested: askedLimit,
    limit_max: MAX_OVERRIDE_ROWS,
    // ⚠️ Аль шүүлт ҮНЭХЭЭР хэрэгжсэнийг ИЛ хэлнэ — «шүүлээ гэж бодсон
    //    боловч бүх мөр ирсэн» гэсэн F3-ын алдаа дахин ЧИМЭЭГҮЙ болохгүй.
    applied_review_state: isReviewState(stateFilter) ? stateFilter : null,
    applied_override_kind: isOverrideKind(kindFilter) ? kindFilter : null,
    review_states: REVIEW_DECISIONS,
    override_kinds: OVERRIDE_KINDS,
  });
});

/* ------------------------------------------------------------------ */
/*  POST /api/compliance/overrides/:id/review — §68-R4 сургалтын хаалга */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭХНИЙ ШИЙДВЭР ЯЛНА (`revit.ts:2397-2403`-ийн жишиг).  `AND reviewed_at
 *    IS NULL` нь уралдааны хамгаалалт; 0237-ийн trigger нь ХОЁР ДАХЬ
 *    давхарга (`WHEN OLD.reviewed_at IS NOT NULL` → RAISE(ABORT)) ба тэр нь
 *    D1 дээр ГАРААР UPDATE хийсэн тохиолдлыг ч барина.
 * ⚠️ `pending` рүү БУЦААХ зам БАЙХГҮЙ (`REVIEW_DECISIONS` нь гурван утга).
 *    Хянасныг «дахин хянаагүй» болгох нь `2-6`-ийн сургалтын багцаас мөр
 *    ЧИМЭЭГҮЙ хасах зам болно.
 * ⚠️ ХЯНАСНЫ ДАРАА Л сургалтад орно (`TRAINING_ELIGIBLE_REVIEW_STATES`).
 *    Тиймээс хариулт нь `training_eligible`-ыг ил буцаана — хянагч өөрийн
 *    шийдвэрийн үр дагаврыг ХАРСАН байх ёстой.
 */
compliance.post('/overrides/:id/review', requireManager(), async (c) => {
  const viewer = c.get('user');
  const db = c.env.DB;
  const id = intOrNull(c.req.param('id'));
  if (id === null || id <= 0) return c.json({ error: 'bad id' }, 400);

  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const rawState = str(body['review_state'], 16);
  if (!isReviewDecision(rawState)) {
    return c.json({ error: 'review_state буруу', allowed: REVIEW_DECISIONS }, 400);
  }
  const note = strOrNull(body['review_note'], MAX_TEXT);

  const res = await db
    .prepare(
      `UPDATE finding_overrides
          SET review_state = ?1, reviewed_by = ?2, reviewed_at = datetime('now'), review_note = ?3
        WHERE id = ?4 AND reviewed_at IS NULL`,
    )
    .bind(rawState, viewer.sub, note, id)
    .run();

  if ((res.meta.changes ?? 0) === 0) {
    // ⚠️ 409, 404 БИШ — мөр байхгүй ба аль хэдийн хянагдсаныг ялгах нь
    //    хянагчийн жагсаалт дээр утга багатай (мөр нь жагсаалтаас ирсэн).
    //    Хоёуланд нь ижил мессеж: «аль хэдийн хянагдсан».
    return c.json({ error: 'аль хэдийн хянагдсан', message_mn: 'Энэ бүртгэл аль хэдийн хянагдсан.' }, 409);
  }

  const row = await db
    .prepare(`SELECT ${OVERRIDE_COLUMNS} FROM finding_overrides WHERE id = ?1`)
    .bind(id)
    .first<Record<string, unknown>>();

  const kind = String(row?.['override_kind'] ?? '');
  const evRaw = String(row?.['evidence_level_at_override'] ?? '');
  const eligible =
    isOverrideKind(kind) && isEvidenceLevel(evRaw)
      ? isOverrideTrainingEligible({
          overrideKind: kind,
          reviewState: rawState,
          evidenceLevelAtOverride: evRaw,
          reason: String(row?.['reason'] ?? ''),
        })
      : false;

  return c.json({
    ok: true,
    id,
    review_state: rawState,
    // ⚠️ `2-6` нь ЭНЭ тугийг ДАХИН тооцоолно (энэ нь мэдээлэл, гэрээ БИШ) —
    //    гэхдээ ХОЁУЛАА `isOverrideTrainingEligible`-ээр орно, тиймээс
    //    хоёр өөр хариулт гарах боломжгүй.
    training_eligible: eligible,
  });
});

/* ================================================================== */
/*  ⬇⬇⬇  2-7 ЭНДЭЭС ДООШ (2-5 нь ЭНЭ мөрийн ДЭЭР дуусав)              */
/* ================================================================== */


/* ================================================================== */
/*  2-7 · §59 БҮРЭН БҮТЭН БАЙДАЛ · §60 САЛБАР ХООРОНД · §66 ЧАНАР ·    */
/*        §69 «ХЯНАХАД БЭЛЭН» ХААЛГА  —  ЗӨВХӨН УНШИНА                */
/*                                                                     */
/*  ⚠️ ЭНЭ БЛОК НЬ Track 2-ИЙН СҮҮЛИЙНХ.  Дээрх бүх маршрут нь `2-2`,  */
/*  `2-4`, `2-3`, `2-6`, `2-5` сессийнх — тэдгээрийг ХӨНДӨӨГҮЙ.        */
/*  Доор ӨӨР БЛОК ОРОХГҮЙ; `export default compliance` л үлдэнэ.       */
/*                                                                     */
/*  ⚠️ ЭНЭ БЛОК `INSERT` / `UPDATE` / `DELETE` МЭДЭГДЭЛ АГУУЛААГҮЙ.    */
/*  `?nominate=1` ч БИЧИХГҮЙ (`eval/nominate.py:9-10`-ийн дүрэм: нэр   */
/*  дэвшүүлэлт АВТОМАТ, БАТЛАХ нь ХҮН).  Migration ч АВААГҮЙ.          */
/*                                                                     */
/*  ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ.  Доорх ГУРВАН маршрутын хариунд */
/*  хэрэглэгчийн танигч, нэр, элементийн эзэн ОГТ БАЙХГҮЙ.  `GROUP BY` */
/*  нь ЗӨВХӨН `severity` · `issue_class` · `team_code` · `rule_uid` ·  */
/*  `verdict` · `skipped_reason` — ХЭЗЭЭ Ч хүний багана БИШ            */
/*  (`routes/learning.ts:894`-ийн `/health`-ийн хэлбэр).               */
/*                                                                     */
/*  ⚠️ `withEdgeCache` ХЭРЭГЛЭХГҮЙ: хариу нь дүрмийн багцын хувилбар,  */
/*  багийн бүртгэл ба олдворын төлөвөөс хамаардаг — гурвуулаа ажиллаж  */
/*  байхад өөрчлөгддөг тул `varyTags`-ыг бүрэн тоолох боломжгүй.       */
/* ================================================================== */

import {
  COMPLETENESS_CHECKS,
  COMPLETENESS_SPEC,
  EVIDENCE_LEVELS,
  completenessStateOfCount,
  completenessStateOfFlag,
  countableCompletenessCheck,
  countsForReadiness,
  type CompletenessCheck,
  type CompletenessState,
} from '../lib/complianceModel';
import {
  READY_MIN_COMPLETENESS_PCT,
  checkedLabel,
  coverageNotMeasuredLabel,
  computeReadiness,
  coverageLabel,
  foldSeverityRows,
  fpRates,
  noPackLabel,
  notRunLabel,
  rateOf,
  recallOf,
} from '../lib/readiness';

/**
 * §69-ийн тоолуурт ОРОХ нотолгооны түвшнүүд — `2-5`-ын `EVIDENCE_RENDER`
 * дэх `countsForReadiness` тугаас УРГАНА.
 *
 * ⚠️ ЖАГСААЛТЫГ ГАРААР БИЧИХГҮЙ.  `AI_INFERRED` нь §65-аар «норм БИШ» тул
 *    хаалганы тоонд орохгүй; түүнийг SQL-д хатуу бичвэл нэг өдөр
 *    `EVIDENCE_RENDER` өөрчлөгдөөд SQL хоцорно — тэр нь AI-ийн таамгийг
 *    зөрчил болгож тоолох (эсвэл эсрэгээр нуух) өдөр.
 */
const READINESS_EVIDENCE_SQL = EVIDENCE_LEVELS.filter((l) => countsForReadiness(l))
  .map((l) => `'${l}'`)
  .join(', ');

/** §66-ийн цонхны дээд хязгаар — хоногоор. */
const MAX_QUALITY_DAYS = 365;
const DEFAULT_QUALITY_DAYS = 30;
/** `?nominate=1`-ийн ХЭВЛЭХ мөрийн дээд тоо. */
const MAX_NOMINATIONS = 25;
/** «Энэ дүрэм худал дохио өгч байна» гэж нэр дэвшүүлэх ХАМГИЙН БАГА тоо. */
const NOMINATE_MIN_SIGNALS = 2;

/** §59-ийн нэг мөр — маршрут ба самбар хоёулаа ЭНЭ хэлбэрийг уншина. */
interface CompletenessGap {
  check: CompletenessCheck;
  state: CompletenessState;
  source: string;
  issue_class: string;
  severity: string;
  /** Хуваарьт орох эсэх — `complianceModel.countableCompletenessCheck`-ээс. */
  countable: boolean;
  label_mn: string;
  label_en: string;
  /** ⚠️ ЗӨВХӨН ТООЛУУР.  Нэр, элементийн танигч, өрөөний дугаар ОРОХГҮЙ. */
  detail: Record<string, number | string | boolean | null>;
  blocked_reason: string | null;
}

/**
 * §59-R2-ын арван нөхцөлийг ОДОО БАЙГАА хүснэгтээс УНШИНА.
 *
 * ⚠️ ЭНЭ ФУНКЦ ЮУ Ч БИЧИХГҮЙ.  «Дүрмээр бичигдсэн цоорхой» (№1, 2, 3, 4, 9)
 *    нь ирээдүйд `2-3`-ын хөдөлгүүрээр `compliance_findings` мөр болно;
 *    энэ функц нь тэр хүртэл (ба түүний ХАЖУУГААР) УНШЛАГЫН салаа —
 *    яг ийм учраас энэ сесс migration АВААГҮЙ.
 *
 * ⚠️ ТӨЛӨВИЙН УТГА нь «дохио АВСАН уу», «бүрэн үү» БИШ.  `asserted_absent`
 *    нь ХЭМЖИГДСЭН сөрөг хариулт бөгөөд `computeCompleteness` түүнийг
 *    «мэдэгдсэн» гэж тоолно (`AccordionForm.tsx:41-49`).  Бодит дутагдал
 *    нь `detail` дотор тоогоор гарна.
 */
async function deriveCompletenessGaps(
  db: D1Database,
  projectId: number,
): Promise<CompletenessGap[]> {
  /* --- 1. Бүртгэлийн алгасалтын шалтгаанууд (№1, №2) --- */
  const skips = await db
    .prepare(
      `SELECT skipped_reason, COUNT(*) AS n
         FROM rule_run_ledger
        WHERE project_id = ?1 AND skipped_reason IS NOT NULL
        GROUP BY skipped_reason`,
    )
    .bind(projectId)
    .all<{ skipped_reason: string; n: number }>()
    .catch(() => ({ results: [] as { skipped_reason: string; n: number }[] }));

  const skipOf = (reason: string): number =>
    Number((skips.results ?? []).find((r) => r.skipped_reason === reason)?.n ?? 0) || 0;

  const ledgerRows = await db
    .prepare(`SELECT COUNT(*) AS n FROM rule_run_ledger WHERE project_id = ?1`)
    .bind(projectId)
    .first<{ n: number }>()
    .catch(() => null);
  const ledgerMeasured = (Number(ledgerRows?.n ?? 0) || 0) > 0;

  /* --- 2. Хамгийн сүүлийн тоо хэмжээний түлхэлт (№3, №4) --- */
  const lastRun = await db
    .prepare(`SELECT id FROM qto_runs WHERE project_id = ?1 ORDER BY id DESC LIMIT 1`)
    .bind(projectId)
    .first<{ id: number }>()
    .catch(() => null);
  const runId = Number(lastRun?.id ?? 0) || 0;
  let roomCount = 0;
  let openingCount = 0;
  if (runId > 0) {
    const q = await db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM qto_rooms WHERE qto_run_id = ?1) AS rooms,
           (SELECT COUNT(*) FROM qto_facts WHERE qto_run_id = ?1
             AND category IN ('Doors','Windows')) AS openings`,
      )
      .bind(runId)
      .first<Record<string, unknown>>()
      .catch(() => null);
    roomCount = Number(q?.['rooms'] ?? 0) || 0;
    openingCount = Number(q?.['openings'] ?? 0) || 0;
  }

  /* --- 3. Багийн тайлангийн бөглөлт (№5 зургийн жагсаалт, №7 тайлбар) --- */
  const reports = await db
    .prepare(
      `SELECT team_code, answers_json FROM project_team_reports WHERE project_id = ?1`,
    )
    .bind(projectId)
    .all<{ team_code: string; answers_json: string }>()
    .catch(() => ({ results: [] as { team_code: string; answers_json: string }[] }));

  let sheetPresent = 0;
  let sheetAbsent = 0;
  let docPresent = 0;
  let docTotal = 0;
  const reportRows = reports.results ?? [];
  for (const row of reportRows) {
    const parsed = safeParse(String(row.answers_json ?? '{}'));
    if (!parsed || typeof parsed !== 'object') continue;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const state = completenessStateOfFlag(value);
      // ⚠️ Зургийн жагсаалт нь `dl_` угтвартай түлхүүрүүд (`ba/BaDocument.tsx:81`,
      //    `iz/template.ts:47`).  Угтварыг өөрчлөх нь ЭНЭ мөрийг ч өөрчилнө.
      if (key.startsWith('dl_')) {
        if (state === 'asserted_present') sheetPresent += 1;
        else if (state === 'asserted_absent') sheetAbsent += 1;
        continue;
      }
      docTotal += 1;
      if (state === 'asserted_present') docPresent += 1;
    }
  }
  const sheetSignals = sheetPresent + sheetAbsent;

  /* --- 4. Төслийн ангилал ба өндөр (№9) --- */
  const ctx = await db
    .prepare(
      `SELECT building_type, occupancy_class, height_m, height_basis, stories_above_grade
         FROM project_build_context
        WHERE project_id = ?1
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(projectId)
    .first<Record<string, unknown>>()
    .catch(() => null);
  const hasType = ctx !== null && str(ctx['building_type'], 64) !== '';
  const hasHeight = ctx !== null && ctx['height_m'] !== null && ctx['height_m'] !== undefined;
  const heightBasis = ctx === null ? '' : str(ctx['height_basis'], 32);
  // ⚠️ `height_basis = 'unknown'` нь БАЙГАА мөр ч гэсэн ХЭМЖИГДЭЭГҮЙ.  Түүнийг
  //    «мэдэгдсэн» гэж тоолбол ӨНДӨР БАРИЛГЫН багц чимээгүй алгасагдана.
  const ctxState: CompletenessState =
    ctx === null ? 'unknown' : hasType && hasHeight && heightBasis !== 'unknown' ? 'asserted_present' : 'unknown';

  /* --- 5. Шаардлагатай нотолгоо (№10) --- */
  const evidence = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN parts_missing <> 0 THEN 1 ELSE 0 END), 0) AS unsatisfied
         FROM learning_events WHERE project_id = ?1`,
    )
    .bind(projectId)
    .first<Record<string, unknown>>()
    .catch(() => null);
  const evTotal = Number(evidence?.['total'] ?? 0) || 0;
  const evMissing = Number(evidence?.['unsatisfied'] ?? 0) || 0;

  const states: Record<CompletenessCheck, { state: CompletenessState; detail: CompletenessGap['detail'] }> = {
    required_categories: {
      state: completenessStateOfCount(skipOf('no_category') === 0 ? 1 : 0, ledgerMeasured),
      detail: { skipped_rules: skipOf('no_category'), ledger_rows: Number(ledgerRows?.n ?? 0) || 0 },
    },
    required_params: {
      state: completenessStateOfCount(skipOf('missing_params') === 0 ? 1 : 0, ledgerMeasured),
      detail: { skipped_rules: skipOf('missing_params') },
    },
    rooms: {
      state: completenessStateOfCount(roomCount, runId > 0),
      detail: { rooms: roomCount, has_qto_run: runId > 0 },
    },
    openings: {
      state: completenessStateOfCount(openingCount, runId > 0),
      detail: { openings: openingCount, has_qto_run: runId > 0 },
    },
    sheets: {
      state:
        sheetSignals === 0 ? 'unknown' : sheetAbsent === 0 ? 'asserted_present' : 'asserted_absent',
      detail: { checked: sheetPresent, unchecked: sheetAbsent, teams: reportRows.length },
    },
    model_warnings: { state: 'unknown', detail: {} },
    documentation: {
      state: docTotal === 0 ? 'unknown' : docPresent === docTotal ? 'asserted_present' : 'asserted_absent',
      detail: { filled: docPresent, fields: docTotal, teams: reportRows.length },
    },
    unapproved_types: { state: 'unknown', detail: {} },
    project_information: {
      state: ctxState,
      detail: {
        has_context_row: ctx !== null,
        has_building_type: hasType,
        has_height: hasHeight,
        height_basis: heightBasis === '' ? null : heightBasis,
      },
    },
    required_evidence: {
      state: evTotal === 0 ? 'unknown' : evMissing === 0 ? 'asserted_present' : 'asserted_absent',
      detail: { events: evTotal, unsatisfied: evMissing },
    },
  };

  return COMPLETENESS_CHECKS.map((check) => {
    const spec = COMPLETENESS_SPEC[check];
    const s = states[check];
    return {
      check,
      state: s.state,
      source: spec.source,
      issue_class: spec.issue_class,
      severity: spec.severity,
      countable: countableCompletenessCheck(check),
      label_mn: spec.label_mn,
      label_en: spec.label_en,
      detail: s.detail,
      blocked_reason: spec.blocked_reason ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  GET /api/compliance/projects/:id/readiness — §69-ийн ХААЛГА        */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ГУРВАН ТӨЛӨВ, `UNKNOWN` нь НУРААГДАХГҮЙ.  `rules` ХООСОН шипнэ
 *    (эзний шийдвэр Ш4) тул ЭНЭ маршрутын АНХДАГЧ хариулт нь `UNKNOWN` —
 *    «юу ч шалгаагүй».  `READY` («шалгаад цэвэр») хэзээ ч тэр замаар
 *    гарахгүй: шийдвэр `lib/readiness.ts`-ийн `computeReadiness` дотор,
 *    маршрут ЗӨВХӨН тоолуур цуглуулна.
 *
 * ⚠️ ХАРИУНД ХЭРЭГЛЭГЧИЙН ТАНИГЧ, НЭР, ЭЛЕМЕНТИЙН ЭЗЭН ОГТ БАЙХГҮЙ.
 */
compliance.get('/projects/:id/readiness', async (c) => {
  // ⚠️ ХАРАГЧИЙН ТАНИГЧ ЭНД ЗОРИУД ХЭРЭГЛЭГДЭХГҮЙ.  §69-ийн хаалга нь
  //    ТӨСЛИЙН баримт — оролт бүр `detected_by`-гүй, төсөлд хамаарна.
  //    `c.get('user')` дуудаад тоолуурын аль нэгийг түүгээр шүүх нь
  //    хаалганы өнгийг ХЭН ХАРЖ БУЙГААС хамааралтай болгоно (F2).
  const db = c.env.DB;
  const projectId = intOrNull(c.req.param('id'));
  if (projectId === null || projectId <= 0) return c.json({ error: 'bad project id' }, 400);

  /* 1. Ноцтой байдлаар нэгтгэсэн нээлттэй олдвор.  ⚠️ `AI_INFERRED` ба
   *    `UNKNOWN` нотолгоо ЭНД ОРОХГҮЙ (§65) — `READINESS_EVIDENCE_SQL`.
   *
   * ⚠️ ХУУЧИРСАН МӨРИЙГ ШҮҮЖ ХАЯХГҮЙ, ТУСГААРЛАНА.  Өмнө нь энэ асуулга
   *    `AND stale_at IS NULL` гэж шүүдэг байсан тул загвар өөрчлөгдөхөд
   *    (`POST /findings/stale` бүх мөрийг хуучруулна) ГУРВАН нээлттэй
   *    CRITICAL нь хариултаас БҮРМӨСӨН алга болж, хаалга «0 зөрчил» гэж
   *    уншаад НОГООН гардаг байв.  Одоо хоёр багц ТУСДАА нугалагдана:
   *    шинэ мөр нь `open_by_severity`-д, хуучирсан мөр нь
   *    `stale_by_severity`-д ба §58-ийн ХААГЧ тоолуурт. */
  const sev = await db
    .prepare(
      `SELECT severity, verdict, (stale_at IS NOT NULL) AS is_stale, COUNT(*) AS n
         FROM compliance_findings
        WHERE project_id = ?1
          AND lifecycle_state IN (${OPEN_STATES_SQL})
          AND evidence_level IN (${READINESS_EVIDENCE_SQL})
        GROUP BY severity, verdict, is_stale`,
    )
    .bind(projectId)
    .all<{ severity: string; verdict: string; is_stale: number; n: number }>()
    .catch(() => ({
      results: [] as { severity: string; verdict: string; is_stale: number; n: number }[],
    }));

  const allSevRows = sev.results ?? [];
  const sevRows = allSevRows.filter((r) => Number(r.is_stale) !== 1);
  const staleSevRows = allSevRows.filter((r) => Number(r.is_stale) === 1);
  const fold = foldSeverityRows(sevRows);
  const staleFold = foldSeverityRows(staleSevRows);
  const uncertainOpen = sevRows
    .filter((r) => String(r.verdict) === 'UNCERTAIN')
    .reduce((a, r) => a + (Number(r.n) || 0), 0);

  /* 2. Багийн хамрах хүрээ — АМЬД бүртгэлээс, ХАТУУ ТОО БАЙХГҮЙ.
   *
   * ⚠️ ХОЁР шүүлт, хоёулаа ЗААВАЛ:
   *    (a) баг нь ЭНЭ ТӨСӨЛД оролцож байна  (`share_percent > 0`);
   *    (b) баг нь дүрмийн багцТАЙ           (нийтлэгдсэн `rules` мөр).
   *
   * (b)-гүйгээр MGMT · EZ · GT (эзэн баталсан 2026-08-30, v2 §46: багц
   * АВАХГҮЙ) нь хуваарьт орж, `ran` ХЭЗЭЭ Ч үнэн болохгүй тул хаалга
   * МӨНХӨД улаан үлдэнэ.  Багцгүй код нь `TEAM = UNCERTAIN` БИШ — түүний
   * илрүүлэлт амжилттай, зөвхөн нийцлийн шалгалт алгасагдана (`2-1` §3.4),
   * ба ӨӨР БАГИЙН дүрэм рүү ХЭЗЭЭ Ч уначихгүй (v2 §48-R6).
   * Шалгалт нь ОРШИХУЙН — «найм» гэсэн тоо ЭНЭ ФАЙЛД БАЙХГҮЙ. */
  const teams = await db
    .prepare(
      `SELECT t.code AS team_code,
              EXISTS (SELECT 1
                        FROM rule_run_ledger l
                        JOIN rules r ON r.rule_uid = l.rule_uid
                       WHERE l.project_id = ?1
                         AND r.team_code = t.code
                         AND l.evaluated > 0) AS ran
         FROM project_team_shares pts
         JOIN teams t ON t.id = pts.team_id
        WHERE pts.project_id = ?1
          AND pts.share_percent > 0
          AND EXISTS (SELECT 1
                        FROM rules r2
                       WHERE r2.team_code = t.code
                         AND r2.status = 'published')
        ORDER BY pts.sort_order, t.sort_order`,
    )
    .bind(projectId)
    .all<{ team_code: string; ran: number }>()
    .catch(() => ({ results: [] as { team_code: string; ran: number }[] }));

  /* 3. Бүртгэлийн эрүүл мэнд — §69-ийн НОГООНЫГ ТАТГАЛЗАХ нөхцөл.
   *
   * ⚠️ «Нийтлэгдээгүй багц» нь `bim_sessions`-оос БИШ `rule_run_ledger`-ээс
   *    уншигдана: `bim_sessions`-д `pack_sha256` багана БАЙХГҮЙ (0217-г үз),
   *    харин 0229 нь бүртгэлийн мөр бүрд түүнийг хадгалдаг.  Тоолуур нь
   *    ялгаатай СЕССИЙН тоо — нэг сесс олон мөр бичдэг. */
  const ledger = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM rule_run_ledger WHERE project_id = ?1) AS rows_total,
         (SELECT COUNT(*) FROM rule_run_ledger l
            JOIN rules r ON r.rule_uid = l.rule_uid
           WHERE l.project_id = ?1 AND r.expect_applicable = 1 AND l.applicable = 0)
                                                                     AS expected_but_inapplicable,
         (SELECT COALESCE(SUM(aborted), 0) FROM rule_run_ledger WHERE project_id = ?1) AS aborted,
         (SELECT COALESCE(SUM(applicable), 0) FROM rule_run_ledger WHERE project_id = ?1) AS applicable,
         (SELECT COALESCE(SUM(evaluated), 0) FROM rule_run_ledger WHERE project_id = ?1) AS evaluated,
         (SELECT COUNT(DISTINCT COALESCE(l2.session_id, -l2.id)) FROM rule_run_ledger l2
           WHERE l2.project_id = ?1
             AND l2.pack_sha256 IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM rule_pack_versions p
                              WHERE p.pack_sha256 = l2.pack_sha256
                                AND p.status = 'published'))         AS unpublished_pack_sessions`,
    )
    .bind(projectId)
    .first<Record<string, unknown>>()
    .catch(() => null);

  const n = (key: string): number => Number(ledger?.[key] ?? 0) || 0;

  /* 4. «Дүрмийн багц алга» ба «шалгаад цэвэр» хоёрын ЯЛГАА — `2-3`-ын
   *    `evaluationStateOf`-оор.  ЭНД ДАХИН тооцоолохгүй.
   *
   * ⚠️ ТӨСЛИЙН ХҮРЭЭ, ХАРАГЧИЙН БИШ.  `evaluationStateFor` нь
   *    `detected_by = <харагч>`-оор шүүдэг (`/findings/surface`-д ЗӨВ) тул
   *    түүнийг ЭНД дуудвал хаалганы өнгө ХЭН ХАРЖ БУЙГААС хамаарна.  Энэ
   *    маршрутын бусад БҮХ асуулга (ноцтой байдал, баг, бүртгэл, цоорхой)
   *    `detected_by`-гүй тул холимог оролт нь §69-ийн хаалгыг ялгаварт
   *    оруулна.  `projectEvaluationDetail`-ийн толгойг үз. */
  const evalDetail = await projectEvaluationDetail(db, projectId);
  const evaluationState = evalDetail.state;

  /* 5. §59 — уншлагаар гаргасан цоорхойнууд. */
  const gaps = await deriveCompletenessGaps(db, projectId);

  const result = computeReadiness({
    open_by_severity: fold.counts,
    unknown_severity_open: fold.unknownSeverity,
    uncertain_open: uncertainOpen,
    completeness: gaps.map((g) => ({
      check: g.check,
      state: g.state,
      countable: g.countable,
    })),
    team_checks: (teams.results ?? []).map((r) => ({
      team_code: String(r.team_code),
      ran: Number(r.ran) === 1,
    })),
    ledger: {
      evaluation_state: evaluationState,
      expected_but_inapplicable: n('expected_but_inapplicable'),
      aborted: n('aborted'),
      empty: n('rows_total') === 0,
      unpublished_pack_sessions: n('unpublished_pack_sessions'),
      // ⚠️ ЭНЭ ХОЁР МӨР Л «бүх нотолгоо хуучирсан» төслийг НОГООНООС
      //    сална.  Тэдгээр нь `evaluation_state`-ийн ЭХ СУРВАЛЖ ч мөн тул
      //    хаалга ба `2-5`-ын гадаргуу ИЖИЛ баримт дээр ЗӨРЧИЛДӨХГҮЙ.
      partial_findings: evalDetail.partialFindings,
      stale_findings: evalDetail.staleFindings,
    },
  });

  /* 6. Шошго.  ⚠️ Багц байхгүй бол «Дүрмийн багц , 0 дүрмээр шалгав» гэж
   *    бичих нь ХУДАЛ — `noPackLabel()` тусдаа мөр өгнө (эзний Ш4-ийн
   *    үед энэ нь ГОЛ зам, онцгой тохиолдол БИШ). */
  const pack = await db
    .prepare(
      `SELECT ruleset_version, rule_count
         FROM rule_pack_versions
        WHERE status = 'published'
        ORDER BY published_at DESC, id DESC
        LIMIT 1`,
    )
    .first<{ ruleset_version: string; rule_count: number }>()
    .catch(() => null);

  return c.json({
    project_id: projectId,
    ...result,
    // ⚠️ ЗӨВХӨН НЭГТГЭЛ — ноцтой байдлын тоолуур.  Самбар эдгээрийг
    //    ШУУД харуулна; `blockers[]`-оос сэргээх ГЭЖ ОРОЛДОХГҮЙ (тэр нь
    //    зөвхөн хаалгыг ХААСАН шалтгааныг агуулдаг тул MEDIUM/LOW чимээгүй
    //    алга болно).
    open_by_severity: fold.counts,
    // ⚠️ ХУУЧИРСАН НЬ «АЛГА» ГЭСЭН ҮГ БИШ.  Тусдаа тоолуураар ИЛ гарна —
    //    самбар «3 CRITICAL хуучирсан» гэдгийг ХАРАХ ЁСТОЙ, эс бөгөөс
    //    `blockers[]`-ийн ганц тоо нь ямар ноцтой байдал байсныг нуулаа.
    stale_by_severity: staleFold.counts,
    stale_open_total: SEVERITIES.reduce((a, s) => a + staleFold.counts[s], 0) +
      staleFold.unknownSeverity,
    uncertain_open: uncertainOpen,
    // ⚠️ Багийн КОД, хүний нэр БИШ.  «Хариуцах» нь §60-R3-аар БАГ.
    team_checks: (teams.results ?? []).map((r) => ({
      team_code: String(r.team_code),
      ran: Number(r.ran) === 1,
    })),
    evaluation_state: evaluationState,
    gaps,
    // ⚠️ ГУРВАН САЛАА, ХОЁР БИШ.  Өмнө нь энэ нь `pack ? checkedLabel :
    //    noPackLabel` байсан тул НИЙТЛЭГДСЭН БАГЦ ОРШИХ нь «шалгав» гэсэн
    //    ӨНГӨРСӨН ЦАГИЙН БАТАЛГАА бичих ХАНГАЛТТАЙ нөхцөл болж байв.
    //    Хэмжсэн (2026-08-31): `rule_run_ledger` ХООСОН (`evaluation_state
    //    = 'never_run'`) төсөл дээр карт «Дүрмийн багц 2026-09-01.1, 1
    //    дүрмээр шалгав» гэж бичдэг байлаа — дүрэм НЭГ Ч удаа ажиллаагүй
    //    загвар «шалгагдсан» гэж уншигдана.  `status` нь `UNKNOWN` байсан
    //    нь ХАМГААЛАЛТ БИШ: `ReadinessPanel.tsx:227` энэ МӨРИЙГ ШУУД
    //    хэвлэдэг тул хэрэглэгчийн уншсан өгүүлбэр нь худал баталгаа байв.
    //    Одоо бүртгэл хоосон бол багцын хувилбар ХЭВЭЭР харагдана
    //    (инженер юу татагдсаныг мэдэх ёстой), гэхдээ үйл үг нь
    //    «ачаалагдсан — шалгалт хараахан ажиллаагүй».
    checked_label: !pack
      ? noPackLabel()
      : evalDetail.ledgerRows === 0
        ? notRunLabel(String(pack.ruleset_version), Number(pack.rule_count) || 0)
        : checkedLabel(String(pack.ruleset_version), Number(pack.rule_count) || 0),
    // ⚠️ `coverageLabel(0, 0)` нь «Энэ загварт хамаарах дүрэм олдсонгүй»
    //    гэж бичдэг ба тэр нь ХАЙСАН, ОЛООГҮЙ гэж уншигдана.  Бүртгэл
    //    хоосон үед бид хамаарлыг ХЭМЖЭЭГҮЙ — өөр баримт, өөр мөр.
    coverage_label:
      evalDetail.ledgerRows === 0
        ? coverageNotMeasuredLabel()
        : coverageLabel(n('applicable'), n('evaluated')),
    // §69-R3 — самбар дээр ЗААВАЛ ХАРАГДАНА, tooltip дотор БИШ.
    disclaimer_key: 'readiness.disclaimer',
    min_completeness_pct: READY_MIN_COMPLETENESS_PCT,
    as_of: new Date().toISOString(),
  });
});

/* ------------------------------------------------------------------ */
/*  GET /api/compliance/projects/:id/gaps — §59-ийн арван шалгуур      */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ `unavailable` шалгуурууд нь ХАРАГДСАН хэвээр буцна — `countable:false`
 *    ба `blocked_reason`-тойгоо.  Тэднийг хариултаас ХАСВАЛ «хэмжигдэхгүй»
 *    нь «асуудалгүй» болж уншигдана (`run_golden.py:352-353`).
 */
compliance.get('/projects/:id/gaps', async (c) => {
  const db = c.env.DB;
  const projectId = intOrNull(c.req.param('id'));
  if (projectId === null || projectId <= 0) return c.json({ error: 'bad project id' }, 400);

  const gaps = await deriveCompletenessGaps(db, projectId);
  const countable = gaps.filter((g) => g.countable);
  return c.json({
    project_id: projectId,
    gaps,
    countable_total: countable.length,
    countable_known: countable.filter((g) => g.state !== 'unknown').length,
    unavailable: gaps.filter((g) => !g.countable).map((g) => g.check),
    as_of: new Date().toISOString(),
  });
});

/* ------------------------------------------------------------------ */
/*  GET /api/compliance/quality — §66 ХУДАЛ ЭЕРЭГ / ХУДАЛ СӨРӨГ        */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ `requireManager()` БОЛОВЧ мөр бүр нь `rule_uid` эсвэл `team_code`-оор
 *    бүлэглэгдсэн.  Ахлагч «энэ ДҮРЭМ 40% худал дохио өгч байна» гэдгийг
 *    харна — «энэ ИНЖЕНЕР 40% алдаа гаргаж байна» гэдгийг ХЭЗЭЭ Ч биш.
 *    Тэр хоёр дахь харагдац нь `ChangeTracker.cs:90-100`-ийн (2026-08-26)
 *    шийдвэрийг зөрчих ба ажилчид add-in-ыг унтраана.
 *
 * ⚠️ `?nominate=1` нь `rule_test_cases` руу ЮУ Ч БИЧИХГҮЙ — ЗӨВХӨН нэр
 *    дэвшүүлж ХЭВЛЭНЭ (`eval/nominate.py:9-10`).  Автоматаар оруулбал
 *    загвар өөрийн эргэлзээгээ өөрөө шалгуур болгож, гогцоо хаагдана.
 *    Оруулах цорын ганц зам нь `2-2`-ийн курацийн UI.
 *
 * ⚠️ FN-ийг хэмжих ЭРХ МЭДЭЛТЭЙ газар нь D1 БИШ.  `expected_violations` нь
 *    `rule_test_cases`-аас гарна, гэвч «алдсан» эсэхийг зөвхөн
 *    `run_golden.py --kind rules` хэлнэ.  Тиймээс `recall` нь ЭНД
 *    `missed = 0` гэж ТООЦОГДОХГҮЙ — `measured: false` буцна.
 */
compliance.get('/quality', requireManager(), async (c) => {
  const db = c.env.DB;
  const days = Math.min(
    MAX_QUALITY_DAYS,
    Math.max(1, intOrNull(c.req.query('days')) ?? DEFAULT_QUALITY_DAYS),
  );
  const window = `-${days} days`;
  const teamFilter = str(c.req.query('team'), 16).toUpperCase();
  const team = isTeamCodeShape(teamFilter) ? teamFilter : '';
  const nominate = str(c.req.query('nominate'), 8) === '1';

  /* 1. Гаргасан олдвор — ноцтой байдал × анги.  `PASS` ОРОХГҮЙ. */
  const emittedRows = await db
    .prepare(
      `SELECT severity, issue_class, COUNT(*) AS n
         FROM compliance_findings
        WHERE first_detected_at >= datetime('now', ?1)
          AND verdict <> 'PASS'
          AND (?2 = '' OR owner_team_code = ?2)
        GROUP BY severity, issue_class`,
    )
    .bind(window, team)
    .all<{ severity: string; issue_class: string; n: number }>()
    .catch(() => ({ results: [] as { severity: string; issue_class: string; n: number }[] }));

  const emitted = foldSeverityRows(emittedRows.results ?? []);

  const verdictRows = await db
    .prepare(
      `SELECT verdict, COUNT(*) AS n
         FROM compliance_findings
        WHERE first_detected_at >= datetime('now', ?1)
          AND (?2 = '' OR owner_team_code = ?2)
        GROUP BY verdict`,
    )
    .bind(window, team)
    .all<{ verdict: string; n: number }>()
    .catch(() => ({ results: [] as { verdict: string; n: number }[] }));
  const verdictTotal = (verdictRows.results ?? []).reduce((a, r) => a + (Number(r.n) || 0), 0);
  const uncertainTotal = (verdictRows.results ?? [])
    .filter((r) => String(r.verdict) === 'UNCERTAIN')
    .reduce((a, r) => a + (Number(r.n) || 0), 0);

  /* 2. Худал дохио — ЗӨВХӨН ХЯНАГДСАН хүчингүй болголт (§66-ийн хүснэгт).
   *
   * ⚠️ `review_state IN ('reviewed','verified')` нь ЗААВАЛ: `pending`
   *    хүчингүй болголт нь «инженер тохиролцоогүй» гэсэн үг бөгөөд түүнийг
   *    худал дохио гэж тоолох нь хөдөлгүүрийг өөрийгөө үнэлэхээс СЭРГИЙЛЭХ
   *    §68-ийн хоёр эрхийн хуваарилалтыг устгана. */
  /* ⚠️ ХҮРТВЭР БА ХУВААРЬ НЬ НЭГ ОЛОНЛОГООС ГАРАХ ЁСТОЙ.  Өмнө нь хүртвэр
   *    нь `finding_overrides.created_at >= <цонх>` (ХҮЧИНГҮЙ БОЛГОСОН
   *    хугацаа), хуваарь нь `compliance_findings.first_detected_at >=
   *    <цонх>` (ИЛРҮҮЛСЭН хугацаа) байсан тул 40 хоногийн өмнөх олдворыг
   *    өнөөдөр хаахад тэр нь ЗӨВХӨН ХҮРТВЭРТ орж, `fp_rate > 1` гардаг байв
   *    — «худал дохионы 130%» гэсэн утгагүй тоо самбарт гарна.
   *    Гурван засвар, гуравуулаа ЗААВАЛ:
   *      (1) `JOIN compliance_findings` + хуваарийн ЯГ ИЖИЛ цонх/шүүлт;
   *      (2) `COUNT(DISTINCT o.finding_id)` — нэг олдворыг ХОЁР удаа хаасан
   *          нь ХОЁР худал дохио БИШ (0237 нь нэмэгдэх бүртгэл);
   *      (3) бүлэглэлт нь `f.severity`-ээр — `severity_at_override` нь
   *          ХӨЛДӨӨСӨН хувилбар тул ноцтой байдал өөрчлөгдсөн мөр буруу
   *          саванд унаж, тэр САВАНД дахин `> 1` үүсгэнэ. */
  const fpRows = await db
    .prepare(
      `SELECT f.severity AS severity, COUNT(DISTINCT o.finding_id) AS n
         FROM finding_overrides o
         JOIN compliance_findings f ON f.id = o.finding_id
        WHERE o.created_at >= datetime('now', ?1)
          AND o.override_kind = 'FALSE_POSITIVE'
          AND o.review_state IN ('reviewed','verified')
          AND (?2 = '' OR o.team_code = ?2)
          AND f.first_detected_at >= datetime('now', ?1)
          AND f.verdict <> 'PASS'
          AND (?2 = '' OR f.owner_team_code = ?2)
        GROUP BY f.severity`,
    )
    .bind(window, team)
    .all<{ severity: string; n: number }>()
    .catch(() => ({ results: [] as { severity: string; n: number }[] }));
  const falsePositive = foldSeverityRows(fpRows.results ?? []);

  /* 3. Илүүц сануулга — §66-ийн хоёр дахь хэмжүүр. */
  const unnecessary = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM finding_overrides
        WHERE created_at >= datetime('now', ?1)
          AND verdict_at_override = 'WARNING'
          AND override_kind IN ('FALSE_POSITIVE','RULE_WRONG','NOT_APPLICABLE_HERE')
          AND (?2 = '' OR team_code = ?2)`,
    )
    .bind(window, team)
    .first<{ n: number }>()
    .catch(() => null);

  /* 4. ХҮЛЭЭГДЭЖ БУЙ зөрчил — golden хуваарийн ХУВААРЬ.  ⚠️ Хүртвэр
   *    (`missed`) нь D1-д БАЙХГҮЙ; `eval/last_run.json` нь `2-6`-ынх. */
  const expectedRows = await db
    .prepare(
      `SELECT r.severity AS severity, COUNT(*) AS n
         FROM rule_test_cases tc
         JOIN rules r ON r.rule_uid = tc.rule_uid
        WHERE tc.expect_verdict = 'VIOLATION'
          AND tc.verified = 1
          AND (?1 = '' OR r.team_code = ?1)
        GROUP BY r.severity`,
    )
    .bind(team)
    .all<{ severity: string; n: number }>()
    .catch(() => ({ results: [] as { severity: string; n: number }[] }));
  const expected = foldSeverityRows(expectedRows.results ?? []);

  /* 5. ДҮРЭМ ТУС БҮРИЙН худал дохио — ахлагчийн ГОЛ харагдац. */
  const byRule = await db
    .prepare(
      `SELECT rule_uid,
              COUNT(*) AS overrides,
              SUM(CASE WHEN override_kind = 'FALSE_POSITIVE' THEN 1 ELSE 0 END) AS false_positive,
              SUM(CASE WHEN override_kind = 'RULE_WRONG' THEN 1 ELSE 0 END) AS rule_wrong,
              SUM(CASE WHEN override_kind = 'NOT_APPLICABLE_HERE' THEN 1 ELSE 0 END) AS not_applicable
         FROM finding_overrides
        WHERE created_at >= datetime('now', ?1)
          AND rule_uid IS NOT NULL
          AND review_state IN ('reviewed','verified')
          AND (?2 = '' OR team_code = ?2)
        GROUP BY rule_uid
        ORDER BY overrides DESC
        LIMIT 50`,
    )
    .bind(window, team)
    .all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));

  const ruleRows = byRule.results ?? [];

  /* 6. НЭР ДЭВШҮҮЛЭЛТ — ЗӨВХӨН ХЭВЛЭНЭ.  БИЧИХГҮЙ. */
  const nominations = nominate
    ? ruleRows
        .filter((r) => {
          const signals =
            (Number(r['false_positive']) || 0) +
            (Number(r['rule_wrong']) || 0) +
            (Number(r['not_applicable']) || 0);
          return signals >= NOMINATE_MIN_SIGNALS;
        })
        .slice(0, MAX_NOMINATIONS)
        .map((r) => ({
          rule_uid: String(r['rule_uid'] ?? ''),
          signals:
            (Number(r['false_positive']) || 0) +
            (Number(r['rule_wrong']) || 0) +
            (Number(r['not_applicable']) || 0),
          // ⚠️ Нэр дэвшүүлэлт нь ЗӨВЛӨМЖ — `rule_test_cases` руу орох ганц
          //    зам нь ХҮНИЙ баталгаа (`2-2`-ийн курацийн UI).
          action: 'curation_review_required',
        }))
    : null;

  const fp = fpRates(emitted.counts, falsePositive.counts);
  const recall: Record<string, ReturnType<typeof recallOf>> = {};
  for (const sev of SEVERITIES) {
    // ⚠️ `missed` нь ЭНД ҮРГЭЛЖ 0 БИШ — ХЭМЖИГДЭЭГҮЙ.  Хуваарь тэг бол
    //    `measured: false` буцна; хуваарь эерэг ч алдсаныг D1 мэдэхгүй тул
    //    `authoritative: false` тугийг хариунд ил тавина.
    recall[sev] = recallOf(expected.counts[sev], 0);
  }

  return c.json({
    days,
    team: team === '' ? null : team,
    // §66 — ГАРГАСАН, ХУДАЛ ЭЕРЭГ, ХАРЬЦАА
    emitted: emitted.counts,
    emitted_by_class: emittedRows.results ?? [],
    false_positive: falsePositive.counts,
    fp_rate: fp,
    unnecessary_warnings: Number(unnecessary?.n ?? 0) || 0,
    uncertain_rate: rateOf(uncertainTotal, verdictTotal),
    // §66 — ХҮЛЭЭГДЭЖ БУЙ ЗӨРЧИЛ (golden хуваарь)
    expected_violations: expected.counts,
    recall,
    /** ⚠️ АЛБАН ЁСНЫ FN нь `run_golden.py --kind rules`.  Энэ хариу ТҮҮНИЙГ ОРЛОХГҮЙ. */
    recall_authoritative: false,
    recall_source: 'revit-mcp/eval/run_golden.py --kind rules',
    proxy_key: 'readiness.quality.proxy',
    // §66 — ДҮРЭМ ТУС БҮР
    by_rule: ruleRows,
    nominations,
    // ⚠️ `?nominate=1` ЮУ Ч БИЧИХГҮЙ — тестээр батлагдана (§6).
    nominate_writes: false,
    as_of: new Date().toISOString(),
  });
});

export default compliance;
