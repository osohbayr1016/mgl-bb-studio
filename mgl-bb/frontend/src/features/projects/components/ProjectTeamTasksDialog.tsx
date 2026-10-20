import { useMemo, useState } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useFocusTrap } from '@/shared/hooks/useFocusTrap';
import { useLanguage } from '@/shared/i18n';
import type { ProjectTeamTasksResponse, ProjectTeamTaskRow } from '@/shared/types';
import { teamHex } from '@/shared/lib/team-colors';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';
import {
  Loader2,
  Search,
  ChevronDown,
  X,
  Crown,
  ShieldCheck,
  Users,
  ListChecks,
  ArrowRight,
} from 'lucide-react';

/**
 * ProjectTeamTasksDialog — clicking a team row in the fullscreen chart
 * watchlist opens this. Shows, grouped BY MEMBER (the submitter), each
 * approved progress ENTRY they logged on THIS project for THAT discipline
 * team within the selected period: which task, which day, and FROM what % TO
 * what % (the per-day delta). Replaces the old hover "attendance / filled
 * tasks" tooltip.
 *
 * Scoped to the watchlist's selected period via `from`/`to` (exclusive from,
 * inclusive to) so picking day/week/month narrows it to that window.
 *
 * Rendered as an INLINE fixed overlay (not a Radix portal): the charts tab
 * uses the browser Fullscreen API on its root, and portalled content (to
 * document.body) is outside the fullscreen subtree and would be invisible.
 *
 * The parent only mounts this when a team is selected, so state starts fresh
 * on every open — no reset effect needed.
 */

// Dark palette matching the TradingView-style charts tab.
const PANEL_BG = '#131722';
const PANEL_BG2 = '#1b1f2a';

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

function toneText(v: number) {
  if (v >= 100) return 'text-emerald-400';
  if (v >= 70) return 'text-sky-400';
  if (v >= 40) return 'text-sky-300';
  if (v > 0) return 'text-amber-400';
  return 'text-slate-400';
}

/** 'YYYY-MM-DD' -> 'MM.DD' (timezone-safe, no Date parsing). */
function fmtDay(d: string): string {
  return d.length >= 10 ? d.slice(5).replace('-', '.') : d;
}

type MemberGroup = {
  user_id: number;
  full_name: string;
  profile_image: string | null;
  role: ProjectTeamTaskRow['role'];
  position: string | null;
  entries: ProjectTeamTaskRow[];
};

export default function ProjectTeamTasksDialog({
  projectId,
  team,
  from,
  to,
  periodLabel,
  onClose,
}: {
  projectId: number;
  team: { code: string; name: string };
  /** Period window (exclusive from, inclusive to). Empty = no bound. */
  from: string;
  to: string;
  /** Human label for the selected period, shown in the header. */
  periodLabel: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  // Анхдагчаар бүх гишүүн нээлттэй — зөвхөн "хаасан" id-уудыг хадгална.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // Гараар хийсэн overlay тул focus trap + Escape-ийг өөрсдөө хангана
  // (Radix ашиглах боломжгүй — fullscreen subtree-ээс гадагш portal болно).
  const panelRef = useFocusTrap<HTMLDivElement>(true, onClose);

  const query = useApiQuery<ProjectTeamTasksResponse>(
    ['/projects', projectId, 'team-tasks', team.code, from, to],
    `/projects/${projectId}/charts/team-tasks?team=${encodeURIComponent(team.code)}` +
      `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  const data = query.data ?? null;
  const loading = query.isLoading;

  // Esc: `useFocusTrap` доор Escape-д `onClose`-г дууддаг. Fullscreen дотор
  // Esc нь нэмж fullscreen-ээс гарах native үйлдэл хийдэг ч хоёулаа диалогийг
  // хаах тул зөрчилгүй. X / дэвсгэр дээр дарах / footer товч мөн хаана.

  const groups = useMemo<MemberGroup[]>(() => {
    const map = new Map<number, MemberGroup>();
    for (const r of data?.rows ?? []) {
      let g = map.get(r.user_id);
      if (!g) {
        g = {
          user_id: r.user_id,
          full_name: r.full_name,
          profile_image: r.profile_image,
          role: r.role,
          position: r.position,
          entries: [],
        };
        map.set(r.user_id, g);
      }
      g.entries.push(r);
    }
    return Array.from(map.values());
  }, [data?.rows]);

  const filtered = useMemo<MemberGroup[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => {
        const memberHit = formatDisplayName(g.full_name).toLowerCase().includes(q);
        const entries = memberHit
          ? g.entries
          : g.entries.filter(
              (x) =>
                x.task_name.toLowerCase().includes(q) ||
                (x.component_name ?? '').toLowerCase().includes(q),
            );
        return { ...g, entries };
      })
      .filter((g) => g.entries.length > 0);
  }, [groups, search]);

  const totalEntries = data?.rows?.length ?? 0;
  const totalMembers = groups.length;
  const hex = teamHex(team.code);

  const toggle = (uid: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 text-slate-100"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        aria-label={`${team.code} · ${team.name}`}
        className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 shadow-2xl outline-none"
        style={{ backgroundColor: PANEL_BG }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-white/10 px-4 py-3">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: hex }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-wide" style={{ color: hex }}>
                {team.code}
              </span>
              <span className="truncate text-sm font-medium text-slate-200">{team.name}</span>
              {periodLabel && (
                <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-400">
                  {periodLabel}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {t('projectChartsTab.teamTasksDesc')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('projectChartsTab.close')}
            className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + counts */}
        <div className="flex items-center gap-3 px-4 pt-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('projectChartsTab.teamTasksSearch')}
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-white/20 focus:outline-none"
            />
          </div>
          {!loading && (
            <div className="hidden shrink-0 items-center gap-3 text-xs text-slate-400 sm:flex">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {totalMembers}
              </span>
              <span className="inline-flex items-center gap-1">
                <ListChecks className="h-3.5 w-3.5" /> {totalEntries}
              </span>
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : query.isError ? (
            <div className="py-12 text-center text-sm text-red-400">
              {t('projectChartsTab.teamTasksError')}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 py-12 text-center text-sm text-slate-400">
              {t('projectChartsTab.teamTasksEmpty')}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((g) => {
                const isCollapsed = collapsed.has(g.user_id);
                return (
                  <div
                    key={g.user_id}
                    className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]"
                  >
                    {/* Member header */}
                    <button
                      type="button"
                      onClick={() => toggle(g.user_id)}
                      className="flex w-full items-center gap-3 p-3 text-left hover:bg-white/5"
                    >
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-slate-500 transition-transform',
                          isCollapsed && '-rotate-90',
                        )}
                      />
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-[10px] font-semibold text-slate-200">
                        {g.profile_image ? (
                          <img
                            src={`${MEDIA_BASE_URL}${g.profile_image}`}
                            alt={formatDisplayName(g.full_name)}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          initials(formatDisplayName(g.full_name))
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-slate-100">
                            {formatDisplayName(g.full_name)}
                          </span>
                          {g.role === 'admin' && <Crown className="h-3 w-3 shrink-0 text-amber-400" />}
                          {g.role === 'senior' && (
                            <ShieldCheck className="h-3 w-3 shrink-0 text-amber-400" />
                          )}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          {g.position || g.role} ·{' '}
                          {t('projectChartsTab.teamEntriesCount', { count: g.entries.length })}
                        </div>
                      </div>
                    </button>

                    {/* Entries: task + day + from% -> to% (+delta) */}
                    {!isCollapsed && (
                      <ul className="divide-y divide-white/5 border-t border-white/10">
                        {g.entries.map((x) => {
                          const delta = Math.round(x.to_pct - x.from_pct);
                          return (
                            <li
                              key={x.task_id + '-' + x.date + '-' + x.from_pct + '-' + x.to_pct}
                              className="flex items-center gap-3 py-2 pl-10 pr-3"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-slate-200" title={x.task_name}>
                                  {x.task_name}
                                </div>
                                <div
                                  className="truncate text-[11px] text-slate-500"
                                  title={`${x.drawing_name} · ${x.component_name}`}
                                >
                                  {x.component_name}
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[10px] tabular-nums text-slate-500">
                                  {fmtDay(x.date)}
                                </div>
                                <div className="flex items-center justify-end gap-1 text-xs tabular-nums">
                                  <span className="text-slate-400">{Math.round(x.from_pct)}%</span>
                                  <ArrowRight className="h-3 w-3 text-slate-500" />
                                  <span className={cn('font-semibold', toneText(x.to_pct))}>
                                    {Math.round(x.to_pct)}%
                                  </span>
                                  {delta !== 0 && (
                                    <span
                                      className={cn(
                                        'ml-0.5 rounded px-1 text-[10px] font-medium',
                                        delta > 0
                                          ? 'bg-emerald-500/15 text-emerald-400'
                                          : 'bg-red-500/15 text-red-400',
                                      )}
                                    >
                                      {delta > 0 ? '+' : ''}
                                      {delta}%
                                    </span>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-white/10 px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-slate-100"
            style={{ backgroundColor: PANEL_BG2 }}
          >
            {t('projectChartsTab.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
