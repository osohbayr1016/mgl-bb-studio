import { Hono } from 'hono';
import type { Env, AppVariables, UserRole } from '../types';
import {
  DENY_MESSAGES,
  LICENSE_ROLES,
  decideLicense,
  isDeviceId,
  normalizeNativeProfile,
  type DenyCode,
} from '../lib/revitLicense';
import {
  CHALLENGE_TTL_SEC,
  isProofPurpose,
  isSecurityLevel,
  keyThumbprint,
  parsePublicKey,
  type ProofPurpose,
} from '../lib/revitDeviceKey';
import { enrollStatus, gateDevice } from '../lib/revitDeviceAccess';
import { loadPolicy, versionVerdict, type RevitPolicy } from '../lib/revitPolicy';
import {
  MAX_DEVICE_ROWS_PER_USER,
  SECURITY_CHECK_FAILED_MESSAGE,
  checkProof,
  consumeChallenge,
  countActiveKeyedDevices,
  isKeyRevoked,
  issueChallenge,
  loadDevice,
  logSecurityEvent,
  mintDeviceTokens,
  strictNetworkVerdict,
  toGateDevice,
  type ProofInput,
} from '../lib/revitDeviceService';
import { proofMessage, verifyProofSignature } from '../lib/revitDeviceKey';
import { getClientIp } from '../lib/officeNetwork';
import { invalidateRevitSessionCache } from '../lib/revitSessionCheck';

/**
 * Revit add-in-ий ТӨХӨӨРӨМЖИЙН КРИПТО ТАНИЛТ (migration 0375) — `/api/revit`-ийн ДӨРӨВ ДЭХЬ mount.
 *
 *   POST /device/challenge  — нэг удаагийн challenge (хэрэглэгч + төхөөрөмж + зорилгод уяатай)
 *   POST /device/enroll     — ШИНЭ түлхүүр бүртгэх (нууц үгээр дөнгөж нэвтэрсэн токен заавал)
 *   POST /device/session    — түлхүүрийн proof-оор 30 минутын API session шинэчлэх
 *   (лиценз олгох нь `routes/revitLicense.ts` `POST /license` — тэр ч proof шаарддаг)
 *
 * ⚠️ `use('*')` ЭНД БАЙХГҮЙ, `revitLicense.ts`-тэй ижил шалтгаанаар (mount хийсний дараа
 *    `/api/revit/*`-ийн БҮХ хүсэлтэд тархана).
 * ⚠️ Add-in-ий URL (`/api/revit/device/*`) нь `workerScope` / `clientScope`-д `/api/revit`
 *    угтвараар аль хэдийн хаалттай; `revit.ts`-ийн `requireRole(REVIT_ROLES)` бүгдэд үйлчилнэ.
 */
const revitDevice = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Шинэ түлхүүр бүртгэхэд шаардах нууц үгээр НЭВТЭРСЭН токены дээд нас (секунд). */
const FRESH_LOGIN_MAX_AGE_SEC = 15 * 60;

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Нууц үгээр дөнгөж нэвтэрсэн токен эсэх: `purpose` байхгүй (ердийн session) ба `iat` ≤ 15 мин.
 * ЯАГААД: ШИНЭ түлхүүр бүртгэх нь хамгийн мэдрэмтгий үйлдэл — 365 хоногийн `mcp` токен
 * (эсвэл хулгайлагдсан renewal credential) барьсан хүн ӨӨРИЙН TPM түлхүүрээ бүртгүүлж
 * ажилтны төхөөрөмж болж чадах ёсгүй.  Нууц үгийг мэдэж байх ёстой.
 */
function isFreshPasswordLogin(u: { purpose?: string; iat: number }): boolean {
  if (u.purpose) return false;
  return Math.floor(Date.now() / 1000) - u.iat <= FRESH_LOGIN_MAX_AGE_SEC;
}

async function loadUser(db: D1Database, id: number) {
  return db
    .prepare('SELECT id, username, full_name, role, status FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: number; username: string | null; full_name: string | null; role: string; status: string | null }>();
}

function deny(c: { json: (b: unknown, s: number) => Response }, code: DenyCode, status = 403) {
  return c.json({ ok: false, code, error: DENY_MESSAGES[code] }, status);
}

function userBlockCode(u: { role: string; status: string | null }): DenyCode | null {
  if (u.status === 'inactive') return 'USER_INACTIVE';
  if (!(LICENSE_ROLES as readonly string[]).includes(u.role)) return 'ROLE_NOT_ALLOWED';
  return null;
}

/** Бодлогын хаалт (унтраалга + хувилбар) — challenge/enroll/session-д. */
function policyBlockCode(policy: RevitPolicy, version: string | null): DenyCode | null {
  if (policy.disabled) return 'REVIT_LICENSES_DISABLED';
  const v = versionVerdict(policy, version);
  if (v === 'blocked') return 'ADDIN_VERSION_BLOCKED';
  if (v === 'update_required') return 'ADDIN_UPDATE_REQUIRED';
  return null;
}

/* ------------------------------------------------------------------ */
/*  POST /device/challenge                                              */
/* ------------------------------------------------------------------ */
// Бие: { device_id, purpose: 'enroll'|'license'|'session', addin_version? }
// 200 → { ok, challenge_id, nonce, expires_at, ttl_sec, key_id? }
// 403 DEVICE_NOT_ENROLLED — license/session зорилгоор, түлхүүргүй төхөөрөмж → add-in бүртгүүлнэ.
revitDevice.post('/device/challenge', async (c) => {
  const actor = c.get('user');
  let body: { device_id?: unknown; purpose?: unknown; addin_version?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, code: 'BAD_REQUEST', error: 'JSON бие шаардлагатай' }, 400);
  }
  if (!isDeviceId(body.device_id) || !isProofPurpose(body.purpose)) {
    return c.json({ ok: false, code: 'BAD_REQUEST', error: 'device_id, purpose шаардлагатай' }, 400);
  }
  const deviceId = body.device_id;
  const purpose: ProofPurpose = body.purpose;
  const db = c.env.DB;
  const ip = getClientIp(c);
  const version = str(body.addin_version, 32);
  try {
    const policy = await loadPolicy(db);
    if (!policy) throw new Error('policy unavailable');
    const user = await loadUser(db, actor.sub);
    if (!user) return deny(c, 'USER_INACTIVE');
    const ub = userBlockCode(user);
    if (ub) return deny(c, ub);
    const pb = policyBlockCode(policy, version);
    if (pb) return deny(c, pb);

    let keyId: string | null = null;
    if (purpose !== 'enroll') {
      const dev = await loadDevice(db, user.id, deviceId);
      if (!dev?.key) return deny(c, 'DEVICE_NOT_ENROLLED');
      if (dev.status === 'blocked' || dev.status === 'revoked') {
        await logSecurityEvent(db, {
          event: 'blocked_device_attempt',
          userId: user.id,
          deviceRowId: dev.id,
          deviceId,
          detail: `challenge:${dev.status}`,
          ip,
        });
        return deny(c, dev.status === 'blocked' ? 'DEVICE_BLOCKED' : 'DEVICE_REVOKED');
      }
      keyId = dev.key.key_id;
    }
    const ch = await issueChallenge(db, { userId: user.id, deviceId, purpose, nowMs: Date.now() });
    if (!ch.ok) {
      await logSecurityEvent(db, { event: 'challenge_denied', userId: user.id, deviceId, detail: 'rate_limited', ip });
      return c.json({ ok: false, code: 'RATE_LIMITED', error: 'Хэт олон хүсэлт. Түр хүлээгээд дахин оролдоно уу.' }, 429);
    }
    return c.json({
      ok: true,
      challenge_id: ch.id,
      nonce: ch.nonce,
      /** Add-in гарын үсэгт ЭНЭ утгыг оруулна (сервер өөрийн мэддэг user_id-аар дахин угсарна). */
      user_id: user.id,
      expires_at: new Date(ch.expiresAtMs).toISOString(),
      ttl_sec: CHALLENGE_TTL_SEC,
      ...(keyId ? { key_id: keyId } : {}),
    });
  } catch (err) {
    console.error('[revit-device] challenge алдаа', err);
    return c.json({ ok: false, code: 'SECURITY_CHECK_FAILED', error: SECURITY_CHECK_FAILED_MESSAGE }, 503);
  }
});

/* ------------------------------------------------------------------ */
/*  POST /device/enroll                                                 */
/* ------------------------------------------------------------------ */
// Бие: { device_id, hw, addin_version?, revit_year?, public_key:{x,y}, security_level,
//        proof:{challenge_id, signature} }   — proof нь ШИНЭ түлхүүрийн өөрийн гарын үсэг
//        (түлхүүрийг эзэмшиж буйн баталгаа, `purpose:'enroll'`).
// 200 → { ok, status:'auto'|'approved'|'pending', reason?, key_id }
//   • auto     — ирцийн ажлын компьютертэй таарсан, хязгаар дүүрээгүй
//   • pending  — admin зөвшөөрөл хүлээнэ (таараагүй / хязгаар дүүрсэн / TPM шаардсан)
// ⚠️ Шинэ төхөөрөмж admin-ы зөвшөөрөлгүйгээр ХЭЗЭЭ Ч `approved` болохгүй.
revitDevice.post('/device/enroll', async (c) => {
  const actor = c.get('user');
  let body: {
    device_id?: unknown;
    hw?: unknown;
    addin_version?: unknown;
    revit_year?: unknown;
    public_key?: unknown;
    security_level?: unknown;
    proof?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, code: 'BAD_REQUEST', error: 'JSON бие шаардлагатай' }, 400);
  }
  const pub = parsePublicKey(body.public_key);
  if (!isDeviceId(body.device_id) || !pub || !isSecurityLevel(body.security_level)) {
    return c.json({ ok: false, code: 'BAD_REQUEST', error: 'device_id, public_key, security_level шаардлагатай' }, 400);
  }
  const deviceId = body.device_id;
  const securityLevel = body.security_level;
  const addinVersion = str(body.addin_version, 32);
  const revitYear = str(body.revit_year, 8);
  const native = normalizeNativeProfile(body.hw);
  const db = c.env.DB;
  const ip = getClientIp(c);
  const nowMs = Date.now();

  if (!isFreshPasswordLogin(actor)) {
    return c.json(
      {
        ok: false,
        code: 'REAUTH_REQUIRED',
        error: 'Төхөөрөмж бүртгэхийн тулд нэвтрэх нэр, нууц үгээрээ дахин нэвтэрнэ үү.',
      },
      403,
    );
  }

  try {
    const policy = await loadPolicy(db);
    if (!policy) throw new Error('policy unavailable');
    const user = await loadUser(db, actor.sub);
    if (!user) return deny(c, 'USER_INACTIVE');
    const ub = userBlockCode(user);
    if (ub) return deny(c, ub);
    const pb = policyBlockCode(policy, addinVersion);
    if (pb) return deny(c, pb);
    const network = await strictNetworkVerdict(c.env, { db, requestUrl: c.req.url, clientIp: ip, userId: user.id });
    if (!network.ok) return c.json({ ok: false, code: network.code, error: network.error }, network.status);

    const keyId = await keyThumbprint(pub);
    const existing = await loadDevice(db, user.id, deviceId);
    if (existing?.status === 'blocked') return deny(c, 'DEVICE_BLOCKED');
    if (existing?.status === 'revoked') return deny(c, 'DEVICE_REVOKED');

    // Нэг түлхүүр ГАНЦ нэг бүртгэлд.  Өөр ажилтан / төхөөрөмж дээр бүртгэгдсэн түлхүүр
    // дахин ирвэл (програмын түлхүүрийг хуулсан) татгалзана.
    const owner = await db
      .prepare('SELECT device_row_id FROM revit_device_keys WHERE key_id = ?')
      .bind(keyId)
      .first<{ device_row_id: number }>();
    if (owner && owner.device_row_id !== existing?.id) {
      await logSecurityEvent(db, {
        event: 'enroll_rejected',
        userId: user.id,
        deviceId,
        detail: 'key_in_use',
        addinVersion,
        ip,
      });
      return deny(c, 'DEVICE_KEY_MISMATCH', 409);
    }
    // Admin цуцалсан / устгасан түлхүүр (алдагдсан, хулгайлагдсан) ЯМАР Ч төхөөрөмж дээр дахин бүртгэгдэхгүй.
    if (await isKeyRevoked(db, keyId)) {
      await logSecurityEvent(db, {
        event: 'enroll_rejected',
        userId: user.id,
        deviceRowId: existing?.id ?? null,
        deviceId,
        detail: 'key_revoked',
        addinVersion,
        ip,
      });
      return deny(c, 'DEVICE_KEY_MISMATCH', 409);
    }
    // Төхөөрөмж өөр түлхүүртэй аль хэдийн бүртгэлтэй → админ эхлээд цуцлах ёстой.
    if (existing?.key && existing.key.key_id !== keyId) {
      await logSecurityEvent(db, {
        event: 'enroll_rejected',
        userId: user.id,
        deviceRowId: existing.id,
        deviceId,
        detail: 'key_mismatch',
        addinVersion,
        ip,
      });
      return deny(c, 'DEVICE_KEY_MISMATCH', 409);
    }

    // Түлхүүрийг эзэмшиж буйн баталгаа: challenge-ийг ЗАРЦУУЛААД ШИНЭ түлхүүрээр шалгана.
    const proof = await (async () => {
      const p = body.proof as ProofInput | undefined;
      if (!p || typeof p.challenge_id !== 'string' || typeof p.signature !== 'string') return 'missing' as const;
      if (!/^[0-9a-f]{32}$/.test(p.challenge_id) || p.signature.length > 128) return 'invalid' as const;
      const ch = await consumeChallenge(db, {
        id: p.challenge_id,
        userId: user.id,
        deviceId,
        purpose: 'enroll',
        nowMs,
      });
      if (!ch) return 'invalid' as const;
      const ok = await verifyProofSignature(
        pub,
        proofMessage({
          purpose: 'enroll',
          challengeId: p.challenge_id,
          nonce: ch.nonce,
          userId: user.id,
          deviceId,
          keyId,
        }),
        p.signature,
      );
      return ok ? ('valid' as const) : ('invalid' as const);
    })();
    if (proof !== 'valid') {
      await logSecurityEvent(db, {
        event: 'proof_failed',
        userId: user.id,
        deviceRowId: existing?.id ?? null,
        deviceId,
        detail: `enroll:${proof}`,
        addinVersion,
        ip,
      });
      return deny(c, proof === 'missing' ? 'DEVICE_PROOF_REQUIRED' : 'DEVICE_PROOF_INVALID');
    }

    // ── ИЖИЛ түлхүүрийн дахин бүртгэл (идемпотент) ───────────────────────────
    // Add-in нэвтрэх бүрд бүртгэл илгээдэг.  Түлхүүр аль хэдийн бүртгэлтэй бол төлөв, last_result,
    // admin-ы шийдвэрийг ХЭЗЭЭ Ч дахин бодохгүй (эс бөгөөс admin-ы `pending` / `blocked`-ийг ажилтан
    // өөрийн илгээсэн hw-ээр `auto` болгож дарна).  Зөвхөн техник мэдээлэл + харагдах байдлыг шинэчилнэ.
    if (existing?.key) {
      await db
        .prepare(
          `UPDATE revit_license_devices
              SET hw_json = COALESCE(?, hw_json), addin_version = COALESCE(?, addin_version),
                  revit_year = COALESCE(?, revit_year), last_seen_at = datetime('now')
            WHERE id = ? AND status NOT IN ('blocked','revoked')`,
        )
        .bind(native ? JSON.stringify(native) : null, addinVersion, revitYear, existing.id)
        .run();
      return c.json(await enrollResponse(c, user, deviceId, keyId, existing.status ?? 'pending', 'kept'));
    }

    // ── ШИНЭ түлхүүр ──────────────────────────────────────────────────────────
    // Ажлын компьютертэй таарч байгаа эсэх (хуучин `decideLicense` — зөвхөн техник тулгалт).
    const attendance = await loadAttendanceForEnroll(db, user.id);
    const hw = decideLicense({
      user: { status: user.status, role: user.role },
      deviceStatus: null,
      native,
      attendance,
      boundAttendanceDeviceId: existing?.bound_attendance_device_id ?? null,
      accountMode: policy.enrollApproval === 'account',
    });

    let status: 'auto' | 'approved' | 'pending';
    let reason: 'ok' | 'not_work_pc' | 'limit' | 'weak' | 'kept' | 'admin_required' = 'ok';
    if (existing?.status === 'approved') {
      // Admin өмнө нь гараар зөвшөөрсөн (хуучин замаар) — түлхүүр нэмэгдэхэд зөвшөөрөл хэвээр.
      status = 'approved';
      reason = 'kept';
    } else {
      const count = await countActiveKeyedDevices(db, user.id, existing?.id ?? null);
      const es = enrollStatus({
        hardwareMatches: hw.ok,
        activeKeyedDevices: count,
        maxDevices: policy.maxDevices,
        securityLevel,
        requireTpm: policy.requireTpm,
        adminApprovalRequired: policy.enrollApproval === 'admin',
        accountMode: policy.enrollApproval === 'account',
      });
      status = es.status;
      reason = es.reason;
    }

    const resultCode =
      status === 'pending'
        ? reason === 'limit'
          ? 'DEVICE_LIMIT_REACHED'
          : reason === 'weak'
            ? 'DEVICE_KEY_WEAK'
            : 'DEVICE_PENDING'
        : hw.ok
          ? `ok_${hw.via}`
          : 'ok_approved';

    // Мөр + түлхүүр НЭГ batch-д (D1 batch = нэг transaction): түлхүүр бичигдээгүй атлаа `auto` мөр
    // үлдэхгүй, ижил түлхүүрийн зэрэг бүртгэлийн нэг нь UNIQUE-д унаж бүхэлдээ буцна.
    const keyInsert = (where: string, ...binds: unknown[]) =>
      db
        .prepare(
          `INSERT INTO revit_device_keys (device_row_id, key_id, key_x, key_y, security_level, last_proof_at)
           SELECT id, ?, ?, ?, ?, datetime('now') FROM revit_license_devices WHERE ${where}`,
        )
        .bind(keyId, pub.x, pub.y, securityLevel, ...binds);
    if (!existing) {
      const n = (
        await db
          .prepare('SELECT COUNT(*) AS n FROM revit_license_devices WHERE user_id = ?')
          .bind(user.id)
          .first<{ n: number }>()
      )?.n ?? 0;
      if (n >= MAX_DEVICE_ROWS_PER_USER) return deny(c, 'DEVICE_LIMIT_REACHED');
      await db.batch([
        db
          .prepare(
            `INSERT INTO revit_license_devices
               (user_id, device_id, hw_json, status, last_result, bound_attendance_device_id,
                addin_version, revit_year, first_seen_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          )
          .bind(
            user.id,
            deviceId,
            native ? JSON.stringify(native) : null,
            status,
            resultCode,
            hw.ok ? hw.attendanceDeviceId : null,
            addinVersion,
            revitYear,
          ),
        keyInsert('user_id = ? AND device_id = ?', user.id, deviceId),
      ]);
    } else {
      // admin блоклосон / цуцалсан мөрийг (зэрэг хийгдсэн ч) дарахгүй: `status NOT IN (...)`.
      await db.batch([
        db
          .prepare(
            `UPDATE revit_license_devices
                SET status = ?, last_result = ?, hw_json = COALESCE(?, hw_json),
                    bound_attendance_device_id = COALESCE(?, bound_attendance_device_id),
                    addin_version = COALESCE(?, addin_version), revit_year = COALESCE(?, revit_year),
                    last_seen_at = datetime('now')
              WHERE id = ? AND status NOT IN ('blocked','revoked')`,
          )
          .bind(
            status,
            resultCode,
            native ? JSON.stringify(native) : null,
            hw.ok ? hw.attendanceDeviceId : null,
            addinVersion,
            revitYear,
            existing.id,
          ),
        keyInsert(`id = ? AND status NOT IN ('blocked','revoked')`, existing.id),
      ]);
    }
    invalidateRevitSessionCache();
    const after = await loadDevice(db, user.id, deviceId);
    if (!after?.key || after.key.key_id !== keyId) {
      // Зэрэг хийгдсэн admin хаалт гэх мэт — түлхүүр бичигдээгүй.
      return deny(c, after?.status === 'revoked' ? 'DEVICE_REVOKED' : 'DEVICE_BLOCKED');
    }
    await logSecurityEvent(db, {
      event: status === 'pending' ? (reason === 'limit' ? 'device_limit_reached' : 'enroll_pending') : 'enroll_auto',
      userId: user.id,
      deviceRowId: after.id,
      deviceId,
      detail: `${status}:${reason}:${securityLevel}`,
      addinVersion,
      ip,
    });
    return c.json(await enrollResponse(c, user, deviceId, keyId, status, reason));
  } catch (err) {
    console.error('[revit-device] enroll алдаа', err);
    // Түлхүүртэй мөр бичигдсэн эсэхийг мэдэхгүй — add-in дараагийн /license-д шалгана.
    return c.json({ ok: false, code: 'SECURITY_CHECK_FAILED', error: SECURITY_CHECK_FAILED_MESSAGE }, 503);
  }
});

/**
 * `/device/enroll`-ийн хариу: төлөв + renewal credential (30 хоног).  Pending төхөөрөмж admin зөвшөөрсний
 * дараа нууц үггүйгээр лиценз авна.  Credential ганцаараа хүчингүй — proof-гүй лиценз / session олгохгүй,
 * бусад /api-д 401 (`middleware/auth.ts`).
 */
async function enrollResponse(
  c: { env: Env },
  user: { id: number; role: string },
  deviceId: string,
  keyId: string,
  status: string,
  reason: string,
) {
  const { credential } = await mintDeviceTokens(c.env.JWT_SECRET, {
    userId: user.id,
    role: user.role as UserRole,
    deviceId,
    keyId,
  });
  return {
    ok: true,
    status,
    reason,
    key_id: keyId,
    credential,
    message:
      status === 'pending'
        ? DENY_MESSAGES[
            reason === 'limit' ? 'DEVICE_LIMIT_REACHED' : reason === 'weak' ? 'DEVICE_KEY_WEAK' : 'DEVICE_PENDING'
          ]
        : null,
  };
}

async function loadAttendanceForEnroll(db: D1Database, userId: number) {
  const { results } = await db
    .prepare(
      `SELECT id, hw_json FROM attendance_devices
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY last_seen_at DESC, id DESC`,
    )
    .bind(userId)
    .all<{ id: number; hw_json: string | null }>();
  return results ?? [];
}

/* ------------------------------------------------------------------ */
/*  POST /device/session                                                */
/* ------------------------------------------------------------------ */
// Бие: { device_id, addin_version?, revit_year?, proof:{challenge_id, signature} }
// 200 → { ok, session:{token, expires_at}, credential:{token, expires_at} }
// Лиценз (12 цаг) гарсны ДАРАА 30 минутын session-ыг түлхүүрийн proof-оор шинэчилнэ.
// Төхөөрөмж идэвхтэй (auto|approved), хамгийн сүүлийн лицензийн шийдвэр ok эсвэл хоосон
// (admin дөнгөж шинэчилсэн) байх ёстой — тулгалт унасан компьютер session авч чадахгүй.
revitDevice.post('/device/session', async (c) => {
  const actor = c.get('user');
  let body: { device_id?: unknown; addin_version?: unknown; proof?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, code: 'BAD_REQUEST', error: 'JSON бие шаардлагатай' }, 400);
  }
  if (!isDeviceId(body.device_id)) {
    return c.json({ ok: false, code: 'BAD_REQUEST', error: 'device_id шаардлагатай' }, 400);
  }
  const deviceId = body.device_id;
  const addinVersion = str(body.addin_version, 32);
  const proofSent = body.proof !== undefined && body.proof !== null;
  const db = c.env.DB;
  const ip = getClientIp(c);
  const nowMs = Date.now();

  try {
    const policy = await loadPolicy(db);
    if (!policy) throw new Error('policy unavailable');
    const user = await loadUser(db, actor.sub);
    if (!user) return deny(c, 'USER_INACTIVE');
    const ub = userBlockCode(user);
    if (ub) return deny(c, ub);
    const network = await strictNetworkVerdict(c.env, { db, requestUrl: c.req.url, clientIp: ip, userId: user.id });
    if (!network.ok) return c.json({ ok: false, code: network.code, error: network.error }, network.status);

    const dev = await loadDevice(db, user.id, deviceId);
    let proof: 'valid' | 'invalid' | 'missing' = 'missing';
    if (dev?.key && proofSent) {
      proof = await checkProof(db, {
        proof: body.proof as ProofInput,
        purpose: 'session',
        userId: user.id,
        deviceId,
        pub: { x: dev.key.x, y: dev.key.y },
        keyId: dev.key.key_id,
        nowMs,
      });
    }
    const gate = gateDevice({
      policy,
      version: addinVersion,
      device: toGateDevice(dev),
      proofSent,
      proof,
      purpose: 'session',
    });
    if (!gate.ok) {
      await logSecurityEvent(db, {
        event: proof === 'invalid' ? 'proof_failed' : dev ? 'license_denied' : 'unknown_device',
        userId: user.id,
        deviceRowId: dev?.id ?? null,
        deviceId,
        detail: `session:${gate.code}`,
        addinVersion,
        ip,
      });
      return deny(c, gate.code);
    }
    const lastOk = dev?.last_result === null || (dev?.last_result ?? '').startsWith('ok_');
    if (!dev?.key || !lastOk) {
      const code: DenyCode = dev?.last_result && !dev.last_result.startsWith('ok_') && isDenyCode(dev.last_result)
        ? dev.last_result
        : 'NOT_WORK_PC';
      return deny(c, code);
    }
    await db
      .prepare(`UPDATE revit_device_keys SET last_proof_at = datetime('now') WHERE device_row_id = ?`)
      .bind(dev.id)
      .run();
    const tokens = await mintDeviceTokens(c.env.JWT_SECRET, {
      userId: user.id,
      role: user.role as UserRole,
      deviceId,
      keyId: dev.key.key_id,
    });
    return c.json({ ok: true, ...tokens });
  } catch (err) {
    console.error('[revit-device] session алдаа', err);
    return c.json({ ok: false, code: 'SECURITY_CHECK_FAILED', error: SECURITY_CHECK_FAILED_MESSAGE }, 503);
  }
});

function isDenyCode(v: string): v is DenyCode {
  return Object.prototype.hasOwnProperty.call(DENY_MESSAGES, v);
}

export default revitDevice;
