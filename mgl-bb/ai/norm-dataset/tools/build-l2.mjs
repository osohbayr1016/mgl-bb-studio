#!/usr/bin/env node
/**
 * MGL AI · norm-dataset · L2 CLAUSE UNDERSTANDING BUILDER (2026-09-18)
 *
 *   node ai/norm-dataset/tools/build-l2.mjs norm-dataset/documents/BNbD_31-17-10 [--candidates l2/candidates.jsonl] [--check]
 *
 * parsed/{clauses,sections,definitions,references,tables,appendices}.jsonl  →  l2/clause_explanations.jsonl
 *                                                                              l2/document_explanation.json
 *                                                                              l2/section_explanations.jsonl
 *                                                                              l2/stats.json
 *
 * ⚠️ L2 = ОЙЛГОХ/ТАЙЛБАРЛАХ, тооцоо БИШ.  Бичлэг бүр `execution.computable = false`.  Тоо нь эх бичвэрт
 *    БАЙГАА ЯГ хэлбэрээрээ л (`numeric_literals`) — ангилахгүй, интерполяцгүй, pass/fail-гүй.
 *
 * ⚠️ ЭХ БИЧВЭР ХӨДЛӨШГҮЙ.  `source_text` = parsed/clauses.jsonl-ийн `text` ЯГ (sha256-тай); үүсгэсэн тайлбар
 *    (`semantic_frame`, `plain_mn`) ТУСДАА талбарт, канон текстийг хэзээ ч дарахгүй.
 *
 * ⚠️ ЭХ СУРВАЛЖААР БАТЛАГДСАНЫГ Л.  Семантик хүрээ нь заалтын ӨӨРИЙН ӨГҮҮЛБЭРҮҮДЭЭС детерминист тэмдэг
 *    үгээр (ёстой/хориглоно/зөвшөөрнө/нөхцөлд/-аас бусад …) ялгагдана — өгүүлбэр ҮГ ҮСГЭЭРЭЭ ЭХЭЭС.
 *    Хууль тогтоогчийн санаа, инженерийн үндэслэл, аюулгүй байдлын үр дагавар, эхэд байхгүй тоо/босго/хамрах
 *    хүрээ/онцгой нөхцөл ЗОХИОГДОХГҮЙ; батлагдаагүй талбар = [] / null.
 *
 * `plain_mn` (өгөгдмөл) = детерминист «digest»: хүрээний өгүүлбэрүүдийг шошготой дараалалд оруулсан энгийн
 *    тайлбар — эхтэй мөр бүрээрээ холбогдоно.  `--llm <runtime>` өгвөл локал Qwen-ээр 2–3 өгүүлбэрийн энгийн
 *    найруулга ОРОЛДОНО, гэвч validator (тоо ⊆ эх, код/заалт ⊆ эх, урт) унавал digest хэвээр; аль нь ч
 *    `verification.explanation = 'AUTO_DRAFT'` — HUMAN_VERIFIED гэж ЭНЭ хэрэгсэл ХЭЗЭЭ Ч бичихгүй.
 *
 * Эх бичвэрийн хувилбар/хүчинтэй эсэх нь ОЙЛГОЛТООС ТУСДАА: `currentness` нь metadata.json-оос дамжина, эндээс
 *    төлөв ХЭЗЭЭ Ч дээшлэхгүй.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyExplanation } from './l2-semantic.mjs';
import { linkTerms } from './l2-terms.mjs';
import { codeKey } from './codeKey.mjs';

const argv = process.argv.slice(2);
const dir = resolve(argv.find((a) => !a.startsWith('--')) ?? '');
const check = argv.includes('--check');
// L2.1 (2026-09-18): нэр дэвшигч тайлбар (gen-l2-candidates.mjs, MODEL_DRAFT) → СЕМАНТИК ШАЛГАГЧ (l2-semantic.mjs) → PASS л
//    `plain_mn_candidate`; FAIL → детерминист fallback.  Загвар энд ДУУДАГДАХГҮЙ — файлаас л (давтагдах бүтээлт).
const candIdx = argv.indexOf('--candidates');
const candidatesPath = candIdx >= 0 ? resolve(dir, argv[candIdx + 1] ?? 'l2/candidates.jsonl') : (existsSync(join(dir, 'l2', 'candidates.jsonl')) ? join(dir, 'l2', 'candidates.jsonl') : null);
if (!dir || !existsSync(join(dir, 'parsed', 'clauses.jsonl'))) {
  process.stderr.write('Хэрэглээ: build-l2.mjs <documents/<Doc>> [--llm <runtime>] [--llm-limit=N] [--check]\n');
  process.exit(1);
}

const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const meta = readJson(join(dir, 'metadata.json'));
const source = readJson(join(dir, 'source', 'SOURCE.json'));
const clauses = readJsonl(join(dir, 'parsed', 'clauses.jsonl'));
const sections = readJsonl(join(dir, 'parsed', 'sections.jsonl'));
const definitions = readJsonl(join(dir, 'parsed', 'definitions.jsonl'));
const references = readJsonl(join(dir, 'parsed', 'references.jsonl'));
const tables = readJsonl(join(dir, 'parsed', 'tables.jsonl'));
const appendices = readJsonl(join(dir, 'parsed', 'appendices.jsonl'));
const code = meta.canonical_code;
/* ── L2 (20-04-17, 2026-09-23): нэмэлт оролтууд — байвал л; 31-17-10 зэрэг баримтад байхгүй бол хоосон ─────────── */
// Геометрээр задалсан хүснэгтийн мөр (tools/structure_tables.py) — tables.jsonl ХЭВЭЭР, энэ нь дээр нь давхарга.
const tablesStructured = new Map(readJsonl(join(dir, 'parsed', 'tables_structured.jsonl')).map((t) => [t.table_id, t]));
const formulas = readJsonl(join(dir, 'parsed', 'formulas.jsonl'));
// Албан ТАЙЛБАР (COMMENTARY_SOURCE, норм БИШ) — tools/parse_commentary.py.  Заалтын текстэд ХЭЗЭЭ Ч нийлүүлэхгүй.
const commentaryMeta = existsSync(join(dir, 'commentary', 'metadata.json')) ? readJson(join(dir, 'commentary', 'metadata.json')) : null;
const commentaryUnits = commentaryMeta ? readJsonl(join(dir, 'commentary', 'parsed', 'commentary.jsonl')) : [];
// L0 бүртгэл — өөр нормын ишлэлийн ОДООГИЙН төлөв/залгамж (хуучин код → одоогийн код, эх ишлэл ХЭВЭЭР).
const REG_DIR = join(dir, '..', '..', 'registry');
const registryRows = readJsonl(join(REG_DIR, 'norms.jsonl'));
const registryRefs = readJsonl(join(REG_DIR, 'references.jsonl'));
const regByKey = new Map();
for (const r of registryRows) regByKey.set(r.code_key ?? codeKey(r.canonical_code), r);
for (const r of registryRows) for (const a of r.aliases ?? []) if (/\d/.test(a) && !regByKey.has(codeKey(a))) regByKey.set(codeKey(a), r);
const pdf = (source.files ?? []).find((f) => /\.pdf$/i.test(f.file)) ?? null;
const docSha = pdf?.sha256 ?? null;
const sourceUrl = (meta.source_url ?? clauses[0]?.source_url ?? '').replace(/^http:\/\//, 'https://');
const pdfUrl = meta.source_pdf_url ?? pdf?.fetched_from ?? null;

/* ── Монгол хэлний детерминист тэмдэг үгс ────────────────────────────── */
// ⚠️ ASCII `\b` кириллд ҮҮСДЭГГҮЙ — үгийн хилийг `(?<![\p{L}])…(?![\p{L}])`-ээр.
const W = (s) => new RegExp(`(?<![\\p{L}])(?:${s})(?![\\p{L}])`, 'iu');
const RX = {
  prohibition: W('хориглоно|хориглох|болохгүй|хэрэглэхгүй|зөвшөөрөхгүй|үл зөвшөөрнө|байж болохгүй|байрлуулахгүй|тавихгүй|хийхгүй'),
  permission: W('зөвшөөрнө|зөвшөөрөгдөнө|байж болно|хийж болно|авч болно|тооцож болно|ашиглаж болно|болно'),
  obligation: W('ёстой|шаардлагатай|мөрдөнө|заавал|хангана|хангасан байна|тооцно|тооцоолно|тооцох|авна|бодолцох|байх ёстой|байна|байгуулна|төлөвлөнө|тавина|хийнэ|гүйцэтгэнэ|үзүүлнэ|тогтооно|тодорхойлно|сонгоно|хэрэглэнэ|байрлуулна|ашиглана|хийгдэнэ|тоноглоно|хангагдана|төлөвлөгдөнө|үзнэ|шаардана'),
  condition: W('нөхцөлд|тохиолдолд|үед|бол|болзолд|байвал|байгаа бол|хэрэв|хамаарч|хамааран|хамаарна'),
  conditionSuffix: /(?:аас|ээс|оос|өөс)\s+(?:дээш|их|бага|доош)\s+(?:бол|байвал|үед|тохиолдолд)/iu,
  exception: W('бусад тохиолдолд|үл хамаарна|хамаарахгүй|оруулахгүй|тооцохгүй|шаардахгүй|хамааруулахгүй|үүнд хамаарахгүй|үл хамаарах'),
  exceptionSuffix: /(?:аас|ээс|оос|өөс)\s+бусад/iu,
  procedure: W('дараалал|үе шат|журам|горим|ажиллагааны дэс|шат дараалан'),
  reference: W('дагуу авна|заасны дагуу|нормын дагуу|дүрмийн дагуу|норм ба дүрмээс авна|заасан|харгалзах заалт'),
  scope: W('мөрдөнө|хамаарна|хэрэглэнэ|энэхүү норм|энэ норм'),
};
const UNIT_SYM = 'м²|м2|м³|м3|мм|см|км|м\/с|м\/сек|кН\/м²|кН\/м2|кН\/м|кН|кПа|кпа|МПа|мпа|кгс\/м²|кгс\/м2|кгс\/м|кгс|кг\/м²|кг\/м2|кг|л\/с|л|%|°C|°С|Вт|кВт|кВ|В|лк|дБ|м';
const UNIT_WORD = 'метр|километр|сантиметр|миллиметр|градус|давхар|хүн|цаг|минут|мин|секунд|сек|хувь|литр|тонн|балл|зэрэг';
const NUM = new RegExp(`(?<![\\p{L}\\d])(\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?)\\s*(?:(${UNIT_SYM})(?![\\p{L}\\d])|(${UNIT_WORD})(?=[\\p{L}]*(?![\\d])))?`, 'gu');
const RATIO = /(?<![\d/])(\d+\/\d+)(?![\d/])/g;
const DOC_CODE = /(?:БНбД|БНОД|БД|УББ|MNS|СНиП|СанПиН|СанПин|ГОСТ|СТ СЭВ|ISO|СП)\s*[-–]?\s*[A-ZА-Я]*\s*[-–]?\s*\d+(?:[.\-–/]\d+)*(?:\*\/?\d+)?/gu;
// Үсэгтэй хавсралтын ишлэл («Д.1-р хүснэгт», «Г.1.5 заалт») — үсгийг ХАСВАЛ «1-р хүснэгт» болж шийдэгдээгүй/буруу
//    холбоос гарна (20-04-17-д хэмжсэн).  Үсэг нь том, өмнө нь үсэг/цифр байхгүй үед л.
const TABLE_REF = /(?<![\p{L}\d.])((?:[А-ЯӨҮЁ]\.\s?)?\d+(?:\.\d+)*)\s*-?\s*р?\s*хүснэгт/giu;
const CLAUSE_REF = /(?<![\p{L}\d.])((?:[А-ЯӨҮЁ]\.)?\d+\.\d+(?:\.\d+)?)\s*-?\s*(?:р|д|т|ыг|ийг)?\s*(?:заалт|заалтад|заалтын|заалтыг|заалтанд|зүйл|-т заасан)/giu;
const APPENDIX_REF = /(\d+(?:\.\d+)*)\s*-?\s*р\s*хавсралт/giu;

function splitSentences(text) {
  // Тоо доторх цэг/таслал («1,0кпа», «5.1-р хүснэгт») өгүүлбэр таслахгүй; «/…/» тайлбар хэвээр.
  const out = [];
  let buf = '';
  const parts = text.split(/(?<=[.;:!?])\s+(?=[А-ЯӨҮA-Z\-–•])/u);
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    // «Тайлбар:» болон « - » жагсаалтын мөрийг тусдаа
    for (const seg of s.split(/\s+(?=[-–•]\s*[А-ЯӨҮ])/u)) {
      // Жагсаалтын тэмдэг («-Ослын үед …») өгүүлбэрийн эх биш — хасна (эхэд дэд мөр хэвээр агуулагдана).
      const t = seg.trim().replace(/^[-–•]\s*/u, '');
      if (t) out.push(t);
    }
  }
  void buf;
  return out.length ? out : [text.trim()];
}

function has(rx, s) { return rx.test(s); }

function classify(sentences, clauseNo, section, scope) {
  if (scope === 'appendix' && /^1$/.test(section ?? '') ) return 'definition';
  if (section === '1') return 'scope';
  if (section === '2') return 'reference';
  const all = sentences.join(' ');
  if (has(RX.prohibition, all)) return 'prohibition';
  if (has(RX.procedure, all) && !has(RX.obligation, all)) return 'procedure';
  if (has(RX.obligation, all)) return 'obligation';
  if (has(RX.permission, all)) return 'permission';
  if (has(RX.reference, all)) return 'reference';
  if (/^\s*(Тайлбар|Жич)/u.test(all)) return 'informational';
  return 'informational';
}

/**
 * Эхний өгүүлбэрийн ТЭРГҮҮЛЭХ нэрлэсэн хэсэг = заалтын «юуны тухай» — эхнээс эхлээд «нь»/«бол» эсвэл заах
 * (-ыг/-ийг/урт эгшиг+г) / өгөх-орших (-д/-т) тийн ялгалтай эхний үг ХҮРТЭЛ (тэр үгийг оруулаад, ≤ 10 үг).
 * Харьяалах (-ын/-ийн) дээр ЗОГСОХГҮЙ — «Өндөр барилгын» гэж тасарч байв.  Тэмдэг олдохгүй бол эхний
 * таслал/6 үг.  Энэ бол ЭХИЙН ҮГ ҮСГЭЭР — зохиосон нэршил биш.
 */
function extractSubject(first) {
  const words = first.replace(/^[-–•]\s*/u, '').split(/\s+/).filter(Boolean);
  const isMark = (w) => /^(нь|бол)$/u.test(w) || /(?:ыг|ийг|(?:аа|ээ|оо|өө|ай|ой|уй|үй|ий|уу|үү|ы)г)[,.;:]?$/u.test(w) || /[аеёиоөуүыэюяйнлр]д[,.;:]?$/u.test(w) || /[рс]т[,.;:]?$/u.test(w);
  let stop = -1;
  for (let i = 1; i < Math.min(words.length, 13); i += 1) if (isMark(words[i])) { stop = i; break; }
  let n;
  if (stop > 0) n = stop + 1;
  else { const comma = words.findIndex((w) => /[,;:]$/u.test(w)); n = comma > 0 && comma < 6 ? comma + 1 : Math.min(words.length, 6); }
  const subj = words.slice(0, n).join(' ').replace(/[,;:.]+$/u, '');
  return subj.length >= 3 && /\p{L}/u.test(subj) ? subj : null;
}

const defsByTerm = definitions.map((d) => ({ term: d.term, fold: d.term.toLowerCase(), id: d.definition_id, appendix: d.appendix, clause: d.clause ?? null, page: d.source_page, definition: String(d.definition ?? '').trim(), words: d.term.toLowerCase().split(/\s+/).filter(Boolean) }));

const sectionById = new Map(sections.map((s) => [String(s.section), s]));
const appendixById = new Map(appendices.map((a) => [String(a.appendix_id ?? a.appendix ?? ''), a]));
const tableNos = new Set(tables.map((t) => String(t.table_no ?? t.table ?? (typeof t.table_id === 'string' ? t.table_id.replace(/^.*#T/, '') : ''))));
const clauseByNo = new Map();
for (const c of clauses) {
  const k = c.scope === 'appendix' ? `A${c.appendix}:${c.clause}` : c.clause;
  clauseByNo.set(k, c);
}
const bodyClauseNos = new Set(clauses.filter((c) => c.scope === 'body').map((c) => c.clause));
const refsByClause = new Map();
for (const r of references) {
  if (!r.from_clause) continue;
  if (!refsByClause.has(r.from_clause)) refsByClause.set(r.from_clause, []);
  refsByClause.get(r.from_clause).push(r);
}

function crossRefs(text, c) {
  const out = [];
  const seen = new Set();
  const push = (x) => { const k = JSON.stringify([x.kind, x.target]); if (!seen.has(k)) { seen.add(k); out.push(x); } };
  for (const m of text.matchAll(DOC_CODE)) {
    const t = m[0].replace(/\s+/g, ' ').trim();
    if (t.replace(/\D/g, '') === code.replace(/\D/g, '')) continue; // өөрийгөө
    push({ kind: 'document', target: t, resolved: null, source: 'text' });
  }
  for (const r of refsByClause.get(c.clause) ?? []) {
    // Заалтын дугаар үндсэн хэсэг/хавсралт хооронд давхардана (8.3 ↔ A8:8.3) — ишлэлийг ХУУДСААР тулгана.
    const lo = c.source_page ?? -1; const hi = c.end_page ?? lo;
    if (typeof r.source_page === 'number' && (r.source_page < lo - 1 || r.source_page > hi + 1)) continue;
    push({ kind: 'document', target: r.to_document, resolved: null, source: 'references.jsonl', relationship: r.relationship, context: r.context ?? null });
  }
  // «БНбД 23-01-09-ийн 1-р хүснэгт», «… 2.1 зүйлийг» — ӨӨР баримтын хүснэгт/заалт: энэ баримтад хайхгүй, `external` + баримт.
  const ownerDoc = (m) => {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const dm = /((?:БНбД|БНОД|БД|УББ|MNS|СНиП|ГОСТ)\s*[-–]?\s*[\dA-ZА-Я.\-–:/*]+?)\s*-?\s*(?:ийн|ын|н|ий)\s*(?:\(?\s*)$/u.exec(before);
    return dm ? dm[1].trim().replace(/[/\s]+$/u, '') : null;
  };
  for (const m of text.matchAll(TABLE_REF)) {
    const owner = ownerDoc(m);
    if (owner && owner.replace(/\D/g, '') !== code.replace(/\D/g, '')) { push({ kind: 'table', target: m[1].replace(/\s+/g, ''), resolved: null, resolution: 'external', document: owner, source: 'text' }); continue; }
    // Хүснэгт: parsed/tables.jsonl-д ЯГ тэр дугаар байвал л resolved; байхгүй = UNRESOLVED (ойролцоо дугаар руу ТААМАГЛАХГҮЙ —
    //    16.2.2 ↔ x.133-ын «6.2.2» гэх мэт нь хүний хяналтад л, `candidate_note`).
    const tno = m[1].replace(/\s+/g, '');
    const ok = tableNos.has(tno);
    push({ kind: 'table', target: tno, resolved: tableNos.size === 0 ? null : ok, resolution: ok ? 'resolved' : 'unresolved', target_id: ok ? `${code}#T${tno}` : null, source: 'text' });
  }
  for (const m of text.matchAll(CLAUSE_REF)) {
    const owner = ownerDoc(m);
    if (owner && owner.replace(/\D/g, '') !== code.replace(/\D/g, '')) { push({ kind: 'clause', target: m[1], resolved: null, resolution: 'external', document: owner, source: 'text' }); continue; }
    // Заалт: хавсралтын заалт ЭХЛЭЭД өөрийн хавсралтад, дараа нь үндсэн хэсэгт; үндсэн хэсгийн заалт үндсэн хэсэгт, байхгүй бол
    //    ГАНЦ хавсралтад л байвал тэнд.  Хоёуланд байвал ОЙР хамрах хүрээ + `alternatives` (буруу холбоос = хатуу алдаа).
    const r = resolveClauseRef(m[1], c);
    push({ kind: 'clause', target: m[1], resolved: r.resolution === 'resolved', resolution: r.resolution, target_uid: r.uid, target_scope: r.scope, alternatives: r.alternatives, source: 'text' });
  }
  for (const m of text.matchAll(APPENDIX_REF)) {
    const ok = appendixById.has(m[1]);
    push({ kind: 'appendix', target: m[1], resolved: ok, resolution: ok ? 'resolved' : 'unresolved', source: 'text' });
  }
  for (const x of out) if (x.kind === 'document') { x.resolution = 'external'; Object.assign(x, documentStatus(x.target)); }
  return out;
}

/**
 * Өөр нормын ишлэлийн бүртгэлийн төлөв.  SUPERSEDED + `superseded_by` (албан нотолгоотой) бол ОДООГИЙН кодыг ХАЖУУД нь
 * өгнө — эх ишлэл (`original_reference_code`) хэзээ ч дарж бичигдэхгүй, эх бичвэр өөрчлөгдөхгүй.  Бүртгэлд байхгүй → {}.
 */
function documentStatus(target) {
  const r = regByKey.get(codeKey(target));
  if (!r) return { original_reference_code: target, registry_code: null, registry_status: null };
  const base = { original_reference_code: target, registry_code: r.canonical_code, registry_status: r.status };
  if (r.status === 'SUPERSEDED' && r.superseded_by) {
    const succ = regByKey.get(codeKey(r.superseded_by));
    return { ...base, resolved_current_code: r.superseded_by, resolved_current_status: succ?.status ?? null, resolution_basis: 'official_supersession_order', resolution_evidence: (r.status_evidence ?? []).slice(0, 3) };
  }
  return base;
}

function resolveClauseRef(target, c) {
  const inBody = bodyClauseNos.has(target);
  const inAppendices = [...clauseByNo.keys()].filter((k) => k.startsWith('A') && k.endsWith(`:${target}`)).map((k) => k.slice(1, k.indexOf(':')));
  if (c.scope === 'appendix') {
    const own = inAppendices.includes(String(c.appendix));
    if (own) return { resolution: 'resolved', uid: `${code}#A${c.appendix}:${target}`, scope: 'appendix', alternatives: inBody ? [`${code}#${target}`] : [] };
    if (inBody) return { resolution: 'resolved', uid: `${code}#${target}`, scope: 'body', alternatives: inAppendices.map((a) => `${code}#A${a}:${target}`) };
    if (inAppendices.length === 1) return { resolution: 'resolved', uid: `${code}#A${inAppendices[0]}:${target}`, scope: 'appendix', alternatives: [] };
    return { resolution: 'unresolved', uid: null, scope: null, alternatives: inAppendices.map((a) => `${code}#A${a}:${target}`) };
  }
  if (inBody) return { resolution: 'resolved', uid: `${code}#${target}`, scope: 'body', alternatives: inAppendices.map((a) => `${code}#A${a}:${target}`) };
  if (inAppendices.length === 1) return { resolution: 'resolved', uid: `${code}#A${inAppendices[0]}:${target}`, scope: 'appendix', alternatives: [] };
  return { resolution: 'unresolved', uid: null, scope: null, alternatives: inAppendices.map((a) => `${code}#A${a}:${target}`) };
}

function numericLiterals(raw) {
  const out = [];
  const seen = new Set();
  // Баримтын код (БНбД 40-05-98), заалт/хүснэгтийн дугаар нь ТОО БИШ — эхлээд маскална; харьцаа (1/8) бүхлээрээ.
  // Заалтын хаяг («5.1.18», «( 5.1.18)», «6.1.3.-д») бүхлээрээ маск — «18» гэж тоо болгохгүй (хэмжсэн: A5.1:5.1.12).
  let text = raw.replace(DOC_CODE, (m) => ' '.repeat(m.length)).replace(/(?<![\d.])\d+(?:\.\d+)+\.?(?!\d)/g, (m) => ' '.repeat(m.length));
  for (const m of text.matchAll(RATIO)) if (!seen.has(m[1])) { seen.add(m[1]); out.push({ literal: m[1], value: null, unit: 'ratio' }); }
  text = text.replace(RATIO, (m) => ' '.repeat(m.length));
  for (const m of text.matchAll(NUM)) {
    const lit = m[0].trim();
    if (/^\d+\.\d+(?:\.\d+)?$/.test(lit) && !m[2] && !m[3]) continue; // заалт/хүснэгтийн дугаар («5.1»)
    if (seen.has(lit)) continue;
    seen.add(lit);
    out.push({ literal: lit, value: m[1].replace(/\s/g, ''), unit: m[2] ?? m[3] ?? null });
  }
  return out;
}

function frameOf(sentences, c) {
  const f = { subject: [], requirement: [], conditions: [], exceptions: [], prohibitions: [], permissions: [], cross_references: [] };
  const subj = extractSubject(sentences[0] ?? '');
  if (subj) f.subject.push(subj);
  const en = enumerationOf(c.text ?? sentences.join(' '));
  // Жагсаалтын бие («Үүнд: а) …; б) …») нэг өгүүлбэр болж ирдэг — дотор нь НЭГ зүйлд «…-аас бусад» байхад БҮХ жагсаалт
  //    «Онцгой нөхцөл» болдог байв (5.5-ын в).  Тиймээс биеийг өгүүлбэрээр биш ЗҮЙЛЭЭР ангилна: онцгой/нөхцөлтэй зүйл
  //    «в) …» хэлбэрээр (эх бичвэрт үг үсгээрээ) тэр жагсаалтад орно.  Зөвхөн АНГИЛЛЫН (membership) жагсаалтад.
  const isListBody = (s) => en?.kind === 'membership' && en.items.length >= 2 && s.includes(en.items[0].text) && s.includes(en.items[1].text);
  for (const s of sentences) {
    if (isListBody(s)) {
      for (const it of en.items) {
        const line = `${it.marker}) ${it.text}`;
        const itExc = has(RX.exception, it.text) || RX.exceptionSuffix.test(it.text);
        if (itExc) f.exceptions.push(line);
        else if (has(RX.condition, it.text) || RX.conditionSuffix.test(it.text)) f.conditions.push(line);
      }
      continue;
    }
    const isExc = has(RX.exception, s) || RX.exceptionSuffix.test(s);
    const isProh = has(RX.prohibition, s);
    const isPerm = !isProh && has(RX.permission, s);
    const isObl = has(RX.obligation, s);
    const isCond = has(RX.condition, s) || RX.conditionSuffix.test(s);
    if (isProh) f.prohibitions.push(s);
    else if (isPerm) f.permissions.push(s);
    else if (isObl) f.requirement.push(s);
    if (isCond && !isExc) f.conditions.push(s);
    if (isExc) f.exceptions.push(s);
  }
  if (f.requirement.length === 0 && f.prohibitions.length === 0 && f.permissions.length === 0 && sentences[0]) f.requirement.push(sentences[0]);
  f.cross_references = crossRefs(sentences.join(' '), c);
  if (en) f.enumeration = en;
  return f;
}

/**
 * ЖАГСААЛТ («… дараах ачааллуудыг хамааруулна. Үүнд: а) …; б) …») — ерөнхий хүрээ, баримтын код БАЙХГҮЙ.  `kind`:
 * `membership` = толгой нь ангилалд ХАМААРУУЛАХ үйл үгтэй («хамааруулна», «ангилна», «багтаана», «…-д:») — ангиллын
 * асуултад л хэрэглэгдэнэ; бусад = `list`.  Зүйл бүр ЭХЭЭС үг үсгээрээ; сүүлийн зүйлийн араас өгүүлбэр («Урьдчилсан
 * хүчитгэлээс …») эхэлбэл тэр нь `trailing` (зүйл биш).  Үсгийн дараалал (а, б, в …) тасарвал жагсаалт биш.
 */
const ITEM_LETTERS = 'абвгдеёжзийклмноөпрстуүфхцчшщэюя';
function enumerationOf(text) {
  const hits = [...text.matchAll(/(?:^|[\s;:.,(])([а-яөүё])\)\s+/gu)];
  const seq = [];
  let want = 0;
  // Монгол жагсаалт «ё», «й» (заримдаа «ъ/ы/ь») үсгийг АЛГАСДАГ: 5.4 «е) … ж) … з) … и) … к)» — алгасахгүй бол «е)» зүйлд
  //    ж…к бүгд наалдаж байв (хэмжсэн 2026-09-23).
  const SKIPPABLE = new Set(['ё', 'й', 'ъ', 'ы', 'ь']);
  for (const h of hits) {
    let w = want;
    while (w < ITEM_LETTERS.length && h[1] !== ITEM_LETTERS[w] && SKIPPABLE.has(ITEM_LETTERS[w])) w += 1;
    if (h[1] === ITEM_LETTERS[w]) { seq.push(h); want = w + 1; }
  }
  if (seq.length < 2) return null;
  const start = (h) => h.index + h[0].indexOf(h[1]);
  const lead = text.slice(0, start(seq[0])).trim();
  if (lead.length < 6) return null;
  const items = [];
  let trailing = null;
  for (let i = 0; i < seq.length; i += 1) {
    const from = start(seq[i]) + 2;
    let body = text.slice(from, i + 1 < seq.length ? start(seq[i + 1]) : text.length).trim();
    if (i + 1 === seq.length) {
      const cut = body.search(/[.](?=\s+[А-ЯӨҮЁ])/u);
      if (cut >= 0) { trailing = body.slice(cut + 1).trim() || null; body = body.slice(0, cut + 1).trim(); }
    }
    items.push({ marker: seq[i][1], text: body.replace(/[;,]\s*$/u, '').trim() });
  }
  const membership = /(?:хамааруулна|хамаарна|багтаана|ангилна|оруулна)[.:]?\s*(?:Үүнд:)?\s*$/u.test(lead) || /(?<!Үүн)(?:д|т):\s*$/u.test(lead); // «Үүнд:» нь толгой биш — «Онцгой Ps ачаалалд:» л
  return { kind: membership ? 'membership' : 'list', lead, items, trailing };
}

const REQ_LABEL = { scope: 'хэрэглэх хүрээ', definition: 'нэр томьёоны тодорхойлолт', obligation: 'заавал биелүүлэх шаардлага', prohibition: 'хориглосон зүйл', permission: 'зөвшөөрсөн зүйл', reference: 'өөр норм руу заасан', procedure: 'дараалал / журам', informational: 'мэдээлэл' };

/** Детерминист digest — мөр бүр эх өгүүлбэр, шошготой. */
/**
 * ДЕТЕРМИНИСТ FALLBACK (L2.1) — эхийн өгүүлбэрүүд + бага зэргийн холбох үг: «энгийн» биш ч ҮРГЭЛЖ үнэн.  Шошготой
 * digest-ээс ялгаа нь уншигдах холбоо; нөхцөл/онцгой нөхцөл/тоо бүр эхийнхээ хэлбэрээр.  Шалгагчаар ЗААВАЛ PASS (тест).
 */
// ⚠️ Толгой өгүүлбэрт МОДАЛИЙН үг («байна», «тогтооно») байж болохгүй — шалгагч түүнийг заалтын модаль гэж уншина.
const TYPE_LEAD = {
  scope: 'Энэ заалт нормын хэрэглэх хүрээг тогтоосон',
  definition: 'Энэ заалт нэр томьёог тодорхойлсон',
  obligation: 'Энэ заалт биелүүлэх шаардлага тогтоосон',
  prohibition: 'Энэ заалт хориглол тогтоосон',
  permission: 'Энэ заалт зөвшөөрөл олгосон',
  reference: 'Энэ заалт өөр норм, баримт руу заасан',
  procedure: 'Энэ заалт дараалал, журам тогтоосон',
  informational: 'Энэ заалт мэдээлэл өгсөн',
};
function naturalFallback(rec) {
  const f = rec.semantic_frame;
  const parts = [];
  const core = rec.requirement_type === 'prohibition' ? f.prohibitions : rec.requirement_type === 'permission' ? f.permissions : f.requirement;
  // Толгой өгүүлбэрт субъектийг ДАВТАХГҮЙ — гол өгүүлбэр шууд дараа нь; субъектийн хэлтэрхий («… зөвшөөрөгдөх … хэмжээ»)
  //    шалгагчид модаль/тоон босгын худал дохио өгч байв (хэмжсэн: A6.4:6.4.9).
  parts.push(`${TYPE_LEAD[rec.requirement_type]}.`);
  if (core.length) parts.push(core.slice(0, 2).join(' '));
  const cond = f.conditions.filter((x) => !core.slice(0, 2).includes(x));
  if (cond.length) parts.push(`Хамаарах нөхцөл: ${cond.slice(0, 2).join(' ')}`);
  if (f.exceptions.length) parts.push(`Онцгой нөхцөл: ${f.exceptions.slice(0, 2).join(' ')}`);
  if (rec.requirement_type !== 'prohibition' && f.prohibitions.length) parts.push(`Хориглосон: ${f.prohibitions.slice(0, 1).join(' ')}`);
  return parts.join(' ');
}

function digest(rec) {
  const f = rec.semantic_frame;
  const build = (k) => {
    const parts = [];
    const where = rec.scope === 'appendix' ? (rec.heading_path[0] ?? null) : (rec.context.section ? rec.context.section.title : (rec.heading_path[0] ?? null));
    parts.push(`${rec.norm_code}-ын ${rec.clause_id} заалт${where ? ` («${where}»)` : ''} — ${REQ_LABEL[rec.requirement_type]}.`);
    if (rec.requirement_type === 'scope') parts.push(`Хэрэглэх хүрээ: ${f.requirement.slice(0, 1).join(' ')}`);
    else {
      if (f.subject.length) parts.push(`Юуны тухай: ${f.subject.join('; ')}.`);
      if (f.requirement.length) parts.push(`Шаардлага: ${f.requirement.slice(0, k).join(' ')}`);
      if (f.prohibitions.length) parts.push(`Хориглосон: ${f.prohibitions.slice(0, k).join(' ')}`);
      if (f.permissions.length) parts.push(`Зөвшөөрсөн: ${f.permissions.slice(0, k).join(' ')}`);
    }
    const cond = f.conditions.filter((x) => !(f.requirement.slice(0, k).includes(x) || f.prohibitions.slice(0, k).includes(x) || f.permissions.slice(0, k).includes(x)));
    if (cond.length) parts.push(`Нөхцөл: ${cond.slice(0, k).join(' ')}`);
    if (f.exceptions.length) parts.push(`Онцгой нөхцөл: ${f.exceptions.slice(0, k).join(' ')}`);
    return parts;
  };
  let parts = build(2);
  if (parts.join(' ').length > 900) parts = build(1);
  const docs = f.cross_references.filter((x) => x.kind === 'document').map((x) => x.target);
  const internal = f.cross_references.filter((x) => x.kind !== 'document').map((x) => (x.kind === 'table' ? `${x.target}-р хүснэгт` : x.kind === 'appendix' ? `${x.target}-р хавсралт` : `${x.target} заалт`));
  if (docs.length || internal.length) parts.push(`Иш татсан: ${[...docs, ...internal].join(', ')}.`);
  if (rec.numeric_literals.length) parts.push(`Заалтад дурдсан тоо: ${rec.numeric_literals.map((n) => n.literal).join(', ')}.`);
  return parts.join(' ');
}

/* ── Угсралт ───────────────────────────────────────────────────────── */
const generatedAt = new Date().toISOString().slice(0, 10);
const stats = { document: code, total_clauses: clauses.length, success: 0, missing_source: 0, missing_page: 0, cross_reference_unresolved: 0, cross_references_total: 0, auto_draft: 0, human_verified: 0, llm_accepted: 0, llm_rejected: {}, by_requirement_type: {}, ambiguous_clause_numbers: 0, definitions_linked: 0, term_links: 0, cross_reference_resolved: 0, cross_reference_external: 0 };
const bodyDup = new Set(clauses.filter((c) => c.scope === 'appendix').map((c) => c.clause).filter((n) => bodyClauseNos.has(n)));
const records = [];
const fallbackFailures = [];
for (let i = 0; i < clauses.length; i += 1) {
  const c = clauses[i];
  const text = (c.text ?? '').trim();
  if (!text) { stats.missing_source += 1; continue; }
  const sentences = splitSentences(text);
  const sec = sectionById.get(String(c.section));
  const heading = [];
  if (c.scope === 'appendix') {
    const ap = appendixById.get(String(c.appendix));
    heading.push(`${c.appendix}-р хавсралт${ap?.kind ? ` (${ap.kind})` : ''}${ap?.title ? `: ${ap.title}` : ''}`);
  } else if (sec) heading.push(`${sec.section}. ${sec.title.trim()}`);
  const parts = c.clause.split('.');
  let parentClause = null;
  if (parts.length === 3) {
    const pk = c.scope === 'appendix' ? `A${c.appendix}:${parts[0]}.${parts[1]}` : `${parts[0]}.${parts[1]}`;
    const p = clauseByNo.get(pk);
    if (p) { parentClause = { clause_id: p.clause, text: p.text.slice(0, 240) }; heading.push(`${p.clause} ${p.text.slice(0, 80)}${p.text.length > 80 ? '…' : ''}`); }
  }
  const prev = clauses[i - 1] && clauses[i - 1].section === c.section && clauses[i - 1].scope === c.scope ? clauses[i - 1].clause : null;
  const next = clauses[i + 1] && clauses[i + 1].section === c.section && clauses[i + 1].scope === c.scope ? clauses[i + 1].clause : null;
  const low = text.toLowerCase();
  const defs = linkTerms(text, defsByTerm.map((d) => ({ term: d.term, definition_id: d.id, appendix: d.appendix, clause: d.clause, page: d.page, definition: d.definition })).filter((d) => d.clause !== c.clause));
  if (defs.length) { stats.definitions_linked += 1; stats.term_links += defs.length; }
  // АНГИЛЛЫН жагсаалт («… ачааллуудыг хамааруулна. Үүнд: а) … горим шилжүүлэх …») — төрлийг зүйлсийн үгээр БИШ, толгой
  //    (+ араас нь ирэх өгүүлбэр)-оор тогтооно: 5.5-ын «а) … горим шилжүүлэх» нь «журам» гэж ангилагдаж байв (2026-09-23).
  const enumForType = enumerationOf(c.text ?? sentences.join(' '));
  const typeSentences = enumForType?.kind === 'membership' ? [enumForType.lead, enumForType.trailing].filter(Boolean) : sentences;
  const requirementType = classify(typeSentences, c.clause, String(c.section), c.scope);
  const rec = {
    type: 'clause_explanation',
    schema_version: 'l2-clause/1',
    norm_code: code,
    document_id: meta.doc_id,
    clause_id: c.clause,
    clause_uid: c.clause_id,
    // Мэдлэгийн сангийн `ai_chunks.chunk_id`-тай ЯГ ижил (pack/knowledge_chunks.jsonl-ийн дүрэм) — L2 бичлэг заалтын хэсэгт холбогдох ГАНЦ түлхүүр.
    chunk_id: c.scope === 'appendix' ? `${meta.doc_id}:appendix:${c.appendix}:clause:${c.clause}` : `${meta.doc_id}:clause:${c.clause}`,
    scope: c.scope,
    appendix: c.appendix ?? null,
    ambiguous_with: bodyDup.has(c.clause) ? (c.scope === 'body' ? `appendix:${c.clause}` : `body:${c.clause}`) : null,
    heading_path: heading,
    source_text: text,
    source_text_sha256: sha256(text),
    context: {
      document_title: meta.title_mn,
      section: sec ? { section: sec.section, title: sec.title.trim(), page: sec.source_page } : null,
      parent_clause: parentClause,
      prev_clause: prev,
      next_clause: next,
      definitions: defs,
      referenced_clauses: [],
      notes: c.notes ?? [],
    },
    semantic_frame: frameOf(sentences, c),
    plain_mn: '',
    plain_mn_method: 'deterministic_digest',
    /** L2.1: ЭХ → ХҮРЭЭ → НЭР ДЭВШИГЧ → СЕМАНТИК ШАЛГАЛТ.  fallback үргэлж; candidate зөвхөн PASS үед. */
    plain_mn_fallback: '',
    plain_mn_candidate: null,
    candidate_verification: null,
    /**
     * `candidate_policy: REVIEW_REQUIRED` — семантик шалгалт PASS өгсөн ч нэр дэвшигчийг ХҮНИЙ хяналт (HUMAN_REVIEW_100 → ≥99 % зөв,
     * урвуулалт 0) батлагдтал ҮЙЛЧЛЭХГҮЙ (Worker `human_review === 'APPROVED'` шаардана).  Хэмжсэн 2026-09-18: PASS 132-ын санамсаргүй 12-ын
     * 3 нь утгын дутагдалтай (босго алдагдсан, ишлэл буруу өгүүлбэрт, хэт шахагдсан) — «зөв атлаа хатуу» fallback дээр.
     */
    status: { source_verification: 'AUTO_EXTRACTED', explanation_generation: 'DETERMINISTIC_DIGEST', semantic_validation: 'NOT_RUN', human_review: 'NOT_REVIEWED', candidate_policy: 'REVIEW_REQUIRED' },
    requirement_type: requirementType,
    numeric_literals: numericLiterals(text),
    source: { page: c.source_page ?? null, pdf_page: c.source_pdf_page ?? null, url: sourceUrl, pdf_url: pdfUrl, document_sha256: docSha, clause_verification: c.verification_status },
    currentness: { effective_status: meta.effective_status, note: 'Хүчинтэй эсэх нь ойлголтоос тусдаа — бүртгэл/төлөвийн системээс.' },
    verification: { source_text: c.verification_status, explanation: 'AUTO_DRAFT' },
    execution: { computable: false },
    generated_at: generatedAt,
    generator: 'norm-dataset/tools/build-l2.mjs',
  };
  rec.context.referenced_clauses = rec.semantic_frame.cross_references.filter((x) => x.kind === 'clause' && x.resolution === 'resolved').map((x) => { const key = x.target_scope === 'appendix' ? x.target_uid.replace(`${code}#`, '') : x.target; return { clause_id: x.target, clause_uid: x.target_uid, text: (clauseByNo.get(key)?.text ?? '').slice(0, 240) }; });
  rec.plain_mn_fallback = naturalFallback(rec);
  rec.plain_mn = digest(rec);
  {
    // Fallback нь шалгагчаар PASS байх ёстой (эхийн өгүүлбэрүүд) — унавал бүтээлт зогсоно (регресс).
    const v = verifyExplanation({ sourceText: rec.source_text, candidate: rec.plain_mn_fallback, clauseUid: rec.clause_uid, subject: rec.semantic_frame.subject, normCode: rec.norm_code });
    if (v.verdict !== 'PASS') fallbackFailures.push(`${rec.clause_uid} «${rec.plain_mn_fallback.slice(0, 200)}» — ${v.failures.map((x) => `${x.code}: ${x.detail}`).join(' | ')}`);
  }
  if (!rec.source.page) stats.missing_page += 1;
  if (rec.ambiguous_with) stats.ambiguous_clause_numbers += 1;
  stats.cross_references_total += rec.semantic_frame.cross_references.length;
  stats.cross_reference_unresolved += rec.semantic_frame.cross_references.filter((x) => x.resolution === 'unresolved').length;
  stats.cross_reference_resolved += rec.semantic_frame.cross_references.filter((x) => x.resolution === 'resolved').length;
  stats.cross_reference_external += rec.semantic_frame.cross_references.filter((x) => x.resolution === 'external').length;
  stats.by_requirement_type[requirementType] = (stats.by_requirement_type[requirementType] ?? 0) + 1;
  stats.auto_draft += 1;
  stats.success += 1;
  records.push(rec);
}

/* ── L2 (2026-09-23): албан ТАЙЛБАРЫН холбоос — норм биш, тусдаа эшлэлтэй ─────────────────────────────── */
/** Тайлбарын ишлэл: эхний өгүүлбэрүүд (≤ 480 тэмдэгт, өгүүлбэрийн хил дээр) — ҮГ ҮСГЭЭРЭЭ тайлбарын эхээс. */
function commentaryExcerpt(text, max = 480) {
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return at > max * 0.4 ? cut.slice(0, at + 1).trim() : null;
}
const commentaryView = (u) => ({
  commentary_uid: u.commentary_uid, code: u.commentary_code, role: 'COMMENTARY_SOURCE', normative: false,
  marker: u.marker, item: u.norm_link.item, link_resolution: u.norm_link.resolution, no_commentary: u.no_commentary, see_also: u.see_also ?? [],
  excerpt: u.no_commentary ? null : commentaryExcerpt(u.text), text_sha256: u.text_sha256,
  page: u.source_page, pdf_page: u.source_pdf_page, page_inferred: u.page_inferred === true, url: u.source_url, pdf_url: u.pdf_url, document_sha256: u.document_sha256,
  verification: u.verification_status,
});
if (commentaryMeta) {
  stats.commentary_units = commentaryUnits.length;
  stats.commentary_linked_clauses = 0;
  stats.commentary_excerpt_unavailable = 0;
  const byClause = new Map();
  for (const u of commentaryUnits) {
    if (!u.norm_link.clause_uid) continue;
    if (!byClause.has(u.norm_link.clause_uid)) byClause.set(u.norm_link.clause_uid, []);
    byClause.get(u.norm_link.clause_uid).push(u);
  }
  const byUidC = new Map(commentaryUnits.map((u) => [u.commentary_uid, u]));
  for (const rec of records) {
    const us = byClause.get(rec.clause_uid);
    if (!us) continue;
    rec.commentary = us.map(commentaryView);
    stats.commentary_linked_clauses += 1;
    stats.commentary_excerpt_unavailable += rec.commentary.filter((x) => !x.no_commentary && x.excerpt === null).length;
    // Ишлэл нь тайлбарын эхийн УГТВАР байх ёстой — зөрвөл бүтээлт зогсоно (тайлбарыг «засч» бичихгүй).
    for (const x of rec.commentary) if (x.excerpt && !byUidC.get(x.commentary_uid).text.startsWith(x.excerpt)) throw new Error(`тайлбарын ишлэл эхээс зөрөв: ${x.commentary_uid}`);
  }
}

if (fallbackFailures.length > 0) throw new Error(`fallback шалгагчаар унав (${fallbackFailures.length}):` + String.fromCharCode(10) + fallbackFailures.join(String.fromCharCode(10)));

/* ── L2.1: нэр дэвшигч → семантик шалгалт ────────────────────────────── */
if (candidatesPath && existsSync(candidatesPath)) {
  const cands = new Map(readJsonl(candidatesPath).filter((r) => typeof r.candidate === 'string' && r.candidate.trim().length > 0).map((r) => [r.clause_uid, r]));
  stats.candidates_total = cands.size;
  stats.candidates_pass = 0;
  stats.candidates_fail = 0;
  stats.candidates_fail_by_code = {};
  stats.candidates_stale = 0;
  for (const rec of records) {
    const c = cands.get(rec.clause_uid);
    if (!c) continue;
    // Нэр дэвшигч нь ЭНЭ эх бичвэрт (sha) зориулагдсан байх ёстой — эх өөрчлөгдвөл хуучин нэр дэвшигч хүчингүй.
    if (c.source_text_sha256 && c.source_text_sha256 !== rec.source_text_sha256) { stats.candidates_stale += 1; continue; }
    const v = verifyExplanation({ sourceText: rec.source_text, candidate: c.candidate, clauseUid: rec.clause_uid, subject: rec.semantic_frame.subject, normCode: rec.norm_code });
    rec.candidate_verification = { verdict: v.verdict, failures: v.failures.map((f) => ({ code: f.code, detail: f.detail, claim: f.claim.slice(0, 160) })), claims: v.claims.map((k) => ({ claim: k.claim, verdict: k.verdict, codes: k.codes, supported_by: k.supported_by })), model: c.model ?? null, generated_at: c.generated_at ?? null };
    rec.status.explanation_generation = 'MODEL_DRAFT';
    rec.status.semantic_validation = v.verdict;
    if (v.verdict === 'PASS') {
      stats.candidates_pass += 1;
      // `plain_mn` (үйлчлэх detерминист текст) ХЭВЭЭР — нэр дэвшигч ТУСДАА талбарт; Worker `semantic_validation === 'PASS'`
      //    үед л «Энгийнээр»-т харуулж, трейлерт «загварын ноорог, хүн шалгаагүй» гэж ил хэлнэ.  HUMAN_VERIFIED энд хэзээ ч биш.
      rec.plain_mn_candidate = c.candidate.trim();
    } else {
      stats.candidates_fail += 1;
      for (const code of new Set(v.failures.filter((f) => f.hard).map((f) => f.code))) stats.candidates_fail_by_code[code] = (stats.candidates_fail_by_code[code] ?? 0) + 1;
      // FAIL → fallback хэвээр; нэр дэвшигч ХАДГАЛАГДАХГҮЙ (үйлчлэхгүй), зөвхөн шалгалтын тэмдэглэл үлдэнэ.
    }
  }
}
// plain_mn = детерминист digest (эхийн өгүүлбэрүүд) ҮРГЭЛЖ; нэр дэвшигч зөвхөн `plain_mn_candidate`-д.

/* ── Баримт ба хэсгийн түвшний тайлбар ─────────────────────────────── */
const scopeClause = records.find((r) => r.clause_id === '1.1' && r.scope === 'body');
// 1.2 нь «хамаарахгүй» заалт байх албагүй (20-04-17-ийн 1.2 = зөвшөөрөл) — хэрэглэхгүй/хамаарахгүй үгтэй үед л.
const notApplicable = records.find((r) => r.clause_id === '1.2' && r.scope === 'body' && /хэрэглэхгүй|хамаарахгүй|мөрдөхгүй|үл хамаарна/u.test(r.source_text));
const docExplanation = {
  type: 'document_explanation',
  schema_version: 'l2-document/1',
  norm_code: code,
  document_id: meta.doc_id,
  title_mn: meta.title_mn,
  title_en: meta.title_en ?? null,
  approval: meta.approval ?? null,
  scope_text: scopeClause?.source_text ?? null,
  not_applicable_text: notApplicable?.source_text ?? null,
  sections: sections.map((s) => ({ section: String(s.section), title: s.title.trim(), page: s.source_page, clause_count: records.filter((r) => r.scope === 'body' && String(r.context.section?.section) === String(s.section)).length })),
  appendices: appendices.map((a) => ({ appendix: a.appendix_id, kind: a.kind, title: a.title, page: a.source_page })),
  counts: { clauses: records.length, body: records.filter((r) => r.scope === 'body').length, appendix: records.filter((r) => r.scope === 'appendix').length, definitions: definitions.length, tables: tables.length, references: references.length },
  /** L2.1: нэр томьёо (1-р хавсралт) — `chunk_id` нь pack-ийн definition хэсгийн дүрмээр (term → lower, зай → _); тодорхойлолт ЭХЭЭС үг үсгээрээ. */
  definitions: definitions.map((d) => ({ term: d.term, definition: String(d.definition ?? '').trim(), definition_id: d.definition_id, chunk_id: `${meta.doc_id}:definition:${String(d.term).toLowerCase().replace(/\s+/g, '_')}`, appendix: d.appendix ?? (d.clause ? null : '1'), clause: d.clause ?? null, page: d.source_page ?? null, linked_clauses: records.filter((r) => r.context.definitions.some((x) => x.definition_id === d.definition_id)).map((r) => r.clause_uid) })),
  source: { url: sourceUrl, pdf_url: pdfUrl, document_sha256: docSha, legal_url: meta.legal_source_url ?? null },
  currentness: { status: meta.status, effective_status: meta.effective_status, note: meta.effective_status_note ?? null, successor_draft: meta.successor_draft?.code ?? null },
  verification: { explanation: 'AUTO_DRAFT' },
  execution: { computable: false },
  generated_at: generatedAt,
};
// L2 (2026-09-23): нэмэлт талбар — зөвхөн өгөгдөл байвал (31-17-10-ын файлд нэмэгдэхгүй).
if ((meta.supersedes ?? []).length > 0) docExplanation.supersedes = (meta.supersedes ?? []).map((c) => ({ code: c, evidence: meta.supersedes_note ?? null, registry_status: regByKey.get(codeKey(c))?.status ?? null }));
if (commentaryMeta) docExplanation.commentary_source = { code: commentaryMeta.canonical_code, title_mn: commentaryMeta.title_mn, role: 'COMMENTARY_SOURCE', normative: false, status: commentaryMeta.status, approval: commentaryMeta.approval, url: commentaryMeta.source_url, pdf_url: commentaryMeta.source_pdf_url, document_sha256: commentaryMeta.source.sha256, units: commentaryUnits.length, units_with_text: commentaryUnits.filter((u) => !u.no_commentary).length, linked_clauses: stats.commentary_linked_clauses };

const sectionExplanations = sections.map((s) => {
  const rs = records.filter((r) => r.scope === 'body' && String(r.context.section?.section) === String(s.section));
  const types = {};
  for (const r of rs) types[r.requirement_type] = (types[r.requirement_type] ?? 0) + 1;
  return {
    type: 'section_explanation', schema_version: 'l2-section/1', norm_code: code, section: String(s.section), title: s.title.trim(), page: s.source_page,
    clause_ids: rs.map((r) => r.clause_id), clause_count: rs.length, requirement_types: types,
    first_clause: rs[0] ? { clause_id: rs[0].clause_id, text: rs[0].source_text.slice(0, 300) } : null,
    cross_documents: [...new Set(rs.flatMap((r) => r.semantic_frame.cross_references.filter((x) => x.kind === 'document').map((x) => x.target)))],
    numeric_literal_count: rs.reduce((a, r) => a + r.numeric_literals.length, 0),
    source: { url: sourceUrl, pdf_url: pdfUrl, document_sha256: docSha },
    verification: { explanation: 'AUTO_DRAFT' }, execution: { computable: false },
    ...(commentaryMeta ? { commentary: commentaryUnits.filter((u) => u.norm_link.resolution === 'section' && u.norm_link.section === String(s.section)).map(commentaryView) } : {}),
  };
});

/* ── L2 (2026-09-23): ХҮСНЭГТ / ТОМЬЁО — тайлбарлах объект, тооцоо БИШ ─────────────────────────────────────
 * Хүснэгт: нүд бүр ЭХЭЭС үг үсгээрээ (parsed/tables.jsonl, мөр↔утгыг геометрээр тулгасан бол tables_structured.jsonl).
 *   «Энэ хүснэгт юу хэлээд байна?» → хүснэгтийг ИШ ТАТСАН заалтууд (эх бичвэр) + баганын толгой + мөрүүд.  Нэгжийг
 *   ЗӨВХӨН баганын толгойд хэвлэгдсэн тэмдэгтээс (жишээ «P t, кПа»); толгойд байхгүй бол null — таамаглахгүй.
 * Томьёо: илэрхийлэл ЭХЭЭС, хувьсагчийн тайлбар ЗӨВХӨН заалтын бичвэрт «x – …» хэлбэрээр ил бичигдсэн бол.  Гүйцэтгэхгүй.
 */
const tableNoOf = (id) => String(id).replace(/^.*#T/, '');
const UNIT_IN_HEADER = /(кН\/м2|кН\/м²|кН\/м|кН|кПа|МПа|кгс\/м2|кг\/м3|Па|Гц|°С|0С|мм|см|м\/с|м2|м²)(?![\p{L}])/gu;
function headerSplit(rows, labelCol) {
  // Толгойн мөр = эхний «өгөгдөлгүй» мөрүүд: шошгоос бусад нүдэнд ЦИФРЭЭР эхэлсэн утга байхгүй, дугаарын нүд хоосон.
  let h = 0;
  while (h < rows.length) {
    const r = rows[h];
    const others = r.cells.filter((_, i) => i !== labelCol);
    const hasValue = others.some((c) => /^\s*[-–]?\d/.test(c) && !/^\s*\d+\.\s*$/.test(c));
    const numbered = (r.row_no && /^\d/.test(r.row_no)) || /^\s*\d{1,2}\.\s/.test(r.cells[labelCol] ?? '');
    const bodyLike = r.alignment === 'layout_baseline' || r.alignment === 'ambiguous_packed' || String(r.cells[labelCol] ?? '').length > 60;
    if (hasValue || numbered || bodyLike || /^\s*Тайлбар/u.test(r.cells[labelCol] ?? '')) break;
    h += 1;
  }
  return h;
}
const isNoteRow = (r) => /^\s*Тайлбар\s*[:.]?/u.test(r.cells.join(' ').trim()) && r.cells.filter((c) => c).length === 1;
const tableRecords = [];
for (const t of tables) {
  const no = tableNoOf(t.table_id);
  const st = tablesStructured.get(t.table_id);
  const useStructured = Boolean(st && st.structure === 'grid' && st.rows.length > 0);
  const labelColParsed = (() => {
    const mass = new Array(Math.max(1, ...t.rows.map((r) => r.length))).fill(0);
    for (const r of t.rows) r.forEach((c, i) => { mass[i] += (String(c).match(/\p{L}/gu) ?? []).length; });
    return mass.indexOf(Math.max(...mass));
  })();
  const rows = useStructured
    ? st.rows.map((r) => ({ row_no: r.row_no ?? null, group_path: r.group_path ?? [], label: r.label ?? r.cells[r.label_col] ?? '', cells: r.cells, label_col: r.label_col, alignment: r.alignment, page: r.page, continued_from_previous_page: r.continued_from_previous_page === true }))
    : t.rows.map((cells) => ({ row_no: null, group_path: [], label: cells[labelColParsed] ?? '', cells, label_col: labelColParsed, alignment: 'parsed_text', page: t.source_pdf_page, continued_from_previous_page: false }));
  const labelCol = rows[0]?.label_col ?? 0;
  const h = headerSplit(rows, labelCol);
  const header = rows.slice(0, h);
  const body = rows.slice(h).filter((r) => !isNoteRow(r) && r.cells.some((c) => String(c).trim()));
  const notes = [...(t.notes ?? []).filter((n) => n.length > 12), ...rows.slice(h).filter(isNoteRow).map((r) => r.cells.join(' ').trim())];
  const ncols = Math.max(1, ...rows.map((r) => r.cells.length), t.columns?.length ?? 0);
  const columns = [];
  for (let i = 0; i < ncols; i += 1) {
    const text = [t.columns?.[i] ?? '', ...header.map((r) => r.cells[i] ?? '')].map((x) => String(x).trim()).filter(Boolean).join(' ');
    const units = [...new Set([...text.matchAll(UNIT_IN_HEADER)].map((m) => m[1]))];
    columns.push({ index: i, header_text: text || null, unit: units.length === 1 ? units[0] : null, units_in_header: units, role: i === labelCol ? 'label' : 'value' });
  }
  const pat = new RegExp(`(?<![\\d.])${no.replace(/[.]/g, '\\.')}\\s*-?\\s*р?\\s*хүснэгт`, 'u');
  const referring = records.filter((r) => pat.test(r.source_text)).map((r) => ({ clause_uid: r.clause_uid, clause_id: r.clause_id, scope: r.scope, text: r.source_text, page: r.source.page }));
  tableRecords.push({
    type: 'table_explanation', schema_version: 'l2-table/1', norm_code: code, document_id: meta.doc_id,
    table_uid: t.table_id, table_no: no, chunk_id: `${meta.doc_id}:table:${no}`,
    caption: t.caption_raw ?? null, title_hint: t.title ?? null, title_source: t.title_source ?? null,
    // Хүснэгт хэвлэгдсэн байрлалын заалт (parser) — ИШЛЭЛ БИШ; эх бичвэр нь «N-р хүснэгт» гэж иш татсан заалт `referring_clauses`-д.
    clause_context: t.clause_context ?? null,
    referring_clauses: referring,
    columns, header_rows: header.map((r) => r.cells),
    rows: body.map((r, i) => ({ index: i, row_no: r.row_no, group_path: r.group_path, label: r.label, values: r.cells.filter((c, ci) => ci !== r.label_col && !(r.row_no && c === r.row_no)), cells: r.cells, alignment: r.alignment, page: r.page, continued_from_previous_page: r.continued_from_previous_page })),
    notes,
    structure: useStructured ? 'layout_grid' : 'parsed_text',
    row_alignment: { layout_baseline: body.filter((r) => r.alignment === 'layout_baseline').length, grid_cell: body.filter((r) => r.alignment === 'grid_cell').length, ambiguous_packed: body.filter((r) => r.alignment === 'ambiguous_packed').length, parsed_text: body.filter((r) => r.alignment === 'parsed_text').length },
    source: { page: t.source_page ?? null, pdf_page: t.source_pdf_page ?? null, url: sourceUrl, pdf_url: pdfUrl, document_sha256: docSha, extraction: t.extraction ?? null, verification: t.verification_status ?? null },
    verification: { source_text: t.verification_status ?? null, explanation: 'AUTO_DRAFT' },
    execution: { computable: false },
    generated_at: generatedAt,
  });
}
// Нүдний бичвэр бүр эх гаралтын (tables.jsonl / tables_structured.jsonl) бичвэрт байх ёстой (зайг үл тооцон) — эс тэгвэл зогсоно.
{
  const norm = (x) => String(x).replace(/\s+/g, '');
  const bag = norm([...tables.map((t) => t.rows.flat().join(' ')), ...readJsonl(join(dir, 'parsed', 'tables_structured.jsonl')).map((t) => t.rows.map((r) => r.cells.join(' ')).join(' '))].join(' '));
  for (const tr of tableRecords) for (const r of tr.rows) for (const c of r.cells) if (c && !bag.includes(norm(c))) throw new Error(`хүснэгтийн нүд эхэд алга: ${tr.table_uid} «${String(c).slice(0, 60)}»`);
}
stats.tables = tableRecords.length;
stats.table_rows = tableRecords.reduce((a, t) => a + t.rows.length, 0);
stats.table_rows_layout_baseline = tableRecords.reduce((a, t) => a + t.row_alignment.layout_baseline, 0);
stats.table_rows_ambiguous = tableRecords.reduce((a, t) => a + t.row_alignment.ambiguous_packed, 0);
stats.tables_with_unit_in_header = tableRecords.filter((t) => t.columns.some((c) => c.unit)).length;
stats.tables_with_referring_clause = tableRecords.filter((t) => t.referring_clauses.length > 0).length;

// Томьёо — хувьсагчийн тайлбар: заалтын бичвэрийг «;»-оор хуваагаад «<тэмдэг> – <тайлбар>» хэлбэрийн хэсэг л (тэмдэг нь
//   Кирилл ҮГ биш: ≤ 14 тэмдэгт, 3+ үсэгтэй жижиг кирилл үг агуулахгүй).  Бичвэр ЭХЭЭС үг үсгээрээ.
const clauseRecByNo = new Map(records.map((r) => [r.scope === 'appendix' ? `A${r.appendix}:${r.clause_id}` : r.clause_id, r]));
function variableDefinitions(text, fromIndex) {
  const out = [];
  for (const seg of text.slice(fromIndex).split(/;\s*/u)) {
    // Сегментийн эхэнд томьёоны шошго («(10.1) ce - …»), таслал/цэг байж болно — тэмдгийн хэсэг биш.
    const clean = seg.replace(/[.,]\s*$/u, '').replace(/^[\s,.;:]*(?:\(\s*\d{1,2}(?:\.\d{1,2}){1,2}\s*\)\s*[,.;:]?\s*)?/u, '');
    const m = /^\s*(?:.*?(?:Үүнд|Энд):\s*)?(\S(?:.{0,13}?\S)?)\s+[–-]\s*(\S.{2,260})$/u.exec(clean);
    if (!m) continue;
    const sym = m[1].trim();
    if (/[а-яөүё]{3,}/u.test(sym) || /^\d+$/.test(sym)) continue;
    const def = m[2].trim().replace(/\s*\(\d{1,2}(?:\.\d{1,2}){1,2}\)\s*$/u, '');
    if (!text.includes(def)) continue;
    out.push({ symbol: sym, definition: def, source: 'explicit_in_clause_text' });
  }
  return out;
}
const formulaRecords = formulas.map((f) => {
  const rec = f.clause ? (clauseRecByNo.get(f.clause) ?? null) : null;
  const text = rec?.source_text ?? '';
  const at = text.indexOf(`(${f.label})`);
  const vars = rec ? variableDefinitions(text, at >= 0 ? at : 0) : [];
  const symbols = [...new Set((f.variables ?? []).map((v) => String(v.symbol).replace(/[,;]$/, '')))];
  return {
    type: 'formula_explanation', schema_version: 'l2-formula/1', norm_code: code, document_id: meta.doc_id,
    formula_uid: f.formula_id, label: f.label, chunk_id: `${meta.doc_id}:formula:${f.label}`,
    expression: f.expression, expression_quality: f.expression_quality,
    clause_id: f.clause ?? null, clause_uid: rec?.clause_uid ?? null,
    variables_in_expression: symbols,
    variable_definitions: vars,
    units: f.units ?? [],
    source: { page: f.source_page ?? null, pdf_page: f.source_pdf_page ?? null, url: sourceUrl, pdf_url: pdfUrl, document_sha256: docSha, verification: f.verification_status ?? null },
    verification: { source_text: f.verification_status ?? null, explanation: 'AUTO_DRAFT' },
    execution: { computable: false },
    generated_at: generatedAt,
  };
});
stats.formulas = formulaRecords.length;
stats.formulas_clean = formulaRecords.filter((f) => f.expression_quality === 'text_layer_clean').length;
stats.formula_variable_definitions = formulaRecords.reduce((a, f) => a + f.variable_definitions.length, 0);
stats.enumerations = records.filter((r) => r.semantic_frame.enumeration).length;
stats.enumerations_membership = records.filter((r) => r.semantic_frame.enumeration?.kind === 'membership').length;

/* ── Баримт хоорондын холбоос (L0 бүртгэлийн ирмэгээс — зохиогдохгүй) ───────────────────────────────────────
 * ИРЭХ: өөр норм энэ баримтыг ШУУД эсвэл ХУУЧИН КОДООР (албан залгамжаар) иш татсан бол — эх ишлэл ХЭВЭЭР.
 * ГАРАХ: энэ баримт хуучин кодыг хүчингүй болгосон (supersedes), тайлбартай (commentary_of).
 */
const myKey = codeKey(code);
const superseded = new Set(registryRows.filter((r) => r.status === 'SUPERSEDED' && r.superseded_by && codeKey(r.superseded_by) === myKey).map((r) => r.code_key));
const incoming = [];
for (const e of registryRefs) {
  if (e.from_key === myKey) continue;
  if (e.relationship === 'commentary_of' || e.relationship === 'supersedes' || e.relationship === 'supersedes_unverified') continue;
  const toKey = e.to_registry_code ? codeKey(e.to_registry_code) : e.to_key;
  if (toKey === myKey) incoming.push({ from_code: e.from, from_clause: e.from_clause, from_locator: e.from_locator, original_reference_code: e.to_document, resolved_current_code: code, resolution: 'direct', relationship: e.relationship, context: e.context, source_page: e.source_page });
  else if (superseded.has(toKey)) {
    const old = registryRows.find((r) => r.code_key === toKey);
    incoming.push({ from_code: e.from, from_clause: e.from_clause, from_locator: e.from_locator, original_reference_code: e.to_document, resolved_current_code: code, resolution: 'via_official_supersession', resolution_basis: 'official_supersession_order', resolution_evidence: (old?.status_evidence ?? []).slice(0, 3), relationship: e.relationship, context: e.context, source_page: e.source_page });
  }
}
const crossDocumentLinks = {
  type: 'cross_document_links', schema_version: 'l2-links/1', norm_code: code, document_id: meta.doc_id,
  incoming,
  supersedes: registryRefs.filter((e) => e.from_key === myKey && (e.relationship === 'supersedes' || e.relationship === 'supersedes_unverified')).map((e) => ({ code: e.to_document, relationship: e.relationship, evidence: e.context })),
  commentaries: registryRefs.filter((e) => e.relationship === 'commentary_of' && codeKey(e.to_registry_code ?? e.to_document) === myKey).map((e) => ({ code: e.from, relationship: 'commentary_of', normative: false })),
  note: 'Холбоос бүр бүртгэлийн ирмэг (registry/references.jsonl) эсвэл албан залгамжийн нотолгооноос; сэдвийн ижил төстэй байдлаар ХОЛБООС ЗОХИОГДООГҮЙ.',
  generated_at: generatedAt,
};
stats.incoming_links = incoming.length;
stats.incoming_links_via_supersession = incoming.filter((x) => x.resolution === 'via_official_supersession').length;

const outDir = join(dir, 'l2');
const outputs = {
  'clause_explanations.jsonl': records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  'document_explanation.json': JSON.stringify(docExplanation, null, 2) + '\n',
  'section_explanations.jsonl': sectionExplanations.map((r) => JSON.stringify(r)).join('\n') + '\n',
};
// Хүснэгт/томьёо/холбоос — өгөгдөл байвал л файл үүснэ.
if (tableRecords.length > 0) outputs['table_explanations.jsonl'] = tableRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
if (formulaRecords.length > 0) outputs['formula_explanations.jsonl'] = formulaRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
if (incoming.length > 0 || crossDocumentLinks.supersedes.length > 0 || crossDocumentLinks.commentaries.length > 0) outputs['cross_document_links.json'] = JSON.stringify(crossDocumentLinks, null, 2) + '\n';
stats.generated_at = generatedAt;
stats.source_sha256 = docSha;
stats.clause_explanations_sha256 = sha256(outputs['clause_explanations.jsonl']);
outputs['stats.json'] = JSON.stringify(stats, null, 2) + '\n';

if (check) {
  let stale = false;
  for (const [f, body] of Object.entries(outputs)) {
    if (f === 'stats.json') continue;
    const p = join(outDir, f);
    const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
    if (cur.replace(/"generated_at": "[^"]+"/g, '').replace(/\r/g, '') !== body.replace(/"generated_at": "[^"]+"/g, '')) { stale = true; process.stderr.write(`  ✖ ${basename(p)} хуучирсан\n`); }
  }
  process.exit(stale ? 1 : 0);
}
mkdirSync(outDir, { recursive: true });
for (const [f, body] of Object.entries(outputs)) writeFileSync(join(outDir, f), body, 'utf8');
process.stdout.write(`L2 · ${code}: заалт ${stats.total_clauses} → тайлбар ${stats.success} (AUTO_DRAFT ${stats.auto_draft}, HUMAN_VERIFIED ${stats.human_verified}) · эх алга ${stats.missing_source} · хуудасгүй ${stats.missing_page} · ишлэл ${stats.cross_references_total} (шийдэгдээгүй ${stats.cross_reference_unresolved}) · давхар дугаар ${stats.ambiguous_clause_numbers} · төрөл ${JSON.stringify(stats.by_requirement_type)}${stats.candidates_total !== undefined ? ` · нэр дэвшигч ${stats.candidates_total}: PASS ${stats.candidates_pass} / FAIL ${stats.candidates_fail} ${JSON.stringify(stats.candidates_fail_by_code)}` : ''} · нэр томьёо ${stats.term_links} холбоос (${stats.definitions_linked} заалт)\n  → ${outDir}\n`);
