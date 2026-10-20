import { Link } from 'react-router-dom';
import { Card, CardContent, CardTitle, CardDescription } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Progress } from '@/ui/progress';
import { FolderKanban, Activity, CalendarClock } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { categoryName } from '@/shared/lib/project-categories';
import {
  DEFAULT_COMPLEXITY_PCT,
  clampComplexityPct,
  complexityPctColor,
} from '@/shared/lib/complexity';
import { formatDate } from '@/shared/lib/time';
import type { ProjectCategory } from '@/shared/types';

/** Минимал төслийн өгөгдөл — `ProjectsPage` (ProjectWithProgress) болон багийн
 *  хуудасны (TeamProjectSummary) хоёулаа энэ хэлбэрт тааруулж дамжуулна. */
export interface ProjectCardData {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  category?: ProjectCategory | null;
  complexity_pct?: number | null;
  progress: number;
  start_date?: string | null;
  finish_date?: string | null;
  created_at?: string | null;
}

const STATUS_CONFIG: Record<string, { labelKey: string; class: string }> = {
  active: {
    labelKey: 'projectsPage.statusActive',
    class: 'bg-primary/10 text-primary border-primary/20',
  },
  completed: {
    labelKey: 'projectsPage.statusCompleted',
    class: 'bg-success/10 text-success border-success/20',
  },
  archived: {
    labelKey: 'projectsPage.statusArchived',
    class: 'bg-muted text-muted-foreground border-border',
  },
};

const startOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

function parseDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPercent(value: number | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function getScheduleProgress(start_date?: string | null, finish_date?: string | null) {
  const start = parseDateOnly(start_date);
  const finish = parseDateOnly(finish_date);
  if (!start || !finish || finish.getTime() < start.getTime()) return null;

  const today = startOfLocalDay(new Date()).getTime();
  const startMs = start.getTime();
  const finishMs = finish.getTime();
  if (finishMs === startMs) return today >= finishMs ? 100 : 0;

  const elapsed = ((today - startMs) / (finishMs - startMs)) * 100;
  return Math.max(0, Math.min(100, elapsed));
}

/** Нэг мөрт явцын зурвас (icon + bar + %). `caption` өгвөл дээр нь жижиг гарчигтай. */
export function CompactProgressLine({
  icon: Icon,
  value,
  title,
  caption,
  tone = 'primary',
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | null | undefined;
  title: string;
  caption?: string;
  tone?: 'primary' | 'muted';
}) {
  const hasValue = value != null && Number.isFinite(Number(value));
  const pct = hasValue ? Math.max(0, Math.min(100, Number(value))) : 0;
  // Баар 100-д таслагдана, бичигдэх тоо — ЖИНХЭНЭ (засварын төсөл 100%-аас давж болно, 2026-09-29).
  const shown = hasValue ? Math.max(0, Number(value)) : 0;

  if (caption) {
    return (
      <div className="w-full space-y-1 text-micro leading-none">
        <div className="text-micro font-semibold tracking-wide text-muted-foreground">
          {caption}
        </div>
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              tone === 'primary' ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-label={title}
          />
          <Progress value={pct} className={cn('h-1.5 min-w-0 flex-1', !hasValue && 'opacity-30')} />
          <span className="w-14 text-right font-semibold tabular-nums text-muted-foreground">
            {hasValue ? `${formatPercent(shown)}%` : '—'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-2 text-micro leading-none">
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          tone === 'primary' ? 'text-primary' : 'text-muted-foreground',
        )}
        aria-label={title}
      />
      <Progress value={pct} className={cn('h-1.5 min-w-0 flex-1', !hasValue && 'opacity-30')} />
      <span className="w-14 text-right font-semibold tabular-nums text-muted-foreground">
        {hasValue ? `${formatPercent(shown)}%` : '—'}
      </span>
    </div>
  );
}

/** Хуваарийн явц (start_date→finish_date-ийн дагуу өнөөдөр хэдэн хувьд явж байх ёстой). */
export function ScheduleProgress({
  start_date,
  finish_date,
}: {
  start_date?: string | null;
  finish_date?: string | null;
}) {
  const { t } = useLanguage();
  return (
    <CompactProgressLine
      icon={CalendarClock}
      value={getScheduleProgress(start_date, finish_date)}
      title={t('projectsPage.scheduleProgress')}
      caption={t('projectsPage.scheduleProgress')}
      tone="muted"
    />
  );
}

/** Төслийн жагсаалтын нэг мөр-карт — `ProjectsPage` дээрх загвартай яг адилхан.
 *  `leading` (зүүн дээд буланд, drag-handle) болон `trailing` (баруун гар талд,
 *  үйлдлийн цэс) slot-ууд нь нэмэлт UI-г хуудас бүрд тааруулж залгана. */
export function ProjectListCard({
  project,
  to,
  isAdminTier,
  leading,
  trailing,
}: {
  project: ProjectCardData;
  to: string;
  isAdminTier: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <Card className="relative py-0 border-border bg-card/60 backdrop-blur hover:bg-card/80 transition-colors group overflow-hidden">
      {leading}
      <CardContent
        className={cn(
          'p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4',
          leading && 'pl-9',
        )}
      >
        <div className="flex-1 min-w-0 lg:grid lg:grid-cols-12 lg:items-center lg:gap-6 flex flex-col gap-3">
          {/* ── Left: folder icon + name + description ── */}
          <div className="flex items-start gap-3 min-w-0 lg:col-span-5">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <FolderKanban className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base leading-snug truncate">
                <Link to={to} className="hover:text-primary transition-colors">
                  {project.name}
                </Link>
              </CardTitle>
              <CardDescription className="line-clamp-1 mt-0.5 text-xs">
                {project.description || t('projectsPage.noDescription')}
              </CardDescription>
            </div>
          </div>

          {/* ── Middle: status badge + created date ── */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground lg:col-span-2 lg:flex-col lg:items-start lg:gap-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className={cn('capitalize', STATUS_CONFIG[project.status]?.class)}>
                {(() => {
                  const labelKey = STATUS_CONFIG[project.status]?.labelKey;
                  return labelKey ? t(labelKey) : project.status;
                })()}
              </Badge>
              {project.category && (
                <Badge
                  variant="outline"
                  className="text-micro py-0 bg-primary/10 text-primary border-primary/30 tabular-nums"
                  title={categoryName(project.category)}
                >
                  {project.category}
                </Badge>
              )}
              {/* Complexity weight — зөвхөн admin-tier-д (инженер, архитектор,
                  ахлах, харилцагчид харагдахгүй). */}
              {isAdminTier &&
                (() => {
                  const pct = clampComplexityPct(project.complexity_pct ?? DEFAULT_COMPLEXITY_PCT);
                  return (
                    <Badge
                      variant="outline"
                      className={cn('text-micro py-0 tabular-nums', complexityPctColor(pct))}
                      title={t('projectsPage.complexityBadgeTitle', { pct })}
                    >
                      {pct}%
                    </Badge>
                  );
                })()}
            </div>
            {project.created_at && (
              <span className="tabular-nums">{formatDate(new Date(project.created_at))}</span>
            )}
          </div>

          {/* ── Right area: progress mini-block ── */}
          <div className="space-y-1.5 min-w-0 lg:col-span-5">
            <CompactProgressLine
              icon={Activity}
              value={project.progress ?? 0}
              title={t('projectsPage.totalProgress')}
              caption={t('projectsPage.totalProgress')}
            />
            <ScheduleProgress start_date={project.start_date} finish_date={project.finish_date} />
          </div>
        </div>

        {trailing}
      </CardContent>
    </Card>
  );
}
