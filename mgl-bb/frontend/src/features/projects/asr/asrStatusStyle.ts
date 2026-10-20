import { APPROVAL_STATUS_TONE } from '@/shared/lib/status-colors';
import type { AsrStatus } from './types';

/**
 * ЗХ тайлангийн төлөвийн өнгө + i18n түлхүүр.  ASR-ийн 4 төлөв нь батлах
 * урсгалын статустай бүтцийн хувьд яг таарна (draft≈cancelled — саарал,
 * submitted≈pending) тул шинэ палитр үүсгэхгүй, `APPROVAL_STATUS_TONE`-ыг
 * дахин ашиглана.
 *
 * Компонентоос тусдаа файл: `AsrStatusBadge` (пилл) болон багаар нэгтгэлийн
 * толгойн тоонууд (`AsrTeamGroups`) хоёулаа ашиглана.
 */
export const ASR_STATUS_TONE: Record<AsrStatus, string> = {
  draft: APPROVAL_STATUS_TONE.cancelled,
  submitted: APPROVAL_STATUS_TONE.pending,
  approved: APPROVAL_STATUS_TONE.approved,
  rejected: APPROVAL_STATUS_TONE.rejected,
};

export const ASR_STATUS_LABEL: Record<AsrStatus, string> = {
  draft: 'asr.statusDraft',
  submitted: 'asr.statusSubmitted',
  approved: 'asr.statusApproved',
  rejected: 'asr.statusRejected',
};
