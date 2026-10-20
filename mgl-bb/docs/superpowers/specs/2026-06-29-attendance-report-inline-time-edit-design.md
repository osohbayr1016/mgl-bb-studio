# Тайлан таб — ирц нөхөх/засах (inline popover)

**Огноо:** 2026-06-29
**Хамрах хүрээ:** Attendance "Тайлан" (reports) таб — `DailyAttendanceGrid`

## Context

Ирцийн "Тайлан" таб (`AttendanceAdminPage` → `reports` таб) нь ажилтан × өдөр бүрээр
ирсэн/гарсан цаг, хоцролт, чөлөө зэргийг харуулдаг **read-only** XLSX-маягийн grid.
Зарим ажилтан ажилдаа ирсэн ч ирсэн цагаа бүртгээгүй, эсвэл буруу бүртгэсэн тохиолдол
гардаг. Одоо админ үүнийг засахын тулд өөр таб (today/open) руу шилжих шаардлагатай.
Зорилго: "Тайлан" grid дотроос **шууд (popover-оор)** ирсэн/гарсан цагийг нөхөх/засах.

Эрх: `admin`, `senior` (таб болон endpoint аль аль нь).

## Backend

### Шинэ endpoint: `POST /api/attendance/sessions/upsert`
`requireRole('admin', 'senior')`. Create + edit-ийг нэг endpoint-оор хийнэ.

**Payload:** `{ user_id: number, date: 'yyyy-mm-dd', clock_in: 'HH:mm', clock_out?: 'HH:mm', next_day?: boolean, note?: string }`

**Логик** — (user_id, date)-аар тухайн өдрийн session-уудыг тоолно:
- **0 session →** шинээр үүсгэнэ. Одоо байгаа `/sessions/manual`-ийн логиктой ижил
  (clockIn = `${date}T${HH:mm}:00+08:00`, хоцролт = shift+grace, prior-session re-entry
  дүрэм, `computeHours`, `created_by=edited_by=actor`).
- **1 session →** тухайн session-ийг шинэчилнэ: `clock_in` (+ хоцролт дахин тооцно),
  `clock_out`/`hours_worked` (өгвөл), `edited_by`/`edited_at`/`edit_note` бичнэ.
  `created_by`-г хөндөхгүй (organic бичлэг payroll өгөгдөл хэвээр, гэхдээ засвар нь
  audit-д үлдэнэ).
- **2+ session →** `409 { error: 'Тухайн өдөр олон бүртгэлтэй — нэг бүрчлэн засна уу' }`.
  Санамсаргүй буруу засахаас сэргийлнэ.

**Валидаци (manual-тай ижил):** user_id/date шаардлагатай, ирээдүйн өдөр/цаг хориглоно,
`HH:mm` regex, clock_out > clock_in, `next_day` бол гарах огноо +1.

**Дахин ашиглах helper-ууд (модуль түвшний, manual handler-ийг хөндөхгүй):**
`SHIFTS`, `effectiveSchedule`, `computeHours`, `getAttendanceSettings`, `ubMinutesOf`,
`nextDayIso`, `nowInUBIso`, `extractClock`.

**Дагалдах үйлдэл (manual-тай ижил):**
- `createNotification(targetId, 'attendance_adjusted', …)` — actor ≠ target үед.
- `logAdminAction({ action: 'session_create' | 'session_edit', … })`.

**`/sessions/manual` хэвээр үлдэнэ** — today таб ашигладаг тул хөндөхгүй.

### `GET /api/attendance/daily-grid` нэмэлт
Aggregation-д `COUNT(*) AS session_count` нэмж, `DailyAttendanceRow`-д `session_count`
талбар нэмнэ (frontend popover олон session-той өдрийг урьдчилан анхааруулна).

## Frontend (`DailyAttendanceGrid` дотор)

- "Ирсэн цаг" нүдэнд (эсвэл мөрийн төгсгөлд) жижиг `✎` товч.
- Дарахад popover (`@/ui/popover` reuse):
  - **Ирсэн** `[HH:mm]` — заавал. Default = одоогийн `actual_in` ?? `planned_in`.
  - **Гарсан** `[HH:mm]` — сонголт. Default = одоогийн `actual_out`. `☐ +1 өдөр`.
  - **Тэмдэглэл** — сонголт.
  - `[Болих] [Хадгалах]`.
- Хадгалах → `POST /attendance/sessions/upsert` → амжилттай бол `dailyGridQuery.refetch()`.
- `session_count > 1` → popover-т улаан анхааруулга, Хадгалахыг сэргийлнэ (server мөн guard).
- Алдаа (409 г.м.) → popover-т улаанаар харуулна.
- Шинэ i18n key-үүд `mn.json` + `en.json` хоёуланд.

`DailyAttendanceRow` type (`frontend/src/shared/types/index.ts`)-д `session_count: number` нэмнэ.

## Approaches (харьцуулалт)

1. **✅ (user_id, date)-аар upsert (сонгосон):** grid aggregated тул session_id хэрэггүй,
   frontend нэг endpoint дууддаг, олон session-той өдрийг аюулгүй татгалзана.
2. Grid-д `session_id` нэмж id-аар засах: олон session-той өдөрт ойлгомжгүй, илүү grid
   өөрчлөлт. Татгалзсан.
3. `/sessions/manual`-ийг upsert болгох: today табын "зөвхөн үүсгэх" зан төлвийг чимээгүй
   өөрчилнө. Татгалзсан.

## Verification

- **Backend:** deploy → remote D1 дээр 3 кейс шалгах:
  - 0 session өдөрт upsert → шинэ мөр, хоцролт зөв.
  - 1 session өдөрт upsert → clock_in/clock_out шинэчлэгдсэн, хоцролт/hours дахин тооцсон,
    `edited_at` бичигдсэн.
  - 2+ session өдөрт upsert → 409.
- **UI:** хоосон мөрд нэмэх; нэг session-той мөрийг засах; олон session-той мөр анхааруулга
  + 409; refetch-ийн дараа grid шинэчлэгдсэн.

## Хязгаарлалт / out of scope

- 2+ session-той өдрийг inline засахгүй (нэг бүрчлэн өөр таб дээр).
- Excel export-ийн өөрчлөлт байхгүй (одоогийн `actual_in`-г л буцаана, засвар нь грид
  refetch хийгдэхэд тусгагдана).
