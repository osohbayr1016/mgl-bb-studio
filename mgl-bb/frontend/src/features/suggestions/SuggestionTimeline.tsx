/**
 * Санал хүсэлтийн явцын прогресс шугам (3 алхамт horizontal stepper):
 *   Хүлээж авсан → Хэлэлцэж байна → Шийдвэрлэгдсэн.
 *
 * «Шийдвэрлэгдсэн» алхам нь ҮР ДҮНГЭЭС ҮЛ ХАМААРАН үргэлж ногоон ✓ — энэ нь
 * «бид шийдвэр гаргасан» гэсэн явцын үнэн, харин зөвшөөрсөн/татгалзсан гэдэг
 * ҮР ДҮН нь картын гарчгийн дэргэдэх badge дээр л харагдана (эзний шийдвэр,
 * 2026-09-11: татгалзсан саналын явц улаан X-ээр дуусах нь буруу).
 *
 * Өнгийг shared/lib/status-colors-ийн semantic token (primary / success /
 * danger / muted) дээр тулгуурлана — light/dark-д дасан зохицно.  Tailwind
 * JIT-д баригдахын тулд бүх класс БҮТЭН литерал хэлбэрээр бичигдсэн.
 */
import { Fragment } from 'react';
import { Inbox, MessagesSquare, Check, Flag } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { SuggestionStatus } from '@/shared/types';

const ORDER: SuggestionStatus[] = ['received', 'discussing', 'resolved'];

export function SuggestionTimeline({
  status,
  className,
}: {
  status: SuggestionStatus;
  className?: string;
}) {
  const { t } = useLanguage();
  const currentIndex = ORDER.indexOf(status);
  const isResolved = status === 'resolved';

  // Шийдвэрлэгдсэн төлөвийн өнгө — үр дүнгээс үл хамааран success.
  const resolvedNodeClass = 'bg-success text-success-foreground border-success';
  const resolvedLineClass = 'bg-success';
  const activeNodeClass = 'bg-primary text-primary-foreground border-primary';
  const idleNodeClass = 'bg-muted text-muted-foreground border-border';

  const steps = [
    { key: 'received', icon: Inbox, label: t('suggestionsPage.stepReceived') },
    { key: 'discussing', icon: MessagesSquare, label: t('suggestionsPage.stepDiscussing') },
    {
      key: 'resolved',
      icon: isResolved ? Check : Flag,
      label: t('suggestionsPage.stepResolved'),
    },
  ];
  const lastIndex = steps.length - 1;

  return (
    <div className={cn('flex w-full', className)}>
      {steps.map((step, i) => {
        const Icon = step.icon;
        const last = i === lastIndex;
        const reached = i <= currentIndex;

        const nodeClass = !reached
          ? idleNodeClass
          : last && isResolved
            ? resolvedNodeClass
            : activeNodeClass;

        // Зүүн талын холбоос (i-1 → i): node i хүрсэн бол идэвхтэй.
        const leftActive = i > 0 && i <= currentIndex;
        const leftClass = !leftActive
          ? 'bg-border'
          : last && isResolved
            ? resolvedLineClass
            : 'bg-primary';
        // Баруун талын холбоос (i → i+1): node i+1 хүрсэн бол идэвхтэй.
        const rightActive = !last && i < currentIndex;
        const rightClass = !rightActive
          ? 'bg-border'
          : i + 1 === lastIndex && isResolved
            ? resolvedLineClass
            : 'bg-primary';

        return (
          <Fragment key={step.key}>
            <div className="relative flex flex-1 flex-col items-center">
              {/* холбоос шугамууд — node-ийн төв (top:1rem) дээр зурагдана */}
              {i > 0 && (
                <span
                  className={cn('absolute top-4 left-0 right-1/2 h-0.5 -translate-y-1/2', leftClass)}
                />
              )}
              {!last && (
                <span
                  className={cn('absolute top-4 left-1/2 right-0 h-0.5 -translate-y-1/2', rightClass)}
                />
              )}
              <div
                className={cn(
                  'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border',
                  nodeClass,
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span
                className={cn(
                  'mt-1.5 max-w-[5.5rem] text-center text-micro leading-tight',
                  reached ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
