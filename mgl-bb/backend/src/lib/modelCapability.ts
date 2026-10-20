/**
 * v2 §79 + §80 · ЧАДВАРЫН ХААЛГА (2-6).
 *
 * §79: «Do not assume one model can safely perform every task.»  Бүртгэл
 * нь `model_capabilities` (0239).  ЭНЭ ФАЙЛ нь тэр бүртгэлийн УНШИГЧ тал —
 * бичигч тал нь `routes/compliance.ts`-ийн `POST/PATCH /capabilities`.
 *
 * ⚠️ ЯАГААД УНШИГЧ ЗААВАЛ ВЭ.  Бичигчгүй, уншигчгүй бүртгэл нь §79-ийн
 *    зорилгыг («prevent experimental AI from silently gaining production
 *    authority») ХЭРЭГЖҮҮЛЭХГҮЙ — тэр нь хаалга биш, зүгээр л
 *    баримтжуулалт.  Хүснэгт байгаа нь хаалга байгааг БАТАЛГААЖУУЛАХГҮЙ.
 *
 * ⚠️ `assistant_models.eval_passed` (0213:44) нь ГАНЦ boolean тул LEVEL 0-д
 *    тэнцсэн загвар LEVEL 2-т ч тэнцсэн харагдана.  §80-R3 нь түвшин бүрд
 *    БИЕ ДААСАН хаалга шаарддаг — тэр нь мөр тус бүрийн `authority_level`.
 *
 * ⚠️ ХУВИЛБАР НЬ ХААЛГЫН НЭГ ХЭСЭГ (F6).  0239-д `(task, model_version,
 *    team_scope)` дээр ӨВӨРМӨЦ ИНДЕКС БАЙХГҮЙ тул нэг даалгавар + нэг багт
 *    ОЛОН хувилбарын мөр ХУУЛЬ ЁСООР зэрэг оршино.  Сонголт нь хувилбарыг
 *    үл тоовол ДАРАГДСАН / ЦУЦЛАГДСАН хувилбар өөрийн батлагдсан эрхийг
 *    ҮРГЭЛЖЛҮҮЛЭН олгоно — «эрхийн тогтмолжилт».  `decideCapability`-ийн
 *    2-р шат тэрийг хаана.
 *
 * ⚠️ ТАТГАЛЗАЛ НЬ НЭРЛЭСЭН ШАЛТГААНТАЙ.  Чимээгүй `false` буцаавал дуудагч
 *    «яагаад» гэдэгт хариулж чадахгүй ба хаалгыг тойрох гэж оролдоно.
 *    Тусгайлан `no_row` нь «шалгаад цэвэр» БИШ, «эрх ОГТ олгоогүй» гэсэн
 *    утгыг ялгаж хэлнэ — `rules` ба `model_capabilities` хоёулаа ХООСОН
 *    нийлүүлэгдэж байгаа тул энэ ялгаа нь релиз N-д ХАМГИЙН чухал ялгаа.
 *
 * ⚠️ ЭНЭ ФАЙЛЫН ЛОГИК БҮХЭЛДЭЭ `decideCapability`-д — ЦЭВЭР, D1-гүй,
 *    `node --test` доор шууд шалгагдана.  `assertCapability` нь ЗӨВХӨН SQL.
 *
 * ⚠️ ЭРХИЙН ТҮВШНИЙ НЭР/ХЯЗГААР нь `lib/complianceAuthority.ts`-д —
 *    ЭНД ХУУЛБАРЛАХГҮЙ.  Хоёр `AUTHORITY_CAPS` орших нь хоёр өөр бодлого
 *    болж, `surface` нэг талдаа true, нөгөө талдаа false болох өдөр л
 *    илэрнэ.
 */
import {
  AUTHORITY_LEVELS,
  authorityCaps,
  type AuthorityCaps,
  type AuthorityLevel,
} from './complianceAuthority';

/**
 * `model_capabilities.evaluation_status`-ийн CHECK-тэй ЯГ ИЖИЛ дөрвөн утга
 * (0239).  ⚠️ ЭНЭ ЖАГСААЛТ БА МИГРАЦИЙН CHECK ХАМТ ХӨДӨЛНӨ.
 */
export const CAPABILITY_STATUSES = [
  'untested', 'experimental', 'approved', 'revoked',
] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export function isCapabilityStatus(v: unknown): v is CapabilityStatus {
  return typeof v === 'string' && (CAPABILITY_STATUSES as readonly string[]).includes(v);
}

/**
 * MVP-ийн ЭРХИЙН ТААЗ — v2 §40-R4 нь MVP-г LEVEL 2 (RECOMMEND)-оор ТАСАЛНА.
 *
 * ⚠️ 0239-ийн CHECK нь 5 хүртэл зөвшөөрдөг нь ИРЭЭДҮЙН СХЕМИЙН ЗАЙ,
 *    зөвшөөрөл БИШ.  Маршрутын 400-г хасвал admin нэг POST-оор LEVEL 4
 *    (HUMAN-APPROVED EXECUTE) олгож чадна — тэр нь «засвар ХЭЗЭЭ Ч
 *    автоматаар хэрэгжихгүй» гэсэн шийдвэрийг НЭГ мөрөөр тойрно.
 */
export const MAX_GRANTABLE_AUTHORITY = 2;

/** Схемийн ХАТУУ хязгаар — `AUTHORITY_LEVELS`-ээс гарна, гараар бичихгүй. */
export const MAX_SCHEMA_AUTHORITY = AUTHORITY_LEVELS.length - 1;

export type CapabilityVerdict =
  | { readonly ok: true; readonly granted: number }
  | { readonly ok: false; readonly reason: 'no_row' | 'inactive' }
  | { readonly ok: false; readonly reason: 'not_approved'; readonly status: string }
  | { readonly ok: false; readonly reason: 'level_too_low'; readonly granted: number };

export interface CapabilityRow {
  readonly task: string;
  /**
   * `assistant_models.version` ЭСВЭЛ дүрмийн багцын `ruleset_version` (0239).
   *
   * ⚠️ ХОЁР УТГЫН ОРОН ЗАЙ НЭГ БАГАНАД.  Тиймээс «амьд загварын хувилбартай
   *    таарахгүй» нь АЛДАА БИШ — тэр тохиолдолд шийдэгч ХУВИЛБАР-СОХОР,
   *    ХАМГИЙН ХАТУУ салаа руу унана (доорх 2-р шат).
   */
  readonly model_version: string;
  readonly team_scope: string | null;
  readonly evaluation_status: string;
  readonly authority_level: number;
  readonly is_active: number;
}

/**
 * ХАТУУЖЛЫН ЭРЭМБЭ — ЖИЖИГ нь ХАТУУ.
 *
 * ⚠️ ТОДОРХОЙГҮЙ статус нь `revoked`-оос ч ХАТУУ (-1): 0239-ийн CHECK-ийг
 *    тойрч (гараар SQL) орсон утга ХЭЗЭЭ Ч эрх нээхгүй.
 */
const STATUS_RANK: Readonly<Record<string, number>> = {
  revoked: 0,
  untested: 1,
  experimental: 2,
  approved: 3,
};

function statusRank(status: string): number {
  return STATUS_RANK[status] ?? -1;
}

/**
 * Үлдсэн нэрэлхийллээс ХАМГИЙН ХАТУУ мөрийг сонгоно — ЖАГСААЛТЫН
 * БАЙРЛАЛААС ХАРААТ БУС (`sort` нь бүрэн эрэмбэ, тэнцүү мөрүүд ч ГАНЦ
 * хариу өгнө).
 *
 * ⚠️ УНТРААСАН МӨР ХОЁР ТАЛТАЙ.  `is_active = 0` нь «энэ мөрийг ТЭТГЭХГҮЙ»
 *    гэсэн ИЛ шийдвэр тул АМЬД мөр байгаа үед унтраасныг ХАЯНА — эс бөгөөс
 *    «хуучныг унтраагаад шинийг нэмэх» гэсэн ХЭВИЙН админы урсгал үүрд
 *    `inactive` өгнө.  Харин БҮГД унтраасан бол мөрүүдийг ХЭВЭЭР үлдээнэ:
 *    ганц унтраасан мөр `inactive` гэсэн НЭРЛЭСЭН шалтгаанаа хадгална,
 *    `no_row` мэт харагдахгүй.
 */
function strictestRow(rows: readonly CapabilityRow[]): CapabilityRow {
  const live = rows.filter((r) => r.is_active === 1);
  const pool = live.length > 0 ? live : rows;
  const sorted = [...pool].sort(
    (a, b) =>
      statusRank(a.evaluation_status) - statusRank(b.evaluation_status) ||
      a.authority_level - b.authority_level ||
      (a.model_version < b.model_version ? -1 : a.model_version > b.model_version ? 1 : 0),
  );
  return sorted[0]!;
}

/**
 * ЦЭВЭР шийдэгч — DB хүрэхгүй.
 *
 * ⚠️ ХАМРАХ ХҮРЭЭНИЙ ДАРААЛАЛ (1-Р ШАТ): багийн тусгай мөр компанийн мөрийг
 *    ДАРНА (`team_scope = 'BA'` > `NULL`) — v2 §47-ийн шатны ЯГ ИЖИЛ
 *    дараалал.  Урвуулбал BA-д ЗОРИУД хязгаарласан түвшинг компанийн мөр
 *    чимээгүй өргөнө.  Тиймээс багийн мөр олдвол компанийн мөр рүү «сайн
 *    хувилбар» гэж БУЦАЖ УНАХГҮЙ — доод түвшин ч гэсэн тэр нь ИЛ ШИЙДВЭР.
 *
 * ⚠️ ХУВИЛБАРЫН ДАРААЛАЛ (2-Р ШАТ, F6).  ('rule_eval','BA') дээр v1
 *    `approved` LEVEL 2 ба v2 `untested` LEVEL 0 ЗЭРЭГ оршиж болно (0239-д
 *    өвөрмөц индекс БАЙХГҮЙ: SQLite-д NULL нь өөртэйгөө тэнцэхгүй тул
 *    `team_scope IS NULL` мөрүүдийг индексээр барих боломжгүй).  Тиймээс:
 *      1) АМЬД загварын хувилбартай (`assistant_models.is_active = 1`)
 *         таарах мөр байвал ТЭР ЯЛНА — ажиллаж байгаа загварын шийдвэр л
 *         хүчинтэй, ба админ шинэ хувилбар идэвхжүүлснээр хуучин мөрийг
 *         ШУУД дардаг.  Дарагдсан хувилбар эрхээ АВЧ ҮЛДЭХГҮЙ.
 *      2) Таарах мөр байхгүй (идэвхтэй загвар алга, эсвэл багана нь
 *         `ruleset_version`) бол ХУВИЛБАР-СОХОР, ХААЛТТАЙ-ӨГӨГДМӨЛ: шатанд
 *         үлдсэн БҮХ мөрийн ХАМГИЙН ХАТУУГ авна.  Аль нэг хувилбар
 *         `revoked` бол түүнийг ТОЙРЧ эрх авах зам БАЙХГҮЙ; админы гарц нь
 *         тэр мөрийг унтраах (`is_active = 0`) эсвэл устгах — ХОЁУЛАА ИЛ,
 *         аудитлагдах үйлдэл.
 *    ⚠️ ХОЁУЛАА ЖАГСААЛТЫН ДАРААЛЛААС ХАРААТ БУС — SQL-д `ORDER BY` байсан
 *       ч, байхгүй ч хариу НЭГ байна.
 *
 * ⚠️ ХААЛТТАЙ-ӨГӨГДМӨЛ: мөргүй ⇒ `no_row` ⇒ ТАТГАЛЗАНА.  «Бүртгэлд
 *    байхгүй» нь «зөвшөөрөгдсөн» БИШ — `lib/workerScope.ts`-ийн
 *    цагаан жагсаалтын бодлого.
 * ⚠️ `teamCode === null` (компанийн хүсэлт) үед `r.team_scope === teamCode`
 *    нь компанийн мөртэй таарна, багийн мөр таарахгүй — тэр ЗӨВ: багийн
 *    тусгай зөвшөөрөл нь компани даяарын үйлдлийг нээхгүй.
 */
export function decideCapability(
  rows: readonly CapabilityRow[],
  task: string,
  teamCode: string | null,
  needLevel: number,
  activeVersion: string | null = null,
): CapabilityVerdict {
  const match = rows.filter(
    (r) => r.task === task && (r.team_scope === teamCode || r.team_scope === null),
  );
  if (match.length === 0) return { ok: false, reason: 'no_row' };

  // 1-Р ШАТ · ХАМРАХ ХҮРЭЭ — багийн мөр байвал компанийн мөрийг ОГТ ХАРАХГҮЙ.
  const scoped = match.filter((r) => r.team_scope !== null);
  const tier = scoped.length > 0 ? scoped : match;

  // 2-Р ШАТ · ХУВИЛБАР — амьд загварын мөр ЯЛНА, эс бөгөөс хувилбар-сохор.
  const onActive =
    activeVersion === null ? [] : tier.filter((r) => r.model_version === activeVersion);
  const candidates = onActive.length > 0 ? onActive : tier;

  // 3-Р ШАТ · үлдсэнээс ХАМГИЙН ХАТУУ мөр.
  const chosen = strictestRow(candidates);

  if (chosen.is_active !== 1) return { ok: false, reason: 'inactive' };
  if (chosen.evaluation_status !== 'approved') {
    return { ok: false, reason: 'not_approved', status: chosen.evaluation_status };
  }
  if (chosen.authority_level < needLevel) {
    return { ok: false, reason: 'level_too_low', granted: chosen.authority_level };
  }
  return { ok: true, granted: chosen.authority_level };
}

/**
 * Татгалзсан вердиктээс ОЛГОГДСОН түвшинг гаргана — ХЭЗЭЭ Ч шидэлт хийхгүй.
 *
 * ⚠️ `GET /pack`-ийн хэрэглээ: чадвар олдоогүй нь АЛДАА БИШ, LEVEL 0
 *    (OBSERVE) гэсэн үг.  `AUTHORITY_CAPS.OBSERVE.surface === false` тул
 *    бүртгэлгүй баг дээр олдвор ХАРАГДАХГҮЙ — цуглагдана, харагдахгүй.
 *    Энэ бол «шалгаад цэвэр» гэж ХУДАЛ НОГООН харуулахаас хамаагүй дээр.
 */
export function grantedLevelOf(v: CapabilityVerdict): number {
  if (v.ok) return v.granted;
  if (v.reason === 'level_too_low') return v.granted;
  return 0;
}

/** Вердиктээс НЭРТЭЙ түвшин.  ⚠️ Хязгаараас хэтэрсэн тоо OBSERVE рүү унана. */
export function authorityLevelOf(v: CapabilityVerdict): AuthorityLevel {
  const n = grantedLevelOf(v);
  if (!Number.isInteger(n) || n < 0 || n >= AUTHORITY_LEVELS.length) return AUTHORITY_LEVELS[0];
  return AUTHORITY_LEVELS[n] as AuthorityLevel;
}

/** Вердиктээс ЭРХҮҮД.  Дуудагч `caps.surface`-ыг ӨӨРӨӨ бодохгүй. */
export function capsOf(v: CapabilityVerdict): AuthorityCaps {
  return authorityCaps(authorityLevelOf(v));
}

/** SQL-ийн мөр — чадварын мөр + тэр гүйлтийн үеийн АМЬД загварын хувилбар. */
interface CapabilityQueryRow extends CapabilityRow {
  readonly active_version: string | null;
}

/**
 * Маршрутын бүрхүүл — логик бүхэлдээ `decideCapability` дээр, энд ЗӨВХӨН SQL.
 *
 * ⚠️ `is_active` ба `evaluation_status`-ыг SQL-д ШҮҮХГҮЙ.  Шүүвэл унтраасан
 *    мөр `no_row` мэт харагдаж, `inactive` / `not_approved` гэсэн НЭРЛЭСЭН
 *    шалтгаанууд ХЭЗЭЭ Ч гарахгүй — админ «яагаад» гэдэгт хариулж чадахгүй.
 * ⚠️ `model_version` НЬ ЗААВАЛ СОНГОГДОНО.  Түүнгүйгээр шийдэгч хувилбарыг
 *    ЯЛГАЖ ЧАДАХГҮЙ ба F6 (дарагдсан хувилбар эрхээ хадгалах) буцаж ирнэ.
 * ⚠️ АМЬД ЗАГВАРЫН ХУВИЛБАРЫГ ХАЖУУГИЙН СКАЛЯР ДЭД АСУУЛГААР — НЭГ
 *    эргэлтэд, нэмэлт round trip-гүй.  `idx_assistant_model_active` (0195)
 *    нь `is_active = 1` дээрх ХЭСЭГЧИЛСЭН ӨВӨРМӨЦ индекс тул мөр нь ХАМГИЙН
 *    ИХДЭЭ НЭГ.  Идэвхтэй загвар БАЙХГҮЙ бол `null` — шийдэгч хувилбар-сохор
 *    болж ТАТГАЛЗАХ талдаа унана.
 * ⚠️ `ORDER BY` нь ЗӨВХӨН дебаг/аудитын тогтвортой байдалд.  ЗӨВ БАЙДАЛ
 *    түүнээс ХАМААРАХГҮЙ — `decideCapability` нь дараалалаас хараат бус.
 */
export async function assertCapability(
  db: D1Database,
  task: string,
  teamCode: string | null,
  needLevel: number,
): Promise<CapabilityVerdict> {
  const rs = await db
    .prepare(
      `SELECT c.task, c.model_version, c.team_scope, c.evaluation_status,
              c.authority_level, c.is_active,
              (SELECT m.version FROM assistant_models m
                WHERE m.is_active = 1 LIMIT 1) AS active_version
         FROM model_capabilities c
        WHERE c.task = ?1 AND (c.team_scope = ?2 OR c.team_scope IS NULL)
        ORDER BY c.team_scope IS NULL, c.model_version`,
    )
    .bind(task, teamCode)
    .all<CapabilityQueryRow>();
  const rows = rs.results ?? [];
  const activeVersion = rows[0]?.active_version ?? null;
  return decideCapability(rows, task, teamCode, needLevel, activeVersion);
}

/**
 * `evaluation_status = 'approved'` -ийн ГУРВАН НӨХЦӨЛ (`revit.ts:1970-1973`
 * -ийн загварын жин нийтлэх хаалганы хуулбар, ӨӨР артефакт дээр).
 *
 * ⚠️ Гурвуулаа ЗААВАЛ: golden гүйлт ТЭНЦСЭН, БЛОКЛОГДСОН хуваарь БАЙХГҮЙ,
 *    ба гүйлт нь ЯГ ЭНЭ хувилбар дээр хийгдсэн.  Гурав дахь нь хамгийн
 *    чухал: өөр хувилбарын ногоон гүйлтийг хуулж наах нь бүртгэлийг
 *    утгагүй болгоно.
 *
 * ⚠️ ЭНЭ ФУНКЦ ЦЭВЭР — оролт нь АЛЬ ХЭДИЙН задлагдсан JSON.  Задлалт
 *    (`JSON.parse`) нь маршрутын ажил тул гэмтэлтэй JSON нь 400 болно,
 *    чимээгүй `false` БИШ.
 */
export function evalRunApproves(
  run: unknown,
  modelVersion: string,
): { ok: true } | { ok: false; reason: 'missing' | 'not_passed' | 'blocked' | 'version_mismatch' } {
  if (run === null || typeof run !== 'object') return { ok: false, reason: 'missing' };
  const r = run as Record<string, unknown>;
  if (r.passed !== true) return { ok: false, reason: 'not_passed' };
  const blocked = r.blocked;
  if (Array.isArray(blocked) && blocked.length > 0) return { ok: false, reason: 'blocked' };
  if (r.model_version !== modelVersion) return { ok: false, reason: 'version_mismatch' };
  return { ok: true };
}
