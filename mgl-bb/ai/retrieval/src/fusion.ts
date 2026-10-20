/**
 * MGL AI · RECIPROCAL RANK FUSION (§11-ийн «RRF»).
 *
 * ⚠️ ЯАГААД ОНООГ ШУУД НЭМЖ БОЛОХГҮЙ ВЭ.  BM25 нь СӨРӨГ (−12.4), cosine
 *    нь 0..1, бүтэцтэй таарц нь оноогүй.  Тэднийг нэмэх нь BM25-ийг
 *    давамгайлуулж, вектор ба бүтэцтэй хөлийг үр дүнгүй болгоно.  RRF нь
 *    ЗӨВХӨН ЭРЭМБЭ иднэ — тиймээс хөлүүд харьцуулагдахгүй нэгжтэй байж
 *    болно.  Энэ нь RRF-ийн ганц бөгөөд гол шалтгаан.
 *
 * ⚠️ k = 60 нь Cormack нарын анхны ажлын утга.  Багасгавал эхний мөр
 *    хэт давамгайлж, өсгөвөл бүх хөл ижилсэнэ.  ХЭМЖИЛТГҮЙГЭЭР БҮҮ СОЛЬ —
 *    `evaluation/norm-golden.mjs` нь Recall@5-ыг хэмждэг, өөрчлөхөөсөө
 *    өмнө тэрийг ажиллуулж дараа нь харьцуул.
 */
import type { Candidate } from './search.ts';

export const RRF_K = 60;

export interface FusedHit {
  chunkId: string;
  score: number;
  /** Аль хөлүүд олсон — оношилгоо ба тайлбарт. */
  legs: Array<{ leg: Candidate['leg']; rank: number }>;
}

/**
 * ⚠️ ХӨЛИЙН ЖИН.  Бүтэцтэй таарц нь хэрэглэгчийн ШУУД нэрлэсэн хаяг тул
 *    хамгийн өндөр — гэвч ХЯЗГААРГҮЙ биш: буруу бичсэн хүснэгтийн дугаар
 *    нь FTS-ийн зөв хариуг дарж БОЛОХГҮЙ.  3.0 нь ~2 байрын давуу тал
 *    өгнө, бүрэн дийлэнх биш.
 */
const LEG_WEIGHT: Readonly<Record<Candidate['leg'], number>> = {
  structured: 3.0,
  // ⚠️ ALIAS нь АНГЛИ асуултын ЦОРЫН ГАНЦ хөл — тэнд FTS нь 0 оноотой
  //    (монгол индекст англи үг байхгүй).  Тиймээс жин нь FTS-ээс өндөр
  //    байх ёстой, эс тэгвэл англи хайлт хэвээрээ үхмэл.  Гэвч 3.0
  //    (бүтэцтэй) хүртэл өсгөх нь монгол асуултад ерөнхий alias-ыг яг
  //    таарсан бичвэрээс дээгүүр тавина — 2.0 нь хэмжигдсэн буулт.
  alias: 2.0,
  // ⚠️ НӨХЦӨЛ нь хамгийн ялгамжтай дохио (галын ангилал, тэсвэршилтийн
  //    зэрэг) ч ЗӨВХӨН хэрэглэгч түүнийг өгсөн үед.  Хэт өндөр жин нь
  //    хэрэглэгчийн бичсэн ҮГИЙГ бүрэн дарна.
  context: 2.5,
  fts: 1.0,
  vector: 1.0,
  // Бүлгийн гарчгийн хөл (`sectionCandidates`) — FTS-тэй ижил жин: зөвхөн олдоогүй бүлгийг нэр дэвшүүлнэ,
  //    FTS-ийн шууд таарцыг дарахгүй.
  section: 1.0,
};

export function rrfFuse(legs: ReadonlyArray<readonly Candidate[]>, k = RRF_K): FusedHit[] {
  const acc = new Map<string, FusedHit>();

  for (const leg of legs) {
    for (const c of leg) {
      const entry = acc.get(c.chunkId) ?? { chunkId: c.chunkId, score: 0, legs: [] };
      entry.score += LEG_WEIGHT[c.leg] / (k + c.rank);
      entry.legs.push({ leg: c.leg, rank: c.rank });
      acc.set(c.chunkId, entry);
    }
  }

  return [...acc.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // ⚠️ ТОГТВОРТОЙ ЭРЭМБЭ.  Тэнцүү оноотой үед chunk_id-аар эрэмбэлэх нь
    //    үнэлгээг давтагдах боломжтой болгоно — Map-ийн дараалалд найдвал
    //    Recall@5 нь ажиллуулалт бүрд хэлбэлзэнэ.
    return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
  });
}
