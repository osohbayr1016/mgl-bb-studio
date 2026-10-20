import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';
import { TeamIcon } from '@/shared/components/TeamIcon';
import { teamChipClass, teamHex, teamTone } from '@/shared/lib/team-colors';
import type { TeamOverview } from '@/shared/types';
import { progressTone, TONE_TEXT } from '../../lib/teamView';
import { PersonAvatar } from '../TeamPeopleBits';

/**
 * Багийн толгой — НЭГ мөр: хэн вэ (нэр, код, баталгаажуулагч) + дөрвөн гол үзүүлэлт.
 *
 * Өмнөх hero (~300px өндөр) хуудасны эхний дэлгэцийн тал орчмыг эзэлж, жинхэнэ
 * агуулгыг доош түлхдэг байв.  Одоо ~76px: өнөөдөр ажиллаж буй хүн, төсөл, ажлын
 * задаргаа (+ хоцролт), дундаж явц.  `activeToday` нь самбар, жагсаалттай ИЖИЛ
 * тооллого (`lib/teamBoard.ts`) — хуудас дээрх тоонууд хэзээ ч зөрөхгүй.
 */
export function TeamHeaderBar({
  data,
  activeToday,
  leading,
  trailing,
}: {
  data: TeamOverview;
  activeToday: number;
  /** Зүүн захын үйлдэл — «Багууд» руу буцах (зөвхөн бүх баг харах эрхтэйд). */
  leading?: ReactNode;
  /** Баруун захын үйлдэл — харагдац сэлгэх (зөвхөн «Бүтээмж» харах эрхтэйд). */
  trailing?: ReactNode;
}) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const team = data.team;
  const hex = teamHex(team.code);
  const tone = teamTone(team.code);
  const title = pickLocalized(lang, team.name_mn, team.name_en);
  const otherName = lang === 'en' ? team.name_mn : team.name_en;
  const subtitle =
    [otherName && otherName !== title ? otherName : null, team.description].filter(Boolean).join(' · ') ||
    t('teamDetailPage.teamDepartment');

  const lead = data.members.find((m) => m.id === team.lead_user_id) ?? null;
  const memberCount = data.members.length;
  const presencePct = memberCount > 0 ? Math.round((activeToday / memberCount) * 100) : 0;
  const ongoing = data.projects.filter((p) => p.status !== 'archived');
  const projectsToday = ongoing.filter((p) => p.active_today_count > 0).length;

  const { total, completed, in_progress: inProgress, overdue, due_soon: dueSoon } = data.stats;
  const notStarted = Math.max(0, data.stats.not_started ?? total - completed - inProgress);
  const segTotal = completed + inProgress + notStarted;
  const seg = (n: number) => (segTotal > 0 ? `${(n / segTotal) * 100}%` : '0%');
  const progress = Math.round(data.stats.avg_progress ?? 0);

  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card xl:flex-row"
      data-testid="team-header-bar"
    >
      {/* ── Хэн вэ ── */}
      <div className="relative flex min-w-0 items-center gap-3 px-4 py-2.5 xl:flex-1">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: `radial-gradient(90% 180% at 0% 0%, ${hex}2e, transparent 70%)` }}
        />
        {leading}
        <div
          className={cn(
            'relative flex size-11 shrink-0 items-center justify-center rounded-xl border shadow-sm',
            tone.chip,
          )}
        >
          <TeamIcon code={team.code} size={24} className={tone.text} />
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-title" title={title}>
              {title}
            </h1>
            <Badge variant="outline" className={cn('px-1.5 py-0 font-mono text-micro', teamChipClass(team.code))}>
              {team.code}
            </Badge>
          </div>
          {lead ? (
            <Link
              to={lead.id === user?.id ? '/app/profile' : `/app/users/${lead.id}`}
              title={t('teamDetailPage.approverTitle')}
              className="mt-1 inline-flex max-w-full items-center gap-1.5 text-micro text-muted-foreground transition-colors hover:text-foreground focus-visible:underline focus-visible:outline-none"
            >
              <PersonAvatar member={lead} size="xs" />
              <span className="truncate font-medium text-foreground">{formatDisplayName(lead.full_name)}</span>
              <ShieldCheck className="size-3.5 shrink-0 text-success" aria-hidden />
              <span className="shrink-0">{t('teamDetailPage.approverBadge')}</span>
            </Link>
          ) : (
            <p className="mt-0.5 truncate text-micro text-muted-foreground">{subtitle}</p>
          )}
          {trailing && <div className="mt-1.5">{trailing}</div>}
        </div>
      </div>

      {/* ── Дөрвөн үзүүлэлт — hairline тор (`gap-px` + `bg-border`) ── */}
      <div className="@container relative grid grid-cols-2 gap-px border-t border-border/60 bg-border/60 sm:grid-cols-[1fr_1fr_1.5fr_1fr] xl:w-[38rem] xl:border-t-0 xl:border-l 2xl:w-[56%] 2xl:max-w-[62rem]">
        <Kpi label={t('teamBoard.kpiPresent')}>
          <Value>
            {activeToday}
            <span className="text-body font-normal text-muted-foreground">/{memberCount}</span>
          </Value>
          <Bar>
            <span className="h-full bg-success transition-[width] duration-700" style={{ width: `${presencePct}%` }} />
          </Bar>
        </Kpi>

        <Kpi label={t('teamBoard.kpiProjects')}>
          <Value>{ongoing.length}</Value>
          <p
            className="mt-1 line-clamp-2 text-micro leading-tight text-muted-foreground"
            title={projectsToday > 0 ? t('teamDetailPage.statProjectsHint', { n: projectsToday }) : t('teamDetailPage.statProjectsHintNone')}
          >
            {projectsToday > 0 ? t('teamBoard.projectsToday', { n: projectsToday }) : t('teamBoard.projectsQuiet')}
          </p>
        </Kpi>

        <Kpi label={t('teamDetailPage.statTasks')}>
          <div className="flex items-baseline gap-2">
            <Value>{(total ?? 0).toLocaleString()}</Value>
            {overdue > 0 && (
              <span className="text-micro font-semibold text-danger tabular-nums" title={t('teamDetailPage.statusOverdue')}>
                {t('teamBoard.overdueN', { n: overdue })}
              </span>
            )}
            {dueSoon > 0 && (
              <span className="text-micro font-medium text-warning tabular-nums" title={t('teamBoard.dueSoonTitle')}>
                {t('teamBoard.dueSoonN', { n: dueSoon })}
              </span>
            )}
          </div>
          <Bar
            label={`${t('teamDetailPage.statusCompleted')} ${completed}, ${t('teamDetailPage.statusInProgress')} ${inProgress}, ${t('teamDetailPage.statusNotStarted')} ${notStarted}`}
          >
            <span className="h-full bg-success transition-[width] duration-700" style={{ width: seg(completed) }} />
            <span className="h-full bg-info transition-[width] duration-700" style={{ width: seg(inProgress) }} />
          </Bar>
          <ul className="m-0 mt-1 flex list-none flex-nowrap gap-x-2.5 p-0 text-micro whitespace-nowrap text-muted-foreground tabular-nums">
            <Legend dot="bg-success" label={t('teamDetailPage.statusCompleted')} value={completed} />
            <Legend dot="bg-info" label={t('teamDetailPage.statusInProgress')} value={inProgress} />
            <Legend dot="bg-muted-subtle" label={t('teamDetailPage.statusNotStarted')} value={notStarted} />
          </ul>
        </Kpi>

        <Kpi label={t('teamDetailPage.statAvgProgress')}>
          <div className="flex items-center gap-2.5">
            <Ring value={progress} />
            <p className="hidden min-w-0 text-micro leading-tight text-muted-foreground @[46rem]:block">{t('teamBoard.avgHint')}</p>
          </div>
        </Kpi>
      </div>
    </div>
  );
}

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-3.5 py-2">
      <div className="mb-0.5 truncate text-label text-muted-foreground uppercase">{label}</div>
      {children}
    </div>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <div className="text-metric tabular-nums">{children}</div>;
}

function Bar({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div
      className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </div>
  );
}

function Legend({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <li className="inline-flex items-center gap-1" title={`${label}: ${value}`}>
      <span className={cn('size-1.5 rounded-full', dot)} aria-hidden />
      <span className="font-medium text-foreground">{value}</span>
      <span className="hidden @[52rem]:inline">{label}</span>
    </li>
  );
}

function Ring({ value }: { value: number }) {
  const size = 40;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, value)) / 100) * c;
  const tone = TONE_TEXT[progressTone(value)];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--muted))" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          fill="none"
          className={cn('transition-[stroke-dasharray] duration-700', tone)}
        />
      </svg>
      <div className={cn('absolute inset-0 flex items-center justify-center text-micro font-semibold tabular-nums', tone)}>
        {value}%
      </div>
    </div>
  );
}
