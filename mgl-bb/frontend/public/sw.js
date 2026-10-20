/* =====================================================================
 * MGL service worker — classic (non-module) worker, hand-written.
 * Registered from src/shared/lib/serviceWorker.ts with { scope: '/' }.
 * ---------------------------------------------------------------------
 *
 * ⚠️  TOMBSTONE RULE — THIS FILE MUST EXIST FOREVER.  ⚠️
 *
 * `public/_redirects` contains `/*  /index.html  200`.  If /sw.js is ever
 * deleted, Cloudflare Pages will happily answer GET /sw.js with the SPA's
 * index.html and **HTTP 200, Content-Type: text/html**.  The browser's
 * update check then fails its MIME/script check, throws, and *keeps the
 * previously installed worker registered and active*.  Every user who ever
 * loaded the app would be permanently pinned to a stale worker with no way
 * to self-heal — a soft-brick that no frontend deploy can fix.
 *
 * So: never delete this file, never rename it, never let a build step drop
 * it.  To RETIRE the service worker, replace the body of this file with a
 * self-destruct and ship *that*:
 *
 *     self.addEventListener('install', () => self.skipWaiting());
 *     self.addEventListener('activate', (e) => e.waitUntil((async () => {
 *       for (const k of await caches.keys()) await caches.delete(k);
 *       await self.registration.unregister();
 *       for (const c of await self.clients.matchAll({ type: 'window' })) {
 *         c.navigate(c.url);
 *       }
 *     })()));
 *
 * Only once that has been live long enough for every client to pick it up
 * may the file be reduced to a no-op — and even then, keep it served.
 * ===================================================================== */

// ⚠️ Deploy бүрд ахиулна.  Байт нь өөрчлөгдөхөд л браузер шинэ worker гэж
// үзэж, «Шинэчлэх» товч гарч ирдэг — өөрөөр хэлбэл аппаа нээлттэй орхисон
// хүмүүс шинэ хувилбарыг зөвхөн үүгээр л мэдэрнэ.
const SW_VERSION = '2026-10-05.1';
const SHELL = `mgl-shell-${SW_VERSION}`;
const ASSETS = `mgl-assets-${SW_VERSION}`;

/** Hard cap on the number of hashed build assets we keep cached (FIFO). */
const ASSET_CACHE_LIMIT = 120;

/**
 * Precache list.  Deliberately TINY.
 *
 * Never precache `/index.html` (it names the current build's entry chunk and
 * goes stale the moment we deploy) and never precache `/assets/*` (hashed
 * filenames change every build, and the list isn't known at author time —
 * this is a hand-written SW, not a generated Workbox manifest).
 */
const PRECACHE = ['/icons/icon-192.png'];

/** Canonical cache key for the offline page, regardless of how we fetched it. */
const OFFLINE_KEY = '/offline.html';

/**
 * Cache the offline page WITHOUT ever storing a redirected response.
 *
 * ⚠️ Cloudflare Pages strips the `.html` extension and answers
 * `GET /offline.html` with a **308 → /offline**.  A plain
 * `cache.addAll(['/offline.html'])` follows that redirect and stores a
 * response whose `redirected` flag is set — and the Service Worker spec
 * forbids `respondWith()`-ing a redirected response to a NAVIGATION request
 * (TypeError).  I.e. the offline page would blow up at exactly the moment it
 * is needed.
 *
 * So we fetch the canonical extension-less URL first (a direct 200 on Pages)
 * and only fall back to `/offline.html` for local `vite preview`, where the
 * file is served literally and `/offline` 404s.  Either way the entry is
 * stored under one fixed key so `caches.match(OFFLINE_KEY)` always hits.
 */
async function precacheOfflinePage(cache) {
  for (const url of ['/offline', '/offline.html']) {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (res && res.ok && !res.redirected) {
        await cache.put(OFFLINE_KEY, res);
        return;
      }
    } catch {
      /* try the next candidate */
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then(async (cache) => {
        await cache.addAll(PRECACHE);
        await precacheOfflinePage(cache);
      })
      // A precache miss (e.g. icons not yet deployed) must not abort the
      // install — the SW is still useful without it.
      .catch(() => undefined),
  );

  /* ---------------------------------------------------------------
   * ⚠️  NO self.skipWaiting() HERE — THIS IS LOAD-BEARING.  ⚠️
   *
   * The app is ~40 React.lazy() routes, i.e. the running tab will keep
   * dynamically importing /assets/<Name>-<hash>.js for as long as it is
   * open.  Cloudflare Pages only serves the CURRENT deployment's assets;
   * a request for a chunk from the PREVIOUS deployment 404s, and
   * `public/_redirects` (`/*  /index.html  200`) turns that 404 into
   * index.html with **HTTP 200 and Content-Type: text/html**.  The
   * dynamic import then rejects with a MIME/parse error and the route
   * blows up mid-session ("Failed to fetch dynamically imported module").
   *
   * The ASSETS cache below is the ONLY thing keeping those old chunks
   * reachable after a deploy.  If we called skipWaiting() automatically,
   * the new worker would activate immediately and its `activate` handler
   * would purge every non-current cache — deleting exactly the old chunks
   * the open tab still needs.  Every user with a tab open would start
   * hitting broken lazy routes on every single deploy.
   *
   * Instead the new worker sits in `waiting`, the page surfaces an
   * "update available" pill (UpdatePrompt.tsx), and only an explicit user
   * click posts { type: 'SKIP_WAITING' } (see the `message` handler) —
   * followed by a controllerchange-triggered reload, which re-downloads a
   * fresh index.html naming the new chunks.  Deliberate, user-timed,
   * never mid-interaction.
   * --------------------------------------------------------------- */
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  // The ONLY way this worker ever takes over early. Posted by
  // serviceWorker.ts#applyUpdate() from a user click on the update pill.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ---------------------------------------------------------------------
 * Fetch
 * ------------------------------------------------------------------- */

/**
 * Requests the SW must not touch at all.  When this returns true we do NOT
 * call event.respondWith() — the request goes straight to the network /
 * HTTP cache exactly as if no service worker existed.  That is materially
 * different from "respondWith(fetch(event.request))", which would still
 * round-trip through the worker and can subtly break streaming, range
 * requests and credentialless-COEP fetches.
 */
function shouldSkip(req, url) {
  // Only GET is ever cacheable; POST/PUT/DELETE go straight through.
  if (req.method !== 'GET') return true;

  // Cross-origin: the API Worker (mgl-progress-api.*.workers.dev), Google
  // Fonts, developer.api.autodesk.com (APS viewer), R2 media, …  These carry
  // credentials / CORS semantics we must not second-guess, and caching an
  // authenticated API response would leak between users on a shared PC.
  if (url.origin !== self.location.origin) return true;

  // Anything carrying a `t=` query param is a short-lived print/report JWT
  // (see printAuth.ts + the Browser Rendering PDF pipeline). Caching such a
  // response would persist a bearer token to disk on a shared office PC.
  if (url.search.includes('t=')) return true;

  // Private / large / one-shot payloads — never worth a cache entry.
  if (/^\/(media|reports|meetings)\//.test(url.pathname)) return true;
  if (/^\/quotes\/[^/]+\/print/.test(url.pathname)) return true;

  // Never intercept our own script (the update check must reach the network)
  // nor Vite's dev-server endpoints.
  if (url.pathname === '/sw.js') return true;
  if (url.pathname.startsWith('/@vite/')) return true;

  return false;
}

/** FIFO-trim a cache to `max` entries (oldest keys first). */
async function trimCache(cacheName, max) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= max) return;
    // cache.keys() returns insertion order → the head is the oldest.
    await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
  } catch {
    /* trimming is best-effort */
  }
}

/**
 * Navigations → network-first.
 * We always want the freshest index.html (it names the current build's entry
 * chunk).  On success we refresh the cached copy; offline we serve the last
 * good index.html so the SPA can boot and show its own cached data, and only
 * fall back to the static offline page if we have never cached one.
 */
async function handleNavigate(event) {
  try {
    const res = await fetch(event.request);
    if (res && res.ok) {
      const copy = res.clone();
      event.waitUntil(
        caches
          .open(SHELL)
          .then((c) => c.put('/index.html', copy))
          .catch(() => undefined),
      );
    }
    return res;
  } catch {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_KEY);
    if (offline) return offline;
    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/**
 * Hashed build assets → cache-first.
 * /assets/<Name>-<hash>.js is content-addressed, so a hit is always correct
 * and never stale.  This is also the mechanism that keeps a mid-session tab
 * alive across a deploy (see the skipWaiting comment above).
 */
async function handleAsset(event) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const res = await fetch(event.request);
  if (res && res.ok) {
    const copy = res.clone();
    event.waitUntil(
      caches
        .open(ASSETS)
        .then((c) => c.put(event.request, copy))
        .then(() => trimCache(ASSETS, ASSET_CACHE_LIMIT))
        .catch(() => undefined),
    );
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (shouldSkip(req, url)) return;

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(event));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(handleAsset(event));
    return;
  }

  // Everything else same-origin (favicon.svg, /icons/*, landing media, …):
  // fall through without respondWith. The HTTP cache already handles these
  // well and, under COEP: credentialless, letting the browser do the fetch
  // preserves the correct credential-stripping semantics that a SW-mediated
  // `fetch()` can quietly change.
});

/* ---------------------------------------------------------------------
 * Push
 * ------------------------------------------------------------------- */

self.addEventListener('push', (event) => {
  /* Every code path below MUST end in showNotification().
   *
   * We subscribe with `userVisibleOnly: true`, which is a promise to the
   * browser that each push produces a visible notification.  If a push is
   * handled silently, Chrome shows its own generic "This site has been
   * updated in the background" notification instead, and repeated offences
   * cause the browser to REVOKE the push permission for the origin.  So a
   * malformed / empty payload still gets a generic 'MGL' notification —
   * an ugly notification beats a revoked subscription.
   */
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON payload — try plain text, else nothing.
    try {
      const text = event.data ? event.data.text() : '';
      d = text ? { title: '%VITE_ORG_NAME_SHORT%', body: text } : {};
    } catch {
      d = {};
    }
  }
  if (!d || typeof d !== 'object') d = {};

  const title = d.title || '%VITE_ORG_NAME_SHORT%';
  const tag = d.tag || 'mgl-' + (d.type || 'generic');
  const link = d.link || '/app/notifications';

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: d.body || '',
        tag,
        // We always compute a tag, so a repeat on the same tag should
        // re-alert rather than silently swap the existing notification.
        renotify: !!tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        data: { link },
      });

      // App-icon badge count (Android / installed PWA / macOS dock).
      if (typeof d.unread === 'number') {
        try {
          if (d.unread > 0) {
            await self.navigator.setAppBadge(d.unread);
          } else {
            await self.navigator.clearAppBadge();
          }
        } catch {
          /* Badging API unsupported — ignore */
        }
      }

      // Let any open tab react live (bump the bell, invalidate queries)
      // without waiting for its own poll.
      try {
        const clientList = await self.clients.matchAll({ type: 'window' });
        for (const client of clientList) {
          client.postMessage({ type: 'mgl:push', payload: d });
        }
      } catch {
        /* ignore */
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/app/notifications';

  event.waitUntil(
    (async () => {
      // `includeUncontrolled: true` matters: a tab that was loaded BEFORE
      // this worker took control is not "controlled" by it, and without the
      // flag it is invisible here — we'd open a duplicate window next to a
      // perfectly good open app.
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        let sameOrigin = false;
        try {
          sameOrigin = new URL(client.url).origin === self.location.origin;
        } catch {
          sameOrigin = false;
        }
        if (!sameOrigin) continue;

        if ('focus' in client) await client.focus();
        // postMessage, NOT client.navigate(): navigate() is a full document
        // load that throws away the React tree and the whole TanStack Query
        // cache. The app listens for 'mgl:navigate' and does a soft router
        // transition instead.
        client.postMessage({ type: 'mgl:navigate', link });
        return;
      }

      if (self.clients.openWindow) await self.clients.openWindow(link);
    })(),
  );
});
