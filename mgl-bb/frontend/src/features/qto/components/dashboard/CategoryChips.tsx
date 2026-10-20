import type { LucideIcon } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

import { fmtNum } from '../../lib/pivots';

export interface CategoryChip {
  key: string;
  label: string;
  count: number;
  color: string;
  Icon: LucideIcon;
}

/**
 * Категорийн шүүлтийн chip-үүд — VIEW-г шүүнэ (спектрийн өргөнд нөлөөлөхгүй,
 * бүдгэрүүлнэ л). Идэвхтэй chip категорийн өнгөөр 12% будагдана; текст үргэлж
 * token өнгөтэй.
 */
export function CategoryChips({
  categories,
  selected,
  onToggle,
  onClear,
}: {
  categories: CategoryChip[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const { t } = useLanguage();
  const allActive = selected.size === 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onClear}
        aria-pressed={allActive}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
          allActive
            ? 'border-primary/40 bg-primary/10 text-foreground'
            : 'border-border text-muted-foreground hover:bg-muted/50',
        )}
      >
        {t('qtoPage.dashAllChip')}
      </button>
      {categories.map((c) => {
        const active = selected.has(c.key);
        const { Icon } = c;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onToggle(c.key)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
              active
                ? 'text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted/50',
            )}
            style={
              active
                ? {
                    borderColor: `color-mix(in srgb, ${c.color} 45%, transparent)`,
                    backgroundColor: `color-mix(in srgb, ${c.color} 12%, transparent)`,
                  }
                : undefined
            }
          >
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: c.color }} />
            <span className="max-w-[10rem] truncate">{c.label}</span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {fmtNum(c.count, 0)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
