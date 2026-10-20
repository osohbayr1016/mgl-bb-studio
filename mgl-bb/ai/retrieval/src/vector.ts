/**
 * MGL AI · EMBEDDING БА ВЕКТОР ИНДЕКСИЙН ХИЙСВЭРЛЭЛ (§12).
 *
 * ⚠️ ЭНЭ ФАЙЛД ЯМАР Ч ЗАГВАР ХАТУУ БИЧИГДЭЭГҮЙ, ЗОРИУД.  §12: «Do not
 *    permanently lock the architecture to one embedding model.»  Embedding
 *    загвар солигдоход БҮХ вектор хүчингүй болно — тэр нь `ai_chunk_vectors`
 *    хүснэгтийг хоослох ажил бөгөөд `ai_chunks`, FTS5, дүрмийн хүснэгт
 *    ХӨНДӨГДӨХГҮЙ.  Тиймээс `embedding_model` нь мөр тутамд хадгалагдана.
 *
 * ⚠️ ТӨЛБӨРТЭЙ ВЕКТОР САН ХОРИОТОЙ (§12).  Pinecone, Weaviate Cloud,
 *    OpenAI embeddings — аль нь ч энд орохгүй.  Хэрэгжүүлэлт нь ЛОКАЛ
 *    байх ёстой: sqlite-vec, эсвэл цэвэр JS-ийн cosine скан.
 *
 * ⚠️ ӨНӨӨДРИЙН БОДИТ БАЙДАЛ: `node:sqlite`-ийн build-д `vec0` модуль
 *    БАЙХГҮЙ (хэмжсэн 2026-09-08) ба локал embedding загвар хараахан
 *    суулгаагүй.  Тиймээс `NullVectorIndex` нь өгөгдмөл — тэр нь ХООСОН
 *    жагсаалт буцаана, RRF нь үлдсэн хоёр хөлөөр (бүтэцтэй + FTS)
 *    ажиллана.  ЭНЭ НЬ ХУУРАМЧ ХЭРЭГЖҮҮЛЭЛТ БИШ: `available` нь `false`
 *    гэж ӨӨРИЙГӨӨ ЗАРЛАДАГ тул үнэлгээний тайлан «вектор хөл унтарсан»
 *    гэдгийг ил бичнэ.
 */

export interface EmbeddingEngine {
  /** Загварын танигч — вектор бүрд хадгалагдана. */
  readonly model: string;
  readonly dim: number;
  readonly available: boolean;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

export interface VectorHit {
  chunkId: string;
  /** 0..1, өндөр нь ойр. */
  score: number;
}

export interface VectorIndex {
  readonly name: string;
  readonly available: boolean;
  upsert(rows: ReadonlyArray<{ chunkId: string; embedding: Float32Array }>): Promise<void>;
  search(query: Float32Array, limit: number): Promise<VectorHit[]>;
  /** Загвар солигдоход — БҮХ вектор хүчингүй. */
  clear(): Promise<void>;
}

/**
 * Вектор хөлгүй горим.
 *
 * ⚠️ ЭНЭ НЬ «ХИЙСЭН ДҮР ЭСГЭХ» БИШ.  Хуурамч оноо буцаах нь RRF-ийг
 *    хордуулж, хайлтыг САЙЖРУУЛСАН мэт харагдуулна.  Хоосон буцаах нь
 *    хэмжигдэх, ил тод доройтол.
 */
export class NullVectorIndex implements VectorIndex {
  readonly name = 'null';
  readonly available = false;

  async upsert(): Promise<void> {
    /* вектор хадгалахгүй */
  }

  async search(): Promise<VectorHit[]> {
    return [];
  }

  async clear(): Promise<void> {
    /* хоослох зүйлгүй */
  }
}

/** Загваргүй горим — `available: false`, `embed` нь ХЭЗЭЭ Ч дуудагдахгүй. */
export class NullEmbeddingEngine implements EmbeddingEngine {
  readonly model = 'none';
  readonly dim = 0;
  readonly available = false;

  async embed(): Promise<Float32Array[]> {
    // ⚠️ Тэг вектор буцаах нь БҮХ зүйлийг ижил зайтай болгож хайлтыг
    //    санамсаргүй дараалал болгоно.  Дуудагч `available`-ыг шалгах
    //    ёстой; шалгаагүй бол энэ нь ЧАНГА унана.
    throw new Error('Embedding загвар суулгаагүй байна (§12).  `available`-ыг эхлээд шалга.');
  }
}
