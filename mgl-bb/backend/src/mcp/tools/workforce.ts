import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { todayInUB, nowInUBIso } from '../../lib/time';
import { LATE_NOT_WAIVED_SQL } from '../../lib/leaveWaiver';
import { attendanceRosterSql } from '../../lib/attendanceRoster';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const dateMinus = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);
function workingDays(fromIso: string, toIso: string): number {
  let n = 0;
  const end = Date.parse(toIso + 'T00:00:00Z');
  for (let t = Date.parse(fromIso + 'T00:00:00Z'); t <= end; t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}
const ratePct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const avg = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 10) / 10 : null);
const deltaPp = (cur: number | null, prev: number | null): number | null => (cur == null || prev == null ? null : Math.round((cur - prev) * 10) / 10);
const arrow = (dv: number | null): 'up' | 'down' | 'flat' => (dv == null ? 'flat' : dv > 0.05 ? 'up' : dv < -0.05 ? 'down' : 'flat');

/**
 * analyze_workforce — discipline/capacity trend + idle staff + leave/OT load.
 * Registered for admin OR senior (matches the attendance/timesheet REST gate).
 */
export function registerWorkforceTools(server: McpServer, env: Env, user: McpProps) {
  void user;
  server.registerTool(
    'analyze_workforce',
    {
      title: 'Workforce analytics',
      description:
        'Discipline & capacity analytics this period vs the previous equal period: ' +
        'late-rate and absence-rate trend (approved leave/out-of-office waived), ' +
        'avg late minutes, leave/out-of-office load, headcount by role/team, ' +
        'and idle staff (active employees with no task on an active project). Call for ' +
        '"is discipline trending right / who is overloaded vs idle / where is leave ' +
        'concentrated". Arrow up = the metric rose; for discipline rates DOWN is GOOD. ' +
        'Admin/senior only.',
      inputSchema: {
        weeks: z.number().int().min(1).max(13).optional().describe('Current-window length in weeks (default 4); previous = equal preceding window.'),
        compare: z.boolean().optional().describe('Compute the previous-period comparison + deltas (default true).'),
        team_code: z.string().trim().min(1).max(32).optional().describe('Restrict to one team by primary team code. Omit for firm-wide.'),
      },
    },
    async ({ weeks, compare, team_code }) => {
      try {
        const w = Math.min(13, Math.max(1, weeks ?? 4));
        const cmp = compare ?? true;
        const team = team_code?.trim() || null;
        const days = w * 7;
        const today = todayInUB();
        const curStart = `-${days - 1} days`;
        const prevStart = `-${2 * days - 1} days`;
        const curBoundary = `-${days} days`;
        const curStartIso = dateMinus(today, days - 1);
        const prevStartIso = dateMinus(today, 2 * days - 1);
        const prevEndIso = dateMinus(today, days);

        const [disc, leaveRows, otOoo, headRows, idleRows] = await Promise.all([
          env.DB.prepare(
            `SELECT
               COUNT(DISTINCT CASE WHEN a.date >= date(?1, ?2) THEN a.user_id || ':' || a.date END) AS cur_present_days,
               SUM(CASE WHEN a.date >= date(?1, ?2) AND a.late_minutes > 0 AND (${LATE_NOT_WAIVED_SQL}) THEN 1 ELSE 0 END) AS cur_late_days,
               COALESCE(SUM(CASE WHEN a.date >= date(?1, ?2) AND (${LATE_NOT_WAIVED_SQL}) THEN a.late_minutes ELSE 0 END),0) AS cur_late_minutes,
               COUNT(DISTINCT CASE WHEN a.date >= date(?1, ?3) AND a.date < date(?1, ?4) THEN a.user_id || ':' || a.date END) AS prev_present_days,
               SUM(CASE WHEN a.date >= date(?1, ?3) AND a.date < date(?1, ?4) AND a.late_minutes > 0 AND (${LATE_NOT_WAIVED_SQL}) THEN 1 ELSE 0 END) AS prev_late_days,
               COALESCE(SUM(CASE WHEN a.date >= date(?1, ?3) AND a.date < date(?1, ?4) AND (${LATE_NOT_WAIVED_SQL}) THEN a.late_minutes ELSE 0 END),0) AS prev_late_minutes
             FROM attendance_sessions a
             WHERE a.clock_out IS NOT NULL AND a.date >= date(?1, ?3) AND a.date <= ?1
               AND a.user_id IN (
                 SELECT u.id FROM users u
                 LEFT JOIN user_teams ut ON ut.user_id = u.id AND ut.is_primary = 1
                 LEFT JOIN teams t ON t.id = ut.team_id
                 WHERE ${attendanceRosterSql('u')} AND (?5 IS NULL OR t.code = ?5))`,
          ).bind(today, curStart, prevStart, curBoundary, team).first<{ cur_present_days: number; cur_late_days: number; cur_late_minutes: number; prev_present_days: number; prev_late_days: number; prev_late_minutes: number }>(),
          env.DB.prepare(
            `SELECT lr.leave_type AS leave_type, COALESCE(SUM(lr.days),0) AS days
               FROM leave_requests lr
               JOIN users u ON u.id = lr.user_id AND u.status='active' AND u.role != 'client'
               LEFT JOIN user_teams ut ON ut.user_id=u.id AND ut.is_primary=1
               LEFT JOIN teams t ON t.id=ut.team_id
              WHERE lr.status='approved' AND lr.start_date <= ?1 AND lr.end_date >= date(?1, ?2) AND (?3 IS NULL OR t.code = ?3)
              GROUP BY lr.leave_type`,
          ).bind(today, curStart, team).all<{ leave_type: string | null; days: number }>(),
          env.DB.prepare(
            `SELECT
               (SELECT COUNT(*) FROM out_of_office_requests oo
                  JOIN users u ON u.id=oo.user_id AND u.status='active' AND u.role!='client'
                  LEFT JOIN user_teams ut ON ut.user_id=u.id AND ut.is_primary=1
                  LEFT JOIN teams t ON t.id=ut.team_id
                 WHERE oo.status='approved' AND oo.work_date >= date(?1,?2) AND oo.work_date <= ?1 AND (?3 IS NULL OR t.code=?3)) AS ooo_count`,
          ).bind(today, curStart, team).first<{ ooo_count: number }>(),
          env.DB.prepare(
            `SELECT t.code AS team_code, t.name_mn AS team_name, u.role AS role, COUNT(*) AS cnt
               FROM users u
               LEFT JOIN user_teams ut ON ut.user_id=u.id AND ut.is_primary=1
               LEFT JOIN teams t ON t.id=ut.team_id
              WHERE ${attendanceRosterSql('u')} AND (?1 IS NULL OR t.code=?1)
              GROUP BY t.code, u.role`,
          ).bind(team).all<{ team_code: string | null; team_name: string | null; role: string; cnt: number }>(),
          env.DB.prepare(
            `SELECT u.id AS user_id, u.full_name AS name, u.role AS role
               FROM users u
               LEFT JOIN user_teams ut ON ut.user_id=u.id AND ut.is_primary=1
               LEFT JOIN teams t ON t.id=ut.team_id
               LEFT JOIN task_assignees ta ON ta.user_id=u.id
               LEFT JOIN tasks tk ON tk.id=ta.task_id
               LEFT JOIN components co ON co.id=tk.component_id
               LEFT JOIN drawings d ON d.id=co.drawing_id
               LEFT JOIN blocks b ON b.id=d.block_id
               LEFT JOIN projects p ON p.id=b.project_id AND p.status='active'
              WHERE ${attendanceRosterSql('u')} AND (?1 IS NULL OR t.code=?1)
              GROUP BY u.id HAVING COUNT(p.id)=0 ORDER BY u.full_name LIMIT 10`,
          ).bind(team).all<{ user_id: number; name: string; role: string }>(),
        ]);

        const dd = disc ?? { cur_present_days: 0, cur_late_days: 0, cur_late_minutes: 0, prev_present_days: 0, prev_late_days: 0, prev_late_minutes: 0 };
        const byRole = new Map<string, number>();
        const byTeam = new Map<string, { name: string; count: number }>();
        for (const r of headRows.results ?? []) {
          byRole.set(r.role, (byRole.get(r.role) ?? 0) + r.cnt);
          const code = r.team_code ?? '—';
          const e = byTeam.get(code) ?? { name: r.team_name ?? '—', count: 0 };
          e.count += r.cnt;
          byTeam.set(code, e);
        }
        const headcount = [...byRole.values()].reduce((s, n) => s + n, 0);
        const curWD = workingDays(curStartIso, today);
        const prevWD = workingDays(prevStartIso, prevEndIso);

        const curLateRate = ratePct(dd.cur_late_days, dd.cur_present_days);
        const prevLateRate = ratePct(dd.prev_late_days, dd.prev_present_days);
        const curAbsence = headcount > 0 && curWD > 0 ? ratePct(Math.max(0, curWD * headcount - dd.cur_present_days), curWD * headcount) : null;
        const prevAbsence = headcount > 0 && prevWD > 0 ? ratePct(Math.max(0, prevWD * headcount - dd.prev_present_days), prevWD * headcount) : null;
        const curAvgLate = avg(dd.cur_late_minutes, dd.cur_late_days);
        const prevAvgLate = avg(dd.prev_late_minutes, dd.prev_late_days);

        const discKpi = (cur: number | null, prev: number | null) => {
          const pp = cmp ? deltaPp(cur, prev) : null;
          return { cur, prev: cmp ? prev : null, delta_pp: pp, arrow: arrow(pp) };
        };

        const leaveByType: Record<string, number> = {};
        for (const r of leaveRows.results ?? []) leaveByType[r.leave_type ?? 'other'] = r.days;
        const idle = (idleRows.results ?? []).map((r) => ({ name: r.name, role: r.role }));

        const flags: Array<{ name: string; metric: string; why: string }> = [];
        if (cmp && curLateRate != null && prevLateRate != null && curLateRate - prevLateRate >= 5) {
          flags.push({ name: 'late_rate', metric: `${curLateRate}% vs ${prevLateRate}%`, why: `Хоцролт ${deltaPp(curLateRate, prevLateRate)}pp өслөө` });
        }
        if (idle.length > 0) flags.push({ name: 'idle_staff', metric: `${idle.length}`, why: 'Идэвхтэй төслийн таск хувиарлагдаагүй ажилтан' });
        if (curAbsence != null && curAbsence >= 25) flags.push({ name: 'absence_rate', metric: `${curAbsence}%`, why: 'Ирцийн дутагдал өндөр' });

        return txt({
          generated_at: nowInUBIso(),
          window: { weeks: w, cur: [curStartIso, today], prev: [prevStartIso, prevEndIso], team_code: team },
          discipline: {
            late_rate: discKpi(curLateRate, prevLateRate),
            absence_rate: discKpi(curAbsence, prevAbsence),
            avg_late_min: discKpi(curAvgLate, prevAvgLate),
          },
          load: { leave_by_type: leaveByType, ooo_count: otOoo?.ooo_count ?? 0 },
          headcount: { total: headcount, by_role: Object.fromEntries(byRole), by_team: [...byTeam.entries()].map(([code, e]) => ({ team_code: code, team_name: e.name, count: e.count })).sort((a, b) => b.count - a.count) },
          idle_staff: idle,
          flags: flags.slice(0, 4),
        });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );
}
