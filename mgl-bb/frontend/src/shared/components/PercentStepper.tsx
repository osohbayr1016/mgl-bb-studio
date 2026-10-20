import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';

import { cn } from '@/shared/lib/utils';

/** Хувийг −/+ товчоор тохируулах талбар.
 *
 *  Товч нь дараагийн `step`-ийн үржвэр рүү «наалдана» (43 → + → 45, 43 → − → 40),
 *  дарж барихад давтагдана.  Дундах талбар нь хэвээр бичигдэх боломжтой —
 *  товч үндсэн зам, бичих нь нөөц зам. */
interface PercentStepperProps {
  value: string;
  onChange: (next: string) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  onEnter?: () => void;
  ariaLabel?: string;
  className?: string;
}

const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 90;

function stepValue(raw: string, dir: 1 | -1, step: number, min: number, max: number): string {
  const cur = parseFloat(raw);
  const base = Number.isFinite(cur) ? cur : min;
  // Бутархай алдаанаас сэргийлж 1e-9 хүлцэл.
  const next =
    dir === 1
      ? Math.floor(base / step + 1e-9) * step + step
      : Math.ceil(base / step - 1e-9) * step - step;
  const clamped = Math.min(max, Math.max(min, next));
  return String(Math.round(clamped * 100) / 100);
}

export function PercentStepper({
  value,
  onChange,
  step = 5,
  min = 0,
  max = 100,
  disabled,
  placeholder = '0',
  onEnter,
  ariaLabel,
  className,
}: PercentStepperProps) {
  const { t } = useLanguage();
  const valueRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const stop = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => stop, []);

  const bump = (dir: 1 | -1) => {
    const next = stepValue(valueRef.current, dir, step, min, max);
    valueRef.current = next;
    onChange(next);
  };

  const start = (dir: 1 | -1) => {
    stop();
    bump(dir);
    const repeat = () => {
      bump(dir);
      timerRef.current = setTimeout(repeat, HOLD_REPEAT_MS);
    };
    timerRef.current = setTimeout(repeat, HOLD_DELAY_MS);
  };

  const num = parseFloat(value);
  const atMin = Number.isFinite(num) && num <= min;
  const atMax = Number.isFinite(num) && num >= max;

  const btn =
    'flex h-full w-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 touch-manipulation select-none';

  const handlers = (dir: 1 | -1) => ({
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      start(dir);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    // Гарнаас (Enter/Space) дарахад pointer үйл явдал ирэхгүй.
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        bump(dir);
      }
    },
  });

  return (
    <div
      className={cn(
        'inline-flex h-8 items-stretch overflow-hidden rounded-md border border-input bg-transparent shadow-xs dark:bg-input/30',
        disabled && 'opacity-50',
        className,
      )}
    >
      <button
        type="button"
        className={cn(btn, 'border-r border-input')}
        disabled={disabled || atMin}
        aria-label={t('percentStepper.decrease')}
        {...handlers(-1)}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <div className="relative flex items-center">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              bump(1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              bump(-1);
            } else if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="h-full w-11 bg-transparent pr-3.5 text-right text-xs font-medium tabular-nums outline-none placeholder:text-muted-foreground"
        />
        <span className="pointer-events-none absolute right-1 text-[10px] text-muted-foreground">
          %
        </span>
      </div>
      <button
        type="button"
        className={cn(btn, 'border-l border-input')}
        disabled={disabled || atMax}
        aria-label={t('percentStepper.increase')}
        {...handlers(1)}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
