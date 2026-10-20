/**
 * MGL AI · РЕЛИЗИЙН ХААЛГА — FAIL-CLOSED семантикийн тест (Session D §10, §11, §35).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeGate, GATE_SCHEMA, TEST_CLASSES, READINESS_AREAS, type SuiteResult } from '../src/gate/releaseGate.ts';

const ok = (id: string, cls: SuiteResult['class'], owner: SuiteResult['owner'] = 'D'): SuiteResult => ({
  id, class: cls, owner, status: 'PASS', blocking: true, pass: 1, fail: 0, skipped: 0, ms: 1, cmd: 'x',
});
const allPresent = { normCompiler: true, deployment: true, registry: true };
const git = { commit: 'abc', branch: 'x', dirty: false };
const compatOk = { ok: true, blocking: [], warnings: [], checked: 0, versions: {} };

const GREEN: SuiteResult[] = [
  ok('ai:runtime', 'UNIT', 'runtime'), ok('ai:retrieval', 'UNIT', 'A'), ok('ai:norm-compiler', 'UNIT', 'A'),
  ok('ai:deployment', 'UNIT', 'B'), ok('backend:mglai', 'UNIT', 'backend'), ok('fe:check-ai', 'UNIT', 'frontend'),
  ok('int:runtime-contract', 'INTEGRATION'), ok('int:drift', 'INTEGRATION'), ok('int:compat', 'INTEGRATION'), ok('fe:tsc', 'INTEGRATION', 'frontend'),
  ok('int:secrets', 'SECURITY'), ok('ai:auth', 'SECURITY', 'runtime'), ok('backend:visibility', 'SECURITY', 'backend'),
  ok('int:clean-machine', 'INSTALLATION', 'repo'),
  ok('eval:norm', 'MODEL_EVAL', 'A'), ok('eval:conv', 'E2E', 'C'), ok('eval:company', 'MODEL_EVAL', 'C'), ok('perf:responsiveness', 'PERFORMANCE', 'C'),
];

test('бүх ангилал ногоон + e2e + бүх эзэн merge → releaseReady', () => {
  const g = composeGate({ mode: 'e2e', git, versions: {}, suites: GREEN, compat: compatOk, presence: allPresent });
  assert.equal(g.schema, GATE_SCHEMA);
  assert.equal(g.releaseReady, true, g.notReadyBecause.join(' | '));
  for (const c of TEST_CLASSES) assert.equal(g.results[c].status, 'PASS', c);
  for (const a of READINESS_AREAS) assert.ok(g.matrix[a], a);
  assert.equal(g.matrix['Core normative'].status, 'PASS');
  assert.equal(g.matrix['Rollback'].status, 'NOT_IMPLEMENTED'); // ҮНЭНЧ: тест алга
});

test('fast горим → releaseReady ХЭЗЭЭ Ч true биш (E2E ажиллаагүй)', () => {
  const g = composeGate({ mode: 'fast', git, versions: {}, suites: GREEN.filter((s) => !['E2E', 'MODEL_EVAL', 'PERFORMANCE'].includes(s.class)), compat: compatOk, presence: allPresent });
  assert.equal(g.releaseReady, false);
  assert.ok(g.notReadyBecause.some((r) => r.includes('--e2e')));
  assert.equal(g.results.E2E.status, 'NOT_RUN');
});

test('нэг blocking suite унавал → releaseReady=false, тухайн ангилал FAIL', () => {
  const suites = GREEN.map((s) => (s.id === 'int:secrets' ? { ...s, status: 'FAIL' as const, fail: 1, failures: ['нууц гоожив'] } : s));
  const g = composeGate({ mode: 'e2e', git, versions: {}, suites, compat: compatOk, presence: allPresent });
  assert.equal(g.releaseReady, false);
  assert.equal(g.results.SECURITY.status, 'FAIL');
  assert.equal(g.matrix['Security'].status, 'FAIL');
  assert.ok(g.blocking.some((b) => b.id === 'int:secrets'));
});

test('blocking=false suite унавал → warning, releaseReady хэвээр', () => {
  const suites = GREEN.map((s) => (s.id === 'perf:responsiveness' ? { ...s, status: 'FAIL' as const, blocking: false, fail: 1 } : s));
  const g = composeGate({ mode: 'e2e', git, versions: {}, suites, compat: compatOk, presence: allPresent });
  assert.equal(g.releaseReady, true);
  assert.ok(g.warnings.some((w) => w.id === 'perf:responsiveness'));
});

test('эзний WIP merge хийгдээгүй → BLOCKED_BY_X, хувь хэмжээ биш', () => {
  const suites = GREEN.map((s) => (s.id === 'ai:deployment' ? { ...s, status: 'BLOCKED' as const, note: 'алга' } : s));
  const g = composeGate({ mode: 'e2e', git, versions: {}, suites, compat: compatOk, presence: { ...allPresent, deployment: false } });
  assert.equal(g.releaseReady, false);
  assert.equal(g.matrix['Employee packaging'].status, 'BLOCKED_BY_B');
  assert.equal(g.matrix['Update'].status, 'BLOCKED_BY_B');
  assert.ok(!JSON.stringify(g).includes('%'), 'хувь хэмжээ байх ёсгүй');
});

test('compat blocking → releaseReady=false, COMPAT ангилалтай зөрчил', () => {
  const g = composeGate({
    mode: 'e2e', git, versions: {}, suites: GREEN,
    compat: { ok: false, blocking: [{ id: 'knowledge-schema-matches-runtime', severity: 'blocking', owner: 'A', detail: '3≠4', reason: 'r' }], warnings: [], checked: 1, versions: {} },
    presence: allPresent,
  });
  assert.equal(g.releaseReady, false);
  assert.ok(g.blocking.some((b) => b.class === 'COMPAT' && b.owner === 'A'));
});

test('ажиллаагүй ангилал = NOT_RUN, PASS биш', () => {
  const g = composeGate({ mode: 'e2e', git, versions: {}, suites: GREEN.filter((s) => s.class !== 'PERFORMANCE'), compat: compatOk, presence: allPresent });
  assert.equal(g.results.PERFORMANCE.status, 'NOT_RUN');
  assert.equal(g.releaseReady, false);
});
