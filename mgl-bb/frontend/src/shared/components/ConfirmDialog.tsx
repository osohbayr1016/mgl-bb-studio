import { useEffect, useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog';
import { buttonVariants } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';

/* =============================================================
 * ConfirmDialog — global promise-based confirm() replacement
 * -------------------------------------------------------------
 * Drop-in for native `window.confirm()`: themed, dark/light-aware
 * and i18n-driven. Mirrors Toast.tsx's tiny pub/sub + global
 * outlet pattern. Use it from anywhere (component or callback):
 *
 *   import { confirmDialog } from '@/shared/components/ConfirmDialog';
 *
 *   if (!(await confirmDialog({ description: t('foo.deleteConfirm'),
 *                               variant: 'destructive' }))) return;
 *
 * Mount <ConfirmDialogOutlet /> ONCE at the app root, inside the
 * LanguageProvider (see providers.tsx) so default button labels
 * resolve via t(). The caller localises `description` itself.
 *
 * Concurrent calls are queued and shown one at a time.
 * ============================================================= */

export interface ConfirmOptions {
  /** The message (was the argument to confirm()). Supports `\n` line breaks. */
  description: string;
  /** Dialog title. Default: t('common.confirmTitle'). */
  title?: string;
  /** Confirm button label. Default: t('common.confirm'). */
  confirmText?: string;
  /** Cancel button label. Default: t('common.cancel'). */
  cancelText?: string;
  /** `destructive` paints the confirm button red (deletes/cancellations). */
  variant?: 'default' | 'destructive';
}

interface ConfirmRequest extends ConfirmOptions {
  id: string;
  resolve: (ok: boolean) => void;
}

type Listener = (req: ConfirmRequest | null) => void;

let current: ConfirmRequest | null = null;
const queue: ConfirmRequest[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(current);
}

function genId() {
  // crypto.randomUUID isn't available on every runtime; fall back gracefully.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Open a confirm dialog and resolve to the user's choice. Resolves `true`
 * on confirm, `false` on cancel / escape / overlay-dismiss.
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req: ConfirmRequest = { ...opts, id: genId(), resolve };
    if (current) {
      queue.push(req);
    } else {
      current = req;
      emit();
    }
  });
}

/** Resolve the active request and advance to the next queued one (if any). */
function settle(ok: boolean) {
  if (!current) return;
  current.resolve(ok);
  current = queue.shift() ?? null;
  emit();
}

export function ConfirmDialogOutlet() {
  const { t } = useLanguage();
  const [req, setReq] = useState<ConfirmRequest | null>(current);
  const [open, setOpen] = useState(Boolean(current));
  // Guards against double-settling: AlertDialog's action/cancel buttons close
  // the dialog AND fire onOpenChange(false), which would resolve twice.
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    const l: Listener = (next) => {
      if (next) {
        setReq(next);
        setOpen(true);
      } else {
        // Keep `req` so content stays stable through the exit animation.
        setOpen(false);
      }
    };
    listeners.add(l);
    // Sync any request that fired before this outlet mounted.
    if (current) {
      setReq(current);
      setOpen(true);
    }
    return () => {
      listeners.delete(l);
    };
  }, []);

  const handle = (ok: boolean) => {
    if (!req || handledRef.current === req.id) return;
    handledRef.current = req.id;
    settle(ok);
  };

  if (!req) return null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{req.title ?? t('common.confirmTitle')}</AlertDialogTitle>
          {/* `break-words` — тайлбарт серверийн мессеж, файлын нэр, дугаар
              зэрэг таслалгүй урт токен интерполяцлагддаг тул үүнгүйгээр
              хөндлөн халина. */}
          <AlertDialogDescription className="break-words whitespace-pre-line">
            {req.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* ⚠️ Устгах гэх мэт эргэлт буцалтгүй үйлдэлд `flex-col-reverse`-ыг
            дарж, ЦУЦЛАХ-ыг дээр байлгана.  Өгөгдмөл `flex-col-reverse` нь
            DOM дараалал (Цуцлах → Үйлдэл)-ыг эргүүлдэг тул утсан дээр
            «Устгах» нь дээд, хуруунд хамгийн ойр товч болж, платформын
            хэвшлийг тонгоруулж байсан. */}
        <AlertDialogFooter
          className={req.variant === 'destructive' ? 'flex-col sm:flex-row' : undefined}
        >
          <AlertDialogCancel onClick={() => handle(false)}>
            {req.cancelText ?? t('common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            className={req.variant === 'destructive' ? buttonVariants({ variant: 'destructive' }) : undefined}
            onClick={() => handle(true)}
          >
            {req.confirmText ?? t('common.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
