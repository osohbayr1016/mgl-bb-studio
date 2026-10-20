/**
 * Тарифын хайлт — БД 81-16-20/2020, заалт 4.20, Хүснэгт 9.
 *
 * Хоёр л зүйл хийнэ:
 *   1. PM-ийн бичсэн ТӨВӨГШЛИЙН нэрийг дотоод код болгоно (`normalizeComplexity`).
 *   2. `(талбай, төвөгшил)` хосоос м²-ийн үнийг олно (`makeTariffFn`).
 *
 * Хоёулаа ЦЭВЭР — сүлжээ, React мэдэхгүй. `hooks/useQuoteSheet.ts` тарифын
 * мөрүүдийг татаад энэ файлаас функц бэлдэж томьёоны хөдөлгүүрт тарина
 * (`TARIF(талбай; төвөгшил)`).
 */
import { COMPLEXITY_BY_MN, type TariffComplexity, type TariffRow } from '../types/quotes';

/** Дотоод кодууд — хэрэглэгч кодоор нь шууд бичсэн ч хүлээж авна. */
const CODES: readonly string[] = ['zovshoorolgui', 'baga', 'dund', 'ondor', 'ontsgoi'];

/**
 * Түлхүүр үгийн хайлт — PM «Өндөр зэргийн төвөгшилтэй» гэх мэт БҮТЭН ӨГҮҮЛБЭР
 * бичдэг тул яг таарах жагсаалт хангалтгүй.
 *
 * ⚠️ ДАРААЛАЛ нь гэрээний хэсэг (эхний таарсан нь хожино):
 *   1. 'зөвшөөрөлгүй'  → zovshoorolgui
 *   2. 'шаардлагагүй'  → zovshoorolgui  («Барилгын ажлын зөвшөөрөл шаардлагагүй»
 *                                        буюу COMPLEXITY_LABEL_MN-ийн бүтэн шошго)
 *   3. 'онцгой'        → ontsgoi
 *   4. 'өндөр'         → ondor
 *   5. 'дунд'          → dund
 *   6. 'бага'          → baga
 *
 * «онцгой» нь «бага»-аас ӨМНӨ шалгагдана. Одоогийн үгсэд бодит мөргөлдөөн
 * байхгүй ч (‹онцгой› дотор ‹бага› алга) шошго өөрчлөгдвөл энэ дараалал л
 * хамгаална — тиймээс дараалал руу гар хүрэхээсээ өмнө бүх шошгыг дахин шалга.
 *
 * ⚠️ АНГЛИ түлхүүр үгс — англи хэлт саналын (`quotes.lang === 'en'`) орчуулсан
 * төвөгшлийн сонголтод. Эдгээр нь орчуулгын толийн (`backend/src/lib/
 * quoteTranslate.ts`) "Low/Medium/High/Special complexity" ба "No construction
 * permit required" мөрүүдтэй ХОСЛОЛ — толь өөрчлөгдвөл энд ЗЭРЭГ өөрчил, эс
 * бөгөөс англи хуудсан дээр `TARIF()` `#ТАРИФ!` болно. Мөн урт/тодорхой нь
 * түрүүлж шалгагдана (монгол жагсаалттай ижил зарчим).
 */
const KEYWORDS: ReadonlyArray<readonly [string, TariffComplexity]> = [
  ['зөвшөөрөлгүй', 'zovshoorolgui'],
  ['шаардлагагүй', 'zovshoorolgui'],
  ['онцгой', 'ontsgoi'],
  ['өндөр', 'ondor'],
  ['дунд', 'dund'],
  ['бага', 'baga'],
  // Англи — normalizeComplexity нь lowercase хийдэг тул жижиг үсгээр.
  ['no construction permit', 'zovshoorolgui'], // "No construction permit required" (толийн бүтэн шошго)
  ['permit not required', 'zovshoorolgui'],
  ['no permit', 'zovshoorolgui'],
  ['special', 'ontsgoi'],
  ['high', 'ondor'],
  ['medium', 'dund'],
  ['moderate', 'dund'],
  ['low', 'baga'],
];

/**
 * Хэрэглэгчийн бичсэн төвөгшлийн зэргийг дотоод код болгоно.
 * Танихгүй бол `null` → дуудагч тал `#ТАРИФ!` гаргана.
 */
export function normalizeComplexity(raw: unknown): TariffComplexity | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (s === '') return null;
  // 1. Дотоод код ('ondor').
  if (CODES.includes(s)) return s as TariffComplexity;
  // 2. Яг таарсан монгол үг ('өндөр').
  const exact = COMPLEXITY_BY_MN[s];
  if (exact) return exact;
  // 3. Бүтэн өгүүлбэр дотроос түлхүүр үг ('Өндөр зэргийн төвөгшилтэй').
  for (const [needle, code] of KEYWORDS) {
    if (s.includes(needle)) return code;
  }
  return null;
}

/** Нэг төвөгшлийн шатлал — `area_max` өсөх дарааллаар. */
interface Bracket {
  areaMax: number;
  rate: number;
}

/**
 * Тарифын мөрүүдээс `TARIF(талбай; төвөгшил)`-ийн хэрэгжилтийг бэлдэнэ.
 *
 * ⚠️ ДЭЭШ бөөрөнхийлнө: тухайн төвөгшлийн мөрүүдээс `area_max >= area` болох
 * ХАМГИЙН БАГА `area_max`-тайг сонгоно (1,200 м² → 1500-ын мөр → 25,161 ₮).
 *
 * ⚠️ КАТАЛОГИЙН ДЭЭД ШАТЛАЛААС ДАВСАН ТАЛБАЙ → СҮҮЛИЙН ШАТЛАЛЫН ХАНШ.
 * Хүснэгт 9 нь төвөгшил тус бүрээр тасардаг (онцгой/өндөр 50,000 м², дунд
 * 40,000, бага 15,000, зөвшөөрөлгүй 400) ба түүнээс дээш үнэ нийтлээгүй.
 * MGL-ийн шийдвэр (2026-08-19): тэр цэгээс цааш СҮҮЛИЙН мөрийн ханшийг
 * тогтмолоор үргэлжлүүлнэ — 50,000 ч бай, 60,000 ч бай, 162,180 ч бай бүгд
 * 50,000-ын ханшаар. 2026-08-19 хүртэл эдгээр нь `null` → `#ТАРИФ!` болдог
 * байсан бөгөөд яг тэр нь бодит үнийн саналыг зогсоосон.
 *
 * ⚠️ Энэ дүрэм ДАТА биш КОДОД сууж байгаа нь санаатай: `PUT /api/quotes/tariffs`
 * нь каталогийг БҮХЭЛД НЬ солидог тул «хязгааргүй» sentinel мөр нэмбэл админ
 * хүснэгтээ засах үед чимээгүй алга болно. Кодод байвал каталог хэрхэн
 * өөрчлөгдсөнөөс үл хамааран «сүүлийн мөр» гэдэг нь үргэлж зөв тодорхойлогдоно.
 *
 * Танигдаагүй төвөгшил, эерэг бус талбай, хоосон каталог л `null` → `#ТАРИФ!`.
 *
 * Хуудас дахин тооцоологдох бүрд нүд бүр дуудагдах тул төвөгшил тус бүрээр
 * эрэмбэлсэн массивыг НЭГ УДАА бэлдээд хоёртын хайлт хийнэ (353 мөр → ~6 алхам).
 */
export function makeTariffFn(rows: TariffRow[]): (area: number, cxRaw: string) => number | null {
  const byComplexity = new Map<TariffComplexity, Bracket[]>();

  for (const row of rows) {
    if (!row) continue;
    const cx = normalizeComplexity(row.complexity);
    if (!cx) continue;
    const areaMax = Number(row.area_max);
    const rate = Number(row.rate);
    if (!Number.isFinite(areaMax) || !Number.isFinite(rate)) continue;
    const list = byComplexity.get(cx);
    if (list) list.push({ areaMax, rate });
    else byComplexity.set(cx, [{ areaMax, rate }]);
  }

  for (const list of byComplexity.values()) list.sort((a, b) => a.areaMax - b.areaMax);

  return (area: number, cxRaw: string): number | null => {
    if (!Number.isFinite(area) || area <= 0) return null;
    const cx = normalizeComplexity(cxRaw);
    if (!cx) return null;
    const list = byComplexity.get(cx);
    if (!list || list.length === 0) return null;

    // Хоёртын хайлт: `areaMax >= area` болох хамгийн зүүн (хамгийн бага) шатлал.
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].areaMax >= area) {
        found = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    // Каталогийн дээд шатлалаас давсан → сүүлийн (хамгийн том) шатлалын ханш.
    // `list` нь `areaMax`-аар өссөн эрэмбэтэй тул сүүлийнх нь дээд шатлал.
    if (found < 0) return list[list.length - 1].rate;
    return list[found].rate;
  };
}
