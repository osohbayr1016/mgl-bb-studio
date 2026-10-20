/**
 * Print pages are loaded by Cloudflare Browser Rendering (and by the user's own
 * `window.print()`). The headless render can't attach an `Authorization` header
 * to its navigation, so the PDF endpoints pass a short-lived `?t=<jwt>` query
 * param instead. This bridges that token into `localStorage.auth_token` BEFORE
 * the first `apiFetch` runs, then strips it from the URL so it doesn't linger in
 * history / the referrer.
 *
 * Call it once at module scope (top of each print-page module) so the token is
 * in place before any render or fetch — that's why it's a plain side-effecting
 * function rather than a hook.
 *
 * @param opts.markHeadless  also set `body[data-headless-print="true"]` when a
 *   token is present, so the page can tell a headless PDF render from a user's
 *   manual print (used by the meeting minutes page to hide its in-flow date,
 *   which Browser Rendering already stamps via footerTemplate).
 * @returns the token if one was present (handy as a "was this headless?" flag),
 *   otherwise null.
 */
/** Нэг tab-ийн дотор `?t=` аль хэдийн bridge-лэгдсэнийг тэмдэглэнэ. app-ийн
 *  entry (main.tsx) URL-аас токеныг ЭРТ хуулж авдаг болсон тул print хуудасны
 *  өөрийн (хожуу ажилладаг) дуудлага энэ flag-аар "headless render мөн" гэдгээ
 *  таньж чадна — эс бөгөөс `markHeadless` хэзээ ч ажиллахгүй байх байсан. */
const BRIDGED_KEY = 'print_token_bridged';

export function bridgePrintToken(opts?: { markHeadless?: boolean }): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('t');
    if (token) {
      localStorage.setItem('auth_token', token);
      try {
        sessionStorage.setItem(BRIDGED_KEY, token);
      } catch {
        /* ignore */
      }
      if (opts?.markHeadless) document.body?.setAttribute('data-headless-print', 'true');
      url.searchParams.delete('t');
      window.history.replaceState(null, '', url.pathname + url.search);
      return token;
    }
    // URL-д токен алга — гэхдээ энэ tab-д өмнө нь (main.tsx-ийн эрт bridge)
    // хуулагдсан бол headless render гэж үзнэ.
    const prior = sessionStorage.getItem(BRIDGED_KEY);
    if (prior) {
      if (opts?.markHeadless) document.body?.setAttribute('data-headless-print', 'true');
      return prior;
    }
  } catch {
    /* ignore */
  }
  return null;
}
