import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Loader2, NotebookPen } from 'lucide-react';
import { useAuth } from '@/shared/context/AuthContext';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { SPRING } from '@/shared/lib/motion';
import { useUbToday } from '@/features/reports/lib/useUbToday';
import { OPEN_DAILY_NOTE_EVENT } from './dailyNoteEvents';

/**
 * Менежментийн багийн (= `admin`, `DAILY_LOG_ROLES`) «Өнөөдөр юу хийв?» тэмдэглэл —
 * системийн БҮХ хуудасны баруун доод буланд (эзэн 2026-10-08).  Хийсэн ажлаа бичээд
 * Enter дарахад өнөөдрийн өдрийн тайланд дугаарлагдаж ар араасаа нэмэгдэнэ.
 *
 * Шинэ хадгалалт БАЙХГҮЙ — `MgmtQuickCapture` (`variant="note"`) нь ижил
 * `PUT /daily-work-logs/:date`-аар бичдэг тул түүх, засварын тоолуур, Профайл →
 * «Өдрийн тайлан» ба Тайлан → «Менежментийн багийн тайлан» бүгд шууд харна.
 * Товч л үргэлж ачаалагдана; цонх нь анх нээгдэхэд lazy chunk-аар ирнэ.
 * `is_support` бүртгэл (лобби TV) — менежментийн гишүүн биш тул харагдахгүй.
 */
const DailyLogNotePanel = lazy(() => import('./DailyLogNotePanel'));

const OPEN_KEY = 'mgl:daily-note:open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function DailyLogNote() {
  const { user } = useAuth();
  const eligible = !!user && user.role === 'admin' && !user.is_support;
  if (!eligible) return null;
  return <DailyLogNoteInner />;
}

function DailyLogNoteInner() {
  const { t } = useLanguage();
  const [today, syncToday] = useUbToday();
  const [open, setOpenState] = useState(readOpen);
  // Товчны тоо — цонхтой ИЖИЛ query key тул нэмэгдэх бүрд шууд шинэчлэгдэнэ.
  const day = useApiQuery<{ log: { items: string[] } | null }>(
    ['/daily-work-logs', 'day', today],
    `/daily-work-logs/${today}`,
    { retry: false, staleTime: 60_000 },
  );
  const count = day.data?.log?.items.length ?? 0;

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? '1' : '0');
    } catch {
      /* хувийн цонх — сонголт санагдахгүй, ажиллана */
    }
  }, []);

  // Бусад хуудаснаас «нээх» дохио (жишээ нь Менежментийн тайлангийн «Миний ажил нэмэх»).
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_DAILY_NOTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_DAILY_NOTE_EVENT, onOpen);
  }, [setOpen]);

  // Alt+N — хаанаас ч нээх/хаах.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  return (
    <div
      className={cn(
        'pointer-events-none fixed right-3 z-40 flex flex-col items-end gap-3 print:hidden sm:right-5',
        // Утсан дээр доод навигацийн дээгүүр (UpdatePrompt-тэй ижил тооцоо).
        'bottom-[calc(var(--app-bottom-nav-h,3.5rem)+env(safe-area-inset-bottom)+0.75rem)] lg:bottom-5',
        // «Апп суулгах» баннер (зөвхөн утсан дээр) харагдаж байвал түүний дээгүүр.
        'max-lg:[body:has([data-install-prompt])_&]:bottom-[calc(var(--app-bottom-nav-h,3.5rem)+env(safe-area-inset-bottom)+5rem)]',
      )}
    >
      <AnimatePresence>
        {open && (
          <m.section
            key="panel"
            role="dialog"
            aria-label={t('dailyLog.noteTitle')}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: SPRING.smooth }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
            style={{ transformOrigin: 'bottom right' }}
            onKeyDown={(e) => {
              // Мөр засаж байхад Esc нь засварыг л цуцална (тэр handler preventDefault хийдэг).
              if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false);
            }}
            className="pointer-events-auto w-[min(24rem,calc(100vw-1.5rem))] overflow-clip rounded-2xl border border-border/70 bg-card text-card-foreground shadow-2xl shadow-black/25"
          >
            <Suspense
              fallback={
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <DailyLogNotePanel
                today={today}
                syncToday={syncToday}
                onClose={() => setOpen(false)}
              />
            </Suspense>
          </m.section>
        )}
      </AnimatePresence>

      <m.button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={t('dailyLog.noteOpen')}
        title={`${t('dailyLog.noteOpen')} (Alt+N)`}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        transition={SPRING.snappy}
        className={cn(
          'pointer-events-auto relative grid size-12 place-items-center rounded-full shadow-lg shadow-black/25 transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          open
            ? 'bg-card text-foreground ring-1 ring-border'
            : 'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
      >
        <NotebookPen className="h-5 w-5" aria-hidden />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-success px-1 text-micro font-semibold leading-5 text-success-foreground tabular-nums ring-2 ring-background">
            {count}
          </span>
        )}
      </m.button>
    </div>
  );
}
