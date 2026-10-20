/** The flat sortable data grid rendered under the "Бүгд" tab.
 *  Extracted from `ProjectDetailPage.tsx` (`TasksFlatTable`'s `renderTable`)
 *  when that file was split into per-component modules — no behavioural
 *  change. */
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import { FlatTaskRow } from './FlatTaskRow';
import type { FlatTask, TaskRowProps } from './types';
import { sortTasks, type SortKey, type SortSpec } from './useTaskGridPrefs';
import { useTaskLive } from './taskLiveContext';

/* New design: a flat sortable data grid (no nested tier rows, no
   collapse). Each task is one row; the drawing/component context lives
   inline as compact cells so admins can scan a project at a glance. The
   "Бүгд" tab adds the discipline pill column; per-discipline tabs hide
   it since it would be redundant. */
export function FlatTasksGrid({
  list,
  tabKey,
  sort,
  onCycleSort,
  onAjilResize,
  tableStyle,
  emptyMessage,
  actions,
}: {
  list: FlatTask[];
  tabKey: string;
  sort: SortSpec;
  onCycleSort: (tabKey: string, key: SortKey) => void;
  onAjilResize: (e: React.PointerEvent<HTMLDivElement>) => void;
  tableStyle: React.CSSProperties;
  emptyMessage: string;
  actions: TaskRowProps;
}) {
  const { t } = useLanguage();
  const showDisciplineCol = tabKey === 'all';
  // Дотоод жин («Нийт %») — ЗӨВХӨН админ/ахлахад (2026-10-02).
  const showWeights = actions.isAdmin;
  const live = useTaskLive();
  const sorted = sortTasks(list, sort, (id) => live?.workersByTask.get(id)?.[0]?.full_name ?? '');

  const SortHeader = ({
    label,
    sortKey,
    className,
    style,
    title,
    align = 'left',
    resizable = false,
  }: {
    label: React.ReactNode;
    sortKey: SortKey;
    className?: string;
    style?: React.CSSProperties;
    title?: string;
    align?: 'left' | 'center' | 'right';
    /** When true, render a drag handle on the left edge that resizes
     *  the Хариуцагч column via the parent's `startAssigneeColResize`. */
    resizable?: boolean;
  }) => {
    const active = sort?.key === sortKey;
    const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <TableHead
        className={cn('text-[11px] uppercase tracking-wider', resizable && 'relative', className)}
        style={style}
      >
        {resizable && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('projectDetailPage.resizeAjilColumn')}
            onPointerDown={onAjilResize}
            title={t('projectDetailPage.resizeAjilHint')}
            className="group absolute top-0 left-0 -translate-x-1/2 h-full w-3 cursor-col-resize touch-none select-none z-10 flex items-center justify-center"
          >
            <div className="h-5 w-0.5 bg-primary/50 group-hover:bg-primary group-hover:w-1 group-active:bg-primary group-active:w-1 transition-all" />
          </div>
        )}
        <button
          type="button"
          onClick={() => onCycleSort(tabKey, sortKey)}
          title={title}
          className={cn(
            'inline-flex w-full items-center gap-1 select-none cursor-pointer hover:text-foreground transition-colors',
            align === 'center' && 'justify-center',
            align === 'right' && 'justify-end',
            active && 'text-foreground',
          )}
        >
          <span>{label}</span>
          <Icon className={cn('h-3 w-3 flex-shrink-0', !active && 'opacity-40')} />
        </button>
      </TableHead>
    );
  };

  /* Layout note (2026-04-24): the "Багц" pill column was dropped because
     the new compact "Зураг" cell already shows the team prefix (BA / BB
     / HAS …) and so the two columns were duplicating information. We
     also locked the table layout (`table-fixed`) and removed the
     horizontal scroll wrapper so the whole grid always fits in the card
     width — admins kept losing the right-hand "Явц" column behind a
     scroll fold. */
  return (
    <Table className="table-fixed w-full [&_td]:py-1 [&_th]:h-8" style={tableStyle}>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className="w-[40px] text-center text-[11px] uppercase tracking-wider text-muted-foreground">
            #
          </TableHead>
          <SortHeader
            label={t('projectDetailPage.colDrawing')}
            sortKey="drawing"
            className="w-[64px]"
            title={t('projectDetailPage.colDrawingTitle')}
          />
          <SortHeader
            label={t('projectDetailPage.colComponent')}
            sortKey="component"
            className="w-[18%] hidden md:table-cell"
            title={t('projectDetailPage.colComponentTitle')}
          />
          {/* lg+: «Ажил» = 380 + чирсэн нэмэлт; «Одоо хийж буй» = үлдсэн зай (badge-ууд таскийн нэрийн баруун талаас эхэлнэ). */}
          <SortHeader
            label={t('projectDetailPage.colTask')}
            sortKey="name"
            className="lg:w-[calc(380px+var(--ajil-extra-w,0px))]"
          />
          <SortHeader
            label={t('projectDetailPage.colAssignee')}
            sortKey="assignee"
            className="hidden lg:table-cell"
            resizable
          />
          {showWeights && (
            <SortHeader
              label={t('projectDetailPage.colTotalPct')}
              sortKey="projectShare"
              className="w-[72px]"
              align="center"
              title={t('projectDetailPage.colTotalPctTitle')}
            />
          )}
          <SortHeader
            label={t('projectDetailPage.colProgress')}
            sortKey="progress"
            className="w-[170px]"
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.length === 0 ? (
          <TableRow>
            <TableCell colSpan={showWeights ? 7 : 6} className="text-center text-sm text-muted-foreground py-8">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          sorted.map((task) => (
            <FlatTaskRow
              key={task.id}
              task={task}
              showDiscipline={showDisciplineCol}
              {...actions}
            />
          ))
        )}
      </TableBody>
    </Table>
  );
}

export default FlatTasksGrid;
