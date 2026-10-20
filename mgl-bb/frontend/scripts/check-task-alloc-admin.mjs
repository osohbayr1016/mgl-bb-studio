/**
 * ТАСКИЙН ХУВААРИЛАЛТЫН ХААЛГА + УДИРДЛАГЫН ХУУДАС — цэвэр шалгагч (2026-10-05).
 *
 *   node scripts/check-task-alloc-admin.mjs        (frontend/ хавтаснаас; `npm run verify`-д орсон)
 *
 *   0. Гэрээний толгой ЗӨВХӨН managed мутацид явна (бүх хүсэлтэд явбал хуучин Worker-ийн CORS preflight дээр апп бүхэлдээ унана).
 *   A. Гэрээний store (`shared/api/taskAllocContract.ts`): 426/423 → баннерын төрөл, төлөв толгойноос, `enabled` болмогц
 *      түр түгжээ цэвэрлэгдэх, мэдэгдэхгүй код/статус юу ч хийхгүй, мэдэгдэхгүй төлөв «бичиж болно» (сервер шийднэ).
 *   B. Гэрээний хувилбар ↔ backend `taskAllocGate.ts` (`TASK_ALLOC_CONTRACT`) таарна.
 *   C. i18n: удирдлагын компонентуудад хэрэглэсэн `taskAllocAdmin.*` түлхүүр бүр mn БА en-д бий; динамик гэр бүлүүд
 *      (аудит/хөрвүүлэлтийн кодууд) backend-ийн код бүрийг хамарна — шинэ код нэмээд орчуулгыг мартвал унана.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const BACKEND_LIB = join(HERE, '..', '..', 'backend', 'src', 'lib');
const ADMIN = join(SRC, 'features', 'task-allocation', 'admin');

const G = await import(pathToFileURL(join(SRC, 'shared', 'api', 'taskAllocContract.ts')).href);

let passed = 0;
let failed = 0;
// Шалгалтууд ДАРААЛАН (async-ийн хамт) ажиллана — store нь модулийн глобал тул зэрэг ажиллавал бие биедээ саад болно.
const queue = [];
const ok = (name, fn) => queue.push({ name, fn });
async function runAll() {
  for (const { name, fn } of queue) {
    try {
      await fn();
      passed += 1;
    } catch (err) {
      failed += 1;
      console.error(`✗ ${name}\n  ${String(err.message).split('\n').join('\n  ')}`);
    }
  }
}
const hdr = (state) => ({ get: (k) => (k === G.TASK_ALLOC_STATE_HEADER && state ? state : null) });
const snap = () => G.taskAllocGateStore.getSnapshot();

/* A. store */
ok('store: эхний төлөв хоосон, бичиж болно гэж үзнэ', () => {
  G.resetTaskAllocGateForTests();
  assert.equal(snap().state, null);
  assert.equal(snap().block, null);
  assert.equal(G.isGateWritable(snap()), true);
});
ok('store: X-Task-Alloc-State толгойг цуглуулна; мэдэгдэхгүй утга үл тооно', () => {
  G.resetTaskAllocGateForTests();
  G.observeGateHeaders(hdr('paused'));
  assert.equal(snap().state, 'paused');
  assert.equal(G.isGateWritable(snap()), false);
  G.observeGateHeaders(hdr('garbage'));
  assert.equal(snap().state, 'paused');
  G.observeGateHeaders(hdr(null));
  assert.equal(snap().state, 'paused');
});
ok('store: 423 PAUSED/DISABLED/UNCONFIGURED → баннерын төрөл', () => {
  for (const [code, kind] of [['TASK_ALLOC_PAUSED', 'paused'], ['TASK_ALLOC_DISABLED', 'disabled'], ['TASK_ALLOC_UNCONFIGURED', 'unconfigured']]) {
    G.resetTaskAllocGateForTests();
    assert.equal(G.observeGateBlock(423, { error: code, message: 'м', state: code === 'TASK_ALLOC_DISABLED' ? 'disabled' : 'paused' }), true);
    assert.equal(snap().block.kind, kind);
    assert.equal(snap().block.message, 'м');
  }
});
ok('store: 426 CONTRACT_UPGRADE_REQUIRED → client_older / server_older', () => {
  G.resetTaskAllocGateForTests();
  assert.equal(G.observeGateBlock(426, { error: 'CONTRACT_UPGRADE_REQUIRED', message: 'x' }), true);
  assert.equal(snap().block.kind, 'client_older');
  G.resetTaskAllocGateForTests();
  assert.equal(G.observeGateBlock(426, { error: 'CONTRACT_UPGRADE_REQUIRED', direction: 'server_older' }), true);
  assert.equal(snap().block.kind, 'server_older');
});
ok('store: бусад статус/код, хоосон биед юу ч хийхгүй', () => {
  G.resetTaskAllocGateForTests();
  assert.equal(G.observeGateBlock(500, { error: 'TASK_ALLOC_PAUSED' }), false);
  assert.equal(G.observeGateBlock(423, { error: 'SOMETHING_ELSE' }), false);
  assert.equal(G.observeGateBlock(426, { error: 'OTHER' }), false);
  assert.equal(G.observeGateBlock(423, null), false);
  assert.equal(snap().block, null);
});
ok('store: удирдлага `enabled` болговол түр түгжээ цэвэрлэгдэнэ, 426 баннер үлдэнэ', () => {
  G.resetTaskAllocGateForTests();
  G.observeGateBlock(423, { error: 'TASK_ALLOC_PAUSED', state: 'paused' });
  assert.equal(snap().block.kind, 'paused');
  G.observeGateHeaders(hdr('enabled'));
  assert.equal(snap().block, null);
  assert.equal(G.isGateWritable(snap()), true);
  G.observeGateBlock(426, { error: 'CONTRACT_UPGRADE_REQUIRED' });
  G.observeGateHeaders(hdr('enabled'));
  assert.equal(snap().block.kind, 'client_older', 'хуучин клиент төлөв enabled болсон ч хуучин хэвээр');
});
ok('store: dismiss баннер БА хуучин paused түгжээг суллана (дараагийн бичилтийг сервер шийднэ)', () => {
  G.resetTaskAllocGateForTests();
  G.observeGateHeaders(hdr('paused'));
  G.observeGateBlock(423, { error: 'TASK_ALLOC_PAUSED' });
  assert.equal(G.isGateWritable(snap()), false);
  G.dismissGateBlock();
  assert.equal(snap().block, null);
  assert.equal(snap().state, null);
  assert.equal(G.isGateWritable(snap()), true);
});
ok('store: хаалттай төлөв TTL-ийн дараа өөрөө суларна (allocation биш замаар enabled харагдахгүй ч гацахгүй)', async () => {
  G.resetTaskAllocGateForTests(15);
  G.observeGateHeaders(hdr('paused'));
  assert.equal(G.isGateWritable(snap()), false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(snap().state, null);
  assert.equal(G.isGateWritable(snap()), true);
  G.resetTaskAllocGateForTests();
});
ok('store: enabled төлөв таймер асаахгүй; төлөв солигдвол хуучин таймер цуцлагдана', async () => {
  G.resetTaskAllocGateForTests(15);
  G.observeGateHeaders(hdr('paused'));
  G.observeGateHeaders(hdr('enabled'));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(snap().state, 'enabled', 'enabled төлөв TTL-ээр null болохгүй');
  G.resetTaskAllocGateForTests();
});
ok('store: «сервер хуучин» 426 нь сервер бидний гэрээнд хүрсэн хариугаар арилна', () => {
  G.resetTaskAllocGateForTests();
  G.observeGateBlock(426, { error: 'CONTRACT_UPGRADE_REQUIRED', direction: 'server_older' });
  assert.equal(snap().block.kind, 'server_older');
  G.observeGateHeaders({ get: (k) => (k === G.TASK_ALLOC_CONTRACT_HEADER ? String(G.TASK_ALLOC_CONTRACT) : null) });
  assert.equal(snap().block, null);
  // client_older энэ дүрмээр арилахгүй
  G.observeGateBlock(426, { error: 'CONTRACT_UPGRADE_REQUIRED' });
  G.observeGateHeaders({ get: (k) => (k === G.TASK_ALLOC_CONTRACT_HEADER ? String(G.TASK_ALLOC_CONTRACT) : null) });
  assert.equal(snap().block.kind, 'client_older');
});

/* 0. толгой явуулах зам */
ok('толгой: ЗӨВХӨН managed мутацид (allocation, claim, alloc-admin, task-timer)', () => {
  const yes = [
    ['/tasks/12/allocation/split', 'POST'],
    ['/tasks/12/allocation/progress', 'POST'],
    ['/tasks/12/allocation', 'PUT'],
    ['/tasks/12/claim', 'POST'],
    ['/tasks/alloc-admin/state', 'PUT'],
    ['/tasks/alloc-admin/conversion/apply', 'POST'],
    ['/task-timer/start', 'POST'],
    ['/task-timer/pause', 'POST'],
    ['/task-timer/sessions/9/void', 'POST'],
    ['/tasks/12/allocation/split?x=1', 'post'],
  ];
  for (const [p, m] of yes) assert.equal(G.needsAllocContractHeader(p, m), true, `${m} ${p}`);
  const no = [
    ['/auth/me', 'GET'],
    ['/auth/login', 'POST'],
    ['/projects', 'GET'],
    ['/tasks/12/allocation', 'GET'],
    ['/task-timer/state', 'GET'],
    ['/task-timer/live', 'GET'],
    ['/progress', 'POST'],
    ['/attendance/clock-in', 'POST'],
    ['/tasks/12', 'PUT'],
    ['/tasks/12/split', 'POST'],
    ['/upload', 'POST'],
    ['/tasks/alloc-admin/state', 'GET'],
    ['/mgl-ai/context', 'POST'],
  ];
  for (const [p, m] of no) assert.equal(G.needsAllocContractHeader(p, m), false, `${m} ${p}`);
});
ok('store: өөрчлөлтгүй бол subscriber дуудагдахгүй (рендер шуурга үгүй)', () => {
  G.resetTaskAllocGateForTests();
  let n = 0;
  const off = G.taskAllocGateStore.subscribe(() => { n += 1; });
  G.observeGateHeaders(hdr('enabled'));
  G.observeGateHeaders(hdr('enabled'));
  G.observeGateHeaders(hdr('enabled'));
  off();
  assert.equal(n, 1);
});

/* B. гэрээний хувилбар */
ok('гэрээ: клиентийн хувилбар = backend CONTRACT', () => {
  const src = readFileSync(join(BACKEND_LIB, 'taskAllocGate.ts'), 'utf8');
  const m = /export const TASK_ALLOC_CONTRACT\s*=\s*(\d+)/.exec(src);
  assert.ok(m, 'backend taskAllocGate.ts-д TASK_ALLOC_CONTRACT олдсонгүй');
  assert.equal(Number(m[1]), G.TASK_ALLOC_CONTRACT, 'frontend ↔ backend гэрээний хувилбар зөрсөн — хамт өсгөнө');
});
ok('гэрээ: apiFetch толгойг needsAllocContractHeader-ээр (managed мутацид л) явуулж, хариуг store-д дамжуулна', () => {
  const src = readFileSync(join(SRC, 'shared', 'api', 'client.ts'), 'utf8');
  assert.match(src, /needsAllocContractHeader\(/);
  assert.match(src, /TASK_ALLOC_CONTRACT_HEADER/);
  assert.match(src, /observeGateHeaders\(/);
  assert.match(src, /observeGateBlock\(/);
});

/* C. i18n */
const readJson = (name) => JSON.parse(readFileSync(join(SRC, 'shared', 'i18n', name), 'utf8').replace(/^﻿/, ''));
const mn = readJson('mn.json');
const en = readJson('en.json');
const files = [...readdirSync(ADMIN).filter((f) => /\.tsx?$/.test(f)).map((f) => join(ADMIN, f)), join(ADMIN, '..', 'TaskAllocationAdminPage.tsx')];
const used = new Set();
const dynamicPrefixes = new Set();
const codeTextPrefixes = new Set();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/'((?:taskAllocAdmin|nav\.taskAllocation|pageTitle\.taskAllocation)[A-Za-z0-9_.]*)'/g)) used.add(m[1]);
  for (const m of text.matchAll(/`((?:taskAllocAdmin)\.[A-Za-z0-9_.]*)\$\{/g)) dynamicPrefixes.add(m[1]);
  for (const m of text.matchAll(/codeText\('(taskAllocAdmin\.[A-Za-z0-9_.]+)'/g)) {
    dynamicPrefixes.add(`${m[1]}.`);
    codeTextPrefixes.add(m[1]);
  }
}
// `codeText('prefix', code)` — `prefix` өөрөө түлхүүр БИШ (гэр бүлийн угтвар); гэр бүлийг доор backend-ийн кодоор шалгана.
for (const p of codeTextPrefixes) used.delete(p);
for (const k of ['nav.taskAllocation', 'pageTitle.taskAllocation']) used.add(k);

ok(`i18n: ${used.size} статик түлхүүр бүр mn БА en-д бий`, () => {
  const missing = [...used].filter((k) => !(k in mn) || !(k in en));
  assert.deepEqual(missing, []);
});
ok('i18n: taskAllocAdmin.* олонлог mn ≡ en', () => {
  const a = Object.keys(mn).filter((k) => k.startsWith('taskAllocAdmin.')).sort();
  const b = Object.keys(en).filter((k) => k.startsWith('taskAllocAdmin.')).sort();
  assert.deepEqual(a, b);
});
ok('i18n: placeholder-ууд mn ≡ en', () => {
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = Object.keys(mn).filter((k) => k.startsWith('taskAllocAdmin.') && ph(mn[k]) !== ph(en[k]));
  assert.deepEqual(bad, []);
});

// Динамик гэр бүлүүд: backend-ийн код бүр орчуулгатай.
const codesIn = (file, re) => [...new Set([...readFileSync(join(BACKEND_LIB, file), 'utf8').matchAll(re)].map((m) => m[1]))];
const need = {
  'taskAllocAdmin.audit.code.': codesIn('taskAllocAudit.ts', /add\('([A-Z_]+)'/g),
  'taskAllocAdmin.conv.blocker.': [
    ...codesIn('taskConversionPlan.ts', /blockers:\s*\['([A-Z_]+)[':]/g),
    ...codesIn('taskConversionPlan.ts', /blockers:\s*\[`([A-Z_]+)/g),
    ...codesIn('taskConversionPlan.ts', /blockers\.push\('([A-Z_]+)'/g),
  ],
  'taskAllocAdmin.conv.failure.': codesIn('taskConversionPlan.ts', /fail\('([A-Z_]+)'/g),
  'taskAllocAdmin.conv.revertReason.': codesIn('taskConversion.ts', /reasons(?:\.push\(|:\s*\[)\s*['`]([A-Z_]+)/g),
  'taskAllocAdmin.conv.warning.': [
    ...codesIn('taskConversionPlan.ts', /warnings\.push\('([A-Z_]+)'/g),
    ...codesIn('taskConversionPlan.ts', /warnings\.push\(`([A-Z_]+)/g),
  ],
};
for (const [prefix, codes] of Object.entries(need)) {
  ok(`i18n: ${prefix}* — backend-ийн ${codes.length} код бүр орчуулгатай`, () => {
    assert.ok(codes.length > 0, 'backend-ээс код олдсонгүй (regex эвдэрсэн?)');
    const missing = codes.filter((c) => !(`${prefix}${c}` in mn) || !(`${prefix}${c}` in en));
    assert.deepEqual(missing, []);
  });
}
ok('i18n: динамик гэр бүл бүр (state/count/credit/conv.*) ядаж нэг түлхүүртэй', () => {
  const dead = [...dynamicPrefixes].filter((p) => !Object.keys(mn).some((k) => k.startsWith(p)));
  assert.deepEqual(dead, []);
});

await runAll();
console.log(`task-alloc-admin: ${passed} шалгалт ногоон${failed ? `, ${failed} УНАЛАА` : ''}`);
process.exit(failed ? 1 : 0);
