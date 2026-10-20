import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch } from '@/shared/api/client';
import {
  getVapidPublicKey,
  isIosSafari,
  isStandalone,
  pushSupported,
  urlBase64ToUint8Array,
} from '@/shared/lib/push';

export type PushState =
  | 'unsupported'
  | 'ios-needs-install'
  | 'denied'
  | 'default'
  | 'subscribed';

const ENDPOINT_KEY = 'push_endpoint';

interface PushKeys {
  p256dh: string;
  auth: string;
}

/** ArrayBuffer → base64url, the wire format the backend/web-push expects. */
function bufferToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function extractKeys(sub: PushSubscription): PushKeys {
  return {
    p256dh: bufferToBase64Url(sub.getKey('p256dh')),
    auth: bufferToBase64Url(sub.getKey('auth')),
  };
}

function readStoredEndpoint(): string | null {
  try {
    return localStorage.getItem(ENDPOINT_KEY);
  } catch {
    return null;
  }
}

function writeStoredEndpoint(endpoint: string | null): void {
  try {
    if (endpoint) localStorage.setItem(ENDPOINT_KEY, endpoint);
    else localStorage.removeItem(ENDPOINT_KEY);
  } catch {
    /* storage may be blocked */
  }
}

async function postSubscription(sub: PushSubscription): Promise<void> {
  await apiFetch('/push/subscribe', {
    method: 'POST',
    data: { endpoint: sub.endpoint, keys: extractKeys(sub) },
  });
  writeStoredEndpoint(sub.endpoint);
}

/**
 * Web Push subscription lifecycle.
 *
 * Returned `state`:
 *   'unsupported'       — no SW / PushManager / Notification in this browser
 *   'ios-needs-install' — iOS delivers Web Push ONLY to home-screen-installed
 *                         web apps; in a Safari tab the API exists but
 *                         subscribing is pointless, so we surface the real
 *                         blocker instead of a permission prompt that can't help
 *   'denied'            — permission denied (only the user can undo this, in
 *                         browser settings; re-prompting is a no-op)
 *   'default'           — supported, not yet subscribed
 *   'subscribed'        — active subscription registered with the server
 */
export function usePushSubscription() {
  const [state, setState] = useState<PushState>('unsupported');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards a setState after unmount from the async reconcile/subscribe paths.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!pushSupported()) {
      // On iOS the APIs are present in the browser tab but push never
      // arrives — report the actionable state, not 'unsupported'.
      if (isIosSafari() && !isStandalone()) {
        if (alive.current) setState('ios-needs-install');
        return;
      }
      if (alive.current) setState('unsupported');
      return;
    }
    if (isIosSafari() && !isStandalone()) {
      if (alive.current) setState('ios-needs-install');
      return;
    }
    if (Notification.permission === 'denied') {
      if (alive.current) setState('denied');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!alive.current) return;
      setState(sub && Notification.permission === 'granted' ? 'subscribed' : 'default');
    } catch {
      if (alive.current) setState('default');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const subscribe = useCallback(async () => {
    setError(null);
    if (!pushSupported()) {
      setState(isIosSafari() && !isStandalone() ? 'ios-needs-install' : 'unsupported');
      return false;
    }
    if (isIosSafari() && !isStandalone()) {
      setState('ios-needs-install');
      return false;
    }

    /* ------------------------------------------------------------------
     * ORDER IS LOAD-BEARING: requestPermission() FIRST, synchronously in
     * the same task as the click.
     *
     * Safari (and, increasingly, Chrome) requires `Notification.request-
     * Permission()` to be called while the transient user activation is
     * still live. `await navigator.serviceWorker.ready` — which every
     * tutorial puts first — yields to the microtask/task queue and consumes
     * the activation, after which Safari rejects the request SILENTLY:
     * no prompt, no error, permission stays 'default' and the user thinks
     * the button is broken. So: permission, THEN the awaits.
     * ---------------------------------------------------------------- */
    let permission: NotificationPermission;
    try {
      permission = await Notification.requestPermission();
    } catch {
      setError('permission');
      return false;
    }
    if (permission !== 'granted') {
      setState(permission === 'denied' ? 'denied' : 'default');
      return false;
    }

    setBusy(true);
    try {
      const vapid = await getVapidPublicKey();
      if (!vapid) {
        setError('no-key');
        return false;
      }
      const reg = await navigator.serviceWorker.ready;

      // Reuse an existing subscription if there is one — calling subscribe()
      // twice with the same key returns the same subscription, but with a
      // DIFFERENT key it throws InvalidStateError.
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          // Mandatory: Chrome rejects `false` outright, and it's the promise
          // the SW's push handler keeps by always calling showNotification().
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid),
        }));

      await postSubscription(sub);
      if (alive.current) setState('subscribed');
      return true;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'subscribe-failed');
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub?.endpoint ?? readStoredEndpoint();
      if (sub) await sub.unsubscribe();
      if (endpoint) {
        // Best-effort: even if the server call fails, the local subscription
        // is already gone, so pushes stop either way (the server row just
        // lingers until its endpoint 410s).
        await apiFetch('/push/unsubscribe', {
          method: 'POST',
          data: { endpoint },
        }).catch(() => undefined);
      }
      writeStoredEndpoint(null);
      navigator.clearAppBadge?.();
      if (alive.current) setState('default');
      return true;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'unsubscribe-failed');
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  /**
   * Re-register a subscription whose endpoint has drifted from what we last
   * told the server.
   *
   * This is the practical substitute for the `pushsubscriptionchange` event:
   * that event fires INSIDE the service worker, where there is no auth token
   * and no way to get one, so it cannot re-POST to our authenticated
   * endpoint. Browsers also rotate endpoints silently (FCM re-registration,
   * Safari re-issue). Calling reconcile() on app start closes the gap.
   */
  const reconcile = useCallback(async () => {
    if (!pushSupported()) return;
    if (Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      if (sub.endpoint === readStoredEndpoint()) return;
      await postSubscription(sub);
      if (alive.current) setState('subscribed');
    } catch {
      /* silent — reconcile is a background repair, never user-facing */
    }
  }, []);

  return { state, busy, error, subscribe, unsubscribe, reconcile };
}
