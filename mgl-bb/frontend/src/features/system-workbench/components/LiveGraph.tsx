import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { WORKBENCH_EDGES, WORKBENCH_NODES, type WorkbenchNode } from '../topology';
import { VIEW_H, VIEW_W, curvePath, pointOnCurve, type Point } from '../live/layout';
import {
  TONE_COLOR,
  flowDirection,
  flowPath,
  toneOf,
  type FlowDirection,
  type FlowTone,
  type LiveEvent,
} from '../live/routeMap';

/**
 * Амьд архитектурын граф.
 *
 * Хурдны загвар: React нь зангилаа/зураасыг (≈70 + ≈170) ЗӨВХӨН layout,
 * сонголт, шүүлт өөрчлөгдөхөд рендерлэнэ.  Бөөм, долгион, «халалт» нь
 * `requestAnimationFrame` гогцоонд SVG атрибутыг ШУУД бичнэ — урсгал
 * ихтэй үед ч React дахин рендерлэхгүй.  Идэвхтэй зүйл үгүй бол гогцоо зогсоно.
 */


const KIND_COLOR: Record<WorkbenchNode['kind'], string> = {
  actor: '#cbd5e1',
  app: '#22d3ee',
  service: '#34d399',
  domain: '#a78bfa',
  store: '#fbbf24',
  integration: '#fb923c',
  runtime: '#e879f9',
};

const COLUMN_TITLES: Array<[number, string]> = [
  [70, 'USERS · REVIT'],
  [285, 'FRONTEND · AI'],
  [505, 'EDGE'],
  [835, 'DOMAINS'],
  [1150, 'DATA'],
  [1330, 'EXTERNAL'],
];

const HOP_MS = 240;
const POOL = 140;
const RIPPLES = 24;
const HEAT_HALF_LIFE = 650;
const CORE = new Set(['worker', 'd1']);

export interface GraphNode {
  id: string;
  label: string;
  subtitle: string;
  kind: WorkbenchNode['kind'];
  dynamic?: boolean;
}

export interface LiveGraphHandle {
  /** Нэг үйл явдлыг (дахин) тоглуулна. */
  play(ev: LiveEvent, domain: string, delayMs?: number): void;
}

interface Props {
  nodes: GraphNode[];
  positions: Map<string, Point>;
  selectedId: string | null;
  onSelect(id: string | null): void;
  /** null = бүгд харагдана. */
  matchIds: Set<string> | null;
  /** 60 секундын хүсэлтийн тоо, зангилаа тус бүр. */
  hits: Map<string, number>;
}

type Particle = {
  /** Аялах дараалал (`flowPath`) — `pull` үед D1 → хэрэглэгч. */
  ids: string[];
  start: number;
  tone: FlowTone;
  rows: number;
  seg: number;
  dir: FlowDirection;
  /** Эхлэх зангилаагаа халааж (D1 бол долгион гаргаж) эхэлсэн эсэх. */
  started: boolean;
};

type Ripple = { node: string; start: number; max: number; color: string };

function edgeKey(a: string, b: string): string {
  return `${a}>${b}`;
}

export const LiveGraph = forwardRef<LiveGraphHandle, Props>(function LiveGraph(
  { nodes, positions, selectedId, onSelect, matchIds, hits },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const particleLayer = useRef<SVGGElement>(null);
  const rippleLayer = useRef<SVGGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);

  // Engine-ийн төлөв — ref-д (React рендер үүсгэхгүй).
  const posRef = useRef(positions);
  useEffect(() => {
    posRef.current = positions;
  }, [positions]);
  const particles = useRef<Particle[]>([]);
  const ripples = useRef<Ripple[]>([]);
  const nodeHeat = useRef(new Map<string, { v: number; color: string }>());
  const edgeHeat = useRef(new Map<string, { v: number; color: string }>());
  const pool = useRef<Array<{ core: SVGCircleElement; halo: SVGCircleElement }>>([]);
  const ripplePool = useRef<SVGCircleElement[]>([]);
  const frame = useRef<number | null>(null);
  const lastFrame = useRef(0);
  const ringEls = useRef(new Map<string, SVGCircleElement>());
  const edgeEls = useRef(new Map<string, SVGPathElement>());

  const edges = useMemo(() => {
    const seen = new Set<string>();
    return WORKBENCH_EDGES.filter((e) => {
      const k = edgeKey(e.from, e.to);
      if (seen.has(k) || !positions.has(e.from) || !positions.has(e.to)) return false;
      seen.add(k);
      return true;
    });
  }, [positions]);

  // Динамик зангилааны зураас: security → route, route → d1.
  const dynamicEdges = useMemo(
    () =>
      nodes
        .filter((n) => n.dynamic)
        .flatMap((n) => [
          { from: 'security', to: n.id },
          { from: n.id, to: 'd1' },
        ]),
    [nodes],
  );

  const neighbors = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set<string>([selectedId]);
    for (const e of [...edges, ...dynamicEdges]) {
      if (e.from === selectedId) ids.add(e.to);
      if (e.to === selectedId) ids.add(e.from);
    }
    return ids;
  }, [selectedId, edges, dynamicEdges]);

  /* ---------------- Бөөм, долгионы элемент (нэг удаа) ---------------- */
  useEffect(() => {
    const layer = particleLayer.current;
    const rLayer = rippleLayer.current;
    if (!layer || !rLayer) return;
    const NS = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < POOL; i++) {
      const halo = document.createElementNS(NS, 'circle');
      halo.setAttribute('r', '8');
      halo.setAttribute('opacity', '0');
      const core = document.createElementNS(NS, 'circle');
      core.setAttribute('r', '3.2');
      core.setAttribute('opacity', '0');
      layer.appendChild(halo);
      layer.appendChild(core);
      pool.current.push({ core, halo });
    }
    for (let i = 0; i < RIPPLES; i++) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke-width', '1.6');
      c.setAttribute('opacity', '0');
      rLayer.appendChild(c);
      ripplePool.current.push(c);
    }
    return () => {
      layer.replaceChildren();
      rLayer.replaceChildren();
      pool.current = [];
      ripplePool.current = [];
    };
  }, []);

  const kickRef = useRef<() => void>(() => {});

  /* ---------------- Анимацийн гогцоо (нэг удаа үүснэ) ---------------- */
  useEffect(() => {
    const heat = (map: Map<string, { v: number; color: string }>, key: string, amount: number, color: string) => {
      const cur = map.get(key);
      map.set(key, { v: Math.min(1.6, (cur?.v ?? 0) + amount), color });
    };

    function tick(now: number) {
      frame.current = null;
      const dt = lastFrame.current ? now - lastFrame.current : 16;
      lastFrame.current = now;
      const decay = Math.pow(0.5, dt / HEAT_HALF_LIFE);
      const pos = posRef.current;
      const svg = svgRef.current;
      let busy = false;

      // Бөөмүүд
      const alive: Particle[] = [];
      let slot = 0;
      for (const p of particles.current) {
        const elapsed = now - p.start;
        if (elapsed < 0) {
          alive.push(p);
          busy = true;
          continue;
        }
        const hops = p.ids.length - 1;
        const segF = elapsed / HOP_MS;
        const seg = Math.floor(segF);
        const color0 = TONE_COLOR[p.tone];
        // Эхлэх агшин: `pull` бөөм D1-ээс гарч байвал D1 өгөгдөл «цацаж» байна.
        if (!p.started) {
          p.started = true;
          const first = p.ids[0]!;
          heat(nodeHeat.current, first, 0.55, color0);
          if (first === 'd1') {
            ripples.current.push({ node: first, start: now, max: 22 + Math.log10(p.rows + 1) * 14, color: color0 });
          }
        }
        // Зангилаанд хүрэх бүрд халаана.
        while (p.seg < Math.min(seg, hops)) {
          p.seg++;
          const reached = p.ids[p.seg]!;
          heat(nodeHeat.current, reached, 0.55, color0);
          const arrived = p.seg === hops;
          if (reached === 'd1' || (arrived && p.tone === 'error')) {
            ripples.current.push({
              node: reached,
              start: now,
              max: reached === 'd1' ? 22 + Math.log10(p.rows + 1) * 14 : 26,
              color: color0,
            });
          } else if (arrived && p.dir === 'pull') {
            // Өгөгдөл хэрэглэгчид (Staff / Revit add-in) хүрлээ.
            ripples.current.push({ node: reached, start: now, max: 16, color: color0 });
          }
        }
        if (seg >= hops) continue;
        const a = pos.get(p.ids[seg]!);
        const b = pos.get(p.ids[seg + 1]!);
        const el = pool.current[slot];
        if (!a || !b || !el) continue;
        slot++;
        alive.push(p);
        busy = true;
        const pt = pointOnCurve(a, b, segF - seg);
        const color = color0;
        el.core.setAttribute('cx', pt.x.toFixed(1));
        el.core.setAttribute('cy', pt.y.toFixed(1));
        el.core.setAttribute('fill', color);
        el.core.setAttribute('opacity', '1');
        el.halo.setAttribute('cx', pt.x.toFixed(1));
        el.halo.setAttribute('cy', pt.y.toFixed(1));
        el.halo.setAttribute('fill', color);
        el.halo.setAttribute('opacity', '0.22');
        const from = p.ids[seg]!;
        const to = p.ids[seg + 1]!;
        heat(edgeHeat.current, edgeKey(from, to), dt / 300, color);
        heat(edgeHeat.current, edgeKey(to, from), dt / 300, color);
      }
      for (let i = slot; i < pool.current.length; i++) {
        const el = pool.current[i]!;
        if (el.core.getAttribute('opacity') !== '0') {
          el.core.setAttribute('opacity', '0');
          el.halo.setAttribute('opacity', '0');
        }
      }
      particles.current = alive;

      // Долгион
      const liveRipples: Ripple[] = [];
      ripples.current.forEach((r) => {
        const t = (now - r.start) / 750;
        if (t >= 1) return;
        liveRipples.push(r);
      });
      ripples.current = liveRipples.slice(-RIPPLES);
      ripplePool.current.forEach((c, i) => {
        const r = ripples.current[i];
        const p = r ? pos.get(r.node) : undefined;
        if (!r || !p) {
          if (c.getAttribute('opacity') !== '0') c.setAttribute('opacity', '0');
          return;
        }
        busy = true;
        const t = (now - r.start) / 750;
        c.setAttribute('cx', String(p.x));
        c.setAttribute('cy', String(p.y));
        c.setAttribute('r', (8 + r.max * t).toFixed(1));
        c.setAttribute('stroke', r.color);
        c.setAttribute('opacity', (0.9 * (1 - t)).toFixed(2));
      });

      // Халалт — зангилааны цагираг, зураасны тод байдал.
      if (svg) {
        for (const [id, h] of nodeHeat.current) {
          h.v *= decay;
          const ring = ringEls.current.get(id);
          if (h.v < 0.02) {
            nodeHeat.current.delete(id);
            ring?.setAttribute('opacity', '0');
            continue;
          }
          busy = true;
          if (ring) {
            ring.setAttribute('opacity', Math.min(1, h.v).toFixed(2));
            ring.setAttribute('r', ((CORE.has(id) ? 18 : 11) + h.v * 9).toFixed(1));
            ring.setAttribute('stroke', h.color);
          }
        }
        for (const [key, h] of edgeHeat.current) {
          h.v *= decay;
          const path = edgeEls.current.get(key);
          if (h.v < 0.02) {
            edgeHeat.current.delete(key);
            if (path) {
              path.style.removeProperty('stroke');
              path.style.removeProperty('stroke-opacity');
              path.style.removeProperty('stroke-width');
            }
            continue;
          }
          busy = true;
          if (path) {
            path.style.stroke = h.color;
            path.style.strokeOpacity = Math.min(0.95, 0.25 + h.v * 0.7).toFixed(2);
            path.style.strokeWidth = (1.2 + Math.min(1, h.v) * 1.8).toFixed(2);
          }
        }
      }

      if (busy) frame.current = requestAnimationFrame(tick);
      else lastFrame.current = 0;
    }

    kickRef.current = () => {
      if (frame.current == null && !document.hidden) frame.current = requestAnimationFrame(tick);
    };
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
      kickRef.current = () => {};
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      play(ev, domain, delayMs = 0) {
        if (document.hidden) return;
        const ids = flowPath(ev, domain).filter((id) => posRef.current.has(id));
        if (ids.length < 2) return;
        particles.current.push({
          ids,
          start: performance.now() + delayMs,
          tone: toneOf(ev),
          rows: ev.r,
          seg: 0,
          dir: flowDirection(ev),
          started: false,
        });
        if (particles.current.length > POOL * 2) particles.current.splice(0, particles.current.length - POOL * 2);
        kickRef.current();
      },
    }),
    [],
  );

  /* ---------------- Pan / zoom ---------------- */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
      const ox = (rect.width - VIEW_W * scale) / 2;
      const oy = (rect.height - VIEW_H * scale) / 2;
      const mx = (e.clientX - rect.left - ox) / scale;
      const my = (e.clientY - rect.top - oy) / scale;
      setView((v) => {
        const k = Math.max(0.5, Math.min(3, v.k * (e.deltaY > 0 ? 0.9 : 1.1)));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const svgScale = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? Math.min(rect.width / VIEW_W, rect.height / VIEW_H) : 1;
  };

  const all = useMemo(() => [...edges, ...dynamicEdges], [edges, dynamicEdges]);

  // Халалтын гогцоо элементээ frame бүрд хайхгүйн тулд DOM-ын толь.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    ringEls.current = new Map(
      [...svg.querySelectorAll<SVGCircleElement>('[data-ring]')].map((el) => [el.dataset.ring ?? '', el]),
    );
    edgeEls.current = new Map(
      [...svg.querySelectorAll<SVGPathElement>('[data-edge]')].map((el) => [el.dataset.edge ?? '', el]),
    );
  }, [all, nodes, positions, selectedId, matchIds]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full cursor-grab select-none touch-none active:cursor-grabbing"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: view.x, y: view.y, px: e.clientX, py: e.clientY, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const s = svgScale();
          const dx = (e.clientX - d.px) / s;
          const dy = (e.clientY - d.py) / s;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          setView((v) => ({ ...v, x: d.x + dx, y: d.y + dy }));
        }}
        onPointerUp={(e) => {
          const moved = drag.current?.moved;
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          if (!moved && e.target === e.currentTarget) onSelect(null);
        }}
        onDoubleClick={() => setView({ x: 0, y: 0, k: 1 })}
      >
        <defs>
          <pattern id="wb-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(56,189,248,.06)" strokeWidth="1" />
          </pattern>
          <radialGradient id="wb-glow" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="rgba(34,211,238,.10)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0)" />
          </radialGradient>
        </defs>
        <rect width={VIEW_W} height={VIEW_H} fill="url(#wb-grid)" pointerEvents="none" />
        <rect width={VIEW_W} height={VIEW_H} fill="url(#wb-glow)" pointerEvents="none" />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {COLUMN_TITLES.map(([x, title]) => (
            <text
              key={title}
              x={x - 8}
              y={30}
              textAnchor="start"
              className="fill-cyan-300/45 font-mono text-[12px] tracking-[0.3em]"
              pointerEvents="none"
            >
              {title}
            </text>
          ))}

          <g fill="none">
            {all.map((e) => {
              const a = positions.get(e.from);
              const b = positions.get(e.to);
              if (!a || !b) return null;
              const focused = selectedId != null && (e.from === selectedId || e.to === selectedId);
              const dim =
                (neighbors && !focused) || (matchIds && !(matchIds.has(e.from) && matchIds.has(e.to)));
              return (
                <path
                  key={edgeKey(e.from, e.to)}
                  data-edge={edgeKey(e.from, e.to)}
                  d={curvePath(a, b)}
                  stroke={focused ? '#67e8f9' : '#38bdf8'}
                  strokeOpacity={focused ? 0.75 : dim ? 0.04 : 0.13}
                  strokeWidth={focused ? 1.8 : 1}
                  pointerEvents="none"
                />
              );
            })}
          </g>

          <g ref={rippleLayer} pointerEvents="none" />

          {nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const isSel = n.id === selectedId;
            const big = CORE.has(n.id);
            const dim = (neighbors && !neighbors.has(n.id)) || (matchIds && !matchIds.has(n.id));
            const color = n.dynamic ? '#94a3b8' : KIND_COLOR[n.kind];
            const count = hits.get(n.id) ?? 0;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                opacity={dim ? 0.18 : 1}
                className="cursor-pointer transition-opacity duration-300"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelect(isSel ? null : n.id)}
                onPointerEnter={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (rect) setHover({ id: n.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onPointerLeave={() => setHover(null)}
              >
                <circle data-ring={n.id} r={big ? 18 : 11} fill="none" strokeWidth="2" opacity="0" />
                {big && (
                  <circle
                    r={24}
                    fill="none"
                    stroke={color}
                    strokeOpacity={0.35}
                    strokeDasharray="4 7"
                    className="motion-safe:animate-[spin_14s_linear_infinite]"
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  />
                )}
                {isSel && <circle r={big ? 30 : 20} fill="rgba(34,211,238,.08)" stroke="#67e8f9" strokeOpacity={0.6} />}
                <circle
                  r={big ? 12 : n.kind === 'domain' || n.dynamic ? 6.5 : 7.5}
                  fill={color}
                  fillOpacity={count > 0 || big ? 1 : 0.55}
                  stroke="#020617"
                  strokeWidth={2}
                />
                <text x={big ? 20 : 13} y={-1} className="fill-slate-100 text-[15px] font-semibold" pointerEvents="none">
                  {n.label}
                </text>
                <text x={big ? 20 : 13} y={14} className="fill-slate-500 text-[10.5px]" pointerEvents="none">
                  {n.subtitle}
                </text>
                {count > 0 && (
                  <g transform={`translate(${big ? -16 : -11} ${big ? -20 : -14})`} pointerEvents="none">
                    <rect x={-14} y={-8} width={28} height={13} rx={6.5} fill="#082f49" stroke="#22d3ee" strokeOpacity={0.6} />
                    <text textAnchor="middle" y={2} className="fill-cyan-200 font-mono text-[8.5px]">
                      {count > 999 ? '999+' : count}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          <g ref={particleLayer} pointerEvents="none" />
        </g>
      </svg>

      {hover && (
        <HoverCard node={nodes.find((n) => n.id === hover.id)} x={hover.x} y={hover.y} hits={hits.get(hover.id) ?? 0} />
      )}
    </div>
  );
});

function HoverCard({ node, x, y, hits }: { node: GraphNode | undefined; x: number; y: number; hits: number }) {
  if (!node) return null;
  const desc = WORKBENCH_NODES.find((n) => n.id === node.id)?.description;
  return (
    <div
      className="pointer-events-none absolute z-20 w-64 rounded-md border border-cyan-400/30 bg-slate-950/90 p-3 text-xs shadow-[0_0_24px_rgba(34,211,238,.18)] backdrop-blur"
      style={{ left: Math.min(x + 16, 9999), top: y + 16 }}
    >
      <div className="font-semibold text-cyan-100">{node.label}</div>
      <div className="font-mono text-[10px] text-slate-500">{node.subtitle}</div>
      {desc && <p className="mt-1.5 leading-4 text-slate-300">{desc}</p>}
      <div className="mt-2 font-mono text-[10px] text-cyan-300">{hits} req · last 60s</div>
    </div>
  );
}
