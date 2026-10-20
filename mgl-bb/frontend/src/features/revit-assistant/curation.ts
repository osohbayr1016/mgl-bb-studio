/**
 * КУРАЦИЙН ҮЙЛДЭЛ → ЭХ СУРВАЛЖИЙН ТАКСОНОМИ (`source_type`).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА ВЭ (1B аудит, P0-C):
 * `POST /api/revit/assistant/examples` нь `source_type` илгээгээгүй мөрийг
 * `'UNKNOWN'` гэж бүртгэдэг.  `0215_assistant_trust_taxonomy.sql`-ийн
 * бодлогын дагуу `UNKNOWN` нь сургалтын цөмд ХЭЗЭЭ Ч ОРОХГҮЙ.  Курацийн UI
 * нь бүтээгдэхүүн дэх ЦОРЫН ГАНЦ бичигч тул талбарыг мартах нь «өнөөдрөөс
 * хойших хүний бүх хөдөлмөр сургалтад тэнцэхгүй» гэсэн БАЙНГЫН алдаа болно.
 * Тиймээс `ExamplePayload`-д `source_type` ба `curation_action` хоёулаа
 * ЗААВАЛ (optional БИШ) — шинэ бичигч мартах боломжгүй, `tsc` барина.
 *
 * ⚠️ ХЭН ЭЗЭН БЭ: гэрээ G1-ийн дагуу ЭЦСИЙН ЭРХ нь СЕРВЕРТ.  Клиент
 * `source_type`-ыг ЗАРЛАНА, гэхдээ түүнийг БАТАЛГАА гэж үзэж болохгүй —
 * сервер `curation_action`-ээс өөрөө ургуулж, клиентийнхийг дарж бичих эрхтэй.
 * Хоёуланг нь илгээх нь ЗОРИУД:
 *   · `source_type`      — өнөөдрийн роут ЯГ ҮҮНИЙГ уншдаг (`SOURCE_TYPES`
 *                          жагсаалттай тулгаад, таарахгүй бол 'UNKNOWN').
 *                          Үүнгүйгээр залруулга ӨНӨӨДӨР ажиллахгүй.
 *   · `curation_action`  — G1-ийн шаардсан ИЛ дохио: «зөвшөөрөв уу, зассан
 *                          уу».  Сервер дэривэц нэмэхэд ЭНЭ талбараас
 *                          ургана; өнөөдөр роут үүнийг үл ойшоодог тул
 *                          илгээх нь ЭРСДЭЛГҮЙ (тодорхойгүй түлхүүрийг
 *                          `/examples` алгасдаг).
 * Хоёулаа ЭНЭ НЭГ функцээс гардаг тул тэд ХЭЗЭЭ Ч зөрөх боломжгүй.
 */

/**
 * `backend/src/lib/assistantExampleInsert.ts`-ийн `SOURCE_TYPES` ба
 * `0215_assistant_trust_taxonomy.sql`-ийн `CHECK`-ийн ХОС (twin).
 * ⚠️ Гурвуулаа ХАМТ хөдөлнө — энд утга нэмэхэд миграцийн CHECK түүнийг
 * татгалзаж, INSERT «CHECK constraint failed» өгнө.
 */
export const SOURCE_TYPES = [
  'HUMAN',
  'HUMAN_CORRECTED',
  'HUMAN_VERIFIED',
  'RULE_VERIFIED',
  'SYNTHETIC',
  'AI_GENERATED',
  'IMPORTED',
  'UNKNOWN',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Хянагчийн БОДИТ үйлдэл — таксономийн цорын ганц оролт.
 *
 *  · `approved`  — машины таасан шошгыг хүн ХАРЖ БАТАЛСАН.
 *  · `corrected` — хүн шошгыг ӨӨРЧИЛСӨН (машин буруу байсан).
 *  · `manual`    — хүн бичвэрийг ӨӨРӨӨ зохиож, ӨӨРӨӨ шошголсон
 *                  (машины таамаг огт байхгүй).
 */
export type CurationAction = 'approved' | 'corrected' | 'manual';

/**
 * Хянагчийн үйлдлээс `source_type`-ыг ургуулна.
 *
 * ⚠️ `predicted` нь МАШИНЫ таамаг (`assistant_logs.predicted`), хүний
 * залруулга БИШ.  Хэрэв таамаг огт байхгүй бол «баталгаажуулах» юм байгаагүй
 * тул `HUMAN_VERIFIED` гэж нэрлэх нь ХУДАЛ болно — шошго нь цэвэр хүнийх,
 * өөрөөр хэлбэл `HUMAN` (0215-ийн `manual → HUMAN` буулгалттай ТААРНА).
 *
 * ⚠️ `HUMAN_VERIFIED`-ыг `isManager` (admin + senior) оноож болно —
 * 0215-ийн толгойн §9.2 «хувилбар A».  Нэмэлт эрхийн шаталт БАЙХГҮЙ.
 */
export function curationSourceType(
  action: CurationAction,
  predicted: string | null | undefined,
): SourceType {
  if (action === 'manual') return 'HUMAN';
  if (action === 'corrected') return 'HUMAN_CORRECTED';
  return predicted ? 'HUMAN_VERIFIED' : 'HUMAN';
}

/**
 * Дараалалд байгаа мөрийг дэвшүүлэхэд ЯМАР үйлдэл болохыг тодорхойлно.
 *
 * ⚠️ Харьцуулалт нь ҮРГЭЛЖ `row.predicted`-тэй — `row.corrected`-той БИШ.
 * `corrected` нь Revit доторх ЭЦСИЙН ХЭРЭГЛЭГЧИЙН залруулга; тэр ч бас
 * машинаас ЗӨРСӨН шошго учраас `HUMAN_CORRECTED` байх ёстой.  Хоёр өөр хүн
 * залруулсан ч таксономийн асуулт нэг хэвээр: «шошго машиныхаас өөр үү».
 *
 * Таамаг байхгүй мөрийг «зассан» гэж тэмдэглэх нь утгагүй (юуг нь заслаа?),
 * тиймээс `approved` буцаана — `curationSourceType` түүнийг `HUMAN` болгоно.
 */
export function curationActionFor(
  predicted: string | null | undefined,
  chosenIntent: string,
): CurationAction {
  if (!predicted) return 'approved';
  return chosenIntent === predicted ? 'approved' : 'corrected';
}

/* ------------------------------------------------------------------ */
/*  Санааны шошго                                                      */
/* ------------------------------------------------------------------ */

/**
 * Санааны нэрийг шошго болгоно.  Танихгүй утга ирвэл (сервер шинэ санаа
 * нэмсэн ба энэ bundle хуучин) ТҮҮХИЙ утгыг харуулна — хоосон нүд ХАРУУЛАХГҮЙ.
 *
 * ⚠️ ЭНЭ ФАЙЛД БАЙХ ШАЛТГААН: өмнө нь `components/LogCard.tsx`-д байсан
 *    бөгөөд тэр файл КОМПОНЕНТ ч экспортолдог.  Vite-ийн Fast Refresh нь
 *    компонент БУС экспорттой файлыг дахин ачаалж чадахгүй
 *    (`react-refresh/only-export-components`) — өөрөөр хэлбэл курацийн
 *    хуудсыг засах бүрт бүтэн refresh шаардагдана.  Компонент бус туслахууд
 *    энэ модульд байна.
 */
export function intentLabel(t: (k: string) => string, intent: string | null): string {
  if (!intent) return '—';
  const key = `assistantCuration.intent.${intent}`;
  const label = t(key);
  return label === key ? intent : label;
}

/* ------------------------------------------------------------------ */
/*  Багийн код                                                         */
/* ------------------------------------------------------------------ */

/**
 * Багийн кодын хэлбэр — `backend/src/routes/revit.ts`-ийн
 * `GET /assistant/pending` дэх `/^[A-Z]{2,8}$/`-ийн ХОС (twin).
 *
 * ⚠️ Сервер тал таарахгүй утгыг ЧИМЭЭГҮЙ хаяж, шүүлтгүй жагсаалт буцаадаг
 * (400 БИШ).  Тиймээс клиент нь ИЖИЛ шалгуураар урьдчилж шүүх ёстой —
 * эс бөгөөс URL-д `?team=zzz` бичсэн хүн «BA-гийн мөрүүд» гэж бодсоор
 * БҮХ БАГИЙН дараалал хараад, өөр багийн материалыг BA болгож дэвшүүлнэ.
 * (`revit.ts:2403`-ын `AND review_status IS NULL` нь ЭХНИЙ шийдвэрийг
 * ялагч болгодог тул тэр алдааг БУЦААХ БОЛОМЖГҮЙ.)
 */
export const TEAM_CODE_RE = /^[A-Z]{2,8}$/;

/**
 * «Бүх баг» гэсэн сонголтын утга.
 *
 * ⚠️ Radix `Select` нь ХООСОН мөрийг утга болгон авахгүй тул sentinel хэрэгтэй.
 * Репо даяарх конвенц нь `'all'` боловч ЭНД ТЭР ТААРАХГҮЙ: сонголтыг
 * `toUpperCase()` хийхэд `'ALL'` болж `TEAM_CODE_RE`-д ТААРНА — өөрөөр
 * хэлбэл `ALL` кодтой баг бүртгэгдэх өдөр «бүх баг» ба тэр баг хоёр нэг
 * утга болно.  Жижиг үсэг + доогуур зураас нь регекст ХЭЗЭЭ Ч таарахгүй.
 */
export const ALL_TEAMS = '__all__';

/**
 * Түүхий утгыг багийн код болгоно; таарахгүй бол `null` («бүх баг»).
 *
 * ⚠️ ЭНЭ НЬ URL-ын ЦОРЫН ГАНЦ ХААЛГА.  `?team=` нь хуваалцсан холбоосоор
 * ирдэг тул хэн ч дурын мөр бичиж болно.
 */
export function normalizeTeamCode(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return TEAM_CODE_RE.test(v) ? v : null;
}

/* ------------------------------------------------------------------ */
/*  БАГЦ ҮЙЛДЛИЙН МӨР ТУС БҮРИЙН ҮР ДҮН                                */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЯАГААД ЭНЭ БҮХЭН ЭНД БАЙНА ВЭ (багц баталгаажуулалт, 2026-09-01):
 *
 * Хянагч 20 мөр сонгоод «Сургалтад авах» дарахад сервер өнөөдөр ЗӨВХӨН
 * НЭГ ТОО буцаадаг (`{added, curated}` / `{rejected}`).  17 нь амжилттай бол
 * үлдсэн 3 нь АЛЬ нь байсныг хэлэх зүйл БАЙХГҮЙ — хянагч 200 мөрийг нүдээр
 * дахин уншиж олох ёстой болно.  Тиймээс гурван давхар:
 *
 *   1. Сервер мөр тус бүрийн үр дүн буцаах бол (зэрэгцээ сесс бичиж байгаа)
 *      түүнийг УНШИНА — талбарын нэрийг ХАТУУ БИЧИХГҮЙ, боломжит бүх
 *      нэрийг тэсвэрлэнэ (`parseBulkOutcomes`).
 *   2. Буцаахгүй бол НИЙТ ТООноос дүгнэнэ (`reconcileByCount`).
 *   3. Тоо ч хүрэлцэхгүй бол (17/20) ДАХИН УНШИГДСАН дарааллаас дүгнэнэ
 *      (`reconcileByPresence`): `/assistant/pending` нь `WHERE curated = 0`
 *      тул ДАХИН гарч ирсэн мөр = БОЛООГҮЙ мөр.
 *
 * ⚠️ 2 ба 3-аар гарсан төлөв нь `inferred: true` — UI түүнийг ИЛ ялгаж
 * харуулна.  «Сервер ингэж хэлсэн» ба «бид ингэж таасан» хоёрыг нэг өнгөөр
 * харуулах нь хянагчид ХУДАЛ баталгаа өгнө.
 */
export type BulkOutcomeStatus = 'ok' | 'skipped' | 'failed' | 'unknown';

export interface BulkRowOutcome {
  id: number;
  status: BulkOutcomeStatus;
  /** Серверийн ТҮҮХИЙ шалтгаан (орчуулагдаагүй).  Байхгүй бол null. */
  reason: string | null;
  /** Клиент талын шалтгааны i18n түлхүүр (сервер огт дуудагдаагүй мөрд). */
  reasonKey: string | null;
  /** Төлөв нь серверээс ИРСЭН үү (false), эсвэл клиент ТААМАГЛАСАН уу (true). */
  inferred: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Эерэг бүхэл id.  Мөр хэлбэртэй ирсэн ч хүлээж авна (JSON объектын түлхүүр). */
function outcomeId(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * ⚠️ `'rejected'` нь АМЖИЛТ (энэ UI-ийн татгалзал ЯГ тэр үгээр амжилттай
 * дуусдаг), `'error'` нь БИШ.  Үгсийг ЭНД нэг удаа тогтооно.
 */
const OK_WORDS = new Set([
  'ok', 'okay', 'true', 'added', 'promoted', 'rejected', 'curated', 'inserted',
  'created', 'updated', 'changed', 'success', 'succeeded', 'done', 'applied',
]);
const SKIP_WORDS = new Set([
  'skip', 'skipped', 'ignored', 'filtered', 'unchanged', 'no_change', 'nochange',
  'noop', 'duplicate', 'already', 'already_reviewed', 'already_curated', 'stale',
  'conflict', 'pending',
]);
const FAIL_WORDS = new Set([
  'fail', 'failed', 'failure', 'error', 'errored', 'invalid', 'missing',
  'not_found', 'notfound', 'forbidden', 'unauthorized', 'false',
]);

function statusWord(raw: string): BulkOutcomeStatus | null {
  const w = raw.trim().toLowerCase();
  if (OK_WORDS.has(w)) return 'ok';
  if (SKIP_WORDS.has(w)) return 'skipped';
  if (FAIL_WORDS.has(w)) return 'failed';
  return null;
}

const ID_KEYS = ['log_id', 'logId', 'id', 'example_id', 'exampleId'] as const;
const STATUS_KEYS = ['status', 'outcome', 'result', 'state', 'code'] as const;
const REASON_KEYS = ['reason', 'error', 'message', 'detail', 'note', 'why'] as const;

/** Мөр тус бүрийн үр дүн агуулж БОЛОХ массив талбарууд. */
const OUTCOME_ARRAY_KEYS = [
  'results', 'outcomes', 'per_id', 'per_log', 'per_row', 'items', 'details',
  'rows', 'logs', 'log_results', 'entries',
] as const;
/** id-гийн ХУВААРИЛСАН жагсаалт хэлбэрийн талбарууд. */
const OK_ID_KEYS = [
  'ok_ids', 'added_ids', 'promoted_ids', 'rejected_ids', 'curated_ids',
  'changed_ids', 'success_ids', 'succeeded_ids',
] as const;
const SKIP_ID_KEYS = [
  'skipped_ids', 'skipped', 'unchanged_ids', 'ignored_ids', 'already_ids',
] as const;
const FAIL_ID_KEYS = [
  'failed_ids', 'failed', 'errors', 'error_ids', 'invalid_ids', 'missing_ids',
  'not_found_ids',
] as const;

interface RawOutcome {
  status: BulkOutcomeStatus;
  reason: string | null;
}

/**
 * Массивын нэг элементийг уншина.
 *
 * ⚠️ ЦЭВЭР ТОО ирвэл «амжилттай» гэж үзнэ.  `results: [3, 7, 11]` гэсэн
 * хэлбэр нь бараг үргэлж «эдгээр нь болсон» гэсэн утгатай; сөрөг талыг
 * тусад нь `failed_ids`-ээр өгдөг.
 */
function readOutcomeItem(item: unknown): { id: number; out: RawOutcome } | null {
  const bare = outcomeId(item);
  if (bare !== null) return { id: bare, out: { status: 'ok', reason: null } };

  const rec = asRecord(item);
  if (!rec) return null;

  let id: number | null = null;
  for (const k of ID_KEYS) {
    id = outcomeId(rec[k]);
    if (id !== null) break;
  }
  if (id === null) return null;

  let reason: string | null = null;
  for (const k of REASON_KEYS) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) {
      reason = v.trim();
      break;
    }
  }

  let status: BulkOutcomeStatus | null = null;
  for (const k of STATUS_KEYS) {
    const v = rec[k];
    if (typeof v === 'string') {
      status = statusWord(v);
      if (status) break;
    } else if (typeof v === 'boolean') {
      status = v ? 'ok' : 'failed';
      break;
    }
  }
  if (!status) {
    // `{ ok: true }` / `{ success: false }` хэлбэр.
    for (const k of ['ok', 'success', 'succeeded', 'applied', 'changed']) {
      const v = rec[k];
      if (typeof v === 'boolean') {
        status = v ? 'ok' : 'failed';
        break;
      }
    }
  }
  // Төлөв танигдахгүй атлаа шалтгаан бичсэн бол тэр нь АЛДАА.
  if (!status) status = reason ? 'failed' : 'unknown';

  return { id, out: { status, reason } };
}

export interface ParsedBulkOutcomes {
  /** Сервер мөр тус бүрийн мэдээлэл ӨГСӨН эсэх. */
  found: boolean;
  /** Илгээсэн БҮХ id-г, ИЛГЭЭСЭН дарааллаар нь хамарна. */
  outcomes: BulkRowOutcome[];
}

/**
 * Серверийн хариунаас мөр тус бүрийн үр дүнг гаргаж авна.
 *
 * ⚠️ ТАЛБАРЫН НЭРИЙГ ХАТУУ БИЧИХГҮЙ.  Энэ роутын шинэ хариуг ӨӨР сесс
 * бичиж байгаа тул нэр нь `results` / `outcomes` / `per_id` / `failed_ids`
 * ... аль нь ч байж болно.  Танигдахгүй бол `found = false` буцаана —
 * ХУДЛАА тайлбарлахаас хоосон байх нь ДЭЭР.
 */
export function parseBulkOutcomes(
  payload: unknown,
  attemptedIds: readonly number[],
): ParsedBulkOutcomes {
  const map = new Map<number, RawOutcome>();
  const rec = asRecord(payload);

  if (rec) {
    // 1) Массив хэлбэр: results: [{ log_id, status, reason }, …]
    for (const key of OUTCOME_ARRAY_KEYS) {
      const v = rec[key];
      if (!Array.isArray(v)) continue;
      for (const item of v) {
        const parsed = readOutcomeItem(item);
        if (parsed) map.set(parsed.id, parsed.out);
      }
      if (map.size > 0) break;
    }

    // 2) Объект-газрын зураг: results: { "12": "ok", "13": { … } }
    if (map.size === 0) {
      for (const key of OUTCOME_ARRAY_KEYS) {
        const m = asRecord(rec[key]);
        if (!m) continue;
        for (const [k, v] of Object.entries(m)) {
          const id = outcomeId(k);
          if (id === null) continue;
          if (typeof v === 'string') {
            map.set(id, { status: statusWord(v) ?? 'unknown', reason: null });
          } else {
            const parsed = readOutcomeItem({ ...(asRecord(v) ?? {}), id });
            if (parsed) map.set(parsed.id, parsed.out);
          }
        }
        if (map.size > 0) break;
      }
    }

    // 3) id-гийн ХУВААРИЛСАН жагсаалт: { added: 17, failed_ids: [3, 4] }
    //    ⚠️ Массив эсэхийг ЗААВАЛ шалгана — өнөөдрийн `{ rejected: 5 }` нь
    //    ТОО бөгөөд түүнийг id жагсаалт гэж уншвал утгагүй болно.
    const buckets: Array<[readonly string[], BulkOutcomeStatus]> = [
      [FAIL_ID_KEYS, 'failed'],
      [SKIP_ID_KEYS, 'skipped'],
      [OK_ID_KEYS, 'ok'],
    ];
    for (const [keys, status] of buckets) {
      for (const key of keys) {
        const v = rec[key];
        if (!Array.isArray(v)) continue;
        for (const item of v) {
          const parsed = readOutcomeItem(item);
          if (!parsed) continue;
          // ⚠️ МӨР ТУС БҮРИЙН тодорхой хариу нь БҮДҮҮН ангиллаас ДЭЭГҮҮР.
          //    Үүнгүйгээр `{results: […], invalid_ids: 0}` маягийн хариунд
          //    нэмэлт талбар нь бодит үр дүнг ДАРЖ БИЧИХ эрсдэлтэй.
          if (map.has(parsed.id)) continue;
          // Ангиллын жагсаалт өөрөө төлөвөө хэлж байна; элементийн өөрийнх
          // нь төлөв зөвхөн ИЛ бичигдсэн үед ялна.
          const explicit = asRecord(item) !== null && parsed.out.status !== 'unknown';
          map.set(parsed.id, {
            status: explicit ? parsed.out.status : status,
            reason: parsed.out.reason,
          });
        }
      }
    }
  }

  const found = map.size > 0;
  const outcomes = attemptedIds.map<BulkRowOutcome>((id) => {
    const hit = map.get(id);
    return {
      id,
      status: hit?.status ?? 'unknown',
      reason: hit?.reason ?? null,
      reasonKey: null,
      inferred: false,
    };
  });
  return { found, outcomes };
}

/**
 * Хариунаас НИЙТ тоог гаргана.  Талбарын нэр өөрчлөгдвөл `null` буцаана —
 * илгээсэн тоогоор ОРЛУУЛАХГҮЙ (тэр нь ХУДАЛ баталгаа болно).
 */
export function pickCount(payload: unknown, keys: readonly string[]): number | null {
  const rec = asRecord(payload);
  if (!rec) return null;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * НИЙТ ТООноос мөрийн төлөвийг нөхнө.  ЗӨВХӨН `unknown` мөрд хүрнэ.
 *
 * ⚠️ Хэсэгчилсэн тохиолдолд (17/20) ЮУ Ч ХИЙХГҮЙ — аль 3 нь болоогүйг тоо
 * ХЭЛЭХГҮЙ.  Санамсаргүй 3 мөрийг «алдаатай» гэж будах нь хянагчийг буруу
 * мөр рүү явуулна.
 */
export function reconcileByCount<T extends BulkRowOutcome>(
  rows: readonly T[],
  serverCount: number | null,
): T[] {
  if (serverCount === null) return rows.slice();
  const unknown = rows.filter((r) => r.status === 'unknown').length;
  if (unknown === 0) return rows.slice();
  const knownOk = rows.filter((r) => r.status === 'ok').length;
  const remaining = serverCount - knownOk;
  if (remaining >= unknown) {
    return rows.map((r) =>
      r.status === 'unknown' ? { ...r, status: 'ok' as BulkOutcomeStatus, inferred: true } : r,
    );
  }
  if (remaining <= 0) {
    return rows.map((r) =>
      r.status === 'unknown' ? { ...r, status: 'failed' as BulkOutcomeStatus, inferred: true } : r,
    );
  }
  return rows.slice();
}

/**
 * ДАХИН УНШИГДСАН дарааллаас мөрийн төлөвийг нөхнө.
 *
 * `/assistant/pending` нь `WHERE curated = 0` — дуудлагын дараа ДАХИН гарч
 * ирсэн мөр нь БОЛООГҮЙ, алга болсон нь БОЛСОН гэсэн үг.  Энэ бол
 * хэсэгчилсэн амжилтыг мөр тус бүрээр ялгах ЦОРЫН ГАНЦ арга — сервер тал
 * per-id хариу нийлүүлэх хүртэл.
 *
 * ⚠️ Дуудагч нь жагсаалт үнэхээр ДАХИН УНШИГДСАН эсэхийг (`dataUpdatedAt`)
 * шалгасан байх ЁСТОЙ — эс бөгөөс хуучин кэш дээр дүгнэж, бүх мөрийг
 * «болоогүй» гэж будна.
 */
export function reconcileByPresence<T extends BulkRowOutcome>(
  rows: readonly T[],
  stillPending: ReadonlySet<number>,
): T[] {
  return rows.map((r) =>
    r.status === 'unknown'
      ? {
          ...r,
          status: (stillPending.has(r.id) ? 'failed' : 'ok') as BulkOutcomeStatus,
          inferred: true,
        }
      : r,
  );
}

export function summarizeOutcomes(
  rows: readonly BulkRowOutcome[],
): Record<BulkOutcomeStatus, number> {
  const out: Record<BulkOutcomeStatus, number> = { ok: 0, skipped: 0, failed: 0, unknown: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

/**
 * Багц гарцын НАРИЙН үр дүнгийн кодыг (`already_reviewed`, `raced`, …)
 * уншигдах бичвэр болгоно.
 *
 * ⚠️ `intentLabel`-тэй ЯГ ИЖИЛ хэв маяг: түлхүүр олдохгүй бол ТҮҮХИЙ кодыг
 * харуулна.  Сервер шинэ код нэмэхэд UI нь ХООСОН нүд БИШ, ойлгомжтой
 * англи слаг харуулна — тэр нь хянагчид дэмжлэг гуйхад хангалттай.
 */
export function bulkReasonLabel(
  t: (k: string) => string,
  reason: string | null,
): string | null {
  if (!reason) return null;
  const key = `assistantCuration.bulkOutcome.${reason}`;
  const label = t(key);
  return label === key ? reason : label;
}
