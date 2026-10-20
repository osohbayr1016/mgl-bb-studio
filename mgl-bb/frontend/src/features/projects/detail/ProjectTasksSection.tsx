/** Inline tasks table under the block rail — heading, status counts and the
 *  scoped `TasksFlatTable`. Extracted verbatim from `ProjectDetailPage.tsx`
 *  when that file was split into per-component modules — no behavioural
 *  change. */
import { FileText } from 'lucide-react';

import type { BlockProgress } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import { BLOCK_ACCENTS } from './constants';
import { TasksFlatTable } from './TasksFlatTable';
import type { FlatTask, TaskRowProps } from './types';

export function ProjectTasksSection({
  tasksRef,
  blocks,
  displayTasks,
  myTaskCount,
  mineOnly,
  onMineOnlyChange,
  counts,
  selectedBlockId,
  selectedBlockAccent,
  onClearBlock,
  isScopedUser,
  scopeTeamCodes,
  ...actions
}: {
  tasksRef: React.RefObject<HTMLDivElement | null>;
  blocks: BlockProgress[];
  displayTasks: FlatTask[];
  /** Надад хуваарилагдсан таскийн тоо — «Зөвхөн миний» товчны тоолуур. */
  myTaskCount: number;
  /** `?mine=1` — «Миний ажлууд»-ын төслийн нэрээс орсон шүүлт. */
  mineOnly: boolean;
  onMineOnlyChange: (on: boolean) => void;
  counts: { completed: number; inProgress: number; notStarted: number };
  selectedBlockId: number | null;
  selectedBlockAccent: (typeof BLOCK_ACCENTS)[number] | null;
  onClearBlock: () => void;
  isScopedUser: boolean;
  scopeTeamCodes: Set<string> | null;
} & TaskRowProps) {
  const { t } = useLanguage();
  return (
    <div ref={tasksRef} className="space-y-2 pt-2 scroll-mt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className={cn('w-4 h-4', selectedBlockAccent?.text ?? 'text-primary')} />
          <h3 className={cn('text-base font-semibold', selectedBlockAccent?.text)}>
            {selectedBlockId
              ? (blocks.find((b) => b.id === selectedBlockId)?.name ??
                t('projectDetailPage.block'))
              : isScopedUser || mineOnly
                ? t('projectDetailPage.myTasks')
                : t('projectDetailPage.allTasks')}
          </h3>
          {!selectedBlockId && (
            <Badge variant="outline" className="text-xs">
              {displayTasks.length}
            </Badge>
          )}
          {selectedBlockId && (
            <button
              type="button"
              onClick={onClearBlock}
              className={cn(
                'text-[11px] text-muted-foreground underline underline-offset-2',
                selectedBlockAccent?.text ?? 'hover:text-primary',
              )}
            >
              {t('projectDetailPage.showAll')}
            </button>
          )}
          {/* Бүгд / Зөвхөн миний — надад таск байхгүй төсөлд хэрэггүй тул
              нуугдана (`mineOnly` үед үлдэнэ: буцах зам хэрэгтэй). */}
          {(myTaskCount > 0 || mineOnly) && (
            <div
              role="group"
              aria-label={t('projectDetailPage.mineFilterLabel')}
              className="ml-1 inline-flex items-center rounded-md border border-border/40 bg-background/40 p-0.5"
            >
              <button
                type="button"
                aria-pressed={!mineOnly}
                onClick={() => onMineOnlyChange(false)}
                className="rounded px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary pointer-coarse:py-2"
              >
                {t('projectDetailPage.allTab')}
              </button>
              <button
                type="button"
                aria-pressed={mineOnly}
                onClick={() => onMineOnlyChange(true)}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary pointer-coarse:py-2"
              >
                {t('projectDetailPage.mineOnly')}
                <span className="tabular-nums text-[10px] opacity-70">{myTaskCount}</span>
              </button>
            </div>
          )}
        </div>
        {/* Дууссан / явагдаж буй / эхлээгүй нь ЯВЦЫН хувиас гардаг — цагаар
            бодогддог засварын төсөлд утгагүй тул нуугдана (2026-09-24). */}
        {!actions.hoursMode && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {counts.completed}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-primary" />
              {counts.inProgress}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
              {counts.notStarted}
            </span>
          </div>
        )}
      </div>
      <TasksFlatTable
        key={selectedBlockId ?? 'all'}
        tasks={displayTasks}
        isScopedUser={isScopedUser}
        scopeTeamCodes={scopeTeamCodes}
        // The team-pill filter + per-team block cards above
        // already scope the visible task set to one team,
        // so the discipline tab-strip would only ever show
        // one real tab on top of "Бүгд" — render the flat
        // table directly instead.
        hideTeamTabs
        emptyMessage={
          isScopedUser || mineOnly
            ? t('projectDetailPage.noAssignedTasks')
            : t('projectDetailPage.noTasksFound')
        }
        {...actions}
      />
    </div>
  );
}

export default ProjectTasksSection;
