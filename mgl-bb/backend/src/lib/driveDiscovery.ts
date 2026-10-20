/**
 * Drive-ийн ҮНДСЭН хавтаснаас төслийн хавтсыг автоматаар илрүүлэх — ЦЭВЭР дүрэм.
 *
 * Эзний шийдвэр (2026-09-24): «Системтэй холбосон Drive хавтсанд юу ч
 * байршуулсан системд гарч ирэх ёстой».  Төслийн 19 хавтас нэг том хавтас
 * дотор байдаг; тэр том хавтсанд ШИНЭ хавтас үүсэхэд систем түүнийг ҮНДСЭН
 * ТӨСӨЛ болгож автоматаар нэмнэ (админ юу ч дарахгүй).  БҮХ шууд дэд хавтас
 * тооцогдоно (нэрээр шүүхгүй — эзний сонголт); хүсээгүй хавтсыг админ
 * устгавал «алгасах» жагсаалтад орж ДАХИН үүсэхгүй.
 *
 * Энэ файл юу ч import хийхгүй — `node --test` шууд ачаална
 * (`driveDiscovery.test.ts`).  Drive/D1 хэсэг нь `projectDriveDiscovery.ts`-д.
 */

/** Google Drive-ийн хавтасны MIME (`driveBrowseCore.FOLDER_MIME`-тэй ижил;
 *  import хийхгүйн тулд энд давтав). */
export const DISCOVERY_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Алгасах жагсаалтын дээд хэмжээ — app_settings-ийн нэг мөр хэт томрохгүй. */
export const IGNORED_MAX = 500;

export interface DiscoveryChild {
  id: string;
  name: string;
  mimeType: string;
  trashed?: boolean;
}

export interface FolderRef {
  id: string;
  name: string;
}

/** Компанийн төслийн код — «DOC-260629», «MGL-251222». */
const CODE_RE = /\b((?:DOC|MGL)-\d{6})\b/i;
/** Хавтасны нэрийн эхний дугаарлалт — «00. », «01) ». */
const LEADING_NUMBER_RE = /^\s*\d{1,3}\s*[.)]\s+/;

/**
 * Хавтасны нэрээс үндсэн төслийн нэр + код.
 * «00. DOC-260629 ТАЙГАМ АЛТАЙ ОРОН СУУЦ» → { code: 'DOC-260629',
 * name: 'DOC-260629 ТАЙГАМ АЛТАЙ ОРОН СУУЦ' } — 2026-09-11-нд гараар
 * үүсгэсэн 19 мөртэй ижил хэлбэр (эхний дугаарлалтгүй).
 */
export function mainProjectFromFolderName(folderName: string): { code: string | null; name: string } {
  const trimmed = folderName.trim();
  const stripped = trimmed.replace(LEADING_NUMBER_RE, '').trim();
  const name = stripped || trimmed;
  const m = CODE_RE.exec(name);
  return { code: m ? m[1]!.toUpperCase() : null, name };
}

/**
 * Үндсэн хавтасны шууд хүүхдүүдээс ШИНЭЭР нэмэх хавтсууд: жинхэнэ хавтас
 * (shortcut биш), хогийн саванд биш, аль нэг төсөлд холбогдоогүй, алгасах
 * жагсаалтад байхгүй.  Нэрээр эрэмбэлсэн — үүссэн дараалал тогтвортой.
 */
export function planDiscovery(
  children: readonly DiscoveryChild[],
  linkedIds: ReadonlySet<string>,
  ignoredIds: ReadonlySet<string>,
): FolderRef[] {
  const seen = new Set<string>();
  const out: FolderRef[] = [];
  for (const c of children) {
    if (c.mimeType !== DISCOVERY_FOLDER_MIME || c.trashed) continue;
    const id = c.id.trim();
    if (!id || seen.has(id) || linkedIds.has(id) || ignoredIds.has(id)) continue;
    seen.add(id);
    out.push({ id, name: c.name.trim() || id });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface LinkedMain {
  id: number;
  name: string;
  folder_id: string | null;
  folder_name: string | null;
}

export interface RenamePlan {
  id: number;
  folder_name: string;
  /** Зөвхөн админ нэрийг ГАРААР өөрчлөөгүй үед — хавтасны нэрийг дагана. */
  name: string | null;
}

/**
 * Drive дээр нэр нь өөрчлөгдсөн хавтас: `google_drive_folder_name` (харуулах
 * кэш) ба — нэр нь хуучин хавтасны нэрээс ҮҮССЭН хэвээр бол — үндсэн
 * төслийн нэр.  Админы өөрөө өгсөн нэрийг ХЭЗЭЭ Ч дарахгүй.
 */
export function planRenames(children: readonly DiscoveryChild[], mains: readonly LinkedMain[]): RenamePlan[] {
  const byId = new Map<string, DiscoveryChild>();
  for (const c of children) {
    if (c.mimeType === DISCOVERY_FOLDER_MIME && !c.trashed) byId.set(c.id.trim(), c);
  }
  const out: RenamePlan[] = [];
  for (const m of mains) {
    if (!m.folder_id) continue;
    const child = byId.get(m.folder_id.trim());
    if (!child) continue;
    const next = child.name.trim();
    if (!next || next === (m.folder_name ?? '').trim()) continue;
    const derivedOld = m.folder_name ? mainProjectFromFolderName(m.folder_name).name : null;
    const followsFolder = m.name === m.folder_name || (derivedOld !== null && m.name === derivedOld);
    out.push({ id: m.id, folder_name: next, name: followsFolder ? mainProjectFromFolderName(next).name : null });
  }
  return out;
}

/* ---- «Алгасах» жагсаалт (app_settings JSON) ------------------------ */

export function parseIgnored(raw: string | null | undefined): FolderRef[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: FolderRef[] = [];
  const seen = new Set<string>();
  for (const v of data) {
    if (!v || typeof v !== 'object') continue;
    const id = typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : id;
    out.push({ id, name });
  }
  return out;
}

/** Нэмэх (давхардвал нэрийг шинэчилнэ); хамгийн шинэ нь төгсгөлд, таазтай. */
export function addIgnored(list: readonly FolderRef[], entry: FolderRef): FolderRef[] {
  const id = entry.id.trim();
  if (!id) return [...list];
  const rest = list.filter((e) => e.id !== id);
  rest.push({ id, name: entry.name.trim() || id });
  return rest.slice(-IGNORED_MAX);
}

export function removeIgnored(list: readonly FolderRef[], id: string): FolderRef[] {
  const key = id.trim();
  return list.filter((e) => e.id !== key);
}
