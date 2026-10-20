/**
 * Хуучин архивын өгөгдлийг БҮРМӨСӨН устгах (2026-09-11).
 *
 * Эзний шийдвэр: баримт бичиг бүхэлдээ Google Drive рүү шилжсэн, серверээс
 * импортолсон архивууд (0249–0251) нь R2-д ~30 GB (5 518 хувилбар) байтаар
 * хадгалагдаж Cloudflare-ийн төлбөр нэмж байна — «өмнөх өгөгдлийг цэвэрлэж,
 * зөвхөн Drive-аас унш».
 *
 * `DELETE /archives/:id` нь ЗӨӨЛӨН устгал (мөр нуугдана, R2 объект үлдэнэ) тул
 * төлбөрийг огт бууруулдаггүй.  Энэ route нь хатуу устгал:
 *
 *   GET  /api/documents/purge-legacy   (admin)  юу устахыг тоолно — баталгаажуулах цонхонд
 *   POST /api/documents/purge-legacy   (admin)  { confirm: 'PURGE-LEGACY-ARCHIVES' }
 *
 * ⚠️ R2-ын түлхүүрийг PREFIX-ээр БИШ, `document_revisions.file_url`-аас НЭГ
 *    БҮРЧЛЭН авна: `MEDIA_BUCKET` нь профайлын зураг, төслийн зураг, имэйлийн
 *    хавсралт зэрэг бусад модулиудтай НЭГ нэрийн орон зайтай (`<userId>-<ts>-<name>`
 *    хэлбэрийн ерөнхий upload түлхүүр).  Prefix-ээр арчвал бусдын файл устна.
 * ⚠️ D1 нь FK cascade-ыг runtime дээр ажиллуулдаггүй тул мөрүүдийг ГАРААР,
 *    хүүхдээс эцэг рүү дарааллаар устгана (documentPurge.ts-тэй ижил дүрэм).
 * ⚠️ Google Docs засварлалтын ажлын хуулбарууд (`document_google_files`) —
 *    Drive дээрх хуулбарыг хогийн сав руу, MEETING_BUCKET дахь preview кэшийг
 *    устгана; Drive-ын алдаа нь purge-ийг зогсоохгүй (best effort).
 *
 * Идемпотент: хоёр дахь дуудлага 0 тоо буцаана.  R2-ын `delete(string[])` нь
 * 1000 түлхүүр/дуудлага тул 5 518 объект ≈ 6 дуудлага.
 */
import type { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { driveTrash } from '../lib/google/driveClient';

type App = Hono<{ Bindings: Env; Variables: AppVariables }>;

export const PURGE_CONFIRM_TOKEN = 'PURGE-LEGACY-ARCHIVES';

/** `/media/<key>` → `<key>`; аль хэдийн түүхий түлхүүр бол хэвээр. */
export function mediaKeyFromUrl(fileUrl: string): string | null {
  const s = fileUrl.trim();
  if (!s) return null;
  const i = s.indexOf('/media/');
  const key = i >= 0 ? s.slice(i + '/media/'.length) : s.replace(/^\/+/, '');
  // Хавтастай (`a/b`) буюу хоосон түлхүүр нь энэ модулийн upload биш — алгасна.
  if (!key || key.includes('/')) return null;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

interface PurgeCounts {
  archives: number;
  folders: number;
  documents: number;
  revisions: number;
  revision_bytes: number;
  google_files: number;
}

async function countLegacy(db: D1Database): Promise<PurgeCounts> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM document_archives) AS archives,
         (SELECT COUNT(*) FROM document_folders) AS folders,
         (SELECT COUNT(*) FROM documents) AS documents,
         (SELECT COUNT(*) FROM document_revisions) AS revisions,
         (SELECT COALESCE(SUM(file_size), 0) FROM document_revisions) AS revision_bytes,
         (SELECT COUNT(*) FROM document_google_files) AS google_files`,
    )
    .first<PurgeCounts>();
  return (
    row ?? { archives: 0, folders: 0, documents: 0, revisions: 0, revision_bytes: 0, google_files: 0 }
  );
}

export function mountDocumentPurge(app: App): void {
  app.get('/purge-legacy', requireAdmin(), async (c) => {
    c.header('Cache-Control', 'private, no-store');
    return c.json(await countLegacy(c.env.DB));
  });

  app.post('/purge-legacy', requireAdmin(), async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const body = await c.req.json<{ confirm?: string }>().catch(() => ({}) as { confirm?: string });
    if (body.confirm !== PURGE_CONFIRM_TOKEN) {
      return c.json({ error: 'Баталгаажуулах үг таарсангүй', code: 'CONFIRM_REQUIRED' }, 400);
    }
    const db = c.env.DB;
    const before = await countLegacy(db);

    /* 1. R2 — зөвхөн хувилбарын мөрүүдийн заасан түлхүүрүүд. */
    const { results: revRows } = await db
      .prepare(`SELECT file_url FROM document_revisions`)
      .all<{ file_url: string }>();
    const keys = new Set<string>();
    for (const r of revRows) {
      const k = mediaKeyFromUrl(r.file_url);
      if (k) keys.add(k);
    }
    const keyList = [...keys];
    let r2Deleted = 0;
    for (let i = 0; i < keyList.length; i += 1000) {
      const batch = keyList.slice(i, i + 1000);
      await c.env.MEDIA_BUCKET.delete(batch);
      r2Deleted += batch.length;
    }

    /* 2. Google Docs ажлын хуулбарууд — Drive-ын хогийн сав + preview кэш. */
    const { results: gRows } = await db
      .prepare(`SELECT google_file_id, preview_key, status FROM document_google_files`)
      .all<{ google_file_id: string; preview_key: string | null; status: string }>();
    let driveTrashed = 0;
    let driveFailed = 0;
    for (const g of gRows) {
      if (g.preview_key) await c.env.MEETING_BUCKET.delete(g.preview_key).catch(() => {});
      if (g.status !== 'open') continue; // хаагдсан мөрийн хуулбар аль хэдийн хогийн саванд
      try {
        await driveTrash(c.env, g.google_file_id);
        driveTrashed++;
      } catch (err) {
        driveFailed++;
        console.warn('[document-purge] drive trash failed', g.google_file_id, err);
      }
    }

    /* 3. D1 — хүүхдээс эцэг рүү, нэг batch (D1 batch нь транзакц). */
    await db.batch([
      db.prepare(`DELETE FROM document_comments`),
      db.prepare(`DELETE FROM document_google_files`),
      db.prepare(`DELETE FROM document_revisions`),
      db.prepare(`DELETE FROM documents`),
      db.prepare(`DELETE FROM document_folders`),
      db.prepare(`DELETE FROM document_archives`),
      // 0267-ийн захиалагчийн intake зорилтот цэг — архив устсан тул холбоос хүчингүй.
      db.prepare(`UPDATE projects SET client_intake_archive_id = NULL, client_intake_folder_id = NULL
                   WHERE client_intake_archive_id IS NOT NULL OR client_intake_folder_id IS NOT NULL`),
    ]);

    console.log(
      `[document-purge] by user=${c.get('user').sub}: archives=${before.archives} documents=${before.documents} ` +
        `revisions=${before.revisions} bytes=${before.revision_bytes} r2=${r2Deleted} drive=${driveTrashed}/${gRows.length}`,
    );
    return c.json({
      purged: before,
      r2_objects_deleted: r2Deleted,
      drive_copies_trashed: driveTrashed,
      drive_copies_failed: driveFailed,
      after: await countLegacy(db),
    });
  });
}
