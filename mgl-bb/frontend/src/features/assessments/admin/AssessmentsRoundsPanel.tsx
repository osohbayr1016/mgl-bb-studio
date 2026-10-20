import { ClipboardList, Loader2, Plus } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { EmptyState } from '@/shared/components/EmptyState';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/ui/table';
import type { AssessmentRoundSummary, RoundStatus } from '../types';
import { AssessmentRoundRow } from './AssessmentRoundRow';

export function AssessmentsRoundsPanel({
  rounds,
  loading,
  statusPending,
  onNewRound,
  canCreate,
  onOpenRound,
  onRename,
  onToggleStatus,
  onDelete,
}: {
  rounds: AssessmentRoundSummary[];
  loading: boolean;
  statusPending: boolean;
  onNewRound: () => void;
  canCreate: boolean;
  onOpenRound: (id: number) => void;
  onRename: (round: AssessmentRoundSummary) => void;
  onToggleStatus: (id: number, status: RoundStatus) => void;
  onDelete: (id: number, name: string) => void;
}) {
  const { t } = useLanguage();
  const statusLabel: Record<RoundStatus, string> = {
    draft: t('assessments.statusDraft'),
    open: t('assessments.statusOpen'),
    closed: t('assessments.statusClosed'),
  };

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted-foreground">{t('assessments.roundsHint')}</p>
        <Button size="sm" onClick={onNewRound} disabled={!canCreate}>
          <Plus className="size-4" aria-hidden />
          {t('assessments.newRound')}
        </Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </div>
      ) : !rounds.length ? (
        <EmptyState
          icon={ClipboardList}
          title={t('assessments.noRounds')}
          description={t('assessments.noRoundsHint')}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('assessments.colRoundName')}</TableHead>
                    <TableHead>{t('assessments.colPeriod')}</TableHead>
                    <TableHead className="text-right">{t('assessments.colParticipants')}</TableHead>
                    <TableHead className="text-right">{t('assessments.sideSelf')}</TableHead>
                    <TableHead className="text-right">{t('assessments.sideSenior')}</TableHead>
                    <TableHead>{t('assessments.colStatus')}</TableHead>
                    <TableHead className="text-right">{t('assessments.colActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rounds.map((round) => (
                    <AssessmentRoundRow
                      key={round.id}
                      round={round}
                      statusLabel={statusLabel}
                      statusPending={statusPending}
                      onOpenRound={onOpenRound}
                      onRename={onRename}
                      onToggleStatus={onToggleStatus}
                      onDelete={onDelete}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
