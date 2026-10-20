import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { createTasksFromMeeting, type MeetingTaskInput } from '../../lib/meetingTasks';
import { loadMeetingProjects, sanitizeDiscussion } from '../../routes/meetings';
import { countAttendeesFromJson } from '../../lib/meetingMeta';

/** MCP tool-ийн стандарт текст хариу. */
const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

/** Транскриптийн текстийг хариунд оруулахдаа хязгаарлах (report tool-ийн
 *  500-task cap-тай адил санаа). */
const TRANSCRIPT_CHARS_CAP = 50_000;

function parseJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Хурлын тэмдэглэлийн MCP tool-ууд — Claude client-д хурлын транскрипт болон
 * AI дүгнэлтийг өгч ГҮН шинжилгээ хийлгэхэд.  Энэ feature нь зөвхөн admin-tier
 * (route-ийн `requireAdmin`-тэй нийцүүлж MglMcpAgent.init() дотор admin блокт
 * бүртгэгдэнэ) тул мөр тус бүрийн visibility шалгах шаардлагагүй.
 */
export function registerMeetingTools(server: McpServer, env: Env, _user: McpProps) {
  /* ---------------- list_meetings ---------------- */
  server.registerTool(
    'list_meetings',
    {
      title: 'List meeting notes (Хурлын тэмдэглэл)',
      description:
        'List uploaded meeting voice recordings (Хурлын тэмдэглэл) with their ' +
        'transcription/analysis status. Use to find a meeting_id before calling ' +
        'get_meeting. Optionally filter by status (uploaded / transcribing / ' +
        'transcribed / analyzing / analyzed / transcribe_failed / analyze_failed) ' +
        'or by project_id.',
      inputSchema: {
        status: z.string().optional().describe('Filter by lifecycle status.'),
        project_id: z.number().int().optional().describe('Filter by linked project id.'),
        limit: z.number().int().min(1).max(200).optional().describe('Max rows (default 50).'),
      },
    },
    async ({ status, project_id, limit }) => {
      const where: string[] = [];
      const binds: unknown[] = [];
      if (status) {
        where.push('m.status = ?');
        binds.push(status);
      }
      if (project_id != null) {
        // Олон төсөлтэй хурал (meeting_projects, 0333) төсөл бүрийнхээ
        // жагсаалтад гарна — REST `GET /api/meetings?project_id=`-тэй ижил.
        where.push(
          'EXISTS (SELECT 1 FROM meeting_projects mp WHERE mp.meeting_id = m.id AND mp.project_id = ?)',
        );
        binds.push(project_id);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      binds.push(Math.min(200, Math.max(1, limit ?? 50)));

      const { results } = await env.DB.prepare(
        `SELECT m.id, m.title, m.meeting_date, m.project_id, m.kind, m.attendees, m.language,
                m.status, m.created_at, m.participants_json,
                u.full_name AS created_by_name,
                p.name AS project_name,
                mr.duration_seconds,
                CASE WHEN ma.meeting_id IS NULL THEN 0 ELSE 1 END AS has_analysis
           FROM meetings m
           LEFT JOIN users u             ON u.id = m.created_by
           LEFT JOIN projects p          ON p.id = m.project_id
           LEFT JOIN meeting_recordings mr ON mr.meeting_id = m.id
           LEFT JOIN meeting_analyses ma ON ma.meeting_id = m.id
           ${whereSql}
           ORDER BY m.created_at DESC
           LIMIT ?`,
      )
        .bind(...binds)
        .all<Record<string, unknown> & { id: number; participants_json: string | null }>();

      const rows = results ?? [];
      const projectsByMeeting = await loadMeetingProjects(
        env.DB,
        rows.map((r) => r.id),
      );
      return txt({
        meetings: rows.map(({ participants_json, ...r }) => ({
          ...r,
          attendee_count: countAttendeesFromJson(participants_json),
          projects: projectsByMeeting.get(r.id) ?? [],
        })),
      });
    },
  );

  /* ---------------- get_meeting ---------------- */
  server.registerTool(
    'get_meeting',
    {
      title: 'Get one meeting: transcript + analysis',
      description:
        'Return ONE meeting (Хурлын тэмдэглэл): metadata, the stored Workers-AI ' +
        'analysis (Mongolian summary + decisions + action items), and — when ' +
        'include_transcript is true — the full speaker-grouped transcript text ' +
        '(capped). Call this to analyse, summarise, or answer questions about a ' +
        'meeting. Get the meeting_id from list_meetings first.',
      inputSchema: {
        meeting_id: z.number().int().describe('Meeting id from list_meetings.'),
        include_transcript: z
          .boolean()
          .optional()
          .describe('Inline the full transcript text (capped at ~50k chars). Default true.'),
      },
    },
    async ({ meeting_id, include_transcript }) => {
      const meeting = await env.DB.prepare(
        `SELECT m.id, m.title, m.meeting_date, m.meeting_time, m.location, m.purpose,
                m.conclusion, m.project_id, m.kind, m.attendees, m.language,
                m.participants_json, m.discussion_json,
                m.final_text, m.final_text_updated_at,
                m.next_meeting_date, m.next_meeting_time,
                m.status, m.error, m.created_at, m.updated_at,
                u.full_name AS created_by_name, p.name AS project_name
           FROM meetings m
           LEFT JOIN users u    ON u.id = m.created_by
           LEFT JOIN projects p ON p.id = m.project_id
          WHERE m.id = ?`,
      )
        .bind(meeting_id)
        .first<Record<string, unknown>>();
      if (!meeting) return txt({ error: `Meeting ${meeting_id} not found.` });

      // Raw JSON → structured fields (Claude талуудын байгууллагуудыг мэдсэнээр
      // discussion-ийг транскриптээс зөв ангилж бөглөж чадна).
      meeting.participants = parseJsonArray(meeting.participants_json as string | null);
      meeting.attendee_count = countAttendeesFromJson(meeting.participants_json as string | null);
      meeting.discussion = parseJsonArray(meeting.discussion_json as string | null);
      delete meeting.participants_json;
      delete meeting.discussion_json;
      // Бүх холбоотой төсөл (project_id/project_name = эхнийх нь л).
      meeting.projects = (await loadMeetingProjects(env.DB, [meeting_id])).get(meeting_id) ?? [];
      // final_text = хүний зассан эцсийн тэмдэглэл; байвал шинжилгээнд ТҮҮНИЙГ
      // ашигла (транскриптээс найдвартай).  Урт тул мөн таазлана.
      if (typeof meeting.final_text === 'string' && meeting.final_text.length > TRANSCRIPT_CHARS_CAP) {
        meeting.final_text = meeting.final_text.slice(0, TRANSCRIPT_CHARS_CAP);
        meeting.final_text_truncated = true;
      }

      const analysisRow = await env.DB.prepare(
        `SELECT summary, decisions_json, action_items_json, model, created_at
           FROM meeting_analyses WHERE meeting_id = ?`,
      )
        .bind(meeting_id)
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

      const includeTx = include_transcript !== false;
      let transcript: Record<string, unknown> | null = null;
      if (includeTx) {
        const tx = await env.DB.prepare(
          `SELECT language, transcript_text, speaker_count, word_count
             FROM meeting_transcripts WHERE meeting_id = ?`,
        )
          .bind(meeting_id)
          .first<{
            language: string | null;
            transcript_text: string | null;
            speaker_count: number | null;
            word_count: number | null;
          }>();
        if (tx) {
          const full = tx.transcript_text ?? '';
          const truncated = full.length > TRANSCRIPT_CHARS_CAP;
          transcript = {
            language: tx.language,
            speaker_count: tx.speaker_count,
            word_count: tx.word_count,
            text: truncated ? full.slice(0, TRANSCRIPT_CHARS_CAP) : full,
            truncated: truncated || undefined,
          };
        }
      }

      return txt({ meeting, analysis, transcript });
    },
  );

  /* ---------------- save_meeting_analysis (WRITE) ---------------- */
  server.registerTool(
    'save_meeting_analysis',
    {
      title: 'Save meeting analysis back to MGL',
      description:
        'Write YOUR analysis of a meeting back into MGL so it shows in the app ' +
        "(Хурлын тэмдэглэл → that meeting's analysis card). Call this AFTER you have " +
        'analysed a transcript fetched with get_meeting. Provide a Mongolian summary ' +
        'plus optional decisions and action items. Optionally also fill `discussion` — ' +
        'the per-party request tables of the printed minutes (Хэлэлцсэн асуудал: e.g. ' +
        'Захиалагч / Захиалагчийн хяналтын газар / Гүйцэтгэгч / Гүйцэтгэгчийн зөвлөх, ' +
        'each with the requesting org and its numbered remarks) and the next-meeting ' +
        'date/time if agreed. Overwrites any previous analysis and marks the meeting ' +
        'analysed. This is the fast path — it replaces the slower built-in Workers-AI ' +
        'analysis.',
      inputSchema: {
        meeting_id: z.number().int().describe('Meeting id (from get_meeting / list_meetings).'),
        summary: z.string().describe('Mongolian prose summary (3-6 sentences).'),
        decisions: z
          .array(z.string())
          .optional()
          .describe('Key decisions, each a short Mongolian sentence.'),
        action_items: z
          .array(
            z.object({
              text: z.string().describe('What needs doing (Mongolian).'),
              owner: z.string().optional().describe('Responsible person, if stated.'),
              due: z.string().optional().describe('Due date/term, if stated.'),
            }),
          )
          .optional()
          .describe('Action items with optional owner/due.'),
        discussion: z
          .array(
            z.object({
              heading: z
                .string()
                .describe('Section heading, e.g. "Захиалагч" (printed as "1.N <heading>").'),
              org: z.string().describe('Requesting organisation (Хүсэлт гаргагч).'),
              items: z.array(z.string()).describe('Numbered remarks (Тайлбар), Mongolian.'),
            }),
          )
          .optional()
          .describe(
            'Per-party discussion tables for the printed minutes. Omit to leave unchanged.',
          ),
        next_meeting_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
          .optional()
          .describe('Next meeting date (YYYY-MM-DD), if agreed. Omit to leave unchanged.'),
        next_meeting_time: z
          .string()
          .regex(/^\d{1,2}:\d{2}$/, 'Use HH:MM (24h)')
          .optional()
          .describe('Next meeting time (HH:MM, 24h), if agreed. Omit to leave unchanged.'),
      },
    },
    async ({
      meeting_id,
      summary,
      decisions,
      action_items,
      discussion,
      next_meeting_date,
      next_meeting_time,
    }) => {
      const exists = await env.DB.prepare('SELECT 1 FROM meetings WHERE id = ?')
        .bind(meeting_id)
        .first();
      if (!exists) return txt({ error: `Meeting ${meeting_id} not found.` });

      await env.DB.prepare(
        `INSERT INTO meeting_analyses (meeting_id, summary, decisions_json, action_items_json, model, created_at)
         VALUES (?1, ?2, ?3, ?4, 'claude-mcp', datetime('now'))
         ON CONFLICT(meeting_id) DO UPDATE SET
           summary = excluded.summary,
           decisions_json = excluded.decisions_json,
           action_items_json = excluded.action_items_json,
           model = excluded.model,
           created_at = datetime('now')`,
      )
        .bind(
          meeting_id,
          summary,
          JSON.stringify(decisions ?? []),
          JSON.stringify(action_items ?? []),
        )
        .run();

      // Хэлэлцсэн асуудал + дараагийн уулзалт нь analysis биш meetings мөрөнд
      // хадгалагдана (PUT /api/meetings/:id-тэй ижил газар) — өгөгдөөгүй
      // талбарыг хөндөхгүй.
      const metaSets: string[] = [];
      const metaBinds: unknown[] = [];
      if (discussion !== undefined) {
        metaSets.push('discussion_json=?');
        metaBinds.push(sanitizeDiscussion(discussion));
      }
      if (next_meeting_date !== undefined) {
        metaSets.push('next_meeting_date=?');
        metaBinds.push(next_meeting_date);
      }
      if (next_meeting_time !== undefined) {
        metaSets.push('next_meeting_time=?');
        // print хуудас HH:MM хүлээдэг тул нэг оронтой цагийг 0-оор урьдчилж тэглэнэ.
        const [h, mm] = next_meeting_time.split(':');
        metaBinds.push(`${h!.padStart(2, '0')}:${mm}`);
      }

      await env.DB.prepare(
        `UPDATE meetings SET ${metaSets.length ? metaSets.join(', ') + ', ' : ''}status='analyzed', error=NULL, updated_at=datetime('now') WHERE id=?`,
      )
        .bind(...metaBinds, meeting_id)
        .run();

      return txt({
        ok: true,
        meeting_id,
        saved: {
          decisions: (decisions ?? []).length,
          action_items: (action_items ?? []).length,
          discussion_sections: discussion?.length ?? undefined,
        },
      });
    },
  );

  /* ------- create_tasks_from_meeting_actions (WRITE) ------- */
  server.registerTool(
    'create_tasks_from_meeting_actions',
    {
      title: 'Create tasks from meeting action items',
      description:
        "Turn a meeting's action items into REAL assigned tasks in a project " +
        '(they appear on each assignee\'s MyTasks and trigger an in-app ' +
        'notification). Tasks land under a zero-weight "Хурлын даалгавар" block, ' +
        "so project progress numbers are NOT affected. If `items` is omitted, the " +
        "meeting's stored analysis action_items are used, and each item's `owner` " +
        'name is matched against active employees (a unique full-name match ' +
        'becomes the assignee; ambiguous/unknown owners are left unassigned and ' +
        'reported back). Defaults to the meeting\'s linked project.',
      inputSchema: {
        meeting_id: z.number().int().describe('Meeting id (from list_meetings).'),
        project_id: z
          .number()
          .int()
          .optional()
          .describe("Target project. Default: the meeting's linked project_id."),
        items: z
          .array(
            z.object({
              text: z.string().describe('Task name (Mongolian).'),
              assignee_ids: z
                .array(z.number().int())
                .optional()
                .describe('users.id list. Omit for unassigned.'),
              due_date: z.string().optional().describe('YYYY-MM-DD, omit if unknown.'),
            }),
          )
          .optional()
          .describe('Override items. Omit to use the stored analysis action_items.'),
      },
    },
    async ({ meeting_id, project_id, items }) => {
      // project_id: илэрхий параметр → хурлын холбоос → алдаа.
      let targetProject = project_id ?? null;
      if (targetProject === null) {
        const m = await env.DB.prepare(`SELECT project_id FROM meetings WHERE id = ?`)
          .bind(meeting_id)
          .first<{ project_id: number | null }>();
        if (!m) return txt({ error: `Meeting ${meeting_id} not found.` });
        targetProject = m.project_id;
      }
      if (targetProject === null) {
        return txt({
          error:
            'Meeting is not linked to a project — pass project_id (use list_projects to find one).',
        });
      }

      const unmatchedOwners: string[] = [];
      let resolved: MeetingTaskInput[];

      if (items && items.length > 0) {
        resolved = items.map((i) => ({
          text: i.text,
          assignee_ids: i.assignee_ids ?? [],
          due_date: i.due_date ?? null,
        }));
      } else {
        // Хадгалагдсан шинжилгээний action_items-ийг ашиглаж, owner нэрийг
        // идэвхтэй ажилтнуудтай тааруулна (зөвхөн ЦОР ГАНЦ таарвал онооно).
        const analysis = await env.DB.prepare(
          `SELECT action_items_json FROM meeting_analyses WHERE meeting_id = ?`,
        )
          .bind(meeting_id)
          .first<{ action_items_json: string | null }>();
        const raw = parseJsonArray(analysis?.action_items_json);
        if (raw.length === 0) {
          return txt({
            error:
              'No stored action items for this meeting — run/save an analysis first, or pass items explicitly.',
          });
        }

        const { results: employees } = await env.DB.prepare(
          `SELECT id, full_name FROM users WHERE status = 'active'`,
        ).all<{ id: number; full_name: string }>();

        const matchOwner = (owner: string): number | null => {
          const needle = owner.trim().toLowerCase();
          if (!needle) return null;
          const hits = (employees ?? []).filter((e) => {
            const name = e.full_name.toLowerCase();
            // Урвуу чиглэлд (owner текст нэрийг агуулах — "Батболд Дорж
            // инженер") зөвхөн ≥6 тэмдэгттэй нэрэнд зөвшөөрнө: "Бат" мэт
            // богино нэр хамаагүй текстээс санамсаргүй таарахаас сэргийлнэ.
            return name.includes(needle) || (name.length >= 6 && needle.includes(name));
          });
          return hits.length === 1 ? (hits[0]?.id ?? null) : null;
        };

        resolved = [];
        for (const a of raw) {
          const o = (typeof a === 'object' && a ? a : { text: a }) as Record<string, unknown>;
          const text = typeof o.text === 'string' ? o.text : typeof a === 'string' ? a : '';
          if (!text.trim()) continue;
          const owner = typeof o.owner === 'string' ? o.owner.trim() : '';
          const due = typeof o.due === 'string' ? o.due.trim() : '';
          const uid = owner ? matchOwner(owner) : null;
          if (owner && uid === null) unmatchedOwners.push(owner);
          resolved.push({
            text,
            assignee_ids: uid ? [uid] : [],
            // Зөвхөн ISO-маягийн огноог дамжуулна; чөлөөт текст ("даваа гариг")
            // helper дотор ч хаягдах тул энд урьдчилж шүүв.
            due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
          });
        }
      }

      const result = await createTasksFromMeeting(env, {
        meetingId: meeting_id,
        projectId: targetProject,
        items: resolved,
      });
      if (!result.ok) return txt({ error: result.error });

      return txt({
        ok: true,
        project: { id: result.project_id, name: result.project_name },
        created_count: result.tasks.length,
        tasks: result.tasks,
        unmatched_owners: unmatchedOwners.length ? unmatchedOwners : undefined,
        skipped_duplicates: result.skipped_duplicates.length
          ? result.skipped_duplicates
          : undefined,
        dropped_assignee_ids: result.dropped_assignee_ids.length
          ? result.dropped_assignee_ids
          : undefined,
        note: 'Tasks sit under the zero-weight "Хурлын даалгавар" block — project progress is unaffected. Assignees got an in-app notification.',
      });
    },
  );
}
