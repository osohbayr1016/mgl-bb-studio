/**
 * ХУВИЙН R2 bucket (`MEETING_BUCKET`)-ийн объектыг эрх шалгасны ДАРАА
 * дамжуулах туслах.  `routes/clientFiles.ts` (захиалагчийн материал) ба
 * `routes/reports.ts` (ажилтны гэрээний PDF) хоёулаа энэ нэг функцийг хэрэглэнэ.
 *
 * ЯАГААД `/media/:key` биш: тэр зам нэвтрэлтгүй, түлхүүр мэдсэн хэн ч уншдаг
 * (CLAUDE.md аюулгүй байдал #2).  Эрхээр ялгаатай файл тэнд байж БОЛОХГҮЙ.
 */
import type { Env } from '../types';

/** Кирилл нэртэй файл ч зөв татагдахын тулд RFC 5987. */
export function contentDisposition(name: string, inline = false): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const kind = inline ? 'inline' : 'attachment';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function streamPrivateObject(
  env: Env,
  key: string,
  fileName: string,
  contentType: string | null,
  opts: { inline?: boolean } = {},
): Promise<Response> {
  const object = await env.MEETING_BUCKET.get(key);
  if (!object) return new Response(JSON.stringify({ error: 'File not found' }), { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Length', String(object.size));
  // ⚠️ `private` — эдгээр нь эрхээр ялгаатай файл тул CDN дээр кэшлэхийг
  //    хориглоно (`withEdgeCache` нь хэрэглэгчээр scope хийдэггүй, ижил
  //    сургамж).
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
  headers.set('Content-Disposition', contentDisposition(fileName, opts.inline ?? false));
  return new Response(object.body, { headers });
}
