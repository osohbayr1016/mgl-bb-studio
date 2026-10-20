/**
 * Төвөгшлийн жин — тоон талбар + шатлалын тайлбартай сонголтын жагсаалт.
 *
 * Эзний хүсэлт (2026-09-28): төсөл үүсгэхдээ хүмүүс аль хувийг сонгохоо
 * мэдэхгүй байсан тул «100 — Онцгой … 10 — Эскиз» тэмдэглэлийг сонголтын
 * товч ӨӨРСДӨӨ тээнэ: тусдаа уншдаг тайлбар биш, мөр бүр дээр дарж сонгоно.
 * Жагсаалтад байхгүй дурын утга (0–100) тоон талбараар хэвээр орно.
 */
import { Check } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import {
  COMPLEXITY_TIER_GUIDE,
  clampComplexityPct,
  complexityPctColor,
} from '@/shared/lib/complexity';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

interface ComplexityPickerProps {
  value: number;
  onChange: (pct: number) => void;
  /** Label элементтэй холбох id (`htmlFor`). */
  inputId?: string;
}

export function ComplexityPicker({ value, onChange, inputId }: ComplexityPickerProps) {
  const { t } = useLanguage();
  const matched = COMPLEXITY_TIER_GUIDE.find((tier) => tier.pct === value);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="relative w-28">
          <Input
            id={inputId}
            type="number"
            min={0}
            max={100}
            step={1}
            inputMode="numeric"
            value={value}
            onChange={(e) => onChange(clampComplexityPct(e.target.value))}
            className="pr-6 tabular-nums"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            %
          </span>
        </div>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {matched
            ? t(`complexityGuide.${matched.key}`)
            : t('complexityGuide.custom')}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label={t('complexityGuide.title')}
        className="overflow-hidden rounded-md border border-border"
      >
        <p className="border-b border-border bg-muted/30 px-3 py-1.5 text-micro font-medium text-muted-foreground">
          {t('complexityGuide.title')}
        </p>
        <ul className="divide-y divide-border">
          {COMPLEXITY_TIER_GUIDE.map((tier) => {
            const active = tier.pct === value;
            return (
              <li key={tier.pct}>
                <Button
                  type="button"
                  variant="ghost"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange(tier.pct)}
                  className={cn(
                    // Жагсаалтын мөр: tailwind-merge variant-тай классыг дардаггүй
                    // тул pointer-coarse/has-[>svg] хувилбарыг ХАМТ бичнэ.
                    'h-auto min-h-10 w-full justify-start gap-3 whitespace-normal rounded-none px-3 py-2 text-left text-xs font-normal',
                    'pointer-coarse:h-auto pointer-coarse:min-h-11 has-[>svg]:px-3 motion-safe:active:scale-100',
                    'focus-visible:ring-2 focus-visible:ring-inset',
                    active ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/40',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex w-12 shrink-0 justify-center rounded-md border py-0.5 font-semibold tabular-nums',
                      complexityPctColor(tier.pct),
                    )}
                  >
                    {tier.pct}%
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1',
                      active ? 'font-medium text-foreground' : 'text-foreground/80',
                    )}
                  >
                    {t(`complexityGuide.${tier.key}`)}
                  </span>
                  <Check
                    aria-hidden
                    className={cn('size-4 shrink-0 text-primary', active ? 'opacity-100' : 'opacity-0')}
                  />
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
