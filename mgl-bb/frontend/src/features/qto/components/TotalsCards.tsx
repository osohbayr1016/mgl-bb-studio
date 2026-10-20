import { Card, CardContent } from '@/ui/card';
import { useLanguage } from '@/shared/i18n';

import { fmtNum } from '../lib/pivots';
import type { RevitTotals } from '../lib/types';

/** The five headline totals of a run — элемент / урт / талбай / эзлэхүүн /
 *  жин. Metrics the run doesn't carry (legacy IFC runs have no length/mass)
 *  render as '—'. */
export function TotalsCards({ totals }: { totals: RevitTotals }) {
  const { t } = useLanguage();
  const items = [
    { label: t('qtoPage.totalElements'), value: fmtNum(totals.count, 0) },
    { label: t('qtoPage.totalLength'), value: fmtNum(totals.length_m) },
    { label: t('qtoPage.totalArea'), value: fmtNum(totals.area_m2) },
    { label: t('qtoPage.totalVolume'), value: fmtNum(totals.volume_m3) },
    { label: t('qtoPage.totalMass'), value: fmtNum(totals.mass_kg) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="pb-3 pt-4">
            <div className="text-xs text-muted-foreground">{item.label}</div>
            <div className="text-xl font-semibold tabular-nums">{item.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
