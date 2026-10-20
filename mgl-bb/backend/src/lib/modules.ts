/**
 * МОДУЛИЙН БҮРТГЭЛ — компани тус бүр ЮУГ худалдаж авсныг тодорхойлно.
 *
 * ЯАГААД:  Нэг кодын сан, олон компани.  Компани A «Үнийн санал»-гүй,
 * компани B «Тоо хэмжээ»-гүй байж болно.  Код нь ИЖИЛ хувилбар — зөвхөн
 * лиценз нь өөр.  Ингэснээр код хуулбарлахгүйгээр компани бүр өөр
 * бүтээгдэхүүн харна.
 *
 * ЗАГВАР:  Энэ нь `lib/workerScope.ts`-ийн (worker role-ийн цагаан жагсаалт)
 * ДӨРӨВ ДЭХ тохиолдол — шинэ зохион бүтээлт биш.  Тэндхийн нэгэн адил:
 *   • цагаан жагсаалт биш, БҮРЭН зураглал → шинэ route нэмэхэд ЗААВАЛ
 *     модуль сонгоно (`Record<ApiPrefix, ModuleId>` тул compile унана)
 *   • сегментийн хилээр таарна (`/api/leaves` нь `/api/leaves-x`-ийг авахгүй)
 *
 * ⚠️ ЭНЭ ФАЙЛ ЛИЦЕНЗИЙН ХИЛ.  Шинэ модуль нэмэх, эсвэл route-ын модулийг
 *    солих нь худалдааны шийдвэр — код цэвэрлэгээ БИШ.
 */

/* ------------------------------------------------------------------ */
/*  Модулиуд                                                           */
/* ------------------------------------------------------------------ */

/**
 * `core` нь ХЭЗЭЭ Ч унтрахгүй — нэвтрэлт, хэрэглэгч, мэдэгдэл, тохиргоо
 * зэрэг нь байхгүй бол систем огт ажиллахгүй.
 */
export const MODULE_IDS = [
  'core',
  'attendance', // Ирц
  'leave', // Чөлөө · чөлөөт цаг
  'projects', // Төсөл · блок · зураг · даалгавар · баримт
  'progress', // Явцын бүртгэл · засвар · бүтээмжийн самбар
  'meetings', // Хурал · календарь · STT
  'email', // Gmail синк · захидлын бүртгэл
  'assessments', // Ур чадвар · зан чанарын үнэлгээ
  'pgp', // Хувь хүний хөгжлийн төлөвлөгөө
  'quotes', // Үнийн санал (БД 81-16-20)
  'qto', // Тоо хэмжээ · норм · багийн зургийн зүйл
  'revit', // Revit нэмэлт татах хуудас
  'aps', // Autodesk 3D үзэгч
  'asr', // Зохиогчийн хяналт
  'reports', // Тайлангийн загвар
  'ai', // Монгол бичвэр сайжруулах г.м.
  'pdf', // Stirling PDF хэрэгслүүд
  'landing', // Нийтийн маркетинг хуудас + CMS
  'suggestions', // Санал хүсэлт
  // ⚠️ BIM-AI сургалтын өгөгдөл нь ТУСДАА модуль, `progress`-ийн хэсэг БИШ.
  //    Ажилтны зан төлөвийн бүртгэл нь тусад нь зөвшилцөх, тусад нь
  //    үнэлэх ЧАДВАР — «явцын хяналт» худалдаж авсан үйлчлүүлэгч түүнийг
  //    нэмэлт худалдан авалтгүйгээр ЧИМЭЭГҮЙ авах ЁСГҮЙ.
  'learning', // BIM-AI сургалтын өгөгдөл — үйл явдлын түүх, артефакт
  // ⚠️ MGL AI нь `ai`-аас ТУСДАА модуль.  `ai` бол Workers AI-ийн монгол
  //    бичвэр сайжруулагч (нэг endpoint); `mglai` бол локал инференстэй
  //    бүтэн AI давхарга — тусдаа үнэлэгдэж, тусдаа зарагдана.
  'mglai', // MGL AI — чат, ERP хэрэгсэл, норм хайлт, санал хүсэлт
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

/** Хэрэглэгчид үзүүлэх нэр — админы «Модулиуд» хуудсанд. */
export const MODULE_LABELS: Record<ModuleId, { mn: string; en: string }> = {
  core: { mn: 'Үндсэн', en: 'Core' },
  attendance: { mn: 'Ирц', en: 'Attendance' },
  leave: { mn: 'Чөлөө', en: 'Leave' },
  projects: { mn: 'Төслийн удирдлага', en: 'Projects' },
  progress: { mn: 'Явц ба бүтээмж', en: 'Progress & leaderboard' },
  meetings: { mn: 'Хурал', en: 'Meetings' },
  email: { mn: 'Мэйл ба захидал', en: 'Email & correspondence' },
  assessments: { mn: 'Үнэлгээ', en: 'Assessments' },
  pgp: { mn: 'Хөгжлийн төлөвлөгөө', en: 'Growth plans' },
  quotes: { mn: 'Үнийн санал', en: 'Price quotes' },
  qto: { mn: 'Тоо хэмжээ', en: 'Quantity take-off' },
  revit: { mn: 'Revit нэмэлт', en: 'Revit add-in' },
  aps: { mn: '3D үзэгч', en: '3D viewer' },
  asr: { mn: 'Зохиогчийн хяналт', en: 'Author supervision' },
  reports: { mn: 'Тайлан', en: 'Reports' },
  ai: { mn: 'AI туслах', en: 'AI assistant' },
  pdf: { mn: 'PDF хэрэгсэл', en: 'PDF tools' },
  landing: { mn: 'Нийтийн сайт', en: 'Public site' },
  suggestions: { mn: 'Санал хүсэлт', en: 'Suggestions' },
  learning: { mn: 'Сургалтын өгөгдөл (BIM-AI)', en: 'BIM-AI learning data' },
  mglai: { mn: 'MGL AI', en: 'MGL AI' },
};

/** Унтраах БОЛОМЖГҮЙ модулиуд. */
export const ALWAYS_ON: readonly ModuleId[] = ['core'];

/* ------------------------------------------------------------------ */
/*  Угтвар → модуль                                                    */
/* ------------------------------------------------------------------ */

/**
 * `backend/src/index.ts`-д mount хийгдсэн БҮХ `/api` угтвар.
 *
 * ⚠️ Энэ жагсаалт `index.ts`-ийн `app.route(...)` дуудлагуудтай ЯГ таарах
 *    ёстой.  `test/modules.test.ts` нь `index.ts`-ийг уншиж тулгадаг тул
 *    шинэ route нэмээд энд нэмэхээ мартвал ТЕСТ УНАНА.
 *
 * ⚠️ `/api/projects` дээр ТАВАН router mount хийгдсэн (projects,
 *    performanceReports, projectCharts, teamFormTemplates, projectDrive).  Тиймээс
 *    `projects` модулийг унтраавал тэр тавуулаа унтарна — тайлан/график-ийг
 *    тусад нь зарах бол зам түвшний дүрэм нэмэх шаардлагатай.
 */
export const API_PREFIXES = [
  '/api/ai',
  '/api/announcements',
  '/api/aps',
  '/api/assessments',
  '/api/attendance',
  '/api/attendance-confirmations',
  '/api/auth',
  '/api/author-supervision',
  '/api/blocks',
  '/api/calendar',
  '/api/client',
  '/api/client-admin',
  '/api/client-files',
  '/api/company',
  '/api/compliance',
  '/api/components',
  '/api/correspondence',
  '/api/daily-work-logs',
  '/api/dashboard',
  '/api/deadlines',
  '/api/dev/d1-probe',
  '/api/documents',
  '/api/drawings',
  '/api/drive-signing',
  '/api/signing-links',
  '/api/email',
  '/api/engineering-feedback',
  '/api/handbook',
  '/api/holidays',
  '/api/internal-rules',
  '/api/landing',
  '/api/landing/v2',
  '/api/leaderboard',
  '/api/learning',
  '/api/leaves',
  '/api/main-projects',
  '/api/media',
  '/api/meetings',
  '/api/mgl-ai',
  '/api/non-project-work',
  '/api/norm-catalog',
  '/api/notifications',
  '/api/office-ips',
  '/api/out-of-office',
  '/api/pdf-tools',
  '/api/pgp',
  '/api/profiles',
  '/api/progress',
  '/api/project-chat',
  '/api/projects',
  '/api/push',
  '/api/qto',
  '/api/quotes',
  '/api/repair',
  '/api/report-templates',
  '/api/reports',
  '/api/revit',
  '/api/revit-addin',
  '/api/search',
  '/api/settings',
  '/api/speedtest',
  '/api/status-starters',
  '/api/storage',
  '/api/suggestions',
  '/api/task-timer',
  '/api/tasks',
  '/api/team-drawing-items',
  '/api/teams',
  '/api/ticker',
  '/api/timeline',
  '/api/upload',
  '/api/users',
] as const;

export type ApiPrefix = (typeof API_PREFIXES)[number];

/**
 * Угтвар бүр ЯГ НЭГ модульд харьяалагдана.
 *
 * `Record<ApiPrefix, ModuleId>` учраас:
 *   • шинэ угтвар нэмээд энд нэмэхгүй бол   → compile алдаа
 *   • энд байгаа боловч mount хийгээгүй бол → тестийн алдаа
 * Энэ бол `webPush.ts`-ийн `CATEGORY_OF`-той яг ижил заль.
 */
export const MODULE_OF: Record<ApiPrefix, ModuleId> = {
  /* ---- Үндсэн: хэзээ ч унтрахгүй ---- */
  '/api/auth': 'core',
  '/api/users': 'core',
  '/api/profiles': 'core',
  // Өдрийн ажлын тайлан (0345) — Профайлын хэсэг, модульгүйгээр үргэлж асаалттай.
  '/api/daily-work-logs': 'core',
  '/api/teams': 'core',
  '/api/notifications': 'core',
  '/api/push': 'core',
  '/api/upload': 'core',
  '/api/media': 'core',
  '/api/settings': 'core',
  // Аудит/оношилгооны хэрэгсэл — үргэлж асаалттай core (admin-only; /storage/purge л устгана).
  '/api/dev/d1-probe': 'core',
  '/api/storage': 'core',
  '/api/dashboard': 'core',
  '/api/holidays': 'core',
  '/api/handbook': 'core',
  // Дотоод журам + гарын үсгийн баталгаа — HR-ийн үндсэн хэрэгцээ, лицензгүй.
  '/api/internal-rules': 'core',
  // Нийтийн мэдээлэл (0338) — системийн шинэчлэлт/компанийн мэдээлэл/зарлал;
  // үндсэн харилцааны суваг тул унтраах боломжгүй.
  '/api/announcements': 'core',
  '/api/speedtest': 'core',
  // Компанийн ерөнхий тойм — дашбоардын нэг хэсэг.
  '/api/company': 'core',
  // Нэгдсэн хайлт — апп-ын үндсэн навигаци, унтраах боломжгүй.  Хэдийгээр
  // үр дүн нь төсөл/тайлан/хурал/тоо хэмжээг ХАМАРДАГ ч, бүлэг тус бүр нь
  // `routes/search.ts` дотор ДҮРЭЭР хаагддаг тул `projects` эсвэл `qto`
  // модульд хамааруулбал хайлтын хайрцаг өөрөө унтарч, хэрэглэгч
  // навигацигүй үлдэнэ.
  '/api/search': 'core',
  // Програмын хүсэлт (2026-10-16) — алдаа/сайжруулалтын суваг, үргэлж асаалттай (progress-only эсвэл add-in-ий
  // tenant-д ч алдаагаа илгээж чаддаг байх ёстой).  Inbox-ийн эрх нь модуль биш, capability (lib/engineeringFeedbackAccess.ts).
  '/api/engineering-feedback': 'core',

  /* ---- Ирц ---- */
  '/api/attendance': 'attendance',
  '/api/attendance-confirmations': 'attendance',
  // Оффисын IP цагаан жагсаалт нь ЗӨВХӨН ирцэд хэрэглэгддэг.
  '/api/office-ips': 'attendance',
  // Төслийн бус ажил (0342) — ирцийн цонхноос бүртгэгддэг, ирцийн «дор хаяж
  // нэг төсөл» дүрмийг хангадаг тул ирцгүй tenant-д утгагүй.
  '/api/non-project-work': 'attendance',

  /* ---- Чөлөө ---- */
  '/api/leaves': 'leave',
  '/api/out-of-office': 'leave',

  /* ---- Төсөл ---- */
  '/api/projects': 'projects',
  /* Үндсэн төсөл (0281) — ангиллын төслүүдийн эцэг, баримт бичгийн Drive хавтас. */
  '/api/main-projects': 'projects',
  /* Word баримтын гарын үсэг — «Баримт бичиг»-ийн хэсэг (0371). */
  '/api/drive-signing': 'projects',
  '/api/signing-links': 'projects',
  '/api/blocks': 'projects',
  '/api/drawings': 'projects',
  '/api/components': 'projects',
  '/api/tasks': 'projects',
  '/api/documents': 'projects',
  '/api/project-chat': 'projects',
  /* Захиалагчийн портал — төслийн ХАРАГДАЦ тул `projects` модульд.
     Тусад нь зардаг болгох бол энэ гурван мөрийг шинэ ModuleId рүү
     шилжүүлэхэд хангалттай. */
  '/api/client': 'projects',
  '/api/client-admin': 'projects',
  '/api/client-files': 'projects',
  '/api/deadlines': 'projects',
  '/api/timeline': 'projects',

  /* ---- Явц ба бүтээмж ---- */
  '/api/progress': 'progress',
  '/api/task-timer': 'progress',
  '/api/repair': 'progress',
  '/api/leaderboard': 'progress',
  '/api/ticker': 'progress',
  '/api/status-starters': 'progress',

  /* ---- Хурал ---- */
  '/api/meetings': 'meetings',
  '/api/calendar': 'meetings',

  /* ---- Мэйл ---- */
  '/api/email': 'email',
  '/api/correspondence': 'email',

  /* ---- Бусад бие даасан модулиуд ---- */
  '/api/assessments': 'assessments',
  '/api/pgp': 'pgp',
  '/api/quotes': 'quotes',
  '/api/qto': 'qto',
  '/api/norm-catalog': 'qto',
  '/api/team-drawing-items': 'qto',
  // Revit-ээс явц илгээх гарц нь `progress` модулийн нэг хэсэг — Revit
  // нэмэлт татах хуудастай (`revit`) ХАМААРАЛГҮЙ.  Progress модулийг
  // унтраасан tenant-д Revit push мөн унтарна, энэ нь зөв.
  '/api/revit': 'progress',
  '/api/revit-addin': 'revit',
  '/api/aps': 'aps',
  '/api/author-supervision': 'asr',
  '/api/report-templates': 'reports',
  '/api/reports': 'reports',
  '/api/ai': 'ai',
  '/api/pdf-tools': 'pdf',
  '/api/landing': 'landing',
  '/api/landing/v2': 'landing',
  '/api/suggestions': 'suggestions',

  /* ---- BIM-AI сургалтын өгөгдөл ---- */
  // ⚠️ `progress` БИШ.  `/api/revit` (явц илгээх гарц) нь `progress`-т
  //    харьяалагддаг ч энэ нь ӨӨР чадвар: ажилтны Revit дэх ажлын
  //    дараалалт бүртгэл.  Тусдаа модуль нь түүнийг унтраалгатай,
  //    гэрээгээр асаадаг, ярианы сэдэв болгодог.
  '/api/learning': 'learning',
  // Нийцлийн дүрмийн загвар (0220–0223) нь ИЖИЛ модульд: дүрмийн багц ба
  // сургалтын өгөгдөл нэг чадвар — tenant нэгийг нь асаагаад нөгөөг нь
  // унтраах нь утгагүй (дүрэмгүй бол дүгнэлт бичигдэхгүй).
  '/api/compliance': 'learning',

  /* ---- MGL AI ---- */
  // ⚠️ `/api/ai` (Workers AI-ийн бичвэр сайжруулагч) нь `ai` модульд үлдэнэ.
  //    Хоёрыг нэгтгэх нь MGL AI-г худалдаж аваагүй байгууллагад чатын
  //    гадаргууг ЧИМЭЭГҮЙ нээнэ.
  '/api/mgl-ai': 'mglai',
};

/* ------------------------------------------------------------------ */
/*  Замаас модуль тодорхойлох                                          */
/* ------------------------------------------------------------------ */

/**
 * Угтваруудыг УРТААС нь богино руу эрэмбэлсэн жагсаалт.
 * `/api/landing/v2` нь `/api/landing`-аас ӨМНӨ шалгагдах ёстой, эс бөгөөс
 * илүү ерөнхий угтвар нь тусгайлсныг нь дарна.  (Одоо хоёулаа `landing`
 * модульд байгаа тул үр дүн ижил, гэхдээ ирээдүйд салгах бол энэ дараалал
 * ачаалал үүрнэ.)
 */
const PREFIXES_LONGEST_FIRST: readonly ApiPrefix[] = [...API_PREFIXES].sort(
  (a, b) => b.length - a.length,
);

/**
 * Замд харгалзах модуль, эсвэл `null` (танихгүй `/api` зам).
 *
 * Таарц нь СЕГМЕНТИЙН ХИЛЭЭР явна — `workerScope.ts`-ийн `isAllowedForWorker`
 * -тэй яг ижил дүрэм.  `/api/leaves` нь `/api/leaves-archive`-ийг таних ЁСГҮЙ.
 */
export function moduleOfPath(path: string): ModuleId | null {
  for (const p of PREFIXES_LONGEST_FIRST) {
    if (path === p || path.startsWith(`${p}/`)) return MODULE_OF[p];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Идэвхтэй модулиуд                                                  */
/* ------------------------------------------------------------------ */

/**
 * Тухайн deployment дээр идэвхтэй модулиуд.
 *
 * `ENABLED_MODULES` env (таслалаар тусгаарласан) эсвэл `app_settings`-ийн
 * `modules.enabled`.  ХООСОН эсвэл тохируулаагүй бол → БҮГД ИДЭВХТЭЙ.
 *
 * ⚠️ «Тохируулаагүй бол бүгд» гэдэг нь ЗОРИУДААР: MGL-ийн одоо ажиллаж
 *    байгаа production дээр энэ давхаргыг нэвтрүүлэхэд ямар ч функц
 *    алга болох ЁСГҮЙ.  Хязгаарлалт нь ЗӨВХӨН ил тохируулсан үед үйлчилнэ.
 */
export function parseModules(raw: unknown): ReadonlySet<ModuleId> | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.length === 0) return null; // хоосон = хязгаарлалтгүй
  const out = new Set<ModuleId>(ALWAYS_ON);
  for (const part of t.split(',')) {
    const v = part.trim();
    if (v.length === 0) continue;
    if ((MODULE_IDS as readonly string[]).includes(v)) out.add(v as ModuleId);
  }
  return out;
}

/** Бүх модуль идэвхтэй байх багц (хязгаарлалтгүй үеийн утга). */
export function allModules(): ReadonlySet<ModuleId> {
  return new Set(MODULE_IDS);
}
