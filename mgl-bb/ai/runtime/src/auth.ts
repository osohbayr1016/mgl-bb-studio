/**
 * MGL AI · ЛОКАЛ ҮЙЛЧИЛГЭЭНИЙ ХАМГААЛАЛТ (§39, §48).
 *
 * ⚠️ ЭНЭ ФАЙЛ НЬ РЕПОГИЙН МЭДЭГДЭЖ БУЙ АЮУЛГҮЙ БАЙДЛЫН #7-ЫГ ДАВТАХГҮЙ
 *    БАЙХЫН ТУЛД ОРШИНО.  `revit-mcp/server/` нь БАТАЛГААЖУУЛАЛТГҮЙ
 *    localhost `HttpListener` дээр Roslyn-оор C# эмхэтгэж ажиллуулдаг —
 *    ажилтны хөтөч дээр нээлттэй ДУРЫН вэб хуудас түүн рүү `fetch` хийж
 *    чадна.  MGL AI-ийн локал үйлчилгээ нь ДӨРВӨН давхаргатай:
 *
 *      1. ЗӨВХӨН 127.0.0.1 дээр сонсоно (сүлжээнээс хүрэхгүй).
 *      2. Суулгацын НУУЦ — санамсаргүй 32 байт, зөвхөн ажилтны хэрэглэгчийн
 *         профайлын хавтсанд, файлын эрхээр хамгаалагдсан.
 *      3. ORIGIN цагаан жагсаалт — хөтчийн хүсэлт нь ERP-ийн гарал үүслээс
 *         Л ирнэ.  Дурын вэб хуудас `Origin`-оо ХУУРЧ чадахгүй (хөтөч
 *         өөрөө тавьдаг).
 *      4. Богино хугацаат сессийн токен — нууц нь шууд биш, солилцоогоор.
 *
 * ⚠️ ДӨРВҮҮЛЭЭ ХАМТ.  Зөвхөн Origin-д найдах нь `curl`-ыг зогсоохгүй
 *    (тэр Origin-гүй илгээнэ, эсвэл дурын утга тавина); зөвхөн нууцад
 *    найдах нь XSS-ээр нууц алдагдвал хамгаалахгүй.
 */
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/** Сессийн токены наслалт — 12 цаг.  Ажлын өдрөөс арай урт. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionToken {
  token: string;
  expiresAt: number;
}

/** ⚠️ ХУГАЦААНЫ ТУРШИД ТОГТМОЛ ХАРЬЦУУЛАЛТ — timing attack-аас. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // Урт нь өөр бол `timingSafeEqual` шидэх тул урьдчилж хэшилнэ —
  // ингэснээр харьцуулалт үргэлж ижил урттай.
  const ha = createHash('sha256').update(ba).digest();
  const hb = createHash('sha256').update(bb).digest();
  return timingSafeEqual(ha, hb);
}

export function newSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Сессийн бүртгэл.  ⚠️ Санах ойд — процесс дахин асахад бүх сесс
 * хүчингүй болно, тэр нь ЗӨВ (шинэ процесс = шинэ итгэлцэл).
 */
export class SessionStore {
  readonly #sessions = new Map<string, number>();

  issue(now = Date.now()): SessionToken {
    this.#sweep(now);
    const token = randomBytes(24).toString('base64url');
    const expiresAt = now + SESSION_TTL_MS;
    this.#sessions.set(token, expiresAt);
    return { token, expiresAt };
  }

  valid(token: string | null | undefined, now = Date.now()): boolean {
    if (typeof token !== 'string' || token.length === 0) return false;
    const exp = this.#sessions.get(token);
    if (exp === undefined) return false;
    if (exp <= now) {
      this.#sessions.delete(token);
      return false;
    }
    return true;
  }

  revoke(token: string): void {
    this.#sessions.delete(token);
  }

  get size(): number {
    return this.#sessions.size;
  }

  #sweep(now: number): void {
    for (const [t, exp] of this.#sessions) if (exp <= now) this.#sessions.delete(t);
  }
}

/**
 * ⚠️ ЦЭВЭР ФУНКЦ — тестлэгдэнэ.  Origin зөвшөөрөгдсөн эсэх.
 *
 * `null`/байхгүй Origin нь хөтөч БИШ дуудагч (curl, Revit add-in, локал
 * скрипт).  Тэднийг ЗӨВШӨӨРНӨ, учир нь add-in нь Origin илгээхгүй —
 * гэвч тэд нууц/токеныг ЗААВАЛ дамжуулна.  Хамгаалалт нь давхарга бүрд
 * өөр өөр: Origin нь ХӨТӨЧИЙН хортой хуудсыг барина, нууц нь бусдыг.
 */
export function originAllowed(origin: string | undefined, allowlist: readonly string[]): boolean {
  if (origin === undefined || origin === 'null') return true;
  return allowlist.includes(origin);
}

/**
 * ХӨТЧИЙН ЗӨВШӨӨРӨГДСӨН ГАРАЛ ҮҮСЛЭЭС ирсэн эсэх.
 *
 * ⚠️ ЭНЭ НЬ ИТГЭМЖЛЭЛ.  `Origin` толгойг ХӨТӨЧ ӨӨРӨӨ тавьдаг бөгөөд
 *    хуудасны JavaScript түүнийг ХУУРЧ ЧАДАХГҮЙ (forbidden header).
 *    Тиймээс `Origin: https://mgl-design-system.pages.dev` гэсэн хүсэлт
 *    нь ҮНЭХЭЭР ERP-ийн хуудаснаас ирсэн гэсэн үг.  Хортой вэб хуудас
 *    өөрийн жинхэнэ Origin-оороо баригдана.
 *
 * ⚠️ ORIGIN БАЙХГҮЙ бол `false`.  `curl`, локал скрипт, Revit гүүр нь
 *    Origin илгээхгүй — тэднээс НУУЦ шаардсан хэвээр.  Хөтөч мөн эсэхийг
 *    ялгах цорын ганц найдвартай шинж энэ.
 *
 * ⚠️ ЯАГААД ХЭРЭГЛЭГЧЭЭС НУУЦ АСУУХАА БОЛИВ (2026-09-09, эзний заавар).
 *    Өмнө нь ажилтан `secret.txt`-ийг ГАРААР хуулж оруулах шаардлагатай
 *    байсан.  Тэр нь:
 *      · ХЭРЭГЛЭЭНД муу — ERP-д нэвтэрсэн хүнээс дахин «нууц» асууна;
 *      · АЮУЛГҮЙ БАЙДАЛД бараг ЮУ Ч НЭМЭХГҮЙ.  Нууц нь ажилтны ӨӨРИЙНХ
 *        нь профайлын хавтсанд байдаг тул тэр машин дээр ажиллаж буй
 *        хортой процесс түүнийг ЗҮГЭЭР УНШИНА.  Өөрөөр хэлбэл нууц нь
 *        локал халдагчийг ЗОГСООДОГГҮЙ, зөвхөн эзнийг нь ядраадаг байв.
 *
 *    Жинхэнэ хаалга нь ҮРГЭЛЖ хоёр давхарга байсан бөгөөд ХЭВЭЭР үлдэнэ:
 *      1. 127.0.0.1 бинд — сүлжээнээс огт хүрэхгүй;
 *      2. Origin цагаан жагсаалт — дурын вэб хуудас хүрэхгүй.
 *    Энэ өөрчлөлт нь ГУРАВ ДАХЬ, үр дүнгүй давхаргыг Л хассан.
 */
export function isTrustedBrowserOrigin(
  origin: string | undefined,
  allowlist: readonly string[],
): boolean {
  if (origin === undefined || origin === 'null') return false;
  return allowlist.includes(origin);
}

export type AuthFailure = 'no_credential' | 'bad_secret' | 'bad_session' | 'bad_origin';

export interface AuthCheck {
  secret: string;
  sessions: SessionStore;
  allowedOrigins: readonly string[];
}

export type AuthOutcome =
  | { ok: true; via: 'secret' | 'session' | 'origin' }
  | { ok: false; reason: AuthFailure };

/**
 * Хүсэлтийн толгойноос итгэлцлийг шийднэ.
 *
 * ⚠️ ORIGIN-ыг ЭХЛЭЭД шалгана.  Хортой хуудас зөв токентой байлаа ч
 *    (XSS-ээр хулгайлсан) Origin-оороо баригдана.
 *
 * ⚠️ ГУРВАН ЗӨВШӨӨРӨГДӨХ ЗАМ, ач холбогдлын дарааллаар:
 *      secret  — хөтөч БИШ клиент (скрипт, Revit гүүр, benchmark)
 *      session — солилцсон богино хугацаат токен
 *      origin  — ERP-ийн хуудас.  Ажилтан ERP-д АЛЬ ХЭДИЙН нэвтэрсэн
 *                тул дахин нууц асуух нь давхардсан саад байв.
 */
export function authenticate(
  headers: { origin?: string; secret?: string; session?: string },
  cfg: AuthCheck,
): AuthOutcome {
  if (!originAllowed(headers.origin, cfg.allowedOrigins)) {
    return { ok: false, reason: 'bad_origin' };
  }
  if (headers.secret !== undefined) {
    return safeEqual(headers.secret, cfg.secret)
      ? { ok: true, via: 'secret' }
      : { ok: false, reason: 'bad_secret' };
  }
  if (headers.session !== undefined) {
    return cfg.sessions.valid(headers.session)
      ? { ok: true, via: 'session' }
      : { ok: false, reason: 'bad_session' };
  }
  // ⚠️ ЗӨВШӨӨРӨГДСӨН ХӨТЧИЙН ГАРАЛ ҮҮСЭЛ НЬ ӨӨРӨӨ ИТГЭМЖЛЭЛ.  Дэлгэрэнгүй
  //    үндэслэлийг `isTrustedBrowserOrigin`-ийн тайлбараас үз.
  if (isTrustedBrowserOrigin(headers.origin, cfg.allowedOrigins)) {
    return { ok: true, via: 'origin' };
  }
  return { ok: false, reason: 'no_credential' };
}
