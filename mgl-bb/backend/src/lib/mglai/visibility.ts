/**
 * MGL AI · НУУЦЛАЛЫН ШҮҮЛТ (§9, §49).
 *
 * ⚠️ ЭНЭ ФАЙЛЫН БҮХ УТГА НЭГ ӨГҮҮЛБЭРТ: нууцыг PROMPT УГСРАХААС ӨМНӨ
 *    хасна, загварт «битгий хэл» гэж хэлэхгүй.  §49 үүнийг шууд
 *    шаарддаг: «Do not simply retrieve everything and ask the model not
 *    to mention secrets.»
 *
 * ⚠️ ЗАГВАР ӨМНӨ НЬ ҮЗСЭН НЬ ЗӨВШӨӨРӨЛ БИШ.  Тиймээс динамик нууц
 *    баримт нь жинд ХЭЗЭЭ Ч ордоггүй ба энэ шүүлт нь ажиллах үеийн
 *    ГАНЦ хамгаалалт болно — өөр давхарга байхгүй тул энд гарсан алдаа
 *    нь шууд алдагдал.
 *
 * ⚠️ ХААЛТТАЙ-АНХДАГЧ.  Танихгүй `classification`, танихгүй
 *    `visibility_scope`, эвдэрсэн `allowed_roles_json` — бүгд ХАСАГДАНА,
 *    зөвшөөрөгдөхгүй.  `lib/clientScope.ts`-ийн цагаан жагсаалтын
 *    гүн ухаантай ижил.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ.  D1 хамааралгүй тул `node --test` дор бүрэн хэмжигдэнэ
 *    ба энэ нь ЗОРИУД: аюулгүй байдлын шийдвэрийг интеграцын тестээр
 *    бус, нэгжийн тестээр баталгаажуулна.
 */
import type { UserRole } from '../../types';
import type { AiMode } from './identity';

export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const VISIBILITY_SCOPES = ['public', 'company', 'project', 'org', 'owner'] as const;
export type VisibilityScope = (typeof VISIBILITY_SCOPES)[number];

/** Хайлтын нэг нэгж — эх сурвалж хамаарахгүйгээр ижил хэлбэртэй. */
export interface Evidence {
  /** Тогтвортой id — эшлэл дахин шийдэхэд хэрэглэгдэнэ. */
  id: string;
  kind: 'clause' | 'document' | 'chunk' | 'erp' | 'memory';
  title: string;
  text: string;
  classification: Classification;
  visibilityScope: VisibilityScope;
  /** Хоосон = «role-ээр хязгаарлаагүй», БҮХ role гэсэн үг БИШ. */
  allowedRoles: readonly UserRole[];
  projectId?: number | null;
  orgId?: number | null;
  ownerUserId?: number | null;
  /** Эшлэлийн мөшгих талбарууд. */
  documentUid?: string | null;
  clauseUid?: string | null;
  page?: number | null;
  section?: string | null;
  score?: number;
}

export interface Viewer {
  mode: AiMode;
  role: UserRole | null;
  userId: number | null;
  /** Тухайн хэрэглэгчийн хандаж болох төслүүд — ERP-ийн хаалтаас ирнэ. */
  projectIds: readonly number[];
  /** Захиалагчийн байгууллага. */
  orgId: number | null;
}

/**
 * Горим тус бүрийн ЗӨВШӨӨРӨГДӨХ ХАМГИЙН ӨНДӨР ангилал.
 *
 * ⚠️ `restricted` нь ХЭН Ч уншихгүй — тэр бол «AI-д огт өгөхгүй» гэсэн
 *    тэмдэг (гэрээ, цалин, хууль зүйн маргаан).  Админ ч биш: админд
 *    хэрэгтэй бол ERP-ийн жинхэнэ дэлгэцээр, AI-аар биш.
 */
const MAX_CLASSIFICATION: Record<AiMode, Classification | null> = {
  client: 'public',
  employee: 'confidential',
  admin: 'confidential',
  denied: null,
};

const CLASS_RANK: Record<Classification, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

function isClassification(v: unknown): v is Classification {
  return typeof v === 'string' && (CLASSIFICATIONS as readonly string[]).includes(v);
}

function isScope(v: unknown): v is VisibilityScope {
  return typeof v === 'string' && (VISIBILITY_SCOPES as readonly string[]).includes(v);
}

export type DropReason =
  | 'mode_denied'
  | 'classification_too_high'
  | 'unknown_classification'
  | 'unknown_scope'
  | 'role_not_allowed'
  | 'project_out_of_scope'
  | 'org_mismatch'
  | 'not_owner'
  | 'client_needs_public_scope';

export interface FilterOutcome {
  kept: Evidence[];
  dropped: { id: string; reason: DropReason }[];
}

/**
 * Нэг нотолгоо тухайн үзэгчид харагдах эсэх.  `null` = зөвшөөрөгдсөн.
 */
export function evidenceDropReason(e: Evidence, viewer: Viewer): DropReason | null {
  const cap = MAX_CLASSIFICATION[viewer.mode];
  if (cap === null) return 'mode_denied';

  if (!isClassification(e.classification)) return 'unknown_classification';
  if (!isScope(e.visibilityScope)) return 'unknown_scope';

  if (CLASS_RANK[e.classification] > CLASS_RANK[cap]) return 'classification_too_high';

  // Захиалагч нь ЗӨВХӨН public хамрах хүрээ + өөрийн байгууллагын
  // материалыг харна.  «public ангилалтай ч company scope-той» мөр нь
  // захиалагчид ХҮРЭХГҮЙ — ангилал ба хамрах хүрээ ХОЁУЛАА таарах ёстой.
  if (viewer.mode === 'client') {
    if (e.visibilityScope === 'public') return null;
    if (e.visibilityScope === 'org') {
      return viewer.orgId != null && e.orgId === viewer.orgId ? null : 'org_mismatch';
    }
    if (e.visibilityScope === 'project') {
      return e.projectId != null && viewer.projectIds.includes(e.projectId)
        ? null
        : 'project_out_of_scope';
    }
    return 'client_needs_public_scope';
  }

  if (e.allowedRoles.length > 0) {
    if (viewer.role === null || !e.allowedRoles.includes(viewer.role)) return 'role_not_allowed';
  }

  switch (e.visibilityScope) {
    case 'public':
    case 'company':
      return null;
    case 'project':
      if (e.projectId == null) return 'project_out_of_scope';
      // Админ нь компанийн БҮХ төслийг харна — ERP-ийн одоогийн зан төлөв.
      if (viewer.mode === 'admin') return null;
      return viewer.projectIds.includes(e.projectId) ? null : 'project_out_of_scope';
    case 'org':
      return viewer.mode === 'admin' ? null : 'org_mismatch';
    case 'owner':
      return viewer.userId != null && e.ownerUserId === viewer.userId ? null : 'not_owner';
    default:
      return 'unknown_scope';
  }
}

/**
 * ⚠️ PROMPT УГСРАХААС ӨМНӨ дуудагдах ЦОРЫН ГАНЦ функц.  Хассан мөрийн
 * ШАЛТГААНЫГ буцаана — чимээгүй алгасалт нь дибаг хийх боломжгүй ба
 * «яагаад олдсонгүй» гэсэн асуултад хариулж чадахгүй.
 */
export function filterEvidence(items: readonly Evidence[], viewer: Viewer): FilterOutcome {
  const kept: Evidence[] = [];
  const dropped: { id: string; reason: DropReason }[] = [];
  for (const e of items) {
    const reason = evidenceDropReason(e, viewer);
    if (reason === null) kept.push(e);
    else dropped.push({ id: e.id, reason });
  }
  return { kept, dropped };
}

/**
 * §17 — «загварт ХАМГИЙН БАГА хэрэгтэй нотолгоог өгнө».  Оноогоор
 * эрэмбэлж, тэмдэгтийн төсөвт багтаана.
 *
 * ⚠️ Шүүлтийн ДАРАА дуудагдана.  Урьдчилан таслах нь нууц мөрийг
 * төсвөөс шахаж, зөвшөөрөгдсөн мөрийг хасах эрсдэлтэй.
 */
export function budgetEvidence(items: readonly Evidence[], maxChars: number): Evidence[] {
  const ranked = [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const out: Evidence[] = [];
  /**
   * ⚠️ ДАВХАРДСАН НОТОЛГОО НЬ ЗАГВАРЫГ ДАВТАЛТ РУУ ТҮЛХДЭГ.
   *
   *    Хоёр хөл (локал нормын сан + D1) ижил заалтыг буцаах бүрэн
   *    боломжтой; мөн нэг баримтын хоёр хэсэг давхцсан текст агуулж
   *    болно.  Ижил догол мөр prompt-д хоёр удаа орох нь загварт «энэ
   *    хэллэгийг давт» гэсэн дохио өгдөг — давталтын гажгийн сонгодог
   *    хүчлэгч.
   *
   *    `id`-гаар шүүх нь ХАНГАЛТГҮЙ: локал хөл нь `local:` угтвартай
   *    тул ижил заалт ӨӨР id-тай ирнэ.  Тиймээс ТЕКСТЭЭР нь хэвийжүүлж
   *    харьцуулна.
   */
  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  let used = 0;
  for (const e of ranked) {
    if (seenIds.has(e.id)) continue;
    // Хоосон зай, тохирлыг хэвийжүүлээд эхний 400 тэмдэгтээр таних —
    // бүтэн текстийг түлхүүр болгох нь урт заалт дээр үнэтэй.
    const key = e.text.replace(/\s+/g, ' ').trim().slice(0, 400).toLowerCase();
    if (key.length > 0 && seenText.has(key)) continue;
    const cost = e.text.length + e.title.length + 32;
    if (used + cost > maxChars) continue;
    out.push(e);
    seenIds.add(e.id);
    if (key.length > 0) seenText.add(key);
    used += cost;
  }
  return out;
}
