import type { JWTPayload } from '../types';
import { currentTenantId } from './requestContext';

/**
 * ТОКЕНЫ ЦУЦЛАЛТ (1A-3) — «энэ токен ХҮЧИНГҮЙ болсон уу?»
 *
 * `lib/jwt.ts`-ийн `verifyToken` нь гарын үсэг + `exp`-ээс өөр ЮУ Ч шалгадаггүй
 * бөгөөд DB-д ОГТ ХАНДДАГГҮЙ.  Иймд өнөөдрийг хүртэл системд токеныг цуцлах
 * ганц арга нь `JWT_SECRET` сэлгэх байсан — тэр нь БҮХ session, БҮХ суулгасан
 * Revit add-in, БҮХ дундах хэвлэлтийн ажлыг НЭГ ЗЭРЭГ устгадаг.  Энэ модуль нь
 * тэр «атомын товч»-ийг хэрэггүй болгож, токены НАСЫГ ОГТ өөрчлөхгүйгээр
 * цуцлалт нэмнэ:
 *
 *   • `users.tokens_valid_from` (migration 0211) — энэ ISO огнооноос ӨМНӨ
 *     олгогдсон (`iat`) токен бүхэлдээ хүчингүй.  NULL = хэзээ ч цуцлаагүй.
 *   • `users.status = 'inactive'` — ажлаас гарсан хүний ХУУЧИН токен ч унана.
 *
 * ⚠️ ХОЁР дуудагчтай, ХОЁУЛАА НЭГ deploy дотор нэмэгдэнэ:
 *      • middleware/auth.ts            → бүх /api зам
 *      • index.ts resolveExternalToken → /mcp, /sse (legacy bearer JWT)
 *    Ганцхан газарт нэмэх нь «цуцаллаа» гэсэн ХУДАЛ баталгаа өгнө: `/mcp` нь
 *    OAuth провайдерын эзэмшдэг root зам тул `authMiddleware`-ийг ОГТ дайрдаггүй.
 *
 * ⚠️ ХАМРАХ ХҮРЭЭНИЙ ХИЛ: `/authorize`-аар олгогдсон OAuth grant нь `OAUTH_KV`-д
 *    props `{sub, role}`-оор амьдардаг, `verifyToken`-оор дамждаггүй, `iat` ч
 *    агуулдаггүй — тиймээс `tokens_valid_from` түүнд ХАМААРАХГҮЙ.  Түүний access
 *    token 1 цагийн настай (`index.ts` `accessTokenTTL`).  Grant-уудыг цуцлах нь
 *    ТУСДАА ажил (KV-г гүйлгэх).
 *
 * ⚠️ `purpose`-ийг ОГТ ХАРАХГҮЙ.  Ялангуяа purpose==='mcp'-ийг ХЭЗЭЭ Ч
 *    татгалзахгүй — Revit add-in нь REST дуудлага БҮРИЙГ тэр токеноор
 *    баталгаажуулдаг, дотроо refresh/авто-шинэчлэлтийн урсгал БАЙХГҮЙ.  Тэр
 *    токеныг хаах нь ~20 ажилтны PC дээр Revit-ийг хааж `Install.bat`-ыг гараар
 *    ажиллуулахаас өөр сэргээх аргагүй ГАНЦ өөрчлөлт.
 */
export type TokenCheck = { ok: true } | { ok: false; reason: 'revoked' | 'inactive' | 'no_user' };

/**
 * Isolate-level кэш — /api хүсэлт бүрт D1 унших дуудлага нэмэхгүйн тулд.
 *
 * TTL нь «цуцлалт хэдэн секундын дараа хүчин төгөлдөр болох вэ»-г тодорхойлно:
 * TTL=0 бол шууд цуцлалт, гэхдээ хүсэлт бүрт нэмэлт D1 унших; 60 сек бол
 * бараг тэг өртөг, 1 минут хүртэл саатал.  Латентын өртөг өнөөдөр ХЭМЖЭЭГҮЙ
 * (1C track-ын ажил) тул эзний шийдвэр гартал 60 секундээр эхэлж байна.
 *
 * ⚠️ ЖИНХЭНЭ баталгаа нь TTL, cache invalidation БИШ: Worker нь олон isolate
 *    дээр ажилладаг тул `invalidateTokenCache` нь зөвхөн ӨӨРИЙН isolate-д
 *    нөлөөлнө.  Иймд «хамгийн удаад TTL секундын дараа» гэж л амла.
 */
const TTL_MS = 60_000;

type Row = { tokens_valid_from: string | null; status: string | null };
type Entry = {
  at: number;
  row: Row | null;
  /** DB унших амжилтгүй болсон (ж: 0211 хараахан хэрэгжээгүй) — ЦУЦЛАХГҮЙ. */
  degraded: boolean;
};

/**
 * ⚠️ Түлхүүр нь tenant + user id.  `sub` нь ТУХАЙН компанийн DB доторх id учир
 *    A компанийн `sub: 5` нь B-д ӨӨР ХҮН — модулийн түвшний Map нь isolate-д
 *    нэг тул зөвхөн `sub`-аар түлхүүрлэвэл нэг компанийн цуцлалт нөгөөд
 *    алдаатай хэрэглэгдэнэ.  Нэг-tenant суулгацад `currentTenantId()` нь
 *    үргэлж `'default'` буцаадаг тул зан төлөв өнөөдрийнхтэй ижил.
 */
const cache = new Map<string, Entry>();

function cacheKey(userId: number): string {
  return `${currentTenantId()}:${userId}`;
}

/** Кэшийг цэвэрлэнэ.  `userId` өгөхгүй бол БҮХ бичлэгийг (бүх tenant-ынхыг). */
export function invalidateTokenCache(userId?: number): void {
  if (userId === undefined) cache.clear();
  else cache.delete(cacheKey(userId));
}

export async function checkTokenValidity(db: D1Database, payload: JWTPayload): Promise<TokenCheck> {
  const now = Date.now();
  const key = cacheKey(payload.sub);

  let entry = cache.get(key);
  if (!entry || now - entry.at >= TTL_MS) {
    try {
      const row = await db
        .prepare('SELECT tokens_valid_from, status FROM users WHERE id = ?')
        .bind(payload.sub)
        .first<Row>();
      entry = { at: now, row: row ?? null, degraded: false };
    } catch (err) {
      // ⚠️ FAIL-OPEN, ЗОРИУДААР.  Энэ салаа хоёр тохиолдолд ажиллана:
      //    (1) migration 0211 хараахан хэрэгжээгүй → «no such column»,
      //    (2) D1 түр боломжгүй.
      //    Хоёуланд нь ТАТГАЛЗвал БҮХ ажилтан БҮХ API-аас нэг зэрэг гарна —
      //    цуцлалт байхгүй байсан суурь төлөвөөс хамаагүй ДОР үр дагавар.
      //    Суурь зан төлөв (цуцлалт огт байхгүй) руу зөөлөн буурч байна.
      console.warn(
        `[token-validity] users уншиж чадсангүй (sub=${payload.sub}) — цуцлалт алгасав:`,
        err instanceof Error ? err.message : err,
      );
      entry = { at: now, row: null, degraded: true };
    }
    cache.set(key, entry);
  }

  if (entry.degraded) return { ok: true };

  const row = entry.row;
  if (!row) return { ok: false, reason: 'no_user' };
  if (row.status === 'inactive') return { ok: false, reason: 'inactive' };

  if (row.tokens_valid_from) {
    const cutoff = Math.floor(Date.parse(row.tokens_valid_from) / 1000);
    // Огноог задалж чадахгүй бол ЦУЦЛАХГҮЙ — гэмтсэн нэг утга бүх хүнийг
    // гаргах ёсгүй.  (`Date.parse` буруу форматад NaN буцаана.)
    if (Number.isFinite(cutoff) && payload.iat < cutoff) return { ok: false, reason: 'revoked' };
  }

  return { ok: true };
}
