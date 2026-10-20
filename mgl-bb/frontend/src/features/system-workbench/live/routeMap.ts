/**
 * Нэг амьд үйл явдал (хүсэлт / cron / MCP) графын АЛЬ зангилаануудаар дамжихыг
 * шийдэх ГАНЦ газар.  Backend-ийн `lib/liveTraffic.ts` `LiveEvent`-ийн ихэр төрөл.
 */

export type LiveKind = 'http' | 'cron' | 'mcp';

export interface LiveEvent {
  t: number;
  k: LiveKind;
  m: string;
  p: string;
  s: number;
  ms: number;
  q: number;
  r: number;
  w: number;
  u: number | null;
  role: string | null;
  c: string | null;
  ch: string | null;
  /** `'revit'` = Revit add-in (User-Agent / токены зорилго); null эсвэл байхгүй = хөтөч. */
  src?: 'revit' | null;
}

/**
 * Урсгалын чиглэл — хэрэглэгчийн ойлголтоор (method-оос):
 *   `pull` = GET/HEAD: өгөгдлийг D1-ЭЭС авч хэрэглэгч рүү (бөөм D1 → хэрэглэгч),
 *   `push` = POST/PUT/PATCH/DELETE: хэрэглэгчээс D1 РҮҮ илгээнэ (бөөм хэрэглэгч → D1).
 * 401/403 нь хамгаалалтын хаалган дээр зогссон хүсэлт тул үргэлж `push`.
 */
export type FlowDirection = 'pull' | 'push';

/** Бөөмийн өнгөний ангилал. */
export type FlowTone = 'read' | 'write' | 'error' | 'cache' | 'cron' | 'mcp' | 'media';

/** Бөөм / бүртгэлийн өнгө. */
export const TONE_COLOR: Record<FlowTone, string> = {
  read: '#22d3ee',
  write: '#fbbf24',
  error: '#fb7185',
  cache: '#34d399',
  cron: '#a78bfa',
  mcp: '#e879f9',
  media: '#60a5fa',
};

/** `/api/<prefix>` → domain зангилаа.  Дарааллаар — эхний таарсан нь ялна. */
const DOMAIN_RULES: Array<[RegExp, string]> = [
  [/^\/api\/(projects|main-projects)\/:id\/drive/, 'drive'],
  [/allocation|alloc-admin/, 'allocation'],
  [/^\/api\/(signing-links)|^\/public\/signing|\/signature/, 'signing'],
  [/^\/api\/(projects|main-projects|blocks|drawings|components|timeline|deadlines)(\/|$)/, 'projects'],
  [/^\/api\/(tasks|task-timer)(\/|$)/, 'tasks'],
  [/^\/api\/(progress|repair|non-project-work)(\/|$)/, 'progress'],
  [/^\/api\/(attendance|attendance-confirmations|leaves|holidays|out-of-office|settings)(\/|$)/, 'attendance'],
  [/^\/api\/(documents|internal-rules|announcements)(\/|$)/, 'documents'],
  [/^\/api\/author-supervision(\/|$)/, 'asr'],
  [/^\/api\/(client|client-admin|client-files)(\/|$)/, 'client'],
  [/^\/api\/(qto|aps)(\/|$)/, 'qto'],
  [/^\/api\/(reports|performance-reports|report-templates)(\/|$)/, 'reports'],
  [/^\/api\/(email|correspondence)(\/|$)/, 'email'],
  [/^\/api\/meetings(\/|$)/, 'meetings'],
  [/^\/api\/quotes(\/|$)/, 'quotes'],
  [/^\/api\/compliance(\/|$)/, 'compliance'],
  [/^\/api\/(notifications|push)(\/|$)/, 'notifications'],
  [/^\/api\/mgl-ai(\/|$)/, 'mgl-control'],
  [/^\/api\/revit(\/|$)/, 'revit-api'],
  [/^\/api\/teams(\/|$)/, 'teams'],
  [/^\/api\/(users|profiles|auth|daily-work-logs)(\/|$)/, 'people'],
  [/^\/api\/(dashboard|company|ticker|leaderboard|search|calendar)(\/|$)/, 'dashboard'],
];

/** Cron ажлын нэр → домэйн (+ гадаад үйлчилгээ). */
const CRON_DOMAIN: Record<string, string[]> = {
  pushSweep: ['notifications', 'push-provider'],
  emailSync: ['email', 'google'],
  reconcileMeetings: ['meetings', 'speechmatics'],
  reconcileAsr: ['asr', 'speechmatics'],
  gcalSync: ['dashboard', 'google'],
  taskPostCommit: ['allocation'],
  deadlineSweep: ['projects'],
  employeeSnapshot: ['reports'],
  gdocSweep: ['documents', 'google'],
  driveVersions: ['drive', 'google'],
  repairHoursBackfill: ['progress'],
  taskTimerDayEnd: ['tasks'],
};

/** Танигдаагүй prefix-ийн динамик зангилааны id (`route:/api/foo`). */
export function dynamicNodeId(path: string): string {
  const m = /^\/(api|public)\/([^/]+)/.exec(path);
  return m ? `route:/${m[1]}/${m[2]}` : 'route:other';
}

export function domainOf(path: string): string | null {
  if (path.startsWith('/media/')) return 'r2-media';
  for (const [re, id] of DOMAIN_RULES) if (re.test(path)) return id;
  return null;
}

/** Үйл явдлын домэйн зангилаа (http л); танигдаагүй `/api` prefix → динамик `route:` зангилаа. */
export function domainFor(ev: LiveEvent): string | null {
  if (ev.k !== 'http') return null;
  return domainOf(ev.p) ?? dynamicNodeId(ev.p);
}

export function flowDirection(ev: LiveEvent): FlowDirection {
  if (ev.k !== 'http') return 'push';
  if (ev.s === 401 || ev.s === 403) return 'push';
  return ev.m === 'GET' || ev.m === 'HEAD' ? 'pull' : 'push';
}

/** Өнгө нь чиглэлтэй ИЖИЛ дүрмээр: цэнхэр = D1-ээс авч буй (GET), шар = D1 рүү илгээж буй (POST…). */
export function toneOf(ev: LiveEvent): FlowTone {
  if (ev.k === 'cron') return ev.s >= 400 ? 'error' : 'cron';
  if (ev.k === 'mcp') return ev.s >= 400 ? 'error' : 'mcp';
  if (ev.s >= 400) return 'error';
  if (ev.p.startsWith('/media/')) return 'media';
  if (ev.ch === 'MEM' || ev.ch === 'HIT') return 'cache';
  return flowDirection(ev) === 'push' ? 'write' : 'read';
}

function isRevitPath(path: string): boolean {
  return path.startsWith('/api/revit') || /^\/api\/qto\/(revit-runs|schedules|view-exports)/.test(path);
}

/** Revit add-in-ий хүсэлт — worker-ийн `src` (UA) эсвэл хуучин worker-т add-in-ий зам. */
export function isRevitEvent(ev: LiveEvent): boolean {
  return ev.src === 'revit' || isRevitPath(ev.p);
}

/**
 * Үйл явдлын замыг (зангилааны id-ийн жагсаалт) гаргана.  `domain` нь
 * `domainOf` эсвэл динамик id.
 */
export function eventRoute(ev: LiveEvent, domain: string): string[] {
  if (ev.k === 'cron') {
    const tail = CRON_DOMAIN[ev.p] ?? [];
    const [first, ...ext] = tail;
    return ['cron', 'worker', ...(first ? [first] : []), ...(ev.q > 0 ? ['d1'] : []), ...ext];
  }
  if (ev.k === 'mcp') return ['claude', 'remote-mcp', 'mcp-do'];

  let origin: string[];
  if (isRevitEvent(ev)) origin = ['revit-addin', 'worker'];
  else if (ev.p.startsWith('/public/')) origin = ['client-user', 'worker'];
  else if (ev.role === 'client') origin = ['client-user', 'browser', 'api-client', 'worker'];
  else origin = ['staff', 'browser', 'api-client', 'worker'];

  if (domain === 'r2-media') return [...origin, 'r2-media'];
  // 401/403 — хамгаалалтын хаалган дээр зогсоно.
  if (ev.s === 401 || ev.s === 403) return [...origin, 'security'];
  const cached = ev.ch === 'MEM' || ev.ch === 'HIT';
  return [...origin, 'security', domain, ...(!cached && ev.q > 0 ? ['d1'] : [])];
}

/**
 * Бөөмийн аялах дараалал: `eventRoute` (хүсэлтийн зам — тоолуур, шүүлт үүнийг
 * хэрэглэнэ) нь `pull` үед ЭСРЭГ — өгөгдөл D1-ээс (эсвэл кэш/домэйноос) хэрэглэгч
 * рүү буцаж урсана.  Зураасууд хоёр чиглэлд ижил тул бөөм зурсан замаараа явна.
 */
export function flowPath(ev: LiveEvent, domain: string): string[] {
  const route = eventRoute(ev, domain);
  return flowDirection(ev) === 'pull' ? route.slice().reverse() : route;
}
