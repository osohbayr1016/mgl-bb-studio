/**
 * МОДУЛИЙН БҮРТГЭЛ — FRONTEND тал.
 *
 * `backend/src/lib/modules.ts`-ийн ихэр.  Хоёуланг нь ХАМТ өөрчил:
 * `MODULE_IDS` жагсаалт хоёр талд ижил байх ёстой, эс бөгөөс сервер нээсэн
 * модулийг UI нь нуух (эсвэл эсрэгээр) болно.
 *
 * Backend нь `/api` УГТВАРААР хаадаг; энэ файл нь UI-н МӨР (nav / route)
 * -ийг нуудаг.  Хоёулаа хэрэгтэй:
 *   • backend-гүй бол хэрэглэгч URL бичээд орно
 *   • frontend-гүй бол хаагдсан цэс дээр дарж 403 иднэ
 *
 * ⚠️ Хязгаарлалт нь ЗӨВХӨН сервер ил тохируулсан үед үйлчилнэ.  Сервер
 *    `unrestricted: true` буцаавал (эсвэл огт хариу өгөхгүй бол) БҮХ модуль
 *    нээлттэй гэж үзнэ — MGL-ийн ажиллаж байгаа production дээр ямар ч цэс
 *    алга болох ЁСГҮЙ.
 */

export const MODULE_IDS = [
  'core',
  'attendance',
  'leave',
  'projects',
  'progress',
  'meetings',
  'email',
  'assessments',
  'pgp',
  'quotes',
  'qto',
  'revit',
  'aps',
  'asr',
  'reports',
  'ai',
  'pdf',
  'landing',
  'suggestions',
  // ⚠️ MGL AI — `backend/src/lib/modules.ts`-ийн `mglai`-ийн ихэр.
  //    `ai` (Workers AI-ийн бичвэр сайжруулагч) -аас ТУСДАА: тэр нь нэг
  //    endpoint, энэ нь локал инференстэй бүтэн AI давхарга.
  //    ⚠️ Мэдэгдэж буй зөрүү (энэ өөрчлөлтөөс ӨМНӨ ч байсан): backend-д
  //    `learning` модуль бий, энд БАЙХГҮЙ.  Тэр нь BIM-AI-ийн сургалтын
  //    гадаргуу бөгөөд UI-д цэсгүй тул өнөөдөр нөлөөгүй.
  'mglai',
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

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
  mglai: { mn: 'MGL AI', en: 'MGL AI' },
  suggestions: { mn: 'Санал хүсэлт', en: 'Suggestions' },
};

export const ALWAYS_ON: readonly ModuleId[] = ['core'];

/* ------------------------------------------------------------------ */
/*  Идэвхтэй модулиуд — серверээс                                       */
/* ------------------------------------------------------------------ */

/** `GET /api/settings/modules` -ийн хариу. */
export interface ModulesDto {
  unrestricted?: boolean;
  enabled?: string[];
}

const STORAGE_KEY = 'org:modules';

/** `null` = хязгаарлалтгүй (бүх модуль нээлттэй). */
let active: ReadonlySet<ModuleId> | null = readCache();

function parseList(list: unknown): ReadonlySet<ModuleId> | null {
  if (!Array.isArray(list)) return null;
  const out = new Set<ModuleId>(ALWAYS_ON);
  for (const v of list) {
    if (typeof v === 'string' && (MODULE_IDS as readonly string[]).includes(v)) {
      out.add(v as ModuleId);
    }
  }
  return out;
}

function readCache(): ReadonlySet<ModuleId> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const dto = JSON.parse(raw) as ModulesDto;
    if (dto.unrestricted !== false) return null;
    return parseList(dto.enabled);
  } catch {
    // Эвдэрсэн cache нь цэсийг нуух ЁСГҮЙ — хязгаарлалтгүй рүү унана.
    return null;
  }
}

/** Тухайн модуль нээлттэй эсэх.  Хязгаарлалтгүй үед үргэлж `true`. */
export function moduleEnabled(id: ModuleId): boolean {
  return active === null || active.has(id);
}

/** Идэвхтэй модулиудын багц, эсвэл `null` (хязгаарлалтгүй). */
export function enabledModules(): ReadonlySet<ModuleId> | null {
  return active;
}

/** Серверийн хариуг тусгаж, дараагийн эхний зурагтад зориулж хадгална. */
export function applyModules(dto: ModulesDto): void {
  active = dto.unrestricted === false ? parseList(dto.enabled) : null;
  try {
    localStorage?.setItem(STORAGE_KEY, JSON.stringify(dto));
  } catch {
    /* хувийн горим — cache-гүйгээр ажиллана */
  }
  for (const fn of listeners) fn();
}

/** Тестэд болон гараас гарахад. */
export function resetModules(): void {
  active = null;
  try {
    localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* үл тоомсорлоно */
  }
  for (const fn of listeners) fn();
}

/* ------------------------------------------------------------------ */
/*  React-д захиалах                                                    */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

export function subscribeModules(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `useSyncExternalStore`-ийн snapshot.  Тогтвортой лавлагаа буцаах ёстой
 *  тул багцыг шууд өгнө (`applyModules` шинэ багц үүсгэдэг). */
export function getModulesSnapshot(): ReadonlySet<ModuleId> | null {
  return active;
}
