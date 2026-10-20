/**
 * Revit «Өөрчлөхөөс өмнө» — ӨӨРЧЛӨЛТИЙН МЭДЭГДЭЛ (migration 0390).
 *
 * Архитектор add-in-ий 3D симуляцаар элементийг зөөж БАТАЛСНЫ дараа мөргөлдсөн
 * элементүүдийг ҮҮСГЭСЭН / СҮҮЛД ӨӨРЧИЛСӨН / одоо ЭЗЭМШИЖ буй хүмүүс (Revit
 * worksharing-ийн хэрэглэгчийн НЭР) болон архитекторын гараар нэмсэн хүмүүс ERP-д
 * мэдэгдэл авна.  Энэ файл нь ЦЭВЭР дүрмүүд — D1 уншдаггүй, тестлэгдэнэ:
 *
 *   • Revit нэрийг хэвийн болгох (`normRevitUsername`) — lower(trim), ≤128.
 *   • Add-in-ий биеийг ариутгах (`sanitizeNoticeBody`) — цагаан жагсаалт, хязгаар.
 *   • Мөргөлдлөөс Revit нэр цуглуулах (`collectConflictUsernames`).
 *   • Хүлээн авагч тооцох (`computeRecipients`) — resolve(creator ∪ last_changed_by
 *     ∪ owner) − excluded − sender, нэмэх manual − sender; холбогдоогүй нэрс.
 *   • Шийдлийн нэгтгэл (`mergeResolution`) — alias түрүүлнэ, үгүй бол
 *     `users.username` (том жижиг үсэг үл харгалзан).
 *
 * Замууд: `routes/revitChangeNotices.ts`.
 */

export const STAFF_ROLES = ['admin', 'senior', 'engineer', 'architect'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: unknown): role is StaffRole {
  return typeof role === 'string' && (STAFF_ROLES as readonly string[]).includes(role);
}

/** «Бүгд» жагсаалт, бусдын мэдэгдлийг харах эрх. */
export function seesAllNotices(role: unknown): boolean {
  return role === 'admin' || role === 'senior';
}

export const MAX_REVIT_USERNAME = 128;
export const MAX_RESOLVE_USERNAMES = 200;
export const MAX_CONFLICTS = 200;
export const MAX_ISSUES = 60;
export const MAX_MANUAL = 30;
export const MAX_EXCLUDED = 60;
export const MAX_NOTE = 2000;
export const MAX_MOVED_IDS = 500;
/** Alias холбоход хэдэн хоногийн өмнөх холбогдоогүй мэдэгдлийг хүргэх вэ. */
export const ALIAS_DELIVERY_DAYS = 30;

export type Reason = 'creator' | 'last_changed' | 'owner' | 'manual';
const REASON_ORDER: Reason[] = ['creator', 'last_changed', 'owner', 'manual'];

/* ------------------------------------------------------------------ */
/*  Revit хэрэглэгчийн нэр                                              */
/* ------------------------------------------------------------------ */

export interface RevitName {
  /** Revit-д бичигдсэн хэлбэр (харуулах). */
  display: string;
  /** lower(trim) — түлхүүр. */
  norm: string;
}

/** Хоосон, string биш, 128-аас урт → null. */
export function cleanRevitUsername(raw: unknown): RevitName | null {
  if (typeof raw !== 'string') return null;
  const display = raw.trim();
  if (!display || display.length > MAX_REVIT_USERNAME) return null;
  return { display, norm: display.toLowerCase() };
}

export function normRevitUsername(raw: unknown): string | null {
  return cleanRevitUsername(raw)?.norm ?? null;
}

/* ------------------------------------------------------------------ */
/*  Хэлбэрүүд                                                           */
/* ------------------------------------------------------------------ */

export interface ConflictItem {
  key: string;
  element_id: number;
  unique_id?: string;
  label: string;
  category?: string;
  link_name?: string;
  kind?: string;
  confirmed: boolean;
  /** Хэрхэн хамаарах: огтлолцол | зөөлтийг дагаж Revit өөрчлөх (баганыг дагах дам нуруу г.м.) | өрөө | устах. */
  relation?: ConflictRelation;
  volume_cm3?: number;
  consequence?: string;
  creator?: string;
  last_changed_by?: string;
  owner?: string;
}

export const CONFLICT_RELATIONS = ['clash', 'follows', 'room', 'deleted'] as const;
export type ConflictRelation = (typeof CONFLICT_RELATIONS)[number];

export interface IssueItem {
  mark: string;
  text: string;
  consequence?: string;
}

export interface NoticeInput {
  client_uid: string;
  doc_uid: string | null;
  doc_title: string;
  sender_revit_username: RevitName | null;
  moved: { label: string; category: string | null; ids: number[]; unique_ids: string[] };
  offset_mm: [number, number, number];
  distance_mm: number;
  verdict: string;
  headline: string;
  moved_at: string;
  conflicts: ConflictItem[];
  issues: IssueItem[];
  note: string | null;
  manual_user_ids: number[];
  excluded_user_ids: number[];
}

export type SanitizeResult = { ok: true; value: NoticeInput } | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/*  Ариутгал                                                            */
/* ------------------------------------------------------------------ */

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function positiveIds(raw: unknown, max: number): number[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > max) return null;
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

const CLIENT_UID_RE = /^[A-Za-z0-9{}._:-]{1,80}$/;

function sanitizeConflict(raw: unknown): ConflictItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = str(r.key, 120);
  const elementId = finite(r.element_id);
  if (!key || elementId === null) return null;
  const item: ConflictItem = {
    key,
    element_id: Math.trunc(elementId),
    label: str(r.label, 300) ?? `#${Math.trunc(elementId)}`,
    confirmed: r.confirmed === true,
  };
  const opt = (name: 'unique_id' | 'category' | 'link_name' | 'kind' | 'consequence', max: number) => {
    const v = str(r[name], max);
    if (v) item[name] = v;
  };
  opt('unique_id', 120);
  opt('category', 120);
  opt('link_name', 300);
  opt('kind', 60);
  opt('consequence', 600);
  const vol = finite(r.volume_cm3);
  if (vol !== null) item.volume_cm3 = vol;
  if (typeof r.relation === 'string' && (CONFLICT_RELATIONS as readonly string[]).includes(r.relation)) item.relation = r.relation as ConflictRelation;
  for (const name of ['creator', 'last_changed_by', 'owner'] as const) {
    const n = cleanRevitUsername(r[name]);
    if (n) item[name] = n.display;
  }
  return item;
}

function sanitizeIssue(raw: unknown): IssueItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = str(r.text, 600);
  if (!text) return null;
  const item: IssueItem = { mark: str(r.mark, 20) ?? '•', text };
  const consequence = str(r.consequence, 600);
  if (consequence) item.consequence = consequence;
  return item;
}

/**
 * `POST /api/revit/change-notices`-ийн биеийг ариутгана.  Заавал талбар дутуу,
 * хязгаар хэтэрсэн бол алдаа; урт бичвэрийг тайрна; танихгүй талбарыг хаяна.
 */
export function sanitizeNoticeBody(raw: unknown): SanitizeResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Invalid JSON body' };
  const b = raw as Record<string, unknown>;

  const clientUid = typeof b.client_uid === 'string' ? b.client_uid.trim() : '';
  if (!CLIENT_UID_RE.test(clientUid)) return { ok: false, error: 'client_uid is required' };

  const docTitle = str(b.doc_title, 300);
  if (!docTitle) return { ok: false, error: 'doc_title is required' };

  const movedRaw = b.moved && typeof b.moved === 'object' ? (b.moved as Record<string, unknown>) : null;
  const movedLabel = movedRaw ? str(movedRaw.label, 300) : null;
  if (!movedRaw || !movedLabel) return { ok: false, error: 'moved.label is required' };
  const movedIdsRaw = Array.isArray(movedRaw.ids) ? movedRaw.ids : [];
  const movedIds: number[] = [];
  for (const v of movedIdsRaw.slice(0, MAX_MOVED_IDS)) {
    const n = finite(v);
    if (n !== null && !movedIds.includes(Math.trunc(n))) movedIds.push(Math.trunc(n));
  }
  const uniqueIds: string[] = [];
  if (Array.isArray(movedRaw.unique_ids)) {
    for (const v of movedRaw.unique_ids.slice(0, MAX_MOVED_IDS)) {
      const s = str(v, 120);
      if (s && !uniqueIds.includes(s)) uniqueIds.push(s);
    }
  }

  const off = Array.isArray(b.offset_mm) ? b.offset_mm.map(finite) : [];
  if (off.length !== 3 || off.some((v) => v === null)) return { ok: false, error: 'offset_mm must be [x,y,z]' };

  const distance = finite(b.distance_mm);
  if (distance === null || distance < 0) return { ok: false, error: 'distance_mm is required' };

  const verdict = str(b.verdict, 64);
  if (!verdict) return { ok: false, error: 'verdict is required' };
  const headline = str(b.headline, 500);
  if (!headline) return { ok: false, error: 'headline is required' };

  const movedAt = str(b.moved_at, 40);
  if (!movedAt || Number.isNaN(Date.parse(movedAt))) return { ok: false, error: 'moved_at must be an ISO date' };

  if (b.conflicts !== undefined && !Array.isArray(b.conflicts)) return { ok: false, error: 'conflicts must be an array' };
  const conflictsRaw = (b.conflicts as unknown[] | undefined) ?? [];
  if (conflictsRaw.length > MAX_CONFLICTS) return { ok: false, error: `too many conflicts (max ${MAX_CONFLICTS})` };
  const conflicts: ConflictItem[] = [];
  const seenKeys = new Set<string>();
  for (const c of conflictsRaw) {
    const item = sanitizeConflict(c);
    if (item && !seenKeys.has(item.key)) {
      seenKeys.add(item.key);
      conflicts.push(item);
    }
  }

  if (b.issues !== undefined && !Array.isArray(b.issues)) return { ok: false, error: 'issues must be an array' };
  const issuesRaw = (b.issues as unknown[] | undefined) ?? [];
  if (issuesRaw.length > MAX_ISSUES) return { ok: false, error: `too many issues (max ${MAX_ISSUES})` };
  const issues = issuesRaw.map(sanitizeIssue).filter((x): x is IssueItem => x !== null);

  const manual = positiveIds(b.manual_user_ids, MAX_MANUAL);
  if (!manual) return { ok: false, error: `manual_user_ids must be an array (max ${MAX_MANUAL})` };
  const excluded = positiveIds(b.excluded_user_ids, MAX_EXCLUDED);
  if (!excluded) return { ok: false, error: `excluded_user_ids must be an array (max ${MAX_EXCLUDED})` };

  return {
    ok: true,
    value: {
      client_uid: clientUid,
      doc_uid: str(b.doc_uid, 120),
      doc_title: docTitle,
      sender_revit_username: cleanRevitUsername(b.sender_revit_username),
      moved: { label: movedLabel, category: str(movedRaw.category, 120), ids: movedIds, unique_ids: uniqueIds },
      offset_mm: off as [number, number, number],
      distance_mm: distance,
      verdict,
      headline,
      moved_at: movedAt,
      conflicts,
      issues,
      note: str(b.note, MAX_NOTE),
      manual_user_ids: manual,
      excluded_user_ids: excluded,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Мөргөлдлөөс Revit нэр                                              */
/* ------------------------------------------------------------------ */

export interface UsernameRef {
  norm: string;
  display: string;
  reasons: Reason[];
  /** Энэ нэртэй холбоотой ConflictItem.key-үүд. */
  keys: string[];
}

const FIELD_REASON: Array<['creator' | 'last_changed_by' | 'owner', Reason]> = [
  ['creator', 'creator'],
  ['last_changed_by', 'last_changed'],
  ['owner', 'owner'],
];

function sortReasons(rs: Iterable<Reason>): Reason[] {
  const set = new Set(rs);
  return REASON_ORDER.filter((r) => set.has(r));
}

/** Мөргөлдлийн creator / last_changed_by / owner нэрсийг norm-оор бүлэглэнэ (эхний харагдсан дарааллаар). */
export function collectConflictUsernames(conflicts: readonly ConflictItem[]): Map<string, UsernameRef> {
  const out = new Map<string, UsernameRef>();
  for (const c of conflicts) {
    for (const [field, reason] of FIELD_REASON) {
      const name = cleanRevitUsername(c[field]);
      if (!name) continue;
      let ref = out.get(name.norm);
      if (!ref) {
        ref = { norm: name.norm, display: name.display, reasons: [], keys: [] };
        out.set(name.norm, ref);
      }
      if (!ref.reasons.includes(reason)) ref.reasons = sortReasons([...ref.reasons, reason]);
      if (!ref.keys.includes(c.key)) ref.keys.push(c.key);
    }
  }
  return out;
}

/** Нэг Revit нэр (norm) мөргөлдлүүдэд ямар шалтгаанаар, аль элементүүдэд орсон бэ. */
export function reasonsForUsername(conflicts: readonly ConflictItem[], norm: string): { reasons: Reason[]; keys: string[] } {
  const ref = collectConflictUsernames(conflicts).get(norm);
  return ref ? { reasons: ref.reasons, keys: ref.keys } : { reasons: [], keys: [] };
}

/* ------------------------------------------------------------------ */
/*  Шийдэл (alias → username fallback)                                  */
/* ------------------------------------------------------------------ */

export interface ResolvedUser {
  id: number;
  full_name: string | null;
  position: string | null;
  team_name: string | null;
}

export interface AliasRow extends ResolvedUser {
  norm: string;
  last_seen_at: string;
}

export interface UsernameRow extends ResolvedUser {
  norm: string;
}

/**
 * Шийдлийн ГАНЦ дүрэм.  `aliasRows` / `usernameRows` нь аль хэдийн идэвхтэй
 * ажилтнаар шүүгдсэн байна.  Alias-тай нэрд ЗӨВХӨН alias-ын хүмүүс (сүүлд
 * харагдсанаар буурах); alias-гүй нэрд `users.username`-ийн яг таарц.
 */
export function mergeResolution(
  norms: Iterable<string>,
  aliasRows: readonly AliasRow[],
  usernameRows: readonly UsernameRow[],
): Map<string, ResolvedUser[]> {
  const byAlias = new Map<string, AliasRow[]>();
  for (const r of aliasRows) {
    const list = byAlias.get(r.norm) ?? [];
    list.push(r);
    byAlias.set(r.norm, list);
  }
  const byName = new Map<string, UsernameRow[]>();
  for (const r of usernameRows) {
    const list = byName.get(r.norm) ?? [];
    list.push(r);
    byName.set(r.norm, list);
  }
  const strip = (u: ResolvedUser): ResolvedUser => ({
    id: u.id,
    full_name: u.full_name,
    position: u.position,
    team_name: u.team_name,
  });
  const out = new Map<string, ResolvedUser[]>();
  for (const norm of norms) {
    if (out.has(norm)) continue;
    const aliases = [...(byAlias.get(norm) ?? [])].sort((a, b) =>
      a.last_seen_at === b.last_seen_at ? a.id - b.id : a.last_seen_at < b.last_seen_at ? 1 : -1,
    );
    const source: ResolvedUser[] = aliases.length > 0 ? aliases : [...(byName.get(norm) ?? [])].sort((a, b) => a.id - b.id);
    const seen = new Set<number>();
    const users: ResolvedUser[] = [];
    for (const u of source) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      users.push(strip(u));
    }
    out.set(norm, users);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Хүлээн авагчид                                                      */
/* ------------------------------------------------------------------ */

export interface RecipientPlan {
  user_id: number;
  reasons: Reason[];
  element_keys: string[];
}

/**
 * Хүлээн авагчид = resolve(мөргөлдлийн нэрс) − excluded − sender, нэмэх
 * manual − sender (manual нь excluded-ийг давна).  `unresolved` = ЯМАР Ч
 * ажилтанд холбогдоогүй нэрс (харуулах хэлбэрээр) — илгээгч/хасагдсан хүнд
 * холбогдсон нэр «холбогдоогүй» БИШ.
 */
export function computeRecipients(args: {
  usernames: ReadonlyMap<string, UsernameRef>;
  resolved: ReadonlyMap<string, readonly { id: number }[]>;
  manualUserIds: readonly number[];
  excludedUserIds: readonly number[];
  senderId: number;
}): { recipients: RecipientPlan[]; unresolved: string[] } {
  const excluded = new Set(args.excludedUserIds);
  const map = new Map<number, { reasons: Set<Reason>; keys: string[] }>();
  const unresolved: string[] = [];

  for (const ref of args.usernames.values()) {
    const users = args.resolved.get(ref.norm) ?? [];
    if (users.length === 0) {
      unresolved.push(ref.display);
      continue;
    }
    for (const u of users) {
      if (u.id === args.senderId || excluded.has(u.id)) continue;
      const entry = map.get(u.id) ?? { reasons: new Set<Reason>(), keys: [] };
      for (const r of ref.reasons) entry.reasons.add(r);
      for (const k of ref.keys) if (!entry.keys.includes(k)) entry.keys.push(k);
      map.set(u.id, entry);
    }
  }
  for (const id of args.manualUserIds) {
    if (id === args.senderId) continue;
    const entry = map.get(id) ?? { reasons: new Set<Reason>(), keys: [] };
    entry.reasons.add('manual');
    map.set(id, entry);
  }

  const recipients = [...map.entries()].map(([user_id, e]) => ({
    user_id,
    reasons: sortReasons(e.reasons),
    element_keys: e.keys,
  }));
  return { recipients, unresolved };
}

/** Холбогдоогүй нэрсийн жагсаалтаас нэг нэрийг (norm-оор) хасна. */
export function removeUnresolved(list: readonly string[], norm: string): string[] {
  return list.filter((n) => n.trim().toLowerCase() !== norm);
}

/** Хоёр шалтгааны жагсаалтыг нэгтгэнэ (дарааллыг хадгална). */
export function mergeReasons(a: readonly string[], b: readonly string[]): Reason[] {
  return sortReasons([...a, ...b].filter((r): r is Reason => (REASON_ORDER as string[]).includes(r)));
}

/* ------------------------------------------------------------------ */
/*  Мэдэгдлийн бичвэр                                                    */
/* ------------------------------------------------------------------ */

export function noticeTitle(movedLabel: string, reasons: readonly string[]): string {
  const manualOnly = reasons.length > 0 && reasons.every((r) => r === 'manual');
  return manualOnly
    ? `Revit: «${movedLabel}» зөөгдсөн — танд мэдэгдэл`
    : `Revit: «${movedLabel}» зөөгдсөн — таны элементтэй огтлолцоно`;
}

export function noticeBody(headline: string, senderName: string | null): string {
  return senderName ? `${headline} — ${senderName}` : headline;
}

export function noticeLink(id: number): string {
  return `/app/revit-changes?id=${id}`;
}

/** JSON массивыг аюулгүй уншина (гажсан бол хоосон). */
export function parseJsonArray<T = unknown>(raw: unknown): T[] {
  if (typeof raw !== 'string') return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
