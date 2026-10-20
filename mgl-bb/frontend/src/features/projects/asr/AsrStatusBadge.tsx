import { useLanguage } from '@/shared/i18n';
import { APPROVAL_STATUS_TONE } from '@/shared/lib/status-colors';
import { cn } from '@/shared/lib/utils';
import { ASR_STATUS_LABEL, ASR_STATUS_TONE } from './asrStatusStyle';
import type { AsrRedBookStatus, AsrStatus } from './types';

/** Төлөвийн пилл — өнгө/шошго нь `asrStatusStyle.ts`-д. */

/**
 * Улаан дэвтрийн пилл.  `missing` нь ЗОРИУД `rejected` (улаан) өнгөтэй:
 * энэ бол «хүлээгдэж буй» биш, ДУТУУ зүйл — тайлан батлагдсан ч гэсэн
 * улаан хэвээр үлдэж, нөхөх хүртэл нь нүдэнд тусна.
 */
const RB_TONE: Record<AsrRedBookStatus, string> = {
  missing: APPROVAL_STATUS_TONE.rejected,
  // «Талбай дээр улаан дэвтэр байгаагүй» (0366) — дутуу биш, зохиогчийн тэмдэглэл.
  absent: APPROVAL_STATUS_TONE.cancelled,
  signed: APPROVAL_STATUS_TONE.pending,
  verified: APPROVAL_STATUS_TONE.approved,
};

const RB_LABEL: Record<AsrRedBookStatus, string> = {
  missing: 'asr.redBookMissing',
  absent: 'asr.redBookAbsent',
  signed: 'asr.redBookSigned',
  verified: 'asr.redBookVerified',
};

export function AsrRedBookBadge({
  status,
  className,
}: {
  status: AsrRedBookStatus;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        RB_TONE[status],
        className,
      )}
    >
      {t(RB_LABEL[status])}
    </span>
  );
}

export function AsrStatusBadge({ status, className }: { status: AsrStatus; className?: string }) {
  const { t } = useLanguage();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        ASR_STATUS_TONE[status],
        className,
      )}
    >
      {t(ASR_STATUS_LABEL[status])}
    </span>
  );
}
