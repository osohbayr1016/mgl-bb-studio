/**
 * MGL AI · ХУУРАМЧ СҮЛЖЭЭ — orchestrator-ыг fetch-гүйгээр ажиллуулна (Session C).
 *
 * `globalThis.fetch`-ийг URL-аар чиглүүлнэ: `/api/mgl-ai/*` → backend хуурамч,
 * `127.0.0.1:39217/*` → runtime хуурамч (SSE ReadableStream).  Хувилбар бүр
 * `generate` функцээрээ SSE фреймүүд / гэмтлийг тодорхойлно.
 */
import { installBrowserStubs, loadFrontend } from './load.mjs';

const enc = new TextEncoder();

export function sse(event, data) {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Фреймүүдийн жагсаалтыг ReadableStream болгоно; `fail` бол сүүлд урсгал эвдэрнэ. */
export function stream(frames, { failAfter = null, delayMs = 0 } = {}) {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      if (failAfter !== null && i >= failAfter) {
        controller.error(new TypeError('network error: connection reset'));
        return;
      }
      if (i >= frames.length) {
        controller.close();
        return;
      }
      controller.enqueue(frames[i++]);
    },
  });
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const DEFAULT_PLAN = {
  intent: 'GENERAL_HELP',
  intent_reason: 'тест',
  turn: { kind: 'NEW_TOPIC', reason: 'тест', subject: null, history_messages: 0, tasks: [{ text: 'x', intent: 'GENERAL_HELP', domain: 'general' }] },
  response_language: 'mn-Cyrl',
  detected_language: 'mn-Cyrl',
  regulatory: false,
  evidence_required: false,
  needs_retrieval: false,
  show_confidence: false,
  ask_local_norm: false,
  tools: [],
  round: 0,
  done: true,
  plan_ms: 3,
  memory_hints: [],
};

export function contextResponse(over = {}) {
  return {
    conv_uid: 'conv_test',
    turns: [
      { role: 'system', content: 'MGL AI · test' },
      { role: 'user', content: 'Асуулт: x' },
    ],
    tools: [],
    evidence: [],
    regulatory: false,
    norm_decision: null,
    answer_contract: null,
    trusted_contract: {
      version: 'tfc-1', answerMode: 'free', risk: 'low', facts: [], allowedNumbers: null, allowedCategories: null,
      requiredSentence: null, trailerText: null, requiredCitations: [], noMatch: false, forbiddenPhrases: [], template: null,
      taskIndex: null, legacyKind: 'free', reason: 'test',
    },
    local_norm: null,
    stage_timings: { retrieval_ms: 1, norm_decision_ms: 0, total_ms: 2 },
    response_language: 'mn-Cyrl',
    detected_language: 'mn-Cyrl',
    language_explicit: false,
    intent: 'GENERAL_HELP',
    intent_reason: 'тест',
    turn: DEFAULT_PLAN.turn,
    conv_state_next: null,
    evidence_required: false,
    show_confidence: false,
    verification_states: [],
    tool_results_used: [],
    model: { family: 'qwen3', version: 'test', runtime_variant: 'employee-4b-q4', system_prompt_version: 'test', tool_schema_version: 'test', context_tokens: 8192 },
    ...over,
  };
}

/**
 * @param {object} routes  { plan?, context?, tool?, messages?, generate: (body, req) => Response|Promise<Response>, norm? }
 * @returns {{ calls: Array<{url:string, body:any}>, restore: () => void }}
 */
export function installFakeWire(routes) {
  installBrowserStubs();
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    let body = null;
    if (init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url: u, body });
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const r = (fn, fallback) => (fn ? fn(body, { url: u, init }) : fallback);
    if (u.includes('/mgl-ai/conversations')) return r(routes.conversations, jsonResponse({ conv_uid: body?.conv_uid ?? 'conv_test' }));
    if (u.includes('/mgl-ai/messages')) return r(routes.messages, jsonResponse({ msg_uid: body?.msg_uid ?? 'm', citations: [], dropped_citations: [], confidence: null }));
    if (u.includes('/mgl-ai/plan')) return r(routes.plan, jsonResponse(DEFAULT_PLAN));
    if (u.includes('/mgl-ai/tool')) return r(routes.tool, jsonResponse({ ok: true, tool: body?.name, data: {} }));
    if (u.includes('/mgl-ai/context')) return r(routes.context, jsonResponse(contextResponse()));
    if (u.includes('127.0.0.1:39217/generate')) return r(routes.generate, new Response(stream([sse('done', { stop_reason: 'stop' })]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    if (u.includes('127.0.0.1:39217/norm')) return r(routes.norm, jsonResponse({ status: 'insufficient_evidence', evidence: [] }, 503));
    throw new TypeError(`fakeWire: танихгүй URL ${u}`);
  };
  return { calls, restore: () => void (globalThis.fetch = original) };
}

export function sseResponse(frames, opts) {
  return new Response(stream(frames, opts), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** runTurn-ыг стандарт оролттой ажиллуулна. */
export async function runFakeTurn(overrides = {}) {
  // Хөтчийн ЖИНХЭНЭ зам (Session R, R3): adapter → @mgl/mglai-common/turn.
  const { runTurn } = await loadFrontend('browserTurn.ts');
  const events = [];
  const ctrl = new AbortController();
  const input = {
    question: 'Тест асуулт',
    convUid: 'conv_test',
    userMsgUid: 'u1',
    aiMsgUid: 'a1',
    seq: 0,
    history: [],
    convState: null,
    memories: [],
    runtime: { installed: true, authorized: true, info: { engine: 'llama.cpp' } },
    mode: 'employee',
    signal: ctrl.signal,
    emit: (e) => events.push(e),
    ...overrides,
  };
  const result = await runTurn(input);
  return { result, events, ctrl };
}
