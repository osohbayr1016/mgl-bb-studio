/**
 * Чирж тавихын нийтлэг туслахууд (2026-09-18):
 *   • ГАДНААС (компьютерээс) файл/хавтас чирэх — `dataTransfer.types` дотор `Files`;
 *   • ДОТООД — жагсаалтын мөрийг чирэх (`DRIVE_DRAG_MIME`, зөөх).
 * Хавтасны мөр, breadcrumb-ын зангилаа, жагсаалтын бүс хоёр төрлийг хүлээж
 * авна: гаднаас → тэр хавтсанд байршуулна, дотоод → тэр хавтас руу зөөнө.
 * Үйл явдлын ганц эзэн нь `useDriveDragSession` (document-түвшин).
 *
 * Spring-load: чирж буй зүйлээ хавтас дээр `SPRING_OPEN_MS` барихад хавтас
 * нээгдэнэ (macOS Finder-ийн загвар) — чирэлт хуудас дотор үргэлжилдэг тул
 * гүн хавтас руу навигац хийгээд тавьж болно.
 */
import { DRIVE_DRAG_MIME, type DriveDragPayload } from './types';

/** Хавтас дээр барих хугацаа (эзний хүсэлт «~2 секунд» — 1.5 с нь гар дээр
 *  «удаан» биш, санамсаргүй нээгдэхээргүй урт). */
export const SPRING_OPEN_MS = 1500;

export type DragKind = 'files' | 'item' | 'none';

/** `dragenter`/`dragover` дээр `getData` хоосон байдаг (аюулгүй байдал) — зөвхөн `types`. */
export function dragKind(dt: DataTransfer | null): DragKind {
  if (!dt) return 'none';
  const types = Array.from(dt.types ?? []);
  if (types.includes(DRIVE_DRAG_MIME)) return 'item';
  if (types.includes('Files')) return 'files';
  return 'none';
}

export function setDragPayload(dt: DataTransfer, payload: DriveDragPayload): void {
  dt.setData(DRIVE_DRAG_MIME, JSON.stringify(payload));
  // Firefox чирэлт эхлүүлэхэд ямар нэг `text/*` шаарддаг.
  dt.setData('text/plain', payload.name);
  dt.effectAllowed = 'move';
}

/** `drop` дээр л уншигдана. */
export function readDragPayload(dt: DataTransfer): DriveDragPayload | null {
  try {
    const raw = dt.getData(DRIVE_DRAG_MIME);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<DriveDragPayload>;
    if (typeof p.id !== 'string' || typeof p.name !== 'string') return null;
    return { id: p.id, name: p.name, kind: p.kind === 'folder' || p.kind === 'shortcut' ? p.kind : 'file' };
  } catch {
    return null;
  }
}
