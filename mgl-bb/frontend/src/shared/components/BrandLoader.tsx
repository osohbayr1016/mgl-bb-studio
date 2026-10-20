import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

/* =============================================================
 * BrandLoader
 *
 * Lightweight loading state used while the auth session is being
 * resolved and as the lazy-route Suspense fallback. Renders the
 * animated brand mark from `public/loading.svg` (a self-contained
 * SMIL animation — logo + "Loading" lettering — so there is no JS
 * animation cost and no media payload). The localized status label
 * rides along as the image's `alt` + an aria-live region for
 * screen readers.
 * ============================================================= */

export function BrandLoader({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const resolvedLabel = label ?? t('brandLoader.loading');
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center min-h-screen bg-background',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <img
        src="/loading.svg"
        alt={resolvedLabel}
        className="w-72 max-w-[80vw] h-auto select-none"
        draggable={false}
      />
      <span className="sr-only">{resolvedLabel}</span>
    </div>
  );
}
