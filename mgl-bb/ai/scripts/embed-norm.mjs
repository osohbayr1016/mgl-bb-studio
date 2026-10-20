#!/usr/bin/env node
/**
 * `npm run ai:embed:norm [-- --url http://127.0.0.1:39219 --model bge-m3-Q8_0 --force]`
 *
 * НОРМЫН ХЭСГҮҮДИЙГ ЛОКАЛ EMBEDDING-ЭЭР ВЕКТОРЖУУЛНА (§12, §14 — вектор хөл).
 *
 * ⚠️ Embedding нь ЛОКАЛ llama-server (`--embeddings`, bge-m3 GGUF, MIT):
 *      llama-server -m bge-m3-Q8_0.gguf --embeddings --pooling cls -ngl 0 -c 2048 -b 2048 -ub 2048 --port 39219
 *    Төлбөртэй embedding API ХОРИОТОЙ (§12).
 *
 * ⚠️ ИДЕМПОТЕНТ: аль хэдийн тухайн загвараар векторжсон хэсгийг алгасна
 *    (`--force` бол дахин).  Загвар солигдвол ӨӨР `embedding_model`-той мөр
 *    үүснэ; хуучин нь харьцуулагдахгүй (`SqliteCosineIndex` загвараар шүүнэ).
 *
 * ⚠️ Мэдлэг ≠ жин: энэ нь ХАЙЛТЫН индекс, сургалт БИШ.
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig } from '../runtime/src/config.ts';
import { openKnowledgeDb } from '../retrieval/src/db.ts';
import { LlamaServerEmbedding, SqliteCosineIndex } from '../retrieval/src/vectorLocal.ts';

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
const url = flag('url', process.env.MGLAI_EMBED_URL ?? 'http://127.0.0.1:39219');
const model = flag('model', process.env.MGLAI_EMBED_MODEL ?? 'bge-m3-Q8_0');
const force = argv.includes('--force');

const db = openKnowledgeDb({ path: dbPath });
const embedder = new LlamaServerEmbedding({ baseUrl: url, model });
if (!(await embedder.probe())) {
  process.stderr.write(`\n  ✖ Embedding сервер хариулсангүй: ${url}\n    llama-server --embeddings -m bge-m3-Q8_0.gguf --pooling cls -ngl 0 --port 39219\n\n`);
  process.exit(1);
}
const index = new SqliteCosineIndex(db, model);

const rows = db
  .prepare(
    `SELECT c.chunk_id, c.text_mn, c.section_path, c.clause_no, c.table_no, c.row_no, d.code, d.title_mn
       FROM ai_chunks c JOIN ai_documents d ON d.doc_id = c.doc_id
      ${force ? '' : 'WHERE c.chunk_id NOT IN (SELECT chunk_id FROM ai_chunk_vectors WHERE embedding_model = ?)'}
      ORDER BY c.chunk_id`,
  )
  .all(...(force ? [] : [model]));

process.stdout.write(`\nMGL AI · вектор индекс · ${model} @ ${url} · dim ${embedder.dim}\n  хэсэг: ${rows.length} (${force ? 'бүгд' : 'шинэ'}), аль хэдийн: ${index.size}\n`);
const t0 = Date.now();
let done = 0;
const BATCH = 8;
for (let i = 0; i < rows.length; i += BATCH) {
  const slice = rows.slice(i, i + BATCH);
  // ⚠️ Баримтын код + хэсгийн зам + текст — бүтэцгүй ганц текст нь «заалт 3.5»
  //    гэсэн лавлагааг алдана.  Хайлтын асуулт ч мөн ижил хэлбэргүй тул
  //    кодыг ЭХЭНД богиноор л тавина.
  const texts = slice.map((r) => `${r.code}${r.section_path ? ` · ${r.section_path}` : ''}${r.clause_no ? ` · заалт ${r.clause_no}` : ''}${r.table_no !== null ? ` · хүснэгт ${r.table_no}${r.row_no ? ` мөр ${r.row_no}` : ''}` : ''}\n${r.text_mn}`);
  const vecs = await embedder.embed(texts);
  await index.upsert(slice.map((r, k) => ({ chunkId: r.chunk_id, embedding: vecs[k] })));
  done += slice.length;
  process.stdout.write(`\r  ${done}/${rows.length}  ${Math.round((Date.now() - t0) / 1000)}с`);
}
process.stdout.write(`\n  → ${index.size} вектор (${Math.round((Date.now() - t0) / 1000)}с)\n\n`);
