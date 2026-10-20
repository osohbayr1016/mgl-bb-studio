/**
 * MGL AI · НОРМАТИВ БАГЦЫН ШИНГЭЭЛТ (§11, §16).
 *
 * ⚠️ ЭНЭ НЬ СУРГАЛТ БИШ, ХАЙЛТ.  §16: «DO NOT start by fine-tuning.»
 *    Багцуудын өөрсдийнх нь бодлого мөн адил хэлдэг:
 *      БНбД 21-04-05: retrieval_first_do_not_bake_changeable_norms_into_model_weights
 *      УББ 12-01-01:  «Fine-tuning … must not replace the structured source of truth»
 *    Тиймээс заалт, дүрэм нь загварын ЖИНД ОРОХГҮЙ — локал SQLite-д орж,
 *    асуулт бүрд эшлэлтэйгээр татагдана.  Үр дагавар:
 *      • шинэ норм ирэхэд ДАХИН ШИНГЭЭНЭ, дахин сургахгүй
 *      • буруу мөрийг устгаад дахин оруулж болно
 *      • загварын хувилбар солигдоход мэдлэг ХЭВЭЭР үлдэнэ
 *
 * ⚠️ ХОЁР ХЭЛБЭР, НЭГ ХӨДӨЛГҮҮР.  Багцууд өөр бүтэцтэй ирдэг
 *    (`datasetProfiles.ts` тайлбарыг үз) — тэднийг ЭНД жигдрүүлнэ.
 *    Доод давхаргууд (`rules.ts`, `search.ts`, `pipeline.ts`) хэлбэрийн
 *    тухай ЮУ Ч мэдэхгүй.
 *
 * ⚠️ ИДЕМПОТЕНТ.  Баримт тус бүрээр цэвэрлээд дахин оруулна.  FTS
 *    индексийг БҮХЭЛД НЬ дахин барина (доор шалтгааныг үз).
 *
 * ⚠️ БАТАЛГААЖААГҮЙ МӨР ЭНД ЗОГСОХГҮЙ, ЗОРИУД.  `needs_human_review`
 *    дүрэм нь ШИНГЭЭГДЭНЭ (ажилтан эх сурвалжийг УНШИЖ болох ёстой) —
 *    гүйцэтгэлийн хаалга нь `rules.ts`-д, хайлтын хаалга ЭНД БИШ.
 *    Тэднийг хасах нь «энэ норм байхгүй» гэсэн худал сэтгэгдэл төрүүлнэ.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { foldText } from './fold.ts';
import { ingestExplanations, l2DirForPack, type ExplanationIngestCounts } from './explain.ts';
import { datasetIdentity } from './datasetIdentity.ts';
import { isExecutableVerification, classifyVerification, type VerificationClass } from './rules.ts';
import {
  detectProfile,
  tableRulesChunks,
  tableRulesRules,
  tableRulesTests,
  clauseRulesChunks,
  clauseRulesRules,
  clauseRulesTests,
  guidelineRules,
  GUIDELINE_RULE_FILES,
  legalinfoChunks,
  legalinfoProseRules,
  legalinfoNumericRows,
  legalinfoTables,
  legalinfoGenericTables,
  documentVerificationFallback,
  dominantDeclaredVerification,
  rowVerification,
  legalinfoScalarRules,
  flatClauseNumericRules,
  appendixChunkId,
  amendedChunkId,
  amendedRulesChunks,
  amendedRulesRules,
  normalizeAmendments,
  clauseChunkId,
  LEGALINFO_PROSE_FILES,
  normalizeAliasMap,
  normalizeEffectiveStatus,
  normalizeCases,
  normalizeAliasGroups,
  normalizeAliasRows,
  type ChunkIn,
  type RuleIn,
  type TestIn,
  type CaseIn,
  type AliasIn,
  fireHazardChunks,
  fireHazardRules,
  clauseDocumentChunks,
  procedureRules,
} from './datasetProfiles.ts';

export interface IngestCounts {
  document: string;
  profile: string;
  chunks: number;
  rules: number;
  rulesByKind: Record<string, number>;
  aliases: number;
  tests: number;
  cases: number;
  unverifiedRules: number;
  unverifiedChunks: number;
  orphanRules: string[];
  warnings: string[];
  /** L2 заалтын тайлбар (`../l2/` багцын хажууд байвал, зөвхөн `clause_document`) — 2026-09-18. */
  explanations?: ExplanationIngestCounts;
  /** GAP-025: баталгаажилтын төлөвийн бүртгэлтэй тулгасан дүн (түүхий мөрөөр). */
  verification: VerificationAudit;
}

export interface VerificationAudit {
  /** төлөв → анги + мөрийн тоо (бүх .jsonl-ийн `verification_status`). */
  statuses: Record<string, { class: VerificationClass; rows: number }>;
  /** Аль ч бүртгэлд байхгүй төлөвүүд — `--strict` шингээлт УНАНА. */
  unknown: string[];
  /** Багц «одоогийн нийцэлд хэрэглэж болно» гэсэн ч төлөв нь гүйцэтгэгдэхгүй мөр. */
  markedUsableNonExecutable: { rows: number; statuses: string[] };
}

/**
 * GAP-025: багцын БҮХ .jsonl мөрийн `verification_status`-ыг `rules.ts`-ийн гурван ангитай
 * тулгана.  Түүхий мөрөөр (адаптерын ӨМНӨ) — Session C-ийн `dataset-lint`-тэй ижил түвшин.
 *
 * ⚠️ `verified` + `usable_for_current_compliance: true` нь адаптерт `verified_official_text`
 *    болдог (11-08-23) тул тэр хосыг «туг хүчингүй» гэж тоолохгүй; бусад гүйцэтгэгдэхгүй
 *    төлөвтэй атлаа тугтай мөр нь ЧИМЭЭГҮЙ хүний хяналт руу унадаг байсан → одоо ил.
 */
function nestedGenericVerified(row: Record<string, unknown>): string | null {
  for (const key of ['source', 'answer_source']) {
    const o = row[key];
    if (typeof o === 'object' && o !== null && (o as Record<string, unknown>).verification_status === 'verified') return 'verified';
  }
  return null;
}

export function auditVerification(folder: string): VerificationAudit {
  const statuses: Record<string, { class: VerificationClass; rows: number }> = {};
  const usableStatuses = new Set<string>();
  let usableRows = 0;
  const files = readdirSync(folder).filter((f) => f.endsWith('.jsonl'));
  for (const f of files) {
    for (const row of readJsonl(join(folder, f))) {
      // Дээд түвшин → үүрлэсэн (`source.` / `answer_source.`) — ерөнхий «verified» ч тоологдоно
      //    (Session C lint-тэй ижил); адаптер түүнийг тугтай нь хамт нарийн мөр болгодог.
      const status = rowVerification(row) ?? nestedGenericVerified(row);
      if (status === null) continue;
      const cls = classifyVerification(status);
      const cur = statuses[status] ?? { class: cls, rows: 0 };
      cur.rows += 1;
      statuses[status] = cur;
      const meta = (typeof row.metadata === 'object' && row.metadata !== null ? row.metadata : {}) as Record<string, unknown>;
      const markedUsable = row.usable_for_current_compliance === true || meta.allow_current_compliance_answer === true;
      if (markedUsable && cls !== 'executable' && status !== 'verified') {
        usableRows += 1;
        usableStatuses.add(status);
      }
    }
  }
  return {
    statuses,
    unknown: Object.keys(statuses).filter((k) => statuses[k]!.class === 'unknown').sort(),
    markedUsableNonExecutable: { rows: usableRows, statuses: [...usableStatuses].sort() },
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** ⚠️ Хоосон мөр, BOM, CRLF — багц гараар засагдвал гурвуулаа гарна. */
/** GAP-026: багц доторх давхардсан id → алдаа (чимээгүй REPLACE-ийн оронд). */
export function assertUniqueIds(ids: readonly string[], what: string, docId: string): void {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (id.length === 0) throw new Error(`${docId}: хоосон ${what}.`);
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  if (dup.size > 0) {
    throw new Error(`${docId}: ${what} давхардсан (${dup.size}): ${[...dup].slice(0, 6).join(', ')}${dup.size > 6 ? ' …' : ''} — багц дотор id давтагдаж болохгүй.`);
  }
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const out: Array<Record<string, unknown>> = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length === 0) continue;
    out.push(JSON.parse(t) as Record<string, unknown>);
  }
  return out;
}

/**
 * FTS-ийн хайлтын мөр.
 *
 * ⚠️ ФОЛДОЛСОН ХЭЛБЭР ЗААВАЛ ОРНО.  Багцын галиг («төхөөрөмж» →
 *    «tukhuurumj») ба `foldText` («tohoromj») нь ЗӨРНӨ — хоёуланг нь
 *    индекслэхгүй бол ажилтны бичсэн гуравдагч галиг аль алинтай нь
 *    таарахгүй.  Гурван хэлбэр = гурван гүүр.
 */
function searchBlob(c: ChunkIn): string {
  const parts = [c.text_mn, c.text_latin ?? '', c.search_text, foldText(c.text_mn), foldText(c.text_latin ?? '')];
  return parts.filter((p) => p.trim().length > 0).join(' | ');
}

/**
 * Багцын хавтсыг локал мэдлэгийн санд шингээнэ.
 *
 * ⚠️ ГҮЙЛГЭЭ ДОТОР.  Дунд нь тасарвал ХАГАС шингээгдсэн баримт үлдэх нь
 *    хамгийн муу төлөв: заалт нь байгаа ч дүрэм нь байхгүй бол хайлт
 *    олоод тооцоолж чадахгүй, шалтгаан нь харагдахгүй.
 */
export function ingestDataset(db: DatabaseSync, folder: string): IngestCounts {
  const warnings: string[] = [];
  const has = (f: string): boolean => existsSync(join(folder, f));
  const nonEmpty = (f: string): boolean => has(f) && statSync(join(folder, f)).size > 0;

  for (const f of ['document.json', 'knowledge_chunks.jsonl', 'aliases.json']) {
    if (!has(f)) throw new Error(`Багцад ${f} байхгүй байна: ${folder}`);
  }

  const profile = detectProfile(has, nonEmpty);
  if (profile === null) {
    throw new Error(
      'Багцын хэлбэрийг таньсангүй.  `rules.jsonl` (хүснэгтийн мөр), ' +
        '`obligation_rules.jsonl` (заалт), `general_principles.jsonl` + ' +
        '`implementation_rules.jsonl` (аргачилсан заавар), `duty_rules.jsonl` + ' +
        '`legal_status_graph.json` (legalinfo заалт), `duty_rules.jsonl` + ' +
        '`qualification_rules.jsonl` (хавтгай заалт), `procedure_rules.jsonl` + `required_documents.jsonl` (журам), эсвэл `canonical_rules.jsonl` + ' +
        '`section_index.jsonl` (нэмэлт өөрчлөлттэй норм), эсвэл `room_category_rules.jsonl` + ' +
        '`v_subcategory_rules.jsonl` (галын аюулын ангилал, хоёулаа хоосон биш), эсвэл `norm-dataset.pack.json` (ai/norm-dataset багц) байх ёстой — ' +
        '`datasetProfiles.ts`-ийг үз.',
    );
  }

  const doc = readJson(join(folder, 'document.json')) as Record<string, unknown>;
  const docId = String(doc.doc_id ?? '');
  if (docId.length === 0) throw new Error('document.json дотор doc_id байхгүй.');
  // ⚠️ БНбД 31-23-12 (2026-09-11) `code` ӨГДӨГГҮЙ — 2022 онд дугаар нь солигдсон
  //    тул `current_code` + `legacy_code` хосоор ирдэг.  Нөөцгүй бол баримтын код
  //    хоосон болж эшлэл «, заалт 4.17» гэж эхэлнэ, `namedDocuments` хэзээ ч
  //    таарахгүй.  Хуучин код нь багцын `global_aliases`-д аль хэдийн alias.
  const docCode = String(doc.code ?? doc.current_code ?? '');

  const rawChunks = readJsonl(join(folder, 'knowledge_chunks.jsonl'));
  const rawCases = readJsonl(join(folder, 'calculation_cases.jsonl'));

  let chunks: ChunkIn[];
  let rules: RuleIn[];
  let tests: TestIn[];

  if (profile === 'clause_document') {
    // ai/norm-dataset (БНбД 31-17-10): хэсэг = заалт/хүснэгт/томьёо/нэр томъёо (текст давхаргаас),
    // дүрэм = зөвхөн тоон мөр (legalinfo скаляр адаптер, гүйцэтгэгдэхгүй төлөвтэй), тест = хэсгийн id.
    chunks = clauseDocumentChunks(rawChunks);
    const byId = new Map(chunks.map((c) => [c.chunk_id, c] as const));
    // ⚠️ ЗӨВХӨН ГҮЙЦЭТГЭГДЭХ ТӨЛӨВТЭЙ тоон мөр дүрэм болно.  Автоматаар задалсан
    //    (`official_pdf_text_layer_auto_extracted`) мөрийг `ai_rules`-д оруулбал хоолой
    //    тэднийг эшлэлийн ЭХ болгон сонгож (хэмжсэн 2026-09-16: 4.6-ийн асуултад 10.6-ийн
    //    «дүрэм» → `uncertain`, хуудас зөрсөн, эшлэлийн таарц 36%), гэвч гүйцэтгэхгүй.
    //    Хүн баталгаажуулж багц дахь төлөвийг цагаан жагсаалтын мөр болгосны дараа л орно;
    //    түүнээс өмнө тоон нэр дэвшигч нь багцын файлд (хүний хяналтад) л амьдарна.
    const numeric = legalinfoNumericRows(readJsonl(join(folder, 'numeric_requirements.jsonl')), 'official_pdf_text_layer_auto_extracted').filter((r) => isExecutableVerification(r.verification_status));
    rules = legalinfoScalarRules(numeric, new Set(), (id) => byId.get(id), docId);
    tests = clauseRulesTests(readJsonl(join(folder, 'qa_retrieval_tests.jsonl')), (id) => byId.has(id));
  } else if (profile === 'table_rules') {
    chunks = tableRulesChunks(rawChunks);
    rules = tableRulesRules(readJsonl(join(folder, 'rules.jsonl')));
    tests = tableRulesTests(readJsonl(join(folder, 'qa_retrieval_tests.jsonl')));
  } else if (profile === 'guideline_rules') {
    // ⚠️ ХЭСГИЙН ХЭЛБЭР НЬ `clause_rules`-ТАЙ ИЖИЛ, дүрмийнх нь ӨӨР.
    //    Хоёр багцын `knowledge_chunks.jsonl` нь яг нэг схемтэй тул
    //    хэсгийн адаптерыг ХУВИЛАХГҮЙ — зөвхөн дүрмийн хэсэг шинэ.
    chunks = clauseRulesChunks(rawChunks);
    rules = guidelineRules(
      docId,
      GUIDELINE_RULE_FILES.flatMap((f) => readJsonl(join(folder, f))),
      readJsonl(join(folder, 'numeric_requirements.jsonl')),
    );
    tests = clauseRulesTests(readJsonl(join(folder, 'qa_retrieval_tests.jsonl')));
  } else if (profile === 'legalinfo_rules') {
    // ⚠️ ГУРВАН ЭХ СУРВАЛЖ, НЭГ ДАРААЛАЛ: (1) багцын хэсгүүд, (2) лавлах
    //    хүснэгтийн мөр → ӨӨРИЙН хэсэг + дүрэм (тоон мөртэй тулгагдана),
    //    (3) хүснэгтэд ороогүй тоон мөр → заалт бүрд нэг скаляр дүрэм.
    //    (2)-ыг (3)-аас ӨМНӨ — тулгагдсан тоон мөр (3)-д ДАХИН орохгүй.
    // GAP-025: мөрийн зарласан төлөв (үүрлэсэн ч) баримтын өгөгдмөлийг ДАРНА — 31-23-12/31-24-22
    //    `verified_official_text` болж чимээгүй гүйцэтгэгдэхгүй; бүртгэлгүй төлөв хаалттай + тайлагнагдана.
    const fallbackVerification = documentVerificationFallback(doc, dominantDeclaredVerification(rawChunks));
    chunks = legalinfoChunks(rawChunks, fallbackVerification);
    const numeric = legalinfoNumericRows(readJsonl(join(folder, 'numeric_requirements.jsonl')), fallbackVerification);
    const tablesPath = join(folder, 'reference_tables.json');
    const sectionOf = (clause: string): string | null =>
      chunks.find((c) => c.clause_no === clause)?.section_path ?? null;
    const tables = existsSync(tablesPath) ? (readJson(tablesPath) as Record<string, unknown>) : {};
    // ⚠️ Хүснэгтийн ХОЁР хэлбэр: 11-03-21 нь нэрлэсэн бүтэцтэй (`borehole_spacing_table_5_1`,
    //    тоон мөртэй тулгагдана), 11-08-23 нь дугаараар («1.3») + `title_mn` +
    //    холимог утгатай мөр.  Аль нь ч байж болно; хоёулаа хоосон бол юу ч үгүй.
    const structured = legalinfoTables(docId, tables, numeric, sectionOf);
    const generic = legalinfoGenericTables(docId, tables, fallbackVerification);
    const derived = {
      chunks: [...structured.chunks, ...generic.chunks],
      rules: [...structured.rules, ...generic.rules],
      consumed: structured.consumed,
      warnings: [...structured.warnings, ...generic.warnings],
    };
    warnings.push(...derived.warnings);
    chunks = [...chunks, ...derived.chunks];
    const byId = new Map(chunks.map((c) => [c.chunk_id, c] as const));
    rules = [
      ...legalinfoProseRules(
        LEGALINFO_PROSE_FILES.map(([file, kind]) => ({ kind, rows: readJsonl(join(folder, file)) })),
        chunks,
      ),
      ...derived.rules,
      ...legalinfoScalarRules(numeric, derived.consumed, (id) => byId.get(id), docId),
    ];
    tests = clauseRulesTests(readJsonl(join(folder, 'qa_retrieval_tests.jsonl')), (id) => byId.has(id));
  } else if (profile === 'amended_rules') {
    // БНбД 31-25-22: каноник заалт + бүлгийн хаалт + 2024 оны өөрчлөлт.  Тоон мөр нь
    // legalinfo-ийн скаляр адаптераар (`rule_id` ≠ хэсгийн id → мөр бүр өөрийн дүрэм;
    // хэсэг нь `<doc>:<locator>`).
    const amendPath = join(folder, 'amendment_2024_rules.json');
    const amendments = normalizeAmendments(existsSync(amendPath) ? readJson(amendPath) : []);
    chunks = amendedRulesChunks(
      rawChunks,
      readJsonl(join(folder, 'section_index.jsonl')),
      readJsonl(join(folder, 'canonical_rules.jsonl')),
      amendments,
      docCode,
    );
    const byId = new Map(chunks.map((c) => [c.chunk_id, c] as const));
    const numeric = legalinfoNumericRows(readJsonl(join(folder, 'numeric_requirements.jsonl')), 'verified_official_text');
    rules = [...amendedRulesRules(chunks, amendments), ...legalinfoScalarRules(numeric, new Set(), (id) => byId.get(id), docId)];
    tests = clauseRulesTests(readJsonl(join(folder, 'qa_retrieval_tests.jsonl')), (id) => byId.has(id));
  } else if (profile === 'fire_hazard_rules') {
    // БД 21-101-12: хэсэг = эх бичвэр (python-repr цэвэрлэсэн), дүрэм = зөвхөн
    // «шаардлага» (гүйцэтгэх логик Worker-ийн бүртгэлд), тест = хэсгийн id.
    chunks = fireHazardChunks(rawChunks);
    rules = fireHazardRules(chunks, docId);
    const ids = new Set(chunks.map((c) => c.chunk_id));
    tests = clauseRulesTests(readJsonl(join(folder, 'qa_retrieval_tests.jsonl')), (id) => ids.has(id));
  } else if (profile === 'procedure_rules') {
    // БНбД 11-03-02: хэсэг = clause_rules хэлбэр, дүрэм = журмын алхам / зөвшөөрөл / шаардлагатай
    // баримт (бүгд quote_source_clause, `legalinfoProseRules`-ийн хэсэг-бүр-дүрэм нөхөлттэй).
    chunks = clauseRulesChunks(rawChunks);
    rules = procedureRules(
      docId,
      {
        procedures: readJsonl(join(folder, 'procedure_rules.jsonl')),
        approvals: readJsonl(join(folder, 'approval_requirements.jsonl')),
        documents: readJsonl(join(folder, 'required_documents.jsonl')),
      },
      chunks,
    );
    const ids = new Set(chunks.map((c) => c.chunk_id));
    tests = clauseRulesTests(readJsonl(join(folder, 'qa_retrieval_tests.jsonl')), (id) => ids.has(id));
  } else if (profile === 'flat_clause_rules') {
    // Хэсэг нь `clause_rules`-ийн хэлбэр (хэвлэмэл + PDF хуудас), дүрэм нь
    // legalinfo-ийн ХАВТГАЙ мөр — хоёр адаптерыг ХОСЛУУЛНА, гурав дахийг бичихгүй.
    chunks = clauseRulesChunks(rawChunks);
    rules = [
      ...legalinfoProseRules(
        LEGALINFO_PROSE_FILES.map(([file, kind]) => ({ kind, rows: readJsonl(join(folder, file)) })),
        // ⚠️ Батлах тушаал, нийтлэлийн хязгаар зэрэг `metadata` хэсэгт «шаардлага»
        //    гэсэн дүрэм өгөхгүй — тэд норм биш.
        chunks.filter((c) => c.kind !== 'metadata'),
      ),
      ...flatClauseNumericRules(readJsonl(join(folder, 'numeric_requirements.jsonl'))),
    ];
    tests = clauseRulesTests(readJsonl(join(folder, 'qa_retrieval_tests.jsonl')));
  } else {
    chunks = clauseRulesChunks(rawChunks);
    rules = clauseRulesRules(docId, {
      obligations: readJsonl(join(folder, 'obligation_rules.jsonl')),
      rights: readJsonl(join(folder, 'rights_rules.jsonl')),
      responsibilities: readJsonl(join(folder, 'responsibility_rules.jsonl')),
      thresholds: readJsonl(join(folder, 'deadline_threshold_rules.jsonl')),
    });
    tests = clauseRulesTests(readJsonl(join(folder, 'qa_retrieval_tests.jsonl')));
  }

  // ⚠️ Кейсийн `rule` талбар нь заалт («4.17») ЭСВЭЛ хавсралт («Appendix V», 31-23-12)
  //    байж болно; хэсгийн id-ийн хэлбэр нь профайлаас хамаарна.
  const chunkIdSet = new Set(chunks.map((c) => c.chunk_id));
  const caseChunkId = (id: string, rule: string): string =>
    profile === 'amended_rules'
      ? amendedChunkId(id, rule)
      : // 31-24-22-ын NG002: `rule: "APP-B1"` — хүснэгтийн хэсэг.
        (/^APP-/.test(rule) && chunkIdSet.has(`${id}:table:${rule}`) ? `${id}:table:${rule}` : null) ??
        appendixChunkId(id, rule, (x) => chunkIdSet.has(x)) ??
        clauseChunkId(id, rule);
  const cases: CaseIn[] = normalizeCases(rawCases, { docId, code: docCode }, caseChunkId);

  // ── Alias: бүлгийн файл + мөрийн индекс + дүрмийн өөрийн alias ──
  // ⚠️ `aliases.json` ХОЁР ХЭЛБЭРТЭЙ ирдэг: массив (бүлэг) эсвэл объект
  //    (canonical → мөрүүд).  Хэлбэрийг нь ХАРААД сонгоно, профайлаар биш.
  const aliasFile = readJson(join(folder, 'aliases.json'));
  const aliases: AliasIn[] = [
    ...(Array.isArray(aliasFile)
      ? normalizeAliasGroups(aliasFile as Array<Record<string, unknown>>)
      : normalizeAliasMap((aliasFile ?? {}) as Record<string, unknown>, str(docCode))),
    ...normalizeAliasRows(readJsonl(join(folder, 'keyword_alias_index.jsonl'))),
  ];
  for (const r of rules) {
    for (const [lang, list] of [
      ['mn', r.aliases_mn],
      ['latin', r.aliases_latin],
      ['en', r.aliases_en],
    ] as const) {
      for (const a of list) aliases.push({ canonical: r.rule_id, language: lang, alias: a });
    }
  }

  // ⚠️ Манифестын тоотой тулгана — эвдэрсэн/тайрагдсан файлыг ЧИМЭЭГҮЙ
  //    хүлээж авах нь хамгийн муу.  Зөрөх нь СЭРЭМЖЛҮҮЛЭГ, зогсоолт биш:
  //    манифест нь заримдаа шинэчлэгддэггүй.
  const manifestPath = join(folder, 'manifest.json');
  if (existsSync(manifestPath)) {
    const man = readJson(manifestPath) as { counts?: Record<string, number> };
    const expect = man.counts ?? {};
    const expectChunks = expect.chunks ?? expect.knowledge_chunks;
    if (typeof expectChunks === 'number' && expectChunks !== chunks.length) {
      warnings.push(`Манифест ${expectChunks} хэсэг гэсэн ч файлд ${chunks.length} байна.`);
    }
    const expectTests = expect.qa_tests ?? expect.qa_retrieval_tests;
    if (typeof expectTests === 'number' && expectTests !== tests.length) {
      warnings.push(`Манифест ${expectTests} тест гэсэн ч файлд ${tests.length} байна.`);
    }
  }

  const identity = datasetIdentity(folder, identityFilesFor(profile));
  const manifestMeta = existsSync(join(folder, 'manifest.json')) ? (readJson(join(folder, 'manifest.json')) as Record<string, unknown>) : {};
  const manifestVersion = manifestMeta.version;
  const manifestId = manifestMeta.dataset_id;

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT OR REPLACE INTO ai_documents
         (doc_id, code, title_mn, jurisdiction, authority, order_date, order_number, version,
          effective_status, source_file, source_sha256, pages, training_policy, metadata_json, ingested_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
    ).run(
      docId,
      docCode,
      String(doc.title_mn ?? ''),
      String(doc.jurisdiction ?? 'Mongolia'),
      (doc.authority as string) ?? (doc.approved_by as string) ?? null,
      (doc.order_date as string) ?? (doc.approval_order_date as string) ?? null,
      (doc.order_number as string) ?? (doc.approval_order_number as string) ?? null,
      (doc.version as string) ?? null,
      // ⚠️ УББ багц нь `legal_status`, БНбД нь `effective_status` гэж нэрлэдэг.
      //    ХОЁУЛАА «шалгаагүй» гэсэн утгатай тул эшлэл дээр анхааруулга
      //    гарна (`citation.ts`).  Өгөгдмөл нь ХАМГИЙН БОЛГООМЖТОЙ утга.
      normalizeEffectiveStatus(
        // ⚠️ СНиП багц `mongolia_status: listed_as_current` гэж нэрлэдэг —
        //    `in_force` БИШ (техникийн эх нь mirror, PDF-тэй тулгаагүй) →
        //    `currentness.ts` UNKNOWN → хүний хяналтын трейлер.  Зориуд.
        // ⚠️ 31-24-22 / 31-25-22 нь `status` гэж нэрлэдэг (`current_registered_verified`,
        //    `current_amended_verified`).  Дөрөв дэх нэр; танигдахгүй утга ХЭВЭЭР үлдэж
        //    хуулийн хяналтын трейлер гарна — `normalizeEffectiveStatus`-ийг үз.
        String(doc.effective_status ?? doc.legal_status ?? doc.mongolia_status ?? doc.status ?? 'unknown_requires_legal_verification'),
      ),
      String(doc.source_file ?? ''),
      String(doc.source_sha256 ?? ''),
      // ⚠️ ГУРВАН НЭР: `pages` (БНбД), `printed_pages` (УББ 12-01-01),
      //    `pdf_scan_pages` (УББ-11-201-00).  Сүүлийнхийг аваагүй тул
      //    `/norm/info` тэр баримтыг «0 хуудас» гэж харуулж байв.
      Number(doc.pages ?? doc.printed_pages ?? doc.pdf_scan_pages ?? 0),
      (doc.training_policy as string) ?? (doc.production_policy as string) ?? null,
      // ⚠️ Багцын таних тэмдэг (Amendment A): Worker-ийн хөрвүүлсэн бүртгэл ИЖИЛ
      //    функцээр ижил файлуудын SHA-256-г тээдэг; `/norm`-ийн эшлэл үүнийг
      //    мэдээлж, backend тулгана (`NORM_DATA_VERSION_MISMATCH`).
      JSON.stringify({ ...doc, dataset_identity: identity, dataset_version: str(manifestVersion), dataset_id: str(manifestId) }),
    );

    // ⚠️ ДАРААЛАЛ: дүрэм → хэсэг.  Дүрэм нь хэсэг рүү FK-тай тул хэсгийг
    //    устгахаас ӨМНӨ дүрмийг устгана — ил хийх нь чимээгүй CASCADE-ээс дээр.
    db.prepare('DELETE FROM ai_rules WHERE doc_id = ?').run(docId);
    db.prepare('DELETE FROM ai_chunks WHERE doc_id = ?').run(docId);

    // ⚠️⚠️ FTS5-Д `chunk_id`-ААР УСТГАХ НЬ АЖИЛЛАХГҮЙ.  `chunk_id` нь
    //    UNINDEXED багана тул `DELETE FROM ai_chunks_fts WHERE chunk_id = ?`
    //    нь алдаа ӨГӨХГҮЙ, гэвч ЮУ Ч УСТГАХГҮЙ.  Хэмжсэн (2026-09-08):
    //    хоёр дахь шингээлтийн дараа индекст 126-ийн оронд 252 мөр үлдэж,
    //    BM25 нэг хэсгийг хоёр удаа тоолж эрэмбийг гажуудуулж байв.
    //    Тиймээс индексийг БҮХЭЛД НЬ дахин барина — WHERE-гүй DELETE нь
    //    ажилладаг ба FTS нь `ai_chunks`-ийн бүрэн дериватив.
    db.prepare('DELETE FROM ai_chunks_fts').run();

    const insChunk = db.prepare(
      `INSERT INTO ai_chunks
         (chunk_id, doc_id, kind, page, source_pdf_page, table_no, row_no, clause_no, section_path,
          text_mn, text_latin, search_text, authority_level, visibility,
          verification_status, retrieval_weight, metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );

    let unverifiedChunks = 0;
    for (const c of chunks) {
      if (c.chunk_id.length === 0) throw new Error('chunk_id хоосон мөр байна.');
      // ⚠️ ТООЛУУР НЬ `rules.ts`-ИЙН ХААЛГАТАЙ ИЖИЛ ЭХ СУРВАЛЖААС.
      //    Өмнө нь энд `'verified_from_page_image'` гэсэн мөр ГУРВАН
      //    ГАЗАР давхардаж бичигдсэн байсан — нэгийг нь шинэчлээд
      //    нөгөөг мартах нь «шингээлт 0 баталгаажаагүй гэж хэлсэн ч
      //    хоолой бүгдийг блоклоно» гэсэн чимээгүй зөрүү үүсгэнэ.
      if (!isExecutableVerification(c.verification_status)) unverifiedChunks += 1;
      insChunk.run(
        c.chunk_id,
        docId,
        c.kind,
        c.page,
        c.source_pdf_page,
        c.table_no,
        c.row_no,
        c.clause_no,
        c.section_path,
        c.text_mn,
        c.text_latin,
        searchBlob(c),
        c.authority_level,
        c.visibility,
        c.verification_status,
        c.retrieval_weight,
        JSON.stringify(c.metadata ?? {}),
      );
    }

    // ⚠️ FTS-ИЙГ `ai_chunks`-ААС БҮХЭЛД НЬ ДАХИН БАРИНА.  Дээр индексийг
    //    бүтнээр нь хоослосон тул ЭНЭ баримтын мөрийг Л буцааж хийвэл
    //    бусад баримтууд хайлтаас ЧИМЭЭГҮЙ алга болно.
    db.prepare(
      `INSERT INTO ai_chunks_fts (chunk_id, text_mn, text_latin, search_text)
       SELECT chunk_id, text_mn, COALESCE(text_latin, ''), search_text FROM ai_chunks`,
    ).run();

    const insRule = db.prepare(
      `INSERT INTO ai_rules
         (rule_id, chunk_id, doc_id, rule_kind, table_no, row_no, clause_no, page, section,
          object_mn, object_latin, actor, required_context_json, conditions_json,
          aliases_mn_json, aliases_latin_json, aliases_en_json,
          decision_policy, citation_required, verification_status, notes_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );

    const chunkIds = new Set(chunks.map((c) => c.chunk_id));
    const orphanRules: string[] = [];
    const rulesByKind: Record<string, number> = {};
    let unverifiedRules = 0;

    for (const r of rules) {
      // ⚠️ ӨӨРИЙН ХЭСЭГГҮЙ ДҮРЭМ НЬ ЭШЛЭЛГҮЙ ДҮРЭМ.  Түүнийг оруулбал
      //    `citation_required: true` гэсэн амлалтаа биелүүлж чадахгүй
      //    болно — тиймээс ОРУУЛАХГҮЙ, ИЛ тайлагнана.
      if (!chunkIds.has(r.chunk_id)) {
        orphanRules.push(r.rule_id);
        continue;
      }
      if (!isExecutableVerification(r.verification_status)) unverifiedRules += 1;
      rulesByKind[r.rule_kind] = (rulesByKind[r.rule_kind] ?? 0) + 1;

      insRule.run(
        r.rule_id,
        r.chunk_id,
        docId,
        r.rule_kind,
        r.table_no,
        r.row_no,
        r.clause_no,
        r.page,
        r.section,
        r.object_mn,
        r.object_latin,
        r.actor,
        JSON.stringify(r.required_context),
        JSON.stringify(r.conditions),
        JSON.stringify(r.aliases_mn),
        JSON.stringify(r.aliases_latin),
        JSON.stringify(r.aliases_en),
        r.decision_policy,
        r.citation_required ? 1 : 0,
        r.verification_status,
        JSON.stringify(r.notes),
      );
    }

    // ── Alias ─────────────────────────────────────────────────────
    // ⚠️ ЗӨВХӨН ЭНЭ БАРИМТЫН alias-ыг цэвэрлэнэ.  Бүгдийг устгавал нэг
    //    багц шингээх нь нөгөөгийн alias-ыг АВААД ЯВНА (эхний хувилбарын
    //    алдаа: `DELETE FROM ai_aliases` бүрэн).
    // ⚠️ БАРИМТААР НЬ цэвэрлэнэ (схем 3).  Канонаар цэвэрлэх нь чөлөөт канонтой
    //    бүлгийг («барилгын зураг төсөл») алгасаж, багцаас хассан alias санд
    //    үлдэж байв.
    db.prepare('DELETE FROM ai_aliases WHERE doc_id = ?').run(docId);
    const insAlias = db.prepare(
      'INSERT OR REPLACE INTO ai_aliases (doc_id, canonical, language, alias, alias_fold, weight) VALUES (?,?,?,?,?,?)',
    );
    let aliasCount = 0;
    for (const a of aliases) {
      insAlias.run(docId, a.canonical, a.language, a.alias, foldText(a.alias), 1.0);
      aliasCount += 1;
    }

    // ── Алтан тестүүд ─────────────────────────────────────────────
    db.prepare('DELETE FROM ai_query_tests WHERE doc_id = ?').run(docId);
    // GAP-026: тестийн id нь `<doc_id>::<test_id>` — багц хооронд тогтвортой, давхцахгүй.
    //    Багц ДОТРОО давхцвал `INSERT OR REPLACE` эхнийхийг ЧИМЭЭГҮЙ дарна → энд ЗОГСООНО.
    //    Багц id өгөөгүй (21-04-05: 336 тест) бол адаптер байрлалаар `Q0001…` өгдөг — мөр
    //    нэмэгдвэл дугаар гулсана; ил анхааруулна (алдаа биш — багцын дутагдал).
    assertUniqueIds(tests.map((t) => t.test_id), 'test_id', docId);
    assertUniqueIds(cases.map((c) => c.case_id), 'case_id', docId);
    const positional = tests.filter((t) => /^Q\d{4}$/.test(t.test_id)).length;
    if (positional > 0) {
      warnings.push(`${positional} тест багцад test_id-гүй тул БАЙРЛАЛААР дугаарлагдав (Q0001…) — мөр нэмэгдвэл id гулсана.`);
    }
    const insTest = db.prepare(
      `INSERT OR REPLACE INTO ai_query_tests
         (test_id, doc_id, query, language, expected_rule_id, expected_chunk_id, expected_page, expected_json)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    for (const t of tests) {
      insTest.run(
        // ⚠️ Тестийн id-г БАРИМТААР угтварлана.  Хоёр багц хоёулаа «Q001»
        //    гэж эхэлдэг — угтваргүй бол хоёр дахь багц эхнийхийг ДАРНА.
        `${docId}::${t.test_id}`,
        docId,
        t.query,
        t.language,
        t.expected_rule_id,
        t.expected_chunk_id,
        t.expected_page,
        JSON.stringify(t.raw),
      );
    }

    db.prepare('DELETE FROM ai_calculation_cases WHERE doc_id = ?').run(docId);
    const insCase = db.prepare(
      `INSERT OR REPLACE INTO ai_calculation_cases
         (case_id, doc_id, query_mn, query_latin, query_en, context_json, expected_rule_id, expected_json, must_cite_source)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    for (const c of cases) {
      insCase.run(
        `${docId}::${c.case_id}`,
        docId,
        c.query_mn,
        c.query_latin,
        c.query_en,
        JSON.stringify(c.context ?? {}),
        c.expected_rule_id,
        JSON.stringify(c.expected ?? {}),
        c.must_cite_source ? 1 : 0,
      );
    }

    db.prepare(
      `INSERT INTO ai_ingest_log
         (doc_id, dataset, dataset_version, source_sha256, chunks, rules, aliases, tests, cases, unverified)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      docId,
      folder,
      (doc.version as string) ?? null,
      String(doc.source_sha256 ?? ''),
      chunks.length,
      rules.length - orphanRules.length,
      aliasCount,
      tests.length,
      cases.length,
      unverifiedRules,
    );

    db.exec('COMMIT');

    // L2 — багцын хажуугийн `../l2/clause_explanations.jsonl` (ai/norm-dataset/documents/<Doc>/l2).  Тусдаа
    //    транзакц: хэсгүүд аль хэдийн бичигдсэн; L2 унавал багц шингээлт хэвээр, анхааруулга л.
    let explanations: ExplanationIngestCounts | undefined;
    if (profile === 'clause_document') {
      const l2 = l2DirForPack(folder);
      if (l2 !== null) {
        try {
          explanations = ingestExplanations(db, l2);
          if (explanations.orphan_chunk_ids > 0) warnings.push(`L2: ${explanations.orphan_chunk_ids} тайлбарын chunk_id хэсэгт таарсангүй (багц ↔ l2 зөрүү).`);
        } catch (err) {
          warnings.push(`L2 тайлбар шингээгдсэнгүй: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (orphanRules.length > 0) {
      warnings.push(
        `${orphanRules.length} дүрэм эх хэсэггүй тул ОРООГҮЙ: ${orphanRules.slice(0, 8).join(', ')}` +
          (orphanRules.length > 8 ? ' …' : ''),
      );
    }

    return {
      document: docId,
      profile,
      chunks: chunks.length,
      rules: rules.length - orphanRules.length,
      rulesByKind,
      aliases: aliasCount,
      tests: tests.length,
      cases: cases.length,
      unverifiedRules,
      unverifiedChunks,
      orphanRules,
      warnings,
      verification: auditVerification(folder),
      ...(explanations ? { explanations } : {}),
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Таних тэмдэгт орох файлууд — профайл бүрд.  БД 21-101-12-ын жагсаалт нь
 * `ai/norm-compiler/src/adapters/bd-21-101-12.ts`-ийн `BD_IDENTITY_FILES`-тэй
 * ЯГ ИЖИЛ байх ёстой (тест барина); бусад профайлд мэдэгдэж буй бүх json/jsonl.
 */
export const FIRE_HAZARD_IDENTITY_FILES: readonly string[] = [
  'document.json',
  'manifest.json',
  'knowledge_chunks.jsonl',
  'room_category_rules.jsonl',
  'v_subcategory_rules.jsonl',
  'building_category_rules.jsonl',
  'formulas.jsonl',
  'reference_tables.json',
  'calculation_cases.jsonl',
  'classification_decision_tree.json',
  'aliases.json',
  'keyword_alias_index.jsonl',
  'qa_retrieval_tests.jsonl',
];

/** ai/norm-dataset багц — `norm-dataset.pack.json` нь source_sha256 + тоог үүрдэг; manifest.json нь файлын хэш. */
const CLAUSE_DOCUMENT_IDENTITY_FILES: readonly string[] = [
  'norm-dataset.pack.json',
  'document.json',
  'manifest.json',
  'knowledge_chunks.jsonl',
  'numeric_requirements.jsonl',
  'formulas.jsonl',
  'cross_references.json',
  'aliases.json',
  'keyword_alias_index.jsonl',
  'qa_retrieval_tests.jsonl',
  'calculation_cases.jsonl',
];

export function identityFilesFor(profile: string): readonly string[] {
  if (profile === 'fire_hazard_rules') return FIRE_HAZARD_IDENTITY_FILES;
  if (profile === 'clause_document') return CLAUSE_DOCUMENT_IDENTITY_FILES;
  return [
    'document.json',
    'manifest.json',
    'knowledge_chunks.jsonl',
    'aliases.json',
    'keyword_alias_index.jsonl',
    'qa_retrieval_tests.jsonl',
    'calculation_cases.jsonl',
    'rules.jsonl',
    'obligation_rules.jsonl',
    'rights_rules.jsonl',
    'responsibility_rules.jsonl',
    'deadline_threshold_rules.jsonl',
    'general_principles.jsonl',
    'implementation_rules.jsonl',
    'numeric_requirements.jsonl',
    'duty_rules.jsonl',
    'qualification_rules.jsonl',
    'legal_status_graph.json',
    'reference_tables.json',
    'canonical_rules.jsonl',
    'section_index.jsonl',
    'amendment_2024_rules.json',
    // procedure_rules (БНбД 11-03-02)
    'procedure_rules.jsonl',
    'approval_requirements.jsonl',
    'required_documents.jsonl',
  ];
}
