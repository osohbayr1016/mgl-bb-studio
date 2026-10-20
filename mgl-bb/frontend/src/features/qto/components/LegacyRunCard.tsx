import { Archive } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';

import { fmtNum } from '../lib/pivots';
import { isRevitSummary, type LegacySummary, type QtoRunDetail } from '../lib/types';

const TOP_MATERIALS = 8;

/** Compact read-only card for a legacy (in-browser IFC) run selected in the
 *  Түүх tab — total volume/area, element count, top materials. No pivot, no
 *  export: legacy runs never persisted fact rows. */
export function LegacyRunCard({ run }: { run: QtoRunDetail }) {
  const { t } = useLanguage();
  // Legacy summaries have no `source` discriminator; anything non-revit is
  // treated as the legacy shape (a null summary still renders the meta).
  const summary: LegacySummary | null = isRevitSummary(run.summary) ? null : run.summary;
  const materials = (summary?.materials ?? []).slice(0, TOP_MATERIALS);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Archive className="h-4 w-4 text-muted-foreground" />
          {t('qtoPage.legacyRunTitle')}
        </CardTitle>
        <CardDescription>{t('qtoPage.legacyNote')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <MetaItem label={t('qtoPage.runFile')} value={run.file_name ?? '—'} />
          <MetaItem label={t('qtoPage.runDate')} value={formatDateTime(run.created_at)} />
          <MetaItem label={t('qtoPage.runBy')} value={run.created_by_name ?? '—'} />
        </dl>

        <div className="grid grid-cols-3 gap-3">
          <StatBox
            label={t('qtoPage.totalElements')}
            value={fmtNum(summary?.element_count ?? run.element_count, 0)}
          />
          <StatBox
            label={t('qtoPage.totalVolume')}
            value={fmtNum(summary?.total_volume_m3 ?? run.total_volume_m3)}
          />
          <StatBox
            label={t('qtoPage.totalArea')}
            value={fmtNum(summary?.total_area_m2 ?? run.total_area_m2)}
          />
        </div>

        {materials.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {t('qtoPage.topMaterials')}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('qtoPage.colMaterial')}</TableHead>
                  <TableHead className="text-right">{t('qtoPage.colCount')}</TableHead>
                  <TableHead className="text-right">{t('qtoPage.colVolume')}</TableHead>
                  <TableHead className="text-right">{t('qtoPage.colMass')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.map((m) => (
                  <TableRow key={m.material}>
                    <TableCell className="max-w-[18rem] truncate">
                      {m.material === '(no material)' ? t('qtoPage.noMaterial') : m.material}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(m.count, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(m.volume_m3)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(m.mass_kg)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
