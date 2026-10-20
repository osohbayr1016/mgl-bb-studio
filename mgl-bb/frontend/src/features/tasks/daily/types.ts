/**
 * Өдөр тутмын тайлагналын дундын төрлүүд.
 *
 * `MyTasksPage` болон `daily/*` бүрэлдэхүүнүүд эдгээрийг хуваалцана —
 * ноорог (draft) нь localStorage-д цувдаг тул хэлбэрийг нэг газарт
 * барих нь чухал: хадгалагдсан хуучин хэлбэрийг уншихад `sanitizeDraft`
 * л хамгаалалт болно.
 */

/** Нэг тайланд хавсаргасан файл — backend `ProgressAttachment`-ийн толь. */
export interface ReportAttachment {
  /** ҮРГЭЛЖ `/media/<key>` (сервер талд шалгагддаг). */
  url: string;
  name: string;
  type?: string;
  size?: number;
}

/** Мөрийн бөглөж буй өдрийн тайлан — илгээгдэх хүртэл localStorage-д. */
export interface DailyDraft {
  /** Хувь — string, учир нь хоосон/хагас бичсэн төлөвийг хадгална. */
  value: string;
  notes: string;
  attachments: ReportAttachment[];
}

export const EMPTY_DRAFT: DailyDraft = { value: '', notes: '', attachments: [] };

/** `GET /api/progress/my-recent` -ийн нэг мөр. */
export interface RecentReport {
  id: number;
  task_id: number;
  task_name: string;
  project_id: number;
  project_name: string;
  percentage: number;
  date: string;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  attachments: ReportAttachment[];
  is_rest_day: boolean;
  defer_next_day: boolean;
  created_at: string;
  reviewer_name?: string | null;
}

export interface RecentReportsResponse {
  entries: RecentReport[];
  from: string;
  to: string;
  today: string;
  days: number;
}

/** `GET /api/tasks/:id/checklist` -ийн нэг мөр. */
export interface ChecklistItem {
  id: number;
  task_id: number;
  text: string;
  is_done: 0 | 1;
  sort_order: number;
  created_at: string;
  done_at: string | null;
}

/** Ноорогийг гаднаас (localStorage) уншихад хэлбэрийг нь албадана.
 *  Хуучин хувилбар (`image: string | null`) хадгалагдсан байвал ганц
 *  зургийг нь шинэ хавсралтын жагсаалт болгож залгамжилна. */
export function sanitizeDraft(raw: unknown): DailyDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const value = typeof o.value === 'string' ? o.value.slice(0, 8) : '';
  const notes = typeof o.notes === 'string' ? o.notes.slice(0, 4000) : '';

  const attachments: ReportAttachment[] = [];
  if (Array.isArray(o.attachments)) {
    for (const item of o.attachments.slice(0, 10)) {
      if (!item || typeof item !== 'object') continue;
      const a = item as Record<string, unknown>;
      if (typeof a.url !== 'string' || !a.url.startsWith('/media/')) continue;
      attachments.push({
        url: a.url,
        name: typeof a.name === 'string' ? a.name : a.url.slice('/media/'.length),
        ...(typeof a.type === 'string' ? { type: a.type } : {}),
        ...(typeof a.size === 'number' ? { size: a.size } : {}),
      });
    }
  } else if (typeof o.image === 'string' && o.image.startsWith('/media/')) {
    attachments.push({ url: o.image, name: o.image.slice('/media/'.length), type: 'image/*' });
  }

  if (!value && !notes && attachments.length === 0) return null;
  return { value, notes, attachments };
}

/** Хавсралт зураг мөн үү — жижиг зураглал үзүүлэх эсэхийг шийднэ. */
export function isImageAttachment(a: ReportAttachment): boolean {
  if (a.type?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|avif)$/i.test(a.url);
}

/** `1.4 MB` маягийн богино хэмжээ. */
export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
