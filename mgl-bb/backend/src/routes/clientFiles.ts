import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { clientCanRead } from '../lib/clientAccess';
import { streamPrivateObject } from '../lib/privateFileStream';

/**
 * `/api/client-files/*` — захиалагчийн порталын ХУВИЙН файлуудыг дамжуулна.
 *
 * ЯАГААД тусдаа зам вэ: `/media/:key` нь нэвтрэлтгүй, түлхүүр мэдсэн хэн ч
 * уншиж чадах нийтийн зам (CLAUDE.md-ийн аюулгүй байдлын #2).  Захиалагчийн
 * илгээсэн гэрээ, геологийн тайлан, бидний гаргасан зургийн багц тэнд байж
 * БОЛОХГҮЙ.  Тиймээс байтууд нь MEETING_BUCKET-ийн `client/` угтвар дор,
 * уншилт нь ЗӨВХӨН энэ route-аар — `authMiddleware`-ийн ард, эрх шалгасны
 * дараа.
 *
 * `/meeting-audio`-той ялгаа: тэр нь `<audio>` таг Authorization толгой
 * явуулж чаддаггүй учраас гарын үсэгтэй query токен хэрэглэдэг.  Энд татах
 * үйлдэл нь `fetch` + Authorization толгойгоор явдаг тул токен URL-д гарахгүй.
 */
const clientFiles = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** `lib/privateFileStream.ts`-ийн нэг функц — reports.ts (гэрээний PDF) ч ижлийг хэрэглэнэ. */
async function streamObject(
  env: Env,
  key: string,
  fileName: string,
  contentType: string | null,
): Promise<Response> {
  return streamPrivateObject(env, key, fileName, contentType);
}

/* ------------------------------------------------------------------ */
/*  Захиалагчийн илгээсэн материалын файл                              */
/* ------------------------------------------------------------------ */

clientFiles.get('/submission/:fileId', async (c) => {
  const user = c.get('user');
  const fileId = Number(c.req.param('fileId'));
  if (!Number.isFinite(fileId)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT f.r2_key, f.canonical_name, f.file_type, s.project_id, s.submitted_by, s.org_id
       FROM client_submission_files f
       JOIN client_submissions s ON s.id = f.submission_id
      WHERE f.id = ?`,
  )
    .bind(fileId)
    .first<{
      r2_key: string;
      canonical_name: string;
      file_type: string | null;
      project_id: number;
      submitted_by: number;
      org_id: number | null;
    }>();
  if (!row) return c.json({ error: 'File not found' }, 404);

  if (user.role === 'client') {
    // Өөрийн илгээсэн, эсвэл өөрийн байгууллагын төслийн материал.
    const allowed =
      row.submitted_by === user.sub || (await clientCanRead(c.env.DB, user.sub, row.project_id));
    if (!allowed) return c.json({ error: 'Access denied' }, 403);
  }

  return streamObject(c.env, row.r2_key, row.canonical_name, row.file_type);
});

/* ------------------------------------------------------------------ */
/*  Гаргасан зургийн багцын файл                                       */
/* ------------------------------------------------------------------ */

clientFiles.get('/deliverable/:fileId', async (c) => {
  const user = c.get('user');
  const fileId = Number(c.req.param('fileId'));
  if (!Number.isFinite(fileId)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT f.r2_key, f.file_name, f.file_type, d.id AS deliverable_id,
            d.project_id, d.status
       FROM deliverable_files f
       JOIN project_deliverables d ON d.id = f.deliverable_id
      WHERE f.id = ?`,
  )
    .bind(fileId)
    .first<{
      r2_key: string;
      file_name: string;
      file_type: string | null;
      deliverable_id: number;
      project_id: number;
      status: string;
    }>();
  if (!row) return c.json({ error: 'File not found' }, 404);

  if (user.role === 'client') {
    if (!(await clientCanRead(c.env.DB, user.sub, row.project_id))) {
      return c.json({ error: 'Access denied' }, 403);
    }
    // ХОЁР нөхцөл давхар: багц нь ГАРСАН байх ба НИЙТЛЭГДСЭН байх.  Ноорог
    // хувилбарыг захиалагч хэзээ ч харахгүй.
    if (row.status === 'draft') return c.json({ error: 'Access denied' }, 403);
    const pub = await c.env.DB.prepare(
      `SELECT id FROM client_publications
        WHERE project_id = ? AND kind = 'deliverable' AND ref_id = ?
          AND unpublished_at IS NULL`,
    )
      .bind(row.project_id, row.deliverable_id)
      .first<{ id: number }>();
    if (!pub) return c.json({ error: 'Access denied' }, 403);
  }

  return streamObject(c.env, row.r2_key, row.file_name, row.file_type);
});

export default clientFiles;
