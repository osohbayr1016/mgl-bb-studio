/**
 * MGL AI · QUERY DSL — ТЕСТ (§12).
 *
 * Run with:  node --test src/lib/mglai/gateway/query.test.ts
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ:
 *   · танихгүй entity / талбар / оператор → алдаа, SQL ХЭЗЭЭ Ч гарахгүй
 *   · утга ЗААВАЛ bind-ээр — SQL текстэнд хэрэглэгчийн мөр орохгүй
 *   · горимоор хаалттай entity/талбар (client → employees, admin-only талбар)
 *   · мөрийн хамрах хүрээ эх дэд асуулгад (employee: repair_entries = зөвхөн өөрийнх)
 *   · хязгаар: ≤100 мөр, ≤8 шүүлт, in ≤20
 *   · харьцангуй огноо today±N сервер дээр огноо болно
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

const { compileQuery } = await import('./query.ts');
const { ENTITIES, describeEntities, fieldsForMode } = await import('./entities.ts');

const EMP = { mode: 'employee', userId: 7, canSeeAllProjects: true, seesPending: false, today: '2026-09-10' } as const;
const ADMIN = { ...EMP, mode: 'admin', seesPending: true } as const;
const CLIENT = { ...EMP, mode: 'client', canSeeAllProjects: false } as const;

function ok(raw: unknown, scope = EMP) {
  const r = compileQuery(raw, scope);
  assert.equal(r.ok, true, r.ok ? '' : r.error);
  return (r as { ok: true; query: { sql: string; binds: unknown[]; countSql: string | null } }).query;
}
function fail(raw: unknown, scope = EMP) {
  const r = compileQuery(raw, scope);
  assert.equal(r.ok, false, 'алдаа хүлээсэн');
  return (r as { ok: false; error: string }).error;
}

test('танихгүй entity → алдаа', () => {
  assert.match(fail({ entity: 'salaries' }), /Танихгүй entity/);
  assert.match(fail({ entity: 'users' }), /Танихгүй entity/);
});

test('танихгүй талбар / оператор → алдаа, SQL-д хэрэглэгчийн мөр орохгүй', () => {
  assert.match(fail({ entity: 'employees', fields: ['password_hash'] }), /Танихгүй талбар/);
  assert.match(fail({ entity: 'projects', filters: [{ field: 'name', op: 'regexp', value: 'x' }] }), /Танихгүй оператор/);
  const q = ok({ entity: 'projects', filters: [{ field: 'name', op: 'contains', value: "x' OR 1=1 --" }] });
  assert.ok(!q.sql.includes("OR 1=1"), 'утга SQL текстэнд орсон');
  assert.ok(q.binds.includes("x' OR 1=1 --"), 'утга bind-ээр явах ёстой');
});

test('горимоор хаалттай entity/талбар', () => {
  assert.match(fail({ entity: 'employees' }, CLIENT), /энэ горимд харагдахгүй/);
  assert.match(fail({ entity: 'meetings' }, EMP), /энэ горимд харагдахгүй/);
  ok({ entity: 'meetings' }, ADMIN);
  // admin-only талбар ажилтанд танигдахгүй
  assert.match(fail({ entity: 'employees', fields: ['is_support'] }, EMP), /Танихгүй талбар/);
  ok({ entity: 'employees', fields: ['is_support'] }, ADMIN);
  // client → projects-ийн дотоод талбар (location) хаалттай
  assert.match(fail({ entity: 'projects', fields: ['location'] }, CLIENT), /Танихгүй талбар/);
});

test('мөрийн хамрах хүрээ эх дэд асуулгад: employee repair_entries = зөвхөн өөрийнх', () => {
  const mine = ok({ entity: 'repair_entries' }, EMP);
  assert.ok(mine.sql.includes('re.user_id = ?'), 'ажилтны хамрах хүрээ дутуу');
  assert.equal(mine.binds[0], 7);
  const all = ok({ entity: 'repair_entries' }, ADMIN);
  assert.ok(!all.sql.includes('re.user_id = ?'));
});

test('төслийн харагдац PROJECT_LIST_SQL-ээр — гишүүнчлэлтэй хэрэглэгчид INNER JOIN', () => {
  const q = ok({ entity: 'projects' }, CLIENT);
  assert.ok(q.sql.includes('INNER JOIN project_members'), 'захиалагчид гишүүнчлэлийн шүүлт байх ёстой');
  assert.ok(q.sql.includes('is_pending'), 'pending шүүлт');
  // bind дараалал: today ЭХЭНД (SELECT жагсаалтад), дараа нь sub×4
  assert.deepEqual(q.binds.slice(0, 5), ['2026-09-10', 7, 7, 7, 7]);
});

test('хязгаар: limit ≤ 100, шүүлт ≤ 8, in ≤ 20', () => {
  const q = ok({ entity: 'projects', limit: 5000 });
  assert.equal(q.binds.at(-1), 100);
  const q2 = ok({ entity: 'projects' });
  assert.equal(q2.binds.at(-1), 25, 'өгөгдмөл 25');
  const many = Array.from({ length: 9 }, () => ({ field: 'status', op: 'eq', value: 'active' }));
  assert.match(fail({ entity: 'projects', filters: many }), /8-аас олон/);
  const ids = Array.from({ length: 21 }, (_, i) => i + 1);
  assert.match(fail({ entity: 'projects', filters: [{ field: 'id', op: 'in', value: ids }] }), /20-аас олон/);
});

test('төрлийн шалгалт: огноо YYYY-MM-DD эсвэл today±N; boolean → 0/1', () => {
  assert.match(fail({ entity: 'tasks', filters: [{ field: 'due_date', op: 'lt', value: 'tomorrow' }] }), /YYYY-MM-DD/);
  const q = ok({ entity: 'tasks', filters: [{ field: 'due_date', op: 'lt', value: 'today-14' }, { field: 'is_overdue', op: 'eq', value: true }] });
  assert.ok(q.binds.includes('2026-08-27'), `today-14 → 2026-08-27, binds=${JSON.stringify(q.binds)}`);
  assert.ok(q.binds.includes(1), 'true → 1');
  assert.match(fail({ entity: 'projects', filters: [{ field: 'id', op: 'eq', value: 'abc' }] }), /бүхэл тоо/);
});

test('нэгтгэл: count, group_by, тоон биш талбарт sum хориотой', () => {
  const q = ok({ entity: 'tasks', group_by: 'team_code', aggregate: [{ fn: 'count' }] });
  assert.ok(/GROUP BY q\.team_code/.test(q.sql));
  assert.ok(/COUNT\(\*\) AS count/.test(q.sql));
  assert.equal(q.countSql, null, 'нэгтгэлд тусдаа тоолол хэрэггүй');
  assert.match(fail({ entity: 'tasks', aggregate: [{ fn: 'sum', field: 'name' }] }), /тоон талбар биш/);
  assert.match(fail({ entity: 'teams', group_by: 'code' }), /бүлэглэл дэмжихгүй/);
});

test('эрэмбэ: NULL сүүлд; эрэмбэлэх боломжгүй талбар → алдаа', () => {
  const q = ok({ entity: 'projects', sort: { field: 'finish_date', dir: 'asc' } });
  assert.ok(q.sql.includes('(q.finish_date IS NULL), q.finish_date ASC'));
  assert.match(fail({ entity: 'projects', sort: { field: 'display_title' } }), /эрэмбэлэх боломжгүй/);
});

test('каталог: нууц багана огт байхгүй; тодорхойлолтод SQL гарахгүй', () => {
  const forbidden = ['password', 'email', 'device', 'ip_address', 'tokens_valid', 'salary'];
  for (const e of Object.values(ENTITIES)) {
    for (const f of e.fields) for (const bad of forbidden) assert.ok(!f.col.includes(bad), `${e.name}.${f.name} → ${bad}`);
  }
  const desc = JSON.stringify(describeEntities('employee'));
  assert.ok(!/SELECT|FROM|JOIN/.test(desc), 'каталогийн тодорхойлолтод SQL байж болохгүй');
  assert.equal(describeEntities('denied').length, 0);
  assert.ok(describeEntities('client').every((e) => e.entity === 'projects'), 'захиалагчид зөвхөн projects');
  assert.ok(fieldsForMode(ENTITIES.employees!, 'employee').every((f) => f.name !== 'is_support'));
});
