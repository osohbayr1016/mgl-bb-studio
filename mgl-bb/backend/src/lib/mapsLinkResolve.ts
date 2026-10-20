/* =============================================================
 * Google Maps БОГИНО холбоосыг урт болгох (`maps.app.goo.gl/…`)
 * -------------------------------------------------------------
 * Утасны «Хуваалцах» товч ҮРГЭЛЖ `https://maps.app.goo.gl/<id>` өгдөг,
 * зорилт нь зөвхөн тэр хаягийн 302 `Location` толгойд байдаг.  Хөтөч
 * тэр redirect-ийг харж чадахгүй (CORS, opaque redirect), тиймээс Worker
 * дагаж, ЭЦСИЙН URL-ийг буцаана.  Координатыг ЗАДЛАХ нь frontend-ийн
 * `shared/lib/mapsLink.ts` — дүрэм нэг газар, энд хуулбар байхгүй.
 *
 * ⚠️ ХЭМЖСЭН 2026-09-21 — юу олддог, юу олдДОГГҮЙ:
 *   • Буулгасан пин / координатын share → `…/maps/place/…/@lat,lng` эсвэл
 *     `?q=lat,lng` — frontend задална.  ✔
 *   • НЭРТЭЙ ГАЗРЫН (place) share → `https://maps.google.com?q=<нэр, хаяг>
 *     &ftid=0x…:0x…` → `…/maps?q=…` → 200 HTML.  URL-д координат БАЙХГҮЙ
 *     (`ftid` = Google-ийн дотоод id).  Тэр HTML-ийн `og:image` staticmap
 *     төвийг туршсан: ХОТЫН ТӨВ (IP-ээр), хүсэлт бүрд өөр
 *     (47.9100928,106.889216 → 47.906816,106.9088768 нэг л холбоосонд) —
 *     газрын байршил БИШ, тиймээс ХЭРЭГЛЭХГҮЙ.  Бодит координат нь зөвхөн
 *     `/maps/preview/place?pb=…` гэсэн дотоод protobuf endpoint-д —
 *     баримтжаагүй, хэврэг, ашиглахгүй.  Ийм холбоосонд frontend
 *     `no_coords` гэж ил хэлж, «нээгээд хаягийн мөрөөс урт холбоосыг хуул»
 *     гэж заана (хөтөч дээр нээхэд URL нь `/@lat,lng` болдог).
 *
 * SSRF хамгаалалт: ЭХНИЙ хаяг ч, redirect-ийн хоп бүр ч Google-ийн
 * хостуудаас гадуур байж болохгүй (`isAllowedHop`); хамгийн ихдээ
 * `MAX_HOPS`; хариуны биеийг ХЭЗЭЭ Ч уншихгүй (`redirect: 'manual'`,
 * зөвхөн толгой).  EU consent хуудас (`consent.google.com/…?continue=`)
 * тааралдвал `continue` параметрийг л авна.
 * ============================================================= */

export const MAX_HOPS = 6;

export type ResolveResult =
  | { ok: true; url: string; hops: number }
  | { ok: false; code: 'INVALID_URL' | 'NOT_MAPS_HOST' | 'TOO_MANY_HOPS' | 'UPSTREAM'; url?: string };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function isGoogleHost(host: string): boolean {
  return /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}(?:\.[a-z]{2})?$/i.test(host);
}

export function isShortMapsHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'g.co';
}

/** Хоп бүрд зөвшөөрөгдөх хост: богино холбоосын хостууд + `*.google.*`
 *  (maps/consent/www).  Өөр юу ч биш. */
export function isAllowedHop(u: URL): boolean {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  return isShortMapsHost(host) || isGoogleHost(host);
}

/** Урт Google Maps URL мөн үү — эцсийн хариу зөвхөн ийм хостоос л
 *  «амжилт» (богино хостын 200 нь интерстишиал, хэзээ ч зорилт биш). */
function isLongMapsUrl(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  if (!isGoogleHost(host)) return false;
  return host.startsWith('maps.') || u.pathname.startsWith('/maps');
}

function consentContinue(u: URL): string | null {
  if (!/^consent\.google\./i.test(u.hostname)) return null;
  return u.searchParams.get('continue');
}

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
}

export async function resolveMapsShortLink(
  input: string,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<ResolveResult> {
  let current: URL;
  try {
    current = new URL(input.trim());
  } catch {
    return { ok: false, code: 'INVALID_URL' };
  }
  if (!isAllowedHop(current)) return { ok: false, code: 'NOT_MAPS_HOST' };

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const cont = consentContinue(current);
    if (cont) {
      try {
        current = new URL(cont);
      } catch {
        return { ok: false, code: 'UPSTREAM', url: current.href };
      }
      if (!isAllowedHop(current)) return { ok: false, code: 'NOT_MAPS_HOST', url: current.href };
      continue;
    }

    let res: Response;
    try {
      res = await fetchImpl(current.href, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          // Google богино холбоос bot-д заримдаа HTML interstitial өгдөг —
          // жирийн хөтчийн UA-аар асууна.
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
          accept: 'text/html,*/*;q=0.8',
        },
      });
    } catch {
      return { ok: false, code: 'UPSTREAM', url: current.href };
    }
    // Биеийг хэзээ ч уншихгүй; холболтыг чөлөөлнө.
    await discard(res);

    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) {
      // Эцсийн хариу: урт Maps URL + 200 бол зорилт нь ЭНЭ хаяг; бусад
      // (богино хост 200 = интерстишиал, 404, 5xx) → UPSTREAM.
      return isLongMapsUrl(current) && res.status === 200
        ? { ok: true, url: current.href, hops: hop }
        : { ok: false, code: 'UPSTREAM', url: current.href };
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { ok: false, code: 'UPSTREAM', url: current.href };
    }
    if (!isAllowedHop(next)) return { ok: false, code: 'NOT_MAPS_HOST', url: next.href };
    current = next;
  }
  return { ok: false, code: 'TOO_MANY_HOPS', url: current.href };
}
