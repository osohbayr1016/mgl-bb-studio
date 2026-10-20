import { AlertTriangle } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

/** Журмын анхааруулгууд — жагсаалтад ил, диалогт хүрээтэй хэлбэрээр. */
export default function PolicyWarningList({
  warnings,
  variant,
}: {
  warnings: string[] | null | undefined;
  variant: 'inline' | 'boxed';
}) {
  if (!warnings || warnings.length === 0) return null;
  const boxed = variant === 'boxed';
  return (
    <ul
      className={cn(
        boxed
          ? 'space-y-1 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 px-3 py-2'
          : 'mt-1.5 space-y-0.5',
      )}
    >
      {warnings.map((w, i) => (
        <li
          key={i}
          className={cn(
            'flex items-start gap-1.5 text-[11px]',
            boxed ? 'text-amber-800 dark:text-amber-300' : 'text-amber-700 dark:text-amber-400',
          )}
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}
