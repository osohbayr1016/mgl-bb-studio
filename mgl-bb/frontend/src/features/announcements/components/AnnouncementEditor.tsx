import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALargeSmall,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  FileUp,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Indent,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Outdent,
  Paperclip,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  Trash2,
  Underline,
  Undo2,
  Unlink,
} from 'lucide-react';

import { mediaUrl, uploadFile } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';

/**
 * Нийтийн мэдээлэл + Дотоод журмын засварлагч — `contentEditable` гадаргуу +
 * `execCommand` toolbar (нэмэлт засварлагчийн сангүй).  Мэйлийн
 * `RichTextEditor`-той ижил механик (сонголтыг `savedRange`-д хадгалж, exec
 * бүрийн өмнө сэргээнэ).  Хэрэгслүүд: гарчиг (H2/H3), үсгийн хэмжээ,
 * тод/налуу/доогуур/дундуур зураас, дээд/доод индекс, өнгө, жагсаалт,
 * догол, тэгшлэх (4), холбоос, ЗУРАГ (файл сонгох / буулгах / чирж тавих →
 * `uploadFile` → `/media/<key>`), ХҮСНЭГТ (оруулах + мөр/багана нэмэх/хасах),
 * зураас, **Word (.docx) файлаас оруулах** (`mammoth`, lazy chunk), ФАЙЛ
 * ХАВСРАЛТ (`onAttachFiles` өгсөн үед л — Дотоод журам), бүтэн дэлгэц.
 *
 * Uncontrolled: `defaultHtml`-ээс нэг удаа ачаалж, амьд HTML-ийг `onChange`-ээр
 * мэдэгдэнэ.  Эцэг `key`-ээр дахин ачаална.
 *
 * ⚠️ Гарч буй HTML нь ЦЭВЭР БИШ — сервер (`lib/announcements.ts sanitizeHtml`)
 * хадгалахдаа цагаан жагсаалтаар цэвэрлэнэ; хөтөч дээр итгэдэггүй.  Шинэ
 * хэрэгсэл нэмэхдээ түүний үүсгэх таг/style тэр жагсаалтад байгаа эсэхийг
 * шалга (хүснэгт, sub/sup, `font-size`, `text-align: justify` бүгд байгаа).
 */
export function AnnouncementEditor({
  defaultHtml = '',
  onChange,
  placeholder,
  className,
  onAttachFiles,
}: {
  defaultHtml?: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /**
   * Өгвөл toolbar-т «Файл хавсаргах» товч гарч, засварлагч руу чирсэн
   * ЗУРАГ БИШ файл (PDF, Word…) мөн энд очно.  Зураг үргэлж бичвэрт орно.
   */
  onAttachFiles?: (files: File[]) => void;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wordRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [block, setBlock] = useState<string>('p');
  const [inTable, setInTable] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== defaultHtml) ref.current.innerHTML = defaultHtml;
    // Seed once on mount; parent remounts via key to reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Бүтэн дэлгэцээс Esc-ээр гарна.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const emit = useCallback(() => onChange(ref.current?.innerHTML ?? ''), [onChange]);

  const saveSelection = useCallback(() => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
  }, []);

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
      subscript: state('subscript'),
      superscript: state('superscript'),
      insertUnorderedList: state('insertUnorderedList'),
      insertOrderedList: state('insertOrderedList'),
      justifyLeft: state('justifyLeft'),
      justifyCenter: state('justifyCenter'),
      justifyRight: state('justifyRight'),
      justifyFull: state('justifyFull'),
    });
    let cur: Node | null = node;
    let found = 'p';
    let table = false;
    while (cur && cur !== el) {
      const tag = (cur as Element).tagName?.toLowerCase();
      if (found === 'p' && (tag === 'h2' || tag === 'h3' || tag === 'blockquote')) found = tag;
      if (tag === 'td' || tag === 'th') table = true;
      cur = cur.parentNode;
    }
    setBlock(found);
    setInTable(table);
  }, []);

  useEffect(() => {
    const onSelectionChange = () => {
      saveSelection();
      syncState();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [saveSelection, syncState]);

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
      try {
        document.execCommand('styleWithCSS', false, 'true');
      } catch {
        /* Safari */
      }
      document.execCommand(command, false, value);
      saveSelection();
      emit();
      syncState();
    },
    [emit, focusEditor, saveSelection, syncState],
  );

  /** HTML-ийг курсорын байрлалд оруулна; засварлагч хоосон бол бүхэлд нь солино. */
  const insertHtmlAtCaret = useCallback(
    (html: string) => {
      const el = ref.current;
      if (!el) return;
      const empty = el.textContent?.trim() === '' && !el.querySelector('img,table');
      if (empty) {
        el.innerHTML = html;
      } else {
        focusEditor();
        document.execCommand('insertHTML', false, html);
      }
      saveSelection();
      emit();
      syncState();
    },
    [emit, focusEditor, saveSelection, syncState],
  );

  const setBlockTag = useCallback(
    (tag: 'p' | 'h2' | 'h3' | 'blockquote') => {
      // Ижил блок дээр дахин дарвал догол мөр рүү буцна.
      exec('formatBlock', `<${block === tag ? 'p' : tag}>`);
    },
    [block, exec],
  );

  /**
   * Үсгийн хэмжээ — `execCommand('fontSize', '7')`-ийн тэмдэглэгээг манай rem
   * утгаар солино (хөтчийн 1-7 шатлал нь `xxx-large` гэх мэт үгээр гардаг,
   * `text-sm` суурьтай бичвэрт «Хэвийн» нь томордог).  rem тул үүрлэсэн span
   * бие биеэ үржүүлэхгүй.
   */
  const applyFontSize = useCallback(
    (size: string) => {
      const el = ref.current;
      if (!el) return;
      focusEditor();
      try {
        document.execCommand('styleWithCSS', false, 'true');
      } catch {
        /* Safari */
      }
      document.execCommand('fontSize', false, '7');
      el.querySelectorAll<HTMLElement>('span[style*="xxx-large"], font[size="7"]').forEach((node) => {
        if (node.tagName === 'FONT') {
          const span = document.createElement('span');
          span.style.fontSize = size;
          while (node.firstChild) span.appendChild(node.firstChild);
          node.replaceWith(span);
        } else {
          node.style.fontSize = size;
        }
      });
      saveSelection();
      emit();
    },
    [emit, focusEditor, saveSelection],
  );

  const insertLink = useCallback(() => {
    saveSelection();
    const url = window.prompt(t('announcements.editor.linkPrompt'));
    if (!url) return;
    const href = /^(https?:|mailto:|tel:|\/|#)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    const sel = savedRange.current;
    if (sel && sel.collapsed) {
      // Сонголтгүй бол URL-ийг өөрийг нь холбоос болгож оруулна.
      focusEditor();
      document.execCommand('insertHTML', false, `<a href="${href.replace(/"/g, '&quot;')}">${href.replace(/</g, '&lt;')}</a>`);
      saveSelection();
      emit();
      return;
    }
    exec('createLink', href);
  }, [emit, exec, focusEditor, saveSelection, t]);

  /* ---------------- Хүснэгт ---------------- */

  const insertTable = useCallback(
    (rows: number, cols: number) => {
      const cell = '<td><br></td>';
      const row = `<tr>${cell.repeat(cols)}</tr>`;
      // Хүснэгтийн дараах хоосон догол мөр — курсор хүснэгтээс гарах газар.
      insertHtmlAtCaret(`<table><tbody>${row.repeat(rows)}</tbody></table><p><br></p>`);
    },
    [insertHtmlAtCaret],
  );

  const currentCell = useCallback((): HTMLTableCellElement | null => {
    const el = ref.current;
    const node = savedRange.current?.startContainer ?? window.getSelection()?.anchorNode ?? null;
    const start = node instanceof Element ? node : node?.parentElement;
    const cell = start?.closest('td,th') as HTMLTableCellElement | null | undefined;
    return cell && el?.contains(cell) ? cell : null;
  }, []);

  const tableOp = useCallback(
    (op: 'rowAbove' | 'rowBelow' | 'colLeft' | 'colRight' | 'delRow' | 'delCol' | 'delTable') => {
      const cell = currentCell();
      if (!cell) return;
      const row = cell.parentElement as HTMLTableRowElement;
      const table = cell.closest('table');
      if (!table) return;
      const newCell = (tag: string) => {
        const c = document.createElement(tag);
        c.innerHTML = '<br>';
        return c;
      };
      if (op === 'rowAbove' || op === 'rowBelow') {
        const clone = document.createElement('tr');
        for (const c of Array.from(row.cells)) {
          const n = newCell(c.tagName.toLowerCase());
          if (c.colSpan > 1) (n as HTMLTableCellElement).colSpan = c.colSpan;
          clone.appendChild(n);
        }
        if (op === 'rowAbove') row.before(clone);
        else row.after(clone);
      } else if (op === 'colLeft' || op === 'colRight') {
        const index = cell.cellIndex;
        for (const r of Array.from(table.rows)) {
          const anchor = r.cells[Math.min(index, r.cells.length - 1)];
          const n = newCell(anchor?.tagName.toLowerCase() ?? 'td');
          if (!anchor) r.appendChild(n);
          else if (op === 'colLeft') anchor.before(n);
          else anchor.after(n);
        }
      } else if (op === 'delRow') {
        row.remove();
        if (table.rows.length === 0) table.remove();
      } else if (op === 'delCol') {
        const index = cell.cellIndex;
        for (const r of Array.from(table.rows)) r.cells[Math.min(index, r.cells.length - 1)]?.remove();
        if (Array.from(table.rows).every((r) => r.cells.length === 0)) table.remove();
      } else {
        table.remove();
      }
      savedRange.current = null;
      emit();
      syncState();
    },
    [currentCell, emit, syncState],
  );

  /* ---------------- Зураг ---------------- */

  /** Зураг → R2 → `<img src="<абсолют>/media/<key>">`.  Хадгалахдаа `toStoredHtml` харьцангуй болгоно. */
  const insertImages = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;
      setUploading(true);
      try {
        for (const file of images) {
          const url = await uploadFile(file);
          focusEditor();
          document.execCommand(
            'insertHTML',
            false,
            `<img src="${mediaUrl(url)}" alt="${file.name.replace(/"/g, '')}" style="max-width: 100%"><br>`,
          );
          saveSelection();
        }
        emit();
      } catch (err) {
        console.error('[announcements] image upload failed', err);
        toast.error(t('announcements.editor.imageFailed'), err instanceof Error ? err.message : undefined);
      } finally {
        setUploading(false);
      }
    },
    [emit, focusEditor, saveSelection, t],
  );

  /* ---------------- Word (.docx) → HTML ---------------- */

  /**
   * Word баримтыг бүтэцтэй нь (гарчиг, жагсаалт, хүснэгт, тод/налуу, зураг)
   * HTML болгож оруулна.  `mammoth` нь ~170 KB gzip тул зөвхөн энд dynamic
   * import.  Word-ийн зураг `/media`-д байршина (гараар оруулсан зурагтай
   * ижил); EMF/WMF зэрэг хөтөч үзүүлж чадахгүй зураг алгасагдана.  Word-ийн
   * тэгшлэл, үсгийн хэмжээ зориуд шилждэггүй — утгын бүтэц л (mammoth-ийн
   * зарчим), дараа нь toolbar-аар засна.
   */
  const importWord = useCallback(
    async (file: File) => {
      if (!/\.docx$/i.test(file.name)) {
        toast.error(t('announcements.editor.wordOnlyDocx'));
        return;
      }
      setImporting(true);
      try {
        const mammoth = (await import('mammoth')).default;
        let skipped = 0;
        const result = await mammoth.convertToHtml(
          { arrayBuffer: await file.arrayBuffer() },
          {
            styleMap: [
              "p[style-name='Title'] => h1:fresh",
              "p[style-name='Subtitle'] => h2:fresh",
              "p[style-name='Heading 1'] => h2:fresh",
              "p[style-name='Heading 2'] => h3:fresh",
              "p[style-name='Heading 3'] => h4:fresh",
            ],
            convertImage: mammoth.images.imgElement(async (image) => {
              if (!/^image\/(png|jpe?g|gif|webp)$/i.test(image.contentType)) {
                skipped += 1;
                return { src: '' };
              }
              const buf = await image.readAsArrayBuffer();
              const ext = image.contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
              const url = await uploadFile(new File([buf], `word-image.${ext}`, { type: image.contentType }));
              return { src: mediaUrl(url) };
            }),
          },
        );
        const html = result.value.trim();
        if (!html) {
          toast.warn(t('announcements.editor.wordEmpty'));
          return;
        }
        insertHtmlAtCaret(html);
        toast.success(
          t('announcements.editor.wordImported', { name: file.name }),
          skipped > 0 ? t('announcements.editor.wordImagesSkipped', { count: skipped }) : undefined,
        );
      } catch (err) {
        console.error('[editor] word import failed', err);
        toast.error(t('announcements.editor.wordFailed'), err instanceof Error ? err.message : undefined);
      } finally {
        setImporting(false);
      }
    },
    [insertHtmlAtCaret, t],
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        e.preventDefault();
        void insertImages(files);
      }
    },
    [insertImages],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const all = Array.from(e.dataTransfer?.files ?? []);
      if (all.length === 0) return;
      const images = all.filter((f) => f.type.startsWith('image/'));
      const others = all.filter((f) => !f.type.startsWith('image/'));
      if (images.length === 0 && (others.length === 0 || !onAttachFiles)) return;
      e.preventDefault();
      if (images.length > 0) void insertImages(images);
      if (others.length > 0 && onAttachFiles) onAttachFiles(others);
    },
    [insertImages, onAttachFiles],
  );

  const fontSizes: { label: string; size: string }[] = [
    { label: t('announcements.editor.sizeSmall'), size: '0.75rem' },
    { label: t('announcements.editor.sizeNormal'), size: '0.875rem' },
    { label: t('announcements.editor.sizeLarge'), size: '1.125rem' },
    { label: t('announcements.editor.sizeXLarge'), size: '1.5rem' },
    { label: t('announcements.editor.sizeHuge'), size: '2rem' },
  ];

  const groups: { key: string; items: ToolItem[]; extra?: React.ReactNode }[] = [
    {
      key: 'block',
      items: [
        { icon: Pilcrow, label: t('announcements.editor.paragraph'), run: () => setBlockTag('p'), active: block === 'p' },
        { icon: Heading2, label: t('announcements.editor.heading'), run: () => setBlockTag('h2'), active: block === 'h2' },
        { icon: Heading3, label: t('announcements.editor.subheading'), run: () => setBlockTag('h3'), active: block === 'h3' },
        { icon: Quote, label: t('announcements.editor.quote'), run: () => setBlockTag('blockquote'), active: block === 'blockquote' },
      ],
      extra: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={t('announcements.editor.fontSize')}
              aria-label={t('announcements.editor.fontSize')}
              onMouseDown={(e) => e.preventDefault()}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              data-testid="editor-font-size"
            >
              <ALargeSmall className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
            {fontSizes.map((f) => (
              <DropdownMenuItem key={f.size} onSelect={() => applyFontSize(f.size)}>
                <span style={{ fontSize: f.size }}>{f.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
    {
      key: 'marks',
      items: [
        { icon: Bold, label: t('mailInbox.bold'), cmd: 'bold' },
        { icon: Italic, label: t('mailInbox.italic'), cmd: 'italic' },
        { icon: Underline, label: t('mailInbox.underline'), cmd: 'underline' },
        { icon: Strikethrough, label: t('mailInbox.strikethrough'), cmd: 'strikeThrough' },
        { icon: Superscript, label: t('announcements.editor.superscript'), cmd: 'superscript' },
        { icon: Subscript, label: t('announcements.editor.subscript'), cmd: 'subscript' },
      ],
      extra: (
        <>
          <ColorButton icon={Baseline} label={t('mailInbox.textColor')} defaultValue="#000000" onPick={(c) => exec('foreColor', c)} />
          <ColorButton icon={Highlighter} label={t('mailInbox.highlight')} defaultValue="#ffff00" onPick={(c) => exec('hiliteColor', c)} />
        </>
      ),
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
      key: 'align',
      items: [
        { icon: AlignLeft, label: t('mailInbox.alignLeft'), cmd: 'justifyLeft' },
        { icon: AlignCenter, label: t('mailInbox.alignCenter'), cmd: 'justifyCenter' },
        { icon: AlignRight, label: t('mailInbox.alignRight'), cmd: 'justifyRight' },
        { icon: AlignJustify, label: t('announcements.editor.alignJustify'), cmd: 'justifyFull' },
      ],
    },
    {
      key: 'insert',
      items: [
        { icon: LinkIcon, label: t('mailInbox.link'), run: insertLink },
        { icon: Unlink, label: t('mailInbox.removeLink'), cmd: 'unlink' },
        {
          icon: uploading ? Loader2 : ImagePlus,
          label: t('announcements.editor.image'),
          run: () => fileRef.current?.click(),
          spin: uploading,
        },
        { icon: Minus, label: t('mailInbox.horizontalRule'), run: () => exec('insertHorizontalRule') },
      ],
      extra: (
        <>
          <TablePicker label={t('announcements.editor.table')} onPick={insertTable} />
          <ToolButton
            item={{
              icon: importing ? Loader2 : FileUp,
              label: t('announcements.editor.importWord'),
              spin: importing,
            }}
            active={false}
            onRun={() => wordRef.current?.click()}
            testId="editor-import-word"
          />
          {onAttachFiles && (
            <ToolButton
              item={{ icon: Paperclip, label: t('announcements.editor.attachFile') }}
              active={false}
              onRun={() => attachRef.current?.click()}
              testId="editor-attach"
            />
          )}
        </>
      ),
    },
    {
      key: 'history',
      items: [
        { icon: RemoveFormatting, label: t('mailInbox.clearFormatting'), cmd: 'removeFormat' },
        { icon: Undo2, label: t('mailInbox.undo'), cmd: 'undo' },
        { icon: Redo2, label: t('mailInbox.redo'), cmd: 'redo' },
        {
          icon: fullscreen ? Minimize2 : Maximize2,
          label: fullscreen ? t('announcements.editor.exitFullscreen') : t('announcements.editor.fullscreen'),
          run: () => setFullscreen((f) => !f),
          active: fullscreen,
        },
      ],
    },
  ];

  const tableItems: ToolItem[] = [
    { icon: BetweenHorizontalStart, label: t('announcements.editor.rowAbove'), run: () => tableOp('rowAbove') },
    { icon: BetweenHorizontalEnd, label: t('announcements.editor.rowBelow'), run: () => tableOp('rowBelow') },
    { icon: BetweenVerticalStart, label: t('announcements.editor.colLeft'), run: () => tableOp('colLeft') },
    { icon: BetweenVerticalEnd, label: t('announcements.editor.colRight'), run: () => tableOp('colRight') },
  ];

  return (
    <div
      className={cn(
        'flex flex-col rounded-md border border-input bg-background',
        fullscreen && 'fixed inset-0 z-50 rounded-none border-0 pt-[env(safe-area-inset-top)]',
        className,
      )}
      data-fullscreen={fullscreen || undefined}
    >
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border/60 px-1.5 py-1">
        {groups.map((g, gi) => (
          <div key={g.key} className="flex items-center gap-0.5">
            {g.items.map((item) => (
              <ToolButton
                key={item.label}
                item={item}
                active={item.active ?? (!!item.cmd && !!marks[item.cmd])}
                onRun={() => (item.run ? item.run() : exec(item.cmd!))}
              />
            ))}
            {g.extra}
            {gi < groups.length - 1 && <Divider />}
          </div>
        ))}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void insertImages(files);
          }}
        />
        <input
          ref={wordRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          data-testid="editor-word-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importWord(file);
          }}
        />
        {onAttachFiles && (
          <input
            ref={attachRef}
            type="file"
            multiple
            className="hidden"
            data-testid="editor-attach-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length > 0) onAttachFiles(files);
            }}
          />
        )}
      </div>
      {inTable && (
        <div
          className="flex flex-wrap items-center gap-0.5 border-b border-border/60 bg-muted/40 px-1.5 py-1"
          data-testid="editor-table-tools"
        >
          <span className="mr-1 text-micro text-muted-foreground">{t('announcements.editor.table')}:</span>
          {tableItems.map((item) => (
            <ToolButton key={item.label} item={item} active={false} onRun={() => item.run?.()} />
          ))}
          <Divider />
          <TextToolButton label={t('announcements.editor.deleteRow')} onRun={() => tableOp('delRow')} />
          <TextToolButton label={t('announcements.editor.deleteCol')} onRun={() => tableOp('delCol')} />
          <ToolButton
            item={{ icon: Trash2, label: t('announcements.editor.deleteTable') }}
            active={false}
            onRun={() => tableOp('delTable')}
            testId="editor-table-delete"
          />
        </div>
      )}
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        data-testid="announcement-editor"
        onInput={emit}
        onKeyUp={syncState}
        onMouseUp={syncState}
        onBlur={saveSelection}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className={cn(
          'announcement-prose overflow-y-auto overflow-x-auto break-words px-4 py-3 text-sm outline-none',
          fullscreen ? 'mx-auto w-full max-w-4xl flex-1' : 'min-h-[18rem] max-h-[70vh]',
          'empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
        )}
      />
    </div>
  );
}

type ToolItem = {
  icon: typeof Bold;
  label: string;
  cmd?: string;
  run?: () => void;
  active?: boolean;
  spin?: boolean;
};

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border/70" />;
}

function ToolButton({
  item,
  active,
  onRun,
  testId,
}: {
  item: ToolItem;
  active: boolean;
  onRun: () => void;
  testId?: string;
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
      data-testid={testId}
      className={cn('rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground', active && 'bg-muted text-foreground')}
    >
      <Icon className={cn('h-4 w-4', item.spin && 'animate-spin')} />
    </button>
  );
}

/** Үгтэй жижиг товч — дүрсээр ялгахад бэрх үйлдэлд (мөр/багана устгах). */
function TextToolButton({ label, onRun }: { label: string; onRun: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className="rounded px-1.5 py-1 text-micro text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {label}
    </button>
  );
}

/** Хүснэгтийн хэмжээ сонгогч — Word-ийн шиг 8×8 торон дээр хулганаар. */
function TablePicker({ label, onPick }: { label: string; onPick: (rows: number, cols: number) => void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<{ r: number; c: number }>({ r: 2, c: 3 });
  const MAX = 8;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          onMouseDown={(e) => e.preventDefault()}
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          data-testid="editor-table"
        >
          <TableIcon className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start" onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${MAX}, 1rem)` }} onMouseDown={(e) => e.preventDefault()}>
          {Array.from({ length: MAX * MAX }, (_, i) => {
            const r = Math.floor(i / MAX) + 1;
            const c = (i % MAX) + 1;
            const on = r <= hover.r && c <= hover.c;
            return (
              <button
                key={i}
                type="button"
                aria-label={`${r} × ${c}`}
                onMouseEnter={() => setHover({ r, c })}
                onFocus={() => setHover({ r, c })}
                onClick={() => {
                  setOpen(false);
                  onPick(r, c);
                }}
                data-testid={`table-cell-${r}-${c}`}
                className={cn('h-4 w-4 rounded-[2px] border', on ? 'border-primary bg-primary/30' : 'border-border bg-background')}
              />
            );
          })}
        </div>
        <div className="mt-1.5 text-center text-micro text-muted-foreground">
          {hover.r} × {hover.c}
        </div>
      </PopoverContent>
    </Popover>
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
