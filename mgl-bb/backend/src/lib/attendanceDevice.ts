/**
 * Ирцийн төхөөрөмж таних — нэг ажилтан · нэг ФИЗИК компьютер · олон браузер.
 *
 * Асуудал: `mgl_device_id` (браузерын localStorage UUID) нь браузер-профайл
 * тус бүрд тусдаа.  Ижил компьютер дээр Chrome → Edge солих, PWA-г өөр
 * браузераар суулгах, «браузерын өгөгдөл цэвэрлэх», Windows-оо дахин суулгах
 * бүр шинэ id үүсгэж ажилтан «Энэ төхөөрөмж бүртгэлгүй» 403 авдаг байв.
 *
 * Хөтөч ямар ч тогтмол ТЕХНИК ХАНГАМЖИЙН id өгдөггүй (MAC, серийн дугаар,
 * машины нэр — аль нь ч вэб контентод хүрдэггүй).  Тиймээс «ижил компьютер»
 * гэдгийг браузерээс үл хамаарах, ижил машин дээр тогтвортой байдаг
 * шинжүүдээр ТААМАГЛАНА (`HwProfile`):
 *
 *   • GPU-ийн загвар (WebGL `UNMASKED_RENDERER_WEBGL`, нормчилсон) — Chrome,
 *     Edge, Opera, Yandex (бүгд Chromium/ANGLE) ижил мөр өгнө; Firefox ч
 *     ижил загварын нэрийг өөр хэлбэрээр өгдөг тул `normalizeGpu` нэгтгэнэ.
 *   • CPU логик цөмийн тоо (`navigator.hardwareConcurrency`)
 *   • Дэлгэцийн хэмжээ (`screen.width × height`, OS-ийн scaling-ийг дагана,
 *     хуудасны zoom-д ХАМААРАХГҮЙ)
 *   • Платформ (`navigator.platform`), цагийн бүс
 *
 * ⚠️ ХЯЗГААР: ЯГ ижил загварын компьютер + ижил монитор хоёр ажилтанд байвал
 * профайл нь давхцана — тэр үед хамт ажиллагч нь нууц үгээ мэдэж байвал
 * өөрийн (ижил) компьютерээс нөгөөгийнх нь ирцийг бүртгэж чадна.  Хуучин
 * ганц-UUID дүрэм үүнийг хаадаг байсан (UUID хуулахаас бусад тохиолдолд).
 * Тиймээс энэ автомат таних нь `attendance_device_hw_match` тохиргоогоор
 * (өгөгдмөл асаалттай) унтраагдаж болно — унтраавал ЗӨВХӨН яг таарсан
 * browser_id зөвшөөрөгдөнө (өмнөх зан төлөв, гэхдээ олон браузерын мөртэй).
 *
 * VM / RDP-ийн ерөнхий renderer («Microsoft Basic Render Driver», SwiftShader
 * г.м.) олон машинд ижил тул GPU гэж ТООЦОХГҮЙ → hw_hash үүсэхгүй → зөвхөн
 * яг таарсан browser_id (өмнөх зан төлөв).
 *
 * Хэш нь СЕРВЕР дээр бодогдоно: клиент зөвхөн түүхий шинжүүдээ илгээнэ,
 * нормчлол нэг газар байснаар апп-ын хувилбар солигдоход хуучин мөртэй
 * зөрөхгүй.
 */

/** Клиентээс ирэх түүхий профайл (`POST /attendance/clock-in` body.device). */
export interface HwProfileInput {
  gpu?: unknown;
  cores?: unknown;
  screen?: unknown;
  platform?: unknown;
  tz?: unknown;
  memory?: unknown;
}

/** Нормчилсон профайл — `hw_json`-д хадгалагдана. */
export interface HwProfile {
  gpu: string | null;
  cores: number | null;
  screen: string | null;
  platform: string | null;
  tz: string | null;
  /** Зөвхөн мэдээлэлд (Chromium-д л байдаг, 8-аар таслагддаг) — хэшэнд ОРОХГҮЙ. */
  memory: number | null;
}

/** Хувилбарын угтвар: бүрдэл өөрчлөгдвөл нэмэгдүүлнэ — хуучин hw_hash
 *  хэзээ ч шинэтэй санамсаргүй таарахгүй. */
const HW_HASH_VERSION = 'hw1';

/** Олон машинд ижил байдаг програм хангамжийн renderer-ууд — GPU биш. */
const GENERIC_GPU_RE =
  /swiftshader|llvmpipe|mesa offscreen|microsoft basic render|virtualbox|vmware svga|remote desktop|software adapter|basic display/i;

/**
 * WebGL renderer мөрийг браузераас үл хамаарах загварын нэр болгоно.
 *   Chrome/Edge: «ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)»
 *   Firefox:     «ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)»
 *   Хуучин:      «ANGLE (Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)»
 *   → «nvidia geforce rtx 3070» / «intel(r) uhd graphics 630»
 * Ерөнхий (VM/RDP/software) renderer бол `null`.
 */
export function normalizeGpu(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  if (GENERIC_GPU_RE.test(s)) return null;
  // ANGLE (...) бүрхүүл
  const angle = /^angle\s*\((.*)\)\s*$/.exec(s);
  if (angle?.[1] !== undefined) s = angle[1];
  // PCI id, backend суффикс
  s = s.replace(/\(0x[0-9a-f]+\)/g, '');
  s = s.replace(/direct3d\d+\s+vs_\d+_\d+\s+ps_\d+_\d+/g, '');
  s = s.replace(/,\s*(d3d\d+|opengl(?:\s*es)?|vulkan|metal|desktop)\b/g, '');
  // «vendor, model» → model (сүүлийн хоосон биш хэсэг)
  const parts = s
    .split(',')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const model = parts[parts.length - 1] ?? '';
  const cleaned = model.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 3) return null;
  if (GENERIC_GPU_RE.test(cleaned)) return null;
  return cleaned;
}

function toPositiveInt(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > max) return null;
  return Math.round(n);
}

function toShortString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= max ? s : null;
}

/** Клиентийн түүхий профайлыг ариутгана.  Юу ч ирээгүй бол `null`. */
export function normalizeHwProfile(input: unknown): HwProfile | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as HwProfileInput;
  const screenRaw = toShortString(i.screen, 32);
  const screen = screenRaw && /^\d{2,5}x\d{2,5}$/.test(screenRaw) ? screenRaw : null;
  const profile: HwProfile = {
    gpu: normalizeGpu(i.gpu),
    cores: toPositiveInt(i.cores, 1024),
    screen,
    platform: toShortString(i.platform, 40)?.toLowerCase() ?? null,
    tz: toShortString(i.tz, 64) ?? null,
    memory: toPositiveInt(i.memory, 1024),
  };
  const any = profile.gpu || profile.cores || profile.screen || profile.platform || profile.tz;
  return any ? profile : null;
}

/**
 * Профайл нь «ижил компьютер» гэж дүгнэхэд хангалттай юу?  GPU-гүй (VM/RDP,
 * WebGL хаалттай) профайл нь зөвхөн цөм + дэлгэц үлдээдэг — албаны ижил
 * компьютерүүд бүгд таарах тул хэш ҮҮСГЭХГҮЙ.
 */
export function hwProfileUsable(p: HwProfile | null): p is HwProfile {
  return !!p && p.gpu !== null && p.cores !== null && p.screen !== null;
}

/** Хэшлэгдэх канон мөр — тест ба серверт нэг. */
export function hwCanonical(p: HwProfile): string {
  return [HW_HASH_VERSION, p.gpu ?? '', p.cores ?? '', p.screen ?? '', p.platform ?? '', p.tz ?? '']
    .map(String)
    .join('|');
}

/** SHA-256 hex.  Профайл хангалтгүй бол `null`. */
export async function hwHash(p: HwProfile | null): Promise<string | null> {
  if (!hwProfileUsable(p)) return null;
  const bytes = new TextEncoder().encode(hwCanonical(p));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ------------------------------------------------------------------ */
/*  Шийдвэр (цэвэр)                                                    */
/* ------------------------------------------------------------------ */

export type BoundVia = 'first' | 'hw_match' | 'legacy';

export interface DeviceRow {
  id: number;
  browser_id: string;
  hw_hash: string | null;
  bound_via: BoundVia;
  bound_at: string;
}

export type DeviceDecision =
  /** Яг энэ браузер аль хэдийн холбогдсон. */
  | { kind: 'known'; row: DeviceRow }
  /** Идэвхтэй холболт огт байхгүй — анхны clock-in, энэ браузерт холбоно. */
  | { kind: 'bind_first' }
  /** Шинэ браузер, гэхдээ техник хангамж нь холбогдсон компьютертэй ижил. */
  | { kind: 'bind_hw_match'; row: DeviceRow }
  /** Бүх идэвхтэй холболт домэйн шилжилтээс өмнөх — нэг удаа дахин холбоно. */
  | { kind: 'rebind_legacy' }
  /** Танигдаагүй — 403. */
  | { kind: 'reject' };

export interface DecideOpts {
  browserId: string;
  hwHash: string | null;
  /** `attendance_device_hw_match` тохиргоо. */
  hwMatchEnabled: boolean;
  /** Домэйн шилжилтийн цонх — `routes/attendance.ts` DEVICE_REBIND_BEFORE_MS. */
  isLegacyBinding: (boundAt: string | null | undefined) => boolean;
}

export function decideDevice(active: DeviceRow[], opts: DecideOpts): DeviceDecision {
  const exact = active.find((r) => r.browser_id === opts.browserId);
  if (exact) return { kind: 'known', row: exact };
  if (active.length === 0) return { kind: 'bind_first' };
  if (opts.hwMatchEnabled && opts.hwHash) {
    const same = active.find((r) => r.hw_hash !== null && r.hw_hash === opts.hwHash);
    if (same) return { kind: 'bind_hw_match', row: same };
  }
  // Домэйн шилжилтээс өмнөх (эсвэл огноогүй) холболтууд л үлдсэн бол хуучин
  // нэг удаагийн дахин холбох цонх — `routes/attendance.ts`-ийн тайлбар.
  if (active.every((r) => opts.isLegacyBinding(r.bound_at))) return { kind: 'rebind_legacy' };
  return { kind: 'reject' };
}

/* ------------------------------------------------------------------ */
/*  DB                                                                  */
/* ------------------------------------------------------------------ */

export interface ResolveArgs {
  userId: number;
  browserId: string;
  profile: HwProfile | null;
  userAgent: string | null;
  hwMatchEnabled: boolean;
  isLegacyBinding: (boundAt: string | null | undefined) => boolean;
  /** ISO (UB) — `nowInUBIso()`. */
  now: string;
}

export async function loadActiveDevices(db: D1Database, userId: number): Promise<DeviceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, browser_id, hw_hash, bound_via, bound_at
         FROM attendance_devices
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY bound_at ASC, id ASC`,
    )
    .bind(userId)
    .all<DeviceRow>();
  return results ?? [];
}

/**
 * Clock-in дээрх төхөөрөмжийн шалгалт + бичилт.  Шийдвэрийг буцаана;
 * `reject` бол юу ч бичихгүй.
 *
 *   known          → last_seen + профайлыг СУРНА (hw_hash/hw_json-ийг хамгийн
 *                    сүүлийн хэмжилтээр шинэчилнэ — монитор солигдсон ч
 *                    дараагийн браузер солилт таарна)
 *   bind_first     → шинэ мөр 'first' + users.attendance_device_* толь
 *   bind_hw_match  → шинэ мөр 'hw_match' (users толь хэвээр)
 *   rebind_legacy  → хуучин мөрүүдийг revoke, шинэ 'first' мөр + users толь
 */
export async function resolveAttendanceDevice(
  db: D1Database,
  args: ResolveArgs,
): Promise<DeviceDecision> {
  const active = await loadActiveDevices(db, args.userId);
  const hash = await hwHash(args.profile);
  const decision = decideDevice(active, {
    browserId: args.browserId,
    hwHash: hash,
    hwMatchEnabled: args.hwMatchEnabled,
    isLegacyBinding: args.isLegacyBinding,
  });
  const hwJson = args.profile ? JSON.stringify(args.profile) : null;

  switch (decision.kind) {
    case 'known':
      await db
        .prepare(
          `UPDATE attendance_devices
              SET last_seen_at = ?,
                  hw_hash = COALESCE(?, hw_hash),
                  hw_json = COALESCE(?, hw_json),
                  user_agent = COALESCE(?, user_agent)
            WHERE id = ?`,
        )
        .bind(args.now, hash, hwJson, args.userAgent, decision.row.id)
        .run();
      break;
    case 'bind_hw_match':
      await insertDevice(db, args, hash, hwJson, 'hw_match');
      // users толь хоосон байвал (өмнөх reset-ийн дараа гар аргаар мөр
      // үлдсэн г.м.) дүүргэнэ — админы «холбогдсон» шошго зөв байг.
      await db
        .prepare(
          `UPDATE users
              SET attendance_device_id = COALESCE(attendance_device_id, ?),
                  attendance_device_label = COALESCE(attendance_device_label, ?),
                  attendance_device_bound_at = COALESCE(attendance_device_bound_at, ?)
            WHERE id = ?`,
        )
        .bind(args.browserId, args.userAgent, args.now, args.userId)
        .run();
      break;
    case 'rebind_legacy':
      await revokeAllDevices(db, args.userId, args.now);
      await bindPrimary(db, args, hash, hwJson);
      break;
    case 'bind_first':
      await bindPrimary(db, args, hash, hwJson);
      break;
    case 'reject':
      break;
  }
  return decision;
}

/** Шинэ ҮНДСЭН холболт: 'first' мөр + `users.attendance_device_*` толь. */
async function bindPrimary(
  db: D1Database,
  args: ResolveArgs,
  hash: string | null,
  hwJson: string | null,
): Promise<void> {
  await insertDevice(db, args, hash, hwJson, 'first');
  await db
    .prepare(
      `UPDATE users SET attendance_device_id = ?, attendance_device_label = ?,
         attendance_device_bound_at = ? WHERE id = ?`,
    )
    .bind(args.browserId, args.userAgent, args.now, args.userId)
    .run();
}

async function insertDevice(
  db: D1Database,
  args: ResolveArgs,
  hash: string | null,
  hwJson: string | null,
  via: BoundVia,
): Promise<void> {
  // Өмнө revoke хийгдсэн ижил browser_id (UNIQUE) дахин холбогдвол мөрийг
  // сэргээнэ — INSERT давхардал алдаа өгөхгүй.
  await db
    .prepare(
      `INSERT INTO attendance_devices
         (user_id, browser_id, hw_hash, hw_json, user_agent, bound_via, bound_at, last_seen_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(user_id, browser_id) DO UPDATE SET
         hw_hash = excluded.hw_hash,
         hw_json = excluded.hw_json,
         user_agent = excluded.user_agent,
         bound_via = excluded.bound_via,
         bound_at = excluded.bound_at,
         last_seen_at = excluded.last_seen_at,
         revoked_at = NULL`,
    )
    .bind(args.userId, args.browserId, hash, hwJson, args.userAgent, via, args.now, args.now)
    .run();
}

/** Admin reset — бүх идэвхтэй мөрийг хаана (устгахгүй). */
export async function revokeAllDevices(db: D1Database, userId: number, now: string): Promise<void> {
  await db
    .prepare(`UPDATE attendance_devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .bind(now, userId)
    .run();
}

/**
 * User-Agent → богино шошго (админд харуулах): «Chrome 149 · Windows».
 * Бүтэн UA нь `user_agent`-д хэвээр.  Дараалал чухал: Edge/Opera/Yandex нь
 * UA-даа Chrome-ыг ч агуулдаг.
 */
export function browserLabel(ua: string | null | undefined): string {
  if (!ua) return '—';
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua)
      ? 'macOS'
      : /Android/i.test(ua)
        ? 'Android'
        : /iPhone|iPad/i.test(ua)
          ? 'iOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : '';
  const engines: Array<[RegExp, string]> = [
    [/Edg\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/YaBrowser\/(\d+)/, 'Yandex'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
  ];
  let browser = /Safari\/\d+/.test(ua) ? 'Safari' : 'Браузер';
  for (const [re, name] of engines) {
    const v = re.exec(ua)?.[1];
    if (v !== undefined) {
      browser = `${name} ${v}`;
      break;
    }
  }
  return os ? `${browser} · ${os}` : browser;
}
