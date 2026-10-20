/* =============================================================
 * ruleApplicability.ts — §61-ийн ХАМААРЛЫН ХӨДӨЛГҮҮР (цэвэр TS тал).
 * -------------------------------------------------------------
 * ⚠️ ХОС ФАЙЛ: `revit-mcp/addin/RuleEngine.cs`.  §61-ийн предикат ХОЁР ХЭЛ
 * ДЭЭР ХОЁР УДАА бичигдэж байгаа бөгөөд тэдгээрийг тэнцүү байлгах юу ч
 * БАЙХГҮЙ — цорын ганц харуул нь `revit-mcp/training/check_rules.py --parity`.
 *
 * ХАМТ ЗӨӨГДӨХ ЁСТОЙ:
 *   • `HIGH_RISE_HEIGHT_M = 51`, `HIGH_RISE_STORIES = 16`
 *   • дөрвөн хаалга (51м/16 давхар · 30м · 21 давхар · 15 давхар)
 *   • `Applicability`-ийн гурван `kind`
 *   • `reason` мөрийн үгсийн сан (high_rise_gate · boundary_location ·
 *     category · name · context · exception:<code>)
 *   • `missing[]`-ийн түлхүүрийн нэрс (БҮТЭН, угтвартай, ordinal эрэмбэлсэн)
 *
 * ⚠️ АЖИЛЛАХ ҮЕД C# ТАЛ ШИЙДНЭ (`rule_pack_versions` нь төслийн контекст
 * агуулдаггүй тул сервер хамаарлыг урьдчилж хэрэгжүүлж ЧАДАХГҮЙ), харин
 * `2-7`-ийн `rule_run_ledger.skipped_reason` ХҮЛЭЭЛТ нь ЭНЭ талаас
 * тооцогдоно.  Зөрвөл: клиент дүрмийг алгасах, сервер ажилласан гэж тоолох —
 * хаалга НОГООН, шалгалт ХИЙГДЭЭГҮЙ.
 *
 * ⚠️ Autodesk.Revit-ийн ямар ч төрөл, D1 дуудлага БАЙХГҮЙ.  Оролт нь POCO.
 * ============================================================= */

import {
  TRI_FALSE,
  TRI_TRUE,
  TRI_UNKNOWN,
  evaluateNode,
  type Applicability,
  type ApplicabilityReason,
  type BuildContext,
  type CheckNode,
  type FactBag,
  type LeafNode,
  type PredicateNode,
  type RuleDef,
  type Tri,
} from './complianceModel';

/* ================================================================== */
/*  1. ДӨРВӨН ХААЛГА — §3.6                                            */
/* ================================================================== */

/**
 * БАРИМТЫН БАГЦЫГ нээх канон предикат.
 * Эх сурвалж: `generalTemplate.ts:86` — «Онцгой: 51м-ээс дээш эсвэл 16
 * давхраас дээш барилга.»
 *
 * ⚠️ ЭНЭ НЬ БАРИМТЫН БАГЦЫГ л нээнэ.  `is_high_rise` ГЭСЭН ГАНЦ БУЛЬ
 * БАЙХГҮЙ, БАС БАЙЖ БОЛОХГҮЙ — доорх дөрөв нь ДӨРВӨН ӨӨР хаалга.
 */
export const HIGH_RISE_HEIGHT_M = 51;
export const HIGH_RISE_STORIES = 16;

/** BB — салхины резонансын шалгалт заавал (`bb/template.ts:309`). */
export const WIND_RESONANCE_HEIGHT_M = 30;
/** BB — бүрэн цутгамал ЗӨВЛӨМЖ.  ⚠️ НОРМ БИШ, хурлын шийдвэр
 *  (`bb/template.ts:173`) → `issue_class = 'TEAM_STANDARD'`, `document_uid = NULL`. */
export const CAST_IN_PLACE_STORIES = 21;
/** HD — гар утасны сүлжээ өргөгч (`hd/template.ts:101`). */
export const NETWORK_REPEATER_STORIES = 15;

/**
 * ⚠️ `null` = UNCERTAIN, `false` БИШ.  NULL нь «мэдэхгүй», «үгүй» БИШ —
 * чимээгүй PASS нь R2-ийн хамгийн муу уналт.
 */
export function opensHighRiseDocumentSet(ctx: {
  readonly heightM?: number | null;
  readonly storiesAboveGrade?: number | null;
}): boolean | null {
  const h = ctx.heightM ?? null;
  const s = ctx.storiesAboveGrade ?? null;
  if (h == null && s == null) return null;
  if (h != null && h > HIGH_RISE_HEIGHT_M) return true;
  if (s != null && s > HIGH_RISE_STORIES) return true;
  return false;
}

/* ================================================================== */
/*  2. `reason`-ийн ХААЛТТАЙ ЗУРАГЛАЛ — Хавсралт §9.1                  */
/* ================================================================== */

/**
 * Навчны баримтын нэр → `NOT_APPLICABLE.reason`.  ХААЛТТАЙ зураглал; энэ
 * функц нь `RuleEngine.cs`-ийн `ReasonForFact`-тай ЯГ таарна (P5–P8 fixture).
 */
export function applicabilityReasonForFact(fact: string): ApplicabilityReason {
  if (fact === 'project.height_m' || fact === 'project.stories_above_grade') {
    return 'high_rise_gate';
  }
  if (fact === 'doc.room_boundary_location') return 'boundary_location';
  if (fact === 'element.category') return 'category';
  if (fact === 'element.name_folded') return 'name';
  if (fact.startsWith('project.') || fact.startsWith('doc.')) return 'context';
  return 'category';
}

/**
 * ШИЙДСЭН ХУДАЛ НАВЧ — ЗӨВХӨН `reason` гаргахад.
 *
 * ⚠️ Энэ нь Хавсралт §5.7-ийн `decidingLeaf`-ЭЭС ӨӨР.  §5.7 нь БОСГО
 * тайлагнахад (`ObservedValue`/`ThresholdValue`) зориулагдсан тул `any`
 * зангилаа ХУДАЛ болоход `null` буцаадаг.  Гэтэл P2 fixture
 * (`height_m = 51` ЯГ) нь `any[height gt 51, stories gt 16]` бүхэлдээ ХУДАЛ
 * болох замаар `reason='high_rise_gate'` шаарддаг.  Тиймээс `any` ХУДАЛ
 * үед бүх хүүхэд ХУДАЛ гэдгийг ашиглаж ЭХНИЙХИЙГ нь авна.
 * `null` нь ЭНД тайлагнах боломжгүй гэсэн үг биш — `all`/`any` хоёулаа
 * ХУДАЛ болоход ҮРГЭЛЖ навч руу хүрнэ.
 */
function decisiveFalseLeaf(node: CheckNode, bag: FactBag): LeafNode | null {
  const tri = evaluateNode(node, bag).tri;
  if (tri !== TRI_FALSE) return null;
  switch (node.kind) {
    case 'all': {
      for (const c of node.children) {
        const r = decisiveFalseLeaf(c, bag);
        if (r) return r;
      }
      return null;
    }
    case 'any': {
      // Бүх хүүхэд ХУДАЛ (max = False) — эхнийхийг нь ав.
      for (const c of node.children) {
        const r = decisiveFalseLeaf(c, bag);
        if (r) return r;
      }
      return null;
    }
    case 'not':
      return null;
    case 'cond': {
      const c = evaluateNode(node.cond, bag).tri;
      if (c === TRI_TRUE) return decisiveFalseLeaf(node.then, bag);
      if (c === TRI_FALSE) return decisiveFalseLeaf(node.otherwise, bag);
      return null;
    }
    default:
      return node;
  }
}

/* ================================================================== */
/*  3. ХАМААРЛЫН ҮНЭЛГЭЭ — §3.6 ба Хавсралт §9.1                       */
/* ================================================================== */

/**
 * ⚠️ СПЕКИЙН ЗӨРҮҮГ ЭНД ШИЙДЭВ (ил бичив, чимээгүй сонголт БИШ).
 *
 * Хавсралт §9.1-ийн үнэлгээний дараалал нь 2-р алхмыг «`requiresContext`-ийн
 * аль нэг нэр Missing бол ШУУД UNCERTAIN» гэж бичсэн.  Гэтэл эцэг спекийн
 * §3.13.1-ийн **P4** fixture (`height_m = null`, `stories = 17`) нь
 * **APPLICABLE** байхыг шаарддаг — тэр дүрмийн `requires_context` нь
 * `["project.height_m","doc.room_boundary_location"]` (§3.7).  Хоёр шаардлага
 * НЭГ ЗЭРЭГ биелэх БОЛОМЖГҮЙ.
 *
 * ШИЙДЭВ: `requiresContext` нь UNCERTAIN-ы **ШАЛТГААНЫГ НЭРЛЭНЭ**, харин
 * UNCERTAIN болохыг ӨӨРӨӨ ШИЙДЭХГҮЙ.  Дараалал:
 *   1. `exceptions[]` — аль нэг нь True → `NOT_APPLICABLE("exception:"+code)`
 *   2. `applicability` Kleene:
 *        True    → APPLICABLE
 *        False   → NOT_APPLICABLE(шийдсэн худал навчнаас гарсан reason)
 *        Unknown → UNCERTAIN(missing = requiresContext ∩ Missing, эс бөгөөс
 *                            шийдэгдээгүй навчнуудын нэрс)
 *
 * Энэ уншлагаар P1–P8 БҮГД зэрэг биелнэ; §9.1-ийн шууд уншлагаар P4 унана.
 * ⚠️ `RuleEngine.cs` нь ЯГ ЭНЭ дарааллыг хэрэгжүүлнэ.
 */
export function evaluateApplicability(
  rule: RuleDef,
  ctx: BuildContext,
  facts: FactBag,
): Applicability {
  void ctx; // контекст нь `facts`-аар дамжина (`createFactBag`) — гарын үсгийг §3.6-аас хадгалав.

  // 1. Үл хамаарах зүйл — контекст дутуу байхад Ч хүчинтэй, тиймээс ЭХЛЭЭД.
  const firedCodes: string[] = [];
  for (const ex of rule.exceptions) {
    if (evaluateNode(ex.when, facts).tri === TRI_TRUE) firedCodes.push(ex.code);
  }
  if (firedCodes.length > 0) {
    firedCodes.sort();
    return { kind: 'NOT_APPLICABLE', reason: `exception:${firedCodes[0]!}` };
  }

  // 2. `applicability == null` (`{}`) = ҮРГЭЛЖ ХАМААРНА (Хавсралт §5.6).
  const node: PredicateNode | null = rule.applicability;
  if (!node) return { kind: 'APPLICABLE' };

  const evaluated = evaluateNode(node, facts);
  const tri: Tri = evaluated.tri;
  if (tri === TRI_TRUE) return { kind: 'APPLICABLE' };

  if (tri === TRI_FALSE) {
    const leaf = decisiveFalseLeaf(node, facts);
    const reason: string = leaf ? applicabilityReasonForFact(leaf.fact) : 'context';
    return { kind: 'NOT_APPLICABLE', reason };
  }

  // Unknown → UNCERTAIN.  `missing[]` нь БҮТЭН нэрс, ordinal эрэмбэлсэн.
  const unresolved = new Set(evaluated.unknownFacts);
  const declared = rule.requiresContext.filter((n) => unresolved.has(n));
  const missing = (declared.length > 0 ? declared : [...unresolved]).slice().sort();
  return { kind: 'UNCERTAIN', missing };
}

/* ================================================================== */
/*  4. `mayApply` — ХЯМД УРЬДЧИЛСАН ШҮҮЛТ (Хавсралт §4.5)              */
/* ================================================================== */

export interface MayApplyResult {
  readonly mayApply: boolean;
  /** ЗӨВХӨН тодорхой ХУДАЛ үед бичигдэнэ. */
  readonly skipReason: string | null;
}

/**
 * `RuleApplicability.MayApply`-ийн TS хос — `FactBag`-ийн ХЭСЭГЧИЛСЭН
 * хувилбар дээр (Revit уншихаас ӨМНӨ) ажиллана.
 *
 * ⚠️ МОНОТОН БАЙХ ЁСТОЙ: `False` үед Л `false` буцаана; `Unknown` үед `true`.
 * «`Unknown → false`» гэж бичих нь энэ хөдөлгүүрийн ХАМГИЙН ХЯЛБАР, ХАМГИЙН
 * ХОР ХӨНӨӨЛТЭЙ АЛДАА: `element.name_folded` нь `collect_rule_inputs`-ээс Л
 * ирдэг тул урьдчилсан шүүлтийн үед ҮРГЭЛЖ `Missing` — түүнийг «хамаарахгүй»
 * гэж уншвал дүрэм НЭГ Ч УДАА ажиллахгүй, ledger цэвэр харагдана, `2-7`-ийн
 * хаалга НОГООН болно, шалгалт нь ХИЙГДЭЭГҮЙ.
 */
export function mayApply(rule: RuleDef, partial: FactBag): MayApplyResult {
  const node = rule.applicability;
  if (!node) return { mayApply: true, skipReason: null };
  const tri = evaluateNode(node, partial).tri;
  if (tri !== TRI_FALSE) return { mayApply: true, skipReason: null };
  const leaf = decisiveFalseLeaf(node, partial);
  return {
    mayApply: false,
    skipReason: leaf ? applicabilityReasonForFact(leaf.fact) : 'context',
  };
}

/** `TRI_UNKNOWN`-ыг экспортод үлдээв — паритетын тест дугаарыг шууд шалгана. */
export const TRI_UNKNOWN_EXPORT = TRI_UNKNOWN;
