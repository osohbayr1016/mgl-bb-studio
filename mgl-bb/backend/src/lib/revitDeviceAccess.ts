/**
 * Revit add-in — ТӨХӨӨРӨМЖИЙН НЭВТРЭХ ЭРХИЙН ШИЙДВЭР (migration 0375) — ЦЭВЭР.
 *
 * `decideLicense` (revitLicense.ts) нь «ажилтан идэвхтэй юу, ажлын компьютер юу»
 * гэсэн техник хангамжийн тулгалтыг шийддэг.  Энд тэрнээс ӨМНӨ ажиллах хаалтууд:
 * яаралтай унтраалга → хувилбарын бодлого → төхөөрөмжийн төлөв → түлхүүр / proof.
 * Дараалал ЗОРИУДААР энэ: хамгийн хямд, хамгийн ерөнхий татгалзал эхэлж, мөн
 * хэрэглэгчид «хувилбар хуучирсан» гэх мэт ҮР ДҮНТЭЙ мессежийг өгнө.
 *
 * ⚠️ ТҮЛХҮҮРТЭЙ ТӨХӨӨРӨМЖ ҮРГЭЛЖ PROOF ШААРДНА (`policy.deviceKeyPolicy`-оос үл хамаарна).
 *    Эс бөгөөс халдагч proof-ыг орхиод «хуучин» замаар орно (downgrade).
 */
import type { DenyCode } from './revitLicense';
import { versionVerdict, type RevitPolicy } from './revitPolicy';

export const DEVICE_STATUSES_X = ['auto', 'approved', 'blocked', 'pending', 'revoked'] as const;
export type DeviceStatusX = (typeof DEVICE_STATUSES_X)[number];

export function isDeviceStatusX(v: unknown): v is DeviceStatusX {
  return typeof v === 'string' && (DEVICE_STATUSES_X as readonly string[]).includes(v);
}

export type ProofState = 'valid' | 'invalid' | 'missing';

export interface GateDevice {
  status: DeviceStatusX | null;
  hasKey: boolean;
  securityLevel: string | null;
}

export interface GateArgs {
  policy: RevitPolicy;
  version: string | null;
  device: GateDevice | null;
  /** Add-in challenge-ийн proof илгээсэн үү (түлхүүргүй мөрөнд proof ирвэл → бүртгэх шаардлагатай). */
  proofSent: boolean;
  proof: ProofState;
  purpose: 'license' | 'session';
  /**
   * Энэ ажилтан өмнө нь түлхүүртэй төхөөрөмж бүртгүүлсэн (эсвэл admin цуцалсан төхөөрөмжтэй).  Тэгвэл
   * ӨӨР (шинэ, санамсаргүй) device_id-аар түлхүүргүй хуучин зам руу орох боломжгүй — халдагч токен барьж,
   * хуурамч device_id + hw илгээгээд downgrade хийхийг хаана.
   */
  userRequiresKey?: boolean;
}

export type GateVerdict =
  | { ok: true; mode: 'key' | 'legacy' }
  | { ok: false; code: DenyCode };

export function gateDevice(a: GateArgs): GateVerdict {
  if (a.policy.disabled) return { ok: false, code: 'REVIT_LICENSES_DISABLED' };

  const v = versionVerdict(a.policy, a.version);
  if (v === 'blocked') return { ok: false, code: 'ADDIN_VERSION_BLOCKED' };
  if (v === 'update_required') return { ok: false, code: 'ADDIN_UPDATE_REQUIRED' };

  const st = a.device?.status ?? null;
  if (st === 'blocked') return { ok: false, code: 'DEVICE_BLOCKED' };
  if (st === 'revoked') return { ok: false, code: 'DEVICE_REVOKED' };
  if (st === 'pending') return { ok: false, code: 'DEVICE_PENDING' };

  if (a.device?.hasKey) {
    if (a.proof === 'missing') return { ok: false, code: 'DEVICE_PROOF_REQUIRED' };
    if (a.proof === 'invalid') return { ok: false, code: 'DEVICE_PROOF_INVALID' };
    if (a.policy.requireTpm && a.device.securityLevel !== 'tpm') {
      return { ok: false, code: 'DEVICE_KEY_WEAK' };
    }
    return { ok: true, mode: 'key' };
  }

  // Түлхүүргүй мөр / мөр байхгүй.
  if (a.purpose === 'session') return { ok: false, code: 'DEVICE_NOT_ENROLLED' };
  // Add-in өөрийн түлхүүрээр proof илгээсэн ч сервер түлхүүрийг мэдэхгүй (цуцлагдсан /
  // бүртгэгдээгүй) → дахин бүртгүүлнэ.
  if (a.proofSent) return { ok: false, code: 'DEVICE_NOT_ENROLLED' };
  if (a.userRequiresKey) return { ok: false, code: 'DEVICE_KEY_REQUIRED' };
  if (a.policy.deviceKeyPolicy === 'required') return { ok: false, code: 'DEVICE_KEY_REQUIRED' };
  return { ok: true, mode: 'legacy' };
}

/**
 * Шинэ түлхүүр бүртгэхэд төлөв.  `account` горимд (өгөгдмөл, 2026-10-02) идэвхтэй ажилтны бүртгэлээр нэвтэрсэн бол
 * `auto`; `auto` горимд зөвхөн ажлын компьютертэй таарвал.  Admin-ы тохируулсан хатуу бодлого (TPM шаардлага, бүх
 * төхөөрөмжид admin зөвшөөрөл, төхөөрөмжийн хязгаар) аль ч горимд `pending`.  Ямар ч тохиолдолд админ
 * зөвшөөрөлгүйгээр ШИНЭ төхөөрөмж `approved` болохгүй (`auto` = автомат).
 */
export function enrollStatus(args: {
  hardwareMatches: boolean;
  activeKeyedDevices: number;
  /** null = хязгааргүй. */
  maxDevices: number | null;
  securityLevel: string;
  requireTpm: boolean;
  /** `revit.enroll_approval = admin`: автомат зөвшөөрөл ҮГҮЙ — бүх шинэ төхөөрөмж admin хүлээнэ. */
  adminApprovalRequired?: boolean;
  /** `revit.enroll_approval = account`: ажлын компьютерын тулгалт шаардахгүй. */
  accountMode?: boolean;
}): { status: 'auto' | 'pending'; reason: 'ok' | 'not_work_pc' | 'limit' | 'weak' | 'admin_required' } {
  if (args.requireTpm && args.securityLevel !== 'tpm') return { status: 'pending', reason: 'weak' };
  if (args.adminApprovalRequired) return { status: 'pending', reason: 'admin_required' };
  if (args.maxDevices !== null && args.activeKeyedDevices >= args.maxDevices) return { status: 'pending', reason: 'limit' };
  if (!args.accountMode && !args.hardwareMatches) return { status: 'pending', reason: 'not_work_pc' };
  return { status: 'auto', reason: 'ok' };
}
