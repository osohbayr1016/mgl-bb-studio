/**
 * Google OAuth2 access-token minting for the Gmail integration.
 *
 * Two strategies behind one entry point ({@link getAccessTokenForAccount}):
 *
 *   • 'workspace'  — Service account + domain-wide delegation.  We sign a
 *     short-lived RS256 JWT asserting `iss = SA email`, `sub = mailbox`
 *     (impersonation) and exchange it for an access token.  No per-user
 *     login, no stored refresh token — just the SA private key
 *     (`GOOGLE_SA_JSON` secret).  This is the path for @mglenc.com style
 *     Workspace mailboxes whose MX points at Google.
 *
 *   • 'oauth'      — Plain @gmail.com mailboxes connected via the consent
 *     flow.  We store an encrypted refresh token per mailbox and trade it
 *     for an access token here.
 *
 * Tokens are cached per isolate for their lifetime (minus a 60 s skew) so a
 * burst of Gmail calls in one request doesn't re-mint on every hop.  The
 * cache is intentionally in-memory: isolates are ephemeral, so a cold start
 * just re-mints — cheap and avoids any stale-token persistence bug.
 *
 * RS256 signing and PKCS8 key import both run on WebCrypto (`crypto.subtle`),
 * which Workers supports natively — no external JWT library needed (the
 * existing HS256 helper in lib/jwt.ts uses the same API).
 */
import type { Env } from '../../types';
import { decryptSecret } from '../crypto/secretBox';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Read + modify (labels / mark-read) and send.  No delete, no settings.
 *
 * ⚠️ `drive.file` нь Gmail-д хэрэггүй ч ЭНД байгаа шалтгаан (2026-09-07):
 * баримт бичгийг Google Docs/Sheets дээр засах боломж нь Drive-ын токен
 * шаарддаг бөгөөд энэ OAuth холболт нь продакшнд БАЙГАА ГАНЦ ажиллаж буй
 * Google эрх юм — `email_accounts`-ийн хоёр мөр ХОЁУЛАА `auth_type='oauth'`,
 * өөрөөр хэлбэл domain-wide delegation хэзээ ч тохируулагдаж байгаагүй.
 * Нэг зөвшөөрлийн урсгал = нэг refresh token = хоёр боломж, тул админ
 * Google Admin console руу ОГТ орох шаардлагагүй.
 *
 * `drive.file`-ийг зориудаар сонгов, бүтэн `drive`-ыг БИШ: энэ нь зөвхөн
 * ЭНЭ АПП-ЫН ҮҮСГЭСЭН файлд хүрдэг тул хэрэглэгчийн бусад бичиг баримт
 * бидэнд харагдахгүй, мөн Google-ийн «restricted scope» шалгуурт ордоггүй.
 *
 * ⚠️ Scope нэмэх нь ХУУЧИН refresh token-д ЭРГЭЖ ХҮЧИНТЭЙ БОЛОХГҮЙ — токен
 * олгогдох мөчдөө scope-оо тогтоодог.  Тиймээс Drive ажиллуулахын тулд тухайн
 * хайрцгийг «Gmail холбох»-оор НЭГ УДАА дахин зөвшөөрөх ёстой; түүнийг
 * хийтэл Drive дуудлага 403 өгөх бөгөөд `driveClient.ts` түүнийг таньж
 * «дахин холбоно уу» гэсэн ойлгомжтой алдаа буцаана. */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
];

const encoder = new TextEncoder();

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64Url(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function strToB64Url(s: string): string {
  return bytesToB64Url(encoder.encode(s));
}

interface ServiceAccountJson {
  client_email: string;
  private_key: string;
}

function parseServiceAccount(env: Env): ServiceAccountJson {
  if (!env.GOOGLE_SA_JSON) {
    throw new Error('GOOGLE_SA_JSON secret is not set — cannot use Workspace mailboxes');
  }
  let parsed: Partial<ServiceAccountJson>;
  try {
    parsed = JSON.parse(env.GOOGLE_SA_JSON) as Partial<ServiceAccountJson>;
  } catch {
    throw new Error('GOOGLE_SA_JSON is not valid JSON');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SA_JSON is missing client_email / private_key');
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

/** Import a PKCS8 PEM private key for RS256 signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Stored JSON keeps literal "\n"; turn them back into real newlines, then
  // strip the PEM armor and whitespace to get the raw base64 DER body.
  const normalized = pem.replace(/\\n/g, '\n');
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = b64ToBytes(body);
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type?: string;
}

/** Mint a service-account access token for `opts.scope`.
 *  `opts.subject` set → domain-wide-delegation impersonation (Gmail mailboxes);
 *  omitted → the SA acts as itself (e.g. a calendar shared with the SA email).
 *  Cached per isolate for the token lifetime (minus 60 s skew). */
export async function mintServiceAccountToken(
  env: Env,
  opts: { scope: string; subject?: string },
): Promise<string> {
  const cacheKey = `sa:${opts.subject ?? '-'}:${opts.scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > nowSec() + 60) return cached.token;

  const sa = parseServiceAccount(env);
  const key = await importPrivateKey(sa.private_key);
  const iat = nowSec();
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim: Record<string, string | number> = {
    iss: sa.client_email,
    scope: opts.scope,
    aud: GOOGLE_TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  if (opts.subject) claim.sub = opts.subject;

  const signingInput = `${strToB64Url(JSON.stringify(header))}.${strToB64Url(
    JSON.stringify(claim),
  )}`;
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    encoder.encode(signingInput),
  );
  const assertion = `${signingInput}.${bytesToB64Url(sig)}`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google SA token failed (scope=${opts.scope}): ${res.status} ${text}`);
  }
  const data = (await res.json()) as TokenResponse;
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: iat + data.expires_in });
  return data.access_token;
}

/** Service-account JWT → impersonated access token for `subjectEmail`. */
async function getWorkspaceAccessToken(env: Env, subjectEmail: string): Promise<string> {
  return mintServiceAccountToken(env, {
    scope: GMAIL_SCOPES.join(' '),
    subject: subjectEmail,
  });
}

/**
 * Хайрцгийн хадгалсан Gmail холболт буцаах аргагүй хүчингүй болсон талбар.
 * Ганц засвар нь админ Gmail-д дахин зөвшөөрөх (`/app/admin/email` → «Gmail
 * холбох») тул алдааны мессеж шууд түүнийг хэлдэг — crypto-гийн түүхий
 * «Decryption failed…» бичгийг хэрэглэгч унших утгагүй.
 *
 * Хоёр шалтгаан: (1) `EMAIL_ENCRYPTION_KEY` солигдсон — 2026-08-24-ны акаунт
 * шилжилтээр шинэ түлхүүр үүсгэсэн болоод D1 дэх хуучин ciphertext задарахаа
 * болсон (хуучин түлхүүрийг Cloudflare-аас буцааж унших БОЛОМЖГҮЙ);
 * (2) Google талдаа refresh token-ыг цуцалсан (`invalid_grant`).
 */
export class MailboxReconnectRequired extends Error {
  constructor(
    readonly address: string,
    readonly detail: string,
  ) {
    super(
      `«${address}» хайрцгийн Gmail холболт хүчингүй болсон байна (${detail}). ` +
        `Админ → Мэйл хайрцаг хуудснаас тус хайрцгийг дахин холбоно уу.`,
    );
    this.name = 'MailboxReconnectRequired';
  }
}

/** Encrypted refresh token → access token for a plain @gmail mailbox. */
async function getOAuthAccessToken(
  env: Env,
  account: TokenAccount,
  refreshTokenEnc: string,
): Promise<string> {
  if (!env.EMAIL_ENCRYPTION_KEY) throw new Error('EMAIL_ENCRYPTION_KEY secret is not set');
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET secrets are not set');
  }
  const cacheKey = `oauth:${refreshTokenEnc.slice(0, 32)}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > nowSec() + 60) return cached.token;

  let refreshToken: string;
  try {
    refreshToken = await decryptSecret(refreshTokenEnc, env.EMAIL_ENCRYPTION_KEY);
  } catch {
    // AES-GCM-ийн tag таарахгүй → энэ мөрийг өөр түлхүүрээр шифрлэсэн байна.
    throw new MailboxReconnectRequired(account.address, 'хадгалсан token задарсангүй');
  }
  const iat = nowSec();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    // Google талдаа цуцалсан / хугацаа нь дууссан refresh token — засвар нь дахин холбох.
    if (text.includes('invalid_grant')) {
      throw new MailboxReconnectRequired(account.address, 'Google refresh token-ыг цуцалсан');
    }
    throw new Error(`Google token (oauth) refresh failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as TokenResponse;
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: iat + data.expires_in });
  return data.access_token;
}

/** Account shape the token minting cares about — a subset of EmailAccountRow. */
export interface TokenAccount {
  address: string;
  auth_type: string;
  refresh_token_enc: string | null;
}

/** The single entry point routes call to get a usable Gmail access token. */
export async function getAccessTokenForAccount(env: Env, account: TokenAccount): Promise<string> {
  if (account.auth_type === 'oauth') {
    if (!account.refresh_token_enc) {
      throw new MailboxReconnectRequired(account.address, 'хадгалсан token байхгүй');
    }
    return getOAuthAccessToken(env, account, account.refresh_token_enc);
  }
  return getWorkspaceAccessToken(env, account.address);
}

/* ------------------------------------------------------------------ */
/*  OAuth consent flow (plain @gmail mailboxes only)                   */
/* ------------------------------------------------------------------ */

/** Build the Google consent URL an admin is redirected to when connecting
 *  a personal @gmail mailbox.  `access_type=offline` + `prompt=consent`
 *  guarantee a refresh token comes back even on re-auth. */
export function buildOAuthConsentUrl(
  env: Env,
  redirectUri: string,
  state: string,
  loginHint?: string,
): string {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) throw new Error('GOOGLE_OAUTH_CLIENT_ID secret is not set');
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Exchange the `code` from the consent redirect for tokens.  We only keep
 *  the refresh token (encrypted) — access tokens are re-minted on demand. */
export async function exchangeOAuthCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET secrets are not set');
  }
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth code exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}
