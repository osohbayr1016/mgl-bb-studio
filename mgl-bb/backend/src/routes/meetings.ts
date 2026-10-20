import { Hono } from 'hono';
import { launchBrowser, type BrowserSession } from '../lib/browser';
import type { Env, AppVariables } from '../types';
import { requireAdmin } from '../middleware/auth';
import { submitJob, signAudioUrl } from '../lib/speechmatics';
import { runMeetingAnalysis } from '../lib/meetingAnalysisAi';
import { createTasksFromMeeting, type MeetingTaskInput } from '../lib/meetingTasks';
import { signToken } from '../lib/jwt';
import {
  countAttendeesFromJson,
  parseProjectIds,
  resolveMeetingKind,
  type MeetingKind,
} from '../lib/meetingMeta';

/**
 * Хурлын тэмдэглэл (meeting notes) — admin-tier only (see index.ts mount +
 * `requireAdmin` below).  Audio is uploaded separately via
 * `POST /api/upload?bucket=meeting` (private MEETING_BUCKET); this module takes
 * the resulting key, records the meeting, and submits a Speechmatics batch job.
 * Completion is handled by routes/speechmatics.ts (webhook) + the cron reconcile.
 *
 * 2026-09-21 (migration 0333):
 *  - A meeting is created WITHOUT audio (`status='draft'`) and the recording is
 *    attached later through `POST /:id/audio` — the browser recorder and the
 *    file upload both land there.  `POST /` still accepts `audio_key` for the
 *    one-shot upload flow (same code path via `attachRecording`).
 *  - `meeting_projects` (N:M) is the source of truth for the project links;
 *    `meetings.project_id` is a REFLECTION (= first project) kept for the MCP
 *    task bridge and old `?project_id=` callers — only `syncMeetingProjects`
 *    writes it.  `kind='company'` ⇔ no projects (lib/meetingMeta.ts).
 *  - `final_text` is the human-edited minutes text; the raw Speechmatics
 *    output in `meeting_transcripts` is never overwritten by an edit.
 */
const meetings = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Everything here is admin-only.
meetings.use('*', requireAdmin());

const MAX_TITLE = 300;

function parseJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

interface PMember {
  name: string;
  position?: string;
  /** Linked employee (users.id) — drives the saved-signature auto-insert. */
  user_id?: number;
}
interface PGroup {
  org: string;
  members: PMember[];
}

/** Validate the structured participants payload → JSON string (or null).
 *  Shape: [{ org, members: [{ name, position? }] }]. */
function sanitizeParticipants(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const groups: PGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const og = g as Record<string, unknown>;
    const org = typeof og.org === 'string' ? og.org.trim() : '';
    const membersRaw = Array.isArray(og.members) ? og.members : [];
    const members: PMember[] = [];
    for (const m of membersRaw) {
      if (!m || typeof m !== 'object') continue;
      const om = m as Record<string, unknown>;
      const name = typeof om.name === 'string' ? om.name.trim() : '';
      if (!name) continue;
      const position =
        typeof om.position === 'string' && om.position.trim() ? om.position.trim() : undefined;
      const userId =
        typeof om.user_id === 'number' && Number.isFinite(om.user_id) ? om.user_id : undefined;
      const mem: PMember = { name };
      if (position) mem.position = position;
      if (userId !== undefined) mem.user_id = userId;
      members.push(mem);
    }
    if (org || members.length) groups.push({ org, members });
  }
  return groups.length ? JSON.stringify(groups) : null;
}

/** "Хэлэлцсэн асуудал"-ын нэг хэсэг — PDF протоколын "1.N <heading>"
 *  дугаарлагдсан хүснэгт (№ / Хүсэлт гаргагч / Тайлбар) болж хэвлэгдэнэ. */
interface DSection {
  heading: string;
  org: string;
  items: string[];
}

/** Validate the discussion payload → JSON string (or null).
 *  Shape: [{ heading, org, items: [string] }] — migration 0101-ийг үз.
 *  Exported: mcp/tools/meetings.ts-ийн save_meeting_analysis мөн ашиглана. */
export function sanitizeDiscussion(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const sections: DSection[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const os = s as Record<string, unknown>;
    const heading = typeof os.heading === 'string' ? os.heading.trim() : '';
    const org = typeof os.org === 'string' ? os.org.trim() : '';
    const items = Array.isArray(os.items)
      ? os.items
          .filter((i): i is string => typeof i === 'string' && i.trim() !== '')
          .map((i) => i.trim())
      : [];
    if (heading || org || items.length) sections.push({ heading, org, items });
  }
  return sections.length ? JSON.stringify(sections) : null;
}

/** Дараагийн уулзалтын огноо/цаг — print хуудас яг энэ форматыг шаарддаг тул
 *  (nextMeetingSentence) буруу форматтай утгыг чимээгүй null болгоно
 *  (sanitizeParticipants/sanitizeDiscussion-ы зөөлөн хэв маягтай ижил). */
function isoDateStr(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function hhmmStr(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

interface ActionItemIn {
  text: string;
  owner?: string;
  due?: string;
}
/** Validate an action-items payload → array of {text, owner?, due?}. */
function sanitizeActionItems(raw: unknown): ActionItemIn[] {
  if (!Array.isArray(raw)) return [];
  const out: ActionItemIn[] = [];
  for (const a of raw) {
    if (typeof a === 'string') {
      if (a.trim()) out.push({ text: a.trim() });
      continue;
    }
    if (a && typeof a === 'object') {
      const o = a as Record<string, unknown>;
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      if (!text) continue;
      out.push({
        text,
        owner: typeof o.owner === 'string' && o.owner.trim() ? o.owner.trim() : undefined,
        due: typeof o.due === 'string' && o.due.trim() ? o.due.trim() : undefined,
      });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- */
/*  Төслийн холбоос (meeting_projects) туслахууд                    */
/* ---------------------------------------------------------------- */

interface ProjectRef {
  id: number;
  name: string;
}

/** Байгаа төслүүдийг л үлдээнэ (ирсэн дараалал хадгалагдана). */
async function filterExistingProjectIds(db: D1Database, ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT id FROM projects WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<{ id: number }>();
  const exists = new Set((results ?? []).map((r) => r.id));
  return ids.filter((id) => exists.has(id));
}

/**
 * meeting_projects-ийг бүтнээр солино + `meetings.project_id` тусгалыг
 * (= эхний төсөл) бичнэ.  Дуудагч төслүүдийг урьдчилан шалгасан байх ёстой.
 */
async function syncMeetingProjects(db: D1Database, meetingId: number, ids: number[]): Promise<void> {
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM meeting_projects WHERE meeting_id = ?').bind(meetingId),
  ];
  ids.forEach((pid, i) => {
    stmts.push(
      db
        .prepare('INSERT INTO meeting_projects (meeting_id, project_id, sort_order) VALUES (?, ?, ?)')
        .bind(meetingId, pid, i),
    );
  });
  stmts.push(
    db.prepare('UPDATE meetings SET project_id = ? WHERE id = ?').bind(ids[0] ?? null, meetingId),
  );
  await db.batch(stmts);
}

/** Хурал тус бүрийн төслийн жагсаалт (sort_order-оор). */
export async function loadMeetingProjects(
  db: D1Database,
  meetingIds: number[],
): Promise<Map<number, ProjectRef[]>> {
  const map = new Map<number, ProjectRef[]>();
  if (!meetingIds.length) return map;
  // D1 bind таазаас (100) хол байхын тулд хэсэглэнэ.
  for (let i = 0; i < meetingIds.length; i += 80) {
    const chunk = meetingIds.slice(i, i + 80);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT mp.meeting_id, p.id, p.name
           FROM meeting_projects mp
           JOIN projects p ON p.id = mp.project_id
          WHERE mp.meeting_id IN (${placeholders})
          ORDER BY mp.meeting_id, mp.sort_order, p.id`,
      )
      .bind(...chunk)
      .all<{ meeting_id: number; id: number; name: string }>();
    for (const r of results ?? []) {
      const list = map.get(r.meeting_id) ?? [];
      list.push({ id: r.id, name: r.name });
      map.set(r.meeting_id, list);
    }
  }
  return map;
}

/* ---------------------------------------------------------------- */
/*  Бичлэг хавсаргах + STT илгээх (POST / ба POST /:id/audio)        */
/* ---------------------------------------------------------------- */

interface AudioBody {
  audio_key?: unknown;
  content_type?: unknown;
  size_bytes?: unknown;
  duration_seconds?: unknown;
}

type AttachResult =
  | { ok: false; status: 400 | 403; error: string }
  | { ok: true; status: 'transcribing' | 'transcribe_failed'; jobId?: string; error?: string };

/**
 * Байршуулсан аудиог хуралд хавсаргаад Speechmatics-д илгээнэ.  Өмнөх
 * бичлэг байвал R2 объект + мөрийг устгаж, хуучин транскриптийг хаяна
 * (дахин бичлэг = шинэ транскрипт); `final_text` ХӨНДӨГДӨХГҮЙ.
 */
async function attachRecording(
  c: { env: Env; req: { url: string } },
  user: { sub: number; role: AppVariables['user']['role'] },
  meetingId: number,
  language: string,
  body: AudioBody,
): Promise<AttachResult> {
  const audioKey = typeof body.audio_key === 'string' ? body.audio_key : '';
  if (!audioKey) return { ok: false, status: 400, error: 'audio_key шаардлагатай' };
  // Keys are minted server-side as `<userSub>-...`; a user may only attach their
  // own freshly-uploaded object (mirrors upload.ts `ownsKey`).
  if (!audioKey.startsWith(`${user.sub}-`)) {
    return { ok: false, status: 403, error: 'Forbidden audio key' };
  }

  // Confirm the object actually landed in the private bucket; pull real
  // size/content-type from R2 when the client didn't send them.
  const head = await c.env.MEETING_BUCKET.head(audioKey);
  if (!head) return { ok: false, status: 400, error: 'Аудио файл олдсонгүй (upload амжилтгүй?)' };

  const contentType =
    typeof body.content_type === 'string' && body.content_type
      ? body.content_type
      : (head.httpMetadata?.contentType ?? null);
  const sizeBytes =
    typeof body.size_bytes === 'number' && Number.isFinite(body.size_bytes)
      ? body.size_bytes
      : head.size;
  // Client-estimated audio duration (read from file metadata) so the UI can
  // show a time-based progress bar while transcribing.  Refined to the exact
  // value from the Speechmatics job on completion.
  const durationSeconds =
    typeof body.duration_seconds === 'number' &&
    Number.isFinite(body.duration_seconds) &&
    body.duration_seconds > 0
      ? body.duration_seconds
      : null;

  // Өмнөх бичлэгийг цэвэрлэнэ (R2 объект + мөр + хуучин транскрипт).
  const { results: old } = await c.env.DB.prepare(
    'SELECT audio_key FROM meeting_recordings WHERE meeting_id = ?',
  )
    .bind(meetingId)
    .all<{ audio_key: string }>();
  for (const r of old ?? []) {
    if (r.audio_key && r.audio_key !== audioKey) {
      try {
        await c.env.MEETING_BUCKET.delete(r.audio_key);
      } catch (err) {
        console.warn('[meetings] R2 delete failed', r.audio_key, err);
      }
    }
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM meeting_recordings WHERE meeting_id = ?').bind(meetingId),
    c.env.DB.prepare('DELETE FROM meeting_transcripts WHERE meeting_id = ?').bind(meetingId),
    c.env.DB.prepare(
      `INSERT INTO meeting_recordings (meeting_id, audio_key, content_type, size_bytes, duration_seconds, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))`,
    ).bind(meetingId, audioKey, contentType, sizeBytes, durationSeconds),
    c.env.DB.prepare(
      `UPDATE meetings SET status='uploaded', error=NULL, updated_at=datetime('now') WHERE id=?`,
    ).bind(meetingId),
  ]);

  // Submit the Speechmatics batch job (fetch_data + notification webhook).
  if (!c.env.SPEECHMATICS_API_KEY) {
    await c.env.DB.prepare(
      `UPDATE meetings SET status='transcribe_failed', error='SPEECHMATICS_API_KEY тохируулагдаагүй', updated_at=datetime('now') WHERE id=?`,
    )
      .bind(meetingId)
      .run();
    return { ok: true, status: 'transcribe_failed', error: 'STT тохируулагдаагүй' };
  }

  const origin = new URL(c.req.url).origin;
  try {
    const jobId = await submitJob({
      env: c.env,
      origin,
      meetingId,
      audioKey,
      language,
      user: { sub: user.sub, role: user.role },
    });
    await c.env.DB.prepare(
      `UPDATE meeting_recordings SET stt_job_id=?, submitted_at=datetime('now') WHERE meeting_id=?`,
    )
      .bind(jobId, meetingId)
      .run();
    await c.env.DB.prepare(
      `UPDATE meetings SET status='transcribing', updated_at=datetime('now') WHERE id=?`,
    )
      .bind(meetingId)
      .run();
    return { ok: true, status: 'transcribing', jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'STT submit failed';
    await c.env.DB.prepare(
      `UPDATE meetings SET status='transcribe_failed', error=?, updated_at=datetime('now') WHERE id=?`,
    )
      .bind(msg.slice(0, 300), meetingId)
      .run();
    return { ok: true, status: 'transcribe_failed', error: msg };
  }
}

/* ---------------------------------------------------------------- */
/*  POST /api/meetings — create (+ optional audio → transcription)  */
/* ---------------------------------------------------------------- */
meetings.post('/', async (c) => {
  const user = c.get('user');
  let body: {
    title?: unknown;
    meeting_date?: unknown;
    meeting_time?: unknown;
    location?: unknown;
    purpose?: unknown;
    conclusion?: unknown;
    participants?: unknown;
    discussion?: unknown;
    next_meeting_date?: unknown;
    next_meeting_time?: unknown;
    project_id?: unknown;
    project_ids?: unknown;
    kind?: unknown;
    attendees?: unknown;
    language?: unknown;
    final_text?: unknown;
  } & AudioBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
  if (!title) return c.json({ error: 'Гарчиг шаардлагатай' }, 400);

  const hasAudio = typeof body.audio_key === 'string' && body.audio_key !== '';

  const requestedIds = parseProjectIds(body) ?? [];
  const existingIds = await filterExistingProjectIds(c.env.DB, requestedIds);
  if (existingIds.length !== requestedIds.length) {
    return c.json({ error: 'Төсөл олдсонгүй' }, 400);
  }
  const kindRes = resolveMeetingKind(body.kind, existingIds);
  if (!kindRes.ok) return c.json({ error: kindRes.error }, 400);

  const meetingDate =
    typeof body.meeting_date === 'string' && body.meeting_date.trim()
      ? body.meeting_date.trim()
      : null;
  const attendees =
    typeof body.attendees === 'string' && body.attendees.trim() ? body.attendees.trim() : null;
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'mn';
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const meetingTime = str(body.meeting_time);
  const location = str(body.location);
  const purpose = str(body.purpose);
  const conclusion = str(body.conclusion);
  const participantsJson = sanitizeParticipants(body.participants);
  const discussionJson = sanitizeDiscussion(body.discussion);
  const nextMeetingDate = isoDateStr(body.next_meeting_date);
  // Огноогүй цаг протоколд хэзээ ч хэвлэгдэхгүй тул хамт null болгоно.
  const nextMeetingTime = nextMeetingDate ? hhmmStr(body.next_meeting_time) : null;
  // Бичлэггүй хурлын гараар бичсэн тэмдэглэл шууд ирж болно.
  const finalText = typeof body.final_text === 'string' && body.final_text.trim() ? body.final_text : null;

  // 1) Create the meeting row.  Without audio it is a `draft` — the recording
  //    (browser recorder / file) arrives later through POST /:id/audio.
  const ins = await c.env.DB.prepare(
    `INSERT INTO meetings (title, meeting_date, meeting_time, location, purpose, conclusion,
                           participants_json, discussion_json, next_meeting_date, next_meeting_time,
                           project_id, kind, attendees, language, status,
                           final_text, final_text_updated_at, final_text_updated_by,
                           created_by, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'draft',
             ?15, CASE WHEN ?15 IS NULL THEN NULL ELSE datetime('now') END, CASE WHEN ?15 IS NULL THEN NULL ELSE ?16 END,
             ?16, datetime('now'), datetime('now'))`,
  )
    .bind(
      title,
      meetingDate,
      meetingTime,
      location,
      purpose,
      conclusion,
      participantsJson,
      discussionJson,
      nextMeetingDate,
      nextMeetingTime,
      kindRes.projectIds[0] ?? null,
      kindRes.kind,
      attendees,
      language,
      finalText,
      user.sub,
    )
    .run();
  const meetingId = Number(ins.meta.last_row_id);
  await syncMeetingProjects(c.env.DB, meetingId, kindRes.projectIds);

  if (!hasAudio) return c.json({ meetingId, status: 'draft' }, 201);

  // 2) One-shot flow: attach the uploaded audio + submit STT.
  const res = await attachRecording(c, user, meetingId, language, body);
  if (!res.ok) {
    // The meeting row already exists — keep it as a draft rather than
    // stranding the upload; the client can retry from the detail page.
    return c.json({ meetingId, status: 'draft', error: res.error }, res.status);
  }
  if (res.status === 'transcribing') {
    return c.json({ meetingId, status: 'transcribing', jobId: res.jobId }, 202);
  }
  return c.json({ meetingId, status: 'transcribe_failed', error: res.error }, 201);
});

/* ---------------------------------------------------------------- */
/*  POST /api/meetings/:id/audio — attach a recording (later)        */
/* ---------------------------------------------------------------- */
meetings.post('/:id/audio', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: AudioBody & { language?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const m = await c.env.DB.prepare('SELECT status, language FROM meetings WHERE id = ?')
    .bind(id)
    .first<{ status: string; language: string }>();
  if (!m) return c.json({ error: 'Олдсонгүй' }, 404);
  if (m.status === 'transcribing' || m.status === 'analyzing') {
    return c.json({ error: 'Хөрвүүлэлт явагдаж байна — дуусахыг хүлээнэ үү' }, 409);
  }

  const language =
    typeof body.language === 'string' && body.language.trim() ? body.language.trim() : m.language || 'mn';
  if (language !== m.language) {
    await c.env.DB.prepare('UPDATE meetings SET language = ? WHERE id = ?').bind(language, id).run();
  }

  const res = await attachRecording(c, user, id, language, body);
  if (!res.ok) return c.json({ error: res.error }, res.status);
  if (res.status === 'transcribing') {
    return c.json({ meetingId: id, status: 'transcribing', jobId: res.jobId }, 202);
  }
  return c.json({ meetingId: id, status: 'transcribe_failed', error: res.error }, 201);
});

/* ---------------------------------------------------------------- */
/*  GET /api/meetings — list                                        */
/* ---------------------------------------------------------------- */
meetings.get('/', async (c) => {
  const statusFilter = c.req.query('status');
  const projectIdRaw = c.req.query('project_id');
  const kindRaw = c.req.query('kind');
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') ?? '100', 10) || 100));

  const where: string[] = [];
  const binds: unknown[] = [];
  if (statusFilter) {
    where.push('m.status = ?');
    binds.push(statusFilter);
  }
  if (projectIdRaw) {
    const pid = parseInt(projectIdRaw, 10);
    if (Number.isFinite(pid)) {
      // Олон төсөлтэй хурал төсөл бүрийнхээ жагсаалтад гарна.
      where.push('EXISTS (SELECT 1 FROM meeting_projects mp WHERE mp.meeting_id = m.id AND mp.project_id = ?)');
      binds.push(pid);
    }
  }
  if (kindRaw === 'company' || kindRaw === 'project') {
    where.push('m.kind = ?');
    binds.push(kindRaw);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  binds.push(limit);

  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.title, m.meeting_date, m.meeting_time, m.project_id, m.kind, m.attendees, m.language,
            m.status, m.error, m.created_by, m.created_at, m.updated_at,
            m.participants_json,
            u.full_name AS created_by_name,
            p.name AS project_name,
            mr.duration_seconds, mr.content_type, mr.submitted_at,
            CASE WHEN ma.meeting_id IS NULL THEN 0 ELSE 1 END AS has_analysis,
            CASE WHEN mt.transcript_text IS NULL THEN 0 ELSE 1 END AS has_transcript,
            CASE WHEN m.final_text IS NULL OR m.final_text = '' THEN 0 ELSE 1 END AS has_final_text
       FROM meetings m
       LEFT JOIN users u             ON u.id = m.created_by
       LEFT JOIN projects p          ON p.id = m.project_id
       LEFT JOIN meeting_recordings mr ON mr.meeting_id = m.id
       LEFT JOIN meeting_transcripts mt ON mt.meeting_id = m.id
       LEFT JOIN meeting_analyses ma ON ma.meeting_id = m.id
       ${whereSql}
       ORDER BY m.created_at DESC
       LIMIT ?`,
  )
    .bind(...binds)
    .all<Record<string, unknown> & { id: number; participants_json: string | null }>();

  const rows = results ?? [];
  const projectsByMeeting = await loadMeetingProjects(
    c.env.DB,
    rows.map((r) => r.id),
  );
  const list = rows.map(({ participants_json, ...r }) => ({
    ...r,
    attendee_count: countAttendeesFromJson(participants_json),
    projects: projectsByMeeting.get(r.id) ?? [],
  }));

  return c.json({ meetings: list });
});

/* ---------------------------------------------------------------- */
/*  GET /api/meetings/:id — full bundle                             */
/* ---------------------------------------------------------------- */
meetings.get('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const meeting = await c.env.DB.prepare(
    `SELECT m.*, u.full_name AS created_by_name, p.name AS project_name,
            fu.full_name AS final_text_updated_by_name
       FROM meetings m
       LEFT JOIN users u    ON u.id = m.created_by
       LEFT JOIN users fu   ON fu.id = m.final_text_updated_by
       LEFT JOIN projects p ON p.id = m.project_id
      WHERE m.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!meeting) return c.json({ error: 'Олдсонгүй' }, 404);
  meeting.projects = (await loadMeetingProjects(c.env.DB, [id])).get(id) ?? [];
  meeting.attendee_count = countAttendeesFromJson(meeting.participants_json as string | null);

  const recording = await c.env.DB.prepare(
    `SELECT id, audio_key, content_type, size_bytes, duration_seconds, stt_provider,
            stt_job_id, stt_status, submitted_at, completed_at
       FROM meeting_recordings WHERE meeting_id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();

  const transcript = await c.env.DB.prepare(
    `SELECT language, transcript_text, speaker_count, word_count, created_at
       FROM meeting_transcripts WHERE meeting_id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();

  const analysisRow = await c.env.DB.prepare(
    `SELECT summary, decisions_json, action_items_json, model, created_at
       FROM meeting_analyses WHERE meeting_id = ?`,
  )
    .bind(id)
    .first<{
      summary: string | null;
      decisions_json: string | null;
      action_items_json: string | null;
      model: string | null;
      created_at: string;
    }>();

  const analysis = analysisRow
    ? {
        summary: analysisRow.summary,
        decisions: parseJsonArray(analysisRow.decisions_json),
        action_items: parseJsonArray(analysisRow.action_items_json),
        model: analysisRow.model,
        created_at: analysisRow.created_at,
      }
    : null;

  // Short-lived signed URL for in-app playback (the <audio> tag can't carry a
  // bearer token, so the token rides in the query string).
  let audioUrl: string | null = null;
  const audioKey = recording?.audio_key;
  if (typeof audioKey === 'string') {
    audioUrl = await signAudioUrl(c.env, new URL(c.req.url).origin, audioKey, {
      sub: user.sub,
      role: user.role,
    });
  }

  // Parse structured participants for the client (raw JSON stays on the row too).
  const groups = parseJsonArray(meeting.participants_json as string | null | undefined) as Array<{
    org: string;
    members: Array<{ name: string; position?: string; user_id?: number; signature_url?: string | null }>;
  }>;
  // Enrich members linked to an employee with their saved signature image so
  // the minutes PDF can render it (auto-insert, no hand signature needed).
  const ids = new Set<number>();
  for (const g of groups) for (const mem of g.members ?? []) if (typeof mem.user_id === 'number') ids.add(mem.user_id);
  if (ids.size) {
    const list = [...ids];
    const placeholders = list.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT id, signature_url FROM users WHERE id IN (${placeholders})`,
    )
      .bind(...list)
      .all<{ id: number; signature_url: string | null }>();
    const map = new Map((results ?? []).map((r) => [r.id, r.signature_url]));
    for (const g of groups)
      for (const mem of g.members ?? [])
        if (typeof mem.user_id === 'number') mem.signature_url = map.get(mem.user_id) ?? null;
  }
  meeting.participants = groups;
  // Structured discussion sections for the editor/print (raw JSON stays too).
  meeting.discussion = parseJsonArray(meeting.discussion_json as string | null | undefined);

  return c.json({ meeting, recording, transcript, analysis, audio_url: audioUrl });
});

/* ---------------------------------------------------------------- */
/*  POST /api/meetings/:id/analyze — (re-)run analysis              */
/* ---------------------------------------------------------------- */
meetings.post('/:id/analyze', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  // Транскрипт ЭСВЭЛ гараар бичсэн эцсийн текст — аль нэг нь байхад л
  // шинжилнэ (lib/meetingAnalysisAi.ts final_text-ийг илүүд үздэг).
  const t = await c.env.DB.prepare(
    `SELECT 1 FROM meetings m
      WHERE m.id = ?
        AND ((m.final_text IS NOT NULL AND m.final_text <> '')
             OR EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = m.id AND mt.transcript_text IS NOT NULL))`,
  )
    .bind(id)
    .first();
  if (!t) return c.json({ error: 'Транскрипт бэлэн биш байна' }, 409);

  await c.env.DB.prepare(
    `UPDATE meetings SET status='analyzing', error=NULL, updated_at=datetime('now') WHERE id=?`,
  )
    .bind(id)
    .run();
  c.executionCtx.waitUntil(runMeetingAnalysis(c.env, id));
  return c.json({ meetingId: id, status: 'analyzing' }, 202);
});

/* ---------------------------------------------------------------- */
/*  POST /api/meetings/:id/retranscribe — resubmit STT              */
/* ---------------------------------------------------------------- */
meetings.post('/:id/retranscribe', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  if (!c.env.SPEECHMATICS_API_KEY) return c.json({ error: 'STT тохируулагдаагүй' }, 503);

  let body: { language?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body optional */
  }

  const rec = await c.env.DB.prepare(
    `SELECT mr.audio_key AS audio_key, m.language AS language
       FROM meeting_recordings mr JOIN meetings m ON m.id = mr.meeting_id
      WHERE mr.meeting_id = ?`,
  )
    .bind(id)
    .first<{ audio_key: string; language: string }>();
  if (!rec) return c.json({ error: 'Олдсонгүй' }, 404);

  const language =
    typeof body.language === 'string' && body.language.trim() ? body.language.trim() : rec.language;

  const origin = new URL(c.req.url).origin;
  try {
    const jobId = await submitJob({
      env: c.env,
      origin,
      meetingId: id,
      audioKey: rec.audio_key,
      language,
      user: { sub: user.sub, role: user.role },
    });
    await c.env.DB.prepare(
      `UPDATE meeting_recordings SET stt_job_id=?, submitted_at=datetime('now'), stt_status=NULL, completed_at=NULL WHERE meeting_id=?`,
    )
      .bind(jobId, id)
      .run();
    await c.env.DB.prepare(
      `UPDATE meetings SET status='transcribing', error=NULL, language=?, updated_at=datetime('now') WHERE id=?`,
    )
      .bind(language, id)
      .run();
    return c.json({ meetingId: id, status: 'transcribing', jobId }, 202);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'STT submit failed';
    await c.env.DB.prepare(
      `UPDATE meetings SET status='transcribe_failed', error=?, updated_at=datetime('now') WHERE id=?`,
    )
      .bind(msg.slice(0, 300), id)
      .run();
    return c.json({ error: msg }, 502);
  }
});

/* ---------------------------------------------------------------- */
/*  DELETE /api/meetings/:id                                        */
/* ---------------------------------------------------------------- */
meetings.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const rec = await c.env.DB.prepare('SELECT audio_key FROM meeting_recordings WHERE meeting_id=?')
    .bind(id)
    .first<{ audio_key: string }>();
  if (rec?.audio_key) {
    try {
      await c.env.MEETING_BUCKET.delete(rec.audio_key);
    } catch (err) {
      console.warn('[meetings] R2 delete failed', rec.audio_key, err);
    }
  }
  // D1 нь FK-г runtime-д мөрддөггүй тул хүүхэд мөрүүдийг гараар устгана
  // (transcript.json R2 хуулбар ч мөн адил).
  try {
    await c.env.MEETING_BUCKET.delete(`meetings/${id}/transcript.json`);
  } catch {
    /* best-effort */
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM meeting_projects WHERE meeting_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM meeting_recordings WHERE meeting_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM meeting_transcripts WHERE meeting_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM meeting_analyses WHERE meeting_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM meetings WHERE id=?').bind(id),
  ]);
  return c.body(null, 204);
});

/* ---------------------------------------------------------------- */
/*  PUT /api/meetings/:id — edit minutes metadata                   */
/* ---------------------------------------------------------------- */
meetings.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.title === 'string') {
    const tt = body.title.trim().slice(0, MAX_TITLE);
    if (!tt) return c.json({ error: 'Гарчиг хоосон байж болохгүй' }, 400);
    sets.push('title=?');
    binds.push(tt);
  }
  if ('meeting_date' in body) {
    sets.push('meeting_date=?');
    binds.push(str(body.meeting_date));
  }
  if ('meeting_time' in body) {
    sets.push('meeting_time=?');
    binds.push(str(body.meeting_time));
  }
  if ('location' in body) {
    sets.push('location=?');
    binds.push(str(body.location));
  }
  if ('purpose' in body) {
    sets.push('purpose=?');
    binds.push(str(body.purpose));
  }
  if ('conclusion' in body) {
    sets.push('conclusion=?');
    binds.push(str(body.conclusion));
  }
  if ('attendees' in body) {
    sets.push('attendees=?');
    binds.push(str(body.attendees));
  }
  if ('language' in body) {
    sets.push('language=?');
    binds.push(str(body.language) ?? 'mn');
  }
  // Төслүүд / төрөл: `meetings.project_id`-г энд ШУУД бичихгүй — эх сурвалж
  // нь meeting_projects, тусгалыг syncMeetingProjects л бичнэ (UPDATE-ийн дараа).
  let projectSync: { kind: MeetingKind; ids: number[] } | null = null;
  const requestedIds = parseProjectIds(body);
  if (requestedIds !== undefined || 'kind' in body) {
    const current = await c.env.DB.prepare('SELECT kind FROM meetings WHERE id=?')
      .bind(id)
      .first<{ kind: string }>();
    if (!current) return c.json({ error: 'Олдсонгүй' }, 404);
    let ids: number[];
    if (requestedIds !== undefined) {
      ids = await filterExistingProjectIds(c.env.DB, requestedIds);
      if (ids.length !== requestedIds.length) return c.json({ error: 'Төсөл олдсонгүй' }, 400);
    } else {
      ids = ((await loadMeetingProjects(c.env.DB, [id])).get(id) ?? []).map((p) => p.id);
    }
    const kindRes = resolveMeetingKind('kind' in body ? body.kind : undefined, ids);
    if (!kindRes.ok) return c.json({ error: kindRes.error }, 400);
    projectSync = { kind: kindRes.kind, ids: kindRes.projectIds };
    sets.push('kind=?');
    binds.push(kindRes.kind);
  }
  if ('participants' in body) {
    sets.push('participants_json=?');
    binds.push(sanitizeParticipants(body.participants));
  }
  if ('discussion' in body) {
    sets.push('discussion_json=?');
    binds.push(sanitizeDiscussion(body.discussion));
  }
  if ('next_meeting_date' in body) {
    sets.push('next_meeting_date=?');
    binds.push(isoDateStr(body.next_meeting_date));
  }
  if ('next_meeting_time' in body) {
    sets.push('next_meeting_time=?');
    // Огноо нь мөн энэ хүсэлтээр хоосорч/буруу байвал цагийг дагуулж null
    // болгоно — огноогүй цаг протоколд хэзээ ч хэвлэгдэхгүй.
    const dateCleared = 'next_meeting_date' in body && isoDateStr(body.next_meeting_date) === null;
    binds.push(dateCleared ? null : hhmmStr(body.next_meeting_time));
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);

  sets.push("updated_at=datetime('now')");
  binds.push(id);
  const res = await c.env.DB.prepare(`UPDATE meetings SET ${sets.join(', ')} WHERE id=?`)
    .bind(...binds)
    .run();
  if (!res.meta.changes) return c.json({ error: 'Олдсонгүй' }, 404);
  if (projectSync) await syncMeetingProjects(c.env.DB, id, projectSync.ids);
  return c.json({ ok: true });
});

/* ---------------------------------------------------------------- */
/*  PUT /api/meetings/:id/final-text — хүний зассан эцсийн текст     */
/* ---------------------------------------------------------------- */
// Транскрипт (meeting_transcripts.transcript_text) ХӨНДӨГДӨХГҮЙ — тэр бол
// Speechmatics-ийн түүхий гаралт, дахин хөрвүүлэлт түүнийг дарж бичдэг.
// Эцсийн текст нь тусдаа багана; хоосон илгээвэл NULL (устгасан гэсэн үг).
meetings.put('/:id/final-text', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: { text?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof body.text !== 'string') return c.json({ error: 'text шаардлагатай' }, 400);
  // D1-ийн нэг утгын хязгаараас доогуур барина (2 цагийн хурал ~100k тэмдэгт).
  if (body.text.length > 1_000_000) return c.json({ error: 'Текст хэт урт' }, 413);
  const text = body.text.trim() ? body.text : null;

  const res = await c.env.DB.prepare(
    `UPDATE meetings
        SET final_text = ?1,
            final_text_updated_at = CASE WHEN ?1 IS NULL THEN NULL ELSE datetime('now') END,
            final_text_updated_by = CASE WHEN ?1 IS NULL THEN NULL ELSE ?2 END,
            updated_at = datetime('now')
      WHERE id = ?3`,
  )
    .bind(text, user.sub, id)
    .run();
  if (!res.meta.changes) return c.json({ error: 'Олдсонгүй' }, 404);
  return c.json({
    ok: true,
    final_text: text,
    final_text_updated_at: text ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
    final_text_updated_by: text ? user.sub : null,
  });
});

/* ---------------------------------------------------------------- */
/*  PUT /api/meetings/:id/analysis — edit the analysis              */
/* ---------------------------------------------------------------- */
meetings.put('/:id/analysis', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: { summary?: unknown; decisions?: unknown; action_items?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const exists = await c.env.DB.prepare('SELECT 1 FROM meetings WHERE id=?').bind(id).first();
  if (!exists) return c.json({ error: 'Олдсонгүй' }, 404);

  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  const decisions = Array.isArray(body.decisions)
    ? body.decisions.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
    : [];
  const actionItems = sanitizeActionItems(body.action_items);

  await c.env.DB.prepare(
    `INSERT INTO meeting_analyses (meeting_id, summary, decisions_json, action_items_json, model, created_at)
     VALUES (?1, ?2, ?3, ?4, 'manual-edit', datetime('now'))
     ON CONFLICT(meeting_id) DO UPDATE SET
       summary = excluded.summary,
       decisions_json = excluded.decisions_json,
       action_items_json = excluded.action_items_json,
       model = excluded.model,
       created_at = datetime('now')`,
  )
    .bind(id, summary || null, JSON.stringify(decisions), JSON.stringify(actionItems))
    .run();

  await c.env.DB.prepare(
    `UPDATE meetings SET status='analyzed', error=NULL, updated_at=datetime('now') WHERE id=?`,
  )
    .bind(id)
    .run();

  return c.json({ ok: true });
});

/* ---------------------------------------------------------------- */
/*  POST /api/meetings/:id/tasks — action item → даалгавар гүүр     */
/* ---------------------------------------------------------------- */
// Шинжилгээний "хийх ажлууд"-ыг сонгосон төслийн "Хурлын даалгавар"
// (weight 0) модонд жинхэнэ tasks болгож, оноогдсон хүмүүст мэдэгдэнэ.
// Жин 0 тул төслийн явцын тоонд нөлөөлөхгүй — lib/meetingTasks.ts-ийг үз.
meetings.post('/:id/tasks', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  let body: { project_id?: unknown; items?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // project_id ирээгүй бол хурлын холбогдсон төслөөр fallback хийнэ.
  let projectId =
    typeof body.project_id === 'number' && Number.isFinite(body.project_id)
      ? body.project_id
      : null;
  if (projectId === null) {
    const m = await c.env.DB.prepare(`SELECT project_id FROM meetings WHERE id = ?`)
      .bind(id)
      .first<{ project_id: number | null }>();
    projectId = m?.project_id ?? null;
  }
  if (projectId === null) {
    return c.json({ error: 'project_id required (хурал төсөлтэй холбогдоогүй)' }, 400);
  }

  const itemsRaw = Array.isArray(body.items) ? body.items : [];
  const items: MeetingTaskInput[] = [];
  for (const i of itemsRaw) {
    if (!i || typeof i !== 'object') continue;
    const o = i as Record<string, unknown>;
    items.push({
      text: typeof o.text === 'string' ? o.text : '',
      assignee_ids: Array.isArray(o.assignee_ids)
        ? o.assignee_ids.filter((n): n is number => typeof n === 'number')
        : [],
      due_date: typeof o.due_date === 'string' ? o.due_date : null,
    });
  }

  const result = await createTasksFromMeeting(c.env, { meetingId: id, projectId, items });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result, 201);
});

/* ---------------------------------------------------------------- */
/*  GET /api/meetings/:id/pdf — server-side PDF via Browser Rendering */
/* ---------------------------------------------------------------- */
meetings.get('/:id/pdf', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare('SELECT title, meeting_date FROM meetings WHERE id=?')
    .bind(id)
    .first<{ title: string; meeting_date: string | null }>();
  if (!row) return c.json({ error: 'Олдсонгүй' }, 404);

  // Протоколын хуудас бүрийн зүүн доод булангийн огноо ("2026.01.30") —
  // footerTemplate нь @page margin band дотор зурагддаг тул контенттой
  // хэзээ ч давхцахгүй (print хуудасны in-flow .mp-footdate-ийг headless
  // үед нуудаг, доорх data-headless marker-ийг үз). Зөвхөн цифр тул
  // footerTemplate-ийн фонтын хязгаарлалт нөлөөгүй.
  const footDate =
    row.meeting_date && /^\d{4}-\d{2}-\d{2}$/.test(row.meeting_date)
      ? row.meeting_date.replace(/-/g, '.')
      : '';

  // Short-lived admin token the print page bridges into localStorage so its
  // GET /api/meetings/:id passes requireAdmin during the headless render.
  const printToken = await signToken(
    { sub: user.sub, role: user.role, purpose: 'print' },
    c.env.JWT_SECRET,
    1 / 60, // 1 minute
  );
  const printUrl =
    `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/meetings/${id}/print` +
    `?t=${encodeURIComponent(printToken)}`;

  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(c.env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    try {
      await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    } catch {
      /* render whatever we have */
    }

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: !!footDate,
      headerTemplate: '<span></span>',
      footerTemplate: footDate
        ? `<div style="font-size:9px; width:100%; padding-left:12mm; font-family:Arial, sans-serif; color:#111;">${footDate}</div>`
        : '<span></span>',
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });

    const safeName =
      (row.title || 'meeting')
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'meeting';

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[meeting-pdf] render failed', err);
    return c.json(
      { error: 'PDF үүсгэхэд алдаа гарлаа', detail: err instanceof Error ? err.message : String(err) },
      500,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* swallow */
      }
    }
  }
});

export default meetings;
