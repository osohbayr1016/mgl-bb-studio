/**
 * ХАСАГДСАН (410) ЗАМЫН ХЭРЭГЛЭЭНИЙ ТООЛУУР (2026-10-15).
 *
 * Зорилго: 410 буцаадаг хуучин замуудыг (`/tasks/:id/split`, `/allocation/parts` …) кодоос БҮРМӨСӨН устгахаас өмнө
 * кэштэй хуучин PWA / хөтөч / гадны скрипт тэднийг дуудсаар байгаа эсэхийг ХЭМЖИНЭ.  Шууд устгавал хуучин клиент
 * ойлгомжтой 410-ын оронд 404 (эсвэл `/:id`-ийн өөр handler) авна.
 *
 * Хадгалалт: `app_settings` мөр (миграцгүй), түлхүүр `retired_hits.<route>`, утга JSON:
 *   `{count, first_at, last_at, last_user, last_ua, users: {"u<id>": "<сүүлд дуудсан>"}}`
 * Нэг атом UPSERT — зэрэг ирсэн хоёр хүсэлт тоог алдахгүй.  Эдгээр зам ховор дуудагддаг тул D1 бичилт бараг тэг.
 * Хариуг ХЭЗЭЭ Ч саатуулахгүй (`waitUntil`), бичилт унавал 410 хэвээр буцна.
 *
 * Унших:  npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
 *           --command "SELECT key, value, updated_at FROM app_settings WHERE key LIKE 'retired_hits.%'"
 * Мөр БАЙХГҮЙ = deploy-оос хойш хэн ч дуудаагүй.
 */
import type { Context } from 'hono';

import type { AppVariables, Env } from '../types';

export const RETIRED_HITS_PREFIX = 'retired_hits.';

/** User-Agent-ийг хадгалах дээд урт — хөтөч/PWA/скриптийг ялгахад хангалттай. */
const UA_MAX = 160;

const UPSERT_SQL = `INSERT INTO app_settings (key, value, updated_at, updated_by)
  VALUES (?1,
          json_object('count', 1, 'first_at', ?2, 'last_at', ?2, 'last_user', CAST(?3 AS INTEGER), 'last_ua', ?4,
                      'users', json_object(?5, ?2)),
          datetime('now'), NULL)
  ON CONFLICT(key) DO UPDATE SET
    value = json_set(app_settings.value,
                     '$.count', COALESCE(json_extract(app_settings.value, '$.count'), 0) + 1,
                     '$.last_at', ?2,
                     '$.last_user', CAST(?3 AS INTEGER),
                     '$.last_ua', ?4,
                     '$.users.' || ?5, ?2),
    updated_at = datetime('now')`;

type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Хасагдсан замын нэг дуудлагыг тэмдэглэнэ (fire-and-forget). */
export function recordRetiredHit(c: Ctx, route: string): void {
  let userId: number | null = null;
  try {
    const sub = c.get('user')?.sub;
    userId = typeof sub === 'number' && Number.isSafeInteger(sub) ? sub : null;
  } catch {
    userId = null;
  }
  const ua = (c.req.header('user-agent') ?? '').slice(0, UA_MAX) || null;
  const at = new Date().toISOString();
  console.warn(`[retired] ${route} user=${userId ?? '-'} ua=${ua ?? '-'}`);

  const write = (async () => {
    try {
      await c.env.DB.prepare(UPSERT_SQL).bind(`${RETIRED_HITS_PREFIX}${route}`, at, userId, ua, userId === null ? 'uanon' : `u${userId}`).run();
    } catch (err) {
      console.error('[retired] counter write failed', route, err);
    }
  })();
  try {
    c.executionCtx.waitUntil(write);
  } catch {
    // Тест / ExecutionContext-гүй орчин — promise өөрөө алдаагаа барьдаг.
  }
}

/** 410 handler + тоолуур.  `route` = тогтвортой нэр (`tasks.split`), URL биш — id-тай замыг нэгтгэнэ. */
export function retiredHandler(route: string, body: { error: string; message: string }) {
  return (c: Ctx) => {
    recordRetiredHit(c, route);
    return c.json(body, 410);
  };
}
