#!/usr/bin/env node
/**
 * MGL AI · КОМПАНИЙН АСУУЛТЫН АЛТАН ТЕСТ — ТӨГСГӨЛ-ТӨГСГӨЛД (§33, §45, §61).
 *
 *   cd ai && node evaluation/company-golden.mjs             # 10 асуулт + үнэлгээ
 *   node evaluation/company-golden.mjs --json               # машинд
 *   node evaluation/company-golden.mjs "asuult" "asuult 2"  # дурын асуулт
 *
 * Шаардлага: локал backend (`cd backend && npm run dev`, :3000) + локал
 * runtime (`npm run ai:start`, :39217).  Нэвтрэлт: MGLAI_EVAL_USER /
 * MGLAI_EVAL_PASS (өгөгдмөл A.Anand / admin123 — локал D1-ийн хуулбар).
 *
 * ⚠️ ЯГ ХӨТЧИЙН УРСГАЛЫГ ДАВТАНА: /plan (олон шат) → /tool (зэрэг) →
 *    локал /norm → /context → локал /generate → гэрээ.  Router-ийг биш,
 *    БҮХЭЛ гинжийг хэмжинэ (§61: «Do not just test the router»).
 *
 * ⚠️ ҮНЭЛГЭЭ НЬ ДЕТЕРМИНИСТ: хариултад орсон ТОО бүр хэрэгслийн үр дүнд
 *    байгаа эсэх (grounded), заавал байх мөр (эрэмбэ, гэрээний трейлер),
 *    хориотой мөр («асуулт байхгүй», зохиомол «хувьцаа»).  Загварын
 *    үг хэллэгийг дүгнэдэггүй — тэр нь хүний ажил.
 */
import { readFileSync } from 'node:fs';

const API = process.env.MGLAI_EVAL_API ?? 'http://127.0.0.1:3000/api';
const RT = process.env.MGLAI_EVAL_RUNTIME ?? 'http://127.0.0.1:39217';
const USER = process.env.MGLAI_EVAL_USER ?? 'A.Anand';
const PASS = process.env.MGLAI_EVAL_PASS ?? 'admin123';
const JSON_OUT = process.argv.includes('--json');
const argQs = process.argv.slice(2).filter((a) => !a.startsWith('--'));

let SECRET = '';
try {
  SECRET = readFileSync(`${process.env.LOCALAPPDATA}/MglAi/secret.txt`, 'utf8').trim();
} catch {
  /* runtime-гүй машин — үүсгэлтгүй горим */
}

/* ── АЛТАН БАГЦ ─────────────────────────────────────────────────── */
const GOLDEN = [
  {
    id: 'A', q: 'company huudas yu aguuldg ve',
    expectTools: ['describe_system'], forbid: ['хувьцаа', 'мөнгөний төлбөр', 'асуулт байхгүй'],
    /** Хариултад describe_system-ийн БОДИТ хуудас/хэсгийн нэр ≥ 3 байх ёстой. */
    catalogLabels: 3,
  },
  {
    id: 'B', q: 'manai website d hamgiin idevhtei ajilladag ajiltan hen be',
    expectTools: ['get_employee_activity'], forbid: ['асуулт байхгүй'],
    mustMentionAny: ['KPI', 'хэмжүүр', 'шинжилгээ'],
    topRankMentioned: true,
  },
  { id: 'C', q: 'how many projects we have', expectTools: ['list_projects', 'query_entities'], anyTool: true, numberFrom: ['total_visible', 'total_matching', 'count'] },
  { id: 'D', q: 'bidend niit heden tosol baina ve', expectTools: ['list_projects', 'query_entities'], anyTool: true, numberFrom: ['total_visible', 'total_matching', 'count'] },
  { id: 'E', q: 'duusah hugatsaa hamgiin oirhon irsen tosol ali ni ve', expectTools: ['get_upcoming_deadlines'], firstDeadlineMentioned: true },
  { id: 'F', q: 'ali tusul hamgiin oir deadline-tei ve', expectTools: ['get_upcoming_deadlines'], firstDeadlineMentioned: true },
  { id: 'G', q: 'system dotor heden tusul baina', expectTools: ['list_projects', 'query_entities'], anyTool: true, numberFrom: ['total_visible', 'total_matching', 'count'] },
  { id: 'H', q: 'ene project yagaad udaad bna', expectTools: ['analyze_project'], forbid: ['асуулт байхгүй'], followUp: true },
  { id: 'I', q: 'g=1800 MJ/m2 bol V2 yu V3 yu', normDecision: 'В2', mustMention: ['В2'] },
  {
    id: 'J',
    q: 'Монгол Улсад мөрдөж буй барилгын норм, дүрэмд тусгагдаагүй шинэ материал, эдлэхүүн эсвэл техникийн шийдэл ашиглах бол ямар байгууллагаас зөвшөөрөл авах шаардлагатай вэ?',
    contract: 'norm_legal_review', mustMentionAny: ['хүний хяналт', 'баталгаажуулах'], minEvidence: 1,
  },
];

/* ── ТУСЛАХ ─────────────────────────────────────────────────────── */
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
}).then((r) => r.json());
if (!login.token) {
  console.error('Нэвтрэлт бүтэлгүйтэв:', login);
  process.exit(2);
}
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
const post = (p, b) =>
  fetch(`${API}${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) }).then(async (r) => ({
    status: r.status,
    json: await r.json().catch(() => null),
  }));
const rtPost = (p, b) =>
  fetch(`${RT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MglAi-Secret': SECRET }, body: JSON.stringify(b) });

let runtimeOk = false;
try {
  runtimeOk = (await fetch(`${RT}/health`)).ok && SECRET.length > 0;
} catch {
  runtimeOk = false;
}

function numbersIn(text) {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
}
function numbersInData(v, out = new Set()) {
  if (typeof v === 'number') out.add(v);
  else if (typeof v === 'string') for (const n of numbersIn(v)) out.add(n);
  else if (Array.isArray(v)) v.forEach((x) => numbersInData(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => numbersInData(x, out));
  return out;
}
function pick(obj, keys) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (keys.includes(k) && typeof x === 'number') found.push(x); walk(x); }
  };
  walk(obj);
  return found;
}

/* ── НЭГ ЭЭЛЖ ──────────────────────────────────────────────────── */
async function runTurn(q, session) {
  const t0 = Date.now();
  const tools = [];
  const rounds = [];
  let first = null;
  for (let round = 0; round < 3; round++) {
    const { json: pj, status } = await post('/mgl-ai/plan', {
      question: q, conv_state: session.convState, seq: session.seq,
      last_assistant: session.history.at(-1)?.content ?? null,
      round, prior_results: tools.map((t) => ({ tool: t.tool, ok: t.ok, data: t.data, args: t.args })),
    });
    if (status !== 200 || !pj) throw new Error(`/plan ${status}`);
    first ??= pj;
    rounds.push({ round, tools: (pj.tools ?? []).map((t) => t.name), reason: pj.research_reason });
    const res = await Promise.all(
      (pj.tools ?? []).map(async (t) => {
        const s = Date.now();
        const r = await post('/mgl-ai/tool', { name: t.name, args: t.args });
        return { tool: t.name, args: t.args, ok: r.json?.ok === true, data: r.json?.data ?? null, status: r.status, error: r.json?.error ?? null, ms: Date.now() - s };
      }),
    );
    tools.push(...res);
    if (pj.done) break;
  }
  const tTools = Date.now() - t0;

  let norm = null;
  if (first.ask_local_norm && runtimeOk) {
    norm = await rtPost('/norm', { query: first.norm_query ?? q, audience: 'employee' }).then((r) => r.json()).catch(() => null);
  }

  const { json: cx, status: cs } = await post('/mgl-ai/context', {
    question: q, history: session.history, conv_state: session.convState, seq: session.seq,
    tool_results: tools.map((t) => ({ tool: t.tool, ok: t.ok, data: t.data })), norm_answer: norm,
  });
  if (cs !== 200 || !cx) throw new Error(`/context ${cs}`);
  const tContext = Date.now() - t0 - tTools;

  let answer = '';
  let stop = null;
  let firstToken = null;
  let gen = 0;
  if (runtimeOk) {
    const g0 = Date.now();
    const g = await rtPost('/generate', { turns: cx.turns, max_tokens: 1024, response_language: cx.response_language });
    // ⚠️ УРСГАЛААР уншина — эхний токены хугацаа бүхэл хариу татсан хугацаа биш.
    const reader = g.body.getReader();
    const dec = new TextDecoder();
    let txt = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      txt += dec.decode(value, { stream: true });
      if (firstToken === null && /event: token/.test(txt)) firstToken = Date.now() - g0;
    }
    for (const frame of txt.split('\n\n')) {
      let ev = 'message', data = '';
      for (const l of frame.split('\n')) { if (l.startsWith('event:')) ev = l.slice(6).trim(); else if (l.startsWith('data:')) data += l.slice(5).trim(); }
      if (!data) continue;
      try {
        const j = JSON.parse(data);
        if (ev === 'token') answer += j.text;
        if (ev === 'done') stop = j.stop_reason;
        if (ev === 'error') answer += `[ERR ${j.message}]`;
      } catch { /* ignore */ }
    }
    gen = Date.now() - g0;
  }
  if (cx.answer_contract?.trailerText) answer += `\n\n${cx.answer_contract.trailerText}`;

  session.history.push({ role: 'user', content: q }, { role: 'assistant', content: answer });
  session.convState = cx.conv_state_next ?? session.convState;
  session.seq += 2;

  return { q, plan: first, rounds, tools, ctx: cx, answer, stop, timing: { tools_ms: tTools, context_ms: tContext, generation_ms: gen, first_token_ms: firstToken, total_ms: Date.now() - t0 } };
}

/* ── ҮНЭЛГЭЭ ───────────────────────────────────────────────────── */
function grade(g, r) {
  const fails = [];
  const okTools = r.tools.filter((t) => t.ok).map((t) => t.tool);
  if (g.expectTools) {
    const hit = g.anyTool ? g.expectTools.some((t) => okTools.includes(t)) : g.expectTools.every((t) => okTools.includes(t));
    if (!hit) fails.push(`хэрэгсэл: хүлээсэн ${g.expectTools.join('/')}, ажилласан ${okTools.join(',') || '-'}`);
  }
  const failed = r.tools.filter((t) => !t.ok);
  if (failed.length) fails.push(`унасан хэрэгсэл: ${failed.map((t) => `${t.tool}(${t.status} ${t.error})`).join(', ')}`);
  for (const f of g.forbid ?? []) if (r.answer.toLowerCase().includes(f.toLowerCase())) fails.push(`хориотой мөр: «${f}»`);
  for (const m of g.mustMention ?? []) if (!r.answer.includes(m)) fails.push(`дурдаагүй: «${m}»`);
  if (g.mustMentionAny && !g.mustMentionAny.some((m) => r.answer.toLowerCase().includes(m.toLowerCase()))) fails.push(`аль нь ч дурдагдаагүй: ${g.mustMentionAny.join(' | ')}`);
  if (g.numberFrom && runtimeOk) {
    const allowed = new Set();
    for (const t of r.tools) for (const n of pick(t.data, g.numberFrom)) allowed.add(n);
    const said = numbersIn(r.answer).filter((n) => n >= 2);
    if (!said.some((n) => allowed.has(n))) fails.push(`тоо: хариултад ${said.join(',') || '-'}, хэрэгслийн тоолол ${[...allowed].join(',')}`);
  }
  if (g.firstDeadlineMentioned && runtimeOk) {
    const dl = r.tools.find((t) => t.tool === 'get_upcoming_deadlines' && t.ok);
    const name = dl?.data?.projects?.[0]?.name;
    if (name && !r.answer.includes(name)) fails.push(`эхний deadline-ийн төсөл «${name}» дурдагдаагүй`);
  }
  if (g.topRankMentioned && runtimeOk) {
    const act = r.tools.find((t) => t.tool === 'get_employee_activity' && t.ok);
    const top = act?.data?.ranking?.[0]?.name;
    if (top && !r.answer.includes(top.split(' ')[0])) fails.push(`эрэмбийн 1-р ажилтан «${top}» дурдагдаагүй`);
  }
  if (g.catalogLabels && runtimeOk) {
    const sys = r.tools.find((t) => t.tool === 'describe_system' && t.ok);
    const labels = new Set();
    for (const p of sys?.data?.pages ?? []) { labels.add(p.title_mn); for (const s of p.sections ?? []) labels.add(s); }
    const hit = [...labels].filter((l) => l.length >= 4 && r.answer.toLowerCase().includes(l.toLowerCase()));
    if (hit.length < g.catalogLabels) fails.push(`каталогийн нэр ${hit.length} < ${g.catalogLabels} (${hit.join(', ') || '-'})`);
  }
  if (g.normDecision) {
    const cat = r.ctx.norm_decision?.decision?.initial_category;
    if (cat !== g.normDecision) fails.push(`нормын шийдвэр: ${cat ?? 'алга'} ≠ ${g.normDecision}`);
  }
  if (g.contract && r.ctx.answer_contract?.kind !== g.contract) fails.push(`гэрээ: ${r.ctx.answer_contract?.kind} ≠ ${g.contract}`);
  if (g.minEvidence && (r.ctx.evidence?.length ?? 0) < g.minEvidence) fails.push(`нотолгоо ${r.ctx.evidence?.length ?? 0} < ${g.minEvidence}`);
  if (runtimeOk && r.stop && r.stop !== 'stop') fails.push(`зогсох шалтгаан: ${r.stop}`);
  // Хэрэгслийн хайрцагт байхгүй ТОО хариултад орсон эсэх (зохиомол тооны илрүүлэлт).
  if (runtimeOk && r.tools.length > 0 && !g.normDecision) {
    const inData = new Set();
    for (const t of r.tools) numbersInData(t.data, inData);
    for (const n of numbersIn(r.ctx.turns?.map((t) => t.content).join(' ') ?? '')) inData.add(n);
    const invented = numbersIn(r.answer).filter((n) => n >= 10 && !inData.has(n) && !inData.has(Math.round(n)));
    if (invented.length) fails.push(`эх сурвалжгүй тоо: ${invented.slice(0, 5).join(', ')}`);
  }
  // Identity гоожилт — өөрийнх нь тухай асуугаагүй байхад нэр/албан тушаал.
  if (!/би |миний|minii|who am i/i.test(g.q) && /Та .* (инженер|архитектор|багийн)/u.test(r.answer)) fails.push('identity гоожилт');
  return fails;
}

/* ── ГҮЙЛТ ─────────────────────────────────────────────────────── */
const session = { convState: null, history: [], seq: 0 };
const cases = argQs.length ? argQs.map((q, i) => ({ id: `Q${i + 1}`, q })) : GOLDEN;
const report = [];
for (const g of cases) {
  let r;
  try {
    r = await runTurn(g.q, session);
  } catch (err) {
    report.push({ id: g.id, q: g.q, error: String(err) });
    if (!JSON_OUT) console.log(`\n✗ ${g.id} ${g.q}\n   АЛДАА: ${err}`);
    continue;
  }
  const fails = argQs.length ? [] : grade(g, r);
  report.push({ id: g.id, q: g.q, pass: fails.length === 0, fails, rounds: r.rounds, tools: r.tools.map((t) => ({ tool: t.tool, ok: t.ok, ms: t.ms })), depth: r.plan.depth, timing: r.timing, answer: r.answer, contract: r.ctx.answer_contract?.kind });
  if (!JSON_OUT) {
    console.log(`\n${fails.length === 0 ? '✓' : '✗'} ${g.id} ${g.q}`);
    console.log(`   шат: ${r.rounds.map((x) => `r${x.round}[${x.tools.join('+') || '-'}] ${x.reason}`).join(' → ')} · гүн: ${r.plan.depth}`);
    console.log(`   хугацаа: хэрэгсэл ${r.timing.tools_ms}мс · context ${r.timing.context_ms}мс · үүсгэлт ${r.timing.generation_ms}мс (эхний токен ${r.timing.first_token_ms ?? '-'}мс) · нийт ${r.timing.total_ms}мс`);
    for (const f of fails) console.log(`   ✗ ${f}`);
    console.log(`   ХАРИУЛТ: ${r.answer.replace(/\s+/g, ' ').slice(0, 700)}`);
  }
}

const passed = report.filter((r) => r.pass).length;
if (JSON_OUT) console.log(JSON.stringify({ runtime: runtimeOk, passed, total: report.length, cases: report }, null, 1));
else console.log(`\n${passed}/${report.length} тэнцэв${runtimeOk ? '' : ' (загваргүй — зөвхөн хэрэгсэл/гэрээ шалгав)'}`);
process.exit(argQs.length || passed === report.length ? 0 : 1);
