/**
 * Оноо өгөх нэг мөр — зүүн талд асуултын текст, баруун талд 1..5 segmented товч.
 *
 * A11y: жинхэнэ `<input type="radio">`-г нуун (`sr-only`) label-аар боож өгсөн
 * тул сум товчны навигаци, дэлгэц уншигчийн дэмжлэг үнэгүй ирнэ. Гаднах div нь
 * `role="radiogroup"` + `aria-label` — уншигч «асуулт → сонголт» гэж уншина.
 *
 * Товчнууд дуудагчийн өгсөн дарааллаар зурна (эрэмбэлэхгүй — мөр бүрд 40 удаа
 * ажиллах тул displayScale-ийг дуудагч дээр хийж дамжуулна).
 */
import { AlertCircle } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { AssessmentItem, AssessmentScaleOption } from '../types';
import { ROW_ATTR } from '../lib/progress';

interface Props {
  item: AssessmentItem;
  /** Хэсэг доторх харагдах дугаар (1-ээс эхэлнэ). */
  index: number;
  options: AssessmentScaleOption[];
  value: number | undefined;
  disabled?: boolean;
  onChange: (value: number) => void;
  /** blur дээр autosave-ийг шууд flush хийх (заавал биш). */
  onCommit?: () => void;
  /** Хариулаагүй мөрүүдийг тодруулах (reveal-based). */
  highlightUnanswered?: boolean;
  /** Jump-аар ирсэн мөрийг тэмдэглэх. */
  spotlight?: boolean;
}

export function RatingRow({
  item,
  index,
  options,
  value,
  disabled,
  onChange,
  onCommit,
  highlightUnanswered,
  spotlight,
}: Props) {
  const { t } = useLanguage();
  const answered = typeof value === 'number' && value > 0;
  const nudge = !answered && !disabled && !!highlightUnanswered;
  const selected = options.find((opt) => opt.value === value);

  return (
    <div
      {...{ [ROW_ATTR]: item.id }}
      className={cn(
        'scroll-mt-28 flex flex-col gap-2 rounded-md border-l-2 py-2.5 pl-3 pr-1 transition-colors sm:flex-row sm:items-center sm:gap-4',
        nudge ? 'border-warning bg-warning/10' : 'border-transparent',
        spotlight && 'ring-2 ring-warning/70 ring-offset-2',
      )}
    >
      <p className="min-w-0 flex-1 text-sm leading-snug text-foreground">
        <span className="mr-1.5 select-none text-micro font-semibold tabular-nums text-muted-foreground">
          {index}.
        </span>
        {item.text}
        {nudge && (
          <span
            id={`unanswered-${item.id}`}
            className="ml-2 inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-micro font-medium text-warning-foreground"
          >
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
            {t('assessments.unanswered')}
          </span>
        )}
      </p>

      <div className="flex shrink-0 flex-col items-end gap-1 self-end sm:self-auto">
        <div
          role="radiogroup"
          aria-label={item.text}
          aria-describedby={nudge ? `unanswered-${item.id}` : undefined}
          className="flex items-center gap-1.5"
        >
          {options.map((opt) => {
            const isSelected = value === opt.value;
            return (
              <label
                key={opt.value}
                title={opt.caption ? `${opt.label} — ${opt.caption}` : opt.label}
                className={cn(
                  'relative flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border text-sm font-semibold tabular-nums transition-colors sm:h-9 sm:min-w-9',
                  'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                    : 'border-input bg-background text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-foreground dark:bg-input/30',
                  disabled && 'pointer-events-none opacity-50',
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`item-${item.id}`}
                  value={opt.value}
                  checked={isSelected}
                  disabled={disabled}
                  aria-label={`${opt.value} — ${opt.label}`}
                  onChange={() => onChange(opt.value)}
                  onBlur={onCommit}
                />
                {opt.value}
              </label>
            );
          })}
        </div>
        <span
          aria-hidden
          className="line-clamp-2 min-h-4 max-w-[14rem] text-right text-micro leading-tight text-muted-foreground sm:max-w-[11rem]"
        >
          {selected?.label ?? ''}
        </span>
      </div>
    </div>
  );
}

export default RatingRow;
