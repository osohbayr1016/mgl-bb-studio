# Багийн "Тайлан" — даалгавруудыг задлах + захидал харилцаа нэмэх

**Огноо:** 2026-06-19
**Төлөв:** Батлагдсан (дизайн)

## 1. Зорилго

Багийн client-facing **"Тайлан"**-д хоёр зүйл нэмэх:

1. Одоо зөвхөн зургийн бүрдэл (component) түвшинд харагддаг **"Зургийн бүрдэл / Ажил"** хүснэгтэд даалгавар бүрийг биелэлттэйгээр нь задлан харуулах.
2. Тухайн төсөлд холбогдсон **захидал харилцаа (имэйл)**-г товч хүснэгтээр тайланд нэмэх.

## 2. Хамрах хүрээ

Зорилтот гадаргуу нь **багийн "Тайлан"** (client presentation):

- `frontend/src/features/projects/TeamReportPrintPage.tsx` — `?mode=client` үед server-side Browser Rendering-ээр PDF болон `window.print()`-ээр хэвлэгддэг standalone route.
- `frontend/src/features/projects/team-reports/TeamReportShell.tsx` — дэлгэцийн дотор "Тайлан" drawer (`viewMode === 'report'`) preview.

Энэ хоёр ижил дараалал (`renderDocumentFor` болон shell-ийн report drawer)-ыг хуваалцдаг тул өөрчлөлтийг хоёуланд нийцүүлж оруулна.

**Хамрах хүрээнд ОРОХГҮЙ:** `backend/src/lib/clientReportHtml.ts` (WeasyPrint "Гүйцэтгэлийн тайлан" PDF) — энэ нь тусдаа server-side тайлан бөгөөд энэ ажилд хамаарахгүй (хэрэглэгч багийн "Тайлан"-г сонгосон).

## 3. Өөрчлөлт 1 — Даалгаврыг задлах (TeamComponentStatsPanel)

Файл: `frontend/src/features/projects/team-reports/TeamComponentStatsPanel.tsx`

### Одоогийн байдал
- `buildRows` нь бүрдлийг (component) нэрээр нь нэгтгэж, даалгавруудыг `row.tasks`-д цуглуулдаг боловч `ComponentBlock` нь зөвхөн бүрдлийн толгой мөр + "· N ажил" тоог л рендерлэдэг (тусгайлан ингэж шийдсэн — мөр 101-103).

### Шинэ зан төлөв
- Бүрдэл бүрийн толгой мөрийн **доор даалгавар бүрийг тусдаа мөр** болгож рендерлэнэ. Бүрдэл нь бүлгийн толгой хэвээр үлдэнэ (одоогийн navy-tinted загвар).
- Даалгаврын мөр баганууд нь хүснэгтийн 3 баганад тааруулна: **нэр** (догол мөртэй) · **Жин** · **Биелэлт** (`ProgressCell` дахин ашиглана).
- "· N ажил" тоог толгой мөрөнд хэвээр үлдээж болно (эсвэл задарсан тул хасч болно — задлахад илүүдэхгүй бол үлдээнэ).

### Жингийн хуваарилалт (даалгаврын Жин багана)
Даалгаврын Жин нь **бүрдлийн нормчлогдсон жинг** (буюу хүснэгтийн 100%-д тооцсон бүрдлийн хувь) даалгавруудад **түүхий жингийн харьцаагаар** хуваарилсан утга байна:

```
task.displayWeight = component.normalizedWeight × (task.rawWeight / Σ component-ийн task.rawWeight)
```

Үр дүнд:
- Бүрдэл бүрийн даалгаврын жингийн нийлбэр = тухайн бүрдлийн жин.
- Бүх даалгаврын жингийн нийлбэр = 100% (хүснэгтийн нийт).

**Захын тохиолдол:** бүрдлийн бүх даалгаврын түүхий жин 0 бол тухайн бүрдлийн жинг даалгаврууд дунд тэнцүү хуваана (бүх тэг харагдахаас сэргийлнэ — `buildRows`-ийн одоогийн fallback-тай ижил зарчим).

### Стиль
- Шинэ CSS класс `team-stats-doc__row--task`: догол мөртэй нэр, цайвар дэвсгэргүй, бага хэмжээтэй фонт; биелэлтийн bar хэвээр.
- `TEAM_STATS_DOC_STYLES`-д нэмэгдэнэ (print хуудас аль хэдийн энэ string-ийг inject хийдэг тул нэмэлт холболт шаардлагагүй).

## 4. Өөрчлөлт 2 — Захидал харилцааны панель (шинэ)

Шинэ файл: `frontend/src/features/projects/team-reports/ProjectCorrespondencePanel.tsx`

### Өгөгдөл
- `GET /correspondence/projects/{projectId}` дуудна (`useApiQuery`, TeamComponentStatsPanel-ийн self-fetch загвартай ижил).
- Хариу: `{ entries: CorrespondenceEntry[]; can_write: boolean }`. `can_write` энд хэрэггүй (зөвхөн харах).
- `CorrespondenceEntry` төрөл нь `@/shared/types`-д бэлэн (log_date, direction, subject, doc_type, ref_no, from_email, to_email …).

### Рендер
- Гарчиг: **"ЗАХИДАЛ ХАРИЛЦАА"** (TeamComponentStatsPanel-ийн "ЯВЦЫН ТОЙМ"-той ижил document title загвар).
- **Товч хүснэгт**, багануудтай:
  - **№** — дугаар.
  - **Огноо** — `log_date` (YYYY.MM.DD).
  - **Чиглэл** — `sent` → "Илгээсэн", `received` → "Хүлээн авсан".
  - **Төрөл** — `doc_type` → RFI / CR / OL / MR (CorrespondenceLogTab-ийн `DOC_TYPE_SHORT` mapping-тэй ижил); null бол "—".
  - **Дугаар** — `ref_no` эсвэл "—".
  - **Гарчиг** — `subject`.
  - **Илгээгч→Хүлээн авагч** — `from_email` → `to_email` (богино, нэг мөр).
- Биеийн текст (`body`), CC, хавсралт **харуулахгүй** (хэрэглэгч "товч хүснэгт" сонгосон).
- Захидал байхгүй бол панель `null` буцаана (тайланд хоосон хэсэг нэмэхгүй).
- Уншиж байх/алдааны үед TeamComponentStatsPanel-тэй ижил placeholder загвар.

### Стиль
- `PROJECT_CORRESPONDENCE_DOC_STYLES` экспортлоно (#0F243E navy толгой, тоонуудад tabular-nums, print color-adjust). Print хуудас болон shell preview энэ string-ийг inject хийнэ.
- Текст нь **шууд монгол** (i18n-гүй) — TeamComponentStatsPanel-ийн print document зарчимтай нийцүүлж.

## 5. Тайлан дахь байрлал

`TeamReportPrintPage.tsx` болон `TeamReportShell.tsx`-ийн client/report дараалал:

```
teamDoc (narrative)
  → TeamComponentStatsPanel   (одоо даалгавартай)
  → StatusQuestionsDocument
  → ProjectCorrespondencePanel  (ШИНЭ — хамгийн сүүлд, хавсралт мэт)
```

Захидлын хэсэг нь нэмэлт/хавсралт шинж чанартай тул **хамгийн сүүлд** байрлана (батлагдсан).

## 6. Өөрчлөгдөх файлууд

| Файл | Өөрчлөлт |
|---|---|
| `frontend/src/features/projects/team-reports/TeamComponentStatsPanel.tsx` | Даалгаврын мөр рендер + жингийн хуваарилалт + `--task` CSS |
| `frontend/src/features/projects/team-reports/ProjectCorrespondencePanel.tsx` | **ШИНЭ** — захидлын товч хүснэгт + `PROJECT_CORRESPONDENCE_DOC_STYLES` |
| `frontend/src/features/projects/TeamReportPrintPage.tsx` | client mode-д панель нэмэх; styleTag-д шинэ style нэмэх |
| `frontend/src/features/projects/team-reports/TeamReportShell.tsx` | "Тайлан" drawer-т панель нэмэх; preview styles-д шинэ style нэмэх |

## 7. Эрх ба аюулгүй байдал

- `GET /correspondence/projects/:id` нь admin эсвэл project member-т нээлттэй; client read-only. Багийн "Тайлан"-г staff үүсгэдэг/PDF татдаг бөгөөд server-side render нь хүсэлт гаргагч staff-ийн богино настай `?t=<jwt>` token-оор баталгаажих тул эрх хангагдана.
- Захидлын ledger нь аль хэдийн client-уудад read-only нээлттэй (CorrespondenceLogTab) тул client-facing тайланд харуулах нь нийцтэй.

## 8. Эрсдэл / анхаарах

- **PDF cold render-ийн цаг хугацаа:** server-side Browser Rendering нь cache хүйтэн орчинд шинэ панелийн `/correspondence/...` fetch-ийг `body[data-print-ready="true"]` тогтохоос өмнө амжуулах ёстой. TeamComponentStatsPanel яг ийм self-fetch загвараар одоо ажиллаж байгаа тул мөн адил аргыг баримтлана; print хуудсанд аль хэдийн `document.fonts.ready` + 3×rAF + 18 сек fallback хамгаалалт бий. Хэрэгжүүлэх дараа PDF-ийн гаралтыг бодитоор шалгаж, шинэ хэсэг бүрэн рендерлэгдсэнийг баталгаажуулна (хэрэв уралдаан илэрвэл fetch-ийг print хуудаст өргөж prop-оор дамжуулна).
- **Багуудын хооронд давхардал:** захидал нь төслийн хэмжээнд тул багийн тайлан бүрд давхардаж харагдана — энэ нь хэрэглэгчийн зөвшөөрсөн зан төлөв (багийн "Тайлан"-г сонгосон).

## 9. Тест

Энэ repo-д тест suite байхгүй. Баталгаажуулалт:
- `npm run build` (frontend) — `tsc -b` + vite (shared type өөрчлөлт байхгүй тул кэшийн асуудал бага, шаардвал `tsc -b --force`).
- Дэлгэцийн "Тайлан" preview-д даалгавар задарсан, захидлын хэсэг гарч ирснийг нүдээр шалгах.
- Багийн PDF татаж (эсвэл `?mode=client` print preview) шинэ хэсгүүд бүрэн рендерлэгдсэнийг шалгах.
