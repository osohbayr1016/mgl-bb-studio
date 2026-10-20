/**
 * v2 §78 · СУРГАЛТЫН ХАМААРЛЫН ДАВХАРГА (2-6).
 *
 * v2 §78: «Not every observed action should train a model … Build an
 * explicit task/data relevance layer.»  ERP-д нэвтрэх нь сургалтын жишээ
 * БИШ; багажийн дуудлага нь дизайны шийдвэр БИШ.
 *
 * ⚠️ ЯАГААД `Record<LearningEventKind, …>` БҮРЭН БИЧЛЭГ ВЭ:
 *    `bimEvents.ts:224`-ийн `REQUIRED_PARTS_OF`-той ЯГ ИЖИЛ шалтгаанаар.
 *    `learning_events.kind` дээр DB CHECK ЗОРИУД ТАВИАГҮЙ (0205) — сая
 *    мөртэй append-only хүснэгтэд CHECK өөрчлөх нь ХҮСНЭГТИЙГ ДАХИН
 *    БАРИХЫГ шаардана.  Хаалттай багцыг ЭНД барина: шинэ `kind` нэмэхэд
 *    `tsc` УНАНА, чимээгүй «ямар нэгэн өгөгдмөл» рүү унахгүй.
 *    ⛔ `Partial<>` болгож БОЛОХГҮЙ — тэр агшинд шинэ үйл явдал чимээгүй
 *    сургалтад орно.
 *
 * ⚠️ ЭНД БОДЛОГО БАЙНА, SQL ШҮҮЛТ БИШ.  Сургалтад тэнцэх мөрийн ЦОРЫН
 *    ГАНЦ SQL шүүлт нь `bimEvents.ts:144`-ийн `DATASET_ELIGIBLE_SQL`
 *    (`parts_missing = 0`).  Өөрийн `WHERE` бичихийг ХОРИГЛОНО — тэр нь
 *    `parts_missing`-ийн бүх утгыг тойрч, дутуу нотолгоотой мөрийг
 *    корпуст оруулна.
 *
 * ⚠️ ЭНЭ ФАЙЛ АЖИЛЛАХ ҮЕИЙН ИМПОРТГҮЙ — `bimEvents`-ээс ЗӨВХӨН ТӨРӨЛ
 *    (`import type`) авна.  Тиймээс `node --test` доор `registerHooks`
 *    шаардахгүй шууд статик импортоор ачаалагдана.
 */
import type { LearningEventKind } from './bimEvents';

/**
 * `2-2`-ын `rules.verification_state`-ийн ХОС (twin) — гурвуулаа ХАМТ
 * хөдөлнө.  `complianceModel.ts`-ийн `isVerificationState` нь ИЖИЛ гурван
 * утгыг барина; тэднийг зөрүүлэх нь `RULE_VALIDATION`-ы цөмийн шийдвэрийг
 * ЧИМЭЭГҮЙ хоёр талд өөр болгоно.
 */
export const VERIFICATION_STATES = [
  'UNVERIFIED', 'CLAUSE_CITED', 'HUMAN_VERIFIED',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/**
 *  · `never`            — сургалтад ХЭЗЭЭ Ч орохгүй (ERP нэвтрэлт, tool дуудлага).
 *  · `evaluation_only`  — ҮНЭЛГЭЭ / сөрөг жишээ / нэмэгдүүлэлтэд л.
 *  · `core`             — сургалтын ЦӨМД орж болно (нэмэлт нөхцөл доор).
 */
export const RELEVANCE_VALUES = ['never', 'evaluation_only', 'core'] as const;
export type Relevance = (typeof RELEVANCE_VALUES)[number];

export type RelevanceSpec =
  | { readonly kind: 'fixed'; readonly relevance: Relevance; readonly why: string }
  | {
      readonly kind: 'by_verification';
      readonly coreWhen: readonly VerificationState[];
      readonly otherwise: Relevance;
      readonly why: string;
    };

/**
 * ⚠️ `RULE_VALIDATION` нь ТОГТМОЛ БИШ — ЭНЭ БОЛ ЭНЭ ФАЙЛЫН ХАМГИЙН
 *    АЧАА ДААДАГ ШИЙДВЭР.
 *
 *    `bimEvents.ts`-ийн `presentPartsForEvent` нь `payload_json`-д
 *    `rule_id` БА `passed` байвал `RULE_VERDICT` битийг тавьдаг.
 *    `REQUIRED_PARTS_OF.RULE_VALIDATION = ['RULE_VERDICT']` тул тэр мөрийн
 *    `parts_missing` нь 0 болж, `DATASET_ELIGIBLE_SQL`-д АВТОМАТААР
 *    тэнцэнэ.  Хэрэв бид `RULE_VALIDATION ⇒ core` гэж БОЛЗОЛГҮЙ буулгавал:
 *    `revit-mcp/CLAUDE.md:7-12` өөрөө «баталгаажаагүй зөвлөмжийн утга» гэж
 *    хүлээн зөвшөөрсөн 1200 мм босгоос гарсан зургаан долоо хоногийн
 *    WARNING нь хэдэн арван мянган тэнцэх мөр болж загварыг сургана.
 *    v2 §66-ийн худал эерэгийн хяналт үүнийг ИЛРҮҮЛЖ ЧАДАХГҮЙ — цорын
 *    ганц эх сурвалж нь ТЭР ЛЕ дүрэм.
 *
 *    ⛔ ХАМААРАЛ НЬ ҮЙЛ ЯВДЛЫН ТӨРЛӨӨС ГАНЦААР ШИЙДЭГДЭХГҮЙ.  Мөрийн
 *    ХӨЛДӨӨСӨН `verification_state` (0238-ын 7 дахь statement, GENERATED
 *    VIRTUAL) нь оролт.  `parts_missing`-ыг 0 болгодог хиймэл дагуулын бит
 *    нь БАТАЛГААЖААГҮЙ вердиктийг сургалтад ОРУУЛАХ ЁСГҮЙ — тийм учраас
 *    энэ салаа `by_verification`.
 */
export const TRAINING_RELEVANCE: Record<LearningEventKind, RelevanceSpec> = {
  // --- ХЭЗЭЭ Ч: телеметр, амьдралын мөчлөг, багажийн дуудлага ---
  SESSION_START: { kind: 'fixed', relevance: 'never', why: 'Амьдралын мөчлөг. v2 §78 «ERP login event -> not a training example».' },
  SESSION_END: { kind: 'fixed', relevance: 'never', why: 'Мөн адил.' },
  TOOL_INVOKED: { kind: 'fixed', relevance: 'never', why: 'Багажийн дуудлага нь дизайны шийдвэр БИШ.' },
  TOOL_RESULT: { kind: 'fixed', relevance: 'never', why: 'Мөн адил.' },

  // --- ЗӨВХӨН ҮНЭЛГЭЭ: машины гаралт, хүний баталгаагүй ---
  AI_PREDICTION: { kind: 'fixed', relevance: 'evaluation_only', why: 'v2 §42-R2: AI гаралтыг өөрийг нь сургах нь ХОРИОТОЙ өөрийгөө тэжээх гогцоо.' },
  AI_ACTION: { kind: 'fixed', relevance: 'evaluation_only', why: 'Мөн адил.' },
  USER_FEEDBACK: { kind: 'fixed', relevance: 'evaluation_only', why: 'Сайшаал/цоолт нь ШОШГО БИШ — курацийн дараалалын ЭРЭМБЭ (revit.ts-ийн ORDER BY CASE).' },
  TEXT: { kind: 'fixed', relevance: 'evaluation_only', why: 'Түүхий бичвэр — хүний баталгаагүй.' },
  IMAGE: { kind: 'fixed', relevance: 'evaluation_only', why: 'Мультимодал нь Track 2-ын хамрах хүрээнээс ГАДУУР.' },
  SKETCH: { kind: 'fixed', relevance: 'evaluation_only', why: 'Мөн адил.' },
  REVIT_STATE: { kind: 'fixed', relevance: 'evaluation_only', why: 'Загварын хэсгийн зураг — контекст, шошго БИШ.' },
  USER_ACTION: { kind: 'fixed', relevance: 'evaluation_only', why: 'Ажлын урсгалын дохио. Хүн юу ЗӨВ гэснийг хэлэхгүй.' },
  PROGRESS_REPORT: { kind: 'fixed', relevance: 'evaluation_only', why: 'Явцын хувь нь хүний хяналтын жагсаалтаас гардаг, загвараас БИШ.' },

  // --- ЦӨМ: хүний баталгаа БАЙНА ---
  HUMAN_CORRECTION: { kind: 'fixed', relevance: 'core', why: 'Хүн машиныг ЗАССАН — 0215-ын HUMAN_CORRECTED-ийн үйл явдлын хос.' },
  FINAL_APPROVAL: { kind: 'fixed', relevance: 'core', why: 'Хүн ЭЦСИЙН БАТАЛГАА өгсөн — эзний «senior-ийн баталсан ажил» гэдэг нь ЯГ ЭНЭ мөр.' },

  RULE_VALIDATION: {
    kind: 'by_verification',
    coreWhen: ['HUMAN_VERIFIED'],
    otherwise: 'evaluation_only',
    why: 'Дээрх анхааруулгыг үз. Баталгаажаагүй дүрмийн вердикт нь ГАЗАР ЗҮЙН ҮНЭН БИШ.',
  },
};

/** Мөрийн хөлдөөсөн контекст — `payload_json`-оос уншина, JOIN-оор БИШ. */
export interface RelevanceContext {
  /**
   * `learning_events.verification_state` — хөлдөөсөн, GENERATED VIRTUAL,
   * `0238`-ын 7 дахь statement.  Түүнийг БӨГЛӨХ нь `2-3`-ын вердиктийн
   * `payload_json` ба `2-4`-ийн эмиттерийн тамганы ажил (`team_code` /
   * `team_source` / `team_confidence` / `attribution_id`-ийн ХАЖУУД).
   * `null` = «мэдэхгүй» ⇒ `RULE_VALIDATION` нь `evaluation_only` болно.
   */
  readonly verificationState: VerificationState | null;
}

/** Нийт функц — `kind` бүрд утга буцаана, `undefined` БАЙХГҮЙ. */
export function relevanceOf(
  kind: LearningEventKind,
  ctx: RelevanceContext,
): Relevance {
  const spec = TRAINING_RELEVANCE[kind];
  if (spec.kind === 'fixed') return spec.relevance;
  if (ctx.verificationState === null) return spec.otherwise;
  return spec.coreWhen.includes(ctx.verificationState) ? 'core' : spec.otherwise;
}

/** Утга нь `VERIFICATION_STATES`-ийн гишүүн үү (хөлдөөсөн баганаас уншсаныг цэвэрлэнэ). */
export function isVerificationStateValue(v: unknown): v is VerificationState {
  return typeof v === 'string' && (VERIFICATION_STATES as readonly string[]).includes(v);
}

/**
 * Багийн оноолтын ЭХ СУРВАЛЖ — ЗӨВХӨН эдгээр нь БАТАЛГААЖСАН гэж тооцогдоно.
 * `lib/teamContext.ts`-ийн `TEAM_SOURCES`-ын дэд багц.
 *
 * ⚠️ v2 §73-R3: «Do not permanently train on unverified team attribution.»
 *    `sheet_prefix` ба `behavior` нь ЗӨВХӨН БАТАЛГААЖУУЛАГЧ шатууд —
 *    `teamContext.ts`-д тэднийг `CORROBORATING_SOURCES` гэж нэрлэдэг
 *    бөгөөд тэд ДАНГААРАА баг шийддэггүй, тиймээс ЭНД БАЙХГҮЙ.
 *    `project_shares` ба `user_primary` нь шийдвэрлэгч ч ТААМАГЛАЛ (хүн
 *    өөрийн үндсэн багийн БУС ажил хийж болно) тул мөн ЭНД БАЙХГҮЙ.
 */
export const VERIFIED_TEAM_SOURCES = ['binding', 'document', 'manual'] as const;
export type VerifiedTeamSource = (typeof VERIFIED_TEAM_SOURCES)[number];

export function isVerifiedTeamSource(s: string | null): s is VerifiedTeamSource {
  return s !== null && (VERIFIED_TEAM_SOURCES as readonly string[]).includes(s);
}

/**
 * СУРГАЛТАД ТЭНЦЭХ ЭСЭХ — БҮРЭН предикат.
 *
 * ⚠️ Нөхцөл 1 нь ЗААВАЛ SQL талд `DATASET_ELIGIBLE_SQL`-ээр хэрэгжинэ; энд
 *    зөвхөн ДАВТАН баталгаажуулна.  Үлдсэн нь мөрийн ӨӨРИЙН ХӨЛДӨӨСӨН
 *    талбараас шийдэгдэнэ — JOIN ХЭРЭГГҮЙ.  Энэ нь ЦОРЫН ГАНЦ зөв хэлбэр:
 *    `learning_events` нь append-only (0206) тул хожим засах БОЛОМЖГҮЙ, ба
 *    `bim_sessions` руу JOIN хийвэл v2 §73-ийн залруулга нь ХЭДЭН ЗУУН
 *    түүхэн мөрийн утгыг ЧИМЭЭГҮЙ өөрчилнө.
 *
 * ⚠️ «МЭДЭХГҮЙ» бол «ТЭНЦЭХГҮЙ».  Оролт дутуу бол `false`.
 */
export interface EligibilityInput {
  readonly kind: LearningEventKind;
  /** SQL: `DATASET_ELIGIBLE_SQL` (`parts_missing = 0`). */
  readonly partsMissing: number;
  /** Хөлдөөсөн — `learning_events.verification_state` (0238). */
  readonly verificationState: VerificationState | null;
  /** Хөлдөөсөн — `learning_events.team_source` (0219). */
  readonly teamSource: string | null;
  /** Хөлдөөсөн — `learning_events.team_code` (0219). */
  readonly teamCode: string | null;
  /** ӨНӨӨДРИЙН баталгаажсан баг — `team_attributions` (0218). */
  readonly currentVerifiedTeam: string | null;
  /** Дүрмийн багц НИЙТЛЭГДСЭН үү — `rule_pack_versions` (0223). */
  readonly packPublished: boolean;
  /**
   * ⚠️ ЭЗЭНГҮЙ ОРОЛТ.  «Хэн гар дээр байсан бэ» — хуваалцсан ажлын
   * станцын хамгаалалт (v2 §73-R3).  Track 2-т нэг ч док түүнийг
   * ГАРГАДАГГҮЙ; эзэн олдтол дуудагч `'unknown'` дамжуулах ба тэр нь
   * ӨНГӨРНӨ.  Талбарыг ОДООНООС үлдээв — хожим нэмэх нь БҮХ дуудагчийг
   * өөрчилнө.  ⛔ Тэр хамгаалалт өнөөдөр ХЭРЭГЖЭЭГҮЙ; блоклох ажлыг
   * нөхцөл 1-5 хийнэ.
   */
  readonly identityMatch: 'match' | 'mismatch' | 'unknown';
}

export function isCoreTrainingEligible(x: EligibilityInput): boolean {
  // 1 · SQL-ийн ЦОРЫН ГАНЦ тодорхойлолт (`DATASET_ELIGIBLE_SQL`).
  if (x.partsMissing !== 0) return false;
  // 2 · v2 §78-ийн хамаарлын давхарга — ХӨЛДӨӨСӨН verification_state-аас.
  if (relevanceOf(x.kind, { verificationState: x.verificationState }) !== 'core') return false;
  // 3 · v2 §73-R3 — баталгаажаагүй багийн оноолт дээр ХЭЗЭЭ Ч сургахгүй.
  if (!isVerifiedTeamSource(x.teamSource)) return false;
  // 4 · Хөлдөөсөн баг нь ӨНӨӨДРИЙН баталгаажсан багтай зөрвөл (§73-ийн
  //     залруулга гүйсэн) тэр мөр аль ч багийн нотолгоо БИШ.
  if (x.teamCode !== null && x.teamCode !== x.currentVerifiedTeam) return false;
  // 5 · Багц нийтлэгдээгүй бол вердикт нь хянагдаагүй логикийн үр дүн.
  //     ⚠️ Дүрмийн багцгүй баг (MGMT · EZ · GT) ЭНД ХААЛТТАЙ-ӨГӨГДМӨЛӨӨР
  //     зогсоно — тусдаа «MGMT-ийг хас» жагсаалт БИЧИХГҮЙ, тэр нь баг
  //     нэмэгдэх өдөр хуучирна.
  if (!x.packPublished) return false;
  // 6 · Эзэнгүй оролт: ЗӨВХӨН ил mismatch дээр татгалзана.
  if (x.identityMatch === 'mismatch') return false;
  return true;
}
