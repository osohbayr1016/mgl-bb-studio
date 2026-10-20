/**
 * ДҮРМИЙН ЗАГВАРЫН ЦЭВЭР ФУНКЦҮҮДИЙН ТЕСТ — `2-2-rule-model` §3.13.1.
 *
 * Run with:  node --test src/lib/ruleApplicability.test.ts
 *
 * ⚠️ ЭНЭ ФАЙЛ НЬ ХОС ФАЙЛЫН ТУЛГАЛТЫН **TS ТАЛ**.  C# тал нь
 *    `revit-mcp/addin/RuleEngine.cs`, харш нь `revit-mcp/training/check_rules.py
 *    --parity`.  P1–P8 fixture-ийн утга ЭНД БАС ТЭНД ижил байх ЁСТОЙ.
 *
 * ⚠️ `registerHooks` — `src/lib/*.ts` нь өргөтгөлгүй харьцангуй импорт
 *    хэрэглэдэг тул `node --test` дор шууд `import` УНАНА (tsc ногоон хэвээр).
 *    `bimEvents.test.ts` / `modules.test.ts`-ийн ЯГ ИЖИЛ хэв маяг.
 *
 * ⚠️ ЭНД БАЙГАА ХОЁР ДҮРЭМ НЬ **БҮТЭЦИЙН ТЕМПЛЕЙТ**, ДҮРМИЙН КОРПУС БИШ
 *    (эзний шийдвэр Ш4, 2026-08-31: албан ёсны БНбД/MNS баримтыг эзэн өөрөө
 *    нийлүүлнэ, түүнийг хүлээх хугацаанд дүрмийн АГУУЛГА зохиохгүй).
 *    Тэдгээр нь ГРАММАТИК ба ХАМААРЛЫН ХӨДӨЛГҮҮРИЙГ шалгах fixture болж Л
 *    оршино — `rules` хүснэгтэд, `rulepack-canary.json`-д ОРООГҮЙ.
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

/* ================================================================== */
/*  0. БҮТЭЦИЙН ТЕМПЛЕЙТ ДҮРМҮҮД (fixture)                             */
/* ================================================================== */

/**
 * `BA-HR-CORRIDOR-W-001` — эцэг спекийн §3.7-ийн КАНОН ТЕМПЛЕЙТ, ҮСЭГ ҮСГЭЭР.
 *
 * ⚠️ ЭНЭ ХЭЛБЭР НЬ БАГЦАД ОРОХ ЭРХГҮЙ, БӨГӨӨД ТЭР НЬ ОЛДСОН ЗӨРҮҮ:
 *    §3.7-ийн `requires` блок нь ХОЁР зүйлийг дутуу зарласан —
 *      - `requires_context` нь `project.stories_above_grade`-гүй, гэтэл
 *        `applicability` түүнийг ХЭРЭГЛЭДЭГ  → Хавсралт §10-ийн V4 унана.
 *      - `requires.params` нь `name_folded`-гүй, гэтэл `applicability`
 *        түүнийг ХЭРЭГЛЭДЭГ (origin='param')  → V9 унана.
 *    P1-P8 тулгалтын fixture нь спекийн ЛИТЕРАЛ хэлбэрийг хэрэглэнэ (ингэж Л
 *    §3.13.1-ийн хүлээлт үсэг үсгээрээ давтагдана); багц угсрах шалгуурыг
 *    `packableRow()` (хоёр нэр НЭМСЭН) шалгана.  Хоёр зөрүү нь тусдаа тестээр
 *    ил баригдана.
 */
const BA_APPLICABILITY = {
  all: [
    {
      any: [
        { 'project.height_m': { gt: 51 } },
        { 'project.stories_above_grade': { gt: 16 } },
      ],
    },
    { 'doc.room_boundary_location': { eq: 'Finish' } },
    { 'element.category': { eq: 'Rooms' } },
    { 'element.name_folded': { contains_any: ['hongil', 'koridor'] } },
  ],
};

const BA_CHECK = {
  if: { 'element.length_m': { gt: 10 } },
  then: { 'element.clear_width_mm': { gte: 1500 } },
  else: { 'element.clear_width_mm': { gte: 1200 } },
};

const IZ_APPLICABILITY = {
  all: [
    {
      any: [
        { 'project.height_m': { gt: 51 } },
        { 'project.stories_above_grade': { gt: 16 } },
      ],
    },
    { 'element.category': { eq: 'Rooms' } },
  ],
};

const IZ_CHECK = {
  if: { 'element.name_folded': { contains_any: ['hongil', 'koridor'] } },
  then: { 'element.ceiling_h_mm': { gte: 2200 } },
  else: { 'element.ceiling_h_mm': { gte: 2400 } },
};

function dbRow(over: Partial<import('./rulePack.ts').RuleDbRow>): import('./rulePack.ts').RuleDbRow {
  return {
    id: 1,
    rule_uid: 'BA-HR-CORRIDOR-W-001',
    version: 1,
    semantic_hash: 'x'.repeat(64),
    team_code: 'BA',
    title_mn: 'Хонгилын цэвэр өргөн',
    title_en: 'Corridor clear width',
    document_uid: 'BNBD-31-03',
    clause_uid: null,
    edition_ref: null,
    effective_from: null,
    verification_state: 'UNVERIFIED',
    issue_class: 'REGULATORY_VIOLATION',
    severity: 'HIGH',
    unit: 'MM',
    coordinate_system: 'none',
    expect_applicable: 1,
    requires_context_json: JSON.stringify(['project.height_m', 'doc.room_boundary_location']),
    applicability_json: JSON.stringify(BA_APPLICABILITY),
    check_json: JSON.stringify(BA_CHECK),
    requires_params_json: JSON.stringify(['clear_width_mm', 'length_m']),
    requires_triggered_json: JSON.stringify([
      { category: 'Rooms', change: 'modify' },
      { category: 'Walls', change: 'modify' },
      { category: 'Walls', change: 'add' },
      { category: 'Walls', change: 'delete' },
    ]),
    exceptions_json: '[]',
    recommendation_mn: 'Хонгилын цэвэр өргөнийг 1500 мм хүртэл нэмэгдүүлнэ.',
    status: 'draft',
    authored_by: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-08-31T00:00:00Z',
    ...over,
  };
}

const baParsed = P.parseRuleRow(dbRow({}));
assert.ok(baParsed, 'BA темплейт задлагдах ёстой');
const baRule = baParsed.def;

/** §3.7-ийн темплейт + V4/V9-ийн ХОЁР дутуу зарлалыг НӨХСӨН хувилбар. */
function packableRow(over: Partial<import('./rulePack.ts').RuleDbRow> = {}) {
  return dbRow({
    requires_context_json: JSON.stringify([
      'project.height_m',
      'project.stories_above_grade',
      'doc.room_boundary_location',
    ]),
    requires_params_json: JSON.stringify(['clear_width_mm', 'length_m', 'name_folded']),
    ...over,
  });
}
const baPackable = P.parseRuleRow(packableRow());
assert.ok(baPackable, 'нөхсөн темплейт задлагдах ёстой');

/** P1–P8-ын суурь: бүх бусад талбар ТААРСАН байна. */
function ctxOf(over: Partial<import('./complianceModel.ts').BuildContext>) {
  return { ...M.emptyBuildContext(1, ''), ...over };
}

function bagFor(opts: {
  heightM?: number | null;
  stories?: number | null;
  boundary?: string | null;
  category?: string | null;
  nameFolded?: string | null;
  lengthM?: number | null;
  widthMm?: number | null;
}) {
  const ctx = ctxOf({
    heightM: opts.heightM ?? null,
    storiesAboveGrade: opts.stories ?? null,
    roomBoundaryLocation:
      opts.boundary === undefined ? 'Finish' : (opts.boundary as never),
  });
  const element: Record<string, import('./complianceModel.ts').FactValue> = {};
  const name = opts.nameFolded === undefined ? 'hongil 3' : opts.nameFolded;
  if (name !== null) element['name_folded'] = { kind: 'text', value: name };
  if (opts.lengthM != null) {
    element['length_m'] = {
      kind: 'number', value: opts.lengthM, unit: 'M', source: 'builtin_geometry', specId: null,
    };
  }
  if (opts.widthMm != null) {
    element['clear_width_mm'] = {
      kind: 'number', value: opts.widthMm, unit: 'MM', source: 'computed', specId: null,
    };
  }
  const category = opts.category === undefined ? 'Rooms' : opts.category;
  return {
    ctx,
    bag: M.createFactBag({ context: ctx, element, dirtyCategory: category }),
  };
}

/* ================================================================== */
/*  1. ХАВЧААР — §3.5                                                  */
/* ================================================================== */

test('clampByVerification: UNVERIFIED нь дүгнэлт/нотолгоо/ноцтой байдал ГУРВЫГ хавчина', () => {
  const out = M.clampByVerification({
    verificationState: 'UNVERIFIED',
    rawVerdict: 'VIOLATION',
    rawEvidence: 'RULE_BACKED',
    severity: 'CRITICAL',
  });
  assert.equal(out.verdict, 'WARNING');
  assert.equal(out.evidenceLevel, 'MODEL_DERIVED');
  assert.equal(out.severity, 'HIGH');
  assert.equal(out.suppressCitation, true);
  assert.equal(out.citationLabelMn, M.UNVERIFIED_CITATION_MN);
});

test('clampByVerification: PASS ба UNCERTAIN нь UNVERIFIED дор ХЭВЭЭР', () => {
  for (const v of ['PASS', 'UNCERTAIN', 'WARNING'] as const) {
    const out = M.clampByVerification({
      verificationState: 'UNVERIFIED',
      rawVerdict: v,
      rawEvidence: 'HUMAN_VERIFIED',
      severity: 'MEDIUM',
    });
    assert.equal(out.verdict, v);
    assert.equal(out.evidenceLevel, 'MODEL_DERIVED');
  }
});

test('clampByVerification: HUMAN_VERIFIED нь юуг ч хавчихгүй', () => {
  const out = M.clampByVerification({
    verificationState: 'HUMAN_VERIFIED',
    rawVerdict: 'VIOLATION',
    rawEvidence: 'RULE_BACKED',
    severity: 'CRITICAL',
  });
  assert.equal(out.verdict, 'VIOLATION');
  assert.equal(out.evidenceLevel, 'RULE_BACKED');
  assert.equal(out.severity, 'CRITICAL');
  assert.equal(out.suppressCitation, false);
  assert.equal(out.citationLabelMn, null);
});

test('SEVERITY_RANK ба EVIDENCE_RANK нь бүрэн бөгөөд эрэмбэлэгдсэн', () => {
  assert.equal(Object.keys(M.SEVERITY_RANK).length, M.SEVERITIES.length);
  assert.equal(Object.keys(M.EVIDENCE_RANK).length, M.EVIDENCE_LEVELS.length);
  assert.ok(M.SEVERITY_RANK.CRITICAL > M.SEVERITY_RANK.HIGH);
  assert.ok(M.EVIDENCE_RANK.HUMAN_VERIFIED > M.EVIDENCE_RANK.UNKNOWN);
});

/* ================================================================== */
/*  2. ӨНДӨР БАРИЛГЫН ХААЛГА — §3.6                                    */
/* ================================================================== */

test('opensHighRiseDocumentSet: хоёулаа NULL бол null (UNCERTAIN, false БИШ)', () => {
  assert.equal(A.opensHighRiseDocumentSet({ heightM: null, storiesAboveGrade: null }), null);
});

test('opensHighRiseDocumentSet: 51 ба 16 нь ХАТУУ `>`', () => {
  assert.equal(A.opensHighRiseDocumentSet({ heightM: 52, storiesAboveGrade: null }), true);
  assert.equal(A.opensHighRiseDocumentSet({ heightM: 51, storiesAboveGrade: null }), false);
  assert.equal(A.opensHighRiseDocumentSet({ heightM: null, storiesAboveGrade: 17 }), true);
  assert.equal(A.opensHighRiseDocumentSet({ heightM: null, storiesAboveGrade: 16 }), false);
});

test('дөрвөн хаалганы тогтмол нь хос файлд зөөгдөх ёстой утгууд', () => {
  assert.equal(A.HIGH_RISE_HEIGHT_M, 51);
  assert.equal(A.HIGH_RISE_STORIES, 16);
  assert.equal(A.WIND_RESONANCE_HEIGHT_M, 30);
  assert.equal(A.CAST_IN_PLACE_STORIES, 21);
  assert.equal(A.NETWORK_REPEATER_STORIES, 15);
});

/* ================================================================== */
/*  3. P1–P8 — TS ↔ C# ТУЛГАЛТЫН FIXTURE (§3.13.1)                     */
/* ================================================================== */

test('P1: height_m = 52, stories = null → APPLICABLE', () => {
  const { ctx, bag } = bagFor({ heightM: 52, stories: null });
  assert.deepEqual(A.evaluateApplicability(baRule, ctx, bag), { kind: 'APPLICABLE' });
});

test('P2: height_m = 51 ЯГ, stories = 16 ЯГ → NOT_APPLICABLE(high_rise_gate)', () => {
  const { ctx, bag } = bagFor({ heightM: 51, stories: 16 });
  assert.deepEqual(A.evaluateApplicability(baRule, ctx, bag), {
    kind: 'NOT_APPLICABLE',
    reason: 'high_rise_gate',
  });
});

test('P3: height ба stories хоёулаа NULL → UNCERTAIN(project.height_m)', () => {
  const { ctx, bag } = bagFor({ heightM: null, stories: null });
  assert.deepEqual(A.evaluateApplicability(baRule, ctx, bag), {
    kind: 'UNCERTAIN',
    missing: ['project.height_m'],
  });
});

test('P4: height = null, stories = 17 → APPLICABLE (`any` салаа)', () => {
  const { ctx, bag } = bagFor({ heightM: null, stories: 17 });
  assert.deepEqual(A.evaluateApplicability(baRule, ctx, bag), { kind: 'APPLICABLE' });
});

test('P5: room_boundary_location = Center → NOT_APPLICABLE(boundary_location)', () => {
  const { ctx, bag } = bagFor({ heightM: 52, boundary: 'Center' });
  assert.deepEqual(A.evaluateApplicability(baRule, ctx, bag), {
    kind: 'NOT_APPLICABLE',
    reason: 'boundary_location',
  });
});

test('P6: room_boundary_location = null → UNCERTAIN(doc.room_boundary_location)', () => {
  const { ctx, bag } = bagFor({ heightM: 52, boundary: null });
  assert.deepEqual(A.evaluateApplicability(baRule, ctx, bag), {
    kind: 'UNCERTAIN',
    missing: ['doc.room_boundary_location'],
  });
});

test('P7: element.category = Walls → NOT_APPLICABLE(category)', () => {
  const { ctx, bag } = bagFor({ heightM: 52, category: 'Walls' });
  assert.deepEqual(A.evaluateApplicability(baRule, ctx, bag), {
    kind: 'NOT_APPLICABLE',
    reason: 'category',
  });
});

test('P8: name_folded таарахгүй → NOT_APPLICABLE(name)', () => {
  const { ctx, bag } = bagFor({ heightM: 52, nameFolded: 'oroo 12' });
  assert.deepEqual(A.evaluateApplicability(baRule, ctx, bag), {
    kind: 'NOT_APPLICABLE',
    reason: 'name',
  });
});

test('ЭСРЭГ-ТЕСТ: HIGH_RISE_HEIGHT_M-ыг 50 болговол P2 ЗӨРНӨ (тулгалт бодитой)', () => {
  // Тогтмолыг өөрчилж чадахгүй тул түүнтэй ижил утгыг ГАРААР бичиж, хэрэв
  // хос файлын нэг тал 50 болвол P2 нь `APPLICABLE` болохыг харуулна.
  const loosened = {
    ...baRule,
    applicability: M.parsePredicate({
      all: [
        { any: [{ 'project.height_m': { gt: 50 } }, { 'project.stories_above_grade': { gt: 16 } }] },
        { 'doc.room_boundary_location': { eq: 'Finish' } },
        { 'element.category': { eq: 'Rooms' } },
        { 'element.name_folded': { contains_any: ['hongil', 'koridor'] } },
      ],
    }),
  };
  assert.ok(loosened.applicability.ok);
  const rule = { ...baRule, applicability: loosened.applicability.node };
  const { ctx, bag } = bagFor({ heightM: 51, stories: 16 });
  assert.deepEqual(A.evaluateApplicability(rule, ctx, bag), { kind: 'APPLICABLE' });
});

/* ================================================================== */
/*  4. `mayApply` — МОНОТОН УРЬДЧИЛСАН ШҮҮЛТ (Хавсралт §4.5)           */
/* ================================================================== */

test('mayApply: name_folded нь Missing байхад ч TRUE (Unknown → true)', () => {
  // ⚠️ ЭНЭ НЭГ ТЕСТ нь бүх дүрэм чимээгүй унтрахаас хамгаална.
  const ctx = ctxOf({ heightM: 52, roomBoundaryLocation: 'Finish' });
  const partial = M.createFactBag({ context: ctx, element: {}, dirtyCategory: 'Rooms' });
  const r = A.mayApply(baRule, partial);
  assert.equal(r.mayApply, true);
  assert.equal(r.skipReason, null);
});

test('mayApply: категори тодорхой зөрвөл FALSE + шалтгаан', () => {
  const ctx = ctxOf({ heightM: 52, roomBoundaryLocation: 'Finish' });
  const partial = M.createFactBag({ context: ctx, element: {}, dirtyCategory: 'Walls' });
  const r = A.mayApply(baRule, partial);
  assert.equal(r.mayApply, false);
  assert.equal(r.skipReason, 'category');
});

test('mayApply: контекст ОГТ байхгүй үед ч TRUE (монотон)', () => {
  const ctx = M.emptyBuildContext(0, '');
  const partial = M.createFactBag({ context: ctx, element: {}, dirtyCategory: null });
  assert.equal(A.mayApply(baRule, partial).mayApply, true);
});

/* ================================================================== */
/*  5. ҮЛ ХАМААРАХ ЗҮЙЛ нь КОНТЕКСТЭЭС ӨМНӨ (Хавсралт §9.1-ийн 1)      */
/* ================================================================== */

test('exceptions нь контекст дутуу байхад Ч ажиллана', () => {
  const when = M.parsePredicate({ 'project.building_type': { eq: 'temporary' } });
  assert.ok(when.ok);
  const rule = {
    ...baRule,
    exceptions: [{ code: 'temp_structure', when: when.node, noteMn: null }],
  };
  const ctx = ctxOf({ buildingType: 'temporary' });
  const bag = M.createFactBag({ context: ctx, element: {}, dirtyCategory: null });
  assert.deepEqual(A.evaluateApplicability(rule, ctx, bag), {
    kind: 'NOT_APPLICABLE',
    reason: 'exception:temp_structure',
  });
});

/* ================================================================== */
/*  6. ГРАММАТИК ба Kleene — Хавсралт §5                               */
/* ================================================================== */

test('Kleene: all([]) = TRUE, any([]) = FALSE, not(UNKNOWN) = UNKNOWN', () => {
  assert.equal(M.triAll([]), M.TRI_TRUE);
  assert.equal(M.triAny([]), M.TRI_FALSE);
  assert.equal(M.triNot(M.TRI_UNKNOWN), M.TRI_UNKNOWN);
  assert.equal(M.triNot(M.TRI_TRUE), M.TRI_FALSE);
  assert.equal(M.triNot(M.TRI_FALSE), M.TRI_TRUE);
});

test('all дээр FALSE ноёрхоно (нэг оролт дутуу ч тодорхой зөрчил ялна)', () => {
  const node = M.parseCheck({
    all: [
      { 'element.clear_width_mm': { gte: 1500 } },
      { 'element.length_m': { gt: 10 } },
    ],
  });
  assert.ok(node.ok);
  const bag = M.createFactBag({
    element: {
      clear_width_mm: { kind: 'number', value: 1000, unit: 'MM', source: 'computed', specId: null },
    },
  });
  const r = M.evaluateNode(node.node, bag);
  assert.equal(r.tri, M.TRI_FALSE);
});

test('cond: UNKNOWN нөхцөл дээр ХОЁУЛАНГ НЬ ҮНЭЛЭХГҮЙ', () => {
  const node = M.parseCheck(BA_CHECK);
  assert.ok(node.ok);
  // `length_m` байхгүй → нөхцөл Unknown; хоёр салаа хоёулаа `clear_width_mm`-ыг
  // хардаг тул хэрэв салаа үнэлэгдсэн бол `unknownFacts` -д тэр нэр орох байв.
  const bag = M.createFactBag({ element: {} });
  const r = M.evaluateNode(node.node, bag);
  assert.equal(r.tri, M.TRI_UNKNOWN);
  assert.equal(r.decidingLeaf, null);
  assert.deepEqual([...r.unknownFacts], ['element.length_m']);
});

test('`applicability`-д `cond` ХОРИОТОЙ, `check`-д зөвшөөрөгдөнө', () => {
  assert.equal(M.parsePredicate(BA_CHECK).ok, false);
  assert.equal(M.parseCheck(BA_CHECK).ok, true);
});

test('задлагч ХЭЗЭЭ Ч шидэхгүй — гажсан оролт бүр ParseResult буцаана', () => {
  const bad: unknown[] = [
    null, 1, 'x', [], {},
    { 'element.category': {} },
    { 'element.category': { eq: null } },
    { 'bad.name': { eq: 1 } },
    { 'element.category': { nope: 1 } },
    { all: 'not an array' },
    { 'element.length_m': { between: [10] } },
    { 'element.length_m': { between: [10, 5] } },
    { 'element.name_folded': { contains_any: [] } },
    { 'element.length_m': { gt: 1e10 } },
    { 'element.length_m': { gt: 0.12345678 } },
    { if: { 'element.length_m': { gt: 1 } }, then: { 'element.length_m': { gt: 1 } } },
  ];
  for (const raw of bad) {
    const r = M.parseCheck(raw);
    assert.equal(r.ok, false, `хүлээгдээгүй амжилт: ${JSON.stringify(raw)}`);
  }
});

test('гүний хязгаар: MAX_NODE_DEPTH давсан мод ТАТГАЛЗАНА', () => {
  let node: unknown = { 'element.category': { eq: 'Rooms' } };
  for (let i = 0; i < M.MAX_NODE_DEPTH + 2; i += 1) node = { all: [node] };
  assert.equal(M.parseCheck(node).ok, false);
});

test('exists нь Missing-ийг ТОДОРХОЙ буль болгодог ЦОРЫН ГАНЦ оператор', () => {
  const yes = M.parseCheck({ 'element.clear_width_mm': { exists: true } });
  const no = M.parseCheck({ 'element.clear_width_mm': { exists: false } });
  assert.ok(yes.ok && no.ok);
  const empty = M.createFactBag({ element: {} });
  assert.equal(M.evaluateNode(yes.node, empty).tri, M.TRI_FALSE);
  assert.equal(M.evaluateNode(no.node, empty).tri, M.TRI_TRUE);
});

test('gt/gte нь НЯГТ (EPS БАЙХГҮЙ), eq нь EPS-тэй', () => {
  const gt = M.parseCheck({ 'project.height_m': { gt: 51 } });
  const eq = M.parseCheck({ 'project.height_m': { eq: 51 } });
  assert.ok(gt.ok && eq.ok);
  const bag = M.createFactBag({ context: ctxOf({ heightM: 51 + 1e-12 }) });
  assert.equal(M.evaluateNode(gt.node, bag).tri, M.TRI_TRUE, 'нягт: 51+1e-12 > 51');
  assert.equal(M.evaluateNode(eq.node, bag).tri, M.TRI_TRUE, 'EPS: 51+1e-12 == 51');
});

/* ================================================================== */
/*  7. НЭГЖ ба ЭХ ҮҮСВЭР — §62                                         */
/* ================================================================== */

test('unitForFactName: хөлдөөсөн хяналтын жишээнүүд', () => {
  const table: readonly (readonly [string, string])[] = [
    ['element.clear_width_mm', 'MM'],
    ['element.length_m', 'M'],
    ['element.ceiling_h_mm', 'MM'],
    ['project.height_m', 'M'],
    ['project.gross_area_m2', 'M2'],
    ['project.stories_above_grade', 'NONE'],
    ['element.category', 'NONE'],
    ['element.name_folded', 'NONE'],
    ['doc.room_boundary_location', 'NONE'],
  ];
  for (const [name, unit] of table) {
    assert.equal(M.unitForFactName(name), unit, name);
  }
});

test('FACT_REGISTRY-ийн нэгж нь нэрнээс ГАРСАН, гараар бичээгүй', () => {
  for (const f of M.FACT_REGISTRY) {
    assert.equal(f.unit, M.unitForFactName(f.name), f.name);
    assert.ok(M.FACT_NAME_RE.test(f.name), f.name);
  }
  assert.equal(M.lookupFact('element.category')?.origin, 'dirty');
  assert.equal(M.lookupFact('element.nope'), null);
});

test('mixed_units: нэр↔нэгж зөрвөл ЧИМЭЭГҮЙ ХӨРВҮҮЛЭЛТ БАЙХГҮЙ', () => {
  const bag = M.createFactBag({
    element: {
      clear_width_mm: { kind: 'number', value: 1.42, unit: 'M', source: 'computed', specId: null },
    },
  });
  const r = bag.resolve('element.clear_width_mm');
  assert.equal(r.problem, 'mixed_units');
  assert.equal(r.value.kind, 'missing');
});

test('mixed_provenance: untyped_param нь ХӨРВҮҮЛЭГДЭХГҮЙ', () => {
  const bag = M.createFactBag({
    element: {
      clear_width_mm: {
        kind: 'number', value: 1200, unit: 'MM', source: 'untyped_param', specId: null,
      },
    },
  });
  const r = bag.resolve('element.clear_width_mm');
  assert.equal(r.problem, 'mixed_provenance');
  assert.equal(r.value.kind, 'missing');
  assert.equal(M.conversionAllowed('untyped_param', 'anything'), false);
  assert.equal(M.conversionAllowed('typed_param', null), false);
  assert.equal(M.conversionAllowed('typed_param', 'autodesk.spec.aec:length-2.0.0'), true);
  assert.equal(M.conversionAllowed('builtin_geometry', null), true);
});

test('zero ба missing нь ХОЁР ӨӨР ЗҮЙЛ', () => {
  const zero = M.createFactBag({
    element: {
      clear_width_mm: { kind: 'number', value: 0, unit: 'MM', source: 'computed', specId: null },
    },
  });
  const missing = M.createFactBag({ element: {} });
  assert.equal(zero.resolve('element.clear_width_mm').value.kind, 'number');
  assert.equal(missing.resolve('element.clear_width_mm').value.kind, 'missing');

  const node = M.parseCheck({ 'element.clear_width_mm': { gte: 1500 } });
  assert.ok(node.ok);
  const zr = M.evaluateNode(node.node, zero);
  assert.equal(zr.tri, M.TRI_FALSE);
  assert.deepEqual([...zr.unknownFacts], [], 'тэг нь MissingInputs ҮҮСГЭХГҮЙ');
  const mr = M.evaluateNode(node.node, missing);
  assert.equal(mr.tri, M.TRI_UNKNOWN);
  assert.deepEqual([...mr.unknownFacts], ['element.clear_width_mm']);
});

test('АМЬД doc.* нь АВТОРЛОСОН толин тусгалыг ДАРНА (3 > 4)', () => {
  const ctx = ctxOf({ roomBoundaryLocation: 'Finish' });
  const bag = M.createFactBag({
    context: ctx,
    doc: { room_boundary_location: { kind: 'text', value: 'Center' } },
  });
  const v = bag.resolve('doc.room_boundary_location').value;
  assert.equal(v.kind === 'text' ? v.value : null, 'Center');
});

/* ================================================================== */
/*  8. БОСГО ТАЙЛАГНАХ — Хавсралт §5.7                                 */
/* ================================================================== */

test('decisionValues: хонгил 12 м / 1420.5 мм → observed 1420.5, threshold 1500', () => {
  const node = M.parseCheck(BA_CHECK);
  assert.ok(node.ok);
  const { bag } = bagFor({ heightM: 52, lengthM: 12.4, widthMm: 1420.5 });
  const r = M.evaluateNode(node.node, bag);
  assert.equal(r.tri, M.TRI_FALSE);
  const dv = M.decisionValues(r.decidingLeaf, bag, 'MM');
  assert.equal(dv.observed, 1420.5);
  assert.equal(dv.threshold, 1500);
});

test('decisionValues: нэгж зөрвөл ХОЁУЛАА null (ТААМАГЛАХГҮЙ)', () => {
  const node = M.parseCheck({ 'element.length_m': { gt: 10 } });
  assert.ok(node.ok);
  const { bag } = bagFor({ heightM: 52, lengthM: 5 });
  const r = M.evaluateNode(node.node, bag);
  const dv = M.decisionValues(r.decidingLeaf, bag, 'MM');
  assert.deepEqual(dv, { observed: null, threshold: null });
});

test('not зангилаа нь decidingLeaf-ыг null болгоно', () => {
  const node = M.parseCheck({ not: { 'element.length_m': { gt: 10 } } });
  assert.ok(node.ok);
  const { bag } = bagFor({ heightM: 52, lengthM: 12 });
  const r = M.evaluateNode(node.node, bag);
  assert.equal(r.tri, M.TRI_FALSE);
  assert.equal(r.decidingLeaf, null);
});

/* ================================================================== */
/*  9. MGL-CANON-1 — Хавсралт §6                                       */
/* ================================================================== */

test('numberToCanonical: хөлдөөсөн жишээнүүд', () => {
  assert.equal(M.numberToCanonical(1500), '1500');
  assert.equal(M.numberToCanonical(1500.0), '1500');
  assert.equal(M.numberToCanonical(4.5), '4.5');
  assert.equal(M.numberToCanonical(0.05), '0.05');
  assert.equal(M.numberToCanonical(-0), '0');
  assert.equal(M.numberToCanonical(0.5), '0.5');
  assert.equal(M.numberToCanonical(51), '51');
  assert.equal(M.numberToCanonical(2.4), '2.4');
  assert.equal(M.numberToCanonical(1e9), null, 'хязгаараас гадуур');
  assert.equal(M.numberToCanonical(0.0000001), null, '7 орон');
  assert.equal(M.numberToCanonical(Number.NaN), null);
});

test('canonicalize: зайгүй, түлхүүр ordinal эрэмбэтэй, цуваа ХЭВЭЭР', () => {
  assert.equal(M.canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(M.canonicalize([3, 1, 2]), '[3,1,2]');
  assert.equal(M.canonicalize({}), '{}');
  assert.equal(M.canonicalize('шинэ\nмөр'), '"шинэ\\nмөр"');
  assert.equal(M.canonicalize('a/b'), '"a/b"', '/ escape ХИЙХГҮЙ');
  assert.equal(M.canonicalize(null), 'null');
  assert.throws(() => M.canonicalize({ x: 1e12 }), M.CanonError);
});

test('checkNumberProfileRaw: экспонентыг ЗАДЛАХЫН ӨМНӨ барина', () => {
  assert.ok(M.checkNumberProfileRaw('{"a":1e3}'));
  assert.ok(M.checkNumberProfileRaw('{"a":0.1234567}'));
  assert.equal(M.checkNumberProfileRaw('{"a":1500,"b":0.05}'), null);
  assert.equal(M.checkNumberProfileRaw('{"a":"1e3"}'), null, 'мөрийн доторх тоог алгасана');
});

test('semanticHash: 64 тэмдэгт, логик өөрчлөгдвөл ЗӨРНӨ, метадата өөрчлөгдвөл ИЖИЛ', async () => {
  const base = await M.semanticHash(BA_APPLICABILITY, BA_CHECK, 'MM');
  assert.match(base, /^[0-9a-f]{64}$/);
  const same = await M.semanticHash(
    JSON.parse(JSON.stringify(BA_APPLICABILITY)),
    JSON.parse(JSON.stringify(BA_CHECK)),
    'MM',
  );
  assert.equal(same, base);
  const moved = await M.semanticHash(
    BA_APPLICABILITY,
    { ...BA_CHECK, then: { 'element.clear_width_mm': { gte: 1450 } } },
    'MM',
  );
  assert.notEqual(moved, base, 'босго өөрчлөгдвөл hash ХӨДӨЛНӨ');
  const otherUnit = await M.semanticHash(BA_APPLICABILITY, BA_CHECK, 'M');
  assert.notEqual(otherUnit, base);
});

test('semanticHash: хоосон нь `{}` гэж канончлогдоно', async () => {
  const a = await M.semanticHash({}, {}, 'NONE');
  const b = await M.semanticHash(null, undefined, 'NONE');
  assert.equal(a, b);
  assert.equal(a, await M.sha256Hex('{}{}NONE'));
});

test('packSha256: `generated_at` өөрчлөгдөхөд hash ИЖИЛ (§7.3)', async () => {
  const body = {
    pack_contract: 'rulepack-v1',
    team_code: 'BA',
    ruleset_version: '2026-09-01.1',
    pack_sha256: '',
    generated_at: '2026-09-01T00:00:00Z',
    project_context: {},
    rules: [],
    conflicts: [],
  };
  const a = await M.packSha256(body);
  const b = await M.packSha256({ ...body, generated_at: '2027-01-01T12:00:00Z' });
  assert.equal(a, b);
  const c = await M.packSha256({ ...body, team_code: 'IZ' });
  assert.notEqual(a, c, 'агуулга өөрчлөгдвөл hash ХӨДӨЛНӨ');
});

/* ================================================================== */
/*  10. ЗӨРЧИЛДӨӨН — Хавсралт §8                                       */
/* ================================================================== */

function entry(a: string, b: string): import('./complianceModel.ts').ConflictEntry {
  return {
    ruleUidA: a, ruleUidB: b, conflictKind: 'threshold', scope: 'intra_pack',
    precedence: null, noteMn: null,
  };
}

function outcome(
  uid: string,
  verdict: import('./complianceModel.ts').Verdict,
  over: Partial<import('./complianceModel.ts').ReconcilableOutcome> = {},
): import('./complianceModel.ts').ReconcilableOutcome {
  return {
    ruleUid: uid, ruleVersion: 1, verdict, severity: 'MEDIUM',
    issueClass: 'REGULATORY_VIOLATION', evidenceLevel: 'MODEL_DERIVED',
    observedValue: 1, thresholdValue: 2, unit: 'MM',
    missingInputs: [], conflictRuleUids: [], skippedReason: null, uncertainReason: null,
    ...over,
  };
}

test('ConflictTable: (a,b) ба (b,a) НЭГ л мөр', () => {
  const t = M.buildConflictTable([entry('B-2', 'A-1')]);
  assert.equal(t.size, 1);
  assert.equal(t.has('A-1', 'B-2'), true);
  assert.equal(t.has('B-2', 'A-1'), true);
  assert.equal(t.get('A-1', 'B-2')?.ruleUidA, 'A-1', 'ordinal нормчлол');
  assert.deepEqual([...t.partnersOf('A-1')], ['B-2']);
});

test('Reconcile: хоёр PASS ХЭЗЭЭ Ч UNCERTAIN болохгүй', () => {
  const t = M.buildConflictTable([entry('A-1', 'B-2')]);
  const out = M.reconcileOutcomes([outcome('A-1', 'PASS'), outcome('B-2', 'PASS')], t);
  assert.equal(out.length, 2);
  assert.ok(out.every((o) => o.verdict === 'PASS'));
});

test('Reconcile: зөрсөн хос → ЯГ НЭГ UNCERTAIN, threshold нь ЗААВАЛ null', () => {
  const t = M.buildConflictTable([entry('A-1', 'B-2')]);
  const out = M.reconcileOutcomes(
    [
      outcome('B-2', 'PASS', { severity: 'LOW', evidenceLevel: 'HUMAN_VERIFIED' }),
      outcome('A-1', 'VIOLATION', { severity: 'CRITICAL', evidenceLevel: 'AI_INFERRED' }),
    ],
    t,
  );
  assert.equal(out.length, 1);
  const merged = out[0];
  assert.ok(merged);
  assert.equal(merged.verdict, 'UNCERTAIN');
  assert.equal(merged.issueClass, 'UNKNOWN_NEEDS_REVIEW');
  assert.equal(merged.uncertainReason, 'conflict');
  assert.equal(merged.severity, 'CRITICAL', 'ХАМГИЙН ӨНДӨР ноцтой байдал');
  assert.equal(merged.evidenceLevel, 'AI_INFERRED', 'ХАМГИЙН БАГА итгэл');
  assert.equal(merged.observedValue, null);
  assert.equal(merged.thresholdValue, null);
  assert.deepEqual([...merged.conflictRuleUids], ['A-1', 'B-2']);
  assert.equal(merged.ruleUid, 'A-1', 'ordinal-аар хамгийн бага — dedup түлхүүр тогтвортой');
});

test('Reconcile: оролтын дарааллыг эргүүлэхэд гаралт ӨӨРЧЛӨГДӨХГҮЙ', () => {
  const t = M.buildConflictTable([entry('A-1', 'B-2')]);
  const a = outcome('A-1', 'VIOLATION');
  const b = outcome('B-2', 'PASS');
  const x = M.reconcileOutcomes([a, b], t)[0];
  const y = M.reconcileOutcomes([b, a], t)[0];
  assert.ok(x && y);
  assert.equal(x.ruleUid, y.ruleUid);
  assert.deepEqual([...x.conflictRuleUids], [...y.conflictRuleUids]);
});

test('Reconcile: бүртгэгдээгүй хос нь ХЭВЭЭР үлдэнэ', () => {
  const t = M.buildConflictTable([]);
  const list = [outcome('A-1', 'VIOLATION'), outcome('B-2', 'PASS')];
  assert.deepEqual(M.reconcileOutcomes(list, t), list);
});

/* ================================================================== */
/*  11. БАГЦ УГСРАХ ШАЛГУУРУУД — Хавсралт §10                          */
/* ================================================================== */

test('нөхсөн BA темплейт нь V1-V11-ийг ДАВНА', () => {
  assert.deepEqual([...P.validateRuleForPack(baPackable)], []);
});

test('V4 + V9: спекийн §3.7-ийн ЛИТЕРАЛ requires блок нь УНАНА (олдсон зөрүү)', () => {
  // ⚠️ БАРИМТЖУУЛСАН СПЕКИЙН ЗӨРҮҮ.  §3.7-ийн жишээ нь
  //    `project.stories_above_grade`-ыг `requires_context`-д, `name_folded`-ыг
  //    `requires.params`-д бичээгүй мөртөө хоёуланг нь `applicability`-д
  //    хэрэглэдэг.  Хавсралт §10-ийн V4 ба V9 хоёул ТАТГАЛЗАНА.
  const errors = P.validateRuleForPack(baParsed);
  assert.ok(errors.some((e) => e.startsWith('V4')), errors.join(' | '));
  assert.ok(errors.some((e) => e.startsWith('V9')), errors.join(' | '));
});

test('V3: бүртгэлгүй баримтын нэр нь дүрмийг татгалзана', () => {
  const p = P.parseRuleRow(
    packableRow({
      applicability_json: JSON.stringify({ 'element.unknown_thing': { eq: 'x' } }),
      requires_context_json: '[]',
      requires_params_json: JSON.stringify(['unknown_thing', 'clear_width_mm', 'length_m']),
    }),
  );
  assert.ok(p);
  assert.ok(P.validateRuleForPack(p).some((e) => e.startsWith('V3')));
});

test('V6: хураагдаагүй needle нь татгалзана', () => {
  const p = P.parseRuleRow(
    packableRow({
      applicability_json: JSON.stringify({
        'element.name_folded': { contains_any: ['ХОНГИЛ'] },
      }),
      requires_context_json: '[]',
    }),
  );
  assert.ok(p);
  assert.ok(P.validateRuleForPack(p).some((e) => e.startsWith('V6')));
});

test('V7: unit тэг биш ч тэр нэгжтэй тоон навчгүй бол татгалзана', () => {
  const p = P.parseRuleRow(
    packableRow({
      unit: 'M3',
      check_json: JSON.stringify({ 'element.clear_width_mm': { gte: 1200 } }),
    }),
  );
  assert.ok(p);
  assert.ok(P.validateRuleForPack(p).some((e) => e.startsWith('V7')));
});

test('V9: element.category нь requires.params-д ШААРДАГДАХГҮЙ, бусад нь ШААРДАГДАНА', () => {
  // `element.category` нь `applicability`-д хэрэглэгдэж байгаа ч нөхсөн
  // темплейтийн `params`-д БАЙХГҮЙ — тэр нь ЗАРЧМЫН үл хамаарах зүйл.
  assert.deepEqual([...P.validateRuleForPack(baPackable)], []);
  assert.ok(!baPackable.def.requires.params.includes('category'));

  const bad = P.parseRuleRow(packableRow({ requires_params_json: JSON.stringify(['length_m']) }));
  assert.ok(bad);
  assert.ok(P.validateRuleForPack(bad).some((e) => e.startsWith('V9')));
});

test('V11: coordinate_system <> none нь ХААГДСАН (LINK_TRANSFORM_CAPABILITY_SHIPPED = false)', () => {
  assert.equal(P.LINK_TRANSFORM_CAPABILITY_SHIPPED, false);
  const p = P.parseRuleRow(packableRow({ coordinate_system: 'shared' }));
  assert.ok(p);
  assert.ok(P.validateRuleForPack(p).some((e) => e.startsWith('V11')));
});

test('V10: semantic_hash нь ДАХИН тооцоолоход тэнцэнэ', async () => {
  const hash = await M.semanticHash(BA_APPLICABILITY, BA_CHECK, 'MM');
  assert.equal(await P.verifySemanticHash(dbRow({ semantic_hash: hash })), true);
  assert.equal(await P.verifySemanticHash(dbRow({ semantic_hash: 'a'.repeat(64) })), false);
});

test('IZ темплейт (ЗОХИОСОН, хураагаагүй) нь БА-гийн бүтцийг ЯГ давтана', () => {
  const p = P.parseRuleRow(
    packableRow({
      rule_uid: 'IZ-HR-CEIL-H-001',
      team_code: 'IZ',
      title_mn: 'Таазны цэвэр өндөр',
      applicability_json: JSON.stringify(IZ_APPLICABILITY),
      check_json: JSON.stringify(IZ_CHECK),
      requires_context_json: JSON.stringify(['project.height_m', 'project.stories_above_grade']),
      requires_params_json: JSON.stringify(['ceiling_h_mm', 'name_folded']),
      requires_triggered_json: JSON.stringify([
        { category: 'Ceilings', change: 'modify' },
        { category: 'Ceilings', change: 'add' },
        { category: 'Ceilings', change: 'delete' },
        { category: 'Levels', change: 'modify' },
      ]),
    }),
  );
  assert.ok(p);
  assert.deepEqual([...P.validateRuleForPack(p)], []);
  assert.equal(p.def.verificationState, 'UNVERIFIED', 'релиз N-д ДҮРЭМ БҮР UNVERIFIED');
});

test('багц: `authored_by` / `status` / `created_at` нь БАГЦАД ХЭЗЭЭ Ч ОРОХГҮЙ', async () => {
  const pack = await P.buildPack({
    teamCode: 'BA',
    rulesetVersion: '2026-09-01.1',
    generatedAt: '2026-09-01T00:00:00Z',
    context: null,
    rules: [baPackable],
    conflicts: [],
  });
  const json = pack.bodyJson;
  for (const forbidden of ['authored_by', 'reviewed_by', 'created_at', '"status"']) {
    assert.ok(!json.includes(forbidden), `багцад ${forbidden} байна`);
  }
  assert.equal(pack.body['pack_contract'], P.PACK_CONTRACT);
  assert.equal(pack.packSha256.length, 64);
  // Нийтлэгдсэн байтаас ДАХИН тооцоолоход ижил hash гарна (клиентийн тулгалт).
  const reparsed = JSON.parse(json) as Record<string, unknown>;
  assert.equal(await M.packSha256(reparsed), pack.packSha256);
});

test('багц: `cross_discipline` зөрчилдөөн БАГЦАД ОРОХГҮЙ (§8.1)', async () => {
  const pack = await P.buildPack({
    teamCode: 'BA',
    rulesetVersion: 'v1',
    generatedAt: '2026-09-01T00:00:00Z',
    context: null,
    rules: [baPackable],
    conflicts: [
      entry('A-1', 'B-2'),
      { ...entry('C-3', 'D-4'), scope: 'cross_discipline' },
    ],
  });
  const conflicts = pack.body['conflicts'];
  assert.ok(Array.isArray(conflicts));
  assert.equal(conflicts.length, 1);
});
