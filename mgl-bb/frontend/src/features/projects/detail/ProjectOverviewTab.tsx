/** Overview tab: privacy-scope banner, team pill strip, the horizontal block
 *  card rail and the inline task table. Extracted verbatim from
 *  `ProjectDetailPage.tsx` when that file was split into per-component
 *  modules — no behavioural change. */
import { Layers3, Users2 } from 'lucide-react';

import type { ProjectDetailResponse, RepairHoursSummary } from '@/shared/types';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { TeamTabsStrip } from '@/shared/components/TeamTabsStrip';

import { BlockCard } from './BlockCard';
import { BLOCK_ACCENTS } from './constants';
import { EmptyState } from './atoms';
import { ProjectTasksSection } from './ProjectTasksSection';
import { RepairHoursCard } from './RepairHours';
import type { FlatTask, TaskRowProps } from './types';

export function ProjectOverviewTab({
  id,
  data,
  blockTeamIds,
  isProjectAdmin,
  canManageProjectWork,
  isScopedUser,
  scopeTeamCode,
  scopeTeamCodes,
  teamNameMn,
  allTasks,
  flatTasks,
  displayTasks,
  myTaskCount,
  mineOnly,
  onMineOnlyChange,
  counts,
  selectedBlockId,
  onSelectBlock,
  onClearBlock,
  activeTeamId,
  onTeamChange,
  showAllTeams,
  onShowAllTeams,
  tasksRef,
  repairHours,
  repairHoursLoading = false,
  ...actions
}: {
  id: string | undefined;
  data: ProjectDetailResponse;
  blockTeamIds: number[];
  /** Strict `admin` role — drives the "no blocks yet" copy. Deliberately
   *  distinct from `TaskActionProps.isAdmin`, which carries the wider
   *  `canManageProjectWork` (admin + senior) gate used by the task rows. */
  isProjectAdmin: boolean;
  canManageProjectWork: boolean;
  isScopedUser: boolean;
  scopeTeamCode: string | null;
  scopeTeamCodes: Set<string> | null;
  teamNameMn: string | null | undefined;
  allTasks: FlatTask[];
  flatTasks: FlatTask[];
  displayTasks: FlatTask[];
  /** Надад хуваарилагдсан таскийн тоо ба «Зөвхөн миний» шүүлтийн төлөв
   *  (`?mine=1` — «Миний ажлууд»-ын төслийн нэрээс орно). */
  myTaskCount: number;
  mineOnly: boolean;
  onMineOnlyChange: (on: boolean) => void;
  counts: { completed: number; inProgress: number; notStarted: number };
  selectedBlockId: number | null;
  onSelectBlock: (blockId: number) => void;
  onClearBlock: () => void;
  activeTeamId: number | null;
  onTeamChange: (teamId: number | null) => void;
  showAllTeams: boolean;
  onShowAllTeams: () => void;
  tasksRef: React.RefObject<HTMLDivElement | null>;
  /** Цагаар бодогддог засварын төслийн «хэн хэдэн цаг» (2026-09-24). */
  repairHours?: RepairHoursSummary;
  repairHoursLoading?: boolean;
} & TaskRowProps) {
  const { t } = useLanguage();
  const { blocks } = data;
  const teamShares = data.team_shares ?? [];

  // Багт оноогдоогүй (team_id NULL) блок ямар ч pill-д хамаарахгүй тул
  // pill сонгосон ч ҮРГЭЛЖ харагдана — эс тэгвэл тэр блок хаанаас ч олдохгүй
  // («заримдаа блок харагдахгүй» гомдол, 2026-09-17).
  const visibleBlocks =
    activeTeamId != null
      ? blocks.filter((b) => b.team_id === activeTeamId || b.team_id == null)
      : blocks;

  const selectedBlockIndex = selectedBlockId
    ? visibleBlocks.findIndex((b) => b.id === selectedBlockId)
    : -1;
  const selectedBlockAccent =
    selectedBlockIndex >= 0 ? BLOCK_ACCENTS[selectedBlockIndex % BLOCK_ACCENTS.length] : null;

  return (
    <>
      {/* Privacy scope banner — explains to staff why they only see part
          of the project so they don't think tasks are missing. */}
      {isScopedUser && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm flex items-center gap-3">
          <Users2 className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <div className="font-medium text-foreground">
              {t('projectDetailPage.yourTeam')}{' '}
              <span className="text-primary">{teamNameMn ?? scopeTeamCode}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t('projectDetailPage.scopeBanner', {
                team: scopeTeamCode ?? '',
                shown: flatTasks.length,
                total: allTasks.length,
              })}
            </div>
          </div>
        </div>
      )}

      {/* Цагаар бодогддог засварын төсөл: явцын хувийн оронд АЖИЛЛАСАН ЦАГ —
          «А — 3 цаг, Б — 5 цаг» (2026-09-24).  Блокгүй ч харагдана. */}
      {actions.hoursMode && <RepairHoursCard summary={repairHours} loading={repairHoursLoading} />}

      {blocks.length === 0 ? (
        <EmptyState
          icon={<Layers3 className="w-10 h-10" />}
          title={t('projectDetailPage.noBlocksTitle')}
          description={
            isProjectAdmin
              ? t('projectDetailPage.noBlocksAdmin')
              : t('projectDetailPage.noBlocksStaff')
          }
        />
      ) : (
        <>
          {/* Team-tab strip — each pill filters the block-cards
              row below by team. The strip itself is the shared
              TeamTabsStrip used everywhere else in the app; we
              just translate between team_id (the page's state
              shape) and team_code (the strip's vocabulary) at
              the boundary. */}
          {blockTeamIds.length > 0 && (
            <TeamTabsStrip
              sliding
              className="-mt-1"
              active={
                activeTeamId == null
                  ? null
                  : (teamShares.find((s) => s.team_id === activeTeamId)?.team_code ?? null)
              }
              onChange={(code) => {
                const ts = code ? teamShares.find((s) => s.team_code === code) : null;
                onTeamChange(ts?.team_id ?? null);
              }}
              teams={blockTeamIds.map((tid) => {
                const ts = teamShares.find((s) => s.team_id === tid);
                return {
                  code: ts?.team_code ?? `?${tid}`,
                  name: ts?.team_name_mn ?? t('projectDetailPage.teamFallback', { id: tid }),
                  count: blocks.filter((b) => b.team_id === tid).length,
                };
              })}
              trailing={
                <button
                  type="button"
                  aria-pressed={showAllTeams}
                  onClick={onShowAllTeams}
                  title={t('projectDetailPage.showAllTeamsTasks')}
                  className="ml-auto flex-none inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-background/40 px-2 py-1 transition-colors hover:bg-muted/60 aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary"
                >
                  <span className="px-0.5 text-[11px] font-semibold">
                    {t('projectDetailPage.allTeams')}
                  </span>
                  <span
                    className={cn(
                      'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums',
                      showAllTeams ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {flatTasks.length}
                  </span>
                </button>
              }
            />
          )}

          {/* Block cards — horizontal scroll lane.  Compact fixed-width
              cards line up on a single row and snap as you swipe.  The
              edges fade out so users notice there's more content
              off-screen, and a thin native scrollbar lives on the
              bottom for desktop drag/scroll wheel use. */}
          <div className="-mx-2 px-2 overflow-x-auto pb-2 snap-x snap-mandatory scroll-px-2 [scrollbar-width:thin]">
            <div className="flex gap-3 min-w-min">
              {visibleBlocks.map((block, idx) => (
                <BlockCard
                  key={block.id}
                  block={block}
                  index={idx}
                  selected={selectedBlockId === block.id}
                  onSelect={onSelectBlock}
                  projectId={id ?? ''}
                  canManage={canManageProjectWork}
                  hoursMode={actions.hoursMode}
                  taskHours={actions.taskHours}
                />
              ))}
            </div>
          </div>

          {/* Inline tasks table — gives a quick actionable list right on
              the landing tab without forcing a tab switch. Scoped per
              user via flatTasks. */}
          {flatTasks.length > 0 && (
            <ProjectTasksSection
              tasksRef={tasksRef}
              blocks={blocks}
              displayTasks={displayTasks}
              myTaskCount={myTaskCount}
              mineOnly={mineOnly}
              onMineOnlyChange={onMineOnlyChange}
              counts={counts}
              selectedBlockId={selectedBlockId}
              selectedBlockAccent={selectedBlockAccent}
              onClearBlock={onClearBlock}
              isScopedUser={isScopedUser}
              scopeTeamCodes={scopeTeamCodes}
              {...actions}
            />
          )}
        </>
      )}
    </>
  );
}

export default ProjectOverviewTab;
