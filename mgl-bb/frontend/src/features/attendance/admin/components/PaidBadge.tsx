import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/ui/badge';

/** Цалинтай / цалингүй чөлөөний тэмдэг. `null` үед юу ч харуулахгүй. */
export default function PaidBadge({ isPaid }: { isPaid: boolean | null }) {
  const { t } = useLanguage();
  if (isPaid === null) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px]',
        isPaid
          ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
          : 'border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-900/20',
      )}
    >
      {isPaid ? t('attendanceAdminPage.paid') : t('attendanceAdminPage.unpaid')}
    </Badge>
  );
}
