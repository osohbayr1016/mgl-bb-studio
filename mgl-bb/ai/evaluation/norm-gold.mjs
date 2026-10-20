#!/usr/bin/env node
/**
 * MGL AI · НОРМЫН GOLD РЕГРЕСС — БОДИТ ГИНЖЭЭР (§29, §30, Checkpoint 2).
 *
 *   node evaluation/norm-gold.mjs                 Level 1: детерминист дэд систем (загваргүй)
 *   node evaluation/norm-gold.mjs --gen           Level 2: + бодит Qwen3 үүсгэлт + validator
 *   node evaluation/norm-gold.mjs --only A01,B08  --out evaluation/reports/norm-gold-<огноо>.json
 *
 * Гинж = хөтчийн orchestrator-ийн ЯГ дараалал (`lib/e2e.mjs`):
 *   login → /plan → /tool → локал /norm → /context (TrustedNormResult + гарын үсэг + tfc-2)
 *   → [/generate → validator] → /messages (гарын үсэг шалгагдаж эшлэл provenance-оос).
 *
 * ⚠️ АЛТАН КЕЙС УНАВАЛ КОДЫГ ЗАСНА, assertion-ыг сулруулахгүй (§22).
 * ⚠️ B09 (масштаб) нь продод NO_VERIFIED_SOURCE — УББ 11-202-00 санд БАЙХГҮЙ; синтетик
 *    fixture нь `ai/retrieval/test/fixtures/`-д ТУСДАА (продын санд хэзээ ч орохгүй).
 * ⚠️ Зөвхөн ЛОКАЛ backend (127.0.0.1:3000) + локал runtime; прод руу ХЭЗЭЭ Ч хандахгүй.
 *
 * Гаралт: кейс бүрийн бүтэцтэй мөр (сонгосон баримт, дүрэм/томьёо, хүлээсэн/бодит, тооцооны
 * ул мөр, баталгаажилт, эцсийн эшлэл, validator, PASS/FAIL/EXPECTED_NO_SOURCE) + §29-ийн
 * 10 хэмжүүр (буруу эх сурвалжийн эшлэл, ил нэрлэсэн баримтын зөрчил, тооцооны алгасалт …).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './lib/e2e.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};
const GEN = argv.includes('--gen');
const ONLY = flag('only', '') ? new Set(flag('only', '').split(',')) : null;
const OUT = flag('out', path.join(HERE, 'reports', `norm-gold-${new Date().toISOString().slice(0, 10)}${GEN ? '-gen' : ''}.json`));

const BD = 'БД 21-101-12';
const FU_UPGRADE = 'requires_4_20_upgrade_check';
const FU_SPACING = 'requires_spacing_check';

/* ================================================================== */
/*  GOLD — A01–A10, B01–B10 (эзний багц) + paraphrase + хил + олон ээлж   */
/* ================================================================== */

const GOLD = [
  { id: 'A01', q: 'Өрөөнд 25°C авалцан асах хэмтэй шингэний уурын тэсрэлтийн илүүдэл даралт 7 кПа гарвал ямар ангилал вэ?',
    expect: { verification: 'verified', kind: 'classification', doc: BD, category: 'А', page: 4 }, mustNotCite: ['БНбД 21-04-05'] },
  { id: 'A02', q: '35°C авалцан асах хэмтэй шатамхай шингэнээс үүсэх агаар-уурын холимгийн ΔP=8 кПа бол өрөө ямар ангилал вэ?',
    expect: { verification: 'verified', kind: 'classification', doc: BD, category: 'Б', page: 4 }, mustNotNumbers: [10], mustNotCategory: ['В4'] },
  { id: 'A03', q: 'Хувийн галын ачаалал g = 2500 МДж/м² бол аль ангилал вэ?',
    expect: { verification: 'verified', kind: 'classification', doc: BD, category: 'В1', table: 4, page: 13, followupNotRequired: [FU_UPGRADE] } },
  { id: 'A04', q: 'Хувийн галын ачаалал g = 1800 МДж/м² бол эхний ангилал юу вэ?',
    expect: { verification: 'verified', kind: 'classification', doc: BD, initialCategory: 'В2', finalCategory: null, page: 13, followup: FU_UPGRADE } },
  { id: 'A05', q: 'Хувийн галын ачаалал g = 500 МДж/м² бол аль ангилал вэ?',
    expect: { verification: 'verified', kind: 'classification', doc: BD, initialCategory: 'В3', page: 13, followup: FU_UPGRADE } },
  { id: 'A06', q: 'Хувийн галын ачаалал g = 100 МДж/м² бол аль ангилал вэ?',
    expect: { verification: 'verified', kind: 'classification', doc: BD, initialCategory: 'В4', page: 13, followup: FU_SPACING } },
  { id: 'A07', q: 'Галын нийт ачаалал Q=18000 МДж, талбай S=20 м². Хувийн галын ачаалал g хэд вэ?',
    expect: { verification: 'verified', kind: 'calculation', doc: BD, value: 900, unit: 'MJ/m2', calculator: 'specificFireLoad', clause: '4.20', formula: '22', page: 13 }, mustNotCite: ['УББ-11-201-00', 'УББ 11-201-00'] },
  { id: 'A08', q: 'Q=5000 МДж, g=1000 МДж/м², H=2 м. Q ≥ 0.64 × g × H² нөхцөл биелэх үү?',
    expect: { verification: 'verified', kind: 'calculation', doc: BD, result: true, threshold: 2560, calculator: 'vCategoryUpgrade', clause: '4.20', page: 15 } },
  { id: 'A09', q: 'H=8 м үед хялбар авалцан асах шингэний галын ачааллын хэсгүүдийн хамгийн бага зай хэд вэ?',
    // ⚠️ Калькуляторын нэр ӨНДРИЙН горимоор: `liquidSpacingLow` = H < 11 м (26 − H), `High` = H ≥ 11 м (15 м).
    expect: { verification: 'verified', kind: 'calculation', doc: BD, value: 18, unit: 'm', calculator: 'liquidSpacingLow', page: 15 } },
  { id: 'A10', q: 'H=12 м үед холбогдох галын ачааллын хэсгүүдийн хамгийн бага зай хэд вэ?',
    expect: { verification: 'verified', kind: 'calculation', doc: BD, value: 15, unit: 'm', calculator: 'liquidSpacingHigh', page: 14 }, mustNotNumbers: [1.2] },
  { id: 'B01', q: 'Хувийн галын ачаалал яг 2200 МДж/м² бол В1 үү, В2 юу? Хязгаарын утгыг зөв тайлбарлаж, эх сурвалжаа дурд.',
    expect: { verification: 'verified', kind: 'classification', doc: BD, initialCategory: 'В2', table: 4, page: 13 } },
  { id: 'B02', q: 'Хувийн галын ачаалал 2201 МДж/м² бол ямар дэд ангилалд орох вэ?',
    expect: { verification: 'verified', kind: 'classification', doc: BD, category: 'В1' } },
  { id: 'B03', q: 'Хувийн галын ачаалал яг 180 МДж/м² бол ямар дэд ангилал вэ? Үүний дараа нэмэлт ямар шалгалт шаардлагатайг хэл.',
    expect: { verification: 'verified', kind: 'classification', doc: BD, initialCategory: 'В4', followup: FU_SPACING } },
  { id: 'B04', q: 'Хувийн галын ачаалал 181 МДж/м² бол ямар дэд ангилал вэ? Хязгаарын утга учраас 180-тай андуурахгүй хариул.',
    expect: { verification: 'verified', kind: 'classification', doc: BD, initialCategory: 'В3' } },
  { id: 'B05', q: 'Өрөөний геометр эзлэхүүн 750 м³. Тоног төхөөрөмжийн эзэлсэн эзлэхүүнийг тодорхойлох боломжгүй бол тооцоонд ашиглах чөлөөт эзлэхүүн хэд вэ? Томьёолон бодож, эх сурвалжаа хэл.',
    expect: { verification: 'verified', kind: 'calculation', doc: BD, value: 600, unit: 'm3', clause: '4.4', page: 6 }, mustNotValue: 750 },
  { id: 'B06', q: 'Галын нийт ачаалал Q=24,000 МДж, галын ачааллын хэсгийн талбай S=30 м². Эхлээд хувийн галын ачаалал g-г бод. Дараа нь В1–В4-ийн эхний ангиллыг тодорхойл. Эцсийн ангиллыг батлахын тулд нэмэлт өгөгдөл шаардлагатай эсэхийг бас хэл.',
    expect: { verification: 'verified', kind: 'classification', doc: BD, value: 800, initialCategory: 'В3', followup: FU_UPGRADE }, mustNotCite: ['СНиП'], mustNotCategory: ['В2'] },
  { id: 'B07', q: 'Q=2000 МДж, g=1000 МДж/м², H=2 м. Q ≥ 0.64 × g × H² нөхцөл биелэх үү? Босгыг эхлээд тооцоод дараа нь харьцуул.',
    expect: { verification: 'verified', kind: 'calculation', doc: BD, result: false, threshold: 2560, calculator: 'vCategoryUpgrade', clause: '4.20' } },
  { id: 'B08', q: 'Аппаратын даралт 200 кПа, аппаратын эзлэхүүн 10 м³ бол БД 21-101-12-ын холбогдох тооцоогоор Vₐ хэд вэ? Ямар заалт/томьёонд тулгуурласнаа хэл.',
    expect: { verification: 'verified', kind: 'calculation', doc: BD, value: 20, unit: 'm3', calculator: 'apparatusGasVolume', clause: '4.8', formula: '7', page: 8, requestedDocument: BD }, mustNotCite: ['БНбД 21-04-05'] },
  { id: 'B09', q: 'Хот суурины хөгжлийн ерөнхий төлөвлөгөөний үндсэн шийдлийг ямар масштабаар боловсруулах ёстой вэ? Зөвхөн тухайн асуултад хамаарах норм, зааврыг ашиглаж хариул.',
    expect: { noSource: true }, mustNotCite: [BD, 'СНиП', 'БНбД 21-04-05', 'УББ 11-201-00', 'УББ-11-201-00'] },
  { id: 'B10', q: 'Нормын сангаас асуултад хамгийн ойр record олдсон боловч needs_human_review=true гэж тэмдэглэгдсэн байвал тэр record дээр үндэслээд “шаардлага хангаж байна” гэсэн баттай норматив шийдвэр гаргаж болох уу? Яаж хариулах ёстой вэ?',
    expect: { verification: 'needs_human_review', authoritative: false, noCategory: true } },

  /* ── Paraphrase (§31) ────────────────────────────────────────────── */
  { id: 'P01', q: 'Khuviin galyn achaalal 2500 MJ/m2 bol yamar angilal ve?', expect: { verification: 'verified', doc: BD, category: 'В1' } },
  { id: 'P02', q: 'What is the fire hazard category if the specific fire load is 1800 MJ/m2?', expect: { verification: 'verified', doc: BD, initialCategory: 'В2', followup: FU_UPGRADE } },
  { id: 'P03', q: 'Q = 18 000 МДж, S = 20 м² байхад хувийн галын ачааллыг бод.', expect: { verification: 'verified', kind: 'calculation', doc: BD, value: 900, unit: 'MJ/m2' } },

  /* ── Хил (§30) ───────────────────────────────────────────────────── */
  { id: 'E01', q: 'Хувийн галын ачаалал 1400 МДж/м² бол ямар дэд ангилал вэ?', expect: { verification: 'verified', doc: BD, initialCategory: 'В3' } },
  { id: 'E02', q: 'Хувийн галын ачаалал 1401 МДж/м² бол ямар дэд ангилал вэ?', expect: { verification: 'verified', doc: BD, initialCategory: 'В2' } },
  { id: 'E03', q: 'Авалцан асах хэм 27.9 °C шингэн, ΔP = 6 кПа бол өрөө ямар ангилал вэ?', expect: { verification: 'verified', doc: BD, category: 'А' } },
  { id: 'E04', q: 'Авалцан асах хэм яг 28.0 °C шингэн, ΔP = 6 кПа бол өрөө ямар ангилал вэ?', expect: { verification: 'needs_human_review', authoritative: false, warning: 'source_boundary_conflict', noCategory: true } },
  { id: 'E05', q: 'Авалцан асах хэм 28.1 °C шингэн, ΔP = 6 кПа бол өрөө ямар ангилал вэ?', expect: { verification: 'verified', doc: BD, category: 'Б' } },
  { id: 'E06', q: 'Шатамхай хий, авалцан асах хэм 20 °C, ΔP = 5 кПа бол өрөө ямар ангилал вэ?', expect: { verification: 'verified', doc: BD, kind: 'insufficient_context', noCategory: true } },

  /* ── Ил нэрлэсэн баримт (P0-3) — бүртгэлд байхгүй, санд байгаа ────── */
  { id: 'D01', q: 'БНбД 21-04-05-ын дагуу хувийн галын ачаалал g = 1800 МДж/м² бол ямар ангилал вэ?',
    expect: { noTrusted: true, evidenceDocOnly: 'БНбД 21-04-05' }, mustNotCite: [BD] },
];

/** 5 ээлжийн бохирдлын дараалал (§13 multi-turn): норм → ERP → норм follow-up → ERP → норм. */
const MULTI = [
  { id: 'M1', q: 'Хувийн галын ачаалал g = 1800 МДж/м² бол эхний ангилал юу вэ?', expect: { verification: 'verified', doc: BD, initialCategory: 'В2', followup: FU_UPGRADE } },
  { id: 'M2', q: 'Хэдэн идэвхтэй төсөл байна?', expect: { noTrusted: true, erp: true } },
  { id: 'M3', q: 'Q=50000 МДж, H=6 м', expect: { verification: 'verified', doc: BD, initialCategory: 'В2', finalCategory: 'В1', calculator: 'vCategoryUpgrade', usedPrior: true } },
  { id: 'M4', q: 'Тэгвэл хамгийн ойр deadline-тай төсөл аль нь вэ?', expect: { noTrusted: true, erp: true } },
  { id: 'M5', q: 'Хувийн галын ачаалал g = 100 МДж/м² бол?', expect: { verification: 'verified', doc: BD, initialCategory: 'В4', followup: FU_SPACING, notFinalCategory: 'В1' } },
];

/* ================================================================== */
/*  Туслахууд                                                          */
/* ================================================================== */

const fold = (s) => String(s ?? '').toLowerCase().replace(/[–—]/g, '-').replace(/[\s_]+/g, '').replace(/бнбд/g, 'bnbd').replace(/убб/g, 'ubb').replace(/бд/g, 'bd').replace(/снип/g, 'snip');
const DOC_RE = /(?:БНбД|БД|MNS|УББ|BNbD|BD|UBB|СНиП|SNiP)\s*[-\s]?\s*\d{2}[-\s]\d{2,3}[-\s]\d{2}(?:[-\s]\d{2})?/giu;
const num = (v) => (typeof v === 'number' ? v : Number(String(v).replace(',', '.')));
const approx = (a, b) => Math.abs(num(a) - num(b)) < 1e-6;

function check(list, ok, label, detail) {
  list.push({ ok: Boolean(ok), label, detail: detail === undefined ? null : detail });
}

function citesDoc(text, code) {
  const f = fold(code);
  for (const m of String(text ?? '').match(DOC_RE) ?? []) if (fold(m) === f) return true;
  // «СНиП» гэх мэт угтварыг л шалгах
  if (!/\d/.test(code)) return new RegExp(code, 'iu').test(String(text ?? ''));
  return false;
}

/* ================================================================== */
/*  Нэг кейсийн үнэлгээ                                                */
/* ================================================================== */

function evaluate(g, t, metrics) {
  const checks = [];
  const tnr = t.ctx.trusted_norm_result ?? null;
  const trace = t.ctx.norm_trace ?? {};
  const contract = t.ctx.trusted_contract ?? null;
  const saved = t.saved ?? null;
  const final = t.answer ?? null;
  const e = g.expect;
  const cited = new Set([...(saved?.citations ?? []).map((c) => c.documentUid).filter(Boolean), ...(tnr?.provenance ?? []).map((p) => p.documentCode)]);
  const evidenceDocs = [...new Set((t.ctx.evidence ?? []).map((x) => x.document_uid).filter(Boolean))];

  if (e.noSource) {
    // B09 — прод: NO_VERIFIED_SOURCE, хамааралгүй эшлэл 0.
    const refusal = contract !== null && contract.answerMode === 'refusal' && contract.noMatch === true;
    check(checks, tnr === null || tnr.verification === 'no_verified_source' || tnr.verification === 'named_document_absent', 'TrustedNormResult: verified БИШ', tnr?.verification ?? null);
    check(checks, refusal, 'гэрээ = refusal + noMatch', contract ? `${contract.answerMode}/${contract.legacyKind}/noMatch=${contract.noMatch}` : null);
    check(checks, (saved?.citations ?? []).length === 0, '/messages эшлэл 0', saved?.citations?.length ?? null);
    check(checks, (t.ctx.evidence ?? []).length === 0, 'нотолгоо 0 (хамааралгүй заалт орохгүй)', evidenceDocs);
    check(checks, t.ctx.local_norm?.status !== 'supported' && t.ctx.local_norm?.status !== 'verified', 'локал сан хамаарлын хаалгаар татгалзсан', t.ctx.local_norm?.status ?? null);
    for (const c of g.mustNotCite ?? []) {
      const bad = [...cited].some((d) => fold(d) === fold(c)) || evidenceDocs.some((d) => fold(d) === fold(c)) || (final !== null && citesDoc(final, c));
      check(checks, !bad, `эшлэлгүй: ${c}`);
      if (bad) metrics.wrong_source_citations += 1;
    }
    return checks;
  }

  if (e.noTrusted) {
    check(checks, tnr === null, 'TrustedNormResult байхгүй (хөдөлгүүр өөр баримтаас хариулахгүй)', tnr ? `${tnr.verification}/${tnr.documentCode}` : null);
    if (e.evidenceDocOnly) {
      const only = evidenceDocs.every((d) => fold(d) === fold(e.evidenceDocOnly));
      check(checks, only && evidenceDocs.length > 0, `нотолгоо ЗӨВХӨН ${e.evidenceDocOnly}`, evidenceDocs);
      if (!only) metrics.explicit_document_violations += 1;
      check(checks, trace.local_named_document?.code != null && trace.local_named_document?.absent === false, 'локал хайлт нэрлэсэн баримтад цоожлогдсон', trace.local_named_document ?? null);
    }
    if (e.erp) check(checks, (t.tools ?? []).length > 0 || t.plan.intent === 'COMPANY_FACT' || t.plan.intent === 'ERP_ANALYSIS', 'ERP ээлж (хэрэгсэл/санаа)', `${t.plan.intent}:${(t.tools ?? []).map((x) => x.tool).join(',')}`);
    for (const c of g.mustNotCite ?? []) {
      const bad = evidenceDocs.some((d) => fold(d) === fold(c)) || (final !== null && citesDoc(final, c));
      check(checks, !bad, `эшлэлгүй: ${c}`);
      if (bad) metrics.explicit_document_violations += 1;
    }
    return checks;
  }

  // ── Детерминист үр дүн (Level 1) ─────────────────────────────────
  check(checks, tnr !== null, 'TrustedNormResult байна');
  if (tnr === null) return checks;
  check(checks, t.ctx.trusted_norm_sig != null, 'гарын үсэг байна');
  check(checks, tnr.verification === e.verification, `verification = ${e.verification}`, tnr.verification);
  if (e.authoritative !== undefined) check(checks, tnr.authoritative === e.authoritative, `authoritative = ${e.authoritative}`, tnr.authoritative);
  else check(checks, tnr.authoritative === (e.verification === 'verified'), 'authoritative ↔ verified', tnr.authoritative);
  if (e.kind) check(checks, tnr.answerKind === e.kind, `answerKind = ${e.kind}`, tnr.answerKind);
  if (e.doc) {
    check(checks, tnr.documentCode === e.doc, `баримт = ${e.doc}`, tnr.documentCode);
    const provOk = tnr.provenance.length > 0 && tnr.provenance.every((p) => p.documentCode === e.doc);
    check(checks, provOk, 'provenance бүгд тэр баримтаас', tnr.provenance.map((p) => p.documentCode));
    if (!provOk) metrics.wrong_source_citations += 1;
  }
  if (e.requestedDocument) check(checks, tnr.requestedDocument === e.requestedDocument, 'ил нэрлэсэн баримт хүндэтгэгдсэн', tnr.requestedDocument);
  const cat = e.category ?? null;
  if (cat) check(checks, tnr.finalCategory === cat || (tnr.finalCategory === null && tnr.initialCategory === cat), `ангилал = ${cat}`, `${tnr.initialCategory}→${tnr.finalCategory}`);
  if (e.initialCategory !== undefined) check(checks, tnr.initialCategory === e.initialCategory, `эхний ангилал = ${e.initialCategory}`, tnr.initialCategory);
  if (e.finalCategory !== undefined) check(checks, tnr.finalCategory === e.finalCategory, `эцсийн ангилал = ${e.finalCategory}`, tnr.finalCategory);
  if (e.notFinalCategory) check(checks, tnr.finalCategory !== e.notFinalCategory && tnr.initialCategory !== e.notFinalCategory, `өмнөх ээлжийн ${e.notFinalCategory} бохирдуулаагүй`, `${tnr.initialCategory}→${tnr.finalCategory}`);
  if (e.noCategory) check(checks, tnr.finalCategory === null && (tnr.allowedCategories ?? []).length === 0 || tnr.answerKind === 'insufficient_context', 'ангилал/PASS хэлэхгүй', `${tnr.finalCategory}/${(tnr.allowedCategories ?? []).join(',')}`);
  if (e.value !== undefined) {
    const v = tnr.answerKind === 'calculation' ? tnr.value : tnr.calculation?.result ?? tnr.value;
    const got = typeof v === 'number' ? v : tnr.calculation && typeof tnr.calculation.result === 'number' ? tnr.calculation.result : v;
    const ok = approx(got, e.value) || (tnr.calculation && Object.values(tnr.calculation.inputs ?? {}).some((x) => approx(x, e.value)) && tnr.answerKind === 'classification');
    check(checks, ok, `үр дүн = ${e.value}`, got);
    if (!ok) metrics.calculation_bypass += 1;
  }
  if (e.unit) check(checks, tnr.unit === e.unit || tnr.calculation?.unit === e.unit, `нэгж = ${e.unit}`, tnr.unit ?? tnr.calculation?.unit);
  if (e.result !== undefined) check(checks, tnr.calculation?.result === e.result, `нөхцөл = ${e.result}`, tnr.calculation?.result);
  if (e.threshold !== undefined) {
    const steps = (tnr.calculation?.steps ?? []).join(' ');
    check(checks, steps.includes(String(e.threshold)), `босго ${e.threshold} тооцооны ул мөрд`, steps.slice(0, 120));
  }
  if (e.calculator) {
    check(checks, tnr.calculation?.calculatorId === e.calculator, `калькулятор = ${e.calculator}`, tnr.calculation?.calculatorId ?? null);
    if (tnr.calculation?.calculatorId !== e.calculator) metrics.formula_selection_failures += 1;
  }
  if (e.clause) check(checks, tnr.provenance.some((p) => p.clause === e.clause || p.section === e.clause || (p.formula && p.clause === e.clause)), `заалт ${e.clause} provenance-д`, tnr.provenance.map((p) => p.clause ?? p.section));
  if (e.formula) check(checks, tnr.provenance.some((p) => String(p.formula) === String(e.formula)), `томьёо ${e.formula} provenance-д`, tnr.provenance.map((p) => p.formula));
  if (e.table) check(checks, tnr.provenance.some((p) => p.table === e.table), `Хүснэгт ${e.table} provenance-д`, tnr.provenance.map((p) => p.table));
  if (e.page) check(checks, tnr.provenance.some((p) => p.page === e.page), `хуудас ${e.page} provenance-д`, tnr.provenance.map((p) => p.page));
  if (e.followup) {
    const f = tnr.followups.find((x) => x.id === e.followup);
    check(checks, f !== undefined && f.required === true, `follow-up ${e.followup} ШААРДЛАГАТАЙ`, tnr.followups.map((x) => `${x.id}:${x.required}`));
    if (!f || !f.required) metrics.followup_omissions += 1;
  }
  for (const id of e.followupNotRequired ?? []) {
    const f = tnr.followups.find((x) => x.id === id);
    check(checks, !f || f.required === false, `follow-up ${id} шаардлагагүй`, f ? f.required : 'байхгүй');
  }
  if (e.warning) check(checks, tnr.warnings.includes(e.warning), `анхааруулга ${e.warning}`, tnr.warnings);
  if (e.usedPrior) check(checks, trace.used_prior === true, 'өмнөх ээлжийн оролт нэгтгэгдсэн', trace.used_prior);
  if (e.verification === 'needs_human_review') {
    const leak = contract !== null && contract.answerMode !== 'refusal';
    check(checks, !leak, 'гэрээ = refusal (PASS/FAIL хориотой)', contract?.answerMode);
    if (leak) metrics.human_review_leakage += 1;
  }
  // Хүчин төгөлдөр байдал: BD 21-101-12 нь «хуучин» БИШ — трейлер байхгүй, товч тэмдэглэл.
  if (e.doc === BD) {
    const trailer = contract?.trailerText ?? null;
    const bad = trailer !== null && /хуучин|superseded|түүхэн/iu.test(trailer);
    check(checks, !bad, 'buruu «хуучин» трейлер БАЙХГҮЙ (Amendment D)', trailer ? trailer.slice(0, 60) : null);
    if (bad) metrics.incorrect_historical_warnings += 1;
    check(checks, tnr.currentness === 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED', 'currentness = CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED', tnr.currentness);
  }
  if (e.mustNotValue !== undefined) check(checks, !approx(tnr.value, e.mustNotValue), `үр дүн ≠ ${e.mustNotValue}`, tnr.value);

  // ── Гэрээ + /messages (Amendment B: нэг үр дүн, эшлэл provenance-оос) ──
  if (contract) {
    check(checks, contract.version === 'tfc-2' && contract.norm != null, 'tfc-2 нормын блок', contract.version);
    if (tnr.verification === 'verified') {
      check(checks, contract.answerMode === 'authoritative', 'гэрээ = authoritative', contract.answerMode);
      check(checks, (contract.requiredCitations ?? []).every((c) => fold(c) === fold(tnr.documentCode)), 'заавал эшлэл = provenance баримт', contract.requiredCitations);
    }
  }
  if (saved && !saved.error) {
    const docs = [...new Set((saved.citations ?? []).map((c) => c.documentUid))];
    const bound = (saved.citations ?? []).length === tnr.provenance.length && docs.every((d) => d === tnr.documentCode);
    check(checks, tnr.provenance.length === 0 || bound, '/messages эшлэл = provenance (гарын үсэг тэнцсэн)', `${(saved.citations ?? []).length}/${tnr.provenance.length} · ${docs.join(',')}`);
    if (tnr.provenance.length > 0 && !bound) metrics.wrong_source_citations += 1;
    const expConf = tnr.verification === 'verified' ? (tnr.answerKind === 'insufficient_context' ? 'supported' : 'verified') : tnr.verification === 'needs_human_review' ? 'uncertain' : null;
    if (expConf && t.ctx.show_confidence) check(checks, saved.confidence === expConf, `итгэл = ${expConf}`, saved.confidence);
  } else if (saved?.error) {
    check(checks, false, '/messages амжилттай', saved.error);
  }

  // ── Level 2: эцсийн хариулт (загвар/засвар/template) ──────────────
  if (final !== null) {
    const codesInAnswer = [...new Set((final.match(DOC_RE) ?? []).map((x) => x))];
    const foreign = codesInAnswer.filter((c) => fold(c) !== fold(tnr.documentCode) && !(contract?.norm?.documentAliases ?? []).some((a) => fold(a) === fold(c)));
    check(checks, foreign.length === 0, 'эцсийн хариултад provenance-ийн бус баримт алга', foreign);
    if (foreign.length > 0) metrics.wrong_source_citations += 1;
    if (tnr.documentCode) check(checks, citesDoc(final, tnr.documentCode) || final.includes(tnr.documentCode), 'эцсийн хариулт provenance баримтыг эшилсэн');
    if (tnr.verification === 'verified' && tnr.finalCategory) {
      const cats = [...final.matchAll(/(?<![\p{L}\d])([АБВГД](?:[1-4])?)(?![\p{L}\d])/gu)].map((m) => m[1]);
      check(checks, cats.includes(tnr.finalCategory), `эцсийн ангилал ${tnr.finalCategory} хариултад`, cats);
    }
    if (tnr.verification === 'verified' && tnr.answerKind === 'calculation' && typeof tnr.value === 'number') {
      check(checks, new RegExp(`(?<![\\d.,])${String(tnr.value).replace('.', '[.,]')}(?![\\d])`).test(final.replace(/[  ](?=\d{3})/g, '')), `үр дүн ${tnr.value} хариултад`);
    }
    for (const f of tnr.followups.filter((x) => x.required)) {
      const ok = final.includes(f.textMn) || (f.textEn && final.includes(f.textEn));
      check(checks, ok, `follow-up өгүүлбэр (${f.id}) хариултад`);
      if (!ok) metrics.followup_omissions += 1;
    }
    if (tnr.verification === 'needs_human_review') {
      // Серверийн канон өгүүлбэр («…«шаардлага хангаж байна» гэж хэлж болохгүй») нь өөрөө
      // тэр хэллэгийг агуулдаг — түүнийг хасаад ЗАГВАРЫН нэмсэн текстийг л шалгана.
      let own = final;
      for (const t of [contract?.requiredSentence, contract?.template, tnr.textMn]) if (t) own = own.split(t).join(' ');
      const cats = [...own.matchAll(/(?<![\p{L}\d])[АБВГД](?:[1-4])?(?![\p{L}\d])/gu)].map((m) => m[0]);
      // «шаардлага хангаж байна» гэж ҮГҮЙСГЭСЭН өгүүлбэр («…гэж хэлж болохгүй») нь гоожилт БИШ —
      // зөвхөн үгүйсгэлгүй, баттай PASS/FAIL мэдэгдэл.
      const pass = own
        .split(/(?<=[.!?])\s+|\n+/u)
        .some((sent) => /шаардлага хангаж байна|хангана|PASS|FAIL/iu.test(sent) && !/болохгүй|биш|үгүй|хориотой|бүү|хүлээ|баталгаажуул|шаардлагатай/iu.test(sent));
      check(checks, cats.length === 0 && !pass, 'хүний хяналт: ангилал/PASS/FAIL ХЭЛЭЭГҮЙ', cats);
      if (cats.length > 0 || pass) metrics.human_review_leakage += 1;
    }
    for (const n of g.mustNotNumbers ?? []) {
      const bad = new RegExp(`(?<![\\d.,])${String(n).replace('.', '[.,]')}(?![\\d])`).test(final);
      check(checks, !bad, `хариултад ${n} байхгүй`);
      if (bad) metrics.unsupported_numeric_claims += 1;
    }
    for (const c of g.mustNotCategory ?? []) {
      const bad = new RegExp(`(?<![\\p{L}\\d])${c}(?![\\p{L}\\d])`, 'u').test(final) && !(contract?.norm?.template ?? '').includes(c);
      check(checks, !bad, `хариултад ${c} зарлаагүй`);
    }
    for (const c of g.mustNotCite ?? []) {
      const bad = citesDoc(final, c);
      check(checks, !bad, `хариултад ${c} эшлээгүй`);
      if (bad) metrics.wrong_source_citations += 1;
    }
    if (t.rec) {
      check(checks, t.rec.finalValid !== false, 'validator: эцсийн хариулт гэрээнд нийцсэн', t.rec.source);
      if (t.rec.finalValid === false) metrics.unsupported_numeric_claims += 1;
    }
  }
  return checks;
}

/* ================================================================== */
/*  Гүйлт                                                              */
/* ================================================================== */

const client = createClient({ api: flag('api', 'http://127.0.0.1:3000/api'), rt: flag('rt', 'http://127.0.0.1:39217'), gen: GEN, maxTokens: 700 });
const sess = await client.login(flag('user', 'A.Anand'), flag('pass', 'admin123'));
const ident = await client.identity('norm-gold');
console.log(`login ok · mode=${sess.mode} · gen=${GEN} · prompt=${ident.system_prompt_version}`);

const metrics = {
  wrong_source_citations: 0,
  explicit_document_violations: 0,
  calculation_bypass: 0,
  formula_selection_failures: 0,
  unsupported_numeric_claims: 0,
  followup_omissions: 0,
  human_review_leakage: 0,
  incorrect_historical_warnings: 0,
  retrieval_failure_no_match_confusion: 0,
  multi_turn_contamination: 0,
};

async function newConv(label) {
  const r = await client.api('/mgl-ai/conversations', { surface: 'web', title: `norm-gold ${label}` }).catch(() => null);
  return r?.conv_uid ?? null;
}

async function runCase(g, conv, history, state, seq, extra = {}) {
  const t0 = Date.now();
  const t = await client.turn(conv, g.q, history, state, seq, { persist: true, answerFromTemplate: !GEN, ...extra });
  const checks = evaluate(g, t, metrics);
  const tnr = t.ctx.trusted_norm_result ?? null;
  const trace = t.ctx.norm_trace ?? {};
  const contract = t.ctx.trusted_contract ?? null;
  const ok = checks.every((c) => c.ok);
  const status = g.expect.noSource ? (ok ? 'EXPECTED_NO_SOURCE' : 'FAIL') : ok ? 'PASS' : 'FAIL';
  const row = {
    id: g.id, status, ms: Date.now() - t0, q: g.q,
    intent: t.plan.intent, turn: t.plan.turn?.kind ?? null,
    selected_document: tnr?.documentCode ?? trace.selected_document ?? null,
    selected_rule: tnr?.rule?.ruleId ?? null,
    selected_formula: tnr?.calculation?.formulaId ?? tnr?.calculation?.calculatorId ?? null,
    expected: g.expect,
    actual: tnr ? { verification: tnr.verification, kind: tnr.answerKind, authoritative: tnr.authoritative, initial: tnr.initialCategory, final: tnr.finalCategory, value: tnr.value, unit: tnr.unit, result: tnr.calculation?.result ?? null, followups: tnr.followups.map((f) => `${f.id}:${f.required}`), warnings: tnr.warnings } : null,
    calculation_trace: tnr?.calculation?.steps ?? [],
    verification: tnr?.verification ?? (contract?.legacyKind ?? null),
    currentness: tnr?.currentness ?? t.ctx.local_norm?.currentness ?? null,
    final_citation: (t.saved?.citations ?? []).map((c) => c.title),
    provenance: tnr?.provenance.map((p) => p.labelMn) ?? [],
    contract: contract ? { version: contract.version, mode: contract.answerMode, legacyKind: contract.legacyKind, noMatch: contract.noMatch, trailer: contract.trailerText ? contract.trailerText.slice(0, 50) : null } : null,
    validator: t.rec ? { source: t.rec.source, attempts: t.rec.attempts, violations: t.rec.violations, finalValid: t.rec.finalValid ?? null } : null,
    confidence: t.saved?.confidence ?? null,
    local_norm: t.ctx.local_norm ? { status: t.ctx.local_norm.status, used: t.ctx.local_norm.used_as_evidence, no_match: t.ctx.local_norm.no_match_reason ?? null, named: t.ctx.local_norm.named_document ?? null, drift: t.ctx.local_norm.drift ?? null } : null,
    retrieval: trace.retrieval ?? null,
    final_answer: t.answer,
    checks,
  };
  const failed = checks.filter((c) => !c.ok);
  console.log(`${status.padEnd(18)} ${g.id}  doc=${row.selected_document ?? '—'}  ${row.actual ? `${row.actual.verification}/${row.actual.kind} ${row.actual.initial ?? ''}${row.actual.final ? '→' + row.actual.final : ''} ${row.actual.value ?? ''}${row.actual.unit ?? ''}` : (contract?.legacyKind ?? 'no-contract')}  cite=${row.final_citation.length}${t.rec?.source ? `  src=${t.rec.source}` : ''}`);
  for (const f of failed) console.log(`      ✗ ${f.label}${f.detail !== null ? ` — ${JSON.stringify(f.detail).slice(0, 160)}` : ''}`);
  return { row, t };
}

const rows = [];

/* ── Single-turn ──────────────────────────────────────────────────── */
for (const g of GOLD) {
  if (ONLY && !ONLY.has(g.id)) continue;
  const conv = await newConv(g.id);
  try {
    const { row } = await runCase(g, conv, [], null, 0);
    rows.push(row);
  } catch (err) {
    console.log(`FAIL               ${g.id}  ERROR ${String(err.message).slice(0, 200)}`);
    rows.push({ id: g.id, status: 'FAIL', error: String(err.message).slice(0, 400), q: g.q });
  }
}

/* ── Multi-turn (§13) ─────────────────────────────────────────────── */
if (!ONLY || [...ONLY].some((x) => x.startsWith('M'))) {
  console.log('\nОЛОН ЭЭЛЖ — норм → ERP → норм follow-up → ERP → норм (нэг яриа)');
  const conv = await newConv('multi');
  let history = [];
  let state = null;
  let seq = 0;
  for (const g of MULTI) {
    if (ONLY && !ONLY.has(g.id)) continue;
    try {
      const { row, t } = await runCase(g, conv, history, state, seq);
      row.history_messages = t.ctx.context_diag?.history_messages ?? null;
      // Өмнөх ХАРИУЛТЫН текст prompt-д орсон уу (prompt frame-ийн зориудын assistant ээлж биш).
      const priorAnswers = history.filter((h) => h.role === 'assistant' && h.content.length > 40).map((h) => h.content.slice(0, 60));
      // Зөвхөн prompt-ын ТҮҮХИЙН assistant ээлжид — шийдвэрийн блок ижил өгүүлбэр агуулж болно.
      row.prompt_has_prior_answer = t.ctx.turns.some((x) => x.role === 'assistant' && priorAnswers.some((a) => x.content.includes(a)));
      if (g.expect.verification && row.prompt_has_prior_answer) {
        row.checks.push({ ok: false, label: 'детерминист ээлжид өмнөх ХАРИУЛТ prompt-д орохгүй', detail: null });
        row.status = 'FAIL';
        metrics.multi_turn_contamination += 1;
      }
      if (row.status === 'FAIL' && g.expect.verification) metrics.multi_turn_contamination += row.checks.some((c) => !c.ok && /бохирдуулаагүй|өмнөх ээлжийн оролт/.test(c.label)) ? 1 : 0;
      rows.push(row);
      history = [...history, { role: 'user', content: g.q }, { role: 'assistant', content: t.answer ?? '' }].slice(-10);
      state = t.ctx.conv_state_next ?? state;
      seq += 2;
    } catch (err) {
      console.log(`FAIL               ${g.id}  ERROR ${String(err.message).slice(0, 200)}`);
      rows.push({ id: g.id, status: 'FAIL', error: String(err.message).slice(0, 400), q: g.q });
    }
  }
}

/* ── Хайлт унасан ≠ олдсонгүй (P0-14) ─────────────────────────────── */
if (!ONLY || ONLY.has('R01') || ONLY.has('R02')) {
  console.log('\nХАЙЛТ УНАСАН ≠ ОЛДСОНГҮЙ');
  const conv = await newConv('retrieval');
  const qNoRule = 'Барилгын захиалагчийн үүрэг, хариуцлага нормын дагуу юу вэ?';
  for (const [id, override, expectKind] of [
    ['R01', { answer: null, attempted: true, reason: 'timeout' }, 'norm_unavailable'],
    ['R02', { answer: { status: 'insufficient_evidence', no_match_reason: 'no_content_overlap', evidence: [], citation: null, rule_id: null }, attempted: true, reason: 'ok' }, 'no_match'],
  ]) {
    if (ONLY && !ONLY.has(id)) continue;
    try {
      const t = await client.turn(conv, qNoRule, [], null, 0, { normOverride: override, persist: false, answerFromTemplate: true });
      const c = t.ctx.trusted_contract;
      const checks = [];
      if (expectKind === 'norm_unavailable') {
        check(checks, c?.legacyKind === 'norm_unavailable' || t.ctx.norm_trace?.retrieval?.failed === true, 'хайлт унасан → norm_unavailable (retrieval_failed)', c?.legacyKind);
        check(checks, c?.noMatch !== true, 'noMatch БИШ (олдсонгүй гэж хэлэхгүй)', c?.noMatch);
        check(checks, (c?.requiredSentence ?? '').length > 0 && !/олдсонгүй/u.test(c?.requiredSentence ?? ''), 'канон өгүүлбэр «амжсангүй», «олдсонгүй» биш', c?.requiredSentence);
      } else {
        check(checks, c?.noMatch === true || c?.legacyKind === 'norm_refusal', 'олдсонгүй → refusal/noMatch', `${c?.legacyKind}/${c?.noMatch}`);
        check(checks, c?.legacyKind !== 'norm_unavailable', 'хайлт унасан гэж хэлэхгүй', c?.legacyKind);
      }
      const ok = checks.every((x) => x.ok);
      if (!ok) metrics.retrieval_failure_no_match_confusion += 1;
      rows.push({ id, status: ok ? 'PASS' : 'FAIL', q: qNoRule, contract: c ? { mode: c.answerMode, legacyKind: c.legacyKind, noMatch: c.noMatch, requiredSentence: c.requiredSentence } : null, retrieval: t.ctx.norm_trace?.retrieval ?? null, checks });
      console.log(`${(ok ? 'PASS' : 'FAIL').padEnd(18)} ${id}  ${c?.legacyKind ?? '—'} noMatch=${c?.noMatch}`);
      for (const f of checks.filter((x) => !x.ok)) console.log(`      ✗ ${f.label} — ${JSON.stringify(f.detail)}`);
    } catch (err) {
      rows.push({ id, status: 'FAIL', error: String(err.message).slice(0, 400) });
      console.log(`FAIL               ${id}  ERROR ${String(err.message).slice(0, 200)}`);
    }
  }
}

/* ── Amendment A: локал сангийн хувилбар ≠ бүртгэл → data_version_mismatch ── */
if (!ONLY || ONLY.has('V01')) {
  console.log('\nХУВИЛБАРЫН ЗӨРҮҮ — локал БД 21-101-12 багцын SHA ≠ бүртгэлийн SHA');
  const conv = await newConv('drift');
  try {
    const g = GOLD.find((x) => x.id === 'A03');
    // Локал runtime ижил баримтаас ӨӨР хувилбарын багц (SHA зөрсөн) буцаасан мэт.
    const fakeLocal = {
      status: 'supported', rule_id: 'BD-21-101-12-2012:table:table_4:V1', no_match_reason: null, named_document: null,
      citation: { document: 'БД 21-101-12', label_mn: 'БД 21-101-12, Хүснэгт 4, хуудас 13', clause: null, page: 13, effective_status: 'current_status_not_checked_for_later_amendments', legal_review_required: true, dataset_sha256: 'f'.repeat(64), dataset_version: '1' },
      evidence: [{ chunk_id: 'BD-21-101-12-2012:table:table_4:V1', doc_id: 'BD-21-101-12-2012', code: 'БД 21-101-12', kind: 'table_row', text_mn: 'В1 ангилал: хувийн галын ачаалал g > 2200 МДж/м²', page: 13, clause_no: null, verification_status: 'verified_from_page_image', score: 0.02 }],
    };
    const t = await client.turn(conv, g.q, [], null, 0, { normOverride: { answer: fakeLocal, attempted: true, reason: 'ok' }, persist: true, answerFromTemplate: true });
    const tnr = t.ctx.trusted_norm_result;
    const c = t.ctx.trusted_contract;
    const checks = [];
    check(checks, tnr?.verification === 'data_version_mismatch', 'verification = data_version_mismatch', tnr?.verification);
    check(checks, tnr?.authoritative === false, 'authoritative = false', tnr?.authoritative);
    check(checks, (tnr?.warnings ?? []).some((w) => /NORM_DATA_VERSION_MISMATCH/.test(w)), 'NORM_DATA_VERSION_MISMATCH анхааруулга', tnr?.warnings);
    check(checks, c?.answerMode === 'refusal' && (c?.allowedCategories ?? []).length === 0, 'гэрээ = refusal, ангилал хориотой', `${c?.answerMode}/${(c?.allowedCategories ?? []).join(',')}`);
    check(checks, t.ctx.norm_trace?.drift?.status === 'mismatch', 'drift.status = mismatch', t.ctx.norm_trace?.drift?.status);
    check(checks, (t.ctx.evidence ?? []).length === 0, 'зөрсөн хувилбарын заалт нотолгоо болохгүй', (t.ctx.evidence ?? []).length);
    check(checks, t.saved?.confidence !== 'verified', '«Баталгаажсан» БИШ', t.saved?.confidence);
    const ok = checks.every((x) => x.ok);
    rows.push({ id: 'V01', status: ok ? 'PASS' : 'FAIL', q: g.q, checks, actual: tnr ? { verification: tnr.verification, warnings: tnr.warnings } : null });
    console.log(`${(ok ? 'PASS' : 'FAIL').padEnd(18)} V01  ${tnr?.verification} drift=${t.ctx.norm_trace?.drift?.status}`);
    for (const f of checks.filter((x) => !x.ok)) console.log(`      ✗ ${f.label} — ${JSON.stringify(f.detail)}`);
  } catch (err) {
    rows.push({ id: 'V01', status: 'FAIL', error: String(err.message).slice(0, 400) });
    console.log(`FAIL               V01  ERROR ${String(err.message).slice(0, 200)}`);
  }
}

/* ── Гарын үсэг (Amendment B): хөтчийн өөрчилсөн үр дүн хаягдана ──── */
if (!ONLY || ONLY.has('S01')) {
  console.log('\nГАРЫН ҮСЭГ — хөтчөөс өөрчилсөн TrustedNormResult /messages-д хаягдана');
  const conv = await newConv('sig');
  try {
    const g = GOLD.find((x) => x.id === 'A03');
    const t = await client.turn(conv, g.q, [], null, 0, {
      persist: true, answerFromTemplate: true,
      tamperResult: (r) => (r ? { ...r, finalCategory: 'В4', initialCategory: 'В4', textMn: 'В4' } : r),
    });
    const checks = [];
    check(checks, t.ctx.trusted_norm_result?.finalCategory === 'В1' || t.ctx.trusted_norm_result?.initialCategory === 'В1', '/context үр дүн В1', t.ctx.trusted_norm_result?.initialCategory);
    check(checks, (t.saved?.citations ?? []).length === 0 || (t.saved?.citations ?? []).every((c) => !c.id.startsWith('norm:')), 'өөрчилсөн үр дүн → provenance эшлэл ҮГҮЙ (гарын үсэг таарсангүй)', (t.saved?.citations ?? []).map((c) => c.id));
    check(checks, t.saved?.confidence !== 'verified', 'өөрчилсөн үр дүн → «Баталгаажсан» БИШ', t.saved?.confidence);
    const ok = checks.every((x) => x.ok);
    rows.push({ id: 'S01', status: ok ? 'PASS' : 'FAIL', q: g.q, checks, saved: t.saved });
    console.log(`${(ok ? 'PASS' : 'FAIL').padEnd(18)} S01  citations=${(t.saved?.citations ?? []).length} confidence=${t.saved?.confidence}`);
    for (const f of checks.filter((x) => !x.ok)) console.log(`      ✗ ${f.label} — ${JSON.stringify(f.detail)}`);
  } catch (err) {
    rows.push({ id: 'S01', status: 'FAIL', error: String(err.message).slice(0, 400) });
    console.log(`FAIL               S01  ERROR ${String(err.message).slice(0, 200)}`);
  }
}

/* ── Хураангуй ────────────────────────────────────────────────────── */
const counts = { PASS: 0, FAIL: 0, EXPECTED_NO_SOURCE: 0 };
for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
const level1 = rows.filter((r) => /^[ABPED]/.test(r.id) && !r.expected?.noSource);
const level1Pass = level1.filter((r) => r.status === 'PASS').length;
console.log(`\nΣ PASS ${counts.PASS} · FAIL ${counts.FAIL} · EXPECTED_NO_SOURCE ${counts.EXPECTED_NO_SOURCE}  (Level 1 ${level1Pass}/${level1.length}${GEN ? ' — Level 2 (загвар) орсон' : ''})`);
console.log('§29 хэмжүүр:', JSON.stringify(metrics));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), gen: GEN, identity: ident, counts, metrics, rows }, null, 2));
console.log(`→ ${OUT}`);
process.exit(counts.FAIL > 0 ? 1 : 0);
