import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

/* =============================================================
 * Toast — global slide-in alert system
 * -------------------------------------------------------------
 * Tiny pub/sub store + portal renderer. Use it from anywhere:
 *
 *   import { showToast } from '@/shared/components/Toast';
 *   showToast({ tone: 'success', title: 'Хадгаллаа' });
 *   showToast({ tone: 'error', title: 'Алдаа', description: err.message });
 *
 * Mount <Toaster /> ONCE at the app root (see main.tsx). Toasts
 * stack top-right and slide in from off-screen, then auto-dismiss
 * after `duration` ms (default 4000). Errors auto-extend to 6000
 * because users actually need to read them.
 *
 * No external deps — keeps the bundle the same size.
 * ============================================================= */

export type ToastTone = 'success' | 'error' | 'warn' | 'info';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  duration?: number;
  /** Сонголттой үйлдлийн товч (жишээ нь «Буцаах») — дарахад үйлдэл ажиллаж toast хаагдана. */
  action?: { label: string; onClick: () => void };
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(toasts);
}

function genId() {
  // crypto.randomUUID isn't available in every browser/runtime; fall back
  // to a Math.random id so the system never hard-fails on edge platforms.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function showToast(input: Omit<ToastItem, 'id'>): string {
  const id = genId();
  const item: ToastItem = {
    id,
    duration: input.tone === 'error' ? 6000 : 4000,
    ...input,
  };
  toasts = [...toasts, item];
  emit();
  if (item.duration && item.duration > 0) {
    setTimeout(() => dismissToast(id), item.duration);
  }
  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Convenience helpers so call-sites don't need to import the type. */
export const toast = {
  success: (title: string, description?: string) =>
    showToast({ tone: 'success', title, description }),
  error: (title: string, description?: string) => showToast({ tone: 'error', title, description }),
  warn: (title: string, description?: string) => showToast({ tone: 'warn', title, description }),
  info: (title: string, description?: string) => showToast({ tone: 'info', title, description }),
  /** Үйлдлийн товчтой амжилтын мэдэгдэл (жишээ нь хадгалсны дараах «Буцаах») — удаан (12 сек) харагдана. */
  successWithAction: (title: string, action: { label: string; onClick: () => void }, description?: string) =>
    showToast({ tone: 'success', title, description, action, duration: 12_000 }),
};

const TONE_STYLES: Record<
  ToastTone,
  {
    bar: string;
    bg: string;
    border: string;
    iconColor: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  success: {
    bar: 'bg-success',
    bg: 'bg-success/10',
    border: 'border-success/30',
    iconColor: 'text-success',
    Icon: CheckCircle2,
  },
  error: {
    bar: 'bg-destructive',
    bg: 'bg-destructive/10',
    border: 'border-destructive/30',
    iconColor: 'text-destructive',
    Icon: AlertCircle,
  },
  warn: {
    bar: 'bg-warning',
    bg: 'bg-warning/10',
    border: 'border-warning/30',
    iconColor: 'text-warning',
    Icon: AlertTriangle,
  },
  info: {
    bar: 'bg-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/30',
    iconColor: 'text-primary',
    Icon: Info,
  },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>(toasts);

  useEffect(() => {
    const l: Listener = (next) => setItems(next);
    listeners.add(l);
    // Sync any toasts that fired before the Toaster mounted.
    setItems(toasts);
    return () => {
      listeners.delete(l);
    };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[100] flex flex-col items-end justify-start gap-2 px-3 py-4 sm:px-4 sm:py-5"
      aria-live="polite"
      aria-atomic="false"
    >
      {/* Anchor at top-right; new toasts push the older ones down. */}
      <div className="flex w-full max-w-sm flex-col gap-2 sm:items-end">
        {items.map((t) => (
          <ToastCard key={t.id} item={t} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const { t } = useLanguage();
  const styles = TONE_STYLES[item.tone];
  const Icon = styles.Icon;
  /* Local "entered" state drives the slide-in animation. We start
   * slightly off-screen + transparent and animate to the resting
   * position on the next frame so the transition actually plays
   * (mounting at the final state would skip the animation). */
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto relative w-full overflow-hidden rounded-xl border shadow-2xl shadow-black/40',
        'bg-card/95 backdrop-blur-md',
        styles.border,
        'transition-all duration-300 ease-out',
        entered ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0',
      )}
    >
      {/* Tone bar — slim coloured stripe down the left edge */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1', styles.bar)} />

      {/* Soft tinted wash so the toast still reads as the right tone
       *  even before the user notices the side bar. */}
      <div className={cn('absolute inset-0 pointer-events-none', styles.bg)} />

      <div className="relative flex items-start gap-3 px-4 py-3 pl-5">
        <Icon className={cn('h-4 w-4 mt-0.5 flex-shrink-0', styles.iconColor)} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground leading-tight">{item.title}</div>
          {item.description && (
            <div className="text-xs text-muted-foreground leading-snug mt-1 break-words">
              {item.description}
            </div>
          )}
          {item.action && (
            <button
              type="button"
              onClick={() => {
                dismissToast(item.id);
                item.action?.onClick();
              }}
              className="mt-2 rounded-md border border-border bg-background/60 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              data-testid="toast-action"
            >
              {item.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => dismissToast(item.id)}
          className="flex-shrink-0 -mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          aria-label={t('common.close')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
