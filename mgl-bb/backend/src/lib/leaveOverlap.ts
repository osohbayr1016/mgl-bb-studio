/**
 * Чөлөөний давхцал шалгах цэвэр туслах (2026-08-26).
 *
 * Админ ӨНГӨРСӨН өдрийн чөлөөг нөхөж бүртгэх үед (`POST /api/leaves`
 * дээр `user_id` дамжуулах adminGrant зам) нэг өдрийг хоёр удаа бичих
 * эрсдэл өндөр: ажилтан утсаар хэлсэн, өөр админ эсвэл өөрөө хэдэн
 * хоногийн дараа дахин бүртгэдэг.  Давхардсан мөр нь ирцийн тайланд
 * чөлөөний цагийг хоёр дахин тоолуулна.
 *
 * Шалгалтыг ЗӨВХӨН adminGrant зам дээр хийнэ — ажилтан өөрийн
 * жагсаалтаа хардаг тул тэнд эрсдэл бага, харин хуучин зан төлөвийг
 * хөндвөл ажиллаж байгаа урсгал эвдэрнэ.
 *
 * Дүрэм: огнооны хүрээ огтлолцвол давхцсан.  ГАНЦ үл хамаарах зүйл —
 * хоёулаа НЭГ өдрийн, цагийн хүрээтэй (sub-day) чөлөө бөгөөд цаг нь
 * огтлолцоогүй бол давхцаагүй (өглөө 2 цаг + үдээс хойш 2 цаг гэдэг
 * бодит тохиолдол).
 */

export interface LeaveSpan {
  /** yyyy-mm-dd */
  start_date: string;
  /** yyyy-mm-dd */
  end_date: string;
  /** HH:MM — бүтэн өдрийн чөлөөнд `null`. */
  start_time: string | null;
  /** HH:MM — бүтэн өдрийн чөлөөнд `null`. */
  end_time: string | null;
}

/** Нэг өдрийн, цагийн хүрээтэй чөлөө мөн бол цонхыг нь буцаана. */
function timedWindow(s: LeaveSpan): { from: string; to: string } | null {
  if (s.start_date !== s.end_date) return null;
  if (!s.start_time || !s.end_time) return null;
  return { from: s.start_time, to: s.end_time };
}

/** Хоёр чөлөө хоорондоо давхцаж байна уу? */
export function leaveSpansOverlap(a: LeaveSpan, b: LeaveSpan): boolean {
  // Огнооны хүрээ огтлолцоогүй бол цаг харах шаардлагагүй.
  if (a.start_date > b.end_date || b.start_date > a.end_date) return false;

  const aw = timedWindow(a);
  const bw = timedWindow(b);
  // Хоёулаа нэг өдрийн цагийн чөлөө ⇒ огноо нь аль хэдийн ижил тул
  // зөвхөн цагийн цонхыг харьцуулна (хүрээ хаалттай-нээлттэй: 10:00–12:00
  // ба 12:00–14:00 давхцахгүй).
  if (aw && bw) return aw.from < bw.to && bw.from < aw.to;

  return true;
}

/** Жагсаалтаас эхний давхцсан мөрийг олно (байхгүй бол `null`). */
export function findOverlappingLeave<T extends LeaveSpan>(
  candidate: LeaveSpan,
  existing: readonly T[],
): T | null {
  for (const row of existing) {
    if (leaveSpansOverlap(candidate, row)) return row;
  }
  return null;
}
