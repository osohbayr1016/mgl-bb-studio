import { useEffect } from 'react';

import { THEME_CLASSES, currentThemeClass } from '@/shared/lib/theme';

/**
 * Force the light palette while a standalone page is mounted, restoring
 * the previous mode on unmount.
 *
 * The quote-fill / print surfaces (request form, client fill, PDF print)
 * render OUTSIDE the staff Layout and are designed light-only (white
 * cards, navy text). The app's default theme is `dark`, and a fresh
 * Browser Rendering session has no persisted theme — without this the
 * `Card` (`bg-card`) surfaces and `text-foreground`/`border-border`
 * tokens would render dark, breaking the layout and the server-side PDF.
 *
 * Mirrors the inline pattern already used by LandingPage and
 * ClientDashboardPage.
 */
export function useForceLightTheme(): void {
  useEffect(() => {
    const root = document.documentElement;
    const previous = currentThemeClass();
    const enforce = () => {
      if (!root.classList.contains('light')) {
        root.classList.remove(...THEME_CLASSES);
        root.classList.add('light');
      }
    };
    enforce();
    // Re-assert light if another theme manager mutates the class while we
    // are mounted — e.g. ThemeProvider's `system` matchMedia listener
    // flipping dark/light on an OS preference change. The guard above
    // makes our own mutations no-ops, so the observer settles immediately.
    const observer = new MutationObserver(enforce);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
      root.classList.remove(...THEME_CLASSES);
      root.classList.add(previous);
    };
  }, []);
}
