/**
 * Төслийн бус ажлын АДМИНЫ ШАЛГАЛТ (0343/0344) — ЦЭВЭР дүрэм.
 *
 * Урсгал (эзний шаардлага, 2026-09-24; 2026-09-28-нд шинэчилсэн):
 *   ажилтан ирцэд ажлаа сонгоно (зөвхөн хяналт) → ажлаа хийнэ → дуусгасны
 *   дараа «Миний ажлууд»-аас «юу хийсэн» + эхэлсэн/дууссан цагаа оруулж
 *   шалгуулахаар илгээнэ → админ «Тайлан → Төслийн бус ажлын тайлан» дээр
 *   шалгана → батална / татгалзана.
 *
 * Төлөв нь 0342-ийн `status` (pending/approved/rejected) + `report` + цагаас
 * гарсан ШАТ (`entryStage`, lib/nonProjectWork.ts) — энд шинэ төлөв
 * ЗОХИОГООГҮЙ.  Шийдвэр зөвхөн `awaiting_review` шатанд: тайлбар эсвэл цаг
 * дутуу (`needs_report`) мөр нь ажилтан хараахан «илгээгээгүй» ажил.
 *
 * Бүтээмж: батлах үед л оноо бичигдэнэ (эзний шийдвэр — засвартай ИЖИЛ
 * томьёо, `pctForHours(өдрийн ханш, цаг)`, lib/repairProgress.ts).  Хүлээгдэж
 * буй / татгалзсан ажил онооны дэвтэрт ОГТ орохгүй.
 */
import { entryStage, type NonProjectStage, type NonProjectStatus } from './nonProjectWork';

/** `user_points.source` — 0343-ийн CHECK энэ утгыг нэрээр нь таньдаг. */
export const NON_PROJECT_POINTS_SOURCE = 'non_project';

export const REVIEW_NOTE_MAX = 1000;

/** Тайлангийн табын шүүлт: дөрвөн шат + бүгд.  Өгөгдмөл нь шалгах ёстой нь. */
export const REVIEW_FILTERS = ['awaiting_review', 'needs_report', 'approved', 'rejected', 'all'] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

export function parseReviewFilter(raw: unknown): ReviewFilter {
  return (REVIEW_FILTERS as readonly unknown[]).includes(raw) ? (raw as ReviewFilter) : 'awaiting_review';
}

/**
 * «Илгээсэн» = тайлбар бичсэн (хоосон зай = бичээгүй) БА цагаа оруулсан —
 * `entryStage`-тэй ИЖИЛ тодорхойлолт.  Ирцэд сонгосон цаггүй мөр ажилтан
 * «Миний ажлууд»-аас дуусгах хүртэл илгээгдээгүйд тооцогдоно.
 */
const SUBMITTED = `(e.report IS NOT NULL AND TRIM(e.report) <> '' AND e.start_time IS NOT NULL)`;

/**
 * Шат бүрийн WHERE хэсэг (`e` = non_project_work_entries).  `entryStage`-ийн
 * SQL хос — тест нь хоёуланг бодит SQLite дээр тулгана.
 */
export const STAGE_WHERE: Record<NonProjectStage, string> = {
  awaiting_review: `e.status = 'pending' AND ${SUBMITTED}`,
  needs_report: `e.status = 'pending' AND NOT ${SUBMITTED}`,
  approved: `e.status = 'approved'`,
  rejected: `e.status = 'rejected'`,
};

export function filterWhere(f: ReviewFilter): string {
  return f === 'all' ? '1 = 1' : STAGE_WHERE[f];
}

/** Шийдвэрийн тэмдэглэл (сонголттой) — хоосон бол null. */
export function normalizeReviewNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, REVIEW_NOTE_MAX);
  return s ? s : null;
}

export type ReviewBlock = { status: 409; code: 'ALREADY_DECIDED' | 'NOT_SUBMITTED'; error: string };

/**
 * Шийдвэр гаргаж болох эсэх.  `null` = болно.  Батлах, татгалзах хоёулаа
 * ижил нөхцөлтэй: зөвхөн ажилтны ИЛГЭЭСЭН (тайлбар + цагтай), шийдэгдээгүй мөр.
 */
export function reviewBlock(row: {
  status: NonProjectStatus;
  report: string | null;
  start_time: string | null;
}): ReviewBlock | null {
  const stage = entryStage(row);
  if (stage === 'approved' || stage === 'rejected') {
    return { status: 409, code: 'ALREADY_DECIDED', error: 'Энэ бүртгэлийн шийдвэр аль хэдийн гарсан байна' };
  }
  if (stage === 'needs_report') {
    return {
      status: 409,
      code: 'NOT_SUBMITTED',
      error: 'Ажилтан «Миний ажлууд»-аас юу хийснээ, эхэлсэн/дууссан цагаа оруулж дуусгаагүй байна',
    };
  }
  return null;
}

/** Бүртгэлийн минут → цаг (засварын томьёо цагаар бодогддог). */
export function minutesToHours(minutes: number): number {
  return Number.isFinite(minutes) && minutes > 0 ? minutes / 60 : 0;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Батлагдсан ажлын оноо АЖИЛ ХИЙСЭН ӨДӨРТ хамаарна (эзний шийдвэр, 2026-09-24):
 * 22-нд хийсэн ажлыг 24-нд баталсан ч оноо нь 22-ных.  `user_points.awarded_at`
 * (UTC) нь Тайлангийн өдөр/7 хоног/сар, онооны самбарын цонх, өдрийн snapshot-ын
 * ГАНЦ огноо тул хариуг энд тавина — батлах нь зөвхөн хүчинтэй болгох хаалга.
 *
 * Утга = ажлын өдрийн дуусах цаг (байгууллагын цагийн бүс) → UTC.  Тэр мөч хараахан
 * ирээгүй бол (өнөөдрийн ажлыг дуусахаас нь өмнө баталсан) одоогийн мөч — ирээдүйн
 * огноотой оноо бичигдэхгүй, тэр нь ч мөн ажлын өдөр.  Буруу огноо/цаг бол null
 * (дуудагч одоогийн мөчөөр бичнэ).
 */
export function workDateAwardedAt(
  entry: { date: string; end_time: string },
  offsetMinutes: number,
  nowMs: number,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !/^\d{2}:\d{2}/.test(entry.end_time)) return null;
  const localMs = Date.parse(`${entry.date}T${entry.end_time.slice(0, 5)}:00Z`);
  if (!Number.isFinite(localMs)) return null;
  const d = new Date(Math.min(localMs - offsetMinutes * 60_000, nowMs));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}
