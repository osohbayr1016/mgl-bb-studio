/**
 * Дотоод журам · ГАРЫН ҮСГИЙН ЖАГСААЛТЫН ШҮҮЛТ — регресс шалгалт.
 *
 *   node scripts/check-rules-roster.mjs        (frontend/ хавтаснаас)
 *
 * `features/internal-rules/lib/rosterFilter.ts`-ийн цэвэр функцуудыг бодит
 * `.ts` эхээс ачаалж шалгана (vitest байхгүй — `check-ai-memory.mjs`-ийн загвар).
 *
 * ── ЮУГ ХАМГААЛЖ БАЙНА ВЭ ──────────────────────────────────────────────────
 *   · «Зурсан» / «Зураагүй» шүүлт нь `signature_id`-аар, огноогоор БИШ
 *   · хайлт нэр · нэвтрэх нэр · багийн кодоор, том жижиг үсэг ялгахгүй,
 *     хоосон/зайтай хайлт бүгдийг үлдээнэ
 *   · «нэр хуулах» нь ЗӨВХӨН зураагүй хүмүүсийг, нэргүй мөрөнд username/#id
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'features', 'internal-rules', 'lib');

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

const { rosterMatches, filterRoster, pendingNames } = await import(
  pathToFileURL(join(LIB, 'rosterFilter.ts')).href
);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const row = (o) => ({
  user_id: 0,
  full_name: null,
  username: null,
  role: 'engineer',
  team_code: null,
  signature_id: null,
  signed_at: null,
  previous: null,
  ...o,
});

const ROWS = [
  row({ user_id: 1, full_name: 'Админ', username: 'admin1', team_code: 'AR', signature_id: null }),
  row({ user_id: 2, full_name: 'Инженер Батаа', username: 'eng1', team_code: 'BA', signature_id: 10, signed_at: '2026-09-21T01:00:00Z' }),
  row({ user_id: 3, full_name: 'Архитектор Сараа', username: 'arch1', team_code: 'AR', signature_id: null, previous: { version: 1, signed_at: '2026-09-01T00:00:00Z' } }),
  row({ user_id: 4, full_name: null, username: 'senior1', team_code: 'BA', signature_id: 11, signed_at: '2026-09-21T02:00:00Z' }),
  row({ user_id: 5, full_name: null, username: null, team_code: null, signature_id: null }),
];

check('filter all → бүх мөр, дараалал хэвээр', () => {
  assert.deepEqual(filterRoster(ROWS, 'all', '').map((r) => r.user_id), [1, 2, 3, 4, 5]);
});
check('filter signed → зөвхөн signature_id != null', () => {
  assert.deepEqual(filterRoster(ROWS, 'signed', '').map((r) => r.user_id), [2, 4]);
});
check('filter pending → signature_id == null (previous-тэй ч pending)', () => {
  assert.deepEqual(filterRoster(ROWS, 'pending', '').map((r) => r.user_id), [1, 3, 5]);
});
check('хайлт нэрээр, том жижиг ялгахгүй, зай тайрна', () => {
  assert.deepEqual(filterRoster(ROWS, 'all', '  батаа ').map((r) => r.user_id), [2]);
  assert.deepEqual(filterRoster(ROWS, 'all', 'АРХИТЕКТОР').map((r) => r.user_id), [3]);
});
check('хайлт нэвтрэх нэр + багийн кодоор', () => {
  assert.deepEqual(filterRoster(ROWS, 'all', 'senior1').map((r) => r.user_id), [4]);
  assert.deepEqual(filterRoster(ROWS, 'all', 'ba').map((r) => r.user_id), [2, 4]);
  assert.deepEqual(filterRoster(ROWS, 'all', 'ar').map((r) => r.user_id), [1, 3]);
});
check('шүүлт + хайлт хамт', () => {
  assert.deepEqual(filterRoster(ROWS, 'pending', 'ar').map((r) => r.user_id), [1, 3]);
  assert.deepEqual(filterRoster(ROWS, 'signed', 'ar').map((r) => r.user_id), []);
});
check('хоосон хайлт бүгдийг үлдээнэ; null талбартай мөр унагахгүй', () => {
  assert.equal(rosterMatches(ROWS[4], ''), true);
  assert.equal(rosterMatches(ROWS[4], '   '), true);
  assert.equal(rosterMatches(ROWS[4], 'x'), false);
});
check('pendingNames — зөвхөн зураагүй; нэр → username → #id', () => {
  assert.deepEqual(pendingNames(ROWS), ['Админ', 'Архитектор Сараа', '#5']);
  assert.deepEqual(pendingNames([]), []);
  assert.deepEqual(pendingNames(ROWS.filter((r) => r.signature_id !== null)), []);
});

console.log(`check-rules-roster: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.error(`  ✖ ${f}`);
  process.exit(1);
}
