/**
 * ХУУДАСНЫ ДОТООД ХЭСГҮҮДИЙН хайлтын бүртгэл.
 *
 * Урьд нь глобал хайлт нь ЗӨВХӨН sidebar-ын мөрүүдийг мэддэг байсан —
 * өөрөөр хэлбэл цэсэнд харагдаж байгаа зүйлээ л олдог байв.  Гэтэл
 * хэрэглэгч цэсэнд байгааг нь хараад л мэддэг; түүнд хэрэгтэй нь цэсэнд
 * ХАРАГДДАГГҮЙ зүйл: «Илүү цаг» нь Ирц хуудасны хамгийн доод карт, «IP
 * хаяг» нь ирцийн самбарын долоо дахь таб.  Энэ файл яг тэдгээрийг
 * хаяглана.
 *
 * ─────────────────────────── Хэрхэн ажилладаг ───────────────────────────
 *
 * Хоёр л механизм байна, аль алиныг нь URL хариуцна:
 *
 *   ?tab=<value>      — `useTabParam` (shared/hooks) уншина.  Табтай хуудсууд.
 *   ?section=<domId>  — `useSectionAnchor` (shared/hooks) уншина.  Тэр нь
 *                       `document.getElementById`-аар олж, гүйлгэн авчирч,
 *                       хоромхон гэрэлтүүлээд параметрээ арчина.
 *
 * Хоёулаа нэг зэрэг байж болно: `?tab=ips&section=sec-att-admin-late` нь
 * эхлээд табыг нээж, дараа нь тэр табын доторх картыг гүйлгэнэ (панел
 * `KeepAliveTabs`-аар mount хийгдтэл hook нь ~2.4 секунд дахин оролдоно).
 *
 * ────────────────────────── Шинэ хэсэг нэмэх ──────────────────────────
 *
 *   1. Зорилтот блокт `id="sec-…"` + `scroll-mt-24` тавь (эсвэл таб бол
 *      `useTabParam`-д шилжүүл);
 *   2. энд НЭГ мөр нэм.
 *
 * Гуравдугаар алхам байхгүй — `Layout.tsx` энэ жагсаалтыг өөрөө уншина.
 *
 * ⚠️ ЭРХИЙН ХААЛТ: мөр бүр `page`-ээрээ эцэг цэсний мөртэй холбогдоно.
 * Эцэг нь тухайн хэрэглэгчид ХАРАГДАХГҮЙ бол хэсэг нь хайлтад ч гарахгүй
 * (`Layout.tsx`-ийн `visiblePaths`).  Тиймээс энд `roles` бичих
 * шаардлагагүй — зөвхөн эцэгтэйгээ ЗӨРӨХ тохиолдолд (жишээ нь профайлын
 * табууд) бич.
 */

/** Нэг хайлтын мөр — хуудасны дотоод хэсэг. */
export type AppSection = {
  /** Эцэг цэсний мөрний зам.  Харагдах эсэхийг ҮҮГЭЭР шийднэ. */
  page: string;
  /** Шилжих бүтэн зам — `?tab=` / `?section=`-тэйгээ. */
  to: string;
  /** i18n түлхүүр.  `mn.json`-д БАЙГАА түлхүүрийг дахин ашиглахыг эрхэмлэ —
   *  ингэснээр хэсгийн нэр хуудсан дээрх гарчигтайгаа үргэлж таарна. */
  labelKey: string;
  /** Нэмэлт синоним — монгол + англи, сул зайгаар.  `en.json` залхуу
   *  ачаалагддаг тул нөгөө хэлний нэрийг ЭНД бичих нь чухал. */
  keywords?: string;
  /** Эцгээсээ ЗӨРӨХ эрхийн шүүлт.  Хоосон бол эцгийнхээ хамрах хүрээ. */
  roles?: string[];
};

/*
 * ⚠️ `page` утга нь `Layout.tsx`-ийн `NAV_ITEMS[].to` (эсвэл түүний
 * хүүхдийн `to`)-той ЯГ таарах ёстой.  `/app/profile` нь цэсний мөр биш ч
 * бүртгэлийн үйлдлээр байдаг тул тусгайлан зөвшөөрөгдсөн.
 */
export const APP_SECTIONS: readonly AppSection[] = [
  // ─────────────────────────── Ирц ───────────────────────────
  // Хэрэглэгчийн нэрлэсэн гол хэрэгцээ: «илүү цаг» гэж бичээд шууд тэр
  // карт руу очих.  Ирц хуудас табгүй тул бүгд `?section=` анкороор.
  {
    page: '/app/attendance',
    to: '/app/attendance?section=sec-attendance-overtime',
    labelKey: 'myOvertimeCard.title',
    keywords: 'илүү цаг илүүцаг нэмэлт цаг overtime ot иллүү',
  },
  {
    page: '/app/attendance',
    to: '/app/attendance?section=sec-attendance-leaves',
    labelKey: 'myLeavesCard.title',
    keywords: 'чөлөө амралт хүсэлт leave vacation чөлөөний хүсэлт',
  },
  {
    page: '/app/attendance',
    to: '/app/attendance?section=sec-attendance-ooo',
    labelKey: 'myOutOfOfficeCard.title',
    keywords: 'гадуур ажлаас гадуурх томилолт out of office ooo',
  },
  {
    page: '/app/attendance',
    to: '/app/attendance?section=sec-attendance-notice',
    labelKey: 'attendancePage.clockOutNoticeTitle',
    keywords: 'журам анхааруулга гарах бүртгэл заавал notice policy clock out rule',
  },
  {
    page: '/app/attendance',
    to: '/app/attendance?section=sec-attendance-today',
    labelKey: 'attendancePage.todayAttendance',
    keywords: 'ирлээ явлаа бүртгүүлэх clock in out өнөөдөр',
  },
  {
    page: '/app/attendance',
    to: '/app/attendance?section=sec-attendance-schedule',
    labelKey: 'attendancePage.myWorkSchedule',
    keywords: 'цагийн хуваарь ээлж schedule shift 08 09',
  },
  {
    page: '/app/attendance',
    to: '/app/attendance?section=sec-attendance-weekly',
    labelKey: 'attendancePage.weeklyHours',
    keywords: 'долоо хоног график weekly hours chart',
  },
  {
    page: '/app/attendance',
    to: '/app/attendance?section=sec-attendance-recent',
    labelKey: 'attendancePage.recentSessions',
    keywords: 'сүүлийн бүртгэл түүх history sessions',
  },
  {
    page: '/app/attendance',
    to: '/app/attendance?section=sec-attendance-monthly',
    labelKey: 'myAttendance.title',
    keywords: 'сарын ирц хуанли monthly calendar',
  },

  // ───────────────────── Ирцийн самбар (админ) ─────────────────────
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=today',
    labelKey: 'attendanceAdminPage.tabToday',
    keywords: 'өнөөдөр ирсэн ирээгүй хоцорсон today present absent',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=open',
    labelKey: 'attendanceAdminPage.tabOpen',
    keywords: 'хаагдаагүй нээлттэй бүртгэл open sessions',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=reports',
    labelKey: 'attendanceAdminPage.tabReports',
    keywords: 'ирцийн тайлан report',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=today&section=sec-att-admin-present',
    labelKey: 'attendanceAdminPage.presentTodayTitle',
    keywords: 'ирсэн хүмүүс өнөөдөр present',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=today&section=sec-att-admin-absent',
    labelKey: 'attendanceAdminPage.absentTitle',
    keywords: 'ирээгүй тасалсан absent',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=reports&section=sec-att-admin-timesheet',
    labelKey: 'attendanceAdminPage.timesheet',
    keywords: 'цагийн хүснэгт timesheet',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=reports&section=sec-att-admin-daily',
    labelKey: 'attendanceAdminPage.dailyBreakdown',
    keywords: 'өдрийн мэдээ daily breakdown',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=summary',
    labelKey: 'attendanceAdminPage.tabSummary',
    keywords: 'хураангуй нэгдсэн summary',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=summary&section=sec-att-admin-summary',
    labelKey: 'attendanceAdminPage.summaryReport',
    keywords: 'хураангуй тайлан нэгдсэн summary report',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=leaves',
    labelKey: 'attendanceAdminPage.tabLeaves',
    keywords: 'чөлөө батлах ээлжийн амралт leave approve annual',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=outofoffice',
    labelKey: 'attendanceAdminPage.tabOutOfOffice',
    keywords: 'гадуурх цаг томилолт out of office',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=shifts',
    labelKey: 'attendanceAdminPage.tabShifts',
    keywords:
      'ажлын цаг ээлж хуваарь сонголт 8-17 8:30-17:30 9-18 shift schedule work hours roster',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=shifts&section=sec-att-admin-shifts',
    labelKey: 'attendanceAdminPage.shiftRosterTitle',
    keywords: 'хэн хэдэн цагаас ажилладаг ээлжийн жагсаалт who works when shift list',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=ips',
    labelKey: 'attendanceAdminPage.tabIps',
    keywords: 'ip хаяг оффис сүлжээ office network wifi',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=ips&section=sec-att-admin-late',
    labelKey: 'attendanceAdminPage.lateSettings',
    keywords: 'хоцролт торгууль тохиргоо late penalty grace',
  },
  {
    page: '/app/attendance/admin',
    to: '/app/attendance/admin?tab=ips&section=sec-att-admin-ips',
    labelKey: 'attendanceAdminPage.officeIps',
    keywords: 'оффисын ip хаяг цагаан жагсаалт allowlist',
  },

  // ────────────────────────── Профайл ──────────────────────────
  // ⚠️ `page` нь `/app/profile` — цэсний мөр БИШ, `actionEntries`-ийн мөр.
  // `Layout.tsx` түүнийг тусгайлан зөвшөөрсөн байдаг.
  {
    page: '/app/profile',
    to: '/app/profile?tab=profile',
    labelKey: 'profilePage.navProfile',
    keywords: 'хувийн мэдээлэл нэр утас profile personal',
  },
  {
    page: '/app/profile',
    to: '/app/profile?tab=security',
    labelKey: 'profilePage.navPassword',
    keywords: 'нууц үг солих password change нэвтрэх',
  },
  {
    page: '/app/profile',
    to: '/app/profile?tab=activity',
    labelKey: 'profilePage.navActivity',
    keywords: 'явцын түүх илгээсэн activity history',
    roles: ['admin', 'engineer', 'architect', 'senior', 'client'],
  },
  {
    page: '/app/profile',
    to: '/app/profile?tab=score',
    labelKey: 'profilePage.navScore',
    keywords: 'бүтээмж оноо миний score points',
    roles: ['admin', 'engineer', 'architect', 'senior', 'client'],
  },
  {
    page: '/app/profile',
    to: '/app/profile?tab=assessment',
    labelKey: 'profilePage.navAssessment',
    keywords: 'ур чадвар үнэлгээ судалгаа түвшин assessment skill level',
    roles: ['admin', 'engineer', 'architect', 'senior'],
  },
  {
    page: '/app/profile',
    to: '/app/profile?tab=pgp',
    labelKey: 'profilePage.navGrowthPlan',
    keywords: 'хөгжлийн төлөвлөгөө pgp growth plan',
    roles: ['admin', 'engineer', 'architect', 'senior', 'client'],
  },
  {
    page: '/app/profile',
    to: '/app/profile?tab=worklog',
    labelKey: 'profilePage.navDailyLog',
    keywords: 'өдрийн тайлан хийсэн ажил тэмдэглэл daily report work log journal',
    roles: ['admin'],
  },

  // ───────────────────────── Тохиргоо ─────────────────────────
  // `id`-ууд нь `SettingsShell`-д АЛЬ ХЭДИЙН байсан (scroll-spy рельс) —
  // энд зөвхөн хаягийг нь бүртгэж байна, шинэ код нэмээгүй.
  {
    page: '/app/settings',
    to: '/app/settings?section=settings-account',
    labelKey: 'settingsPage.navAccount',
    keywords: 'хэрэглэгчийн мэдээлэл бүртгэл account',
  },
  {
    page: '/app/settings',
    to: '/app/settings?section=settings-appearance',
    labelKey: 'settingsPage.navAppearance',
    keywords: 'гадаад төрх өнгө сэдэв бараан цайвар дундаж theme dark light dim хэл',
  },
  {
    page: '/app/settings',
    to: '/app/settings?section=settings-notifications',
    labelKey: 'settingsPage.navNotifications',
    keywords: 'мэдэгдэл push notification сануулга',
  },
  {
    page: '/app/settings',
    to: '/app/settings?section=settings-branding',
    labelKey: 'settingsPage.navBranding',
    keywords: 'лого брэнд тайлангийн logo branding',
  },
  {
    page: '/app/settings',
    to: '/app/settings?section=settings-holidays',
    labelKey: 'settingsPage.navHolidays',
    keywords: 'баярын өдөр ажлын бус амралтын holiday',
  },
  {
    page: '/app/settings',
    to: '/app/settings?section=settings-security',
    labelKey: 'settingsPage.navSecurity',
    keywords: 'аюулгүй байдал нууц үг security password',
  },
  // Гүйдэг мэдээ — 2026-09-18 хүртэл sidebar-ын `/app/admin/ticker` мөр
  // байсан; одоо Тохиргоо доторх admin-only хэсэг тул эцгээсээ (бүх
  // хэрэглэгчид харагдах Тохиргоо) ЗӨРЖ `roles` бичив.
  {
    page: '/app/settings',
    to: '/app/settings?section=settings-ticker',
    labelKey: 'tickerAdmin.title',
    keywords: 'гүйдэг мэдээ зурвас толгой урсдаг зар мэдээлэл ticker marquee news banner announcement',
    roles: ['admin'],
  },

  // ───────────────────────── Хянах самбар ─────────────────────────
  {
    page: '/app',
    to: '/app?section=sec-dashboard-score',
    labelKey: 'dailyScoreChart.title',
    keywords: 'миний бүтээмж оноо өдрийн productivity score',
  },
  {
    page: '/app',
    to: '/app?section=sec-dashboard-tasks',
    labelKey: 'dashboardPage.myTasks',
    keywords: 'миний даалгавар ажил my tasks',
  },
  {
    page: '/app',
    to: '/app?section=sec-dashboard-projects',
    labelKey: 'dashboardPage.activeProjects',
    keywords: 'идэвхтэй төсөл active projects',
  },
  {
    page: '/app',
    to: '/app?section=sec-dashboard-attendance',
    labelKey: 'attendanceWidget.title',
    keywords: 'ирц бүртгүүлэх clock widget',
  },
  {
    page: '/app',
    to: '/app?section=sec-dashboard-deadlines',
    labelKey: 'deadlines.upcomingTitle',
    keywords: 'ойрын эцсийн хугацаа upcoming deadline',
  },
  {
    page: '/app',
    to: '/app?section=sec-dashboard-calendar',
    labelKey: 'nav.calendar',
    keywords: 'хуанли календар google calendar уулзалт',
  },

  // ──────────────────────── Компанийн самбар ────────────────────────
  {
    page: '/app/company',
    to: '/app/company?section=sec-company-projects',
    labelKey: 'companyDashboardPage.projectList',
    keywords: 'төслийн жагсаалт бүх төсөл project list',
  },
  {
    page: '/app/company',
    to: '/app/company?section=sec-company-attendance',
    labelKey: 'companyDashboardPage.todayAttendance',
    keywords: 'өнөөдрийн ирц компани attendance today',
  },
  {
    page: '/app/company',
    to: '/app/company?section=sec-company-active',
    labelKey: 'companyDashboardPage.todayActiveProjects',
    keywords: 'өнөөдөр идэвхтэй төсөл active today',
  },
  {
    page: '/app/company',
    to: '/app/company?section=sec-company-activity',
    labelKey: 'companyDashboardPage.activity30Days',
    keywords: '30 хоног идэвхжил график activity trend',
  },
  {
    page: '/app/company',
    to: '/app/company?section=sec-company-overdue',
    labelKey: 'companyDashboardPage.overdue',
    keywords: 'хугацаа хэтэрсэн overdue',
  },

  // ──────────────────── Зохиогчийн хяналт (самбар) ────────────────────
  {
    page: '/app/asr',
    to: '/app/asr?section=sec-asr-plans',
    labelKey: 'asr.plans.title',
    keywords: 'хяналтын хуваарь төлөвлөгөө талбайд явах asr visit plan schedule',
  },
  {
    page: '/app/asr',
    to: '/app/asr?section=sec-asr-projects',
    labelKey: 'asr.statsProjects',
    keywords: 'зохиогчийн хяналт төслүүд asr projects',
  },
  {
    page: '/app/asr',
    to: '/app/asr?section=sec-asr-kpi',
    labelKey: 'asr.statsTotalVisits',
    keywords: 'зохиогчийн хяналт очилт статистик тоо asr visits stats',
  },
  {
    page: '/app/asr',
    to: '/app/asr?section=sec-asr-safety',
    labelKey: 'asr.safetyTitle',
    keywords: 'аюулгүй байдал хабэа каск хантааз хамгаалалтын хувцас талбай safety ppe site',
  },
  {
    page: '/app/asr',
    to: '/app/asr?section=sec-asr-monthly',
    labelKey: 'asr.statsMonthly',
    keywords: 'сарын очилт график asr monthly chart',
  },
  {
    page: '/app/asr',
    to: '/app/asr?section=sec-asr-completeness',
    labelKey: 'asr.statsCompleteness',
    keywords: 'улаан дэвтэр гарын үсэг батлах хугацаа бүрдэл red book signatures review time',
  },
  {
    page: '/app/asr',
    to: '/app/asr?section=sec-asr-recent',
    labelKey: 'asr.statsRecent',
    keywords: 'сүүлийн зохиогчийн хяналтын тайлан recent asr reports',
  },

  // ────────────────────── Бүтээмжийн самбар ──────────────────────
  {
    page: '/app/leaderboard',
    to: '/app/leaderboard?tab=list',
    labelKey: 'leaderboardPage.tabList',
    keywords: 'чансаа жагсаалт оноо leaderboard list',
  },
  {
    page: '/app/leaderboard',
    to: '/app/leaderboard?tab=monthly',
    labelKey: 'leaderboardPage.tabMonthly',
    keywords: 'сарын тайлан monthly report',
  },
  {
    page: '/app/leaderboard',
    to: '/app/leaderboard?tab=trend',
    labelKey: 'leaderboardPage.tabTrend',
    keywords: 'хандлага график trend chart',
  },
  {
    page: '/app/leaderboard',
    to: '/app/leaderboard?tab=list&section=sec-leaderboard-top',
    labelKey: 'leaderboardPage.topPerformer',
    keywords: 'тэргүүлэгч шилдэг top performer',
  },
  {
    page: '/app/leaderboard',
    to: '/app/leaderboard?tab=list&section=sec-leaderboard-active',
    labelKey: 'leaderboardPage.activeMembers',
    keywords: 'идэвхтэй гишүүн active members',
  },

  /* ---- Тайлан (admin) ---- */
  {
    page: '/app/reports',
    to: '/app/reports?tab=overview',
    labelKey: 'reportsPage.tabOverview',
    keywords: 'тайлан ажилтнууд бүтээмж байр хандлага employees report rank trend',
  },
  {
    page: '/app/reports',
    to: '/app/reports?tab=employee',
    labelKey: 'reportsPage.tabEmployee',
    keywords: 'ажилтны тайлан гэрээ нууц үг hr employee report contract password',
  },
  {
    page: '/app/reports',
    to: '/app/reports?tab=teams',
    labelKey: 'reportsPage.tabTeams',
    keywords: 'багийн тайлан team report',
  },
  {
    page: '/app/reports',
    to: '/app/reports?tab=snapshots',
    labelKey: 'reportsPage.tabSnapshots',
    keywords: 'өдрийн тайлан snapshot backfill daily report',
  },
  {
    page: '/app/reports',
    to: '/app/reports?tab=repair',
    labelKey: 'reportsPage.tabRepair',
    keywords: 'засварын төсөл тайлан дотоод ажил хувь цаг repair project report internal work',
  },
  {
    page: '/app/reports',
    to: '/app/reports?tab=nonproject',
    labelKey: 'reportsPage.tabNonProject',
    keywords: 'төслийн бус ажил батлах шалгах баталгаажуулах non-project work approve review verification',
  },
  {
    page: '/app/reports',
    to: '/app/reports?tab=tasktime',
    labelKey: 'reportsPage.tabTaskTime',
    keywords: 'таскийн цаг албан ёсны таймер эхлүүлэх зогсоох хэн ажиллаж байна ажилласан цаг task time official timer working now hours',
  },
  {
    page: '/app/reports',
    to: '/app/reports?tab=mgmt',
    labelKey: 'reportsPage.tabManagement',
    keywords: 'менежментийн баг өдрийн ажлын тайлан нэгтгэл хэн юу хийсэн management team daily work log digest',
  },
  {
    page: '/app/leaderboard',
    to: '/app/leaderboard?tab=list&section=sec-leaderboard-team-avg',
    labelKey: 'leaderboardPage.teamAverage',
    keywords: 'багийн дундаж team average',
  },

  // ────────────────────────── Хэрэглэгчид ──────────────────────────
  {
    page: '/app/users',
    to: '/app/users?tab=staff',
    labelKey: 'usersPage.tabStaff',
    keywords: 'ажилтан хүн жагсаалт staff employees',
  },
  {
    page: '/app/users',
    to: '/app/users?tab=pgp',
    labelKey: 'pgpAuthors.tab',
    keywords: 'хөгжлийн төлөвлөгөө pgp growth plan',
  },

  // ────────────────────── Ур чадварын үнэлгээ ──────────────────────
  {
    page: '/app/users',
    to: '/app/users?tab=assessments',
    labelKey: 'assessments.navTitle',
    keywords: 'үнэлгээ ур чадвар судалгаа assessment skill survey',
  },
  {
    page: '/app/users',
    to: '/app/users?tab=assessments&assessTab=rounds',
    labelKey: 'assessments.tabRounds',
    keywords: 'ээлж судалгаа round',
  },
  {
    page: '/app/users',
    to: '/app/users?tab=assessments&assessTab=templates',
    labelKey: 'assessments.tabTemplates',
    keywords: 'загвар асуулга template questionnaire',
  },

  // ──────────────────────── Үнийн санал ────────────────────────
  {
    page: '/app/quotes',
    to: '/app/quotes?tab=list',
    labelKey: 'nav.quotesList',
    keywords: 'саналын жагсаалт quote list',
  },
  {
    page: '/app/quotes',
    to: '/app/quotes?tab=templates',
    labelKey: 'nav.quoteTemplates',
    keywords: 'загвар хяналтын төсөв template',
  },
  {
    page: '/app/quotes',
    to: '/app/quotes?tab=tariffs',
    labelKey: 'nav.quoteTariffs',
    keywords: 'тариф каталог бд 81-16-20 tariff catalog',
  },

  // ───────────────────────── Тоо хэмжээ ─────────────────────────
  {
    page: '/app/qto',
    to: '/app/qto?tab=dashboard',
    labelKey: 'qtoPage.tabDashboard',
    keywords: 'самбар тоо хэмжээ dashboard boq',
  },
  {
    page: '/app/qto',
    to: '/app/qto?tab=overview',
    labelKey: 'qtoPage.tabOverview',
    keywords: 'тойм нийт дүн overview totals',
  },
  {
    page: '/app/qto',
    to: '/app/qto?tab=pivot',
    labelKey: 'qtoPage.tabPivot',
    keywords: 'ангилал материал шифр pivot classification',
  },
  {
    page: '/app/qto',
    to: '/app/qto?tab=history',
    labelKey: 'qtoPage.tabHistory',
    keywords: 'түүх илгээлт run history',
  },
  {
    page: '/app/qto',
    to: '/app/qto?tab=overview&section=sec-qto-latest',
    labelKey: 'qtoPage.latestRun',
    keywords: 'сүүлийн илгээлт latest run revit',
  },
  {
    page: '/app/qto',
    to: '/app/qto?tab=overview&section=sec-qto-category',
    labelKey: 'qtoPage.byCategoryTitle',
    keywords: 'категори ангилалаар by category',
  },

  // ───────────────────────── Захидал ─────────────────────────
  {
    page: '/app/mail',
    to: '/app/mail?folder=untriaged',
    labelKey: 'mailInbox.untriaged',
    keywords: 'ангилаагүй триаж untriaged',
  },
  {
    page: '/app/mail',
    to: '/app/mail?folder=inbox',
    labelKey: 'mailInbox.inbox',
    keywords: 'ирсэн захидал inbox',
  },
  {
    page: '/app/mail',
    to: '/app/mail?folder=sent',
    labelKey: 'mailInbox.sent',
    keywords: 'явсан илгээсэн sent',
  },
  {
    page: '/app/mail',
    to: '/app/mail?folder=all',
    labelKey: 'mailInbox.allMail',
    keywords: 'бүх захидал all mail',
  },

  // ─────────────────── Хуваарь / Эцсийн хугацаа ───────────────────
  // 2026-08-13: тусдаа «Хугацаа» хуудас устсан тул түүний хоёр мөр
  // (жагсаалт / хуанли) энэ хоёроор солигдов — эцсийн хугацаа одоо
  // хуваарийн мөрийн дэлгэрэнгүй самбарт удирдагдана.
  {
    page: '/app/timeline',
    to: '/app/timeline?section=sec-timeline-gantt',
    labelKey: 'deadlines.milestonesTitle',
    keywords: 'эцсийн хугацаа deadline milestone шалгах цэг',
  },
  {
    page: '/app/timeline',
    to: '/app/timeline?section=sec-timeline-toolbar',
    labelKey: 'timelinePage.filterState',
    keywords: 'шүүлт төлөв эрсдэл хэтэрсэн filter',
  },

  {
    page: '/app/settings',
    to: '/app/approvals?view=repair',
    labelKey: 'repair.adminTabTitle',
    keywords: 'засвар дахин ажил repair rework',
  },

  // ─────────────────────── Миний даалгавар ───────────────────────
  {
    page: '/app/my-tasks',
    to: '/app/my-tasks?section=sec-mytasks-repair',
    labelKey: 'repair.myRepairsTitle',
    keywords: 'миний засвар цаг repair',
  },
  {
    page: '/app/my-tasks',
    to: '/app/my-tasks?section=sec-mytasks-non-project',
    labelKey: 'nonProjectWork.title',
    keywords: 'төслийн бус ажил цаас наах баримт бичиг янзлах зохиогчийн хяналт non-project',
    // Хэсэг нь зөвхөн бүртгэх эрхтэй ролид рендерлэгдэнэ — CEO (admin) энэ
    // хуудсыг хардаг ч хэсэг нь хоосон тул хайлтын мөр хоосон газар үсэрнэ.
    roles: ['engineer', 'architect', 'senior'],
  },
  {
    page: '/app/my-tasks',
    to: '/app/my-tasks?section=sec-mytasks-previous',
    labelKey: 'dailyReport.previousTitle',
    keywords: 'өчигдөр өмнөх тайлан түүх previous yesterday history',
  },

  // ─────────────────────────── Багууд ───────────────────────────
  // ⚠️ Багууд хуудас 2026-09-03-наас ТАБТАЙ болсон.  Хайлтын мөр таб руу
  // ЗААХ ёстой (`?tab=…`), эс тэгвэл `?section=` нь өөр таб дотор нуугдсан
  // id-г хайж олохгүй — `useSectionAnchor` зөвхөн mount хийгдсэн DOM дээр
  // ажилладаг.  2026-09-24-нөөс ХОЁР таб л бий (Багаар, Тойм) — «Өнөөдөр»,
  // «Матриц» табууд хасагдсан.
  {
    page: '/app/teams',
    to: '/app/teams?tab=overview&section=sec-teams-overview',
    labelKey: 'teams.tabOverview',
    keywords: 'тойм график донат диаграм баг төсөл хүн ирц overview chart donut team project people',
    // 2026-09-30: бүх багийн самбар зөвхөн admin/senior-д; бусад нь `/app/teams`
    // дээр өөрийн багийн хуудас руу орно (`TeamsPage`) — хайлтаас энд хүргэхгүй.
    roles: ['admin', 'senior'],
  },
  {
    page: '/app/teams',
    to: '/app/teams?tab=byTeam&section=sec-teams-by-team',
    labelKey: 'teams.tabByTeam',
    keywords: 'баг ачаалал гишүүн team load member workload',
    roles: ['admin', 'senior'],
  },

  // ──────────────────── Туслахын сургалтын кураци ────────────────────
  // Эцэг цэсний мөр нь `/app/admin/assistant` (admin + senior); эрхийг
  // `Layout.tsx`-ийн `visiblePaths` эндээс өвлүүлнэ.
  {
    page: '/app/admin/assistant',
    to: '/app/admin/assistant?tab=pending',
    labelKey: 'assistantCuration.pendingTab',
    keywords: 'хүлээгдэж буй шошголоогүй pending queue label curate туслах',
  },
  {
    page: '/app/admin/assistant',
    to: '/app/admin/assistant?tab=reviewed',
    labelKey: 'assistantCuration.reviewedTab',
    keywords: 'хянасан татгалзсан rejected reviewed history туслах',
  },
  {
    page: '/app/admin/assistant',
    to: '/app/admin/assistant?tab=examples',
    labelKey: 'assistantCuration.examplesTab',
    keywords: 'сургалтын багц жишээ example corpus training set',
  },
  {
    page: '/app/admin/assistant',
    to: '/app/admin/assistant?tab=overrides',
    labelKey: 'compliance.overridesTab',
    keywords: 'хүчингүй болголт зөрчил татгалзал override false positive норм дүгнэлт',
  },

  // ───────────────── Төслийн бэлэн байдал (2-7 · §59 / §66 / §69) ─────────────────
  // ⚠️ ҮНЭНЧ ХЯЗГААР: гурван карт нь төслийн ДЭЛГЭРЭНГҮЙ хуудсын
  // «Бэлэн байдал» табын дотор амьдардаг ба тэр зам нь төслийн id
  // шаарддаг — хайлтын мөр түүнийг МЭДЭХГҮЙ.  Тиймээс эдгээр нь
  // хэрэглэгчийг төслийн ЖАГСААЛТ руу аваачна (`page` нь цэсний мөртэй
  // таарах ЁСТОЙ), тэндээс төслөө сонгоно.  `?tab=readiness` -ыг ЭНД
  // бичихгүй: жагсаалтын хуудас `?tab`-ыг УНШДАГГҮЙ тул тэр нь ажилладаг
  // мэт харагдах ХУДАЛ дохио болно.
  {
    page: '/app/projects',
    to: '/app/projects?section=sec-project-readiness',
    labelKey: 'readiness.title',
    keywords: 'бэлэн байдал хянахад бэлэн readiness review gate хаалга belen',
  },
  {
    page: '/app/projects',
    to: '/app/projects?section=sec-project-gaps',
    labelKey: 'readiness.gaps.title',
    keywords: 'цоорхой дутуу бүрэн бус gap completeness missing tsoorhoi',
  },
  {
    page: '/app/projects',
    to: '/app/projects?section=sec-project-quality',
    labelKey: 'readiness.quality.title',
    keywords: 'дүрмийн чанар худал дохио false positive fp fn quality durmiin chanar',
    // ⚠️ Эцгээсээ ЗӨРӨХ шүүлт: §66-ийн тоо нь `requireManager()` дор.
    roles: ['admin', 'senior'],
  },

  // ───────────────── Үүссэн төслүүд (0254 · «Бүтэц татах») ─────────────────
  // ⚠️ Дээрх «Бэлэн байдал» гурвынхтай ЯГ ижил үнэнч хязгаар: анкор нь
  // төслийн ДЭЛГЭРЭНГҮЙ хуудсын «Мэдээлэл» табын доторх карт бөгөөд тэр
  // зам нь төслийн id шаарддаг — хайлтын мөр түүнийг мэдэхгүй.  Тиймээс
  // хэрэглэгчийг төслийн ЖАГСААЛТ руу аваачна, тэндээс төслөө сонгоно.
  {
    page: '/app/projects',
    to: '/app/projects?section=sec-derived-projects',
    labelKey: 'projectDetail.derivedProjects',
    keywords:
      'үүссэн төсөл эх төсөл засвар бүтэц татах хуулбар derived source project copy structure uussen tosol eh tosol',
    // `GET /api/projects/:id/derived` нь `requireManager()` дор.
    roles: ['admin', 'senior'],
  },

  // ──────────────────────── Нийтийн мэдээлэл ────────────────────────
  // Төрлийн табууд (`?tab=<kind>`, `useTabParam`).
  {
    page: '/app/announcements',
    to: '/app/announcements?tab=system_update',
    labelKey: 'announcements.kind.system_update',
    keywords: 'системийн шинэчлэлт system update шинэ боломж хувилбар release',
  },
  {
    page: '/app/announcements',
    to: '/app/announcements?tab=company_info',
    labelKey: 'announcements.kind.company_info',
    keywords: 'компанийн мэдээлэл company info мэдээ news',
  },
  {
    page: '/app/announcements',
    to: '/app/announcements?tab=announcement',
    labelKey: 'announcements.kind.announcement',
    keywords: 'зарлал announcement notice чухал дотоод',
  },
  // «Удирдлага»-ын «Дотоод журам» таб (`PublicInfoAdminPage`, зөвхөн admin).
  // Өгөгдмөл таб («Мэдээ, зарлал») нь цэсний «Удирдлага» мөр өөрөө.
  {
    page: '/app/admin/announcements',
    to: '/app/admin/announcements?tab=rules',
    labelKey: 'nav.rulesAdmin',
    keywords:
      'дотоод журам удирдах нийтлэх шинэ журам хувилбар гарын үсэг хэн зурсан internal rules manage publish version signatures dotood juram',
    roles: ['admin'],
  },
];

/**
 * i18n шошгоос `{count}` мэтийн орлуулагчийг цэвэрлэнэ.
 *
 * Зарим гарчиг тоог агуулдаг («Өнөөдөр ирсэн ({count})») — хайлтын мөрөнд
 * бид тоог мэдэхгүй тул орлуулагчийг бүхэлд нь, хаалттай нь хамт хасна.
 */
export function cleanSectionLabel(label: string): string {
  return label
    .replace(/\s*[([{]\s*\{[^}]+\}\s*[)\]}]/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
