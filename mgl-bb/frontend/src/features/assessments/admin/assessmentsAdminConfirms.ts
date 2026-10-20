import { confirmDialog } from '@/shared/components/ConfirmDialog';
import type { TParams, TranslationKey } from '@/shared/i18n';
import type { AssessmentRoundSummary, RoundStatus } from '../types';

type TFn = (key: TranslationKey, vars?: TParams) => string;

export async function confirmToggleRoundStatus(
  t: TFn,
  rounds: AssessmentRoundSummary[],
  id: number,
  status: RoundStatus,
): Promise<boolean> {
  if (status === 'closed') {
    return confirmDialog({
      title: t('assessments.closeRoundConfirmTitle'),
      description: t('assessments.closeRoundConfirm'),
      variant: 'default',
    });
  }
  if (status === 'open' && rounds.find((r) => r.id === id)?.status === 'closed') {
    return confirmDialog({
      title: t('assessments.reopenRoundConfirmTitle'),
      description: t('assessments.reopenRoundConfirm'),
      variant: 'default',
    });
  }
  return true;
}

export async function confirmDeleteNamed(
  t: TFn,
  key: 'assessments.roundDeleteConfirm' | 'assessments.templateDeleteConfirm',
  name: string,
): Promise<boolean> {
  return confirmDialog({
    description: t(key, { name }),
    variant: 'destructive',
  });
}
