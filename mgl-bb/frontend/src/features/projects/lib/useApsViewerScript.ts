import { useEffect, useRef, useState } from 'react';

/* Loads the Autodesk APS Viewer SDK (CSS + JS) from Autodesk's CDN exactly once
 * per page. Idempotent across React StrictMode double-mounts and multiple
 * ApsViewer instances. A CDN block surfaces as a rejected promise (catchable)
 * instead of a silently blank canvas. The injected tags are left in place for
 * the page's lifetime — removing them on unmount would break other instances
 * and force a re-download on every tab open. */

// Pin to the latest 7.x patch, matching Autodesk's own documented examples.
const VIEWER_VERSION = '7.*';
const BASE = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${VIEWER_VERSION}`;
const CSS_URL = `${BASE}/style.min.css`;
const JS_URL = `${BASE}/viewer3D.min.js`;

let scriptPromise: Promise<void> | null = null;

function apsReady(): boolean {
  return typeof window !== 'undefined' && !!window.Autodesk?.Viewing;
}

function loadApsScript(): Promise<void> {
  if (apsReady()) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (!document.getElementById('aps-viewer-css')) {
      const link = document.createElement('link');
      link.id = 'aps-viewer-css';
      link.rel = 'stylesheet';
      link.href = CSS_URL;
      document.head.appendChild(link);
    }

    const existing = document.getElementById('aps-viewer-js') as HTMLScriptElement | null;
    if (existing) {
      if (apsReady()) {
        resolve();
      } else {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('APS viewer script failed to load')));
      }
      return;
    }

    const script = document.createElement('script');
    script.id = 'aps-viewer-js';
    script.src = JS_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Allow a later retry (e.g. after a transient network failure).
      scriptPromise = null;
      reject(new Error('APS viewer script failed to load'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export function useApsViewerScript(): { ready: boolean; error: Error | null } {
  const [ready, setReady] = useState<boolean>(apsReady);
  const [error, setError] = useState<Error | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    loadApsScript()
      .then(() => {
        if (mounted.current) setReady(true);
      })
      .catch((e) => {
        if (mounted.current) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  return { ready, error };
}
