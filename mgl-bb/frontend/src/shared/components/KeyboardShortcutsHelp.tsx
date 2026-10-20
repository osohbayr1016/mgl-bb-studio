import { useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';

/**
 * KeyboardShortcutsHelp — `?` cheatsheet for power users.
 *
 * Renders a small "shortcuts" trigger and a dialog listing the page's
 * keyboard bindings.  Also wires up a global `?` key listener (when not
 * focused on an editable element) that opens the dialog, mirroring the
 * conventions of GitHub / Linear.
 */

export interface ShortcutEntry {
  /** Pre-formatted key combo, e.g. "Ctrl + S" */
  keys: string;
  /** What pressing the combo does, in human language. */
  description: string;
}

const isEditableTarget = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
};

export default function KeyboardShortcutsHelp({ shortcuts }: { shortcuts: ShortcutEntry[] }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '?' && !(e.shiftKey && e.key === '/')) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      setOpen((v) => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
          title={t('keyboardShortcutsHelp.triggerTitle')}
        >
          <Keyboard className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-primary" />
            {t('keyboardShortcutsHelp.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5 mt-2">
          {shortcuts.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2"
            >
              <span className="text-sm text-muted-foreground">{s.description}</span>
              <KeyCombo combo={s.keys} />
            </div>
          ))}
        </div>
        <div className="text-micro text-muted-foreground pt-2 border-t border-border/40 mt-2">
          {t('keyboardShortcutsHelp.macHint')} <KeyCap small>Ctrl</KeyCap> = <KeyCap small>⌘</KeyCap>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KeyCombo({ combo }: { combo: string }) {
  const parts = combo.split('+').map((p) => p.trim());
  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground text-micro">+</span>}
          <KeyCap>{p}</KeyCap>
        </span>
      ))}
    </span>
  );
}

function KeyCap({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  return (
    <kbd
      className={
        small
          ? 'inline-flex items-center justify-center min-w-[20px] px-1 h-4 text-micro font-mono rounded border border-border/60 bg-muted/40'
          : 'inline-flex items-center justify-center min-w-[28px] px-1.5 h-6 text-micro font-mono rounded border border-border/60 bg-muted/50 shadow-sm'
      }
    >
      {children}
    </kbd>
  );
}
