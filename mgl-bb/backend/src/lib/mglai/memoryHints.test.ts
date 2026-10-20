/**
 * MGL AI · ЛОКАЛ САНАМЖИЙН ДОХИО — ТЕСТ (§34–36, §90).
 *
 * Run with:  node --test src/lib/mglai/memoryHints.test.ts
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ: (1) зөвхөн ИЛ тохиргооны хүсэлт танигдана,
 *    энгийн асуулт санамж болохгүй; (2) байнгын ба нэг удаагийн ялгаатай;
 *    (3) хөтчөөс ирсэн санамж ариутгагдана — identity, хог, давхардал
 *    prompt-д орохгүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { detectMemoryHints, sanitizeMemory, memoryResponseLanguage } = await import('./memoryHints.ts');
const { buildSystemPrompt } = await import('./promptFrame.ts');

test('энгийн асуулт → санамжийн дохио ХООСОН (санамсаргүй баримт санахгүй)', () => {
  for (const q of [
    'Манай компанид хэдэн ажилтан байна',
    'В2 галын ачаалал хэд вэ',
    'өнөөдөр төсөл A-ийн хурал байна',
    'yagaad udaad bgaan',
    'сайн уу',
  ]) {
    assert.deepEqual(detectMemoryHints(q), [], q);
  }
});

test('«цаашид богино хариулаарай» → answer_length=short, БАЙНГЫН', () => {
  const h = detectMemoryHints('цаашид хариултаа богино бичээрэй');
  assert.equal(h.length, 1);
  assert.equal(h[0]!.type, 'answer_length');
  assert.equal(h[0]!.value, 'short');
  assert.doesNotMatch(h[0]!.reason, /нэг удаагийн/);
});

test('«энэ удаа товч хариул» → танигдана, гэвч НЭГ УДААГИЙН', () => {
  const h = detectMemoryHints('энэ удаа товч хариул');
  assert.equal(h.length, 1);
  assert.match(h[0]!.reason, /нэг удаагийн/);
});

test('латин «tsaashid bogino hariulaarai» → short, байнгын', () => {
  const h = detectMemoryHints('tsaashid bogino hariulaarai');
  assert.equal(h[0]?.value, 'short');
  assert.doesNotMatch(h[0]!.reason, /нэг удаагийн/);
});

test('«үргэлж дэлгэрэнгүй хариулж бай» → long', () => {
  assert.equal(detectMemoryHints('үргэлж дэлгэрэнгүй хариулж бай')[0]?.value, 'long');
});

test('«намайг Бат гэж дууд» → address_as', () => {
  const h = detectMemoryHints('намайг Бат гэж дуудаарай');
  assert.ok(h.some((x) => x.type === 'address_as' && x.value === 'Бат'));
});

test('«always answer in English» → response_language=en', () => {
  assert.equal(detectMemoryHints('from now on always reply in English')[0]?.value, 'en');
});

test('«хариултаа англиар бичдэг болоорой» → response_language=en, БАЙНГЫН (кирилл + латин)', () => {
  for (const q of ['Хариултаа англиар бичдэг болоорой', 'hariultaa angliar bichdeg boloroi', 'hariultaa angliar bichdeg bolooroi', 'Please answer in English from now on']) {
    const h = detectMemoryHints(q);
    assert.equal(h[0]?.type, 'response_language', q);
    assert.equal(h[0]?.value, 'en', q);
    assert.doesNotMatch(h[0]!.reason, /нэг удаагийн/, q);
  }
});

test('«энэ удаа англиар бич» → танигдана, гэвч НЭГ УДААГИЙН', () => {
  const h = detectMemoryHints('энэ удаа англиар бичээд өгөөч');
  assert.equal(h[0]?.value, 'en');
  assert.match(h[0]!.reason, /нэг удаагийн/);
});

test('«монголоор хариулж бай» → mn-Cyrl; «English» гэсэн үг ганцаараа санамж БИШ', () => {
  assert.equal(detectMemoryHints('цаашид монголоор хариулж бай')[0]?.value, 'mn-Cyrl');
  assert.deepEqual(detectMemoryHints('English хэлний сургалт хэзээ вэ'), []);
  assert.deepEqual(detectMemoryHints('хэлээрэй, хэдэн төсөл байна'), [], 'полит имератив ганцаараа тохиргоо биш');
});

test('memoryResponseLanguage · value-ээр, эс бөгөөс текстээр; байхгүй бол null', () => {
  assert.equal(memoryResponseLanguage([{ type: 'response_language', text: 'Reply in English.', value: 'en' }]), 'en');
  assert.equal(memoryResponseLanguage([{ type: 'response_language', text: 'Reply in English.' }]), 'en', 'хуучин хөтөч value илгээдэггүй');
  assert.equal(memoryResponseLanguage([{ type: 'response_language', text: 'Монгол кириллээр хариул.', value: 'mn-Cyrl' }]), 'mn-Cyrl');
  assert.equal(memoryResponseLanguage([{ type: 'answer_length', text: 'богино' }]), null);
  assert.equal(sanitizeMemory([{ type: 'response_language', text: 'Reply in English.', value: 'en' }])[0]?.value, 'en');
  assert.equal(sanitizeMemory([{ type: 'response_language', text: 'x', value: '<script>' }])[0]?.value, undefined, 'хог value хасагдана');
});

test('«хүснэгтээр харуулж бай» → format=table', () => {
  assert.equal(detectMemoryHints('цаашид жагсаалтаа хүснэгтээр харуулж бай')[0]?.type, 'format');
});

test('sanitizeMemory · хог, буруу төрөл, давхардал хасагдана; текст тайрагдана', () => {
  const out = sanitizeMemory([
    { type: 'answer_length', text: 'Богино бич.' },
    { type: 'answer_length', text: 'Дэлгэрэнгүй бич.' }, // давхардал — эхнийх ялна
    { type: 'identity', text: 'Хэрэглэгч бол захирал' }, // буруу төрөл
    { type: 'format', text: 'x'.repeat(500) },
    'junk',
    null,
    { type: 'terminology', text: 'ГУАТ = гал унтраах автомат төхөөрөмж' },
    { type: 'terminology', text: 'ГМДХ = галын мэдээлэх дохиолол' },
  ]);
  assert.deepEqual(
    out.map((m) => m.type),
    ['answer_length', 'format', 'terminology', 'terminology'],
  );
  assert.equal(out[0]!.text, 'Богино бич.');
  assert.equal(out[1]!.text.length, 160);
  assert.deepEqual(sanitizeMemory('x'), []);
  assert.deepEqual(sanitizeMemory(undefined), []);
});

test('sanitizeMemory · 6-аас олон мөр авахгүй', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ type: 'terminology', text: `нэр томьёо ${i}` }));
  assert.equal(sanitizeMemory(many).length, 6);
});

test('prompt · userPreferences → «ХЭРЭГЛЭГЧИЙН ТОХИРГОО» мөр; хоосон бол байхгүй', () => {
  const withPrefs = buildSystemPrompt({
    mode: 'employee',
    responseLanguage: 'mn-Cyrl',
    userPreferences: ['Хариултаа БОГИНО бич.', 'Жагсаалтыг ХҮСНЭГТЭЭР үзүүл.'],
  });
  assert.match(withPrefs, /ХЭРЭГЛЭГЧИЙН ТОХИРГОО: Хариултаа БОГИНО бич\. Жагсаалтыг ХҮСНЭГТЭЭР үзүүл\./);
  const without = buildSystemPrompt({ mode: 'employee', responseLanguage: 'mn-Cyrl', userPreferences: [] });
  assert.doesNotMatch(without, /ХЭРЭГЛЭГЧИЙН ТОХИРГОО/);
});
