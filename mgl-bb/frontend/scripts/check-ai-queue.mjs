/**
 * MGL AI · АСУУЛТЫН ДАРААЛАЛ — РЕГРЕСС ШАЛГАЛТ (цэвэр функцүүд).
 *
 *   node scripts/check-ai-queue.mjs        (frontend/ хавтаснаас)
 *
 * Хамгаалж буй зүйл: хоосон асуулт орохгүй · 10-аас дээш орохгүй · дараалал хадгалагдана ·
 * id-аар хасна · оролтын массивыг ӨӨРЧИЛӨХГҮЙ (React state-ийн дүрэм).
 * Hook-ийн ээлжээр эхлэх зан төлөв нь headless-Chrome-оор шалгагдсан (PR тайлбар).
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'features', 'mgl-ai', 'lib');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { enqueueQuestion, removeQueued, MAX_QUEUED_QUESTIONS } = await import(pathToFileURL(join(LIB, 'questionQueue.ts')).href);

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log('  ✔', name);
};

t('хоосон / зөвхөн хоосон зайтай асуулт орохгүй', () => {
  assert.equal(enqueueQuestion([], '', 'a').ok, false);
  const r = enqueueQuestion([], '   \n\t ', 'a');
  assert.deepEqual([r.ok, r.reason, r.queue.length], [false, 'empty', 0]);
});
t('асуулт тримлэгдэж, дарааллаа хадгална', () => {
  let q = [];
  for (const [i, s] of [' нэг ', 'хоёр', 'гурав'].entries()) q = enqueueQuestion(q, s, `id${i}`).queue;
  assert.deepEqual(q.map((x) => x.text), ['нэг', 'хоёр', 'гурав']);
});
t('дээд хязгаар (10) — 11 дэх нь татгалзагдаж, дараалал өөрчлөгдөхгүй', () => {
  let q = [];
  for (let i = 0; i < MAX_QUEUED_QUESTIONS; i++) q = enqueueQuestion(q, `q${i}`, `id${i}`).queue;
  const r = enqueueQuestion(q, 'илүү', 'x');
  assert.deepEqual([r.ok, r.reason, r.queue.length], [false, 'full', MAX_QUEUED_QUESTIONS]);
});
t('id-аар хасна, бусдын дараалал хэвээр', () => {
  let q = [];
  for (const [i, s] of ['a', 'b', 'c'].entries()) q = enqueueQuestion(q, s, `id${i}`).queue;
  assert.deepEqual(removeQueued(q, 'id1').map((x) => x.text), ['a', 'c']);
  assert.equal(removeQueued(q, 'missing').length, 3);
});
t('оролтын массивыг мутац хийхгүй', () => {
  const q = Object.freeze([Object.freeze({ id: 'a', text: 'x' })]);
  assert.doesNotThrow(() => enqueueQuestion(q, 'y', 'b'));
  assert.doesNotThrow(() => removeQueued(q, 'a'));
  assert.equal(q.length, 1);
});
t('маш урт асуулт тайрагдана', () => {
  const r = enqueueQuestion([], 'я'.repeat(20000), 'a');
  assert.ok(r.ok && r.queue[0].text.length === 8000);
});

console.log(`\n  ${passed} шалгалт · 0 унасан`);
