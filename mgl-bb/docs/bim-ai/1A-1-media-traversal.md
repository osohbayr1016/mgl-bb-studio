# 1A-1-media-traversal — /media %2F дамжлага + бичих талын URL хамгаалалт

> **Track:** 1A · PRODUCTION SAFETY (зүйл 1 — ХАМГИЙН ЯАРАЛТАЙ, өнөөдөр амьд)
> **Хамаарал (depends on):** байхгүй. Энэ бол 1A-ийн эхний даалгавар.
> **Блоклож буй (blocks):** 1A-2 … 1A-6, улмаар бүх 1B. `docs/bim-ai/README.md`-ийн дарааллаар 1A бүрэн дуусаад л 1B эхэлнэ.
> **Хөндөх файлууд:** `backend/src/lib/mediaUrl.ts` (шинэ), `backend/src/lib/mediaUrl.test.ts` (шинэ), `backend/src/routes/media.ts`, `backend/src/routes/progress.ts`, `backend/src/routes/revit.ts`, `backend/src/routes/projects.ts`, `backend/src/routes/authorSupervision.ts`, `backend/src/routes/suggestions.ts`
> **Deploy тоо:** 1 (зөвхөн Worker). Migration БАЙХГҮЙ. Add-in (C#) дахин суулгах ШААРДЛАГАГҮЙ. Frontend deploy ШААРДЛАГАГҮЙ.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Дээрх «Хөндөх файлууд» жагсаалтаас гарахгүй. Энэ даалгавар нь **backend-only**. Migration бичихгүй, схем өөрчлөхгүй, frontend-д хүрэхгүй, C# add-in-д хүрэхгүй.

**Бусад агентуудтай зэрэг ажиллаж байна.** Энэ репод хэд хэдэн хөгжүүлэгч/агент ЗЭРЭГ ажилладаг тул working tree-д таны даалгавартай огт хамааралгүй, дуусаагүй, магадгүй **компайл болдоггүй** өөрчлөлт байж болно.

- Өөрийн даалгаварт хэрэгтэй файлыг Л үүсгэ/зас/устга. Хамааралгүй файлыг «засах», reformat хийх, revert хийх, цэвэрлэх ЗӨВШӨӨРӨГДӨХГҮЙ — тэдгээр нь бараг тодорхой өөр агентын WIP.
- **`git restore`, `git checkout --`, `git stash`, `git reset` хэзээ ч бүү ажиллуул.** Өөрөө өөрчлөөгүй файлаа stage/commit бүү хий. **`git add -A` БҮҮ ХЭРЭГЛЭ** — файл бүрийг нэрээр нь нэм.
- **Унасан build автоматаар танийх биш.** `tsc --noEmit` бүх воркерийг компайлдаг тул таны хөндөөгүй файлаас унаж болно. Алдаанууд ЗӨВХӨН хамааралгүй файлд байгаа эсэхийг батал, дараа нь тэр саадыг эзэнд мэдэгд — араас нь бүү хөө.
- Даалгаврын гадна байгаа файл эвдэрхий/байхгүй бол **зогсоод эзнээс асуу**, өөрөө сэргээж бүү дуусга.
- (Сессийн эхэнд ажиглагдсан: `git status` дээр untracked `live2.js` репогийн язгуурт хэвтэж байсан — өөр хүний зүйл, БҮҮ хүр.)

**Deploy хийж болох уу?** Тийм — гэхдээ ЗӨВХӨН эзний зөвшөөрөлтэй. Deploy нь `backend/`-ээс `npx wrangler deploy --config wrangler.toml`. `--config` **заавал**: репогийн язгуурт хэвтэж буй `wrangler.jsonc` нь өөр воркер (`name: "mgl"`, binding-гүй) зарладаг тул wrangler-ийн config discovery түүнийг сонгож болно. **`wrangler deploy` typecheck ХИЙХГҮЙ** — `npx tsc --noEmit`-ыг ӨӨРӨӨ ажиллуул. Deploy нь локал wrangler-ээр явна, CI-аар БИШ (GitHub workflow хоёулаа үхмэл).

**ЭНЭ СЕССИД ХЭЗЭЭ Ч ХИЙЖ БОЛОХГҮЙ:**

| Хориотой | Яагаад |
|---|---|
| `verifyToken` / `authMiddleware`-ыг `purpose === 'mcp'` татгалзахаар чангатгах | Revit add-in REST дуудлага бүрээ ЯГ тэр токеноор баталгаажуулдаг бөгөөд refresh урсгал БАЙХГҮЙ. Энэ бол алсаас сэргээх боломжгүй ЦОРЫН ГАНЦ өөрчлөлт: ~20 PC, `Install.bat`, Revit хаалттай |
| `/media`-г бүрмөсөн хаах | Хэвлэлийн 6 хуудас, клиент портал, `<img src>` бүгд шууд эвдэрнэ. Энэ нь бүтэн засварын СҮҮЛИЙН алхам (§3.5) |
| Түлхүүрт UUID энтропи нэмэх | Шинэ түлхүүрт л үйлчилнэ; урссан URL-ын аюулыг хаахгүй (§3.4-д дүн шинжилгээ) |
| Migration нэмэх | Энэ засварт схемийн өөрчлөлт огт хэрэггүй |
| `LEGACY_MEDIA_ORIGIN`-ыг `wrangler.toml`-оос авах | Тусдаа шийдвэр (§9 №4). Одоо авбал 59 объектын нөхөлт зогсож, ЗХ-ын зураг дахин эвдэрнэ |
| `isMediaUrl`-ийн regex-ийг СУЛРУУЛАХ | Зөвхөн чангаруулна (§4) |

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сессид хангалттай хэмжээгээр)

- **`backend/`** — Cloudflare Worker. Default export нь Hono БИШ, **`@cloudflare/workers-oauth-provider`**; Hono `app` нь түүний `defaultHandler`. D1 (SQLite) + R2 (`MEDIA_BUCKET` нийтийн / `MEETING_BUCKET` хувийн) + KV + нэг Durable Object (`MglMcpAgent`).
- **`frontend/`** — Vite + React 19 SPA, Cloudflare Pages, төсөл нь **`mgl-design-system`** (`--project-name mgl-design-system`-ийг ЗААВАЛ шууд дамжуул; бүх `pages` дэд командыг `npx -y wrangler@latest`-аар ажиллуул).
- **`revit-mcp/addin/`** — Revit 2024–2027 нэмэлт, C#/WPF, in-process, ~16k мөр / 47 файл, тест 0, ажилтны PC дээр авто-шинэчлэл БАЙХГҮЙ.
- **`revit-mcp/training/`** — Python intent-classifier сургалтын pipeline. **`revit-mcp/server/`, `revit-mcp/agent/`** — Python MCP гүүр ба бие даасан локал агент.
- Идэвхтэй мэдлэгийн ажилтан ~49. Продакшн D1 45 MB / 114 хүснэгт; хамгийн том хүснэгт `progress_entries` 8,062 мөр.
- Дүрүүд: `admin | engineer | architect | senior | client | worker`. `role` нь JWT-ээс уншигддаг, DB-ээс БИШ.
- UI нь өгөгдмөлөөрөө монгол (`mn`). Кодын монгол тайлбар, танигч нь ЗОРИУДЫНХ — хэвээр нь үлдээ.

### Платформын хатуу хязгаарууд (энэ даалгаварт хамаарах хэсэг)

- **D1: нэг statement-д дээд тал нь 100 bind.** Тохируулсан жишээ: `backend/src/routes/qto.ts` (4 fact × 21 bind), `backend/src/routes/revit.ts:58` `const BINDS_PER_BINDING_ROW = 13;`.
  ⚠️ **Баримтжуулсан дрифт:** `backend/src/routes/revit.ts:1704`-ийн тайлбарын эхний өгүүлбэр «12 bind/мөр → floor(100/12) = 8 мөр/statement» гэж бичсэн атлаа `1706` мөрийн тогтмол нь `const BINDS = 13;`; тэр тайлбарын ХОЁРДУГААР өгүүлбэр (`1705`) өөрөө «13 × 7 = 91 ≤ 100» гэж ЗӨВ тоог бичсэн. **Тайлбарын эхний өгүүлбэр буруу, тогтмол зөв.** Хуулж авахдаа тогтмолыг нь ав. (Энэ даалгавар bind тоог хөндөхгүй — зөвхөн мэдэж байх ёстой.)
- **Migration нь APPEND-ONLY.** 190 файл, хамгийн өндөр нь `0200_assistant_feedback_note.sql`. Хэрэглэгдсэн файлыг засах нь продакшн дээр ЧИМЭЭГҮЙ no-op. Дунд нь унасан блок нь DB-г хагас нүүлгэсэн байдалд орхино — цорын ганц хууль ёсны засвар нь ШИНЭ дугаар.
- `CREATE TABLE` / `CREATE INDEX` бүр `IF NOT EXISTS`-тэй. Байгаа хүснэгт дээрх `ALTER` нь блокийн ХАМГИЙН ЭХЭНД байна.
- `wrangler d1 migrations apply` файл бүрийг транзакцад ороодог — тэнд `ON DELETE CASCADE` АЖИЛЛАНА (D1 нь runtime дээр FK-г шалгадаггүй ч энэ нь өөр зам). `users` (27 амьд cascading хүүхэд) болон `projects` (38) хүснэгтийг migrations apply-аар ХЭЗЭЭ Ч дахин барихгүй.
- wrangler нь нийлмэл statement-ыг **том/жижиг үсэг ялгадаг**, өмнөө зайтай терминатораар салгадаг: `END;` том үсгээр, өөрийн мөрөнд.
- 190 migration файлд `CREATE TRIGGER`, `CREATE VIEW`, `GENERATED ALWAYS`, `json_extract` **нэг ч удаа** байхгүй. Тэднийг ашиглах бол эхлээд хаях D1 дээр батал.

**Энэ даалгаварт эдгээрийн аль нь ч ХЭРЭГЛЭГДЭХГҮЙ** — migration огт бичихгүй. Дээрх нь зөвхөн «энэ репод юу хэвийн вэ» гэдгийг мэдэхийн тулд.

### Яагаад энэ даалгавар байгаа вэ

`GET /media/:key` нь баталгаажуулалтгүй, түлхүүрээ мэдсэн хэн ч уншина — энэ нь `CLAUDE.md → Security posture #2`-т **баримтжуулсан, зөвшөөрсөн** байдал. Кодын хэд хэдэн газар «route нь ЯГ нэг сегмент тул хавтастай түлхүүр хэзээ ч уншигдахгүй» гэсэн **үндэслэл дээр** тулгуурлан аюулгүй байдлын шийдвэр гаргасан.

**Тэр үндэслэл ХУДАЛ.** Hono 4.12.14 нь `decodeURI` хийсэн зам дээр route-даг (`decodeURI` нь `%2F`-ыг задалдаггүй), гэтэл `c.req.param()` нь дараа нь бүрэн `decodeURIComponent` хийдэг. Үр дүнд нь **нэг сегментийн route олон сегментийн R2 түлхүүрт хүрнэ.**

Энэ нь одоо продакшн дээр амьд (§2.1-д нотолгоо). Хамгийн ноцтой үр дагавар: `email/…` угтвар дор хадгалагдсан **бүх и-мэйлийн бие ба хавсралт** (REST талдаа `requireAdmin()`-ээр хаалттай) болон **эзэмшигчид зориулсан add-in суулгагч** нь **баталгаажуулалтгүй** татагдана.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх мөр бүрийг 2026-08-27-нд репо дээр нээж баталгаажуулсан. Тайлбар/код нь бодит эх бичвэр.

### 2.1 Дамжлагыг ДАХИН ҮЙЛДЭХ (хийсэн; шинэ сесс мөн хийх ёстой)

**A. Hono давхарга — тодорхойлолтын түвшний нотолгоо.** `backend/`-ээс:

```bash
node --input-type=module -e 'import {Hono} from "hono"; const a=new Hono(); a.get("/media/:key",c=>c.text(c.req.param("key"))); const r=await a.request("http://x/media/email%2F5%2Fx%2Fbody.html"); console.log("STATUS", r.status, "PARAM=", await r.text()); const r2=await a.request("http://x/media/email/5/x/body.html"); console.log("plain slash STATUS", r2.status);'
```

Хэмжсэн гаралт:

```
STATUS 200 PARAM= email/5/x/body.html
plain slash STATUS 404
```

Өөрөөр хэлбэл: **бодит `/` нь 404** (нэг сегментийн route таарахгүй) атлаа **`%2F` нь 200 буцаагаад параметрийг задалсан олон сегмент болгож өгнө.** Hono хувилбар: `backend/node_modules/hono/package.json` → `"version": "4.12.14"`.

**B. ПРОДАКШН — амьд эксплойт (read-only HEAD).**

```bash
H=https://mgl-progress-api.mglenc-design.workers.dev
curl -s -o /dev/null -w "%{http_code}\n" "$H/media/definitely-not-here-xyz.png"
curl -s -I "$H/media/revit-addin%2FRevitMcpAddin-Revit2027.zip" | head -9
```

Хэмжсэн гаралт (2026-08-27 04:13 UTC):

```
404
HTTP/1.1 200 OK
Content-Type: application/zip
Content-Length: 3559810
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=31536000
ETag: "cce6a126061801fa680466e42dc982ed"
Cross-Origin-Resource-Policy: cross-origin
```

3.5 MB-ийн add-in суулгах zip нь **токенгүй, cookie-гүй** татагдав. Нэмэлт хэмжилт:

| Хувилбар | Үр дүн | Тайлбар |
|---|---|---|
| `%2F` (том үсэг) | **200** | эксплойт |
| `%2f` (жижиг үсэг) | **200** | эксплойт — regex зөвхөн түүхий мөрөнд `/` байгааг шалгаж БОЛОХГҮЙ, ЗАДАЛСАН утган дээр шалгах ёстой |
| бодит `/` | 404 | route таарахгүй |
| `%252F` (давхар кодлолт) | 404 | түлхүүр нь `revit-addin%2FRevit…` литерал болно |
| `CF-Cache-Status` толгой | **байхгүй** | ирмэгийн кэшд ороогүй → засварын дараа Cloudflare purge шаардлагагүй (браузерын локал кэш л үлдэнэ) |

### 2.2 `routes/media.ts` — баталгаажуулалт байхгүй, CORS `*`, кэш 1 жил

| Баримт | file:line | Бодит код / текст |
|---|---|---|
| Нийтийн mount (authMiddleware-ээс ГАДНА) | `backend/src/index.ts:193` | `app.route('/media', media);` |
| Яагаад гэсэн тайлбар | `backend/src/index.ts:189-192` | «Public mount — uploads return `/media/<key>` for use in plain `<img src>` tags, which can't carry the bearer token that `/api/*` requires.» |
| CORS `origin: '*'` | `backend/src/index.ts:142` | `app.use('/media/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));` |
| authMiddleware ЗӨВХӨН `/api/*` дээр | `backend/src/index.ts:145` | `app.use('/api/*', authMiddleware);` |
| Route өөрөө | `backend/src/routes/media.ts:55-57` | `media.get('/:key', async (c) => { const key = c.req.param('key'); const object = await c.env.MEDIA_BUCKET.get(key);` |
| `Cache-Control: public, max-age=31536000` (hit зам) | `backend/src/routes/media.ts:64` | |
| `Cross-Origin-Resource-Policy: cross-origin` (hit зам) | `backend/src/routes/media.ts:65` | |
| Ижил хоёр толгой (legacy зам) | `backend/src/routes/media.ts:46`, `:50` | `mediaHeaders()` доторх |
| CORP-ийн шалтгаан | `backend/src/routes/media.ts:47-49` | «Allow cross-origin reads from COEP pages (e.g. the IFC viewer page that turns on Cross-Origin-Embedder-Policy to enable SharedArrayBuffer / multi-threaded web-ifc parsing).» |
| `Content-Length`-ийг ГАРААР тавих шалтгаан | `backend/src/routes/media.ts:40-45` | QTO нь оверсайз `.ifc`-ыг ТАТАХААС ӨМНӨ таслахдаа үүнээс хамаардаг |

`media` нь **хоёр газар** mount хийгдсэн: `app.route('/api/media', media)` (`index.ts:188` — authMiddleware-ийн ард, баталгаажсан) ба `app.route('/media', media)` (`index.ts:193` — нээлттэй). Route дотор нь тавьсан шалгалт ХОЁУЛАНД нь үйлчилнэ, энэ нь зөв.

### 2.3 `LEGACY_MEDIA_ORIGIN` — нөхөх зам, өнөөдөр АСААЛТТАЙ

- `backend/wrangler.toml:118` → `LEGACY_MEDIA_ORIGIN = "https://mgl-progress-api.anandoctane4.workers.dev"` — **продакшнд тавигдсан.** Төрөл: `backend/src/types.ts:32` `LEGACY_MEDIA_ORIGIN?: string;`
- `backend/src/routes/media.ts:70-71` → `const legacy = (c.env.LEGACY_MEDIA_ORIGIN ?? '').replace(/\/$/, ''); if (!legacy) return c.notFound();`
- `backend/src/routes/media.ts:75` → `` res = await fetch(`${legacy}/media/${encodeURIComponent(key)}`, { cf: { cacheEverything: false } }); ``
- Self-heal: `media.ts:96-104` — ≤32 MB (`BACKFILL_MAX_BYTES`, `media.ts:34`) объектыг бүтнээр уншиж, ЗЭРЭГ буцаагаад ЗЭРЭГ `MEDIA_BUCKET.put(key, …)` хийж `customMetadata: { backfilledFrom: 'legacy', backfilledAt }` тэмдэглэдэг. Түүнээс том нь зөвхөн дамжина (`media.ts:89-91`).
- **Хэмжээний тайлбар** (`backend/src/routes/media.ts:14-16`):
  «Хэмжилт (2026-08-25): хуучин 11,290 объект / 8.35 GB, шинэ 11,231 / 8.34 GB — 59 объектын зөрүү. Илрэл нь `/app/asr/28`-ын эвдэрсэн зургууд, гарын үсэг байхгүй PDF.»
- **Аюулгүй байдлын нэмэгдүүлэлт (amplification):** `encodeURIComponent(key)` нь задарсан `/`-ыг `%2F` болгож БУЦААЖ кодлодог тул дамжлагын хүсэлт хуучин акаунтын воркер руу мөн `%2F` хэлбэрээр очно. Хуучин воркер ижил Hono route-тай тул **дамжлага хуучин акаунтын bucket-т ч ажиллана** — тэнд шилжээгүй үлдсэн 59 объект багтана. Түүнчлэн self-heal нь дамжлагаар уншсан **хавтастай түлхүүрийг шинэ bucket руу хуулна** (`media.ts:98`).
- ⚠️ `backend/src/routes/media.ts:23-27`-ийн тайлбар өөрөө ХУДАЛ үндэслэлийг давтдаг:
  «⚠️ Аюулгүй байдлын хувьд ШИНЭ гадаргуу НЭЭХГҮЙ: хуучин `/media/:key` нь аль хэдийн түлхүүрээрээ нээлттэй (docs-ийн Security #2), route нь **яг нэг сегмент тул SSRF болох зам байхгүй**…»
  Засварын дараа ЭНЭ ТАЙЛБАРЫГ засах ёстой (§3.2.4).

### 2.4 Юу задарч байна — R2 түлхүүрийн угтварууд

| Угтвар | Хаана үүсдэг | REST талын хамгаалалт | Дамжлагаар нээгдэх үү |
|---|---|---|---|
| `email/<accountId>/<gmailId>/body.html` | `backend/src/lib/emailSync.ts:88-89` | `router.get('/messages/:id/body.html', requireAdmin(), …)` — `backend/src/routes/email.ts:633` | **Тийм** |
| `email/<accountId>/<gmailId>/att-<i>-<safeName>` | `backend/src/lib/emailSync.ts:142-143` | `router.get('/attachments/:id', requireAdmin(), …)` — `backend/src/routes/email.ts:670` | **Тийм** |
| `client-reports/<projectId>-<reportId\|live>-<uuid>.pdf` | `backend/src/mcp/tools/generateReport.ts:111-112` | — | Тийм, гэхдээ UUID-тай тул таамаглах боломжгүй. MCP-ийн буцаадаг URL (`generateReport.ts:114`) нь бодит `/`-той учир **үргэлж 404** — энэ бол урьд нь баримтжуулсан алдаа |
| `revit-addin/RevitMcpAddin-Revit<он>.zip` | `backend/src/routes/revitAddin.ts:14` | Эзэмшигч (id 1) БҮХ route дээр — `revitAddin.ts:9, 19-24` | **Тийм — §2.1B-д нотлогдсон. Энтропи ТЭГ** |

`backend/src/routes/revitAddin.ts:27-29`-ийн тайлбар нь энэ хаалт **яг `/media` баталгаажуулалтгүйгээс болж** байгааг илэрхий бичсэн:

```
// GET /api/revit-addin/download/:year — суулгах zip-ийг attachment болгож татуулна.
// Нийтийн /media/<key> линк ашиглахгүй (тэр нь authless) — зөвхөн энэ gated
// route-оор дамжуулна.
```

`backend/src/routes/revitAddin.ts:9, 12, 14`:

```ts
const OWNER_ID = 1;
const YEARS = ['2024', '2025', '2026', '2027'] as const;
const r2Key = (year: Year) => `revit-addin/RevitMcpAddin-Revit${year}.zip`;
```

`backend/src/routes/revitAddin.ts:19-24` — эзэмшигчийн middleware:

```ts
revitAddin.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user || user.sub !== OWNER_ID) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
});
```

Түлхүүр нь бүрэн урьдчилан таамаглагдах — **дөрвөн боломжит утга, энтропи 0.**

### 2.5 Бичих талын хамгаалалт — regex нь `%2F`-ыг НЭВТРҮҮЛНЭ

`backend/src/routes/authorSupervision.ts:115-117`:

```ts
function isMediaUrl(v: unknown): v is string {
  return typeof v === 'string' && /^\/media\/[^/]+$/.test(v);
}
```

Дээрх тайлбар (`authorSupervision.ts:108-114`):

```
 * `/media/<key>` хэлбэрийг ЗААВАЛ шаардана.
 *
 * Хоёр шалтгаан: (1) `routes/media.ts` бол `GET /:key` — ЯГ нэг сегмент,
 * тул хавтастай түлхүүр хэзээ ч уншигдахгүй; (2) гаднын URL-ыг тайлан
 * руу шургуулж, дараа нь хэвлэх хуудсаар дамжуулан ачаалуулахаас сэргийлнэ.
```

Ижил regex + ижил (худал) үндэслэл: `backend/src/routes/suggestions.ts:77-85`:

```ts
function isMediaUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_IMAGE_URL && /^\/media\/[^/]+$/.test(v);
}
```

**Regex-ийг тестлэсэн:**

```
/^\/media\/[^/]+$/.test('/media/email%2F5%2Fx%2Fbody.html')  →  true    ← НЭВТЭРЧ БАЙНА
/^\/media\/[^/]+$/.test('/media/email/5/x/body.html')        →  false
```

Өөрөөр хэлбэл **бичих талын regex дамжлагыг зогсоохгүй**: `%2F`-той утга D1-д ороод, дараа нь `<img src>`-ээр эсвэл шууд R2 замаар (§2.7) уншигдана. `frontend/src/shared/api/client.ts:34-38` `mediaUrl()` нь хадгалсан замыг **дахин кодлохгүй** дамжуулдаг тул хадгалсан `%2F` нь Worker руу яг тэр хэвээрээ очно:

```ts
export function mediaUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  return `${getMediaBaseUrl()}${path.startsWith('/') ? '' : '/'}${path}`;
}
```

Дуудагчид: `authorSupervision.ts:154` (`sanitizePhotos`), `:164` (`sanitizeSignatureUrl`), `suggestions.ts:127` (`normalizeImagesInput`).

### 2.6 Regex-ийг ОГТ хэрэглэдэггүй бичих цэгүүд

| Файл:мөр | Талбар | Одоогийн шалгалт |
|---|---|---|
| `backend/src/routes/progress.ts:175` | `attachments[].url` | `if (!url.startsWith('/media/') \|\| url.length > MAX_ATTACHMENT_URL)` — **зөвхөн угтвар** |
| `backend/src/routes/progress.ts:401` | `image_url` | `const imageUrl = body.image_url ?? att.firstImage;` — **ШАЛГАЛТ ОГТ БАЙХГҮЙ.** Дурын мөр (гадаад `https://`, хавтастай `/media/…`) шууд `progress_entries.image_url`-д орно |
| `backend/src/routes/revit.ts:1181` | `evidence[].url` | `if (!String(e?.url ?? '').startsWith('/media/'))` — **зөвхөн угтвар** |
| `backend/src/routes/projects.ts:867-871` | `key_image_url` | `values.push(keyImageUrl?.trim() \|\| null);` — **ШАЛГАЛТ ОГТ БАЙХГҮЙ** |

`progress.ts:132-133`-ийн тайлбар «`url` нь ЗААВАЛ `/media/<key>` байх ёстой — `POST /api/upload` яг тэрийг буцаадаг» гэж амладаг; код түүнийг зөвхөн угтварын түвшинд хэрэгжүүлдэг.

`revit.ts:1178` тайлбар: «4. Нотолгооны URL — /media/ түлхүүр л зөвшөөрнө (image_url хүлээж авахгүй).»

**Спекийн гадна олдсон, ижил ангиллын НЭМЭЛТ цэгүүд** (энэ сессийн ЗААВАЛ хамрах хүрээнд БАГТААГҮЙ, §9 №5-д шийдвэр хүлээж байна):

| Файл:мөр | Талбар | Шалгалт |
|---|---|---|
| `backend/src/routes/auth.ts:193-199` (`allowed` жагсаалт), бичилт `:203-209` | `profile_image`, `cover_image`, `signature_url`, `stamp_url` | байхгүй — `values.push(body[key])` |
| `backend/src/routes/users.ts:636-643` | `signature_url`, `stamp_url` (админ засварлах) | байхгүй |
| `backend/src/routes/settings.ts:143-150` | `report_logo_url`, `report_stamp_url` (`app_settings`) | байхгүй |
| `backend/src/routes/projects.ts:1620-1626` | `client_logo_url:<projectId>` (`app_settings`) | байхгүй |

### 2.7 HTTP түвшний хамгаалалт ГАНЦААРАА ХАНГАЛТГҮЙ — шууд R2 зам

`backend/src/lib/clientReportRender.ts:125-133`:

```ts
/** Inline an image URL as a base64 data URI (WeasyPrint renders these
 *  deterministically). /media/* paths are read straight from R2 (no hop). */
async function inlineImage(env: Env, url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    if (url.startsWith('/media/')) {
      const key = decodeURIComponent(url.slice('/media/'.length));
      const obj = await env.MEDIA_BUCKET.get(key);
```

Энэ нь **HTTP хүсэлт огт хийхгүй** — R2 binding руу шууд ханддаг. Тиймээс `routes/media.ts`-д тавьсан ямар ч шалгалт энэ зам дээр **хэзээ ч ажиллахгүй**. Түүнээс гадна `decodeURIComponent` (`:131`) нь `%2F`-ыг өөрөө задалдаг тул D1-д хадгалагдсан `%2F`-той утга нь ЯГ хавтастай түлхүүр рүү хөрвөнө. **Иймээс бичих талыг ЗАЙЛШГҮЙ хамт засах ёстой** — уншилтын хамгаалалт ганцаараа энэ гарцыг хаахгүй.

### 2.8 Түлхүүрийн энтропи

`backend/src/routes/upload.ts:33` (нэг удаагийн байршуулалт):

```ts
const fileName = `${user.sub}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
```

`backend/src/routes/upload.ts:136` (multipart create):

```ts
const key = `${user.sub}-${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
```

`upload.ts:53-57` — яагаад `/media` нь `/api/*`-ын гадна байдаг вэ:

```ts
    // Public, unauthenticated path — `<img src>` tags can't send the
    // bearer token, so we deliberately route media outside `/api/*`
    // (which is behind authMiddleware).
    const url = `/media/${fileName}`;
```

**Үнэлгээ:** `user.sub` нь жижиг бүхэл тоо (~49 ажилтан), `Date.now()` нь өдөрт 86,400,000 боломж ≈ **2^26.4**, файлын нэр нь ихэвчлэн таамаглагдах (`signature.png`, `IMG_1234.jpg`). Тэгэхээр энтропи нь **тэг биш ч сул** — зорилтот өдөр мэдэгдэж байвал нэг хэрэглэгчийн нэг файлыг олох нь ~2^26 хүсэлтийн эрэмбэ. Энэ бол ноцтой боловч **дамжлагатай харьцуулбал хоёрдогч**: `email/…` болон `revit-addin/…` угтварууд энтропи огт агуулаагүй.

`upload.ts:88-90`-д `ownsKey` бий:

```ts
function ownsKey(userSub: string | number, key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(`${userSub}-`);
}
```

— гэхдээ энэ нь зөвхөн multipart part/complete/abort route-уудыг хамгаална (`upload.ts:154, 185, 227`), уншилтыг БИШ.

### 2.9 Аль хэдийн хийгдсэн ЗӨВ загварууд (үлгэр болгон ашигла)

- `backend/src/routes/email.ts:917` — и-мэйлийн хавсралтыг лежер рүү холбохдоо **зориудаар ХАВТАСГҮЙ болгодог**:
  `` const flatName = `corr-att-${messageId}-${att.id}-${(att.filename || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 100)}`; ``
  Өөрөөр хэлбэл «`/media` дээр гарах бүх утга нэг сегмент байх ёстой» гэдэг нь аль хэдийн бодит конвенц.
- `backend/src/lib/asrTranscription.ts:20-23` — «Талбайн дуу бичлэгийг `MEDIA_BUCKET` руу тавьж БОЛОХГҮЙ — `/media/:key` нь баталгаажуулалтгүй, түлхүүрээ мэдсэн хэн ч уншина (CLAUDE.md → Security #2).»
- `backend/src/routes/suggestions.ts:106-111, 129-133` — нууц саналын зурагт `ownsKey`-тэй ижил `<userSub>-` угтварын шалгалт бий тул тэнд байгаа R2 `delete` примитив (`suggestions.ts:166`) нь дамжлагаар мултрахгүй.

---

## 3. ХИЙХ АЖИЛ

**Нэг commit, нэг deploy.** Уншилтын хаалт ба бичих талын хаалт нэг commit-д байх ЁСТОЙ: уншилт ганцаараа шууд-R2 замыг хаахгүй (§2.7), бичилт ганцаараа аль хэдийн хадгалагдсан утгыг хаахгүй.

### 3.1 Шинэ хуваалцсан туслах: `backend/src/lib/mediaUrl.ts`

Зорилго: «нэг сегмент» гэсэн ойлголтыг НЭГ газар тодорхойлж, уншилт ба бичилт хэзээ ч зөрөхгүй байх.

```ts
/**
 * `/media/<key>` — НЭГ СЕГМЕНТ.
 *
 * ⚠️ ЯАГААД ЗАДАЛСАН УТГА ДЭЭР ШАЛГАХ ЁСТОЙ ВЭ:
 * Hono 4.12.14 нь `decodeURI` хийсэн зам дээр route-даг (`decodeURI` нь
 * `%2F`-ыг ЗАДАЛДАГГҮЙ) атлаа `c.req.param()` нь дараа нь бүрэн
 * `decodeURIComponent` хийдэг.  Тиймээс `/media/email%2F5%2Fx%2Fbody.html`
 * нь `GET /:key`-д ТААРААД `key = 'email/5/x/body.html'` болно (`%2f`
 * жижиг үсгээр ч ижил).  Мөн `lib/clientReportRender.ts:131` нь хадгалсан
 * утган дээр ӨӨРӨӨ `decodeURIComponent` хийж R2 руу ШУУД ханддаг —
 * HTTP hop БАЙХГҮЙ тул `routes/media.ts`-ийн шалгалт тэнд ажиллахгүй.
 * Иймд шалгалт нь ЗААВАЛ задалсны ДАРАА `/` эсэхийг үзнэ — түүхий
 * мөрөнд `/` байхгүй нь юу ч батлахгүй.
 */

/** R2 түлхүүр нэг сегмент мөн эсэх.  Задалсны дараа шалгана. */
export function isSingleSegmentKey(key: string): boolean {
  if (key.length === 0) return false;
  let decoded = key;
  // Давхар кодлолтыг ч барихын тулд тогтвортой цэг хүртэл задална.
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return false; // гэмтсэн хувь (`%zz`) — татгалзана
    }
    if (next === decoded) break;
    decoded = next;
  }
  return !decoded.includes('/') && !decoded.includes('\\') && !decoded.includes('\0');
}

/** `/media/<нэг сегмент>` хэлбэрийн URL мөн эсэх (бичих талын хаалт). */
export function isSingleSegmentMediaUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (!v.startsWith('/media/')) return false;
  return isSingleSegmentKey(v.slice('/media/'.length));
}
```

**Тэмдэглэл:** `decodeURIComponent`-ыг тогтвортой цэг хүртэл давтаж байгаа нь `%252F` (өнөөдөр 404 өгдөг, §2.1) хэлбэрийг ирээдүйд ямар нэг зам нэмэлт задлалт хийвэл ч хаагдсан байлгах зорилготой. Хэрэв энэ нь хэт хатуу гэж үзвэл нэг удаагийн задлалт хангалттай — гэхдээ аль сонголтыг ч авсан **шалтгааныг кодын тайлбарт бич** (§9 №6).

**Тест: `backend/src/lib/mediaUrl.test.ts`.** Энэ репод backend-ийн тестүүд `src/lib/`-д, `node --test "src/**/*.test.ts"`-ээр ажилладаг. ⚠️ Өргөтгөлгүй харьцангуй импорттой эх файл импортлох тест нь эхлээд `registerHooks`-оор `.ts` resolver бүртгээд дараа нь `await import(...)` хийх ёстой (`webPush.test.ts`, `leaveWindow.test.ts` яг тэгдэг) — энгийн статик импорт нь ЗӨВХӨН `node --test` дор унана, `tsc` ногоон хэвээр байдаг тул эвдрэл нь суудаг. `mediaUrl.ts` нь юу ч импортлохгүй тул энэ асуудал үүсэхгүй, гэхдээ хэв маягийг мэдэж бай.

### 3.2 `backend/src/routes/media.ts` — уншилтын хаалт

`media.ts:55-57`-г дараах болгоно:

```ts
// GET /media/:key
media.get('/:key', async (c) => {
  const key = c.req.param('key');

  /* ⚠️ Hono нь `%2F`-ыг задалж НЭГ СЕГМЕНТИЙН route-оор ОЛОН сегментийн
   * түлхүүрт хүргэдэг (`lib/mediaUrl.ts`-ийн толгойн тайлбарыг үз).
   * Ингэснээр `email/<acc>/<gmailId>/body.html` (и-мэйлийн бие — REST
   * талдаа `requireAdmin()`), `revit-addin/…zip` (эзэмшигчид зориулсан
   * суулгагч) зэрэг угтвар дор байгаа БҮХ объект баталгаажуулалтгүй
   * уншигдана.  Тиймээс bucket руу хүрэхЭЭС ӨМНӨ таслана. */
  if (!isSingleSegmentKey(key)) return c.notFound();

  const object = await c.env.MEDIA_BUCKET.get(key);
```

- Импорт нэмнэ: `import { isSingleSegmentKey } from '../lib/mediaUrl';`
- `c.notFound()` (404) сонгосон нь `c.json({ error }, 403)` биш — **байгаа/байхгүйг ялгаж мэдэгдэхгүй**; одоо байгаа «олдсонгүй» зан төлөвтэй мөн ижил.
- Хаалт нь legacy fetch-ээс (`media.ts:69-75`) **ӨМНӨ** байх ЁСТОЙ — эс бөгөөс дамжлага хуучин акаунт руу үргэлжилнэ (§2.3).
- Хаалт нь `/api/media` (`index.ts:188`) ба `/media` (`index.ts:193`) **хоёуланд нь** үйлчилнэ. Энэ нь зөв: `/api/media` баталгаажсан ч түүгээр и-мэйлийн бие уншуулах шаардлага байхгүй.

**3.2.4 — Худал тайлбаруудыг засах (ЗААВАЛ).** Дараах гурван тайлбар «нэг сегмент тул хавтастай түлхүүр хэзээ ч уншигдахгүй» гэсэн ХУДАЛ баримтыг давтдаг. Тэднийг «Hono `%2F`-ыг задалдаг тул шалгалт нь `lib/mediaUrl.ts`-д, ЗАДАЛСАН утган дээр хийгддэг» болгож солино:

| Файл:мөр | Одоогийн худал өгүүлбэр |
|---|---|
| `backend/src/routes/media.ts:24-25` | «route нь яг нэг сегмент тул SSRF болох зам байхгүй» |
| `backend/src/routes/authorSupervision.ts:111-112` | «`routes/media.ts` бол `GET /:key` — ЯГ нэг сегмент, тул хавтастай түлхүүр хэзээ ч уншигдахгүй» |
| `backend/src/routes/suggestions.ts:79-80` | «`routes/media.ts` бол `GET /:key`, ЯГ нэг сегмент тул хавтастай түлхүүр хэзээ ч уншигдахгүй» |

Мөн `authorSupervision.ts:116` ба `suggestions.ts:84`-ийн `isMediaUrl` биеийг `isSingleSegmentMediaUrl`-аар солино. **`suggestions.ts`-ийн `v.length <= MAX_IMAGE_URL` шалгалтыг АРИЛГАХГҮЙ** — хамт үлдээ:

```ts
// suggestions.ts
function isMediaUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_IMAGE_URL && isSingleSegmentMediaUrl(v);
}
```

(Функцийн НЭРИЙГ `isMediaUrl` хэвээр үлдээ — дуудагчид нь `authorSupervision.ts:154, 164` ба `suggestions.ts:127`. Нэр солих нь диффыг шалтгаангүй томруулна.)

### 3.3 Бичих талын хаалт — regex дутуу дөрвөн цэг

| # | Файл:мөр | Өөрчлөлт |
|---|---|---|
| 1 | `backend/src/routes/progress.ts:175` | `if (!url.startsWith('/media/') \|\| …)` → `if (!isSingleSegmentMediaUrl(url) \|\| url.length > MAX_ATTACHMENT_URL)`. Алдааны мессежийг **бүү өөрчил** (`'Attachment url must be a /media/ key'`) |
| 2 | `backend/src/routes/progress.ts:401` | `image_url`-д шалгалт **шинээр нэмнэ** (доор) |
| 3 | `backend/src/routes/revit.ts:1181` | `if (!String(e?.url ?? '').startsWith('/media/'))` → `if (!isSingleSegmentMediaUrl(String(e?.url ?? '')))`. Мессеж хэвээр (`'Evidence url must be a /media/ key'`) |
| 4 | `backend/src/routes/projects.ts:867-871` | `key_image_url`-д шалгалт нэмнэ (доор) |

`progress.ts` `image_url` (одоогийн `:398-401`-ийн дараа):

```ts
  // `image_url` нь хуучин ганц зургийн багана.  Хэрэв дуудагч зөвхөн шинэ
  // `attachments`-ыг өгсөн бол эхний ЗУРГИЙГ нь тэнд давхар бичнэ — ингэснээр
  // `image_url`-ыг уншдаг хуучин код (тайлан, экспорт) хэвээр ажиллана.
  const imageUrl = body.image_url ?? att.firstImage;
  // ⚠️ `body.image_url` нь урьд НЭГ Ч шалгалтгүй байсан — дурын мөр (гадаад
  //    URL, хавтастай `/media/…`) шууд баганад ордог байв.  `att.firstImage`
  //    нь аль хэдийн шалгагдсан тул давхардсан шалгалт үнэгүй.
  if (imageUrl != null && imageUrl !== '' && !isSingleSegmentMediaUrl(imageUrl)) {
    return c.json({ error: 'image_url must be a /media/ key' }, 400);
  }
```

`projects.ts` `key_image_url` (одоогийн `:867-871`-ийг орлуулна):

```ts
  if ((body as { key_image_url?: unknown }).key_image_url !== undefined) {
    const keyImageUrl = (body as { key_image_url?: string | null }).key_image_url;
    const trimmed = keyImageUrl?.trim() || null;
    // Хоосон/`null` = зургийг АВАХ (хүчинтэй үйлдэл).  Утгатай бол ЗААВАЛ
    // `/media/<нэг сегмент>` — `ProjectKeyImage.tsx:35-38` нь `uploadFile()`-ийн
    // буцаасан яг тэр хэлбэрийг л илгээдэг.
    if (trimmed !== null && !isSingleSegmentMediaUrl(trimmed)) {
      return c.json({ error: 'key_image_url must be a /media/ key' }, 400);
    }
    updates.push('key_image_url = ?');
    values.push(trimmed);
  }
```

**`null`/хоосон утгыг татгалзаж БОЛОХГҮЙ** — «зургийг устгах» нь хүчинтэй үйлдэл.

Файл бүрт импорт нэмнэ: `import { isSingleSegmentMediaUrl } from '../lib/mediaUrl';`

### 3.4 UUID энтропи — ЯАГААД ЭНЭ СЕССИД ХИЙХГҮЙ ВЭ (дүн шинжилгээ)

Санал: `upload.ts:33` ба `:136`-ийн түлхүүрийг `${user.sub}-${Date.now()}-${crypto.randomUUID()}-${name}` болгох.

**Хийхгүй байх шалтгаанууд:**

1. **Урссан URL-ын аюулыг ОГТ хаахгүй.** Аюулын гол загвар нь «баталгаажуулалтгүй уншилт» — и-мэйлээр, чатаар, скриншотоор, browser history-гээр, referrer-ээр дамжсан `/media/<key>` линк нь хэн ч дарахад ажилладаг хэвээр байна. UUID нь ЗӨВХӨН **таамаглалыг** хаана.
2. **Зөвхөн ШИНЭ объектод үйлчилнэ.** ~11,231 одоо байгаа объект (`media.ts:14-15`) сул түлхүүртэй хэвээр үлдэнэ. Тэднийг зөөх нь §3.5-ын «COPY → D1 rewrite → soak» ажил.
3. **Дамжлагатай харьцуулбал ач холбогдол багатай.** Хамгийн ноцтой задралууд (`email/…`, `revit-addin/…`) нь `upload.ts`-ээр огт үүсдэггүй — тэднийг UUID хөндөхгүй.
4. **Эрсдэл нь ашгаасаа их.** `upload.ts:88-90`-ийн `ownsKey` ба `suggestions.ts:130-133`-ийн угтварын шалгалт хоёулаа түлхүүрийн ХЭЛБЭРЭЭС хамаардаг; multipart урсгал нь `key`-г клиентээр буцааж эргүүлдэг (`upload.ts:141, 149, 185, 227`). Хэлбэр солих нь эдгээрийг ЗЭРЭГ шалгахыг шаардана — 1A-1-ийн «хамгийн бага, аюулгүй» хамрах хүрээнээс гарна.

**Дүгнэлт:** энтропи нэмэх нь §3.5-ын бүтэн засварын нэг хэсэг — «COPY (зөөхгүй) объект + D1 rewrite» алхамд шинэ түлхүүрийн хэлбэрийг ХАМТ нэвтрүүлнэ. Тэгвэл нэг л удаа хуулна.

### 3.5 БҮТЭН ЗАСВАР — зөвхөн ТОДОРХОЙЛОЛТ (энэ сессид ХЭРЭГЖҮҮЛЭХГҮЙ)

Дотоод дараалал нь ХАТУУ. Алхам алгасах нь эвдэрсэн зураг/PDF-ээр илэрнэ.

| # | Алхам | Яагаад ЯГ энэ дараалалд |
|---|---|---|
| 1 | Гарын үсэгтэй уншилтын route-ыг **нээлттэй `/media`-ийн ХАЖУУД** нэмэх (жишээ нь `/media-signed/:key?t=<jwt>`, `routes/meetingAudio.ts`-ийн `purpose:'stt-audio'` загвараар) | Хоёулаа зэрэг ажиллаж байж л дараагийн алхмуудыг эрсдэлгүй хийнэ |
| 2 | Уншилтын endpoint-ууд ба frontend-д токен минтлэх | Хэрэглэгчид шинэ зам руу шилжинэ, хуучин нь ажилласаар |
| 3 | **Зургаан хэвлэлийн route**-ыг засаж, PDF бүрийг НҮДЭЭР шалгах | Хэвлэл нь headless Chromium (Browser Rendering) + WeasyPrint — автомат тест байхгүй, зөвхөн нүдээр |
| 4 | Объектыг **ХУУЛАХ (COPY, зөөхгүй)** + D1-ийн утгыг rewrite (энд UUID энтропи нэмнэ) | Зөөвөл буцах зам байхгүй; хуулбал rollback нь зүгээр л хуучин утга руу буцаах |
| 5 | **Soak** — хэдэн долоо хоног 404/алдаа хянах | Хамгийн олон нуугдмал уншигч энэ үед илэрнэ |
| 6 | Зөвхөн ҮҮНИЙ ДАРАА `/media`-г хаах | Эрт хаавал клиент портал, тайлан, ЗХ-ын зураг зэрэг мэдэгдээгүй хэрэглэгчид эвдэрнэ |

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана (баталгаажсан) | Яагаад эвдрэх вэ |
|---|---|---|
| **`/media` нь `/api/*`-ын ГАДНА** | `backend/src/index.ts:189-193`; шалтгаан нь `backend/src/routes/upload.ts:53-55` | `<img src>` тэг нь `Authorization` толгой явуулж ЧАДАХГҮЙ. `/media`-г `/api/*` доор оруулах эсвэл authMiddleware нэмэх нь БҮХ аватар, ЗХ-ын зураг, тайлангийн лого, гарын үсгийг тэр даруй эвдэнэ |
| **Зургаан хэвлэлийн route** | `frontend/src/app/routes.tsx:180` (`/reports/project/:id/print`), `:182` (`/reports/project/:id/performance-report/:reportId/print`), `:186` (`/meetings/:id/print`), `:191` (`/quotes/:id/print`), `:201` (`/app/projects/:id/team-reports/:teamCode/print`), `:207` (`/app/projects/:id/asr/:reportId/print`) | Бүгд module scope дээр `bridgePrintToken()` дуудаж, `<img>`-ээр `/media`-аас зураг ачаалдаг. Browser Rendering-ийн headless Chromium нь cookie/токенгүй ачаалдаг тул нээлттэй `/media` шаардлагатай |
| **Клиент портал** | `routes/projectChat.ts` + клиентийн тайлангийн зам | Клиентийн харах хавсралт, лого бүгд `/media`-ээр гардаг |
| **`Cross-Origin-Resource-Policy: cross-origin`** | `backend/src/routes/media.ts:50`, `:65`; тайлбар `:47-49` | COEP `credentialless` асаалттай хуудсууд (APS viewer) энэ толгойгүйгээр зургийг ачаалж ЧАДАХГҮЙ. `frontend/vite.config.ts` ба `frontend/public/_headers` дахь COOP/COEP-тэй толин тусгал |
| **`Content-Length`-ийг ГАРААР тавьдаг** | `backend/src/routes/media.ts:45`, `:63`; тайлбар `:40-44` | QTO нь оверсайз `.ifc` загварыг ТАТАХААС ӨМНӨ таслахдаа үүнээс хамаардаг (>500 MB загвар браузерын takeoff-ыг OOM-оор унагадаг) |
| **`isMediaUrl`-ийн нэг сегментийн таарал** | `backend/src/routes/authorSupervision.ts:115-117, 154, 164`; `backend/src/routes/suggestions.ts:83-85, 127` | ЗХ-ын тайлангийн зураг/гарын үсэг, санал хүсэлтийн зураг бүгд үүгээр орно. Regex-ийг СУЛРУУЛБАЛ (жишээ нь `[^/]+` → `.+`) дамжлага бичих талаас нээгдэнэ. **Зөвхөн ЧАНГАРУУЛНА** |
| **`suggestions.ts`-ийн `<userSub>-` угтварын шалгалт** | `backend/src/routes/suggestions.ts:106-111, 130-133` | Тэр функц R2 `delete` дууддаг (`suggestions.ts:166`). Угтварын шалгалт алдагдвал дурын ажилтан өөр хүний файлыг УСТГАНА |
| **`LEGACY_MEDIA_ORIGIN` self-heal** | `backend/src/routes/media.ts:69-108`; `backend/wrangler.toml:118` | 59 объект хуучин акаунтад үлдсэн. Энэ замыг унтраавал `/app/asr/28` төрлийн зураг, гарын үсэггүй PDF дахин эвдэрнэ |
| **`generate_report`-ийн буцаадаг URL нь 404** | `backend/src/mcp/tools/generateReport.ts:114` | Энэ бол одоо байгаа, урьд баримтжуулсан алдаа (`/media/client-reports/…` нь бодит `/`-той тул route таарахгүй). §3.2-ын хаалт үүнийг ӨӨРЧЛӨХГҮЙ — 404 хэвээр. Энэ даалгаварт ЗАСАХГҮЙ |
| **`purpose:'mcp'` токен `/api/*` дээр ажиллах** | `backend/src/middleware/auth.ts:55` (`verifyToken`), `backend/src/index.ts:292` (`resolveExternalToken`) | Add-in бүх REST дуудлагаа тэр токеноор хийдэг, refresh БАЙХГҮЙ. **ХӨНДӨХГҮЙ** |
| **`email.ts`-ийн `flatName`** | `backend/src/routes/email.ts:917` | Энэ нь ХАВТАСГҮЙ болгодог тул засварын дараа ч ажиллана. «Оновчлох» нэрээр хавтастай болгож БҮҮ өөрчил |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

**Урьдчилсан нөхцөл:** байхгүй. Энэ бол 1A-ийн эхний зүйл (`docs/bim-ai/README.md`-ийн диаграм).

**Энэ даалгаврын дараа:** 1A-2 (MCP boundary), 1A-3 (token lifecycle), 1A-4 (tenant preflight), 1A-5 (local agent auth, Python), 1A-6 (QTO/batch privilege) — бүгд бие даан явна. 1A бүрэн дуусаад л 1B эхэлнэ.

**Deploy дараалал (нэг deploy):**

```
1. npx tsc --noEmit      (өөрөө ажиллуул — wrangler хийхгүй)
2. npm test              (шинэ mediaUrl.test.ts багтана)
3. git commit            (зөвхөн өөрийн файлууд, нэрээр нь нэмсэн)
4. npx wrangler deploy --config wrangler.toml
5. Продакшн дээр §7-гийн curl шалгалтыг ДАХИН ажиллуул
```

**Programme-wide дүрмүүдээс энэ сессид хамаарах нь:**

| Дүрэм | Энэ даалгаварт |
|---|---|
| `verifyToken`/`authMiddleware`-ыг `purpose === 'mcp'`-ээр чангатгахгүй | **Хамаарна** — хөндөхгүй |
| Add-in-ийн C# өөрчлөлт бүгд НЭГ релизэд | Хамаарахгүй — C# хөндөхгүй |
| Revocation lookup нь `authMiddleware` ба `resolveExternalToken` ХОЁУЛАНД нь НЭГ deploy-д | Хамаарахгүй — revocation нэмэхгүй (1A-3-ынх) |
| Шинэ багана нь түүнийг уншдаг кодоос ЧАНД ӨМНӨ deploy хийгдэнэ | Хамаарахгүй — багана нэмэхгүй |

**Frontend deploy-той хамаарал БАЙХГҮЙ.** Frontend нь `/media/<нэг сегмент>` л илгээдэг (`ProjectKeyImage.tsx:35-38`, `client.ts` `uploadFile`), тиймээс хаалт нь одоогийн клиентэд ил тод.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

- [ ] `backend/src/lib/mediaUrl.ts` үүссэн, `isSingleSegmentKey` + `isSingleSegmentMediaUrl` экспортлодог, Hono-ийн зан төлөвийг тайлбарласан толгойн блоктой.
- [ ] `backend/src/lib/mediaUrl.test.ts` үүссэн ба `npm test` ногоон. Дор хаяж эдгээр кейс: `'a.png'` → true; `'email/5/x'` → false; `'email%2F5%2Fx'` → **false**; `'email%2f5%2fx'` → **false**; `'email%252F5'` → false; `''` → false; `'%zz'` → false; `'a\\b'` → false; `isSingleSegmentMediaUrl('/media/a.png')` → true; `isSingleSegmentMediaUrl('https://evil/x.png')` → false; `isSingleSegmentMediaUrl(null)` → false.
- [ ] Продакшн: `curl -s -o /dev/null -w "%{http_code}" "$H/media/revit-addin%2FRevitMcpAddin-Revit2027.zip"` → **404** (өмнө нь 200 байсан).
- [ ] `%2f` жижиг үсгийн хувилбар мөн **404**.
- [ ] `curl -s -o /dev/null -w "%{http_code}" "$H/media/default-profile-photo.png"` → **200** (энгийн нэг сегментийн уншилт эвдрээгүй).
- [ ] Эзэмшигчийн акаунтаар `GET /api/revit-addin/download/2027` → **200** (gated зам ажилласаар).
- [ ] `POST /api/progress` дээр `image_url: "/media/email%2F5%2Fx%2Fbody.html"` → **400**; `image_url: "/media/2-1756000000-a.png"` → амжилттай.
- [ ] `POST /api/progress` дээр `attachments: [{ "url": "/media/a%2Fb.png" }]` → **400**; хэвийн хавсралт → амжилттай.
- [ ] `PUT /api/projects/:id` дээр `key_image_url: "/media/a%2Fb.png"` → **400**; `key_image_url: null` → амжилттай (зураг устгах); `key_image_url` ОГТ илгээхгүй бол өмнөх утга хэвээр.
- [ ] Revit нотолгооны зам: `evidence: [{ "url": "/media/a%2Fb.png" }]` → **400**.
- [ ] ЗХ (ASR): `photos: [{ "url": "/media/a%2Fb.png" }]` → **400**; санал хүсэлт мөн адил.
- [ ] `backend/` `npx tsc --noEmit` — алдаа зөвхөн энэ даалгавартай ХАМААРАЛГҮЙ файлд (өөр агентын WIP). Өөрийн файлуудад алдаа байвал ХҮЛЭЭН АВАХГҮЙ.
- [ ] `git status --short` дээр ЗӨВХӨН энэ даалгаврын файлууд өөрчлөгдсөн; өмнө байсан untracked файлууд (жишээ нь `live2.js`) хөндөгдөөгүй.
- [ ] §3.2.4-ийн гурван худал тайлбар засагдсан (`media.ts`, `authorSupervision.ts`, `suggestions.ts`).
- [ ] Гараар: `/app/asr/<id>` дээр ЗХ-ын зураг, гарын үсэг ХЭВЭЭР харагдана; `/app/projects/:id` дээр key image харагдана; аватарууд харагдана.
- [ ] Гараар: зургаан хэвлэлийн route-ын дор хаяж хоёрыг (`/quotes/:id/print`, `/reports/project/:id/performance-report/:reportId/print`) нээж, зураг/тамга байгааг харах.

---

## 7. ШАЛГАХ КОМАНД

**Дамжлагыг дахин үйлдэх (засахаас ӨМНӨ, `backend/`-ээс):**

```bash
node --input-type=module -e 'import {Hono} from "hono"; const a=new Hono(); a.get("/media/:key",c=>c.text(c.req.param("key"))); const r=await a.request("http://x/media/email%2F5%2Fx%2Fbody.html"); console.log("STATUS", r.status, "PARAM=", await r.text());'
# Хүлээгдэх: STATUS 200 PARAM= email/5/x/body.html
```

Regex-ийн нэвтрэлт:

```bash
node -e 'const re=/^\/media\/[^\/]+$/; console.log("encoded:", re.test("/media/email%2F5%2Fx%2Fbody.html")); console.log("plain:", re.test("/media/email/5/x/body.html"));'
# Хүлээгдэх: encoded: true   plain: false
```

Hono хувилбар:

```bash
node -e 'console.log(require("fs").readFileSync("node_modules/hono/package.json","utf8").slice(0,60));'
```

**Продакшн (read-only, засахаас ӨМНӨ ба ДАРАА):**

```bash
H=https://mgl-progress-api.mglenc-design.workers.dev
curl -s -o /dev/null -w "addin    %{http_code}\n" "$H/media/revit-addin%2FRevitMcpAddin-Revit2027.zip"
curl -s -o /dev/null -w "addin-lc %{http_code}\n" "$H/media/revit-addin%2fRevitMcpAddin-Revit2027.zip"
curl -s -o /dev/null -w "flat     %{http_code}\n" "$H/media/default-profile-photo.png"
curl -s -o /dev/null -w "missing  %{http_code}\n" "$H/media/definitely-not-here-xyz.png"
# ӨМНӨ:  addin 200 / addin-lc 200 / flat 200 / missing 404
# ДАРАА: addin 404 / addin-lc 404 / flat 200 / missing 404
```

**Локал (`backend/`):**

```bash
npx tsc --noEmit                 # wrangler deploy typecheck ХИЙХГҮЙ — өөрөө ажиллуул
npm test                         # node --test "src/**/*.test.ts"
npm run dev                      # wrangler dev :3000, локал D1 + R2
```

`npm run dev` ажиллаж байхад:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/media/a%2Fb.png"   # 404 байх ёстой
```

**Deploy:**

```bash
cd backend
npx wrangler deploy --config wrangler.toml     # --config ЗААВАЛ (язгуурын wrangler.jsonc урхи)
npx wrangler tail                              # хаалт хууль ёсны түлхүүрийг таслаж байгаа эсэхийг хянах
```

**Хамрах хүрээний хяналт (commit-ээс ӨМНӨ):**

```bash
git status --short
git diff --stat
# ЗӨВХӨН: backend/src/lib/mediaUrl.ts, backend/src/lib/mediaUrl.test.ts,
#         backend/src/routes/{media,progress,revit,projects,authorSupervision,suggestions}.ts
# git add -A БҮҮ хэрэглэ — файл бүрийг нэрээр нь нэм.
```

---

## 8. ROLLBACK

**Migration ШААРДЛАГАГҮЙ** — энэ өөрчлөлт схемд хүрэхгүй тул шинэ migration дугаар авах шаардлага БАЙХГҮЙ.

| Юу буцаах | Хэрхэн |
|---|---|
| Бүхэл өөрчлөлт | `git revert <commit>` → `cd backend && npx wrangler deploy --config wrangler.toml`. Нэг deploy-д бүрэн буцна |
| Зөвхөн уншилтын хаалт (бичилтийг үлдээх) | `routes/media.ts`-ийн `if (!isSingleSegmentKey(key)) return c.notFound();` мөрийг устгаад дахин deploy. **Гэхдээ энэ нь амьд эмзэг байдлыг дахин нээнэ — зөвхөн хууль ёсны ажил эвдэрсэн нь БАТЛАГДВАЛ** |
| Зөвхөн нэг бичих цэг | Тухайн файлын `isSingleSegmentMediaUrl` шалгалтыг буцаах. **D1-д ямар ч өөрчлөлт хийгдээгүй** тул өгөгдөл алдагдахгүй |

**Өгөгдлийн эрсдэл: ТЭГ.** Энэ өөрчлөлт нэг ч мөр D1-д бичихгүй, нэг ч R2 объект устгахгүй/зөөхгүй.

**Кэш:** §2.1-д хэмжсэнээр `%2F` хариу дээр `CF-Cache-Status` толгой БАЙХГҮЙ (ирмэгийн кэшд ороогүй), тиймээс Cloudflare purge ШААРДЛАГАГҮЙ. Гэхдээ `Cache-Control: public, max-age=31536000` (`media.ts:64`) тул **урьд нь татсан браузер** объектоо локал кэшээсээ 1 жил хүртэл харуулсаар байж болно — үүнийг сервер талаас цуцлах боломжгүй.

**Rollback-ийн шалгуур:** deploy-ийн дараа 24 цагийн дотор дараах аль нэг илэрвэл — ЗХ-ын тайлангийн зураг эвдрэх, аватар алга болох, хэвлэлийн PDF-д тамга/гарын үсэг байхгүй болох, `/api/progress` дээр 400 огцом өсөх — **эхлээд `npx wrangler tail`-аар ЯГ ямар түлхүүр 404 болсныг тодруул**, дараа нь тэр түлхүүр үнэхээр хавтастай эсэхийг шалга. Хавтастай ХУУЛЬ ЁСНЫ түлхүүр олдвол энэ нь §9 №2-ын «одоо байгаа хавтастай утга» асуудал бөгөөд rollback биш — тэр утгыг **хавтасгүй болгож хуулах** (`email.ts:917`-ийн `flatName` загвар) шийдэл шаардана.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Эдгээрийг репогоос ХАРИУЛАХ БОЛОМЖГҮЙ — эзэн эсвэл продакшны асуулга шаардана.

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 1 | **`mgl-progress-media` bucket-д хэдэн объект ХАВТАСТАЙ, хэдэн нь ХАВТАСГҮЙ түлхүүртэй вэ?** | Хаалт нь ЗӨВХӨН уншилтыг таслана. Хавтастай объект хэр олон бол, тэдгээрийг хууль ёсоор уншдаг зам байгаа эсэхийг мэдэх ёстой | R2 жагсаалт шаардлагатай. `backend/scripts/r2.mjs` нь ЗӨВХӨН `put` дэмждэг (`r2.mjs:19-23`: `if (action !== 'put' …) process.exit(1)`) — тиймээс Cloudflare dashboard эсвэл S3-нийцтэй API-аар угтвараар (`email/`, `client-reports/`, `revit-addin/`, `anon-`, угтваргүй) тоол. Bucket нэр: `backend/wrangler.toml:121-122` → `mgl-progress-media` |
| 2 | **D1-д `%2F` эсвэл бодит `/` агуулсан `/media/…` утга АЛЬ ХЭДИЙН хадгалагдсан уу?** | Тийм бол §3.3-ын бичих хаалт нь тэр мөрийг ДАХИН хадгалахыг таслана (уншилт нь аль хэдийн таслагдсан байна). Мигрэйшнгүй, гар засвар шаардаж болно | Продакшн D1: `SELECT id, image_url FROM progress_entries WHERE image_url LIKE '/media/%' AND (instr(image_url,'%2F')>0 OR instr(image_url,'%2f')>0 OR instr(substr(image_url,8),'/')>0);` + ижлийг `progress_entries.attachments`, `projects.key_image_url`, `app_settings` (`client_logo_url:%`, `report_stamp_url`, `report_logo_url`), `users.profile_image/cover_image/signature_url/stamp_url`, ЗХ-ын тайлангийн зураг/гарын үсэг, `suggestions` зургийн JSON дээр. ⚠️ Хол D1 нь том TEXT багана дээр `LIKE '%…%'`-ыг татгалздаг — `instr()` хэрэглэ |
| 3 | **`/media`-ийн ямар нэг түлхүүр УРЬД НЬ жагсаагдсан (enumerate) уу? `%2F` URL-аар хандсан лог бий юу?** | Энэ нь «эмзэг байдал байсан» ба «мэдээлэл алдагдсан» хоёрын ялгаа. Хариулт нь эзэнд/ажилтнуудад мэдэгдэх эсэхийг тодорхойлно | Logpush/Analytics хадгалагдсан бол `/media/` + `%2F` хэв шинжээр хайх. Хадгалаагүй бол «мэдэх боломжгүй» гэдгийг илэн далангүй хэл — таамаглал бүү дэвшүүл |
| 4 | **`LEGACY_MEDIA_ORIGIN` продакшнд хэвээр байх ёстой юу?** | Одоо `wrangler.toml:118`-д тавигдсан ба АМЬД. Дамжлагыг хуучин акаунт руу ч дамжуулдаг (§2.3). 59 объектын нөхөлт дууссан бол авах цаг болсон | `media.ts:102`-ийн `[media] backfilled from legacy` лог сүүлд хэзээ гарснаа `npx wrangler tail`-аар харах; хуучин акаунтын bucket-ын одоогийн зөрүүг дахин хэмжих |
| 5 | **§2.6-гийн НЭМЭЛТ бичих цэгүүдийг (`auth.ts:193-199`, `users.ts:636-643`, `settings.ts:143-150`, `projects.ts:1620-1626`) ЭНЭ commit-д оруулах уу?** | Тэдэнд ямар ч шалгалт байхгүй. Гэхдээ `profile_image` зэрэг талбар одоо `/media`-аас ГАДНА утга (гадаад URL, `data:`) агуулж болзошгүй тул regex тавивал одоо ажиллаж байгаа урсгал эвдэрч мэднэ | №2-ийн асуулгаар тэдгээр багануудын БОДИТ утгын хэлбэрийг эхлээд хар. Бүгд `/media/<нэг сегмент>` бол нэг commit-д оруулж болно; холимог бол ТУСДАА даалгавар |
| 6 | **`isSingleSegmentKey` нь давхар кодлолтыг (`%252F`) татгалзах ёстой юу?** | Өнөөдөр `%252F` нь 404 өгдөг (§2.1) тул зайлшгүй биш. Гэхдээ ирээдүйд ямар нэг зам нэмэлт задлалт хийвэл нүх нээгдэнэ | Эзний шийдвэр. Аль сонголтыг ч авсан **шалтгааныг кодын тайлбарт бич** |
| 7 | **`generate_report`-ийн буцаадаг эвдэрсэн URL (`generateReport.ts:114`) хэзээ засагдах вэ?** | Одоо тэр 404 өгдөг; энэ хаалт түүнийг өөрчлөхгүй. Гэхдээ хэн нэгэн «дамжлага засагдсанаас болж эвдэрлээ» гэж буруу дүгнэж болзошгүй | Энэ бол урьд нь баримтжуулсан алдаа. 1A-1-д ЗАСАХГҮЙ гэдгийг эзэнтэй тохир |

---

### Хавсралт — брифийг бэлтгэхэд ашигласан баримтын эх сурвалж

| Баталгаажуулсан зүйл | Эх сурвалж |
|---|---|
| Hono 4.12.14 | `backend/node_modules/hono/package.json` |
| `%2F` дамжлага (тодорхойлолт + продакшн) | Локал Hono repro + продакшн `curl` (2026-08-27 04:13–04:15 UTC) |
| Migration тоо 190, хамгийн өндөр `0200_assistant_feedback_note.sql` | `ls backend/migrations` |
| Bucket нэрс | `backend/wrangler.toml:121-122` (`mgl-progress-media`), `:129-130` (`mgl-meeting-audio`) |
| Продакшн API host | `frontend/src/shared/api/apiHost.ts:12` (`DEFAULT_API_HOST`) |
| Воркерийн нэр | `backend/wrangler.toml:1` → `name = "mgl-progress-api"` |
