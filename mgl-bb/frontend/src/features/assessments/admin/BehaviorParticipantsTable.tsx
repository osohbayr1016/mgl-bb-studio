import { useMemo } from 'react';

import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Badge } from '@/ui/badge';
import { DataTable, type DataTableColumn } from '@/ui/data-table';

import type { ParticipantResult } from '../api';
import { bandForMean, fmtMean } from '../lib/behaviorScale';
import { behaviorMean, behaviorPartFromResult } from '../lib/behaviorPart';
import { BehaviorBandTag } from '../components/LevelTag';

interface Props {
  rows: ParticipantResult[];
  onSelect: (userId: number) => void;
}

export function BehaviorParticipantsTable({ rows, onSelect }: Props) {
  const { t } = useLanguage();

  const columns: DataTableColumn<ParticipantResult>[] = useMemo(
    () => [
      {
        id: 'name',
        header: t('assessments.colName'),
        cell: (r) => (
          <span className="font-medium">{formatDisplayName(r.full_name)}</span>
        ),
        sortValue: (r) => formatDisplayName(r.full_name),
      },
      {
        id: 'team',
        header: t('assessments.colTeam'),
        cell: (r) => <span className="text-muted-foreground">{r.team_code ?? '—'}</span>,
        sortValue: (r) => r.team_code,
      },
      {
        id: 'mean',
        header: t('assessments.behaviorMeanScore'),
        numeric: true,
        cell: (r) => {
          const mean = behaviorMean(behaviorPartFromResult(r));
          return (
            <span className="inline-flex items-center gap-2">
              <span className="tabular-nums">{fmtMean(mean)}</span>
              <BehaviorBandTag band={bandForMean(mean)} />
            </span>
          );
        },
        sortValue: (r) => behaviorMean(behaviorPartFromResult(r)),
      },
      {
        id: 'self',
        header: t('assessments.colSelfSubmitted'),
        cell: (r) => (
          <Badge variant={r.self_submitted ? 'default' : 'outline'}>
            {r.self_submitted ? t('assessments.yes') : t('assessments.no')}
          </Badge>
        ),
        sortValue: (r) => (r.self_submitted ? 1 : 0),
      },
      {
        id: 'senior',
        header: t('assessments.colSeniorSubmitted'),
        cell: (r) => (
          <Badge variant={r.senior_submitted ? 'default' : 'outline'}>
            {r.senior_submitted ? t('assessments.yes') : t('assessments.no')}
          </Badge>
        ),
        sortValue: (r) => (r.senior_submitted ? 1 : 0),
      },
    ],
    [t],
  );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.user_id}
      defaultSort={{ id: 'mean', dir: 'desc' }}
      onRowClick={(r) => onSelect(r.user_id)}
      emptyTitle={t('assessments.behaviorNoData')}
      className="p-0"
    />
  );
}

export default BehaviorParticipantsTable;
