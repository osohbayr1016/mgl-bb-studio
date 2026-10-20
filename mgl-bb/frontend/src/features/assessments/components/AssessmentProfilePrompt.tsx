import { Link } from 'react-router-dom';
import { ClipboardCheck, PenLine } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';

import { usePendingAssessmentCount } from '../hooks/usePendingAssessmentCount';

/**
 * Профайлын дээд талд — бөглөх шаардлагатай үнэлгээ байвал анхааруулга.
 * 7 табтай профайл дээр «Ур чадварын үнэлгээ» таб алга болохгүй байх зорилготой.
 */
export function AssessmentProfilePrompt() {
  const { t } = useLanguage();
  const { pendingCount, data } = usePendingAssessmentCount();

  if (pendingCount === 0) return null;

  const next = data?.assignments.find(
    (a) => a.status === 'draft' && a.round_status === 'open',
  );
  const fillHref = next
    ? `/app/assessments/${next.response_id}`
    : '/app/profile?tab=assessment';
  return (
    <Card className="border-warning/40 bg-warning/10">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{t('assessments.profileBannerTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('assessments.profileBannerDesc')}</p>
          </div>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link to={fillHref}>
            <PenLine className="mr-1.5 h-4 w-4" />
            {t('assessments.profileBannerAction')}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
