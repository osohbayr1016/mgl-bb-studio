/**
 * Shared primitives for landing-page block renderers — hooks for scroll
 * effects, layout helpers, and a per-block error boundary so a malformed
 * block can't blank the whole preview pane.
 *
 * Kept here (not in a generic ui/ folder) because every helper is tied to
 * the editorial look of the marketing site and would only be load weight
 * elsewhere.
 */

import { Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from 'react';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';

/* ------------------------------------------------------------------ */
/*  Media URL                                                          */
/* ------------------------------------------------------------------ */

/** Turn a CMS-stored image reference into a URL the browser can load:
 *  - absolute URL → returned as-is
 *  - /media/<key> → prefixed with the configured media host
 *  - everything else → returned untouched (useful for /landing/*.jpg static
 *    fallbacks bundled into the public/ directory)
 */
export function mediaUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/media/')) return `${MEDIA_BASE_URL}${value}`;
  return value;
}

/* ------------------------------------------------------------------ */
/*  Scroll-driven hooks                                                */
/* ------------------------------------------------------------------ */

/** Reveal an element once it enters the viewport — adds a class via the
 *  returned `visible` flag. One-shot: stops observing after first hit. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, visible };
}

/** Document scroll progress as a 0…1 value — drives the hairline progress
 *  bar in the top nav. rAF-throttled. */
export function useScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      setProgress(p);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', compute);
    compute();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', compute);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return progress;
}

/** Scale an image based on its viewport position — gives portfolio cards
 *  the same gentle dolly-in motion porsche.com uses. Returns a ref + scale
 *  value to set as transform. */
export function useScrollScale<T extends HTMLElement>(opts: { min?: number; max?: number } = {}) {
  const min = opts.min ?? 0.94;
  const max = opts.max ?? 1.06;
  const ref = useRef<T | null>(null);
  const [scale, setScale] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const centre = rect.top + rect.height / 2;
      const t = 1 - centre / vh;
      const clamped = Math.min(1, Math.max(0, t));
      setScale(min + (max - min) * clamped);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', compute);
    compute();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', compute);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [min, max]);
  return { ref, scale };
}

/** Hero-specific scale: starts at 1, grows toward `maxScale` across one
 *  viewport of scroll. The "camera is pushing in" feel. */
export function useHeroScale(maxScale = 1.18) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      const vh = window.innerHeight || 1;
      const t = Math.min(1, Math.max(0, window.scrollY / vh));
      setScale(1 + (maxScale - 1) * t);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    compute();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [maxScale]);
  return scale;
}

/* ------------------------------------------------------------------ */
/*  Editorial primitives                                               */
/* ------------------------------------------------------------------ */

/** Section header marker — "01  SELECTED PROJECTS" with a hairline that
 *  extends across the remaining grid column. */
export function SectionMarker({
  number,
  label,
  tone = 'light',
}: {
  number: string;
  label: string;
  tone?: 'light' | 'dark';
}) {
  const text = tone === 'dark' ? 'text-white/65' : 'text-brand-blue/60';
  const rule = tone === 'dark' ? 'bg-white/15' : 'bg-brand-stone/60';
  return (
    <div
      className={cn(
        'flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.28em]',
        text,
      )}
    >
      <span className="font-semibold tabular-nums">{number}</span>
      <span>{label}</span>
      <span className={cn('h-px flex-1', rule)} aria-hidden />
    </div>
  );
}

/** Large display headline — Porsche-style: Manrope display face, tight
 *  tracking, near-leading-collapse so two lines feel like one block. */
export function DisplayHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        'mt-6 font-grotesk font-bold tracking-[-0.04em] leading-[0.93]',
        'text-[2.75rem] sm:text-6xl lg:text-[5.5rem] xl:text-[7rem]',
        className,
      )}
    >
      {children}
    </h2>
  );
}

/* ------------------------------------------------------------------ */
/*  Brand glyphs (lucide removed these for trademark reasons in 2024)  */
/* ------------------------------------------------------------------ */

export const FacebookGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.99 3.66 9.13 8.44 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.77l-.44 2.89h-2.33v6.99C18.34 21.13 22 16.99 22 12z" />
  </svg>
);

export const LinkedinGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.65-1.85 3.39-1.85 3.63 0 4.3 2.39 4.3 5.5v6.24zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.72V1.72C24 .77 23.21 0 22.23 0z" />
  </svg>
);

export const InstagramGlyph = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Per-block error boundary                                           */
/* ------------------------------------------------------------------ */

interface BlockErrorBoundaryProps {
  /** Block type — shown in the fallback for debugging the editor. */
  blockType: string;
  /** When 'preview', render a verbose error card. When 'live', stay silent —
   *  the public visitor shouldn't see a placeholder for a broken block. */
  mode?: 'live' | 'preview';
  children: ReactNode;
}

interface BlockErrorBoundaryState {
  error: Error | null;
}

/** Per-block error boundary. A malformed block doesn't blank the page —
 *  in preview, it shows an inline error card so the admin can fix it;
 *  in live mode, it renders nothing so visitors never see the failure. */
export class BlockErrorBoundary extends Component<
  BlockErrorBoundaryProps,
  BlockErrorBoundaryState
> {
  constructor(props: BlockErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): BlockErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console; in preview the admin sees the inline card anyway.
    console.error(`[landing-block:${this.props.blockType}]`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      if ((this.props.mode ?? 'live') === 'live') {
        return null;
      }
      return (
        <div className="mx-auto my-6 max-w-3xl rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <div className="font-semibold">Энэ блокийг үзүүлэхэд алдаа гарлаа.</div>
          <div className="mt-1 font-mono text-xs">
            {this.props.blockType}: {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
