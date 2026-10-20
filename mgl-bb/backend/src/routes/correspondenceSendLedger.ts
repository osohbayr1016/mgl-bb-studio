import type { Context } from 'hono';
import type { EmailSendResult } from '../lib/emailSend';
import type { CorrespondenceCtx } from './correspondenceSendLib';

export type SendLedgerRow = {
  viewerSub: number;
  projectId: number;
  accountId: number;
  sentResult: EmailSendResult;
  to: string;
  cc: string | null;
  subject: string;
  bodyText: string | null;
  logDate: string;
  docType: string;
  refNo: string | null;
  signatureUrl: string | null;
};

export async function writeSendLedger(
  c: Context<CorrespondenceCtx>,
  row: SendLedgerRow,
): Promise<{ correspondence_id: number | null; message_id: number | null }> {
  const nowIso = new Date().toISOString();
  const msgIns = await c.env.DB.prepare(
    `INSERT INTO email_messages
       (account_id, gmail_message_id, thread_id, direction, from_addr, to_addrs,
        cc_addrs, subject, snippet, body_text, internal_date, is_read, triaged)
     VALUES (?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, 1, 1)
     ON CONFLICT(account_id, gmail_message_id) DO NOTHING
     RETURNING id`,
  )
    .bind(
      row.accountId,
      row.sentResult.gmailMessageId,
      row.sentResult.threadId,
      row.sentResult.fromAddr,
      row.to,
      row.cc,
      row.subject,
      row.sentResult.snippet,
      row.bodyText,
      nowIso,
    )
    .first<{ id: number }>();

  const corr = await c.env.DB.prepare(
    `INSERT INTO correspondence_log
       (project_id, author_id, log_date, direction, subject, body,
        from_email, to_email, cc_emails, doc_type, ref_no, email_message_id, signature_url)
     VALUES (?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  )
    .bind(
      row.projectId,
      row.viewerSub,
      row.logDate,
      row.subject,
      row.bodyText,
      row.sentResult.fromAddr,
      row.to,
      row.cc,
      row.docType,
      row.refNo,
      msgIns?.id ?? null,
      row.signatureUrl,
    )
    .first<{ id: number }>();

  if (msgIns?.id && corr?.id) {
    await c.env.DB.prepare('UPDATE email_messages SET correspondence_id = ? WHERE id = ?')
      .bind(corr.id, msgIns.id)
      .run();
  }

  return { correspondence_id: corr?.id ?? null, message_id: msgIns?.id ?? null };
}
