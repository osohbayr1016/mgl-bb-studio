import { Card, CardContent } from '@/ui/card';
import { AnimatedNumber } from '@/shared/components/motion/AnimatedNumber';
import { useLanguage } from '@/shared/i18n';

import type { QtoDashboardFile } from '../../lib/types';

/**
 * Самбарын хураангуй 4 карт — сонгогдсон (included) файлуудын нийлбэр.
 * Нийт элемент hero-д харагддаг тул энд давхардуулахгүй; chip toggle хийхэд
 * AnimatedNumber count-up хийж «Takeoff» мэдрэмж өгнө.
 */
export function DashboardSummary({ files }: { files: QtoDashboardFile[] }) {
  const { t } = useLanguage();

  let volume = 0;
  let mass = 0;
  let factCount = 0;
  let unmapped = 0;
  for (const f of files) {
    volume += f.totals.volume_m3 ?? 0;
    mass += f.totals.mass_kg ?? 0;
    factCount += f.fact_count;
    unmapped += f.unmapped_facts;
  }
  const unmappedPct = factCount > 0 ? (unmapped / factCount) * 100 : 0;

  const cards: { label: string; value: number; decimals: number; suffix?: string }[] = [
    { label: t('qtoPage.dashFilesCount'), value: files.length, decimals: 0 },
    { label: t('qtoPage.colVolume'), value: volume, decimals: 1 },
    { label: t('qtoPage.colMass'), value: mass, decimals: 0 },
    { label: t('qtoPage.dashUnmapped'), value: unmappedPct, decimals: 1, suffix: '%' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label} className="gap-0 py-0">
          <CardContent className="p-4">
            <p className="font-mono text-label text-muted-foreground">
              {c.label}
            </p>
            <p className="mt-1 font-mono text-lg tabular-nums">
              <AnimatedNumber value={c.value} decimals={c.decimals} />
              {c.suffix}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
