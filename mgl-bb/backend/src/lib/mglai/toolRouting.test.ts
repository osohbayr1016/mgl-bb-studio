/**
 * MGL AI · ХЭРЭГСЛИЙН ЧИГЛҮҮЛЭЛТ — ХҮСНЭГТЭН ТЕСТ (§32, §89).
 *
 * Run with:  node --test src/lib/mglai/toolRouting.test.ts
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ — дөрвөн төрлийн алдаа:
 *   БУРУУ хэрэгсэл   — «В2 галын ачаалал» → get_active_employees (хэмжигдсэн)
 *   ДУТУУ хэрэгсэл   — «яагаад удаад байна» → юу ч дуудахгүй (хэмжигдсэн)
 *   ИЛҮҮ хэрэгсэл    — мэндчилгээнд ERP дуудах
 *   ГОГЦОО           — нэг ээлжид 4-өөс олон хэрэгсэл
 * Хүснэгт нь `planTurn` (тайлал + төлөвлөгөө хамтдаа) дээр ажиллана,
 * учир нь бодит зам яг тэр.
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

const { planTurn } = await import('./turnPlan.ts');
const { TOOLS, toolsForMode } = await import('./tools/registry.ts');
const { emptyConvState } = await import('./convState.ts');

const EMPLOYEE_TOOLS = toolsForMode('employee').map((t) => t.name);
const CLIENT_TOOLS = toolsForMode('client').map((t) => t.name);

// ⚠️ Шинжилгээний хэрэгслүүд (`analyze_project`, `get_employee_activity`,
//    `describe_system`) нь тусдаа ажлаар бүртгэлд орж байгаа.  Байхгүй үед
//    төлөвлөгч `get_project_progress` руу унана — тест хоёуланг нь зөвшөөрнө,
//    гэхдээ БУРУУ хэрэгсэл гарахыг хэвээр барина.
const HAS_ANALYTICS = EMPLOYEE_TOOLS.includes('analyze_project');
const ANALYZE = HAS_ANALYTICS ? 'analyze_project' : 'get_project_progress';
const ACTIVITY = EMPLOYEE_TOOLS.includes('get_employee_activity') ? ['get_employee_activity'] : [];
const DESCRIBE = EMPLOYEE_TOOLS.includes('describe_system') ? ['describe_system'] : [];

const A_STATE = {
  ...emptyConvState(),
  subject: { kind: 'project', id: 51, name: 'Project A' },
  subjectSetAtSeq: 0,
  lastIntent: 'COMPANY_FACT',
  lastTools: ['get_upcoming_deadlines'],
  lastQuestion: 'Project A deadline hezee ve?',
  lastSeq: 0,
  projectsSeen: [{ id: 51, name: 'Project A' }],
};

/** [асуулт, ЗААВАЛ дуудах, ДУУДАЖ БОЛОХГҮЙ, төлөв?] */
const TABLE: [string, string[], string[], Record<string, unknown>?][] = [
  // ERP → ERP
  ['manai company heden ajiltantai ve', ['get_active_employees'], ['get_employee_activity', 'list_projects']],
  ['Манай компанид хэдэн ажилтан ажилладаг вэ', ['get_active_employees'], []],
  ['хэдэн төсөл идэвхтэй байна', ['list_projects'], ['get_active_employees']],
  ['ali project hamgiin oir deadline-tei ve', ['get_upcoming_deadlines'], ['get_employee_activity']],
  ['аль төсөл хоцорч байна', ['get_overdue_tasks'], ['get_employee_activity']],
  ['хэний ачаалал хамгийн өндөр байна', ACTIVITY, ['get_active_employees']],
  ['хэн юу хийж байна', ACTIVITY, []],
  ['миний даалгавар юу байна', ['get_my_assignments'], ['list_projects']],
  ['манай систем ямар хуудастай вэ', DESCRIBE, []],
  // Үргэлжлэл → шинжилгээ
  ['yagaad udaad bgaan?', [ANALYZE], ['list_projects', 'get_active_employees'], A_STATE],
  ['энэ төсөл яагаад хоцорч байна', [ANALYZE], ['list_projects'], A_STATE],
  // Норм → ERP ОГТ ҮГҮЙ (буруу хэрэгслийн хамгийн түгээмэл алдаа)
  ['В2 ангиллын галын ачаалал хэдээс хэд вэ', [], EMPLOYEE_TOOLS],
  ['g=1800 MJ/m2 bol V2 yu V3 yu', [], EMPLOYEE_TOOLS],
  ['300 м2 агуулахад ГУАТ хэрэгтэй юу', [], EMPLOYEE_TOOLS],
  ['Монгол Улсад мөрдөж буй барилгын норм, дүрэмд тусгагдаагүй шинэ материал ашиглах бол ямар байгууллагаас зөвшөөрөл авах вэ', [], EMPLOYEE_TOOLS],
  // Ерөнхий / мэндчилгээ / мета → ИЛҮҮ хэрэгсэл ҮГҮЙ
  ['сайн уу', [], EMPLOYEE_TOOLS],
  ['chi ymar asuultand hariulj chadah ve', [], EMPLOYEE_TOOLS],
  ['баярлалаа', [], EMPLOYEE_TOOLS],
  // Тооцоо → детерминист, ERP биш
  ['12 x 8 метр өрөөний талбайг тооц', [], EMPLOYEE_TOOLS],
  // Revit → ERP биш
  ['Revit deer ene wall-iin area hed ve', [], EMPLOYEE_TOOLS],
  // Олон санаа → зөвхөн ERP хэсгээс
  ['Манай компанид хэдэн идэвхтэй төсөл байгаа вэ? Бас В2 ангиллын галын ачаалал хэдээс хэд вэ?', ['list_projects'], ['get_active_employees', 'get_employee_activity']],
];

for (const [q, must, mustNot, state] of TABLE) {
  test(`чиглүүлэлт · «${q.slice(0, 60)}»`, () => {
    const p = planTurn({ question: q, rawState: state ?? null, seq: state ? 2 : 0, visibleTools: EMPLOYEE_TOOLS });
    const names = p.tools.map((t) => t.name);
    for (const m of must) assert.ok(names.includes(m), `ДУТУУ: ${m} (олдсон: ${names.join(',') || '—'})`);
    for (const m of mustNot) assert.ok(!names.includes(m), `ИЛҮҮ/БУРУУ: ${m} (олдсон: ${names.join(',')})`);
    assert.ok(names.length <= 4, 'гогцоо: 4-өөс олон хэрэгсэл');
    assert.equal(new Set(names).size, names.length, 'давхардсан хэрэгсэл');
  });
}

test('чиглүүлэлт · бүх төлөвлөсөн хэрэгсэл бүртгэлд байна, аргумент нь схемд нийцнэ', async () => {
  const { validateToolArgs } = await import('./tools/registry.ts');
  for (const [q, , , state] of TABLE) {
    const p = planTurn({ question: q, rawState: state ?? null, seq: state ? 2 : 0, visibleTools: EMPLOYEE_TOOLS });
    for (const t of p.tools) {
      assert.ok(TOOLS[t.name], `бүртгэлгүй: ${t.name}`);
      const v = validateToolArgs(t.name, t.args);
      assert.ok(v.ok, `${t.name} аргумент буруу: ${v.ok ? '' : v.error}`);
    }
  }
});

test('чиглүүлэлт · захиалагчид ERP хэрэгсэл ТӨЛӨВЛӨГДӨХГҮЙ', () => {
  const p = planTurn({ question: 'манай компанид хэдэн ажилтан байна', rawState: null, seq: 0, visibleTools: CLIENT_TOOLS });
  assert.ok(!p.tools.some((t) => t.name === 'get_active_employees'));
  assert.ok(!p.tools.some((t) => t.name === 'get_employee_activity'));
});

test('чиглүүлэлт · «галын ачаалал» нь ажилтны ачаалал БИШ (холимог ERP асуултад ч)', async () => {
  const { planTools } = await import('./toolPlan.ts');
  const names = planTools('төслийн галын ачааллын тооцоог хэн хийж байна', EMPLOYEE_TOOLS).map((t) => t.name);
  assert.ok(!names.includes('get_employee_activity'), names.join(','));
});
