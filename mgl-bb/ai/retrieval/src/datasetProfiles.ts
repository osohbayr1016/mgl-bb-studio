/**
 * MGL AI · БАГЦЫН ХЭЛБЭР ТАНИХ БА ЖИГДРҮҮЛЭХ.
 *
 * ⚠️ БАРИМТ БҮР ӨӨР ХЭЛБЭРТЭЙ ИРНЭ, ЭНЭ НЬ ЗАЙЛШГҮЙ.  Норматив баримтууд
 *    өөр өөр бүтэцтэй: гал унтраахын жагсаалт нь ХҮСНЭГТИЙН МӨР
 *    (объект → ГУАТ/ГМДХ), захиалагчийн дүрэм нь ЗААЛТ (субъект → үүрэг,
 *    эрх, хариуцлага, босго).  Гурав дахь нь дахин өөр байх нь тодорхой.
 *
 * ⚠️ ТИЙМЭЭС ХӨДӨЛГҮҮР БИШ, ОРОЛТ ЖИГДЭРНЭ.  Баримт бүрд тусдаа хайлт,
 *    тусдаа босгын логик бичих нь тэр логикийг ОЛОН УДАА бичих гэсэн үг —
 *    яг л «299 vs 300» алдаа гарах газар.  Энэ файл нь бүх хэлбэрийг НЭГ
 *    дотоод загварт буулгаж, доод давхаргууд НЭГ хэвээр үлдэнэ.
 *
 * ⚠️ ШИНЭ БАГЦ НЭМЭХ = ЭНД АДАПТЕР НЭМЭХ.  `rules.ts`, `pipeline.ts`,
 *    `search.ts`-ийг ХӨНДӨХГҮЙ.  Хэрэв шинэ багц тэднийг хөндөх шаардлагатай
 *    бол тэр нь жинхэнэ шинэ ОЙЛГОЛТ (шинэ харьцуулагч гэх мэт) — тэгвэл
 *    зориуд нэм, адаптераар ТОЙРЧ БОЛОХГҮЙ.
 */
import { isExecutableVerification, type NormRule, type RuleCondition, type RuleKind, type Comparator } from './rules.ts';
import { APPENDIX_LATIN_TO_CYRILLIC, APPENDIX_CYRILLIC_TO_LATIN } from './normalize.ts';
import { normalizeReprText } from './reprText.ts';

/** Дотоод жигд хэлбэр — хэсэг. */
export interface ChunkIn {
  chunk_id: string;
  kind: string;
  page: number | null;
  source_pdf_page: number | null;
  table_no: number | null;
  row_no: string | null;
  clause_no: string | null;
  section_path: string | null;
  text_mn: string;
  text_latin: string | null;
  search_text: string;
  authority_level: string;
  visibility: string;
  verification_status: string;
  retrieval_weight: number;
  metadata: unknown;
}

/** Дотоод жигд хэлбэр — дүрэм (`doc_id` нь шингээгч нэмнэ). */
export type RuleIn = Omit<NormRule, 'doc_id'>;

export interface TestIn {
  test_id: string;
  query: string;
  language: string;
  expected_rule_id: string | null;
  expected_chunk_id: string | null;
  expected_page: number | null;
  raw: unknown;
}

export interface CaseIn {
  case_id: string;
  query_mn: string;
  query_latin: string | null;
  query_en: string | null;
  context: unknown;
  expected_rule_id: string | null;
  expected: unknown;
  must_cite_source: boolean;
}

export interface AliasIn {
  canonical: string;
  language: string;
  alias: string;
}

export interface DatasetProfile {
  id: string;
  /** Багцад заавал байх файлууд — байхгүй бол энэ профайл ТААРААГҮЙ. */
  requires: string[];
  /** Мөн ≥1 байт байх ёстой файлууд (0-байтын хоосон файл = байхгүйтэй адил). */
  requiresNonEmpty?: string[];
}

export const PROFILES: Readonly<Record<string, DatasetProfile>> = {
  /**
   * ai/norm-dataset хэлбэр (2026-09-16, БНбД 31-17-10) — `tools/build-pack.mjs`-ийн ҮҮСГЭСЭН багц:
   * хэсэг нь `clause_rules`-ийн ХЭЛБЭРТЭЙ (`chunk_id`, `page`, `source_pdf_page`, `section`,
   * `source_locator`) + `table_no`; тоон мөр нь legalinfo NumericRow хэлбэртэй (`rule_id` = хэсгийн
   * id → заалт бүрд нэг дүрэм, нэрлэсэн нөхцөлүүд).  ГАНЦ таних тэмдэг: `norm-dataset.pack.json`
   * (өөр ямар ч багцад байхгүй нэр).  Бусад профайлын шаардсан файлууд энд ОГТ байхгүй тул
   * дараалал хамаарахгүй ч эхэнд бичив.
   */
  clause_document: { id: 'clause_document', requires: ['norm-dataset.pack.json'] },
  /** БНбД 21-04-05 хэлбэр — хүснэгтийн мөр + ГУАТ/ГМДХ хос нөхцөл. */
  table_rules: { id: 'table_rules', requires: ['rules.jsonl'] },
  /** УББ 12-01-01 хэлбэр — заалт + үүрэг/эрх/хариуцлага/босго. */
  clause_rules: { id: 'clause_rules', requires: ['obligation_rules.jsonl'] },
  /**
   * УББ-11-201-00 хэлбэр — аргачилсан зааврын ШААРДЛАГА: заалт бүрд яг нэг
   * дүрэм, сэдвээр нь ЗУРГААН файлд хуваагдсан, дээр нь тоон утгууд тусдаа.
   *
   * ⚠️ ХОЁР ФАЙЛААР ТАНИНА, НЭГЭЭР БИШ.  `numeric_requirements.jsonl` нь
   *    УББ 12-204-01 багцад БАС байдаг тул ганцаараа таних тэмдэг БОЛОХГҮЙ.
   *    `general_principles` + `implementation_rules` хосыг өөр ямар ч багц
   *    агуулдаггүй (хэмжсэн: 6 хавтасны файлын жагсаалт).
   */
  guideline_rules: {
    id: 'guideline_rules',
    requires: ['general_principles.jsonl', 'implementation_rules.jsonl'],
  },
  /**
   * БНбД 11-03-21 (MCIS GOLD v2) хэлбэр — legalinfo.mn-ээс шалгасан заалт:
   * дүрмийн мөр нь `rule_json` бүрхүүлтэй, тоон шаардлага нь `_min`/`_max`
   * ХОСООР тусдаа файлд, хүснэгтүүд нь `reference_tables.json`-д БҮТЭЦТЭЙ.
   *
   * ⚠️ `duty_rules.jsonl` ГАНЦААРАА таних тэмдэг БОЛОХГҮЙ — УББ 12-204-01
   *    багц ч тэр нэртэй файлтай, гэвч мөр нь ХАВТГАЙ (`rule_json`-гүй) ба
   *    `aliases.json` нь массив.  `legal_status_graph.json` нь зөвхөн энэ
   *    хэлбэрт байдаг (хэмжсэн: 7 хавтасны файлын жагсаалт).
   */
  legalinfo_rules: {
    id: 'legalinfo_rules',
    requires: ['duty_rules.jsonl', 'legal_status_graph.json'],
  },
  /**
   * УББ 12-204-01 хэлбэр — `clause_rules`-ийн хэсэг (хуудастай, скан) + ХАВТГАЙ
   * үүрэг/эрх/мэргэшил/хариуцлагын мөр (`text_mn`) + 2 тоон мөр, нэг нь
   * НИЙЛМЭЛ (тоо + хоёр үнэн/худал нөхцөл).
   *
   * ⚠️ `legalinfo_rules`-ийн ДАРАА бичигдсэн, ЗОРИУД: тэр нь `duty_rules` +
   *    `legal_status_graph` хосыг шаарддаг, энэ нь `legal_status_graph`-ГҮЙ
   *    `duty_rules` + `qualification_rules`.  Дарааллыг сольвол legalinfo
   *    багцууд энд орж, `printed_page`/`answer_source` талбарууд алдагдана.
   */
  flat_clause_rules: {
    id: 'flat_clause_rules',
    requires: ['duty_rules.jsonl', 'qualification_rules.jsonl'],
  },
  /**
   * БНбД 11-03-02 (MGL_AI dataset, 2026-09-21 адаптер) — ЖУРАМ: гадаадын байгууллагаар
   * зураг төсөл гүйцэтгүүлэх.  Үүрэг/эрхийн файлгүй; оронд нь `procedure_rules.jsonl`
   * (trigger → action, `source_clause`), `required_documents.jsonl` (RD01…, өөрийн хэсэгтэй),
   * `approval_requirements.jsonl` (AP01…, өөрийн хэсэгтэй), `decision_cases.jsonl` (үнэлгээний
   * кейс — тооцооны кейс БИШ, шингээхгүй).  Хэсэг нь `clause_rules`-ийн хэлбэр
   * (`chunk_id`, `page`, `pdf_page`, `section`, `text_mn/latin/en`).  Дүрэм бүр
   * `quote_source_clause` — 2002 оны журам, тоон босго байхгүй; хүчинтэй эсэх нь
   * `legal_status`-аар (currentness трейлер), заалтаас хэзээ ч гарахгүй.
   */
  procedure_rules: {
    id: 'procedure_rules',
    requires: ['procedure_rules.jsonl', 'required_documents.jsonl'],
  },
  /**
   * БНбД 31-25-22 (MCIS GOLD v3 CURRENT AMENDED, 2026-09-11) хэлбэр — НЭМЭЛТ
   * ӨӨРЧЛӨЛТ ОРСОН норм: үүрэг/эрхийн файл ОГТ байхгүй, оронд нь
   * `canonical_rules.jsonl` (өндөр итгэлтэй 40 заалт) + `section_index.jsonl`
   * (бүх бүлгийн гарчиг — «эх сурвалжийг ДАХИН ШАЛГА» гэсэн хаалт) +
   * `amendment_2024_rules.json` (2024 оны №36 тушаалаар өөрчлөгдсөн заалт).
   *
   * ⚠️ Хэсгийн id-д `:clause:` тэмдэг БАЙХГҮЙ (`…:2.4`, `…:section:5.2`) —
   *    `clauseChunkId` энд ажиллахгүй, `amendedChunkId` хэрэглэнэ.
   */
  amended_rules: {
    id: 'amended_rules',
    requires: ['canonical_rules.jsonl', 'section_index.jsonl'],
  },
  /**
   * БД 21-101-12 (тэсрэх, шатах галын аюулын ангилал) хэлбэр — өрөөний/В/барилгын
   * ангиллын дүрэм + 38 томьёо + тооцооны кейс.  ГҮЙЦЭТГЭХ логик нь Worker-ийн
   * хөрвүүлсэн бүртгэлд (`ai/norm-compiler`, `backend/src/lib/mglai/norm/`) —
   * локал сан нь ЭХ БИЧВЭР + эшлэл + тест + alias-ыг л барина (нэг гүйцэтгэх
   * хөдөлгүүр, хоёр биш).
   *
   * ⚠️ ХОЁР ФАЙЛ ХОЁУЛАА ≥1 БАЙТ.  УББ 12-01-01 багцад `room_category_rules.jsonl`,
   *    `v_subcategory_rules.jsonl` гэсэн 0-байтын хоосон файл БИЙ; зөвхөн
   *    байгаа эсэхээр танивал тэр багц энд орно.  `requiresNonEmpty` тийм учраас.
   */
  fire_hazard_rules: {
    id: 'fire_hazard_rules',
    requires: ['room_category_rules.jsonl', 'v_subcategory_rules.jsonl'],
    requiresNonEmpty: ['room_category_rules.jsonl', 'v_subcategory_rules.jsonl'],
  },
};

/**
 * Багцын хэлбэрийг ФАЙЛЫН БАЙДЛААР таана.
 *
 * ⚠️ МАНИФЕСТЫН НЭРЭНД НАЙДАХГҮЙ.  `dataset_id` нь багц бүрд өөр
 *    (`mgl-ai-bnbd-…`, `mgl-ai-ubb-…`) ба гурав дахь нь дахин өөр байна —
 *    нэрээр таних нь багц бүрд код нэмэхийг шаардана.  Файлын БҮТЭЦ нь
 *    хэлбэрийг тодорхойлдог бөгөөд шинэ БНбД багц ирвэл ямар ч өөрчлөлтгүй
 *    таарна.
 */
export function detectProfile(
  has: (file: string) => boolean,
  nonEmpty: (file: string) => boolean = has,
): string | null {
  for (const p of Object.values(PROFILES)) {
    if (p.requires.every((f) => has(f)) && (p.requiresNonEmpty ?? []).every((f) => nonEmpty(f))) return p.id;
  }
  return null;
}

/* ── Туслах ──────────────────────────────────────────────────────── */

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const COMPARATORS = new Set(['>', '>=', '<', '<=', '=', 'between']);
function comparator(v: unknown): Comparator | null {
  return typeof v === 'string' && COMPARATORS.has(v) ? (v as Comparator) : null;
}

/* ── Профайл 1: хүснэгтийн мөр (БНбД 21-04-05) ───────────────────── */

export function tableRulesChunks(rows: ReadonlyArray<Record<string, unknown>>): ChunkIn[] {
  return rows.map((c) => ({
    chunk_id: String(c.chunk_id ?? ''),
    kind: String(c.kind ?? 'chunk'),
    page: num(c.page),
    source_pdf_page: null,
    table_no: num(c.table),
    row_no: c.row === undefined || c.row === null ? null : String(c.row),
    clause_no: c.clause === undefined || c.clause === null ? null : String(c.clause),
    section_path: Array.isArray(c.section_path) ? (c.section_path as string[]).join(' / ') : null,
    text_mn: String(c.text_mn ?? ''),
    text_latin: str(c.text_latin),
    search_text: String(c.search_text ?? ''),
    authority_level: String(c.authority_level ?? 'normative'),
    visibility: String(c.visibility ?? 'public_norm'),
    verification_status: String(c.verification_status ?? 'unknown'),
    retrieval_weight: num(c.retrieval_weight) ?? 1.0,
    metadata: c.source_locator ?? {},
  }));
}

function condFrom(raw: unknown): RuleCondition | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  const value =
    Array.isArray(g.value) && g.value.length === 2
      ? ([Number(g.value[0]), Number(g.value[1])] as [number, number])
      : num(g.value);
  return {
    required: g.required !== false,
    kind: String(g.kind ?? 'all'),
    comparator: comparator(g.comparator),
    value,
    unit: str(g.unit),
    condition_text_mn: str(g.condition_text_mn),
  };
}

export function tableRulesRules(rows: ReadonlyArray<Record<string, unknown>>): RuleIn[] {
  return rows.map((r) => {
    // ⚠️ ГАЛ ТҮЙМРИЙН БАРИМТЫН ХОЁР СИСТЕМ НЬ НЭРЛЭСЭН НӨХЦӨЛ БОЛНО.
    //    `GUAT`/`GMDH` гэсэн түлхүүр нь ХАДГАЛАГДАНА — алтан тест, UI,
    //    `/norm`-ийн хуучин гэрээ бүгд тэр нэрээр ярьдаг.
    //
    // ⚠️ `null` НЬ «МЭДЭХГҮЙ» БИШ, «ШААРДАХГҮЙ».  Багцад `gmdh: null` гэсэн
    //    мөр нь «энэ объектод ГМДХ шаардлагагүй» гэсэн ТОДОРХОЙ утгатай —
    //    эх сурвалжийн хүснэгтийн нүд хоосон байгаа нь тэр.  Түүнийг
    //    нөхцөлгүй орхивол хоолой «ГМДХ-ийн тухай юу ч хэлэхгүй» болж,
    //    хэрэглэгч «шаардлагатай ч юм билүү» гэж эргэлзэнэ.  Тиймээс ИЛ
    //    `required: false` нөхцөл болгож бичнэ.  (Хэмжсэн: үүнгүйгээр
    //    алтан кейс C010 «GMDH мэдэгдэхгүй» болж унасан.)
    const conditions: RuleIn['conditions'] = [];
    for (const [key, raw] of [
      ['GUAT', r.guat],
      ['GMDH', r.gmdh],
    ] as const) {
      const cond = condFrom(raw);
      conditions.push(
        cond !== null
          ? { key, cond }
          : {
              key,
              cond: {
                required: false,
                kind: 'all',
                comparator: null,
                value: null,
                unit: null,
                condition_text_mn: null,
              },
            },
      );
    }

    return {
      rule_id: String(r.rule_id ?? ''),
      chunk_id: String(r.chunk_id ?? ''),
      rule_kind: 'table_row' as RuleKind,
      table_no: num(r.table),
      row_no: r.row === undefined || r.row === null ? null : String(r.row),
      clause_no: null,
      page: num(r.page),
      section: str(r.section),
      object_mn: String(r.object_mn ?? ''),
      object_latin: str(r.object_latin),
      actor: null,
      required_context: arr(r.required_context),
      conditions,
      aliases_mn: arr(r.aliases_mn),
      aliases_latin: arr(r.aliases_latin),
      aliases_en: arr(r.aliases_en),
      decision_policy: String(r.decision_policy ?? 'evaluate_structured_condition_then_quote_source'),
      citation_required: r.citation_required !== false,
      verification_status: String(r.verification_status ?? 'unknown'),
      notes: arr(r.notes),
    };
  });
}

/* ── Профайл 2: заалт (УББ 12-01-01) ─────────────────────────────── */

/** `UBB-…:clause:2.7` → `2.7`.  Хэсгийн id нь заалтын дугаарыг агуулдаг. */
export function clauseFromChunkId(chunkId: string): string | null {
  const m = /:clause:(.+)$/.exec(chunkId);
  return m?.[1] ?? null;
}

/** `source_locator` доторх PDF хуудас — багц бүр өөрөөр нэрлэдэг. */
function locatorPdfPage(loc: unknown): unknown {
  if (typeof loc !== 'object' || loc === null) return null;
  const g = loc as Record<string, unknown>;
  return g.pdf_page ?? g.source_pdf_page ?? null;
}

export function clauseRulesChunks(rows: ReadonlyArray<Record<string, unknown>>): ChunkIn[] {
  return rows.map((c) => {
    const chunkId = String(c.chunk_id ?? '');
    return {
      chunk_id: chunkId,
      kind: String(c.kind ?? 'clause'),
      // ⚠️ ХЭВЛЭМЭЛ хуудсыг эшлэлд, PDF-ийн хуудсыг зөвхөн мөрдөн шалгахад.
      //    УББ-ийн PDF нь товхимолоор сканердсан тул хоёр нь ЗӨРНӨ.
      page: num(c.page),
      // ⚠️ Хоёр багц PDF-ийн хуудсыг ХОЁР ӨӨР ГАЗАР бичдэг: УББ 12-01-01 нь
      //    дээд түвшний `source_pdf_page`, УББ-11-201-00 нь зөвхөн
      //    `source_locator.pdf_page`.  Нөөцгүй бол сүүлийнх нь бүхэлдээ
      //    NULL болж, скан дээр мөрдөн шалгах цорын ганц хаяг алдагдана.
      source_pdf_page: num(c.source_pdf_page) ?? num(locatorPdfPage(c.source_locator)),
      table_no: null,
      row_no: null,
      clause_no: clauseFromChunkId(chunkId),
      section_path: str(c.section),
      text_mn: String(c.text_mn ?? ''),
      text_latin: str(c.text_latin),
      search_text: String(c.search_text ?? ''),
      authority_level: String(c.authority_level ?? 'normative'),
      visibility: String(c.visibility ?? 'public_norm'),
      verification_status: String(c.verification_status ?? 'unknown'),
      // ⚠️ Заалт нь хүснэгтийн мөрөөс илүү ерөнхий утгатай тул бага зэрэг
      //    дээгүүр — БНбД багцын `clause` хэсгүүдтэй ижил жин (1.2).
      retrieval_weight: num(c.retrieval_weight) ?? (c.kind === 'metadata' ? 0.6 : 1.2),
      metadata: c.source_locator ?? {},
    };
  });
}

/**
 * ai/norm-dataset багц: `clauseRulesChunks` + хүснэгтийн хэсэгт `table_no` (бүтэцтэй хөл
 * «5-р хүснэгт» гэж олохын тулд) + `metadata`-д багцын `metadata` талбар.
 */
export function clauseDocumentChunks(rows: ReadonlyArray<Record<string, unknown>>): ChunkIn[] {
  return clauseRulesChunks(rows).map((c, i) => {
    const raw = rows[i]!;
    return {
      ...c,
      table_no: num(raw.table_no),
      metadata: { ...(typeof raw.source_locator === 'object' && raw.source_locator !== null ? (raw.source_locator as Record<string, unknown>) : {}), ...(typeof raw.metadata === 'object' && raw.metadata !== null ? (raw.metadata as Record<string, unknown>) : {}) },
    };
  });
}

/**
 * Заалтын дугаараас түүний хэсгийн id-г угсарна.
 *
 * ⚠️ УББ-ийн дүрмүүд нь `chunk_id` ХЭЛДЭГГҮЙ — зөвхөн `clause` дугаарыг.
 *    Хэсгийн id нь `<doc>:clause:<дугаар>` гэсэн ТОГТМОЛ хэлбэртэй тул
 *    түүнийг угсарч болно.  Угсарсан id нь байхгүй бол шингээгч тэр
 *    дүрмийг ОРУУЛАХГҮЙ (эшлэлгүй дүрэм = ашиггүй дүрэм).
 */
export function clauseChunkId(docId: string, clause: string): string {
  return `${docId}:clause:${clause}`;
}

interface ClauseRuleSources {
  obligations: ReadonlyArray<Record<string, unknown>>;
  rights: ReadonlyArray<Record<string, unknown>>;
  responsibilities: ReadonlyArray<Record<string, unknown>>;
  thresholds: ReadonlyArray<Record<string, unknown>>;
}

export function clauseRulesRules(docId: string, src: ClauseRuleSources): RuleIn[] {
  const base = (r: Record<string, unknown>, kind: RuleKind, objectMn: string): RuleIn => {
    const clause = str(r.clause);
    return {
      rule_id: String(r.rule_id ?? ''),
      chunk_id: clause === null ? '' : clauseChunkId(docId, clause),
      rule_kind: kind,
      table_no: null,
      row_no: null,
      clause_no: clause,
      page: num(r.page),
      section: null,
      object_mn: objectMn,
      object_latin: null,
      actor: str(r.actor),
      required_context: [],
      conditions: [],
      // ⚠️ ЗААЛТЫН ДҮРЭМД ALIAS ӨГӨХГҮЙ, ЗОРИУД.  `aliasRuleCandidates` нь
      //    alias-ын ХАМРАЛТААР онооддог: «захиалагч» гэсэн ганц alias-тай 33
      //    үүрэг бүгд 1.0 оноо авч, дээд шатлалд 12 санамсаргүй дүрэм
      //    оруулна.  УББ-ийн асуулт ба бичвэр ХОЁУЛАА монгол тул FTS
      //    ганцаараа хангалттай — англи багцад alias хөл хэрэгтэй байсан нь
      //    индекст англи үг БАЙХГҮЙ байсных.  Хоосон үлдээх нь энэ хөлийг
      //    зүгээр л АСААХГҮЙ.
      aliases_mn: [],
      aliases_latin: [],
      aliases_en: [],
      decision_policy: 'quote_source_clause',
      citation_required: true,
      verification_status: String(r.verification_status ?? 'unknown'),
      notes: [],
    };
  };

  const out: RuleIn[] = [];

  for (const r of src.obligations) {
    out.push(base(r, 'obligation', String(r.requirement_mn ?? '')));
  }
  for (const r of src.rights) {
    out.push(base(r, 'right', String(r.right_mn ?? '')));
  }
  for (const r of src.responsibilities) {
    const rule = base(r, 'responsibility', String(r.trigger ?? ''));
    // ⚠️ Хариуцлага нь ХОЁР хэсэгтэй: юунаас үүсэх (trigger) ба юу болох
    //    (consequence).  Зөвхөн эхнийхийг хадгалбал «тэгвэл юу болох вэ»
    //    гэсэн асуултын хариу алга болно.
    rule.notes = [String(r.consequence ?? '')].filter((s) => s.length > 0);
    out.push(rule);
  }

  for (const r of src.thresholds) {
    const rule = base(r, String(r.rule_id ?? '').includes(':deadline:') ? 'deadline' : 'threshold', String(r.effect ?? ''));
    const field = str(r.field);
    const cmp = comparator(r.operator);
    if (field === null || cmp === null || num(r.value) === null) {
      // ⚠️ Бүтэц дутуу бол нөхцөлгүй үлдээнэ — ТААМАГЛАХГҮЙ.  Дүрэм нь
      //    эшлэгдэх боломжтой хэвээр, зүгээр л тооцоологдохгүй.
      out.push(rule);
      continue;
    }
    // ⚠️ БОСГЫН ТАЛБАРЫГ `required_context`-Д БИЧНЭ.  Хоёр үүрэгтэй:
    //    (1) хэрэглэгч тэр тоог өгсөн үед `contextCandidates` энэ заалтыг
    //        ДЭВШҮҮЛНЭ — үүнгүйгээр «туршлага 2 жил» гэсэн асуулт огт
    //        хамааралгүй заалт руу очиж байв (хэмжсэн: алтан кейс G003);
    //    (2) тоо өгөөгүй үед `missing_context` нь ЯГ ЮУ дутууг нэрлэнэ.
    //    Хоёр дахь нь «дуу чимээ» биш — «жилийн хөрөнгө оруулалтаа
    //    хэлнэ үү» гэдэг нь хэрэглэгчид хэрэгтэй ганц асуулт.
    rule.required_context = [field];
    rule.conditions = [
      {
        // ⚠️ ТҮЛХҮҮР НЬ `effect`, ЗОРИУД ЕРӨНХИЙ.  Багц нь машин уншихуйц
        //    нэр ӨГДӨГГҮЙ — зөвхөн монгол өгүүлбэр.  Түүнээс түлхүүр
        //    «гаргаж авах» нь таамаг болно.  Ганц нөхцөлтэй тул нэр нь
        //    хоёрдмол утга үүсгэхгүй.
        key: 'effect',
        cond: {
          required: true,
          kind: 'field',
          comparator: cmp,
          value: num(r.value),
          unit: str(r.unit),
          condition_text_mn: String(r.effect ?? ''),
          field,
        },
      },
    ];
    out.push(rule);
  }

  return out;
}

/** Хэл заагаагүй тестийн хэлийг БИЧГЭЭР нь таана — кирилл → mn-Cyrl, бусад → mn-Latn. */
function languageOf(t: Record<string, unknown>): string {
  const given = str(t.language);
  if (given !== null) return given;
  const q = String(t.query ?? '');
  return /[\u0400-\u04ff]/u.test(q) ? 'mn-Cyrl' : 'mn-Latn';
}

export function clauseRulesTests(
  rows: ReadonlyArray<Record<string, unknown>>,
  isChunk: (id: string) => boolean = () => true,
): TestIn[] {
  return rows.map((t, i) => {
    const expected = str(t.expected_id);
    // ⚠️ СНиП II-97-76-ийн 442 тестийн 240 нь `expected_id`-д ДҮРМИЙН id
    //    («…:2.10:water_freeboard») өгдөг — хэсгийн id гэж хадгалбал Recall 0.
    const expectedIsChunk = expected === null || isChunk(expected);
    return {
    test_id: String(t.test_id ?? `Q${String(i + 1).padStart(4, '0')}`),
    query: String(t.query ?? ''),
    language: languageOf(t),
    expected_rule_id: expectedIsChunk ? null : expected,
    // ⚠️ УББ багц нь ХЭСГИЙН id-г хүлээдэг (`expected_id`), БНбД нь дүрмийн
    //    id-г.  Хоёрыг ялгаж хадгалахгүй бол Recall@5 нь буруу зүйл хэмжинэ.
    expected_chunk_id: expectedIsChunk ? expected : null,
    expected_page: num(t.expected_page),
    raw: t,
    };
  });
}

export function tableRulesTests(rows: ReadonlyArray<Record<string, unknown>>): TestIn[] {
  return rows.map((t, i) => ({
    test_id: String(t.test_id ?? `Q${String(i + 1).padStart(4, '0')}`),
    query: String(t.query ?? ''),
    language: String(t.language ?? 'mn-Cyrl'),
    expected_rule_id: str(t.expected_rule_id),
    expected_chunk_id: null,
    expected_page: num(t.expected_page),
    raw: t,
  }));
}

/**
 * @param docRef — асуултгүй кейсийн асуултыг угсрахад: `{docId, code}`.
 *
 * ⚠️ БНбД 11-08-23-ын кейс АСУУЛТГҮЙ: `{id, rule: "5.21", input, expected}`.
 *    Хоолой асуултаар л ажилладаг тул «<код> <заалт>» гэсэн БҮТЭЦТЭЙ хаяг
 *    угсарна — хэрэглэгч заалтаа нэрлэсэнтэй ижил; хайлтын хэмжүүр биш,
 *    зөвхөн дүрмийн үнэлгээг хэмжинэ.  Хүлээгдэх id нь заалтын хэсэг.
 */
export function normalizeCases(
  rows: ReadonlyArray<Record<string, unknown>>,
  docRef: { docId: string; code: string } | null = null,
  // ⚠️ Хэсгийн id-г угсрах дүрэм БАГЦААР ӨӨР: `…:clause:2.4` (legalinfo) /
  //    `…:2.4` (нэмэлт өөрчлөлттэй БНбД 31-25-22) / «Appendix V» → `…:appendix:В`
  //    (БНбД 31-23-12-ын тооцооны кейс).  Өгөгдмөл нь хуучин зан төлөв.
  chunkIdOf: (docId: string, rule: string) => string = clauseChunkId,
): CaseIn[] {
  return rows.map((c, i) => ({
    case_id: String(c.case_id ?? c.id ?? `C${String(i + 1).padStart(3, '0')}`),
    query_mn:
      str(c.query_mn) ??
      (docRef !== null && str(c.rule) !== null ? `${docRef.code} ${String(c.rule)}` : ''),
    query_latin: str(c.query_latin),
    query_en: str(c.query_en),
    // ⚠️ БНбД нь `context`, УББ нь `inputs` гэж нэрлэдэг — нэг ойлголт.
    context: c.context ?? c.inputs ?? c.input ?? {},
    // ⚠️ ГУРВАН НЭР, НЭГ ОЙЛГОЛТ: `expected_rule_id` (БНбД),
    //    `rule_id` (УББ 12-01-01), `source_rule_id` (УББ-11-201-00).
    //    Гурав дахийг нь аваагүй бол алтан кейс нь дүрмийн id-г ХЭСГИЙН
    //    id мэт үзэж, хэзээ ч таарахгүй — «эх заалт олдсонгүй» гэж унана.
    expected_rule_id:
      str(c.expected_rule_id) ??
      str(c.rule_id) ??
      str(c.source_rule_id) ??
      // БД 21-101-12: тооцооны кейс нь ТОМЬЁО (`formula_id`) эсвэл ЗААЛТ (`clause_id`)
      // руу заадаг — хоёулаа тэр багцад хэсгийн id-тай ижил (хэмжсэн 14/14).
      str(c.formula_id) ??
      str(c.clause_id) ??
      (docRef !== null && str(c.rule) !== null ? chunkIdOf(docRef.docId, String(c.rule)) : null),
    expected: c.expected ?? {},
    must_cite_source: c.must_cite_source !== false,
  }));
}

/**
 * Баримтын АНГИЛЛЫН угтвар («БНбД», «УББ», «БД», «MNS») — ойлголтын alias БИШ.
 *
 * ⚠️ УББ 12-204-01-ийн `aliases.json` «барилгын зураг төсөл» бүлэгт «БНбД»-г
 *    alias болгож өгсөн.  Үр дагавар (хэмжсэн 2026-09-10): «БНбД 11-03-21
 *    одоо хүчинтэй юу?» гэсэн БҮХ асуулт «approved design / batlagdsan zurag
 *    tusul» гэсэн FTS үг авч, даамлын дүрмийн 4.4 («Батлагдсан зураг төсөл…»)
 *    эхэнд гарч байв — БНбД 11-03-21-ийн галиг 69% → 54%, URL 92% → 90.6%.
 *    Норм кодын угтвар нь ямар ч баримтад тодорхой ойлголт заадаггүй тул
 *    бүх багцад ерөнхийлөн хасна.
 */
const DOC_CLASS_TOKENS: ReadonlySet<string> = new Set(['бнбд', 'bnbd', 'убб', 'ubb', 'бд', 'bd', 'mns', 'снип', 'snip']);
function isDocClassToken(alias: string): boolean {
  return DOC_CLASS_TOKENS.has(alias.trim().toLowerCase());
}

/** `aliases.json` (бүлэг) ба `keyword_alias_index.jsonl` (мөр) хоёуланг авна. */
export function normalizeAliasGroups(groups: ReadonlyArray<Record<string, unknown>>): AliasIn[] {
  const out: AliasIn[] = [];
  for (const g of groups) {
    const canonical = str(g.canonical);
    if (canonical === null) continue;
    for (const lang of ['mn', 'latin', 'en'] as const) {
      for (const a of arr(g[lang])) {
        if (isDocClassToken(a)) continue;
        out.push({ canonical, language: lang, alias: a });
      }
    }
  }
  return out;
}

export function normalizeAliasRows(rows: ReadonlyArray<Record<string, unknown>>): AliasIn[] {
  const out: AliasIn[] = [];
  for (const r of rows) {
    const canonical = str(r.canonical) ?? str(r.target_id);
    const alias = str(r.alias);
    if (canonical === null || alias === null || isDocClassToken(alias)) continue;
    // ⚠️ ӨГҮҮЛБЭР БОЛ ALIAS БИШ — `normalizeAliasMap`-тай ИЖИЛ дүрэм.  MCIS багцууд
    //    `keyword_alias_index.jsonl`-д мөн заалтын бүтэн бичвэрийг alias болгож
    //    өгдөг (11-08-23: 1564-ийн 702, 31-23-12: 360-ын 121 — хэмжсэн 2026-09-11);
    //    `aliases.json`-д л шүүж байсан тул тэд энэ замаар САНД ОРСООР байв.
    if (alias.trim().split(/\s+/).length > 6) continue;
    // `mn-Cyrl` → `mn`, `mn-Latn` → `latin` — дотоод нэршилд буулгана.
    const raw = String(r.language ?? 'mn');
    const language = raw.startsWith('mn-Latn') ? 'latin' : raw.startsWith('en') ? 'en' : 'mn';
    out.push({ canonical, language, alias });
  }
  return out;
}

/* ── Профайл 3: аргачилсан зааврын шаардлага (УББ-11-201-00) ─────── */

/**
 * ⚠️ ЗУРГААН ФАЙЛ, НЭГ ХЭЛБЭР.  Багц нь шаардлагаа СЭДВЭЭР нь зургаан
 *    файлд хуваасан (ерөнхий зарчим · зохион байгуулалт · үе шат ·
 *    үнэлгээ · шийдлийн бүлэг · хэрэгжилт) ч мөрийн БҮТЭЦ нь яг ижил:
 *    `clause + page + section + rule_type + requirement_mn`.  Тиймээс
 *    зургаан адаптер БИШ — нэг адаптер, файлын жагсаалт.
 *
 * ⚠️ ЖАГСААЛТЫН ДАРААЛАЛ НЬ ХАМААРАЛГҮЙ: заалт бүрд яг НЭГ шаардлага
 *    ноогддог (хэмжсэн: 7+12+8+22+12+10 = 71 = заалтын тоо), тул
 *    хооронд нь өрсөлдөөн үүсэхгүй.
 */
export const GUIDELINE_RULE_FILES: readonly string[] = [
  'general_principles.jsonl',
  'project_organization_rules.jsonl',
  'project_stage_rules.jsonl',
  'assessment_rules.jsonl',
  'decision_group_rules.jsonl',
  'implementation_rules.jsonl',
];

/**
 * Нэгжийн монгол нэр.
 *
 * ⚠️ ТАНИГДААГҮЙ НЭГЖИЙГ ОРЧУУЛАХГҮЙ, ТҮҮХИЙГЭЭР НЬ ҮЛДЭЭНЭ.  «зөв
 *    сонсогдох» монгол үг таамаглах нь норматив баримтад хамгийн
 *    аюултай зан — «copy» нь «хувь» мөн эсэхийг багц Л мэднэ.
 */
const UNIT_MN: Readonly<Record<string, string>> = {
  year: 'жил',
  month: 'сар',
  day: 'хоног',
  copy: 'хувь',
  percent: '%',
};

/** `20` + `year` → `20 жил`.  Нэгжгүй бол зөвхөн тоо. */
function withUnit(value: string, unit: string | null): string {
  if (unit === null) return value;
  return `${value} ${UNIT_MN[unit] ?? unit}`;
}

/**
 * Тоон шаардлагын хүн уншихуйц нэр.
 *
 * ⚠️ ТОО НЬ `object_mn`-Д ОРНО, `notes`-Д БИШ.  `NormativeAnswer` нь
 *    `notes`-ыг ГАРГАДАГГҮЙ (`pipeline.ts` — зөвхөн `rule_object_mn`),
 *    тул тоог тэнд бичвэл загвар түүнийг ХЭЗЭЭ Ч харахгүй.
 */
function numericObject(r: Record<string, unknown>): string {
  const name = String(r.name ?? '');
  const unit = str(r.unit);
  const value = num(r.value);
  const lo = num(r.min_value);
  const hi = num(r.max_value);

  if (value !== null) return `${name} — ${withUnit(String(value), unit)}`;
  if (lo !== null && hi !== null) return `${name} — ${withUnit(`${lo}–${hi}`, unit)}`;
  if (lo !== null) return `${name} — ${withUnit(`${lo}-с багагүй`, unit)}`;
  if (hi !== null) return `${name} — ${withUnit(`${hi}-с ихгүй`, unit)}`;
  return name;
}

export function guidelineRules(
  docId: string,
  requirements: ReadonlyArray<Record<string, unknown>>,
  numeric: ReadonlyArray<Record<string, unknown>>,
): RuleIn[] {
  const base = (r: Record<string, unknown>, objectMn: string, notes: string[]): RuleIn => {
    const clause = str(r.clause);
    return {
      rule_id: String(r.rule_id ?? ''),
      // ⚠️ Дүрэм нь `chunk_id` ХЭЛДЭГГҮЙ — заалтын дугаараас угсарна.
      //    Угсарсан id олдохгүй бол `ingest.ts` тэр дүрмийг ОРУУЛАХГҮЙ.
      chunk_id: clause === null ? '' : clauseChunkId(docId, clause),
      rule_kind: 'requirement' as RuleKind,
      table_no: null,
      row_no: null,
      clause_no: clause,
      page: num(r.page),
      section: str(r.section),
      object_mn: objectMn,
      // ⚠️ Дүрэмд галиг БАЙХГҮЙ (багц зөвхөн хэсэгт `text_latin` өгдөг).
      //    Хэсгийн галиг нь FTS-д аль хэдийн индекслэгдсэн тул латин
      //    асуулт хөлгүй үлдэхгүй — эндээс хиймэл галиг ҮҮСГЭХГҮЙ.
      object_latin: null,
      // ⚠️ ЖҮЖИГЧИН ТААМАГЛАХГҮЙ.  2.1 нь «мэргэжлийн байгууллага
      //    гүйцэтгэнэ» гэж хэлдэг ч багц `actor` талбар ӨГӨӨГҮЙ; түүнийг
      //    чөлөөт бичвэрээс сугалах нь таамаг болно.  УББ 12-01-01 нь
      //    `actor`-оо ИЛ бичдэг тул тэнд бөглөгддөг — энд `null` нь
      //    «мэдэхгүй» биш, «багц хэлээгүй» гэсэн ҮНЭН.
      actor: null,
      required_context: [],
      // ⚠️ НӨХЦӨЛ ХООСОН, ЗОРИУД.  Энэ баримтын тоонууд нь ХАРЬЦУУЛАХ
      //    босго БИШ, ЗАРЛАСАН УТГА: «төлөвлөлтийн хугацаа 20 жил».
      //    Эх сурвалжид ямар ч харьцуулагч («-аас дээш», «хүртэл») алга.
      //    Хиймэл `>=` зохиовол хоолой хэрэглэгчийн тоог шаардаж
      //    «нөхцөл дутуу» гэж хариулна — «хугацаа нь хэд вэ?» гэсэн
      //    ХАМГИЙН ТҮГЭЭМЭЛ асуултыг яг тэр газраа унагана.
      conditions: [],
      // ⚠️ ALIAS ӨГӨХГҮЙ — УББ 12-01-01-тэй ижил шалтгаан.  Мөр бүрийн
      //    `topics` нь «УББ-11-201-00» гэх БҮХ дүрэмд давтагдах шошго
      //    агуулдаг тул `aliasRuleCandidates`-ын ХАМРАЛТЫН оноог
      //    ханатал дүүргэж, 71 дүрэм бүгд тэнцүү оноо авна.  Энэ багцын
      //    хэсэг бүрийн `search_text` нь монгол · галиг · АНГЛИ гурвыг
      //    ХОЁУЛАНГ агуулдаг тул FTS ганцаараа гурван хэлийг барина.
      aliases_mn: [],
      aliases_latin: [],
      aliases_en: [],
      decision_policy: 'quote_source_clause',
      citation_required: true,
      verification_status: String(r.verification_status ?? 'unknown'),
      notes,
    };
  };

  const out: RuleIn[] = [];

  // ⚠️ `rule_type` (general_principle | organization_rule | …) -ыг `notes`-д
  //    ХУУЛАХГҮЙ: `rule_id` нь түүнийг аль хэдийн агуулдаг
  //    (`…:implementation_action:6.1`) тул давхардуулах нь зөвхөн эвдрэх
  //    боломж нэмнэ.
  for (const r of requirements) {
    out.push(base(r, String(r.requirement_mn ?? ''), []));
  }

  for (const r of numeric) {
    const notes: string[] = [];
    const cond = str(r.condition);
    const recipient = str(r.recipient);
    const qualifier = str(r.qualifier);
    if (cond !== null) notes.push(`Нөхцөл: ${cond}`);
    if (recipient !== null) notes.push(`Хүлээн авагч: ${recipient}`);
    if (qualifier !== null) notes.push(qualifier);
    notes.push(...arr(r.notes));
    out.push(base(r, numericObject(r), notes));
  }

  return out;
}

/* ── Профайл 4: legalinfo заалт + лавлах хүснэгт (БНбД 11-03-21) ────── */

/**
 * ⚠️ ЭНЭ БАГЦЫН ГУРВАН ОНЦЛОГ, гурвуулаа өмнөх гурван хэлбэрт байгаагүй:
 *
 *  1. `rule_id` = ХЭСГИЙН id.  Үүрэг, эрх, тоон шаардлага бүгд
 *     `…:clause:3.9` гэж нэрлэгдэнэ — 3.9-д ГУРВАН тоон мөр, 1.13-д үүрэг
 *     БА шаардлага хоёулаа.  Тэднийг шууд `ai_rules.rule_id` (PK) болговол
 *     сүүлийнх нь эхнийхийг ДАРНА.  Тиймээс дүрмийн id-г ЭХ ХЭСГИЙН id-ээр
 *     угтварлаж (`…:clause:3.9:numeric`, `…:clause:1.13:obligation`)
 *     үүсгэнэ — угтвар нь «энэ дүрэм тэр заалтынх» гэсэн МАШИН УНШИХУЙЦ
 *     холбоос бөгөөд `norm-golden.mjs` түүгээр алтан кейсийг тулгана.
 *
 *  2. МУЖ НЬ ХОЁР МӨР.  «Цооног хоорондын зай 50–60 м» нь
 *     `…_min >= 50` + `…_max <= 60` гэсэн хоёр тусдаа мөрөөр ирнэ.  Тэднийг
 *     хоёр тусдаа нөхцөл болговол 55 м-д «min: хангана, max: хангана»
 *     гэсэн ХОЁР туг гарч, хэрэглэгч «тэгээд багтаж байна уу?» гэж дахин
 *     асуух хэрэгтэй болно.  Нэг `between` нөхцөл = нэг хариу.
 *
 *  3. ХҮСНЭГТИЙН ТОО ЗААЛТЫН БИЧВЭРТ БАЙХГҮЙ.  5.2-р заалт «хүснэгт 5-1-ээр
 *     тогтооно» гэдэг; 50–60 гэсэн тоо зөвхөн `reference_tables.json`-д.
 *     Хэсгийг л шингээвэл «энгийн нөхцөлд зай хэд вэ?» гэсэн асуулт FTS-д
 *     ХЭЗЭЭ Ч тоо олохгүй.  Тиймээс хүснэгтийн мөр бүр ӨӨРИЙН хэсэг
 *     (`kind: 'table_row'`) болно — БНбД 21-04-05-ын хэлбэртэй ижил, зөвхөн
 *     энд бид өөрсдөө угсарна.  Бичвэр нь ХҮСНЭГТИЙН ТООНЫ РЕНДЕР — эх
 *     өгүүлбэр БИШ гэдгийг `metadata.derived_from` ил хэлнэ.
 *
 * ⚠️ ХҮСНЭГТИЙН УТГА БҮР `numeric_requirements.jsonl`-ТЭЙ ТУЛГАГДАНА.
 *    Багц нэг тоог ХОЁР ГАЗАР бичдэг (хүснэгт + тоон мөр); зөрвөл аль нь
 *    зөвийг бид мэдэхгүй → тэр мөр `unverified_reference_table` болж
 *    хөдөлгүүр түүгээр `verified` төлөв ХЭЗЭЭ Ч гаргахгүй.  Тулгагдсан
 *    тоон мөр нь скаляр дүрэмд ДАХИН орохгүй (давхардал нь `loadRuleForChunk`-д
 *    санамсаргүй ялагч төрүүлнэ).
 *
 * ⚠️ ХЭСЭГ БҮР ХУРААНГУЙ (`metadata.paraphrase: true`).  Багц өөрөө «structured
 *    paraphrase/index, not verbatim» гэж мэдэгддэг.  Хэсгийн бичвэрийг
 *    ӨӨРЧЛӨХГҮЙ, тугийг метадатад хадгална — үг үсгийн эшлэл хэрэгтэй бол
 *    `source_locator.url` руу очно.
 */

/** `metadata.authority` / `authority_status` — хавсралт нь «зөвлөмж» байж болно. */
function authorityOf(c: Record<string, unknown>): string {
  const m = (typeof c.metadata === 'object' && c.metadata !== null ? c.metadata : {}) as Record<string, unknown>;
  return str(m.authority) ?? str(m.authority_status) ?? 'normative';
}

/**
 * ⚠️ БНбД 11-08-23 (2026-09-10) хэсэг бүрд `metadata.allow_current_compliance_answer`
 *    хаалт тээдэг: 13 мөр нь Legalinfo-ийн HTML-д ЭВДЭРСЭН (диаметр «12000-1400»,
 *    томьёо сэргээгдээгүй) тул багц өөрөө «нийцлийн хариултад хэрэглэхгүй» гэж
 *    хэлдэг.  Тэдгээрийн төлөв бүгд `…_render_review` (цагаан жагсаалтад ОРООГҮЙ)
 *    тул хаалт аль хэдийн хаалттай — гэвч ирээдүйн багц шалгасан төлөвтэй атлаа
 *    хаалт тавьж болзошгүй тул тугийг төлөвөөс ДЭЭГҮҮР тавина.  Мөр устгагдахгүй
 *    (хайгдана), зөвхөн ГҮЙЦЭТГЭГДЭХГҮЙ.
 */
function chunkVerification(c: Record<string, unknown>, fallback: string): string {
  const m = (typeof c.metadata === 'object' && c.metadata !== null ? c.metadata : {}) as Record<string, unknown>;
  // ⚠️ СНиП II-97-76 (2026-09-10) хэсэгт `verification_status` ОГТ өгдөггүй — зөвхөн
  //    баримтын түвшний провенанс (`mcis_pdf_byte_alignment_verified: false`) ба
  //    хэсгийн хаалт.  Тэр үед баримтаас гаргасан `fallback`; хаалттай хэсэг нь
  //    ГҮЙЦЭТГЭГДЭХГҮЙ төлөв.
  const status = rowVerification(c) ?? (m.allow_current_compliance_answer === false ? 'needs_human_review' : fallback);
  if (m.allow_current_compliance_answer === false && isExecutableVerification(status)) return 'needs_human_review';
  return status;
}

/**
 * Баримтын түвшний провенансаас хэсгийн ӨГӨГДМӨЛ баталгаажилт.
 *
 * ⚠️ `mcis_pdf_byte_alignment_verified: false` = техникийн бичвэр нь албан ёсны
 *    PDF-тэй тулгагдаагүй MIRROR (СНиП II-97-76: 1990 оны нэгтгэсэн орос эх).
 *    Түүнийг `verified_official_text` гэж нэрлэх нь ХУДАЛ; тусдаа мөр —
 *    `rules.ts`-д ил нэмэгдсэн, эшлэлд хуулийн хяналтын туг ХЭВЭЭР.
 */
export function documentVerificationFallback(doc: Record<string, unknown>, declared: string | null = null): string {
  if (doc.mcis_pdf_byte_alignment_verified === false) return 'verified_mirror_text_mongolia_listed';
  // GAP-025: багц мөр бүрдээ (үүрлэсэн ч гэсэн) НЭГ ижил төлөв зарласан бол ТЭР нь баримтын
  //    өгөгдмөл — `verified_official_text` гэж дээшлүүлэхгүй.  31-23-12 (`official_mcis_pdf`),
  //    31-24-22 (`registered_full_text`) ингэж чимээгүй гүйцэтгэгдэх болж байсан (хэмжсэн
  //    2026-09-14: 349 + 395 дүрэм).  Одоо тэр төлөв `rules.ts`-ийн бүртгэлээр ангилагдана.
  if (declared !== null) return declared;
  return 'verified_official_text';
}

/**
 * GAP-025: мөрийн ЗАРЛАСАН баталгаажилтын төлөв — дээд түвшин, эсвэл `source.` /
 * `answer_source.verification_status` (MCIS GOLD v3 багцууд мөрийн төлөвөө эх сурвалжийн
 * объектод бичдэг: 31-23-12 `official_mcis_pdf`, 31-24-22 `registered_full_text`,
 * 11-106-25 `verified_content_extract`).
 *
 * ⚠️ Үүрлэсэн ерөнхий «verified» (11-08-23-ын duty/formula мөр) нь ЭХ СУРВАЛЖИЙН үг, мөрийн
 *    төлөв БИШ — өмнөх шийдвэр хэвээр: тэр үед `null` буцааж эх хэсгийн төлөвийг өвлүүлнэ.
 *    Нарийн нэртэй үүрлэсэн төлөв нь харин мөрийн ӨӨРИЙНХ: түүнийг үл тоовол баримтын
 *    өгөгдмөл (`verified_official_text`) дээр нь дарж ЧИМЭЭГҮЙ гүйцэтгэгдэх болгоно.
 */
export function rowVerification(r: Record<string, unknown>): string | null {
  const top = str(r.verification_status);
  if (top !== null) return top;
  for (const key of ['source', 'answer_source']) {
    const o = r[key];
    if (typeof o === 'object' && o !== null) {
      const nested = str((o as Record<string, unknown>).verification_status);
      if (nested !== null && nested !== 'verified') return nested;
    }
  }
  return null;
}

/** Багцын бүх хэсэг ИЖИЛ зарласан төлөвтэй бол тэр нь (олонх нь); зөрвөл `null`. */
export function dominantDeclaredVerification(rows: ReadonlyArray<Record<string, unknown>>): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = rowVerification(r);
    if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  // Олонх нь мөрүүдийн ≥ 90 % байх ёстой — эс тэгвэл «баримтын өгөгдмөл» гэж хэлж болохгүй.
  return best !== null && n >= rows.length * 0.9 ? best : null;
}

export function legalinfoChunks(rows: ReadonlyArray<Record<string, unknown>>, fallbackVerification = 'unknown'): ChunkIn[] {
  return rows.map((c) => {
    const chunkId = String(c.chunk_id ?? '');
    const kind = String(c.kind ?? 'normative_clause');
    const textEn = str(c.text_en);
    const textLatin = str(c.text_latin);
    const section = str(c.section);
    const answer = (typeof c.answer_source === 'object' && c.answer_source !== null ? c.answer_source : {}) as Record<string, unknown>;
    const meta = (typeof c.metadata === 'object' && c.metadata !== null ? c.metadata : {}) as Record<string, unknown>;
    // `search_text` өгөөгүй багц (СНиП): бичвэр + эх сурвалжийн хаяг («заалт 2.10»)
    // + шошго — «СНиП II-97-76 2.10» гэсэн хаягаар олдохын тулд.
    // ⚠️ Хүснэгтийн ID (`APP-B1`, `T-5.1.14-1`) нь багцын өөрийн хаяг — тестүүд
    //    («БНбД 31-24-22 APP-B1») тэр нэрээр асуудаг, бичвэрт байдаггүй.
    const tableId = chunkId.includes(':table:') ? (chunkId.split(':table:')[1] ?? '') : '';
    const ownSearch =
      str(c.search_text) ??
      [String(c.text_mn ?? ''), str(answer.norm_code) ?? '', str(answer.locator) ?? '', tableId, ...arr(meta.tags)].filter((x) => x.length > 0).join(' ');
    // ⚠️ БҮЛГИЙН НЭРИЙГ хайлтын мөрөнд нэмнэ.  4.8-р заалт «Энэ шатанд …»
    //    гэж эхэлдэг — ямар шат гэдэг нь зөвхөн бүлгийн нэрэнд («Дөрөв.
    //    Эх загвар зураг / ТЭЗҮ үе шат»).  Үүнгүйгээр «эх загварын шатанд
    //    29%» гэсэн асуулт 5.6-г (ажлын зургийн шат, 50%) олж байв (хэмжсэн:
    //    алтан кейс GOLD-4.8-29).  Зөвхөн ЭНЭ багцад — бусад багцын
    //    `search_text`-ийг тэдний өөрсдийнх нь бүтээгч угсарсан.
    const searchText = [ownSearch, section ?? '', textEn ?? '']
      .filter((part, i, all) => part.length > 0 && all.indexOf(part) === i && (i === 0 || !all[0]!.includes(part)))
      .join(' ');
    /**
     * ⚠️ ХАВСРАЛТ, ХҮСНЭГТИЙН ХЭСГИЙН ХАЯГ НЬ БАГЦЫН `answer_source.locator`.
     *    БНбД 31-23-12 / 31-24-22 (2026-09-11) хавсралтын хэсгийн `section` нь
     *    «Хавсралт» / «Appendices» / «Tables/appendices» гэсэн ЕРӨНХИЙ үг,
     *    харин `locator` нь «Хавсралт Д», «А хавсралт, А.1 хүснэгт» гэсэн
     *    яг хаяг.  Эшлэлийн шошго `section_path`-ийн ЭХНИЙ сегментийг авдаг
     *    тул хаягийг эхэнд тавина — «БНбД 31-23-12, Хавсралт» гэсэн эшлэл
     *    хүнийг хаана ч хүргэхгүй.  Заалтын хэсэгт ХӨНДӨХГҮЙ (бүлгийн нэр
     *    нь хайлтын дохио — доорх 4.8-ын тэмдэглэл).  Хуудас, заалтын дугаар
     *    ЗОХИОГДОХГҮЙ хэвээр; `isCitable` хаягийн үгээр таньдаг болсон.
     */
    const locator = str(answer.locator);
    const isAddressKind = /:(table|appendix):/.test(chunkId) || /^(table|structured_table|appendix_index|appendix_row)$/.test(kind);
    const sectionPath =
      isAddressKind && locator !== null && (section === null || !section.includes(locator))
        ? [locator, section].filter((x): x is string => x !== null).join(' / ')
        : section;
    return {
      chunk_id: chunkId,
      kind,
      // ⚠️ Заалтын хуудас ЗОРИУД NULL (README: «does not fabricate printed-page
      //    numbers»).  Заалтын дугаар нь хуулийн хаяг; хавсралт л эхлэх
      //    хуудастай.  Хуудас зохиовол эшлэл хүнийг буруу газар илгээнэ.
      page: num(c.printed_page),
      source_pdf_page: num(c.pdf_page),
      // ⚠️ СНиП: `…:table:1` (хүснэгтийн гарчиг) ба `…:appendix:001` (хавсралтын
      //    мөр) хэсгүүд — «1-р хүснэгт», «Хавсралт, мөр 1» гэсэн бүтэцтэй хаягаар
      //    олдохын тулд `table_no`/`row_no`-г id-ээс авна (багц өөрөө өгдөггүй).
      // ⚠️ 31-24-22-ын `…:table:APP-A1` — тоон бус хүснэгтийн id; `Number()` нь NaN
      //    → `num` null.  Хаяг нь `section_path`-д (дээр).
      table_no: kind === 'table' ? (num(Number(chunkId.split(':table:')[1])) ?? null) : null,
      row_no: kind === 'appendix_row' ? String(Number(chunkId.split(':appendix:')[1])) : null,
      clause_no: clauseFromChunkId(chunkId),
      section_path: sectionPath,
      // GAP-023: СНиП хавсралтын мөр `{'without_used_attic': 51, …}` гэсэн Python repr-тэй
      //    ирдэг — түүхий файл засагдаагүй байсан ч санд хүний уншихуйц хэлбэрээр орно.
      text_mn: cleanPythonRepr(String(c.text_mn ?? '')),
      text_latin: textLatin === null ? null : cleanPythonRepr(textLatin),
      // ⚠️ Англи бичвэрийг ХАЙЛТЫН мөрөнд л нэмнэ — `text_mn` ХӨНДӨГДӨХГҮЙ.
      //    Хуулийн төлөвийн хэсэг зөвхөн `text_en`-д «repealed» гэж хэлдэг тул
      //    үүнгүйгээр англи асуулт тэр хэсгийг олохгүй.
      search_text: cleanPythonRepr(searchText),
      authority_level: authorityOf(c),
      visibility: 'public_norm',
      verification_status: chunkVerification(c, fallbackVerification),
      retrieval_weight:
        kind === 'legal_status' || kind === 'appendix_index' || kind === 'section_index' || kind === 'source_integrity' ? 1.0 : 1.2,
      metadata: {
        ...((typeof c.source_locator === 'object' && c.source_locator !== null ? c.source_locator : {}) as object),
        ...((typeof c.metadata === 'object' && c.metadata !== null ? c.metadata : {}) as object),
        // GOLD v3: хэсэг бүрийн машин уншихуйц эх сурвалж (locator + URL +
        // legal_status).  `pipeline.ts`-ийн `sourceUrlOf` эндээс уншина.
        ...(typeof c.answer_source === 'object' && c.answer_source !== null ? { answer_source: c.answer_source } : {}),
      },
    };
  });
}

/** Файл → дүрмийн ангилал.  `liability_rules.jsonl` энэ багцад хоосон ч хэлбэр нь мэдэгдэж байна. */
export const LEGALINFO_PROSE_FILES: ReadonlyArray<readonly [string, RuleKind]> = [
  ['duty_rules.jsonl', 'obligation'],
  ['rights_rules.jsonl', 'right'],
  // ⚠️ «Мэргэшлийн» дүрэм (1.4 «тусгай зөвшөөрөлтэй хуулийн этгээд гүйцэтгэнэ»)
  //    нь хэн нэгний ҮҮРЭГ биш, ажилд тавих ШААРДЛАГА — `requirement` нь яг
  //    тэр утгаар УББ-11-201-00-д нэмэгдсэн ангилал.
  ['qualification_rules.jsonl', 'requirement'],
  ['liability_rules.jsonl', 'responsibility'],
];

export function legalinfoProseRules(
  files: ReadonlyArray<{ kind: RuleKind; rows: ReadonlyArray<Record<string, unknown>> }>,
  chunks: ReadonlyArray<ChunkIn> = [],
): RuleIn[] {
  const out: RuleIn[] = [];
  for (const { kind, rows } of files) {
    for (const r of rows) {
      const chunkId = String(r.rule_id ?? '');
      // ⚠️ ХОЁР ХЭЛБЭР: 11-03-21 нь `rule_json.text_mn` бүрхүүлтэй, 11-08-23 нь
      //    ХАВТГАЙ (`duty_mn` / `text_mn` / `prohibition_or_constraint_mn` /
      //    `right_mn`).  Нэг нийтлэгчийн хувьсаж буй хэлбэр — хоёуланг авна.
      const body = (typeof r.rule_json === 'object' && r.rule_json !== null ? r.rule_json : r) as Record<string, unknown>;
      const text =
        str(body.text_mn) ?? str(body.duty_mn) ?? str(body.prohibition_or_constraint_mn) ?? str(body.right_mn) ?? str(body.requirement_mn) ?? '';
      // Хавтгай мөр `verification_status` өгдөггүй — `source.verification_status`
      // («verified») нь эх сурвалжийн, мөрийн биш; эх ХЭСГИЙН төлөвийг өвлөнө.
      const chunk = chunks.find((c) => c.chunk_id === chunkId);
      out.push({
        rule_id: `${chunkId}:${kind}`,
        chunk_id: chunkId,
        rule_kind: kind,
        table_no: null,
        row_no: null,
        clause_no: clauseFromChunkId(chunkId),
        page: num(r.printed_page),
        section: str(r.section),
        object_mn: text,
        object_latin: null,
        // ⚠️ Багц `actor` өгдөггүй — чөлөөт бичвэрээс таамаглахгүй.
        actor: null,
        required_context: [],
        conditions: [],
        // Alias өгөхгүй — УББ 12-01-01-тэй ижил шалтгаан (хамралтын оноо ханадаг).
        aliases_mn: [],
        aliases_latin: [],
        aliases_en: [],
        decision_policy: 'quote_source_clause',
        citation_required: true,
        verification_status: str(r.verification_status) ?? chunk?.verification_status ?? 'unknown',
        notes: [],
      });
    }
  }

  /**
   * ⚠️⚠️ БАГЦЫН ХЭСЭГ БҮРД ДҮРЭМ БАЙХ ЁСТОЙ — pipeline-ийн эшлэлийн шалтгаанаар.
   *
   *    `pipeline.ts` эшлэлийг нотолгооны ЭХНИЙ ДҮРЭМТЭЙ хэсгээс авдаг.
   *    Өмнөх гурван баримтад бараг хэсэг бүр дүрэмтэй (гал: 126/126,
   *    УББ 12-01-01: 39/46, УББ-11-201-00: 71/73) тул энэ нь ажиглагдаагүй.
   *    Энэ баримтад 176 хэсгийн зөвхөн 24 нь үүрэг/эрх/мэргэшлийн файлд
   *    байдаг — үлдсэн 152-т дүрэм өгөхгүй бол:
   *      • «БНбД 11-03-01 хүчинтэй юу?» → нотолгоо зөв ч эшлэл УББ 12-01-01
   *        2.5 (3-р байр) болж байв;
   *      • зөвхөн төлөвийн хэсэгт дүрэм өгөхөд «БНбД 11-03-21 1.1 …» гэсэн
   *        213 тестийн 138-д эшлэл нь 1.1-ийн оронд ХҮЧИНГҮЙ БОЛСОН нормын
   *        URL-тай (`lawId=7585`) төлөвийн хэсэг болж байв — GOLD v3-ийн
   *        «Эх сурвалж» гэрээг яг эсрэгээр нь зөрчинө (хэмжсэн 2026-09-10).
   *    Тиймээс УББ-11-201-00-тэй ижил: заалт бүр `quote_source_clause`
   *    шаардлага.  Файлд байгаа 24 нь өөрийн ангиллаа хадгална.
   */
  const covered = new Set(out.map((r) => r.chunk_id));
  for (const c of chunks) {
    if (covered.has(c.chunk_id) || c.kind === 'table_row') continue;
    /**
     * ⚠️ ХУУЛИЙН ТӨЛӨВИЙН ХЭСЭГТ ХАЙЛТЫН ALIAS.  «БНбД 11-08-23 хүчин төгөлдөр
     *    үү, өмнөх норм нь юу болсон бэ?» гэсэн асуултад төлөвийн хэсэг
     *    олдохгүй байв (хэмжсэн: 508 тестийн 2 алдаа) — хэсгийн бичвэр
     *    «мөрдөгдөж эхэлсэн», «хүчингүй болж … шинэчлэгдсэн» гэдэг, «хүчин
     *    төгөлдөр» гэсэн үг байхгүй, багц `search_text` ч өгөөгүй.  Alias
     *    нь ЗӨВХӨН хайлтын талд (`search.ts`-ийн дүрэм) — хариултын бичвэрт
     *    орохгүй; утга нь `document.json`-ийн `legal_status`-аас шалгагдсан.
     */
    const statusAliases =
      c.kind !== 'legal_status'
        ? []
        : c.chunk_id.endsWith(':supersedes')
          ? ['өмнөх норм', 'хүчингүй болсон', 'орлосон норм', 'солигдсон норм', 'хуучин норм']
          : ['хүчин төгөлдөр', 'хүчинтэй эсэх', 'мөрдөгдөж буй', 'батлагдсан огноо'];
    out.push({
      rule_id: `${c.chunk_id}:requirement`,
      chunk_id: c.chunk_id,
      rule_kind: 'requirement',
      table_no: null,
      row_no: null,
      clause_no: c.clause_no,
      page: c.page,
      section: c.section_path,
      object_mn: c.kind === 'appendix_index' ? `${c.section_path ?? 'Хавсралт'}: ${c.text_mn}` : c.text_mn,
      object_latin: null,
      actor: null,
      required_context: [],
      conditions: [],
      aliases_mn: statusAliases,
      aliases_latin: [],
      aliases_en: [],
      decision_policy: 'quote_source_clause',
      citation_required: true,
      verification_status: c.verification_status,
      notes: [],
    });
  }
  return out;
}

/* ── Профайл: журам (БНбД 11-03-02) ────────────────────────────────── */

export interface ProcedureRuleSources {
  procedures: ReadonlyArray<Record<string, unknown>>;
  approvals: ReadonlyArray<Record<string, unknown>>;
  documents: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Журмын гурван файлыг legalinfo-ийн ХАВТГАЙ мөр болгож `legalinfoProseRules`-д өгнө —
 * тэр нь дүрэмгүй үлдсэн хэсэг бүрд `quote_source_clause` шаардлага нэмдэг (эшлэлийн
 * толгой дүрэмтэй хэсгээс гардаг тул заавал).  Дүрмийн төрөл бүгд `requirement`: журам
 * нь субъектийн үүрэг гэхээсээ «ийм алхам, ийм баримт, ийм зөвшөөрөл» гэсэн шаардлага.
 *
 * ⚠️ `source_clause` нь хэсгийн id-тай яг таарахгүй байж болно: «2.1» гэсэн заалт багцад
 *    `clause:2.1.a` / `clause:2.1.b` гэж хуваагдсан, «1.5 + page 9 list» гэсэн нийлмэл хаяг
 *    ч бий.  Эхлээд яг таарсан хэсэг, дараа нь `clause:<n>.`-ээр эхэлсэн ЭХНИЙ хэсэг;
 *    олдохгүй бол мөрийг АЛГАСНА (эшлэлгүй дүрэм оруулахгүй — `ingest.ts`-ийн дүрэм).
 *    Зөвшөөрөл/баримтын мөр өөрийн хэсэгтэй (`approval:AP01`, `required_document:RD01`).
 */
export function procedureRules(docId: string, src: ProcedureRuleSources, chunks: ReadonlyArray<ChunkIn>): RuleIn[] {
  const ids = new Set(chunks.map((c) => c.chunk_id));
  const byClause = (raw: unknown): string | null => {
    const m = /^\s*(\d+(?:\.\d+)*)/.exec(String(raw ?? ''));
    if (m === null) return null;
    const exact = clauseChunkId(docId, m[1]!);
    if (ids.has(exact)) return exact;
    const prefix = `${exact}.`;
    return chunks.find((c) => c.chunk_id.startsWith(prefix))?.chunk_id ?? null;
  };
  const rows: Array<Record<string, unknown>> = [];
  const push = (chunkId: string | null, text: string | null, r: Record<string, unknown>): void => {
    if (chunkId === null || text === null) return;
    rows.push({ rule_id: chunkId, text_mn: text, printed_page: r.page, verification_status: r.verification_status });
  };
  for (const r of src.procedures) push(byClause(r.source_clause), str(r.description_mn), r);
  for (const r of src.approvals) {
    const id = `${docId}:approval:${String(r.approval_id ?? '').split(':').pop() ?? ''}`;
    const mode = str(r.mode);
    push(ids.has(id) ? id : byClause(r.source_clause), str(r.authority_mn) === null ? null : `${r.authority_mn}${mode ? ` — ${mode}` : ''}`, r);
  }
  for (const r of src.documents) {
    const id = `${docId}:required_document:${String(r.requirement_id ?? '').split(':').pop() ?? ''}`;
    push(ids.has(id) ? id : byClause(r.source_clause), str(r.name_mn), r);
  }
  // ⚠️ Нэг хэсэгт олон мөр ирж болно (2.1.a-д хоёр алхам) — `rule_id` давхцвал INSERT унана;
  //    эхнийхийг үлдээж бусдыг тэр хэсгийн ерөнхий шаардлагад хамааруулна (текст нь хэсэгт бий).
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(String(r.rule_id)) ? false : (seen.add(String(r.rule_id)), true)));
  return legalinfoProseRules([{ kind: 'requirement', rows: unique }], chunks.filter((c) => c.kind !== 'metadata'));
}

/* ── Тоон шаардлага ────────────────────────────────────────────────── */

export interface NumericRow {
  rule_id: string;
  /** Заалтын дугаар (`rule_id` хэсгийн id биш үед). */
  locator?: string | null;
  /** Эх сурвалжийн хаяг («Хавсралт, мөр 1») — хэсгийг олоход нөөц зам. */
  source_locator?: string | null;
  name: string;
  operator: string;
  /** Тоо, тоон муж, эсвэл ХАРЬЦУУЛАХ БОЛОМЖГҮЙ зарласан утга («1:5000», багц). */
  value: number | [number, number] | string;
  unit: string | null;
  condition: string | null;
  verification_status: string;
}

/**
 * ⚠️ БНбД 11-08-23-ын тоон мөр ГУРВАН зүйлээр өөр:
 *    • `operator: "range"` + `value: [15, 20]` — муж нэг мөрөөр (11-03-21-д
 *      `_min`/`_max` хос байсан);
 *    • `value: "1:5000"`, `operator: "set"` + `["1:500", "1:1000"]` — масштаб
 *      гэх мэт ХАРЬЦУУЛАХ БОЛОМЖГҮЙ утга.  Тэднийг тоо болгож ЗОХИОХГҮЙ:
 *      дүрмийн объектын бичвэрт зарласан утга болж орно, нөхцөл БОЛОХГҮЙ;
 *    • `verification_status: "verified"` + `usable_for_current_compliance` туг.
 *      «verified» гэсэн ерөнхий үгийг цагаан жагсаалтад оруулбал ирээдүйн дурын
 *      багц «verified» гэж бичээд гүйцэтгэгдэнэ — тиймээс тугтай нь хамт
 *      ХЭСГИЙН төлөв (`verified_official_text`, ижил эх) болгож буулгана;
 *      туг `false` (5 мөр: «as_rendered», HTML эргэлзээтэй) бол багцын өөрийн
 *      `source_render_review` хэвээр → гүйцэтгэгдэхгүй.
 */
export function legalinfoNumericRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  fallbackVerification = 'unknown',
): NumericRow[] {
  const out: NumericRow[] = [];
  for (const r of rows) {
    const name = str(r.name);
    const ruleId = str(r.rule_id);
    if (name === null || ruleId === null) continue;
    const raw = r.value;
    // ⚠️ БНбД 31-25-22 нэг мөрөнд `" >="` (урд зайтай) бичсэн — trim хийхгүй бол
    //    харьцуулагч танигдахгүй, 2.5-ын талбайн босго чимээгүй алга болно.
    const operator = String(r.operator ?? '').trim();
    let value: NumericRow['value'] | null = num(raw);
    // ⚠️ ХОЁР ТООНЫ МАССИВ НЬ ЗӨВХӨН `range`/`between`-Д МУЖ.  БНбД 31-24-22-ын
    //    хавсралтын мөр `>= [100, 50]` гэж бүлгийн хэмжээний ХОЁР БАГАНЫ утгыг
    //    өгдөг — түүнийг муж гэж уншвал «100–50 м²» гэсэн утгагүй нөхцөл, эсвэл
    //    (`legalinfoConditions` алгасаад) объектын бичвэрт НЭР л үлдэж тоо
    //    алдагдана.  Мужгүй харьцуулагчид зарласан утга («100, 50») болно.
    if (
      value === null &&
      Array.isArray(raw) &&
      raw.length === 2 &&
      typeof raw[0] === 'number' &&
      typeof raw[1] === 'number' &&
      (operator === 'range' || operator === 'between')
    ) {
      value = [raw[0], raw[1]];
    }
    if (value === null && typeof raw === 'string' && raw.length > 0) value = raw;
    if (value === null && Array.isArray(raw)) value = raw.map((v) => String(v)).join(', ');
    if (value === null) continue;
    let status = rowVerification(r) ?? (r.usable_for_current_compliance === false ? 'source_render_review' : fallbackVerification);
    if (status === 'verified') {
      status = r.usable_for_current_compliance === false ? 'source_render_review' : 'verified_official_text';
    }
    // ⚠️ Багцын ӨӨРИЙН хаалт (`usable_for_current_compliance: false`) нь эх сурвалжийн төлөвөөс
    //    ДЭЭГҮҮР: мөр өөрөө `registered_full_text` (эзний баталсан мөр) зарласан ч багц «нийцлийн
    //    хариултад хэрэглэхгүй» гэсэн бол ГҮЙЦЭТГЭГДЭХГҮЙ (31-24-22-ын 4 мөр — хэмжсэн 2026-09-14).
    //    Туг төлөвийг ДЭЭШЛҮҮЛЭХГҮЙ (тэр чиглэл хаалттай), зөвхөн ДООШЛУУЛНА.
    if (r.usable_for_current_compliance === false && isExecutableVerification(status)) status = 'source_render_review';
    out.push({
      rule_id: ruleId,
      // ⚠️ СНиП: `rule_id` нь ХЭСГИЙН id БИШ («…:2.10:water_freeboard»), заалт нь
      //    `locator`-т.  Хоёуланг нь хадгална; `legalinfoScalarRules` шийднэ.
      // ⚠️ БНбД 11-106-25 (2026-09-21): мөр `locator` ӨГДӨГГҮЙ, заалтаа `clause`-д бичдэг
      //    («1.1», «В.1.1»).  Нөөцгүй бол 145 тоон мөр бүгд эх хэсэггүй болж шингээгдэхгүй
      //    байв (хэмжсэн) — хэсэг нь `…:clause:1.1` гэж багцад БИЙ.
      locator: str(r.locator) ?? str(r.clause),
      source_locator: typeof r.source === 'object' && r.source !== null ? str((r.source as Record<string, unknown>).locator) : null,
      name,
      operator,
      value,
      unit: str(r.unit),
      condition: str(r.condition) ?? str(r.condition_text),
      verification_status: status,
    });
  }
  return out;
}

const UNIT_MN_GEO: Readonly<Record<string, string>> = {
  m: 'м',
  borehole: 'цооног',
  boreholes: 'цооног',
  percent: '%',
  '%': '%',
  samples: 'дээж',
  year: 'жил',
  // БНбД 11-08-23 (геодези)
  mm: 'мм',
  cm: 'см',
  km: 'км',
  day: 'хоног',
  month: 'сар',
  floor: 'давхар',
  degree: '°',
  arcsec: '″',
  point: 'цэг',
  benchmark: 'репер',
  direction: 'чиглэл',
  'times/year': 'удаа/жил',
  'mm/km': 'мм/км',
  'line/mm': 'шугам/мм',
  mm_abs: 'мм',
  m_abs: 'м',
  // Масштаб, харьцаа — утга нь өөрөө «1:5000» хэлбэртэй тул нэгж давхардуулахгүй.
  ratio: '',
  scale: '',
  scale_equivalent: '',
  // СНиП II-97-76
  ha: 'га',
  count: 'ш',
  kV: 'кВ',
  'm/s': 'м/с',
  'kg/m2': 'кг/м²',
  'm2/person': 'м²/хүн',
  'm2/car': 'м²/машин',
  'car/100_workers': 'машин/100 ажилтан',
  percent_of_table_value: '% (хүснэгтийн утгаас)',
  // БНбД 31-23-12 / 31-24-22 / 31-25-22 (олон нийтийн барилга, цэцэрлэг, сургууль)
  m2: 'м²',
  m3: 'м³',
  'm2/child': 'м²/хүүхэд',
  'm2/student': 'м²/сурагч',
  'm2/workplace': 'м²/ажлын байр',
  'm2/employee': 'м²/ажилтан',
  'm2/seat': 'м²/суудал',
  'm2/class': 'м²/анги',
  'm2/room': 'м²/өрөө',
  'm2/reader': 'м²/уншигч',
  student: 'сурагч',
  child: 'хүүхэд',
  'child/group': 'хүүхэд/бүлэг',
  employee: 'ажилтан',
  person: 'хүн',
  seat: 'суудал',
  group: 'бүлэг',
  storey: 'давхар',
  exit: 'гарц',
  entrance: 'орц',
  hour: 'цаг',
  kW: 'кВт',
  W: 'Вт',
  'W/m2': 'Вт/м²',
  C: '°C',
  dB: 'дБ',
  dBA: 'дБА',
  lux: 'лк',
  'm3/h per child': 'м³/ц нэг хүүхдэд',
};

function unitMn(unit: string | null): string {
  if (unit === null) return '';
  return UNIT_MN_GEO[unit] ?? unit;
}

/**
 * Гарах орны нөхцөл — «цооногоос», «дээжээс», «жилээс», «м-ээс», «%-иас».
 * Үгийн сүүлийн эгшгээр (эгшиг зохицол); тэмдэгт нэгжид зураастай.
 */
function ablative(u: string): string {
  if (u === '') return '-ээс';
  if (u === '%') return '%-иас';
  if (u === 'м') return 'м-ээс';
  // Товчлол, тэмдэгт нэгж (мм, см, км, ″, мм/км, H) — зураастай, эгшиг зохицолгүй:
  // «12 мм-ээс ихгүй».  Хэмжсэн: «12 ммээс» гэж наалдаж байв.
  if (u.length <= 3 || /[\/°″A-Za-z]/.test(u)) return `${u}-${u === '°' ? 'аас' : 'ээс'}`;
  const vowels = [...u].filter((ch) => 'аоуэөүиеяёю'.includes(ch));
  const last = vowels[vowels.length - 1] ?? 'э';
  const suffix = 'ая'.includes(last) ? 'аас' : 'оё'.includes(last) ? 'оос' : last === 'ө' ? 'өөс' : last === 'у' ? 'аас' : 'ээс';
  return `${u}${suffix}`;
}

/** «10 м-ээс багагүй» / «5 жилээс ихгүй» / «1 м» / «3–5 м». */
function boundMn(comparator: Comparator, value: number | [number, number], unit: string | null): string {
  const u = unitMn(unit);
  const sp = u === '%' || u === '' ? '' : ' ';
  if (Array.isArray(value)) return `${value[0]}–${value[1]}${sp}${u}`;
  const v = `${value}${sp}${u}`;
  const from = `${value}${sp}${ablative(u)}`;
  switch (comparator) {
    case '>=':
      return `${from} багагүй`;
    case '>':
      return `${from} их`;
    case '<=':
      return `${from} ихгүй`;
    case '<':
      return `${from} бага`;
    default:
      return v;
  }
}

/**
 * Тоон шаардлагын НЭР → монгол шошго + контекстийн талбар.
 *
 * ⚠️ ТАЛБАРЫГ НЭРЭЭС ТААМАГЛАХГҮЙ.  Багц `field` өгдөггүй; «_depth» гэсэн
 *    хэсэг нь цооногийн гүн, дээжийн гүний алхам, малталтын гүн гурвыг
 *    ЗЭРЭГ хэлж болно.  Энд байхгүй нэр нь ТАЛБАРГҮЙ үлдэнэ → хөдөлгүүр
 *    «нөхцөл дутуу» гэж хэлнэ, ХЭЗЭЭ Ч буруу тоог уншихгүй.
 *
 * ⚠️ Талбарын нэрс нь багцын ӨӨРИЙН алтан кейсийн (`inputs`) нэрс —
 *    `borehole_depth_m`, `sampled_percent`, `spacing_m`, … — тэднийг
 *    зохиогоогүй, тул маягт/чат тэр нэрээр өгвөл шууд таарна.
 */
const NUMERIC_NAMES: Readonly<Record<string, { mn: string; field: string }>> = {
  permafrost_min_borehole_depth: { mn: 'цэвдэг баталгаажуулах цооногийн гүн', field: 'borehole_depth_m' },
  permafrost_temperature_interval: { mn: 'температурын хэмжилтийн алхам', field: 'temperature_interval_m' },
  permafrost_min_borehole_count: { mn: 'баталгаажуулах цооногийн тоо', field: 'borehole_count' },
  active_process_extra_depth: { mn: 'идэвхтэй үзэгдлийн нөлөөллийн гүнээс доош нэмэлт гүн', field: 'extra_depth_m' },
  small_building_min_boreholes: { mn: 'жижиг барилгын цооногийн тоо', field: 'borehole_count' },
  sampled_boreholes_fraction: { mn: 'дээж авсан цооног, малталтын хувь', field: 'sampled_percent' },
  sample_depth_representation_interval: { mn: 'дээжлэлтийн гүний алхам', field: 'sample_depth_interval_m' },
  min_samples_per_engineering_geological_element: { mn: 'нэг элементийн дээжийн тоо', field: 'sample_count' },
  trench_average_depth: { mn: 'траншейн дундаж гүн', field: 'trench_depth_m' },
  ordinary_soil_min_distinguishable_layer_thickness: { mn: 'энгийн хөрсөнд ялгах үеийн зузаан', field: 'layer_thickness_m' },
  special_soil_min_distinguishable_layer_thickness: { mn: 'онцгой хөрсөнд ялгах үеийн зузаан', field: 'layer_thickness_m' },
  concept_stage_sampled_boreholes_fraction: { mn: 'дээж авсан цооног, малталтын хувь', field: 'sampled_percent' },
  concept_stage_sampling_depth_interval: { mn: 'дээжлэлтийн гүний алхам', field: 'sample_depth_interval_m' },
  foundation_exposure_below_base: { mn: 'суурийн улнаас доош ил гаргах гүн', field: 'depth_below_base_m' },
};

/** `x_min` / `x_max` → `x`; бусад нь хэвээр. */
function baseName(name: string): string {
  return name.replace(/_(min|max)$/, '');
}

/**
 * Нэг заалтын тоон мөрүүдийг НЭРЛЭСЭН нөхцөлүүд болгоно; `_min`/`_max` хос
 * нь ганц `between` болж нийлнэ.
 *
 * ⚠️ ХОС ДУТУУ БОЛ ХОСЛУУЛАХГҮЙ: `_min` л байвал `>=`, `_max` л байвал `<=` —
 *    нөгөө талыг нь зохиохгүй.
 */
export function legalinfoConditions(rows: readonly NumericRow[]): RuleIn['conditions'] {
  const groups = new Map<string, NumericRow[]>();
  for (const r of rows) {
    const key = baseName(r.name);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: RuleIn['conditions'] = [];
  for (const [key, members] of groups) {
    const lo = members.find((m) => m.name.endsWith('_min') && m.operator === '>=' && typeof m.value === 'number');
    const hi = members.find((m) => m.name.endsWith('_max') && m.operator === '<=' && typeof m.value === 'number');
    const meta = NUMERIC_NAMES[key];
    const label = meta?.mn ?? key;
    // ⚠️ Талбарын нэр: гар зурагласан нэр (11-03-21) → багцын ӨӨРИЙН алтан
    //    кейсийн нэр (`FIELD_BY_NAME`) → тоон мөрийн НЭР өөрөө.  Сүүлийнх нь
    //    таамаг биш: багцын тодорхойлсон тэмдэглэгээ, `missing_context`-д яг
    //    тэр нэрээр гарна.  11-03-21-д зориуд `null` байсан (тэнд нэр нь
    //    контекстийн талбар болж чадахгүй гэж үзсэн) — тэр баримтын нэрс
    //    `NUMERIC_NAMES`-д бүгд байгаа тул энэ салаанд хүрэхгүй.
    const field = meta?.field ?? FIELD_BY_NAME[key] ?? key;
    const push = (cmp: Comparator, value: number | [number, number], unit: string | null): void => {
      out.push({
        key,
        cond: {
          required: true,
          kind: 'field',
          comparator: cmp,
          value,
          unit,
          condition_text_mn: `${label} — ${boundMn(cmp, value, unit)}`,
          field,
        },
      });
    };
    if (lo !== undefined && hi !== undefined && members.length === 2) {
      push('between', [lo.value as number, hi.value as number], lo.unit);
      continue;
    }
    for (const m of members) {
      // ⚠️ Харьцуулах боломжгүй утга (масштаб «1:5000», багц) — нөхцөл БИШ.
      //    `legalinfoScalarRules` түүнийг объектын бичвэрт зарласан утга болгоно.
      if (typeof m.value === 'string') continue;
      if (Array.isArray(m.value)) {
        if (m.operator === 'range' || m.operator === 'between') push('between', m.value, m.unit);
        continue;
      }
      const cmp = comparator(m.operator);
      if (cmp === null) continue;
      push(cmp, m.value, m.unit);
    }
  }
  return out;
}

/** Харьцуулах боломжгүй зарласан утгын хүнд уншигдах мөр — «obstacle_mapping_scale — 1:500, 1:1000». */
export function declaredValueMn(r: NumericRow): string | null {
  if (typeof r.value !== 'string') return null;
  const label = NUMERIC_NAMES[baseName(r.name)]?.mn ?? r.name;
  const u = unitMn(r.unit);
  return `${label} — ${r.value}${u.length > 0 ? ` ${u}` : ''}`;
}

/**
 * Багцын ӨӨРИЙН алтан кейсүүдийн оролтын нэр ↔ тоон мөрийн нэр (БНбД 11-08-23).
 * ⚠️ Зөвхөн ИЖИЛ УТГАТАЙ нь; «opening_cm: [15, 15]» гэх массив оролт нь
 *    хөдөлгүүрт тоо биш тул зориуд алгасав — тэр кейс «нөхцөл дутуу» гэж унана.
 */
const FIELD_BY_NAME: Readonly<Record<string, string>> = {
  // СНиП II-97-76 — багцын өөрийн алтан кейсийн оролт
  water_freeboard: 'freeboard_m',
  coastal_strip: 'coastal_strip_m',
  chemical_to_fishery: 'distance_km',
  checkpoint_spacing: 'checkpoint_spacing_km',
  semi_court_width: 'court_width_m',
  opening_width: 'opening_width_m',
  opening_height: 'opening_height_m',
  two_entrance_trigger: 'site_ha',
  entrance_count: 'entrances',
  entrance_spacing: 'spacing_m',
  two_side_fire_access_trigger: 'building_width_m',
  sand_max: 'slope',
  clay_max: 'slope',
  erodible_max: 'slope',
  site_slope_min: 'slope',
  high_density_trigger: 'building_density_percent',
  green_min_high_density: 'green_percent',
  green_min: 'green_percent',
  // БНбД 11-08-23
  burial_depth_tolerance: 'burial_depth_deviation_m',
  pavement_elevation_deviation: 'elevation_deviation_mm',
  obstacle_height_accuracy: 'obstacle_height_error_m',
  edm_depth_trigger: 'depth_m',
  // ⚠️ БНбД 31-23-12 / 31-24-22 / 31-25-22 (2026-09-11) — багцуудын ӨӨРИЙН алтан
  //    кейсийн оролтын нэрс.  ЗӨВХӨН нэг утгатай хос; нэг заалтын ХЭД ХЭДЭН мөр
  //    ижил оролтод буудаг («хонгилын өргөн ≤10 м-д 1.2, >10 м-д 1.5»; «III
  //    ангиллын хурд») тохиолдолд мөр СОНГОХ нь ангиллын оролт (`hazard_class`,
  //    `age_group`) шаарддаг — тэр нь хөдөлгүүрт байхгүй ойлголт тул тэдгээр
  //    кейс зориуд унана (`ai:eval:norm`-ийн тайланд ил).
  // БНбД 31-23-12
  elevator_general_height: 'level_difference_m',
  elevator_public_height: 'level_difference_m',
  corridor_width_le10: 'width_m',
  corridor_width_gt10: 'width_m',
  through_arch_width: 'width_m',
  through_arch_height: 'height_m',
  basement_depth_trigger: 'depth_m',
  basement_opening_count: 'opening_count',
  basement_opening_width: 'opening_width_m',
  basement_opening_height: 'opening_height_m',
  basement_compartment_area: 'area_m2',
  sauna_volume: 'volume_m3',
  sauna_height: 'height_m',
  sauna_heater_power: 'heater_kw',
  sauna_auto_off: 'auto_off_h',
  reachable_heating_surface: 'reachable_surface_C',
  air_curtain_temp: 'coldest5day_C',
  air_curtain_employee_trigger: 'employees',
  // БНбД 31-24-22
  urban_redline_distance: 'urban_redline_m',
  playground_under3_area: 'playground_m2_per_child',
  playground_3plus_area: 'playground_m2_per_child',
  rural_no_firewater_building_volume: 'building_m3',
  firewater_source_distance: 'source_distance_m',
  firewater_duration: 'water_hours',
  design_service_life: 'service_life_years',
  group_under3_area: 'group_area_per_child',
  group_3plus_area: 'group_area_per_child',
  sleep_under3_area: 'sleep_area_per_child',
  sleep_3plus_area: 'sleep_area_per_child',
  egress_exits_per_group: 'egress_exits',
  egress_door_width: 'door_width_m',
  egress_corridor_width: 'corridor_width_m',
  main_entrance_lux: 'lux',
  other_entrance_lux: 'lux',
  indoor_avg_temperature: 'room_temperature_C',
  specified_floor_temperature: 'floor_temperature_C',
  independent_power_sources: 'independent_sources',
  wall_Rw_primary_kitchen: 'wall_Rw_primary_kitchen_dB',
  // БНбД 31-25-22
  standalone_school_students: 'students',
  ball_field_distance: 'ball_field_distance_m',
  ball_field_distance_with_fence: 'ball_field_distance_m',
  dining_area_under80: 'area_per_student_m2',
  dining_area_80plus: 'area_per_student_m2',
  hot_water_point: 'draw_off_C',
  hot_water_mixer_inlet: 'mixer_inlet_C',
};

/** Хамгийн СУЛ баталгаажилтыг авна — нэг мөр нь тулгагдаагүй бол дүрэм бүхэлдээ. */
function weakestVerification(statuses: readonly string[]): string {
  const bad = statuses.find((s) => !isExecutableVerification(s));
  return bad ?? statuses[0] ?? 'unknown';
}

/* ── Лавлах хүснэгт → мөр бүр өөрийн хэсэг + дүрэм ─────────────────── */

export interface DerivedTable {
  chunks: ChunkIn[];
  rules: RuleIn[];
  /** `numeric_requirements` мөрийн нэрс — хүснэгтэд ХЭРЭГЛЭГДСЭН тул скаляр дүрэмд ДАХИН орохгүй. */
  consumed: Set<string>;
  warnings: string[];
}

/** Албан ёсны хүснэгтийн мөр/баганын ҮГ (legalinfo, 2026-09-10-нд уншсан). */
const GEO_MN: Readonly<Record<string, string>> = { simple: 'энгийн', medium: 'дунд зэрэг', difficult: 'хүнд' };
const BUILDING_MN: Readonly<Record<string, string>> = { low: 'бага', medium: 'дунд', high_or_special: 'өндөр ба онцгой' };
const DATA_TYPE_MN: Readonly<Record<string, string>> = {
  geological_structure: 'геологийн тогтоц',
  hydrogeology: 'гидрогеологийн нөхцөл',
  soil_physical_mechanical_and_groundwater_chemistry: 'ул хөрсний физик-механик шинж чанар, газрын доорх усны хими',
  geological_engineering_processes: 'геологи, инженер-геологийн үйл явц',
  permafrost_geocryology: 'цэвдэг ул хөрс, инженер-геокриологи',
  earthquake_seismotectonic: 'газар хөдлөл',
};

interface TableCtx {
  clauseChunk: string;
  clauseNo: string;
  section: string | null;
  tableLabel: string;
  byName: Map<string, NumericRow>;
  out: DerivedTable;
}

/**
 * Хүснэгтийн нэг утгыг ижил нэртэй тоон мөртэй ТУЛГАНА.
 * Таарвал тэр мөрийн баталгаажилт, таарахгүй бол `unverified_reference_table`.
 */
function crossCheck(t: TableCtx, name: string, value: number): string {
  const row = t.byName.get(name);
  if (row === undefined) {
    t.out.warnings.push(`${t.tableLabel}: «${name}» тоон мөр байхгүй — хүснэгтийн утга тулгагдаагүй.`);
    return 'unverified_reference_table';
  }
  t.out.consumed.add(name);
  if (row.value !== value) {
    t.out.warnings.push(`${t.tableLabel}: «${name}» хүснэгтэд ${value}, тоон мөрөнд ${row.value} — ЗӨРЖ БАЙНА.`);
    return 'unverified_reference_table';
  }
  return row.verification_status;
}

function pushTableRow(
  t: TableCtx,
  rowKey: string,
  textMn: string,
  searchEn: string,
  requiredContext: string[],
  conditions: RuleIn['conditions'],
  statuses: string[],
  notes: string[] = [],
): void {
  const chunkId = `${t.clauseChunk}:table:${rowKey}`;
  const verification = weakestVerification(statuses);
  t.out.chunks.push({
    chunk_id: chunkId,
    kind: 'table_row',
    page: null,
    source_pdf_page: null,
    table_no: null,
    row_no: null,
    clause_no: t.clauseNo,
    // Эшлэлд эхний сегмент гарна: «БНбД 11-03-21, Хүснэгт 5-1, заалт 5.2».
    section_path: [t.tableLabel, t.section].filter((s): s is string => s !== null).join(' / '),
    text_mn: textMn,
    text_latin: null,
    search_text: `${textMn} ${searchEn}`,
    authority_level: 'normative',
    visibility: 'public_norm',
    verification_status: verification,
    retrieval_weight: 1.1,
    metadata: { derived_from: 'reference_tables.json', table: t.tableLabel, clause: t.clauseNo },
  });
  t.out.rules.push({
    rule_id: chunkId,
    chunk_id: chunkId,
    rule_kind: 'table_row',
    table_no: null,
    row_no: null,
    clause_no: t.clauseNo,
    page: null,
    section: t.tableLabel,
    object_mn: textMn,
    object_latin: null,
    actor: null,
    required_context: requiredContext,
    conditions,
    aliases_mn: [],
    aliases_latin: [],
    aliases_en: [],
    decision_policy: 'evaluate_structured_condition_then_quote_source',
    citation_required: true,
    verification_status: verification,
    notes,
  });
}

const fieldCond = (
  cmp: Comparator,
  value: number | [number, number],
  unit: string,
  field: string,
  text: string,
): RuleCondition => ({
  required: true,
  kind: 'field',
  comparator: cmp,
  value,
  unit,
  condition_text_mn: text,
  field,
});

export function legalinfoTables(
  docId: string,
  tables: Record<string, unknown>,
  numeric: readonly NumericRow[],
  sectionOfClause: (clause: string) => string | null,
): DerivedTable {
  const out: DerivedTable = { chunks: [], rules: [], consumed: new Set(), warnings: [] };
  const byName = new Map(numeric.map((r) => [r.name, r] as const));
  const ctx = (clause: string, label: string): TableCtx => ({
    clauseChunk: clauseChunkId(docId, clause),
    clauseNo: clause,
    section: sectionOfClause(clause),
    tableLabel: label,
    byName,
    out,
  });
  const rec = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);
  const pair = (v: unknown): [number, number] | null =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;

  // Хүснэгт 5-1 — заалт 5.2: нөхцөл × төвөгшил → зай.
  const t51 = rec(tables.borehole_spacing_table_5_1);
  if (Array.isArray(t51.rows)) {
    const t = ctx(String(t51.source_rule ?? '5.2'), 'Хүснэгт 5-1');
    for (const row of list(t51.rows)) {
      const geo = String(row.engineering_geological_condition ?? '');
      const bld = String(row.building_complexity ?? '');
      const lo = num(row.spacing_m_min);
      const hi = num(row.spacing_m_max);
      if (lo === null || hi === null) continue;
      const geoMn = GEO_MN[geo] ?? geo;
      const bldMn = BUILDING_MN[bld] ?? bld;
      const statuses = [
        crossCheck(t, `borehole_spacing_${geo}_geo_${bld}_building_min`, lo),
        crossCheck(t, `borehole_spacing_${geo}_geo_${bld}_building_max`, hi),
      ];
      pushTableRow(
        t,
        `5-1:${geo}:${bld}`,
        `Хүснэгт 5-1 (заалт 5.2): инженер-геологийн нөхцөл — ${geoMn}, барилгын төвөгшил — ${bldMn}: ажлын зургийн шатны цооног хоорондын зай ${lo}–${hi} м.`,
        `working design borehole spacing ${geo} geological condition ${bld.replace(/_/g, ' ')} building`,
        ['geo', 'building'],
        [{ key: 'spacing_range', cond: fieldCond('between', [lo, hi], 'm', 'spacing_m', `цооног хоорондын зай ${lo}–${hi} м`) }],
        statuses,
        arr(t51.notes),
      );
    }
  }

  // Хүснэгт 5-2 — заалт 5.3: ачаалал → суурийн улнаас доош гүн.
  const t52 = rec(tables.drilling_depth_table_5_2);
  if (Array.isArray(t52.line_foundation_rows) || Array.isArray(t52.column_foundation_rows)) {
    const t = ctx(String(t52.source_rule ?? '5.3'), 'Хүснэгт 5-2');
    for (const row of list(t52.line_foundation_rows)) {
      const load = num(row.load_kn_per_m_max);
      const depth = pair(row.depth_below_base_m);
      if (load === null || depth === null) continue;
      const storeys = str(row.indicative_storeys);
      const statuses = [
        crossCheck(t, `line_foundation_depth_for_load_le_${load}_min`, depth[0]),
        crossCheck(t, `line_foundation_depth_for_load_le_${load}_max`, depth[1]),
      ];
      pushTableRow(
        t,
        `5-2:line:${load}`,
        `Хүснэгт 5-2 (заалт 5.3): шугаман суурьтай барилга, суурийн ачаалал ${load} кН/м хүртэл${storeys === null ? '' : ` (ойролцоогоор ${storeys} давхар)`}: суурийн улнаас доош өрөмдлөгийн гүн ${depth[0]}–${depth[1]} м.`,
        `strip line foundation load ${load} kN/m drilling depth below base`,
        ['load_kn_per_m'],
        [
          // ⚠️ «ХҮРТЭЛ» нь ЗӨВХӨН ДЭЭД ХИЛ.  Доод хилийг (өмнөх мөрийн тоо)
          //    зохиовол яг тэр тоон дээр хоёр мөр хоёулаа «таарна».  Мөрийг
          //    сонгох нь хайлтын ажил (FTS тоог яг таарна); энэ нөхцөл нь
          //    сонгосон мөр таны ачаалалд ХАМААРАХ эсэхийг л хэлнэ.
          { key: 'load_ceiling', cond: fieldCond('<=', load, 'kN/m', 'load_kn_per_m', `суурийн ачаалал ${load} кН/м хүртэл`) },
          { key: 'depth_range', cond: fieldCond('between', depth, 'm', 'depth_m', `өрөмдлөгийн гүн ${depth[0]}–${depth[1]} м`) },
        ],
        statuses,
      );
    }
    for (const row of list(t52.column_foundation_rows)) {
      // ⚠️ Багц баганын мөрөнд `load_kn`, шугаманд `load_kn_per_m_max` гэж
      //    нэрлэдэг — хэмжсэн (эхний шингээлтэд 7 мөр чимээгүй алгасаж,
      //    талбаргүй скаляр дүрэм болж унасан).
      const load = num(row.column_load_kn) ?? num(row.load_kn);
      const depth = pair(row.depth_below_base_m);
      if (load === null || depth === null) continue;
      const statuses = [
        crossCheck(t, `column_foundation_depth_for_load_${load}_min`, depth[0]),
        crossCheck(t, `column_foundation_depth_for_load_${load}_max`, depth[1]),
      ];
      pushTableRow(
        t,
        `5-2:column:${load}`,
        `Хүснэгт 5-2 (заалт 5.3): баганан суурьтай барилга, баганын ачаалал ${load} кН: суурийн улнаас доош өрөмдлөгийн гүн ${depth[0]}–${depth[1]} м.`,
        `column pile foundation load ${load} kN drilling depth below base`,
        ['column_load_kn'],
        [
          { key: 'load_ceiling', cond: fieldCond('<=', load, 'kN', 'column_load_kn', `баганын ачаалал ${load} кН хүртэл`) },
          { key: 'depth_range', cond: fieldCond('between', depth, 'm', 'depth_m', `өрөмдлөгийн гүн ${depth[0]}–${depth[1]} м`) },
        ],
        statuses,
      );
    }
  }

  // Хүснэгт 4-1 — заалт 4.6: эх загвар/ТЭЗҮ шат.
  const t41 = rec(tables.concept_stage_table_4_1);
  if (Array.isArray(t41.rows)) {
    const t = ctx(String(t41.source_rule ?? '4.6'), 'Хүснэгт 4-1');
    for (const row of list(t41.rows)) {
      const geo = String(row.condition ?? '');
      const spacing = pair(row.spacing_m);
      const depth = num(row.average_depth_m);
      if (spacing === null || depth === null) continue;
      const geoMn = GEO_MN[geo] ?? geo;
      const statuses = [
        crossCheck(t, `concept_borehole_spacing_${geo}_min`, spacing[0]),
        crossCheck(t, `concept_borehole_spacing_${geo}_max`, spacing[1]),
        crossCheck(t, `concept_average_depth_${geo}`, depth),
      ];
      const note = str(t41.note);
      pushTableRow(
        t,
        `4-1:${geo}`,
        `Хүснэгт 4-1 (заалт 4.6): инженер-геологийн нөхцөл — ${geoMn}: эх загвар/ТЭЗҮ шатны цооног хоорондын зай ${spacing[0]}–${spacing[1]} м, дундаж гүн ${depth} м.`,
        `concept feasibility stage borehole spacing average depth ${geo} condition`,
        ['geo'],
        [
          { key: 'spacing_range', cond: fieldCond('between', spacing, 'm', 'spacing_m', `цооног хоорондын зай ${spacing[0]}–${spacing[1]} м`) },
          { key: 'average_depth', cond: fieldCond('=', depth, 'm', 'average_depth_m', `дундаж гүн ${depth} м`) },
        ],
        statuses,
        note === null ? [] : [note],
      );
    }
  }

  // Хүснэгт 3-1 — заалт 3.17: өмнөх материалын зөвшөөрөгдөх хугацаа.
  const t31 = rec(tables.prior_data_validity_table_3_1);
  if (Array.isArray(t31.rows)) {
    const t = ctx(String(t31.source_rule ?? '3.17'), 'Хүснэгт 3-1');
    for (const row of list(t31.rows)) {
      const type = String(row.data_type ?? '');
      const typeMn = DATA_TYPE_MN[type] ?? type;
      const u = num(row.undeveloped_years);
      const d = num(row.developed_years);
      const note = str(row.note);
      if (u === null && d === null) {
        // ⚠️ «Хязгаарлалтгүй» мөр — нөхцөлгүй, тоо зохиохгүй.  Тулгах тоон
        //    мөр байхгүй тул баталгаажилт нь хүснэгтийн бусад мөрийнхтэй ижил.
        pushTableRow(
          t,
          `3-1:${type}`,
          `Хүснэгт 3-1 (заалт 3.17): ${typeMn} — өмнөх судалгааны материалыг ашиглах хугацаанд тогтсон хязгаар байхгүй.`,
          `prior survey data validity ${type.replace(/_/g, ' ')} no fixed age limit`,
          [],
          [],
          ['verified_current_text'],
          note === null ? [] : [note],
        );
        continue;
      }
      const statuses: string[] = [];
      const conditions: RuleIn['conditions'] = [];
      if (u !== null) {
        statuses.push(crossCheck(t, `prior_data_validity_${type}_undeveloped`, u));
        conditions.push({
          key: 'undeveloped_area_max_age',
          cond: fieldCond('<=', u, 'year', 'data_age_years', `барилгажаагүй нутагт ${u} жилээс ихгүй`),
        });
      }
      if (d !== null) {
        statuses.push(crossCheck(t, `prior_data_validity_${type}_developed`, d));
        conditions.push({
          key: 'developed_area_max_age',
          cond: fieldCond('<=', d, 'year', 'data_age_years', `барилгажсан нутагт ${d} жилээс ихгүй`),
        });
      }
      pushTableRow(
        t,
        `3-1:${type}`,
        `Хүснэгт 3-1 (заалт 3.17): ${typeMn} — өмнөх судалгааны материалыг ашиглах зөвшөөрөгдөх хугацаа: барилгажаагүй нутагт ${u ?? '—'} жил, барилгажсан нутагт ${d ?? '—'} жил.`,
        `prior survey data validity ${type.replace(/_/g, ' ')} undeveloped developed area years`,
        ['area_type'],
        conditions,
        statuses,
        note === null ? [] : [note],
      );
    }
  }

  return out;
}

/**
 * ЕРӨНХИЙ лавлах хүснэгт (БНбД 11-08-23) — `{"1.3": {title_mn, source, rows|axis_rows|…}}`.
 *
 * ⚠️ БАГАНЫН НЭРИЙГ ОРЧУУЛАХГҮЙ.  Мөрүүд нь `linear: "1/5000"`, `method1_mm: 3`
 *    гэх мэт ХОЛИМОГ (мөр, муж, тоо) утгатай ба баганын албан ёсны монгол
 *    гарчиг багцад БАЙХГҮЙ («method1» юу болохыг бид мэдэхгүй).  Таамагласан
 *    гарчиг нь эх сурвалжийн үг болж хувирна — тиймээс түлхүүрийг ТҮҮХИЙГЭЭР
 *    нь үлдээж, зөвхөн хүснэгтийн гарчиг (багцын өөрийн монгол) + утгыг
 *    хайгдахуйц бичвэр болгоно.  Нөхцөл ҮҮСГЭХГҮЙ (утгууд харьцуулагдахгүй);
 *    `review_flag` мөр нь `source_render_review` (гүйцэтгэгдэхгүй) төлөвтэй.
 *
 * ⚠️ `table_no` нь «1.3» — INTEGER багана ч SQLite REAL хадгална; эшлэлд
 *    «Хүснэгт 1.3» гарч, `isCitable` хангагдана (заалт байхгүй).
 */
export function legalinfoGenericTables(docId: string, tables: Record<string, unknown>, verified: string): DerivedTable {
  const out: DerivedTable = { chunks: [], rules: [], consumed: new Set(), warnings: [] };
  /**
   * ⚠️ БАГАНЫН ГАРЧИГТАЙ ХҮСНЭГТ (БНбД 31-23-12 / 31-24-22, 2026-09-11).  Мөр нь
   *    `m: [60, 50, 40, 35, 20]` гэсэн массив, баганын утга нь хүснэгтийн түвшинд
   *    `columns_people_per_m2: ["≤2", "2–3", …]` / `room_index_columns: [0.6, …]`.
   *    Зипгүй бол «4 хүн/м² нягтралд зай хэд вэ?» гэсэн асуулт 5 тооны аль нь
   *    болохыг хэзээ ч мэдэхгүй.  Зөвхөн УРТ ТААРСАН массивыг зипнэ; баганын
   *    нэр ОРЧУУЛАГДАХГҮЙ (түлхүүр багцынх хэвээр).
   */
  const columnsOf = (t: Record<string, unknown>): { key: string; values: string[] } | null => {
    for (const [k, v] of Object.entries(t)) {
      if (/columns/i.test(k) && Array.isArray(v) && v.length > 0) return { key: k.replace(/_?columns_?/i, '').replace(/_/g, ' '), values: v.map(String) };
    }
    return null;
  };
  let columns: { key: string; values: string[] } | null = null;
  const render = (v: unknown): string =>
    Array.isArray(v)
      ? columns !== null && v.length === columns.values.length && v.every((x) => typeof x !== 'object')
        ? v.map((x, i) => `${columns!.key.length > 0 ? `${columns!.key} ` : ''}${columns!.values[i]} → ${String(x)}`).join('; ')
        : v.map((x) => (typeof x === 'object' && x !== null ? renderRow(x as Record<string, unknown>) : String(x))).join(' | ')
      : typeof v === 'object' && v !== null
        ? renderRow(v as Record<string, unknown>)
        : String(v);
  const renderRow = (row: Record<string, unknown>): string =>
    Object.entries(row)
      .filter(([k]) => k !== 'review_flag')
      .map(([k, v]) => `${k}: ${render(v)}`)
      .join('; ');

  for (const [tableId, raw] of Object.entries(tables)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const t = raw as Record<string, unknown>;
    const title = str(t.title_mn) ?? str(t.title);
    if (title === null) continue;
    // ⚠️ ТООН БУС ХҮСНЭГТИЙН ID (`T-5.1.14-1`, `APP-A1`) БАС ОРНО — өмнө нь зөвхөн
    //    «1.3» хэлбэрийг авч байсан тул 31-24-22-ын 7 хүснэгт 0 мөр өгч байв
    //    (хэмжсэн).  `table_no` нь зөвхөн тоон id-д; бусдад хаяг `section_path`-д.
    const tableNo = /^\d+(\.\d+)?$/.test(tableId) ? Number(tableId) : null;
    columns = columnsOf(t);
    let i = 0;
    for (const [field, rows] of Object.entries(t)) {
      if (!Array.isArray(rows) || (columns !== null && /columns/i.test(field))) continue;
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue;
        i += 1;
        const r = row as Record<string, unknown>;
        const chunkId = `${docId}:table:${tableId}:row:${i}`;
        const loc = str(t.locator);
        const tableLabel = loc !== null && !/^\d/.test(loc) ? loc : tableNo !== null ? `Хүснэгт ${tableId}` : (loc ?? `Хүснэгт ${tableId}`);
        const text = `${tableLabel} — ${title}${field === 'rows' ? '' : ` (${field})`}, мөр ${i}: ${renderRow(r)}.`;
        const status = r.review_flag === true ? 'source_render_review' : verified;
        out.chunks.push({
          chunk_id: chunkId,
          kind: 'table_row',
          page: null,
          source_pdf_page: null,
          table_no: tableNo,
          row_no: String(i),
          clause_no: null,
          // Эшлэлийн эхний сегмент = хаяг («6.2.3, Хүснэгт 6.1» / «А хавсралт, А.1 хүснэгт»).
          section_path: loc !== null && loc !== title ? `${loc} / ${title}` : title,
          text_mn: text,
          text_latin: null,
          search_text: text,
          authority_level: 'normative',
          visibility: 'public_norm',
          verification_status: status,
          retrieval_weight: 1.0,
          metadata: { derived_from: 'reference_tables.json', table: tableId, ...(typeof t.source === 'object' && t.source !== null ? { answer_source: t.source } : {}) },
        });
        out.rules.push({
          rule_id: chunkId,
          chunk_id: chunkId,
          rule_kind: 'table_row',
          table_no: tableNo,
          row_no: String(i),
          clause_no: null,
          page: null,
          section: tableLabel,
          object_mn: text,
          object_latin: null,
          actor: null,
          required_context: [],
          conditions: [],
          aliases_mn: [],
          aliases_latin: [],
          aliases_en: [],
          decision_policy: 'quote_source_clause',
          citation_required: true,
          verification_status: status,
          notes: r.review_flag === true ? ['review_flag: HTML wording damaged'] : [],
        });
      }
    }
  }
  return out;
}

/** «Appendix V» / «Хавсралт В» / «В хавсралт» → `<doc>:appendix:<үсэг>` (байгаа хувилбарыг нь). */
export function appendixChunkId(docId: string, ref: string, exists: (id: string) => boolean): string | null {
  const m = /^(?:Appendix|Хавсралт)\s+([A-ZА-ЯЁ])(?![\p{L}\d])|^([A-ZА-ЯЁ])\s+хавсралт/iu.exec(ref.trim());
  const raw = (m?.[1] ?? m?.[2])?.toUpperCase();
  if (raw === undefined) return null;
  const cands = [raw, APPENDIX_LATIN_TO_CYRILLIC[raw] ?? raw, APPENDIX_CYRILLIC_TO_LATIN[raw] ?? raw].map((l) => `${docId}:appendix:${l}`);
  return cands.find(exists) ?? null;
}

/**
 * Хүснэгтэд ОРООГҮЙ тоон мөрүүд → заалт тус бүрд НЭГ дүрэм, нэрлэсэн нөхцөлүүд.
 *
 * ⚠️ ЗААЛТ ТУС БҮРД НЭГ — 3.9-ийн гурван тоо (гүн, алхам, тоо) нь НЭГ
 *    шаардлагын гурван хэсэг; тусад нь дүрэм болговол хоолой нэгийг нь л
 *    сонгож, «10 м гүн ч 2 м тутам хэмжсэн» тохиолдлыг «хангана» гэж хэлнэ.
 */
export function legalinfoScalarRules(
  numeric: readonly NumericRow[],
  consumed: ReadonlySet<string>,
  chunkOf: (chunkId: string) => ChunkIn | undefined,
  docId: string | null = null,
): RuleIn[] {
  const groups = new Map<string, NumericRow[]>();
  /**
   * ⚠️ ХОЁР ID-ИЙН ЗАГВАР.  11-03-21/11-08-23: `rule_id` = хэсгийн id → заалт
   *    бүрд НЭГ дүрэм, нэрлэсэн нөхцөлүүд (`…:clause:3.9:numeric`).
   *    СНиП II-97-76: `rule_id` = «<doc>:<заалт>:<нэр>» гэсэн МӨРИЙН id, багцын
   *    442 тестийн 240 нь яг тэр id-г хүлээдэг → мөр бүр ӨӨРИЙН дүрэм, id
   *    хэвээр, хэсэг нь `locator`-оос.  Нэг заалтын олон дүрмийг
   *    `loadRuleForChunk` нөхцөлөөр нь сонгоно (УББ 12-01-01-ийн загвар).
   */
  /**
   * Мөрийн id хэсгийн id биш үед эх хэсгийг ОЛНО — таамаглалгүй, ЗӨВХӨН
   * багцын өөрийн хаягаар: `locator` заалт → `…:clause:<locator>`; хавсралтын
   * мөр (`locator: "APP"`, нэр `density_001_…`, эх хаяг «Хавсралт, мөр 1») →
   * `…:appendix:001`.  Олдохгүй бол `null` → `ingest.ts` эшлэлгүй дүрмийг
   * оруулахгүй, ил тайлагнана (СНиП: «Хавсралтын тайлбар» гэсэн 1 мөр).
   */
  const resolveChunk = (r: NumericRow): string | null => {
    if (docId === null) return null;
    const cands: string[] = [];
    // Заалтын дугаар («3.9») эсвэл хавсралтын үсэгтэй заалт («В.1.1», 11-106-25) — хэсгийн
    // id нь хоёуланд нь `…:clause:<locator>`; хүснэгтийн мөр бол `…:table:<locator>`.
    if (typeof r.locator === 'string' && /^(?:\d|[А-ЯЁA-Z]\.\d)/u.test(r.locator)) {
      cands.push(clauseChunkId(docId, r.locator));
      // БНбД 31-25-22: хэсгийн id-д `:clause:` байхгүй (`…:2.4`).
      cands.push(`${docId}:${r.locator}`);
      cands.push(`${docId}:table:${r.locator}`);
    }
    /**
     * ⚠️ ХАВСРАЛТЫН ТООН МӨР (БНбД 31-23-12 `APP-D`/`APP-V`, 31-24-22 `APP-A1`…).
     *    Багц `locator: "APP-V"` гэж ЛАТИН товчилдог, хэсэг нь `…:appendix:В`
     *    (КИРИЛЛ) эсвэл `…:table:APP-A1` (хүснэгт).  Эх хаягаас («Хавсралт В»,
     *    «А хавсралт, А.1 хүснэгт») үсгийг авна; латин товчлолын хувьд ЗӨВХӨН
     *    багцуудын өөрсдийнх нь хэрэглэсэн хос (A/Б/В/Г/Д/Е/Ж/З) — 31-23-12-ын
     *    `appendix:A` нь латин A, бусад нь кирилл тул ХОЁУЛАНГ сорино.
     *    Олдохгүй бол `null` → эшлэлгүй дүрэм ОРОХГҮЙ (өмнөх зан төлөв).
     */
    const app = /^APP-([A-Z])(\d*)$/.exec(r.locator ?? '');
    if (app !== null) {
      cands.push(`${docId}:table:${r.locator}`);
      const cyr = APPENDIX_LATIN_TO_CYRILLIC[app[1]!] ?? app[1]!;
      cands.push(`${docId}:appendix:${cyr}`, `${docId}:appendix:${app[1]!}`);
    }
    const byLetter = /(?:Хавсралт\s+([А-ЯЁA-Z])(?![\p{L}\d])|(?<![\p{L}\d])([А-ЯЁA-Z])\s+хавсралт)/u.exec(r.source_locator ?? '');
    const letter = byLetter?.[1] ?? byLetter?.[2];
    if (letter !== undefined) cands.push(`${docId}:appendix:${letter}`, `${docId}:appendix:${APPENDIX_CYRILLIC_TO_LATIN[letter] ?? letter}`);
    const byName = /density_(\d{3})/.exec(r.name);
    if (byName?.[1]) cands.push(`${docId}:appendix:${byName[1]}`);
    const byLoc = /мөр\s*(\d+)/u.exec(r.source_locator ?? '');
    if (byLoc?.[1]) cands.push(`${docId}:appendix:${byLoc[1].padStart(3, '0')}`);
    return cands.find((c) => chunkOf(c) !== undefined) ?? null;
  };
  const perRow = new Map<string, { row: NumericRow; chunkId: string }>();
  for (const r of numeric) {
    if (consumed.has(r.name)) continue;
    if (chunkOf(r.rule_id) !== undefined) {
      groups.set(r.rule_id, [...(groups.get(r.rule_id) ?? []), r]);
      continue;
    }
    const resolved = resolveChunk(r);
    if (resolved !== null) perRow.set(r.rule_id, { row: r, chunkId: resolved });
    else groups.set(r.rule_id, [...(groups.get(r.rule_id) ?? []), r]);
  }
  const out: RuleIn[] = [];
  for (const [ruleId, { row: r, chunkId }] of perRow) {
    const chunk = chunkOf(chunkId);
    const conditions = legalinfoConditions([r]);
    const declared = declaredValueMn(r);
    const label = r.condition !== null ? `${r.condition}: ` : '';
    out.push({
      rule_id: ruleId,
      chunk_id: chunkId,
      rule_kind: 'threshold',
      table_no: null,
      row_no: null,
      clause_no: chunk?.clause_no ?? r.locator ?? null,
      page: chunk?.page ?? null,
      section: chunk?.section_path ?? null,
      object_mn: `${label}${conditions[0]?.cond.condition_text_mn ?? declared ?? r.name}`,
      object_latin: null,
      actor: null,
      required_context: conditions.map((c) => c.cond.field).filter((f): f is string => typeof f === 'string'),
      conditions,
      aliases_mn: [],
      aliases_latin: [],
      // ⚠️ Мөрийн НЭР нь alias — багцын тестүүд яг тэр нэрээр асуудаг
      //    («СНиП II-97-76* APP density_005 хэд вэ?»); хавсралтын мөрийн бичвэрт
      //    тэр нэр байхгүй тул FTS олохгүй байв (хэмжсэн: 90 тест).
      aliases_en: [r.name],
      decision_policy: 'evaluate_structured_condition_then_quote_source',
      citation_required: true,
      verification_status: r.verification_status,
      notes: r.condition === null ? [] : [`${r.name}: ${r.condition}`],
    });
  }
  for (const [chunkId, rows] of groups) {
    const chunk = chunkOf(chunkId);
    const conditions = legalinfoConditions(rows);
    const objectMn = [
      ...conditions.map((c) => c.cond.condition_text_mn),
      ...rows.map((r) => declaredValueMn(r)),
    ]
      .filter((s): s is string => s !== null)
      .join('; ');
    out.push({
      rule_id: `${chunkId}:numeric`,
      chunk_id: chunkId,
      rule_kind: 'threshold',
      table_no: null,
      row_no: null,
      clause_no: chunk?.clause_no ?? clauseFromChunkId(chunkId),
      page: chunk?.page ?? null,
      section: chunk?.section_path ?? null,
      object_mn: objectMn,
      object_latin: null,
      actor: null,
      // Дутуу талбарыг НЭРЭЭР нь асуухын тулд.
      required_context: [
        ...new Set(conditions.map((c) => c.cond.field).filter((f): f is string => typeof f === 'string')),
      ],
      conditions,
      aliases_mn: [],
      aliases_latin: [],
      aliases_en: [],
      decision_policy: 'evaluate_structured_condition_then_quote_source',
      citation_required: true,
      verification_status: weakestVerification(rows.map((r) => r.verification_status)),
      // Багцын АНГЛИ нөхцөлийн тайлбарыг мөрдөн шалгахад үлдээнэ.
      notes: rows
        .map((r) => (r.condition === null ? null : `${r.name}: ${r.condition}`))
        .filter((s): s is string => s !== null),
    });
  }
  return out;
}

/**
 * `aliases.json` — ЭНЭ багцад ОБЪЕКТ: `{canonical: [{language, alias, weight}]}`.
 * (Өмнөх гурван багц массив өгдөг байсан → `normalizeAliasGroups`.)
 */
export function normalizeAliasMap(map: Record<string, unknown>, docCode: string | null = null): AliasIn[] {
  const out: AliasIn[] = [];
  // ⚠️ БНбД 11-08-23 хэлбэр: `{document_id, global_aliases: [...], records: [{alias, target_id, language}]}`.
  //    `records`-ыг «канон = records» гэж уншвал 1564 alias нэг утгагүй бүлэгт
  //    нийлнэ (хэмжсэн: эхний оролдлого).  Канон нь `target_id` (хэсгийн id);
  //    `global_aliases` нь баримтын кодынх.
  if (Array.isArray(map.records)) {
    for (const e of map.records) {
      if (typeof e !== 'object' || e === null) continue;
      const g = e as Record<string, unknown>;
      const alias = str(g.alias);
      const canonical = str(g.target_id) ?? str(g.canonical);
      if (alias === null || canonical === null) continue;
      // ⚠️ ӨГҮҮЛБЭР БОЛ ALIAS БИШ.  Багц заалтын бүтэн бичвэр ба галигийг нь
      //    alias болгож өгдөг («Онцлог хэсгийн хөндлөн огтлолыг 1:50 …»).
      //    «БНбД 11-08-23 11.17.2.8» гэсэн хаяг таармагц `expandAliases`
      //    тэр бүлгийн БҮХ alias-ыг FTS-ийн нэмэлт үг болгож, өгүүлбэрийн 15 үг
      //    өөр баримтын хамааралгүй заалтыг (УББ 12-204-01 4.4) эхэнд тавьж
      //    байв (хэмжсэн: 11-08-23-ын эшлэлийн URL 100% → 98.4%).  Хэсгийн
      //    бичвэр FTS-д аль хэдийн байгаа — alias болгох нь юу ч нэмэхгүй.
      if (alias.trim().split(/\s+/).length > 6) continue;
      const raw = String(g.language ?? 'mn');
      out.push({ canonical, language: raw.startsWith('mn-Latn') || raw === 'latin' ? 'latin' : raw.startsWith('en') ? 'en' : 'mn', alias });
    }
    if (docCode !== null) {
      for (const a of arr(map.global_aliases)) out.push({ canonical: docCode, language: /[\u0400-\u04ff]/u.test(a) ? 'mn' : 'latin', alias: a });
    }
    return out;
  }
  for (const [canonical, entries] of Object.entries(map)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (typeof e !== 'object' || e === null) continue;
      const g = e as Record<string, unknown>;
      const alias = str(g.alias);
      if (alias === null) continue;
      const raw = String(g.language ?? 'mn');
      out.push({
        canonical,
        language: raw.startsWith('mn-Latn') ? 'latin' : raw.startsWith('en') ? 'en' : 'mn',
        alias,
      });
    }
  }
  return out;
}

/**
 * Баримтын хүчинтэй төлөв.
 *
 * ⚠️ `current_verified` → `in_force`, ЗОРИУД.  `citation.ts` нь `in_force`-оос
 *    бусад бүх төлөвт «хуулийн хүн шалгах шаардлагатай» тугийг эшлэл бүрд
 *    дагуулдаг — гал түймэр (2018 нэмэлт, дараагийн өөрчлөлт шалгаагүй) ба
 *    УББ (2001, дараагийн нэмэлт шалгаагүй) баримтад тэр туг ЗӨВ.  Энэ
 *    баримт нь legalinfo.mn-ийн ОДОО МӨРДӨЖ БУЙ эх (2022-08-07-оос) бөгөөд
 *    2026-09-10-нд шууд уншиж баталгаажуулсан; түүнд туг өгвөл «шалгасан»
 *    ба «шалгаагүй» хоёр ялгагдахаа болино.  Танигдахгүй бүх утга ХЭВЭЭР.
 */
export function normalizeEffectiveStatus(raw: string): string {
  return raw === 'current_verified' ? 'in_force' : raw;
}

/* ── Профайл 5: хавтгай заалтын дүрэм (УББ 12-204-01) ───────────────── */

/**
 * ⚠️ ХОЁРХОН ТООН МӨР, НЭГ НЬ НИЙЛМЭЛ.  Багцын `numeric_requirements.jsonl`
 *    нь 4.3-р заалтыг «≥ 2 санал» гэсэн ГАНЦ тоогоор өгч, «захиалагч
 *    шийдвэрлээгүй БА ноцтой зөрчил» гэсэн хоёр нөхцөлийг зөвхөн англи
 *    `condition` тайлбарт бичдэг.  Тэднийг орхивол «сард 2 удаа санал тавьсан»
 *    хэн ч үйлдвэрлэл зогсоох эрхтэй гэж хэлнэ — заалтын утга ХУДАЛ болно.
 *    Тиймээс энэ багцын тоон мөрийг ерөнхий адаптераар биш, ЭНД, заалт бүрийг
 *    нэрлэн угсарна (гал түймрийн багцын загвар).  Тоо нь багцаас, зохиогдохгүй.
 *
 *    Нөхцөлийн талбарын нэрс нь багцын ӨӨРИЙН алтан кейсийнх
 *    (`professional_construction_experience_years`, `formal_proposals_in_month`,
 *    `client_unresolved`, `serious_violation`).
 */
export function flatClauseNumericRules(rows: ReadonlyArray<Record<string, unknown>>): RuleIn[] {
  const out: RuleIn[] = [];
  const base = (r: Record<string, unknown>, objectMn: string, conditions: RuleIn['conditions'], notes: string[]): RuleIn => {
    const chunkId = String(r.rule_id ?? '');
    return {
      rule_id: `${chunkId}:numeric`,
      chunk_id: chunkId,
      rule_kind: 'threshold',
      table_no: null,
      row_no: null,
      clause_no: clauseFromChunkId(chunkId),
      page: num(r.page),
      section: null,
      object_mn: objectMn,
      object_latin: null,
      actor: 'даамал',
      required_context: conditions.map((c) => c.cond.field).filter((f): f is string => typeof f === 'string'),
      conditions,
      aliases_mn: [],
      aliases_latin: [],
      aliases_en: [],
      // Олон нөхцөлтэй бол НИЙЛМЭЛ — «бүгд хангагдсан уу» гэсэн нэгдсэн туг үүснэ.
      decision_policy: conditions.length > 1 ? 'evaluate_all_conditions_then_quote_source' : 'evaluate_structured_condition_then_quote_source',
      citation_required: true,
      verification_status: String(r.verification_status ?? 'unknown'),
      notes,
    };
  };
  const fieldCond = (cmp: Comparator, value: number, unit: string | null, field: string, text: string): RuleCondition => ({
    required: true,
    kind: 'field',
    comparator: cmp,
    value,
    unit,
    condition_text_mn: text,
    field,
  });
  const flag = (field: string, text: string): RuleCondition => ({
    required: true,
    kind: 'flag',
    comparator: null,
    value: null,
    unit: null,
    condition_text_mn: text,
    field,
  });

  for (const r of rows) {
    const name = String(r.name ?? '');
    const value = num(r.value);
    const cmp = comparator(r.operator);
    if (value === null || cmp === null) continue;
    const notes = [str(r.condition), str(r.normalization_warning)].filter((x): x is string => x !== null);

    if (name === 'minimum_professional_experience') {
      out.push(
        base(r, `мэргэжлээрээ барилгын үйлдвэрлэлд ажилласан туршлага — ${value} жилээс багагүй`, [
          {
            key: 'minimum_professional_experience',
            cond: fieldCond(cmp, value, 'years', 'professional_construction_experience_years', `ажилласан туршлага ${value} жилээс багагүй`),
          },
        ], notes),
      );
      continue;
    }
    if (name === 'formal_proposals_before_stop_right') {
      out.push(
        base(
          r,
          `үйлдвэрлэл зогсоох эрх — сард ${value}-оос доошгүй удаа албан ёсоор санал тавьсан, захиалагч шийдвэрлээгүй, ноцтой зөрчил бий болсон гурван нөхцөл ЗЭРЭГ хангагдсан үед`,
          [
            { key: 'proposal_count_condition_met', cond: fieldCond(cmp, value, 'formal_proposals_per_month', 'formal_proposals_in_month', `сард ${value}-оос доошгүй удаа албан ёсоор санал тавьсан`) },
            { key: 'client_unresolved', cond: flag('client_unresolved', 'захиалагч саналыг шийдвэрлээгүй') },
            { key: 'serious_violation', cond: flag('serious_violation', 'хөдөлмөр хамгаалал, аюулгүй техник, зураг төсөл, дүрэм, стандарт ноцтой зөрчигдсөн') },
          ],
          notes,
        ),
      );
      continue;
    }
    // Танигдаагүй мөр — нэрээр нь ганц нөхцөл, талбар = нэр (таамаглахгүй).
    out.push(base(r, `${name} — ${boundMn(cmp, value, str(r.unit))}`, [{ key: name, cond: fieldCond(cmp, value, str(r.unit), name, `${name} — ${boundMn(cmp, value, str(r.unit))}`) }], notes));
  }
  return out;
}

/* ── Профайл 6: нэмэлт өөрчлөлттэй норм (БНбД 31-25-22) ─────────────── */

/**
 * ⚠️ ЭНЭ БАГЦЫН ГУРВАН ОНЦЛОГ (2026-09-11):
 *
 *  1. ХЭСГИЙН ID-Д `:clause:` БАЙХГҮЙ — `…:2.4`, `…:5.1.6`, бүлгийн хаалт
 *     `…:section:5.2.9`, төлөв `…:status` / `…:mcis-current`.  Тиймээс
 *     `clauseFromChunkId` null буцаана; заалтын дугаар `locator`-оос.
 *
 *  2. ХОЁР ТӨРЛИЙН ХЭСЭГ, ХОЁР ӨӨР ИТГЭЛ.  `canonical_rule` (40) нь багцын
 *     «өндөр итгэлтэй, шууд хариулж болох» заалт → `verified_official_text`.
 *     `source_gate` (45) нь бүлгийн ГАРЧИГ + «canonical rule байхгүй бол эх
 *     сурвалжийг дахин шалга» гэсэн заавар → `needs_human_review`: хайгдана
 *     (ажилтан тэр бүлэг БАЙДГИЙГ, URL-ыг харна), гэвч эрх бүхий хариу
 *     болж ГҮЙЦЭТГЭГДЭХГҮЙ — хоолой «эх сурвалжийг үзнэ үү» гэж хэлнэ.
 *     Энэ нь 31-24-22-ын 64 `source_locator_gate` хэсэгтэй ИЖИЛ зан төлөв.
 *
 *  3. 2024 ОНЫ НЭМЭЛТ ӨӨРЧЛӨЛТ (тушаал №36) — 5.1.6, 5.1.8-д «7 ба түүнээс
 *     доош» → «6 ба түүнээс доош».  Багцын гэрээ: тэр хоёр заалтын хариултад
 *     өөрчлөлтийн тушаалыг ХАРАГДАХУЙЦ эшлэх.  Эшлэлийн шошго `section_path`-ийн
 *     эхний сегментээс угсрагддаг тул тэр хоёр хэсгийн хаягийг «2024 өөрчлөлт:
 *     тушаал №36» гэж эхлүүлнэ — загварын текст биш, `amendment_2024_rules.json`-
 *     аас ДЕТЕРМИНИСТ.  Хуучин үг хэллэг (`old_phrase`) нь ЗӨВХӨН дүрмийн
 *     тэмдэглэлд — хайлтын мөрөнд оруулбал «7 балл» асуулт хуучин утгыг олно.
 */

export function amendedChunkId(docId: string, locator: string): string {
  return `${docId}:${locator}`;
}

export interface AmendmentIn {
  clause: string;
  old_phrase: string | null;
  current_phrase: string | null;
  order: string | null;
  date: string | null;
  url: string | null;
}

export function normalizeAmendments(raw: unknown): AmendmentIn[] {
  if (!Array.isArray(raw)) return [];
  const out: AmendmentIn[] = [];
  for (const a of raw) {
    if (typeof a !== 'object' || a === null) continue;
    const g = a as Record<string, unknown>;
    const clause = str(g.clause);
    if (clause === null) continue;
    out.push({
      clause,
      old_phrase: str(g.old_phrase),
      current_phrase: str(g.current_phrase),
      order: str(g.amendment_order),
      date: str(g.amendment_date),
      url: str(g.source_url),
    });
  }
  return out;
}

/** «2024 өөрчлөлт: тушаал №36 (2024-02-16)» — эшлэлийн эхний сегмент ба дүрмийн тэмдэглэл. */
function amendmentLabel(a: AmendmentIn): string {
  const year = a.date?.slice(0, 4) ?? '';
  return `${year.length > 0 ? `${year} ` : ''}өөрчлөлт: тушаал №${a.order ?? '?'}${a.date !== null ? ` (${a.date})` : ''}`;
}

export function amendedRulesChunks(
  rows: ReadonlyArray<Record<string, unknown>>,
  sections: ReadonlyArray<Record<string, unknown>>,
  canonical: ReadonlyArray<Record<string, unknown>>,
  amendments: readonly AmendmentIn[],
  docCode: string,
): ChunkIn[] {
  // Бүлгийн гарчиг: «5.2.9» → «Спорт заал».  Заалтын бүлэг = хамгийн УРТ угтвар.
  const titleOf = new Map<string, string>();
  for (const sct of sections) {
    const no = str(sct.section);
    const title = str(sct.title_mn);
    if (no !== null && title !== null) titleOf.set(no, title);
  }
  const sectionOfClause = (clause: string): string | null => {
    let best: string | null = null;
    for (const no of titleOf.keys()) {
      if ((clause === no || clause.startsWith(`${no}.`)) && (best === null || no.length > best.length)) best = no;
    }
    return best === null ? null : `${best} ${titleOf.get(best) ?? ''}`.trim();
  };
  const tagsOf = new Map<string, string[]>();
  for (const r of canonical) {
    const id = str(r.rule_id);
    if (id !== null) tagsOf.set(id, arr(r.tags));
  }
  const amendmentOf = new Map(amendments.map((a) => [a.clause, a] as const));

  return rows.map((c) => {
    const chunkId = String(c.chunk_id ?? '');
    const kind = String(c.kind ?? 'canonical_rule');
    const locator = str(c.locator);
    const direct = c.direct_answer === true;
    const amendment = locator !== null ? (amendmentOf.get(locator) ?? null) : null;
    const sectionTitle = locator !== null ? sectionOfClause(locator) : null;
    const baseSection =
      kind === 'source_gate'
        ? (locator !== null ? `${locator} ${titleOf.get(locator) ?? ''}`.trim() : null)
        : kind === 'legal_status' || kind === 'current_status'
          ? 'Legal status'
          : sectionTitle;
    const sectionPath = amendment !== null ? [amendmentLabel(amendment), baseSection].filter((x): x is string => x !== null).join(' / ') : baseSection;
    const text = String(c.text_mn ?? '');
    const search = [
      text,
      docCode,
      locator !== null ? `заалт ${locator}` : '',
      sectionTitle ?? '',
      ...(tagsOf.get(chunkId) ?? []),
      // Өөрчлөгдсөн заалтыг «2024 оны өөрчлөлт», «нэмэлт өөрчлөлт», «тушаал 36» гэж олохын тулд.
      ...(amendment !== null ? ['нэмэлт өөрчлөлт', `${amendment.date?.slice(0, 4) ?? ''} оны өөрчлөлт`, `тушаал №${amendment.order ?? ''}`, amendment.current_phrase ?? ''] : []),
    ]
      .filter((x, i, all) => x.length > 0 && all.indexOf(x) === i)
      .join(' ');
    return {
      chunk_id: chunkId,
      kind,
      page: null,
      source_pdf_page: null,
      table_no: null,
      row_no: null,
      // Бүлгийн хаалт ч заалтын хаягтай («5.2.9») — «БНбД 31-25-22 5.2.9» гэхэд
      //    бүтэцтэй хөл түүнийг олж, «эх сурвалжийг шалга» гэж хэлнэ.
      clause_no: kind === 'canonical_rule' || kind === 'source_gate' ? locator : null,
      section_path: sectionPath,
      text_mn: text,
      text_latin: null,
      search_text: search,
      authority_level: 'normative',
      visibility: 'public_norm',
      // ⚠️ `direct_answer: false` = багц өөрөө «утгыг таамаглахгүй, эхийг шалга» —
      //    цагаан жагсаалтад ОРОХГҮЙ төлөв, УСТГАГДАХГҮЙ (хайгдана).
      verification_status: direct ? 'verified_official_text' : 'needs_human_review',
      retrieval_weight: kind === 'canonical_rule' ? 1.2 : kind === 'source_gate' ? 0.9 : 1.0,
      metadata: {
        locator,
        direct_answer: direct,
        amended_2024: c.amended_2024 === true,
        answer_source: {
          norm_code: docCode,
          locator: locator !== null ? `заалт ${locator}` : kind,
          url: str(c.source_url),
          ...(amendment !== null ? { amendment_order: amendment.order, amendment_date: amendment.date, amendment_url: amendment.url } : {}),
        },
      },
    };
  });
}

/**
 * Хэсэг бүрд `quote_source_clause` шаардлага (legalinfo-ийн «хэсэг бүр дүрэмтэй»
 * дүрмийг дахин ашиглана); өөрчлөгдсөн заалтад тушаалын тэмдэглэл + хайлтын alias.
 */
export function amendedRulesRules(chunks: ReadonlyArray<ChunkIn>, amendments: readonly AmendmentIn[]): RuleIn[] {
  const amendmentOf = new Map(amendments.map((a) => [a.clause, a] as const));
  return legalinfoProseRules([], chunks).map((r) => {
    const a = r.clause_no !== null ? amendmentOf.get(r.clause_no) : undefined;
    if (a === undefined) return r;
    return {
      ...r,
      aliases_mn: [...r.aliases_mn, 'нэмэлт өөрчлөлт', 'өөрчлөлт орсон заалт', `тушаал ${a.order ?? ''}`.trim()],
      notes: [
        ...r.notes,
        `${amendmentLabel(a)}${a.url !== null ? ` — ${a.url}` : ''}`,
        ...(a.old_phrase !== null && a.current_phrase !== null ? [`хуучин «${a.old_phrase}» → одоо «${a.current_phrase}»`] : []),
      ],
    };
  });
}

/* ── Профайл 7: тэсрэх, шатах галын аюулын ангилал (БД 21-101-12) ───── */

/**
 * `{'min': 1401, 'max': 2200}` гэсэн python-dict repr-ийг хүн уншихуйц муж
 * болгоно — багцын хэсгийн бичвэр ингэж ирдэг; загварт python үзүүлэхгүй.
 */
export function cleanPythonRepr(text: string): string {
  // GAP-023: нэг хэрэгжүүлэлт (`reprText.ts`) — харьцуулагч + нэрлэсэн хувилбар хоёуланг.
  return normalizeReprText(text, { percentVariants: true });
}

/**
 * Хэсгүүд: clause / classification_rule / building_classification_rule /
 * formula / reference_table.  `section` нь мөр («4. Тооцооны аргачлал»),
 * заалтын дугаар нь id-ийн `:clause:<n>` хэсгээс; хүснэгт, томьёоны дугаар
 * нь тусдаа талбараас.
 */
export function fireHazardChunks(rows: ReadonlyArray<Record<string, unknown>>): ChunkIn[] {
  return rows.map((c) => {
    const id = String(c.chunk_id ?? '');
    const clause = clauseFromChunkId(id);
    const formulaNo = c.formula_number === undefined || c.formula_number === null ? null : String(c.formula_number);
    const kind = String(c.kind ?? 'clause');
    const text = cleanPythonRepr(String(c.text_mn ?? ''));
    return {
      chunk_id: id,
      kind,
      page: num(c.page),
      source_pdf_page: null,
      table_no: num(c.table),
      row_no: null,
      clause_no: clause,
      section_path: str(c.section),
      text_mn: text,
      text_latin: str(c.text_latin),
      search_text: cleanPythonRepr(String(c.search_text ?? '')),
      authority_level: String(c.authority_level ?? 'normative'),
      visibility: String(c.visibility ?? 'public_norm'),
      verification_status: String(c.verification_status ?? 'unknown'),
      retrieval_weight: kind === 'clause' || kind === 'classification_rule' ? 1.0 : 0.9,
      metadata: {
        ...((c.source_locator as Record<string, unknown> | undefined) ?? {}),
        category: c.category ?? null,
        formula_number: formulaNo,
        table_name: c.table_name ?? null,
      },
    };
  });
}

/**
 * Локал ДҮРЭМ — ЗӨВХӨН заалтын бичвэрийн «шаардлага» (тоон нөхцөлгүй).
 *
 * ⚠️ В-муж, өрөөний А/Б/Г/Д, томьёог энд ГҮЙЦЭТГЭХ дүрэм болгохгүй.  Локал
 *    хөдөлгүүр нь нэг талбар × нэг харьцуулагч (nested any/all, enum, томьёо
 *    илэрхийлж чадахгүй); тэдгээрийг Worker-ийн бүртгэл л гүйцэтгэнэ.  Хоёр
 *    хөдөлгүүр нэг дүрмийг ӨӨР чадвартай ажиллуулбал зөрөх нь гарцаагүй.
 *    Тиймээс энд бүх бичлэг `requirement` — олдвол `supported`, `verified` БИШ.
 */
export function fireHazardRules(chunks: readonly ChunkIn[], docId: string): RuleIn[] {
  return chunks
    .filter((c) => c.kind === 'clause' || c.kind === 'classification_rule' || c.kind === 'building_classification_rule')
    .map((c) => ({
      rule_id: `${c.chunk_id}:requirement`,
      chunk_id: c.chunk_id,
      rule_kind: 'requirement' as const,
      table_no: c.table_no,
      row_no: null,
      clause_no: c.clause_no,
      page: c.page,
      section: c.section_path,
      object_mn: c.text_mn.slice(0, 200),
      object_latin: c.text_latin === null ? null : c.text_latin.slice(0, 200),
      actor: null,
      required_context: [],
      conditions: [],
      aliases_mn: [],
      aliases_latin: [],
      aliases_en: [],
      decision_policy: 'text_only_executable_in_worker_registry',
      citation_required: true,
      verification_status: c.verification_status,
      notes: [`doc:${docId}`],
    }));
}
