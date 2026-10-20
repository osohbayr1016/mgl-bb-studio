import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollableBody,
  DialogTitle,
} from '@/ui/dialog';
import { weekdayOf } from '@/features/daily-log/lib';
import { cellKey } from '../../lib/mgmtCalendar';
import { highlightParts } from '../../lib/mgmtJournal';
import { MgmtAvatar } from './MgmtAvatar';

export interface CalPerson {
  user_id: number;
  name: string;
  position: string | null;
}

/**
 * Календарийн нүд дээр дарахад: тэр өдрийн бүтэн тайлан — нэг хүн (`userId`)
 * эсвэл тэр өдөр бичсэн бүх хүн, хүн бүр тусдаа хэсэгт.  ◀ ▶ нь тэр сонголтод
 * бичлэгтэй өмнөх/дараах өдөр рүү.
 */
export function MgmtDayDialog({
  open,
  date,
  userId,
  people,
  index,
  query,
  prevDate,
  nextDate,
  onNav,
  onMember,
  onPerson,
  onClose,
}: {
  open: boolean;
  date: string;
  userId: number | null;
  people: readonly CalPerson[];
  index: ReadonlyMap<string, readonly string[]>;
  query: string;
  prevDate: string | null;
  nextDate: string | null;
  onNav: (date: string) => void;
  onMember: (id: number) => void;
  /** Бүх хүний цонхонд нэр дээр дарвал тэр хүнээр шүүнэ. */
  onPerson: (id: number) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const shown = (userId != null ? people.filter((p) => p.user_id === userId) : people).filter((p) =>
    index.has(cellKey(p.user_id, date)),
  );
  const [, mo, d] = date.split('-');
  const single = userId != null ? people.find((p) => p.user_id === userId) : undefined;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-baseline gap-2">
            <span>{t('mgmtLogs.calDate', { m: Number(mo), d: Number(d) })}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {t(`dailyLog.weekday${weekdayOf(date)}`)}
            </span>
          </DialogTitle>
          <DialogDescription>
            {single ? single.name : t('mgmtLogs.calPeopleN', { count: shown.length })}
          </DialogDescription>
        </DialogHeader>

        <DialogScrollableBody className="space-y-5 px-5 py-4 sm:max-h-[60vh] sm:overflow-y-auto">
          {shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('mgmtLogs.calEmptyDay')}
            </p>
          ) : (
            shown.map((p) => {
              const items = index.get(cellKey(p.user_id, date)) ?? [];
              return (
                <section key={p.user_id} className="space-y-2">
                  {userId == null && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onPerson(p.user_id)}
                      className="-ml-2 h-auto justify-start gap-2.5 px-2 py-1 pointer-coarse:h-auto"
                      title={t('mgmtLogs.calOnlyThis')}
                    >
                      <MgmtAvatar userId={p.user_id} name={p.name} size="sm" />
                      <span className="text-sm font-semibold">{p.name}</span>
                      {p.position && (
                        <span className="truncate text-micro font-normal text-muted-foreground">
                          {p.position}
                        </span>
                      )}
                    </Button>
                  )}
                  <ol className="space-y-1.5 rounded-xl bg-muted/40 px-4 py-3">
                    {items.map((it, i) => (
                      <li key={i} className="flex gap-2.5 text-body leading-relaxed">
                        <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">
                          {i + 1}.
                        </span>
                        <span className="min-w-0 break-words">
                          {highlightParts(it, query).map((part, k) =>
                            part.hit ? (
                              <mark
                                key={k}
                                className="rounded-sm bg-warning/30 px-0.5 text-foreground"
                              >
                                {part.text}
                              </mark>
                            ) : (
                              <span key={k}>{part.text}</span>
                            ),
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })
          )}
        </DialogScrollableBody>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!prevDate}
            onClick={() => prevDate && onNav(prevDate)}
          >
            <ChevronLeft /> {t('mgmtLogs.calPrevDay')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!nextDate}
            onClick={() => nextDate && onNav(nextDate)}
          >
            {t('mgmtLogs.calNextDay')} <ChevronRight />
          </Button>
          {single && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => onMember(single.user_id)}
            >
              {t('mgmtLogs.jProfile')} <ArrowRight />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
