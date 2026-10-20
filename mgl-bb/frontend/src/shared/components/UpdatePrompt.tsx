import { useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';

import { applyUpdate, updateStore } from '@/shared/lib/serviceWorker';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

/**
 * "Шинэ хувилбар бэлэн" pill.
 *
 * Deliberately NOT a Toast: `shared/components/Toast.tsx` has no action-button
 * slot and auto-dismisses after 4–6s. This notice must persist until the user
 * acts — a missed update means the tab keeps running against chunks the CDN
 * no longer serves (see the long comment in public/sw.js).
 *
 * Mount ONCE, inside the app shell. Renders null until a worker is waiting.
 */
export function UpdatePrompt({ className }: { className?: string }) {
  const { t } = useLanguage();
  const hasUpdate = useSyncExternalStore(
    updateStore.subscribe,
    updateStore.getSnapshot,
    () => false,
  );

  if (!hasUpdate) return null;

  return (
    <div
      className={cn(
        'fixed right-4 z-50',
        // Sit clear of the mobile bottom nav + the iOS home indicator. The
        // 3.5rem fallback matches the nav's default height when the CSS var
        // hasn't been set (e.g. a route that renders no bottom nav).
        'bottom-[calc(var(--app-bottom-nav-h,3.5rem)+env(safe-area-inset-bottom)+0.75rem)]',
        'lg:bottom-4',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-full border border-border/60 bg-card/95 py-1.5 pr-1.5 pl-4 shadow-2xl shadow-black/40 backdrop-blur-md">
        <span className="text-sm font-medium text-foreground whitespace-nowrap">
          {t('pwa.updateAvailable')}
        </span>
        <button
          type="button"
          onClick={applyUpdate}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:active:scale-[0.97]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('pwa.updateAction')}
        </button>
      </div>
    </div>
  );
}

export default UpdatePrompt;
