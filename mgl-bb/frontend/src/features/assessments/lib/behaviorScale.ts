/**
 * Зан чанарын (behavior) part-ын 1.0–5.0 дундаж оноо + 5 шатлалын
 * Монгол тайлбар.
 *
 * ⚠️ Ур чадварын part `AssessmentLevelBand` (0..100%, `schema.levels`-ээс
 *    ирдэг) ашигладаг бол зан чанарын part энд ГАНЦ ХАТУУ КОДЛОСОН
 *    шатлалыг ашиглана — схемоос ирдэггүй тул хуучин раундууд ч шинэ
 *    band-аар харагдана (docs/dev/assessments-spec.md §1).
 *
 *   scaleMax = must / item_count  (= scale.max, ихэвчлэн 5)
 *   mean     = average / item_count ∈ [0, scaleMax]  (0-ээс доош ч байж болно
 *              — хариулаагүй мөр 0 оноотой тул)
 */

import type { ResultPart, ResultSection } from './aggregate';

export interface BehaviorBand {
  code: string;
  label: string;
  /** Доод хязгаар — band сонгоход ашиглагдана (highest-minMean-wins). */
  minMean: number;
  /** Зөвхөн харуулах зорилготой (decorative) — `maxPct`-тай адил. */
  maxMean: number;
  color: string;
  /** Утга — «Тайлбар» баганад орно. */
  description: string;
}

export const BEHAVIOR_BANDS: BehaviorBand[] = [
  {
    code: 'ILREHGUI',
    label: 'Илрэхгүй',
    minMean: 1.0,
    maxMean: 1.7,
    color: '#4c0519',
    description: 'Тухайн зан чанар ажиглагдахгүй, эрсдэлтэй',
  },
  {
    code: 'TOGTVORGUI',
    label: 'Тогтворгүй',
    minMean: 1.8,
    maxMean: 2.5,
    color: '#b33a35',
    description: 'Хааяа илэрдэг, ачаалал дор алдагддаг',
  },
  {
    code: 'SUURI',
    label: 'Суурь хангасан',
    minMean: 2.6,
    maxMean: 3.4,
    color: '#e8dfa6',
    description: 'Энгийн нөхцөлд найдвартай илэрдэг',
  },
  {
    code: 'TOGTVORTOI',
    label: 'Тогтвортой',
    minMean: 3.5,
    maxMean: 4.2,
    color: '#82966c',
    description: 'Ачаалалтай үед ч хадгалагддаг',
  },
  {
    code: 'ULGER_JISHEE',
    label: 'Үлгэр жишээ',
    minMean: 4.3,
    maxMean: 5.0,
    color: '#4f7a52',
    description: 'Бусдад нөлөөлж, тогтолцоо болгож чаддаг',
  },
];

/**
 * `mean`-д харгалзах band. `levelForPct` (score.ts)-тэй яг ижил зарчим:
 * дээдээс нь доош эрэмбэлж, эхний `mean >= band.minMean`-той таарсанг нь
 * буцаана. 1.0-ээс доош дундаж (хариулаагүй мөрүүд) ба зайнуудын хоорондох
 * утгууд (жишээ 1.75) хамгийн доод band-д унана.
 */
export function bandForMean(mean: number | null): BehaviorBand | null {
  if (mean === null || !Number.isFinite(mean)) return null;
  const sorted = [...BEHAVIOR_BANDS].sort((a, b) => b.minMean - a.minMean);
  for (const band of sorted) {
    if (mean >= band.minMean) return band;
  }
  return sorted[sorted.length - 1] ?? null;
}

/**
 * `mean`-ээс ДЭЭШ байгаа хамгийн ойрын band — «дараагийн шатлал».
 *
 * ⚠️ Зан чанарын хэсэгт ХУВЬ (pct) хэрэглэхгүй — тэр нь ур чадварын өөр
 *    системийн (average/must × 100) хэмжигдэхүүн. Ажилтанд «дараагийн
 *    шатлалд хүрэхэд хэр үлдсэн» гэдгийг 1.0–5.0 дундажийн НЭГЖЭЭР
 *    (`nextBandForMean(mean).minMean − mean`) харуулна.
 *
 * `nextLevelFor` (score.ts)-тэй ижил зарчим: доороос нь дээш,
 * `minMean > mean`-тай эхний band. Хамгийн дээд шатлал дээр null.
 */
export function nextBandForMean(mean: number | null): BehaviorBand | null {
  if (mean === null || !Number.isFinite(mean)) return null;
  const sorted = [...BEHAVIOR_BANDS].sort((a, b) => a.minMean - b.minMean);
  for (const band of sorted) {
    if (band.minMean > mean) return band;
  }
  return null;
}

/** Хэсгийн дээд оноо (1 мөрийн дээд оноо) — `must / item_count`. */
export function sectionScaleMax(s: { must: number; item_count: number }): number | null {
  return s.item_count > 0 ? s.must / s.item_count : null;
}

/** Хэсгийн дундаж — `self|senior|average / item_count`. */
export function sectionMean(
  s: ResultSection,
  side: 'self' | 'senior' | 'average' = 'average',
): number | null {
  const value = s[side];
  return s.item_count > 0 && value != null ? value / s.item_count : null;
}

/**
 * Part-ын дундаж — хэсгүүдийн дунджуудын дундаж (хэсэг бүр ижил жинтэй).
 * Энэ нь өнөөгийн эрэмбэтэй яг адилхан (`behaviorMeanPct(part) / 20`).
 */
export function partMean(
  part: ResultPart | null,
  side: 'self' | 'senior' | 'average' = 'average',
): number | null {
  if (!part) return null;
  const means = part.sections
    .map((s) => sectionMean(s, side))
    .filter((v): v is number => v != null);
  if (!means.length) return null;
  return means.reduce((a, b) => a + b, 0) / means.length;
}

/** Part-ын дээд оноо — эхний `item_count > 0` хэсгээс, эс бөгөөс 5. */
export function partScaleMax(part: ResultPart | null): number {
  if (part) {
    for (const s of part.sections) {
      const max = sectionScaleMax(s);
      if (max != null) return max;
    }
  }
  return 5;
}

/** `fmtPct`/`fmtPoints`-тэй ижил хэв маяг, гэхдээ '%'-гүй. */
export const fmtMean = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—';
