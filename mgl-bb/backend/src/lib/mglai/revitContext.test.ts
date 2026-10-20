/**
 * MGL AI · REVIT КОНТЕКСТ — ТЕСТ (§22, §24).
 *
 * Run with:  node --test src/lib/mglai/revitContext.test.ts
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

const { parseRevitContext, summarizeRevit, validatePreview, renderPreviewMn, MAX_ELEMENTS } =
  await import('./revitContext.ts');

/* ================================================================== */
/*  1. Контекст шахалт                                                 */
/* ================================================================== */

test('бүхэл загварыг prompt-д хийхгүй — жагсаалт ТАСЛАГДАНА', () => {
  const selection = Array.from({ length: 500 }, (_, i) => ({
    id: `id-${i}`,
    category: 'Хана',
  }));
  const ctx = parseRevitContext({ selection });
  assert.equal(ctx.selection.length, MAX_ELEMENTS);
  // ⚠️ ГЭХДЭЭ нийт тоог ҮНЭНЭЭР хэлнэ.
  assert.equal(ctx.selectionTotal, 500);
});

test('хураангуй нь ТАСЛАГДСАНЫГ ил хэлнэ', () => {
  const selection = Array.from({ length: 40 }, (_, i) => ({ id: `w${i}`, category: 'Хана' }));
  const sum = summarizeRevit(parseRevitContext({ selection }))!;
  assert.ok(sum.includes('40 элемент'));
  assert.ok(sum.includes('эхний 25'), `таслалтыг заагаагүй: ${sum}`);
});

test('хураангуй нь БОГИНО байна — контекстын төсөв', () => {
  const ctx = parseRevitContext({
    docTitle: 'MAX_URGUU_BA',
    revitVersion: '2027',
    activeViewName: 'Давхрын план 1',
    activeViewType: 'FloorPlan',
    levelName: '1 давхар',
    selection: Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, category: 'Хаалга' })),
    warnings: 4,
  });
  const sum = summarizeRevit(ctx)!;
  // 4K контекстод шигтгэх мөр — 400 тэмдэгтээс хэтрэх нь төсөв идэж эхэлнэ.
  assert.ok(sum.length < 400, `хураангуй хэт урт: ${sum.length}`);
});

test('ангиллаар бүлэглэж, олноос нь эрэмбэлнэ', () => {
  const ctx = parseRevitContext({
    selection: [
      { id: '1', category: 'Хана' },
      { id: '2', category: 'Хана' },
      { id: '3', category: 'Хаалга' },
    ],
  });
  const sum = summarizeRevit(ctx)!;
  assert.ok(sum.includes('Хана×2'));
  assert.ok(sum.indexOf('Хана×2') < sum.indexOf('Хаалга×1'));
});

test('хоосон контекст нь null өгнө — хоосон мөр prompt-д орохгүй', () => {
  assert.equal(summarizeRevit(parseRevitContext(null)), null);
  assert.equal(summarizeRevit(parseRevitContext({})), null);
});

test('нээлттэй гүйлгээ нь ил тэмдэглэгдэнэ', () => {
  const sum = summarizeRevit(
    parseRevitContext({ docTitle: 'A', transactionOpen: true }),
  )!;
  assert.ok(sum.includes('нээлттэй гүйлгээ'));
});

test('эвдэрсэн оролт нь УНАХГҮЙ', () => {
  const ctx = parseRevitContext({
    selection: [null, 'мөр', { нэр: 'id-гүй' }, { id: 7, category: 'Багана' }] as never,
    warnings: 'олон' as never,
    projectId: -5,
  });
  assert.equal(ctx.selection.length, 1);
  assert.equal(ctx.selection[0]!.id, '7');
  assert.equal(ctx.warningCount, 0);
  assert.equal(ctx.projectId, null);
});

/* ================================================================== */
/*  2. Урьдчилан харах — бичих үйлдлийн гэрээ                          */
/* ================================================================== */

function preview(over: Record<string, unknown> = {}) {
  return {
    tool: 'set_parameter',
    summaryMn: '17 ханын «Галд тэсвэрлэх зэрэг» параметрийг солино',
    affectedCount: 17,
    affectedIds: ['1', '2', '3'],
    changes: [{ field: 'Галд тэсвэрлэх зэрэг', from: 'REI 45', to: 'REI 60' }],
    reasonMn: 'БНбД 21-01-02-ын 4.2-т заасан шаардлагад нийцүүлэв',
    reversible: true,
    ...over,
  } as never;
}

test('бүрэн урьдчилсан харагдац асуудалгүй', () => {
  assert.deepEqual(validatePreview(preview()), []);
});

test('ТАЙЛБАРГҮЙ preview нь татгалзана', () => {
  assert.deepEqual(validatePreview(preview({ summaryMn: '  ' })), ['no_summary']);
});

test('ШАЛТГААНГҮЙ preview нь татгалзана', () => {
  // Хэрэглэгч «яагаад» гэдгийг мэдэхгүйгээр зөвшөөрөх ЁСГҮЙ.
  assert.deepEqual(validatePreview(preview({ reasonMn: '' })), ['no_reason']);
});

test('ТЭГ элемент хөндөх preview нь татгалзана', () => {
  assert.ok(validatePreview(preview({ affectedCount: 0 })).includes('zero_affected'));
});

test('тоо нь ID-ийн жагсаалтаас БАГА байвал татгалзана', () => {
  // Хуурамч тайван байдал: «2 элемент» гэж хэлээд 3 ID жагсаах.
  assert.ok(
    validatePreview(preview({ affectedCount: 2, affectedIds: ['1', '2', '3'] })).includes(
      'count_mismatch',
    ),
  );
});

test('өөрчлөлтгүй preview нь татгалзана', () => {
  assert.ok(validatePreview(preview({ changes: [] })).includes('no_changes'));
});

/* ================================================================== */
/*  3. Баталгаажуулах текст                                            */
/* ================================================================== */

test('баталгаажуулах текст нь ТОО, ID, ШАЛТГААНЫГ агуулна', () => {
  const text = renderPreviewMn(preview());
  assert.ok(text.includes('17'));
  assert.ok(text.includes('Галд тэсвэрлэх зэрэг'));
  assert.ok(text.includes('REI 45 → REI 60'));
  assert.ok(text.includes('БНбД 21-01-02'));
  assert.ok(text.includes('Буцаах: боломжтой'));
});

test('БУЦААХГҮЙ үйлдэл нь ТОДООР сануулна', () => {
  const text = renderPreviewMn(preview({ reversible: false }));
  assert.ok(text.includes('БОЛОМЖГҮЙ'));
});

test('олон ID нь таслагдаж, үлдсэн тоо харагдана', () => {
  const ids = Array.from({ length: 25 }, (_, i) => String(i));
  const text = renderPreviewMn(preview({ affectedCount: 25, affectedIds: ids }));
  assert.ok(text.includes('(+15)'));
});

/* ================================================================== */
/*  R3.5 — сонгосон элементийн ХЭМЖЭЭ → revit_selection хэрэгсэл       */
/* ================================================================== */

const { revitSelectionTool, MAX_MEASURES } = await import('./revitContext.ts');

const WALL = {
  id: 2786, category: 'Walls', family: 'Basic Wall', type: 'Wall 1', name: 'Wall 1', level: 'Level 1',
  measures: [
    { name: 'width_mm', value: 200, unit: 'MM', source: 'BUILTIN_GEOMETRY' },
    { name: 'length_mm', value: 10000, unit: 'MM', source: 'BUILTIN_GEOMETRY' },
    { name: 'height_mm', value: 3000, unit: 'MM', source: 'TYPED_PARAM' },
    { name: 'area_m2', value: 30, unit: 'M2', source: 'TYPED_PARAM' },
    // ⚠️ UntypedParam — mixed_provenance, ХЭЗЭЭ Ч баримт болохгүй
    { name: 'guess_mm', value: 999, unit: 'MM', source: 'UNTYPED_PARAM' },
    // буруу нэгж / нэр / missing
    { name: 'weird', value: 1, unit: 'KG', source: 'TYPED_PARAM' },
    { name: 'Bad Name', value: 1, unit: 'MM', source: 'TYPED_PARAM' },
    { name: 'gone_mm', value: 5, unit: 'MM', source: 'TYPED_PARAM', missing: true },
  ],
};

test('R3.5: хэмжээ зөвхөн BUILTIN_GEOMETRY/TYPED_PARAM, зөвшөөрсөн нэгж, missing биш', () => {
  const ctx = parseRevitContext({ docTitle: 'fixture', selection: [WALL] });
  assert.equal(ctx.selection.length, 1);
  assert.deepEqual(ctx.selection[0]!.measures.map((m) => m.name), ['width_mm', 'length_mm', 'height_mm', 'area_m2']);
  assert.equal(ctx.selection[0]!.name, 'Wall 1');
  assert.equal(ctx.selection[0]!.level, 'Level 1');
});

test('R3.5: хэмжээний тааз MAX_MEASURES, давхардсан нэр нэг л', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ name: `m${i}`, value: i, unit: 'MM', source: 'TYPED_PARAM' }));
  const ctx = parseRevitContext({ selection: [{ id: 1, category: 'Walls', measures: [...many, { name: 'm0', value: 77, unit: 'MM', source: 'TYPED_PARAM' }] }] });
  assert.equal(ctx.selection[0]!.measures.length, MAX_MEASURES);
  assert.equal(ctx.selection[0]!.measures[0]!.value, 0, 'давхардсан m0 нь эхнийхээ хадгална');
});

test('R3.5: revitSelectionTool — хавтгай тоо + units + REVIT_MODEL; хэмжээгүй бол null', () => {
  const ctx = parseRevitContext({ docTitle: 'fixture', selection: [WALL, { id: 5, category: 'Doors' }] });
  const t = revitSelectionTool(ctx)!;
  assert.equal(t.tool, 'revit_selection');
  assert.equal(t.data.source, 'REVIT_MODEL');
  assert.equal(t.data.selected_total, 2);
  assert.equal(t.data.measured_count, 1);
  const el = (t.data.elements as Record<string, unknown>[])[0]!;
  assert.equal(el.width_mm, 200);
  assert.equal(el.length_mm, 10000);
  assert.equal(el.height_mm, 3000);
  assert.equal((el.units as Record<string, string>).area_m2, 'M2');
  assert.equal('guess_mm' in el, false);
  assert.equal(revitSelectionTool(parseRevitContext({ selection: [{ id: 5, category: 'Doors' }] })), null);
  assert.equal(revitSelectionTool(parseRevitContext(null)), null);
});

test('R3.5: issues — ангилал цагаан жагсаалт, synthetic → authoritative ХЭЗЭЭ Ч биш, тааз MAX_ISSUES; хэмжээгүй ч issues байвал tool', async () => {
  const { MAX_ISSUES } = await import('./revitContext.ts');
  const issues = [
    { class: 'REVIEW_CANDIDATE', severity: 'LOW', status: 'HUMAN_REVIEW_REQUIRED', rule_id: 'synthetic.x', source: 'SYNTHETIC', synthetic: true, authoritative: true, title: '[СИНТЕТИК ТЕСТ] x' },
    { class: 'NORM_VIOLATION', severity: 'HIGH', status: 'OPEN' }, // танихгүй ангилал → хасагдана
    { class: 'MODEL_QUALITY', severity: 'MEDIUM', status: 'OPEN', rule_id: 'mq.room_not_enclosed', source: 'MODEL_QUALITY', synthetic: false, authoritative: true },
  ];
  const ctx = parseRevitContext({ docTitle: 'f', issuesTotal: 2, productionRules: 'NO_EXECUTABLE_BIM_RULES', selection: [{ id: 1, category: 'Walls', issues }] });
  assert.equal(ctx.issuesTotal, 2);
  assert.equal(ctx.productionRules, 'NO_EXECUTABLE_BIM_RULES');
  assert.deepEqual(ctx.selection[0]!.issues.map((i) => [i.class, i.synthetic, i.authoritative]), [['REVIEW_CANDIDATE', true, false], ['MODEL_QUALITY', false, false]]);
  const many = Array.from({ length: 20 }, () => ({ class: 'MODEL_QUALITY', severity: 'LOW', status: 'OPEN' }));
  assert.equal(parseRevitContext({ selection: [{ id: 1, category: 'Walls', issues: many }] }).selection[0]!.issues.length, MAX_ISSUES);
  const t = revitSelectionTool(ctx)!;
  assert.equal(t.data.production_rules, 'NO_EXECUTABLE_BIM_RULES');
  const el = (t.data.elements as Record<string, unknown>[])[0]!;
  assert.equal(el.issue_count, 2);
});

test('R3.5: report — parse, тааз, progress_estimate тогтмол; revitReportTool; isTestFixture', async () => {
  const { revitReportTool } = await import('./revitContext.ts');
  const report = { period: 'TODAY', audience: 'TECHNICAL_SELF_REPORT', title: 'Өнөөдрийн тайлан', lines: ['Сесс 09:15-д эхэлсэн', 'Хана 6 үүсгэсэн'], facts: [{ kind: 'SESSION_DURATION_MIN', number: 42, unit: 'min', source: 'SESSION' }, { kind: 'x', value: 'y' }], progress_estimate: '55%' };
  const ctx = parseRevitContext({ docTitle: 'f', isTestFixture: true, report, selection: [] });
  assert.equal(ctx.isTestFixture, true);
  assert.equal(ctx.report!.progress_estimate, 'PROGRESS_ESTIMATE_UNAVAILABLE', 'add-in юу ч илгээсэн тогтмол');
  assert.equal(ctx.report!.lines.length, 2);
  assert.equal(ctx.report!.facts[0]!.number, 42);
  const t = revitReportTool(ctx)!;
  assert.equal(t.tool, 'revit_report');
  assert.equal(t.data.document_is_test_fixture, true);
  assert.equal(t.data.progress_estimate, 'PROGRESS_ESTIMATE_UNAVAILABLE');
  assert.equal(revitReportTool(parseRevitContext({ report: { lines: [], facts: [] } })), null);
  assert.equal(parseRevitContext({ report: { lines: Array.from({ length: 100 }, () => 'x') } }).report!.lines.length, 40);
});
