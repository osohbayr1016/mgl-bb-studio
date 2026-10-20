/**
 * Revit add-in-ий ЛИЦЕНЗ — «зөвхөн компанийн бүртгэлээр» (2026-10-02-оос өгөгдмөл; «зөвхөн ажлын компьютер
 * дээр» нь `revit.enroll_approval = auto` сонголт болсон — доор).
 *
 * Асуудал (эзэн, 2026-10-01): add-in-ий сервергүй хэрэгслүүд (Зураг клонлох,
 * Автомат хэмжээс, Хуудас дугаарлах, Smart г.м.) нэвтрэлтгүй ажилладаг байсан тул
 * DLL-ийг хуулсан хүн түүнийг өөр газар зарж ашиглах боломжтой байв.  Мөн add-in-ий
 * серверийн хаягийг хэрэглэгч өөрчилж болдог тул «нэвтэрсэн эсэхийг серверээс асуух»
 * нь хангалтгүй — хуурамч сервер «тийм» гэж хариулна.
 *
 * Шийдэл: сервер ГАРЫН ҮСЭГТЭЙ, богино хугацааны ЛИЦЕНЗ (lease) олгоно.  Add-in нь
 * дотроо шигтгэсэн НИЙТИЙН түлхүүрээр гарын үсгийг шалгана — хувийн түлхүүр зөвхөн
 * Worker-ийн secret (`REVIT_LICENSE_KEY`)-д байдаг тул хуурамч сервер хүчинтэй
 * лиценз үүсгэж чадахгүй.
 *
 * ⚠️ 2026-10-02 (эзэн): «бүртгэлээрээ нэвтрэхэд л асуудалгүй ашигладаг байх» — ажлын компьютерын тулгалт
 *    ажилтнуудыг «admin-д хандана уу»-д гацааж байсан.  Өгөгдмөл `account` горимд (`DecideArgs.accountMode`)
 *    идэвхтэй ажилтны бүртгэл хангалттай: тулгалт таарвал `via: 'match'`, үгүй бол `via: 'account'`.
 *    Лиценз нь тухайн компьютерын device_id (ба түлхүүр)-д уягдсан хэвээр — файлыг өөр PC-д хуулбал ажиллахгүй.
 *
 * ЛИЦЕНЗ ОЛГОХ НӨХЦӨЛ (эзний шийдвэр 2026-10-01 — одоо `auto` горим, `decideLicense`):
 *   • компанийн бүртгэл идэвхтэй, role нь Revit-ийн ажилтны role (DB-ээс — JWT-ийн
 *     365 хоногийн role хуучирсан байж болно);
 *   • компьютер нь тухайн ажилтны ИРЦ БҮРТГҮҮЛДЭГ ажлын компьютер — 0328-ын
 *     `attendance_devices.hw_json` (хөтчөөс уншсан GPU · цөм · дэлгэц)-тэй add-in-ий
 *     Windows-оос уншсан шинжүүд таарна (`profileMatches`), ЭСВЭЛ админ тухайн
 *     компьютерыг гараар зөвшөөрсөн (`revit_license_devices.status = 'approved'`);
 *   • админ тухайн компьютерыг хаагаагүй (`status = 'blocked'`).
 *
 * ⚠️ ХЯЗГААР (эзэнд хэлсэн): ирцийн таних (0328)-тай ижил «жижиг шалгалт» —
 *    ЯГ ижил загварын компьютер (GPU + цөм + дэлгэцийн харьцаа) өөр ажилтанд
 *    байвал тэр нь таарна.  Гаднын хүний компьютер ихэвчлэн таарахгүй; .NET DLL-ийг
 *    задалж кодыг нь өөрчлөх нь энэ хамгаалалтын хүрээнээс гадна.
 *
 * Энэ файл ЦЭВЭР (D1, Env хөндөхгүй) — `revitLicense.test.ts`.
 */
import { normalizeGpu, hwProfileUsable, type HwProfile } from './attendanceDevice';

/* ------------------------------------------------------------------ */
/*  Тогтмолууд — add-in-ий `Licensing/Core/LicenseLease.cs`-тэй ИХЭР   */
/* ------------------------------------------------------------------ */

/** Лицензийн хэлбэрийн хувилбар.  Өөрчилбөл add-in-ий `LicenseLease.Version`-ийг хамт. */
export const LEASE_VERSION = 1;
/** Лиценз хэнд зориулагдсан — өөр зорилгын гарын үсэг энд хүчинтэй болохгүй. */
export const LEASE_AUDIENCE = 'mgl-revit-addin';
/**
 * Интернэтгүй хамгийн удаан ажиллах хугацаа.
 *
 * ⚠️ 2026-10: 72 цагаас 12 цаг болгов (0375).  72 цагийн лиценз нь ажлаас гарсан /
 *    компьютер нь хаагдсан хүнд 3 хоног ажиллах цонх нээдэг байв.  12 цаг нь ажлын
 *    өдрийг (+ интернэтийн түр тасралтыг) даахад хангалттай, цуцлалт нь хамгийн
 *    удаандаа 12 цагт хүчин төгөлдөр болно.  Сервер «үгүй» гэвэл add-in лицензийг
 *    ШУУД устгадаг (интернэттэй үед цуцлалт ≈ 1 цагт — доорх шинэчлэлтийн давтамж).
 * Олон хоногоор интернэтгүй ажиллах боломж зориуд БАЙХГҮЙ.
 */
export const LEASE_TTL_SEC = 12 * 3600;
/** Үүнээс хуучин лицензийг add-in арын дэвсгэрт шинэчилнэ (ажлыг саатуулахгүй). */
export const LEASE_REFRESH_SEC = 3600;
/** Төхөөрөмжид уяатай API session токены наслалт (`purpose:'revit'`). */
export const SESSION_TTL_SEC = 30 * 60;
/** Add-in-ий хадгалдаг «renewal credential» (`purpose:'revit-refresh'`) — ганцаараа хангалтгүй. */
export const CREDENTIAL_TTL_DAYS = 30;

/** Add-in ашиглаж болох role — `routes/revit.ts`-ийн `REVIT_ROLES`-тэй ИХЭР. */
export const LICENSE_ROLES = ['admin', 'senior', 'engineer', 'architect'] as const;

/* ------------------------------------------------------------------ */
/*  Add-in-ий илгээх техник хангамжийн профайл                         */
/* ------------------------------------------------------------------ */

/**
 * Windows-оос уншсан профайл (`Licensing/HardwareProbe.cs`):
 *   gpus    — дэлгэцийн адаптерын нэрс (registry DriverDesc + EnumDisplayDevices)
 *   cores   — `Environment.ProcessorCount` (= хөтчийн `hardwareConcurrency`)
 *   screens — холбогдсон дэлгэц бүрийн ФИЗИК нягтрал «WxH»
 * Хөтчийн профайлаас ялгаатай нь ОЛОН GPU, ОЛОН дэлгэц байж болно — хөтөч аль
 * нэгийг нь л харуулдаг (зөөврийн компьютерт integrated/NVIDIA, олон монитор).
 */
export interface NativeProfile {
  gpus: string[];
  cores: number | null;
  screens: string[];
}

const SCREEN_RE = /^(\d{2,5})x(\d{2,5})$/;
const MAX_LIST = 12;

function toPositiveInt(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > max) return null;
  return Math.round(n);
}

/** Add-in-ий түүхий профайлыг ариутгана.  Хэрэгтэй юу ч ирээгүй бол `null`. */
export function normalizeNativeProfile(input: unknown): NativeProfile | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as { gpus?: unknown; cores?: unknown; screens?: unknown };
  const gpus: string[] = [];
  if (Array.isArray(i.gpus)) {
    for (const raw of i.gpus.slice(0, MAX_LIST)) {
      if (typeof raw !== 'string' || raw.length > 200) continue;
      const g = normalizeGpu(raw);
      if (g && !gpus.includes(g)) gpus.push(g);
    }
  }
  const screens: string[] = [];
  if (Array.isArray(i.screens)) {
    for (const raw of i.screens.slice(0, MAX_LIST)) {
      if (typeof raw !== 'string') continue;
      const s = raw.trim().toLowerCase();
      if (SCREEN_RE.test(s) && !screens.includes(s)) screens.push(s);
    }
  }
  const cores = toPositiveInt(i.cores, 1024);
  if (gpus.length === 0 && cores === null && screens.length === 0) return null;
  return { gpus, cores, screens };
}

/* ------------------------------------------------------------------ */
/*  Тулгалт: хөтчийн профайл (ирц) ↔ Windows-ийн профайл (add-in)      */
/* ------------------------------------------------------------------ */

/**
 * GPU таарах уу.  Хоёулаа `normalizeGpu`-ээр дамжсан.  Хөтөч заримдаа ЕРӨНХИЙ
 * нэр өгдөг («intel(r) uhd graphics»), Windows нь бүтэн загварыг («intel(r) uhd
 * graphics 770») — тиймээс ЦИФРГҮЙ (= загварын дугааргүй, гэр бүлийн) хөтчийн нэр
 * нь Windows-ийн нэрийн ҮГИЙН угтвар бол таарсанд тооцно.  Цифртэй нэр ЯГ таарах
 * ёстой: «nvidia geforce rtx 3070» нь «… 3070 ti»-ийн угтвар боловч өөр карт.
 */
export function gpuMatches(browserGpu: string, nativeGpus: readonly string[]): boolean {
  if (!browserGpu) return false;
  const family = !/\d/.test(browserGpu);
  return nativeGpus.some(
    (n) => n === browserGpu || (family && n.startsWith(browserGpu + ' ')),
  );
}

function parseScreen(s: string): [number, number] | null {
  const m = SCREEN_RE.exec(s);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? [w, h] : null;
}

/**
 * Дэлгэц таарах уу.  Хөтчийн `screen.width×height` нь CSS пиксел — Windows-ийн
 * масштаб (125 %, 150 %) ба хөтчийн zoom-оор ФИЗИК нягтралаас багасдаг
 * (прод дээр хэмжсэн: 3440×1440 монитор → 3018×1264, 2752×1152, 3128×1310).
 * Тиймээс харьцаа (өргөн/өндөр) ижил, физик нь CSS-ээс 0.5–4 дахин их бол таарна.
 */
export function screenMatches(browserScreen: string, nativeScreens: readonly string[]): boolean {
  const b = parseScreen(browserScreen);
  if (!b) return false;
  const [bw, bh] = b;
  const bAspect = bw / bh;
  return nativeScreens.some((s) => {
    const n = parseScreen(s);
    if (!n) return false;
    const [nw, nh] = n;
    const nAspect = nw / nh;
    if (Math.abs(nAspect - bAspect) / nAspect > 0.015) return false;
    const scale = nw / bw;
    return scale >= 0.5 && scale <= 4;
  });
}

/**
 * GPU + цөм л (дэлгэцгүй) — аль хэдийн УЯГДСАН компьютерын дахин шалгалт:
 * зөөврийн компьютерыг гадна монитороос салгах, монитор солих нь лицензийг
 * унагаах ёсгүй (`decideLicense`-ийн 2-р алхам).
 */
export function coreGpuMatches(browser: HwProfile | null, native: NativeProfile | null): boolean {
  if (!hwProfileUsable(browser) || !native) return false;
  const { gpu, cores } = browser;
  if (gpu === null || cores === null || native.cores === null || native.cores !== cores) return false;
  return gpuMatches(gpu, native.gpus);
}

/**
 * Ирцийн нэг төхөөрөмжийн (хөтчийн) профайл нь add-in-ий компьютертэй ижил юу?
 * Цөмийн тоо ЯГ ижил + GPU + дэлгэц.  Цагийн бүс, платформыг харьцуулахгүй:
 * оффисын бүх компьютерт ижил (ялгах чадваргүй), Windows-ийн тохиргоо буруу үед
 * (прод дээр «Asia/Shanghai») л зөрнө.
 */
export function profileMatches(browser: HwProfile | null, native: NativeProfile | null): boolean {
  if (!hwProfileUsable(browser) || !native) return false;
  const { gpu, cores, screen } = browser;
  if (gpu === null || cores === null || screen === null) return false;
  if (native.cores === null || native.cores !== cores) return false;
  if (!gpuMatches(gpu, native.gpus)) return false;
  return screenMatches(screen, native.screens);
}

/** `attendance_devices.hw_json` → профайл (гэмтсэн бол `null`). */
export function parseAttendanceHwJson(raw: string | null): HwProfile | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<HwProfile>;
    if (!p || typeof p !== 'object') return null;
    return {
      gpu: typeof p.gpu === 'string' ? p.gpu : null,
      cores: typeof p.cores === 'number' ? p.cores : null,
      screen: typeof p.screen === 'string' ? p.screen : null,
      platform: typeof p.platform === 'string' ? p.platform : null,
      tz: typeof p.tz === 'string' ? p.tz : null,
      memory: typeof p.memory === 'number' ? p.memory : null,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Шийдвэр                                                             */
/* ------------------------------------------------------------------ */

/** `revit_license_devices.status` — CHECK-гүй багана, утгын дүрэм ЭНД. */
export type DeviceStatus = 'auto' | 'approved' | 'blocked';
export const DEVICE_STATUSES: readonly DeviceStatus[] = ['auto', 'approved', 'blocked'];

export type DenyCode =
  | 'USER_INACTIVE'
  | 'ROLE_NOT_ALLOWED'
  | 'DEVICE_BLOCKED'
  | 'NO_HW_PROFILE'
  | 'NO_WORK_PC_PROFILE'
  | 'NOT_WORK_PC'
  // ── 0375: төхөөрөмжийн крипто танилт, хувилбарын бодлого ──
  | 'DEVICE_REVOKED'
  | 'DEVICE_PENDING'
  | 'DEVICE_LIMIT_REACHED'
  | 'DEVICE_NOT_ENROLLED'
  | 'DEVICE_KEY_REQUIRED'
  | 'DEVICE_KEY_MISMATCH'
  | 'DEVICE_KEY_WEAK'
  | 'DEVICE_PROOF_REQUIRED'
  | 'DEVICE_PROOF_INVALID'
  | 'ADDIN_UPDATE_REQUIRED'
  | 'ADDIN_VERSION_BLOCKED'
  | 'REVIT_LICENSES_DISABLED';

/** match — ажлын компьютертэй таарсан · approved — admin гараар · account — бүртгэлээр (тулгалтгүй, 2026-10-02). */
export type LicenseVia = 'match' | 'approved' | 'account';

export type LicenseVerdict =
  | { ok: true; via: LicenseVia; attendanceDeviceId: number | null }
  | { ok: false; code: DenyCode };

export interface AttendanceProfileRow {
  id: number;
  hw_json: string | null;
}

export interface DecideArgs {
  user: { status: string | null; role: string | null };
  deviceStatus: DeviceStatus | null;
  native: NativeProfile | null;
  attendance: readonly AttendanceProfileRow[];
  /** Энэ add-in компьютер өмнө нь БҮРЭН таарч уягдсан ирцийн төхөөрөмжийн id. */
  boundAttendanceDeviceId?: number | null;
  /**
   * `revit.enroll_approval = account` (өгөгдмөл): ажлын компьютер таарахгүй (эсвэл техник шинж уншигдахгүй) ч
   * идэвхтэй ажилтны бүртгэлээр зөвшөөрнө.  false/undefined = хуучин «зөвхөн ажлын компьютер» дүрэм.
   */
  accountMode?: boolean;
}

export function decideLicense(a: DecideArgs): LicenseVerdict {
  if (a.user.status === 'inactive') return { ok: false, code: 'USER_INACTIVE' };
  if (!(LICENSE_ROLES as readonly string[]).includes(a.user.role ?? '')) {
    return { ok: false, code: 'ROLE_NOT_ALLOWED' };
  }
  if (a.deviceStatus === 'blocked') return { ok: false, code: 'DEVICE_BLOCKED' };
  // Админы гарын зөвшөөрөл техник хангамжийн тулгалтаас ТҮРҮҮЛНЭ — хөтөч нь GPU-гээ
  // нуудаг (Brave → «brave»), ирцээс чөлөөтэй хүн г.м. таарахгүй тохиолдлын гарц.
  if (a.deviceStatus === 'approved') return { ok: true, via: 'approved', attendanceDeviceId: null };
  // `account` горим: тулгалт таарахгүй бүх тохиолдол (VM / алсын холболт, ирцийн PC бүртгэлгүй, өөр PC) → бүртгэлээр.
  const byAccount: LicenseVerdict = { ok: true, via: 'account', attendanceDeviceId: null };
  if (!a.native || a.native.gpus.length === 0 || a.native.cores === null) {
    return a.accountMode ? byAccount : { ok: false, code: 'NO_HW_PROFILE' };
  }
  const usable = a.attendance
    .map((r) => ({ id: r.id, p: parseAttendanceHwJson(r.hw_json) }))
    .filter((r): r is { id: number; p: HwProfile } => hwProfileUsable(r.p));
  if (usable.length === 0) return a.accountMode ? byAccount : { ok: false, code: 'NO_WORK_PC_PROFILE' };
  // 1) Бүрэн тулгалт: цөм + GPU + дэлгэц.
  const hit = usable.find((r) => profileMatches(r.p, a.native));
  if (hit) return { ok: true, via: 'match', attendanceDeviceId: hit.id };
  // 2) Аль хэдийн уягдсан компьютер: тэр ирцийн төхөөрөмж идэвхтэй хэвээр (admin
  //    reset хийгээгүй) + GPU, цөм таарсаар байвал дэлгэц өөрчлөгдсөн ч зөвшөөрнө.
  //    Шинэ (уягдаагүй) компьютер ҮРГЭЛЖ 1-р алхмаар л орно.
  const bound = a.boundAttendanceDeviceId ?? null;
  if (bound !== null) {
    const b = usable.find((r) => r.id === bound);
    if (b && coreGpuMatches(b.p, a.native)) return { ok: true, via: 'match', attendanceDeviceId: b.id };
  }
  return a.accountMode ? byAccount : { ok: false, code: 'NOT_WORK_PC' };
}

/** Ажилтанд харагдах мессеж (add-in-ий цонхонд шууд гарна). */
export const DENY_MESSAGES: Record<DenyCode, string> = {
  USER_INACTIVE: 'Таны бүртгэл идэвхгүй байна. Admin-д хандана уу.',
  ROLE_NOT_ALLOWED: 'Таны бүртгэлийн эрхээр Revit add-in ашиглах боломжгүй.',
  DEVICE_BLOCKED: 'Энэ компьютер дээр MGL add-in ашиглахыг admin хаасан байна.',
  NO_HW_PROFILE:
    'Энэ компьютерын техник хангамжийг уншиж чадсангүй (алсын холболт / виртуал машин). ' +
    'Admin энэ компьютерыг гараар зөвшөөрөх шаардлагатай.',
  NO_WORK_PC_PROFILE:
    'Таны ажлын компьютер системд бүртгэгдээгүй байна. Эхлээд энэ компьютерын хөтчөөс ' +
    'MGL систем рүү орж ирцээ бүртгүүлээд, дахин шалгана уу. Болохгүй бол admin-д хандана уу.',
  NOT_WORK_PC:
    'Энэ компьютер таны ирц бүртгүүлдэг ажлын компьютер гэж танигдсангүй. MGL add-in зөвхөн ' +
    'ажлын компьютер дээр ажиллана. Энэ бол таны ажлын компьютер бол admin-аар зөвшөөрүүлнэ үү.',
  DEVICE_REVOKED: 'Энэ төхөөрөмжийн MGL Add-in ашиглах эрх хаагдсан байна.',
  DEVICE_PENDING: 'Энэ төхөөрөмжийг ашиглах зөвшөөрөл хүлээгдэж байна. Системийн админд хандана уу.',
  DEVICE_LIMIT_REACHED:
    'Таны бүртгэлд зөвшөөрөгдсөн төхөөрөмжийн тоо дүүрсэн байна. Системийн админд хандана уу.',
  DEVICE_NOT_ENROLLED: 'Энэ төхөөрөмж бүртгэгдээгүй байна. Дахин нэвтэрч бүртгүүлнэ үү.',
  DEVICE_KEY_REQUIRED: 'Энэ төхөөрөмжийг аюулгүй байдлын түлхүүрээр бүртгүүлэх шаардлагатай.',
  DEVICE_KEY_MISMATCH:
    'Төхөөрөмжийн түлхүүр бүртгэлтэй таарахгүй байна. Системийн админд хандана уу.',
  DEVICE_KEY_WEAK:
    'Энэ компьютерын аюулгүй байдлын чип (TPM) шаардлага хангахгүй байна. Системийн админд хандана уу.',
  DEVICE_PROOF_REQUIRED: 'Төхөөрөмжийн баталгаажуулалт шаардлагатай. Add-in-ийг шинэчилнэ үү.',
  DEVICE_PROOF_INVALID: 'Төхөөрөмжийн баталгаажуулалт амжилтгүй боллоо. Дахин оролдоно уу.',
  ADDIN_UPDATE_REQUIRED: 'MGL Add-in-ийг шинэчлэх шаардлагатай байна.',
  ADDIN_VERSION_BLOCKED: 'Add-in-ий энэ хувилбарыг ашиглахыг хориглосон. Add-in-ийг шинэчилнэ үү.',
  REVIT_LICENSES_DISABLED: 'MGL Add-in-ий лицензийг түр зогсоосон байна. Системийн админд хандана уу.',
};

/* ------------------------------------------------------------------ */
/*  Гарын үсэгтэй лиценз                                               */
/* ------------------------------------------------------------------ */

export interface LeasePayload {
  v: number;
  kid: string;
  aud: string;
  sub: number;
  un: string;
  nm: string;
  rl: string;
  dev: string;
  via: LicenseVia;
  /** Төхөөрөмжийн түлхүүрийн хамгаалалт: tpm | software | legacy (түлхүүргүй хуучин зам). */
  sec?: 'tpm' | 'software' | 'legacy';
  /** Төхөөрөмжийн түлхүүрийн key_id — add-in өөрийн түлхүүртэй тулгана (өөр PC-д хуулбал таарахгүй). */
  dk?: string;
  iat: number;
  exp: number;
  rfa: number;
}

export interface SigningKey {
  kid: string;
  jwk: JsonWebKey;
}

const KID_RE = /^[a-z0-9][a-z0-9._-]{2,40}$/;

/**
 * `REVIT_LICENSE_KEY` secret → гарын үсгийн түлхүүр.  Хэлбэр:
 *   {"kid":"mgl-2026-10","kty":"EC","crv":"P-256","d":"…","x":"…","y":"…"}
 * Тохируулаагүй / гэмтсэн бол `null` (route 503 өгнө — ХЭЗЭЭ Ч гарын үсэггүй
 * лиценз олгохгүй).
 */
export function parseSigningKey(secret: string | undefined | null): SigningKey | null {
  if (!secret) return null;
  try {
    const o = JSON.parse(secret) as Record<string, unknown>;
    const kid = typeof o.kid === 'string' ? o.kid : '';
    if (!KID_RE.test(kid)) return null;
    if (o.kty !== 'EC' || o.crv !== 'P-256') return null;
    for (const k of ['d', 'x', 'y'] as const) {
      if (typeof o[k] !== 'string' || !(o[k] as string)) return null;
    }
    return {
      kid,
      jwk: { kty: 'EC', crv: 'P-256', d: o.d as string, x: o.x as string, y: o.y as string },
    };
  } catch {
    return null;
  }
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Импортолсон түлхүүрийн кэш.  ⚠️ Promise БИШ, шийдэгдсэн утгыг л хадгална —
 * модулийн түвшинд Promise хадгалах нь хүсэлт хоорондын хүлээлтээр Worker-ийг
 * гацаасан түүхтэй.
 */
let keyCache: { secret: string; key: CryptoKey } | null = null;

async function importSigningKey(k: SigningKey, cacheTag: string): Promise<CryptoKey> {
  if (keyCache && keyCache.secret === cacheTag) return keyCache.key;
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...k.jwk, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  keyCache = { secret: cacheTag, key };
  return key;
}

/**
 * Лиценз = `b64url(payload JSON) + "." + b64url(гарын үсэг)`.  Гарын үсэг нь
 * ЭХНИЙ ХЭСГИЙН ASCII байт дээр (JWS-тэй ижил), ECDSA P-256 + SHA-256, IEEE P1363
 * (r‖s, 64 байт) — .NET-ийн `ECDsa.VerifyData`-ийн өгөгдмөл хэлбэр.
 */
export async function signLease(payload: LeasePayload, key: SigningKey): Promise<string> {
  const head = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const cryptoKey = await importSigningKey(key, `${key.kid}:${key.jwk.d}`);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(head),
  );
  return `${head}.${b64urlEncode(new Uint8Array(sig))}`;
}

export function buildLeasePayload(args: {
  kid: string;
  user: { id: number; username: string | null; full_name: string | null; role: string };
  deviceId: string;
  via: LicenseVia;
  nowSec: number;
  sec?: 'tpm' | 'software' | 'legacy';
  dk?: string | null;
}): LeasePayload {
  return {
    v: LEASE_VERSION,
    kid: args.kid,
    aud: LEASE_AUDIENCE,
    sub: args.user.id,
    un: args.user.username ?? '',
    nm: args.user.full_name ?? args.user.username ?? '',
    rl: args.user.role,
    dev: args.deviceId,
    via: args.via,
    ...(args.sec ? { sec: args.sec } : {}),
    ...(args.dk ? { dk: args.dk } : {}),
    iat: args.nowSec,
    exp: args.nowSec + LEASE_TTL_SEC,
    rfa: args.nowSec + LEASE_REFRESH_SEC,
  };
}

/**
 * Лицензийг шалгана (тест + сервер талын оношилгоонд; ЖИНХЭНЭ шалгагч нь
 * add-in-ий `LicenseLease.Verify`).  Гарын үсэг таарахгүй бол `null`.
 */
export async function verifyLease(
  token: string,
  publicJwk: JsonWebKey,
): Promise<LeasePayload | null> {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const head = token.slice(0, dot);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    b64urlDecode(token.slice(dot + 1)),
    new TextEncoder().encode(head),
  );
  if (!ok) return null;
  return JSON.parse(new TextDecoder().decode(b64urlDecode(head))) as LeasePayload;
}

/** `device_id` — add-in-ий SHA-256 hex (машины түүхий id сервер рүү ХЭЗЭЭ Ч явахгүй). */
export function isDeviceId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

/** Админд харуулах товч тайлбар: «nvidia geforce rtx 3070 · 20 цөм · 3440x1440». */
export function hwSummary(p: NativeProfile | null): string {
  if (!p) return '—';
  const parts: string[] = [];
  if (p.gpus.length) parts.push(p.gpus.join(' / '));
  if (p.cores !== null) parts.push(`${p.cores} цөм`);
  if (p.screens.length) parts.push(p.screens.join(', '));
  return parts.join(' · ') || '—';
}
