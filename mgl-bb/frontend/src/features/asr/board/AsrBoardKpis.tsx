import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CalendarCheck, Clock, HardHat, Users } from 'lucide-react';
import { AnimatedNumber } from '@/shared/components/motion';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import type { AsrBoardPerson, AsrBoardSummary } from '../lib/asrBoard';
import { relativeDay, weekdayShort } from './rangeText';

/**
 * Сонгосон хугацааны ТОВЧ ТОО — дөрвөн хавтан.  `KpiStrip`-ийн
 * (`DashboardPanel.tsx`) харагдац, гэхдээ утга нь тоо биш ч байж болно
 * («5 хоногийн өмнө»), тиймээс өөрийн хавтан.
 */
export function AsrBoardKpis({
  summary,
  prevSite,
  topPerson,
  today,
  onShowAwaiting,
}: {
  summary: AsrBoardSummary;
  /** Өмнөх ижил урттай хугацааны очилт — «Бүх хугацаа» үед `null`. */
  prevSite: number | null;
  topPerson: AsrBoardPerson | null;
  today: string;
  /** «Батлалт хүлээж буй» дарахад жагсаалтыг шүүнэ. */
  onShowAwaiting: () => void;
}) {
  const { t } = useLanguage();
  const awaiting = summary.byStatus.submitted;

  return (
    <section
      id="sec-asr-project-kpi"
      className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-border"
      data-testid="asr-board-kpis"
    >
      <div className="grid grid-cols-2 gap-px lg:grid-cols-4">
        <Tile
          icon={HardHat}
          label={t('asr.board.kpiSite')}
          value={<Num value={summary.site} />}
          testId="kpi-site"
          sub={
            <>
              {prevSite != null && <div>{t('asr.board.kpiPrev', { n: prevSite })}</div>}
              {summary.otherTotal > 0 && <div>{t('asr.board.kpiOther', { n: summary.otherTotal })}</div>}
            </>
          }
        />
        <Tile
          icon={Users}
          label={t('asr.board.kpiPeople')}
          value={
            <>
              <Num value={summary.people} />
              <span className="text-lg font-medium text-muted-foreground">
                {t('asr.board.kpiPeopleUnit')}
              </span>
            </>
          }
          testId="kpi-people"
          sub={
            summary.site > 0 ? (
              <>
                <div>{t('asr.board.kpiTeams', { n: summary.teams })}</div>
                {topPerson && topPerson.site > 0 && (
                  <div className="truncate">
                    {t('asr.board.kpiTop', {
                      name: formatDisplayName(topPerson.name),
                      n: topPerson.site,
                    })}
                  </div>
                )}
              </>
            ) : null
          }
        />
        <Tile
          icon={CalendarCheck}
          label={t('asr.board.kpiLast')}
          testId="kpi-last"
          value={
            summary.lastSite ? (
              <span className="text-2xl font-semibold leading-tight tracking-tight">
                {relativeDay(summary.lastSite, today, t)}
              </span>
            ) : (
              <span className="text-3xl font-semibold text-muted-foreground sm:text-4xl">—</span>
            )
          }
          sub={
            summary.lastSite ? (
              <span className="tabular-nums">
                {summary.lastSite} · {weekdayShort(summary.lastSite, t)}
              </span>
            ) : (
              t('asr.board.kpiNoVisit')
            )
          }
        />
        <Tile
          icon={Clock}
          label={t('asr.board.kpiAwaiting')}
          testId="kpi-awaiting"
          value={<Num value={awaiting} className={awaiting > 0 ? 'text-warning' : undefined} />}
          sub={t('asr.board.kpiAwaitingSub', {
            approved: summary.byStatus.approved,
            rejected: summary.byStatus.rejected,
            draft: summary.byStatus.draft,
          })}
          onClick={awaiting > 0 ? onShowAwaiting : undefined}
          title={awaiting > 0 ? t('asr.board.kpiAwaitingAction') : undefined}
        />
      </div>
    </section>
  );
}

function Num({ value, className }: { value: number; className?: string }) {
  return (
    <AnimatedNumber
      value={value}
      className={cn('text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl', className)}
    />
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  onClick,
  title,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
  title?: string;
  testId: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1 text-foreground" data-testid={`${testId}-value`}>
        {value}
      </div>
      {sub && <div className="mt-1 space-y-0.5 text-xs leading-snug text-muted-foreground">{sub}</div>}
    </>
  );
  return onClick ? (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      title={title}
      data-testid={testId}
      className="flex h-auto min-w-0 flex-col items-stretch justify-start gap-0 rounded-none bg-card p-4 text-left font-normal whitespace-normal hover:bg-muted/40 hover:text-foreground pointer-coarse:h-auto motion-safe:active:scale-100 sm:p-5"
    >
      {body}
    </Button>
  ) : (
    <div className="min-w-0 bg-card p-4 sm:p-5" data-testid={testId}>
      {body}
    </div>
  );
}
