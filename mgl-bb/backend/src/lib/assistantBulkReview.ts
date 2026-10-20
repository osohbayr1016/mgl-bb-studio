/**
 * БАГЦААР ДЭВШҮҮЛЭХ / ТАТГАЛЗАХ — ЦЭВЭР ТӨЛӨВЛӨГЧ (курацийн дараалал).
 *
 * ЗОРИЛГО: `POST /api/revit/assistant/bulk-review`-ийн БҮХ шийдвэрийг D1-гүй
 * газарт байрлуулж, тестээр барих.  Роут нь зөвхөн уншина → энэ модуль
 * ТӨЛӨВЛӨНӨ → роут бичнэ → энэ модуль ТУНАДАСЛАНА (`settleBulkReview`).
 *
 * ⚠️ ЯАГААД БАГЦ ХЭРЭГТЭЙ ВЭ: өнөөдөр ахлагч МӨР ТУС БҮРЭЭР шийддэг
 * (`POST /assistant/examples` нэг мөрөөр, `POST /assistant/review` нэг
 * мөрөөр).  20 PC-ээс өдөрт хэдэн зуун бүртгэл ирэхэд тэр нь БОДИТООР
 * гүйцэхгүй ⇒ дараалал хуримтлагдаж, курац ОГТ хийгдэхгүй болно.
 *
 * ⚠️ ЭНЭ ФАЙЛ ЯМАР Ч ИМПОРТГҮЙ, ЦЭВЭР байх ЁСТОЙ (`assistantExampleInsert.ts`
 * -ийн ижил дүрэм).  Тиймээс `isIntent` нь ПАРАМЕТРЭЭР ирнэ — санааны
 * жагсаалт `routes/revit.ts`-д (`ASSISTANT_INTENTS`, twin: `IntentRouter.cs`)
 * үлдэнэ, энд ХУУЛБАРЛАГДАХГҮЙ.
 *
 * ⚠️ ЭНЭ МОДУЛЬ ЭРХ ШАЛГАХГҮЙ.  Эрхийн хаалга нь роут дээр, `isManager`
 * (admin | senior) — ганц мөрийн гарцуудтай ЯГ ИЖИЛ, ӨРГӨЖӨӨГҮЙ.
 *
 * ⚠️ ЭНЭ НЬ ИНЖЕНЕРТ ЮУ Ч ХАРУУЛАХГҮЙ.  Эзний 2026-09-01-ний шийдвэр:
 * эрх мэдэл нь OBSERVE хэвээр — багц курац нь ЗӨВХӨН ахлагчийн вэб дэх
 * дарааллын хурдны асуудал, Revit доторх зан төлөв ОГТ хөндөгдөхгүй.
 */

/* ================================================================== */
/*  1. ХЯЗГААР БА ТОГТМОЛУУД                                           */
/* ================================================================== */

/**
 * НЭГ хүсэлтэд зөвшөөрөх бүртгэлийн ДЭЭД тоо.
 *
 * ⚠️ ЯАГААД 200: `GET /assistant/pending`-ийн `limit` нь 200-аар
 *    ХАВЧИГДДАГ (`Math.min(200, …)`).  Тиймээс «дэлгэц дээрх БҮХ мөрийг
 *    сонгоод нэг дар» гэдэг нь яг НЭГ хүсэлтэд багтана — ахлагч хэзээ ч
 *    «яагаад 43 мөр л шийдэгдэв?» гэж гайхахгүй.
 *
 * ⚠️ ЧИМЭЭГҮЙ ТАСЛАЛТ ХОРИОТОЙ.  Роут нь хязгаараас ХЭТЭРВЭЛ 413 өгнө
 *    (`idList`-ийн `max` шиг ЧИМЭЭГҮЙ таслахгүй), ба хариу бүрд `cap`-ыг
 *    ИЛ буцаана.  Хэрэглэгч 250 мөр илгээгээд 200 нь л шийдэгдсэнийг
 *    МЭДЭХГҮЙ үлдэх ЗАМ БАЙХГҮЙ.
 */
export const BULK_REVIEW_CAP = 200;

/** Зөвшөөрөгдөх үйлдэл.  `promote` = дэвшүүлэх, `reject` = татгалзах. */
export const BULK_ACTIONS = ['promote', 'reject'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export function isBulkAction(v: unknown): v is BulkAction {
  return typeof v === 'string' && (BULK_ACTIONS as readonly string[]).includes(v);
}

/**
 * МӨР ТУС БҮРИЙН ҮР ДҮН.  ⚠️ Хэсэгчилсэн амжилтыг НЭГ 200 болгож
 * НУРААХГҮЙ — ахлагч АЛЬ мөр ЯАГААД шийдэгдээгүйг харах ЁСТОЙ.
 *
 *  · applied          — ЭНЭ хүсэлтээр шийдэгдэв.
 *  · already_reviewed — өмнө нь шийдэгдсэн (idempotent — дахин илгээхэд
 *                       ХОЁР ДАХИН дэвшихгүй, өөр хүний шийдвэрийг
 *                       ДАРЖ БИЧИХГҮЙ).  `review_status` талбар нь юу
 *                       болсныг хэлнэ.
 *  · not_found        — тийм бүртгэл АЛГА (0195-ийн 90 хоногийн гар
 *                       цэвэрлэгээ хуудас нээгдсэний дараа устгасан байж
 *                       БОЛНО).
 *  · no_intent        — promote: машин ч таагаагүй, хүн ч заагаагүй ⇒
 *                       ЯМАР шошготой жишээ болгохыг МЭДЭХ АРГАГҮЙ.
 *  · bad_intent       — promote: шошго нь `ASSISTANT_INTENTS`-д АЛГА
 *                       (загварын дрифт / хуучин add-in).  `no_intent`-оос
 *                       ТУСДАА — оноштой байх ёстой.
 *  · example_rejected — promote: ЯГ ТЭР (text, intent, team) жишээг хэн нэгэн
 *                       аль хэдийн ТАТГАЛЗСАН.  Бүртгэлийг БАС хөндөхгүй:
 *                       INSERT нь `WHERE review_state <> 'rejected'`-т
 *                       баригдаж 0 өөрчлөлт өгөх тул «дэвшлээ» гэж
 *                       бүртгэвэл ЖИШЭЭГҮЙ ДЭВШҮҮЛЭЛТ гэсэн ХУДАЛ төлөв
 *                       үүснэ.
 *  · raced            — уншихад чөлөөтэй байсан ч бичих хооронд ХАМТ
 *                       АЖИЛЛАГЧ шийдвэрлэсэн (`AND review_status IS NULL`
 *                       ялагдав).
 *  · failed           — бичилтийн дараа ч мөр ШИЙДЭГДЭЭГҮЙ.  Онолын
 *                       хувьд хүрэшгүй; ЧИМЭЭГҮЙ АМЖИЛТ гэж мэдээлэхээс
 *                       ИЛ «failed» гэж хэлэх нь ДЭЭР.
 */
export const BULK_OUTCOMES = [
  'applied',
  'already_reviewed',
  'not_found',
  'no_intent',
  'bad_intent',
  'example_rejected',
  'raced',
  'failed',
] as const;
export type BulkOutcome = (typeof BULK_OUTCOMES)[number];

/** `review_status` → үйлдлийн зорилтот утга. */
export const BULK_TARGET_STATUS: Record<BulkAction, 'promoted' | 'rejected'> = {
  promote: 'promoted',
  reject: 'rejected',
};

/**
 * НАРИЙН үр дүн → БҮДҮҮН төлөв (`ok` | `skipped` | `failed`).
 *
 * ⚠️ TWIN: `frontend/src/features/revit-assistant/curation.ts`-ийн
 *    `BulkOutcomeStatus`.  Хариу нь МӨР бүрд ХОЁУЛАНГ нь агуулна —
 *    `status` (бүдүүн, UI-ийн өнгө) БА `outcome` (нарийн, ШАЛТГААН).
 *    Frontend-ийн задлагч нь `status`-ыг ЭХЭЛЖ уншдаг тул нарийн нэр
 *    нэмэгдэхэд UI «unknown» рүү УНАХГҮЙ — гэрээ ӨРГӨЖИХ боломжтой хэвээр.
 *
 * ⚠️ ЭРЭМБИЙН ЛОГИК:
 *   · `ok`      — ЭНЭ хүсэлт мөрийг шийдсэн.
 *   · `skipped` — ЗОРИУД хийгээгүй.  Хүн юу хийхээ мэднэ (өөр шийдвэр
 *                 гарсан / шошго дутуу / жишээ нь татгалзсан).
 *   · `failed`  — ХҮСЭЛТИЙГ БИЕЛҮҮЛЖ ЧАДААГҮЙ.  `not_found` нь энд:
 *                 бүртгэл АЛГА болсон нь ахлагчийн шийдэж болох зүйл БИШ.
 */
export const BULK_OUTCOME_STATUS: Record<
  BulkOutcome,
  'ok' | 'skipped' | 'failed'
> = {
  applied: 'ok',
  already_reviewed: 'skipped',
  not_found: 'failed',
  no_intent: 'skipped',
  bad_intent: 'skipped',
  example_rejected: 'skipped',
  raced: 'skipped',
  failed: 'failed',
};

/* ================================================================== */
/*  2. ID-НЫ ЦЭВЭРЛЭГЭЭ                                                */
/* ================================================================== */

export interface BulkIdParse {
  /** ЖИНХЭНЭ, ДАВХАРДААГҮЙ, эрэмбэ нь оролтынхоор. */
  ids: number[];
  /** Эерэг бүхэл БИШ байсан элементийн тоо (null, true, '5', 0, -3, 1.5 …). */
  invalid: number;
  /** Давхардсан тул хаягдсан элементийн тоо. */
  duplicates: number;
  /** Оролт огт массив биш байв уу. */
  notArray: boolean;
}

/**
 * `idList` (`routes/revit.ts`)-ийн БАГЦ хувилбар, ГУРВАН ЯЛГААТАЙГААР:
 *
 *  1. ДАВХАРДЛЫГ ХАЯНА.  Мөр тус бүрийн үр дүн буцаадаг гарцад нэг id
 *     ХОЁР УДАА гарч ирвэл ахлагч «41 applied, 41 already_reviewed» гэсэн
 *     ӨӨРТЭЙГӨӨ ЗӨРСӨН жагсаалт харна — тэр нь бодит байдал БИШ, зөвхөн
 *     нэг батчид нэг id хоёр удаа орсны сүүдэр.
 *  2. ЧИМЭЭГҮЙ ТАСЛАХГҮЙ.  `idList` нь `max`-д хүрэхэд ДУУГҮЙ зогсдог;
 *     энд бид БҮГДИЙГ уншаад тоог буцаана — роут 413 өгөх шийдвэрийг
 *     БҮТЭН тоон дээр гаргана.
 *  3. ХОГ ЭЛЕМЕНТИЙГ ТООЛНО (`invalid`) — хариунд ил гарна.
 *
 * ⚠️ `posId`-ийн ЯГ ИЖИЛ дүрэм: `typeof === 'number'` + бүхэл + `> 0`.
 *    `Number(v)` ХЭРЭГЛЭХГҮЙ — `Number(null) === 0`, `Number(true) === 1`
 *    хоёулаа `Number.isInteger`-ыг ДАВЖ, БОДИТ бүртгэл id=1-ийг хааж байв
 *    (1B аудит, P1).
 */
export function parseBulkIds(v: unknown): BulkIdParse {
  if (!Array.isArray(v)) {
    return { ids: [], invalid: 0, duplicates: 0, notArray: true };
  }
  const ids: number[] = [];
  const seen = new Set<number>();
  let invalid = 0;
  let duplicates = 0;
  for (const raw of v) {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
      invalid += 1;
      continue;
    }
    if (seen.has(raw)) {
      duplicates += 1;
      continue;
    }
    seen.add(raw);
    ids.push(raw);
  }
  return { ids, invalid, duplicates, notArray: false };
}

/* ================================================================== */
/*  3. ТӨЛӨВЛӨГӨӨ                                                      */
/* ================================================================== */

/** `assistant_logs`-оос уншсан, төлөвлөхөд ХЭРЭГТЭЙ талбарууд. */
export interface BulkLogRow {
  id: number;
  text: string;
  predicted: string | null;
  corrected: string | null;
  review_status: string | null;
  team_code: string | null;
}

/** promote үед үүсэх жишээний ЦӨМ (роут үүнээс bind угсарна). */
export interface BulkPromoteDraft {
  text: string;
  intent: string;
  /**
   * ⚠️ `manual` ЭНД ХЭЗЭЭ Ч ГАРАХГҮЙ.  Багц дэвшүүлэлт нь БАЙГАА мөрийг
   *    БАТАЛГААЖУУЛАХ үйлдэл; хүн бичвэр ЗОХИОХ бол ганц мөрийн
   *    `POST /assistant/examples`-ээр явна.
   */
  curationAction: 'approved' | 'corrected';
  /** `deriveSourceType`-д ӨГӨХ машины таамаг (СЕРВЕРЭЭС уншсан). */
  predicted: string | null;
  /** `resolveExampleTeam`-ийн `originTeam` — гарал үүслийн бүртгэлийнх. */
  teamCode: string | null;
}

export interface BulkPlanItem {
  id: number;
  /** `null` = энэ мөр БИЧИЛТЭД ОРНО.  Эс бөгөөс ШАЛТГААН. */
  blocked: BulkOutcome | null;
  /** Мөрийн ОДООГИЙН төлөв (`already_reviewed`-ийн тайлбар). */
  reviewStatus: string | null;
  /** Зөвхөн `promote` + `blocked === null` үед. */
  promote: BulkPromoteDraft | null;
}

/**
 * ⚠️ ЖИШЭЭНИЙ ӨВӨРМӨЦ ТҮЛХҮҮР — `0238`-ын `idx_assistant_ex_uniq`-ийн
 *    `(text, intent, IFNULL(team_code, ''))`-ЫГ ЯГ ДАВТАНА.
 *    Тусгаарлагч нь U+0000 — SQLite-ийн TEXT-д ч, монгол бичвэрт ч
 *    ГАРАХГҮЙ тул «a|b» ⇄ «a» + «|b» маягийн мөргөлдөөн БОЛОМЖГҮЙ.
 */
export function exampleKey(
  text: string,
  intent: string,
  teamCode: string | null,
): string {
  return [text, intent, teamCode ?? ''].join('\u0000');
}

/**
 * ЭХНИЙ ШАТ: уншсан мөрүүдээс төлөвлөгөө гаргана.
 *
 * ⚠️ `AND review_status IS NULL` (ЭХНИЙ ШИЙДВЭР ЯЛНА) нь SQL талд ч
 *    хэвээр байна — энд урьдчилан шүүх нь зөвхөн ХАРАГДАХ БАЙДЛЫН төлөө
 *    (ахлагчид «энэ мөрийг өмнө нь шийдсэн байна» гэж хэлэхийн тулд).
 *    Хоёр давхарга ХАМТДАА байх ЁСТОЙ: уншилт ба бичилтийн хооронд
 *    хамтран ажиллагч шийдвэрлэж болно (⇒ `raced`).
 */
export function planBulkReview(input: {
  action: BulkAction;
  ids: readonly number[];
  rows: ReadonlyMap<number, BulkLogRow>;
  /** `routes/revit.ts`-ийн `isIntent` (twin: `addin/IntentRouter.cs`). */
  isIntent: (v: unknown) => boolean;
}): BulkPlanItem[] {
  const out: BulkPlanItem[] = [];
  for (const id of input.ids) {
    const row = input.rows.get(id);
    if (!row) {
      out.push({ id, blocked: 'not_found', reviewStatus: null, promote: null });
      continue;
    }
    if (row.review_status !== null && row.review_status !== undefined) {
      out.push({
        id,
        blocked: 'already_reviewed',
        reviewStatus: row.review_status,
        promote: null,
      });
      continue;
    }
    if (input.action === 'reject') {
      out.push({ id, blocked: null, reviewStatus: null, promote: null });
      continue;
    }
    // --- promote: шошго ЗААВАЛ ---
    // ⚠️ ЭРЭМБЭ: хүний ЗАСВАР (`corrected`) нь машины таамгаас ДЭЭГҮҮР.
    //    Инженер Revit дотор шошгыг өөрөө зассан бол тэр нь аль хэдийн
    //    ХҮНИЙ шийдвэр — багц батлагаа түүнийг ДАРЖ БИЧИХГҮЙ.
    const label = row.corrected ?? row.predicted;
    if (typeof label !== 'string' || label === '') {
      out.push({ id, blocked: 'no_intent', reviewStatus: null, promote: null });
      continue;
    }
    if (!input.isIntent(label)) {
      out.push({ id, blocked: 'bad_intent', reviewStatus: null, promote: null });
      continue;
    }
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (text.length === 0) {
      // Бичвэргүй мөрөөс жишээ ГАРАХГҮЙ (`assistant_examples.text` нь
      // NOT NULL, ба хоосон мөр сургалтад утгагүй).  `no_intent`-той нэг
      // ангилалд оруулсан нь ЗОРИУД: хоёулаа «энэ мөрөөс жишээ гаргах
      // МАТЕРИАЛ дутуу» гэсэн НЭГ утгатай.
      out.push({ id, blocked: 'no_intent', reviewStatus: null, promote: null });
      continue;
    }
    out.push({
      id,
      blocked: null,
      reviewStatus: null,
      promote: {
        text,
        intent: label,
        curationAction: row.corrected ? 'corrected' : 'approved',
        predicted: row.predicted ?? null,
        // ⚠️ ЗӨВХӨН гарал үүслийн бүртгэлийн баг.  Хянагчийн ӨӨРИЙН
        //    багийг ЭНД ХЭЗЭЭ Ч оноохгүй (`resolveExampleTeam`-ийн дүрэм):
        //    BA-гийн senior IZ-ийн мөрийг багцаар дэвшүүлэхэд корпус
        //    бохирдох ба `AND review_status IS NULL` тул БУЦААХ БОЛОМЖГҮЙ.
        teamCode: row.team_code ?? null,
      },
    });
  }
  return out;
}

/**
 * ХОЁРДУГААР ШАТ: аль хэдийн ТАТГАЛЗСАН жишээтэй давхцах мөрүүдийг хасна.
 *
 * ⚠️ ЯАГААД ЗААВАЛ ВЭ: жишээний INSERT нь
 *    `WHERE assistant_examples.review_state <> 'rejected'`-тэй — татгалзсан
 *    жишээг ЧИМЭЭГҮЙ АМИЛУУЛАХГҮЙ (0195:50).  Тэр хамгаалалт байхад
 *    бүртгэлийн UPDATE нь ТУСАД НЬ амжилттай болох тул «promoted» гэж
 *    тамгалагдсан ч ЖИШЭЭ ҮҮСЭХГҮЙ.  Багц дээр энэ нь ЧИМЭЭГҮЙ АЛДАГДАЛ —
 *    тиймээс мөрийг БҮХЭЛД НЬ хасаж, ахлагчид ил хэлнэ.  Мөр дараалалдаа
 *    ҮЛДЭНЭ; ахлагч түүнийг ТАТГАЛЗАХ (bulk reject) эсвэл ганцаарчлан
 *    засах боломжтой.
 */
export function blockRejectedExamples(
  items: readonly BulkPlanItem[],
  rejectedKeys: ReadonlySet<string>,
): BulkPlanItem[] {
  if (rejectedKeys.size === 0) return items.slice();
  return items.map((it) => {
    if (it.blocked !== null || it.promote === null) return it;
    const key = exampleKey(it.promote.text, it.promote.intent, it.promote.teamCode);
    return rejectedKeys.has(key)
      ? { ...it, blocked: 'example_rejected' as BulkOutcome, promote: null }
      : it;
  });
}

/* ================================================================== */
/*  4. ТУНАДАС (бичилтийн ДАРАА)                                       */
/* ================================================================== */

export interface BulkResult {
  id: number;
  outcome: BulkOutcome;
  /** `already_reviewed` / `raced` үед — БОДИТ төлөв. */
  review_status?: string;
}

/** Бичилтийн дараах БАТАЛГААНЫ уншилтын мөр. */
export interface BulkVerifyRow {
  id: number;
  review_status: string | null;
  reviewed_by: number | null;
}

/**
 * ГУРАВДУГААР ШАТ: бичилтийн дараа мөр БОДИТООР шийдэгдсэн эсэхийг
 * БАТАЛГААНЫ уншилтаас тунадаслана.
 *
 * ⚠️ ЯАГААД ДАХИН УНШИХ ВЭ: D1-ийн багц UPDATE нь `meta.changes`-ыг
 *    ЧАНК ДАЯАР нэг тоогоор буцаана — «90 мөрөөс 87 нь өөрчлөгдөв» гэдэг
 *    нь АЛЬ ГУРАВ нь өөрчлөгдөөгүйг ХЭЛЭХГҮЙ.  Мөр тус бүрийн үнэн
 *    хариултыг өгөх ЦОРЫН ГАНЦ зам бол мөр бүрд тусад нь statement явуулах
 *    (200 statement) ЭСВЭЛ дараа нь ДАХИН унших.  Сүүлийнх нь 3 нэмэлт
 *    уншилт — ахлагчийн ГАРААР дардаг үйлдэлд үл мэдэгдэхүйц.
 *
 * ⚠️ `reviewedBy` тааруулалт: төлөв нь зорилтот утгад хүрсэн БА хянагч нь
 *    БИД бол `applied`.  Өөр хүн бол `raced` — тэр нь АЛДАА БИШ, харин
 *    «таны шийдвэр хэрэгжээгүй, учир нь хамт ажиллагч түрүүлсэн» гэсэн
 *    ҮНЭН мэдээлэл.
 *
 * ⚠️ НЭГ ХҮН НЭГ ЗҮЙЛИЙГ ХОЁР ХҮСЭЛТЭЭР зэрэг илгээвэл хоёулаа `applied`
 *    гэж мэдээлнэ.  Тэр нь ЗӨВ: мөр яг тэр хүний хүссэнээр, ЯГ НЭГ УДАА
 *    шийдэгдсэн (`AND review_status IS NULL` хоёр дахийг 0 өөрчлөлт
 *    болгосон, жишээний upsert нь мөн idempotent).
 */
export function settleBulkReview(input: {
  action: BulkAction;
  items: readonly BulkPlanItem[];
  verified: ReadonlyMap<number, BulkVerifyRow>;
  reviewerId: number;
}): BulkResult[] {
  const target = BULK_TARGET_STATUS[input.action];
  return input.items.map((it): BulkResult => {
    if (it.blocked !== null) {
      const r: BulkResult = { id: it.id, outcome: it.blocked };
      if (it.blocked === 'already_reviewed' && it.reviewStatus !== null) {
        r.review_status = it.reviewStatus;
      }
      return r;
    }
    const v = input.verified.get(it.id);
    if (!v || v.review_status === null) {
      return { id: it.id, outcome: 'failed' };
    }
    if (v.review_status === target && v.reviewed_by === input.reviewerId) {
      return { id: it.id, outcome: 'applied' };
    }
    return { id: it.id, outcome: 'raced', review_status: v.review_status };
  });
}

/**
 * Үр дүнгийн ТООЛУУР.  ⚠️ БҮХ түлхүүр ҮРГЭЛЖ байна (0 ч гэсэн) — UI нь
 * «0 not_found» ба «not_found гэдэг талбар БАЙХГҮЙ» хоёрыг ялгах
 * шаардлагагүй.
 */
export function summarizeBulkResults(
  results: readonly BulkResult[],
): Record<BulkOutcome, number> {
  const counts = Object.fromEntries(BULK_OUTCOMES.map((o) => [o, 0])) as Record<
    BulkOutcome,
    number
  >;
  for (const r of results) counts[r.outcome] += 1;
  return counts;
}

/** HTTP хариунд явах МӨРИЙН хэлбэр. */
export interface BulkWireResult {
  id: number;
  /** Бүдүүн төлөв — UI-ийн өнгө (twin: frontend `BulkOutcomeStatus`). */
  status: 'ok' | 'skipped' | 'failed';
  /** Нарийн шалтгаан — `BULK_OUTCOMES`-ийн нэг. */
  outcome: BulkOutcome;
  /**
   * Хүнд харуулах ТҮҮХИЙ шалтгаан.  `applied` дээр `null` — «яагаад
   * болсон бэ» гэсэн тайлбар хэрэггүй.
   */
  reason: string | null;
  /** Мөрийн БОДИТ төлөв (`already_reviewed` / `raced` үед). */
  review_status?: string;
}

/**
 * `BulkResult` → HTTP хариу.
 *
 * ⚠️ `status` ба `outcome` ХОЁУЛАА явна.  Зөвхөн `outcome` явуулбал
 *    frontend-ийн `statusWord` нь `no_intent` / `raced` / `example_rejected`
 *    гэсэн ШИНЭ үгсийг танихгүй тул мөр «unknown» болж, UI нь тоогоор
 *    ТААМАГЛАХ (`reconcileByCount`) горим руу шилжинэ — өөрөөр хэлбэл
 *    сервер ҮНЭН хариуг мэдэж байхад UI нь ТААМАГ харуулна.
 */
export function toWireResults(results: readonly BulkResult[]): BulkWireResult[] {
  return results.map((r) => {
    const wire: BulkWireResult = {
      id: r.id,
      status: BULK_OUTCOME_STATUS[r.outcome],
      outcome: r.outcome,
      reason: r.outcome === 'applied' ? null : r.outcome,
    };
    if (r.review_status !== undefined) wire.review_status = r.review_status;
    return wire;
  });
}

/** Бичилтэд ОРОХ мөрүүдийн id (`blocked === null`). */
export function eligibleIds(items: readonly BulkPlanItem[]): number[] {
  return items.filter((it) => it.blocked === null).map((it) => it.id);
}

/* ================================================================== */
/*  5. D1-ИЙН BIND АРИФМЕТИК                                           */
/* ================================================================== */

/**
 * D1: нэг statement-д ДЭЭД тал нь 100 bind.
 *
 * Энэ гарцын ДӨРВӨН хэлбэр (тооцоо ГАРААР бичигдэхгүй, доорхоос гарна):
 *
 *   1. Уншилт   `WHERE id IN (…)`                       → 0 + N
 *   2. Баталгаа `WHERE id IN (…)`                       → 0 + N
 *   3. promote-ийн бүртгэлийн UPDATE (reviewed_by)      → 1 + N
 *   4. reject-ийн бүртгэлийн UPDATE (reviewed_by, note) → 2 + N
 *      (`rejectLogStatements`, `routes/revit.ts`)
 *
 * Хамгийн МУУ тохиолдол нь 2 тогтмол bind ⇒ N ≤ 98.  Бид 90-ийг сонгов —
 * файлын бусад гарцуудтай ИЖИЛ тоо (2 + 90 = 92 ≤ 100), нэмэлт багана
 * орох зайтай.
 *
 * ⚠️ ТЕКСТЭЭР хайх «татгалзсан жишээ» уншилт нь мөн ЭНЭ чанкийг хэрэглэнэ:
 *    `WHERE review_state = 'rejected' AND text IN (…)` → 0 + 90 = 90 ≤ 100.
 *
 * ⚠️ ЖИШЭЭНИЙ INSERT нь ЭНЭ тоог ХЭРЭГЛЭХГҮЙ — тэр нь
 *    `ASSISTANT_EXAMPLE_ROWS_PER_STATEMENT` (14 bind/мөр ⇒ 7 мөр ⇒ 98).
 */
export const BULK_IDS_PER_STATEMENT = 90;

/** `xs`-ийг `size` урттай хэсгүүдэд хуваана (bind хязгаарын туслах). */
export function chunkIds<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
