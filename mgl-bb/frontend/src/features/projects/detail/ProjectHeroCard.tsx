/** The project hero bar: key image, editable title, badge row, progress
 *  previews and the actions kebab. Extracted from `ProjectDetailPage.tsx`
 *  when that file was split into per-component modules — no behavioural
 *  change (the title-edit state simply moved in with its markup). */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Boxes,
  FileText,
  GitBranch,
  LayoutTemplate,
  MoreVertical,
  Pencil,
  Settings2,
  Trash2,
} from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { resolveProjectIdentity } from '@/shared/lib/projectIdentity';
import type {
  ProjectDetailResponse,
  ProjectWithProgress,
  RepairHoursSummary,
} from '@/shared/types';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { useLanguage } from '@/shared/i18n';
import ProgressSparklinePreview from '@/features/projects/components/ProgressSparklinePreview';
import {
  templateFor,
  useCategoryTemplates,
  useSetCategoryTemplate,
} from '@/features/projects/categoryTemplates';
import type { TeamProgressItem } from '@/features/projects/components/ProjectInfoTab';

import { ProjectHeroBadges } from './ProjectHeroBadges';
import { ProjectKeyImage } from './ProjectKeyImage';
import { ProjectTitleDialog } from './ProjectTitleDialog';
import { RealProgressPreview } from './RealProgressPreview';
import { TeamProgressPreview } from './TeamProgressPreview';

export function ProjectHeroCard({
  id,
  project,
  clients,
  isAdmin,
  canManageProjectWork,
  memberCount,
  blockCount,
  taskCount,
  teamProgress,
  hoursMode = false,
  repairHours,
  repairHoursLoading = false,
  reload,
  onEnlargeCharts,
  onEdit,
  onDelete,
}: {
  id: string | undefined;
  project: ProjectDetailResponse['project'];
  clients: NonNullable<ProjectDetailResponse['clients']>;
  isAdmin: boolean;
  canManageProjectWork: boolean;
  memberCount: number;
  blockCount: number;
  taskCount: number;
  teamProgress: TeamProgressItem[];
  /** Цагаар бодогддог засварын төсөл (`progress_mode = 'hours'`) — «Багуудын
   *  явц»-ын оронд ЗӨВХӨН бодит (цагаас бодсон) явц харуулна. */
  hoursMode?: boolean;
  repairHours?: RepairHoursSummary;
  repairHoursLoading?: boolean;
  reload: () => Promise<void>;
  onEnlargeCharts: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();

  /* ─────────────── Зургийн шифр / Doc. No. ───────────────
   *
   * Хэрэглэгч sidebar-ын хайлтад «MEC-25/21» гэж бичээд энэ хуудсанд
   * буудаг болсон (2026-09-03).  Бичсэн кодоо хуудсан дээрээ ХАРАХГҮЙ бол
   * зөв төсөл дээр ирснээ баталгаажуулах арга байхгүй — ялангуяа шифр нь
   * ДАВХАРДАЖ БОЛОХ учир (эзний шийдвэр: 37 ба 41 хоёул «MEC-25/21»).
   *
   * ⚠️ ЯАГААД НЭМЭЛТ query вэ: `GET /api/projects/:id` нь төслийг
   * `SELECT * FROM projects`-оор буцаадаг тул `project` дээр паспортын
   * багана БАЙХГҮЙ; шифр нь хариуны ТУСДАА `passport` түлхүүрт байдаг.
   * Кэшийн түлхүүр нь `useProjectDetail`-ынхтай ЯГ ИЖИЛ (`['/projects', id]`)
   * тул TanStack үүнийг ижил бичлэг гэж үзэж, сүлжээнд ДАХИН хүрэхгүй —
   * зөвхөн эцэг хуудасны аль хэдийн татсан хариуг уншиж авна.
   *
   * ⚠️ Шатлалыг энд ДАХИН бичихгүй: `shared/lib/projectIdentity.ts` бол
   * `backend/src/lib/projectIdentity.ts`-тэй хосолсон ЦОРЫН ГАНЦ resolver.
   * Хажуугаар нь `project.drawing_no` руу ч уналаа — жагсаалтын SQL
   * (`PROJECT_LIST_SQL`) эдгээр баганыг СОНГОДОГ тул ирээдүйд дэлгэрэнгүй
   * маршрут ч буцаах магадлалтай. */
  const detailQuery = useApiQuery<ProjectDetailResponse>(['/projects', id], `/projects/${id}`, {
    enabled: !!id,
  });
  const passport = detailQuery.data?.passport ?? null;
  const identity = useMemo(
    () => resolveProjectIdentity({ project, passport }),
    [project, passport],
  );
  const drawingNo = identity.drawingNo || (project.drawing_no ?? '').trim();

  /* ─────────────── Эх төсөл (migration 0254) ───────────────
   *
   * Засварын (ЗА) төсөл нь бүтцээ өмнөх төслөөс хуулж авдаг ба тэр холбоо
   * `projects.source_project_id`-д БАЙНГА үлддэг.  Энд түүнийг ил гаргаж,
   * «энэ ямар барилгын засвар вэ?» гэдгийг НЭГ дарж хариулна.
   *
   * ⚠️ НЭР нь дэлгэрэнгүй хариунд БАЙХГҮЙ: `GET /api/projects/:id` нь
   * `SELECT * FROM projects` тул зөвхөн id ирнэ.  Иймд нэрийг жагсаалтын
   * кэшээс нөхнө — түлхүүр нь `['/projects']` тул хэрэглэгч Төслүүд
   * хуудсаар дамжин ирсэн бол сүлжээнд ОГТ хүрэхгүй.  Нэр олдохгүй үед
   * `#<id>` гэж харуулна: холбоос нь ажиллаж байхад «эх төсөлтэй» гэдэг
   * баримтыг нуух нь илүү муу. */
  const sourceProjectId = project.source_project_id ?? null;
  const sourceNameFromRow = (project.source_project_name ?? '').trim();
  const sourceListQuery = useApiQuery<{ projects: ProjectWithProgress[] }>('/projects', {
    enabled: sourceProjectId != null && sourceNameFromRow.length === 0,
    staleTime: 60_000,
  });
  const sourceProjectName =
    sourceNameFromRow ||
    sourceListQuery.data?.projects.find((p) => p.id === sourceProjectId)?.name ||
    (sourceProjectId != null ? `#${sourceProjectId}` : '');

  /* ─────────────── Ангиллын ЗАГВАР (2026-10-06) ───────────────
   * Энэ төсөл өөрийн ангиллын загвар бол шинэ ижил ангиллын төсөл үүсэхэд
   * түүний бүтэц, ажлын хуваарилалт автоматаар хуулагдана
   * (`features/projects/categoryTemplates.ts`).  Тохируулах нь admin-д л. */
  const category = project.category ?? null;
  const templatesQuery = useCategoryTemplates(isAdmin && !!category);
  const setCategoryTemplate = useSetCategoryTemplate();
  const currentTemplate = templateFor(templatesQuery.data?.templates, category);
  const isCategoryTemplate = currentTemplate?.project_id === project.id;
  const canToggleTemplate =
    isAdmin && !!category && (project.asr_only ?? 0) === 0 && templatesQuery.isSuccess;
  const toggleCategoryTemplate = async () => {
    if (!category) return;
    if (!isCategoryTemplate) {
      const lines = [t('projectDetailPage.makeCategoryTemplateConfirm', { category })];
      if (currentTemplate) {
        lines.push(
          t('projectDetailPage.replaceCategoryTemplateConfirm', {
            category,
            name: currentTemplate.name,
          }),
        );
      }
      if (!(await confirmDialog({ description: lines.join('\n\n') }))) return;
    }
    try {
      await setCategoryTemplate(project.id, !isCategoryTemplate);
      toast.success(
        isCategoryTemplate
          ? t('projectDetailPage.categoryTemplateRemoved')
          : t('projectDetailPage.categoryTemplateSet', { category }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.saveFailed'));
    }
  };

  const [titleOpen, setTitleOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);

  const openTitleEditor = () => {
    setTitleDraft(project.display_title || project.name);
    setTitleOpen(true);
  };
  const handleSaveTitle = async () => {
    setTitleSaving(true);
    try {
      await apiFetch(`/projects/${project.id}`, {
        method: 'PUT',
        data: { display_title: titleDraft.trim() || null },
      });
      await reload();
      setTitleOpen(false);
      toast.success(t('projectDetailPage.titleUpdated'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setTitleSaving(false);
    }
  };

  return (
    <Card className="py-0 border-border/60 bg-gradient-to-br from-card via-card to-primary/5 overflow-hidden relative">
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 20% 20%, white 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <CardContent className="px-4 py-3 relative">
        <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
          <ProjectKeyImage
            projectId={project.id}
            keyImageUrl={project.key_image_url}
            isAdmin={isAdmin}
            onUploaded={reload}
          />
          <div className="flex-1 space-y-1 min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              <Boxes className="w-3 h-3" />
              {t('projectDetailPage.eyebrowProject')}
            </div>
            <h1 className="text-base lg:text-lg font-semibold tracking-tight text-foreground">
              {isAdmin ? (
                <button
                  type="button"
                  onClick={openTitleEditor}
                  title={t('projectDetailPage.editTitle')}
                  className="group/title inline-flex items-start gap-1.5 text-left transition-colors hover:text-primary"
                >
                  <span className="break-words">{project.display_title || project.name}</span>
                  <Pencil className="mt-1 h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-60" />
                </button>
              ) : (
                <span className="break-words">{project.display_title || project.name}</span>
              )}
            </h1>
            {/* Зургийн шифр — гарчгийн ЯГ ДООР.  Хайлтаас кодоор нь ирсэн
                хэрэглэгч бичсэн зүйлээ энд харна.  («Doc. No.» 2026-09-28-нд
                хасагдсан — эзний хүсэлт.)
                ⚠️ Шинэ token зохиогоогүй: eyebrow мөрийн хэмжээ/өнгө,
                badge эгнээний зайг давтав. */}
            {drawingNo && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span title={t('projectInfoTab.drawingNoLabel')}>
                  <span className="uppercase tracking-wider">
                    {t('projectDetailPage.drawingNoShort')}
                  </span>{' '}
                  <span className="font-medium text-foreground/80">{drawingNo}</span>
                </span>
              </div>
            )}
            {/* «Эх төсөл: …» — хуулбарласан бүтцийн гарал үүсэл.
                «EZ загвар» — шинэ EZ төсөл энэ төслийн бүтцийг авна. */}
            {(sourceProjectId != null || isCategoryTemplate) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {isCategoryTemplate && category && (
                  <span
                    title={t('projectDetailPage.categoryTemplateBadgeTitle', { category })}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary"
                  >
                    <LayoutTemplate className="h-3 w-3 shrink-0" />
                    {t('projectDetailPage.categoryTemplateBadge', { category })}
                  </span>
                )}
                {sourceProjectId != null && (
                  <Link
                    to={`/app/projects/${sourceProjectId}`}
                    title={t('projectDetail.sourceProject')}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/20"
                  >
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="uppercase tracking-wider">
                      {t('projectDetail.sourceProject')}
                    </span>
                    <span className="truncate font-medium">{sourceProjectName}</span>
                  </Link>
                )}
              </div>
            )}
            <ProjectTitleDialog
              open={titleOpen}
              onClose={() => setTitleOpen(false)}
              draft={titleDraft}
              onDraftChange={setTitleDraft}
              saving={titleSaving}
              onSave={handleSaveTitle}
              projectName={project.name}
            />
            <ProjectHeroBadges
              project={project}
              clients={clients}
              isAdmin={isAdmin}
              memberCount={memberCount}
              blockCount={blockCount}
              taskCount={taskCount}
            />
          </div>

          {/* Overall-progress mini chart + team progress as an equal-width,
              equal-height pair on wide screens. `items-stretch` makes both
              cards match the taller one's height; the chart fills its column.
              Below xl the chart hides so the header never crowds. Clicking the
              chart enlarges into the full Графикууд dashboard overlay. */}
          <div className="flex w-full items-stretch gap-3 lg:w-auto lg:shrink-0">
            <div className="hidden xl:block xl:w-[300px] 2xl:w-[340px]">
              <ProgressSparklinePreview projectId={Number(id)} onEnlarge={onEnlargeCharts} />
            </div>
            <div className="w-full lg:w-[300px] 2xl:w-[340px]">
              {hoursMode ? (
                <RealProgressPreview
                  projectProgress={project.progress}
                  hours={repairHours}
                  hoursLoading={repairHoursLoading}
                />
              ) : (
                <TeamProgressPreview teams={teamProgress} projectProgress={project.progress} />
              )}
            </div>
          </div>

          {/* Project actions live in one kebab menu to keep the hero compact. */}
          <div className="flex items-center gap-2 shrink-0">
            {canManageProjectWork && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    aria-label={t('projectDetailPage.projectActions')}
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem asChild>
                    <Link to={`/app/projects/${id}/setup`}>
                      <Settings2 className="w-4 h-4 mr-2" />{' '}
                      {t('projectDetailPage.configureStructure')}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={`/app/projects/${id}/performance-reports`}>
                      <FileText className="w-4 h-4 mr-2" />{' '}
                      {t('projectDetailPage.performanceReport')}
                    </Link>
                  </DropdownMenuItem>
                  {canToggleTemplate && category && (
                    <DropdownMenuItem onClick={() => void toggleCategoryTemplate()}>
                      <LayoutTemplate className="w-4 h-4 mr-2" />{' '}
                      {isCategoryTemplate
                        ? t('projectDetailPage.removeCategoryTemplate', { category })
                        : t('projectDetailPage.makeCategoryTemplate', { category })}
                    </DropdownMenuItem>
                  )}
                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onEdit}>
                        <Pencil className="w-4 h-4 mr-2" /> {t('common.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={onDelete}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> {t('common.delete')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default ProjectHeroCard;
