/**
 * Юүлүүрийн шатны шошго — жагсаалт, засварлагч, түүх бүгд эндээс авна.
 * Өнгө нь `shared/lib/status-colors`-ийн `QUOTE_STATUS_TONE`-оос (репогийн
 * статусын өнгөний нэг эх үүсвэр), текст нь `../lib/quoteStatus`-аас.
 */
import { Badge } from '@/ui/badge';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { QUOTE_STATUS_TONE } from '@/shared/lib/status-colors';

import { QUOTE_STATUS_LABEL } from '../lib/quoteStatus';
import type { QuoteStatus } from '../types/quotes';

export function QuoteStatusBadge({
  status,
  className,
}: {
  status: QuoteStatus;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <Badge
      variant="outline"
      className={cn('whitespace-nowrap', QUOTE_STATUS_TONE[status], className)}
    >
      {t(QUOTE_STATUS_LABEL[status])}
    </Badge>
  );
}
