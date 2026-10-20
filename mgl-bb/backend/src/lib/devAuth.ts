import type { Env, JWTPayload, UserRole } from '../types';

/**
 * ЗӨВХӨН ЛОКАЛ ХӨГЖҮҮЛЭЛТИЙН auth алгасалт.
 *
 * `wrangler dev` дээр token байхгүй (эсвэл хугацаа нь дууссан) хүсэлтийг
 * 401-ээр хаяхын оронд тохируулсан хэрэглэгчээр (өгөгдмөл `admin`) нэвтэрсэнд
 * тооцно.  Ингэснээр локалд Postman/curl/шинэ таб бүрээс нэвтрэлтгүй ажиллана.
 *
 * ХОЁР давхар хамгаалалт — production-д санамсаргүй асахаас сэргийлнэ:
 *   1. `DEV_AUTH_BYPASS=1` нь ЗӨВХӨН `.dev.vars`-д байдаг (gitignore, deploy-д
 *      орохгүй).  wrangler.toml-ийн [vars]-д БИТГИЙ нэм.
 *   2. Хүсэлтийн host нь localhost/127.0.0.1 байх ёстой — flag ямар нэг байдлаар
 *      prod-д тавигдсан ч workers.dev/custom domain дээр идэвхжихгүй.
 *
 * Жинхэнэ token ирвэл ТЭР давуу эрхтэй (`middleware/auth.ts` эхлээд token-оо
 * шалгана), тул локалд өөр role-оор нэвтэрч тестлэх боломж хэвээр.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/** Энэ хүсэлт дээр dev алгасалт зөвшөөрөгдөх эсэх. */
export function devAuthAvailable(env: Env, requestUrl: string): boolean {
  if (env.DEV_AUTH_BYPASS !== '1') return false;
  try {
    const host = new URL(requestUrl).hostname.toLowerCase();
    return LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** Алгасалтын хэрэглэгчийг DB-ээс уншиж JWT payload хэлбэрээр буцаана. */
export async function devAuthPayload(env: Env): Promise<JWTPayload | null> {
  const username = (env.DEV_AUTH_USER ?? '').trim() || 'admin';
  const row = await env.DB.prepare(
    `SELECT id, role FROM users WHERE username = ? AND status = 'active'`,
  )
    .bind(username)
    .first<{ id: number; role: UserRole }>();
  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  return { sub: row.id, role: row.role, iat: now, exp: now + 24 * 3600 };
}

let warned = false;
/** Isolate тутамд нэг л удаа сануулах лог (dev консолыг бөглөхгүй). */
export function warnDevAuthOnce(username: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[dev-auth] Нэвтрэлт алгасаж «${username}» хэрэглэгчээр ажиллаж байна (локал зөвхөн).`);
}
