/** Draft state for a task's "Анхны явц" (carry-over %) input.
 *
 *  Local draft so the admin can type freely without firing a save on every
 *  keystroke; we commit on blur, Enter, or after a short debounce so a fast
 *  worker who never blurs (e.g. tabs straight to the next row's input) can't
 *  lose data. Extracted from `AdminProjectSetupPage.tsx`'s `TaskRow` when
 *  that module was split up — no behavioural change. */
import { useEffect, useState } from 'react';

export function useTaskBaseline(
  progress: number | undefined,
  onBaseline: (pct: number) => Promise<void> | void,
) {
  // Re-synced whenever the parent's `task.progress` changes (e.g. after
  // a worker submits new progress and the page refetches).
  const baselineSaved = Math.round((progress ?? 0) * 10) / 10;
  const [draft, setDraft] = useState<string>(baselineSaved > 0 ? String(baselineSaved) : '');
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Avoid clobbering the admin's mid-edit value if the parent re-renders
  // — only adopt the new server value while the input is unfocused.
  useEffect(() => {
    if (focused) return;
    setDraft(baselineSaved > 0 ? String(baselineSaved) : '');
  }, [baselineSaved, focused]);

  const commit = async () => {
    if (!onBaseline) return;
    const trimmed = draft.trim();
    const next = trimmed === '' ? 0 : parseFloat(trimmed);
    if (!Number.isFinite(next)) {
      setDraft(baselineSaved > 0 ? String(baselineSaved) : '');
      return;
    }
    const clamped = Math.max(0, Math.min(100, next));
    // No-op when the value matches what we already think is saved — but
    // only when we're not in a "just retyped the same number" state.
    if (Math.abs(clamped - baselineSaved) < 0.01) return;
    setSaving(true);
    try {
      await onBaseline(clamped);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  // Debounced auto-commit: 900 ms after the last keystroke we save even
  // if focus hasn't moved.  Protects users who tab straight to the next
  // input or click into a popover without first blurring this field.
  useEffect(() => {
    if (!focused) return;
    const trimmed = draft.trim();
    if (trimmed === '') return;
    const next = parseFloat(trimmed);
    if (!Number.isFinite(next)) return;
    const clamped = Math.max(0, Math.min(100, next));
    if (Math.abs(clamped - baselineSaved) < 0.01) return;
    const handle = window.setTimeout(() => {
      void commit();
    }, 900);
    return () => window.clearTimeout(handle);
    // commit is stable enough for this debounce — re-running on
    // every keystroke is exactly the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, focused, baselineSaved]);

  return { baselineSaved, draft, setDraft, focused, setFocused, saving, justSaved, commit };
}

export type TaskBaselineState = ReturnType<typeof useTaskBaseline>;
