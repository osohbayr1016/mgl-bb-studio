import { useAuth } from '@/shared/context/AuthContext';

/**
 * `worker` — цэвэрлэгч / туслах ажилтны role.
 *
 * Тэрээр систем дотор ЗӨВХӨН нэг зүйл хийнэ: ирцээ бүртгэх (+ чөлөө / илүү
 * цагийн хүсэлт).  Хянах самбар, Төслүүд, Багууд, Бүтээмжийн самбар зэрэг
 * бүх ажлын хэсэг түүнд харагдахгүй бөгөөд URL-аар ч орох боломжгүй
 * (`ProtectedRoute` буцаана, сервер тал нь `lib/workerScope.ts`-ээр 403
 * өгнө — жинхэнэ хаалт нь сервер талд).
 *
 * Түүний нэвтэрсний дараах "гэр" хуудас = /app/attendance.
 */
export const WORKER_HOME = '/app/attendance';

/**
 * Role → i18n түлхүүр (`role_admin` … `role_worker`, mn.json-ы ГЛОБАЛ түлхүүрүүд).
 *
 * Урьд нь role-ийн шошго ДОЛООН файлд тус тусдаа map-аар давтагдаж, гурав нь
 * («Admin», «Engineer»…) огт орчуулгагүй англи хатуу бичвэр байсан тул монгол
 * UI дээр role нь англиар харагддаг байв.  Одоо бүх газар энэ helper-ээр:
 * танигдахгүй role (`null`, хоосон, ирээдүйн шинэ утга) → түлхүүр биш, түүхий
 * утгыг өөрийг нь буцаана — `t()` олдохгүй түлхүүрийг өөрөөр нь харуулдаг
 * тул хэрэглэгч хоосон биш, ядаж role-ийн кодыг харна.
 *
 * ⚠️ Шинэ role нэмэхэд `role_<role>` түлхүүрийг mn.json + en.json-д нэм —
 * эс тэгвэл энд буцаж ирсэн түлхүүр өөрөө дэлгэцэнд гарна.
 *
 * Бүтээмжийн самбар (`LeaderboardPage`) ЗОРИУД өөрийн map-тай: тэнд `admin`
 * = «Гүйцэтгэх захирал» (CEO hardcode) тул энэ helper-ийг хэрэглэдэггүй.
 */
const ROLE_LABEL_KEYS: Readonly<Record<string, string>> = {
  admin: 'role_admin',
  senior: 'role_senior',
  engineer: 'role_engineer',
  architect: 'role_architect',
  client: 'role_client',
  worker: 'role_worker',
};

export function roleLabelKey(role: string | null | undefined): string {
  if (!role) return '';
  return ROLE_LABEL_KEYS[role] ?? role;
}

/** Worker-т нээлттэй цорын ганц замууд (ба тэдгээрийн дэд замууд).
 *  `/app/settings` энд БАЙХГҮЙ нь санаатай — тэр хуудас брэнд/амралтын өдрийн
 *  админ картуудаас бүрддэг бөгөөд түүний API-ууд worker-т хаалттай.  Хэл /
 *  өнгөний товчнууд Layout-ийн sidebar-т байгаа. */
const WORKER_ALLOWED_PATHS = ['/app/attendance', '/app/notifications', '/app/profile'] as const;

/** Дээрх зөвшөөрлийн дотор сууж байгаа ч ХААЛТТАЙ дэд замууд.
 *  `/app/attendance/admin` нь `/app/attendance`-ийн дэд зам мөртлөө админы
 *  ирцийн самбар тул тусад нь хасна. */
const WORKER_DENIED_PATHS = ['/app/attendance/admin'] as const;

export function isWorkerRole(role: string | null | undefined): boolean {
  return role === 'worker';
}

/**
 * Ур чадварын үнэлгээнд ОРОЛЦОГЧ (үнэлүүлэгч) болох role-ууд.
 *
 * ⚠️ ТВИН: `backend/src/lib/assessmentRoster.ts` → `PARTICIPANT_ROLES`
 *          `frontend/src/features/assessments/admin/editor/PublishDialog.tsx`
 *          → `CREATE_ROLES`.  Гурвуулаа хамт хөдөлнө.
 *
 * `admin` 2026-08-19-д ХАСАГДСАН (эзний шийдвэр): админ бол үнэлгээг ЗОХИОН
 * БАЙГУУЛАГЧ, оролцогч биш.  Сервер тал ч түүнийг хамрах хүрээнд оруулахаа
 * больсон тул админд бөглөх маягт байхгүй — профайлын таб хоосон гарахаас
 * илүүтэй огт харагдахгүй байх нь зөв.  (Админ бусдын үр дүнг
 * `/app/admin/assessments`-ээс хэвээр хардаг — энэ гэйт түүнд хамаарахгүй.)
 */
const ASSESSMENT_ROLES = new Set(['engineer', 'architect', 'senior']);

export function canTakeAssessments(role: string | null | undefined): boolean {
  return !!role && ASSESSMENT_ROLES.has(role);
}

/**
 * Дотоод журам уншиж, гарын үсгээр баталгаажуулах role-ууд.
 *
 * ⚠️ ТВИН: `backend/src/lib/internalRules.ts` → `RULE_ROSTER_ROLES` (сервер
 *          `canReadRules` + админы «хэн зурсан» roster-ийн популяци).
 * `worker` — `lib/workerScope.ts` энэ route-ыг түүнд нээдэггүй; `client` — гадны хүн.
 */
const RULE_ROLES = new Set(['admin', 'senior', 'engineer', 'architect']);

export function canReadRules(role: string | null | undefined): boolean {
  return !!role && RULE_ROLES.has(role);
}

/**
 * Нийтийн мэдээлэл (системийн шинэчлэлт, компанийн мэдээлэл, зарлал) уншиж,
 * баталгаажуулах role-ууд — хүрээний популяцийн дээд хязгаар.
 *
 * ⚠️ ТВИН: `backend/src/lib/announcements.ts` → `ANNOUNCEMENT_ROLES`.
 * `worker` — `lib/workerScope.ts` энэ route-ыг түүнд нээдэггүй; `client` — гадны хүн.
 * Мэдээлэл бүрд хүрээг ЭНЭ багцаас нарийсгаж (role × баг) сонгоно.
 */
export const ANNOUNCEMENT_ROLES = ['admin', 'senior', 'engineer', 'architect'] as const;

export function canReadAnnouncements(role: string | null | undefined): boolean {
  return !!role && (ANNOUNCEMENT_ROLES as readonly string[]).includes(role);
}

/** Нэвтэрсэн хэрэглэгч цэвэрлэгч эсэх. */
export function useIsWorker(): boolean {
  const { user } = useAuth();
  return isWorkerRole(user?.role);
}

const matchesPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Тухайн зам worker-т нээлттэй эсэх (сегментийн хилээр таарна). */
export function isWorkerAllowedPath(pathname: string): boolean {
  if (WORKER_DENIED_PATHS.some((p) => matchesPrefix(pathname, p))) return false;
  return WORKER_ALLOWED_PATHS.some((p) => matchesPrefix(pathname, p));
}
