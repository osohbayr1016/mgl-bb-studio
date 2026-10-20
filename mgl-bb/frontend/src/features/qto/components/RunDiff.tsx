import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDateTime } from '@/shared/lib/time';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';

import { diffRuns, fmtDelta, type DiffStatus } from '../lib/pivots';
import type { QtoFactRow, QtoRunListItem } from '../lib/types';

const STATUS_TONE: Record<DiffStatus, string> = {
  added: 'border-success/30 bg-success/10 text-success',
  removed: 'border-danger/30 bg-danger/10 text-danger',
  changed: 'border-warning/30 bg-warning/10 text-warning',
};

const STATUS_KEY: Record<DiffStatus, string> = {
  added: 'qtoPage.diffAdded',
  removed: 'qtoPage.diffRemoved',
  changed: 'qtoPage.diffChanged',
};

function useRunFacts(runId: number | null) {
  return useApiQuery<{ facts: QtoFactRow[] }>(
    ['/qto/runs', runId, 'facts'],
    `/qto/runs/${runId}/facts`,
    { enabled: runId != null },
  );
}

/** Run A (older) vs Run B (newer) — revit runs only. The diff is keyed by
 *  `combo_key`; deltas are B − A and only changed rows are shown. */
export function RunDiff({ revitRuns }: { revitRuns: QtoRunListItem[] }) {
  const { t } = useLanguage();
  const [idA, setIdA] = useState<number | null>(null);
  const [idB, setIdB] = useState<number | null>(null);

  const factsA = useRunFacts(idA);
  const factsB = useRunFacts(idB);

  const diff = useMemo(() => {
    if (!factsA.data || !factsB.data) return null;
    return diffRuns(factsA.data.facts, factsB.data.facts);
  }, [factsA.data, factsB.data]);

  const runLabel = (r: QtoRunListItem) =>
    `${formatDateTime(r.created_at)} · ${r.file_name ?? '#' + r.id}`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('qtoPage.diffTitle')}</CardTitle>
        <CardDescription>{t('qtoPage.diffHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {revitRuns.length < 2 ? (
          <p className="text-sm text-muted-foreground">{t('qtoPage.diffNeedTwo')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <RunSelect
                label={t('qtoPage.diffRunA')}
                runs={revitRuns}
                value={idA}
                onChange={setIdA}
                runLabel={runLabel}
              />
              <RunSelect
                label={t('qtoPage.diffRunB')}
                runs={revitRuns}
                value={idB}
                onChange={setIdB}
                runLabel={runLabel}
              />
            </div>

            {idA != null && idB != null && (factsA.isLoading || factsB.isLoading) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
              </div>
            )}
            {(factsA.isError || factsB.isError) && (
              <p className="text-sm text-danger">{t('qtoPage.factsLoadFailed')}</p>
            )}

            {diff && diff.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('qtoPage.diffNoChange')}</p>
            )}
            {diff && diff.length > 0 && (
              <div className="max-h-[28rem] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('qtoPage.diffStatus')}</TableHead>
                      <TableHead>{t('qtoPage.colCategory')}</TableHead>
                      <TableHead>{t('qtoPage.colFamily')}</TableHead>
                      <TableHead>{t('qtoPage.colType')}</TableHead>
                      <TableHead>{t('qtoPage.colLevel')}</TableHead>
                      <TableHead>{t('qtoPage.colMaterial')}</TableHead>
                      <TableHead className="text-right">{t('qtoPage.diffDeltaCount')}</TableHead>
                      <TableHead className="text-right">{t('qtoPage.diffDeltaVolume')}</TableHead>
                      <TableHead className="text-right">{t('qtoPage.diffDeltaMass')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diff.map((row) => (
                      <TableRow key={row.combo_key}>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn('text-micro', STATUS_TONE[row.status])}
                          >
                            {t(STATUS_KEY[row.status])}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {row.category || '—'}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate">
                          {row.family || '—'}
                        </TableCell>
                        <TableCell className="max-w-[14rem] truncate">
                          {row.type_name || '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.level || '—'}</TableCell>
                        <TableCell className="max-w-[12rem] truncate text-muted-foreground">
                          {row.material || '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtDelta(row.delta_count, 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtDelta(row.delta_volume_m3)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtDelta(row.delta_mass_kg)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RunSelect({
  label,
  runs,
  value,
  onChange,
  runLabel,
}: {
  label: string;
  runs: QtoRunListItem[];
  value: number | null;
  onChange: (id: number) => void;
  runLabel: (r: QtoRunListItem) => string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select
        value={value != null ? String(value) : undefined}
        onValueChange={(v) => onChange(Number(v))}
      >
        <SelectTrigger size="sm" className="w-64 max-w-full">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {runs.map((r) => (
            <SelectItem key={r.id} value={String(r.id)}>
              {runLabel(r)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
