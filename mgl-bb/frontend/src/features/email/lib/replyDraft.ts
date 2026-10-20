/**
 * Build a compose prefill (ComposeDraft) for Reply / Reply all / Forward from
 * an original message — recipients, Re:/Fwd: subject, and a quoted body.
 */
import type { ComposeDraft, EmailMessageDetail } from '../types/email';

export type ReplyMode = 'reply' | 'replyAll' | 'forward';

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );
}

/** Split a raw header value into individual address entries. */
function splitAddrs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Drop entries that contain any of `exclude` (case-insensitive substring). */
function without(entries: string[], exclude: string[]): string[] {
  const ex = exclude.filter(Boolean).map((e) => e.toLowerCase());
  const seen = new Set<string>();
  return entries.filter((e) => {
    const low = e.toLowerCase();
    if (ex.some((x) => low.includes(x))) return false;
    if (seen.has(low)) return false;
    seen.add(low);
    return true;
  });
}

function prefixSubject(subject: string | null, prefix: 'Re:' | 'Fwd:'): string {
  const s = (subject ?? '').trim();
  const re = prefix === 'Re:' ? /^re:/i : /^(fwd|fw):/i;
  if (re.test(s)) return s;
  return `${prefix} ${s}`.trim();
}

/** Quoted original, as HTML (uses the stored plain-text body). */
function quoteBlock(msg: EmailMessageDetail): string {
  const when = (msg.internal_date ?? '').slice(0, 16).replace('T', ' ');
  const who = msg.from_addr ?? '';
  const body = msg.body_text ? escapeHtml(msg.body_text).replace(/\n/g, '<br>') : '';
  return (
    '<br><br>' +
    // `font-style:normal` — бичих талбарын үндсэн хэлбэр налуу тул үүнгүй бол
    // ЭХ захидлын иш татсан хэсэг ч налуу болж, өөрийнх шиг харагдана.
    '<blockquote style="margin:0 0 0 0.8ex;border-left:2px solid #ccc;padding-left:1ex;font-style:normal">' +
    `<div>${escapeHtml(when)} — ${escapeHtml(who)}:</div>${body}` +
    '</blockquote>'
  );
}

/** Forward header block + quoted original. */
function forwardBlock(msg: EmailMessageDetail): string {
  const rows: string[] = [
    `From: ${escapeHtml(msg.from_addr ?? '')}`,
    `Date: ${escapeHtml((msg.internal_date ?? '').slice(0, 16).replace('T', ' '))}`,
    `Subject: ${escapeHtml(msg.subject ?? '')}`,
    `To: ${escapeHtml(msg.to_addrs ?? '')}`,
  ];
  if (msg.cc_addrs) rows.push(`Cc: ${escapeHtml(msg.cc_addrs)}`);
  const body = msg.body_text ? escapeHtml(msg.body_text).replace(/\n/g, '<br>') : '';
  return (
    '<br><br>' +
    // Дамжуулж буй эх захидал — иш татсантай адил налуу БИШ (replyDraft-ийн
    // blockquote-той ижил шалтгаан).
    '<div style="font-style:normal">' +
    '---------- Forwarded message ----------<br>' +
    rows.join('<br>') +
    '<br><br>' +
    body +
    '</div>'
  );
}

export function buildReplyDraft(
  msg: EmailMessageDetail,
  mode: ReplyMode,
  /** The mailbox address we're acting as — excluded from reply-all recipients. */
  selfAddress: string,
): ComposeDraft {
  const base: ComposeDraft = { account_id: msg.account_id };

  if (mode === 'forward') {
    return {
      ...base,
      to: '',
      subject: prefixSubject(msg.subject, 'Fwd:'),
      bodyHtml: forwardBlock(msg),
      // A forward starts its own conversation — no thread/In-Reply-To refs.
    };
  }

  const to = msg.from_addr ?? '';
  const cc =
    mode === 'replyAll'
      ? without([...splitAddrs(msg.to_addrs), ...splitAddrs(msg.cc_addrs)], [
          selfAddress,
          msg.from_addr ?? '',
        ]).join(', ')
      : '';

  return {
    ...base,
    to,
    cc,
    subject: prefixSubject(msg.subject, 'Re:'),
    bodyHtml: quoteBlock(msg),
    thread_id: msg.thread_id ?? undefined,
    in_reply_to: msg.rfc_message_id ?? undefined,
    references: msg.rfc_message_id ?? undefined,
  };
}
