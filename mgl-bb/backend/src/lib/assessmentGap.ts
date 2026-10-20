/**
 * «Дараагийн түвшинд хүрэхэд ЯГ ЮУ ДУТУУ ВЭ» — түвшин ахих замын хөдөлгүүр.
 *
 * `assessmentScore.ts` нь «хаана байна» гэдгийг (хувь, түвшин) бодно; энэ файл
 * түүний ДАРААГИЙН асуултыг бодно: **тэр хүн юу хийвэл дараагийн түвшинд
 * хүрэх вэ**.  Хариулт нь мөр (item) түвшний тодорхой жагсаалт байна —
 * «Detail Drawing-ийн 21 мөрийг 4-өөс 5 болго» гэх мэт, мөр бүрийн ард
 * шатлалын ӨӨРИЙНХ нь тайлбар («20 ба түүнээс дээш төсөлд хийж гүйцэтгэсэн»)
 * хамт явна.
 *
 * ⚠️ ЮУ Ч HARDCODE ХИЙГДЭЭГҮЙ.  Хэсгийн код, жин, шатлалын утга/шошго/
 *    тайлбар, level band бүгд **схемээс** (`assessment_rounds.schema_json`)
 *    уншигдана.  Тиймээс маргааш инженер/БА-гийн өөр асуулга орж ирэхэд энэ
 *    файлыг засах шаардлагагүй — тэр асуулгын өөрийнх нь шатлалаар ажиллана.
 *    Зан чанарын (`weighted: false`) part-д л `behaviorScale.ts`-ийн домэйн
 *    band хэрэглэгдэнэ (тэдгээр нь схемээс ирдэггүй — spec §1).
 *
 * ХӨШҮҮРГИЙН ТОМЬЁО (яагаад мөр бүр ялгаатай үнэ цэнэтэй вэ).
 *
 *   overallPct = Σ(pct_s × w_s) / Σw_s,   pct_s = average_s / must_s × 100
 *
 * тул хэсэг `s`-ийн НЭГ мөрийг 1 оноогоор ахиулбал нийт хувь
 *
 *   gain = share × 100 × w_s / (must_s × Σw)
 *
 * -аар өснө.  `must_s = мөрийн тоо × scale.max` тул **цөөн мөртэй, өндөр
 * жинтэй** хэсгийн нэг мөр хамаагүй үнэтэй: архитекторын асуулгад Detail
 * Drawing-ийн 1 мөр = 0.2222 pp атлаа Collaborate-ийн 1 мөр = 0.0300 pp —
 * 7.4 дахин зөрүү.  Хүн «хамгийн сул хэсгээ» засах гэж оролдоод нийт хувь нь
 * бараг хөдлөхгүй байх гол шалтгаан нь энэ.  Тиймээс төлөвлөгөө нь ХӨШҮҮРГЭЭР
 * эрэмбэлэгдэнэ, хувиар биш.
 *
 * `share` = ажилтан ӨӨРИЙН хариултаа өөрчлөхөд дунджид хэдээр нөлөөлөх вэ.
 * Ахлагч илгээсэн бол `average = (self + senior) / 2` тул `share = 0.5` —
 * ө.х. өөрийн хариулт нийт хувийн ХАГАСЫГ л хөдөлгөнө.
 */

import {
  type AssessmentAnswers,
  type AssessmentItem,
  type AssessmentLevelBand,
  type AssessmentSchema,
  type AssessmentScale,
  type AssessmentSection,
} from './assessmentSchema';
import {
  DEFAULT_LEVELS,
  itemScore,
  levelForPct,
  nextLevelFor,
  scaleForPart,
  sectionItems,
  type ScoreSides,
} from './assessmentScore';
import { BEHAVIOR_BANDS, bandForMean, nextBandForMean, type BehaviorBand } from './behaviorScale';

// ---------------------------------------------------------------------------
// Гарах хэлбэрүүд
// ---------------------------------------------------------------------------

/** Нэг шатлалын гишүүн — шошго ба ТАЙЛБАР нь схемээс шууд ирнэ. */
export interface GapScaleStop {
  value: number;
  /** `scale.options[].label` — «SENIOR», «Тогтмол, байнгын» гэх мэт. */
  label: string | null;
  /** `scale.options[].caption` — «10-19 хүртлэх төсөлд тухайн ажлыг…». */
  caption: string | null;
}

/**
 * «Эдгээр N мөрийг X-ээс Y болго» гэсэн НЭГ бүлэг зөвлөмж.
 *
 * Мөр бүрийг тусад нь харуулбал 243 мөрийн жагсаалт болох тул (хэсэг,
 * одоогийн оноо, зорилтот оноо) гурвалаар бүлэглэнэ — ажилтан «Detail
 * Drawing-ийн 21 мөрийг 10-19 төслөөс 20+ төсөл болго» гэж НЭГ өгүүлбэрээр
 * уншина.
 */
export interface GapStepGroup {
  sectionId: string;
  code: string;
  title: string;
  /** Хэсгийн жин (weighted part-д). Зан чанарт null. */
  weight: number | null;
  from: GapScaleStop;
  to: GapScaleStop;
  /** Энэ бүлэгт хэдэн мөр байгаа. */
  itemCount: number;
  /** Энэ бүлгийг бүтнээр нь биелүүлбэл нэмэгдэх хэмжээ (pct эсвэл mean). */
  gain: number;
  /** Жишээ асуултууд (дээд тал нь 3) — «яг юу гэсэн үг вэ» гэдгийг харуулна. */
  examples: string[];
}

/** Нэг хэсгийн (эсвэл нэг part-ын) түвшин ахих зорилт. */
export interface LevelUpTarget {
  /** `pct` — ур чадвар (0..100). `mean` — зан чанар (1..scale.max). */
  unit: 'pct' | 'mean';
  /** Одоогийн утга. Тал өгөгдөөгүй бол null. */
  current: number | null;
  currentLevel: { code: string; label: string; color: string } | null;
  /** Дээд түвшинд байгаа хүнд `null` — «дараагийн түвшин» гэж байхгүй. */
  nextLevel: { code: string; label: string; color: string; threshold: number } | null;
  /**
   * ДЭЭД ТҮВШИНД БАЙНА уу.  true бол `nextLevel`/`gap`/`steps` бүгд хоосон —
   * UI «дараагийн түвшин байхгүй» гэж магтана, «0 дутуу» гэж БИШ.
   */
  atTopLevel: boolean;
  /** Дараагийн түвшин хүртэлх зөрүү (`unit`-ийн нэгжээр). */
  gap: number | null;
  /** Хамгийн бага хүчээр зөрүүг нөхөх зөвлөмжүүд, хөшүүргээр эрэмбэлсэн. */
  steps: GapStepGroup[];
  /** `steps` бүгдийг биелүүлбэл нэмэгдэх нийт хэмжээ. */
  totalGain: number;
  /**
   * `steps` нь зөрүүг БҮРЭН нөхөж чадаж байна уу.
   * false = ажилтан өөрийн бүх хариултаа дээд оноо болгосон ч энэ раундад
   * хүрэхгүй (ахлагчийн үнэлгээ хагасыг эзэлдэг тул).
   *
   * ⚠️ Энэ талбар ажилтан БА админ ХОЁУЛАНД явна — spec §3b нь UI үүнийг
   *    чимээгүй өнгөрөхийг ЗОРИУД хориглодог (эс бөгөөс жагсаалт «үүнийг
   *    хийвэл болно» гэж худал уншигдана).  Ажилтны хувьд шинэ мэдээлэл БИШ:
   *    `covered` нь өөрийн хариулт + схем + аль хэдийн буцаадаг `pct`-ээс
   *    бодогдоно.  ГЭХДЭЭ энд ШИНЭ тоон талбар нэмэхийн өмнө I2/I4-ийг унш.
   */
  covered: boolean;
}

/** Нэг хэсгийн зорилт + таних мэдээлэл. */
export interface SectionLevelUp extends LevelUpTarget {
  sectionId: string;
  code: string;
  title: string;
  weight: number | null;
  itemCount: number;
  /** Энэ хэсгийн НЭГ мөрийг +1 болгоход нийт хувь хэдээр өсөх вэ. */
  leverage: number;
}

export interface PartLevelUpPlan {
  partId: string;
  title: string;
  weighted: boolean;
  /** Part-ын НИЙТ түвшин ахих зорилт. Зан чанарын part-д null (spec §1 / I5). */
  overall: LevelUpTarget | null;
  sections: SectionLevelUp[];
}

export interface LevelUpPlan {
  parts: PartLevelUpPlan[];
}

export interface LevelUpOptions {
  /**
   * ХАРУУЛАХ бөөрөнхийлөлт (зөвхөн `pct` нэгжид).  Level band-ыг ҮҮНИЙ ГАРАЛТ
   * дээр хуваарилна.
   *
   * ⚠️ `/my/results` нь бүх хувийг `shownBands()`-аар — эхлээд `pct1` (1
   *    аравтын орон), дараа нь band — гаргадаг.  Тэр route энд `pct1`-ийг
   *    дамжуулах ЁСТОЙ, эс бөгөөс band-ын ирмэгийн 0.05-ийн цонхонд нэг
   *    хариултын дотор хоёр өөр түвшин гарна (түүхий 84.96 → нэг талд «85.0%
   *    Senior», нөгөө талд «Middle, Senior хүртэл 0.0%»).
   *    Админы `participantResult` нь ТҮҮХИЙ хувь буцаадаг тул түүнийг
   *    дамжуулахгүй (өөрөө өөртэйгөө нийцнэ).
   */
  roundPct?: (pct: number) => number;
}

// ---------------------------------------------------------------------------
// Дотоод
// ---------------------------------------------------------------------------

/**
 * Хариултын нэг мөрийн бодит ОНОО (0 = хариулаагүй).
 *
 * ⚠️ `sumSection` (`assessmentScore.ts`) -ийн ЯГ ИЖИЛ логик байх ЁСТОЙ —
 *    тиймээс `itemScore`-ыг өөрөө дуудна, хуулбарладаггүй.  Ялангуяа
 *    `item.reverse` нь оноог урвуулдаг (5 → 1): үүнийг мартвал энэ файлын
 *    `current` нь `scoreAssessment`-ийн `pct`-ээс САЛЖ, төлөвлөгөө нь мөрийг
 *    ЭСРЭГ чиглэлд түлхэнэ (2026-08-11-ний deploy-ийн өмнөх шүүлтээр илэрсэн).
 */
function answerScore(
  answers: AssessmentAnswers | null | undefined,
  item: AssessmentItem,
  scale: AssessmentScale,
): number {
  const raw = answers?.[item.id];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return itemScore(raw, scale, item.reverse);
}

/**
 * ОНООГ маягт дээр сонгох ШАТЛАЛЫН УТГА руу буцаан хөрвүүлнэ.
 *
 * Энгийн мөрд оноо = утга.  `reverse` мөрд `itemScore` нь `min+max−raw` гэж
 * урвуулдаг тул буцаах хөрвүүлэлт нь мөн `min+max−score` (өөрөө өөрийнхөө
 * урвуу).  Ажилтанд харуулах бүх тоо/тайлбар нь ЭНЭ утганаас гарна — учир
 * нь `scale.options[].caption` («20+ төсөлд гүйцэтгэсэн») нь ОНООГ биш,
 * маягтын сонголтыг тодорхойлдог.
 *
 * Оноо 0 (хариулаагүй) нь шатлалд байхгүй тул 0 хэвээр үлдэнэ.
 */
function rawOfScore(score: number, item: AssessmentItem, scale: AssessmentScale): number {
  if (score <= 0) return 0;
  return item.reverse ? scale.min + scale.max - score : score;
}

/** Шатлалын нэг гишүүний шошго/тайлбарыг СХЕМЭЭС олж авна. */
function stopOf(scale: AssessmentScale, value: number): GapScaleStop {
  const opt = scale.options.find((o) => o.value === value);
  return { value, label: opt?.label ?? null, caption: opt?.caption ?? null };
}

/** Нэг боломжит алхам: тодорхой мөрийн ОНООГ `fromScore`-оос `toScore` болгох. */
interface Step {
  section: AssessmentSection;
  item: AssessmentItem;
  /** Мөрийн ОДООГИЙН оноо (алхам бүрд ижил) — бүлэглэхэд эхлэлийн цэг болно. */
  baseScore: number;
  /** Энэ алхмын дараах оноо.  Эрэмбийн урьдчилсан нөхцөлийг энэ тодорхойлно. */
  toScore: number;
  gain: number;
}

/**
 * Алхмуудыг хөшүүргээр эрэмбэлж, зөрүүг нөхтөл түүнэ (шуналт алгоритм).
 *
 * ⚠️ Эрэмбэ нь `(gain ↓, toScore ↑)`.  Нэг мөрийн алхмуудын gain нь ХЭЗЭЭ Ч
 *    өсдөггүй (эхний «хариулаагүй → scale.min» алхам нь `scale.min` оноо
 *    ахиулдаг тул хамгийн ТОМ, дараагийнх бүр 1 оноо), тиймээс аль ч мөрийн
 *    `toScore = k` алхам нь түүний `k−1` алхмаас ХОЙНО байрлана — урьдчилсан
 *    нөхцөл эрэмбэнд шингэсэн.  (Тэнцүү gain-тай үед `toScore ↑` үүнийг
 *    барина; том gain-тай эхний алхам нь эрэмбийн эхний шалгуураар түрүүлнэ.)
 */
function greedy(steps: Step[], gap: number): { chosen: Step[]; total: number } {
  const sorted = [...steps].sort((a, b) => b.gain - a.gain || a.toScore - b.toScore);
  const chosen: Step[] = [];
  let total = 0;
  for (const step of sorted) {
    if (total >= gap - 1e-9) break;
    total += step.gain;
    chosen.push(step);
  }
  return { chosen, total };
}

/**
 * Сонгосон алхмуудыг харуулах хэлбэрт оруулна.
 *
 * ⚠️ ЭХЛЭЭД МӨРӨӨР нэгтгэнэ.  Нэг мөрд хоёр алхам сонгогдвол (3 → 4 → 5) түүнийг
 *    хоёр тусдаа мөр болгож харуулах нь ажилтанд ижил асуултыг хоёр өөр
 *    зөвлөмжид давхардуулж үзүүлнэ («9 мөрийг 3→4», «9 мөрийг 3→5» — ижил 9
 *    мөр).  Оронд нь мөр бүрийн ЭЦСИЙН зорилтыг авч, дараа нь (хэсэг, эхлэл,
 *    төгсгөл)-өөр бүлэглэнэ: «9 мөрийг 5–9 төслөөс 20+ төсөл болго».
 */
function groupSteps(
  chosen: Step[],
  scale: AssessmentScale,
  weightOf: (s: AssessmentSection) => number | null,
): GapStepGroup[] {
  interface Agg {
    section: AssessmentSection;
    item: AssessmentItem;
    baseScore: number;
    topScore: number;
    gain: number;
  }
  const perItem = new Map<string, Agg>();
  for (const step of chosen) {
    const agg = perItem.get(step.item.id);
    if (!agg) {
      perItem.set(step.item.id, {
        section: step.section,
        item: step.item,
        baseScore: step.baseScore,
        topScore: step.toScore,
        gain: step.gain,
      });
    } else {
      agg.topScore = Math.max(agg.topScore, step.toScore);
      agg.gain += step.gain;
    }
  }

  const map = new Map<string, GapStepGroup>();
  for (const agg of perItem.values()) {
    const fromRaw = rawOfScore(agg.baseScore, agg.item, scale);
    const toRaw = rawOfScore(agg.topScore, agg.item, scale);
    const key = `${agg.section.id}|${fromRaw}|${toRaw}`;
    let group = map.get(key);
    if (!group) {
      group = {
        sectionId: agg.section.id,
        code: agg.section.code,
        title: agg.section.title,
        weight: weightOf(agg.section),
        from: stopOf(scale, fromRaw),
        to: stopOf(scale, toRaw),
        itemCount: 0,
        gain: 0,
        examples: [],
      };
      map.set(key, group);
    }
    group.itemCount += 1;
    group.gain += agg.gain;
    const text = agg.item.text.trim();
    if (group.examples.length < 3 && text) group.examples.push(text);
  }
  return [...map.values()].sort((a, b) => b.gain - a.gain);
}

/** Level band → гарцын хэлбэр. */
function bandOut(band: AssessmentLevelBand | BehaviorBand | null) {
  if (!band) return null;
  return { code: band.code, label: band.label, color: band.color };
}

// ---------------------------------------------------------------------------
// Үндсэн функц
// ---------------------------------------------------------------------------

/**
 * Түвшин ахих замыг бүхэлд нь бодно.
 *
 * `sides` нь `scoreAssessment`-тай ЯГ ИЖИЛ утгатай — ингэснээр энд гарах
 * `current` нь тэнд гарах `pct`-тэй үргэлж таарна (хоёр өөр тоо гаргавал
 * ажилтан алийг нь итгэхээ мэдэхгүй болно).
 *
 * `self` илгээгээгүй бол төлөвлөгөө гаргах утгагүй (юуг ахиулахыг мэдэхгүй)
 * тул бүх зорилт `current: null`-тай, `steps: []`-тэй буцна.
 */
export function buildLevelUpPlan(
  schema: AssessmentSchema,
  sides: ScoreSides,
  opts: LevelUpOptions = {},
): LevelUpPlan {
  const levels = schema.levels?.length ? schema.levels : DEFAULT_LEVELS;
  const self = sides.self ?? null;
  const seniorList = sides.senior ?? [];
  // Дундаж нь «зөвхөн өгөгдсөн талуудаар» тул ажилтны нэг оноо дунджид
  // 1/талын_тоо-гоор нөлөөлнө (ахлагч байвал хагасаар).
  const sidesPresent = (self ? 1 : 0) + (seniorList.length ? 1 : 0);
  const share = sidesPresent > 0 ? 1 / sidesPresent : 1;
  // Дуудагч нь ХАРУУЛАХ бөөрөнхийлөлтөө өгнө (`/my/results` → `pct1`).  Band-ыг
  // бөөрөнхийлсөн утган дээр хуваарилах нь ирмэгийн зөрчлийг зайлуулна.
  const roundPct = opts.roundPct ?? ((v: number) => v);

  const parts = schema.parts.map<PartLevelUpPlan>((part) => {
    const scale = scaleForPart(schema, part);
    const sectionsMeta = part.sections.map((section) => {
      const items = sectionItems(section);
      const must = items.length * scale.max;
      const selfPoints = items.reduce((sum, it) => sum + answerScore(self, it, scale), 0);
      const seniorPoints = seniorList.length
        ? seniorList.reduce(
            (sum, ans) => sum + items.reduce((s2, it) => s2 + answerScore(ans, it, scale), 0),
            0,
          ) / seniorList.length
        : null;
      const present = [self ? selfPoints : null, seniorPoints].filter(
        (v): v is number => v !== null,
      );
      const average = present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
      return { section, items, must, average, weight: section.weight || 0 };
    });

    /**
     * Нийт хувийн ХУВААРЬ.
     *
     * ⚠️ Доорх `overall.current` нь `Σ(pct×w) / used` гэж бодогддог бөгөөд
     *    `used` нь ЗӨВХӨН хувь нь бодогдсон хэсгүүдийн жин (жинтэй атлаа
     *    асуултгүй хэсэг ОРОХГҮЙ — `validateSchema` `groups: []`-г зөвшөөрдөг).
     *    Хөшүүрэг нь тэр яг тоонуудын уламжлал тул ИЖИЛ хуваарийг хэрэглэх
     *    ёстой; бүх жингийн нийлбэрээр хуваавал ашиг дутуу тооцогдож илүү
     *    алхам тушаана (deploy-ийн өмнөх шүүлтээр илэрсэн).
     */
    const usedWeight = sectionsMeta.reduce(
      (sum, m) => (m.average !== null && m.must > 0 ? sum + m.weight : sum),
      0,
    );

    /** Хэсэг `s`-ийн нэг мөрийг +1 ОНОО болгоход НИЙТ хувь хэдээр өсөх вэ. */
    const partLeverage = (m: (typeof sectionsMeta)[number]) =>
      part.weighted && usedWeight > 0 && m.must > 0
        ? (share * 100 * m.weight) / (m.must * usedWeight)
        : 0;

    /** Хэсэг доторх нэг мөрийг +1 оноо болгоход тухайн ХЭСГИЙН хувь хэдээр өсөх вэ. */
    const sectionLeveragePct = (m: (typeof sectionsMeta)[number]) =>
      m.must > 0 ? (share * 100) / m.must : 0;

    /** Зан чанарт — хэсгийн 1.0–5.0 дундаж хэдээр өсөх вэ. */
    const sectionLeverageMean = (m: (typeof sectionsMeta)[number]) =>
      m.items.length > 0 ? share / m.items.length : 0;

    /**
     * Тухайн хэсгийн боломжит бүх алхам.
     *
     * `perPoint` нь НЭГ ОНООНЫ үнэ; алхам бүрийн `gain` нь тухайн алхмын
     * ахиулах оноогоор үржигдэнэ.
     *
     * ⚠️ Хариулаагүй мөр (оноо `0`) нь «хамгийн доод оноо» БИШ — `sumSection`
     *    түүнд 0 өгдөг.  Тиймээс эхний алхам нь `0 → scale.min` бөгөөд
     *    `scale.min` ОНОО ахиулна (шатлал 1-ээс эхлэхгүй схемд энэ нь 1-ээс
     *    их).  Гарцад `from.value === 0` нь «хариулаагүй» гэсэн утгатай
     *    (шатлалд байхгүй утга тул `label`/`caption` нь null).
     */
    const stepsOf = (m: (typeof sectionsMeta)[number], perPoint: number): Step[] => {
      if (!self || perPoint <= 0) return [];
      const out: Step[] = [];
      for (const item of m.items) {
        const baseScore = answerScore(self, item, scale);
        let prev = baseScore;
        while (prev < scale.max) {
          // Хариулаагүйгээс шууд `scale.min` руу; тэндээс цааш нэг нэгээр.
          const toScore = prev < scale.min ? scale.min : prev + 1;
          out.push({
            section: m.section,
            item,
            baseScore,
            toScore,
            gain: perPoint * (toScore - prev),
          });
          prev = toScore;
        }
      }
      return out;
    };

    // ---- Part-ын НИЙТ зорилт (зөвхөн weighted) ----
    let overall: LevelUpTarget | null = null;
    if (part.weighted) {
      let acc = 0;
      for (const m of sectionsMeta) {
        if (m.average === null || m.must <= 0) continue;
        acc += (m.average / m.must) * 100 * m.weight;
      }
      // ⚠️ Band-ыг ХАРУУЛАХ утган дээр хуваарилна (`roundPct`).  `/my/results`
      //    бусад бүх тоогоо `shownBands()`-аар (эхлээд бөөрөнхийлж, дараа нь
      //    band) гаргадаг тул энд түүхий утга дээр хуваарилвал нэг хариултын
      //    дотор band-ын ирмэг дээр хоёр өөр түвшин гарна (84.96 → нэг талд
      //    «85.0% Senior», нөгөө талд «Middle, Senior хүртэл 0.0%»).
      const currentPct = usedWeight > 0 ? roundPct(acc / usedWeight) : null;
      const next = nextLevelFor(levels, currentPct);
      const gap = currentPct !== null && next ? Math.max(0, next.minPct - currentPct) : null;

      let steps: GapStepGroup[] = [];
      let totalGain = 0;
      let covered = false;
      if (gap !== null && gap > 0) {
        const all = sectionsMeta.flatMap((m) => stepsOf(m, partLeverage(m)));
        const { chosen, total } = greedy(all, gap);
        steps = groupSteps(chosen, scale, (s) => s.weight || 0);
        totalGain = total;
        covered = total >= gap - 1e-9;
      } else if (gap === 0) {
        covered = true;
      }

      overall = {
        unit: 'pct',
        current: currentPct,
        currentLevel: bandOut(levelForPct(levels, currentPct)),
        nextLevel: next
          ? { code: next.code, label: next.label, color: next.color, threshold: next.minPct }
          : null,
        atTopLevel: currentPct !== null && next === null,
        gap,
        steps,
        totalGain,
        covered,
      };
    }

    // ---- Хэсэг тус бүрийн зорилт ----
    const sections = sectionsMeta.map<SectionLevelUp>((m) => {
      const itemCount = m.items.length;
      const base = {
        sectionId: m.section.id,
        code: m.section.code,
        title: m.section.title,
        weight: part.weighted ? m.weight : null,
        itemCount,
        leverage: part.weighted ? partLeverage(m) : sectionLeverageMean(m),
      };

      if (part.weighted) {
        // Хэсгийн хувь ч мөн `shownBands()`-аар дамждаг (`skillLevelBlock`) тул
        // ижил бөөрөнхийлөлт — эс бөгөөс хэсгийн badge хоёр газар зөрнө.
        const pct =
          m.average !== null && m.must > 0 ? roundPct((m.average / m.must) * 100) : null;
        const next = nextLevelFor(levels, pct);
        const gap = pct !== null && next ? Math.max(0, next.minPct - pct) : null;
        const gain = sectionLeveragePct(m);
        const { chosen, total } = gap !== null && gap > 0
          ? greedy(stepsOf(m, gain), gap)
          : { chosen: [] as Step[], total: 0 };
        return {
          ...base,
          unit: 'pct' as const,
          current: pct,
          currentLevel: bandOut(levelForPct(levels, pct)),
          nextLevel: next
            ? { code: next.code, label: next.label, color: next.color, threshold: next.minPct }
            : null,
          atTopLevel: pct !== null && next === null,
          gap,
          steps: groupSteps(chosen, scale, () => m.weight),
          totalGain: total,
          covered: gap === null ? false : total >= gap - 1e-9,
        };
      }

      // Зан чанар (I5): ХУВЬ БИШ — 1.0..scale.max дундаж, BEHAVIOR_BANDS.
      const mean = m.average !== null && itemCount > 0 ? m.average / itemCount : null;
      const nextBand = nextBandForMean(mean);
      const gap = mean !== null && nextBand ? Math.max(0, nextBand.minMean - mean) : null;
      const gain = sectionLeverageMean(m);
      const { chosen, total } = gap !== null && gap > 0
        ? greedy(stepsOf(m, gain), gap)
        : { chosen: [] as Step[], total: 0 };
      return {
        ...base,
        unit: 'mean' as const,
        current: mean,
        currentLevel: bandOut(bandForMean(mean)),
        nextLevel: nextBand
          ? {
              code: nextBand.code,
              label: nextBand.label,
              color: nextBand.color,
              threshold: nextBand.minMean,
            }
          : null,
        atTopLevel: mean !== null && nextBand === null,
        gap,
        steps: groupSteps(chosen, scale, () => null),
        totalGain: total,
        covered: gap === null ? false : total >= gap - 1e-9,
      };
    });

    return { partId: part.id, title: part.title, weighted: part.weighted, overall, sections };
  });

  return { parts };
}

/** Зан чанарын band-уудыг гарцад хамт явуулахад (UI шатлал зурахад хэрэгтэй). */
export const BEHAVIOR_BAND_LIST = BEHAVIOR_BANDS;
