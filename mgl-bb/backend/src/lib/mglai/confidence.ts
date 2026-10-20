/**
 * MGL AI · ИТГЭЛИЙН ТӨЛӨВ (§27) ба ЭШЛЭЛ (§28).
 *
 * ⚠️ ХУУРАМЧ ТОО ХОРИОТОЙ.  «97.3% итгэлтэй» гэдэг нь калибровкогүй
 *    LLM-ийн хувьд УТГАГҮЙ ба хэрэглэгчийг төөрөгдүүлнэ.  Тиймээс
 *    гаралт нь ДӨРВӨН ТӨЛӨВ: verified / supported / uncertain /
 *    insufficient.  Тоо нь зөвхөн дотоод оношилгоонд.
 *
 * ⚠️ МЭРГЭЖЛИЙН НОРМД ЭХ СУРВАЛЖ НЬ ЗАГВАРЫН ИТГЭЛЭЭС ЧУХАЛ.  Тиймээс
 *    `verified` нь ЗӨВХӨН баталгаажсан заалттай (0221-ийн
 *    `CLAUSE_CITED` эсвэл `HUMAN_VERIFIED`) нотолгооноос гарна.  Загвар
 *    хэчнээн итгэлтэй сонсогдсон ч энэ төлөвийг өөрөө өгч ЧАДАХГҮЙ.
 *
 * ⚠️ ЭШЛЭЛ НЬ СЕРВЕР ДЭЭР ДАХИН ШИЙДЭГДЭНЭ.  Загварын гаргасан эшлэлийг
 *    шууд харуулах нь ХУУРАМЧ ЭШЛЭЛ (§48-ийн «forged citations») рүү
 *    хөтөлнө.  `resolveCitations` нь зөвхөн БОДИТООР өгөгдсөн нотолгооны
 *    id-г таньж, бусдыг ХАЯНА.
 */
import type { Evidence } from './visibility';

export const CONFIDENCE_STATES = ['verified', 'supported', 'uncertain', 'insufficient'] as const;
export type ConfidenceState = (typeof CONFIDENCE_STATES)[number];

/** 0221-ийн `rules.verification_state`-тэй ЯГ ижил гурван утга. */
export type VerificationState = 'UNVERIFIED' | 'CLAUSE_CITED' | 'HUMAN_VERIFIED';

export interface ConfidenceInput {
  /** Шүүлтээс АМЬД гарсан нотолгоо. */
  evidence: readonly Evidence[];
  /** Заалт бүхий нотолгооны баталгаажилтын төлөв. */
  verificationStates: readonly VerificationState[];
  /** Хэрэгслийн дуудлага бүгд амжилттай болсон эсэх. */
  toolsOk: boolean;
  /**
   * АМЖИЛТТАЙ ажилласан хэрэгслийн ТОО.
   *
   * ⚠️ `toolsOk` ГАНЦААРАА ХАНГАЛТГҮЙ.  Тэр нь «унасан хэрэгсэл байхгүй»
   *    гэсэн утгатай бөгөөд ХЭРЭГСЭЛ ОГТ ДУУДААГҮЙ үед ч `true` байна.
   *    Тиймээс нотолгоо ч, хэрэгсэл ч байхгүй хариу «Нотолгоотой» гэж
   *    тэмдэглэгдэж, дэлгэц дээр «эх сурвалж олдсонгүй» гэсэн текстийн
   *    ХАЖУУД зөрчилтэй харагдаж байв (2026-09-08-нд хэрэглэгч мэдэгдсэн).
   */
  toolCount?: number;
  /** Асуулт нь норм/стандартын тухай эсэх. */
  regulatory: boolean;
  /** Нотолгоонууд хоорондоо зөрчилдөж байгаа эсэх (хүн эсвэл дүрэм тэмдэглэсэн). */
  conflicting?: boolean;
  /** Өгөгдөл локал кэшээс ирсэн бол синкийн огноо. */
  staleSince?: string | null;
}

/**
 * ⚠️ ЦЭВЭР ФУНКЦ — тестээр бүрэн хаагдсан.
 *
 * Дараалал нь ЗОРИУД: хамгийн хатуу хязгаарлалт ЭХЭЛЖ шалгагдана.
 */
export function scoreConfidence(input: ConfidenceInput): ConfidenceState {
  if (input.evidence.length === 0) {
    // ⚠️ Нотолгоогүй үед `supported` болох ЦОРЫН ГАНЦ зам нь ХЭРЭГСЭЛ
    //    БОДИТООР ажиллаж өгөгдөл авчирсан байх.  ERP-ийн амьд өгөгдөл
    //    өөрөө нотолгоо — харин ЮУ Ч байхгүй бол «Нотолгоотой» гэж
    //    хэлэх нь ХУДАЛ.
    const usedTools = (input.toolCount ?? 0) > 0;
    if (!input.regulatory && input.toolsOk && usedTools) return 'supported';
    return 'insufficient';
  }

  if (input.conflicting) return 'uncertain';
  if (!input.toolsOk) return 'uncertain';

  if (input.regulatory) {
    const anyVerified = input.verificationStates.some(
      (s) => s === 'CLAUSE_CITED' || s === 'HUMAN_VERIFIED',
    );
    // ⚠️ БҮХ дүрэм өнөөдөр UNVERIFIED (0221-ийн зорилго).  Тиймээс
    // нормын асуулт нь бодит баримт ирэх хүртэл ХЭЗЭЭ Ч `verified`
    // болохгүй — энэ нь алдаа биш, төлөвлөсөн зан төлөв.
    if (!anyVerified) return 'uncertain';
    return input.staleSince ? 'supported' : 'verified';
  }

  return input.evidence.length >= 2 ? 'supported' : 'uncertain';
}

/** UI-д харуулах шошго.  Тоо ХЭЗЭЭ Ч биш. */
export const CONFIDENCE_LABEL_MN: Record<ConfidenceState, string> = {
  verified: 'Баталгаажсан',
  supported: 'Нотолгоотой',
  uncertain: 'Эргэлзээтэй',
  insufficient: 'Нотолгоо хүрэлцэхгүй',
};

export const CONFIDENCE_LABEL_EN: Record<ConfidenceState, string> = {
  verified: 'Verified',
  supported: 'Supported',
  uncertain: 'Uncertain',
  insufficient: 'Insufficient evidence',
};

export interface Citation {
  id: string;
  kind: Evidence['kind'];
  title: string;
  documentUid?: string | null;
  clauseUid?: string | null;
  page?: number | null;
  section?: string | null;
}

/**
 * Загварын нэрлэсэн id-уудыг БОДИТ нотолгоотой тулгана.
 *
 * ⚠️ Танихгүй id нь ЧИМЭЭГҮЙ хаягдана — хэрэглэгчид харагдахгүй.
 *    Буцаах утга нь `dropped` -ыг агуулах тул дуудагч тэднийг
 *    оношилгооны логт бичиж чадна: загвар эшлэл ЗОХИОЖ эхэлбэл тэр нь
 *    хэмжигдэх ёстой үзүүлэлт.
 */
export function resolveCitations(
  claimedIds: readonly string[],
  evidence: readonly Evidence[],
): { citations: Citation[]; dropped: string[] } {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const citations: Citation[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();

  for (const id of claimedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = byId.get(id);
    if (!e) {
      dropped.push(id);
      continue;
    }
    citations.push({
      id: e.id,
      kind: e.kind,
      title: e.title,
      documentUid: e.documentUid ?? null,
      clauseUid: e.clauseUid ?? null,
      page: e.page ?? null,
      section: e.section ?? null,
    });
  }
  return { citations, dropped };
}

/**
 * Хариултаас `[1]`, `[2]` хэлбэрийн эшлэлийн дугаарыг олж, нотолгооны
 * жагсаалтын байрлалаар нь id болгоно.
 *
 * ⚠️ Байрлал нь `renderEvidence`-ийн дугаарлалттай ЯГ таарна — тэр хоёр
 *    ХАМТ хөдөлнө.
 */
export function extractCitationIds(answer: string, evidence: readonly Evidence[]): string[] {
  const ids: string[] = [];
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const idx = Number(m[1]) - 1;
    const e = evidence[idx];
    if (e) ids.push(e.id);
  }
  return ids;
}

/**
 * §28 — нормын хариултад эшлэл ЗААВАЛ.  Эшлэлгүй бол хариултыг
 * үзүүлэхээс ӨМНӨ төлөвийг доошлуулна.
 */
export function enforceCitationRule(
  state: ConfidenceState,
  regulatory: boolean,
  citationCount: number,
): ConfidenceState {
  if (!regulatory) return state;
  if (citationCount > 0) return state;
  return state === 'insufficient' ? 'insufficient' : 'uncertain';
}
