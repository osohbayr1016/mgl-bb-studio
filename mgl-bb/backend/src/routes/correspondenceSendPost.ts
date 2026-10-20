import type { Context } from 'hono';
import { nextRefNo } from '../lib/refNo';
import { EmailSendError, sendViaGmail } from '../lib/emailSend';
import { canUseAccount } from '../lib/emailAccountTeams';
import type { EmailAccountRow } from '../types';
import {
  type CanWriteFn,
  type CorrespondenceCtx,
  isValidDocType,
  normalizeMediaUrl,
  ubDateNow,
} from './correspondenceSendLib';
import { writeSendLedger } from './correspondenceSendLedger';
import { requestClientSignature } from './correspondenceSignature';
import { isSignableDocType, signatureRequestMailFooter } from '../lib/correspondenceSignature';

type SendBody = {
  account_id?: number;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body_text?: string;
  body_html?: string;
  doc_type?: string;
  log_date?: string;
  ref_no?: string | null;
  signature_url?: string | null;
  attachments?: Array<{ r2_key: string; filename?: string; mime_type?: string }>;
  /** RFI/CR: илгээмэгц захиалагчид ПОРТАЛД гарын үсэг зуруулахаар хүсэлт тавина
   *  (migration 0335).  Имэйлийн төгсгөлд порталын заавар залгагдана. */
  request_signature?: boolean;
};

export async function handleCorrespondenceSend(
  c: Context<CorrespondenceCtx>,
  canWrite: CanWriteFn,
) {
  const viewer = c.get('user');
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);
  if (!(await canWrite(c.env.DB, projectId, viewer))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<SendBody>().catch(() => ({}) as SendBody);
  const accountId = Number(body.account_id);
  if (!Number.isFinite(accountId)) return c.json({ error: 'account_id шаардлагатай' }, 400);
  if (!isValidDocType(body.doc_type)) {
    return c.json({ error: "doc_type must be 'rfi'|'cr'|'official'|'mr'" }, 400);
  }
  if (!(await canUseAccount(c.env.DB, viewer, accountId))) {
    return c.json({ error: 'Энэ хайрцгийг ашиглах эрхгүй' }, 403);
  }

  const account = await c.env.DB.prepare('SELECT * FROM email_accounts WHERE id = ?')
    .bind(accountId)
    .first<EmailAccountRow>();
  if (!account || account.is_active !== 1) {
    return c.json({ error: 'Mailbox not found' }, 404);
  }

  const wantSignature = body.request_signature === true;
  if (wantSignature && !isSignableDocType(body.doc_type)) {
    return c.json({ error: 'Зөвхөн RFI / CR бичигт гарын үсэг зуруулна' }, 400);
  }
  // Гарын үсгийн заавар — имэйлийн бие болон бүртгэлийн тэмдэглэл ХОЁУЛАНД
  // нэг ижил (ledger нь илгээсэн бичвэрийн хуулбар байх ёстой).
  const footer = wantSignature ? signatureRequestMailFooter(c.env.FRONTEND_URL) : '';
  const bodyText = (body.body_text ?? '') + footer;
  const bodyHtml =
    body.body_html && wantSignature
      ? `${body.body_html}<p>${escapeHtml(footer.trim()).replace(/\n/g, '<br/>')}</p>`
      : body.body_html;

  let sentResult;
  try {
    sentResult = await sendViaGmail(c.env, {
      account,
      from: body.from,
      to: body.to ?? '',
      cc: body.cc,
      subject: body.subject ?? '',
      body_html: bodyHtml,
      body_text: bodyText,
      attachments: body.attachments,
    });
  } catch (e) {
    const err = e instanceof EmailSendError ? e : new EmailSendError('Илгээж чадсангүй', 502);
    return c.json({ error: err.message }, err.status as 400 | 404 | 409 | 502);
  }

  const to = (body.to ?? '').trim();
  const subject = (body.subject ?? '').trim();
  const logDate =
    typeof body.log_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.log_date)
      ? body.log_date
      : ubDateNow();

  let refNo = body.ref_no?.trim() || null;
  if (!refNo) refNo = await nextRefNo(c.env.DB, projectId, body.doc_type, logDate);

  const signatureUrl = normalizeMediaUrl(body.signature_url);
  if (body.signature_url != null && body.signature_url !== '' && !signatureUrl) {
    return c.json({ error: 'signature_url must be a /media/ key' }, 400);
  }

  const ledger = await writeSendLedger(c, {
    viewerSub: viewer.sub,
    projectId,
    accountId,
    sentResult,
    to,
    cc: body.cc?.trim() || null,
    subject,
    bodyText: bodyText.trim() || null,
    logDate,
    docType: body.doc_type,
    refNo,
    signatureUrl,
  });

  // Имэйл ЯВСАН, мөр БИЧИГДСЭН — гарын үсгийн хүсэлт унасан ч (мэдэгдэл,
  // PDF) илгээлтийг буцаахгүй; алдааг хариунд л тэмдэглэнэ.
  let signatureRequested = false;
  let signatureError: string | null = null;
  if (wantSignature && ledger.correspondence_id) {
    const row = await c.env.DB.prepare(
      `SELECT cl.*, p.name AS project_name
         FROM correspondence_log cl LEFT JOIN projects p ON p.id = cl.project_id
        WHERE cl.id = ?`,
    )
      .bind(ledger.correspondence_id)
      .first<Parameters<typeof requestClientSignature>[1]>();
    if (row) {
      const r = await requestClientSignature(c, row, viewer);
      signatureRequested = r.ok;
      if (!r.ok) signatureError = r.error;
    }
  }

  return c.json(
    {
      ok: true,
      correspondence_id: ledger.correspondence_id,
      message_id: ledger.message_id,
      signature_requested: signatureRequested,
      signature_error: signatureError,
    },
    201,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
