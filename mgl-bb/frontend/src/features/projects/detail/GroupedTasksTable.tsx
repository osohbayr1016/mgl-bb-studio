/* ---------- GroupedTasksTable ----------
 * Per-discipline view: tasks are grouped Block › Drawing › Component
 * with section header rows, like the original hierarchical layout.
 *
 * Why a separate table from the flat "Бүгд" grid?
 *   - On the BA tab almost every row repeats the same block, drawing
 *     and component, which made the flat grid look noisy ("Шинэ блок",
 *     "Ерөнхий төлөвлөгөө" stamped on every row).  The user explicitly
 *     wanted the burdel as a heading once, with the ажилs listed under
 *     it.
 *   - We still want a tabular feel (consistent columns for assignee,
 *     weights, progress) so admins can scan a discipline at a glance.
 *
 * Headers collapse intelligently: a level only renders a heading when
 * its label actually changes between adjacent rows, and the
 * Component header is suppressed when the component name matches the
 * drawing (no extra hierarchy to show).
 *
 * Extracted from `ProjectDetailPage.tsx` when that file was split into
 * per-component modules — no behavioural change.
 */
import { Fragment, useMemo } from 'react';

import { Table, TableBody } from '@/ui/table';

import { BlockHeadingRow, ComponentHeadingRow, DrawingHeadingRow } from './GroupedSectionRows';
import { GroupedTasksHeader } from './GroupedTasksHeader';
import { GroupedTaskRow } from './GroupedTaskRow';
import { sumHoursOfTasks } from './taskHours';
import type { FlatTask, TaskRowProps } from './types';

// Stable bucketing: we walk the tasks in the original order (same
// order the project was authored in, which already matches the
// canonical Block › Drawing › Component sequence) and emit a header
// whenever the relevant key changes.
type Bucket = {
  block: string;
  drawing: string;
  component: string;
  tasks: FlatTask[];
};

export function GroupedTasksTable({
  list,
  emptyMessage,
  onAjilResize,
  ...actions
}: {
  list: FlatTask[];
  /** Drag handler from the parent TasksFlatTable — widens the Ажил
   *  column (via the shared --ajil-extra-w CSS variable) so the
   *  right-side columns slide rightward as a unit. The flat table
   *  and this grouped table share the same handler so both react in
   *  lockstep. */
  onAjilResize?: (e: React.PointerEvent<HTMLDivElement>) => void;
  emptyMessage: string;
} & TaskRowProps) {
  const grouped = useMemo(() => {
    const out: Bucket[] = [];
    for (const t of list) {
      const block = (t.block ?? '').trim() || '—';
      const drawing = (t.drawing ?? '').trim() || '—';
      const componentRaw = (t.component ?? '').trim();
      // Treat '—' / blank / drawing-name as "no separate component" — the
      // task lives directly under the drawing.
      const component =
        !componentRaw ||
        componentRaw === '—' ||
        componentRaw === '-' ||
        componentRaw.toLowerCase() === drawing.toLowerCase()
          ? ''
          : componentRaw;
      const last = out[out.length - 1];
      if (last && last.block === block && last.drawing === drawing && last.component === component) {
        last.tasks.push(t);
      } else {
        out.push({ block, drawing, component, tasks: [t] });
      }
    }
    return out;
  }, [list]);

  if (list.length === 0) {
    return <div className="text-center text-muted-foreground py-10 text-sm">{emptyMessage}</div>;
  }

  return (
    <Table
      className="table-fixed w-full min-w-[calc(100%+var(--ajil-extra-w,0px))] lg:min-w-[calc(44px+380px+var(--ajil-extra-w,0px)+320px+188px)] [&_td]:py-1 [&_th]:h-8"
    >
      {/* ХАТУУ өргөн (2026-10-05).  «Явц» нь 3 баганыг хамардаг (colSpan) тул өргөнгүй бол table-fixed үед илүү өргөнийг
          auto баганууд (3 нь явцынх) хуваан авч явцын bar 400px+ хүртэл сунадаг байв.
          lg+: # 44 | Ажил 380 + чирсэн нэмэлт (--ajil-extra-w) | Одоо хийж буй = ҮЛДСЭН ЗАЙ (≥320; badge-ууд таскийн нэрийн
          яг баруун талаас эхэлнэ, товчнууд нүдний баруун захад) | Явц 44+44+100 = 188 (анхны хэмжээ).
          «Одоо хийж буй» нь lg-ээс доош нуугддаг (col ч мөн). */}
      <colgroup>
        <col style={{ width: 44 }} />
        <col className="lg:w-[calc(380px+var(--ajil-extra-w,0px))]" />
        <col className="hidden lg:table-column" />
        <col style={{ width: 44 }} />
        <col style={{ width: 44 }} />
        <col style={{ width: 100 }} />
      </colgroup>
      <GroupedTasksHeader
        onAjilResize={onAjilResize}
        hoursMode={actions.hoursMode}
        showWeights={actions.isAdmin}
      />
      <TableBody>
        {grouped.map((g, gi) => {
          // Block header is shown only when the block changes between
          // adjacent groups — most BA tabs only have one block, so
          // 99% of the time this row appears just once at the top.
          const prev = grouped[gi - 1];
          const showBlock = !prev || prev.block !== g.block;
          const showDrawing = showBlock || prev.drawing !== g.drawing;
          // Component header always renders (it's the heading the user
          // explicitly asked for) — except when the component slot is
          // empty (task hangs directly off the drawing).
          const showComponent = !!g.component;

          // Aggregates for the header so the user can tell how big
          // each бүрдэл is at a glance.  The "Зураг %" column is
          // drawing-relative (matches the editor on Setup), so the
          // Σ for it sums drawingShare.  "Төсөл %" stays in absolute
          // project-share units.  Weighted-average progress is keyed
          // off leafWeight (the underlying mass) so it stays correct
          // even when drawing weights are 0.
          const sumDrawing = g.tasks.reduce((s, t) => s + Math.max(0, t.drawingShare), 0);
          const sumProj = g.tasks.reduce((s, t) => s + Math.max(0, t.projectShare), 0);
          const sumLeaf = g.tasks.reduce((s, t) => s + Math.max(0, t.leafWeight), 0);
          const wAvgProgress =
            sumLeaf > 0
              ? g.tasks.reduce((s, t) => s + t.progress * Math.max(0, t.leafWeight), 0) / sumLeaf
              : g.tasks.length > 0
                ? g.tasks.reduce((s, t) => s + t.progress, 0) / g.tasks.length
                : 0;

          return (
            <Fragment key={`${g.block}|${g.drawing}|${g.component}|${gi}`}>
              {showBlock && <BlockHeadingRow label={g.block} />}
              {showDrawing && <DrawingHeadingRow label={g.drawing} />}
              {showComponent && (
                <ComponentHeadingRow
                  label={g.component}
                  taskCount={g.tasks.length}
                  sumDrawing={sumDrawing}
                  sumProj={sumProj}
                  wAvgProgress={wAvgProgress}
                  showWeights={actions.isAdmin}
                  sumHours={
                    actions.hoursMode
                      ? sumHoursOfTasks(
                          g.tasks.map((t) => t.id),
                          actions.taskHours,
                        )
                      : undefined
                  }
                />
              )}
              {g.tasks.map((task) => (
                <GroupedTaskRow key={task.id} task={task} {...actions} />
              ))}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default GroupedTasksTable;
