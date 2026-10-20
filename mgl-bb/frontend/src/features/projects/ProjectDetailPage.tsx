import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { ErrorState } from '@/shared/components/ErrorState';
import { useApiQuery } from '@/shared/api/useApi';
import type { RepairHoursSummary } from '@/shared/types';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';

// The page's own building blocks. `ProjectDetailPage` used to be one
// ~5 000-line module; it was split into `features/projects/detail/*` with the
// markup and logic moved verbatim. See that folder for the individual pieces.
import { orderedBlockTeamIds } from './detail/blockHelpers';
import { PROJECT_TABS } from './detail/constants';
import { useScrollToMyTasks } from './detail/useScrollToMyTasks';
import { useTaskDeepLinkFlash } from './detail/useTaskDeepLinkFlash';
import { ProjectChartsOverlay } from './detail/ProjectChartsOverlay';
import { ProjectDeleteDialog } from './detail/ProjectDeleteDialog';
import { ProjectEditDialog } from './detail/ProjectEditDialog';
import { ProjectHeroCard } from './detail/ProjectHeroCard';
import { ProjectOverviewTab } from './detail/ProjectOverviewTab';
import { ProjectTabs } from './detail/ProjectTabs';
import { useProjectDetail } from './detail/useProjectDetail';
import { useProjectOverviewState } from './detail/useProjectOverviewState';
import { useProjectPermissions } from './detail/useProjectPermissions';
import { TaskLiveProvider } from './detail/taskLive';
import { useProjectTasks } from './detail/useProjectTasks';
import { useMyTaskIds } from '@/features/tasks/myTaskList';
import { taskHoursMap } from './detail/taskHours';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguage();

  const {
    user,
    data,
    loading,
    error,
    refetch,
    reload,
    scopeTeamCode,
    scopeTeamCodes,
    isScopedUser,
  } = useProjectDetail(id);
  const overviewState = useProjectOverviewState();
  const { selectedBlockId, activeTeamId, setActiveTeamId, showAllTeams, tasksRef } = overviewState;

  // Admin-only project edit / delete UI state.  Kept at the page level so
  // both the hero-bar dropdown and the dialogs share one source of truth
  // and we don't need to drill props.
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Header "enlarge" → full-viewport overlay rendering the Графикууд dashboard.
  const [chartsOverlayOpen, setChartsOverlayOpen] = useState(false);
  useEffect(() => {
    if (!chartsOverlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChartsOverlayOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chartsOverlayOpen]);

  // «Миний ажлууд»-ын төслийн нэр `?mine=1`-ээр энд орно: зөвхөн надад
  // хуваарилагдсан таскууд + таскийн хэсэг рүү шууд гүйлгэнэ.  Төлөв нь URL
  // өөрөө (state биш) — «Бүгд»/«Миний» сэлгэхэд `?mine` солигдож, холбоосыг
  // хуулж илгээж болно.
  const mineOnly = searchParams.get('mine') === '1';
  const setMineOnly = (on: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (on) next.set('mine', '1');
    else next.delete('mine');
    setSearchParams(next, { replace: true });
  };

  const { isAdmin, canManageProjectWork, canEditBaReport, canClaimRole } = useProjectPermissions();
  // «Миний ажлууд»-ын таскууд (0370) — «Миний ажилд нэмэх» товчны төлөв ба «Зөвхөн миний».
  const myTaskIds = useMyTaskIds(id ? Number(id) : null, canClaimRole);
  const { allTasks, teamProgress, flatTasks, myTasks, displayTasks, counts, assignedMemberCount } =
    useProjectTasks({
      data,
      isScopedUser,
      scopeTeamCodes,
      currentUserId: user?.id ?? null,
      selectedBlockId,
      activeTeamId,
      mineOnly,
      myTaskIds,
    });

  useTaskDeepLinkFlash();
  // `?task=` (Миний ажлууд → «Төсөл дээр авах», мэдэгдэл) нь МӨР рүү өөрөө гүйлгэнэ —
  // хэсгийн эхлэл рүү гүйлгэлт түүнийг дарахгүй.  Ref: flash нь `task`-ийг URL-ээс
  // арилгасны дараа ч дахин асахгүй.
  const deepLinkTaskRef = useRef(searchParams.get('task'));
  useScrollToMyTasks({
    enabled: mineOnly && !deepLinkTaskRef.current,
    ready: !!data && flatTasks.length > 0,
    projectId: id,
    targetRef: tasksRef,
  });

  // Цагаар бодогддог засварын төсөл (0339): таскийн мөрөнд хувь биш АЖИЛЛАСАН
  // ЦАГ (2026-09-24).  Ердийн төсөлд асуулга огт явахгүй.
  const hoursMode = data?.project.progress_mode === 'hours';
  const repairHoursQuery = useApiQuery<RepairHoursSummary>(
    `/repair/hours?project_id=${id ?? ''}`,
    { enabled: hoursMode && !!id, retry: false },
  );
  const taskHours = useMemo(() => taskHoursMap(repairHoursQuery.data), [repairHoursQuery.data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!data) {
    // Хүсэлт БҮТЭЭГҮЙ (403 «Access denied», 404, сүлжээ) — жинхэнэ
    // шалтгааныг нь харуулна; «Төсөл олдсонгүй» гэдэг нь зөвхөн 404-д үнэн.
    if (error) {
      return (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/app/projects">
                <ArrowLeft className="w-4 h-4 mr-1" /> {t('projectDetailPage.backToProjects')}
              </Link>
            </Button>
          }
        />
      );
    }
    return <div>{t('projectDetailPage.projectNotFound')}</div>;
  }

  if (Number(data.project.asr_only) === 1) {
    return <Navigate to="/app/asr" replace />;
  }

  const { project, blocks } = data;
  const clients = data.clients ?? [];
  const teamShares = data.team_shares ?? [];
  const blockTeamIds = orderedBlockTeamIds(blocks, teamShares);

  // Auto-pick the first team tab when none is selected (or the previous
  // selection lost its blocks via a delete on the setup page).  Skipped
  // when the user explicitly chose "Бүгд" (showAllTeams) so the all-teams
  // view isn't snapped back to the first team.
  if (
    blockTeamIds.length > 0 &&
    !showAllTeams &&
    (activeTeamId == null || !blockTeamIds.includes(activeTeamId))
  ) {
    // Defer the state update so we don't trigger a render-during-render
    // warning. Using a microtask is enough — the next frame picks it up.
    //
    // Хамрах хүрээтэй ажилтанд ӨӨРИЙНХ нь багийн pill-ийг эхэлж сонгоно —
    // өмнө нь үргэлж эхний (BA) pill сонгогдож, BB-ийн ажилтан өөрийн
    // блокоо «алга болсон» гэж боддог байв.  Багийн блок байхгүй бол
    // өөрт нь хуваарилагдсан ажил байгаа блокийн баг, тэр ч үгүй бол эхнийх.
    const myTeamId =
      blockTeamIds.find((tid) => {
        const code = teamShares.find((s) => s.team_id === tid)?.team_code ?? null;
        return code != null && code === scopeTeamCode;
      }) ??
      blockTeamIds.find((tid) =>
        blocks.some(
          (b) =>
            b.team_id === tid &&
            b.drawings.some((d) =>
              d.components.some((c) =>
                c.tasks.some(
                  (tk) =>
                    tk.assigned_to === user?.id ||
                    (tk.assignees ?? []).some((a) => a.user_id === user?.id),
                ),
              ),
            ),
        ),
      ) ??
      blockTeamIds[0];
    queueMicrotask(() => setActiveTeamId(myTeamId));
  }

  // Role wiring threaded down through the overview into the task rows.
  // `isAdmin` here is deliberately the wider admin+senior gate.  «Одоо хийж
  // буй» нэр, «Өөртөө авах», хувааж авах нь `TaskLiveProvider`-оос (2026-10-01).
  const taskActions = {
    canClaimRole,
    isAdmin: canManageProjectWork,
    currentUserId: user?.id ?? null,
    currentUserTeam: scopeTeamCode,
    hoursMode,
    taskHours: hoursMode ? taskHours : undefined,
  };

  return (
    <TaskLiveProvider
      projectId={Number(id)}
      currentUserId={user?.id ?? null}
      canTake={canClaimRole}
      isManager={canManageProjectWork}
      canAdminStop={isAdmin}
      hoursMode={hoursMode}
      myTaskIds={myTaskIds}
      onStructureChanged={() => void reload()}
    >
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
        <Link
          to="/app/projects"
          className="hover:text-foreground flex items-center transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> {t('projectDetailPage.backToProjects')}
        </Link>
      </div>

      <ProjectHeroCard
        id={id}
        project={project}
        clients={clients}
        isAdmin={isAdmin}
        canManageProjectWork={canManageProjectWork}
        memberCount={assignedMemberCount}
        blockCount={blocks.length}
        taskCount={allTasks.length}
        teamProgress={teamProgress}
        hoursMode={hoursMode}
        repairHours={hoursMode ? repairHoursQuery.data : undefined}
        repairHoursLoading={hoursMode && repairHoursQuery.isLoading}
        reload={reload}
        onEnlargeCharts={() => setChartsOverlayOpen(true)}
        onEdit={() => setEditOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      />

      {chartsOverlayOpen && (
        <ProjectChartsOverlay projectId={Number(id)} onClose={() => setChartsOverlayOpen(false)} />
      )}

      {/* Controlled + URL-синк: мэдэгдлийн линк
          `/app/projects/:id?tab=asr&asr=<id>` зөв таб дээр буух ёстой.
          KeepAliveTabs нь Radix-ийн controlled горимыг тольддог. */}
      <ProjectTabs
        id={id}
        value={
          PROJECT_TABS.has(searchParams.get('tab') ?? '') ? searchParams.get('tab')! : 'overview'
        }
        onValueChange={(v) => {
          const next = new URLSearchParams(searchParams);
          if (v === 'overview') next.delete('tab');
          else next.set('tab', v);
          // Таб солиход `?asr=` deep-link үлдэх ёсгүй.
          next.delete('asr');
          // «Баримт бичиг» табын Drive хавтасны байрлал ч мөн адил.
          next.delete('folder');
          setSearchParams(next, { replace: true });
        }}
        project={project}
        teamShares={teamShares}
        isAdmin={isAdmin}
        canManageProjectWork={canManageProjectWork}
        canEditBaReport={canEditBaReport}
        reload={reload}
        overview={
          <ProjectOverviewTab
            id={id}
            data={data}
            blockTeamIds={blockTeamIds}
            isProjectAdmin={isAdmin}
            canManageProjectWork={canManageProjectWork}
            isScopedUser={isScopedUser}
            scopeTeamCode={scopeTeamCode}
            scopeTeamCodes={scopeTeamCodes}
            teamNameMn={user?.team_name_mn}
            allTasks={allTasks}
            flatTasks={flatTasks}
            displayTasks={displayTasks}
            myTaskCount={myTasks.length}
            mineOnly={mineOnly}
            onMineOnlyChange={setMineOnly}
            counts={counts}
            selectedBlockId={selectedBlockId}
            onSelectBlock={overviewState.selectBlock}
            onClearBlock={overviewState.clearBlock}
            activeTeamId={activeTeamId}
            onTeamChange={overviewState.changeTeam}
            showAllTeams={showAllTeams}
            onShowAllTeams={overviewState.showEveryTeam}
            tasksRef={tasksRef}
            repairHours={hoursMode ? repairHoursQuery.data : undefined}
            repairHoursLoading={hoursMode && repairHoursQuery.isLoading}
            {...taskActions}
          />
        }
      />

      {/* Admin-only: edit project metadata + hard delete.  Both live as
          siblings of the page content so they aren't constrained by any
          tab/card overflow.  Only mounted when the trigger asks them
          to open, so unmounting on close fully resets local form state. */}
      {isAdmin && editOpen && (
        <ProjectEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          project={project}
          onSaved={async () => {
            await reload();
            toast.success(t('projectDetailPage.projectUpdated'));
          }}
        />
      )}
      {isAdmin && (
        <ProjectDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          projectId={id}
          projectName={project.name}
        />
      )}

    </div>
    </TaskLiveProvider>
  );
}
