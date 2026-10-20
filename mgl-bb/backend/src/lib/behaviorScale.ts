/**
 * Зан чанарын (behavior) part-ын 1.0–5.0 дундаж оноонд харгалзах 5
 * шатлалын Монгол band.
 *
 * ⚠️ Энэ файл `frontend/src/features/assessments/lib/behaviorScale.ts`-ийн
 *    BEHAVIOR_BANDS/bandForMean хэсгийн ЯГ ИЖИЛ хуулбар — аль нэгийг засвал
 *    нөгөөг нь заавал дагуулж засна. Фронт файл нэмээд `sectionMean`/
 *    `partMean`/`fmtMean` зэрэг зөвхөн UI/Excel-д хэрэгтэй туслахуудтай —
 *    тэдгээрийг энд ХУУЛААГҮЙ, зөвхөн ажилтны `/my/results`-д level
 *    ангилахад хэрэгтэй хэсгийг л авсан. docs/dev/assessments-spec.md §1a.
 *
 *   scaleMax = must / item_count  (= scale.max, ихэвчлэн 5)
 *   mean     = average / item_count ∈ [0, scaleMax]
 */

export interface BehaviorBand {
  code: string;
  label: string;
  minMean: number;
  maxMean: number;
  color: string;
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
 * `mean`-д харгалзах band. `levelForPct` (assessmentScore.ts)-тэй яг ижил
 * зарчим: дээдээс нь доош эрэмбэлж, эхний `mean >= band.minMean`-той
 * таарсанг нь буцаана.
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
 * `nextLevelFor` (assessmentScore.ts)-тэй ижил зарчим: доороос нь дээш,
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
