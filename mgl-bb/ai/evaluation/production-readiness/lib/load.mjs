/**
 * MGL AI · PRODUCTION-READINESS — ачаалагч (Session C).
 *
 * Backend (`backend/src/lib/mglai/*.ts`) ба frontend (`frontend/src/features/mgl-ai/lib/*.ts`)
 * цэвэр модулиудыг `node:test`-ээс шууд ачаална.  Репод frontend тест байхгүй тул
 * `check-*.mjs` скриптүүдийн адил `registerHooks` резолвер:
 *   · өргөтгөлгүй харьцангуй импорт → `.ts`
 *   · `@/…` → `frontend/src/…`
 *   · `import.meta.env` → `globalThis.__VITE_ENV__ ?? {}` (Vite-гүй орчинд)
 *
 * ⚠️ ХӨТЧИЙН ГЛОБАЛ (localStorage, window) энд STUB — зөвхөн тестэд.
 */
import { registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..', '..');
export const BACKEND_LIB = join(REPO, 'backend', 'src', 'lib', 'mglai');
export const FRONTEND_SRC = join(REPO, 'frontend', 'src');
export const FRONTEND_AI = join(FRONTEND_SRC, 'features', 'mgl-ai', 'lib');
export const AI_DIR = join(REPO, 'ai');

let installed = false;
export function installHooks() {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) {
        const abs = join(FRONTEND_SRC, specifier.slice(2));
        const withTs = existsSync(`${abs}.ts`) ? `${abs}.ts` : existsSync(`${abs}.tsx`) ? `${abs}.tsx` : abs;
        return nextResolve(pathToFileURL(withTs).href, context);
      }
      if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
        const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : HERE;
        const asFile = join(base, `${specifier}.ts`);
        if (existsSync(asFile)) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(`${specifier}/index.ts`, context);
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith('file:') && /\.tsx?$/.test(url) && url.includes('/frontend/')) {
        const src = readFileSync(fileURLToPath(url), 'utf8');
        if (src.includes('import.meta.env')) {
          return {
            format: 'module-typescript',
            shortCircuit: true,
            source: src.replace(/import\.meta\.env/g, '(globalThis.__VITE_ENV__ ?? {})'),
          };
        }
      }
      return nextLoad(url, context);
    },
  });
}

/** Хөтчийн глобалуудыг stub-лана — frontend lib-үүд `localStorage`/`window` уншдаг. */
export function installBrowserStubs(opts = {}) {
  const store = new Map(Object.entries(opts.localStorage ?? {}));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  globalThis.window = globalThis.window ?? {
    location: { hostname: opts.hostname ?? '127.0.0.1', origin: `http://${opts.hostname ?? '127.0.0.1'}:5173`, href: '' },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  globalThis.__VITE_ENV__ = { VITE_API_HOST: opts.apiHost ?? 'http://127.0.0.1:3000' };
  if (typeof globalThis.performance === 'undefined') globalThis.performance = { now: () => Date.now() };
  return store;
}

export async function loadBackend(rel) {
  installHooks();
  return import(pathToFileURL(join(BACKEND_LIB, rel)).href);
}

export async function loadFrontend(rel) {
  installHooks();
  return import(pathToFileURL(join(FRONTEND_AI, rel)).href);
}

export async function loadRepo(rel) {
  installHooks();
  return import(pathToFileURL(join(REPO, rel)).href);
}
