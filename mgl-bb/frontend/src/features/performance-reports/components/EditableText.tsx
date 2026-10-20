import { useEffect, useRef, type CSSProperties } from 'react';

import { caretAfterDigits, maskDottedDate } from '@/shared/lib/dottedDate';

/* =============================================================
 * Урьдчилан харах хэсэг дээр ШУУД засварлах анхдагч элемент.
 * -------------------------------------------------------------
 * Нэг талбар = нэг жижиг contentEditable span.  Бичих бүрт
 * `onChange` дуудагдаж редакторын state шинэчлэгддэг тул зүүн
 * талын input ба баруун талын хуудас хоёр РЕАЛТАЙМ синк болно.
 *
 * ХОЁР ЗҮЙЛ АЧААЛАЛ ҮҮРНЭ:
 *
 * 1. `value`-г DOM руу ЗӨВХӨН фокусгүй үед бичнэ.  React-ийн
 *    controlled input шиг заавал дахин бичвэл caret нь мөрийн
 *    төгсгөл рүү үсэрч, кирилл бичихэд үсэг ард нь ордог болно.
 *
 * 2. `data-editkey` — A4 хуудаслалт дахин тооцоологдоход элемент
 *    өөр хуудас руу шилжиж unmount болдог.  Пагинатор энэ түлхүүр
 *    болон caret-ийн байрлалыг санаж, дахин mount болсны дараа
 *    сэргээдэг (`restoreCaret` доор).
 * ============================================================= */

/** Хамгийн сүүлд фокуслагдсан талбар + caret-ийн байрлал. Модулийн
 *  хэмжээнд хадгалагдана — пагинаторын layout effect үүнийг уншина. */
export const lastCaret: { key: string | null; offset: number } = { key: null, offset: 0 };

function currentOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return 0;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

function setOffset(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remaining = offset;
  let placed = false;
  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        range.setStart(node, remaining);
        placed = true;
        return true;
      }
      remaining -= len;
      return false;
    }
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  };
  walk(el);
  if (!placed) range.selectNodeContents(el);
  range.collapse(placed ? true : false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Хуудаслалт дахин бүтсэний дараа caret-ийг сэргээнэ.
 *  Пагинаторын `useLayoutEffect`-ээс дуудагдана. */
export function restoreCaret(): void {
  if (!lastCaret.key) return;
  const el = document.querySelector<HTMLElement>(`[data-editkey="${CSS.escape(lastCaret.key)}"]`);
  if (!el || el.isContentEditable === false) return;
  if (document.activeElement === el) return;
  el.focus({ preventScroll: true });
  setOffset(el, lastCaret.offset);
}

export interface EditableTextProps {
  value: string;
  onChange?: (next: string) => void;
  /** Хоосон бол засварлах боломжгүй (хэвлэх хуудас, issued тайлан). */
  disabled?: boolean;
  /** Пагинацийн дараа caret сэргээх өвөрмөц түлхүүр. */
  fieldKey: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  /** Enter дарахад мөр таслах эсэх. Анхдагч: үгүй (blur болно). */
  multiline?: boolean;
  as?: 'span' | 'div';
  /** `'date'` — зөвхөн цифр бичигдэнэ, `YYYY.MM.DD`-ийн цэгийг систем
   *  тавина (`shared/lib/dottedDate.ts`).  Зураас, цэг, үсэг хаагдана. */
  inputMask?: 'date';
}

export function EditableText({
  value,
  onChange,
  disabled,
  fieldKey,
  placeholder,
  className,
  style,
  multiline = false,
  as = 'span',
  inputMask,
}: EditableTextProps) {
  const ref = useRef<HTMLElement | null>(null);

  // value → DOM. Зөвхөн фокусгүй үед бичнэ (caret үсрэхээс сэргийлнэ).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    /* ⚠️ `multiline` үед `textContent` БОЛОХГҮЙ: тэр нь <br>/<div>-ийн мөр
     * таслалыг өгдөггүй тул Enter дарсны дараа дэлгэц дээр 2 мөр харагдаж,
     * state-д залгагдсан НЭГ мөр очдог — дараа нь `el.textContent === value`
     * болохоор эргэж бичихгүй бөгөөд дэлгэц ба хадгалах утга БАЙНГА зөрнө. */
    const cur = multiline ? el.innerText.replace(/\n$/, '') : el.textContent;
    if (cur !== value) {
      if (multiline) el.innerText = value;
      else el.textContent = value;
    }
  }, [value, multiline]);

  const editable = !disabled && !!onChange;
  const Tag = as as 'span';

  const cls = [
    'perf-edit',
    editable ? 'perf-edit--on' : 'perf-edit--off',
    !value ? 'perf-edit--empty' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      ref={ref as React.Ref<HTMLSpanElement>}
      data-editkey={fieldKey}
      data-placeholder={placeholder ?? ''}
      className={cls}
      style={style}
      contentEditable={editable}
      suppressContentEditableWarning
      spellCheck={false}
      onInput={(e) => {
        const el = e.currentTarget;
        lastCaret.key = fieldKey;
        lastCaret.offset = currentOffset(el);
        if (inputMask === 'date') {
          /* Фокустай үед `value` DOM руу бичигдэхгүй (caret хамгаалалт) тул
           * маскыг ЭНД DOM дээр шууд тавьж, caret-ийг бичсэн цифрийн ард
           * буцаана — эс бөгөөс цэг зөвхөн blur-ын дараа гарна. */
          const raw = el.textContent ?? '';
          const next = maskDottedDate(raw);
          if (next !== raw) {
            const digits = raw.slice(0, lastCaret.offset).replace(/\D/g, '').length;
            el.textContent = next;
            lastCaret.offset = caretAfterDigits(next, digits);
            setOffset(el, lastCaret.offset);
          }
          onChange?.(next);
          return;
        }
        onChange?.(multiline ? el.innerText.replace(/\n$/, '') : (el.textContent ?? ''));
      }}
      onFocus={(e) => {
        lastCaret.key = fieldKey;
        lastCaret.offset = currentOffset(e.currentTarget);
      }}
      onKeyUp={(e) => {
        lastCaret.key = fieldKey;
        lastCaret.offset = currentOffset(e.currentTarget);
      }}
      onMouseUp={(e) => {
        lastCaret.key = fieldKey;
        lastCaret.offset = currentOffset(e.currentTarget);
      }}
      onBlur={() => {
        if (lastCaret.key === fieldKey) lastCaret.key = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !multiline) {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
          return;
        }
        // Огнооны нүдэнд цифрээс өөр тэмдэгт (зураас, цэг, үсэг) бичигдэхгүй.
        if (
          inputMask === 'date' &&
          e.key.length === 1 &&
          !/\d/.test(e.key) &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          e.preventDefault();
        }
      }}
      onPaste={(e) => {
        // Word-оос буулгахад формат/зураг орж ирэхээс сэргийлж цэвэр текст болгоно.
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, multiline ? text : text.replace(/\s*\n\s*/g, ' '));
      }}
    />
  );
}

/** Урьдчилан харах доторх засварлагдах талбаруудын CSS.
 *  `PERFORMANCE_REPORT_STYLES`-ийн ард нэмэгдэнэ. */
export const EDITABLE_STYLES = `
.perf-edit { outline: none; }
.perf-edit--on {
  cursor: text;
  border-radius: 2px;
  transition: background-color .12s ease, box-shadow .12s ease;
  min-width: 1ch;
  display: inline-block;
}
.perf-edit--on:hover { background: rgba(56,132,255,0.09); box-shadow: 0 0 0 1px rgba(56,132,255,0.28); }
.perf-edit--on:focus { background: rgba(56,132,255,0.13); box-shadow: 0 0 0 1.5px rgba(56,132,255,0.65); }
.perf-edit--on.perf-edit--empty::before {
  content: attr(data-placeholder);
  color: #9aa4b2;
  font-style: italic;
}
/* Хэвлэх / PDF үед ямар ч тэмдэглэгээ гарахгүй. */
@media print {
  .perf-edit--on,
  .perf-edit--on:hover,
  .perf-edit--on:focus { background: none !important; box-shadow: none !important; }
  .perf-edit--empty::before { content: "" !important; }
}
`;
