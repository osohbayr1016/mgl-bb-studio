/**
 * RFI/CR захиалагчийн гарын үсэг — `/api/correspondence`-ийн дэд замууд.
 * `correspondence.ts` нь `registerCorrespondenceSignatureRoutes(router, canRead, canWrite)`
 * гэж холбоно (send замуудтай ижил загвар).
 *
 *   GET    /:id                    — нэг мөр + төслийн нэр + гарын үсгийн зураг (print хуудас ч үүнийг уншина)
 *   POST   /:id/signature-request  — ажилтан: захиалагчид гарын үсэг зуруулахаар илгээх (none → pending)
 *   DELETE /:id/signature-request  — ажилтан: хүлээгдэж буй хүсэлтийг цуцлах (pending → none)
 *   POST   /:id/sign               — ЗАХИАЛАГЧ: зурсан гарын үсгээ баталгаажуулах (pending → signed)
 *   GET    /:id/client-signature   — захиалагчийн гарын үсгийн PNG (хувийн bucket-аас, эрх шалгаад)
 *   GET    /:id/pdf                — RFI/CR PDF (кэш, хуучирсан бол дахин рендер)
 *
 * Дүрэм бүр `lib/correspondenceSignature.ts`-д (цэвэр, тесттэй); энд зөвхөн
 * D1/R2/мэдэгдэл.  ⚠️ `GET /:id` нь `/aliases`-ийн ДАРАА бүртгэгдэх ёстой
 * (Hono бүртгэлийн дарааллаар таардаг) — correspondence.ts-д send замуудын
 * дараа дуудагддаг нь санаатай.
 */
import type { Context, Hono } from 'hono';
import type { Env, AppVariables, UserRole } from '../types';
import { clientCanRead } from '../lib/clientAccess';
import { emitClientEvent, notifyProjectClients } from '../lib/clientEvents';
import { createNotification } from '../lib/notify';
import { sha256Hex } from '../lib/publicSigning';
import { streamPrivateObject } from '../lib/privateFileStream';
import {
  refreshCorrespondencePdf,
  renderCorrespondencePdf,
  storeCorrespondencePdf,
} from '../lib/correspondencePdf';
import {
  canCancelSignatureRequest,
  canRequestSignature,
  canSign,
  clientSignatureKey,
  correspondencePdfFileName,
  DOC_TYPE_TITLE_MN,
  isSignableDocType,
  parseSignatureDataUrl,
  pdfIsCurrent,
} from '../lib/correspondenceSignature';

type Ctx = { Bindings: Env; Variables: AppVariables };
type Gate = (
  db: D1Database,
  projectId: number,
  viewer: { sub: number; role: string },
) => Promise<boolean>;

export interface SignatureEntryRow {
  id: number;
  project_id: number;
  author_id: number;
  log_date: string;
  subject: string;
  doc_type: string | null;
  ref_no: string | null;
  signature_url: string | null;
  sign_status: string;
  sign_requested_at: string | null;
  sign_requested_by: number | null;
  client_signature_key: string | null;
  client_signed_at: string | null;
  client_signed_by: number | null;
  client_signer_name: string | null;
  pdf_key: string | null;
  pdf_generated_at: string | null;
  updated_at: string;
}

const ENTRY_SQL = `
  SELECT cl.*, u.full_name AS author_name, p.name AS project_name
    FROM correspondence_log cl
    LEFT JOIN users u ON u.id = cl.author_id
    LEFT JOIN projects p ON p.id = cl.project_id
   WHERE cl.id = ?`;

async function loadEntry(db: D1Database, id: number) {
  return db
    .prepare(ENTRY_SQL)
    .bind(id)
    .first<SignatureEntryRow & { author_name: string | null; project_name: string | null }>();
}

function docLabel(entry: { doc_type: string | null; ref_no: string | null; subject: string }) {
  const kind = isSignableDocType(entry.doc_type) ? DOC_TYPE_TITLE_MN[entry.doc_type] : 'Бичиг';
  return `${kind} ${entry.ref_no ?? ''}`.trim() + ` — ${entry.subject}`;
}

/** Хуучин PDF-ийг DB-ээс салгаж, объектыг арын дэвсгэрт устгана. */
async function dropPdf(c: Context<Ctx>, entry: { id: number; pdf_key: string | null }) {
  await c.env.DB.prepare(
    'UPDATE correspondence_log SET pdf_key = NULL, pdf_generated_at = NULL WHERE id = ?',
  )
    .bind(entry.id)
    .run();
  if (entry.pdf_key) {
    const key = entry.pdf_key;
    c.executionCtx.waitUntil(c.env.MEETING_BUCKET.delete(key).catch(() => undefined));
  }
}

/** Арын дэвсгэрт PDF-ийг урьдчилан рендерлэнэ (кэш л — унавал GET дахин хийнэ). */
function prerenderPdf(c: Context<Ctx>, id: number, actor: { sub: number; role: UserRole }) {
  c.executionCtx.waitUntil(
    (async () => {
      const fresh = await c.env.DB.prepare(
        'SELECT id, updated_at, pdf_key FROM correspondence_log WHERE id = ?',
      )
        .bind(id)
        .first<{ id: number; updated_at: string; pdf_key: string | null }>();
      if (!fresh) return;
      await refreshCorrespondencePdf(c.env, fresh, actor);
    })().catch((err) => console.error('[correspondence-pdf] prerender failed', err)),
  );
}

/**
 * Хүсэлтийн бичилт + мэдэгдэл — `POST /:id/signature-request` ба Gmail send
 * (`request_signature: true`) хоёулаа энэ нэг функцийг дуудна.
 */
export async function requestClientSignature(
  c: Context<Ctx>,
  entry: SignatureEntryRow & { project_name?: string | null },
  actor: { sub: number; role: UserRole },
): Promise<{ ok: true } | { ok: false; status: 400 | 409; error: string }> {
  const gate = canRequestSignature(entry);
  if (!gate.ok) return gate;

  await c.env.DB.prepare(
    `UPDATE correspondence_log
        SET sign_status = 'pending', sign_requested_at = datetime('now'), sign_requested_by = ?,
            updated_at = datetime('now')
      WHERE id = ? AND sign_status = 'none'`,
  )
    .bind(actor.sub, entry.id)
    .run();
  await dropPdf(c, entry);
  prerenderPdf(c, entry.id, actor);

  const label = docLabel(entry);
  await emitClientEvent(c.env, entry.project_id, 'signature', `Гарын үсэг хүсэв: ${label}`, entry.id, actor.sub);
  await notifyProjectClients(
    c.env,
    entry.project_id,
    'client_signature_requested',
    'Гарын үсэг зурах хүсэлт',
    label,
    '/client',
  );
  return { ok: true };
}

export function registerCorrespondenceSignatureRoutes(
  router: Hono<Ctx>,
  canRead: Gate,
  canWrite: Gate,
): void {
  /* ---------- нэг мөр ---------- */
  router.get('/:id', async (c) => {
    const viewer = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const entry = await loadEntry(c.env.DB, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    if (!(await canRead(c.env.DB, entry.project_id, viewer))) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Захиалагчийн гарын үсэг — print хуудас `<img>`-д шууд тавихад data URL
    // хамгийн энгийн (нэг дуудлага, Authorization толгой хэрэггүй).  Зураг
    // тайрсан PNG тул хэдэн арван KB.
    let clientSignatureDataUrl: string | null = null;
    if (entry.client_signature_key) {
      const obj = await c.env.MEETING_BUCKET.get(entry.client_signature_key);
      if (obj) {
        const bytes = new Uint8Array(await obj.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
        clientSignatureDataUrl = `data:image/png;base64,${btoa(bin)}`;
      }
    }

    const { client_signature_key: _k, pdf_key: _p, ...pub } = entry;
    void _k;
    void _p;
    return c.json({
      entry: pub,
      client_signature_data_url: clientSignatureDataUrl,
      can_sign:
        viewer.role === 'client' &&
        entry.sign_status === 'pending' &&
        isSignableDocType(entry.doc_type),
      can_write: await canWrite(c.env.DB, entry.project_id, viewer),
    });
  });

  /* ---------- ажилтан: хүсэлт ---------- */
  router.post('/:id/signature-request', async (c) => {
    const viewer = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const entry = await loadEntry(c.env.DB, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    if (!(await canWrite(c.env.DB, entry.project_id, viewer))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const r = await requestClientSignature(c, entry, viewer);
    if (!r.ok) return c.json({ error: r.error }, r.status);
    return c.json({ entry: await loadEntry(c.env.DB, id) });
  });

  router.delete('/:id/signature-request', async (c) => {
    const viewer = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const entry = await loadEntry(c.env.DB, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    if (!(await canWrite(c.env.DB, entry.project_id, viewer))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const gate = canCancelSignatureRequest(entry);
    if (!gate.ok) return c.json({ error: gate.error }, gate.status);
    // 0381: энэ RFI/CR-д public bearer link үүссэн бол хуучин cancel товч
    // бас түүнийг цуцална (НЭГ batch — UI «цуцлагдсан» боловч гаднын link
    // гарын үсэг авах боломжтой хэвээр үлдэх аюултай).
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE correspondence_log
            SET sign_status = 'none', sign_requested_at = NULL, sign_requested_by = NULL,
                updated_at = datetime('now')
          WHERE id = ? AND sign_status = 'pending'`,
      ).bind(id),
      c.env.DB.prepare(
        `UPDATE public_document_sign_requests
            SET status = 'revoked', revoked_at = datetime('now'), updated_at = datetime('now')
          WHERE kind = 'correspondence' AND entity_id = ? AND slot = 'client'
            AND status = 'pending'`,
      ).bind(id),
    ]);
    await dropPdf(c, entry);
    await emitClientEvent(
      c.env,
      entry.project_id,
      'signature',
      `Гарын үсгийн хүсэлт цуцлагдав: ${docLabel(entry)}`,
      entry.id,
      viewer.sub,
    );
    return c.json({ entry: await loadEntry(c.env.DB, id) });
  });

  /* ---------- ЗАХИАЛАГЧ: зурах ---------- */
  router.post('/:id/sign', async (c) => {
    const viewer = c.get('user');
    // ⚠️ Зөвхөн захиалагч — ажилтан захиалагчийн өмнөөс зурж болохгүй
    //    (тэр нь баримтын нотолгооны утгыг алдагдуулна).
    if (viewer.role !== 'client') {
      return c.json({ error: 'Зөвхөн захиалагч гарын үсэг зурна' }, 403);
    }
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const entry = await loadEntry(c.env.DB, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    if (!(await clientCanRead(c.env.DB, viewer.sub, entry.project_id))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const gate = canSign(entry);
    if (!gate.ok) return c.json({ error: gate.error }, gate.status);

    const body = await c.req
      .json<{ signature_data_url?: unknown }>()
      .catch(() => ({}) as { signature_data_url?: unknown });
    const parsed = parseSignatureDataUrl(body.signature_data_url);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const signer = await c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?')
      .bind(viewer.sub)
      .first<{ full_name: string | null }>();
    const signerName = signer?.full_name?.trim() || `Захиалагч #${viewer.sub}`;

    const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const key = clientSignatureKey(id, Date.now(), rand);
    await c.env.MEETING_BUCKET.put(key, parsed.bytes, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { correspondenceId: String(id), signedBy: String(viewer.sub) },
    });

    // Уралдааны хамгаалалт: `sign_status = 'pending'` нөхцөлтэй — хоёр
    // холбоо барих хүн зэрэг дарвал зөвхөн эхнийх нь бичигдэнэ.
    const signedAt = new Date().toISOString();
    const signatureHash = await sha256Hex(parsed.bytes);
    // НЭГ batch: баримтыг зурагдсан болгох + энэ slot-ыг хүлээж байсан public
    // link-ийг хаах.  Хоёр дахь statement нь «баримт яг миний гарын үсгийг авсан»
    // үед л ажиллана тул public link-ээр түрүүлж зурсан бол энд юу ч өөрчлөгдөхгүй.
    let results: D1Result[];
    try {
      results = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE correspondence_log
              SET sign_status = 'signed', client_signature_key = ?, client_signed_at = ?,
                  client_signed_by = ?, client_signer_name = ?, updated_at = datetime('now')
            WHERE id = ? AND sign_status = 'pending'`,
        ).bind(key, signedAt, viewer.sub, signerName, id),
        c.env.DB.prepare(
          `UPDATE public_document_sign_requests
              SET status = 'signed', signed_name = COALESCE(signed_name, ?),
                  signature_key = COALESCE(signature_key, ?),
                  signature_sha256 = COALESCE(signature_sha256, ?),
                  signed_at = COALESCE(signed_at, ?), updated_at = datetime('now')
            WHERE kind = 'correspondence' AND entity_id = ? AND slot = 'client'
              AND status = 'pending'
              AND EXISTS (SELECT 1 FROM correspondence_log WHERE id = ? AND client_signature_key = ?)`,
        ).bind(signerName, key, signatureHash, signedAt, id, id, key),
      ]);
    } catch (err) {
      await c.env.MEETING_BUCKET.delete(key).catch(() => undefined);
      throw err;
    }
    if (!results[0]!.meta.changes) {
      await c.env.MEETING_BUCKET.delete(key).catch(() => undefined);
      return c.json({ error: 'Аль хэдийн гарын үсэг зурсан' }, 409);
    }

    await dropPdf(c, entry);
    prerenderPdf(c, id, viewer);

    const label = docLabel(entry);
    await emitClientEvent(c.env, entry.project_id, 'signature', `Гарын үсэг зурав: ${label}`, id, viewer.sub);
    // Ажилтан руу: хүсэлт тавьсан хүн + зохиогч (давхардвал нэг л удаа).
    const staffIds = new Set<number>();
    if (entry.sign_requested_by) staffIds.add(entry.sign_requested_by);
    staffIds.add(entry.author_id);
    for (const uid of staffIds) {
      await createNotification(
        c.env.DB,
        uid,
        'client_signed',
        'Захиалагч гарын үсэг зурлаа',
        `${signerName} · ${label}`,
        `/app/projects/${entry.project_id}?tab=mail`,
      );
    }

    return c.json({ entry: await loadEntry(c.env.DB, id) });
  });

  /* ---------- захиалагчийн гарын үсгийн зураг ---------- */
  router.get('/:id/client-signature', async (c) => {
    const viewer = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const entry = await loadEntry(c.env.DB, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    if (!(await canRead(c.env.DB, entry.project_id, viewer))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (!entry.client_signature_key) return c.json({ error: 'Not found' }, 404);
    return streamPrivateObject(c.env, entry.client_signature_key, 'signature.png', 'image/png', {
      inline: true,
    });
  });

  /* ---------- PDF ---------- */
  router.get('/:id/pdf', async (c) => {
    const viewer = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const entry = await loadEntry(c.env.DB, id);
    if (!entry) return c.json({ error: 'Not found' }, 404);
    if (!(await canRead(c.env.DB, entry.project_id, viewer))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (!isSignableDocType(entry.doc_type)) {
      return c.json({ error: 'Зөвхөн RFI / CR бичигт PDF үүсгэнэ' }, 400);
    }
    const fileName = correspondencePdfFileName(entry);

    if (pdfIsCurrent(entry)) {
      const cached = await c.env.MEETING_BUCKET.get(entry.pdf_key!);
      if (cached) {
        return streamPrivateObject(c.env, entry.pdf_key!, fileName, 'application/pdf');
      }
    }

    let bytes: Uint8Array;
    try {
      bytes = await renderCorrespondencePdf(c.env, id, viewer);
    } catch (err) {
      console.error('[correspondence-pdf] render failed', err);
      return c.json(
        { error: 'PDF үүсгэхэд алдаа гарлаа', detail: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
    // Кэшид хадгалах нь хариултыг СААТУУЛАХГҮЙ — арын дэвсгэрт, ДАХИН рендерлэхгүй.
    const snapshot = { id: entry.id, updated_at: entry.updated_at, pdf_key: entry.pdf_key };
    c.executionCtx.waitUntil(
      storeCorrespondencePdf(c.env, snapshot, bytes, viewer).catch((err) =>
        console.error('[correspondence-pdf] cache store failed', err),
      ),
    );
    const ascii = fileName.replace(/[^ -~]/g, '_');
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
