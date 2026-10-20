/* ---------- Team-tabbed tasks table ----------
 * Groups tasks by team (using the drawing prefix code) into tabs. Inside
 * each tab the tasks are further grouped by Block → (Drawing › Component)
 * with collapsible headings so the hierarchy is always visible instead of
 * repeating the breadcrumb on every row. Admins that span multiple teams
 * get an extra "All" tab; scoped staff effectively see only their team.
 *
 * Extracted from `ProjectDetailPage.tsx` when that file was split into
 * per-component modules — no behavioural change.
 */
import { useMemo } from 'react';
import { Users2 } from 'lucide-react';

import { Card } from '@/ui/card';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import { DISCIPLINE_DOT, DRAWING_DISCIPLINES, DRAWING_DISCIPLINE_LABEL } from './constants';
import { FlatTasksGrid } from './FlatTasksGrid';
import { GroupedTasksTable } from './GroupedTasksTable';
import type { FlatTask, TaskRowProps } from './types';
import { useAjilColumnWidth, useTabbedSort } from './useTaskGridPrefs';

export function TasksFlatTable({
  tasks,
  scopeTeamCodes,
  isScopedUser,
  emptyMessage,
  hideTeamTabs = false,
  ...actions
}: {
  tasks: FlatTask[];
  isScopedUser: boolean;
  scopeTeamCodes?: Set<string> | null;
  emptyMessage: string;
  /** When true the discipline tab-strip is hidden and the flat all-tasks
   *  table is rendered directly. The block-card + team-pill filters
   *  above already scope the visible task set. */
  hideTeamTabs?: boolean;
} & TaskRowProps) {
  const { t } = useLanguage();
  const { sortFor, cycleSort } = useTabbedSort();
  const { startAjilResize, cardStyle, tableStyle } = useAjilColumnWidth();

  // Bucket tasks by drawing-discipline code. Tasks whose drawing has no
  // recognised prefix land in the sentinel '_none' bucket so we can still
  // show them under an "Бусад" (Other) tab instead of silently hiding them.
  const byTeam = useMemo(() => {
    const map = new Map<string, FlatTask[]>();
    for (const t of tasks) {
      const key = t.teamCode ?? '_none';
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [tasks]);

  // Tab order: ALL 10 official disciplines in canonical order, then '_none'
  // ("Бусад") at the very end if any orphan tasks exist.  We deliberately
  // keep empty tabs visible so admins can switch into a discipline that
  // hasn't started yet and see the empty state, instead of the tab silently
  // disappearing whenever the last task gets reassigned.
  const teamKeys = useMemo(() => {
    // Only show tabs for disciplines that actually have tasks in this
    // project so the tab strip stays focused on what's there.  Order
    // follows the canonical DRAWING_DISCIPLINES sequence; any orphan
    // ('_none') bucket is appended last as "Бусад".
    const ordered: string[] = DRAWING_DISCIPLINES.map((d) => d.code).filter(
      (code) => (byTeam.get(code)?.length ?? 0) > 0,
    );
    if (byTeam.has('_none')) ordered.push('_none');
    return ordered;
  }, [byTeam]);

  // Always render the "Бүгд" tab when there is *any* task, even if every
  // task happens to fall under a single discipline — admins consistently
  // expect the all-up overview to be there as the first tab.
  // For scoped users (regular employees) hide "Бүгд" and other teams' tabs.
  const showAllTab = !isScopedUser && tasks.length > 0;

  // For scoped users show only their own team tabs (multi-team aware);
  // others see all discipline tabs.
  const visibleTeamKeys =
    isScopedUser && scopeTeamCodes ? teamKeys.filter((k) => scopeTeamCodes!.has(k)) : teamKeys;

  // Default tab: prefer the caller's own discipline so they land on their
  // work immediately, otherwise the "Бүгд" tab.
  const defaultTab =
    actions.currentUserTeam && teamKeys.includes(actions.currentUserTeam)
      ? actions.currentUserTeam
      : showAllTab
        ? 'all'
        : (teamKeys[0] ?? 'all');

  if (tasks.length === 0) {
    return (
      <Card className="border-border/60">
        <div className="text-center text-muted-foreground py-10 text-sm">{emptyMessage}</div>
      </Card>
    );
  }

  // Horoolol projects: the upstream team-pill filter + block-card row
  // already constrain visible tasks to a single team, so the discipline
  // tab-strip would only ever show one real tab on top of "Бүгд". We
  // render the grouped Block › Drawing › Бүрдэл view directly so each
  // component appears as its own heading with its tasks listed below.
  // Цагаар бодогддог засварын төсөл (2026-09-24): «Бүгд» таб (FlatTasksGrid) нь
  // Зураг % / Төсөл % / Явц баганатай тул энд ХЭЗЭЭ Ч хүрэхгүй — цагийн
  // баганатай бүлэглэсэн хүснэгт л.
  if (hideTeamTabs || actions.hoursMode) {
    return (
      <Card className="py-0 border-border/60 overflow-hidden" style={cardStyle}>
        <GroupedTasksTable
          list={tasks}
          emptyMessage={emptyMessage}
          onAjilResize={startAjilResize}
          {...actions}
        />
      </Card>
    );
  }

  return (
    <Card className="py-0 border-border/60 overflow-hidden" style={cardStyle}>
      <KeepAliveTabs defaultValue={defaultTab}>
        {/* Discipline tabs — codes only (BA, BB, …) so all 10 fit
            inline without horizontal scroll.  A small colored dot per
            tab pairs each team with a stable accent color used
            elsewhere on the page (drawing chips, etc.).  Full label is
            still available on hover via title=. */}
        <div className="px-3 py-2 border-b border-border/60 bg-muted/30">
          <TabsList className="h-auto flex flex-wrap gap-1 bg-transparent p-0 justify-start w-full">
            {showAllTab && (
              <TabsTrigger
                value="all"
                className="h-7 px-2.5 text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Users2 className="h-3 w-3" />
                <span className="font-medium">{t('projectDetailPage.allTab')}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {tasks.length}
                </span>
              </TabsTrigger>
            )}
            {visibleTeamKeys.map((k) => {
              const list = byTeam.get(k) ?? [];
              const isMine = k !== '_none' && k === actions.currentUserTeam;
              const fullLabel =
                k === '_none'
                  ? t('projectDetailPage.other')
                  : (DRAWING_DISCIPLINE_LABEL.get(k) ?? k);
              const dotCls =
                k === '_none' ? 'bg-muted-foreground/40' : (DISCIPLINE_DOT[k] ?? 'bg-primary');
              return (
                <TabsTrigger
                  key={k}
                  value={k}
                  className={cn(
                    'h-7 px-2.5 text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm',
                    isMine && 'ring-1 ring-primary/40',
                  )}
                  title={fullLabel}
                >
                  <span className={cn('w-2 h-2 rounded-full shrink-0', dotCls)} />
                  <span className="font-mono font-semibold">{k === '_none' ? '—' : k}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {list.length}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        {showAllTab && (
          <KeepAliveTabsPanel value="all" className="m-0">
            <FlatTasksGrid
              list={tasks}
              tabKey="all"
              sort={sortFor('all')}
              onCycleSort={cycleSort}
              onAjilResize={startAjilResize}
              tableStyle={tableStyle}
              emptyMessage={emptyMessage}
              actions={actions}
            />
          </KeepAliveTabsPanel>
        )}
        {teamKeys.map((k) => (
          <KeepAliveTabsPanel key={k} value={k} className="m-0">
            <GroupedTasksTable
              list={byTeam.get(k) ?? []}
              emptyMessage={emptyMessage}
              onAjilResize={startAjilResize}
              {...actions}
            />
          </KeepAliveTabsPanel>
        ))}
      </KeepAliveTabs>
    </Card>
  );
}

export default TasksFlatTable;
