/** The "Анхны явц" (carry-over %) input on a task row.
 *
 *  Carry-over % from the team's old Excel tracker.  Editing creates/replaces
 *  a single is_baseline=1 progress entry — no author, no leaderboard award,
 *  just "this task is already at X%".
 *
 *  The desktop table cell and the mobile expansion row rendered near-identical
 *  markup, so the two variants are folded into one component here. Extracted
 *  from `AdminProjectSetupPage.tsx`'s `TaskRow` — no behavioural change. */
import { Input } from '@/ui/input';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import type { TaskBaselineState } from './useTaskBaseline';

export function TaskBaselineInput({
  state,
  variant,
}: {
  state: TaskBaselineState;
  variant: 'desktop' | 'mobile';
}) {
  const { t } = useLanguage();
  const { baselineSaved, draft, setDraft, focused, setFocused, saving, justSaved, commit } = state;
  const desktop = variant === 'desktop';

  return (
    <div
      className={cn('relative inline-flex items-center', desktop ? 'w-[88px]' : 'w-[120px]')}
    >
      <Input
        type="number"
        min={0}
        max={100}
        step="0.1"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          void commit();
        }}
        {...(desktop
          ? {
              onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).blur();
                }
              },
              title: t('adminProjectSetupPage.baselineInputTitle'),
            }
          : {})}
        placeholder="0"
        className={cn(
          'h-8 text-right tabular-nums transition-colors',
          desktop ? 'text-xs pr-6' : 'text-sm pr-7',
          saving && 'border-warning/60',
          justSaved && 'border-success ring-2 ring-success/30',
          !saving &&
            !justSaved &&
            baselineSaved > 0 &&
            !focused &&
            'border-success/40 text-success font-semibold',
        )}
      />
      <span
        className={cn(
          'pointer-events-none absolute right-2 text-muted-foreground',
          desktop ? 'text-micro' : 'text-xs',
        )}
      >
        {saving ? '…' : justSaved ? '✓' : '%'}
      </span>
    </div>
  );
}

export default TaskBaselineInput;
