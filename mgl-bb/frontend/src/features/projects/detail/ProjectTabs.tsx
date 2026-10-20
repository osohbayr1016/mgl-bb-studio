/** The project detail tab strip and its panels.
 *
 *  The Overview panel's content is injected by the page (it needs the task
 *  state that lives up there); every other panel is self-contained here.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { lazy, Suspense } from 'react';
import {
  Activity,
  CalendarClock,
  FileText,
  FolderOpen,
  HardHat,
  LayoutGrid,
  Mail,
  ShieldCheck,
} from 'lucide-react';

import type { ProjectDetailResponse } from '@/shared/types';
import { TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import { useLanguage } from '@/shared/i18n';
import { useAuth } from '@/shared/context/AuthContext';
import CorrespondenceLogTab from '@/features/projects/components/CorrespondenceLogTab';
import { TeamReportsTab } from '@/features/projects/team-reports/TeamReportsTab';

import { ProjectInfoPanel } from './ProjectInfoPanel';
// «Захиалагч» таб (`./ClientPortalTab`) 2026-09-28-нд ХАСАГДСАН — эзний хүсэлт:
// захиалагчийг яаж хийхээ дараа шийднэ; одоохондоо нэрийг «Мэдээлэл» табын
// паспорт дээр шууд бичнэ, захиалагчийн эрхийг Хэрэглэгчид хуудсаас нэмж/хасна.
// Файл хэвээр (сэргээх бол энд lazy import + TabsTrigger/TabsContent +
// `constants.ts` `PROJECT_TABS`-д 'client' гурвыг буцаана).

const ProjectChartsTab = lazy(() => import('@/features/projects/components/ProjectChartsTab'));
// Зохиогчийн хяналт — гарын үсгийн canvas, зураг жижигрүүлэлт зэрэг нь
// зөвхөн энэ табыг нээхэд л татагдана.
const AsrTab = lazy(() => import('@/features/projects/asr/AsrTab'));
// «Хугацаа» — төслийн эцсийн хугацаа / блокийн муж / таскийн огноо / дэд
// шалгах цэгүүдийн нэгтгэсэн жагсаалт.  Бусад табтай ижил lazy хил.
const ProjectDeadlinesTab = lazy(() => import('@/features/deadlines/ProjectDeadlinesTab'));
// «Бэлэн байдал» — §69-ийн хаалга, §59-ийн цоорхой, §66-ийн дүрмийн чанар.
// Бусад табтай ижил lazy хил: `/api/compliance` унших нь энэ табыг нээхэд л
// эхэлнэ.
const ReadinessPanel = lazy(() => import('@/features/projects/readiness/ReadinessPanel'));
// «Баримт бичиг» — төслийн Google Drive хавтсыг хуудсан дотор үзэх.  Drive нь
// эх сурвалж (файл тэнд үлдэнэ), сервер нь зөвхөн дамжуулна — `features/projects/drive/`.
// Захиалагчид ХАРАГДАХГҮЙ: порталын татах хүрээ нь тайлан/гаргасан багц/ASR
// (эзний шийдвэр 2026-09-07), компанийн ажлын хавтас биш; сервер ч 403 өгнө.
// 2026-09-24-нөөс бүх ажилтан харж, засаж, файл нэмнэ — устгах боломжгүй
// (эзний шийдвэр; сервер `DRIVE_ROLES`, sidebar `Layout.tsx` ижил).
const DriveBrowser = lazy(() => import('@/features/projects/drive/DriveBrowser'));

export function ProjectTabs({
  id,
  value,
  onValueChange,
  project,
  teamShares,
  isAdmin,
  canManageProjectWork,
  canEditBaReport,
  reload,
  overview,
}: {
  id: string | undefined;
  value: string;
  onValueChange: (v: string) => void;
  project: ProjectDetailResponse['project'];
  teamShares: NonNullable<ProjectDetailResponse['team_shares']>;
  isAdmin: boolean;
  /** admin ЭСВЭЛ senior.  «Мэдээлэл» табын паспорт үүгээр засагдана —
   *  `PUT /api/projects/:id/passport` нь `requireManager()` (2026-09-02). */
  canManageProjectWork: boolean;
  canEditBaReport: boolean;
  reload: () => Promise<void>;
  overview: React.ReactNode;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const showAsrTab =
    project.category === 'ZA' || Number(project.asr_only) === 1 || value === 'asr';
  const canCreateAsr = project.category === 'ZA' || Number(project.asr_only) === 1;
  // 2026-09-24: «Баримт бичиг» бүх ажилтанд (сервер `DRIVE_ROLES`, sidebar `Layout.tsx`).
  const showDocumentsTab =
    user?.role === 'admin' ||
    user?.role === 'senior' ||
    user?.role === 'engineer' ||
    user?.role === 'architect';
  return (
    <KeepAliveTabs value={value} onValueChange={onValueChange} className="space-y-4">
      {/* The default TabsList is `inline-flex w-fit … h-9` with `flex-1`
          triggers, which cannot shrink (whitespace-nowrap makes each
          item's min-content its full label width).  On a 390px phone the
          Mongolian labels need ~470px, so the strip silently overflowed
          into <main>'s horizontal scroll.  `flex-wrap` + per-trigger
          `flex-none` wraps it into clean rows instead.

          ⚠️ The height override MUST use the same variant as the base
          (`group-data-[orientation=horizontal]/tabs:h-auto`).  A plain
          `h-auto` is a different twMerge group, so the base's
          `group-data-[…]:h-9` survives AND wins on specificity — the box
          stays 36px tall while the tabs wrap to 3 rows, so rows 2-3 spill
          out and collide with the heading underneath.

          Icons are hidden below `sm` purely to buy width: with them the
          six Mongolian labels need 3 rows on a 390px screen, without them
          2.  Desktop keeps the icons and is otherwise unchanged. */}
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-[orientation=horizontal]/tabs:h-auto">
        <TabsTrigger value="overview" className="h-auto flex-none gap-2 py-1.5">
          <LayoutGrid className="hidden w-4 h-4 sm:block" /> {t('projectDetailPage.tabOverview')}
        </TabsTrigger>
        <TabsTrigger value="info" className="h-auto flex-none gap-2 py-1.5">
          <FileText className="hidden w-4 h-4 sm:block" /> {t('projectDetailPage.tabInfo')}
        </TabsTrigger>
        <TabsTrigger value="deadlines" className="h-auto flex-none gap-2 py-1.5">
          <CalendarClock className="hidden w-4 h-4 sm:block" /> {t('projectDetailPage.tabDeadlines')}
        </TabsTrigger>
        <TabsTrigger value="mail" className="h-auto flex-none gap-2 py-1.5">
          <Mail className="hidden w-4 h-4 sm:block" /> {t('projectDetailPage.tabMail')}
        </TabsTrigger>
        <TabsTrigger value="report" className="h-auto flex-none gap-2 py-1.5">
          <FileText className="hidden w-4 h-4 sm:block" /> {t('projectDetailPage.tabReport')}
        </TabsTrigger>
        {showDocumentsTab && (
          <TabsTrigger value="documents" className="h-auto flex-none gap-2 py-1.5">
            <FolderOpen className="hidden w-4 h-4 sm:block" /> {t('projectDetailPage.tabDocuments')}
          </TabsTrigger>
        )}
        <TabsTrigger value="charts" className="h-auto flex-none gap-2 py-1.5">
          <Activity className="hidden w-4 h-4 sm:block" /> {t('projectDetailPage.tabCharts')}
        </TabsTrigger>
        {showAsrTab && (
          <TabsTrigger value="asr" className="h-auto flex-none gap-2 py-1.5">
            <HardHat className="hidden w-4 h-4 sm:block" /> {t('projectDetailPage.tabAsr')}
          </TabsTrigger>
        )}
        <TabsTrigger value="readiness" className="h-auto flex-none gap-2 py-1.5">
          <ShieldCheck className="hidden w-4 h-4 sm:block" /> {t('readiness.tab')}
        </TabsTrigger>
      </TabsList>

      {/* Overview: block cards + scoped tasks table */}
      <KeepAliveTabsPanel value="overview" className="space-y-5">
        {overview}
      </KeepAliveTabsPanel>

      {/* Тайлан — хоёр босоо хэсэг:
       *   Зүүн:  MGL ажлын явц (гэрээ + санхүүжилт + гадаад байгууллага + явцын мэдээ)
       *   Баруун: Захиалагч / Бусад тэмдэглэл
       * Бүх хэрэглэгчид харагдана, харин зөвхөн админ засах эрхтэй. */}
      <KeepAliveTabsPanel value="info" className="space-y-5">
        {/* ⚠️ `key={id}` ЗААВАЛ: `ProjectInfoTab` нь паспортыг локал
            state-д толилуулж, `dirty` үед серверийн шинэ өгөгдлөөр дарж
            бичихгүй.  Түлхүүргүй бол төсөл солиход React ижил инстансыг
            дахин ашиглаж, А төслийн хадгалаагүй утгууд Б төслийн
            `PUT /passport` руу явж, Б-гийн `start_date`/`finish_date`-ыг
            1.3 хүснэгтээс гаргаж дарж бичнэ. */}
        <ProjectInfoPanel
          key={id}
          id={id}
          project={project}
          isAdmin={isAdmin}
          canManageProjectWork={canManageProjectWork}
          reload={reload}
        />
      </KeepAliveTabsPanel>

      {/* Хугацаа — төслийн эцсийн хугацаа, блокийн уламжлагдсан муж,
          таскийн огноо, дэд шалгах цэгүүд НЭГ эрэмбэлсэн жагсаалтад.
          ⚠️ «Дундын deadline» нь хадгалагддаг мөр БИШ — milestone
          хүснэгт зориудаар байхгүй (хойшлогдсон), жагсаалт нь одоо
          байгаа огноонуудаас ургана.  routes/deadlines.ts-ийг үз. */}
      <KeepAliveTabsPanel value="deadlines" className="space-y-4">
        <Suspense fallback={<div className="h-60 rounded bg-muted/40 animate-pulse" />}>
          <ProjectDeadlinesTab projectId={Number(id)} />
        </Suspense>
      </KeepAliveTabsPanel>

      {/* И-мэйл tab — per-project correspondence log.  Same component
          mounted on the Client Dashboard so both sides see one shared
          ledger; staff can edit, clients land here read-only. */}
      <KeepAliveTabsPanel value="mail" className="space-y-5">
        <CorrespondenceLogTab projectId={Number(id)} />
      </KeepAliveTabsPanel>

      {/* Тайлан tab — per-team explanatory note (was previously
          "Тайлбар бичиг").  Each discipline assigned to the project
          gets its own sub-tab inside; BA / BB / HAS / ЦБУ / ЦАХ / ХД
          / АУ are all implemented. The standalone admin-only notes
          tab has been removed. */}
      <KeepAliveTabsPanel value="report" className="space-y-4">
        <TeamReportsTab projectId={Number(id)} teamShares={teamShares} readOnly={!canEditBaReport} />
      </KeepAliveTabsPanel>

      {/* Баримт бичиг — Google Drive хавтас.  ЗОРИУДААР `TabsContent`,
          `KeepAliveTabsPanel` БИШ: Drive-ын төлөв хүсэлт бүрт шинэ байх
          ёстой (§8) — таб руу буцаж ирэхэд дахин уншина, мөн урьдчилан
          харах blob-ууд санах ойд үлдэхгүй. */}
      {showDocumentsTab && (
        <TabsContent value="documents" className="space-y-4">
          <Suspense fallback={<div className="h-60 rounded bg-muted/40 animate-pulse" />}>
            <DriveBrowser scope="project" id={Number(id)} isAdmin={isAdmin} />
          </Suspense>
        </TabsContent>
      )}

      {/* Графикууд — time-series charts (overall / per-team progress +
          daily activity).  Lazy-loaded so recharts only downloads when
          this tab is first opened, keeping the route chunk lean. */}
      <KeepAliveTabsPanel value="charts" className="space-y-4">
        <Suspense fallback={<div className="h-60 rounded bg-muted/40 animate-pulse" />}>
          <ProjectChartsTab projectId={Number(id)} />
        </Suspense>
      </KeepAliveTabsPanel>

      {/* Зохиогчийн хяналт — талбайн хяналтын тайлангийн бүртгэл.
          ЗОРИУДААР `TabsContent`, `KeepAliveTabsPanel` БИШ: keep-alive
          панель нэг удаа mount болсны дараа хэзээ ч unmount болдоггүй
          тул 10-20 декодлогдсон зураг утасны санах ойд үлдэнэ.  Ноорог
          localStorage-д хадгалагддаг учир unmount аюулгүй. */}
      {showAsrTab && (
        <TabsContent value="asr" className="space-y-4">
          <Suspense fallback={<div className="h-60 rounded bg-muted/40 animate-pulse" />}>
            <AsrTab projectId={Number(id)} canCreate={canCreateAsr} />
          </Suspense>
        </TabsContent>
      )}
      {/* Бэлэн байдал — §69-ийн хаалга.  ЗОРИУДААР `TabsContent`,
          `KeepAliveTabsPanel` БИШ: хаалганы төлөв нь дүрмийн багц, багийн
          бүртгэл, олдворын төлөв гурвуулангаас хамаардаг тул mount-лагдсан
          хэвээр үлдэх нь ХУУЧИРСАН төлөвийг «одоогийн» мэт харуулна —
          энэ самбар дээр яг тэр нь хамгийн аюултай алдаа. */}
      <TabsContent value="readiness" className="space-y-4">
        <Suspense fallback={<div className="h-60 rounded bg-muted/40 animate-pulse" />}>
          <ReadinessPanel projectId={Number(id)} isManager={isAdmin} />
        </Suspense>
      </TabsContent>
    </KeepAliveTabs>
  );
}

export default ProjectTabs;
