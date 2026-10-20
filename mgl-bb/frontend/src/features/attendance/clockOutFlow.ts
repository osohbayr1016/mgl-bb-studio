/**
 * «Гарсан бүртгэл»-ийн ЦЭВЭР дүрэм — Ирц хуудас ба Хяналтын самбарын widget
 * хоёулаа `useClockOutFlow`-оор дамжуулж хэрэглэнэ.
 *
 * ЗОРИЛГО (эзэн, 2026-10-19): гарах бүртгэлээ хийсэн хүн маргааш нь «хийгээгүй»
 * гэсэн түгжээ ХЭЗЭЭ Ч харахгүй; бүртгэл хийгдээгүй бол яг тэр агшинд нь
 * ШАЛТГААН нь энгийн монгол хэлээр харагдана.  Өмнөх гэмтлүүд бүгд «чимээгүй»
 * байсан:
 *   • товч кэшийн хуучирсан `progress_logged_today`-оор идэвхгүй болж, дарахад
 *     юу ч болдоггүй байв (прод 2026-10-16, user 84);
 *   • PGP дутуу бол тайлбаргүйгээр өөр хуудас руу шилжүүлдэг байв;
 *   • сүлжээ тасарсан / сервер алдаа нь англи «API Request Failed» эсвэл
 *     ерөнхий улаан мөр болдог байв;
 *   • сүлжээ тасарч ХАРИУ нь алдагдсан ч сервер дээр амжилттай болсон гарах
 *     бүртгэлийг дахин дарахад «олдсонгүй» гэсэн алдаа гардаг байв.
 *
 * Энэ файл ямар ч runtime import хийхгүй (`node scripts/check-clock-out-flow.mjs`
 * шууд ачаална) — алдааг `instanceof` биш шинжээр нь (duck typing) ангилна.
 */

/** Гарах бүртгэл хийгдэхэд саад болж буй нэг шалтгаан. */
export type ClockOutBlock =
  /** Өнөөдөр ажлын бүртгэл алга (сервер `hasReportedWorkToday`). */
  | { kind: 'progress' }
  /** Хувь хүний хөгжлийн төлөвлөгөө бөглөөгүй (зөвхөн клиентийн дүрэм). */
  | { kind: 'pgp' }
  /** Оффисын сүлжээнд биш (сервер `OFFICE_NETWORK`). */
  | { kind: 'network'; ip: string | null }
  /** Сервер рүү хүрч чадсангүй — интернэт/сервер. */
  | { kind: 'offline' }
  /** Төслийн жагсаалт ачаалагдсангүй — сонгох popup хоосон болно. */
  | { kind: 'projects_unavailable' }
  /** Өнөөдөр ирсэн бүртгэл алга (гарах зүйлгүй). */
  | { kind: 'not_clocked_in' }
  /** Бусад серверийн татгалзал — серверийн монгол бичвэрээр. */
  | { kind: 'server'; message: string };

/** `GET /attendance/my-status`-ээс энд хэрэгтэй хэсэг. */
export type ClockOutStatus = {
  clocked_in?: boolean;
  on_office_ip?: boolean;
  require_office_ip?: boolean;
  client_ip?: string | null;
  progress_logged_today?: boolean;
  session?: { clock_in?: string | null; clock_out?: string | null } | null;
};

export type PreflightContext = {
  /** Admin tier / онцгойлсон / цэвэрлэгч — явц, төсөл, PGP шаардахгүй. */
  exempt: boolean;
  pgpMissing: boolean;
  /** Төслийн жагсаалтын query алдаатай бөгөөд жагсаалт хоосон. */
  projectsUnavailable: boolean;
};

export type PreflightResult =
  /** Бүх нөхцөл хангагдсан — гарах popup-ыг нээ. */
  | { kind: 'ready' }
  /** Өнөөдрийн гарах бүртгэл аль хэдийн хийгдсэн — алдаа БИШ. */
  | { kind: 'already_out'; clockOut: string }
  /** Хийгдэх боломжгүй — БҮХ шалтгааныг нэг дор хэлнэ. */
  | { kind: 'blocked'; blocks: ClockOutBlock[] };

/**
 * Серверээс ШИНЭЭР уншсан төлөв (`fresh`) дээр гарах бүртгэл хийх боломжтой
 * эсэхийг шийднэ.  `fresh === null` = төлвийг уншиж чадсангүй (сүлжээ).
 */
export function clockOutPreflight(
  fresh: ClockOutStatus | null,
  ctx: PreflightContext,
): PreflightResult {
  if (!fresh) return { kind: 'blocked', blocks: [{ kind: 'offline' }] };
  if (!fresh.clocked_in) {
    const out = fresh.session?.clock_out;
    if (out) return { kind: 'already_out', clockOut: out };
    return { kind: 'blocked', blocks: [{ kind: 'not_clocked_in' }] };
  }
  const blocks: ClockOutBlock[] = [];
  if (fresh.require_office_ip !== false && fresh.on_office_ip === false) {
    blocks.push({ kind: 'network', ip: fresh.client_ip && fresh.client_ip !== 'unknown' ? fresh.client_ip : null });
  }
  if (!ctx.exempt) {
    if (fresh.progress_logged_today === false) blocks.push({ kind: 'progress' });
    if (ctx.pgpMissing) blocks.push({ kind: 'pgp' });
    if (ctx.projectsUnavailable) blocks.push({ kind: 'projects_unavailable' });
  }
  return blocks.length > 0 ? { kind: 'blocked', blocks } : { kind: 'ready' };
}

/** `apiFetch`-ийн алдааны шинж (ApiError / ApiNetworkError / бусад). */
type ErrorLike = {
  name?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
  payload?: unknown;
};

export type SubmitErrorResolution =
  /** Popup-ыг хааж «Гарах бүртгэл хийгдээгүй» цонхонд шалтгааныг харуул. */
  | { kind: 'block'; block: ClockOutBlock }
  /** Popup дотор засаж болно (төсөл сонгох г.м.) — тэнд нь харуул. */
  | { kind: 'inline'; message: string }
  /** Үр дүн тодорхойгүй — төлвийг дахин уншиж шийд (амжилттай байж магадгүй). */
  | { kind: 'verify'; fallback: ClockOutBlock };

/** Popup дотор засаж болох серверийн кодууд. */
const INLINE_CODES = new Set([
  'PROJECT_REQUIRED',
  'TOO_MANY_PROJECTS',
  'PROJECT_NOT_FOUND',
  'REPAIR_PROJECT_NOT_FOUND',
  'REPAIR_PROJECT_ARCHIVED',
]);

/** Монгол (кирилл) бичвэр мөн эсэх — англи «API Request Failed»-ийг хэрэглэгчид харуулахгүй. */
function isMongolianText(s: string): boolean {
  return /[Ѐ-ӿ]/.test(s);
}

/**
 * `POST /attendance/clock-out` унасан үед юу хийхийг шийднэ.
 *
 * ⚠️ Сүлжээний алдаа ба 5xx нь «хийгдээгүй» гэсэн БАТАЛГАА биш — хүсэлт
 * сервер дээр амжилттай болоод зөвхөн хариу нь алдагдсан байж болно.
 * Тиймээс `verify`: дуудагч төлвийг дахин уншиж, гарсан бол амжилт гэж үзнэ.
 * `NO_OPEN_SESSION` / `ALREADY_CLOCKED_OUT` ч мөн адил (давтан дарсан).
 */
export function resolveClockOutError(err: unknown): SubmitErrorResolution {
  const e = (err ?? {}) as ErrorLike;
  const code = typeof e.code === 'string' ? e.code : undefined;
  const status = typeof e.status === 'number' ? e.status : undefined;
  const message = typeof e.message === 'string' ? e.message : '';

  if (e.name === 'ApiNetworkError' || status === undefined) {
    return { kind: 'verify', fallback: { kind: 'offline' } };
  }
  if (code === 'NO_OPEN_SESSION' || code === 'ALREADY_CLOCKED_OUT') {
    return { kind: 'verify', fallback: { kind: 'not_clocked_in' } };
  }
  if (code === 'PROGRESS_REQUIRED') return { kind: 'block', block: { kind: 'progress' } };
  if (code === 'OFFICE_NETWORK' || status === 403) {
    const payload = (e.payload ?? {}) as { client_ip?: unknown };
    const ip = typeof payload.client_ip === 'string' ? payload.client_ip : null;
    return { kind: 'block', block: { kind: 'network', ip } };
  }
  if (status >= 500) return { kind: 'verify', fallback: { kind: 'offline' } };
  if (code && INLINE_CODES.has(code) && isMongolianText(message)) {
    return { kind: 'inline', message };
  }
  if (isMongolianText(message)) return { kind: 'block', block: { kind: 'server', message } };
  // Монгол бичвэргүй тодорхойгүй алдаа — сүлжээ/серверийн алдаа гэж үзэж шалгана.
  return { kind: 'verify', fallback: { kind: 'offline' } };
}

/** `2026-10-16T18:06:58+08:00` → `18:06` (УБ цагийн бичвэрээс шууд). */
export function hhmmOf(iso: string | null | undefined): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso ?? '');
  return m ? `${m[1]}:${m[2]}` : '';
}
