import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { nowInUBIso } from '../../lib/time';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const round1 = (n: number | null | undefined) => Math.round((n ?? 0) * 10) / 10;

/**
 * analyze_productivity_trends — firm output this period vs the equal previous
 * period, with per-team rollup and individual movers.  Admin-tier only.
 */
export function registerTrendTools(server: McpServer, env: Env, user: McpProps) {
  void user;
  server.registerTool(
    'analyze_productivity_trends',
    {
      title: 'Firm productivity trends',
      description:
        'Leadership analytics: firm output this period vs the equal previous period. ' +
        'Returns KPI deltas (points, approved entries, contributors, weekly velocity) ' +
        'with up/down/flat arrows (up = more output = good), a per-team points rollup, ' +
        'and top/bottom individual movers. Use for "are we speeding up or slowing down", ' +
        'momentum, and who improved/declined. weeks sets the window (default 4); ' +
        'team_code narrows to one team. Admin-tier only.',
      inputSchema: {
        weeks: z.number().int().min(1).max(13).optional().describe('Window size in weeks; cur = last weeks*7 days, prev = the equal window before. Default 4.'),
        compare: z.boolean().optional().describe('Compute previous-window comparison + movers (default true).'),
        team_code: z.string().trim().min(1).max(16).optional().describe('Restrict to one team by primary team code (e.g. "BA"). Omit for whole firm.'),
      },
    },
    async ({ weeks, compare, team_code }) => {
      try {
        const w = Math.min(13, Math.max(1, weeks ?? 4));
        const cmp = compare ?? true;
        const team = team_code?.trim() || null;
        const days = w * 7;
        const curStart = `-${days} days`;
        const prevStart = `-${days * 2} days`;

        const delta = (cur: number, prev: number): number | 'new' | null => {
          if (!cmp) return null;
          if (prev === 0) return cur > 0 ? 'new' : null;
          return round1(((cur - prev) / prev) * 100);
        };
        const arrow = (dv: number | 'new' | null): 'up' | 'down' | 'flat' => {
          if (dv === 'new') return 'up';
          if (dv === null) return 'flat';
          return dv > 0.5 ? 'up' : dv < -0.5 ? 'down' : 'flat';
        };
        const kpi = (cur: number, prev: number) => {
          const dv = delta(cur, prev);
          return { cur: round1(cur), prev: cmp ? round1(prev) : null, delta_pct: dv, arrow: arrow(dv) };
        };

        const [q1, q2, q3] = await Promise.all([
          env.DB.prepare(
            `SELECT
               COALESCE(SUM(CASE WHEN p.awarded_at >= datetime('now', ?1) THEN p.amount ELSE 0 END),0) AS points_cur,
               COALESCE(SUM(CASE WHEN p.awarded_at >= datetime('now', ?2) AND p.awarded_at < datetime('now', ?1) THEN p.amount ELSE 0 END),0) AS points_prev,
               COUNT(DISTINCT CASE WHEN p.awarded_at >= datetime('now', ?1) THEN p.user_id END) AS contributors_cur,
               COUNT(DISTINCT CASE WHEN p.awarded_at >= datetime('now', ?2) AND p.awarded_at < datetime('now', ?1) THEN p.user_id END) AS contributors_prev
             FROM user_points p
             JOIN users u ON u.id = p.user_id
             LEFT JOIN teams t ON t.id = u.team_id
             WHERE u.role IN ('engineer','architect','senior') AND u.status='active' AND u.is_support=0
               AND (?3 IS NULL OR t.code = ?3)
               AND p.awarded_at >= datetime('now', ?2)`,
          ).bind(curStart, prevStart, team).first<{ points_cur: number; points_prev: number; contributors_cur: number; contributors_prev: number }>(),
          env.DB.prepare(
            `SELECT
               COUNT(CASE WHEN pe.reviewed_at >= datetime('now', ?1) THEN 1 END) AS approved_cur,
               COUNT(CASE WHEN pe.reviewed_at >= datetime('now', ?2) AND pe.reviewed_at < datetime('now', ?1) THEN 1 END) AS approved_prev
             FROM progress_entries pe
             JOIN users u ON u.id = pe.user_id
             LEFT JOIN tasks t ON t.id = pe.task_id
             LEFT JOIN components c ON c.id = t.component_id
             LEFT JOIN drawings d ON d.id = c.drawing_id
             LEFT JOIN blocks b ON b.id = d.block_id
             LEFT JOIN teams tm ON tm.id = b.team_id
             WHERE pe.status='approved' AND pe.reviewed_at IS NOT NULL AND COALESCE(pe.source, '') <> 'alloc_adj'
               AND u.role IN ('engineer','architect','senior') AND u.status='active' AND u.is_support=0
               AND (?3 IS NULL OR tm.code = ?3)
               AND pe.reviewed_at >= datetime('now', ?2)`,
          ).bind(curStart, prevStart, team).first<{ approved_cur: number; approved_prev: number }>(),
          env.DB.prepare(
            `SELECT u.id AS user_id, u.full_name, t.code AS team_code, t.name_mn AS team_name,
               COALESCE(SUM(CASE WHEN p.awarded_at >= datetime('now', ?1) THEN p.amount ELSE 0 END),0) AS cur,
               COALESCE(SUM(CASE WHEN p.awarded_at >= datetime('now', ?2) AND p.awarded_at < datetime('now', ?1) THEN p.amount ELSE 0 END),0) AS prev
             FROM users u
             LEFT JOIN user_points p ON p.user_id = u.id AND p.awarded_at >= datetime('now', ?2)
             LEFT JOIN teams t ON t.id = u.team_id
             WHERE u.role IN ('engineer','architect','senior') AND u.status='active' AND u.is_support=0
               AND (?3 IS NULL OR t.code = ?3)
             GROUP BY u.id`,
          ).bind(curStart, prevStart, team).all<{ user_id: number; full_name: string; team_code: string | null; team_name: string | null; cur: number; prev: number }>(),
        ]);

        const rows = q3.results ?? [];
        const PREV_FLOOR = Math.max(2, w);
        const ranked = rows.filter((r) => r.prev >= PREV_FLOOR && r.prev > 0).map((r) => ({ r, d: ((r.cur - r.prev) / r.prev) * 100 }));
        const mover = (x: { r: typeof rows[number]; d: number }) => ({
          name: x.r.full_name,
          metric: round1(x.d),
          why: `${round1(x.r.prev)}→${round1(x.r.cur)} оноо` + (x.r.team_code ? ` (${x.r.team_code})` : ''),
        });
        const top_movers = cmp ? ranked.slice().sort((a, b) => b.d - a.d).slice(0, 3).map(mover) : [];
        const bottom_movers = cmp ? ranked.slice().sort((a, b) => a.d - b.d).slice(0, 3).map(mover).filter((m) => (m.metric as number) < 0) : [];

        const byTeam = new Map<string, { name: string; cur: number; prev: number }>();
        for (const r of rows) {
          const code = r.team_code ?? '—';
          const e = byTeam.get(code) ?? { name: r.team_name ?? '—', cur: 0, prev: 0 };
          e.cur += r.cur;
          e.prev += r.prev;
          byTeam.set(code, e);
        }
        const teams = [...byTeam.entries()].map(([code, e]) => ({ team_code: code, team_name: e.name, points: kpi(e.cur, e.prev) })).sort((a, b) => b.points.cur - a.points.cur);

        return txt({
          generated_at: nowInUBIso(),
          window: { weeks: w, days, team_code: team, compared: cmp },
          kpis: {
            points: kpi(q1?.points_cur ?? 0, q1?.points_prev ?? 0),
            approved_entries: kpi(q2?.approved_cur ?? 0, q2?.approved_prev ?? 0),
            contributors: kpi(q1?.contributors_cur ?? 0, q1?.contributors_prev ?? 0),
            velocity: kpi((q2?.approved_cur ?? 0) / w, (q2?.approved_prev ?? 0) / w),
          },
          teams,
          top_movers,
          bottom_movers,
        });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );
}
