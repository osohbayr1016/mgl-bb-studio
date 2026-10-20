/**
 * Нийтийн мэдээлэл (`announcements`, миграц 0338) — цэвэр туслахууд.
 *
 * `routes/announcements.ts` энэ файлын функцуудыг л хэрэглэнэ; энд D1, R2,
 * Hono огт байхгүй тул `node --test` дээр шууд шалгагдана.
 *
 * ЗАГВАР:
 *   announcements       — гарчиг + СЕРВЕР дээр цэвэрлэсэн HTML бие + хүрээ +
 *                         баталгааны горим (none | confirm | signature)
 *   announcement_acks   — (announcement × ack_version × user) НЭГ баталгаа.
 *                         Админ «дахин баталгаажуул» гэж нийтлэхэд
 *                         `ack_version` +1 → бүгд дахин баталгаажуулна;
 *                         хуучин мөр түүх болж үлдэнэ.
 *
 * Эзний шийдвэрүүд (2026-09-21): зохиогч = зөвхөн admin · хүрээ = ажилтнууд
 * (мэдээлэл бүрд role × баг сонгоно; worker/client орохгүй) · гарын үсэг =
 * профайлын гарын үсэг нэг товчоор (Дотоод журамтай ижил) · статистик =
 * зөвхөн admin.
 */
import type { UserRole } from '../types';

export const ANNOUNCEMENT_TITLE_MAX = 200;
/** Зураг нь URL-ээр орох тул бие голдуу текст; 500k тэмдэгт хангалттай. */
export const ANNOUNCEMENT_BODY_MAX = 500_000;

export const ANNOUNCEMENT_KINDS = ['system_update', 'company_info', 'announcement'] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

export const ACK_MODES = ['none', 'confirm', 'signature'] as const;
export type AckMode = (typeof ACK_MODES)[number];

export const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

/**
 * Мэдээлэл УНШИЖ, баталгаажуулж болох ажилтны role-ууд — хүрээний
 * популяцийн дээд хязгаар.  `worker` ОРООГҮЙ (`lib/workerScope.ts` энэ
 * угтварыг түүнд нээдэггүй), `client` — гадны хүн (`lib/clientScope.ts`).
 * Frontend тольд: `shared/lib/roles.ts` `ANNOUNCEMENT_ROLES`.
 */
export const ANNOUNCEMENT_ROLES: readonly UserRole[] = ['admin', 'senior', 'engineer', 'architect'];

export function canReadAnnouncements(role: string | null | undefined): boolean {
  return (ANNOUNCEMENT_ROLES as readonly string[]).includes(role ?? '');
}

/** SQL `IN (...)` литерал — role-ууд тогтмол жагсаалтаас тул bind шаардлагагүй. */
export const ANNOUNCEMENT_ROLES_SQL = ANNOUNCEMENT_ROLES.map((r) => `'${r}'`).join(',');

/* ------------------------------------------------------------------ */
/*  Хүрээ (audience)                                                   */
/* ------------------------------------------------------------------ */

/** `audience_json`-ийн задалсан хэлбэр.  Хоёулаа хоосон = бүх ажилтан. */
export interface Audience {
  roles: UserRole[];
  team_ids: number[];
}

export const EVERYONE: Audience = { roles: [], team_ids: [] };

/**
 * `audience_json` → Audience.  Гажсан JSON, танихгүй role, бүхэл бус id
 * чимээгүй хаягдана — DB-д буруу утга байсан ч хуудас унахгүй.
 */
export function parseAudience(raw: string | null | undefined): Audience {
  if (!raw) return EVERYONE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EVERYONE;
  }
  return normalizeAudience(parsed);
}

/** Дурын оролт (хүсэлтийн бие / JSON) → цэвэр Audience. */
export function normalizeAudience(input: unknown): Audience {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return EVERYONE;
  const o = input as Record<string, unknown>;
  const roles = Array.isArray(o.roles)
    ? [...new Set(o.roles.filter((r): r is UserRole => typeof r === 'string' && canReadAnnouncements(r)))]
    : [];
  const teamIds = Array.isArray(o.team_ids)
    ? [...new Set(o.team_ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  return { roles, team_ids: teamIds };
}

/** Хадгалах хэлбэр — бүх ажилтан бол NULL (энгийн мөр тодорхой харагдана). */
export function serializeAudience(a: Audience): string | null {
  if (a.roles.length === 0 && a.team_ids.length === 0) return null;
  return JSON.stringify({ roles: a.roles, team_ids: a.team_ids });
}

export function isEveryone(a: Audience): boolean {
  return a.roles.length === 0 && a.team_ids.length === 0;
}

/**
 * Хэрэглэгч хүрээнд багтах уу — roster SQL (`audienceWhereSql`) болон
 * ажилтны харагдацын ГАНЦ предикат.  Хоёр шүүлт хоёулаа өгөгдсөн бол
 * ХОЁУЛАА биелэх ёстой («BA багийн senior»).  Багийн шүүлттэй мэдээлэлд
 * баггүй хэрэглэгч (team_id NULL) орохгүй.
 */
export function audienceMatches(
  a: Audience,
  user: { role: string | null | undefined; team_id: number | null | undefined },
): boolean {
  if (!canReadAnnouncements(user.role)) return false;
  if (a.roles.length > 0 && !a.roles.includes(user.role as UserRole)) return false;
  if (a.team_ids.length > 0 && (user.team_id == null || !a.team_ids.includes(user.team_id))) return false;
  return true;
}

/**
 * Roster-ийн WHERE хэсэг (`u.` alias) + bind утгууд.  Role-ууд тогтмол
 * жагсаалтаас (`normalizeAudience` шүүсэн) тул литералаар; багийн id-ууд bind.
 */
export function audienceWhereSql(a: Audience): { sql: string; binds: number[] } {
  const parts = [`u.status = 'active'`, `u.is_support = 0`];
  const roles = a.roles.length > 0 ? a.roles : ANNOUNCEMENT_ROLES;
  parts.push(`u.role IN (${roles.map((r) => `'${r}'`).join(',')})`);
  const binds: number[] = [];
  if (a.team_ids.length > 0) {
    parts.push(`u.team_id IN (${a.team_ids.map(() => '?').join(',')})`);
    binds.push(...a.team_ids);
  }
  return { sql: parts.join(' AND '), binds };
}

/* ------------------------------------------------------------------ */
/*  Агуулгын хэш                                                       */
/* ------------------------------------------------------------------ */

async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Дурын байтын SHA-256 (гарын үсгийн PNG-д). */
export const sha256HexOf = sha256Hex;

/**
 * Нийтлэгдсэн агуулгын хэш — гарчиг + цэвэрлэсэн бие.  Баталгааны мөр энэ
 * хэшийг хуулж авдаг тул «ЯГ ямар бичвэрийг харж баталгаажуулсан» нь
 * нотлогдоно; клиент `content_hash`-аа буцааж илгээж, сервер одоогийнхтой
 * тулгана (хооронд нь засагдсан бол 409).
 */
export async function contentHashOf(title: string, bodyHtml: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(`${title.trim()}\n\n${bodyHtml}`));
}

/* ------------------------------------------------------------------ */
/*  HTML цэвэрлэгч                                                     */
/* ------------------------------------------------------------------ */

/**
 * Цагаан жагсаалттай HTML цэвэрлэгч.  Оролт нь админы `contentEditable`
 * засварлагчийн `innerHTML` (execCommand + `styleWithCSS`) — тиймээс
 * `<span style="…">`, `<b>`, `<font>`, жагсаалт, `<img>`, `<a>`, хүснэгт л
 * хэрэгтэй.  Бүх бусад таг (script/style/iframe/svg/…) устгагдана,
 * `on*` атрибут, `javascript:` URL, `url(…)`-тэй style хэзээ ч гарахгүй.
 *
 * Зохиогч нь зөвхөн admin боловч хадгалсан HTML нь ажилтан бүрийн хөтөч
 * дээр `dangerouslySetInnerHTML`-ээр рендерлэгддэг тул серверийн цэвэрлэгээ
 * заавал — буулгасан (paste) агуулгад юу ч байж болно.
 *
 * Бүтэн parser биш: таг балансыг хөтөч (`innerHTML`) өөрөө засна.  Гэхдээ
 * агуулга хаях таг (`DROP_WITH_CONTENT`) дотор нь юу ч үлдээхгүй.
 */

type AttrRule = (name: string, value: string) => string | null;

const STYLE_PROPS = new Set([
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'font-size',
  'font-family',
  'text-decoration',
  'text-decoration-line',
  'text-align',
  // Word-оос буулгасан/оруулсан журмын догол мөрийн хэлбэр (2026-09-25).
  'text-indent',
  'line-height',
  'vertical-align',
  'margin-left',
  'padding-left',
  'width',
  'max-width',
  'height',
]);

function cleanStyle(value: string): string | null {
  const out: string[] = [];
  for (const decl of value.split(';')) {
    const i = decl.indexOf(':');
    if (i <= 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop)) continue;
    if (!val || /url\s*\(|expression|javascript|\\|@import|behavior/i.test(val)) continue;
    if (!/^[#\w\s,.%()'"-]+$/.test(val)) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.length ? out.join('; ') : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Атрибутын утгын entity-г задлана — `javascript&#58;` хэлбэрийн нуулт хаагдана. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    const b = body.toLowerCase();
    if (b.startsWith('#x')) {
      const cp = parseInt(b.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    if (b.startsWith('#')) {
      const cp = parseInt(b.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[b] ?? m;
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Хяналтын тэмдэгт/зай хасаад схемийг шалгана. */
function safeHref(raw: string): string | null {
  const v = decodeEntities(raw).replace(/[\u0000-\u001f\u007f\s]/g, '');
  if (!v) return null;
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (v.startsWith('#')) return v;
  return null;
}

/** Зургийн эх: өөрийн `/media/<нэг сегмент>` эсвэл https. */
export function safeImageSrc(raw: string): string | null {
  const v = decodeEntities(raw).replace(/[\u0000-\u001f\u007f\s]/g, '');
  if (!v) return null;
  if (/^https:\/\/[^/]+\/media\/[^/?#]+$/i.test(v)) return v;
  if (/^\/media\/[^/?#]+$/.test(v)) return v;
  if (/^https:\/\//i.test(v)) return v;
  return null;
}

const styleAttr: AttrRule = (name, value) => (name === 'style' ? cleanStyle(value) : null);
const intAttr = (allowed: Set<string>): AttrRule => (name, value) =>
  allowed.has(name) && /^\d{1,4}$/.test(value.trim()) ? value.trim() : null;

const ALLOWED: Record<string, AttrRule[]> = {
  p: [styleAttr],
  div: [styleAttr],
  span: [styleAttr],
  br: [],
  hr: [],
  b: [],
  strong: [],
  i: [],
  em: [],
  u: [],
  s: [],
  strike: [],
  sub: [],
  sup: [],
  h1: [styleAttr],
  h2: [styleAttr],
  h3: [styleAttr],
  h4: [styleAttr],
  blockquote: [styleAttr],
  pre: [],
  code: [],
  ul: [styleAttr],
  ol: [styleAttr, intAttr(new Set(['start']))],
  li: [styleAttr],
  table: [styleAttr],
  thead: [],
  tbody: [],
  tr: [],
  td: [styleAttr, intAttr(new Set(['colspan', 'rowspan']))],
  th: [styleAttr, intAttr(new Set(['colspan', 'rowspan']))],
  font: [
    (name, value) => {
      if (name === 'color' && /^#?[\w]+$/.test(value.trim())) return value.trim();
      if (name === 'face' && /^[\w\s,'"-]+$/.test(value)) return value.trim();
      if (name === 'size' && /^[1-7]$/.test(value.trim())) return value.trim();
      return null;
    },
    styleAttr,
  ],
  a: [(name, value) => (name === 'href' ? safeHref(value) : null), (name, value) => (name === 'title' ? value : null)],
  img: [
    (name, value) => (name === 'src' ? safeImageSrc(value) : null),
    (name, value) => (name === 'alt' || name === 'title' ? value : null),
    intAttr(new Set(['width', 'height'])),
    styleAttr,
  ],
};

const VOID = new Set(['br', 'hr', 'img']);
/** Дотоод агуулгыг нь ч хаях таг. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'svg', 'math', 'template', 'head', 'title', 'textarea', 'select', 'button', 'form']);

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function cleanTag(name: string, rawAttrs: string): string {
  const rules = ALLOWED[name] ?? [];
  const kept: string[] = [];
  const seen = new Set<string>();
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(rawAttrs)) !== null) {
    const attr = (m[1] ?? '').toLowerCase();
    if (!attr || seen.has(attr) || attr.startsWith('on')) continue;
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    for (const rule of rules) {
      const v = rule(attr, value);
      if (v !== null) {
        seen.add(attr);
        kept.push(`${attr}="${escapeAttr(v)}"`);
        break;
      }
    }
  }
  if (name === 'a') {
    if (!seen.has('href')) return '<a>';
    kept.push('target="_blank"', 'rel="noopener noreferrer"');
  }
  if (name === 'img' && !seen.has('src')) return '';
  return `<${name}${kept.length ? ' ' + kept.join(' ') : ''}>`;
}

const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|[^<]+|</g;

/**
 * HTML-ийг цагаан жагсаалтаар цэвэрлэнэ.  Үр дүн нь детерминист бөгөөд
 * цэвэр оролт дээр idempotent (`sanitizeHtml(sanitizeHtml(x)) === sanitizeHtml(x)`).
 */
export function sanitizeHtml(input: string): string {
  const out: string[] = [];
  let dropUntil: string | null = null;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(input)) !== null) {
    const tok = m[0];
    const name = m[1]?.toLowerCase();
    if (dropUntil) {
      if (name === dropUntil && tok.startsWith('</')) dropUntil = null;
      continue;
    }
    if (tok.startsWith('<!--') || tok.startsWith('<![CDATA[')) continue;
    if (name) {
      const closing = tok.startsWith('</');
      if (DROP_WITH_CONTENT.has(name)) {
        if (!closing && !tok.endsWith('/>')) dropUntil = name;
        continue;
      }
      if (!(name in ALLOWED)) continue; // танихгүй таг — зөвхөн тагийг хаяна, дотоод текст үлдэнэ
      if (closing) {
        if (!VOID.has(name)) out.push(`</${name}>`);
        continue;
      }
      out.push(cleanTag(name, m[2] ?? ''));
      continue;
    }
    if (tok === '<') {
      out.push('&lt;');
      continue;
    }
    out.push(tok);
  }
  return out.join('');
}

/** Хайлт/урьдчилсан харагдацад: HTML → цэвэр текст (entity задалсан, зай нэгтгэсэн). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|hr)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function excerptOf(html: string, max = 200): string {
  const text = htmlToText(html);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/* ------------------------------------------------------------------ */
/*  Оролт цэвэрлэх                                                     */
/* ------------------------------------------------------------------ */

export interface AnnouncementInput {
  title: string;
  body_html: string;
  kind: AnnouncementKind;
  ack_mode: AckMode;
  audience: Audience;
  pinned: boolean;
}

export interface AnnouncementInputBody {
  title?: unknown;
  body_html?: unknown;
  kind?: unknown;
  ack_mode?: unknown;
  audience?: unknown;
  pinned?: unknown;
}

const DEFAULT_INPUT: AnnouncementInput = {
  title: '',
  body_html: '',
  kind: 'announcement',
  ack_mode: 'none',
  audience: EVERYONE,
  pinned: false,
};

/**
 * Админы create/update биеийг шалгана.  PUT үед байхгүй талбар `existing`-ээс
 * өвлөгдөнө (`internalRules.ts`-ийн `sanitizeRuleInput`-тэй ижил хэлбэр).
 * `body_html` энд ЦЭВЭРЛЭГДЭНЭ — DB-д зөвхөн цэвэр HTML орно.
 */
export function sanitizeAnnouncementInput(
  body: AnnouncementInputBody,
  existing: AnnouncementInput | null,
): { input: AnnouncementInput } | { error: string } {
  const base = existing ?? DEFAULT_INPUT;

  let title = base.title;
  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return { error: 'title нь тэмдэгт мөр байх ёстой' };
    title = body.title.trim().slice(0, ANNOUNCEMENT_TITLE_MAX);
  }
  if (!title) return { error: 'Гарчиг (title) шаардлагатай' };

  let bodyHtml = base.body_html;
  if (body.body_html !== undefined) {
    if (typeof body.body_html !== 'string') return { error: 'body_html нь тэмдэгт мөр байх ёстой' };
    if (body.body_html.length > ANNOUNCEMENT_BODY_MAX) {
      return { error: `Агуулга хэт урт байна (дээд тал нь ${ANNOUNCEMENT_BODY_MAX} тэмдэгт)` };
    }
    bodyHtml = sanitizeHtml(body.body_html.replace(/\r\n?/g, '\n'));
  }

  let kind = base.kind;
  if (body.kind !== undefined) {
    if (typeof body.kind !== 'string' || !(ANNOUNCEMENT_KINDS as readonly string[]).includes(body.kind)) {
      return { error: 'kind буруу' };
    }
    kind = body.kind as AnnouncementKind;
  }

  let ackMode = base.ack_mode;
  if (body.ack_mode !== undefined) {
    if (typeof body.ack_mode !== 'string' || !(ACK_MODES as readonly string[]).includes(body.ack_mode)) {
      return { error: 'ack_mode буруу' };
    }
    ackMode = body.ack_mode as AckMode;
  }

  let audience = base.audience;
  if (body.audience !== undefined) {
    if (body.audience === null) audience = EVERYONE;
    else if (typeof body.audience === 'object' && !Array.isArray(body.audience)) audience = normalizeAudience(body.audience);
    else return { error: 'audience буруу' };
  }

  let pinned = base.pinned;
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') return { error: 'pinned нь boolean байх ёстой' };
    pinned = body.pinned;
  }

  return { input: { title, body_html: bodyHtml, kind, ack_mode: ackMode, audience, pinned } };
}

/**
 * Ажилтны баталгааны хүсэлт.  `confirmed === true` нь UI-н «уншиж танилцлаа»
 * нүд; `ack_version` + `content_hash` нь «ЯГ энэ агуулгыг харсан» гэсэн
 * нотолгоо — сервер одоогийнхтой тулгана.
 */
export function parseAckBody(body: unknown): { ackVersion: number; contentHash: string } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Хүсэлтийн бие буруу' };
  const b = body as Record<string, unknown>;
  if (b.confirmed !== true) return { error: 'Уншиж танилцсанаа баталгаажуулна уу (confirmed)' };
  const ackVersion = typeof b.ack_version === 'number' ? b.ack_version : Number(b.ack_version);
  if (!Number.isInteger(ackVersion) || ackVersion <= 0) return { error: 'ack_version буруу' };
  const contentHash = typeof b.content_hash === 'string' ? b.content_hash.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(contentHash)) return { error: 'content_hash буруу' };
  return { ackVersion, contentHash };
}

/* ------------------------------------------------------------------ */
/*  Гарын үсгийн R2 түлхүүр (Дотоод журамтай ижил зарчим)              */
/* ------------------------------------------------------------------ */

/**
 * Хувийн bucket (`MEETING_BUCKET`) дахь гарын үсгийн хуулбарын түлхүүр.
 * Профайлын `users.signature_url` нь нийтийн `/media/` объект бөгөөд ажилтан
 * гарын үсгээ СОЛИХОД `lib/mediaReplace.ts` хуучин объектыг устгадаг —
 * тиймээс баталгаажуулах МӨЧИД байтыг өөрийн угтвар руу хуулна.
 */
export function signatureObjectKey(
  announcementId: number,
  ackVersion: number,
  userId: number,
  ext: 'png' | 'jpg' | 'webp',
  now = Date.now(),
  rand = crypto.randomUUID().slice(0, 8),
): string {
  return `announcement-signatures/${announcementId}/${ackVersion}-${userId}-${now}-${rand}.${ext}`;
}

export function signatureContentTypeOf(ext: 'png' | 'jpg' | 'webp'): string {
  return ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp';
}

/** Байтын толгойгоор зураг мөн эсэхийг батална — R2-ийн contentType-д дангаар итгэхгүй. */
export function sniffImageExt(bytes: ArrayBuffer): 'png' | 'jpg' | 'webp' | null {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return 'webp';
  return null;
}
