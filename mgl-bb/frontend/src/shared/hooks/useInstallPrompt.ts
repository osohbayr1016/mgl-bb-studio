import { useCallback, useSyncExternalStore } from 'react';

import { installStore, promptInstall } from '@/shared/lib/installPrompt';
import { isIosSafari, isStandalone } from '@/shared/lib/push';

export type InstallState = 'installed' | 'available' | 'ios-manual' | 'unavailable';

function readInstalledFlag(): boolean {
  try {
    return localStorage.getItem('pwa_installed') === '1';
  } catch {
    return false;
  }
}

/**
 * Install-to-home-screen availability.
 *
 *   'installed'   — already running standalone, or we recorded an install
 *   'available'   — Chromium captured a `beforeinstallprompt` we can fire
 *   'ios-manual'  — iOS/iPadOS: WebKit NEVER fires `beforeinstallprompt`, so
 *                   the only route is the Share → "Нүүр дэлгэцэнд нэмэх"
 *                   sequence, which we have to teach rather than trigger
 *   'unavailable' — not installable here (unsupported browser, criteria not
 *                   met, or the event was already consumed)
 */
export function useInstallPrompt() {
  const deferred = useSyncExternalStore(
    installStore.subscribe,
    installStore.get,
    // Server snapshot: no install event exists during SSR/prerender.
    () => null,
  );

  let state: InstallState;
  if (isStandalone() || readInstalledFlag()) {
    state = 'installed';
  } else if (deferred) {
    state = 'available';
  } else if (isIosSafari()) {
    state = 'ios-manual';
  } else {
    state = 'unavailable';
  }

  const prompt = useCallback(() => promptInstall(), []);

  return { state, prompt };
}
