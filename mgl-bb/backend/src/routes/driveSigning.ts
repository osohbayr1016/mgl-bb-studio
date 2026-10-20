/* =============================================================
 * Баримтын гарын үсэг + захирлын баталгаажуулалт — «Баримт бичиг» (Drive)
 * -------------------------------------------------------------
 * Эзний хүсэлт (2026-10-01): RFI-г явуулахын өмнө ажилтнууд гарын үсгээ
 * зурж, дараа нь захирал хараад НЭГ товчоор баталгаажуулна.  Гарын үсэг =
 * профайлын `users.signature_url` (тусдаа зурах алхамгүй); тэр нь Word
 * ФАЙЛ ДЭЭР суугаад ИЖИЛ Drive файлын шинэ хувилбар болно — хэвлэх, PDF
 * болгох, явуулах нь энгийн Word файл шиг.
 *
 * `mountDriveSigning()` нь `routes/projectDrive.ts`-ийн `mountDriveBrowse`-ийн
 * адил ҮЙЛДВЭР: `/api/projects/:id/drive/…` ба `/api/main-projects/:id/drive/…`
 * хоёуланд ижил handler.
 *
 *   GET  /:id/drive/files/:fileId/signing           нүднүүд, хэн зурсан, хүсэлт, миний эрх
 *   POST /:id/drive/files/:fileId/signing/sign      ажилтан өөрийн мөрөнд зурна
 *   POST /:id/drive/files/:fileId/signing/approve   захирал батлах мөрөнд зурна (= батлав)
 *   POST /:id/drive/files/:fileId/signing/request   захиралд батлуулахаар илгээх
 *   POST /:id/drive/files/:fileId/signing/return    захирал буцаах (тайлбартай)
 *   POST /:id/drive/files/:fileId/signing/cancel    хүсэлтийг цуцлах (илгээгч | admin)
 *   POST /:id/drive/files/:fileId/signing/ask       хамт олноос гарын үсэг хүсэх (мэдэгдэл)
 *   POST /:id/drive/signing/statuses                хавтасны жагсаалтын тэмдэг (D1 л)
 *
 * Мөн `/api/drive-signing` (default export):
 *   GET  /pending                                   захирлын хүлээгдэж буй + надаас хүссэн
 *
 * ЭРХ: «Баримт бичиг»-тэй ИЖИЛ — ажилтан (`SIGNING_ROLES`), төсөл байгаа, файл
 * төслийн хавтасны дотор (`io.resolveFile` — ancestry).  Мөр тус бүрийн эрх
 * `lib/driveSigning.ts` `slotDecision`.  Захиалагч/цэвэрлэгч — 403.
 *
 * ⚠️ Drive-ын сүлжээ `DriveSignIo`-гоор: `driveBrowse.ts` нь `googleAuth.ts`-ийг
 *    импортолдог тул `node --test` ачаалж чаддаггүй — тест нь хуурамч IO өгнө,
 *    production нь `lib/driveSigningIo.ts`.
 * ============================================================= */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, AppVariables } from '../types';
import type { DriveEntry } from '../lib/google/driveBrowseCore';
import type { ProjectDriveRoot } from '../lib/projectDrive';
import { mediaKeyOfUrl } from '../lib/mediaReplace';
import { createNotification } from '../lib/notify';
import { todayInUB } from '../lib/time';
import { imageInfo, type ImageInfo, type SignSlot } from '../lib/docxSign';
import { SIGN_MAX_BYTES, analyzeDocx, stampDocx } from '../lib/docxSignFile';
import { prepareSignaturePng } from '../lib/pngCrop';
import {
  SIGNING_ROLES,
  acquireLock,
  cleanNote,
  docDisplayName,
  documentLink,
  eventForDescr,
  fullDisplayName,
  isLaterThan,
  loadApprover,
  loadEvents,
  loadLatestRequest,
  loadPendingRequest,
  loadStaff,
  loadUser,
  pickApproverSlot,
  isSignableDocx,
  refreshClientSummary,
  releaseLock,
  resolveNamedUser,
  slotDecision,
  statusesFor,
  type EventRow,
  type RequestRow,
  type SignUser,
} from '../lib/driveSigning';
import { mountDriveSigningLinks } from './driveSigningLinks';
import { linkableSlot } from '../lib/drivePublicSigning';

type AppEnv = { Bindings: Env; Variables: AppVariables };
type AppContext = Context<AppEnv>;
type App = Hono<AppEnv>;

/* ------------------------------------------------------------------ */
/*  Drive IO — production: lib/driveSigningIo.ts                       */
/* ------------------------------------------------------------------ */

export type ResolvedFile =
  | { ok: true; entry: DriveEntry; parentId: string | null }
  | { ok: false; status: 403 | 404; code: string; error: string };

export interface DriveSignIo {
  /** Файл төслийн хавтасны дотор эсэх (ancestry) + бүрэн мета (md5, modifiedTime, size). */
  resolveFile(env: Env, rootId: string, fileId: string): Promise<ResolvedFile>;
  download(env: Env, fileId: string): Promise<Uint8Array>;
  /** ИЖИЛ файлын шинэ хувилбар (нэр, байрлал хэвээр). */
  upload(env: Env, rootId: string, entry: DriveEntry, parentId: string, bytes: Uint8Array): Promise<DriveEntry>;
  /** Хувилбарын ledger + R2 хуулбар (waitUntil дотор). */
  record(env: Env, rootId: string, entry: DriveEntry, userId: number): Promise<void>;
  /** Drive-ын алдааг HTTP хариу болгох (production: `driveErrorResponse`). */
  errorResponse(c: AppContext, err: unknown, where: string): Response;
}

export interface DriveSigningScope {
  label: 'project' | 'main';
  resolveRoot: (db: D1Database, id: number) => Promise<ProjectDriveRoot | null>;
  io: DriveSignIo;
}

/* ------------------------------------------------------------------ */
/*  Хариуны хэлбэр                                                      */
/* ------------------------------------------------------------------ */

interface PersonView {
  id: number;
  name: string;
}

interface SlotView {
  key: string;
  group: number;
  role: string;
  position: string;
  name: string;
  date: string;
  approver: boolean;
  /** Захиалагчийн мөр — ERP-д хэн ч зурахгүй. */
  client: boolean;
  state: SignSlot['state'];
  /** ERP-ээр зурсан бол хэн, хэзээ (баримт дахь тэмдгээр).  `external` = гаднын link-ээр
   *  (0397): `name` нь зурсан хүний бичсэн нэр, `id` null, `sent_by` нь link илгээсэн ажилтан. */
  signer:
    | { id: number | null; name: string; at: string; action: 'sign' | 'approve' | 'external'; sent_by: PersonView | null }
    | null;
  can_sign: boolean;
  needs_name_confirm: boolean;
  mine: boolean;
  /** «Гарын үсэг хүсэх» — мөрийн нэр ганц ажилтанд таарвал. */
  ask_user: PersonView | null;
  /** Гаднын (login-гүй) link илгээж болох мөр (0397): хоосон, захирлын өөрийн батлах мөр биш,
   *  бүртгэлтэй ажилтны (эсвэл миний) нэртэй биш. */
  can_link: boolean;
}

type Unsupported = 'NOT_DOCX' | 'TOO_LARGE' | 'NO_SLOTS';

function noStore(c: AppContext): void {
  c.header('Cache-Control', 'private, no-store');
}

function shortError(c: AppContext, status: 400 | 403 | 404 | 409 | 413 | 422 | 429 | 503, code: string, error: string) {
  return c.json({ error, code }, status);
}

/* ------------------------------------------------------------------ */
/*  Үйлдвэр                                                              */
/* ------------------------------------------------------------------ */

export function mountDriveSigning(app: App, scope: DriveSigningScope): void {
  const { io } = scope;

  type Access =
    | { ok: true; root: ProjectDriveRoot & { folder_id: string }; me: SignUser }
    | { ok: false; response: Response };

  async function access(c: AppContext): Promise<Access> {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') ?? '', 10);
    if (!SIGNING_ROLES.has(user.role)) {
      return { ok: false, response: shortError(c, 403, 'FORBIDDEN', 'Access denied') };
    }
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, response: shortError(c, 404, 'PROJECT_NOT_FOUND', 'Project not found') };
    }
    const root = await scope.resolveRoot(c.env.DB, id);
    if (!root) return { ok: false, response: shortError(c, 404, 'PROJECT_NOT_FOUND', 'Project not found') };
    if (!root.folder_id) {
      return { ok: false, response: shortError(c, 409, 'NOT_LINKED', 'Энэ төсөлд Google Drive хавтас холбогдоогүй байна') };
    }
    const me = await loadUser(c.env.DB, user.sub);
    if (!me || me.status !== 'active') return { ok: false, response: shortError(c, 403, 'FORBIDDEN', 'Access denied') };
    // JWT-ийн роль хуучирсан байж болно (CLAUDE.md) — эрхийг токеноос.
    me.role = user.role;
    return { ok: true, root: root as ProjectDriveRoot & { folder_id: string }, me };
  }

  type Loaded =
    | { ok: true; entry: DriveEntry; parentId: string | null }
    | { ok: false; response: Response };

  async function loadFile(c: AppContext, rootId: string): Promise<Loaded> {
    const fileId = c.req.param('fileId') ?? '';
    if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
      return { ok: false, response: shortError(c, 400, 'INVALID_ID', 'Invalid file id') };
    }
    try {
      const r = await io.resolveFile(c.env, rootId, fileId);
      if (!r.ok) return { ok: false, response: c.json({ error: r.error, code: r.code }, r.status) };
      return { ok: true, entry: r.entry, parentId: r.parentId };
    } catch (err) {
      return { ok: false, response: io.errorResponse(c, err, `signing-file ${scope.label} file=${fileId}`) };
    }
  }

  function unsupportedOf(entry: DriveEntry): Unsupported | null {
    if (!isSignableDocx(entry)) return 'NOT_DOCX';
    const size = Number(entry.size ?? '0');
    if (Number.isFinite(size) && size > SIGN_MAX_BYTES) return 'TOO_LARGE';
    return null;
  }

  /** Хариуны бүтэн төлөв — баримтын нүднүүд + D1 + миний эрх. */
  async function buildState(
    c: AppContext,
    ctx: { root: ProjectDriveRoot; me: SignUser; entry: DriveEntry; parentId: string | null },
    slots: SignSlot[] | null,
    unsupported: Unsupported | null,
  ) {
    const db = c.env.DB;
    const [events, request, approver, staff] = await Promise.all([
      loadEvents(db, ctx.entry.id),
      loadLatestRequest(db, ctx.entry.id),
      loadApprover(db),
      loadStaff(db),
    ]);
    const isApprover = approver !== null && approver.id === ctx.me.id;
    const canManageLinks = ctx.me.role === 'admin';
    const people = new Map<number, SignUser>(staff.map((u) => [u.id, u]));
    const nameOf = async (id: number | null): Promise<PersonView | null> => {
      if (id == null) return null;
      const u = people.get(id) ?? (await loadUser(db, id));
      if (u) people.set(id, u);
      return { id, name: fullDisplayName(u) || `#${id}` };
    };

    const byMark = new Map<string, EventRow>();
    for (const e of events) {
      if (isStampAction(e.action) && e.docx_mark && e.result_modified_time) {
        if (!byMark.has(e.docx_mark)) byMark.set(e.docx_mark, e);
      }
    }

    const slotViews: SlotView[] = [];
    for (const s of slots ?? []) {
      const d = slotDecision(s, ctx.me, isApprover);
      const ev = s.mark ? byMark.get(s.mark) : s.erpDescr ? eventForDescr(events, s.erpDescr, people) : undefined;
      let signer: SlotView['signer'] = null;
      if (ev && ev.action === 'external') {
        signer = {
          id: null,
          name: (ev.external_signer_name ?? '').trim() || '—',
          at: ev.created_at,
          action: 'external',
          sent_by: await nameOf(ev.user_id),
        };
      } else if (ev) {
        const who = await nameOf(ev.user_id);
        if (who) signer = { ...who, at: ev.created_at, action: ev.action === 'approve' ? 'approve' : 'sign', sent_by: null };
      }
      let askUser: PersonView | null = null;
      if (s.state === 'empty' && !s.approver && !s.client) {
        const u = resolveNamedUser(s.name, staff);
        if (u && u.id !== ctx.me.id) askUser = { id: u.id, name: fullDisplayName(u) };
      }
      slotViews.push({
        key: s.key,
        group: s.group,
        role: s.role,
        position: s.position,
        name: s.name,
        date: s.date,
        approver: s.approver,
        client: s.client,
        state: s.state,
        signer,
        can_sign: d.canSign && !unsupported,
        needs_name_confirm: d.needsNameConfirm,
        mine: d.mine,
        ask_user: askUser,
        // Гаднын link-ийг ЗӨВХӨН admin (эзний шийдвэр 2026-10-12).
        can_link: canManageLinks && !unsupported && linkableSlot(s, approver) && !d.mine && askUser === null,
      });
    }

    // Захиалагчийн гарын үсэг (2026-10-19) — баримтыг уншсан бүрд жагсаалтын хураангуйг шинэчилнэ.
    const clientSign =
      slots && !unsupported
        ? await refreshClientSummary(db, {
            fileId: ctx.entry.id,
            rootId: ctx.root.folder_id ?? '',
            fileName: ctx.entry.name,
            slots,
            events,
            modifiedTime: ctx.entry.modifiedTime ?? null,
          })
        : null;

    const lastResult = events.find((e) => e.result_modified_time)?.result_modified_time ?? null;
    const approverSlot = slots && approver ? pickApproverSlot(slots, approver) : null;
    const hasEmptyApproverSlot = (slots ?? []).some((s) => s.approver && s.state === 'empty');
    const pending = request?.status === 'pending';
    const history = await Promise.all(
      events.slice(0, 50).map(async (e) => ({
        id: e.id,
        action: e.action,
        user: await nameOf(e.user_id),
        target: e.action === 'ask' ? await nameOf(e.target_user_id) : null,
        /** Гаднын link-ээр зурсан хүний нэр (`user` = link илгээсэн ажилтан). */
        external_name: e.action === 'external' ? (e.external_signer_name ?? null) : null,
        slot_role: e.slot_role,
        slot_name: e.slot_name,
        created_at: e.created_at,
        done: e.action === 'ask' || e.result_modified_time !== null,
      })),
    );

    return {
      file: {
        id: ctx.entry.id,
        name: ctx.entry.name,
        modified_time: ctx.entry.modifiedTime ?? null,
        size: ctx.entry.size != null ? Number(ctx.entry.size) : null,
        parent_id: ctx.parentId,
      },
      supported: unsupported === null && (slots?.length ?? 0) > 0,
      reason: unsupported ?? ((slots?.length ?? 0) === 0 ? ('NO_SLOTS' as const) : null),
      slots: slotViews,
      me: {
        id: ctx.me.id,
        name: fullDisplayName(ctx.me),
        doc_name: docDisplayName(ctx.me),
        position: ctx.me.position,
        is_approver: isApprover,
        profile_signature_url: ctx.me.signature_url,
      },
      approver: approver ? { id: approver.id, name: fullDisplayName(approver) } : null,
      default_approve_slot: isApprover && approverSlot ? approverSlot.key : null,
      request: request ? await requestView(request, nameOf) : null,
      /** Захиалагчийн гарын үсэг: «Батлагдсан» = захирал баталсан ∧ `complete` (`lib/driveClientSign.ts`). */
      client_sign: clientSign,
      can_request: !unsupported && approver !== null && !isApprover && hasEmptyApproverSlot && !pending,
      /** Гаднын гарын үсгийн link үүсгэх / цуцлах (admin). */
      can_manage_links: canManageLinks && !unsupported,
      /** Захиалагчийн мөргүй (RFI) — «Захиалагч хүлээн авсан» мөр нэмж link үүсгэж болно. */
      client_row_addable:
        canManageLinks && !unsupported && !(slots ?? []).some((s) => s.client) && (slots ?? []).some((s) => s.pattern === 'column'),
      history: history.filter((h) => h.done),
      /** Сүүлд ERP-ээр зурснаас хойш файлыг өөр хэн нэгэн (Word/Google) засварласан. */
      changed_since_signing: isLaterThan(ctx.entry.modifiedTime, lastResult),
    };
  }

  async function requestView(r: RequestRow, nameOf: (id: number | null) => Promise<PersonView | null>) {
    return {
      id: r.id,
      status: r.status,
      requested_by: await nameOf(r.requested_by),
      approver: await nameOf(r.approver_id),
      note: r.note,
      created_at: r.created_at,
      decided_by: await nameOf(r.decided_by),
      decided_at: r.decided_at,
      decision_note: r.decision_note,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  GET — төлөв                                                      */
  /* ---------------------------------------------------------------- */

  app.get('/:id/drive/files/:fileId/signing', async (c) => {
    noStore(c);
    const a = await access(c);
    if (!a.ok) return a.response;
    const f = await loadFile(c, a.root.folder_id);
    if (!f.ok) return f.response;
    const unsupported = unsupportedOf(f.entry);
    let slots: SignSlot[] | null = null;
    let reason = unsupported;
    if (!unsupported) {
      try {
        const bytes = await io.download(c.env, f.entry.id);
        const analyzed = await analyzeDocx(bytes);
        if (analyzed.ok) slots = analyzed.slots;
        else reason = 'NOT_DOCX';
      } catch (err) {
        return io.errorResponse(c, err, `signing-read ${scope.label} file=${f.entry.id}`);
      }
    }
    return c.json(await buildState(c, { root: a.root, me: a.me, entry: f.entry, parentId: f.parentId }, slots, reason));
  });

  /* ---------------------------------------------------------------- */
  /*  Зурах (ажилтан) / батлах (захирал)                               */
  /* ---------------------------------------------------------------- */

  type SignBody = {
    slot_key?: unknown;
    base_modified_time?: unknown;
    request_approval?: unknown;
    confirm_name_mismatch?: unknown;
    note?: unknown;
  };

  async function signatureImage(
    c: AppContext,
    me: SignUser,
  ): Promise<{ ok: true; original: Uint8Array; stamped: { bytes: Uint8Array; info: ImageInfo } } | { ok: false; response: Response }> {
    const key = me.signature_url ? mediaKeyOfUrl(me.signature_url) : null;
    if (!key) return { ok: false, response: shortError(c, 409, 'NO_SIGNATURE', 'Профайлдаа гарын үсгээ хадгална уу') };
    const obj = await c.env.MEDIA_BUCKET.get(key);
    if (!obj) {
      return { ok: false, response: shortError(c, 409, 'NO_SIGNATURE', 'Профайлын гарын үсгийн зураг олдсонгүй — дахин хадгална уу') };
    }
    const original = new Uint8Array(await obj.arrayBuffer());
    const prepared = await prepareSignaturePng(original).catch(() => null);
    const bytes = prepared ? prepared.bytes : original;
    const info = imageInfo(bytes);
    if (!info) {
      return {
        ok: false,
        response: shortError(c, 422, 'SIGNATURE_FORMAT', 'Гарын үсгийн зураг PNG/JPG биш байна — профайлдаа дахин зурж хадгална уу'),
      };
    }
    return { ok: true, original, stamped: { bytes, info } };
  }

  async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Нэг нүдэнд гарын үсэг суулгаж Drive-д шинэ хувилбар болгоно — зурах ба
   * батлах хоёрын НЭГ цөм.  Буцаах: шинэ мета + шинэ байт + үйл явдлын id.
   */
  async function stampAndUpload(
    c: AppContext,
    ctx: { root: ProjectDriveRoot & { folder_id: string }; me: SignUser; entry: DriveEntry; parentId: string | null },
    opts: {
      action: 'sign' | 'approve';
      pickSlot: (slots: SignSlot[]) => SignSlot | null;
      confirmMismatch: boolean;
      base: string;
      isApprover: boolean;
    },
  ): Promise<
    | { ok: true; entry: DriveEntry; bytes: Uint8Array; slot: SignSlot; eventId: number }
    | { ok: false; response: Response }
  > {
    const db = c.env.DB;
    const unsupported = unsupportedOf(ctx.entry);
    if (unsupported) return { ok: false, response: shortError(c, unsupported === 'TOO_LARGE' ? 413 : 400, unsupported, 'Энэ файлд гарын үсэг зурах боломжгүй') };
    if ((ctx.entry.modifiedTime ?? '') !== opts.base) {
      return { ok: false, response: shortError(c, 409, 'STALE_FILE', 'Файл хооронд нь өөрчлөгдсөн байна — дахин ачаална уу') };
    }
    if (!ctx.parentId) return { ok: false, response: shortError(c, 400, 'NOT_REVISABLE', 'Энэ файлыг шинэчлэх боломжгүй') };

    const sig = await signatureImage(c, ctx.me);
    if (!sig.ok) return sig;

    const token = await acquireLock(db, ctx.entry.id, ctx.me.id);
    if (!token) {
      return { ok: false, response: shortError(c, 409, 'BUSY', 'Өөр хүн яг одоо энэ баримтад гарын үсэг зурж байна — түр хүлээгээд дахин оролдоно уу') };
    }
    let eventId: number | null = null;
    let privateKey: string | null = null;
    try {
      // Түгжээний ДАРАА дахин шалгана: харсан хувилбараас хойш хэн нэгэн
      // (Word/Google, өөр ажилтан) хадгалсан бол мөрийн түлхүүр өөр мөрийг
      // заах эрсдэлтэй — ажилтан шинэ төлвийг харж байж зурна.
      const fresh = await io.resolveFile(c.env, ctx.root.folder_id, ctx.entry.id);
      if (!fresh.ok) return { ok: false, response: c.json({ error: fresh.error, code: fresh.code }, fresh.status) };
      if ((fresh.entry.modifiedTime ?? '') !== opts.base) {
        return { ok: false, response: shortError(c, 409, 'STALE_FILE', 'Файл хооронд нь өөрчлөгдсөн байна — дахин ачаална уу') };
      }
      const bytes = await io.download(c.env, ctx.entry.id);
      const analyzed = await analyzeDocx(bytes);
      if (!analyzed.ok) return { ok: false, response: shortError(c, 400, 'NOT_DOCX', 'Word баримт уншигдсангүй') };
      const slot = opts.pickSlot(analyzed.slots);
      if (!slot) return { ok: false, response: shortError(c, 404, 'SLOT_NOT_FOUND', 'Гарын үсгийн мөр олдсонгүй — дахин ачаална уу') };
      const decision = slotDecision(slot, ctx.me, opts.isApprover);
      if (!decision.canSign) {
        const msg: Record<string, string> = {
          NOT_EMPTY: 'Энэ мөрөнд гарын үсэг аль хэдийн байна',
          APPROVER_ONLY: 'Энэ мөрөнд зөвхөн захирал гарын үсэг зурна',
          NAME_MISMATCH: 'Энэ мөрөнд өөр хүний нэр бичигдсэн байна',
          CLIENT: 'Энэ мөрөнд захиалагч гарын үсэг зурна',
          ROLE: 'Access denied',
        };
        return { ok: false, response: shortError(c, decision.reason === 'ROLE' ? 403 : 409, decision.reason, msg[decision.reason] ?? 'Зурах боломжгүй') };
      }
      if (slot.approver !== (opts.action === 'approve')) {
        return {
          ok: false,
          response: shortError(c, 409, slot.approver ? 'USE_APPROVE' : 'NOT_APPROVER_SLOT', slot.approver ? 'Батлах мөрийг «Батлах» товчоор' : 'Энэ нь батлах мөр биш'),
        };
      }
      if (decision.needsNameConfirm && !opts.confirmMismatch) {
        return { ok: false, response: shortError(c, 409, 'NAME_CONFIRM_REQUIRED', `Энэ мөрөнд «${slot.name}» гэж бичигдсэн — өөрийн мөр мөн эсэхээ баталгаажуулна уу`) };
      }

      const mark = `mgl-sign-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const nowIso = new Date().toISOString();
      const fullName = fullDisplayName(ctx.me);
      const stamped = await stampDocx(bytes, {
        slotKey: slot.key,
        image: sig.stamped,
        mark,
        descr: `MGL ERP · ${fullName}${ctx.me.position ? ` · ${ctx.me.position}` : ''} · ${nowIso}`,
        fill: { name: docDisplayName(ctx.me), position: ctx.me.position ?? undefined, ymd: todayInUB() },
      });
      if (!stamped.ok) {
        return {
          ok: false,
          response: shortError(c, 409, stamped.reason, stamped.reason === 'SLOT_NOT_EMPTY' ? 'Энэ мөрөнд гарын үсэг аль хэдийн байна' : 'Гарын үсгийн мөр олдсонгүй'),
        };
      }

      // Аудитын хуулбар — профайлын эх байт (`mediaReplace` профайлын объектыг солиход устгадаг).
      const ext = imageInfo(sig.original)?.ext === 'jpeg' ? 'jpg' : 'png';
      privateKey = `doc-signatures/${ctx.entry.id}/${mark}.${ext}`;
      await c.env.MEETING_BUCKET.put(privateKey, sig.original, {
        httpMetadata: { contentType: ext === 'jpg' ? 'image/jpeg' : 'image/png' },
        customMetadata: { file_id: ctx.entry.id, user_id: String(ctx.me.id), source: ctx.me.signature_url ?? '' },
      });
      const sha = await sha256Hex(sig.original);

      // Үйл явдлыг ЭХЛЭЭД (байршуулалт унавал устгана) — баримтад тэмдэг
      // орсон атлаа хэн гэдэг нь алга гэсэн төлөвөөс зайлсхийнэ.
      const ins = await db
        .prepare(
          `INSERT INTO drive_doc_sign_events
             (file_id, root_folder_id, scope, scope_id, file_name, action, user_id, slot_key, slot_role,
              slot_position, slot_name, approver_slot, name_override, docx_mark, filled_json, signature_key,
              signature_sha256, base_modified_time, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          ctx.entry.id,
          ctx.root.folder_id,
          scope.label,
          ctx.root.project_id,
          ctx.entry.name,
          opts.action,
          ctx.me.id,
          slot.key,
          slot.role.slice(0, 200),
          slot.position.slice(0, 200),
          slot.name.slice(0, 200),
          slot.approver ? 1 : 0,
          decision.needsNameConfirm ? 1 : 0,
          mark,
          JSON.stringify(stamped.filled),
          privateKey,
          sha,
          opts.base,
          (c.req.header('user-agent') ?? '').slice(0, 300) || null,
        )
        .run();
      eventId = Number(ins.meta.last_row_id);

      const parentId = ctx.parentId;
      const newEntry = await io.upload(c.env, ctx.root.folder_id, ctx.entry, parentId, stamped.bytes);
      await db
        .prepare('UPDATE drive_doc_sign_events SET result_modified_time = ?, result_md5 = ? WHERE id = ?')
        .bind(newEntry.modifiedTime ?? nowIso, newEntry.md5Checksum ?? null, eventId)
        .run();
      const userId = ctx.me.id;
      c.executionCtx.waitUntil(
        io.record(c.env, ctx.root.folder_id, newEntry, userId).catch((err: unknown) => {
          console.error(`[drive-signing] record file=${newEntry.id}`, err);
        }),
      );
      return { ok: true, entry: newEntry, bytes: stamped.bytes, slot, eventId };
    } catch (err) {
      if (eventId !== null) {
        await db.prepare('DELETE FROM drive_doc_sign_events WHERE id = ?').bind(eventId).run().catch(() => {});
      }
      if (privateKey) await c.env.MEETING_BUCKET.delete(privateKey).catch(() => {});
      return { ok: false, response: io.errorResponse(c, err, `signing-${opts.action} ${scope.label} file=${ctx.entry.id}`) };
    } finally {
      await releaseLock(db, ctx.entry.id, token).catch(() => {});
    }
  }

  async function notifyApproval(
    c: AppContext,
    approver: SignUser,
    req: { id: number; file_id: string; file_name: string; scope: string; scope_id: number; parent_id: string | null },
    by: SignUser,
    projectName: string,
  ): Promise<void> {
    await createNotification(
      c.env.DB,
      approver.id,
      'doc_sign_requested',
      `Баталгаажуулах хүсэлт: ${req.file_name}`,
      `${fullDisplayName(by)} гарын үсэг зурж, таны баталгаажуулалтыг хүлээж байна · ${projectName}`,
      documentLink(req),
    );
  }

  /** Захиралд батлуулах хүсэлт (байхгүй бол) — шинэ мөр + мэдэгдэл. */
  async function openRequest(
    c: AppContext,
    ctx: { root: ProjectDriveRoot & { folder_id: string }; me: SignUser; entry: DriveEntry; parentId: string | null },
    approver: SignUser,
    note: string | null,
  ): Promise<RequestRow | null> {
    const db = c.env.DB;
    try {
      await db
        .prepare(
          `INSERT INTO drive_doc_sign_requests
             (file_id, root_folder_id, scope, scope_id, parent_id, file_name, status, requested_by, approver_id, note)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .bind(ctx.entry.id, ctx.root.folder_id, scope.label, ctx.root.project_id, ctx.parentId, ctx.entry.name, ctx.me.id, approver.id, note)
        .run();
    } catch (err) {
      // ux_ddsr_pending — зэрэг хоёр хүсэлт: нэг нь л үлдэнэ.
      if (/UNIQUE/i.test(err instanceof Error ? err.message : String(err))) return null;
      throw err;
    }
    const row = await loadPendingRequest(db, ctx.entry.id);
    if (row) await notifyApproval(c, approver, row, ctx.me, ctx.root.project_name);
    return row;
  }

  app.post('/:id/drive/files/:fileId/signing/sign', async (c) => {
    noStore(c);
    const a = await access(c);
    if (!a.ok) return a.response;
    const body = (await c.req.json<SignBody>().catch(() => ({}))) as SignBody;
    const slotKey = typeof body.slot_key === 'string' ? body.slot_key : '';
    const base = typeof body.base_modified_time === 'string' ? body.base_modified_time : '';
    if (!slotKey || !base) return shortError(c, 400, 'BAD_REQUEST', 'slot_key, base_modified_time шаардлагатай');
    const f = await loadFile(c, a.root.folder_id);
    if (!f.ok) return f.response;
    const ctx = { root: a.root, me: a.me, entry: f.entry, parentId: f.parentId };
    const approver = await loadApprover(c.env.DB);
    const isApprover = approver?.id === a.me.id;

    const r = await stampAndUpload(c, ctx, {
      action: 'sign',
      pickSlot: (slots) => slots.find((s) => s.key === slotKey) ?? null,
      confirmMismatch: body.confirm_name_mismatch === true,
      base,
      isApprover,
    });
    if (!r.ok) return r.response;
    const after = { ...ctx, entry: r.entry };

    let requested: RequestRow | null = null;
    if (body.request_approval === true && approver && !isApprover) {
      const analyzed = await analyzeDocx(r.bytes);
      const needs = analyzed.ok && analyzed.slots.some((s) => s.approver && s.state === 'empty');
      const pending = await loadPendingRequest(c.env.DB, r.entry.id);
      if (needs && !pending) requested = await openRequest(c, after, approver, cleanNote(body.note));
      if (requested) {
        await c.env.DB.prepare('UPDATE drive_doc_sign_events SET request_id = ? WHERE id = ?').bind(requested.id, r.eventId).run();
      }
    }
    const analyzed = await analyzeDocx(r.bytes);
    const state = await buildState(c, after, analyzed.ok ? analyzed.slots : null, null);
    return c.json({ ...state, requested: requested !== null });
  });

  app.post('/:id/drive/files/:fileId/signing/approve', async (c) => {
    noStore(c);
    const a = await access(c);
    if (!a.ok) return a.response;
    const approver = await loadApprover(c.env.DB);
    if (!approver || approver.id !== a.me.id) return shortError(c, 403, 'APPROVER_ONLY', 'Зөвхөн захирал баталгаажуулна');
    const body = (await c.req.json<SignBody>().catch(() => ({}))) as SignBody;
    const base = typeof body.base_modified_time === 'string' ? body.base_modified_time : '';
    if (!base) return shortError(c, 400, 'BAD_REQUEST', 'base_modified_time шаардлагатай');
    const slotKey = typeof body.slot_key === 'string' && body.slot_key ? body.slot_key : null;
    const f = await loadFile(c, a.root.folder_id);
    if (!f.ok) return f.response;
    const ctx = { root: a.root, me: a.me, entry: f.entry, parentId: f.parentId };

    const r = await stampAndUpload(c, ctx, {
      action: 'approve',
      pickSlot: (slots) => (slotKey ? (slots.find((s) => s.key === slotKey) ?? null) : pickApproverSlot(slots, approver)),
      confirmMismatch: false,
      base,
      isApprover: true,
    });
    if (!r.ok) return r.response;
    const after = { ...ctx, entry: r.entry };
    const db = c.env.DB;
    const decidedAt = new Date().toISOString();
    const note = cleanNote(body.note);

    let request = await loadPendingRequest(db, r.entry.id);
    if (request) {
      await db
        .prepare(
          `UPDATE drive_doc_sign_requests
              SET status = 'approved', decided_by = ?, decided_at = ?, decision_note = ?, approve_event_id = ?,
                  file_name = ?, updated_at = datetime('now')
            WHERE id = ? AND status = 'pending'`,
        )
        .bind(a.me.id, decidedAt, note, r.eventId, r.entry.name, request.id)
        .run();
    } else {
      // Хүсэлтгүйгээр шууд баталсан — төлөв «батлагдсан» харагдана.
      await db
        .prepare(
          `INSERT INTO drive_doc_sign_requests
             (file_id, root_folder_id, scope, scope_id, parent_id, file_name, status, requested_by, approver_id,
              decided_by, decided_at, decision_note, approve_event_id)
           VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(r.entry.id, a.root.folder_id, scope.label, a.root.project_id, f.parentId, r.entry.name, a.me.id, a.me.id, a.me.id, decidedAt, note, r.eventId)
        .run();
    }
    request = await loadLatestRequest(db, r.entry.id);
    await db.prepare('UPDATE drive_doc_sign_events SET request_id = ? WHERE id = ?').bind(request?.id ?? null, r.eventId).run();

    const analyzed = await analyzeDocx(r.bytes);
    const state = await buildState(c, after, analyzed.ok ? analyzed.slots : null, null);
    // Захиалагчийн гарын үсэг дутуу бол «Батлагдлаа» биш — манай тал л баталсан (2026-10-19).
    const clientPending = state.client_sign !== null && !state.client_sign.complete;

    // Хүсэгч + ERP-ээр зурсан ажилтнуудад.
    const events = await loadEvents(db, r.entry.id);
    const notifyIds = new Set<number>();
    if (request && request.requested_by !== a.me.id) notifyIds.add(request.requested_by);
    for (const e of events) if (e.action === 'sign' && e.result_modified_time && e.user_id !== a.me.id) notifyIds.add(e.user_id);
    const link = documentLink({ scope: scope.label, scope_id: a.root.project_id, parent_id: f.parentId, file_id: r.entry.id });
    for (const uid of notifyIds) {
      await createNotification(
        db,
        uid,
        'doc_sign_decided',
        clientPending ? `Манай тал баталлаа: ${r.entry.name}` : `Батлагдлаа: ${r.entry.name}`,
        clientPending
          ? `${fullDisplayName(a.me)} баталгаажуулж гарын үсэг зурлаа · захиалагчийн гарын үсэг хүлээгдэж байна · ${a.root.project_name}`
          : `${fullDisplayName(a.me)} баримтыг баталгаажуулж гарын үсэг зурлаа · ${a.root.project_name}`,
        link,
      );
    }
    return c.json(state);
  });

  /* ---------------------------------------------------------------- */
  /*  Хүсэлт / буцаах / цуцлах / хүсэх                                 */
  /* ---------------------------------------------------------------- */

  app.post('/:id/drive/files/:fileId/signing/request', async (c) => {
    noStore(c);
    const a = await access(c);
    if (!a.ok) return a.response;
    const body = (await c.req.json<{ note?: unknown }>().catch(() => ({}))) as { note?: unknown };
    const f = await loadFile(c, a.root.folder_id);
    if (!f.ok) return f.response;
    const ctx = { root: a.root, me: a.me, entry: f.entry, parentId: f.parentId };
    const approver = await loadApprover(c.env.DB);
    if (!approver) return shortError(c, 409, 'NO_APPROVER', 'Батлах захирал тохируулагдаагүй байна');
    if (approver.id === a.me.id) return shortError(c, 409, 'SELF_APPROVER', 'Та өөрөө баталгаажуулна');
    if (unsupportedOf(f.entry)) return shortError(c, 400, 'NOT_DOCX', 'Энэ файлд гарын үсэг зурах боломжгүй');
    if (await loadPendingRequest(c.env.DB, f.entry.id)) return shortError(c, 409, 'ALREADY_PENDING', 'Хүсэлт аль хэдийн илгээгдсэн');
    let slots: SignSlot[];
    try {
      const analyzed = await analyzeDocx(await io.download(c.env, f.entry.id));
      if (!analyzed.ok) return shortError(c, 400, 'NOT_DOCX', 'Word баримт уншигдсангүй');
      slots = analyzed.slots;
    } catch (err) {
      return io.errorResponse(c, err, `signing-request ${scope.label} file=${f.entry.id}`);
    }
    if (!slots.some((s) => s.approver && s.state === 'empty')) {
      return shortError(c, 409, 'NO_APPROVER_SLOT', 'Баримтад захирлын гарын үсгийн хоосон мөр алга');
    }
    const row = await openRequest(c, ctx, approver, cleanNote(body.note));
    if (!row) return shortError(c, 409, 'ALREADY_PENDING', 'Хүсэлт аль хэдийн илгээгдсэн');
    return c.json(await buildState(c, ctx, slots, null));
  });

  app.post('/:id/drive/files/:fileId/signing/return', async (c) => {
    noStore(c);
    const a = await access(c);
    if (!a.ok) return a.response;
    const approver = await loadApprover(c.env.DB);
    if (!approver || approver.id !== a.me.id) return shortError(c, 403, 'APPROVER_ONLY', 'Зөвхөн захирал буцаана');
    const body = (await c.req.json<{ note?: unknown }>().catch(() => ({}))) as { note?: unknown };
    const note = cleanNote(body.note);
    if (!note) return shortError(c, 400, 'NOTE_REQUIRED', 'Буцаах шалтгаанаа бичнэ үү');
    const f = await loadFile(c, a.root.folder_id);
    if (!f.ok) return f.response;
    const db = c.env.DB;
    const pending = await loadPendingRequest(db, f.entry.id);
    if (!pending) return shortError(c, 409, 'NOT_PENDING', 'Хүлээгдэж буй хүсэлт алга');
    await db
      .prepare(
        `UPDATE drive_doc_sign_requests
            SET status = 'returned', decided_by = ?, decided_at = ?, decision_note = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'pending'`,
      )
      .bind(a.me.id, new Date().toISOString(), note, pending.id)
      .run();
    const events = await loadEvents(db, f.entry.id);
    const notifyIds = new Set<number>([pending.requested_by]);
    for (const e of events) if (e.action === 'sign' && e.result_modified_time) notifyIds.add(e.user_id);
    notifyIds.delete(a.me.id);
    const link = documentLink({ scope: scope.label, scope_id: a.root.project_id, parent_id: f.parentId, file_id: f.entry.id });
    for (const uid of notifyIds) {
      await createNotification(db, uid, 'doc_sign_decided', `Буцаагдлаа: ${f.entry.name}`, `${fullDisplayName(a.me)}: ${note}`, link);
    }
    return c.json(await stateFromDrive(c, { root: a.root, me: a.me, entry: f.entry, parentId: f.parentId }));
  });

  app.post('/:id/drive/files/:fileId/signing/cancel', async (c) => {
    noStore(c);
    const a = await access(c);
    if (!a.ok) return a.response;
    const f = await loadFile(c, a.root.folder_id);
    if (!f.ok) return f.response;
    const db = c.env.DB;
    const pending = await loadPendingRequest(db, f.entry.id);
    if (!pending) return shortError(c, 409, 'NOT_PENDING', 'Хүлээгдэж буй хүсэлт алга');
    if (pending.requested_by !== a.me.id && a.me.role !== 'admin') {
      return shortError(c, 403, 'FORBIDDEN', 'Зөвхөн хүсэлт илгээсэн хүн цуцална');
    }
    await db
      .prepare(
        `UPDATE drive_doc_sign_requests SET status = 'cancelled', decided_by = ?, decided_at = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'pending'`,
      )
      .bind(a.me.id, new Date().toISOString(), pending.id)
      .run();
    return c.json(await stateFromDrive(c, { root: a.root, me: a.me, entry: f.entry, parentId: f.parentId }));
  });

  /** «Гарын үсэг хүсэх» — мөрийн нэртэй ганц ажилтанд мэдэгдэл; 30 минутад нэг удаа. */
  app.post('/:id/drive/files/:fileId/signing/ask', async (c) => {
    noStore(c);
    const a = await access(c);
    if (!a.ok) return a.response;
    const body = (await c.req.json<{ slot_key?: unknown }>().catch(() => ({}))) as { slot_key?: unknown };
    const slotKey = typeof body.slot_key === 'string' ? body.slot_key : '';
    if (!slotKey) return shortError(c, 400, 'BAD_REQUEST', 'slot_key шаардлагатай');
    const f = await loadFile(c, a.root.folder_id);
    if (!f.ok) return f.response;
    if (unsupportedOf(f.entry)) return shortError(c, 400, 'NOT_DOCX', 'Энэ файлд гарын үсэг зурах боломжгүй');
    let slots: SignSlot[];
    try {
      const analyzed = await analyzeDocx(await io.download(c.env, f.entry.id));
      if (!analyzed.ok) return shortError(c, 400, 'NOT_DOCX', 'Word баримт уншигдсангүй');
      slots = analyzed.slots;
    } catch (err) {
      return io.errorResponse(c, err, `signing-ask ${scope.label} file=${f.entry.id}`);
    }
    const slot = slots.find((s) => s.key === slotKey);
    if (!slot || slot.state !== 'empty' || slot.approver || slot.client) {
      return shortError(c, 409, 'SLOT_NOT_ASKABLE', 'Энэ мөрөнд гарын үсэг хүсэх боломжгүй');
    }
    const db = c.env.DB;
    const target = resolveNamedUser(slot.name, await loadStaff(db));
    if (!target || target.id === a.me.id) return shortError(c, 409, 'NO_TARGET', 'Мөрийн нэр ажилтантай тулгагдсангүй');
    const recent = await db
      .prepare(
        `SELECT id FROM drive_doc_sign_events
          WHERE file_id = ? AND action = 'ask' AND target_user_id = ? AND created_at > datetime('now', '-30 minutes') LIMIT 1`,
      )
      .bind(f.entry.id, target.id)
      .first<{ id: number }>();
    if (recent) return shortError(c, 429, 'ALREADY_ASKED', 'Энэ хүнд саяхан хүсэлт явуулсан байна');
    await db
      .prepare(
        `INSERT INTO drive_doc_sign_events
           (file_id, root_folder_id, scope, scope_id, file_name, action, user_id, target_user_id, slot_key, slot_role, slot_position, slot_name)
         VALUES (?, ?, ?, ?, ?, 'ask', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(f.entry.id, a.root.folder_id, scope.label, a.root.project_id, f.entry.name, a.me.id, target.id, slot.key, slot.role.slice(0, 200), slot.position.slice(0, 200), slot.name.slice(0, 200))
      .run();
    await createNotification(
      db,
      target.id,
      'doc_sign_requested',
      `Гарын үсэг зурна уу: ${f.entry.name}`,
      `${fullDisplayName(a.me)} таныг «${slot.role || 'гарын үсэг'}» мөрөнд гарын үсэг зурахыг хүслээ · ${a.root.project_name}`,
      documentLink({ scope: scope.label, scope_id: a.root.project_id, parent_id: f.parentId, file_id: f.entry.id }),
    );
    return c.json(await buildState(c, { root: a.root, me: a.me, entry: f.entry, parentId: f.parentId }, slots, null));
  });

  /** Буцаах/цуцлахын дараах төлөв — баримтыг дахин уншина (агуулга хөдлөөгүй). */
  async function stateFromDrive(
    c: AppContext,
    ctx: { root: ProjectDriveRoot; me: SignUser; entry: DriveEntry; parentId: string | null },
  ) {
    try {
      const analyzed = await analyzeDocx(await io.download(c.env, ctx.entry.id));
      return buildState(c, ctx, analyzed.ok ? analyzed.slots : [], analyzed.ok ? null : 'NOT_DOCX');
    } catch {
      return buildState(c, ctx, null, null);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Хавтасны жагсаалтын тэмдэг                                        */
  /* ---------------------------------------------------------------- */

  app.post('/:id/drive/signing/statuses', async (c) => {
    noStore(c);
    const a = await access(c);
    if (!a.ok) return a.response;
    const body = (await c.req.json<{ file_ids?: unknown }>().catch(() => ({}))) as { file_ids?: unknown };
    const ids = Array.isArray(body.file_ids) ? body.file_ids.filter((x): x is string => typeof x === 'string') : [];
    return c.json({ statuses: await statusesFor(c.env.DB, a.root.folder_id, ids) });
  });

  // Гаднын (login-гүй) гарын үсгийн link — ажилтны үүсгэх/жагсаах/цуцлах (0397).
  mountDriveSigningLinks(app, { label: scope.label, io, access, loadFile, unsupportedOf });
}

/** Баримтад зураг суулгадаг үйл явдал (ask — мэдэгдэл л). */
function isStampAction(action: string): boolean {
  return action === 'sign' || action === 'approve' || action === 'external';
}

/* ------------------------------------------------------------------ */
/*  /api/drive-signing — хүлээгдэж буй (самбарын мэдэгдэл)              */
/* ------------------------------------------------------------------ */

const driveSigning = new Hono<AppEnv>();

driveSigning.get('/pending', async (c) => {
  noStore(c);
  const user = c.get('user');
  if (!SIGNING_ROLES.has(user.role)) return c.json({ is_approver: false, approvals: [], asks: [] });
  const db = c.env.DB;
  const approver = await loadApprover(db);
  const isApprover = approver?.id === user.sub;
  const approvals = isApprover
    ? (
        await db
          .prepare(
            `SELECT r.id, r.file_id, r.file_name, r.scope, r.scope_id, r.parent_id, r.created_at, r.note,
                    u.full_name AS requested_by_name, u.username AS requested_by_username,
                    CASE r.scope WHEN 'main' THEN (SELECT name FROM main_projects WHERE id = r.scope_id)
                                 ELSE (SELECT name FROM projects WHERE id = r.scope_id) END AS project_name
               FROM drive_doc_sign_requests r
               LEFT JOIN users u ON u.id = r.requested_by
              WHERE r.approver_id = ? AND r.status = 'pending'
              ORDER BY r.id DESC LIMIT 50`,
          )
          .bind(user.sub)
          .all<{
            id: number;
            file_id: string;
            file_name: string;
            scope: string;
            scope_id: number;
            parent_id: string | null;
            created_at: string;
            note: string | null;
            requested_by_name: string | null;
            requested_by_username: string | null;
            project_name: string | null;
          }>()
      ).results.map((r) => ({
        id: r.id,
        file_id: r.file_id,
        file_name: r.file_name,
        project_name: r.project_name,
        requested_by: (r.requested_by_name ?? '').trim() || (r.requested_by_username ?? ''),
        created_at: r.created_at,
        note: r.note,
        link: documentLink(r),
      }))
    : [];
  // Надаас гарын үсэг хүссэн, түүнээс хойш би тэр баримтад зураагүй.
  const asks = (
    await db
      .prepare(
        `SELECT a.file_id, MAX(a.id) AS id, a.file_name, a.scope, a.scope_id, MAX(a.created_at) AS created_at,
                (SELECT full_name FROM users WHERE id = a.user_id) AS asked_by_name,
                CASE a.scope WHEN 'main' THEN (SELECT name FROM main_projects WHERE id = a.scope_id)
                             ELSE (SELECT name FROM projects WHERE id = a.scope_id) END AS project_name
           FROM drive_doc_sign_events a
          WHERE a.action = 'ask' AND a.target_user_id = ? AND a.created_at > datetime('now', '-30 days')
            AND NOT EXISTS (
              SELECT 1 FROM drive_doc_sign_events s
               WHERE s.file_id = a.file_id AND s.user_id = ? AND s.action IN ('sign', 'approve')
                 AND s.result_modified_time IS NOT NULL AND s.id > a.id)
          GROUP BY a.file_id
          ORDER BY id DESC LIMIT 20`,
      )
      .bind(user.sub, user.sub)
      .all<{
        file_id: string;
        id: number;
        file_name: string;
        scope: string;
        scope_id: number;
        created_at: string;
        asked_by_name: string | null;
        project_name: string | null;
      }>()
  ).results.map((r) => ({
    file_id: r.file_id,
    file_name: r.file_name,
    project_name: r.project_name,
    asked_by: r.asked_by_name ?? '',
    created_at: r.created_at,
    link: documentLink({ scope: r.scope, scope_id: r.scope_id, file_id: r.file_id }),
  }));
  return c.json({ is_approver: isApprover, approvals, asks });
});

export default driveSigning;
