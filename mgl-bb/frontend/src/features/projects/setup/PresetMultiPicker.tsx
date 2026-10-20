/* ==========================================================================
   PresetMultiPicker — check many presets, add them all in one confirm
   ==========================================================================
   Powers the "Зургийн төрөл / Бүрдлийн төрөл / Ажлын төрөл" dialogs so admins
   don't have to click-save-click-save through long lists. Selection state is
   local to the dialog and resets when it closes.

   Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
   module was split up — no behavioural change.
*/
import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';

import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

export interface PresetOption {
  key: string;
  value: string;
  label: React.ReactNode;
}

export function PresetMultiPicker({
  title,
  trigger,
  presets,
  onConfirm,
  onAddCustom,
}: {
  title: string;
  trigger: React.ReactNode;
  presets: PresetOption[];
  onConfirm: (selectedValues: string[]) => void | Promise<void>;
  onAddCustom?: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Reset picks whenever the dialog is closed so the next open starts clean.
  useEffect(() => {
    if (!open) setPicked(new Set());
  }, [open]);

  const allKeys = useMemo(() => presets.map((p) => p.key), [presets]);
  const allChecked = picked.size > 0 && picked.size === presets.length;

  const toggle = (key: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setPicked((prev) => (prev.size === presets.length ? new Set() : new Set(allKeys)));
  };

  const handleConfirm = async () => {
    if (picked.size === 0) return;
    const byKey = new Map(presets.map((p) => [p.key, p]));
    // Preserve catalogue order rather than click order — matches user's
    // mental model of the list they're looking at.
    const values = presets.filter((p) => picked.has(p.key)).map((p) => p.value);
    void byKey;
    setSaving(true);
    try {
      await onConfirm(values);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Select-all / clear toolbar */}
        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <Checkbox
              checked={allChecked ? true : picked.size > 0 ? 'indeterminate' : false}
              onCheckedChange={() => toggleAll()}
              className="size-3.5"
            />
            {t('adminProjectSetupPage.selectAll')}
          </label>
          <span className="text-micro text-muted-foreground tabular-nums">
            {t('adminProjectSetupPage.pickedOfTotal', {
              picked: picked.size,
              total: presets.length,
            })}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto pr-1">
          {presets.map((p) => {
            const isSel = picked.has(p.key);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => toggle(p.key)}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-left transition-colors',
                  isSel
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border bg-background/40 hover:bg-muted/40 text-foreground',
                )}
              >
                <span
                  className={cn(
                    'h-4 w-4 rounded border flex items-center justify-center flex-shrink-0',
                    isSel ? 'bg-primary border-primary' : 'border-border',
                  )}
                >
                  {isSel && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </span>
                <span className="flex-1 min-w-0 whitespace-normal">{p.label}</span>
              </button>
            );
          })}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          {onAddCustom ? (
            <DialogClose asChild>
              <Button type="button" variant="ghost" className="text-xs" onClick={onAddCustom}>
                <Plus className="w-3 h-3 mr-1" /> {t('adminProjectSetupPage.otherEmpty')}
              </Button>
            </DialogClose>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button type="button" onClick={handleConfirm} disabled={picked.size === 0 || saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {picked.size > 0
                ? t('adminProjectSetupPage.addCount', { count: picked.size })
                : t('adminProjectSetupPage.select')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PresetMultiPicker;
