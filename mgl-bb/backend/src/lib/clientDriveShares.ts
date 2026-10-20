/**
 * Захиалагчид нээсэн төслийн Drive баримт — харагдах эсэхийн ГАНЦ дүрэм
 * (миграц 0327, 2026-09-18).
 *
 * Эзний шийдвэр: захиалагч төслийн Drive хавтасны бүгдийг биш, ажилтны
 * ТЭМДЭГЛЭСЭН хавтас/файлыг л харна.  `client_drive_shares`-д мөргүй зүйл
 * ХЭЗЭЭ Ч харагдахгүй (өгөгдмөл хаалттай — `clientScope.ts`-тэй ижил үзэл).
 *
 *   • хавтас нээсэн бол түүний ДЭД МОД бүхэлдээ харагдана — Drive-ын
 *     `parents` гинжийг үндэс хүртэл алхсан зам (`resolveAncestry`) дээр
 *     нээсэн хавтас байвал хангалттай;
 *   • файл нээсэн бол зөвхөн тэр файл;
 *   • эрх БАЙГУУЛЛАГААР — тухайн хүний бүх байгууллагын мөрийг нэгтгэнэ
 *     (нэг хүн хоёр компанийг төлөөлж болно, `clientAccess.ts`-тэй ижил).
 *
 * Цэвэр хэсэг (`visibleAncestor`, `trimPathToShare`) нь тесттэй; DB хэсэг нь
 * `clientAccess.ts`-тэй ижил 60 сек кэштэй — эрх хаагдсан даруйд (нэг
 * минутын дотор) захиалагч татаж чадахаа болино, JWT-д хэзээ ч орохгүй.
 */
import { currentTenantId } from './requestContext';

export type ClientDriveShareKind = 'folder' | 'file';

export interface ClientDriveShareRow {
  id: number;
  project_id: number;
  org_id: number;
  drive_item_id: string;
  item_kind: ClientDriveShareKind;
  item_name: string;
  item_mime: string | null;
  note: string | null;
  shared_by: number | null;
  shared_at: string;
  revoked_at: string | null;
}

/** `resolveAncestry`-ийн зам — үндэснээс зорилтот зүйл хүртэл (хоёулаа орно). */
export interface PathNode {
  id: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  Цэвэр дүрэм                                                        */
/* ------------------------------------------------------------------ */

/**
 * Зам дээрх ХАМГИЙН ДЭЭД нээсэн хавтасны индекс (0 = үндэс өөрөө нээгдсэн),
 * эсвэл зорилтот зүйл өөрөө нээсэн файл бол сүүлийн индекс; аль нь ч биш бол
 * -1.  «Хамгийн дээд» — захиалагчид breadcrumb тэр хавтаснаас эхэлж
 * харагдана, дээрх нэрс (компанийн ажлын бүтэц) ил гарахгүй.
 */
export function visibleAncestor(
  path: readonly PathNode[],
  shares: readonly Pick<ClientDriveShareRow, 'drive_item_id' | 'item_kind' | 'revoked_at'>[],
): number {
  const folders = new Set<string>();
  const files = new Set<string>();
  for (const s of shares) {
    if (s.revoked_at) continue;
    (s.item_kind === 'folder' ? folders : files).add(s.drive_item_id);
  }
  for (let i = 0; i < path.length; i++) {
    if (folders.has(path[i]!.id)) return i;
  }
  const last = path[path.length - 1];
  if (last && files.has(last.id)) return path.length - 1;
  return -1;
}

/**
 * Захиалагчид харуулах зам: нээсэн хавтаснаас доош л.  Дээрх түвшнүүд
 * (компанийн хавтасны бүтэц) нэрээрээ ч ил гарахгүй.  Нээсэн зүйлийн ӨМНӨ
 * виртуал «Баримт бичиг» үндэс (`id = 'root'`) байна — портал тэндээс
 * нээсэн бүх зүйлийн жагсаалтыг харуулдаг.
 */
export function trimPathToShare(path: readonly PathNode[], fromIndex: number, rootName: string): PathNode[] {
  if (fromIndex < 0) return [];
  return [{ id: 'root', name: rootName }, ...path.slice(fromIndex)];
}

/* ------------------------------------------------------------------ */
/*  DB — байгууллагын нээсэн мөрүүд (кэштэй)                            */
/* ------------------------------------------------------------------ */

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; rows: ClientDriveShareRow[] }>();

function ckey(projectId: number): string {
  return `${currentTenantId()}:${projectId}`;
}

/** Нээх/хаах бүрт дуудна (routes/clientDriveAdmin.ts). */
export function invalidateClientDriveShares(projectId?: number): void {
  if (projectId === undefined) cache.clear();
  else cache.delete(ckey(projectId));
}

const ROW_COLS = `id, project_id, org_id, drive_item_id, item_kind, item_name, item_mime, note,
                  shared_by, shared_at, revoked_at`;

/** Төслийн БҮХ идэвхтэй нээлт (бүх байгууллага) — кэштэй; дуудагч
 *  байгууллагаар шүүнэ.  Миграц ороогүй DB дээр хоосон. */
export async function activeSharesForProject(db: D1Database, projectId: number): Promise<ClientDriveShareRow[]> {
  const key = ckey(projectId);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.rows;
  let rows: ClientDriveShareRow[] = [];
  try {
    const { results } = await db
      .prepare(`SELECT ${ROW_COLS} FROM client_drive_shares WHERE project_id = ? AND revoked_at IS NULL ORDER BY item_kind, item_name`)
      .bind(projectId)
      .all<ClientDriveShareRow>();
    rows = results;
  } catch (err) {
    console.warn('[client-drive] client_drive_shares уншигдсангүй', err);
  }
  cache.set(key, { at: now, rows });
  return rows;
}

/** Тухайн хүний байгууллагуудад нээсэн мөрүүд (давхардалгүй, Drive id-аар). */
export async function sharesVisibleTo(
  db: D1Database,
  projectId: number,
  orgIds: readonly number[],
): Promise<ClientDriveShareRow[]> {
  if (orgIds.length === 0) return [];
  const orgs = new Set(orgIds);
  const all = await activeSharesForProject(db, projectId);
  const seen = new Set<string>();
  const out: ClientDriveShareRow[] = [];
  for (const row of all) {
    if (!orgs.has(row.org_id) || seen.has(row.drive_item_id)) continue;
    seen.add(row.drive_item_id);
    out.push(row);
  }
  return out;
}

/** Захиалагчийн үйлдлийг бүртгэнэ — алдаа нь татахыг хэзээ ч унагаахгүй. */
export async function logClientDriveAccess(
  db: D1Database,
  entry: {
    project_id: number;
    org_id: number | null;
    user_id: number;
    drive_item_id: string;
    /** Ямар нээлтээр орсон бэ — нээсэн хавтасны id эсвэл файл өөрөө. */
    via_item_id: string;
    item_name: string;
    action: 'view' | 'download';
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO client_drive_access_log (project_id, org_id, user_id, drive_item_id, via_item_id, item_name, action)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(entry.project_id, entry.org_id, entry.user_id, entry.drive_item_id, entry.via_item_id, entry.item_name, entry.action)
      .run();
  } catch (err) {
    console.warn('[client-drive] access log бичигдсэнгүй', err);
  }
}
