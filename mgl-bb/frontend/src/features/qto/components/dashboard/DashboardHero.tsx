import { AnimatedNumber } from '@/shared/components/motion/AnimatedNumber';
import { useLanguage } from '@/shared/i18n';

import { fmtNum } from '../../lib/pivots';
import { CategorySpectrum, type SpectrumSegment } from './CategorySpectrum';

/**
 * Самбарын hero — Card биш, хуудасны дэвсгэр дээр шууд сууна. Нийт элементийн
 * тоо (AnimatedNumber) + категорийн спектр. Тоо ҮРГЭЛЖ text token өнгөтэй —
 * категорийн өнгө зөвхөн спектрийн сегментүүд дээр.
 */
export function DashboardHero({
  projectLabel,
  fileCount,
  total,
  segments,
  selected,
  caption,
}: {
  projectLabel: string;
  fileCount: number;
  total: number;
  segments: SpectrumSegment[];
  selected: Set<string>;
  /** null = төрлийн тоо тодорхойгүй (by_type ч, type_count ч алга) — нуугдана. */
  caption: { types: number; instances: number } | null;
}) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-label text-muted-foreground">
          REVIT · {projectLabel} · {fileCount} {t('qtoPage.dashFilesCount')}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('qtoPage.dashHeroTitle')}
          </h2>
          <div className="text-right">
            <p className="font-mono text-label text-muted-foreground">
              {t('qtoPage.dashHeroTotal')}
            </p>
            <AnimatedNumber value={total} className="font-mono text-4xl tabular-nums" />
          </div>
        </div>
      </div>

      <CategorySpectrum segments={segments} total={total} selected={selected} />

      {caption && (
        <p className="font-mono text-micro tabular-nums text-muted-foreground">
          {t('qtoPage.dashCaption', {
            types: fmtNum(caption.types, 0),
            instances: fmtNum(caption.instances, 0),
          })}
        </p>
      )}
    </div>
  );
}
