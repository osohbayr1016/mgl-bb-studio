import { TreePalm } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

/**
 * Батлагдсан чөлөөний тэмдэг — бүтээмжийн хувь нь хүний АЖИЛЛАСАН өдрөөр
 * тоологдсоныг (чөлөөт ажлын өдрийг алгасаж өмнөх ажлын өдрүүдээр нөхсөн,
 * backend `lib/leaveAvailability.ts`) ил харуулна.  `actual` = тэр хуанлийн
 * хугацаанд бодитоор олгогдсон хувь (форматласан).  `days` ≤ 0 → юу ч үгүй.
 */
export function LeaveAdjustedMark({ days, actual, className }: { days: number; actual: string; className?: string }) {
  const { t } = useLanguage();
  if (!(days > 0)) return null;
  const label = t('leaveAdjusted.note', { count: days, actual });
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={cn('ml-1 inline-flex align-middle text-muted-foreground', className)}
    >
      <TreePalm className="h-3 w-3" aria-hidden />
    </span>
  );
}
