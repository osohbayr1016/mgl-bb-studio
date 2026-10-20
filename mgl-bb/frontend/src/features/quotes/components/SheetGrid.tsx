/**
 * Excel маягийн ЧӨЛӨӨТ хуудасны рендэрлэгч — үнийн саналын цөм компонент.
 *
 * Нэг компонент ХОЁР горимд ажиллана:
 *   • `onChange` өгсөн  → засварлагч (input, навигаци, clipboard, сонголт).
 *   • `onChange` алга   → зөвхөн унших (`<span>`, ямар ч input үгүй) — хэвлэх
 *     хуудас, PDF-ийн Browser Rendering үүнийг ашиглана. Ингэснээр «дэлгэц
 *     дээр өөр, PDF дээр өөр» гэсэн сонгодог алдаа гарах боломжгүй.
 *
 * Excel-ийн зан төлөвүүд:
 *   • Focus авсан нүд ТОМЬЁОГОО харуулна, алдсан нүд ҮР ДҮНГЭЭ (`editText` vs
 *     `formatValue`).
 *   • Нэгтгэсэн нүднээс зөвхөн зүүн дээд нь `rowSpan`/`colSpan`-тай гарна.
 *   • Олон нүд сонгоод Delete дарвал агуулга нь цэвэрлэгдэнэ; ганц нүд дээр бол
 *     ердийн текст засварлалт (input-ийн default) ажиллана.
 *   • Ctrl+C/V/X, Ctrl+D — `useSheetClipboard` (event-ууд `<table>` дээр
 *     delegated, нүд бүр дээр биш).
 *
 * ⚠️ Энэ бол CONTROLLED компонент: дотоод `SheetDoc` төлөв БАЙХГҮЙ. Гэвч нэг
 * event дотор дараалсан хоёр бичилт гарч болзошгүй (paste = `ensureRows` дараа
 * нь `writeCells`), тэр үед `sheet` prop хараахан шинэчлэгдээгүй байна. Тиймээс
 * бүх бичилт `applySheet(prev => next)`-ээр явдаг ба тэр нь хамгийн сүүлийн
 * баримтыг `sheetRef`-д ОПТИМИСТААР бичээд дараагийн дуудалт руу гинжлэн
 * дамжуулна.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import {
  cellSelection,
  clampRect,
  isSingleCell,
  selectionRect,
  type Coord,
  type SheetRect,
  type SheetSelection,
} from '@/shared/sheet/coords';
import { useSheetClipboard, type SheetCellPatch } from '@/shared/sheet/useSheetClipboard';
import { useSheetNav, type SheetCellElement } from '@/shared/sheet/useSheetNav';

import { currencyCols } from '../lib/currency';
import { editText, formatValue, parseInput } from '../lib/format';
import {
  colToName,
  coordToRef,
  isFormulaError,
  type CellValue,
  type FormulaError,
} from '../lib/formula';
import {
  anchorAt,
  ensureRows as ensureSheetRows,
  getCell,
  isMergeOrigin,
  mergeAt,
  setCells,
  setColWidth,
  MIN_COL_WIDTH,
  type CellPatch,
} from '../lib/sheetOps';
import { collectRefSpans, refEdgesAt } from '../lib/refHighlight';
import type { AnchorKey, CellRef, SheetCell, SheetDoc } from '../types/quotes';
import {
  ANCHOR_MARK,
  FOCUS_RING,
  INPUT_CLASS,
  OPTION_CLASS,
  SELECTED_BG,
  cellClass,
  refBorderColor,
} from './sheetStyles';

/* ------------------------------------------------------------------ */
/*  Тогтмолууд                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_COL_W = 96;
/** Мөрийн дугаарын баганы өргөн (px). */
const GUTTER_W = 34;
/**
 * Мөрийн доод өндөр (px). Босоо нэгтгэл (rowSpan) үед ДАРАГДСАН мөр нь өөрийн
 * нүдгүй болдог — хэрэв өндөргүй бол 0 болж «алга болно». Тогтвортой доод өндөр
 * өгснөөр нэгтгэсэн нүд Excel шиг бүх мөрийн зайг эзэлнэ. Урт текст энэ утгаас
 * дээш л сунана (table-layout: fixed үед height = доод хязгаар).
 */
const DEFAULT_ROW_H = 28;

/** Алдааны код → тайлбарын i18n түлхүүр (`title` tooltip-д). */
const ERROR_HINT_KEY: Record<string, string> = {
  '#ТОМЬЁО!': 'quotes.err.formula',
  '#ЦИКЛ!': 'quotes.err.cycle',
  '#ТАРИФ!': 'quotes.err.tariff',
  '#ХАСАГДСАН!': 'quotes.err.deleted',
  '#ТООЦОО!': 'quotes.err.calc',
};

const ANCHOR_LABEL_KEY: Record<AnchorKey, string> = {
  total: 'quotes.anchor.total',
  subtotal: 'quotes.anchor.subtotal',
  title: 'quotes.anchor.docTitle',
};

/**
 * Гараас орсон текстийг нүд болгоно — ФОРМАТ БА ЗАСВАРЫГ ХАДГАЛНА.
 *
 * `parseInput` нь зөвхөн утгыг уншдаг тул шууд хэрэглэвэл хэрэглэгч тоо засах
 * бүрд нүдний тод/өнгө/формат нь угаагдана. Тиймээс: шинэ утга + (заагаагүй бол)
 * ХУУЧИН формат + хуучин загвар. Хоосон болгосон нүд загвараа хадгална
 * (Excel-ийн Delete-тэй ижил), загваргүй бол огт устана.
 *
 * ⚠️ `SheetToolbar.tsx`-ийн томьёоны мөрөнд ЯГ ижил логик давхардаж бичигдсэн —
 * тэр файлыг засвал энийг ч мөн адил (`lib/format.ts` нь тогтсон гэрээ тул тэнд
 * нэмэх боломжгүй байсан).
 */
function mergeText(old: SheetCell | undefined, text: string): SheetCell | null {
  const parsed = parseInput(text);
  // Утга цэвэрлэсэн ч нүдний ТӨРӨЛ (формат/загвар/сонголт) хадгалагдана —
  // Excel-ийн Delete нүдийг хоосолдог ч түүний нөхцөлийг алдагдуулдаггүй.
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
/*  Нэг нүд                                                             */
/* ------------------------------------------------------------------ */

interface SheetCellViewProps {
  r: number;
  c: number;
  cell: SheetCell | undefined;
  /** Тооцоолж форматласан текст — focus-гүй үед харагдана. */
  display: string;
  /** Түүхий эх текст (томьёо эсвэл литерал) — focus-той үед харагдана. */
  raw: string;
  /** Алдаатай нүдний tooltip. `null` = алдаагүй. */
  errorTitle: string | null;
  anchorKey: AnchorKey | null;
  anchorTitle: string | null;
  /** Байвал нүд нь dropdown болно (`SheetCell.choices`). */
  choices?: string[];
  choosePlaceholder: string;
  /**
   * Идэвхтэй нүдний ТОМЬЁО энэ нүдийг заасан бол — тодруулгын ирмэг + өнгө.
   * `null` бол тодруулахгүй.
   */
  refEdge: { tone: number; top: boolean; right: boolean; bottom: boolean; left: boolean } | null;
  selected: boolean;
  isFocused: boolean;
  editable: boolean;
  gridLines: boolean;
  rowSpan?: number;
  colSpan?: number;
  registerCell: (r: number, c: number) => (el: SheetCellElement | null) => void;
  onCellKeyDown: (e: ReactKeyboardEvent<SheetCellElement>, co: Coord) => void;
  onCellFocus: (co: Coord) => void;
  onCommitCell: (r: number, c: number, text: string) => void;
  onCellMouseDown: (e: ReactMouseEvent, co: Coord) => void;
  onCellMouseEnter: (co: Coord) => void;
}

const SheetCellView = memo(function SheetCellView({
  r,
  c,
  cell,
  display,
  raw,
  errorTitle,
  anchorKey,
  anchorTitle,
  choices,
  choosePlaceholder,
  refEdge,
  selected,
  isFocused,
  editable,
  gridLines,
  rowSpan,
  colSpan,
  registerCell,
  onCellKeyDown,
  onCellFocus,
  onCommitCell,
  onCellMouseDown,
  onCellMouseEnter,
}: SheetCellViewProps) {
  const co = useMemo<Coord>(() => ({ r, c }), [r, c]);
  const registerRef = useMemo(() => registerCell(r, c), [registerCell, r, c]);

  /**
   * `<input>` нь UNCONTROLLED — хагас бичсэн текст DOM дотор амьдарна.
   *
   * Хяналттай (`value` + `useState`) хувилбар нь «гаднаас нүд өөрчлөгдвөл
   * ноорхойг хая» дүрмийг effect дотор `setState` дуудахыг шаарддаг бөгөөд
   * react-hooks-ийн `set-state-in-effect` дүрэм үүнийг хориглодог. Оронд нь
   * элементийн `value`-г шууд синк хийнэ (effect-ийн зөв хэрэглээ: React-ийн
   * гадна орших системийг шинэчлэх).
   */
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      registerRef(el);
    },
    [registerRef],
  );

  // Excel: focus-той нүд ТОМЬЁОГОО, бусад нь ҮР ДҮНГЭЭ харуулна.
  //  • focus-гүй үед — үргэлж тооцоолсон утга руу татна.
  //  • focus-той үед — зөвхөн эх текст ГАДНААС (paste/toolbar) өөрчлөгдсөн үед
  //    дарж бичнэ, эс бөгөөс хэрэглэгчийн бичиж буй текстийг угаана.
  const lastRaw = useRef(raw);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (document.activeElement === el) {
      if (lastRaw.current !== raw) el.value = raw;
    } else if (el.value !== display) {
      el.value = display;
    }
    lastRaw.current = raw;
  }, [raw, display]);

  const handleFocus = useCallback(() => {
    const el = inputRef.current;
    if (el && el.value !== raw) el.value = raw;
    onCellFocus(co);
  }, [raw, onCellFocus, co]);

  const handleBlur = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const typed = el.value;
    // Тооцоолсон харагдац руу шууд буцаана; бичилт хийгдвэл дээрх effect дарж бичнэ.
    el.value = display;
    if (typed !== raw) onCommitCell(r, c, typed);
  }, [display, raw, onCommitCell, r, c]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      // Excel: Escape нь бичсэнийг ЦУЦАЛНА (nav дараа нь blur хийнэ).
      if (e.key === 'Escape' && inputRef.current) inputRef.current.value = raw;
      onCellKeyDown(e, co);
    },
    [raw, onCellKeyDown, co],
  );

  // Dropdown нүд: сонгосон утга шууд commit хийгдэнэ; онгойлгохын тулд caret
  // хэрэггүй тул навигаци select дээр ч ажиллана (useSheetNav-ийн
  // atCaretBoundary нь HTMLSelectElement-ийг «хилд» гэж үзнэ).
  const handleSelectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => onCommitCell(r, c, e.target.value),
    [onCommitCell, r, c],
  );

  const title = [errorTitle, anchorTitle].filter(Boolean).join(' · ') || undefined;
  const isDropdown = editable && !!choices && choices.length > 0;
  const currentChoice = typeof cell?.v === 'string' ? cell.v : '';

  /**
   * Лавлагааны хүрээ — зөвхөн мужийн ГАДНА талын ирмэг (дотор нь шугам гарахгүй).
   * Tailwind динамик өнгө үүсгэдэггүй тул inline `style`.
   */
  const refStyle = refEdge
    ? (() => {
        const c1 = refBorderColor(refEdge.tone);
        const w = '2px solid ' + c1;
        return {
          borderTop: refEdge.top ? w : undefined,
          borderRight: refEdge.right ? w : undefined,
          borderBottom: refEdge.bottom ? w : undefined,
          borderLeft: refEdge.left ? w : undefined,
        };
      })()
    : undefined;

  return (
    <td
      rowSpan={rowSpan}
      colSpan={colSpan}
      data-r={r}
      data-c={c}
      /* Хэвлэлтийн CSS нийлбэрийн мөрүүдийг ЭНЭ атрибутаар л таньдаг
         (`printStyles`). Өмнө нь `colspan="<багана−1>"` гэж таадаг байсан нь
         багана нуугдмагц (эсвэл загварын нэгтгэл өөр өргөнтэй байхад) чимээгүй
         ажиллахаа больдог байв — `data-anchor` нь загвараас хамаарахгүй. */
      data-anchor={anchorKey ?? undefined}
      title={title}
      onMouseDown={editable ? (e) => onCellMouseDown(e, co) : undefined}
      onMouseEnter={editable ? () => onCellMouseEnter(co) : undefined}
      style={refStyle}
      className={cn(
        'relative overflow-hidden',
        gridLines && 'border-r border-b border-border',
        cellClass(cell?.s, cell?.fmt),
        selected && !isFocused && SELECTED_BG,
        isFocused && FOCUS_RING,
        errorTitle && 'text-danger',
        anchorKey && ANCHOR_MARK,
      )}
    >
      {isDropdown ? (
        <select
          ref={registerRef}
          value={choices.includes(currentChoice) ? currentChoice : ''}
          className={cn(INPUT_CLASS, 'cursor-pointer appearance-none pr-4')}
          onChange={handleSelectChange}
          onFocus={() => onCellFocus(co)}
          onKeyDown={(e) => onCellKeyDown(e, co)}
        >
          <option className={OPTION_CLASS} value="">
            {choosePlaceholder}
          </option>
          {choices.map((opt) => (
            <option className={OPTION_CLASS} key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : editable ? (
        <input
          ref={setRef}
          className={INPUT_CLASS}
          spellCheck={false}
          autoComplete="off"
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <span className="block">{display}</span>
      )}
      {isDropdown && (
        // Native сумыг нуусан тул өөрийн жижиг заагч (баруун захад).
        <span
          aria-hidden
          className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 text-[8px] text-muted-foreground"
        >
          ▾
        </span>
      )}
    </td>
  );
});

/* ------------------------------------------------------------------ */
/*  Хуудас                                                              */
/* ------------------------------------------------------------------ */

export interface SheetGridProps {
  sheet: SheetDoc;
  values: Map<CellRef, CellValue | FormulaError>;
  /** Өгөөгүй бол ЗӨВХӨН УНШИХ горим (хэвлэх хуудас). */
  onChange?: (next: SheetDoc) => void;
  /** A/B/C + 1/2/3 толгойнууд. */
  showHeaders?: boolean;
  onFocusChange?: (co: Coord | null) => void;
  /**
   * Сонголт өөрчлөгдөх бүрд. `SheetToolbar` нь нэгтгэх/загварчлахдаа бүтэн
   * тэгш өнцөгт хэрэгтэй тул `onFocusChange` дангаараа хүрэлцэхгүй.
   */
  onSelectionChange?: (sel: SheetSelection | null) => void;
  /**
   * Хүснэгтийн торлолт. Default нь `showHeaders` — хэвлэх хуудас
   * `showHeaders={false}` өгснөөр зөвхөн `CellStyle.border`-тэй нүд шугамтай
   * гарна (баримтын жинхэнэ хүснэгт), дэлгэц дээр бүтэн тор харагдана.
   */
  gridLines?: boolean;
  /**
   * ХАРАГДАЦААС нуух баганы индексүүд. Өгөгдөл, томьёо, ДҮН хөндөгдөхгүй —
   * зөвхөн зурагдахгүй. «Хэсэг хэсгээс харах» товч үүгээр ажиллана.
   */
  hiddenCols?: ReadonlySet<number>;
  /**
   * ХАРАГДАЦААС нуух мөрийн индексүүд — `hiddenCols`-ийн босоо хос. Өгөгдөл,
   * томьёо, ДҮН огт хөндөгдөхгүй; зөвхөн зурагдахгүй.
   *
   * Хэвлэх хуудас үүгээр гарын үсгийн шошгын мөрүүдийг («БОЛОВСРУУЛСАН:»,
   * «…ХХК-ийн», «Төслийн менежер:») нуугаад тэдгээрийг React-ийн голлосон
   * гарын үсгийн блокт дахин зурдаг (`lib/signatureBlock.ts`).
   *
   * ⚠️ Мөр нуух нь `merges`-ийн `rowSpan`-г ӨӨРЧИЛДӨГГҮЙ — эдгээр шошгын мөр
   * босоо нэгтгэлд ОРОЛЦДОГГҮЙ тул энэ хялбаршуулалт аюулгүй. Босоо нэгтгэлтэй
   * мөрийг нуух шаардлага гарвал `rowSpan`-г дахин тоолох ёстой.
   */
  hiddenRows?: ReadonlySet<number>;
  /**
   * ЗУРАГДАХ текстийг хувиргана.  ⚠️ Хэвлэх хуудас үүнийг ОГТ ӨГДӨГГҮЙ:
   * цаасан дээр нүдний БҮТЭН текст гарах ёстой (`QuotePrintPage`-ийн
   * «ТОВЧЛОЛ БҮРМӨСӨН ХАСАГДСАН» блокийг үз).
   *
   * ⚠️ ЗӨВХӨН УНШИХ горимд (`onChange` өгөөгүй үед) үйлчилнэ. Засварлагчид
   * товчилсон текст харагдвал хэрэглэгч түүнийг нүдний УТГА гэж ойлгоод дээр
   * нь бичих эрсдэлтэй — тиймээс `editable` үед үл тоомсорлоно.
   *
   * ⚠️ `lib/printFit.ts`-ийн `measureSheetDemand(..., transform)`-д дамжуулсан
   * функцтэй ЯГ ИЖИЛ байх ЁСТОЙ: тэнд баганы өргөнийг энэ текстээр хэмждэг.
   * Зөрвөл багана хэмжсэнээсээ өөр агуулга авч, тоо ЧИМЭЭГҮЙ ТАСАРНА.
   *
   * ⚠️ Нүдний УТГА, томьёо, `sheet_json`, Excel экспорт огт хөндөгдөхгүй.
   */
  printText?: (text: string) => string;
  className?: string;
}

export function SheetGrid({
  sheet,
  values,
  onChange,
  showHeaders = true,
  onFocusChange,
  onSelectionChange,
  gridLines,
  hiddenCols,
  hiddenRows,
  printText,
  className,
}: SheetGridProps) {
  const { t } = useLanguage();
  const choosePlaceholder = t('quotes.editor.choosePlaceholder');
  const editable = !!onChange;
  const lines = gridLines ?? showHeaders;
  /** Товчлол ЗӨВХӨН зөвхөн-унших горимд — дээрх `printText`-ийн тайлбарыг үз. */
  const showText = !editable && printText ? printText : null;

  /* --- Хамгийн сүүлийн баримт + callback-уудыг ref-т (доорх бүх хаалт
         тогтвортой байхын тулд — memo-лсон нүднүүд дэмий дахин зурагдахгүй). --- */
  const sheetRef = useRef(sheet);
  const onChangeRef = useRef(onChange);
  const onFocusChangeRef = useRef(onFocusChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const editableRef = useRef(editable);
  useEffect(() => {
    sheetRef.current = sheet;
    onChangeRef.current = onChange;
    onFocusChangeRef.current = onFocusChange;
    onSelectionChangeRef.current = onSelectionChange;
    editableRef.current = editable;
  });

  /** Бүх бичилтийн ЦОРЫН ГАНЦ гарц — ref-ээр гинжилдэг тул нэг event дотор
   *  дараалсан хэд хэдэн шинэчлэлт бие биенээ дарж бичихгүй. */
  const applySheet = useCallback((updater: (prev: SheetDoc) => SheetDoc) => {
    const emit = onChangeRef.current;
    if (!emit) return;
    const prev = sheetRef.current;
    const next = updater(prev);
    if (next === prev) return;
    sheetRef.current = next;
    emit(next);
  }, []);

  /**
   * Засагдах нүд: нэгтгэсэн блокийн зүүн дээд БИШ нүднүүд рендэрлэгддэггүй тул
   * навигаци тэднийг АЛГАСАХ ёстой (эс бөгөөс сум дарахад «алга болсон» нүд рүү
   * focus явж, дэлгэц дээр юу ч тодрохгүй). Clipboard-ын бичилт ч мөн адил
   * тэднийг алгасна — тэдгээр нүд `mergeRange`-ээр аль хэдийн цэвэрлэгдсэн.
   */
  const isEditable = useCallback((r: number, c: number) => {
    if (!editableRef.current) return false;
    const m = mergeAt(sheetRef.current, r, c);
    return !m || isMergeOrigin(m, r, c);
  }, []);

  /* --- Навигаци (clipboard-той харилцан хамааралтай тул fillDown нь ref) --- */
  const fillDownRef = useRef<() => void>(() => {});
  const onFillDown = useCallback(() => fillDownRef.current(), []);

  const {
    focused,
    selection,
    setSelection,
    registerCell,
    onCellKeyDown,
    onCellFocus,
    focusCoord,
    isSelected,
  } = useSheetNav({
    rows: sheet.rows,
    cols: sheet.cols,
    isEditable,
    onFillDown,
  });

  /* --- Clipboard --- */
  const readCell = useCallback(
    // Түүхий эх текст: хуудсан дотор copy→paste хийхэд ТОМЬЁО хадгалагдана,
    // Excel рүү буулгахад ч мөн адил A1 хаяглалттай томьёо болж очно.
    (r: number, c: number) => editText(getCell(sheetRef.current, r, c)),
    [],
  );

  const writeCells = useCallback(
    (patches: SheetCellPatch[]) => {
      applySheet((prev) => {
        const next: CellPatch[] = patches.map((p) => ({
          r: p.r,
          c: p.c,
          cell: mergeText(getCell(prev, p.r, p.c), p.value),
        }));
        return setCells(prev, next);
      });
    },
    [applySheet],
  );

  const ensureRowsCb = useCallback(
    (n: number) => applySheet((prev) => ensureSheetRows(prev, n)),
    [applySheet],
  );

  const clip = useSheetClipboard({
    rows: sheet.rows,
    cols: sheet.cols,
    selection,
    focused,
    readCell,
    writeCells,
    ensureRows: ensureRowsCb,
    isEditable,
  });

  /* --- Гаднах ертөнцтэй харилцах --- */
  const multiRef = useRef(false);
  const clearRectRef = useRef(clip.clearRect);
  const setSelectionRef = useRef(setSelection);
  const focusCoordRef = useRef(focusCoord);
  useEffect(() => {
    fillDownRef.current = clip.fillDown;
    clearRectRef.current = clip.clearRect;
    setSelectionRef.current = setSelection;
    focusCoordRef.current = focusCoord;
    multiRef.current = !!selection && !isSingleCell(selection);
  });

  useEffect(() => {
    onFocusChangeRef.current?.(focused);
  }, [focused]);

  useEffect(() => {
    onSelectionChangeRef.current?.(selection);
  }, [selection]);

  /* --- Гар: олон нүд сонгоод Delete → цэвэрлэх --- */
  const handleCellKeyDown = useCallback(
    (e: ReactKeyboardEvent<SheetCellElement>, co: Coord) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && multiRef.current) {
        e.preventDefault();
        clearRectRef.current();
        return;
      }
      onCellKeyDown(e, co);
    },
    [onCellKeyDown],
  );

  /* --- Хулгана: чирж сонгох + shift+click --- */
  const dragging = useRef(false);
  useEffect(() => {
    if (!editable) return;
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, [editable]);

  const handleCellMouseDown = useCallback((e: ReactMouseEvent, co: Coord) => {
    dragging.current = true;
    if (e.shiftKey) {
      // Сонголтыг тэлнэ — DOM focus хөдлөхгүй (Excel-тэй ижил).
      e.preventDefault();
      setSelectionRef.current((prev) =>
        prev ? { anchor: prev.anchor, focus: co } : cellSelection(co),
      );
      return;
    }
    // Нүдний зайд (засварлагч элементээс ГАДУУР) дарсан бол өөрсдөө focus хийнэ.
    // ⚠️ INPUT-аас гадна SELECT-ийг ч алгасна — эс бөгөөс preventDefault нь
    // dropdown-ийг нээлгэхгүй.
    const tag = (e.target as HTMLElement).tagName;
    if (tag !== 'INPUT' && tag !== 'SELECT') {
      e.preventDefault();
      focusCoordRef.current(co);
    }
  }, []);

  const handleCellMouseEnter = useCallback((co: Coord) => {
    if (!dragging.current) return;
    setSelectionRef.current((prev) =>
      prev ? { anchor: prev.anchor, focus: co } : cellSelection(co),
    );
  }, []);

  const handleCommitCell = useCallback(
    (r: number, c: number, text: string) => {
      applySheet((prev) => setCells(prev, [{ r, c, cell: mergeText(getCell(prev, r, c), text) }]));
    },
    [applySheet],
  );

  /* --- Хэмжээ / толгой --- */
  /**
   * Харагдах баганууд. `hiddenCols` нь ЗӨВХӨН ХАРАГДАЦЫН шүүлт — өгөгдөл,
   * томьёо, ДҮН огт хөндөгдөхгүй (хэсгийн багана нь ДҮН-г жолооддог тул
   * тэдгээрийг устгах нь үнийг өөрчилнө; нуух нь тэрнээс ЗАРЧМЫН ялгаатай).
   */
  const colIdx = useMemo(
    () =>
      Array.from({ length: sheet.cols }, (_, i) => i).filter((c) => !hiddenCols?.has(c)),
    [sheet.cols, hiddenCols],
  );

  /**
   * Нэгтгэсэн нүдний colSpan-ыг ХАРАГДАХ баганаар дахин тоолно.
   *
   * ⚠️ Заавал хэрэгтэй: гарчгийн мөр бүх баганыг нэгтгэдэг (`cs = sheet.cols`).
   * Нуусан үед түүхий `cs`-ийг өгвөл хүснэгтэд байхаас олон багана зарлаж,
   * зохиомж бүхэлдээ эвдэрнэ.
   */
  const visibleSpan = useCallback(
    (c: number, cs: number) => {
      const end = Math.min(c + cs, sheet.cols);
      let n = 0;
      for (let i = c; i < end; i += 1) if (!hiddenCols?.has(i)) n += 1;
      return Math.max(1, n);
    },
    [hiddenCols, sheet.cols],
  );
  const rowIdx = useMemo(
    () =>
      Array.from({ length: sheet.rows }, (_, i) => i).filter((r) => !hiddenRows?.has(r)),
    [sheet.rows, hiddenRows],
  );

  /**
   * ВАЛЮТЫН баганууд — «₮» угтвартай гарах мөнгөн дүнгүүд (`lib/currency.ts`).
   * ⚠️ Засварлагч ба хэвлэх хуудас ХОЁУЛАА энэ компонентоор зурагддаг тул
   * дэлгэц дээрх ₮ ба цаасан дээрх ₮ хэзээ ч зөрөхгүй.
   */
  const money = useMemo(() => currencyCols(sheet), [sheet]);

  /* --- Баганы өргөн чирэх ---
   *
   * Чирч байх хугацаанд `sheet`-ийг ХӨНДӨХГҮЙ: нүд болгонд шинэчлэл явуулбал
   * томьёоны граф pointermove бүрд дахин тооцоологдоно. Оронд нь зөвхөн энэ
   * локал төлөвөөр `<col>`-ыг дарж бичээд, pointerup дээр НЭГ УДАА commit хийнэ.
   */
  const [drag, setDrag] = useState<{ c: number; width: number } | null>(null);
  const dragRef = useRef<{ c: number; startX: number; startW: number } | null>(null);

  const colWidth = useCallback(
    (c: number) =>
      drag && drag.c === c ? drag.width : (sheet.colWidths?.[c] ?? DEFAULT_COL_W),
    [drag, sheet.colWidths],
  );

  const onResizeDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, c: number) => {
      e.preventDefault();
      e.stopPropagation(); // толгой дарж багана сонгохоос сэргийлнэ
      const startW = sheetRef.current.colWidths?.[c] ?? DEFAULT_COL_W;
      dragRef.current = { c, startX: e.clientX, startW };
      setDrag({ c, width: startW });
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setDrag({ c: d.c, width: Math.max(MIN_COL_WIDTH, d.startW + (e.clientX - d.startX)) });
  }, []);

  const onResizeUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      const width = Math.max(MIN_COL_WIDTH, d.startW + (e.clientX - d.startX));
      setDrag(null);
      if (width !== d.startW) applySheet((prev) => setColWidth(prev, d.c, width, DEFAULT_COL_W));
    },
    [applySheet],
  );

  const totalWidth = useMemo(() => {
    let w = showHeaders ? GUTTER_W : 0;
    for (const c of colIdx) w += colWidth(c);
    return w;
  }, [colIdx, showHeaders, colWidth]);

  const rect: SheetRect | null = useMemo(
    () => (selection ? clampRect(selectionRect(selection), sheet.rows, sheet.cols) : null),
    [selection, sheet.rows, sheet.cols],
  );

  /**
   * Идэвхтэй нүдний томьёоны лавлагаанууд — Excel шиг өнгөт хүрээгээр
   * тодруулна. Зөвхөн ГАНЦ нүд дээр зогсоход (муж сонгоогүй үед) — эс бөгөөс
   * сонголтын тодруулгатай нүд ирмэгээ булаацалдана.
   */
  const refSpans = useMemo(() => {
    if (!focused || (selection && !isSingleCell(selection))) return [];
    return collectRefSpans(getCell(sheet, focused.r, focused.c)?.f);
  }, [focused, selection, sheet]);

  const headerClass =
    'select-none border-r border-b border-border bg-muted/60 px-1 py-0.5 text-center ' +
    'text-[10px] font-medium text-muted-foreground';

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table
        className={cn(
          'border-separate border-spacing-0 text-xs',
          lines && 'border-t border-l border-border',
        )}
        style={{ tableLayout: 'fixed', width: totalWidth }}
        onCopy={editable ? clip.onCopy : undefined}
        onCut={editable ? clip.onCut : undefined}
        onPaste={editable ? clip.onPaste : undefined}
      >
        <colgroup>
          {showHeaders && <col style={{ width: GUTTER_W }} />}
          {colIdx.map((c) => (
            <col key={c} style={{ width: colWidth(c) }} />
          ))}
        </colgroup>

        {showHeaders && (
          <thead>
            <tr>
              <th className={headerClass} />
              {colIdx.map((c) => (
                <th
                  key={c}
                  className={cn(
                    headerClass,
                    'relative',
                    rect && c >= rect.minC && c <= rect.maxC && 'bg-primary/15 text-foreground',
                  )}
                >
                  {colToName(c)}
                  {/* Өргөн чирэх бариул — баганы баруун хилд. Зөвхөн засварлах
                      горимд; хэвлэх хуудсанд `onChange` байхгүй тул гарахгүй. */}
                  {editable && (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`${colToName(c)} — ${t('quotes.editor.resizeCol')}`}
                      title={t('quotes.editor.resizeCol')}
                      onPointerDown={(e) => onResizeDown(e, c)}
                      onPointerMove={onResizeMove}
                      onPointerUp={onResizeUp}
                      onPointerCancel={onResizeUp}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        applySheet((prev) => setColWidth(prev, c, DEFAULT_COL_W, DEFAULT_COL_W));
                      }}
                      className={cn(
                        'absolute top-0 right-0 z-20 h-full w-[5px] translate-x-[2px]',
                        'cursor-col-resize touch-none hover:bg-primary/60',
                        drag?.c === c && 'bg-primary',
                      )}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
        )}

        <tbody>
          {rowIdx.map((r) => (
            // Доод өндөр — босоо нэгтгэлд дарагдсан мөр 0 болж «алга болохоос»
            // сэргийлнэ (доорх DEFAULT_ROW_H-ийн тайлбар).
            <tr key={r} style={{ height: DEFAULT_ROW_H }}>
              {showHeaders && (
                <th
                  className={cn(
                    headerClass,
                    rect && r >= rect.minR && r <= rect.maxR && 'bg-primary/15 text-foreground',
                  )}
                >
                  {r + 1}
                </th>
              )}
              {colIdx.map((c) => {
                const m = mergeAt(sheet, r, c);
                // Нэгтгэсэн блокийн зүүн дээд БИШ нүдийг огт гаргахгүй.
                if (m && !isMergeOrigin(m, r, c)) return null;

                const ref = coordToRef(r, c);
                const cell = sheet.cells[ref];
                const value = values.get(ref);
                const err = isFormulaError(value) ? value : null;
                const anchorKey = anchorAt(sheet, r, c) ?? null;

                return (
                  <SheetCellView
                    key={c}
                    r={r}
                    c={c}
                    cell={cell}
                    display={((v) => (showText ? showText(v) : v))(
                      formatValue(value, cell?.fmt, money.has(c)),
                    )}
                    raw={editText(cell)}
                    errorTitle={err ? t(ERROR_HINT_KEY[err.code] ?? err.code) : null}
                    anchorKey={anchorKey}
                    anchorTitle={anchorKey ? t(ANCHOR_LABEL_KEY[anchorKey]) : null}
                    choices={cell?.choices}
                    choosePlaceholder={choosePlaceholder}
                    refEdge={refSpans.length > 0 ? refEdgesAt(refSpans, r, c) : null}
                    selected={isSelected(r, c)}
                    isFocused={!!focused && focused.r === r && focused.c === c}
                    editable={editable}
                    gridLines={lines}
                    rowSpan={m ? Math.min(m.rs, sheet.rows - r) : undefined}
                    colSpan={m ? visibleSpan(c, m.cs) : undefined}
                    registerCell={registerCell}
                    onCellKeyDown={handleCellKeyDown}
                    onCellFocus={onCellFocus}
                    onCommitCell={handleCommitCell}
                    onCellMouseDown={handleCellMouseDown}
                    onCellMouseEnter={handleCellMouseEnter}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
