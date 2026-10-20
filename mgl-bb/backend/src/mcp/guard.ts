import type { UserRole } from '../types';

/**
 * MCP ХИЛИЙН ХААЛТ — цэвэр, тестлэгдэх шийдвэрүүд.
 *
 * ЯАГААД ЭНЭ ФАЙЛ БАЙГАА ВЭ:  `/api/*` дээр гурван хамгаалалтын давхарга
 * дараалан суудаг (`authMiddleware`, `workerScopeGuard`, `entitlementGuard`
 * — `index.ts`-ийн `app.use('/api/*', …)` мөрүүд).  `/mcp` ба `/sse` нь
 * OAuth provider-ийн эзэмшдэг ROOT замууд тул Hono-гийн middleware гинжинд
 * ОГТ ОРДОГГҮЙ — гурвуулангийнх нь ГАДНА үлддэг.  Тэр цоорхойг нөхөх
 * шийдвэрүүдийг ЭНД төвлөрүүлж, `index.ts`-ийн маршрутын жагсаалттай нэг
 * эх сурвалжаас уншина.
 */

/**
 * MCP-Д ХЭЗЭЭ Ч ОРУУЛАХГҮЙ role.
 *
 * `worker` (цэвэрлэгч) нь `lib/workerScope.ts`-ийн цагаан жагсаалтаар
 * `/api/*` дээр ирц/чөлөө/профайлаас өөр юунд ч хүрдэггүй.  `/mcp` нь тэр
 * хаалтын ГАДНА тул шат нь түүнд `get_company_overview` хүртэл нээж байсан —
 * түүний REST хос нь 403 өгдөг зүйл.
 *
 * ⚠️ Энэ бол цагаан биш ХАР жагсаалт: MCP-ийн шат нь `role !== 'client'`
 *    дээр суурилдаг тул ШИНЭ role нэмэгдэхэд анхдагчаар НЭЭЛТТЭЙ болдог.
 *    Role нэмэх бүрд ЭНД шийдвэр гарга.
 */
export const MCP_DENIED_ROLES: readonly UserRole[] = ['worker'] as const;

/**
 * OAuth provider-ийн `apiHandlers` түлхүүрүүд.
 *
 * ⚠️ Хаалт ба маршрут САЛЖ БОЛОХГҮЙ тул `index.ts` нь ЭНЭ жагсаалтаас
 *    handler map-аа барьж, `tsc`-ээр хамралтыг шалгадаг.
 */
export const MCP_ROUTES = ['/mcp', '/sse'] as const;

/**
 * Provider-ийн `matchApiRoute` нь `url.pathname.startsWith(route)`
 * (`@cloudflare/workers-oauth-provider@0.7.2`,
 * `dist/oauth-provider.js:1042-1050`).  Тиймээс `/mcpX` ч тэр handler руу
 * очно.  ЯГ ТЭР семантикийг давтана — сегментийн хилээр (`p` эсвэл `p + '/'`)
 * тааруулбал `/mcpX` хаалтыг тойрч гарна.
 *
 * Мөн legacy SSE нь `/sse/message` дээр JSON-RPC POST хүлээн авдаг
 * (`agents@0.15.0`, `dist/mcp/index.js:387,396,458`) — ЯГ ТЭНЦҮҮ тааруулалт
 * нь tool дуудлага бүрийг алдана.
 */
export function isMcpPath(pathname: string): boolean {
  return MCP_ROUTES.some((r) => pathname.startsWith(r));
}

export type McpVerdict =
  | { ok: true; sub: number; role: UserRole }
  | { ok: false; status: 401 | 403; code: string; message: string };

/**
 * `ctx.props`-ыг шалгана.  ХОЁР эх үүсвэр ЭНД НИЙЛНЭ:
 *   • OAuth access token → `oauth-provider.js:2025` `decryptProps`
 *   • legacy JWT        → `oauth-provider.js:2046` `resolveExternalToken`
 * Тиймээс `resolveExternalToken` ДОТОР шалгах нь зөвхөн хоёр дахийг барина.
 *
 * @param props             `ctx.props` — provider тавьсан байна (`:2054`-ийн өмнө).
 * @param expectedTenantId  Олон-tenant үед хүсэлтийн tenant id; НЭГ-tenant
 *   суулгацад `null` (тэр үед `tid` шалгалт бүрэн алгасагдана, хуучин
 *   токенууд хүчинтэй хэвээр — `middleware/auth.ts:80-88`-тай ижил зан).
 */
export function checkMcpAccess(props: unknown, expectedTenantId: string | null): McpVerdict {
  if (typeof props !== 'object' || props === null) {
    return { ok: false, status: 401, code: 'mcp_no_identity', message: 'Нэвтрэлт шаардлагатай' };
  }
  const p = props as { sub?: unknown; role?: unknown; tid?: unknown };
  if (typeof p.sub !== 'number' || typeof p.role !== 'string') {
    return { ok: false, status: 401, code: 'mcp_no_identity', message: 'Нэвтрэлт шаардлагатай' };
  }
  const role = p.role as UserRole;
  if ((MCP_DENIED_ROLES as readonly string[]).includes(role)) {
    return { ok: false, status: 403, code: 'mcp_role_denied', message: 'Энэ хэсэгт хандах эрхгүй' };
  }
  if (expectedTenantId !== null && p.tid !== expectedTenantId) {
    return {
      ok: false,
      status: 403,
      code: 'mcp_tenant_mismatch',
      message: 'Байгууллагын хил зөрчигдлөө',
    };
  }
  return { ok: true, sub: p.sub, role };
}
