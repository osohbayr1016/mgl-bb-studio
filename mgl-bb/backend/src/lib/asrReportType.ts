/**
 * Зохиогчийн хяналтын тайлангийн ТӨРӨЛ (миграц 0362, эзний шийдвэр 2026-09-29).
 *
 * Үндсэн 4 төрөл — нэг тайлан ЯГ НЭГ төрөлтэй:
 *   • `site`           — Талбайн хяналт.  2026-09-29 хүртэлх БҮХ тайлан энэ
 *                        (эзэн: «яг одоо хүмүүсийн бөглөж байгаа нь»), тиймээс
 *                        баганын өгөгдмөл.
 *   • `office`         — Оффис уулзалт.
 *   • `drawing_change` — Зургийн өөрчлөлт.
 *   • `online`         — Цахим уулзалт.  Ямар платформ ашигласныг
 *                        (`meeting_platform`) илгээхээс өмнө заавал бичнэ.
 *
 * Массивын ДАРААЛАЛ = UI-ийн дараалал (эзэн 2026-09-30); `/stats` `by_type`
 * ч энэ дарааллаар буцаана.
 *
 * Төрлөөс хамаарах ГУРВАН дүрэм (эзний сонголт) — өөр юу ч өөрчлөгдөхгүй
 * (дугаарлалт, батлах урсгал бүх төрөлд ижил):
 *   1. ХАБ-ын танилцсан баталгаа (0329) ЗӨВХӨН талбайн хяналтад
 *      (`requiresSafetyAck`).
 *   2. Самбарын «очилт» = ЗӨВХӨН талбайн хяналт (`ASR_SITE_SQL`); бусад
 *      төрөл тусдаа тоологдоно.
 *   3. Улаан дэвтрийн зураг (эсвэл «байгаагүй» тэмдэглэгээ) илгээх/батлахад
 *      ЗӨВХӨН талбайн хяналтад заавал (`requiresRedBook`, 2026-09-30;
 *      дүрэм нь `lib/asrRedBook.ts`).
 *
 * ⚠️ Багана дээр CHECK ЗОРИУД БАЙХГҮЙ — `users.work_schedule`-ийн CHECK нь
 *    гурав дахь утга нэмэхэд `users`-ийг бүтнээр нь дахин барих шаардлага
 *    үүсгэсэн.  Цагаан жагсаалт нь ЭНЭ файл; frontend-ийн ихэр нь
 *    `features/projects/asr/types.ts` `ASR_REPORT_TYPES` — хамт өөрчил.
 *
 * Импортгүй, DB-гүй: `node --test`-ээр шууд шалгагдана.
 */

export const ASR_REPORT_TYPES = ['site', 'office', 'drawing_change', 'online'] as const;

export type AsrReportType = (typeof ASR_REPORT_TYPES)[number];

export const DEFAULT_ASR_REPORT_TYPE: AsrReportType = 'site';

/** Мэдэгдэл, алдааны мессежид (UI-ийн шошго нь i18n-ээс). */
export const ASR_REPORT_TYPE_LABEL_MN: Record<AsrReportType, string> = {
  site: 'Талбайн хяналт',
  online: 'Цахим уулзалт',
  drawing_change: 'Зургийн өөрчлөлт',
  office: 'Оффис уулзалт',
};

export function isAsrReportType(v: unknown): v is AsrReportType {
  return typeof v === 'string' && (ASR_REPORT_TYPES as readonly string[]).includes(v);
}

/**
 * Хүсэлтийн биеийн `report_type`.
 *   • ирээгүй (`undefined`/`null`) → `{ ok: true, type: null }` — дуудагч
 *     өгөгдмөлөө (үүсгэхэд `site`, засахад «хөндөхгүй») өөрөө шийднэ;
 *   • танигдахгүй утга → `{ ok: false }` — чимээгүй `site` болгож БОЛОХГҮЙ:
 *     `office` гэж бичих гэсэн хүн ХАБ-ын хаалган дээр гацна.
 */
export function parseAsrReportType(
  v: unknown,
): { ok: true; type: AsrReportType | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, type: null };
  return isAsrReportType(v) ? { ok: true, type: v } : { ok: false };
}

/** ХАБ-ын танилцсан баталгаа шаардах эсэх — зөвхөн талбай дээр очих үед. */
export function requiresSafetyAck(type: AsrReportType): boolean {
  return type === 'site';
}

/**
 * Улаан дэвтрийн зураг (эсвэл «Талбай дээр улаан дэвтэр байгаагүй») илгээх,
 * батлахад заавал эсэх — зөвхөн талбай дээр очих үед (`lib/asrRedBook.ts`).
 */
export function requiresRedBook(type: AsrReportType): boolean {
  return type === 'site';
}

/** Платформын нэрийн дээд урт («Zoom», «Google Meet», «Microsoft Teams» …). */
export const MEETING_PLATFORM_MAX = 100;

/**
 * Хадгалах платформын утга: ЗӨВХӨН цахим уулзалтад, бусад төрөлд үргэлж
 * NULL (төрлийг сольсон тайланд хуучин «Zoom» үлдэж хэвлэгдэхгүй).
 */
export function meetingPlatformFor(type: AsrReportType, raw: unknown): string | null {
  if (type !== 'online' || typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim().slice(0, MEETING_PLATFORM_MAX);
  return s || null;
}

/** Илгээхийн өмнөх шалгалт — `AsrEditorShell.missingOf`-ийн ТОЛИН ТУСГАЛ. */
export function reportTypeProblem(
  type: AsrReportType,
  meetingPlatform: string | null | undefined,
): string | null {
  if (type === 'online' && !(meetingPlatform ?? '').trim()) {
    return 'Цахим уулзалтад ашигласан платформыг бичнэ үү.';
  }
  return null;
}

/**
 * «Очилт» = талбайн хяналт.  `r` alias-тай SQL-ийн нөхцөл (bind-гүй).
 * ⚠️ `asrStats.ts`-ийн `ASR_COUNTED_SQL`-тэй ХАМТ хэрэглэнэ — энэ нь зөвхөн
 *    төрлийн нөхцөл, ноорог шүүдэггүй.
 */
export const ASR_SITE_SQL = `r.report_type = 'site'`;
