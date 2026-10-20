/**
 * Service-worker registration + the "update available" external store.
 *
 * Call `registerServiceWorker()` once from the app entry (main.tsx).
 * `UpdatePrompt.tsx` subscribes to `updateStore` via `useSyncExternalStore`
 * and calls `applyUpdate()` when the user clicks.
 *
 * See `public/sw.js` for why the waiting worker is NOT activated
 * automatically.
 */

/* ---------------------------------------------------------------------
 * Update store — a 4-line external store rather than a context/provider so
 * `registerServiceWorker()` can stay callable from module scope in main.tsx,
 * long before React mounts.
 * ------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();
let waitingWorker: ServiceWorker | null = null;
/** Stable snapshot value — `useSyncExternalStore` compares with Object.is. */
let snapshot = false;

function emit() {
  for (const l of listeners) l();
}

function setWaiting(sw: ServiceWorker | null) {
  waitingWorker = sw;
  const next = sw !== null;
  if (next !== snapshot) {
    snapshot = next;
    emit();
  }
}

export const updateStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** true when a new service worker is installed and waiting to take over. */
  getSnapshot(): boolean {
    return snapshot;
  },
};

/**
 * User-initiated activation of the waiting worker. Tells it to skipWaiting;
 * the resulting `controllerchange` event reloads the page (see below), which
 * re-fetches index.html and therefore the new build's chunk names.
 */
export function applyUpdate(): void {
  if (!waitingWorker) return;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

/**
 * Шинэ хувилбар гарсан эсэхийг ЯГ ОДОО шалгуулна.
 *
 * Ердийн үед бүртгэл нь апп нээх бүрд болон цаг тутам шалгадаг.  Үүнийг
 * pull-to-refresh дуудна: хэрэглэгч «сэргээх» гэж татсан бол өгөгдлөө
 * татахын зэрэгцээ аппын шинэ хувилбарыг ч хайх нь зөв.  Шинэ worker
 * олдвол `updateStore` асаж «Шинэчлэх» товч гарч ирнэ.
 */
export async function checkForAppUpdate(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
  } catch {
    /* сүлжээгүй / бүртгэлгүй — чимээгүй өнгөрнө */
  }
}

/* ---------------------------------------------------------------------
 * Registration
 * ------------------------------------------------------------------- */

/** Routes that must never have a service worker racing them. */
function isSwExemptPath(pathname: string): boolean {
  // Cloudflare Browser Rendering drives these for server-side PDFs. A SW
  // installing mid-render can delay/alter the first paint and the screenshot
  // fires against a half-painted document. `window.print()` from a real user
  // hits the same routes, so the exemption is unconditional.
  if (/^\/(reports|meetings)\//.test(pathname)) return true;
  if (/^\/quotes\/[^/]+\/print/.test(pathname)) return true;
  return false;
}

/** Nuke every registration + cache. Used by the ?nosw=1 escape hatch. */
async function purgeServiceWorkers(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* ignore */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
}

let reloading = false;

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const { pathname, search } = window.location;

  if (isSwExemptPath(pathname)) return;

  /* ------------------------------------------------------------------
   * ESCAPE HATCH — https://<host>/app?nosw=1
   *
   * Fully uninstalls the worker, wipes every cache, and remembers the
   * opt-out in localStorage so a subsequent load doesn't immediately
   * re-register. This is the link you text to a user who is somehow stuck
   * on a broken/stale worker; it needs no deploy and no devtools.
   * `sw_disabled` is cleared by hand (or by clearing site data).
   * ---------------------------------------------------------------- */
  const params = new URLSearchParams(search);
  if (params.get('nosw') === '1') {
    void (async () => {
      await purgeServiceWorkers();
      try {
        localStorage.setItem('sw_disabled', '1');
      } catch {
        /* storage may be blocked */
      }
      params.delete('nosw');
      const qs = params.toString();
      // replace() so the escape hatch doesn't sit in history and re-trigger
      // on a Back navigation.
      window.location.replace(`${pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    })();
    return;
  }

  try {
    if (localStorage.getItem('sw_disabled') === '1') return;
  } catch {
    /* storage may be blocked — fall through and register */
  }

  // A service worker in dev fights Vite's HMR: it caches the module graph the
  // dev server is actively rewriting and serves stale HTML/chunks, producing
  // "why isn't my edit showing" ghosts. Actively unregister any worker left
  // over from a `vite preview` run on the same localhost origin.
  if (!import.meta.env.PROD) {
    void purgeServiceWorkers();
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Already-waiting worker from a previous visit in this session.
        if (reg.waiting && navigator.serviceWorker.controller) {
          setWaiting(reg.waiting);
        }

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // `controller` being non-null distinguishes an UPDATE from the
            // very first install. On first install there is nothing to
            // update to and no prompt should appear.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });

        // Long-lived tabs (the office leaves this open all day) would
        // otherwise never notice a deploy. Hourly is cheap: the request is
        // conditional and /sw.js is served `no-cache`, so it's a 304 in the
        // common case.
        window.setInterval(
          () => {
            void reg.update().catch(() => undefined);
          },
          60 * 60 * 1000,
        );
      })
      .catch(() => {
        // Registration can legitimately fail (private mode, enterprise
        // policy, an unexpected MIME type). The app works fine without a SW.
      });
  });

  // Fired once the new worker actually takes control — i.e. only after the
  // user accepted the update. Reload so the document matches the worker.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}
