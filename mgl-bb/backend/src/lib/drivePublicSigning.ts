/**
 * «Баримт бичиг» (Drive) Word баримтын ГАДНЫН гарын үсгийн link — ДҮРЭМ (цэвэр) +
 * D1 туслахууд (migration 0397).  Drive руу дуудахгүй: тэр нь route-ын `DriveSignIo`.
 *
 * Эзний хүсэлт (2026-10-12): захиалагч руу НЭГ link явуулна → утсаараа нээмэгц гарын
 * үсгийн хэсэг → зурмагц тэр гарын үсэг манай «Баримт бичиг»-ийн Drive дахь ЯГ тэр
 * файлд суугаад шинэ хувилбар болно; ажилтны цонх бодит цагаар шинэчлэгдэнэ.
 *
 * Төлөвийн машин:
 *   pending ──(зурж эхлэв: атом claim)──▶ signing ──(Drive-д бичигдэв)──▶ signed
 *      │                                    │ (алдаа → буцаад pending)
 *      ├──(ажилтан цуцлав / шинэ link)──▶ revoked
 *      └──(хугацаа)──────────────────────▶ expired
 * `signing` 3 минутаас хуучирвал (Worker унасан) дахин `pending` гэж тооцно.
 */
import { personNameMatches } from './docxSign';
import type { SignSlot } from './docxSign';

export type DriveLinkStatus = 'pending' | 'signing' | 'signed' | 'revoked' | 'expired';

export interface DriveLinkRow {
  id: number;
  token_hash: string;
  file_id: string;
  root_folder_id: string;
  scope: string;
  scope_id: number;
  parent_id: string | null;
  file_name: string;
  slot_key: string;
  slot_group: number;
  slot_role: string;
  slot_position: string;
  slot_name: string;
  slot_client: number;
  role_label: string;
  signer_name_hint: string | null;
  status: DriveLinkStatus;
  requested_by: number;
  expires_at: string;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  signing_started_at: string | null;
  signed_name: string | null;
  signed_position: string | null;
  signature_key: string | null;
  signature_sha256: string | null;
  sign_event_id: number | null;
  result_modified_time: string | null;
  document_snapshot_key: string | null;
  document_sha256: string | null;
  signed_at: string | null;
  signed_user_agent: string | null;
  revoked_at: string | null;
  revoked_by: number | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** `signing` төлөв ийм хугацаанаас хуучирвал гацсан гэж үзнэ (зурах нэг хүсэлт < 1 мин). */
export const SIGNING_STALE_MS = 3 * 60 * 1000;
/** Зурсан хүн гарын үсэгтэй баримтаа харах / татах хугацаа (снапшотоос). */
export const SIGNED_PREVIEW_MS = 7 * 24 * 60 * 60 * 1000;
/** «Яг одоо нээлттэй» — нүүр хуудас 20 сек тутам presence илгээдэг. */
export const PRESENCE_LIVE_MS = 60 * 1000;
/** Presence-ийн D1 бичилтийг сааруулна. */
export const PRESENCE_WRITE_EVERY_MS = 15 * 1000;

/** D1 `datetime('now')` («2026-10-12 00:36:16», UTC) эсвэл ISO → мс. */
export function timeMs(s: string | null | undefined): number {
  if (!s) return Number.NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
}

/**
 * Харагдах төлөв: хугацаа дууссан pending → expired, гацсан signing → pending.
 * DB-д бичигдсэн төлөвийг өөрчлөхгүй (тэр нь дуудагчийн ажил).
 */
export function effectiveStatus(
  row: Pick<DriveLinkRow, 'status' | 'expires_at' | 'signing_started_at'>,
  nowMs = Date.now(),
): DriveLinkStatus {
  if (row.status === 'signing') {
    const started = timeMs(row.signing_started_at);
    if (Number.isFinite(started) && nowMs - started < SIGNING_STALE_MS) return 'signing';
    // Гацсан — хугацаагаар нь pending/expired.
    return linkExpired(row.expires_at, nowMs) ? 'expired' : 'pending';
  }
  if (row.status === 'pending' && linkExpired(row.expires_at, nowMs)) return 'expired';
  return row.status;
}

export function linkExpired(expiresAt: string, nowMs = Date.now()): boolean {
  const ms = timeMs(expiresAt);
  return !Number.isFinite(ms) || ms <= nowMs;
}

/** «Хамт олон, Гарын үсэг: (Sign)» гэх мэт бичвэрийг харьцуулахад (зай, том жижиг үсэг). */
export function normText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('mn-MN');
}

/**
 * Link үүсгэсний дараа баримт засагдсан байж болно (ажилтан өөр мөрөнд зурсан = шинэ
 * хувилбар, эсвэл хэн нэгэн Word-оор мөр нэмсэн).  Зурахдаа мөрийг дахин тулгана:
 *   1) ижил түлхүүр + ижил үүргийн бичвэр (+ захиалагчийн тэмдэг) → тэр;
 *   2) эс бөгөөс үүрэг + албан тушаал + нэрээрээ ЯГ НЭГ мөр → тэр;
 *   3) олдохгүй / хоёрдмол → null (таамаглахгүй — ажилтан шинэ link үүсгэнэ).
 * Албан тушаал/нэр нь ЗӨВХӨН link-ийн хуулбарт бичигдсэн бол тулгана — хоосон байсан нүд
 * хооронд нь бөглөгдсөн байж болно.
 */
export function matchLinkSlot(
  slots: readonly SignSlot[],
  link: Pick<DriveLinkRow, 'slot_key' | 'slot_role' | 'slot_position' | 'slot_name' | 'slot_client'>,
): SignSlot | null {
  const role = normText(link.slot_role);
  const client = link.slot_client === 1;
  const same = (s: SignSlot) => normText(s.role) === role && s.client === client;
  const byKey = slots.find((s) => s.key === link.slot_key);
  if (byKey && same(byKey)) return byKey;
  const pos = normText(link.slot_position);
  const name = normText(link.slot_name);
  const hits = slots.filter(
    (s) => same(s) && (pos === '' || normText(s.position) === pos) && (name === '' || normText(s.name) === name),
  );
  return hits.length === 1 ? hits[0]! : null;
}

const DIRECTOR_POSITION_RE = /захирал|director|ceo/i;

/**
 * Гаднын link-ээр зурж болох мөр — хоосон, ба:
 *   • энгийн мөр (захиалагч, гүйцэтгэгч, зөвлөх …) — тийм;
 *   • «Батлах» мөр (`approver`) — манай захирлынх БИШ бол: өөр хүний нэр бичигдсэн
 *     (зөвлөхийн «Approved by: Э.Цогтбат»), эсвэл нэр ч албан тушаал ч хоосон (RFI-ийн
 *     захиалагчийн «Хариу» хэсгийн «Баталсан» — бодит MGL-RFI-MAK загварт хэмжсэн).
 *     Манай захирлын нэртэй, эсвэл нэргүй атлаа «Захирал» гэсэн мөрийг захирал ERP-д
 *     «Батлах»-аар л зурна.
 */
export function linkableSlot(
  slot: Pick<SignSlot, 'state' | 'approver' | 'name' | 'position'>,
  director: { full_name?: string | null; username?: string | null } | null,
): boolean {
  if (slot.state !== 'empty') return false;
  if (!slot.approver) return true;
  if (slot.name.trim()) return !director || !personNameMatches(slot.name, director);
  return !DIRECTOR_POSITION_RE.test(slot.position);
}

/** Зурагчид харагдах үүргийн шошгоны өгөгдмөл — баримтын мөрийн үүргээс. */
export function defaultRoleLabel(slot: Pick<SignSlot, 'role' | 'client'>): string {
  const role = slot.role.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[:：]\s*$/, '').replace(/\s+/g, ' ').trim();
  if (role) return role.slice(0, 120);
  return slot.client ? 'Захиалагч' : 'Гарын үсэг';
}

/**
 * Баримтын төрөл — файлын нэрээс (компанийн нэршлийн дүрэм `…_RFI_…`, `…-CR-…`).
 * Танихгүй бол ерөнхий «Word баримт».
 */
export function documentTypeOf(fileName: string): string {
  const n = fileName.toUpperCase();
  if (/(^|[^A-Z])RFI([^A-Z]|$)/.test(n)) return 'Мэдээлэл авах хүсэлт (RFI)';
  if (/(^|[^A-Z])CR([^A-Z]|$)/.test(n)) return 'Өөрчлөлтийн хүсэлт (CR)';
  if (/(^|[^A-Z])D?ASR([^A-Z]|$)/.test(n)) return 'Зохиогчийн хяналтын тайлан';
  return 'Word баримт';
}

/** «260930_EVGR_RFI_020.docx» → «260930_EVGR_RFI_020». */
export function documentTitleOf(fileName: string): string {
  return fileName.replace(/\.docx$/i, '').trim() || fileName;
}

/** Зурагч бичсэн албан тушаал — нэг мөр, 120 тэмдэгт. */
export function cleanPosition(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, 120) : null;
}

/**
 * Мөрөнд нэр урьдчилан бичигдсэн бол зурагчийн бичсэн нэр тэр хүнийх мөн эсэх.
 * Эс таарах нь хориг БИШ (баримт дээр нэр буруу бичигдсэн байж болно) — UI анхааруулга.
 */
export function signerMatchesSlotName(slotName: string, typed: string): boolean {
  if (!slotName.trim()) return true;
  return personNameMatches(slotName, { full_name: typed });
}

/** Зурагчийн «Alt text» — `parseErpDescr`-тэй нийцтэй («MGL ERP · нэр · … · ISO»). */
export function externalDescr(name: string, roleLabel: string, iso: string): string {
  return `MGL ERP · ${name} · Гаднын link · ${roleLabel} · ${iso}`;
}

/* ------------------------------------------------------------------ */
/*  D1                                                                   */
/* ------------------------------------------------------------------ */

export async function linkByTokenHash(db: D1Database, hash: string): Promise<DriveLinkRow | null> {
  return db.prepare('SELECT * FROM drive_doc_public_links WHERE token_hash = ? LIMIT 1').bind(hash).first<DriveLinkRow>();
}

export async function linkById(db: D1Database, id: number): Promise<DriveLinkRow | null> {
  return db.prepare('SELECT * FROM drive_doc_public_links WHERE id = ?').bind(id).first<DriveLinkRow>();
}

/** DB-д бичигдсэн хуучирсан төлөвийг (хугацаа дууссан pending, гацсан signing) засна. */
export async function settleStatus(db: D1Database, row: DriveLinkRow, nowMs = Date.now()): Promise<DriveLinkRow> {
  const eff = effectiveStatus(row, nowMs);
  if (eff === row.status) return row;
  if (eff === 'expired') {
    await db
      .prepare(
        `UPDATE drive_doc_public_links SET status = 'expired', updated_at = datetime('now')
          WHERE id = ? AND status IN ('pending', 'signing')`,
      )
      .bind(row.id)
      .run();
  } else if (eff === 'pending' && row.status === 'signing') {
    await db
      .prepare(
        `UPDATE drive_doc_public_links SET status = 'pending', signing_started_at = NULL, updated_at = datetime('now')
          WHERE id = ? AND status = 'signing' AND signing_started_at = ?`,
      )
      .bind(row.id, row.signing_started_at)
      .run();
  }
  return { ...row, status: eff, signing_started_at: eff === 'pending' ? null : row.signing_started_at };
}

/** Link-ийг хаана (`pending`-ийг л — зурж буй link хөндөгдөхгүй). */
export async function revokeLink(
  db: D1Database,
  id: number,
  by: number | null,
  reason: string,
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE drive_doc_public_links
          SET status = 'revoked', revoked_at = datetime('now'), revoked_by = ?, revoke_reason = ?,
              updated_at = datetime('now')
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(by, reason.slice(0, 200), id)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** Ажилтны цонхонд харагдах link-ийн хэлбэр (токен, hash ХЭЗЭЭ Ч гарахгүй). */
export interface DriveLinkView {
  id: number;
  slot_key: string;
  slot_role: string;
  slot_name: string;
  slot_client: boolean;
  role_label: string;
  signer_name_hint: string | null;
  status: DriveLinkStatus;
  requested_by: number;
  requested_by_name: string | null;
  expires_at: string;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  /** Зурагчийн хуудас яг одоо нээлттэй (сүүлийн 60 сек-д presence). */
  viewing_now: boolean;
  signed_name: string | null;
  signed_position: string | null;
  signed_at: string | null;
  snapshot_ready: boolean;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export function linkView(
  row: DriveLinkRow & { requested_by_name?: string | null },
  nowMs = Date.now(),
): DriveLinkView {
  const status = effectiveStatus(row, nowMs);
  const seen = timeMs(row.last_viewed_at);
  return {
    id: row.id,
    slot_key: row.slot_key,
    slot_role: row.slot_role,
    slot_name: row.slot_name,
    slot_client: row.slot_client === 1,
    role_label: row.role_label,
    signer_name_hint: row.signer_name_hint,
    status,
    requested_by: row.requested_by,
    requested_by_name: row.requested_by_name ?? null,
    expires_at: row.expires_at,
    first_viewed_at: row.first_viewed_at,
    last_viewed_at: row.last_viewed_at,
    viewing_now:
      (status === 'pending' || status === 'signing') && Number.isFinite(seen) && nowMs - seen < PRESENCE_LIVE_MS,
    signed_name: row.signed_name,
    signed_position: row.signed_position,
    signed_at: row.signed_at,
    snapshot_ready: !!row.document_snapshot_key,
    revoked_at: row.revoked_at,
    revoke_reason: row.revoke_reason,
    created_at: row.created_at,
  };
}

/**
 * Ажилтны цонхны бодит цагийн «хувилбар» — энэ файлд хамгийн сүүлд Drive-д бичигдсэн
 * гарын үсгийн үйл явдал (ажилтан, захирал, гаднын link бүгд).  Өөрчлөгдвөл цонх
 * баримтыг дахин ачаална.  Зөвхөн D1, Drive руу дуудахгүй.
 */
export async function signingVersion(db: D1Database, fileId: string, rootId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(id), 0) AS v FROM drive_doc_sign_events
        WHERE file_id = ? AND root_folder_id = ? AND result_modified_time IS NOT NULL`,
    )
    .bind(fileId, rootId)
    .first<{ v: number }>();
  return Number(row?.v ?? 0);
}

/* ------------------------------------------------------------------ */
/*  PDF рендерлэгчийн түр эрх                                            */
/* ------------------------------------------------------------------ */

/**
 * Гарын үсэг зурсны дараа захиалагч файлаа ЗӨВХӨН PDF-ээр хардаг (эзний шийдвэр 2026-10-12 —
 * засварлаж болох .docx түүнд очихгүй).  PDF-ийг сервер Browser Rendering-ээр `/sign/:token/print`
 * хуудаснаас үүсгэдэг — тэр хуудас .docx-ийн эх байтыг авах ёстой.  Bearer токен ганцаараа эх
 * байтыг ӨГӨХГҮЙ: рендерлэгчид л өгөх богино хугацааны HMAC эрх (`<exp>.<hex>`), JWT_SECRET-ээр,
 * link-ийн id-д уяатай.  Захиалагчийн хөтөч хэзээ ч энэ эрхийг харахгүй.
 */
export const RENDER_GRANT_TTL_MS = 3 * 60 * 1000;

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function renderGrant(secret: string, linkId: number, nowMs = Date.now()): Promise<string> {
  const exp = nowMs + RENDER_GRANT_TTL_MS;
  return `${exp}.${await hmacHex(secret, `drive-sign-render:${linkId}:${exp}`)}`;
}

export async function verifyRenderGrant(secret: string, linkId: number, grant: string | undefined, nowMs = Date.now()): Promise<boolean> {
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(grant ?? '');
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp <= nowMs || exp > nowMs + RENDER_GRANT_TTL_MS + 60_000) return false;
  const want = await hmacHex(secret, `drive-sign-render:${linkId}:${exp}`);
  // Тогтмол хугацаат харьцуулалт.
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ m[2]!.charCodeAt(i);
  return diff === 0;
}

/** Гарын үсэгтэй баримтын PDF-ийн кэш (хувийн bucket) — link бүрд нэг, зурагдсаны дараа өөрчлөгдөхгүй. */
export function signedPdfKey(linkId: number): string {
  return `public-signing/drive/link-${linkId}-signed.pdf`;
}

/** «260930_EVGR_RFI_020.docx» → «260930_EVGR_RFI_020.pdf». */
export function pdfFileName(fileName: string): string {
  return `${fileName.replace(/\.docx$/i, '').trim() || 'document'}.pdf`;
}
