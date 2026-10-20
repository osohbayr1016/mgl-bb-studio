/**
 * Багийн (олон оролцогчийн) дундаж харагдацын НЭГТГЭЛ.
 *
 * ⚠️ Яагаад тусдаа файл вэ: энэ логик өмнө нь `exportAssessmentXlsx.ts` дотор
 *    байсан — тэр модуль нь `exceljs`-ийн төрлүүдийг чирдэг тул зөвхөн тоо
 *    нэгтгэх код нь Excel-ээс салангид байх ёстой. Excel файл эдгээрийг
 *    эндээс импортлож, ХУУЧИН нэрсээр нь дахин экспортолж байгаа тул одоо
 *    байгаа импортлогчид (RoundResultsView, ParticipantDetail, chartImage)
 *    хэвээрээ ажиллана.
 *
 * ── «Дундаж» гэж юу вэ (2026-08 засвар) ──────────────────────────────────
 * Багийн дундаж нь **өөрийн үнэлгээгээ илгээсэн БҮХ хүн** дээр бодогдоно —
 * хүн маягтаа илгээсэн даруйдаа дундажид ОРНО.  Ахлагч нь түүнийг дараа
 * үнэлээд submit дарвал тухайн хүний оноо (`result.average` = илгээсэн
 * талуудын дундаж) шинэчлэгдэж, багийн дундаж ч дагаад хөдөлнө.
 *
 * Тиймээс цуваа бүрийн НЭРЛЭГЧ (denominator) ЯЛГААТАЙ байж болно:
 *   · «Өөрийн үнэлгээ» → self илгээсэн хүмүүс (жишээ нь 11),
 *   · «Ахлагчийн үнэлгээ» → ахлагч үнэлсэн хүмүүс (жишээ нь 3),
 *   · «Дундаж» → хүн бүрийн ӨӨРИЙНХ нь `average`-ийн дундаж (11 хүн).
 *
 * ⚠️ Үүнээс болж «Дундаж» нь self ба senior хоёрын ХООРОНД байх БАТАЛГАА
 *    БАЙХГҮЙ (senior-той 3 хүн бүх багийг төлөөлөхгүй).  Энэ нь буг биш,
 *    зориудын шийдвэр — тиймээс легендэд цуваа бүрийн хүний тоог бичиж
 *    (`seriesMemberCounts`), `checkAverageInvariant`-ыг зөвхөн нэрлэгч нь
 *    ижил үед (`mode: 'both'`) ажиллуулна.
 *
 * Хатуу харьцуулалт хэрэгтэй үед админ `'both'` горим руу шилжинэ — тэнд
 * бүх гишүүн хоёуланг илгээсэн тул гурван шугам ижил хүмүүс дээр бодогдож,
 * инвариант дахин хүчинтэй болно.
 */

import type { ParticipantResult } from '../api';
import type { AssessmentLevelBand } from '../types';
import { levelForPct } from './score';

/** Серверээс ирдэг бодогдсон part / section (snake_case). */
export type ResultPart = ParticipantResult['parts'][number];
export type ResultSection = ResultPart['sections'][number];

// ---------------------------------------------------------------------------
// Cohort — «хэн дээр бодох вэ»
// ---------------------------------------------------------------------------

/**
 * `'self'` — өөрийн үнэлгээгээ илгээсэн БҮГД.  **АНХДАГЧ**: хүн маягтаа
 * илгээсэн даруйдаа багийн дундажид орох ёстой.  Ахлагчийн үнэлгээ ирсэн
 * хүмүүст тэр нь тухайн хүний `average`-д аль хэдийн орсон байдаг.
 *
 * `'both'` — self БА senior хоёуланг илгээсэн хүмүүс.  Гурван шугамыг ЯГ
 * ижил хүмүүс дээр харьцуулах хатуу горим (нэрлэгч нь ижил тул «Дундаж» нь
 * хоёрын хооронд байх нь баталгаатай).
 */
export type CohortMode = 'both' | 'self';

/** Cohort-оос хасагдсан шалтгаан. */
export type CohortExcludeReason = 'no-senior' | 'no-self';

export interface Cohort {
  /** Аль горимоор бодогдсон. */
  mode: CohortMode;
  /** Дундажид ОРСОН хүмүүс (mode='both' → self+senior хоёулаа илгээсэн;
   *  mode='self' → self илгээсэн). */
  members: ParticipantResult[];
  /** Ямар нэг зүйл илгээсэн ч cohort-д ОРООГҮЙ хүмүүс (шалтгаантайгаа). */
  excluded: { result: ParticipantResult; reason: CohortExcludeReason }[];
  /** Огт юу ч илгээгээгүй хүмүүс. */
  pending: ParticipantResult[];
  /** 'both' горим боломжтой юу (дор хаяж 1 хүн хоёуланг илгээсэн). */
  bothAvailable: boolean;
}

/**
 * Cohort бүрдүүлнэ.  `mode` өгөөгүй бол ҮРГЭЛЖ `'self'` — өөрийн үнэлгээгээ
 * илгээсэн хүн бүр шууд дундажид орно.  (Өмнө нь ахлагчтай хүн байвал
 * `'both'` руу автоматаар үсэрдэг байсан тул 11 хүнээс 1 нь л дундажид
 * ордог, «Багийн дундаж — 1 хүний судалгаанд суурилсан» гэж гардаг байв.)
 *
 * Жагсаалтын дараалал нь ирсэн массивынхаа дарааллыг хадгална (нэр/багаар
 * эрэмбэлэгдсэн байдаг тул UI-д тэр чигээрээ харуулж болно).
 */
export function buildCohort(results: ParticipantResult[], mode?: CohortMode): Cohort {
  let bothCount = 0;
  for (const r of results) {
    if (r.self_submitted && r.senior_submitted) bothCount += 1;
  }
  const bothAvailable = bothCount > 0;
  const resolved: CohortMode = mode ?? 'self';

  const members: ParticipantResult[] = [];
  const excluded: { result: ParticipantResult; reason: CohortExcludeReason }[] = [];
  const pending: ParticipantResult[] = [];

  for (const result of results) {
    const hasSelf = !!result.self_submitted;
    const hasSenior = !!result.senior_submitted;

    // Огт юу ч илгээгээгүй — хасагдсан биш, зүгээр л хүлээгдэж буй.
    if (!hasSelf && !hasSenior) {
      pending.push(result);
      continue;
    }

    if (resolved === 'both') {
      if (hasSelf && hasSenior) members.push(result);
      else excluded.push({ result, reason: hasSelf ? 'no-senior' : 'no-self' });
    } else {
      // 'self' горимд senior заавал биш — зөвхөн self байхгүй хүн хасагдана.
      if (hasSelf) members.push(result);
      else excluded.push({ result, reason: 'no-self' });
    }
  }

  return { mode: resolved, members, excluded, pending, bothAvailable };
}

// ---------------------------------------------------------------------------
// Дундаж
// ---------------------------------------------------------------------------

/** null-уудыг алгасаж дунджилна. Бүгд null бол null. */
export function meanOf(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Цуваа тус бүрийн НЭРЛЭГЧ — легендэд «Ахлагчийн үнэлгээ (3)» гэж бичнэ. */
export interface SeriesMemberCounts {
  /** «Дундаж» цуваа — cohort-ийн бүх гишүүн. */
  average: number;
  /** «Өөрийн үнэлгээ» цуваа — self илгээсэн гишүүд. */
  self: number;
  /** «Ахлагчийн үнэлгээ» цуваа — ахлагч үнэлсэн гишүүд. */
  senior: number;
}

export function seriesMemberCounts(members: ParticipantResult[]): SeriesMemberCounts {
  let self = 0;
  let senior = 0;
  for (const m of members) {
    if (m.self_submitted) self += 1;
    if (m.senior_submitted) senior += 1;
  }
  return { average: members.length, self, senior };
}

/** Гурван цуваа ЯГ ижил хүмүүс дээр бодогдсон уу (инвариант шалгах эсэх). */
export function hasSharedDenominator(counts: SeriesMemberCounts): boolean {
  return counts.self === counts.average && counts.senior === counts.average;
}

/**
 * Олон оролцогчийн үр дүнг НЭГ дундаж хүн болгож нэгтгэнэ (багийн харагдац =
 * гишүүдийн дундаж нэг шугам). `must` нь схемээс гардаг тул хэвээр үлдэнэ.
 *
 * ⚠️ Ирсэн массивыг АЛЬ ХЭДИЙН cohort болсон гэж үзнэ (`buildCohort(...).members`)
 *    — дотроо хэн нэгнийг шүүхгүй.
 *
 * Цуваа бүр ӨӨРИЙН нэрлэгчээр бодогдоно (файлын толгойг үз):
 *   · self   → self утгатай гишүүд,
 *   · senior → senior утгатай гишүүд (ихэвчлэн цөөн),
 *   · дундаж → гишүүн бүрийн ӨӨРИЙНХ нь `average` / `pct`-ийн дундаж.
 *
 * «Дундаж» нь хоёр багийн шугамын дундаж БИШ, харин хүн тус бүрийн дундажийн
 * дундаж — ингэснээр ахлагч submit дарахад тухайн хүний оноо шинэчлэгдэж,
 * багийн дундаж шууд хөдөлнө.
 */
export function averageParts(
  members: ParticipantResult[],
  levels: AssessmentLevelBand[],
): ResultPart[] {
  const first = members[0];
  if (!first) return [];

  return first.parts.map((part, pi) => {
    const peers = members.map((r) => r.parts[pi]).filter((p): p is ResultPart => !!p);

    const sections: ResultSection[] = part.sections.map((section, si) => {
      const cells = peers.map((p) => p.sections[si]).filter((c): c is ResultSection => !!c);

      // `meanOf` null-ыг алгасдаг тул тал тус бүр өөрийн нэрлэгчээ автоматаар
      // авна: ахлагчгүй хүний `senior` нь null учир senior дундажид орохгүй.
      const self = meanOf(cells.map((c) => c.self));
      const senior = meanOf(cells.map((c) => c.senior));
      const selfPct = meanOf(cells.map((c) => c.self_pct));
      const seniorPct = meanOf(cells.map((c) => c.senior_pct));

      // Хүн тус бүрийн `average`/`pct` нь СЕРВЕР талд «зөвхөн илгээсэн
      // талуудын дундаж» болж бодогддог (spec §1) — тиймээс энд зүгээр л
      // тэднийг дунджилахад ахлагчийн үнэлгээ автоматаар тусна.
      const average = meanOf(cells.map((c) => c.average));
      const pct = meanOf(cells.map((c) => c.pct));

      return {
        ...section,
        self,
        senior,
        average,
        self_pct: selfPct,
        senior_pct: seniorPct,
        pct,
        level: levelForPct(levels, pct),
      };
    });

    // Нийт мөр (НИЙТ) — хэсгүүдтэй ижил зарчмаар.
    const totalSelf = meanOf(peers.map((p) => p.totals.self));
    const totalSenior = meanOf(peers.map((p) => p.totals.senior));
    const totalAverage = meanOf(peers.map((p) => p.totals.average));

    // Нийт хувь нь хэсгүүдээс ДАХИН бодогдохгүй — гишүүн бүрийн нийт хувийн
    // дундаж (тэгснээр «дундаж хүн»-ий тоо жинхэнэ хүмүүсийн дунджтай таарна).
    const overallPct = part.weighted ? meanOf(peers.map((p) => p.overall_pct)) : null;

    return {
      ...part,
      sections,
      totals: {
        must: part.totals.must,
        self: totalSelf,
        senior: totalSenior,
        average: totalAverage,
      },
      overall_pct: overallPct,
      overall_level: part.weighted ? levelForPct(levels, overallPct) : null,
    };
  });
}

/** Хүний «нүүр» болох part — жинтэй нь, эс бөгөөс эхнийх. */
export function headlinePart(result: ParticipantResult): ResultPart | null {
  return result.parts.find((p) => p.weighted) ?? result.parts[0] ?? null;
}

/** Аль тал бөглөгдсөн бэ — цуваа харуулах эсэхийг үүгээр шийднэ. */
export function sidesPresent(parts: ResultPart[]): { self: boolean; senior: boolean } {
  return {
    self: parts.some((p) => p.sections.some((s) => s.self !== null)),
    senior: parts.some((p) => p.sections.some((s) => s.senior !== null)),
  };
}

// ---------------------------------------------------------------------------
// Инвариант шалгагч
// ---------------------------------------------------------------------------

/** Хөвөх тооны дугуйралтад өгөх хүлцэл (хувиар). */
const INVARIANT_TOLERANCE = 0.01;

/**
 * Хэсэг бүрд `pct` нь `min(self_pct, senior_pct)` ба `max(...)` хоёрын хооронд
 * (0.01 хүлцэлтэй) байгааг шалгана. Хоёр талын аль нэг нь байхгүй бол
 * шалгах зүйлгүй тул алгасна.
 *
 * ⚠️ Энэ инвариант нь ЗӨВХӨН гурван цуваа ИЖИЛ хүмүүс дээр бодогдсон үед
 *    хүчинтэй (`hasSharedDenominator`, ихэвчлэн `mode: 'both'`).  Анхдагч
 *    `'self'` горимд ахлагчийн шугам цөөн хүн дээр бодогддог тул «дундаж»
 *    түүний гадна унах нь ХЭВИЙН — дуудагч тал өөрөө шалгаад алгасна.
 *
 * Зөрчлийн уншигдахуйц тайлбарын массив буцаана — ХООСОН бол бүх зүйл зөв.
 * (Энэ нь хөгжүүлэлтийн оношилгоо — хэрэглэгчид харагдахгүй тул i18n-гүй.)
 */
export function checkAverageInvariant(parts: ResultPart[]): string[] {
  const problems: string[] = [];

  for (const part of parts) {
    for (const section of part.sections) {
      const self = section.self_pct;
      const senior = section.senior_pct;
      if (!isNum(self) || !isNum(senior)) continue;

      const where = `${part.part_id}/${section.code || section.section_id}`;
      const pct = section.pct;
      if (!isNum(pct)) {
        problems.push(
          `${where}: pct алга байна (self ${self.toFixed(2)}%, senior ${senior.toFixed(2)}%)`,
        );
        continue;
      }

      const lo = Math.min(self, senior);
      const hi = Math.max(self, senior);
      if (pct < lo - INVARIANT_TOLERANCE || pct > hi + INVARIANT_TOLERANCE) {
        problems.push(
          `${where}: pct ${pct.toFixed(2)}% нь self ${self.toFixed(2)}% ба senior ` +
            `${senior.toFixed(2)}% хоёрын завсарт алга`,
        );
      }
    }
  }

  return problems;
}
