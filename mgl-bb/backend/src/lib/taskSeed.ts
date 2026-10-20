/**
 * ХУУЧИН ТАСКИЙГ «MANAGED» БОЛГОХ ҮЕИЙН SEED — хэний хийсэн хэсэг вэ гэдгийг ЗӨВХӨН нотолгоогоор (2026-10-02).
 *
 * Хуваарилалтын шинэ урсгалд анх орох таск нь ердийн (хуваагдаагүй) таск, түүхтэй байж болно.
 * Түүхийг шилжүүлэхэд:
 *   • Шинэ оноо ХЭЗЭЭ Ч олгохгүй — seed нь зөвхөн одоо байгаа `user_points` мөрүүдийг
 *     хэсэг (slice) болгон журналд ЛАВЛАНА (анхны өдөр, анхны дүн хэвээр).
 *   • Хийсэн хэсгийг тохиромжтой хүнд ХЭЗЭЭ Ч оноохгүй.  Нотолгоо нь цэвэр бол (түүх нэмэгдэж
 *     байсан, оноо хүчинтэй хувьтай таарна) хүн бүрийн оноо авсан хэсэг нь түүний хийсэн.  Эс бол
 *     бүхэл хүчинтэй хийсэн нь «эзэнгүй» (B) болж түгжигдэнэ — хүн бүрт хүрэхгүй, шинэ ажилтанд
 *     шилжихгүй, ажилтан өөрөө засах эрхгүй (зөвхөн удирдлагын хяналттай урсгал).
 *   • Хуучин HWM-д төлөгдсөн атлаа одоо хүчинтэй биш хэсэг (77 → 8) `slack` болж үлдэнэ —
 *     шинэ хийсэн хэсэг эхлээд түүнийг дүүргэнэ, тиймээс дахин төлөгдөхгүй (`taskCredit.ts`).
 *
 * Энэ файл ЦЭВЭР — D1 уншихгүй, юу ч импортлохгүй.
 */

export const SEED_UNITS_PER_POINT = 10_000;

export interface SeedEntry {
  id: number;
  /** Бичлэгийг оруулсан хэрэглэгч. */
  userId: number;
  /** `progress_entries.credit_user_id` (0368) — baseline-д оноо авах хүн. */
  creditUserId: number | null;
  isBaseline: boolean;
  source: string | null;
  /** Хувь × 10 000 (бүхэл). */
  units: number;
}

export interface SeedCreditRow {
  pointsId: number;
  userId: number;
  deltaPct: number;
  amount: number;
  awardedAt: string;
  progressEntryId: number | null;
}

export interface SeedSlice {
  userId: number;
  /** Энэ мөрөөс гарсан үндсэн ажлын хийсэн нэгж. */
  units: number;
  amount: number;
  deltaPct: number;
  awardedAt: string;
  pointsId: number;
  progressEntryId: number | null;
}

export type SeedAttribution = 'empty' | 'clean' | 'uncertain';

export type SeedPlan =
  | {
      ok: true;
      attribution: SeedAttribution;
      /** Одоо хүчинтэй хийсэн (нэгж) = сүүлийн батлагдсан хувь. */
      rootDoneUnits: number;
      /** Хүнд оноогдсон хэсгүүд (`attribution='clean'`-д л). */
      slices: SeedSlice[];
      /** B — эзэнгүй, түгжигдсэн хийсэн. */
      unattributedUnits: number;
      /** Төлөгдсөн атлаа одоо хүчинтэй биш нэгж. */
      slackUnits: number;
      /** Шийдвэрийн тайлбар (аудит). */
      reasons: string[];
    }
  | { ok: false; code: 'SPLIT_DONE_PART' | 'BAD_INPUT'; message: string };

/** Бүхэл нэгжид дугуйлах алдааны хүлцэл: мөр бүр ≤ 0.5 нэгж, дор хаяж 5. */
function tolerance(rows: number): number {
  return Math.max(5, rows);
}

/**
 * Хуучин түүхийг шинжилж seed төлөвлөнө.  `entries` нь батлагдсан бичлэгүүд
 * (`created_at, id` өсөхөөр), `credits` нь тухайн таскийн `source='progress'` оноо.
 */
export function planSeed(input: {
  entries: readonly SeedEntry[];
  credits: readonly SeedCreditRow[];
  /** Таскийн төслийн коэффициент (`taskProjectCoef`). */
  coef: number;
}): SeedPlan {
  const { entries, credits, coef } = input;
  if (!Number.isFinite(coef) || coef < 0) return { ok: false, code: 'BAD_INPUT', message: 'coef буруу' };
  if (entries.some((e) => e.source === 'split')) {
    return {
      ok: false,
      code: 'SPLIT_DONE_PART',
      message: 'Энэ нь хуучин хуваалтын «хийгдсэн хэсэг» — дууссан тул шинэ хуваарилалт хийх боломжгүй',
    };
  }
  const reasons: string[] = [];
  const latest = entries.length > 0 ? entries[entries.length - 1]!.units : 0;
  if (!Number.isSafeInteger(latest) || latest < 0 || latest > 100 * SEED_UNITS_PER_POINT) {
    return { ok: false, code: 'BAD_INPUT', message: 'Сүүлийн хувь буруу' };
  }

  // Оноо авсан мөр бүрийг үндсэн ажлын нэгж рүү хөрвүүлнэ (coef > 0 үед л утга бий).
  const rows: SeedSlice[] = [];
  let credited = 0;
  if (coef > 0) {
    for (const c of credits) {
      const units = Math.round((c.deltaPct / coef) * SEED_UNITS_PER_POINT);
      if (!(units > 0)) continue;
      rows.push({
        userId: c.userId,
        units,
        amount: c.amount,
        deltaPct: c.deltaPct,
        awardedAt: c.awardedAt,
        pointsId: c.pointsId,
        progressEntryId: c.progressEntryId,
      });
      credited += units;
    }
  } else if (credits.length > 0) {
    reasons.push('ZERO_COEF_WITH_CREDIT');
  }

  if (entries.length === 0 || latest === 0) {
    reasons.push(entries.length === 0 ? 'NO_ENTRIES' : 'LATEST_ZERO');
    // Хүчинтэй хийсэн 0 — харин өмнө нь төлөгдсөн оноо slack болж үлдэнэ (дахин төлөхгүй).
    return {
      ok: true,
      attribution: 'empty',
      rootDoneUnits: 0,
      slices: [],
      unattributedUnits: 0,
      slackUnits: credited,
      reasons,
    };
  }

  // Монотон байдал: хувь хэзээ ч буураагүй.
  let monotone = true;
  for (let i = 1; i < entries.length; i++) {
    if (entries[i]!.units < entries[i - 1]!.units) {
      monotone = false;
      reasons.push(`DECREASE_AT_ENTRY:${entries[i]!.id}`);
      break;
    }
  }
  // Baseline-ийн оноо авагч нь тодорхой байх (null бол тэр хэсэг хэнийх ч биш).
  const orphanBaseline = entries.some((e) => e.isBaseline && (e.creditUserId ?? null) === null);
  if (orphanBaseline) reasons.push('BASELINE_WITHOUT_CREDIT_USER');

  const tol = tolerance(rows.length);
  const withinLatest = credited <= latest + tol;

  if (monotone && withinLatest && coef > 0) {
    // Цэвэр: хүн бүрийн оноо авсан хэсэг нь түүний хийсэн.  Давсан хэсгийг (дугуйлалт) хамгийн сүүлийн
    // хэсгүүдээс хасаж үндсэн ажлын хийсэнтэй ЯГ таарахаар болгоно.
    let excess = Math.max(0, credited - latest);
    const slices = rows.map((r) => ({ ...r }));
    for (let i = slices.length - 1; i >= 0 && excess > 0; i--) {
      const take = Math.min(excess, slices[i]!.units - 1 >= 0 ? slices[i]!.units : 0);
      slices[i]!.units -= take;
      excess -= take;
    }
    const keep = slices.filter((s) => s.units > 0);
    const attributed = keep.reduce((s, r) => s + r.units, 0);
    const unattributed = Math.max(0, latest - attributed);
    if (unattributed > 0) reasons.push('UNATTRIBUTED_REMAINDER');
    reasons.push('CLEAN_MONOTONE');
    return {
      ok: true,
      attribution: 'clean',
      rootDoneUnits: latest,
      slices: keep,
      unattributedUnits: unattributed,
      slackUnits: 0,
      reasons,
    };
  }

  // Эргэлзээтэй: бүх хүчинтэй хийсэн нь эзэнгүй, одоо байгаа оноо хэвээр, илүү төлсөн нь slack.
  if (!monotone) reasons.push('NOT_MONOTONE');
  if (!withinLatest) reasons.push('CREDIT_EXCEEDS_VALID');
  if (coef <= 0) reasons.push('ZERO_COEF');
  reasons.push('UNCERTAIN_ALL_UNATTRIBUTED');
  return {
    ok: true,
    attribution: 'uncertain',
    rootDoneUnits: latest,
    slices: [],
    unattributedUnits: latest,
    slackUnits: Math.max(0, credited - latest),
    reasons,
  };
}
