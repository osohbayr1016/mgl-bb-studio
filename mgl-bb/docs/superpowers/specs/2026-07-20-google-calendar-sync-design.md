# Дотоод календарь ↔ Google Calendar хоёр талын синк

**Огноо:** 2026-07-20
**Төлөв:** Дизайн батлагдсан, хэрэгжүүлэлт хүлээгдэж байна

## 1. Зорилго ба хамрах хүрээ

Одоо байгаа дотоод `calendar_events` зарлал/эвент календарийг компанийн **нэг** Google Calendar-тай **хоёр талдаа** синк хийх.

Батлагдсан шийдвэрүүд:

- **Чиглэл:** хоёр талын синк.
- **Таргет:** нэг хуваалцсан компанийн Google Calendar (`GOOGLE_CALENDAR_ID`).
- **Хамрах хүрээ:** дотоод календарийн **бүх** эвент Google руу синк болно (багийн хамрах хүрээ Google талд илэрхийлэгдэхгүй — хүлээн зөвшөөрсөн).
- **Механизм (A хувилбар):** Website→Google нь бичих үйлдэл бүрт **шууд** түлхэнэ; Google→Website нь одоо байгаа **2-мин cron**-д `syncToken`-оор татна.
- **Нэвтрэлт:** Service Account — **одоо байгаа `GOOGLE_SA_JSON` secret-ийг дахин ашиглана** (Gmail интеграцийн SA-тэй ижил).

Хамрахгүй (YAGNI): per-user Google календарь, real-time webhook, олон календарь, багийн хамрах хүрээг Google талд ялгах, зөрчлийн UI.

## 2. Одоо байгаа дэд бүтэц (дахин ашиглах)

- **Cron:** `wrangler.toml` дахь `[triggers] crons = ["*/2 * * * *"]` + `index.ts`-ийн `scheduled` handler (одоо `syncAllMailboxes`, `reconcileMeetings`-г дуудаж байгаа). Календарь синкийг зэрэгцүүлж нэмнэ.
- **Service Account:** `backend/src/lib/google/googleAuth.ts` — `GOOGLE_SA_JSON`-оос SA-г уншиж, WebCrypto-ээр RS256 JWT зурж, access token авдаг, isolate-д кэшилдэг бүх примитив (`parseServiceAccount`, `importPrivateKey`, token cache) бэлэн байна. Gmail нь domain-wide delegation-аар impersonation (`sub=mailbox`) хийдэг; **Calendar-д impersonation хэрэггүй** — SA-г календарьтай шууд хуваалцана.
- **KV:** `OAUTH_KV` namespace — sync token болон pending-delete жагсаалт хадгална.
- **Календарийн route:** `backend/src/routes/calendar.ts`, `/api/calendar`-т mount (`POST /events`, `PUT /events/:id`, `DELETE /events/:id`, бүгд `requireAdmin`).

## 3. Урьдчилсан тохиргоо (Google Cloud талд, гараар)

Одоо байгаа Gmail SA-ийн GCP project дээр:

1. **Google Calendar API**-г идэвхжүүлэх.
2. Компанийн Google Calendar → Settings → **"Share with specific people"** → `GOOGLE_SA_JSON`-ийн `client_email`-ийг нэмэх, **"Make changes to events"** эрх өгөх.
3. Тухайн календарийн **Calendar ID**-г авах (Settings → "Integrate calendar").
4. Worker тохиргоо:
   - `GOOGLE_CALENDAR_ID` — `wrangler.toml` `[vars]` (нууц биш). **Таргет акаунт: `mgl.eandc@gmail.com`.** Энэ акаунтын үндсэн (primary) календарийн ID нь акаунтын и-мэйл өөрөө буюу `mgl.eandc@gmail.com`. Хэрэв тусдаа нэртэй дэд календарь ашиглах бол Settings → "Integrate calendar"-аас гарах өөр ID-г авна.
   - `GOOGLE_SYNC_USER_ID` — (сонголттой) Google-оос ирсэн эвентийн `created_by` болох дотоод админ хэрэглэгчийн id. Тохируулаагүй бол хамгийн бага id-тэй `admin` руу fallback.
   - `GOOGLE_SA_JSON` — **аль хэдийн тохируулагдсан**, дахин хийх шаардлагагүй.

**Feature-flag зан төлөв:** `GOOGLE_SA_JSON` эсвэл `GOOGLE_CALENDAR_ID` байхгүй бол синк **бүхэлдээ no-op** — local dev болон тохируулаагүй орчин эвдрэхгүй (`emailSync`-ийн загвар).

**Энгийн @gmail акаунтын тэмдэглэл:** `mgl.eandc@gmail.com` нь Google Workspace биш, энгийн @gmail.com акаунт. Календарийг Service Account-тэй хуваалцах арга энэ тохиолдолд ажилладаг — SA нь календарьт "Make changes to events" эрхээр шууд хандана, **impersonation (domain-wide delegation) шаардахгүй**. Бид эвентэд гадны оролцогч (attendee) урьдаггүй тул SA-ийн урилга илгээх хязгаарлалт нөлөөлөхгүй. (Gmail интеграцийн `sub=mailbox` impersonation зам энд хамаарахгүй — Calendar токенд `sub` талбар байхгүй.)

## 4. Өгөгдлийн загвар — `0124_calendar_google_sync.sql`

`calendar_events`-т нэмэх багана:

```sql
ALTER TABLE calendar_events ADD COLUMN google_event_id TEXT;
ALTER TABLE calendar_events ADD COLUMN google_etag TEXT;
ALTER TABLE calendar_events ADD COLUMN google_synced_at TEXT;
CREATE INDEX IF NOT EXISTS idx_calendar_events_google_event_id
  ON calendar_events(google_event_id);
```

- `google_event_id` — Google эвентийн `id` (маппинг түлхүүр). Website-originated эвентэд түлхсэний дараа бичигдэнэ; Google-native эвентэд импорт хийхэд бичигдэнэ.
- `google_etag` — сүүлд синк болсон Google `etag` (echo loop сэргийлэлт).
- `google_synced_at` — тухайн мөрийг Google-тэй сүүлд амжилттай синк хийсэн UTC timestamp. Cron backstop нь `updated_at > google_synced_at`-аар "бохир" мөрийг илрүүлнэ.

**KV төлөв (`OAUTH_KV`):**

- `gcal:sync_token` → Google-ийн `nextSyncToken` (incremental pull-ийн курсор).
- `gcal:pending_deletes` → JSON массив: шууд түлхэлт бүтэлгүйтсэн устгалын `google_event_id`-ууд. Cron дараагийн ажиллагаанд цэвэрлэнэ.
- `gcal:lock` → (сонголттой) cron давхцлаас сэргийлэх богино TTL lock.

`CalendarEventRow` (types.ts)-д гурван шинэ багана нэмнэ (`google_event_id: string | null` гэх мэт).

## 5. Модулийн бүтэц

Шинэ файлууд:

- `backend/src/lib/google/calendarAuth.ts` — `getCalendarAccessToken(env)`: `GOOGLE_SA_JSON`-оос SA-г уншиж (`googleAuth.ts`-ийн примитивийг дахин ашиглана), `scope=https://www.googleapis.com/auth/calendar`, **`sub` талбаргүй** JWT зурж access token авна. Isolate cache (`cal:sa` түлхүүр).
  - *Хэрэгжүүлэлтийн тэмдэглэл:* `googleAuth.ts`-ийн `parseServiceAccount` / `importPrivateKey` / token cache нь одоо module-private. Эдгээрийг жижиг generic `mintServiceAccountToken(env, { scope, subject? })` болгон `googleAuth.ts`-аас export хийж, Gmail болон Calendar хоёулаа ашиглана (давхардлыг арилгах, хамрах хүрээг хэвээр). Энэ нь `googleAuth.ts`-д хамгийн бага өөрчлөлт.
- `backend/src/lib/google/calendarClient.ts` — Calendar REST-ийн нимгэн wrapper (`Authorization: Bearer <token>`):
  - `insertEvent(token, calendarId, body)` → `POST /calendars/{id}/events`
  - `patchEvent(token, calendarId, eventId, body)` → `PATCH /calendars/{id}/events/{eventId}`
  - `deleteEvent(token, calendarId, eventId)` → `DELETE …` (404/410-г идемпотентээр залгих)
  - `listEvents(token, calendarId, { syncToken?, pageToken?, timeMin? })` → `GET …/events`. `410 Gone` (syncToken хүчингүй) ирвэл дуудагч бүтэн синк рүү шилжинэ.
- `backend/src/lib/googleCalendarSync.ts` — оркестрац (доор 6-8-р хэсэг):
  - Цэвэр функцууд: `mapEventToGoogle(row)`, `mapGoogleToEvent(gEvent)`.
  - `pushEvent(env, row)`, `pushDelete(env, googleEventId)` — Website→Google (route болон cron backstop-оос дуудагдана).
  - `pullChanges(env)` — Google→Website (cron).
  - `reconcileDirty(env)` — `updated_at > google_synced_at` эсвэл `google_event_id IS NULL` мөрүүдийг дахин түлхэх backstop.
  - `drainPendingDeletes(env)` — `gcal:pending_deletes`-ийг цэвэрлэх.
  - `syncGoogleCalendar(env)` — cron entry: config шалгах → lock → `drainPendingDeletes` → `reconcileDirty` → `pullChanges`.

Засах файлууд:

- `backend/src/routes/calendar.ts` — `POST /events` (олон огноогийн бүх шинэ мөр), `PUT /events/:id`, `DELETE /events/:id`-ийн дараа `ctx.waitUntil(pushEvent(...))` / `pushDelete(...)`.
- `backend/src/index.ts` — `scheduled` handler-т `ctx.waitUntil(syncGoogleCalendar(env))` нэмэх.
- `backend/src/types.ts` — `Env`-т `GOOGLE_CALENDAR_ID?`, `GOOGLE_SYNC_USER_ID?`; `CalendarEventRow`-т 3 багана; `googleAuth.ts`-аас export хийх generic token minter.

## 6. Талбарын маппинг

### 6.1 Дотоод → Google (`mapEventToGoogle`)

- `summary` (Google) = `title`.
- `description` (Google) = `[summary, message].filter(Boolean).join('\n\n')` (хоосон бол талбар оруулахгүй).
- **Цаг/огноо:**
  - `start_time` байгаа: `start.dateTime = "<event_date>T<start_time>:00"`, `start.timeZone = "Asia/Ulaanbaatar"`. `end.dateTime` = `end_time` байвал тэр; байхгүй бол `start_time + 1 цаг` (шаардвал маргаашийн өдөр рүү дамжина).
  - `start_time` байхгүй (бүтэн өдөр): `start.date = event_date`, `end.date = event_date + 1 өдөр` (Google-ийн бүтэн өдрийн `end` нь exclusive).
- **Эрэмбэ → өнгө:** `colorId` — `normal` → талбар оруулахгүй (default), `high` → `"5"` (banana/шар), `urgent` → `"11"` (tomato/улаан).
- `extendedProperties.private.mgl_event_id = String(row.id)` — website-originated гэдгийг тэмдэглэх (мөн pull үед өөрийн эвентийг таних нэмэлт баталгаа).

### 6.2 Google → Дотоод (`mapGoogleToEvent`) — Google-native шинэ эвент

- `title` = `summary` (хоосон бол `"(гарчиггүй)"`).
- `summary` (дотоод багана) = `null`; `message` = Google `description` (эсвэл `null`).
- **Цаг/огноо:**
  - `start.date` (бүтэн өдөр): `event_date = start.date`, `start_time = null`, `end_time = null`.
  - `start.dateTime` (цагтай): UB timezone руу хөрвүүлж `event_date` + `start_time` (HH:MM) + `end_time` (HH:MM, `end.dateTime`-аас).
- `priority = 'normal'` (Google `colorId`-г буцааж маппинг хийхгүй — энгийн байлгах).
- Багийн хамрах хүрээ **байхгүй** (company-wide — `calendar_event_teams`-т мөр оруулахгүй).
- `created_by = GOOGLE_SYNC_USER_ID` (эсвэл fallback админ).
- `google_event_id`, `google_etag` мөрөнд хадгална.

**Хязгаарлалт (баримтжуулсан):** олон өдөр үргэлжлэх Google эвент нь эхлэх өдрийн **ганц** дотоод мөр болно. Дотоод загвар нэг мөрөнд нэг өдөр агуулдаг тул үргэлжлэлийг тэлэхгүй.

## 7. Урсгал ба echo-loop сэргийлэлт

### 7.1 Website write → Google (шууд)

Route-ийн DB бичилтийн дараа `ctx.waitUntil`-д:

- **Create:** шинэ мөр бүрд (олон огноо = олон мөр) `pushEvent` → `insertEvent`. Хариу дахь `id`+`etag`-г мөрөнд бичиж, `google_synced_at = одоо`.
- **Update:** `google_event_id` байвал `patchEvent`; байхгүй бол `insertEvent` (өмнө нь түлхэгдээгүй мөр). Шинэ `etag`+`google_synced_at` бичнэ.
- **Delete:** `google_event_id` байвал `pushDelete`. Бүтэлгүйтвэл тухайн `google_event_id`-г `gcal:pending_deletes`-т нэмнэ (мөр аль хэдийн устсан тул backstop өөр аргаар олж чадахгүй).

Түлхэлтийн алдаа route-ийн хариуг **блоклохгүй** — синк best-effort, cron backstop нөхнө.

### 7.2 Google → Website (cron, `pullChanges`)

`listEvents(syncToken)`-оор өөрчлөгдсөн эвент бүрд:

1. `extendedProperties.private.mgl_event_id` эсвэл хадгалсан `google_event_id`-аар дотоод мөр хайх.
2. **Таарсан бол:**
   - `status === 'cancelled'` → дотоод мөрийг устгах (+ junction).
   - Google `etag` === хадгалсан `google_etag` → **өөрсдийн echo, алгасах**.
   - `etag` өөр → Google засварыг дотоод руу буулгах (`mapGoogleToEvent`-ийн талбарууд), шинэ `etag`+`google_synced_at` бичих.
3. **Таарахгүй бол (Google-native шинэ):** `status !== 'cancelled'` үед дотоод мөр `INSERT` (`mapGoogleToEvent`), `google_event_id`+`etag` хадгалах. **Google руу patch-back хийхгүй** — нэмэлт бичилт/echo гаргахгүйн тулд зөвхөн хадгалсан `google_event_id`+`etag`-д тулгуурлана.
4. `nextSyncToken` → `gcal:sync_token` шинэчлэх (page бүрийн дараа `pageToken`, төгсгөлд `nextSyncToken`).

**Echo-ийн цаг хугацааны нарийвчлал:** website patch хийхэд `etag=E2` хадгалагдана. Дараагийн cron pull тэр эвентийг `E2`-оор буцаавал таарч алгасна. Хэрэв хооронд нь хэн нэг Google дээр засвал `etag=E3 ≠ E2` → буулгана (last-writer-wins).

### 7.3 Cron backstop (`reconcileDirty` + `drainPendingDeletes`)

- `reconcileDirty`: `google_event_id IS NULL` (хэзээ ч түлхэгдээгүй) эсвэл `updated_at > google_synced_at` (шууд түлхэлт бүтэлгүйтсэн/хоцорсон) мөрүүдийг `pushEvent`-ээр дахин түлхэнэ. `google_synced_at`-ийг `updated_at`-аас **хойш** бичдэг тул `>` харьцуулалт давхар түлхэлт гаргахгүй.
- `drainPendingDeletes`: `gcal:pending_deletes` дахь id бүрийг `deleteEvent`-ээр устгаж, амжилттай бол жагсаалтаас хасна.

## 8. Алдаа & зөрчил

- **Түлхэлтийн алдаа:** админд өгөх API хариу амжилттай хэвээр; `reconcileDirty`/`pending_deletes` нөхнө.
- **`410 Gone` (syncToken хүчингүй):** `gcal:sync_token`-г цэвэрлэж, `timeMin = одоо − 30 хоног`-оор бүтэн синк хийж дахин курсор тогтооно.
- **Токены алдаа / Calendar API идэвхгүй:** алдааг лог руу бичиж чимээгүй буцна (cron дараагийн удаа дахин оролдоно).
- **Зэрэг хоёр талын засвар:** last-writer-wins (cron pull дараа ажилласан бол Google, website patch сүүлд бол website). Rare; баримтжуулсан.
- **Cron давхцал:** синк бүр богино (syncToken incremental) тул эрсдэл бага; шаардвал `gcal:lock` KV TTL-ээр хамгаална.

## 9. Шалгалт (repo-д автомат тест байхгүй)

Гараар баталгаажуулна:

1. `wrangler dev` (local D1 + secrets `.dev.vars`-т) → migration 0124-г local-д хэрэгжүүлэх.
2. **Website→Google:** `POST /api/calendar/events` (админ токен) → Google Calendar дээр эвент гарч ирсэнийг шалгах; `PUT`/`DELETE`-ийг мөн шалгах.
3. **Google→Website:** Google Calendar дээр гараар эвент нэмэх → cron-г `wrangler dev --test-scheduled` + `curl "http://localhost:3000/__scheduled?cron=*/2+*+*+*+*"`-ээр идэвхжүүлэх → `GET /api/calendar/events`-т гарч ирсэнийг шалгах.
4. **Echo сэргийлэлт:** website эвент үүсгэсний дараа хэд хэдэн cron ажиллуулж давхардал/эргэлт үүсэхгүйг батлах.
5. **Устгал 2 талд:** website-аас устгах → Google-оос алга болох; Google-оос устгах → cron дараа дотоодоос алга болох.

Deploy: migration remote-д (`d1 migrations apply --remote --config wrangler.toml`) → `wrangler deploy --config wrangler.toml`. `GOOGLE_CALENDAR_ID` var + календарийг SA-тэй хуваалцах нь урьдчилсан нөхцөл.

## 10. Хэрэгжүүлэлтийн дараалал (тойм)

1. Migration 0124 + `types.ts` (Env + CalendarEventRow).
2. `calendarAuth.ts` (+ `googleAuth.ts`-аас generic token minter export).
3. `calendarClient.ts` (REST wrappers).
4. `googleCalendarSync.ts` — mapping + push + pull + backstop.
5. `routes/calendar.ts` — push-on-write хайрслах.
6. `index.ts` — scheduled handler-т залгах.
7. Local гар шалгалт → deploy.
