/**
 * NORM-INTEL v3 — ХУВААЛЦСАН ХӨДӨЛГҮҮР ДЭЭР: загвар худлаа тоо/заалт/давталт гаргавал ХЭРЭГЛЭГЧ ЮУ Ч ХАРАХГҮЙ.
 * Тээвэр хуурамч; серверийн гэрээг тест өөрөө бичнэ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, type TurnInput } from '../src/turn/engine.ts';
import type { BackendTransport, RuntimeTransport, TurnDeps } from '../src/turn/transports.ts';
import type { TrustedContract } from '../src/turn/validator.ts';
import { NORM_INTEL_VERSION, renderSourceBlock, type NormIntelBlock, type NormSource } from '../src/normIntel.ts';

function deps(contract: TrustedContract | null, tokens: string[]) {
  const posted: { path: string; data: Record<string, unknown> }[] = [];
  let generateCalls = 0;
  const backend: BackendTransport = {
    async fetch<T>(path: string, o: { data?: unknown }): Promise<T> {
      posted.push({ path, data: (o.data ?? {}) as Record<string, unknown> });
      if (path === '/mgl-ai/conversations' || path === '/mgl-ai/messages') return { ok: true, citations: [], confidence: null } as unknown as T;
      if (path === '/mgl-ai/plan') return { intent: 'NORMATIVE', regulatory: true, detected_language: 'mn-Cyrl', tools: [], done: true, memory_hints: [] } as unknown as T;
      if (path === '/mgl-ai/context') {
        return {
          conv_uid: 'c1',
          turns: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'q' }],
          tools: [], evidence: [], regulatory: true, response_language: 'mn-Cyrl', detected_language: 'mn-Cyrl', language_explicit: false,
          intent: 'NORMATIVE', intent_reason: 't', evidence_required: true, show_confidence: true, verification_states: [], filtered_out: { count: 0 },
          ...(contract ? { trusted_contract: contract } : {}),
        } as unknown as T;
      }
      throw new Error('unexpected path ' + path);
    },
  };
  const runtime: RuntimeTransport = {
    async askNorm() { return { kind: 'unavailable', reason: 'not_installed' } as never; },
    async streamGenerate(_t, cb) {
      generateCalls++;
      cb.onStart?.('fake');
      for (const t of tokens) cb.onToken(t);
      cb.onDone({ stop_reason: 'stop', repetition: null, first_token_ms: 5, total_ms: 20, engine: 'fake', runtime_variant: 't', usage: { promptTokens: 1, completionTokens: 1 } });
    },
  };
  const d: TurnDeps = { backend, runtime };
  return { d, posted, calls: () => generateCalls };
}

const input = (): TurnInput => ({
  question: 'Dead-end corridor-д ямар хязгаарлалт байдаг вэ?', convUid: 'c1', userMsgUid: 'u1', aiMsgUid: 'a1', seq: 1, history: [], convState: null as never,
  runtime: { installed: true, authorized: true, info: {} as never }, mode: 'employee', signal: new AbortController().signal, emit: () => undefined,
}) as TurnInput;

const SRC: NormSource = { code: 'БНбД 11-22-33', titleMn: null, clause: '4.3', table: null, appendix: null, page: 12, currentness: 'IN_FORCE_VERIFIED', statusLabelMn: 'Хүчин төгөлдөр (баталгаажсан)', url: null, verification: 'verified' };

function block(over: Partial<NormIntelBlock>): NormIntelBlock {
  return {
    version: NORM_INTEL_VERSION, subtype: 'REQUIREMENT_LOOKUP', topics: ['dead_end'], evidenceState: 'NO_VERIFIED_MATCH', generalOnly: true, evidenceBacked: false,
    applicability: { status: 'MISSING_CONTEXT', considered: [], missing: ['барилгын зориулалт'] }, claims: [], sources: [], sourceBlock: null, userQuoted: [], userNumbers: [],
    terminology: [], forbidCompliance: true, stateSentence: null, mustDiscloseCurrentness: false, ...over,
  };
}

const TEMPLATE = 'Мухар коридор нь галын үед ганц чиглэлд гарах боломжтой коридор. Яг хязгаарыг хүчинтэй нормын бичвэрээс шалгана.';

function contract(over: Partial<TrustedContract>): TrustedContract {
  return {
    version: 'tfc-2', answerMode: 'grounded', risk: 'high', facts: [], allowedNumbers: [], allowedCategories: [], requiredSentence: null, trailerText: null, requiredCitations: [],
    noMatch: true, forbiddenPhrases: [], template: TEMPLATE, taskIndex: null, legacyKind: 'norm_refusal', reason: 't', norm: null, normIntel: block({}), ...over,
  };
}

test('the model invents "10 м", "2.5 м" and a clause before a disclaimer → the user only sees the server answer', async () => {
  const f = deps(contract({}), ['Мухар коридор 10 м-ээс урт байж болохгүй, өргөн нь 2.5 м байх ёстой (заалт 4.3.2). ', 'Нотолгоо хүрэлцэхгүй.']);
  const shown: string[] = [];
  const r = await runTurn({ ...input(), emit: (e) => { if (e.type === 'token') shown.push((e as { text: string }).text); } }, f.d);
  assert.equal(r.answer, TEMPLATE);
  assert.equal(r.contractDiag?.final, 'template');
  assert.ok(!/\d/.test(r.answer));
  // risk = high → the browser buffers: the invented text was never streamed to the screen
  assert.ok(!shown.join('').includes('2.5'));
  assert.equal(r.contractDiag?.buffered, true);
});

test('invented abbreviation expansion (EI = Equivalent Impact) is discarded', async () => {
  const c = contract({ normIntel: block({ terminology: [{ abbr: 'EI', keys: ['бүрэн бүтэн', 'эсэргүүц'], definitionMn: 'x' }] }) });
  const f = deps(c, ['EI гэдэг нь Equivalent Impact гэсэн үг.']);
  const r = await runTurn(input(), f.d);
  assert.equal(r.answer, TEMPLATE);
});

test('a filler-noun loop never reaches the screen: contract fallback; without a contract the answer is dropped with an error', async () => {
  const loop = 'төсөл, ашиглалтын нөхцөл, төрөл, төлөв, төсөл, ашиглалтын нөхцөл, төрөл, төлөв, төсөл, ашиглалтын нөхцөл, төрөл, төлөв, төсөл, ашиглалтын нөхцөл';
  const f1 = deps(contract({}), [loop]);
  const r1 = await runTurn(input(), f1.d);
  assert.equal(r1.answer, TEMPLATE);
  const f2 = deps(null, [loop]);
  const r2 = await runTurn(input(), f2.d);
  assert.equal(r2.answer, '');
  assert.equal(r2.error?.code, 'GENERATION_REPETITION');
});

test('templateOnly norm answers never call the model', async () => {
  const f = deps(contract({ templateOnly: true }), ['should not be used']);
  const r = await runTurn(input(), f.d);
  assert.equal(f.calls(), 0);
  assert.equal(r.answer, TEMPLATE);
  assert.equal(r.error, null, 'a self-explanatory deterministic answer is not also flagged "evidence missing"');
});

test('authoritative answer: honest model text is kept and the server appends the source block; an unverified clause is discarded', async () => {
  const sb = renderSourceBlock([SRC])!;
  const auth = contract({
    answerMode: 'grounded', allowedNumbers: [1.2], noMatch: false, template: 'Өргөн нь 1.2 м-ээс багагүй байх ёстой.', legacyKind: 'norm_trusted',
    normIntel: block({ evidenceState: 'AUTHORITATIVE', generalOnly: false, evidenceBacked: true, applicability: { status: 'APPLIES', considered: [], missing: [] }, sources: [SRC], sourceBlock: sb,
      claims: [{ id: 'c1', type: 'minimum', subject: null, operator: 'gte', value: 1.2, valueMax: null, unit: 'm', authority: 'verified', sourceIndex: 0, applicability: 'APPLIES' }] }),
  });
  const ok = await runTurn(input(), deps(auth, ['Коридорын өргөн 1.2 м-ээс багагүй байх ёстой.']).d);
  assert.ok(ok.answer.startsWith('Коридорын өргөн 1.2 м-ээс багагүй байх ёстой.'));
  assert.ok(ok.answer.includes(sb), 'server-owned source block appended');
  assert.equal(ok.contractDiag?.final, 'model');
  const bad = await runTurn(input(), deps(auth, ['Коридорын өргөн 1.2 м-ээс багагүй байх ёстой, заалт 4.3.9-д заасан.']).d);
  assert.equal(bad.contractDiag?.final, 'template');
  assert.ok(bad.answer.includes('БНбД 11-22-33'));
  assert.ok(!bad.answer.includes('4.3.9'));
});
