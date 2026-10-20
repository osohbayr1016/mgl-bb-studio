# Гүйцэтгэлийн тайлан — блокийн агуулгын override (бүх автомат блок засварлагдах)

**Огноо:** 2026-06-16
**Статус:** Design approved, spec review хүлээж байна

## Context (яагаад)

Гүйцэтгэлийн тайлан (`frontend/src/features/performance-reports/`) нь блокуудаас бүрддэг. Блок бүр `PdfBlockRenderer.tsx`-ээр тусдаа render компонент руу dispatch хийгдэж, контентоо `ctx`-ээс (project, passport, documents, teamReports, effectiveTeams…) **автоматаар** татдаг. Одоогийн editor (`BlockEditors.tsx`):

- `cover` / `toc` / `project-intro` / `all-team-stats` / `execution-summary` → `NoParamsMessage` (засваргүй — "тохиргоо шаардахгүй, өгөгдлөөс автомат")
- `team-narrative` / `team-stats` → `TeamSelectEditor` (зөвхөн **баг сонгоно**, контентыг засдаггүй)
- `rich-text` → heading + body (засварлагддаг)
- `divider` → style

**Хэрэгцээ:** хэрэглэгч тайлангийн **бүх автомат блокийн агуулгыг** (текст ба тооцоолсон хүснэгт хоёуланг) тайлан дотор шууд засварлах боломжтой байх. Жишээ: "Багийн тайлбар бичиг"-ийн 5 асуултын хариу/дисциплин текст, project-intro-ийн талбарууд, team-stats-ийн биелэлтийн мөрүүд.

**Шийдэгдсэн сонголтууд (хэрэглэгчтэй брейнсторм):**
- Хандлага: **per-block override** (snapshot биш — авто+override merge), report-scoped. Эх дата (status report, project passport, project data) **хөндөгдөхгүй**.
- Хамрах хүрээ: **бүх автомат блок, тооцоолсон хүснэгт ороод**.
- Цаг: **одоо** хийнэ (нөгөө agent block архитектурыг идэвхтэй өөрчилж байгаа collision-ийг хэрэглэгч хүлээн зөвшөөрсөн — surgical ажиллана).

## Хүлээгдэх үр дүн

Editor-д блок бүрийг expand хийхэд автомат агуулга нь **засварлагдах талбар хэлбэрээр** (авто утгаар урьдчилан дүүргэсэн) гарч ирнэ. Засвал тухайн тайлангийн тэр блок дээр л override хадгалагдаж, preview/PDF түүнийг рендерлэнэ. "Авто руу буцаах" нь override-ийг цэвэрлэж эх автомат утга руу буцаана. Эх дата хэзээ ч өөрчлөгдөхгүй.

## Архитектур

### 1. Дата модель — backend schema өөрчлөхгүй

`content_json` нь backend дээр **opaque** (routes блокийн content-ийг задлахгүй хадгалдаг). Тиймээс migration хэрэггүй. Автомат блок бүрийн content-д заавал бус `override` талбар нэмнэ:

```ts
// performanceReportBlocks.ts — BlockContentMap өргөтгөл
'cover': { override?: CoverOverride | null };
'project-intro': { override?: ProjectIntroOverride | null };
'team-narrative': { team_code: string; override?: TeamNarrativeOverride | null };
'team-stats': { team_code: string; override?: TeamStatsOverride | null };
'all-team-stats': { override?: AllTeamStatsOverride | null };
'execution-summary': { override?: ExecutionSummaryOverride | null };
'toc': { override?: TocOverride | null };  // сонголтоор (гарчгууд)
```

`*Override` бүр нь тухайн блокийн **render model-ийн `Partial`** — зөвхөн хэрэглэгчийн өөрчилсөн талбар хадгалагдана. Байхгүй / `null` = цэвэр авто. `parseBlockContent()` болон `BLOCK_DEFAULTS`-ийг override-ийг хадгалж унших (default `null`) болгож шинэчилнэ.

### 2. Shared resolve давхарга — шинэ `blockContentResolve.ts`

Render компонент дотор тархсан "ctx-ээс контент тооцох" логикийг нэг модуль руу гаргаж, editor ба renderer **хоёулаа** ашиглах нэг эх сурвалж болгоно. Блокийн төрөл бүрт:

```ts
// auto render model-ийг ctx-ээс гаргана
resolveAuto(type, ctx): RenderModel<type>
// авто дээр override-ийг талбараар нь merge хийнэ (nested-д deep-merge)
resolveModel(type, ctx, override): RenderModel<type> = deepMerge(resolveAuto(type, ctx), override)
```

`RenderModel<type>` нь блокийн рендерт хэрэгтэй бүрэн, хавтгайруулсан бүтэц (доорх "Блок бүрийн override shape"-ийг үз).

### 3. Render тал — компонентуудыг refactor

`PdfBlockRenderer.renderByType` блок бүрт `resolveModel(block.type, ctx, block.content.override)`-ийг дуудаж, **бэлэн model**-ийг render компонентод дамжуулна (одоо компонент дотроо ctx-ээс тооцдогийг орлоно). Override ингэснээр ил тод хэрэгжинэ; `BlockErrorBoundary` хэвээр.

- `CoverPageFromReport`, `ProjectIntroPage`, `TeamSectionPage` (+ teamNarrativeParts), `TeamComponentStatsPanel`, `ProgressSummarySection`, `ExecutionSummaryPage`, `TableOfContents` — бүгд `RenderModel` хүлээж авдаг болгож refactor (props-оо `ctx`-ийн салангид утгуудаас → нэг resolved model болгох).

### 4. Editor тал — `BlockEditors.tsx`

`NoParamsMessage` / `TeamSelectEditor`-ийг **override-aware editor**-оор солино. Editor нь:

1. `resolveModel(type, report→ctx, content.override)`-оор авто+override model тооцоод талбаруудыг **урьдчилан дүүргэнэ**.
2. Хэрэглэгч талбар өөрчлөхөд авто утгатай харьцуулж **зөвхөн өөрчилсөн талбарыг** `override`-д бичээд `onChange({ ...content, override })` дуудна (minimal diff).
3. Талбарын төрлүүд: текст → `Input`/`Textarea`; тооцоолсон хүснэгт (team-stats / all-team-stats мөрүүд) → засварлагдах **grid** (мөр/багана). `team_code` нь config хэвээр (override-аас тусдаа).

Editor дотор editor хэрэгтэй context (passport, teamReports г.м.) нь editor page-аас аль хэдийн дамждаг `report` + шаардлагатай бол нэмэлт ctx-ийг editor-руу дамжуулна.

### 5. Reset to auto

Талбарын бүлэг бүрт **"Авто руу буцаах"** товч — тухайн бүлгийн override талбаруудыг устгана (бүгд уствал `override = null`). Renderer дахин цэвэр авто рүү буцна.

### 6. UX

- Override-той блок: жагсаалтын мөрөнд **"Өөрчилсөн"** badge.
- Editor доторх override-той талбар: жижиг тэмдэглэгээ + талбарын reset.
- readOnly горимд (issued report) override харагдана, гэхдээ засагдахгүй.

## Блок бүрийн override shape (RenderModel-ийн partial)

| Блок | RenderModel (авто) | Override талбарууд |
|---|---|---|
| `cover` | fullTitle, clientName, reportNo, reportDate, docNo, projectName | fullTitle, clientName, reportNo, reportDate, docNo (текст) |
| `toc` | section гарчгуудын жагсаалт | гарчгийн текст override (сонголтоор) |
| `project-intro` | generalInfo талбарууд, clients, documents, scope rows, timeline/meetings | бүх текст талбар + scope/timeline мөрүүд |
| `team-narrative` | багийн `answers` (5 асуулт + дисциплин), index, team нэр | асуулт бүрийн хариу текст + дисциплин текстүүд |
| `team-stats` | TeamComponentStatsPanel-ийн биелэлтийн мөрүүд (live тооцоо) | мөр бүрийн утга (grid) |
| `all-team-stats` | бүх багийн progress мөрүүд (team_progress) | мөр бүрийн утга (grid) |
| `execution-summary` | passport key мэдээлэл, progress, timeline, meetings | текст/тоон талбарууд |

> Тэмдэглэл: тооцоолсон хүснэгтийн override нь зөвхөн **харагдах утгыг** дарж бичнэ (тайлангийн агшны зураг), эх тооцоог өөрчлөхгүй.

## Backend

- **Schema/migration байхгүй** — `content_json` opaque, override түүн дотор JSON-оор хадгалагдана.
- `routes/performance-reports.ts`-ийн блок PATCH (content) endpoint аль хэдийн content-ийг бүхэлд нь хадгалдаг — өөрчлөлт шаардахгүй (баталгаажуулна).

## Хэрэгжүүлэлтийн дараалал (sub-project болгон)

Бүгдийг ижил override-merge pattern дагана; эхнийх pattern-ийг батална:

1. **Суурь + cover** — `override` дата модель, `blockContentResolve.ts`, cover-ийн resolve/render/editor/reset-ийг end-to-end. Pattern батлагдана.
2. **project-intro + execution-summary** — бүтэцтэй текст талбарууд.
3. **team-narrative** — 5 асуулт + 7 дисциплин Document-ийн текст override.
4. **team-stats + all-team-stats** — засварлагдах grid (тооцоолсон мөрүүд).
5. **toc** — гарчгийн override (сонголтоор, хамгийн сүүлд).

## Collision / эрсдэл

- Нөгөө agent `BlockListEditor.tsx` / `BlockEditors.tsx` / блок моделийг идэвхтэй өөрчилж байна ("+ Блок" устгасан, default template өөрчилсөн г.м.). Override нь content_json-д **нэмэлт** тул block моделийг эвдэхгүй; гэхдээ render refactor + editor өөрчлөлт тэдгээр файлд хүрнэ.
- **Surgical** ажиллана: локал өөрчлөлт, буцаагдвал дахин тавина. Шинэ логикийг боломжийн хэрээр **шинэ файлд** (`blockContentResolve.ts`, override editor компонентууд) тусгаарлаж, одоо байгаа файлд хүрэх гадаргууг багасгана.
- Эх дата хөндөхгүй (status report, passport, project) — зөвхөн тайлангийн блок content_json.

## Verification

- Тест suite байхгүй → `tsc -b` (хүрсэн файлууд цэвэр), `npm run lint`.
- Гар smoke (`npm run dev`): блок expand → авто талбар дүүрсэн харагдана → засна → preview override-ийг харуулна → "Авто руу буцаах" → авто руу буцна. Issued report-д readOnly. Эх status report/passport өөрчлөгдөөгүйг шалгана.
- Per block: override хадгалагдаж, дахин ачаалахад үлдэж, PDF render-д тусгагдсаныг шалгана.

## Out of scope

- Эх дата (team status reports, project passport) засварлах.
- Блокийн дараалал/нэмэх/устгах механизм (нөгөө agent эзэмшиж байгаа).
- Rich-text / divider (аль хэдийн засагддаг).
