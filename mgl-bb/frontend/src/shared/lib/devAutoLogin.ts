import { resolveApiHost } from '@/shared/api/apiHost';
import { apiFetch } from '@/shared/api/client';
import type { AuthResponse } from '@/shared/types';

/**
 * ЗӨВХӨН ЛОКАЛ ХӨГЖҮҮЛЭЛТИЙН авто-нэвтрэлт.
 *
 * `npm run dev` дээр session олдоогүй үед нэвтрэх дэлгэц үзүүлэхийн оронд
 * өгөгдмөл `admin` хэрэглэгчээр чимээгүй нэвтэрнэ (`AuthContext.checkAuth`-ээс
 * дуудагдана).  Prod build-д `import.meta.env.DEV` false тул код нь tree-shake
 * болж бүрмөсөн хасагдана.
 *
 * Нэмэлт хамгаалалт: API host нь локал биш бол (жишээ нь dev серверийг
 * production worker руу чиглүүлсэн үед) огт ажиллахгүй — амьд серверт нууц
 * үг илгээхгүй.
 *
 * Тохируулга (`frontend/.env.local`):
 *   VITE_DEV_AUTOLOGIN=off          # бүрэн унтраах
 *   VITE_DEV_AUTOLOGIN_USER=bilguun # өөр хэрэглэгчээр орох
 *   VITE_DEV_AUTOLOGIN_PASS=…
 */

const OPT_OUT_KEY = 'dev_autologin_off';
const LOCAL_HOSTNAME_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.+\.localhost)$/i;

function apiHostIsLocal(): boolean {
  try {
    return LOCAL_HOSTNAME_RE.test(new URL(resolveApiHost()).hostname);
  } catch {
    return false;
  }
}

export const devAutoLoginEnabled: boolean =
  import.meta.env.DEV &&
  ((import.meta.env.VITE_DEV_AUTOLOGIN as string | undefined) ?? '').trim() !== 'off' &&
  apiHostIsLocal();

/** Гараар гарсны дараа таб хаагдтал авто-нэвтрэлтийг түр унтраана —
 *  тэгэхгүй бол шинэчлэх бүрд шууд эргэж ороод, өөр эрхээр тестлэх
 *  боломжгүй болно. */
export function suspendDevAutoLogin(): void {
  try {
    sessionStorage.setItem(OPT_OUT_KEY, '1');
  } catch {
    /* private mode — тоохгүй */
  }
}

/** `admin`-аар (эсвэл тохируулсан хэрэглэгчээр) нэвтэрч token-оо хадгална.
 *  Амжилттай бол true — дуудагч тал `/auth/me`-ийг дахин уншина. */
export async function devAutoLogin(): Promise<boolean> {
  if (!devAutoLoginEnabled) return false;
  try {
    if (sessionStorage.getItem(OPT_OUT_KEY) === '1') return false;
  } catch {
    /* private mode — үргэлжлүүлнэ */
  }

  const username = ((import.meta.env.VITE_DEV_AUTOLOGIN_USER as string | undefined) ?? '').trim();
  const password = ((import.meta.env.VITE_DEV_AUTOLOGIN_PASS as string | undefined) ?? '').trim();

  try {
    const data = await apiFetch<AuthResponse>('/auth/login', {
      data: { username: username || 'admin', password: password || 'admin123' },
    });
    if (data.token) localStorage.setItem('auth_token', data.token);
    return true;
  } catch {
    // Локал DB-д тухайн хэрэглэгч байхгүй / нууц үг өөр — ердийн нэвтрэх
    // дэлгэц рүү чимээгүй уналаа.
    return false;
  }
}
