import { Hono } from 'hono';
import type { Env } from '../types';
import { isSingleSegmentKey } from '../lib/mediaUrl';
import { detectCharset, hasCharset, isTextFileName, textContentType } from '../lib/textCharset';

const media = new Hono<{ Bindings: Env }>();

/* ---------------------------------------------------------------------------
 * Хуучин акаунтын R2-оос нөхөж татах (2026-08-25)
 * ---------------------------------------------------------------------------
 * 2026-08-24-ний нүүлгэлтийн үед D1 бүтнээрээ шинэ (компанийн) акаунт руу
 * хуулагдсан ч R2 нь ӨӨР АГШИНД — ~2026-08-21-нд — хуулагдсан.  Ажилтнууд
 * D1 солигдох хүртэл ХУУЧИН сайтыг үргэлжлүүлэн хэрэглэсэн тул тэр хоёр
 * агшны хооронд байршуулсан бүх файл (ЗХ-ын зураг, гарын үсэг, хавсралт…)
 * шинэ bucket-д ОРООГҮЙ үлдсэн: мөр нь D1-д байгаа, байт нь хуучин
 * акаунтад.  Хэмжилт (2026-08-25): хуучин 11,290 объект / 8.35 GB, шинэ
 * 11,231 / 8.34 GB — 59 объектын зөрүү.  Илрэл нь `/app/asr/28`-ын эвдэрсэн
 * зургууд, гарын үсэг байхгүй PDF.
 *
 * Тиймээс: `MEDIA_BUCKET`-д ОЛДООГҮЙ түлхүүрийг хуучин origin-оос нэг удаа
 * татаж, хэрэглэгч рүү дамжуулахын ЗЭРЭГЦЭЭ шинэ bucket руу БИЧНЭ.  Дараагийн
 * хүсэлт локал хит болно — өөрөөр хэлбэл харагдсан объект бүр аяндаа
 * нүүнэ, хуучин акаунтаас хамаарах хамаарал өөрөө хатна.
 *
 * ⚠️ Аюулгүй байдал: origin нь `[vars]`-аас ирдэг ГАНЦ хатуу утга тул SSRF
 *    болох зам байхгүй.  `LEGACY_MEDIA_ORIGIN` хоосон бол бүхэлдээ унтарна —
 *    хуучин акаунтыг хаамагц энэ мөрийг арилгана.
 *
 * ⚠️ ЭНД УРЬД ХУДАЛ ҮНДЭСЛЭЛ БИЧИГДСЭН БАЙСАН: «хуучин `/media/:key` нь аль
 *    хэдийн түлхүүрээрээ нээлттэй (docs-ийн Security #2), route нь ЯГ НЭГ
 *    СЕГМЕНТ тул хавтастай түлхүүр хэзээ ч уншигдахгүй».  Хоёрдугаар хагас
 *    нь ХУДАЛ: Hono нь `%2F`-ыг ЗАДАЛЖ нэг сегментийн route-оор ОЛОН
 *    сегментийн түлхүүрт хүргэдэг (бүрэн тайлбар `lib/mediaUrl.ts`-ийн
 *    толгойд).  Шалгалт нь тиймээс `isSingleSegmentKey`-д, ЗАДАЛСАН утган
 *    дээр хийгддэг — доорх route-ыг үз.
 * ------------------------------------------------------------------------ */

/** Хуучин origin-оос нөхөх дээд хэмжээ.  Worker-ийн санах ой 128 MB тул
 *  бүтнээр нь буфферлэхийн өмнө хязгаарлана.  Үүнээс том нь зөвхөн
 *  дамжуулагдана (тийм объект бүгд IFC/XKT загвар бөгөөд огтлолын цэгээс
 *  өмнөх учир аль хэдийн шинэ bucket-д байгаа). */
const BACKFILL_MAX_BYTES = 32 * 1024 * 1024;

/** Кодчлол илрүүлэхийн тулд бүтнээр нь буфферлэж болох текст файлын хэмжээ. */
const TEXT_SNIFF_MAX_BYTES = 8 * 1024 * 1024;

function mediaHeaders(contentType: string | null, size: number | null, etag: string | null): Headers {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  if (etag) headers.set('etag', etag);
  // writeHttpMetadata does NOT emit Content-Length, so without this the body
  // streams chunked and clients can't know the size up front. The QTO compute
  // path relies on a Content-Length pre-check to reject oversized .ifc models
  // BEFORE downloading them (a >500 MB model OOM-crashes the in-browser
  // takeoff); it also enables download progress bars elsewhere.
  if (size !== null) headers.set('content-length', size.toString());
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  // Allow cross-origin reads from COEP pages (e.g. the IFC viewer
  // page that turns on Cross-Origin-Embedder-Policy to enable
  // SharedArrayBuffer / multi-threaded web-ifc parsing).
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return headers;
}

/** Cache API-д хадгалах объектын дээд хэмжээ (том IFC/загварыг кэшлэхгүй). */
const EDGE_CACHE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Colo-гийн Cache API-д хадгалж болох хариу мөн үү.  Түлхүүр нь хэзээ ч
 * дахин бичигддэггүй (`<sub>-<ms>-<rand>-<нэр>` — routes/upload.ts) тул
 * нэг жилийн `max-age` + immutable аюулгүй; ижил түлхүүр дээр өөр байт
 * гарах цорын ганц зам нь хуучин акаунтаас нөхөх (backfill) бөгөөд тэр ч
 * ижил байт хуулна.
 */
function cacheable(res: Response, size: number | null): boolean {
  return res.status === 200 && size !== null && size <= EDGE_CACHE_MAX_BYTES;
}

// GET /media/:key
media.get('/:key', async (c) => {
  const key = c.req.param('key');

  /* 2026-09-11 (R2 аудит): зураг/PDF бүр Worker хүсэлт + R2 Class B GET байв
   * — нэг avatar-ыг 50 ажилтан 50 удаа R2-оос уншдаг.  Colo-гийн Cache API
   * (`caches.default`) нь ижил URL-ийн хоёр дахь уншилтаас эхлэн R2-д ОГТ
   * хүрэхгүй; кэшийн түлхүүр нь хүсэлтийн URL өөрөө (query string орно).
   * `?`-тэй хүсэлт ирдэггүй тул нэг объект = нэг түлхүүр. */
  const edge = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(new URL(c.req.url).toString(), { method: 'GET' });
  const cached = await edge.match(cacheKey);
  if (cached) return cached;

  /* ⚠️ Hono нь `%2F` (ба жижиг үсгээр `%2f`)-ыг задалж НЭГ СЕГМЕНТИЙН
   * route-оор ОЛОН сегментийн түлхүүрт хүргэдэг (`lib/mediaUrl.ts`-ийн
   * толгойн тайлбарыг үз).  Ингэснээр `email/<acc>/<gmailId>/body.html`
   * (и-мэйлийн бие ба хавсралт — REST талдаа `requireAdmin()`) болон
   * `revit-addin/…zip` (эзэмшигчид зориулсан суулгагч, энтропи ТЭГ) зэрэг
   * угтвар дор байгаа БҮХ объект баталгаажуулалтгүй уншигдаж байсан.
   * Тиймээс bucket руу хүрэхЭЭС ӨМНӨ таслана.
   *
   * Хаалт нь legacy fetch-ЭЭС ӨМНӨ байх ЁСТОЙ: `encodeURIComponent(key)`
   * нь задарсан `/`-ыг `%2F` болгож БУЦААЖ кодлодог тул эс бөгөөс дамжлага
   * хуучин акаунтын bucket руу үргэлжилнэ.
   *
   * 404 (`c.notFound()`) сонгосон нь 403 БИШ — байгаа/байхгүйг ялгаж
   * мэдэгдэхгүй бөгөөд одоо байгаа «олдсонгүй» зан төлөвтэй ижил. */
  if (!isSingleSegmentKey(key)) return c.notFound();

  const object = await c.env.MEDIA_BUCKET.get(key);

  if (object) {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('content-length', object.size.toString());
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

    /* `.txt`/`.log`/`.md`-г Chrome дотор МӨРӨӨР нь, кирилл нь эвдрэлгүй
     * харуулна.  Шинэ файлын charset нь байршуулах үед илэрч R2-д
     * хадгалагддаг (`routes/upload.ts`); ӨМНӨ нь орсон файлууд charset-гүй
     * `text/plain` эсвэл `application/octet-stream` гэж хадгалагдсан тул
     * тэднийг ЭНД байтаас нь илрүүлнэ.  Текст файл жижиг тул бүтнээр нь
     * унших нь хямд — хязгаараас том бол зөвхөн UTF-8 гэж таамаглана.
     *
     * Аюулгүй байдал: зөвхөн эдгээр гурван өргөтгөл дээр ажиллана, гаралт нь
     * үргэлж `text/plain` — HTML/скрипт болж хувирах зам байхгүй. */
    if (isTextFileName(key) && !hasCharset(headers.get('content-type'))) {
      if (object.size <= TEXT_SNIFF_MAX_BYTES) {
        const bytes = await object.arrayBuffer();
        headers.set('content-type', textContentType(detectCharset(bytes)));
        const res = new Response(bytes, { headers });
        c.executionCtx.waitUntil(edge.put(cacheKey, res.clone()));
        return res;
      }
      headers.set('content-type', textContentType('utf-8'));
    }
    const res = new Response(object.body, { headers });
    if (cacheable(res, object.size)) c.executionCtx.waitUntil(edge.put(cacheKey, res.clone()));
    return res;
  }

  // --- Олдсонгүй: хуучин акаунтын bucket-аас нөхөж үзнэ ---------------
  const legacy = (c.env.LEGACY_MEDIA_ORIGIN ?? '').replace(/\/$/, '');
  if (!legacy) return c.notFound();

  let res: Response;
  try {
    res = await fetch(`${legacy}/media/${encodeURIComponent(key)}`, {
      cf: { cacheEverything: false },
    });
  } catch (err) {
    console.warn('[media] legacy fetch failed', key, err);
    return c.notFound();
  }
  if (!res.ok || !res.body) return c.notFound();

  const contentType = res.headers.get('content-type');
  const lenHeader = res.headers.get('content-length');
  const size = lenHeader === null ? null : Number(lenHeader);

  // Хэмжээ нь мэдэгдэхгүй эсвэл хэт том — зөвхөн дамжуулна, хуулахгүй.
  if (size === null || !Number.isFinite(size) || size > BACKFILL_MAX_BYTES) {
    return new Response(res.body, { headers: mediaHeaders(contentType, size, res.headers.get('etag')) });
  }

  // Бүтнээр нь уншаад ЗЭРЭГ буцааж, ЗЭРЭГ шинэ bucket руу бичнэ.  `tee()`
  // ашиглаагүй шалтгаан: R2 `put` нь урт нь мэдэгдэхгүй урсгалыг татгалздаг
  // бөгөөд энэ замаар явах объектууд бүгд ≤32 MB.
  const bytes = await res.arrayBuffer();
  c.executionCtx.waitUntil(
    c.env.MEDIA_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: contentType ?? 'application/octet-stream' },
      customMetadata: { backfilledFrom: 'legacy', backfilledAt: new Date().toISOString() },
    })
      .then(() => console.log('[media] backfilled from legacy', key, bytes.byteLength))
      .catch((err) => console.warn('[media] backfill put failed', key, err)),
  );

  const out = new Response(bytes, {
    headers: mediaHeaders(contentType, bytes.byteLength, res.headers.get('etag')),
  });
  c.executionCtx.waitUntil(edge.put(cacheKey, out.clone()));
  return out;
});

export default media;
