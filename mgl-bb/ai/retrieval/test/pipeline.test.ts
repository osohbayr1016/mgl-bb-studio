/**
 * MGL AI retrieval · ХООЛОЙ ба ШИНГЭЭЛТ — ТЕСТ
 * (§18: «retrieval», «citations», «confidentiality», «permission filtering»).
 *
 * Run with:  node --test retrieval/test/pipeline.test.ts
 *
 * ⚠️ ЭНЭ ФАЙЛ БОДИТ БАГЦУУДЫГ ШИНГЭЭНЭ.  Хиймэл фикстур нь эрэмбийн алдааг
 *    нуудаг — 170 гаруй хэсэг, 150 гаруй дүрмийн дунд ах дүү мөрүүд
 *    өрсөлдөж байж л сонголт шалгагдана.  Багц олдохгүй бол тестүүд
 *    АЛГАСНА (унахгүй): `ai/data-train-files/` нь git-д ороогүй байж болно.
 *
 * ⚠️ ХОЁР БАРИМТ ЗЭРЭГ ШИНГЭНЭ.  Нэг баримтын тест нөгөөгийнхөө оршихыг
 *    үл тоомсорлож болохгүй: 2026-09-09-нд хоёр дахь багц ирэхэд НЭГ
 *    ЗААЛТАД ОЛОН ДҮРЭМ ноогдох болсон ба `LIMIT 1` гэсэн шийдэл
 *    чимээгүй буруу дүрэм сонгож эхэлсэн.
 */
import { anchorTerms, hasAnchor } from '../src/pipeline.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openKnowledgeDb } from '../src/db.ts';
import { ingestDataset } from '../src/ingest.ts';
import { askNorm } from '../src/pipeline.ts';
import { normalizeQuery } from '../src/normalize.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', 'data-train-files');
const FIRE = join(ROOT, 'MGL_AI_BNbD_21_04_05_dataset');
const CLIENT = join(ROOT, 'MGL_AI_UBB_12_01_01_dataset');
const GUIDE = join(ROOT, 'MGL_AI_UBB_11_201_00_dataset');

const HAVE_FIRE = existsSync(join(FIRE, 'rules.jsonl'));
const HAVE_CLIENT = existsSync(join(CLIENT, 'obligation_rules.jsonl'));
const HAVE_GUIDE = existsSync(join(GUIDE, 'general_principles.jsonl'));
const skipFire = HAVE_FIRE ? false : 'БНбД багц олдсонгүй';
const skipClient = HAVE_CLIENT ? false : 'УББ багц олдсонгүй';
const skipGuide = HAVE_GUIDE ? false : 'УББ-11-201-00 багц олдсонгүй';
const skipBoth = HAVE_FIRE && HAVE_CLIENT ? false : 'хоёр багцын аль нэг олдсонгүй';
const skipAll = HAVE_FIRE && HAVE_CLIENT && HAVE_GUIDE ? false : 'гурван багцын аль нэг олдсонгүй';

/** ⚠️ `:memory:` — тест нь ажилтны бодит мэдлэгийн санг ХЭЗЭЭ Ч хөндөхгүй. */
function fresh(folders: string[]) {
  const db = openKnowledgeDb({ path: ':memory:' });
  const counts = folders.map((f) => ingestDataset(db, f));
  return { db, counts };
}

/* ── Шингээлт ────────────────────────────────────────────────────── */

test('БНбД багц — бүх хэсэг, дүрэм, тест орно', { skip: skipFire }, () => {
  const { db, counts } = fresh([FIRE]);
  const c = counts[0]!;
  assert.equal(c.profile, 'table_rules');
  assert.equal(c.chunks, 126);
  assert.equal(c.rules, 112);
  assert.equal(c.tests, 336);
  assert.equal(c.cases, 11);
  // ⚠️ Багц өөрөө 6 мөрийг «хүний хяналт хүлээж буй» гэж тэмдэглэсэн.
  assert.equal(c.unverifiedRules, 6);
  assert.equal(c.orphanRules.length, 0, 'эх хэсэггүй дүрэм байж БОЛОХГҮЙ');
  db.close();
});

test('УББ багц — үүрэг/эрх/хариуцлага/босго тусад нь тоологдоно', { skip: skipClient }, () => {
  const { db, counts } = fresh([CLIENT]);
  const c = counts[0]!;
  assert.equal(c.profile, 'clause_rules');
  assert.equal(c.chunks, 46);
  assert.equal(c.rulesByKind.obligation, 33);
  assert.equal(c.rulesByKind.right, 5);
  assert.equal(c.rulesByKind.responsibility, 1);
  // 4 босго = 2 threshold + 2 deadline (rule_id-аар ялгагдана).
  assert.equal((c.rulesByKind.threshold ?? 0) + (c.rulesByKind.deadline ?? 0), 4);
  assert.equal(c.orphanRules.length, 0);
  db.close();
});

test('хоёр багц ЗЭРЭГ оршино — нэг нь нөгөөгөө УСТГАХГҮЙ', { skip: skipBoth }, () => {
  const { db } = fresh([FIRE, CLIENT]);
  const docs = db.prepare('SELECT COUNT(*) AS n FROM ai_documents').get() as { n: number };
  const chunks = db.prepare('SELECT COUNT(*) AS n FROM ai_chunks').get() as { n: number };
  const fts = db.prepare('SELECT COUNT(*) AS n FROM ai_chunks_fts').get() as { n: number };
  assert.equal(docs.n, 2);
  assert.equal(chunks.n, 126 + 46);
  // ⚠️ FTS давхардвал BM25 нэг мөрийг хоёр удаа тоолж эрэмбийг гажуудуулна.
  assert.equal(fts.n, chunks.n, 'FTS индекс ба хэсгийн тоо ЗӨРВӨЛ хайлт эвдэрнэ');

  // ⚠️ Alias цэвэрлэгээ нь БАРИМТААР хязгаарлагдсан эсэх.  Эхний хувилбар
  //    нь `DELETE FROM ai_aliases` бүрэн хийдэг байсан — хоёр дахь багц
  //    эхнийхийнхээ alias-ыг аваад явна.
  const fireAliases = db
    .prepare("SELECT COUNT(*) AS n FROM ai_aliases WHERE canonical LIKE 'BNBD-%'")
    .get() as { n: number };
  assert.ok(fireAliases.n > 0, 'эхний багцын alias хоёр дахийг шингээхэд алга болов');
  db.close();
});

test('шингээлт нь ИДЕМПОТЕНТ — хоёр удаа ажиллуулахад давхардахгүй', { skip: skipBoth }, () => {
  const { db } = fresh([FIRE, CLIENT]);
  ingestDataset(db, FIRE);
  ingestDataset(db, CLIENT);
  const chunks = db.prepare('SELECT COUNT(*) AS n FROM ai_chunks').get() as { n: number };
  const fts = db.prepare('SELECT COUNT(*) AS n FROM ai_chunks_fts').get() as { n: number };
  assert.equal(chunks.n, 126 + 46);
  assert.equal(fts.n, chunks.n);
  db.close();
});

/* ── Хариулт ─────────────────────────────────────────────────────── */

test('монгол асуулт → зөв дүрэм, эшлэлтэй, детерминист шийдвэр', { skip: skipFire }, () => {
  const { db } = fresh([FIRE]);
  const a = askNorm(db, '310 м² А ангиллын агуулахын өрөөнд ямар автомат систем хэрэгтэй вэ?', {
    context: { area_m2: 310, fire_hazard_category: 'A', room_use: 'storage' },
  });
  assert.equal(a.status, 'verified');
  assert.equal(a.decisions.GUAT, true);
  assert.equal(a.decisions.GMDH, false);
  assert.ok(a.citation !== null && a.citation.page !== null, 'эшлэлгүй норматив хариу ГАРАХГҮЙ');
  db.close();
});

test('босгын нөгөө тал — 290 м² нь ГМДХ болно', { skip: skipFire }, () => {
  const { db } = fresh([FIRE]);
  const a = askNorm(db, '290 м² А ангиллын агуулахын өрөө', {
    context: { area_m2: 290, fire_hazard_category: 'A', room_use: 'storage' },
  });
  assert.equal(a.decisions.GUAT, false);
  assert.equal(a.decisions.GMDH, true);
  db.close();
});

test('УББ — хөрөнгө оруулалтын босго детерминистээр тооцогдоно', { skip: skipClient }, () => {
  const { db } = fresh([CLIENT]);
  const over = askNorm(db, 'Жилийн хөрөнгө оруулалт 1.2 тэрбум төгрөг бол бие даасан алба байгуулах уу?', {
    context: { annual_investment_mnt: 1_200_000_000 },
  });
  assert.equal(over.rule_kind, 'threshold');
  assert.equal(over.decisions.effect, true);

  // ⚠️ ЯГ БОСГО ДЭЭР.  Эх сурвалж «ДЭЭШ» гэсэн тул 1.0 тэрбум нь ОРОХГҮЙ.
  const exact = askNorm(db, 'Жилийн хөрөнгө оруулалт 1.0 тэрбум төгрөг бол бие даасан алба байгуулах уу?', {
    context: { annual_investment_mnt: 1_000_000_000 },
  });
  assert.equal(exact.decisions.effect, false);
  db.close();
});

test('УББ — үүргийн заалт нь «эргэлзээтэй» БИШ, эшлэлтэй хариу', { skip: skipClient }, () => {
  const { db } = fresh([CLIENT]);
  const a = askNorm(db, 'Захиалагч барилга эхлүүлэх зөвшөөрлийг хэнээс авах вэ?');
  // ⚠️ Тоон нөхцөлгүй заалтыг `uncertain` гэж тэмдэглэвэл ЗӨВ хариу
  //    эргэлзээтэй мэт харагдана.
  assert.ok(['supported', 'verified'].includes(a.status), `хүлээгээгүй төлөв: ${a.status}`);
  assert.ok(a.evidence.length > 0);
  assert.ok(a.citation !== null && a.citation.page !== null);
  db.close();
});

test('⚠️ нэг заалтад олон дүрэм — нөхцөл өгвөл ТООЦООЛОХ дүрэм ялна', { skip: skipClient }, () => {
  const { db } = fresh([CLIENT]);
  // УББ-ийн 1.3-р заалт нь үүрэг БА босго хоёуланг агуулдаг.
  const withNumber = askNorm(db, 'УББ 12-01-01-ийн 1.3 заалт', {
    context: { annual_investment_mnt: 1_200_000_000 },
  });
  assert.equal(withNumber.rule_kind, 'threshold', 'тоо өгсөн үед босгын дүрэм ялах ёстой');

  // Тоо өгөөгүй бол заалтын ЭХ БИЧВЭР илүү тустай.
  const withoutNumber = askNorm(db, 'УББ 12-01-01-ийн 1.3 заалт');
  assert.ok(withoutNumber.evidence.length > 0);
  db.close();
});

test('УББ — заалтыг ДУГААРААР нь шууд олно (монгол үгийн дараалал)', { skip: skipClient }, () => {
  const { db } = fresh([CLIENT]);
  // ⚠️ Монголд тоо нь нэр томьёоны ӨМНӨ: «1.1 заалтад».  Зөвхөн
  //    «заалт 1.1» дарааллыг барих нь бүх монгол асуултыг алддаг.
  const a = askNorm(db, 'УББ 12-01-01-ийн 1.1 заалтад юу гэж заасан бэ?');
  assert.equal(a.evidence[0]?.clause_no, '1.1');
  db.close();
});

test('шууд нэрлэсэн хүснэгт/мөр нь бүх зүйлээс дээгүүр', { skip: skipFire }, () => {
  const { db } = fresh([FIRE]);
  const a = askNorm(db, 'БНбД 21-04-05 Хүснэгт 3 мөр 1-д юу гэж заасан бэ?');
  assert.equal(a.evidence[0]?.table_no, 3);
  assert.equal(a.evidence[0]?.row_no, '1');
  db.close();
});

test('латин галигаар бичсэн асуулт мөн ажиллана', { skip: skipFire }, () => {
  const { db } = fresh([FIRE]);
  const a = askNorm(db, 'Galyn ayuulyn V angillyn 5.5 m-ees undur taviurtai aguulakh');
  assert.ok(a.evidence.length > 0, 'латин галиг индекстэй таарах ёстой');
  db.close();
});

test('нотолгоо олдохгүй бол НОРМ ЗОХИОХГҮЙ', { skip: skipFire }, () => {
  const { db } = fresh([FIRE]);
  const a = askNorm(db, 'zzzqqq wwwxxx yyyvvv');
  assert.equal(a.status, 'insufficient_evidence');
  assert.equal(a.rule_id, null);
  assert.deepEqual(a.decisions, {});
  db.close();
});

/* ── Хаалганууд ──────────────────────────────────────────────────── */

test('БАТАЛГААЖААГҮЙ дүрэм «verified» болж ХЭЗЭЭ Ч гоожихгүй', { skip: skipFire }, () => {
  const { db } = fresh([FIRE]);
  const unverified = db
    .prepare("SELECT rule_id, object_mn FROM ai_rules WHERE verification_status <> 'verified_from_page_image'")
    .all() as Array<{ rule_id: string; object_mn: string }>;
  assert.ok(unverified.length > 0, 'багцад баталгаажаагүй мөр байх ёстой');

  for (const r of unverified) {
    // Дүрмийн нэрийг нь ШУУД асууна — хамгийн таатай нөхцөлд ч гоожихгүй
    // байх ёстой.
    const a = askNorm(db, r.object_mn, { context: { area_m2: 100000 } });
    if (a.rule_id === r.rule_id) {
      assert.notEqual(a.status, 'verified', `${r.rule_id} итгэлтэй хариу болов`);
    }
  }
  db.close();
});

test('захиалагч нь нээлттэй нормоос гадуур ЮУ Ч харахгүй (§6)', { skip: skipFire }, () => {
  const { db } = fresh([FIRE]);
  // Нэг хэсгийг ЗОРИУД дотоод болгоно — шүүлт ажиллаж байгаа эсэхийг
  // ХӨДӨЛГӨӨНД шалгах цорын ганц арга.
  const target = db.prepare('SELECT chunk_id, text_mn FROM ai_chunks LIMIT 1').get() as {
    chunk_id: string;
    text_mn: string;
  };
  db.prepare("UPDATE ai_chunks SET visibility = 'company' WHERE chunk_id = ?").run(target.chunk_id);

  const asClient = askNorm(db, target.text_mn.slice(0, 60), { audience: 'client' });
  assert.ok(
    !asClient.evidence.some((e) => e.chunk_id === target.chunk_id),
    'захиалагчид хаалттай мөр гоожив',
  );

  const asEmployee = askNorm(db, target.text_mn.slice(0, 60), { audience: 'employee' });
  assert.ok(asEmployee.evidence.length > 0, 'ажилтанд хэвээр харагдана');
  db.close();
});

test('хуулийн хүчинтэй байдал шалгагдаагүй нь эшлэл бүрд ИЛ гарна', { skip: skipBoth }, () => {
  const { db } = fresh([FIRE, CLIENT]);
  for (const q of ['300 м² агуулах', 'захиалагчийн үүрэг']) {
    const a = askNorm(db, q);
    if (a.citation !== null) {
      // ⚠️ Хоёр баримт хоёулаа «дараагийн нэмэлт орлуулсан эсэхийг
      //    шалгаагүй» гэж ӨӨРСДӨӨ хэлдэг.  Түүнийг нуух нь мэргэжлийн
      //    эрсдэл.
      assert.equal(a.citation.legal_review_required, true, `${q}: хуулийн анхааруулга алга`);
    }
  }
  db.close();
});

/* ── Профайл 3: аргачилсан заавар (УББ-11-201-00) ────────────────── */

test('аргачилсан зааврын багц — 71 заалт + 5 тоон утга нэг ангилалд', { skip: skipGuide }, () => {
  const { db, counts } = fresh([GUIDE]);
  const c = counts[0]!;
  assert.equal(c.profile, 'guideline_rules');
  // 71 заалт + 2 метадата.
  assert.equal(c.chunks, 73);
  // 7+12+8+22+12+10 = 71 шаардлага, дээр нь 5 тоон утга.
  assert.equal(c.rulesByKind.requirement, 76);
  assert.equal(c.tests, 231);
  assert.equal(c.cases, 2);
  // ⚠️ Зургаан файлын дүрэм БҮГД эх заалтдаа холбогдох ЁСТОЙ.  Дүрэм нь
  //    `chunk_id` хэлдэггүй, заалтын дугаараас УГСАРДАГ — угсралт эвдэрвэл
  //    эндээс л мэдэгдэнэ (өөр газар чимээгүй өнгөрнө).
  assert.equal(c.orphanRules.length, 0, 'эх заалтгүй дүрэм үүсэв');
  db.close();
});

test('⚠️ OCR-оор хуудасны зурагт тулгасан мөр нь БЛОКЛОГДОХГҮЙ', { skip: skipGuide }, () => {
  const { db, counts } = fresh([GUIDE]);
  // ⚠️ Энэ багц бүх мөрөндөө
  //    `verified_from_rendered_page_image_with_ocr_normalization` гэж
  //    бичдэг.  `rules.ts`-ийн хаалга ГАНЦ мөртэй тулгадаг байсан үед
  //    71 заалт бүгд «хүний хяналт хүлээж байна» болж, ХЭМЖҮҮР НОГООН
  //    хэвээр үлдэж байв (гоожилт 0 — учир нь `verified` огт үүсэхгүй).
  //    Тиймээс үүнийг ТООГООР биш, ТӨЛӨВӨӨР шалгана.
  assert.equal(counts[0]!.unverifiedRules, 0);
  const a = askNorm(db, 'Төслийн үндсэн шийдлийг хэрхэн хэрэгжүүлэх вэ?');
  assert.notEqual(a.status, 'uncertain', 'OCR-оор баталгаажсан заалт эргэлзээтэй болов');
  assert.equal(a.rule_kind, 'requirement');
  db.close();
});

test('⚠️ нэг заалтын ХОЁР ТООН УТГААС асуултад тохирохыг нь сонгоно', { skip: skipGuide }, () => {
  const { db } = fresh([GUIDE]);

  // 3.8-р заалт: график зургийн эх 2 хувь, тайлбар бичиг 4 хувь.
  // ⚠️ Хамралтын шалгуургүй үед цагаан толгойн эрэмбэ («explanatory» <
  //    «graphic») нь ГРАФИК зургийн асуултад «4 хувь» гэж хариулж байв
  //    (хэмжсэн 2026-09-09).  Эшлэл нь зөв тул хэмжүүр үүнийг БАРЬДАГГҮЙ.
  const graphic = askNorm(db, 'График зураглалын эх хувийг хэдэн хувь өгөх вэ?');
  assert.match(String(graphic.rule_object_mn), /2 хувь/);
  assert.equal(graphic.citation?.clause, '3.8');

  const note = askNorm(db, 'Тайлбар бичгийг хэдэн хувь өгөх вэ?');
  assert.match(String(note.rule_object_mn), /4 хувь/);

  // 3.3-р заалт: нийт 20 жил, эхний ээлж 5-10 жил.
  const stage = askNorm(db, 'Эхний ээлжийн төлөвлөлтийн хугацаа хэд вэ?');
  assert.match(String(stage.rule_object_mn), /5–10 жил/);

  const horizon = askNorm(db, 'undsen tusliin tuluvlultiin hugatsaa heden jil');
  assert.match(String(horizon.rule_object_mn), /20 жил/);
  db.close();
});

test('гурван багц ЗЭРЭГ оршино — FTS индекс бүрэн', { skip: skipAll }, () => {
  const { db } = fresh([FIRE, CLIENT, GUIDE]);
  const docs = db.prepare('SELECT COUNT(*) AS n FROM ai_documents').get() as { n: number };
  const chunks = db.prepare('SELECT COUNT(*) AS n FROM ai_chunks').get() as { n: number };
  const fts = db.prepare('SELECT COUNT(*) AS n FROM ai_chunks_fts').get() as { n: number };
  assert.equal(docs.n, 3);
  assert.equal(chunks.n, 126 + 46 + 73);
  assert.equal(fts.n, chunks.n, 'гурав дахь багц FTS индексийг эвдэв');

  // ⚠️ Гурав дахь баримт орсны дараа ЭХНИЙ ХОЁРЫН хариу хэвээр байх ёстой.
  //    BM25 нь корпусаас хамаардаг тул шинэ баримт хуучныхыг ДАРЖ болно.
  const fire = askNorm(db, '310 м² А ангиллын агуулахын өрөөнд ямар автомат систем хэрэгтэй вэ?', {
    context: { area_m2: 310 },
  });
  assert.equal(fire.citation?.doc_id, 'BNBD-21-04-05-ADD-2018-01-18-10');
  const client = askNorm(db, 'Захиалагч зураг төслийн даалгаврыг хэн боловсруулах вэ?');
  assert.ok(client.evidence.length > 0);
  db.close();
});

test('латин ба англи асуулт нь аргачилсан зааврыг олно', { skip: skipGuide }, () => {
  const { db } = fresh([GUIDE]);
  for (const q of [
    'tuluvlultiin hugatsaa',
    'What does UBB-11-201-00 clause 3.3 require?',
    'иж бүрэн үнэлгээ',
  ]) {
    const a = askNorm(db, q);
    assert.ok(a.evidence.length > 0, `${q}: нотолгоо олдсонгүй`);
    assert.equal(a.citation?.doc_id, 'UBB-11-201-00-2000', `${q}: өөр баримт руу очив`);
  }
  db.close();
});

/* ── ХАМААРЛЫН ХААЛГА (2026-09-10) ─────────────────────────────────── */

test('contentTokens · зогсоох үг, богино үг хасагдана; В2 ангилал, тоо үлдэнэ', async () => {
  const { contentTokens } = await import('../src/pipeline.ts');
  const { normalizeQuery } = await import('../src/normalize.ts');
  const t = contentTokens(normalizeQuery('V2 galyn achaalal hed ve? 300 м2'));
  assert.ok(t.includes('v2'), 'ангиллын тэмдэг агуулга');
  assert.ok(t.includes('300'), 'тоо агуулга');
  assert.ok(!t.includes('hed') && !t.includes('ve'), 'зогсоох үг хасагдана');
  assert.deepEqual(contentTokens(normalizeQuery('Сайн байна уу, чи юу хийж чадах вэ')), []);
});

test('contentOverlap · агуулгын токенгүй асуулт → 0 (мэндчилгээнд заалт эшлэгдэхгүй)', async () => {
  const { contentOverlap } = await import('../src/pipeline.ts');
  const { normalizeQuery } = await import('../src/normalize.ts');
  assert.equal(contentOverlap(normalizeQuery('Сайн байна уу'), 'Барилгын норм дүрэм'), 0);
  assert.ok(contentOverlap(normalizeQuery('агуулахын галын ачаалал'), 'Агуулахад галын ачааллын норм') >= 2);
  assert.equal(contentOverlap(normalizeQuery('300 м2 агуулах'), 'Талбай 3000 м2'), 0, 'тоо ЯГ таарна');
});

test('overlapRequired · 1 токен → 1, 2+ токен → 2', async () => {
  const { overlapRequired } = await import('../src/pipeline.ts');
  assert.equal(overlapRequired(0), 1);
  assert.equal(overlapRequired(1), 1);
  assert.equal(overlapRequired(2), 2);
  assert.equal(overlapRequired(16), 2);
});

test('GAP-032 · anchorTerms — ≤0.5 % эсвэл ≤5 хэсэг, ≥5 үсэг, хамгийн ховор НЭГ; hasAnchor богино язгуур', () => {
  const freq = new Map([
    ['liftni', 0.0016],
    ['hongilin', 0.0104],
    ['hanani', 0],
    ['eronhi', 0.026],
  ]);
  assert.deepEqual(anchorTerms(freq, ['liftni', 'hongilin', 'hanani'], 1825), ['liftni']);
  // Жижиг сан: 2/163 = 1.2 % ч ≤5 хэсэг тул зангуу.
  assert.deepEqual(anchorTerms(new Map([['liftni', 2 / 163]]), ['liftni'], 163), ['liftni']);
  assert.deepEqual(anchorTerms(new Map([['liftni', 0.0016]]), ['abcd'], 1825), [], '4 үсэг — зангуу биш');
  assert.deepEqual(anchorTerms(freq, ['hanani'], 1825), [], 'корпуст байхгүй үг зангуу биш');
  assert.equal(hasAnchor('Лифтний шаардлагыг давхар хоорондын өндрөөр тогтооно', 'liftni'), true);
  assert.equal(hasAnchor('Зургийн даалгаварыг батална', 'dalgavrig'), true);
  assert.equal(hasAnchor('Холбох хонгилын хана REI45', 'liftni'), false);
});


/* ── 2026-09-18 · «N мянган нэгж» + ах дүү мөр (прод дээр хэмжсэн регресс) ───────── */

test('normalize · «600 мянган нэгж баримт» → item_count 600000; «200 нэгж» → 200', () => {
  assert.equal(normalizeQuery('Архивт 600 мянган нэгж баримт хадгалдаг бол ГУАТ уу?').entities.item_count, 600000);
  assert.equal(normalizeQuery('Архивт 200 нэгж бол?').entities.item_count, 200);
  assert.equal(normalizeQuery('Хатаалгын өрөөнд ГУАТ хэрэгтэй юу?').entities.item_count, undefined);
});

test('БНбД · архив 200 мянган нэгж → ах дүү мөр (<500 мянга → ГМДХ), 600 мянга → ГУАТ', { skip: skipFire }, () => {
  const { db } = fresh([FIRE]);
  const lo = askNorm(db, 'Архивт 200 мянган нэгж баримт хадгалдаг бол ГУАТ уу, ГМДХ уу?', { evidenceLimit: 5 });
  assert.equal(lo.status, 'verified');
  assert.equal(lo.decisions.GMDH, true);
  assert.equal(lo.decisions.GUAT, false);
  assert.match(lo.rule_object_mn ?? '', /500 мянгаас бага/);
  const hi = askNorm(db, 'Архивт 600 мянган нэгж баримт хадгалдаг бол ГУАТ уу, ГМДХ уу?', { evidenceLimit: 5 });
  assert.equal(hi.status, 'verified');
  assert.equal(hi.decisions.GUAT, true);
  assert.match(hi.rule_object_mn ?? '', /500 мянган нэгж ба түүнээс их/);
  // Дутуу оролттой бол ах дүү рүү ШИЛЖИХГҮЙ — uncertain хэвээр
  const none = askNorm(db, 'Архивт хадгалах баримт бичигт ГУАТ хэрэгтэй юу?', { evidenceLimit: 5 });
  assert.notEqual(none.status, 'verified');
});
