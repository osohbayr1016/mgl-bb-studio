/**
 * mglenc.com-ын толгой дээрх «Нэвтрэх» товчноос ирсэн нэг удаагийн гарын
 * авлага (handoff).  Тэр сайт нь нэр/нууц үгийг ӨӨРӨӨ шалгадаггүй — PHP
 * сервер нь манай `/api/auth/login`-руу server-to-server дамжуулж, буцаж
 * ирсэн session токеныг хаягийн fragment-д хийж хэрэглэгчийг илгээдэг:
 *
 *     https://mgl-design-system.pages.dev/app#access_token=<jwt>
 *
 * Fragment (`#`) нь сервер рүү илгээгддэггүй, Referer толгойд ч үлддэггүй
 * тул токен Cloudflare-ийн лог руу ордоггүй — query string биш яг үүнийг
 * сонгосон шалтгаан нь тэр.
 *
 * ⚠️ Энэ нь ХАМГААЛАЛТ БИШ, зөвхөн тав тухын зам.  Токен байхгүй эсвэл
 * хүчингүй бол `/app` урьдын адил өөрийн login дэлгэцээ харуулна — шууд
 * `/app` руу орсон хүн ERP-ийн өөрийн auth-аар л нэвтэрнэ.
 *
 * `bridgePrintToken()`-той ижил шалтгаанаар модулын түвшний энгийн функц:
 * ямар ч `apiFetch` ажиллахаас ӨМНӨ токен байрандаа орсон байх ёстой тул
 * entry файлын (main.tsx) хамгийн эхэнд дуудагдана.
 *
 * @returns хүлээж авсан токен, эсвэл байхгүй/хүчингүй бол `null`.
 */

/** PHP талын `$gloErpTokenParam`-тай ЯГ таарах ёстой (const.php). */
const TOKEN_PARAM = 'access_token';

/** Гурван base64url хэсэг — JWT-ийн хэлбэрийн хямд шалгалт. */
function looksLikeJwt(value: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value);
}

export function bridgeHandoffToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const hash = window.location.hash;
    if (!hash.includes(`${TOKEN_PARAM}=`)) return null;

    const params = new URLSearchParams(hash.slice(1));
    const token = params.get(TOKEN_PARAM);
    if (!token) return null;

    // Токен зөв эсэхээс ҮЛ ХАМААРАН fragment-ийг эхлээд цэвэрлэнэ: хуудас
    // дахин ачаалахад, холбоосыг хуулж илгээхэд токен гарч болохгүй.
    params.delete(TOKEN_PARAM);
    const rest = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search + (rest ? `#${rest}` : ''),
    );

    // Хэлбэр нь JWT биш бол хадгалахгүй.  Эс тэгвэл `#access_token=junk`
    // гэсэн холбоос нь аль хэдийн нэвтэрсэн хэрэглэгчийн амьд сессийг
    // дарж бичээд, /auth/me 401 авмагц түүнийг гаргачих байлаа.
    if (!looksLikeJwt(token)) return null;

    localStorage.setItem('auth_token', token);
    return token;
  } catch {
    /* private mode / storage хаалттай — ердийн login-оор үргэлжилнэ */
    return null;
  }
}
