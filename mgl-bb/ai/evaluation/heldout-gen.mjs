#!/usr/bin/env node
/**
 * `npm run ai:eval:heldout -- [--label baseline|candidate:<нэр>] [--rt http://127.0.0.1:39217] [--api …] [--only H01,H02] [--no-gen]`
 *
 * ӨРГӨН HELD-OUT ҮҮСГЭЛТИЙН БАГЦ (§10, §31–32) — `heldout-cases.json`-ийн кейс
 * бүрийг бодит гинжээр (plan → tool → norm → context → generate → гэрээ)
 * ажиллуулж, ТҮҮХИЙ (загварын) ба ЭЦСИЙН (гэрээний дараах) хариултыг ТУС
 * ТУСАД нь оноожуулна.  Суурь ба адаптертай нэр дэвшигчийг ЯГ ижил кейсээр,
 * ижил хүлээлтээр харьцуулах нь энэ файлын цорын ганц зорилго.
 *
 * ⚠️ ЭНЭ БАГЦ СУРГАЛТАД ОРОХГҮЙ — `build_behavior_sft.mjs` нь `heldout-cases.json`-ийг
 *    уншиж, ойролцоо асуултыг test рүү шилжүүлнэ.
 *
 * ⚠️ «raw» ба «final» ХОЁУЛАА тайланд (§32): final нь runtime-ийн гэрээгээр
 *    засагдсан тул бараг үргэлж 100% — загвар ӨӨРӨӨ сайжирсан эсэхийг зөвхөн
 *    raw хэлнэ.  Хоёрыг нэг тоо болгож нэгтгэхгүй.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient, IDENTITY_RE, cyr, lat, mostlyCyrillic, short } from './lib/e2e.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const GEN = !argv.includes('--no-gen');
const LABEL = flag('label', 'baseline');
const ONLY = flag('only', null)?.split(',') ?? null;
const client = createClient({ api: flag('api', 'http://127.0.0.1:3000/api'), rt: flag('rt', 'http://127.0.0.1:39217'), gen: GEN, maxTokens: 700 });
const suite = JSON.parse(fs.readFileSync(path.join(HERE, 'heldout-cases.json'), 'utf8'));

const sess = await client.login(flag('user', 'A.Anand'), flag('pass', 'admin123'));
const identity = await client.identity(LABEL);
console.log(`login ok · mode=${sess.mode} · gen=${GEN} · ${JSON.stringify(identity)}`);

const sentencesOf = (t) => (t ?? '').split(/(?<=[.!?])\s+|\n+/u).map((s) => s.trim()).filter((s) => s.length > 0 && /\p{L}/u.test(s) && s.split(/\s+/).length >= 2).length;

/** Хүлээлт бүрийг НЭГ текст дээр (raw эсвэл final) шалгана → [{name, ok, note}]. */
function judge(text, exp, ctxInfo) {
  const out = [];
  const t = text ?? '';
  const add = (name, ok, note = '') => out.push({ name, ok, note });
  if (exp.lang === 'mn-Cyrl') add('lang:mn-Cyrl', mostlyCyrillic(t), `cyr ${cyr(t)} lat ${lat(t)}`);
  if (exp.lang === 'en') add('lang:en', lat(t) > cyr(t), `cyr ${cyr(t)} lat ${lat(t)}`);
  if (exp.no_identity) add('no-identity', !IDENTITY_RE.test(t));
  if (exp.facts_in_answer) {
    // ⚠️ Зөвхөн `mustMention` баримт — гэрээ өөрөө тэднийг л шаарддаг (validator FACT_MISSING).
    const facts = (ctxInfo.contract?.facts ?? []).filter((f) => f.mustMention !== false);
    const missing = facts.filter((f) => f.value !== null && f.value !== undefined && String(f.value).trim() !== '' && !t.includes(String(f.value))).map((f) => f.id);
    add('facts-in-answer', facts.length > 0 && missing.length === 0, facts.length ? (missing.length ? `дутуу: ${missing.join(',')}` : `${facts.length} баримт`) : 'гэрээнд заавал баримт алга');
  }
  if (exp.citation === 'required') add('citation', /\[\d+\]|\d{2}-\d{2,3}-\d{2}|УББ|БНбД|БД\s?\d/u.test(t));
  if (exp.refusal_start) {
    const rs = ctxInfo.contract?.requiredSentence;
    if (rs) add('refusal-start', t.trim().startsWith(rs));
    else add('refusal-start', false, `гэрээ ${ctxInfo.contract?.answerMode ?? 'алга'} (татгалзал биш — систем нотолгоо олсон)`);
  }
  if (exp.trailer) {
    const tr = ctxInfo.contract?.trailerText;
    add('trailer', tr ? t.includes(tr) : false, tr ? '' : 'гэрээнд трейлер алга');
  }
  if (exp.max_sentences) add(`≤${exp.max_sentences} өгүүлбэр`, sentencesOf(t) <= exp.max_sentences, String(sentencesOf(t)));
  if (exp.min_sentences) add(`≥${exp.min_sentences} өгүүлбэр`, sentencesOf(t) >= exp.min_sentences, String(sentencesOf(t)));
  for (const f of exp.forbid ?? []) add(`forbid ${f}`, !new RegExp(f, 'u').test(t));
  for (const r of exp.require ?? []) add(`require ${r}`, new RegExp(r, 'u').test(t));
  if (exp.no_units) add('no-invented-units', !new RegExp(exp.no_units, 'u').test(t));
  if (exp.no_severe_repetition) add('no-severe-repetition', !(ctxInfo.rep?.severe ?? false), ctxInfo.rep ? `цонх ${ctxInfo.rep.longestRepeatedRun}× · 4-грам ${(ctxInfo.rep.repeatedNgramRate * 100).toFixed(1)}%` : '');
  if (exp.project_name_absent && ctxInfo.prevSubject) add('prev-subject-absent', !t.includes(ctxInfo.prevSubject), ctxInfo.prevSubject);
  if (exp.subject_in_answer) add('subject-in-answer', ctxInfo.subject ? t.includes(ctxInfo.subject) : false, ctxInfo.subject ?? 'сэдэв алга');
  if (exp.other_project_absent && ctxInfo.other) add('other-project-absent', !t.includes(ctxInfo.other), ctxInfo.other);
  if (exp.style_max_per_100 !== undefined) add('style', (ctxInfo.style?.perHundredWords ?? 0) <= exp.style_max_per_100, `${ctxInfo.style?.perHundredWords ?? '?'}/100 үг`);
  return out;
}

const results = [];
for (const c of suite.cases) {
  if (ONLY && !ONLY.includes(c.id)) continue;
  console.log(`\n■ ${c.id} · ${c.category}`);
  const conv = `heldout_${c.id}_${Date.now()}`;
  let history = [];
  let state = null;
  let prevSubject = null;
  let subjectName = null;
  let otherName = null;
  const turns = [];
  for (const [ti, tdef] of c.turns.entries()) {
    let q = tdef.q.replace('{{SUBJECT_PROJECT}}', subjectName ?? 'Төсөл').replace('{{OTHER_PROJECT}}', otherName ?? 'Төсөл');
    let t;
    try {
      t = await client.turn(conv, q, history, state, ti * 2, { syntheticTools: c.syntheticTools, replaceTools: c.replaceTools, localMemory: c.localMemory });
    } catch (e) {
      console.log(`  ✗ ${short(q, 60)} — АЛДАА ${String(e.message).slice(0, 160)}`);
      turns.push({ q, error: String(e.message).slice(0, 300) });
      break;
    }
    const subj = t.ctx.conv_state_next?.subject;
    const seen = t.ctx.conv_state_next?.projectsSeen ?? [];
    if (ti === 0) {
      subjectName = subj?.name ?? null;
      otherName = seen.find((p) => p.name !== subjectName && p.name.length >= 4)?.name ?? null;
    }
    const info = {
      contract: t.contract, subject: subj?.name ?? subjectName, prevSubject: ti > 0 ? prevSubject : null, other: otherName,
    };
    const rawJ = GEN ? judge(t.rec.raw, tdef.expect ?? {}, { ...info, rep: t.rec.repetition?.raw, style: t.rec.style?.raw }) : [];
    const finJ = GEN ? judge(t.rec.final, tdef.expect ?? {}, { ...info, rep: t.rec.repetition?.final, style: t.rec.style?.final }) : [];
    // Гүн: серверийн шийдвэр хүлээгдсэнтэй таарах ёстой (детерминист, загварын чанараас хамаарахгүй).
    const expectedDepth = tdef.depth ?? null;
    const depthOk = expectedDepth === null || t.rec.depth === expectedDepth;
    if (!depthOk) console.log(`      depth ✗ сервер ${t.rec.depth} (${t.rec.depthReason}) ≠ хүлээгдсэн ${expectedDepth}`);
    const rec = { ...t.rec, id: c.id, category: c.category, turnIndex: ti, expect: tdef.expect ?? {}, expected_depth: expectedDepth, depth_ok: depthOk, raw_checks: rawJ, final_checks: finJ, raw_pass: rawJ.every((x) => x.ok), final_pass: finJ.every((x) => x.ok), raw_sentences: sentencesOf(t.rec.raw), final_sentences: sentencesOf(t.rec.final) };
    turns.push(rec);
    if (GEN) {
      console.log(`  ${rec.raw_pass ? '✓' : '✗'}raw ${rec.final_pass ? '✓' : '✗'}final · ${short(q, 60)} · src=${t.rec.source} · ${t.rec.genMs} мс`);
      for (const x of finJ.filter((x) => !x.ok)) console.log(`      final ✗ ${x.name} ${x.note}`);
      for (const x of rawJ.filter((x) => !x.ok && finJ.find((y) => y.name === x.name)?.ok)) console.log(`      raw   ✗ ${x.name} ${x.note} (гэрээ засав)`);
      console.log(`      → ${short(t.rec.final, 160)}`);
    } else console.log(`  · ${short(q, 60)} · ${t.plan.turn?.kind} · ${t.rec.tools.join(',') || '—'} · ${t.contract?.answerMode ?? 'free'}`);
    history = [...history, { role: 'user', content: q }, { role: 'assistant', content: t.answer ?? '…' }];
    state = t.ctx.conv_state_next;
    prevSubject = subj?.name ?? prevSubject;
  }
  results.push({ id: c.id, category: c.category, turns });
}

/* ── Нэгтгэл ─────────────────────────────────────────────────────── */
const allTurns = results.flatMap((r) => r.turns.filter((t) => !t.error));
const errors = results.flatMap((r) => r.turns.filter((t) => t.error));
const byCat = {};
for (const t of allTurns) {
  const k = t.category;
  byCat[k] ??= { n: 0, raw: 0, final: 0 };
  byCat[k].n += 1;
  if (t.raw_pass) byCat[k].raw += 1;
  if (t.final_pass) byCat[k].final += 1;
}
const rawPass = allTurns.filter((t) => t.raw_pass).length;
const finalPass = allTurns.filter((t) => t.final_pass).length;
const rawValid = allTurns.filter((t) => t.rawValid !== false).length;
const finalValid = allTurns.filter((t) => t.finalValid !== false).length;
const severeRaw = allTurns.filter((t) => t.repetition?.raw?.severe).length;
const severeFinal = allTurns.filter((t) => t.repetition?.final?.severe).length;
const styleRaw = allTurns.reduce((a, t) => a + (t.style?.raw?.total ?? 0), 0);
const styleFinal = allTurns.reduce((a, t) => a + (t.style?.final?.total ?? 0), 0);
const src = allTurns.reduce((a, t) => ({ ...a, [t.source]: (a[t.source] ?? 0) + 1 }), {});
const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
const ft = allTurns.map((t) => t.firstTokenMs).filter((x) => x !== null && x !== undefined);
const gm = allTurns.map((t) => t.genMs).filter((x) => x !== null && x !== undefined);
const lens = allTurns.map((t) => (t.final ?? '').length);
// Гүн бүрээр урт (§30) — «богино богино хэвээр, дэлгэрэнгүй дэлгэрэнгүй хэвээр» эсэх.
const byDepth = {};
for (const t of allTurns) {
  const k = t.expected_depth ?? '—';
  byDepth[k] ??= { n: 0, depth_ok: 0, raw_chars: [], final_chars: [], raw_sentences: [], final_sentences: [], raw_pass: 0, final_pass: 0 };
  byDepth[k].n += 1;
  if (t.depth_ok) byDepth[k].depth_ok += 1;
  byDepth[k].raw_chars.push((t.raw ?? '').length);
  byDepth[k].final_chars.push((t.final ?? '').length);
  byDepth[k].raw_sentences.push(t.raw_sentences ?? 0);
  byDepth[k].final_sentences.push(t.final_sentences ?? 0);
  if (t.raw_pass) byDepth[k].raw_pass += 1;
  if (t.final_pass) byDepth[k].final_pass += 1;
}
for (const v of Object.values(byDepth)) for (const k of ['raw_chars', 'final_chars', 'raw_sentences', 'final_sentences']) v[k] = avg(v[k]);
const summary = {
  label: LABEL, gen: GEN, cases: results.length, turns: allTurns.length, errors: errors.length,
  by_depth: byDepth, depth_ok: allTurns.filter((t) => t.depth_ok).length,
  raw_pass: rawPass, final_pass: finalPass,
  raw_contract_valid: rawValid, final_contract_valid: finalValid,
  severe_repetition_raw: severeRaw, severe_repetition_final: severeFinal,
  style_hits_raw: styleRaw, style_hits_final: styleFinal,
  source: src, first_token_ms_avg: avg(ft), gen_ms_avg: avg(gm), final_chars_avg: avg(lens),
  by_category: byCat,
};
if (GEN) {
  console.log(`\n── ${LABEL} · ТҮҮХИЙ ${rawPass}/${allTurns.length} · ЭЦСИЙН ${finalPass}/${allTurns.length} · гэрээ raw ${rawValid}/${allTurns.length} final ${finalValid}/${allTurns.length} · хүчтэй давталт raw ${severeRaw} final ${severeFinal} · хэв маяг raw ${styleRaw} final ${styleFinal} · эх сурвалж ${JSON.stringify(src)} · эхний токен ${avg(ft)} мс · үүсгэлт ${avg(gm)} мс · алдаа ${errors.length}`);
  for (const [k, v] of Object.entries(byCat)) console.log(`   ${k.padEnd(22)} raw ${v.raw}/${v.n} · final ${v.final}/${v.n}`);
  console.log(`── ГҮНЭЭР (сервер зөв ${summary.depth_ok}/${allTurns.length}):`);
  for (const [k, v] of Object.entries(byDepth)) console.log(`   ${k.padEnd(9)} n=${v.n} · raw ${v.raw_chars} тэмдэгт/${v.raw_sentences} өгүүлбэр · final ${v.final_chars}/${v.final_sentences} · raw тэнцсэн ${v.raw_pass}/${v.n}`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = flag('json', null) ?? path.join(HERE, 'benchmarks', `heldout-gen-${LABEL.replace(/[^A-Za-z0-9.-]+/g, '_')}-${stamp}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ measured_at: new Date().toISOString(), identity, summary, results }, null, 2), 'utf8');
console.log(`→ ${out}`);
if (GEN) {
  const md = [`# heldout-gen · ${LABEL} · ${identity.system_prompt_version} · ${new Date().toISOString()}`, '', '```json', JSON.stringify(identity, null, 1), '```', ''];
  for (const r of results) for (const t of r.turns) {
    if (t.error) { md.push(`## ${r.id} · ${t.q}`, '', `АЛДАА: ${t.error}`, ''); continue; }
    md.push(`## ${r.id}/${t.turnIndex} · ${r.category} · ${t.question}`, '', `- raw ${t.raw_pass ? '✓' : '✗'} · final ${t.final_pass ? '✓' : '✗'} · гэрээ ${t.contract ? `${t.contract.mode}/${t.contract.risk}` : 'free'} · эх сурвалж ${t.source} · зөрчил ${JSON.stringify(t.violations)} · ${t.genMs} мс`, `- шалгалт raw: ${t.raw_checks.map((x) => `${x.ok ? '✓' : '✗'}${x.name}`).join(' ')}`, `- шалгалт final: ${t.final_checks.map((x) => `${x.ok ? '✓' : '✗'}${x.name}`).join(' ')}`, '', '### түүхий', '', t.raw ?? '', '', '### эцсийн', '', t.final ?? '', '');
  }
  const mdOut = out.replace(/\.json$/, '.cases.md');
  fs.writeFileSync(mdOut, md.join('\n'), 'utf8');
  console.log(`→ ${mdOut}`);
}
process.exit(errors.length ? 1 : 0);
