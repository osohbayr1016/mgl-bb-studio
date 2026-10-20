import type { Env, AppVariables } from '../types';

export type CorrespondenceCtx = {
  Bindings: Env;
  Variables: AppVariables;
};

export type CanWriteFn = (
  db: D1Database,
  projectId: number,
  viewer: { sub: number; role: string },
) => Promise<boolean>;

const UB_TZ = 'Asia/Ulaanbaatar';

export type CorrespondenceDocType = 'rfi' | 'cr' | 'official' | 'mr';
const DOC_TYPES = new Set<string>(['rfi', 'cr', 'official', 'mr']);

export interface ClientContact {
  full_name: string;
  position: string;
  phone: string;
  email: string;
}

export function ubDateNow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function parseClientContacts(json: string | null): ClientContact[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((c): ClientContact | null => {
        if (!c || typeof c !== 'object') return null;
        const item = c as Record<string, unknown>;
        return {
          full_name: typeof item.full_name === 'string' ? item.full_name : '',
          position: typeof item.position === 'string' ? item.position : '',
          phone: typeof item.phone === 'string' ? item.phone : '',
          email: typeof item.email === 'string' ? item.email : '',
        };
      })
      .filter((c): c is ClientContact => c !== null);
  } catch {
    return [];
  }
}

export function normalizeMediaUrl(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t || !t.startsWith('/media/')) return null;
  return t;
}

export function isValidDocType(v: unknown): v is CorrespondenceDocType {
  return typeof v === 'string' && DOC_TYPES.has(v);
}

/** Public mailbox providers — alias filter is meaningless for these. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
]);

export function extractDomainAddrs(rawValues: (string | null)[], domain: string): string[] {
  const d = domain.toLowerCase().replace(/[.]/g, '\\.');
  const re = new RegExp(`[A-Za-z0-9._%+\\-]+@${d}`, 'gi');
  const set = new Set<string>();
  for (const v of rawValues) {
    if (!v) continue;
    const matches = v.match(re);
    if (matches) for (const m of matches) set.add(m.toLowerCase());
  }
  return [...set].sort();
}
