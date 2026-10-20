import { Lock, Pencil, Trash2, Unlock } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { TableCell, TableRow } from '@/ui/table';
import type { AssessmentRoundSummary, RoundStatus } from '../types';
import { STATUS_VARIANT } from './assessmentsAdminShared';

export function AssessmentRoundRow({
  round,
  statusLabel,
  statusPending,
  onOpenRound,
  onRename,
  onToggleStatus,
  onDelete,
}: {
  round: AssessmentRoundSummary;
  statusLabel: Record<RoundStatus, string>;
  statusPending: boolean;
  onOpenRound: (id: number) => void;
  onRename: (round: AssessmentRoundSummary) => void;
  onToggleStatus: (id: number, status: RoundStatus) => void;
  onDelete: (id: number, name: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <TableRow className="cursor-pointer" onClick={() => onOpenRound(round.id)}>
      <TableCell className="font-medium">{round.name}</TableCell>
      <TableCell className="text-muted-foreground">{round.period}</TableCell>
      <TableCell className="text-right tabular-nums">{round.participant_count}</TableCell>
      <TableCell className="text-right tabular-nums">
        {round.self_submitted_count} / {round.participant_count}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {round.senior_submitted_count} / {round.participant_count}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[round.status]}>{statusLabel[round.status]}</Badge>
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('assessments.renameRound')}
            title={t('assessments.renameRound')}
            onClick={() => onRename(round)}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          {round.status === 'open' ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={statusPending}
              onClick={() => onToggleStatus(round.id, 'closed')}
            >
              <Lock className="size-4" aria-hidden />
              {t('assessments.closeRound')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={statusPending}
              onClick={() => onToggleStatus(round.id, 'open')}
            >
              <Unlock className="size-4" aria-hidden />
              {t('assessments.openRound')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('assessments.deleteRound')}
            onClick={() => onDelete(round.id, round.name)}
          >
            <Trash2 className="size-4 text-destructive" aria-hidden />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
