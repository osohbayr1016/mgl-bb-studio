/**
 * MGL AI · ЛОКАЛ EMBEDDING + COSINE ИНДЕКС (§12, §14 — вектор хөл).
 *
 * ⚠️ ТӨЛБӨРГҮЙ, ЛОКАЛ.  Embedding нь ажилтны PC дээрх llama-server-ийн
 *    `/embedding` (bge-m3 GGUF, MIT лиценз, олон хэл — монгол орно), CPU
 *    дээр (`-ngl 0`) — 8B загварын VRAM-тай өрсөлдөхгүй.  Вектор нь
 *    `ai_chunk_vectors`-д BLOB-оор, хайлт нь цэвэр JS cosine скан
 *    (245 хэсэгт <1 мс; 10 000 хэсэгт ч ~10 мс — sqlite-vec хэрэггүй).
 *
 * ⚠️ ЗАГВАРЫН НЭР МӨР БҮРД (`embedding_model`).  Загвар солигдвол
 *    тухайн нэрийн мөрүүд Л хүчинтэй; өөр нэртэй мөр ХЭЗЭЭ Ч харьцуулагдахгүй.
 *
 * ⚠️ БАЙХГҮЙ БОЛ ИЛ ТОД УНТАРНА.  Сервер хариулахгүй / хүснэгт хоосон бол
 *    `available=false` — RRF үлдсэн хөлөөр явна, хуурамч оноо ХЭЗЭЭ Ч
 *    буцаахгүй (`vector.ts`-ийн зарчим).
 */
import type { DatabaseSync } from 'node:sqlite';
import type { EmbeddingEngine, VectorHit, VectorIndex } from './vector.ts';

/* ── llama-server /embedding ────────────────────────────────────── */

export interface LlamaEmbedOptions {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

export class LlamaServerEmbedding implements EmbeddingEngine {
  readonly model: string;
  dim = 0;
  available = false;
  readonly #base: string;
  readonly #timeout: number;

  constructor(opts: LlamaEmbedOptions) {
    this.model = opts.model;
    this.#base = opts.baseUrl.replace(/\/$/, '');
    this.#timeout = opts.timeoutMs ?? 20_000;
  }

  /** Сервер амьд эсэхийг НЭГ жижиг embed-ээр шалгаж, `dim`-ийг тогтооно. */
  async probe(): Promise<boolean> {
    try {
      const [v] = await this.embed(['probe']);
      this.dim = v?.length ?? 0;
      this.available = this.dim > 0;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    // llama-server нь массив хүлээж авдаг ч урт текстэд нэг нэгээр илгээх нь
    // алдааг тусгаарлана (нэг хэсэг хэт урт бол бусад нь унахгүй).
    for (const text of texts) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.#timeout);
      try {
        const res = await fetch(`${this.#base}/embedding`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text.slice(0, 6000) }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`embedding HTTP ${res.status}`);
        const json = (await res.json()) as unknown;
        out.push(normalize(extractEmbedding(json)));
      } finally {
        clearTimeout(timer);
      }
    }
    return out;
  }
}

/** llama-server-ийн хоёр хэлбэрийг хоёуланг нь уншина: `[{embedding:[..]}]` ба `{embedding:[..]}`. */
function extractEmbedding(json: unknown): number[] {
  const first = Array.isArray(json) ? json[0] : json;
  const emb = (first as { embedding?: unknown })?.embedding;
  // pooling байхгүй үед `embedding` нь [[...]] (токен тутам) байж болно — эхнийхийг авна.
  const flat = Array.isArray(emb) && Array.isArray(emb[0]) ? (emb[0] as unknown[]) : emb;
  if (!Array.isArray(flat) || flat.length === 0) throw new Error('embedding хариу хоосон');
  return flat.map((x) => Number(x));
}

function normalize(v: number[]): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return Float32Array.from(v, (x) => x / n);
}

/* ── SQLite BLOB + cosine скан ──────────────────────────────────── */

export class SqliteCosineIndex implements VectorIndex {
  readonly name = 'sqlite-cosine';
  available = false;
  readonly #db: DatabaseSync;
  readonly #model: string;
  #rows: { chunkId: string; v: Float32Array }[] = [];

  constructor(db: DatabaseSync, model: string) {
    this.#db = db;
    this.#model = model;
    this.reload();
  }

  /** Санах ойд ачаална — ингээд хайлт бүр диск уншихгүй. */
  reload(): void {
    const rows = this.#db
      .prepare('SELECT chunk_id, dim, embedding FROM ai_chunk_vectors WHERE embedding_model = ?')
      .all(this.#model) as Array<{ chunk_id: string; dim: number; embedding: Uint8Array }>;
    this.#rows = rows.map((r) => ({
      chunkId: r.chunk_id,
      v: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.dim),
    }));
    this.available = this.#rows.length > 0;
  }

  get size(): number {
    return this.#rows.length;
  }

  async upsert(rows: ReadonlyArray<{ chunkId: string; embedding: Float32Array }>): Promise<void> {
    const stmt = this.#db.prepare(
      'INSERT OR REPLACE INTO ai_chunk_vectors (chunk_id, embedding_model, dim, embedding) VALUES (?, ?, ?, ?)',
    );
    for (const r of rows) {
      stmt.run(r.chunkId, this.#model, r.embedding.length, Buffer.from(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength));
    }
    this.reload();
  }

  async search(query: Float32Array, limit: number): Promise<VectorHit[]> {
    return this.searchSync(query, limit);
  }

  searchSync(query: Float32Array, limit: number): VectorHit[] {
    const hits: VectorHit[] = [];
    for (const r of this.#rows) {
      if (r.v.length !== query.length) continue;
      let dot = 0;
      for (let i = 0; i < query.length; i++) dot += r.v[i]! * query[i]!;
      hits.push({ chunkId: r.chunkId, score: dot });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  async clear(): Promise<void> {
    this.#db.prepare('DELETE FROM ai_chunk_vectors WHERE embedding_model = ?').run(this.#model);
    this.reload();
  }
}
