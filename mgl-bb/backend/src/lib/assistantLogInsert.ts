/**
 * `assistant_logs`-ийн БАГЦ INSERT-ийн ГЭРЭЭ (contract).
 *
 * ⚠️ ЯАГААД ТУСДАА ФАЙЛ ВЭ: өмнө нь баганын жагсаалт, `?` кортеж ба нэг
 * мөрөнд ногдох bind-ийн тоо гурав нь `routes/revit.ts`-д ГУРВАН тусдаа
 * газар ГАРААР бичигдэж байсан бөгөөд тэднийг холбосон ЮУ Ч байгаагүй.
 * Тайлбар нь тогтмолоосоо ӨӨР тоо хэлж байсан («12 bind → 8 мөр» гэж
 * бичээд `const BINDS = 13` байсан) — 0200-ийн `feedback_note` нэмэгдэхэд
 * тогтмол засагдаж, тайлбар нь хоцорсны үлдэгдэл.
 *
 * `tsc` энэ төрлийн зөрүүг БАРИХГҮЙ.  Алдаа нь зөвхөн ЭХНИЙ БҮТЭН БАГЦ
 * (`PER`-ээс олон мөр) дээр, D1-ийн runtime bind-count алдаа болж гарна —
 * эмхэтгэл ногоон хэвээр, тест байхгүй.  Одоо гурвуулаа ЭНЭ ЖАГСААЛТААС
 * гарна: багана нэмэх нь мөр/statement-ийн тоог ӨӨРӨӨ бууруулна, гараар
 * засах тоо БАЙХГҮЙ.  Нийцлийг `assistantLogInsert.test.ts` барина.
 *
 * ⚠️ Энэ модуль ЯМАР Ч ИМПОРТГҮЙ, цэвэр байх ёстой — тест нь `registerHooks`
 * шаардахгүй шууд статик импорт хийдэг (`lib/leaveOverlap.ts`-тэй ижил хэв маяг).
 *
 * ⚠️ `routes/revit.ts:59`-ийн `BINDS_PER_BINDING_ROW` бол ӨӨР INSERT-ийнх
 * (`revit_sheet_bindings`).  Нэрний төстэй байдал нь урхи — бүү холь.
 */

/** D1-ийн ХАТУУ хязгаар: нэг statement-д дээд тал нь 100 bind параметр. */
export const D1_MAX_BINDS = 100;

/**
 * INSERT-ийн багана, ЯГ ЭНЭ дарааллаар.  `routes/revit.ts`-ийн bind массив
 * мөн ЯГ ЭНЭ дарааллаар түлхэгдэх ЁСТОЙ.
 */
export const ASSISTANT_LOG_COLUMNS = [
  'user_id',
  'project_id',
  'doc_uid',
  'revit_version',
  'text',
  'predicted',
  'confidence',
  'decided_by',
  'corrected',
  'feedback',
  'acted',
  'client_id',
  'feedback_note',
  // --- 0212_assistant_log_provenance.sql (ГАРАЛ ҮҮСЭЛ) ---
  'model_version',
  'addin_version',
  'client_ts',
  // --- 0216_assistant_log_timing.sql (ХЭМЖИЛТ / 1C) ---
  // ⚠️ НЭГ багана, 12 БИШ.  Add-in 12 хугацааны талбар илгээдэг ч тэднийг
  //    тус тусад нь багана болговол нэг мөрөнд ногдох bind 16 -> 28 болж,
  //    statement тутмын мөр 6 -> 3 болно (D1-ийн 100 bind).  `assistant_logs`
  //    бол ӨНДӨР ЭЗЛЭХҮҮНТЭЙ хүснэгт бөгөөд INSERT нь БАГЦААР явдаг тул тэр
  //    нь round trip-ийг ХОЁР ДАХИН нэмнэ.  Шийдэл: нэг `timing_json`, ба
  //    ХАЛУУН гурван скаляр (`t_total_ms`, `route_layer`, `exit_path`) нь
  //    миграцид `GENERATED ALWAYS AS (json_extract(...)) VIRTUAL` — SQL талд
  //    жинхэнэ багана мэт индекслэгдэнэ, INSERT-ийн bind төсөгт ОРОХГҮЙ.
  'timing_json',
  // --- 0238_assistant_team_scope.sql (БАГИЙН ХАМРАХ ХҮРЭЭ / 2-6) ---
  // ⚠️ СЕРВЕР БӨГЛӨНӨ, КЛИЕНТ ЗАРЛАХГҮЙ.  Утга нь `user.sub` →
  //    `user_teams WHERE is_primary = 1` → `teams.code`.  Add-in-аас
  //    `team_code` хүлээж авбал BA-гийн инженер өөрийгөө IZ гэж зарлаад
  //    IZ-ийн корпусыг бохирдуулж чадна — `deriveSourceType`-ийн G1
  //    гэрээний ЯГ ИЖИЛ шалтгаан.
  // ⚠️ NULL = КОМПАНИ ДАЯАР / баг тодорхойлогдоогүй.  ТААМАГЛАХГҮЙ.
  // ⚠️ BIND: 17 → 18 → floor(100/18) = 5 мөр — ӨӨРЧЛӨГДӨХГҮЙ, тиймээс
  //    ingest-ийн бүтээмжид ТЭГ зардал.  ⛔ ДӨРӨВ ДЭХ бодит багана
  //    (21 bind) нь floor(100/21) = 4 болж round trip-ийг 25% нэмнэ —
  //    тэр босгонд хүрвэл `timing_json`-ы загвараар JSON + GENERATED
  //    VIRTUAL ашигла.
  'team_code',
] as const;

/** Нэг мөрөнд ногдох bind. */
export const ASSISTANT_LOG_BINDS = ASSISTANT_LOG_COLUMNS.length;

/**
 * Нэг statement-д багтах мөрийн тоо.
 * ⚠️ Багана нэмэхэд ЭНЭ ТОО ӨӨРӨӨ буурна — гараар засах зүйл БАЙХГҮЙ.
 * 18 багана → floor(100 / 18) = 5 мөр → 90 bind ≤ 100.
 */
export const ASSISTANT_LOG_ROWS_PER_STATEMENT = Math.floor(
  D1_MAX_BINDS / ASSISTANT_LOG_BINDS,
);

/** `(?, ?, …)` — уртыг нь баганын тооноос гаргана, гараар бичихгүй. */
export const ASSISTANT_LOG_TUPLE = `(${ASSISTANT_LOG_COLUMNS.map(() => '?').join(', ')})`;

/** `INSERT INTO assistant_logs (…)`-ийн баганын жагсаалт. */
export const ASSISTANT_LOG_COLUMN_SQL = ASSISTANT_LOG_COLUMNS.join(', ');

/* ================================================================== */
/*  ХУГАЦААНЫ ТЕЛЕМЕТР — `timing_json`-ийн ГЭРЭЭ (0216 / Track 1C)     */
/* ================================================================== */

/**
 * Тоон (мс) талбарууд.  Нэрс нь `revit-mcp/addin/AssistantLog.cs:66-105`-ийн
 * `[JsonPropertyName]`-уудтай ЯГ ТААРНА — C# тал нь ӨӨР сессийн эзэмшилд тул
 * ЭНД зөвхөн хуулбарлана, ТЭНД засахгүй.
 *
 * ⚠️ Энэ жагсаалт нь `assistant_logs`-ийн БАГАНА БИШ.  Эдгээр нь нэг
 *    `timing_json` баганын дотор JSON түлхүүр болж сууна; зөвхөн
 *    `t_total_ms` нь 0216-д GENERATED VIRTUAL багана болж гарна.
 */
export const ASSISTANT_TIMING_NUMERIC = [
  't_total_ms',
  't_route_ms',
  't_model_load_ms',
  't_tool_total_ms',
  't_tool_queue_ms',
  't_tool_event_ms',
  't_tool_exec_ms',
  't_agent_ttft_ms',
  't_agent_total_ms',
] as const;

/**
 * Текст талбарууд (АНГИЛАЛ, чөлөөт бичвэр БИШ).
 * `route_layer` = keyword|model|fallback · `exit_path` = empty|busy|pending|
 * fallback|acted · `model_load_source` = local|embedded|none.
 *
 * ⚠️ ЭДГЭЭР УТГЫГ ЖАГСААЛТААР ШАЛГАХГҮЙ — ЗОРИУД.  Add-in шинэ давхарга
 *    эсвэл шинэ гарц нэмэхэд тэр утга ЧИМЭЭГҮЙ АЛГА БОЛОХ нь хэмжилтийн
 *    хамгийн муу төрлийн алдаа (яг одоо бид түүнээс болж энэ миграцыг
 *    бичиж байна).  Тиймээс зөвхөн УРТААР таслана, утгыг нь дамжуулна.
 */
export const ASSISTANT_TIMING_TEXT = [
  'route_layer',
  'exit_path',
  'model_load_source',
] as const;

/** Ангиллын шошгын дээд урт — DB-д хог урт мөр орохоос сэргийлнэ. */
export const ASSISTANT_TIMING_TAG_MAX = 24;

/** Add-in-ы илгээдэг хугацааны талбарын НИЙТ тоо (одоогоор 12). */
export const ASSISTANT_TIMING_FIELDS = [
  ...ASSISTANT_TIMING_NUMERIC,
  ...ASSISTANT_TIMING_TEXT,
] as const;

/**
 * Түүхий бүртгэлийн объектоос `timing_json`-ийн утгыг ургуулна.
 *
 * ⚠️ NULL vs '{}' — ЭНЭ ФУНКЦ ТЭР ЯЛГААГ БАРИНА (0216-ийн толгойн шийдвэр):
 *      null      = ХЭМЖЭЭГҮЙ (телеметргүй хуучин add-in, эсвэл 0216-аас
 *                  өмнөх мөр).  ЭНД: нэг ч хүчинтэй талбар олдоогүй.
 *      '{...}'   = add-in ХЭМЖСЭН.  Дотор нь дутуу түлхүүр байвал тэр нь
 *                  «тэр үе шат БОЛООГҮЙ» гэсэн утгатай (ж. `t_agent_ttft_ms`
 *                  нь streaming БУС алсын эргэлт дээр байхгүй).
 *    ХООСОН ОБЪЕКТ ('{}') буцаах ЗАМ БАЙХГҮЙ — тэр нь дээрх хоёр утгыг
 *    ЯЛГАГДАХГҮЙ болгоно.  0216-ийн CHECK нь '{}'-ыг татгалзахгүй тул
 *    инвариантыг ЭНД барина.
 *
 * ⚠️ ТООГ ЗАСАХГҮЙ, зөвхөн ТАТГАЛЗАНА (`isoTs`-тэй ижил зарчим).  Хүлээж
 *    авах нөхцөл: ЖИНХЭНЭ number, finite, СӨРӨГ БИШ.  Мөр хэлбэртэй тоо
 *    ("241.5") ч татгалзана — хэмжүүрийн баганад төрлийн хольц орох нь
 *    дараагийн бүх агрегацыг чимээгүй эвдэнэ.  Сөрөг үргэлжлэх хугацаа нь
 *    физикийн хувьд боломжгүй ⇒ хэмжигчийн алдаа, p95-д ОРОХ ЁСГҮЙ.
 *
 * ⚠️ Мөрийг ХЭЗЭЭ Ч ТАТГАЛЗАХГҮЙ — зөвхөн энэ талбарыг NULL болгоно.
 *    `AssistantLog.cs:58-60`: бүртгэл нь чат ажиллахад саад болох ЁСГҮЙ.
 */
export function buildTimingJson(src: Record<string, unknown>): string | null {
  const out: Record<string, number | string> = {};
  let n = 0;

  for (const key of ASSISTANT_TIMING_NUMERIC) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[key] = v;
      n++;
    }
  }
  for (const key of ASSISTANT_TIMING_TEXT) {
    const v = src[key];
    if (typeof v !== 'string') continue;
    const t = v.trim().slice(0, ASSISTANT_TIMING_TAG_MAX);
    if (t.length === 0) continue;
    out[key] = t;
    n++;
  }

  return n === 0 ? null : JSON.stringify(out);
}
