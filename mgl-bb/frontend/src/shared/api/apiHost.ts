// `mglenc-design` нь компанийн (info@mglenc.com) Cloudflare акаунтын
// workers.dev дэд домэйн.  workers.dev дэд домэйн нь АКАУНТАД харьяалагддаг
// тул хуучин `anandoctane4`-ийг авч үлдэх боломжгүй байсан.
//
// ⚠️ Энэ мөрийг зөвхөн dashboard дээрх дэд домэйнтэй ХАМТ солино.  Дэд
// домэйныг сольмогц хуучин хост NXDOMAIN болж, апп бүхэлдээ "Failed to
// fetch" өгнө (2026-08-21-нд яг ингэж унасан).  resolveApiHost() нь
// VITE_API_HOST-ыг зориудаар үл тоомсорлодог тул энд засаад ДАХИН БАРИХ
// шаардлагатай — орчны хувьсагчаар залруулж болохгүй.
//
// api.mglenc.com дээр гарахад энэ нэр бүрмөсөн алга болно.
export const DEFAULT_API_HOST = 'https://mgl-progress-api.mglenc-design.workers.dev';

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * API + `/media` хүсэлт явуулах Worker-ийн origin.
 *
 * `VITE_API_HOST` нь build ҮЕД bundle дотор шигтгэгддэг — гаргасан `dist/` нь
 * ажиллах үедээ бодлоо өөрчлөх БОЛОМЖГҮЙ.  Тиймээс доорх хамгаалалт нь ЯГ
 * НЭГ эвдрэлийн эсрэг: хөгжүүлэгчийн `.env.local`-д байгаа
 * `http://127.0.0.1:3000` нь локал `wrangler pages deploy`-оор production-д
 * гарч, зочин бүрийг өөрийнх нь машины 3000 порт руу заалгаж, аппыг бүхэлд нь
 * унагаасан.  (Тэр явдал бодитоор болсон.)
 *
 * ⚠️ ХУУЧИН ДҮРЭМ ХЭТ ӨРГӨН БАЙВ: non-loopback origin дээр env-ийг БҮРЭН үл
 *    тоомсорлодог байсан.  Тэгэхээр `DEFAULT_API_HOST` буюу эх кодын нэгдүгээр
 *    мөр нь production-ы ГАНЦ боломжит API host болж, өөр компани өөрийн
 *    worker руу заасан bundle барих боломжгүй байв — энэ нь олон-tenant-ийн
 *    гол хаалт байсан.
 *
 * ШИНЭ ДҮРЭМ (нарийсгасан, хамгаалалт бүрэн хэвээр):
 *    **loopback API host-ыг ЗӨВХӨН loopback origin дээр зөвшөөрнө.**
 *    non-loopback `VITE_API_HOST` нь хууль ёсны deploy зорилт (өөр
 *    харилцагчийн worker, staging worker) тул бүх origin дээр хүндэтгэгдэнэ.
 *
 * Зан төлөвийн зөрүү, бүрэн жагсаалт:
 *   | Тохиолдол                                        | Өмнө    | Дараа       |
 *   | .env.local=127.0.0.1, prod-д deploy              | DEFAULT | DEFAULT  ✅ |
 *   | VITE_API_HOST=https://acme-api…, acme.pages.dev  | DEFAULT | acme-api ✅ |
 *   | локал vite + локал worker                        | env     | env         |
 *   | локал vite, env хоосон                           | DEFAULT | DEFAULT     |
 *   | window байхгүй, loopback env                     | DEFAULT | DEFAULT     |
 *
 * MGL-ийн production build нь non-loopback `VITE_API_HOST` тавьдаггүй тул
 * түүний хувьд өөрчлөлт ТЭГ.
 */
export function resolveApiHost(): string {
  const fromEnv = (import.meta.env.VITE_API_HOST as string | undefined)?.trim() ?? '';
  if (fromEnv.length === 0) return DEFAULT_API_HOST;

  const host = fromEnv.replace(/\/$/, '');
  if (!isLoopbackUrl(host)) return host;

  // Loopback зорилт — зөвхөн хуудас өөрөө loopback дээр байрлаж байвал.
  const onLoopbackOrigin =
    typeof window !== 'undefined' && isLoopbackHostname(window.location.hostname);
  return onLoopbackOrigin ? host : DEFAULT_API_HOST;
}
