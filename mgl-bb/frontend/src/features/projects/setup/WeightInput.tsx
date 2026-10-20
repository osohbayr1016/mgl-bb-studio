/* ==========================================================================
   WeightInput — standardised % field with absolute-share teaching label
   ==========================================================================

   Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
   module was split up — no behavioural change.
*/
import { useEffect, useRef, useState } from 'react';

import { Input } from '@/ui/input';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

export function WeightInput({
  value,
  onChange,
  abs,
  label,
  denominator,
  compact = false,
}: {
  value: number | string;
  onChange: (v: string) => void;
  /** Absolute share of this item of the whole project, in %. */
  abs?: number;
  /** Parent descriptor — "Блокын", "Зургийн", "Бүрдлийн" — moved into a
   *  tooltip in compact mode so the input doesn't bloat tight cells. */
  label?: string;
  /**
   * When set, the input is rendered in *parent-relative* percentage units
   * (where 100% = the parent's full weight). The actual stored value is
   * `displayed × denominator / 100`. Used for components inside a drawing so
   * the admin types "50%" to mean "half of this drawing", not "0.5% of the
   * block". When undefined, the input behaves as a plain absolute %.
   */
  denominator?: number;
  /** Render at the smaller table-cell size (h-7, w-16) rather than the
   *  default block/drawing toolbar size (h-9, w-24). */
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const denom = denominator && denominator > 0 ? denominator : 0;
  const numericValue = typeof value === 'number' ? value : parseFloat(String(value || 0));
  // What the field would render if we recomputed straight from props.
  const propDisplay =
    denom > 0
      ? Number.isFinite(numericValue)
        ? +((numericValue * 100) / denom).toFixed(4)
        : 0
      : Number.isFinite(numericValue)
        ? numericValue
        : 0;
  const propDisplayStr = propDisplay === 0 ? '' : String(propDisplay);

  // Hold a local draft so the user can type intermediate strings like "0",
  // "0.", "0.5" without the controlled-input round-trip wiping the field
  // (typing "0" used to flip the parent state to 0, which we render as
  // empty, which dropped the keystroke before they could add ".5").
  const [draft, setDraft] = useState<string>(propDisplayStr);
  const lastPropRef = useRef<string>(propDisplayStr);
  // When the prop changes from outside (equal-split, save reload, etc.)
  // refresh the draft so we don't show stale text. We compare to the last
  // prop we synced from — local typing won't clobber itself this way.
  useEffect(() => {
    if (propDisplayStr !== lastPropRef.current) {
      setDraft(propDisplayStr);
      lastPropRef.current = propDisplayStr;
    }
  }, [propDisplayStr]);

  const emit = (rawDisplay: string) => {
    if (rawDisplay === '') {
      onChange('');
      return;
    }
    const parsed = parseFloat(rawDisplay);
    if (Number.isNaN(parsed)) return; // partial like "" or "." — wait
    if (denom > 0) {
      // Convert parent-relative back to absolute storage units.
      onChange(String(+((parsed * denom) / 100).toFixed(4)));
    } else {
      onChange(rawDisplay);
    }
  };

  // Brief shake when the user types a value that would be clamped (out
  // of 0..100). The class is removed shortly after so re-entering an
  // invalid value re-triggers the cue.
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (!shake) return;
    const timer = setTimeout(() => setShake(false), 350);
    return () => clearTimeout(timer);
  }, [shake]);

  const inputCls = cn(
    compact
      ? 'h-7 w-16 pr-6 text-right text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
      : 'h-9 w-24 pr-7 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
    shake && 'animate-shake border-destructive/60 ring-1 ring-destructive/40',
  );

  // In compact mode the parent label moves to a tooltip so the input
  // can sit inside a table cell without wrapping.  We still render the
  // label inline outside compact mode (toolbar context, room to spare).
  const tooltipText = label
    ? `${label}: ${draft || '0'}%${
        abs && abs > 0
          ? ` ${t('adminProjectSetupPage.ofProjectApprox', { pct: abs.toFixed(2) })}`
          : ''
      }`
    : undefined;

  return (
    <div className={cn('flex flex-col leading-tight', compact ? 'items-center' : 'items-end')}>
      <div className="flex items-center gap-1">
        {label && !compact && <span className="text-label text-muted-foreground">{label}</span>}
        <div className="relative">
          <Input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              setDraft(v);
              emit(v);
            }}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                setDraft('');
                onChange('');
                lastPropRef.current = '';
                return;
              }
              const n = parseFloat(raw);
              if (Number.isNaN(n)) {
                setDraft('');
                onChange('');
                lastPropRef.current = '';
                return;
              }
              const clamped = Math.max(0, Math.min(100, n));
              if (clamped !== n) setShake(true);
              const finalStr = String(clamped);
              setDraft(finalStr);
              emit(finalStr);
              lastPropRef.current = finalStr;
            }}
            className={inputCls}
            placeholder="0"
            title={tooltipText}
          />
          <span
            className={cn(
              'absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground',
              compact ? 'text-micro' : 'text-xs',
            )}
          >
            %
          </span>
        </div>
      </div>
      {!compact && abs !== undefined && abs > 0 && (
        <span
          className="text-micro text-muted-foreground mt-0.5 tabular-nums"
          title={t('adminProjectSetupPage.ofTotalProjectWeight')}
        >
          {t('adminProjectSetupPage.ofTotalProject', { pct: abs.toFixed(2) })}
        </span>
      )}
    </div>
  );
}

export default WeightInput;
