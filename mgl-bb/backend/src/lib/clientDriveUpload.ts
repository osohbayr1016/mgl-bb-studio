/**
 * Захиалагчийн порталын Drive баримт — ХАРАХ ба БАЙРШУУЛАХ эрхийн ганц дүрэм
 * (2026-09-21, эзний шийдвэр; 0327-ийн «зөвхөн нээсэн зүйл» дүрмийг сольсон).
 *
 *   • ХАРАХ: төсөлд эрхтэй байгууллагын (`project_client_access`, ямар ч
 *     түвшин) захиалагч төслийн Drive үндэс хавтсыг БҮХЭЛД НЬ (00–12, бүх
 *     дэд хавтас) харж, татна.  `client_drive_shares` цаашид харагдацыг
 *     ШИЙДЭХГҮЙ (хүснэгт, admin route-ууд түүх/хандалтын лог болж үлдсэн).
 *   • БАЙРШУУЛАХ: ЗӨВХӨН «09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ» хавтас
 *     (`lib/projectDocTemplate.ts` код 09) ба түүний дэд мод.  Хавтсыг үндэс
 *     хавтасны ШУУД доорх, нэр нь «09» гэж эхэлдэг (дараа нь цифр биш) хавтас
 *     гэж НЭРЭЭР таньдаг — төсөл бүрд тохиргоо байхгүй.  Байхгүй бол
 *     захиалагч байршуулж чадахгүй (UI + сервер хоёулаа `UPLOAD_FOLDER_MISSING`).
 *     Эрхийн түвшин: `clientCanSubmit` (`contributor` | `approver`) — материал
 *     илгээх (`client_submissions`) эрхтэй ЯГ ижил, `viewer` зөвхөн харна.
 *
 * Энэ файл ЦЭВЭР (тесттэй, `node --test`-д ачаалагдана — тиймээс
 * `driveBrowse.ts`-ийг импортлохгүй: тэр нь `googleAuth.ts`-ийн parameter
 * property-г татаж type-stripping-д унадаг).  09 хавтсыг Drive-аас ОЛОХ нь
 * `routes/clientDrive.ts` `findClientUploadFolder` — үндэсний жагсаалтын
 * 30 сек кэшийг дахин ашигладаг тул ээлжит хуудас нээхэд нэмэлт дуудлага
 * ихэвчлэн 0.
 */

/** `driveBrowse.ts` `FOLDER_MIME`-ийн ихэр — импортгүй байх учир нь дээр. */
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** `projectDriveAccess.ts` `DrivePathNode`-ийн бүтцийн ихэр. */
export interface UploadPathNode {
  id: string;
  name: string;
}

/** `PROJECT_DOC_FOLDERS`-ийн код — «09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ». */
export const CLIENT_UPLOAD_FOLDER_CODE = '09';

/** «09», «09 …», «09_…», «09-…» таарна; «090», «091 …» таарахгүй. */
const NAME_RE = /^09(?![0-9])/;

/** Хавтасны нэр захиалагчийн байршуулах хавтасных мөн үү (үндэсний шууд хүүхэд дээр л дуудна). */
export function isClientUploadFolderName(name: string): boolean {
  return NAME_RE.test(name.trim());
}

/**
 * Үндэс хавтасны хүүхдүүдээс байршуулах хавтсыг сонгоно: ЖИНХЭНЭ хавтас
 * (товчлол биш — товчлол өөр төслийн хавтас руу зааж болно), нэр нь таарсан;
 * олон бол нэрээр эрэмбэлээд эхнийх (детерминист).
 */
export function pickClientUploadFolder<T extends { id: string; name: string; mimeType: string }>(
  entries: readonly T[],
): T | null {
  const hits = entries.filter((e) => e.mimeType === FOLDER_MIME && isClientUploadFolderName(e.name));
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return hits[0]!;
}

/**
 * Зорилтот хавтас (`resolveAncestry`-ийн үндэс → зорилт зам) байршуулах
 * хавтсанд эсвэл түүний ДОТОР байна уу.  Үндэс өөрөө (path = [root]) ХЭЗЭЭ Ч
 * биш — 09 нь үндэсний хүүхэд.
 */
export function uploadAllowedOnPath(path: readonly UploadPathNode[], uploadFolderId: string | null): boolean {
  if (!uploadFolderId) return false;
  return path.some((n) => n.id === uploadFolderId);
}
