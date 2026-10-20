/**
 * Кодоос i18n түлхүүр рүү — материалын төрөл, үйл явдлын төрөл, мэргэжлийн
 * хэсэг, төслийн төлөв.  ЦЭВЭР өгөгдөл: `t()`-г дуудагч өөрөө хэрэглэнэ.
 */
import type { TranslationKey } from '@/shared/i18n';

import type { ClientDashboardTab } from '../client-dashboard.types';

/** `client_publications.kind` (routes/clientAdmin.ts). */
export const MATERIAL_KIND_LABEL: Record<string, TranslationKey> = {
  deliverable: 'clientRoom.kind.deliverable',
  perf_report: 'clientRoom.kind.perf_report',
  asr: 'clientRoom.kind.asr',
  meeting_minutes: 'clientRoom.kind.meeting_minutes',
  document: 'clientRoom.kind.document',
  model: 'clientRoom.kind.model',
  notice: 'clientRoom.kind.notice',
};

/** `client_events.kind` (lib/clientEvents.ts → ClientEventKind). */
export const EVENT_KIND_LABEL: Record<string, TranslationKey> = {
  progress: 'clientRoom.event.progress',
  deliverable: 'clientRoom.event.deliverable',
  report: 'clientRoom.event.report',
  asr: 'clientRoom.event.asr',
  document: 'clientRoom.event.document',
  message: 'clientRoom.event.message',
  submission_reviewed: 'clientRoom.event.submission_reviewed',
  notice: 'clientRoom.event.notice',
  signature: 'clientRoom.event.signature',
};

/** Үйл явдал дээр дарахад аль хэсэг рүү очих. */
export const EVENT_TARGET_TAB: Record<string, ClientDashboardTab> = {
  progress: 'progress',
  deliverable: 'materials',
  report: 'materials',
  asr: 'materials',
  notice: 'materials',
  document: 'documents',
  submission_reviewed: 'submit',
  signature: 'mail',
};

/** Мэргэжлийн хэсгийн англи нэр — монгол нэр нь backend-ийн `label_mn`. */
export const DISCIPLINE_LABEL: Record<string, TranslationKey> = {
  BA: 'clientRoom.discipline.BA',
  BB: 'clientRoom.discipline.BB',
  HAS: 'clientRoom.discipline.HAS',
  TSBU: 'clientRoom.discipline.TSBU',
  TSAH: 'clientRoom.discipline.TSAH',
  HD: 'clientRoom.discipline.HD',
  AU: 'clientRoom.discipline.AU',
  EZ: 'clientRoom.discipline.EZ',
  IZ: 'clientRoom.discipline.IZ',
};

export const PROJECT_STATUS_LABEL: Record<string, TranslationKey> = {
  active: 'clientRoom.status.active',
  completed: 'clientRoom.status.completed',
  archived: 'clientRoom.status.archived',
};

type TFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Мэргэжлийн хэсгийн нэр идэвхтэй хэлээр; танихгүй код бол backend-ийн нэр. */
export function disciplineName(t: TFn, code: string, fallback?: string | null): string {
  const key = DISCIPLINE_LABEL[code];
  return key ? t(key) : fallback || code;
}

/**
 * Тоотой бичвэр — англид `count === 1` бол ганц тооны хэлбэр (`<key>One`,
 * «1 file»), бусад үед олон тооны («3 files»).  i18n систем plural мэдэхгүй
 * тул энд л шийднэ; монгол бичвэрт хоёр түлхүүр ижил утгатай.
 */
export function countLabel(
  t: TFn,
  key: TranslationKey,
  count: number,
  params?: Record<string, string | number>,
): string {
  const values = { count, ...params };
  if (count === 1) {
    const oneKey = `${key}One`;
    const one = t(oneKey, values);
    if (one !== oneKey) return one;
  }
  return t(key, values);
}
