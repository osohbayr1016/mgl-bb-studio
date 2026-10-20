import { useCallback, useMemo, useState } from 'react';
import { Code2, Database, Loader2, Pause, Play, Radar, Search, Zap } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { cn } from '@/shared/lib/utils';
import { WORKBENCH_NODES } from './topology';
import { TONE_COLOR, domainFor, domainOf, eventRoute, type LiveEvent } from './live/routeMap';
import { useGraphModel } from './live/useGraphModel';
import { FEED_FILTERS, filterFeed, type FeedFilter } from './live/feedFilter';
import { useLiveTraffic, type LiveStatus } from './live/useLiveTraffic';
import { LiveGraph } from './components/LiveGraph';
import { HudPanel } from './components/HudPanel';
import { LiveFeed, MetricsStrip, NodeInspector, type NodeTraffic } from './components/LivePanels';
import { CodeWorkbench, type OpenRequest } from './components/CodeWorkbench';

/**
 * MGL System Workbench — амьд архитектурын самбар (admin).
 *
 *   • Граф: систем бүхэлдээ (хэрэглэгч → frontend → Worker → хаалт → домэйн → D1/R2 → гадаад).
 *   • Бөөм бүр = НЭГ бодит хүсэлт (хэн ч, аль ч хуудаснаас), cron ажил эсвэл MCP дуудлага.
 *     D1 дээрх долгион = уншсан мөр (том = олон).
 *   • Өгөгдөл: `GET /api/mgl-ai/workbench-live` WebSocket (backend `lib/liveTraffic.ts`) —
 *     D1-д юу ч бичихгүй, хүсэлт бүрд DO дуудлагагүй (isolate бүр ≤1 багц/сек, үзэгчтэй үед л).
 *   • «Code» таб: GitHub-д суурилсан засварлагч / CI / draft PR (хуучин хуудасны функц).
 */

const TABS = ['live', 'code'] as const;

const STATUS_TEXT: Record<LiveStatus, [string, string]> = {
  connecting: ['LINKING', 'text-amber-300'],
  live: ['LIVE', 'text-emerald-300'],
  reconnecting: ['RELINKING', 'text-amber-300'],
  sleeping: ['STANDBY', 'text-slate-400'],
  denied: ['NO SIGNAL', 'text-rose-300'],
};

const LEGEND: Array<[keyof typeof TONE_COLOR, string]> = [
  ['read', 'GET · D1 → you'],
  ['write', 'POST · you → D1'],
  ['cache', 'cache hit'],
  ['error', 'error'],
  ['cron', 'cron'],
  ['mcp', 'MCP'],
  ['media', 'R2 media'],
];

export default function SystemWorkbenchPage() {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const [tab, setTab] = useTabParam(TABS, 'live');
  const [paused, setPaused] = useState(false);
  const live = useLiveTraffic(paused);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [panel, setPanel] = useState<'feed' | 'node'>('feed');
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  const [probe, setProbe] = useState<{ busy: boolean; text: string }>({ busy: false, text: '' });

  const { graph, nodes, positions, hits } = useGraphModel(live);

  const traffic = useMemo<NodeTraffic | null>(() => {
    if (!selectedId) return null;
    const w = live.getWindow();
    const since60 = Date.now() - 60_000;
    const paths = new Map<string, number>();
    const recent: LiveEvent[] = [];
    let count = 0, rows = 0, writes = 0, ms = 0, errors = 0;
    for (let i = w.length - 1; i >= 0; i--) {
      const ev = w[i]!;
      if (!eventRoute(ev, domainFor(ev) ?? '').includes(selectedId)) continue;
      if (recent.length < 25) recent.push(ev);
      if (ev.t < since60) continue;
      count++;
      rows += ev.r;
      writes += ev.w;
      ms += ev.ms;
      if (ev.s >= 400) errors++;
      paths.set(ev.p, (paths.get(ev.p) ?? 0) + 1);
    }
    return {
      count,
      rows,
      writes,
      avgMs: count ? Math.round(ms / count) : 0,
      errors,
      topPaths: [...paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      recent,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, live.snapshot]);

  const matchIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      nodes
        .filter((n) => {
          const meta = WORKBENCH_NODES.find((m) => m.id === n.id);
          return (
            n.label.toLowerCase().includes(q) ||
            n.subtitle.toLowerCase().includes(q) ||
            n.id.toLowerCase().includes(q) ||
            (meta?.sourcePaths.some((p) => p.toLowerCase().includes(q)) ?? false) ||
            (domainOf(q.startsWith('/') ? q : `/api/${q}`) === n.id)
          );
        })
        .map((n) => n.id),
    );
  }, [query, nodes]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setPanel(id ? 'node' : 'feed');
  }, []);

  const pick = useCallback((ev: LiveEvent) => {
    const domain = domainFor(ev);
    graph.current?.play(ev, domain ?? '');
    const target = ev.k === 'cron' ? 'cron' : ev.k === 'mcp' ? 'remote-mcp' : domain;
    if (target) {
      setSelectedId(target);
      setPanel('node');
    }
  }, [graph]);

  const openFile = useCallback(
    (path: string) => {
      setOpenRequest({ path, nonce: Date.now() });
      setTab('code');
    },
    [setTab],
  );

  async function pingD1() {
    setProbe({ busy: true, text: '' });
    try {
      const out = await apiFetch<{ projects: number; active_users: number; ms: number }>('/mgl-ai/workbench/probe', {
        method: 'POST',
      });
      setProbe({ busy: false, text: `D1 ✓ ${out.projects} projects · ${out.active_users} users · ${out.ms}ms` });
    } catch (err) {
      setProbe({ busy: false, text: err instanceof Error ? err.message : 'Probe failed' });
    }
    setTimeout(() => setProbe((p) => (p.busy ? p : { busy: false, text: '' })), 6000);
  }

  const [statusLabel, statusTone] = STATUS_TEXT[live.status];
  const feed = useMemo(() => filterFeed(live.feed, feedFilter, me), [live.feed, feedFilter, me]);
  const selectedNode = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-2 overflow-y-auto bg-[#02050a] p-2 text-slate-100 lg:overflow-hidden lg:p-3">
      {/* Арын эффект: радар шүүрдэлт + vignette (motion-reduce үед зогсоно). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 size-[160vmax] -translate-x-1/2 -translate-y-1/2 opacity-[0.07] motion-safe:animate-[spin_18s_linear_infinite] [background:conic-gradient(from_0deg,transparent_0deg,rgba(34,211,238,.9)_18deg,transparent_40deg)]" />
        <div className="absolute inset-0 [background:radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,.75)_100%)]" />
      </div>

      {/* Толгой */}
      <header className="relative z-10 flex flex-wrap items-center gap-2">
        <div className="mr-1 flex items-center gap-2.5">
          <div className="relative grid size-9 place-items-center rounded-full border border-cyan-400/40 bg-cyan-400/10 shadow-[0_0_24px_rgba(34,211,238,.35)]">
            <Radar className="size-4.5 text-cyan-300" />
            {live.status === 'live' && (
              <span className="absolute inset-0 rounded-full border border-cyan-300/50 motion-safe:animate-ping" />
            )}
          </div>
          <div className="leading-tight">
            <h1 className="font-mono text-sm font-semibold tracking-[0.25em] text-cyan-50">MGL · SYSTEM CORE</h1>
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em]">
              <span className={cn('flex items-center gap-1', statusTone)}>
                <span className={cn('size-1.5 rounded-full bg-current', live.status === 'live' && 'motion-safe:animate-pulse')} />
                {statusLabel}
              </span>
              <span className="text-slate-500">
                {live.snapshot.total.toLocaleString()} events · {live.snapshot.watchers || 0} watching
              </span>
            </div>
          </div>
        </div>

        <div className="flex rounded-md border border-cyan-400/20 bg-black/40 p-0.5 font-mono text-[11px]">
          {(
            [
              ['live', 'Live', Zap],
              ['code', 'Code', Code2],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'flex items-center gap-1.5 rounded px-3 py-1.5 tracking-wider transition',
                tab === value ? 'bg-cyan-400/15 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,.25)]' : 'text-slate-400 hover:text-cyan-200',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {tab === 'live' && (
          <>
            <div className="relative min-w-[180px] max-w-sm flex-1">
              <Search className="absolute left-2.5 top-2 size-3.5 text-cyan-500/70" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search node, file, /api/route…"
                className="h-8 w-full rounded-md border border-cyan-400/20 bg-black/40 pl-8 pr-2 font-mono text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
              />
            </div>
            <button
              onClick={() => setPaused((p) => !p)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md border px-3 font-mono text-[11px] tracking-wider transition',
                paused ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-cyan-400/20 bg-black/40 text-slate-300 hover:text-cyan-200',
              )}
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {paused ? 'Resume' : 'Freeze'}
            </button>
            <button
              onClick={pingD1}
              disabled={probe.busy}
              className="flex h-8 items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 font-mono text-[11px] tracking-wider text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-60"
              title="D1 рүү жижиг хүсэлт явуулж, графаар хэрхэн урсахыг харах"
            >
              {probe.busy ? <Loader2 className="size-3.5 animate-spin" /> : <Database className="size-3.5" />}
              Ping D1
            </button>
            {probe.text && <span className="font-mono text-[11px] text-amber-200/90">{probe.text}</span>}
          </>
        )}
      </header>

      {tab === 'live' ? (
        <>
          <div className="relative z-10">
            <MetricsStrip s={live.snapshot} />
          </div>

          <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_360px]">
            <HudPanel className="relative h-[62vh] min-h-[420px] overflow-hidden lg:h-auto lg:min-h-0">
              <LiveGraph
                ref={graph}
                nodes={nodes}
                positions={positions}
                selectedId={selectedId}
                onSelect={select}
                matchIds={matchIds}
                hits={hits}
              />
              <div className="pointer-events-none absolute bottom-2 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
                {LEGEND.map(([tone, label]) => (
                  <span key={tone} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: TONE_COLOR[tone], boxShadow: `0 0 6px ${TONE_COLOR[tone]}` }} />
                    {label}
                  </span>
                ))}
                <span className="text-slate-600">· 1 dot = 1 real request · ring on D1 = rows · Revit add-in requests start at «MGL Revit Add-in» · scroll = zoom · drag = pan</span>
              </div>
              {(live.status === 'denied' || live.status === 'reconnecting') && (
                <div className="absolute right-3 top-3 max-w-xs rounded border border-amber-400/30 bg-black/80 p-2.5 font-mono text-[10.5px] leading-4 text-amber-200">
                  Live channel холбогдохгүй байна. Worker-ийг `WORKBENCH_LIVE` DO-тай deploy хийсэн эсэх, оффисын сүлжээ, админ эрхээ шалгана уу. Граф статик горимд ажиллаж байна.
                </div>
              )}
              {paused && (
                <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-amber-200">
                  FROZEN
                </div>
              )}
            </HudPanel>

            <HudPanel className="flex min-h-[420px] flex-col overflow-hidden lg:min-h-0">
              <div className="flex items-center gap-1 border-b border-cyan-400/10 p-1.5 font-mono text-[10.5px]">
                <button
                  onClick={() => setPanel('feed')}
                  className={cn('rounded px-2.5 py-1 tracking-wider', panel === 'feed' ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-400 hover:text-cyan-200')}
                >
                  Feed
                </button>
                <button
                  onClick={() => selectedNode && setPanel('node')}
                  disabled={!selectedNode}
                  className={cn(
                    'max-w-[150px] truncate rounded px-2.5 py-1 tracking-wider disabled:opacity-40',
                    panel === 'node' ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-400 hover:text-cyan-200',
                  )}
                >
                  {selectedNode ? selectedNode.label : 'Node'}
                </button>
                {panel === 'feed' && (
                  <div className="ml-auto flex gap-0.5">
                    {FEED_FILTERS.map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setFeedFilter(value)}
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px]',
                          feedFilter === value ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-500 hover:text-cyan-200',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {panel === 'node' && selectedNode && traffic ? (
                  <NodeInspector
                    node={selectedNode}
                    traffic={traffic}
                    onSelect={select}
                    onOpenFile={openFile}
                    onPick={pick}
                    me={me}
                  />
                ) : (
                  <LiveFeed
                    events={feed}
                    me={me}
                    onPick={pick}
                    empty={
                      live.status === 'live'
                        ? 'Холбогдсон. Систем дээр хүсэлт гармагц энд урсана — «Ping D1» дарж туршаад үз.'
                        : 'Live channel-тай холбогдож байна…'
                    }
                  />
                )}
              </div>
            </HudPanel>
          </div>
        </>
      ) : (
        <div className="relative z-10 min-h-0 flex-1">
          <CodeWorkbench openRequest={openRequest} contextLabel={selectedNode?.label ?? 'System'} />
        </div>
      )}
    </div>
  );
}
