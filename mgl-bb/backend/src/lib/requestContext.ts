import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * ХҮСЭЛТИЙН КОНТЕКСТ — «энэ хүсэлт аль компанийнх вэ» гэдгийг sync уншина.
 *
 * ЯАГААД `AsyncLocalStorage` ХЭРЭГТЭЙ ВЭ:
 *
 * `lib/orgConfig.ts`-ийн `orgConfig()` нь SYNC байх ёстой — түүнийг
 * `isSummerSchedule()`, `SHIFTS`, `excludeCeoSql()` зэрэг цэвэр функцүүд
 * дуудаг бөгөөд тэдгээрийг async болгох нь 25 газар засах шаардлага үүсгэнэ.
 *
 * Нэг-tenant үед тохиргоог модулийн түвшний хувьсагчид хадгалж болно.  Гэвч
 * НЭГ Worker олон компанийг үйлчлэхэд тэр нь ЭВДЭРНЭ:
 *
 *   Worker-ийн isolate дотор JS нь нэг урсгалтай ч, хүсэлтүүд `await` цэг
 *   бүр дээр СОЛБИЦДОГ.  Тиймээс «хүсэлтийн эхэнд глобал хувьсагчийг тавих»
 *   арга нь A компанийн хүсэлт await дээр зогсох хооронд B компанийн хүсэлт
 *   тэр хувьсагчийг дарж бичих боломж өгнө → A нь B-гийн тохиргоогоор
 *   үргэлжилнэ.  Энэ бол чимээгүй, давтагдашгүй, аюултай алдаа.
 *
 * `AsyncLocalStorage` нь async гинжин хэлхээ бүрт ТУСДАА хадгалдаг тул энэ
 * уралдаан үүсэхгүй.  Cloudflare Workers дээр `nodejs_compat` тугтай үед
 * дэмжигддэг — 16 зэрэгцээ хүсэлтээр бодитоор шалгасан (2026-08-21).
 */

export interface RequestContext {
  /** `lib/tenants.ts`-ийн `TenantSpec.id`. */
  tenantId: string;
}

/**
 * Контекст тавиагүй үеийн id — нэг-tenant суулгац, cron, Durable Object,
 * unit test бүгд үүнийг хэрэглэнэ.  Ингэснээр олон-tenant тохируулаагүй
 * систем өнөөдрийнхтэй яг ижил ажиллана.
 */
export const DEFAULT_TENANT_ID = 'default';

const storage = new AsyncLocalStorage<RequestContext>();

/** Тухайн компанийн контекстэд `fn`-ийг ажиллуулна. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return storage.run({ tenantId }, fn);
}

/** Одоогийн компанийн id.  Контекстгүй бол {@link DEFAULT_TENANT_ID}. */
export function currentTenantId(): string {
  return storage.getStore()?.tenantId ?? DEFAULT_TENANT_ID;
}

/**
 * Контекст бодитоор тавигдсан эсэх (олон-tenant горим идэвхтэй эсэх).
 *
 * ⚠️ АНГИЛЛЫН АЛДАА — ЭНЭ ФУНКЦИЙГ ХЭРЭГЛЭХЭЭСЭЭ ӨМНӨ УНШ.
 *
 * `runWithTenant` нь `index.ts`-ийн `fetch`-ийн ХАМГИЙН СҮҮЛД (провайдер руу
 * дамжуулах мөрөнд) дуудагддаг.  Тиймээс түүнээс ӨМНӨ ажилладаг ямар ч код
 * дотор `hasTenantContext()` нь олон-tenant горимд ч ҮРГЭЛЖ `false` буцаана —
 * тэнд бичсэн шалгалт нь ҮХСЭН КОД бөгөөд чимээгүй fail-open болно.
 *
 * | Дуудлага                    | `runWithTenant`-ийн дотор уу | Дүгнэлт |
 * |-----------------------------|------------------------------|---------|
 * | `lib/jwt.ts` (`tid` шигтгэх)| ТИЙМ (route → `signToken`)   | ЗӨВ |
 * | `middleware/auth.ts` (`tid` хил) | ТИЙМ (`app.use('/api/*', …)`) | ЗӨВ |
 * | `oauth/authorize.ts` (grant-д `tid`) | ТИЙМ (Hono root route) | ЗӨВ |
 * | `index.ts` `guardMcp`       | ТИЙМ (`oauthProvider.fetch` дотор) | ЗӨВ |
 * | `lib/edgeCache.ts` `cacheHost` | ТИЙМ (зөвхөн route handler дуудна) | ЗӨВ |
 * | `index.ts` `fetch`-ийн tenant шийдвэрлэлт | **ҮГҮЙ** | ҮХСЭН КОД — `tenants !== null`-ыг хэрэглэ |
 * | `lib/tenants.ts` (`tenantEnv` г.м.) | **ҮГҮЙ** | Дуудлага БАЙХГҮЙ ба байх ч ЁСГҮЙ |
 * | `index.ts` `scheduled`      | **ҮГҮЙ** (давталтын дотор л ТИЙМ) | Cron нь `runWithTenant`-аа өөрөө тавина |
 * | `mcp/MglMcpAgent.ts`        | **ҮГҮЙ** — DO нь ALS хилийг давдаггүй | DO дотор хэрэглэхгүй |
 */
export function hasTenantContext(): boolean {
  return storage.getStore() !== undefined;
}
