# 1A-4-tenant-preflight — Tenant бэлтгэл — TENANTS утга бичихээс өмнө хаах ёстой зүйлс

> **Track:** 1A ПРОДАКШНЫ АЮУЛГҮЙ БАЙДАЛ · **Хамаарал (depends on):** 1A-1 (`/media/:key` түлхүүрээр нээлттэй) — уншсан байх ёстой, гэхдээ ажлыг блоклохгүй · **Блоклож буй (blocks):** `wrangler.toml`-д ЭХНИЙ `TENANTS` утга бичих БҮХ ажил; олон компанид зарах бүх төлөвлөгөө · **Хөндөх файлууд:** `backend/src/lib/tenants.ts`, `backend/src/lib/tenants.test.ts`, `backend/src/lib/edgeCache.ts`, `backend/src/index.ts`, (сонголтоор) `backend/src/routes/media.ts`, `backend/src/types.ts` · **Deploy тоо:** 1 (зөвхөн worker; migration ШААРДЛАГАГҮЙ)

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ:** ЗӨВХӨН backend, ЗӨВХӨН дээрх 6 файл. Энэ бол олон-tenant горимыг **асаах** ажил БИШ — `TENANTS` утгыг бичих гэж байгаа хэн нэгэнд зориулж **хаалтуудыг урьдчилан хаах** ажил.

**ХӨНДӨХГҮЙ:**

| Юу | Яагаад |
|---|---|
| `backend/src/lib/jwt.ts`-ийн `verifyToken`, `backend/src/middleware/auth.ts`-ийн `authMiddleware` | Программын хэмжээний хатуу дүрэм: `purpose === 'mcp'` токеныг `/api/*` дээр татгалзахаар **ХЭЗЭЭ Ч** чангатгаж болохгүй. Revit нэмэлт REST дуудлага бүрээ тэр токеноор баталгаажуулдаг ба refresh урсгал БАЙХГҮЙ. Энэ бол алсаас сэргээх боломжгүй ГАНЦ өөрчлөлт (~20 PC, `Install.bat`, Revit хаалттай). |
| `middleware/auth.ts:78–89`-ийн tenant хил | Аль хэдийн ЗӨВ (§2.9). Хөндөх шаардлагагүй. |
| Ямар ч C# (`revit-mcp/addin/`) | Бүх нэмэлтийн өөрчлөлт НЭГ релиз болж багцлагдана. Энэ ажилд C# өөрчлөлт байхгүй. |
| `backend/migrations/` | Энэ ажилд migration шаардлагагүй. Шинэ файл нэмэх нь бусад агентын дугаартай мөргөлдөнө. |
| `backend/wrangler.toml` | `TENANTS` утга бичих нь **ӨӨР, ДАРААГИЙН** ажил. Энэ сесс тэр файлыг хөндөхгүй. |
| Frontend | `X-Tenant` толгойн frontend тал нь ӨӨР ажил (§9). |

**Бусад агентуудтай зэрэгцэн ажиллах:** Энэ repo дээр олон хөгжүүлэгч ЗЭРЭГ ажилладаг. Ажлын мод нь бусдын дуусаагүй, магадгүй **compile хийгдэхгүй** өөрчлөлтийг агуулж байж болно.

- Хамрах хүрээнээсээ **гарахгүй**. Өөр файлыг «засах», reformat хийх, буцаах — ХОРИОТОЙ.
- `git restore`, `git checkout --`, `git stash`, эсвэл өөрийн засаагүй файлыг `git add` хийхгүй.
- **Бүтэн build унах нь автоматаар чинийх биш.** `tsc --noEmit` унавал алдаа нь ЗӨВХӨН чиний хөндөөгүй файлууд дээр байгаа эсэхийг шалга, тэгээд эзэнд нь мэдэгд — араас нь хөөцөлдөх хэрэггүй.
- **Baseline (2026-08-27-нд миний хэмжсэн):** `cd backend && npx tsc --noEmit` → **exit 0, гаралт хоосон**. `cd backend && npm test` → **tests 221 / pass 221 / fail 0**. Улаан гарвал энэ хоёр тооноос хазайсан гэсэн үг.

**Deploy хийж болох уу:** Тийм — `tsc --noEmit` цэвэр, `npm test` ногоон болсны ДАРАА. Deploy нь MGL-д **ажиглагдах өөрчлөлт үүсгэхгүй** (`TENANTS` тохируулаагүй тул шинэ код зам бүхэлдээ идэвхгүй), ГАНЦ үл хамаарах зүйл нь T3-ийн edge-cache түлхүүрийн өөрчлөлт — нэг удаагийн cache miss (30–60 сек). Deploy нь **LOCAL wrangler**, CI биш (хоёр GitHub workflow хоёул үхсэн):

```
cd backend && npx tsc --noEmit && npx wrangler deploy --config wrangler.toml
```

`--config wrangler.toml` **заавал** — repo root дээрх `wrangler.jsonc` нь өөр worker (`name: "mgl"`, binding-гүй) зарладаг ба wrangler түүнийг сонгож болзошгүй. `wrangler deploy` нь typecheck **ХИЙХГҮЙ**. Ямар нэг `wrangler pages` дэд команд хэрэглэвэл `npx -y wrangler@latest` -ээр (энэ ажилд хэрэггүй).

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сессид хангалттай хэмжээгээр)

- `backend/` — Cloudflare Worker. Hono-г `@cloudflare/workers-oauth-provider`-ээр **боосон**: `index.ts`-ийн default export нь провайдер, Hono `app` нь түүний `defaultHandler`. Binding: `DB` (D1/SQLite) · `MEDIA_BUCKET` (нийтийн R2) · `MEETING_BUCKET` (хаалттай R2) · `OAUTH_KV` · `MCP_OBJECT` (Durable Object → `MglMcpAgent`) · `BROWSER` · `AI`.
- `frontend/` — Vite + React 19 SPA, Cloudflare Pages, төсөл нь **`mgl-design-system`** (`--project-name mgl-design-system`-ийг ил бичнэ).
- `revit-mcp/addin/` — Revit 2024–2027 нэмэлт, C#/WPF, in-process, 47 файл ~16k мөр, **тест тэг**, ажилтны PC дээр авто-шинэчлэлт БАЙХГҮЙ.
- `revit-mcp/server/`, `revit-mcp/agent/` — Python MCP гүүр ба локал агент. `revit-mcp/training/` — intent classifier сургалтын урсгал.
- ~49 идэвхтэй ажилтан. Production D1 = 45 MB, 114 хүснэгт; хамгийн том нь `progress_entries` 8,062 мөр.

### Платформын хатуу хязгаарууд (энэ ажилд хамаарах хэсэг)

- Migration нь **зөвхөн нэмэгддэг (append-only)**. 190 файл, хамгийн өндөр нь `0200_assistant_feedback_note.sql`. Хэрэглэгдсэн файлыг засах нь production дээр **чимээгүй no-op**. **Энэ ажилд migration ХЭРЭГГҮЙ.** Хэрэв ямар нэг шалтгаанаар хэрэгтэй болвол: шинэ дугаар ав, `CREATE TABLE`/`CREATE INDEX` бүрд `IF NOT EXISTS`, байгаа хүснэгт дээрх `ALTER`-ийг блокийн ЭХЭНД тавь, `END;` -ийг ТОМ үсгээр өөрийн мөрөнд бич.
- D1 нэг statement дээр **дээд тал нь 100 bind**.
- D1 нь тунхагласан foreign key-г ажиллах үед мөрддөггүй, ГЭВЧ `wrangler d1 migrations apply` нь файл бүрийг transaction-д боодог бөгөөд тэнд `ON DELETE CASCADE` **АЖИЛЛАНА**. `users` (27 cascade хүүхэдтэй) болон `projects` (38)-ийг `migrations apply`-аар ХЭЗЭЭ Ч дахин барихгүй.

### Яагаад энэ ажил байгаа вэ

Олон-tenant суурь нь **аль хэдийн кодод орсон** (`29c7a96 feat(tenant): олон-tenant суурь ба модулийн лицензийн давхарга`) боловч **бүрэн идэвхгүй**. Би шалгасан:

| Баримт | Хэрхэн шалгасан |
|---|---|
| `TENANTS` нь `backend/wrangler.toml`-д **байхгүй** | `grep -n "TENANTS" backend/wrangler.toml` → тэг мөр |
| `TENANTS` нь `backend/.dev.vars`-д ч **байхгүй** | `grep -c TENANTS backend/.dev.vars` → `0` |
| Ямар ч `ORG_*` var **байхгүй** | `grep -n "^ORG_" backend/wrangler.toml` → тэг мөр |
| Frontend болон workstation талд tenant таних тэмдэг **ОГТ БАЙХГҮЙ** | `grep -rn "X-Tenant" frontend/src revit-mcp` → зөвхөн vendored `.venv`/`.dll` таарц, эх кодод тэг |

Тиймээс `parseTenants(env.TENANTS)` нь өнөөдөр `null` буцааж (`index.ts:322–323`), хүсэлт бүр өмнөхтэй яг ижил замаар явдаг. **Эхний `TENANTS` утгыг бичсэн ТЭР АГШИНД** доорх дөрвөн (+хоёр нэмэлт) цоорхой нэгэн зэрэг нээгдэнэ. Хамгийн муу нь (T1) бол B компанийн хаалттай BIM нотолгоог **MGL-ийн bucket руу** чимээгүй бичих явдал — тэр bucket нь түлхүүрээ мэдвэл хэн ч уншиж болдог (1A-1).

### ⚠️ DB-per-tenant тусгаарлалт Worker дээр ЗОГСОНО

Нэг компани нэг D1 гэдэг загвар нь **зөвхөн Worker дотор** үйлчилнэ. Ажлын станцын талын ямар ч олдвор үүгээр **шийдэгдэхгүй**:

- `revit-mcp/server/` (Python MCP гүүр) болон `revit-mcp/agent/` (локал агент) нь **ямар ч tenant таних тэмдэг агуулдаггүй** — дээрх grep-ээр баталгаажсан. Тэд зөвхөн JWT-тэй, tenant-гүй.
- Тиймээс: локал агентын аюулгүй байдал, гүүрний баталгаажуулалтгүй `HttpListener`, багц боловсруулалтын PC дээрх урт наслалттай токен — эдгээр **бүгд хэвээрээ үлдэнэ**, DB-per-tenant хэдэн ч давхар байлаа гэсэн.
- Шууд үр дагавар: A компанийн станц дээрх токен алдагдвал tenant тусгаарлалт нь түүнийг A-гийн DB рүү **хязгаарлана** — сайн. Гэвч тэр станцын өөрийнх нь бүх сул тал (`run_revit_code`, локал агент) A компанийн хувьд яг хэвээр.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `<файл>:<мөр>` бүрийг би 2026-08-27-нд **өөрөө нээж** шалгасан.

### 2.1 Оролтын урсгал — `backend/src/index.ts:315–355`

```ts
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
    const tenants = parseTenants(env.TENANTS);                    // :322
    if (!tenants) return oauthProvider.fetch(request, env, ctx);  // :323  ← өнөөдрийн ЦОРЫН ГАНЦ зам

    const url = new URL(request.url);
    const hit = resolveTenant(tenants, {                          // :326
      host: url.hostname,
      header: request.headers.get(TENANT_HEADER),                 // :328
    });

    if (!hit) { ... status: 404, error: 'unknown_tenant' ... }     // :335

    const scoped = tenantEnv(env, hit.tenant);                     // :341  ← ЭНД
    if (!scoped) { ... status: 503, error: 'tenant_misconfigured' } // :348  ← «дуудагчийн 503 зам»

    return runWithTenant(hit.tenant.id, () => oauthProvider.fetch(request, scoped, ctx)); // :354  ← ДАРАА нь ЭНД
  },
```

**Энэ бол T1-ийн гол цэг:** `tenantEnv` нь **341-р мөрөнд**, `runWithTenant` нь **354-р мөрөнд**. Өөрөөр хэлбэл `tenantEnv`-ийн БИЕ дотор `AsyncLocalStorage` store хараахан **тавигдаагүй** байна.

### 2.2 `hasTenantContext` — `backend/src/lib/requestContext.ts:50–53`

```ts
export function hasTenantContext(): boolean {
  return storage.getStore() !== undefined;
}
```

`runWithTenant` нь `requestContext.ts:41`, `currentTenantId` нь `:46`, `DEFAULT_TENANT_ID = 'default'` нь `:35`.

> **⚠️ ӨМНӨХ САНАЛ ХЭРЭГСЭГДСЭН.** T1-ийг «`tenantEnv` дотор `hasTenantContext()`-оор хамгаал» гэж засах санал байсан. Тэр нь **ҮХСЭН КОД**. `tenantEnv` нь `index.ts:341`-д, `runWithTenant` нь `:354`-д дуудагдаж байгаа тул `tenantEnv` дотор `hasTenantContext()` нь **хүсэлт бүр дээр, олон-tenant горимд ч ялгаагүй, ҮРГЭЛЖ `false`** буцаана. Тэр хамгаалалт хэзээ ч асахгүй.

### 2.3 T1 — R2 bucket-ийн чимээгүй унац

`backend/src/lib/tenants.ts:44–53` — `media` ба `meeting` нь **СОНГОЛТТОЙ**:

```ts
  /** D1 binding-ийн НЭР (`DB_ACME`).  Заавал. */
  db: string;                                                     // :48
  /** Нийтийн R2 binding-ийн нэр.  Өгөөгүй бол үндсэн `MEDIA_BUCKET` хэвээр. */
  media?: string;                                                 // :50
  /** Хурлын дуу бичлэгийн R2 binding.  Өгөөгүй бол `MEETING_BUCKET` хэвээр. */
  meeting?: string;                                               // :52
```

`parseTenants` нь `id` + `db` л шаарддаг (`tenants.ts:90`), bucket-уудыг зөвхөн байвал хуулна (`:111–112`):

```ts
    if (!isNonEmptyString(r.id) || !isNonEmptyString(r.db)) continue;      // :90
    ...
      ...(isNonEmptyString(r.media) ? { media: r.media.trim() } : {}),     // :111
      ...(isNonEmptyString(r.meeting) ? { meeting: r.meeting.trim() } : {}), // :112
```

`tenantEnv` (`tenants.ts:183–205`):

```ts
export function tenantEnv<T extends object>(env: T, tenant: TenantSpec): T | null { // :183
  const bag = env as unknown as Record<string, unknown>;
  const db = bag[tenant.db];
  if (!db) return null;                                            // :189

  const next: Record<string, unknown> = { ...bag, DB: db };         // :191  ← БУСАД БҮХ binding/var ЭНД ХЭВЭЭР УРСАНА

  if (tenant.media) {          // :193  ← if.  else БАЙХГҮЙ.
    const b = bag[tenant.media];
    if (!b) return null;
    next.MEDIA_BUCKET = b;     // :196
  }
  if (tenant.meeting) {        // :198  ← мөн адил
    const b = bag[tenant.meeting];
    if (!b) return null;
    next.MEETING_BUCKET = b;   // :201
  }

  return next as unknown as T; // :204
}
```

**Үр дагавар:** `{"id":"acme","db":"DB_ACME","hosts":["api.acme.mn"]}` гэсэн нэг мөр бичихэд ACME-гийн D1 нь тусдаа, ГЭВЧ ACME-гийн бүх зураг, гарын үсэг, хавсралт, ЗХ-ын нотолгоо, тайлангийн PDF нь **MGL-ийн `mgl-progress-media` bucket** руу бичигдэнэ. Тэр bucket нь `/media/:key`-ээр **баталгаажуулалтгүй, түлхүүрээ мэдвэл хэн ч** уншиж болдог: `index.ts:193` дээр `app.route('/media', media)` нь `app.use('/api/*', authMiddleware)` (`index.ts:144`)-ийн **ГАДНА**. Хурлын дуу бичлэг мөн ижлээр MGL-ийн `mgl-meeting-audio` руу орно.

Одоогийн тест энэ зан төлөвийг **зориудаар бататгаж байгаа** — `backend/src/lib/tenants.test.ts:157–162`:

```ts
test('tenantEnv: media/meeting заагаагүй бол үндсэн binding хэвээр', () => {
  const mgl = TENANTS.find((t) => t.id === 'mgl')!;
  const scoped = tenantEnv(FAKE_ENV, mgl)!;
  assert.equal(scoped.DB, 'mgl-db');
  assert.equal(scoped.MEDIA_BUCKET, 'mgl-media');
});
```

⇒ **Энэ тестийг ЗАСАХ ЁСТОЙ**, эс тэгвэл T1-ийн засвар 221/221-ийг унагаана.

### 2.4 T2 — `LEGACY_MEDIA_ORIGIN` нь binding БИШ, энгийн var

`backend/wrangler.toml:118`:

```
LEGACY_MEDIA_ORIGIN = "https://mgl-progress-api.anandoctane4.workers.dev"
```

`backend/src/types.ts:32` — `LEGACY_MEDIA_ORIGIN?: string;` (binding биш, `[vars]`-ийн мөр).

`backend/src/routes/media.ts` — ганц уншигч:

| Мөр | Код / үйлдэл |
|---|---|
| `:55` | `media.get('/:key', …)` — **яг НЭГ сегмент** |
| `:57` | `const object = await c.env.MEDIA_BUCKET.get(key);` |
| `:70` | `const legacy = (c.env.LEGACY_MEDIA_ORIGIN ?? '').replace(/\/$/, '');` |
| `:71` | `if (!legacy) return c.notFound();` ← **унтраах цорын ганц дэлгүүр** |
| `:75` | хуучин origin-оос `fetch(legacy + '/media/' + encodeURIComponent(key))` |
| `:34`, `:89–91` | `BACKFILL_MAX_BYTES = 32 MB`; хэмжээ мэдэгдэхгүй эсвэл түүнээс том бол зөвхөн дамжуулна |
| `:97–104` | `c.executionCtx.waitUntil(c.env.MEDIA_BUCKET.put(key, bytes, { customMetadata: { backfilledFrom: 'legacy', … } }))` — **шинэ bucket руу БАЙНГА хуулна** |

`tenantEnv` нь `...bag` (`tenants.ts:191`) хийдэг тул `LEGACY_MEDIA_ORIGIN` нь **tenant бүрийн env рүү хэвээр урсана**, солигдохгүй.

**Үр дагавар — компани хооронд өгөгдөл дамжуулах примитив:** ACME-гийн домэйн дээр `GET /media/<MGL-ийн ямар ч түлхүүр>` дуудвал —

1. ACME-гийн bucket-д олдохгүй → `:70` legacy-г уншина → MGL-ийн ХУУЧИН worker-ээс татна;
2. хариуг хэрэглэгч рүү буцаана (**унших**);
3. `:98` дээр **ACME-гийн `MEDIA_BUCKET` руу байнга хуулж бичнэ** (**хуулах**).

Өөрөөр хэлбэл MGL-ийн файл ACME-гийн домэйнээр гарахаас гадна ACME-гийн bucket-д **байнгын хуулбар** үлдээнэ. Хэрэв ACME нь T1-ийн улмаас bucket зааж өгөөгүй бол хоёр тал нэг bucket тул илрэлгүй. Route нь яг нэг сегмент тул SSRF биш — асуудал нь **origin нь Worker-т НЭГ** гэдэгт л байна.

**Энэ салаа яагаад байдгийг** `media.ts:6–28` тайлбарлана: 2026-08-24-ний D1 нүүлгэлт ба ~2026-08-21-ний R2 хуулбарын хооронд байршуулсан файлууд шинэ bucket-д ороогүй. Хэмжилт (`:14–15`): **хуучин 11,290 объект / 8.35 GB, шинэ 11,231 / 8.34 GB — 59 объектын зөрүү.** `:26–27` өөрөө шийдлийг хэлж байна: *«`LEGACY_MEDIA_ORIGIN` хоосон бол бүхэлдээ унтарна — хуучин акаунтыг хаамагц энэ мөрийг арилгана.»*

### 2.5 T3 — Edge cache-ийн нэрийн зай

`backend/src/lib/edgeCache.ts:44–56`:

```ts
function cacheHost(): string {                                   // :44
  const slug = orgConfig()
    .appName.toLowerCase()                                       // :46
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `https://__edge_cache__.${slug || 'app'}.internal`;      // :49
}

function buildCacheRequest(opts: EdgeCacheOptions): Request {     // :52
  const tags = (opts.varyTags ?? []).map(...).join('|');          // :53
  const url = `${cacheHost()}/${encodeURIComponent(opts.key)}?v=${encodeURIComponent(tags)}`; // :54
  return new Request(url, { method: 'GET' });
}
```

`withEdgeCache` нь `:63`, `bustEdgeCache` нь `:101` — хоёул `buildCacheRequest`-ээр дамжина.

Нэрийн зай нь **`orgConfig().appName`-аас** гарна, `currentTenantId()`-ээс БИШ. `orgConfig()` (`orgConfig.ts:388`) нь `entry(currentTenantId()).cfg` — өөрөөр хэлбэл tenant тус бүрийн slot-оос уншина, тиймээс **онолын хувьд** tenant бүр өөр appName-тай байж чадна. Гэвч:

| Давхарга | Мөр | Асуудал |
|---|---|---|
| Дефолт | `orgConfig.ts:117` — `appName: 'MGL Progress'` | Юу ч тохируулаагүй бол **бүх tenant** → slug `mgl-progress` → **НЭГ нэрийн зай** |
| ENV | `orgConfig.ts:201` (`ORG_APP_NAME?`), `:235` | `[vars]` нь **Worker-т ГЛОБАЛ** — tenant бүрт өөр байх боломжгүй. Мөн `wrangler.toml`-д огт байхгүй |
| DB | `orgConfig.ts:280` — `appName: 'org.app_name'` | ЦОРЫН ГАНЦ tenant-тус-бүрийн зам: tenant бүрийн ӨӨРИЙН `app_settings`-д `org.app_name` мөр байх ёстой |

Нэмээд, `reloadOrgConfig`-ийн `catch` (`orgConfig.ts:422–425`) нь `app_settings` уншилт унавал **чимээгүй** ENV/дефолт руу унана → дахин `mgl-progress`. `entry()` (`orgConfig.ts:375–381`) нь мэдэгдээгүй tenant-д `DEFAULT_ORG_CONFIG` seed хийнэ.

**Үр дагавар:** ACME-гийн DB-д `org.app_name` бичээгүй бол ACME болон MGL-ийн `/api/dashboard`, `/api/company/*`, `/api/projects`, `/api/qto/projects/:id/dashboard` -ийн кэш бичлэг **яг ижил Cache API түлхүүртэй** болно. `varyTags` нь ихэвчлэн `userId` / `projectId` — хоёулаа tenant тус бүрийн бүхэл тоо тул **давхцана**. Тиймээс ACME-гийн 7-р төслийн dashboard нь MGL-ийн 7-р төслийн кэшлэгдсэн хариуг TTL-ийн турш (`edgeCache.ts:81`, дефолт 30 сек; QTO дээр 60) буцаах боломжтой.

**Одоо байгаа дуудагчид (баталгаажсан):** `withEdgeCache` → `routes/company.ts:178, 868, 891, 926` · `routes/dashboard.ts:15` · `routes/projects.ts:360` · `routes/qto.ts:112`. `bustEdgeCache` → `routes/landingBlocks.ts:312, 360, 361, 379, 380, 433, 482, 501, 558` · `routes/qto.ts:908, 938`.

### 2.6 T4 — Cron нь tenant-ийг ОГТ мэдэхгүй

`backend/src/index.ts:356–390`:

```ts
  scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => { // :356
    await loadOrgConfig(env);                                    // :361  ← runWithTenant-гүй → tenantId = 'default'

    if (event.cron === '* * * * *') {
      ctx.waitUntil(sweepPushNotifications(env));                // :365
      return;
    }
    ctx.waitUntil(syncAllMailboxes(env));                        // :372
    ctx.waitUntil(reconcileMeetings(env));                       // :375
    ctx.waitUntil(reconcileAsrRecordings(env));                  // :379
    ctx.waitUntil(syncGoogleCalendar(env));                      // :382
    ctx.waitUntil(runDeadlineSweep(env));                        // :389
  },
```

**Баталгаажсан: tenant-ийн ямар ч ул мөр байхгүй.** `parseTenants` дуудагдахгүй, `tenantEnv` дуудагдахгүй, `runWithTenant` дуудагдахгүй. Бүх ажил `env` дээр — өөрөөр хэлбэл **суурь (MGL) `DB`, `MEDIA_BUCKET`, `MEETING_BUCKET`** дээр гүйнэ.

> ⚠️ **Даалгаврын тодорхойлолт дээрх нэг алдаа:** энэ бол «quartet» биш **тав**. `reconcileAsrRecordings` (`:379`, Зохиогчийн хяналтын дуу бичлэг) жагсаалтад ороогүй байсан. Мөн `* * * * *` салаанд `sweepPushNotifications` (`:365`) — **зургаа дахь** tenant-гүй ажил.

**Үр дагавар:** ACME-д Gmail sync ажиллахгүй, хурлын бичлэг finalize хийгдэхгүй, ЗХ-ын бичлэг цэгцлэгдэхгүй, Google Calendar синк хийгдэхгүй, хугацааны сануулга явахгүй, **push мэдэгдэл огт очихгүй**. Ямар ч алдаа гарахгүй — зүгээр л чимээгүй хийгдэхгүй.

`loadOrgConfig(env)` (`:361`) нь `currentTenantId()` = `'default'` (`orgConfig.ts:452`) тул MGL-ийн тохиргоог **`'default'` slot-д** ачаална. Өнөөдөр зөв (нэг-tenant), гэхдээ давхаргатай болмогц cron нь бүх tenant-ийн хувьд MGL-ийн цагийн бүс/ээлжээр гүйнэ.

**T3 × T4 харилцан үйлчлэл:** `bustEdgeCache(c, …)` нь `AppContext` (`c.executionCtx`, `edgeCache.ts:104`) шаарддаг тул cron-оос **өнөөдөр дуудагдах боломжгүй** — grep үүнийг баталсан (зөвхөн `landingBlocks.ts`, `qto.ts`). Гэвч T4-ийн давталтыг нэмсний ДАРАА cron дотроос кэш хүчингүй болгох ажил нэмбэл, тэр нь `runWithTenant`-ийн **ГАДНА** гүйвэл `currentTenantId()` = `'default'` → `cacheHost()` дефолт нэрийн зайд түлхүүрлэж, тухайн tenant-ийн бичлэгийг **бүтэн TTL-ийн турш чимээгүй алдана**.

### 2.7 T5 (НЭМЭЛТ — тодорхойлолтод байгаагүй, миний илрүүлсэн) — MCP нь tenant хилийг БҮРЭН тойрдог

Хоёр тусдаа цоорхой, хоёулаа `/mcp` дээр:

**(a) `resolveExternalToken` нь `tid`-г огт шалгадаггүй** — `backend/src/index.ts:292–296`:

```ts
  resolveExternalToken: async ({ token, env }) => {              // :292
    const payload = await verifyToken(token, env.JWT_SECRET);    // :293
    if (!payload) return null;
    return { props: { sub: payload.sub, role: payload.role } satisfies McpProps }; // :295
  },
```

`middleware/auth.ts:80–89`-ийн `hasTenantContext()` → `payload.tid !== expected` → 401 шалгалтын **ЯМАР Ч ЭКВИВАЛЕНТ БАЙХГҮЙ**. `JWT_SECRET` нь Worker-т НЭГ тул A компанийн токен B компанийн `/mcp`-д гарын үсгээрээ хүчинтэй.

**(b) Durable Object нь дуудагчийн scoped env-ийг АВДАГГҮЙ** — `backend/src/mcp/MglMcpAgent.ts:45` дээр `class MglMcpAgent extends McpAgent<Env, …>`, дотор нь tool бүр `this.env`-ээр бүртгэгддэг (`:57, 62, 68, 73, 78, 83, 87, 91, 96, 99, 105, 106, 109, 111, 113, 116, 122–137`). `this.env` бол DO-гийн **deploy-үеийн** env — `index.ts:354` дээр `oauthProvider.fetch`-д дамжуулсан `scoped` env БИШ. Мөн `runWithTenant`-ийн `AsyncLocalStorage` нь DO-гийн хилийг **давдаггүй**. `MglMcpAgent.ts`-д `orgConfig` / `currentTenantId` -ийн дуудлага **тэг** (grep-ээр баталгаажсан).

⇒ Олон-tenant горим асаагдмагц **tenant бүрийн `/mcp` сесс MGL-ийн `DB` рүү унших болно**.

### 2.8 T6 (НЭМЭЛТ) — `X-Tenant` нь CORS-оор дамжихгүй; `ALLOWED_ORIGINS` глобал

`backend/src/index.ts:104`:

```ts
    allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
```

`X-Tenant` **байхгүй**. Тиймээс `*.workers.dev` дээрх давхарлах горим (`tenants.ts:150–176`-ийн 2-р зам) нь браузерын cross-origin SPA-аас **preflight дээр унана**. Мөн `ALLOWED_ORIGINS` (`index.ts:94`) нь `[vars]`-аас ирдэг тул Worker-т **НЭГ** — бүх tenant-ийн домэйн нэг жагсаалтад холилдоно.

### 2.9 Зөв ажиллаж байгаа зүйлс (хөндөх шаардлагагүй)

| Юу | Хаана | Тайлбар |
|---|---|---|
| Токены `tid` хил | `middleware/auth.ts:78–89` | `hasTenantContext()` нь `runWithTenant`-ийн ДОТОР дуудагдаж байгаа тул ЗӨВ |
| `tid` claim автомат шигтгэлт | `lib/jwt.ts:52–58` | Мөн адил дотор. `signToken`-ийг cron-оос дуудах зам **БАЙХГҮЙ** (шалгасан: `signAudioUrl`/`submitJob` нь зөвхөн `routes/meetings.ts:277, 503` ба `routes/authorSupervision.ts:1202`-оос; cron-ийн `reconcileMeetings` нь зөвхөн `fetchJobInfo`/`fetchTranscriptJson` хэрэглэдэг) |
| `orgConfig` tenant тус бүрийн memo | `orgConfig.ts:368, 375, 388, 452, 458–470` | `Map<tenantId, CacheEntry>` — уралдаан байхгүй, `tenants.test.ts:200–260` дээр зэрэгцээ хүсэлтээр шалгасан |
| `loadOrgConfig` нь route-оос ӨМНӨ | `index.ts:117–120` (`app.use('*', …)`) | `await` тул `orgConfig()` нь route бүрт ачаалагдсан байна |
| Танихгүй host → 404, дефолт руу УНАГААХГҮЙ | `index.ts:332–339` | Fail-closed. Зөв. |
| `parseTenants` буруу JSON дээр `null` буцаана, шидэхгүй | `tenants.ts:73–86` | Нэг таслалын алдаа бүх хүсэлтийг 500 болгохоос сэргийлнэ |

---

## 3. ХИЙХ АЖИЛ

Дарааллаар. Бүгд НЭГ deploy-д багтана.

### Алхам 1 — T1: bucket-уудыг ЗААВАЛ болгох (`lib/tenants.ts`)

**Гол шийдэл: parse-үеийн татгалзалт.** `hasTenantContext`-д тулгуурласан хувилбар нь §2.2-ийн улмаас үхсэн код тул хэрэглэхгүй.

**1a.** `TenantSpec`-д bucket-уудыг заавал болго (`tenants.ts:44–53`):

```ts
  /** D1 binding-ийн НЭР (`DB_ACME`).  Заавал. */
  db: string;
  /**
   * Нийтийн R2 binding-ийн нэр.  ЗААВАЛ.
   * ⚠️ Сонголттой болгож БОЛОХГҮЙ: `tenantEnv` нь `...bag` хийдэг тул
   *    заагаагүй бол B компанийн файл MGL-ийн bucket руу ЧИМЭЭГҮЙ бичигдэнэ.
   *    Тэр bucket нь `/media/:key`-ээр баталгаажуулалтгүй нээлттэй
   *    (`index.ts:193` нь `authMiddleware`-ийн ГАДНА).
   *    Үндсэн компани нь `"MEDIA_BUCKET"` гэж ИЛ бичнэ.
   */
  media: string;
  /** Хурлын дуу бичлэгийн R2 binding.  ЗААВАЛ, `media`-тай ижил шалтгаанаар. */
  meeting: string;
```

**1b.** `parseTenants`-д татгалза (`tenants.ts:90`-ийн дараа):

```ts
    if (!isNonEmptyString(r.id) || !isNonEmptyString(r.db)) continue;
    // ⚠️ Bucket дутуу бичлэгийг БҮРЭН ХАЯНА — «дефолт руу унах» нь компани
    //    хооронд өгөгдөл гоожуулна.  Хаясан tenant нь `resolveTenant`-д
    //    олдохгүй → `index.ts:335` дээр 404 `unknown_tenant` (fail-closed).
    if (!isNonEmptyString(r.media) || !isNonEmptyString(r.meeting)) {
      console.error(`[tenant] ${r.id}: media/meeting binding заагаагүй — бичлэгийг ХАЯЛАА`);
      continue;
    }
```

`out.push({...})`-ийн (`:106–113`) `...(isNonEmptyString(r.media) ? … : {})` хоёр мөрийг энгийн `media: r.media.trim(),` / `meeting: r.meeting.trim(),` болго.

**1c.** `tenantEnv`-д давхар хамгаалалт (`tenants.ts:193–202`) — `if` -ийг болзолгүй болго:

```ts
  const mediaB = bag[tenant.media];
  if (!mediaB) return null;
  next.MEDIA_BUCKET = mediaB;

  const meetingB = bag[tenant.meeting];
  if (!meetingB) return null;
  next.MEETING_BUCKET = meetingB;
```

Энэ нь `index.ts:341–352`-ийн **аль хэдийн байгаа 503 замыг** дахин ашиглана — шинэ алдааны зам нэмэхгүй. `parseTenants` баталгаажуулсны дараа энэ `null` буцаалт нь хүрэшгүй боловч давхар хамгаалалт болж үлдэнэ.

**1d.** `tenants.test.ts` засвар (заавал, эс тэгвэл 221/221 унана):

| Мөр | Юу болох |
|---|---|
| `:29–38` | `SPEC`-ийн `mgl` бичлэгт `media: 'MEDIA_BUCKET', meeting: 'MEETING_BUCKET'` нэм (`FAKE_ENV`-д `MEDIA_BUCKET`/`MEETING_BUCKET` аль хэдийн бий — `:135–143`) |
| `:157–162` | «media/meeting заагаагүй бол үндсэн binding хэвээр» тестийг **устгаад**, оронд нь «хаягдана» тест бич |
| `:164–169` | `TenantSpec` литералуудад `media`/`meeting` нэм (одоо заавал тул tsc унана) |

Шинэ тест:

```ts
test('parseTenants: media/meeting заагаагүй бичлэгийг ХАЯНА (bucket гоожихоос сэргийлнэ)', () => {
  const t = parseTenants(JSON.stringify([
    { id: 'a', db: 'DB_A', hosts: ['a.mn'] },                                   // bucket-гүй → хаягдана
    { id: 'b', db: 'DB_B', hosts: ['b.mn'], media: 'MEDIA_B', meeting: 'MEET_B' },
  ]));
  assert.deepEqual(t?.map((x) => x.id), ['b']);
});
```

Модулийн толгойн тайлбарт (`tenants.ts:1–36`) шинэ дүрмийг нэг мөрөөр нэм.

### Алхам 2 — T2: `LEGACY_MEDIA_ORIGIN`-ийг tenant тус бүрийнх болгох

**Хамгийн сайн (эзний шийдвэр шаардана — §9 №2):** 59 объектын цоорхой хаагдсан бол `wrangler.toml:118`-ийн мөр болон `routes/media.ts:69–108`-ийг **бүхэлд нь устга**. Тэгвэл T2 бүрмөсөн алга болно. `media.ts:26–27`-ийн тайлбар өөрөө үүнийг зөвлөж байна.

**Хэрэв цоорхой хаагдаагүй бол — fail-closed зураглал.** `tenantEnv`-д `...bag`-аас урссан var-ыг **дардаг** мөр нэм (`tenants.ts:191`-ийн дараа):

```ts
  // `LEGACY_MEDIA_ORIGIN` бол binding БИШ, `[vars]`-ийн мөр — `...bag`-аар
  // tenant бүрийн env рүү урсдаг.  Дарж бичихгүй бол B компанийн домэйнээр
  // MGL-ийн ямар ч файлыг татаад, дээрээс нь B-гийн bucket руу БАЙНГА
  // хуулна (`routes/media.ts:97-104`) — компани хооронд өгөгдөл дамжуулах
  // примитив.  Тиймээс tenant өөрөө зарлаагүй бол ХООСОН болгоно
  // (`routes/media.ts:71` дээр `if (!legacy) return c.notFound()`).
  next.LEGACY_MEDIA_ORIGIN = tenant.legacyMediaOrigin ?? '';
```

`TenantSpec`-д нэмэлт талбар:

```ts
  /** Тухайн компанийн ХУУЧИН R2 origin.  Байхгүй бол нөхөж татах ажиллахгүй. */
  legacyMediaOrigin?: string;
```

`parseTenants`-д: `...(isNonEmptyString(r.legacyMediaOrigin) ? { legacyMediaOrigin: r.legacyMediaOrigin.trim() } : {})`.

MGL-ийн бичлэг нь `"legacyMediaOrigin": "https://mgl-progress-api.anandoctane4.workers.dev"` гэж **ил** бичнэ — өөрөөр хэлбэл өнөөдрийн зан төлөв MGL-д хэвээр, бусад бүх tenant-д унтарна.

### Алхам 3 — T3: edge cache-ийн нэрийн зайг tenant-аар салга (`lib/edgeCache.ts:44–50`)

```ts
function cacheHost(): string {
  const slug = orgConfig()
    .appName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // ⚠️ `appName` ГАНЦААРАА хангалтгүй: дефолт нь БҮХ tenant-д `MGL Progress`
  //    (`orgConfig.ts:117`), `ORG_APP_NAME` нь Worker-т ГЛОБАЛ, `org.app_name`-ийг
  //    tenant бүрийн DB-д бичих нь СОНГОЛТТОЙ, `app_settings` уншилт унавал
  //    чимээгүй дефолт руу унана (`orgConfig.ts:422-425`).  `varyTags` нь ихэвчлэн
  //    userId/projectId — tenant хооронд ДАВХЦДАГ бүхэл тоо.  Тиймээс tenant id-г
  //    түлхүүрийн ялгамжтай хэсэг болгож оруулна.
  const tid = currentTenantId().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'default';
  return `https://__edge_cache__.${tid}.${slug || 'app'}.internal`;
}
```

`import { currentTenantId } from './requestContext';` нэм.

> **⚠️ Энэ нь MGL-ийн кэш түлхүүрийг ӨӨРЧИЛНӨ** (`mgl-progress` → `default.mgl-progress`). Үр дагавар нь deploy-ийн дараах **нэг удаагийн бүрэн cache miss**, TTL 30–60 сек тул бодит нөлөө нь хэдхэн секундын нэмэлт D1 ачаалал. Хүлээн зөвшөөрөгдөх ба **ил хэлэх ёстой**.
>
> Байт-ижил түлхүүр хадгалах хувилбар: `const tid = hasTenantContext() ? … : null;` — контекстгүй үед өнөөдрийн host-ыг яг хэвээр буцаана. Энэ бол `hasTenantContext()`-ийн **ЗӨВ** хэрэглээ (route-ууд `runWithTenant`-ийн ДОТОР гүйдэг), `tenantEnv` доторх буруу хэрэглээтэй эсрэгцүүлж болно. Аль нэгийг сонго, шалтгааныг тайлбарт бич.

### Алхам 4 — T4: cron-ийг tenant бүрээр давт (`index.ts:356–390`)

**4a.** Одоогийн биеийг тусад нь функц болго (`index.ts`-д `export default`-аас ӨМНӨ):

```ts
/** Нэг компанийн cron ажил.  `env` нь ТЭР компанийн binding-үүдтэй байх ЁСТОЙ. */
async function runScheduledFor(
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  await loadOrgConfig(env);

  if (event.cron === '* * * * *') {
    ctx.waitUntil(sweepPushNotifications(env));
    return;
  }
  ctx.waitUntil(syncAllMailboxes(env));
  ctx.waitUntil(reconcileMeetings(env));
  ctx.waitUntil(reconcileAsrRecordings(env));
  ctx.waitUntil(syncGoogleCalendar(env));
  ctx.waitUntil(runDeadlineSweep(env));
}
```

Одоо байгаа тайлбаруудыг (`:357–360`, `:367–371`, `:376–378`, `:383–388`) хамт зөөнө — тэдгээр нь fail-safe салааны шалтгааныг тайлбарладаг.

**4b.** `scheduled`-ийг давталт болго:

```ts
  scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    const tenants = parseTenants(env.TENANTS);
    // Тохируулаагүй → өнөөдрийнхтэй ЯГ ИЖИЛ (нэг дуудлага, контекстгүй).
    if (!tenants) return runScheduledFor(event, env, ctx);

    for (const t of tenants) {
      const scoped = tenantEnv(env, t);
      if (!scoped) {
        // Нэгийг нь алдсан нь бусдыг зогсоох ЁСГҮЙ — cron бол backstop.
        console.error(`[tenant] cron: binding олдсонгүй (${t.id}, db=${t.db})`);
        continue;
      }
      // ⚠️ `runWithTenant`-ийн ДОТОР дуудна: `ctx.waitUntil(fn(env))` дэх `fn()`
      //    нь sync дуудагдаж байгаа тул түүний async гинж `AsyncLocalStorage`
      //    store-ыг ӨВЛӨНӨ — `runWithTenant` буцсаны дараа ч хэвээр.
      await runWithTenant(t.id, () => runScheduledFor(event, scoped, ctx));
    }
  },
```

**4c.** Тайлбар нэм: cron-оос кэш хүчингүй болгох ажил ирээдүйд нэмэгдвэл **заавал** `runWithTenant`-ийн дотор байх ёстой (§2.6-ийн T3×T4).

**4d.** Хэмжээний анхаарал: tenant бүр 6 хүртэл `waitUntil` promise нэмнэ. N компанитай үед нэг cron дуудлагад N×6 ажил, `scheduled` дуудлага нь CPU/wall хязгаартай. **Одоо хийх зүйл байхгүй** (N=1), гэхдээ тайлбарт бич: N > 5 болоход cron-ыг Queue болгох эсвэл tenant-уудыг цагаар нь тараах ажил үүснэ.

**4e. Cron илэрхийлэл БҮҮ нэм.** `wrangler.toml`-ийн `crons` нь `["*/2 * * * *", "* * * * *"]`; гуравдахь илэрхийлэл нэмбэл fail-safe салаа тав уулзварыг **давхар** ажиллуулна. Энэ алхам зөвхөн давталт нэмнэ.

### Алхам 5 — АНГИЛЛЫН АЛДАА: `hasTenantContext` бүрийг шалга

Энэ ажлын **хамгийн дамжуулах ёстой сургамж**. `runWithTenant`-ээс ӨМНӨ гүйдэг код дотор `hasTenantContext()` нь ҮРГЭЛЖ `false` — тэр шалгалт үхсэн код болно.

```
grep -rn "hasTenantContext" backend/src --include=*.ts
```

Дуудлага бүрийн хувьд асуу: **энэ мөр `index.ts:354`-ийн `runWithTenant`-ийн дотор гүйх үү?**

| Дуудлага | Мөр | `runWithTenant`-ийн дотор уу | Дүгнэлт |
|---|---|---|---|
| `lib/jwt.ts` | `:56` | ТИЙМ (route → `signToken`) | ЗӨВ |
| `middleware/auth.ts` | `:80` | ТИЙМ (`app.use('/api/*', authMiddleware)`, `index.ts:144`) | ЗӨВ |
| `lib/tenants.ts` | — | дуудлага БАЙХГҮЙ (байх ч ЁСГҮЙ) | — |
| `index.ts` `fetch` `:322–352` | — | **ҮГҮЙ** | Энд `hasTenantContext()` бичих нь ҮХСЭН КОД |
| `index.ts` `scheduled` | — | **ҮГҮЙ** (алхам 4-ийн дараа давталтын дотор ТИЙМ) | — |
| `mcp/MglMcpAgent.ts` | — | **ҮГҮЙ** — DO нь `AsyncLocalStorage` хилийг давдаггүй | §2.7 |

Энэ хүснэгтийг `lib/requestContext.ts`-ийн `hasTenantContext`-ийн дээр (`:49`) товчлон нэм — дараагийн хүн дахин алдахгүйн тулд.

### Алхам 6 — T5/T6-г БАРИМТЖУУЛ (энэ ажилд ЗАСАХГҮЙ)

T5 (MCP tenant тойрох) нь `resolveExternalToken`-д хүрдэг тул **өөр ажил** — `verifyToken`-ийн эргэн тойрны программын дүрэмтэй огтлолцоно. T6 (CORS `allowHeaders`) нь frontend-ийн `X-Tenant`-тай хамт хийгдэх ёстой. Энэ сессид ЗӨВХӨН тайлбар нэм, **код БҮҮ өөрчил**:

- `index.ts:292`-ийн `resolveExternalToken`-ийн дээр: `⚠️ TODO(tenant): tid шалгалт БАЙХГҮЙ — олон-tenant асаахаас ӨМНӨ хаах. middleware/auth.ts:80-89-ийг үз.`
- `mcp/MglMcpAgent.ts:45`-ийн `class`-ийн дээр: `⚠️ TODO(tenant): this.env нь DO-гийн deploy-үеийн env — дуудагчийн scoped env БИШ, AsyncLocalStorage ч DO хилийг давдаггүй. Олон-tenant үед бүх tenant MGL-ийн DB рүү унших болно.`
- `index.ts:104`-ийн `allowHeaders`-ийн дээр: `⚠️ 'X-Tenant' энд БАЙХГҮЙ — workers.dev давхарлах горим браузераас preflight дээр унана.`

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана | Яагаад эвдэрнэ |
|---|---|---|
| `parseTenants` буруу оролт дээр **`null` буцаах, шидэхгүй** | `tenants.ts:73–130` | Шидвэл `TENANTS`-ийн нэг таслалын алдаа production-ийн **бүх хүсэлтийг 500** болгоно. Алхам 1-ийн `continue` нь энэ гэрээг хадгална. |
| `TENANTS` тохируулаагүй үед **эрт гарах** | `index.ts:323`; `scheduled` дээр алхам 4-ийн `if (!tenants)` | MGL-ийн production ямар ч шинэ код зам руу орох ёсгүй. Энэ мөрийг арилгах нь нэг-tenant суулгацыг өөрчилнө. |
| Танихгүй host → **404, дефолт руу УНАГААХГҮЙ** | `index.ts:332–339` | Дефолт руу унагаах нь хамгийн аюултай зан төлөв. |
| `tenantEnv` эх `env`-ийг **МУТАЦИ ХИЙХГҮЙ** | `tenants.ts:191` (`{ ...bag }`) | Worker-ийн `env` нь isolate-д хуваалцагддаг — мутаци бусад tenant-ийн хүсэлт рүү гоожно. `tenants.test.ts:151–154` үүнийг барьдаг. |
| `middleware/auth.ts:78–89`-ийн `tid` хил | тэнд | Энэ бол **жинхэнэ** хамгаалалт. `X-Tenant` толгой хуурамчлагдаж болно; хамгаалалт нь токен. Сулруулах нь бүрэн эрхийн давалт. |
| `verifyToken` нь `purpose`-ийг шалгадаггүй | `lib/jwt.ts` | Revit нэмэлт `purpose: 'mcp'` токеноор REST дуудна. Чангатгах нь ~20 PC дээр гараар засах шаардлага үүсгэнэ. **АЛСААС СЭРГЭЭХ БОЛОМЖГҮЙ.** |
| `media.ts:55` route нь **яг НЭГ сегмент** | `routes/media.ts:55` | Нэгэн зэрэг аюулгүй байдлын хяналт (`authorSupervision.ts`-ийн `isMediaUrl` үүнээс хамаарна) ба SSRF-ээс сэргийлэгч. Wildcard болгож БОЛОХГҮЙ. |
| `orgConfig()` нь **sync** | `orgConfig.ts:388` | `isSummerSchedule()`, `SHIFTS`, `excludeCeoSql()` зэрэг цэвэр функцүүд дуудна. Async болгох нь ~25 газар засах шаардлагатай. |
| `edgeCache` дуудагч бүр `varyTags`-аа өөрөө тоолно | `edgeCache.ts:53` | Автомат хэрэглэгчийн scope БАЙХГҮЙ. T3-ийн засвар нь **нэмэлт** ялгамж — байгаа `varyTags`-ийг арилгах ЁСГҮЙ. |
| Cron дээр **шинэ илэрхийлэл нэмэхгүй** | `wrangler.toml` `crons`, `index.ts:367–390`-ийн fail-safe | Гуравдахь илэрхийлэл нэмбэл fail-safe салаа тав уулзварыг **давхар** ажиллуулна. |
| `routes/ticker.ts`, `routes/timeline.ts` нь `withEdgeCache`-гүй байх нь ЗОРИУД | `ticker.ts:14`, `timeline.ts:353` | Ролиор ялгаатай өгөгдөл / шууд шинэчлэлт. Кэш нэмж «сайжруулах» гэж бүү оролд. |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

**Урьдчилсан нөхцөл:** байхгүй. Ажил дангаараа гүйнэ. 1A-1-ийг **уншсан** байх нь T1-ийн ноцтой байдлыг ойлгоход хэрэгтэй, гэхдээ блоклохгүй.

**Deploy дараалал:**

| # | Юу | Тэмдэглэл |
|---|---|---|
| 0 | (энэ ажил) `npx tsc --noEmit` цэвэр + `npm test` 221+ ногоон | Migration БАЙХГҮЙ |
| 1 | `cd backend && npx wrangler deploy --config wrangler.toml` | MGL-д ажиглагдах өөрчлөлт: **зөвхөн** нэг удаагийн edge-cache miss |
| 2 | (ӨӨР ажил, ӨӨР ӨДӨР) `wrangler.toml`-д ЭХНИЙ `TENANTS` утга | Энэ брифийн ГОЛ ЗОРИЛГО: 2-р алхмыг хийхээс ӨМНӨ 1 нь production дээр байх |

**«Шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ӨМНӨ deploy хийгдэнэ»** гэсэн программын дүрэм энд шууд хамаарахгүй (багана нэмэхгүй), ГЭВЧ ижил зарчмаар: **`tenants.ts`-ийн шинэ дүрмүүд `TENANTS` утгаас ӨМНӨ production дээр байх ЁСТОЙ**. Эсрэгээр хийвэл T1 нь хэдэн цагийн турш нээлттэй байна.

**Дараа нь ирэх (энэ ажлын хамрах хүрээнд БИШ):**

1. **T5** — `resolveExternalToken`-д `tid` шалгалт + DO-гийн env асуудал. `TENANTS` бичихээс өмнө **заавал**.
2. **T6** — CORS `allowHeaders` + frontend `X-Tenant` + `ALLOWED_ORIGINS`-ийг tenant тус бүрийнх болгох.
3. 59 объектын legacy цоорхойг хааж, `routes/media.ts:69–108` + `wrangler.toml:118`-ийг устгах.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

- [ ] `backend/src/lib/tenants.ts`-ийн `TenantSpec.media` ба `.meeting` нь `?`-гүй (заавал) болсон.
- [ ] `parseTenants(JSON.stringify([{id:'a',db:'DB_A',hosts:['a.mn']}]))` → `null` (bucket-гүй бичлэг хаягдаж, массив хоосон болсон тул).
- [ ] `tenantEnv` нь `media`/`meeting` binding байхгүй үед `null` буцаана — `index.ts:348`-ийн 503 замаар, шинэ алдааны зам нэмэлгүйгээр.
- [ ] `tenants.test.ts:157`-ийн «үндсэн binding хэвээр» тест **устсан**, оронд нь «хаягдана» тест орсон.
- [ ] `cd backend && npm test` → **221-ээс дээш**, `fail 0`. (Baseline: 221/221.)
- [ ] `cd backend && npx tsc --noEmit` → exit 0, гаралт хоосон. Алдаа гарвал зөвхөн энэ ажлын хөндөөгүй файлууд дээр байгааг батал.
- [ ] `edgeCache.ts`-ийн `cacheHost()` нь `currentTenantId()`-ээс хамаарна ба `requestContext`-оос import хийсэн.
- [ ] `index.ts`-ийн `scheduled` нь `parseTenants` → давталт → `tenantEnv` → `runWithTenant` дарааллаар бичигдсэн; `TENANTS` байхгүй үед **яг нэг** удаа `runScheduledFor(event, env, ctx)` дуудна.
- [ ] `grep -rn "hasTenantContext" backend/src --include=*.ts`-ийн production дуудлага бүр `runWithTenant`-ийн дотор гүйдгийг батлав, хүснэгт нь `requestContext.ts`-ийн тайлбарт орсон.
- [ ] `index.ts:292`, `mcp/MglMcpAgent.ts:45`, `index.ts:104` дээр `TODO(tenant)` тайлбар нэмэгдсэн, **код өөрчлөгдөөгүй**.
- [ ] `backend/wrangler.toml` **өөрчлөгдөөгүй** (`git diff --stat`-д гарахгүй). `TENANTS` утга **бичигдээгүй**.
- [ ] `backend/migrations/`-д шинэ файл **байхгүй**.
- [ ] `git status --porcelain`-д зөвхөн энэ ажлын файлууд + `docs/bim-ai/`. Бусад агентын файл staged БОЛООГҮЙ.
- [ ] Deploy-ийн дараа `wrangler tail` дээр `[tenant]` префикстэй алдаа гарахгүй; аль нэг `/api/*` GET 200 буцаана.

---

## 7. ШАЛГАХ КОМАНД

```bash
# — 0. Одоогийн байдлыг дахин батал (баримт хөдөлсөн эсэх) —
grep -n "TENANTS" backend/wrangler.toml || echo "TENANTS ТОХИРУУЛААГҮЙ (хүлээгдэж буй)"
grep -c "TENANTS" backend/.dev.vars                       # хүлээгдэж буй: 0
grep -n "^ORG_" backend/wrangler.toml || echo "ORG_* var БАЙХГҮЙ (хүлээгдэж буй)"
grep -n "tenantEnv\|runWithTenant" backend/src/index.ts   # 341 vs 354 дарааллыг батал

# — 1. Ангиллын алдааны grep —
grep -rn "hasTenantContext" backend/src --include=*.ts

# — 2. Edge cache-ийн дуудагчид (varyTags тоолол хэвээр эсэх) —
grep -rn "withEdgeCache\|bustEdgeCache" backend/src --include=*.ts

# — 3. Typecheck (deploy үүнийг ХИЙХГҮЙ) —
cd backend && npx tsc --noEmit          # хүлээгдэж буй: гаралт хоосон, exit 0

# — 4. Тест —
cd backend && npm test                  # baseline: tests 221 / pass 221 / fail 0

# — 5. Хамрах хүрээний хяналт —
git status --porcelain
git diff --stat   # зөвхөн tenants.ts, tenants.test.ts, edgeCache.ts, index.ts (+ сонголтоор media.ts/types.ts)

# — 6. Deploy (LOCAL wrangler; --config ЗААВАЛ) —
cd backend && npx wrangler deploy --config wrangler.toml

# — 7. Deploy-ийн дараа —
npx wrangler tail --config wrangler.toml --format pretty   # `[tenant]` алдаа хайх
```

Cron-ийн локал регресс (`TENANTS` тохируулалгүй — өнөөдрийнхтэй ижил байх ёстой):

```bash
cd backend && npx wrangler dev --config wrangler.toml --test-scheduled
# өөр терминалд:
curl "http://127.0.0.1:3000/__scheduled?cron=*+*+*+*+*"      # зөвхөн push sweep
curl "http://127.0.0.1:3000/__scheduled?cron=*/2+*+*+*+*"    # тав уулзвар
```

---

## 8. ROLLBACK

**Migration БАЙХГҮЙ ⇒ шинэ дугаар шаардлагагүй.** Бүх өөрчлөлт код тул rollback энгийн:

| Юу | Хэрхэн буцаах |
|---|---|
| Бүх өөрчлөлт | Өмнөх commit-оос `cd backend && npx wrangler deploy --config wrangler.toml` дахин гүйцэтгэ. Worker-ийн deploy нь атомарх. |
| T3 (cache түлхүүр) | Буцаахад **дахин нэг удаагийн cache miss** үүснэ (30–60 сек). Өгөгдөл алдагдахгүй — Cache API нь зөвхөн дериватив. |
| T1 | Буцаахад bucket унац дахин нээгдэнэ. **`TENANTS` тохируулсан бол буцаахгүй** — оронд нь урагш зас. |
| T4 (cron давталт) | `TENANTS` тохируулаагүй үед шинэ код `runScheduledFor(event, env, ctx)`-г яг нэг удаа дуудна = өнөөдрийнхтэй байт-ижил. Rollback-ийн эрсдэл тэг. |
| `git` талд | `git revert <commit>` — **`git reset --hard` / `git checkout --` ХЭРЭГЛЭХГҮЙ**, бусад агентын дуусаагүй ажлыг устгана. |

**Гажилтын анхны шинж тэмдэг:** deploy-ийн дараа `wrangler tail` дээр `[tenant]` префикстэй алдаа, эсвэл `/api/dashboard` дээр гэнэтийн 503. `TENANTS` тохируулаагүй үед `tenantEnv` огт дуудагдахгүй тул 503 гарах боломжгүй — гарвал `if (!tenants)` эрт гарах мөр эвдэрсэн гэсэн үг.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Дараах зүйлсийг repo-оос **шийдэж болохгүй** — эзэн эсвэл production query шаардана.

| # | Асуулт | Repo-оос мэдэгдэж байгаа зүйл | Хэн/яаж хариулах |
|---|---|---|---|
| 1 | **`TENANTS` өнөөдөр тохируулагдсан уу?** | **ҮГҮЙ.** `backend/wrangler.toml`-д тэг таарц; `backend/.dev.vars`-д тэг. Гэхдээ `wrangler secret`/dashboard-аар нэмсэн байх *онолын* боломж бий (`types.ts:73` дээр `TENANTS?: string`). | `npx wrangler secret list --config wrangler.toml` + Cloudflare dashboard → Worker → Settings → Variables. **Хэрэв аль хэдийн тохируулагдсан бол T1 нь ОДОО нээлттэй — ажил яаралтай болно.** |
| 2 | **Legacy объектын цоорхой хаагдсан уу?** | `media.ts:14–15` дээрх 2026-08-25-ны хэмжилт: **59 объектын зөрүү**. `wrangler.toml:118` дээр `LEGACY_MEDIA_ORIGIN` **хэвээр** тохируулагдсан. Хаагдсан эсэхийг код мэдэхгүй. | Хоёр акаунт дээр `wrangler r2 object list`-ийн тоог тулга, эсвэл `wrangler tail`-аас `[media] backfilled from legacy` логийг хай. **Хаагдсан бол:** `wrangler.toml:118` + `media.ts:69–108`-ийг устгаж, T2 бүрмөсөн алга болно. **Хаагдаагүй бол:** алхам 2-ийн `legacyMediaOrigin` зураглалыг хий. |
| 3 | **`ORG_APP_NAME` нь tenant тус бүрт тохируулагдах уу?** | `wrangler.toml`-д огт байхгүй. `[vars]` бол Worker-т **ГЛОБАЛ** тул tenant бүрт өөр байх боломжгүй; ганц зам нь tenant бүрийн DB-ийн `app_settings` дахь `org.app_name` (`orgConfig.ts:280`). | Эзэн: «шинэ компани бүрд `app_settings`-д `org.app_name` бичих нь бүртгэлийн ЗААВАЛ алхам мөн үү?» **Хэрэв ҮГҮЙ бол** T3-ийн `currentTenantId()` засвар нь сонголт биш, **ЗААВАЛ**. |
| 4 | **Аль tenant нь «үндсэн» вэ, эсвэл бүгд ил бичих үү?** | Кодод «base tenant» гэсэн ойлголт **ОГТ БАЙХГҮЙ**. Зөвлөмж: ойлголт нэмэхгүй, MGL-ийн бичлэг `"media": "MEDIA_BUCKET", "meeting": "MEETING_BUCKET"` гэж **ил** бичих. | Эзэн/архитектурын шийдвэр. Ил бичих нь илүү энгийн ба tsc-ээр мөрдөгдөнө. |
| 5 | **Шинэ компани бүр өөрийн R2 bucket авах уу, эсвэл нэг bucket-ийг угтварчлан хуваах уу?** | Код нь **binding тус бүр** гэж үздэг (`tenantEnv` бүтэн binding сольдог). Угтвараар хуваах загварыг код огт дэмжихгүй. | Эзэн. «Нэг bucket, `acme/` угтвар» гэвэл `tenantEnv` биш, `routes/media.ts` + бүх `put` дуудлагыг өөрчлөх тусдаа ажил болно. |
| 6 | **Cron-ийн зардал/хугацааны төсөв** | Одоо N=1. Tenant тус бүр 6 хүртэл `waitUntil`. | Эзэн: хэдэн компанийг зорьж байна? 5-аас дээш бол cron-ыг Queue болгох тусдаа ажил хэрэгтэй. |
| 7 | **T5-ийг (MCP tenant тойрох) энэ ажилд оруулах уу?** | `resolveExternalToken` (`index.ts:292–296`) нь `tid` шалгадаггүй; `MglMcpAgent` нь `this.env` (DO-гийн deploy env) хэрэглэдэг. Хоёул `TENANTS` асахад **бүх tenant → MGL-ийн DB**. | Эзэн. Зөвлөмж: **тусдаа 1A ажил**, гэхдээ `TENANTS` бичихээс ӨМНӨ заавал. Энэ сессид зөвхөн `TODO(tenant)` тайлбар. |
