# Блокийн агуулгын override — Sub-project 1: суурь + cover (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Гүйцэтгэлийн тайлангийн `cover` блокийн автомат агуулгыг editor-д засварлах (override) боломжтой болгож, дахин ашиглах override-merge pattern-ийг end-to-end батлах.

**Architecture:** Блокийн `content_json`-д заавал бус `override` (render model-ийн partial) нэмнэ. Шинэ `blockContentResolve.ts` нь `resolveAuto`/`resolveModel`-ийг өгч, renderer ба editor хоёулаа ашиглана. Renderer override-ийг ил тод хэрэглэнэ; editor авто утгаар урьдчилан дүүргэж засна; "Авто руу буцаах" override-ийг цэвэрлэнэ. Backend schema өөрчлөхгүй (content opaque).

**Tech Stack:** React 19, TypeScript (strict, `noUncheckedIndexedAccess` backend-д), Vite, TanStack Query, Tailwind. **Тест suite БАЙХГҮЙ** — баталгаажуулалт = `npx tsc -b` (хүрсэн файлууд цэвэр) + `npm run lint` + `npm run dev` гар smoke. CLAUDE.md: тест зохиож болохгүй.

> **Spec:** `docs/superpowers/specs/2026-06-16-report-block-content-override-design.md`
> **Collision:** `BlockEditors.tsx` / `PdfBlockRenderer.tsx`-ийг нөгөө agent идэвхтэй засаж байна — surgical edit, буцаагдвал дахин тав. Шинэ логикийг шинэ файлд тусгаарлав (`blockContentResolve.ts`, `CoverOverrideEditor`).

---

## File Structure

- **Create** `frontend/src/features/performance-reports/lib/blockContentResolve.ts` — auto/override resolve давхарга (cover-оор эхэлнэ; sub-project бүр энд нэмнэ).
- **Modify** `frontend/src/features/performance-reports/types/performanceReportBlocks.ts` — `cover` content-д `override` нэмж, parse/default шинэчлэх.
- **Modify** `frontend/src/features/performance-reports/components/PdfBlockRenderer.tsx` — cover case-ийг `resolveCover` руу шилжүүлэх.
- **Modify** `frontend/src/features/performance-reports/components/blocks/BlockEditors.tsx` — cover-д `CoverOverrideEditor` нэмэх; `autoModel` дамжуулах.
- **Modify** `frontend/src/features/performance-reports/components/blocks/BlockListEditor.tsx` — `autoModelFor` callback-ийг BlockEditor руу дамжуулах.
- **Modify** `frontend/src/features/performance-reports/PerformanceReportEditorPage.tsx` — passport query нэмж, `autoModelFor` бүтээж BlockListEditor-д өгөх.
- **Modify** `frontend/src/shared/i18n/mn.json` + `en.json` — override editor түлхүүрүүд.

---

## Task 1: `cover` content-д override нэмэх

**Files:**
- Modify: `frontend/src/features/performance-reports/types/performanceReportBlocks.ts`

- [ ] **Step 1: `CoverOverride` тодорхойлж `BlockContentMap.cover`-ийг шинэчлэх**

`performanceReportBlocks.ts`-д `BLOCK_TYPES` доор нэмнэ:

```ts
/** Cover блокийн засварлагдах талбарууд (бүгд заавал бус — байхгүй талбар = авто). */
export interface CoverOverride {
  projectFullTitle?: string;
  clientName?: string;
  reportNo?: number;
  periodStart?: string;
  periodEnd?: string;
  drawingNo?: string;
}
```

`BlockContentMap`-ийн `cover` мөрийг солих:

```ts
  cover: { override?: CoverOverride | null };
```

- [ ] **Step 2: `BLOCK_DEFAULTS.cover` + parse шинэчлэх**

`BLOCK_DEFAULTS`-ийн cover-ийг солих:

```ts
  cover: { override: null },
```

`parseBlockContent`-ийн `switch`-д default-ийн өмнө case нэмэх:

```ts
    case 'cover': {
      const ov = r.override;
      const override =
        ov && typeof ov === 'object' ? (ov as CoverOverride) : null;
      return { override } as BlockContentMap[T];
    }
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b 2>&1 | grep -E "performanceReportBlocks|blockContentResolve|PdfBlockRenderer|BlockEditors|CoverPage" `
Expected: cover content шинэчлэлээс шалтгаалсан алдаа зөвхөн `PdfBlockRenderer.tsx` (cover case `block.content` ашигладаг)-д л гарч магадгүй — Task 3-д засна. Бусад хамааралгүй WIP алдаа орхино.

- [ ] **Step 4: Commit (зөвхөн энэ файл)**

```bash
git add frontend/src/features/performance-reports/types/performanceReportBlocks.ts
git commit -m "feat(perf-report): add cover block override content shape"
```

---

## Task 2: resolve давхарга — `blockContentResolve.ts` (cover)

**Files:**
- Create: `frontend/src/features/performance-reports/lib/blockContentResolve.ts`

- [ ] **Step 1: Файл үүсгэх**

```ts
import type { PdfBlockContext } from '@/features/performance-reports/components/PdfBlockRenderer';
import type { CoverOverride } from '@/features/performance-reports/types/performanceReportBlocks';

/* =============================================================
 * Блокийн render model-ийг авто (ctx-ээс) тооцоод override-ийг
 * түүн дээр талбараар нь давхарлана. Renderer ба editor хоёулаа
 * үүнийг ашиглаж нэг эх сурвалжтай байна.
 * ============================================================= */

/** Cover-ийн бүрэн render model (CoverPageProps-тэй ижил). */
export interface CoverModel {
  reportNo: number;
  periodStart: string;
  periodEnd: string;
  projectFullTitle: string | null;
  projectName: string;
  clientName: string | null;
  drawingNo: string | null;
}

/** Cover-ийн авто model-ийг PdfBlockContext-ээс гаргана
 *  (PdfBlockRenderer-ийн одоогийн cover mapping-тэй яг адил). */
export function resolveCoverAuto(ctx: PdfBlockContext): CoverModel {
  return {
    reportNo: ctx.report.report_no,
    periodStart: ctx.report.period_start,
    periodEnd: ctx.report.period_end,
    projectFullTitle: ctx.passport.full_title ?? ctx.project.project.name,
    projectName: ctx.project.project.name,
    clientName: ctx.project.clients?.[0]?.name ?? null,
    drawingNo: ctx.drawingNo,
  };
}

/** Хоосон/undefined талбарыг хасаж зөвхөн жинхэнэ override-уудыг үлдээнэ. */
function compactCoverOverride(ov: CoverOverride | null | undefined): Partial<CoverModel> {
  if (!ov) return {};
  const out: Partial<CoverModel> = {};
  if (ov.projectFullTitle != null && ov.projectFullTitle !== '')
    out.projectFullTitle = ov.projectFullTitle;
  if (ov.clientName != null && ov.clientName !== '') out.clientName = ov.clientName;
  if (typeof ov.reportNo === 'number' && Number.isFinite(ov.reportNo)) out.reportNo = ov.reportNo;
  if (ov.periodStart != null && ov.periodStart !== '') out.periodStart = ov.periodStart;
  if (ov.periodEnd != null && ov.periodEnd !== '') out.periodEnd = ov.periodEnd;
  if (ov.drawingNo != null && ov.drawingNo !== '') out.drawingNo = ov.drawingNo;
  return out;
}

/** Авто model дээр override-ийг талбараар нь давхарлана. */
export function resolveCover(ctx: PdfBlockContext, override: CoverOverride | null | undefined): CoverModel {
  return { ...resolveCoverAuto(ctx), ...compactCoverOverride(override) };
}

/** Editor-д: override-ийн аль талбар жинхэнэ override болсныг шалгана
 *  ("Өөрчилсөн" badge + reset). */
export function coverHasOverride(override: CoverOverride | null | undefined): boolean {
  return Object.keys(compactCoverOverride(override)).length > 0;
}

/** Аль ч блок override-той эсэх (жагсаалтын "Өөрчилсөн" badge-д).
 *  Sub-project бүр өөрийн төрлийг энд нэмнэ. */
export function blockHasOverride(block: { type: string; content: unknown }): boolean {
  if (block.type === 'cover') {
    const c = block.content as { override?: CoverOverride | null };
    return coverHasOverride(c.override);
  }
  return false;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b 2>&1 | grep "blockContentResolve"`
Expected: хоосон (алдаагүй).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/performance-reports/lib/blockContentResolve.ts
git commit -m "feat(perf-report): add block content resolve layer (cover)"
```

---

## Task 3: Renderer — cover case-ийг resolve руу шилжүүлэх

**Files:**
- Modify: `frontend/src/features/performance-reports/components/PdfBlockRenderer.tsx:97-106`

- [ ] **Step 1: Import нэмэх**

Файлын import блок (бусад `@/features/performance-reports/...` import-ийн хажууд):

```ts
import { resolveCover } from '@/features/performance-reports/lib/blockContentResolve';
import type { BlockContentMap } from '@/features/performance-reports/types/performanceReportBlocks';
```

(`BlockContentMap` аль хэдийн импортлогдсон бол давхар нэмэхгүй.)

- [ ] **Step 2: cover case-ийг солих**

Одоогийн (мөр ~97-106):

```ts
    case 'cover':
      return (
        <CoverPageFromReport
          report={ctx.report}
          projectName={ctx.project.project.name}
          fullTitle={ctx.passport.full_title ?? ctx.project.project.name}
          clientName={ctx.project.clients?.[0]?.name ?? null}
          drawingNo={ctx.drawingNo}
        />
      );
```

болгож солих:

```ts
    case 'cover': {
      const override = (block.content as BlockContentMap['cover']).override;
      const m = resolveCover(ctx, override);
      return (
        <CoverPage
          reportNo={m.reportNo}
          periodStart={m.periodStart}
          periodEnd={m.periodEnd}
          projectFullTitle={m.projectFullTitle}
          projectName={m.projectName}
          clientName={m.clientName}
          drawingNo={m.drawingNo}
        />
      );
    }
```

- [ ] **Step 3: Import-ийг тааруулах**

`CoverPage`-ийг import хийх (одоо зөвхөн `CoverPageFromReport` импортлогдсон бол):

```ts
import { CoverPage, CoverPageFromReport } from '@/features/performance-reports/components/CoverPage';
```

`CoverPageFromReport` өөр хаана ч ашиглагдахгүй бол үлдээж болно (CoverPage.tsx-д экспортлогдсон хэвээр) — устгахгүй (нөгөө agent ашиглаж магадгүй).

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b 2>&1 | grep "PdfBlockRenderer"`
Expected: хоосон.

- [ ] **Step 5: Гар smoke (preview)**

Run: `cd frontend && npm run dev` → тайлангийн editor нээх → cover preview-д төслийн нэр/харилцагч/тайлангийн дугаар хэвийн (авто) харагдахыг шалга (override хоосон тул өмнөхтэй адил).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/performance-reports/components/PdfBlockRenderer.tsx
git commit -m "feat(perf-report): render cover via resolveCover (override-aware)"
```

---

## Task 4: Editor page — passport query + autoModelFor

**Files:**
- Modify: `frontend/src/features/performance-reports/PerformanceReportEditorPage.tsx`

- [ ] **Step 1: passport query нэмэх**

`projectQuery` (мөр ~80-84) дараа нэмэх:

```ts
  const passportQuery = useApiQuery<{ passport: ProjectPassport }>(
    ['/projects', projectId, 'passport'] as const,
    `/projects/${projectId}/passport`,
    { enabled: Number.isFinite(projectId), retry: false },
  );
```

`ProjectPassport`-ийг import (`@/shared/types`-аас, аль хэдийн байгаа import-д нэмэх).

- [ ] **Step 2: `autoModelFor` callback бүтээх**

`blocks`/`report` тодорхойлсны дараа нэмэх:

```ts
  const projectData = projectQuery.data ?? null;
  const passportData = passportQuery.data?.passport ?? null;

  // Editor-д блокийн авто render model-ийг өгнө (override талбаруудыг
  // урьдчилан дүүргэх placeholder-д). Зөвхөн cover дэмжигдсэн (Sub-project 1).
  const autoModelFor = useCallback(
    (block: ReportBlock): unknown => {
      if (block.type === 'cover' && projectData && report) {
        const cover: CoverModel = {
          reportNo: report.report_no,
          periodStart: report.period_start,
          periodEnd: report.period_end,
          projectFullTitle: passportData?.full_title ?? projectData.project.name,
          projectName: projectData.project.name,
          clientName: projectData.clients?.[0]?.name ?? null,
          drawingNo: passportData?.drawing_no ?? null,
        };
        return cover;
      }
      return null;
    },
    [projectData, passportData, report],
  );
```

Import нэмэх:

```ts
import { useCallback } from 'react'; // (useMemo/useState-тэй нэг мөрөнд нэгтгэх)
import type { CoverModel } from '@/features/performance-reports/lib/blockContentResolve';
```

- [ ] **Step 3: BlockListEditor-д дамжуулах**

`<BlockListEditor ... />` (мөр ~589-596)-д prop нэмэх:

```tsx
              <BlockListEditor
                blocks={blocks}
                report={livePreviewReport}
                readOnly={readOnly}
                autoModelFor={autoModelFor}
                onReorder={handleReorder}
                onPatch={handlePatchBlock}
                onDelete={handleDeleteBlock}
              />
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b 2>&1 | grep "PerformanceReportEditorPage"`
Expected: `autoModelFor` BlockListEditor-д хараахан байхгүй тул prop алдаа — Task 5-д засна. `report` null байж болзошгүйг `&& report` хамгаалсан.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/performance-reports/PerformanceReportEditorPage.tsx
git commit -m "feat(perf-report): editor computes auto cover model for block editors"
```

---

## Task 5: BlockListEditor — autoModelFor-ийг дамжуулах

**Files:**
- Modify: `frontend/src/features/performance-reports/components/blocks/BlockListEditor.tsx`

- [ ] **Step 1: Prop нэмэх**

`BlockListEditorProps`-д (мөр ~40-47):

```ts
  /** Блокийн авто render model-ийг буцаана (override editor-д урьдчилан
   *  дүүргэх). Дэмжигдээгүй блокт `null`. */
  autoModelFor?: (block: ReportBlock) => unknown;
```

`BlockListEditor({ ... })` destructure-д `autoModelFor` нэмэх.

- [ ] **Step 2: SortableRow-д дамжуулах**

`<SortableRow ... />` (map дотор) prop нэмэх:

```tsx
              autoModel={autoModelFor?.(b) ?? null}
```

`SortableRow`-ийн props type-д нэмэх:

```ts
  autoModel: unknown;
```

destructure-д `autoModel` нэмэх.

- [ ] **Step 3: BlockEditor-д дамжуулах**

`<BlockEditor ... />` (мөр ~205-215)-д prop нэмэх:

```tsx
            <BlockEditor
              type={block.type as BlockType}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content={block.content as any}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              autoModel={autoModel as any}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={(next: any) => {
                if (readOnly) return;
                void onPatch({ content: next });
              }}
              report={report}
            />
```

- [ ] **Step 4: "Өөрчилсөн" badge нэмэх (SortableRow)**

Import нэмэх:

```ts
import { blockHasOverride } from '@/features/performance-reports/lib/blockContentResolve';
```

`SortableRow`-д `{block.hidden && (...)}` badge-ийн хажууд (мөр ~170-172) нэмэх:

```tsx
        {blockHasOverride(block) && (
          <span className="text-[10px] uppercase tracking-wide text-primary">
            {t('blockListEditor.overridden')}
          </span>
        )}
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc -b 2>&1 | grep "BlockListEditor"`
Expected: `BlockEditor`-д `autoModel` prop хараахан байхгүй тул алдаа — Task 6-д засна.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/performance-reports/components/blocks/BlockListEditor.tsx
git commit -m "feat(perf-report): thread autoModel + overridden badge in block list"
```

---

## Task 6: CoverOverrideEditor — BlockEditors.tsx

**Files:**
- Modify: `frontend/src/features/performance-reports/components/blocks/BlockEditors.tsx`

- [ ] **Step 1: `BlockEditorProps`-д `autoModel` нэмэх**

`BlockEditorProps<T>` (мөр ~23-29)-д:

```ts
  /** Блокийн авто render model (editor page-аас). Override талбаруудыг
   *  урьдчилан дүүргэх/placeholder-д ашиглана. Дэмжигдээгүй блокт null. */
  autoModel: unknown;
```

`BlockEditor`-ийн дотор `autoModel`-ийг хүлээж аваад cover case руу дамжуулна.

- [ ] **Step 2: cover case-ийг солих**

`switch (type)`-д `cover`-ийг `NoParamsMessage`-аас салгаж тусдаа болгох. Одоогийн:

```ts
    case 'cover':
    case 'toc':
    case 'project-intro':
    case 'all-team-stats':
      return <NoParamsMessage type={type} />;
```

болгох:

```ts
    case 'cover':
      return (
        <CoverOverrideEditor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content={content as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onChange={onChange as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          autoModel={autoModel as any}
        />
      );
    case 'toc':
    case 'project-intro':
    case 'all-team-stats':
      return <NoParamsMessage type={type} />;
```

- [ ] **Step 3: `CoverOverrideEditor` компонент нэмэх**

Файлын доор нэмэх:

```tsx
function CoverOverrideEditor({
  content,
  onChange,
  autoModel,
}: {
  content: { override?: CoverOverride | null };
  onChange: (next: { override?: CoverOverride | null }) => void;
  autoModel: CoverModel | null;
}) {
  const { t } = useLanguage();
  const ov = content.override ?? {};
  const auto = autoModel;

  const setField = (key: keyof CoverOverride, value: string) => {
    const nextOv: CoverOverride = { ...ov };
    if (value === '') delete nextOv[key];
    else if (key === 'reportNo') {
      const n = Number(value);
      if (Number.isFinite(n)) nextOv.reportNo = n;
      else delete nextOv.reportNo;
    } else {
      // @ts-expect-error string талбарууд
      nextOv[key] = value;
    }
    const hasAny = Object.keys(nextOv).length > 0;
    onChange({ override: hasAny ? nextOv : null });
  };

  const dirty = Object.keys(ov).length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t('blockEditors.overrideHint')}</p>
        {dirty && (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => onChange({ override: null })}
          >
            {t('blockEditors.resetToAuto')}
          </button>
        )}
      </div>
      <OverrideField
        label={t('blockEditors.coverFullTitle')}
        value={ov.projectFullTitle ?? ''}
        placeholder={auto?.projectFullTitle ?? ''}
        onChange={(v) => setField('projectFullTitle', v)}
      />
      <OverrideField
        label={t('blockEditors.coverClientName')}
        value={ov.clientName ?? ''}
        placeholder={auto?.clientName ?? ''}
        onChange={(v) => setField('clientName', v)}
      />
      <OverrideField
        label={t('blockEditors.coverDrawingNo')}
        value={ov.drawingNo ?? ''}
        placeholder={auto?.drawingNo ?? ''}
        onChange={(v) => setField('drawingNo', v)}
      />
      <OverrideField
        label={t('blockEditors.coverReportNo')}
        value={ov.reportNo != null ? String(ov.reportNo) : ''}
        placeholder={auto ? String(auto.reportNo) : ''}
        onChange={(v) => setField('reportNo', v)}
      />
    </div>
  );
}

/** Нэг override талбар: label + input. Placeholder нь авто утга. */
function OverrideField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
```

- [ ] **Step 4: Import нэмэх**

`BlockEditors.tsx`-ийн import-д:

```ts
import type {
  CoverOverride,
} from '@/features/performance-reports/types/performanceReportBlocks';
import type { CoverModel } from '@/features/performance-reports/lib/blockContentResolve';
```

(`BlockType`/`BlockContentMap` аль хэдийн импортлогдсон.)

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc -b 2>&1 | grep -E "BlockEditors|BlockListEditor|PerformanceReportEditorPage"`
Expected: хоосон (Task 4–6-ийн гинж бүрэн холбогдсон).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/performance-reports/components/blocks/BlockEditors.tsx
git commit -m "feat(perf-report): cover override editor (auto-prefilled fields)"
```

---

## Task 7: i18n түлхүүрүүд

**Files:**
- Modify: `frontend/src/shared/i18n/mn.json`
- Modify: `frontend/src/shared/i18n/en.json`

- [ ] **Step 1: mn.json-д нэмэх (`blockEditors.*` бүлгийн хажууд)**

```json
  "blockEditors.overrideHint": "Талбарыг засвал тайланд тэр утга харагдана. Хоосон үлдээвэл автоматаар.",
  "blockEditors.resetToAuto": "Авто руу буцаах",
  "blockEditors.coverFullTitle": "Төслийн бүтэн нэр",
  "blockEditors.coverClientName": "Захиалагчийн нэр",
  "blockEditors.coverDrawingNo": "Doc. No.",
  "blockEditors.coverReportNo": "Тайлангийн дугаар",
  "blockListEditor.overridden": "Өөрчилсөн",
```

- [ ] **Step 2: en.json-д нэмэх (ижил түлхүүр)**

```json
  "blockEditors.overrideHint": "Edit a field to show that value in the report. Leave empty for automatic.",
  "blockEditors.resetToAuto": "Reset to auto",
  "blockEditors.coverFullTitle": "Project full title",
  "blockEditors.coverClientName": "Client name",
  "blockEditors.coverDrawingNo": "Doc. No.",
  "blockEditors.coverReportNo": "Report number",
  "blockListEditor.overridden": "Edited",
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shared/i18n/mn.json frontend/src/shared/i18n/en.json
git commit -m "i18n(perf-report): cover override editor keys"
```

---

## Task 8: End-to-end баталгаажуулалт

- [ ] **Step 1: Typecheck (хүрсэн файлууд)**

Run: `cd frontend && npx tsc -b 2>&1 | grep -E "performanceReportBlocks|blockContentResolve|PdfBlockRenderer|BlockEditors|BlockListEditor|PerformanceReportEditorPage|CoverPage|i18n"`
Expected: хоосон. (Хамааралгүй WIP алдаа орхино — CLAUDE.md.)

- [ ] **Step 2: Lint (хүрсэн файлууд)**

Run: `cd frontend && npx eslint src/features/performance-reports/lib/blockContentResolve.ts src/features/performance-reports/components/blocks/BlockEditors.tsx src/features/performance-reports/components/blocks/BlockListEditor.tsx src/features/performance-reports/components/PdfBlockRenderer.tsx`
Expected: шинэ алдаагүй (одоо байгаа baseline advisory-ос бусад).

- [ ] **Step 3: Гар smoke**

Run: `cd frontend && npm run dev`
1. Draft тайлангийн editor нээх.
2. `Нүүр хуудас` блокийг expand → 4 талбар авто утгаар (placeholder) гарч ирэхийг шалга.
3. "Төслийн бүтэн нэр"-д текст бич → preview-ийн cover тэр текстийг харуулахыг шалга.
4. "Өөрчилсөн" төлөв (reset товч гарч ирэх) → "Авто руу буцаах" дарж авто руу буцахыг шалга.
5. Хуудас refresh → override үлдсэнийг (PATCH хадгалагдсан) шалга.
6. Issued report → readOnly (засагдахгүй) шалга.
7. Эх дата шалгах: төслийн passport.full_title өөрчлөгдөөгүй (override нь зөвхөн тайлангийн блокт).

- [ ] **Step 4: Эцсийн commit (хэрэв засвар үлдсэн бол)**

```bash
git add -p   # зөвхөн энэ feature-ийн өөрчлөлт — WIP сэвэхгүй
git commit -m "feat(perf-report): cover content override end-to-end"
```

---

## Дараагийн sub-project-ууд (тусдаа plan)

Энэ pattern (override type → resolve → renderer → editor + autoModelFor → i18n) дагана:
2. **project-intro + execution-summary** — бүтэцтэй текст талбарууд.
3. **team-narrative** — 5 асуулт + 7 дисциплин Document текст override.
4. **team-stats + all-team-stats** — засварлагдах grid (тооцоолсон мөрүүд).
5. **toc** — гарчгийн override (сонголтоор).
