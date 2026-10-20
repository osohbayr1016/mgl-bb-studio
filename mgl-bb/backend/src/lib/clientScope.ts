import { createMiddleware } from 'hono/factory';
import type { Env, AppVariables } from '../types';

/**
 * `client` (захиалагч) role-ийн API хамрах хүрээ.
 *
 * Урьд нь client-ийг зөвхөн route ТУС БҮРИЙН дотоод шалгалтаар хаадаг байсан
 * (`role === 'client'` гэсэн 47 шалгалт).  Тэр загварын алдаа нь: шалгалт
 * НЭМЭХЭЭ мартсан route бүр захиалагчид ЧИМЭЭГҮЙ нээлттэй байдаг.  Хэмжсэн
 * үр дүн (CLAUDE.md-ийн аюулгүй байдлын #3, #4):
 *
 *   • `GET /api/documents`      — компанийн БҮХ архивын баримт ил
 *   • `GET /api/blocks|drawings|components|tasks` — өөр төслийн бүтэц ил
 *   • `/api/projects/:id/activity|members|client-logo` — эрхийн хаалтгүй
 *
 * Тиймээс `worker` role-той ЯГ ижил шийдлийг хэрэглэв: ЦАГААН ЖАГСААЛТ.
 * Шинэ route модуль нэмэгдэхэд захиалагчид ӨГӨГДМӨЛӨӨР ХААЛТТАЙ байна.
 *
 * ⚠️ Энэ бол зөвхөн ПРЕФИКСИЙН хаалт.  «Аль төслийг нь харах вэ» гэдгийг
 *    `lib/clientAccess.ts` route дотор шийднэ — жагсаалтад орсон нь «бүх
 *    төсөл харна» гэсэн үг БИШ.
 */
const CLIENT_ALLOWED_PREFIXES = [
  /* нэвтрэлт, өөрийн профайл, нууц үг солих */
  '/api/auth',
  /* захиалагчийн порталын өөрийнх нь гадаргуу */
  '/api/client',
  /* хаалттай bucket-аас файл дамжуулах */
  '/api/client-files',
  /* төслийн паспорт, тайлан, техникийн нөхцөл, гишүүд (дотооддоо
     гишүүнчлэлээр шүүгддэг) */
  '/api/projects',
  /* албан бичгийн бүртгэл — уншихыг зөвшөөрдөг, бичихийг үгүй */
  '/api/correspondence',
  /* төсөл/чиглэлийн чат — бүх route нь project_members шалгадаг */
  '/api/project-chat',
  /* 3D загвар үзэх (APS) */
  '/api/aps',
  /* мэдэгдлийн хонх */
  '/api/notifications',
  /* браузерын push бүртгэл */
  '/api/push',
  /* материал илгээхэд файл байршуулах */
  '/api/upload',
  /* MGL AI — ЗАХИАЛАГЧИЙН ГОРИМ.  ⚠️ Энэ угтвар нээлттэй байх нь
     «захиалагч бүхнийг асууж болно» гэсэн үг БИШ: `routes/mglAi.ts` нь
     (а) `mglai.client_mode` тохиргоо унтраалттай бол 503,
     (б) `lib/mglai/visibility.ts`-ээр нотолгоог prompt угсрахаас ӨМНӨ
         `public` ангилал + `public|org|project` хамрах хүрээгээр шүүнэ,
     (в) `lib/mglai/permissions.ts`-ээр захиалагчид ЗӨВХӨН `read` төрлийн
         хэрэгсэл өгнө.  Гурвуулаа тестээр хаагдсан. */
  '/api/mgl-ai',
] as const;

/** Зам нь зөвшөөрөгдсөн угтвартай эсэх — сегментийн хилээр таарна
 *  (`/api/client` нь `/api/client-files`-ыг санамсаргүй зөвшөөрөхгүй;
 *  сүүлийнх нь жагсаалтад тусад нь бий). */
function isAllowedForClient(path: string): boolean {
  return CLIENT_ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * `/api/*`-д `workerScopeGuard`-ийн ДАРАА суух хаалт.  Client биш бол юу ч
 * хийхгүй.  (Auth алгасдаг нийтийн замууд дээр `c.var.user` байхгүй тул
 * тэднийг мөн дамжуулна.)
 */
export const clientScopeGuard = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'client') return next();
  if (isAllowedForClient(c.req.path)) return next();
  return c.json({ error: 'Forbidden: энэ хэсэгт хандах эрхгүй' }, 403);
});
