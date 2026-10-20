import { Trash2 } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDateTime } from '@/shared/lib/time';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';

import { fmtNum } from '../lib/pivots';
import type { QtoRunListItem, QtoRunSource } from '../lib/types';

/** `Revit` / `IFC` source pill — shared by the left rail, Тойм and Түүх. */
export function SourceBadge({ source }: { source: QtoRunSource | null }) {
  const { t } = useLanguage();
  if (!source) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-micro',
        source === 'revit'
          ? 'border-info/30 bg-info/10 text-info'
          : 'border-border text-muted-foreground',
      )}
    >
      {source === 'revit' ? t('qtoPage.sourceRevit') : t('qtoPage.sourceIfc')}
    </Badge>
  );
}

interface RunHistoryProps {
  runs: QtoRunListItem[];
  selectedRunId: number | null;
  onSelect: (id: number) => void;
  /** Delete is admin-only, except a senior may delete their own run —
   *  mirrors the backend DELETE /qto/runs/:id gate. */
  isAdmin: boolean;
  currentUserId: number;
  onDelete: (id: number) => void;
}

/** All runs (incl. legacy IFC ones) newest-first; a row click selects the run
 *  for the detail card / pivot. */
export function RunHistory({
  runs,
  selectedRunId,
  onSelect,
  isAdmin,
  currentUserId,
  onDelete,
}: RunHistoryProps) {
  const { t } = useLanguage();

  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('qtoPage.historyEmpty')}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('qtoPage.runDate')}</TableHead>
            <TableHead>{t('qtoPage.runFile')}</TableHead>
            <TableHead>{t('qtoPage.colSource')}</TableHead>
            <TableHead>{t('qtoPage.runBy')}</TableHead>
            <TableHead className="text-right">{t('qtoPage.totalElements')}</TableHead>
            <TableHead className="text-right">{t('qtoPage.colFacts')}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => {
            const canDelete = isAdmin || r.created_by === currentUserId;
            return (
              <TableRow
                key={r.id}
                role="button"
                tabIndex={0}
                className={cn(
                  'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selectedRunId === r.id && 'bg-primary/5',
                )}
                onClick={() => onSelect(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(r.id);
                  }
                }}
              >
                <TableCell className="whitespace-nowrap">{formatDateTime(r.created_at)}</TableCell>
                <TableCell className="max-w-[14rem] truncate">{r.file_name ?? '—'}</TableCell>
                <TableCell>
                  <SourceBadge source={r.source} />
                </TableCell>
                <TableCell className="text-muted-foreground">{r.created_by_name ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtNum(r.element_count, 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(r.fact_count, 0)}</TableCell>
                <TableCell>
                  {canDelete && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('common.delete')}
                      className="h-7 w-7 text-muted-foreground hover:text-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(r.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
