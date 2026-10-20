/**
 * Bilingual edit field — MN + EN inputs side by side.
 *
 * Used by every per-block editor that touches bilingual content. The
 * side-by-side layout (vs. tabbed) keeps both languages visible so the
 * admin can compare them while editing — the same pattern the legacy
 * AdminLandingPage used, lifted here so it lives next to the block
 * editors that consume it.
 *
 * `multiline` switches to `<Textarea>`. `aiPolish` (multiline only)
 * swaps the MN side for `PolishableTextarea`, which adds an AI cleanup
 * button — useful for long-form prose (about_body, news excerpts,
 * project description, philosophy).
 */

import type { ChangeEvent } from 'react';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { PolishableTextarea } from '@/ui/PolishableTextarea';

export interface BilingualFieldProps {
  label: string;
  mnValue: string;
  enValue: string;
  onChange: (lang: 'mn' | 'en', next: string) => void;
  multiline?: boolean;
  rows?: number;
  /** Only meaningful when `multiline=true`. Adds the AI polish button
   *  to the MN textarea. Off by default since most short fields don't
   *  benefit from it. */
  aiPolish?: boolean;
  /** Render a smaller, denser variant for nested cards (e.g. inside a
   *  service item or gallery image caption). */
  dense?: boolean;
  placeholderMn?: string;
  placeholderEn?: string;
  /** Called on blur of either side — admin editors hang autosave off it. */
  onBlur?: () => void;
}

export function BilingualField({
  label,
  mnValue,
  enValue,
  onChange,
  multiline = false,
  rows,
  aiPolish = false,
  dense = false,
  placeholderMn,
  placeholderEn,
  onBlur,
}: BilingualFieldProps) {
  const handleMn = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange('mn', e.target.value);
  const handleEn = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange('en', e.target.value);

  const effectiveRows = rows ?? (dense ? 2 : 3);

  return (
    <div className={dense ? 'space-y-1' : 'space-y-2'}>
      <Label className={dense ? 'text-xs font-medium' : 'text-sm font-medium'}>{label}</Label>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">MN</div>
          {multiline ? (
            aiPolish ? (
              <PolishableTextarea
                value={mnValue}
                onChange={handleMn}
                onBlur={onBlur}
                rows={effectiveRows}
                placeholder={placeholderMn}
              />
            ) : (
              <Textarea
                value={mnValue}
                onChange={handleMn}
                onBlur={onBlur}
                rows={effectiveRows}
                placeholder={placeholderMn}
              />
            )
          ) : (
            <Input
              value={mnValue}
              onChange={handleMn}
              onBlur={onBlur}
              placeholder={placeholderMn}
            />
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">EN</div>
          {multiline ? (
            <Textarea
              value={enValue}
              onChange={handleEn}
              onBlur={onBlur}
              rows={effectiveRows}
              placeholder={placeholderEn}
            />
          ) : (
            <Input
              value={enValue}
              onChange={handleEn}
              onBlur={onBlur}
              placeholder={placeholderEn}
            />
          )}
        </div>
      </div>
    </div>
  );
}
