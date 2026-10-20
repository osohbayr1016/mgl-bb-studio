/**
 * MGL AI · СУДАЛГААНЫ ТӨЛӨВЛӨГЧ — ТЕСТ (§9, §13, §16, §33).
 *
 * Run with:  node --test src/lib/mglai/researchPlan.test.ts
 *
 * Хүлээн авалтын 10 асуултын хэрэгслийн зам + олон шатлалт гогцоо +
 * төсөв.  Загваргүй: зөвхөн «ямар хэрэгсэл, ямар дарааллаар» гэдгийг барина.
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
const { planResearch, discoverEntities, MAX_ROUNDS } = await import('./researchPlan.ts');
const { toolsForMode } = await import('./tools/registry.ts');
const { emptyConvState } = await import('./convState.ts');

const EMP = toolsForMode('employee').map((t) => t.name);
const CLIENT = toolsForMode('client').map((t) => t.name);

type Prior = { tool: string; ok: boolean; data: unknown; args?: Record<string, unknown> };

function step(q: string, opts: { round?: number; prior?: Prior[]; state?: unknown; mode?: 'employee' | 'client' | 'admin'; maxTools?: number } = {}) {
  const mode = opts.mode ?? 'employee';
  const visible = mode === 'client' ? CLIENT : EMP;
  const plan = planTurn({ question: q, rawState: opts.state ?? null, seq: 0, lastAssistant: null, visibleTools: visible });
  return planResearch({ question: q, plan, mode, visibleTools: visible, round: opts.round ?? 0, prior: opts.prior ?? [], maxTools: opts.maxTools });
}
const names = (s: { tools: { name: string }[] }) => s.tools.map((t) => t.name);

const DEADLINE_RESULT: Prior = {
  tool: 'get_upcoming_deadlines',
  ok: true,
  data: { count: 1, projects: [{ id: 32, name: 'MGL-260226_MITIC_AZ', days_remaining: 5 }] },
  args: { days: 60, limit: 10 },
};
const SUBJECT_STATE = {
  ...emptyConvState(),
  subject: { kind: 'project', id: 32, name: 'MGL-260226_MITIC_AZ' },
  subjectSetAtSeq: 0,
  lastIntent: 'COMPANY_FACT',
  lastTools: ['get_upcoming_deadlines'],
  lastQuestion: 'ali tusul hamgiin oir deadline-tei ve',
  lastSeq: 0,
  projectsSeen: [{ id: 32, name: 'MGL-260226_MITIC_AZ' }],
};

test('A. «company huudas yu aguuldg ve» → describe_system (санахуйгаас биш)', () => {
  const s = step('company huudas yu aguuldg ve');
  assert.deepEqual(names(s), ['describe_system']);
  assert.equal(s.depth, 'normal');
});

test('B. «hamgiin idevhtei ajilladag ajiltan hen be» → идэвхийн шинжилгээ, ТОО биш', () => {
  const s = step('manai website d hamgiin idevhtei ajilladag ajiltan hen be');
  assert.ok(names(s).includes('get_employee_activity'), names(s).join());
  assert.ok(!names(s).includes('get_active_employees'), 'ажилтны ТОО энд хэрэггүй');
  assert.ok(!names(s).includes('describe_system'), '«website» гэсэн үг сайтын бүтэц асуусан хэрэг биш');
});

test('C/D/G. тоолол — латин, кирилл, англи гурвуулаа ижил хэрэгсэлд', () => {
  for (const q of ['how many projects we have', 'bidend niit heden tosol baina ve', 'system dotor heden tusul baina', 'Манайд нийт хэдэн төсөл байна?']) {
    const s = step(q);
    assert.ok(names(s).includes('list_projects'), `${q} → ${names(s).join()}`);
    assert.ok(!names(s).includes('describe_system'), `${q}: «system» нь бүтцийн асуулт биш`);
  }
});

test('G дараалалд: сэдэвтэй үргэлжлэл дээрх тоолол нэг төслийн явц БИШ', () => {
  const s = step('system dotor heden tusul baina', { state: SUBJECT_STATE });
  assert.ok(names(s).includes('list_projects'));
  assert.ok(!names(s).includes('get_project_progress'), 'сэдвийн үлдэгдэл');
});

test('E/F. deadline → r0 deadline, «яагаад» гэвэл r1 analyze_project', () => {
  const r0 = step('duusah hugatsaa hamgiin oirhon irsen tosol ali ni ve');
  assert.ok(names(r0).includes('get_upcoming_deadlines'));
  // Шинжилгээгүй асуултад 2-р шат ХЭРЭГГҮЙ.
  const r1 = step('duusah hugatsaa hamgiin oirhon irsen tosol ali ni ve', { round: 1, prior: [DEADLINE_RESULT] });
  assert.equal(r1.done, true);
  assert.deepEqual(names(r1), []);
  // Шинжилгээтэй ганц хариулт → эхний төслийн шинжилгээ.
  const a1 = step('hamgiin oir deadline-tei tusul yagaad udaad bna', { round: 1, prior: [DEADLINE_RESULT] });
  assert.deepEqual(a1.tools, [{ name: 'analyze_project', args: { project_id: 32 } }]);
});

test('H. «ene project yagaad udaad bna» сэдэвтэй → analyze_project, гүн нь analysis', () => {
  const s = step('ene project yagaad udaad bna', { state: SUBJECT_STATE });
  assert.ok(names(s).includes('analyze_project'), names(s).join());
  assert.ok(!names(s).includes('list_projects'), '50 мөрийн жагсаалт хэрэггүй');
  assert.equal(s.depth, 'analysis');
});

test('I/J. нормын асуултад ERP хэрэгсэл ОГТ дуудахгүй', () => {
  for (const q of ['g=1800 MJ/m2 bol V2 yu V3 yu', 'Норм дүрэмд тусгагдаагүй шинэ материал ашиглах бол ямар байгууллагаас зөвшөөрөл авах вэ?']) {
    const s = step(q);
    assert.deepEqual(names(s), [], `${q} → ${names(s).join()}`);
  }
});

test('мэндчилгээ → хэрэгсэлгүй, fast', () => {
  const s = step('Сайн уу');
  assert.deepEqual(names(s), []);
  assert.equal(s.depth, 'fast');
});

test('гүн судалгаа: хоцролт → r0 компани даяар, r1 хамгийн муу ≤3 төслийн шинжилгээ', () => {
  const q = 'Сүүлийн 3 сарын төслүүд яагаад удааширсныг судлаад гол bottleneck-уудыг гарга';
  const r0 = step(q);
  assert.ok(names(r0).includes('get_overdue_tasks'), names(r0).join());
  assert.ok(names(r0).includes('query_entities'));
  assert.equal(r0.depth, 'deep');
  const prior: Prior[] = [
    { tool: 'get_overdue_tasks', ok: true, data: { tasks: [{ project_id: 5 }, { project_id: 5 }, { project_id: 9 }] }, args: { scope: 'all', limit: 50 } },
    { tool: 'query_entities', ok: true, data: { entity: 'projects', rows: [{ id: 5, name: 'A' }, { id: 9, name: 'B' }, { id: 11, name: 'C' }, { id: 12, name: 'D' }] }, args: {} },
  ];
  const r1 = step(q, { round: 1, prior });
  assert.deepEqual(names(r1), ['analyze_project', 'analyze_project']);
  assert.equal((r1.tools[0]!.args as { project_id: number }).project_id, 5, 'хамгийн олон хоцролттой нь эхэнд');
  // Шинжилсэн төслүүдийг дахин шинжлэхгүй.
  const r2 = step(q, { round: 2, prior: [...prior, { tool: 'analyze_project', ok: true, data: {}, args: { project_id: 5 } }, { tool: 'analyze_project', ok: true, data: {}, args: { project_id: 9 } }] });
  assert.equal(r2.done, true);
});

test('каталогийн танилт: түлхүүр үггүй entity асуулт → query_entities', () => {
  const s = step('манай багууд хэн хэн ахлагчтай вэ');
  assert.ok(names(s).includes('query_entities'), names(s).join());
  assert.equal((s.tools.find((t) => t.name === 'query_entities')!.args as { query: { entity: string } }).query.entity, 'teams');
  const e = discoverEntities('хурлын тэмдэглэл хэд байна', 'admin').map((x) => x.name);
  assert.equal(e[0], 'meetings');
  assert.ok(!discoverEntities('хурлын тэмдэглэл', 'employee').some((x) => x.name === 'meetings'), 'ажилтанд хурал харагдахгүй');
});

test('төсөв: maxTools-оос хэтрэхгүй, MAX_ROUNDS = 3', () => {
  assert.equal(MAX_ROUNDS, 3);
  const q = 'Сүүлийн 3 сарын төслүүд яагаад удааширсныг судлаад гол bottleneck-уудыг гарга';
  const s = step(q, { maxTools: 1 });
  assert.equal(s.tools.length, 1);
  const prior: Prior[] = Array.from({ length: 8 }, (_, i) => ({ tool: 'analyze_project', ok: true, data: {}, args: { project_id: i + 1 } }));
  const full = step(q, { round: 1, prior });
  assert.deepEqual(names(full), []);
  assert.equal(full.done, true);
});

test('захиалагч: ажилтны идэвх, систем хэрэгсэл огт төлөвлөгдөхгүй', () => {
  const s = step('manai website d hamgiin idevhtei ajilladag ajiltan hen be', { mode: 'client' });
  assert.ok(!names(s).includes('get_employee_activity'));
  assert.ok(!names(s).includes('get_active_employees'));
});

test('сэдвийн үлдэгдэл: deadline-ийн дараа мэндчилгээ/мета/бие даасан асуулт өмнөх төслийг чирэхгүй', () => {
  for (const q of ['Сайн уу', 'Чи юу хийж чадах вэ', 'BA багийн ажилтнууд хэн хэн бэ', 'сүүлийн 2 сард хэн хамгийн олон явц бүртгүүлсэн бэ']) {
    const s = step(q, { state: SUBJECT_STATE });
    assert.ok(!names(s).includes('get_project_progress'), `${q} → ${names(s).join()}`);
    assert.ok(!names(s).includes('analyze_project'), `${q} → ${names(s).join()}`);
  }
  // Анафоратай бол ҮЛДЭНЭ.
  const keep = step('яагаад удаад байгаа юм бэ', { state: SUBJECT_STATE });
  assert.ok(names(keep).includes('analyze_project') || names(keep).includes('get_project_progress'), names(keep).join());
});

test('каталог: «BA багийн ажилтнууд» → employees + team_code шүүлт; «хэн хамгийн олон явц» → user_name бүлэглэл', () => {
  const a = step('BA багийн ажилтнууд хэн хэн бэ', { state: SUBJECT_STATE });
  const qa = (a.tools.find((t) => t.name === 'query_entities')!.args as { query: { entity: string; filters: { field: string; value: unknown }[] } }).query;
  assert.equal(qa.entity, 'employees');
  assert.ok(qa.filters.some((f) => f.field === 'team_code' && f.value === 'BA'));
  const b = step('сүүлийн 2 сард хэн хамгийн олон явц бүртгүүлсэн бэ');
  const qb = (b.tools.find((t) => t.name === 'query_entities')!.args as { query: { entity: string; group_by?: string; filters: { field: string; value: unknown }[] } }).query;
  assert.equal(qb.entity, 'progress_entries');
  assert.equal(qb.group_by, 'user_name');
  assert.ok(qb.filters.some((f) => f.field === 'date' && f.value === 'today-60'));
});

test('«Хэн хамгийн их хоцордог вэ» → ирцийн хоцролт хүнээр (төслийн хугацаа биш)', () => {
  const s = step('Хэн хамгийн их хоцордог вэ?');
  assert.deepEqual(names(s), ['query_entities']);
  const q = (s.tools[0]!.args as { query: { entity: string; group_by: string } }).query;
  assert.equal(q.entity, 'attendance');
  assert.equal(q.group_by, 'user_name');
});

/**
 * ДАВХАРГЫН ГЭРЭЭ — `toolPlan.ts` (түлхүүр үгийн давхарга, /plan ба /context-ийн
 * хамтын `planTurn`) ба `researchPlan.ts` (судалгааны давхарга) хоёр өөр агент
 * бичсэн.  Зөрөхөөс сэргийлэх дүрэм: r0 нь `planTurn`-ийн хэрэгслийг ХАДГАЛНА,
 * зөвхөн ТАЙЛБАРЛАСАН шалтгаанаар хасна (сэдвийн үлдэгдэл, тоолол, систем, идэвх).
 */
test('давхаргын гэрээ: planTurn-ийн хэрэгсэл r0-д үлдэнэ, хасалт бүр шалтгаантай', () => {
  const visible = EMP;
  for (const q of ['heden ajiltan bna', 'хамгийн ойрхон deadline-тэй төсөл', 'хоцорсон даалгаврууд', 'миний даалгавар юу байна', 'хэний ачаалал өндөр вэ', 'манай систем юу агуулдаг вэ']) {
    const plan = planTurn({ question: q, rawState: null, seq: 0, lastAssistant: null, visibleTools: visible });
    const r0 = planResearch({ question: q, plan, mode: 'employee', visibleTools: visible, round: 0, prior: [] });
    const dropped = plan.tools.map((t) => t.name).filter((n) => !names(r0).includes(n));
    assert.ok(
      dropped.length === 0 || /үлдэгдэл|тоолол|систем|идэвх/.test(r0.reason),
      `${q}: хасагдсан ${dropped.join(',')} — шалтгаангүй (${r0.reason})`,
    );
  }
});

