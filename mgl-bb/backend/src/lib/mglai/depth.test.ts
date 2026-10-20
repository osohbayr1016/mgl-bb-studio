/**
 * MGL AI · ХАРИУЛТЫН ГҮН — ТЕСТ.  Run: node --test src/lib/mglai/depth.test.ts
 *
 * ⚠️ ЮУГ ХАМГААЛЖ БАЙНА: энгийн баримт → товч; ялгаа/шалтгаан/дараалал → дэлгэрэнгүй;
 *    ил «товчхон»/«дэлгэрэнгүй» бүхнээс дээгүүр; санамж санаанаас дээгүүр.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const { decideDepth, depthInstruction } = await import('./depth.ts');
const { classifyIntent } = await import('./intent.ts');
const d = (q: string, extra: Record<string, unknown> = {}) => decideDepth({ question: q, intent: classifyIntent(q).intent, ...extra });

test('энгийн баримтын асуулт → short', () => {
  for (const q of ['Хэдэн төсөл идэвхтэй байна?', 'heden ajiltan bna', 'How many tasks are overdue?', 'Хамгийн ойр deadline-тай төсөл аль вэ?', 'Сайн уу', 'Чи юу хийж чадах вэ?']) assert.equal(d(q).depth, 'short', q);
});

test('нормын лавлагаа/ангилал → normal (ангилал + муж + эх сурвалж)', () => {
  for (const q of ['В2-ийн муж хэд вэ?', 'g=1800 MJ/m2 bol V2 yu V3 yu', 'В4 ангиллын галын ачаалал хэд хүртэл вэ?']) assert.equal(d(q, { regulatory: true }).depth, 'normal', q);
});

test('ялгаа/шалтгаан/дараалал/шинжилгээ → detailed', () => {
  for (const q of [
    'В2 ба В3 ангиллын ялгааг тайлбарлаад, g болон Q/H шалгалт ямар дарааллаар ордгийг тайлбарла',
    'Эдгээр төслүүдээс аль нь эрсдэлтэй байна, яагаад, ямар task-ууд гол нөлөө үзүүлж байна?',
    'Why is this project behind?',
    'ene tusul yagaad udaad bna',
    'Барилгын зураг төслийн ажлын үе шатуудыг эхнээс нь дуустал тайлбарлаад өгөөч',
  ]) assert.equal(d(q).depth, 'detailed', q);
});

test('ойлголт тайлбарлах → normal', () => {
  for (const q of ['ZA категори гэж юу вэ?', 'Төслийн явц хэрхэн тооцогддог вэ?', 'What is a design brief?']) assert.equal(d(q).depth, 'normal', q);
});

test('ил «товчхон» / «дэлгэрэнгүй» бүхнээс дээгүүр', () => {
  const s = d('Төслийн явцын тооцоог товчхон хэлээч, яагаад ингэж тооцдог вэ?');
  assert.equal(s.depth, 'short');
  assert.equal(s.explicit, true);
  const l = d('Хэдэн төсөл идэвхтэй байна, дэлгэрэнгүй тайлбарла');
  assert.equal(l.depth, 'detailed');
  assert.equal(l.explicit, true);
  assert.equal(d('Explain in detail how progress is calculated').depth, 'detailed');
  assert.equal(d('briefly, how many projects?').depth, 'short');
});

test('санамж: богино → short, дэлгэрэнгүй → detailed; ил хүсэлт санамжаас дээгүүр', () => {
  assert.equal(d('Төслийн явц хэрхэн тооцогддог вэ?', { preferredLength: 'short' }).depth, 'short');
  assert.equal(d('Хэдэн төсөл идэвхтэй байна?', { preferredLength: 'long' }).depth, 'detailed');
  assert.equal(d('дэлгэрэнгүй тайлбарла: төслийн явц', { preferredLength: 'short' }).depth, 'detailed');
});

test('олон санаа → normal; ERP шинжилгээ → detailed', () => {
  assert.equal(d('Хэдэн төсөл байна? Бас В2 галын ачаалал хэдээс хэд вэ?', { taskCount: 2 }).depth, 'normal');
  assert.equal(decideDepth({ question: 'x', intent: 'ERP_ANALYSIS' }).depth, 'detailed');
});

test('AEC detailed instruction нь баримт → reasoning → эрсдэл → шалгалтын дараалалтай', () => {
  const detailed = depthInstruction('detailed', 'mn-Cyrl');
  assert.match(detailed, /өгөгдөл\/баримт/);
  assert.match(detailed, /инженерийн тайлбар эсвэл тооцоо/);
  assert.match(detailed, /эрсдэл\/таамаг/);
  assert.match(detailed, /дараагийн шалгалт/);
  assert.match(detailed, /Таамгийг баримт мэт бүү бич/);

  const normal = depthInstruction('normal', 'mn-Cyrl');
  assert.match(normal, /хэмжээс, материал, ачаалал/);
  assert.match(normal, /таамаглахгүй/);
});

test('depthInstruction нь монгол/англи нэг мөр, ГҮН:/DEPTH: угтвартай', () => {
  assert.match(depthInstruction('short', 'mn-Cyrl'), /^ГҮН: ТОВЧ/);
  assert.match(depthInstruction('detailed', 'en'), /^DEPTH: DETAILED/);
  for (const dep of ['short', 'normal', 'detailed'] as const) assert.ok(!depthInstruction(dep, 'mn-Cyrl').includes('\n'));
});
