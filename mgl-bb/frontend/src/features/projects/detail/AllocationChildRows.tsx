/* Хуваарилагдсан («managed») таскийн хүн бүрийн ДЭД МӨР — 26.1, 26.2 … (эзэн 2026-10-06).
 *
 *   26    Нүүр талууд                                                              ▬▬▬▬▬▬     58%   ← үндсэн (root) мөр
 *   26.1  ↳ Нүүр талууд  И.Хангай 10:12                                            ▬▬▬▬     50/80
 *   26.2  ↳ Нүүр талууд  test ● 00:53 [⏸]   [− 8 / 20 +][10%|1%][+12][Хадгалах]   ▬▬       8/20  ← миний мөр
 *   27    Фасад хэрэгсэл                                                                       ← дараагийн дугаар ХӨДЛӨХГҮЙ
 *
 * Шинэ таск ҮҮСЭХГҮЙ — зөвхөн харагдац: нэг үндсэн ажил, хүн бүрийн хуваарилалт (`task_allocations`) нь мөр болно.
 * Дугаар = `childLabel(task.number, ordinal)` (бүтцийн тогтвортой дугаар + хуваарилалтын дараалал).
 * Явц = тухайн хүний хийсэн / зорилт (үндсэн ажлын хувиар), дотоод жин ХЭЗЭЭ Ч харагдахгүй.
 *
 * Миний мөрөнд хувь оруулах удирдлага явцын bar-ын ЯГ ЗҮҮН талд (lg); хадгалаагүй ноорог энэ мөрийн БА үндсэн мөрийн
 * bar-ыг урьдчилан хөдөлгөнө (`useOwnDraftPreview`), хувь зөвхөн «Хадгалах» дарсны дараа бодогдоно (2026-10-06).
 *
 * Хүнгүй хэсэг (0394) ч ИЖИЛ дугаарлалтаар мөр болно: «26.3 ↳ суурь · Хүнгүй [✂ Таск болгох] · 0/40».  2026-10-09-ний
 * оройноос хэсгийг ▶-оор авдаггүй (нэг хүнд хоёр хэсэг «A · B» нийлж нэг цаг явдаг байв) — ✂ цонх хэсгүүдийг ЖИНХЭНЭ
 * үндсэн таскууд болгоно (`RootSplitDialog`, 0395). */
import { CornerDownRight, Split } from 'lucide-react';

import { Button } from '@/ui/button';
import { Progress } from '@/ui/progress';
import { TableCell, TableRow } from '@/ui/table';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import TaskTimerControl from '@/features/task-timer/TaskTimerControl';
import { ContributorsList } from '@/features/task-allocation/ContributorsList';
import { childLabel } from '@/features/task-allocation/allocation';
import { CONTRIBUTORS_PREFIX, putPartLabel } from '@/features/task-allocation/api';
import { queryClient } from '@/shared/api/queryClient';
import { useOwnDraftPreview } from '@/features/task-allocation/ownProgressStore';
import type { ContributorRow, PartView } from '@/features/task-allocation/types';
import { formatUnits } from '@/features/task-allocation/units';

import { AllocationLabelEditor } from './AllocationLabelEditor';
import { TaskOwnProgress } from './TaskLiveCell';
import { useTaskLive } from './taskLiveContext';
import type { FlatTask } from './types';

/** Хуваарилагдсан таскийн дэд мөрүүдэд орох хүмүүс (дараалал = хуваарилалтын дугаар). */
function allocationRowsOf(rows: readonly ContributorRow[] | undefined): ContributorRow[] {
  return (rows ?? [])
    .filter((r) => r.ordinal !== null)
    .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
}

/** Нэг хүний хэсэг: нэр + цаг (pill), өөрийн мөрөнд ▶/⏸; `withControl` бол баруун захад хувь оруулах удирдлага. */
function ChildLive({ task, row, withControl = false }: { task: FlatTask; row: ContributorRow; withControl?: boolean }) {
  const { t } = useLanguage();
  const live = useTaskLive();
  if (!live) return null;
  const mine = row.user_id === live.currentUserId;
  const workers = (live.workersByTask.get(task.id) ?? []).filter((w) => w.user_id === row.user_id);
  const future = Math.max(0, (row.target_units ?? 0) - (row.done_units ?? 0));
  const mineRunning = live.timer.running?.task_id === task.id;
  const canRun = mine && live.canTake && task.progress < 100 && future > 0 && !mineRunning;
  return (
    <div className="flex min-w-0 flex-row items-center gap-2">
      <div className="min-w-0 shrink">
        <ContributorsList
          taskId={task.id}
          taskNumber={task.number}
          // Дугаар нь мөрийн эхэнд (26.1) — pill дотор давтахгүй.
          rows={[{ ...row, ordinal: null }]}
          running={workers}
          currentUserId={live.currentUserId}
          onStop={live.canAdminStop && !mine ? (w) => live.adminStop(task, w) : undefined}
        />
      </div>
      {mine && (mineRunning || canRun) && (
        <span className="shrink-0" data-testid="alloc-child-timer">
          <TaskTimerControl
            timer={live.timer}
            taskId={task.id}
            taskName={task.name}
            canRun={canRun}
            size="sm"
            showClosed={false}
            iconOnly
            onStart={() => live.take(task)}
            busy={live.takingId === task.id}
            disabled={live.takingId !== null}
            startTitle={t('taskLive.takeTitle')}
          />
        </span>
      )}
      {mine && withControl && <TaskOwnProgress task={task} className="ml-auto shrink-0" />}
    </div>
  );
}

/** Тухайн хүний явц (хийсэн / зорилт); миний мөрөнд хадгалаагүй ноорог урьдчилан (шар) харагдана. */
function ChildProgress({ task, row, mine }: { task: FlatTask; row: ContributorRow; mine: boolean }) {
  const { t } = useLanguage();
  const preview = useOwnDraftPreview(mine ? task.id : 0);
  const target = row.target_units ?? 0;
  const done = preview ? preview.desired : (row.done_units ?? 0);
  const pct = target > 0 ? Math.min(100, (done / target) * 100) : 0;
  return (
    <div
      className="flex items-center gap-1"
      title={preview ? t('taskAlloc.own.unsavedTitle') : `${formatUnits(done)} / ${formatUnits(target)}%`}
      data-testid="alloc-child-progress"
      data-preview={preview ? 'true' : undefined}
    >
      <Progress
        value={pct}
        className="h-1.5 flex-1 opacity-80"
        indicatorClassName={preview ? 'bg-warning transition-all' : 'transition-all'}
      />
      <span
        className={cn(
          'w-14 text-right text-[11px] tabular-nums',
          preview
            ? 'font-semibold text-warning'
            : target > 0 && done >= target
              ? 'text-emerald-500'
              : 'text-muted-foreground',
        )}
      >
        {formatUnits(done)}/{formatUnits(target)}
      </span>
    </div>
  );
}

/** Нэрийн нүд: «↳ Нүүр талууд»; мобайлд (lg-ээс доош) хүн + ▶ + миний удирдлага нэрийн доор. */
function ChildName({ task, row, canEdit, mine }: { task: FlatTask; row: ContributorRow; canEdit: boolean; mine: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 pl-4">
      <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
      <div className="min-w-0 flex-1">
        <AllocationLabelEditor
          taskId={task.id}
          userId={row.user_id}
          label={row.label}
          fallback={task.name}
          canEdit={canEdit}
        />
        <div className="mt-1 lg:hidden">
          <ChildLive task={task} row={row} />
          {mine && <TaskOwnProgress task={task} />}
        </div>
      </div>
    </div>
  );
}

/** Хүнгүй хэсгийн «Одоо хийж буй»: «Хүнгүй» + ✂ «Таск болгох» (хэсгүүдийг үндсэн таскууд болгоно, 0395). */
function PartLive({ task }: { task: FlatTask }) {
  const { t } = useLanguage();
  const live = useTaskLive();
  if (!live) return null;
  const canSplit = (live.canTake || live.isManager) && task.progress < 100;
  return (
    <div className="flex min-w-0 flex-row items-center gap-2">
      <span
        className="inline-flex shrink-0 items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground"
        data-testid="part-unassigned"
      >
        {t('taskAlloc.parts.unassigned')}
      </span>
      {canSplit && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          title={t('taskAlloc.rootSplit.fromPartsTitle')}
          onClick={(e) => {
            e.stopPropagation();
            live.openRootSplit(task);
          }}
          data-testid="part-to-tasks"
        >
          <Split className="h-3 w-3" />
          {t('taskAlloc.rootSplit.fromPartsButton')}
        </Button>
      )}
    </div>
  );
}

/** Хүнгүй хэсгийн мөр — хүний мөртэй ИЖИЛ баганын бүтэц. */
function PartRow({ task, part, variant, isAdmin }: { task: FlatTask; part: PartView; variant: 'grouped' | 'flat'; isAdmin: boolean }) {
  const live = useTaskLive();
  return (
    <TableRow className="group bg-muted/10 hover:bg-muted/25" data-task-id={task.id} data-part-id={part.part_id} data-testid="part-row">
      <TableCell className="text-center text-[11px] tabular-nums text-muted-foreground" data-testid="task-number">
        {childLabel(task.number, part.ordinal)}
      </TableCell>
      {variant === 'flat' && (
        <>
          <TableCell />
          <TableCell className="hidden md:table-cell" />
        </>
      )}
      <TableCell className="overflow-hidden align-top">
        <div className="flex min-w-0 items-start gap-1.5 pl-4">
          <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
          <div className="min-w-0 flex-1">
            <AllocationLabelEditor
              taskId={task.id}
              userId={0}
              label={part.label}
              fallback={part.label}
              canEdit={!!live && (live.canTake || live.isManager)}
              save={async (label) => {
                await putPartLabel(task.id, part.part_id, label);
                await queryClient.invalidateQueries({ queryKey: [...CONTRIBUTORS_PREFIX] });
              }}
            />
            <div className="mt-1 lg:hidden">
              <PartLive task={task} />
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden lg:table-cell overflow-hidden align-middle">
        <PartLive task={task} />
      </TableCell>
      <TableCell className={cn(variant === 'grouped' && 'px-0.5')} colSpan={variant === 'grouped' ? 3 : isAdmin ? 2 : 1}>
        <div className="flex items-center gap-1" data-testid="part-progress">
          <Progress value={0} className="h-1.5 flex-1 opacity-50" />
          <span className="w-14 text-right text-[11px] tabular-nums text-muted-foreground">0/{formatUnits(part.units)}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Үндсэн мөрийн ДООР хүн бүрийн мөр.  `variant` нь хүснэгтийн баганын бүтэц:
 *   grouped — # · Ажил · Одоо хийж буй (lg) · [Зураг % · Төсөл % (admin)] · Явц  → дэд мөрөнд жин байхгүй тул Явц colSpan 3
 *   flat    — # · Зураг · Бүрдэл (md) · Ажил · Одоо хийж буй (lg) · [Нийт % (admin)] · Явц → admin бол Явц colSpan 2
 */
export function AllocationChildRows({
  task,
  variant,
  isAdmin,
}: {
  task: FlatTask;
  variant: 'grouped' | 'flat';
  isAdmin: boolean;
}) {
  const live = useTaskLive();
  const managed = live?.managedByTask.get(task.id);
  if (!live || !managed) return null;
  const rows = allocationRowsOf(live.contributorsByTask.get(task.id));
  const parts = managed.parts ?? [];
  if (rows.length === 0 && parts.length === 0) return null;
  // Хүний мөр ба хүнгүй хэсэг НЭГ дугаарлалтаар (26.1, 26.2 …) холилдоно.
  const items = [
    ...rows.map((row) => ({ ordinal: row.ordinal ?? 0, row, part: null as PartView | null })),
    ...parts.map((part) => ({ ordinal: part.ordinal, row: null as ContributorRow | null, part })),
  ].sort((a, b) => a.ordinal - b.ordinal);
  return (
    <>
      {items.map(({ row, part }) => {
        if (part) return <PartRow key={`part-${part.part_id}`} task={task} part={part} variant={variant} isAdmin={isAdmin} />;
        if (!row) return null;
        const mine = row.user_id === live.currentUserId;
        return (
          <TableRow
            key={row.user_id}
            className={cn('group bg-muted/15 hover:bg-muted/30', mine && 'bg-primary/5')}
            data-task-id={task.id}
            data-alloc-user={row.user_id}
            data-testid="alloc-child-row"
          >
            <TableCell className="text-center text-[11px] tabular-nums text-muted-foreground" data-testid="task-number">
              {childLabel(task.number, row.ordinal ?? 0)}
            </TableCell>
            {variant === 'flat' && (
              <>
                <TableCell />
                <TableCell className="hidden md:table-cell" />
              </>
            )}
            <TableCell className="overflow-hidden align-top">
              {/* 2026-10-08 (эзний 2 дахь шийдвэр): энэ хуудсыг хардаг ажилтан (admin/senior/engineer/architect)
                  ХЭН Ч ЭНД хэнийг ч нэрлэж болно — зөвхөн өөрийн мөр биш. Сервер STAFF-аас гадуурхыг (worker/client) 403. */}
              <ChildName task={task} row={row} canEdit mine={mine} />
            </TableCell>
            <TableCell className="hidden lg:table-cell overflow-hidden align-middle">
              <ChildLive task={task} row={row} withControl />
            </TableCell>
            <TableCell
              className={cn(variant === 'grouped' && 'px-0.5')}
              colSpan={variant === 'grouped' ? 3 : isAdmin ? 2 : 1}
            >
              <ChildProgress task={task} row={row} mine={mine} />
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}

export default AllocationChildRows;
