#!/usr/bin/env node
/**
 * `npm run ai:eval:retrieval [-- --url http://127.0.0.1:39219 --model bge-m3-Q8_0 --json <out>]`
 *
 * ХАЙЛТЫН ГОРИМУУДЫН ХАРЬЦУУЛАЛТ (§14, §15): lexical · vector · hybrid.
 *
 * Хэмждэг зүйл (723 QA тест + hard negative):
 *   Recall@1/3/5, MRR      — хүлээгдэж буй хэсэг эхний 1/3/5-д, эрэмбийн урвуу дундаж
 *   wrong-document rate    — эхний хэсэг ӨӨР баримтаас
 *   wrong-clause rate      — зөв баримт, буруу заалт (эхний хэсэг)
 *   NO_MATCH precision     — «олдсонгүй» гэсний хэд нь ҮНЭХЭЭР олдох ёсгүй
 *   NO_MATCH recall        — олдох ёсгүйн хэд нь «олдсонгүй» гэв
 *   хатуу сөрөг            — ижил үгтэй өөр салбар, байхгүй баримт, ERP үг
 *
 * ⚠️ HYBRID-ИЙГ «ДЭВШИЛТТЭЙ СОНСОГДОХ» ГЭЖ СОНГОХГҮЙ — зөвхөн энэ тайлан
 *    сайжруулсан гэж хэлбэл (§14).  Тайлан бүр benchmarks/-д хадгалагдана.
 *
 * ⚠️ Вектор сервер байхгүй бол vector/hybrid нь lexical-тай ИЖИЛ гарна —
 *    тайлан үүнийг ил бичнэ (\`vector_available\`).
 */
import { resolve, dirname, join } from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../runtime/src/config.ts';
import { openKnowledgeDb } from '../retrieval/src/db.ts';
import { askNorm, vectorCandidates } from '../retrieval/src/pipeline.ts';
import { LlamaServerEmbedding, SqliteCosineIndex } from '../retrieval/src/vectorLocal.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? d);
};
const cfg = loadConfig();
const dbPath = resolve(flag('db', cfg.knowledgeDb));
if (!existsSync(dbPath)) {
  process.stderr.write(`\n  ✖ Мэдлэгийн сан олдсонгүй: ${dbPath}\n\n`);
  process.exit(1);
}
const db = openKnowledgeDb({ path: dbPath });
const url = flag('url', process.env.MGLAI_EMBED_URL ?? 'http://127.0.0.1:39219');
const model = flag('model', process.env.MGLAI_EMBED_MODEL ?? 'bge-m3-Q8_0');
const minScore = Number(flag('min-score', '0.45'));
const vectorRole = flag('vector-role', 'rerank');
const embedder = new LlamaServerEmbedding({ baseUrl: url, model });
const vectorAvailable = await embedder.probe();
const index = new SqliteCosineIndex(db, model);

/* ── Тест олонлог ─────────────────────────────────────────────────── */
const ruleChunk = new Map();
for (const r of db.prepare('SELECT rule_id, chunk_id FROM ai_rules').all()) ruleChunk.set(r.rule_id, r.chunk_id);
const chunkDoc = new Map();
for (const r of db.prepare('SELECT chunk_id, doc_id FROM ai_chunks').all()) chunkDoc.set(r.chunk_id, r.doc_id);

const positives = db
  .prepare('SELECT query, language, expected_chunk_id, expected_rule_id, doc_id FROM ai_query_tests')
  .all()
  .map((t) => ({ ...t, expected: t.expected_chunk_id ?? (t.expected_rule_id ? ruleChunk.get(t.expected_rule_id) ?? null : null) }))
  .filter((t) => t.expected !== null);

/**
 * ХАТУУ СӨРӨГ (§15) — корпуст БАЙХГҮЙ сэдэв, гэвч үг давхцана.
 * ⚠️ Шинэ багц шингэвэл тухайн мөрийг ХАСНА (тэр үед олдох нь зөв).
 */
const HARD_NEGATIVES = [
  // ижил үгтэй өөр салбар
  ['Хамгийн хоцорсон таскууд юу байна', 'erp-vocab'],
  ['Манай компанид хэдэн ажилтан байна', 'erp-vocab'],
  ['Deadline hamgiin oir project ali ve', 'erp-vocab'],
  ['Төслийн менежер ажилтнуудын ачааллыг хэрхэн хуваарилах вэ', 'erp-vocab'],
  // байхгүй баримт, ижил төстэй нэр
  ['БНбД 21-01-02-ын эвакуацын гарцын хамгийн бага өргөн хэд вэ', 'missing-doc-similar-name'],
  ['MNS 6541:2015 стандартын шаардлага юу вэ', 'missing-doc'],
  ['Лифтний хонгилын хананы галд тэсвэрлэх хугацаа хэдэн цаг байх ёстой вэ', 'missing-topic-fire-vocab'],
  ['Дулаан тусгаарлагчийн зузаан хэдэн мм байх вэ', 'missing-topic'],
  // ерөнхий / мэндчилгээ
  ['Сайн байна уу, чи юу хийж чадах вэ', 'general'],
  ['Excel файлыг PDF болгож өгөөч', 'general'],
  // өөр салбарын «дүрэм»
  ['Цалингийн орлогын албан татвар хэдэн хувь вэ', 'other-domain-rule'],
  ['Автомашины улсын дугаар солих журам', 'other-domain-rule'],
  ['Хөдөлмөрийн гэрээний туршилтын хугацаа хэдэн сар вэ', 'other-domain-rule'],
];

/* ── Хэмжилт ──────────────────────────────────────────────────────── */
async function runMode(mode) {
  const res = { mode, n: positives.length, r1: 0, r3: 0, r5: 0, mrr: 0, wrongDoc: 0, wrongClause: 0, noMatchOnPositive: 0, byLang: {} };
  const embedCache = new Map();
  const vc = async (q) => {
    if (mode === 'lexical' || !vectorAvailable || !index.available) return [];
    if (!embedCache.has(q)) embedCache.set(q, await vectorCandidates(embedder, index, q, 20, minScore));
    return embedCache.get(q);
  };
  const t0 = Date.now();
  for (const t of positives) {
    const a = askNorm(db, t.query, { evidenceLimit: 5, mode, vectorRole, vectorCandidates: await vc(t.query) });
    const ids = a.evidence.map((e) => e.chunk_id);
    const pos = ids.indexOf(t.expected);
    const L = (res.byLang[t.language] ??= { n: 0, r5: 0, r1: 0 });
    L.n += 1;
    if (a.status === 'insufficient_evidence') res.noMatchOnPositive += 1;
    if (pos === 0) { res.r1 += 1; L.r1 += 1; }
    if (pos >= 0 && pos < 3) res.r3 += 1;
    if (pos >= 0 && pos < 5) { res.r5 += 1; L.r5 += 1; }
    if (pos >= 0) res.mrr += 1 / (pos + 1);
    if (ids.length > 0 && pos !== 0) {
      if (chunkDoc.get(ids[0]) !== chunkDoc.get(t.expected)) res.wrongDoc += 1;
      else res.wrongClause += 1;
    }
  }
  res.ms = Date.now() - t0;
  // NO_MATCH: negatives
  res.negatives = [];
  let tn = 0;
  for (const [q, kind] of HARD_NEGATIVES) {
    const a = askNorm(db, q, { evidenceLimit: 5, mode, vectorRole, vectorCandidates: await vc(q) });
    const ok = a.status === 'insufficient_evidence';
    if (ok) tn += 1;
    res.negatives.push({ q, kind, ok, status: a.status, cite: a.citation?.label_mn ?? null });
  }
  // precision = (олдсонгүй гэсэн ба үнэхээр сөрөг) / (олдсонгүй гэсэн бүх) ;
  // recall = сөрөгийн хэд нь олдсонгүй гэв
  const said = tn + res.noMatchOnPositive;
  res.noMatchPrecision = said === 0 ? null : tn / said;
  res.noMatchRecall = tn / HARD_NEGATIVES.length;
  return res;
}

const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);
const modes = vectorAvailable && index.available ? ['lexical', 'vector', 'hybrid'] : ['lexical'];
const results = [];
process.stdout.write(`\nMGL AI · хайлтын горимын харьцуулалт\n  сан: ${dbPath}\n  вектор: ${vectorAvailable && index.available ? `${model} (${index.size} вектор, dim ${embedder.dim}, босго ${minScore}, үүрэг ${vectorRole})` : 'БАЙХГҮЙ — зөвхөн lexical'}\n  эерэг тест: ${positives.length} · хатуу сөрөг: ${HARD_NEGATIVES.length}\n`);
for (const mode of modes) {
  const r = await runMode(mode);
  results.push(r);
  process.stdout.write(`\n── ${mode.toUpperCase()}  (${r.ms} мс)\n`);
  process.stdout.write(`   Recall@1 ${pct(r.r1, r.n)}%  Recall@3 ${pct(r.r3, r.n)}%  Recall@5 ${pct(r.r5, r.n)}%  MRR ${(r.mrr / r.n).toFixed(3)}\n`);
  process.stdout.write(`   буруу баримт (top-1) ${pct(r.wrongDoc, r.n)}%  буруу заалт (top-1) ${pct(r.wrongClause, r.n)}%  эерэгт «олдсонгүй» ${r.noMatchOnPositive}\n`);
  process.stdout.write(`   NO_MATCH precision ${r.noMatchPrecision === null ? '—' : pct(r.noMatchPrecision, 1) + '%'}  recall ${pct(r.noMatchRecall, 1)}%  (${r.negatives.filter((x) => x.ok).length}/${HARD_NEGATIVES.length})\n`);
  for (const [lang, L] of Object.entries(r.byLang)) process.stdout.write(`     ${lang.padEnd(8)} R@1 ${pct(L.r1, L.n)}%  R@5 ${pct(L.r5, L.n)}%  (${L.n})\n`);
  const bad = r.negatives.filter((x) => !x.ok);
  if (bad.length) for (const b of bad) process.stdout.write(`     ✖ [${b.kind}] «${b.q.slice(0, 50)}» → ${b.status} ${b.cite ?? ''}\n`);
}

/* ── Шийдвэр ──────────────────────────────────────────────────────── */
if (results.length === 3) {
  const [lex, , hyb] = results;
  const better = hyb.r5 >= lex.r5 && hyb.mrr >= lex.mrr && hyb.noMatchRecall >= lex.noMatchRecall && hyb.wrongDoc <= lex.wrongDoc;
  process.stdout.write(`\n── ДҮГНЭЛТ: hybrid нь lexical-аас ${better ? 'ДОРДООГҮЙ (R@5, MRR, NO_MATCH recall, буруу баримт) — ашиглаж болно' : 'аль нэг хэмжүүрээр ДОРДСОН — өгөгдмөлөөр асаахгүй'}\n`);
}
const out = flag('json', null) ?? join(HERE, 'benchmarks', `retrieval-modes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ measured_at: new Date().toISOString(), db: dbPath, vector_available: vectorAvailable && index.available, model, min_score: minScore, vector_role: vectorRole, results }, null, 2), 'utf8');
process.stdout.write(`\n  → ${out}\n\n`);
