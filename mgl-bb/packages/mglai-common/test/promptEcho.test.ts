/**
 * MGL AI · SYSTEM PROMPT-ЫН ЦУУРАЙ — ТЕСТ (2026-09-28, эзний бодит чат).
 *   node --test test/promptEcho.test.ts
 *
 * «chinii Mongol helnii nairullaga muu ym» → адаптер 0.4 хэлний тушаалаа үгчлэн буцаасан.  Хамгаалалт нь хуваалцсан
 * engine-д (хөтөч · runtime /turn · Revit) — нэг хэрэгжүүлэлт.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripPromptEcho, echoFallbackText } from '../src/turn/validator.ts';
import { runTurn, type TurnInput } from '../src/turn/engine.ts';
import type { BackendTransport, RuntimeTransport, TurnDeps } from '../src/turn/transports.ts';
import type { AiContextResponse } from '../src/turn/types.ts';

const SYSTEM =
  'Чи бол MGL E&C компанийн туслах. ХЭЛ: Эцсийн хариултаа ЗААВАЛ МОНГОЛ КИРИЛЛЭЭР бич. Хэрэглэгч латин үсгээр монгол бичсэн ч кириллээр хариул. ' +
  'Англиар бодож байгаад орчуулж БОЛОХГҮЙ — шууд монголоор зохио. Revit, view, family зэрэг нэр томьёог англиар нь үлдээж болно. ' +
  'Энэ шаардлагыг баталгаатай хэлэх эх сурвалж олдсонгүй гэж хэлэх ёстой үед энэ өгүүлбэрийг ашигла.';

test('echo: эзний чатын хариулт — хоёр өгүүлбэр хасагдаж, хариулт бүхэлдээ цуурай гэж үзэгдэнэ', () => {
  const answer =
    'Үгүй — зөвхөн монгол кириллээр хариулахад тусална. Хэрэглэгч латин үсгээр монгол бичсэн ч кириллээр хариулна. Англиар бодож байгаад орчуулж бОЛОХГҮЙ — шууд монголоор зохио.';
  const r = stripPromptEcho(answer, SYSTEM);
  assert.equal(r.removed, 2);
  assert.equal(r.kept, 1);
  assert.equal(r.dominated, true);
  assert.ok(!r.text.includes('латин үсгээр'));
});

test('echo: ердийн хариулт ХӨНДӨГДӨХГҮЙ (давхцал < 6 үг)', () => {
  const answer = 'Төсөл Альфа 72% гүйцэтгэлтэй. Хамгийн ойр хугацаа 2026-10-20. Монгол хэлээр товч хариулъя.';
  const r = stripPromptEcho(answer, SYSTEM);
  assert.equal(r.removed, 0);
  assert.equal(r.text, answer);
});

test('echo: гэрээний канон өгүүлбэр system prompt-д байсан ч ХАСАГДАХГҮЙ (keep)', () => {
  const canon = 'Энэ шаардлагыг баталгаатай хэлэх эх сурвалж олдсонгүй.';
  const r = stripPromptEcho(`${canon} MCIS-ээс шалгана уу.`, SYSTEM, [canon]);
  assert.equal(r.removed, 0);
});

test('echo: хэсэгчилсэн цуурай — зөвхөн тэр өгүүлбэр хасагдана, бусад нь үлдэнэ', () => {
  const answer = 'Хананы талбай 45 м². Хэрэглэгч латин үсгээр монгол бичсэн ч кириллээр хариулна. Өөр асуулт байвал бичээрэй. Сонгосон хана 3 ширхэг.';
  const r = stripPromptEcho(answer, SYSTEM);
  assert.equal(r.removed, 1);
  assert.equal(r.dominated, false);
  assert.equal(r.text, 'Хананы талбай 45 м². Өөр асуулт байвал бичээрэй. Сонгосон хана 3 ширхэг.');
});

function deps(tokens: string[]): TurnDeps {
  const backend: BackendTransport = {
    async fetch<T>(path: string, o: { data?: unknown }): Promise<T> {
      if (path === '/mgl-ai/conversations' || path === '/mgl-ai/messages') return { ok: true, citations: [], confidence: null } as unknown as T;
      if (path === '/mgl-ai/plan') return { intent: 'general', regulatory: false, detected_language: 'mn-Latn', tools: [], done: true, memory_hints: [] } as unknown as T;
      if (path === '/mgl-ai/context') {
        const ctx: Partial<AiContextResponse> = {
          conv_uid: 'c1',
          turns: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: String((o.data as { question?: string }).question ?? '') },
          ],
          tools: [], evidence: [], regulatory: false, response_language: 'mn-Cyrl', detected_language: 'mn-Latn', language_explicit: false,
          intent: 'general', intent_reason: 'test', evidence_required: false, show_confidence: false, verification_states: [], filtered_out: { count: 0 },
        };
        return ctx as unknown as T;
      }
      throw new Error('unexpected ' + path);
    },
  };
  const runtime: RuntimeTransport = {
    async askNorm() { return { kind: 'unavailable', reason: 'not_installed' } as never; },
    async streamGenerate(_t, cb) {
      cb.onStart?.('fake');
      for (const t of tokens) cb.onToken(t);
      cb.onDone({ stop_reason: 'stop', repetition: null, first_token_ms: 5, total_ms: 20, engine: 'fake' } as never);
    },
  } as RuntimeTransport;
  return { backend, runtime };
}

test('echo: engine — цуурай давамгайлсан хариулт шударга «гаргаж чадсангүй» болж, дотоод заавар харагдахгүй', async () => {
  const warnings: string[] = [];
  const r = await runTurn(
    {
      question: 'chinii Mongol helnii nairullaga muu ym',
      convUid: 'c1', userMsgUid: 'u1', aiMsgUid: 'a1', seq: 1, history: [], convState: null as never,
      runtime: { installed: true, authorized: true, info: {} as never }, mode: 'employee', signal: new AbortController().signal,
      emit: (e) => { if (e.type === 'warning' && e.safeUserMessage) warnings.push(e.safeUserMessage); },
    } as TurnInput,
    deps(['Үгүй — зөвхөн монгол кириллээр хариулахад тусална. ', 'Хэрэглэгч латин үсгээр монгол бичсэн ч кириллээр хариулна. ', 'Англиар бодож байгаад орчуулж бОЛОХГҮЙ — шууд монголоор зохио.']),
  );
  assert.equal(r.answer, echoFallbackText('mn-Cyrl'));
  assert.ok(warnings.some((w) => w.includes('Дотоод зааврыг давтсан')));
});

test('echo: system prompt-ын ӨГӨГДЛИЙН мөрийг (Revit контекст, идэвхтэй сэдэв) иш татах нь ЗӨВ — хасагдахгүй', () => {
  const sys =
    `${SYSTEM}\n\nИДЭВХТЭЙ СЭДЭВ: төсөл «Төв цэнгэлдэх хүрээлэнгийн засварын ажил» (id 12). «энэ», «тэр», «яагаад» нь энэ төслийг заана.\n\n` +
    'Одоогийн Revit контекст: Баримт: Төсөл Альфа.rvt; View: Level 1; Сонгосон: Wall (Basic Wall 200), Area=45 m², Length=15 m';
  const answer = 'Төв цэнгэлдэх хүрээлэнгийн засварын ажил төслийн явц 40%. Сонгосон Wall Basic Wall 200 хананы Area 45 m² байна.';
  const r = stripPromptEcho(answer, sys);
  assert.equal(r.removed, 0);
});
