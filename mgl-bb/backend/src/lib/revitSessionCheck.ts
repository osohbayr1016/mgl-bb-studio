/**
 * `purpose:'revit'` session токеныг ТӨХӨӨРӨМЖИЙН ОДООГИЙН төлөвтэй тулгана (migration 0375).
 *
 * ЯАГААД: session токен 30 минутын настай ч JWT нь өөрөө DB-г мэдэхгүй.  Admin
 * төхөөрөмжийг хаасан / цуцалсан, түлхүүрийг устгасан, эсвэл «бүх лицензийг зогсоох»
 * унтраалга асаасан бол тэр session үлдсэн ≤ 30 минутыг дуусгахгүй — энэ шалгалт
 * `middleware/auth.ts`-ээс хүсэлт бүрд (60 секундийн кэштэй) ажиллана.
 *
 * ⚠️ FAIL-CLOSED: D1 алдаа гарвал session ХҮЧИНГҮЙ (add-in session-аа шинэчлэхийг
 *    оролдоно; тэр нь мөн л D1-ээс хамаарна → softly дахин оролдоно).  `users`-ийн
 *    идэвхтэй эсэх, `tokens_valid_from`-ыг `checkTokenValidity` аль хэдийн шалгасан.
 */
import type { JWTPayload } from '../types';
import { currentTenantId } from './requestContext';
import { isDeviceStatusX } from './revitDeviceAccess';
import { loadPolicy } from './revitPolicy';

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; state: SessionState }>();

export interface SessionState {
  valid: boolean;
  /** `revit.session_scope = open` — session бүх /api-д хүчинтэй (яаралтай нөхөн сэргээлт). */
  scopeOpen: boolean;
}

/**
 * `purpose:'revit'` session-ийн хүрэх ЗАМУУД.  Session нь add-in-ий замуудад л хэрэгтэй — хулгайлагдсан
 * session (admin role-той ч гэсэн) 30 минутын турш бүх /api-д (хэрэглэгч, төлбөр, MCP токен цохих г.м.)
 * хүрэх ёсгүй.  Жагсаалт нь add-in-ий (`revit-mcp/addin`) дуудадаг БҮХ /api замууд: ApiClient, RevitApi,
 * WorkPaneApi, WorkTracking, BimEmitter, Intelligence/MglAiTurnClient.  Шинэ замыг add-in дуудах бол ЭНД нэм
 * (эс бөгөөс 403 `SESSION_SCOPE`; `revit.session_scope=open` нь түр нөхөн сэргээнэ).
 */
export const REVIT_SESSION_PREFIXES: readonly string[] = [
  '/api/revit',
  '/api/revit-addin',
  '/api/qto',
  '/api/upload',
  '/api/projects',
  '/api/learning',
  '/api/tasks/checklist',
  '/api/repair',
  '/api/compliance',
  '/api/mgl-ai',
  '/api/auth/me',
];

/**
 * Угтвараар биш, МЕТОД + ЯГ замаар зөвшөөрөх add-in-ий замууд (2026-10-16).  «Програмын хүсэлт»: add-in нь ЗӨВХӨН
 * өөрийн ноорог/хавсралт/submit/баримт/retest замыг дуудна — `/api/engineering-feedback/inbox*` (reviewer-ийн inbox)
 * энд ЗОРИУД байхгүй, тиймээс admin role-той төхөөрөмжийн session ч inbox нээхгүй (router өөрөө ч `purpose`-тэй
 * токеныг inbox-д хүлээн авдаггүй — давхар хамгаалалт, `revit.session_scope=open` үед ч).
 */
const EF_ID = 'efr_[a-z2-9]{26}';
const EF_AID = 'efa_[a-z2-9]{26}';
const EF_BASE = '/api/engineering-feedback';
export const REVIT_SESSION_ROUTES: ReadonlyArray<{ methods: readonly string[]; re: RegExp }> = [
  { methods: ['GET'], re: new RegExp(`^${EF_BASE}/capabilities$`) },
  { methods: ['POST'], re: new RegExp(`^${EF_BASE}/drafts$`) },
  { methods: ['GET', 'PATCH'], re: new RegExp(`^${EF_BASE}/drafts/${EF_ID}$`) },
  { methods: ['POST'], re: new RegExp(`^${EF_BASE}/drafts/${EF_ID}/(attachments|submit)$`) },
  { methods: ['PUT'], re: new RegExp(`^${EF_BASE}/attachments/${EF_AID}/(content|parts/[0-9]{1,5})$`) },
  { methods: ['POST'], re: new RegExp(`^${EF_BASE}/attachments/${EF_AID}/complete$`) },
  { methods: ['DELETE'], re: new RegExp(`^${EF_BASE}/attachments/${EF_AID}$`) },
  { methods: ['GET'], re: new RegExp(`^${EF_BASE}/mine(/${EF_ID})?$`) },
  { methods: ['POST'], re: new RegExp(`^${EF_BASE}/mine/${EF_ID}/retest$`) },
];

export function revitSessionPathAllowed(path: string, method = 'GET'): boolean {
  if (REVIT_SESSION_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return true;
  const m = method.toUpperCase();
  return REVIT_SESSION_ROUTES.some((r) => r.methods.includes(m) && r.re.test(path));
}

function key(p: JWTPayload): string {
  return `${currentTenantId()}:${p.sub}:${p.dev ?? ''}:${p.kid ?? ''}`;
}

export function invalidateRevitSessionCache(): void {
  cache.clear();
}

export async function revitSessionState(db: D1Database, payload: JWTPayload): Promise<SessionState> {
  const none: SessionState = { valid: false, scopeOpen: false };
  if (!payload.dev || !payload.kid) return none;
  const k = key(payload);
  const now = Date.now();
  const hit = cache.get(k);
  if (hit && now - hit.at < TTL_MS) return hit.state;

  let state: SessionState = none;
  let cacheIt = true;
  try {
    const policy = await loadPolicy(db);
    if (!policy) cacheIt = false;
    if (policy && !policy.disabled) {
      const row = await db
        .prepare(
          `SELECT d.status, k.key_id, u.role
             FROM revit_license_devices d
             JOIN revit_device_keys k ON k.device_row_id = d.id
             JOIN users u ON u.id = d.user_id
            WHERE d.user_id = ? AND d.device_id = ?`,
        )
        .bind(payload.sub, payload.dev)
        .first<{ status: string; key_id: string; role: string }>();
      // ⚠️ role-ийг ДАХИН тулгана: session-д role нь олгосон агшных (30 минут) — admin-аас
      //    буулгасан хүний session хуучин эрхээрээ үргэлжлэх ёсгүй.
      const valid =
        !!row &&
        isDeviceStatusX(row.status) &&
        (row.status === 'auto' || row.status === 'approved') &&
        row.key_id === payload.kid &&
        row.role === payload.role;
      state = { valid, scopeOpen: policy.sessionScope === 'open' };
    }
  } catch (err) {
    console.error('[revit-session] төхөөрөмж шалгаж чадсангүй', err);
    state = none;
    cacheIt = false; // D1 түр алдааг 60 секунд тогтоохгүй
  }
  if (cacheIt) cache.set(k, { at: now, state });
  return state;
}

export async function revitSessionValid(db: D1Database, payload: JWTPayload): Promise<boolean> {
  return (await revitSessionState(db, payload)).valid;
}
