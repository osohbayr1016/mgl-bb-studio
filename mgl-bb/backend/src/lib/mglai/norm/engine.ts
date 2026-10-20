/**
 * MGL AI · ДЕТЕРМИНИСТ НОРМЫН ХӨДӨЛГҮҮР (P0-5…P0-8, Amendment E).
 *
 *   асуулт → инженерийн entity → ГҮЙЦЭТГЭХ ДҮРМИЙН ГЭР БҮЛ (entity, asks, баримтын
 *   код) → баталгаажсан бичлэг → дүрэм/тооцоолуур → TrustedNormResult
 *   (утга + баримт + бичлэг + хуудас + баталгаажилт НЭГ объектоор)
 *
 * ⚠️ ХАЙЛТ ЭНД ОРОЛЦОХГҮЙ.  BM25/FTS нь гүйцэтгэх дүрэм СОНГОХГҮЙ (Amendment E):
 *    GOLD-A01 «25 °C, 7 кПа → ангилал?» нь кодгүй атлаа БД 21-101-12-ын өрөөний
 *    дүрэм рүү entity-ээр очно.  Хайлт нь ДАРАА нь нотолгоо/тайлбар нэмэх л.
 * ⚠️ ЗАГВАР АНГИЛАЛ, ТОО, ЭШЛЭЛ СОНГОХГҮЙ.  Энэ файл `null` буцаавал л
 *    (гүйцэтгэх гэр бүл таараагүй) хайлтын зам ажиллана.
 * ⚠️ 28 °C (Amendment C): бичлэгийн `boundaryConflicts` дээр яг буусан утга →
 *    needs_human_review / source_boundary_conflict, ангилал ХЭЛЭХГҮЙ.
 */
import type { CompiledDocument, CompiledFormula, CompiledProvenance, CompiledRule } from './registryTypes';
import type { NormRegistry } from './registry';
import type { EngineeringEntities } from './entities';
import type { NormCalculationTrace, NormFollowup, NormProvenance, NormRange, NormVerificationState, TrustedNormResult } from './types';
import { absentFields, evaluatePredicate, type PredContext, type PredValue } from './predicate';
import { runCalculator, runFallbackRatio, type CalcRun } from './calculators';
import { canon, currentnessGate } from './state';
import { fmt } from './text';

export type Lang = 'mn-Cyrl' | 'en';

export interface EngineInput {
  question: string;
  entities: EngineeringEntities;
  registry: NormRegistry;
  lang: Lang;
  /** Өмнөх ээлжийн оролт (ConvState.norm) — ОДООГИЙНХ давамгайлна (P0-13). */
  prior?: Partial<EngineeringEntities> | null;
}

/* ── Provenance ─────────────────────────────────────────────────────── */

function labelOf(p: CompiledProvenance): string {
  const bits = [p.documentCode];
  if (p.table !== null) bits.push(`Хүснэгт ${p.table}`);
  if (p.formula !== null && /^\d+$/.test(p.formula)) bits.push(`томьёо ${p.formula}`);
  if (p.clause !== null) bits.push(`заалт ${p.clause}`);
  else if (p.section !== null && /^\d/.test(p.section) && p.table === null && p.formula === null) bits.push(`заалт ${p.section}`);
  else if (p.section !== null && p.formula !== null && /^\d/.test(p.section)) bits.push(`заалт ${p.section}`);
  if (p.page !== null) bits.push(`х.${p.page}`);
  return bits.join(', ');
}

function toProvenance(doc: CompiledDocument, p: CompiledProvenance, state: NormVerificationState): NormProvenance {
  return {
    documentId: p.documentId,
    documentCode: p.documentCode,
    recordId: p.recordId,
    section: p.section,
    clause: p.clause,
    table: p.table,
    formula: p.formula,
    page: p.page,
    verificationState: state,
    sourceHash: doc.datasetSha256,
    labelMn: labelOf(p),
  };
}

/* ── Үр дүнгийн угсралт ────────────────────────────────────────────── */

interface Draft {
  answerKind: TrustedNormResult['answerKind'];
  verification: NormVerificationState;
  value?: number | string | boolean | null;
  unit?: string | null;
  initialCategory?: string | null;
  finalCategory?: string | null;
  ranges?: NormRange[];
  rule?: TrustedNormResult['rule'];
  calculation?: NormCalculationTrace | null;
  followups?: NormFollowup[];
  missingInputs?: string[];
  provenance: NormProvenance[];
  inputs?: Record<string, number | string | boolean>;
  assumptions?: string[];
  warnings?: string[];
  reason: string;
  textMn: string;
  textEn: string;
  numbers?: number[];
  categories?: string[];
}

function finish(doc: CompiledDocument | null, d: Draft, requested: string | null, intent: 'NORMATIVE' | 'CALCULATION'): TrustedNormResult {
  const gate = currentnessGate(doc?.currentness ?? null);
  const verification = gate ?? d.verification;
  const nums = new Set<number>(d.numbers ?? []);
  for (const p of d.provenance) {
    if (p.page !== null) nums.add(p.page);
    if (p.table !== null) nums.add(p.table);
    if (p.formula !== null && /^\d+$/.test(p.formula)) nums.add(Number(p.formula));
  }
  for (const v of Object.values(d.inputs ?? {})) if (typeof v === 'number') nums.add(v);
  for (const r of d.ranges ?? []) {
    if (r.min !== null) nums.add(r.min);
    if (r.max !== null) nums.add(r.max);
  }
  if (d.calculation) {
    for (const v of Object.values(d.calculation.inputs)) nums.add(v);
    for (const v of Object.values(d.calculation.normalizedInputs)) nums.add(v);
    if (typeof d.calculation.result === 'number') nums.add(d.calculation.result);
  }
  const cats = new Set<string>(d.categories ?? []);
  if (d.initialCategory) cats.add(d.initialCategory);
  if (d.finalCategory) cats.add(d.finalCategory);
  return {
    version: 'tnr-1',
    intent,
    answerKind: d.answerKind,
    verification,
    authoritative: verification === 'verified',
    documentId: doc?.documentId ?? null,
    documentCode: doc?.documentCode ?? null,
    datasetSha256: doc?.datasetSha256 ?? null,
    currentness: doc?.currentness ?? null,
    requestedDocument: requested,
    value: d.value ?? null,
    unit: d.unit ?? null,
    initialCategory: d.initialCategory ?? null,
    finalCategory: d.finalCategory ?? null,
    ranges: d.ranges ?? [],
    rule: d.rule ?? null,
    calculation: d.calculation ?? null,
    followups: d.followups ?? [],
    missingInputs: d.missingInputs ?? [],
    provenance: d.provenance,
    inputs: d.inputs ?? {},
    assumptions: d.assumptions ?? [],
    warnings: d.warnings ?? [],
    reason: d.reason,
    textMn: d.textMn,
    textEn: d.textEn,
    allowedNumbers: [...nums].filter((n) => Number.isFinite(n)),
    allowedCategories: [...cats],
  };
}

/* ── Туслах ─────────────────────────────────────────────────────────── */

const CATEGORY_ORDER = ['В1', 'В2', 'В3', 'В4'];

function bandRanges(doc: CompiledDocument): NormRange[] {
  const out: NormRange[] = [];
  for (const r of doc.rules) {
    if (r.family !== 'v_subcategory' || r.predicate === null || r.predicate.kind !== 'number' || r.category === null) continue;
    const p = r.predicate;
    if (p.op === 'between' && Array.isArray(p.value)) out.push({ category: r.category, min: p.value[0], max: p.value[1], exclusiveMin: false, exclusiveMax: false });
    else if (typeof p.value === 'number') {
      if (p.op === '>' || p.op === '>=') out.push({ category: r.category, min: p.value, max: null, exclusiveMin: p.op === '>', exclusiveMax: false });
      else if (p.op === '<' || p.op === '<=') out.push({ category: r.category, min: null, max: p.value, exclusiveMin: false, exclusiveMax: p.op === '<' });
    }
  }
  return out;
}

function rangeText(r: NormRange): string {
  if (r.min !== null && r.max !== null) return `${fmt(r.min)}–${fmt(r.max)}`;
  if (r.min !== null) return `${r.exclusiveMin ? '>' : '≥'} ${fmt(r.min)}`;
  if (r.max !== null) return `${r.exclusiveMax ? '<' : '≤'} ${fmt(r.max)}`;
  return '—';
}

function merged(e: EngineeringEntities, prior: Partial<EngineeringEntities> | null | undefined): EngineeringEntities {
  if (!prior) return e;
  const out: EngineeringEntities = { ...e };
  const keys = ['gMjM2', 'qMj', 'sM2', 'hM', 'deltaPKpa', 'flashPointC', 'apparatusPressureKpa', 'apparatusVolumeM3', 'geometricVolumeM3'] as const;
  for (const k of keys) {
    const pv = prior[k];
    if (out[k] === undefined && typeof pv === 'number') out[k] = pv;
  }
  if (out.medium.length === 0 && Array.isArray(prior.medium)) out.medium = [...prior.medium];
  if (!out.equipmentVolumeUnknown && prior.equipmentVolumeUnknown) out.equipmentVolumeUnknown = true;
  if (out.documentCodes.length === 0 && Array.isArray(prior.documentCodes)) out.documentCodes = [...prior.documentCodes];
  return out;
}

function formulaOf(doc: CompiledDocument, suffix: string): CompiledFormula | null {
  return doc.formulas.find((f) => f.formulaId.endsWith(suffix)) ?? null;
}

function ruleOf(doc: CompiledDocument, suffix: string): CompiledRule | null {
  return doc.rules.find((r) => r.ruleId.endsWith(suffix)) ?? null;
}

function pickDocument(registry: NormRegistry, codes: readonly string[]): { doc: CompiledDocument | null; absent: string | null } {
  if (codes.length === 0) return { doc: registry.documents[0] ?? null, absent: null };
  for (const c of codes) {
    const d = registry.byCode(c);
    if (d) return { doc: d, absent: null };
  }
  return { doc: null, absent: codes[0] ?? null };
}

/* ── Гэр бүл бүрийн гүйцэтгэл ───────────────────────────────────────── */

function calcRun(doc: CompiledDocument, f: CompiledFormula | null, input: Record<string, number>): CalcRun | null {
  if (f === null) return null;
  return runCalculator(doc, f, input);
}

function apparatusGasVolume(doc: CompiledDocument, e: EngineeringEntities, lang: Lang): Draft | null {
  const f = formulaOf(doc, ':4.8:7');
  if (f === null) return null;
  if (e.apparatusPressureKpa === undefined || e.apparatusVolumeM3 === undefined) {
    const missing = [e.apparatusPressureKpa === undefined ? 'P1_kPa' : null, e.apparatusVolumeM3 === undefined ? 'V_m3' : null].filter((x): x is string => x !== null);
    return {
      answerKind: 'insufficient_context',
      verification: 'verified',
      provenance: [toProvenance(doc, f.provenance, 'verified')],
      missingInputs: missing,
      reason: 'Va — оролт дутуу',
      textMn: `Vₐ = 0.01·P₁·V (${labelOf(f.provenance)}) тооцоход ${missing.join(', ')} утга хэрэгтэй.`,
      textEn: `Computing Va = 0.01·P1·V (${labelOf(f.provenance)}) requires ${missing.join(', ')}.`,
    };
  }
  const run = calcRun(doc, f, { P1_kPa: e.apparatusPressureKpa, V_m3: e.apparatusVolumeM3 });
  if (run === null) return null;
  const prov = toProvenance(doc, f.provenance, f.executable ? 'verified' : 'needs_human_review');
  const value = run.trace.result as number;
  return {
    answerKind: 'calculation',
    verification: f.executable ? 'verified' : 'needs_human_review',
    value,
    unit: 'm3',
    calculation: run.trace,
    provenance: [prov],
    inputs: { P1_kPa: e.apparatusPressureKpa, V_m3: e.apparatusVolumeM3 },
    assumptions: run.assumptions,
    warnings: run.warnings,
    numbers: [0.01],
    reason: 'аппаратаас гарах хийн эзлэхүүн — томьёо 7',
    textMn: `Vₐ = 0.01 × ${fmt(e.apparatusPressureKpa)} × ${fmt(e.apparatusVolumeM3)} = **${fmt(value)} м³** (${prov.labelMn}).`,
    textEn: lang === 'en' ? `Va = 0.01 × ${fmt(e.apparatusPressureKpa)} × ${fmt(e.apparatusVolumeM3)} = **${fmt(value)} m³** (${prov.labelMn}).` : '',
  };
}

function freeVolumeFallback(doc: CompiledDocument, e: EngineeringEntities): Draft | null {
  const rule = ruleOf(doc, ':clause:4.4');
  if (rule === null) return null;
  const vGeo = e.geometricVolumeM3 ?? e.volumeM3;
  if (vGeo === undefined) {
    return {
      answerKind: 'insufficient_context',
      verification: 'verified',
      provenance: [toProvenance(doc, rule.provenance, 'verified')],
      missingInputs: ['V_geometric_m3'],
      reason: '4.4 — геометр эзлэхүүн дутуу',
      textMn: `Чөлөөт багтаамжийг 4.4-ийн нөөц дүрмээр (${labelOf(rule.provenance)}) тооцоход өрөөний геометр эзлэхүүн (м³) хэрэгтэй.`,
      textEn: `Computing the free volume by the 4.4 fallback (${labelOf(rule.provenance)}) requires the geometric room volume (m³).`,
    };
  }
  if (!e.equipmentVolumeUnknown) {
    return {
      answerKind: 'insufficient_context',
      verification: 'verified',
      provenance: [toProvenance(doc, rule.provenance, 'verified')],
      missingInputs: ['equipment_volume_known'],
      reason: '4.4 — тоног төхөөрөмжийн эзлэхүүн мэдэгдэх эсэх тодорхойгүй',
      textMn: `Чөлөөт багтаамж = нийт багтаамж − тоног төхөөрөмжийн эзлэхүүн; тооцох боломжгүй бол л геометр багтаамжийн 80%-ийг авна (${labelOf(rule.provenance)}). Тоног төхөөрөмжийн эзлэхүүн мэдэгдэх эсэхийг заана уу.`,
      textEn: `Free volume = total volume − equipment volume; only when that cannot be determined is 80% of the geometric volume used (${labelOf(rule.provenance)}). State whether the equipment volume is known.`,
    };
  }
  const run = runFallbackRatio(rule, vGeo);
  if (run === null) return null;
  const prov = toProvenance(doc, rule.provenance, 'verified');
  const value = run.trace.result as number;
  return {
    answerKind: 'calculation',
    verification: 'verified',
    value,
    unit: 'm3',
    calculation: run.trace,
    provenance: [prov],
    rule: { ruleId: rule.ruleId, family: rule.family, method: null },
    inputs: { V_geometric_m3: vGeo, equipment_volume_known: false },
    assumptions: run.assumptions,
    numbers: [rule.value ?? 0.8, (rule.value ?? 0.8) * 100],
    reason: '4.4 нөөц дүрэм — 80%',
    textMn: `Чөлөөт эзлэхүүн = 0.8 × ${fmt(vGeo)} = **${fmt(value)} м³** — тоног төхөөрөмжийн эзлэхүүнийг тооцох боломжгүй тул геометр багтаамжийн 80%-ийг авав (${prov.labelMn}).`,
    textEn: `Free volume = 0.8 × ${fmt(vGeo)} = **${fmt(value)} m³** — the equipment volume cannot be determined, so 80% of the geometric volume is taken (${prov.labelMn}).`,
  };
}

function shutoffTime(doc: CompiledDocument, e: EngineeringEntities): Draft | null {
  const rules = doc.rules.filter((r) => r.family === 'shutoff_time');
  if (rules.length === 0) return null;
  const ctx: Record<string, PredValue | undefined> = {
    manual: e.manualShutoff,
    redundant: e.redundantShutoff,
    failure_probability_per_year: e.failureProbabilityPerYear,
  };
  const needs = new Set<string>();
  for (const r of rules) {
    if (!r.executable) continue;
    const o = evaluatePredicate(r.predicate, ctx, r.boundaryConflicts);
    if (o.state === 'true') {
      const prov = toProvenance(doc, r.provenance, 'verified');
      return {
        answerKind: r.value === null ? 'requirement' : 'calculation',
        verification: 'verified',
        value: r.value,
        unit: r.value === null ? null : 's',
        provenance: [prov],
        rule: { ruleId: r.ruleId, family: r.family, method: null },
        inputs: Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined)) as Record<string, number | string | boolean>,
        reason: 'шугам хоолой хаах хугацаа — 4.2',
        textMn: r.value === null ? `${r.descriptionMn} (${prov.labelMn}).` : `Тооцоот хаах хугацаа: **${fmt(r.value)} с** — ${r.descriptionMn} (${prov.labelMn}).`,
        textEn: r.value === null ? `${r.descriptionMn} (${prov.labelMn}).` : `Design closure time: **${fmt(r.value)} s** (${prov.labelMn}).`,
      };
    }
    if (o.state === 'missing') for (const n of o.needs) needs.add(n);
  }
  const first = rules[0]!;
  return {
    answerKind: 'insufficient_context',
    verification: 'verified',
    provenance: [toProvenance(doc, first.provenance, 'verified')],
    missingInputs: [...needs],
    reason: '4.2 — хаалтын нөхцөл дутуу',
    textMn: `Хаах хугацааг тогтооход дараах нөхцөл хэрэгтэй: ${[...needs].join(', ') || 'гараар/автомат, нөөц, магадлал'} (${labelOf(first.provenance)}).`,
    textEn: `Determining the closure time needs: ${[...needs].join(', ') || 'manual/automatic, redundancy, failure probability'} (${labelOf(first.provenance)}).`,
  };
}

function liquidSpacing(doc: CompiledDocument, e: EngineeringEntities): Draft | null {
  const hi = formulaOf(doc, ':4.20:23');
  const lo = formulaOf(doc, ':4.20:24');
  if (hi === null || lo === null) return null;
  if (e.hM === undefined) {
    return {
      answerKind: 'insufficient_context',
      verification: 'verified',
      provenance: [toProvenance(doc, lo.provenance, 'verified'), toProvenance(doc, hi.provenance, 'verified')],
      missingInputs: ['H_m'],
      reason: 'зай — H дутуу',
      textMn: `Хялбар авалцан асах/шатамхай шингэний галын ачааллын хэсгүүдийн хязгаарын зайг тооцоход өрөөний өндөр H (м) хэрэгтэй: H ≥ 11 м бол 15 м, H < 11 м бол 26 − H (${labelOf(hi.provenance)}; ${labelOf(lo.provenance)}).`,
      textEn: `The limiting spacing between fire-load sections of flammable liquids needs the room height H (m): 15 m when H ≥ 11 m, 26 − H when H < 11 m.`,
    };
  }
  const f = e.hM >= 11 ? hi : lo;
  const run = calcRun(doc, f, { H_m: e.hM });
  if (run === null) return null;
  const prov = toProvenance(doc, f.provenance, 'verified');
  const value = run.trace.result as number;
  return {
    answerKind: 'calculation',
    verification: 'verified',
    value,
    unit: 'm',
    calculation: run.trace,
    provenance: [prov],
    inputs: { H_m: e.hM },
    numbers: [11, 15, 26],
    reason: `хэсгүүдийн зай — томьёо ${f.number}`,
    textMn: `H = ${fmt(e.hM)} м ${e.hM >= 11 ? '≥ 11 м тул' : '< 11 м тул l ≥ 26 − H ='} хэсгүүдийн хамгийн бага зай **${fmt(value)} м** (${prov.labelMn}).`,
    textEn: `H = ${fmt(e.hM)} m ${e.hM >= 11 ? '≥ 11 m, so' : '< 11 m, so l ≥ 26 − H ='} minimum spacing **${fmt(value)} m** (${prov.labelMn}).`,
  };
}

interface VContext {
  g: number;
  gDerived: CalcRun | null;
}

function specificFireLoadOnly(doc: CompiledDocument, e: EngineeringEntities): Draft | null {
  const f = formulaOf(doc, ':4.20:22');
  if (f === null) return null;
  if (e.qMj === undefined || e.sM2 === undefined) {
    // ⚠️ «S=20 м² бол g хэд вэ?» (Q алга) — өмнөх ээлжийн g-ээр В-муж хэлэх нь БУРУУ хариу
    //    (хэмжсэн 2026-09-18: прод дээр g=2500-ыг өвлөж «В1» гэсэн).  Дутууг дутуу гэж хэлнэ.
    const missing = [e.qMj === undefined ? 'Q_MJ' : null, e.sM2 === undefined ? 'S_m2' : null].filter((x): x is string => x !== null);
    const prov = toProvenance(doc, f.provenance, 'verified');
    return {
      answerKind: 'insufficient_context',
      verification: 'verified',
      provenance: [prov],
      missingInputs: missing,
      reason: `хувийн галын ачаалал — ${missing.join(', ')} дутуу`,
      textMn: `Хувийн галын ачаалал g = Q / S — тооцоолоход ${missing.map((m) => (m === 'Q_MJ' ? 'галын ачаалал Q (МДж)' : 'талбай S (м², 10 м²-аас багагүй)')).join(' ба ')} хэрэгтэй (${prov.labelMn}).`,
      textEn: `Specific fire load g = Q / S — needs ${missing.map((m) => (m === 'Q_MJ' ? 'the fire load Q (MJ)' : 'the area S (m², not less than 10 m²)')).join(' and ')} (${prov.labelMn}).`,
    };
  }
  const run = calcRun(doc, f, { Q_MJ: e.qMj, S_m2: e.sM2 });
  if (run === null) return null;
  const prov = toProvenance(doc, f.provenance, 'verified');
  const value = run.trace.result as number;
  return {
    answerKind: 'calculation',
    verification: 'verified',
    value,
    unit: 'MJ/m2',
    calculation: run.trace,
    provenance: [prov],
    inputs: { Q_MJ: e.qMj, S_m2: e.sM2 },
    assumptions: run.assumptions,
    numbers: [10],
    reason: 'хувийн галын ачаалал — томьёо 22',
    textMn: `g = Q / S = ${fmt(e.qMj)} / ${fmt(run.trace.normalizedInputs.S_m2 ?? e.sM2)} = **${fmt(value)} МДж/м²** (${prov.labelMn}).`,
    textEn: `g = Q / S = ${fmt(e.qMj)} / ${fmt(run.trace.normalizedInputs.S_m2 ?? e.sM2)} = **${fmt(value)} MJ/m²** (${prov.labelMn}).`,
  };
}

/** g өгөгдсөн эсвэл Q/S-ээс ГАРГАСАН — В-муж ангилал + 4.20 / зайн follow-up. */
function vSubcategory(doc: CompiledDocument, e: EngineeringEntities, lang: Lang, askedUpgrade: boolean): Draft | null {
  const bands = doc.rules.filter((r) => r.family === 'v_subcategory' && r.executable && r.predicate !== null);
  if (bands.length === 0) return null;
  let v: VContext | null = null;
  if (e.gMjM2 !== undefined) v = { g: e.gMjM2, gDerived: null };
  else if (e.qMj !== undefined && e.sM2 !== undefined) {
    const f = formulaOf(doc, ':4.20:22');
    const run = calcRun(doc, f, { Q_MJ: e.qMj, S_m2: e.sM2 });
    if (run !== null) v = { g: run.trace.result as number, gDerived: run };
  }
  if (v === null) {
    // Лавлагаа: ангилал нэрлэсэн, g алга → мужийг өгнө
    if (e.mentionedCategories.length > 0) {
      const cat = e.mentionedCategories[0]!;
      const r = bands.find((b) => b.category === cat);
      if (!r) return null;
      const ranges = bandRanges(doc);
      const range = ranges.find((x) => x.category === cat)!;
      const prov = toProvenance(doc, r.provenance, 'verified');
      return {
        answerKind: 'requirement',
        verification: 'verified',
        value: rangeText(range),
        unit: 'MJ/m2',
        initialCategory: cat,
        ranges,
        rule: { ruleId: r.ruleId, family: r.family, method: r.method },
        provenance: [prov],
        categories: [cat],
        reason: `муж лавлагаа — ${cat}`,
        textMn: `${cat} ангилал: хувийн галын ачаалал g = ${rangeText(range)} МДж/м² (${prov.labelMn}).`,
        textEn: `Category ${cat}: specific fire load g = ${rangeText(range)} MJ/m² (${prov.labelMn}).`,
      };
    }
    return null;
  }
  const ctx: PredContext = { g_mj_m2: v.g };
  const matched = bands.filter((b) => evaluatePredicate(b.predicate, ctx, b.boundaryConflicts).state === 'true');
  const ranges = bandRanges(doc);
  const conflict = bands.find((b) => evaluatePredicate(b.predicate, ctx, b.boundaryConflicts).state === 'conflict');
  if (conflict) {
    return {
      answerKind: 'unverified',
      verification: 'needs_human_review',
      ranges,
      provenance: [toProvenance(doc, conflict.provenance, 'needs_human_review')],
      inputs: { g_mj_m2: v.g },
      warnings: ['source_boundary_conflict'],
      reason: 'хилийн зөрчил',
      textMn: canon('source_boundary_conflict', 'mn-Cyrl'),
      textEn: canon('source_boundary_conflict', 'en'),
    };
  }
  if (matched.length !== 1) {
    return {
      answerKind: 'unverified',
      verification: 'needs_human_review',
      ranges,
      provenance: bands.map((b) => toProvenance(doc, b.provenance, 'needs_human_review')),
      inputs: { g_mj_m2: v.g },
      warnings: [matched.length === 0 ? 'no_band_matched' : 'overlapping_bands'],
      reason: matched.length === 0 ? 'муж таараагүй' : 'муж давхцав',
      textMn: canon('needs_human_review', 'mn-Cyrl'),
      textEn: canon('needs_human_review', 'en'),
    };
  }
  const band = matched[0]!;
  const cat = band.category!;
  const range = ranges.find((r) => r.category === cat)!;
  const prov = [toProvenance(doc, band.provenance, 'verified')];
  const inputs: Record<string, number> = { g_mj_m2: v.g };
  if (e.qMj !== undefined) inputs.Q_MJ = e.qMj;
  if (e.sM2 !== undefined) inputs.S_m2 = e.sM2;
  if (e.hM !== undefined) inputs.H_m = e.hM;
  const assumptions = [...(v.gDerived?.assumptions ?? [])];
  const followups: NormFollowup[] = [];
  let finalCategory: string | null = cat;
  let calc: NormCalculationTrace | null = v.gDerived?.trace ?? null;
  let upgradeText = '';
  let upgradeTextEn = '';
  const numbers: number[] = [10];

  if (band.method === 'apply_4_20') {
    const missing = [e.qMj === undefined ? 'Q' : null, e.hM === undefined ? 'H' : null].filter((x): x is string => x !== null);
    const up = formulaOf(doc, ':4.20:upgrade');
    if (missing.length === 0 && up !== null && e.qMj !== undefined && e.hM !== undefined) {
      const run = calcRun(doc, up, { Q_MJ: e.qMj, g_MJ_m2: v.g, H_m: e.hM });
      if (run !== null) {
        const holds = run.trace.result === true;
        const idx = CATEGORY_ORDER.indexOf(cat);
        finalCategory = holds && idx > 0 ? CATEGORY_ORDER[idx - 1]! : cat;
        prov.push(toProvenance(doc, up.provenance, 'verified'));
        calc = run.trace;
        numbers.push(0.64, run.trace.normalizedInputs.threshold_MJ ?? 0);
        followups.push({
          id: 'requires_4_20_upgrade_check',
          required: true,
          missingInputs: [],
          textMn: `4.20-ын Q ≥ 0.64·g·H² шалгалт хийгдэв: босго ${fmt(run.trace.normalizedInputs.threshold_MJ ?? 0)} МДж, Q = ${fmt(e.qMj)} МДж → нөхцөл ${holds ? 'биелнэ' : 'биелэхгүй'}.`,
          textEn: `The 4.20 check Q ≥ 0.64·g·H² was performed: threshold ${fmt(run.trace.normalizedInputs.threshold_MJ ?? 0)} MJ, Q = ${fmt(e.qMj)} MJ → condition ${holds ? 'holds' : 'does not hold'}.`,
        });
        upgradeText = holds
          ? ` Q ≥ 0.64·g·H² нөхцөл биелж байгаа тул өрөө дээд ангилал **${finalCategory}** руу шилжинэ (${labelOf(up.provenance)}).`
          : ` Q ≥ 0.64·g·H² нөхцөл биелэхгүй тул ангилал ${cat} хэвээр (${labelOf(up.provenance)}).`;
        upgradeTextEn = holds
          ? ` Since Q ≥ 0.64·g·H² holds, the room moves to the higher category **${finalCategory}** (${labelOf(up.provenance)}).`
          : ` Since Q ≥ 0.64·g·H² does not hold, the category stays ${cat} (${labelOf(up.provenance)}).`;
      }
    } else {
      finalCategory = null;
      followups.push({
        id: 'requires_4_20_upgrade_check',
        required: true,
        missingInputs: missing,
        textMn: `Эцсийн ангиллыг батлахын тулд 4.20-ын Q ≥ 0.64·g·H² нөхцөлийг шалгах шаардлагатай — ${missing.join(', ')} утга дутуу.`,
        textEn: `To confirm the final category the 4.20 condition Q ≥ 0.64·g·H² must be checked — ${missing.join(', ')} missing.`,
      });
      if (up !== null) prov.push(toProvenance(doc, up.provenance, 'verified'));
    }
  } else if (band.method === '10m2_arbitrary_section_and_spacing') {
    const missing = [e.sM2 === undefined ? 'S' : null, 'spacing'].filter((x): x is string => x !== null);
    followups.push({
      id: 'requires_spacing_check',
      required: true,
      missingInputs: missing,
      textMn: 'В4 ангилалд галын ачааллын хэсгүүдийн хоорондын зайг Хүснэгт 5-ын хязгаарын зайтай тулгах нэмэлт шалгалт шаардлагатай (10 м² талбайд дурын хэсгээр).',
      textEn: 'For category В4 an additional check of the spacing between fire-load sections against the Table 5 limits is required (any 10 m² section).',
    });
    const b4 = ruleOf(doc, ':clause:4.20.b4:default');
    if (b4) prov.push(toProvenance(doc, b4.provenance, 'verified'));
    finalCategory = null;
  }

  const gLine = v.gDerived ? `g = Q / S = ${fmt(e.qMj!)} / ${fmt(v.gDerived.trace.normalizedInputs.S_m2 ?? e.sM2!)} = **${fmt(v.g)} МДж/м²**. ` : '';
  const gLineEn = v.gDerived ? `g = Q / S = ${fmt(e.qMj!)} / ${fmt(v.gDerived.trace.normalizedInputs.S_m2 ?? e.sM2!)} = **${fmt(v.g)} MJ/m²**. ` : '';
  if (v.gDerived) prov.unshift(toProvenance(doc, formulaOf(doc, ':4.20:22')!.provenance, 'verified'));
  const fu = followups.filter((f) => f.missingInputs.length > 0).map((f) => f.textMn).join(' ');
  const fuEn = followups.filter((f) => f.missingInputs.length > 0).map((f) => f.textEn).join(' ');
  const bandProv = prov.find((p) => p.recordId === band.ruleId)!;
  return {
    answerKind: askedUpgrade && calc && calc.calculatorId === 'vCategoryUpgrade' ? 'calculation' : 'classification',
    verification: 'verified',
    value: askedUpgrade && calc && calc.calculatorId === 'vCategoryUpgrade' ? calc.result : v.g,
    unit: askedUpgrade && calc && calc.calculatorId === 'vCategoryUpgrade' ? null : 'MJ/m2',
    initialCategory: cat,
    finalCategory,
    ranges,
    rule: { ruleId: band.ruleId, family: band.family, method: band.method },
    calculation: calc,
    followups,
    missingInputs: followups.flatMap((f) => f.missingInputs),
    provenance: prov,
    inputs,
    assumptions,
    numbers,
    reason: `В-муж ${cat}${finalCategory && finalCategory !== cat ? ` → ${finalCategory}` : ''}`,
    textMn: `${gLine}g = ${fmt(v.g)} МДж/м² → эхний ангилал **${cat}** (муж ${rangeText(range)} МДж/м²; ${bandProv.labelMn}).${upgradeText}${fu ? ` ${fu}` : ''}`,
    textEn: `${gLineEn}g = ${fmt(v.g)} MJ/m² → initial category **${cat}** (range ${rangeText(range)} MJ/m²; ${bandProv.labelMn}).${upgradeTextEn}${fuEn ? ` ${fuEn}` : ''}`,
  };
}

function roomCategory(doc: CompiledDocument, e: EngineeringEntities): Draft | null {
  const rules = doc.rules.filter((r) => r.family === 'room_category').sort((a, b) => a.priority - b.priority);
  if (rules.length === 0) return null;
  const medium: string[] = [...e.medium];
  const assumptions: string[] = [];
  // Авалцан асах хэм ЗӨВХӨН шингэнд хамаарна — орчин заагаагүй бол шингэн гэж үзнэ (ил тэмдэглэнэ).
  if (medium.length === 0 && e.flashPointC !== undefined) {
    medium.push('flammable_liquid_vapor', 'flammable_liquid');
    assumptions.push('Авалцан асах хэм өгсөн тул орчныг шингэн (уур) гэж үзэв.');
  }
  // Галын ачаалал (g, эсвэл Q) МЭДЭГДЭЖ байвал шатамхай материал БАЙНА — В-ангиллын
  // туг өөрөө биелнэ (Хүснэгт 1-ийн В мөр: «шатамхай … материал»).  Ил тэмдэглэнэ.
  const hasFireLoad = e.gMjM2 !== undefined || e.qMj !== undefined;
  if (hasFireLoad) assumptions.push('Галын ачаалал өгсөн тул шатамхай материал байгаа гэж үзэв.');
  const ctx: Record<string, PredValue | undefined> = {
    flash_point_c: e.flashPointC,
    explosion_overpressure_kpa: e.deltaPKpa,
    medium,
    combustible_material_present: hasFireLoad ? true : undefined,
    __decided_categories: [],
  };
  // `decided` = БИЕЛСЭН ангилал (биелмэгц буцдаг тул бараг үргэлж хоосон);
  // `undecided` = тоон оролт дутуугаас шийдэгдээгүй ангилал («А:explosion_overpressure_kpa»).
  const decided: string[] = [];
  const undecided: string[] = [];
  const needs = new Set<string>();
  const soft = new Set<string>();
  for (const r of rules) {
    if (!r.executable) continue;
    for (const f of absentFields(r.predicate, ctx)) soft.add(f);
    const o = evaluatePredicate(r.predicate, { ...ctx, __decided_categories: decided, __undecided_categories: undecided }, r.boundaryConflicts);
    if (o.state === 'conflict') {
      const prov = toProvenance(doc, r.provenance, 'needs_human_review');
      const c = r.boundaryConflicts.find((x) => x.field === o.field);
      return {
        answerKind: 'unverified',
        verification: 'needs_human_review',
        provenance: [prov],
        inputs: { flash_point_c: e.flashPointC ?? 0, explosion_overpressure_kpa: e.deltaPKpa ?? 0 },
        warnings: ['source_boundary_conflict', c?.detailMn ?? ''].filter((x) => x.length > 0),
        reason: `хилийн зөрчил ${o.field}=${o.value}`,
        textMn: `${canon('source_boundary_conflict', 'mn-Cyrl')} (${prov.labelMn}: ${c?.detailMn ?? ''})`,
        textEn: `${canon('source_boundary_conflict', 'en')} (${prov.labelMn})`,
      };
    }
    if (o.state === 'true') {
      const prov = toProvenance(doc, r.provenance, 'verified');
      const cat = r.category ?? '';
      if (cat.includes('-')) {
        // В1-В4: дэд ангиллыг g-ээр тодорхойлно — g байхгүй бол хүсэлт.
        return {
          answerKind: 'classification',
          verification: 'verified',
          initialCategory: 'В',
          provenance: [prov],
          rule: { ruleId: r.ruleId, family: r.family, method: null },
          inputs: filteredInputs(e),
          assumptions,
          missingInputs: ['g_mj_m2'],
          reason: 'өрөө В (дэд ангилалд g хэрэгтэй)',
          textMn: `Өрөө **В** ангилалд (В1–В4) хамаарна (${prov.labelMn}); дэд ангиллыг хувийн галын ачаалал g-ээр Хүснэгт 4-өөс тогтооно.`,
          textEn: `The room falls in category **В** (В1–В4) (${prov.labelMn}); the subcategory is set from the specific fire load g via Table 4.`,
        };
      }
      const basis: string[] = [];
      if (e.flashPointC !== undefined) basis.push(`авалцан асах хэм ${fmt(e.flashPointC)} °C ${e.flashPointC <= 28 ? '≤' : '>'} 28 °C`);
      if (e.deltaPKpa !== undefined) basis.push(`тэсрэлтийн илүүдэл даралт ${fmt(e.deltaPKpa)} кПа ${e.deltaPKpa > 5 ? '>' : '≤'} 5 кПа`);
      return {
        answerKind: 'classification',
        verification: 'verified',
        initialCategory: cat,
        finalCategory: cat,
        provenance: [prov],
        rule: { ruleId: r.ruleId, family: r.family, method: null },
        inputs: filteredInputs(e),
        assumptions,
        numbers: [28, 5],
        categories: [cat],
        reason: `өрөөний ангилал ${cat}`,
        textMn: `Өрөө **${cat}** ангилалд хамаарна${basis.length ? ` — ${basis.join(', ')}` : ''} (${prov.labelMn}).`,
        textEn: `The room is category **${cat}**${basis.length ? ` — ${basis.join(', ')}` : ''} (${prov.labelMn}).`,
      };
    }
    if (o.state === 'missing') {
      for (const n of o.needs) needs.add(n);
      if (r.category && !r.category.includes('-')) for (const n of o.needs) undecided.push(`${r.category}:${n}`);
    }
  }
  // Нэг ч мөр биелээгүй: тоон утга дутуу (хатуу) ЭСВЭЛ орчин/туг заагдаагүй (зөөлөн) —
  // хоёулаа «дутуу оролт», null (= хөдөлгүүр хамааралгүй) БИШ.  Өгсөн ΔP/авалцан
  // асах хэмийн дүгнэлт («5 кПа ≤ 5 кПа — А/Б биш») хариултад орно.
  const missing = needs.size > 0 ? [...needs] : [...soft];
  if (missing.length > 0) {
    const first = rules[0]!;
    const basis: string[] = [];
    if (e.deltaPKpa !== undefined) basis.push(`тэсрэлтийн илүүдэл даралт ${fmt(e.deltaPKpa)} кПа ${e.deltaPKpa > 5 ? '>' : '≤'} 5 кПа`);
    if (e.flashPointC !== undefined) basis.push(`авалцан асах хэм ${fmt(e.flashPointC)} °C ${e.flashPointC <= 28 ? '≤' : '>'} 28 °C`);
    const notAB = e.deltaPKpa !== undefined && e.deltaPKpa <= 5 ? ' Тэсрэлтийн даралт 5 кПа-аас хэтрэхгүй тул А/Б (тэсрэх аюултай) ангилалд хамаарахгүй.' : '';
    return {
      answerKind: 'insufficient_context',
      verification: 'verified',
      provenance: [toProvenance(doc, first.provenance, 'verified')],
      missingInputs: missing,
      inputs: filteredInputs(e),
      assumptions,
      numbers: [28, 5],
      reason: needs.size > 0 ? 'өрөөний ангилал — тоон оролт дутуу' : 'өрөөний ангилал — орчин/туг заагдаагүй',
      textMn: `Өрөөний ангиллыг Хүснэгт 1-ээр (${labelOf(first.provenance)}) тогтооход дараах утга дутуу: ${missing.join(', ')}.${basis.length ? ` Өгсөн: ${basis.join(', ')}.` : ''}${notAB}`,
      textEn: `Classifying the room by Table 1 (${labelOf(first.provenance)}) needs: ${missing.join(', ')}.${basis.length ? ` Given: ${basis.join(', ')}.` : ''}${e.deltaPKpa !== undefined && e.deltaPKpa <= 5 ? ' Overpressure does not exceed 5 kPa, so categories А/Б (explosion hazard) do not apply.' : ''}`,
    };
  }
  return null;
}

/**
 * Хүснэгт 1 → В (В1–В4) гарсан бөгөөд g (эсвэл Q, S) МЭДЭГДЭЖ байвал Хүснэгт 4-өөр
 * дэд ангилал хүртэл үргэлжлүүлнэ; хоёр дүрмийн провенанс хоёулаа үлдэнэ.
 */
function roomCategoryThenBand(doc: CompiledDocument, e: EngineeringEntities, lang: Lang): Draft | null {
  const room = roomCategory(doc, e);
  if (room === null) return null;
  const needsG = (room.missingInputs ?? []).includes('g_mj_m2');
  const hasG = e.gMjM2 !== undefined || (e.qMj !== undefined && e.sM2 !== undefined);
  if (!needsG || !hasG || room.verification !== 'verified') return room;
  const band = vSubcategory(doc, e, lang, e.asks.upgradeCondition);
  if (band === null) return room;
  return {
    ...band,
    provenance: [...room.provenance, ...band.provenance],
    assumptions: [...(room.assumptions ?? []), ...(band.assumptions ?? [])],
    inputs: { ...(room.inputs ?? {}), ...(band.inputs ?? {}) },
    reason: `${room.reason} → ${band.reason}`,
    textMn: `${room.textMn} ${band.textMn}`,
    textEn: `${room.textEn} ${band.textEn}`,
  };
}

function filteredInputs(e: EngineeringEntities): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  if (e.flashPointC !== undefined) out.flash_point_c = e.flashPointC;
  if (e.deltaPKpa !== undefined) out.explosion_overpressure_kpa = e.deltaPKpa;
  if (e.medium.length > 0) out.medium = e.medium.join(',');
  return out;
}

/**
 * Нэрлэсэн баримт ХАЙЛТЫН САНД Ч байхгүй гэж локал runtime баталсан үед (`/norm`
 * `named_document: {absent: true}`) — детерминист татгалзал.  Хөдөлгүүр өөрөө үүнийг
 * ХЭЗЭЭ Ч таамаглахгүй (бүртгэлд байхгүй ≠ санд байхгүй).
 */
export function namedDocumentAbsentResult(code: string, intent: 'NORMATIVE' | 'CALCULATION' = 'NORMATIVE'): TrustedNormResult {
  return finish(
    null,
    {
      answerKind: 'no_match',
      verification: 'named_document_absent',
      provenance: [],
      reason: `нэрлэсэн баримт санд байхгүй: ${code}`,
      textMn: `${canon('named_document_absent', 'mn-Cyrl')} (${code})`,
      textEn: `${canon('named_document_absent', 'en')} (${code})`,
    },
    code,
    intent,
  );
}

/* ── Бодлогын мета асуулт (GOLD-B10) ───────────────────────────────── */

const POLICY_RE = /needs_human_review|хүний\s+хяналт[^.?!]{0,60}(record|бичлэг)|(record|бичлэг)[^.?!]{0,60}хүний\s+хяналт/iu;

/* ── ГОЛ ФУНКЦ ─────────────────────────────────────────────────────── */

export function runNormEngine(input: EngineInput): TrustedNormResult | null {
  const { registry, lang } = input;
  const e0 = merged(input.entities, input.prior);
  // ⚠️ ӨВЛӨСӨН баримтын код ХӨРВҮҮЛСЭН БҮРТГЭЛД байхгүй бол (УББ 12-01-01 — зөвхөн локал хайлтын
  //    баримт) энэ ээлжийг түүнд ЦООЖЛОХГҮЙ: «УББ 12-01-01-ийн 9.7 заалт?» → «В2-ийн галын ачааллын
  //    муж хэд вэ?» гэхэд `pickDocument` absent → null → муж лавлагаа огт асахгүй байв (хэмжсэн
  //    2026-09-18).  Энэ ээлжид ИЛ нэрлэсэн код бол хэвээр (P0-3).
  const e =
    input.entities.documentCodes.length === 0 && e0.documentCodes.some((c) => registry.byCode(c) === null)
      ? { ...e0, documentCodes: [] }
      : e0;
  const intent: 'NORMATIVE' | 'CALCULATION' = e.asks.category ? 'NORMATIVE' : 'CALCULATION';

  if (POLICY_RE.test(input.question)) {
    return finish(
      null,
      {
        answerKind: 'procedure',
        verification: 'needs_human_review',
        provenance: [],
        reason: 'бодлогын мета асуулт — needs_human_review',
        textMn: canon('policy_needs_human_review', 'mn-Cyrl'),
        textEn: canon('policy_needs_human_review', 'en'),
      },
      null,
      'NORMATIVE',
    );
  }

  const requested = e.documentCodes[0] ?? null;
  const { doc, absent } = pickDocument(registry, e.documentCodes);
  // ⚠️ Нэрлэсэн баримт ХӨРВҮҮЛСЭН БҮРТГЭЛД байхгүй (жишээ нь БНбД 21-04-05 — локал санд
  //    ЗӨВХӨН хайлтаар) → хөдөлгүүр ХАРИУЛАХГҮЙ (өөр баримтаас тооцоолохгүй, P0-3), гэвч
  //    «санд байхгүй» гэж ч хэлэхгүй — түүнийг локал хайлт (`named_document_absent`)
  //    шийднэ, `/context` нь `namedDocumentAbsentResult`-ээр TrustedNormResult болгоно.
  if (absent !== null) return null;
  if (doc === null) return null;

  let draft: Draft | null = null;
  const cur = input.entities;
  const hasApparatus = e.apparatusPressureKpa !== undefined || e.apparatusVolumeM3 !== undefined;
  const hasGeo = e.geometricVolumeM3 !== undefined || (e.volumeM3 !== undefined && e.asks.freeVolume);
  const hasG = e.gMjM2 !== undefined || (e.qMj !== undefined && e.sM2 !== undefined);
  const hasRoom = e.deltaPKpa !== undefined || e.flashPointC !== undefined || (e.medium.length > 0 && e.asks.category && !hasG);
  // ⚠️ ГЭР БҮЛИЙГ ЭНЭ ЭЭЛЖИЙН оролт сонгоно; өмнөх ээлжийн төлөв зөвхөн ДУТУУ оролтыг
  //    нөхнө.  «g=1800 → В2» гэсний дараа «ΔP=5 кПа бол?» гэвэл өрөөний ангилал
  //    (Хүснэгт 1: А/Б → биш → В), дараа нь g-ээр дэд ангилал — өмнөх g-ийн
  //    В-мужийг дахин хэлэх БИШ.
  const curRoom = cur.deltaPKpa !== undefined || cur.flashPointC !== undefined;
  const curFire = cur.gMjM2 !== undefined || cur.qMj !== undefined || cur.sM2 !== undefined;
  // ⚠️ ЭНЭ ЭЭЛЖИЙН g (өгсөн эсвэл Q/S-ээс гарах) — өвлөсөн g нь зай/g-тооцооны асуултыг БУЛААХГҮЙ.
  //    Хэмжсэн (2026-09-18, прод): «g=2500 → В1» гэсний дараа «H=8 м үед хэсгүүдийн зай хэд вэ?»
  //    гэхэд `hasG` (өвлөсөн 2500) тул дахин «В1» гэж хариулж байв; зөв нь 26 − 8 = 18 м.
  const curG = cur.gMjM2 !== undefined || (cur.qMj !== undefined && cur.sM2 !== undefined);

  if (e.asks.apparatusGasVolume && hasApparatus) draft = apparatusGasVolume(doc, e, lang);
  else if (e.asks.freeVolume || (hasGeo && e.equipmentVolumeUnknown)) draft = freeVolumeFallback(doc, e);
  else if (e.asks.shutoffTime) draft = shutoffTime(doc, e);
  else if (e.asks.spacing && !e.asks.category && !curG) draft = liquidSpacing(doc, e);
  else if (e.asks.upgradeCondition && (hasG || e.qMj !== undefined) && e.hM !== undefined) draft = vSubcategory(doc, e, lang, true);
  // «g = 100 бол?» — g ӨӨРӨӨ өгөгдсөн бол энэ нь ангиллын асуулт, g-тооцоо биш.
  else if (e.asks.specificFireLoad && !e.asks.category && cur.gMjM2 === undefined) draft = specificFireLoadOnly(doc, e);
  else if (curRoom && !curFire) draft = roomCategoryThenBand(doc, e, lang);
  // «В2-ийн муж хэд вэ?» — энэ ээлжид АНГИЛАЛ нэрлэсэн, өөрийн g/Q/S байхгүй → тэр ангиллын МУЖ лавлагаа;
  //    өвлөсөн g-ээр (900 → В3) ангилахгүй (хэмжсэн 2026-09-18, прод).
  else if (cur.mentionedCategories.length > 0 && !curFire && !curRoom) draft = vSubcategory(doc, { ...e, gMjM2: undefined, qMj: undefined, sM2: undefined }, lang, false);
  else if (hasG || (e.mentionedCategories.length > 0 && !hasRoom)) draft = vSubcategory(doc, e, lang, e.asks.upgradeCondition);
  else if (hasRoom) draft = roomCategoryThenBand(doc, e, lang);
  else if (hasApparatus) draft = apparatusGasVolume(doc, e, lang);
  else if (e.asks.spacing && e.hM !== undefined) draft = liquidSpacing(doc, e);

  // GAP-022: «g = 1.800» — мянгат уу, аравтын уу тодорхойгүй → таамаглахгүй, тодруулна.
  if (draft === null && e.ambiguous.length > 0) {
    const list = e.ambiguous.map((a) => `${a.quantity} = «${a.raw}»`).join(', ');
    const first = doc.rules[0];
    draft = {
      answerKind: 'insufficient_context',
      verification: 'verified',
      provenance: first ? [toProvenance(doc, first.provenance, 'verified')] : [],
      missingInputs: e.ambiguous.map((a) => a.quantity),
      inputs: {},
      warnings: ['ambiguous_number'],
      reason: `хоёрдмол тоо: ${list}`,
      textMn: `Оролтын тоо хоёрдмол уншигдана: ${list} — мянгат (жишээ нь 1800) уу, аравтын бутархай (1,8) уу гэдгийг тодруулна уу; таамаглаж тооцоолохгүй.`,
      textEn: `Ambiguous numeric input: ${list} — please clarify thousands (e.g. 1800) vs decimal (1.8); no value is assumed.`,
    };
  }
  if (draft === null) return null;
  return finish(doc, draft, requested, intent);
}
