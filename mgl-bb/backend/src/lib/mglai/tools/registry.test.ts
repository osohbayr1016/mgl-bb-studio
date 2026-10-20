/**
 * MGL AI · ХЭРЭГСЛИЙН БҮРТГЭЛ — ТЕСТ (§46-ийн «tool validation»).
 *
 * Run with:  node --test src/lib/mglai/tools/registry.test.ts
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

const { TOOLS, toolsForMode, validateToolArgs, isKnownTool } = await import('./registry.ts');
const { ERP_EXECUTORS } = await import('./erp.ts');

/* ================================================================== */
/*  1. Бүртгэл ба хэрэгжүүлэлт зэрэг хөдөлнө                           */
/* ================================================================== */

test('бүртгэгдсэн хэрэгсэл БҮР хэрэгжүүлэлттэй', () => {
  // ⚠️ 2026-09-08: өмнө нь `search_*` хоёр хэрэгсэл бүртгэлд байсан ч
  //    гүйцэтгэгчгүй байв — тайлбар нь «энэ хэрэгслийг дуудна» гэж
  //    ХУДЛАА хэлж, дуудвал `not_implemented` буцаадаг байсан.
  //    Загварт худал хэлэх нь дутуу хэрэгжүүлэлтээс ДОР.
  for (const name of Object.keys(TOOLS)) {
    assert.ok(ERP_EXECUTORS[name], `«${name}» бүртгэгдсэн ч хэрэгжүүлээгүй`);
  }
});

test('гүйцэтгэгч бүр бүртгэлд байна — өнчин функц үлдэхгүй', () => {
  for (const name of Object.keys(ERP_EXECUTORS)) {
    assert.ok(TOOLS[name], `«${name}» хэрэгжсэн ч бүртгэгдээгүй`);
  }
});

test('хэрэгсэл бүр kind ба modes-той — эрхийг МАРТАХ боломжгүй', () => {
  for (const [name, def] of Object.entries(TOOLS)) {
    assert.ok(['read', 'view', 'write', 'admin'].includes(def.kind), name);
    assert.ok(def.modes.length > 0, name);
    assert.equal((def.modes as readonly string[]).includes('denied'), false, name);
  }
});

/* ================================================================== */
/*  2. Горимын харагдац                                                */
/* ================================================================== */

test('denied горимд хэрэгсэл ХООСОН', () => {
  assert.deepEqual(toolsForMode('denied'), []);
});

test('захиалагчид нууц ERP хэрэгсэл ХАРАГДАХГҮЙ', () => {
  const names = toolsForMode('client').map((t) => t.name);
  assert.equal(names.includes('get_active_employees'), false);
  assert.equal(names.includes('get_overdue_tasks'), false);
  assert.equal(names.includes('get_my_assignments'), false);
  assert.equal(names.includes('search_company_documents'), false);
});

test('захиалагчид норм хайх нь НЭЭЛТТЭЙ', () => {
  assert.ok(toolsForMode('client').some((t) => t.name === 'search_regulations'));
});

test('захиалагчийн бүх хэрэгсэл нь read төрөл', () => {
  for (const t of toolsForMode('client')) assert.equal(t.kind, 'read', t.name);
});

test('админ нь ажилтны бүх хэрэгслийг агуулна', () => {
  const emp = new Set(toolsForMode('employee').map((t) => t.name));
  const adm = new Set(toolsForMode('admin').map((t) => t.name));
  for (const n of emp) assert.ok(adm.has(n), n);
});

/* ================================================================== */
/*  3. Аргументын шалгалт                                              */
/* ================================================================== */

test('танихгүй хэрэгсэл 400', () => {
  const r = validateToolArgs('drop_database', {});
  assert.equal(r.ok, false);
});

test('заавал аргумент дутуу бол алдаа', () => {
  const r = validateToolArgs('get_project_progress', {});
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && r.error.includes('project_id'));
});

test('төрөл буруу бол алдаа', () => {
  const r = validateToolArgs('get_project_progress', { project_id: 'тавь' });
  assert.equal(r.ok, false);
});

test('бүхэл биш тоо нь integer талбарт орохгүй', () => {
  const r = validateToolArgs('get_project_progress', { project_id: 3.7 });
  assert.equal(r.ok, false);
});

test('enum-ээс гадуурх утга хаагдана', () => {
  const bad = validateToolArgs('get_overdue_tasks', { scope: 'everything' });
  assert.equal(bad.ok, false);
  const good = validateToolArgs('get_overdue_tasks', { scope: 'mine' });
  assert.equal(good.ok, true);
});

test('хязгаараас гарсан тоо хаагдана', () => {
  assert.equal(validateToolArgs('list_projects', { limit: 0 }).ok, false);
  assert.equal(validateToolArgs('list_projects', { limit: 9999 }).ok, false);
  assert.equal(validateToolArgs('list_projects', { limit: 10 }).ok, true);
});

test('ЗАГВАРЫН ЗОХИОСОН нэмэлт талбар ЧИМЭЭГҮЙ хаягдана', () => {
  // Загвар ихэвчлэн нэмэлт талбар зохиодог — тэрийг 400 болгох нь
  // ярианы урсгалыг зогсооно, харин талбарыг нэвтрүүлэх нь аюултай.
  const r = validateToolArgs('list_projects', { limit: 5, sql: 'DROP TABLE users' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok === true && r.args, { limit: 5 });
});

test('текст аргумент таслагдана — хязгааргүй prompt орохгүй', () => {
  const r = validateToolArgs('search_regulations', { query: 'а'.repeat(5000) });
  assert.equal(r.ok, true);
  assert.equal(r.ok === true && (r.args.query as string).length, 512);
});

test('null/undefined нь заавал бус талбарт зүгээр', () => {
  const r = validateToolArgs('list_projects', { limit: null, status: undefined });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok === true && r.args, {});
});

test('isKnownTool нь прототипийн талбарт хууртахгүй', () => {
  assert.equal(isKnownTool('list_projects'), true);
  assert.equal(isKnownTool('toString'), false);
  assert.equal(isKnownTool('constructor'), false);
  assert.equal(isKnownTool('__proto__'), false);
});

/* ================================================================== */
/*  4. §35 — амьд өгөгдлийн тэмдэглэгээ                                */
/* ================================================================== */

test('өөрчлөгддөг баримт унших хэрэгсэл нь readsLiveErp тэмдэгтэй', () => {
  for (const n of ['get_active_employees', 'list_projects', 'get_upcoming_deadlines']) {
    assert.equal(TOOLS[n]!.readsLiveErp, true, n);
  }
});

test('ажилтны тоог асуухад хэрэгсэл дуудахыг тайлбар нь ШААРДАНА', () => {
  assert.ok(TOOLS.get_active_employees!.descriptionMn.includes('ЗААВАЛ'));
});

test('нормын хэрэгслийн тайлбар нь дүрэм зохиохыг ХОРИГЛОНО', () => {
  assert.ok(TOOLS.search_regulations!.descriptionMn.includes('ХОРИОТОЙ'));
});

/* ================================================================== */
/*  5. SQL-ИЙН БАГАНЫН ЗОХИОМОЛ НЭР — 2026-09-08-ны регрессийн цоож    */
/* ================================================================== */

test('ERP хэрэгслүүд projects-ийн БАЙХГҮЙ багана заахгүй', async () => {
  // ⚠️ РЕГРЕСС: `getUpcomingDeadlines` нь `SELECT p.finish_date FROM projects p`
  //    гэж бичсэн байсан.  `projects`-д огнооны багана ОГТ БАЙХГҮЙ —
  //    `finish_date` нь `project_passport`-д амьдардаг ба `PROJECT_LIST_SQL`
  //    түүнийг JOIN-оор нэмдэг.  Үр дүн: продакшнд 500.
  //
  //    Энэ тест нь эх кодыг grep-дэж «projects хүснэгтээс шууд огноо
  //    сонгох» хэв маягийг барина.  Хариулт нь ҮРГЭЛЖ `PROJECT_LIST_SQL`
  //    ашиглах — CLAUDE.md: төслийн SQL-ийн 12 дахь хуулбар бүү бич.
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'erp.ts'), 'utf8');

  const code = src
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\/)/.test(l))
    .join('\n');

  // `projects`-д БАЙХГҮЙ болох нь батлагдсан баганууд.
  const phantom = ['p.finish_date', 'p.start_date', 'p.deadline', 'p.end_date'];
  const found = phantom.filter((c) => code.includes(c));
  assert.deepEqual(found, [], `projects-д байхгүй багана заасан: ${found.join(', ')}`);
});
