/**
 * `lib/structureCopyPlan.ts`-ийн тест.
 *
 * Уг модуль нь ЯМАР Ч импортгүй цэвэр функц тул `webPush.test.ts` /
 * `workSchedule.test.ts`-ийн `registerHooks` resolver ШААРДЛАГАГҮЙ — шууд
 * статик `.ts` импорт хийж болно (`leaveOverlap.test.ts`-тэй ижил).
 *
 * Run:  node --test src/lib/structureCopyPlan.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planStructureCopy,
  type CopyPlan,
  type CopySourceTree,
  type CopyWarningCode,
} from './structureCopyPlan.ts';

/* ------------------------------------------------------------------ */
/*  Фикстур — «цэвэр» 100%-ийн мод                                     */
/* ------------------------------------------------------------------ */
//
//  BA (60%) ── А блок (100)  ── АЗ-01 (60) ── Тавцан ── 30 + 30
//                              └ АЗ-02 (40) ── Хучилт ── 40
//  BB (40%) ── Б блок (100)  ── ББ-01 (100) ─ Суурь  ── 50
//                                            └ Багана ── 50
//
//  Бүх ажил 100% болбол төсөл ЯГ 100% заана.
function cleanTree(): CopySourceTree {
  return {
    team_shares: [
      { team_id: 1, team_code: 'BA', team_name: 'Барилга', share_percent: 60, sort_order: 10 },
      { team_id: 2, team_code: 'BB', team_name: 'Бетон', share_percent: 40, sort_order: 20 },
    ],
    blocks: [
      {
        id: 1,
        name: 'А блок',
        weight_percent: 100,
        sort_order: 10,
        team_id: 1,
        responsible_name: null,
      },
      {
        id: 2,
        name: 'Б блок',
        weight_percent: 100,
        sort_order: 20,
        team_id: 2,
        responsible_name: 'Д.Болд',
      },
    ],
    drawings: [
      { id: 11, block_id: 1, name: 'АЗ-01', weight_percent: 60, sort_order: 10 },
      { id: 12, block_id: 1, name: 'АЗ-02', weight_percent: 40, sort_order: 20 },
      { id: 13, block_id: 2, name: 'ББ-01', weight_percent: 100, sort_order: 10 },
    ],
    components: [
      { id: 21, drawing_id: 11, name: 'Тавцан', weight_percent: 100, sort_order: 10 },
      { id: 22, drawing_id: 12, name: 'Хучилт', weight_percent: 100, sort_order: 10 },
      { id: 23, drawing_id: 13, name: 'Суурь', weight_percent: 50, sort_order: 10 },
      { id: 24, drawing_id: 13, name: 'Багана', weight_percent: 50, sort_order: 20 },
    ],
    tasks: [
      { id: 31, component_id: 21, name: 'Төлөвлөлт', weight_percent: 30, sort_order: 10 },
      { id: 32, component_id: 21, name: 'Зангилаа', weight_percent: 30, sort_order: 20 },
      { id: 33, component_id: 22, name: 'Хэсэг', weight_percent: 40, sort_order: 10 },
      { id: 34, component_id: 23, name: 'Арматур', weight_percent: 50, sort_order: 10 },
      { id: 35, component_id: 24, name: 'Хөндлөн', weight_percent: 50, sort_order: 10 },
    ],
  };
}

/** Сануулгын кодууд (дараалалгүй харьцуулахад). */
function codes(plan: CopyPlan): CopyWarningCode[] {
  return plan.warnings.map((w) => w.code);
}

function warnCount(plan: CopyPlan, code: CopyWarningCode): number | undefined {
  return plan.warnings.find((w) => w.code === code)?.count;
}

/* ------------------------------------------------------------------ */
/*  Тестүүд                                                            */
/* ------------------------------------------------------------------ */

test('бүтэн хуулбар: тааз ЯГ 100, тоолуурууд бүрэн', () => {
  const plan = planStructureCopy(cleanTree(), {});

  assert.equal(plan.ceiling_pct, 100);
  assert.deepEqual(plan.counts, { teams: 2, blocks: 2, drawings: 3, components: 4, tasks: 5 });
  assert.deepEqual(plan.pruned, { teams: [], blocks: [], drawings: [], components: [] });
  assert.deepEqual(codes(plan), []);
});

test('null/undefined сонголт = «бүгд» — {} болон бүх талбар null нь ижил', () => {
  const a = planStructureCopy(cleanTree(), {});
  const b = planStructureCopy(cleanTree(), {
    team_ids: null,
    block_ids: null,
    drawing_ids: null,
    component_ids: null,
    task_ids: null,
  });
  assert.deepEqual(b, a);
});

test('хэсэгчилсэн багийн сонголт: тааз = үлдсэн эзэмшлийн нийлбэр (60)', () => {
  const plan = planStructureCopy(cleanTree(), { team_ids: [1] });

  assert.equal(plan.ceiling_pct, 60);
  assert.equal(plan.counts.teams, 1);
  assert.equal(plan.counts.blocks, 1);
  const block = plan.blocks[0];
  assert.ok(block);
  assert.equal(block.team_id, 1);
  assert.equal(block.team_code, 'BA');

  // Салгагдсан баг/блок нь pruned-д ОРОХГҮЙ (зөвхөн каскад устгалт ордог).
  assert.deepEqual(plan.pruned.teams, []);
  assert.deepEqual(plan.pruned.blocks, []);

  // Таазыг нуухгүй — улаанаар харуулах сануулга.
  assert.ok(codes(plan).includes('CEILING_BELOW_100'));
  assert.equal(plan.warnings.find((w) => w.code === 'CEILING_BELOW_100')?.detail, '60');

  // ЖИН ХЭВЭЭРЭЭ: 60 хэвээр, 100 болж «зассан» байх ЁСГҮЙ.
  const share = plan.team_shares[0];
  assert.ok(share);
  assert.equal(share.share_percent, 60);
});

test('баг нь салгагдсан блок алга болно (эх модод үлдсэн зураг байсан ч)', () => {
  const plan = planStructureCopy(cleanTree(), { team_ids: [2] });

  assert.equal(plan.counts.blocks, 1);
  const block = plan.blocks[0];
  assert.ok(block);
  assert.equal(block.src_id, 2);
  assert.equal(plan.ceiling_pct, 40);
});

test('жин 0 зураг rollup-д 0 оруулна (ELSE 0 хаалт)', () => {
  const tree = cleanTree();
  const d12 = tree.drawings.find((d) => d.id === 12);
  assert.ok(d12);
  d12.weight_percent = 0;

  const plan = planStructureCopy(tree, {});

  // А блок: зөвхөн АЗ-01 (60) → 60; төсөл = 60×0.6 + 100×0.4 = 76
  assert.equal(plan.ceiling_pct, 76);
  assert.equal(warnCount(plan, 'ZERO_WEIGHT_DRAWING'), 1);
  // Жин 0 зургийн ажлын төсвийг шалгахгүй — давхар сануулга гарахгүй.
  assert.ok(!codes(plan).includes('TASK_WEIGHTS_UNDER_BUDGET'));
  // Мөр нь ХУУЛАГДСАН хэвээр (0 жинтэйгээ), зүгээр л 0 оруулж байна.
  const block = plan.blocks[0];
  assert.ok(block);
  assert.equal(block.drawings.length, 2);
});

test('жин 0 блок мөн 0 оруулна', () => {
  const tree = cleanTree();
  const b1 = tree.blocks.find((b) => b.id === 1);
  assert.ok(b1);
  b1.weight_percent = 0;

  const plan = planStructureCopy(tree, {});
  assert.equal(plan.ceiling_pct, 40);
  assert.equal(warnCount(plan, 'ZERO_WEIGHT_BLOCK'), 1);
  assert.equal(plan.counts.blocks, 2); // хуулагдсан хэвээр
});

test('ажлын жин төсвөөс дутуу (1500 vs 575) — тааз буурна, ХЯЗГААРЛАЛТГҮЙ', () => {
  // Бодит продакшны хэлбэр: зургийн төсөв 1500, ажлууд нийлээд 575.
  const tree: CopySourceTree = {
    team_shares: [
      { team_id: 1, team_code: 'BA', team_name: 'Барилга', share_percent: 100, sort_order: 10 },
    ],
    blocks: [
      {
        id: 1,
        name: 'А блок',
        weight_percent: 100,
        sort_order: 10,
        team_id: 1,
        responsible_name: null,
      },
    ],
    drawings: [{ id: 11, block_id: 1, name: 'АЗ-01', weight_percent: 1500, sort_order: 10 }],
    components: [{ id: 21, drawing_id: 11, name: 'Тавцан', weight_percent: 0, sort_order: 10 }],
    tasks: [
      { id: 31, component_id: 21, name: 'Ажил 1', weight_percent: 500, sort_order: 10 },
      { id: 32, component_id: 21, name: 'Ажил 2', weight_percent: 75, sort_order: 20 },
    ],
  };

  const plan = planStructureCopy(tree, {});

  // Зураг 575/1500 = 38.33% → блок 1500×38.33/100 = 575 → төсөл 575.
  // Дээд тал нь 100 гэж ХЯЗГААРЛАХГҮЙ: муу жингийн өгөгдөл ил байх ёстой.
  assert.equal(plan.ceiling_pct, 575);
  assert.equal(warnCount(plan, 'TASK_WEIGHTS_UNDER_BUDGET'), 1);
  assert.ok(!codes(plan).includes('CEILING_BELOW_100'));
});

test('ажлын жин төсвөөс хэтэрсэн — OVER_BUDGET, хүлцэл 0.5', () => {
  const tree = cleanTree();
  const t33 = tree.tasks.find((t) => t.id === 33);
  assert.ok(t33);

  // 40 → 40.4: хүлцэл (0.5) дотор тул сануулга ГАРАХГҮЙ.
  t33.weight_percent = 40.4;
  const within = planStructureCopy(tree, {});
  assert.deepEqual(codes(within), []);
  assert.equal(within.ceiling_pct, 100.24); // 0.4 нь ЖИНХЭНЭЭР таазанд нэмэгдэнэ

  // 40 → 41: хүлцлээс давсан.
  t33.weight_percent = 41;
  const plan = planStructureCopy(tree, {});
  assert.equal(warnCount(plan, 'TASK_WEIGHTS_OVER_BUDGET'), 1);
});

test('каскад тайралт: бүрэлдэхүүн → зураг → блок → багийн эзэмшил', () => {
  // ББ-01-ийн бүх ажлыг (34, 35) салгав.
  const plan = planStructureCopy(cleanTree(), { task_ids: [31, 32, 33] });

  assert.deepEqual(plan.pruned.components, [
    { src_id: 23, name: 'Суурь', reason: 'NO_TASKS' },
    { src_id: 24, name: 'Багана', reason: 'NO_TASKS' },
  ]);
  assert.deepEqual(plan.pruned.drawings, [
    { src_id: 13, name: 'ББ-01', reason: 'NO_COMPONENTS' },
  ]);
  assert.deepEqual(plan.pruned.blocks, [{ src_id: 2, name: 'Б блок', reason: 'NO_DRAWINGS' }]);
  assert.deepEqual(plan.pruned.teams, [{ team_id: 2, team_code: 'BB', reason: 'NO_BLOCKS' }]);

  assert.deepEqual(plan.counts, { teams: 1, blocks: 1, drawings: 2, components: 2, tasks: 3 });
  assert.equal(plan.ceiling_pct, 60);
  assert.equal(warnCount(plan, 'TEAM_WITHOUT_BLOCKS'), 1);
});

test('баггүй блок: багийн шүүлтгүй үед үлдэж, сануулга өгч, 0 оруулна', () => {
  const tree = cleanTree();
  const b2 = tree.blocks.find((b) => b.id === 2);
  assert.ok(b2);
  b2.team_id = null;

  const kept = planStructureCopy(tree, {});
  assert.equal(kept.counts.blocks, 2);
  assert.equal(warnCount(kept, 'BLOCK_WITHOUT_TEAM'), 1);
  const b = kept.blocks.find((x) => x.src_id === 2);
  assert.ok(b);
  assert.equal(b.team_id, null);
  assert.equal(b.team_code, null);
  assert.equal(kept.ceiling_pct, 60); // BB-гийн 40 нь эзэнгүй болсон
  // BB баг блокгүй үлдсэн тул каскадаар хасагдана.
  assert.deepEqual(kept.pruned.teams, [{ team_id: 2, team_code: 'BB', reason: 'NO_BLOCKS' }]);

  // Мэргэжлийн шүүлт баггүй блокийг ХЭЗЭЭ Ч хасахгүй: аль ч мэргэжилд
  // харьяалагдахгүй тул шүүлтийн гадна байна.
  const filtered = planStructureCopy(tree, { team_ids: [1, 2] });
  assert.equal(filtered.counts.blocks, 2);
  assert.equal(warnCount(filtered, 'BLOCK_WITHOUT_TEAM'), 1);
  assert.deepEqual(filtered.pruned.blocks, []);
});

test('баггүй блок: мэргэжлийн ДЭД сонголт түүнийг хасахгүй (block_ids шийднэ)', () => {
  const tree = cleanTree();
  const b2 = tree.blocks.find((b) => b.id === 2);
  assert.ok(b2);
  b2.team_id = null;

  // BA (team 1) л сонгогдсон ч баггүй Б блок нь `block_ids`-д байгаа тул үлдэнэ.
  const plan = planStructureCopy(tree, { team_ids: [1], block_ids: [1, 2] });

  assert.equal(plan.counts.blocks, 2);
  assert.deepEqual(
    plan.blocks.map((b) => b.src_id),
    [1, 2],
  );
  const orphan = plan.blocks.find((b) => b.src_id === 2);
  assert.ok(orphan);
  assert.equal(orphan.team_id, null);
  assert.equal(orphan.team_code, null);
  // Мөрүүд нь бүрэн хуулагдана (зураг → бүрэлдэхүүн → ажил).
  assert.equal(plan.counts.drawings, 3);
  assert.equal(plan.counts.tasks, 5);

  // Байдал ил: сануулга хэвээр.
  assert.equal(warnCount(plan, 'BLOCK_WITHOUT_TEAM'), 1);

  // ⚠️ Тааз нь ЗӨВХӨН BA-гийн 60 — баггүй блок эзэмшилгүй тул 0 оруулна.
  //    Энэ нь ҮНЭНЧ: ажлын мөрийг хуулж байгаа ч байхгүй жинг зохиохгүй.
  assert.equal(plan.ceiling_pct, 60);
  assert.equal(plan.counts.teams, 1);
});

test('баггүй блок: block_ids түүнийг орхивол хасагдана, pruned-д ОРОХГҮЙ', () => {
  const tree = cleanTree();
  const b2 = tree.blocks.find((b) => b.id === 2);
  assert.ok(b2);
  b2.team_id = null;

  const plan = planStructureCopy(tree, { team_ids: [1], block_ids: [1] });

  assert.equal(plan.counts.blocks, 1);
  const only = plan.blocks[0];
  assert.ok(only);
  assert.equal(only.src_id, 1);
  // admin өөрөө салгасан — каскад биш тул pruned хоосон.
  assert.deepEqual(plan.pruned.blocks, []);
  // Үлдсэн блок бүр багтай тул сануулга гарахгүй.
  assert.ok(!codes(plan).includes('BLOCK_WITHOUT_TEAM'));
  assert.equal(plan.ceiling_pct, 60);
});

test('хоосон сонголт: бүх тоолуур 0, тааз 0, алдаа шидэхгүй', () => {
  const empty = planStructureCopy(cleanTree(), { block_ids: [] });
  assert.deepEqual(empty.counts, { teams: 0, blocks: 0, drawings: 0, components: 0, tasks: 0 });
  assert.equal(empty.ceiling_pct, 0);
  assert.deepEqual(empty.blocks, []);
  assert.deepEqual(empty.team_shares, []);

  // Ажлыг бүхэлд нь салгавал каскадаар бүх шат тайрагдана.
  const noTasks = planStructureCopy(cleanTree(), { task_ids: [] });
  assert.deepEqual(noTasks.counts, { teams: 0, blocks: 0, drawings: 0, components: 0, tasks: 0 });
  assert.equal(noTasks.ceiling_pct, 0);
  assert.equal(noTasks.pruned.components.length, 4);
  assert.equal(noTasks.pruned.drawings.length, 3);
  assert.equal(noTasks.pruned.blocks.length, 2);
  assert.equal(noTasks.pruned.teams.length, 2);

  // Огт мод байхгүй ч унахгүй.
  const bare = planStructureCopy(
    { team_shares: [], blocks: [], drawings: [], components: [], tasks: [] },
    {},
  );
  assert.equal(bare.ceiling_pct, 0);
  assert.deepEqual(bare.counts, { teams: 0, blocks: 0, drawings: 0, components: 0, tasks: 0 });
});

test('ЖИН БАЙТ ЯГ ХЭВЭЭР — бутархай утга ч дугуйлагдахгүй', () => {
  const tree = cleanTree();
  const shareBa = tree.team_shares[0];
  const b1 = tree.blocks[0];
  const d11 = tree.drawings[0];
  const c21 = tree.components[0];
  const t31 = tree.tasks[0];
  assert.ok(shareBa && b1 && d11 && c21 && t31);
  shareBa.share_percent = 33.33;
  b1.weight_percent = 12.345;
  d11.weight_percent = 7.77;
  c21.weight_percent = 66.666;
  t31.weight_percent = 3.14159;

  const plan = planStructureCopy(tree, {});
  const outShare = plan.team_shares.find((s) => s.team_id === 1);
  const outBlock = plan.blocks.find((b) => b.src_id === 1);
  assert.ok(outShare && outBlock);
  const outDrawing = outBlock.drawings.find((d) => d.src_id === 11);
  assert.ok(outDrawing);
  const outComponent = outDrawing.components.find((cm) => cm.src_id === 21);
  assert.ok(outComponent);
  const outTask = outComponent.tasks.find((t) => t.src_id === 31);
  assert.ok(outTask);

  assert.equal(outShare.share_percent, 33.33);
  assert.equal(outBlock.weight_percent, 12.345);
  assert.equal(outDrawing.weight_percent, 7.77);
  // ⚠️ Бүрэлдэхүүний жин ямар ч rollup-д оролцохгүй ч ҮНЭНЧ хуулагдана.
  assert.equal(outComponent.weight_percent, 66.666);
  assert.equal(outTask.weight_percent, 3.14159);

  // Мета талбарууд бас хэвээр.
  assert.equal(outBlock.name, 'А блок');
  assert.equal(outBlock.sort_order, 10);
  const outBlock2 = plan.blocks.find((b) => b.src_id === 2);
  assert.ok(outBlock2);
  assert.equal(outBlock2.responsible_name, 'Д.Болд');
  assert.equal(outBlock2.team_code, 'BB');
});

test('дараалал: (sort_order, id) — sort_order давхардсан ч тогтвортой', () => {
  const tree = cleanTree();
  // Хоёр блокийн sort_order-ийг тэнцүү болгоод, оролтын дарааллыг эсрэгээр.
  const b1 = tree.blocks.find((b) => b.id === 1);
  const b2 = tree.blocks.find((b) => b.id === 2);
  assert.ok(b1 && b2);
  b1.sort_order = 5;
  b2.sort_order = 5;
  tree.blocks = [b2, b1];
  tree.drawings = [...tree.drawings].reverse();
  tree.tasks = [...tree.tasks].reverse();

  const plan = planStructureCopy(tree, {});
  assert.deepEqual(
    plan.blocks.map((b) => b.src_id),
    [1, 2],
  );
  const first = plan.blocks[0];
  assert.ok(first);
  assert.deepEqual(
    first.drawings.map((d) => d.src_id),
    [11, 12],
  );
  const firstDrawing = first.drawings[0];
  assert.ok(firstDrawing);
  const firstComponent = firstDrawing.components[0];
  assert.ok(firstComponent);
  assert.deepEqual(
    firstComponent.tasks.map((t) => t.src_id),
    [31, 32],
  );
});

test('детерминист: ижил оролт → яг ижил гаралт', () => {
  const selection = { team_ids: [1, 2], drawing_ids: [11, 12, 13] };
  const a = planStructureCopy(cleanTree(), selection);
  const b = planStructureCopy(cleanTree(), selection);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('давхардсан id-тай сонголт нь мөрийг давхарлахгүй', () => {
  const plan = planStructureCopy(cleanTree(), { task_ids: [31, 31, 32, 33, 34, 35] });
  assert.equal(plan.counts.tasks, 5);
  assert.equal(plan.ceiling_pct, 100);
});
