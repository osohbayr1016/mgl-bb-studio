/**
 * Төслийн Drive хавтас — ЭРХИЙН шалгалт ба жагсаалтын богино кэш (2026-09-10).
 *
 *   • «энэ файл ҮНЭХЭЭР тэр төслийн хавтасны дотор уу» — front-end-ээс ирсэн
 *     `folderId`/`fileId`-д ХЭЗЭЭ Ч итгэхгүй (§9: URL-ын id-г солиод өөр
 *     төслийн баримт руу орох боломжгүй);
 *   • жагсаалтын БОГИНО кэш + түүнийг хүчингүй болгох цэг (ирээдүйд Drive
 *     Changes API / push мэдэгдэл яг энэ цэгийг дуудна — §8).
 *
 * Кэш нь isolate доторх Map, секундын хэмжээст TTL-тэй — `officeAccess.ts` /
 * `clientAccess.ts`-тэй ижил загвар.  Хуучирсан кэш Drive-ыг хэзээ ч дарж
 * бичихгүй: кэш нь зөвхөн УНШИЛТЫГ давхардуулахгүй байх зориулалттай.
 * Цэвэр хэсэг (id ялгах, харах төлөвлөгөө) нь `projectDrive.ts`-д.
 */
import type { Env } from '../types';
import { currentTenantId } from './requestContext';
import {
  DriveBrowseError,
  driveBrowseGetParents,
  driveBrowseList,
  type DriveEntry,
  type DriveListPage,
} from './google/driveBrowse';

/* ------------------------------------------------------------------ */
/*  Эрх: зүйл нь төслийн хавтасны ДОТОР уу                             */
/* ------------------------------------------------------------------ */

export interface DrivePathNode {
  id: string;
  name: string;
}

/** Эцэг рүү дээшлэх алхмын кэш — `files.get(fields=parents)` нь зүйл бүрт
 *  нэг дуудлага тул богино TTL-ээр хадгална.  Жагсаалт уншихад хүүхэд
 *  бүрийн эцэг нь ТОДОРХОЙ (тэр хавтас) учир тэндээс ч дүүргэнэ — ингэснээр
 *  саяхан жагсаасан файлыг нээхэд Drive рүү нэмэлт дуудлага ихэвчлэн 0. */
interface ParentLink {
  at: number;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  webViewLink: string | null;
}
const PARENT_TTL_MS = 5 * 60_000;
const parentCache = new Map<string, ParentLink>();

/** Хавтас олон түвшин гүн байж болно; гогцоо/буруу өгөгдлөөс хамгаалах тааз. */
const MAX_DEPTH = 40;

function pkey(id: string): string {
  return `${currentTenantId()}:${id}`;
}

function rememberParent(entry: DriveEntry, now = Date.now()): void {
  parentCache.set(pkey(entry.id), {
    at: now,
    name: entry.name,
    mimeType: entry.mimeType,
    parents: entry.parents ?? [],
    trashed: Boolean(entry.trashed),
    webViewLink: entry.webViewLink ?? null,
  });
}

/** Нэр солих / зөөх ЗЭРЭГ бичилтийн дараа Drive-ын шинэ метаг кэшид тавина —
 *  эс тэгвэл 5 минут хуучин эцэг/нэрээр ancestry шийдэж, дараагийн зөөлт
 *  буруу `removeParents` явуулна (харнест хэмжигдсэн, 2026-09-18). */
export function rememberDriveEntry(entry: DriveEntry): void {
  rememberParent(entry);
}

async function parentLink(env: Env, id: string): Promise<ParentLink> {
  const now = Date.now();
  const hit = parentCache.get(pkey(id));
  if (hit && now - hit.at < PARENT_TTL_MS) return hit;
  const entry = await driveBrowseGetParents(env, id);
  const link: ParentLink = {
    at: now,
    name: entry.name,
    mimeType: entry.mimeType,
    parents: entry.parents ?? [],
    trashed: Boolean(entry.trashed),
    webViewLink: entry.webViewLink ?? null,
  };
  parentCache.set(pkey(id), link);
  return link;
}

export interface AncestryTarget {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
}

export type AncestryResult =
  | {
      ok: true;
      /** Үндэс хавтаснаас зорилтот зүйл хүртэл (хоёулаа орно). */
      path: DrivePathNode[];
      /** Зорилтот зүйлийн мета — хавтас уу, файл уу гэдгийг route мэддэг. */
      target: AncestryTarget;
    }
  | { ok: false; reason: 'OUTSIDE' | 'TRASHED' };

/**
 * `itemId` нь `rootId`-ийн дотор (эсвэл өөрөө үндэс) мөн эсэхийг Drive-ын
 * `parents` гинжээр дээшилж шалгана.  Хавтас нь хэдэн ч түвшин гүн байж
 * болно; товчлол (shortcut) нь ЗОРИЛТОТ файлаа биш ӨӨРИЙН байрлалаараа
 * шалгагдана — өөр төслийн файл руу заасан товчлол тэр файлыг нээхгүй.
 *
 * ⚠️ Drive нь хуваалцаагүй зүйлийг 404 гэж хариулдаг тул «байхгүй» ба
 *    «эрхгүй» хоёр энд ялгагдахгүй — хоёулаа `DriveBrowseError` болж
 *    дуудагч руу дамжина (route нь NOT_FOUND гэж харуулна, §10).
 */
export async function resolveAncestry(
  env: Env,
  rootId: string,
  itemId: string,
): Promise<AncestryResult> {
  const chain: DrivePathNode[] = [];
  let target: AncestryTarget | null = null;
  const seen = new Set<string>();
  let current = itemId;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (seen.has(current)) return { ok: false, reason: 'OUTSIDE' };
    seen.add(current);
    const link = await parentLink(env, current);
    if (link.trashed) return { ok: false, reason: 'TRASHED' };
    if (!target) {
      target = { id: current, name: link.name, mimeType: link.mimeType, webViewLink: link.webViewLink };
    }
    chain.push({ id: current, name: link.name });
    if (current === rootId) {
      chain.reverse();
      return { ok: true, path: chain, target };
    }
    // Drive нь одоо ганц эцэгтэй; хуучин олон эцэгтэй файлд эхнийхийг л авна —
    // бусад эцэг нь өөр төслийн хавтас байвал тэр замыг ЗОРИУД дагахгүй.
    const next = link.parents[0];
    if (!next) return { ok: false, reason: 'OUTSIDE' };
    current = next;
  }
  return { ok: false, reason: 'OUTSIDE' };
}

/**
 * Changes API-аас ирсэн зүйл АЛЬ холбогдсон үндэс хавтасны (төсөл / үндсэн
 * төсөл) дотор байгааг олно — `resolveAncestry`-тэй ижил дээшлэх алхам, гэхдээ
 * нэг үндэс биш ОЛОН үндэстэй тулгана.  `seed` = Changes-ийн өгсөн мета
 * (эцэг нь мэдэгдэж байгаа тул эхний алхамд Drive руу очихгүй).
 * Буцаах: үндэсний id, эсвэл null (ямар ч төслийн хавтсанд биш / устсан /
 * SA-д харагдахгүй).  Хуваалцаагүй зүйлд Drive 404 өгдөг — тэр ч null.
 */
export async function findLinkedRoot(
  env: Env,
  itemId: string,
  roots: ReadonlySet<string>,
  seed?: DriveEntry,
): Promise<string | null> {
  if (roots.size === 0) return null;
  if (seed && seed.id === itemId) rememberParent(seed);
  const seen = new Set<string>();
  let current = itemId;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (roots.has(current)) return current;
    if (seen.has(current)) return null;
    seen.add(current);
    let link: ParentLink;
    try {
      link = await parentLink(env, current);
    } catch (err) {
      if (err instanceof DriveBrowseError && (err.code === 'NOT_FOUND' || err.code === 'PERMISSION_DENIED')) {
        return null;
      }
      throw err;
    }
    const next = link.parents[0];
    if (!next) return null;
    current = next;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Жагсаалтын богино кэш                                              */
/* ------------------------------------------------------------------ */

/** Ижил хавтсыг хэдэн ажилтан зэрэг нээхэд Drive рүү нэг л удаа очно;
 *  «Шинэчлэх» товч болон хуудас дахин ачаалах нь `bypass`-аар тойрно. */
const LIST_TTL_MS = 30_000;
const listCache = new Map<string, { at: number; page: DriveListPage }>();

function lkey(folderId: string, pageToken: string | null): string {
  return `${currentTenantId()}:${folderId}:${pageToken ?? ''}`;
}

/**
 * Ирээдүйн Drive Changes API / push мэдэгдэл дуудах ГАНЦ цэг: хавтасны
 * (эсвэл бүх) жагсаалтын кэшийг хаяна.  Өнөөдөр «Шинэчлэх» товч л дуудна.
 */
export function invalidateDriveListing(folderId?: string): void {
  if (folderId === undefined) {
    listCache.clear();
    return;
  }
  const prefix = `${currentTenantId()}:${folderId}:`;
  for (const k of listCache.keys()) if (k.startsWith(prefix)) listCache.delete(k);
}

export async function listProjectFolder(
  env: Env,
  folderId: string,
  opts: { pageToken?: string | null; bypassCache?: boolean } = {},
): Promise<DriveListPage & { cached: boolean }> {
  const pageToken = opts.pageToken ?? null;
  const key = lkey(folderId, pageToken);
  const now = Date.now();
  if (!opts.bypassCache) {
    const hit = listCache.get(key);
    if (hit && now - hit.at < LIST_TTL_MS) return { ...hit.page, cached: true };
  }
  const page = await driveBrowseList(env, folderId, pageToken);
  listCache.set(key, { at: now, page });
  // Хүүхэд бүрийн эцэг нь ЭНЭ хавтас гэдгийг мэдсэн тул ancestry кэшийг
  // дүүргэнэ — файл нээхэд дахин Drive руу асуухгүй.
  for (const f of page.files) {
    if (!f.parents || f.parents.length === 0) f.parents = [folderId];
    rememberParent(f, now);
  }
  return { ...page, cached: false };
}
