/**
 * Програмын хүсэлтийн шошго, өнгө — ГАНЦ газар (жагсаалт, дэлгэрэнгүй, илгээх цонх бүгд эндээс).
 * Төлөвийн НИЙТИЙН нэрийг (илгээгчид харагдах) сервер `status_label`-аар өгдөг; reviewer нь энд байгаа
 * нарийн нэрийг хардаг.
 */
import type { EfPriority, EfSource, EfStatus, EfType } from './api';

export const EF_STATUS_ORDER: EfStatus[] = [
  'received',
  'triaged',
  'in_progress',
  'awaiting_info',
  'ready_for_retest',
  'reopened',
  'resolved',
  'duplicate',
  'rejected',
];

export const EF_OPEN_STATUSES: EfStatus[] = ['received', 'triaged', 'in_progress', 'awaiting_info', 'ready_for_retest', 'reopened'];

export const EF_TYPES: EfType[] = ['bug', 'improvement', 'question'];
export const EF_SOURCES: EfSource[] = ['wall_elevation', 'revit_tool', 'erp', 'other'];
export const EF_PRIORITIES: EfPriority[] = ['critical', 'high', 'normal', 'low'];

export const statusKey = (s: EfStatus) => `engFeedback.status.${s}`;
export const typeKey = (s: EfType) => `engFeedback.type.${s}`;
export const sourceKey = (s: EfSource) => `engFeedback.source.${s}`;
export const priorityKey = (s: EfPriority) => `engFeedback.priority.${s}`;

/** Зөөлөн badge — semantic token (status-colors.ts-ийн загвар). */
export const STATUS_TONE: Record<EfStatus, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  received: 'bg-info/10 text-info border-info/30',
  triaged: 'bg-info/10 text-info border-info/30',
  in_progress: 'bg-primary/10 text-primary border-primary/30',
  awaiting_info: 'bg-warning/10 text-warning border-warning/30',
  ready_for_retest: 'bg-warning/10 text-warning border-warning/30',
  resolved: 'bg-success/10 text-success border-success/30',
  duplicate: 'bg-muted text-muted-foreground border-border',
  rejected: 'bg-danger/10 text-danger border-danger/30',
  reopened: 'bg-danger/10 text-danger border-danger/30',
};

export const PRIORITY_TONE: Record<EfPriority, string> = {
  low: 'bg-muted text-muted-foreground border-border',
  normal: 'bg-muted text-foreground border-border',
  high: 'bg-warning/10 text-warning border-warning/30',
  critical: 'bg-danger/10 text-danger border-danger/30',
};

export function formatBytes(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Файлын нэрийн өргөтгөл (жижиг үсгээр, цэггүй). */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Идемпотентын клиент түлхүүр (сервер 8–80 тэмдэгт, `[A-Za-z0-9_-]`-ийг хүлээн авна). */
export function newClientId(prefix: string): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? (crypto as Crypto).randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${rnd}`.slice(0, 60);
}
