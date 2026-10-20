import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Minimal focus trap for hand-rolled overlays that can't use a Radix
 * Dialog/Sheet (e.g. the fullscreen charts dialog, which must stay inside the
 * Fullscreen API subtree and therefore can't portal to document.body).
 *
 * While `active`:
 *  - moves focus into the container on open and restores it to the previously
 *    focused element on close,
 *  - keeps Tab / Shift+Tab cycling within the container,
 *  - calls `onEscape` on the Escape key.
 *
 * Attach the returned ref to the overlay panel and give that panel
 * `tabIndex={-1}` so it can receive focus when it has no focusable children.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T>(null);
  const escRef = useRef(onEscape);
  // Sync the latest callback in an effect (never during render) so the trap
  // effect below doesn't need to re-run — and re-trap focus — when the parent
  // passes a new inline onEscape each render.
  useEffect(() => {
    escRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    const first = focusables()[0];
    (first ?? node).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        escRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === firstEl || !node.contains(activeEl)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (activeEl === lastEl || !node.contains(activeEl)) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
