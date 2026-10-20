import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, CircleDashed, ClipboardList, TriangleAlert, Wrench } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { categoryName } from '@/shared/lib/project-categories';
import { formatProjectShortName } from '@/shared/lib/formatting';
import { categoryLabel, formatDuration } from '@/features/non-project-work/lib';
import { hoursToMinutes, type PersonDayWork } from '../../lib/currentWork';
import { daysUntil, type BoardRow, type TeamBoardModel } from '../../lib/teamBoard';
import { MiniProgress, PersonChip } from './BoardBits';
import { focusHandlers, rowAccent, type BoardFocus } from './boardFocus';

/**
 * «Өнөөдөр хэн аль төсөл дээр» — самбарын гол хэсэг.
 *
 * Төсөл бүр НЭГ мөр: зүүн талд төслийн нэр + явц + ажлын тоо + хоцролт, баруун
 * талд өнөөдөр тэр дээр ажиллаж буй хүмүүс.  Хүнгүй төслүүд ч мөрөө хадгална
 * (бүдэг) — «багийн бүх төсөл, хэн хаана» гэсэн бүрэн зургийг табгүй, хайлтгүй
 * нэг дор өгнө.  Мөр олон бол ЗӨВХӨН энэ жагсаалт дотроо гүйлгэгдэнэ.
 */
export function ProjectsToday({
  board,
  total,
  dayWork,
  hrefOf,
  focus,
  onFocus,
  canSeeArchive,
}: {
  board: TeamBoardModel;
  total: number;
  dayWork: ReadonlyMap<number, PersonDayWork>;
  hrefOf: (userId: number) => string;
  focus: BoardFocus;
  onFocus: (f: BoardFocus) => void;
  canSeeArchive: boolean;
}) {
  const { t } = useLanguage();
  const [showArchive, setShowArchive] = useState(false);
  const pct = total > 0 ? Math.round((board.activeCount / total) * 100) : 0;
  const nothingToday = board.active.length === 0 && !board.nonProject;
  const archived = canSeeArchive ? board.archived : [];

  const item = (row: BoardRow) => (
    <ProjectRow
      key={row.key}
      row={row}
      dayWork={dayWork}
      hrefOf={hrefOf}
      focus={focus}
      onFocus={onFocus}
    />
  );

  return (
    <section
      className="@container flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card lg:flex-1"
      aria-labelledby="team-board-title"
      data-testid="team-projects-today"
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border/60 px-4 py-2.5">
        <span className="relative flex size-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        <h2 id="team-board-title" className="text-section">
          {t('teamDetailPage.todayBoardTitle')}
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
            <span
              className="block h-full rounded-full bg-success transition-[width] duration-700"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="text-micro text-muted-foreground tabular-nums">
            {t('teamDetailPage.todayActive', { active: board.activeCount, total })}
          </span>
        </div>
      </header>

      <ul className="m-0 min-h-0 list-none p-0 lg:flex-1 lg:overflow-y-auto">
        {nothingToday && (
          <li className="flex items-center justify-center gap-2 border-b border-border/50 px-4 py-6 text-body text-muted-foreground">
            <CircleDashed className="size-4" aria-hidden />
            {t('teamDetailPage.todayEmpty')}
          </li>
        )}

        {board.active.map(item)}
        {board.nonProject && item(board.nonProject)}

        {board.quiet.length > 0 && (
          <>
            <li className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/50 bg-muted/60 px-4 py-1.5 text-label text-muted-foreground uppercase backdrop-blur">
              {t('teamBoard.quietTitle')}
              <span className="rounded-full bg-background/70 px-1.5 tabular-nums">{board.quiet.length}</span>
            </li>
            {board.quiet.map(item)}
          </>
        )}

        {archived.length > 0 && (
          <>
            <li className="border-b border-border/50">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowArchive((v) => !v)}
                aria-expanded={showArchive}
                className="h-8 w-full justify-start gap-2 rounded-none px-4 text-micro font-normal text-muted-foreground"
              >
                <ChevronDown
                  className={cn('size-3.5 transition-transform', showArchive && 'rotate-180')}
                  aria-hidden
                />
                {t('teamBoard.archive', { n: archived.length })}
              </Button>
            </li>
            {showArchive && archived.map(item)}
          </>
        )}
      </ul>
    </section>
  );
}

function ProjectRow({
  row,
  dayWork,
  hrefOf,
  focus,
  onFocus,
}: {
  row: BoardRow;
  dayWork: ReadonlyMap<number, PersonDayWork>;
  hrefOf: (userId: number) => string;
  focus: BoardFocus;
  onFocus: (f: BoardFocus) => void;
}) {
  const { t } = useLanguage();
  const p = row.project;
  const quiet = row.kind === 'quiet';
  const accent = rowAccent(row);
  const dimmed = focus?.kind === 'person' && !row.people.some((x) => x.member.id === focus.id);
  const title =
    row.kind === 'nonProject' ? t('nonProjectWork.title') : formatProjectShortName(row.name) || row.name;

  const nameNode = (() => {
    const inner = (
      <>
        {row.kind === 'repair' && <Wrench className="size-3.5 shrink-0 text-warning" aria-label={t('teams.repairTag')} />}
        {row.kind === 'nonProject' && <ClipboardList className="size-3.5 shrink-0 text-info" aria-hidden />}
        <span className="truncate">{title}</span>
      </>
    );
    const cls = 'flex min-w-0 items-center gap-1.5 text-body font-semibold focus-visible:underline focus-visible:outline-none';
    if (row.kind === 'project' || row.kind === 'quiet') {
      return (
        <Link to={`/app/projects/${row.id}`} title={row.name} className={cn(cls, 'hover:text-primary')}>
          {inner}
        </Link>
      );
    }
    return (
      <span
        className={cls}
        title={row.kind === 'repair' ? `${row.name} — ${t('teams.repairTagHint')}` : t('teams.nonProjectTagHint')}
      >
        {inner}
      </span>
    );
  })();

  const due = daysUntil(p?.next_due);
  const dueSoon = due !== null && due >= 0 && due <= 7;

  return (
    <li
      {...focusHandlers({ kind: 'row', key: row.key }, onFocus)}
      className={cn(
        'grid gap-x-4 gap-y-1.5 border-b border-border/50 px-4 py-2 transition-opacity @[34rem]:grid-cols-[minmax(9.5rem,12rem)_minmax(0,1fr)]',
        quiet && 'bg-muted/15',
        dimmed && 'opacity-35',
      )}
    >
      <div className="flex min-w-0 gap-2.5">
        <span
          aria-hidden
          className={cn('w-1 shrink-0 self-stretch rounded-full', accent.cls, quiet && 'opacity-50')}
          style={accent.hex ? { backgroundColor: accent.hex } : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {nameNode}
            {p?.category && (
              <Badge
                variant="outline"
                className="h-4 shrink-0 border-primary/30 bg-primary/10 px-1 text-label text-primary tabular-nums normal-case"
                title={categoryName(p.category)}
              >
                {p.category}
              </Badge>
            )}
          </div>
          {p && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-micro text-muted-foreground">
              <MiniProgress value={p.avg_progress ?? 0} />
              <span className="tabular-nums" title={t('teamDetailPage.taskCount', { count: p.task_count })}>
                {t('teamBoard.tasksDone', { done: p.completed_count, total: p.task_count })}
              </span>
              {p.overdue_count > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-sm bg-danger/10 px-1 font-medium text-danger tabular-nums"
                  title={t('teamDetailPage.statusOverdue')}
                >
                  <TriangleAlert className="size-3" aria-hidden />
                  {p.overdue_count}
                </span>
              )}
              {dueSoon && (
                <span className="font-medium text-warning tabular-nums" title={t('teamDetailPage.nextDueTitle')}>
                  {t('teamDetailPage.daysLeft', { days: due })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 self-center">
        {row.people.length === 0 ? (
          <span className="text-micro text-muted-subtle">{t('teamBoard.nobodyToday')}</span>
        ) : (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {row.people.map((person) => {
              const id = person.member.id;
              const npEntries = row.kind === 'nonProject' ? (dayWork.get(id)?.nonProject ?? []) : [];
              const npMinutes = npEntries.reduce((s, e) => s + e.minutes, 0);
              const suffix =
                row.kind === 'nonProject'
                  ? npMinutes > 0
                    ? formatDuration(npMinutes, t)
                    : null
                  : person.hours && person.hours > 0
                    ? formatDuration(hoursToMinutes(person.hours), t)
                    : null;
              const detail =
                npEntries.length > 0
                  ? npEntries
                      .map((e) => {
                        const span = e.start_time && e.end_time ? `${e.start_time}–${e.end_time}` : formatDuration(e.minutes, t);
                        return `${categoryLabel(e.category, e.category_label, t)}${e.note ? ` (${e.note})` : ''} · ${span}`;
                      })
                      .join('\n')
                  : person.member.position || undefined;
              return (
                <li key={id}>
                  <PersonChip
                    member={person.member}
                    href={hrefOf(id)}
                    suffix={suffix}
                    now={npEntries.some((e) => e.now)}
                    highlighted={focus?.kind === 'person' && focus.id === id}
                    detail={detail}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </li>
  );
}
