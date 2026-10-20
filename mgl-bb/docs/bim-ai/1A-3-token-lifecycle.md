# 1A-3-token-lifecycle — Токены амьдралын мөчлөг — tokens_valid_from, дундын цуцлалт, purpose

> **Track:** 1A ПРОДАКШНЫ АЮУЛГҮЙ БАЙДАЛ (AI-г бүрэн унтраасан ч прод аюулгүй байх ёстой) · **Хамаарал:** байхгүй — дангаараа эхэлж болно · **Блоклож буй:** ирээдүйд `purpose`-д тулгуурласан ЛЮБОЙ шалгалт (энэ ажил `print` claim-ийг нэмэхгүй бол тийм шалгалт хийх боломжгүй); 1A-2 (worker→MCP давалт) энэ ажлыг ХҮЛЭЭХГҮЙ, зэрэг явж болно · **Хөндөх файлууд:** `backend/migrations/02NN_user_tokens_valid_from.sql` (шинэ), `backend/src/lib/tokenValidity.ts` (шинэ), `backend/src/middleware/auth.ts`, `backend/src/index.ts`, `backend/src/routes/auth.ts`, `backend/src/types.ts`, `backend/src/routes/{projects,quotes,meetings,performanceReports,authorSupervision}.ts` (print token mint-үүд), `backend/src/routes/users.ts` (сонголтоор) · **Deploy тоо: ХОЁР — ЗААВАЛ тусад нь. Нэгтгэвэл эхний хүсэлт «no such column: tokens_valid_from» өгч, бүх ажилтан бүх `/api/*`-аас гарна.**

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ:** ЗӨВХӨН backend. C# add-in-д НЭГ Ч мөр хүрэхгүй. Frontend-д нэг ч мөр хүрэхгүй (`printAuth.ts`-ийг УНШИНА, ЗАСАХГҮЙ).

**Бусад агент зэрэг ажиллаж байна.** Энэ репод хэд хэдэн хөгжүүлэгч зэрэг ажилладаг тул working tree дотор өөр хүний дуусаагүй, магадгүй КОМПИЛЯЦИ ХИЙГДЭХГҮЙ өөрчлөлт байж болно.

- Өөрийн ажилд хамаарахгүй файлыг «засах», форматлах, буцаах — ХОРИОТОЙ.
- `git restore`, `git checkout --`, `git stash`, өөрийн бус файлыг `git add` — ХОРИОТОЙ.
- `tsc --noEmit` бүтэн репог хардаг тул унасан build АВТОМАТААР чинийх БИШ. Алдаанууд зөвхөн өөрийн хөндөөгүй файлд байгаа эсэхийг шалга, дараа нь тэр саадыг эзэнд нь мэдэгд — өөрөө бүү нухчих.
- Миграцийн дугаар мөргөлдөнө. `ls backend/migrations | tail -3`-ийг ЭХЛЭХИЙН ЯГ ӨМНӨ ажиллуулж, чөлөөтэй дараагийн дугаарыг ав (энэ бичиг бичигдэх үед хамгийн өндөр нь `0200_assistant_feedback_note.sql`, нийт 190 файл).

**Deploy хийж болох уу:** БОЛНО, гэхдээ ХОЁР тусдаа алхмаар (§5), эзэн `db:export` нөөц авахыг зөвшөөрсний дараа.

### ⛔ ЭНЭ СЕССИЙН ҮНЭМЛЭХҮЙ ХОРИО

**`/api/*` дээр `purpose === 'mcp'` токеныг ХЭЗЭЭ Ч БҮҮ ТАТГАЛЗ.** Revit add-in нь өөрийн REST дуудлага БҮРИЙГ яг тэр токеноор баталгаажуулдаг (§2.7), refresh flow БАЙХГҮЙ, авто-шинэчлэлт БАЙХГҮЙ. Энэ бол алсаас нөхөх боломжгүй ГАНЦ өөрчлөлт: ~20 ажилтны PC дээр Revit-ийг хааж, `Install.bat`-ыг гараар дахин ажиллуулах шаардлагатай болно. `verifyToken`-д ч, `authMiddleware`-д ч, шинэ helper-т ч ийм шалгалт БҮҮ нэм.

Мөн ХОРИОТОЙ: `mcp-token`-ын 365 хоногийн хугацааг богиносгох (§4), `users` хүснэгтийг rebuild хийх, `JWT_SECRET` сэлгэх.

---

## 1. КОНТЕКСТ

**Систем.** Монголын архитектур-инженерийн компанийн (MGL) дотоод хэрэгсэл. `backend/` нь Cloudflare Worker: Hono-г `@cloudflare/workers-oauth-provider`-оор ороосон (default export нь провайдер, Hono нь түүний `defaultHandler`). Хадгалалт: D1 (SQLite, прод `mgl-progress-db-v3`, 114 хүснэгт, ~45 MB, хамгийн том нь `progress_entries` 8,062 мөр), R2 (`MEDIA_BUCKET` нийтийн / `MEETING_BUCKET` хувийн), KV (`OAUTH_KV`), нэг Durable Object (`MglMcpAgent`). `frontend/` нь Vite + React 19 SPA, Cloudflare Pages дээр (проект `mgl-design-system`). `revit-mcp/addin/` нь Revit 2024–2027-ийн C#/WPF add-in — ~16k мөр, 47 файл, ТЕСТГҮЙ, ажилтны PC дээр авто-шинэчлэлтийн МЕХАНИЗМГҮЙ. `revit-mcp/server/` ба `revit-mcp/agent/` нь Python MCP гүүр ба локал агент. ~49 идэвхтэй ажилтан.

**Role-ууд (яг зургаа):** `admin | engineer | architect | senior | client | worker`. `role` нь JWT-ээс уншигддаг, DB-ээс БИШ — DB дэх role-ыг өөрчилсөн ч тухайн хүн дахин нэвтрэх хүртэл (24 цаг хүртэл) хуучин эрхээрээ ажиллана.

**Яагаад энэ ажил байгаа вэ.** Өнөөдөр системд **токеныг цуцлах ямар ч арга байхгүй**. Ганц хөшүүрэг нь `JWT_SECRET` сэлгэх — тэр нь БҮХ session, БҮХ суулгасан Revit add-in, БҮХ дундах хэвлэлтийн ажлыг НЭГ ЗЭРЭГ устгана (нэг нууц 5 төрлийн токенд гарын үсэг зурдаг). Практик үр дагавар:

| Тохиолдол | Өнөөдрийн бодит зан төлөв |
|---|---|
| Ажилтан ажлаас гарлаа, админ `status='inactive'` болголоо | Түүний session токен `exp` хүртэл (24 ц) ХҮЧИНТЭЙ хэвээр. Түүний `mcp` токен **бас 365 хоног хүчинтэй хэвээр** — ноутбукаа авч явбал жилийн турш `/api/revit/*`, `/api/qto/*`, `/api/projects`, `/api/upload` руу хандана. |
| Токен алдагдлаа (settings.json хуулагдсан, чат руу наасан) | Цуцлах ямар ч арга байхгүй. |
| `users` мөрийг БҮРЭН устгасан (`DELETE /api/users/:id`) | Токен нь `exp` хүртэл хүчинтэй — `verifyToken` DB-д ОГТ ханддаггүй. |

Энэ ажил нь **байхгүй цуцлалтыг нэмнэ** — токены НАСЫГ өөрчлөхгүйгээр. Мөн `purpose` claim-ийн одоогийн ЗӨРҮҮГ (print токенд claim огт байхгүй) хааж, ирээдүйд purpose-д тулгуурласан шалгалт хийх боломжийг НЭЭНЭ.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх мөр бүрийг 2026-08-27-нд `feat/perf-report-company-stamp` салаа дээр биечлэн нээж баталгаажуулав. Спекийн зарим тоо буруу байсныг §2.4 ба §2.7-д тэмдэглэв.

### 2.1 `verifyToken` ЮУ ШАЛГАДАГ — ба юу шалгадаггүй

`backend/src/lib/jwt.ts:71-97`:

```ts
export async function verifyToken(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    ...
    const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(signingInput));
    if (!valid) return null;
    ...
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
```

| Шалгадаг | Шалгадаггүй |
|---|---|
| ✅ HMAC-SHA256 гарын үсэг (`jwt.ts:82`) | ❌ `alg` — header-ийг PARSE Ч ХИЙХГҮЙ. `jwt.ts:75` дээр `headerB64` зөвхөн signing input-д ордог; алгоритм нь `createKey` (`jwt.ts:6-14`) дотор HS256-оор ХАТУУ КОДЛОГДСОН. Иймд `alg:none` довтолгоо БОЛОМЖГҮЙ, гэхдээ энэ нь баталгаажуулалт биш — хатуу кодлолт. |
| ✅ `exp` (`jwt.ts:88`) | ❌ `purpose` — огт хардаггүй |
| | ❌ `iat` / «энэ огнооноос хойш» — огт хардаггүй |
| | ❌ Цуцлалтын жагсаалт — **DB-д ОГТ ХАНДАХГҮЙ** |
| | ❌ `nbf`, `aud`, `iss` — байхгүй |

`signToken` (`jwt.ts:35-68`) нь `iat`-ыг ҮРГЭЛЖ бичдэг (`jwt.ts:57`: `iat: now`) — энэ нь `tokens_valid_from`-той харьцуулах ГОЛ талбар. `JWTPayload`-ын тодорхойлолт: `backend/src/types.ts:182-190` (`sub`, `role`, `iat`, `exp`, сонголтоор `purpose`, `audio_key`, `tid`).

### 2.2 `verifyToken`-ыг дуудагч ЯГ ДӨРВӨН газар

| # | Файл:мөр | Хамрах хүрээ |
|---|---|---|
| 1 | `backend/src/middleware/auth.ts:55` | **ЗӨВХӨН `/api/*`** (`index.ts:144`: `app.use('/api/*', authMiddleware)`) |
| 2 | `backend/src/index.ts:293` (`resolveExternalToken`) | `/mcp` ба `/sse` — OAuth провайдерын legacy bearer гарц |
| 3 | `backend/src/routes/meetingAudio.ts:22` | `/meeting-audio/:key` (root mount, `index.ts:253`) — `purpose==='stt-audio'` + `audio_key`-г шалгадаг (`meetingAudio.ts:23`) |
| 4 | `backend/src/routes/email.ts:129` | Gmail OAuth `state` — `purpose!=='email_oauth'` бол `email.ts:134` дээр татгалзана |

**Иймд `authMiddleware`-д ГАНЦААРАНГ нь шалгалт нэмбэл `/mcp` ба `/sse` нь цуцлагдсан токеныг ХҮЛЭЭН АВСААР байна** — тэгээд «идэвхгүй болгосон хүн тэр даруй хаагдана» гэсэн мэдэгдэл ХУДАЛ болно. Энэ бол §3.2-ийн дундын helper-ийн бүх утга учир.

Токен огт шаарддаггүй бусад root mount-ууд (эдгээрт JWT цуцлалт ХАМААРАХГҮЙ, гэхдээ «/api-д нэмэхэд бүгд хамрагдана» гэж бодохоос сэргийлж бичив):

- `/media/:key` — `index.ts:193`, түлхүүрээрээ дэлхийд нээлттэй, auth ОГТ БАЙХГҮЙ.
- `/speechmatics` — `index.ts:248`, `x-mgl-speechmatics-secret` дундын толгойгоор өөрийгөө хамгаална (`routes/speechmatics.ts:28-32`). Дуудагч нь Speechmatics, хэрэглэгч биш.

### 2.3 `purpose`-ийн бүрэн зураг — **ЯГ ГУРВАН** утга бий

`grep -rn "purpose" backend/src --include=*.ts` (тайлбар болон `meetings` хүснэгтийн `purpose` баганыг хаслаа):

| Утга | Хаана гарын үсэг зурдаг | Хаана шалгагддаг |
|---|---|---|
| `'stt-audio'` | `backend/src/lib/speechmatics.ts:54` | `routes/meetingAudio.ts:23` ✅ |
| `'mcp'` | `backend/src/routes/auth.ts:75` | **ХААНА Ч ҮГҮЙ** — `resolveExternalToken` (`index.ts:292-296`) `purpose`-ийг ОГТ хардаггүй, тул энгийн 24 цагийн session токен ч, 60 секундын print токен ч `/mcp`-д адилхан нэвтэрнэ |
| `'email_oauth'` | `backend/src/routes/email.ts:325` | `routes/email.ts:134` ✅ |

Спекийн «гурван утга» гэсэн нь ЗӨВ.

### 2.4 ⚠️ ПРИНТ ТОКЕН — **ЗУРГААН БИШ, ДОЛОО**, БҮГД `purpose`-ГҮЙ

Спекэд «зургаан print token» гэсэн нь **буруу — долоо байна**. `grep -n "signToken" backend/src -r` нийт **11** дуудлага өгнө (`jwt.ts:45` дээрх тайлбар өөрөө «`signToken` нь 11 газраас дуудагддаг» гэж бичсэн, тэр нь зөв): login 1 + mcp-token 1 + stt-audio 1 + email_oauth 1 + **print 7**.

| # | Файл:мөр | Юуны PDF | Хугацаа | Claim-ууд |
|---|---|---|---|---|
| 1 | `routes/projects.ts:2534` | Төслийн явцын тайлан | `1 / 60` цаг = 60 сек | `{ sub, role }` |
| 2 | `routes/projects.ts:2643` | Багийн тайлан (`?mode=client`) | `1 / 60` | `{ sub, role }` |
| 3 | `routes/quotes.ts:1717` | Үнийн санал | `1 / 60` | `{ sub, role }` |
| 4 | `routes/meetings.ts:765` | Хурлын тэмдэглэл | `1 / 60` | `{ sub, role }` |
| 5 | `routes/performanceReports.ts:943` | Гүйцэтгэлийн тайлан | `1 / 60` | `{ sub, role }` |
| 6 | `routes/performanceReports.ts:1114` | Гүйцэтгэлийн тайлан, 2 дахь гарц (нэг мөрөнд бичигдсэн) | `1 / 60` | `{ sub, role }` |
| 7 | `routes/authorSupervision.ts:1366` | Зохиогчийн хяналт (ASR) | `1 / 60` | `{ sub, role }` |

Бүгд яг ийм хэлбэртэй (`projects.ts:2534`):

```ts
const printToken = await signToken(
  { sub: user.sub, role: user.role },
  c.env.JWT_SECRET,
  1 / 60, // hours -> 1 minute
);
```

**Үүний шууд үр дагавар:** print токен нь `{sub, role, iat, exp}` — 24 цагийн session токентой **байт байтаараа ялгагдахааргүй** (зөвхөн `exp − iat` өөр). Иймд:

- «print purpose-ийг татгалз» гэж томьёолсон ямар ч засвар ӨНӨӨДӨР БИЕЛЭХГҮЙ;
- «purpose байхгүй ⇒ session токен» гэсэн ямар ч таамаг ХУДАЛ.

Энэ бол §3.4-ийн ажлын бүх үндэслэл.

### 2.5 `POST /api/auth/mcp-token` — role gate БАЙХГҮЙ, 365 хоног

`backend/src/routes/auth.ts:71-80`:

```ts
auth.post('/mcp-token', async (c) => {
  const user = c.get('user');
  const expiresInDays = 365;
  const token = await signToken(
    { sub: user.sub, role: user.role, purpose: 'mcp' },
    c.env.JWT_SECRET,
    expiresInDays * 24,
  );
  return c.json({ token, purpose: 'mcp', expires_in_days: expiresInDays });
});
```

- `requireRole` / `requireAdmin` **байхгүй** — нэвтэрсэн ЛЮБОЙ хүн (`client`, `worker` ч бас) 365 хоногийн токен цохиж авна.
- `routes/auth.ts:60-70` дээрх тайлбар өөрөө хүлээн зөвшөөрсөн: *«Revoke by rotating JWT_SECRET (invalidates all tokens) until a per-token denylist exists»* — энэ ажил яг тэр «denylist»-ыг барьж байна.
- `lib/workerScope.ts:20` дээрх `WORKER_ALLOWED_PREFIXES`-д `'/api/auth'` байгаа тул `worker` role энэ гарц руу ХҮРНЭ.

### 2.6 Add-in токеныг хэрхэн хадгалдаг — DPAPI ба кодын өөрийнх нь хүлээн зөвшөөрөл

`revit-mcp/addin/SettingsStore.cs`. Байршил: `%APPDATA%\RevitMcpAddin\settings.json` (`SettingsStore.cs:18-23`). Токен нь `token_enc` талбарт DPAPI **`CurrentUser`** scope-оор, entropy-гүй, base64 хэлбэрээр (`SettingsStore.cs:100-101` шифрлэх, `SettingsStore.cs:117-118` тайлах). `Save`-ийн дээрх тайлбар (`SettingsStore.cs:56-68`) — код өөрөө юуг хамгаалдаг, юуг ХАМГААЛДАГГҮЙГЭЭ ил хэлсэн:

```
/// ⚠️ ТОКЕНЫГ ИЛ БИЧИХГҮЙ.  Урьд нь ~1 ЖИЛИЙН хугацаатай API токен
/// settings.json-д ил бичигдэж байсан — тэр файлыг уншсан ямар ч зүйл
/// MGL-ийн API-г бүрэн эзэмшинэ.  Одоо DPAPI-аар (CurrentUser) шифрлэж
/// token_enc-д бичнэ: тухайн Windows хэрэглэгч + тухайн машинд л
/// тайлагдана, файлыг хуулбарлаад өөр газар ашиглах боломжгүй.
///
/// ⚠️ Энэ нь ХҮЧТЭЙ ХИЛ БИШ: ТУХАЙН хэрэглэгчээр ажиллаж буй процесс
/// DPAPI-г мөн дуудаж чадна.  Файл хуулагдах/нөөцлөгдөх эрсдэлийг л
/// хаана.  Токеныг цуцлах ганц арга нь JWT_SECRET сэлгэх хэвээр.
```

Мөн `SettingsStore.cs:76-79`: шифрлэлт амжилтгүй бол (DPAPI боломжгүй орчин) токен **ил хэвээр** бичигдэнэ — зориудаар, add-in ажиллахаа болихоос сэргийлж. `Load` (`SettingsStore.cs:36-45`) нь тайлж чадаагүй бол токеныг ЧИМЭЭГҮЙ хоосон үлдээж, хэрэглэгчийг дахин нэвтрүүлдэг.

Өөрөөр хэлбэл: **тэр тайлбарын сүүлийн өгүүлбэр («цуцлах ганц арга нь JWT_SECRET сэлгэх») бол яг энэ ажлаар хүчингүй болох мэдэгдэл.**

### 2.7 Add-in токеныг ХААШАА илгээдэг вэ — `/mcp` руу БИШ

Спек «add-in нь ижил mcp токеныг `/api/revit/*`, `/api/qto/*` **ба `/mcp`** руу илгээдэг» гэсэн нь **буруу**: `grep -rn '/mcp' revit-mcp/addin --include=*.cs` нь `server/.venv`-ийн Python сангаас өөр НЭГ Ч тохиолдол өгөхгүй. Add-in нь зөвхөн REST-д ханддаг. `Bearer` толгой тавьдаг **9** байрлал:

| Файл:мөр | Зам(ууд) |
|---|---|
| `ApiClient.cs:111` | `POST /api/auth/mcp-token` — энд **session** токен явна (365 хоногийнх биш) |
| `ApiClient.cs:148` | `GET /api/revit/assistant/model` |
| `ApiClient.cs:183` | `GET /api/projects` |
| `ApiClient.cs:230` | `POST /api/upload?bucket=media` |
| `ApiClient.cs:253` | `POST /api/qto/schedules` |
| `ApiClient.cs:292` | `POST /api/qto/view-exports` |
| `ApiClient.cs:313` | `POST /api/qto/revit-runs` |
| `RevitApi.cs:255` (нийтлэг `Req` үүсгэгч) | `/api/revit/handshake` (:286), `/api/revit/bindings` (:300), `/api/revit/context` (:307), `/api/revit/draft` (:320), `/api/revit/submissions` (:352), `/api/tasks/checklist/:itemId` (:462) |
| `AssistantLog.cs:295` | `POST /api/revit/assistant/logs` |
| `AgentChat.cs:440` | `POST /api/revit/agent/turn` |

Токеныг олж авах гинж: `ApiClient.LoginAsync` (`ApiClient.cs:84`, `POST /api/auth/login`) → `ApiClient.MintLongTokenAsync` (`ApiClient.cs:104`, `POST /api/auth/mcp-token`) → `SettingsDialog.xaml.cs:120-121` → `SettingsStore.Save`. **Add-in дотор re-mint / refresh хийх ямар ч авто-урсгал БАЙХГҮЙ** — токен хүчингүй болмогц ажилтан Тохиргооны цонхыг өөрөө нээж, нэр/нууц үгээ дахин бичих ёстой.

Хамааралтай server-тал role gate-үүд: `routes/revit.ts:43` `REVIT_ROLES = ['engineer','architect','senior','admin']` (`revit.ts:79` дээр бүх route-д мөрддөг), `routes/qto.ts:29` `QTO_ROLES = ['admin','senior']` (`qto.ts:39`), дээр нь `qto.ts:645` `POST /revit-runs` нь `requireAdmin()`.

### 2.8 Middleware гинжний дараалал

`backend/src/index.ts`:

```
144: app.use('/api/*', authMiddleware);
147: app.use('/api/*', workerScopeGuard);
150: app.use('/api/*', entitlementGuard);
152: app.route('/api/auth', auth);
```

`authMiddleware`-ийн нэвтрэлтгүй ҮЛ ХАМААРАХ замууд (бүгд яг `path ===` тулгалт, prefix БИШ): `/api/auth/login` (`middleware/auth.ts:17`), `/api/landing/public` (:23), `/api/landing/v2/public|/index|/project-cards` (:30-34), `/api/email/oauth/callback` (:41). Дээр нь localhost-only dev bypass (`middleware/auth.ts:57-67`, `lib/devAuth.ts`) — **токен байхгүй ЭСВЭЛ хүчингүй үед** идэвхжинэ.

Multi-tenant хил: `middleware/auth.ts:79-88` нь `payload.tid`-ыг хүсэлтийн tenant-тай тулгана; `hasTenantContext()` худал (MGL-ийн одоогийн нэг-tenant суулгац) үед огт ажиллахгүй. `index.ts:353` нь tenant-аар солигдсон `scoped` env-ийг `oauthProvider.fetch`-д дамжуулдаг тул **`resolveExternalToken` нь ЗӨВ tenant-ын `env.DB`-г авна** — шинэ helper тэндээс DB уншиж болно.

### 2.9 Идэвхгүй болголт өнөөдөр юу хийдэг вэ

- `PATCH /api/users/:id/status` — `routes/users.ts:738-776`; бодит бичилт `users.ts:752`: `UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`. **Токенд ямар ч нөлөө үзүүлэхгүй.**
- `POST /api/auth/login` — `routes/auth.ts:31`: `SELECT * FROM users WHERE username = ? AND status = ?` + `.bind(username, 'active')`. Иймд идэвхгүй хүн ШИНЭ токен авч чадахгүй, харин **хуучин токен нь хүчинтэй хэвээр**.
- `DELETE /api/users/:id` — `routes/users.ts:828-842`: `user_work_schedules`-ыг гараар устгаад `DELETE FROM users`. Токен нь `exp` хүртэл ажиллаж, `sub` нь байхгүй хүн рүү заана.

### 2.10 `users` хүснэгтийн одоогийн багана + FK эрсдэл

Локал D1 хуулбар (`backend/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/9b9be10a….sqlite`, 114 хүснэгт) дээр `PRAGMA table_info(users)`:

```
id, username, password_hash, full_name, role, status, created_at, updated_at, profile_image,
cover_image, bio, description, social_links, team_id, position, employee_id,
onboarding_acknowledged_at, work_schedule, seniority, email, accent_color,
attendance_device_id, attendance_device_label, attendance_device_bound_at, is_support,
attendance_unrestricted, signature_url, push_prefs, stamp_url, tv_kiosk
```

`tokens_valid_from` **БАЙХГҮЙ** — шинэ багана.

Тэр хуулбар дээр хэмжсэн FK: `users(id)`-д `ON DELETE CASCADE`-тэй хүүхэд **25**, `projects(id)`-д **38** (спекийн 27/38-аас `projects` таарч байна; `users`-ынх энэ хуулбар дээр 25 — прод дээр өөр байж болно). Аль ч тоо байсан дүгнэлт нэг: **`users`-ыг `migrations apply`-аар ХЭЗЭЭ Ч rebuild хийхгүй** — D1 нь runtime дээр FK мөрддөггүй ч `wrangler d1 migrations apply` файл бүрийг транзакцад ороодог бөгөөд ТЭНД `ON DELETE CASCADE` АЖИЛЛАДАГ. Энэ ажилд rebuild ХЭРЭГГҮЙ: цэвэр `ALTER TABLE users ADD COLUMN` (прецедент: `0058`, `0090`, `0091`, `0092`, `0097`, `0132`, `0173`, `0191`).

### 2.11 D1 / migration-ийн платформын хязгаарууд (энэ ажилд хамаарах хэсэг)

- Миграцууд **APPEND-ONLY**. Хэрэглэгдсэн файлыг засах нь прод дээр ЧИМЭЭГҮЙ no-op. Дунд нь унасан бол нөхөх ГАНЦ хууль ёсны арга бол ШИНЭ дугаар.
- `CREATE TABLE` / `CREATE INDEX` бүр `IF NOT EXISTS`-тэй байна.
- Одоо байгаа хүснэгт дээрх `ALTER`-ыг блокийн ЭХЭНД тавь — унавал хоосон хүснэгт үүсэхээс өмнө таслагдана.
- `wrangler` нь compound statement-ийг ТОМ ҮСЭГТ мэдрэмтгий, өмнөө зайтай терминатораар салгадаг: `END;`-ийг ТОМ үсгээр, өөрийн мөрөнд бич — жижиг үсгээр ХЭЗЭЭ Ч бичихгүй.
- Репод 190 миграцийн файлын дотор `CREATE TRIGGER`, `CREATE VIEW`, `GENERATED ALWAYS`, `json_extract` НЭГ Ч БАЙХГҮЙ. Эдгээрийн аль нэгийг ашиглах бол эхлээд хаягдал remote D1 дээр батал. **Энэ ажилд тэдгээрийн аль нь ч ХЭРЭГГҮЙ.**
- Нэг statement-д дээд тал нь **100 bind**. Жишээ: `routes/qto.ts` 21 bind × 4 мөр; `routes/revit.ts:58` `BINDS_PER_BINDING_ROW = 13`. ⚠️ **Баталгаажсан drift:** `routes/revit.ts:1703` дээрх тайлбар «12 bind/мөр → floor(100/12) = 8 мөр» гэж бичсэн атал доорх `revit.ts:1706` дээр `const BINDS = 13` (ба дараагийн тайлбарын мөр өөрөө «13 × 7 = 91 ≤ 100» гэдэг). Тайлбар нь хуучирсан — **тоог тайлбараас БИШ, константаас ав**. (Энэ ажилд bind тоолол хэрэггүй, гэхдээ дүрмийг мэдэж байх ёстой.)
- Deploy нь ЛОКАЛ wrangler-ээр, CI-аар БИШ (хоёр GitHub workflow хоёулаа үхмэл). `npx wrangler deploy --config wrangler.toml` — `--config` ЗААВАЛ (репогийн үндэс дэх `wrangler.jsonc` өөр worker зарладаг тул config discovery буруу файл сонгож болно). `wrangler deploy` typecheck ХИЙХГҮЙ — `tsc --noEmit`-ыг өөрөө ажиллуул. `pages` дэд командыг `npx -y wrangler@latest`-аар ажиллуул (энэ ажилд frontend deploy ХЭРЭГГҮЙ).

---

## 3. ХИЙХ АЖИЛ

### 🟦 DEPLOY 1 — ЗӨВХӨН СХЕМ (кодын өөрчлөлт ТЭГ)

#### 3.1 Шинэ миграци: `users.tokens_valid_from`

**Эхлээд:** `ls backend/migrations | tail -3` → чөлөөтэй дараагийн дугаарыг ав (энэ бичиг бичигдэх үед `0201_*` таамаглагдаж байна, гэхдээ ах дүү сессүүд дугаар зэрэг булаадаг тул ЗААВАЛ дахин шалга).

`backend/migrations/02NN_user_tokens_valid_from.sql`:

```sql
-- 02NN_user_tokens_valid_from.sql — ТОКЕНЫ ЦУЦЛАЛТЫН ЦЭГ
--
-- Энэ огнооноос ӨМНӨ олгогдсон (JWT-ийн `iat`) токеныг бүхэлд нь хүчингүй
-- болгоно.  NULL = «хэзээ ч цуцлаагүй» → ямар ч токен цуцлагдахгүй, өөрөөр
-- хэлбэл ЭНЭ МИГРАЦИ ДАНГААРАА ЗАН ТӨЛӨВИЙГ ОГТ ӨӨРЧЛӨХГҮЙ.
--
-- ⚠️ ЭНЭ БАГАНЫГ УНШИХ КОД ОДООГООР БАЙХГҮЙ.  Багана нь өөрийг нь уншдаг
--    кодоос ХАТУУ ӨМНӨ deploy хийгдэх ёстой — эс тэгвэл шинэ Worker-ийн
--    эхний хүсэлт «no such column: tokens_valid_from» шидэж, authMiddleware
--    унаж, БҮХ ажилтан БҮХ /api/*-аас гарна.  Deploy 2-ыг үз.
--
-- ⚠️ `users`-ыг REBUILD ХИЙХГҮЙ.  `users(id)`-д ~25 ON DELETE CASCADE хүүхэд
--    байгаа бөгөөд `wrangler d1 migrations apply` доторх транзакцад cascade
--    АЖИЛЛАДАГ (D1 нь runtime дээр FK мөрддөггүй ч энэ нь тэр тохиолдол БИШ).
--    Цэвэр ADD COLUMN — прецедент: 0058, 0090, 0091, 0092, 0097, 0132, 0173, 0191.
--
-- Утгын хэлбэр: ISO-8601 UTC («2026-08-27T09:15:00Z») эсвэл NULL.  Харьцуулалт
-- нь JWT-ийн `iat` (Unix секунд) -тай хийгдэнэ; кодын тал ISO-г секунд рүү
-- хөрвүүлнэ (backend/src/lib/tokenValidity.ts).

ALTER TABLE users ADD COLUMN tokens_valid_from TEXT;
```

Нэмэлт index ХЭРЭГГҮЙ — хайлт нь үргэлж `WHERE id = ?` (PK).

**Deploy 1-д өөр ЮУ Ч БАЙХГҮЙ.** Нэг ч `.ts` файл хөндөгдөхгүй.

---

### 🟥 DEPLOY 2 — КОД (Deploy 1 прод дээр батлагдсаны ДАРАА)

#### 3.2 Дундын helper: `backend/src/lib/tokenValidity.ts` (ШИНЭ файл)

**Яагаад дундын helper вэ (энэ бол энэ ажлын гол шийдвэр):** `authMiddleware` нь **зөвхөн `/api/*`** (§2.2). Тэнд ганцаархан шалгалт нэмбэл `/mcp` ба `/sse` (`index.ts:283-285`, `resolveExternalToken` дамжлагаар) цуцлагдсан токеныг ХҮЛЭЭН АВСААР байх бөгөөд «идэвхгүй болгосон хүн тэр даруй хаагдана» гэсэн баталгаа ХУДАЛ болно. Хоёулаа **НЭГ deploy дотор** нэг helper дуудна.

```ts
import type { JWTPayload } from '../types';

/**
 * Токен ЦУЦЛАГДСАН эсэх.  `ok:false` = ХҮЧИНГҮЙ, татгалзана.
 *
 * ⚠️ ХОЁР дуудагчтай, ХОЁУЛАА НЭГ deploy дотор нэмэгдэнэ:
 *      • middleware/auth.ts            → /api/*
 *      • index.ts resolveExternalToken → /mcp, /sse
 *    Ганцхан газарт нэмэх нь «цуцаллаа» гэсэн ХУДАЛ баталгаа өгнө.
 *
 * ⚠️ `purpose`-ийг ОГТ ХАРАХГҮЙ.  Ялангуяа purpose==='mcp'-ийг ХЭЗЭЭ Ч
 *    татгалзахгүй — Revit add-in бүх REST дуудлагаа тэр токеноор хийдэг
 *    бөгөөд ~20 PC дээр гараар нөхөхөөс өөр сэргээх арга байхгүй.
 */
export type TokenCheck = { ok: true } | { ok: false; reason: 'revoked' | 'inactive' | 'no_user' };

/** Isolate-level кэш — /api/* хүсэлт бүрт D1 унших дуудлага хийхгүйн тулд.
 *  TTL нь «цуцлалт хэдэн секундын дараа хүчин төгөлдөр болох вэ»-г тодорхойлно. */
const TTL_MS = 60_000;
type Row = { tokens_valid_from: string | null; status: string | null };
const cache = new Map<number, { at: number; row: Row | null }>();

export function invalidateTokenCache(userId?: number): void {
  if (userId === undefined) cache.clear();
  else cache.delete(userId);
}

export async function checkTokenValidity(db: D1Database, payload: JWTPayload): Promise<TokenCheck> {
  const now = Date.now();
  const hit = cache.get(payload.sub);
  let row: Row | null | undefined = hit && now - hit.at < TTL_MS ? hit.row : undefined;

  if (row === undefined) {
    row =
      (await db
        .prepare('SELECT tokens_valid_from, status FROM users WHERE id = ?')
        .bind(payload.sub)
        .first<Row>()) ?? null;
    cache.set(payload.sub, { at: now, row });
  }

  if (!row) return { ok: false, reason: 'no_user' };
  if (row.status === 'inactive') return { ok: false, reason: 'inactive' };

  if (row.tokens_valid_from) {
    const cutoff = Math.floor(Date.parse(row.tokens_valid_from) / 1000);
    // Огноог задалж чадахгүй бол ЦУЦЛАХГҮЙ — гэмтсэн нэг утга бүх хүнийг гаргах ёсгүй.
    if (Number.isFinite(cutoff) && payload.iat < cutoff) return { ok: false, reason: 'revoked' };
  }
  return { ok: true };
}
```

**Кэшийн TTL нь эзний шийдвэр (§9.2).** `/api/*` хүсэлт бүрт нэмэлт D1 унших нь латентад нэмэлт өртөг; тэр өртгийг өнөөдөр ХЭН Ч ХЭМЖЭЭГҮЙ (энэ нь 1C track-ын ажил — «250 ms» бол шаардлага биш, зүгээр л хэн ч аваагүй хэмжилт). TTL=0 нь «шууд цуцлалт, гэхдээ хүсэлт бүрт D1 унших»; TTL=60_000 нь «бараг тэг өртөг, 1 минут хүртэл саатал». Эргэлзвэл 60 секундээр эхэл. `invalidateTokenCache` нь ЗӨВХӨН тухайн isolate-д ажиллана (олон isolate байдаг) — иймд ЖИНХЭНЭ баталгаа нь TTL, cache invalidation биш.

#### 3.3 Хоёр дуудагчид залгах (НЭГ deploy дотор)

**(a) `backend/src/middleware/auth.ts`** — `c.set('user', payload)` (одоогийн мөр **90**)-ийн ЯГ ӨМНӨ, tenant шалгалтын (мөр 79-88) ДАРАА:

```ts
  const validity = await checkTokenValidity(c.env.DB, payload);
  if (!validity.ok) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('user', payload);
  return next();
```

⚠️ **Байрлал чухал:** `middleware/auth.ts:57-67` дэх dev-bypass салаанаас ДООШ тавь. Dev bypass нь `payload` NULL байхад л ажилладаг тул шинэ шалгалттай давхцахгүй, харин `devAuthPayload`-ын хиймэл payload-ыг DB-тэй тулгах шаардлагагүй.

⚠️ Алдааны мессежийг **өөрчлөхгүй** — `'Invalid or expired token'` хэвээр. Frontend-ийн `apiFetch` энэ 401-ийг үзээд нэвтрэх рүү шиддэг; шинэ мөр нэмэх нь энэ ажлын хамрах хүрээнээс гадуур.

**(b) `backend/src/index.ts:292-296`** `resolveExternalToken`:

```ts
  resolveExternalToken: async ({ token, env }) => {
    const payload = await verifyToken(token, env.JWT_SECRET);
    if (!payload) return null;
    const validity = await checkTokenValidity(env.DB, payload);
    if (!validity.ok) return null;
    return { props: { sub: payload.sub, role: payload.role } satisfies McpProps };
  },
```

⚠️ **Хамрах хүрээний хил — брифт ил бич, эзэнд ил хэл:** энэ нь ЗӨВХӨН legacy bearer JWT замыг хаана. `/authorize`-аар олгогдсон **OAuth grant** нь `OAUTH_KV`-д props `{sub, role}`-оор хадгалагддаг (`backend/src/oauth/authorize.ts:152-158`), `verifyToken`-оор ОГТ дамждаггүй, `iat` ч агуулдаггүй — тул `tokens_valid_from` түүнд ХАМААРАХГҮЙ. Түүний access token 1 цагийн настай (`index.ts:287` `accessTokenTTL: 3600`), refresh нь KV-д үлдэнэ. OAuth grant-ыг цуцлах нь ТУСДАА ажил (§9.5).

#### 3.4 ДОЛООН print токенд `purpose: 'print'` claim нэмэх

Файл тус бүрт `signToken`-ы ЭХНИЙ аргументыг л өөрчилнө — хугацаа (`1 / 60`) хэвээр:

```ts
const printToken = await signToken(
  { sub: user.sub, role: user.role, purpose: 'print' },
  c.env.JWT_SECRET,
  1 / 60,
);
```

| Файл:мөр |
|---|
| `backend/src/routes/projects.ts:2534` |
| `backend/src/routes/projects.ts:2643` |
| `backend/src/routes/quotes.ts:1717` |
| `backend/src/routes/meetings.ts:765` |
| `backend/src/routes/performanceReports.ts:943` |
| `backend/src/routes/performanceReports.ts:1114` (нэг мөрөнд бичигдсэн хэлбэр) |
| `backend/src/routes/authorSupervision.ts:1366` |

**⚠️ Энэ deploy-д purpose-д тулгуурласан ямар ч ТАТГАЛЗАЛ нэмэхгүй.** Claim нь зөвхөн ТЭМДЭГЛЭГЭЭ. Шалтгаан хоёр:

1. Урьд нь олгогдсон, claim-гүй print токенууд 60 секунд амьд байгаа — татгалзал нэн даруй PDF-үүдийг эвдэнэ;
2. Илүү чухал нь — «purpose байхгүй ⇒ session» гэсэн дүрэм ирээдүйд ажиллахын тулд claim нь ЭХЛЭЭД бүх шинэ токенд суусан байх ёстой. Татгалзал нь дараагийн, ТУСДАА ажил.

`backend/src/types.ts:187-190` дээрх `purpose`-ийн тайлбарыг мөн шинэчил — одоо «Session/print tokens omit it» гэж бичсэн нь энэ өөрчлөлтийн дараа ХУДАЛ болно:

```ts
  /** Optional token-purpose scope.  Session tokens omit it; print tokens set
   *  'print' (2026-08, 1A-3); special single-use tokens set their own
   *  ('mcp', 'stt-audio', 'email_oauth').  ⚠️ purpose==='mcp' must NEVER be
   *  rejected on /api/* — the Revit add-in authenticates every REST call with it. */
  purpose?: string;
```

#### 3.5 `POST /api/auth/mcp-token`-д role gate

`backend/src/routes/auth.ts:71`:

```ts
// Токен цохих эрхийг add-in / MCP клиент ХЭРЭГЛЭДЭГ role-уудаар хязгаарлана.
// `client` ба `worker` нь Revit-ээр ажилладаггүй тул 365 хоногийн токен
// хэрэггүй.  REVIT_ROLES (routes/revit.ts:43) -тай тааруулсан.
const MCP_TOKEN_ROLES: UserRole[] = ['admin', 'senior', 'engineer', 'architect'];

auth.post('/mcp-token', requireRole(...MCP_TOKEN_ROLES), async (c) => {
```

(`requireRole` нь `middleware/auth.ts:96`-д; `UserRole` нь `types.ts`-д. `routes/auth.ts`-д хоёуланг нь import хий.)

**⚠️ Энэ нь 1A-2-ын worker→MCP давалтыг ХААХГҮЙ — тэгж БҮҮ тайлбарла, тайланд ч БҮҮ бич.** Тэр цоорхойн мөн чанар нь: `workerScopeGuard` (`index.ts:147`) ЗӨВХӨН `/api/*` дээр суудаг атал `/mcp` нь OAuth провайдерын эзэмшдэг root зам; `backend/src/mcp/` дотор `worker` role-ийн тухай нэг ч мөр байхгүй (`MglMcpAgent.ts:95` нь `role !== 'client'`, `:104` нь admin/senior, `:121` нь admin — `worker` хаана ч шүүгдэхгүй). Role gate нь `worker`-ыг **ШИНЭ** 365 хоногийн токен цохихоос л зогсооно; аль хэдийн олгогдсон токен, мөн `/authorize` OAuth зам хэвээрээ. Жинхэнэ засвар нь 1A-2-т — `/mcp` дээрх role шат.

#### 3.6 (СОНГОЛТООР, эзний зөвшөөрлөөр) `tokens_valid_from`-ыг бичих гарц

Багана нь бичигчгүй бол цуцлалт зөвхөн ГАР `wrangler d1 execute`-ээр хийгдэнэ. Хамгийн жижиг, аюулгүй бичигч бол `routes/users.ts:752`-ын оронд:

```ts
  await c.env.DB.prepare(
    "UPDATE users SET status = ?, updated_at = datetime('now')" +
      (status === 'inactive' ? ", tokens_valid_from = strftime('%Y-%m-%dT%H:%M:%SZ','now')" : '') +
      ' WHERE id = ?',
  ).bind(status, id).run();
  invalidateTokenCache(id);
```

Мөн `routes/users.ts:828` `DELETE /api/users/:id`-д `invalidateTokenCache(id)`.

**Энэ хэсгийг эзэн «идэвхгүй болголт нь токеныг ШУУД унтраах ёстой» гэж баталгаажуулах хүртэл ХИЙХГҮЙ БАЙЖ БОЛНО** — helper дотор `status === 'inactive'` шалгалт аль хэдийн байгаа тул үндсэн үр дүн үүнгүйгээр ч гарна. `tokens_valid_from` нь «нууц үг солигдсон / токен алдагдсан» кейст хэрэгтэй, тэдгээр нь тусдаа бодлогын шийдвэр (§9.3, §9.4).

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Зүйл | Яагаад хөндөж болохгүй |
|---|---|
| **`purpose === 'mcp'`-ийг `/api/*` дээр татгалзах** | Revit add-in-ийн 9 дуудлагын байрлал (§2.7) бүгд тэр токеноор явдаг: `/api/revit/*` (handshake, bindings, context, draft, submissions, agent/turn, assistant/model, assistant/logs), `/api/qto/*` (schedules, view-exports, revit-runs), `/api/projects`, `/api/upload`, `/api/tasks/checklist/:id`. Add-in дотор refresh flow БАЙХГҮЙ, авто-шинэчлэлт БАЙХГҮЙ. Сэргээх ганц зам нь ~20 PC дээр Revit хааж, `Install.bat` ажиллуулах. **Алсаас нөхөх боломжгүй ГАНЦ өөрчлөлт.** |
| **`mcp-token`-ын 365 хоногийн хугацаа** (`routes/auth.ts:73`) | Богиносгох нь талбар дээрх бүх суулгацыг мохоох (brick) болно: add-in-д дотоод re-issue байхгүй (`ApiClient.cs`-д зөвхөн `LoginAsync`+`MintLongTokenAsync`, тэдгээрийг Тохиргооны цонх л дууддаг), ажилтан бүр гараар дахин нэвтрэх ёстой болно. **Аюулгүй зам нь тэр биш:** `tokens_valid_from` (+ хэрэв нэг ганц токеныг онилох хэрэгтэй бол `jti` denylist) нь НАСЫГ өөрчлөхгүйгээр цуцлалт өгнө. Нэгэнт цуцлалт байвал урт хугацаа нь өөрөө аюул биш — цуцлагдах боломжгүй урт хугацаа л аюул байсан. |
| **`middleware/auth.ts:17-41`-ийн 5 нээлттэй зам** | `/api/auth/login`, `/api/landing/public`, `/api/landing/v2/public{,/index,/project-cards}`, `/api/email/oauth/callback`. Эдгээрт `c.var.user` байхгүй — helper-ийг тэдгээрийн ӨМНӨ бүү тавь, эс бөгөөс нэвтрэх боломжгүй болж, нийтийн landing унана. |
| **`middleware/auth.ts:57-67` dev bypass** | `DEV_AUTH_BYPASS` нь `payload` NULL үед л ажилладаг. Шалгалтыг тэр салаанаас ДЭЭШ тавьбал локал хөгжүүлэлт унана. |
| **`meetingAudio.ts:23`, `email.ts:134`-ийн `purpose` шалгалтууд** | Одоо ажиллаж байгаа ЦОРЫН ГАНЦ purpose шалгалтууд. `'print'` claim нэмэх нь тэдгээрт нөлөөлөхгүй (тэд яг тэнцүү тулгадаг), гэхдээ тэдгээрийг «ерөнхий болгож сайжруулах» гэж бүү орол. |
| **`resolveExternalToken`-ын `props` хэлбэр** (`index.ts:295`) | `{ sub, role }` нь `McpProps` — `MglMcpAgent.this.props` (`mcp/MglMcpAgent.ts:54`) ба `oauth/authorize.ts:152` хоёулаа яг энэ хэлбэрийг хүлээдэг. Талбар бүү нэм/хас. |
| **`bridgePrintToken` (`frontend/src/shared/lib/printAuth.ts`)** | `?t=` токеныг **`localStorage.auth_token` дээр ДАРЖ БИЧДЭГ**. Print токенд `purpose:'print'` суусан хойно ч тэр токен бүх `/api/*` дуудлагад session мэт хэрэглэгдэнэ — **тиймээс `'print'`-ыг татгалзах ямар ч шалгалт хэвлэлтийн PDF-ийг ШУУД эвдэнэ.** Энэ deploy-д татгалзал БАЙХГҮЙ гэдгийн шалтгаан. (Хажуугийн ажиглалт: хэрэглэгч print URL-ыг өөрийн таб дээр гараар нээвэл түүний session токен 60 секундын токеноор солигдоно. Энэ бол одоо байгаа зан төлөв — энэ ажилд ЗАСАХГҮЙ.) |
| **`users` хүснэгтийг rebuild хийх** | ~25 `ON DELETE CASCADE` хүүхэд; `migrations apply` доторх транзакцад cascade ажиллана. `ALTER TABLE users ADD COLUMN`-оос цааш бүү яв. |
| **`JWT_SECRET` сэлгэх** | Бүх session, бүх add-in суулгац, бүх дундах print job-ыг нэг зэрэг устгана (нэг нууц 5 төрлийн токенд гарын үсэг зурдаг). Энэ бол яг тэр «атомын товч»-ийг хэрэггүй болгох гэж хийж буй ажил. |
| **`lib/workerScope.ts:20`-ийн `'/api/auth'` мөр** | Хасвал `worker` role нэвтрэх, профайл засах, нууц үг солих боломжгүй болно. `mcp-token`-ыг хаах ЗӨВ газар нь route дээрх role gate (§3.5), allowlist БИШ. |
| **Deploy 1 ба Deploy 2-ыг нэгтгэх** | Шинэ код `SELECT tokens_valid_from` хийхэд багана байхгүй бол D1 `no such column` шидэж, `checkTokenValidity` шидэлт хийж, `authMiddleware` унана → **бүх ажилтан бүх `/api/*`-аас гарна.** |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### ⚠️ ХОЁР DEPLOY — ЗААВАЛ ТУСАД НЬ

| Алхам | Юу | Команд | Батлах |
|---|---|---|---|
| 0 | Нөөц | `cd backend && npm run db:export` | `d1-backup.sql` үүссэн, хэмжээ > 0 |
| 1 | Дугаар булаах | `ls backend/migrations \| tail -3` | Чөлөөтэй дараагийн дугаар тодорхой |
| 2 | **DEPLOY 1 — СХЕМ** | `cd backend && npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml` | Амжилттай, шинэ файл `d1_migrations`-д бүртгэгдсэн |
| 3 | Батлах | `npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='tokens_valid_from'"` | `1` |
| 4 | Typecheck | `cd backend && npx tsc --noEmit` | Алдаа зөвхөн ӨӨРИЙН ХӨНДӨӨГҮЙ файлд бол — эзэнд мэдэгд, өөрөө бүү зас |
| 5 | Тест | `cd backend && npm test` | Суурьтай ижил тоо ногоон |
| 6 | **DEPLOY 2 — КОД** | `cd backend && npx wrangler deploy --config wrangler.toml` | §6-ийн шалгуурууд |

**Deploy 2 доторх атомын шаардлага:** §3.3(a) ба §3.3(b) — **НЭГ deploy**. Ганцыг нь гаргах нь «цуцлалт ажиллаж байна» гэсэн ХУДАЛ баталгаа өгнө (`/mcp`, `/sse` нээлттэй үлдэнэ).

**Өмнөх нөхцөл:** байхгүй — 1A-ийн бусад ажлаас хамаарахгүй.

**Дараа нь юу гарч болох вэ:** purpose-д тулгуурласан аливаа хязгаарлалт (ж: «`purpose==='print'` токеноор бичих үйлдэл хийхийг хориглох») нь ЗӨВХӨН энэ ажлын Deploy 2 прод дээр гарсны дараа, хуучин claim-гүй print токенууд дуусахыг хүлээж (60 сек, аюулгүйн үүднээс 1 өдөр) эхэлж болно.

**1A-2 (worker→MCP)** энэ ажлыг ХҮЛЭЭХГҮЙ — зэрэг явна. §3.5-ийг «1A-2 шийдэгдлээ» гэж БҮҮ тайлагна.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

- [ ] `backend/migrations/` дотор ЯГ НЭГ шинэ файл нэмэгдсэн; дугаар нь өмнөх хамгийн өндрөөс их, өөр сесстэй мөргөлдөөгүй.
- [ ] Тэр файл ЗӨВХӨН `ALTER TABLE users ADD COLUMN tokens_valid_from TEXT;` агуулсан. `DROP`, `CREATE TABLE users`, `RENAME` БАЙХГҮЙ.
- [ ] Прод D1: `SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='tokens_valid_from'` → `1`.
- [ ] `wrangler deployments list` дээр Deploy 1 ба Deploy 2 нь ХОЁР ӨӨР бичлэг (нэг биш).
- [ ] `backend/src/lib/tokenValidity.ts` үүссэн; `grep -rn "checkTokenValidity" backend/src` нь **яг гурван** тохиолдол өгнө: тодорхойлолт + `middleware/auth.ts` + `index.ts`.
- [ ] `grep -rn "purpose === 'mcp'\|purpose !== 'mcp'" backend/src` → `middleware/auth.ts`, `lib/jwt.ts`, `lib/tokenValidity.ts`-д НЭГ Ч тохиолдол БАЙХГҮЙ.
- [ ] `grep -rn "purpose: 'print'" backend/src` нийт **7** мөр өгнө: `projects.ts` ×2, `performanceReports.ts` ×2, `quotes.ts` ×1, `meetings.ts` ×1, `authorSupervision.ts` ×1.
- [ ] `POST /api/auth/mcp-token` нь `client` role-ийн токеноор **403**, `engineer` role-ийн токеноор **200**.
- [ ] **Цуцлалт `/api/*` дээр:** тест хэрэглэгчийн токен ав → `UPDATE users SET tokens_valid_from = strftime('%Y-%m-%dT%H:%M:%SZ','now','+1 minute') WHERE id = <test>` → TTL хүлээ (60+ сек) → `GET /api/auth/me` **401**.
- [ ] **Цуцлалт `/mcp` дээр:** ЯГ ТЭР токеноор `POST /mcp` (legacy bearer) → **401/403**, 200 БИШ. Энэ шалгуур нь дундын helper-ийн бүх утга учир — унавал ажил дуусаагүй.
- [ ] **Идэвхгүй хэрэглэгч:** `status='inactive'` болгосон хэрэглэгчийн ХУУЧИН токеноор `GET /api/auth/me` → TTL-ийн дараа **401**.
- [ ] **Regression — add-in:** `engineer` role-ийн бодит `purpose:'mcp'` токеноор `GET /api/projects` ба `GET /api/revit/context?doc_uid=x` → **200** (401/403 БИШ). Энэ нь §0-ийн хоригийн шалгуур.
- [ ] **Regression — хэвлэлт:** `GET /api/quotes/:id/pdf` ба гүйцэтгэлийн тайлангийн PDF гарц хоосон биш PDF буцаана.
- [ ] `cd backend && npx tsc --noEmit` цэвэр — эсвэл үлдсэн алдаанууд зөвхөн энэ ажилд ХӨНДӨӨГҮЙ файлд байгаа нь бичгээр тэмдэглэгдсэн.
- [ ] `cd backend && npm test` — суурьтай ижил тоо ногоон.
- [ ] `git status --porcelain` нь ЗӨВХӨН энэ ажлын файлуудыг харуулна (`live2.js` гэх мэт өөр агентын мөр stage хийгдээгүй).

---

## 7. ШАЛГАХ КОМАНД

```bash
# ── Миграцийн дугаар булаах (ЭХЛЭХИЙН ӨМНӨ) ──────────────────────────
ls backend/migrations | tail -3
ls backend/migrations | wc -l          # суурь: 190

# ── Одоогийн зан төлөвийг дахин батлах ────────────────────────────────
grep -rn "purpose" backend/src --include=*.ts | grep -v test
grep -rn "signToken" backend/src --include=*.ts          # 11 дуудлага
grep -rn "verifyToken" backend/src --include=*.ts        # 4 дуудагч + тодорхойлолт
grep -rn "Bearer" revit-mcp/addin --include=*.cs | grep -v "/obj/" | grep -v "/bin/"

# ── Локал typecheck + тест ────────────────────────────────────────────
cd backend && npx tsc --noEmit
cd backend && npm test

# ── Локал D1 дээр урьдчилан турших ────────────────────────────────────
cd backend && npm run db:migrate:all:local
cd backend && npm run dev        # :3000

# ── DEPLOY 1 (схем) ───────────────────────────────────────────────────
cd backend && npm run db:export                                   # нөөц
cd backend && npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
cd backend && npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS ok FROM pragma_table_info('users') WHERE name='tokens_valid_from'"

# ── DEPLOY 2 (код) ────────────────────────────────────────────────────
cd backend && npx wrangler deploy --config wrangler.toml
cd backend && npx wrangler deployments list --config wrangler.toml | head

# ── Прод дээрх гар туршилт (API_HOST = worker-ийн домэйн) ──────────────
TOKEN=...        # тест хэрэглэгчийн session токен
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" "$API_HOST/api/auth/me"   # 200

cd backend && npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "UPDATE users SET tokens_valid_from = strftime('%Y-%m-%dT%H:%M:%SZ','now','+1 minute') WHERE id = <TEST_ID>"
sleep 65
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" "$API_HOST/api/auth/me"   # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $TOKEN" "$API_HOST/mcp"   # 401/403

# ── Add-in-ийн замууд эвдрээгүйг батлах (жинхэнэ mcp токеноор) ────────
MCPTOK=...       # engineer role-ийн 365 хоногийн токен
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $MCPTOK" "$API_HOST/api/projects"                   # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $MCPTOK" "$API_HOST/api/revit/context?doc_uid=x"    # 200

# ── Цэвэрлэх (туршилтын дараа) ────────────────────────────────────────
cd backend && npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "UPDATE users SET tokens_valid_from = NULL WHERE id = <TEST_ID>"
```

---

## 8. ROLLBACK

| Алхам | Буцаах арга |
|---|---|
| **Deploy 2 (код)** | `cd backend && npx wrangler rollback --config wrangler.toml` — эсвэл өмнөх commit-оос `npx wrangler deploy --config wrangler.toml`. Кодын өөрчлөлт бүхэлдээ буцна: helper дуудлага алга болно, `purpose:'print'` claim шинэ токенд суухаа болино (хуучин claim-тай токенууд 60 секундэд дуусна, тэдгээрийг унших код байхгүй тул хор хөнөөлгүй), role gate арилна. |
| **Аврах хамгийн хурдан хөшүүрэг (deploy ШААРДЛАГАГҮЙ)** | `UPDATE users SET tokens_valid_from = NULL;` — цуцлалт бүхэлдээ идэвхгүйжнэ (шинэ код байсан ч). `status='inactive'` шалгалт хэвээр үлдэнэ; тэр нь асуудал үүсгэвэл helper-ийн `if (row.status === 'inactive')` мөрийг хасаад Deploy 2-ыг дахин гарга. |
| **Deploy 1 (багана)** | **`ALTER TABLE users DROP COLUMN`-ыг БҮҮ ажиллуул.** Багана нь хоосон (`NULL`) үедээ огт хор хөнөөлгүй — `accent_color`, `tv_kiosk`, `model_xkt_url` шиг үлдээ. Хэрэв ЗААВАЛ хасах шаардлагатай бол `users`-ын бүтэн rebuild (~25 cascade хүүхэдтэй, path-B журам: `d1 export` → `d1 execute --remote --file` → `PRAGMA foreign_key_check` → `d1_migrations`-д ГАРААР INSERT) — **энэ нэг баганын төлөө хийх ажил БИШ.** |
| **Шинэ миграцийн дугаар хэрэгтэй юу?** | Утгыг цэвэрлэхэд ХЭРЭГГҮЙ (`UPDATE … SET NULL` нь тохиргооны үйлдэл, миграци биш). Гэхдээ хэрэглэгдсэн миграцийн ФАЙЛЫГ засах нь прод дээр ЧИМЭЭГҮЙ no-op тул схемийг үнэхээр өөрчлөх шаардлага гарвал ЗААВАЛ **ШИНЭ дугаар** — хуучин файлыг бүү зас. |
| **Add-in** | Энэ ажил C#-д хүрээгүй тул add-in талд буцаах юу ч БАЙХГҮЙ. Хэрэв ямар нэг байдлаар add-in эвдэрвэл (ж: `purpose==='mcp'`-ийг санамсаргүй татгалзсан) — тэр нь ЗӨВХӨН Worker-ийн rollback-оор засагдана, ~20 PC руу явах шаардлагагүй. Яг үүний ТӨЛӨӨ §0-ийн хориг байгаа. |

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Эдгээрийг репогоос ШИЙДЭХ БОЛОМЖГҮЙ — эзэн, эсвэл прод өгөгдлийн query шаардана.

1. **Хэдэн амьд 365 хоногийн токен байгаа вэ, аль role-ууд эзэмшиж байгаа вэ?**
   `lib/jwt.ts` нь ямар ч цуцлалтын жагсаалт, олгосон токены ямар ч бүртгэл хөтөлдөггүй — иймд **DB-ээс тоолох боломжгүй**. Ойролцоолох цорын ганц зам нь Worker-ийн ажиглалт (`npx wrangler tail --config wrangler.toml` дээр `/api/auth/mcp-token` дуудлагыг барих, эсвэл Cloudflare Analytics-ын түүхэн хүсэлтүүд), эсвэл IT-гээр дамжуулан add-in суулгасан PC-үүдийг тоолох. Асуулт эзэнд: *«Хэдэн PC дээр Revit add-in суулгасан, тэдгээр нь аль ажилтных вэ?»* Энэ тоо нь §3.5-ийн `MCP_TOKEN_ROLES` жагсаалт зөв эсэхийг шийднэ. Хэрэв `client` эсвэл `worker` role-ийн хэн нэгэн одоо add-in ашиглаж байгаа бол role gate тэднийг ШИНЭ токен цохихоос хаана (хуучин токен нь ажиллах хэвээр — шууд эвдрэл гарахгүй, харин дараагийн дахин нэвтрэлт дээр эвдэрнэ).
2. **Кэшийн TTL — цуцлалт хэдэн секундын дараа хүчин төгөлдөр болох ёстой вэ?** TTL=0 нь «шууд, гэхдээ `/api/*` хүсэлт бүрт нэмэлт D1 унших». TTL=60 сек нь «бараг тэг өртөг, 1 минут хүртэл саатал». **Латентын өртөг ХЭМЖЭЭГҮЙ** — энэ нь 1C track-ын ажил; «250 ms» бол шаардлага биш, зүгээр л хэн ч аваагүй хэмжилт. Эзний хариу шаардлагатай.
3. **`PATCH /api/users/:id/status` дээр `tokens_valid_from`-ыг автоматаар бичих үү?** (§3.6 сонголтоор). Эзэн «идэвхгүй болголт нь тэр агшинд бүх төхөөрөмжөөс гаргах ёстой» гэвэл — тийм. Хажуугийн үр дагавар: тухайн хүнийг дахин `active` болгоход хуучин токенууд СЭРГЭХГҮЙ, дахин нэвтрэх шаардлагатай.
4. **Нууц үг солиход бүх session-ыг унтраах уу?** `POST /api/auth/change-password` (`routes/auth.ts:251`) одоо токенд ямар ч нөлөөгүй. `tokens_valid_from` нь энэ асуудлыг шийдэх зөв багана, гэхдээ энэ нь ЭЗНИЙ БОДЛОГЫН шийдвэр — энэ ажилд ОРООГҮЙ.
5. **OAuth grant-ыг цуцлах шаардлагатай юу?** `/authorize`-аар олгогдсон MCP grant нь `OAUTH_KV`-д props `{sub, role}`-оор амьдардаг (`oauth/authorize.ts:152-158`), `iat` агуулдаггүй, `verifyToken`-оор дамждаггүй — иймд `tokens_valid_from` түүнд ХАМААРАХГҮЙ. Access token 1 цаг (`index.ts:287`), refresh нь KV-д үлдэнэ. Асуулт: *«Claude Desktop / claude.ai-аас MGL-д холбогдсон grant хэд байгаа вэ, тэдгээрийг цуцлах хэрэгцээ өнөөдөр бий юу?»* Хэрэв бий бол тэр нь ТУСДАА ажил (KV-ийн grant-уудыг гүйлгэж устгах).
6. **`purpose:'print'` дээр татгалзал хэзээ нэмэх вэ?** Энэ ажил claim-ийг л суулгана. Дараагийн алхам («print токеноор бичих үйлдэл хориглох») нь `bridgePrintToken`-ы зан төлөвтэй (§4) шууд мөргөлдөх эрсдэлтэй тул тусад нь төлөвлөгдөх ёстой — эзний баталгаа хэрэгтэй.
7. **Нөөц.** Deploy 1-ийн өмнө `npm run db:export` заавал ажиллуулах уу, эсвэл эзэн Cloudflare-ын автомат нөөцөнд итгэх үү? (Прод DB нь `mgl-progress-db-v3`, `03167f58-753b-4f99-a6f9-fb361bf2a453`; хуучин `mgl-progress-db` нь 2026-08-24-ний нүүлгэлтийн өмнөх нөөц — тэр рүү БҮҮ бич.)
8. **`users`-ын cascade хүүхдийн бодит тоо прод дээр хэд вэ?** Локал хуулбар дээр 25, спекэд 27 гэсэн. Rollback-ийн шийдвэрт л нөлөөлнө (энэ ажил rebuild хийхгүй тул үндсэн урсгалд нөлөөгүй). Батлах: `npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND sql LIKE '%REFERENCES users%ON DELETE CASCADE%'"` (хүснэгтийн тоо, багана биш — нэг хүснэгтэд олон FK байж болно).
