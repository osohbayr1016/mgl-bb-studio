/**
 * `mcp/guard.ts` — MCP хилийн хаалтын тест.
 *
 * ХАМГИЙН ЧУХАЛ КЕЙС нь `worker` role-ийн эрхийн давалт: тэр хэрэглэгч
 * `/api/*` дээр `workerScopeGuard`-аар хаагддаг ч `/mcp` нь тэр хаалтын
 * ГАДНА байсан тул `get_company_overview` (REST хос нь 403) хүртэл нээгдэж
 * байсан.  Мөн зам таарууллын кейсүүд: provider `startsWith`-ээр илгээдэг
 * тул `/mcpX`, `/sse/message` хоёрыг ЗААВАЛ барих ёстой.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { checkMcpAccess, isMcpPath, MCP_ROUTES, MCP_DENIED_ROLES } = await import('./guard.ts');

/* ---------------- 1-4: зам таарууллт ---------------- */

test('isMcpPath — үндсэн хоёр зам', () => {
  assert.equal(isMcpPath('/mcp'), true);
  assert.equal(isMcpPath('/sse'), true);
});

test('isMcpPath — legacy SSE-ийн хүүхэд зам ЗААВАЛ баригдана', () => {
  // `agents/dist/mcp/index.js:396` нь клиентэд `{basePath}/message`-ыг өгдөг
  // бөгөөд JSON-RPC дуудлага БҮР тэнд POST хийгддэг (:458).  ЯГ ТЭНЦҮҮ
  // тааруулалт нь tool дуудлага бүрийг хаалтаас гаргана.
  assert.equal(isMcpPath('/sse/message'), true);
  assert.equal(isMcpPath('/sse/message?sessionId=x'), true);
  assert.equal(isMcpPath('/mcp/'), true);
});

test('isMcpPath — provider startsWith тул /mcpX ч баригдана', () => {
  // `oauth-provider.js:1042-1050` — `url.pathname.startsWith(route)`.
  // Тиймээс `/mcpX` нь MCP handler руу ОЧДОГ; хаалт нь тэр семантикийг
  // ЯГ давтах ёстой, эс бөгөөс тойрч гарах зам үлдэнэ.
  assert.equal(isMcpPath('/mcpX'), true);
  assert.equal(isMcpPath('/mcp-anything'), true);
  assert.equal(isMcpPath('/sseX'), true);
});

test('isMcpPath — MCP биш замууд', () => {
  assert.equal(isMcpPath('/api/projects'), false);
  assert.equal(isMcpPath('/media/x'), false);
  assert.equal(isMcpPath('/'), false);
  assert.equal(isMcpPath('/authorize'), false);
  assert.equal(isMcpPath('/token'), false);
});

test('MCP_ROUTES — жагсаалт нь index.ts-ийн apiHandlers-тай нэг эх сурвалж', () => {
  assert.deepEqual([...MCP_ROUTES], ['/mcp', '/sse']);
});

/* ---------------- 5-6: таних тэмдэггүй ---------------- */

test('checkMcpAccess — props огт байхгүй бол 401', () => {
  const v = checkMcpAccess(undefined, null);
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.status, 401);
  assert.equal(v.ok === false && v.code, 'mcp_no_identity');
});

test('checkMcpAccess — дутуу/буруу хэлбэрийн props бүгд 401', () => {
  for (const bad of [null, {}, { sub: '2' }, { sub: 2 }, { role: 'admin' }, 'admin', 42]) {
    const v = checkMcpAccess(bad, null);
    assert.equal(v.ok, false, `хүлээгдээгүйгээр нэвтэрлээ: ${JSON.stringify(bad)}`);
    assert.equal(v.ok === false && v.status, 401);
    assert.equal(v.ok === false && v.code, 'mcp_no_identity');
  }
});

/* ---------------- 7-8, 12-13: role ---------------- */

test('checkMcpAccess — worker role 403 (эрхийн давалтын гол кейс)', () => {
  const v = checkMcpAccess({ sub: 9, role: 'worker' }, null);
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.status, 403);
  assert.equal(v.ok === false && v.code, 'mcp_role_denied');
});

test('checkMcpAccess — admin нэвтэрнэ', () => {
  const v = checkMcpAccess({ sub: 2, role: 'admin' }, null);
  assert.equal(v.ok, true);
  assert.equal(v.ok === true && v.sub, 2);
  assert.equal(v.ok === true && v.role, 'admin');
});

test('checkMcpAccess — client одоогоор ЗӨВШӨӨРӨГДСӨН (бүтээгдэхүүний шийдвэр)', () => {
  // §9.3 — `client`-ыг хаах эсэх нь эзний шийдвэр.  Энэ сесс `worker`-ыг Л
  // хаасан; өөрчлөх бол ЭНЭ тестийг зориудаар шинэчил.
  const v = checkMcpAccess({ sub: 40, role: 'client' }, null);
  assert.equal(v.ok, true);
});

test('MCP_DENIED_ROLES — одоогийн шийдвэрийг бэхлэх regression', () => {
  assert.equal(MCP_DENIED_ROLES.includes('worker'), true);
  assert.equal(MCP_DENIED_ROLES.includes('client'), false);
  assert.equal(MCP_DENIED_ROLES.includes('admin'), false);
  assert.equal(MCP_DENIED_ROLES.includes('engineer'), false);
  assert.equal(MCP_DENIED_ROLES.includes('architect'), false);
  assert.equal(MCP_DENIED_ROLES.includes('senior'), false);
});

/* ---------------- 9-11: tenant хил ---------------- */

test('checkMcpAccess — олон-tenant үед tid дутуу бол 403', () => {
  const v = checkMcpAccess({ sub: 2, role: 'admin' }, 'mgl');
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.status, 403);
  assert.equal(v.ok === false && v.code, 'mcp_tenant_mismatch');
});

test('checkMcpAccess — өөр компанийн tid бол 403', () => {
  const v = checkMcpAccess({ sub: 2, role: 'admin', tid: 'acme' }, 'mgl');
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, 'mcp_tenant_mismatch');
});

test('checkMcpAccess — tid таарвал нэвтэрнэ', () => {
  const v = checkMcpAccess({ sub: 2, role: 'admin', tid: 'mgl' }, 'mgl');
  assert.equal(v.ok, true);
});

test('checkMcpAccess — НЭГ-tenant үед tid-тэй ч, tid-гүй ч нэвтэрнэ', () => {
  // `expectedTenantId === null` → шалгалт бүрэн алгасагдана.  Ингэснээр
  // `OAUTH_KV`-д аль хэдийн байгаа tid-гүй grant-ууд хүчинтэй хэвээр үлдэнэ
  // (`middleware/auth.ts:80-88`-ийн `hasTenantContext()` хэв маягтай ижил).
  assert.equal(checkMcpAccess({ sub: 2, role: 'admin' }, null).ok, true);
  assert.equal(checkMcpAccess({ sub: 2, role: 'admin', tid: 'acme' }, null).ok, true);
});

test('checkMcpAccess — role хаалт нь tenant шалгалтаас ӨМНӨ ажиллана', () => {
  // Хориотой role нь tid таарсан ч орж болохгүй.
  const v = checkMcpAccess({ sub: 9, role: 'worker', tid: 'mgl' }, 'mgl');
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, 'mcp_role_denied');
});
