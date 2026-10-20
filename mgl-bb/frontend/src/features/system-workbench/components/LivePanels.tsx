import { useMemo } from 'react';
import { FileCode2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { WORKBENCH_EDGES, WORKBENCH_NODES } from '../topology';
import { TONE_COLOR, toneOf, type LiveEvent } from '../live/routeMap';
import type { LiveSnapshot } from '../live/useLiveTraffic';
import type { GraphNode } from './LiveGraph';

/* ------------------------------------------------------------------ */
/*  Тоон самбар                                                        */
/* ------------------------------------------------------------------ */

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function Sparkline({ values, color, className }: { values: number[]; color: string; className?: string }) {
  const max = Math.max(1, ...values);
  const w = 100;
  const h = 24;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn('h-6 w-full', className)} aria-hidden>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={color} fillOpacity={0.12} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Tile({
  label,
  value,
  unit,
  tone = 'text-cyan-100',
  spark,
  sparkColor = '#22d3ee',
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
  spark?: number[];
  sparkColor?: string;
  hint?: string;
}) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded border border-cyan-400/10 bg-black/30 px-2.5 pb-1 pt-1.5" title={hint}>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={cn('font-mono text-lg font-semibold tabular-nums', tone)}>{value}</span>
        {unit && <span className="font-mono text-[10px] text-slate-500">{unit}</span>}
      </div>
      {spark && <Sparkline values={spark} color={sparkColor} className="-mx-1 mt-0.5" />}
    </div>
  );
}

export function MetricsStrip({ s }: { s: LiveSnapshot }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      <Tile label="Requests" value={fmt(s.rpm)} unit="/min" spark={s.series} hint="Сүүлийн 60 секундын хүсэлт (бүх хэрэглэгч, cron, MCP)" />
      <Tile label="D1 queries" value={fmt(s.qpm)} unit="/min" spark={s.dbSeries} sparkColor="#fbbf24" tone="text-amber-100" />
      <Tile label="Rows read" value={fmt(s.readPm)} unit="/min" tone="text-cyan-100" hint="D1 скандсан мөр — төлбөр үүгээр тооцогдоно" />
      <Tile label="Rows written" value={fmt(s.writePm)} unit="/min" tone="text-amber-200" />
      <Tile label="p95 latency" value={String(Math.round(s.p95))} unit="ms" tone={s.p95 > 800 ? 'text-rose-300' : 'text-emerald-200'} />
      <Tile label="Edge cache" value={`${s.cacheHitPct}`} unit="% hit" tone="text-emerald-200" hint="D1 рүү очихгүй хариулсан хувь" />
      <Tile label="Errors" value={String(s.errorsPm)} unit="/min" tone={s.errorsPm ? 'text-rose-300' : 'text-slate-300'} hint="4xx/5xx (401, 404-өөс бусад)" />
      <Tile
        label="Isolates"
        value={String(s.isolates)}
        unit={s.colos.length ? s.colos.join('·') : 'edge'}
        tone="text-violet-200"
        hint="Сүүлийн минутад урсгал илгээсэн Worker isolate · Cloudflare colo"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Амьд урсгалын бүртгэл                                              */
/* ------------------------------------------------------------------ */

const METHOD_TONE: Record<string, string> = {
  GET: 'text-cyan-300',
  POST: 'text-amber-300',
  PUT: 'text-amber-300',
  PATCH: 'text-amber-300',
  DELETE: 'text-rose-300',
  CRON: 'text-violet-300',
};

function clock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function LiveFeed({
  events,
  me,
  onPick,
  empty,
}: {
  events: LiveEvent[];
  me: number | null;
  onPick(ev: LiveEvent): void;
  empty: string;
}) {
  if (!events.length) {
    return <div className="p-6 text-center font-mono text-[11px] leading-5 text-slate-500">{empty}</div>;
  }
  return (
    <ul className="divide-y divide-cyan-400/5 font-mono text-[11px]">
      {events.map((e, i) => {
        const tone = toneOf(e);
        return (
          <li key={`${e.t}-${i}-${e.p}`}>
            <button
              onClick={() => onPick(e)}
              className="grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2 px-2.5 py-1.5 text-left transition hover:bg-cyan-400/5 motion-safe:animate-in motion-safe:fade-in"
              title="Графаар дахин тоглуулах"
            >
              <span className="size-1.5 rounded-full" style={{ background: TONE_COLOR[tone], boxShadow: `0 0 8px ${TONE_COLOR[tone]}` }} />
              <span className={cn('w-10', METHOD_TONE[e.m] ?? 'text-slate-300')}>{e.k === 'mcp' ? 'MCP' : e.m}</span>
              <span className="truncate text-slate-200">{e.p}</span>
              <span className={cn('tabular-nums', e.s >= 500 ? 'text-rose-300' : e.s >= 400 ? 'text-amber-300' : 'text-emerald-300')}>
                {e.s}
              </span>
              <span className="col-start-3 flex flex-wrap gap-x-2 text-[10px] text-slate-500">
                <span>{clock(e.t)}</span>
                <span>{e.ms}ms</span>
                {e.q > 0 && (
                  <span className="text-amber-200/80">
                    q{e.q} r{e.r}
                    {e.w > 0 ? ` w${e.w}` : ''}
                  </span>
                )}
                {(e.ch === 'MEM' || e.ch === 'HIT') && <span className="text-emerald-300/80">cache {e.ch}</span>}
                {e.role && <span>{me != null && e.u === me ? 'you' : e.role}</span>}
                {e.c && <span>{e.c}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Сонгосон зангилаа                                                  */
/* ------------------------------------------------------------------ */

export interface NodeTraffic {
  count: number;
  rows: number;
  writes: number;
  avgMs: number;
  errors: number;
  topPaths: Array<[string, number]>;
  recent: LiveEvent[];
}

export function NodeInspector({
  node,
  traffic,
  onSelect,
  onOpenFile,
  onPick,
  me,
}: {
  node: GraphNode;
  traffic: NodeTraffic;
  onSelect(id: string): void;
  onOpenFile(path: string): void;
  onPick(ev: LiveEvent): void;
  me: number | null;
}) {
  const meta = WORKBENCH_NODES.find((n) => n.id === node.id);
  const { incoming, outgoing } = useMemo(
    () => ({
      incoming: WORKBENCH_EDGES.filter((e) => e.to === node.id),
      outgoing: WORKBENCH_EDGES.filter((e) => e.from === node.id),
    }),
    [node.id],
  );
  const label = (id: string) => WORKBENCH_NODES.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="space-y-3 p-3 text-xs">
      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-400/60">{node.dynamic ? 'unmapped route' : meta?.lane}</div>
        <h2 className="text-base font-semibold text-cyan-50">{node.label}</h2>
        <p className="font-mono text-[10px] text-slate-500">{node.subtitle}</p>
        {meta?.description && <p className="mt-2 leading-5 text-slate-300">{meta.description}</p>}
      </div>

      <div className="grid grid-cols-4 gap-1.5 font-mono">
        {[
          ['req/60s', traffic.count, 'text-cyan-100'],
          ['rows', traffic.rows, 'text-amber-100'],
          ['avg ms', traffic.avgMs, 'text-emerald-100'],
          ['errors', traffic.errors, traffic.errors ? 'text-rose-300' : 'text-slate-300'],
        ].map(([k, v, tone]) => (
          <div key={k as string} className="rounded border border-cyan-400/10 bg-black/30 px-2 py-1">
            <div className="text-[8.5px] uppercase tracking-wider text-slate-500">{k}</div>
            <div className={cn('text-sm tabular-nums', tone as string)}>{fmt(Number(v))}</div>
          </div>
        ))}
      </div>

      {traffic.topPaths.length > 0 && (
        <div>
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.25em] text-slate-500">Hot endpoints</div>
          {traffic.topPaths.map(([p, n]) => (
            <div key={p} className="flex items-center gap-2 py-0.5 font-mono text-[10.5px]">
              <div className="h-1 rounded bg-cyan-400/60" style={{ width: `${Math.max(6, (n / traffic.topPaths[0]![1]) * 60)}px` }} />
              <span className="min-w-0 flex-1 truncate text-slate-300">{p}</span>
              <span className="tabular-nums text-cyan-200">{n}</span>
            </div>
          ))}
        </div>
      )}

      {!node.dynamic && (
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['Receives from', incoming.map((e) => e.from)],
              ['Sends to', outgoing.map((e) => e.to)],
            ] as const
          ).map(([title, ids]) => (
            <div key={title} className="rounded border border-cyan-400/10 p-2">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-slate-500">{title}</div>
              {[...new Set(ids)].slice(0, 10).map((id) => (
                <button key={id} onClick={() => onSelect(id)} className="block w-full truncate text-left text-slate-300 hover:text-cyan-300">
                  {label(id)}
                </button>
              ))}
              {!ids.length && <span className="text-slate-600">—</span>}
            </div>
          ))}
        </div>
      )}

      {meta?.sourcePaths.length ? (
        <div>
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.25em] text-slate-500">Source</div>
          <div className="space-y-1">
            {meta.sourcePaths.map((path) => (
              <button
                key={path}
                onClick={() => onOpenFile(path)}
                className="flex w-full items-center gap-2 rounded border border-cyan-400/10 bg-black/20 px-2 py-1.5 text-left transition hover:border-cyan-400/40 hover:bg-cyan-400/5"
              >
                <FileCode2 className="size-3.5 shrink-0 text-cyan-400" />
                <span className="min-w-0 truncate font-mono text-[10.5px] text-slate-300">{path}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.25em] text-slate-500">Recent through this node</div>
        <div className="-mx-3 rounded border-y border-cyan-400/5">
          <LiveFeed events={traffic.recent} me={me} onPick={onPick} empty="Сүүлийн 5 минутад урсгал алга." />
        </div>
      </div>
    </div>
  );
}
