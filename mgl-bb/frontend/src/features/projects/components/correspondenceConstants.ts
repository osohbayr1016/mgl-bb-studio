export type CorrespondenceDocType = 'rfi' | 'cr' | 'official' | 'mr';

export const CORRESPONDENCE_DOC_TYPES: CorrespondenceDocType[] = ['rfi', 'cr', 'official', 'mr'];

export const DOC_TYPE_SHORT: Record<CorrespondenceDocType, string> = {
  rfi: 'RFI',
  cr: 'CR',
  official: 'OL',
  mr: 'MR',
};

export const DOC_TYPE_LABEL_KEYS: Record<CorrespondenceDocType, string> = {
  rfi: 'correspondenceLogTab.docTypeRfi',
  cr: 'correspondenceLogTab.docTypeCr',
  official: 'correspondenceLogTab.docTypeOfficial',
  mr: 'correspondenceLogTab.docTypeMr',
};

export const DOC_TYPE_TONE: Record<CorrespondenceDocType, string> = {
  rfi: 'border-sky-500/30 text-sky-600 bg-sky-500/5',
  cr: 'border-amber-500/30 text-amber-600 bg-amber-500/5',
  official: 'border-violet-500/30 text-violet-600 bg-violet-500/5',
  mr: 'border-teal-500/30 text-teal-600 bg-teal-500/5',
};

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ---------- Захиалагчийн гарын үсэг (migration 0335) ---------- */

export type SignStatus = 'none' | 'pending' | 'signed';

/** Зөвхөн RFI / CR бичигт гарын үсэг зуруулна (backend `isSignableDocType`-ийн хос). */
export function isSignableDocType(v: CorrespondenceDocType | null | undefined): v is 'rfi' | 'cr' {
  return v === 'rfi' || v === 'cr';
}

export const SIGN_STATUS_LABEL_KEYS: Record<SignStatus, string> = {
  none: 'correspondenceSign.statusNone',
  pending: 'correspondenceSign.statusPending',
  signed: 'correspondenceSign.statusSigned',
};

export const SIGN_STATUS_TONE: Record<SignStatus, string> = {
  none: 'border-border text-muted-foreground',
  pending: 'border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-400',
  signed: 'border-emerald-500/40 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400',
};
