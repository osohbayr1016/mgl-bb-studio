/**
 * `beforeinstallprompt` capture.
 *
 * MUST be module scope, not a React effect: Chromium fires
 * `beforeinstallprompt` as soon as the page qualifies for installation, which
 * is typically before hydration finishes — a listener attached inside a
 * `useEffect` misses the event entirely and the install button never appears.
 * So we attach at import time and *store* the event; React reads it later
 * through `useSyncExternalStore` (see hooks/useInstallPrompt.ts).
 *
 * Import this module for its side effect from the entry or from the hook.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let deferred: BeforeInstallPromptEvent | null = null;

function notify() {
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppress Chrome's own mini-infobar so we control placement/timing.
    e.preventDefault();
    deferred = e;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    // The captured event is single-use and now meaningless.
    deferred = null;
    try {
      localStorage.setItem('pwa_installed', '1');
    } catch {
      /* storage may be blocked */
    }
    notify();
  });
}

export const installStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** The captured event, or null if the browser hasn't offered one. */
  get(): BeforeInstallPromptEvent | null {
    return deferred;
  },
};

/**
 * Show the native install sheet. Resolves to the user's choice, or
 * `'unavailable'` when there is no captured event (iOS Safari, already
 * installed, or the event was already consumed).
 *
 * A `BeforeInstallPromptEvent` may only be prompted ONCE; we clear it either
 * way so the UI can't hand the browser a spent event.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const evt = deferred;
  if (!evt) return 'unavailable';
  deferred = null;
  notify();
  try {
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    return outcome;
  } catch {
    return 'unavailable';
  }
}
