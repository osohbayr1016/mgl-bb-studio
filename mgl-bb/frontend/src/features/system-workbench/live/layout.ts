/**
 * Графын байрлал — зүүнээс баруун тийш урсгал:
 *   хэрэглэгч → frontend → edge (worker + хаалт) → домэйн (2 багана) → өгөгдөл → гадаад.
 * Revit ба локал AI нь эхний хоёр баганын доод хэсэгт.  Детерминист — dynamic
 * (танигдаагүй prefix) зангилаа нь домэйны баганын төгсгөлд нэмэгдэнэ.
 */
import { WORKBENCH_NODES } from '../topology';

export const VIEW_W = 1500;
export const VIEW_H = 940;
const PAD_Y = 64;
const GAP = '|';

export type Point = { x: number; y: number };

const COLUMN_X = { A: 70, B: 285, C: 505, D: 725, E: 945, F: 1150, G: 1330 } as const;

const FIXED: Record<keyof typeof COLUMN_X, string[]> = {
  A: ['staff', 'client-user', 'claude', 'cron', GAP, 'revit-addin', 'work-tracking', 'change-impact', 'revit-tools', 'bridge', 'local-agent'],
  B: ['browser', 'auth-ui', 'query', 'api-client', 'workbench', GAP, 'local-runtime', 'retrieval', 'llama'],
  C: ['worker', 'security', GAP, 'mgl-control', 'remote-mcp'],
  D: [],
  E: [],
  F: ['d1', GAP, 'r2-media', 'r2-audio', 'oauth-kv', 'mcp-do', 'client-do'],
  G: ['browser-render', 'google', 'speechmatics', 'aps', 'push-provider'],
};

const PLACED = new Set(Object.values(FIXED).flat());

/** Домэйн зангилаанууд — урсгалын дарааллаар. */
const DOMAIN_ORDER = [
  'projects', 'tasks', 'allocation', 'progress', 'attendance', 'teams', 'people', 'dashboard', 'notifications', 'revit-api',
  'documents', 'drive', 'signing', 'asr', 'client', 'qto', 'reports', 'email', 'meetings', 'quotes', 'compliance',
];

function placeColumn(ids: string[], x: number, out: Map<string, Point>): void {
  const items = ids.filter((id) => id !== GAP);
  if (!items.length) return;
  const gaps = ids.filter((id) => id === GAP).length;
  const units = items.length - 1 + gaps * 0.9;
  const step = units > 0 ? Math.min(118, (VIEW_H - PAD_Y * 2) / units) : 0;
  const total = units * step;
  let y = (VIEW_H - total) / 2;
  let first = true;
  for (const id of ids) {
    if (id === GAP) {
      y += step * 0.9;
      continue;
    }
    if (!first) y += step;
    first = false;
    // Gap-ийн дараах мөр нэмэлт алхам авахгүй — дээрх `y += step * 0.9` хангалттай.
    out.set(id, { x, y });
  }
}

/**
 * Бүх зангилааны байрлал.  `dynamicIds` — амьд урсгалд гарч ирсэн, topology-д
 * байхгүй route-ууд.
 */
export function computeLayout(dynamicIds: readonly string[]): Map<string, Point> {
  const domains = [
    ...DOMAIN_ORDER.filter((id) => WORKBENCH_NODES.some((n) => n.id === id)),
    ...WORKBENCH_NODES.filter((n) => n.lane === 'backend' && !PLACED.has(n.id) && !DOMAIN_ORDER.includes(n.id)).map((n) => n.id),
    ...dynamicIds,
  ].filter((id) => !PLACED.has(id));
  const half = Math.ceil(domains.length / 2);
  const out = new Map<string, Point>();
  for (const key of Object.keys(COLUMN_X) as Array<keyof typeof COLUMN_X>) {
    const ids = key === 'D' ? domains.slice(0, half) : key === 'E' ? domains.slice(half) : FIXED[key];
    placeColumn(ids, COLUMN_X[key], out);
  }
  // Ямар нэг баганад ороогүй үлдсэн topology зангилаа — баруун доод буланд.
  let extraY = VIEW_H - PAD_Y;
  for (const n of WORKBENCH_NODES) {
    if (!out.has(n.id)) {
      out.set(n.id, { x: COLUMN_X.G, y: extraY });
      extraY -= 60;
    }
  }
  return out;
}

/** Хоёр цэгийн хоорондох хэвтээ S-муруй (cubic bezier) — зураас ба бөөм ижил муруйг хэрэглэнэ. */
export function curve(a: Point, b: Point): [Point, Point, Point, Point] {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
  const dir = b.x >= a.x ? 1 : -1;
  return [a, { x: a.x + dx * dir, y: a.y }, { x: b.x - dx * dir, y: b.y }, b];
}

export function curvePath(a: Point, b: Point): string {
  const [p0, p1, p2, p3] = curve(a, b);
  return `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} C${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} ${p3.x.toFixed(1)} ${p3.y.toFixed(1)}`;
}

export function pointOnCurve(a: Point, b: Point, t: number): Point {
  const [p0, p1, p2, p3] = curve(a, b);
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
    y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
  };
}
