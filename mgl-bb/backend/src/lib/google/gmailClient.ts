/**
 * Thin wrapper over the Gmail REST API (https://gmail.googleapis.com).
 *
 * Every function takes an already-minted access token (see googleAuth.ts) so
 * this module stays auth-agnostic — it works the same for Workspace
 * impersonation tokens and for plain-@gmail OAuth tokens.
 *
 * Only the slice the integration needs is implemented: profile, list,
 * history (incremental sync), get, attachments, modify (mark-read) and send.
 */

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ------------------------------------------------------------------ */
/*  Low-level fetch                                                     */
/* ------------------------------------------------------------------ */

async function gmailFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/*  base64url helpers (Gmail uses URL-safe base64 for message bodies)  */
/* ------------------------------------------------------------------ */

function b64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeB64UrlToString(b64url: string): string {
  return decoder.decode(b64UrlToBytes(b64url));
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ------------------------------------------------------------------ */
/*  Raw Gmail wire types (the fields we read)                          */
/* ------------------------------------------------------------------ */

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string; // ms epoch as string
  payload?: GmailPart;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHistoryResponse {
  history?: Array<{
    id: string;
    messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
}

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

export function getProfile(token: string): Promise<GmailProfile> {
  return gmailFetch<GmailProfile>(token, '/profile');
}

export async function listMessageIds(
  token: string,
  opts: { q?: string; maxResults?: number; pageToken?: string } = {},
): Promise<{ ids: Array<{ id: string; threadId: string }>; nextPageToken?: string }> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  params.set('maxResults', String(opts.maxResults ?? 50));
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  const data = await gmailFetch<GmailListResponse>(token, `/messages?${params.toString()}`);
  return { ids: data.messages ?? [], nextPageToken: data.nextPageToken };
}

/** Incremental sync: message ids added since `startHistoryId`.  Returns the
 *  latest historyId so the caller can persist it.  De-dupes added ids. */
export async function listAddedMessageIds(
  token: string,
  startHistoryId: string,
): Promise<{ ids: string[]; latestHistoryId: string | null }> {
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId: string | null = null;
  // Bound the loop — a mailbox that has been silent past Gmail's history
  // retention (~1 week) returns 404; the caller falls back to a full list.
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gmailFetch<GmailHistoryResponse>(token, `/history?${params.toString()}`);
    if (data.historyId) latestHistoryId = data.historyId;
    for (const h of data.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        if (added.message?.id) seen.add(added.message.id);
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return { ids: [...seen], latestHistoryId };
}

export function getMessage(token: string, id: string): Promise<GmailMessage> {
  return gmailFetch<GmailMessage>(token, `/messages/${id}?format=full`);
}

/** Raw RFC822 source of a message (headers + body) — powers "show source".
 *  Gmail returns it base64url-encoded; we decode to plain text. */
export async function getRawMessage(token: string, id: string): Promise<string> {
  const data = await gmailFetch<{ raw?: string }>(token, `/messages/${id}?format=raw`);
  return data.raw ? decoder.decode(b64UrlToBytes(data.raw)) : '';
}

export async function getAttachmentBytes(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const data = await gmailFetch<{ size: number; data: string }>(
    token,
    `/messages/${messageId}/attachments/${attachmentId}`,
  );
  return b64UrlToBytes(data.data);
}

/* ------------------------------------------------------------------ */
/*  Writes                                                             */
/* ------------------------------------------------------------------ */

/** Remove the UNREAD label so the mailbox owner sees we processed it. */
export function markRead(token: string, id: string): Promise<unknown> {
  return gmailFetch(token, `/messages/${id}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface SendArgs {
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  /** Provide one of html / text.  html wins when both are present. */
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  attachments?: OutgoingAttachment[];
}

/** RFC 2047 encode a header value if it contains non-ASCII (e.g. Mongolian).
 *  Splits into multiple base64 encoded-words so no encoded-word exceeds the
 *  75-char limit (RFC 2047 §2): "=?UTF-8?B?" + "?=" is 12 chars of overhead,
 *  and base64 of 45 source bytes is 60 chars → 72 total ≤ 75.  Chunks are cut
 *  on whole code points (never splitting a multi-byte UTF-8 char) and joined
 *  with CRLF + a single space (folding whitespace). */
/** Defense-in-depth: collapse any CR/LF so a header value can't inject extra
 *  header lines (the /send route already rejects these, but builders strip too). */
function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return stripCrlf(value);
  const MAX_BYTES_PER_WORD = 45;
  const words: string[] = [];
  let chunk: number[] = [];
  const flush = () => {
    if (chunk.length) {
      words.push(`=?UTF-8?B?${btoa(String.fromCharCode(...chunk))}?=`);
      chunk = [];
    }
  };
  // Iterating a string yields whole code points, so a multi-byte char's UTF-8
  // bytes (≤4) are always added together and never split across words.
  for (const ch of value) {
    const chBytes = encoder.encode(ch);
    if (chunk.length + chBytes.length > MAX_BYTES_PER_WORD) flush();
    for (const b of chBytes) chunk.push(b);
  }
  flush();
  return words.join('\r\n ');
}

/** btoa needs a binary string; turn a UTF-8 JS string into one. */
function unescapeUtf8(s: string): string {
  const bytes = encoder.encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return bin;
}

function base64Body(s: string): string {
  // Standard (padded) base64 of the UTF-8 body, wrapped at 76 chars per MIME.
  const b64 = btoa(unescapeUtf8(s));
  return b64.replace(/(.{76})/g, '$1\r\n');
}

/** Standard base64 of raw bytes (attachments), wrapped at 76 chars per MIME. */
function base64Bytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/(.{76})/g, '$1\r\n');
}

/** Content-Type + Content-Disposition lines for an attachment.  ASCII names
 *  use a simple quoted-string; non-ASCII (e.g. Mongolian) use RFC 2231
 *  `filename*=UTF-8''…` which is how Gmail itself encodes them — encoded-words
 *  are NOT valid inside a quoted filename. */
function attachmentHeaders(filename: string, mimeType: string): string {
  const mime = mimeType || 'application/octet-stream';
  // eslint-disable-next-line no-control-regex
  const asciiSafe = /^[\x20-\x7e]*$/.test(filename) && !/["\\\r\n]/.test(filename);
  if (asciiSafe) {
    return (
      `Content-Type: ${mime}; name="${filename}"\r\n` +
      `Content-Disposition: attachment; filename="${filename}"`
    );
  }
  const pct = Array.from(encoder.encode(filename))
    .map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
  return `Content-Type: ${mime}\r\n` + `Content-Disposition: attachment; filename*=UTF-8''${pct}`;
}

/** Build the base64url-encoded RFC822 message Gmail's send endpoint wants.
 *  With attachments it produces a multipart/mixed message (body part + one
 *  part per attachment). */
export function buildRawMessage(args: SendArgs): string {
  const isHtml = !!args.html;
  const bodyType = isHtml ? 'text/html; charset="UTF-8"' : 'text/plain; charset="UTF-8"';
  const bodyContent = isHtml ? args.html! : (args.text ?? '');
  const atts = args.attachments ?? [];

  const top: string[] = [];
  if (args.from) top.push(`From: ${stripCrlf(args.from)}`);
  top.push(`To: ${stripCrlf(args.to)}`);
  if (args.cc) top.push(`Cc: ${stripCrlf(args.cc)}`);
  // Bcc header in the raw message: Gmail's send API honours it for delivery
  // and strips it from the message recipients actually see.
  if (args.bcc) top.push(`Bcc: ${stripCrlf(args.bcc)}`);
  top.push(`Subject: ${encodeHeaderValue(args.subject)}`);
  if (args.inReplyTo) top.push(`In-Reply-To: ${args.inReplyTo}`);
  if (args.references) top.push(`References: ${args.references}`);
  top.push('MIME-Version: 1.0');

  let mime: string;
  if (atts.length === 0) {
    top.push(`Content-Type: ${bodyType}`);
    top.push('Content-Transfer-Encoding: base64');
    mime = `${top.join('\r\n')}\r\n\r\n${base64Body(bodyContent)}`;
  } else {
    const boundary = `mgl_${crypto.randomUUID().replace(/-/g, '')}`;
    top.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts: string[] = [
      `--${boundary}\r\n` +
        `Content-Type: ${bodyType}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        base64Body(bodyContent),
    ];
    for (const a of atts) {
      parts.push(
        `--${boundary}\r\n` +
          `${attachmentHeaders(a.filename, a.mimeType)}\r\n` +
          `Content-Transfer-Encoding: base64\r\n\r\n` +
          base64Bytes(a.bytes),
      );
    }
    mime = `${top.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--`;
  }
  return bytesToB64Url(encoder.encode(mime));
}

export async function sendMessage(
  token: string,
  args: SendArgs,
): Promise<{ id: string; threadId: string }> {
  const raw = buildRawMessage(args);
  return gmailFetch<{ id: string; threadId: string }>(token, '/messages/send', {
    method: 'POST',
    body: JSON.stringify(args.threadId ? { raw, threadId: args.threadId } : { raw }),
  });
}

/* ------------------------------------------------------------------ */
/*  Parsing a fetched message into a normalized shape                  */
/* ------------------------------------------------------------------ */

export interface ParsedAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface ParsedMessage {
  gmailMessageId: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  /** Absolute instant the message hit the mailbox, ISO UTC. */
  internalDateIso: string;
  /** ms epoch (number) — handy for UB-tz date derivation by the caller. */
  internalDateMs: number;
  from: string | null;
  to: string | null;
  cc: string | null;
  subject: string | null;
  rfcMessageId: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: ParsedAttachment[];
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  const h = headers.find((x) => x.name.toLowerCase() === lower);
  return h ? h.value : null;
}

/** Depth-first walk collecting the best html/text body and any attachments. */
function walkParts(
  part: GmailPart | undefined,
  acc: { html: string | null; text: string | null; attachments: ParsedAttachment[] },
): void {
  if (!part) return;
  const mime = part.mimeType ?? '';

  // A named part with an attachmentId is a real attachment (inline images
  // also carry attachmentId but usually no filename — we skip those).
  if (part.filename && part.body?.attachmentId) {
    acc.attachments.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: mime || 'application/octet-stream',
      size: part.body.size ?? 0,
    });
  }

  if (mime === 'text/html' && part.body?.data && acc.html === null) {
    acc.html = decodeB64UrlToString(part.body.data);
  } else if (mime === 'text/plain' && part.body?.data && acc.text === null) {
    acc.text = decodeB64UrlToString(part.body.data);
  }

  for (const child of part.parts ?? []) walkParts(child, acc);
}

export function parseGmailMessage(msg: GmailMessage): ParsedMessage {
  const headers = msg.payload?.headers;
  const acc = {
    html: null as string | null,
    text: null as string | null,
    attachments: [] as ParsedAttachment[],
  };
  walkParts(msg.payload, acc);

  const ms = msg.internalDate ? Number(msg.internalDate) : 0;
  const internalDateIso = ms > 0 ? new Date(ms).toISOString() : new Date(0).toISOString();

  return {
    gmailMessageId: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds ?? [],
    snippet: msg.snippet ?? '',
    internalDateIso,
    internalDateMs: ms,
    from: headerValue(headers, 'From'),
    to: headerValue(headers, 'To'),
    cc: headerValue(headers, 'Cc'),
    subject: headerValue(headers, 'Subject'),
    rfcMessageId: headerValue(headers, 'Message-ID'),
    bodyHtml: acc.html,
    bodyText: acc.text,
    attachments: acc.attachments,
  };
}
