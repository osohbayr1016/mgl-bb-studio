/**
 * Таск хуваах — `POST /api/tasks/:id/split` (2026-09-25, 2026-10-01-нд өргөтгөсөн).
 *
 * Эзний дүрэм: таскийн нэрийг хэрэглэгч өөрчлөхгүй; «Хуваах» нь таскийг N
 * хэсэг болгож, жин (`weight_percent`) нь хэсгүүдэд хуваагдана — 9% → 4.5 +
 * 4.5, эсвэл 2 + 2 + 5.  Нийлбэр нь эх жингээс ХЭТРЭХГҮЙ, ДУТАХГҮЙ.
 *
 *   • ЯВЦГҮЙ таск (сүүлийн батлагдсан хувь 0) — 'whole': эхний хэсэг = ЭХ таск
 *     (id, түүнийг одоо хийж буй хүн хэвээр); бусад нь шинэ, 0%-тай таск.
 *   • ЯВЦТАЙ таск (0 < p < 100) — 'remainder' (эзэн 2026-10-01: «үлдсэнийг л
 *     хуваана»): эх таск нь ХИЙГДСЭН ХЭСЭГ болж жин нь `W × p / 100` болон
 *     100% гэж хаагдана (системийн `source='split'` бичлэг) — төслийн явц,
 *     өмнө олгосон оноо ХӨДЛӨХГҮЙ.  ҮЛДСЭН `W − W·p/100`-ийг 1+ ШИНЭ таск болгож
 *     0%-аас эхлүүлнэ.  Шинэ хүн тэр таскаа 0→100% хийнэ.
 *     (2026-09-25-ны хувилбар эх таскийн явцыг үлдээгээд жинг нь багасгадаг
 *     байсан тул төслийн явц БУУРДАГ байв — 75% таскийг 2 хуваахад 37.5%.)
 *   • Нэр нь СЕРВЕР дээр «<нэр> (i/N)» болж үүснэ (remainder-д хийгдсэн хэсэг
 *     нь (1/N+1)).
 *
 * Энэ файл цэвэр — D1 уншихгүй, юу ч импортлохгүй.  Frontend-ийн засварлагчийн
 * тэнцвэржүүлэлт нь `frontend/.../detail/taskSplit.ts`-д.
 */

export const MAX_SPLIT_PARTS = 20;

/** Жинг зууны нэгжээр (0.01%) тулгана — 4.5 → 450. */
const CENT = 100;
const EPS = 1e-6;

export type SplitCheck =
  | { ok: true; weights: number[] }
  | { ok: false; error: string };

/**
 * ЯВЦГҮЙ таскийн хуваалт — клиентийн илгээсэн хэсгүүдийг шалгана.  Буцаах
 * `weights[0]` нь эх таскийн шинэ жин = `total − Σ бусад` — эх жин 2-оос олон
 * аравтын оронтой (3.3333) байсан ч нийлбэр ЯГ хадгалагдана.
 */
export function validateSplit(total: number, raw: unknown): SplitCheck {
  const plan = planSplit(total, 0, raw);
  return plan.ok ? { ok: true, weights: plan.parts } : plan;
}

export type SplitPlan =
  | {
      ok: true;
      /** 'whole' = явцгүй таск (эх таск эхний хэсэг болж үлдэнэ);
       *  'remainder' = явцтай таск (эх таск «хийгдсэн хэсэг» болж хаагдана). */
      mode: 'whole' | 'remainder';
      /** remainder: эх таскийн шинэ жин = W × p / 100; whole: 0. */
      doneWeight: number;
      /** whole: эх таск = parts[0], хуулбарууд = parts[1..];
       *  remainder: бүгд ШИНЭ таск.  Нийлбэр = W − doneWeight ЯГ. */
      parts: number[];
    }
  | { ok: false; error: string };

/**
 * Хуваалтыг шалгаж төлөвлөнө.  Явцтай таскт `raw` нь ҮЛДСЭН хэсгийн хуваалт
 * (нийлбэр = W − W·p/100, ≥1 хэсэг), явцгүйд бүх жингийнх (≥2 хэсэг).  Хэсэг бүр
 * 0.01-ийн нарийвчлалтай, > 0; нийлбэр 0.005-ын дотор таарах ёстой — эхний хэсэг
 * дугуйлалтын үлдэгдлийг шингээж нийлбэр ЯГ хадгалагдана.
 */
export function planSplit(weight: number, progress: number, raw: unknown): SplitPlan {
  const W = Number(weight);
  const p = Number(progress);
  if (!Number.isFinite(W) || W <= 0) return { ok: false, error: 'Жингүй таскийг хуваах боломжгүй' };
  if (!Number.isFinite(p) || p < 0) return { ok: false, error: 'Явц буруу' };
  if (p >= 100) return { ok: false, error: 'Дууссан таскийг хуваах боломжгүй' };
  const remainder = p > 0;
  const doneWeight = remainder ? (W * p) / 100 : 0;
  const total = W - doneWeight;
  if (!Array.isArray(raw)) return { ok: false, error: 'weights required' };
  const minParts = remainder ? 1 : 2;
  if (raw.length < minParts) return { ok: false, error: `Дор хаяж ${minParts} хэсэг` };
  if (raw.length > MAX_SPLIT_PARTS) {
    return { ok: false, error: `Хамгийн ихдээ ${MAX_SPLIT_PARTS} хэсэг` };
  }
  if (total < 0.01 * raw.length - EPS) {
    return { ok: false, error: 'Үлдсэн хэсэг хэт бага тул хуваах боломжгүй' };
  }
  const cents: number[] = [];
  for (const w of raw) {
    if (typeof w !== 'number' || !Number.isFinite(w)) {
      return { ok: false, error: 'Хувь буруу' };
    }
    const c = Math.round(w * CENT);
    if (Math.abs(w * CENT - c) > EPS) {
      return { ok: false, error: 'Хувь нь 0.01-ийн нарийвчлалтай байна' };
    }
    if (c <= 0) return { ok: false, error: 'Хэсэг бүр 0-ээс их байх ёстой' };
    cents.push(c);
  }
  const sumC = cents.reduce((s, c) => s + c, 0);
  if (Math.abs(sumC - total * CENT) >= 0.5 + EPS) {
    return {
      ok: false,
      error: remainder
        ? `Нийлбэр ${fmt(sumC / CENT)}% — үлдсэн ${fmt(total)}%-тай тэнцэх ёстой (явц өөрчлөгдсөн бол цонхоо дахин нээнэ үү)`
        : `Нийлбэр ${fmt(sumC / CENT)}% — эх таскийн ${fmt(total)}%-тай тэнцэх ёстой`,
    };
  }
  const rest = cents.slice(1).map((c) => c / CENT);
  const first = total - rest.reduce((s, w) => s + w, 0);
  if (first <= 0) return { ok: false, error: 'Хэсэг бүр 0-ээс их байх ёстой' };
  return { ok: true, mode: remainder ? 'remainder' : 'whole', doneWeight, parts: [first, ...rest] };
}

/** «Фасад» → «Фасад (1/3)», «Фасад (2/3)», «Фасад (3/3)». */
export function splitNames(name: string, n: number): string[] {
  const base = name.trim();
  return Array.from({ length: n }, (_, i) => `${base} (${i + 1}/${n})`);
}

/**
 * Компонент доторх шинэ дараалал: хуулбарууд эх таскийн ЯГ ард.  Буцаах
 * жагсаалтын элемент бүр нь одоо байгаа таскийн id эсвэл хуулбарын индекс
 * (`{ copy: k }`); `sort_order = (байрлал + 1) × 10` (`PUT /reorder`-той ижил).
 */
export function splitOrder(
  siblingIds: number[],
  originalId: number,
  copies: number,
): Array<number | { copy: number }> {
  const out: Array<number | { copy: number }> = [];
  let placed = false;
  for (const id of siblingIds) {
    out.push(id);
    if (id === originalId) {
      for (let k = 0; k < copies; k++) out.push({ copy: k });
      placed = true;
    }
  }
  if (!placed) for (let k = 0; k < copies; k++) out.push({ copy: k });
  return out;
}

/** Тэнцүү хуваалт ЗУУНЫ НЭГЖЭЭР — үлдэгдэл цент эхний хэсгүүдэд (frontend
 *  `detail/taskSplit.ts` `equalParts`-ийн ихэр). */
export function equalCents(totalCents: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  const rem = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * Хуваах цонхны тоонууд (`W`, `p`): `doneWeight` = хийгдсэн хэсгийн жин (явцтай
 * бол), `splitTotal` = хуваагдах жин, `defaultHalves` = «Өөртөө авах»-ын 50/50
 * өгөгдмөл (эзэн 2026-10-01).
 */
export function splitDefaults(
  weight: number,
  progress: number,
): { doneWeight: number; splitTotal: number; defaultHalves: number[] } {
  const W = Math.max(0, Number(weight) || 0);
  const p = Math.min(100, Math.max(0, Number(progress) || 0));
  const doneWeight = p > 0 ? (W * p) / 100 : 0;
  const splitTotal = W - doneWeight;
  const defaultHalves = equalCents(Math.round(splitTotal * CENT), 2).map((c) => c / CENT);
  return { doneWeight, splitTotal, defaultHalves };
}

/**
 * Хуваасны дараа хэн аль хэсэг дээр.  `occupant` = одоо эх таск дээр ажиллаж
 * буй хүн (байвал), `takeIndex` = хувааж АВАГЧИЙН сонгосон хэсэг (байвал).
 * Ажиллаж буй хүн ҮРГЭЛЖ part 0 дээр үргэлжилнэ:
 *   whole     — part 0 = эх таск, тэр хүн хөдлөхгүй;
 *   remainder — эх таск хаагдах тул тэр хүний таймер part 0 (шинэ) руу шилжинэ.
 */
export function splitSeats(
  partsCount: number,
  hasOccupant: boolean,
  takeIndex: number | null | undefined,
): { occupantIndex: number | null; takerIndex: number | null; error?: string } {
  const occupantIndex = hasOccupant ? 0 : null;
  if (takeIndex === null || takeIndex === undefined) {
    return { occupantIndex, takerIndex: null };
  }
  if (!Number.isInteger(takeIndex) || takeIndex < 0 || takeIndex >= partsCount) {
    return { occupantIndex, takerIndex: null, error: 'Авах хэсэг буруу' };
  }
  if (occupantIndex !== null && takeIndex === occupantIndex) {
    return { occupantIndex, takerIndex: null, error: 'Энэ хэсэг дээр өөр хүн ажиллаж байна' };
  }
  return { occupantIndex, takerIndex: takeIndex };
}

/** Авагчийн өгөгдмөл хэсэг: ажиллаж буй хүн байвал 1, үгүй бол 0. */
export function defaultTakeIndex(hasOccupant: boolean): number {
  return hasOccupant ? 1 : 0;
}

function fmt(n: number): string {
  return String(Math.round(n * CENT) / CENT);
}
