import type { LucideIcon } from 'lucide-react';
import { Layers } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import {
  ASR_REPORT_TYPES,
  REPORT_TYPE_KEY,
  type AsrReportType,
} from '@/features/projects/asr/types';
import { ASR_TYPE_ICON } from './lib/typeIcons';

/**
 * Тайлангийн төрлөөр шүүх ТОВЧНУУД (0362) — «Бүгд» + Талбайн хяналт / Оффис
 * уулзалт / Зургийн өөрчлөлт / Цахим уулзалт (`ASR_REPORT_TYPES`-ийн дараалал).  Нэг товшилтоор шүүнэ; идэвхтэй
 * товчийг дахин дарахад юу ч болохгүй (буцах товч нь «Бүгд»).
 *
 * `/app/asr` (бүх төслийн хөндлөн) ба нэг төслийн харагдац хоёулаа хэрэглэнэ.
 * `counts` өгөхгүй бол тоо харагдахгүй.
 */
export function AsrTypeFilter({
  value,
  onChange,
  counts,
  total,
  className,
}: {
  /** `null` = «Бүгд». */
  value: AsrReportType | null;
  onChange: (next: AsrReportType | null) => void;
  counts?: Partial<Record<AsrReportType, number>>;
  /** «Бүгд» товчны тоо. */
  total?: number;
  className?: string;
}) {
  const { t } = useLanguage();

  const chip = (
    key: string,
    active: boolean,
    label: string,
    Icon: LucideIcon,
    count: number | undefined,
    onClick: () => void,
  ) => (
    <Button
      key={key}
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={active}
      data-testid={`asr-type-chip-${key}`}
      onClick={onClick}
      className={cn(
        'rounded-full text-xs font-normal',
        active
          ? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15 hover:text-primary'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span>{label}</span>
      {count != null && <span className="tabular-nums opacity-70">{count}</span>}
    </Button>
  );

  return (
    <div
      role="group"
      aria-label={t('asr.type.statsTitle')}
      data-testid="asr-type-filter"
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {chip('all', value == null, t('asr.filterAll'), Layers, total, () => onChange(null))}
      {ASR_REPORT_TYPES.map((type) =>
        chip(type, value === type, t(REPORT_TYPE_KEY[type]), ASR_TYPE_ICON[type], counts?.[type], () =>
          onChange(type),
        ),
      )}
    </div>
  );
}
