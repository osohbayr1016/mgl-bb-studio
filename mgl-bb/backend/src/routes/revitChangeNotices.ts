/**
 * Revit «Өөрчлөхөөс өмнө» — ӨӨРЧЛӨЛТИЙН МЭДЭГДЭЛ (migration 0390).
 * `/api/revit`-ийн нэмэлт mount (index.ts).  Цэвэр дүрэм: `lib/revitChangeNotices.ts`.
 *
 *   POST   /api/revit/identity                 — add-in: (токены хэрэглэгч, Revit нэр) бүртгэнэ
 *   POST   /api/revit/change-notices/resolve   — Revit нэрс → ERP ажилтан (+ doc_uid → төсөл)
 *   GET    /api/revit/change-notices/staff?q=  — гараар нэмэх ажилтны хайлт (add-in /api/users-д хүрэхгүй)
 *   POST   /api/revit/change-notices           — баталсан зөөлтийн мэдэгдэл (client_uid-аар идемпотент)
 *   GET    /api/revit/change-notices?box=inbox|sent|all&limit=&before=
 *   GET    /api/revit/change-notices/:id       — дэлгэрэнгүй (илгээгч, хүлээн авагч, admin, senior; бусдад 404)
 *   POST   /api/revit/change-notices/:id/ack   — хүлээн авагч «Танилцсан»
 *   GET    /api/revit/aliases                  — admin: холболтууд + холбогдоогүй нэрс
 *   PUT    /api/revit/aliases                  — admin: холбох + сүүлийн 30 хоногийн мэдэгдлийг хүргэх
 *   DELETE /api/revit/aliases                  — admin: холболт устгах
 *
 * `worker`/`client` нь workerScope/clientScope-оор 403; `routes/revit.ts`-ийн
 * `use('*')` нь `/api/revit/*`-д staff role шаарддаг.  Энд ХОЁРДУГААР давхарга
 * болгож замууддаа role шалгана (тестийн харness тэр router-гүй ажилладаг).
 *
 * ⚠️ BIM-ийн элемент түвшний үйл ажиллагааны хүснэгтүүд (0201–0209) ЗОРИУД
 * уншигдахгүй — «зөвхөн өөртөө» нууцлалтай.  Зохиогч нь add-in илгээсэн
 * worksharing-ийн нэрээс л ирнэ.
 */
import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import {
  ALIAS_DELIVERY_DAYS,
  MAX_RESOLVE_USERNAMES,
  STAFF_ROLES,
  cleanRevitUsername,
  collectConflictUsernames,
  computeRecipients,
  mergeReasons,
  mergeResolution,
  noticeBody,
  noticeLink,
  noticeTitle,
  parseJsonArray,
  reasonsForUsername,
  removeUnresolved,
  sanitizeNoticeBody,
  seesAllNotices,
} from '../lib/revitChangeNotices';
import type { AliasRow, ConflictItem, IssueItem, ResolvedUser, RevitName, UsernameRow } from '../lib/revitChangeNotices';

const revitChangeNotices = new Hono<{ Bindings: Env; Variables: AppVariables }>();

revitChangeNotices.onError((err, c) => {
  console.error('[revit-change-notices]', err);
  return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
});

const staffOnly = requireRole(...STAFF_ROLES);
const adminOnly = requireRole('admin');
revitChangeNotices.use('/identity', staffOnly);
revitChangeNotices.use('/change-notices', staffOnly);
revitChangeNotices.use('/change-notices/*', staffOnly);
revitChangeNotices.use('/aliases', adminOnly);

/* ------------------------------------------------------------------ */
/*  SQL туслахууд                                                       */
/* ------------------------------------------------------------------ */

const STAFF_SQL = `u.role IN ('admin','senior','engineer','architect') AND COALESCE(u.status, 'active') <> 'inactive'`;
const TEAM_NAME_SQL = `(SELECT t.name_mn FROM user_teams ut JOIN teams t ON t.id = ut.team_id
                         WHERE ut.user_id = u.id AND ut.is_primary = 1 LIMIT 1)`;
const IN_CHUNK = 50;
const ROWS_PER_INSERT = 15; // 15 × 5 bind = 75 < D1-ийн 100

function chunks<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const qs = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Revit нэрсийг ERP ажилтан руу шийднэ (ГАНЦ газар — resolve, create, alias холболт). */
async function resolveNorms(db: D1Database, norms: readonly string[]): Promise<Map<string, ResolvedUser[]>> {
  const unique = [...new Set(norms)];
  const aliasRows: AliasRow[] = [];
  const usernameRows: UsernameRow[] = [];
  for (const part of chunks(unique, IN_CHUNK)) {
    const a = await db
      .prepare(
        `SELECT a.revit_username_norm AS norm, a.last_seen_at, u.id, u.full_name, u.position,
                ${TEAM_NAME_SQL} AS team_name
           FROM revit_user_aliases a
           JOIN users u ON u.id = a.user_id
          WHERE a.revit_username_norm IN (${qs(part.length)}) AND ${STAFF_SQL}`,
      )
      .bind(...part)
      .all<AliasRow>();
    aliasRows.push(...(a.results ?? []));
  }
  const aliased = new Set(aliasRows.map((r) => r.norm));
  const rest = unique.filter((n) => !aliased.has(n));
  for (const part of chunks(rest, IN_CHUNK)) {
    const r = await db
      .prepare(
        `SELECT LOWER(TRIM(u.username)) AS norm, u.id, u.full_name, u.position, ${TEAM_NAME_SQL} AS team_name
           FROM users u
          WHERE LOWER(TRIM(u.username)) IN (${qs(part.length)}) AND ${STAFF_SQL}`,
      )
      .bind(...part)
      .all<UsernameRow>();
    usernameRows.push(...(r.results ?? []));
  }
  return mergeResolution(unique, aliasRows, usernameRows);
}

/**
 * Add-in-ий автомат бүртгэл.  Ердийн давталтад 0 мөр бичигдэнэ: зөвхөн
 * өдөрт нэг удаа `last_seen_at`, эсвэл бичлэг өөрчлөгдсөн үед.  `source`-ыг
 * ХЭЗЭЭ Ч дарахгүй (админы холболт админых хэвээр).
 */
async function upsertIdentity(db: D1Database, name: RevitName, userId: number): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO revit_user_aliases (revit_username_norm, revit_username, user_id, source)
       VALUES (?, ?, ?, 'addin')
       ON CONFLICT(revit_username_norm, user_id) DO UPDATE
          SET last_seen_at = datetime('now'), revit_username = excluded.revit_username
        WHERE revit_user_aliases.last_seen_at < datetime('now', '-1 day')
           OR revit_user_aliases.revit_username <> excluded.revit_username`,
    )
    .bind(name.norm, name.display, userId)
    .run();
  return Number(r.meta?.changes ?? 0);
}

async function projectOfDoc(db: D1Database, docUid: string | null): Promise<{ id: number; name: string } | null> {
  if (!docUid) return null;
  const row = await db
    .prepare(
      `SELECT d.project_id AS id, p.name
         FROM revit_documents d LEFT JOIN projects p ON p.id = d.project_id
        WHERE d.doc_uid = ? ORDER BY d.last_seen_at DESC LIMIT 1`,
    )
    .bind(docUid)
    .first<{ id: number; name: string | null }>();
  return row ? { id: row.id, name: row.name ?? `#${row.id}` } : null;
}

async function userName(db: D1Database, id: number): Promise<string | null> {
  const r = await db.prepare('SELECT full_name, username FROM users WHERE id = ?').bind(id).first<{ full_name: string | null; username: string | null }>();
  return r ? (r.full_name ?? r.username ?? null) : null;
}

interface NotifyRow {
  user_id: number;
  title: string;
  body: string;
  link: string;
}

/** Мэдэгдлүүдийг багцаар оруулна.  Мэдэгдэл нь best-effort — алдаа үндсэн үйлдлийг унагахгүй. */
async function insertNotifications(db: D1Database, rows: readonly NotifyRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  try {
    const stmts = chunks(rows, ROWS_PER_INSERT).map((part) =>
      db
        .prepare(
          `INSERT INTO notifications (user_id, type, title, body, link) VALUES ${part.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
        )
        .bind(...part.flatMap((r) => [r.user_id, 'revit_change_notice', r.title, r.body, r.link])),
    );
    await db.batch(stmts);
    return rows.length;
  } catch (err) {
    console.error('[revit-change-notices] notify failed', err);
    return 0;
  }
}

async function createdResponse(db: D1Database, noticeId: number, unresolvedJson: string) {
  const rows = await db
    .prepare(
      `SELECT r.user_id AS id, u.full_name
         FROM revit_change_notice_recipients r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.notice_id = ? ORDER BY u.full_name, r.user_id`,
    )
    .bind(noticeId)
    .all<{ id: number; full_name: string | null }>();
  const recipients = rows.results ?? [];
  return {
    id: noticeId,
    notified: recipients.length,
    recipients,
    unresolved: parseJsonArray<string>(unresolvedJson),
  };
}

function intParam(v: string | undefined): number | null {
  if (!v || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/* ------------------------------------------------------------------ */
/*  POST /identity                                                     */
/* ------------------------------------------------------------------ */

revitChangeNotices.post('/identity', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const name = cleanRevitUsername(body?.revit_username);
  if (!name) return c.json({ error: 'revit_username is required (1–128 chars)' }, 400);
  await upsertIdentity(c.env.DB, name, user.sub);
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  POST /change-notices/resolve                                       */
/* ------------------------------------------------------------------ */

revitChangeNotices.post('/change-notices/resolve', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || !Array.isArray(body.revit_usernames)) return c.json({ error: 'revit_usernames must be an array' }, 400);
  if (body.revit_usernames.length > MAX_RESOLVE_USERNAMES) {
    return c.json({ error: `too many revit_usernames (max ${MAX_RESOLVE_USERNAMES})` }, 400);
  }
  const names: RevitName[] = [];
  const seen = new Set<string>();
  for (const raw of body.revit_usernames) {
    const n = cleanRevitUsername(raw);
    if (n && !seen.has(n.norm)) {
      seen.add(n.norm);
      names.push(n);
    }
  }
  const resolved = await resolveNorms(c.env.DB, names.map((n) => n.norm));
  const docUid = typeof body.doc_uid === 'string' && body.doc_uid.trim() ? body.doc_uid.trim().slice(0, 120) : null;
  return c.json({
    people: names.map((n) => ({ revit_username: n.display, users: resolved.get(n.norm) ?? [] })),
    project: await projectOfDoc(c.env.DB, docUid),
  });
});

/* ------------------------------------------------------------------ */
/*  GET /change-notices/staff                                          */
/* ------------------------------------------------------------------ */

revitChangeNotices.get('/change-notices/staff', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 100);
  // ~55 ажилтан тул бүгдийг уншаад JS-ээр шүүнэ: SQLite-ийн LOWER нь кирилл
  // үсгийг жижигрүүлдэггүй тул SQL-ийн хайлт «Бат»-ыг «бат»-аар олохгүй.
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.full_name, u.username, u.position, ${TEAM_NAME_SQL} AS team_name
       FROM users u WHERE ${STAFF_SQL}
      ORDER BY u.full_name COLLATE NOCASE, u.id`,
  ).all<{ id: number; full_name: string | null; username: string | null; position: string | null; team_name: string | null }>();
  let list = rows.results ?? [];
  if (q) {
    list = list.filter(
      (u) => (u.full_name ?? '').toLowerCase().includes(q) || (u.username ?? '').toLowerCase().includes(q),
    );
  }
  const users = list.slice(0, q ? 20 : 50).map((u) => ({
    id: u.id,
    full_name: u.full_name ?? u.username,
    position: u.position,
    team_name: u.team_name,
  }));
  return c.json({ users });
});

/* ------------------------------------------------------------------ */
/*  POST /change-notices                                               */
/* ------------------------------------------------------------------ */

revitChangeNotices.post('/change-notices', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const raw = await c.req.json<unknown>().catch(() => null);
  const parsed = sanitizeNoticeBody(raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;

  const existing = await db
    .prepare('SELECT id, sender_id, unresolved_json FROM revit_change_notices WHERE client_uid = ?')
    .bind(input.client_uid)
    .first<{ id: number; sender_id: number; unresolved_json: string }>();
  if (existing) {
    if (existing.sender_id !== user.sub) return c.json({ error: 'client_uid already used' }, 409);
    return c.json(await createdResponse(db, existing.id, existing.unresolved_json), 200);
  }

  if (input.sender_revit_username) await upsertIdentity(db, input.sender_revit_username, user.sub);

  const usernames = collectConflictUsernames(input.conflicts);
  const resolved = await resolveNorms(db, [...usernames.keys()]);

  let manual: number[] = [];
  if (input.manual_user_ids.length > 0) {
    const r = await db
      .prepare(`SELECT u.id FROM users u WHERE u.id IN (${qs(input.manual_user_ids.length)}) AND ${STAFF_SQL}`)
      .bind(...input.manual_user_ids)
      .all<{ id: number }>();
    const valid = new Set((r.results ?? []).map((x) => x.id));
    manual = input.manual_user_ids.filter((id) => valid.has(id));
  }

  const { recipients, unresolved } = computeRecipients({
    usernames,
    resolved,
    manualUserIds: manual,
    excludedUserIds: input.excluded_user_ids,
    senderId: user.sub,
  });
  const project = await projectOfDoc(db, input.doc_uid);
  const unresolvedJson = JSON.stringify(unresolved);

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO revit_change_notices
           (client_uid, sender_id, sender_revit_username, project_id, doc_uid, doc_title, moved_label, moved_category,
            moved_json, offset_mm_json, distance_mm, verdict, headline, conflicts_json, issues_json, unresolved_json,
            note, moved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.client_uid,
        user.sub,
        input.sender_revit_username?.display ?? null,
        project?.id ?? null,
        input.doc_uid,
        input.doc_title,
        input.moved.label,
        input.moved.category,
        JSON.stringify({ ids: input.moved.ids, unique_ids: input.moved.unique_ids }),
        JSON.stringify(input.offset_mm),
        input.distance_mm,
        input.verdict,
        input.headline,
        JSON.stringify(input.conflicts),
        JSON.stringify(input.issues),
        unresolvedJson,
        input.note,
        input.moved_at,
      ),
  ];
  for (const part of chunks(recipients, ROWS_PER_INSERT)) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO revit_change_notice_recipients (notice_id, user_id, reasons_json, element_keys_json)
           VALUES ${part.map(() => '((SELECT id FROM revit_change_notices WHERE client_uid = ?), ?, ?, ?)').join(', ')}`,
        )
        .bind(...part.flatMap((r) => [input.client_uid, r.user_id, JSON.stringify(r.reasons), JSON.stringify(r.element_keys)])),
    );
  }

  try {
    await db.batch(stmts);
  } catch (err) {
    // Зэрэг ирсэн ижил client_uid (offline outbox-ийн давтан илгээлт) — UNIQUE
    // унавал batch бүхэлдээ буцна; ялсан мөрийг буцаана.
    const again = await db
      .prepare('SELECT id, sender_id, unresolved_json FROM revit_change_notices WHERE client_uid = ?')
      .bind(input.client_uid)
      .first<{ id: number; sender_id: number; unresolved_json: string }>();
    if (again && again.sender_id === user.sub) return c.json(await createdResponse(db, again.id, again.unresolved_json), 200);
    throw err;
  }

  const created = await db
    .prepare('SELECT id FROM revit_change_notices WHERE client_uid = ?')
    .bind(input.client_uid)
    .first<{ id: number }>();
  if (!created) return c.json({ error: 'insert failed' }, 500);

  const senderName = await userName(db, user.sub);
  await insertNotifications(
    db,
    recipients.map((r) => ({
      user_id: r.user_id,
      title: noticeTitle(input.moved.label, r.reasons),
      body: noticeBody(input.headline, senderName),
      link: noticeLink(created.id),
    })),
  );

  return c.json(await createdResponse(db, created.id, unresolvedJson), 201);
});

/* ------------------------------------------------------------------ */
/*  GET /change-notices                                                */
/* ------------------------------------------------------------------ */

interface ListRow {
  id: number;
  created_at: string;
  moved_at: string;
  sender_id: number;
  sender_name: string | null;
  project_id: number | null;
  project_name: string | null;
  doc_title: string;
  moved_label: string;
  distance_mm: number;
  verdict: string;
  headline: string;
  conflict_count: number | null;
  recipient_count: number;
  ack_count: number;
  my_uid: number | null;
  my_reasons: string | null;
  my_read_at: string | null;
  my_ack_at: string | null;
}

revitChangeNotices.get('/change-notices', async (c) => {
  const user = c.get('user');
  const box = c.req.query('box') ?? 'inbox';
  if (box !== 'inbox' && box !== 'sent' && box !== 'all') return c.json({ error: 'box must be inbox|sent|all' }, 400);
  if (box === 'all' && !seesAllNotices(user.role)) return c.json({ error: 'Forbidden: insufficient permissions' }, 403);
  const limitRaw = Number(c.req.query('limit') ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.trunc(limitRaw))) : 50;
  const before = intParam(c.req.query('before'));

  const where: string[] = [];
  const binds: unknown[] = [user.sub];
  if (box === 'inbox') where.push('my.user_id IS NOT NULL');
  if (box === 'sent') {
    where.push('n.sender_id = ?');
    binds.push(user.sub);
  }
  if (before) {
    where.push('n.id < ?');
    binds.push(before);
  }
  binds.push(limit + 1);

  const rows = await c.env.DB.prepare(
    `SELECT n.id, n.created_at, n.moved_at, n.sender_id, s.full_name AS sender_name,
            n.project_id, p.name AS project_name, n.doc_title, n.moved_label, n.distance_mm, n.verdict, n.headline,
            json_array_length(n.conflicts_json) AS conflict_count,
            (SELECT COUNT(*) FROM revit_change_notice_recipients x WHERE x.notice_id = n.id) AS recipient_count,
            (SELECT COUNT(*) FROM revit_change_notice_recipients x
              WHERE x.notice_id = n.id AND x.acknowledged_at IS NOT NULL) AS ack_count,
            my.user_id AS my_uid, my.reasons_json AS my_reasons, my.read_at AS my_read_at,
            my.acknowledged_at AS my_ack_at
       FROM revit_change_notices n
       LEFT JOIN revit_change_notice_recipients my ON my.notice_id = n.id AND my.user_id = ?
       LEFT JOIN users s ON s.id = n.sender_id
       LEFT JOIN projects p ON p.id = n.project_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY n.id DESC
      LIMIT ?`,
  )
    .bind(...binds)
    .all<ListRow>();
  const all = rows.results ?? [];
  const page = all.slice(0, limit);
  return c.json({
    notices: page.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      moved_at: r.moved_at,
      sender: { id: r.sender_id, full_name: r.sender_name },
      project: r.project_id ? { id: r.project_id, name: r.project_name ?? `#${r.project_id}` } : null,
      doc_title: r.doc_title,
      moved_label: r.moved_label,
      distance_mm: r.distance_mm,
      verdict: r.verdict,
      headline: r.headline,
      conflict_count: r.conflict_count ?? 0,
      recipient_count: r.recipient_count,
      ack_count: r.ack_count,
      my:
        r.my_uid !== null
          ? { reasons: parseJsonArray<string>(r.my_reasons), read_at: r.my_read_at, acknowledged_at: r.my_ack_at }
          : null,
    })),
    next_before: all.length > limit ? page[page.length - 1]?.id ?? null : null,
  });
});

/* ------------------------------------------------------------------ */
/*  GET /change-notices/:id                                            */
/* ------------------------------------------------------------------ */

interface NoticeRow {
  id: number;
  client_uid: string;
  sender_id: number;
  sender_name: string | null;
  sender_revit_username: string | null;
  project_id: number | null;
  project_name: string | null;
  doc_uid: string | null;
  doc_title: string;
  moved_label: string;
  moved_category: string | null;
  moved_json: string;
  offset_mm_json: string;
  distance_mm: number;
  verdict: string;
  headline: string;
  conflicts_json: string;
  issues_json: string;
  unresolved_json: string;
  note: string | null;
  moved_at: string;
  created_at: string;
}

interface RecipientRow {
  user_id: number;
  full_name: string | null;
  position: string | null;
  team_name: string | null;
  reasons_json: string;
  element_keys_json: string;
  notified_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
}

async function loadNotice(db: D1Database, id: number): Promise<NoticeRow | null> {
  return db
    .prepare(
      `SELECT n.*, s.full_name AS sender_name, p.name AS project_name
         FROM revit_change_notices n
         LEFT JOIN users s ON s.id = n.sender_id
         LEFT JOIN projects p ON p.id = n.project_id
        WHERE n.id = ?`,
    )
    .bind(id)
    .first<NoticeRow>();
}

async function loadRecipients(db: D1Database, id: number): Promise<RecipientRow[]> {
  const r = await db
    .prepare(
      `SELECT r.user_id, u.full_name, u.position, ${TEAM_NAME_SQL} AS team_name, r.reasons_json, r.element_keys_json,
              r.notified_at, r.read_at, r.acknowledged_at
         FROM revit_change_notice_recipients r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.notice_id = ? ORDER BY u.full_name COLLATE NOCASE, r.user_id`,
    )
    .bind(id)
    .all<RecipientRow>();
  return r.results ?? [];
}

revitChangeNotices.get('/change-notices/:id{[0-9]+}', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'Not found' }, 404);
  const n = await loadNotice(db, id);
  if (!n) return c.json({ error: 'Not found' }, 404);
  const recipients = await loadRecipients(db, id);
  const mine = recipients.find((r) => r.user_id === user.sub) ?? null;
  const visible = n.sender_id === user.sub || mine !== null || seesAllNotices(user.role);
  if (!visible) return c.json({ error: 'Not found' }, 404);

  if (mine && !mine.read_at) {
    await db
      .prepare(
        `UPDATE revit_change_notice_recipients SET read_at = datetime('now')
          WHERE notice_id = ? AND user_id = ? AND read_at IS NULL`,
      )
      .bind(id, user.sub)
      .run();
    const fresh = await db
      .prepare('SELECT read_at FROM revit_change_notice_recipients WHERE notice_id = ? AND user_id = ?')
      .bind(id, user.sub)
      .first<{ read_at: string | null }>();
    mine.read_at = fresh?.read_at ?? mine.read_at;
  }

  const moved = (() => {
    try {
      const v = JSON.parse(n.moved_json) as { ids?: unknown; unique_ids?: unknown };
      return {
        ids: Array.isArray(v.ids) ? v.ids : [],
        unique_ids: Array.isArray(v.unique_ids) ? v.unique_ids : [],
      };
    } catch {
      return { ids: [], unique_ids: [] };
    }
  })();

  return c.json({
    notice: {
      id: n.id,
      created_at: n.created_at,
      moved_at: n.moved_at,
      sender: { id: n.sender_id, full_name: n.sender_name, revit_username: n.sender_revit_username },
      project: n.project_id ? { id: n.project_id, name: n.project_name ?? `#${n.project_id}` } : null,
      doc_uid: n.doc_uid,
      doc_title: n.doc_title,
      moved: { label: n.moved_label, category: n.moved_category, ids: moved.ids, unique_ids: moved.unique_ids },
      offset_mm: parseJsonArray<number>(n.offset_mm_json),
      distance_mm: n.distance_mm,
      verdict: n.verdict,
      headline: n.headline,
      conflicts: parseJsonArray<ConflictItem>(n.conflicts_json),
      issues: parseJsonArray<IssueItem>(n.issues_json),
      note: n.note,
      unresolved: parseJsonArray<string>(n.unresolved_json),
      recipients: recipients.map((r) => ({
        id: r.user_id,
        full_name: r.full_name,
        position: r.position,
        team_name: r.team_name,
        reasons: parseJsonArray<string>(r.reasons_json),
        element_keys: parseJsonArray<string>(r.element_keys_json),
        notified_at: r.notified_at,
        read_at: r.read_at,
        acknowledged_at: r.acknowledged_at,
      })),
      my: mine
        ? {
            reasons: parseJsonArray<string>(mine.reasons_json),
            element_keys: parseJsonArray<string>(mine.element_keys_json),
            read_at: mine.read_at,
            acknowledged_at: mine.acknowledged_at,
          }
        : null,
      can_ack: mine !== null && !mine.acknowledged_at,
    },
  });
});

/* ------------------------------------------------------------------ */
/*  POST /change-notices/:id/ack                                       */
/* ------------------------------------------------------------------ */

revitChangeNotices.post('/change-notices/:id{[0-9]+}/ack', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'Not found' }, 404);
  const n = await db
    .prepare('SELECT id, sender_id, moved_label FROM revit_change_notices WHERE id = ?')
    .bind(id)
    .first<{ id: number; sender_id: number; moved_label: string }>();
  if (!n) return c.json({ error: 'Not found' }, 404);
  const mine = await db
    .prepare('SELECT acknowledged_at FROM revit_change_notice_recipients WHERE notice_id = ? AND user_id = ?')
    .bind(id, user.sub)
    .first<{ acknowledged_at: string | null }>();
  if (!mine) {
    const visible = n.sender_id === user.sub || seesAllNotices(user.role);
    return visible
      ? c.json({ error: 'Only a recipient can acknowledge' }, 403)
      : c.json({ error: 'Not found' }, 404);
  }

  const r = await db
    .prepare(
      `UPDATE revit_change_notice_recipients
          SET acknowledged_at = datetime('now'), read_at = COALESCE(read_at, datetime('now'))
        WHERE notice_id = ? AND user_id = ? AND acknowledged_at IS NULL`,
    )
    .bind(id, user.sub)
    .run();
  const changed = Number(r.meta?.changes ?? 0) > 0;
  if (changed && n.sender_id !== user.sub) {
    const name = (await userName(db, user.sub)) ?? 'Ажилтан';
    await insertNotifications(db, [
      {
        user_id: n.sender_id,
        title: `${name} танилцлаа — «${n.moved_label}»`,
        body: 'Revit-ийн өөрчлөлтийн мэдэгдэлтэй танилцсан.',
        link: noticeLink(id),
      },
    ]);
  }
  const after = await db
    .prepare('SELECT acknowledged_at FROM revit_change_notice_recipients WHERE notice_id = ? AND user_id = ?')
    .bind(id, user.sub)
    .first<{ acknowledged_at: string | null }>();
  return c.json({ ok: true, acknowledged_at: after?.acknowledged_at ?? null });
});

/* ------------------------------------------------------------------ */
/*  Alias (admin)                                                      */
/* ------------------------------------------------------------------ */

revitChangeNotices.get('/aliases', async (c) => {
  const db = c.env.DB;
  const a = await db
    .prepare(
      `SELECT a.revit_username, a.revit_username_norm AS norm, a.user_id, u.full_name, a.source, a.last_seen_at
         FROM revit_user_aliases a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.revit_username_norm, a.last_seen_at DESC`,
    )
    .all<{ revit_username: string; norm: string; user_id: number; full_name: string | null; source: string; last_seen_at: string }>();
  const aliasRows = a.results ?? [];
  const aliased = new Set(aliasRows.map((r) => r.norm));

  const u = await db
    .prepare(
      `SELECT je.value AS name, n.created_at
         FROM revit_change_notices n, json_each(n.unresolved_json) je
        WHERE n.unresolved_json <> '[]'
        ORDER BY n.id DESC
        LIMIT 2000`,
    )
    .all<{ name: unknown; created_at: string }>();
  const agg = new Map<string, { revit_username: string; notice_count: number; last_at: string }>();
  for (const row of u.results ?? []) {
    const name = cleanRevitUsername(row.name);
    if (!name || aliased.has(name.norm)) continue;
    const cur = agg.get(name.norm);
    if (cur) {
      cur.notice_count += 1;
      if (row.created_at > cur.last_at) cur.last_at = row.created_at;
    } else {
      agg.set(name.norm, { revit_username: name.display, notice_count: 1, last_at: row.created_at });
    }
  }

  return c.json({
    aliases: aliasRows.map((r) => ({
      revit_username: r.revit_username,
      user: { id: r.user_id, full_name: r.full_name },
      source: r.source,
      last_seen_at: r.last_seen_at,
    })),
    unresolved: [...agg.values()].sort((x, y) => (x.last_at < y.last_at ? 1 : x.last_at > y.last_at ? -1 : 0)),
  });
});

/**
 * Шинэ холболтын дараа сүүлийн 30 хоногт тэр нэрийг «холбогдоогүй» гэж
 * хадгалсан мэдэгдлүүдийг тэр ажилтанд хүргэнэ.  Буцаах = шинээр нэмэгдсэн
 * хүлээн авагчийн мөрийн тоо.
 */
async function deliverPending(db: D1Database, norm: string, userId: number): Promise<number> {
  const r = await db
    .prepare(
      `SELECT n.id, n.sender_id, n.moved_label, n.headline, n.conflicts_json, n.unresolved_json, s.full_name AS sender_name
         FROM revit_change_notices n LEFT JOIN users s ON s.id = n.sender_id
        WHERE n.created_at >= datetime('now', ?) AND n.unresolved_json <> '[]'
        ORDER BY n.id DESC LIMIT 500`,
    )
    .bind(`-${ALIAS_DELIVERY_DAYS} days`)
    .all<{
      id: number;
      sender_id: number;
      moved_label: string;
      headline: string;
      conflicts_json: string;
      unresolved_json: string;
      sender_name: string | null;
    }>();
  const matched = (r.results ?? []).filter((n) =>
    parseJsonArray<string>(n.unresolved_json).some((name) => cleanRevitUsername(name)?.norm === norm),
  );
  if (matched.length === 0) return 0;

  const existing = new Map<number, { reasons_json: string; element_keys_json: string }>();
  for (const part of chunks(matched.map((m) => m.id), IN_CHUNK)) {
    const e = await db
      .prepare(
        `SELECT notice_id, reasons_json, element_keys_json FROM revit_change_notice_recipients
          WHERE user_id = ? AND notice_id IN (${qs(part.length)})`,
      )
      .bind(userId, ...part)
      .all<{ notice_id: number; reasons_json: string; element_keys_json: string }>();
    for (const row of e.results ?? []) existing.set(row.notice_id, row);
  }

  const stmts: D1PreparedStatement[] = [];
  const notify: NotifyRow[] = [];
  for (const n of matched) {
    const remaining = removeUnresolved(parseJsonArray<string>(n.unresolved_json), norm);
    stmts.push(
      db.prepare('UPDATE revit_change_notices SET unresolved_json = ? WHERE id = ?').bind(JSON.stringify(remaining), n.id),
    );
    if (n.sender_id === userId) continue;
    const { reasons, keys } = reasonsForUsername(parseJsonArray<ConflictItem>(n.conflicts_json), norm);
    if (reasons.length === 0) continue;
    const prev = existing.get(n.id);
    if (prev) {
      const mergedKeys = [...new Set([...parseJsonArray<string>(prev.element_keys_json), ...keys])];
      stmts.push(
        db
          .prepare(
            `UPDATE revit_change_notice_recipients SET reasons_json = ?, element_keys_json = ?
              WHERE notice_id = ? AND user_id = ?`,
          )
          .bind(JSON.stringify(mergeReasons(parseJsonArray<string>(prev.reasons_json), reasons)), JSON.stringify(mergedKeys), n.id, userId),
      );
      continue;
    }
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO revit_change_notice_recipients (notice_id, user_id, reasons_json, element_keys_json)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(n.id, userId, JSON.stringify(reasons), JSON.stringify(keys)),
    );
    notify.push({
      user_id: userId,
      title: noticeTitle(n.moved_label, reasons),
      body: noticeBody(n.headline, n.sender_name),
      link: noticeLink(n.id),
    });
  }
  await db.batch(stmts);
  await insertNotifications(db, notify);
  return notify.length;
}

async function readAliasBody(c: { req: { json: <T>() => Promise<T> } }): Promise<{ name: RevitName; userId: number } | null> {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const name = cleanRevitUsername(body?.revit_username);
  const userId = typeof body?.user_id === 'number' ? body.user_id : Number(body?.user_id);
  if (!name || !Number.isSafeInteger(userId) || userId <= 0) return null;
  return { name, userId };
}

revitChangeNotices.put('/aliases', async (c) => {
  const db = c.env.DB;
  const parsed = await readAliasBody(c);
  if (!parsed) return c.json({ error: 'revit_username and user_id are required' }, 400);
  const target = await db
    .prepare(`SELECT u.id FROM users u WHERE u.id = ? AND ${STAFF_SQL}`)
    .bind(parsed.userId)
    .first<{ id: number }>();
  if (!target) return c.json({ error: 'user must be an active staff member' }, 400);

  await db
    .prepare(
      `INSERT INTO revit_user_aliases (revit_username_norm, revit_username, user_id, source)
       VALUES (?, ?, ?, 'admin')
       ON CONFLICT(revit_username_norm, user_id) DO UPDATE
          SET source = 'admin', revit_username = excluded.revit_username, last_seen_at = datetime('now')`,
    )
    .bind(parsed.name.norm, parsed.name.display, parsed.userId)
    .run();
  const delivered = await deliverPending(db, parsed.name.norm, parsed.userId);
  return c.json({ ok: true, delivered });
});

revitChangeNotices.delete('/aliases', async (c) => {
  const parsed = await readAliasBody(c);
  if (!parsed) return c.json({ error: 'revit_username and user_id are required' }, 400);
  const r = await c.env.DB.prepare('DELETE FROM revit_user_aliases WHERE revit_username_norm = ? AND user_id = ?')
    .bind(parsed.name.norm, parsed.userId)
    .run();
  return c.json({ ok: true, deleted: Number(r.meta?.changes ?? 0) });
});

export default revitChangeNotices;
