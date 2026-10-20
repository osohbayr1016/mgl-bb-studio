/**
 * MGL AI · REVIT ЭРХИЙН ШАТ — ТЕСТ (§46-ийн «Revit safety tests»).
 *
 * Run with:  node --test src/lib/mglai/permissions.test.ts
 *
 * ⚠️ ГОЛ АМЛАЛТ: «No unconfirmed writes under required permission
 *    profiles.»  Доорх «баталгаагүй бичилт» блок нь тэрийг барина.
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

const { decideTool, profileFromRow, DEFAULT_PROFILE, REVIT_LEVELS, profileExpired, isRevitLevel } =
  await import('./permissions.ts');

type Profile = typeof DEFAULT_PROFILE;

function prof(over: Partial<Profile> = {}): Profile {
  return { ...DEFAULT_PROFILE, projectScope: [], ...over };
}

/* ================================================================== */
/*  1. «Мөр байхгүй = READ_ONLY» — хамгийн чухал өгөгдмөл              */
/* ================================================================== */

test('мөр БАЙХГҮЙ бол READ_ONLY, «хязгааргүй» БИШ', () => {
  const p = profileFromRow(null);
  assert.equal(p.revitLevel, 'READ_ONLY');
  assert.equal(p.erpWriteEnabled, false);
  assert.equal(p.roslynEnabled, false);
});

test('undefined мөр ч READ_ONLY', () => {
  assert.equal(profileFromRow(undefined).revitLevel, 'READ_ONLY');
});

test('ТАНИХГҮЙ түвшин нь READ_ONLY рүү унана', () => {
  const p = profileFromRow({ revit_level: 'GOD_MODE' });
  assert.equal(p.revitLevel, 'READ_ONLY');
});

test('эвдэрсэн project_scope JSON нь «хязгааргүй» ОЛГОХГҮЙ', () => {
  const p = profileFromRow({ revit_level: 'SAFE_WRITE', project_scope_json: '{ буруу' });
  assert.deepEqual(p.projectScope, []);
});

/* ================================================================== */
/*  2. Баталгаагүй бичилт                                              */
/* ================================================================== */

test('READ_ONLY нь бичих хэрэгсэлд ХҮРЭХГҮЙ', () => {
  const d = decideTool({ mode: 'employee', profile: prof(), toolKind: 'write', known: true });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'level_too_low');
});

test('SAFE_WRITE нь бичихийг зөвшөөрнө ГЭХДЭЭ БАТАЛГААЖУУЛАЛТТАЙ', () => {
  const d = decideTool({
    mode: 'employee',
    profile: prof({ revitLevel: 'SAFE_WRITE' }),
    toolKind: 'write',
    known: true,
  });
  assert.equal(d.allow, true);
  assert.equal(d.requiresConfirmation, true);
});

test('CONFIRM_EVERY_WRITE нь БҮХ бичилтэд баталгаа шаардана', () => {
  const d = decideTool({
    mode: 'employee',
    profile: prof({ revitLevel: 'CONFIRM_EVERY_WRITE' }),
    toolKind: 'write',
    known: true,
  });
  assert.equal(d.allow, true);
  assert.equal(d.requiresConfirmation, true);
});

test('PROJECT_ADMIN ч баталгаагүй бичихгүй', () => {
  const d = decideTool({
    mode: 'employee',
    profile: prof({ revitLevel: 'PROJECT_ADMIN' }),
    toolKind: 'write',
    known: true,
  });
  assert.equal(d.requiresConfirmation, true);
});

test('ЗӨВХӨН FULL_AGENT нь автомат бичилт хийнэ', () => {
  const d = decideTool({
    mode: 'employee',
    profile: prof({ revitLevel: 'FULL_AGENT' }),
    toolKind: 'write',
    known: true,
  });
  assert.equal(d.allow, true);
  assert.equal(d.requiresConfirmation, false);
});

test('уншилт ба харагдац нь ХЭЗЭЭ Ч баталгаа шаардахгүй', () => {
  for (const kind of ['read', 'view'] as const) {
    const d = decideTool({ mode: 'employee', profile: prof(), toolKind: kind, known: true });
    assert.equal(d.allow, true, kind);
    assert.equal(d.requiresConfirmation, false, kind);
  }
});

test('admin төрлийн хэрэгсэл нь PROJECT_ADMIN-аас доош хаагдана', () => {
  for (const level of ['READ_ONLY', 'SAFE_WRITE', 'CONFIRM_EVERY_WRITE'] as const) {
    const d = decideTool({
      mode: 'employee',
      profile: prof({ revitLevel: level }),
      toolKind: 'admin',
      known: true,
    });
    assert.equal(d.allow, false, level);
  }
});

/* ================================================================== */
/*  3. Roslyn — шатнаас ГАДУУР                                         */
/* ================================================================== */

test('FULL_AGENT ч Roslyn-ыг тугтгүйгээр ажиллуулахгүй', () => {
  const d = decideTool({
    mode: 'admin',
    profile: prof({ revitLevel: 'FULL_AGENT', roslynEnabled: false }),
    toolKind: 'admin',
    known: true,
    isRoslyn: true,
  });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'roslyn_disabled');
});

test('ERP бичилт нь тусдаа туг шаардана', () => {
  const d = decideTool({
    mode: 'employee',
    profile: prof({ revitLevel: 'FULL_AGENT', erpWriteEnabled: false }),
    toolKind: 'write',
    known: true,
    isErpWrite: true,
  });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'erp_write_disabled');
});

/* ================================================================== */
/*  4. Горим                                                           */
/* ================================================================== */

test('ЗАХИАЛАГЧ нь ЗӨВХӨН уншина, профайлаас үл хамааран', () => {
  const rich = prof({ revitLevel: 'FULL_AGENT', erpWriteEnabled: true, roslynEnabled: true });
  assert.equal(decideTool({ mode: 'client', profile: rich, toolKind: 'read', known: true }).allow, true);
  for (const kind of ['view', 'write', 'admin'] as const) {
    const d = decideTool({ mode: 'client', profile: rich, toolKind: kind, known: true });
    assert.equal(d.allow, false, kind);
    assert.equal(d.reason, 'client_mode', kind);
  }
});

test('denied горимд юу ч зөвшөөрөгдөхгүй', () => {
  const d = decideTool({ mode: 'denied', profile: prof(), toolKind: 'read', known: true });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'denied_mode');
});

test('ТАНИХГҮЙ хэрэгсэл нь ЭХЛЭЭД хаагдана — оршин байгааг задруулахгүй', () => {
  // client горимд ч `unknown_tool` гэж хариулна, `client_mode` гэж биш.
  const d = decideTool({ mode: 'client', profile: prof(), toolKind: 'read', known: false });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'unknown_tool');
});

/* ================================================================== */
/*  5. Төслийн хамрах хүрээ                                            */
/* ================================================================== */

test('хамрах хүрээнээс гадуурх төсөл хаагдана', () => {
  const p = prof({ revitLevel: 'FULL_AGENT', projectScope: [30, 31] });
  assert.equal(
    decideTool({ mode: 'employee', profile: p, toolKind: 'write', known: true, projectId: 99 }).allow,
    false,
  );
  assert.equal(
    decideTool({ mode: 'employee', profile: p, toolKind: 'write', known: true, projectId: 30 }).allow,
    true,
  );
});

test('ХООСОН хамрах хүрээ нь хязгаарлахгүй', () => {
  const p = prof({ revitLevel: 'FULL_AGENT', projectScope: [] });
  assert.equal(
    decideTool({ mode: 'employee', profile: p, toolKind: 'write', known: true, projectId: 99 }).allow,
    true,
  );
});

/* ================================================================== */
/*  6. Туслахууд                                                        */
/* ================================================================== */

test('түвшний дараалал нь эрхийн өсөлтөөр', () => {
  assert.deepEqual(
    [...REVIT_LEVELS],
    ['READ_ONLY', 'SAFE_WRITE', 'CONFIRM_EVERY_WRITE', 'PROJECT_ADMIN', 'FULL_AGENT'],
  );
});

test('isRevitLevel нь хаалттай', () => {
  assert.equal(isRevitLevel('FULL_AGENT'), true);
  assert.equal(isRevitLevel('full_agent'), false);
  assert.equal(isRevitLevel(3), false);
});

test('хугацаа дууссан профайл илэрнэ', () => {
  assert.equal(profileExpired('2026-01-01T00:00:00Z', '2026-09-08T00:00:00Z'), true);
  assert.equal(profileExpired('2027-01-01T00:00:00Z', '2026-09-08T00:00:00Z'), false);
  assert.equal(profileExpired(null, '2026-09-08T00:00:00Z'), false);
});

test('max_tool_iterations нь эрүүл хязгаарт барина', () => {
  assert.equal(profileFromRow({ max_tool_iterations: 999 }).maxToolIterations, 8);
  assert.equal(profileFromRow({ max_tool_iterations: 0 }).maxToolIterations, 8);
  assert.equal(profileFromRow({ max_tool_iterations: 12 }).maxToolIterations, 12);
});
