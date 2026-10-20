/**
 * Захиалагчийн урилгын имэйлийн БИЧВЭР — цэвэр, тесттэй (`clientInviteMail.ts`-ээс
 * тусдаа: тэр нь `emailSend.ts` → `googleAuth.ts`-ийг импортлодог бөгөөд
 * `node --test` type-stripping тэр файлыг ачаалж чаддаггүй).
 */
import type { InviteKind } from './clientInvite';

export interface InviteMailInput {
  to: string;
  full_name: string;
  kind: InviteKind;
  url: string;
  /** Байгууллагын нэр — «X-ийн төлөөлөгчөөр». */
  org_name?: string | null;
  /** Аль төслийн баримт бичигт урьж байна (Баримт бичгийн хуудаснаас үүсгэхэд). */
  project_name?: string | null;
  /** Урьсан ажилтны нэр — гарын үсэг. */
  inviter_name?: string | null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Имэйлийн гарчиг + HTML/текст бие — цэвэр (тесттэй). */
export function buildInviteMail(input: InviteMailInput): { subject: string; html: string; text: string } {
  const isReset = input.kind === 'reset';
  const name = input.full_name.trim() || 'Эрхэм захиалагч';
  const org = input.org_name?.trim() || null;
  const project = input.project_name?.trim() || null;
  const ttl = isReset ? '2 цагийн' : '7 хоногийн';
  const subject = isReset
    ? 'MGL — захиалагчийн порталын нууц үг сэргээх'
    : project
      ? `MGL — «${project}» төслийн баримт бичигт урилга`
      : 'MGL — захиалагчийн порталд урилга';

  const lines: string[] = [`Сайн байна уу, ${name}.`];
  if (isReset) {
    lines.push('Захиалагчийн порталын нууц үгээ доорх холбоосоор шинээр тохируулна уу.');
  } else {
    lines.push(
      org
        ? `Таныг «${org}» байгууллагын төлөөлөгчөөр MGL-ийн захиалагчийн порталд урьж байна.`
        : 'Таныг MGL-ийн захиалагчийн порталд урьж байна.',
    );
    if (project) {
      lines.push(`Порталд «${project}» төслийн явц, тайлан, мөн танд нээсэн баримт бичгүүдийг харж, татаж авах боломжтой.`);
    } else {
      lines.push('Порталд төслийн явц, тайлан, гаргасан зураг болон танд нээсэн баримт бичгүүдийг харж, татаж авах боломжтой.');
    }
    lines.push('Доорх холбоосоор орж нууц үгээ тохируулна уу.');
  }
  lines.push(`Холбоос ${ttl} хугацаанд, нэг удаа хүчинтэй.`);
  const sign = input.inviter_name?.trim() ? `Хүндэтгэсэн,\n${input.inviter_name.trim()}\nMGL` : 'Хүндэтгэсэн,\nMGL';

  const text = `${lines.join('\n\n')}\n\n${input.url}\n\n${sign}`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">` +
    lines.map((l) => `<p>${esc(l)}</p>`).join('') +
    `<p><a href="${esc(input.url)}" style="display:inline-block;padding:10px 18px;background:#1e3a5f;color:#fff;text-decoration:none;border-radius:6px">` +
    `${isReset ? 'Нууц үг тохируулах' : 'Порталд нэвтрэх'}</a></p>` +
    `<p style="font-size:12px;color:#6b7280">Товч ажиллахгүй бол холбоосыг хуулж хөтчид оруулна уу:<br>${esc(input.url)}</p>` +
    `<p>${esc(sign).replace(/\n/g, '<br>')}</p></div>`;
  return { subject, html, text };
}

