/**
 * MGL AI · СЕРВЕР ТАЛЫН ХАЙЛТ (§17-ийн лексик хагас).
 *
 * ⚠️ ЭНЭ НЬ БҮТЭН RAG БИШ, ЗОРИУД.  Вектор хайлт нь ажилтны PC дээрх
 *    локал индекст амьдарна (`ai/retrieval/`) — эмбеддинг нь загвараас
 *    хамаардаг, гигабайт эзэлдэг, D1-д хамаарахгүй.  Энэ файл нь
 *    ЛЕКСИК тал: түлхүүр үгээр `ai_knowledge_chunks`-аас олж, ЭРХЭЭР
 *    шүүж, эшлэлийн талбартай нь буцаана.  Гибрид нь хоёуланг нь
 *    нэгтгэнэ (Phase 5).
 *
 * ⚠️ D1 нь том TEXT багана дээр `LIKE '%...%'`-ыг ТАТГАЛЗДАГ (хэмжсэн,
 *    CLAUDE.md-ийн санамж).  Тиймээс `instr()` ашиглана.
 *
 * ⚠️ ШҮҮЛТ НЬ ХОЁР ДАВХАР.  SQL нь ойролцоогоор хязгаарлана (гүйцэтгэл),
 *    `filterEvidence` нь ЭЦСИЙН шийдвэр гаргана (зөв).  SQL-ийн шүүлтэд
 *    ГАНЦААР найдах нь аюултай: JOIN нэмэхэд шүүлт тайрагдахыг хэн ч
 *    анзаарахгүй.  Цэвэр функц нь тестээр хамгаалагдсан.
 */
import type { Env } from '../../types';
import { foldText } from '../textFold';
import type { Evidence, Classification, VisibilityScope } from './visibility';
import type { UserRole } from '../../types';

/** Монгол/латин холимог асуултыг хайлтын үг болгоно. */
export function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .map((t) => t.trim())
    // 2 тэмдэгтээс богино үг нь дуу чимээ (Монголд «нь», «ба»).
    .filter((t) => t.length >= 3)
    .slice(0, 8);
}

function parseRoles(raw: unknown): UserRole[] {
  if (typeof raw !== 'string') return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((r) => typeof r === 'string') as UserRole[]) : [];
  } catch {
    // ⚠️ Эвдэрсэн JSON нь «хязгаарлалтгүй» гэсэн утга ОЛГОХГҮЙ.  Хоосон
    //    массив нь `visibility.ts`-д «role-ээр хязгаарлаагүй» гэсэн утгатай
    //    тул энд ХАМГИЙН ХАТУУ сонголт нь мөрийг огт буцаахгүй байх —
    //    гэвч тэр нь чимээгүй алдагдал болно.  Дунд зам: хоосон буцааж,
    //    ангилал/хамрах хүрээний шүүлтэд найдана (тэд хоёулаа NOT NULL).
    return [];
  }
}

export interface ChunkRow {
  chunk_uid: string;
  doc_uid: string;
  title: string | null;
  heading: string | null;
  section: string | null;
  page_no: number | null;
  clause_uid: string | null;
  text: string;
  classification: string;
  visibility_scope: string;
  allowed_roles_json: string;
  project_id: number | null;
  org_id: number | null;
}

/** ⚠️ ЦЭВЭР — мөрийг нотолгоо болгоно, оноог үг тааралтаар өгнө. */
export function rowToEvidence(row: ChunkRow, tokens: readonly string[]): Evidence {
  const hay = `${row.title ?? ''} ${row.heading ?? ''} ${row.text}`.toLowerCase();
  let hits = 0;
  for (const t of tokens) if (hay.includes(t)) hits += 1;

  return {
    id: row.chunk_uid,
    kind: row.clause_uid ? 'clause' : 'chunk',
    title: row.heading?.trim() || row.title?.trim() || row.doc_uid,
    text: row.text,
    classification: row.classification as Classification,
    visibilityScope: row.visibility_scope as VisibilityScope,
    allowedRoles: parseRoles(row.allowed_roles_json),
    projectId: row.project_id,
    orgId: row.org_id,
    documentUid: row.doc_uid,
    clauseUid: row.clause_uid,
    page: row.page_no,
    section: row.section,
    // AND-ээр жигнэсэн оноо: бүх үг таарсан хэсэг нь дээгүүр.
    score: tokens.length === 0 ? 0 : hits / tokens.length,
  };
}

/**
 * Хайлтын пробуудыг сонгоно — ХАМГИЙН УРТ гурав.
 *
 * ⚠️ ЦЭВЭР бөгөөд EXPORT хийгдсэн нь ЗОРИУД: `lexicalSearch` нь D1
 *    шаарддаг тул тестлэхэд хүнд, харин пробын сонголт ба фолдлолт нь
 *    2026-09-08-нд ХОЁР УДАА алдаатай байсан хэсэг — түүнийг нэгжийн
 *    тестээр хаана.
 */
export function buildProbes(tokens: readonly string[]): string[] {
  return [...tokens].sort((a, b) => b.length - a.length).slice(0, 3);
}

/**
 * Проб бүрийн (фолдлогдсон, түүхий) хос — SQL-ийн bind дараалал.
 *
 * ⚠️ Энэ функцийн гаралтын ДАРААЛАЛ нь `(instr(text_folded, ?), instr(text, ?))`
 *    гэсэн SQL-ийн дараалалтай ЯГ таарах ёстой.
 */
export function probeBinds(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of buildProbes(tokens)) out.push(foldText(p), p);
  return out;
}

/**
 * Лексик хайлт.  ⚠️ ШҮҮЛТГҮЙ буцаана — дуудагч `filterEvidence`-ийг
 * ЗААВАЛ дуудна.  Тэр гэрээг `routes/mglAi.ts` барина.
 */
export async function lexicalSearch(
  env: Env,
  query: string,
  opts: { limit?: number; sourceKinds?: readonly string[] } = {},
): Promise<Evidence[]> {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const limit = Math.max(1, Math.min(50, opts.limit ?? 24));

  // ⚠️ `instr()` — D1 нь том TEXT дээр LIKE-ыг татгалздаг.  Хамгийн урт
  //    гурван үгээр л шүүнэ: илүү үг нэмэх нь query-г удаашруулж, OR нь
  //    сонголтыг сайжруулахгүй.
  const probes = buildProbes(tokens);

  // ⚠️⚠️ ХОЁР ЖИНХЭНЭ АЛДААНЫ ЗАСВАР (хэмжсэн 2026-09-08).
  //
  //  1. `text_folded` нь `foldText`-ийн гаралт — тэр нь кириллийг ЛАТИН
  //     галиг болгодог («Эвакуацын» → «evakuacin»).  Асуултын үгийг
  //     фолдлохгүйгээр тулгах нь ХЭЗЭЭ Ч таарахгүй: индекс бүхэлдээ
  //     үхмэл байсан.
  //
  //  2. SQLite-ийн `LOWER()` нь ЗӨВХӨН ASCII дээр ажилладаг —
  //     `LOWER('Эвакуацын')` нь «Эвакуацын» хэвээр буцаана.  Тиймээс
  //     `instr(LOWER(text), 'эвакуацын')` нь өгүүлбэрийн ЭХЭНД байгаа
  //     үгийг ОЛОХГҮЙ.  Монгол нормын заалт нь яг гол нэр томьёогоороо
  //     эхэлдэг тул энэ нь заалт бүрийг олдохгүй болгож байв.
  //
  //  Шийдэл: фолдлогдсон проб → фолдлогдсон багана (том/жижиг ба галигаас
  //  ХАМААРАЛГҮЙ), түүхий проб → түүхий багана (яг таарах хэлбэрт).
  const where = probes.map(() => '(instr(c.text_folded, ?) > 0 OR instr(c.text, ?) > 0)');

  const kindFilter =
    opts.sourceKinds && opts.sourceKinds.length > 0
      ? ` AND d.source_kind IN (${opts.sourceKinds.map(() => '?').join(',')})`
      : '';

  const sql = `
    SELECT c.chunk_uid, c.doc_uid, d.title, c.heading, c.section, c.page_no, c.clause_uid,
           c.text, c.classification, c.visibility_scope, c.allowed_roles_json,
           c.project_id, c.org_id
      FROM ai_knowledge_chunks c
      JOIN ai_knowledge_documents d ON d.doc_uid = c.doc_uid
     WHERE d.ingest_state = 'indexed'
       AND (${where.join(' OR ')})${kindFilter}
     LIMIT ?`;

  // ⚠️ ДАРААЛАЛ ЧУХАЛ: эхнийх нь ФОЛДЛОГДСОН багананд, хоёр дахь нь ТҮҮХИЙ
  //    багананд очно.  `probeBinds` тэр дарааллыг эзэмшинэ.
  const binds: (string | number)[] = [...probeBinds(tokens)];
  if (opts.sourceKinds) for (const k of opts.sourceKinds) binds.push(k);
  binds.push(limit);

  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<ChunkRow>();

  return (results ?? []).map((r) => rowToEvidence(r, tokens)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * Дүрмийн заалтын БАТАЛГААЖИЛТЫН төлвийг авчирна (0221).
 *
 * ⚠️ `verification_state` нь итгэлийн төлөвийг ХАВЧИНА — заалтгүй эшлэл
 *    нь ХЭЗЭЭ Ч «баталгаажсан» болохгүй (`confidence.ts`).
 */
export async function clauseVerificationStates(
  env: Env,
  clauseUids: readonly string[],
): Promise<string[]> {
  const uids = [...new Set(clauseUids.filter((u) => typeof u === 'string' && u.length > 0))];
  if (uids.length === 0) return [];
  const holes = uids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT verification_state FROM rules
      WHERE clause_uid IN (${holes}) AND status = 'published'`,
  )
    .bind(...uids)
    .all<{ verification_state: string }>();
  return (results ?? []).map((r) => r.verification_state);
}
