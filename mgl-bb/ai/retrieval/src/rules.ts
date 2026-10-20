/**
 * MGL AI · ДЕТЕРМИНИСТ ДҮРМИЙН ХӨДӨЛГҮҮР (§11-ийн «deterministic rule/calculation»).
 *
 * ⚠️ ЗАГВАР НЬ ТООЦООЛОГЧ БИШ.  «299 м² уу, 300 м² уу», «15 хоног уу, 16 уу»
 *    гэсэн шийдвэр нь КОД байх ёстой, өгүүлбэрээр сэтгэсэн үр дүн БИШ.  4B
 *    загвар нь «1.0 тэрбумаас ДЭЭШ» гэсэн өгүүлбэрийг уншаад яг 1.0 тэрбумыг
 *    багтаах нь ажиглагдсан загварын алдаа — мэргэжлийн баримтад хүлээн
 *    зөвшөөрөгдөхгүй.  Тиймээс харьцуулалт БҮГД энд, JS-д хийгдэнэ.
 *
 * ⚠️ НӨХЦӨЛ НЬ НЭРЛЭСЭН, ЗОРИУД.  Эхний хувилбар нь `guat`/`gmdh` гэсэн ХОЁР
 *    ХАТУУ талбартай байсан — тэр нь БНбД 21-04-05 (гал унтраах) баримтын
 *    хэлбэр.  УББ 12-01-01 (захиалагчийн дүрэм) ирэхэд тэр загвар ТААРААГҮЙ:
 *    түүний дүрэм нь «бие даасан алба заавал байгуулна» гэсэн ГАНЦ нэрлэсэн
 *    үр дагавартай.  Хоёр баримтад хоёр хөдөлгүүр барих нь босгын логикийг
 *    ХОЁР ДАХИН бичих гэсэн үг — тэр нь яг л алдаа гарах газар.  Тиймээс
 *    нөхцөл нь `{key, cond}` жагсаалт: гал нь ['GUAT','GMDH'], УББ нь
 *    ['independent_client_office_mandatory'] гэх мэт.
 *
 * ⚠️ БАТАЛГААЖИЛТЫН ХААЛГА.  `needs_human_review` дүрэм нь ХАЙГДАНА
 *    (ажилтан эх сурвалжийг үзэж болно) ч ЭРХ БҮХИЙ хариу болж
 *    ГҮЙЦЭТГЭГДЭХГҮЙ.  Энэ файлын хамгийн чухал ганц баталгаа: unverified
 *    дүрэм ХЭЗЭЭ Ч `verified` төлөв үүсгэхгүй.  `evaluation/norm-golden.mjs`
 *    үүнийг «leakage = 0» гэж хэмжинэ.
 *
 * ⚠️ ДУТУУ НӨХЦӨЛ НЬ АЛДАА БИШ.  Талбайг нь мэдэхгүй бол «шаардлагагүй»
 *    гэж хариулах нь ХАМГИЙН АЮУЛТАЙ гаралт.  `missing` төлөв нь
 *    pipeline-ыг «зөвхөн дутуу талбарыг асуу» руу шилжүүлнэ (§11).
 */

/**
 * ⚠️ `=` НЬ БНбД 11-03-21 (2026-09-10) ИРЭХЭД НЭМЭГДСЭН.  Тэр баримт
 *    «1 м тутамд температур хэмжинэ», «дундаж гүн 8 м» гэсэн ЗАРЛАСАН
 *    утгыг `operator: "="` гэж өгдөг.  Түүнийг `between [v, v]` болгож
 *    тойрох нь ажилладаг ч эх сурвалжийн утгыг гажуудуулна — нөхцөлийн
 *    текст «8–8 м» болно.  Тиймээс ил нэмэв.  Тэнцүү нь ЯГ тэнцүү:
 *    0.5 м-ийн алхамд 0.6 м нь ХАНГАХГҮЙ — «ойролцоо» гэсэн зөөлрүүлэлт
 *    хийвэл яг энэ хөдөлгүүрийн оршин байх шалтгаан алдагдана.
 */
export type Comparator = '>' | '>=' | '<' | '<=' | '=' | 'between';

/** Нэг нэрлэсэн нөхцөл. */
export interface RuleCondition {
  required: boolean;
  /** `all` = нөхцөлгүй.  `external_norm` = өөр нормд шилжүүлнэ. */
  kind: string;
  comparator: Comparator | null;
  value: number | [number, number] | null;
  unit: string | null;
  condition_text_mn: string | null;
  /**
   * Уншиж болох контекстийн талбарын НЭР.
   *
   * ⚠️ УББ багц нь талбараа ӨӨРӨӨ нэрлэдэг (`annual_investment_mnt`), БНбД
   *    багц нь `kind`-аар (`area` → `area_m2`) илэрхийлдэг.  Хоёуланг нь
   *    дэмжинэ: `field` байвал тэр нь давуу, байхгүй бол `kind`-аас гаргана.
   */
  field?: string | null;
}

/** Дүрмийн ангилал — эшлэл ба UI-д хэрэгтэй. */
export type RuleKind =
  | 'table_row'
  | 'threshold'
  | 'deadline'
  | 'obligation'
  | 'right'
  | 'responsibility'
  /**
   * ⚠️ УББ-11-201-00 (аргачилсан заавар) ирэхэд НЭМЭГДСЭН.  Түүний 71
   *    заалт нь «хэн юу хийх ёстой» гэсэн deontic дүрэм БИШ:
   *    зорилго тунхаглах (1.1), төслийн бүрдэл жагсаах (3.1),
   *    бүтцийг тогтоох (4.1), хэрэгжүүлэх арга хэмжээ нэрлэх (6.1).
   *    Тэднийг `obligation` гэж тэмдэглэвэл хоолой «Эх сурвалжид заасан
   *    үүрэг» гэж хэлэх ба тэр нь зорилгын тунхаг дээр ХУДАЛ болно.
   *    Тиймээс адаптераар ТОЙРОХ биш, ойлголтыг ил нэмэв.
   */
  | 'requirement';

export interface NormRule {
  rule_id: string;
  chunk_id: string;
  doc_id: string;
  rule_kind: RuleKind;
  table_no: number | null;
  row_no: string | null;
  clause_no: string | null;
  page: number | null;
  section: string | null;
  /** Юуны тухай дүрэм вэ — объект (барилга) эсвэл субъект (захиалагч). */
  object_mn: string;
  object_latin: string | null;
  /** ⚠️ Хэн үүрэг хүлээх вэ.  УББ-д гол ялгуур; БНбД-д `null`. */
  actor: string | null;
  required_context: string[];
  /** Нэрлэсэн нөхцөлүүд.  ХООСОН байж БОЛНО (үүрэг, эрх нь тоон бус). */
  conditions: Array<{ key: string; cond: RuleCondition }>;
  aliases_mn: string[];
  aliases_latin: string[];
  aliases_en: string[];
  decision_policy: string;
  citation_required: boolean;
  verification_status: string;
  notes: string[];
}

/** Нэг нөхцөлийн үнэлгээний үр дүн. */
export type ConditionOutcome =
  | { state: 'required'; because: string | null }
  | { state: 'not_required'; because: string | null }
  | { state: 'missing'; needs: string[] }
  | { state: 'external_norm'; because: string | null };

export interface RuleDecision {
  rule_id: string;
  /** ⚠️ `blocked_unverified` нь энэ дүрмээр хариулж БОЛОХГҮЙ гэсэн үг. */
  status: 'evaluated' | 'missing_context' | 'blocked_unverified' | 'no_conditions';
  /** Нэрлэсэн үр дүн — `{GUAT: …, GMDH: …}` эсвэл `{independent_client_office_mandatory: …}`. */
  outcomes: Record<string, ConditionOutcome>;
  /** Үнэлгээнд БОДИТООР хэрэглэсэн утга — аудитын мөр. */
  inputs_used: Record<string, number | string | boolean>;
  /** Дутуу талбарууд — UI нь ЗӨВХӨН эдгээрийг асууна. */
  missing_context: string[];
  /**
   * НИЙЛМЭЛ дүрмийн нэгдсэн үр дүн — БҮХ нөхцөл хангагдсан уу.
   * ⚠️ Зөвхөн `decision_policy` нь `evaluate_all_conditions…` дүрэмд (УББ
   *    12-204-01 4.3: тоо + хоёр үнэн/худал).  Гал түймрийн ГУАТ/ГМДХ нь
   *    АЛЬ НЭГ нь шаардагддаг хос — тэдэнд «бүгд» гэсэн нэгтгэл утгагүй тул
   *    өгөгдмөлөөр ҮҮСГЭХГҮЙ.  Нэг нь ч `null` бол `null` (шийдэгдээгүй).
   */
  all_conditions?: boolean | null;
}

/**
 * ⚠️ `kind` → контекстийн талбарын НЭР.  Дараалал нь ДЭД СОНГОЛТТОЙ:
 *    эхнийх нь олдохгүй бол дараагийнх.  Багцад «power» нь заримдаа
 *    `power_mva`, заримдаа `transformer_power_mva` гэж нэрлэгддэг —
 *    хоёуланг нь хүлээж авахгүй бол трансформаторын дүрэм мөнхөд
 *    «дутуу нөхцөл» гэж хариулна.
 */
const KIND_FIELDS: Readonly<Record<string, readonly string[]>> = {
  area: ['area_m2'],
  volume: ['volume_m3', 'facility_volume_m3'],
  height: ['height_m', 'rack_height_m'],
  vehicle_count: ['vehicle_count'],
  cable_count: ['cable_count'],
  count: ['item_count', 'count'],
  voltage: ['voltage_kv'],
  power: ['power_mva', 'transformer_power_mva'],
};

/** Нөхцөлийг үнэлэхэд шаардагдах талбарын нэрс. */
export function fieldsForKind(kind: string): readonly string[] {
  return KIND_FIELDS[kind] ?? [];
}

/**
 * НЭГ ойлголтын ӨӨР НЭРНҮҮД.
 *
 * ⚠️ БАГЦ НЬ НЭГ ЗҮЙЛИЙГ ХОЁР НЭРЛЭДЭГ: «өндөр» нь `height_m` ба
 *    `rack_height_m`, «хүчин чадал» нь `power_mva` ба
 *    `transformer_power_mva`, «эзэлхүүн» нь `volume_m3` ба
 *    `facility_volume_m3`.
 *
 * ⚠️ ЭНЭ НЬ ЗӨВХӨН ҮНЭЛГЭЭНИЙ АСУУДАЛ БИШ.  2026-09-08-нд хэмжигдсэн:
 *    нормчлогчийн кирилл алдааг зассаны дараа асуултаас `height_m`
 *    гарч эхэлсэн ба нөхцөлийн хөл нь `rack_height_m` шаарддаг ЗӨВ
 *    дүрмийг «талбар дутуу» гэж ТОРГООД, буруу мөрийг дэвшүүлж
 *    эхэлсэн — mn-Cyrl-ийн дүрмийн таарц 92.9% → 78.6% болж унав.
 *    Тиймээс ижил утгыг ХАЙЛТЫН талд ч мэдэх ёстой.
 *
 * ⚠️ `voltage_v` НЬ `voltage_kv`-ТАЙ ИЖИЛ БИШ — 660 В ба 660 кВ нь мянга
 *    дахин ялгаатай.  Тэднийг ижилтгэх нь нормыг ГЭМТЭЭНЭ.
 */
const FIELD_ALIASES: ReadonlyArray<readonly string[]> = [
  ['height_m', 'rack_height_m'],
  ['volume_m3', 'facility_volume_m3'],
  ['power_mva', 'transformer_power_mva'],
  ['item_count', 'count'],
  // ⚠️ БНбД 11-03-21-ийн ӨӨРИЙН алтан кейсүүд нэг ойлголтыг хоёр нэрлэдэг:
  //    4.8-д `sample_percent`, 5.6-д `sampled_percent`.  Хоёулаа «цооног,
  //    малталтын хэдэн хувиас дээж авсан бэ».  Нэгийг нь л таньвал нөгөө
  //    заалт мөнхөд «нөхцөл дутуу» гэж хариулна.
  ['sampled_percent', 'sample_percent', 'sampling_percent'],
];

/** Талбарын нэр + түүнтэй ижил утгатай бүх нэр. */
export function fieldAliases(field: string): readonly string[] {
  for (const group of FIELD_ALIASES) if (group.includes(field)) return group;
  return [field];
}

/**
 * ЕРӨНХИЙ НЭГЖИЙН ОРОЛТ — «хэдэн хоног өнгөрөв» гэх мэт.
 *
 * ⚠️ ХУГАЦААНЫ НЭГЖ СОЛИХГҮЙ, ЗОРИУД.  «50 хоног» нь «2 сар»-аас бага уу
 *    гэдэг нь ХУАНЛИЙН асуулт: 2 сар нь 59-62 хоног байж болно.  Тиймээс
 *    хоногийн оролтыг САРЫН дүрэмд ХЭРЭГЛЭХГҮЙ — үр дүн нь `missing`
 *    болж, хоолой «хуанлиар тооцох шаардлагатай» гэж ил хэлнэ.
 *
 *    Багцын алтан кейс G006 яг үүнийг шаарддаг:
 *      {elapsed_days: 50} + «2 сарын дотор» → requires_calendar_month_evaluation
 *    Хоногийг сар руу хөрвүүлбэл ХУДАЛ итгэлтэй хариу гарна.
 */
const UNIT_GENERIC_FIELDS: Readonly<Record<string, readonly string[]>> = {
  days: ['elapsed_days'],
  months: ['elapsed_months'],
  years: ['elapsed_years'],
};

export type Context = Record<string, number | string | boolean | null | undefined>;

/** Нөхцөл нь аль талбаруудыг уншиж болох вэ (давуу эрхийн дарааллаар). */
export function candidateFields(cond: RuleCondition): string[] {
  const out: string[] = [];
  const push = (f: string): void => {
    if (!out.includes(f)) out.push(f);
  };

  // 1. Дүрэм өөрөө талбараа нэрлэсэн бол тэр нь ДАВУУ.
  if (typeof cond.field === 'string' && cond.field.length > 0) {
    for (const alt of fieldAliases(cond.field)) push(alt);
  }
  // 2. `kind`-аас гарах уламжлалт нэрс (БНбД багц).
  for (const f of fieldsForKind(cond.kind)) for (const alt of fieldAliases(f)) push(alt);
  // 3. Нэгжтэй тохирох ЕРӨНХИЙ оролт — хугацааны нэгж СОЛИГДОХГҮЙ.
  if (typeof cond.unit === 'string') {
    for (const f of UNIT_GENERIC_FIELDS[cond.unit] ?? []) push(f);
  }
  return out;
}

function numeric(ctx: Context, fields: readonly string[]): { field: string; value: number } | null {
  for (const f of fields) {
    const v = ctx[f];
    // ⚠️ `typeof v === 'number'` нь ЗААВАЛ.  `Number(undefined)` нь NaN,
    //    `Number(null)` нь 0 — сүүлийнх нь «мэдэхгүй»-г «тэг» болгож
    //    хувиргаад бүх босгыг унагана.
    if (typeof v === 'number' && Number.isFinite(v)) return { field: f, value: v };
  }
  return null;
}

/**
 * ⚠️ ХАТУУ vs ЗӨӨЛӨН ТЭНЦҮҮ.  `>` ба `>=` -ийн ялгаа нь яг босго дээрх
 *    бодит шийдвэр.  Багцуудад хоёулаа байна (2000 м²-ЭЭС ИХ vs 300 м²
 *    БА ТҮҮНЭЭС ИХ; 1.0 тэрбумаас ДЭЭШ) тул нэгтгэж болохгүй.
 *    `calculation_cases.jsonl` нь босго−1 / босго / босго+1-ийг тусад нь
 *    шалгадаг — УББ-ийн G002 нь яг «дээш нь >= биш» гэдгийг барьдаг.
 */
export function compare(value: number, comparator: Comparator, threshold: number | [number, number]): boolean {
  if (comparator === 'between') {
    if (!Array.isArray(threshold)) return false;
    const [lo, hi] = threshold;
    // ⚠️ «5-12 кабель» нь ХОЁР ТАЛДАА ХААЛТТАЙ.
    return value >= lo && value <= hi;
  }
  if (Array.isArray(threshold)) return false;
  switch (comparator) {
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '=':
      return value === threshold;
    default:
      return false;
  }
}

function evaluateCondition(cond: RuleCondition, ctx: Context, used: Context): ConditionOutcome {
  // ⚠️ `required: false` гэсэн мөр багцуудад БАЙХГҮЙ, гэвч ирээдүйн норм
  //    авчирч болзошгүй.  Хэрэв худал бол шаардлагагүй — таамаглахгүй.
  if (!cond.required) return { state: 'not_required', because: cond.condition_text_mn };

  if (cond.kind === 'all') return { state: 'required', because: cond.condition_text_mn };

  // ⚠️ «Өөр нормд заасны дагуу» — ЭНЭ БАГЦ ХАРИУЛАХГҮЙ.  Тоо зохиох нь
  //    хамгийн амархан алдаа тул ил зарлаад шилжүүлнэ.
  if (cond.kind === 'external_norm') return { state: 'external_norm', because: cond.condition_text_mn };

  /**
   * ⚠️ `flag` — ҮНЭН/ХУДАЛ нөхцөл (УББ 12-204-01, 2026-09-10-нд нэмэгдсэн).
   *    Даамлын 4.3-р заалт: «сард 2-оос доошгүй удаа санал тавьсан БА захиалагч
   *    шийдвэрлээгүй БА ноцтой зөрчил бий болсон» — сүүлийн хоёр нь тоо биш,
   *    хэрэглэгчийн БАТАЛСАН баримт.  Тэднийг `required_context`-д л
   *    бичвэл хөдөлгүүр зөвхөн «байгаа эсэх»-ийг шалгаж, `false` өгсөн ч
   *    «хангана» гэж хэлнэ (хэмжсэн: алтан кейс R004).  Тиймээс ил төлөв:
   *    `true` → хангана, `false` → хангахгүй, бусад → дутуу (таамаглахгүй).
   */
  if (cond.kind === 'flag') {
    const field = typeof cond.field === 'string' ? cond.field : null;
    const v = field === null ? undefined : ctx[field];
    if (v === true) {
      if (field !== null) used[field] = true;
      return { state: 'required', because: cond.condition_text_mn };
    }
    if (v === false) {
      if (field !== null) used[field] = false;
      return { state: 'not_required', because: cond.condition_text_mn };
    }
    return { state: 'missing', needs: field === null ? [] : [field] };
  }

  const fields = candidateFields(cond);
  if (fields.length === 0 || cond.comparator === null || cond.value === null) {
    // Тодорхойгүй бүтэц — ТААМАГЛАХГҮЙ, дутуу гэж зарлана.
    return { state: 'missing', needs: [...fields] };
  }

  const found = numeric(ctx, fields);
  if (found === null) return { state: 'missing', needs: [...fields] };

  used[found.field] = found.value;
  return compare(found.value, cond.comparator, cond.value)
    ? { state: 'required', because: cond.condition_text_mn }
    : { state: 'not_required', because: cond.condition_text_mn };
}

/**
 * Нэг дүрмийг өгөгдсөн нөхцөлд ҮНЭЛНЭ.
 *
 * ⚠️ БАТАЛГААЖААГҮЙ ДҮРЭМ НЬ ЭНД ЗОГСОНО.  Дуудагч нь `status`-ыг
 *    ЗААВАЛ шалгана — `outcomes` нь тэр тохиолдолд ХООСОН байна.
 *
 * ⚠️ НӨХЦӨЛГҮЙ ДҮРЭМ НЬ АЛДАА БИШ.  УББ-ийн 33 үүрэг, 5 эрэг, 1
 *    хариуцлагын дүрэмд тоон нөхцөл БАЙХГҮЙ — тэд эшлэх, уншуулах
 *    зориулалттай.  `no_conditions` төлөв нь тэднийг «тооцоолж чадсангүй»
 *    гэсэн ХУДАЛ дохиогоор бузарлахаас сэргийлнэ.
 */
/**
 * ГҮЙЦЭТГЭХИЙГ ЗӨВШӨӨРСӨН БАТАЛГААЖИЛТЫН ТӨЛӨВҮҮД.
 *
 * ⚠️ ЭНЭ НЬ ЦАГААН ЖАГСААЛТ, ЗОРИУД.  Шинэ багц танигдаагүй төлөв авчирвал
 *    тэр нь өгөгдмөлөөр ХААЛТТАЙ байна — «мартсанаас болж гоожих» боломжгүй.
 *
 * ⚠️ ЯАГААД ХОЁР МӨР БАЙНА.  БНбД 21-04-05 ба УББ 12-01-01 нь
 *    `verified_from_page_image` гэж бичдэг.  УББ-11-201-00-ын эх PDF нь
 *    ЗУРАГ ЗӨВХӨН (embedded text огт байхгүй) тул түүнийг рендерлэж, монгол
 *    OCR-дээд, хуудасны ЗУРАГТАЙ ТУЛГАЖ шалгасан — багц түүнийг
 *    `verified_from_rendered_page_image_with_ocr_normalization` гэж нэрлэсэн.
 *    Нотлох барьцаа нь ИЖИЛ (хуудасны зураг); ялгаа нь зөвхөн цэг таслал,
 *    мөр таслал жигдэрсэн явдал бөгөөд багц өөрөө үүнийг
 *    `human_review_notes`-д ил бичсэн.
 *
 * ⚠️ ЭНЭ БАГЦАД ГООЖИЛТЫН ЭРСДЭЛ БАЙХГҮЙ ГЭДГИЙГ ХЭМЖСЭН: түүний 76 дүрэм
 *    БҮГД тоон нөхцөлгүй тул `evaluated` төлөв огт үүсэхгүй — хамгийн дээд
 *    нь `supported`.  Өөрөөр хэлбэл энэ мөрийг нэмэх нь `verified` төлөв
 *    ҮҮСГЭХГҮЙ, зөвхөн 71 заалтыг худал «эх бичвэр тодорхойгүй» гэж
 *    тэмдэглэхээс сэргийлнэ.
 *
 * ⚠️ `needs_human_review` НЬ ЭНД ХЭЗЭЭ Ч ОРОХГҮЙ (гал түймрийн багцын 6 мөр).
 *    Тэр нь «эх бичвэр эргэлзээтэй» гэсэн үг — өөр ойлголт.
 */
export const EXECUTABLE_VERIFICATION: ReadonlySet<string> = new Set([
  'verified_from_page_image',
  'verified_from_rendered_page_image_with_ocr_normalization',
  /**
   * ⚠️ БНбД 11-03-21 (MCIS GOLD v2, 2026-09-10) — ГУРВАН ШИНЭ МӨР, нотолгоо
   *    нь хуудасны зураг БИШ, legalinfo.mn дээрх АЛБАН ЁСНЫ ХҮЧИНТЭЙ БИЧВЭР
   *    (lawId=16390402482361).  Энэ нь сканы зургаас СУЛ биш, ХҮЧТЭЙ барьцаа:
   *    зураг нь тухайн хэвлэлийг, legalinfo нь одоо мөрдөж буй эхийг заана.
   *
   *    Багцын мэдэгдэлд НАЙДААГҮЙ — 2026-09-10-нд тэр хуудсыг ШУУД уншиж
   *    78 тоон утгаас 76-г тулгав: Хүснэгт 5-1 (18), 5-2 (26), 4-1 (9),
   *    3-1 (8), заалт 3.9 / 5.6 / 5.7 / 4.8 / 3.5 / 6.7 / 3.18 / 5.2-ын
   *    тоонууд бүгд ТААРСАН.  Тулгаагүй хоёр нь Хавсралт B-3-ын траншейн
   *    гүн (0.5–2 м, зөвлөмжийн хавсралт).
   *
   *    `verified_against_current_legalinfo_clause_index` нь ЗААЛТЫН (үүрэг,
   *    эрх, шаардлага) мөрүүдийнх — тэдэнд тоон нөхцөл БАЙХГҮЙ тул энэ
   *    мөрөөр `verified` төлөв ХЭЗЭЭ Ч үүсэхгүй; нэмэхгүй бол 24 заалт худал
   *    «эх бичвэр тодорхойгүй» гэж тэмдэглэгдэнэ.
   */
  'verified_from_official_legalinfo_text',
  'verified_current_text',
  'verified_against_current_legalinfo_clause_index',
  // Хуулийн төлөвийн хоёр хэсэг (батлагдсан / орлосон) — ижил legalinfo эх.
  'verified_legalinfo',
  // 19 хавсралтын ГАРЧГИЙН мөр — албан ёсны гарчгаас оршихуй + нэр нь
  // шалгагдсан.  Тоон нөхцөл ХЭЗЭЭ Ч байхгүй (гарчиг л) тул `verified`
  // төлөв үүсгэхгүй; оруулахгүй бол «эх бичвэр тодорхойгүй» гэж худал хэлнэ.
  'verified_appendix_presence_and_title',
  /**
   * ⚠️ БНбД 11-08-23 (MCIS GOLD v3, 2026-09-10) — мөн legalinfo.mn-ийн хүчинтэй
   *    бичвэр (lawId=17089502787971).  Багц ӨӨРӨӨ хоёр давхар хаалга тээдэг:
   *    хэсэгт `allow_current_compliance_answer`, тоон мөрөнд
   *    `usable_for_current_compliance` — эвдэрсэн 13 хэсэг ба 5 тоо нь
   *    `…_render_review` төлөвтэй бөгөөд ЭНД ОРООГҮЙ (гүйцэтгэгдэхгүй).
   *    Тоон мөрийн ерөнхий «verified» үгийг адаптер тугтай нь хамт
   *    `verified_official_text` болгож буулгадаг — «verified» гэсэн үг
   *    өөрөө энд ХЭЗЭЭ Ч орохгүй.
   */
  'verified_official_text',
  'verified_official',
  'verified_heading',
  'verified_reference_or_heading',
  /**
   * ⚠️ СНиП II-97-76* (2026-09-10) — Монголын хүчин төгөлдөр нормын албан
   *    жагсаалтад (gazar.gov.mn, х.32) бүртгэлтэй ЗӨВЛӨЛТИЙН норм; техникийн
   *    бичвэр нь 1990 оны нэгтгэсэн орос MIRROR, MCIS PDF-тэй byte-for-byte
   *    тулгаагүй (багц ил хэлдэг).  Багц 240 тоог `usable_for_current_compliance:
   *    true` гэж өгсөн, 12 заалтыг (Зөвлөлтийн хууль/ГОСТ-ын хамаарал, 2.13/2.14
   *    редакцын зөрүү) ХААСАН — тэд `needs_human_review`.  Энэ мөр нь
   *    `verified_official_text`-ээс ЗОРИУД өөр нэртэй: эшлэл дээр хуулийн
   *    хяналтын туг ХЭВЭЭР (`effective_status` ≠ in_force), хэрэглэгч тоог
   *    авахдаа «mirror» гэдгийг харна.
   */
  'verified_mirror_text_mongolia_listed',
  /**
   * ЭЗНИЙ ШИЙДВЭР (2026-09-14, GAP-025 follow-up) — ХОЁР МӨР, ЗӨВХӨН ЭХ СУРВАЛЖИЙН ЭРХ.
   *    БНбД 31-23-12 мөр бүрдээ `source.verification_status: official_mcis_pdf` (MCIS-ийн албан
   *    PDF, 326 мөр), БНбД 31-24-22 `registered_full_text` (бүртгэлийн бүтэн бичвэр, 508 мөр)
   *    гэж зарладаг.  Эзэн хоёуланг «эх сурвалж баталгаажсан» гэж батлав → гүйцэтгэгдэнэ.
   *
   * ⚠️ ЭХ СУРВАЛЖИЙН ЭРХ ≠ ХҮЧИН ТӨГӨЛДӨР БАЙДАЛ.  Энэ мөр нь дүрмийг ГҮЙЦЭТГЭХИЙГ л зөвшөөрнө;
   *    баримтын хууль ёсны төлөв (`effective_status` → `currentness.ts`-ийн 7 төлөв) ТУСДАА
   *    машинаар явна — нэг дүрэм «executable source» + `CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED`
   *    хоёулаа байж болно, эшлэлийн тэмдэглэл/трейлер тэндээс.  Хоёрыг нэгтгэхгүй.
   *    `usable_for_current_compliance` туг ямар ч төлөвийг энд оруулахгүй (rowVerification);
   *    танигдаагүй төлөв хаалттай хэвээр; KNOWN_NON_EXECUTABLE-ийн мөрүүд хэвээр.
   */
  'official_mcis_pdf',
  'registered_full_text',
]);

/** Энэ мөрөөр ЭРХ БҮХИЙ детерминист хариу гаргаж болох уу. */
export function isExecutableVerification(status: string): boolean {
  return EXECUTABLE_VERIFICATION.has(status);
}

/**
 * ТАНИГДСАН, ГЭВЧ ГҮЙЦЭТГЭГДЭХГҮЙ баталгаажилтын төлөвүүд (GAP-025) — мөр → шалтгаан.
 *
 * ⚠️ ГУРВАН АНГИ, ХОЁР БИШ.  Өмнө нь «цагаан жагсаалтад байхгүй» = «чимээгүй хүний хяналт»
 *    байсан тул багц ШИНЭ нэр авчрахад (`verified_content_extract`, `official_mcis_pdf` гэх мэт —
 *    2026-09-11-нд ГУРВАН багцын 530+ мөр) хэн ч мэдэлгүй ангилагдаж байв.  Одоо:
 *      executable      — `EXECUTABLE_VERIFICATION` (эрх бүхий хариу гарна);
 *      non_executable  — ЭНЭ бүртгэл: эзэн/адаптер ЗОРИУД гүйцэтгэхгүй гэж шийдсэн, шалтгаантай;
 *      unknown         — аль ч бүртгэлд байхгүй → мөн гүйцэтгэгдэхгүй (ХААЛТТАЙ), ГЭХДЭЭ шингээлт
 *                        `--strict`-д УНАНА, хөрвүүлэгч (norm-compiler) ЗОГСОНО, `/norm/info` тоолно.
 *    Багцын `usable_for_current_compliance: true` / `allow_current_compliance_answer: true` туг нь
 *    төлөвийг ХЭЗЭЭ Ч дээшлүүлэхгүй — туг нь багцын мэдэгдэл, төлөв нь БИДНИЙ шийдвэр.
 *
 * ⚠️ Шинэ төлөв нэмэхдээ ЭНД (шалтгаантай) эсвэл `EXECUTABLE_VERIFICATION`-д (нотолгоотой)
 *    оруулна; Session C-ийн `tools/dataset-lint` хоёуланг нь энэ файлаас уншина.
 */
export const KNOWN_NON_EXECUTABLE_VERIFICATION: ReadonlyMap<string, string> = new Map([
  ['verified', 'ерөнхий үг — ямар барьцаагаар шалгасан нь тодорхойгүй (адаптер тугтай нь хамт нарийн мөр болгодог)'],
  ['unverified', 'багц өөрөө шалгаагүй гэж хэлсэн'],
  ['needs_human_review', 'эх бичвэр эргэлзээтэй — хүний хяналт'],
  ['human_review_required', 'эх бичвэр эргэлзээтэй — хүний хяналт'],
  ['damaged_source_render_review', 'эвдэрсэн хуудас, рендерийн хяналт'],
  ['source_render_review', 'БНбД 11-08-23: эвдэрсэн 13 хэсэг / 5 тоо'],
  ['verified_locator_source_render_review', 'БНбД 11-08-23: хаяг нь шалгагдсан, бичвэр нь рендерийн хяналтад'],
  ['paraphrase', 'хураангуй — үгчилсэн эх биш'],
  ['verified_current', 'ерөнхий үг — эх нь заагдаагүй'],
  ['quarantined', 'багц тусгаарласан'],
  ['pending', 'багц хүлээгдэж байна'],
  ['ocr_uncertain', 'OCR эргэлзээтэй'],
  ['verified_content_extract', 'БНбД 11-106-25: агуулгаас задалсан мөр (2026-09-21-ээс тоон мөр эх заалтдаа холбогдож ХАЙГДАНА) — эзэн цагаан жагсаалтад оруулаагүй тул гүйцэтгэгдэхгүй'],
  ['verified_raw_from_page_image_crosslink_needs_review', 'БНбД 11-03-02: хуудасны зурагтай тулгасан ч хөндлөн холбоос хяналт хүлээж байна'],
  ['official_legalinfo', 'БНбД 31-23-12: хуулийн төлөвийн ганц хэсэг (дугаар солисон тушаал) — эшлэх л зориулалттай'],
  ['official_order', 'БНбД 31-24-22: батлах тушаалын ганц хэсэг — эшлэх л зориулалттай'],
  ['unverified_reference_table', 'лавлах хүснэгтийн утга тоон мөртэй тулгагдаагүй/зөрсөн (адаптерын дотоод мөр)'],
  /**
   * ⚠️ ai/norm-dataset (2026-09-16, БНбД 31-17-10) — MCIS-ийн АЛБАН PDF-ийн текст давхаргаас
   *    `tools/parse_pdf.py` АВТОМАТААР задалсан хэсэг/тоо/томьёо.  Эх нь албан ёсны, гэвч хуудасны
   *    зурагтай ХҮН тулгаагүй (Arial Mon хөрвүүлэлт, regex-ээр олсон тоо).  Хайгдана, эшлэгдэнэ
   *    (L1/L2), гэвч тоон дүрэм ЭРХ БҮХИЙ хариу болж ГҮЙЦЭТГЭГДЭХГҮЙ — хүн баталгаажуулсны дараа
   *    багц дахь төлөвийг солино, энэ мөрийг биш.
   */
  ['official_pdf_text_layer_auto_extracted', 'norm-dataset: албан PDF-ийн текст давхаргаас автоматаар задалсан — хуудасны зурагтай хүн тулгаагүй'],
]);

export type VerificationClass = 'executable' | 'non_executable' | 'unknown';

/** Төлөв → анги.  `unknown` = хаалттай + тайлагнагдана (fail closed, чимээгүй БИШ). */
export function classifyVerification(status: string): VerificationClass {
  if (EXECUTABLE_VERIFICATION.has(status)) return 'executable';
  if (KNOWN_NON_EXECUTABLE_VERIFICATION.has(status)) return 'non_executable';
  return 'unknown';
}

/**
 * Тэр ижил жагсаалтыг SQL-ийн `IN (…)`-д тохирох хэлбэрээр.
 *
 * ⚠️ ЭНЭ ЗӨВХӨН ТООЛОХОД.  Шийдвэрийн хаалга нь ЯГ энэ файлын
 *    `evaluateRule` хэвээр — SQL нь `/norm/info`-ийн харуулах тоог
 *    хөдөлгүүртэй нь ЗААВАЛ ижил байлгахын тулд л энд байна.  Утгууд нь
 *    кодод бичигдсэн тогтмолууд тул тэмдэгт зугтаах асуудал үүсэхгүй.
 */
export function executableVerificationSql(): string {
  return [...EXECUTABLE_VERIFICATION].map((v) => `'${v}'`).join(', ');
}

export function evaluateRule(rule: NormRule, ctx: Context): RuleDecision {
  if (!isExecutableVerification(rule.verification_status)) {
    return {
      rule_id: rule.rule_id,
      status: 'blocked_unverified',
      outcomes: {},
      inputs_used: {},
      missing_context: [],
    };
  }

  const used: Context = {};
  const outcomes: Record<string, ConditionOutcome> = {};
  for (const { key, cond } of rule.conditions) {
    outcomes[key] = evaluateCondition(cond, ctx, used);
  }

  const missing = new Set<string>();
  for (const o of Object.values(outcomes)) {
    if (o.state === 'missing') for (const n of o.needs) missing.add(n);
  }

  // ⚠️ Дүрмийн `required_context`-д заасан БАЙХГҮЙ талбарыг мөн нэмнэ —
  //    тэдгээр нь тоон бус ялгуур (галын ангилал, зоорь эсэх).  Тэднийг
  //    асуухгүй бол хэрэглэгч буруу МӨР дээр зөв тоо оруулж болно.
  for (const f of rule.required_context) {
    const v = ctx[f];
    if (v === undefined || v === null || v === '') missing.add(f);
    else used[f] = v;
  }

  const anyMissing = Object.values(outcomes).some((o) => o.state === 'missing');

  let status: RuleDecision['status'];
  if (rule.conditions.length === 0) status = 'no_conditions';
  else if (anyMissing) status = 'missing_context';
  else status = 'evaluated';

  const decision: RuleDecision = {
    rule_id: rule.rule_id,
    status,
    outcomes,
    inputs_used: used as Record<string, number | string | boolean>,
    missing_context: [...missing],
  };
  if (rule.decision_policy.startsWith('evaluate_all_conditions') && rule.conditions.length > 0) {
    const flags = Object.values(outcomes).map((o) => outcomeFlag(o));
    decision.all_conditions = flags.some((f) => f === null) ? null : flags.every((f) => f === true);
  }
  return decision;
}

/**
 * Нөхцөлийн төлөвийг гурван утгатай тугт хөрвүүлнэ.
 *
 * ⚠️ `missing` ба `external_norm` нь ХУДАЛ БИШ — `null`.  Тэднийг `false`
 *    болговол «шаардлагагүй» гэсэн ХУДАЛ баталгаа болно.
 */
export function outcomeFlag(o: ConditionOutcome | undefined): boolean | null {
  if (o === undefined) return null;
  if (o.state === 'required') return true;
  if (o.state === 'not_required') return false;
  return null;
}

/** Бүх нэрлэсэн үр дүнгийн товч хэлбэр. */
export function decisionFlags(d: RuleDecision): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {};
  for (const [key, o] of Object.entries(d.outcomes)) out[key] = outcomeFlag(o);
  if (d.all_conditions !== undefined) out.all_conditions = d.all_conditions;
  return out;
}
