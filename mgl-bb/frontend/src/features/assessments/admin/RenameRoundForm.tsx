import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { DialogFooter } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import type { AssessmentRoundSummary } from '../types';

export function RenameRoundForm({
  round,
  pending,
  onCancel,
  onSubmit,
}: {
  round: AssessmentRoundSummary;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (name: string, period: string) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(round.name);
  const [period, setPeriod] = useState(round.period);

  const valid = name.trim().length > 0 && period.trim().length > 0;
  const submit = () => {
    if (valid && !pending) onSubmit(name.trim(), period.trim());
  };

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="rename-round-name">{t('assessments.fieldRoundName')}</Label>
          <Input
            id="rename-round-name"
            value={name}
            autoFocus
            placeholder={t('assessments.fieldRoundNamePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rename-round-period">{t('assessments.fieldPeriod')}</Label>
          <Input
            id="rename-round-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t('assessments.cancel')}
        </Button>
        <Button onClick={submit} disabled={!valid || pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('common.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
