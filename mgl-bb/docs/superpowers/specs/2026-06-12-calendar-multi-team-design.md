# Зард олон team сонгох (Calendar multi-team targeting)

**Огноо:** 2026-06-12
**Хамрах хүрээ:** Dashboard календарийн зар (`calendar_events`) бүрийг **хэд хэдэн team** руу зэрэг чиглүүлэх боломж.

## Асуудал / Зорилго

Одоо зар бүр **ганц** `calendar_events.team_id`-тэй (migration 0041):

- `null` = **Бүгдэд** (компани даяар бүх идэвхтэй хэрэглэгч харна)
- нэг тоо = зөвхөн тэр team-ийн гишүүд (+ бүх админ хяналтын үүднээс) харна

Админ зар нэмэхдээ нэг team эсвэл бүгдийг л сонгож чадна. Зорилго: **олон team-г нэг зард зэрэг** сонгох (жишээ нь HD + MEP багуудад зориулсан нэг зар). Энэ нь одоо байгаа "Олон өдөр" (`event_dates[]`) логиктой ижил санаа — нэг зард олон утга.

## Дата загвар

**Junction хүснэгт (M2M)** — репогийн `user_teams`, `project_team_shares` загвартай нийцнэ.

Шинэ хүснэгт:

```sql
CREATE TABLE calendar_event_teams (
  event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  team_id  INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, team_id)
);
CREATE INDEX idx_cal_event_teams_team ON calendar_event_teams(team_id);
```

**Семантик:**

- Зард холбоотой junction мөр **байхгүй** = Бүгдэд (хуучин `team_id IS NULL`-тэй ижил).
- 1+ мөр = тэдгээр team-үүд (+ админ) харна.

**Backfill** (нэг migration дотор):

```sql
INSERT OR IGNORE INTO calendar_event_teams (event_id, team_id)
SELECT id, team_id FROM calendar_events WHERE team_id IS NOT NULL;
```

`calendar_events.team_id` багана **үлдэнэ** (репогийн `model_xkt_url` / `accent_color` мэт dead-column конвенц). Уншилт/шүүлт зөвхөн junction-аас явна; бичих үед `team_id`-д хүрэхгүй.

## Backend (`backend/src/routes/calendar.ts`, `backend/src/types.ts`)

### Уншилт — `GET /events`, `GET /today`

`LEFT JOIN teams tm ON tm.id = e.team_id`-ийг junction дээрх correlated subquery-ээр солино:

```sql
(SELECT group_concat(tm.code) FROM calendar_event_teams et
   JOIN teams tm ON tm.id = et.team_id WHERE et.event_id = e.id) AS team_codes,
(SELECT group_concat(tm.id)   FROM calendar_event_teams et
   JOIN teams tm ON tm.id = et.team_id WHERE et.event_id = e.id) AS team_ids_csv,
(SELECT group_concat(tm.name_mn) FROM calendar_event_teams et
   JOIN teams tm ON tm.id = et.team_id WHERE et.event_id = e.id) AS team_names
```

`team_codes` / `team_ids_csv` / `team_names` нь comma-separated string эсвэл `null` (Бүгдэд). Хуучин нэг утгат `team_code` / `team_name` талбарыг АВЧ хаяна — frontend массивт шилжинэ. (Зөвхөн dashboard энэ payload-ийг хэрэглэдэг тул аюулгүй.)

### Visibility scope — `buildVisibilityScope`

Одоогийн `e.team_id IS NULL OR e.team_id IN (...)`-ийг EXISTS-ээр солино:

```sql
(
  NOT EXISTS (SELECT 1 FROM calendar_event_teams et WHERE et.event_id = e.id)
  OR EXISTS (SELECT 1 FROM calendar_event_teams et
             WHERE et.event_id = e.id AND et.team_id IN (<миний team-үүд>))
)
```

Админ үргэлж бүгдийг харна (хэвээр).

### Бичих — `POST /events`, `PUT /events/:id`

- Body: `team_ids?: number[]` хүлээж авна. Хоосон массив / омит = Бүгдэд (junction мөр бичихгүй).
- Бүх id-г `teams`-тэй тулгаж шалгана (одоогийн `resolveTeamId`-г массивт зориулж `resolveTeamIds` болгож өргөтгөнө; буруу/байхгүй id → 400/404).
- `POST`: event INSERT хийсний дараа junction мөрсийг batch-аар оруулна. Олон огноотой (`event_dates[]`) үед **огноо бүрийн** event-д ижил team set-ийг хуулна.
- `PUT`: `team_ids` ирвэл тухайн event-ийн junction мөрсийг бүгдийг устгаад дахин бичнэ (replace). `team_ids` омит бол хүрэхгүй.
- Back-compat: body-д хуучин `team_id` (ганц) ирвэл `[team_id]` мэт хүлээн авч болно (заавал биш — frontend `team_ids` руу шилжинэ).
- `INSERT INTO calendar_events`-аас `team_id` баганыг хасна (эсвэл үргэлж NULL бичнэ).

### Типүүд (`types.ts`)

- `CalendarEventRow`: `team_id` үлдээнэ (DB багана), нэмэх `team_codes: string | null`, `team_ids_csv: string | null`, `team_names: string | null`.
- `CreateCalendarEventRequest` / `UpdateCalendarEventRequest`: `team_ids?: number[]` нэмнэ. Хуучин `team_id?` үлдээнэ (back-compat).

## Frontend (`frontend/src/features/dashboard/DashboardPage.tsx`, `frontend/src/shared/types/index.ts`)

### Төрөл (`shared/types/index.ts` → `CalendarEvent`)

- `team_code` / `team_name`-г `team_codes: string | null` / `team_names: string | null` болгоно (эсвэл нэмж хадгална).
- Хэрэглэх газар: chip render-д `team_codes?.split(',')` ашиглана.

### State

- `formTeamId: number | null` → `formTeamIds: number[]` (хоосон = Бүгдэд).
- `startCreate`: `setFormTeamIds([])`.
- `startEdit`: event-ийн `team_ids_csv`-г `[]`-руу parse (`csv ? csv.split(',').map(Number) : []`).
- Multi-form нээх handler (line ~1380): `setFormTeamIds([])`.

### UI — Checkbox dropdown (2 газар: multi-date dialog ~1471, inline form ~1761)

Одоогийн `<Select>`-ийг `DropdownMenu` + `DropdownMenuCheckboxItem`-ээр сольсон жижиг туслах компонент `TeamMultiSelect`:

- Trigger: button. Хаяг: сонгосон team-гүй бол "Бүгдэд", 1-2 бол кодуудыг, 3+ бол "N team" гэж харуулна.
- Content: "Бүгдэд" checkbox item (бүх сонголтыг цэвэрлэнэ) + team бүрийн checkbox item.
- `onSelect`-д `e.preventDefault()` дуудаж dropdown-ийг нээлттэй үлдээж олон сонголт хийх боломжтой болгоно (radix default нь сонгоход хаадаг).
- `frontend/src/ui/dropdown-menu.tsx`-аас import.

### Мутаци (3 газар)

- `submit` (PUT + POST): `team_id: formTeamId` → `team_ids: formTeamIds`.
- Multi-date create (line ~1536): `team_id: formTeamId` → `team_ids: formTeamIds`.
- `#region agent log` блокуудад хүрэхгүй (өөр агентын debug код — CLAUDE.md).

### Зарын карт (chip render — 2 газар: ~842, ~1611)

- Ганц `event.team_code` chip → `event.team_codes?.split(',').map(...)` олон chip. `teamChipClass(code)` хэвээр.

## i18n

Шинэ string бараг хэрэггүй; `dashboardPage.allEmployees` ("Бүгдэд") хэвээр. Хэрэв "N team" товчлол хэрэгтэй бол `en.json` + `mn.json` хоёуланд нэмнэ.

## Хамрах хүрээнд ОРОХГҮЙ

- Өнгө / layout засвар.
- Multi-day логик (аль хэдийн ажиллаж байгаа).
- Notification (зар одоо ч notification илгээдэггүй).
- `calendar_events.team_id` баганыг устгах (dead column үлдэнэ).
- Өөр агентын `#region agent log` debug кодыг арилгах.

## Тест / баталгаажуулалт

- `cd backend && npx tsc -b` — зөвхөн calendar/types-тэй холбоотой алдаа байхгүйг шалгана (бусад агентын файлын алдааг тооцохгүй).
- `cd frontend && npm run build` — мөн адил.
- Гар тест: админаар зар нэмэх → 2 team сонгох → зөвхөн тэр 2 team-ийн гишүүд харж байгааг шалгах; засах үед сонголт зөв ачаалагдах; "Бүгдэд" руу буцаах.
