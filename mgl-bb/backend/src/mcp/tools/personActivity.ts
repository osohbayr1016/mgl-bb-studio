import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { todayInUB } from '../../lib/time';
import { LATE_NOT_WAIVED_SQL } from '../../lib/leaveWaiver';
import { attendanceRosterSql } from '../../lib/attendanceRoster';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

type RosterRow = { id: number; full_name: string; role: string; team_code: string | null };

/**
 * person_activity — one person's (or a team's / everyone's) historical
 * ATTENDANCE (ирц) + ACTIVITY (идэвхжил) over the last N days: present/late days,
 * late minutes, leave/OOO, plus points, approved progress entries, and projects
 * worked on.  Admin/senior only (registered in the admin-OR-senior block).
 */
export function registerPersonActivityTools(server: McpServer, env: Env, user: McpProps) {
  void user;
  server.registerTool(
    'person_activity',
    {
      title: 'Person attendance + activity history',
      description:
        "Show a person's (or a whole team's / everyone's) ATTENDANCE and ACTIVITY " +
        'over the last N days (default 30): present days, late days + total late ' +
        'minutes (approved leave/out-of-office waived), leave/OOO days, plus points ' +
        'earned, approved progress entries, and number of projects worked on. Pass ' +
        'name_or_id for one person (name substring or user id), team_code for one ' +
        'team, or neither for all active staff. Use for "how present/active has X been ' +
        'lately". Admin/senior only.',
      inputSchema: {
        name_or_id: z.string().trim().min(1).max(60).optional().describe('One person: a user id (number) or a name substring. Omit for all/team.'),
        team_code: z.string().trim().min(1).max(16).optional().describe('Restrict to one primary-team code, e.g. "ST".'),
        days: z.number().int().min(1).max(180).optional().describe('Look-back window in days (default 30).'),
      },
    },
    async ({ name_or_id, team_code, days }) => {
      try {
        const win = Math.min(180, Math.max(1, days ?? 30));
        const today = todayInUB();
        const winStart = `-${win - 1} days`;
        const pointsWin = `-${win} days`;
        const team = team_code?.trim().toUpperCase() || null;

        // ---- resolve the target roster ----
        const personRaw = name_or_id?.trim();
        const asId = personRaw && /^\d+$/.test(personRaw) ? Number(personRaw) : null;
        const rosterFilters: string[] = [attendanceRosterSql('u')];
        const rosterBinds: (string | number)[] = [];
        if (asId != null) {
          rosterFilters.push('u.id = ?');
          rosterBinds.push(asId);
        } else if (personRaw) {
          rosterFilters.push('u.full_name LIKE ?');
          rosterBinds.push(`%${personRaw}%`);
        }
        if (team) {
          rosterFilters.push('t.code = ?');
          rosterBinds.push(team);
        }
        const roster = (await env.DB.prepare(
          `SELECT u.id, u.full_name, u.role, t.code AS team_code
             FROM users u
             LEFT JOIN user_teams ut ON ut.user_id = u.id AND ut.is_primary = 1
             LEFT JOIN teams t ON t.id = ut.team_id
            WHERE ${rosterFilters.join(' AND ')}
            ORDER BY u.full_name LIMIT 200`,
        ).bind(...rosterBinds).all<RosterRow>()).results ?? [];

        if (roster.length === 0) {
          return txt({ window: { days: win, from: `date ${win}d back`, to: today }, person_count: 0, people: [], message: personRaw ? `No active person matching "${personRaw}".` : 'No active staff.' });
        }

        // ---- aggregate queries (keyed by user_id; mapped onto the roster) ----
        const [att, pts, entries, proj, leave, ooo] = await Promise.all([
          env.DB.prepare(
            `SELECT a.user_id,
                    COUNT(DISTINCT a.date) AS present_days,
                    SUM(CASE WHEN a.late_minutes > 0 AND (${LATE_NOT_WAIVED_SQL}) THEN 1 ELSE 0 END) AS late_days,
                    COALESCE(SUM(CASE WHEN (${LATE_NOT_WAIVED_SQL}) THEN a.late_minutes ELSE 0 END),0) AS late_minutes
               FROM attendance_sessions a
              WHERE a.date >= date(?, ?) AND a.date <= ?
              GROUP BY a.user_id`,
          ).bind(today, winStart, today).all<{ user_id: number; present_days: number; late_days: number; late_minutes: number }>(),
          env.DB.prepare(
            `SELECT user_id, COALESCE(SUM(amount),0) AS points, COUNT(*) AS award_count
               FROM user_points WHERE awarded_at >= datetime('now', ?) GROUP BY user_id`,
          ).bind(pointsWin).all<{ user_id: number; points: number; award_count: number }>(),
          env.DB.prepare(
            `SELECT user_id, COUNT(*) AS approved_entries
               FROM progress_entries WHERE status='approved' AND COALESCE(source, '') <> 'alloc_adj' AND date >= date(?, ?) GROUP BY user_id`,
          ).bind(today, winStart).all<{ user_id: number; approved_entries: number }>(),
          env.DB.prepare(
            `SELECT user_id, COUNT(DISTINCT project_id) AS projects_touched
               FROM daily_active_projects WHERE date >= date(?, ?) AND date <= ? GROUP BY user_id`,
          ).bind(today, winStart, today).all<{ user_id: number; projects_touched: number }>(),
          env.DB.prepare(
            `SELECT user_id, COALESCE(SUM(days),0) AS leave_days
               FROM leave_requests WHERE status='approved' AND start_date <= ? AND end_date >= date(?, ?) GROUP BY user_id`,
          ).bind(today, today, winStart).all<{ user_id: number; leave_days: number }>(),
          env.DB.prepare(
            `SELECT user_id, COUNT(*) AS ooo_days
               FROM out_of_office_requests WHERE status='approved' AND work_date >= date(?, ?) AND work_date <= ? GROUP BY user_id`,
          ).bind(today, winStart, today).all<{ user_id: number; ooo_days: number }>(),
        ]);

        const m = <T extends { user_id: number }>(res: { results?: T[] }) => new Map((res.results ?? []).map((r) => [r.user_id, r] as const));
        const attM = m(att);
        const ptsM = m(pts);
        const entM = m(entries);
        const projM = m(proj);
        const lvM = m(leave);
        const oooM = m(ooo);

        const people = roster.map((u) => {
          const a = attM.get(u.id);
          const p = ptsM.get(u.id);
          return {
            user_id: u.id,
            name: u.full_name,
            role: u.role,
            team: u.team_code,
            attendance: {
              present_days: a?.present_days ?? 0,
              late_days: a?.late_days ?? 0,
              late_minutes: a?.late_minutes ?? 0,
              leave_days: lvM.get(u.id)?.leave_days ?? 0,
              ooo_days: oooM.get(u.id)?.ooo_days ?? 0,
            },
            activity: {
              points: Math.round((p?.points ?? 0) * 10) / 10,
              award_count: p?.award_count ?? 0,
              approved_entries: entM.get(u.id)?.approved_entries ?? 0,
              projects_touched: projM.get(u.id)?.projects_touched ?? 0,
            },
          };
        });

        people.sort((x, y) => y.activity.points - x.activity.points || x.name.localeCompare(y.name));

        return txt({
          window: { days: win, to: today },
          person_count: people.length,
          people,
        });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );
}
