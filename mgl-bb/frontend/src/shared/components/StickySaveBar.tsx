import { useEffect, useRef, useState } from 'react';
import { Save, Loader2, Undo2, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

/**
 * StickySaveBar — viewport-pinned save action for long forms.
 *
 * Sits at the bottom of the screen and tracks unsaved-changes count so
 * the admin never has to scroll back up to commit work.  The bar
 * animates in only when there's something to save (or when an error
 * keeps the page in an unhealthy state); a successful save shows a
 * brief "Хадгалагдсан" confirmation strip before fading away.
 *
 * Cmd/Ctrl+S is bound globally while the bar is mounted, so the same
 * shortcut works whether the focus is in an input, on a button, or on
 * the page body.
 */
export default function StickySaveBar({
  dirtyCount,
  saving,
  errorText,
  onSave,
  onDiscard,
}: {
  dirtyCount: number;
  saving: boolean;
  errorText?: string | null;
  onSave: () => void;
  onDiscard?: () => void;
}) {
  const { t } = useLanguage();
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isSave = (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S');
      if (!isSave) return;
      e.preventDefault();
      if (saving) return;
      onSave();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saving, onSave]);

  // Brief "Хадгалагдсан" green confirmation right after a save resolves.
  // We watch the saving→clean transition and hold the bar visible for a
  // beat so the admin sees the success cue before it slides away.
  const [justSaved, setJustSaved] = useState(false);
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving && !errorText && dirtyCount === 0) {
      setJustSaved(true);
      const t = setTimeout(() => setJustSaved(false), 1800);
      wasSaving.current = false;
      return () => clearTimeout(t);
    }
    if (saving) wasSaving.current = true;
  }, [saving, errorText, dirtyCount]);

  const visible = dirtyCount > 0 || saving || !!errorText || justSaved;
  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label={t('common.save')}
      className={cn(
        // ⚠️ Утсан дээр доод navbar-ын ДЭЭР байрлана. Урьд нь хоёулаа
        // `bottom-0 z-40` байсан тул хадгалах мөр таб мөрийг бүрэн халхалдаг
        // байв (/app/projects/:id/setup). `z-30` нь navbar-ын `z-40`-ээс доор.
        'fixed inset-x-0 z-30 border-t backdrop-blur',
        'bottom-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom))] lg:bottom-0',
        'animate-in slide-in-from-bottom-2 fade-in duration-200',
        errorText
          ? 'border-destructive/40 bg-destructive/10'
          : justSaved
            ? 'border-success/40 bg-success/10'
            : 'border-primary/30 bg-background/95',
      )}
    >
      <div className="mx-auto max-w-7xl px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm min-w-0">
          {errorText ? (
            <>
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-destructive truncate" title={errorText}>
                {errorText}
              </span>
            </>
          ) : saving ? (
            <>
              <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
              <span className="text-muted-foreground">{t('common.saving')}</span>
            </>
          ) : justSaved ? (
            <>
              <Check className="h-4 w-4 text-success shrink-0" />
              <span className="text-success font-medium">{t('stickySaveBar.saved')}</span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-primary/15 text-primary text-micro font-semibold tabular-nums">
                {dirtyCount}
              </span>
              <span className="text-foreground/90">{t('stickySaveBar.unsavedChanges')}</span>
              <span className="hidden md:inline text-micro text-muted-foreground ml-1">
                ·{' '}
                <kbd className="px-1.5 py-0.5 rounded border border-border/60 text-micro font-mono bg-muted/40">
                  Ctrl
                </kbd>{' '}
                <kbd className="px-1.5 py-0.5 rounded border border-border/60 text-micro font-mono bg-muted/40">
                  S
                </kbd>{' '}
                {t('stickySaveBar.toSave')}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onDiscard && dirtyCount > 0 && !saving && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDiscard}
              className="h-8 text-muted-foreground hover:text-foreground"
            >
              <Undo2 className="w-3.5 h-3.5 mr-1.5" />
              {t('stickySaveBar.discard')}
            </Button>
          )}
          {!justSaved && (
            <Button
              size="sm"
              onClick={onSave}
              disabled={saving || dirtyCount === 0}
              className="h-8 shadow-md shadow-primary/20"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5 mr-1.5" />
              )}
              {t('common.save')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Subtle "Хадгалагдсан" pill that callers can render right after a
 * successful save so the user gets immediate visual feedback even when
 * the toast has already faded.  Hidden when there are pending changes
 * (so it doesn't lie about state).
 */
export function SavedRecentlyPill({ visible }: { visible: boolean }) {
  const { t } = useLanguage();
  if (!visible) return null;
  return (
    <span className="inline-flex items-center gap-1 text-micro text-success animate-in fade-in slide-in-from-top-0.5 duration-300">
      <Check className="w-3 h-3" />
      {t('stickySaveBar.savedRecently')}
    </span>
  );
}
