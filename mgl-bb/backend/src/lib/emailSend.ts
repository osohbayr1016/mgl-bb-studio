/**
 * Shared Gmail outbound send — used by admin triage (`POST /email/send`)
 * and project correspondence (`POST /correspondence/projects/:id/send`).
 */
import { getAccessTokenForAccount, MailboxReconnectRequired } from './google/googleAuth';
import { sendMessage, type OutgoingAttachment } from './google/gmailClient';
import type { EmailAccountRow, Env } from '../types';

export const ATT_MAX_COUNT = 10;
export const ATT_MAX_TOTAL = 20 * 1024 * 1024;

export interface SendAttachmentInput {
  r2_key: string;
  filename?: string;
  mime_type?: string;
}

export interface EmailSendInput {
  account: EmailAccountRow;
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body_html?: string;
  body_text?: string;
  thread_id?: string;
  in_reply_to?: string;
  references?: string;
  attachments?: SendAttachmentInput[];
}

export interface EmailSendResult {
  fromAddr: string;
  gmailMessageId: string;
  threadId: string;
  snippet: string;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/** Reject CR/LF in RFC822 header fields. */
export function assertSafeEmailHeaders(fields: (string | undefined)[]): void {
  if (fields.some((v) => typeof v === 'string' && /[\r\n]/.test(v))) {
    throw new EmailSendError('Толгойн талбарт хүчингүй тэмдэгт байна');
  }
}

/** Resolve From: mailbox address or same-domain alias. */
export function resolveFromAddress(account: EmailAccountRow, from?: string): string {
  const accountDomain = account.address.includes('@')
    ? account.address.split('@')[1]!.toLowerCase()
    : '';
  if (!from?.trim()) return account.address;
  const f = from.trim();
  const fl = f.toLowerCase();
  if (fl === account.address.toLowerCase() || (accountDomain && fl.endsWith(`@${accountDomain}`))) {
    return f;
  }
  throw new EmailSendError('From хаяг нь холбосон хайрцгийн домейнд байх ёстой');
}

/** Load attachment bytes from R2 (uploaded via /api/upload). */
export async function loadOutgoingAttachments(
  bucket: R2Bucket,
  attachments: SendAttachmentInput[] | undefined,
): Promise<OutgoingAttachment[]> {
  if (!attachments?.length) return [];
  if (attachments.length > ATT_MAX_COUNT) {
    throw new EmailSendError(`Хавсралт хэт олон (дээд тал нь ${ATT_MAX_COUNT})`);
  }
  const out: OutgoingAttachment[] = [];
  let total = 0;
  for (const a of attachments) {
    if (!a?.r2_key) continue;
    if (!/^\d+-\d+-/.test(a.r2_key)) {
      throw new EmailSendError(`Хавсралтын түлхүүр буруу: ${a.filename ?? a.r2_key}`);
    }
    const obj = await bucket.get(a.r2_key);
    if (!obj) throw new EmailSendError(`Хавсралт олдсонгүй: ${a.filename ?? a.r2_key}`, 404);
    if (obj.size > ATT_MAX_TOTAL || total + obj.size > ATT_MAX_TOTAL) {
      throw new EmailSendError('Хавсралтын нийт хэмжээ 20MB-аас хэтэрсэн');
    }
    total += obj.size;
    out.push({
      filename: a.filename || 'file',
      mimeType: a.mime_type || obj.httpMetadata?.contentType || 'application/octet-stream',
      bytes: new Uint8Array(await obj.arrayBuffer()),
    });
  }
  return out;
}

function buildSnippet(bodyText?: string, bodyHtml?: string): string {
  return (bodyText ?? bodyHtml ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Send via Gmail API. Throws EmailSendError on validation / transport failure. */
export async function sendViaGmail(env: Env, input: EmailSendInput): Promise<EmailSendResult> {
  const to = input.to.trim();
  if (!to) throw new EmailSendError('Хүлээн авагч (to) шаардлагатай');
  const subject = input.subject.trim();
  if (!subject) throw new EmailSendError('Гарчиг шаардлагатай');
  if (!input.body_html && !input.body_text) throw new EmailSendError('Агуулга хоосон байна');

  assertSafeEmailHeaders([
    input.from,
    input.to,
    input.cc,
    input.bcc,
    input.subject,
  ]);

  const fromAddr = resolveFromAddress(input.account, input.from);
  const outAtts = await loadOutgoingAttachments(env.MEDIA_BUCKET, input.attachments);

  let sent: { id: string; threadId: string };
  try {
    const token = await getAccessTokenForAccount(env, input.account);
    sent = await sendMessage(token, {
      from: fromAddr,
      to,
      cc: input.cc?.trim() || undefined,
      bcc: input.bcc?.trim() || undefined,
      subject,
      html: input.body_html?.trim() || undefined,
      text: input.body_text?.trim() || undefined,
      threadId: input.thread_id?.trim() || undefined,
      inReplyTo: input.in_reply_to?.trim() || undefined,
      references: input.references?.trim() || undefined,
      attachments: outAtts.length ? outAtts : undefined,
    });
  } catch (e) {
    // Хайрцаг тасарсан бол 502 (сервер унасан) биш — асуудал тохиргоонд байгаа
    // учраас 409-оор ялгаж, хэрэглэгчид «дахин холбо» гэсэн зааварыг шууд өгнө.
    if (e instanceof MailboxReconnectRequired) throw new EmailSendError(e.message, 409);
    throw new EmailSendError(e instanceof Error ? e.message : 'Илгээж чадсангүй', 502);
  }

  return {
    fromAddr,
    gmailMessageId: sent.id,
    threadId: sent.threadId,
    snippet: buildSnippet(input.body_text, input.body_html),
  };
}
