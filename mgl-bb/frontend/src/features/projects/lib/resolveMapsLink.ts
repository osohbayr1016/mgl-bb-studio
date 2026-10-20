/* Буулгасан Google Maps холбоос / бичвэрээс координат авах — НЭГ зам.
 *
 *   1. `parseMapsCoords` — урт холбоос, `geo:`, «lat,lng» бичвэр → шууд.
 *   2. Богино холбоос (`maps.app.goo.gl/…`) → `GET /api/projects/maps-link/
 *      resolve` серверээр redirect дагаж, эцсийн URL-ийг ДАХИАД л
 *      `parseMapsCoords`.
 *   3. Эцсийн URL-д ч координат байхгүй (утасны НЭРТЭЙ газрын share →
 *      `?q=нэр&ftid=…`, хэмжсэн 2026-09-21; `?cid=`) → `no_coords` + холбоос:
 *      хэрэглэгч нээгээд хаягийн мөрөөс `/@lat,lng` бүхий урт холбоосыг
 *      хуулна.  Сервер ХЭЗЭЭ Ч таамаглахгүй (`mapsLinkResolve.ts` толгой).
 *
 * Газрын зургийн «Холбоос» цонх ба төслийн засах цонх хоёулаа үүнийг
 * дууддаг тул «Google Maps холбоос» гэж юуг хүлээн авах нь хоёр газар
 * зөрөхгүй. */
import { apiFetch, ApiError } from '@/shared/api/client';
import {
  extractMapsUrl,
  isShortMapsHost,
  parseMapsCoords,
  type LatLng,
} from '@/shared/lib/mapsLink';

export type ResolvedMapsLink =
  | { ok: true; coords: LatLng; url: string | null }
  /** Холбоос/бичвэр Google Maps-ийнх биш, эсвэл ямар ч координат агуулаагүй. */
  | { ok: false; reason: 'not_maps' | 'no_coords' | 'resolve_failed' | 'offline'; url: string | null };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export async function resolveMapsLink(input: string): Promise<ResolvedMapsLink> {
  const text = input.trim();
  if (!text) return { ok: false, reason: 'not_maps', url: null };

  const direct = parseMapsCoords(text);
  if (direct) return { ok: true, coords: direct, url: extractMapsUrl(text) };

  const url = extractMapsUrl(text);
  if (!url) return { ok: false, reason: 'not_maps', url: null };

  if (!isShortMapsHost(hostOf(url))) {
    // Урт Google Maps холбоос боловч координатгүй (`?q=нэр&ftid=`, `?cid=`,
    // хайлтын холбоос) — нээж болно, пин тавьж чадахгүй; сервер ч нэмэр
    // болохгүй (redirect дагах юм алга).
    return { ok: false, reason: 'no_coords', url };
  }

  try {
    const res = await apiFetch<{ url: string }>(
      `/projects/maps-link/resolve?url=${encodeURIComponent(url)}`,
    );
    const coords = parseMapsCoords(res.url);
    return coords ? { ok: true, coords, url } : { ok: false, reason: 'no_coords', url };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, reason: 'resolve_failed', url };
    return { ok: false, reason: 'offline', url };
  }
}
