import { createMiddleware } from 'hono/factory';
import { isWorkerRole } from '../types';
import type { Env, AppVariables } from '../types';

/**
 * `worker` (цэвэрлэгч / туслах ажилтан) role-ийн API хамрах хүрээ.
 *
 * Worker нь ЗӨВХӨН өөрийн ирцээ бүртгэдэг — төслийн өгөгдөл, баг, бүтээмжийн
 * самбар, тайлан, хэрэглэгчийн жагсаалт гэх мэт юунд ч хандахгүй.  Frontend
 * талд nav-ыг нуусан ч (`shared/lib/roles.ts`), URL/fetch-ээр тойрч гарахаас
 * сэргийлж СЕРВЕР талд ч хаана — энэ бол жинхэнэ хаалт.
 *
 * `client`-ийг төслийн гишүүнчлэлээр шүүдэг загвараас ялгаатай нь worker-ийг
 * ЦАГААН ЖАГСААЛТААР (allowlist) хязгаарлана: шинэ route нэмэгдэхэд worker-т
 * "санамсаргүй" нээгдэхгүй байхын тулд.  Шинэ гарц нээх шаардлагатай бол
 * доорх жагсаалтад ЗОРИУДААР нэмнэ.
 */
const WORKER_ALLOWED_PREFIXES = [
  /* нэвтрэлт, өөрийн профайл, нууц үг солих */
  '/api/auth',
  /* ирц: clock-in/out, миний session-ууд, миний өдрийн грид */
  '/api/attendance',
  /* админ ирцээ баталгаажуулах хүсэлт илгээвэл хариулах */
  '/api/attendance-confirmations',
  /* чөлөөний хүсэлт */
  '/api/leaves',
  /* мэдэгдэл (ирц засагдсан, чөлөө батлагдсан г.м.) */
  '/api/notifications',
  /* браузерын push бүртгэл */
  '/api/push',
  /* профайл зураг байршуулах */
  '/api/upload',
] as const;

/** Зам нь зөвшөөрөгдсөн угтвартай эсэх — сегментийн хилээр таарна
 *  (`/api/attendance` нь `/api/attendance-confirmations`-ыг санамсаргүй
 *  зөвшөөрөхөөс сэргийлнэ; сүүлийнх нь жагсаалтад тусад нь бий). */
function isAllowedForWorker(path: string): boolean {
  return WORKER_ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * `/api/*`-д `authMiddleware`-ийн ДАРАА суух хаалт.  Worker биш бол юу ч
 * хийхгүй.  (Auth алгасдаг нийтийн замууд дээр `c.var.user` байхгүй тул
 * тэднийг мөн дамжуулна — тэдгээр нь аль хэдийн нийтийн зориулалттай.)
 */
export const workerScopeGuard = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  const user = c.get('user');
  if (!user || !isWorkerRole(user.role)) return next();
  if (isAllowedForWorker(c.req.path)) return next();
  return c.json({ error: 'Forbidden: энэ хэсэгт хандах эрхгүй' }, 403);
});
