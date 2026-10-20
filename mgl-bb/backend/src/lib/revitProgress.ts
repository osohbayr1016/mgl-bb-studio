/**
 * Revit-ээс ирсэн явцын ХУВИЙГ гаргах цэвэр логик.
 *
 * ⚠️ ТӨВ ДҮРЭМ — Revit-ээс 100% нь ЗӨВХӨН ИЛ «ХААХ» үйлдлээр.
 * Машины гаргасан тоо (санал) ҮРГЭЛЖ 99-өөр таглагдана (`CEILING`).  Ажил хаах
 * нь ухамсартай тусдаа үйлдэл: `completion_questions`-ийн хариутай
 * (`completion_qa`).  Ингэснээр:
 *   • санал, checklist, «хуудас бүгд бэлэн» гэх мэт машины тооноос 100%
 *     ХЭЗЭЭ Ч гарахгүй — `completion_qa`-гүй 100 нь `above_ceiling`
 *   • `tasks.ai_completion_summary` зохиомол хариултаар хэзээ ч тэжээгдэхгүй —
 *     хариуг ХҮН бичнэ, `submitProgressEntry` бүрэн эсэхийг нь шалгана (400)
 *   • `archiveProjectIfComplete` Revit-ээс санамсаргүй асахгүй
 *
 * ⚠️ 2026-09-29 — ЭЗНИЙ ШИЙДВЭР (Revit work tracking MVP): «ажилтан Revit
 * дотроос таскаа 100% болгож хааж болно — вэбийнхтэй ЯГ ижил дуусгалтын
 * асуулттай».  Үүнээс өмнө (2026-08-24) Revit-ээс 100% огт хориотой байсан;
 * тэр үеийн гол шалтгаан болох «100% → ахлагчийн батлах дараалал» 2026-09-17-нд
 * хасагдсан.  Тиймээс `verifySubmittedPercent(..., { completing: true })` нь
 * ЯГ 100-г зөвшөөрнө; дуусгалтын хариуны БҮРЭН эсэхийг ганц газар —
 * `progress.ts` `submitProgressEntry` (вэбтэй нэг дүрэм) шалгана.
 *
 * Хувийн шатлал (шийдвэр ① — checklist байхгүй бол ЗОХИОХГҮЙ):
 *   1. checklist  → round(done / total × 100)      basis='checklist'
 *   2. sheets     → round(ready / planned × 100)   basis='sheets'
 *   3. бусад      → null                           basis='none'  ← ЧАНГА, нуухгүй
 *
 * ⚠️ `derived` бол САНАЛ, таталцах хязгаар БИШ.  Инженер түүнээс дээш
 * гараар өргөж болно — деталчлал, зохицуулалт, хэмжээс тавих зэрэг
 * checklist-д тусдаггүй бодит ажил байдаг.  Зөрүү нь
 * `revit_submissions.suggested_percentage` vs `percentage` болж аудитад
 * ХАРАГДАНА.  Хатуу хязгаар нь ГАНЦ: `CEILING`.
 *
 * `basis='none'` үед инженер өөрөө тоо бичнэ; аудит мөрөнд
 * `percent_basis='manual'` гэж бүртгэгдэж, гаралт нь шударгаар хоосон байна.
 * Элементийн өсөлтөөр таамаглахыг САНААТАЙ хассан: элементийн тоо бол
 * дизайны бүрэн байдлын муу прокси (деталчлал, зохицуулалт, хэмжээс тавих
 * нь бараг элемент нэмдэггүй), гэтэл «тооцоолсон мэт» тоо нь зохих ёсноос
 * илүү итгэл төрүүлдэг.
 */

/**
 * Машины гаргасан хувийн (санал) ДЭЭД хязгаар.  100 нь зөвхөн ил «хаах»
 * үйлдлээр (`COMPLETE` + `completion_qa`) — вэб эсвэл Revit.
 */
export const CEILING = 99;

/** Ажил ХААХ хувь — `verifySubmittedPercent`-ийн `completing` замаар л. */
export const COMPLETE = 100;

export type PercentBasis = 'checklist' | 'sheets' | 'manual' | 'none';

export interface DeriveInput {
  /** Тухайн хэрэглэгчийн энэ таск дээрх checklist.  Байхгүй бол 0/0. */
  checklistDone: number;
  checklistTotal: number;
  /** Холбогдсон хуудаснуудаас «бэлэн» гэж тэмдэглэгдсэн нь / нийт. */
  sheetsReady?: number;
  sheetsPlanned?: number;
  /** Тухайн таскийн одоогийн батлагдсан хувь. */
  currentPercent: number;
}

export interface DeriveResult {
  /** Өгөгдлөөс гарсан ШУДАРГА тоо.  `basis='none'` үед null. */
  derived: number | null;
  /** Панельд урьдчилан бөглөх тоо — ухралт санал болгохгүй. */
  suggested: number | null;
  /** Сервер таталцах ДЭЭД хязгаар.  Үүнээс дээш илгээвэл 400. */
  ceiling: number;
  basis: Exclude<PercentBasis, 'manual'>;
  /** Хүнд харуулах гаралтын тайлбар.  `basis='none'` үед хоосон. */
  detail: string;
}

function pct(done: number, total: number): number {
  return Math.round((done / total) * 100);
}

/**
 * Хувийг гаргана.  Цэвэр функц — D1 хүрэхгүй, огноо уншихгүй.
 *
 * `ceiling` нь ҮРГЭЛЖ буцаана (basis юу ч байсан), учир нь сервер талын
 * шалгалт `percentage > ceiling → 400` нь бүх замд ижилхэн үйлчилнэ.
 */
export function deriveSuggestedPercent(input: DeriveInput): DeriveResult {
  const current = clampPercent(input.currentPercent);

  const total = Math.max(0, Math.trunc(input.checklistTotal));
  const done = Math.min(total, Math.max(0, Math.trunc(input.checklistDone)));

  if (total > 0) {
    const raw = pct(done, total);
    const capped = Math.min(CEILING, raw);
    return {
      derived: capped,
      // ⚠️ Тагаас ХЭТРЭХГҮЙ.  `max(current, …)` нь ухралт санал болгохоос
      // сэргийлдэг ч, одоогийн хувь 100 байвал 100-г санал болгож, сервер
      // тэрийг above_ceiling гэж татгалзана — панель гацна.  Бодит өгөгдөл
      // дээр яг ийм ажил тохиолдсон (2026-08-24).
      suggested: Math.min(CEILING, Math.max(current, capped)),
      ceiling: CEILING,
      basis: 'checklist',
      detail: `Checklist ${done}/${total} → ${raw}%`,
    };
  }

  const planned = Math.max(0, Math.trunc(input.sheetsPlanned ?? 0));
  const ready = Math.min(planned, Math.max(0, Math.trunc(input.sheetsReady ?? 0)));

  if (planned > 0) {
    const raw = pct(ready, planned);
    const capped = Math.min(CEILING, raw);
    return {
      derived: capped,
      suggested: Math.min(CEILING, Math.max(current, capped)),
      ceiling: CEILING,
      basis: 'sheets',
      detail: `Хуудас ${ready}/${planned} → ${raw}%`,
    };
  }

  // Гаралт байхгүй.  Тоо ЗОХИОХГҮЙ — инженер өөрөө бичнэ.
  return {
    derived: null,
    suggested: null,
    ceiling: CEILING,
    basis: 'none',
    detail: '',
  };
}

/**
 * Илгээхийг зөвшөөрөх эсэх — сервер талын ЦОРЫН ГАНЦ таталцах шалгалт.
 * `POST /api/revit/submissions` үүнийг D1-ээс ДАХИН тооцоолсон `DeriveResult`
 * дээр ажиллуулна; биеэс ирсэн `suggested_percentage`-д хэзээ ч итгэхгүй.
 */
export type SubmitVerdict =
  | { ok: true; basis: PercentBasis }
  | {
      ok: false;
      code: 'not_a_number' | 'above_ceiling' | 'below_current' | 'already_at_ceiling';
      ceiling: number;
    };

export interface VerifyOptions {
  /**
   * Ажлыг ХААХ оролдлого — хүсэлт `completion_qa` (дуусгалтын асуултын
   * хариу) хавсаргасан.  Зөвхөн энэ үед ЯГ `COMPLETE` (100) зөвшөөрөгдөнө.
   * Хариу БҮРЭН эсэхийг энд шалгахгүй — `submitProgressEntry` (вэбтэй нэг
   * дүрэм) 400 `completion_qa required` буцаана.
   */
  completing?: boolean;
}

export function verifySubmittedPercent(
  submitted: unknown,
  derived: DeriveResult,
  currentPercent: number,
  opts: VerifyOptions = {},
): SubmitVerdict {
  if (typeof submitted !== 'number' || !Number.isFinite(submitted)) {
    return { ok: false, code: 'not_a_number', ceiling: derived.ceiling };
  }
  const current = clampPercent(currentPercent);
  const basis: PercentBasis = derived.basis === 'none' ? 'manual' : derived.basis;

  // Ажил аль хэдийн ДУУССАН (100%) — Revit-ээс нэмэх зүйл алга.  Тусгай код:
  // панель «дууссан» гэж ойлгомжтой хэлнэ («яагаад ч болохгүй» биш).
  if (current >= COMPLETE) {
    return { ok: false, code: 'already_at_ceiling', ceiling: derived.ceiling };
  }

  // ХААХ — ЯГ 100, зөвхөн `completing` үед (эзний 2026-09-29-ний шийдвэр).
  // 100-гаас их нь хэзээ ч хүчинтэй хувь биш.
  if (submitted >= COMPLETE) {
    if (submitted === COMPLETE && opts.completing) return { ok: true, basis };
    return { ok: false, code: 'above_ceiling', ceiling: derived.ceiling };
  }

  // ⚠️ Урьд нь `current >= ceiling` (99) үед ЯМАР Ч утга давахгүй гэж эрт
  //    буцдаг байв — хаах зам байхгүй байсан тул.  Одоо 99% дээрх ажил нь
  //    (а) 99-өөр өдрийн тэмдэглэл, (б) 100-гаар ХААХ хоёрын аль нэгийг хийж
  //    болно; доорх хоёр шалгалт үлдсэнийг барина.
  if (submitted > derived.ceiling) {
    return { ok: false, code: 'above_ceiling', ceiling: derived.ceiling };
  }
  if (submitted < current) {
    return { ok: false, code: 'below_current', ceiling: derived.ceiling };
  }
  // Гаралтгүй бол хүн бичсэн тул 'manual'; байвал гаралтынхаа нэрийг авна.
  return { ok: true, basis };
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
