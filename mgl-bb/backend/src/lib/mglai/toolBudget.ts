/**
 * MGL AI · ХЭРЭГСЛИЙН ҮР ДҮНГИЙН ТӨСӨВ (§36 — «Do not overload the model context»).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА.  Хэмжигдсэн (2026-09-10): гүн судалгаа 8
 *    хэрэгсэл дуудахад prompt ~12 000 тэмдэгт болж 8K контекстын хил дээр
 *    очсон; `tasks` entity-ийн 20 мөр нь 8 770 тэмдэгт байсан бөгөөд
 *    `renderToolResults`-ийн 4 000-ын тайралт JSON-ыг ДУНДУУР нь тасалдаг
 *    байв — загварт «{"rows":[{"id":10802,"name":"План зу» гэсэн хагас
 *    объект очно.
 *
 *    Энэ модуль нь тайралтыг БҮТЭЦТЭЙ хийнэ: жагсаалтыг богиносгож
 *    `_truncated: {shown, total}` гэж ИЛ тэмдэглэнэ, урт мөрийг богиносгоно,
 *    JSON хүчинтэй ХЭВЭЭР үлдэнэ.  Загвар «20-оос эхний 8-ыг харуулав» гэж
 *    хэлж чадна — хагас объектоос таамаглахгүй.
 *
 * ⚠️ ЦЭВЭР — тестлэгдэнэ.  Эрх, ариутгал ЭНД БИШ (`promptFrame.ts`).
 */
export interface BudgetedResult<T> {
  results: T[];
  /** Нийт тэмдэгт (JSON) төсөвлөлтийн ӨМНӨ / ДАРАА — оношилгоонд. */
  before: number;
  after: number;
  truncated: boolean;
}

const MAX_STRING = 300;
const MIN_ROWS = 3;

function size(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Урт мөрийг богиносгоно — гүн рекурсгүй, зөвхөн эхний хоёр давхарга. */
function clipStrings(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
  if (depth > 3 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => clipStrings(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = clipStrings(x, depth + 1);
  return out;
}

/**
 * Нэг үр дүнг `limit` тэмдэгтэд багтаана.  Хамгийн том массивыг олж
 * богиносгох давталт — массив бүр ≥ MIN_ROWS үлдэнэ.
 */
export function shrinkData(data: unknown, limit: number): { data: unknown; truncated: boolean } {
  let d = clipStrings(data);
  if (size(d) <= limit) return { data: d, truncated: size(d) !== size(data) };
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    if (Array.isArray(d)) {
      let arr = d as unknown[];
      const total = arr.length;
      while (arr.length > MIN_ROWS && size(arr) > limit) arr = arr.slice(0, Math.max(MIN_ROWS, Math.floor(arr.length * 0.7)));
      return { data: { rows: arr, _truncated: { shown: arr.length, total } }, truncated: true };
    }
    return { data: d, truncated: false };
  }
  const obj = { ...(d as Record<string, unknown>) };
  let truncated = false;
  for (let guard = 0; guard < 12 && size(obj) > limit; guard++) {
    // Хамгийн том массив талбар.
    let bestKey: string | null = null;
    let bestSize = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) && v.length > MIN_ROWS) {
        const s = size(v);
        if (s > bestSize) {
          bestSize = s;
          bestKey = k;
        }
      }
    }
    if (bestKey === null) break;
    const arr = obj[bestKey] as unknown[];
    const meta = (obj._truncated as Record<string, { shown: number; total: number }> | undefined) ?? {};
    const total = meta[bestKey]?.total ?? arr.length;
    const next = arr.slice(0, Math.max(MIN_ROWS, Math.floor(arr.length * 0.6)));
    obj[bestKey] = next;
    obj._truncated = { ...meta, [bestKey]: { shown: next.length, total } };
    truncated = true;
  }
  return { data: obj, truncated };
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Бүх хэрэгслийн үр дүнг НИЙТ `totalChars`-д багтаана.
 *    Хувь нь тэнцүү биш — жижиг үр дүн өөрийнхөө хэмжээгээр, том нь
 *    үлдсэнийг хуваана.
 */
export function budgetToolResults<T extends { ok: boolean; data: unknown }>(
  results: readonly T[],
  totalChars: number,
): BudgetedResult<T> {
  const before = results.reduce((s, r) => s + size(r.data), 0);
  if (before <= totalChars) return { results: [...results], before, after: before, truncated: false };

  // Жижиг үр дүн (< тэнцүү хувь) хэвээр; том нь үлдсэн төсвийг хуваана.
  const n = Math.max(1, results.length);
  const fair = Math.floor(totalChars / n);
  let reserved = 0;
  let bigCount = 0;
  for (const r of results) {
    const s = size(r.data);
    if (s <= fair) reserved += s;
    else bigCount++;
  }
  const perBig = bigCount > 0 ? Math.max(600, Math.floor((totalChars - reserved) / bigCount)) : fair;

  let truncated = false;
  const out = results.map((r) => {
    const s = size(r.data);
    if (s <= fair) return r;
    const shrunk = shrinkData(r.data, perBig);
    truncated = truncated || shrunk.truncated;
    return { ...r, data: shrunk.data };
  });
  const after = out.reduce((s, r) => s + size(r.data), 0);
  return { results: out, before, after, truncated };
}
