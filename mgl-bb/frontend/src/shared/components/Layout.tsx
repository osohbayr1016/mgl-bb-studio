import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { useTheme, type ResolvedTheme } from '@/shared/context/ThemeContext';
import {
  ArrowLeft,
  LayoutDashboard,
  FolderKanban,
  FileText,
  ListCheck,
  Users,
  Settings,
  LogOut,
  Globe,
  ChevronRight,
  ChevronsUpDown,
  Building2,
  Calculator,
  CalendarRange,
  FileSpreadsheet,
  HardHat,
  BarChart3,
  Clock,
  FileBarChart2,
  Megaphone,
  Sun,
  Moon,
  Contrast,
  // Globe2, // түр идэвхгүй — Landing CMS nav-ийг доор нуусан
  Mail,
  Mic,
  // ClipboardCheck, // sidebar-аас хассан — Хэрэглэгчид таб дотор
  Lightbulb,
  Puzzle,
  RefreshCw,
  Search,
  UserRound,
  X,
  type LucideIcon,
  Sparkles,
  Radar,
  LifeBuoy,
  Bug,
} from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { Button } from '@/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/ui/breadcrumb';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Separator } from '@/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/ui/sidebar';
import { cn } from '@/shared/lib/utils';
import { formatDisplayName, formatProjectShortName } from '@/shared/lib/formatting';
import { isCeo } from '@/shared/lib/ceo';
import { isWorkerRole, roleLabelKey } from '@/shared/lib/roles';
import { APP_SECTIONS, cleanSectionLabel } from '@/shared/lib/search/sections';
import {
  findHighlight,
  prepareSearchEntries,
  rankSearchEntries,
  type SearchEntry,
} from '@/shared/lib/search/rank';
import { useApiQuery } from '@/shared/api/useApi';
import type { ProjectOption } from '@/shared/types';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import NotificationBell from '@/shared/components/NotificationBell';
import { SidebarProfileBlock } from '@/shared/components/SidebarProfileBlock';
import WeatherWidget from '@/shared/components/WeatherWidget';
import { EF_SUBMITTER_ROLES, useEfCapabilities } from '@/features/engineering-feedback/useEfCapabilities';
import HeaderTicker from '@/shared/components/HeaderTicker';
import NotificationsManager from '@/shared/components/NotificationsManager';
import MonthConfirmPrompt from '@/features/attendance/components/MonthConfirmPrompt';
import { DailyLogNote } from '@/features/daily-log/DailyLogNote';
import { MobileBottomNav } from '@/shared/components/MobileBottomNav';
import { QuickActionSheet } from '@/shared/components/QuickActionSheet';
import { InstallPrompt } from '@/shared/components/InstallPrompt';
import { UpdatePrompt } from '@/shared/components/UpdatePrompt';
import { CursorSpotlight } from '@/shared/components/motion';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useGoBack } from '@/shared/hooks/useGoBack';
import { useScrollRestoration } from '@/shared/hooks/useScrollRestoration';
import { useSectionAnchor } from '@/shared/hooks/useSectionAnchor';
import { useMglAiPrewarm } from '@/shared/hooks/useMglAiPrewarm';
import { usePullToRefresh } from '@/shared/hooks/usePullToRefresh';
import { checkForAppUpdate } from '@/shared/lib/serviceWorker';
import { TaskAllocGateBanner } from '@/features/task-allocation/TaskAllocGateBanner';
import { useUnreadCount } from '@/shared/api/notifications';
import { brand } from '@/shared/config/brand';
import { moduleEnabled, type ModuleId } from '@/shared/config/modules';
import { useEnabledModules } from '@/shared/config/useModules';

// Маршрут → орчуулгын түлхүүр. Гарчгийг хэлээр сэлгэхийн тулд эндээс шууд
// текст биш, `t()`-ээр шийдэгдэх key-г хадгална.
const PAGE_TITLE_KEYS: Record<string, string> = {
  '/app': 'pageTitle.dashboard',
  '/app/company': 'pageTitle.company',
  '/app/projects': 'pageTitle.projects',
  '/app/documents': 'pageTitle.documents',
  '/app/timeline': 'pageTitle.timeline',
  '/app/qto': 'pageTitle.qto',
  '/app/quotes': 'pageTitle.quotes',
  '/app/my-tasks': 'pageTitle.myTasks',
  '/app/suggestions': 'pageTitle.suggestions',
  '/app/notifications': 'pageTitle.notifications',
  '/app/users': 'pageTitle.users',
  '/app/settings': 'pageTitle.settings',
  '/app/profile': 'pageTitle.profile',
  '/app/teams': 'pageTitle.teams',
  '/app/attendance': 'pageTitle.attendance',
  '/app/attendance/admin': 'pageTitle.attendanceAdmin',
  '/app/leaderboard': 'pageTitle.leaderboard',
  '/app/reports': 'pageTitle.reports',
  '/app/admin/landing': 'pageTitle.landingCms',
  '/app/admin/report-templates': 'pageTitle.reportTemplates',
  '/app/admin/team-form-templates': 'pageTitle.teamFormTemplates',
  '/app/mail': 'pageTitle.mail',
  '/app/admin/email': 'pageTitle.emailAccounts',
  '/app/meeting-notes': 'pageTitle.meetingNotes',
  '/app/mcp-guide': 'pageTitle.mcpGuide',
  '/app/revit-addin': 'pageTitle.revitAddin',
  '/app/admin/assistant': 'pageTitle.assistantCuration',
  '/app/admin/assessments': 'pageTitle.assessments',
  '/app/handbook': 'pageTitle.handbook',
  '/app/admin/handbook': 'pageTitle.handbookAdmin',
  '/app/asr': 'pageTitle.asr',
  '/app/mgl-ai': 'pageTitle.mglAi',
  '/app/admin/mgl-ai-feedback': 'pageTitle.mglAiFeedback',
  '/app/admin/mgl-ai-fleet': 'pageTitle.mglAiFleet',
  '/app/admin/system-workbench': 'pageTitle.systemWorkbench',
  '/app/admin/task-allocation': 'pageTitle.taskAllocation',
  '/app/engineering-requests': 'pageTitle.engineeringRequests',
  '/app/my-engineering-requests': 'pageTitle.myEngineeringRequests',
  '/app/rules': 'pageTitle.rules',
  '/app/announcements': 'pageTitle.announcements',
  '/app/admin/announcements': 'pageTitle.announcementsAdmin',
};

function usePageTitleKey() {
  const location = useLocation();
  const exact = PAGE_TITLE_KEYS[location.pathname];
  if (exact) return exact;
  if (location.pathname.startsWith('/app/documents/')) return 'pageTitle.documents';
  if (location.pathname.startsWith('/app/rules/')) return 'pageTitle.rules';
  // `/app/asr/:projectId` (төслийн ЗХ ажлын талбар) + `/app/asr/backfill`.
  if (location.pathname.startsWith('/app/asr/')) return 'pageTitle.asr';
  if (location.pathname.startsWith('/app/admin/announcements/')) return 'pageTitle.announcementsAdmin';
  if (location.pathname.startsWith('/app/announcements/')) return 'pageTitle.announcements';
  if (location.pathname.startsWith('/app/admin/assessments/')) return 'pageTitle.assessments';
  if (location.pathname.startsWith('/app/quotes/')) return 'pageTitle.quotes';
  if (location.pathname.startsWith('/app/projects/') && location.pathname.endsWith('/setup'))
    return 'pageTitle.projectSetup';
  if (location.pathname.startsWith('/app/projects/')) return 'pageTitle.projectDetail';
  return 'pageTitle.default';
}

type NavChild = {
  to: string;
  /** Орчуулгын түлхүүр — СТАТИК дэд цэсэнд (Ирсэн захидал, Тарифын каталог…). */
  labelKey?: string;
  /** Бэлэн текст — ДИНАМИК дэд цэсэнд (төслийн нэр).  Өгөгдлөөс ирдэг тул
   *  орчуулга байхгүй; `labelKey`-г дарж бичнэ. */
  label?: string;
  /** Товчилсон `label`-ийн БҮТЭН эх хувилбар — tooltip-д.  Төслийн нэрнээс
   *  `MGL-YYMMDD_` кодыг харагдацад хассан ч код нь ажлын харилцаанд
   *  хэрэглэгддэг тул хаа нэгтээ бүтнээрээ байх ёстой. */
  fullLabel?: string;
  /** Хоосон бол эцгийнхээ эрхийг өвлөнө. */
  roles?: string[];
};

/** Дэд мөрний харагдах нэр — динамик `label` эхэлж, дараа нь i18n түлхүүр. */
const navChildLabel = (c: NavChild, t: (k: string) => string): string =>
  c.label ?? (c.labelKey ? t(c.labelKey) : '');

/**
 * Sidebar-ийн семантик бүлэг.
 *
 * Мөр бүр өөрийн бүлгээ ӨӨРТӨӨ хэлнэ.  Өмнө нь `ADMIN_ROUTES` гэсэн ТУСДАА
 * замын жагсаалт бүлэглэдэг байсан бөгөөд тэр нь «хэн харах вэ» гэдгээр
 * бүлэглэдэг байв, «юуны тухай вэ» гэдгээр биш.  Гурван бодит гэм:
 *   • `Ирц` (Ажлын хэсэг) ба `Ирцийн самбар` (Админ) — нэг сэдэв хоёр тийш;
 *   • «Админ» нь утгаараа «бусад бүх зүйл» болж 9 хамааралгүй мөр цуглуулсан.
 * Мөн цэс нэмэхэд ХОЁР газар (`NAV_ITEMS` + `ADMIN_ROUTES`) засах шаардлагатай
 * байсан тул тэд чимээгүй зөрөх боломжтой байв.
 *
 * `utility` нь гарчиггүй — доод талд `mt-auto`-гоор тогтоно.
 */
type NavGroup = 'overview' | 'work' | 'people' | 'business' | 'utility';

/** Бүлгийн ДАРААЛАЛ + гарчгийн i18n түлхүүр.  `utility` гарчиггүй тул `null`. */
const NAV_GROUPS: readonly { key: NavGroup; labelKey: string | null }[] = [
  { key: 'overview', labelKey: 'nav.sectionOverview' },
  { key: 'work', labelKey: 'nav.sectionWork' },
  { key: 'people', labelKey: 'nav.sectionPeople' },
  { key: 'business', labelKey: 'nav.sectionBusiness' },
  { key: 'utility', labelKey: null },
];

type NavItem = {
  to: string;
  icon: typeof LayoutDashboard;
  labelKey: string;
  /** admin/senior БУС хэрэглэгчид харагдах нэр.  Тэд энэ хэсгээс зөвхөн ӨӨРИЙН
   *  хамрах хүрээгээ авдаг (жишээ нь «Багууд» → «Баг»: зөвхөн өөрийн баг). */
  ownScopeLabelKey?: string;
  roles: string[];
  /** Аль семантик бүлэгт харагдах вэ.  Заавал — шинэ мөр нэмэхэд TypeScript
   *  сануулна, ингэснээр «бүлэггүй» мөр чимээгүй унахгүй. */
  group: NavGroup;
  /** Дэд цэс.  Байвал мөр нь эвхэгддэг бүлэг болно — эхний хүүхэд нь ихэвчлэн
   *  эцгийн өөрийнх нь хуудас.  Хумиулсан (icon) горимд дэд цэс нуугдах тул
   *  мөр нь `item.to` руу заасан энгийн холбоос болж хувирна. */
  children?: NavChild[];
  /** СЕРВЕРИЙН эрх (role-оос гадна).  Заасан бол `roles` нь хамгийн өргөн хүрээ л — мөр нь
   *  тухайн эрхийг сервер баталсан үед Л харагдана (ачаалж байхад / алдаанд НУУГДАНА).
   *  `engineering_feedback_reviewer` = `GET /api/engineering-feedback/capabilities` → `can_review`
   *  (баталгаажсан Software Engineer).  Admin-д автоматаар ОЛГОГДОХГҮЙ. */
  capability?: 'engineering_feedback_reviewer';
  /** Aль ЛИЦЕНЗИЙН модульд харьяалагдах вэ (`shared/config/modules.ts`).
   *  ЗААВАЛ — шинэ цэс нэмэхэд модулиа сонгохыг TypeScript шаардана, ингэснээр
   *  худалдаж аваагүй модулийн цэс чимээгүй харагдахгүй.  Үргэлж харагдах
   *  мөрүүд `'core'` авна. */
  module: ModuleId;
};

/** Sidebar мөрийн нэрний түлхүүр — `ownScopeLabelKey` нь admin/senior бус ролид. */
const navLabelKey = (item: NavItem, role: string | undefined): string =>
  item.ownScopeLabelKey && role !== 'admin' && role !== 'senior'
    ? item.ownScopeLabelKey
    : item.labelKey;

const NAV_ITEMS: NavItem[] = [
  {
    to: '/app',
    icon: LayoutDashboard,
    labelKey: 'nav.dashboard',
    roles: ['admin', 'engineer', 'architect', 'senior', 'client'],
    group: 'overview',
    module: 'core',
  },
  {
    to: '/app/company',
    icon: BarChart3,
    labelKey: 'nav.company',
    roles: ['admin', 'engineer', 'architect', 'senior'],
    group: 'overview',
    module: 'core',
  },
  // Нийтийн мэдээлэл — компанийн нийтэд зориулсан бүх зүйл НЭГ бүлэгт
  // (2026-09-23):
  //   • «Мэдээ, зарлал» — системийн шинэчлэлт, компанийн мэдээлэл, чухал
  //     дотоод зарлал (миграц 0338);
  //   • «Дотоод журам» — уншиж, профайлын гарын үсгээр танилцсанаа
  //     баталгаажуулах (миграц 0330; өмнө нь «Хүн хүчин» бүлэгт тусдаа мөр);
  //   • «Удирдлага» (зөвхөн admin) — хоёуланг нь НЭГ газраас удирдах хуудас
  //     (`PublicInfoAdminPage`, `?tab=announcements|rules`).
  // `roles` нь backend `ANNOUNCEMENT_ROLES` (`lib/announcements.ts`) ба
  // `RULE_ROSTER_ROLES` (`lib/internalRules.ts`)-ийн ТОЛЬ — хоёулаа ижил
  // дөрвөн роль, worker/client-д хаалттай.  Аль нэг нь өөрчлөгдвөл тухайн
  // хүүхэд мөрөнд өөрийн `roles`-ыг өгнө.
  {
    to: '/app/announcements',
    icon: Megaphone,
    labelKey: 'nav.announcements',
    roles: ['admin', 'engineer', 'architect', 'senior'],
    group: 'overview',
    module: 'core',
    children: [
      { to: '/app/announcements', labelKey: 'nav.announcementsNews' },
      { to: '/app/rules', labelKey: 'nav.rules' },
      { to: '/app/admin/announcements', labelKey: 'nav.announcementsAdmin', roles: ['admin'] },
    ],
  },
  // Төслийн хуваарь — «Тойм» бүлэгт (2026-09-01: «Ажил»-аас шилжүүлэв).
  {
    to: '/app/timeline',
    icon: CalendarRange,
    labelKey: 'nav.timeline',
    roles: ['admin', 'engineer', 'architect', 'senior'],
    group: 'overview',
    module: 'projects',
  },
  {
    to: '/app/my-tasks',
    icon: ListCheck,
    labelKey: 'nav.myTasks',
    roles: ['engineer', 'architect', 'senior'],
    group: 'overview',
    module: 'projects',
  },
  // «Ажил» бүлэг — төслүүд → баримт бичиг → зохиогчийн хяналт.
  {
    to: '/app/projects',
    icon: FolderKanban,
    labelKey: 'nav.projects',
    roles: ['admin', 'engineer', 'architect', 'senior', 'client'],
    group: 'work',
    module: 'projects',
  },
  // Төслийн баримт бичиг (Google Drive) — эзний 2026-09-24-ний шийдвэр: бүх
  // ажилтан харж, засаж, файл нэмнэ (устгах зам байхгүй).  Сервер ижил
  // олонлогийг хатуу бичдэг (`routes/projectDrive.ts` DRIVE_ROLES) — хамт
  // өөрчлөгдөнө.  Төслийн хуудасны «Баримт бичиг» таб (`ProjectTabs.tsx`) мөн.
  {
    to: '/app/documents',
    icon: FileText,
    labelKey: 'nav.projectDocuments',
    roles: ['admin', 'engineer', 'architect', 'senior'],
    group: 'work',
    module: 'projects',
  },
  // Зохиогчийн хяналт — бүх төслийн ASR тайланг нэг дор.  Төслийн дотоод
  // `?tab=asr` таб ХЭВЭЭР үлдэнэ (хоёулаа нэг `AsrEditorShell` дуудна):
  // таб = төслийн контекст, энэ хуудас = хөндлөн харагдац.  `client` бүх
  // ASR endpoint дээр 403 (`ensureAsrProjectAccess`), `worker` нь
  // `workerScope`-ийн цагаан жагсаалтад `author-supervision` байхгүй тул
  // ямар ч байсан 403 — тиймээс хоёул энд байхгүй.
  {
    to: '/app/asr',
    icon: HardHat,
    labelKey: 'nav.asr',
    roles: ['admin', 'engineer', 'architect', 'senior'],
    group: 'work',
    module: 'asr',
  },
  // Санал хүсэлт нь sidebar-т ЗОРИУДААР БАЙХГҮЙ — толгой мөрөнд байнга
  // харагддаг товчоороо (доор, `header.suggestions`) нээгдэнэ, мобайл дээр
  // бол доод мөрний ⊕ quick action-аар.  Хоёр газар давхардуулахгүй.
  //
  // Ирц — цэвэрлэгч (`worker`) -т энэ бол цорын ганц ажлын хуудас;
  // тэр утаснаасаа ажлын Wi-Fi дээр байж бүртгэнэ (WorkerAttendancePage).
  //
  // Админы «Ирцийн самбар» нь ТУСДАА дээд мөр биш, ЭНЭ мөрний хүүхэд.  Өмнө
  // нь хоёулаа дээд түвшинд байсан ч өөр өөр бүлэгт (Ажлын хэсэг / Админ)
  // унаж, нэг сэдэв хоёр тийш салсан байв.  Админ бус хүнд хүүхэд нь зөвхөн
  // өөрийнх нь хуудас үлддэг тул мөр энгийн холбоос хэвээр (доорх
  // `renderItem`-ийн «ганц өөрийн хүүхэд» дүрмийг үз).
  {
    to: '/app/attendance',
    icon: Clock,
    labelKey: 'nav.attendance',
    roles: ['admin', 'engineer', 'architect', 'senior', 'worker'],
    group: 'people',
    module: 'attendance',
    children: [
      { to: '/app/attendance', labelKey: 'nav.attendance' },
      { to: '/app/attendance/admin', labelKey: 'nav.attendanceAdmin', roles: ['admin'] },
    ],
  },
  // «Бүтээмжийн самбар» (/app/leaderboard) sidebar-аас ХАСАГДСАН (эзэн,
  // 2026-09-25) — хуудас, route хэвээр; URL-аар болон хайлтаар нээгдэнэ.
  // «Тайлан» — ажилтан/багийн гүйцэтгэлийн тайлан + HR карт (PC нууц үг,
  // гэрээ).  ЗӨВХӨН admin; CEO (id 2) admin тул тусгай нөхцөл хэрэггүй.
  // Route нь ProtectedRoute allowedRoles={['admin']} ард (routes.tsx).
  {
    to: '/app/reports',
    icon: FileBarChart2,
    labelKey: 'nav.reports',
    roles: ['admin'],
    group: 'people',
    module: 'reports',
  },
  {
    to: '/app/teams',
    icon: Building2,
    labelKey: 'nav.teams',
    // 2026-09-30: энгийн ажилтан зөвхөн өөрийн багийн хуудсыг нээдэг (`TeamsPage`).
    ownScopeLabelKey: 'nav.team',
    roles: ['admin', 'engineer', 'architect', 'senior', 'client'],
    group: 'people',
    module: 'core',
  },
  {
    to: '/app/users',
    icon: Users,
    labelKey: 'nav.users',
    roles: ['admin'],
    group: 'people',
    module: 'core',
  },
  // «Дотоод журам» энд байсан — 2026-09-23-нд «Тойм → Нийтийн мэдээлэл»
  // бүлгийн дэд хуудас болсон (дээрх `/app/announcements` мөрийг үз).
  // Ур чадварын үнэлгээ — sidebar-аас хассан; Хэрэглэгчид → «Ур чадварын
  // үнэлгээ» табаар нээгдэнэ.  Route (`/app/admin/assessments/*`) хэвээр ажиллана.
  // {
  //   to: '/app/admin/assessments',
  //   icon: ClipboardCheck,
  //   labelKey: 'assessments.navTitle',
  //   roles: ['admin'],
  //   group: 'people',
  //   module: 'assessments',
  // },
  // Public-site CMS — only the admin tier can edit the marketing page.
  // ТҮР НУУСАН: GlitchLandingPage-ийг `/`-д тавьсан хугацаанд CMS засвар
  // хэрэггүй тул sidebar-аас түр хассан.  Route (`/app/admin/landing`) хэвээр
  // ажиллана — URL-ээр орох боломжтой.  Буцаахдаа доорх блокийн коммент-ийг
  // авахад хангалттай (`group` талбар нь мөрөндөө хамт байгаа).
  // {
  //   to: '/app/admin/landing',
  //   icon: Globe2,
  //   labelKey: 'nav.landingCms',
  //   roles: ['admin'],
  //   group: 'business',
  // },
  // Захидлын триаж — Gmail-ээс ирсэн мэйлийг төсөлд ангилах (admin-tier).
  // Хайрцгуудын админ (`/app/admin/email`) нь өөрийн nav мөргүй байсан —
  // одоо дэд цэсээр гарна.
  {
    to: '/app/mail',
    icon: Mail,
    labelKey: 'nav.mail',
    roles: ['admin'],
    group: 'business',
    module: 'email',
    children: [
      { to: '/app/mail', labelKey: 'nav.mailInbox' },
      { to: '/app/admin/email', labelKey: 'nav.emailAccounts' },
    ],
  },
  // Хурлын тэмдэглэл — voice upload → транскрипт → AI дүгнэлт (admin-tier).
  {
    to: '/app/meeting-notes',
    icon: Mic,
    labelKey: 'nav.meetingNotes',
    roles: ['admin'],
    group: 'business',
    module: 'meetings',
  },
  // Тоо хэмжээ / BOQ — Revit push-ийн тоо хэмжээний самбар (admin + senior).
  {
    to: '/app/qto',
    icon: Calculator,
    labelKey: 'nav.qto',
    roles: ['admin', 'senior'],
    group: 'work',
    module: 'qto',
  },
  // Үнийн санал — зураг төслийн ажлын хөлсний санал (Excel шиг чөлөөт хуудас +
  // БД 81-16-20/2020 Хүснэгт 9-ийн тариф). Үнэ мэдрэмтгий тул ЗӨВХӨН admin;
  // backend нь routes/quotes.ts-д requireAdmin()-ээр, MCP нь admin блокоор
  // хамгаална.  Загвар / тарифын хуудсууд нь route-тай мөртлөө nav мөргүй байсан.
  {
    to: '/app/quotes',
    icon: FileSpreadsheet,
    labelKey: 'nav.quotes',
    roles: ['admin'],
    group: 'business',
    module: 'quotes',
    // ⚠️ Дэд цэсгүй САНААТАЙ: жагсаалт / загварууд / тарифын каталог гурав нь
    // 2026-08-04-нээс `/app/quotes`-ийн ДОТОР таб болсон (`QuotesPage`).
  },
  // «Гарын авлага» (`/app/handbook` + `/app/admin/handbook`) ба «MCP гарын
  // авлага» (`/app/mcp-guide`) sidebar-аас ХАСАГДСАН.  Гурван хуудас нь
  // `routes.tsx`-д хэвээр байгаа бөгөөд эрхийн шалгалт нь хуудас/сервер дээрээ
  // хэвээр — зөвхөн цэсний оролт байхгүй болсон:
  //   • уншигчийн гарын авлага руу профайл хуудасны «Түвшний» картаас орно
  //     (`features/assessments/components/LevelProgressCard.tsx` → «Гарын
  //     авлага нээх»);
  //   • админы засварын хуудас ба MCP гарын авлага нь одоо зөвхөн шууд URL-ээр.
  // Revit нэмэлт татах — ОДООХОНДОО зөвхөн эзэмшигч (user id 1).  roles-д admin
  // байгаа ч visibleItems дотор нэмэлт `user.id === 1` шүүлт хийгдэнэ.
  {
    to: '/app/revit-addin',
    icon: Puzzle,
    labelKey: 'nav.revitAddin',
    roles: ['admin'],
    group: 'utility',
    module: 'revit',
  },
  // Revit туслахын СУРГАЛТЫН КУРАЦИ — хүний баталгаажуулах хаалга.
  // ⚠️ backend нь `/api/revit`-ийг `progress` модульд харьяалуулдаг
  // (`backend/src/lib/modules.ts:230`; `revit` модуль нь ЗӨВХӨН
  // `/api/revit-addin`), тиймээс `module: 'progress'`.  `'revit'` бичвэл
  // backend нээлттэй байхад цэс чимээгүй нуугдана.
  // ⚠️ `roles` нь backend-ийн `isManager()` (admin | senior)-ийн ТОЛЬ.
  // Хамрах хүрээг нарийсгах бол `revit.ts`-ийн gate-ийг ЗЭРЭГ өөрчилнө.
  // MGL AI — чат.  ⚠️ `module: 'mglai'` нь `backend/src/lib/modules.ts`-ийн
  // ШИНЭ модуль (`/api/mgl-ai`).  `'ai'` бичвэл Workers AI-ийн бичвэр
  // сайжруулагчийн эрхээр цэс нээгдэх ба худалдаж аваагүй байгууллагад
  // чат чимээгүй гарч ирнэ.
  // ⚠️ `roles` нь backend-ийн горим шийдвэрлэлтийн ТОЛЬ
  // (`lib/mglai/identity.ts`): `worker` нь `denied` тул энд ОРОХГҮЙ.
  // `client` нь порталын өөрийнх нь бүрхүүлээр явдаг тул энэ ажилтны
  // цэсэнд ОРОХГҮЙ.
  {
    to: '/app/mgl-ai',
    icon: Sparkles,
    labelKey: 'nav.mglAi',
    roles: ['admin', 'engineer', 'architect', 'senior'],
    group: 'utility',
    module: 'mglai',
  },
  // Програмын хүсэлтүүд (2026-10-16) — Revit add-in / ERP-ээс ирсэн алдаа, сайжруулалт, асуултын
  // inbox.  ⚠️ ЗӨВХӨН баталгаажсан Software Engineer reviewer (Өсөхбаяр): `roles` нь илгээгч ролиудын
  // өргөн хүрээ, жинхэнэ шүүлт нь `capability` (серверийн `can_review` — `useEfCapabilities`).
  // Admin эрх ганцаараа энэ мөрийг харуулахгүй.  Сервер inbox-ын бүх замыг эрхгүй хүнд 404-өөр хаана.
  // Илгээгчид энэ мөрийг ХЭЗЭЭ Ч харахгүй — тэд AccountMenu-ийн «Програмын хүсэлт»-өөр орно.
  {
    to: '/app/engineering-requests',
    icon: LifeBuoy,
    labelKey: 'nav.engineeringRequests',
    roles: ['admin', 'engineer', 'architect', 'senior'],
    group: 'utility',
    module: 'core',
    capability: 'engineering_feedback_reviewer',
  },
  // System Workbench — амьд архитектурын граф + код/CI (2026-10-06).  ⚠️ ЗӨВХӨН admin:
  // live WebSocket (`/api/mgl-ai/workbench-live`) ба `/api/mgl-ai/workbench/*` бүгд admin-only.
  // `module: 'mglai'` = тэдгээр замын модуль.  Компанийн TV-ийн сүүлийн кадр нь мөн энэ граф.
  {
    to: '/app/admin/system-workbench',
    icon: Radar,
    labelKey: 'nav.systemWorkbench',
    roles: ['admin'],
    group: 'utility',
    module: 'mglai',
  },
  // Толгойн гүйдэг мэдээ (`/app/admin/ticker`) 2026-09-18-нд sidebar-аас
  // ХАСАГДАЖ Тохиргоо → «Гүйдэг мэдээ» хэсэг болсон (эзний хүсэлт);
  // хайлт нь `sections.ts`-ийн `settings-ticker` мөрөөр олдоно.
  // Тохиргоо — цэвэрлэгчид ХАМААРАХГҮЙ: энэ хуудас нь брэнд/амралтын өдрийн
  // админ картуудаас бүрддэг бөгөөд түүний API-ууд worker-т хаалттай.  Хэл /
  // өнгө солих товчнууд sidebar-ийн доод хэрэглэгчийн цэсэнд байгаа тул
  // түүнд хангалттай.
  {
    to: '/app/settings',
    icon: Settings,
    labelKey: 'nav.settings',
    roles: ['admin', 'engineer', 'architect', 'senior', 'client'],
    group: 'utility',
    module: 'core',
  },
];

/* `ADMIN_ROUTES` энд байсан — бүлэглэлийг замын ТУСДАА жагсаалтаар хийдэг байв.
 * Одоо мөр бүр `group` талбартай (дээрх `NavGroup`-ийг үз), тиймээс:
 *   • цэс нэмэхэд НЭГ газар засна, хоёр биш — зөрөх боломжгүй болов;
 *   • бүлэг нь «хэн харах вэ» биш «юуны тухай вэ» гэдгийг илэрхийлнэ. */

/**
 * Хайлтын нэмэлт үгс (зам → сул зайгаар тусгаарласан үгс).
 *
 * Хайлт нь ГУРВАН эх сурвалжаас таарц хайна: (1) харагдаж буй шошго,
 * (2) замын мөр өөрөө (`/app/attendance` → «attendance»), (3) энэ хүснэгт.
 * Тиймээс энд голдуу *нөгөө хэлний* нэр ба ярианы нэршлийг бичнэ — `en.json`
 * нь bundle-ээс гадуур залхуу ачаалагддаг тул идэвхгүй хэлний шошгыг ажиллах
 * үед уншиж болохгүй (харин зам нь бараг үргэлж англи).
 *
 * ⚠️ Шинэ nav мөр нэмэхэд энд бичих нь СОНГОЛТ — шошго + зам хоёроор ямар ч
 * байсан хайгдана.  Энэ бол зөвхөн синоним.
 */
const NAV_KEYWORDS: Record<string, string> = {
  '/app': 'нүүр хянах самбар dashboard home эхлэл',
  '/app/company': 'компани компанийн самбар company board статистик',
  '/app/announcements': 'мэдээлэл зарлал мэдээ шинэчлэлт announcement news update notice нийтийн',
  '/app/admin/announcements':
    'удирдлага удирдах мэдээлэл мэдээ зарлал нийтлэх бичих дотоод журам хувилбар гарын үсэг хэн танилцсан announcement internal rules admin manage publish',
  '/app/projects': 'төсөл барилга project building объект',
  '/app/documents': 'баримт бичиг файл revision document upload татах',
  // «Хугацаа» хуудас устсан тул түүний түлхүүр үгс ЭНД нэгдэв — хэрэглэгч
  // «эцсийн хугацаа», «milestone» гэж хайхад хуваарь олдох ёстой.
  '/app/timeline':
    'хуваарь хугацаа график товлол дуусах хоцролт timeline gantt schedule deadline эцсийн хугацаа шалгах цэг milestone хэтэрсэн',
  '/app/asr': 'зохиогчийн хяналт asr author supervision талбай хяналт хуваарь очилт',
  '/app/rules': 'дотоод журам гарын үсэг танилцах internal rules policy signature',
  '/app/my-tasks': 'даалгавар ажил миний task todo',
  // '/app/suggestions' энд БАЙХГҮЙ: энэ мап нь зөвхөн NAV_ITEMS-ийн хайлтыг
  // баяжуулдаг тул sidebar-аас хассан мөрийн түлхүүр үг үхмэл болно.
  '/app/attendance': 'ирц цаг ирсэн явсан clock time бүртгэл',
  '/app/attendance/admin': 'ирц админ самбар хоцролт attendance board',
  '/app/leaderboard': 'бүтээмж оноо чансаа рейтинг points rating',
  '/app/reports': 'тайлан ажилтан баг чансаа хандлага гэрээ нууц үг report employee team rank trend hr contract',
  '/app/teams': 'баг хэлтэс team department бүтэц',
  '/app/users':
    'хэрэглэгч ажилтан хүн user staff employee үнэлгээ ур чадвар судалгаа assessment skill survey',
  '/app/mail': 'захидал мэйл имэйл email gmail inbox триаж',
  '/app/admin/email': 'имэйл хайрцаг тохиргоо email account gmail',
  '/app/meeting-notes': 'хурал тэмдэглэл бичлэг meeting notes voice',
  // Тариф/загварын түлхүүр үг ЭНД нэгдсэн: `/app/quotes` нь одоо гурвуулангийн
  // нэвтрэх цэг (`QuotesPage`), `/app/admin/quotes/*` нь NAV_ITEMS-д БАЙХГҮЙ.
  '/app/quotes': 'үнэ үнийн санал price quote тариф каталог загвар template БД 81-16-20',
  // '/app/admin/quotes/template', '/app/admin/quotes/tariffs', '/app/handbook',
  // '/app/admin/handbook', '/app/mcp-guide' энд БАЙХГҮЙ: энэ мап нь зөвхөн
  // NAV_ITEMS-ийн хайлтыг баяжуулдаг (доорх `NAV_KEYWORDS[item.to]`) тул
  // sidebar-аас хассан мөрийн түлхүүр үг үхмэл болно.  Тэдгээр хуудсууд
  // route-оор нээгдсэн хэвээр — зөвхөн sidebar-ын хайлтад гарахгүй.
  '/app/revit-addin': 'revit нэмэлт addin plugin татах',
  '/app/engineering-requests':
    'програмын хүсэлт алдаа сайжруулалт асуулт revit add-in хэрэгсэл bug report feedback improvement engineering inbox retest',
  '/app/admin/assistant':
    'туслах сургалт шошго курац assistant training label curate intent санаа таних ангилагч',
  '/app/settings': 'тохиргоо тохируулга setting брэнд амралтын өдөр',
  '/app/profile': 'профайл хувийн мэдээлэл profile account',
};

/** Зам `to`-той хэр «гүн» таарч байгаа нь (таарахгүй бол -1).
 *  Идэвхтэй мөрийг СОНГОХДОО хамгийн урт таарцыг авна — ингэснээр
 *  `/app/attendance/admin` дээр Ирц + Ирцийн самбар хоёулаа гэрэлтэхгүй. */
function matchDepth(pathname: string, to: string): number {
  if (to === '/app') return pathname === '/app' ? to.length : -1;
  return pathname === to || pathname.startsWith(`${to}/`) ? to.length : -1;
}

/* `SearchEntry` ба эрэмбэлэлт нь ЭНД байсан — одоо
 * `shared/lib/search/rank.ts`-д амьдарна.  Шилжүүлсэн шалтгаан:
 *   • таарц нь `toLowerCase().includes()` байсан тул кирилл шошгыг латинаар
 *     («iluu tsag») эсвэл эсрэгээр нь хайх боломжгүй байв;
 *   • сул зайтай хайлт («ирц илүү») хэзээ ч таардаггүй байв — үг бүрийг
 *     тусад нь шалгадаг болов;
 *   • энэ файл 1500 мөр — хайлтын логик өөрөө туршиж болохуйц, тусдаа
 *     байх ёстой.
 * Индекс угсрах нь ЭНД хэвээр (эрх/хэлнээс хамаардаг тул). */

/** Хайлтын нэг мөрийн ХАМГИЙН ИХ уртыг хязгаарлана — sidebar нарийн тул
 *  20 гаруй илэрц гүйлгэх нь ашиггүй, эрэмбийн сүүл нь ямар ч байсан чанаргүй. */
const SEARCH_LIMIT = 24;

/**
 * `GET /api/search?q=&limit=` — ХӨЛДӨӨСӨН ГЭРЭЭ.  Сервер тал
 * (`backend/src/routes/search.ts`) яг энэ хэлбэрийг буцаана; аль нэг талыг
 * өөрчилвөл НӨГӨӨГ НЬ ЗЭРЭГ.  Хоосон эсвэл 2 тэмдэгтээс богино `q` дээр
 * хоёр массив нь хоосон, статус 200.
 */
type GlobalSearchRecordKind = 'asr' | 'perf_report' | 'meeting' | 'qto';

interface GlobalSearchResponse {
  projects: {
    id: number;
    name: string;
    display_title: string | null;
    full_title: string | null;
    drawing_no: string | null;
    doc_no: string | null;
    category: string | null;
    status: string;
    /** true ⇒ Зохиогчийн хяналтын төсөл — Төслүүд хуудсанд ГАРДАГГҮЙ. */
    is_asr_only: boolean;
    is_pending: boolean;
  }[];
  records: {
    kind: GlobalSearchRecordKind;
    id: number;
    project_id: number;
    /** Давхардсан шифрийг ялгах ганц мэдээлэл. */
    project_name: string;
    title: string;
    code: string | null;
    date: string | null;
    /** Бүтэн frontend зам — `?tab=` / `?section=` аль хэдийн дотор нь. */
    to: string;
  }[];
}

/** Бичлэгийн төрөл → дүрс.  Цэсний мөрүүдтэй ижил дүрсийг зориуд авав —
 *  «уулзалт» нь микрофон, «тайлан» нь баримт гэдэг нь аль хэдийн суусан. */
const RECORD_ICONS: Record<GlobalSearchRecordKind, LucideIcon> = {
  asr: HardHat,
  perf_report: FileText,
  meeting: Mic,
  qto: FileSpreadsheet,
};

/** Хэрэглэгчийн цэс дэх сэдвийн сонголт.
 *
 *  Гурвуулаа ЗЭРЭГ харагдана — өмнө нь нэг мөр байсан бөгөөд товшихад
 *  дараагийн горим руу эргэлддэг байв.  Тэр нь хоёр асуудалтай: хүссэн
 *  горимдоо хүрэхийн тулд хоёр удаа товших шаардлагатай болдог, мөн
 *  ямар сонголтууд байгаа нь огт харагддаггүй.
 *
 *  Эрэмбэ нь бараанаас цайвар руу — Тохиргоо хуудасны товчны эгнээтэй
 *  ижил.  `system` энд ОРОХГҮЙ: энэ цэс нь аль хэдийн шийдэгдсэн
 *  (`resolved`) тодорхой горим дээр ажилладаг, «тохируулаагүй өгөгдмөл»
 *  гэсэн гуравдахь утга биш — тэр бодлого Тохиргоо хуудсаар л тавина. */
const THEME_MODES: readonly { value: ResolvedTheme; icon: LucideIcon; labelKey: string }[] = [
  { value: 'dark', icon: Moon, labelKey: 'settingsPage.themeDark' },
  { value: 'dim', icon: Contrast, labelKey: 'settingsPage.themeDim' },
  { value: 'light', icon: Sun, labelKey: 'settingsPage.themeLight' },
];

const AppSidebar = () => {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const { resolved: resolvedTheme, setTheme } = useTheme();
  const { state, isMobile, setOpen, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  // Серверийн эрх (sidebar-ын `capability` мөрүүд) — ачаалж байхад false (fail-closed).
  const efCaps = useEfCapabilities();

  // Хэрэглэгч гараар нээж/хаасан дэд цэсүүд.  Утга байхгүй бол «доторх хуудас
  // идэвхтэй эсэх»-ээр автоматаар шийднэ.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Цэсний хайлт.  `cursor` нь гар дээрх ↑/↓-ээр гүйх идэвхтэй илэрцийн индекс.
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  // «Талбар гарч ирмэгц фокус ав» хүсэлт — хумиулсан sidebar / утасны drawer
  // нээгдэх хүртэл input DOM-д байхгүй тул render-ийн дараа биелүүлнэ.
  const wantFocusRef = useRef(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  /** Утсан дээр цэсний мөр дарсны дараа drawer-ыг хаана (desktop дээр нөлөөгүй). */
  const closeDrawer = useCallback(() => setOpenMobile(false), [setOpenMobile]);

  // Идэвхтэй модулиудыг захиална — админ модуль асаах/унтраахад цэс шууд
  // шинэчлэгдэнэ.  Утга нь `null` бол ХЯЗГААРЛАЛТГҮЙ (бүх цэс харагдана).
  useEnabledModules();

  const visibleItems = NAV_ITEMS.filter((item) => {
    // ЛИЦЕНЗ нь эрхээс ӨМНӨ шалгагдана: худалдаж аваагүй модулийн мөр хэнд ч
    // (CEO-д ч) харагдах ЁСГҮЙ.  Сервер тал `lib/entitlement.ts`-ээр мөн хаана.
    if (!moduleEnabled(item.module)) return false;
    // CEO (top-of-admin, hardcode id 2) даалгавар өөрөө авч гүйцэтгэдэг тул
    // ажилчны «Миний даалгавар»-ыг admin эрхийнхээ дээр нэмж хардаг.
    if (item.to === '/app/my-tasks' && isCeo(user)) return true;
    if (!user || !item.roles.includes(user.role)) return false;
    // Revit нэмэлт — одоохондоо зөвхөн эзэмшигч (id 1)-д харагдана.
    if (item.to === '/app/revit-addin' && user.id !== 1) return false;
    if (item.capability === 'engineering_feedback_reviewer' && !efCaps.canReview) return false;
    return true;
  });

  /** Хүүхдүүдийг мөн эрхээр шүүнэ (`roles` заагаагүй бол эцгийнхээ хамрах хүрээ). */
  const childrenFor = (item: NavItem): NavChild[] =>
    (item.children ?? []).filter((c) => !c.roles || (user && c.roles.includes(user.role)));

  // «Төслүүд» нь ЗОРИУД дэд цэсгүй — дарахад шууд бүх төслийн хуудас руу
  // ордог.  Өмнө нь `GET /projects/top?limit=5`-аар эхний 5 төслийг хүүхэд
  // болгон гаргадаг байсан ч мөрийг `CollapsibleTrigger` болгодог тул дарахад
  // задарч, шилждэггүй байв.  Хүүхэдгүй болсноор дээрх `renderNavItem`-ийн
  // салаагаар автоматаар энгийн `NavLink` болно.  Сэргээх бол: энд
  // `/app/projects`-ийн тусгай тохиолдлыг буцааж нэмнэ (`nav.projectsAll`
  // түлхүүр хоёр толь бичигт хэвээр үлдээсэн).

  /** Семантик бүлгүүд — `NAV_GROUPS`-ийн дарааллаар, ХООСОН бүлэг унана.
   *  Хоосон бүлэг нь гарчигтайгаа хамт алга болно (өмнө нь зөвхөн «Админ»
   *  бүлэгт хийгддэг байсан шалгалтыг бүх бүлэгт ерөнхийлөв) — тиймээс
   *  инженер `Бизнес` гэсэн хоосон гарчиг хэзээ ч харахгүй. */
  const groupedItems = NAV_GROUPS.map((g) => ({
    ...g,
    items: visibleItems.filter((i) => i.group === g.key),
  })).filter((g) => g.items.length > 0);

  /** Бүлэг ГАНЦ байвал гарчиг нь мэдээлэл өгөхгүй, зүгээр чимэг болно —
   *  цэвэрлэгчийн цэс яг ийм (зөвхөн «Ирц»).  Тиймээс нуулаа. */
  const showGroupLabels = groupedItems.length > 1;

  /** Хумиулсан (зөвхөн тэмдэг) горим — утсан дээр хэзээ ч биш: тэнд sidebar нь
   *  бүтэн өргөнтэй drawer болж гардаг. */
  const isIconMode = state === 'collapsed' && !isMobile;
  /** Ганц мөртэй цэсэнд (цэвэрлэгч → зөвхөн «Ирц») хайлт утга учиргүй. */
  const showSearch = visibleItems.length > 1;

  // Хамгийн урт таарцтай зам = идэвхтэй мөр (эцэг + хүүхдүүдийг нэг дор жиших).
  const activePath = (() => {
    let best = '';
    let bestDepth = 0;
    for (const item of visibleItems) {
      for (const to of [item.to, ...childrenFor(item).map((c) => c.to)]) {
        const depth = matchDepth(location.pathname, to);
        if (depth > bestDepth) {
          best = to;
          bestDepth = depth;
        }
      }
    }
    return best;
  })();

  // ⚠️ `displayName` / `initials` / `avatarSrc` нь ЗӨВХӨН хөл дэх бүртгэлийн
  // цэсэнд хэрэглэгддэг байсан — тэр цэс `AccountMenu` болж толгой руу
  // зөөгдсөн тул энд шаардлагагүй болов (`AccountMenu` өөрөө тооцно).

  // ───────────────────────────── Хайлт ─────────────────────────────

  /** Хэрэглэгчийн цэсэн доторх ҮЙЛДЛҮҮД — эдгээр нь хуудас биш ч sidebar-ын
   *  нэг хэсэг тул хайлтаар олдох ёстой («гарах» гэж бичээд Enter). */
  const actionEntries: SearchEntry[] = [
    {
      id: '/app/profile',
      icon: UserRound,
      label: t('pageTitle.profile'),
      hint: t('sidebar.accountMenu'),
      keywords: NAV_KEYWORDS['/app/profile'] ?? '',
      to: '/app/profile',
      kind: 'page',
    },
    {
      id: 'action:lang',
      icon: Globe,
      label: t('sidebar.switchLanguage'),
      keywords: 'хэл солих language англи монгол english mongolian en mn',
      run: () => setLang(lang === 'en' ? 'mn' : 'en'),
      kind: 'action',
    },
    // Сэдэв тус бүр ӨӨРИЙН мөртэй — эргэлдэх ганц үйлдэл байхад «Дундаж»
    // руу шилжихийн тулд командыг хоёр удаа ажиллуулах шаардлагатай болдог
    // байсан, мөн нэрээр нь хайх боломжгүй байв.
    ...THEME_MODES.filter((m) => m.value !== resolvedTheme).map<SearchEntry>((m) => ({
      id: `action:theme:${m.value}`,
      icon: m.icon,
      label: t(`sidebar.${m.value}Mode`),
      keywords: `өнгө горим сэдэв бараан цайвар дундаж theme dark dim light mode ${m.value}`,
      run: () => setTheme(m.value),
      kind: 'action',
    })),
    {
      id: 'action:logout',
      icon: LogOut,
      label: t('sidebar.signOut'),
      keywords: 'гарах системээс logout signout exit',
      run: () => void handleLogout(),
      kind: 'action',
    },
  ];

  /** Хайлтын мөр бүрийн `hint` = харьяалагдах бүлгийн нэр.  `groupedItems`-ээс
   *  шууд угсарсан тул хайлт нь цэсний бүлэглэлтэй ҮРГЭЛЖ синхрон — өмнө нь
   *  `mainItems`/`adminItems`-ийг тусад нь жагсаадаг байсан бөгөөд бүлэг
   *  өөрчлөгдвөл энд мартагдах боломжтой байв.  `utility` гарчиггүй тул hint
   *  нь хоосон. */
  const searchGroupPairs = groupedItems.flatMap((g) =>
    g.items.map((i) => [i, g.labelKey ? t(g.labelKey) : ''] as const),
  );

  /**
   * Зам → (дүрс, нэр).  Хуудасны ДОТООД хэсгүүд эцгийнхээ дүрсийг өвлөж,
   * эцгийнхээ нэрийг `hint`-дээ авна («Илүү цаг» мөрийн доор «Ирц» гэж
   * гарна) — ингэснээр ижил нэртэй хоёр хэсэг («Тайлан» гэж хоёр газар
   * бий) ялгагдана.
   *
   * ⚠️ Энэ мап нь ЭРХИЙН ХААЛТ ч мөн: `visibleItems`-ээс угсрагддаг тул
   * хэрэглэгчид харагдахгүй хуудасны хэсэг нь энд ОРОХГҮЙ бөгөөд доорх
   * `APP_SECTIONS`-ийн шүүлт түүнийг шууд унагана.
   */
  const pageMeta = new Map<string, { icon: LucideIcon; label: string }>();
  for (const [item] of searchGroupPairs) {
    pageMeta.set(item.to, { icon: item.icon, label: t(navLabelKey(item, user?.role)) });
    for (const c of childrenFor(item)) {
      if (c.to !== item.to) pageMeta.set(c.to, { icon: item.icon, label: navChildLabel(c, t) });
    }
  }
  // Профайл нь цэсний мөр биш (`actionEntries`-ийн мөр) ч түүний табууд
  // хайгдах ёстой тул гараар нэмнэ.
  pageMeta.set('/app/profile', { icon: UserRound, label: t('pageTitle.profile') });

  const q = query.trim();
  // Хумиулсан горимд талбар байхгүй тул хуучин хайлт үлдсэн ч илэрц харуулахгүй.
  const searching = q.length > 0 && !isIconMode;

  /**
   * Төслийн нэрээр хайх.
   *
   * «Хөшигтийн…» гэж бичихэд төсөл нь илэрцээр гарч, дарахад
   * `/app/projects/:id` руу шууд орно — өмнө нь Төслүүдийн хуудсанд орж,
   * тэндээс дахин хайх шаардлагатай байв.
   *
   * ⚠️ Хүсэлт нь ЗӨВХӨН хайж эхлэхэд идэвхжинэ: sidebar нь апп даяар байнга
   * mount байдаг тул болзолгүй байвал хуудас БҮР дээр нэмэлт дуудлага
   * үүсгэнэ.  `['/projects']` нь Төслүүдийн хуудас / Ирцийн виджет зэрэгтэй
   * ИЖИЛ кэш түлхүүр тул ихэвчлэн сүлжээнд огт хүрэхгүй.
   * `worker` нь `/api/projects` дээр 403 авдаг (`lib/workerScope.ts`) тул
   * түүнээс огт асуухгүй.
   */
  const canSearchProjects = !!user && !isWorkerRole(user.role);
  const projectsQuery = useApiQuery<{ projects: ProjectOption[] }>('/projects', {
    enabled: canSearchProjects && searching,
    retry: false,
  });
  const projectRows = projectsQuery.data?.projects;

  /*
   * ─────────────── Серверийн хайлт (`GET /api/search`) ───────────────
   *
   * Дээрх `['/projects']` индекс нь ШУУРХАЙ (кэшнээс, сүлжээгүй) боловч
   * ЗӨВХӨН төслийн жагсаалтыг мэднэ.  Тэр жагсаалтад ОРДОГГҮЙ хоёр зүйл
   * бий:
   *   • Зохиогчийн хяналтын (`asr_only=1`) төслүүд — `PROJECT_LIST_SQL`
   *     тэднийг `NOT_ASR_ONLY_SQL`-ээр шүүдэг атал `lib/asrTargets.ts` нь
   *     тэдний ШИФРийг бичдэг, тиймээс шифрээр хайхад ЗААВАЛ олдох ёстой;
   *   • бичлэгүүд (ASR тайлан, гүйцэтгэлийн тайлан, уулзалт, QTO) — эдгээр
   *     нь клиент дээр огт байдаггүй.
   *
   * ⚠️ Тусдаа `/app/search` ХУУДАС БИШ, ЯГ ЭНЭ ХАЙРЦАГ.  Шинэ хуудас нь
   * lazy route + `NAV_ITEMS`-ийн мөр (`scripts/nav-matrix.mjs`-ийн гаралт
   * өөрчлөгдөнө — тэр массивын ГАНЦ хамгаалалт) + хоёр i18n бүлэг
   * шаардана, ашиг нь тэг.
   *
   * ⚠️ Хариу нь ХОЖИМ ирнэ — локал илэрцийг ХЭЗЭЭ Ч цэвэрлэхгүй, хаахгүй.
   * Хоёр индексийг зэрэгцүүлж нийлүүлээд НЭГ эрэмбээр гаргана.
   */
  const debouncedQ = useDebouncedValue(q, 250);
  /* `q` (хойшлоогүй) нь `enabled`-ийн хамгаалалт: хэрэглэгч талбараа
   * цэвэрлэмэгц хүсэлт тэр даруй унтарна, 250мс хүлээхгүй. */
  const serverSearchOn = canSearchProjects && searching && q.length >= 2;
  const serverQuery = useApiQuery<GlobalSearchResponse>(
    ['/search', debouncedQ],
    `/search?q=${encodeURIComponent(debouncedQ)}&limit=${SEARCH_LIMIT}`,
    {
      enabled: serverSearchOn && debouncedQ.length >= 2,
      // Хайлт нь зөвлөх зорилготой — сүлжээ унасан ч sidebar-ыг зогсоохгүй.
      retry: false,
      staleTime: 60_000,
    },
  );

  /** Хайлтын индекс — цэсний мөр, хуудасны дотоод хэсэг, төсөл, үйлдэл
   *  бүгд НЭГ хавтгайд.  `prepareSearchEntries` нь харьцуулах хэлбэрийг
   *  урьдчилан тооцно (кирилл→латин), тиймээс товчлуур дарах бүрт биш
   *  индекс өөрчлөгдөх бүрт л ажиллана. */
  const searchIndex = useMemo(() => {
    const navEntries: SearchEntry[] = searchGroupPairs.flatMap(([item, group]) => {
      const label = t(navLabelKey(item, user?.role));
      const self: SearchEntry = {
        id: item.to,
        icon: item.icon,
        label,
        hint: group,
        keywords: NAV_KEYWORDS[item.to] ?? '',
        to: item.to,
        kind: 'page',
      };
      // Эцэгтэйгээ ижил зам заасан хүүхдийг (жишээ нь «Ирсэн захидал» →
      // `/app/mail`) давхардуулахгүй.
      return [
        self,
        ...childrenFor(item)
          .filter((c) => c.to !== item.to)
          .map<SearchEntry>((c) => ({
            id: c.to,
            icon: item.icon,
            label: navChildLabel(c, t),
            hint: label,
            keywords: NAV_KEYWORDS[c.to] ?? '',
            to: c.to,
            kind: 'page',
          })),
      ];
    });

    // Хуудасны дотоод хэсгүүд.  Эцэг хуудас нь `pageMeta`-д БАЙХГҮЙ бол
    // (эрхээр нуугдсан) хэсэг нь ч хайгдахгүй.
    const sectionEntries: SearchEntry[] = [];
    for (const section of APP_SECTIONS) {
      const parent = pageMeta.get(section.page);
      if (!parent) continue;
      if (section.roles && !(user && section.roles.includes(user.role))) continue;
      sectionEntries.push({
        id: section.to,
        icon: parent.icon,
        label: cleanSectionLabel(t(section.labelKey)),
        hint: parent.label,
        keywords: section.keywords ?? '',
        to: section.to,
        kind: 'section',
      });
    }

    // Төслүүд.  Харагдах шошго нь `MGL-YYMMDD_` кодгүй богино нэр, харин
    // БҮТЭН нэр нь түлхүүр үгэнд үлдэнэ — код нь захидал/гэрээнд
    // хэрэглэгддэг тул түүгээр ч хайж чадах ёстой.
    //
    // ⚠️ ШИФР нь `hint`-д ГАРНА, зөвхөн индекст биш.  Эзний шийдвэр
    // (2026-09-03): нэг шифр ОЛОН төсөл дээр давхардаж болно — 37 ба 41
    // хоёул «MEC-25/21».  Тиймээс бүгдийг нь ЖАГСААНА, харин хэрэглэгч
    // аль нь алийг ялгах ёстой тул мөр бүр өөрийн шифрээ харуулна.
    // ⚠️ `codes`-д зөвхөн КОД ор — `rank.ts` өөрөө `foldCodeVariants`-аар
    // өргөтгөнө (кирилл «МЕС» ↔ латин «MEC»).  Чөлөөт текст оруулбал
    // «ХАС» → 'xac' болж худал таарц үүснэ.
    const projectEntries: SearchEntry[] = (projectRows ?? []).map((p) => {
      const code = p.drawing_no?.trim() || '';
      return {
        id: `project:${p.id}`,
        icon: FolderKanban,
        label: formatProjectShortName(p.name) || p.name,
        hint: code ? `${code} · ${t('nav.projects')}` : t('nav.projects'),
        // Албан ёсны урт гарчиг ба толгойн гарчиг хоёулаа хайгдана — эзэн
        // төслөө ихэвчлэн ТЭР нэрээр нь дууддаг, `projects.name` нь зөвхөн
        // файлын кодтой богино хэлбэр.
        keywords: [p.name, p.full_title ?? '', p.display_title ?? ''].join(' '),
        codes: [p.drawing_no, p.doc_no].filter((v): v is string => !!v && !!v.trim()),
        to: `/app/projects/${p.id}`,
        kind: 'project',
      };
    });

    return prepareSearchEntries([
      ...navEntries,
      ...sectionEntries,
      ...projectEntries,
      ...actionEntries.map<SearchEntry>((a) => ({ ...a, hint: a.hint ?? t('sidebar.actions') })),
    ]);
    // `searchGroupPairs` / `pageMeta` / `actionEntries` нь render бүрт шинэ
    // объект боловч агуулга нь ЗӨВХӨН доорх хамаарлуудаас тодорхойлогдоно
    // (`t` нь `lang`-аар memo хийгдсэн — `shared/i18n/index.tsx`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, lang, user, resolvedTheme, projectRows]);

  /**
   * Серверээс ирсэн мөрүүд — локал индексийн ХАЖУУД, ижил хавтгайд.
   *
   * ⚠️ ДАВХАРДЛЫГ id-гаар хасна: `/api/search` нь ЭНГИЙН төслүүдийг ч
   * буцаадаг бөгөөд тэдгээрийн ихэнх нь локал индекст аль хэдийн бий.
   * Үлдсэн нь = `asr_only=1` (Зохиогчийн хяналт) — тэднийг «ЗХ» тэмдэгтэй
   * гаргана, эс бөгөөс хэрэглэгч яагаад Төслүүд хуудсанд байхгүй мөр
   * гарч ирснийг ойлгохгүй.
   *
   * ⚠️ Сервер олсон ч ЛОКАЛ эрэмбэ нь мөрийг унагаж болзошгүй (үг бүр
   * таарах шаардлага).  Тиймээс серверийн өгсөн БҮХ текстийг —
   * гарчиг, код, төслийн нэр — `keywords`/`codes`-д хийж өгнө.
   */
  const serverIndex = useMemo(() => {
    const res = serverQuery.data;
    if (!res) return [];
    const known = new Set((projectRows ?? []).map((p) => p.id));

    const projects: SearchEntry[] = (res.projects ?? [])
      .filter((p) => !known.has(p.id))
      .map((p) => {
        const code = p.drawing_no?.trim() || '';
        const badge = p.is_asr_only ? t('sidebar.searchAsrBadge') : t('nav.projects');
        return {
          id: `project:${p.id}`,
          icon: p.is_asr_only ? HardHat : FolderKanban,
          label: formatProjectShortName(p.name) || p.name,
          hint: code ? `${code} · ${badge}` : badge,
          keywords: [p.name, p.full_title ?? '', p.display_title ?? ''].join(' '),
          codes: [p.drawing_no, p.doc_no].filter((v): v is string => !!v && !!v.trim()),
          to: `/app/projects/${p.id}`,
          kind: 'project',
        };
      });

    // ⚠️ Бичлэг бүрийг ЭЗЭН ТӨСӨЛТЭЙ нь холбоно.  Сервер нь ШИФРЭЭР олсон
    // төслүүдийн ДОТОРХ бичлэгүүдийг зориуд буцаадаг («MEC-25/21» гэж
    // бичсэн хүн тэр төслийн ЗХ тайлан, хурлыг ч харах ёстой).  Гэтэл
    // `rankSearchEntries` нь үг БҮРИЙГ таарахыг шаарддаг бөгөөд бичлэгийн
    // өөрийнх нь `code` нь 'ASR-007' — төслийн шифр мөрөнд ХАА Ч БАЙХГҮЙ.
    // Тиймээс шифрийн хайлт БҮРТ бичлэгийн тал бүхэлдээ унаж, серверийн
    // 4 хүсэлтийн D1 batch хогт хаягддаг байв.  Эзний шифрийг энд шингээнэ.
    const projectById = new Map((res.projects ?? []).map((p) => [p.id, p]));

    const records: SearchEntry[] = (res.records ?? []).map((r) => {
      const owner = projectById.get(r.project_id);
      return {
        id: `record:${r.kind}:${r.id}`,
        icon: RECORD_ICONS[r.kind] ?? FileText,
        label: r.title,
        // Код + төслийн нэр — давхардсан шифрийг ялгах ГАНЦ мэдээлэл.
        hint: [r.code ?? '', r.project_name].filter(Boolean).join(' · '),
        keywords: [r.title, r.project_name, owner?.full_title ?? '', r.date ?? ''].join(' '),
        // ⚠️ Зөвхөн КОД — эзний урт гарчиг `keywords`-д очно (`rank.ts`
        // нь `codes`-ыг фонетикээр өргөтгөдөг тул чөлөөт текст худал
        // таарц үүсгэнэ).
        codes: [r.code, owner?.drawing_no, owner?.doc_no].filter(
          (v): v is string => !!v && !!v.trim(),
        ),
        // ⚠️ `to` нь серверээс БҮТЭН ирнэ (`?tab=` / `?section=` дотроо
        // агуулсан) — энд бүү угсар, гэрээ нь тэр.
        to: r.to,
        kind: 'record',
      };
    });

    return prepareSearchEntries([...projects, ...records]);
  }, [serverQuery.data, projectRows, t]);

  // ⚠️ Хоёр индексийг НЭГ эрэмбэд оруулна — сервер хожуу хариулсан ч
  // локал илэрц эхнээсээ харагдсаар байна, зөвхөн жагсаалт баяжина.
  const hits = searching
    ? rankSearchEntries(
        serverIndex.length > 0 ? [...searchIndex, ...serverIndex] : searchIndex,
        q,
        SEARCH_LIMIT,
      )
    : [];
  /** Серверийн хариу нисэж яваа эсэх — жижиг тэмдэглэгээ (хаалт БИШ). */
  const serverBusy = serverSearchOn && serverQuery.isFetching;

  /** Хайлтын мөрийг идэвхжүүлэх — шилжих эсвэл үйлдлээ хийгээд цэсийг цэвэрлэнэ. */
  const runEntry = (entry: SearchEntry) => {
    setQuery('');
    setCursor(0);
    closeDrawer();
    if (entry.to) navigate(entry.to);
    else entry.run?.();
  };

  /** Хайлтын талбарыг нээж фокуслах (⌘/Ctrl+K, эсвэл хумиулсан горимын товч). */
  const focusSearch = () => {
    const el = searchRef.current;
    if (el) {
      el.focus();
      el.select();
      return;
    }
    // Талбар DOM-д алга — sidebar хумигдсан эсвэл утасны drawer хаалттай.
    // Нээгээд, гарч ирмэгц нь доорх effect фокусыг өгнө.
    wantFocusRef.current = true;
    if (isMobile) setOpenMobile(true);
    else setOpen(true);
  };

  // Талбар DOM-д гармагц хүлээгдэж буй фокусыг өгнө (dep-гүй effect санаатай:
  // sidebar дэлгэгдэх/drawer нээгдэх render-үүдийн аль нэгэнд нь таарна).
  useEffect(() => {
    if (!wantFocusRef.current) return;
    const el = searchRef.current;
    if (!el) return;
    wantFocusRef.current = false;
    el.focus();
    el.select();
  });

  // ⌘/Ctrl + K — цэсний хайлт.  (Sidebar-ын хураах/дэлгэх нь ⌘/Ctrl + \.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      focusSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `focusSearch` нь render бүрт шинэ ч зөвхөн setState-үүдийг дууддаг тул
    // сонсогчийг дахин холбох шаардлагагүй.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (query) {
        setQuery('');
        setCursor(0);
      } else {
        searchRef.current?.blur();
      }
      return;
    }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = hits[Math.min(cursor, hits.length - 1)];
      if (entry) runEntry(entry);
    }
  };

  /** Таарсан хэсгийг тодруулж буцаана.
   *
   *  ⚠️ Тодруулга нь ЗӨВХОН шууд (кирилл→кирилл) таарц дээр ажиллана.
   *  Латинаар бичсэн кирилл илэрц («iluu tsag» → «Илүү цаг») нь жагсаалтад
   *  ГАРНА, гэхдээ тодрохгүй — `foldSearchText` нь урттай тоглодог тул
   *  индексийг түүхий мөрөнд буцааж буулгах боломжгүй.  Жагсаалтад гарах
   *  нь тодрохоос хамаагүй чухал. */
  const highlight = (label: string) => {
    const hit = searching ? findHighlight(label, q) : null;
    if (!hit) return label;
    return (
      <>
        {label.slice(0, hit.at)}
        <mark className="rounded-xs bg-primary/25 text-inherit">
          {label.slice(hit.at, hit.at + hit.len)}
        </mark>
        {label.slice(hit.at + hit.len)}
      </>
    );
  };

  /** Нэг мөр — дэд цэстэй бол эвхэгдэнэ, үгүй бол энгийн холбоос. */
  const renderNavItem = (item: NavItem) => {
    const kids = childrenFor(item);
    const label = t(navLabelKey(item, user?.role));

    // Дэд цэсгүй (эсвэл хумиулсан горимд — дэд цэс нуугддаг) → энгийн холбоос.
    //
    // «Ганц өөрийн хүүхэд» гэдэг нь мөн дэд цэсгүйтэй адил: `Ирц` мөр нь
    // `[өөрөө, Ирцийн самбар]` гэсэн хүүхэдтэй ч админ БУС хэрэглэгчид
    // `Ирцийн самбар` шүүгдэн хасагдаж, зөвхөн өөрийнх нь холбоос үлддэг.
    // Түүнийг эвхэгддэг цэс болгох нь утга учиргүй — нэг мөрийг нээхэд яг
    // тэр л мөр гарч ирнэ.
    const onlySelfChild = kids.length === 1 && kids[0]?.to === item.to;
    if (kids.length === 0 || onlySelfChild || isIconMode) {
      return (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton
            asChild
            tooltip={label}
            isActive={activePath === item.to || kids.some((c) => c.to === activePath)}
          >
            <NavLink to={item.to} end={item.to === '/app'} onClick={closeDrawer}>
              <item.icon />
              <span>{label}</span>
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    }

    const childActive = kids.some((c) => c.to === activePath) || activePath === item.to;
    const open = openGroups[item.to] ?? childActive;

    return (
      <Collapsible
        key={item.to}
        asChild
        open={open}
        onOpenChange={(v) => setOpenGroups((prev) => ({ ...prev, [item.to]: v }))}
        className="group/collapsible"
      >
        <SidebarMenuItem>
          {/* ⚠️ Энд `tooltip`-ыг ЗОРИУД дамжуулаагүй: тэр тохиолдолд
              `SidebarMenuButton` нь `<Tooltip>`-оор ороогдож буцдаг тул
              `CollapsibleTrigger asChild` нь өөрийн `onClick`/`data-state`-ыг
              DOM товч руу биш, Radix-ийн Tooltip.Root руу өгч, дэд цэс огт
              нээгдэхгүй болно.  Ямар ч байсан хумиулсан горимд энэ мөр
              дээрх `renderNavItem`-ийн салаагаар энгийн холбоос (tooltip-той)
              болж хувирдаг тул алдагдах юм алга. */}
          <CollapsibleTrigger asChild>
            <SidebarMenuButton isActive={childActive && !open}>
              <item.icon />
              <span>{label}</span>
              <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {kids.map((child) => (
                <SidebarMenuSubItem key={child.to}>
                  <SidebarMenuSubButton asChild isActive={activePath === child.to}>
                    <NavLink to={child.to} onClick={closeDrawer}>
                      {/* Төслийн нэр урт байж болно — sidebar 16rem тул
                          таслана; бүтэн нэр (кодтойгоо) `title`-д үлдэнэ. */}
                      <span
                        className="truncate"
                        title={child.fullLabel ?? navChildLabel(child, t)}
                      >
                        {navChildLabel(child, t)}
                      </span>
                    </NavLink>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  };

  return (
    <Sidebar collapsible="icon">
      {/* Толгой — лого + аппын нэр, дарвал хянах самбар руу. */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1">
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip={t('sidebar.dashboardTooltip')}
              /* `gap-2` — суурь `gap-3`-ыг зориуд дарж брэндийн мөрөнд 4px нэмнэ
                 (доорх өргөний тооцоог үз). */
              className="gap-2 hover:bg-transparent data-[active=true]:bg-transparent"
            >
              <Link to="/app" onClick={closeDrawer} aria-label={t('sidebar.goToDashboard')}>
                {/*
                  Лого — ЗУРГИЙГ ТАСЛАЖ томсгосон хайрцаг.

                  ⚠️ `public/logo.svg`-ийн viewBox нь 1920×1080 боловч БОДИТ
                  зураг нь түүний дунд ердөө 455×349 нэгжийг эзэлдэг (растержуулж
                  хэмжсэн: x 732–1187, y 365–714, хоёр тэнхлэгээр голлосон).
                  Тиймээс `h-9` (36px) гэж өгөхөд харагдах тэмдэг ердөө ~11.6px
                  болж, хажуугийн цэсэн дээр бараг үл ялиг харагддаг байв.

                  Шийдэл: гаднах хайрцаг = ХАРАГДАХ хэмжээ, дотор нь зургийг
                  1080/349 = 3.09 дахин томсгож голлуулна; илүүдэл нь
                  `overflow-hidden`-д тайрагдана. Ингэснээр сөрөг зай ашиглахгүй
                  тул flex мөрийн бусад элемент хөдлөхгүй.
                  Хэвлэх хуудсанд ижил тооцоо `printStyles.ts`-д (LOGO_INK_MM).
                */}
                <span className="relative block h-5 w-7 shrink-0 overflow-hidden">
                  <img
                    src="/logo.svg"
                    alt={brand().nameShort}
                    className="absolute top-1/2 left-1/2 h-[62px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 select-none [filter:brightness(0)_drop-shadow(0_1px_2px_rgba(0,0,0,0.15))] dark:[filter:brightness(0)_invert(1)_drop-shadow(0_1px_2px_rgba(0,0,0,0.4))]"
                    draggable={false}
                  />
                </span>
                {/*
                  Брэнд — СТАТИК гурван үг (2026-08-17, хэрэглэгчийн хүсэлт):
                      Design Management System

                  Өмнө нь «Design» + `RotatingText`-ээр management ⇄ system
                  эргэлддэг байсныг зориуд ХАССАН — бүтээгдэхүүний нэр тогтвортой
                  харагдах ёстой.

                  ⚠️ НЭГ МӨР, гурван үг БҮТЭН харагдах ёстой — хэмжээ нь нүдэн
                  таамаг биш, тооцоолол:

                    Байгаа зай = 16rem(256) − Header p-2(16) − товч p-2(16)
                                 − лого w-7(28) − gap-2(8) = 188px
                    Бичвэрийн өргөн (Inter): «Design Management System» = 13.46em,
                                 semibold ≈ 14.1em, `tracking-tight` (−0.025em ×
                                 23 зай) ≈ 13.53em → 13px-д ≈ 176px  ✔ ~12px нөөц

                  Тиймээс `text-[13px] tracking-tight` бөгөөд товчны суурь `gap-3`-ыг
                  `gap-2` болгож 4px чөлөөлсөн.  `text-sm`(14px) руу буцаавал 197px
                  болж ДАХИН тайрагдана — фонт эсвэл үгийг өөрчлөхгүйгээр бүү өсгө.
                  «Management System» нь `font-medium` — өнгөний ялгаанаас гадна
                  хагас алхам нарийн болгож нэмэлт зай гаргана.

                  ⚠️ Орчуулгын түлхүүр БИШ, зориуд хатуу бичсэн: энэ бол
                  бүтээгдэхүүний НЭР бөгөөд хоёр хэл дээр ижил байна. Толгойн
                  breadcrumb-д товч «DMS» (`sidebar.appName`) хэвээр.
                */}
                <span className="truncate text-[13px] tracking-tight whitespace-nowrap">
                  <span className="font-semibold text-foreground">Design</span>{' '}
                  <span className="font-medium text-primary">Management System</span>
                </span>
              </Link>
            </SidebarMenuButton>
            {/* Утасны drawer-ыг хаах — хөшгөн дээр дарах, Escape-ээс гадна
                тодорхой товч.  Цэвэрлэгч утаснаасаа л ордог тул чухал. */}
            {isMobile && (
              <button
                type="button"
                onClick={closeDrawer}
                aria-label={t('sidebar.closeMenu')}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            )}
          </SidebarMenuItem>
        </SidebarMenu>

        {/* Цэсний хайлт — толгойн ЭХНИЙ агуулгын блок (лого нь брэнд бөгөөд
            дарвал хянах самбар руу ордог тул хамгийн дээрээ үлдэнэ).  Хэрэглэгчийн
            профайлын карт үүний ДООР сууна.  Ганцхан мөртэй цэсэнд (цэвэрлэгч →
            зөвхөн «Ирц») хайлт утга учиргүй тул харуулахгүй. */}
        {showSearch &&
          (isIconMode ? (
            // Хумиулсан горимд талбар багтахгүй — товч нь sidebar-ыг дэлгээд
            // фокусыг хайлтын талбарт өгнө.
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip={t('sidebar.search')} onClick={focusSearch}>
                  <Search />
                  <span>{t('sidebar.search')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <SidebarInput
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder={t('sidebar.searchPlaceholder')}
                aria-label={t('sidebar.searchPlaceholder')}
                autoComplete="off"
                className="pr-8 pl-8"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setCursor(0);
                    searchRef.current?.focus();
                  }}
                  aria-label={t('sidebar.searchClear')}
                  className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}

        {/* Тусгаарлагч нь хайлт БАЙГАА үед л утгатай — цэвэрлэгчид (хайлтгүй)
            эс бөгөөс логоны доор ганцаараа дүүжлэгдэнэ. */}
        {showSearch && <SidebarSeparator />}

        {/* «Профайл» — хайлтын ДООР.  Профайл нь role бүрт (цэвэрлэгч ч мөн —
            `/app/profile` нь `WORKER_ALLOWED_PATHS`-д бий) харагдана тул
            `visibleItems`-ийн шүүлтээс ГАДУУР. */}
        <SidebarProfileBlock onNavigate={closeDrawer} />
      </SidebarHeader>

      {/* Цэс — хайж байвал илэрц, үгүй бол үндсэн бүлэг · Админ · Тохиргоо */}
      <SidebarContent>
        {searching ? (
          <SidebarGroup>
            <SidebarGroupLabel>
              {t('sidebar.searchResults')}
              {hits.length > 0 && (
                <span className="ml-1 font-normal text-muted-foreground">({hits.length})</span>
              )}
              {/* Серверийн хайлт нисэж явна.  ⚠️ Зөвхөн ТЭМДЭГЛЭГЭЭ —
                  локал илэрцүүд доор нь хэвийн харагдсаар байна. */}
              {serverBusy && (
                <RefreshCw
                  className="ml-1 size-3 animate-spin text-muted-foreground"
                  aria-label={t('sidebar.searchLoading')}
                />
              )}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {hits.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  {/* Сервер хариулаагүй байхад «Юу ч олдсонгүй» гэж
                      батлахгүй — тэр нь худал болж мэднэ. */}
                  {serverBusy ? t('sidebar.searchLoading') : t('sidebar.searchNoResults')}
                </p>
              ) : (
                <SidebarMenu>
                  {hits.map((entry, i) => (
                    <SidebarMenuItem key={entry.id}>
                      <SidebarMenuButton
                        size="lg"
                        // Зөвхөн ЗАМААР жишнэ — хуудасны хэсгийн мөр
                        // (`?tab=`/`?section=`) ямар ч үед идэвхтэй замтай
                        // яг таарахгүй байсан.
                        isActive={!!entry.to && entry.to.split('?')[0] === activePath}
                        // ↑/↓-ийн курсор — идэвхтэй маршрутын өнгөнөөс тусад нь.
                        className={cn(i === cursor && 'bg-accent text-accent-foreground')}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => runEntry(entry)}
                        // Төслийн нэр урт тул тасарна — бүтнээр нь tooltip-д.
                        title={entry.label}
                      >
                        <entry.icon />
                        <span className="grid flex-1 leading-tight">
                          <span className="truncate">{highlight(entry.label)}</span>
                          {entry.hint && (
                            <span className="truncate text-xs font-normal text-muted-foreground">
                              {/* «↳» нь тухайн мөр бол ХУУДАС биш, хуудасны
                                  ДОТООД хэсэг гэдгийг нэг харцаар хэлнэ. */}
                              {entry.kind === 'section' && <span aria-hidden="true">↳ </span>}
                              {entry.hint}
                            </span>
                          )}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            {/* Семантик бүлгүүд — `NAV_GROUPS`-ийн дараалал.  `groupedItems`
                хоосон бүлгийг аль хэдийн хассан тул энд нэмэлт шалгалт
                хэрэггүй: гарчиг нь мөргүйгээр хэзээ ч гарахгүй. */}
            {groupedItems.map((g, idx) => (
              <SidebarGroup
                key={g.key}
                // `utility` (MCP заавар · Revit · Тохиргоо) нь гарчиггүй бөгөөд
                // `mt-auto`-гоор sidebar-ийн ЁРООЛД наалдана — өмнө нь энэ
                // үүргийг зөвхөн «Тохиргоо» мөр гүйцэтгэдэг байв.
                className={cn(idx > 0 && 'pt-0', g.key === 'utility' && 'mt-auto pt-0')}
              >
                {g.labelKey && showGroupLabels && (
                  <SidebarGroupLabel>{t(g.labelKey)}</SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  <SidebarMenu>{g.items.map(renderNavItem)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </>
        )}
      </SidebarContent>

      {/* Хөл — хэрэглэгчийн цэс (профайл · хэл · өнгө · гарах) */}
      {/*
        ⚠️ Хөл дэх бүртгэлийн цэс 2026-08-04-нд ХАСАГДСАН (хэрэглэгчийн хүсэлт).
        Профайл · хэл · сэдэв · гарах нь одоо толгойн баруун дээд булангийн
        профайл дээр (`AccountMenu`) байна — самбар хураангуй байсан ч олдоно.
      */}

      {/*
        ⚠️ `SidebarRail` ЗОРИУДААР хасагдсан (2026-08-04, хэрэглэгчийн хүсэлт).
        Тэр нь самбарын ирмэг дагуу сунасан 16px өргөнтэй ҮЛ ҮЗЭГДЭХ товч бөгөөд
        дарахад самбарыг хураадаг. Цэсний мөрүүд рүү заах явцад санамсаргүй
        оногдож, самбар гэнэт хумигддаг байв. Хураах/дэлгэх нь толгой дахь
        `SidebarTrigger`-ээр хэвээр — өөрөөр хэлбэл боломж алдагдаагүй, зөвхөн
        санамсаргүй оногддог далд бай арилсан.
      */}
    </Sidebar>
  );
};

// Routes that want to own the whole content area (no container max-width,
// no padding). Компанийн самбар — өргөн дэлгэцийн хуудас: max-w-7xl
// хайрцагт шахахгүй, padding-гүй, өөрийн дотоод scroll + sticky toolbar-тай.
// Үнийн саналын хуудсууд 13-14 багантай Excel маягийн хүснэгт тул max-w-7xl
// хайрцагт багтахгүй — өөрсдөө хэвтээ гүйлгэлтээ хариуцна.
const FULL_BLEED_ROUTES = new Set<string>(['/app/company', '/app/mail', '/app/teams', '/app/admin/system-workbench']);

// ӨРГӨН хуудсууд — `max-w-[1600px]` хайрцгийг алгасаж бүтэн өргөнөө эзэлнэ,
// ГЭХДЭЭ Layout-ийн ердийн босоо гүйлгэлт + padding-тай хэвээр.
//
// ⚠️ Full-bleed-ЭЭС ялгаатай: тэр нь `overflow-hidden` тавьдаг тул хуудас өөрөө
// дотоод scroll-оо хариуцах ёстой (chat/mail-ийн 3 панель, company-гийн sticky
// toolbar). Үнийн саналын хуудсууд бол ердийн урсгалтай баримт — тэднийг
// full-bleed болгосон үед агуудлага таслагдаж, огт гүйлгэгдэхгүй байсан.
const WIDE_ROUTES = new Set<string>(['/app/quotes']);

/**
 * Бүрхүүлийн агуулга.  `SidebarProvider`-ын ДОТОР сууна — доод таб мөрний
 * «бүх цэс», түргэн үйлдлийн sheet хоёр `useSidebar()`-аар drawer-ыг нээнэ.
 */
/**
 * Бүртгэлийн цэс — профайл · хэл · сэдэв · гарах.
 *
 * 2026-08-04 хүртэл энэ нь хажуугийн самбарын ХӨЛД (`SidebarFooter`) сууж
 * байсныг хэрэглэгчийн хүсэлтээр толгойн баруун дээд булангийн профайл руу
 * зөөв — тэнд өмнө нь ердөө `/app/profile` руу заасан холбоос байсан тул
 * сэдэв/хэл солих нь самбар хураангуй үед олдохгүй байлаа.
 *
 * Өөрийн hook-уудаа өөрөө эзэмшдэг (`LayoutShell`-д 4 hook нэмэхийн оронд) —
 * ингэснээр цэсийг өөр газар ч хийсвэрлэлгүй тавьж болно.
 */
function AccountMenu({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const { resolved: resolvedTheme, setTheme } = useTheme();
  const { setOpenMobile } = useSidebar();
  const navigate = useNavigate();

  const displayName = formatDisplayName(user?.full_name);
  const initials = displayName ? displayName.substring(0, 2).toUpperCase() : '??';
  const avatarSrc = user?.profile_image ? `${MEDIA_BASE_URL}${user.profile_image}` : undefined;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      {/* Толгойн баруун захад тул `align="end"` — эс бөгөөс цэс дэлгэцээс халина. */}
      <DropdownMenuContent className="min-w-56 rounded-lg" side="bottom" align="end" sideOffset={8}>
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left">
            <Avatar className="h-8 w-8 rounded-lg">
              {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
              <AvatarFallback className="rounded-lg bg-primary/20 text-xs font-semibold text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 leading-tight">
              <span className="truncate text-sm font-medium">{displayName}</span>
              <span className="truncate text-xs text-muted-foreground">
                {t(roleLabelKey(user?.role))}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/app/profile" onClick={() => setOpenMobile(false)}>
              <UserRound />
              {t('pageTitle.profile')}
            </Link>
          </DropdownMenuItem>
          {/* Програмын хүсэлт (алдаа/сайжруулалт) илгээх + өөрийн хүсэлтийн явц.  Дотоод ажилтан бүрд;
              inbox (бусдын хүсэлт) ЭНД БИШ — зөвхөн reviewer-ийн sidebar мөрөөр. */}
          {user && EF_SUBMITTER_ROLES.includes(user.role) && (
            <DropdownMenuItem asChild>
              <Link to="/app/my-engineering-requests" onClick={() => setOpenMobile(false)} data-testid="account-engineering-requests">
                <Bug />
                {t('nav.myEngineeringRequests')}
              </Link>
            </DropdownMenuItem>
          )}
          {/* ⚠️ «Хэл солих» ЭНДЭЭС ХАСАГДСАН — толгойн мөрөнд, хонхны зүүн
              талд ил товч болов (2026-08-13). Хоёр газар байвал аль нь
              жинхэнэ вэ гэдэг нь ойлгомжгүй болно. */}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-label text-muted-foreground">
          {t('sidebar.themeMode')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={resolvedTheme}
          onValueChange={(v) => setTheme(v as ResolvedTheme)}
        >
          {THEME_MODES.map(({ value, icon: Icon, labelKey }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              // Сонгосны дараа цэс НЭЭЭЛТТЭЙ үлдэнэ: сэдэв шууд солигдож
              // харагддаг тул гурвуулангаа харьцуулж болно.
              onSelect={(e) => e.preventDefault()}
            >
              <Icon />
              {t(labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
          <LogOut />
          {t('sidebar.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LayoutShell = ({ children }: { children: React.ReactNode }) => {
  const [quickOpen, setQuickOpen] = useState(false);
  const { isMobile, setOpenMobile } = useSidebar();
  const { user } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const pageTitleKey = usePageTitleKey();
  const pageTitle = t(pageTitleKey);
  const location = useLocation();
  // Асуулгын засварлагч нь `/templates/:id` гэсэн динамик зам тул Set-ийн яг
  // таарцад ороогүй — өөрөө 3 баганын дотоод гүйлгэлттэй бүтэн дэлгэц.
  const isFullBleed =
    FULL_BLEED_ROUTES.has(location.pathname) ||
    // Багийн дэлгэрэнгүй (`/app/teams/:id`) — нэг дэлгэцийн самбар, хуудас өөрөө өндрөө
    // хуваарилна (`TeamDetailPage`); жижиг дэлгэц дээр өөрийн дотор гүйлгэнэ.
    /^\/app\/teams\/\d+$/.test(location.pathname) ||
    location.pathname.startsWith('/app/admin/assessments/templates/');
  // `/app/quotes/:id` (засварлагч) нь Set-ийн яг таарцад ороогүй тул угтвараар.
  const isWide =
    WIDE_ROUTES.has(location.pathname) || location.pathname.startsWith('/app/quotes/');
  const displayName = formatDisplayName(user?.full_name);
  const initials = displayName ? displayName.substring(0, 2).toUpperCase() : '??';
  const avatarSrc = user?.profile_image ? `${MEDIA_BASE_URL}${user.profile_image}` : undefined;
  // Толгойн bell-тэй ЯГ ижил query — badge хоёр газарт зөрөх боломжгүй.
  const { data: unreadData } = useUnreadCount();
  const unread = unreadData?.count ?? 0;
  const { canGoBack, goBack } = useGoBack();

  // Аппын ганц гүйлгэгч.  Документ өөрөө хэзээ ч гүйлгэгддэггүй тул
  // браузерын өөрийн гүйлгэлт сэргээлт энд ажиллахгүй — өөрсдөө хийнэ.
  const mainRef = useRef<HTMLElement>(null);
  useScrollRestoration(mainRef);

  // Доош татаад сэргээх — зөвхөн утсан дээр.  Full-bleed хуудсууд (mail,
  // company, teams) `<main>`-ыг `overflow-hidden` болгож дотоод панелиудаараа
  // гүйлгэдэг тул `scrollTop` тэнд үргэлж 0 — доош чирэх болгонд сэргээлт
  // асах байсан.  Тиймээс тэднийг хасна.
  const queryClient = useQueryClient();
  const handleRefresh = useCallback(
    () =>
      Promise.all([
        // Зөвхөн ХАРАГДАЖ БАЙГАА query-үүд — бүх кэшийг татвал утсан дээр
        // хэдэн арван шаардлагагүй хүсэлт явна.
        queryClient.refetchQueries({ type: 'active' }),
        checkForAppUpdate(),
      ]),
    [queryClient],
  );
  const { indicatorRef } = usePullToRefresh(mainRef, handleRefresh, isMobile && !isFullBleed);

  // Keep the browser tab / history / SR page name in sync with the route.
  useDocumentTitle(pageTitle);

  // `?section=<id>` — глобал хайлтаас хуудасны ДОТООД хэсэг рүү үсрэх.
  // Аппын БҮХ хуудсанд нэг дор үйлчилнэ: hook нь зөвхөн `id`-аар ажилладаг
  // тул шинэ хэсэг нэмэхэд энд юу ч засах шаардлагагүй
  // (`shared/lib/search/sections.ts`-ийн тайлбарыг үз).
  useSectionAnchor();

  // MGL AI-г ERP нээгдмэгц бэлэн болгоно — зөвхөн сүүлийн 14 хоногт
  // AI хэрэглэсэн хөтөч дээр; бусдад юу ч хийхгүй (VRAM-ийн шийдвэр).
  useMglAiPrewarm();

  return (
    <>
      <AppSidebar />

      {/* Main column — no background; header inherits chrome, main gets its own
          bg with soft corner.  Drawer нээлттэй үеийн фокусын хаалт, гүйлгэлтийн
          түгжээг Radix Dialog (Sheet) өөрөө хариуцна. */}
      <SidebarInset className="min-w-0 overflow-hidden">
        {/* Top header — same chrome color as sidebar. Border lives on
            <main> instead, so it traces the rounded inset corner cleanly
            instead of cutting a straight line through it. */}
        {/* `apple-mobile-web-app-status-bar-style: black-translucent` тул
            standalone горимд агуулга status bar-ын доогуур ордог —
            `pt-[env(safe-area-inset-top)]`-гүй бол гарчиг халхлагдана. */}
        <header
          data-slot="app-header"
          className="h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] flex items-center gap-2 sm:gap-3 px-4 lg:px-5 bg-chrome flex-shrink-0"
        >
          {/* Цэс нээх/хураах — утсан дээр drawer, desktop дээр icon-rail. */}
          <SidebarTrigger className="-ml-1" aria-label={t('sidebar.toggleMenu')} />
          {/* Буцах — браузерын «буцах»-тай ЯГ ижил: өмнөх хуудас руу (таб,
              шүүлтүүр, гүйлгэлттэй нь).  Суулгасан PWA (ялангуяа iOS) дээр
              браузерын товч огт байдаггүй тул энэ нь цорын ганц буцах зам.
              Апп энэ хуудсаар нээгдсэн бол самбар руу — `useGoBack`-ийг үз. */}
          {canGoBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={goBack}
              title={t('common.back')}
              aria-label={t('common.back')}
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft />
            </Button>
          )}
          <Separator
            orientation="vertical"
            className="mr-1 hidden h-4 bg-chrome-border sm:block"
          />

          {/* Breadcrumb — chrome label, not the page's <h1>. The page's own
              heading (PageHeader / page content) owns the single h1 so screen
              readers don't see two competing top-level headings per page. */}
          <Breadcrumb className="min-w-0 shrink">
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem className="hidden sm:block">
                <BreadcrumbLink asChild>
                  <Link to="/app">{t('sidebar.appName')}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate text-sm tracking-tight">
                  {pageTitle}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          {/* Гүйдэг мэдээллийн зурвас — breadcrumb-ийн дараах хоосон зайг
              эзэлнэ.  `flex-1` нь breadcrumb-аас ЭНД шилжсэн (breadcrumb
              одоо `shrink` — өөрийн өргөнөөрөө суух ба зай хүрэхгүй бол л
              агшина).  `lg`-ээс доош НУУГДАНА: 1024px-ээс нарийн дэлгэцэнд
              breadcrumb + баруун талын 4 хяналт аль хэдийн зай дүүргэдэг
              тул гүйдэг текст нэмбэл толгой шахагдана. */}
          <HeaderTicker className="hidden min-w-0 flex-1 lg:block" />

          {/* Санал хүсэлт quick-open — аль ч ажилтан хаанаас ч санал илгээж явцаа харна.
              Sidebar-т ЗОРИУДААР байхгүй (дээрх NAV_ITEMS-ийн тайлбарыг үз) тул
              энэ товч бол цорын ганц оролт — өөрөөр хэлбэл түүний роль шүүлт ч
              зөвхөн энд байна.

              ⚠ Цэвэрлэгчид ХАРАГДАХГҮЙ.  `/app/suggestions` нь түүний
              `WORKER_ALLOWED_PATHS`-д ороогүй тул дархад `ProtectedRoute` шууд
              ирцийн хуудас руу нь буцаана — өөрөөр хэлбэл товч нь юу ч хийхгүй
              мэт мэдрэгдэнэ.  Тэр бүтэн толгойтой Layout авдаг тул энэ нь
              онолын биш, бодит тохиолдол (≥640px дэлгэц). */}
          {!isWorkerRole(user?.role) && (
            <NavLink
              to="/app/suggestions"
              className={({ isActive }) =>
                cn(
                  'hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-lg',
                  'text-xs font-medium transition-colors border',
                  isActive
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-chrome-hover/60 text-muted-foreground border-chrome-border hover:text-foreground hover:border-primary/30',
                )
              }
              title={t('header.suggestionsTitle')}
            >
              <Lightbulb className="h-3.5 w-3.5" />
              <span>{t('header.suggestions')}</span>
            </NavLink>
          )}

          {/* Ulaanbaatar weather chip — replaces the bigger weather card
              that used to live inside the dashboard hero.  Sits just left
              of the notification bell so it's visible on every page. */}
          <div className="hidden sm:block">
            <WeatherWidget chip />
          </div>

          {/* Хэл солих — ХОНХНЫ ЗҮҮН талд (2026-08-13, хэрэглэгчийн хүсэлт).
              Өмнө нь профайлын цэс дотор нуугдсан байсныг ил гаргав: хоёр
              хэлээр ажилладаг багт энэ нь өдөрт хэд хэдэн удаа хэрэгтэй.
              Одоогийн хэлийг ХАРУУЛНА, дарахад НӨГӨӨ рүү шилжинэ. */}
          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'mn' : 'en')}
            title={t('sidebar.switchLanguage')}
            aria-label={t('sidebar.switchLanguage')}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5',
              'text-xs font-semibold transition-colors',
              'border-chrome-border bg-chrome-hover/60 text-muted-foreground',
              'hover:border-primary/30 hover:text-foreground',
            )}
          >
            <Globe className="h-3.5 w-3.5" />
            <span className="tabular-nums">{lang.toUpperCase()}</span>
          </button>

          {/* Notification bell */}
          <NotificationBell />

          {/* User chip */}
          {/* Өмнө нь `/app/profile` руу заасан ЭНГИЙН холбоос байсныг цэс
              болгов — хажуугийн самбарын хөлөөс зөөгдсөн үйлдлүүд (сэдэв, хэл,
              гарах) энд амьдарна. `<button>` — trigger нь товшигдох элемент
              байх ёстой; профайл руу орох нь цэсний эхний мөр. */}
          <AccountMenu>
            <button
              type="button"
              aria-label={t('sidebar.accountMenu')}
              className="flex items-center gap-2 rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:opacity-80"
            >
              <Avatar className="h-7 w-7">
                {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
                <AvatarFallback className="bg-primary/20 text-primary text-micro font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:flex flex-col items-start leading-none">
                <span className="text-sm font-medium text-foreground">{displayName}</span>
                <span className="text-micro text-muted-foreground mt-0.5">
                  {t(roleLabelKey(user?.role))}
                </span>
              </div>
              <ChevronsUpDown className="hidden h-3.5 w-3.5 text-muted-foreground md:block" />
            </button>
          </AccountMenu>
        </header>

        {/* Scrollable content — bg-background with rounded top-left shows chrome behind the corner.
            Full-bleed routes (e.g. /chat) skip the padding + max-width wrapper so they can
            fill the entire content area edge-to-edge.

            Доод bottom nav-ын зайг `--app-bottom-nav-h` токен + safe-area-аас
            тооцно. Урьдын шидэт `pb-16`/`pb-20` нь notch-той төхөөрөмж дээр
            (viewport-fit=cover идэвхжсэний дараа) хүрэлцэхээ больсон. */}
        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className={cn(
            // `relative` — pull-to-refresh индикаторын байрлалын суурь.
            'relative flex-1 bg-background rounded-tl-[2rem] min-h-0 border-t border-l border-chrome-border outline-none',
            isFullBleed
              ? 'overflow-hidden flex flex-col pb-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom))] lg:pb-0'
              : // `overscroll-none` нь гинжин гүйлгэлтийг зогсоохоос гадна
                // ирмэг дээрх уян (rubber-band) үсрэлтийг ч арилгана — аппын
                // мэдрэмж өгнө.  Сул хувилбар нь эхнийхийг л хийдэг.
                'overflow-y-auto overflow-x-hidden overscroll-none p-4 pb-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom)+1rem)] lg:p-7 lg:pb-7',
          )}
        >
          {/* Full-bleed хуудсууд (chat г.м.) бүтэн өргөнөө эзэлнэ; бусад нь
              компанийн самбартай ижил `max-w-[1600px] mx-auto`-аар төвлөрнө —
              ингэснээр өргөн дэлгэц дээр контент хэт сунаж, хоёр тал нь хэт
              хоосон харагдахгүй. Нарийн формууд PageContainer `narrow`-оор. */}
          {/* Доош татаад сэргээх индикатор.  `<main>`-ын хамгийн эхэнд, урсгалаас
              гадуур (`absolute`) — тиймээс агуулгыг түлхэхгүй.  `usePullToRefresh`
              нь `transform`-ыг React-ээр биш, шууд DOM дээр бичдэг тул хуруу
              дагасан хөдөлгөөн кадр алдахгүй. */}
          {/* ⚠️ `transform`/`opacity`-г JSX-ийн `style`-д БИЧИХГҮЙ: Layout
              дахин render хийхэд (жишээ нь мэдэгдлийн тоо солигдоход) React
              тэдгээрийг анхны утга руу нь буцаан тавьж, татах дундуур
              индикатор үсрэх байсан.  Inline style-ыг зөвхөн hook эзэмшинэ;
              эхний нуулт нь `opacity-0` ангиар. */}
          <div
            ref={indicatorRef}
            aria-hidden="true"
            data-spinning="false"
            className="pointer-events-none absolute left-1/2 top-2 z-30 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-chrome-border bg-card opacity-0 shadow-lg lg:hidden"
          >
            <RefreshCw
              className="size-4 text-primary [transform:rotate(var(--ptr-rotate,0deg))]
                         [[data-spinning='true']_&]:animate-spin
                         [[data-spinning='true']_&]:[transform:none]"
            />
          </div>

          {isFullBleed || isWide ? children : (
            <div className="mx-auto w-full max-w-[1600px]">{children}</div>
          )}
        </main>
      </SidebarInset>

      <MobileBottomNav
        onOpenMore={() => setOpenMobile(true)}
        onOpenQuickActions={() => setQuickOpen(true)}
        unreadCount={unread}
      />
      <QuickActionSheet
        open={quickOpen}
        onOpenChange={setQuickOpen}
        onOpenMore={() => setOpenMobile(true)}
      />

      {/* PWA — суулгах санал (Android prompt / iOS зааварчилгаа) ба
          шинэ service worker хүлээж байгаа үеийн «Шинэчлэх» товч. */}
      <InstallPrompt />
      <UpdatePrompt />
      {/* Таскийн хуваарилалтын 426/423 (хуучирсан хуудас, түр түгжээ) — тодорхой мэдэгдэл. */}
      <TaskAllocGateBanner />

      {/* Курсорыг дагасан зөөлөн primary гэрэлтэлт — бүх апп дээр. */}
      <CursorSpotlight />

      {/* Web notification: ажил эхлэхээс 5 мин өмнө + push захиалгын эвлэрүүлэлт. */}
      <NotificationsManager />

      {/* Сарын эхэнд: өмнөх сарын ирцээ батлаагүй бол «Миний сарын ирц» руу
          чиглүүлэх цонх (ирсэн бүртгэл бүрд + шинэ таб/өдөр бүрд). */}
      <MonthConfirmPrompt />

      {/* Менежментийн баг (admin): «Өнөөдөр юу хийв?» — баруун доод булангийн тэмдэглэл,
          өдрийн тайланд дугаарлагдан нэмэгдэнэ (features/daily-log/DailyLogNote.tsx). */}
      <DailyLogNote />
    </>
  );
};

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { t } = useLanguage();
  // ⚠️ ХАДГАЛАХ нь ХҮСЭЛТ (`collapsedPref`).  Утсан дээр энэ утга ямар ч
  // нөлөөгүй — тэнд sidebar нь бүтэн өргөнтэй drawer (Sheet) болж гардаг тул
  // `collapsible=icon` төлөв огт уншигддаггүй.  Тиймээс утасны сесс desktop-ийн
  // сонголтыг устгахгүй.
  const [collapsedPref, setCollapsedPref] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  // Persist collapse PREFERENCE (not the derived value).
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsedPref));
  }, [collapsedPref]);

  return (
    // `h-screen` (=100vh) нь iOS/Android-д хаягийн мөр харагдаж байхад
    // viewport-оос өндөр болж, доод ~60px нь браузерын chrome-ын ард орох
    // шалтгаан байсан. `h-dvh` нь бодит харагдах өндрийг дагана.
    <SidebarProvider
      open={!collapsedPref}
      onOpenChange={(open) => setCollapsedPref(!open)}
      className="h-dvh bg-chrome overflow-hidden selection:bg-primary/30"
    >
      {/* Skip link — first focusable element so keyboard/SR users can jump
          past the persistent sidebar+header chrome straight to page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
      >
        {t('common.skipToContent')}
      </a>
      <LayoutShell>{children}</LayoutShell>
    </SidebarProvider>
  );
};
