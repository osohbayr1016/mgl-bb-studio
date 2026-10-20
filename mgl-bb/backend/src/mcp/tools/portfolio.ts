import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { fetchVisibleProjects } from './projects';
import { snapshotProgressTimeseriesRanged } from '../../lib/progressTimeseries';
import { todayInUB } from '../../lib/time';
import { latestApprovedPctByDate } from '../../lib/progressLatest';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const OVERDUE_BY_PROJECT_SQL = `
  WITH latest_task AS (
    -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
    SELECT t.id AS task_id, ${latestApprovedPctByDate('t.id')} AS percentage
    FROM tasks t
  )
  SELECT b.project_id AS project_id, COUNT(*) AS overdue
  FROM tasks t
  INNER JOIN components c ON c.id = t.component_id
  INNER JOIN drawings   d ON d.id = c.drawing_id
  INNER JOIN blocks     b ON b.id = d.block_id
  LEFT JOIN latest_task lt ON lt.task_id = t.id
  WHERE t.due_date IS NOT NULL AND t.due_date < ?
    AND COALESCE(lt.percentage, 0) < 100
  GROUP BY b.project_id`;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function jd(d: string | null | undefined): number | null {
  if (!d) return null;
  const ms = Date.parse(d + 'T00:00:00Z');
  return Number.isNaN(ms) ? null : ms / 86_400_000;
}

/**
 * analyze_portfolio_health — every active project tiered on_track/at_risk/
 * critical with schedule variance, velocity ETA, and overdue count.  Admin-tier.
 */
export function registerPortfolioTools(server: McpServer, env: Env, user: McpProps) {
  server.registerTool(
    'analyze_portfolio_health',
    {
      title: 'Portfolio health analysis',
      description:
        'Score every ACTIVE project on_track / at_risk / critical with a one-line ' +
        'reason, schedule variance (actual vs expected progress from the passport ' +
        'timeline), recent velocity + projected finish, and overdue-task count. Call ' +
        'this for "which projects are behind / at risk and why". Admin-tier only.',
      inputSchema: {
        velocity_days: z.number().int().min(7).max(30).optional().describe('Look-back window (days) for velocity/ETA (default 14).'),
        tier_filter: z.enum(['on_track', 'at_risk', 'critical']).optional().describe('Return only this tier.'),
        include_no_dates: z.boolean().optional().describe('Include projects with missing schedule dates (default true).'),
        limit: z.number().int().min(1).max(25).optional().describe('Max projects to analyze (hard cap 25 — one velocity query each).'),
      },
    },
    async ({ velocity_days, tier_filter, include_no_dates, limit }) => {
      try {
        const velDays = Math.min(30, Math.max(7, velocity_days ?? 14));
        const inclNoDates = include_no_dates ?? true;
        const lim = Math.min(25, Math.max(1, limit ?? 25));
        const today = todayInUB();
        const jToday = jd(today)!;
        const from = new Date(Date.parse(today + 'T00:00:00Z') - velDays * 86_400_000).toISOString().slice(0, 10);

        const rows = (await fetchVisibleProjects(env, user, true))
          .filter((r) => (r.status ?? '').toLowerCase() === 'active')
          .filter((r) => inclNoDates || (r.start_date && r.finish_date))
          .slice(0, lim);

        const overdueRes = await env.DB.prepare(OVERDUE_BY_PROJECT_SQL).bind(today).all<{ project_id: number; overdue: number }>();
        const overdueMap = new Map((overdueRes.results ?? []).map((r) => [r.project_id, r.overdue] as const));

        let curSum = 0;
        let prevSum = 0;
        let prevN = 0;
        const analyzed: Array<{
          name: string; tier: 'on_track' | 'at_risk' | 'critical'; why: string;
          progress: number; schedVar: number | null; scheduleKnown: boolean;
          daysRemaining: number | null; overdueTasks: number;
          velocityPerDay: number | null; etaDays: number | null; projectedFinish: string | null;
        }> = [];

        for (const p of rows) {
          const progress = Number(p.progress ?? 0);
          curSum += progress;

          const s = jd(p.start_date);
          const f = jd(p.finish_date);
          const scheduleKnown = s !== null && f !== null && f > s;
          const expected = scheduleKnown ? clamp01((jToday - s!) / (f! - s!)) * 100 : null;
          const schedVar = expected !== null ? Math.round((progress - expected) * 10) / 10 : null;
          const daysRemaining = f === null ? null : Math.round(f - jToday);
          const overdueTasks = overdueMap.get(p.id) ?? 0;

          const series = await snapshotProgressTimeseriesRanged(env.DB, p.id, from, today);
          let velocityPerDay: number | null = null;
          let etaDays: number | null = null;
          let projectedFinish: string | null = null;
          if (series.length >= 2) {
            const a = series[0]!;
            const b = series[series.length - 1]!;
            prevSum += a.progress;
            prevN++;
            const days = (jd(b.date) ?? 0) - (jd(a.date) ?? 0);
            if (days > 0) {
              const v = (b.progress - a.progress) / days;
              velocityPerDay = Math.round(v * 100) / 100;
              const remaining = 100 - progress;
              if (v > 0 && remaining > 0) {
                etaDays = Math.ceil(remaining / v);
                projectedFinish = new Date(Date.parse(today + 'T00:00:00Z') + etaDays * 86_400_000).toISOString().slice(0, 10);
              }
            }
          } else {
            prevSum += progress;
            prevN++;
          }

          let tier: 'on_track' | 'at_risk' | 'critical';
          let why: string;
          if (progress >= 100) {
            tier = 'on_track';
            why = 'Дууссан';
          } else if (!scheduleKnown) {
            if (overdueTasks > 0) { tier = 'at_risk'; why = `${overdueTasks} хугацаа хэтэрсэн таск (огноогүй)`; }
            else if (velocityPerDay === 0) { tier = 'at_risk'; why = `${velDays} хоног явц зогссон`; }
            else { tier = 'on_track'; why = 'Хуваарьгүй, идэвхтэй'; }
          } else if (schedVar! <= -20 || (daysRemaining !== null && daysRemaining < 0) || overdueTasks >= 10) {
            tier = 'critical';
            why = daysRemaining !== null && daysRemaining < 0
              ? `Дуусах огноо ${-daysRemaining} хоног хэтэрсэн, явц ${Math.round(progress)}%`
              : schedVar! <= -20 ? `Хуваариас ${Math.abs(schedVar!)} нэгж хоцорсон`
                : `${overdueTasks} хугацаа хэтэрсэн таск`;
          } else if (schedVar! <= -8 || overdueTasks >= 3 || (etaDays !== null && daysRemaining !== null && etaDays > daysRemaining)) {
            tier = 'at_risk';
            why = etaDays !== null && daysRemaining !== null && etaDays > daysRemaining
              ? `Одоогийн хурдаар ${etaDays} хоногт дуусна (${daysRemaining} хоног үлдсэн)`
              : schedVar! <= -8 ? `Хуваариас ${Math.abs(schedVar!)} нэгж хоцорсон`
                : `${overdueTasks} хугацаа хэтэрсэн таск`;
          } else {
            tier = 'on_track';
            why = 'Хуваарьтайгаа нийцэж байна';
          }

          analyzed.push({ name: p.name, tier, why, progress: Math.round(progress * 10) / 10, schedVar, scheduleKnown, daysRemaining, overdueTasks, velocityPerDay, etaDays, projectedFinish });
        }

        const avgCur = analyzed.length ? Math.round((curSum / analyzed.length) * 10) / 10 : null;
        const avgPrev = prevN ? Math.round((prevSum / prevN) * 10) / 10 : null;
        const avgDelta = avgCur !== null && avgPrev !== null && avgPrev !== 0 ? Math.round(((avgCur - avgPrev) / avgPrev) * 1000) / 10 : null;

        const tiered = tier_filter ? analyzed.filter((a) => a.tier === tier_filter) : analyzed;
        const flag = (a: typeof analyzed[number]) => ({
          name: a.name,
          metric: a.scheduleKnown ? `${Math.round(a.progress)}% / SV ${a.schedVar}` : `${Math.round(a.progress)}% (огноогүй)`,
          why: a.why,
        });

        return txt({
          as_of: today,
          velocity_days: velDays,
          kpi: {
            active_projects: analyzed.length,
            on_track: analyzed.filter((a) => a.tier === 'on_track').length,
            at_risk: analyzed.filter((a) => a.tier === 'at_risk').length,
            critical: analyzed.filter((a) => a.tier === 'critical').length,
            avg_progress: { cur: avgCur, prev: avgPrev, delta_pct: avgDelta, arrow: avgDelta == null ? 'flat' : avgDelta > 1 ? 'up' : avgDelta < -1 ? 'down' : 'flat' },
            total_overdue_tasks: analyzed.reduce((s, a) => s + a.overdueTasks, 0),
            schedule_known_count: analyzed.filter((a) => a.scheduleKnown).length,
          },
          critical: tiered.filter((a) => a.tier === 'critical').slice(0, 10).map(flag),
          at_risk: tiered.filter((a) => a.tier === 'at_risk').slice(0, 10).map((a) => ({
            name: a.name,
            metric: a.etaDays !== null ? `ETA ${a.etaDays}х / үлдсэн ${a.daysRemaining ?? 'n/a'}х` : `${Math.round(a.progress)}% / SV ${a.schedVar ?? 'n/a'}`,
            why: a.why,
          })),
          slowest: tiered.filter((a) => a.velocityPerDay !== null).sort((x, y) => (x.velocityPerDay ?? 0) - (y.velocityPerDay ?? 0)).slice(0, 5).map((a) => ({
            name: a.name,
            metric: `${a.velocityPerDay}%/хоног`,
            why: (a.velocityPerDay ?? 0) <= 0 ? `Сүүлийн ${velDays} хоногт явц нэмэгдээгүй` : `Удаан хурд, ${a.projectedFinish ?? 'n/a'}-д дуусна`,
          })),
        });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );
}
