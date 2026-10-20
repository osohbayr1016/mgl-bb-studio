/**
 * MGL AI · ЛОКАЛ САНАМЖ — РЕГРЕСС ШАЛГАЛТ (§34–36, §90).
 *
 *   node scripts/check-ai-memory.mjs        (frontend/ хавтаснаас)
 *
 * ── ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ ──────────────────────────────────────────────
 *   · санамж нь ХАМААРЛААР шүүгдэнэ — бүгд prompt-д орохгүй
 *   · хуучирсан (90 хоног) ба хугацаа дууссан санамж орохгүй
 *   · нэр томьёо зөвхөн асуултад тэр үг байвал
 *   · «намайг X гэж дууд» зөвхөн мэндчилгээ/мета дээр (identity бодлого)
 *   · шинэ ил хүсэлт хуучныг СОЛИНО (§14), нэг удаагийнх хадгалагдахгүй
 *   · localStorage байхгүй үед ч унахгүй
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'features', 'mgl-ai', 'lib');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : LIB;
      const asFile = join(base, `${specifier}.ts`);
      if (existsSync(asFile)) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(`${specifier}/index.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const M = await import(pathToFileURL(join(LIB, 'memory.ts')).href);
const { selectMemories, upsertFromHint, isStandingHint, markUsed, removeMemory, toWire, loadMemories, saveMemories } = M;

let passed = 0;
let failed = 0;
const failures = [];
function scenario(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}\n    ${String(err.message).split('\n')[0]}`);
  }
}

const NOW = new Date('2026-09-10T10:00:00Z');
const hint = (type, value, text, reason = 'байнгын') => ({ type, value, text, label: text, reason });
function item(type, value, over = {}) {
  return {
    id: `m_${type}_${value}`,
    type,
    value,
    text: `${type}=${value}`,
    label: value,
    importance: 2,
    confidence: 1,
    createdAt: '2026-09-01T00:00:00Z',
    lastUsedAt: null,
    lastConfirmedAt: '2026-09-01T00:00:00Z',
    expiresAt: null,
    useCount: 0,
    ...over,
  };
}

console.log('\nupsertFromHint / isStandingHint');
scenario('шинэ ил хүсэлт хуучныг СОЛИНО (богино → дэлгэрэнгүй)', () => {
  const s1 = upsertFromHint([], hint('answer_length', 'short', 'Богино'), NOW);
  const s2 = upsertFromHint(s1.items, hint('answer_length', 'long', 'Дэлгэрэнгүй'), NOW);
  assert.equal(s2.items.length, 1);
  assert.equal(s2.items[0].value, 'long');
  assert.equal(s2.replaced, true);
});
scenario('ижил утга дахин батлагдвал id хэвээр, lastConfirmedAt шинэчлэгдэнэ', () => {
  const s1 = upsertFromHint([], hint('answer_length', 'short', 'Богино'), new Date('2026-09-01T00:00:00Z'));
  const s2 = upsertFromHint(s1.items, hint('answer_length', 'short', 'Богино'), NOW);
  assert.equal(s2.items[0].id, s1.items[0].id);
  assert.equal(s2.items[0].lastConfirmedAt, NOW.toISOString());
  assert.equal(s2.replaced, false);
});
scenario('нэр томьёо олон байж болно (утгаараа ялгаатай)', () => {
  const s1 = upsertFromHint([], hint('terminology', 'ГУАТ', 'ГУАТ = …'), NOW);
  const s2 = upsertFromHint(s1.items, hint('terminology', 'ГМДХ', 'ГМДХ = …'), NOW);
  assert.equal(s2.items.length, 2);
});
scenario('«нэг удаагийн» дохио хадгалагдахгүй', () => {
  assert.equal(isStandingHint(hint('answer_length', 'short', 'x', 'богино (нэг удаагийн)')), false);
  assert.equal(isStandingHint(hint('answer_length', 'short', 'x', 'богино')), true);
});

console.log('\nselectMemories — хамаарлын шүүлт');
const ALL = [
  item('answer_length', 'short', { importance: 2 }),
  item('format', 'table'),
  item('response_language', 'mn-Cyrl', { importance: 3 }),
  item('address_as', 'Бат'),
  item('terminology', 'ГУАТ'),
  item('terminology', 'ГМДХ'),
];
scenario('төслийн асуултад: хэв маяг орно, нэр томьёо/дуудлага ОРОХГҮЙ', () => {
  const s = selectMemories(ALL, { question: 'хэдэн төсөл байна', intent: 'COMPANY_FACT' }, NOW);
  const types = s.map((m) => m.type);
  assert.ok(types.includes('answer_length') && types.includes('format') && types.includes('response_language'));
  assert.ok(!types.includes('address_as'), 'identity-ийн бодлого: төслийн асуултад нэр хэрэггүй');
  assert.ok(!types.includes('terminology'));
});
scenario('нэр томьёо ЗӨВХӨН асуултад тэр үг байвал', () => {
  const s = selectMemories(ALL, { question: '300 м2 агуулахад ГУАТ хэрэгтэй юу', intent: 'NORMATIVE' }, NOW);
  assert.ok(s.some((m) => m.value === 'ГУАТ'));
  assert.ok(!s.some((m) => m.value === 'ГМДХ'));
});
scenario('мэндчилгээнд «намайг X гэж дууд» орно', () => {
  const s = selectMemories(ALL, { question: 'сайн уу', intent: 'CASUAL' }, NOW);
  assert.ok(s.some((m) => m.type === 'address_as'));
});
scenario('хэв маяг ≤3 (хамгийн чухал нь ялна)', () => {
  const many = [
    ...ALL.filter((m) => m.type !== 'terminology' && m.type !== 'address_as'),
    item('format', 'bullets', { id: 'extra1' }),
  ];
  const s = selectMemories(many, { question: 'x', intent: null }, NOW);
  assert.ok(s.filter((m) => m.type !== 'terminology' && m.type !== 'address_as').length <= 3);
  assert.equal(s[0].type, 'response_language', 'importance 3 эхэнд');
});
scenario('90 хоног хэрэглээгүй санамж ОРОХГҮЙ, хугацаа дууссан нь ОРОХГҮЙ', () => {
  const stale = item('answer_length', 'short', { lastConfirmedAt: '2026-05-01T00:00:00Z', lastUsedAt: null });
  const expired = item('format', 'table', { expiresAt: '2026-09-01T00:00:00Z' });
  const fresh = item('response_language', 'en', { lastUsedAt: '2026-09-09T00:00:00Z' });
  const s = selectMemories([stale, expired, fresh], { question: 'x', intent: null }, NOW);
  assert.deepEqual(s.map((m) => m.value), ['en']);
});
scenario('markUsed · lastUsedAt, useCount шинэчлэгдэнэ; бусад хөндөгдөхгүй', () => {
  const next = markUsed(ALL, ['m_format_table'], NOW);
  const f = next.find((m) => m.id === 'm_format_table');
  assert.equal(f.lastUsedAt, NOW.toISOString());
  assert.equal(f.useCount, 1);
  assert.equal(next.find((m) => m.id === 'm_terminology_ГУАТ').useCount, 0);
});
scenario('removeMemory / toWire', () => {
  assert.equal(removeMemory(ALL, 'm_format_table').length, ALL.length - 1);
  assert.deepEqual(toWire([ALL[0]]), [{ type: 'answer_length', text: 'answer_length=short', value: ALL[0].value }], 'value нь серверт хариултын хэлийг шийдэхэд хэрэгтэй');
});

console.log('\nlocalStorage байхгүй үед');
scenario('loadMemories/saveMemories унахгүй (globalThis.localStorage алга)', () => {
  assert.deepEqual(loadMemories('employee:1'), []);
  saveMemories('employee:1', ALL); // throw-гүй
});
scenario('localStorage байвал хадгалж, уншина; хог JSON → хоосон', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  saveMemories('employee:1', ALL);
  assert.equal(loadMemories('employee:1').length, ALL.length);
  assert.deepEqual(loadMemories('employee:2'), [], 'өөр хэрэглэгч → тусдаа');
  store.set('mglai.memory.employee:3', '{not json');
  assert.deepEqual(loadMemories('employee:3'), []);
  delete globalThis.localStorage;
});

console.log(`\n${passed} тэнцсэн, ${failed} унасан${failed ? ' · ' + failures.join(' | ') : ''}`);
process.exit(failed ? 1 : 0);
