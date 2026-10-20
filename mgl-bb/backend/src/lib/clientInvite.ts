import type { Env } from '../types';

/**
 * Захиалагчийн урилга / нууц үг сэргээх нэг удаагийн токен.
 *
 * ЯАГААД KV, JWT БИШ ВЭ: урилга нь НЭГ УДАА ашиглагдаад ҮХЭХ ёстой.  JWT-г
 * цуцлах боломжгүй (`lib/jwt.ts` нь гарын үсэг + `exp`-ээс өөр юу ч шалгадаггүй),
 * тиймээс имэйлээс алдагдсан урилга дуусах хугацаа хүртэл ажиллах байсан.
 * KV-д хадгалснаар хэрэглэсэн даруйд устгана.
 *
 * ЯАГААД шинэ KV binding нэмээгүй вэ: `OAUTH_KV` аль хэдийн бий бөгөөд
 * `lib/googleCalendarSync.ts` ч түүнийг өөрийн зорилгоор ашигладаг.  Түлхүүрийн
 * угтвар (`client-invite:`) нэрийн зайг тусгаарлана.
 */

const PREFIX = 'client-invite:';

export type InviteKind = 'invite' | 'reset';

export interface InvitePayload {
  user_id: number;
  org_id: number | null;
  kind: InviteKind;
  created_at: string;
}

/** 32 hex тэмдэгт — таамаглах боломжгүй. */
export function newInviteToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function saveInvite(
  env: Env,
  token: string,
  payload: InvitePayload,
  ttlSeconds: number,
): Promise<void> {
  await env.OAUTH_KV.put(`${PREFIX}${token}`, JSON.stringify(payload), {
    expirationTtl: Math.max(60, ttlSeconds),
  });
}

export async function readInvite(env: Env, token: string): Promise<InvitePayload | null> {
  if (!token || !/^[0-9a-f]{32}$/.test(token)) return null;
  const raw = await env.OAUTH_KV.get(`${PREFIX}${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InvitePayload;
  } catch {
    return null;
  }
}

/** Нэг удаагийн байдлыг хангана — амжилттай хэрэглэсний ДАРАА дуудна. */
export async function burnInvite(env: Env, token: string): Promise<void> {
  try {
    await env.OAUTH_KV.delete(`${PREFIX}${token}`);
  } catch {
    /* KV алдаа нь нууц үг тохируулах үйлдлийг унагааж болохгүй */
  }
}

/** Урилгын бүтэн холбоос — имэйлд тавих, эсвэл админд хуулж өгөх. */
export function inviteUrl(env: Env, token: string, kind: InviteKind): string {
  const base = (env.FRONTEND_URL || '').replace(/\/+$/, '');
  return `${base}/client/${kind === 'reset' ? 'reset' : 'invite'}/${token}`;
}

export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 хоног
export const RESET_TTL_SECONDS = 2 * 60 * 60; // 2 цаг
