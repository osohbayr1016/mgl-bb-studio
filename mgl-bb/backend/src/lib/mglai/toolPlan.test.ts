/**
 * MGL AI · ХЭРЭГСЛИЙН ТӨЛӨВЛӨГӨӨ — ТЕСТ.
 *
 * Run with:  node --test src/lib/mglai/toolPlan.test.ts
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ: энэ дүрэм нь frontend-ээс СЕРВЕР РҮҮ
 *    нүүсэн (§15-ийн зэрэгцүүлэлт).  Нүүлгэх үед зан төлөв өөрчлөгдсөн
 *    эсэхийг барих нь тестийн гол зорилго — хуучин `runObviousTools`-ийн
 *    таних үгс ЯГ хэвээр байх ёстой.
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

const { planTools } = await import('./toolPlan.ts');

const ALL = [
  'get_active_employees',
  'list_projects',
  'get_upcoming_deadlines',
  'get_overdue_tasks',
  'get_my_assignments',
];

test('ажилтны тоо → get_active_employees', () => {
  assert.deepEqual(
    planTools('манай компани хэдэн ажилтантай вэ', ALL).map((t) => t.name),
    ['get_active_employees'],
  );
});

test('латин монгол ч танигдана (§9)', () => {
  const names = planTools('manai company heden ajiltantai ve', ALL).map((t) => t.name);
  assert.ok(names.includes('get_active_employees'), 'ajiltan танигдсангүй');
});

test('deadline асуулт → төсөл + хугацаа ХОЁУЛАА', () => {
  const names = planTools('аль төсөл хамгийн ойрхон deadline-тэй вэ', ALL).map((t) => t.name);
  assert.deepEqual(names, ['list_projects', 'get_upcoming_deadlines']);
});

test('мэндчилгээнд хэрэгсэл ОГТ дуудахгүй', () => {
  assert.deepEqual(planTools('сайн байна уу', ALL), []);
});

test('нормын асуултад ERP хэрэгсэл дуудахгүй', () => {
  assert.deepEqual(
    planTools(
      'Монгол Улсад мөрдөж буй барилгын норм, дүрэмд тусгагдаагүй шинэ материал ашиглах бол ямар байгууллагаас зөвшөөрөл авах вэ?',
      ALL,
    ),
    [],
  );
});

test('ГОРИМД ХАРАГДАХГҮЙ хэрэгслийг төлөвлөхгүй (захиалагч)', () => {
  assert.deepEqual(planTools('манай төслүүд юу вэ', []), []);
});

test('давхардсан нэр НЭГ Л удаа орно', () => {
  const names = planTools('төсөл project обьект', ALL).map((t) => t.name);
  assert.deepEqual(names, ['list_projects']);
});

test('дөрвөөс олон хэрэгсэл төлөвлөхгүй', () => {
  const names = planTools(
    'ажилтан төсөл deadline хугацаа хоцорсон миний даалгавар юу вэ',
    ALL,
  );
  assert.ok(names.length <= 4, `${names.length} хэрэгсэл төлөвлөв`);
});

test('аргументууд хуучин зан төлөвтэй ЯГ таарна', () => {
  const plan = planTools('төсөл deadline хоцорсон миний даалгавар', ALL);
  const byName = Object.fromEntries(plan.map((p) => [p.name, p.args]));
  assert.deepEqual(byName.list_projects, { limit: 50 });
  assert.deepEqual(byName.get_upcoming_deadlines, { days: 60, limit: 10 });
  assert.deepEqual(byName.get_overdue_tasks, { limit: 20 });
});
