/**
 * Revit add-in-ий АЮУЛГҮЙ БАЙДЛЫН БОДЛОГО — `app_settings` дахь `revit.*` түлхүүрүүд.
 *
 * ЯАГААД СЕРВЕРТ: add-in-ий хувилбар / лицензийн шийдвэр DLL дотор байвал DLL-ийг
 * өөрчилсөн хүн түүнийг тойрно.  Хувилбарын хориг, нэг товчийн «бүх лицензийг
 * зогсоох», төхөөрөмжийн хязгаар зэрэг ӨӨРЧЛӨГДӨХ бодлого нь сервер талд л байна.
 *
 *   revit.disabled             '1' → ШИНЭ лиценз / session олгохгүй (яаралтай унтраалга)
 *   revit.min_version          «1.10.0» — үүнээс доош add-in лиценз авч чадахгүй
 *   revit.blocked_versions     «1.9.0,1.9.2» — тусгайлан хориглосон (эвдэрсэн / алдагдсан) хувилбарууд
 *   revit.device_key_policy    optional (өгөгдмөл, шилжилтийн үе) | required (түлхүүргүй төхөөрөмжид лиценз ҮГҮЙ)
 *   revit.require_tpm          '1' → зөвхөн TPM-д хадгалагдсан түлхүүр хүлээн авна
 *   revit.max_devices          ажилтан тутамд идэвхтэй (auto|approved) төхөөрөмжийн тоо — өгөгдмөл ХЯЗГААРГҮЙ (тохируулаагүй / 0)
 *   revit.session_scope        enforce (өгөгдмөл) — 'revit' session зөвхөн add-in-ий замуудад хүчинтэй | open — бүх /api (яаралтай нөхөн сэргээлт)
 *   revit.enroll_approval      account (өгөгдмөл, 2026-10-02) — идэвхтэй ажилтны бүртгэлээр нэвтэрмэгц шинэ компьютер АВТОМАТ
 *                              зөвшөөрөгдөнө (техник тулгалт, admin-ы зөвшөөрөл шаардахгүй) |
 *                              auto — зөвхөн ирцийн ажлын компьютертэй таарсан компьютер автомат, бусад нь admin хүлээнэ |
 *                              admin — БҮХ шинэ төхөөрөмж admin-ы гараар зөвшөөрөл хүлээнэ (хамгийн хатуу)
 *   revit.legacy_token_policy  allow (өгөгдмөл) | log | deny — 365 хоногийн `purpose:'mcp'` токеныг
 *                              /api/revit/*-д (лиценз/төхөөрөмжийн замаас бусад) хүлээн авах эсэх
 *
 * ЦЭВЭР (D1-ээс уншдаг `loadPolicy`-ийг эс тооцвол) — `revitDeviceAccess.test.ts`.
 */

export type DeviceKeyPolicy = 'optional' | 'required';
export type LegacyTokenPolicy = 'allow' | 'log' | 'deny';
/**
 * 2026-10-02 (эзэн): «бүртгэлээрээ нэвтрэхэд л асуудалгүй ашигладаг байх» — ажлын компьютерын тулгалт
 * ажилтнуудыг «admin-д хандана уу»-д гацааж байсан тул өгөгдмөл нь `account`.  Хуурамч хуулбараас хамгаалах
 * үндсэн давхарга (гарын үсэгтэй лиценз + тухайн компьютерын төхөөрөмжийн түлхүүр) хэвээр.
 */
export type EnrollApproval = 'account' | 'auto' | 'admin';
export type SessionScope = 'enforce' | 'open';

export interface RevitPolicy {
  disabled: boolean;
  minVersion: string | null;
  blockedVersions: string[];
  deviceKeyPolicy: DeviceKeyPolicy;
  requireTpm: boolean;
  /** null = хязгааргүй (өгөгдмөл). */
  maxDevices: number | null;
  legacyTokenPolicy: LegacyTokenPolicy;
  enrollApproval: EnrollApproval;
  sessionScope: SessionScope;
}

export const DEFAULT_POLICY: RevitPolicy = {
  disabled: false,
  minVersion: null,
  blockedVersions: [],
  deviceKeyPolicy: 'optional',
  requireTpm: false,
  maxDevices: null,
  legacyTokenPolicy: 'allow',
  enrollApproval: 'account',
  sessionScope: 'enforce',
};

export const POLICY_KEYS = [
  'revit.disabled',
  'revit.min_version',
  'revit.blocked_versions',
  'revit.device_key_policy',
  'revit.require_tpm',
  'revit.max_devices',
  'revit.legacy_token_policy',
  'revit.enroll_approval',
  'revit.session_scope',
] as const;

export function parsePolicy(rows: ReadonlyArray<{ key: string; value: string }>): RevitPolicy {
  const m = new Map(rows.map((r) => [r.key, (r.value ?? '').trim()]));
  const minVersion = m.get('revit.min_version');
  const maxDevices = Number(m.get('revit.max_devices'));
  const dkp = m.get('revit.device_key_policy');
  const ltp = m.get('revit.legacy_token_policy');
  const ea = m.get('revit.enroll_approval');
  return {
    disabled: m.get('revit.disabled') === '1',
    minVersion: minVersion ? minVersion : null,
    blockedVersions: (m.get('revit.blocked_versions') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    deviceKeyPolicy: dkp === 'required' ? 'required' : 'optional',
    requireTpm: m.get('revit.require_tpm') === '1',
    maxDevices: Number.isInteger(maxDevices) && maxDevices >= 1 && maxDevices <= 20 ? maxDevices : null,
    legacyTokenPolicy: ltp === 'deny' || ltp === 'log' ? ltp : 'allow',
    enrollApproval: ea === 'admin' || ea === 'auto' ? ea : 'account',
    sessionScope: m.get('revit.session_scope') === 'open' ? 'open' : 'enforce',
  };
}

/**
 * Бодлогыг уншина.  D1 алдаа → `null`: дуудагч FAIL-CLOSED (лиценз олгохгүй).
 * `app_settings` мөр огт байхгүй байх нь ХЭВИЙН (өгөгдмөл бодлого).
 */
export async function loadPolicy(db: D1Database): Promise<RevitPolicy | null> {
  try {
    const { results } = await db
      .prepare(`SELECT key, value FROM app_settings WHERE key LIKE 'revit.%'`)
      .all<{ key: string; value: string }>();
    return parsePolicy(results ?? []);
  } catch (err) {
    console.error('[revit-policy] app_settings уншиж чадсангүй', err);
    return null;
  }
}

/** «1.10.4» → [1,10,4].  Тоо биш хэсэг 0. */
export function versionParts(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((p) => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
}

export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export type VersionVerdict = 'ok' | 'update_required' | 'blocked';

/**
 * Хувилбар мэдэгдээгүй (`null`) + `min_version` тохируулсан бол шинэчлэх шаардлагатай:
 * хувилбар хэлэхгүй клиент нь хуучин / өөрчилсөн клиент.
 */
export function versionVerdict(policy: RevitPolicy, version: string | null): VersionVerdict {
  if (version && policy.blockedVersions.some((b) => compareVersions(b, version) === 0)) return 'blocked';
  if (policy.minVersion && (!version || compareVersions(version, policy.minVersion) < 0)) {
    return 'update_required';
  }
  return 'ok';
}
