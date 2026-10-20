import * as React from 'react';
import { Sparkles, Loader2, Undo2 } from 'lucide-react';
import { Textarea } from '@/ui/textarea';
import { apiFetch, ApiError } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

/* =============================================================
 * Textarea + "Сайжруулах" (AI Mongolian polish) button.
 * -------------------------------------------------------------
 * Drop-in replacement for the base `<Textarea>` component.
 * Adds a small button below the textarea that, when clicked,
 * sends the current value to `POST /api/ai/refine-mongolian`
 * and swaps the textarea contents with the AI-cleaned version.
 *
 * Workflow:
 *   1. User writes Mongolian (with typical typos / soft-sign
 *      mistakes / mixed punctuation).
 *   2. Clicks "Сайжруулах".  Button shows a spinner, textarea
 *      is locked.
 *   3. AI returns within ~1-3 s.  The textarea value is replaced
 *      via `onChange`; the original text is held in local state
 *      and a "Буцаах" link appears next to the button for 10 s.
 *   4. Either the user clicks Буцаах (restores original) or
 *      types something new (clears the undo state so their
 *      newer edit isn't overwritten).
 *
 * `aiPolish` defaults to `true` — set it `false` to suppress
 * the button on surfaces where it doesn't make sense (chat
 * input, search, anything that isn't free-form Mongolian prose).
 * ============================================================= */

const UNDO_TIMEOUT_MS = 10_000;

export type PolishableTextareaProps = React.ComponentProps<typeof Textarea> & {
  /** Set to `false` to hide the "Сайжруулах" button entirely.
   *  Defaults to `true`. */
  aiPolish?: boolean;
};

interface RefineResponse {
  refined: string;
}

export function PolishableTextarea({
  aiPolish = true,
  disabled,
  value,
  onChange,
  onInput,
  className,
  ...rest
}: PolishableTextareaProps) {
  const { t } = useLanguage();
  const [polishing, setPolishing] = React.useState(false);
  // When non-null, holds the pre-polish text so we can offer a
  // Буцаах undo for `UNDO_TIMEOUT_MS`.  Set to null once either
  // the timeout fires or the user types again (their new edit
  // would otherwise be silently overwritten by a late undo).
  const [undoOriginal, setUndoOriginal] = React.useState<string | null>(null);

  // Auto-dismiss the undo offer after the timeout.  Re-arms whenever
  // a fresh undo target appears.
  React.useEffect(() => {
    if (undoOriginal == null) return;
    const t = window.setTimeout(() => setUndoOriginal(null), UNDO_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [undoOriginal]);

  const currentText = typeof value === 'string' ? value : '';
  const canPolish = aiPolish && !disabled && !polishing && currentText.trim().length > 0;

  // Synthesize a change event for the controlled `onChange` consumer
  // so we don't have to know whether the parent is using value/onChange
  // directly or wrapping it. The target details match what React would
  // dispatch for a real textarea edit.
  const emitChange = (next: string) => {
    if (!onChange) return;
    const synthetic = {
      target: { value: next },
      currentTarget: { value: next },
    } as unknown as React.ChangeEvent<HTMLTextAreaElement>;
    onChange(synthetic);
  };

  const handlePolish = async () => {
    if (!canPolish) return;
    const original = currentText;
    setPolishing(true);
    try {
      const res = await apiFetch<RefineResponse>('/ai/refine-mongolian', {
        method: 'POST',
        data: { text: original },
      });
      const refined = (res.refined ?? '').trim();
      if (!refined) {
        toast.error(t('polishableTextarea.polishFailed'), t('polishableTextarea.noAiResponse'));
        return;
      }
      if (refined === original.trim()) {
        toast.info(t('polishableTextarea.noChangeNeeded'), t('polishableTextarea.alreadyCorrect'));
        setUndoOriginal(null);
        return;
      }
      emitChange(refined);
      setUndoOriginal(original);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('common.error');
      toast.error(t('polishableTextarea.polishFailed'), msg);
    } finally {
      setPolishing(false);
    }
  };

  const handleUndo = () => {
    if (undoOriginal == null) return;
    emitChange(undoOriginal);
    setUndoOriginal(null);
  };

  return (
    <div className="space-y-1.5">
      <Textarea
        value={value}
        onChange={onChange}
        // Inline so TS infers the exact onInput signature from the
        // Textarea component (React 19 uses InputEvent here, not the
        // older FormEvent).  Behaviour: clear the undo offer once the
        // user starts editing again — their newer content takes
        // precedence over a possibly-late undo click.
        onInput={(e) => {
          if (undoOriginal != null && !polishing) {
            const next = e.currentTarget.value ?? '';
            if (next !== currentText) setUndoOriginal(null);
          }
          onInput?.(e);
        }}
        disabled={disabled || polishing}
        className={className}
        {...rest}
      />
      {aiPolish && (
        <div className="flex items-center justify-end gap-3">
          {undoOriginal != null && !polishing && (
            <button
              type="button"
              onClick={handleUndo}
              className="inline-flex items-center gap-1 text-micro text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
            >
              <Undo2 className="w-3 h-3" />
              {t('polishableTextarea.undo')}
            </button>
          )}
          <button
            type="button"
            onClick={handlePolish}
            disabled={!canPolish}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-micro font-medium',
              'text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-card disabled:hover:text-muted-foreground disabled:hover:border-border/60',
            )}
            title={t('polishableTextarea.tooltip')}
          >
            {polishing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {polishing ? t('polishableTextarea.polishing') : t('polishableTextarea.polish')}
          </button>
        </div>
      )}
    </div>
  );
}
