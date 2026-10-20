/**
 * Хуудасны багаж мөр — Excel-ийн туузан цэс + ТОМЬЁОНЫ МӨР.
 *
 * Бүх үйлдэл `lib/sheetOps.ts`-ийн ЦЭВЭР функцээр явна (шинэ логик энд
 * БАЙХГҮЙ): загвар/формат нь `setCells`, мөр/багана нь `insert*`/`delete*`,
 * нэгтгэл нь `mergeRange`/`unmergeAt`, семантик тэмдэглэгээ нь
 * `setAnchor`/`clearAnchor`. Тиймээс undo/redo, autosave, серверийн
 * тооцоолол бүгд нэг л замаар өнгөрнө.
 *
 * `focused`/`selection` нь `SheetGrid`-ээс (`onFocusChange`/`onSelectionChange`)
 * дээшээ гарч, эцэг хуудсаар дамжин энд ирнэ — багаж мөр өөрөө хүснэгтийн
 * төлөв БАРИХГҮЙ.
 */
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import {
  clampRect,
  isSingleCell,
  selectionRect,
  type Coord,
  type SheetRect,
  type SheetSelection,
} from '@/shared/sheet/coords';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Separator } from '@/ui/separator';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Anchor,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  Columns3,
  Eraser,
  Eye,
  EyeOff,
  Hash,
  Italic,
  Redo2,
  Rows3,
  TableCellsMerge,
  TableCellsSplit,
  Undo2,
} from 'lucide-react';

import { editText, formatValue, parseInput } from '../lib/format';
import { coordToRef, type CellValue, type FormulaError } from '../lib/formula';
import { collectRefSpans } from '../lib/refHighlight';
import { AddonMenu } from './AddonMenu';
import { NoteMenu } from './NoteMenu';
import { SectionMenu } from './SectionMenu';
import { refTextColor } from './sheetStyles';
import {
  anchorAt,
  clearAnchor,
  deleteCols,
  deleteRows,
  getCell,
  insertColLike,
  insertRowLike,
  mergeAt,
  mergeRange,
  setAnchor,
  setCells,
  unmergeAt,
  type CellPatch,
} from '../lib/sheetOps';
import type {
  AnchorKey,
  CellRef,
  CellStyle,
  NumFmt,
  QuoteLang,
  SheetCell,
  SheetDoc,
} from '../types/quotes';

/* ------------------------------------------------------------------ */
/*  Тогтмолууд                                                          */
/* ------------------------------------------------------------------ */

const FMT_OPTIONS: ReadonlyArray<{ value: NumFmt; key: string }> = [
  { value: '#,##0', key: 'quotes.editor.fmtNumber' },
  { value: '#,##0.00', key: 'quotes.editor.fmtDecimal' },
  { value: '0%', key: 'quotes.editor.fmtPercent' },
  { value: 'text', key: 'quotes.editor.fmtText' },
];

const ANCHOR_KEYS: ReadonlyArray<{ key: AnchorKey; label: string }> = [
  { key: 'total', label: 'quotes.anchor.total' },
  { key: 'subtotal', label: 'quotes.anchor.subtotal' },
  { key: 'title', label: 'quotes.anchor.docTitle' },
];

/** Хоосон/анхдагч утгуудыг хаяна — sparse хадгалалт цэвэр байлгах. */
function pruneStyle(s: CellStyle): CellStyle | undefined {
  const out: CellStyle = {};
  if (s.bold) out.bold = true;
  if (s.italic) out.italic = true;
  if (s.align) out.align = s.align;
  if (s.color && s.color !== 'default') out.color = s.color;
  if (s.bg && s.bg !== 'none') out.bg = s.bg;
  if (s.border) out.border = true;
  if (s.wrap) out.wrap = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Нүдийг хувилж засварлана. Юу ч үлдэхгүй бол `null` (нүдийг устгана). */
function editCell(old: SheetCell | undefined, mutate: (draft: SheetCell) => void): SheetCell | null {
  const draft: SheetCell = { ...(old ?? {}) };
  draft.s = { ...(old?.s ?? {}) };
  mutate(draft);
  const s = pruneStyle(draft.s);
  if (s) draft.s = s;
  else delete draft.s;
  return Object.keys(draft).length > 0 ? draft : null;
}

/**
 * Томьёоны мөрөөс орсон текстийг нүд болгоно — формат/загварыг хадгална.
 * ⚠️ `SheetGrid.tsx`-ийн `mergeText`-тэй ижил логик (`lib/format.ts` нь тогтсон
 * гэрээ тул нийтлэг хувилбарыг тэнд байрлуулах боломжгүй байсан) — нэгийг нь
 * засвал нөгөөг нь мөн адил.
 */
function mergeText(old: SheetCell | undefined, text: string): SheetCell | null {
  const parsed = parseInput(text);
  // Утга цэвэрлэсэн ч нүдний ТӨРӨЛ (формат/загвар/сонголт) хадгалагдана.
  if (!parsed) {
    const kept: SheetCell = {};
    if (old?.s) kept.s = old.s;
    if (old?.choices) kept.choices = old.choices;
    return old?.s || old?.choices ? kept : null;
  }
  const next: SheetCell = { ...parsed };
  if (parsed.fmt === undefined && old?.fmt !== undefined) next.fmt = old.fmt;
  if (old?.s) next.s = old.s;
  if (old?.choices) next.choices = old.choices;
  return next;
}

/* ------------------------------------------------------------------ */

export interface SheetToolbarProps {
  sheet: SheetDoc;
  focused: Coord | null;
  selection: SheetSelection | null;
  values: Map<CellRef, CellValue | FormulaError>;
  onChange: (next: SheetDoc) => void;
  /**
   * Буцаах/сэргээх — эцэг хуудас БҮХЭЛ ДЭВТРИЙН түүхийг барьдаг тул эндээс
   * зөвхөн дуудна. Өгөөгүй бол товчнууд гарахгүй (гар товчлуур хэвээр ажиллана).
   */
  undo?: { onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean };
  /**
   * Ажлын задаргаа (хэсгийн багана) ХАРАГДАЖ байгаа эсэх + сэлгэгч.
   * ⚠️ Зөвхөн ХАРАГДАЦ — багана устгахгүй тул ДҮН хөндөгдөхгүй. Өгөөгүй бол
   * товч гарахгүй (хэвлэх хуудас, загварын засварлагч).
   */
  showSections?: boolean;
  onToggleSections?: () => void;
  /**
   * Баримтын хэл (`quotes.lang`) — «Нэмэгдэл»/«Хэсэг» цэс рүү дамжина, ингэснээр
   * англи хуудсанд цэснээс нэмсэн бичвэр `labelEn`-ээр бичигдэнэ.
   */
  quoteLang?: QuoteLang;
  className?: string;
}

export function SheetToolbar({
  sheet,
  focused,
  selection,
  values,
  onChange,
  undo,
  showSections,
  onToggleSections,
  quoteLang,
  className,
}: SheetToolbarProps) {
  const { t } = useLanguage();

  /** Үйлдэл хамаарах муж: сонголт байвал тэр, эс бөгөөс focus-той нүд. */
  const rect: SheetRect | null = useMemo(() => {
    if (selection) return clampRect(selectionRect(selection), sheet.rows, sheet.cols);
    if (focused) return { minR: focused.r, maxR: focused.r, minC: focused.c, maxC: focused.c };
    return null;
  }, [selection, focused, sheet.rows, sheet.cols]);

  /** Мөр/багана/тэмдэглэгээний үйлдлүүдийн байрлал. */
  const at: Coord | null = useMemo(
    () => focused ?? (rect ? { r: rect.minR, c: rect.minC } : null),
    [focused, rect],
  );

  const activeCell = at ? getCell(sheet, at.r, at.c) : undefined;
  /**
   * Идэвхтэй нүдний томьёоны лавлагаанууд. Хүснэгтэд өнгөт хүрээгээр
   * тодрох ба энд ижил өнгөтэй чипсээр давхар харагдана — аль өнгө нь аль
   * хаяг болохыг хараад л ойлгоно.
   *
   * ⚠️ Томьёоны мөр нь UNCONTROLLED `<input>` тул текстийг нь шууд будах
   * боломжгүй (`value` барихгүй нь зориудын шийдвэр — доорх тайлбар үз).
   * Тиймээс харгалзааг ЧИПСЭЭР үзүүлнэ.
   */
  const refSpans = useMemo(() => collectRefSpans(activeCell?.f), [activeCell?.f]);
  const refChips = useMemo(() => {
    const seen = new Set<number>();
    const out: { tone: number; label: string }[] = [];
    for (const sp of refSpans) {
      if (seen.has(sp.tone)) continue;
      seen.add(sp.tone);
      const from = coordToRef(sp.minR, sp.minC);
      const to = coordToRef(sp.maxR, sp.maxC);
      const body = from === to ? from : `${from}:${to}`;
      out.push({ tone: sp.tone, label: sp.sheet ? `${sp.sheet}!${body}` : body });
    }
    return out;
  }, [refSpans]);
  const activeRef = at ? coordToRef(at.r, at.c) : null;
  const activeMerge = at ? mergeAt(sheet, at.r, at.c) : undefined;
  const activeAnchor = at ? anchorAt(sheet, at.r, at.c) : undefined;
  const canMerge = !!selection && !isSingleCell(selection);

  /* ---------------- Загвар / формат ---------------- */

  const patchRect = useCallback(
    (mutate: (draft: SheetCell) => void) => {
      if (!rect) return;
      const patches: CellPatch[] = [];
      for (let r = rect.minR; r <= rect.maxR; r += 1) {
        for (let c = rect.minC; c <= rect.maxC; c += 1) {
          patches.push({ r, c, cell: editCell(getCell(sheet, r, c), mutate) });
        }
      }
      onChange(setCells(sheet, patches));
    },
    [rect, sheet, onChange],
  );

  /** Тод/налуу нь ТОГГЛ: мужийн бүх нүд аль хэдийн тийм бол унтраана. */
  const allHave = useCallback(
    (pick: (s: CellStyle | undefined) => boolean | undefined): boolean => {
      if (!rect) return false;
      for (let r = rect.minR; r <= rect.maxR; r += 1) {
        for (let c = rect.minC; c <= rect.maxC; c += 1) {
          if (!pick(getCell(sheet, r, c)?.s)) return false;
        }
      }
      return true;
    },
    [rect, sheet],
  );

  const isBold = allHave((s) => s?.bold);
  const isItalic = allHave((s) => s?.italic);
  const activeAlign = activeCell?.s?.align;
  const activeFmt = activeCell?.fmt ?? '';

  const toggleBold = () => patchRect((d) => void (d.s = { ...d.s, bold: !isBold }));
  const toggleItalic = () => patchRect((d) => void (d.s = { ...d.s, italic: !isItalic }));
  const setAlign = (align: NonNullable<CellStyle['align']>) =>
    patchRect((d) => void (d.s = { ...d.s, align: activeAlign === align ? undefined : align }));
  const setFmt = (fmt: NumFmt) => patchRect((d) => void (d.fmt = fmt));
  const clearContents = () =>
    patchRect((d) => {
      delete d.v;
      delete d.f;
    });

  /* ---------------- Мөр / багана / нэгтгэл / anchor ---------------- */

  const rowCount = rect ? rect.maxR - rect.minR + 1 : 1;
  const colCount = rect ? rect.maxC - rect.minC + 1 : 1;

  const act = {
    // Мөр нэмэхэд идэвхтэй мөрийн БҮТЦИЙГ (томьёо + формат + dropdown) хувилна —
    // тарифын томьёо, тооцооны багана бүгд шинэ мөр рүү заасан томьёотой орж
    // ирнэ, нэр/талбай/төвөгшил оролт хоосон болно.
    rowAbove: () => at && onChange(insertRowLike(sheet, at.r, at.r)),
    rowBelow: () => at && onChange(insertRowLike(sheet, at.r + 1, at.r)),
    rowDelete: () => rect && onChange(deleteRows(sheet, rect.minR, rowCount)),
    colLeft: () => at && onChange(insertColLike(sheet, at.c, at.c)),
    colRight: () => at && onChange(insertColLike(sheet, at.c + 1, at.c)),
    colDelete: () => rect && onChange(deleteCols(sheet, rect.minC, colCount)),
    merge: () => rect && onChange(mergeRange(sheet, rect)),
    unmerge: () => at && onChange(unmergeAt(sheet, at.r, at.c)),
    anchorSet: (key: AnchorKey) => at && onChange(setAnchor(sheet, key, at.r, at.c)),
    anchorClear: (key: AnchorKey) => onChange(clearAnchor(sheet, key)),
  };

  /* ---------------- Томьёоны мөр ---------------- */

  // `<input>` нь UNCONTROLLED — `SheetGrid`-ийн нүдтэй ижил шалтгаанаар
  // (react-hooks-ийн `set-state-in-effect` дүрэм). Focus шилжих эсвэл нүд
  // гаднаас өөрчлөгдөх бүрд элементийн `value`-г шууд синк хийнэ; хэрэглэгч
  // бичих үед `srcText` хөдлөхгүй тул бичсэн текст угаагдахгүй.
  const fxRef = useRef<HTMLInputElement | null>(null);
  const srcText = editText(activeCell);
  useLayoutEffect(() => {
    const el = fxRef.current;
    if (el && el.value !== srcText) el.value = srcText;
  }, [srcText, activeRef]);

  const commitFormula = () => {
    const el = fxRef.current;
    if (!at || !el) return;
    onChange(
      setCells(sheet, [
        { r: at.r, c: at.c, cell: mergeText(getCell(sheet, at.r, at.c), el.value) },
      ]),
    );
  };

  const result = activeRef ? formatValue(values.get(activeRef), activeCell?.fmt) : '';

  /* ---------------- Рендэр ---------------- */

  const disabled = !at;
  const btn = 'size-7';

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md border border-border bg-card p-1 text-xs',
        className,
      )}
    >
      {/* --- Туузан цэс --- */}
      <div className="flex flex-wrap items-center gap-0.5">
        {/* Буцаах / Сэргээх — түүхийг эцэг хуудас барина (бүхэл дэвтрээр). */}
        {undo && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={btn}
              disabled={!undo.canUndo}
              title={`${t('quotes.editor.undo')} (Ctrl+Z)`}
              aria-label={t('quotes.editor.undo')}
              onClick={undo.onUndo}
            >
              <Undo2 />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={btn}
              disabled={!undo.canRedo}
              title={`${t('quotes.editor.redo')} (Ctrl+Y)`}
              aria-label={t('quotes.editor.redo')}
              onClick={undo.onRedo}
            >
              <Redo2 />
            </Button>
            <Separator orientation="vertical" className="mx-0.5 h-5" />
          </>
        )}
        <Button
          type="button"
          variant={isBold ? 'secondary' : 'ghost'}
          size="icon-sm"
          className={btn}
          disabled={disabled}
          title={t('quotes.editor.bold')}
          aria-label={t('quotes.editor.bold')}
          onClick={toggleBold}
        >
          <Bold />
        </Button>
        <Button
          type="button"
          variant={isItalic ? 'secondary' : 'ghost'}
          size="icon-sm"
          className={btn}
          disabled={disabled}
          title={t('quotes.editor.italic')}
          aria-label={t('quotes.editor.italic')}
          onClick={toggleItalic}
        >
          <Italic />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Button
          type="button"
          variant={activeAlign === 'left' ? 'secondary' : 'ghost'}
          size="icon-sm"
          className={btn}
          disabled={disabled}
          title={t('quotes.editor.alignLeft')}
          aria-label={t('quotes.editor.alignLeft')}
          onClick={() => setAlign('left')}
        >
          <AlignLeft />
        </Button>
        <Button
          type="button"
          variant={activeAlign === 'center' ? 'secondary' : 'ghost'}
          size="icon-sm"
          className={btn}
          disabled={disabled}
          title={t('quotes.editor.alignCenter')}
          aria-label={t('quotes.editor.alignCenter')}
          onClick={() => setAlign('center')}
        >
          <AlignCenter />
        </Button>
        <Button
          type="button"
          variant={activeAlign === 'right' ? 'secondary' : 'ghost'}
          size="icon-sm"
          className={btn}
          disabled={disabled}
          title={t('quotes.editor.alignRight')}
          aria-label={t('quotes.editor.alignRight')}
          onClick={() => setAlign('right')}
        >
          <AlignRight />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Тооны формат */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              disabled={disabled}
              title={t('quotes.editor.numFmt')}
            >
              <Hash />
              <span className="hidden sm:inline">{t('quotes.editor.numFmt')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            <DropdownMenuLabel>{t('quotes.editor.numFmt')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={activeFmt}
              onValueChange={(v) => setFmt(v as NumFmt)}
            >
              {FMT_OPTIONS.map((o) => (
                <DropdownMenuRadioItem key={o.value} value={o.value}>
                  {t(o.key)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={btn}
          disabled={disabled}
          title={t('quotes.editor.clear')}
          aria-label={t('quotes.editor.clear')}
          onClick={clearContents}
        >
          <Eraser />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Мөр */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={btn}
          disabled={disabled}
          title={t('quotes.editor.insertRowAbove')}
          aria-label={t('quotes.editor.insertRowAbove')}
          onClick={act.rowAbove}
        >
          <ArrowUpToLine />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={btn}
          disabled={disabled}
          title={t('quotes.editor.insertRowBelow')}
          aria-label={t('quotes.editor.insertRowBelow')}
          onClick={act.rowBelow}
        >
          <ArrowDownToLine />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(btn, 'text-danger')}
          disabled={disabled || sheet.rows <= rowCount}
          title={t('quotes.editor.deleteRow')}
          aria-label={t('quotes.editor.deleteRow')}
          onClick={act.rowDelete}
        >
          <Rows3 />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Багана */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={btn}
          disabled={disabled}
          title={t('quotes.editor.insertColLeft')}
          aria-label={t('quotes.editor.insertColLeft')}
          onClick={act.colLeft}
        >
          <ArrowLeftToLine />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={btn}
          disabled={disabled}
          title={t('quotes.editor.insertColRight')}
          aria-label={t('quotes.editor.insertColRight')}
          onClick={act.colRight}
        >
          <ArrowRightToLine />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(btn, 'text-danger')}
          disabled={disabled || sheet.cols <= colCount}
          title={t('quotes.editor.deleteCol')}
          aria-label={t('quotes.editor.deleteCol')}
          onClick={act.colDelete}
        >
          <Columns3 />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Нэгтгэл */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={btn}
          disabled={!canMerge}
          title={t('quotes.editor.merge')}
          aria-label={t('quotes.editor.merge')}
          onClick={act.merge}
        >
          <TableCellsMerge />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={btn}
          disabled={!activeMerge}
          title={t('quotes.editor.unmerge')}
          aria-label={t('quotes.editor.unmerge')}
          onClick={act.unmerge}
        >
          <TableCellsSplit />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Семантик тэмдэглэгээ */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant={activeAnchor ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1 px-2"
              disabled={disabled}
              title={t('quotes.anchor.title')}
            >
              <Anchor />
              <span className="hidden sm:inline">
                {activeAnchor
                  ? t(ANCHOR_KEYS.find((a) => a.key === activeAnchor)?.label ?? activeAnchor)
                  : t('quotes.anchor.title')}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-w-72">
            <DropdownMenuLabel>{t('quotes.anchor.set')}</DropdownMenuLabel>
            {ANCHOR_KEYS.map((a) => (
              <DropdownMenuItem key={a.key} onSelect={() => act.anchorSet(a.key)}>
                <span className="flex-1">{t(a.label)}</span>
                {sheet.anchors[a.key] && (
                  <span className="ml-2 text-muted-foreground tabular-nums">
                    {sheet.anchors[a.key]}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
            {activeAnchor && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => act.anchorClear(activeAnchor)}
                >
                  {t('quotes.anchor.clear')}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal whitespace-normal text-muted-foreground">
              {t('quotes.anchor.hint')}
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* БД 4.19/4.21-ийн хувийн нэмэгдэл багана асаах/унтраах.
            `sheet.addons` тодорхойлогдоогүй хуудсанд өөрөө нуугдана. */}
        {sheet.addons && (
          <>
            <Separator orientation="vertical" className="mx-0.5 h-5" />
            <AddonMenu sheet={sheet} onChange={onChange} lang={quoteLang} />
          </>
        )}

        {/* БД 4.22.1 (Хүснэгт 10)-ийн АЗ-ийн хэсгүүдийг мөрөөр нэмэх.
            `sheet.addons.sections` тодорхойлогдоогүй хуудсанд өөрөө нуугдана. */}
        {sheet.addons?.sections && <SectionMenu sheet={sheet} onChange={onChange} lang={quoteLang} />}

        {/* Баримтын ДООД ТАЙЛБАР — «Тайлбар:» / «Ашигласан материал:» блокууд.
            Тэдгээр блок хуудсанд огт байхгүй бол цэс өөрөө нуугдана
            (`lib/quoteNotes.ts` → `hasNoteBlocks`). */}
        <NoteMenu sheet={sheet} onChange={onChange} lang={quoteLang} />
        {/* Ажлын задаргааг ХАРУУЛАХ/НУУХ — анхдагчаар нуугдсан (7 багана нь
            хүснэгтийг хэт өргөн болгодог). Өгөгдөл хөндөгдөхгүй. */}
        {sheet.addons?.sections && onToggleSections && (
          <Button
            type="button"
            size="sm"
            variant={showSections ? 'secondary' : 'outline'}
            className="h-7 gap-1 px-2 text-xs"
            onClick={onToggleSections}
            aria-pressed={showSections}
          >
            {showSections ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {t('quotes.section.viewCols')}
          </Button>
        )}
      </div>

      {/* --- Томьёоны мөр --- */}
      <div className="flex items-center gap-1">
        <span className="w-14 shrink-0 rounded border border-border bg-muted/40 px-1 py-1 text-center font-medium tabular-nums">
          {activeRef ?? '—'}
        </span>
        <span className="shrink-0 px-0.5 font-serif text-sm text-muted-foreground italic">fx</span>
        <input
          ref={fxRef}
          className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 font-mono outline-none focus:border-ring disabled:opacity-50"
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          placeholder={t('quotes.editor.formulaPlaceholder')}
          title={t('quotes.editor.formula')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitFormula();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.currentTarget.value = srcText;
              e.currentTarget.blur();
            }
          }}
        />
        {refChips.length > 0 && (
          <span className="hidden shrink-0 items-center gap-1 lg:flex">
            {refChips.map((chip) => (
              <span
                key={chip.tone}
                className="rounded border px-1 font-mono text-micro tabular-nums"
                style={{ color: refTextColor(chip.tone), borderColor: refTextColor(chip.tone) }}
              >
                {chip.label}
              </span>
            ))}
          </span>
        )}
        {activeRef && result !== '' && (
          <span
            className="hidden max-w-48 shrink-0 truncate text-muted-foreground tabular-nums md:inline"
            title={result}
          >
            = {result}
          </span>
        )}
      </div>
    </div>
  );
}
