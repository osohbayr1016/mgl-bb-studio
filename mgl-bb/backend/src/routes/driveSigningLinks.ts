/* =============================================================
 * «Баримт бичиг» (Drive) — гаднын гарын үсгийн link: АЖИЛТНЫ замууд (migration 0397).
 * -------------------------------------------------------------
 * `mountDriveSigning()`-ийн дотроос дуудагдана (эрх, файл ачаалах туслахуудыг хуваалцана),
 * тиймээс `/api/projects/:id/drive/…` ба `/api/main-projects/:id/drive/…` хоёуланд ижил:
 *
 *   GET    /:id/drive/files/:fileId/signing/links   энэ файлын link-үүд + бодит цагийн «хувилбар»
 *   POST   /:id/drive/files/:fileId/signing/links   нэг мөрөнд link үүсгэх (хуучин амьд link цуцлагдана)
 *   DELETE /:id/drive/signing/links/:linkId         link цуцлах (үүсгэсэн хүн | admin)
 *
 * GET нь Drive руу ОГТ дуудахгүй (цонх 3 сек тутам асууна): мөр нь зөвхөн ЭНЭ төслийн
 * хавтсанд (`root_folder_id`) үүссэн link-ийг буцаана — link үүсгэх үед файл тэр хавтсанд
 * байгааг ancestry-оор шалгасан тул өөр төслийн файлын link энд хэзээ ч гарахгүй.
 * Гаднын хүний (login-гүй) замууд нь `routes/drivePublicSigning.ts`.
 * ============================================================= */
import type { Context, Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import type { DriveEntry } from '../lib/google/driveBrowseCore';
import type { ProjectDriveRoot } from '../lib/projectDrive';
import { analyzeDocx, appendClientRowDocx } from '../lib/docxSignFile';
import { acquireLock, loadApprover, releaseLock, type SignUser } from '../lib/driveSigning';
import {
  SIGNING_STALE_MS,
  defaultRoleLabel,
  linkView,
  linkableSlot,
  signingVersion,
  type DriveLinkRow,
} from '../lib/drivePublicSigning';
import {
  cleanSigningText,
  expiresAtIso,
  newPublicSigningToken,
  normalizeExpiryDays,
  sha256Hex,
} from '../lib/publicSigning';
import type { DriveSignIo } from './driveSigning';

type AppEnv = { Bindings: Env; Variables: AppVariables };
type AppContext = Context<AppEnv>;

export type LinkAccess =
  | { ok: true; root: ProjectDriveRoot & { folder_id: string }; me: SignUser }
  | { ok: false; response: Response };

export type LinkLoaded =
  | { ok: true; entry: DriveEntry; parentId: string | null }
  | { ok: false; response: Response };

export interface DriveSigningLinkHelpers {
  label: 'project' | 'main';
  io: DriveSignIo;
  access: (c: AppContext) => Promise<LinkAccess>;
  loadFile: (c: AppContext, rootId: string) => Promise<LinkLoaded>;
  unsupportedOf: (entry: DriveEntry) => string | null;
}

const FILE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function publicUrl(frontendUrl: string, token: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/sign/${encodeURIComponent(token)}`;
}

/** «·» нь Word-ийн «Alt text»-ийн хуваагч — нэр, шошгонд орохгүй. */
function cleanLabel(raw: unknown, max: number): string | null {
  const v = cleanSigningText(raw, max);
  return v ? v.replace(/·/g, '-').trim() || null : null;
}

async function loadLinks(db: D1Database, fileId: string, rootId: string) {
  const rows = await db
    .prepare(
      `SELECT l.*, COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS requested_by_name
         FROM drive_doc_public_links l
         LEFT JOIN users u ON u.id = l.requested_by
        WHERE l.file_id = ? AND l.root_folder_id = ?
        ORDER BY l.id DESC LIMIT 30`,
    )
    .bind(fileId, rootId)
    .all<DriveLinkRow & { requested_by_name: string | null }>();
  const now = Date.now();
  return rows.results.map((r) => linkView(r, now));
}

export function mountDriveSigningLinks(app: Hono<AppEnv>, h: DriveSigningLinkHelpers): void {
  const noStore = (c: AppContext) => c.header('Cache-Control', 'private, no-store');

  type Added = { ok: true; entry: DriveEntry; slotKey: string } | { ok: false; response: Response };

  /**
   * «Захиалагч хүлээн авсан» мөрийг баримтад нэмж Drive-д ИЖИЛ файлын шинэ хувилбар болгоно
   * (`docxClientRow.ts`).  Захиалагчийн хоосон мөр аль хэдийн байвал тэрийг л буцаана (давхар
   * нэмэхгүй).  Файлын түгжээ — ажилтны гарын үсэгтэй ижил (`acquireLock`).
   */
  async function addClientRow(
    c: AppContext,
    a: Extract<LinkAccess, { ok: true }>,
    entry: DriveEntry,
    parentId: string,
    base: string | null,
  ): Promise<Added> {
    const db = c.env.DB;
    const fail = (status: 400 | 404 | 409, code: string, error: string): Added => ({ ok: false, response: c.json({ error, code }, status) });
    if (base && (entry.modifiedTime ?? '') !== base) return fail(409, 'STALE_FILE', 'Файл хооронд нь өөрчлөгдсөн байна — дахин ачаална уу');
    const token = await acquireLock(db, entry.id, a.me.id);
    if (!token) return fail(409, 'BUSY', 'Өөр хүн яг одоо энэ баримтад гарын үсэг зурж байна — түр хүлээгээд дахин оролдоно уу');
    let eventId: number | null = null;
    try {
      const fresh = await h.io.resolveFile(c.env, a.root.folder_id, entry.id);
      if (!fresh.ok) return { ok: false, response: c.json({ error: fresh.error, code: fresh.code }, fresh.status) };
      const bytes = await h.io.download(c.env, entry.id);
      const appended = await appendClientRowDocx(bytes);
      if (!appended.ok) {
        if (appended.reason === 'HAS_CLIENT_ROW') {
          const analyzed = await analyzeDocx(bytes);
          const existing = analyzed.ok ? analyzed.slots.find((s) => s.client && s.state === 'empty') : undefined;
          if (existing) return { ok: true, entry: fresh.entry, slotKey: existing.key };
          return fail(409, 'CLIENT_ROW_SIGNED', 'Баримтын захиалагчийн мөрөнд аль хэдийн гарын үсэг зурагдсан');
        }
        if (appended.reason === 'NO_TABLE') {
          return fail(409, 'NO_SIGNATURE_TABLE', 'Энэ баримтад гарын үсгийн хүснэгт (Албан тушаал / Нэр / Гарын үсэг багана) танигдсангүй — мөр нэмэх боломжгүй');
        }
        return fail(400, 'NOT_DOCX', 'Word баримт уншигдсангүй');
      }
      const analyzed = await analyzeDocx(appended.bytes);
      const clientSlot = analyzed.ok ? analyzed.slots.filter((s) => s.client && s.state === 'empty').pop() : undefined;
      if (!clientSlot) return fail(409, 'NO_SIGNATURE_TABLE', 'Захиалагчийн мөр нэмэгдсэнгүй');

      const ins = await db
        .prepare(
          `INSERT INTO drive_doc_sign_events
             (file_id, root_folder_id, scope, scope_id, file_name, action, user_id, slot_key, slot_role, base_modified_time, user_agent)
           VALUES (?, ?, ?, ?, ?, 'add_client_row', ?, ?, ?, ?, ?)`,
        )
        .bind(
          entry.id,
          a.root.folder_id,
          h.label,
          a.root.project_id,
          fresh.entry.name,
          a.me.id,
          clientSlot.key,
          clientSlot.role.slice(0, 200),
          fresh.entry.modifiedTime ?? null,
          (c.req.header('user-agent') ?? '').slice(0, 300) || null,
        )
        .run();
      eventId = Number(ins.meta.last_row_id);
      const newEntry = await h.io.upload(c.env, a.root.folder_id, fresh.entry, parentId, appended.bytes);
      await db
        .prepare('UPDATE drive_doc_sign_events SET result_modified_time = ?, result_md5 = ? WHERE id = ?')
        .bind(newEntry.modifiedTime ?? new Date().toISOString(), newEntry.md5Checksum ?? null, eventId)
        .run();
      c.executionCtx.waitUntil(
        h.io.record(c.env, a.root.folder_id, newEntry, a.me.id).catch((err: unknown) => {
          console.error(`[drive-signing-links] record file=${newEntry.id}`, err);
        }),
      );
      return { ok: true, entry: newEntry, slotKey: clientSlot.key };
    } catch (err) {
      if (eventId !== null) await db.prepare('DELETE FROM drive_doc_sign_events WHERE id = ?').bind(eventId).run().catch(() => {});
      return { ok: false, response: h.io.errorResponse(c, err, `signing-link-add-row ${h.label} file=${entry.id}`) };
    } finally {
      await releaseLock(db, entry.id, token).catch(() => {});
    }
  }

  app.get('/:id/drive/files/:fileId/signing/links', async (c) => {
    noStore(c);
    const a = await h.access(c);
    if (!a.ok) return a.response;
    const fileId = c.req.param('fileId') ?? '';
    if (!FILE_ID_RE.test(fileId)) return c.json({ error: 'Invalid file id', code: 'INVALID_ID' }, 400);
    const [links, version] = await Promise.all([
      loadLinks(c.env.DB, fileId, a.root.folder_id),
      signingVersion(c.env.DB, fileId, a.root.folder_id),
    ]);
    return c.json({ links, version });
  });

  app.post('/:id/drive/files/:fileId/signing/links', async (c) => {
    noStore(c);
    const a = await h.access(c);
    if (!a.ok) return a.response;
    // Эзний шийдвэр (2026-10-12): гаднын link-ийг ЗӨВХӨН admin үүсгэнэ / цуцална.
    if (a.me.role !== 'admin') return c.json({ error: 'Гарын үсгийн link-ийг зөвхөн admin үүсгэнэ', code: 'ADMIN_ONLY' }, 403);
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
    const wantsClientRow = body.add_client_row === true;
    let slotKey = typeof body.slot_key === 'string' ? body.slot_key : '';
    if (!slotKey && !wantsClientRow) return c.json({ error: 'slot_key шаардлагатай', code: 'BAD_REQUEST' }, 400);
    const f = await h.loadFile(c, a.root.folder_id);
    if (!f.ok) return f.response;
    if (h.unsupportedOf(f.entry)) {
      return c.json({ error: 'Энэ файлд гарын үсэг зурах боломжгүй', code: 'NOT_DOCX' }, 400);
    }
    if (!f.parentId) return c.json({ error: 'Энэ файлыг шинэчлэх боломжгүй', code: 'NOT_REVISABLE' }, 400);

    // Захиалагчийн мөргүй RFI — «Захиалагч хүлээн авсан» мөрийг баримтад нэмж (Drive-д шинэ
    // хувилбар), тэр мөрөнд link үүсгэнэ.
    let entry = f.entry;
    if (wantsClientRow) {
      const added = await addClientRow(c, a, f.entry, f.parentId, typeof body.base_modified_time === 'string' ? body.base_modified_time : null);
      if (!added.ok) return added.response;
      entry = added.entry;
      slotKey = added.slotKey;
    }

    let slot;
    try {
      const analyzed = await analyzeDocx(await h.io.download(c.env, entry.id));
      if (!analyzed.ok) return c.json({ error: 'Word баримт уншигдсангүй', code: 'NOT_DOCX' }, 400);
      slot = analyzed.slots.find((s) => s.key === slotKey);
    } catch (err) {
      return h.io.errorResponse(c, err, `signing-link ${h.label} file=${f.entry.id}`);
    }
    if (!slot) return c.json({ error: 'Гарын үсгийн мөр олдсонгүй — дахин ачаална уу', code: 'SLOT_NOT_FOUND' }, 404);
    if (slot.state !== 'empty') {
      return c.json({ error: 'Энэ мөрөнд гарын үсэг аль хэдийн байна', code: 'NOT_EMPTY' }, 409);
    }
    if (!linkableSlot(slot, await loadApprover(c.env.DB))) {
      return c.json({ error: 'Захирлын батлах мөрийг захирал ERP-д «Батлах»-аар зурна', code: 'APPROVER_ONLY' }, 409);
    }

    const rawToken = newPublicSigningToken();
    const hash = await sha256Hex(rawToken);
    const expiresAt = expiresAtIso(normalizeExpiryDays(body.expires_in_days));
    const roleLabel = cleanLabel(body.role_label, 120) ?? defaultRoleLabel(slot);
    const signerHint = cleanLabel(body.signer_name_hint, 160) ?? (slot.name.trim() || null);
    const staleIso = new Date(Date.now() - SIGNING_STALE_MS).toISOString();
    const db = c.env.DB;

    // Хуучин амьд link-ийг цуцлах + шинийг оруулах НЭГ batch: зэрэг хоёр хүсэлт ирсэн ч
    // (ux_ddpl_live_slot) нэг нь л үлдэнэ; оруулалт унавал хуучин link хэвээр.
    let insertedId: number;
    try {
      const results = await db.batch([
        db
          .prepare(
            `UPDATE drive_doc_public_links
                SET status = 'revoked', revoked_at = datetime('now'), revoked_by = ?, revoke_reason = 'replaced',
                    updated_at = datetime('now')
              WHERE file_id = ? AND slot_key = ?
                AND (status = 'pending' OR (status = 'signing' AND signing_started_at < ?))`,
          )
          .bind(a.me.id, entry.id, slot.key, staleIso),
        db
          .prepare(
            `INSERT INTO drive_doc_public_links
               (token_hash, file_id, root_folder_id, scope, scope_id, parent_id, file_name, slot_key, slot_group,
                slot_role, slot_position, slot_name, slot_client, role_label, signer_name_hint, status,
                requested_by, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          )
          .bind(
            hash,
            entry.id,
            a.root.folder_id,
            h.label,
            a.root.project_id,
            f.parentId,
            entry.name,
            slot.key,
            slot.group,
            slot.role.slice(0, 300),
            slot.position.slice(0, 200),
            slot.name.slice(0, 200),
            slot.client ? 1 : 0,
            roleLabel,
            signerHint,
            a.me.id,
            expiresAt,
          ),
      ]);
      insertedId = Number(results[1]!.meta.last_row_id);
    } catch (err) {
      if (/UNIQUE/i.test(err instanceof Error ? err.message : String(err))) {
        return c.json({ error: 'Энэ мөрөнд яг одоо гарын үсэг зурагдаж байна — түр хүлээнэ үү', code: 'BUSY' }, 409);
      }
      throw err;
    }

    const row = await db
      .prepare(
        `SELECT l.*, COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS requested_by_name
           FROM drive_doc_public_links l LEFT JOIN users u ON u.id = l.requested_by WHERE l.id = ?`,
      )
      .bind(insertedId)
      .first<DriveLinkRow & { requested_by_name: string | null }>();
    return c.json({ link: row ? linkView(row) : null, url: publicUrl(c.env.FRONTEND_URL, rawToken) }, 201);
  });

  /** Гарын үсэг зурагдсан агшны ЯГ .docx (нотолгоо, хувийн bucket) — DASR-ын «PDF нотолгоо»-той адил. */
  app.get('/:id/drive/signing/links/:linkId/signed-file', async (c) => {
    noStore(c);
    const a = await h.access(c);
    if (!a.ok) return a.response;
    const linkId = Number(c.req.param('linkId'));
    if (!Number.isInteger(linkId) || linkId <= 0) return c.json({ error: 'Invalid id', code: 'BAD_REQUEST' }, 400);
    const row = await c.env.DB.prepare('SELECT * FROM drive_doc_public_links WHERE id = ? AND root_folder_id = ?')
      .bind(linkId, a.root.folder_id)
      .first<DriveLinkRow>();
    if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    if (row.status !== 'signed' || !row.document_snapshot_key) {
      return c.json({ error: 'Гарын үсэгтэй файлын хуулбар алга', code: 'NO_SNAPSHOT' }, 404);
    }
    const obj = await c.env.MEETING_BUCKET.get(row.document_snapshot_key);
    if (!obj) return c.json({ error: 'Файл олдсонгүй', code: 'NO_SNAPSHOT' }, 404);
    const name = row.file_name || 'signed.docx';
    const ascii = name.replace(/[^ -~]/g, '_').replace(/["\\]/g, '_');
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Document-SHA256': row.document_sha256 ?? '',
      },
    });
  });

  app.delete('/:id/drive/signing/links/:linkId', async (c) => {
    noStore(c);
    const a = await h.access(c);
    if (!a.ok) return a.response;
    if (a.me.role !== 'admin') return c.json({ error: 'Гарын үсгийн link-ийг зөвхөн admin цуцална', code: 'ADMIN_ONLY' }, 403);
    const linkId = Number(c.req.param('linkId'));
    if (!Number.isInteger(linkId) || linkId <= 0) return c.json({ error: 'Invalid id', code: 'BAD_REQUEST' }, 400);
    const db = c.env.DB;
    const row = await db
      .prepare('SELECT * FROM drive_doc_public_links WHERE id = ? AND root_folder_id = ?')
      .bind(linkId, a.root.folder_id)
      .first<DriveLinkRow>();
    if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    if (row.requested_by !== a.me.id && a.me.role !== 'admin') {
      return c.json({ error: 'Зөвхөн link үүсгэсэн хүн цуцална', code: 'FORBIDDEN' }, 403);
    }
    const view = linkView(row);
    if (view.status === 'signing') {
      return c.json({ error: 'Яг одоо гарын үсэг зурагдаж байна — түр хүлээнэ үү', code: 'BUSY' }, 409);
    }
    if (view.status !== 'pending') {
      return c.json({ error: 'Зөвхөн хүлээгдэж буй link-ийг цуцална', code: 'NOT_PENDING' }, 409);
    }
    const r = await db
      .prepare(
        `UPDATE drive_doc_public_links
            SET status = 'revoked', revoked_at = datetime('now'), revoked_by = ?, revoke_reason = 'staff',
                signing_started_at = NULL, updated_at = datetime('now')
          WHERE id = ? AND (status = 'pending' OR (status = 'signing' AND signing_started_at < ?))`,
      )
      .bind(a.me.id, linkId, new Date(Date.now() - SIGNING_STALE_MS).toISOString())
      .run();
    if (!r.meta.changes) return c.json({ error: 'Link-ийн төлөв өөрчлөгдсөн — дахин ачаална уу', code: 'NOT_PENDING' }, 409);
    return c.json({ ok: true, links: await loadLinks(db, row.file_id, a.root.folder_id) });
  });
}
