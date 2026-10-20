/**
 * Ажилтны ӨӨРИЙН үр дүнг харуулахад хэрэгтэй цэвэр туслахууд.
 *
 * ⚠️ Компонентын файлаас ТУСДАА байгаагийн шалтгаан нь зөвхөн
 * `react-refresh/only-export-components` дүрэм — компонент болон тогтмолыг
 * нэг файлд холивол HMR ажиллахаа болино (`components/NextLevelHint.tsx`
 * зөвхөн компонент экспортолдог).
 */
import type { MyResultSection } from '../api';
import type { AssessmentLevelBand } from '../types';

/**
 * Хувийг нэг аравтаар. `lib/exportAssessmentXlsx.ts`-ийн `fmtPct`-ийн ижил
 * хувилбар — тэр файлаас импортлохгүй: тэр модуль Excel экспортын бүх кодыг
 * чирч профайлын chunk-д оруулна (`vite.config.ts`-ийн manualChunks эмзэг).
 */
export const fmtPct = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';

/**
 * «Дараагийн түвшинд хамгийн ойр» эрэмбэ — профайлын ур чадварын жагсаалтын
 * ЦОРЫН ГАНЦ дараалал.  Шүүлтүүр / dropdown ЗОРИУДААР байхгүй: ажилтан аль
 * чадвараа хамгийн бага хүчээр ахиулж чадахаа НЭГ харцаар харах ёстой.
 *
 * Гурван бүлэг, ЯГ ЭНЭ дарааллаар:
 *   1. Ахих боломжтой — `pct_to_next` ӨСӨХ (0.8% дутуу нь 14% дутуугаас өмнө).
 *      Тэнцвэл ЖИН их нь эхэнд (нийт хувьд илүү нөлөөтэй), дараа нь хувь их нь.
 *   2. Дээд түвшинд хүрсэн (`pct_to_next === null`, хувь нь бий) — ХАМГИЙН
 *      ДООР.  Эдгээрийг «0% дутуу» гэж дээр гаргавал ахих зүйлтэй мэт
 *      уншигдана.
 *   3. Хувь нь бодогдоогүй (`pct === null`) — хамгийн сүүлд.
 *
 * ⚠️ Зан чанарын (weighted:false) хэсэг энд ОГТ ОРОХГҮЙ бөгөөд оруулж
 *    БОЛОХГҮЙ: `/my/results`-ийн `round.sections` нь аль хэдийн зөвхөн жинтэй
 *    (ур чадварын) хэсгүүд (`routes/assessments.ts` → `weightedParts.flatMap`).
 *    Зан чанарын хэмжигдэхүүн нь 1.0–5.0 дундаж тул нэг жагсаалтад хольж
 *    эрэмбэлбэл хоёр өөр нэгж харьцуулагдана (spec §3, инвариант I5).
 */
export function sortByNextLevelProximity(sections: MyResultSection[]): MyResultSection[] {
  const bucket = (s: MyResultSection): number =>
    s.pct === null ? 2 : s.pct_to_next === null ? 1 : 0;

  return [...sections].sort((a, b) => {
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;

    if (ba === 0) {
      const gap = (a.pct_to_next ?? 0) - (b.pct_to_next ?? 0);
      if (gap !== 0) return gap;
      const weight = (b.weight ?? 0) - (a.weight ?? 0);
      if (weight !== 0) return weight;
      const pct = (b.pct ?? 0) - (a.pct ?? 0);
      if (pct !== 0) return pct;
    } else if (ba === 1) {
      const pct = (b.pct ?? 0) - (a.pct ?? 0);
      if (pct !== 0) return pct;
    }
    // Тэнцсэн үед ч дараалал ТОГТВОРТОЙ байх ёстой — эс тэгвээс дахин
    // ачаалахад мөрүүд шалтгаангүй байраа солино.
    return a.title.localeCompare(b.title);
  });
}

/**
 * Одоогийн шатлалын ЁРООЛ — «дараагийн түвшин хүртэлх зам»-ын эхлэл.
 *
 * Явцын шугамыг 0-ээс биш, одоогийн band-ийн доод хязгаараас эхлүүлдэг:
 * MIDDLE (60–85) дээр 84.2% байгаа хүн SENIOR-т 97% ойртсоныг харах ёстой,
 * «84%» гэсэн бараг дүүрэн шугам биш.
 */
export function bandFloorPct(
  bands: AssessmentLevelBand[] | undefined,
  levelCode: string | null | undefined,
): number {
  if (!levelCode || !bands?.length) return 0;
  return bands.find((b) => b.code === levelCode)?.minPct ?? 0;
}
