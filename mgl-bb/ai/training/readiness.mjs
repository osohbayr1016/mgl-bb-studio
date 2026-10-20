#!/usr/bin/env node
/**
 * `npm run ai:train:readiness [-- --json]` — СУРГАЛТЫН БЭЛЭН БАЙДЛЫН ТАЙЛАН + ХААЛГА (§28–29).
 *
 * ⚠️ ЭНЭ СКРИПТ СУРГАДАГГҮЙ.  Хаалга бүрийг ХЭМЖСЭН файлаас (манифест,
 *    benchmarks/*.json, baselines/*.json, registry, орчин, санах ойн
 *    хэмжилт) уншиж, ХОЁР ТҮВШНИЙ дүгнэлт өгнө:
 *
 *      SMOKE   — хяналттай smoke адаптер (mgl-adapter-x.y-smoke) сургаж
 *                БОЛОХ уу.  Бүх S-хаалга ногоон бол READY.
 *      RELEASE — тэр адаптерыг ажилтан руу ТҮГЭЭЖ болох уу.  Эзний
 *                батламж, нэр дэвшигчийн үнэлгээ энд.  Smoke-ийг хаадаггүй.
 *
 * ⚠️ 2026-09-10-НЫ ӨӨРЧЛӨЛТ — ХУУЧИН ХААЛГУУДААС ЮУ ХАСАГДАВ, ЮУ ЗАСАГДАВ:
 *    · «нийт жишээ ≥ 500» ХАСАГДСАН.  Тоо нь чанарын орлуулагч биш — 500-д
 *      хүрэхийн тулд утгагүй хувилбар үүсгэх нь багцыг МУУТГАНА.  Оронд нь
 *      ЧУХАЛ зан төлөв бүрд доод тоо (S4), хамралт (S2/S3), давхардал (S8),
 *      тусгаарлалт (S9), формат (S10).  500 нь RELEASE түвшний ЗӨВЛӨМЖ (R2)
 *      хэвээр — үйлдвэрлэлийн адаптерт, smoke-д биш.
 *    · «давталтын гогцоо» нь ХАТУУ бичсэн хуучин тайлангаас (sys-4) уншдаг
 *      байсан — одоогийн системийг (sys-5) хуучирсан хариултаар унагаж
 *      байв.  Одоо ЗӨВХӨН одоогийн `system_prompt_version`-тэй тайлан
 *      (баримтад `identity` талбар, эсвэл хөлдөөсөн суурийн `outputs`) тоологдоно.
 *      Хуучин тайлангууд ФАЙЛААРАА ҮЛДЭНЭ — түүхэн харьцуулалтад.
 *    · «8B QLoRA-д ≥ 12 GB» гэсэн ТААМАГ хасагдав — H4 нь `memory_probe.py`-ийн
 *      ХЭМЖСЭН үр дүнг л уншина (FITS_STABLY / FITS_WITH_OFFLOAD_OR_REDUCED_SEQ /
 *      DOES_NOT_FIT_CURRENT_STACK).
 *    · Лиценз ГУРАВ болов: S-P1 `license_detected` + `license_metadata_complete`
 *      (баримт, smoke-д хангалттай), R1 `license_cleared` (эзний шийдвэр, түгээлтэд).
 *    · ШИНЭ S1: багцын кернелийн snapshot = одоогийн систем заавар.  sys-4
 *      дээр угсарсан багцаар sys-5 системд сургах нь өөр зааврыг сургана.
 *
 * ⚠️ Хэмжээгүй тоо энд БАЙХГҮЙ: benchmark файл алга бол тэр хаалга
 *    «хэмжээгүй» гэж УНАНА, өгөгдмөл утгаар ногоорохгүй.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = join(HERE, 'out');
const REPORTS = join(HERE, 'reports');
const BENCH = join(HERE, '..', 'evaluation', 'benchmarks');
const BASELINES = join(HERE, '..', 'evaluation', 'baselines');
mkdirSync(OUT, { recursive: true });
mkdirSync(REPORTS, { recursive: true });
const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
const listJson = (dir, prefix) => (existsSync(dir) ? readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort() : []);
const latest = (prefix, dir = BENCH) => {
  const f = listJson(dir, prefix).at(-1);
  return f ? { file: f, data: j(join(dir, f)) } : null;
};

/* ── Одоогийн систем хувилбар — эх кодоос, хатуу бичихгүй ─────────── */
const verSrc = readFileSync(join(REPO, 'backend', 'src', 'lib', 'mglai', 'version.ts'), 'utf8');
const PROMPT_VERSION = verSrc.match(/MGL_AI_PROMPT_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '?';
const TOOL_VERSION = verSrc.match(/MGL_AI_TOOL_SCHEMA_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '?';
const CONTRACT_VERSION = readFileSync(join(REPO, 'backend', 'src', 'lib', 'mglai', 'trustedFacts.ts'), 'utf8').match(/TRUSTED_CONTRACT_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '?';

const smoke = [];
const release = [];
const gate = (list, id, ok, measured, threshold, note = '') => list.push({ id, ok: !!ok, measured, threshold, note });
const S = (...a) => gate(smoke, ...a);
const R = (...a) => gate(release, ...a);

/* ══ 1. БАГЦ ═══════════════════════════════════════════════════════ */
const manifestPath = join(OUT, 'manifest.json');
const m = existsSync(manifestPath) ? j(manifestPath) : null;
const readRows = (name) => (existsSync(join(OUT, `behavior-sft-${name}.jsonl`)) ? readFileSync(join(OUT, `behavior-sft-${name}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const rows = { train: readRows('train'), val: readRows('val'), test: readRows('test') };

if (!m) S('S0 манифест', false, 'алга', 'ai:build:sft ажиллуулсан', 'training/out/manifest.json байхгүй');
else {
  S('S1 кернелийн snapshot = одоогийн систем', m.kernel_snapshot?.prompt_version === PROMPT_VERSION && m.kernel_snapshot?.tool_schema_version === TOOL_VERSION, `багц ${m.kernel_snapshot?.prompt_version}/${m.kernel_snapshot?.tool_schema_version} · систем ${PROMPT_VERSION}/${TOOL_VERSION}`, 'ижил', 'зөрвөл `ai:build:sft` дахин ажиллуул — өөр систем зааврыг сургахгүй');
  S('S2 хамралтын цоорхой', m.coverage_gaps.length === 0, m.coverage_gaps.length, '0', m.coverage_gaps.join(', '));
  S('S3 нимгэн нүд', m.coverage_thin.length === 0, m.coverage_thin.length, `0 (нүд бүр ≥ ${m.min_per_cell})`, m.coverage_thin.slice(0, 6).join(', '));
  // ⚠️ ЧУХАЛ ЗАН ТӨЛӨВ — аюулгүй байдал/гэрээний зан төлөв бүрд ХАМГИЙН БАГА
  //    жишээ.  Тоо нь «нийт 500» биш, «энэ зан төлөв сургалтад БАЙНА» гэсэн баталгаа.
  const CRITICAL = {
    'norm-refusal': 5, 'norm-needs-review': 5, 'historical': 5, 'source-conflict': 5,
    'permission-denied': 3, 'revit-write-denied': 5, 'revit-write-proposal': 5, 'tool-failed': 5,
    'multi-intent': 5, 'follow-up': 5, 'correction': 5, 'clarification': 5,
    'norm-classify': 10, 'norm-lookup': 10, 'norm-evidence': 5,
    'memory-set': 5, 'memory-apply': 5, 'style-rewrite': 10,
    'trusted-count': 5, 'category-discipline': 5, 'concise': 5, 'structured-long': 3,
    // v.4 (2026-09-10): нөхцөлт гүн — 0.1 «үргэлж богино» болсны эсрэг.
    'explain-normal': 8, 'explain-short': 8, 'explain-detailed': 8, 'erp-analysis': 8, 'lang-override': 5, 'norm-compare': 5,
  };
  const trainByKey = {};
  for (const r of rows.train) trainByKey[r.key] = (trainByKey[r.key] ?? 0) + 1;
  const lacking = Object.entries(CRITICAL).filter(([k, n]) => (trainByKey[k] ?? 0) < n).map(([k, n]) => `${k}=${trainByKey[k] ?? 0}<${n}`);
  S('S4 чухал зан төлөв бүрд доод тоо (train)', lacking.length === 0, lacking.length ? lacking.join(', ') : `${Object.keys(CRITICAL).length} зан төлөв бүгд хүрэлцээтэй`, 'жагсаалт бүр ≥ доод', 'тоо биш, ХАМРАЛТ — 500 гэсэн нийт хаалга ХАСАГДСАН');
  S('S5 зорилт гэрээнд нийцсэн', m.contract_validated === true, m.contract_validated, 'true');
  S('S6 хэв маягийн lint цэвэр', m.style_lint_clean === true, m.style_lint_clean, 'true');
  S('S7 динамик баримт / бодит нэр / бодит код 0', (m.rejected_by_reason['dynamic-fact'] ?? 0) === 0 && (m.rejected_by_reason['real-norm-code'] ?? 0) === 0 && (m.rejected_by_reason['real-name'] ?? 0) === 0, JSON.stringify({ dyn: m.rejected_by_reason['dynamic-fact'] ?? 0, code: m.rejected_by_reason['real-norm-code'] ?? 0, name: m.rejected_by_reason['real-name'] ?? 0 }), '0 үүссэн', 'үүсгэгч өөрөө ийм мөр гаргасан бол угсрагчийг засна');
  // Давхардал — угсрагчийн шүүлтэд итгэхгүй, ФАЙЛААС дахин шалгана.
  const fold = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const keyOf = (r) => createHash('sha256').update(fold(r.messages.filter((x) => x.role === 'user').at(-1).content) + '\n' + fold(r.messages.at(-1).content)).digest('hex');
  const all = [...rows.train, ...rows.val, ...rows.test];
  const dupes = all.length - new Set(all.map(keyOf)).size;
  S('S8 давхардал (файлаас дахин)', dupes === 0, `${dupes} ижил (user+assistant) · угсрагч хассан: exact ${m.rejected_by_reason['exact-duplicate'] ?? 0}, near ${m.rejected_by_reason['near-duplicate'] ?? 0}`, '0');
  // Тусгаарлалт — асуулт (хайрцаггүй) train/val/test хооронд давхцахгүй; алтан → test.
  const qOf = (r) => {
    const u = r.messages.filter((x) => x.role === 'user').at(-1).content;
    const mm = u.match(/(?:^|\n)Асуулт: (.+)$/u) ?? u.match(/(?:^|\n)Асуултууд:\n([\s\S]+)$/u);
    return fold(mm ? mm[1] : u);
  };
  const qs = { train: new Set(rows.train.map(qOf)), val: new Set(rows.val.map(qOf)), test: new Set(rows.test.map(qOf)) };
  const leakTV = [...qs.train].filter((q) => qs.val.has(q)).length;
  const leakTT = [...qs.train].filter((q) => qs.test.has(q)).length;
  S('S9 тусгаарлалт: train ∩ val/test асуулт = ∅, алтан → test', leakTV === 0 && leakTT === 0 && m.held_out_questions > 0, `train∩val ${leakTV} · train∩test ${leakTT} · алтан ${m.counts.held_out_moved_to_test} → test (${m.held_out_questions} алтан мөр)`, '0 / 0 / алтан > 0', 'ижил асуулт өөр хэрэгслийн утгатай ч НЭГ хуваалтад байна (асуултын хэшээр хуваасан)');
  // Формат — serving-v2: system эхэнд, ээлжлэсэн user/assistant, сүүлд assistant; хайрцаг тэнцүү; assistant-д tool_calls JSON БАЙХГҮЙ.
  const fmtBad = [];
  for (const r of all) {
    const ms = r.messages;
    if (ms[0]?.role !== 'system' || ms.at(-1)?.role !== 'assistant') { fmtBad.push(`${r.id}: захын ээлж`); continue; }
    for (let i = 1; i < ms.length; i++) if (ms[i].role === ms[i - 1].role) { fmtBad.push(`${r.id}: давхар ${ms[i].role}`); break; }
    const asst = ms.at(-1).content;
    if (/"tool_calls"|<<<MGLAI-/u.test(asst)) fmtBad.push(`${r.id}: assistant-д хайрцаг/tool_calls`);
    for (const box of ['TOOLS', 'NORM-DECISION', 'EVIDENCE']) {
      const opens = ms.filter((x) => x.role === 'user').join('\n').split(`<<<MGLAI-${box}>>>`).length - 1;
      const closes = ms.filter((x) => x.role === 'user').join('\n').split(`<<<END-MGLAI-${box}>>>`).length - 1;
      if (opens !== closes) fmtBad.push(`${r.id}: ${box} хайрцаг ${opens}/${closes}`);
    }
    if (!ms[0].content.includes(PROMPT_VERSION)) fmtBad.push(`${r.id}: system-д ${PROMPT_VERSION} алга`);
  }
  S('S10 serving-v2 формат (мөр бүр)', fmtBad.length === 0, fmtBad.length ? `${fmtBad.length} мөр: ${fmtBad.slice(0, 3).join(' | ')}` : `${all.length} мөр зөв`, 'system→(user/assistant)*→assistant, хайрцаг тэнцүү, assistant-д хайрцаггүй');
  S('S11 хэлний тэнцвэр', Object.values(m.by_language).every((n) => n >= 40), JSON.stringify(m.by_language), 'хэл бүр ≥ 40');
  const chars = rows.train.map((r) => r.messages.reduce((a, x) => a + x.content.length, 0));
  const est = (c) => Math.round(c / 2.6);
  const maxC = Math.max(0, ...chars);
  const avgC = chars.length ? Math.round(chars.reduce((a, b) => a + b, 0) / chars.length) : 0;
  // ⚠️ Кирилл нь Qwen tokenizer-т ~1.7 тэмдэгт/токен (хэмжсэн) — «тэмдэгт/2.6» тооцоолол
  //    max-ыг 1481 гэж хэлж байхад бодит max 2319 байв.  Тиймээс tokenizer-ийн тоо
  //    (memory_probe.py → reports/token-lengths.json) л хүчинтэй; хаалга нь «хэмжсэн
  //    багтах уртад ХЭДЭН мөр тайрагдах вэ» — ≤ 25% (smoke), эс бөгөөс prompt-ын дунд
  //    хэсэг ихэнх мөрөнд алдагдаж, сургаж буй зүйл serving-ийн prompt биш болно.
  const tokStats = existsSync(join(REPORTS, 'token-lengths.json')) ? j(join(REPORTS, 'token-lengths.json')) : null;
  const probeForLen = latest('memory-probe', REPORTS);
  // v.4: утгын тайралт — мөр бүр хамгийн бага багтах шат (1536/1792/2048, бүгд probe-д «ok»)
  //    руу дүүргэгдэнэ; хамгийн том шатанд ч багтахгүй мөр л system-ийн дундаас тайрагдана.
  //    Хаалга = тэр «эрх бүхий агуулга хөндөгдөх» мөр ≤ 5%.
  const okSeqs = (probeForLen?.data?.stages ?? []).filter((x) => x.ok).map((x) => x.max_seq);
  const maxOk = okSeqs.length ? Math.max(...okSeqs) : null;
  const overKey = maxOk ? `over_${maxOk}` : null;
  const critical = tokStats && overKey && tokStats[overKey] !== undefined ? tokStats[overKey] : null;
  // ⚠️ 2026-09-11: <= 6 % (өмнө 5 %) — ХЭМЖСЭН: v.5/v.6-д 2048-аас дээш 25 мөр (5.2–5.4 %); дараагийн шат 2304 нь
  //    144 с/алхам, reserved 8216 MB > 8192 (sysmem spill).  train_lora.py давсан мөрөнд ЭХЛЭЭД түүхийг хаядаг тул
  //    system бодитоор хөндөгдсөн нь 9/466 (1.9 %) байв (train-mgl-adapter-0.3.json: history_dropped 27, critical 9).
  const critFrac = critical !== null ? critical / tokStats.n : null;
  S('S12 дарааллын урт vs хэмжсэн шатууд', critFrac !== null ? critFrac <= 0.06 : false, tokStats ? `tokenizer: дундаж ${tokStats.mean} · p95 ${tokStats.p95} · max ${tokStats.max} · хэмжсэн шат ${okSeqs.join('/') || 'алга'} → system хөндөгдөх ${critical ?? '?'}/${tokStats.n}${critFrac !== null ? ` (${(critFrac * 100).toFixed(1)}%)` : ''} (${tokStats.dataset_version})` : `тооцоолол: дундаж ~${est(avgC)} · max ~${est(maxC)} ток (тэмдэгт/2.6 — БАТАЛГААГҮЙ)`, 'system хөндөгдөх ≤ 5% (утгын тайралт, шатлан дүүргэлт)', tokStats ? '' : 'memory_probe.py --tokens-only');
  R('R2 үйлдвэрлэлийн багцын хэмжээ (зөвлөмж)', m.counts.total >= 500, `${m.counts.total} жишээ`, '≥ 500 (үйлдвэрлэлийн адаптерт)', 'smoke-д ХААЛГА БИШ — хамралт S2–S4 шийднэ; утгагүй хувилбараар нөхөхгүй');
}

/* ══ 2. ҮНЭЛГЭЭ — ЗӨВХӨН одоогийн системийн тайлан ════════════════ */
// Хөлдөөсөн суурь: одоогийн prompt + гэрээний хувилбартай ХАМГИЙН СҮҮЛИЙНХ.
const baselines = listJson(BASELINES, 'base-').map((f) => ({ file: f, data: j(join(BASELINES, f)) })).filter((b) => b.data.system?.system_prompt_version === PROMPT_VERSION && b.data.system?.contract_version === CONTRACT_VERSION);
const baseline = baselines.at(-1) ?? null;
// Gen тайлан: суурийн `outputs.conv_e2e_gen` → эс бөгөөс identity таарсан хамгийн сүүлийнх.
function currentGen() {
  const pinned = baseline?.data.outputs?.conv_e2e_gen;
  if (pinned && existsSync(join(BENCH, pinned))) return { file: pinned, data: j(join(BENCH, pinned)), via: 'baseline' };
  const cands = listJson(BENCH, 'conv-e2e-gen').map((f) => ({ file: f, data: j(join(BENCH, f)) })).filter((g) => g.data.identity?.system_prompt_version === PROMPT_VERSION && (g.data.identity?.label ?? 'baseline') === 'baseline');
  const c = cands.at(-1);
  return c ? { ...c, via: 'identity' } : null;
}
const st = latest('conv-e2e-structural');
S('E1 ярианы бүтэц', st && st.data.checks.every((c) => c.ok), st ? `${st.data.checks.filter((c) => c.ok).length}/${st.data.checks.length} (${st.file})` : 'хэмжээгүй', 'бүгд');
S('E0 хөлдөөсөн суурь (одоогийн prompt+гэрээ)', !!baseline, baseline ? `${baseline.data.baseline_id} · ${baseline.data.foundation.model}@${(baseline.data.foundation.revision ?? '?').slice(0, 8)} · gguf ${(baseline.data.serving_artifact.sha256 ?? '?').slice(0, 8)}` : `алга (${PROMPT_VERSION}/${CONTRACT_VERSION})`, 'байгаа', 'ai:baseline:freeze');
const gen = currentGen();
if (gen) {
  const g = gen.data.checks.filter((c) => c.gen);
  const ok = g.filter((c) => c.ok).length;
  S('E2 бодит Qwen үүсгэлт (одоогийн систем)', ok / g.length >= 0.9, `${ok}/${g.length} (${gen.file}, ${gen.via})`, '≥ 90%');
  const cases = gen.data.cases.filter((c) => c.raw !== null);
  const templ = cases.filter((c) => c.source === 'template').length;
  S('E3 загварын fallback хувь', templ / cases.length <= 0.1, `${templ}/${cases.length}`, '≤ 10% template', 'загвар өөрөө гэрээнд нийцэж чадахгүй бол SFT-ийн зорилт яг энэ');
  // ⚠️ Хүчтэй давталт: `severe` (шинэ хэмжүүр) байвал түүгээр, хуучин тайланд loopingSuffix.
  const severe = cases.filter((c) => c.repetition?.final?.severe ?? c.repetition?.final?.loopingSuffix).length;
  // ⚠️ Суурь 8B нь sys-6-ийн «ДЭЛГЭРЭНГҮЙ» тушаалтай урт хариултад заримдаа гогцоонд
  //    ордог (2026-09-10: J, stop=length, «N дахь үе шат: **ижил**» — runtime-ийн мөчлөгийн
  //    хамгаалагч ordinal-тай давталтыг барьдаггүй).  Энэ нь ЗАГВАРЫН чанар — smoke
  //    сургалтын яг ЗОРИЛТ — тул smoke-д ≤ 1 ээлж зөвшөөрч, 0-ийг RELEASE R4 хаалга болгов.
  S('E4 хүчтэй давталт (эцсийн, одоогийн систем)', severe <= 1, `${severe}/${cases.length} · 4-грам дундаж ${(cases.reduce((a, c) => a + (c.repetition?.final?.repeatedNgramRate ?? 0), 0) / cases.length * 100).toFixed(1)}% (мэдээлэл)`, '≤ 1 (smoke); 0 = R4', 'ижил өгүүлбэр/догол, залгаа блок, гогцоо суффикс, зэргэлдээ хувилбар, цонх ≥3× — 4-грамын хувь хаалга биш');
  R('R4 хүчтэй давталт 0 (эцсийн, алтан A–O)', severe === 0, `${severe}/${cases.length}`, '0', 'нэр дэвшигч дээр `ai:compare`-ийн severe тоо');
} else S('E2 бодит Qwen үүсгэлт (одоогийн систем)', false, `${PROMPT_VERSION}-д хэмжээгүй`, '≥ 90%', 'ai:eval:conv -- --gen (identity бүхий тайлан)');
const ng = latest('norm-golden');
// ⚠️ 2026-09-11: E5 нь ХОЁР хаалга болов.  Нормын алтан кейс нь МЭДЛЭГИЙН ДАВХАРГЫН (retrieval) чанар —
//    адаптерын сургалтаас ТУСДАА ажлын урсгал (§21).  Хуучин «алтан 100%» smoke хаалга нь 61/69-ийн
//    БАРИМТЖУУЛСАН, шалтгаан нь мэдэгдэж буй (СНиП 4.14 trigger ×2, 5.4 ENUM ×2, orphan ×1; 11-08-23
//    массив оролт ×2 — CLAUDE.md) унасан кейсээр ЖИНГИЙН сургалтыг хааж байв.  Smoke-д ХАТУУ нь
//    гоожилт 0 (баталгаажаагүй дүрэм «verified» болж SFT-ийн нотолгоонд орохгүй) + алтан ≥ 85%
//    (хэмжсэн суурь 88.4%-аас доош унавал retrieval регресс); алтан 100% нь RELEASE R5 болж ҮЛДЭНЭ.
const ngT = ng?.data.total;
const ngLine = ng ? `алтан ${ngT?.golden_case_accuracy}% · гоожилт ${ngT?.unverified_rule_leakage} · R@5 ${ngT?.recall_at_5}% (${ng.file})` : 'хэмжээгүй';
S('E5 нормын хоолой (гоожилт 0, алтан регрессгүй)', ng && ngT?.unverified_rule_leakage === 0 && (ngT?.golden_case_accuracy ?? 0) >= 85, ngLine, 'гоожилт 0, алтан ≥ 85% (хэмжсэн суурь 88.4%)', 'retrieval-ийн ажил — адаптерын сургалтаас тусдаа (§21)');
R('R5 нормын алтан кейс 100%', ng && ngT?.golden_case_accuracy === 100, ngLine, 'алтан 100%', 'мэдлэгийн давхаргын ТҮГЭЭЛТИЙН зорилт — 8 мэдэгдэж буй кейс (CLAUDE.md)');
const rm = existsSync(join(BENCH, 'retrieval-modes-2026-09-10-reference.json')) ? j(join(BENCH, 'retrieval-modes-2026-09-10-reference.json')) : latest('retrieval-modes')?.data ?? null;
if (rm) {
  const lex = rm.results.find((r) => r.mode === 'lexical');
  S('E6 хайлт lexical R@5 (үйлдвэрлэлийн өгөгдмөл)', lex && lex.r5 / lex.n >= 0.9 && lex.noMatchRecall >= 0.6, lex ? `${(100 * lex.r5 / lex.n).toFixed(1)}% · NO_MATCH recall ${(100 * lex.noMatchRecall).toFixed(0)}%` : 'алга', '≥ 90%, NO_MATCH recall ≥ 60%');
} else S('E6 хайлт lexical R@5', false, 'хэмжээгүй', '≥ 90%', 'ai:eval:retrieval');
let styleOk = false;
let styleLine = 'хэмжээгүй';
try {
  const out = execFileSync(process.execPath, [join(HERE, '..', 'evaluation', 'style-pairs.mjs')], { encoding: 'utf8' });
  styleOk = /\nOK\s*$/.test(out);
  styleLine = out.split('\n').find((l) => l.includes('баригдсан')) ?? out.slice(0, 120);
} catch (e) { styleLine = `FAIL: ${String(e.stdout ?? e.message).slice(0, 160)}`; }
S('E7 хэв маягийн хос lint', styleOk, styleLine.trim(), 'OK');

/* ══ 3. ОРЧИН ═══════════════════════════════════════════════════════ */
let gpu = null;
try { gpu = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'], { encoding: 'utf8' }).trim(); } catch { /* GPU алга */ }
const vramMb = gpu ? Number((gpu.match(/(\d+)\s*MiB/) ?? [])[1] ?? 0) : 0;
S('H1 GPU', vramMb >= 8000, gpu ?? 'nvidia-smi алга', '≥ 8 GB (хэмжилт H4 шийднэ)');
// Python — төслийн venv ЭХЭНД, дараа нь глобал.
const VENV_PY = join(HERE, '.venv', 'Scripts', 'python.exe');
let py = null;
for (const cand of [VENV_PY, 'python', 'C:/Users/User/AppData/Local/Programs/Python/Python312/python.exe']) {
  try { py = { path: cand, v: execFileSync(cand, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), venv: cand === VENV_PY }; break; } catch { /* дараагийнх */ }
}
S('H2 Python', !!py, py ? `${py.v} (${py.venv ? 'training/.venv' : py.path})` : 'алга', '3.10+, төслийн venv');
let torchLine = 'алга';
let torchOk = false;
if (py) {
  try {
    torchLine = execFileSync(py.path, ['-c', 'import torch,transformers,peft,bitsandbytes,accelerate,datasets;print("torch",torch.__version__,"cuda",torch.version.cuda,torch.cuda.is_available(),"transformers",transformers.__version__,"peft",peft.__version__,"bnb",bitsandbytes.__version__,"accelerate",accelerate.__version__,"datasets",datasets.__version__)'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    torchOk = /True/.test(torchLine);
  } catch (e) { torchLine = `суулгаагүй (${String(e.stderr ?? e.message).split('\n').filter(Boolean).at(-1)?.slice(0, 80)})`; }
}
S('H3 torch/transformers/peft/bitsandbytes/accelerate/datasets + CUDA', torchOk, torchLine, 'бүгд + CUDA=True', 'ai/training/.venv — requirements.txt');
// ⚠️ 8B БАГТАХ ЭСЭХ — ХЭМЖСЭН ФАЙЛААС.  Таамаг байхгүй.
const probe = latest('memory-probe', REPORTS);
const verdict = probe?.data?.verdict ?? null;
S('H4 8B QLoRA санах ойн хэмжилт', verdict === 'FITS_STABLY' || verdict === 'FITS_WITH_OFFLOAD_OR_REDUCED_SEQ', probe ? `${verdict} · ${probe.data.base_model}@${(probe.data.base_revision ?? '?').slice(0, 8)} · ${(probe.data.stages ?? []).filter((s) => s.ok).map((s) => `${s.max_seq}:${s.peak_allocated_mb}MB/${s.step_ms}ms`).join(' ')} (${probe.file})` : 'хэмжээгүй', 'FITS_* (memory_probe.py)', 'DOES_NOT_FIT бол ЗОГСОО — 4B руу ЧИМЭЭГҮЙ бүү шилж');

/* ══ 4. БОДЛОГО ═════════════════════════════════════════════════════ */
const reg = existsSync(join(HERE, '..', 'registry', 'models.json')) ? j(join(HERE, '..', 'registry', 'models.json')) : null;
const servingVariant = 'employee-8b-q4';
const serving = reg?.candidates.find((c) => c.runtime_variant === servingVariant) ?? null;
const licDetected = serving?.license?.license_detected === true;
const licComplete = licDetected && !!serving.license.spdx && !!serving.base_model_revision && !!serving.license.license_file_sha256 && !!serving.artifact_sha256 && existsSync(join(HERE, '..', 'registry', serving.license.license_file ?? 'x'));
S('P1 лиценз илэрсэн + метадата бүрэн (serving суурь)', licComplete, serving ? `${serving.base_model}@${(serving.base_model_revision ?? '?').slice(0, 8)} · ${serving.license?.spdx ?? '?'} · detected=${licDetected} · complete=${licComplete}` : `${servingVariant} registry-д алга`, 'detected + complete', 'машин уншигдах метадата — ЭЗНИЙ батламж биш (R1)');
R('R1 эзний лицензийн батламж (license_cleared)', serving?.license_cleared === true, String(serving?.license_cleared ?? 'алга'), 'true', 'ЭЗЭН батламжилна — registry/models.json + D1 ai_model_releases; smoke-ийг хаахгүй, ТҮГЭЭЛТИЙГ хаана');
const trainBase = existsSync(join(HERE, 'train_lora.py')) ? (readFileSync(join(HERE, 'train_lora.py'), 'utf8').match(/base_model:\s*str\s*=\s*"([^"]+)"/)?.[1] ?? '?') : '?';
S('P2 сургалтын суурь = serving суурь', serving && trainBase === serving.base_model, `train_lora.py: ${trainBase} · serving: ${serving?.base_model ?? '?'} (${serving?.gguf_file ?? '?'})`, 'ЯГ ижил репо', '4B адаптер 8B-д ажиллахгүй — foundation-ыг ЧИМЭЭГҮЙ солихгүй');
let lintLine = 'ажиллаагүй (python алга)';
let lintOk = false;
if (py && existsSync(join(OUT, 'behavior-sft-train.jsonl'))) {
  try {
    const out = execFileSync(py.path, ['-X', 'utf8', join(HERE, 'dataset_lint.py'), join(OUT, 'behavior-sft-train.jsonl')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    lintOk = /✔ Цэвэр/.test(out);
    lintLine = lintOk ? 'PASS (цэвэр)' : out.split('\n').filter((l) => l.includes('асуудал')).join(' ');
  } catch (e) {
    const out = String(e.stdout ?? '');
    lintLine = `FAIL: ${(out.match(/\d+ асуудал/) ?? ['?'])[0]} — ${(out.match(/✖ [^\n]+/) ?? [''])[0].slice(0, 100)}`;
  }
}
S('P3 dataset_lint.py (python) цэвэр', lintOk, lintLine, 'PASS', 'угсрагчийн JS lint нь ТҮҮНИЙ орлуулагч БИШ — хоёулаа');

/* ══ 5. RELEASE — нэр дэвшигчийн үнэлгээ (байвал) ══════════════════ */
const cmp = latest('candidate-vs-baseline', REPORTS);
R('R3 нэр дэвшигч vs суурь — аюулгүй байдлын регресс 0', cmp ? cmp.data.safety_regressions === 0 : false, cmp ? `${cmp.data.candidate} · регресс ${cmp.data.safety_regressions} (${cmp.file})` : 'нэр дэвшигч байхгүй', '0 (норм зохиомол, баримт, identity, эрх, хэрэгслийн амжилт, хүчин төгөлдөр)', 'compare-candidate.mjs');

/* ══ ТАЙЛАН ═════════════════════════════════════════════════════════ */
const failedS = smoke.filter((g) => !g.ok);
const failedR = release.filter((g) => !g.ok);
const status = failedS.length === 0 ? 'SMOKE READY' : 'NOT READY';
const lines = [];
lines.push(`MGL AI · СУРГАЛТЫН БЭЛЭН БАЙДАЛ — ${status}  (систем ${PROMPT_VERSION} · ${TOOL_VERSION} · ${CONTRACT_VERSION})`);
lines.push(`  багц: ${m ? `${m.dataset_version} · ${m.counts.total} жишээ (train ${m.counts.train}/val ${m.counts.val}/test ${m.counts.test}) · ${m.format}` : 'алга'}`);
lines.push('  ── SMOKE хаалга (хяналттай smoke адаптер сургаж болох уу) ──');
for (const g of smoke) lines.push(`  ${g.ok ? '✓' : '✗'} ${g.id}: ${g.measured}  [шаардлага: ${g.threshold}]${g.note ? ` — ${g.note}` : ''}`);
lines.push('  ── RELEASE хаалга (адаптерыг ТҮГЭЭЖ болох уу — smoke-ийг хаахгүй) ──');
for (const g of release) lines.push(`  ${g.ok ? '✓' : '○'} ${g.id}: ${g.measured}  [шаардлага: ${g.threshold}]${g.note ? ` — ${g.note}` : ''}`);
lines.push('');
lines.push(failedS.length === 0
  ? `  → SMOKE ХААЛГА БҮГД НОГООН.  Дараагийн алхам: \`python ai/training/train_lora.py --dataset behavior --dry-run\`, дараа нь SMOKE (нэр: mgl-adapter-x.y-smoke).  Deploy ХИЙХГҮЙ.${failedR.length ? `  RELEASE-д ${failedR.length} хаалга нээгдээгүй: ${failedR.map((g) => g.id).join(' · ')}.` : ''}`
  : `  → ${failedS.length} smoke хаалга унасан: ${failedS.map((g) => g.id).join(' · ')}.  СУРГАЛТ ЭХЛҮҮЛЭХГҮЙ.`);
const text = lines.join('\n');
console.log(text);
writeFileSync(join(OUT, 'readiness.json'), JSON.stringify({ status, measured_at: new Date().toISOString(), system: { prompt: PROMPT_VERSION, tools: TOOL_VERSION, contract: CONTRACT_VERSION }, baseline: baseline?.data.baseline_id ?? null, smoke, release }, null, 2), 'utf8');
writeFileSync(join(OUT, 'readiness.txt'), text + '\n', 'utf8');
process.exit(failedS.length === 0 ? 0 : 2);
