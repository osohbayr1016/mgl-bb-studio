/* =============================================================
 * Google Maps холбоос — ГАНЦ дүрмийн файл
 * -------------------------------------------------------------
 * Төслийн байршил гурван хэлбэрээр ХАДГАЛАГДДАГ (migration 0011 + 0038,
 * шинэ багана НЭМЭЭГҮЙ):
 *
 *   projects.latitude / longitude — газрын зургийн пин (яг цэг)
 *   projects.location            — чөлөөт бичвэр: хаяг, эсвэл ажилтан
 *                                   Google Maps холбоос буулгасан байж болно
 *
 * Энэ файл тэр гурваас «Google Maps дээр нээх» href-ийг НЭГ дүрмээр
 * гаргана (`projectMapsHref`) ба буулгасан холбоосоос координат
 * задална (`parseMapsCoords`).  UI бүр (Мэдээлэл таб, газрын зураг,
 * засах цонх, захиалагчийн портал) энэ файлыг л дуудна — href-ийн
 * дүрмийг хоёр газар бичихгүй.
 *
 * ⚠️ Богино холбоос (`maps.app.goo.gl/…`, `goo.gl/maps/…`, `g.co/…`)
 * координатаа ЗӨВХӨН redirect-ийн Location толгойд авч явдаг тул хөтөч
 * дээр задлах боломжгүй (CORS + opaque redirect).  Тэдгээрийг
 * `GET /api/projects/maps-link/resolve` серверээр дамжуулж урт холбоос
 * болгоно (`resolveMapsLink` — `features/projects/lib/resolveMapsLink.ts`),
 * ЗАДЛАЛТ нь дахиад л энд.
 *
 * Хэвлэх/нээх хэлбэр = Google Maps URLs API (албан ёсны, түлхүүргүй):
 *   https://www.google.com/maps/search/?api=1&query=LAT,LNG
 *   https://www.google.com/maps/dir/?api=1&destination=LAT,LNG
 * Android дээр Google Maps апп-аар, iOS дээр Safari → апп (universal
 * link), desktop дээр вэб хувилбараар нээгддэг — ялгаж бичих
 * шаардлагагүй.  `comgooglemaps://` схем ХЭРЭГЛЭХГҮЙ: суулгаагүй
 * төхөөрөмж дээр чимээгүй унадаг.
 * ============================================================= */

export interface LatLng {
  lat: number;
  lng: number;
}

export type MapsHrefKind =
  /** `latitude/longitude` пин — яг цэг. */
  | 'pin'
  /** `location` бичвэр дотор Google Maps холбоос буулгасан — түүнийг л нээнэ. */
  | 'link'
  /** Зөвхөн хаягийн бичвэр — Google хайлтаар ойролцоо газрыг олно. */
  | 'address';

export interface MapsHref {
  href: string;
  kind: MapsHrefKind;
}

export interface ProjectLocationLike {
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/* ---------------- координатын хүчинтэй муж ---------------- */

function isValidLat(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}
function isValidLng(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

function pair(latRaw: string | number, lngRaw: string | number): LatLng | null {
  const lat = typeof latRaw === 'number' ? latRaw : parseFloat(latRaw);
  const lng = typeof lngRaw === 'number' ? lngRaw : parseFloat(lngRaw);
  if (!isValidLat(lat) || !isValidLng(lng)) return null;
  // (0, 0) нь «хоосон» утгын нийтлэг хог — хэзээ ч барилгын байршил биш.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** `47.9184, 106.9177` / `47.9184,106.9177` — цэвэр координатын хос. */
const PLAIN_PAIR_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/* ---------------- хостын дүрэм ---------------- */

/** Google Maps-ийн урт холбоосын хост: `google.com`, `www.google.mn`,
 *  `maps.google.co.uk` … */
function isGoogleHost(host: string): boolean {
  return /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}(?:\.[a-z]{2})?$/i.test(host);
}

/** Богино холбоосын хост — координат нь зөвхөн redirect дотор. */
export function isShortMapsHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'g.co';
}

function safeUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

/** Энэ URL Google Maps-ийн холбоос мөн үү (урт эсвэл богино)? */
export function isMapsUrl(input: string): boolean {
  const u = safeUrl(input.trim());
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return false;
  const host = u.hostname.toLowerCase();
  if (isShortMapsHost(host)) return true;
  if (!isGoogleHost(host)) return false;
  if (host.startsWith('maps.')) return true;
  return u.pathname.startsWith('/maps');
}

/** Бичвэр дотроос ЭХНИЙ Google Maps холбоосыг олно (хаягийн талбарт
 *  «Хан-Уул … https://maps.app.goo.gl/x» гэж хамт бичсэн ч барина). */
export function extractMapsUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s<>"'`）)\]]+/gi);
  if (!m) return null;
  for (const raw of m) {
    // «холбоос.» гэж өгүүлбэрийн төгсгөлд бичсэн цэг/таслалыг хасна.
    const candidate = raw.replace(/[.,;:!?]+$/, '');
    if (isMapsUrl(candidate)) return candidate;
  }
  return null;
}

/* ---------------- координат задлах ---------------- */

/**
 * Google Maps холбоосоос (эсвэл `geo:` URI, эсвэл цэвэр «lat,lng» бичвэрээс)
 * координат задална.  Эрэмбэ — яг цэгээс ойролцоо руу:
 *
 *   1. `data=…!3d<lat>!4d<lng>`   — байрны ПИН (place share, dropped pin)
 *   2. `?q=` / `?query=` / `?ll=` / `?destination=` / `?daddr=` = `lat,lng`
 *   3. `/@<lat>,<lng>,<zoom>`      — камерын төв (place холбоосонд пинтэй
 *                                    ойролцоо, `/maps/@…`-д зөвхөн харагдац)
 *   4. `geo:lat,lng`
 *   5. «47.91, 106.91» цэвэр бичвэр
 *
 * Богино холбоосонд null — эхлээд серверээр урт болгоно.
 */
export function parseMapsCoords(input: string | null | undefined): LatLng | null {
  if (!input) return null;
  const text = input.trim();
  if (!text) return null;

  const plain = text.match(PLAIN_PAIR_RE);
  if (plain) return pair(plain[1]!, plain[2]!);

  const geo = text.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (geo) return pair(geo[1]!, geo[2]!);

  const u = safeUrl(text);
  if (!u) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(u.href);
  } catch {
    decoded = u.href;
  }

  // 1. !3d<lat>!4d<lng> — хамгийн сүүлийнх нь идэвхтэй байр (Google олон
  //    хос бичдэг; сүүлчийнх нь сонгосон place).
  const pinMatches = [...decoded.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  const lastPin = pinMatches[pinMatches.length - 1];
  if (lastPin) {
    const p = pair(lastPin[1]!, lastPin[2]!);
    if (p) return p;
  }

  // 2. query параметрүүд
  for (const key of ['q', 'query', 'll', 'destination', 'daddr', 'center']) {
    const v = u.searchParams.get(key);
    if (!v) continue;
    const m = v.match(/^\s*(?:loc:)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      const p = pair(m[1]!, m[2]!);
      if (p) return p;
    }
  }

  // 3. /@lat,lng,zoom
  const at = decoded.match(/\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const p = pair(at[1]!, at[2]!);
    if (p) return p;
  }

  return null;
}

/* ---------------- нээх href ---------------- */

function fmt(n: number): string {
  // 6 орон ≈ 0.11 м — хангалттай, URL богино.
  return Number(n.toFixed(6)).toString();
}

export function mapsSearchHref(target: LatLng | string): string {
  const q = typeof target === 'string' ? target : `${fmt(target.lat)},${fmt(target.lng)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function mapsDirectionsHref(target: LatLng | string): string {
  const d = typeof target === 'string' ? target : `${fmt(target.lat)},${fmt(target.lng)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d)}`;
}

/**
 * Төслийн бичлэгээс «Google Maps дээр нээх» href.  Эрэмбэ:
 *   пин (яг цэг) → бичвэр доторх Google Maps холбоос → хаягаар хайх.
 * Юу ч байхгүй бол null (товч харуулахгүй).
 */
export function projectMapsHref(p: ProjectLocationLike): MapsHref | null {
  if (p.latitude != null && p.longitude != null) {
    const coords = pair(p.latitude, p.longitude);
    if (coords) return { href: mapsSearchHref(coords), kind: 'pin' };
  }
  const link = extractMapsUrl(p.location);
  if (link) return { href: link, kind: 'link' };
  const address = p.location?.trim();
  if (address) return { href: mapsSearchHref(address), kind: 'address' };
  return null;
}

/** «Зам заах» — ижил эрэмбэ; холбоос-л байгаа тохиолдолд түүнээс координат
 *  задарвал тэр цэг рүү, эс бөгөөс холбоосыг өөрийг нь нээнэ. */
export function projectDirectionsHref(p: ProjectLocationLike): string | null {
  if (p.latitude != null && p.longitude != null) {
    const coords = pair(p.latitude, p.longitude);
    if (coords) return mapsDirectionsHref(coords);
  }
  const link = extractMapsUrl(p.location);
  if (link) {
    const coords = parseMapsCoords(link);
    return coords ? mapsDirectionsHref(coords) : link;
  }
  const address = p.location?.trim();
  return address ? mapsDirectionsHref(address) : null;
}

/** Хаягийн талбарт харуулах шошго: холбоос буулгасан бол урт URL-ийг
 *  биш, холбоосын ӨМНӨХ/ДАРААХ бичвэрийг (байвал) харуулна. */
export function locationDisplayText(location: string | null | undefined): string {
  if (!location) return '';
  const link = extractMapsUrl(location);
  if (!link) return location.trim();
  return location.replace(link, '').replace(/\s{2,}/g, ' ').trim();
}
