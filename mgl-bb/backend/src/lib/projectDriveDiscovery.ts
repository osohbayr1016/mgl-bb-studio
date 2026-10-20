/**
 * Drive-ийн ҮНДСЭН хавтас → үндсэн төслийн автомат илрүүлэлт (2026-09-24).
 *
 * Админ нэг удаа төслийн бүх хавтсыг агуулсан том хавтсыг холбоно
 * (`app_settings.project_drive.company_root`).  2 минут тутмын Drive
 * сонсогчийн тик (`syncProjectDriveChanges`, ШИНЭ cron илэрхийлэлгүй) эхлээд
 * энэ хавтасны шууд хүүхдүүдийг НЭГ `files.list`-ээр уншаад:
 *   · холбогдоогүй шинэ хавтас бүрд `main_projects` мөр үүсгэж хавтсыг
 *     холбоно — «Баримт бичиг» хуудсанд карт болж гарна;
 *   · нэр нь өөрчлөгдсөн хавтасны нэрийг шинэчилнэ (админы өгсөн нэрийг биш).
 * Дүрэм нь цэвэр `driveDiscovery.ts`-д (тесттэй).
 *
 * Хүсээгүй хавтсыг админ устгавал / салгавал «алгасах» жагсаалтад орно
 * (`project_drive.discovery_ignored`) — эс бөгөөс дараагийн тик дахин үүсгэнэ.
 * Хавтас Drive-аас устсан ч үндсэн төслийг ХӨНДӨХГҮЙ (гишүүн ангиллын
 * төслүүд нь холбоотой байж болно) — таб өөрөө «олдсонгүй» гэж хэлнэ.
 *
 * Хувилбарын түүх: илрүүлэлт нэг тик дотор Changes татахаас ӨМНӨ явдаг тул
 * шинэ хавтсанд байршуулсан файлууд тэр тикээс эхлэн ledger-т орно.  Өөр
 * газраас ЗӨӨЖ оруулсан хуучин агуулгын анхны хуулбар (baseline) автоматаар
 * АВАГДАХГҮЙ — R2 зардал; админ төслийн «Эхний хуулбар авах» товчоор авна.
 */
import type { Env } from '../types';
import { driveBrowseList } from './google/driveBrowse';
import {
  addIgnored,
  mainProjectFromFolderName,
  parseIgnored,
  planDiscovery,
  planRenames,
  removeIgnored,
  type DiscoveryChild,
  type FolderRef,
  type LinkedMain,
} from './driveDiscovery';

const ROOT_KEY = 'project_drive.company_root';
const IGNORED_KEY = 'project_drive.discovery_ignored';
const LAST_KEY = 'project_drive.discovery_last';

/** Үндсэн хавтсыг бүхэлд нь уншихад хуудасны тааз (200 × 10 = 2 000 зүйл). */
const MAX_PAGES = 10;

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value)
    .run();
}

/* ---- Тохиргоо ------------------------------------------------------ */

export async function loadCompanyRoot(db: D1Database): Promise<FolderRef | null> {
  const raw = await getSetting(db, ROOT_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { id?: unknown; name?: unknown };
    const id = typeof v.id === 'string' ? v.id.trim() : '';
    if (!id) return null;
    return { id, name: typeof v.name === 'string' ? v.name : id };
  } catch {
    return null;
  }
}

export async function saveCompanyRoot(db: D1Database, root: FolderRef | null): Promise<void> {
  await setSetting(db, ROOT_KEY, root ? JSON.stringify({ id: root.id, name: root.name }) : '');
}

export async function loadIgnored(db: D1Database): Promise<FolderRef[]> {
  return parseIgnored(await getSetting(db, IGNORED_KEY));
}

/** Хавтсыг «алгасах» — үндсэн төслийг устгасан / хавтсыг салгасан үед. */
export async function ignoreDiscoveredFolder(db: D1Database, folder: FolderRef): Promise<void> {
  const list = await loadIgnored(db);
  await setSetting(db, IGNORED_KEY, JSON.stringify(addIgnored(list, folder)));
}

/** Алгасахаас гаргана — дахин холбосон эсвэл админ «буцааж нэмэх» дарсан. */
export async function unignoreDiscoveredFolder(db: D1Database, folderId: string): Promise<boolean> {
  const list = await loadIgnored(db);
  const next = removeIgnored(list, folderId);
  if (next.length === list.length) return false;
  await setSetting(db, IGNORED_KEY, JSON.stringify(next));
  return true;
}

export interface DiscoveryLast {
  at: string;
  created: string[];
  error: string | null;
}

export async function loadDiscoveryLast(db: D1Database): Promise<DiscoveryLast | null> {
  const raw = await getSetting(db, LAST_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DiscoveryLast>;
    return {
      at: typeof v.at === 'string' ? v.at : '',
      created: Array.isArray(v.created) ? v.created.filter((s): s is string => typeof s === 'string') : [],
      error: typeof v.error === 'string' ? v.error : null,
    };
  } catch {
    return null;
  }
}

/* ---- Илрүүлэлт ------------------------------------------------------ */

async function listChildren(env: Env, rootId: string): Promise<DiscoveryChild[]> {
  const out: DiscoveryChild[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await driveBrowseList(env, rootId, pageToken);
    for (const f of res.files) out.push({ id: f.id, name: f.name, mimeType: f.mimeType, trashed: f.trashed });
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function loadLinkedIds(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT google_drive_folder_id AS id FROM main_projects WHERE google_drive_folder_id IS NOT NULL AND google_drive_folder_id <> ''
       UNION
       SELECT google_drive_folder_id AS id FROM projects WHERE google_drive_folder_id IS NOT NULL AND google_drive_folder_id <> ''`,
    )
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id.trim()).filter(Boolean));
}

export interface DiscoveryResult {
  configured: boolean;
  created: FolderRef[];
  renamed: number;
}

/**
 * Нэг удаагийн илрүүлэлт.  Давхар ажиллавал (cron + админы «Одоо шалгах»)
 * INSERT нь `NOT EXISTS` хамгаалалттай тул ижил хавтсанд ХОЁР мөр үүсэхгүй.
 * Drive-ийн алдааг дуудагч руу шидэнэ (route нь хэрэглэгчид код буцаана).
 */
export async function discoverProjectFolders(env: Env): Promise<DiscoveryResult> {
  const db = env.DB;
  const root = await loadCompanyRoot(db);
  if (!root) return { configured: false, created: [], renamed: 0 };

  let children: DiscoveryChild[];
  try {
    children = await listChildren(env, root.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const prev = await loadDiscoveryLast(db);
    // Ижил алдааг тик бүр дахин бичихгүй (өдөрт 720 бичилт).
    if (prev?.error !== message) {
      await setSetting(db, LAST_KEY, JSON.stringify({ at: new Date().toISOString(), created: [], error: message }));
    }
    throw err;
  }

  const [linked, ignored] = await Promise.all([loadLinkedIds(db), loadIgnored(db)]);
  const toCreate = planDiscovery(children, linked, new Set(ignored.map((e) => e.id)));

  const created: FolderRef[] = [];
  for (const folder of toCreate) {
    const { code, name } = mainProjectFromFolderName(folder.name);
    const res = await db
      .prepare(
        `INSERT INTO main_projects (code, name, google_drive_folder_id, google_drive_folder_name, created_by)
         SELECT ?, ?, ?, ?, NULL
          WHERE NOT EXISTS (SELECT 1 FROM main_projects WHERE google_drive_folder_id = ?)
            AND NOT EXISTS (SELECT 1 FROM projects WHERE google_drive_folder_id = ?)`,
      )
      .bind(code, name, folder.id, folder.name, folder.id, folder.id)
      .run();
    if (res.meta.changes) created.push(folder);
  }

  const { results: mains } = await db
    .prepare(
      `SELECT id, name, google_drive_folder_id AS folder_id, google_drive_folder_name AS folder_name
         FROM main_projects WHERE google_drive_folder_id IS NOT NULL AND google_drive_folder_id <> ''`,
    )
    .all<LinkedMain>();
  const renames = planRenames(children, mains);
  if (renames.length > 0) {
    await db.batch(
      renames.map((r) =>
        r.name !== null
          ? db
              .prepare(
                `UPDATE main_projects SET google_drive_folder_name = ?, name = ?, updated_at = datetime('now') WHERE id = ?`,
              )
              .bind(r.folder_name, r.name, r.id)
          : db
              .prepare(`UPDATE main_projects SET google_drive_folder_name = ?, updated_at = datetime('now') WHERE id = ?`)
              .bind(r.folder_name, r.id),
      ),
    );
  }

  const prev = await loadDiscoveryLast(db);
  if (created.length > 0 || prev?.error) {
    await setSetting(
      db,
      LAST_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        created: created.length > 0 ? created.map((f) => f.name) : (prev?.created ?? []),
        error: null,
      }),
    );
  }
  if (created.length > 0) {
    console.log('[project-drive-discovery] created', created.map((f) => f.name).join(' | '));
  }
  return { configured: true, created, renamed: renames.length };
}
