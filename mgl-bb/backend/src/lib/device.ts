import type { Context } from 'hono';

/**
 * Утасны User-Agent-ийг таних.  Ирсэн бүртгэл (clock-in) нь зөвхөн
 * компьютероос хийгдэх ёстой тул энэ нь server талын backstop —
 * client дээрх шалгалтыг (`isPhoneDevice`) тойрсон тохиолдолд ажиллана.
 *
 * Tablet / iPad нь ойлгомжгүй (iPadOS Safari нь desktop Mac мэт UA-тай)
 * тул санаатайгаар "утас" гэж тооцохгүй — гол зорилго нь гар утсыг
 * хориглох.  Android утаснууд UA-даа "Mobile" гэсэн tokenтэй ирдэг тул
 * `Android.*Mobile` нь tablet-ийг алгасч утсыг л таана.
 */
export function isPhoneUserAgent(ua: string | undefined | null): boolean {
  if (!ua) return false;
  return /(iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Opera Mini|IEMobile)/i.test(ua);
}

/**
 * Client-ийн илгээсэн төхөөрөмжийн id-г `X-Device-Id` header-ээс уншина.
 * `apiFetch` (frontend) нь бүх хүсэлтэд автоматаар хавсаргадаг.  Байхгүй
 * бол хоосон мөр буцаана — caller үүнийг "танигдсангүй" гэж шийднэ.
 */
export function getRequestDeviceId(c: Context): string {
  return (c.req.header('x-device-id') ?? '').trim();
}
