/// <reference types="vite/client" />

declare module '*.css';

/**
 * `beforeinstallprompt` is a Chromium-only, non-standard event and is NOT in
 * TypeScript's DOM lib. Without this declaration the install flow can only be
 * written with `any` casts, which `noUnusedLocals` + `strict` make miserable.
 *
 * Note the two-step contract: calling `prompt()` shows the native install
 * sheet, and `userChoice` resolves once the user answers. The event may only
 * be prompted ONCE — after that the browser discards it and a new
 * `beforeinstallprompt` must be awaited.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
  appinstalled: Event;
}
