import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * ДИЗАЙН ТОКЕНЫ ХАМГААЛАЛТ — үндсэн `eslint.config.js`-ээс ТУСДАА.
 *
 * Яагаад тусдаа вэ: үндсэн lint нь baseline дээр 139 алдаатай (react-hooks
 * дүрмүүд). Эдгээр дүрмийг тийш нэмбэл шинэ зөрчил тэр дунд живж, хэн ч
 * анзаарахгүй. Тусад нь `npm run lint:tokens` гэж ажиллуулбал энэ нь
 * бие даан цэвэр эсэх нь харагдана.
 *
 *   npm run lint:tokens
 *
 * Одоогийн байдал (Phase 2 төгсгөл): 1,358 зөрчил / 104 файл. Энэ нь
 * Phase 3-ын автомат шүүрдэлтийн ЯГ ажлын жагсаалт. Шүүрдэлтийн дараа
 * энэ нь тэг рүү ойртож, эндээс хойш регрессийн хаалт болно.
 *
 * Мэдэгдэж буй нэг гадны алдаа: `MeetingDetailPage.tsx:537` дэх
 * `eslint-disable-next-line jsx-a11y/media-has-caption` — тэр plugin нь
 * repo-д ОГТ суугаагүй тул үндсэн lint-д ч мөн адил алддаг. Өөр агентын
 * гарт байгаа файл тул энд хөндөөгүй.
 *
 * Гурван дүрэм:
 *  1. Түүхий Tailwind палитр класс (`bg-emerald-500`) — семантик токен
 *     хэрэглэнэ (`bg-success`). Эс тэгвэл гэрэл/харанхуй горим салж,
 *     контрастын баталгаа алдагдана.
 *  2. Түүхий `<button className=…>` — `@/ui/button`-ы `<Button>`. Түүхий
 *     товч нь `pointer-coarse:` хүрэлтийн талбай, фокусын цагираг,
 *     `data-variant` зэргийг алгасдаг.
 *  3. `text-[14px]` мэт шууд хэмжээ — `index.css`-ийн типографийн шатлал
 *     (`text-body`, `text-micro`, `text-label`, …).
 */

/** Палитрын гэр бүлүүд — семантик токен рүү зураглагдах ёстой. */
const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const PROPS =
  'bg|text|border|ring|from|to|via|fill|stroke|divide|shadow|accent|outline|decoration|caret|placeholder';
const SHADES = '50|100|200|300|400|500|600|700|800|900|950';

/**
 * `hover:`, `dark:`, `md:`, `group-hover:`, `data-[state=open]:` …
 *
 * ⚠ ESCAPE: эдгээр мөр нь esquery-ийн `[value=/…/]` селектор дотор ОРНО.
 * JS эх кодод `\\b` гэж бичвэл мөрөнд `\b` орох бөгөөд esquery түүнийг
 * regex гэж уншина. `\\\\b` гэж бичих нь `\\b` болж БУРУУ — анх ингэж
 * бичээд дүрэм чимээгүй 0 таарц өгсөн (эмпирикээр илрүүлсэн).
 */
const VARIANT = '(?:[a-z0-9-]+:|data-\\[[^\\]]*\\]:|\\[&[^\\]]*\\]:)*';

const PALETTE_RE = `${VARIANT}(?:${PROPS})-(?:${PALETTE})-(?:${SHADES})\\b`;
const ARBITRARY_TEXT_RE = 'text-\\[[0-9.]+(?:px|rem)\\]';

const paletteMessage =
  'Түүхий Tailwind палитр класс. Семантик токен хэрэглэнэ: bg-success / text-warning / ' +
  'text-danger / text-info / text-foreground / text-muted-foreground / border-border. ' +
  'Өнгө нь ЖИНХЭНЭ таних тэмдэг (баг, ангилал) бол sweep.config.mjs-ийн ' +
  'үл хамаарах жагсаалтад шалтгаантай нь нэм.';

const typeMessage =
  'Шууд бичсэн үсгийн хэмжээ. Типографийн шатлалыг хэрэглэнэ: text-title / text-metric / ' +
  'text-section / text-body / text-micro / text-label (index.css-ийн @theme).';

const buttonMessage =
  'Түүхий <button className>. @/ui/button-ийн <Button> хэрэглэнэ — тэр нь pointer-coarse ' +
  'хүрэлтийн талбай (44px), фокусын цагираг, variant/size-ийг авчирна. Хэрэв энэ нь ' +
  'dnd-kit бариул эсвэл контролын дотоод хэсэг бол мөрд eslint-disable + шалтгаан бич.';

const restricted = [
  { selector: `Literal[value=/${PALETTE_RE}/]`, message: paletteMessage },
  { selector: `TemplateElement[value.raw=/${PALETTE_RE}/]`, message: paletteMessage },
  { selector: `Literal[value=/${ARBITRARY_TEXT_RE}/]`, message: typeMessage },
  { selector: `TemplateElement[value.raw=/${ARBITRARY_TEXT_RE}/]`, message: typeMessage },
  {
    selector: 'JSXOpeningElement[name.name="button"] > JSXAttribute[name.name="className"]',
    message: buttonMessage,
  },
];

export default defineConfig([
  globalIgnores([
    'dist',
    'scripts/**',
    'node_modules/**',
    'eslint.config.js',
    'eslint.tokens.config.js',
    'vite.config.ts',

    /* ── ЗОРИУДЫН ҮЛ ХАМААРАХ ФАЙЛУУД ──
     * Эдгээрт өнгө нь ТАНИХ ТЭМДЭГ эсвэл гадаад орчны шаардлага бөгөөд
     * семантик статус токен рүү шахах нь мэдээллийг устгана. Жагсаалт нь
     * `scripts/codemod/sweep.config.mjs`-тэй ЗААВАЛ ижил байх ёстой —
     * нэгийг өөрчилвөл нөгөөг нь бас өөрчил. */

    // Байгууллагын нэгжийн өнгөний систем (баг, ангилал, төсөл)
    'src/shared/lib/team-colors.ts',
    'src/features/qto/lib/categoryColors.ts',
    'src/features/teams/lib/projectColors.ts',

    // Байнгын харанхуй / гэрэл гадаргуу — сэдвээс хамаардаггүй
    'src/features/dashboard/CompanyTvPage.tsx',
    'src/features/projects/components/ProjectTeamTasksDialog.tsx',
    'src/features/auth/LoginPage.tsx',
    'src/features/landing/**',
    'src/features/client/ClientDashboardPage.tsx',

    // Хэвлэх / PDF — A4 геометр, серверийн Chromium, өөрийн CSS
    'src/features/performance-reports/**',
    'src/features/projects/team-reports/**',
    'src/features/projects/asr/**',
    'src/**/*PrintPage.tsx',
    'src/**/*printStyles*.ts',
    'src/features/quotes/components/sheetStyles.ts',
    'src/features/quotes/components/SheetGrid.tsx',
    'src/features/quotes/components/SheetTabs.tsx',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    linterOptions: {
      /* Кодод байгаа disable мөрүүд нь ҮНДСЭН config-ийн дүрмүүдэд
         зориулагдсан. Энэ нарийн config тэдгээр дүрмийг асаадаггүй тул
         бүгд «unused» болж, жинхэнэ токены зөрчлийг дүлийрүүлнэ. */
      reportUnusedDisableDirectives: 'off',
    },
    /* Plugin-уудыг зөвхөн БҮРТГЭНЭ, дүрмийг нь асаахгүй. Кодод байгаа
       `eslint-disable-next-line react-hooks/…` мэт мөрүүд эдгээргүйгээр
       «Definition for rule … was not found» алдаа өгч, жинхэнэ зөрчлийг
       далдална. */
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: { 'no-restricted-syntax': ['error', ...restricted] },
  },
  {
    // Примитивүүд нь тодорхойлолтоороо түүхий элемент ашиглана —
    // `<Button>` өөрөө `<button>`-оос бүтэх ёстой.
    files: ['src/ui/**'],
    rules: { 'no-restricted-syntax': ['error', ...restricted.slice(0, 4)] },
  },
]);
