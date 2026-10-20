/* «Одоо хийж буй» нүд — `FlatTaskRow`, `GroupedTaskRow` (lg+) ба нэрийн доорх мобайл
 * хувилбар (lg-ээс доош).  Эзэн 2026-10-01: таск дээрх НЭР = албан таймер нь ОДОО явж
 * буй хүн.  2026-10-02: НЭР + ТӨЛӨВ + ЦАГ — хувь нэмэрчид (`ContributorsList`):
 *
 *   17.1  Б.Бат   ● ажиллаж байна   2.5/5   12:04.33
 *   17.2  Д.Нар   түр зогссон       0.5/5   1:05 ц
 *
 *   • хүн бүр ЗӨВХӨН бодит нотолгоотой (хүчинтэй явц эсвэл тоологдсон цаг) — bookmark нотолгоо БИШ;
 *   • авч болох бол ▶ (дарвал таскийг авч цаг шууд эхэлнэ); өөр хүн ажиллаж буй таск дээр сервер хуваарилалтын
 *     засварлагч руу чиглүүлнэ (`taskLive.tsx` → `TakeFlowDialogs`);
 *   • би ажиллаж байвал ▶ нь ⏸ болно — дарвал зогсооно (`TaskTimerControl`);
 *   • 🔖 «Миний ажилд нэмэх» (0370) — «Миний ажлууд»-даа нэмнэ.  ЗӨВХӨН танд харагдана;
 *   • «Хуваарилах» (хэсэг) → `AllocationEditorDialog`: нэг таск, олон хуваарилалт (шинэ таск ҮҮСЭХГҮЙ).
 *   • «Хуваах» (✂, 0395) → `RootSplitDialog`: таскийг нэр + хувиар ЖИНХЭНЭ үндсэн таскууд болгоно (хуулах, Ctrl+Z,
 *     буцаах) — бусад бүх товчны БАРУУН талд НЭМЭЛТ товч (эзэн 2026-10-09: ▶, 🔖, 👥, ⋯ бүгд хэвээр).
 * Өгөгдөл бүгд `TaskLiveContext`-оос. */
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookmarkCheck, BookmarkPlus, Loader2, Split, Timer, Users } from 'lucide-react';

import { Button } from '@/ui/button';
import { TableCell } from '@/ui/table';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import StopwatchText from '@/features/task-timer/StopwatchText';
import TaskTimerControl from '@/features/task-timer/TaskTimerControl';
import { CONTRIBUTORS_PREFIX } from '@/features/task-allocation/api';
import { ContributorsList } from '@/features/task-allocation/ContributorsList';
import { ManagedRowActions } from '@/features/task-allocation/ManagedRowActions';
import { OwnProgressControl } from '@/features/task-allocation/OwnProgressControl';
import type { ContributorRow } from '@/features/task-allocation/types';
import type { OwnBase } from '@/features/task-allocation/ownProgress';

import { useTaskLive } from './taskLiveContext';
import type { FlatTask } from './types';

/** 🔖 «Миний ажилд нэмэх» ↔ «Миний ажлууд»-д байгаа (дарвал хасна).  Таск авах эрхтэй,
 *  дуусаагүй таскт л.  Хэнд ч харагдахгүй — зөвхөн өөрийн «Миний ажлууд». */
function MyListButton({ task }: { task: FlatTask }) {
  const { t } = useLanguage();
  const live = useTaskLive();
  if (!live?.canUseMyList || task.progress >= 100) return null;
  const on = live.inMyList(task.id);
  const busy = live.isListBusy(task.id);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn(
        'h-7 w-7 pointer-coarse:h-9 pointer-coarse:w-9 flex-shrink-0 p-0 has-[>svg]:px-0',
        on
          ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
          : 'text-muted-foreground hover:text-foreground',
      )}
      title={on ? t('myTaskList.inListTitle') : t('myTaskList.addTitle')}
      aria-label={on ? t('myTaskList.inList') : t('myTaskList.add')}
      aria-pressed={on}
      disabled={busy}
      data-testid={on ? 'task-mylist-remove' : 'task-mylist-add'}
      onClick={(e) => {
        e.stopPropagation();
        live.toggleMyList(task);
      }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : on ? (
        <BookmarkCheck className="h-3.5 w-3.5" />
      ) : (
        <BookmarkPlus className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

/** «Хуваарилах» — таскийг хэсэг болгож хүн бүрт хуваарилна (шинэ таск ҮҮСЭХГҮЙ).  Нүдэнд л (lg+) ба мобайл мөрөнд. */
function AllocationButton({ task }: { task: FlatTask }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const live = useTaskLive();
  if (!live) return null;
  if (live.hoursMode || !(task.weight_percent > 0)) return null;
  if (!live.canTake && !live.isManager) return null;
  // Хуваарилагдсан таскийг ЗӨВХӨН оролцогч эсвэл ахлах/админ засна (сервер дахин шалгана).
  const managed = live.managedByTask.has(task.id);
  const myRow = (live.contributorsByTask.get(task.id) ?? []).find(
    (r) => r.user_id === live.currentUserId && r.ordinal !== null,
  );
  if (managed && !live.isManager && !myRow) return null;
  // Хуваарилагдсан таск (оролцогч эсвэл ахлах/админ) → ⋯ цэс (эзэн 2026-10-06): хуваасны дараа буруу гэж үзвэл ЭНДЭЭС — үндсэн
  // (root) таскаас — хуваарилалтаа дахин засах, ирээдүйн ажлаа буцаах, хуваалтыг бүхэлд нь цуцлах (анхны байдалд),
  // өөрийн бүртгэлээ (хувь) нэмж засах/сэргээх.  Дууссан (100%) таскийг ч цуцалж болно.
  if (managed) {
    return (
      <ManagedRowActions
        task={{ id: task.id, name: task.name }}
        canRelease={!!myRow && Math.max(0, (myRow.target_units ?? 0) - (myRow.done_units ?? 0)) > 0}
        canEdit={task.progress < 100}
        canUnsplit
        canRecords={!!myRow}
        onChanged={() => void qc.invalidateQueries({ queryKey: CONTRIBUTORS_PREFIX })}
      />
    );
  }
  if (task.progress >= 100) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 w-6 pointer-coarse:h-9 pointer-coarse:w-9 flex-shrink-0 p-0 has-[>svg]:px-0 text-muted-foreground hover:text-foreground"
      title={t('taskAlloc.button.title')}
      aria-label={t('taskAlloc.button.label')}
      data-testid="task-allocate"
      onClick={(e) => {
        e.stopPropagation();
        live.openAllocation(task);
      }}
    >
      <Users className="h-3.5 w-3.5" />
    </Button>
  );
}

/** «Хуваах» (✂) — таскийг нэр + хувиар үндсэн таскууд болгох (0395), өмнөх хуваалтыг буцаах.  Ажилтан бүрд (сервер дахин
 *  шалгана).  Бусад товчийг ОРЛОХГҮЙ — тэдний баруун талд нэмэгдэнэ. */
function RootSplitButton({ task }: { task: FlatTask }) {
  const { t } = useLanguage();
  const live = useTaskLive();
  if (!live) return null;
  if (live.hoursMode || !(task.weight_percent > 0) || task.progress >= 100) return null;
  if (!live.canTake && !live.isManager) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 w-6 pointer-coarse:h-9 pointer-coarse:w-9 flex-shrink-0 p-0 has-[>svg]:px-0 text-muted-foreground hover:text-foreground"
      title={t('taskAlloc.rootSplit.button.title')}
      aria-label={t('taskAlloc.rootSplit.button.label')}
      data-testid="task-root-split"
      onClick={(e) => {
        e.stopPropagation();
        live.openRootSplit(task);
      }}
    >
      <Split className="h-3.5 w-3.5" />
    </Button>
  );
}

/** Өөрийн явцын удирдлага (−/+ , 5 сек хадгалалт) — зөвхөн надад хуваарилагдсан ирээдүйн ажил байвал.  Нэрийн нүдэнд. */
export function TaskOwnProgress({ task, className = 'mt-1' }: { task: FlatTask; className?: string }) {
  const live = useTaskLive();
  const me = live?.currentUserId ?? null;
  const mine = live?.contributorsByTask.get(task.id)?.find((r) => r.user_id === me) ?? null;
  const managed = live?.managedByTask.get(task.id) ?? null;
  const revision = managed?.revision ?? 0;
  const rootDone = managed?.root_done_units ?? 0;
  const done = mine?.done_units ?? 0;
  const floor = mine?.floor_units ?? 0;
  const target = mine?.target_units ?? 0;
  const has = me !== null && managed !== null && mine !== null && target > 0 && (target > done || done > floor);
  const base = useMemo<OwnBase | null>(
    () => (has && me !== null ? { taskId: task.id, userId: me, revision, rootDone, done, floor, target } : null),
    [has, me, task.id, revision, rootDone, done, floor, target],
  );
  if (!live || !base || !live.canTake || live.hoursMode) return null;
  return (
    <OwnProgressControl
      base={base}
      questions={live.completionQuestions}
      taskName={task.name}
      compact
      className={className}
    />
  );
}

/** Хуваарилагдсан (root) таскийн НИЙТ албан цаг — бүх хувь нэмэрчийн дууссан цаг + одоо явж буй хүн бүрийн цаг
 *  (эзэн 2026-10-08: дэд мөрүүдэд хүн бүрийн цаг байхад үндсэн мөрөнд ямар ч цаг харагддаггүй байв).
 *  Тоо нь дэд мөрүүдийн pill-тэй ИЖИЛ эх сурвалжаас (`contributorsByTask`) — тусдаа тооцоо БИШ. */
function TaskTotalTime({ rows }: { rows: readonly ContributorRow[] }) {
  const { t } = useLanguage();
  const closed = rows.reduce((sum, r) => sum + (r.official_closed_ms ?? 0), 0);
  const starts = rows
    .map((r) => (r.running_since ? Date.parse(r.running_since) : NaN))
    .filter((v) => Number.isFinite(v));
  if (closed <= 0 && starts.length === 0) return null;
  const running = starts.length > 0;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-2.5 text-xs',
        running ? 'border-success/40 bg-success/10' : 'border-border bg-muted/40',
      )}
      title={t('taskAlloc.contrib.totalTimeTitle')}
      data-testid="task-total-time"
    >
      <Timer className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-[11px] text-muted-foreground">{t('taskAlloc.contrib.totalTime')}</span>
      <span className="border-l border-border/60 pl-1.5 text-[11px] text-foreground/80">
        <StopwatchText
          baseMs={closed}
          since={running ? starts : null}
          className={cn('font-semibold', running && 'text-success')}
          unitClassName="font-sans"
        />
      </span>
    </span>
  );
}

/** Мөрийн «Одоо хийж буй» агуулга — lg нүд ба мобайл хувилбар хоёулаа. */
export function TaskLiveContent({
  task,
  compact = false,
  showSplit = true,
}: {
  task: FlatTask;
  compact?: boolean;
  /** «Хуваарилах» товч (ажилчин + ахлах/админ; сервер дахин шалгана). */
  showSplit?: boolean;
}) {
  const { t } = useLanguage();
  const live = useTaskLive();
  if (!live) return null;
  // Хуваарилагдсан таск: хуваарилалттай хүн бүр ӨӨРИЙН дэд мөрөнд (26.1, 26.2 — `AllocationChildRows`) — үндсэн мөрөнд
  // зөвхөн хуваарилалтгүй хувь нэмэрчид (түүх) үлдэнэ, миний ▶/⏸ миний дэд мөрөнд.
  const managed = live.managedByTask.has(task.id);
  const allRows = live.contributorsByTask.get(task.id) ?? [];
  const allocatedIds = new Set(managed ? allRows.filter((r) => r.ordinal !== null).map((r) => r.user_id) : []);
  const iAmAllocated = live.currentUserId !== null && allocatedIds.has(live.currentUserId);
  const workers = (live.workersByTask.get(task.id) ?? []).filter((w) => !allocatedIds.has(w.user_id));
  const rows = managed ? allRows.filter((r) => r.ordinal === null) : allRows;
  const mineRunning = !iAmAllocated && live.timer.running?.task_id === task.id;
  const others = workers.filter((w) => w.user_id !== live.currentUserId);
  const done = task.progress >= 100;
  const splittable = task.weight_percent > 0 && !live.hoursMode;
  const canTakeHere = live.canTake && !done && !mineRunning && !iAmAllocated;
  const taking = live.takingId === task.id;
  const occupied = splittable && others.length > 0 && !live.managedByTask.has(task.id);
  // Хувь нэмэрчийн жагсаалтад миний мөр (цагтай) байвал ▶/⏸ нь зөвхөн дүрс — цаг жагсаалтад харагдана.
  const iAmListed = rows.some((r) => r.user_id === live.currentUserId);
  const hasList = rows.length > 0 || workers.length > 0;
  const hasTotal = managed && allRows.some((r) => r.official_closed_ms > 0 || r.running_since !== null);

  return (
    // lg+ нүд: [хүмүүсийн badge-ууд — зүүнээс баруун тийш, нүдний зүүн захаас] ........ [▶ 🔖 👥 — баруун талд].
    // Мобайл (compact, таскийн нэрийн доор): нарийн тул badge-ууд дээр, товчнууд доор.
    <div
      className={cn('flex min-w-0 gap-2', compact ? 'flex-col gap-1.5' : 'flex-row items-center')}
      data-task-live={task.id}
    >
      {(hasList || hasTotal) && (
        <div className="flex min-w-0 flex-1 flex-row flex-wrap items-center gap-1.5">
          {hasTotal && <TaskTotalTime rows={allRows} />}
          {hasList && (
            <ContributorsList
              taskId={task.id}
              taskNumber={task.number}
              rows={rows}
              running={workers}
              currentUserId={live.currentUserId}
              onStop={live.canAdminStop ? (w) => live.adminStop(task, w) : undefined}
              compact={compact}
            />
          )}
        </div>
      )}
      <div className={cn('flex min-w-0 items-center gap-2', !compact && 'ml-auto shrink-0')}>
        {(mineRunning || canTakeHere) && (
          <span className="flex-shrink-0" data-testid={canTakeHere ? (occupied ? 'task-take-split' : 'task-take') : undefined}>
            <TaskTimerControl
              timer={live.timer}
              taskId={task.id}
              taskName={task.name}
              canRun={canTakeHere}
              size="sm"
              showClosed={false}
              iconOnly={iAmListed}
              onStart={() => live.take(task)}
              busy={taking}
              disabled={live.takingId !== null}
              startTitle={occupied ? t('taskLive.takeSplitTitle') : t('taskLive.takeTitle')}
            />
          </span>
        )}
        {!hasList && !hasTotal && !mineRunning && !canTakeHere && <span className="text-xs text-muted-foreground/60">—</span>}
        <MyListButton task={task} />
        {showSplit && <AllocationButton task={task} />}
        {showSplit && <RootSplitButton task={task} />}
      </div>
    </div>
  );
}

/** Хүснэгтийн нүд (lg+). */
export function TaskLiveCell({ task, showSplit }: { task: FlatTask; showSplit: boolean }) {
  return (
    <TableCell className="hidden lg:table-cell overflow-hidden align-middle">
      <TaskLiveContent task={task} showSplit={showSplit} />
    </TableCell>
  );
}

/** Блокийн цонхны мөрүүд — зөвхөн нэр (үйлдэлгүй): хувь нэмэрчид, байхгүй бол одоо ажиллаж буй хүмүүс. */
export function TaskWorkersStack({ taskId, compact }: { taskId: number; compact?: boolean }) {
  const live = useTaskLive();
  const rows = live?.contributorsByTask.get(taskId) ?? [];
  const workers = live?.workersByTask.get(taskId) ?? [];
  if (rows.length === 0 && workers.length === 0) return <span className="text-xs text-muted-foreground/60">—</span>;
  return (
    <ContributorsList
      taskId={taskId}
      taskNumber={0}
      rows={rows.map((r) => ({ ...r, ordinal: null }))}
      running={workers}
      currentUserId={live?.currentUserId ?? null}
      compact={compact}
    />
  );
}

export default TaskLiveCell;
