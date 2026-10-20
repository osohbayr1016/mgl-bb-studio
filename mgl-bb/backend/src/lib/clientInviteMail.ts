/**
 * Захиалагчийн урилга / нууц үг сэргээх холбоосыг ИМЭЙЛЭЭР илгээх (2026-09-18).
 *
 * 2026-09-07-оос хойш урилга нь зөвхөн админ хуулж явуулах холбоос байсан
 * (`gmailClient.ts`-ийн `sendMessage` репод дуудагчгүй).  Эзний хүсэлт:
 * автоматаар илгээх.  Илгээх хайрцаг нь Gmail OAuth-оор холбогдсон
 * `email_accounts` мөр — `driveClient.ts`-ийн `driveAccount`-тай ижил дүрэм:
 * `app_settings.client_invite_account_id` заасан бол ЯГ тэр, эс бөгөөс
 * идэвхтэй хамгийн эртний хайрцаг.
 *
 * ⚠️ Имэйл нь ҮНДСЭН ҮЙЛДЛИЙГ ХЭЗЭЭ Ч УНАГААХГҮЙ: хэрэглэгч үүсгэх / урилга
 *    үүсгэх амжилттай болсны ДАРАА л дуудагдана, алдааг `{sent:false, error}`
 *    гэж буцаана — route нь холбоосыг хэвээр өгдөг тул админ гараар явуулж
 *    чадна.  Хайрцаг холбогдоогүй орчинд (локал dev) чимээгүй `sent:false`.
 */
import type { EmailAccountRow, Env } from '../types';
import { EmailSendError, sendViaGmail } from './emailSend';
import { buildInviteMail, type InviteMailInput } from './clientInviteMailBody';

export type { InviteMailInput } from './clientInviteMailBody';

export type InviteMailResult = { sent: true; from: string } | { sent: false; error: string };

async function outgoingAccount(env: Env): Promise<EmailAccountRow | null> {
  let wanted: number | null = null;
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'client_invite_account_id'")
      .first<{ value: string }>();
    const n = Number(row?.value);
    if (Number.isInteger(n) && n > 0) wanted = n;
  } catch {
    /* app_settings байхгүй / хуучин DB — өгөгдмөл дүрэм */
  }
  const account = wanted
    ? await env.DB.prepare('SELECT * FROM email_accounts WHERE id = ? AND is_active = 1').bind(wanted).first<EmailAccountRow>()
    : await env.DB.prepare(
        `SELECT * FROM email_accounts
          WHERE is_active = 1 AND (auth_type <> 'oauth' OR refresh_token_enc IS NOT NULL)
          ORDER BY id LIMIT 1`,
      ).first<EmailAccountRow>();
  return account ?? null;
}

export async function sendClientInviteMail(env: Env, input: InviteMailInput): Promise<InviteMailResult> {
  const to = input.to.trim();
  if (!to || !to.includes('@')) return { sent: false, error: 'Имэйл хаяг буруу' };
  let account: EmailAccountRow | null;
  try {
    account = await outgoingAccount(env);
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'Хайрцаг уншигдсангүй' };
  }
  if (!account) return { sent: false, error: 'Илгээх Gmail хайрцаг холбогдоогүй байна (Тохиргоо → И-мэйл)' };
  const mail = buildInviteMail(input);
  try {
    const res = await sendViaGmail(env, {
      account,
      to,
      subject: mail.subject,
      body_html: mail.html,
      body_text: mail.text,
    });
    return { sent: true, from: res.fromAddr };
  } catch (err) {
    const msg = err instanceof EmailSendError || err instanceof Error ? err.message : 'Илгээж чадсангүй';
    console.warn('[client-invite] имэйл илгээгдсэнгүй', msg);
    return { sent: false, error: msg };
  }
}
