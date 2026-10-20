/**
 * «Баримт бичиг» (Drive) дээрх Word баримтын гарын үсэг ба захирлын
 * баталгаажуулалт — ДҮРЭМ (цэвэр) + D1 уншилт/бичилт.  Drive руу
 * дуудахгүй: тэр нь `routes/driveSigning.ts`-ийн `DriveSignIo`.
 *
 * Эзний хүсэлт (2026-10-01): «RFI-г ажилтнууд гарын үсгээ зурсны дараа
 * захирал хараад нэг товчоор баталгаажуулна; профайлын гарын үсгийг шууд».
 *
 * Хэн аль мөрөнд зурах вэ (`slotDecision`):
 *   • Захирлын мөр (`approver`) — ЗӨВХӨН батлагч (`ceoUserId()`, MGL-д
 *     Бат-Өлзий Билгүүн), мөрөнд өөр хүний нэр бичигдсэн бол хэн ч биш.
 *   • Бусад мөр — ажилтан (`SIGNING_ROLES`) өөрийн нэр бичигдсэн эсвэл нэр
 *     хоосон мөрөнд; өөр хүний нэртэй мөрөнд зөвхөн ил баталгаажуулалттай
 *     («Энэ мөр минийх» — баримт дээр нэр буруу бичигдсэн тохиолдол).
 *   • Аль ч мөрөнд гарын үсэг (зураг) аль хэдийн байвал — хэн ч дарж зурахгүй.
 *   • Захиалагчийн мөр («Захиалагчаас баталсан» — CR загвар) — ERP-д хэн ч зурахгүй.
 */
import { ceoUserId } from './ceo';
import { parseErpDescr, personNameMatches, shortPersonName, type SignSlot } from './docxSign';
import {
  clientSignState,
  parseClientSlots,
  slotsFromLinks,
  type ClientLinkRow,
  type ClientSignSlot,
  type ClientSignState,
} from './driveClientSign';

/** «Баримт бичиг»-ийн ажилтны эрх — `routes/projectDrive.ts` `DRIVE_ROLES`-ийн ИХЭР
 *  (тэр файлыг `node --test` ачаалж чаддаггүй тул энд давтав — хамт өөрчлөгдөнө). */
export const SIGNING_ROLES: ReadonlySet<string> = new Set(['admin', 'senior', 'engineer', 'architect']);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Гарын үсэг суулгаж болох файл: жинхэнэ .docx (Google-ийн формат, товчлол, хавтас биш).
 *  Хөтөч MIME өгөөгүй байршуулсан .docx Drive дээр octet-stream байж болно — өргөтгөлөөр. */
export function isSignableDocx(entry: { name: string; mimeType: string }): boolean {
  if (entry.mimeType === DOCX_MIME) return true;
  return entry.mimeType === 'application/octet-stream' && /\.docx$/i.test(entry.name);
}

/** external = гаднын (login-гүй) link-ээр зурсан (0397) — `user_id` нь link илгээсэн ажилтан. */
export type SignAction = 'sign' | 'approve' | 'ask' | 'external';
export type RequestStatus = 'pending' | 'approved' | 'returned' | 'cancelled';

export interface SignUser {
  id: number;
  username: string | null;
  full_name: string | null;
  role: string;
  position: string | null;
  status: string;
  signature_url: string | null;
}

export interface EventRow {
  id: number;
  file_id: string;
  root_folder_id: string;
  scope: string;
  scope_id: number;
  file_name: string;
  action: SignAction;
  user_id: number;
  target_user_id: number | null;
  slot_key: string | null;
  slot_role: string | null;
  slot_position: string | null;
  slot_name: string | null;
  approver_slot: number;
  name_override: number;
  docx_mark: string | null;
  filled_json: string | null;
  signature_key: string | null;
  signature_sha256: string | null;
  base_modified_time: string | null;
  result_modified_time: string | null;
  result_md5: string | null;
  request_id: number | null;
  /** 0397: гаднын link-ээр зурсан хүний бичсэн нэр (миграцаас өмнө undefined). */
  external_signer_name?: string | null;
  public_link_id?: number | null;
  created_at: string;
}

export interface RequestRow {
  id: number;
  file_id: string;
  root_folder_id: string;
  scope: string;
  scope_id: number;
  parent_id: string | null;
  file_name: string;
  status: RequestStatus;
  requested_by: number;
  approver_id: number;
  note: string | null;
  decided_by: number | null;
  decided_at: string | null;
  decision_note: string | null;
  approve_event_id: number | null;
  created_at: string;
  updated_at: string;
}

const USER_COLS = 'id, username, full_name, role, position, status, signature_url';

/* ------------------------------------------------------------------ */
/*  Хүмүүс                                                              */
/* ------------------------------------------------------------------ */

/** Баримт дээрх хүний нэр («Б.Билгүүн») — `full_name`-ээс, байхгүй бол username. */
export function docDisplayName(u: Pick<SignUser, 'full_name' | 'username'>): string {
  const full = (u.full_name ?? '').trim();
  return full ? shortPersonName(full) : (u.username ?? '').trim();
}

/** UI-д харуулах бүтэн нэр. */
export function fullDisplayName(u: Pick<SignUser, 'full_name' | 'username'> | null | undefined): string {
  if (!u) return '';
  return (u.full_name ?? '').trim() || (u.username ?? '').trim();
}

/**
 * Батлагч (захирал): `ceoUserId()` (MGL — id 2) идэвхтэй бол тэр; тохируулаагүй
 * компанид албан тушаал нь «захирал/director» гэсэн ганц идэвхтэй admin.
 */
export async function loadApprover(db: D1Database): Promise<SignUser | null> {
  const ceo = ceoUserId();
  if (ceo !== null) {
    const row = await db
      .prepare(`SELECT ${USER_COLS} FROM users WHERE id = ? AND status = 'active'`)
      .bind(ceo)
      .first<SignUser>();
    if (row) return row;
  }
  const rows = await db
    .prepare(
      `SELECT ${USER_COLS} FROM users
        WHERE status = 'active' AND role = 'admin'
          AND (instr(lower(coalesce(position, '')), 'захирал') > 0 OR instr(lower(coalesce(position, '')), 'director') > 0)
        ORDER BY id LIMIT 2`,
    )
    .all<SignUser>();
  return rows.results.length === 1 ? rows.results[0]! : null;
}

export async function loadUser(db: D1Database, id: number): Promise<SignUser | null> {
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).bind(id).first<SignUser>();
}

/** «Гарын үсэг хүсэх» — баримт дээрх нэрийг ганц идэвхтэй ажилтантай тулгана. */
export async function loadStaff(db: D1Database): Promise<SignUser[]> {
  const rows = await db
    .prepare(
      `SELECT ${USER_COLS} FROM users
        WHERE status = 'active' AND role IN ('admin', 'senior', 'engineer', 'architect')`,
    )
    .all<SignUser>();
  return rows.results;
}

/** Нэр ЯГ НЭГ ажилтанд таарвал тэр; олон эсвэл байхгүй бол null (таамаглахгүй). */
export function resolveNamedUser(name: string, staff: readonly SignUser[]): SignUser | null {
  if (!name.trim()) return null;
  const hits = staff.filter((u) => personNameMatches(name, u));
  return hits.length === 1 ? hits[0]! : null;
}

/* ------------------------------------------------------------------ */
/*  Хэн аль мөрөнд                                                      */
/* ------------------------------------------------------------------ */

export type SlotReason = 'OK' | 'NOT_EMPTY' | 'APPROVER_ONLY' | 'NAME_MISMATCH' | 'ROLE' | 'CLIENT';

export interface SlotDecision {
  canSign: boolean;
  reason: SlotReason;
  /** Өөр хүний нэртэй мөр — зурахын өмнө ил баталгаажуулалт. */
  needsNameConfirm: boolean;
  /** Мөрөнд энэ хүний нэр бичигдсэн. */
  mine: boolean;
}

export function slotDecision(
  slot: Pick<SignSlot, 'state' | 'approver' | 'name'> & Partial<Pick<SignSlot, 'client'>>,
  me: Pick<SignUser, 'role' | 'full_name' | 'username'>,
  isApprover: boolean,
): SlotDecision {
  const named = slot.name.trim() !== '';
  const mine = named && personNameMatches(slot.name, me);
  if (slot.state !== 'empty') return { canSign: false, reason: 'NOT_EMPTY', needsNameConfirm: false, mine };
  if (!SIGNING_ROLES.has(me.role)) return { canSign: false, reason: 'ROLE', needsNameConfirm: false, mine };
  // Захиалагчийн мөр — ажилтан (захирал ч) захиалагчийн өмнөөс зурахгүй.
  if (slot.client) return { canSign: false, reason: 'CLIENT', needsNameConfirm: false, mine };
  if (slot.approver) {
    if (!isApprover) return { canSign: false, reason: 'APPROVER_ONLY', needsNameConfirm: false, mine };
    if (named && !mine) return { canSign: false, reason: 'NAME_MISMATCH', needsNameConfirm: false, mine };
    return { canSign: true, reason: 'OK', needsNameConfirm: false, mine };
  }
  if (named && !mine) return { canSign: true, reason: 'OK', needsNameConfirm: true, mine };
  return { canSign: true, reason: 'OK', needsNameConfirm: false, mine };
}

/**
 * Захирлын «Батлах» товчны мөр: хоосон, захирлын нэртэй (эсвэл нэргүй) батлах
 * мөрүүдээс ажилтны гарын үсэг аль хэдийн байгаа бүлгийнхийг (RFI-ийн хоёр
 * хэсэг — хүсэлт / хариу — тус бүр «Хянасан/Баталсан» мөртэй байж болно), эс
 * бөгөөс нэр нь бөглөгдсөн мөр олонтой бүлгийнхийг сонгоно.  Ганц ч биш бол null.
 */
export function pickApproverSlot(
  slots: readonly SignSlot[],
  approver: Pick<SignUser, 'full_name' | 'username'>,
): SignSlot | null {
  const candidates = slots.filter(
    (s) => s.approver && s.state === 'empty' && (s.name.trim() === '' || personNameMatches(s.name, approver)),
  );
  if (candidates.length <= 1) return candidates[0] ?? null;
  const named = candidates.filter((s) => s.name.trim() !== '');
  if (named.length === 1) return named[0]!;
  const score = (s: SignSlot) => {
    const peers = slots.filter((p) => p.group === s.group && !p.approver);
    const signed = peers.filter((p) => p.state !== 'empty').length;
    const filled = peers.filter((p) => p.name.trim() !== '').length;
    return signed * 100 + filled;
  };
  const ranked = [...(named.length > 0 ? named : candidates)].sort((a, b) => score(b) - score(a));
  return score(ranked[0]!) > score(ranked[1]!) ? ranked[0]! : null;
}

/** D1 `datetime('now')` («2026-10-12 00:36:16», UTC) → мс. */
function sqliteUtcMs(s: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
}

/**
 * Тэмдэггүй ERP гарын үсэг (Google дахин хадгалахад `mgl-sign-…` нэр устсан) — `descr`-ийн
 * нэр + агшнаар үйл явдлыг олно: ижил нэртэй хүний зурсан/баталсан, агшин нь ±2 минут.
 * Таарахгүй бол undefined (UI «Системээр зурсан» л гэнэ — таамаглахгүй).
 */
export function eventForDescr(
  events: readonly EventRow[],
  descr: string,
  people: ReadonlyMap<number, Pick<SignUser, 'full_name' | 'username'>>,
): EventRow | undefined {
  const info = parseErpDescr(descr);
  if (!info) return undefined;
  const at = Date.parse(info.at);
  return events.find((e) => {
    if ((e.action !== 'sign' && e.action !== 'approve' && e.action !== 'external') || !e.result_modified_time) return false;
    if (Math.abs(sqliteUtcMs(e.created_at) - at) > 120_000) return false;
    // Гаднын link: descr-ийн нэр нь зурсан хүний бичсэн нэр (ажилтан биш).
    if (e.action === 'external') return (e.external_signer_name ?? '').trim() === info.name;
    const u = people.get(e.user_id);
    return !!u && fullDisplayName(u) === info.name;
  });
}

/* ------------------------------------------------------------------ */
/*  D1                                                                   */
/* ------------------------------------------------------------------ */

export async function loadEvents(db: D1Database, fileId: string): Promise<EventRow[]> {
  const rows = await db
    .prepare('SELECT * FROM drive_doc_sign_events WHERE file_id = ? ORDER BY id DESC LIMIT 200')
    .bind(fileId)
    .all<EventRow>();
  return rows.results;
}

export async function loadLatestRequest(db: D1Database, fileId: string): Promise<RequestRow | null> {
  return db
    .prepare('SELECT * FROM drive_doc_sign_requests WHERE file_id = ? ORDER BY id DESC LIMIT 1')
    .bind(fileId)
    .first<RequestRow>();
}

export async function loadPendingRequest(db: D1Database, fileId: string): Promise<RequestRow | null> {
  return db
    .prepare("SELECT * FROM drive_doc_sign_requests WHERE file_id = ? AND status = 'pending' LIMIT 1")
    .bind(fileId)
    .first<RequestRow>();
}

const LOCK_STALE_SECONDS = 90;

/**
 * Нэг файлд зэрэг зурахаас сэргийлэх түгжээ: Drive-аас татсан байт дээр
 * суулгаад буцааж байршуулах хооронд өөр хүн зурвал түүний гарын үсэг
 * дарагдах байсан.  90 секундээс хуучин түгжээг дахин авна (унасан хүсэлт).
 */
export async function acquireLock(db: D1Database, fileId: string, userId: number): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - LOCK_STALE_SECONDS * 1000).toISOString();
  const res = await db
    .prepare(
      `INSERT INTO drive_doc_sign_locks (file_id, user_id, token, locked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(file_id) DO UPDATE SET user_id = excluded.user_id, token = excluded.token, locked_at = excluded.locked_at
        WHERE drive_doc_sign_locks.locked_at < ?`,
    )
    .bind(fileId, userId, token, now, stale)
    .run();
  if (!res.meta.changes) return null;
  // ON CONFLICT … WHERE нь өөрчлөлтгүй үед ч changes=0 — дээрх шалгалт хангалттай,
  // гэхдээ зэрэг хоёр стейл авалтын ялагчийг токеноор батална.
  const row = await db
    .prepare('SELECT token FROM drive_doc_sign_locks WHERE file_id = ?')
    .bind(fileId)
    .first<{ token: string }>();
  return row?.token === token ? token : null;
}

export async function releaseLock(db: D1Database, fileId: string, token: string): Promise<void> {
  await db.prepare('DELETE FROM drive_doc_sign_locks WHERE file_id = ? AND token = ?').bind(fileId, token).run();
}

export interface FileSignStatus {
  /** Хамгийн сүүлийн хүсэлтийн төлөв; хүсэлтгүй бол null. */
  request_status: RequestStatus | null;
  /** ERP-ээр зурсан гарын үсгийн тоо (sign + approve + гаднын link). */
  signatures: number;
  last_signed_at: string | null;
  /** Хүлээгдэж буй гаднын гарын үсгийн link-ийн тоо (0397). */
  links_pending: number;
  /** Захиалагчийн гарын үсгийн төлөв (`lib/driveClientSign.ts`); мэдэгдэхгүй бол null. */
  client: ClientSignState | null;
}

/* ------------------------------------------------------------------ */
/*  Захиалагчийн гарын үсэг (2026-10-19)                                */
/* ------------------------------------------------------------------ */

/** Баримтад гаднын link-ээр зурсан мөрүүд — тэмдгээр, эсвэл (Google тэмдгийг устгасан бол) descr-ээр. */
export function externalSlotKeys(slots: readonly SignSlot[], events: readonly EventRow[]): Set<string> {
  const byMark = new Map<string, EventRow>();
  for (const e of events) {
    if (e.docx_mark && e.result_modified_time && !byMark.has(e.docx_mark)) byMark.set(e.docx_mark, e);
  }
  const out = new Set<string>();
  for (const s of slots) {
    if (s.state !== 'erp') continue;
    const ev = s.mark ? byMark.get(s.mark) : s.erpDescr ? eventForDescr(events, s.erpDescr, new Map()) : undefined;
    if (ev?.action === 'external') out.add(s.key);
  }
  return out;
}

export function clientSlotsOf(slots: readonly SignSlot[], externalKeys: ReadonlySet<string>): ClientSignSlot[] {
  return slots.map((s) => ({ key: s.key, client: s.client, state: s.state, external: externalKeys.has(s.key) }));
}

/** Зурсан + амьд гаднын link-ууд (захиалагчийн талын мөрийг тодорхойлно).  0397-гүй орчинд хоосон. */
export async function loadClientLinks(db: D1Database, fileIds: readonly string[], rootId: string): Promise<Array<ClientLinkRow & { file_id: string; file_name: string }>> {
  if (fileIds.length === 0) return [];
  try {
    const rows = await db
      .prepare(
        `SELECT id, file_id, file_name, slot_key, slot_client, status FROM drive_doc_public_links
          WHERE root_folder_id = ? AND file_id IN (SELECT value FROM json_each(?))
            AND (status = 'signed' OR (status IN ('pending', 'signing') AND expires_at > ?))
          ORDER BY id`,
      )
      .bind(rootId, JSON.stringify(fileIds), new Date().toISOString())
      .all<ClientLinkRow & { file_id: string; file_name: string }>();
    return rows.results;
  } catch (err) {
    console.error('[drive-signing] client links', err);
    return [];
  }
}

/**
 * Баримтын мөрүүдийг уншсан бүрд — захиалагчийн төлөвийг тооцож D1-ийн хураангуйг
 * (`drive_doc_sign_summaries`, 0415) шинэчилнэ.  Хадгалалт унавал төлөв буцсаар (жагсаалт л
 * ойролцоо болно) — гарын үсэг зурах урсгалыг ХЭЗЭЭ Ч унагахгүй.
 */
export async function refreshClientSummary(
  db: D1Database,
  ctx: { fileId: string; rootId: string; fileName: string; slots: readonly SignSlot[]; events: readonly EventRow[]; modifiedTime: string | null },
): Promise<ClientSignState> {
  const lite = clientSlotsOf(ctx.slots, externalSlotKeys(ctx.slots, ctx.events));
  const links = await loadClientLinks(db, [ctx.fileId], ctx.rootId);
  const state = clientSignState(lite, { fileName: ctx.fileName, linkKeys: new Set(links.map((l) => l.slot_key)) });
  const json = JSON.stringify(lite);
  try {
    await db
      .prepare(
        `INSERT INTO drive_doc_sign_summaries (file_id, root_folder_id, file_name, slots_json, doc_modified_time, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(file_id) DO UPDATE SET
           root_folder_id = excluded.root_folder_id, file_name = excluded.file_name, slots_json = excluded.slots_json,
           doc_modified_time = excluded.doc_modified_time, updated_at = excluded.updated_at
          WHERE drive_doc_sign_summaries.slots_json IS NOT excluded.slots_json
             OR drive_doc_sign_summaries.file_name IS NOT excluded.file_name
             OR drive_doc_sign_summaries.root_folder_id IS NOT excluded.root_folder_id
             OR drive_doc_sign_summaries.doc_modified_time IS NOT excluded.doc_modified_time`,
      )
      .bind(ctx.fileId, ctx.rootId, ctx.fileName.slice(0, 500), json, ctx.modifiedTime)
      .run();
  } catch (err) {
    console.error('[drive-signing] client summary', ctx.fileId, err);
  }
  return state;
}

/** Хавтасны жагсаалтын тэмдэг — Drive руу дуудахгүй, зөвхөн D1. */
export async function statusesFor(
  db: D1Database,
  rootId: string,
  fileIds: readonly string[],
): Promise<Record<string, FileSignStatus>> {
  const ids = [...new Set(fileIds.filter((x) => /^[A-Za-z0-9_-]{10,}$/.test(x)))].slice(0, 300);
  const out: Record<string, FileSignStatus> = {};
  if (ids.length === 0) return out;
  const json = JSON.stringify(ids);
  const [ev, rq, links] = await Promise.all([
    db
      .prepare(
        `SELECT file_id, COUNT(*) AS n, MAX(created_at) AS last_at
           FROM drive_doc_sign_events
          WHERE root_folder_id = ? AND action IN ('sign', 'approve', 'external') AND result_modified_time IS NOT NULL
            AND file_id IN (SELECT value FROM json_each(?))
          GROUP BY file_id`,
      )
      .bind(rootId, json)
      .all<{ file_id: string; n: number; last_at: string }>(),
    db
      .prepare(
        `SELECT r.file_id, r.status, r.file_name FROM drive_doc_sign_requests r
          WHERE r.root_folder_id = ? AND r.file_id IN (SELECT value FROM json_each(?))
            AND r.id = (SELECT MAX(r2.id) FROM drive_doc_sign_requests r2 WHERE r2.file_id = r.file_id)`,
      )
      .bind(rootId, json)
      .all<{ file_id: string; status: RequestStatus; file_name: string }>(),
    // Гаднын link (0397) — хүснэгт хараахан үүсээгүй орчинд хоосон, жагсаалт унахгүй.
    loadClientLinks(db, ids, rootId),
  ]);
  // Хураангуй (0415) — миграцаас өмнөх орчинд хоосон.
  let summaries: Array<{ file_id: string; file_name: string; slots_json: string }> = [];
  try {
    summaries = (
      await db
        .prepare(
          `SELECT file_id, file_name, slots_json FROM drive_doc_sign_summaries
            WHERE root_folder_id = ? AND file_id IN (SELECT value FROM json_each(?))`,
        )
        .bind(rootId, json)
        .all<{ file_id: string; file_name: string; slots_json: string }>()
    ).results;
  } catch (err) {
    console.error('[drive-signing] summaries', err);
  }

  const empty = (): FileSignStatus => ({ request_status: null, signatures: 0, last_signed_at: null, links_pending: 0, client: null });
  for (const r of ev.results) out[r.file_id] = { ...empty(), signatures: r.n, last_signed_at: r.last_at };
  const names = new Map<string, string>();
  for (const r of rq.results) {
    const cur = out[r.file_id] ?? empty();
    cur.request_status = r.status;
    out[r.file_id] = cur;
    names.set(r.file_id, r.file_name);
  }
  const linksByFile = new Map<string, typeof links>();
  for (const l of links) {
    linksByFile.set(l.file_id, [...(linksByFile.get(l.file_id) ?? []), l]);
    if (!names.has(l.file_id)) names.set(l.file_id, l.file_name);
    if (l.status !== 'signed') {
      const cur = out[l.file_id] ?? empty();
      cur.links_pending += 1;
      out[l.file_id] = cur;
    }
  }
  const summaryOf = new Map(summaries.map((s) => [s.file_id, s]));
  for (const [fileId, cur] of Object.entries(out)) {
    const fileLinks = linksByFile.get(fileId) ?? [];
    const linkKeys = new Set(fileLinks.map((l) => l.slot_key));
    const sum = summaryOf.get(fileId);
    const slots = sum ? parseClientSlots(sum.slots_json) : null;
    cur.client = slots
      ? clientSignState(slots, { fileName: sum!.file_name, linkKeys })
      : // Хураангуйгүй (самбарыг энэ өөрчлөлтөөс хойш нээгээгүй) — гаднын link-ээс ойролцоолно.
        clientSignState(slotsFromLinks(fileLinks), {
          fileName: names.get(fileId) ?? '',
          linkKeys: new Set(fileLinks.filter((l) => l.status !== 'signed').map((l) => l.slot_key)),
        });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Холбоос, бичвэр                                                     */
/* ------------------------------------------------------------------ */

/** Мэдэгдлийн холбоос — «Баримт бичиг» хуудас, тэр хавтас, тэр файл нээгдэнэ. */
export function documentLink(r: { scope: string; scope_id: number; parent_id?: string | null; file_id: string }): string {
  const qs = new URLSearchParams();
  if (r.parent_id) qs.set('folder', r.parent_id);
  qs.set('file', r.file_id);
  qs.set('sign', '1');
  const scope = r.scope === 'main' ? 'main' : 'project';
  return `/app/documents/${scope}/${r.scope_id}?${qs.toString()}`;
}

/** Хүсэлт/шийдвэрийн тэмдэглэл — хоосон зай цэвэрлэж, 1000 тэмдэгтээр таслана. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, 1000) : null;
}

/** Drive-ын `modifiedTime`-ууд — ISO мөр; харьцуулалт мс-ээр. */
export function isLaterThan(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta > tb;
}
