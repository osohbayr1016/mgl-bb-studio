import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';

/** Зөвхөн ФАЙЛ чирч байгаа эсэх — текст/сонголт чирэхэд оверлэй гарах ёсгүй. */
function hasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return Array.from(dt.types).includes('Files');
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true;
}

interface DropOptions {
  /** Ctrl+V-ээр буулгасан файл.  Хавтас clipboard дээр ХЭЗЭЭ Ч ирдэггүй. */
  onFiles?: (list: FileList | null) => void | Promise<void>;
  /** Чирж буулгасан зүйл — бүтэн хавтасны мод уншихад `DataTransfer` хэрэгтэй. */
  onDrop?: (dt: DataTransfer) => void | Promise<void>;
}

/**
 * Windows-ынх шиг чирж оруулах (drag & drop) болон хуулж буулгах (Ctrl+V).
 *
 * Хоёр нарийн зүйл:
 *  - `dragover` дээр `preventDefault()` дуудахгүй бол браузер файлыг өөрөө
 *    нээж, апп-аас гарна.  Тиймээс цонхны түвшинд ч мөн барьж, оноогүй
 *    буултыг «юу ч болохгүй» болгож дардаг.
 *  - Хүүхэд элемент дээгүүр өнгөрөхөд `dragenter`/`dragleave` дараалан
 *    дуудагддаг тул гүнийг тоолж байж оверлэй анивчихгүй.
 */
export function useExplorerDrop(
  onFiles?: DropOptions['onFiles'],
  onDrop?: DropOptions['onDrop'],
) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const filesCb = useRef(onFiles);
  filesCb.current = onFiles;
  const dropCb = useRef(onDrop);
  dropCb.current = onDrop;

  const reset = useCallback(() => {
    depth.current = 0;
    setDragging(false);
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const files = e.clipboardData?.files;
      if (!files?.length || !filesCb.current) return;
      e.preventDefault();
      void filesCb.current(files);
    };
    // Хавтаснаас гадуур буулгасан файлыг браузер нээхээс сэргийлнэ.
    const swallow = (e: Event) => {
      if (hasFiles((e as globalThis.DragEvent).dataTransfer)) e.preventDefault();
    };
    const onWindowDrop = (e: Event) => {
      swallow(e);
      reset();
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', onWindowDrop);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', onWindowDrop);
      window.removeEventListener('dragend', reset);
    };
  }, [reset]);

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      reset();
      // `dataTransfer` нь эвент дуусахад хоосордог тул хүлээхгүйгээр дамжуулна —
      // `scanDataTransfer` дотор эхний алхам нь синхрон.
      if (dropCb.current) void dropCb.current(e.dataTransfer);
      else if (filesCb.current) void filesCb.current(e.dataTransfer.files);
    },
    [reset],
  );

  return {
    dragging,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop: handleDrop },
  };
}
