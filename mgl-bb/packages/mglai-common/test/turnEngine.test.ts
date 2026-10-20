/**
 * ХУВААЛЦСАН ЭЭЛЖИЙН ХӨДӨЛГҮҮР — Revit-гүй, серверьгүй, загваргүй тест (Session R, Phase 5).
 *
 * Тээвэр ХОЁУЛАА хуурамч: backend нь `/mgl-ai/*` замуудыг бүртгэж хариулна,
 * runtime нь токен цацна.  Шалгах зүйл:
 *   1. plan → context → generate → messages дараалал; `revit_context` + `surface`
 *      серверт ЯГ ДАМЖИНА (Revit-ийн зам хөтчийнхтэй ижил).
 *   2. Runtime байхгүй → retrieval-only, `/generate` ОГТ дуудагдахгүй.
 *   3. DOM/localStorage ЭНД БАЙХГҮЙ (grep) — «нэг зам» гэдгийн техник нөхцөл.
 *
 * Ажиллуулах:  cd packages/mglai-common && node --test test/turnEngine.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTurn, type TurnInput } from '../src/turn/engine.ts';
import type { BackendTransport, RuntimeTransport, TurnDeps } from '../src/turn/transports.ts';
import type { AiContextResponse } from '../src/turn/types.ts';

function fakeDeps(opts: { tokens?: string[]; runtimeOnline?: boolean; system?: string } = {}) {
  const calls: { path: string; data: unknown }[] = [];
  let generateCalls = 0;
  const backend: BackendTransport = {
    async fetch<T>(path: string, o: { data?: unknown }): Promise<T> {
      calls.push({ path, data: o.data });
      switch (path) {
        case '/mgl-ai/conversations':
        case '/mgl-ai/messages':
          return { ok: true, citations: [], confidence: null } as unknown as T;
        case '/mgl-ai/plan':
          return {
            intent: 'general',
            regulatory: false,
            detected_language: 'mn-Cyrl',
            tools: [],
            done: true,
            memory_hints: [],
          } as unknown as T;
        case '/mgl-ai/context': {
          const ctx: Partial<AiContextResponse> = {
            conv_uid: 'c1',
            turns: [
              { role: 'system', content: opts.system ?? 'sys' },
              { role: 'user', content: String((o.data as { question?: string }).question ?? '') },
            ],
            tools: [],
            evidence: [],
            regulatory: false,
            response_language: 'mn-Cyrl',
            detected_language: 'mn-Cyrl',
            language_explicit: false,
            intent: 'general',
            intent_reason: 'test',
            evidence_required: false,
            show_confidence: false,
            verification_states: [],
            filtered_out: { count: 0 },
          };
          return ctx as unknown as T;
        }
        default:
          throw new Error('unexpected path ' + path);
      }
    },
  };
  const runtime: RuntimeTransport = {
    async askNorm() {
      return { kind: 'unavailable', reason: 'not_installed' } as never;
    },
    async streamGenerate(_turns, cb) {
      generateCalls++;
      cb.onStart?.('fake');
      for (const t of opts.tokens ?? ['Хана', ' 200 мм.']) cb.onToken(t);
      cb.onDone({
        stop_reason: 'stop',
        repetition: null,
        first_token_ms: 5,
        total_ms: 20,
        engine: 'fake',
        runtime_variant: 'test',
        usage: { promptTokens: 10, completionTokens: 4 },
      });
    },
  };
  const deps: TurnDeps = { backend, runtime };
  return { deps, calls, generateCalls: () => generateCalls };
}

function input(over: Partial<TurnInput> = {}): TurnInput {
  return {
    question: 'Энэ хана хэдэн мм вэ?',
    convUid: 'c1',
    userMsgUid: 'u1',
    aiMsgUid: 'a1',
    seq: 1,
    history: [],
    convState: null as never,
    runtime: { installed: true, authorized: true, info: {} as never },
    mode: 'employee',
    signal: new AbortController().signal,
    emit: () => undefined,
    ...over,
  } as TurnInput;
}

test('turn: revit surface + revit_context flow through plan → context → generate → messages', async () => {
  const f = fakeDeps();
  const events: string[] = [];
  const revit = { docTitle: 'MGL-AI-TEST', selection: [{ id: '2786', category: 'Walls' }] };
  const r = await runTurn(input({ surface: 'revit', revitContext: revit, emit: (e) => events.push(e.type) }), f.deps);
  assert.equal(r.answer, 'Хана 200 мм.');
  assert.equal(r.error, null);
  assert.equal(f.generateCalls(), 1);
  const paths = f.calls.map((c) => c.path);
  assert.deepEqual(paths.filter((p) => p !== '/mgl-ai/messages' && p !== '/mgl-ai/conversations'), ['/mgl-ai/plan', '/mgl-ai/context']);
  const conv = f.calls.find((c) => c.path === '/mgl-ai/conversations')!.data as { surface: string };
  assert.equal(conv.surface, 'revit');
  const ctx = f.calls.find((c) => c.path === '/mgl-ai/context')!.data as { revit_context: unknown };
  assert.deepEqual(ctx.revit_context, revit);
  assert.ok(events.includes('request.accepted'));
  assert.ok(events.some((t) => t.startsWith('generation') || t === 'token' || t === 'stage.completed' || t === 'answer.reset' || t.length > 0));
});

test('turn: browser surface defaults to web and sends no revit_context', async () => {
  const f = fakeDeps();
  await runTurn(input(), f.deps);
  const conv = f.calls.find((c) => c.path === '/mgl-ai/conversations')!.data as { surface: string };
  assert.equal(conv.surface, 'web');
  const ctx = f.calls.find((c) => c.path === '/mgl-ai/context')!.data as Record<string, unknown>;
  assert.equal(ctx.revit_context, undefined);
});

test('turn: runtime offline → retrieval-only answer, /generate never called', async () => {
  const f = fakeDeps();
  const r = await runTurn(input({ runtime: { installed: false, reason: 'not_running' } as never }), f.deps);
  assert.equal(f.generateCalls(), 0);
  assert.equal(r.engine, 'retrieval-only');
  assert.ok(r.error && r.error.code === 'LOCAL_RUNTIME_OFFLINE', JSON.stringify(r.error));
});

test('turn engine sources contain no DOM / storage / Node-only API (runtime-agnostic)', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'turn');
  const forbidden = /\b(localStorage|sessionStorage|document\.|window\.|navigator\.|XMLHttpRequest|process\.env|require\()/;
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    assert.ok(!forbidden.test(src), `${f} DOM/Node API агуулж байна`);
  }
});
