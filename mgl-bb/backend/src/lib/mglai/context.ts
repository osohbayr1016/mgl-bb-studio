/**
 * MGL AI · КОНТЕКСТ ШИЙДВЭРЛЭГЧ.
 *
 * ⚠️ Энэ файл нь `routes/mglAi.ts`-ийн ХАМГИЙН ЧУХАЛ туслах: хэрэглэгчийн
 *    ERP-ийн эрхийг ЖИНХЭНЭ эх сурвалжаас (D1) уншиж, `Viewer` болгоно.
 *    Эрхийг токеноос ХЭЗЭЭ Ч гаргахгүй — role бол токенд, ХАМРАХ ХҮРЭЭ нь
 *    өгөгдлийн санд.
 *
 * ⚠️ `clientProjectIds` нь `lib/clientAccess.ts`-ийн 60 секундын кэштэй
 *    хувилбар — гэрээ цуцлагдсан байгууллага маргааш хүртэл зураг татах
 *    эрсдэлээс тэр л хамгаална.  Энд ДАХИН хэрэгжүүлэхгүй.
 */
import type { Env } from '../../types';
import { isAdminRole } from '../../types';
import { clientProjectIds, clientOrgIds } from '../clientAccess';
import type { AiIdentity } from './identity';
import type { Viewer } from './visibility';
import { isNormativeQuestion } from './intent';

/**
 * Хэрэглэгчийн харах эрхтэй төслүүд.
 *
 * ⚠️ Ажилтан (`engineer|architect|senior|admin`) нь ERP-ийн одоогийн зан
 *    төлөвөөр БҮХ төслийг хардаг (`routes/projects.ts:407`).  Тиймээс
 *    тэдэнд хоосон массив буцаах нь ЗӨВ — `visibility.ts` нь ажилтны
 *    хувьд `project` хамрах хүрээг `projectIds`-ээр шалгадаг тул хоосон
 *    массив нь БҮГДИЙГ хаана.  Тэр учраас ажилтанд бодит жагсаалтыг
 *    уншина.
 */
export async function resolveProjectIds(env: Env, identity: AiIdentity): Promise<number[]> {
  if (identity.userId === null) return [];

  if (identity.role === 'client') {
    return clientProjectIds(env.DB, identity.userId);
  }

  // ⚠️ Админ нь `visibility.ts`-д хамрах хүрээгүйгээр дамждаг тул энэ
  //    query-г алгасаж, нэг D1 дуудлага хэмнэнэ.
  if (identity.role !== null && isAdminRole(identity.role)) return [];

  const { results } = await env.DB.prepare(
    `SELECT DISTINCT p.id
       FROM projects p
      WHERE p.status = 'active'
        AND COALESCE(p.asr_only, 0) = 0`,
  ).all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

export async function resolveViewer(env: Env, identity: AiIdentity): Promise<Viewer> {
  const projectIds = await resolveProjectIds(env, identity);
  let orgId: number | null = null;
  if (identity.role === 'client' && identity.userId !== null) {
    const orgs = await clientOrgIds(env.DB, identity.userId);
    orgId = orgs[0] ?? null;
  }
  return {
    mode: identity.mode,
    role: identity.role,
    userId: identity.userId,
    projectIds,
    orgId,
  };
}

/**
 * Асуулт нь НОРМ/СТАНДАРТЫН тухай эсэх.
 *
 * ⚠️ Энэ нь ЭШЛЭЛИЙН ЗААВАЛ дүрмийг асаадаг тул ХЭТ ӨРГӨН барих нь ЗӨВ
 *    тал руу алдана: норм биш асуултыг норм гэж үзвэл хамгийн муудаа
 *    хариу «эргэлзээтэй» болно, харин эсрэгээр нь алдвал эшлэлгүй дүрэм
 *    батлагдана.
 *
 * ⚠️ 2026-09-10: ӨӨРИЙН жагсаалтгүй болов — `intent.ts`-ийн
 *    `isNormativeQuestion` нь ЦОРЫН ГАНЦ эх сурвалж (түлхүүр үг +
 *    тэмдэглэгээ + латин галигийн хэвийжүүлэлт).  Хоёр жагсаалт нь зөрж
 *    «санаагаар норм, гэрээгээр норм биш» гэсэн зөрүү үүсгэж байсан.
 */
export function looksRegulatory(question: string): boolean {
  return isNormativeQuestion(question);
}
