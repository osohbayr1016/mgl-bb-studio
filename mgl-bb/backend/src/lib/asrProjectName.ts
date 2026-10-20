/**
 * Зохиогчийн хяналтын мэдэгдэлд гарах төслийн нэр — ангиллын дагаврыг хасна
 * («MGL-240506_FURNITURE LAND_ZA» → «MGL-240506_FURNITURE LAND»).
 *
 * Эзний хүсэлт (2026-09-25): ЗХ-д ангилал утгагүй тул ЗӨВХӨН харуулахдаа
 * хасна — `projects.name` болон бусад модуль ХӨНДӨГДӨХГҮЙ.
 *
 * ⚠️ ИХЭР: `frontend/src/features/projects/asr/asrProjectName.ts` (дэлгэц,
 *    хэвлэх баримт, Word).  Дүрэм ижил байх ёстой.
 */
const CATEGORY_SUFFIX_RE = /(?:[\s_\-–—]+(?:AZ|ZA|ET|EZ|IZ))+\s*$/;

export function asrProjectName(name: string): string {
  if (!name) return name;
  const stripped = name.replace(CATEGORY_SUFFIX_RE, '').trim();
  return stripped || name;
}

/**
 * ЗХ-д харагдах нэр (миграц 0358, эзний шийдвэр 2026-09-29): админы засварласан
 * `projects.asr_name`, байхгүй бол `projects.name`.  Энэ нь SQL-ийн ТҮҮХИЙ
 * утга — дэлгэц/мэдэгдэл дээр `asrProjectName`-аар дагуулж ангиллын дагаврыг
 * хасна (засварласан нэрэнд дагавар байдаггүй тул нөлөөгүй).
 *
 * ⚠️ PROJECT-ID (`asrProjectId` — Doc. No., файлын нэр) нь ҮҮНЭЭС БИШ,
 *    `p.name`-ээс хэвээр.  ИХЭР: frontend `asrProjectName.ts` `asrProjectLabel`.
 */
export function asrLabelSql(alias = 'p'): string {
  return `COALESCE(NULLIF(TRIM(${alias}.asr_name), ''), ${alias}.name)`;
}

/** ЗХ-ийн нэрийн дээд урт — `PATCH /projects/:id/name`. */
export const ASR_NAME_MAX = 200;

/**
 * ЗХ-ийн төслийн «Гэрээний дугаар»-ын дээд урт (`projects.asr_contract_no`,
 * 0365) — `PATCH /projects/:id/name` ба `POST /targets`.  Тайлангийн
 * `contract_no`-ийн PATCH хязгаар (200)-той ижил.
 */
export const ASR_CONTRACT_NO_MAX = 200;

/**
 * ЗХ-ийн баримтын «PROJECT-ID» — толгойн Doc. No. ба файлын нэрэнд (эзний
 * шийдвэр 2026-09-28: паспортын ШИФР БИШ).  = төслийн нэрний эхний код
 * («MGL-251006_EVERGREEN» → «MGL-251006»); кодгүй нэрд ангиллын дагавар
 * хассан нэр өөрөө, зайг зураасаар («LUXWOOD», «Luxwood-засвар»).
 * ⚠️ ИХЭР: frontend `features/projects/asr/asrProjectName.ts` `asrProjectId` — хэвлэх/Word ба серверийн PDF-ийн файлын нэр ижил байх ёстой.
 */
const PROJECT_CODE_RE = /^([A-Za-z]{2,6}-\d{6})(?=$|[\s_\-–—])/;

export function asrProjectId(name: string | null | undefined): string {
  const raw = (name ?? '').trim();
  const m = PROJECT_CODE_RE.exec(raw);
  if (m?.[1]) return m[1].toUpperCase();
  const base = (asrProjectName(raw) ?? '').replace(/_/g, ' ').trim().replace(/\s+/g, '-');
  return base || 'PROJECT-ID';
}
