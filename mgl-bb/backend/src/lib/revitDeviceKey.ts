/**
 * Revit add-in-ий ТӨХӨӨРӨМЖИЙН КРИПТО ТАНИЛТ (migration 0375) — ЦЭВЭР модуль.
 *
 * ЯАГААД device_id ГАНЦААРАА хангалтгүй вэ: `device_id` нь SHA-256(MachineGuid |
 * Windows хэрэглэгч) — энгийн утга.  license.json + settings.json-г хуулсан хүн
 * түүнийг мэдэж, хуурамчаар илгээж чадна.  Хүчтэй хүчин зүйл нь төхөөрөмжийн
 * ХУВИЙН түлхүүр: add-in-ий ECDSA P-256 түлхүүр нь Windows-ийн TPM / CNG дотор
 * (экспортлогдохгүй) байдаг, сервер зөвхөн нийтийн хагасыг мэднэ.  Лиценз /
 * session авах бүрд сервер НЭГ УДААГИЙН challenge өгч, add-in түүнийг гарын
 * үсгээр баталгаажуулна.  DLL, settings, license.json, токеныг хуулсан ч
 * хувийн түлхүүр өөр компьютер руу очдоггүй тул challenge-д хариулж чадахгүй.
 *
 * ГАРЫН ҮСГИЙН ГЭРЭЭ (add-in `Licensing/Core/DeviceProof.cs`-тэй ИХЭР):
 *   message   = UTF-8 «mgl-revit-device-proof|v1|<purpose>|<challenge_id>|<nonce>|
 *                      <user_id>|<device_id>|<key_id>»
 *   signature = ECDSA P-256 + SHA-256, IEEE P1363 (r‖s, 64 байт), base64url
 *   key_id    = SHA-256(X‖Y) hex, X/Y = нийтийн түлхүүрийн 32 байт тус бүр
 * Хөрвүүлсэн (өөрийн зохиосон) криптограф БАЙХГҮЙ — ES256 + тодорхой serialization.
 * `purpose`, `challenge_id`, `nonce`, `user_id`, `device_id` бүгд гарын үсэгт орсон
 * тул нэг зорилгын proof-ыг өөр зорилго / хэрэглэгч / төхөөрөмж дээр дахин ашиглах
 * боломжгүй.
 */
import { b64urlDecode, b64urlEncode } from './revitLicense';

export const PROOF_AUDIENCE = 'mgl-revit-device-proof';
export const PROOF_VERSION = 'v1';
export const PROOF_PURPOSES = ['enroll', 'license', 'session'] as const;
export type ProofPurpose = (typeof PROOF_PURPOSES)[number];
export const SECURITY_LEVELS = ['tpm', 'software'] as const;
export type SecurityLevel = (typeof SECURITY_LEVELS)[number];

/** Challenge-ийн наслалт.  Богино — add-in challenge авсан даруйдаа гарын үсэг зурна. */
export const CHALLENGE_TTL_SEC = 120;

export function isProofPurpose(v: unknown): v is ProofPurpose {
  return typeof v === 'string' && (PROOF_PURPOSES as readonly string[]).includes(v);
}

export function isSecurityLevel(v: unknown): v is SecurityLevel {
  return typeof v === 'string' && (SECURITY_LEVELS as readonly string[]).includes(v);
}

export interface DevicePublicKey {
  /** P-256 X координат, base64url, 32 байт. */
  x: string;
  /** P-256 Y координат, base64url, 32 байт. */
  y: string;
}

function isB64url32(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 42 || v.length > 44 || !/^[A-Za-z0-9_-]+$/.test(v)) return false;
  try {
    return b64urlDecode(v).length === 32;
  } catch {
    return false;
  }
}

/** Хэлбэрийн шалгалт (муруй дээр эсэхийг `verifyProof` / WebCrypto importKey шалгана). */
export function parsePublicKey(input: unknown): DevicePublicKey | null {
  if (!input || typeof input !== 'object') return null;
  const { x, y } = input as { x?: unknown; y?: unknown };
  return isB64url32(x) && isB64url32(y) ? { x, y } : null;
}

/** key_id = SHA-256(X‖Y) hex (64 тэмдэгт). */
export async function keyThumbprint(pub: DevicePublicKey): Promise<string> {
  const x = b64urlDecode(pub.x);
  const y = b64urlDecode(pub.y);
  const buf = new Uint8Array(x.length + y.length);
  buf.set(x, 0);
  buf.set(y, x.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let hex = '';
  for (const b of hash) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export interface ProofMessageArgs {
  purpose: ProofPurpose;
  challengeId: string;
  nonce: string;
  userId: number;
  deviceId: string;
  keyId: string;
}

/** Гарын үсэг зурагдах КАНОН мөр.  Add-in-ий `DeviceProof.Message`-тэй байт-ижил. */
export function proofMessage(a: ProofMessageArgs): string {
  return [
    PROOF_AUDIENCE,
    PROOF_VERSION,
    a.purpose,
    a.challengeId,
    a.nonce,
    String(a.userId),
    a.deviceId,
    a.keyId,
  ].join('|');
}

/** ES256 (P1363) гарын үсгийг нийтийн түлхүүрээр шалгана.  Аливаа алдаа → `false`. */
export async function verifyProofSignature(
  pub: DevicePublicKey,
  message: string,
  signatureB64url: string,
): Promise<boolean> {
  try {
    const sig = b64urlDecode(signatureB64url);
    if (sig.length !== 64) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      sig,
      new TextEncoder().encode(message),
    );
  } catch {
    // Муруй дээр биш цэг, буруу base64 г.м. — хүчингүй гарын үсэг.
    return false;
  }
}

/** Криптографийн санамсаргүй challenge (nonce 32 байт, id 16 байт). */
export function newChallengeMaterial(): { id: string; nonce: string } {
  const idBytes = crypto.getRandomValues(new Uint8Array(16));
  let id = '';
  for (const b of idBytes) id += b.toString(16).padStart(2, '0');
  return { id, nonce: b64urlEncode(crypto.getRandomValues(new Uint8Array(32))) };
}
