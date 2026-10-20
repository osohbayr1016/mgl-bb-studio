// Ирцийн төхөөрөмж таних туслахууд.
//
// ⚠️ `shared/hooks/use-mobile.ts` (`useIsMobile`) нь дэлгэцийн ӨРГӨН дээр
// суурилдаг тул энд тохирохгүй (цонхоо багасгасан desktop-ыг "mobile"
// гэж андуурна).  Энд User-Agent дээр суурилсан төхөөрөмж-төрлийн
// илрүүлэлт хэрэгтэй.

const DEVICE_KEY = 'mgl_device_id';

/** localStorage хаалттай (private mode, site data blocked) үед session-ийн
 *  туршид тогтмол байх нөөц id — хүсэлт бүр өөр id илгээхээс сэргийлнэ. */
let memoryDeviceId: string | null = null;

/**
 * Энэ браузер-профайлын тогтвортой төхөөрөмжийн id.  Анх дуудагдахад
 * `crypto.randomUUID()`-ээр үүсгэж `localStorage`-д хадгална.
 *
 * Logout үед ЭНЭ id-г бүү цэвэрлэ — PC холбоотой хэвээр үлдэх ёстой
 * (logout зөвхөн `auth_token`-г устгана).  Storage цэвэрлэх / incognito /
 * браузер солих үед шинэ id үүснэ — гэхдээ 0328-аас хойш сервер ижил
 * компьютерийн шинэ браузерыг `getHardwareProfile()`-аар таньж автоматаар
 * холбодог тул admin reset зөвхөн ШИНЭ компьютерт л хэрэгтэй.
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = memoryDeviceId ?? crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    memoryDeviceId = id;
    return id;
  } catch {
    // Storage хаалттай — санах ойн id (энэ таб амьд байх хугацаанд тогтмол).
    memoryDeviceId ??= crypto.randomUUID();
    return memoryDeviceId;
  }
}

/**
 * Браузераас ҮЛ ХАМААРАХ техник хангамжийн профайл — сервер (`lib/attendanceDevice.ts`)
 * үүгээр «ижил компьютер, өөр браузер» гэдгийг таньж, ирцийн төхөөрөмжийн
 * холболтод шинэ браузерыг автоматаар нэмнэ.  Зөвхөн `POST /attendance/clock-in`
 * body-д явна (хүсэлт бүрд биш).
 *
 * Бүрдэл (бүгд ижил машин дээр Chrome/Edge/Opera/Firefox-д тогтвортой):
 *   gpu      — WebGL `UNMASKED_RENDERER_WEBGL` (сервер нормчилно)
 *   cores    — `navigator.hardwareConcurrency`
 *   screen   — `screen.width×height` (OS scaling дагана, хуудасны zoom-д хамаарахгүй)
 *   platform — `navigator.platform`
 *   tz       — цагийн бүс
 *   memory   — `navigator.deviceMemory` (мэдээлэлд л; хэшэнд орохгүй)
 *
 * Хэш нь СЕРВЕР дээр — энд юу ч хэшлэхгүй, зөвхөн түүхий шинжүүд.
 */
export interface HardwareProfile {
  gpu?: string;
  cores?: number;
  screen?: string;
  platform?: string;
  tz?: string;
  memory?: number;
}

let cachedProfile: HardwareProfile | null = null;

/** WebGL renderer мөр.  Context үүсгэх нь ~1-5 мс; хэрэглэсний дараа
 *  устгана.  WebGL хаалттай / алдаатай бол `undefined`. */
function readWebGlRenderer(): string | undefined {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return undefined;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext
      ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as unknown)
      : (gl.getParameter(gl.RENDERER) as unknown);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof renderer === 'string' && renderer.trim() ? renderer.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function getHardwareProfile(): HardwareProfile {
  if (cachedProfile) return cachedProfile;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const profile: HardwareProfile = {};
  const gpu = readWebGlRenderer();
  if (gpu) profile.gpu = gpu;
  if (Number.isFinite(nav.hardwareConcurrency) && nav.hardwareConcurrency > 0) {
    profile.cores = nav.hardwareConcurrency;
  }
  if (screen?.width && screen?.height) {
    profile.screen = `${Math.round(screen.width)}x${Math.round(screen.height)}`;
  }
  if (typeof nav.platform === 'string' && nav.platform) profile.platform = nav.platform;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) profile.tz = tz;
  } catch {
    /* Intl байхгүй — орхино */
  }
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0) {
    profile.memory = nav.deviceMemory;
  }
  cachedProfile = profile;
  return profile;
}

/**
 * Тухайн төхөөрөмж нь гар утас уу?  Ирсэн бүртгэл (clock-in) зөвхөн
 * компьютероос хийгдэх ёстой тул UI-д товчийг түгжихэд ашиглана.
 * Tablet / iPad-ийг санаатайгаар "утас" гэж тооцохгүй (server талын
 * `isPhoneUserAgent`-тэй ижил логик).
 */
export function isPhoneDevice(): boolean {
  const ua = navigator.userAgent;
  return /(iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Opera Mini|IEMobile)/i.test(ua);
}
