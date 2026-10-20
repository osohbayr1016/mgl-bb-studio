/**
 * Revit add-in — төхөөрөмжийн түлхүүр / challenge / аюулгүй байдлын бүртгэлийн D1 давхарга
 * (migration 0375).  Шийдвэрийн дүрэм нь `revitDeviceAccess.ts` (цэвэр); энд зөвхөн
 * хадгалалт, атом challenge, хязгаарлагдмал аудит, STRICT сүлжээний шалгалт.
 */
import { ipMatches } from './ip';
import { signToken } from './jwt';
import { SESSION_TTL_SEC, CREDENTIAL_TTL_DAYS } from './revitLicense';
import { devAuthAvailable } from './devAuth';
import type { Env, UserRole } from '../types';
import {
  CHALLENGE_TTL_SEC,
  proofMessage,
  verifyProofSignature,
  newChallengeMaterial,
  type DevicePublicKey,
  type ProofPurpose,
} from './revitDeviceKey';
import type { DeviceStatusX, GateDevice, ProofState } from './revitDeviceAccess';
import { isDeviceStatusX } from './revitDeviceAccess';

/* ------------------------------------------------------------------ */
/*  Төхөөрөмжийн мөр                                                    */
/* ------------------------------------------------------------------ */

export interface DeviceRecord {
  id: number;
  user_id: number;
  device_id: string;
  status: DeviceStatusX | null;
  hw_json: string | null;
  last_result: string | null;
  bound_attendance_device_id: number | null;
  last_lease_at: string | null;
  key: (DevicePublicKey & { key_id: string; security_level: string }) | null;
}

/** (хэрэглэгч, төхөөрөмж)-ийн мөр + түлхүүр.  D1 алдаа → шиднэ (дуудагч fail-closed). */
export async function loadDevice(
  db: D1Database,
  userId: number,
  deviceId: string,
): Promise<DeviceRecord | null> {
  const row = await db
    .prepare(
      `SELECT d.id, d.user_id, d.device_id, d.status, d.hw_json, d.last_result,
              d.bound_attendance_device_id, d.last_lease_at,
              k.key_id, k.key_x, k.key_y, k.security_level
         FROM revit_license_devices d
         LEFT JOIN revit_device_keys k ON k.device_row_id = d.id
        WHERE d.user_id = ? AND d.device_id = ?`,
    )
    .bind(userId, deviceId)
    .first<{
      id: number;
      user_id: number;
      device_id: string;
      status: string;
      hw_json: string | null;
      last_result: string | null;
      bound_attendance_device_id: number | null;
      last_lease_at: string | null;
      key_id: string | null;
      key_x: string | null;
      key_y: string | null;
      security_level: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    device_id: row.device_id,
    status: isDeviceStatusX(row.status) ? row.status : null,
    hw_json: row.hw_json,
    last_result: row.last_result,
    bound_attendance_device_id: row.bound_attendance_device_id,
    last_lease_at: row.last_lease_at,
    key:
      row.key_id && row.key_x && row.key_y
        ? { key_id: row.key_id, x: row.key_x, y: row.key_y, security_level: row.security_level ?? 'software' }
        : null,
  };
}

export function toGateDevice(d: DeviceRecord | null): GateDevice | null {
  if (!d) return null;
  return { status: d.status, hasKey: d.key !== null, securityLevel: d.key?.security_level ?? null };
}

/**
 * Ажилтан өмнө нь түлхүүр бүртгүүлж байсан уу (одоо түлхүүртэй мөр БИЙ, эсвэл admin цуцалсан мөр бий).
 * Тийм бол түлхүүргүй хуучин зам ЭНЭ ажилтанд хаагдана (`gateDevice` `userRequiresKey`).
 */
export async function userRequiresKey(db: D1Database, userId: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM revit_license_devices d
        WHERE d.user_id = ?
          AND (d.status = 'revoked' OR EXISTS (SELECT 1 FROM revit_device_keys k WHERE k.device_row_id = d.id))
        LIMIT 1`,
    )
    .bind(userId)
    .first<{ x: number }>();
  return row !== null;
}

/** Цуцлагдсан түлхүүр дахин бүртгэгдэхийг хаана (tombstone). */
export async function isKeyRevoked(db: D1Database, keyId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM revit_revoked_keys WHERE key_id = ?').bind(keyId).first<{ x: number }>();
  return row !== null;
}

/** Ажилтны идэвхтэй (auto|approved) ТҮЛХҮҮРТЭЙ төхөөрөмжийн тоо — хязгаарын шалгалт. */
export async function countActiveKeyedDevices(
  db: D1Database,
  userId: number,
  excludeRowId: number | null,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM revit_license_devices d
         JOIN revit_device_keys k ON k.device_row_id = d.id
        WHERE d.user_id = ? AND d.status IN ('auto','approved') AND d.id <> ?`,
    )
    .bind(userId, excludeRowId ?? -1)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/*  Challenge — нэг удаагийн, богино настай, хэрэглэгч+төхөөрөмжид уяатай  */
/* ------------------------------------------------------------------ */

/** (хэрэглэгч, төхөөрөмж, зорилго) тутамд хүлээгдэж буй challenge-ийн дээд тоо — токен барьсан хүн нэг төхөөрөмжийн
 *  challenge-ийг дүүргэж чадахгүй (хэтрэлт нь 2 минутын дараа өөрөө арилна), мөн хэрэглэгч тутамд нийт дээд хязгаар. */
const MAX_OPEN_CHALLENGES_PER_KEY = 10;
const MAX_OPEN_CHALLENGES_PER_USER = 60;

export async function issueChallenge(
  db: D1Database,
  args: { userId: number; deviceId: string; purpose: ProofPurpose; nowMs: number },
): Promise<{ ok: true; id: string; nonce: string; expiresAtMs: number } | { ok: false; reason: 'rate_limited' }> {
  const open = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN device_id = ? AND purpose = ? THEN 1 ELSE 0 END) AS per_key
         FROM revit_device_challenges
        WHERE user_id = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .bind(args.deviceId, args.purpose, args.userId, args.nowMs)
    .first<{ total: number; per_key: number | null }>();
  if (
    (open?.total ?? 0) >= MAX_OPEN_CHALLENGES_PER_USER ||
    (open?.per_key ?? 0) >= MAX_OPEN_CHALLENGES_PER_KEY
  ) {
    return { ok: false, reason: 'rate_limited' };
  }

  const { id, nonce } = newChallengeMaterial();
  const expiresAtMs = args.nowMs + CHALLENGE_TTL_SEC * 1000;
  await db
    .prepare(
      `INSERT INTO revit_device_challenges (id, user_id, device_id, purpose, nonce, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, args.userId, args.deviceId, args.purpose, nonce, expiresAtMs, args.nowMs)
    .run();
  // Хуучин challenge-ийг хааяа цэвэрлэнэ (хязгаарлагдмал хэмжээ).
  if (Math.random() < 0.05) {
    await db
      .prepare('DELETE FROM revit_device_challenges WHERE expires_at < ?')
      .bind(args.nowMs - 3600_000)
      .run();
  }
  return { ok: true, id, nonce, expiresAtMs };
}

/**
 * Challenge-ийг ХЭРЭГЛЭНЭ (атом: `used_at IS NULL` нөхцөлтэй UPDATE).  Хоёр дахь
 * оролдлого (replay), хугацаа дууссан, өөр хэрэглэгч / төхөөрөмж / зорилгын challenge
 * бүгд `null`.  ⚠️ Гарын үсэг буруу байсан ч challenge зарцуулагдана — дахин оролдохдоо
 * шинэ challenge авна (brute-force гарын үсэг таах боломжгүй).
 */
export async function consumeChallenge(
  db: D1Database,
  args: { id: string; userId: number; deviceId: string; purpose: ProofPurpose; nowMs: number },
): Promise<{ nonce: string } | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, device_id, purpose, nonce, expires_at, used_at
         FROM revit_device_challenges WHERE id = ?`,
    )
    .bind(args.id)
    .first<{
      id: string;
      user_id: number;
      device_id: string;
      purpose: string;
      nonce: string;
      expires_at: number;
      used_at: number | null;
    }>();
  if (!row) return null;
  if (row.user_id !== args.userId || row.device_id !== args.deviceId || row.purpose !== args.purpose) return null;
  if (row.used_at !== null || row.expires_at <= args.nowMs) return null;
  const res = await db
    .prepare(
      `UPDATE revit_device_challenges SET used_at = ?
        WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .bind(args.nowMs, args.id, args.nowMs)
    .run();
  if (res.meta?.changes !== 1) return null;
  return { nonce: row.nonce };
}

export interface ProofInput {
  challenge_id?: unknown;
  signature?: unknown;
}

/**
 * Proof-ыг шалгана: challenge-ийг зарцуулаад, canonical мөрөнд гарын үсэг ЗӨВ эсэхийг
 * бүртгэлтэй түлхүүрээр шалгана.  `proof` ирээгүй → 'missing'.
 */
export async function checkProof(
  db: D1Database,
  args: {
    proof: ProofInput | null | undefined;
    purpose: ProofPurpose;
    userId: number;
    deviceId: string;
    pub: DevicePublicKey;
    keyId: string;
    nowMs: number;
  },
): Promise<ProofState> {
  const p = args.proof;
  if (!p || typeof p !== 'object') return 'missing';
  if (typeof p.challenge_id !== 'string' || typeof p.signature !== 'string') return 'missing';
  if (!/^[0-9a-f]{32}$/.test(p.challenge_id) || p.signature.length > 128) return 'invalid';
  const ch = await consumeChallenge(db, {
    id: p.challenge_id,
    userId: args.userId,
    deviceId: args.deviceId,
    purpose: args.purpose,
    nowMs: args.nowMs,
  });
  if (!ch) return 'invalid';
  const msg = proofMessage({
    purpose: args.purpose,
    challengeId: p.challenge_id,
    nonce: ch.nonce,
    userId: args.userId,
    deviceId: args.deviceId,
    keyId: args.keyId,
  });
  return (await verifyProofSignature(args.pub, msg, p.signature)) ? 'valid' : 'invalid';
}

/* ------------------------------------------------------------------ */
/*  Аюулгүй байдлын үйл явдлын бүртгэл                                  */
/* ------------------------------------------------------------------ */

export type SecurityEvent =
  | 'enroll_requested'
  | 'enroll_auto'
  | 'enroll_pending'
  | 'enroll_rejected'
  | 'device_approved'
  | 'device_blocked'
  | 'device_revoked'
  | 'device_reset'
  | 'proof_ok'
  | 'proof_failed'
  | 'challenge_denied'
  | 'unknown_device'
  | 'blocked_device_attempt'
  | 'license_issued'
  | 'license_denied'
  | 'session_issued'
  | 'legacy_license'
  | 'legacy_token_used'
  | 'legacy_token_denied'
  | 'version_blocked'
  | 'user_inactive'
  | 'device_limit_reached'
  | 'policy_changed'
  | 'security_check_failed';

/** Бүртгэл ХЭЗЭЭ Ч үндсэн урсгалыг унагаахгүй.  Токен / түлхүүр / гарын үсэг ОРУУЛАХГҮЙ. */
export async function logSecurityEvent(
  db: D1Database,
  e: {
    event: SecurityEvent;
    userId?: number | null;
    deviceRowId?: number | null;
    deviceId?: string | null;
    detail?: string | null;
    addinVersion?: string | null;
    ip?: string | null;
  },
): Promise<void> {
  try {
    // Хязгаарлагдмал аудит: ИЖИЛ (хэрэглэгч, үйл явдал, төхөөрөмж, дэлгэрэнгүй) 10 минутад нэг л мөр,
    // мөн нэг хэрэглэгч цагт ≤ 120 мөр (санамсаргүй device_id-аар хүснэгт дүүргэхээс).
    await db
      .prepare(
        `INSERT INTO revit_security_events
           (event, user_id, device_row_id, device_short, detail, addin_version, ip)
         SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
                  SELECT 1 FROM revit_security_events
                   WHERE user_id IS ? AND event = ? AND COALESCE(device_short, '') = COALESCE(?, '')
                     AND COALESCE(detail, '') = COALESCE(?, '') AND at > datetime('now', '-10 minutes'))
            AND (SELECT COUNT(*) FROM revit_security_events
                  WHERE user_id IS ? AND at > datetime('now', '-1 hour')) < 120`,
      )
      .bind(
        e.event,
        e.userId ?? null,
        e.deviceRowId ?? null,
        e.deviceId ? e.deviceId.slice(0, 8) : null,
        e.detail ? e.detail.slice(0, 300) : null,
        e.addinVersion ? e.addinVersion.slice(0, 32) : null,
        e.ip ? e.ip.slice(0, 64) : null,
        e.userId ?? null,
        e.event,
        e.deviceId ? e.deviceId.slice(0, 8) : null,
        e.detail ? e.detail.slice(0, 300) : null,
        e.userId ?? null,
      )
      .run();
    // Хязгаарлагдмал: 180 хоногоос хуучныг хааяа устгана.
    if (Math.random() < 0.02) {
      await db
        .prepare(`DELETE FROM revit_security_events WHERE at < datetime('now','-180 days')`)
        .run();
    }
  } catch (err) {
    console.warn('[revit-security] үйл явдал бичиж чадсангүй', err);
  }
}

/* ------------------------------------------------------------------ */
/*  STRICT сүлжээний бодлого (лицензийн олголтод)                       */
/* ------------------------------------------------------------------ */

export type NetworkVerdict =
  | { ok: true }
  | { ok: false; status: 403; code: 'office_network_required'; error: string }
  | { ok: false; status: 503; code: 'SECURITY_CHECK_FAILED'; error: string };

/**
 * Global `officeAccessGuard` нь ЗОРИУДААР fail-open (D1 алдаа гарвал бүх ажилтныг
 * түгжихгүйн тулд).  Лиценз олгох нь тийм биш: аюулгүй байдлын шалгалт хийж
 * чадахгүй бол лиценз ОЛГОХГҮЙ.  Бодлого нь ижил: `OFFICE_ACCESS_ENFORCED=1` үед
 * оффисын IP эсвэл `users.remote_access_allowed=1`.  Оффисын Wi-Fi ГАНЦААРАА
 * лиценз БИШ — энэ нь зөвхөн нэмэлт нөхцөл, төхөөрөмжийн proof-ийг орлохгүй.
 */
export async function strictNetworkVerdict(
  env: Env,
  args: { db: D1Database; requestUrl: string; clientIp: string; userId: number },
): Promise<NetworkVerdict> {
  if (env.OFFICE_ACCESS_ENFORCED !== '1') return { ok: true };
  if (devAuthAvailable(env, args.requestUrl)) return { ok: true };
  try {
    const user = await args.db
      .prepare('SELECT remote_access_allowed FROM users WHERE id = ?')
      .bind(args.userId)
      .first<{ remote_access_allowed: number | null }>();
    if (user?.remote_access_allowed === 1) return { ok: true };
    const { results } = await args.db
      .prepare('SELECT ip_address FROM office_ips WHERE is_active = 1')
      .all<{ ip_address: string }>();
    const ip = args.clientIp;
    if (ip && ip !== 'unknown' && (results ?? []).some((r) => ipMatches(ip, r.ip_address))) return { ok: true };
    return {
      ok: false,
      status: 403,
      code: 'office_network_required',
      error: 'Оффисын сүлжээнд холбогдоно уу',
    };
  } catch (err) {
    console.error('[revit-license] сүлжээний бодлого шалгаж чадсангүй', err);
    return {
      ok: false,
      status: 503,
      code: 'SECURITY_CHECK_FAILED',
      error: 'Аюулгүй байдлын шалгалт хийгдсэнгүй. Түр хүлээгээд дахин оролдоно уу.',
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Токен / тогтмол                                                     */
/* ------------------------------------------------------------------ */

export const SECURITY_CHECK_FAILED_MESSAGE =
  'Аюулгүй байдлын шалгалт хийгдсэнгүй. Түр хүлээгээд дахин оролдоно уу.';

/** Нэг ажилтны хадгалах төхөөрөмжийн мөрийн дээд тоо (хуурамч device_id-аар хүснэгт дүүргэхээс сэргийлнэ). */
export const MAX_DEVICE_ROWS_PER_USER = 30;

/** SQLite `datetime('now')` (UTC, «YYYY-MM-DD HH:MM:SS») → өнгөрсөн мс; хоосон / гэмтсэн → null. */
export function ageMsOf(sqliteUtc: string | null, nowMs: number): number | null {
  if (!sqliteUtc) return null;
  const t = Date.parse(sqliteUtc.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? Math.max(0, nowMs - t) : null;
}

/**
 * Төхөөрөмжид уяатай токенууд:
 *   session    — `purpose:'revit'`, 30 минут: add-in-ий БҮХ API дуудлага (`dev`+`kid` claim;
 *                `lib/revitSessionCheck.ts` төхөөрөмжийн төлөвтэй тулгана).
 *   credential — `purpose:'revit-refresh'`, 30 хоног: ЗӨВХӨН /license, /device/challenge,
 *                /device/session-д хүчинтэй (`middleware/auth.ts`).  Ганцаараа session / лиценз
 *                авч чадахгүй — түлхүүрийн гарын үсэг (proof) заавал.
 */
export async function mintDeviceTokens(
  jwtSecret: string,
  a: { userId: number; role: UserRole; deviceId: string; keyId: string },
): Promise<{
  session: { token: string; expires_at: string };
  credential: { token: string; expires_at: string };
}> {
  const now = Date.now();
  const session = await signToken(
    { sub: a.userId, role: a.role, purpose: 'revit', dev: a.deviceId, kid: a.keyId },
    jwtSecret,
    SESSION_TTL_SEC / 3600,
  );
  const credential = await signToken(
    { sub: a.userId, role: a.role, purpose: 'revit-refresh', dev: a.deviceId, kid: a.keyId },
    jwtSecret,
    CREDENTIAL_TTL_DAYS * 24,
  );
  return {
    session: { token: session, expires_at: new Date(now + SESSION_TTL_SEC * 1000).toISOString() },
    credential: {
      token: credential,
      expires_at: new Date(now + CREDENTIAL_TTL_DAYS * 86400_000).toISOString(),
    },
  };
}
