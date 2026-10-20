/**
 * MGL AI · ХЭН ЯРЬЖ БАЙНА (§8 бүртгэлийн илрүүлэлт).
 *
 * ⚠️ ГОЛ ДҮРЭМ: горимыг ХҮСЭЛТИЙН БИЕЭС ХЭЗЭЭ Ч авахгүй.  `resolveAiMode`
 *    нь ЗӨВХӨН баталгаажсан токены `role`-ыг хүлээж авдаг — «mode»,
 *    «as_admin», «role» гэсэн параметр энэ файлд ОРШИХГҮЙ ба нэмэх нь
 *    эрхийн бүхэл давхаргыг нэг мөрөөр тойрно.
 *
 * ⚠️ ХОЦРОЛТЫГ ӨВЛӨНӨ, ТОЙРОХГҮЙ.  Репо даяар `role` нь JWT-д амьдардаг
 *    тул D1 дээрх role солилт 24 цаг хүртэл хүчин төгөлдөр болохгүй
 *    (CLAUDE.md).  MGL AI үүнийг ЗАСАХ ГЭЖ ОРОЛДОХГҮЙ — DB-ээс role
 *    дахин уншвал ЭНЭ ганц газар бусад бүх шалгалтаас өөрөөр биеэ авч
 *    явах ба тэр зөрүү нь илрэхэд хамгийн хэцүү төрлийн алдаа.  Эрхийн
 *    өөрчлөлтийг «гараад дахин нэвтэр» гэж хэлнэ.
 *
 * ⚠️ `worker` (цэвэрлэгч) нь MGL AI-д ХҮРЭХГҮЙ.  `lib/workerScope.ts` нь
 *    хаалттай-анхдагч цагаан жагсаалт тул `/api/mgl-ai` түүнд автоматаар
 *    403 өгнө.  Энд `denied` буцаах нь ХОЁРДУГААР давхарга — MCP-ийн
 *    цоорхойгоос (CLAUDE.md-ийн аюулгүй байдлын #5) сурсан сургамж:
 *    нэг давхаргын хаалт нь өөр ингресс нээгдэхэд ЧИМЭЭГҮЙ уначихдаг.
 */
import type { UserRole } from '../../types';

export const AI_MODES = ['client', 'employee', 'admin', 'denied'] as const;
export type AiMode = (typeof AI_MODES)[number];

/** Хариулт бодитоор үүсгэж болох горимууд. */
export type ActiveAiMode = Exclude<AiMode, 'denied'>;

export function isActiveMode(m: AiMode): m is ActiveAiMode {
  return m !== 'denied';
}

/**
 * Токены role → AI горим.  ЦЭВЭР функц, тестээр бүрэн хаагдсан.
 *
 * `null`/`undefined` role = нэвтрээгүй зочин → `client`.
 * Танихгүй role → `denied`.  ⚠️ ЗОРИУД: шинэ role нэмэгдэхэд MGL AI
 * ӨГӨГДМӨЛӨӨР ХААЛТТАЙ байна, нээлттэй биш.
 */
export function resolveAiMode(role: UserRole | null | undefined): AiMode {
  if (role === null || role === undefined) return 'client';
  switch (role) {
    case 'admin':
      return 'admin';
    case 'senior':
    case 'engineer':
    case 'architect':
      return 'employee';
    case 'client':
      return 'client';
    case 'worker':
      return 'denied';
    default:
      return 'denied';
  }
}

export interface AiIdentity {
  mode: AiMode;
  /** Нэвтэрсэн хэрэглэгчийн id, зочинд `null`. */
  userId: number | null;
  role: UserRole | null;
  /** Санал хүсэлтийн ӨВӨРМӨЦ түлхүүр (0269-ийн `voter_key`). */
  voterKey: string;
  /** Санамжийн namespace — ажилтан ба захиалагч ХЭЗЭЭ Ч холилдохгүй. */
  memoryNamespace: 'employee' | 'client';
}

/**
 * Баталгаажсан токены агуулгаас бүрэн таних тэмдэг гаргана.
 *
 * @param payload `c.var.user` — `authMiddleware`-ийн тавьсан утга, эсвэл
 *                нэвтрээгүй үед `null`.
 * @param anonKey Зочны сессийн түлхүүр (cookie/header).  Зөвхөн
 *                нэвтрээгүй үед хэрэглэгдэнэ ба ямар ч эрх ОЛГОХГҮЙ —
 *                энэ бол давхардлын түлхүүр, нэвтрэлт БИШ.
 */
export function resolveAiIdentity(
  payload: { sub?: unknown; role?: unknown } | null | undefined,
  anonKey?: string | null,
): AiIdentity {
  const role = typeof payload?.role === 'string' ? (payload.role as UserRole) : null;
  const sub = typeof payload?.sub === 'number' ? payload.sub : Number(payload?.sub);
  const userId = Number.isInteger(sub) && sub > 0 ? sub : null;

  const mode = resolveAiMode(role);
  // `client` горимд ажилтны namespace руу ХЭЗЭЭ Ч хүрэхгүй.  Ажилтан
  // захиалагч болж дахин нэвтэрвэл түүний хуучин санамж нь шинэ
  // namespace-д УНШИГДАХГҮЙ — энэ нь алдаа биш, зорилго.
  const memoryNamespace: 'employee' | 'client' = mode === 'client' ? 'client' : 'employee';

  const voterKey = userId !== null ? `u:${userId}` : `a:${sanitizeAnonKey(anonKey)}`;

  return { mode, userId, role, voterKey, memoryNamespace };
}

/**
 * Зочны түлхүүрийг цэвэрлэнэ.  ⚠️ Индексийн түлхүүр болох тул урт нь
 * хязгаарлагдана, зөвхөн аюулгүй тэмдэгт үлдэнэ.  Хоосон бол `unknown`
 * — тэр тохиолдолд нэг мессежид нэг л санал үлдэх нь зөв (олон зочин
 * нэг санал хуваалцах нь давхар санал өгөхөөс дээр).
 */
export function sanitizeAnonKey(raw: string | null | undefined): string {
  const s = typeof raw === 'string' ? raw.replace(/[^A-Za-z0-9_-]/g, '') : '';
  return s.length === 0 ? 'unknown' : s.slice(0, 64);
}

/** Админ нь ажилтны БҮХ чадварыг агуулна (өгөгдлийн эрх нь ӨӨР асуудал). */
export function isEmployeeTier(mode: AiMode): boolean {
  return mode === 'employee' || mode === 'admin';
}

export function isAdminTier(mode: AiMode): boolean {
  return mode === 'admin';
}
