/* =============================================================
 * «Баримт бичиг» (Drive) Word баримт — ГАДНЫН хүн login-гүй гарын үсэг зурах (0397)
 * -------------------------------------------------------------
 * Эзний хүсэлт (2026-10-12): захиалагч руу НЭГ link явуулна → утас/компьютер дээр нээмэгц
 * гарын үсгийн хэсэг → зурмагц манай «Баримт бичиг»-ийн Drive дахь ЯГ тэр файлд гарын
 * үсэг суугаад шинэ хувилбар болно.  Ажилтны цонх (`DriveSigningPanel`) link-ийн төлвийг
 * 3 сек тутам асууж, зурсан даруй баримтыг дахин ачаална.
 *
 *   GET  /public/signing/:token            link + баримтын товч мэдээлэл (Drive руу дуудахгүй)
 *   GET  /public/signing/:token/document   Drive-ын ОДООГИЙН .docx байт (хөтөч өөрөө render);
 *                                          зурсны дараа 7 хоног — зурсан хувилбарын PDF (`?download=1` = татах).
 *                                          Зурсан хүнд .docx ХЭЗЭЭ Ч очихгүй (эзэн 2026-10-12: засварлах
 *                                          боломжгүй, зөвхөн PDF).  PDF-ийг Browser Rendering `/sign/:token/print`
 *                                          хуудаснаас үүсгэж хувийн bucket-д кэшлэнэ; тэр хуудас снапшотыг
 *                                          `?source=1&r=<рендерлэгчийн түр эрх>`-ээр л авна.
 *   POST /public/signing/:token/presence   «яг одоо нээлттэй» (ажилтны цонхонд харагдана)
 *   POST /public/signing/:token/sign       гарын үсэг → Word файлд суулгах → Drive шинэ хувилбар
 *
 * Токены нэрийн орон зай 0381-тэй (RFI/CR, ЗХ) НЭГ — `index.ts` энэ router-ийг 0381-ийнхээс
 * ӨМНӨ mount хийнэ; токен энэ хүснэгтэд байхгүй бол `next()` → 0381-ийн handler.
 *
 * Гарын үсэг суулгах цөм нь ажилтны урсгалтай НЭГ (`docxSignFile.stampDocx`, мөрийн
 * түгжээ `acquireLock`, ИЖИЛ файлын шинэ хувилбар `io.upload`, ledger `io.record`) —
 * хоёр дахь хэрэгжүүлэлт БИШ.  Drive-ын сүлжээ `DriveSignIo`-гоор (тест хуурамч IO өгнө).
 *
 * АЮУЛГҮЙ БАЙДАЛ:
 *   • токен = НЭГ файлын НЭГ мөр; SHA-256-аар л хадгалагдана; хугацаатай; зурмагц хаагдана.
 *   • link үүсгэсэн ажилтан идэвхгүй болох / эрхээ алдах, төслийн хавтас солигдох, файл
 *     хавтаснаас гарах → link бүрмөсөн хаагдана (revoked).
 *   • Drive-ын түүхий алдааны бичвэр гаднын хүнд ХЭЗЭЭ Ч гарахгүй (логт л).
 *   • захирлын (батлах) мөрөнд link үүсэхгүй; мөр хооронд нь бөглөгдсөн бол дарж зурахгүй.
 * ============================================================= */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import type { ProjectDriveRoot } from '../lib/projectDrive';
import { imageInfo } from '../lib/docxSign';
import { SIGN_MAX_BYTES, analyzeDocx, stampDocx } from '../lib/docxSignFile';
import { prepareSignaturePng } from '../lib/pngCrop';
import { parseSignatureDataUrl } from '../lib/correspondenceSignature';
import {
  SIGNING_ROLES,
  acquireLock,
  documentLink,
  fullDisplayName,
  isSignableDocx,
  loadApprover,
  loadEvents,
  loadLatestRequest,
  loadUser,
  refreshClientSummary,
  releaseLock,
} from '../lib/driveSigning';
import {
  PRESENCE_WRITE_EVERY_MS,
  SIGNED_PREVIEW_MS,
  cleanPosition,
  documentTitleOf,
  documentTypeOf,
  externalDescr,
  linkByTokenHash,
  linkableSlot,
  matchLinkSlot,
  pdfFileName,
  renderGrant,
  revokeLink,
  settleStatus,
  signedPdfKey,
  timeMs,
  verifyRenderGrant,
  type DriveLinkRow,
} from '../lib/drivePublicSigning';
import { cleanSigningText, sha256Hex } from '../lib/publicSigning';
import { createNotification } from '../lib/notify';
import { orgConfig } from '../lib/orgConfig';
import { todayInUB } from '../lib/time';
import type { DriveSignIo } from './driveSigning';

type PublicEnv = { Bindings: Env };
type PublicContext = Context<PublicEnv>;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
/** 512 KB PNG → ~700 KB base64 + бусад талбар. */
const MAX_SIGN_BODY_BYTES = 900 * 1024;

export interface DrivePublicSigningDeps {
  io: DriveSignIo;
  resolveRoot: (db: D1Database, scope: 'project' | 'main', id: number) => Promise<ProjectDriveRoot | null>;
  /**
   * Хуудсыг PDF болгоно (Browser Rendering).  `index.ts` бодит хэрэгжүүлэлтийг өгнө — энэ файл
   * puppeteer-ийг шууд импортлохгүй (`node --test` ачаалж чадахгүй).  Хуудас `data-print-ready`
   * болоогүй эсвэл `data-print-error` тавьсан бол АЛДАА шиднэ — хоосон PDF кэшлэгдэхгүй.
   */
  renderPdf?: (env: Env, url: string) => Promise<Uint8Array>;
}

function isPdfBytes(bytes: Uint8Array): boolean {
  // «%PDF-»
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

function noStore(c: PublicContext) {
  c.header('Cache-Control', 'no-store, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
  // Токен URL-д байгаа — Referer-ээр гоожихгүй.
  c.header('Referrer-Policy', 'no-referrer');
}

function tokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,60}$/.test(token);
}

/** Drive-ын алдааг гаднын хүнд ерөнхий мессеж болгоно (түүхий бичвэр логт л). */
function driveFailure(c: PublicContext, err: unknown, where: string) {
  console.error(`[drive-public-signing] ${where}`, err);
  return c.json({ error: 'Баримтыг Google Drive-аас уншиж чадсангүй. Түр хүлээгээд дахин оролдоно уу.' }, 502);
}

function companyBlock() {
  const org = orgConfig();
  return {
    name: org.name,
    legal_name: org.legalNameMn,
    tagline: org.taglineMn,
    website: org.websiteUrl,
    contact_email: org.contactEmail,
  };
}

function ymdOf(s: string): string {
  const ms = timeMs(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : s.slice(0, 10);
}

export function createDrivePublicSigning(deps: DrivePublicSigningDeps) {
  const { io } = deps;
  const app = new Hono<PublicEnv>();

  async function findLink(c: PublicContext): Promise<DriveLinkRow | null> {
    const token = c.req.param('token') ?? '';
    if (!tokenShape(token)) return null;
    return linkByTokenHash(c.env.DB, await sha256Hex(token));
  }

  type Valid =
    | { ok: true; root: ProjectDriveRoot & { folder_id: string }; requesterName: string; requesterPosition: string | null }
    | { ok: false };

  /**
   * Link-ийн эрх хүчинтэй хэвээр эсэх: илгээсэн ажилтан идэвхтэй + «Баримт бичиг»-ийн роль,
   * төсөл ба түүний Drive хавтас ИЖИЛ.  Үгүй бол link-ийг бүрмөсөн хаана (`revoked`).
   */
  async function stillValid(c: PublicContext, link: DriveLinkRow): Promise<Valid> {
    const db = c.env.DB;
    const who = await loadUser(db, link.requested_by);
    let reason: string | null = null;
    if (!who || who.status !== 'active' || !SIGNING_ROLES.has(who.role)) reason = 'requester';
    let root: ProjectDriveRoot | null = null;
    if (!reason) {
      root = await deps.resolveRoot(db, link.scope === 'main' ? 'main' : 'project', link.scope_id);
      if (!root || root.folder_id !== link.root_folder_id) reason = 'folder';
    }
    if (reason || !root || !who) {
      await revokeLink(db, link.id, null, reason ?? 'invalid');
      return { ok: false };
    }
    return {
      ok: true,
      root: root as ProjectDriveRoot & { folder_id: string },
      requesterName: fullDisplayName(who),
      requesterPosition: who.position,
    };
  }

  /** Төлөвийн хариуны `request` хэсэг (0381-ийн хэлбэртэй ижил — нэг нүүр хуудас). */
  function requestBlock(link: DriveLinkRow) {
    const signed = link.status === 'signed';
    return {
      // `signing` нь гаднын хүнд «хүлээгдэж буй» — зурах товч дарвал серверийн хариу шийднэ.
      status: link.status === 'signing' ? 'pending' : link.status,
      role_label: link.role_label,
      signer_name_hint: link.status === 'pending' || link.status === 'signing' ? link.signer_name_hint : null,
      expires_at: link.expires_at,
      signed_name: signed ? link.signed_name : null,
      signed_at: signed ? link.signed_at : null,
    };
  }

  function signedPreviewAvailable(link: DriveLinkRow): boolean {
    if (link.status !== 'signed' || !link.document_snapshot_key) return false;
    const at = timeMs(link.signed_at);
    return Number.isFinite(at) && Date.now() - at < SIGNED_PREVIEW_MS;
  }

  /* ---------------------------------------------------------------- */
  /*  GET /:token — мэдээлэл                                            */
  /* ---------------------------------------------------------------- */

  app.get('/:token', async (c, next) => {
    const found = await findLink(c);
    if (!found) return next();
    noStore(c);
    const link = await settleStatus(c.env.DB, found);

    if (link.status === 'revoked' || link.status === 'expired') {
      return c.json({ request: requestBlock(link), company: companyBlock(), document: null });
    }

    const valid = link.status === 'signed' ? null : await stillValid(c, link);
    if (valid && !valid.ok) return c.json({ error: 'Энэ link-ийн эрх хүчингүй болсон' }, 410);

    if (link.status === 'pending' && !link.first_viewed_at) {
      await c.env.DB.prepare(
        `UPDATE drive_doc_public_links
            SET first_viewed_at = COALESCE(first_viewed_at, datetime('now')), last_viewed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?`,
      )
        .bind(link.id)
        .run();
    }

    const projectName = valid?.ok ? valid.root.project_name : null;
    return c.json({
      request: requestBlock(link),
      company: companyBlock(),
      document: {
        format: 'docx' as const,
        project_name: projectName ?? (await projectNameOf(c.env.DB, link)),
        document_type: documentTypeOf(link.file_name),
        document_no: null,
        title: documentTitleOf(link.file_name),
        document_date: ymdOf(link.created_at),
        prepared_by: valid?.ok ? valid.requesterName : null,
        prepared_by_position: valid?.ok ? valid.requesterPosition : null,
        file_name: link.file_name,
        slot: {
          role: link.slot_role,
          position: link.slot_position,
          name: link.slot_name,
          client: link.slot_client === 1,
        },
        // Мөрийн албан тушаалын нүд хоосон бол зурагч өөрөө бичиж болно.
        ask_position: link.slot_position.trim() === '',
        signed_preview: signedPreviewAvailable(link),
        // Зурсны дараах баримт = PDF (засварлах .docx биш) — клиент энэ тугаар viewer сонгоно.
        signed_format: 'pdf' as const,
      },
    });
  });

  async function projectNameOf(db: D1Database, link: DriveLinkRow): Promise<string> {
    const root = await deps.resolveRoot(db, link.scope === 'main' ? 'main' : 'project', link.scope_id).catch(() => null);
    return root?.project_name ?? 'Төсөл';
  }

  /**
   * Гарын үсэгтэй баримтын PDF: кэш (хувийн bucket) → байхгүй бол `/sign/:token/print` хуудсыг
   * Browser Rendering-ээр PDF болгож хадгална.  Снапшот зурагдсаны дараа хэзээ ч өөрчлөгдөхгүй
   * тул нэг удаа рендерлэхэд хангалттай.  Амжилтгүй бол null (кэшлэхгүй — дараагийн хүсэлт дахин оролдоно).
   */
  async function signedPdf(c: PublicContext, link: DriveLinkRow): Promise<ReadableStream | Uint8Array | null> {
    const key = signedPdfKey(link.id);
    const cached = await c.env.MEETING_BUCKET.get(key);
    if (cached) return cached.body;
    if (!deps.renderPdf) {
      console.error('[drive-public-signing] renderPdf not configured');
      return null;
    }
    const token = c.req.param('token') ?? '';
    const grant = await renderGrant(c.env.JWT_SECRET, link.id);
    const url =
      `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/sign/${encodeURIComponent(token)}/print` +
      `?r=${encodeURIComponent(grant)}`;
    try {
      const bytes = await deps.renderPdf(c.env, url);
      if (!isPdfBytes(bytes)) throw new Error(`not a pdf (${bytes.length} bytes)`);
      await c.env.MEETING_BUCKET.put(key, bytes, { httpMetadata: { contentType: PDF_MIME } });
      return bytes;
    } catch (err) {
      console.error(`[drive-public-signing] pdf render link=${link.id}`, err);
      return null;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  GET /:token/document — .docx байт (зурахаас өмнө) / PDF (зурсны дараа) */
  /* ---------------------------------------------------------------- */

  app.get('/:token/document', async (c, next) => {
    const found = await findLink(c);
    if (!found) return next();
    noStore(c);
    const link = await settleStatus(c.env.DB, found);
    // `?download=1` — гарын үсгээ зурсан хүн файлаа татна («Татах» товч).
    const disposition = c.req.query('download') === '1' ? 'attachment' : 'inline';
    const headers = (fileName: string, mime: string, extra: Record<string, string> = {}): Record<string, string> => {
      const ascii = fileName.replace(/[^ -~]/g, '_').replace(/["\\]/g, '_');
      return {
        'Content-Type': mime,
        'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...extra,
      };
    };

    // Зурсан хүн гарын үсэгтэй баримтаа 7 хоног ЗӨВХӨН PDF-ээр харж, татна — зурсан агшны ЯГ хуулбар
    // (снапшот), Drive-ын амьд файл биш (дараа нь засагдсан агуулгыг bearer токеноор задруулахгүй).
    if (link.status === 'signed') {
      if (!signedPreviewAvailable(link) || !link.document_snapshot_key) {
        return c.json({ error: 'Link хүчингүй болсон' }, 410);
      }
      // PDF рендерлэгчийн эх (.docx) — зөвхөн серверийн гаргасан түр эрхтэй.  Токен ганцаараа хангалтгүй:
      // захиалагчийн хөтөч засварлах боломжтой файл авах ёсгүй.
      if (c.req.query('source') === '1') {
        if (!(await verifyRenderGrant(c.env.JWT_SECRET, link.id, c.req.query('r')))) {
          return c.json({ error: 'Эрхгүй' }, 403);
        }
        const obj = await c.env.MEETING_BUCKET.get(link.document_snapshot_key);
        if (!obj) return c.json({ error: 'Баримт олдсонгүй' }, 410);
        return new Response(obj.body, {
          status: 200,
          headers: headers(link.file_name, DOCX_MIME, { 'X-Document-State': 'signed-source' }),
        });
      }
      if (!(await c.env.MEETING_BUCKET.head(link.document_snapshot_key))) {
        return c.json({ error: 'Баримт олдсонгүй' }, 410);
      }
      const pdf = await signedPdf(c, link);
      if (!pdf) {
        return c.json({ error: 'Гарын үсэгтэй баримтыг PDF болгож чадсангүй. Түр хүлээгээд дахин оролдоно уу.' }, 502);
      }
      return new Response(pdf, {
        status: 200,
        headers: headers(pdfFileName(link.file_name), PDF_MIME, { 'X-Document-State': 'signed' }),
      });
    }
    if (link.status !== 'pending' && link.status !== 'signing') {
      return c.json({ error: 'Link хүчингүй болсон' }, 410);
    }

    const valid = await stillValid(c, link);
    if (!valid.ok) return c.json({ error: 'Баримтыг нээх эрх хүчингүй болсон' }, 410);
    try {
      const r = await io.resolveFile(c.env, valid.root.folder_id, link.file_id);
      if (!r.ok) {
        await revokeLink(c.env.DB, link.id, null, 'file_gone');
        return c.json({ error: 'Баримт олдсонгүй' }, 410);
      }
      if (!isSignableDocx(r.entry)) return c.json({ error: 'Баримт олдсонгүй' }, 410);
      const size = Number(r.entry.size ?? '0');
      if (Number.isFinite(size) && size > SIGN_MAX_BYTES) return c.json({ error: 'Баримт хэт том байна' }, 413);
      const bytes = await io.download(c.env, link.file_id);
      return new Response(bytes, {
        status: 200,
        headers: headers(link.file_name, DOCX_MIME, { 'X-Document-State': 'current' }),
      });
    } catch (err) {
      return driveFailure(c, err, `document link=${link.id} file=${link.file_id}`);
    }
  });

  /* ---------------------------------------------------------------- */
  /*  POST /:token/presence — «яг одоо нээлттэй»                         */
  /* ---------------------------------------------------------------- */

  app.post('/:token/presence', async (c, next) => {
    const found = await findLink(c);
    if (!found) return next();
    noStore(c);
    const link = await settleStatus(c.env.DB, found);
    if (link.status === 'pending' || link.status === 'signing') {
      const before = new Date(Date.now() - PRESENCE_WRITE_EVERY_MS).toISOString();
      await c.env.DB.prepare(
        `UPDATE drive_doc_public_links
            SET last_viewed_at = ?, first_viewed_at = COALESCE(first_viewed_at, ?)
          WHERE id = ? AND status IN ('pending', 'signing')
            AND (last_viewed_at IS NULL OR last_viewed_at < ?)`,
      )
        .bind(new Date().toISOString(), new Date().toISOString(), link.id, before)
        .run();
    }
    return c.json({ status: requestBlock(link).status });
  });

  /* ---------------------------------------------------------------- */
  /*  POST /:token/sign — гарын үсэг → Word файл → Drive                 */
  /* ---------------------------------------------------------------- */

  app.post('/:token/sign', async (c, next) => {
    const found = await findLink(c);
    if (!found) return next();
    noStore(c);
    const declared = Number(c.req.header('Content-Length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_SIGN_BODY_BYTES) {
      return c.json({ error: 'Хүсэлт хэт том байна' }, 413);
    }
    const db = c.env.DB;
    let link = await settleStatus(db, found);
    if (link.status === 'signed') return c.json({ error: 'Аль хэдийн гарын үсэг зурсан' }, 409);
    if (link.status === 'revoked' || link.status === 'expired') return c.json({ error: 'Link хүчингүй болсон' }, 410);
    if (link.status === 'signing') {
      return c.json({ error: 'Гарын үсэг яг одоо хадгалагдаж байна — түр хүлээнэ үү' }, 409);
    }

    const body = (await c.req.json<Record<string, unknown>>().catch(() => null)) ?? {};
    if (body.consent !== true) return c.json({ error: 'Баталгаажуулах зөвшөөрөл шаардлагатай' }, 400);
    // «·» нь Word дахь «Alt text»-ийн хуваагч.
    const signedName = cleanSigningText(body.signer_name, 160)?.replace(/·/g, '-').trim() || null;
    if (!signedName) return c.json({ error: 'Гарын үсэг зурж буй хүний нэр шаардлагатай' }, 400);
    const signedPosition = cleanPosition(body.signer_position)?.replace(/·/g, '-') ?? null;
    const parsed = parseSignatureDataUrl(body.signature_data_url);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const valid = await stillValid(c, link);
    if (!valid.ok) return c.json({ error: 'Энэ link-ийн эрх хүчингүй болсон' }, 410);

    // Цаас цагаан, бэхээр тайрсан PNG — Word-ын хүснэгтийн шугамыг далдлахгүй (ажилтны урсгалтай ижил).
    const prepared = await prepareSignaturePng(parsed.bytes).catch(() => null);
    const stampBytes = prepared ? prepared.bytes : parsed.bytes;
    const info = imageInfo(stampBytes);
    if (!info) return c.json({ error: 'Гарын үсгийн зураг уншигдсангүй — дахин зурна уу' }, 400);

    // Link-ийг АТОМоор «зурж буй» болгоно: давхар илгээлт, ажилтны цуцлалт хоёр хоёулаа
    // энэ мөчөөс хойш хүлээнэ.  Алдаа гарвал буцаад pending.
    const claimAt = new Date().toISOString();
    const claim = await db
      .prepare(
        `UPDATE drive_doc_public_links
            SET status = 'signing', signing_started_at = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'pending' AND expires_at > ?`,
      )
      .bind(claimAt, link.id, claimAt)
      .run();
    if (!claim.meta.changes) {
      const fresh = await settleStatus(db, (await db.prepare('SELECT * FROM drive_doc_public_links WHERE id = ?').bind(link.id).first<DriveLinkRow>()) ?? link);
      if (fresh.status === 'signed') return c.json({ error: 'Аль хэдийн гарын үсэг зурсан' }, 409);
      if (fresh.status === 'signing') return c.json({ error: 'Гарын үсэг яг одоо хадгалагдаж байна — түр хүлээнэ үү' }, 409);
      return c.json({ error: 'Link хүчингүй болсон' }, 410);
    }
    link = { ...link, status: 'signing', signing_started_at: claimAt };

    const release = () =>
      db
        .prepare(
          `UPDATE drive_doc_public_links SET status = 'pending', signing_started_at = NULL, updated_at = datetime('now')
            WHERE id = ? AND status = 'signing' AND signing_started_at = ?`,
        )
        .bind(link.id, claimAt)
        .run()
        .catch(() => undefined);
    /** Баримт / мөр өөрчлөгдсөн — энэ link-ээр цаашид зурах боломжгүй. */
    const close = (reason: string) =>
      db
        .prepare(
          `UPDATE drive_doc_public_links
              SET status = 'revoked', revoked_at = datetime('now'), revoke_reason = ?, signing_started_at = NULL,
                  updated_at = datetime('now')
            WHERE id = ? AND status = 'signing' AND signing_started_at = ?`,
        )
        .bind(reason, link.id, claimAt)
        .run()
        .catch(() => undefined);

    const lockToken = await acquireLock(db, link.file_id, link.requested_by);
    if (!lockToken) {
      await release();
      return c.json({ error: 'Баримт яг одоо шинэчлэгдэж байна — хэдэн секундийн дараа дахин дарна уу', code: 'BUSY' }, 409);
    }

    let eventId: number | null = null;
    let privateKey: string | null = null;
    let snapshotKey: string | null = null;
    let uploaded = false;
    try {
      const resolved = await io.resolveFile(c.env, valid.root.folder_id, link.file_id);
      if (!resolved.ok || !isSignableDocx(resolved.entry) || !resolved.parentId) {
        await close('file_gone');
        return c.json({ error: 'Баримт олдсонгүй — танд илгээсэн ажилтантай холбогдоно уу' }, 410);
      }
      const entry = resolved.entry;
      const size = Number(entry.size ?? '0');
      if (Number.isFinite(size) && size > SIGN_MAX_BYTES) {
        await close('too_large');
        return c.json({ error: 'Баримт хэт том байна' }, 413);
      }
      const bytes = await io.download(c.env, link.file_id);
      const analyzed = await analyzeDocx(bytes);
      if (!analyzed.ok) {
        await close('not_docx');
        return c.json({ error: 'Баримт уншигдсангүй — танд илгээсэн ажилтантай холбогдоно уу' }, 410);
      }
      const slot = matchLinkSlot(analyzed.slots, link);
      if (!slot) {
        await close('document_changed');
        return c.json(
          { error: 'Баримт өөрчлөгдсөн тул энэ link хүчингүй боллоо — шинэ link авахын тулд илгээсэн ажилтантай холбогдоно уу', code: 'DOCUMENT_CHANGED' },
          409,
        );
      }
      if (slot.state !== 'empty') {
        await close('slot_taken');
        return c.json({ error: 'Энэ гарын үсгийн мөрөнд аль хэдийн гарын үсэг зурагдсан байна', code: 'SLOT_TAKEN' }, 409);
      }
      // Хооронд нь мөрийн нэр манай захирлынх болсон бол (батлах мөр) гаднын хүн зурахгүй.
      if (!linkableSlot(slot, await loadApprover(db))) {
        await close('approver_slot');
        return c.json({ error: 'Энэ мөрөнд гаднаас гарын үсэг зурах боломжгүй боллоо', code: 'APPROVER_ONLY' }, 409);
      }

      const mark = `mgl-sign-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const nowIso = new Date().toISOString();
      const stamped = await stampDocx(bytes, {
        slotKey: slot.key,
        image: { bytes: stampBytes, info },
        mark,
        descr: externalDescr(signedName, link.role_label.replace(/·/g, '-'), nowIso),
        fill: { name: signedName, position: signedPosition ?? undefined, ymd: todayInUB() },
      });
      if (!stamped.ok) {
        await close(stamped.reason === 'SLOT_NOT_EMPTY' ? 'slot_taken' : 'document_changed');
        return c.json({ error: 'Энэ гарын үсгийн мөрөнд зурах боломжгүй боллоо', code: stamped.reason }, 409);
      }

      // Аудит: зурсан эх PNG (хувийн bucket) + sha256.
      const signatureSha = await sha256Hex(parsed.bytes);
      privateKey = `doc-signatures/${link.file_id}/${mark}.png`;
      await c.env.MEETING_BUCKET.put(privateKey, parsed.bytes, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: { file_id: link.file_id, public_link_id: String(link.id), source: 'public-link' },
      });

      const ins = await db
        .prepare(
          `INSERT INTO drive_doc_sign_events
             (file_id, root_folder_id, scope, scope_id, file_name, action, user_id, slot_key, slot_role,
              slot_position, slot_name, approver_slot, name_override, docx_mark, filled_json, signature_key,
              signature_sha256, base_modified_time, user_agent, external_signer_name, public_link_id)
           VALUES (?, ?, ?, ?, ?, 'external', ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          link.file_id,
          link.root_folder_id,
          link.scope,
          link.scope_id,
          entry.name,
          link.requested_by,
          slot.key,
          slot.role.slice(0, 200),
          slot.position.slice(0, 200),
          slot.name.slice(0, 200),
          mark,
          JSON.stringify(stamped.filled),
          privateKey,
          signatureSha,
          entry.modifiedTime ?? null,
          (c.req.header('user-agent') ?? '').slice(0, 300) || null,
          signedName,
          link.id,
        )
        .run();
      eventId = Number(ins.meta.last_row_id);

      const newEntry = await io.upload(c.env, valid.root.folder_id, entry, resolved.parentId, stamped.bytes);
      // ⚠️ Энэ мөчөөс гарын үсэг Drive-ын файлд БАЙНА — доорх D1/R2 алдаа нь үүнийг
      // эргүүлэхгүй (үйл явдал/link-ийг устгаж «зураагүй» мэт болгох нь худал түүх).
      uploaded = true;
      await db
        .prepare('UPDATE drive_doc_sign_events SET result_modified_time = ?, result_md5 = ? WHERE id = ?')
        .bind(newEntry.modifiedTime ?? nowIso, newEntry.md5Checksum ?? null, eventId)
        .run()
        .catch((err: unknown) => console.error('[drive-public-signing] event result', link.id, err));

      // Нотолгоо: яг бичигдсэн .docx (хувийн bucket).
      const docSha = await sha256Hex(stamped.bytes);
      try {
        const key = `public-signing/drive/link-${link.id}-${crypto.randomUUID().replace(/-/g, '')}.docx`;
        await c.env.MEETING_BUCKET.put(key, stamped.bytes, {
          httpMetadata: { contentType: DOCX_MIME },
          customMetadata: { public_link_id: String(link.id), file_id: link.file_id, sha256: docSha },
        });
        snapshotKey = key;
      } catch (err) {
        console.error('[drive-public-signing] snapshot put failed', link.id, err);
      }

      await db
        .prepare(
          `UPDATE drive_doc_public_links
              SET status = 'signed', signed_name = ?, signed_position = ?, signature_key = ?, signature_sha256 = ?,
                  sign_event_id = ?, result_modified_time = ?, document_snapshot_key = ?, document_sha256 = ?,
                  signed_at = ?, signed_user_agent = ?, signing_started_at = NULL, file_name = ?,
                  updated_at = datetime('now')
            WHERE id = ? AND status = 'signing'`,
        )
        .bind(
          signedName,
          signedPosition,
          privateKey,
          signatureSha,
          eventId,
          newEntry.modifiedTime ?? nowIso,
          snapshotKey,
          snapshotKey ? docSha : null,
          nowIso,
          (c.req.header('user-agent') ?? '').slice(0, 500) || null,
          newEntry.name ?? entry.name,
          link.id,
        )
        .run()
        .catch((err: unknown) => console.error('[drive-public-signing] finalize link', link.id, err));

      const requester = link.requested_by;
      c.executionCtx.waitUntil(
        io.record(c.env, valid.root.folder_id, newEntry, requester).catch((err: unknown) => {
          console.error(`[drive-public-signing] record file=${newEntry.id}`, err);
        }),
      );
      // Захиалагчийн гарын үсгийн хураангуй (0415) — жагсаалтын тэмдэг шууд «Батлагдсан» болно.
      // Манай тал (захирал) аль хэдийн баталсан, захиалагчийн бүх мөр зурагдсан = БҮРЭН батлагдсан.
      let fullyApprovedBy: number | null = null;
      try {
        const after = await analyzeDocx(stamped.bytes);
        if (after.ok) {
          const fileName = newEntry.name ?? entry.name;
          const cs = await refreshClientSummary(db, {
            fileId: link.file_id,
            rootId: valid.root.folder_id,
            fileName,
            slots: after.slots,
            events: await loadEvents(db, link.file_id),
            modifiedTime: newEntry.modifiedTime ?? null,
          });
          const req = await loadLatestRequest(db, link.file_id);
          if (cs.complete && req?.status === 'approved') fullyApprovedBy = req.requested_by;
        }
      } catch (err) {
        console.error('[drive-public-signing] client summary', link.id, err);
      }
      try {
        const fileName = newEntry.name ?? entry.name;
        const docLink = documentLink({ scope: link.scope, scope_id: link.scope_id, parent_id: link.parent_id, file_id: link.file_id });
        const complete = fullyApprovedBy !== null;
        await createNotification(
          db,
          requester,
          'client_signed',
          complete ? `Бүрэн батлагдлаа: ${fileName}` : `Гаднын гарын үсэг ирлээ: ${fileName}`,
          `${signedName} · ${link.role_label} · ${valid.root.project_name}`,
          docLink,
        );
        // Захиралд батлуулах хүсэлт илгээсэн хүн (link илгээгчээс өөр) ч баримт бүрэн батлагдсаныг мэдэнэ.
        if (fullyApprovedBy !== null && fullyApprovedBy !== requester) {
          await createNotification(
            db,
            fullyApprovedBy,
            'client_signed',
            `Бүрэн батлагдлаа: ${fileName}`,
            `${signedName} (захиалагч) гарын үсэг зурлаа · ${link.role_label} · ${valid.root.project_name}`,
            docLink,
          );
        }
      } catch (err) {
        console.error('[drive-public-signing] notification failed', link.id, err);
      }

      return c.json({
        ok: true,
        status: 'signed',
        signed_name: signedName,
        signed_at: nowIso,
        role_label: link.role_label,
        signed_preview: snapshotKey !== null,
        signed_format: 'pdf',
      });
    } catch (err) {
      if (uploaded) {
        // Drive-д аль хэдийн бичигдсэн — гарын үсэг хүчинтэй; зөвхөн дагалдах ажил унасан.
        console.error('[drive-public-signing] post-upload step failed', link.id, err);
        return c.json({ ok: true, status: 'signed', signed_name: signedName, signed_at: new Date().toISOString(), role_label: link.role_label, signed_preview: false, signed_format: 'pdf' });
      }
      if (eventId !== null) {
        await db.prepare('DELETE FROM drive_doc_sign_events WHERE id = ?').bind(eventId).run().catch(() => undefined);
      }
      if (privateKey) await c.env.MEETING_BUCKET.delete(privateKey).catch(() => undefined);
      if (snapshotKey) await c.env.MEETING_BUCKET.delete(snapshotKey).catch(() => undefined);
      await release();
      return driveFailure(c, err, `sign link=${link.id} file=${link.file_id}`);
    } finally {
      await releaseLock(db, link.file_id, lockToken).catch(() => undefined);
    }
  });

  return app;
}
