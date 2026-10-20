// Revit-ийн автомат цаг бүртгэлийн ЦЭВЭР дүрэм (migration 0360).
//
// Энд D1, Hono байхгүй — `revitTracking.test.ts` шууд ачаална.  Клиентийн ихэр:
// `revit-mcp/addin/WorkTracking/Core/*` (төлөвийн нэр, ID хэлбэр, MAX семантик).
//
// Хэмжиж буй зүйл: «ажилтны ОДООГИЙН ERP таск дээр Revit-д ИДЭВХТЭЙ
// ажилласан хугацаа».  Хүний бүх бүтээмж БИШ.

/** Клиентийн илгээх төлөвүүд (`TrackStateWire`-ийн ихэр). */
export const CLIENT_STATES = [
  'working',
  'idle',
  'background',
  'no_task',
  'no_document',
  'suspended',
  'signed_out',
] as const;
export type ClientState = (typeof CLIENT_STATES)[number];

/** Админы харагдацын төлөв (эзний Session 5-ын нэрс). */
export type LiveStatus = 'working' | 'idle' | 'online_no_task' | 'offline';

/**
 * Heartbeat тасарснаас хойш OFFLINE болох хугацаа.  Клиент 10 с тутам
 * илгээдэг (`TrackingPolicy.SyncInterval`) тул 4 удаа алдсаны дараа — сүлжээний
 * түр саатал «offline» гэж анивчихгүй, унасан Revit ч удаан «ажиллаж байна»
 * гэж үлдэхгүй.
 */
export const STALE_AFTER_MS = 45_000;

/** Нэг хүсэлтэд хүлээж авах сегментийн дээд тоо (клиент `MaxSegmentsPerSync`). */
export const MAX_SEGMENTS_PER_SYNC = 200;

/** Нэг сегментийн нэг баганын дээд утга — нэг өдөр. */
export const MAX_MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Ийм хуучин ажлын өдрийг хүлээж авахгүй (клиентийн `MaxQueueAge` 30 хоногоос илүү). */
export const MAX_PAST_DAYS = 35;

/** Сегмент / сессийн id — клиентийн UUID(N) + «-дугаар». */
const ID_RE = /^[A-Za-z0-9_-]{6,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanId(v: unknown): string | null {
  return typeof v === 'string' && ID_RE.test(v) ? v : null;
}

export function isWorkDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** YYYY-MM-DD + n өдөр (UTC дээр — огнооны арифметик л, цагийн бүс хамаагүй). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nonNegInt(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n >= 0 ? n : null;
}

function posIntOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface ValidSegment {
  segment_id: string;
  session_id: string;
  task_id: number;
  work_date: string;
  doc_key: string | null;
  revit_document_id: number | null;
  active_ms: number;
  idle_ms: number;
  rev: number;
  first_at: string | null;
  last_at: string | null;
}

export type SegmentVerdict =
  | { ok: true; seg: ValidSegment }
  | { ok: false; segment_id: string | null; rev: number; reason: string };

/**
 * Нэг сегментийг шалгана.  ⚠️ `user_id` нь БИЕЭС ХЭЗЭЭ Ч авагдахгүй — токены
 * `sub`.  Биеийн `user_id` нь токентой зөрвөл өөр хүний дарааллыг илгээж
 * байна гэсэн үг → татгалзана (клиент хасна, өөр хүнд тоологдохгүй).
 */
export function validateSegment(raw: unknown, tokenUserId: number, todayUB: string): SegmentVerdict {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const segmentId = cleanId(r.segment_id);
  const rev = nonNegInt(r.rev) ?? 0;
  const fail = (reason: string): SegmentVerdict => ({ ok: false, segment_id: segmentId, rev, reason });
  if (!segmentId) return fail('bad_segment_id');
  const sessionId = cleanId(r.session_id);
  if (!sessionId) return fail('bad_session_id');
  if (r.user_id !== undefined && Number(r.user_id) !== tokenUserId) return fail('user_mismatch');
  const taskId = posIntOrNull(r.task_id);
  if (!taskId) return fail('bad_task_id');
  if (!isWorkDate(r.work_date)) return fail('bad_work_date');
  const workDate = r.work_date;
  if (workDate > addDays(todayUB, 1) || workDate < addDays(todayUB, -MAX_PAST_DAYS)) {
    return fail('date_out_of_range');
  }
  const active = nonNegInt(r.active_ms);
  const idle = nonNegInt(r.idle_ms) ?? 0;
  if (active === null) return fail('bad_active_ms');
  if (active > MAX_MS_PER_DAY || idle > MAX_MS_PER_DAY || active + idle > MAX_MS_PER_DAY + 60_000) {
    return fail('duration_out_of_range');
  }
  if (rev < 1) return fail('bad_rev');
  const docKey = typeof r.doc_key === 'string' && r.doc_key.length <= 128 ? r.doc_key : null;
  return {
    ok: true,
    seg: {
      segment_id: segmentId,
      session_id: sessionId,
      task_id: taskId,
      work_date: workDate,
      doc_key: docKey,
      revit_document_id: posIntOrNull(r.revit_document_id),
      active_ms: active,
      idle_ms: idle,
      rev,
      first_at: isoOrNull(r.first_at),
      last_at: isoOrNull(r.last_at),
    },
  };
}

export function cleanState(v: unknown): ClientState {
  return (CLIENT_STATES as readonly string[]).includes(v as string) ? (v as ClientState) : 'no_task';
}

export interface PresenceRow {
  session_id: string;
  user_id: number;
  state: string;
  task_id: number | null;
  last_seen_at: string;
  ended_at: string | null;
}

/**
 * Админы харагдацын төлөв.  Heartbeat хуучирсан эсвэл сесс хаагдсан бол
 * клиентийн сүүлийн төлөв ЮУ Ч байсан OFFLINE — «үүрд ажиллаж байна» гэж
 * ХЭЗЭЭ Ч үлдэхгүй.
 */
export function liveStatusOf(p: Pick<PresenceRow, 'state' | 'task_id' | 'last_seen_at' | 'ended_at'>, nowMs: number): LiveStatus {
  const seen = Date.parse(p.last_seen_at);
  if (p.ended_at || Number.isNaN(seen) || nowMs - seen > STALE_AFTER_MS) return 'offline';
  switch (p.state) {
    case 'working':
      return p.task_id ? 'working' : 'online_no_task';
    case 'idle':
    case 'background':
      return p.task_id ? 'idle' : 'online_no_task';
    case 'suspended':
    case 'signed_out':
      return 'offline';
    default:
      return 'online_no_task';
  }
}

const STATUS_RANK: Record<LiveStatus, number> = { working: 0, idle: 1, online_no_task: 2, offline: 3 };

export function statusRank(s: LiveStatus): number {
  return STATUS_RANK[s];
}

/**
 * Нэг ажилтны олон сесс (хоёр Revit, өмнөх нээлт) — хамгийн «амьд»-ыг сонгоно:
 * төлөвийн эрэмбэ (ажиллаж буй > идэвхгүй > таскгүй > offline), дараа нь
 * хамгийн сүүлд харагдсан.
 */
export function pickSession<T extends PresenceRow>(rows: T[], nowMs: number): T | null {
  let best: T | null = null;
  let bestRank = 99;
  let bestSeen = -Infinity;
  for (const r of rows) {
    const rank = statusRank(liveStatusOf(r, nowMs));
    const seen = Date.parse(r.last_seen_at) || 0;
    if (rank < bestRank || (rank === bestRank && seen > bestSeen)) {
      best = r;
      bestRank = rank;
      bestSeen = seen;
    }
  }
  return best;
}

/**
 * Revit-ээс явц илгээхэд `report_date`: офлайн дараалалд хүлээгдсэн тайлан
 * бичсэн өдөртөө бүртгэгдэнэ, гэхдээ 3 хоногоос хуучин, ирээдүйн өдрийг
 * хүлээж авахгүй — тэр үед өнөөдөр.
 */
export const REPORT_DATE_MAX_BACK_DAYS = 3;

export function resolveReportDate(raw: unknown, todayUB: string): string {
  if (!isWorkDate(raw)) return todayUB;
  if (raw > todayUB) return todayUB;
  if (raw < addDays(todayUB, -REPORT_DATE_MAX_BACK_DAYS)) return todayUB;
  return raw;
}

/** Revit-ээс ирсэн `revit_active_ms`-ийг аудитад хадгалахын өмнө цэвэрлэнэ. */
export function cleanActiveMs(v: unknown): number | null {
  const n = nonNegInt(v);
  return n === null ? null : Math.min(n, MAX_MS_PER_DAY);
}
