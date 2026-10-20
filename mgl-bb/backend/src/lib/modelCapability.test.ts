/**
 * node --test src/lib/modelCapability.test.ts
 *
 * ⚠️ `decideCapability` нь ЦЭВЭР (D1-гүй) тул D1 хуурамчлах хэрэггүй.
 *    Гэхдээ `modelCapability.ts` нь `./complianceAuthority`-ыг АЖИЛЛАХ
 *    ҮЕД импортолдог (утга) тул `registerHooks` ЗААВАЛ — өргөтгөлгүй
 *    харьцангуй импорт нь `node --test` доор л унадаг, `tsc` ногоон хэвээр.
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

const {
  decideCapability,
  evalRunApproves,
  grantedLevelOf,
  capsOf,
  MAX_GRANTABLE_AUTHORITY,
  MAX_SCHEMA_AUTHORITY,
} = await import('./modelCapability.ts');

type Row = {
  task: string;
  model_version: string;
  team_scope: string | null;
  evaluation_status: string;
  authority_level: number;
  is_active: number;
};

function row(over: Partial<Row> = {}): Row {
  return {
    task: 'rule_eval',
    model_version: 'v1',
    team_scope: null,
    evaluation_status: 'approved',
    authority_level: 2,
    is_active: 1,
    ...over,
  };
}

test('1 · мөр ОГТ байхгүй → no_row (ХААЛТТАЙ-ӨГӨГДМӨЛ)', () => {
  const v = decideCapability([], 'rule_eval', 'BA', 2);
  assert.deepEqual(v, { ok: false, reason: 'no_row' });
  // ⚠️ Багцгүй баг (MGMT · EZ · GT) нь ЯГ ЭНЭ салаагаар татгалзана —
  //    тусдаа хасах жагсаалт БАЙХГҮЙ.
  assert.deepEqual(
    decideCapability([row({ team_scope: 'BA' })], 'rule_eval', 'MGMT', 0),
    { ok: false, reason: 'no_row' },
  );
  // «Мөр байхгүй» нь LEVEL 0 (OBSERVE) — АЛДАА БИШ, харагдахгүй.
  assert.equal(grantedLevelOf(v), 0);
  assert.equal(capsOf(v).surface, false);
  assert.equal(capsOf(v).collect, true);
});

test('2 · experimental нь түвшин хангасан ч ТАТГАЛЗАНА', () => {
  assert.deepEqual(
    decideCapability(
      [row({ team_scope: 'BA', evaluation_status: 'experimental', authority_level: 2 })],
      'rule_eval',
      'BA',
      2,
    ),
    { ok: false, reason: 'not_approved', status: 'experimental' },
  );
  // `revoked` мөн адил — PATCH-аар цуцлах нь ШУУД хүчинтэй болно.
  assert.deepEqual(
    decideCapability([row({ team_scope: 'BA', evaluation_status: 'revoked' })], 'rule_eval', 'BA', 2),
    { ok: false, reason: 'not_approved', status: 'revoked' },
  );
  // Идэвхгүй мөр нь ӨӨР шалтгаан — «батлагдсан ч унтраасан».
  assert.deepEqual(
    decideCapability([row({ team_scope: 'BA', is_active: 0 })], 'rule_eval', 'BA', 2),
    { ok: false, reason: 'inactive' },
  );
});

test('3 · багийн мөр КОМПАНИЙН мөрийг ДАРНА', () => {
  const rows = [
    row({ team_scope: null, authority_level: 2 }),
    row({ team_scope: 'BA', authority_level: 0 }),
  ];
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2), {
    ok: false,
    reason: 'level_too_low',
    granted: 0,
  });
  // ⚠️ Дараалал ХАМААРАХГҮЙ — SQL нь ORDER BY-гүй тул шийдэгч нь ЖАГСААЛТЫН
  //    БАЙРЛАЛААС ХАРААТ БАЙЖ БОЛОХГҮЙ.
  assert.deepEqual(decideCapability([...rows].reverse(), 'rule_eval', 'BA', 2), {
    ok: false,
    reason: 'level_too_low',
    granted: 0,
  });
  // Тэр ЖЕ өгөгдөл дээр КОМПАНИЙН хүсэлт (team = null) нь компанийн мөрийг л харна.
  assert.deepEqual(decideCapability(rows, 'rule_eval', null, 2), { ok: true, granted: 2 });
});

test('4 · approved + is_active + level >= need → ok', () => {
  assert.deepEqual(
    decideCapability([row({ team_scope: 'BA', authority_level: 2 })], 'rule_eval', 'BA', 2),
    { ok: true, granted: 2 },
  );
  // ӨӨР даалгавар нь ХЭЗЭЭ Ч таарахгүй — §79-ийн кардинал.
  assert.deepEqual(
    decideCapability([row({ task: 'intent_routing', team_scope: 'BA' })], 'rule_eval', 'BA', 0),
    { ok: false, reason: 'no_row' },
  );
  assert.equal(capsOf({ ok: true, granted: 2 }).recommend, true);
  assert.equal(capsOf({ ok: true, granted: 2 }).write, false);
});

test('5 · MVP-ийн эрхийн тааз нь схемийн хязгаараас ДООГУУР', () => {
  assert.equal(MAX_GRANTABLE_AUTHORITY, 2);
  assert.equal(MAX_SCHEMA_AUTHORITY, 5);
  assert.ok(MAX_GRANTABLE_AUTHORITY < MAX_SCHEMA_AUTHORITY);
});

test('6 · evalRunApproves — ГУРВАН нөхцөл', () => {
  assert.deepEqual(evalRunApproves(null, '1.0'), { ok: false, reason: 'missing' });
  assert.deepEqual(evalRunApproves({ passed: false, blocked: [], model_version: '1.0' }, '1.0'), {
    ok: false,
    reason: 'not_passed',
  });
  assert.deepEqual(
    evalRunApproves({ passed: true, blocked: ['rules'], model_version: '1.0' }, '1.0'),
    { ok: false, reason: 'blocked' },
  );
  assert.deepEqual(
    evalRunApproves({ passed: true, blocked: [], model_version: '0.9' }, '1.0'),
    { ok: false, reason: 'version_mismatch' },
  );
  assert.deepEqual(
    evalRunApproves({ passed: true, blocked: [], model_version: '1.0' }, '1.0'),
    { ok: true },
  );
});

/* ==================================================================
 * F6 · ХУВИЛБАРЫН ШАТ — «дарагдсан хувилбар эрхээ АВЧ ҮЛДЭХГҮЙ».
 * 0239-д `(task, model_version, team_scope)` дээр өвөрмөц индекс БАЙХГҮЙ
 * тул доорх бүх багц мөр DB дээр ХУУЛЬ ЁСООР зэрэг оршино.
 * ================================================================== */

test('7 · ХОЁР ХУВИЛБАР зэрэг — АМЬД загварын мөр ЯЛНА', () => {
  const rows = [
    row({ team_scope: 'BA', model_version: 'v1', evaluation_status: 'approved', authority_level: 2 }),
    row({ team_scope: 'BA', model_version: 'v2', evaluation_status: 'untested', authority_level: 0 }),
  ];

  // Амьд нь v2 → шинэ хувилбар ХАРААХАН тэнцээгүй тул ТАТГАЛЗАНА.
  // ⚠️ Хуучин код v1-ийг сонгоод LEVEL 2 олгодог байсан — эрхийн тогтмолжилт.
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2, 'v2'), {
    ok: false,
    reason: 'not_approved',
    status: 'untested',
  });
  // Амьд нь v1 → ажиллаж байгаа загварын батлагдсан эрх ХҮЧИНТЭЙ.
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2, 'v1'), { ok: true, granted: 2 });

  // Идэвхтэй загвар ОГТ алга (эсвэл багана нь `ruleset_version`) →
  // ХУВИЛБАР-СОХОР, ХААЛТТАЙ-ӨГӨГДМӨЛ: хамгийн ХАТУУ мөр ялна.
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2), {
    ok: false,
    reason: 'not_approved',
    status: 'untested',
  });

  // ⚠️ ГУРВУУЛАА ДАРААЛЛААС ХАРААТ БУС — SQL-ийн буцаах дараалал ХАМААРАХГҮЙ.
  const rev = [...rows].reverse();
  assert.deepEqual(decideCapability(rev, 'rule_eval', 'BA', 2, 'v2'), {
    ok: false,
    reason: 'not_approved',
    status: 'untested',
  });
  assert.deepEqual(decideCapability(rev, 'rule_eval', 'BA', 2, 'v1'), { ok: true, granted: 2 });
  assert.deepEqual(decideCapability(rev, 'rule_eval', 'BA', 2), {
    ok: false,
    reason: 'not_approved',
    status: 'untested',
  });
});

test('8 · ЦУЦЛАГДСАН мөрийг ӨӨР ХУВИЛБАРААР ТОЙРОХ ЗАМ БАЙХГҮЙ', () => {
  const rows = [
    row({ team_scope: 'BA', model_version: 'v1', evaluation_status: 'revoked', authority_level: 2 }),
    row({ team_scope: 'BA', model_version: 'v2', evaluation_status: 'approved', authority_level: 2 }),
  ];

  // Хувилбар-сохор үед `revoked` нь `approved`-оос ХАТУУ тул ТЭР ялна.
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2), {
    ok: false,
    reason: 'not_approved',
    status: 'revoked',
  });
  assert.deepEqual(decideCapability([...rows].reverse(), 'rule_eval', 'BA', 2), {
    ok: false,
    reason: 'not_approved',
    status: 'revoked',
  });
  // Цуцлагдсан хувилбар нь АМЬД байсан ч мэдээж ТАТГАЛЗАНА.
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2, 'v1'), {
    ok: false,
    reason: 'not_approved',
    status: 'revoked',
  });
  // ГАРЦ 1: шинэ хувилбарыг ИДЭВХЖҮҮЛЭХ — ИЛ, аудитлагдах үйлдэл.
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2, 'v2'), { ok: true, granted: 2 });
  // ГАРЦ 2: цуцлагдсан мөрийг УНТРААХ — амьд мөр байвал унтраасныг ХАЯНА.
  const retired = [
    row({ team_scope: 'BA', model_version: 'v1', evaluation_status: 'revoked', is_active: 0 }),
    row({ team_scope: 'BA', model_version: 'v2', evaluation_status: 'approved', authority_level: 2 }),
  ];
  assert.deepEqual(decideCapability(retired, 'rule_eval', 'BA', 2), { ok: true, granted: 2 });
  assert.deepEqual(decideCapability([...retired].reverse(), 'rule_eval', 'BA', 2), {
    ok: true,
    granted: 2,
  });
  // ⚠️ ГЭХДЭЭ БҮГД унтраасан бол `inactive` гэсэн НЭРЛЭСЭН шалтгаан ҮЛДЭНЭ.
  assert.deepEqual(
    decideCapability(
      [
        row({ team_scope: 'BA', model_version: 'v1', is_active: 0 }),
        row({ team_scope: 'BA', model_version: 'v2', is_active: 0 }),
      ],
      'rule_eval',
      'BA',
      2,
    ),
    { ok: false, reason: 'inactive' },
  );
  // ⚠️ CHECK-ийг тойрсон ТОДОРХОЙГҮЙ статус нь `revoked`-оос ч ХАТУУ.
  assert.deepEqual(
    decideCapability(
      [
        row({ team_scope: 'BA', model_version: 'v1', evaluation_status: 'sneaky' }),
        row({ team_scope: 'BA', model_version: 'v2', evaluation_status: 'approved' }),
      ],
      'rule_eval',
      'BA',
      2,
    ),
    { ok: false, reason: 'not_approved', status: 'sneaky' },
  );
});

test('9 · ХАМРАХ ХҮРЭЭ нь ХУВИЛБАРААС ӨМНӨ — компанийн мөр багийн таазыг өргөхгүй', () => {
  const rows = [
    // Компанийн мөр нь ЯГ амьд хувилбар дээр, LEVEL 2.
    row({ team_scope: null, model_version: 'v2', authority_level: 2 }),
    // BA-д ЗОРИУД LEVEL 0, хуучин хувилбар дээр.
    row({ team_scope: 'BA', model_version: 'v1', authority_level: 0 }),
  ];
  // ⚠️ BA шат ЭХЭЛЖ шүүгдэнэ; тэр шатанд амьд хувилбарын мөр БАЙХГҮЙ тул
  //    хувилбар-сохор болно — компанийн мөр рүү БУЦАЖ УНАХГҮЙ.
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2, 'v2'), {
    ok: false,
    reason: 'level_too_low',
    granted: 0,
  });
  assert.deepEqual(decideCapability([...rows].reverse(), 'rule_eval', 'BA', 2, 'v2'), {
    ok: false,
    reason: 'level_too_low',
    granted: 0,
  });
  // Компанийн хүсэлт (team = null) нь компанийн мөрөө л харна.
  assert.deepEqual(decideCapability(rows, 'rule_eval', null, 2, 'v2'), { ok: true, granted: 2 });
  // Компанийн шатанд ХОЁР хувилбар байвал тэнд ч амьд нь ялна.
  const company = [
    row({ team_scope: null, model_version: 'v1', authority_level: 2 }),
    row({ team_scope: null, model_version: 'v2', evaluation_status: 'revoked', authority_level: 2 }),
  ];
  assert.deepEqual(decideCapability(company, 'rule_eval', null, 2, 'v1'), { ok: true, granted: 2 });
  assert.deepEqual(decideCapability(company, 'rule_eval', null, 2, 'v2'), {
    ok: false,
    reason: 'not_approved',
    status: 'revoked',
  });
});

test('10 · ХУВИЛБАР-СОХОР үед ХАМГИЙН ДООД ЭРХ ялна', () => {
  // Хоёулаа батлагдсан, зөвхөн түвшин нь ялгаатай → доод нь ялна.
  const rows = [
    row({ team_scope: 'BA', model_version: 'v1', authority_level: 2 }),
    row({ team_scope: 'BA', model_version: 'v2', authority_level: 1 }),
  ];
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2), {
    ok: false,
    reason: 'level_too_low',
    granted: 1,
  });
  assert.deepEqual(decideCapability([...rows].reverse(), 'rule_eval', 'BA', 2), {
    ok: false,
    reason: 'level_too_low',
    granted: 1,
  });
  // Амьд хувилбар нэрлэгдвэл ТЭР л хүчинтэй — доод эрх рүү унахгүй.
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2, 'v1'), { ok: true, granted: 2 });
  // Амьд хувилбар бүртгэлд ОГТ байхгүй (ж: v9) → хувилбар-сохор хэвээр.
  assert.deepEqual(decideCapability(rows, 'rule_eval', 'BA', 2, 'v9'), {
    ok: false,
    reason: 'level_too_low',
    granted: 1,
  });
});
