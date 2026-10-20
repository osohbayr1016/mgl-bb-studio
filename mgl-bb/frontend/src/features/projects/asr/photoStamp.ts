/**
 * Талбайн зургийн АВТОМАТ ТЭМДЭГ — огноо + төсөл.
 *
 * Эзний хүсэлт (2026-09-21): зохиогчийн хяналтын зураг бүр дээр ямар
 * огнооных, аль төслийнх нь гараар бичилгүйгээр гарч байх.  Тэмдэг нь
 * ХАРУУЛАХ ДАВХАРГА, зургийн байт руу шатаадаггүй — эх зураг R2-д хэвээр,
 * хуучин тайлан ч (`taken_at`-гүй зураг) тайлангийн огноогоор нөхөгдөнө.
 *
 * 2026-09-25 (эзний хүсэлт): тэмдэг нь зургийн БАРУУН ДООД буланд
 * «он.сар.өдөр цаг:минут:СЕКУНД» + ТӨСЛИЙН НЭР.  Урьд нь «шифр · ASR-012»
 * байсан — эзэн төслийн нэрийг харуулахыг хүссэн; шифр нь зөвхөн төслийн
 * нэр мэдэгдэхгүй үеийн нөөц.  Огноо нь ЗУРГИЙГ АВСАН агшных (EXIF), урьд
 * авсан зургийг оруулахад ч тэр өдрийнхөөрөө гарна.
 *
 * ГУРВАН гадаргуу ЭНЭ НЭГ функцээс уншина: засварлагч (`AsrDocPhotos`),
 * хэвлэх/PDF баримт (`AsrDocument`), Word (`buildAsrDocx`).  Бичвэрийг
 * өөрчлөх бол зөвхөн энд.
 *
 * ⚠️ `@/` импорт ЗОРИУДААР байхгүй — `scripts/check-asr-photo-stamp.mjs`
 *    Node дээр шууд ачаалдаг.
 */

export interface AsrPhotoStampContext {
  /** Тайлангийн огноо `YYYY-MM-DD` — `taken_at`-гүй зургийн нөөц. */
  reportDate: string | null | undefined;
  /** ХҮЧИН ТӨГӨЛДӨР шифр (override ?? паспорт) — төслийн нэргүй үеийн нөөц. */
  shifr: string | null | undefined;
  /** Төслийн нэр — тэмдгийн хоёр дахь мөр. */
  projectName: string | null | undefined;
  /** ЗХ дугаар (`seq` → ASR-NNN); ноорогт `null`.  Тэмдэгт ороогүй. */
  seq?: number | null | undefined;
}

export interface AsrPhotoStamp {
  /** «2026.09.21 14:35:09»; секундгүй хуучин утга → «2026.09.21 14:35»;
   *  зөвхөн тайлангийн огноо мэдэгдэж байвал «2026.09.21». */
  when: string;
  /** Төслийн нэр (байхгүй бол шифр) — хоосон байж болно. */
  project: string;
}

/** `2026-09-21T14:35:09` → `2026.09.21 14:35:09`; `…T14:35` → `… 14:35`;
 *  `2026-09-21` → `2026.09.21`. */
export function formatTakenAt(v: string | null | undefined): string {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (!m) return '';
  const date = `${m[1]}.${m[2]}.${m[3]}`;
  if (!m[4]) return date;
  return m[6] ? `${date} ${m[4]}:${m[5]}:${m[6]}` : `${date} ${m[4]}:${m[5]}`;
}

/** `lib/asrNo.ts`-ийн `formatAsrDocNo` ихэр (DASR-BB-001 — баг тус бүрийн дараалал, 0359). */
export function asrDocNoOf(seq: number | null | undefined, teamCode?: string | null): string {
  if (seq == null) return '';
  const num = String(seq).padStart(3, '0');
  const team = (teamCode ?? '').trim();
  return team ? `DASR-${team}-${num}` : `DASR-${num}`;
}

export function photoStamp(
  ctx: AsrPhotoStampContext,
  photo: { taken_at?: string | null },
): AsrPhotoStamp {
  const when = formatTakenAt(photo.taken_at) || formatTakenAt(ctx.reportDate);
  const project = (ctx.projectName || '').trim() || (ctx.shifr || '').trim();
  return { when, project };
}

/** Нэг мөрт хэлбэр — Word-ийн тайлбар, `alt`, ханган нийлүүлэх зэрэгт. */
export function photoStampLine(s: AsrPhotoStamp): string {
  return [s.when, s.project].filter(Boolean).join(' · ');
}
