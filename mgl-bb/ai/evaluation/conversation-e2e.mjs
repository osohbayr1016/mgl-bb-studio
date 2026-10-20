#!/usr/bin/env node
/**
 * `npm run ai:eval:conv [-- --gen] [--api http://127.0.0.1:3000/api] [--user A.Anand --pass admin123] [--json <out>]`
 *
 * ЯРИАНЫ КЕРНЕЛ + ИТГЭМЖЛЭГДСЭН БАРИМТЫН ГЭРЭЭНИЙ E2E (§18–§20, §41).
 *
 * ⚠️ ЭНЭ НЬ БОДИТ ЗАМ: /plan (судалгааны шатуудтай) → /tool → локал /norm →
 *    /context → (--gen бол) локал /generate → `validator.ts`-ийн гэрээ
 *    (хөтчийн ЯГ тэр код: шалгах → засах → ЯГ НЭГ дахилт → детерминист).
 *    Нэгжийн тест нь тайлагчийг, энэ нь БҮХ гинжийг бодит D1, бодит
 *    Qwen дээр шалгана.
 *
 * ⚠️ ТҮҮХИЙ ба ЭЦСИЙН хариултыг ХОЁУЛАНГ нь бүртгэнэ (§20): сайжрал нь
 *    загварынх уу, runtime-ийн хамгаалалтынх уу гэдгийг ялгахын тулд.
 *    Давталтын хэмжүүр хоёуланд нь.
 *
 * ⚠️ --gen ҮГҮЙ бол бүтцийн шалгалт (загваргүй, ~3 сек); --gen бол Qwen-ийн
 *    бодит хариулт дээр нэмэлт шалгалт + давталт + гэрээний статистик.
 *    Загварын чанараас хамаарах шалгалтууд «gen» гэж тэмдэглэгдэнэ.
 */
import fs from 'node:fs';
import path from 'node:path';
import { summarizeRepetition } from './lib/repetition.mjs';
import { summarizeStyle } from './lib/style.mjs';
import { createClient, IDENTITY_RE, cyr, lat, mostlyCyrillic, short } from './lib/e2e.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};
const API = flag('api', 'http://127.0.0.1:3000/api');
// ⚠️ `--rt` нь ӨӨР runtime (жишээ нь адаптертай нэр дэвшигч, өөр порт) руу
//    заана — суурь ба нэр дэвшигчийг ЯГ ИЖИЛ suite-ээр харьцуулахад (§31).
const RT = flag('rt', 'http://127.0.0.1:39217');
const GEN = argv.includes('--gen');
// Тайланд бичигдэх шошго («baseline», «candidate:mgl-adapter-0.1-smoke»).
const LABEL = flag('label', 'baseline');
// ⚠️ Ээлжийн логик нь `lib/e2e.mjs`-д — `heldout-gen.mjs`-тэй ХУВААЛЦДАГ.
const client = createClient({ api: API, rt: RT, gen: GEN });
const { api } = client;

/* ── Тайлан ─────────────────────────────────────────────────────── */
const checks = [];
const cases = [];
function check(name, ok, detail = '', gen = false) {
  checks.push({ name, ok, gen });
  console.log(`  ${ok ? '✓' : '✗'} ${gen ? '[gen] ' : ''}${name}${detail ? ' — ' + detail : ''}`);
}

/** Нэг ээлж бүхэлдээ — хөтчийн orchestrator-ийн ижил дараалал (lib/e2e.mjs). */
async function turn(conv, question, history, state, seq, opts = {}) {
  const r = await client.turn(conv, question, history, state, seq, opts);
  cases.push(r.rec);
  return r;
}

/* ── login ─────────────────────────────────────────────────────── */
const sess = await client.login(flag('user', 'A.Anand'), flag('pass', 'admin123'));
console.log(`login ok · mode=${sess.mode} user=${sess.user_id} · gen=${GEN}`);
/**
 * ⚠️ СУУРИЙН ТАНИХ ТЭМДЭГ (§9).  Тайлан бүр ЯМАР систем хувилбар, ЯМАР
 *    загвар/адаптер дээр хэмжигдснээ өөртөө агуулна — `readiness.mjs` нь
 *    ЗӨВХӨН одоогийн `system_prompt_version`-тэй таарах тайланг хаалгад
 *    ашиглана.  Өмнө нь энэ талбар байгаагүй тул хуучирсан тайлан (sys-4)
 *    одоогийн системийг (sys-5) буруугаар унагаж байв.
 */
const identity = await client.identity(LABEL);
console.log(`identity: ${JSON.stringify(identity)}`);

/* ══ ЯРИА 1 — A, B (мета, ERP) ═════════════════════════════════════ */
console.log('\n■ A · «chi ymar asuultand hariulj chadah ve»');
{
  const t = await turn('conv_a_' + Date.now(), 'chi ymar asuultand hariulj chadah ve', [], null, 0);
  check('A · META, хэрэгсэлгүй', t.plan.intent === 'META' && t.plan.tools.length === 0);
  check('A · гэрээ free', !t.contract || t.contract.answerMode === 'free');
  if (t.answer !== null) {
    console.log(`    → ${short(t.answer)}`);
    check('A · кирилл хариулт', mostlyCyrillic(t.answer), '', true);
    check('A · identity дурдаагүй', !IDENTITY_RE.test(t.answer), '', true);
  }
}

console.log('\n■ B · «manai company heden ajiltantai ve»');
{
  const t = await turn('conv_b_' + Date.now(), 'manai company heden ajiltantai ve', [], null, 0);
  const n = t.tools.find((x) => x.tool === 'get_active_employees')?.data?.total_active;
  check('B · get_active_employees дуудав', n !== undefined, `total_active=${n}`);
  check('B · гэрээ grounded, active_employees заавал', t.contract?.answerMode === 'grounded' && t.contract.facts.some((f) => f.id === 'active_employees'));
  if (t.answer !== null) {
    console.log(`    → ${short(t.answer)}`);
    check('B · эцсийн хариултад ЯГ серверийн тоо', t.answer.includes(String(n)), `n=${n} src=${t.rec.source}`, true);
    check('B · гэрээнд нийцсэн', t.rec.finalValid, '', true);
  }
}

/* ══ ЯРИА 2 — C, D, G (deadline → яагаад → норм → засвар) ══════════ */
console.log('\n■ C/D/G · deadline → yagaad → g=1800 → засвар');
{
  const conv = 'conv_cdg_' + Date.now();
  let history = [];
  let state = null;
  const q1 = 'ali project hamgiin oir deadline-tei ve';
  const t1 = await turn(conv, q1, history, state, 0);
  const subj = t1.ctx.conv_state_next?.subject;
  check('C1 · get_upcoming_deadlines + сэдэв тогтов', t1.tools.some((x) => x.tool === 'get_upcoming_deadlines') && subj?.kind === 'project', JSON.stringify(subj));
  check('C1 · persona none', t1.ctx.context_diag?.persona === 'none');
  const a1 = t1.answer ?? `${subj?.name ?? 'X'} хамгийн ойрхон дуусна.`;
  if (t1.answer !== null) {
    console.log(`    → ${short(t1.answer)}`);
    check('C1 · төслийн нэр хариултад', subj && t1.answer.includes(subj.name), `src=${t1.rec.source}`, true);
    check('C1 · identity дурдаагүй', !IDENTITY_RE.test(t1.answer), '', true);
  }
  history = [{ role: 'user', content: q1 }, { role: 'assistant', content: a1 }];
  state = t1.ctx.conv_state_next;

  const q2 = 'yagaad udaad bna';
  const t2 = await turn(conv, q2, history, state, 2);
  check('C2 · FOLLOW_UP, analyze_project(сэдэв)', t2.plan.turn?.kind === 'FOLLOW_UP' && t2.tools.some((x) => x.tool === 'analyze_project'), t2.tools.map((x) => x.tool).join(','));
  check('C2 · сэдвийн мөр prompt-д', t2.ctx.turns[0].content.includes('ИДЭВХТЭЙ СЭДЭВ'));
  if (t2.answer !== null) {
    console.log(`    → ${short(t2.answer, 300)}`);
    check('C2 · төслийг заав', (subj && t2.answer.includes(subj.name)) || /энэ төс/i.test(t2.answer), `src=${t2.rec.source}`, true);
    check('C2 · identity дурдаагүй', !IDENTITY_RE.test(t2.answer), '', true);
    check('C2 · гэрээнд нийцсэн (тоо зөвхөн хайрцгаас)', t2.rec.finalValid, '', true);
  }
  history = [...history, { role: 'user', content: q2 }, { role: 'assistant', content: t2.answer ?? 'Явц удаан.' }];
  state = t2.ctx.conv_state_next;

  const q3 = 'g=1800 MJ/m2 bol V2 yu V3 yu';
  const t3 = await turn(conv, q3, history, state, 4);
  check('D · NEW_TOPIC, түүх 0, ERP хэрэгсэлгүй', t3.plan.turn?.kind === 'NEW_TOPIC' && t3.ctx.context_diag?.history_messages === 0 && t3.tools.length === 0);
  check('D · prompt-д төслийн нэр БАЙХГҮЙ', subj && !t3.prompt.includes(subj.name));
  check('D · шийдвэр verified В2, гэрээ authoritative/high', t3.ctx.norm_decision?.status === 'verified' && t3.contract?.answerMode === 'authoritative' && t3.contract.risk === 'high', JSON.stringify(t3.contract?.facts));
  if (t3.answer !== null) {
    console.log(`    → ${short(t3.answer, 300)}`);
    check('D · В2 + 1401/2200 хариултад', /В2/.test(t3.answer) && /1401/.test(t3.answer) && /2200/.test(t3.answer), `src=${t3.rec.source}`, true);
    check('D · төслийн нэр хариултад БАЙХГҮЙ', subj && !t3.answer.includes(subj.name), '', true);
    check('D · гэрээнд нийцсэн', t3.rec.finalValid, JSON.stringify(t3.rec.violations), true);
  }
  history = [...history, { role: 'user', content: q3 }, { role: 'assistant', content: t3.answer ?? 'В2.' }];
  state = t3.ctx.conv_state_next;

  const seen = state?.projectsSeen ?? [];
  const other = seen.find((p) => p.id !== subj?.id && p.name.length >= 4);
  if (other && subj) {
    const q4 = `${subj.name} төслийн явц хэд вэ?`;
    const t4 = await turn(conv, q4, history, state, 6);
    history = [...history, { role: 'user', content: q4 }, { role: 'assistant', content: t4.answer ?? 'Явц 40%.' }];
    state = t4.ctx.conv_state_next;
    const q5 = `үгүй ээ, ${other.name}-г хэлсэн юм`;
    const t5 = await turn(conv, q5, history, state, 8);
    check('G · CORRECTION → сэдэв B, төслийн хэрэгсэл B дээр', t5.plan.turn?.kind === 'CORRECTION' && t5.plan.turn.subject?.id === other.id && t5.tools.some((x) => x.args?.project_id === other.id), other.name);
    if (t5.answer !== null) {
      console.log(`    → ${short(t5.answer, 300)}`);
      check('G · хариултад B-ийн нэр, A-ийн нэр БИШ', t5.answer.includes(other.name) && !t5.answer.includes(subj.name), `src=${t5.rec.source}`, true);
    }
  } else {
    console.log('  (G алгасав — хоёр дахь төсөл олдсонгүй)');
  }
}

/* ══ E · V2 муж ══════════════════════════════════════════════════════ */
console.log('\n■ E · «V2 galyn achaalal hed ve»');
{
  const t = await turn('conv_e_' + Date.now(), 'V2 galyn achaalal hed ve', [], null, 0);
  check('E · lookup шийдвэр, gerее authoritative', t.ctx.norm_decision?.mode === 'lookup' && t.contract?.answerMode === 'authoritative');
  if (t.answer !== null) {
    console.log(`    → ${short(t.answer, 300)}`);
    check('E · В2 + 1401–2200, эх сурвалж', /В2/.test(t.answer) && /1401/.test(t.answer) && /21-101-12/.test(t.answer), `src=${t.rec.source}`, true);
    check('E · «м²» талбайн зохиомол тоо БАЙХГҮЙ', !/\b(10|20)\s*м²/.test(t.answer), '', true);
    check('E · гэрээнд нийцсэн', t.rec.finalValid, JSON.stringify(t.rec.violations), true);
  }
}

/* ══ F · олон санаа ═══════════════════════════════════════════════════ */
console.log('\n■ F · олон санаа');
{
  const t = await turn('conv_f_' + Date.now(), 'Манай компанид хэдэн идэвхтэй төсөл байгаа вэ? Бас В2 ангиллын галын ачаалал хэдээс хэд вэ?', [], null, 0);
  const ac = t.tools.find((x) => x.tool === 'list_projects')?.data?.active_count;
  check('F · MULTI_INTENT, list_projects + шийдвэр', t.plan.turn?.kind === 'MULTI_INTENT' && ac !== undefined && t.ctx.norm_decision?.status === 'verified', `active=${ac}`);
  if (t.answer !== null) {
    console.log(`    → ${short(t.answer, 400)}`);
    check('F · 1)/2) бүтэц', /1\)/.test(t.answer) && /2\)/.test(t.answer), `src=${t.rec.source}`, true);
    check('F · идэвхтэй тоо = active_count', t.answer.includes(String(ac)), '', true);
    check('F · В2 муж 1401–2200', /1401/.test(t.answer) && /2200/.test(t.answer), '', true);
  }
}

/* ══ H · норм олдсонгүй ══════════════════════════════════════════════ */
console.log('\n■ H · норм NO_MATCH');
{
  const t = await turn('conv_h_' + Date.now(), 'Лифтний хонгилын хананы галд тэсвэрлэх хугацаа хэдэн цаг байх ёстой вэ?', [], null, 0);
  check('H · гэрээ refusal, noMatch', t.contract?.answerMode === 'refusal' && t.contract.noMatch === true, `norm=${JSON.stringify(t.rec.norm)} ev=${t.ctx.evidence.length}`);
  if (t.answer !== null) {
    console.log(`    → ${short(t.answer, 300)}`);
    check('H · канон татгалзал эхэнд', t.answer.startsWith(t.contract.requiredSentence), `src=${t.rec.source}`, true);
    check('H · зохиомол тоо, эшлэл БАЙХГҮЙ', !/\d+\s*(цаг|минут|мм|м²)/u.test(t.answer) && !/заасны дагуу|-д заасан/u.test(t.answer), '', true);
    check('H · гэрээнд нийцсэн', t.rec.finalValid, JSON.stringify(t.rec.violations), true);
  }
}

/* ══ I · хуучин ба одоогийн ══════════════════════════════════════════ */
console.log('\n■ I · хуучин баримт vs одоогийн асуулт');
{
  const t = await turn('conv_i_' + Date.now(), 'Одоо Монгол Улсад нормд тусгагдаагүй шинэ материал ашиглах бол ямар байгууллагаас зөвшөөрөл авах вэ?', [], null, 0);
  const lr = t.ctx.local_norm;
  check('I · локал заалт нотолгоо болов', t.ctx.evidence.length > 0, `norm=${JSON.stringify(t.rec.norm)}`);
  const trailer = t.contract?.trailerText;
  // Amendment D (2026-09-11): трейлер ЗӨВХӨН шийдвэрт нөлөөлөх төлөвт (SUPERSEDED / HISTORICAL /
  //    NEEDS_HUMAN_REVIEW / UNKNOWN); «мөрдөгдөж буй, нэмэлт өөрчлөлт шалгаагүй» (УББ-11-201-00 —
  //    CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED) нь ТОВЧ ТЭМДЭГЛЭЛ (мета), «хуучин» трейлер БИШ.
  const noteOnly = ['CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED', 'LISTED_CURRENT_NOT_SOURCE_VERIFIED', 'IN_FORCE_VERIFIED'].includes(lr?.currentness);
  check(
    'I · хуучин/шалгаагүй баримт: трейлер төлөвөөр (Amendment D)',
    !t.ctx.answer_contract || t.ctx.answer_contract.kind !== 'norm_legal_review' || (noteOnly ? !trailer : !!trailer),
    `legacy=${t.ctx.answer_contract?.kind} currentness=${lr?.currentness} trailer=${trailer ? 'бий' : 'үгүй'} lr=${JSON.stringify(lr && { status: lr.status, used: lr.used_as_evidence })}`,
  );
  if (t.answer !== null) {
    console.log(`    → ${short(t.answer, 400)}`);
    if (trailer) check('I · трейлер хариултын төгсгөлд', t.answer.includes(trailer), `src=${t.rec.source}`, true);
    check('I · identity дурдаагүй', !IDENTITY_RE.test(t.answer), '', true);
  }
}

/* ══ J · урт хариултын давталт ═══════════════════════════════════════ */
console.log('\n■ J · урт хариулт (давталт)');
{
  const t = await turn('conv_j_' + Date.now(), 'Барилгын зураг төслийн ажлын үе шатуудыг эхнээс нь дуустал дэлгэрэнгүй тайлбарлаад өгөөч', [], null, 0);
  if (t.answer !== null) {
    const m = t.rec.repetition.final;
    console.log(`    → ${short(t.answer, 200)} … (${t.answer.length} тэмдэгт, ${m.sentences} өгүүлбэр)`);
    // ⚠️ 4-грамын хувь ХААЛГА БИШ (§11): урт техникийн хариултад «галын
    //    аюулын ангилал», «хүчин төгөлдөр» гэх мэт хууль ёсны хэллэг олон
    //    удаа давтагддаг.  Хүчтэй дохио — ижил өгүүлбэр/догол, залгаа блок,
    //    гогцоо суффикс, зэргэлдээ хувилбар, ≥6 үгийн цонх ≥3 удаа — Л унагана.
    //    Тайланд 4-грам хэвээр бичигдэнэ (мэдээлэл), J нь `.cases.md`-д бүтнээрээ.
    check('J · ижил өгүүлбэр < 2, ижил догол 0', m.exactRepeatedSentences < 2 && m.exactRepeatedParagraphs === 0, `өгүүлбэр ${m.exactRepeatedSentences} · догол ${m.exactRepeatedParagraphs}`, true);
    check('J · залгаа давтагдсан блок алга', !m.contiguousRepeatedBlock, '', true);
    check('J · зэргэлдээ хувилбар давталт < 2', m.nearDuplicateAdjacent < 2, String(m.nearDuplicateAdjacent), true);
    check('J · ≥6 үгийн цонх 3-аас олон удаа гараагүй', m.longestRepeatedRun < 3, `max ${m.longestRepeatedRun}× · 4-грам ${(m.repeatedNgramRate * 100).toFixed(1)}% (мэдээлэл)`, true);
    check('J · гогцоо суффикс алга', !m.loopingSuffix, '', true);
  }
}

/* ══ K · identity (ERP хоцролт) ══════════════════════════════════════ */
console.log('\n■ K · «Хамгийн хоцорсон таскууд юу байна?»');
{
  const t = await turn('conv_k_' + Date.now(), 'Хамгийн хоцорсон таскууд юу байна?', [], null, 0);
  const n = t.tools.find((x) => x.tool === 'get_overdue_tasks')?.data?.count;
  check('K · persona none, get_overdue_tasks', t.ctx.context_diag?.persona === 'none' && n !== undefined, `count=${n}`);
  if (t.answer !== null) {
    console.log(`    → ${short(t.answer, 300)}`);
    check('K · identity дурдаагүй', !IDENTITY_RE.test(t.answer), '', true);
    check('K · гэрээнд нийцсэн', t.rec.finalValid, JSON.stringify(t.rec.violations), true);
  }
}

/* ══ L · англи ═══════════════════════════════════════════════════════ */
console.log('\n■ L · English');
{
  const t = await turn('conv_l_' + Date.now(), 'How many active projects do we have right now?', [], null, 0);
  const ac = t.tools.find((x) => x.tool === 'list_projects')?.data?.active_count;
  check('L · response_language en, list_projects', t.ctx.response_language === 'en' && ac !== undefined, `active=${ac}`);
  if (t.answer !== null) {
    console.log(`    → ${short(t.answer)}`);
    check('L · англи хариулт, тоо зөв', lat(t.answer) > cyr(t.answer) && t.answer.includes(String(ac)), `src=${t.rec.source}`, true);
  }
}

/* ══ M · латин холимог, Revit ════════════════════════════════════════ */
console.log('\n■ M · «Revit deer ene wall-iin area hed ve»');
{
  const t = await turn('conv_m_' + Date.now(), 'Revit deer ene wall-iin area hed ve', [], null, 0);
  check('M · REVIT_READ, ERP хэрэгсэлгүй, кирилл хариулт төлөвлөв', t.plan.intent === 'REVIT_READ' && t.tools.length === 0 && t.ctx.response_language === 'mn-Cyrl');
  if (t.answer !== null) {
    console.log(`    → ${short(t.answer)}`);
    check('M · кирилл хариулт', mostlyCyrillic(t.answer), '', true);
    check('M · зохиомол талбайн тоо БАЙХГҮЙ (Revit холбогдоогүй)', !/\d+([.,]\d+)?\s*(м²|m2|м2)/u.test(t.answer), '', true);
  }
}

/* ══ N · хэрэгсэл унасан / эрхгүй (синтетик) ═════════════════════════ */
console.log('\n■ N · эрх татгалзсан хэрэгсэл (синтетик үр дүн)');
{
  const t = await turn('conv_n_' + Date.now(), 'Сонгосон хананы өндрийг 3 метр болгож өөрчил', [], null, 0, {
    syntheticTools: [{ tool: 'get_project_progress', ok: false, data: null, error: 'Энэ хэрэгслийг ажиллуулах эрхгүй.' }],
  });
  check('N · гэрээнд хориотой хэллэг', (t.contract?.forbiddenPhrases ?? []).includes('өөрчиллөө'));
  if (t.answer !== null) {
    console.log(`    → ${short(t.answer, 300)}`);
    check('N · «өөрчиллөө/амжилттай» гэж хэлээгүй', !/өөрчиллөө|амжилттай|өөрчилсөн/u.test(t.answer), `src=${t.rec.source}`, true);
  }
}

/* ══ O · санамжийн дохио ═════════════════════════════════════════════ */
console.log('\n■ O · «цаашид богино хариулаарай»');
{
  const t = await turn('conv_o_' + Date.now(), 'цаашид хариултаа богино бичээрэй', [], null, 0);
  check('O · memory_hints: answer_length=short, байнгын', (t.plan.memory_hints ?? []).some((h) => h.type === 'answer_length' && h.value === 'short' && !h.reason.includes('нэг удаагийн')));
}

/* ══ Нэгтгэл ═════════════════════════════════════════════════════════ */
const fails = checks.filter((c) => !c.ok);
const structural = checks.filter((c) => !c.gen);
const genChecks = checks.filter((c) => c.gen);
console.log(`\n── БҮТЭЦ: ${structural.filter((c) => c.ok).length}/${structural.length}`);
if (GEN) {
  console.log(`── ҮҮСГЭЛТ: ${genChecks.filter((c) => c.ok).length}/${genChecks.length}`);
  const gen = cases.filter((c) => c.raw !== null);
  const src = gen.reduce((a, c) => ({ ...a, [c.source]: (a[c.source] ?? 0) + 1 }), {});
  const viol = {};
  for (const c of gen) for (const codes of c.violations) for (const code of codes) viol[code] = (viol[code] ?? 0) + 1;
  const rawRep = summarizeRepetition(gen.map((c) => c.repetition.raw));
  const finRep = summarizeRepetition(gen.map((c) => c.repetition.final));
  const rawSty = summarizeStyle(gen.map((c) => c.style.raw));
  const finSty = summarizeStyle(gen.map((c) => c.style.final));
  const styLine = (s) => `${s.withIssues}/${s.n} хариултад гажиг · ${s.avgPerHundredWords}/100 үг · ${Object.entries(s.byKind).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ') || '—'}`;
  const ft = gen.map((c) => c.firstTokenMs).filter((x) => x !== null);
  const gm = gen.map((c) => c.genMs);
  console.log(`── ГЭРЭЭ: эцсийн эх сурвалж ${JSON.stringify(src)} · түүхий зөрчил ${JSON.stringify(viol)} · дахилт ${gen.filter((c) => c.attempts === 2).length}/${gen.length}`);
  console.log(`── ДАВТАЛТ түүхий: өгүүлбэр ${(rawRep.exactDuplicateSentenceRate.avg * 100).toFixed(1)}% (max ${(rawRep.exactDuplicateSentenceRate.max * 100).toFixed(0)}%) · 4-грам ${(rawRep.repeatedNgramRate.avg * 100).toFixed(1)}% (мэдээлэл) · гогцоо ${rawRep.loopingSuffix} · ХҮЧТЭЙ ${rawRep.severe}/${rawRep.n}`);
  console.log(`── ДАВТАЛТ эцсийн: өгүүлбэр ${(finRep.exactDuplicateSentenceRate.avg * 100).toFixed(1)}% (max ${(finRep.exactDuplicateSentenceRate.max * 100).toFixed(0)}%) · 4-грам ${(finRep.repeatedNgramRate.avg * 100).toFixed(1)}% (мэдээлэл) · гогцоо ${finRep.loopingSuffix} · ХҮЧТЭЙ ${finRep.severe}/${finRep.n}`);
  console.log(`── ХЭВ МАЯГ түүхий: ${styLine(rawSty)}`);
  console.log(`── ХЭВ МАЯГ эцсийн: ${styLine(finSty)}`);
  console.log(`── ХУРД: эхний токен дундаж ${Math.round(ft.reduce((a, b) => a + b, 0) / (ft.length || 1))} мс · үүсгэлт дундаж ${Math.round(gm.reduce((a, b) => a + b, 0) / (gm.length || 1))} мс · plan дундаж ${Math.round(cases.reduce((a, c) => a + c.planMs, 0) / cases.length)} мс`);
}
if (fails.length) console.log(`УНАСАН: ${fails.map((f) => f.name).join(' | ')}`);

const out = flag('json', null) ?? path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'benchmarks', `conv-e2e-${GEN ? 'gen' : 'structural'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ measured_at: new Date().toISOString(), gen: GEN, identity, checks, cases }, null, 2), 'utf8');
console.log(`→ ${out}`);
// ⚠️ ХҮНИЙ НҮДЭЭР ШАЛГАХ ХУВЬ (§11): кейс бүрийн асуулт / түүхий / эцсийн
//    хариулт бүтнээрээ — «J-ийн 4-грам 25%» гэдэг тоо нь давталт уу, хууль
//    ёсны хэллэг үү гэдгийг зөвхөн текстийг уншиж л хэлнэ.
if (GEN) {
  const md = [`# conv-e2e · ${identity.label} · ${identity.system_prompt_version} · ${new Date().toISOString()}`, '', '```json', JSON.stringify(identity, null, 1), '```', ''];
  cases.forEach((c, i) => {
    const m = c.repetition?.final ?? {};
    md.push(`## ${String.fromCharCode(65 + Math.min(i, 25))}${i > 25 ? i : ''} · ${c.question}`, '', `- ээлж: ${c.turn} · санаа: ${c.intent} · хэрэгсэл: ${c.tools.join(', ') || '—'} · гэрээ: ${c.contract ? `${c.contract.mode}/${c.contract.risk}` : 'free'} · эх сурвалж: ${c.source} · зөрчил: ${JSON.stringify(c.violations)}`, `- давталт (эцсийн): ижил өгүүлбэр ${m.exactRepeatedSentences ?? '—'} · залгаа блок ${m.contiguousRepeatedBlock ?? '—'} · зэргэлдээ ${m.nearDuplicateAdjacent ?? '—'} · цонх ${m.longestRepeatedRun ?? '—'}× · 4-грам ${m.repeatedNgramRate !== undefined ? (m.repeatedNgramRate * 100).toFixed(1) + '%' : '—'} · гогцоо ${m.loopingSuffix ?? '—'} · ХҮЧТЭЙ ${m.severe ?? '—'}`, '', '### түүхий', '', c.raw ?? '_(үүсгээгүй)_', '', '### эцсийн', '', c.final ?? '_(үүсгээгүй)_', '');
  });
  const mdOut = out.replace(/\.json$/, '.cases.md');
  fs.writeFileSync(mdOut, md.join('\n'), 'utf8');
  console.log(`→ ${mdOut}`);
}
process.exit(structural.some((c) => !c.ok) ? 1 : 0);
