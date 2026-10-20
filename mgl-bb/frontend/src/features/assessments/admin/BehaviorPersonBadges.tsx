import { ExternalLink } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';

import type { ParticipantResult } from '../api';
import { bandForMean, fmtMean } from '../lib/behaviorScale';
import { behaviorMean, behaviorPartFromResult } from '../lib/behaviorPart';

interface Props {
  person: ParticipantResult;
  onOpenDetail?: () => void;
}

export function BehaviorPersonBadges({ person, onOpenDetail }: Props) {
  const { t } = useLanguage();
  const mean = behaviorMean(behaviorPartFromResult(person));
  const band = bandForMean(mean);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={person.self_submitted ? 'default' : 'outline'}>
        {t('assessments.sideSelf')}:{' '}
        {person.self_submitted ? t('assessments.yes') : t('assessments.no')}
      </Badge>
      <Badge variant={person.senior_submitted ? 'default' : 'outline'}>
        {t('assessments.sideSenior')}:{' '}
        {person.senior_submitted ? t('assessments.yes') : t('assessments.no')}
      </Badge>
      <span className="text-micro text-muted-foreground">
        {t('assessments.behaviorMeanLabel')}: {fmtMean(mean)}
        {band && ` · ${band.label}`}
      </span>
      {onOpenDetail && (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onOpenDetail}>
          <ExternalLink className="mr-1 h-3.5 w-3.5" />
          {t('assessments.behaviorOpenDetail')}
        </Button>
      )}
    </div>
  );
}

export default BehaviorPersonBadges;
