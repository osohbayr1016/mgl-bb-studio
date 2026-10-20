/**
 * Зохиогчийн хяналтад харуулах төслийн нэр — ангиллын дагаврыг хасна.
 *
 * Нэг барилга ангилал тус бүрээр тусдаа `projects` мөртэй тул нэрс нь
 * «MGL-240506_FURNITURE LAND_ZA», «… IZ», «… EVERGREEN-AZ» гэж төгсдөг.
 * ЗХ-д ангилал утгагүй (эзний хүсэлт 2026-09-25) тул ЗӨВХӨН ЭНД харуулахдаа
 * хасна — `projects.name` болон бусад модуль ХӨНДӨГДӨХГҮЙ.
 *
 * ⚠️ ИХЭР: `backend/src/lib/asrProjectName.ts` (PDF-ийн нэр, мэдэгдэл,
 *    ЗХ-ийн API-ийн хариу).  Хоёулаа ижил дүрэмтэй байх ёстой.
 *
 * Дүрэм: төгсгөлийн `_ZA` / ` IZ` / `-AZ` (AZ·ZA·ET·EZ·IZ — `projectCategories`)
 * хэсгүүдийг хасна; зөвхөн ТОМ латин үсгээр, тусгаарлагчтай үед — «…ZA» гэж
 * үгэнд наалдсан, эсвэл нэрийн дунд байгаа нь хэвээр.  Хасаад хоосон болох
 * бол анхны нэрийг буцаана.
 */
const CATEGORY_SUFFIX_RE = /(?:[\s_\-–—]+(?:AZ|ZA|ET|EZ|IZ))+\s*$/;

export function asrProjectName(name: string): string;
export function asrProjectName(name: string | null | undefined): string | null | undefined;
export function asrProjectName(name: string | null | undefined): string | null | undefined {
  if (!name) return name;
  const stripped = name.replace(CATEGORY_SUFFIX_RE, '').trim();
  return stripped || name;
}

/**
 * ЗХ-д харагдах нэр (миграц 0358, эзний шийдвэр 2026-09-29): админы ЗХ-ийн
 * хуудаснаас засварласан `projects.asr_name`, байхгүй бол ангиллын дагаваргүй
 * `projects.name`.  Нэр нь ЗӨВХӨН зохиогчийн хяналтад — Төслүүд хуудас хэвээр.
 *
 * ⚠️ PROJECT-ID (`asrProjectId` — Doc. No., файлын нэр) нь ҮҮНЭЭС БИШ,
 *    `projects.name`-ээс.  ИХЭР: backend `lib/asrProjectName.ts` `asrLabelSql`.
 */
export function asrProjectLabel(
  project: { name?: string | null; asr_name?: string | null } | null | undefined,
): string {
  return project?.asr_name?.trim() || asrProjectName(project?.name ?? '') || '';
}

/**
 * ЗХ-ийн баримтын «PROJECT-ID» — толгойн Doc. No. ба файлын нэрэнд (эзний
 * шийдвэр 2026-09-28: паспортын ШИФР БИШ).  = төслийн нэрний эхний код
 * («MGL-251006_EVERGREEN» → «MGL-251006»); кодгүй нэрд ангиллын дагавар
 * хассан нэр өөрөө, зайг зураасаар («LUXWOOD», «Luxwood-засвар»).
 * ⚠️ ИХЭР: backend `lib/asrProjectName.ts` `asrProjectId` — хэвлэх/Word ба серверийн PDF-ийн файлын нэр ижил байх ёстой.
 */
const PROJECT_CODE_RE = /^([A-Za-z]{2,6}-\d{6})(?=$|[\s_\-–—])/;

export function asrProjectId(name: string | null | undefined): string {
  const raw = (name ?? '').trim();
  const m = PROJECT_CODE_RE.exec(raw);
  if (m?.[1]) return m[1].toUpperCase();
  const base = (asrProjectName(raw) ?? '').replace(/_/g, ' ').trim().replace(/\s+/g, '-');
  return base || 'PROJECT-ID';
}
