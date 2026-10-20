/**
 * Зохиогчийн хяналтын «улаан дэвтэр» — дүрэм ГАНЦ газар (0279 + 0366).
 *
 * Талбайд очих бүрд захиалагчийн улаан дэвтэр (ажлын журнал) дээр гарын үсэг
 * зуруулж, тэр хуудасны ЗУРГИЙГ тайланд хавсаргана.  Эзний шийдвэр
 * (2026-09-30):
 *   • ТАЛБАЙН ХЯНАЛТ (`report_type = 'site'`) тайланд улаан дэвтрийн зураг
 *     ИЛГЭЭХ ба БАТЛАХ хоёр алхамд ЗААВАЛ;
 *   • талбай дээр улаан дэвтэр БАЙГААГҮЙ бол зохиогч «Талбай дээр улаан
 *     дэвтэр байгаагүй» (`red_book_absent = 1`) гэж тэмдэглээд зураггүй
 *     илгээж / батлуулж болно;
 *   • зөвхөн ТАЙЛАНГИЙН (зохиогчийн) улаан дэвтэр — хамт явсан хүмүүсийн
 *     зураг (0351) сонголттой хэвээр;
 *   • зураг хавсаргасан байхад хангалттай — «Баталгаажуулах» (verify) нь
 *     тусдаа, сонголттой алхам хэвээр;
 *   • бусад төрөл (оффис, цахим уулзалт, зургийн өөрчлөлт) — шаардахгүй.
 *
 * ⚠️ Төлөв ХАДГАЛАГДДАГГҮЙ — баганаас гарган авна.  Frontend-ийн ихэр:
 *    `features/projects/asr/types.ts` `AsrRedBookStatus` / `redBookStatusOf` /
 *    `redBookGap` — утга, дүрэм нэмэхдээ хоёуланг нь өөрчил.
 *
 * Импортгүй, DB-гүй: `node --test`-ээр шууд шалгагдана.
 */

export type AsrRedBookStatus = 'missing' | 'absent' | 'signed' | 'verified';

export interface RedBookFields {
  red_book_photo_url?: unknown;
  red_book_verified_at?: unknown;
  red_book_absent?: unknown;
}

/** D1 нь INTEGER-ийг тоогоор буцаадаг; JSON-оор ирсэн boolean-ийг ч авна. */
export function isRedBookAbsent(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

/** Баталгаажсан → зурагтай → «байгаагүй» → дутуу. */
export function redBookStatusOf(row: RedBookFields): AsrRedBookStatus {
  if (row.red_book_verified_at) return 'verified';
  if (row.red_book_photo_url) return 'signed';
  if (isRedBookAbsent(row.red_book_absent)) return 'absent';
  return 'missing';
}

/** Шаардлага хангасан эсэх: зураг ЭСВЭЛ «байгаагүй» тэмдэглэгээ. */
export function redBookSatisfied(row: RedBookFields): boolean {
  return !!row.red_book_photo_url || isRedBookAbsent(row.red_book_absent);
}

export const RED_BOOK_REQUIRED_MSG =
  'Улаан дэвтрийн гарын үсгийн зургийг хавсаргана уу, эсвэл «Талбай дээр улаан дэвтэр байгаагүй» гэж тэмдэглэнэ үү.';

export const RED_BOOK_LOCKED_MSG =
  'Илгээсэн тайлангийн улаан дэвтрийг хоосон үлдээж болохгүй — зургийг солино уу, эсвэл «Талбай дээр улаан дэвтэр байгаагүй» гэж тэмдэглэнэ үү.';

/**
 * Илгээх / батлах үеийн шалгалт.  `required` = `requiresRedBook(type)`
 * (`lib/asrReportType.ts`).  `AsrEditorShell`-ийн `redBookGap`-ийн ТОЛИН ТУСГАЛ.
 */
export function redBookProblem(row: RedBookFields, required: boolean): string | null {
  if (!required) return null;
  return redBookSatisfied(row) ? null : RED_BOOK_REQUIRED_MSG;
}

/**
 * Илгээгдсэн / батлагдсан талбайн тайлан дээр улаан дэвтрийг ХООСОН болгох
 * (зураг устгах, «байгаагүй»-г болих) өөрчлөлтийг хаана — эс бөгөөс илгээх ба
 * батлах шалгалтыг дараа нь тойрч болно.  Зураг СОЛИХ, ноорог/буцаагдсан
 * тайлан чөлөөтэй.  `next` = өөрчлөлтийн ДАРААХ төлөв.
 */
export function redBookClearProblem(
  status: string,
  required: boolean,
  next: RedBookFields,
): string | null {
  if (!required) return null;
  if (status !== 'submitted' && status !== 'approved') return null;
  return redBookSatisfied(next) ? null : RED_BOOK_LOCKED_MSG;
}

/**
 * Батлах UPDATE-ийн WHERE-д (alias-гүй) — шалгалт ба бичилтийн хооронд
 * зураг устгагдах уралдаанаас хамгаална.  `redBookProblem`-ийн SQL ихэр.
 */
export const RED_BOOK_OK_SQL = `(report_type <> 'site' OR red_book_photo_url IS NOT NULL OR red_book_absent = 1)`;
