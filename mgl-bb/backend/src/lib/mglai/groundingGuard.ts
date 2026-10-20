/**
 * MGL AI · ҮНДЭСЛЭЛИЙН ХААЛГА (grounding guard) — tfc-1 гэрээний ДАРААХ давхарга.
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА (Session C, 2026-09-11, ХЭМЖИГДСЭН).
 *    `buildTrustedContract` нь ЗӨВХӨН 7 хэрэгслийн баримтыг таньдаг
 *    (`factsFromTools`).  Бусад бүх тохиолдолд гэрээ `free/low`,
 *    `allowedNumbers = null` болж, validator ЮУ Ч шалгадаггүй.  Дөрвөн
 *    репродукц (probe-contract):
 *
 *      1. COMPANY_FACT + хэрэгсэл 0  → «120 даалгавар, 15 хоцорсон» зөрчилгүй өнгөрөв
 *      2. list_projects `ok:false`   → «24 идэвхтэй төсөл» АМЬД мэт өнгөрөв
 *      3. query_entities үр дүнтэй   → «87 ажилтан» (мөр 2) зөрчилгүй өнгөрөв
 *      4. REVIT_READ контекстгүй     → «45.6 м²» зөрчилгүй өнгөрөв
 *
 *    Эдгээр нь мандатын §44 P0: «invented current company fact»,
 *    «runtime error shown as confident answer».
 *
 * ⚠️ ЗӨВХӨН `free` ГЭРЭЭГ ХӨНДӨНӨ.  Нормын салаа (authoritative / norm
 *    refusal / legal_review) нь Session A-ийн хүрээ — тэдгээр гэрээг ЭНД
 *    өөрчлөхгүй.  Энэ давхарга нь «гэрээгүй үлдсэн» ERP/Revit асуултад л
 *    гэрээ өгнө.
 *
 * ⚠️ ХЭЛНИЙ ЗАГВАР БИШ, ДЕТЕРМИНИСТ.  Загварын дуулгавартай байдалд
 *    найдахгүй: `requiredSentence` заавал орно, `allowedNumbers = []` бол
 *    тоотой өгүүлбэр бүр хасагдана (validator D/B).
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — тестлэгдэнэ (`groundingGuard.test.ts`).
 */
import type { ToolOutcome } from './promptFrame';
import { numbersInData, type TrustedContract, type TrustedFact } from './trustedFacts';

/** Компанийн системээс өгөгдөл ирээгүй — тоо, нэр хэлэхгүй. */
export const ERP_NO_DATA_MN =
  'Энэ асуултад компанийн системээс өгөгдөл татагдаагүй тул баталгаатай тоо, нэр хэлэх боломжгүй.';
export const ERP_NO_DATA_EN =
  'No data was fetched from the company system for this question, so I cannot give verified numbers or names.';

/** Хэрэгсэл дуудагдсан ч УНАСАН — хуучин/санахуйн тоог амьд мэт хэлэхгүй. */
export const ERP_UNAVAILABLE_MN =
  'Компанийн системээс амьд өгөгдөл татаж чадсангүй тул одоогийн тоо, нэр хэлэх боломжгүй.';
export const ERP_UNAVAILABLE_EN =
  'Live company data could not be fetched, so I cannot state current numbers or names.';

/** Revit контекст ирээгүй — элемент, хэмжээ зохиохгүй. */
export const REVIT_NO_CONTEXT_MN =
  'Revit-ийн контекст энэ ярианд ирээгүй тул загварын элемент, хэмжээг хэлэх боломжгүй.';
export const REVIT_NO_CONTEXT_EN =
  'No Revit context reached this conversation, so I cannot state model elements or quantities.';

/** ERP хэрэгсэл ЗААВАЛ шаарддаг санаанууд (`intent.ts` POLICIES.needsErpTools). */
const ERP_INTENTS: ReadonlySet<string> = new Set(['COMPANY_FACT', 'ERP_ANALYSIS']);
const REVIT_INTENTS: ReadonlySet<string> = new Set(['REVIT_READ', 'REVIT_ACTION']);

export interface GroundingGuardInput {
  intent: string;
  toolResults: readonly ToolOutcome[];
  /** Revit-ийн бүтэцтэй контекст эсвэл хураангуй ИРСЭН эсэх. */
  revitContextPresent: boolean;
  responseLanguage: 'mn-Cyrl' | 'en';
}

/** Хэрэгслийн үр дүнг хүнд уншигдах, ХАМГИЙН БОГИНО детерминист хэлбэрээр. */
export function renderToolBox(results: readonly ToolOutcome[], lang: 'mn-Cyrl' | 'en'): string {
  const head = lang === 'en' ? 'Company system results:' : 'Компанийн системийн үр дүн:';
  const lines = results.map((r) => {
    let payload = '';
    try {
      payload = JSON.stringify(r.data ?? null);
    } catch {
      payload = '(?)';
    }
    return `• ${r.tool}: ${payload.length > 400 ? `${payload.slice(0, 400)}…` : payload}`;
  });
  return [head, ...lines].join('\n');
}

function statusFact(id: string, value: string, mn: string, en: string): TrustedFact {
  return { id, kind: 'status', value, labelMn: mn, labelEn: en, authority: 'permission', mustMention: false };
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  `free` гэрээг шалгаж, шаардлагатай бол ХАТУУ гэрээ болгоно.
 * Ямар ч өөрчлөлт хэрэггүй бол ИЖИЛ объектыг буцаана.
 */
export function applyGroundingGuard(contract: TrustedContract, input: GroundingGuardInput): TrustedContract {
  // Нормын салааны гэрээг хөндөхгүй — зөвхөн «гэрээгүй үлдсэн» тохиолдол.
  if (contract.answerMode !== 'free') return contract;

  const lang = input.responseLanguage;
  const okResults = input.toolResults.filter((r) => r.ok);
  const failed = input.toolResults.filter((r) => !r.ok);

  const refuse = (sentence: string, id: string, mn: string, en: string, reason: string): TrustedContract => ({
    ...contract,
    answerMode: 'refusal',
    // ⚠️ high → хөтөч батлагдтал ХАРУУЛАХГҮЙ (§36): зохиомол тоо дэлгэц дээр
    //    анивчихгүй.
    risk: 'high',
    facts: [...contract.facts, statusFact(id, 'no_data', mn, en)],
    allowedNumbers: [],
    allowedCategories: contract.allowedCategories ?? [],
    requiredSentence: sentence,
    template: sentence,
    reason: `${contract.reason} · guard:${reason}`,
  });

  // 1. Revit асуулт, контекстгүй — ЭХЭНД: Revit санаанд ERP хэрэгсэл байдаггүй.
  if (REVIT_INTENTS.has(input.intent) && !input.revitContextPresent) {
    return refuse(
      lang === 'en' ? REVIT_NO_CONTEXT_EN : REVIT_NO_CONTEXT_MN,
      'revit_context',
      'Revit контекст алга',
      'No Revit context',
      'revit_no_context',
    );
  }

  // 2. Хэрэгсэл дуудагдсан ч БҮГД унасан — «амьд» тоо хэлэхгүй.
  if (failed.length > 0 && okResults.length === 0) {
    return refuse(
      lang === 'en' ? ERP_UNAVAILABLE_EN : ERP_UNAVAILABLE_MN,
      'erp_unavailable',
      'ERP өгөгдөл ирсэнгүй',
      'ERP data unavailable',
      'erp_all_tools_failed',
    );
  }

  // 3. Амжилттай хэрэгсэл байгаа ч `factsFromTools` баримт үүсгээгүй
  //    (query_entities, get_employee_activity, describe_system, …) — тоо
  //    ЗӨВХӨН хайрцгаас.
  if (okResults.length > 0) {
    const nums = new Set<number>();
    for (const r of okResults) numbersInData(r.data, nums);
    return {
      ...contract,
      answerMode: 'grounded',
      risk: contract.risk === 'low' ? 'medium' : contract.risk,
      allowedNumbers: [...nums],
      // ⚠️ Загвар ХОЁР удаа зөрчвөл хөтөч `template`-ийг харуулна (§39).
      //    Template байхгүй бол хариулт ХООСОН болно (хэмжсэн: бүх өгүүлбэр
      //    хасагдахад `fallbackAnswer` = '') — тиймээс хэрэгслийн бодит үр
      //    дүнг ДЕТЕРМИНИСТ хэлбэрээр өгнө: зохиомол биш, дутуу ч биш.
      template: contract.template ?? renderToolBox(okResults, lang),
      reason: `${contract.reason} · guard:grounded_by_tool_box`,
    };
  }

  // 4. ERP санаа атлаа хэрэгсэл ОГТ төлөвлөгдөөгүй (чиглүүлэлтийн алдаа) —
  //    загвар санахуйгаас компанийн тоо зохиох зам.  Тоо хориглоно.
  if (ERP_INTENTS.has(input.intent)) {
    return refuse(
      lang === 'en' ? ERP_NO_DATA_EN : ERP_NO_DATA_MN,
      'erp_no_data',
      'ERP өгөгдөл татагдаагүй',
      'No ERP data fetched',
      'erp_intent_without_tools',
    );
  }

  // 5. НОТОЛГООГҮЙ ЧӨЛӨӨТ ХАРИУЛТ (ерөнхий тусламж, баримт боловсруулах, тооцоо) — норм, эшлэл ЗОХИОХГҮЙ (2026-09-23).
  //    Эзний HL10: норм гэж танигдаагүй асуултад загвар «Норм дүрэм: … (Гэрлийн гэрээтэй барилгын зураг төслийн
  //    зохиогчидын удирдамж, 2019; 7-р битүүлэг)» гэж БАЙХГҮЙ баримт эшилсэн — `free` гэрээ validator-ыг бүрэн
  //    алгасдаг байв.  Одоо: тоо ХӨНДӨХГҮЙ (`allowedNumbers: null` — ерөнхий хариултад тоо байж болно), харин
  //    нормын код + «…-ийн дагуу/заасан» (`noMatch` → FAKE_CITATION) ба нормын эшлэлийн хэллэгтэй өгүүлбэр хасагдана.
  //    Бүгд хасагдвал доорх шударга template.  Шошго өөрчлөгдөхгүй — эдгээр санаанд `showConfidenceBadge: false`.
  if (FREE_GUARDED_INTENTS.has(input.intent)) {
    return {
      ...contract,
      answerMode: 'grounded',
      allowedNumbers: null,
      noMatch: true,
      forbiddenPhrases: [...contract.forbiddenPhrases, ...NORM_CLAIM_PHRASES],
      template: contract.template ?? (lang === 'en' ? FREE_FALLBACK_EN : FREE_FALLBACK_MN),
      reason: `${contract.reason} · guard:free_no_norm_claims`,
    };
  }

  return contract;
}

const FREE_GUARDED_INTENTS: ReadonlySet<string> = new Set(['GENERAL_HELP', 'DOCUMENT_ANALYSIS', 'CALCULATION']);

/** Нормын ЭШЛЭЛИЙН хэллэг — нотолгоогүй хариултад эдгээртэй өгүүлбэр ЗОХИОМОЛ эшлэл. */
const NORM_CLAIM_PHRASES: readonly string[] = [
  'норм дүрэм:', 'нормын дагуу', 'стандартын дагуу', 'дүрмийн дагуу', 'дүрэмд заасан', 'нормд заасан', 'нормоор заасан',
  'заалтад заасан', 'заалтын дагуу', 'удирдамж', 'according to the code', 'the standard requires', 'the code requires',
];

const FREE_FALLBACK_MN =
  'Энэ асуултад эх сурвалжтай хариулт өгөх мэдээлэл надад алга. Барилгын норм асууж байгаа бол нормын нэр эсвэл барилгын төрлөө нэмж асуугаарай.';
const FREE_FALLBACK_EN =
  'I have no sourced information to answer this. If you are asking about a building code, add the code name or the building type.';
