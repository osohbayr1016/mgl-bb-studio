import { useNavigate } from 'react-router-dom';
import { useCallback, useRef } from 'react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { brand } from '@/shared/config/brand';

/* =============================================================
 * BrandLogo
 *
 * The white MGL mark, used in the sidebar header. Clicking it:
 *   - plays the JARVIS startup chirp (one-shot, non-blocking)
 *   - navigates to "/" so it works as a "home" affordance
 *
 * The audio element is kept around in a ref so we can rewind +
 * replay quickly without re-creating it (which would re-trigger
 * the network fetch for the mp3 every click).
 *
 * NOTE: browsers require a real user gesture to play audio with
 * sound. We only ever call .play() inside a click handler, so this
 * works without explicit user-grant prompts.
 * ============================================================= */

export function BrandLogo({
  className,
  size = 'md',
  navigateOnClick = true,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  navigateOnClick?: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio('/jarvis-startup.mp3');
      audioRef.current.preload = 'auto';
      audioRef.current.volume = 0.45;
    }
    try {
      audioRef.current.currentTime = 0;
      // play() returns a promise that rejects if the browser blocks it —
      // swallow because we don't want to break navigation if audio fails.
      void audioRef.current.play().catch(() => undefined);
    } catch {
      /* ignore — audio is best-effort */
    }
  }, []);

  const onClick = useCallback(() => {
    play();
    if (navigateOnClick) navigate('/');
  }, [navigate, navigateOnClick, play]);

  const dim = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-10 w-10' : 'h-8 w-8';

  return (
    <button
      type="button"
      onClick={onClick}
      title={t('brandLogo.homeTitle')}
      aria-label={t('brandLogo.homeAria')}
      className={cn(
        'flex items-center justify-center rounded-lg transition-transform',
        'hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        dim,
        className,
      )}
    >
      <img
        src="/logo-white.png"
        alt={brand().nameShort}
        className="h-full w-full object-contain select-none pointer-events-none"
        draggable={false}
      />
    </button>
  );
}
