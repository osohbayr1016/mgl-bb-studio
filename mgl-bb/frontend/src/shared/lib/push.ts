/**
 * Web Push helpers — capability detection, platform quirks, and VAPID key
 * resolution. The stateful subscribe/unsubscribe flow lives in
 * `shared/hooks/usePushSubscription.ts`.
 */

import { apiFetch } from '@/shared/api/client';

/** Everything Web Push needs. All three are required — Safari <16.4 has
 *  Notification but no PushManager, some embedded webviews have neither. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Is the app running as an installed PWA rather than in a browser tab?
 * `display-mode: standalone` covers Android/desktop Chrome and iOS 16.4+;
 * the legacy `navigator.standalone` boolean is the only signal older iOS
 * home-screen web apps expose.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // Non-standard, iOS only — not in TS's Navigator type.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * iOS/iPadOS Safari (or any iOS browser — they're all WebKit).
 *
 * The UA test alone is not enough: since iPadOS 13, iPad defaults to
 * "Request Desktop Website", which reports a *macOS* UA
 * (`Macintosh; Intel Mac OS X`). The reliable tell is `platform ===
 * 'MacIntel'` combined with a touch-capable screen — real Macs report
 * `maxTouchPoints === 0`.
 */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iP(hone|ad|od)/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * VAPID public keys are base64url; `PushManager.subscribe` wants the raw
 * 65-byte P-256 point as a Uint8Array.
 *
 * The explicit `Uint8Array<ArrayBuffer>` return type is required: since TS
 * 5.7 the typed arrays are generic over their buffer, and the bare
 * `Uint8Array` alias widens to `ArrayBufferLike` (i.e. possibly a
 * SharedArrayBuffer), which `PushSubscriptionOptionsInit.applicationServerKey`
 * — typed as `BufferSource` — refuses.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

let cachedKey: string | null = null;

/**
 * The server's VAPID public key.
 *
 * Build-time `VITE_VAPID_PUBLIC_KEY` is the fast path. The runtime
 * `GET /push/public-key` fallback exists so rotating the VAPID pair on the
 * Worker doesn't require rebuilding and redeploying the frontend — without
 * it, every client would keep subscribing against the dead key until the
 * next Pages deploy, and every push would 403.
 */
export async function getVapidPublicKey(): Promise<string | null> {
  if (cachedKey) return cachedKey;

  const fromEnv = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim();
  if (fromEnv) {
    cachedKey = fromEnv;
    return cachedKey;
  }

  try {
    // ⚠️ Сервер нь `public_key` (snake_case) гэж буцаадаг —
    //    `backend/src/routes/push.ts:72`.  Урьд нь энд зөвхөн `publicKey` ба
    //    `key` гэсэн хоёр бичиглэлийг уншдаг байсан тул fallback ХЭЗЭЭ Ч
    //    ажиллаагүй: түлхүүр олдохгүй → `null` → push чимээгүй унтарсан.
    //    `VITE_VAPID_PUBLIC_KEY` нь ямар ч env файлд тавигдаагүй байсан тул
    //    хурдан зам нь ч хоосон байв.  Гурвуулангийг нь уншиж, серверийн
    //    жинхэнэ гэрээг ЭХЭНД тавив.
    const res = await apiFetch<{ public_key?: string | null; publicKey?: string; key?: string }>(
      '/push/public-key',
    );
    const key = (res.public_key ?? res.publicKey ?? res.key ?? '').trim();
    if (key) {
      cachedKey = key;
      return cachedKey;
    }
  } catch {
    /* endpoint missing or unauthenticated — treat as unconfigured */
  }
  return null;
}
