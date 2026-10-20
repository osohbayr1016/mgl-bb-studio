# §05 · Feature-by-feature

Домэйн бүрийг: **юу хийдэг**, **аль route + аль frontend feature**, **гол gotcha** гэж товчлов. Дэлгэрэнгүй код `backend/src/routes/` ба `frontend/src/features/`-д.

## Гүйцэтгэл / MyTasks

`routes/tasks.ts · progress.ts` ↔ `features/tasks/MyTasksPage.tsx`. Ажилтан task бүр дээр % + тэмдэглэл + зураг илгээнэ (inline daily-report form). Мөн **Засвар** (`routes/repair.ts`, `RepairSection.tsx`) — өөрөө бүртгэх засвар/нэмэлт ажил, `user_points.source='repair'`-оор leaderboard-д ордог.

## Ирц (Attendance)

`routes/attendance.ts` (2400+ мөр, том нь) + `attendanceConfirmations.ts · office-ips.ts · out-of-office.ts` ↔ `features/attendance/`. Clock-in → clock-out. Gate-ууд (тохиргоо/role-оор алгасаж болно):

- **Office IP** — `office_ips` whitelist (exact эсвэл CIDR, `ipMatches`).
- **Утас блок** — phone User-Agent-ыг server талд блоклоно (зөвхөн desktop).
- **Device binding** — эхний clock-in browser-ийн `X-Device-Id`-г хэрэглэгчид холбоно; дараагийнх таарах ёстой (admin reset).
- Ядаж 1 төсөл сонгосон байх; clock-out-д тэр өдөр ажил тайлагнасан байх.

Хоцролт нь цагийн хуваарийн эсрэг (summer сард 08:00 албадана) хасах grace. `computeHours` нь lunch цонхны давхцлыг хасдаг (`lunch_enabled`). Сар бүрийн **self-баталгаажуулалт** (confirm/dispute) нь `attendance_confirmations`-д.

> **Timezone.** Бүх цаг UB `+08:00` ISO string. Worker нь UTC дээр ажилладаг болохоор **`new Date()`-ээр огноо тооцож бүү бод** — `lib/time.ts`-ийн helper (`todayInUB`, `nowInUBIso`) ашигла. Frontend-д зэрэгцээ `attendanceExempt.ts` жагсаалт байгаа, sync-д байлга.

## Чөлөө / Илүү цаг / Баяр

`routes/leaves.ts · overtime.ts · holidays.ts` + `lib/leavePolicy.ts · leaveWaiver.ts · holidays.ts`. `reason_code` нь `LEAVE_POLICY`-оор дамжиж paid/unpaid + зөөлөн policy warning гаргана (сервер албаддаггүй). Батлагдсан чөлөө/OOO нь ирцийн **хоцролтыг уучилдаг** (waiver) ба ажилласан цагт тооцогдоно. Timesheet rollup нь ирц + чөлөө + илүү цагийг нэгтгэнэ.

## Хурлын тэмдэглэл (Meetings)

`routes/meetings.ts` (admin) + `meetingAudio.ts · speechmatics.ts` ↔ `features/meeting-notes/`. Урсгал: аудио → хувийн `MEETING_BUCKET` → **Speechmatics** batch STT (`enhanced`, diarization) → webhook эсвэл cron backstop-оор transcript → Workers-AI (эсвэл Claude-over-MCP) шинжилгээ. Action item-уудыг weight-0 «Хурлын даалгавар» блок дор жинхэнэ task болгож болно (progress-д 0 нэмнэ). Урт transcript-ын бүтэн JSON-ыг R2-д, зөвхөн текстийг D1-д (SQLITE_TOOBIG-аас зайлсхийх).

## Имэйл (Gmail)

`routes/email.ts` + `lib/emailSync.ts · google/*` ↔ `features/email/`. 2 auth стратеги: **workspace** (service-account domain-wide delegation, `@mglenc.com` хайрцгийг impersonate) ба **oauth** (`@gmail`, refresh token-ыг AES-GCM-ээр шифрлэж D1-д). Cron incremental sync (`history.list`). Мэйлийг `correspondence_log`-д triage хийж project + doc_type-д ангилж `ref_no` авто-дугаарлана.

## Google Calendar sync

`routes/calendar.ts` + `lib/googleCalendarSync.ts`. Нэг компанийн Google Calendar-тай 2-талын. Loop-оос сэргийлэхийн тулд мөр бүр etag хадгалж, өөрсдийн push-ийн echo-г алгасдаг. Sync token нь `OAUTH_KV`-д. `GOOGLE_SA_JSON` + `GOOGLE_CALENDAR_ID` хоёулаа тавигдаагүй бол no-op.

## Dashboard / Company / TV самбар

`routes/dashboard.ts · company.ts · correspondence.ts` + `lib/companyTimeseries.ts · progressTimeseries.ts` ↔ `features/dashboard/`. Company overview нь edge-cache-тэй (30с). Timeseries нь батлагдсан `progress_entries` log-оос огноо бүрээр progress-ыг сэргээж TradingView маягийн wallboard-ыг тэжээнэ (`/app/tv` kiosk).

## Үнийн санал (Quotes)

`routes/quotes.ts` ↔ `features/quotes/`. Template → instance → admin review → PDF. Draft үүсгэхэд template-ийн intro/terms/currency-г **snapshot** хийнэ (сүүлд template зассан ч in-flight quote өөрчлөгдөхгүй). Total-ыг сервер PUT бүр дээр дахин тоолно. Autosave 2.5с debounce. Нийтийн fill: `/q/:token` (QR-ээр) эсвэл `/quotes/fill?t=<jwt>`. Excel-маягийн spreadsheet editor (`QuoteSpreadsheet`) нэмэгдсэн.

## Landing CMS

`routes/landing.ts · landingBlocks.ts` ↔ `features/landing/`. Block-based CMS (`/api/landing/v2/*`). **Одоогоор `/`-д `GlitchLandingPage` түр тавьсан**, CMS-тэй `LandingPage` бүрэн байгаа ч route-лаагүй (буцаахдаа `routes.tsx`-ийн `/` element-ийг сольно).

## Бусад

| Feature | Route | Тэмдэглэл |
|---------|-------|-----------|
| PGP (хөгжлийн төлөвлөгөө) | `routes/pgp.ts` | Route байхгүй — `ProfilePage`/`UsersPage`-д суулгасан |
| Санал хүсэлт | `routes/suggestions.ts` | received→discussing→resolved |
| ProjectChat | `routes/projectChat.ts` | Дисциплин тус бүрийн чат; anonymization нь API давхаргад (SQL view биш) |
| Norm каталог | `routes/normCatalog.ts` | Норм дүрэм — статик массиваас DB руу (0120) |
| Settings | `routes/settings.ts` | Ирцийн knob, branding logo. Өөрчлөлт зөвхөн **ШИНЭ** бичлэгт нөлөөлнө |
| Notifications | `lib/notify.ts` | Зөвхөн апп доторх (push/email үгүй) |
