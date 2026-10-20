// ТАСКИЙН ХУВААРИЛТЫН МИГРАЦУУД 0376–0385 — цэвэр суулгалт ↔ шинэчлэлт (2026-10-05).
//
//   clean   — репогийн БҮХ миграц дарааллаараа (шинэ орчин).
//   upgrade — прод-ын ЯГ ОДООГИЙН төлөв (0376–0380 хэрэгжсэн, өгөгдөлтэй) дээр 0381…0385-ыг ДАРААГААР нь.
//
// Шалгадаг зүйл:
//   • 0376–0385 нь толерантгүй ЦЭВЭР ажиллана (нэг ч statement унахгүй);
//   • upgrade нь хуучин өгөгдлийг БАЙТ-ИЖИЛ хадгална, шинэ баганууд зөв анхны утгатай;
//   • 0384-ийн анхны төлөв: managed root байвал `paused`, үгүй бол `disabled`; лог ЯГ нэг мөр; дахин ажиллуулахад давхардахгүй;
//   • clean ↔ upgrade-ийн схемийн хурууны хээ (багана, индекс, CHECK) allocation-ийн бүх хүснэгтэд ТЭНЦҮҮ;
//   • D1-ийн тээврийн дүрэм (≤9 statement, `/*` үгүй) 0376–0385-д;
//   • хөрвүүлэлтийн хүснэгтүүд (0385) байхгүй орчинд ч хуучин код (retiredIntoRoot) унахгүй.
//
// ⚠️ ЭНЭ НЬ STAGING D1 ШАЛГАЛТ БИШ.  `node:sqlite` нь Cloudflare D1-ийн (workerd SQLite) бодит ажиллагааг, транзакцийн
//    wrapper-ийг, `d1 migrations apply`-ийн бүртгэлийг орлохгүй.  Staging шалгалт тусдаа, заавал хийх хаалга (docs/task-workflow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMigrationStrict, applyMigrationTolerant, makeRealSchema, migrationFiles, readMigration, schemaFingerprint } from '../../test-support/realSchema.ts';

const ALLOC_FILES = migrationFiles().filter((f) => /^03(7[6-9]|8[0-5])_/.test(f));
const ALLOC_TABLES = [
  'task_roots',
  'task_allocations',
  'task_contributions',
  'task_ops',
  'task_timer_voids',
  'task_credit_adjustments',
  'task_alloc_state_log',
  'task_conversions',
  'task_conversion_members',
  'user_points',
] as const;

test('0376–0380, 0383–0385 репод бий (0381 = олон нийтийн гарын үсэг; 0382 нь өөр салбарт (guardian) нөөцлөгдсөн — энд ашиглахгүй)', () => {
  const nums = ALLOC_FILES.map((f) => f.slice(0, 4));
  for (const n of ['0376', '0377', '0378', '0379', '0380', '0383', '0384', '0385']) assert.ok(nums.includes(n), `${n} алга`);
});

test('0376–0385 толерантгүй цэвэр ажиллана — clean суулгалтад нэг ч statement унахгүй', () => {
  const { skipped } = makeRealSchema();
  const mine = skipped.filter((s) => /^03(7[6-9]|8[0-5])_/.test(s));
  assert.deepEqual(mine, [], 'allocation миграц unasan: ' + mine.join('; '));
});

test('D1 тээврийн дүрэм: 0376–0385 тус бүр ≤9 statement, `/*` блок комментгүй', () => {
  for (const f of ALLOC_FILES) {
    const sql = readMigration(f);
    assert.ok(!sql.includes('/*'), `${f}: /* комментгүй байх ёстой`);
    const stmts = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(/;\s*(?:\n|$)/)
      .filter((p) => p.trim() !== '');
    assert.ok(stmts.length <= 9, `${f}: ${stmts.length} statement (дээд тал нь 9)`);
  }
});

function seedDeployedState(sqlite: ReturnType<typeof makeRealSchema>['sqlite'], withRoot: boolean) {
  if (!withRoot) return;
  sqlite.exec(`
    INSERT INTO task_roots (task_id, revision, unattributed_units, unallocated_units, next_ordinal, created_by) VALUES (9001, 4, 0, 200000, 3, 3);
    INSERT INTO task_allocations (task_id, user_id, ordinal, target_units, done_units, floor_units, released_units) VALUES
      (9001, 3, 1, 400000, 150000, 0, 0), (9001, 4, 2, 400000, 0, 0, 0);
    INSERT INTO task_contributions (task_id, allocation_id, user_id, actor_id, kind, units, units_open, work_date, awarded_at, recorded_at, request_id, seq, root_revision)
      VALUES (9001, 1, 3, 3, 'work', 150000, 150000, '2026-10-02', '2026-10-02 10:00:00', '2026-10-02 10:00:00', 'req-1', 0, 2);
    INSERT INTO task_ops (request_id, task_id, user_id, kind, root_revision_before, root_revision_after, result_json, post_status)
      VALUES ('req-1', 9001, 3, 'progress', 1, 2, '{"ok":true}', 'done');
  `);
}

const dump = (sqlite: ReturnType<typeof makeRealSchema>['sqlite'], table: string, cols: string) =>
  JSON.stringify(sqlite.prepare(`SELECT ${cols} FROM ${table} ORDER BY 1, 2`).all());

test('upgrade: өгөгдөлтэй deployed төлөв (0376–0380) → 0383 → 0384 → 0385: хуучин өгөгдөл байт-ижил, шинэ багана зөв анхны утгатай', () => {
  const { sqlite, skipped } = makeRealSchema({ upTo: '0380', exclude: ['0381_public_document_signing.sql'] });
  assert.deepEqual(skipped.filter((s) => /^03(7[6-9]|80)_/.test(s)), []);
  seedDeployedState(sqlite, true);
  const before = {
    roots: dump(sqlite, 'task_roots', 'task_id, revision, unattributed_units, unallocated_units, next_ordinal'),
    alloc: dump(sqlite, 'task_allocations', 'task_id, user_id, ordinal, target_units, done_units, floor_units'),
    contrib: dump(sqlite, 'task_contributions', 'task_id, user_id, kind, units, units_open, request_id, seq'),
    ops: dump(sqlite, 'task_ops', 'request_id, task_id, kind, result_json, post_status'),
  };
  for (const f of ['0383_task_alloc_hardening.sql', '0384_task_alloc_gate.sql', '0385_task_conversions.sql']) applyMigrationStrict(sqlite, f);
  assert.equal(dump(sqlite, 'task_roots', 'task_id, revision, unattributed_units, unallocated_units, next_ordinal'), before.roots);
  assert.equal(dump(sqlite, 'task_allocations', 'task_id, user_id, ordinal, target_units, done_units, floor_units'), before.alloc);
  assert.equal(dump(sqlite, 'task_contributions', 'task_id, user_id, kind, units, units_open, request_id, seq'), before.contrib);
  assert.equal(dump(sqlite, 'task_ops', 'request_id, task_id, kind, result_json, post_status'), before.ops);
  const op = sqlite.prepare("SELECT request_hash, post_json, post_attempts, post_error, post_status FROM task_ops WHERE request_id = 'req-1'").get() as Record<string, unknown>;
  assert.deepEqual({ ...op }, { request_hash: null, post_json: null, post_attempts: 0, post_error: null, post_status: 'done' });
  // 0384: managed root аль хэдийн байсан тул идэвхжүүлэхгүй, `paused`.
  const st = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'task_alloc.state'").get() as { value: string };
  assert.equal(st.value, 'paused');
  const log = sqlite.prepare('SELECT from_state, to_state, actor_id, contract FROM task_alloc_state_log').all();
  assert.equal(log.length, 1);
  assert.deepEqual({ ...(log[0] as object) }, { from_state: null, to_state: 'paused', actor_id: null, contract: 1 });
});

test('upgrade: managed root байхгүй орчинд 0384 → `disabled` (шинэ орчинг түр асаахгүй)', () => {
  const { sqlite } = makeRealSchema({ upTo: '0380', exclude: ['0381_public_document_signing.sql'] });
  seedDeployedState(sqlite, false);
  for (const f of ['0383_task_alloc_hardening.sql', '0384_task_alloc_gate.sql', '0385_task_conversions.sql']) applyMigrationStrict(sqlite, f);
  const st = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'task_alloc.state'").get() as { value: string };
  assert.equal(st.value, 'disabled');
});

test('0384/0385 дахин ажиллуулахад давхардахгүй, админы өөрчилсөн төлөвийг ДАРАХГҮЙ (идемпотент)', () => {
  const { sqlite } = makeRealSchema({ upTo: '0380', exclude: ['0381_public_document_signing.sql'] });
  seedDeployedState(sqlite, true);
  for (const f of ['0383_task_alloc_hardening.sql', '0384_task_alloc_gate.sql', '0385_task_conversions.sql']) applyMigrationStrict(sqlite, f);
  sqlite.exec("UPDATE app_settings SET value = 'enabled' WHERE key = 'task_alloc.state'");
  sqlite.exec("INSERT INTO task_alloc_state_log (from_state, to_state, actor_id, reason, contract) VALUES ('paused', 'enabled', 1, 'admin', 1)");
  for (const f of ['0384_task_alloc_gate.sql', '0385_task_conversions.sql']) applyMigrationStrict(sqlite, f);
  assert.equal((sqlite.prepare("SELECT value FROM app_settings WHERE key = 'task_alloc.state'").get() as { value: string }).value, 'enabled');
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM task_alloc_state_log').get() as { n: number }).n, 2);
});

test('clean ↔ upgrade: allocation-ийн бүх хүснэгтийн схем (багана, индекс, CHECK) ТЭНЦҮҮ', () => {
  const clean = makeRealSchema();
  const up = makeRealSchema({ upTo: '0380', exclude: ['0381_public_document_signing.sql'] });
  for (const f of ['0383_task_alloc_hardening.sql', '0384_task_alloc_gate.sql', '0385_task_conversions.sql']) applyMigrationStrict(up.sqlite, f);
  const a = schemaFingerprint(clean.sqlite, ALLOC_TABLES);
  const b = schemaFingerprint(up.sqlite, ALLOC_TABLES);
  assert.deepEqual(b, a);
});

test('upgrade: 0385 хараахан хэрэгжээгүй орчинд хуучин код унахгүй (retiredIntoRoot → null)', async () => {
  const { sqlite } = makeRealSchema({ upTo: '0380', exclude: ['0381_public_document_signing.sql'] });
  for (const f of ['0383_task_alloc_hardening.sql', '0384_task_alloc_gate.sql']) applyMigrationStrict(sqlite, f);
  const { retiredIntoRoot } = await import('./taskAllocGate.ts');
  const db = {
    prepare: (sql: string) => ({
      bind: (...a: unknown[]) => ({
        first: async () => {
          try {
            return (sqlite.prepare(sql).get(...(a as never[])) as unknown) ?? null;
          } catch (e) {
            throw e;
          }
        },
      }),
    }),
  } as unknown as D1Database;
  assert.equal(await retiredIntoRoot(db, 123), null);
});

test('applyMigrationTolerant нь цэвэр миграцад хоосон жагсаалт буцаадаг (тест өөрөө худал ногоон биш)', () => {
  const { sqlite } = makeRealSchema({ upTo: '0380', exclude: ['0381_public_document_signing.sql'] });
  assert.deepEqual(applyMigrationTolerant(sqlite, '0384_task_alloc_gate.sql'), []);
  // Зориуд эвдсэн схем: хүснэгтгүй орчинд statement унана → тест үүнийг барьдаг.
  const bad = makeRealSchema({ upTo: '0300' });
  assert.ok(applyMigrationTolerant(bad.sqlite, '0383_task_alloc_hardening.sql').length > 0);
});
