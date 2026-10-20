import { lazy, Suspense } from 'react';
import { Routes, Route, Outlet, Navigate } from 'react-router-dom';

import { Layout } from '@/shared/components/Layout';
import { PageTransition } from '@/shared/components/motion';
import { ProtectedRoute } from '@/shared/components/ProtectedRoute';
import { BrandLoader } from '@/shared/components/BrandLoader';
import { AppErrorBoundary } from '@/shared/components/AppErrorBoundary';
import { NotFoundPage } from '@/shared/components/NotFoundPage';
import { PageSkeleton } from '@/shared/components/skeletons';
import AttendanceRoute from '@/features/attendance/AttendanceRoute';

// All page chunks are loaded on demand. The login page is the most
// common first paint for unauthenticated users so it is intentionally
// the smallest payload — every other page lives behind /api/auth and
// can wait for its own chunk.
const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const CompanyDashboardPage = lazy(() => import('@/features/dashboard/CompanyDashboardPage'));
// Компанийн TV самбар (kiosk wallboard) — оффисын зурагт дэлгэцэнд байнга
// нээлттэй байх full-screen, өөрөө эргэлддэг хувилбар.  Layout-аас гадуур,
// CompanyDashboardPage-тай адил session auth-аар.
const CompanyTvPage = lazy(() => import('@/features/dashboard/CompanyTvPage'));
const ProjectsPage = lazy(() => import('@/features/projects/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('@/features/projects/ProjectDetailPage'));
const AdminProjectSetupPage = lazy(() => import('@/features/projects/AdminProjectSetupPage'));
// Төслийн хуваарь — нэг мөр = нэг төсөл гэсэн огнооны тэнхлэг (portfolio
// Gantt) + мөрийн дэлгэрэнгүй самбар.  2026-08-13-наас ЭЦСИЙН ХУГАЦААНЫ
// хөндлөн гадаргуу мөн болсон (тусдаа `/app/deadlines` хуудас устсан).
// Уншихад admin+senior+engineer+architect; бичихэд ЗӨВХӨН admin — хуудас
// өөрөө role-оор хамгаална, backend нь жинхэнэ гэрч.
const TimelinePage = lazy(() => import('@/features/timeline/TimelinePage'));
const MyTasksPage = lazy(() => import('@/features/tasks/MyTasksPage'));
const UsersPage = lazy(() => import('@/features/users/UsersPage'));
const TeamsPage = lazy(() => import('@/features/teams/TeamsPage'));
// Хаалттай wrapper (admin/senior бүх баг, бусад зөвхөн өөрийн баг) — `TeamDetailPage`-ийг дотроо агуулна.
const TeamDetailPage = lazy(() => import('@/features/teams/TeamDetailRoute'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const ProfilePage = lazy(() => import('@/features/users/ProfilePage'));
const UserProfileViewPage = lazy(() => import('@/features/users/UserProfileViewPage'));
// Ирц — role-оор салаална (цэвэрлэгчид mobile-first хөнгөн хуудас).  Dispatcher
// нь хэдхэн мөр тул lazy биш; доторх хоёр хуудас нь тус тусдаа lazy.
const AttendanceAdminPage = lazy(() => import('@/features/attendance/AttendanceAdminPage'));
const LeaderboardPage = lazy(() => import('@/features/leaderboard/LeaderboardPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const ClientDashboardPage = lazy(() => import('@/features/client/ClientDashboardPage'));
const ClientInvitePage = lazy(() => import('@/features/client/ClientInvitePage'));
const ApprovalsPage = lazy(() => import('@/features/approvals/ApprovalsPage'));
// Мэдэгдлийн бүтэн хуудас — доод navbar-ын таб үүнийг зааж байгаа
// (толгойн bell popover нь зөвхөн сүүлийн 20-г харуулна).
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'));
// Санал хүсэлт — ажилтны санал/хүсэлт (header «Дүрэм» товчийг орлуулсан).
const SuggestionsPage = lazy(() => import('@/features/suggestions/SuggestionsPage'));
// Програмын хүсэлт (2026-10-16): reviewer-ийн inbox (эрхийг хуудас өөрөө + сервер шалгана) ба илгээгчийн өөрийн хүсэлт.
const EngineeringRequestsPage = lazy(() => import('@/features/engineering-feedback/EngineeringRequestsPage'));
const MyEngineeringRequestsPage = lazy(() => import('@/features/engineering-feedback/MyEngineeringRequestsPage'));
// MGL AI — чатын хуудас.  Инференс нь ажилтны PC дээрх локал runtime дээр
// явагдана (`features/mgl-ai/lib/runtime.ts`); Worker нь эрх, контекст,
// ERP хэрэгсэл, санал хүсэлтийг эзэмшинэ.
const MglAiPage = lazy(() => import('@/features/mgl-ai/MglAiPage'));
// MGL AI-ийн санал хүсэлтийн хяналт — §31-ийн «admin feedback review».
// ⚠️ Энэ хуудасгүйгээр ажилтны 👎 нь хаашаа ч хүрэхгүй мэт мэдрэгддэг байв.
const MglAiFeedbackPage = lazy(() => import('@/features/mgl-ai/MglAiFeedbackPage'));
// Session B — MGL AI флот / алдааны inbox / релиз (админ).
const MglAiFleetPage = lazy(() => import('@/features/mgl-ai-admin/MglAiFleetPage'));
const SystemWorkbenchPage = lazy(() => import('@/features/system-workbench/SystemWorkbenchPage'));
const TaskAllocationAdminPage = lazy(() => import('@/features/task-allocation/TaskAllocationAdminPage'));
// Print-only route consumed by Cloudflare Browser Rendering. Auth comes from
// a short-lived `?t=<jwt>` query param so it sits outside ProtectedRoute.
const ProjectPrintPage = lazy(() => import('@/features/projects/ProjectPrintPage'));
// User-initiated team report print (Тайлбар бичиг). Sits inside ProtectedRoute
// but outside Layout so the browser print preview is just the document. The
// `:teamCode` URL param routes to the active discipline's document.
const TeamReportPrintPage = lazy(() => import('@/features/projects/TeamReportPrintPage'));
// Зохиогчийн хяналтын хэвлэх хуудас — өөрийн chunk (A4 CSS + баримтын markup).
const AsrPrintPage = lazy(() => import('@/features/projects/AsrPrintPage'));
const AsrSummaryPrintPage = lazy(() => import('@/features/asr/summary/AsrSummaryPrintPage'));
// «Баримт бичиг» дээрх Word баримтыг хэвлэх / PDF болгох (гарын үсэгтэй RFI г.м.)
// — хөтчийн хэвлэх цонх; Layout-ийн гадна.
const DrivePrintPage = lazy(() => import('@/features/projects/drive/DrivePrintPage'));
// Зохиогчийн хяналт — бүх төслийн хөндлөн жагсаалт.  Төслийн доторх
// `AsrTab` хэвээр байна; энэ нь түүнийг ОРЛОХГҮЙ, хоёулаа нэг
// `AsrEditorShell`-ийг дуудна.
const AsrPage = lazy(() => import('@/features/asr/AsrPage'));
// Хуучин ЗХ тайлан нөхөж бүртгэх (admin/senior) — Drive хавтсын файлуудаас.
const AsrBackfillPage = lazy(() => import('@/features/asr/backfill/AsrBackfillPage'));
// Revit «Өөрчлөхөөс өмнө» — элемент зөөгдөхөд мөргөлдсөн элементийн зохиогчдод ирэх мэдэгдэл (0390).
const DocumentsPage = lazy(() => import('@/features/projects/DocumentsPage'));
const ProjectDriveDocumentsPage = lazy(
  () => import('@/features/projects/drive/ProjectDriveDocumentsPage'),
);
const ProjectExplorerPage = lazy(
  () => import('@/features/projects/documents/ProjectExplorerPage'),
);
// Project-wide periodic performance report (Гүйцэтгэлийн тайлан) — list +
// draft editor sits inside the staff app; print page renders the multi-page
// PDF via Browser Rendering (auth via short-lived `?t=<jwt>`).
const PerformanceReportsPage = lazy(
  () => import('@/features/performance-reports/PerformanceReportsPage'),
);
const PerformanceReportEditorPage = lazy(
  () => import('@/features/performance-reports/PerformanceReportEditorPage'),
);
const PerformanceReportPrintPage = lazy(
  () => import('@/features/performance-reports/PerformanceReportPrintPage'),
);
// Public marketing site (mglenc.com replacement) + its admin CMS.  Landing
// lives at the root so visitors and bookmarks land on the corporate page;
// the operational app moved under `/app/*`.
//
// ТҮР: CMS-тэй LandingPage-ийн оронд LetterGlitch дэвсгэртэй хөнгөн нүүр
// (GlitchLandingPage) тавьсан.  Буцаахдаа доорх `/` route-ын element-ийг
// LandingPage руу эргүүлж залгана — LandingPage + CMS өгөгдөл бүгд хэвээр.
const GlitchLandingPage = lazy(() => import('@/features/landing/GlitchLandingPage'));
const LandingProjectDetailPage = lazy(() => import('@/features/landing/LandingProjectDetailPage'));
const AdminLandingPage = lazy(() => import('@/features/landing/AdminLandingPage'));
const ReportTemplatesPage = lazy(() => import('@/features/report-templates/ReportTemplatesPage'));
const TeamFormTemplatesPage = lazy(
  () => import('@/features/report-templates/TeamFormTemplatesPage'),
);
// Захидлын триаж (Gmail feeder) + хайрцгуудын админ.  Ирсэн мэйлийг төсөл +
// баримтын төрөлд ангилж correspondence бүртгэлд оруулна.
const MailInboxPage = lazy(() => import('@/features/email/MailInboxPage'));
const EmailAccountsAdminPage = lazy(() => import('@/features/email/EmailAccountsAdminPage'));
// Хурлын тэмдэглэл — voice meeting upload → Speechmatics transcription → AI
// analysis (admin-tier).  List + per-meeting detail.
const MeetingNotesPage = lazy(() => import('@/features/meeting-notes/MeetingNotesPage'));
const MeetingDetailPage = lazy(() => import('@/features/meeting-notes/MeetingDetailPage'));
// Printable meeting minutes — public route, auth via short-lived ?t=<jwt>
// (Browser Rendering drives it for GET /api/meetings/:id/pdf).
const MeetingPrintPage = lazy(() => import('@/features/meeting-notes/MeetingPrintPage'));
// MCP гарын авлага — зөвхөн admin-tier; Claude-ийн жишээ prompt-уудыг хуулах.
const McpGuidePage = lazy(() => import('@/features/mcp-guide/McpGuidePage'));
// Тоо хэмжээ / BOQ — дээд түвшний хэсэг (бүх төслийн IFC тоо хэмжээ).  Зөвхөн
// admin + senior; хуудас өөрөө мөн role-оор хамгаална.
const QtoPage = lazy(() => import('@/features/qto/QtoPage'));
// Үнийн санал v2 — Excel шиг чөлөөт хуудас + БД 81-16-20 тарифын каталог (admin-only).
// ⚠️ Жагсаалт / загвар / тарифын хуудсууд нь `QuotesPage`-ийн ДОТОР таб болж
// орсон тул энд тусад нь lazy-дахгүй — `QuotesPage` өөрөө тэднийг lazy-ээр
// дуудна (нээгээгүй табын chunk татагдахгүй).
const QuotesPage = lazy(() => import('@/features/quotes/QuotesPage'));
const QuoteEditorPage = lazy(() => import('@/features/quotes/QuoteEditorPage'));
const QuotePrintPage = lazy(() => import('@/features/quotes/QuotePrintPage'));
// RFI/CR бичгийн хэвлэх хуудас — сервер PDF (Browser Rendering) + захиалагчийн токеноор ч ачаалагдана.
const CorrespondencePrintPage = lazy(() => import('@/features/projects/CorrespondencePrintPage'));
// Login-гүй, хугацаатай bearer link-ээр RFI/CR эсвэл ЗХ тайланд гарын үсэг зурах mobile-first page.
const PublicSigningPage = lazy(() => import('@/features/signing/PublicSigningPage'));
// Гаднын хүний гарын үсэгтэй Word баримтыг сервер PDF болгох хуудас (хүн нээдэггүй — Browser Rendering).
const PublicSigningPrintPage = lazy(() => import('@/features/signing/PublicSigningPrintPage'));
// «Төслийн мэдээлэл» (паспорт) хэвлэх хуудас — «Мэдээлэл» таб ба захиалагчийн порталаас.
const PassportPrintPage = lazy(() => import('@/features/projects/PassportPrintPage'));
// Revit нэмэлт татах + суулгах заавар — одоохондоо зөвхөн эзэмшигч (user id 1);
// хуудас өөрөө id-гаар хамгаална.
const RevitAddinPage = lazy(() => import('@/features/revit-addin/RevitAddinPage'));
// Revit туслахын СУРГАЛТЫН КУРАЦИ (admin + senior) — хэрэглээний бүртгэлийг
// шошголж сургалтын багц болгодог ГАНЦ клиент.  Хуудас өөрөө role-оор
// хамгаална; жинхэнэ хаалга нь backend-ийн `isManager()`.
const AssistantCurationPage = lazy(
  () => import('@/features/revit-assistant/AssistantCurationPage'),
);
// Ур чадварын үнэлгээ — бөглөх wizard (профайлаас нээгдэнэ) + админы удирдлага.
// Хоёулаа өөрсдийн chunk-тай: wizard нь motion/анимэйшн, админ нь recharts +
// exceljs чирдэг тул нэг ч байт нь бусад хуудсанд наалдах ёсгүй.
// Гарын авлага — «миний албан тушаалд, миний түвшинд юу шаардагдах вэ».
// Уншигчийн хуудас бүх staff-д; засварлагч нь зөвхөн admin (хуудас өөрөө
// мөн role-оор хамгаална, сервер тал requireAdmin-тэй).
const HandbookPage = lazy(() => import('@/features/handbook/HandbookPage'));
const HandbookAdminPage = lazy(() => import('@/features/handbook/HandbookAdminPage'));
const InternalRulesPage = lazy(() => import('@/features/internal-rules/InternalRulesPage'));
const InternalRuleReadPage = lazy(() => import('@/features/internal-rules/InternalRuleReadPage'));
const InternalRuleEditorPage = lazy(() => import('@/features/internal-rules/InternalRuleEditorPage'));
const AnnouncementsPage = lazy(() => import('@/features/announcements/AnnouncementsPage'));
const AnnouncementReadPage = lazy(() => import('@/features/announcements/AnnouncementReadPage'));
const PublicInfoAdminPage = lazy(() => import('@/features/announcements/PublicInfoAdminPage'));
const AnnouncementEditorPage = lazy(() => import('@/features/announcements/AnnouncementEditorPage'));
const AssessmentFillPage = lazy(() => import('@/features/assessments/AssessmentFillPage'));
const MyResultChartsPage = lazy(() => import('@/features/assessments/MyResultChartsPage'));
const AssessmentAdminPage = lazy(() => import('@/features/assessments/admin/AssessmentAdminPage'));
const TemplateEditorPage = lazy(() => import('@/features/assessments/admin/TemplateEditorPage'));
const RoundResultsPage = lazy(() => import('@/features/assessments/admin/RoundResultsPage'));
const ParticipantResultPage = lazy(() => import('@/features/assessments/admin/ParticipantResultPage'));

/**
 * `/app/*`-ийн бүрхүүл.
 *
 * Гурван давхарга, дараалал нь чухал:
 *  1. `Layout` — sidebar / header / доод navbar. ХЭЗЭЭ Ч unmount болохгүй.
 *  2. `PageTransition` — pathname-ээр key авдаг тул шилжих бүрд доторх
 *     бүхнийг remount хийнэ. Ингэснээр 3, 4-р давхарга өөрсдөө цэвэрлэгдэнэ.
 *  3. `AppErrorBoundary scope="route"` — хуудас render-ийн алдаа гаргавал
 *     ЗӨВХӨН агуулгын хэсэг унана. Өмнө нь ганцхан аппын түвшний boundary
 *     байсан тул нэг хуудасны алдаа sidebar хүртэл бүх дэлгэцийг цайлгаж,
 *     хэрэглэгчид гарах зам үлдээдэггүй байв.
 *  4. `Suspense` — маршрутын chunk ачаалж байх үед `PageSkeleton`. Өмнө нь
 *     ганц гадаад boundary байсан тул хуудас солих бүрд бүтэн дэлгэцийн
 *     BrandLoader гарч, бүрхүүл нүдэнд алга болдог байв.
 */
function AppShell() {
  return (
    <Layout>
      <PageTransition>
        <AppErrorBoundary scope="route">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </AppErrorBoundary>
      </PageTransition>
    </Layout>
  );
}

/**
 * The full route tree. The outer Suspense boundary covers the public routes and
 * the very first paint; `/app/*` has its own finer-grained boundary (AppShell)
 * so navigating inside the app keeps the shell on screen. Rendered inside
 * <BrowserRouter> by main.tsx.
 */
export function AppRoutes() {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<BrandLoader />}>
        <Routes>
        {/* Public-facing routes. `/` is the marketing site,
            `/login` is the staff door, and the print routes
            take their auth from short-lived query tokens. */}
        <Route path="/" element={<GlitchLandingPage />} />
        {/* Public per-project detail. `/work/:id` rather than
            `/projects/:id` because the latter is reserved by
            the legacy staff-app redirects below. */}
        <Route path="/work/:id" element={<LandingProjectDetailPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sign/:token" element={<PublicSigningPage />} />
        <Route path="/sign/:token/print" element={<PublicSigningPrintPage />} />
        <Route path="/reports/project/:id/print" element={<ProjectPrintPage />} />
        <Route
          path="/reports/project/:id/performance-report/:reportId/print"
          element={<PerformanceReportPrintPage />}
        />
        {/* Printable meeting minutes (Хурлын тэмдэглэл) — same ?t=<jwt> pattern. */}
        <Route path="/meetings/:id/print" element={<MeetingPrintPage />} />
        {/* Үнийн саналын хэвлэх хуудас — A4 хэвтээ. Серверийн PDF (BROWSER
            binding) энэ URL-ийг `?t=<jwt>`-тэй ачаалдаг тул Layout болон
            ProtectedRoute-оос ГАДНА байх ёстой; токеныг main.tsx-ийн
            bridgePrintToken() localStorage руу хуулна. */}
        <Route path="/quotes/:id/print" element={<QuotePrintPage />} />
        {/* RFI/CR бичиг — `backend/lib/correspondencePdf.ts` энэ хаягийг `?t=`-тэй
            ачаалдаг; захиалагч зурсны дараах дахин рендер ЗАХИАЛАГЧИЙН токеноор
            явдаг тул ProtectedRoute-ийн (client sandbox) ГАДНА байх ёстой. */}
        <Route path="/correspondence/:id/print" element={<CorrespondencePrintPage />} />
        {/* Төслийн мэдээлэл (паспорт) — захиалагчийн портал ч хэвлэдэг тул
            RFI/CR-тэй ижил шалтгаанаар ProtectedRoute-ийн ГАДНА. */}
        <Route path="/reports/project/:id/passport/print" element={<PassportPrintPage />} />

        {/* Захиалагчийн урилга — нэвтрээгүй хүн ирдэг тул ProtectedRoute-ЫН
            ГАДНА.  Токен нь серверийн KV дэх нэг удаагийн түлхүүр
            (backend lib/clientInvite.ts). */}
        <Route path="/client/invite/:token" element={<ClientInvitePage />} />
        <Route path="/client/reset/:token" element={<ClientInvitePage />} />

        <Route element={<ProtectedRoute />}>
          {/* Client persona has its own minimal shell (no staff
              sidebar) — `ProtectedRoute` keeps clients in here
              and staff out. */}
          <Route path="/client" element={<ClientDashboardPage />} />

          {/* Per-team Тайлбар бичиг print view — full viewport, browser-print PDF. */}
          <Route
            path="/app/projects/:id/team-reports/:teamCode/print"
            element={<TeamReportPrintPage />}
          />

          {/* Зохиогчийн хяналтын тайлангийн хэвлэх хуудас — Layout-ийн гадна,
              хэрэглэгчийн window.print()-ээр л ажиллана (сервер PDF байхгүй). */}
          <Route path="/app/projects/:id/asr/:reportId/print" element={<AsrPrintPage />} />

          {/* ЗХ-ийн НЭГТГЭЛ тайлан (admin) — хэвлэх / серверийн PDF (`GET /author-supervision/summary/pdf`
              энэ хаяг руу `?t=`-ээр орно).  `/app/asr/:id`-ээс илүү урт тул мөргөлдөхгүй. */}
          <Route path="/app/asr/summary/print" element={<AsrSummaryPrintPage />} />

          {/* Drive-ын Word баримт (гарын үсэгтэй RFI) — хэвлэх / PDF, Layout-ийн гадна. */}
          <Route path="/app/drive-print/:scope/:id/:fileId" element={<DrivePrintPage />} />

          {/* Landing-CMS editor — full viewport, no staff sidebar.
              The CMS already has its own three-pane chrome (pages
              sidebar / block list / preview); the staff Layout's
              sidebar would squash all of it. */}
          <Route path="/app/admin/landing" element={<AdminLandingPage />} />

          {/* Report templates admin — full-viewport like the
              landing CMS so the block editor isn't squeezed. */}
          <Route path="/app/admin/report-templates" element={<ReportTemplatesPage />} />

          {/* Performance-report editor — same full-viewport
              treatment as the landing CMS: block list + per-block
              forms + live preview without the staff sidebar
              shrinking everything. */}
          <Route
            path="/app/projects/:id/performance-reports/:reportId/edit"
            element={<PerformanceReportEditorPage />}
          />

          {/* Per-team form template overrides editor. */}
          <Route path="/app/admin/team-form-templates" element={<TeamFormTemplatesPage />} />

          {/* Компанийн TV самбар — full-viewport kiosk wallboard.  Layout-аас
              гадуур, өөрөө эргэлддэг scene-үүдтэй.  Зурагтан дээр нэг удаа
              session-оор нэвтэрч орхиход хангалттай. */}
          <Route path="/app/tv" element={<CompanyTvPage />} />

          {/* The operational app — everything that used to live at
              `/` now lives under `/app/*`.  The marketing landing
              took the root URL, and the protected shell follows. */}
          <Route path="/app" element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            {/* Company dashboard — бусад хуудсуудтай адил sidebar+header-тэй;
                өгөгдөл шигүү grid нь Layout-ийн FULL_BLEED жагсаалтад орсон тул
                max-width хайрцагт шахагдахгүй, өөрийн дотоод scroll-тэй. */}
            <Route path="company" element={<CompanyDashboardPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="projects/:id/setup" element={<AdminProjectSetupPage />} />
            <Route path="projects/:id/performance-reports" element={<PerformanceReportsPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            {/* Нэг төслийн Google Drive хавтас — `documents/:archiveId`-ээс ӨМНӨ
                (тэр нь архивын тоон id; `project/<id>` хоёр сегменттэй тул мөргөлдөхгүй). */}
            <Route path="documents/project/:id" element={<ProjectDriveDocumentsPage scope="project" />} />
            <Route path="documents/main/:id" element={<ProjectDriveDocumentsPage scope="main" />} />
            <Route path="documents/:archiveId" element={<ProjectExplorerPage />} />
            {/* Төслийн хуваарь — хуудас өөрөө role-оор хамгаална. */}
            <Route path="timeline" element={<TimelinePage />} />
            {/* `/app/deadlines` нь 2026-08-13-нд УСТСАН (тусдаа «Хугацаа»
                хуудас).  Замыг үлдээж хуваарь руу шилжүүлнэ: DB-д хуучин
                мэдэгдэл, хадгалсан холбоос, гар утасны shortcut үлдсэн тул
                404 өгвөл хэрэглэгч «алга болжээ» гэж ойлгоно. */}
            <Route path="deadlines" element={<Navigate to="/app/timeline" replace />} />
            {/* Тоо хэмжээ / BOQ (admin+senior) — хуудас өөрөө role-оор хамгаална. */}
            <Route path="qto" element={<QtoPage />} />
            {/* Зохиогчийн хяналт — бүх төслийн хөндлөн жагсаалт.  `:reportId`
                нь зөвхөн НЭМЭЛТ гүнзгий линк: мэдэгдлүүд одоо ч
                `/app/projects/:id?tab=asr&asr=<id>` руу заадаг бөгөөд DB-д
                хуучин мэдэгдлүүд үлдсэн тул тэр зам ажилласаар байх ЁСТОЙ.
                Эрхийг backend хариуцна (client бүх endpoint дээр 403,
                `worker` нь `workerScope.ts`-ийн allowlist-д байхгүй). */}
            <Route path="asr" element={<AsrPage />} />
            {/* `asr/backfill` нь `asr/:reportId`-ээс ӨМНӨ — статик сегмент түрүүлнэ. */}
            <Route path="asr/backfill" element={<AsrBackfillPage />} />
            <Route path="asr/:reportId" element={<AsrPage />} />
            {/* Revit-ийн өөрчлөлтийн мэдэгдэл — `?id=` нь дэлгэрэнгүй (мэдэгдлийн холбоос). */}
            <Route path="my-tasks" element={<MyTasksPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            {/* Санал хүсэлт — бүх staff илгээж/хардаг, admin шийдвэрлэнэ. */}
            <Route path="suggestions" element={<SuggestionsPage />} />
            <Route path="engineering-requests" element={<EngineeringRequestsPage />} />
            <Route path="my-engineering-requests" element={<MyEngineeringRequestsPage />} />
            <Route path="mgl-ai" element={<MglAiPage />} />
            <Route path="admin/mgl-ai-feedback" element={<MglAiFeedbackPage />} />
            <Route path="admin/mgl-ai-fleet" element={<MglAiFleetPage />} />
            <Route path="admin/task-allocation" element={<TaskAllocationAdminPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="users/:id" element={<UserProfileViewPage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="teams/:id" element={<TeamDetailPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            {/* Гарын авлага — бүх staff уншина (сервер нь role + published-оор
                шүүсэн мөрүүдийг л буцаана).  Админы засварлагч нь тусдаа. */}
            <Route path="handbook" element={<HandbookPage />} />
            <Route path="admin/handbook" element={<HandbookAdminPage />} />
            {/* «Нийтийн мэдээлэл» бүлэг (2026-09-23): «Мэдээ, зарлал»
                (`announcements`, миграц 0338) + «Дотоод журам» (`rules`,
                миграц 0330) + «Удирдлага» (`admin/announcements`) — хоёр
                модулийг НЭГ газраас удирдах админы хуудас (`?tab=announcements
                |rules`).  Ажилтан уншиж, шаардлагатай бол чагт эсвэл профайлын
                гарын үсгээр баталгаажуулна.  Эрхийг backend хариуцна
                (`requireAdmin`, client/worker 403). */}
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="announcements/:id" element={<AnnouncementReadPage />} />
            <Route path="admin/announcements" element={<PublicInfoAdminPage />} />
            <Route path="admin/announcements/:id" element={<AnnouncementEditorPage />} />
            <Route path="rules" element={<InternalRulesPage />} />
            <Route path="rules/:id" element={<InternalRuleReadPage />} />
            {/* Хуучин тусдаа «Дотоод журам удирдах» хуудас → «Удирдлага»-ын
                «Дотоод журам» таб.  Хавчуурга / хуучин холбоос эвдрэхгүйн
                тулд үлдээв. */}
            <Route
              path="admin/rules"
              element={<Navigate to="/app/admin/announcements?tab=rules" replace />}
            />
            {/* Журам бичих/засах (2026-09-25) — мэдээний засварлагч + файл
                хавсралт; `new` = шинэ журам. */}
            <Route path="admin/rules/:id" element={<InternalRuleEditorPage />} />
            {/* Ур чадварын үнэлгээний маягт бөглөх — профайлын «Ур чадварын
                үнэлгээ» табаас (`?tab=assessment`) ирнэ.  Эрхийг backend
                хариуцна: маягтын эзэн (self / senior) эсвэл admin. */}
            <Route path="assessments/:responseId" element={<AssessmentFillPage />} />
            {/* Ажилтны өөрийн үр дүн — level-band график (тоо/хувь БАЙХГҮЙ).
                Гурван сегменттэй тул дээрх `assessments/:responseId`-тай
                зөрчилдөхгүй (өөр урттай зам). */}
            <Route path="assessments/results/:roundId" element={<MyResultChartsPage />} />
            {/* Үнэлгээний админ — судалгааны ээлж, загвар, үр дүн (admin-only;
                backend нь мөн requireAdmin-ээр хамгаална). */}
            <Route path="admin/assessments" element={<AssessmentAdminPage />} />
            {/* Асуулгын бүтэн дэлгэцийн засварлагч.  «templates» гэсэн ТОГТМОЛ
                сегменттэй тул доорх `:roundId` (тоо) загвартай зөрчилдөхгүй —
                React Router тогтмолыг параметрээс түрүүлж сонгодог. */}
            <Route
              path="admin/assessments/templates/:templateId"
              element={<TemplateEditorPage />}
            />
            <Route path="admin/assessments/:roundId" element={<RoundResultsPage />} />
            <Route path="admin/assessments/:roundId/:userId" element={<ParticipantResultPage />} />
            <Route path="attendance" element={<AttendanceRoute />} />
            {/* Ирцийн админ самбар — ЗӨВХӨН admin.  Энэ хуудас нь `UsersPage` /
                `AssessmentAdminPage`-аас ялгаатай нь өөрөө ролио шалгадаггүй
                байсан тул инженер/архитектор URL бичээд орж чаддаг байв: хуудасны
                хүрээ зурагдаад query бүр 403 болж, бүх хүснэгт хоосон гардаг —
                эвдэрсэн мэт харагдана (өгөгдөл алдагдахгүй, backend хамгаална).
                5,000 мөрийн компонентод эрт `return` тавихын оронд `ProtectedRoute`-ийн
                `allowedRoles` prop-ыг ашиглав — тэр нь яг үүний төлөө бичигдсэн
                мөртлөө өнөөг хүртэл нэг ч дуудагчгүй байсан. */}
            <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
              <Route path="attendance/admin" element={<AttendanceAdminPage />} />
              {/* «Тайлан» — ажилтан/багийн гүйцэтгэл + HR карт; зөвхөн admin (CEO мөн admin). */}
              <Route path="reports" element={<ReportsPage />} />
              {/* Internal architecture/code workbench. Admin-only in both router and API. */}
              <Route path="admin/system-workbench" element={<SystemWorkbenchPage />} />
            </Route>
            {/* `/app/overtime` — 2026-08-12-нд sidebar-ын мөр ба хуудас нь
                хасагдсан.  Журмын мэдэгдэл нь одоо ирцийн хуудсан дээрх
                `MyOvertimeCard` дотор амьдардаг тул хуучин холбоос/bookmark-ыг
                404 болгохын оронд тийш нь чиглүүлнэ. */}
            <Route path="overtime" element={<Navigate to="/app/attendance" replace />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            {/* Захидлын триаж + Gmail хайрцгуудын админ (admin-tier). */}
            <Route path="mail" element={<MailInboxPage />} />
            <Route path="admin/email" element={<EmailAccountsAdminPage />} />
            {/* Хурлын тэмдэглэл (admin-tier). */}
            <Route path="meeting-notes" element={<MeetingNotesPage />} />
            <Route path="meeting-notes/:id" element={<MeetingDetailPage />} />
            {/* MCP гарын авлага (admin-tier) — хуудас өөрөө мөн role-оор хамгаална. */}
            <Route path="mcp-guide" element={<McpGuidePage />} />
            {/* Revit нэмэлт татах (одоохондоо зөвхөн id 1) — хуудас өөрөө id-гаар хамгаална. */}
            <Route path="revit-addin" element={<RevitAddinPage />} />
            {/* Туслахын сургалтын кураци (admin + senior).  `allowedRoles`-ыг
                ЗОРИУД ашиглаагүй — тэр prop нь апп даяар ганц газар
                (`attendance/admin`) хэрэглэгддэг; хуудас өөрөө ролио шалгаад
                `/app` руу буцаана, backend нь 403-оор жинхэнэ хаалга барина. */}
            <Route path="admin/assistant" element={<AssistantCurationPage />} />
            {/* Толгойн гүйдэг мэдээ (admin).  Хуудас өөрөө ролио шалгаад
                `/app` руу буцаана, backend нь `requireAdmin()`-ээр жинхэнэ
                хаалга барина. */}
            {/* Гүйдэг мэдээний админ 2026-09-18-нд Тохиргоо руу нүүсэн
                (`features/ticker/TickerAdminCard`) — хуучин хаяг/хавчуурга
                тэр хэсэг рүү үсэрнэ. */}
            <Route
              path="admin/ticker"
              element={<Navigate to="/app/settings?section=settings-ticker" replace />}
            />
            {/* Үнийн санал (admin-only; backend нь мөн requireAdmin-ээр хамгаална). */}
            <Route path="quotes" element={<QuotesPage />} />
            <Route path="quotes/:id" element={<QuoteEditorPage />} />
            {/* Хуучин тусдаа маршрутууд → нэгдсэн хуудасны тохирох таб руу.
                Хадгалсан хавчуурга / гадаад лавлагаа эвдрэхгүйн тулд үлдээв. */}
            <Route
              path="admin/quotes/template"
              element={<Navigate to="/app/quotes?tab=templates" replace />}
            />
            <Route
              path="admin/quotes/tariffs"
              element={<Navigate to="/app/quotes?tab=tariffs" replace />}
            />
            {/* `/app/*` доторх таарахгүй зам — бүрхүүл хэвээр үлдэж,
                хэрэглэгч sidebar-аараа гарч чадна. */}
            <Route path="*" element={<NotFoundPage inShell />} />
          </Route>

          {/* Legacy redirects — anyone holding a bookmark to the
              pre-CMS URL (`/projects`, `/teams/3`, etc.) gets
              bounced into the new `/app/*` shell without losing
              their path or query. */}
          <Route path="/company" element={<Navigate to="/app/company" replace />} />
          <Route path="/projects" element={<Navigate to="/app/projects" replace />} />
          <Route path="/projects/:id" element={<Navigate to="/app/projects" replace />} />
          <Route path="/my-tasks" element={<Navigate to="/app/my-tasks" replace />} />
          <Route path="/approvals" element={<Navigate to="/app/approvals" replace />} />
          <Route path="/users" element={<Navigate to="/app/users" replace />} />
          <Route path="/users/:id" element={<Navigate to="/app/users" replace />} />
          <Route path="/teams" element={<Navigate to="/app/teams" replace />} />
          <Route path="/settings" element={<Navigate to="/app/settings" replace />} />
          <Route path="/profile" element={<Navigate to="/app/profile" replace />} />
          <Route path="/attendance" element={<Navigate to="/app/attendance" replace />} />
          <Route path="/leaderboard" element={<Navigate to="/app/leaderboard" replace />} />
        </Route>

        {/* Дээд түвшний catch-all. Үүнгүйгээр таарахгүй зам ЮУ Ч
            рендерддэггүй байсан — хэрэглэгч цоо хоосон дэлгэц хараад
            гацдаг байв. ProtectedRoute-ийн ГАДНА байгаа нь санаатай:
            нэвтрээгүй хүн буруу холбоос дарахад /login руу дамжихын
            оронд ойлгомжтой 404 харна. */}
        <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
