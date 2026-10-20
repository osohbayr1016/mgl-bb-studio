# Ирц — оффисын IP шалгалтыг асаах/унтраах toggle

**Огноо:** 2026-06-17
**Төрөл:** Feature (жижиг)

## Зорилго

Admin → Ирц tab-д **"Бүх төхөөрөмжөөс ирц бүртгэхийг зөвшөөрөх"** toggle нэмнэ. Идэвхжүүлбэл оффисын IP (wifi/сүлжээ) шалгалтыг **бүрэн алгасна** — ажилтан хаанаас ч (гэрээс, гар утаснаас, дурын сүлжээнээс) clock-in / clock-out / өдрийн checkpoint хийж чадна.

- **Хүрээ:** Global, тогтмол (нэг ерөнхий toggle, бүх ажилтанд). Асаах хүртэл хэвээр.
- **Хамрах цэг:** clock-in, clock-out, өдрийн checkpoint — 3 цэгт бүгдэд.
- **Default:** OFF = одоогийн зан төлөв (оффисын IP заавал шалгана). Хуучин суурилуулалт өөрчлөгдөхгүй.
- **Эрх:** Зөвхөн admin асаах/унтраах (office-IP удирдлагатай адил).

## Арга (сонгосон)

Одоо байгаа `app_settings` (key/value) хүснэгт + `/settings/attendance` GET/PUT загвар + `getAttendanceSettings()` -г дагана. Шинэ хүснэгт/endpoint/migration шаардлагагүй.

**Татгалзсан хувилбарууд:** (1) тусдаа хүснэгт/endpoint — илүүц; (2) `office_ips`-ийг бүгдийг идэвхгүй болгож "хоосон бол бүгд зөвшөөрнө" гэх далд логик — UI ойлгомжгүй, IP жагсаалтаа алдана.

## Setting

- Key: **`require_office_ip`** (`app_settings`), утга `'1'` (шалгана) / `'0'` (алгасна).
- **Default `true`** (key байхгүй/буруу бол). → хуучин зан төлөв хадгалагдана.
- Admin UI-ийн toggle "Бүх төхөөрөмж зөвшөөрөх" **ON ⇔ `require_office_ip='0'`** (буюу шалгалт унтарсан). UI-д эерэг утгаар (зөвшөөрөх) харуулна, дотооддоо `require_office_ip` хэлбэрээр хадгална.

## Өөрчлөх файлууд

### Backend

1. **`backend/src/lib/settings.ts`**
   - `AttendanceSettings`-д `requireOfficeIp: boolean` нэмнэ.
   - `ATTENDANCE_KEYS`-д `'require_office_ip'` нэмнэ.
   - Parse helper: `'0'` → `false`, бусад/байхгүй → `true` (default-аар шалгана).

2. **`backend/src/routes/attendance.ts`** — 3 enforcement цэг:
   - `clock-in` (одоо ~343): IP шалгалтын өмнө `getAttendanceSettings()` ачаалж (одоо ~444-д ачаалдаг — урагшлуулна), `if (settings.requireOfficeIp && !(await isOfficeIp(...)))` болгоно.
   - `clock-out` (~494) ба `checkpoint` (~686): settings ачаалж ижил нөхцөл нэмнэ.
   - `/my-status` (~618): хариунд **`require_office_ip: settings.requireOfficeIp`** нэмнэ. `on_office_ip` нь бодит IP таарцыг үнэнээр буцаасаар (өөрчлөхгүй).

3. **`backend/src/routes/settings.ts`**
   - `GET /attendance`: хариунд `require_office_ip` нэмнэ.
   - `PUT /attendance`: body-д `require_office_ip?: boolean` хүлээж авна; өгөгдсөн бол `upsertSetting('require_office_ip', val ? '1' : '0')`. Validation: boolean эсэхийг шалгана.

### Frontend

4. **`frontend/src/shared/types/index.ts`**
   - `AttendanceSettings`-д `require_office_ip: boolean` нэмнэ.
   - `AttendanceStatus`-д `require_office_ip: boolean` нэмнэ (my-status хариу).

5. **`frontend/src/features/attendance/AttendanceAdminPage.tsx`**
   - Office-IP/тохиргооны хэсэгт **Switch toggle** нэмнэ: "Бүх төхөөрөмжөөс ирц бүртгэхийг зөвшөөрөх (оффисын IP шалгахгүй)". Утга = `!attSettings.require_office_ip`.
   - Toggle өөрчлөгдөхөд `PUT /settings/attendance` -д `{ require_office_ip: <шинэ утга> }` илгээнэ (одоо байгаа `saveAttSettings` загвараар).
   - ON (шалгалт унтарсан) үед анхааруулга харуулна: "Оффисын IP шалгалт унтраалттай — хаанаас ч ирц бүртгэгдэнэ."

6. **`frontend/src/features/attendance/AttendancePage.tsx`** ба **`components/AttendanceWidget.tsx`**
   - my-status төрөлд `require_office_ip` нэмнэ.
   - Үр дүнгийн флаг: `const ipCheckOn = status?.require_office_ip !== false;` `const canClock = onOfficeIp || !ipCheckOn;`
   - Товч идэвхгүй болгох нөхцөлд `!onOfficeIp` → `!canClock` болгоно. `AttendanceProjectDialog`-д `onOfficeIp={canClock}` дамжуулна.
   - Мэдээллийн banner: `ipCheckOn === false` үед "IP шалгалт унтраалттай" гэсэн төвийг харуулна (одоогийн "оффисын сүлжээнд биш" анхааруулгын оронд).

### i18n

7. **`frontend/src/shared/i18n/en.json`** ба **`mn.json`** — toggle label, тайлбар, анхааруулгын шинэ key-үүд (хоёуланд).

## Migration

Шаардлагагүй — `app_settings` бэлэн; `require_office_ip` нь эхний бичилтэд upsert хийгдэнэ, унших үед байхгүй бол `true` (шалгана) болж буцна.

## Тест (гар аргаар — repo-д тест suite байхгүй)

1. Default: toggle OFF → оффисын бус IP-аас clock-in оролдоход 403 (одоогийн зан төлөв).
2. Toggle ON → дурын сүлжээнээс clock-in / clock-out / checkpoint бүгд амжилттай.
3. Toggle буцааж OFF → дахин 403.
4. Admin биш хэрэглэгч `PUT` дуудвал татгалзана (requireAdmin).
5. Ажилтны UI: ON үед товч идэвхтэй + "IP шалгалт унтраалттай" банер.

## Хамрах хүрээнээс гадуур (YAGNI)

- Түр зуурын/өдрийн auto-reset — хийхгүй (тогтмол toggle).
- Ажилтан тус бүрийн тохиргоо — хийхгүй.
- Audit log-ийн нэмэлт UI — `upsertSetting` аль хэдийн `updated_by` бичдэг; шинэ UI хийхгүй.
