import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Highlighter,
  Indent,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Outdent,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import {
  MAIL_BODY_STYLE,
  MAIL_FONT_OPTIONS,
  MAIL_FONT_SIZE_OPTIONS,
  MAIL_FONT_SIZE_PT,
  MAIL_FONT_STACK,
  primaryFontName,
} from '../lib/mailTypography';

/**
 * Lightweight rich-text editor — a contentEditable surface + a toolbar driven
 * by document.execCommand (no extra dependency).  Uncontrolled: seeds from
 * `defaultHtml` once and reports the live HTML via onChange.  Bump `key` from
 * the parent to reset it (e.g. after sending).
 *
 * Хоёр зүйл ачаалал үүрдэг:
 *
 * 1. **Үндсэн хэлбэр нь ГАДАРГУУ дээр CSS-ээр тавигдана** (`MAIL_BODY_STYLE`
 *    — Arial 11 налуу), span бүр дээр биш.  Тиймээс бичиж эхлэхэд шууд зөв
 *    харагдана, харин илгээхдээ `wrapMailBody` ЯГ ижил утгыг inline style
 *    болгож нэг давхарга нэмнэ — хүлээн авагч бидний CSS-ийг хардаггүй.
 *    Хэрэглэгч налууг унтраавал хөтөч `<span style="font-style:normal">`
 *    үүсгэдэг тул орооход зөрчил гарахгүй.
 * 2. **Сонголтыг гараар хадгална** (`savedRange`).  Toolbar-ийн `<select>` ба
 *    `<input type="color">` фокусыг булаадаг тул execCommand дуудахын өмнө
 *    range-ээ буцаан тавихгүй бол хэлбэржүүлэлт хоосон зайд унана.
 */
export function RichTextEditor({
  defaultHtml = '',
  onChange,
  placeholder,
  className,
}: {
  defaultHtml?: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  /** `fontSize` execCommand нь 1–7 хэмжээг л мэддэг тул «7»-оор тэмдэглээд
   *  дараа нь жинхэнэ pt утгаар нь сольдог.  Курсор хоосон байхад хөтөч
   *  <font size="7">-ыг ДАРАА нь бичих үед үүсгэдэг тул утгыг барьж үлдэнэ. */
  const pendingSizePt = useRef<number | null>(null);

  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [font, setFont] = useState(primaryFontName(MAIL_FONT_STACK));
  const [size, setSize] = useState<number>(MAIL_FONT_SIZE_PT);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== defaultHtml) {
      ref.current.innerHTML = defaultHtml;
    }
    // Seed once on mount; parent remounts via key to reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** `<font size="7">` → жинхэнэ pt.  Элементийг СОЛИХГҮЙ, зөвхөн атрибутыг
   *  нь өөрчилдөг тул бичиж байгаа курсор үсэрдэггүй. */
  const normalizeFontTags = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll('font[size="7"]').forEach((f) => {
      f.removeAttribute('size');
      const pt = pendingSizePt.current;
      if (pt) (f as HTMLElement).style.fontSize = `${pt}pt`;
    });
  }, []);

  const emit = useCallback(() => {
    normalizeFontTags();
    onChange(ref.current?.innerHTML ?? '');
  }, [normalizeFontTags, onChange]);

  const saveSelection = useCallback(() => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
  }, []);

  /** Идэвхтэй хэлбэрүүд + сонголтын фонт/хэмжээг toolbar-т тусгана. */
  const syncState = useCallback(() => {
    const el = ref.current;
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!el || !node || !el.contains(node)) return;
    const state = (command: string) => {
      try {
        return document.queryCommandState(command);
      } catch {
        return false;
      }
    };
    setMarks({
      bold: state('bold'),
      italic: state('italic'),
      underline: state('underline'),
      strikeThrough: state('strikeThrough'),
      insertUnorderedList: state('insertUnorderedList'),
      insertOrderedList: state('insertOrderedList'),
      justifyLeft: state('justifyLeft'),
      justifyCenter: state('justifyCenter'),
      justifyRight: state('justifyRight'),
      justifyFull: state('justifyFull'),
    });
    const target = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (target) {
      const cs = window.getComputedStyle(target);
      setFont(primaryFontName(cs.fontFamily));
      // px → pt (CSS 96dpi).
      const pt = Math.round(parseFloat(cs.fontSize) * 0.75);
      if (Number.isFinite(pt)) setSize(pt);
    }
  }, []);

  useEffect(() => {
    const onSelectionChange = () => {
      saveSelection();
      syncState();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [saveSelection, syncState]);

  /** Фокус + хадгалсан сонголтыг сэргээх — exec бүрийн өмнө. */
  const focusEditor = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const range = savedRange.current;
    const sel = window.getSelection();
    if (range && sel && el.contains(range.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  const exec = useCallback(
    (command: string, value?: string) => {
      focusEditor();
      // styleWithCSS → <span style="…">, i.e. inline CSS an email client keeps.
      // (<b>/<i> would survive too, but colours and fonts would not.)
      try {
        document.execCommand('styleWithCSS', false, 'true');
      } catch {
        /* Safari-д байхгүй байж болно */
      }
      document.execCommand(command, false, value);
      saveSelection();
      emit();
      syncState();
    },
    [emit, focusEditor, saveSelection, syncState],
  );

  const applyFontSize = useCallback(
    (pt: number) => {
      focusEditor();
      pendingSizePt.current = pt;
      try {
        document.execCommand('styleWithCSS', false, 'false');
        document.execCommand('fontSize', false, '7');
      } finally {
        try {
          document.execCommand('styleWithCSS', false, 'true');
        } catch {
          /* noop */
        }
      }
      setSize(pt);
      saveSelection();
      emit();
    },
    [emit, focusEditor, saveSelection],
  );

  const groups: { key: string; items: ToolItem[] }[] = [
    {
      key: 'marks',
      items: [
        { icon: Bold, label: t('mailInbox.bold'), cmd: 'bold' },
        { icon: Italic, label: t('mailInbox.italic'), cmd: 'italic' },
        { icon: Underline, label: t('mailInbox.underline'), cmd: 'underline' },
        { icon: Strikethrough, label: t('mailInbox.strikethrough'), cmd: 'strikeThrough' },
      ],
    },
    {
      key: 'align',
      items: [
        { icon: AlignLeft, label: t('mailInbox.alignLeft'), cmd: 'justifyLeft' },
        { icon: AlignCenter, label: t('mailInbox.alignCenter'), cmd: 'justifyCenter' },
        { icon: AlignRight, label: t('mailInbox.alignRight'), cmd: 'justifyRight' },
        { icon: AlignJustify, label: t('mailInbox.alignJustify'), cmd: 'justifyFull' },
      ],
    },
    {
      key: 'lists',
      items: [
        { icon: List, label: t('mailInbox.bulletList'), cmd: 'insertUnorderedList' },
        { icon: ListOrdered, label: t('mailInbox.numberedList'), cmd: 'insertOrderedList' },
        { icon: Outdent, label: t('mailInbox.outdent'), cmd: 'outdent' },
        { icon: Indent, label: t('mailInbox.indent'), cmd: 'indent' },
      ],
    },
    {
      key: 'insert',
      items: [
        {
          icon: LinkIcon,
          label: t('mailInbox.link'),
          run: () => {
            const url = window.prompt(t('mailInbox.insertLinkPrompt'));
            if (url) exec('createLink', url);
          },
        },
        { icon: Unlink, label: t('mailInbox.removeLink'), cmd: 'unlink' },
        {
          icon: Quote,
          label: t('mailInbox.quoteBlock'),
          run: () => exec('formatBlock', 'blockquote'),
        },
        {
          icon: Minus,
          label: t('mailInbox.horizontalRule'),
          run: () => exec('insertHorizontalRule'),
        },
      ],
    },
    {
      key: 'history',
      items: [
        { icon: RemoveFormatting, label: t('mailInbox.clearFormatting'), cmd: 'removeFormat' },
        { icon: Undo2, label: t('mailInbox.undo'), cmd: 'undo' },
        { icon: Redo2, label: t('mailInbox.redo'), cmd: 'redo' },
      ],
    },
  ];

  const fontValue = MAIL_FONT_OPTIONS.find((o) => primaryFontName(o.value) === font)?.value;

  return (
    <div className={cn('flex flex-col rounded-md border border-input bg-background', className)}>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border/60 px-1.5 py-1">
        {/* Фонт + хэмжээ.  Эдгээр дээр onMouseDown-ыг ЗОГСООХГҮЙ (эс тэгвэл
            native select нээгдэхгүй) — оронд нь savedRange-аар сэргээнэ. */}
        <select
          aria-label={t('mailInbox.fontFamily')}
          title={t('mailInbox.fontFamily')}
          value={fontValue ?? '__other'}
          onChange={(e) => exec('fontName', e.target.value)}
          className="h-7 max-w-[8.5rem] rounded border border-transparent bg-transparent px-1 text-xs text-foreground outline-none hover:bg-muted focus:border-input"
        >
          {!fontValue && <option value="__other">—</option>}
          {MAIL_FONT_OPTIONS.map((o) => (
            <option key={o.label} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label={t('mailInbox.fontSize')}
          title={t('mailInbox.fontSize')}
          value={MAIL_FONT_SIZE_OPTIONS.includes(size) ? String(size) : '__other'}
          onChange={(e) => applyFontSize(Number(e.target.value))}
          className="h-7 rounded border border-transparent bg-transparent px-1 text-xs tabular-nums text-foreground outline-none hover:bg-muted focus:border-input"
        >
          {!MAIL_FONT_SIZE_OPTIONS.includes(size) && <option value="__other">{size}</option>}
          {MAIL_FONT_SIZE_OPTIONS.map((s) => (
            <option key={s} value={String(s)}>
              {s}
            </option>
          ))}
        </select>

        <Divider />
        {groups.map((g, gi) => (
          <div key={g.key} className="flex items-center gap-0.5">
            {g.items.map((item) => (
              <ToolButton
                key={item.label}
                item={item}
                active={!!item.cmd && !!marks[item.cmd]}
                onRun={() => (item.run ? item.run() : exec(item.cmd!))}
              />
            ))}
            {gi === 0 && (
              <>
                <ColorButton
                  icon={Baseline}
                  label={t('mailInbox.textColor')}
                  defaultValue="#000000"
                  onPick={(color) => exec('foreColor', color)}
                />
                <ColorButton
                  icon={Highlighter}
                  label={t('mailInbox.highlight')}
                  defaultValue="#ffff00"
                  onPick={(color) => exec('hiliteColor', color)}
                />
              </>
            )}
            {gi < groups.length - 1 && <Divider />}
          </div>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        onKeyUp={syncState}
        onMouseUp={syncState}
        onBlur={saveSelection}
        // Үндсэн хэлбэр (Arial 11 налуу) нь ЭНД CSS-ээр тавигдаж, илгээхдээ
        // `wrapMailBody` ижил утгыг inline style болгож давхарлана.
        style={MAIL_BODY_STYLE}
        className={cn(
          'min-h-[9rem] max-h-[40vh] overflow-y-auto overflow-x-hidden break-words px-3 py-2 outline-none',
          'empty:before:not-italic empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&_a]:text-primary [&_a]:underline',
          '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3',
          // Энэ бол `contentEditable` — хүүхэд DOM нь хэрэглэгчийн БУУЛГАСАН
          // дурын HTML (Outlook/Excel хүснэгт, гарын үсгийн зураг, урт URL).
          // Өргөнийг хязгаарлахгүй бол compose цонх хажуу тийш гүйнэ.
          '[&_img]:max-w-full [&_img]:h-auto [&_table]:!w-full [&_table]:!table-fixed',
        )}
      />
    </div>
  );
}

type ToolItem = {
  icon: typeof Bold;
  label: string;
  /** execCommand нэр — идэвхтэй төлвийг мөн үүгээр уншина. */
  cmd?: string;
  run?: () => void;
};

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border/70" />;
}

function ToolButton({
  item,
  active,
  onRun,
}: {
  item: ToolItem;
  active: boolean;
  onRun: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      title={item.label}
      aria-label={item.label}
      aria-pressed={active}
      // preventDefault keeps the editor selection while clicking the toolbar
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={cn(
        'rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground',
        active && 'bg-muted text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** Өнгө сонгогч — native `<input type="color">`-ыг товчны ард нуусан. */
function ColorButton({
  icon: Icon,
  label,
  defaultValue,
  onPick,
}: {
  icon: typeof Bold;
  label: string;
  defaultValue: string;
  onPick: (color: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title={label}
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Icon className="h-4 w-4" />
      </button>
      <input
        ref={inputRef}
        type="color"
        defaultValue={defaultValue}
        onChange={(e) => onPick(e.target.value)}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/2 h-0 w-0 opacity-0"
      />
    </span>
  );
}
