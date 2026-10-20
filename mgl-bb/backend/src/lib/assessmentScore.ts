/**
 * Үнэлгээний оноо бодох цэвэр функцүүд (эх Excel-ийн REPORT DIAGRAMM-ын томьёо).
 *
 * ⚠️ Энэ файл `frontend/src/features/assessments/lib/score.ts`-тэй ЯГ ИЖИЛ байна —
 *    аль нэгийг засвал нөгөөг нь заавал дагуулж засна. docs/dev/assessments-spec.md §1.
 *
 *   must    = мөрийн тоо × scale.max          (Concept Design 27 мөр → 135)
 *   self    = ажилтны хариултуудын нийлбэр
 *   senior  = багийн ахлагчийн хариултуудын нийлбэр (хэд хэдэн ахлагч
 *             байвал тэдний нийлбэрүүдийн ДУНДАЖ — §1a)
 *   average = ЗӨВХӨН өгөгдсөн талуудын дундаж (senior байхгүй бол = self)
 *   pct     = average / must × 100
 *   level   = pct-ээс band-аар
 *   overall = Σ(pct × weight) / Σ(weight)
 */

import type {
  AssessmentAnswers,
  AssessmentLevelBand,
  AssessmentPart,
  AssessmentScale,
  AssessmentSchema,
  AssessmentSection,
} from './assessmentSchema';

/**
 * Схемд level тодорхойлоогүй үед хэрэглэх анхны band-ууд.
 *
 * Өнгө нь 2026-08-аас эхлэн ОЛОН ӨНГӨ биш, НЭГ navy-blue **ramp**: Intern
 * (цайвар ган) → Expert (гүн navy) — шалтгаан нь frontend талын ижил файлд
 * (`frontend/src/features/assessments/lib/score.ts`) бичигдсэн.
 */
export const DEFAULT_LEVELS: AssessmentLevelBand[] = [
  { code: 'EXPERT', label: 'Expert', minPct: 95, maxPct: 100, color: '#2f57ab' },
  { code: 'SENIOR', label: 'Senior', minPct: 85, maxPct: 94.999999, color: '#4a6cb5' },
  { code: 'MIDDLE', label: 'Middle', minPct: 60, maxPct: 84.999999, color: '#6581bf' },
  { code: 'JUNIOR', label: 'Junior', minPct: 30, maxPct: 59.999999, color: '#8299c9' },
  { code: 'INTERN', label: 'Intern', minPct: 0, maxPct: 29.999999, color: '#a1b3d7' },
];

/**
 * Графикийн өнгө — self / senior / average гурав хаа сайгүй ижил байна.
 *
 * ГЭРЭЛ горимын суурь утгууд. Харанхуй горимын алхмууд болон `benchmark`
 * (Багийн дундаж) нь frontend-ийн `features/assessments/lib/chartSeries.ts`-д
 * — өнгө сонголтын шалтгаан, хэмжигдсэн үзүүлэлтүүд бүгд тэнд бичигдсэн.
 */
export const SIDE_COLORS = {
  self: '#5E9BE0',
  senior: '#17509A',
  average: '#C08A00',
} as const;

// ---------------------------------------------------------------------------

/** Хэсэг доторх бүх оноо өгөх мөрийг хавтгайруулна. */
export function sectionItems(section: AssessmentSection) {
  return section.groups.flatMap((g) => g.items);
}

/** Part доторх бүх мөрийн тоо (маягтын явцын мөр тоолоход бас хэрэглэнэ). */
export function partItemCount(part: AssessmentPart): number {
  return part.sections.reduce((sum, s) => sum + sectionItems(s).length, 0);
}

/** Схемийн нийт мөрийн тоо. */
export function schemaItemCount(schema: AssessmentSchema): number {
  return schema.parts.reduce((sum, p) => sum + partItemCount(p), 0);
}

/** Схемээс part-ын шатлалыг олох (олдохгүй бол эхнийхийг). */
export function scaleForPart(schema: AssessmentSchema, part: AssessmentPart): AssessmentScale {
  const found = schema.scales.find((s) => s.id === part.scaleId);
  // Схем гэмтэлтэй байсан ч UI унахгүй байх — 1..5 руу дефолтлоно.
  return found ?? schema.scales[0] ?? { id: 'default', label: '', min: 1, max: 5, options: [] };
}

/** `pct`-д харгалзах level band. `pct` null бол null. */
export function levelForPct(
  levels: AssessmentLevelBand[],
  pct: number | null,
): AssessmentLevelBand | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const bands = levels.length ? levels : DEFAULT_LEVELS;
  // Дээдээс нь доош — эхний таарсан band.
  const sorted = [...bands].sort((a, b) => b.minPct - a.minPct);
  for (const band of sorted) {
    if (pct >= band.minPct) return band;
  }
  return sorted[sorted.length - 1] ?? null;
}

/**
 * `pct`-ээс ДЭЭШ байгаа хамгийн ойрын band — «дараагийн түвшин».
 *
 * Хамгийн дээд band (EXPERT) дээр байгаа хүнд `null` буцна — дараагийн
 * түвшин байхгүй. `pct` null (тал өгөгдөөгүй) үед мөн null.
 *
 * ⚠️ `levelForPct`-ийн ЯГ ЭСРЭГ тал: тэр нь `pct >= minPct`-ээр доошоо
 *    хайдаг бол энэ нь `minPct > pct`-ээр дээшээ хайна. Хоёулаа ижил
 *    `minPct` талбар дээр тулгуурладаг тул band-уудын хооронд цоорхой
 *    үлдэхгүй.
 */
export function nextLevelFor(
  levels: AssessmentLevelBand[],
  pct: number | null,
): AssessmentLevelBand | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const bands = levels.length ? levels : DEFAULT_LEVELS;
  // Доороос нь дээш — `pct`-ээс хатуу дээгүүр эхэлдэг хамгийн эхний band.
  const sorted = [...bands].sort((a, b) => a.minPct - b.minPct);
  for (const band of sorted) {
    if (band.minPct > pct) return band;
  }
  return null;
}

/** Нэг мөрийн бодит оноо — `reverse: true` үед урвуулна (жишээ 5→1). */
export function itemScore(raw: number, scale: AssessmentScale, reverse?: boolean): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const clamped = Math.min(Math.max(raw, scale.min), scale.max);
  return reverse ? scale.min + scale.max - clamped : clamped;
}

/** Нэг талын нэг хэсэг дэх онооны нийлбэр. Хариулаагүй мөр = 0. */
export function sumSection(
  section: AssessmentSection,
  answers: AssessmentAnswers,
  scale: AssessmentScale,
): { points: number; answered: number } {
  let points = 0;
  let answered = 0;
  for (const item of sectionItems(section)) {
    const raw = answers[item.id];
    if (typeof raw === 'number' && raw > 0) {
      points += itemScore(raw, scale, item.reverse);
      answered += 1;
    }
  }
  return { points, answered };
}

// ---------------------------------------------------------------------------
// Үр дүнгийн хэлбэрүүд
// ---------------------------------------------------------------------------

export interface SectionScore {
  sectionId: string;
  code: string;
  title: string;
  weight: number;
  itemCount: number;
  /** Хамгийн их авах боломжтой оноо = itemCount × scale.max. */
  must: number;
  /** Тухайн тал өгөгдөөгүй бол null. */
  self: number | null;
  senior: number | null;
  /** Өгөгдсөн талуудын дундаж. */
  average: number | null;
  selfPct: number | null;
  seniorPct: number | null;
  /** average / must × 100 — үндсэн «Үнэлгээний хувь». */
  pct: number | null;
  level: AssessmentLevelBand | null;
  selfAnswered: number;
  seniorAnswered: number;
}

export interface PartScore {
  partId: string;
  title: string;
  chart: 'scatter' | 'radar';
  weighted: boolean;
  sections: SectionScore[];
  totals: {
    must: number;
    self: number | null;
    senior: number | null;
    average: number | null;
  };
  /** Зөвхөн weighted part-д: Σ(pct × weight) / Σ(weight). */
  overallPct: number | null;
  overallLevel: AssessmentLevelBand | null;
  /** Жингийн нийлбэр — 100 биш бол UI шар сэрэмжлүүлэг харуулна. */
  weightSum: number;
}

export interface AssessmentScoreResult {
  parts: PartScore[];
  /** weighted part-уудын нийт хувь (ихэвчлэн ганц ур чадварын part). */
  overallPct: number | null;
  overallLevel: AssessmentLevelBand | null;
}

/**
 * Оноо бодоход өгөх талууд. Тал өгөгдөөгүй (эсвэл илгээгээгүй) бол `null`.
 * `senior` нь ХЭДЭН Ч ахлагчийн (0..N) илгээсэн хариултын массив байж
 * болно — олон ахлагч байвал тэдний оноог `scoreSection` дундажилж НЭГ
 * "senior" утга гаргана (docs/dev/assessments-spec.md §1a).
 */
export interface ScoreSides {
  self?: AssessmentAnswers | null;
  senior?: AssessmentAnswers[] | null;
}

// ---------------------------------------------------------------------------

function pctOf(points: number | null, must: number): number | null {
  if (points === null || must <= 0) return null;
  return (points / must) * 100;
}

/** Нэг хэсгийн бүрэн оноо. */
export function scoreSection(
  section: AssessmentSection,
  scale: AssessmentScale,
  levels: AssessmentLevelBand[],
  sides: ScoreSides,
): SectionScore {
  const items = sectionItems(section);
  const must = items.length * scale.max;

  const selfSum = sides.self ? sumSection(section, sides.self, scale) : null;
  const seniorSums = (sides.senior ?? []).map((answers) => sumSection(section, answers, scale));

  const self = selfSum ? selfSum.points : null;
  // Хэд хэдэн ахлагчийн оноог дундажилж НЭГ "senior" утга болгоно — доод
  // талын average/pct/level логик үүнийг ганц ахлагч мэт хэрэглэнэ.
  const senior = seniorSums.length
    ? seniorSums.reduce((sum, s) => sum + s.points, 0) / seniorSums.length
    : null;

  // «Дундаж = зөвхөн бөглөсөн талуудаар» — senior хоосон бол average = self.
  const present = [self, senior].filter((v): v is number => v !== null);
  const average = present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;

  const pct = pctOf(average, must);

  return {
    sectionId: section.id,
    code: section.code,
    title: section.title,
    weight: section.weight,
    itemCount: items.length,
    must,
    self,
    senior,
    average,
    selfPct: pctOf(self, must),
    seniorPct: pctOf(senior, must),
    pct,
    level: levelForPct(levels, pct),
    selfAnswered: selfSum?.answered ?? 0,
    seniorAnswered: seniorSums.length
      ? Math.round(seniorSums.reduce((sum, s) => sum + s.answered, 0) / seniorSums.length)
      : 0,
  };
}

/** Нэг part-ын бүх хэсэг + нийт. */
export function scorePart(
  schema: AssessmentSchema,
  part: AssessmentPart,
  sides: ScoreSides,
): PartScore {
  const scale = scaleForPart(schema, part);
  const levels = schema.levels?.length ? schema.levels : DEFAULT_LEVELS;
  const sections = part.sections.map((s) => scoreSection(s, scale, levels, sides));

  const totals = {
    must: sections.reduce((sum, s) => sum + s.must, 0),
    self: sides.self ? sections.reduce((sum, s) => sum + (s.self ?? 0), 0) : null,
    senior: sides.senior?.length ? sections.reduce((sum, s) => sum + (s.senior ?? 0), 0) : null,
    average: null as number | null,
  };
  const totalPresent = [totals.self, totals.senior].filter((v): v is number => v !== null);
  totals.average = totalPresent.length
    ? totalPresent.reduce((a, b) => a + b, 0) / totalPresent.length
    : null;

  const weightSum = sections.reduce((sum, s) => sum + (s.weight || 0), 0);

  let overallPct: number | null = null;
  if (part.weighted && weightSum > 0) {
    let acc = 0;
    let used = 0;
    for (const s of sections) {
      if (s.pct === null) continue;
      acc += s.pct * (s.weight || 0);
      used += s.weight || 0;
    }
    overallPct = used > 0 ? acc / used : null;
  }

  return {
    partId: part.id,
    title: part.title,
    chart: part.chart,
    weighted: part.weighted,
    sections,
    totals,
    overallPct,
    overallLevel: part.weighted ? levelForPct(levels, overallPct) : null,
    weightSum,
  };
}

/** Схемийн бүх part-ыг бодно. */
export function scoreAssessment(
  schema: AssessmentSchema,
  sides: ScoreSides,
): AssessmentScoreResult {
  const levels = schema.levels?.length ? schema.levels : DEFAULT_LEVELS;
  const parts = schema.parts.map((p) => scorePart(schema, p, sides));
  const weighted = parts.filter((p) => p.weighted && p.overallPct !== null);
  const overallPct = weighted.length
    ? weighted.reduce((sum, p) => sum + (p.overallPct ?? 0), 0) / weighted.length
    : null;
  return { parts, overallPct, overallLevel: levelForPct(levels, overallPct) };
}

/** Хэдэн мөр хариулсныг тоолох (маягтын явцын мөр). */
export function countAnswered(schema: AssessmentSchema, answers: AssessmentAnswers): number {
  let n = 0;
  for (const part of schema.parts) {
    for (const section of part.sections) {
      for (const item of sectionItems(section)) {
        const raw = answers[item.id];
        if (typeof raw === 'number' && raw > 0) n += 1;
      }
    }
  }
  return n;
}
