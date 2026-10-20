import { useCallback, useState } from 'react';
import { HardHat, Plus } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { todayUB } from '@/shared/lib/time';
import {
  useAsrDetail,
  useAsrInvalidate,
  useAsrProjectSummaries,
  useAsrVisitPlan,
} from '@/features/projects/asr/api';
import { asrProjectName } from '@/features/projects/asr/asrProjectName';
import { AsrEditorShell } from '@/features/projects/asr/AsrEditorShell';
import { NewAsrDialog } from '@/features/projects/asr/NewAsrDialog';
import { useAsrSafetyGate, type AsrNewReportStart } from '@/features/projects/asr/useAsrSafetyGate';
import { newLocalAsrEntry } from '@/features/projects/asr/types';
import type { AsrReport, AsrTeamOption, AsrVisitPlan } from '@/features/projects/asr/types';
import { CreateAsrProjectDialog } from '@/features/asr/CreateAsrProjectDialog';
import { AsrOverview } from '@/features/asr/AsrOverview';
import { AsrPlanDialog } from '@/features/asr/AsrPlanDialog';
import { AsrPlansSection } from '@/features/asr/AsrPlansSection';
import { AsrSummaryButton } from '@/features/asr/summary/AsrSummaryDialog';
import { AsrProjectWorkspace } from '@/features/asr/AsrProjectWorkspace';
import { useApiQuery } from '@/shared/api/useApi';

export default function AsrPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { reportId } = useParams<{ reportId: string }>();

  const projectParam = searchParams.get('project');
  const parsed = projectParam ? Number(projectParam) : null;
  const selectedProjectId = parsed != null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  const [newOpen, setNewOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  /**
   * ХАДГАЛААГҮЙ шинэ тайлан — зөвхөн санах ойд.
   *
   * ⚠️ «Шинэ тайлан» дарахад сервер рүү ЮУ Ч явахгүй (эзний шийдвэр
   *    2026-09-04).  `AsrEditorShell` нь «Хадгалах» дарах агшинд POST
   *    хийж, `onCreated`-оор бодит id-г буцаана — тэр үед л URL солигдож
   *    жагсаалтад мөр гарч ирнэ.
   */
  const [draft, setDraft] = useState<AsrReport | null>(null);
  const isAdmin = user?.role === 'admin';
  const canManagePlans = isAdmin || user?.role === 'senior';

  /**
   * Хяналтын хуваарийн цонх (0331).  `null` = хаалттай, `{plan: null}` =
   * шинэ, `{plan}` = засах/харах.  Мэдэгдлийн холбоос `?plan=<id>`-аар
   * ирэхэд серверээс татаж нээнэ — жагсаалтад (ирэх хуваарь л) байхгүй
   * өнгөрсөн/цуцлагдсан хуваарь ч нээгдэнэ.
   */
  const [planDialog, setPlanDialog] = useState<{ plan: AsrVisitPlan | null } | null>(null);
  const planParam = searchParams.get('plan');
  const planParamId = planParam && /^\d+$/.test(planParam) ? Number(planParam) : null;
  const linkedPlan = useAsrVisitPlan(planParamId);
  // Холбоосоор ирсэн хуваарь нь ГАРГАН АВСАН төлөв (effect + setState биш):
  // хаахад `?plan=` устаж, энэ илэрхийлэл өөрөө null болно.
  const activePlanDialog =
    planDialog ?? (planParamId != null && linkedPlan.data?.plan ? { plan: linkedPlan.data.plan } : null);
  const closePlanDialog = useCallback(() => {
    setPlanDialog(null);
    if (planParamId != null) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('plan');
          return next;
        },
        { replace: true },
      );
    }
  }, [planParamId, setSearchParams]);

  /**
   * «Шинэ тайлан»-гийн ХААЛГА: төрөл → (Талбайн хяналт бол) ХАБ-ын мэдээлэл +
   * гарын үсэг (эзний хүсэлт 2026-09-21, төрөл 2026-09-29).  Жагсаалтаас бол:
   * хаалга → төсөл сонгох → ноорог; төслийн харагдацаас бол: хаалга → ноорог.
   * Ноорог нь төрөл + баталгааны id-г авч явна; сервер талбайн хяналтыг
   * баталгаагүйгээр үүсгэхгүй.
   */
  const safety = useAsrSafetyGate();

  const summaries = useAsrProjectSummaries(!selectedProjectId && !reportId);
  const projects = summaries.data?.projects ?? [];
  const projectName =
    asrProjectName(projects.find((p) => p.id === selectedProjectId)?.name) ?? t('asr.title');

  const openId = reportId ? Number(reportId) : null;
  const detail = useAsrDetail(openId != null && Number.isFinite(openId) ? openId : null);
  const openEntry = detail.data?.entry ?? null;
  const teamOptions = useTeamOptions(
    draft?.project_id ?? openEntry?.project_id ?? selectedProjectId ?? 0,
  );

  const invalidateProject = useAsrInvalidate(
    draft?.project_id ?? openEntry?.project_id ?? selectedProjectId ?? 0,
  );

  const selectProject = useCallback(
    (id: number) => setSearchParams({ project: String(id) }, { replace: false }),
    [setSearchParams],
  );

  const backToProjects = useCallback(
    () => setSearchParams({}, { replace: false }),
    [setSearchParams],
  );

  /**
   * Төслийн самбарын хугацаа (`?from=&to=`, `board/useAsrRangeParam.ts`) —
   * тайлан нээж хаахад, шинэ тайлан хадгалахад алдагдахгүйн тулд URL бүрт
   * дамжуулна.  Төсөл солих / жагсаалт руу буцахад зориуд арчина.
   */
  const rangeFrom = searchParams.get('from');
  const rangeTo = searchParams.get('to');
  const projectQs = useCallback(
    (pid: number) => {
      const qs = new URLSearchParams({ project: String(pid) });
      if (rangeFrom) qs.set('from', rangeFrom);
      if (rangeTo) qs.set('to', rangeTo);
      return qs.toString();
    },
    [rangeFrom, rangeTo],
  );

  const closeEditor = useCallback(() => {
    if (selectedProjectId) navigate(`/app/asr?${projectQs(selectedProjectId)}`);
    else navigate('/app/asr');
  }, [navigate, selectedProjectId, projectQs]);

  /** Хадгалаагүй ноорог нээнэ — сервер рүү хүсэлт ЯВУУЛАХГҮЙ. */
  const openNewDraft = useCallback(
    (targetProjectId: number, start: AsrNewReportStart) => {
      setDraft(
        newLocalAsrEntry({
          projectId: targetProjectId,
          authorId: user?.id ?? null,
          authorName: user?.full_name ?? null,
          authorSignatureUrl: user?.signature_url ?? null,
          reportDate: todayUB(),
          safetyAckId: start.safetyAckId,
          reportType: start.reportType,
        }),
      );
    },
    [user?.id, user?.full_name, user?.signature_url],
  );

  /** Хаалгын үр дүнг (төрөл + баталгаа) төсөл сонгох цонх хүртэл авч явна. */
  const [pendingStart, setPendingStart] = useState<AsrNewReportStart | null>(null);

  const showProjectList = !selectedProjectId && !reportId;

  return (
    <PageContainer>
      <PageHeader
        title={t('asr.title')}
        description={showProjectList ? t('asr.projectListHint') : t('asr.pageDescription')}
        icon={HardHat}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {/* ЗХ-ийн НЭГТГЭЛ тайлан — бүх төсөл (зөвхөн админ; сервер ч 403).
                Төслийн харагдац дээр `AsrProjectBoard` өөрийн товчтой. */}
            {isAdmin && showProjectList && (
              <AsrSummaryButton projects={projects} className="w-full sm:w-auto" />
            )}
            {isAdmin && (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 sm:w-auto"
                onClick={() => setCreateProjectOpen(true)}
              >
                <Plus className="h-4 w-4" />
                {t('asr.createProject')}
              </Button>
            )}
            {/* ⚠️ ЗӨВХӨН төслийн жагсаалт дээр.  Төсөл сонгосон харагдац дээр
                `AsrProjectWorkspace` өөрөө «Шинэ тайлан» товчтой бөгөөд тэр нь
                `can_write`-ыг шалгадаг — хоёуланг нь харуулбал нэг дэлгэцэн
                дээр ИЖИЛ товч хоёр удаа гарч, нэг нь эрх шалгадаггүй байв. */}
            {showProjectList && (
              <Button
                type="button"
                className="w-full gap-2 sm:w-auto"
                onClick={() =>
                  safety.request(null, (start) => {
                    setPendingStart(start);
                    setNewOpen(true);
                  })
                }
              >
                <Plus className="h-4 w-4" />
                {t('asr.new')}
              </Button>
            )}
          </div>
        }
      />

      {showProjectList ? (
        <div className="space-y-4">
          {/* Ирэх хяналтын хуваарь (бүх төсөл) — тоймоос дээр. */}
          <AsrPlansSection
            onOpen={(plan) => setPlanDialog({ plan })}
            onNew={() => setPlanDialog({ plan: null })}
          />
          <AsrOverview
            projects={projects}
            projectsLoading={summaries.isLoading}
            onSelectProject={selectProject}
            onOpenReport={(row) => navigate(`/app/asr/${row.id}?project=${row.project_id}`)}
          />
        </div>
      ) : selectedProjectId ? (
        <AsrProjectWorkspace
          projectId={selectedProjectId}
          projectName={projectName}
          onBack={backToProjects}
          onOpenProject={selectProject}
          onOpenPlan={(plan) => setPlanDialog({ plan })}
          onNewPlan={() => setPlanDialog({ plan: null })}
          onOpenReport={(row) => navigate(`/app/asr/${row.id}?${projectQs(selectedProjectId)}`)}
          onNewReport={() =>
            safety.request(selectedProjectId, (start) => openNewDraft(selectedProjectId, start))
          }
        />
      ) : null}

      <NewAsrDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        // Төсөл сонгогдмогц ХАДГАЛААГҮЙ ноорог нээнэ.  URL нь тухайн
        // төслийн харагдац руу шилжинэ — засварлагчийг хаахад хэрэглэгч
        // хоосон хуудсанд биш, тэр төслийнхөө жагсаалтад буцаж ирнэ.
        onPicked={(p) => {
          // Хаалгагүй энд хүрэх зам байхгүй (товч нь хаалгаар дамждаг);
          // хамгаалалтын давхарлал — байхгүй бол хаалгыг дахин нээнэ.
          const start = pendingStart;
          setPendingStart(null);
          if (start == null) {
            safety.request(p.id, (s) => {
              setSearchParams({ project: String(p.id) }, { replace: false });
              openNewDraft(p.id, s);
            });
            return;
          }
          setSearchParams({ project: String(p.id) }, { replace: false });
          openNewDraft(p.id, start);
        }}
      />

      <AsrPlanDialog
        open={activePlanDialog != null}
        onOpenChange={(v) => {
          if (!v) closePlanDialog();
        }}
        plan={activePlanDialog?.plan ?? null}
        defaultProjectId={activePlanDialog?.plan ? undefined : (selectedProjectId ?? undefined)}
        canManage={canManagePlans}
      />

      {safety.element}

      {isAdmin && (
        <CreateAsrProjectDialog open={createProjectOpen} onOpenChange={setCreateProjectOpen} />
      )}

      {/* ХАДГАЛААГҮЙ ноорог.  `key` нь `client_uuid` — хоёр дараалсан «Шинэ
          тайлан» дараад өмнөх маягтын төлөв үлдэхээс сэргийлнэ. */}
      {draft && (
        <AsrEditorShell
          key={`draft-${draft.client_uuid}`}
          projectId={draft.project_id}
          entry={draft}
          teamOptions={teamOptions}
          canReview={false}
          currentUserId={user?.id ?? null}
          isAdmin={isAdmin}
          open
          onClose={() => setDraft(null)}
          onChanged={(id) => {
            invalidateProject(id);
            void summaries.refetch();
          }}
          onCreated={(id) => {
            const pid = draft.project_id;
            setDraft(null);
            void summaries.refetch();
            // Анх үүссэн тайлан засварлагч дээрээ үлдэнэ («Баримт» руу шидэхгүй) —
            // улаан дэвтрийг үүсгэх агшинд хавсаргасан хүн үргэлжлүүлэн бөглөнө.
            navigate(`/app/asr/${id}?${projectQs(pid)}&edit=1`);
          }}
        />
      )}

      {!draft && openEntry && (
        <AsrEditorShell
          key={openEntry.id}
          projectId={openEntry.project_id}
          entry={openEntry}
          teamOptions={teamOptions}
          canReview={detail.data?.can_review ?? false}
          currentUserId={user?.id ?? null}
          isAdmin={isAdmin}
          // Хэвлэх хуудасны «Засварлах» (`?edit=1`) — «Баримт» биш шууд засварлагч.
          initialMode={searchParams.get('edit') === '1' ? 'edit' : undefined}
          open
          onClose={closeEditor}
          onChanged={(id) => {
            invalidateProject(id);
            void summaries.refetch();
          }}
        />
      )}
    </PageContainer>
  );
}

function useTeamOptions(projectId: number): AsrTeamOption[] {
  const { data } = useApiQuery<{ teams: AsrTeamOption[] }>(
    ['asr', 'project', projectId],
    `/author-supervision/projects/${projectId}`,
    { enabled: projectId > 0 },
  );
  return data?.teams ?? [];
}
