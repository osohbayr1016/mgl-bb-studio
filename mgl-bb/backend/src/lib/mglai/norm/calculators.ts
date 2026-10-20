/**
 * MGL AI · ТООЦООЛУУРЫН БҮРТГЭЛ (P0-6) — томьёо бүрд ИЛ TS хос, `eval` ҮГҮЙ.
 *
 * ⚠️ Тооцоолуур бүр бүртгэлийн ТОМЬЁОНЫ БИЧЛЭГЭЭР (formulaId) түлхүүрлэгдэнэ:
 *    provenance (хуудас, дугаар, баталгаажилт) тэндээс, тогтмол (0.64, 0.01,
 *    26, 11, 15) нь бичлэгийн `expression_python`/`equation_latex`-тэй ТУЛГАГДАНА
 *    (`calculators.test.ts`) — багц өөрчлөгдвөл хос зөрж улаан болно.
 * ⚠️ Гүйцэтгэх боломжгүй (needs_human_review) томьёонд тооцоолуур ХЭЗЭЭ Ч
 *    ажиллахгүй — `executable=false` бол `null`.
 * ⚠️ Алхам бүр `steps`-д — «0.64 × 1000 × 2² = 2560 МДж» гэсэн ул мөр нь
 *    хариултын ГЭРЭЭНИЙ хэсэг (зөвхөн boolean хангалтгүй, GOLD-B07).
 */
import type { CompiledDocument, CompiledFormula, CompiledRule } from './registryTypes';
import type { NormCalculationTrace } from './types';
import { fmt } from './text';

export interface CalcInput {
  [k: string]: number;
}

export interface CalcRun {
  trace: NormCalculationTrace;
  assumptions: string[];
  warnings: string[];
}

type CalcFn = (f: CompiledFormula, doc: CompiledDocument, input: CalcInput) => CalcRun | null;

/** Тооцоолуур бүрийн ТОГТМОЛ — бичлэгтэй тулгагдана (тест). */
export const CALCULATOR_CONSTANTS = {
  specificFireLoad: { minAreaM2: 10 },
  vCategoryUpgrade: { coefficient: 0.64 },
  apparatusGasVolume: { coefficient: 0.01 },
  liquidSpacing: { heightThresholdM: 11, fixedSpacingM: 15, subtractFromM: 26 },
} as const;

function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

const specificFireLoad: CalcFn = (f, _doc, input) => {
  const Q = input.Q_MJ;
  const S = input.S_m2;
  if (Q === undefined || S === undefined) return null;
  const minS = f.constraints.S_m2_min ?? CALCULATOR_CONSTANTS.specificFireLoad.minAreaM2;
  const assumptions: string[] = [];
  let Sn = S;
  if (S < minS) {
    Sn = minS;
    assumptions.push(`Галын ачааллын байрлалын талбай S нь ${fmt(minS)} м²-аас багагүй байх ёстой (4.20) тул S = ${fmt(minS)} м² гэж авав.`);
  }
  const g = r3(Q / Sn);
  return {
    trace: {
      calculatorId: 'specificFireLoad',
      formulaId: f.formulaId,
      inputs: { Q_MJ: Q, S_m2: S },
      normalizedInputs: { Q_MJ: Q, S_m2: Sn },
      steps: [`g = Q / S`, `g = ${fmt(Q)} / ${fmt(Sn)} = ${fmt(g)} МДж/м²`],
      result: g,
      unit: 'MJ/m2',
    },
    assumptions,
    warnings: [],
  };
};

const vCategoryUpgrade: CalcFn = (f, _doc, input) => {
  const Q = input.Q_MJ;
  const g = input.g_MJ_m2;
  const H = input.H_m;
  if (Q === undefined || g === undefined || H === undefined) return null;
  const k = CALCULATOR_CONSTANTS.vCategoryUpgrade.coefficient;
  const threshold = r3(k * g * H * H);
  const holds = Q >= threshold;
  return {
    trace: {
      calculatorId: 'vCategoryUpgrade',
      formulaId: f.formulaId,
      inputs: { Q_MJ: Q, g_MJ_m2: g, H_m: H },
      normalizedInputs: { Q_MJ: Q, g_MJ_m2: g, H_m: H, threshold_MJ: threshold },
      steps: [
        `Босго = 0.64 × g × H²`,
        `Босго = 0.64 × ${fmt(g)} × ${fmt(H)}² = ${fmt(threshold)} МДж`,
        `Q = ${fmt(Q)} МДж ${holds ? '≥' : '<'} ${fmt(threshold)} МДж → нөхцөл ${holds ? 'БИЕЛНЭ' : 'БИЕЛЭХГҮЙ'}`,
      ],
      result: holds,
      unit: null,
    },
    assumptions: [],
    warnings: [],
  };
};

const apparatusGasVolume: CalcFn = (f, _doc, input) => {
  const P1 = input.P1_kPa;
  const V = input.V_m3;
  if (P1 === undefined || V === undefined) return null;
  const k = CALCULATOR_CONSTANTS.apparatusGasVolume.coefficient;
  const Va = r3(k * P1 * V);
  return {
    trace: {
      calculatorId: 'apparatusGasVolume',
      formulaId: f.formulaId,
      inputs: { P1_kPa: P1, V_m3: V },
      normalizedInputs: { P1_kPa: P1, V_m3: V },
      steps: [`Va = 0.01 × P₁ × V`, `Va = 0.01 × ${fmt(P1)} × ${fmt(V)} = ${fmt(Va)} м³`],
      result: Va,
      unit: 'm3',
    },
    assumptions: [],
    warnings: [],
  };
};

/** H ≥ 11 → 15 м (томьёо 23); H < 11 → 26 − H (томьёо 24).  Дуудагч ЗӨВ томьёог сонгож өгнө. */
const liquidSpacingHigh: CalcFn = (f, _doc, input) => {
  const H = input.H_m;
  if (H === undefined || H < CALCULATOR_CONSTANTS.liquidSpacing.heightThresholdM) return null;
  const l = CALCULATOR_CONSTANTS.liquidSpacing.fixedSpacingM;
  return {
    trace: {
      calculatorId: 'liquidSpacingHigh',
      formulaId: f.formulaId,
      inputs: { H_m: H },
      normalizedInputs: { H_m: H },
      steps: [`H = ${fmt(H)} м ≥ 11 м → l ≥ ${fmt(l)} м`],
      result: l,
      unit: 'm',
    },
    assumptions: [],
    warnings: [],
  };
};

const liquidSpacingLow: CalcFn = (f, _doc, input) => {
  const H = input.H_m;
  if (H === undefined || H >= CALCULATOR_CONSTANTS.liquidSpacing.heightThresholdM) return null;
  const l = r3(CALCULATOR_CONSTANTS.liquidSpacing.subtractFromM - H);
  return {
    trace: {
      calculatorId: 'liquidSpacingLow',
      formulaId: f.formulaId,
      inputs: { H_m: H },
      normalizedInputs: { H_m: H },
      steps: [`H = ${fmt(H)} м < 11 м → l ≥ 26 − H`, `l ≥ 26 − ${fmt(H)} = ${fmt(l)} м`],
      result: l,
      unit: 'm',
    },
    assumptions: [],
    warnings: [],
  };
};

/** Томьёоны id-ийн ТӨГСГӨЛ → тооцоолуур (баримтын id-г угтварлана). */
const BY_FORMULA_SUFFIX: Readonly<Record<string, { id: string; fn: CalcFn }>> = {
  ':4.20:22': { id: 'specificFireLoad', fn: specificFireLoad },
  ':4.20:upgrade': { id: 'vCategoryUpgrade', fn: vCategoryUpgrade },
  ':4.8:7': { id: 'apparatusGasVolume', fn: apparatusGasVolume },
  ':4.20:23': { id: 'liquidSpacingHigh', fn: liquidSpacingHigh },
  ':4.20:24': { id: 'liquidSpacingLow', fn: liquidSpacingLow },
};

export function calculatorFor(formulaId: string): { id: string; fn: CalcFn } | null {
  for (const [suffix, c] of Object.entries(BY_FORMULA_SUFFIX)) if (formulaId.endsWith(suffix)) return c;
  return null;
}

export function supportedFormulaIds(doc: CompiledDocument): string[] {
  return doc.formulas.filter((f) => calculatorFor(f.formulaId) !== null).map((f) => f.formulaId);
}

/** Тооцоолуур ажиллуулна — гүйцэтгэх боломжгүй томьёонд `null`. */
export function runCalculator(doc: CompiledDocument, f: CompiledFormula, input: CalcInput): CalcRun | null {
  if (!f.executable) return null;
  const c = calculatorFor(f.formulaId);
  if (c === null) return null;
  return c.fn(f, doc, input);
}

/** 4.4 — чөлөөт багтаамжийн нөөц дүрэм: V_free = ratio × V_geo (ratio нь бүртгэлийн `value`). */
export function runFallbackRatio(rule: CompiledRule, geometricVolumeM3: number): CalcRun | null {
  if (!rule.executable || rule.family !== 'fallback_ratio' || rule.value === null) return null;
  const ratio = rule.value;
  const v = r3(ratio * geometricVolumeM3);
  return {
    trace: {
      calculatorId: 'freeRoomVolumeFallback',
      formulaId: rule.ruleId,
      inputs: { V_geometric_m3: geometricVolumeM3 },
      normalizedInputs: { V_geometric_m3: geometricVolumeM3, ratio },
      steps: [`V_чөлөөт = ${fmt(ratio * 100)}% × V_геометр`, `V_чөлөөт = ${fmt(ratio)} × ${fmt(geometricVolumeM3)} = ${fmt(v)} м³`],
      result: v,
      unit: 'm3',
    },
    assumptions: ['Тоног төхөөрөмжийн эзэлсэн эзлэхүүнийг тодорхойлох боломжгүй тул 4.4-ийн нөөц дүрмээр геометр багтаамжийн 80%-ийг авав.'],
    warnings: [],
  };
}
