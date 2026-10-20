/**
 * Чирж тавих — ГАНЦ document-түвшний session (2026-09-18).
 *
 * Яагаад элемент бүрийн `dragenter`/`dragleave` тоолуур БИШ вэ (өмнөх хувилбар):
 *   • хавтасны мөр `stopPropagation` хийхэд эцэг бүсийн тоолуур зөрж overlay
 *     ГАЦДАГ; чирэлтийг цонхноос гаргах / Esc дарахад `dragleave` заримдаа
 *     ирдэггүй тул highlight + spring таймер ҮЛДЭЖ, 1.5 с-ийн дараа хавтас
 *     гэнэт нээгддэг байв;
 *   • зорилтот бүсээс ГАДНА буулгахад хөтөч файлыг өөрөө нээж (PDF таб),
 *     SPA-аас гардаг байв — «буруу файл чирээд болих» боломжгүй.
 *
 * Одоо: чирэлт идэвхтэй үед document дээр `dragover`/`drop`-ыг барьж
 * хөтчийн default-ыг ХААНА (юу ч буулгасан навигац болохгүй); зорилтыг
 * `e.target.closest('[data-drop-kind]')`-оор олно (тоолуургүй, зөрөхгүй);
 * session нь `dragend` · цонхноос гарах `dragleave` · document-ийн `drop` ·
 * Esc (хөтөч чирэлтийг цуцалдаг) · ба **хамгаалалтын таймер** (WATCHDOG_MS
 * дотор `dragover` ирэхгүй бол чирэлт дууссан гэж үзнэ — хөтөч чирэлтийн
 * турш `dragover`-ыг ~50–350 мс тутам ДАВТАН илгээдэг) — аль нь ч түрүүлж
 * ирсэн бол ЦЭВЭРЛЭНЭ.  Spring-open таймер зорилт солигдох / session
 * дуусах бүрд цуцлагдана.
 *
 * Зорилтот элементийн атрибут: `data-drop-kind` (`folder` | `crumb` | `zone`),
 * `data-drop-id` (Drive id эсвэл 'root'), `data-drop-name`.
 */
import { useEffect, useRef, useState } from 'react';
import { SPRING_OPEN_MS, dragKind, readDragPayload, type DragKind } from './driveDnd';
import type { DriveDragPayload } from './types';

export type DropTargetKind = 'folder' | 'crumb' | 'zone';

export interface DropTarget {
  kind: DropTargetKind;
  id: string;
  name: string;
}

/** `dragover` хооронд энэ хугацаанаас илүү чимээгүй бол чирэлт дууссан.  Хөтөч
 *  хулгана хөдлөхгүй байхад ч `dragover`-ыг 350 ± 200 мс тутам илгээдэг (HTML
 *  спец) тул 1.2 с нь худал «дууссан» гаргахгүй. */
export const WATCHDOG_MS = 1200;
/** `dragleave`-ийн дараа энэ хугацаанд `dragover` ирэхгүй бол цонхноос гарсан /
 *  Esc дарсан гэж үзнэ.  ⚠️ Chrome `dragleave`-ийн `relatedTarget`-ыг гаднаас
 *  чирсэн файлд ҮРГЭЛЖ null өгдөг тул «цонхноос гарлаа» гэдгийг relatedTarget-оор
 *  ялгаж БОЛОХГҮЙ — хугацаагаар л. */
export const LEAVE_MS = 700;

export function parseDropTarget(el: Element | null): DropTarget | null {
  const host = el?.closest<HTMLElement>('[data-drop-kind]') ?? null;
  if (!host) return null;
  const kind = host.dataset.dropKind;
  const id = host.dataset.dropId;
  if ((kind !== 'folder' && kind !== 'crumb' && kind !== 'zone') || !id) return null;
  return { kind, id, name: host.dataset.dropName ?? '' };
}

export interface DragSessionHandlers {
  /** Гаднаас чирсэн файл/хавтас → зорилтод байршуулна. */
  onDropFiles: (dt: DataTransfer, target: DropTarget) => void;
  /** Жагсаалтын мөр → зорилт руу зөөнө. */
  onDropItem: (payload: DriveDragPayload, target: DropTarget) => void;
  /** Хавтасны мөр дээр `SPRING_OPEN_MS` барихад — нээнэ. */
  onSpringOpen: (folderId: string) => void;
}

export interface DragSessionState {
  /** Идэвхтэй чирэлтийн төрөл; null = чирэлт алга. */
  active: DragKind | null;
  /** Одоо хулгана доор байгаа зорилт (highlight). */
  over: DropTarget | null;
}

export function useDriveDragSession(enabled: boolean, handlers: DragSessionHandlers): DragSessionState {
  const [state, setState] = useState<DragSessionState>({ active: null, over: null });
  // Хамгийн сүүлийн handler-ууд — document сонсогчид дахин бүртгэлгүйгээр хүрнэ
  // (React Compiler-ийн дүрэм: ref-ийг render дотор биш, effect дотор бичнэ).
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    let active: DragKind | null = null;
    let over: DropTarget | null = null;
    let watchdog: number | null = null;
    let spring: number | null = null;

    const emit = () => setState({ active, over });
    const clearSpring = () => {
      if (spring !== null) {
        window.clearTimeout(spring);
        spring = null;
      }
    };
    const clearWatchdog = () => {
      if (watchdog !== null) {
        window.clearTimeout(watchdog);
        watchdog = null;
      }
    };
    const end = () => {
      clearSpring();
      clearWatchdog();
      if (active === null && over === null) return;
      active = null;
      over = null;
      emit();
    };
    const armWatchdog = (ms: number) => {
      clearWatchdog();
      watchdog = window.setTimeout(end, ms);
    };
    const setOver = (next: DropTarget | null) => {
      const same = next?.kind === over?.kind && next?.id === over?.id;
      if (same) return;
      over = next;
      clearSpring();
      // Spring-load зөвхөн хавтасны МӨР дээр — бүс/breadcrumb дээр биш.
      if (next?.kind === 'folder') {
        const folderId = next.id;
        spring = window.setTimeout(() => {
          spring = null;
          handlersRef.current.onSpringOpen(folderId);
        }, SPRING_OPEN_MS);
      }
      emit();
    };

    const onDragOver = (e: DragEvent) => {
      const kind = dragKind(e.dataTransfer);
      if (kind === 'none') return;
      // Хөтчийн default (файлыг таб дээр нээх) хаагдана — зорилтгүй газар ч.
      e.preventDefault();
      const target = parseDropTarget(e.target as Element | null);
      if (e.dataTransfer) e.dataTransfer.dropEffect = target ? (kind === 'item' ? 'move' : 'copy') : 'none';
      if (active !== kind) {
        active = kind;
        emit();
      }
      armWatchdog(WATCHDOG_MS);
      setOver(target);
    };
    const onDrop = (e: DragEvent) => {
      const kind = dragKind(e.dataTransfer);
      if (kind === 'none') return;
      e.preventDefault();
      const target = parseDropTarget(e.target as Element | null);
      const dt = e.dataTransfer;
      end();
      if (!target || !dt) return;
      if (kind === 'item') {
        const payload = readDragPayload(dt);
        if (payload && payload.id !== target.id) handlersRef.current.onDropItem(payload, target);
        return;
      }
      handlersRef.current.onDropFiles(dt, target);
    };
    // Элемент хооронд шилжихэд ч `dragleave` ирдэг — шууд дуусгахгүй, богино
    // хугацаанд `dragover` дахин ирэхгүй бол л (цонхноос гарсан / Esc) дуусгана.
    const onDragLeave = () => {
      if (active !== null) armWatchdog(LEAVE_MS);
    };
    const onDragEnd = () => end();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end();
    };

    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragend', onDragEnd);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onDragEnd);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragend', onDragEnd);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onDragEnd);
      clearSpring();
      clearWatchdog();
    };
  }, [enabled]);

  return state;
}
