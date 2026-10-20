import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Crown, EllipsisVertical, ShieldCheck, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { EmptyState } from '@/shared/components/EmptyState';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDisplayName, formatProjectShortName } from '@/shared/lib/formatting';
import type { TeamOverview } from '@/shared/types';
import type { BoardRow, RosterEntry, TeamBoardModel } from '../../lib/teamBoard';
import { PersonAvatar } from '../TeamPeopleBits';
import { focusHandlers, rowAccent, type BoardFocus } from './boardFocus';

type Filter = 'all' | 'working' | 'idle';

/** Мөрийн өнгөт цэг — нэг хүн хэд хэдэн мөрөнд орсон бол дээд тал нь ингэж харагдана. */
const MAX_DOTS = 4;

/**
 * Багийн бүх гишүүд — НЭГ мөр = НЭГ хүн, гүйлгэлтгүй багтах нягтрал.
 *
 * Мөр: avatar (өнөөдөр ажиллаж буй ногоон цэгтэй) · нэр · орсон төслүүдийн өнгөт
 * цэгүүд · «дууссан/нийт» ажил.  Албан тушаал, ажлын дэлгэрэнгүй нь tooltip-д —
 * гол асуулт («ажиллаж байна уу, хаана?») мөр дээр шууд харагдана.  Хүн дээр
 * хулгана тавихад зүүн самбарт тэр хүний орсон төслүүд онцлогдоно (`focus`).
 */
export function TeamRoster({
  data,
  board,
  hrefOf,
  focus,
  onFocus,
  isAdmin,
  onSetLead,
  onRemove,
  addAction,
  onAddFirst,
}: {
  data: TeamOverview;
  board: TeamBoardModel;
  hrefOf: (userId: number) => string;
  focus: BoardFocus;
  onFocus: (f: BoardFocus) => void;
  isAdmin: boolean;
  onSetLead: (userId: number | null, name?: string) => void;
  onRemove: (userId: number, name?: string) => void;
  /** «Гишүүн нэмэх» dialog-ийн trigger (admin/senior). */
  addAction: ReactNode;
  onAddFirst: () => void;
}) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<Filter>('all');
  const leadId = data.team.lead_user_id ?? null;

  const rowsByKey = useMemo(() => {
    const map = new Map<string, BoardRow>();
    for (const r of board.active) map.set(r.key, r);
    if (board.nonProject) map.set(board.nonProject.key, board.nonProject);
    return map;
  }, [board]);

  const counts = useMemo(() => {
    const working = board.roster.filter((r) => r.working).length;
    return { all: board.roster.length, working, idle: board.roster.length - working };
  }, [board.roster]);

  const visible = board.roster.filter(
    (r) => filter === 'all' || (filter === 'working' ? r.working : !r.working),
  );

  const filters: Array<{ key: Filter; label: string; n: number }> = [
    { key: 'all', label: t('teamDetailPage.filterAll'), n: counts.all },
    { key: 'working', label: t('teamDetailPage.filterWorking'), n: counts.working },
    { key: 'idle', label: t('teamDetailPage.todayIdle'), n: counts.idle },
  ];

  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card lg:w-[19rem] lg:shrink-0 xl:w-[21.5rem]"
      aria-labelledby="team-roster-title"
      data-testid="team-roster"
    >
      <header className="shrink-0 space-y-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-primary" aria-hidden />
          <h2 id="team-roster-title" className="text-section">
            {t('teamDetailPage.tabMembers')}
          </h2>
          <span className="text-body text-muted-foreground tabular-nums">{data.members.length}</span>
          <div className="ml-auto">{addAction}</div>
        </div>
        {data.members.length > 0 && (
          <div
            className="flex gap-0.5 rounded-lg bg-muted p-0.5"
            role="group"
            aria-label={t('teamDetailPage.filterLabel')}
          >
            {filters.map((f) => (
              <Button
                key={f.key}
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'h-7 flex-1 gap-1.5 px-2 text-micro font-medium pointer-coarse:h-9',
                  filter === f.key
                    ? 'bg-background text-foreground shadow-sm hover:bg-background'
                    : 'text-muted-foreground',
                )}
              >
                {f.label}
                <span className="tabular-nums text-muted-foreground">{f.n}</span>
              </Button>
            ))}
          </div>
        )}
      </header>

      {data.members.length === 0 ? (
        <EmptyState
          compact
          icon={Users}
          title={t('teamDetailPage.noMembers')}
          action={
            isAdmin ? (
              <Button size="sm" variant="outline" onClick={onAddFirst} className="gap-1.5">
                <UserPlus className="size-3.5" /> {t('teamDetailPage.addFirstMember')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="m-0 min-h-0 list-none p-1 lg:flex-1 lg:overflow-y-auto">
          {visible.map((entry) => (
            <RosterRow
              key={entry.member.id}
              entry={entry}
              rowsByKey={rowsByKey}
              isLead={entry.member.id === leadId}
              href={hrefOf(entry.member.id)}
              focus={focus}
              onFocus={onFocus}
              isAdmin={isAdmin}
              onSetLead={onSetLead}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RosterRow({
  entry,
  rowsByKey,
  isLead,
  href,
  focus,
  onFocus,
  isAdmin,
  onSetLead,
  onRemove,
}: {
  entry: RosterEntry;
  rowsByKey: ReadonlyMap<string, BoardRow>;
  isLead: boolean;
  href: string;
  focus: BoardFocus;
  onFocus: (f: BoardFocus) => void;
  isAdmin: boolean;
  onSetLead: (userId: number | null, name?: string) => void;
  onRemove: (userId: number, name?: string) => void;
}) {
  const { t } = useLanguage();
  const m = entry.member;
  const name = formatDisplayName(m.full_name);
  const rows = entry.rowKeys.map((k) => rowsByKey.get(k)).filter((r): r is BoardRow => !!r);
  const isSelf = focus?.kind === 'person' && focus.id === m.id;
  const dimmed = focus?.kind === 'row' && !entry.rowKeys.includes(focus.key);
  const progress = Math.round(m.avg_progress ?? 0);

  const todayNames = rows.map((r) =>
    r.kind === 'nonProject' ? t('nonProjectWork.title') : formatProjectShortName(r.name) || r.name,
  );
  const tooltip = [
    `${name}${m.position ? ` — ${m.position}` : ''}`,
    entry.working ? `${t('teamDetailPage.statToday')}: ${todayNames.join(', ')}` : t('teamDetailPage.noProjectSelectedToday'),
    m.task_count > 0
      ? `${t('teamDetailPage.taskCompletedSummary', { tasks: m.task_count, completed: m.completed_count })} · ${progress}%`
      : t('teamDetailPage.noTasksAssigned'),
  ].join('\n');

  return (
    <li
      {...focusHandlers({ kind: 'person', id: m.id }, onFocus)}
      className={cn(
        'group/row flex items-center rounded-lg pr-1 transition-[background-color,opacity]',
        isSelf ? 'bg-primary/10' : 'hover:bg-muted/60',
        dimmed && 'opacity-35',
      )}
    >
      <Link
        to={href}
        title={tooltip}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-[3px] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <PersonAvatar member={m} size="row" presence={entry.working ? 'working' : 'idle'} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-body',
            entry.working ? 'font-medium' : 'text-muted-foreground',
          )}
        >
          {name}
        </span>
        {isLead ? (
          <ShieldCheck className="size-3.5 shrink-0 text-success" aria-label={t('teamDetailPage.approverBadge')} />
        ) : m.role === 'admin' ? (
          <Crown className="size-3.5 shrink-0 text-warning" aria-label={m.role} />
        ) : m.role === 'senior' ? (
          <ShieldCheck className="size-3.5 shrink-0 text-warning" aria-label={m.role} />
        ) : null}

        <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
          {rows.slice(0, MAX_DOTS).map((r) => {
            const accent = rowAccent(r);
            return (
              <span
                key={r.key}
                className={cn('size-2 rounded-full', accent.cls)}
                style={accent.hex ? { backgroundColor: accent.hex } : undefined}
              />
            );
          })}
          {rows.length > MAX_DOTS && (
            <span className="ml-0.5 text-label text-muted-foreground tabular-nums">+{rows.length - MAX_DOTS}</span>
          )}
        </span>

        <span className="w-10 shrink-0 text-right text-micro text-muted-foreground tabular-nums">
          {m.task_count > 0 ? `${m.completed_count}/${m.task_count}` : '—'}
        </span>
      </Link>

      {isAdmin && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-subtle hover:text-foreground focus-visible:text-foreground"
              aria-label={t('teamDetailPage.memberActions', { name })}
            >
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {m.role === 'senior' && !isLead && (
              <DropdownMenuItem onSelect={() => onSetLead(m.id, name)}>
                <ShieldCheck /> {t('teamDetailPage.makeLead')}
              </DropdownMenuItem>
            )}
            {isLead && (
              <DropdownMenuItem onSelect={() => onSetLead(null)}>
                <X /> {t('teamDetailPage.clearApproverTitle')}
              </DropdownMenuItem>
            )}
            {(isLead || m.role === 'senior') && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onSelect={() => onRemove(m.id, name)}>
              <UserMinus /> {t('teamDetailPage.removeFromTeam')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
