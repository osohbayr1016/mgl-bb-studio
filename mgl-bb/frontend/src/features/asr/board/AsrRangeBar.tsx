import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
  ASR_RANGE_PRESETS,
  matchPreset,
  normalizeRange,
  presetRange,
  shiftRange,
  type AsrRange,
  type AsrRangePreset,
} from '../lib/asrRange';
import { rangeSubtitle, rangeTitle } from './rangeText';

const PRESET_KEY: Record<AsrRangePreset, string> = {
  all: 'asr.board.preset.all',
  thisMonth: 'asr.board.preset.thisMonth',
  lastMonth: 'asr.board.preset.lastMonth',
  last3Months: 'asr.board.preset.last3Months',
  thisYear: 'asr.board.preset.thisYear',
};

/**
 * Самбарын ХУГАЦАА — хуудасны бүх тоо, график, жагсаалт үүгээр шүүгдэнэ.
 *
 *   • дээд мөр: ◀ «2026 оны 9-р сар» ▶ — одоо юу харж байгааг том үсгээр;
 *   • товчнууд: Бүх хугацаа / Энэ сар / Өмнөх сар / Сүүлийн 3 сар / Энэ он;
 *   • «Эхлэх – Дуусах» огноо — дурын муж («9-р сарын 5-аас 9-р сарын 20»).
 */
export function AsrRangeBar({
  range,
  onChange,
  today,
  dataFirst,
  dataLast,
}: {
  range: AsrRange;
  onChange: (next: AsrRange) => void;
  today: string;
  /** Төслийн эхний / сүүлийн тайлангийн огноо — «Бүх хугацаа» үед тайлбарт. */
  dataFirst: string | null;
  dataLast: string | null;
}) {
  const { t } = useLanguage();
  const active = matchPreset(range, today);
  const prev = shiftRange(range, -1);
  const next = shiftRange(range, 1);

  const sub =
    rangeSubtitle(range, t) ??
    (dataFirst && dataLast ? t('asr.board.dataSpan', { first: dataFirst, last: dataLast }) : null);

  // «Бүх хугацаа» үед талбарт өгөгдлийн хүрээ харагдана — засахад л муж болно.
  const fromValue = range.from ?? dataFirst ?? '';
  const toValue = range.to ?? (range.from ? '' : today);

  const setBound = (which: 'from' | 'to', value: string) => {
    const from = which === 'from' ? value || null : (range.from ?? (range.to ? null : dataFirst));
    const to = which === 'to' ? value || null : (range.to ?? (range.from ? null : today));
    onChange(normalizeRange(from, to));
  };

  return (
    <section
      id="sec-asr-project-range"
      aria-label={t('asr.board.range')}
      className="scroll-mt-24 rounded-xl border border-border bg-card"
      data-testid="asr-range-bar"
    >
      <div className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="shrink-0"
            disabled={!prev}
            aria-label={t('asr.board.prevPeriod')}
            title={t('asr.board.prevPeriod')}
            onClick={() => prev && onChange(prev)}
            data-testid="asr-range-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 px-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarRange className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t('asr.board.range')}
            </div>
            <div
              className="truncate text-lg font-semibold leading-tight sm:text-xl"
              data-testid="asr-range-title"
            >
              {rangeTitle(range, t)}
            </div>
            {sub && <div className="truncate text-xs text-muted-foreground tabular-nums">{sub}</div>}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="shrink-0"
            disabled={!next}
            aria-label={t('asr.board.nextPeriod')}
            title={t('asr.board.nextPeriod')}
            onClick={() => next && onChange(next)}
            data-testid="asr-range-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          <div role="radiogroup" aria-label={t('asr.board.range')} className="flex flex-wrap gap-1.5">
            {ASR_RANGE_PRESETS.map((p) => {
              const on = active === p;
              return (
                <Button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  variant="outline"
                  size="sm"
                  data-testid={`asr-range-preset-${p}`}
                  onClick={() => onChange(presetRange(p, today))}
                  className={cn(
                    'rounded-full text-xs font-normal',
                    on
                      ? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15 hover:text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(PRESET_KEY[p])}
                </Button>
              );
            })}
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 sm:flex sm:flex-wrap">
            <label htmlFor="asr-range-from" className="text-xs text-muted-foreground">
              {t('asr.board.from')}
            </label>
            <Input
              id="asr-range-from"
              type="date"
              value={fromValue}
              max={toValue || undefined}
              onChange={(e) => setBound('from', e.target.value)}
              className="h-8 w-full min-w-0 text-sm tabular-nums sm:w-[9.5rem]"
              data-testid="asr-range-from"
            />
            <label htmlFor="asr-range-to" className="text-xs text-muted-foreground">
              {t('asr.board.to')}
            </label>
            <Input
              id="asr-range-to"
              type="date"
              value={toValue}
              min={fromValue || undefined}
              onChange={(e) => setBound('to', e.target.value)}
              className="h-8 w-full min-w-0 text-sm tabular-nums sm:w-[9.5rem]"
              data-testid="asr-range-to"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
