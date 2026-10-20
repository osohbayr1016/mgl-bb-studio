/**
 * БАГЦЫН УТСАН ХЭЛБЭРИЙН ТЕСТ — `rulePack.ts:ruleDefToWire`-ийн ХОЁР СЕАМ.
 *
 * Run with:  node --test src/lib/rulePackWire.test.ts
 *
 * ⚠️ ЭНЭ ФАЙЛ ХОЁР УНАЛТЫГ БАРЬДАГ, хоёулаа СЕРВЕР→КЛИЕНТИЙН ЗААГ дээр:
 *
 *   1. `exceptions[].when` нь УТСАН ДЭЭР ГАРААГҮЙ.  Дүрэм `{code:'atrium',
 *      when:{...}}`-ыг нийтэлж чаддаг байсан ч инженерийн компьютер дээр
 *      `RuleException.When == null` болж, `RuleEngine.cs` түүнийг АЛГАСААД
 *      (fail-open) атриум бүрийг ЗӨРЧИЛ гэж мэдээлдэг байв.  ЧИМЭЭГҮЙ:
 *      задлах алдаа гардаггүй.
 *
 *   2. `UNVERIFIED` дүрэм нь `document_uid` / `clause_uid` / `edition_ref`-ээ
 *      утсан дээр гаргадаг байв.  Эзний шийдвэр: UNVERIFIED нь ЭШЛЭЛИЙГ
 *      дарна, зөвхөн ноцтой байдлыг БИШ.
 *
 * ⚠️ `registerHooks` — `src/lib/*.ts` нь өргөтгөлгүй харьцангуй импорт
 *    хэрэглэдэг тул `node --test` дор шууд `import` УНАНА (tsc ногоон хэвээр).
 *    `bimEvents.test.ts` / `ruleApplicability.test.ts`-ийн ЯГ ИЖИЛ хэв маяг.
 *
 * ⚠️ ЭНД БАЙГАА ДҮРЭМ НЬ БҮТЭЦИЙН FIXTURE, ДҮРМИЙН КОРПУС БИШ (эзний
 *    шийдвэр Ш4) — `rules` хүснэгтэд, `rulepack-canary.json`-д ОРООГҮЙ.
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

const M = await import('./complianceModel.ts');
const A = await import('./ruleApplicability.ts');
const P = await import('./rulePack.ts');

type RuleDbRow = import('./rulePack.ts').RuleDbRow;
type RuleDef = import('./complianceModel.ts').RuleDef;

/* ================================================================== */
/*  0. FIXTURE — «таазны өндөр, атриум нь үл хамаарна»                 */
/* ================================================================== */

/** ⚠️ needle нь АЛЬ ХЭДИЙН хураагдсан байх ЁСТОЙ (V6). */
const ATRIUM_WHEN = { 'element.name_folded': { contains_any: ['atrium'] } };
const CEIL_APPLICABILITY = { 'element.category': { eq: 'Ceilings' } };
const CEIL_CHECK = { 'element.ceiling_h_mm': { gte: 2500 } };

function ceilingRow(over: Partial<RuleDbRow> = {}): RuleDbRow {
  return {
    id: 7,
    rule_uid: 'BA-CEIL-H-002',
    version: 1,
    semantic_hash: 'c'.repeat(64),
    team_code: 'BA',
    title_mn: 'Таазны цэвэр өндөр',
    title_en: 'Ceiling clear height',
    document_uid: 'BNBD-31-03',
    clause_uid: '4.2',
    edition_ref: '2021',
    effective_from: '2026-01-01',
    verification_state: 'UNVERIFIED',
    issue_class: 'REGULATORY_VIOLATION',
    severity: 'HIGH',
    unit: 'MM',
    coordinate_system: 'none',
    expect_applicable: 1,
    requires_context_json: '[]',
    applicability_json: JSON.stringify(CEIL_APPLICABILITY),
    check_json: JSON.stringify(CEIL_CHECK),
    requires_params_json: JSON.stringify(['name_folded', 'ceiling_h_mm']),
    requires_triggered_json: JSON.stringify([{ category: 'Ceilings', change: 'modify' }]),
    exceptions_json: JSON.stringify([
      { code: 'atrium', when: ATRIUM_WHEN, note_mn: 'Атриумын таазанд хамаарахгүй.' },
    ]),
    recommendation_mn: 'Таазны өндрийг 2500 мм хүртэл нэмэгдүүлнэ.',
    status: 'published',
    authored_by: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-08-31T00:00:00Z',
    ...over,
  };
}

/** Таазны элементийн баримтын уут — нэр нь хураагдсан хэлбэрээр. */
function ceilingBag(nameFolded: string, heightMm: number) {
  return M.createFactBag({
    context: M.emptyBuildContext(1, 'doc-1'),
    element: {
      name_folded: { kind: 'text', value: nameFolded },
      ceiling_h_mm: {
        kind: 'number',
        value: heightMm,
        unit: 'MM',
        source: 'computed',
        specId: null,
      },
    },
    dirtyCategory: 'Ceilings',
  });
}

/**
 * КЛИЕНТИЙН ДУУРАЙЛТ — багцын БАЙТААС `RuleDef` угсарна.
 * ⚠️ Утсан дээр ирсэн зүйлээс Л угсарна: серверийн `def`-ийг ДАХИН
 *    ХЭРЭГЛЭХГҮЙ, эс бөгөөс тест нь зааг дээрх алдааг ХАРАХГҮЙ.
 */
function ruleFromWire(wire: Record<string, unknown>): RuleDef {
  const app = M.parsePredicate(wire['applicability']);
  assert.ok(app.ok, 'утсан дээрх applicability задлагдах ёстой');
  const chk = M.parseCheck(wire['check']);
  assert.ok(chk.ok, 'утсан дээрх check задлагдах ёстой');

  const rawExceptions = wire['exceptions'];
  assert.ok(Array.isArray(rawExceptions));
  const exceptions = rawExceptions.map((raw) => {
    const o = raw as Record<string, unknown>;
    // ⚠️ ЯГ ЭНД УНАДАГ БАЙВ: `when` нь утсан дээр БАЙХГҮЙ байсан.
    const when = M.parsePredicate(o['when']);
    assert.ok(when.ok, `үл хамаарах зүйлийн when задлагдах ёстой: ${String(o['code'])}`);
    return {
      code: String(o['code']),
      when: when.node,
      noteMn: typeof o['note_mn'] === 'string' ? o['note_mn'] : null,
    };
  });

  return {
    ruleUid: String(wire['rule_uid']),
    version: Number(wire['version']),
    semanticHash: String(wire['semantic_hash']),
    teamCode: null,
    titleMn: String(wire['title_mn']),
    titleEn: null,
    documentUid: (wire['document_uid'] as string | null) ?? null,
    clauseUid: (wire['clause_uid'] as string | null) ?? null,
    editionRef: (wire['edition_ref'] as string | null) ?? null,
    effectiveFrom: null,
    verificationState: 'UNVERIFIED',
    issueClass: 'REGULATORY_VIOLATION',
    severity: 'HIGH',
    unit: 'MM',
    coordinateSystem: 'none',
    expectApplicable: true,
    requiresContext: [],
    applicability: app.node,
    check: chk.node,
    requires: { params: ['name_folded', 'ceiling_h_mm'], triggeredBy: [] },
    exceptions,
    recommendationMn: null,
  };
}

/* ================================================================== */
/*  1. FINDING 1 — `exceptions[].when` нь УТСАН ДЭЭР ГАРНА             */
/* ================================================================== */

test('fixture нь багц угсрах шалгуурыг БҮРЭН давна', () => {
  const parsed = P.parseRuleRow(ceilingRow());
  assert.ok(parsed);
  assert.deepEqual([...P.validateRuleForPack(parsed)], []);
  assert.equal(parsed.def.exceptions.length, 1);
  assert.equal(parsed.def.exceptions[0]?.code, 'atrium');
});

test('утас: `exceptions[].when` нь ЗААВАЛ гарна (fail-open уналт)', () => {
  const parsed = P.parseRuleRow(ceilingRow());
  assert.ok(parsed);
  const wire = P.ruleDefToWire(parsed.def, parsed);

  const exs = wire['exceptions'];
  assert.ok(Array.isArray(exs) && exs.length === 1);
  const ex = exs[0] as Record<string, unknown>;

  assert.ok('when' in ex, '`when` нь утсан дээр БАЙХ ЁСТОЙ — эс бөгөөс клиент дээр АЛГАСАГДАНА');
  assert.deepEqual(ex['when'], ATRIUM_WHEN);
  assert.equal(ex['code'], 'atrium');
  assert.equal(ex['note_mn'], 'Атриумын таазанд хамаарахгүй.');
  // ⚠️ ХООСОН `{}` нь БОЛОХГҮЙ: `RulePack.cs` түүнийг ТАТГАЛЗАНА.
  assert.ok(Object.keys(ex['when'] as Record<string, unknown>).length > 0);
});

test('утас: багцын БАЙТААС угсарсан дүрэм дээр үл хамаарах зүйл ЗӨРЧЛИЙГ ДАРНА', async () => {
  const parsed = P.parseRuleRow(ceilingRow());
  assert.ok(parsed);
  const pack = await P.buildPack({
    teamCode: 'BA',
    rulesetVersion: '2026-09-01.1',
    generatedAt: '2026-09-01T00:00:00Z',
    context: null,
    rules: [parsed],
    conflicts: [],
  });

  // ⚠️ НИЙТЛЭГДСЭН БАЙТААС — `pack.body`-оос БИШ.
  const body = JSON.parse(pack.bodyJson) as Record<string, unknown>;
  const rules = body['rules'];
  assert.ok(Array.isArray(rules) && rules.length === 1);
  const clientRule = ruleFromWire(rules[0] as Record<string, unknown>);

  // 2200 мм тааз = 2500-аас БАГА → үл хамаарах зүйлгүй бол ЗӨРЧИЛ.
  const atrium = A.evaluateApplicability(
    clientRule,
    M.emptyBuildContext(1, 'doc-1'),
    ceilingBag('atrium 1', 2200),
  );
  assert.equal(atrium.kind, 'NOT_APPLICABLE');
  assert.equal(atrium.kind === 'NOT_APPLICABLE' ? atrium.reason : '', 'exception:atrium');

  // СӨРӨГ ХЯНАЛТ — атриум БИШ тааз нь ХЭВЭЭР шалгагдана.
  const room = A.evaluateApplicability(
    clientRule,
    M.emptyBuildContext(1, 'doc-1'),
    ceilingBag('oroo 5', 2200),
  );
  assert.equal(room.kind, 'APPLICABLE');
  const check = clientRule.check;
  assert.ok(check);
  assert.equal(
    M.evaluateNode(check, ceilingBag('oroo 5', 2200)).tri,
    M.TRI_FALSE,
    'үл хамаарах зүйл ЗӨВХӨН атриумд үйлчилнэ',
  );
});

test('утас: `predicateToWire` нь `parsePredicate`-ийн ЯГ УРВУУ (навч бүр)', () => {
  const cases: readonly unknown[] = [
    { 'element.ceiling_h_mm': { gte: 2500 } },
    { 'element.ceiling_h_mm': { lt: -12.5 } },
    { 'element.name_folded': { eq: 'atrium' } },
    { 'element.name_folded': { ne: 'oroo' } },
    { 'element.ceiling_h_mm': { between: [2200, 2500] } },
    { 'element.ceiling_h_mm': { in: [2200, 2400, 2500] } },
    { 'element.name_folded': { in: ['atrium', 'holl'] } },
    { 'element.name_folded': { contains_any: ['atrium', 'holl'] } },
    { 'element.ceiling_h_mm': { exists: true } },
    { 'element.ceiling_h_mm': { exists: false } },
    { not: { 'element.name_folded': { contains_any: ['atrium'] } } },
    {
      all: [
        { 'element.category': { eq: 'Ceilings' } },
        {
          any: [
            { 'element.ceiling_h_mm': { gt: 0 } },
            { 'element.name_folded': { eq: 'atrium' } },
          ],
        },
      ],
    },
  ];
  for (const raw of cases) {
    const p = M.parsePredicate(raw);
    assert.ok(p.ok, `задлагдах ёстой: ${JSON.stringify(raw)}`);
    const wire = P.predicateToWire(p.node);
    assert.deepEqual(wire, raw, `урвуу зөрөв: ${JSON.stringify(raw)}`);
    // Дахин задлахад ИЖИЛ мод — клиент дээр ижил дүгнэлт гарна.
    const again = M.parsePredicate(wire);
    assert.ok(again.ok);
    assert.deepEqual(again.node, p.node);
    // Канончлогдоно — `pack_sha256` нь тоон профайл дээр ХЭЗЭЭ Ч унахгүй.
    assert.equal(M.canonicalize(wire), M.canonicalize(raw));
  }
});

test('утас: `when` нь §5.9-ийн 64 зангилааны төсөвт ОРНО', () => {
  // 70 гишүүнтэй `all` = 71 зангилаа; applicability(1) + check(1) = 73 > 64.
  const many = {
    all: Array.from({ length: 70 }, () => ({ 'element.name_folded': { eq: 'x' } })),
  };
  const parsed = P.parseRuleRow(
    ceilingRow({ exceptions_json: JSON.stringify([{ code: 'big', when: many }]) }),
  );
  assert.ok(parsed);
  const errors = [...P.validateRuleForPack(parsed)];
  assert.ok(
    errors.some((e) => e.startsWith('V8')),
    `V8 хүлээсэн, гарсан нь: ${errors.join('; ')}`,
  );
});

/* ================================================================== */
/*  2. FINDING 3 — UNVERIFIED нь ЭШЛЭЛИЙГ ДАРНА                        */
/* ================================================================== */

test('утас: UNVERIFIED дүрэм нь эшлэлээ ГАРГАХГҮЙ', async () => {
  const parsed = P.parseRuleRow(ceilingRow());
  assert.ok(parsed);
  // ⚠️ ӨГӨГДЛИЙН САНД нь БАЙНА — дарагдах нь ЗӨВХӨН утсан дээр.
  assert.equal(parsed.def.clauseUid, '4.2');
  assert.equal(parsed.def.documentUid, 'BNBD-31-03');

  const wire = P.ruleDefToWire(parsed.def, parsed);
  assert.equal(wire['document_uid'], null);
  assert.equal(wire['clause_uid'], null);
  assert.equal(wire['edition_ref'], null);
  // `verification_state` нь ХЭВЭЭР — клиент өөрөө ДАХИН шийднэ.
  assert.equal(wire['verification_state'], 'UNVERIFIED');
  // ⚠️ `effective_from` нь ЭШЛЭЛ БИШ — хүчинтэй огноо нь дарагдахгүй.
  assert.equal(wire['effective_from'], '2026-01-01');

  const pack = await P.buildPack({
    teamCode: 'BA',
    rulesetVersion: '2026-09-01.1',
    generatedAt: '2026-09-01T00:00:00Z',
    context: null,
    rules: [parsed],
    conflicts: [],
  });
  assert.ok(
    !pack.bodyJson.includes('BNBD-31-03'),
    'баталгаажаагүй дүрмийн баримтын код НИЙТЛЭГДСЭН БАЙТАД БАЙНА',
  );
});

test('утас: CLAUSE_CITED / HUMAN_VERIFIED дүрэм нь эшлэлээ ХЭВЭЭР гаргана', () => {
  for (const state of ['CLAUSE_CITED', 'HUMAN_VERIFIED'] as const) {
    const parsed = P.parseRuleRow(ceilingRow({ verification_state: state }));
    assert.ok(parsed);
    const wire = P.ruleDefToWire(parsed.def, parsed);
    assert.equal(wire['document_uid'], 'BNBD-31-03', state);
    assert.equal(wire['clause_uid'], '4.2', state);
    assert.equal(wire['edition_ref'], '2021', state);
  }
});
