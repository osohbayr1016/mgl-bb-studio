import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, Download, Share, SquarePlus, X } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/ui/sheet';
import { useInstallPrompt } from '@/shared/hooks/useInstallPrompt';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

const DISMISS_KEY = 'pwa_install_dismissed';
const DISMISS_DAYS = 30;

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Date.parse(raw);
    if (Number.isNaN(at)) return false;
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(DISMISS_KEY, new Date().toISOString());
  } catch {
    /* storage may be blocked */
  }
}

/** Public / print surfaces where an install nag would be wrong or harmful. */
function isSuppressedPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/login') return true;
  if (/^\/(reports|meetings)\//.test(pathname)) return true;
  if (/\/print\/?$/.test(pathname)) return true;
  return false;
}

/**
 * "Нүүр дэлгэцэнд нэмэх" banner — mobile only, above the bottom nav.
 *
 * Mount ONCE inside the authenticated app shell. Renders null unless the
 * device can actually install, the user is signed in, and they haven't
 * dismissed it within the last 30 days.
 */
export function InstallPrompt({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { state, prompt } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(isDismissed);
  const [sheetOpen, setSheetOpen] = useState(false);

  const dismiss = useCallback(() => {
    rememberDismissal();
    setDismissed(true);
  }, []);

  const handleAction = useCallback(() => {
    if (state === 'ios-manual') {
      // iOS gives us no programmatic hook — all we can do is teach the
      // Share-sheet sequence.
      setSheetOpen(true);
      return;
    }
    void prompt().then((outcome) => {
      // A dismissal of the NATIVE sheet also snoozes our banner: Chrome
      // won't re-fire beforeinstallprompt for a while and re-showing the
      // banner immediately just nags.
      if (outcome !== 'accepted') dismiss();
    });
  }, [state, prompt, dismiss]);

  if (dismissed) return null;
  if (state === 'installed' || state === 'unavailable') return null;
  if (!user) return null;
  if (isSuppressedPath(pathname)) return null;

  return (
    <>
      <div
        className={cn(
          'fixed inset-x-3 z-40 lg:hidden',
          'bottom-[calc(var(--app-bottom-nav-h,3.5rem)+env(safe-area-inset-bottom)+0.5rem)]',
          className,
        )}
        role="region"
        aria-label={t('pwa.installTitle')}
        // Баруун доод булангийн тэмдэглэл (DailyLogNote) энэ баннерын дээгүүр гарна.
        data-install-prompt=""
      >
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/95 px-3 py-2.5 shadow-2xl shadow-black/40 backdrop-blur-md">
          <img
            src="/icons/icon-192.png"
            alt=""
            aria-hidden="true"
            className="h-9 w-9 shrink-0 rounded-lg"
          />
          <p className="min-w-0 flex-1 text-xs leading-snug font-medium text-foreground">
            {t('pwa.installTitle')}
          </p>
          <button
            type="button"
            onClick={handleAction}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:active:scale-[0.97]"
          >
            {state === 'ios-manual' ? (
              <Share className="h-3.5 w-3.5" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {t('pwa.installAction')}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('pwa.installDismiss')}
            className="-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>{t('pwa.iosSheetTitle')}</SheetTitle>
          </SheetHeader>

          <ol className="flex flex-col gap-3 px-4">
            <IosStep index={1} icon={<Share className="h-4 w-4" />} text={t('pwa.iosStep1')} />
            <IosStep
              index={2}
              icon={<SquarePlus className="h-4 w-4" />}
              text={t('pwa.iosStep2')}
            />
            <IosStep index={3} icon={<Check className="h-4 w-4" />} text={t('pwa.iosStep3')} />
          </ol>

          {/* Doubles as the Sheet's aria description. Not filler: iOS only
              delivers Web Push to home-screen-installed web apps, so without
              this step the user's notification toggle can never work. */}
          <SheetDescription className="px-4 pb-6 text-xs leading-relaxed">
            {t('pwa.iosWhy')}
          </SheetDescription>
        </SheetContent>
      </Sheet>
    </>
  );
}

function IosStep({
  index,
  icon,
  text,
}: {
  index: number;
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-micro font-bold text-primary">
        {index}
      </span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug text-foreground">{text}</span>
    </li>
  );
}

export default InstallPrompt;
