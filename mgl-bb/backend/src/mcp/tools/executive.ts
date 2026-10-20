import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { todayInUB, nowInUBIso } from '../../lib/time';
import { queryAttendanceForDate } from '../../routes/company';
import { fetchVisibleProjects } from './projects';
import { LATE_NOT_WAIVED_SQL } from '../../lib/leaveWaiver';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const arrow = (cur: number, prev: number, eps = 0): 'up' | 'down' | 'flat' =>
  cur - prev > eps ? 'up' : prev - cur > eps ? 'down' : 'flat';
const pct = (cur: number, prev: number): number | null =>
  prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10;

/** Schedule variance (actual − expected progress) from passport timeline. null if dates missing. */
function scheduleVariance(
  row: { progress: number | null; start_date?: string | null; finish_date?: string | null },
  today: string,
): number | null {
  const s = row.start_date;
  const f = row.finish_date;
  if (!s || !f) return null;
  const start = Date.parse(s + 'T00:00:00Z');
  const fin = Date.parse(f + 'T00:00:00Z');
  const now = Date.parse(today + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(fin) || fin <= start) return null;
  const expected = Math.max(0, Math.min(100, ((now - start) / (fin - start)) * 100));
  return Math.round(((row.progress ?? 0) - expected) * 10) / 10;
}

/**
 * executive_summary — one-call CEO KPI card.  Admin-tier only (registered in
 * MglMcpAgent.init inside the isAdminRole block).
 */
export function registerExecutiveTools(server: McpServer, env: Env, user: McpProps) {
  void user;
  server.registerTool(
    'executive_summary',
    {
      title: 'Executive KPI summary',
      description:
        "One-call CEO KPI card: portfolio health, at-risk project count, today's " +
        'attendance, a discipline (lateness) trend vs the prior period, weekly ' +
        'progress velocity, and a short merged top-risks list. ' +
        'Call this for "how is the company doing right now" / board-snapshot questions. ' +
        'Arrows: discipline_trend up=improving (lateness fell); velocity up=more output. ' +
        'Nulls mean "n/a" (no data). Admin-tier only.',
      inputSchema: {
        compare_days: z.number().int().min(1).max(90).optional().describe('Trend window in days (default 7): cur = last N days, prev = the N before.'),
        risk_limit: z.number().int().min(1).max(10).optional().describe('Max items in top_risks (default 3).'),
      },
    },
    async ({ compare_days, risk_limit }) => {
      try {
        const d = Math.min(90, Math.max(1, compare_days ?? 7));
        const riskLimit = Math.min(10, Math.max(1, risk_limit ?? 3));
        const today = todayInUB();
        const off = (n: number) => `-${n} days`;

        const [projects, attendance, disc, vel, overdue] = await Promise.all([
          fetchVisibleProjects(env, user, true),
          queryAttendanceForDate(env.DB, today),
          env.DB.prepare(
            `SELECT
               SUM(CASE WHEN a.date >= date(?1, ?2) THEN 1 ELSE 0 END) AS cur_sessions,
               SUM(CASE WHEN a.date >= date(?1, ?2) AND a.late_minutes > 0 AND ${LATE_NOT_WAIVED_SQL} THEN 1 ELSE 0 END) AS cur_late,
               SUM(CASE WHEN a.date >= date(?1, ?3) AND a.date < date(?1, ?4) THEN 1 ELSE 0 END) AS prev_sessions,
               SUM(CASE WHEN a.date >= date(?1, ?3) AND a.date < date(?1, ?4) AND a.late_minutes > 0 AND ${LATE_NOT_WAIVED_SQL} THEN 1 ELSE 0 END) AS prev_late
             FROM attendance_sessions a WHERE a.date >= date(?1, ?3)`,
          ).bind(today, off(d - 1), off(2 * d - 1), off(d)).first<{ cur_sessions: number; cur_late: number; prev_sessions: number; prev_late: number }>(),
          env.DB.prepare(
            `SELECT
               SUM(CASE WHEN date >= date(?1, ?2) THEN 1 ELSE 0 END) AS cur_count,
               SUM(CASE WHEN date >= date(?1, ?3) AND date < date(?1, ?4) THEN 1 ELSE 0 END) AS prev_count
             FROM progress_entries WHERE status = 'approved' AND COALESCE(source, '') <> 'alloc_adj' AND date >= date(?1, ?3)`,
          ).bind(today, off(d - 1), off(2 * d - 1), off(d)).first<{ cur_count: number; prev_count: number }>(),
          env.DB.prepare(
            `SELECT p.id AS project_id, p.name AS project_name, pp.finish_date AS due_date,
                    CAST(julianday(?) - julianday(pp.finish_date) AS INTEGER) AS days_overdue
               FROM projects p JOIN project_passport pp ON pp.project_id = p.id
              WHERE p.status='active' AND pp.finish_date IS NOT NULL AND pp.finish_date < ?
              ORDER BY pp.finish_date ASC LIMIT 5`,
          ).bind(today, today).all<{ project_id: number; project_name: string; due_date: string; days_overdue: number }>(),
        ]);

        const active = projects.filter((p) => p.status === 'active');
        const ph = active.length
          ? Math.round((active.reduce((s, p) => s + (p.progress ?? 0), 0) / active.length) * 10) / 10
          : null;

        const overdueIds = new Set((overdue.results ?? []).map((r) => r.project_id));
        let atRisk = 0;
        const svBad: Array<{ name: string; sv: number }> = [];
        for (const p of active) {
          const sv = scheduleVariance(p, today);
          if ((sv !== null && sv <= -8) || overdueIds.has(p.id)) atRisk++;
          if (sv !== null && sv <= -8) svBad.push({ name: p.name, sv });
        }

        const curRate = disc && disc.cur_sessions ? disc.cur_late / disc.cur_sessions : null;
        const prevRate = disc && disc.prev_sessions ? disc.prev_late / disc.prev_sessions : null;
        const discTrend = curRate === null || prevRate === null ? 'flat' : arrow(prevRate, curRate, 0.005);

        const risks: Array<{ type: string; name: string; why: string }> = [];
        for (const r of svBad.slice().sort((a, b) => a.sv - b.sv)) {
          risks.push({ type: 'schedule', name: r.name, why: `${r.sv} нэгж хуваариас хоцорсон` });
        }
        for (const r of overdue.results ?? []) {
          if (!svBad.some((s) => s.name === r.project_name)) {
            risks.push({ type: 'overdue', name: r.project_name, why: `Дуусах огноо ${r.days_overdue} хоног хэтэрсэн` });
          }
        }

        return txt({
          generated_at: nowInUBIso(),
          compare_days: d,
          portfolio_health_pct: ph,
          at_risk_count: atRisk,
          active_projects: active.length,
          present_pct: attendance.total ? attendance.percentage : null,
          headcount: attendance.total,
          discipline_trend: discTrend,
          progress_velocity: {
            cur: vel?.cur_count ?? 0,
            prev: vel?.prev_count ?? 0,
            delta_pct: pct(vel?.cur_count ?? 0, vel?.prev_count ?? 0),
            arrow: arrow(vel?.cur_count ?? 0, vel?.prev_count ?? 0),
          },
          top_risks: risks.slice(0, riskLimit),
        });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );
}
