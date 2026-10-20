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

type PresentRow = { user_id: number; full_name: string; clock_in: string; clock_out: string | null };
type LateRow = { user_id: number; full_name: string; clock_in: string; late_minutes: number };
type NamedRow = { id: number; full_name: string };
type LeaveRow = { id: number; full_name: string; leave_type: string | null };

/**
 * attendance_today — live roster for today (UB).  Register-gated to admin OR
 * senior in MglMcpAgent.init (company-wide aggregate, mirrors the REST
 * requireRole('admin','senior') on GET /api/attendance/stats).
 */
export function registerAttendanceTools(server: McpServer, env: Env, user: McpProps) {
  void user; // role already checked at registration; whole-company view
  server.registerTool(
    'attendance_today',
    {
      title: "Today's attendance roster",
      description:
        'Live attendance for TODAY (Ulaanbaatar): who is present, currently ' +
        'clocked-in, late (excused leave/out-of-office waived), absent, and on ' +
        'leave — with exact counts plus capped name lists. Call this for the ' +
        'morning standup or any "who is in / late / out today" question.',
      inputSchema: {
        name_cap: z.number().int().min(1).max(100).optional().describe('Max names per bucket (counts are always exact). Default 25.'),
      },
    },
    async ({ name_cap }) => {
      const cap = Math.min(100, Math.max(1, name_cap ?? 25));
      const today = todayInUB();

      const [presentRes, lateRes, absentRes, leaveRes] = await Promise.all([
        env.DB.prepare(
          `SELECT a.user_id, u.full_name, a.clock_in, a.clock_out
             FROM attendance_sessions a JOIN users u ON u.id = a.user_id
            WHERE a.date = ? ORDER BY a.clock_in ASC`,
        ).bind(today).all<PresentRow>(),
        env.DB.prepare(
          `SELECT a.user_id, u.full_name, a.clock_in, a.late_minutes
             FROM attendance_sessions a JOIN users u ON u.id = a.user_id
            WHERE a.date = ? AND a.late_minutes > 0 AND ${LATE_NOT_WAIVED_SQL}
            ORDER BY a.late_minutes DESC, a.clock_in`,
        ).bind(today).all<LateRow>(),
        env.DB.prepare(
          `SELECT u.id, u.full_name FROM users u
            WHERE ${attendanceRosterSql('u')}
              AND u.id NOT IN (SELECT user_id FROM attendance_sessions WHERE date = ?)
              AND u.id NOT IN (SELECT user_id FROM leave_requests
                                WHERE status = 'approved' AND start_date <= ? AND end_date >= ?)
              AND u.id NOT IN (SELECT user_id FROM out_of_office_requests
                                WHERE status = 'approved' AND work_date = ?)
            ORDER BY u.full_name`,
        ).bind(today, today, today, today).all<NamedRow>(),
        env.DB.prepare(
          `SELECT u.id, u.full_name, lr.leave_type
             FROM leave_requests lr JOIN users u ON u.id = lr.user_id
            WHERE lr.status = 'approved' AND lr.start_date <= ? AND lr.end_date >= ?
            ORDER BY u.full_name`,
        ).bind(today, today).all<LeaveRow>(),
      ]);

      // Dedupe present sessions by user; a user is "currently in" if ANY of
      // today's sessions has no clock_out.
      const byUser = new Map<number, { full_name: string; clock_in: string; anyOpen: boolean }>();
      for (const r of presentRes.results ?? []) {
        const prev = byUser.get(r.user_id);
        if (!prev) {
          byUser.set(r.user_id, { full_name: r.full_name, clock_in: r.clock_in, anyOpen: r.clock_out == null });
        } else if (r.clock_out == null) {
          prev.anyOpen = true;
        }
      }
      const present = [...byUser.values()];
      const currentlyIn = present.filter((p) => p.anyOpen);
      const late = lateRes.results ?? [];
      const absent = absentRes.results ?? [];
      const onLeave = leaveRes.results ?? [];

      return txt({
        date: today,
        generated_at: nowInUBIso(),
        counts: {
          present: present.length,
          currently_in: currentlyIn.length,
          late: late.length,
          absent: absent.length,
          on_leave: onLeave.length,
        },
        present: present.slice(0, cap).map((p) => ({ name: p.full_name, clock_in: p.clock_in })),
        currently_in: currentlyIn.slice(0, cap).map((p) => ({ name: p.full_name, clock_in: p.clock_in })),
        late: late.slice(0, cap).map((r) => ({ name: r.full_name, clock_in: r.clock_in, late_minutes: r.late_minutes })),
        absent: absent.slice(0, cap).map((r) => ({ name: r.full_name })),
        on_leave: onLeave.slice(0, cap).map((r) => ({ name: r.full_name, leave_type: r.leave_type })),
      });
    },
  );
}
