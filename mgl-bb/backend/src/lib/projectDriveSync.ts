/**
 * Төслийн Drive хавтсыг СОНСОЖ, хадгалагдсан файл бүрийн хуулбарыг өөртөө
 * авах, «хэн, хэзээ, юу өөрчилсөн» гэдгийг бүртгэх, хувилбар руу БУЦААХ
 * (миграц 0300, 2026-09-15).
 *
 * Эзний шийдвэр: Drive-ын хавтсыг холбоостой хэн ч засварлана, харин систем
 * Drive-ыг байнга сонсож, хадгалагдсан хувилбар бүрийг өөртөө хадгалж авдаг
 * байх ёстой.  Drive нь ЭХ СУРВАЛЖ хэвээр (0278) — энд зөвхөн ХУВИЛБАРЫН
 * хуулбар (хувийн R2, `MEETING_BUCKET`, `drive-versions/` угтвар) ба ledger
 * (`project_drive_versions`).
 *
 * УРСГАЛ (2 минут тутмын cron салаа, index.ts — ШИНЭ cron илэрхийлэл НЭМЭЭГҮЙ,
 * гурав дахь илэрхийлэл нь mail/meeting/calendar/deadline дөрвөлийг давхар
 * ажиллуулна):
 *
 *   1. `pullChanges` — Drive Changes API (`changes.list`, SA-ийн харах бүх
 *      файлын өөрчлөлт, хуваалцсан хавтасных ч орно).  Өөрчлөлт бүрийг
 *      «аль холбогдсон үндэс хавтасны дотор вэ» гэж эцгээр нь дээшилж шалгаад
 *      (`findLinkedRoot`), таарсныг `project_drive_pending`-д бичнэ.
 *      Токен (`app_settings.project_drive.changes_token`) хуудас бүрийн дараа
 *      урагшилна; анх удаа = «одооноос хойш» (`startPageToken`), түүх биш.
 *   1б. `pollRecentlyModified` — нөөц: «сүүлийн тикээс (+5 мин давхцал) хойш
 *      өөрчлөгдсөн файлууд» гэсэн нэг `files.list`.  Хуваалцсан хавтасны
 *      Changes мэдэгдэл хоцорч/алдагдвал ч хадгалалт алдагдахгүй.
 *   2. `processPending` — хүлээгдэж буй файл бүрийн одоогийн метаг Drive-аас
 *      дахин уншиж (`files.get`), сүүлийн засвараас хойш QUIET_MS өнгөрсөн бол
 *      (Google Docs бичих бүрт modifiedTime-аа шинэчилдэг — хагас өгүүлбэр
 *      хуулбарлахгүй) өмнөх бүртгэлтэй харьцуулж (`classifyChange`), агуулга
 *      өөрчлөгдсөн бол байтыг R2 руу УРСГАЛААР хийж, мөр бичнэ.
 *
 * Хэн засав: Drive-ын `lastModifyingUser` — ажилтнууд хувийн Google акаунтгүй
 * тул энэ нь БАГИЙН акаунт; холбоосоор орсон нэргүй хүнд огт байхгүй.
 * ERP-ийн хүн `restored` мөрөнд (`restored_by_user_id`) ба ERP-ээс байршуулсан
 * `created`/`modified` мөрөнд (`uploaded_by_user_id`, миграц 0325 —
 * `recordUpload`) мэдэгддэг.
 *
 * Хуулбарын хэлбэр: энгийн файл → эх байт; Docs/Sheets/Slides → docx/xlsx/pptx
 * (Drive-ын экспорт, 10 MB тааз) — тэр хэлбэрээр л буцааж ачаалагдана;
 * Drawing → PNG (буцаахгүй); бусад Google формат → зөвхөн мета.
 *
 * Сэргээх (`restoreVersion`): R2 дахь хуулбарыг `files.update`-ээр Drive руу
 * буцааж ачаална — Drive өөрөө ШИНЭ хувилбар үүсгэнэ (юу ч устахгүй), хогийн
 * саванд байвал эхлээд буцаана, бүрмөсөн устсан бол эцэг хавтсанд нь шинэ файл
 * болгон үүсгэнэ.  Хоёуланд нь SA «Засварлагч» эрхтэй байх ёстой.
 */
import type { Env } from '../types';
import {
  DriveBrowseError,
  FOLDER_MIME,
  GOOGLE_APPS_PREFIX,
  driveBrowseConfigured,
  driveBrowseDownload,
  driveBrowseExport,
  driveBrowseGetSync,
  driveBrowseList,
  driveChangesList,
  driveChangesStartToken,
  driveCreateFromSnapshot,
  driveListModifiedSince,
  driveSetTrashed,
  driveUpdateContent,
  type DriveEntry,
} from './google/driveBrowse';
import { findLinkedRoot, invalidateDriveListing } from './projectDriveAccess';
import { discoverProjectFolders, loadCompanyRoot } from './projectDriveDiscovery';
import {
  classifyChange,
  isSettled,
  snapshotPlan,
  versionR2Key,
  type DriveChangeKind,
  type DriveVersionRow,
} from './projectDriveVersions';

const TOKEN_KEY = 'project_drive.changes_token';
const LOCK_KEY = 'project_drive.sync_lock';
/** Нөөц poll-ын сүүлийн цаг (ISO). */
const POLL_KEY = 'project_drive.poll_since';
/** Нөөц poll-ын давхцал — өмнөх тикийн цагаас энэ хэрээр өмнөхийг ч дахин харна. */
const POLL_OVERLAP_MS = 5 * 60_000;
const POLL_MAX_PAGES = 5;
/** Сүүлийн засвараас хойш энэ хугацаа чимээгүй байвал «хадгалагдсан» гэж
 *  үзнэ (documentGoogle.ts-ийн 5 минутаас богино — энэ нь хуулбар л авдаг,
 *  архив руу бичдэггүй). */
export const QUIET_MS = 3 * 60_000;
const MAX_PAGES_PER_TICK = 20;
const PENDING_BATCH = 25;
const MAX_ATTEMPTS = 6;
/**
 * Байт хуулбарыг R2-д авах эсэх.  ЭЗНИЙ ШИЙДВЭР 2026-10-12: «Google Drive-д
 * итгэнэ» — `drive-versions/` (40 GB) устгагдсан, хуулбар ХИЙХГҮЙ; сэргээх бол
 * Drive-ын өөрийн «Version history».  Ledger (хэн/хэзээ/юу) хэвээр бичигдэнэ,
 * мөр бүр r2_key=NULL → UI татах/буцаах товч харуулахгүй (`has_snapshot`).
 */
const SNAPSHOTS_ENABLED = false;
/** Үүнээс том файлыг хуулбарлахгүй — мөр нь r2_key=NULL-тэй бүртгэгдэнэ. */
export const SNAPSHOT_MAX_BYTES = 1024 * 1024 * 1024;
/** Drive `content-length` өгөөгүй үед (экспорт) санах ойд цуглуулах тааз. */
const BUFFER_MAX_BYTES = 48 * 1024 * 1024;
/** Өмнөх тик 15 минутын cron хязгаараас хэтэрсэн/унасан бол цоожийг хуучирсан гэж үзнэ. */
const LOCK_STALE_MS = 12 * 60_000;
/** «Эхний хуулбар» — хавтасны модыг алхахад дээд тоо. */
const BASELINE_MAX_FOLDERS = 60;
const BASELINE_MAX_FILES = 2000;

/* ------------------------------------------------------------------ */
/*  app_settings туслахууд                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  D1 — үндэс хавтас, хувилбар, хүлээлгийн мөр                        */
/* ------------------------------------------------------------------ */

/** Холбогдсон бүх үндэс хавтас (төсөл + үндсэн төсөл). */
export async function loadLinkedRoots(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT google_drive_folder_id AS id FROM projects WHERE google_drive_folder_id IS NOT NULL AND google_drive_folder_id <> ''
       UNION
       SELECT google_drive_folder_id AS id FROM main_projects WHERE google_drive_folder_id IS NOT NULL AND google_drive_folder_id <> ''`,
    )
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id.trim()).filter(Boolean));
}

export async function latestVersion(db: D1Database, fileId: string): Promise<DriveVersionRow | null> {
  return (
    (await db
      .prepare('SELECT * FROM project_drive_versions WHERE file_id = ? ORDER BY id DESC LIMIT 1')
      .bind(fileId)
      .first<DriveVersionRow>()) ?? null
  );
}

export async function loadVersion(db: D1Database, id: number): Promise<DriveVersionRow | null> {
  return (await db.prepare('SELECT * FROM project_drive_versions WHERE id = ?').bind(id).first<DriveVersionRow>()) ?? null;
}

type NewVersion = Omit<DriveVersionRow, 'id' | 'created_at'>;

async function insertVersion(db: D1Database, v: NewVersion): Promise<DriveVersionRow> {
  const row = await db
    .prepare(
      `INSERT INTO project_drive_versions
         (root_folder_id, file_id, file_name, mime_type, parent_id, size, md5, drive_version,
          drive_modified_at, modified_by_name, modified_by_email, change_kind, r2_key, snapshot_mime,
          restored_from_version_id, restored_by_user_id, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(
      v.root_folder_id,
      v.file_id,
      v.file_name,
      v.mime_type,
      v.parent_id,
      v.size,
      v.md5,
      v.drive_version,
      v.drive_modified_at,
      v.modified_by_name,
      v.modified_by_email,
      v.change_kind,
      v.r2_key,
      v.snapshot_mime,
      v.restored_from_version_id,
      v.restored_by_user_id,
      v.uploaded_by_user_id,
    )
    .first<DriveVersionRow>();
  if (!row) throw new Error('project_drive_versions insert returned no row');
  return row;
}

/** Drive-ын метаг мөрийн талбарууд болгоно (change_kind/r2 нь дуудагчийнх). */
function metaFields(root: string, meta: DriveEntry) {
  return {
    root_folder_id: root,
    file_id: meta.id,
    file_name: meta.name,
    mime_type: meta.mimeType,
    parent_id: meta.parents?.[0] ?? null,
    size: meta.size ? Number(meta.size) : null,
    md5: meta.md5Checksum ?? null,
    drive_version: meta.version ?? null,
    drive_modified_at: meta.modifiedTime ?? null,
    modified_by_name: meta.lastModifyingUser?.displayName ?? null,
    modified_by_email: meta.lastModifyingUser?.emailAddress ?? null,
  };
}

async function enqueuePending(
  db: D1Database,
  fileId: string,
  root: string,
  modifiedTime: string | null,
  removed: boolean,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO project_drive_pending (file_id, root_folder_id, drive_modified_at, removed)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(file_id) DO UPDATE SET
         root_folder_id = excluded.root_folder_id,
         drive_modified_at = COALESCE(excluded.drive_modified_at, project_drive_pending.drive_modified_at),
         removed = MAX(project_drive_pending.removed, excluded.removed)`,
    )
    .bind(fileId, root, modifiedTime, removed ? 1 : 0)
    .run();
}

async function dequeuePending(db: D1Database, fileId: string): Promise<void> {
  await db.prepare('DELETE FROM project_drive_pending WHERE file_id = ?').bind(fileId).run();
}

/* ------------------------------------------------------------------ */
/*  Байт хуулбар → R2                                                  */
/* ------------------------------------------------------------------ */

interface Snapshot {
  key: string;
  mime: string;
  size: number;
}

/**
 * Файлын байтыг Drive-аас R2 руу.  `content-length` мэдэгдэж байвал
 * УРСГАЛААР (`FixedLengthStream` — R2 урт мэдэх шаардлагатай), эс бөгөөс
 * (экспорт chunked ирдэг) санах ойд цуглуулна — экспорт 10 MB-аас хэтэрдэггүй.
 * Хэт том / хуулбарлагдахгүй төрөл → null (мөр r2_key=NULL-тэй бичигдэнэ).
 */
async function snapshotToR2(env: Env, root: string, meta: DriveEntry): Promise<Snapshot | null> {
  if (!SNAPSHOTS_ENABLED) return null;
  const plan = snapshotPlan(meta.mimeType);
  if (plan.kind === 'none' || !plan.mime) return null;
  const declared = meta.size ? Number(meta.size) : 0;
  if (declared > SNAPSHOT_MAX_BYTES) return null;

  const upstream =
    plan.kind === 'export' ? await driveBrowseExport(env, meta.id, plan.mime) : await driveBrowseDownload(env, meta.id);
  const key = versionR2Key(root, meta.id);
  const lenHeader = upstream.headers.get('content-length');
  const len = lenHeader ? Number(lenHeader) : NaN;

  if (Number.isFinite(len) && len >= 0 && upstream.body) {
    if (len > SNAPSHOT_MAX_BYTES) {
      await upstream.body.cancel().catch(() => {});
      return null;
    }
    const { readable, writable } = new FixedLengthStream(len);
    // pipeTo унавал put ч унана; unhandled rejection болгохгүйн тулд алдааг
    // барьж, put-ын дараа дахин шиднэ.
    let pumpError: unknown = null;
    const pump = upstream.body.pipeTo(writable).catch((e: unknown) => {
      pumpError = e;
    });
    await env.MEETING_BUCKET.put(key, readable, { httpMetadata: { contentType: plan.mime } });
    await pump;
    if (pumpError) throw pumpError;
    return { key, mime: plan.mime, size: len };
  }

  // Урт мэдэгдэхгүй — цуглуулна, таазтай.
  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > BUFFER_MAX_BYTES) return null;
  await env.MEETING_BUCKET.put(key, buf, { httpMetadata: { contentType: plan.mime } });
  return { key, mime: plan.mime, size: buf.byteLength };
}

/* ------------------------------------------------------------------ */
/*  1. Changes API татах                                               */
/* ------------------------------------------------------------------ */

async function pullChanges(env: Env, roots: ReadonlySet<string>): Promise<void> {
  const db = env.DB;
  let token = await getSetting(db, TOKEN_KEY);
  if (!token) {
    // Анхны ажиллагаа: түүх биш, ОДООНООС хойшхи өөрчлөлт.  Одоо байгаа файлын
    // эхний хуулбарыг «Эхний хуулбар авах» (enqueueBaseline) өгнө.
    token = await driveChangesStartToken(env);
    await setSetting(db, TOKEN_KEY, token);
    return;
  }

  const touchedFolders = new Set<string>();
  for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
    const res = await driveChangesList(env, token);
    for (const ch of res.changes) {
      if (!ch.fileId) continue;
      const file = ch.file;
      if (file && file.mimeType === FOLDER_MIME) {
        // Хавтасны өөрийн өөрчлөлт (нэр) — хувилбар бүртгэхгүй, зөвхөн жагсаалтын кэш.
        touchedFolders.add(file.id);
        continue;
      }
      if (ch.removed || !file) {
        // Устсан / SA-д харагдахаа больсон — өмнө нь бүртгэлтэй байсан бол л сонирхоно.
        const prev = await latestVersion(db, ch.fileId);
        if (prev && prev.change_kind !== 'deleted') {
          await enqueuePending(db, ch.fileId, prev.root_folder_id, null, true);
        }
        continue;
      }
      const root = await findLinkedRoot(env, file.id, roots, file);
      if (!root) {
        // Төслийн хавтаснаас ГАДАГШ зөөгдсөн, өмнө нь бүртгэлтэй файл — устсантай адил.
        const prev = await latestVersion(db, file.id);
        if (prev && prev.change_kind !== 'deleted') {
          await enqueuePending(db, file.id, prev.root_folder_id, null, true);
        }
        continue;
      }
      for (const p of file.parents ?? []) touchedFolders.add(p);
      await enqueuePending(db, file.id, root, file.modifiedTime ?? null, false);
    }
    if (res.newStartPageToken) {
      token = res.newStartPageToken;
      await setSetting(db, TOKEN_KEY, token);
      break;
    }
    if (!res.nextPageToken) break;
    token = res.nextPageToken;
    await setSetting(db, TOKEN_KEY, token);
  }
  // Ажилтны нээлттэй таб дараагийн уншилтдаа шинэ жагсаалт авна (энэ isolate-д).
  for (const f of touchedFolders) invalidateDriveListing(f);
}

/**
 * 1б. НӨӨЦ poll — `since`-ээс хойш өөрчлөгдсөн (SA-д харагдах) файлууд.
 * Хуваалцсан хавтасны Changes мэдэгдэл хоцорч/алдагдаж болзошгүй тул тик бүр
 * нэг `files.list`-ээр давхар шалгана; давхардлыг `pending`-ийн PK хаана.
 * Устгал энд орохгүй (Changes + боловсруулах үеийн NOT_FOUND л барина).
 */
async function pollRecentlyModified(env: Env, roots: ReadonlySet<string>): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const prev = await getSetting(db, POLL_KEY);
  const prevMs = prev ? Date.parse(prev) : NaN;
  const since = new Date((Number.isFinite(prevMs) ? prevMs : now) - POLL_OVERLAP_MS).toISOString();
  let pageToken: string | null = null;
  for (let page = 0; page < POLL_MAX_PAGES; page++) {
    const res = await driveListModifiedSince(env, since, pageToken);
    for (const file of res.files) {
      const root = await findLinkedRoot(env, file.id, roots, file);
      if (!root) continue;
      await enqueuePending(db, file.id, root, file.modifiedTime ?? null, false);
    }
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  await setSetting(db, POLL_KEY, new Date(now).toISOString());
}

/* ------------------------------------------------------------------ */
/*  2. Хүлээгдэж буй файлуудыг боловсруулах                            */
/* ------------------------------------------------------------------ */

interface PendingRow {
  file_id: string;
  root_folder_id: string;
  first_seen_at: string;
  drive_modified_at: string | null;
  removed: number;
  attempts: number;
  last_error: string | null;
}

async function recordDeleted(db: D1Database, prev: DriveVersionRow): Promise<void> {
  await insertVersion(db, {
    ...prev,
    change_kind: 'deleted',
    // Устсан төлөвт байт хуулбар байхгүй — өмнөх мөрүүд өөрсдийн r2_key-тэй хэвээр.
    r2_key: null,
    snapshot_mime: null,
    restored_from_version_id: null,
    restored_by_user_id: null,
    uploaded_by_user_id: null,
  });
}

async function processOne(env: Env, row: PendingRow, nowMs: number): Promise<void> {
  const db = env.DB;
  const prev = await latestVersion(db, row.file_id);

  if (row.removed) {
    if (prev && prev.change_kind !== 'deleted') await recordDeleted(db, prev);
    await dequeuePending(db, row.file_id);
    return;
  }

  let meta: DriveEntry;
  try {
    meta = await driveBrowseGetSync(env, row.file_id);
  } catch (err) {
    if (err instanceof DriveBrowseError && (err.code === 'NOT_FOUND' || err.code === 'PERMISSION_DENIED')) {
      if (prev && prev.change_kind !== 'deleted') await recordDeleted(db, prev);
      await dequeuePending(db, row.file_id);
      return;
    }
    throw err;
  }

  // Google баримт бичигдсээр байвал дараагийн тик хүртэл хүлээнэ (хогийн сав,
  // устгал нь шууд).
  if (!meta.trashed && !isSettled(meta.modifiedTime, nowMs, QUIET_MS)) {
    await db
      .prepare('UPDATE project_drive_pending SET drive_modified_at = ? WHERE file_id = ?')
      .bind(meta.modifiedTime ?? null, row.file_id)
      .run();
    return;
  }

  const cls = classifyChange(prev, meta);
  if (!cls) {
    await dequeuePending(db, row.file_id);
    return;
  }

  let r2Key: string | null = prev?.r2_key ?? null;
  let snapshotMime: string | null = prev?.snapshot_mime ?? null;
  if (cls.contentChanged) {
    const snap = await snapshotToR2(env, row.root_folder_id, meta);
    r2Key = snap?.key ?? null;
    snapshotMime = snap?.mime ?? null;
  }
  await insertVersion(db, {
    ...metaFields(row.root_folder_id, meta),
    change_kind: cls.kind,
    r2_key: r2Key,
    snapshot_mime: snapshotMime,
    restored_from_version_id: null,
    restored_by_user_id: null,
    uploaded_by_user_id: null,
  });
  await dequeuePending(db, row.file_id);
  const parent = meta.parents?.[0];
  if (parent) invalidateDriveListing(parent);
}

async function processPending(env: Env): Promise<void> {
  const db = env.DB;
  const { results } = await db
    .prepare(
      `SELECT * FROM project_drive_pending
        WHERE attempts < ?
        ORDER BY removed DESC, first_seen_at ASC
        LIMIT ?`,
    )
    .bind(MAX_ATTEMPTS, PENDING_BATCH)
    .all<PendingRow>();
  const now = Date.now();
  for (const row of results) {
    try {
      await processOne(env, row, now);
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 300) : String(err);
      console.error(`[project-drive-sync] file=${row.file_id} attempt=${row.attempts + 1}: ${msg}`);
      await db
        .prepare('UPDATE project_drive_pending SET attempts = attempts + 1, last_error = ? WHERE file_id = ?')
        .bind(msg, row.file_id)
        .run();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Cron-ын орох цэг                                                   */
/* ------------------------------------------------------------------ */

/**
 * 2 минут тутам.  Цоож (`app_settings.project_drive.sync_lock`): өмнөх тик том
 * файл хуулбарлаж байгаа бол давхар ажиллахгүй; 12 минутаас хуучирсан цоожийг
 * унасан гэж үзнэ.  Холбогдсон хавтас ч, Drive-ийн үндсэн хавтас ч байхгүй бол
 * Drive рүү огт очихгүй.
 *
 * Тик бүр ЭХЛЭЭД үндсэн хавтаснаас шинэ төслийн хавтсыг илрүүлнэ
 * (`projectDriveDiscovery.ts`), дараа нь холбогдсон хавтсуудыг ДАХИН уншина —
 * тэгснээр шинэ хавтсанд байршуулсан файлууд ИЖИЛ тикийн Changes-оос алдагдахгүй.
 */
export async function syncProjectDriveChanges(env: Env): Promise<void> {
  if (!driveBrowseConfigured(env)) return;
  const db = env.DB;
  let roots = await loadLinkedRoots(db);
  const companyRoot = await loadCompanyRoot(db);
  if (roots.size === 0 && !companyRoot) return;

  const lock = await getSetting(db, LOCK_KEY);
  const lockAt = lock ? Date.parse(lock) : NaN;
  if (Number.isFinite(lockAt) && Date.now() - lockAt < LOCK_STALE_MS) return;
  await setSetting(db, LOCK_KEY, new Date().toISOString());
  try {
    if (companyRoot) {
      try {
        const found = await discoverProjectFolders(env);
        if (found.created.length > 0) roots = await loadLinkedRoots(db);
      } catch (err) {
        // Илрүүлэлт унасан ч холбогдсон хавтсуудын сонсголт үргэлжилнэ.
        console.error('[project-drive-discovery] failed', err instanceof Error ? err.message : err);
      }
    }
    if (roots.size === 0) return;
    await pullChanges(env, roots);
    await pollRecentlyModified(env, roots);
    await processPending(env);
  } catch (err) {
    console.error('[project-drive-sync] tick failed', err instanceof Error ? err.message : err);
  } finally {
    await setSetting(db, LOCK_KEY, '').catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/*  Эхний хуулбар — одоо байгаа файлуудыг дараалалд                    */
/* ------------------------------------------------------------------ */

/**
 * Changes API нь зөвхөн ИРЭЭДҮЙН өөрчлөлтийг өгдөг тул сонсогч асахаас өмнө
 * байсан файл анхны засвар хүртлээ хувилбаргүй — тэр засварыг буцаах
 * боломжгүй байх байсан.  Энэ нь хавтасны модыг алхаж (таазтай) файл бүрийг
 * `pending`-д хийнэ; дараагийн тик хуулбарыг нь авна (`created`).  Аль хэдийн
 * бүртгэлтэй файл `classifyChange`-ээр «өөрчлөлтгүй» болж мөр үүсгэхгүй —
 * дахин дуудахад аюулгүй.
 */
export async function enqueueBaseline(
  env: Env,
  root: string,
): Promise<{ files: number; folders: number; truncated: boolean }> {
  const db = env.DB;
  const queue = [root];
  let folders = 0;
  let files = 0;
  let truncated = false;
  while (queue.length > 0 && folders < BASELINE_MAX_FOLDERS && files < BASELINE_MAX_FILES) {
    const folderId = queue.shift()!;
    folders++;
    let pageToken: string | null = null;
    do {
      const page = await driveBrowseList(env, folderId, pageToken);
      for (const f of page.files) {
        if (f.mimeType === FOLDER_MIME) {
          queue.push(f.id);
          continue;
        }
        if (f.mimeType.startsWith(GOOGLE_APPS_PREFIX) && snapshotPlan(f.mimeType).kind === 'none') continue;
        if (files >= BASELINE_MAX_FILES) {
          truncated = true;
          break;
        }
        // drive_modified_at NULL → `isSettled` дахин уншсан метагаар шийднэ.
        await enqueuePending(db, f.id, root, null, false);
        files++;
      }
      pageToken = page.nextPageToken;
    } while (pageToken && files < BASELINE_MAX_FILES);
  }
  if (queue.length > 0) truncated = true;
  return { files, folders, truncated };
}

/* ------------------------------------------------------------------ */
/*  Сэргээх                                                            */
/* ------------------------------------------------------------------ */

export type DriveRestoreErrorCode = 'NO_SNAPSHOT' | 'NOT_RESTORABLE' | 'SNAPSHOT_MISSING' | 'NO_PARENT';

export class DriveRestoreError extends Error {
  readonly code: DriveRestoreErrorCode;
  constructor(code: DriveRestoreErrorCode) {
    super(code);
    this.name = 'DriveRestoreError';
    this.code = code;
  }
}

/**
 * Хувилбарын хуулбарыг Drive руу буцааж ачаална.  Юу ч устахгүй: Drive өөрөө
 * шинэ хувилбар үүсгэнэ; ledger-т `restored` мөр (хэн, аль хувилбараас).
 * Файл хогийн саванд → эхлээд буцаана; бүрмөсөн устсан → эцэг хавтсанд нь
 * ШИНЭ файл (шинэ Drive id) болгон үүсгэнэ — `restored` мөр тэр id-тэй.
 */
export async function restoreVersion(env: Env, ver: DriveVersionRow, userId: number): Promise<DriveVersionRow> {
  if (!ver.r2_key) throw new DriveRestoreError('NO_SNAPSHOT');
  const plan = snapshotPlan(ver.mime_type);
  if (!plan.restorable) throw new DriveRestoreError('NOT_RESTORABLE');
  const obj = await env.MEETING_BUCKET.get(ver.r2_key);
  if (!obj) throw new DriveRestoreError('SNAPSHOT_MISSING');
  const body = { stream: obj.body, length: obj.size, mime: ver.snapshot_mime ?? plan.mime ?? 'application/octet-stream' };

  let current: DriveEntry | null = null;
  try {
    current = await driveBrowseGetSync(env, ver.file_id);
  } catch (err) {
    if (!(err instanceof DriveBrowseError && err.code === 'NOT_FOUND')) throw err;
  }

  let meta: DriveEntry;
  if (current) {
    if (current.trashed) await driveSetTrashed(env, ver.file_id, false);
    meta = await driveUpdateContent(env, ver.file_id, body);
  } else {
    if (!ver.parent_id) throw new DriveRestoreError('NO_PARENT');
    const isGoogle = ver.mime_type.startsWith(GOOGLE_APPS_PREFIX);
    meta = await driveCreateFromSnapshot(env, {
      name: ver.file_name,
      parentId: ver.parent_id,
      body,
      targetMime: isGoogle ? ver.mime_type : undefined,
    });
  }

  const db = env.DB;
  // Sync тэр өөрчлөлтийг мөн харна; `restored` мөр нь шинэ md5/modifiedTime-тай
  // тул `classifyChange` «өөрчлөлтгүй» гэж хаана — давхар мөр үүсэхгүй.
  await dequeuePending(db, meta.id);
  const row = await insertVersion(db, {
    ...metaFields(ver.root_folder_id, meta),
    change_kind: 'restored' satisfies DriveChangeKind,
    r2_key: ver.r2_key,
    snapshot_mime: ver.snapshot_mime,
    restored_from_version_id: ver.id,
    restored_by_user_id: userId,
    uploaded_by_user_id: null,
  });
  const parent = meta.parents?.[0] ?? ver.parent_id;
  if (parent) invalidateDriveListing(parent);
  return row;
}

/* ------------------------------------------------------------------ */
/*  ERP-ээс байршуулсан файл — ledger + хуулбар (2026-09-17)           */
/* ------------------------------------------------------------------ */

/**
 * `routes/projectDrive.ts`-ийн upload дуусмагц (Drive файлын мета гарт орсон)
 * дуудагдана — `waitUntil` дотор, хөтөч хүлээхгүй.  Байтын хуулбарыг
 * Drive-аас R2 руу татна (сонсогчийн ижил зам — хөтчөөс ирсэн урсгал Drive
 * руу л явсан, хоёр тийш салаалаагүй), дараа нь `uploaded_by_user_id`-тэй мөр
 * бичнэ.  Хуулбар унавал ч мөр бичигдэнэ (r2_key NULL) — «хэн байршуулав»
 * гэдэг нь хуулбараас чухал.
 *
 * Мөрийн md5/version/modifiedTime нь Drive-ын хариунаас тул сонсогч дараа нь
 * Changes-ээр ижил файлыг хараад `classifyChange` «өөрчлөлтгүй» гэж хаана —
 * давхар мөр үүсэхгүй; `pending`-д урьд орсон байвал ч цэвэрлэнэ.
 */
export async function recordUpload(
  env: Env,
  rootId: string,
  meta: DriveEntry,
  opts: { userId: number; replaced: boolean },
): Promise<DriveVersionRow> {
  const db = env.DB;
  const prev = await latestVersion(db, meta.id);
  const kind: DriveChangeKind = opts.replaced && prev && prev.change_kind !== 'deleted' ? 'modified' : 'created';
  let snap: Snapshot | null = null;
  try {
    snap = await snapshotToR2(env, rootId, meta);
  } catch (err) {
    console.error(`[project-drive] upload snapshot failed file=${meta.id}`, err);
  }
  await dequeuePending(db, meta.id);
  const row = await insertVersion(db, {
    ...metaFields(rootId, meta),
    change_kind: kind,
    r2_key: snap?.key ?? null,
    snapshot_mime: snap?.mime ?? null,
    restored_from_version_id: null,
    restored_by_user_id: null,
    uploaded_by_user_id: opts.userId,
  });
  return row;
}
