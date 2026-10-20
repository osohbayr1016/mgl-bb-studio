/**
 * BIM-AI ҮЙЛ ЯВДЛЫН ЛЕДЖЕР — ЦОРЫН ГАНЦ БИЧИХ ГАРЦ.
 *
 * `bim_artifacts` · `bim_sessions` · `revit_transactions` ·
 * `revit_element_touches` · `learning_events` (миграц 0201–0210) руу хийх
 * БҮХ `INSERT` энэ файлаар дамжина.  `backend/scripts/check-bim-events.mjs`
 * ба `bimEvents.test.ts` хоёул тэр дүрмийг grep-ээр барина.
 *
 * ⚠️ ЯАГААД НЭГ ФАЙЛ ВЭ.  Гурван зүйл мөр бүр дээр ЗӨВ байх ёстой ба
 *    гуравт нь ч алдвал ЧИМЭЭГҮЙ бохирдол үүснэ:
 *      1. bind арифметик (D1-ийн нэг statement = 100 bind),
 *      2. дагалдах хэсгийн МАСК (`parts_expected` / `parts_present`),
 *      3. `ON CONFLICT` зорилтот индекс (дахин илгээлт vs клиентийн алдаа).
 *    Route бүрт хуулбарлавал гурвуулаа тархана.  `qto.ts:832` ба
 *    `revit.ts:1703`-ийн хоорондоо зөрчилдсөн тайлбарууд нь тэр
 *    тархалтын аль хэдийн шипсэн үр дагавар.
 *
 * ⚠️ ЭНЭ ГАДАРГУУГ `/mcp`-ЭЭР ХЭЗЭЭ Ч БҮҮ ГАРГА.  `mcp/tools/`-д twin
 *    бүү бич.  `/mcp` нь ГУРВАН хаалтыг ЗЭРЭГ тойрдог:
 *      1. `workerScopeGuard` — `index.ts:147` дээр `'/api/*'`-д Л суудаг.
 *         `/mcp` нь OAuth провайдерын `apiHandlers`-т байгаа root зам тул
 *         Hono-д огт хүрдэггүй (`index.ts:276`).
 *      2. `entitlementGuard` — мөн `'/api/*'` (`index.ts:150`).  Тэр файлын
 *         өөрийнх нь толгой (`lib/entitlement.ts:29-33`) үүнийг ил хэлдэг:
 *         модуль унтраасан tenant ч MCP-ээр хандана.
 *      3. Tenant-ийн хил — `tid` тулгалт нь ЗӨВХӨН `middleware/auth.ts:79-88`.
 *         `/mcp`-ийн токен шийдвэрлэгч (`index.ts:292-296`,
 *         `resolveExternalToken`) нь `verifyToken`-оос өөр юу ч шалгадаггүй —
 *         `tid` ч, `purpose` ч биш.
 *    Ажилтны зан төлөвийн бүртгэлийн хувьд гурвуулан зэрэг тойрогдох нь
 *    хүлээн зөвшөөрөгдөхгүй.
 *
 * ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ (0201/0203/0204/0205-ийн толгойд
 *    дөрвөн удаа бичигдсэн, `lib/revitNoteAi.ts:152` + `revitNoteAi.test.ts:262`
 *    -оор түгжигдсэн): ЭЛЕМЕНТ ТҮВШНИЙ ҮЙЛ АЖИЛЛАГАА НЬ ЗӨВХӨН ӨӨРИЙГӨӨ
 *    ХАРАХАД.  Эдгээр хүснэгтийн дээгүүр бичигдэх УНШИХ route БҮР нь
 *      (а) `actor_user_id`/`user_id = viewer.sub`-ээр хязгаарлагдсан, эсвэл
 *      (б) зөвхөн НЭГТГЭСЭН
 *    байх ЁСТОЙ.  Нэг хүний нэрлэсэн үйл ажиллагааны жагсаалтыг ӨӨР хүнд
 *    ХЭЗЭЭ Ч буцаахгүй.
 *
 * ⚠️ БИЧИХ ДАРААЛАЛ — 0205-ын гэрээ, ЗӨРЧИЖ БОЛОХГҮЙ:
 *      1) артефактын байтыг R2-д тавь → сервер sha256 тооцоол →
 *         `bim_artifacts` INSERT → `artifact_id`      (`insertArtifact`)
 *      2) `bim_sessions` upsert (`session_uid`) → `session_id` (`upsertBimSession`)
 *      3) НЭГ `db.batch()`: revit_transactions → revit_element_touches →
 *         learning_events  (ЯГ ЭНЭ ДАРААЛЛААР)        (`writeBimBatch`)
 *      4) `bim_sessions`-ийн тоолуурыг шинэчил         (`bumpSessionCounters`)
 *    АРТЕФАКТ ЭХЛЭЭД гэдэг нь САНАМСАРГҮЙ БИШ: `parts_present`-ийг ЭХНИЙ
 *    БИЧИЛТЭД мэдэгддэг болгож, ямар ч ТОХИРУУЛГЫН UPDATE-ийг хэрэггүй
 *    болгодог — 0206-ын append-only trigger UPDATE-ийг ТАСАЛДАГ.
 */

/* ================================================================== */
/*  1. ДАГАЛДАХ ХЭСГИЙН МАСК — 0203-ын битийн хуваарь                  */
/* ================================================================== */

/**
 * ⚠️ ЭНЭ БОЛ ЭНЭ БҮХ БАГЦЫН ХАМГИЙН ЧУХАЛ ЗӨВ БАЙДЛЫН ЗҮЙЛ.  Маскгүй бол
 *    «дагалдах мөр АЛДАГДСАН» ба «дагалдах мөр АНХНААСАА БАЙГААГҮЙ» хоёр
 *    ЯЛГАГДАХГҮЙ.  Dataset үүсгэгч нь төгс хүчинтэй харагдаж, ЧИМЭЭГҮЙ
 *    БУРУУ сургалтын жишээ гаргана — тэр алдаа нь зөвхөн загварын
 *    нарийвчлалаар илэрч, хэзээ ч оношлогдохгүй.
 *
 * ⚠️ Битийн УТГА нь миграц 0203-ын толгойд бичигдсэн ба тэнд ЭНЭ ФАЙЛЫГ
 *    нэрлэсэн («Битүүд (`lib/bimEvents.ts`-д `Record`-оор давхардуулна)»).
 *    Утга солих нь БУРУУ — аль хэдийн бичигдсэн мөрүүдийн утга өөрчлөгдөнө.
 *    Зөвхөн ШИНЭ бит НЭМНЭ (дараагийн чөлөөт нь 512).
 */
export const SATELLITE_PARTS = [
  'ELEMENT_ROWS', //   1 — `revit_element_touches` мөрүүд
  'ELEMENT_DELTA', //   2 — R2 дахь бүрэн элементийн дэлгэрэнгүй
  'ELEMENT_ATTRS', //   4 — атрибут/параметр шийдэгдсэн (2-р үе шат ажилласан)
  'VIEW_IMAGE', //   8 — харагдацын зураг
  'AI_CAUSE', //  16 — `learning_events` мөр энэ гүйлгээг үүсгэсэн
  'RULE_VERDICT', //  32 — дүрмийн дүгнэлт хавсаргасан
  'CORRECTION', //  64 — хүний залруулга хавсаргасан
  'APPROVAL', // 128 — батлалт хавсаргасан
  'REPORT', // 256 — илгээсэн явцын тайлан хавсаргасан
] as const;

export type SatellitePart = (typeof SATELLITE_PARTS)[number];

/**
 * ⚠️ `Record<SatellitePart, number>` тэмдэглэгээ нь ЗОРИУДААР: 10 дахь хэсэг
 *    нэмэхэд энэ файл ЭВДЭРЧ, бит оноохоос өөр аргагүй болно.  `pushSweep.ts:53`
 *    -ийн `CATEGORY_OF`-той ЯГ ИЖИЛ заль.
 */
export const PART_BIT: Record<SatellitePart, number> = {
  ELEMENT_ROWS: 1,
  ELEMENT_DELTA: 2,
  ELEMENT_ATTRS: 4,
  VIEW_IMAGE: 8,
  AI_CAUSE: 16,
  RULE_VERDICT: 32,
  CORRECTION: 64,
  APPROVAL: 128,
  REPORT: 256,
};

/** Хэсгүүдийн олонлог → бит маск. */
export function maskOf(parts: Iterable<SatellitePart>): number {
  let m = 0;
  for (const p of parts) m |= PART_BIT[p];
  return m;
}

/** Бит маск → хэсгүүдийн жагсаалт.  Зөвхөн ОНОШЛОГООНД (лог, health). */
export function partsOfMask(mask: number): SatellitePart[] {
  return SATELLITE_PARTS.filter((p) => (mask & PART_BIT[p]) !== 0);
}

/**
 * ⚠️ ХОЖИМ Л МЭДЭГДЭХ ХЭСГҮҮД.  Эдгээр дөрөв нь ӨӨР МӨРӨӨС (нэг
 *    `learning_events` мөр `txn_id`-ээр гүйлгээ рүү заана) ирдэг тул
 *    гүйлгээг бичих АГШИНД мэдэгдэх БОЛОМЖГҮЙ.  0206-ын trigger нь
 *    UPDATE-ийг таслах тул тэднийг ХОЖИМ нэмэх ч боломжгүй.
 *    ⇒ Ingest тэднийг `parts_expected`-д ХЭЗЭЭ Ч тавихгүй; эс бөгөөс
 *      гүйлгээ бүр МӨНХӨД «дутуу» гэж тэмдэглэгдэнэ.
 *    Тэдгээр битүүд нь 1B-3+-ийн ГАРГАЖ АВСАН (derived) давхаргад
 *    зориулагдсан — тэр давхарга `learning_events.txn_id`-ээр JOIN хийж
 *    бодно, `revit_transactions`-ыг ЗАСАХГҮЙ.
 */
export const DEFERRED_PARTS: readonly SatellitePart[] = [
  'RULE_VERDICT',
  'CORRECTION',
  'APPROVAL',
  'REPORT',
];

/** Ingest-ийн бичих агшинд МЭДЭГДЭХ хэсгүүд. */
export const WRITE_TIME_PARTS: readonly SatellitePart[] = SATELLITE_PARTS.filter(
  (p) => !DEFERRED_PARTS.includes(p),
);

/**
 * `parts_missing` (0207/0209-ийн GENERATED багана) нь `parts_expected & ~parts_present`.
 *
 * ⚠️ Dataset-д ОРОХ эрхтэй мөрийн ЦОРЫН ГАНЦ тодорхойлолт.  1B-4 үүнийг
 *    дуудна — өөрийн шүүлт бичихийг ХОРИГЛОНО.  `parts_missing` нь
 *    хоёулан хүснэгтэд (0207 `revit_transactions`, 0209 `learning_events`)
 *    байгаа ба хэсэгчилсэн индекстэй (`idx_revit_txn_missing`, `idx_le_missing`).
 */
export const DATASET_ELIGIBLE_SQL = 'parts_missing = 0';

/* ================================================================== */
/*  2. ХААЛТТАЙ УТГЫН БАГЦУУД                                          */
/* ================================================================== */

/**
 * `learning_events.kind` — одоогийн 16 утга (0205-ын толгойн жагсаалт).
 *
 * ⚠️ DB дээр CHECK ТАВИАГҮЙ, ЗОРИУДААР: сая мөртэй append-only хүснэгтэд
 *    CHECK өөрчлөх нь ХҮСНЭГТИЙГ ДАХИН БАРИХЫГ шаардана — тэр нь энэ
 *    загварын хийж ЧАДАХГҮЙ цорын ганц зүйл.  Хаалттай багцыг ЭНД,
 *    `Record<LearningEventKind, …>` БҮРЭН бичлэгээр барина: шинэ утга
 *    нэмэхэд ЭМХЭТГЭЛ УНАНА, чимээгүй алдагдахгүй.
 */
export const LEARNING_EVENT_KINDS = [
  // 1B-1-ийн ес
  'TEXT',
  'IMAGE',
  'SKETCH',
  'REVIT_STATE',
  'USER_ACTION',
  'AI_ACTION',
  'HUMAN_CORRECTION',
  'RULE_VALIDATION',
  'FINAL_APPROVAL',
  // 0205-д нэмэгдсэн долоо
  'AI_PREDICTION',
  'TOOL_INVOKED',
  'TOOL_RESULT',
  'USER_FEEDBACK',
  'PROGRESS_REPORT',
  'SESSION_START',
  'SESSION_END',
] as const;

export type LearningEventKind = (typeof LEARNING_EVENT_KINDS)[number];

/** `learning_events.actor_kind` / `revit_transactions.origin`-ийн хүн талын багц. */
export const ACTOR_KINDS = ['human', 'ai', 'rule', 'system'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * Төрөл → АНХДАГЧ жүжигчин (1B-1 §3.4-ийн гэрээний хүснэгт).
 * Клиент илт өөрөөр илгээж болно (ж: `USER_ACTION`-ыг script гүйцэтгэсэн).
 */
export const DEFAULT_ACTOR_OF: Record<LearningEventKind, ActorKind> = {
  TEXT: 'human',
  IMAGE: 'human',
  SKETCH: 'human',
  REVIT_STATE: 'system',
  USER_ACTION: 'human',
  AI_ACTION: 'ai',
  HUMAN_CORRECTION: 'human',
  RULE_VALIDATION: 'rule',
  FINAL_APPROVAL: 'human',
  AI_PREDICTION: 'ai',
  TOOL_INVOKED: 'ai',
  TOOL_RESULT: 'system',
  USER_FEEDBACK: 'human',
  PROGRESS_REPORT: 'human',
  SESSION_START: 'system',
  SESSION_END: 'system',
};

/**
 * Төрөл → тухайн үйл явдал ЗААВАЛ зарлах ёстой дагалдах хэсгүүд.
 *
 * ⚠️ Зөвхөн БИЧИХ АГШИНД мэдэгдэх хэсгүүдийг л жагсаана (`WRITE_TIME_PARTS`).
 *    `DEFERRED_PARTS`-ыг энд тавих нь мөр бүрийг мөнхөд «дутуу» болгоно.
 *    ГЭХДЭЭ гурван онцгой тохиолдол бий: `HUMAN_CORRECTION` /
 *    `RULE_VALIDATION` / `FINAL_APPROVAL` / `PROGRESS_REPORT` мөрүүд нь
 *    ӨӨРСДӨӨ тэр залруулга/дүгнэлт/батламж БАЙХ тул тэдний хувьд
 *    харгалзах бит нь ЭНЭ МӨРНИЙ ӨӨРИЙНХ НЬ агуулгаас бичих агшинд
 *    шийдэгдэнэ (`presentPartsForEvent`-ийг үз) — хожуу ирэх дагалдах
 *    мөр биш.
 *
 * ⚠️ `Record<LearningEventKind, …>` тул 17 дахь төрөл нэмэхэд ЭНЭ ФАЙЛ
 *    эвдэрч, шинэ төрөл ямар хэлбэртэй болохыг шийдэхээс өөр аргагүй болно.
 */
export const REQUIRED_PARTS_OF: Record<LearningEventKind, readonly SatellitePart[]> = {
  TEXT: [],
  IMAGE: ['VIEW_IMAGE'],
  SKETCH: ['VIEW_IMAGE'],
  REVIT_STATE: ['ELEMENT_DELTA'],
  USER_ACTION: [],
  AI_ACTION: [],
  HUMAN_CORRECTION: ['CORRECTION'],
  RULE_VALIDATION: ['RULE_VERDICT'],
  FINAL_APPROVAL: ['APPROVAL'],
  AI_PREDICTION: [],
  TOOL_INVOKED: [],
  TOOL_RESULT: [],
  USER_FEEDBACK: [],
  PROGRESS_REPORT: ['REPORT'],
  SESSION_START: [],
  SESSION_END: [],
};

/** `learning_events.provenance` — 1B-7 өргөтгөнө, тиймээс DB дээр CHECK алга. */
export const PROVENANCE_VALUES = [
  'UNVERIFIED',
  'MACHINE_GENERATED',
  'RULE_VERIFIED',
  'HUMAN_VERIFIED',
  'HUMAN_CORRECTED',
  'REJECTED',
] as const;
export type Provenance = (typeof PROVENANCE_VALUES)[number];

/** `bim_artifacts.kind` — 0201-ийн жагсаалт. */
export const ARTIFACT_KINDS = [
  'ELEMENT_DELTA',
  'PARAM_SNAPSHOT',
  'VIEW_IMAGE',
  'SKETCH',
  'IMAGE',
  'PDF',
  'REVIT_STATE',
  'TEXT',
  'OTHER',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** `revit_transactions.op_class` — хэлнээс ҮЛ ХАМААРАХ хэвийн түлхүүр. */
export const OP_CLASSES = [
  'create',
  'edit',
  'delete',
  'undo',
  'redo',
  'view',
  'annotate',
  'link',
  'sync',
  'script',
  'other',
] as const;
export type OpClass = (typeof OP_CLASSES)[number];

/** `revit_transactions.origin`. */
export const TXN_ORIGINS = ['human', 'ai', 'script', 'sync', 'system'] as const;
export type TxnOrigin = (typeof TXN_ORIGINS)[number];

/** `revit_element_touches.change` — DB дээр CHECK-тэй, ХЭЗЭЭ Ч өргөжихгүй. */
export const TOUCH_CHANGES = ['add', 'modify', 'delete'] as const;
export type TouchChange = (typeof TOUCH_CHANGES)[number];

/* ================================================================== */
/*  3. ГЭРЭЭНИЙ ТЭМДЭГЛЭГЭЭ                                            */
/* ================================================================== */

/**
 * `payload_contract` — DB-ийн `CHECK (payload_contract GLOB 'v[0-9]*:*')`-тэй
 * таарна.  Гэрээний тэмдэглэгээгүй мөр огт орж чадахгүй.
 *
 * Жишээ: `v1:AI_ACTION`, `v1:IMAGE+VIEW_IMAGE`.
 */
export const CONTRACT_VERSION = 1;

export function contractTag(kind: LearningEventKind): string {
  const parts = REQUIRED_PARTS_OF[kind];
  return `v${CONTRACT_VERSION}:${kind}${parts.length ? '+' + parts.join('+') : ''}`;
}

/* ================================================================== */
/*  4. BIND АРИФМЕТИК — D1-ийн 100-bind тааз                           */
/* ================================================================== */

/**
 * ⚠️ ДҮРЭМ (`bimEvents.test.ts` барина):
 *   1. Bind хийгддэг баганыг ТООЛ.  `GENERATED` багана ба `DEFAULT`-той
 *      серверийн талын багана (`received_at`, `first_seen_at`, `last_seen_at`,
 *      `created_at`, redaction гурвал) ТЭГ bind зарцуулна.
 *   2. `rowsPerStatement = floor(100 / (bindColumns + 1))` — НЭГ БАГАНЫН
 *      НӨӨЦ үлдээ.  Маргааш `ALTER TABLE ADD COLUMN` хийхэд statement
 *      ЧИМЭЭГҮЙ унахгүй.
 *   3. Тогтмолыг statement-ийн ХАЖУУД тавь, өөр файлд биш.
 *   4. Тогтмол нь `VALUES` цуваа-ны `?` тоотой ТЭНЦҮҮ гэдгийг unit тест
 *      бататга.  Тайлбар хуучирдаг; тест хуучирдаггүй.
 *      (`routes/revit.ts:1703` нь өнөөдөр production дээр «12 bind → 8 мөр»
 *      гэж ХУДАЛ бичигдсэн байдаг — доор нь `BINDS = 13`, `PER = 7`.)
 */
function rowsPerStatement(binds: number): number {
  return Math.floor(100 / (binds + 1));
}

/* ---- bim_artifacts ------------------------------------------------ */

export const ARTIFACT_INSERT_COLUMNS = [
  'sha256',
  'bucket',
  'r2_key',
  'media_type',
  'kind',
  'schema_tag',
  'encoding',
  'byte_size',
  'item_count',
  'session_id',
  'project_id',
  'uploaded_by',
] as const;
// `id`, `created_at`, redaction гурвал → DEFAULT/NULL, bind = 0.
export const ARTIFACT_BINDS = ARTIFACT_INSERT_COLUMNS.length; // = 12
export const ARTIFACT_VALUES_TUPLE = `(${ARTIFACT_INSERT_COLUMNS.map(() => '?').join(', ')})`;
export const ARTIFACT_ROWS_PER_STATEMENT = rowsPerStatement(ARTIFACT_BINDS); // = 7

/* ---- bim_sessions ------------------------------------------------- */

export const SESSION_INSERT_COLUMNS = [
  'session_uid',
  'user_id',
  'project_id',
  'revit_document_id',
  'doc_uid',
  'doc_title',
  'is_link',
  'central_path_hash',
  'machine_hash',
  'worksharing',
  'revit_version',
  'revit_build',
  'addin_version',
  'addin_channel',
  'model_version',
  'prompt_version',
  'ruleset_version',
  'capture_schema',
  'capture_policy',
  'notice_version',
  'started_at',
  'ended_at',
  'client_tz_offset_min',
  'clock_skew_sec',
  'txn_count',
  'event_count',
  // ── АЛДАГДЛЫН ХОЁР ЭХ СУРВАЛЖ (0243).  ⚠️ `dropped_count` нь одооноос
  //    ГАРГАЖ АВСАН НИЙТ ДҮН = `client_dropped_count + server_dropped_count`.
  //    Эхний INSERT-д сервер тал ҮРГЭЛЖ 0 тул хоёулаа клиентийн зарласан
  //    нийлбэрээр бичигдэнэ (`bindSession` тэр утгыг ХОЁР УДАА өгнө).
  //    `server_dropped_count` нь bind ХИЙГДЭХГҮЙ — схемийн DEFAULT 0, зөвхөн
  //    `bumpSessionCounters` нэмнэ.
  'dropped_count',
  'client_dropped_count',
  // ── §48-R4-ийн дөрвөл (0217).  ⚠️ ДАРААЛАЛ ЛОАД-БЕАРИНГ: багийн дөрөв,
  //    ДАРАА НЬ `company_id`, ХАМГИЙН СҮҮЛД `perf_json` — `bindSession`-ийн
  //    массив ба `SESSION_VALUES_TUPLE`-ийн `?`-ууд яг үүнтэй уялдана.
  'team_code',
  'team_confidence',
  'team_source',
  'team_last_verified',
  // ── §72-ын компанийн хэмжээс (0217, ЭЗНИЙ ШИЙДВЭР Ш3, 2026-08-31).
  //    ⚠️ TEXT, `lib/requestContext.ts`-ийн tenant id.  СЕРВЕРЭЭС, клиентээс БИШ.
  'company_id',
  // ── 2-4-ийн сессийн гүйцэтгэлийн хураангуй (0226).  Тэр сесс баганыг
  //    үүсгээд утасны холболтыг ЭНД ХОЙШЛУУЛСАН, учир нь дараалал нь
  //    багийн талбаруудын ДАРАА байх ёстой байв.
  'perf_json',
] as const;
// `id`, `first_seen_at`, `last_seen_at` → DEFAULT, bind = 0.
// ⚠️ BIND АРИФМЕТИК (ЭЗНИЙ ШИЙДВЭР Ш3, 2026-08-31): 27 → 31 (баг) → 32
//    (`company_id`) → 33 (`perf_json`) → 34 (`client_dropped_count`, 0243).
//    `floor(100/35) = 2` — statement тутмын мөр 3-аас 2 БУУРСАН нь ХҮЛЭЭН
//    АВСАН зардал: `bim_sessions` нь бага урсгалтай (жилд ~122k мөр).
//    Өндөр урсгалтай `learning_events` (23 bind) ХӨНДӨГДӨӨГҮЙ — 0219 нь
//    ЗӨВХӨН GENERATED VIRTUAL нэмсэн.
//    ⛔ ДАРААГИЙН бодит багана нэмэхгүй: шинэ гүйцэтгэлийн тоо `perf_json`
//    дотор, шинэ багийн тоо `payload_json` дотор (`stampTeam`).  0243-ын
//    багана нь ОНЦГОЙ тохиолдол байсан: JSON дотор нуусан тоолуур нь
//    `UPDATE … = … + ?` хэлбэрээр атомаар нэмэгдэж ЧАДАХГҮЙ.
export const SESSION_BINDS = SESSION_INSERT_COLUMNS.length; // = 34
export const SESSION_VALUES_TUPLE = `(${SESSION_INSERT_COLUMNS.map(() => '?').join(', ')})`;
export const SESSION_ROWS_PER_STATEMENT = rowsPerStatement(SESSION_BINDS); // = 2 (floor(100/35))

/* ---- revit_transactions ------------------------------------------- */

export const TXN_INSERT_COLUMNS = [
  'session_id',
  'txn_uid',
  'seq',
  'user_id',
  'project_id',
  'op_name',
  'op_class',
  'added_count',
  'deleted_count',
  'modified_count',
  'category_json',
  'view_uid',
  'sheet_uid',
  'origin',
  'cause_event_id',
  'parent_txn_id',
  'parts_expected',
  'parts_present',
  'element_artifact_id',
  'touch_rows',
  'occurred_at',
] as const;
// `id`, `received_at`, redaction гурвал, GENERATED (`element_total`,
// `parts_missing`) → bind = 0.
export const TXN_BINDS = TXN_INSERT_COLUMNS.length; // = 21
export const TXN_ROWS_PER_STATEMENT = rowsPerStatement(TXN_BINDS); // = 4

/**
 * ⚠️ `cause_event_id` ба `parent_txn_id` нь INTEGER боловч клиент нь ЗӨВХӨН
 *    uid мэддэг.  Хоёулаа ДЭД АСУУЛГААР шийдэгдэнэ (0204-ийн (в) хувилбар,
 *    0205-д ч ижил).  `idx_le_uid` ба `idx_revit_txn_uid` хоёулаа UNIQUE тул
 *    энэ нь индексийн ГАНЦ хайлт.  **bind тоо ӨӨРЧЛӨГДӨХГҮЙ** — id-ийн
 *    оронд uid орно.
 *
 * ⚠️ `db.batch()` нь НЭГ ГҮЙЛГЭЭ бөгөөд statement-үүд ДАРААЛЛААРАА
 *    ажилладаг тул эцгийн INSERT нь хүүхдийн statement-ээс ӨМНӨ байх ЁСТОЙ.
 *    `chunkTopologically()` үүнийг барина.
 */
export const TXN_VALUES_TUPLE =
  '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ' +
  '(SELECT id FROM learning_events WHERE event_uid = ?), ' +
  '(SELECT id FROM revit_transactions WHERE txn_uid = ?), ' +
  '?, ?, ?, ?, ?)';

/* ---- revit_element_touches ---------------------------------------- */

export const TOUCH_INSERT_COLUMNS = [
  'txn_id',
  'session_id',
  'user_id',
  'project_id',
  'element_id',
  'element_uid',
  'change',
  'category',
  'type_name',
  'level_name',
  'workset',
  'host_uid',
  'placement_json',
  'params_artifact_id',
  'hits',
  'depth',
  'occurred_at',
] as const;
// `id`, `received_at`, redaction гурвал, GENERATED `place_level` → bind = 0.
export const TOUCH_BINDS = TOUCH_INSERT_COLUMNS.length; // = 17
export const TOUCH_ROWS_PER_STATEMENT = rowsPerStatement(TOUCH_BINDS); // = 5

/**
 * ⚠️ `txn_id INTEGER NOT NULL` бөгөөд гүйлгээний id нь бичих АГШИНД
 *    мэдэгдэхгүй.  0204-ийн (в) хувилбар: НЭГ `db.batch()` дотор дэд
 *    асуулгаар.  Гүйлгээ ҮНЭХЭЭР олдохгүй бол дэд асуулга NULL буцааж
 *    `NOT NULL` татгалзана → багц БҮХЭЛДЭЭ унана.  **ЧАНГА БҮТЭЛГҮЙТЭЛ нь
 *    ЗӨВ**: эцэггүй элементийн мөр нь корпусыг чимээгүй бохирдуулна.
 *    Тэр тохиолдолд `writeBimBatch` нь МӨР ТУС БҮРЭЭР дахин оролдоно
 *    (0203-ын ЗААВАЛ БИЕЛҮҮЛЭХ fallback гэрээ).
 */
export const TOUCH_VALUES_TUPLE =
  '((SELECT id FROM revit_transactions WHERE txn_uid = ?), ' +
  '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

/* ---- learning_events ---------------------------------------------- */

export const EVENT_INSERT_COLUMNS = [
  'session_id',
  'stream_id',
  'seq',
  'event_uid',
  'kind',
  'actor_kind',
  'actor_user_id',
  'project_id',
  'task_id',
  'doc_uid',
  'txn_id',
  'element_id',
  'parent_event_id',
  'causal_event_id',
  'artifact_id',
  'payload_json',
  'payload_contract',
  'parts_expected',
  'parts_present',
  'provenance',
  'model_version',
  'ruleset_version',
  'occurred_at',
] as const;
// `id`, `received_at`, redaction гурвал, GENERATED (`parts_missing`, `intent`,
// `sheet_uid`, `rule_id`, `feedback`, `progress_entry_id`) → bind = 0.
export const EVENT_BINDS = EVENT_INSERT_COLUMNS.length; // = 23
export const EVENT_ROWS_PER_STATEMENT = rowsPerStatement(EVENT_BINDS); // = 4

/**
 * `txn_id`, `parent_event_id`, `causal_event_id` — гурвуулаа ДЭД АСУУЛГА.
 *
 * ⚠️ ЯЛГАА (0205-ын толгой): энд `txn_id` нь NULLABLE тул дэд асуулга NULL
 *    буцаавал мөр ОРНО, багц унахгүй.  Тэр нь ЗӨВ — вэб талын батлалт,
 *    дүрмийн дүгнэлт зэрэг Revit гүйлгээгүй үйл явдал ХЭВИЙН.  ГЭХДЭЭ
 *    клиент гүйлгээ ЗААХААР зорьсон атлаа олдоогүй тохиолдол ЧИМЭЭГҮЙ
 *    өнгөрөх ЁСГҮЙ: `presentPartsForEvent` нь тэр үед AI_CAUSE(16) битийг
 *    `parts_present`-ээс УНТРААНА (`resolvedTxnUids`-ээр урьдчилан шийднэ),
 *    улмаар `parts_missing` (0209) түүнийг илрүүлнэ.
 */
export const EVENT_VALUES_TUPLE =
  '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ' +
  '(SELECT id FROM revit_transactions WHERE txn_uid = ?), ?, ' +
  '(SELECT id FROM learning_events WHERE event_uid = ?), ' +
  '(SELECT id FROM learning_events WHERE event_uid = ?), ' +
  '?, ?, ?, ?, ?, ?, ?, ?, ?)';

/**
 * `IN (...)`-д нэг statement-д хийх id/uid-ийн дээд тоо.
 * `routes/revit.ts:75`-ийн `IDS_PER_STATEMENT = 50` заншил.
 */
export const UIDS_PER_LOOKUP = 50;

/* ================================================================== */
/*  5. МӨРИЙН ХЭЛБЭРҮҮД                                                */
/* ================================================================== */

export interface BimSessionRow {
  session_uid: string;
  user_id: number;
  project_id: number | null;
  revit_document_id: number | null;
  doc_uid: string | null;
  doc_title: string;
  is_link: 0 | 1;
  central_path_hash: string | null;
  machine_hash: string | null;
  worksharing: string | null;
  revit_version: string;
  revit_build: string | null;
  addin_version: string;
  addin_channel: string;
  model_version: string | null;
  prompt_version: string | null;
  ruleset_version: string | null;
  capture_schema: number;
  capture_policy: string;
  notice_version: string;
  started_at: string;
  ended_at: string | null;
  client_tz_offset_min: number | null;
  clock_skew_sec: number;
  txn_count: number;
  event_count: number;

  /**
   * КЛИЕНТ өөрөө зарласан алдагдлын ХУРИМТЛАГДСАН тоолуур (0243).
   *
   * ⚠️ Нэр нь ЗОРИУДААР `dropped_count` БИШ.  Клиент нь ЯВЖ БУЙ НИЙЛБЭРээ
   *    илгээдэг тул түүнийг MAX-аар нэгтгэнэ; сервер өөрийн татгалзлаа
   *    `bumpSessionCounters`-ээр НЭМНЭ.  Хоёр өөр дүрмийг НЭГ багана
   *    үүрч чадахгүй байсан нь 2026-09-01-нд хэмжсэн чимээгүй алдагдлын
   *    ҮНДЭС мөн (0243-ын толгойг үз): MAX(сервер=3, клиент=5) = 5,
   *    үнэн нь 8.  Энэ талбарыг `dropped_count` руу БУЦААЖ БҮҮ НЭРЛЭ.
   */
  client_dropped_count: number;

  /**
   * §48-R4-ийн дөрвөл (0217).
   *
   * ⚠️ СОНГОЛТТОЙ гэж ЗОРИУДААР зарлав.  `routes/learning.ts:479` нь энэ
   * интерфейсийг ЗААСАН ТӨРӨЛТЭЙ объектын литералаар барьдаг тул шинэ
   * ЗААВАЛ талбар нэмэх нь `tsc`-г УНАГААНА, мөн `writeBimBatch`-ийн
   * ирээдүйн дуудагч бүрийг багийн шатыг ажиллуулахыг албадана.  Дутуу
   * талбар нь `bindSession`-д NULL / анхдагч болж, схемийн `DEFAULT`-той
   * ЯГ ТААРНА (`team_confidence` 0, `team_source` 'uncertain').
   */
  team_code?: string | null;
  team_confidence?: number | null;
  team_source?: TeamSourceValue | null;
  team_last_verified?: string | null;

  /**
   * §72-ын компанийн хэмжээс (0217, ЭЗНИЙ ШИЙДВЭР Ш3).
   * ⚠️ СЕРВЕРЭЭС (`lib/requestContext.ts` `currentTenantId()`), клиентээс БИШ.
   */
  company_id?: string | null;

  /**
   * 2-4-ийн сессийн гүйцэтгэлийн хураангуй (0226).  NULL = ХЭМЖЭЭГҮЙ;
   * ХООСОН ОБЪЕКТ БИШ (0226:29-40-ийн инвариант).
   */
  perf_json?: string | null;
}

/**
 * `team_source`-ийн хаалттай олонлог.
 *
 * ⚠️ `lib/teamContext.ts`-ийн `TeamSource`-ийн ДАВХАР ЗАРЛАЛ, ЗОРИУДААР:
 * `bimEvents.ts` нь BIM-ийн бичих гарцын ЦОРЫН ГАНЦ модуль бөгөөд багийн
 * ШАТНААС (route-ийн давхарга) хамаарах ёсгүй.  Хоёр жагсаалт зөрвөл
 * `teamContext.test.ts` барина.
 */
export type TeamSourceValue =
  | 'binding'
  | 'document'
  | 'project_shares'
  | 'user_primary'
  | 'sheet_prefix'
  | 'behavior'
  | 'manual'
  | 'uncertain';

/**
 * ⚠️ ҮЙЛ ЯВДЛЫН БАГЫГ БИЧИХ МӨЧИД ХӨЛДӨӨНӨ, JOIN-ААР ШИЙДЭХГҮЙ.
 *
 * `bim_sessions.team_code` нь ОДООГИЙН төлөв.  Хэрэв `learning_events`-ийн
 * багыг `session_id`-аар JOIN хийж шийдвэл §73-ын залруулга (нэг мөрийн
 * UPDATE) нь хэдэн зуун ХӨДӨЛШГҮЙ мөрийн УТГЫГ дахин бичнэ.  0206-ын
 * триггер тэднийг ЗАСАХ БОЛОМЖГҮЙ болгодог тул энэ нь эргэлт буцалтгүй:
 * IZ-ийн дүрмээр гаргасан 400 шийдвэр маргааш «BA, гараар баталгаажсан»
 * болж, BA-гийн сургалтын корпусыг хордуулна.
 *
 * Иймд `payload_json` руу дөрвийг ХИЙНЭ: `team_code`, `team_source`,
 * `team_confidence`, `attribution_id`.  0219 нь эхний хоёрыг GENERATED
 * VIRTUAL болгож индекслэнэ — bind зардал ТЭГ.
 *
 * ⚠️ ДҮРМИЙН БАГЦГҮЙ БАГ (`MGMT` / `EZ` / `GT` — эзэн баталсан 2026-08-30)
 * нь ЭНД ЯЛГААГҮЙ: `team_code` нь тэр багийн БОДИТ код байна.  Нийцлийн
 * шалгалт алгасагдсан ч ШОШГО үлдэх ЁСТОЙ — эс бөгөөс тэр ажил БАГГҮЙ
 * корпуст ороод, дараа нь тэр багт багц зохиох үед эхлэх өгөгдөл БАЙХГҮЙ
 * болно.  ⛔ Багцгүй гэдгээр `team_code`-ыг NULL болгох нь §72-ыг ЗӨРЧИНӨ.
 *
 * ⚠️ ШИНЭ ОБЪЕКТ буцаана — оролтыг ӨӨРЧЛӨХГҮЙ (дуудагч тэр payload-ыг
 * дахин ашиглаж болно).
 */
export function stampTeam(
  payload: Record<string, unknown>,
  ctx: {
    team_code: string | null;
    team_source: TeamSourceValue;
    team_confidence: number;
    attribution_id: number | null;
  },
): Record<string, unknown> {
  return {
    ...payload,
    team_code: ctx.team_code,
    team_source: ctx.team_source,
    team_confidence: ctx.team_confidence,
    attribution_id: ctx.attribution_id,
  };
}

export interface RevitTxnRow {
  session_id: number;
  txn_uid: string;
  seq: number;
  user_id: number;
  project_id: number | null;
  op_name: string;
  op_class: OpClass;
  added_count: number;
  deleted_count: number;
  modified_count: number;
  category_json: string;
  view_uid: string | null;
  sheet_uid: string | null;
  origin: TxnOrigin;
  /** uid — дэд асуулгаар `learning_events.id` болно (NULL зөвшөөрөгдөнө). */
  cause_event_uid: string | null;
  /** uid — дэд асуулгаар `revit_transactions.id` болно (NULL зөвшөөрөгдөнө). */
  parent_txn_uid: string | null;
  parts_expected: number;
  parts_present: number;
  element_artifact_id: number | null;
  touch_rows: number;
  occurred_at: string;
}

export interface ElementTouchRow {
  /** uid — дэд асуулгаар `revit_transactions.id` болно.  NOT NULL. */
  txn_uid: string;
  session_id: number;
  user_id: number;
  project_id: number | null;
  element_id: number;
  element_uid: string | null;
  change: TouchChange;
  category: string;
  type_name: string;
  level_name: string;
  workset: string;
  host_uid: string | null;
  placement_json: string;
  params_artifact_id: number | null;
  hits: number;
  depth: number;
  occurred_at: string;
}

export interface LearningEventRow {
  session_id: number | null;
  stream_id: string;
  seq: number;
  event_uid: string;
  kind: LearningEventKind;
  actor_kind: ActorKind;
  actor_user_id: number | null;
  project_id: number | null;
  task_id: number | null;
  doc_uid: string | null;
  /** uid — дэд асуулгаар `revit_transactions.id` болно (NULL зөвшөөрөгдөнө). */
  txn_uid: string | null;
  element_id: number | null;
  parent_event_uid: string | null;
  causal_event_uid: string | null;
  artifact_id: number | null;
  payload_json: string;
  parts_expected: number;
  parts_present: number;
  provenance: Provenance;
  model_version: string | null;
  ruleset_version: string | null;
  occurred_at: string;
}

export interface BimArtifactRow {
  sha256: string;
  r2_key: string;
  media_type: string;
  kind: ArtifactKind;
  schema_tag: string;
  encoding: string;
  byte_size: number;
  item_count: number;
  session_id: number | null;
  project_id: number | null;
  uploaded_by: number | null;
}

/* ================================================================== */
/*  6. МАСК ТООЦООЛОХ — СЕРВЕР ӨӨРӨӨ, КЛИЕНТ ХУДАЛ ЗАРЛАЖ ЧАДАХГҮЙ     */
/* ================================================================== */

/**
 * Гүйлгээний `parts_expected` / `parts_present`.
 *
 * ⚠️ КЛИЕНТЭЭС АВАХГҮЙ.  Клиент юу ИЛГЭЭСНЭЭС нь сервер ургуулна —
 *    §3.4(а)-ийн «клиент худал зарлаж чадахгүй» дүрэм.
 */
export function partsForTxn(input: {
  /** Гүйлгээ элемент хөндсөн үү (added+deleted+modified). */
  elementTotal: number;
  /** Энэ flush-д тухайн гүйлгээнд харгалзах touch мөр хэдэн ирсэн. */
  touchRowsSent: number;
  /** Ирсэн touch мөрүүд БҮГД атрибуттай юу (2-р үе шат ажилласан уу). */
  touchesHaveAttrs: boolean;
  /** Сервер таслав уу (`bim.capture.elements_per_txn` / session төсөв). */
  touchesTruncated: boolean;
  /** `element_artifact_id` шийдэгдсэн үү. */
  elementArtifact: 'none' | 'declared' | 'resolved';
  /** `cause_event_uid` зарлагдсан ба шийдэгдсэн үү. */
  cause: 'none' | 'declared' | 'resolved';
}): { expected: number; present: number } {
  const expected = new Set<SatellitePart>();
  const present = new Set<SatellitePart>();

  if (input.elementTotal > 0) {
    expected.add('ELEMENT_ROWS');
    // Тасалсан бол мөрүүд ДУТУУ — «байхгүй» БИШ, «алдагдсан».
    if (input.touchRowsSent > 0 && !input.touchesTruncated) present.add('ELEMENT_ROWS');

    expected.add('ELEMENT_ATTRS');
    if (input.touchRowsSent > 0 && input.touchesHaveAttrs && !input.touchesTruncated) {
      present.add('ELEMENT_ATTRS');
    }
  }

  if (input.elementArtifact !== 'none') {
    expected.add('ELEMENT_DELTA');
    if (input.elementArtifact === 'resolved') present.add('ELEMENT_DELTA');
  }

  if (input.cause !== 'none') {
    expected.add('AI_CAUSE');
    if (input.cause === 'resolved') present.add('AI_CAUSE');
  }

  return { expected: maskOf(expected), present: maskOf(present) };
}

/**
 * Үйл явдлын `parts_expected` / `parts_present`.
 *
 * `expected` = `REQUIRED_PARTS_OF[kind]` ∪ (клиент `txn_uid` зарласан бол AI_CAUSE).
 * `present`  = тэдгээрээс агуулга/шийдэгдэлт нь БОДИТООР байгаа нь.
 */
export function partsForEvent(input: {
  kind: LearningEventKind;
  /** `artifact_id` шийдэгдсэн үү. */
  artifactResolved: boolean;
  /** Клиент `txn_uid` зарласан ба тэр нь шийдэгдэх үү. */
  txn: 'none' | 'declared' | 'resolved';
  /** `parent_event_uid` зарлагдсан ба шийдэгдэх үү. */
  parent: 'none' | 'declared' | 'resolved';
  /** Задлагдсан payload — `rule_id` / `progress_entry_id` зэргийг шалгана. */
  payload: Record<string, unknown>;
}): { expected: number; present: number } {
  const expected = new Set<SatellitePart>(REQUIRED_PARTS_OF[input.kind]);
  const present = new Set<SatellitePart>();

  if (input.txn !== 'none') {
    expected.add('AI_CAUSE');
    if (input.txn === 'resolved') present.add('AI_CAUSE');
  }

  for (const part of expected) {
    switch (part) {
      case 'VIEW_IMAGE':
      case 'ELEMENT_DELTA':
        // Зураг / ноорог / загварын агшин — байт нь R2-д, `artifact_id`-ээр.
        if (input.artifactResolved) present.add(part);
        break;
      case 'CORRECTION':
        // Залруулга нь ЗААВАЛ юуг зассанаа заана — эцэггүй залруулга
        // сургалтын жишээ болж ЧАДАХГҮЙ.
        if (input.parent === 'resolved' && has(input.payload, 'corrected_intent')) {
          present.add(part);
        }
        break;
      case 'RULE_VERDICT':
        if (has(input.payload, 'rule_id') && has(input.payload, 'passed')) present.add(part);
        break;
      case 'APPROVAL':
        if (has(input.payload, 'progress_entry_id') && has(input.payload, 'decision')) {
          present.add(part);
        }
        break;
      case 'REPORT':
        if (has(input.payload, 'progress_entry_id') || has(input.payload, 'revit_submission_id')) {
          present.add(part);
        }
        break;
      default:
        break;
    }
  }

  return { expected: maskOf(expected), present: maskOf(present) };
}

function has(payload: Record<string, unknown>, key: string): boolean {
  const v = payload[key];
  return v !== undefined && v !== null && v !== '';
}

/* ================================================================== */
/*  7. ТОПОЛОГИЙН ЧАНКЛАЛТ                                             */
/* ================================================================== */

/**
 * Багцыг statement болгон хуваахдаа, НЭГ statement дотор эцэг-хүүхэд
 * ХОЁУЛАА байхаас сэргийлнэ.
 *
 * ⚠️ ЯАГААД.  `txn_id` / `parent_event_id` / `causal_event_id` /
 *    `cause_event_id` / `parent_txn_id` бүгд ДЭД АСУУЛГААР шийдэгддэг.
 *    `db.batch()` нь statement-үүдийг ДАРААЛЛААР нь нэг гүйлгээнд
 *    ажиллуулдаг тул ӨМНӨХ statement-ийн мөрүүд харагдана.  Гэвч НЭГ
 *    multi-row `VALUES` statement дотор мөрүүд харагдах эсэх нь SQLite-ийн
 *    хэрэгжүүлэлтийн нарийн ширийн зүйл — ТҮҮНД БҮҮ ТҮШИГЛЭ.  Эцэг нь
 *    ӨМНӨХ statement-д унах баталгааг энэ функц өгнө.
 *
 * ⚠️ Хэрэв эцэг нь энэ багцад ОГТ байхгүй бол (өмнөх flush-д аль хэдийн
 *    бичигдсэн) чанклалт нөлөөлөхгүй — дэд асуулга DB-ээс олно.
 */
export function chunkTopologically<T>(
  rows: readonly T[],
  maxPerChunk: number,
  uidOf: (row: T) => string,
  parentUidsOf: (row: T) => readonly (string | null)[],
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentUids = new Set<string>();

  for (const row of rows) {
    const needsSplit =
      current.length >= maxPerChunk ||
      parentUidsOf(row).some((p) => p !== null && currentUids.has(p));
    if (needsSplit && current.length > 0) {
      chunks.push(current);
      current = [];
      currentUids = new Set<string>();
    }
    current.push(row);
    currentUids.add(uidOf(row));
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/* ================================================================== */
/*  8. БИЧИГЧҮҮД                                                       */
/* ================================================================== */

function bindArtifact(r: BimArtifactRow): unknown[] {
  return [
    r.sha256,
    // ⚠️ 0201-ийн CHECK нь 'meeting'-ээс өөр утгыг татгалзана.  `MEDIA_BUCKET`
    //    нь `GET /media/:key`-ээр ДЭЛХИЙД НЭЭЛТТЭЙ (`routes/media.ts:55`).
    'meeting',
    r.r2_key,
    r.media_type,
    r.kind,
    r.schema_tag,
    r.encoding,
    r.byte_size,
    r.item_count,
    r.session_id,
    r.project_id,
    r.uploaded_by,
  ];
}

/**
 * Артефактын мөр — АГУУЛГААР ХАЯГЛАГДСАН, идемпотент.
 *
 * ⚠️ БИЧИХ ДАРААЛЛЫН 1-Р АЛХАМ.  Байт нь R2-д аль хэдийн байх ёстой.
 * ⚠️ `bim_artifacts` нь 0206-ын append-only trigger-т багтдаг тул
 *    `DO UPDATE` ХОРИОТОЙ — `DO NOTHING` дараа нь `SELECT`.
 */
export async function insertArtifact(
  db: D1Database,
  row: BimArtifactRow,
): Promise<{ id: number; duplicate: boolean }> {
  const res = await db
    .prepare(
      `INSERT INTO bim_artifacts (${ARTIFACT_INSERT_COLUMNS.join(', ')})
       VALUES ${ARTIFACT_VALUES_TUPLE}
       ON CONFLICT (sha256) DO NOTHING`,
    )
    .bind(...bindArtifact(row))
    .run();

  const inserted = Number(res.meta?.changes ?? 0) > 0;
  const found = await db
    .prepare('SELECT id FROM bim_artifacts WHERE sha256 = ?')
    .bind(row.sha256)
    .first<{ id: number }>();

  if (!found) throw new Error('bim_artifacts: мөр INSERT-ийн дараа олдсонгүй');
  return { id: found.id, duplicate: !inserted };
}

function bindSession(r: BimSessionRow): unknown[] {
  return [
    r.session_uid,
    r.user_id,
    r.project_id,
    r.revit_document_id,
    r.doc_uid,
    r.doc_title,
    r.is_link,
    r.central_path_hash,
    r.machine_hash,
    r.worksharing,
    r.revit_version,
    r.revit_build,
    r.addin_version,
    r.addin_channel,
    r.model_version,
    r.prompt_version,
    r.ruleset_version,
    r.capture_schema,
    r.capture_policy,
    r.notice_version,
    r.started_at,
    r.ended_at,
    r.client_tz_offset_min,
    r.clock_skew_sec,
    r.txn_count,
    r.event_count,
    // `dropped_count` — ГАРГАЖ АВСАН НИЙТ ДҮН.  Эхний INSERT дээр серверийн
    // тал 0 тул клиентийн зарласан нийлбэртэй ТЭНЦҮҮ.
    r.client_dropped_count,
    // `client_dropped_count` — ижил утга, ГЭХДЭЭ өөрийн баганад.
    r.client_dropped_count,
    // §48-R4-ийн дөрвөл — дутуу бол схемийн DEFAULT-тай ЯГ ИЖИЛ утга.
    r.team_code ?? null,
    r.team_confidence ?? 0,
    r.team_source ?? 'uncertain',
    r.team_last_verified ?? null,
    // §72 — tenant id.  Дутуу бол `requestContext.DEFAULT_TENANT_ID`.
    r.company_id ?? 'default',
    // 0226 — NULL = ХЭМЖЭЭГҮЙ (ХООСОН ОБЪЕКТ БИШ).
    r.perf_json ?? null,
  ];
}

/**
 * Сессийн мөр — БИЧИХ ДАРААЛЛЫН 2-Р АЛХАМ.
 *
 * ⚠️ `bim_sessions` нь 0206-ын append-only trigger-т БАГТААГҮЙ, ЗОРИУДААР:
 *    энэ бол ХУВЬСДАГ ХЭМЖЭЭС (`last_seen_at`, тоолуурууд, `ended_at`).
 *    Бусад дөрвөн хүснэгт л өөрчлөгдөшгүй.
 *
 * ⚠️ `clock_skew_sec` нь ЗӨВХӨН ЭХНИЙ бичилтэд тавигдана — тэр нь «энэ
 *    машины цаг хэдэн секунд зөрүүтэй байсан» гэсэн БАРИМТ, дундаж биш.
 */
export async function upsertBimSession(
  db: D1Database,
  row: BimSessionRow,
): Promise<{ id: number; created: boolean }> {
  // ⚠️ `created`-ыг `meta.last_row_id`-ээр БҮҮ тодорхойл: SQLite-ийн
  //    `last_insert_rowid()` нь `DO UPDATE` салаанд ӨӨРЧЛӨГДДӨГГҮЙ тул
  //    хуучин, огт хамааралгүй утга буцаана.  Урьдчилсан SELECT нь
  //    хоёрдмол утгагүй бөгөөд хамгийн түгээмэл (сесс аль хэдийн байгаа)
  //    тохиолдолд нийт хоёрхон асуулга болно.
  const existing = await db
    .prepare('SELECT id FROM bim_sessions WHERE session_uid = ?')
    .bind(row.session_uid)
    .first<{ id: number }>();

  await db
    .prepare(
      `INSERT INTO bim_sessions (${SESSION_INSERT_COLUMNS.join(', ')})
       VALUES ${SESSION_VALUES_TUPLE}
       ON CONFLICT (session_uid) DO UPDATE SET
         last_seen_at      = datetime('now'),
         ended_at          = COALESCE(excluded.ended_at,          bim_sessions.ended_at),
         project_id        = COALESCE(excluded.project_id,        bim_sessions.project_id),
         revit_document_id = COALESCE(excluded.revit_document_id, bim_sessions.revit_document_id),
         doc_uid           = COALESCE(excluded.doc_uid,           bim_sessions.doc_uid),
         doc_title         = CASE WHEN excluded.doc_title <> '' THEN excluded.doc_title
                                  ELSE bim_sessions.doc_title END,
         -- ⚠️ ГАРЛЫН ГУРВАЛ — БИЧИГДСЭНИЙ ДАРАА ХӨДӨЛӨХГҮЙ (0202-ын толгой:
         --    «Тэднийг сесс эхлэхэд НЭГ УДАА бичээд ДАХИН БҮҮ ХӨНД … Энэ бол
         --    кодын дүрэм, DB-ийн хаалт БИШ; шалгалт нь энэ файлд»).
         --    ⇒ COALESCE-ийн АРГУМЕНТЫН ДАРААЛАЛ НЬ ЛОАД-БЕАРИНГ: ХУУЧИН утга
         --    ЭХЭНД.  COALESCE(excluded.x, …) байсан нь ирж буй ямар ч
         --    non-NULL утгыг ДАРЖ БИЧДЭГ байв — тэр үед learning_events-ийн
         --    хөдөлшгүй мөрүүд НЭГ model_version-ыг заасаар байхад сессийн
         --    мөр ӨӨР хувилбар харуулж, «энэ мөрийг ямар загвар гаргасан бэ»
         --    гэсэн асуултын ЦОРЫН ГАНЦ хариулт чимээгүй худал болно.
         --    Одоо: NULL байсныг Л нөхөж бичнэ (хожуу handshake), хэзээ ч
         --    орлуулахгүй.  revit_version / addin_version нь энэ SET
         --    жагсаалтад ОГТ БАЙХГҮЙ — тэд аль хэдийн хөндөгдөшгүй.
         model_version     = COALESCE(bim_sessions.model_version,   excluded.model_version),
         prompt_version    = COALESCE(bim_sessions.prompt_version,  excluded.prompt_version),
         ruleset_version   = COALESCE(bim_sessions.ruleset_version, excluded.ruleset_version),
         capture_policy    = excluded.capture_policy,
         notice_version    = CASE WHEN excluded.notice_version <> '' THEN excluded.notice_version
                                  ELSE bim_sessions.notice_version END,
         -- ⚠️ АЛДАГДЛЫН ХОЁР ЭХ СУРВАЛЖ — 0243.  ЭНЭ БЛОКИЙГ ЭГЭЛ БАЙДАЛД
         --    НЬ БҮҮ БУЦАА.  Өмнө нь ГАНЦ dropped_count багана байсан ба
         --    түүнийг энэ салаа MAX-аар, bumpSessionCounters нь нэмэх (+=)
         --    үйлдлээр бичдэг байв.  Хэмжсэн үр дүн (2026-09-01): сервер 3
         --    хаяад багана=3, дараа нь клиент 5 зарлаад MAX(3,5)=5 → ГУРВАН
         --    алдагдал ЧИМЭЭГҮЙ УСТСАН.  Багана нь аль ЖИЖИГ эх сурвалжийг
         --    нь шингээдэг байв.
         --
         --    Одоо: клиентийн ХУРИМТЛАГДСАН хэмжигч нь ЗӨВХӨН өөрийн
         --    баганадаа MAX-аар (клиент явж буй нийлбэрээ илгээдэг тул
         --    дахин илгээлтэд буурахгүй), сервер тал нь ЗӨВХӨН
         --    server_dropped_count-д нэмэгдэнэ.  dropped_count нь хоёр
         --    бүрэлдэхүүнээс ДАХИН БОДОГДСОН НИЙЛБЭР — SQLite нь SET-ийн
         --    баруун талыг UPDATE-ийн ӨМНӨХ мөрөөр тооцдог тул дараах хоёр
         --    мөр тууштай.  ⛔ server_dropped_count-ыг ЭНД БҮҮ ХӨНД.
         client_dropped_count = MAX(bim_sessions.client_dropped_count,
                                    excluded.client_dropped_count),
         dropped_count     = MAX(bim_sessions.client_dropped_count,
                                 excluded.client_dropped_count)
                             + bim_sessions.server_dropped_count,
         -- ⚠️ 0226: NULL нь «ХЭМЖЭЭГҮЙ» тул сүүлийн багц телеметргүй ирэхэд
         --    өмнөх хэмжилтийг АРИЛГАХ ЁСГҮЙ.
         perf_json         = COALESCE(excluded.perf_json,         bim_sessions.perf_json),
         -- ⚠️ §73-ЫН БУЦААГДАХ ЧАНАР.  Гараар БАТАЛГААЖСАН баг (manual) нь
         --    ДАРААГИЙН багц бүрт дахин тооцогдох шатны үр дүнгээр ХЭЗЭЭ Ч
         --    дарагдахгүй — эс бөгөөс инженерийн залруулга 3 секунд амьдарна.
         --    Мөн шат нэр дэвшигч ГАРГААГҮЙ (NULL) үед хуучин сайн утга
         --    хэвээр үлдэнэ: илрүүлэлт дордохгүй.
         team_code         = CASE WHEN bim_sessions.team_source = 'manual'
                                    THEN bim_sessions.team_code
                                  WHEN excluded.team_code IS NOT NULL
                                    THEN excluded.team_code
                                  ELSE bim_sessions.team_code END,
         team_confidence   = CASE WHEN bim_sessions.team_source = 'manual'
                                    THEN bim_sessions.team_confidence
                                  WHEN excluded.team_code IS NOT NULL
                                    THEN excluded.team_confidence
                                  ELSE bim_sessions.team_confidence END,
         team_source       = CASE WHEN bim_sessions.team_source = 'manual'
                                    THEN bim_sessions.team_source
                                  WHEN excluded.team_code IS NOT NULL
                                    THEN excluded.team_source
                                  ELSE bim_sessions.team_source END`,
    )
    .bind(...bindSession(row))
    .run();

  if (existing) return { id: existing.id, created: false };

  const found = await db
    .prepare('SELECT id FROM bim_sessions WHERE session_uid = ?')
    .bind(row.session_uid)
    .first<{ id: number }>();

  if (!found) throw new Error('bim_sessions: мөр upsert-ийн дараа олдсонгүй');
  return { id: found.id, created: true };
}

function bindTxn(r: RevitTxnRow): unknown[] {
  return [
    r.session_id,
    r.txn_uid,
    r.seq,
    r.user_id,
    r.project_id,
    r.op_name,
    r.op_class,
    r.added_count,
    r.deleted_count,
    r.modified_count,
    r.category_json,
    r.view_uid,
    r.sheet_uid,
    r.origin,
    r.cause_event_uid, // → (SELECT id FROM learning_events WHERE event_uid = ?)
    r.parent_txn_uid, // → (SELECT id FROM revit_transactions WHERE txn_uid = ?)
    r.parts_expected,
    r.parts_present,
    r.element_artifact_id,
    r.touch_rows,
    r.occurred_at,
  ];
}

function bindTouch(r: ElementTouchRow): unknown[] {
  return [
    r.txn_uid, // → (SELECT id FROM revit_transactions WHERE txn_uid = ?)
    r.session_id,
    r.user_id,
    r.project_id,
    r.element_id,
    r.element_uid,
    r.change,
    r.category,
    r.type_name,
    r.level_name,
    r.workset,
    r.host_uid,
    r.placement_json,
    r.params_artifact_id,
    r.hits,
    r.depth,
    r.occurred_at,
  ];
}

function bindEvent(r: LearningEventRow): unknown[] {
  return [
    r.session_id,
    r.stream_id,
    r.seq,
    r.event_uid,
    r.kind,
    r.actor_kind,
    r.actor_user_id,
    r.project_id,
    r.task_id,
    r.doc_uid,
    r.txn_uid, // → (SELECT id FROM revit_transactions WHERE txn_uid = ?)
    r.element_id,
    r.parent_event_uid, // → (SELECT id FROM learning_events WHERE event_uid = ?)
    r.causal_event_uid, // → (SELECT id FROM learning_events WHERE event_uid = ?)
    r.artifact_id,
    r.payload_json,
    // ⚠️ ГЭРЭЭНИЙ ТЭМДЭГЛЭГЭЭГ СЕРВЕР УРГУУЛНА — клиент худал зарлаж
    //    чадахгүй.  DB-ийн `CHECK (payload_contract GLOB 'v[0-9]*:*')`.
    contractTag(r.kind),
    r.parts_expected,
    r.parts_present,
    r.provenance,
    r.model_version,
    r.ruleset_version,
    r.occurred_at,
  ];
}

export interface BimBatchInput {
  txns: readonly RevitTxnRow[];
  touches: readonly ElementTouchRow[];
  events: readonly LearningEventRow[];
}

export interface BimWriteResult {
  /** ҮНЭХЭЭР шинээр орсон мөр (`meta.changes`-ийн нийлбэр), хүснэгтээр. */
  accepted: { txns: number; touches: number; events: number };
  /** `ON CONFLICT … DO NOTHING`-ээр чимээгүй алгассан — дахин илгээлт, ХЭВИЙН. */
  duplicates: { txns: number; touches: number; events: number };
  /** Мөр тус бүрийн fallback-д ч орж чадаагүй — ЭМГЭГ.  `server_dropped_count`-д нэмнэ. */
  dropped: { txns: number; touches: number; events: number };
  /** Багц унаж мөр тус бүрийн fallback ажилласан эсэх (лог/health-д). */
  degraded: boolean;
  /** Fallback-д унасан мөрүүдийн шалтгаан — дээд тал нь 20, оношлогоонд. */
  failures: Array<{ table: string; uid: string; message: string }>;
}

function emptyCounts(): { txns: number; touches: number; events: number } {
  return { txns: 0, touches: 0, events: 0 };
}

type TableKey = 'txns' | 'touches' | 'events';

interface PlannedStatement {
  table: TableKey;
  /** Олон мөрийн statement — багцын хурдан зам. */
  sql: string;
  /**
   * ЯГ НЭГ мөрийн statement — мөр тус бүрийн fallback-д.
   * ⚠️ Энд угсарна, fallback дотор SQL-ийг ЗАСВАРЛАХГҮЙ: regex-ээр
   *    `VALUES` цувааг солих нь дэд асуулга доторх хаалт/таслалд амархан
   *    цуцарна.  Хоёр хувилбарыг НЭГ газраас, ижил тогтмолоор угсарна.
   */
  sqlOne: string;
  chunk: readonly unknown[][];
  uids: readonly string[];
}

/** Нэг хүснэгтийн INSERT-ийг N мөрөөр угсарна (N = 1 бол fallback хувилбар). */
function buildInsert(
  columns: readonly string[],
  table: string,
  tuple: string,
  conflict: string,
  rows: number,
): string {
  return (
    `INSERT INTO ${table} (${columns.join(', ')})\n` +
    `VALUES ${Array.from({ length: rows }, () => tuple).join(', ')}\n` +
    `ON CONFLICT ${conflict} DO NOTHING`
  );
}

/**
 * БИЧИХ ДАРААЛЛЫН 3-Р АЛХАМ — НЭГ `db.batch()`:
 *   revit_transactions → revit_element_touches → learning_events.
 *
 * ⚠️ ЭНЭ ДАРААЛАЛ ГЭРЭЭ (0205).  Дэд асуулгууд өмнөх statement-ийн мөрийг
 *    л олж чадна.
 *
 * ⚠️ ЗААВАЛ БИЕЛҮҮЛЭХ FALLBACK (0203-ын толгой).  `db.batch()` нь НЭГ
 *    гүйлгээ тул НЭГ муу мөр 200 мөрийн багцыг БҮХЭЛД НЬ унагаана.  Add-in-д
 *    АЛБАДАН ШИНЭЧЛЭХ МЕХАНИЗМ БАЙХГҮЙ (~20 ширээ, `Install.bat`, Revit
 *    хаалттай) тул давтагдах 500 нь АЛСААС СЭРГЭЭХ БОЛОМЖГҮЙ гогцоо болно.
 *    ⇒ Багц унавал МӨР ТУС БҮРЭЭР дахин оролдож, зөрчилтэйг нь тоолж,
 *      үлдсэнийг нь бичнэ.  Тэр fallback-гүйгээр `UNIQUE(session_id, seq)`
 *      индексийг шиплэх нь ХОРИОТОЙ.
 */
export async function writeBimBatch(
  db: D1Database,
  input: BimBatchInput,
): Promise<BimWriteResult> {
  const planned: PlannedStatement[] = [];

  // ---- 1) revit_transactions ---------------------------------------
  // Эцэг нь `parent_txn_uid`; `cause_event_uid` нь ӨМНӨХ flush-ийн үйл
  // явдал (ижил flush-ийн үйл явдал нь ЭНЭ statement-ээс ХОЙШ бичигдэнэ —
  // тиймээс тэр нь шийдэгдэхгүй ба AI_CAUSE бит унтарсан байна).
  for (const chunk of chunkTopologically(
    input.txns,
    TXN_ROWS_PER_STATEMENT,
    (r) => r.txn_uid,
    (r) => [r.parent_txn_uid],
  )) {
    planned.push({
      table: 'txns',
      sql: buildInsert(
        TXN_INSERT_COLUMNS,
        'revit_transactions',
        TXN_VALUES_TUPLE,
        '(txn_uid)',
        chunk.length,
      ),
      sqlOne: buildInsert(
        TXN_INSERT_COLUMNS,
        'revit_transactions',
        TXN_VALUES_TUPLE,
        '(txn_uid)',
        1,
      ),
      chunk: chunk.map(bindTxn),
      uids: chunk.map((r) => r.txn_uid),
    });
  }

  // ---- 2) revit_element_touches ------------------------------------
  for (let i = 0; i < input.touches.length; i += TOUCH_ROWS_PER_STATEMENT) {
    const chunk = input.touches.slice(i, i + TOUCH_ROWS_PER_STATEMENT);
    planned.push({
      table: 'touches',
      sql: buildInsert(
        TOUCH_INSERT_COLUMNS,
        'revit_element_touches',
        TOUCH_VALUES_TUPLE,
        '(txn_id, element_id)',
        chunk.length,
      ),
      sqlOne: buildInsert(
        TOUCH_INSERT_COLUMNS,
        'revit_element_touches',
        TOUCH_VALUES_TUPLE,
        '(txn_id, element_id)',
        1,
      ),
      chunk: chunk.map(bindTouch),
      uids: chunk.map((r) => `${r.txn_uid}#${r.element_id}`),
    });
  }

  // ---- 3) learning_events ------------------------------------------
  for (const chunk of chunkTopologically(
    input.events,
    EVENT_ROWS_PER_STATEMENT,
    (r) => r.event_uid,
    (r) => [r.parent_event_uid, r.causal_event_uid],
  )) {
    planned.push({
      table: 'events',
      sql: buildInsert(
        EVENT_INSERT_COLUMNS,
        'learning_events',
        EVENT_VALUES_TUPLE,
        '(event_uid)',
        chunk.length,
      ),
      sqlOne: buildInsert(
        EVENT_INSERT_COLUMNS,
        'learning_events',
        EVENT_VALUES_TUPLE,
        '(event_uid)',
        1,
      ),
      chunk: chunk.map(bindEvent),
      uids: chunk.map((r) => r.event_uid),
    });
  }

  const sent = {
    txns: input.txns.length,
    touches: input.touches.length,
    events: input.events.length,
  };

  if (planned.length === 0) {
    return {
      accepted: emptyCounts(),
      duplicates: emptyCounts(),
      dropped: emptyCounts(),
      degraded: false,
      failures: [],
    };
  }

  const accepted = emptyCounts();

  try {
    const results = await db.batch(
      planned.map((p) => db.prepare(p.sql).bind(...p.chunk.flat())),
    );
    results.forEach((res, i) => {
      const p = planned[i];
      if (!p) return;
      accepted[p.table] += Number(res.meta?.changes ?? 0);
    });
    return {
      accepted,
      duplicates: {
        txns: sent.txns - accepted.txns,
        touches: sent.touches - accepted.touches,
        events: sent.events - accepted.events,
      },
      dropped: emptyCounts(),
      degraded: false,
      failures: [],
    };
  } catch (err) {
    // ⚠️ Багц бүхэлдээ унав.  Хамгийн магадлалтай шалтгаан нь
    //    `UNIQUE(session_id, seq)` / `UNIQUE(stream_id, seq)` зөрчил
    //    (клиентийн тоолуур эвдэрсэн) эсвэл эцэггүй touch мөр.
    console.warn(
      '[bimEvents] багц унав, мөр тус бүрээр дахин оролдож байна:',
      err instanceof Error ? err.message : String(err),
    );
    return await writeRowByRow(db, planned, sent);
  }
}

/**
 * Мөр тус бүрийн fallback.  ⚠️ Дараалал нь БАГЦЫНХТАЙ ИЖИЛ байх ЁСТОЙ —
 * эцэг statement нь хүүхдийнхээс өмнө ажиллана.  `chunk` нь мөрийн массив
 * тул нэг мөрийн statement-ийг дахин угсарна.
 */
async function writeRowByRow(
  db: D1Database,
  planned: readonly PlannedStatement[],
  sent: { txns: number; touches: number; events: number },
): Promise<BimWriteResult> {
  const accepted = emptyCounts();
  const dropped = emptyCounts();
  const failures: BimWriteResult['failures'] = [];

  for (const p of planned) {
    for (let i = 0; i < p.chunk.length; i++) {
      const binds = p.chunk[i];
      const uid = p.uids[i] ?? '?';
      if (!binds) continue;
      try {
        const res = await db.prepare(p.sqlOne).bind(...binds).run();
        accepted[p.table] += Number(res.meta?.changes ?? 0);
      } catch (err) {
        dropped[p.table] += 1;
        if (failures.length < 20) {
          failures.push({
            table: p.table,
            uid,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  return {
    accepted,
    duplicates: {
      txns: Math.max(0, sent.txns - accepted.txns - dropped.txns),
      touches: Math.max(0, sent.touches - accepted.touches - dropped.touches),
      events: Math.max(0, sent.events - accepted.events - dropped.events),
    },
    dropped,
    degraded: true,
    failures,
  };
}

/**
 * БИЧИХ ДАРААЛЛЫН 4-Р АЛХАМ — сессийн тоолуур.
 *
 * ⚠️ `bim_sessions` нь append-only БИШ (0206-д ороогүй), тиймээс энэ нь
 *    зөвшөөрөгдсөн ЦОРЫН ГАНЦ UPDATE.  Бусад дөрвөн хүснэгтэд UPDATE
 *    хийх оролдлого нь `RAISE(ABORT)` өгнө.
 */
export async function bumpSessionCounters(
  db: D1Database,
  sessionId: number,
  delta: { txns: number; events: number; dropped: number; endedAt?: string | null },
): Promise<void> {
  await db
    .prepare(
      // ⚠️ 0243.  `delta.dropped` нь СЕРВЕРИЙН талын татгалзал — ЗӨВХӨН
      //    `server_dropped_count` руу НЭМЭГДЭНЭ.  `dropped_count` нь хоёр
      //    бүрэлдэхүүнээс ДАХИН БОДОГДОНО (`client + server_шинэ`), тиймээс
      //    клиентийн хэмжигчийг ХЭЗЭЭ Ч дарж бичихгүй бөгөөд хэрэв ямар нэг
      //    шалтгаанаар зөрсөн бол энэ бичилт ӨӨРӨӨ ЗАСНА.
      //    ⛔ `dropped_count = dropped_count + ?` руу БҮҮ БУЦАА: тэр нь
      //    upsert-ийн MAX-тай мөргөлдөж, алдагдлыг чимээгүй устгана.
      `UPDATE bim_sessions
          SET last_seen_at  = datetime('now'),
              txn_count     = txn_count   + ?,
              event_count   = event_count + ?,
              server_dropped_count = server_dropped_count + ?,
              dropped_count = client_dropped_count + server_dropped_count + ?,
              ended_at      = COALESCE(?, ended_at)
        WHERE id = ?`,
    )
    .bind(
      delta.txns,
      delta.events,
      delta.dropped,
      delta.dropped,
      delta.endedAt ?? null,
      sessionId,
    )
    .run();
}

/* ================================================================== */
/*  9. UID → id ШИЙДВЭРЛЭГЧ (маск тооцоолохын ӨМНӨ хэрэгтэй)          */
/* ================================================================== */

/**
 * Аль `txn_uid`-ууд DB-д АЛЬ ХЭДИЙН байгаа вэ.
 *
 * ⚠️ Энэ нь `parts_present`-ийг ЭХНИЙ БИЧИЛТЭД зөв тавихад хэрэгтэй:
 *    клиент гүйлгээ ЗААХААР зорьсон атлаа олдоогүй бол AI_CAUSE бит
 *    УНТРААНА.  Append-only тул хожим засах боломж БАЙХГҮЙ.
 */
export async function resolveExistingUids(
  db: D1Database,
  table: 'revit_transactions' | 'learning_events',
  column: 'txn_uid' | 'event_uid',
  uids: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Set(uids)];
  for (let i = 0; i < unique.length; i += UIDS_PER_LOOKUP) {
    const chunk = unique.slice(i, i + UIDS_PER_LOOKUP);
    const rows = await db
      .prepare(
        `SELECT ${column} AS uid FROM ${table}
          WHERE ${column} IN (${chunk.map(() => '?').join(', ')})`,
      )
      .bind(...chunk)
      .all<{ uid: string }>();
    for (const r of rows.results ?? []) out.add(r.uid);
  }
  return out;
}
