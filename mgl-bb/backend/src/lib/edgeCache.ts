import type { Context } from 'hono';
import type { Env, AppVariables } from '../types';
import { orgConfig } from './orgConfig';
import { currentTenantId, hasTenantContext } from './requestContext';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/**
 * Cloudflare Cache API helper for read-heavy authenticated GETs.
 *
 * Why a thin helper instead of a global middleware?  Most endpoints are
 * scoped to the calling user (e.g. `/api/projects` filters by role +
 * membership), so a one-size-fits-all middleware would either leak data
 * across users or cache nothing useful.  Caller-side opt-in lets us
 * pick a TTL + cache key per route.
 *
 * The cache key is a synthetic URL on the worker's own host that
 * embeds the `key` namespace and the user-vary tag, so two users with
 * different roles or ids get different cache entries.  We never use
 * the request URL directly because credentials and trailing
 * cache-busters would fragment the cache.
 *
 * Bust the cache by calling `bustEdgeCache(c, key, varyTags)` (or by
 * passing a wider `varyTags=[]` to invalidate every variant of the
 * key).  Writes that affect a cached read should always bust their
 * read counterpart in the same request.
 */
export interface EdgeCacheOptions {
  /** Logical cache namespace, e.g. "projects:list".  Forms part of the synthetic URL. */
  key: string;
  /** Extra tags that should change the cache entry, e.g. user id, role, query filters. */
  varyTags?: Array<string | number | null | undefined>;
  /** TTL in seconds.  D1 reads are quick but the worker round-trip + auth still adds ~30-50 ms. */
  ttlSeconds?: number;
}

/**
 * Cache API-ийн түлхүүр болгон ашиглах ЗОХИОМОЛ host.  Хэзээ ч DNS-ээр
 * шийдэгддэггүй — зөвхөн `caches.default` дотор түлхүүр тусгаарлах зориулалттай.
 *
 * ⚠️ `appName` ГАНЦААРАА КОМПАНИ ХООРОНД ХАНГАЛТГҮЙ (1A-4 T3):
 *   • дефолт нь БҮХ tenant-д `MGL Progress` (`orgConfig.ts` `DEFAULT_ORG_CONFIG`);
 *   • `ORG_APP_NAME` нь `[vars]` — Worker-т ГЛОБАЛ, tenant бүрт өөр байх боломжгүй;
 *   • `app_settings`-ийн `org.app_name` нь ЦОРЫН ГАНЦ tenant-тус-бүрийн зам ба
 *     СОНГОЛТТОЙ, түүнчлэн уншилт унавал `reloadOrgConfig`-ийн `catch` нь
 *     ЧИМЭЭГҮЙ дефолт руу унана → дахин нэг л slug.
 *   • `varyTags` нь ихэвчлэн `userId` / `projectId` — tenant хооронд ДАВХЦДАГ
 *     бүхэл тоо, тиймээс ялгамж болохгүй.
 * ⇒ tenant id-г түлхүүрийн ялгамжтай хэсэг болгож оруулна.  Үүнгүйгээр ACME-гийн
 *   7-р төслийн dashboard MGL-ийн 7-р төслийн кэшийг TTL-ийн турш буцаах эрсдэлтэй.
 *
 * ⚠️ `hasTenantContext()` -ийг ЗОРИУДААР хэрэглэв — энэ бол түүний ЗӨВ хэрэглээ:
 *    `withEdgeCache` / `bustEdgeCache` -ийг ЗӨВХӨН route handler дуудна, route
 *    бүр `index.ts`-ийн `runWithTenant(...)`-ийн ДОТОР ажилладаг.  (Харьцуул:
 *    `tenantEnv` ДОТОР энэ функц дуудвал ҮХСЭН КОД — тэр нь `runWithTenant`-ээс
 *    ӨМНӨ ажилладаг.  Дэлгэрэнгүйг `lib/requestContext.ts`-ийн хүснэгтээс үз.)
 *    Ингэснээр НЭГ-tenant суулгацад түлхүүр нь өмнөхтэй БАЙТ-ИЖИЛ хэвээр үлдэж,
 *    deploy-ийн дараах кэш алдалт ОГТ гарахгүй; олон-tenant үед л шинэ хэсэг
 *    нэмэгдэнэ.
 */
function cacheHost(): string {
  const slug = orgConfig()
    .appName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const base = `__edge_cache__.${slug || 'app'}.internal`;
  if (!hasTenantContext()) return `https://${base}`;
  const tid =
    currentTenantId()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tenant';
  return `https://${tid}.${base}`;
}

function buildCacheRequest(opts: EdgeCacheOptions): Request {
  const tags = (opts.varyTags ?? []).map((t) => (t == null ? '' : String(t))).join('|');
  const url = `${cacheHost()}/${encodeURIComponent(opts.key)}?v=${encodeURIComponent(tags)}`;
  return new Request(url, { method: 'GET' });
}

/**
 * Wrap a JSON-returning handler in an edge cache lookup.  The handler
 * is called only on miss; its return value is JSON-stringified, stored
 * with a short TTL, and returned to the caller.
 */
/* ------------------------------------------------------------------ */
/*  Isolate-ийн санах ойн давхарга (2026-09-11, D1 rows_read аудит)    */
/* ------------------------------------------------------------------ */
/**
 * Cache API-ийн ӨМНӨХ, isolate доторх санах ойн давхарга.
 *
 * Яагаад: Cache API нь colo тус бүрд байдаг ба `cache.put` нь асинхрон,
 * харин ТВ самбар (`/company/overview` минут тутам), `/ticker` (хэрэглэгч
 * бүр 5 минут тутам), `/teams` (бүх dropdown) зэрэг нь ижил isolate руу
 * дараалан ирдэг тул санах ойн хит нь D1-д ОГТ хүрэхгүй.  Мөн Cache API
 * ямар нэг шалтгаанаар (workers.dev-ийн хязгаар, Access, preview) идэвхгүй
 * байсан ч энэ давхарга ажиллана.
 *
 * ⚠️ TTL нь Cache API-тайгаа ИЖИЛ, ба «TTL бол жинхэнэ баталгаа» гэсэн
 *    зарчим хэвээр: `bustEdgeCache` нь зөвхөн ӨӨРИЙН isolate-ийн санах ой
 *    ба ӨӨРИЙН colo-гийн Cache API-г цэвэрлэнэ (өмнө нь ч Cache API colo
 *    хооронд тархдаггүй байсан).  Тиймээс энд урт TTL тавихгүй.
 *
 * Хэмжээ: `MEMORY_MAX_ENTRIES`-ээс хэтэрвэл хамгийн хуучныг хаяна.  Утга нь
 * JSON мөр (ихэвчлэн 5-400 KB), 256 × ~50 KB ≈ 13 MB — isolate-ийн 128 MB-д багтана.
 */
interface MemEntry {
  expiresAt: number;
  body: string;
  cacheControl: string;
}
const MEMORY_MAX_ENTRIES = 256;
const memoryTier = new Map<string, MemEntry>();

function memGet(key: string): MemEntry | undefined {
  const hit = memoryTier.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memoryTier.delete(key);
    return undefined;
  }
  return hit;
}

function memSet(key: string, entry: MemEntry): void {
  if (memoryTier.size >= MEMORY_MAX_ENTRIES) {
    // Map нь оруулсан дарааллаа хадгалдаг — эхнийх нь хамгийн хуучин.
    const oldest = memoryTier.keys().next().value;
    if (oldest !== undefined) memoryTier.delete(oldest);
  }
  memoryTier.set(key, entry);
}

/** Тест/оношилгоо — санах ойн давхаргыг бүхэлд нь цэвэрлэнэ. */
export function clearEdgeMemoryCache(): void {
  memoryTier.clear();
}

function jsonResponse(body: string, cacheControl: string, tier: 'MEM' | 'HIT' | 'MISS'): Response {
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      // Оношилгоо: prod дээр `curl -I`-ээр Cache API ажиллаж буйг шалгах —
      // HIT/MEM хэзээ ч гарахгүй бол кэш идэвхгүй гэсэн үг.
      'x-edge-cache': tier,
    },
  });
}

export async function withEdgeCache<T>(
  c: AppContext,
  opts: EdgeCacheOptions,
  produce: () => Promise<T>,
): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheReq = buildCacheRequest(opts);
  const memKey = cacheReq.url;
  const ttl = opts.ttlSeconds ?? 30;

  // 1) Isolate-ийн санах ой — D1 ч, Cache API ч хүрэхгүй.
  const mem = memGet(memKey);
  if (mem) return jsonResponse(mem.body, mem.cacheControl, 'MEM');

  // 2) Cache API (colo-гийн хамтын кэш).
  const hit = await cache.match(cacheReq);
  if (hit) {
    const body = await hit.text();
    const cacheControl = hit.headers.get('cache-control') ?? `public, max-age=0, s-maxage=${ttl}`;
    // Cache API-ийн үлдсэн насыг мэдэхгүй тул санах ойд БҮТЭН TTL-ээр биш,
    // хагасаар нь хадгална — хамгийн муудаа 1.5 × TTL хуучрана.
    memSet(memKey, { expiresAt: Date.now() + (ttl * 1000) / 2, body, cacheControl });
    return jsonResponse(body, cacheControl, 'HIT');
  }

  const data = await produce();
  const body = JSON.stringify(data);
  // `s-maxage` is what Cloudflare's edge cache honours; `max-age=0`
  // tells browsers/intermediate caches not to keep the result so
  // role-based variance isn't accidentally exposed.
  const cacheControl = `public, max-age=0, s-maxage=${ttl}`;
  memSet(memKey, { expiresAt: Date.now() + ttl * 1000, body, cacheControl });
  const response = jsonResponse(body, cacheControl, 'MISS');

  // Store an independent clone so the body can still be sent to the caller.
  c.executionCtx.waitUntil(cache.put(cacheReq, response.clone()));
  return response;
}

/**
 * Invalidate one or more cache variants.  Use after a mutation that
 * affects a cached read, before returning the success response.
 *
 * ⚠️ Зөвхөн ЭНЭ isolate-ийн санах ой + ЭНЭ colo-гийн Cache API.  Бусад
 *    isolate/colo TTL дуустал хуучин утгаа буцаана — өмнөхтэй ижил зарчим.
 */
export async function bustEdgeCache(c: AppContext, opts: EdgeCacheOptions): Promise<void> {
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheReq = buildCacheRequest(opts);
  memoryTier.delete(cacheReq.url);
  c.executionCtx.waitUntil(cache.delete(cacheReq).then(() => undefined));
}
