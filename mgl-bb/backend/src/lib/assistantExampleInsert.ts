/**
 * `assistant_examples`-ийн БАГЦ INSERT-ийн ГЭРЭЭ (contract).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА ВЭ: 2026-08-28-нд ГУРВАН тусдаа сесс энэ
 * НЭГ INSERT-ийг зэрэг өргөжүүлэв — 1B-6 (`source_log_id`), 1B-7
 * (`source_type` / `review_state` / `reviewed_by` / `reviewed_at` /
 * `origin_log_id`).  Багана 7-оос 13 болж, нэг мөрөнд ногдох bind 7-оос 13
 * болов.  Гурван сессийн аль нь ч нөгөөгийнхөө тоог хараагүй.
 *
 * `routes/revit.ts`-д тэр тоо ГУРВАН газар давхардаж бичигддэг байсан:
 * баганын жагсаалт, `?` кортеж, bind-ийн массив.  `tsc` тэдгээрийн зөрүүг
 * БАРИХГҮЙ — алдаа нь зөвхөн ЭХНИЙ БҮТЭН БАГЦ (`PER`-ээс олон мөр) дээр
 * D1-ийн runtime bind-count алдаа болж гарна.  Одоо гурвуулаа ЭНЭ ЖАГСААЛТААС
 * гарна; нийцлийг `assistantExampleInsert.test.ts` барина.
 *
 * ⚠️ `reviewed_at` нь bind БИШ, SQL талын CASE илэрхийлэл — тиймээс
 * ЭНД БАГАНЫН ТОО БА BIND-ИЙН ТОО ТЭНЦҮҮ БИШ.  (`assistantLogInsert.ts`
 * дээр тэд тэнцүү; тэр загварыг энд хуулж БОЛОХГҮЙ.)  Яагаад CASE вэ:
 * `datetime('now')` нь `created_at`-тай ИЖИЛ форматтай мөр өгдөг бол
 * JS-ийн `toISOString()` нь "2026-08-28T03:05:10.000Z" болж форматын дрифт
 * үүсгэнэ; мөн `review_state = 'pending'` мөрд NULL үлдээх ёстой — ХЯНААГҮЙ
 * мөрөнд хяналтын хугацаа бичих нь гарал үүслийг ХУДЛАА болгоно.
 *
 * ⚠️ Энэ модуль ЯМАР Ч ИМПОРТГҮЙ, цэвэр байх ёстой.
 */

/** D1-ийн ХАТУУ хязгаар: нэг statement-д дээд тал нь 100 bind параметр. */
export const D1_MAX_BINDS = 100;

/**
 * INSERT-ийн багана бүр + тухайн баганын VALUES дэх SQL хэлтэрхий.
 * `?` = bind, өөр бүхэн = SQL талд бодогдоно.  ⚠️ ДАРААЛАЛ нь
 * `routes/revit.ts`-ийн bind массивтай ЯГ ТААРАХ ЁСТОЙ.
 */
export const ASSISTANT_EXAMPLE_COLUMN_SPEC = [
  ['text', '?'],
  ['text_folded', '?'],
  ['intent', '?'],
  ['slot', '?'],
  ['style', '?'],
  ['source', '?'],
  ['created_by', '?'],
  // --- 0215_assistant_trust_taxonomy.sql (ИТГЭЛИЙН ТАКСОНОМИ) ---
  ['source_type', '?'],
  ['review_state', '?'],
  ['reviewed_by', '?'],
  // ⚠️ CASE — нөхцөлдөө `review_state`-ыг ДАХИН bind хийнэ (доорх тайлбар).
  ['reviewed_at', "CASE WHEN ? = 'pending' THEN NULL ELSE datetime('now') END"],
  ['origin_log_id', '?'],
  // --- 0214_assistant_review.sql (ХЯНАЛТЫН МӨЧЛӨГ) ---
  // ⚠️ `source_log_id` (0214) ба `origin_log_id` (0215) нь ИЖИЛ УТГА
  // хадгална — хоёр сесс нэг ойлголтыг өөр нэрээр нэмсэн.  Хоёуланг нь
  // НЭГ илэрхийллээс бичдэг тул тэд ХЭЗЭЭ Ч зөрөх боломжгүй.  Дэлгэрэнгүй
  // тайлбар `routes/revit.ts`-ийн INSERT дээр.
  ['source_log_id', '?'],
  // --- 0238_assistant_team_scope.sql (БАГИЙН ХАМРАХ ХҮРЭЭ / 2-6) ---
  // ⚠️ СЕРВЕР ШИЙДНЭ (`resolveExampleTeam`) — клиентийн зарласныг ИТГЭЛ
  //    гэж үзэхгүй.  `deriveSourceType`-тэй ЯГ ИЖИЛ загвар (гэрээ G1).
  // ⚠️ BIND: 13 → 14 → floor(100/14) = 7 мөр — ӨӨРЧЛӨГДӨХГҮЙ.
  // ⚠️ ЭНЭ БАГАНА нь `idx_assistant_ex_uniq`-ийн ГУРАВ ДАХЬ гишүүн
  //    (`IFNULL(team_code, '')`) — `routes/revit.ts`-ийн `ON CONFLICT`
  //    зорилт нь тэр ГУРВАН илэрхийллийг ЯГ давтах ЁСТОЙ, эс бөгөөс
  //    SQLite «ON CONFLICT clause does not match any … UNIQUE constraint»
  //    өгч БҮХ курацийн INSERT унана.
  ['team_code', '?'],
] as const satisfies ReadonlyArray<readonly [string, string]>;

/** Баганын нэрс, ЯГ INSERT-ийн дарааллаар. */
export const ASSISTANT_EXAMPLE_COLUMNS = ASSISTANT_EXAMPLE_COLUMN_SPEC.map(
  (c) => c[0],
);

/** `(?, ?, …, CASE …, ?)` — гараар бичихгүй, спецээс угсарна. */
export const ASSISTANT_EXAMPLE_TUPLE = `(${ASSISTANT_EXAMPLE_COLUMN_SPEC.map(
  (c) => c[1],
).join(', ')})`;

/**
 * Нэг мөрөнд ногдох bind — кортеж дэх `?`-ийн БОДИТ тоо.
 * ⚠️ Баганын тооноос ЯЛГААТАЙ (`reviewed_at`-ийн CASE нөхцөл).
 */
export const ASSISTANT_EXAMPLE_BINDS =
  ASSISTANT_EXAMPLE_TUPLE.split('?').length - 1;

/**
 * Нэг statement-д багтах мөрийн тоо.
 * ⚠️ Багана нэмэхэд ЭНЭ ТОО ӨӨРӨӨ буурна — гараар засах зүйл БАЙХГҮЙ.
 * 14 bind → floor(100 / 14) = 7 мөр → 98 bind ≤ 100.
 */
export const ASSISTANT_EXAMPLE_ROWS_PER_STATEMENT = Math.floor(
  D1_MAX_BINDS / ASSISTANT_EXAMPLE_BINDS,
);

/** `INSERT INTO assistant_examples (…)`-ийн баганын жагсаалт. */
export const ASSISTANT_EXAMPLE_COLUMN_SQL = ASSISTANT_EXAMPLE_COLUMNS.join(', ');

/**
 * Эх сурвалжийн таксономи — `0215_assistant_trust_taxonomy.sql`-ийн
 * `source_type` CHECK-тай ЯГ ИЖИЛ 8 утга (Architecture Freeze §23).
 * ⚠️ ЭНЭ ЖАГСААЛТ БА МИГРАЦИЙН CHECK ХОЁР ХАМТ ХӨДЛӨНӨ — нэгийг нь
 * өөрчилвөл нөгөө нь INSERT дээр CHECK constraint failed өгнө.
 */
export const SOURCE_TYPES = [
  'HUMAN', 'HUMAN_CORRECTED', 'HUMAN_VERIFIED', 'RULE_VERIFIED',
  'SYNTHETIC', 'AI_GENERATED', 'IMPORTED', 'UNKNOWN',
] as const;

/**
 * Хянан үзэх мөчлөгийн төлөв — 0215-ийн `review_state` CHECK-ийн 4 утга.
 * ⚠️ `'rejected'`-ыг КЛИЕНТЭЭС хүлээж авахгүй: татгалзал нь
 * `POST /assistant/reject`-ийн ажил (тэнд `is_active = 0` мөн зэрэг
 * бичигдэнэ).  Тиймээс энэ жагсаалт CHECK-ээс НЭГ УТГААР БОГИНО.
 */
export const CLIENT_REVIEW_STATES = ['pending', 'reviewed', 'verified'] as const;

/* ================================================================== */
/*  ЭХ СУРВАЛЖИЙН СЕРВЕР ДЭРИВЭЦ (гэрээ G1)                            */
/* ================================================================== */

export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Хянагчийн БОДИТ үйлдэл — таксономийн цорын ганц ЗӨВШӨӨРӨГДСӨН оролт.
 * ⚠️ TWIN: `frontend/src/features/revit-assistant/curation.ts`-ийн
 *    `CurationAction`.  Хоёулаа ХАМТ хөдөлнө.
 *   · `approved`  — машины таасан шошгыг хүн ХАРЖ БАТАЛСАН.
 *   · `corrected` — хүн шошгыг ӨӨРЧИЛСӨН (машин буруу байсан).
 *   · `manual`    — хүн бичвэрийг ӨӨРӨӨ зохиож, ӨӨРӨӨ шошголсон.
 */
export const CURATION_ACTIONS = ['approved', 'corrected', 'manual'] as const;
export type CurationAction = (typeof CURATION_ACTIONS)[number];

/**
 * Клиент ЗАРЛАЖ БОЛОХ `source_type`-ууд — ЗӨВХӨН ИТГЭЛ БУУРУУЛАХ утгууд.
 *
 * ⚠️ ГЭРЭЭ G1: «клиент ХУДАЛ ЗАРЛАЖ ЧАДАХГҮЙ».  `HUMAN`, `HUMAN_CORRECTED`,
 *    `HUMAN_VERIFIED`, `RULE_VERIFIED` нь БАТАЛГААНЫ мэдэгдэл — тэднийг
 *    зөвхөн СЕРВЕР, хянагчийн БОДИТ үйлдлээс ургуулж ононо.  Клиент тэднийг
 *    илгээвэл ҮЛ ОЙШООГДОНО (алдаа биш — дэривэц ижил утга өгөх нь ердийн).
 *    Эсрэгээрээ «энэ бол машин зохиосон / импорт / гарал нь мэдэгдэхгүй»
 *    гэж ХЭЛЭХ нь өөрийгөө БУРУУТГАХ мэдэгдэл тул итгэж болно.
 */
export const CLIENT_DECLARABLE_SOURCE_TYPES = [
  'SYNTHETIC', 'AI_GENERATED', 'IMPORTED', 'UNKNOWN',
] as const;

/**
 * `source_type`-ыг СЕРВЕР талд ургуулна (гэрээ G1).
 *
 * ⚠️ ЯАГААД ЭНЭ ФУНКЦ ОРШИН БАЙНА ВЭ: роутын анхдагч нь `'UNKNOWN'` байсан.
 *    0215-ийн backfill нь `manual → HUMAN` гэж буулгасан — өөрөөр хэлбэл
 *    НЭГ оролт, ХОЁР хариулт: түүхэн мөр `HUMAN`, өнөөдрийн мөр `UNKNOWN`.
 *    Мөн 0215-ийн бодлогоор `UNKNOWN` нь сургалтын цөмд ХЭЗЭЭ Ч ОРОХГҮЙ тул
 *    «өнөөдрөөс хойших хүний БҮХ хөдөлмөр сургалтад тэнцэхгүй» гэсэн
 *    БАЙНГЫН алдаа болж байв.
 *
 * ⚠️ ЭРЭМБЭ ЧУХАЛ.  Курацийн ИЛ үйлдэл нь клиентийн зарласнаас ДЭЭГҮҮР:
 *    эс бөгөөс клиент `source_type: 'UNKNOWN'` илгээгээд баталгаажсан
 *    хүний хөдөлмөрийг сургалтаас гаргачихна (G1 үүнийг ил хориглосон).
 *
 * ⚠️ `predicted` нь СЕРВЕРЭЭС (`assistant_logs.predicted`) уншигдана,
 *    клиентээс АВАХГҮЙ.  Машины таамаг ОГТ байхгүй мөрийг «баталгаажуулсан»
 *    (`HUMAN_VERIFIED`) гэж нэрлэх нь ХУДАЛ — юуг нь баталгаажуулав?  Тэр
 *    тохиолдолд шошго нь цэвэр хүнийх ⇒ `HUMAN` (0215-ийн `manual → HUMAN`
 *    буулгалттай ТААРНА).
 */
export function deriveSourceType(input: {
  // ⚠️ `string`, нэгдэл БИШ — функц НЭГЭЭМОЛ (total) байх ёстой:
  //    танихгүй `source` ирвэл 'usage'-тай ижил салаагаар явна
  //    (хүний курацийн үйлдэл), ӨГГҮЙ ОНООГҮЙ алдаа өгөхгүй.
  source: string;
  curationAction: CurationAction | null;
  declared: string | null;
  predicted: string | null;
}): SourceType {
  // 1. Хянагчийн ИЛ үйлдэл — ХАМГИЙН ӨНДӨР эрх.
  if (input.curationAction === 'corrected') return 'HUMAN_CORRECTED';
  if (input.curationAction === 'manual') return 'HUMAN';
  if (input.curationAction === 'approved') {
    return input.predicted ? 'HUMAN_VERIFIED' : 'HUMAN';
  }
  // 2. Клиентийн ӨӨРИЙГӨӨ БУРУУТГАХ зарлал (итгэл БУУРУУЛАХ утгууд).
  if (
    input.declared &&
    (CLIENT_DECLARABLE_SOURCE_TYPES as readonly string[]).includes(input.declared)
  ) {
    return input.declared as SourceType;
  }
  // 3. Үйлдэл ч, зарлал ч байхгүй (хуучин клиент) — `source`-оос ургуулна.
  //    ⚠️ 0215-ийн backfill-тай ЯГ ТААРНА: manual → HUMAN, seed → AI_GENERATED.
  //    `usage` нь `isManager`-ын дэвшүүлэлт тул ТОДОРХОЙЛОЛТООРОО хүний
  //    курацийн үйлдэл — `UNKNOWN` буцаах ЗАМ ЭНД БАЙХГҮЙ (G1).
  if (input.source === 'manual') return 'HUMAN';
  if (input.source === 'seed') return 'AI_GENERATED';
  return input.predicted ? 'HUMAN_VERIFIED' : 'HUMAN';
}

/* ================================================================== */
/*  БАГИЙН ХАМРАХ ХҮРЭЭ (0238 / 2-6)                                   */
/* ================================================================== */

/**
 * `ON CONFLICT (…)`-ийн зорилт — `0238`-ын `idx_assistant_ex_uniq`-ийн
 * баганын/илэрхийллийн жагсаалттай ЯГ ТААРАХ ЁСТОЙ.
 *
 * ⚠️ ЭНЭ БОЛ ГАНЦ МӨРИЙН ХАМГИЙН АЮУЛТАЙ ХЭСЭГ.  SQLite-ийн upsert
 *    зорилт нь ОРШИН БАЙГАА өвөрмөц индексийн жагсаалттай ЯГ таарах ёстой;
 *    таарахгүй бол INSERT нь «ON CONFLICT clause does not match any PRIMARY
 *    KEY or UNIQUE constraint» өгч БҮХ курацийн бичилт унана.  0238 нь
 *    хуучин `(text, intent)` индексийг ХАЯЖ, `(text, intent,
 *    IFNULL(team_code, ''))` үүсгэдэг тул хуучин зорилт ХҮЧИНГҮЙ БОЛНО.
 *
 * ⚠️ DEPLOY-ИЙН ДАРААЛАЛ АЧАА ДААНА: миграц ЭХЛЭЭД, worker ДАРАА нь.
 *    Хооронд нь ХУУЧИН worker энэ INSERT дээр 500 өгнө — тэр цонх нь
 *    ЗӨВХӨН admin/senior-ын гар курацид нөлөөлнө (add-in-ы `POST
 *    /assistant/logs` нь ӨӨР хүснэгт, ӨӨР индекс тул ХӨНДӨГДӨХГҮЙ).
 *    Урвуулах нь БҮР МУУ: шинэ worker хуучин индекс дээр ЯГ ИЖИЛ алдаа өгнө.
 */
export const ASSISTANT_EXAMPLE_CONFLICT_TARGET = "text, intent, IFNULL(team_code, '')";

/**
 * Курацлагдсан жишээний баг — СЕРВЕР шийднэ (гэрээ G1, `deriveSourceType`
 * -тэй ЯГ ИЖИЛ загвар).
 *
 * ⚠️ Клиентийн зарласан `team_code`-ыг ИТГЭЛ гэж үзэхгүй.  Дараалал:
 *   1. Гарал үүслийн бүртгэлийн `assistant_logs.team_code` (тэр нь өөрөө
 *      сервер талд бичигдсэн) — ХАМГИЙН ИТГЭЛТЭЙ.
 *   2. Бүртгэл олдоогүй / NULL бол → хянагчийн ИЛ сонголт, ГЭХДЭЭ зөвхөн
 *      роут түүнийг зөвшөөрсөн бол (гишүүн эсвэл `isManager`).
 *   3. Эс бөгөөс NULL = КОМПАНИ ДАЯАР.
 *
 * ⚠️ ХЭЗЭЭ Ч «хянагчийн үндсэн баг»-ыг ЧИМЭЭГҮЙ оноохгүй.  Тэр нь IZ-ийн
 *    өгүүлбэрийг BA гэж тамгалах ЯГ ТЭР алдаа: BA-гийн senior нь IZ-ийн
 *    мөрийг дэвшүүлэхэд мөр нь BA-гийн корпуст очно, ба
 *    `AND review_status IS NULL` (ЭХНИЙ шийдвэр ялна) тул БУЦААХ БОЛОМЖГҮЙ.
 *
 * ⚠️ ХЭЛБЭРИЙН ШАЛГАЛТ нь `isTeamCodeShape`-тай ижил дүрэм ч ЭНД
 *    ХУУЛБАРЛАСАН: энэ модуль ЯМАР Ч ИМПОРТГҮЙ байх ёстой (файлын толгойн
 *    дүрэм) тул `teamContext.ts`-ыг татаж болохгүй.  ⚠️ Нөөцлөгдсөн код
 *    (`NORM`/`GENERAL`/…) -ыг ЭНД шүүхгүй — роут нь АМЬД `teams.code`-оос
 *    шалгадаг тул хуурамч код тэнд унана, энэ нь ЗӨВХӨН хэлбэрийн шүүлт.
 */
export function resolveExampleTeam(input: {
  /** `assistant_logs.team_code` — сервер бичсэн. */
  originTeam: string | null;
  /** Клиентийн сонголт. */
  declared: string | null;
  /** Роут: хянагч тэр багт гишүүн эсвэл `isManager` мөн үү. */
  declaredAllowed: boolean;
}): string | null {
  if (input.originTeam) return input.originTeam;
  if (input.declared && input.declaredAllowed && /^[A-Z]{2,8}$/.test(input.declared)) {
    return input.declared;
  }
  return null;
}
