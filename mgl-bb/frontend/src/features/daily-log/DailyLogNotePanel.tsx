import { Link } from 'react-router-dom';
import { ChevronDown, NotebookPen } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { MgmtQuickCapture } from '@/features/reports/components/mgmt/MgmtQuickCapture';
import { weekdayOf } from './lib';

/** Баруун доод булангийн тэмдэглэлийн агуулга (lazy chunk) — `DailyLogNote.tsx`-ийг үз. */
export default function DailyLogNotePanel({
  today,
  syncToday,
  onClose,
}: {
  today: string;
  syncToday: () => string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      <header className="flex items-center gap-2.5 border-b border-border/60 bg-primary/5 px-4 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <NotebookPen className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{t('dailyLog.noteTitle')}</p>
          <p className="text-micro tabular-nums text-muted-foreground">
            {today.slice(5).replace('-', '.')} · {t(`dailyLog.weekday${weekdayOf(today)}`)}
          </p>
        </div>
        <Button
          asChild
          variant="ghost"
          size="xs"
          className="hidden text-muted-foreground sm:inline-flex"
          title={t('dailyLog.noteAllReports')}
        >
          <Link to="/app/reports?tab=mgmt" onClick={onClose}>
            {t('dailyLog.noteTeam')}
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={t('dailyLog.noteClose')}
          title={`${t('dailyLog.noteClose')} (Esc)`}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </header>
      <div className="px-4 pt-3 pb-4">
        <MgmtQuickCapture today={today} syncToday={syncToday} variant="note" />
      </div>
    </>
  );
}
