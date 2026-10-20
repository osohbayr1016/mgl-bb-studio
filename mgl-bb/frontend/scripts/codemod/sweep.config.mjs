/**
 * Автомат шүүрдэлтийн тохиргоо.
 *
 * ⚠ Үл хамаарах жагсаалт нь `frontend/eslint.tokens.config.js`-ийн
 * `globalIgnores`-тэй ИЖИЛ БАЙХ ЁСТОЙ. Нэгийг өөрчилвөл нөгөөг нь бас
 * өөрчил — эс тэгвэл codemod хөндөхгүй файлыг lint загнаж, эсрэгээрээ.
 */
import { fileURLToPath } from 'node:url';

export default {
  /**
   * Бохир файлын жагсаалтыг ГОЛ checkout-аас авна, worktree-ээс БИШ.
   * Worktree нь цэвэр байдаг тул түүний `git status` хоосон гарч,
   * skiplist чимээгүй ажиллахгүй болно — энэ бол занга.
   *
   * ⚠️ Урьд нь энд `C:/Users/US/projects/mgl` гэсэн абсолют зам байсан.
   *    Хэрэглэгчийн нэр нь энэ машиных ч биш (`US` vs `User`) тул зам
   *    ХЭЗЭЭ Ч олдохгүй → `git status` алдаа өгөөд skiplist чимээгүй
   *    хоосон болдог байв, өөрөөр хэлбэл codemod бүх файлыг хөндөж болно
   *    гэсэн үг.  Одоо энэ файлын БАЙРЛАЛААС репогийн үндсийг тооцно
   *    (frontend/scripts/codemod → дөрөв дээш), тиймээс машин, хэрэглэгчийн
   *    нэр, checkout-ийн байрлалаас үл хамаарна.
   *    `MGL_MAIN_REPO_PATH` env-ээр дарж бичиж болно (жинхэнэ worktree-ээс
   *    ажиллуулж байгаа бол гол checkout-ыг заана).
   */
  mainRepoPath:
    process.env.MGL_MAIN_REPO_PATH ??
    fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]+$/, ''),

  /** Эдгээрт өнгө нь мэдээлэл дамжуулдаг эсвэл гадаад орчин шаарддаг. */
  exceptions: [
    // Байгууллагын нэгжийн өнгөний систем — өнгө нь ТАНИХ ТЭМДЭГ
    ['src/shared/lib/team-colors.ts', 'ENTITY 11 багийн accent, dark: хостой'],
    ['src/features/qto/lib/categoryColors.ts', 'ENTITY 16 өнгө, --qto-cat-* токентой'],
    ['src/features/teams/lib/projectColors.ts', 'ENTITY PROJECT_PALETTE + GOLD'],

    // Сэдвээс хамаардаггүй, байнга харанхуй/гэрэл гадаргуу
    ['src/features/dashboard/CompanyTvPage.tsx', 'FORCED_DARK bg-[#070b14] хананы дэлгэц'],
    ['src/features/projects/components/ProjectTeamTasksDialog.tsx', 'FORCED_DARK давхарга'],
    ['src/features/auth/LoginPage.tsx', 'FORCED_DARK Lightfall шилэн гадаргуу'],
    ['src/features/landing/**', 'FORCED_LIGHT html.light + брэндийн гадаргуу'],
    ['src/features/client/ClientDashboardPage.tsx', 'FORCED_LIGHT + өөрийн scope'],

    // Хэвлэх / PDF — A4 геометр, серверийн Chromium, өөрийн CSS
    ['src/features/performance-reports/**', 'PRINT'],
    ['src/features/projects/team-reports/**', 'PRINT'],
    ['src/features/projects/asr/**', 'PRINT'],
    ['src/**/*PrintPage.tsx', 'PRINT'],
    ['src/**/*printStyles*.ts', 'PRINT'],
    ['src/features/quotes/components/sheetStyles.ts', 'PRINT'],
    ['src/features/quotes/components/SheetGrid.tsx', 'PRINT px өргөн → % хэвлэхэд'],
    ['src/features/quotes/components/SheetTabs.tsx', 'PRINT SheetGrid-ийн хамаатан'],

    // Хэрэгслүүд өөрсдөө
    ['scripts/**', 'TOOLING'],
  ],

  /**
   * 4-р үед ГАРААР шинэчлэгдэх дэлгэцүүд. Механик орлуулалт нь хаягдах
   * ажил бөгөөд гараар бичсэн diff-ийг уншихад хэцүү болгоно. Мөн эдгээр
   * нь одоогоор бусад агентын гарт байгаа тул мөргөлдөөн баталгаатай.
   */
  handRedesign: [
    'src/features/dashboard/DashboardPage.tsx',
    'src/features/projects/ProjectDetailPage.tsx',
    'src/features/attendance/AttendancePage.tsx',
    'src/features/attendance/AttendanceAdminPage.tsx',
  ],

  skipHandRedesign: true,
  skipDirty: true,
};
