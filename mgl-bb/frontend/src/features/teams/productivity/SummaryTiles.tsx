import type { ComponentType, ReactNode } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Briefcase, CalendarCheck, HardHat, Minus, TrendingUp } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { ProductivitySummary, PeriodKind } from './types';
import { fmtAvg, fmtPct, trendOf } from './lib';

/**
 * Эзний өгүүлбэрүүд тоо болж: «багийн тэдэн хувь нь ажлаа хийсэн, тэд нь
 * төсөлд орсон, тэд нь зохиогчийн хяналтаар явсан» + ирц + өдрийн дундаж.
 * Өдрөөр харахад «X/Y хүн», 7 хоног/сараар «ажлын өдрийн хувь».
 */
export function SummaryTiles({ s, kind }: { s: ProductivitySummary; kind: PeriodKind }) {
  const { t } = useLanguage();
  const perDay = kind === 'day';
  const trend = trendOf(s.team_avg, s.prev_team_avg);
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5" data-testid="tp-summary">
      <Tile
        icon={Activity}
        tone="primary"
        label={t('teamProductivity.tileDidWork')}
        value={fmtPct(s.logged_rate)}
        hint={t('teamProductivity.tileDidWorkHint')}
        sub={
          perDay
            ? t('teamProductivity.peopleOf', { n: s.people_logged, of: s.people_expected })
            : t('teamProductivity.daysOf', { n: s.logged_person_days, of: s.expected_person_days, people: s.people_logged })
        }
      />
      <Tile
        icon={Briefcase}
        tone="info"
        label={t('teamProductivity.tileOnProjects')}
        value={t('teamProductivity.peopleCount', { n: s.people_on_projects })}
        hint={t('teamProductivity.tileOnProjectsHint')}
        sub={
          <>
            {t('teamProductivity.projectCount', { n: s.project_count })}
            {s.people_on_repair > 0 && (
              <span className="block">{t('teamProductivity.onRepair', { n: s.people_on_repair })}</span>
            )}
          </>
        }
      />
      <Tile
        icon={HardHat}
        tone="warning"
        label={t('teamProductivity.tileAsr')}
        value={t('teamProductivity.peopleCount', { n: s.people_asr })}
        hint={t('teamProductivity.tileAsrHint')}
        sub={
          s.asr_team_visits > 0
            ? t('teamProductivity.asrVisits', { n: s.asr_team_visits })
            : t('teamProductivity.asrNone')
        }
      />
      <Tile
        icon={CalendarCheck}
        tone="success"
        label={t('teamProductivity.tileAttendance')}
        value={fmtPct(s.present_rate)}
        hint={t('teamProductivity.tileAttendanceHint')}
        sub={
          <>
            {perDay
              ? t('teamProductivity.peopleOf', { n: s.people_present, of: s.people_expected })
              : t('teamProductivity.daysPresent', { n: s.present_person_days, of: s.expected_person_days })}
            {s.leave_person_days > 0 && (
              <span className="block">{t('teamProductivity.leaveDays', { n: s.leave_person_days })}</span>
            )}
          </>
        }
      />
      <Tile
        icon={TrendingUp}
        tone="primary"
        label={t('teamProductivity.tileTeamAvg')}
        value={fmtAvg(s.team_avg)}
        hint={t('teamProductivity.tileTeamAvgHint')}
        sub={
          s.prev_team_avg == null ? (
            t('teamProductivity.noPrev')
          ) : (
            <span className="inline-flex items-center gap-1">
              {trend === 'up' && <ArrowUpRight className="h-3.5 w-3.5 text-success" />}
              {trend === 'down' && <ArrowDownRight className="h-3.5 w-3.5 text-danger" />}
              {trend === 'flat' && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
              {t(`teamProductivity.prevLabel_${kind}`, { v: fmtAvg(s.prev_team_avg) })}
            </span>
          )
        }
      />
    </div>
  );
}

const TONES = {
  primary: 'bg-primary/10 text-primary',
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
} as const;

function Tile({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  hint,
}: {
  icon: ComponentType<{ className?: string }>;
  tone: keyof typeof TONES;
  label: string;
  value: string;
  sub: ReactNode;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3" title={hint}>
      <div className="flex items-center gap-2">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TONES[tone])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums leading-none">{value}</div>
      <div className="mt-1.5 text-label font-normal normal-case tracking-normal leading-snug text-muted-foreground">{sub}</div>
    </div>
  );
}
