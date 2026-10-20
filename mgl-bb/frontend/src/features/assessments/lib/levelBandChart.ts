/**
 * Ажилтны «Миний үр дүнгийн график» (`MyResultChartsPage`) хуудсанд level
 * band-аар графикийн координат бодох цэвэр туслах функцүүд.
 *
 * ⚠️ Энд ямар ч ОНОО, ХУВЬ ОРОЛЦДОГГҮЙ — зөвхөн level КОД → band-ын `minPct`
 *    (график зурахад л хэрэгтэй туслах тоо, ажилтны өөрийн оноо БИШ, схемийн
 *    тогтмол утга). docs/dev/assessments-spec.md §3.
 */
import type { AssessmentLevelBand } from '../types';
import { DEFAULT_LEVELS } from './score';
import { BEHAVIOR_BANDS } from './behaviorScale';
import type { MyResultPart } from '../api';
import type { ChartSection } from '../components/SkillScatterChart';

export function bandsOf(levels?: AssessmentLevelBand[] | null): AssessmentLevelBand[] {
  return levels?.length ? levels : DEFAULT_LEVELS;
}

/**
 * Band код -> зурах координат. `band.minPct`-ийг ашиглана, `minPct..maxPct`-ийн
 * дундаж (midpoint) БИШ: `levelForPct` (lib/score.ts) `pct`-ээс band-ыг
 * `minPct`-ээр буурахаар эрэмбэлж, эхний `pct >= band.minPct` таарсан band-ыг
 * буцаадаг — `maxPct`-ийг огт уншдаггүй. Тиймээс `minPct` нь ямар ч
 * админаас зохиогдсон band жагсаалт дээр (`minPct<=maxPct`, эрэмбэ, тасралтгүй
 * байдал шалгагддаггүй) round-trip ЯГ таарна, харин дундаж утга нь админ
 * `maxPct`-ийг буруу тохируулбал БУРУУ band руу round-trip хийж болно.
 */
export function levelCodeToPlotPct(
  levels: AssessmentLevelBand[],
  code: string | null,
): number | null {
  if (!code) return null;
  const band = bandsOf(levels).find((b) => b.code === code);
  return band ? band.minPct : null;
}

export function myPartToChartSections(
  part: MyResultPart,
  levels: AssessmentLevelBand[],
): ChartSection[] {
  return part.sections
    .map((s) => ({
      code: s.code,
      title: s.title,
      selfPct: null,
      seniorPct: null,
      averagePct: levelCodeToPlotPct(levels, s.level_code),
      benchmarkPct: null,
    }))
    .filter((s) => s.averagePct !== null);
}

/**
 * Зан чанарын (behavior) band код -> зурах координат (1.0–5.0 дундажийн
 * тэнхлэгт). `band.minMean`-ийг ашиглана — `levelCodeToPlotPct`-тэй яг
 * ижил шалтгаанаар (`bandForMean` эрэмбийг `minMean`-ээр буурахаар
 * тооцдог, round-trip яг таарна).
 */
export function behaviorCodeToMean(code: string | null): number | null {
  if (!code) return null;
  const band = BEHAVIOR_BANDS.find((b) => b.code === code);
  return band ? band.minMean : null;
}

/**
 * Зан чанарын part-ыг `valueMode="mean"` графикт зориулж хөрвүүлнэ —
 * `averagePct` БИШ `averageMean` талбарт бичнэ, ОНОО хэзээ ч ордоггүй
 * (зөвхөн band-ын `minMean` тогтмол утга).
 */
export function myPartToChartSectionsMean(part: MyResultPart): ChartSection[] {
  return part.sections
    .map((s) => ({
      code: s.code,
      title: s.title,
      selfPct: null,
      seniorPct: null,
      averagePct: null,
      selfMean: null,
      seniorMean: null,
      averageMean: behaviorCodeToMean(s.level_code),
      benchmarkPct: null,
      scaleMax: 5,
    }))
    .filter((s) => s.averageMean !== null);
}
