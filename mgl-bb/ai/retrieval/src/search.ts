/**
 * MGL AI · ХАЙЛТЫН ХӨЛҮҮД — бүтэцтэй, alias, FTS5/BM25 (§11).
 *
 * ⚠️ ГУРВАН ХӨЛ, НЭГ Ч НЬ ГАНЦААРАА ХАНГАЛТГҮЙ:
 *      • БҮТЭЦТЭЙ — «Хүснэгт 3, мөр 9.1.2» гэж нэрлэсэн асуулт.  Хамгийн
 *        нарийн, хамгийн ховор.  Олдвол БҮХ зүйлээс дээгүүр.
 *      • FTS5/BM25 — яг тоо, ховор нэр томьёо, кодыг барина.  Векторын
 *        сул тал: «300» ба «3000» нь утгаараа ойрхон.
 *      • ВЕКТОР — үг хэллэгийн ялгааг барина.  Өнөөдөр `NullVectorIndex`.
 *    Тэднийг RRF-ээр нэгтгэнэ (`fusion.ts`) — оноог нь ШУУД нэмэх нь
 *    буруу: BM25 нь сөрөг, cosine нь 0..1, бүтэцтэй нь тоогүй.
 *
 * ⚠️ ALIAS НЬ ЗӨВХӨН ХАЙЛТЫН ТАЛД.  Өргөтгөсөн үг нь хариултын текстэд
 *    ХЭЗЭЭ Ч гарахгүй — «sprinkler» гэж хайхад ГУАТ-ын мөр олдоно, гэвч
 *    хариу нь эх сурвалжийн «гал унтраах автомат төхөөрөмж» гэсэн үгээр
 *    гарна.  Хольвол орчуулга нь норм болно.
 */
import type { DatabaseSync } from 'node:sqlite';
import { foldText } from './fold.ts';
import { isKnowledgeInfrastructureError, KnowledgeUnavailableError } from './db.ts';
import { appendixLetterTwin, isInstructionWord, isStopword, type NormQuery } from './normalize.ts';
import { stemVariants } from './stem.ts';

export interface Candidate {
  chunkId: string;
  /** Тухайн хөл дотор дахь байр — 1-ээс эхэлнэ.  RRF нь ЗӨВХӨН үүнийг иднэ. */
  rank: number;
  leg: 'structured' | 'alias' | 'context' | 'fts' | 'vector' | 'section';
  /** Оношилгоонд — RRF-д ОРОХГҮЙ. */
  rawScore: number | null;
}

/* ── Alias өргөтгөл ───────────────────────────────────────────────── */

/**
 * Асуултын үгсээс канон ойлголтуудыг олж, тэдгээрийн БҮХ хэлний хувилбарыг
 * буцаана.
 *
 * ⚠️ ХОЁР ТАЛААС НЬ ТААРУУЛНА: `alias_fold` (фолдолсон) ба түүхий `alias`.
 *    Зөвхөн фолдоор таарвал «ГУАТ» гэсэн товчлол алдагдана (фолд нь
 *    `guat` болгоно, тэр нь зөв — гэвч эх мөр нь кириллээр индекслэгдсэн).
 */
export function expandAliases(db: DatabaseSync, q: NormQuery, opts: { maxCanonicalsPerAlias?: number } = {}): string[] {
  const folded = new Set<string>();
  for (const t of q.tokens) folded.add(foldText(t));
  folded.add(q.folded);
  if (folded.size === 0) return [];

  const holes = [...folded].map(() => '?').join(',');
  // ⚠️ КОРРЕЛЯЦГҮЙ, ЗОРИУД.  Өмнөх хувилбар `EXISTS (SELECT … a2 WHERE
  //    a2.canonical = ai_aliases.canonical AND instr(?, a2.alias_fold))` гэсэн
  //    O(n²) дэд асуулга байв — alias 1 800 байхад ажиглагдаагүй, 6 баримт
  //    (4 003 alias) болоход асуулт бүр 900 мс, алтан тест 30 минут болов
  //    (хэмжсэн 2026-09-10).  «Канонын АЛЬ НЭГ alias таарна» гэдэг нь яг
  //    «таарсан мөрүүдийн DISTINCT canonical» тул нэг гүйлт хангалттай.
  const matched = db
    .prepare(
      `SELECT canonical, alias_fold FROM ai_aliases
        WHERE alias_fold IN (${holes})
           OR (length(alias_fold) >= 4 AND instr(?, alias_fold) > 0)`,
    )
    .all(...folded, q.folded) as Array<{ canonical: string; alias_fold: string }>;
  /**
   * ⚠️ ЕРӨНХИЙ ALIAS ОЛОН МӨРИЙГ ТАТДАГ (2026-09-21, БНбД 20-04-17 корпуст орсны дараа хэмжсэн).
   *    «орон сууц» нь 21-04-05-ын 5 мөрийн, «sprinkler» 89 мөрийн alias.  Тэдгээрийн БҮХ
   *    ах дүү alias-ыг («automatic fire extinguishing», «30 м-ээс дээш өндөртэй барилга…»)
   *    FTS-ийн OR илэрхийлэлд нэмэхэд тэр мөрүүд өөрсдийнхөө alias-аар өөрсдийгөө өргөж
   *    FTS-ийн эхний 40-ийг бүхэлд нь дүүргэж байв — «Орон сууцны хучилтад жигд тархсан түр
   *    ачааллын нормын утга» гэхэд 20-04-17-ийн 8.3-р хүснэгт (BM25 3-рт) огт орж ирэхгүй,
   *    оронд нь галын дохиоллын мөр «verified» гарч байв.  Тиймээс FTS хөл (`maxCanonicalsPerAlias`
   *    = 4) нь ≥5 канонд хуваалцсан alias-аар л таарсан канонын ах дүүг ӨРГӨТГӨХГҮЙ — асуултын
   *    (хэмжсэн тархалт: 4 263 alias-ын 62 нь ≥3 канонд; ≥5 нь бүгд барилгын төрөл / системийн
   *    ерөнхий үг: «орон сууц» 5, «агуулах» 13, «fire alarm» 62, «sprinkler» 89.  Босго 2 үед
   *    «архив» (4 канон) capped болж «Архивт хадгалах баримт бичигт ГУАТ?» тоогүй атлаа «verified»
   *    болж байв — `pipeline.test.ts` барьсан; 4 нь тэр тестийг хэвээр үлдээнэ.)  Асуултын
   *    өөрийн үг («орон сууц») FTS-д хэвээр ордог тул тэр мөрүүд алга болохгүй, зөвхөн
   *    хөөрөгдөхөө болино.  Хаалга (`gateTerms`) ба alias хөл хуучин зан төлөвөө хадгална.
   */
  const cap = opts.maxCanonicalsPerAlias;
  let canon: Array<{ canonical: string }> = matched;
  if (cap !== undefined) {
    const perAlias = new Map<string, Set<string>>();
    for (const m of matched) perAlias.set(m.alias_fold, (perAlias.get(m.alias_fold) ?? new Set()).add(m.canonical));
    const specific = new Set<string>();
    for (const m of matched) if ((perAlias.get(m.alias_fold)?.size ?? 0) <= cap) specific.add(m.canonical);
    canon = [...specific].map((c) => ({ canonical: c }));
  } else {
    canon = [...new Set(matched.map((m) => m.canonical))].map((c) => ({ canonical: c }));
  }

  if (canon.length === 0) return [];

  const out = new Set<string>();
  const canonHoles = canon.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT alias FROM ai_aliases WHERE canonical IN (${canonHoles})`)
    .all(...canon.map((c) => c.canonical)) as Array<{ alias: string }>;
  for (const r of rows) out.add(r.alias);
  return [...out];
}

/* ── Бүтэцтэй нэр дэвшигч ─────────────────────────────────────────── */

/**
 * Асуултад ШУУД нэрлэсэн хүснэгт/мөр/заалт.
 *
 * ⚠️ ЭНЭ НЬ ХАМГИЙН ӨНДӨР ИТГЭЛТЭЙ ХӨЛ.  Хэрэглэгч эх сурвалжаа нэрлэсэн
 *    бол ойролцоо утгаар өөр мөр санал болгох нь ЗАВХРУУЛСАН хариу.
 */
/**
 * Асуултад НЭРЛЭСЭН баримтууд — кодын фолдолсон хэлбэр (`bnbd 11 03 21`,
 * `ub 12 01 01`) асуултын фолдод ҮГИЙН ХИЛЭЭР бүтнээрээ орсон бол.
 *
 * ⚠️ ДӨРӨВ ДЭХ БАРИМТ (БНбД 11-03-21, 2026-09-10) ирэхэд ЗААВАЛ болсон.
 *    Заалтын дугаар нь баримт ХООРОНД давхцдаг: 1.1, 5.2, 5.3 нь дөрвөн
 *    баримтад бүгдэд нь бий.  Бүтэцтэй хөл нь «clause_no = ?» гэж
 *    баримт ялгалгүй асууж байсан тул «УББ-11-201-00-ын 5.2-р заалт» гэсэн
 *    асуултад БНбД-ийн 5.2 (+ түүний 9 хүснэгтийн мөр) эхэлж, УББ-11-201-00-ын
 *    Recall@5 99.6% → 97.0% унасан (хэмжсэн).  Хэрэглэгч баримтаа нэрлэсэн
 *    бол өөр баримтын ижил дугаартай заалт нь ЗАВХРУУЛСАН хариу.
 *
 * ⚠️ `extractDocRef`-ийн `code` талбарт НАЙДДАГГҮЙ — тэр нь зөвхөн БНбД/БД/MNS
 *    угтварыг таньдаг, УББ-г танидаггүй; энд `ai_documents.code`-ыг ӨӨРИЙГ нь
 *    тулгадаг тул шинэ баримт бүр автоматаар орно.
 */
export function namedDocuments(db: DatabaseSync, q: NormQuery): string[] {
  if (q.folded.length === 0) return [];
  const hay = ` ${q.folded} `;
  const out: string[] = [];
  for (const d of db.prepare('SELECT doc_id, code FROM ai_documents').all() as Array<{ doc_id: string; code: string }>) {
    const f = foldText(d.code);
    // Богино код («БД») санамсаргүй таарахаас сэргийлж ≥ 6 тэмдэгт.
    if (f.length >= 6 && hay.includes(` ${f} `)) {
      out.push(d.doc_id);
      continue;
    }
    // ⚠️ Кодын ALIAS-аар ч таарна (СНиП II-97-76: албан код нь «СНиП II-97-76* /
    //    СНиП II-97-76 М-80» гэсэн давхар нэр — хэн ч бүтнээр нь бичихгүй;
    //    багцын `global_aliases` «СНиП II-97-76*», «SNIP II-97-76» өгдөг).
    const aliases = db
      .prepare('SELECT alias_fold FROM ai_aliases WHERE doc_id = ? AND canonical = ? AND length(alias_fold) >= 6')
      .all(d.doc_id, d.code) as Array<{ alias_fold: string }>;
    if (aliases.some((a) => hay.includes(` ${a.alias_fold} `))) out.push(d.doc_id);
  }
  return out;
}

/**
 * ХҮСЭЛТИЙН БАРИМТ — явцуу код = ХАТУУ шүүлт (2026-09-11, P0).
 *
 *   code=null              → каталогийн alias-аар нэрлэгдсэн баримтууд (хуучин зан төлөв)
 *   code≠null, олдсон     → ЗӨВХӨН тэр баримт(ууд)
 *   code≠null, олдоогүй   → `absent=true`: хайлт ОГТ ажиллахгүй, өөр баримтаас
 *                            хариулахгүй (`named_document_absent`)
 *
 * ⚠️ `namedDocuments` нь каталогт БАЙГАА кодыг л таньдаг байсан — байхгүй
 *    баримтыг нэрлэхэд шүүлт алга болж, BM25 өөр баримтын хэсгийг «verified»
 *    гэж буцаадаг байв (GOLD-B08: БД 21-101-12 → БНбД 21-04-05 T3 мөр 15).
 */
export interface RequestedDocument {
  code: string | null;
  docIds: string[];
  absent: boolean;
  /**
   * §9-ийн ЦОРЫН ГАНЦ үл хамаарах зүйл: нэрлэсэн код санд байхгүй ч санд байгаа
   * баримт түүнийг ИЛ (`predecessor` / `legacy_code` / `legal_status` хэсгийн
   * `relation: supersedes`) заасан бол тэр баримтаас хариулна — гэхдээ
   * харилцааг ИЛ буцаана, хариулт нь «яагаад өөр баримт» гэдгийг хэлнэ.
   */
  relation: 'exact' | 'superseded_by' | 'legacy_code_of' | null;
  relatedCode: string | null;
}

/** Санд байгаа баримт нэрлэсэн кодыг ил лавласан эсэх (предшественник / хуучин код). */
function relatedDocuments(db: DatabaseSync, wantFolded: string): { docId: string; code: string; relation: 'superseded_by' | 'legacy_code_of' }[] {
  const out: { docId: string; code: string; relation: 'superseded_by' | 'legacy_code_of' }[] = [];
  const parse = (v: string): Record<string, unknown> => {
    try {
      const o: unknown = JSON.parse(v);
      return typeof o === 'object' && o !== null ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  for (const d of db.prepare('SELECT doc_id, code, metadata_json FROM ai_documents').all() as Array<{ doc_id: string; code: string; metadata_json: string }>) {
    const m = parse(d.metadata_json);
    const pred = [m.predecessor, m.predecessor_code, m.supersedes, m.replaces].filter((x): x is string => typeof x === 'string');
    if (pred.some((c) => foldText(c) === wantFolded)) out.push({ docId: d.doc_id, code: d.code, relation: 'superseded_by' });
    const legacy = [m.legacy_code, m.former_code, m.old_code].filter((x): x is string => typeof x === 'string');
    if (legacy.some((c) => foldText(c) === wantFolded)) out.push({ docId: d.doc_id, code: d.code, relation: 'legacy_code_of' });
  }
  if (out.length === 0) {
    const rows = db
      .prepare("SELECT c.doc_id, d.code, c.metadata_json FROM ai_chunks c JOIN ai_documents d ON d.doc_id = c.doc_id WHERE c.kind = 'legal_status'")
      .all() as Array<{ doc_id: string; code: string; metadata_json: string }>;
    for (const r of rows) {
      const m = parse(r.metadata_json);
      const pred = typeof m.predecessor === 'string' ? foldText(m.predecessor) : null;
      if (pred !== null && pred === wantFolded && !out.some((o) => o.docId === r.doc_id)) {
        out.push({ docId: r.doc_id, code: r.code, relation: 'superseded_by' });
      }
    }
  }
  return out;
}

/** Alias нь КОД хэлбэртэй юу («21-101-12», «bd 21 101 12», «snip ii 97 76») — сэдвийн үг биш. */
function codeShaped(aliasFold: string): boolean {
  return /\d{2}[ -]\d{2,3}[ -]\d{2}/.test(aliasFold) || /ii[ -]\d{2}[ -]\d{2}/.test(aliasFold);
}

/**
 * ⚠️ ХАТУУ ШҮҮЛТ ЗӨВХӨН КОДООР.  `namedDocuments` нь баримтын alias-аар ч таардаг,
 *    гэвч багцууд СЭДВИЙН үгийг («гүйцэтгэлийн зураг» → БНбД 11-08-23) кодын
 *    канонтой alias болгон өгдөг — тэр таарц бүтэцтэй хөлийн ЗӨӨЛӨН дохио
 *    хэвээр, харин бүх хөлийг цоожлох эрхгүй (хэмжсэн: УББ 12-204-01 Q19
 *    latin 11-08-23 руу цоожлогдож унав).
 */
function codeNamedDocuments(db: DatabaseSync, q: NormQuery): string[] {
  const hay = ` ${q.folded} `;
  const out: string[] = [];
  for (const d of db.prepare('SELECT doc_id, code FROM ai_documents').all() as Array<{ doc_id: string; code: string }>) {
    const f = foldText(d.code);
    if (f.length >= 6 && hay.includes(` ${f} `)) {
      out.push(d.doc_id);
      continue;
    }
    const aliases = db
      .prepare('SELECT alias_fold FROM ai_aliases WHERE doc_id = ? AND canonical = ? AND length(alias_fold) >= 6')
      .all(d.doc_id, d.code) as Array<{ alias_fold: string }>;
    if (aliases.some((a) => codeShaped(a.alias_fold) && hay.includes(` ${a.alias_fold} `))) out.push(d.doc_id);
  }
  return out;
}

export function requestedDocument(db: DatabaseSync, q: NormQuery): RequestedDocument {
  const named = codeNamedDocuments(db, q);
  const code = q.docRef.code ?? null;
  if (code === null) return { code: null, docIds: named, absent: false, relation: named.length > 0 ? 'exact' : null, relatedCode: null };
  const want = foldText(code);
  const wantDigits = q.docRef.codeDigits ? foldText(q.docRef.codeDigits) : null;
  const ids = new Set<string>(named);
  for (const d of db.prepare('SELECT doc_id, code FROM ai_documents').all() as Array<{ doc_id: string; code: string }>) {
    const f = ` ${foldText(d.code)} `;
    if (want.length >= 6 && f.includes(` ${want} `)) ids.add(d.doc_id);
  }
  if (ids.size === 0) {
    const rows = db
      .prepare('SELECT DISTINCT doc_id FROM ai_aliases WHERE alias_fold = ? OR alias_fold = ?')
      .all(want, wantDigits ?? want) as Array<{ doc_id: string }>;
    for (const r of rows) ids.add(r.doc_id);
  }
  if (ids.size > 0) return { code, docIds: [...ids], absent: false, relation: 'exact', relatedCode: null };
  const related = relatedDocuments(db, want);
  if (related.length > 0) {
    return { code, docIds: related.map((r) => r.docId), absent: false, relation: related[0]!.relation, relatedCode: related[0]!.code };
  }
  return { code, docIds: [], absent: true, relation: null, relatedCode: null };
}

/**
 * Баримт нэрлэгдсэн үед ГАНЦААРАА зогсох «1.1» хэлбэрийн токен нь заалтын
 * дугаар.  «БНбД 11-03-21 3.9» гэж бичихэд «заалт» гэдэг үг байхгүй тул
 * `extractDocRef` олдоггүй; баримтгүй үед «1.5 м» гэсэн хэмжээг заалт гэж
 * андуурахгүйн тулд ЗӨВХӨН баримт нэрлэгдсэн үед, ЯГ НЭГ ийм токен байвал.
 */
function bareClauseToken(q: NormQuery, named: boolean): string | undefined {
  // ⚠️ Гүн нь хязгааргүй: БНбД 11-08-23-д «11.17.2.8» гэсэн ДӨРВӨН түвшний
  //    заалт бий — гурваар хязгаарлахад тэр баримтын бүтэцтэй хөл огт
  //    ажиллаагүй (хэмжсэн).
  const isClauseLike = (t: string): boolean => /^\d+(?:\.\d+)+$/.test(t);
  if (named) {
    const hits = q.tokens.filter(isClauseLike);
    return hits.length === 1 ? hits[0] : undefined;
  }
  /**
   * ⚠️ БАРИМТ НЭРЛЭЭГҮЙ Ч «1.6-ийн», «2.5-д» нь заалтын хаяг.  Токенчлогч
   *    зураас дээр тасалдаг тул залгавар нь ДАРААГИЙН токен болж үлддэг —
   *    «1.5 м» гэсэн хэмжээнд залгавар биш нэгж дагадаг тул андуурахгүй.
   *    Хэмжсэн (2026-09-10, 7 баримт): «2 жилийн туршлагатай хүн 1.6-ийн
   *    шаардлагыг хангах уу?» гэхэд УББ 12-01-01-ийн 1.6 FTS-д 29-рт унаж,
   *    нөхцөлийн хөл (эхний 25-ыг л дахин эрэмбэлдэг) түүнийг өргөж чадсангүй
   *    — алтан кейс G003/G008 унав.
   */
  const hits: string[] = [];
  q.tokens.forEach((t, i) => {
    if (isClauseLike(t) && DETACHED_SUFFIXES.has((q.tokens[i + 1] ?? '').toLowerCase())) hits.push(t);
  });
  return hits.length === 1 ? hits[0] : undefined;
}

export function structuredCandidates(db: DatabaseSync, q: NormQuery, limit = 5): Candidate[] {
  const named = namedDocuments(db, q);
  const { table, row, page } = q.docRef;
  /**
   * ЦЭГТЭЙ / ҮСЭГТЭЙ ДУГААРТАЙ ХҮСНЭГТ («7.1-р хүснэгт», «Д.1-р хүснэгт», «Хүснэгт 16.2.1»).
   * ⚠️ Баримт нэрлэсэн үед «7.1» нь `bareClauseToken`-д ЗААЛТ гэж уншигдаж «7.1-р хүснэгт»
   *    асуултад 7.1-р заалт гарч, хүснэгт нь FTS-ийн 6-рт үлдэж байв (хэмжсэн 2026-09-21,
   *    БНбД 20-04-17).  «-р хүснэгт» дагасан дугаар хэзээ ч заалт биш — хүснэгтийн хаяг
   *    заалтын хаягаас ТҮРҮҮЛНЭ; 20-04-17-ын хавсралтын хүснэгт «Д.1» үсэгтэй.
   */
  const dottedTable = /((?:[А-ЯЁ]\.\s?)?\d+(?:\.\d+)+|[А-ЯЁ]\.\s?\d+)\s*[-–]\s*(?:р\s+хүснэгт|r\s+khusnegt)|(?:хүснэгт|khusnegt|table)\s+((?:[А-ЯЁ]\.\s?)?\d+(?:\.\d+)+|[А-ЯЁ]\.\s?\d+)/iu.exec(q.raw);
  const dottedTableId = (dottedTable?.[1] ?? dottedTable?.[2])?.replace(/\s+/g, '');
  const bare = q.docRef.clause ?? bareClauseToken(q, named.length > 0);
  const clause = dottedTableId !== undefined && bare === dottedTableId ? undefined : bare;
  const where: string[] = [];
  const binds: Array<string | number> = [];

  if (table !== undefined && row !== undefined) {
    where.push('(table_no = ? AND row_no = ?)');
    binds.push(table, row);
  } else if (table !== undefined) {
    where.push('table_no = ?');
    binds.push(table);
  } else if (row !== undefined && named.length > 0 && /хавсралт|havsralt|appendix/iu.test(q.raw)) {
    // «Хавсралт, мөр 1» — хүснэгтгүй мөр (СНиП-ийн хавсралтын нягтралын 115 мөр).
    // Зөвхөн баримт нэрлэгдсэн БА «хавсралт» гэсэн үед: «албан жагсаалт, х.32,
    // мөр 4» гэсэн статусын асуулт хавсралтын 4-р мөр рүү очиж байв (хэмжсэн).
    where.push('(table_no IS NULL AND row_no = ?)');
    binds.push(row);
  }
  if (clause !== undefined) {
    where.push('clause_no = ?');
    binds.push(clause);
  }
  if (q.docRef.appendix !== undefined && named.length > 0 && where.length === 0) {
    /**
     * ⚠️ ХАВСРАЛТЫН ҮСЭГ — зөвхөн баримт нэрлэгдсэн үед (үсэг нь баримт хооронд
     *    давхцдаг).  Хаяг нь `section_path`-ийн эхэнд («Хавсралт В / …», «А
     *    хавсралт, А.1 хүснэгт / …», «А.1 хавсралт / …»).  Латин A ↔ кирилл А
     *    хоёулаа: 31-23-12-ын `appendix:A` латин, бусад нь кирилл (хэмжсэн).
     *
     * ⚠️ ХАЯГ БҮТНЭЭРЭЭ ТААРАХ ЁСТОЙ.  БНбД 11-03-21-д «Хавсралт B-10», «B-11»
     *    бий: `LIKE 'Хавсралт B%'` нь B-1…B-5-ыг эхэнд тавьж B-10-ыг эхний 5-аас
     *    ШАХАЖ гаргасан (хэмжсэн: 213-ын 5 тест унав).  SQLite LIKE нь «дараагийн
     *    тэмдэгт үсэг/тоо биш» гэж хэлж чадахгүй тул JS дээр шүүнэ.
     */
    const letter = q.docRef.appendix;
    const labels = [...new Set([letter, appendixLetterTwin(letter)])].flatMap((l) => [`Хавсралт ${l}`, `${l} хавсралт`]);
    // Шошго нь үсэг, тоо, цэг, зураас л агуулна — regex-ийн онцгой тэмдэгт нь зөвхөн «.».
    const exact = new RegExp(`^(?:${labels.map((l) => l.replace(/\./g, '\\.')).join('|')})(?![\\p{L}\\d])`, 'u');
    const rows = db
      .prepare(
        `SELECT chunk_id, section_path FROM ai_chunks
          WHERE doc_id IN (${named.map(() => '?').join(',')})
            AND (${labels.map(() => 'section_path LIKE ?').join(' OR ')})
          ORDER BY (kind = 'table_row'), chunk_id`,
      )
      .all(...named, ...labels.map((l) => `${l}%`)) as Array<{ chunk_id: string; section_path: string | null }>;
    return rows
      .filter((r) => r.section_path !== null && exact.test(r.section_path))
      .slice(0, limit)
      .map((r, i) => ({ chunkId: r.chunk_id, rank: i + 1, leg: 'structured' as const, rawScore: null }));
  }
  if (where.length === 0) {
    /**
     * ЦЭГТЭЙ ДУГААРТАЙ ХҮСНЭГТ («5.1-р хүснэгт», «Хүснэгт 16.2.1» — ai/norm-dataset багц,
     * 2026-09-16).  `table_no` нь INTEGER тул ийм хүснэгт тэнд орохгүй; тэдний хаяг нь
     * `section_path = 'хүснэгт <id>'` (build-pack.mjs).  FTS нь «5.1»-ийг «5» ба «1» гэж
     * тасалдаг тул 5.1 / 5.1.1 / 5.1.2 ялгагдахгүй байв (хэмжсэн).  Зөвхөн бүхэл хаяг.
     */
    if (dottedTableId !== undefined) {
      // ⚠️ SQLite LOWER() нь зөвхөн ASCII — «Д.1» кирилл үсэг хэвээр.  `build-pack.mjs` хаягийг
      //    «хүснэгт <id>» (үсэг нь ТОМ) гэж бичдэг тул id-г том үсгээр тулгана.
      where.push('section_path = ?');
      binds.push(`хүснэгт ${dottedTableId.toUpperCase()}`);
    }
  }
  if (where.length === 0 && page !== undefined) {
    where.push('page = ?');
    binds.push(page);
  }
  if (where.length === 0) return [];

  // ⚠️ Нэрлэсэн баримтад ХЯЗГААРЛАНА, эрэмбэлэхгүй.  Тэр баримтад ийм заалт
  //    байхгүй бол өөр баримтынхыг санал болгохгүй — FTS хөл үлдэнэ.
  const docFilter = named.length > 0 ? ` AND doc_id IN (${named.map(() => '?').join(',')})` : '';

  // ⚠️ ЗААЛТ ЭХЛЭЭД.  «СНиП II-97-76* 4.10 table1_g1520_54» гэхэд «table1» нь
  //    хүснэгт 1 гэж уншигдаж, хүснэгтийн 5 мөр LIMIT-ийг дүүргээд 4.10-р
  //    заалт огт орохгүй байв (хэмжсэн: 107 тест).  Заалтын дугаар нь
  //    хүснэгтийн дугаараас нарийн хаяг — яг таарсан заалт эхэнд.
  const rows = db
    .prepare(
      `SELECT chunk_id FROM ai_chunks
        WHERE (${where.join(' OR ')})${docFilter}
        ORDER BY (clause_no = ?) DESC, (table_no IS NOT NULL) DESC, (kind = 'table_row'), page, row_no
        LIMIT ?`,
    )
    .all(...binds, ...named, clause ?? '', limit) as Array<{ chunk_id: string }>;

  return rows.map((r, i) => ({ chunkId: r.chunk_id, rank: i + 1, leg: 'structured', rawScore: null }));
}

/* ── FTS5 / BM25 ──────────────────────────────────────────────────── */

/**
 * FTS5-ийн MATCH мөр угсарна.
 *
 * ⚠️ ХАШИЛТ ЗААВАЛ.  Хэрэглэгчийн бичсэн `AND`, `OR`, `NOT`, `*`, `-`,
 *    `"` нь FTS5-ийн ОПЕРАТОР — хашилтгүй бол «gal OR untraah» гэсэн
 *    асуулт синтаксийн алдаа өгч ХАЙЛТ БҮХЭЛДЭЭ унана.  Дотоод хашилтыг
 *    хоёрлож escape хийнэ.
 *
 * ⚠️ УГТВАРЫН ТААРАЛТ (`*`) нь МОНГОЛД ЗААВАЛ.  «агуулах» нь эх бичигт
 *    «агуулахын», «агуулахад» гэж залгавартай гардаг.  Гэхдээ ЗӨВХӨН
 *    4+ тэмдэгттэй үгэнд: «300*» нь 3000, 30000-ыг татаж босгыг
 *    утгагүй болгоно.
 */
export function buildMatchExpr(terms: readonly string[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const raw of terms) {
    const t = raw.trim().replace(/"/g, '""');
    if (t.length === 0) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const isNumber = /^[\d.,]+$/.test(t);
    parts.push(!isNumber && t.length >= 4 ? `"${t}"*` : `"${t}"`);
  }
  return parts.join(' OR ');
}

/**
 * ЗУРААСААР ТАСАРСАН НӨХЦӨЛИЙН ЗАЛГАВАР — «29%-аас», «5.2-р», «11-03-21-ийн».
 *
 * ⚠️ Токенчлогч зураас дээр таслах тул «-аас» нь бие даасан токен болж
 *    FTS-д ордог.  Хэмжсэн (2026-09-10, БНбД 11-03-21 GOLD-4.8-29): «29%-аас
 *    дээж авбал» гэсэн асуулт 4.8-ын оронд 5.6-г олж байв — цорын ганц
 *    ялгуур нь 5.6-ийн бичвэрт «50%-аас», 4.8-д «30%-иас» байсан явдал:
 *    залгаврын ЗӨВ БИЧЛЭГИЙН хувилбар нь эх сурвалжийн утгыг шийдэж
 *    байсан.  Эдгээр нь монголд бие даасан үг болж ХЭЗЭЭ Ч тохиолдохгүй
 *    тул хасахад юу ч алдагдахгүй.
 */
const DETACHED_SUFFIXES: ReadonlySet<string> = new Set([
  'аас', 'ээс', 'оос', 'өөс', 'иас', 'иэс',
  'ийн', 'ын', 'ийг', 'ыг', 'ий', 'ы',
  'аар', 'ээр', 'оор', 'өөр', 'иар', 'иэр',
  'тай', 'тэй', 'той', 'төй',
  'руу', 'рүү', 'д', 'т', 'г', 'р',
  'aas', 'ees', 'oos', 'iin', 'yn', 'iig', 'yg', 'aar', 'eer', 'oor', 'tai', 'tei', 'toi', 'ruu',
]);

export function ftsCandidates(
  db: DatabaseSync,
  q: NormQuery,
  limit = 40,
  /** Нэрлэсэн баримтад ХЯЗГААРЛАНА (хатуу шүүлт) — хоосон бол бүх баримт. */
  docIds: readonly string[] = [],
  /** Хайлтаас ХАСАХ токен — кодын цифр, нэгжтэй утга (`excludedSearchTokens`). */
  exclude: ReadonlySet<string> = new Set(),
): Candidate[] {
  const base = q.tokens.filter((t) => !DETACHED_SUFFIXES.has(t.toLowerCase()) && !exclude.has(t) && !isInstructionWord(t));
  const terms = [
    ...base,
    // Монгол үгийн язгуурын хувилбар («даамлыг» → «даамл», «даам»; «зогсоож» → «зогсоо») — эгшиг
    //    гээгдэл, тохиолын залгавраас болж заалт олдохгүй байсныг засна (`stem.ts`).  Зогсоох үгэнд
    //    («chadah» → «chada» → «чадал») гаргахгүй — дуу чимээ.
    // Англи асуултад монгол залгаврын дүрэм хэрэглэхгүй («conditions» → «conditio»).
    ...(q.script === 'en' ? [] : base.filter((t) => !isStopword(t)).flatMap((t) => stemVariants(t))),
    // ⚠️ ЛАТИН МОНГОЛ АСУУЛТЫН ФОЛД ХЭЛБЭР (2026-09-23).  Олон багц (БНбД 31-2x, …) `text_latin`-гүй бөгөөд
    //    `search_text`-д зөвхөн фолдолсон хэлбэр («Тоглоомын» → `toglomin`, «цаг» → `cag`) бий.  Латин асуултын
    //    токен («togloomiin», «tsag») фолдгүйгээр тэдгээрт ХЭЗЭЭ Ч таардаггүй байв — ижил асуулт кириллээр 6.1.11-ийг
    //    4-т олж, латинаар огт олохгүй байсан (хэмжсэн, эзний HL10).
    ...(q.script === 'mn-Latn' || q.script === 'mixed'
      ? base.filter((t) => /[a-z]/i.test(t) && !isStopword(t)).map((t) => foldText(t)).filter((f) => f.length >= 3)
      : []),
    ...expandAliases(db, q, { maxCanonicalsPerAlias: 4 }),
  ];
  const expr = buildMatchExpr(terms);
  if (expr.length === 0) return [];

  let rows: Array<{ chunk_id: string; score: number }>;
  try {
    rows =
      docIds.length === 0
        ? (db
            .prepare(
              `SELECT f.chunk_id AS chunk_id, bm25(ai_chunks_fts) AS score
                 FROM ai_chunks_fts f
                WHERE ai_chunks_fts MATCH ?
                ORDER BY score
                LIMIT ?`,
            )
            .all(expr, limit) as Array<{ chunk_id: string; score: number }>)
        : (db
            .prepare(
              `SELECT f.chunk_id AS chunk_id, bm25(ai_chunks_fts) AS score
                 FROM ai_chunks_fts f
                 JOIN ai_chunks c ON c.chunk_id = f.chunk_id
                WHERE ai_chunks_fts MATCH ? AND c.doc_id IN (${docIds.map(() => '?').join(',')})
                ORDER BY score
                LIMIT ?`,
            )
            .all(expr, ...docIds, limit) as Array<{ chunk_id: string; score: number }>);
  } catch (err) {
    // ⚠️ Синтаксийн алдаа нь ХАЙЛТЫГ УНАГААХГҮЙ.  Хэрэглэгчийн асуулт нь
    //    урьдчилан таамаглах аргагүй — хоосон буцаах нь pipeline-ыг
    //    «нотолгоо олдсонгүй» руу зөв аваачна.
    // ⚠️ ХАРИН дэд бүтцийн алдаа (хүснэгт алга — `ai:ingest:norm --all` явж байна,
    //    түгжигдсэн, гэмтсэн) нь «олдсонгүй» БИШ — дээш шидэж runtime 503 өгнө (P0-14).
    if (isKnowledgeInfrastructureError(err)) throw new KnowledgeUnavailableError(`FTS хайлт боломжгүй: ${err instanceof Error ? err.message : String(err)}`, err);
    return [];
  }

  return rows.map((r, i) => ({ chunkId: r.chunk_id, rank: i + 1, leg: 'fts', rawScore: r.score }));
}

/**
 * БҮЛГИЙН ГАРЧГИЙН ХӨЛ (2026-09-23).
 *
 * ⚠️ ЯАГААД.  Олон багцад жагсаалтын заалт СЭДВЭЭ зөвхөн бүлгийн гарчгаас авдаг: УББ 12-01-01-ийн
 *    2-р бүлэг «Захиалагчийн үүрэг»-ийн 24 заалтын аль нь ч «захиалагч», «үүрэг» гэсэн үггүй («Газрын
 *    зөвшөөрөл … бүрдүүлж …»), бас тэр багцын `search_text`-д гарчиг ОРООГҮЙ.  Тиймээс «би захиалагч,
 *    миний гол үүрэг юу вэ» гэсэн асуулт 2-р бүлгийг FTS-ийн эхний 40-д ч олдоггүй байв (эзний HL03,
 *    2026-09-23).  Энд асуултын агуулгын үгсийн ≥2 нь (язгуурын хувилбартай) `section_path`-д ҮГИЙН
 *    ЭХНЭЭС таарсан бүлгийн заалтуудыг эх эрэмбээр нь нэр дэвшүүлнэ.
 * ⚠️ ХАМААРЛЫН ХААЛГААС ЧӨЛӨӨТЭЙ (`pipeline.ts`) — гарчгийн ≥2 ТУСГАЙ үгийн таарц нь өөрөө хамаарлын нотолгоо;
 *    корпусын >15%-д байдаг үг тоологдохгүй.  Ил хаяг (заалт/хүснэгт нэрлэсэн) асуултад ажиллахгүй.  Хэт том бүлэг
 *    (>40 хэсэг) ерөнхий гэж үзэж алгасна.
 * ⚠️ ЗӨВХӨН ДУУДАГЧИЙН ӨГСӨН БАРИМТ(УУД)-Д (`docIds`): pipeline нь нэрлэсэн баримт эсвэл FTS-ийн ЭХНИЙ
 *    хэсгийн баримтыг өгнө — бүлгийн хөл нь FTS-ийн сонгосон баримт ДОТОРХ олдоогүй бүлгийг нөхнө, өөр
 *    баримтыг дэвшүүлэхгүй (хэмжсэн: бүх корпусаар хайхад даамлын «үүрэг» бүлэг захиалагчийн асуултад гарсан).
 * ⚠️ `MGLAI_SECTION_LEG=0` — зөвхөн хэмжилтийн харьцуулалтад унтраана.
 */
const SECTION_MAX_CHUNKS = 40;
const SECTION_TAKE = 2;
const SECTION_PER = 15;
/** Асуултын заалтын төрөл → тэр төрлийг заадаг ГАРЧГИЙН үг (фолдолсон угтвар). */
const KIND_HEADING: Readonly<Record<string, readonly string[]>> = {
  obligation: ['ureg', 'urg'],
  right: ['erh'],
  responsibility: ['hariucl'],
  requirement: ['shard', 'shalgur', 'tavigdah'],
};

export function sectionCandidates(
  db: DatabaseSync,
  q: NormQuery,
  docIds: readonly string[] = [],
  exclude: ReadonlySet<string> = new Set(),
  /** Асуултын заалтын төрөл (`questionKind.ts`) — ХООСОН бол хөл ажиллахгүй. */
  kinds: ReadonlySet<string> = new Set(),
): Candidate[] {
  if (process.env.MGLAI_SECTION_LEG === '0' || docIds.length === 0 || kinds.size === 0) return [];
  // ⚠️ ЗӨВХӨН «X-ийн үүрэг / эрх / хариуцлага / шалгуур» гэсэн асуултад, гарчиг нь тэр төрлийн үгийг агуулсан
  //    бүлэгт.  Бүх асуултад ажиллуулахад гарчиг галын хүснэгт, «үүрэг даалгавар»-т санамсаргүй таарч Recall@5
  //    95.4 → 95.1%, дүрмийн таарц 88.3 → 87.6% унасан (хэмжсэн v4).
  const kindWords = [...kinds].flatMap((k) => KIND_HEADING[k] ?? []);
  if (kindWords.length === 0) return [];
  if (q.docRef.clause !== undefined || q.docRef.table !== undefined) return [];
  const groups: string[][] = [];
  for (const t of q.tokens) {
    if (t.length < 4 || /^\d/.test(t) || exclude.has(t) || isStopword(t) || isInstructionWord(t)) continue;
    const f = foldText(t);
    if (f.length < 4) continue;
    const alts = q.script === 'en' ? [] : stemVariants(t).map((v) => foldText(v)).filter((v) => v.length >= 4);
    groups.push([f.slice(0, Math.max(4, f.length - 2)), ...alts]);
  }
  if (groups.length < 2) return [];
  // ⚠️ Корпуст ХЭТ ТҮГЭЭМЭЛ үг («барилга» 16%) гарчгийн таарцад ТООЦОГДОХГҮЙ — хамаарлын хаалгын `common`-той ижил босго.
  const total = (db.prepare('SELECT COUNT(*) AS n FROM ai_chunks').get() as { n: number }).n;
  const specific = groups.filter((g) => {
    try {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM ai_chunks_fts WHERE ai_chunks_fts MATCH ?').get(`"${g[0]!.replace(/"/g, '""')}"*`) as { n: number }).n;
      return total === 0 || n / total <= 0.15;
    } catch {
      return true;
    }
  });
  if (specific.length < 2) return [];
  const where = docIds.length > 0 ? ` AND doc_id IN (${docIds.map(() => '?').join(',')})` : '';
  const rows = db
    .prepare(
      `SELECT doc_id, section_path, COUNT(*) AS n FROM ai_chunks
        WHERE section_path IS NOT NULL AND section_path <> ''${where}
        GROUP BY doc_id, section_path`,
    )
    .all(...docIds) as Array<{ doc_id: string; section_path: string; n: number }>;
  const scored: Array<{ doc_id: string; section_path: string; n: number; m: number }> = [];
  for (const r of rows) {
    if (r.n > SECTION_MAX_CHUNKS) continue;
    if (!foldText(r.section_path).split(' ').some((w) => kindWords.some((k) => w.startsWith(k)))) continue;
    // ⚠️ Гарчгийн НЭГ ҮГ нэг л удаа тоологдоно: «барилга» ба «барих» хоёулаа «барилгын»-д таарч даамлын
    //    «үүрэг» бүлэг захиалагчийн «үүрэг» бүлгийг давсан байв (хэмжсэн, HL03).
    const words = foldText(r.section_path).split(' ').filter((w) => w.length > 0);
    const used = new Set<number>();
    let m = 0;
    for (const g of specific) {
      const idx = words.findIndex((w, i) => !used.has(i) && g.some((p) => w.startsWith(p)));
      if (idx >= 0) {
        used.add(idx);
        m += 1;
      }
    }
    if (m >= 2) scored.push({ ...r, m });
  }
  if (scored.length === 0) return [];
  scored.sort((a, b) => b.m - a.m || a.n - b.n || (a.section_path < b.section_path ? -1 : 1));
  const out: Candidate[] = [];
  for (const s of scored.slice(0, SECTION_TAKE)) {
    const ids = db
      .prepare('SELECT chunk_id FROM ai_chunks WHERE doc_id = ? AND section_path = ? ORDER BY rowid LIMIT ?')
      .all(s.doc_id, s.section_path, SECTION_PER) as Array<{ chunk_id: string }>;
    for (const r of ids) out.push({ chunkId: r.chunk_id, rank: out.length + 1, leg: 'section', rawScore: s.m });
  }
  return out;
}

/**
 * ⚠️ `retrieval_weight` нь ЭРЭМБЭД ЛАВ нөлөөлнө, ГЭВЧ RRF-ийн ДАРАА.
 *    Заалт (weight 1.2) нь хүснэгтийн мөрөөс (1.0) илүү ерөнхий утгатай
 *    тул тэнцүү үед дээгүүр гарна.  Урьдчилж үржүүлбэл BM25-ийн эрэмбийг
 *    гуйвуулж, яг таарсан хүснэгтийн мөр доошилно.
 */
export function chunkWeights(db: DatabaseSync, chunkIds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (chunkIds.length === 0) return out;
  const holes = chunkIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT chunk_id, retrieval_weight FROM ai_chunks WHERE chunk_id IN (${holes})`)
    .all(...chunkIds) as Array<{ chunk_id: string; retrieval_weight: number }>;
  for (const r of rows) out.set(r.chunk_id, r.retrieval_weight);
  return out;
}

/**
 * Хайлт ба хамаарлын ХААЛГАНААС хасах токен (2026-09-11):
 *   (a) нэрлэсэн кодын цифр («21», «101», «12») — байхгүй баримт нэрлэхэд эдгээр
 *       нь хамаарахгүй хэсгийг ИДЭВХТЭЙ дэмжиж байв («12» олон хэсэгт бий);
 *   (b) НЭГЖТЭЙ утга («200 кПа», «10 м³», «Q=5000 МДж») — эдгээр нь СЭДЭВ биш
 *       ОРОЛТ; «200» нь «200 МВА», «1:200» хэсгийг олж GOLD-B08/A08-ыг өөр
 *       баримт руу аваачиж байв.  Утга нь дүрмийн үнэлгээнд `entities`-ээр
 *       хэвээр орно — зөвхөн хайлтын түлхүүр үг болохоо болино.
 */
export function excludedSearchTokens(q: NormQuery): Set<string> {
  const out = new Set<string>();
  // ⚠️ Кодын цифрийг ХАСАХГҮЙ: баримт байхгүй бол хайлт огт ажиллахгүй (early
  //    return), байгаа бол цоож дотор тэр цифр нь «хэзээнээс мөрдөгдсөн» гэх мэт
  //    БАРИМТЫН ТУХАЙ асуултын зөв дохио (хэмжсэн: УББ 12-204-01 Q34 унаж байв).
  // ⚠️ ЗӨВХӨН ТООЦООЛУУРЫН ОРОЛТЫН нэгж (°C, кПа, МДж, МДж/м², м³).  Талбай (м²),
  //    урт (м), хувь зэрэг нь бусад баримтад ЛАВЛАХ ТҮЛХҮҮР («3 м гүн», «40 хувь»)
  //    — тэднийг хасахад БНбД 11-03-21 R@5 93.4→92, УББ 12-204-01 81.9→78.1 унасан
  //    (хэмжсэн 2026-09-11), тиймээс хасахгүй.
  const unit =
    /(?<![\p{L}\d])(\d+(?:[.,]\d+)?)\s*(?:°\s*[cс]|℃|градус|кпа|kpa|мдж\s*\/\s*м[²2]|mj\s*\/\s*m[²2]|мдж|mj|м[³3]|m[³3]|куб\.?\s*м)(?![\p{L}])/giu;
  for (const m of q.raw.matchAll(unit)) out.add(m[1]!.toLowerCase().replace(',', '.'));
  const assigned = /(?<![\p{L}\d])[A-Za-zΔА-Яа-я]{1,3}\s*=\s*(\d+(?:[.,]\d+)?)/gu;
  for (const m of q.raw.matchAll(assigned)) out.add(m[1]!.toLowerCase().replace(',', '.'));
  return out;
}
