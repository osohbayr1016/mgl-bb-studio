/* ─────────────────────────────────────────────────────────────────────────
 * Хуваарийн мөрийн ДЭЛГЭРЭНГҮЙ САМБАР — «энэ ямар төсөл вэ» + хугацааны CRUD
 * -------------------------------------------------------------------------
 * 2026-08-13-нд нэмэгдсэн.  Хоёр өөр хэрэгцээг НЭГ гадаргуу дээр нийлүүлнэ:
 *
 *   1. ТӨСЛИЙН МЭДЭЭЛЭЛ — `/app/projects` жагсаалтын карт юу хэлдэг, энэ
 *      самбар мөн адилыг хэлнэ (төлөв, ангилал, явц, огноо, гишүүд, тайлбар,
 *      нарийн төвөгтэй байдал).  Хуваарийн мөр нь нэр + баар л харуулдаг тул
 *      хэрэглэгч «энэ ямар төсөл байсан билээ» гэж төслийн хуудас руу үсрэх
 *      шаардлагатай болдог байв.
 *   2. ЭЦСИЙН ХУГАЦААНЫ CRUD — `MilestoneManager`-ийг ХЭВЭЭР нь дахин
 *      ашиглана (шинээр бичээгүй).  «Хугацаа» хуудас (`/app/deadlines`)
 *      устсаны дараа энэ нь хугацаа үүсгэх/засах/устгах ЦОРЫН ГАНЦ
 *      хөндлөн гадаргуу.
 *
 * ⚠️ ЭРХ: засварын БҮХ товч `canEdit` (= сервер талын `can_edit`, зөвхөн
 *    `admin`)-аас хамаарна.  `MilestoneManager` руу `readOnly` дамжуулж
 *    байгаа нь ЗААВАЛ: milestone-ийн бичих эрх backend дээр admin + senior
 *    хэвээр (төслийн «Хугацаа» таб түүнээс хамаардаг) тул тугийг өгөхгүй
 *    бол senior энэ самбар дээр засварын товч харах байлаа.
 *
 * ⚠️ Хугацааны жагсаалтыг ЗӨВХӨН самбар нээлттэй үед татна
 *    (`useProjectDeadlines(..., enabled)`) — 24 мөр бүрд урьдчилан татвал
 *    хуудас нээгдэхэд 24 нэмэлт хүсэлт явна.
 * ───────────────────────────────────────────────────────────────────────── */
import { BellRing, CalendarRange, ExternalLink, Handshake, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDate } from '@/shared/lib/time';
import { categoryName, isProjectCategory } from '@/shared/lib/project-categories';
import { APPROVAL_STATUS_TONE } from '@/shared/lib/status-colors';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Progress } from '@/ui/progress';
import { Skeleton } from '@/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/ui/sheet';

// Шууд файлаас — barrel (`@/features/deadlines`) нь DeadlineList зэрэг
// хүнд компонентуудыг дагуулж хуваарийн chunk-д оруулна.
import { useProjectDeadlines } from '@/features/deadlines/api';
import { DeadlineHistoryCard } from '@/features/deadlines/DeadlineHistoryCard';
import { MilestoneManager } from '@/features/deadlines/MilestoneManager';

import { RISK_TONE, riskDetail, riskLabelKey } from '../lib/riskDisplay';
import type { TimelineProject } from '../types';

/** Төслийн төлөв → badge-ийн өнгө/шошго.  `ProjectsPage`-ийн `STATUS_CONFIG`
 *  -тэй ЯГ ижил байлгана: нэг төсөл хоёр хуудсан дээр өөр өнгөтэй байвал
 *  «энэ өөр төсөл юм болов уу» гэсэн эргэлзээ төрнө. */
const STATUS_TONE: Record<TimelineProject['status'], { labelKey: string; class: string }> = {
  active: {
    labelKey: 'projectsPage.statusActive',
    class: 'bg-primary/10 text-primary border-primary/20',
  },
  completed: {
    labelKey: 'projectsPage.statusCompleted',
    class: 'bg-success/10 text-success border-success/20',
  },
  archived: {
    labelKey: 'projectsPage.statusArchived',
    class: 'bg-muted text-muted-foreground border-border',
  },
};

/** Мэдээллийн сүлжээний нэг нүд. */
function InfoCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2">
      <div className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-label mt-0.5 truncate text-foreground">{children}</div>
    </div>
  );
}

export interface ProjectDetailPanelProps {
  /** `null` = самбар хаалттай. */
  project: TimelineProject | null;
  onOpenChange: (open: boolean) => void;
  /** Сервер талын `can_edit` (admin).  Худал бол БҮХ засварын товч алга. */
  canEdit: boolean;
  onSchedule: (p: TimelineProject) => void;
  onNudge: (p: TimelineProject) => void;
  onTogglePending: (p: TimelineProject) => void;
}

export function ProjectDetailPanel({
  project,
  onOpenChange,
  canEdit,
  onSchedule,
  onNudge,
  onTogglePending,
}: ProjectDetailPanelProps) {
  const { t, lang } = useLanguage();

  const open = project !== null;
  // Хаагдах анимацийн турш `project` нь null болох тул сүүлийн утгыг барих
  // шаардлагагүй: Radix нь агуулгыг DOM-оос салгах хүртэл 300мс хоосон
  // самбар харагдахгүй (доор `project === null` үед юу ч буулгахгүй).
  const deadlineQuery = useProjectDeadlines(project?.id ?? 0, open);

  const title = project ? project.display_title?.trim() || project.name : '';
  /** ⚠️ 100-д ТАГЛААГҮЙ — жингийн нийлбэр 100-аас давсан төсөл 100-аас их
   *  хувь өгөх нь ЗӨВ бөгөөс ил байх ёстой (CLAUDE.md «ONE rollup»).
   *  Мөрний баар (`GanttRow`) нь дүрслэлийн улмаас 100-д таглаж хэвлэдэг тул
   *  ийм төсөл дээр мөр 100%, самбар 118% гэж харагдана — САНААТАЙ: самбар
   *  бол «яагаад» гэдгийг хэлдэг дэлгэрэнгүй гадаргуу.  `<Progress>` өөрөө
   *  зөвхөн ГЕОМЕТРЫГ таглана. */
  const progress = project ? Math.max(0, Math.round(project.progress)) : 0;
  const tone = project ? RISK_TONE[project.risk_state] : null;
  const detail = project
    ? riskDetail(
        t,
        project.risk_state,
        project.days_left,
        project.stale_days,
        project.days_to_start,
      )
    : '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md lg:max-w-lg">
        {project && (
          <>
            {/* ── Толгой: ангилал/төлөвийн тэмдэг + нэр + тайлбар ── */}
            <SheetHeader className="border-b border-border/60 pr-12">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={cn('capitalize', STATUS_TONE[project.status].class)}>
                  {t(STATUS_TONE[project.status].labelKey)}
                </Badge>
                {project.category && (
                  <Badge
                    variant="outline"
                    className="text-micro border-primary/30 bg-primary/10 py-0 font-mono text-primary"
                    title={
                      isProjectCategory(project.category)
                        ? categoryName(project.category, lang === 'en' ? 'en' : 'mn')
                        : undefined
                    }
                  >
                    {project.category}
                  </Badge>
                )}
                {project.is_asap === 1 && (
                  <Badge variant="outline" className="text-micro border-danger/40 bg-danger/10 py-0 text-danger">
                    ASAP
                  </Badge>
                )}
                {project.is_pending === 1 && (
                  <Badge
                    variant="outline"
                    className={cn('text-micro py-0', APPROVAL_STATUS_TONE.pending)}
                    title={t('timelinePage.pendingHint')}
                  >
                    {t('timelinePage.pendingBadge')}
                  </Badge>
                )}
              </div>
              <SheetTitle className="text-base leading-snug">{title}</SheetTitle>
              <SheetDescription className="text-label">
                {project.description?.trim() || t('projectsPage.noDescription')}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 p-4">
              {/* ── Эрсдэл + явц ─────────────────────────────────────── */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {tone && (
                    <span
                      className={cn(
                        'text-label inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5',
                        tone.chip,
                      )}
                    >
                      <span aria-hidden className={cn('size-1.5 rounded-full', tone.dot)} />
                      {t(riskLabelKey(project.risk_state))}
                    </span>
                  )}
                  {detail && <span className="text-label text-muted-foreground">{detail}</span>}
                </div>

                <div className="space-y-1">
                  <div className="text-label flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t('projectsPage.totalProgress')}
                      {project.manual_progress != null && (
                        <span className="ml-1 text-muted-foreground/70">
                          · {t('timelinePage.manualProgress')}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums font-medium text-foreground">{progress}%</span>
                  </div>
                  <Progress value={progress} />
                  {!project.has_breakdown && (
                    <p className="text-micro text-muted-foreground">
                      {t('timelinePage.noBreakdown')}
                    </p>
                  )}
                </div>
              </div>

              {/* ── Мэдээллийн сүлжээ ───────────────────────────────── */}
              <div className="grid grid-cols-2 gap-2">
                <InfoCell label={t('timelinePage.startDate')}>
                  <span className="tabular-nums">{project.start_date || '—'}</span>
                </InfoCell>
                <InfoCell label={t('timelinePage.finishDate')}>
                  <span className="tabular-nums">{project.finish_date || '—'}</span>
                  {/* Сунгагдсан төсөл: анхны хугацаа + тоо (migration 0337). */}
                  {project.extension_count > 0 && (
                    <span
                      className="ml-1.5 text-micro text-warning"
                      title={
                        project.original_finish_date
                          ? `${t('deadlineExt.original')}: ${project.original_finish_date}`
                          : undefined
                      }
                    >
                      {t('deadlineExt.countBadge', { n: project.extension_count })}
                    </span>
                  )}
                </InfoCell>
                <InfoCell label={t('timelinePage.infoMembers')}>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Users aria-hidden className="size-3.5 text-muted-foreground" />
                    {project.member_count}
                  </span>
                </InfoCell>
                <InfoCell label={t('timelinePage.infoCreated')}>
                  <span className="tabular-nums">
                    {project.created_at ? formatDate(project.created_at) : '—'}
                  </span>
                </InfoCell>
                {/* Нарийн төвөгтэй байдал нь сервер тал ЗӨВХӨН admin-д
                    буцаадаг тул энд дүр шалгах шаардлагагүй — `null` бол
                    нүд огт зурагдахгүй. */}
                {project.complexity_pct != null && (
                  <InfoCell label={t('timelinePage.infoComplexity')}>
                    <span className="tabular-nums">{project.complexity_pct}%</span>
                  </InfoCell>
                )}
                <InfoCell label={t('timelinePage.leads')}>
                  {project.leads.length > 0
                    ? project.leads.map((l) => l.full_name).join(', ')
                    : t('timelinePage.leadsNone')}
                </InfoCell>
              </div>

              {/* ── Үйлдэл ───────────────────────────────────────────
                  «Нээх» нь БҮХ дүрд — унших эрхтэй хүн төслийн хуудсаа
                  нээж чадах ёстой.  Үлдсэн гурав нь зөвхөн admin. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/app/projects/${project.id}`}>
                    <ExternalLink aria-hidden className="mr-1.5 size-4" />
                    {t('timelinePage.openProject')}
                  </Link>
                </Button>
                {canEdit && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => onSchedule(project)}>
                      <CalendarRange aria-hidden className="mr-1.5 size-4" />
                      {t('timelinePage.schedule')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onNudge(project)}>
                      <BellRing aria-hidden className="mr-1.5 size-4" />
                      {t('timelinePage.nudge')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-pressed={project.is_pending === 1}
                      className={cn(project.is_pending === 1 && 'text-warning')}
                      onClick={() => onTogglePending(project)}
                    >
                      <Handshake aria-hidden className="mr-1.5 size-4" />
                      {t('timelinePage.pendingToggle')}
                    </Button>
                  </>
                )}
              </div>

              {/* Эрхгүй хүнд ЯАГААД товч байхгүйг хэлнэ — эс бөгөөс
                  «эвдэрсэн юм болов уу» гэсэн эргэлзээ төрнө. */}
              {!canEdit && (
                <p className="text-micro text-muted-foreground">{t('timelinePage.viewOnly')}</p>
              )}

              {/* ── Дуусах хугацааны сунгалт + түүх (migration 0337) ── */}
              <DeadlineHistoryCard
                projectId={project.id}
                projectTitle={title}
                compact
                enabled={open}
              />

              {/* ── Эцсийн хугацаа — БҮРЭН CRUD (зөвхөн admin) ──────── */}
              {deadlineQuery.isError ? (
                <p className="text-label text-danger">{t('timelinePage.deadlinesLoadError')}</p>
              ) : deadlineQuery.isPending ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <MilestoneManager
                  projectId={project.id}
                  items={deadlineQuery.data?.items ?? []}
                  canManage={canEdit && (deadlineQuery.data?.can_manage_milestones ?? false)}
                  readOnly={!canEdit}
                />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default ProjectDetailPanel;
