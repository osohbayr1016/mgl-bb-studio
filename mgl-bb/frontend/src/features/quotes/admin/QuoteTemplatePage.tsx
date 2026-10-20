/**
 * Үнийн саналын ЗАГВАР — админ хуудас (`/app/admin/quotes/template`).
 *
 * Загвар нь ердийн `WorkbookDoc` (олон хуудаст) тул засварлагч нь үнийн саналын
 * редактортой ЯГ ижил цөмөөр ажиллана: `SheetToolbar` + `SheetGrid` +
 * `SheetTabs` + `useQuoteWorkbook`. Өөрөөр хэлбэл админ загварыг Excel шигээ
 * бөглөж, томьёо (`TARIF`, `USGEER`) болон anchor-уудыг нь урьдчилан тавьдаг —
 * санал үүсэхэд яг энэ дэвтэр хуулагдана.
 *
 * ХАДГАЛАЛТ НЬ ГАРААР (autosave БИШ). Учир нь `PUT /api/quotes/templates/:id`
 * бүр `quote_template_history`-д хуулбар үлдээж `version`-ийг нэмдэг — 2.5
 * секунд тутам autosave хийвэл түүх хог болно. Загвар ховор засагддаг тул
 * гараар хадгалах нь илүү зөв.
 *
 * Хадгалсны дараа `version` нэмэгддэг тул доорх `<TemplateEditor>`-ийн `key`
 * өөрчлөгдөж, засварлагч ШИНЭ өгөгдлөөр дахин холбогдоно (dirty төлөв
 * автоматаар цэвэрлэгдэнэ) — эффектээр state тэгшитгэх хэрэггүй.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, ListPlus, Plus, Save, Trash2 } from 'lucide-react';

import { EmptyState } from '@/shared/components/EmptyState';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { useUndoRedo } from '@/shared/hooks/useUndoRedo';
import { cn } from '@/shared/lib/utils';
import { selectionRect, type Coord, type SheetSelection } from '@/shared/sheet/coords';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

import { TEMPLATES_KEY, getTemplate, listTemplates, saveTemplate, templateKey } from '../api/quotes';
import { SheetGrid } from '../components/SheetGrid';
import { SheetTabs } from '../components/SheetTabs';
import { sectionCols } from '../lib/addons';
import { SheetToolbar } from '../components/SheetToolbar';
import { useQuoteWorkbook } from '../hooks/useQuoteWorkbook';
import type { CellValue, FormulaError } from '../lib/formula';
import { replaceSheet } from '../lib/workbook';
import type {
  CellRef,
  NamedSheet,
  QuoteTemplate,
  SheetDoc,
  TemplateVariant,
  WorkbookDoc,
} from '../types/quotes';

/** bySheet-д хуудас олдоогүй үеийн тогтвортой хоосон fallback (шинэ Map бүү үүсгэ). */
const EMPTY_VALUES = new Map<CellRef, CellValue | FormulaError>();

/* ------------------------------------------------------------------ */
/*  Хувилбарын ноорог                                                   */
/* ------------------------------------------------------------------ */

/**
 * `hiddenRows` нь өгөгдөлд 0-ээс эхэлсэн индекс, гэвч хэрэглэгч хуудсан дээр
 * 1-ээс эхэлсэн мөрийн ДУГААР харна. Тиймээс засварлах үед ТЕКСТЭЭР барина —
 * бичиж байхад '5, ' гэсэн хагас утга массив болж хувираад устахгүй.
 */
interface DraftVariant {
  id: number;
  key: string;
  label: string;
  titleTemplate: string;
  hiddenRowsText: string;
}

/** '5, 6, 12' → [4, 5, 11]. Давхардал, эмх замбараагүй дараалал цэгцэрнэ. */
function parseRowsText(text: string): number[] {
  const out = new Set<number>();
  for (const chunk of text.split(/[,;\s]+/)) {
    if (chunk === '') continue;
    const n = Number(chunk);
    if (Number.isInteger(n) && n >= 1) out.add(n - 1);
  }
  return [...out].sort((a, b) => a - b);
}

/** [4, 5, 11] → '5, 6, 12'. */
function rowsToText(rows: number[]): string {
  return [...rows]
    .sort((a, b) => a - b)
    .map((r) => r + 1)
    .join(', ');
}

function toDraft(variant: TemplateVariant, id: number): DraftVariant {
  return {
    id,
    key: variant.key,
    label: variant.label,
    titleTemplate: variant.titleTemplate,
    hiddenRowsText: rowsToText(variant.hiddenRows ?? []),
  };
}

function toPayload(list: DraftVariant[]): TemplateVariant[] {
  return list.map((v) => ({
    key: v.key.trim(),
    label: v.label.trim(),
    titleTemplate: v.titleTemplate,
    hiddenRows: parseRowsText(v.hiddenRowsText),
  }));
}

/* ------------------------------------------------------------------ */
/*  Засварлагч (нэг template-д нэг instance)                            */
/* ------------------------------------------------------------------ */

function TemplateEditor({
  template,
  embedded,
}: {
  template: QuoteTemplate;
  embedded?: boolean;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [name, setName] = useState(template.name);
  const [workbook, setWorkbook] = useState<WorkbookDoc>(template.workbook);
  const [variants, setVariants] = useState<DraftVariant[]>(() =>
    (template.variants ?? []).map((v, i) => toDraft(v, i + 1)),
  );
  const [nextId, setNextId] = useState(() => (template.variants?.length ?? 0) + 1);

  // `SheetGrid` нь өөрөө focus/selection-оо барьдаг ба дээшээ мэдэгдэнэ —
  // `SheetToolbar` тэднийг шаарддаг (үнийн саналын редактортой ижил холболт).
  const [focused, setFocused] = useState<Coord | null>(null);
  const [selection, setSelection] = useState<SheetSelection | null>(null);

  const { bySheet } = useQuoteWorkbook(workbook);

  // Идэвхтэй хуудас (таб) — индексийг мужид оруулж хамгаална.
  const activeIdx = Math.min(Math.max(0, workbook.activeSheet ?? 0), workbook.sheets.length - 1);
  const activeSheet = workbook.sheets[activeIdx];
  const activeValues = bySheet.get(activeSheet.id)?.values ?? EMPTY_VALUES;

  /**
   * Ажлын задаргаа (хэсгийн багана) — АНХДАГЧААР НУУГДСАН, засварлагчтай ижил.
   * ⚠️ Зөвхөн харагдац: багана нь ДҮН-г жолооддог тул устгахгүй.
   */
  const [showSections, setShowSections] = useState(false);
  const hiddenCols = useMemo(
    () => (showSections ? undefined : new Set(sectionCols(activeSheet))),
    [showSections, activeSheet],
  );

  /* --- Undo / redo (Ctrl+Z · Ctrl+Y | Ctrl+Shift+Z) --- */

  const history = useUndoRedo<WorkbookDoc>();

  /** Дэвтрийн бүх өөрчлөлт эндүүр — түүх нэг цэгээс бүртгэгдэнэ. */
  const applyWorkbook = useCallback(
    (mutate: (wb: WorkbookDoc) => WorkbookDoc) => {
      setWorkbook((prev) => {
        const next = mutate(prev);
        if (next === prev) return prev;
        history.record(prev);
        return next;
      });
    },
    [history],
  );

  // Идэвхтэй хуудсыг засварлахад workbook доторх тухайн нэг хуудсыг л сольж бичнэ
  // (id/name-ийг хадгална — SheetGrid зөвхөн SheetDoc буцаадаг).
  const handleSheetChange = useCallback(
    (next: SheetDoc) =>
      applyWorkbook((prev) => {
        const idx = Math.min(Math.max(0, prev.activeSheet ?? 0), prev.sheets.length - 1);
        const cur = prev.sheets[idx];
        const named: NamedSheet = { ...next, id: cur.id, name: cur.name };
        return replaceSheet(prev, idx, named);
      }),
    [applyWorkbook],
  );

  // Таб зурвасын үйлдлүүд. Хуудас солиход өмнөх focus/сонголтыг цэвэрлэнэ.
  const handleWorkbookChange = useCallback(
    (wb: WorkbookDoc) => {
      setFocused(null);
      setSelection(null);
      applyWorkbook(() => wb);
    },
    [applyWorkbook],
  );

  // Ctrl+Z / Ctrl+Y — `QuoteEditorPage`-тэй ижил зан төлөв (тайлбарыг тэндээс үз).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const isUndo = k === 'z' && !e.shiftKey;
      const isRedo = k === 'y' || (k === 'z' && e.shiftKey);
      if (!isUndo && !isRedo) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur();
      e.preventDefault();
      setWorkbook((prev) => (isUndo ? history.undo(prev) : history.redo(prev)) ?? prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history]);

  const undoProps = useMemo(
    () => ({
      onUndo: () => setWorkbook((prev) => history.undo(prev) ?? prev),
      onRedo: () => setWorkbook((prev) => history.redo(prev) ?? prev),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    }),
    [history],
  );

  /** Ачаалагдсан хэвээрээ байвал identity таарна — гүн харьцуулалт хэрэггүй. */
  const dirty =
    name !== template.name ||
    workbook !== template.workbook ||
    JSON.stringify(toPayload(variants)) !== JSON.stringify(template.variants ?? []);

  const saveMutation = useMutation({
    mutationFn: (body: { workbook: WorkbookDoc; variants: TemplateVariant[]; name: string }) =>
      saveTemplate(template.id, body),
    onSuccess: (res) => {
      toast.success(t('quotes.template.saved', { version: res.version }));
      // Хоёуланг нь — жагсаалт дээрх `version` мөн хуучирсан.
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
      void queryClient.invalidateQueries({ queryKey: templateKey(template.id) });
    },
    onError: (err: Error) => toast.error(t('common.saveFailed'), err.message),
  });

  const handleSave = () => {
    // Өөрчлөлт үнэхээр байхгүй бол хувилбар дэмий өсгөхгүй.
    if (!dirty) {
      toast.info(t('quotes.template.noChanges'));
      return;
    }
    const trimmed = name.trim();
    if (trimmed === '') {
      toast.error(t('quotes.template.nameRequired'));
      return;
    }
    const payload = toPayload(variants);
    const seen = new Set<string>();
    for (const v of payload) {
      if (v.key === '') {
        toast.error(t('quotes.template.keyRequired'));
        return;
      }
      if (seen.has(v.key)) {
        toast.error(t('quotes.template.duplicateKey', { key: v.key }));
        return;
      }
      seen.add(v.key);
    }
    saveMutation.mutate({ workbook, variants: payload, name: trimmed });
  };

  /* ---------------- Хувилбарын үйлдлүүд ---------------- */

  const patchVariant = (id: number, patch: Partial<DraftVariant>) =>
    setVariants((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));

  const addVariant = () => {
    setVariants((prev) => [
      ...prev,
      {
        id: nextId,
        key: '',
        label: t('quotes.template.newVariantLabel'),
        titleTemplate: '',
        hiddenRowsText: '',
      },
    ]);
    setNextId((n) => n + 1);
  };

  const removeVariant = (id: number) => setVariants((prev) => prev.filter((v) => v.id !== id));

  /** Хуудсан дээр сонгосон мөрүүдийг тухайн хувилбарын «нуух» жагсаалтад нэмнэ. */
  const addSelectedRows = (id: number) => {
    if (!selection) {
      toast.info(t('quotes.template.selectRowsFirst'));
      return;
    }
    const rect = selectionRect(selection);
    const picked: number[] = [];
    for (let r = rect.minR; r <= rect.maxR; r += 1) picked.push(r);
    setVariants((prev) =>
      prev.map((v) =>
        v.id === id
          ? {
              ...v,
              hiddenRowsText: rowsToText([...parseRowsText(v.hiddenRowsText), ...picked]),
            }
          : v,
      ),
    );
  };

  /* ---------------- Рендэр ---------------- */

  const actions = (
    <>
      {dirty && <span className="text-xs text-warning">{t('quotes.template.unsaved')}</span>}
      {/*
        ⚠️ `!dirty` дээр ИДЭВХГҮЙ БОЛГОХГҮЙ (2026-08-11, хэрэглэгчийн гомдол).
        Нүдний бичилт нь blur дээр л commit хийгддэг (`SheetGrid.handleBlur`)
        тул бичээд шууд Хадгалах дарах үед тэр агшинд `dirty` ХАРААХАН худал
        байна. Идэвхгүй товч нь click ч, blur ч үүсгэдэггүй тул хэрэглэгч
        дарсаар байхад ЮУ Ч БОЛОХГҮЙ — «Хадгалах ажиллахгүй байна» гэсэн
        гомдлын жинхэнэ шалтгаан энэ. Идэвхтэй үлдээвэл mousedown нь нүдийг
        blur хийж commit хийнэ, дараа нь click дээр `dirty` аль хэдийн үнэн.
        Өөрчлөлтгүй үед сүлжээ рүү явахгүй — `handleSave` дотор таслана.
      */}
      <Button type="button" onClick={handleSave} disabled={saveMutation.isPending}>
        <Save /> {saveMutation.isPending ? t('common.saving') : t('common.save')}
      </Button>
    </>
  );

  return (
    <PageContainer>
      {embedded ? (
        // Хувилбарын дугаар нь PageHeader-ийн `description`-оор гардаг байсан —
        // таб дотор гарчиггүй болох тул үйлдлийн эгнээнд зүүн талд үлдээв.
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">
            {t('quotes.template.version')} {template.version}
          </span>
          {actions}
        </div>
      ) : (
        <PageHeader
          title={t('quotes.template.pageTitle')}
          eyebrow={t('nav.quotes')}
          description={`${t('quotes.template.version')} ${template.version}`}
          icon={FileSpreadsheet}
          actions={actions}
        />
      )}

      {/* Загварын нэр + хувилбар */}
      <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="tpl-name" className="mb-1.5 text-xs">
            {t('quotes.template.name')}
          </Label>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="text-sm text-muted-foreground tabular-nums sm:pb-2">
          {t('quotes.template.version')}: <span className="font-medium">{template.version}</span>
        </div>
      </div>

      {/* Хадгалахад шинэ хувилбар үүснэ — админ мэдэж байх ёстой. */}
      <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
        {t('quotes.template.saveHint')}
      </div>

      {/* Хуудасны загвар — үнийн саналын редактортой ижил цөм */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t('quotes.template.sheetTitle')}
        </h2>
        <SheetToolbar
          sheet={activeSheet}
          focused={focused}
          selection={selection}
          values={activeValues}
          onChange={handleSheetChange}
            undo={undoProps}
            showSections={showSections}
            onToggleSections={() => setShowSections((v) => !v)}
        />
        <div className="rounded-md border border-border bg-card p-1">
          <SheetGrid
            sheet={activeSheet}
            values={activeValues}
            onChange={handleSheetChange}
            showHeaders
            onFocusChange={setFocused}
            onSelectionChange={setSelection}
            hiddenCols={hiddenCols}
          />
          <SheetTabs workbook={workbook} onChange={handleWorkbookChange} />
        </div>
      </section>

      {/* Хувилбарууд */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('quotes.template.variants')}
            </h2>
            <p className="text-xs text-muted-foreground">{t('quotes.template.variantsHint')}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addVariant}>
            <Plus /> {t('quotes.template.addVariant')}
          </Button>
        </div>

        {variants.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            {t('quotes.template.noVariants')}
          </div>
        ) : (
          <ul className="space-y-2">
            {variants.map((v) => (
              <li key={v.id} className="space-y-2 rounded-md border border-border bg-card p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-40">
                    <Label className="mb-1.5 text-xs">{t('quotes.template.variantKey')}</Label>
                    <Input
                      value={v.key}
                      spellCheck={false}
                      className={cn('font-mono', v.key.trim() === '' && 'border-[var(--danger)]')}
                      onChange={(e) => patchVariant(v.id, { key: e.target.value })}
                    />
                  </div>
                  <div className="min-w-40 flex-1">
                    <Label className="mb-1.5 text-xs">{t('quotes.template.variantLabel')}</Label>
                    <Input
                      value={v.label}
                      onChange={(e) => patchVariant(v.id, { label: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-danger"
                    title={t('quotes.template.deleteVariant')}
                    aria-label={t('quotes.template.deleteVariant')}
                    onClick={() => removeVariant(v.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>

                <div>
                  <Label className="mb-1.5 text-xs">{t('quotes.template.variantTitle')}</Label>
                  <Input
                    value={v.titleTemplate}
                    onChange={(e) => patchVariant(v.id, { titleTemplate: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('quotes.template.variantTitleHint')}
                  </p>
                </div>

                <div>
                  <Label className="mb-1.5 text-xs">{t('quotes.template.hiddenRows')}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={v.hiddenRowsText}
                      inputMode="numeric"
                      className="min-w-40 flex-1 tabular-nums"
                      placeholder={t('quotes.template.hiddenRowsHint')}
                      onChange={(e) => patchVariant(v.id, { hiddenRowsText: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addSelectedRows(v.id)}
                    >
                      <ListPlus /> {t('quotes.template.addFromSelection')}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('quotes.template.hiddenRowsHint')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Хуудас — үндсэн (default) загварыг олж ачаална                      */
/* ------------------------------------------------------------------ */

/** `embedded` — `QuotesPage`-ийн таб дотор (гарчиггүй). Дэлгэрэнгүйг QuoteListPage-ээс үз. */
export default function QuoteTemplatePage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage();

  const listQuery = useQuery({ queryKey: TEMPLATES_KEY, queryFn: listTemplates });

  const templateId = useMemo(() => {
    const list = listQuery.data ?? [];
    return list.find((tpl) => tpl.is_default === 1)?.id ?? list[0]?.id ?? null;
  }, [listQuery.data]);

  const templateQuery = useQuery({
    queryKey: templateKey(templateId ?? 0),
    queryFn: () => getTemplate(templateId as number),
    enabled: templateId !== null,
  });

  if (listQuery.isLoading || templateQuery.isLoading) {
    return (
      <PageContainer>
        <p className="py-16 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
      </PageContainer>
    );
  }

  if (listQuery.isError || templateQuery.isError) {
    return (
      <PageContainer>
        <EmptyState
          title={t('common.loadFailed')}
          description={(listQuery.error ?? templateQuery.error)?.message}
        />
      </PageContainer>
    );
  }

  const template = templateQuery.data;
  if (!template) {
    return (
      <PageContainer>
        <EmptyState
          icon={FileSpreadsheet}
          title={t('quotes.template.notFound')}
          description={t('quotes.template.saveHint')}
        />
      </PageContainer>
    );
  }

  // Хадгалсны дараа `version` нэмэгдэх тул `key` солигдож, засварлагч
  // ШИНЭ өгөгдлөөр цэвэр эхэлнэ (dirty төлөв өөрөө арилна).
  return (
    <TemplateEditor
      key={`${template.id}:${template.version}`}
      template={template}
      embedded={embedded}
    />
  );
}
