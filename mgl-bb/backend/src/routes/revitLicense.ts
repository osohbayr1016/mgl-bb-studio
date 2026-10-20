import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables, UserRole } from '../types';
import {
  DENY_MESSAGES,
  LEASE_REFRESH_SEC,
  LEASE_TTL_SEC,
  buildLeasePayload,
  decideLicense,
  hwSummary,
  isDeviceId,
  normalizeNativeProfile,
  parseAttendanceHwJson,
  parseSigningKey,
  profileMatches,
  signLease,
  type LicenseVerdict,
  type NativeProfile,
} from '../lib/revitLicense';
import { DEVICE_STATUSES_X, gateDevice, isDeviceStatusX, type ProofState } from '../lib/revitDeviceAccess';
import { loadPolicy, POLICY_KEYS, parsePolicy, type RevitPolicy } from '../lib/revitPolicy';
import {
  MAX_DEVICE_ROWS_PER_USER,
  SECURITY_CHECK_FAILED_MESSAGE,
  ageMsOf,
  checkProof,
  loadDevice,
  logSecurityEvent,
  mintDeviceTokens,
  userRequiresKey,
  strictNetworkVerdict,
  toGateDevice,
  type DeviceRecord,
  type ProofInput,
} from '../lib/revitDeviceService';
import { invalidateRevitSessionCache } from '../lib/revitSessionCheck';
import { getClientIp } from '../lib/officeNetwork';

/**
 * Revit add-in-ий ЛИЦЕНЗ (migration 0374) — `/api/revit`-ийн ГУРАВ ДАХЬ mount.
 * Зөвхөн `/license*` замууд; `revit.ts`, `revitTracking.ts`-тэй давхцахгүй.
 *
 * ⚠️ `use('*')` ЭНД БАЙХГҮЙ, ЗОРИУДААР: дэд router-ийн `use('*')` нь mount хийсний
 *    дараа `/api/revit/*`-ийн БҮХ хүсэлтэд (бусад хоёр router-ийн замуудад ч)
 *    ажилладаг.  Хаалт бүр зам дээрээ.
 *
 * ⚠️ ROLE-ийг DB-ээс уншина, JWT-ээс биш (`decideLicense`): add-in-ий токен 365
 *    хоногийн настай тул түүний role хуучирсан байж болно.  `worker` ба `client`
 *    нь `/api/revit` угтвараар аль хэдийн 403 (workerScope / clientScope).
 */
const revitLicense = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function parseNativeJson(raw: string | null): NativeProfile | null {
  if (!raw) return null;
  try {
    return normalizeNativeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Идэвхтэй ирцийн төхөөрөмжүүд (0328).  Хүснэгт байхгүй орчинд — хоосон. */
async function loadAttendanceProfiles(
  db: D1Database,
  userId: number,
): Promise<Array<{ id: number; hw_json: string | null; last_seen_at: string | null }>> {
  try {
    const { results } = await db
      .prepare(
        `SELECT id, hw_json, last_seen_at FROM attendance_devices
          WHERE user_id = ? AND revoked_at IS NULL
          ORDER BY last_seen_at DESC, id DESC`,
      )
      .bind(userId)
      .all<{ id: number; hw_json: string | null; last_seen_at: string | null }>();
    return results ?? [];
  } catch (err) {
    console.warn('[revit-license] attendance_devices уншиж чадсангүй', err);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/revit/license — add-in-ий лиценз авах / шинэчлэх          */
/* ------------------------------------------------------------------ */
//
// Бие: { device_id: sha256hex, hw: {gpus[], cores, screens[]},
//        addin_version?, revit_year?, proof?: { challenge_id, signature } }
// 200 → { ok, lease, expires_at, refresh_after, via, sec, user,
//         session?: { token, expires_at }, credential? }   (session/credential: түлхүүртэй төхөөрөмж)
// 403 → { ok:false, code, error }  (DENY_MESSAGES — add-in шууд харуулна)
// 503 → { code:'LICENSE_NOT_CONFIGURED' | 'SECURITY_CHECK_FAILED' } — secret / аюулгүй
//       байдлын шалгалт хийгдээгүй; гарын үсэггүй лиценз ХЭЗЭЭ Ч олгохгүй.
//
// ⚠️ FAIL-CLOSED: бодлого, хэрэглэгч, төхөөрөмж, сүлжээний шалгалтын АЛЬ НЭГ нь
//    D1 алдаа өгвөл лиценз олгохгүй (503).  Global `officeAccessGuard` fail-open
//    байдаг нь зориуд — энэ route тийм биш.
revitLicense.post('/license', async (c) => {
  const actor = c.get('user');
  const key = parseSigningKey(c.env.REVIT_LICENSE_KEY);
  if (!key) {
    console.error('[revit-license] REVIT_LICENSE_KEY тохируулаагүй / гэмтсэн');
    return c.json(
      {
        ok: false,
        code: 'LICENSE_NOT_CONFIGURED',
        error: 'Лицензийн сервер тохируулагдаагүй байна. Admin-д хандана уу.',
      },
      503,
    );
  }

  let body: {
    device_id?: unknown;
    hw?: unknown;
    addin_version?: unknown;
    revit_year?: unknown;
    proof?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, code: 'BAD_REQUEST', error: 'JSON бие шаардлагатай' }, 400);
  }
  if (!isDeviceId(body.device_id)) {
    return c.json({ ok: false, code: 'BAD_REQUEST', error: 'device_id (sha256 hex) шаардлагатай' }, 400);
  }
  const deviceId = body.device_id;
  const native = normalizeNativeProfile(body.hw);
  const addinVersion = str(body.addin_version, 32);
  const revitYear = str(body.revit_year, 8);
  const proofSent = body.proof !== undefined && body.proof !== null;
  const ip = getClientIp(c);
  const db = c.env.DB;
  const nowMs = Date.now();

  let policy: RevitPolicy | null;
  let user: { id: number; username: string | null; full_name: string | null; role: string; status: string | null } | null;
  let dev: DeviceRecord | null;
  let attendance: Awaited<ReturnType<typeof loadAttendanceProfiles>>;
  let requiresKey = false;
  try {
    policy = await loadPolicy(db);
    if (!policy) throw new Error('policy unavailable');
    user = await db
      .prepare('SELECT id, username, full_name, role, status FROM users WHERE id = ?')
      .bind(actor.sub)
      .first();
    dev = user ? await loadDevice(db, user.id, deviceId) : null;
    attendance = user ? await loadAttendanceProfiles(db, user.id) : [];
    // Түлхүүртэй төхөөрөмж бүртгүүлж байсан ажилтан өөр (хуурамч) device_id-аар хуучин зам руу орж чадахгүй.
    requiresKey = user && !dev?.key ? await userRequiresKey(db, user.id) : false;
  } catch (err) {
    console.error('[revit-license] аюулгүй байдлын шалгалт унав', err);
    await logSecurityEvent(db, { event: 'security_check_failed', userId: actor.sub, deviceId, addinVersion, ip });
    return c.json({ ok: false, code: 'SECURITY_CHECK_FAILED', error: SECURITY_CHECK_FAILED_MESSAGE }, 503);
  }
  if (!user) {
    return c.json({ ok: false, code: 'USER_INACTIVE', error: DENY_MESSAGES.USER_INACTIVE }, 403);
  }

  const network = await strictNetworkVerdict(c.env, { db, requestUrl: c.req.url, clientIp: ip, userId: user.id });
  if (!network.ok) {
    if (network.status === 503) {
      await logSecurityEvent(db, { event: 'security_check_failed', userId: user.id, deviceId, addinVersion, ip });
    }
    return c.json({ ok: false, code: network.code, error: network.error }, network.status);
  }

  // ── төхөөрөмжийн proof (түлхүүртэй мөрөнд) ───────────────────────────
  let proof: ProofState = 'missing';
  if (dev?.key && proofSent) {
    try {
      proof = await checkProof(db, {
        proof: body.proof as ProofInput,
        purpose: 'license',
        userId: user.id,
        deviceId,
        pub: { x: dev.key.x, y: dev.key.y },
        keyId: dev.key.key_id,
        nowMs,
      });
    } catch (err) {
      console.error('[revit-license] proof шалгаж чадсангүй', err);
      return c.json({ ok: false, code: 'SECURITY_CHECK_FAILED', error: SECURITY_CHECK_FAILED_MESSAGE }, 503);
    }
  }

  const gate = gateDevice({
    policy,
    version: addinVersion,
    device: toGateDevice(dev),
    proofSent,
    proof,
    purpose: 'license',
    userRequiresKey: requiresKey,
  });

  let verdict: LicenseVerdict;
  let mode: 'key' | 'legacy' = 'legacy';
  if (!gate.ok) {
    verdict = { ok: false, code: gate.code };
  } else {
    mode = gate.mode;
    const status = dev?.status;
    verdict = decideLicense({
      user: { status: user.status, role: user.role },
      deviceStatus: status === 'auto' || status === 'approved' || status === 'blocked' ? status : null,
      native,
      attendance,
      boundAttendanceDeviceId: dev?.bound_attendance_device_id ?? null,
      accountMode: policy.enrollApproval === 'account',
    });
  }

  const result = verdict.ok ? `ok_${verdict.via}` : verdict.code;
  // Оролдлого БҮР бүртгэгдэнэ (татгалзсан ч) — админ «энэ компьютер яагаад
  // ажиллахгүй байна» гэдгийг, мөн танихгүй компьютероос оролдсоныг эндээс харна.
  // Шинэ мөрийн тоог ажилтан тутамд хязгаарлана (хуурамч device_id-аар хүснэгт дүүргэхээс).
  try {
    const rowCount = dev
      ? 0
      : ((await db
          .prepare('SELECT COUNT(*) AS n FROM revit_license_devices WHERE user_id = ?')
          .bind(user.id)
          .first<{ n: number }>())?.n ?? 0);
    // ⚠️ Түлхүүртэй төхөөрөмжийн мөрийг ЗӨВХӨН хүчинтэй proof-той үед шинэчилнэ: токен барьсан хүн (proof-гүй /
    //    буруу proof-той) жинхэнэ ажилтны төхөөрөмжийн `last_result` / `hw_json`-г бохирдуулж session-ийг
    //    унагаж чадахгүй.  Оролдлого нь үйл явдлын бүртгэлд л үлдэнэ.
    const mayWriteRow = !dev?.key || proof === 'valid';
    if (mayWriteRow && (dev || rowCount < MAX_DEVICE_ROWS_PER_USER)) {
      await db
        .prepare(
          `INSERT INTO revit_license_devices
             (user_id, device_id, hw_json, status, last_result, bound_attendance_device_id,
              addin_version, revit_year, first_seen_at, last_seen_at, last_lease_at)
           VALUES (?, ?, ?, 'auto', ?, ?, ?, ?, datetime('now'), datetime('now'),
                   CASE WHEN ? = 1 THEN datetime('now') END)
           ON CONFLICT (user_id, device_id) DO UPDATE SET
             hw_json = COALESCE(excluded.hw_json, revit_license_devices.hw_json),
             last_result = excluded.last_result,
             bound_attendance_device_id = COALESCE(excluded.bound_attendance_device_id,
                                                   revit_license_devices.bound_attendance_device_id),
             addin_version = COALESCE(excluded.addin_version, revit_license_devices.addin_version),
             revit_year = COALESCE(excluded.revit_year, revit_license_devices.revit_year),
             last_seen_at = datetime('now'),
             last_lease_at = CASE WHEN ? = 1 THEN datetime('now')
                                  ELSE revit_license_devices.last_lease_at END`,
        )
        .bind(
          user.id,
          deviceId,
          native ? JSON.stringify(native) : null,
          result,
          verdict.ok ? verdict.attendanceDeviceId : null,
          addinVersion,
          revitYear,
          verdict.ok ? 1 : 0,
          verdict.ok ? 1 : 0,
        )
        .run();
    }
    if (verdict.ok && proof === 'valid' && dev?.key) {
      await db
        .prepare(`UPDATE revit_device_keys SET last_proof_at = datetime('now') WHERE device_row_id = ?`)
        .bind(dev.id)
        .run();
    }
  } catch (err) {
    // Бүртгэл бичигдэхгүй бол лиценз ОЛГОХГҮЙ (admin харагдах байдал + proof-ийн тэмдэглэл алдагдана).
    console.error('[revit-license] төхөөрөмжийн мөр бичиж чадсангүй', err);
    return c.json({ ok: false, code: 'SECURITY_CHECK_FAILED', error: SECURITY_CHECK_FAILED_MESSAGE }, 503);
  }

  const evBase = { userId: user.id, deviceRowId: dev?.id ?? null, deviceId, addinVersion, ip };
  if (!verdict.ok) {
    console.warn(`[revit-license] татгалзав sub=${user.id} code=${verdict.code}`);
    const code = verdict.code;
    await logSecurityEvent(db, {
      ...evBase,
      event:
        proof === 'invalid' || code === 'DEVICE_PROOF_INVALID'
          ? 'proof_failed'
          : code === 'DEVICE_BLOCKED' || code === 'DEVICE_REVOKED'
            ? 'blocked_device_attempt'
            : code === 'ADDIN_VERSION_BLOCKED' || code === 'ADDIN_UPDATE_REQUIRED'
              ? 'version_blocked'
              : code === 'USER_INACTIVE'
                ? 'user_inactive'
                : !dev
                  ? 'unknown_device'
                  : 'license_denied',
      detail: code,
    });
    return c.json({ ok: false, code, error: DENY_MESSAGES[code] }, 403);
  }

  const sec = mode === 'key' ? ((dev?.key?.security_level as 'tpm' | 'software') ?? 'software') : 'legacy';
  const nowSec = Math.floor(nowMs / 1000);
  const payload = buildLeasePayload({
    kid: key.kid,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
    deviceId,
    via: verdict.via,
    nowSec,
    sec,
    dk: mode === 'key' ? dev?.key?.key_id : null,
  });
  const lease = await signLease(payload, key);

  // Ердийн (цаг тутмын) шинэчлэлт бүрийг бүртгэхгүй — 12 цагт нэг (хязгаарлагдмал аудит).
  const prev = dev ? ageMsOf(dev.last_lease_at, nowMs) : null;
  if (prev === null || prev > 12 * 3600_000) {
    await logSecurityEvent(db, { ...evBase, event: mode === 'key' ? 'license_issued' : 'legacy_license', detail: sec });
  }

  const out: Record<string, unknown> = {
    ok: true,
    lease,
    via: verdict.via,
    sec,
    expires_at: new Date(payload.exp * 1000).toISOString(),
    refresh_after: new Date(payload.rfa * 1000).toISOString(),
    ttl_sec: LEASE_TTL_SEC,
    refresh_sec: LEASE_REFRESH_SEC,
    user: { id: user.id, name: payload.nm, role: user.role },
  };
  if (mode === 'key' && dev?.key) {
    Object.assign(out, await mintDeviceTokens(c.env.JWT_SECRET, { userId: user.id, role: user.role as UserRole, deviceId, keyId: dev.key.key_id }));
  }
  return c.json(out);
});

/* ------------------------------------------------------------------ */
/*  Админ — ажилтны add-in-ий компьютерууд                              */
/* ------------------------------------------------------------------ */

type DeviceRow = {
  id: number;
  device_id: string;
  hw_json: string | null;
  status: string;
  last_result: string | null;
  bound_attendance_device_id: number | null;
  addin_version: string | null;
  revit_year: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_lease_at: string | null;
  decided_by: number | null;
  decided_at: string | null;
  decided_by_name: string | null;
  key_id: string | null;
  security_level: string | null;
  enrolled_at: string | null;
  last_proof_at: string | null;
};

// GET /api/revit/license/admin/users/:userId/devices — Хэрэглэгчид → төхөөрөмжийн
// цонхонд.  Компьютер бүрийн ТЕХНИК шинж (нэр БИШ — эзэн 2026-10-01), ирцийн
// ажлын компьютертэй ОДОО таарч байгаа эсэх, түлхүүрийн хамгаалалт (TPM / програм),
// admin-ий шийдвэр.  MachineGuid, Windows SID, түлхүүр өөрөө ХЭЗЭЭ Ч гарахгүй —
// зөвхөн хэшийн эхний 8 тэмдэгт.
revitLicense.get('/license/admin/users/:userId/devices', requireAdmin(), async (c) => {
  const userId = Number(c.req.param('userId'));
  if (!Number.isSafeInteger(userId) || userId <= 0) return c.json({ error: 'Буруу id' }, 400);
  const db = c.env.DB;
  const { results } = await db
    .prepare(
      `SELECT d.id, d.device_id, d.hw_json, d.status, d.last_result,
              d.bound_attendance_device_id, d.addin_version, d.revit_year,
              d.first_seen_at, d.last_seen_at, d.last_lease_at, d.decided_by, d.decided_at,
              COALESCE(u.full_name, u.username) AS decided_by_name,
              k.key_id, k.security_level, k.enrolled_at, k.last_proof_at
         FROM revit_license_devices d
         LEFT JOIN users u ON u.id = d.decided_by
         LEFT JOIN revit_device_keys k ON k.device_row_id = d.id
        WHERE d.user_id = ?
        ORDER BY d.last_seen_at DESC, d.id DESC
        LIMIT 30`,
    )
    .bind(userId)
    .all<DeviceRow>();
  const attendance = await loadAttendanceProfiles(db, userId);
  const workProfiles = attendance
    .map((a) => ({ id: a.id, p: parseAttendanceHwJson(a.hw_json), last_seen_at: a.last_seen_at }))
    .filter((a) => a.p !== null);
  const policy = (await loadPolicy(db)) ?? parsePolicy([]);

  const devices = (results ?? []).map((r) => {
    const native = parseNativeJson(r.hw_json);
    return {
      id: r.id,
      /** Нэрийн оронд — ижил компьютерыг жагсаалтад таних богино код. */
      short_id: r.device_id.slice(0, 8),
      hw: hwSummary(native),
      status: r.status,
      last_result: r.last_result,
      matches_work_pc: workProfiles.some((w) => profileMatches(w.p, native)),
      addin_version: r.addin_version,
      revit_year: r.revit_year,
      first_seen_at: r.first_seen_at,
      last_seen_at: r.last_seen_at,
      last_lease_at: r.last_lease_at,
      decided_by_name: r.decided_by_name,
      decided_at: r.decided_at,
      /** tpm | software | legacy (түлхүүргүй хуучин төхөөрөмж). */
      security_level: r.key_id ? (r.security_level ?? 'software') : 'legacy',
      key_short_id: r.key_id ? r.key_id.slice(0, 8) : null,
      enrolled_at: r.enrolled_at,
      last_proof_at: r.last_proof_at,
    };
  });
  const work_pcs = workProfiles.map((w) => ({
    id: w.id,
    hw: [w.p?.gpu, w.p?.cores ? `${w.p.cores} цөм` : null, w.p?.screen]
      .filter(Boolean)
      .join(' · '),
    last_seen_at: w.last_seen_at,
  }));
  return c.json({
    devices,
    work_pcs,
    lease_ttl_hours: LEASE_TTL_SEC / 3600,
    max_devices: policy.maxDevices,
    device_key_policy: policy.deviceKeyPolicy,
    enroll_approval: policy.enrollApproval,
  });
});

// PATCH /api/revit/license/admin/devices/:id
//   { status: 'auto'|'approved'|'blocked'|'pending'|'revoked', reason? }
//   auto     — буцааж автомат (техник тулгалт) горимд
//   approved — гараар зөвшөөрөх (тулгалт таараагүй ч; төхөөрөмжийн хязгаараас ГАДУУР)
//   blocked  — хаах (түлхүүр хэвээр, оролдлого бүртгэгдэнэ)
//   pending  — зөвшөөрөл хүлээх төлөв рүү
//   revoked  — цуцлах: бүртгэлтэй түлхүүр УСТНА → дахин ашиглахын тулд шинэ түлхүүрээр
//              бүртгүүлэх (эхлээд pending болгоно).  Төхөөрөмж алдагдсан / солигдсон үед.
// ⚠️ Хаалт нь хамгийн удаандаа ДАРААГИЙН шинэчлэлтээр (≤ 1 цаг; session токен ≤ 60 секундэд)
//    хүчин төгөлдөр болно; интернэтгүй PC-д олгосон лиценз 12 цагт дуусна.
revitLicense.patch('/license/admin/devices/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Буруу id' }, 400);
  let body: { status?: unknown; reason?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON бие шаардлагатай' }, 400);
  }
  const status = typeof body.status === 'string' ? body.status : '';
  if (!isDeviceStatusX(status)) {
    return c.json({ error: `status: ${DEVICE_STATUSES_X.join(' | ')}` }, 400);
  }
  const reason = str(body.reason, 200);
  const actor = c.get('user');
  const db = c.env.DB;
  const row = await db
    .prepare('SELECT user_id, device_id FROM revit_license_devices WHERE id = ?')
    .bind(id)
    .first<{ user_id: number; device_id: string }>();
  if (!row) return c.json({ error: 'Олдсонгүй' }, 404);

  const stmts = [
    db
      .prepare(
        `UPDATE revit_license_devices
            SET status = ?, decided_by = ?, decided_at = datetime('now'),
                last_result = CASE ? WHEN 'blocked' THEN 'DEVICE_BLOCKED'
                                     WHEN 'revoked' THEN 'DEVICE_REVOKED'
                                     WHEN 'pending' THEN 'DEVICE_PENDING'
                                     ELSE NULL END
          WHERE id = ?`,
      )
      .bind(status, actor.sub, status, id),
  ];
  // Цуцлахад бүртгэлтэй түлхүүрийг УСТГАНА — төхөөрөмж дахин ашиглахын тулд шинэ
  // түлхүүр бүртгүүлэх ёстой (хуучин түлхүүрийн proof хэзээ ч дахин хүчинтэй болохгүй).
  if (status === 'revoked') {
    // Tombstone ЭХЛЭЭД: цуцлагдсан түлхүүр (алдагдсан / хулгайлагдсан) дахин ЯМАР Ч төхөөрөмж дээр бүртгэгдэхгүй.
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO revit_revoked_keys (key_id, revoked_by, reason)
           SELECT key_id, ?, ? FROM revit_device_keys WHERE device_row_id = ?`,
        )
        .bind(actor.sub, reason ?? 'revoked', id),
    );
    stmts.push(db.prepare('DELETE FROM revit_device_keys WHERE device_row_id = ?').bind(id));
  }
  await db.batch(stmts);
  invalidateRevitSessionCache();
  await logSecurityEvent(db, {
    event:
      status === 'approved'
        ? 'device_approved'
        : status === 'blocked'
          ? 'device_blocked'
          : status === 'revoked'
            ? 'device_revoked'
            : 'device_reset',
    userId: row.user_id,
    deviceRowId: id,
    deviceId: row.device_id,
    detail: `by=${actor.sub}${reason ? ` reason=${reason}` : ''}`,
  });
  return c.json({ ok: true, id, status });
});

// DELETE /api/revit/license/admin/devices/:id — мөрийг ТҮЛХҮҮРТЭЙ нь устгана (дараагийн
// оролдлогоор дахин «auto» мөр үүснэ).  Хаахыг хүсвэл PATCH status='blocked'.
revitLicense.delete('/license/admin/devices/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Буруу id' }, 400);
  const db = c.env.DB;
  // Түлхүүрийг ЭХЛЭЭД tombstone-д (устгасан мөрийн түлхүүр дахин бүртгэгдэхгүй), дараа нь түлхүүр + мөр НЭГ batch-д.
  const exists = await db.prepare('SELECT 1 AS x FROM revit_license_devices WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'Олдсонгүй' }, 404);
  const actor = c.get('user');
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO revit_revoked_keys (key_id, revoked_by, reason)
         SELECT key_id, ?, 'row_deleted' FROM revit_device_keys WHERE device_row_id = ?`,
      )
      .bind(actor.sub, id),
    db.prepare('DELETE FROM revit_device_keys WHERE device_row_id = ?').bind(id),
    db.prepare('DELETE FROM revit_license_devices WHERE id = ?').bind(id),
  ]);
  invalidateRevitSessionCache();
  return c.json({ ok: true, id });
});

/* ------------------------------------------------------------------ */
/*  Админ — аюулгүй байдлын үйл явдал, бодлого                          */
/* ------------------------------------------------------------------ */

// GET /api/revit/license/admin/events?user_id=&limit=  — «Яагаад энэ инженер add-in
// ашиглаж чадахгүй байна вэ?», «танихгүй компьютероос оролдсон уу?» гэсэн асуултын хариу.
revitLicense.get('/license/admin/events', requireAdmin(), async (c) => {
  const userId = Number(c.req.query('user_id'));
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200);
  const hasUser = Number.isSafeInteger(userId) && userId > 0;
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.at, e.event, e.user_id, e.device_short, e.detail, e.addin_version, e.ip,
            COALESCE(u.full_name, u.username) AS user_name
       FROM revit_security_events e
       LEFT JOIN users u ON u.id = e.user_id
      ${hasUser ? 'WHERE e.user_id = ?' : ''}
      ORDER BY e.id DESC
      LIMIT ${limit}`,
  )
    .bind(...(hasUser ? [userId] : []))
    .all();
  return c.json({ events: results ?? [] });
});

// GET /api/revit/license/admin/policy — одоогийн бодлого.
revitLicense.get('/license/admin/policy', requireAdmin(), async (c) => {
  const policy = await loadPolicy(c.env.DB);
  if (!policy) return c.json({ error: SECURITY_CHECK_FAILED_MESSAGE }, 503);
  return c.json({ policy });
});

const VERSION_RE = /^\d+(\.\d+){0,3}$/;

// PUT /api/revit/license/admin/policy — хэсэгчилсэн шинэчлэл:
//   { disabled?, min_version?, blocked_versions?, device_key_policy?, require_tpm?,
//     max_devices?, legacy_token_policy?, enroll_approval?, session_scope? }
// `disabled:true` = яаралтай унтраалга (шинэ лиценз / session олгохгүй; session токен ≤ 60 с).
revitLicense.put('/license/admin/policy', requireAdmin(), async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'JSON бие шаардлагатай' }, 400);
  }
  const updates: Array<[string, string]> = [];
  const bad = (m: string) => c.json({ error: m }, 400);

  if ('disabled' in body) {
    if (typeof body.disabled !== 'boolean') return bad('disabled: boolean');
    updates.push(['revit.disabled', body.disabled ? '1' : '0']);
  }
  if ('require_tpm' in body) {
    if (typeof body.require_tpm !== 'boolean') return bad('require_tpm: boolean');
    updates.push(['revit.require_tpm', body.require_tpm ? '1' : '0']);
  }
  if ('min_version' in body) {
    const v = body.min_version;
    if (v !== null && v !== '' && !(typeof v === 'string' && VERSION_RE.test(v))) return bad('min_version: 1.10.0 хэлбэр');
    updates.push(['revit.min_version', typeof v === 'string' ? v : '']);
  }
  if ('blocked_versions' in body) {
    const v = body.blocked_versions;
    if (!Array.isArray(v) || v.length > 50 || !v.every((x) => typeof x === 'string' && VERSION_RE.test(x))) {
      return bad('blocked_versions: [«1.9.0», …]');
    }
    updates.push(['revit.blocked_versions', v.join(',')]);
  }
  if ('device_key_policy' in body) {
    if (body.device_key_policy !== 'optional' && body.device_key_policy !== 'required') {
      return bad('device_key_policy: optional | required');
    }
    updates.push(['revit.device_key_policy', body.device_key_policy]);
  }
  if ('legacy_token_policy' in body) {
    if (!['allow', 'log', 'deny'].includes(String(body.legacy_token_policy))) {
      return bad('legacy_token_policy: allow | log | deny');
    }
    updates.push(['revit.legacy_token_policy', String(body.legacy_token_policy)]);
  }
  if ('session_scope' in body) {
    if (body.session_scope !== 'enforce' && body.session_scope !== 'open') return bad('session_scope: enforce | open');
    updates.push(['revit.session_scope', body.session_scope]);
  }
  if ('enroll_approval' in body) {
    if (body.enroll_approval !== 'account' && body.enroll_approval !== 'auto' && body.enroll_approval !== 'admin') {
      return bad('enroll_approval: account | auto | admin');
    }
    updates.push(['revit.enroll_approval', body.enroll_approval]);
  }
  if ('max_devices' in body) {
    // null / 0 = хязгааргүй (өгөгдмөл).
    const n = body.max_devices === null ? 0 : body.max_devices;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 20) return bad('max_devices: 1–20, эсвэл 0/null = хязгааргүй');
    updates.push(['revit.max_devices', String(n)]);
  }
  if (updates.length === 0) return bad('Өөрчлөх талбар алга');

  const actor = c.get('user');
  const db = c.env.DB;
  await db.batch(
    updates.map(([k, v]) =>
      db
        .prepare(
          `INSERT INTO app_settings (key, value, updated_by) VALUES (?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by,
                                           updated_at = datetime('now')`,
        )
        .bind(k, v, actor.sub),
    ),
  );
  invalidateRevitSessionCache();
  await logSecurityEvent(db, {
    event: 'policy_changed',
    userId: actor.sub,
    detail: updates.map(([k, v]) => `${k}=${v}`).join(' ').slice(0, 280),
  });
  const policy = await loadPolicy(db);
  return c.json({ ok: true, policy, keys: POLICY_KEYS });
});

export default revitLicense;
