/**
 * E2E КЛИЕНТ — хөтчийн orchestrator-ийн ЯГ дараалал, скриптээс дуудагдана.
 *
 *   login → /plan (судалгааны шатуудтай) → /tool → локал /norm → /context
 *         → (gen бол) локал /generate → validator.ts-ийн гэрээ
 *           (шалгах → засах → ЯГ НЭГ дахилт → детерминист template)
 *
 * ⚠️ `conversation-e2e.mjs` (алтан A–O) ба `heldout-gen.mjs` (өргөн held-out
 *    багц) ХОЁУЛАА энэ нэг файлыг хэрэглэнэ — ээлжийн логик хоёр газар
 *    хуулбарлагдвал суурь ба нэр дэвшигчийн харьцуулалт ӨӨР замаар явна.
 *
 * ⚠️ ТҮҮХИЙ ба ЭЦСИЙН хариултыг ХОЁУЛАНГ нь буцаана (§32): сайжрал нь
 *    загварынх уу, runtime-ийн хамгаалалтынх уу гэдгийг ялгахын тулд.
 */
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { repetitionMetrics } from './repetition.mjs';
import { styleLint } from './style.mjs';

registerHooks({
  resolve(sp, c, n) {
    if (/^\.{1,2}\//.test(sp) && !/\.[cm]?[jt]sx?$/.test(sp)) return n(sp + '.ts', c);
    return n(sp, c);
  },
});
const V = await import('@mgl/mglai-common/turn/validator');
export const { enforceContract, fallbackAnswer, correctionPrompt, validateAnswer, dedupeSentences } = V;

export const IDENTITY_RE = /Хэрэглэгчийн нэр|албан тушаал|Revit эрх|эрхийн түвшин|READ_ONLY/i;
export const cyr = (s) => ((s ?? '').match(/[А-Яа-яӨөҮүЁё]/g) ?? []).length;
export const lat = (s) => ((s ?? '').match(/[A-Za-z]/g) ?? []).length;
export const mostlyCyrillic = (s) => cyr(s) > 0 && cyr(s) >= lat(s);
export const short = (s, n = 220) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

export function readSecret() {
  try {
    return fs.readFileSync(path.join(process.env.LOCALAPPDATA ?? '', 'MglAi', 'secret.txt'), 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * @param {{api:string, rt:string, gen:boolean, secret?:string, maxTokens?:number}} opts
 */
export function createClient(opts) {
  const API = opts.api;
  const RT = opts.rt;
  const GEN = opts.gen;
  const SECRET = opts.secret ?? readSecret();
  const MAX_TOKENS = opts.maxTokens ?? 600;
  let token = '';

  async function api(p, body) {
    const r = await fetch(`${API}${p}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  }

  // ⚠️ `response_language` нь /context-ийн шийдвэр — хатуу 'mn-Cyrl' бичвэл
  //    англи хүсэлт, хадгалсан хэлний санамж хоёулаа runtime дээр дарагдана.
  async function generate(turns, maxTokens = MAX_TOKENS, responseLanguage = 'mn-Cyrl') {
    const t0 = Date.now();
    const r = await fetch(`${RT}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MglAi-Secret': SECRET },
      body: JSON.stringify({ turns, max_tokens: maxTokens, response_language: responseLanguage }),
    });
    if (!r.ok) throw new Error(`generate ${r.status} ${await r.text()}`);
    const text = await r.text();
    let out = '';
    let stop = null;
    let evName = '';
    let firstTokenMs = null;
    let tokens = null;
    for (const line of text.split('\n')) {
      if (line.startsWith('event:')) {
        evName = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (evName === 'token') out += ev.text ?? '';
        if (evName === 'done') {
          stop = ev.stop_reason ?? null;
          firstTokenMs = ev.first_token_ms ?? null;
          tokens = ev.tokens ?? ev.completion_tokens ?? null;
        }
      } catch {}
    }
    return { text: out, stop, firstTokenMs, totalMs: Date.now() - t0, tokens };
  }

  async function login(user, pass) {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    });
    const j = await r.json();
    token = j.token;
    if (!token) throw new Error('login failed ' + JSON.stringify(j));
    const sess = await api('/mgl-ai/session');
    if (GEN) await fetch(`${RT}/warmup`, { method: 'POST', headers: { 'X-MglAi-Secret': SECRET } }).catch(() => {});
    return sess;
  }

  /** Суурийн таних тэмдэг — систем хувилбар + runtime/загвар (§9). */
  async function identity(label) {
    const health = await api('/mgl-ai/health');
    let rtInfo = null;
    try {
      const r = await fetch(`${RT}/info`, { headers: { 'X-MglAi-Secret': SECRET } });
      if (r.ok) {
        const j = await r.json();
        rtInfo = { runtime_version: j.runtime_version, engine: j.engine?.engine, artifact: j.engine?.artifact, quantization: j.engine?.quantization, model_version: j.engine?.modelVersion, adapter_version: j.engine?.adapterVersion ?? null, context_tokens: j.engine?.contextTokens };
      }
    } catch {}
    return { label, system_prompt_version: health.system_prompt_version, tool_schema_version: health.tool_schema_version, retrieval_version: health.retrieval_version, product_version: health.version, runtime: rtInfo };
  }

  /** Нэг ээлж бүхэлдээ — хөтчийн orchestrator-ийн ижил дараалал. */
  async function turn(conv, question, history, state, seq, extra = {}) {
    const t0 = Date.now();
    let plan = await api('/mgl-ai/plan', {
      question,
      conv_state: state,
      seq,
      last_assistant: [...history].reverse().find((h) => h.role === 'assistant')?.content ?? null,
    });
    const planMs = Date.now() - t0;
    const tools = [];
    const runTools = async (p) => {
      for (const t of p.tools) {
        try {
          const r = await api('/mgl-ai/tool', { conv_uid: conv, name: t.name, args: t.args });
          tools.push({ tool: t.name, ok: r.ok, data: r.data, args: t.args });
        } catch (e) {
          tools.push({ tool: t.name, ok: false, data: null, args: t.args, error: String(e.message).slice(0, 200) });
        }
      }
    };
    await runTools(plan);
    let step = plan;
    for (let round = 1; round < Math.min(plan.max_rounds ?? 3, 3) && step.done === false; round++) {
      step = await api('/mgl-ai/plan', {
        question, conv_state: state, seq, round,
        prior_results: tools.map((t) => ({ tool: t.tool, ok: t.ok, data: t.data, args: t.args ?? {} })),
      });
      if (step.tools.length === 0) break;
      await runTools(step);
    }
    if (extra.syntheticTools) tools.push(...extra.syntheticTools);
    // Синтетик үр дүн ӨМНӨХ бодит үр дүнг ОРЛОНО (ижил хэрэгсэл) — «хэрэгсэл 0 гэж хэлж байна» гэсэн туршилтад.
    if (extra.replaceTools) {
      for (const rt of extra.replaceTools) {
        const i = tools.findIndex((t) => t.tool === rt.tool);
        if (i >= 0) tools[i] = rt;
        else tools.push(rt);
      }
    }

    // Локал нормын хайлт — хөтчийн `runNorm`-ын ижил гэрээ: `norm_retrieval` нь «оролдсон
    // эсэх + шалтгаан» (олдсонгүй ≠ хайлт унасан, P0-14).  `extra.normOverride` нь
    // хайлтыг ЗОРИУД унагаах/солих (retrieval_failed, drift зэрэг регрессийн тест).
    let norm = null;
    let normRetrieval = { attempted: false, reason: 'not_asked' };
    if (extra.normOverride !== undefined) {
      norm = extra.normOverride.answer ?? null;
      normRetrieval = { attempted: extra.normOverride.attempted ?? true, reason: extra.normOverride.reason ?? (norm ? 'ok' : 'error') };
    } else if (plan.ask_local_norm && SECRET) {
      try {
        const r = await fetch(`${RT}/norm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-MglAi-Secret': SECRET },
          body: JSON.stringify({ query: plan.norm_query ?? question, audience: 'employee', evidence_limit: 5 }),
        });
        norm = r.ok ? await r.json() : null;
        normRetrieval = { attempted: true, reason: r.ok ? 'ok' : 'error' };
      } catch {
        normRetrieval = { attempted: true, reason: 'runtime_down' };
      }
    }
    const ctx = await api('/mgl-ai/context', {
      conv_uid: conv, question, history, conv_state: state, seq,
      tool_results: tools.map((t) => ({ tool: t.tool, ok: t.ok, data: t.data, error: t.error ?? null })),
      norm_answer: norm,
      norm_retrieval: normRetrieval,
      local_memory: extra.localMemory ?? undefined,
    });
    const contract = ctx.trusted_contract ?? null;
    const lang = ctx.response_language;

    const rec = {
      question, turn: plan.turn?.kind, intent: plan.intent, tools: tools.map((t) => `${t.tool}${t.ok ? '' : '✗'}`),
      norm: norm ? { status: norm.status, cite: norm.citation?.label_mn ?? null } : null,
      contract: contract ? { mode: contract.answerMode, risk: contract.risk, facts: contract.facts.map((f) => `${f.id}=${f.value}`), noMatch: contract.noMatch, requiredCitations: contract.requiredCitations ?? null, requiredSentence: contract.requiredSentence ?? null, trailerText: contract.trailerText ?? null } : null,
      lang,
      // Серверийн шийдсэн ГҮН (sys-6, `depth.ts`) — гүн бүрийн уртыг тайлагнахад (§30).
      depth: ctx.answer_depth?.depth ?? plan.answer_depth?.depth ?? null,
      depthReason: ctx.answer_depth?.reason ?? null,
      planMs, contextMs: ctx.stage_timings?.total_ms ?? null,
      raw: null, final: null, source: 'model', attempts: 0, violations: [], repetition: null,
      firstTokenMs: null, genMs: null, tokens: null,
    };
    let answer = null;
    if (GEN) {
      const g = await generate(ctx.turns, MAX_TOKENS, lang);
      rec.raw = g.text;
      rec.firstTokenMs = g.firstTokenMs;
      rec.genMs = g.totalMs;
      rec.tokens = g.tokens;
      rec.stop = g.stop;
      rec.attempts = 1;
      const dd = dedupeSentences(g.text);
      rec.dedupRemoved = dd.removed;
      let final = dd.text;
      // ТҮҮХИЙ гэрээний нийцэл — ЗАСВАРААС ӨМНӨ (§32-ийн «raw» тоо).
      rec.rawValid = contract && contract.answerMode !== 'free' ? validateAnswer(g.text, contract).ok : true;
      if (contract && contract.answerMode !== 'free') {
        const o = enforceContract(dd.text, contract, lang);
        rec.violations.push(o.before.violations.map((v) => v.code));
        if (o.validation.ok) {
          final = o.answer;
          rec.source = o.outcome;
        } else {
          rec.attempts = 2;
          const g2 = await generate([...ctx.turns, { role: 'assistant', content: dd.text }, { role: 'user', content: correctionPrompt(contract, o.before, lang) }], 500, lang);
          rec.genMs += g2.totalMs;
          const o2 = enforceContract(g2.text, contract, lang);
          rec.violations.push(o2.before.violations.map((v) => v.code));
          if (o2.validation.ok && g2.text.trim()) {
            final = o2.answer;
            rec.source = o2.outcome === 'model' ? 'regenerated' : 'repaired';
          } else {
            final = fallbackAnswer(contract, lang);
            rec.source = 'template';
          }
        }
      }
      answer = final;
      rec.final = final;
      rec.repetition = { raw: repetitionMetrics(g.text), final: repetitionMetrics(final) };
      rec.style = { raw: styleLint(g.text, lang), final: styleLint(final, lang) };
      rec.finalValid = contract ? validateAnswer(final, contract).ok : true;
    } else if (extra.answerFromTemplate && contract?.template) {
      // Загваргүй (--no-gen) горимд хөтчийн `renderRetrievalOnly`-ийн ижил: серверийн детерминист текст.
      answer = fallbackAnswer(contract, lang);
      rec.final = answer;
      rec.source = 'template';
    }
    // ⚠️ /messages — хөтчийн 6-р алхам (Amendment B): гарын үсэгтэй TrustedNormResult-ийг
    //    ХӨНДӨЛГҮЙ буцаана; эшлэл, итгэл СЕРВЕР дээр тэр объектоос гарна.
    let saved = null;
    if (extra.persist && answer && conv) {
      try {
        saved = await api('/mgl-ai/messages', {
          conv_uid: conv, msg_uid: `e2e-${seq}-${Date.now()}`, role: 'assistant', content: answer, seq: seq + 1,
          evidence: ctx.evidence, regulatory: ctx.regulatory, verification_states: ctx.verification_states,
          tools_ok: tools.every((t) => t.ok), tool_count: tools.filter((t) => t.ok).length,
          question, show_confidence: ctx.show_confidence,
          trusted_norm_result: extra.tamperResult ? extra.tamperResult(ctx.trusted_norm_result) : (ctx.trusted_norm_result ?? null),
          trusted_norm_sig: ctx.trusted_norm_sig ?? null,
          trusted_norm_seq: seq,
        });
      } catch (e) {
        saved = { error: String(e.message).slice(0, 200) };
      }
    }
    return { plan, tools, ctx, answer, contract, rec, saved, normRetrieval, prompt: ctx.turns.map((t) => t.content).join('\n') };
  }

  return { api, generate, login, identity, turn, GEN, RT, API };
}
