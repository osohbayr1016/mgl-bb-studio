// Run with:  node --test src/lib/assessmentGap.test.ts   (Node ≥ 22.18 / 24 strips types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Апп-ын эх код нь өргөтгөлгүй импорт бичдэг (`from './assessmentSchema'`) —
// Worker-ийн bundler (esbuild) ба tsc-ийн "Bundler" moduleResolution үүнийг
// шийддэг, Node-ийн ESM loader шийддэггүй.  `webPush.test.ts`-ийн ижил hook.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { buildLevelUpPlan } = await import('./assessmentGap.ts');
const { scoreAssessment } = await import('./assessmentScore.ts');
type Schema = import('./assessmentSchema.ts').AssessmentSchema;
type Answers = import('./assessmentSchema.ts').AssessmentAnswers;

/* ------------------------------------------------------------------ */
/*  Туршилтын схем — АРХИТЕКТОРЫНХ БИШ.                                */
/* ------------------------------------------------------------------ */
//
// Зориуд өөр код, өөр жин, өөр band, өөр шатлалын тайлбартай схем барив:
// хөдөлгүүр нь схемээс уншиж ажилладаг (hardcode хийгээгүй) гэдгийг зөвхөн
// ингэж батлана.  Архитекторын seed дээр тест бичвэл «7% CONCEPT_DESIGN»
// гэх мэт тоо кодонд шингэсэн байсан ч тест давах байсан.

/** `n` ширхэг мөр — id нь `${groupId}-<i>` конвенцтой. */
const items = (groupId: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${groupId}-${i + 1}`, text: `${groupId} мөр ${i + 1}` }));

const section = (id: string, code: string, weight: number, n: number) => ({
  id,
  code,
  title: `${code} гарчиг`,
  weight,
  groups: [{ id: `${id}-g`, title: '', items: items(`${id}-g`, n) }],
});

const SCHEMA: Schema = {
  version: 1,
  scales: [
    {
      id: 'exp',
      label: 'Туршлага',
      min: 1,
      max: 4, // ЗОРИУД 5 БИШ — max нь схемээс уншигдаж байгааг батлана
      options: [
        { value: 1, label: 'A', caption: 'нэг ч удаа хийгээгүй' },
        { value: 2, label: 'B', caption: '1-2 объектод хийсэн' },
        { value: 3, label: 'C', caption: '3-7 объектод хийсэн' },
        { value: 4, label: 'D', caption: '8-аас дээш объектод хийсэн' },
      ],
    },
    {
      id: 'beh',
      label: 'Зан чанар',
      min: 1,
      max: 5,
      options: [{ value: 5, label: 'Үргэлж', caption: 'үргэлж илэрдэг' }],
    },
  ],
  levels: [
    { code: 'TOP', label: 'Дээд', minPct: 90, maxPct: 100, color: '#000' },
    { code: 'MID', label: 'Дунд', minPct: 50, maxPct: 89.999999, color: '#111' },
    { code: 'LOW', label: 'Доод', minPct: 0, maxPct: 49.999999, color: '#222' },
  ],
  parts: [
    {
      id: 'skill',
      title: 'Ур чадвар',
      scaleId: 'exp',
      chart: 'scatter',
      weighted: true,
      paging: 'section',
      sections: [
        // ЦӨӨН мөртэй, ӨНДӨР жинтэй → хамгийн үнэтэй мөр
        section('s-heavy', 'HEAVY', 80, 4),
        // ОЛОН мөртэй, БАГА жинтэй → хамгийн хямд мөр
        section('s-light', 'LIGHT', 20, 20),
      ],
    },
    {
      id: 'behavior',
      title: 'Зан чанар',
      scaleId: 'beh',
      chart: 'radar',
      weighted: false,
      paging: 'part',
      sections: [section('s-beh', 'BEH', 0, 10)],
    },
  ],
};

const skillPlan = (self: Answers, senior?: Answers[]) => {
  const plan = buildLevelUpPlan(SCHEMA, { self, senior: senior ?? null });
  const part = plan.parts.find((p) => p.weighted);
  assert.ok(part?.overall, 'weighted part-д overall зорилт байх ёстой');
  return { part, overall: part.overall };
};

/** Бүх мөрд ижил оноо өгсөн хариулт. */
function fill(value: number, only?: string): Answers {
  const out: Answers = {};
  for (const part of SCHEMA.parts) {
    for (const s of part.sections) {
      if (only && s.id !== only) continue;
      for (const g of s.groups) for (const it of g.items) out[it.id] = value;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */

test('хөшүүрэг: цөөн мөртэй өндөр жинтэй хэсгийн нэг мөр илүү үнэтэй', () => {
  const { part } = skillPlan(fill(2));
  const heavy = part.sections.find((s) => s.code === 'HEAVY')!;
  const light = part.sections.find((s) => s.code === 'LIGHT')!;

  // gain = share × 100 × w / (must × Σw);  share = 1 (ахлагчгүй), Σw = 100.
  //   HEAVY: 100 × 80 / (4 × 4 × 100)  = 5.0 pp
  //   LIGHT: 100 × 20 / (20 × 4 × 100) = 0.25 pp
  assert.equal(heavy.leverage, 5);
  assert.equal(light.leverage, 0.25);
  assert.equal(heavy.leverage / light.leverage, 20);
});

test('төлөвлөгөө нь ХӨШҮҮРГЭЭР эрэмбэлэгдэнэ — хамгийн сул хэсгээр биш', () => {
  // LIGHT нь хамгийн сул (1/4 = 25%), HEAVY нь илүү сайн (3/4 = 75%).
  // Гэвч нийт хувийг хөдөлгөх хамгийн хямд зам нь HEAVY — түүнийг эхэнд тавина.
  const self = { ...fill(3, 's-heavy'), ...fill(1, 's-light') };
  const { overall } = skillPlan(self);
  assert.equal(overall.steps[0]?.code, 'HEAVY');
});

test('шатлалын шошго/тайлбар СХЕМЭЭС ирнэ (hardcode биш)', () => {
  // fill(2) → 50%, TOP (90) хүртэл 40 pp.  HEAVY-ийн 4 мөр × 2 алхам × 5 pp =
  // яг 40 тул мөр бүр 2 → 4 хүртэл явна (бүлэг нь мөрийн ЭЦСИЙН зорилгыг
  // харуулна, завсрын алхмуудыг тусад нь давхардуулахгүй).
  const { overall } = skillPlan(fill(2));
  const step = overall.steps[0]!;
  assert.equal(step.from.value, 2);
  assert.equal(step.to.value, 4);
  assert.equal(step.from.caption, '1-2 объектод хийсэн');
  assert.equal(step.to.caption, '8-аас дээш объектод хийсэн');
  assert.equal(step.to.label, 'D');
});

test('дээд түвшинд байгаа хүнд дараагийн түвшин ГАРАХГҮЙ', () => {
  // Бүх мөр max (4/4) → 100% → TOP band, түүнээс дээш band алга.
  const { overall } = skillPlan(fill(4));
  assert.equal(overall.current, 100);
  assert.equal(overall.currentLevel?.code, 'TOP');
  assert.equal(overall.atTopLevel, true);
  assert.equal(overall.nextLevel, null);
  assert.equal(overall.gap, null);
  assert.deepEqual(overall.steps, []);
});

test('зөрүү яг 0 үед (band-ын ирмэг дээр) алхам санал болгохгүй', () => {
  // 4 оноот шатлалд 2/4 = 50% → яг MID-ийн ирмэг.
  const { overall } = skillPlan(fill(2));
  assert.equal(overall.current, 50);
  assert.equal(overall.currentLevel?.code, 'MID');
  assert.equal(overall.nextLevel?.code, 'TOP');
  assert.ok(overall.gap && overall.gap > 0);
});

test('алхмууд зөрүүг нөхөж чадвал covered = true, илүүдэл алхам сонгохгүй', () => {
  // HEAVY 2/4, LIGHT 4/4 → pct = 80×50 + 20×100 = 60%.  TOP хүртэл 30 pp.
  // HEAVY-ийн нэг алхам = 5 pp тул 6 алхам хангалттай (HEAVY-д 4 мөр × 2
  // алхам = 8 боломж байгаа).
  const self = { ...fill(2, 's-heavy'), ...fill(4, 's-light') };
  const { overall } = skillPlan(self);
  assert.equal(overall.current, 60);
  assert.equal(overall.gap, 30);
  assert.equal(overall.covered, true);
  assert.equal(overall.totalGain, 30);
  // 6 АЛХАМ хэрэгтэй ч тэдгээр нь ЗӨВХӨН 4 мөрд ноогдоно (хоёр мөр 2 алхам
  // авна) — `itemCount` нь алхам биш МӨР тоолдог тул 4.
  const items = overall.steps.reduce((n, s) => n + s.itemCount, 0);
  assert.equal(items, 4);
  assert.ok(overall.steps.every((s) => s.code === 'HEAVY'));
  // Хоёр бүлэг: 2 мөр «2 → 4» (20 pp) ба 2 мөр «2 → 3» (10 pp).
  assert.deepEqual(
    overall.steps.map((s) => [s.from.value, s.to.value, s.itemCount]),
    [[2, 4, 2], [2, 3, 2]],
  );
});

test('ахлагч илгээсэн бол ажилтны нэг оноо дунджид ХАГАСААР нөлөөлнө', () => {
  const self = fill(2);
  const senior = [fill(2)];
  const solo = skillPlan(self).part.sections.find((s) => s.code === 'HEAVY')!;
  const withSenior = skillPlan(self, senior).part.sections.find((s) => s.code === 'HEAVY')!;
  assert.equal(withSenior.leverage, solo.leverage / 2);
});

test('ахлагч бага үнэлсэн үед өөрийн дээд оноо ч хүрэхгүйг covered=false илэрхийлнэ', () => {
  // Ажилтан бүх мөрд 4 (дээд), ахлагч бүх мөрд 1 → pct = (100 + 25) / 2 = 62.5%.
  // Ажилтанд ахиулах мөр АЛГА тул ямар ч алхам байхгүй, зөрүү нөхөгдөхгүй.
  const { overall } = skillPlan(fill(4), [fill(1)]);
  assert.equal(overall.current, 62.5);
  assert.equal(overall.nextLevel?.code, 'TOP');
  assert.equal(overall.covered, false);
  assert.equal(overall.totalGain, 0);
  assert.deepEqual(overall.steps, []);
});

test('зан чанарын хэсэг: ХУВЬ биш, 1..max дундаж + BEHAVIOR_BANDS', () => {
  const plan = buildLevelUpPlan(SCHEMA, { self: fill(3), senior: null });
  const beh = plan.parts.find((p) => !p.weighted)!;
  assert.equal(beh.overall, null, 'зан чанарын part-д нийт зорилт байхгүй (I5)');
  const s = beh.sections[0]!;
  assert.equal(s.unit, 'mean');
  assert.equal(s.current, 3);
  assert.equal(s.currentLevel?.code, 'SUURI');
  assert.equal(s.nextLevel?.code, 'TOGTVORTOI');
  // 10 мөрийн дунджийг 3.0 → 3.5 болгоход 5 мөрийг +1 хийхэд хангалттай.
  assert.equal(s.covered, true);
  assert.equal(s.steps.reduce((n, g) => n + g.itemCount, 0), 5);
});

test('зан чанарын дээд шатлалд дараагийн шатлал ГАРАХГҮЙ', () => {
  const plan = buildLevelUpPlan(SCHEMA, { self: fill(5), senior: null });
  const s = plan.parts.find((p) => !p.weighted)!.sections[0]!;
  assert.equal(s.current, 5);
  assert.equal(s.currentLevel?.code, 'ULGER_JISHEE');
  assert.equal(s.atTopLevel, true);
  assert.equal(s.nextLevel, null);
  assert.deepEqual(s.steps, []);
});

test('хариулаагүй мөр (0) нь бөглөх алхам болж гарна, шошго нь null', () => {
  // Хоосон хариулт → pct = 0.  Эхний алхам нь «0 → scale.min», ө.х. «мөрөө
  // бөглө» — энэ нь жинхэнэ оноо нэмдэг алхам (`sumSection` 0 гэж тооцдог).
  const { overall } = skillPlan({});
  assert.equal(overall.current, 0);
  const firstHeavy = overall.steps.find((s) => s.code === 'HEAVY')!;
  assert.equal(firstHeavy.from.value, 0);
  // 0 нь шатлалд байхгүй утга тул тайлбаргүй — UI «хариулаагүй» гэж уншина.
  assert.equal(firstHeavy.from.label, null);
  assert.equal(firstHeavy.from.caption, null);
});

/* ------------------------------------------------------------------ */
/*  scoreAssessment-тай ялгарахгүй байх (deploy-ийн өмнөх шүүлтийн олдвор) */
/* ------------------------------------------------------------------ */

test('reverse мөр: current нь scoreAssessment-ийн pct-ээс ЗӨРӨХГҮЙ', () => {
  // ЗОРИУД урвуу мөр агуулсан схем.  `itemScore` нь 5 → min+max−5 = 1 болгодог;
  // хөдөлгүүр үүнийг мартвал нэг хариултаас ХОЁР өөр түвшин гарна.
  const rev: Schema = JSON.parse(JSON.stringify(SCHEMA));
  const heavy = rev.parts[0]!.sections.find((s) => s.id === 's-heavy')!;
  heavy.groups[0]!.items[0]!.reverse = true;

  const self = fill(4); // бүх мөрд дээд УТГА
  const score = scoreAssessment(rev, { self, senior: null });
  const plan = buildLevelUpPlan(rev, { self, senior: null });
  const skill = plan.parts.find((p) => p.weighted)!.overall!;

  // Урвуу мөрд 4 өгсөн нь ОНООНЫ хувьд хамгийн ДООД (1+4−4 = 1).
  assert.equal(skill.current, score.parts[0]!.overallPct);
  assert.ok(skill.current !== null && skill.current < 100, 'урвуу мөр оноог бууруулна');
});

test('reverse мөр: зөвлөмж нь маягтын утгыг ДООШ явуулна (оноог дээш)', () => {
  const rev: Schema = JSON.parse(JSON.stringify(SCHEMA));
  const heavy = rev.parts[0]!.sections.find((s) => s.id === 's-heavy')!;
  const revItemId = heavy.groups[0]!.items[0]!.id;
  heavy.groups[0]!.items[0]!.reverse = true;

  // Урвуу мөрд 4 (оноо 1 — хамгийн доод), бусад бүх мөрд 4 (оноо 4).
  const self = fill(4);
  const plan = buildLevelUpPlan(rev, { self, senior: null });
  const overall = plan.parts.find((p) => p.weighted)!.overall!;

  const step = overall.steps.find((s) => s.code === 'HEAVY');
  assert.ok(step, 'урвуу мөрийг ахиулах алхам байх ёстой');
  // Маягт дээрх утга нь БУУРАХ ёстой (оноог ӨСГӨХИЙН тулд) — энэ бол урвуу
  // мөрийн бүх утга учир: 4 гэж хариулсан нь ОНООНЫ хувьд хамгийн доод.
  assert.equal(step.from.value, 4);
  assert.ok(step.to.value < step.from.value, `${step.from.value} → ${step.to.value} буурах ёстой`);
  assert.ok(step.gain > 0, 'ашиг нь эерэг байх ёстой');

  // Зөвлөмжийг биелүүлбэл ЖИНХЭНЭ оноо өснө — эсрэгээрээ биш.
  const after: Answers = { ...self, [revItemId]: step.to.value };
  const before = scoreAssessment(rev, { self, senior: null }).parts[0]!.overallPct!;
  const later = scoreAssessment(rev, { self: after, senior: null }).parts[0]!.overallPct!;
  assert.ok(later > before, `зөвлөмж оноог өсгөх ёстой: ${before} → ${later}`);
});

test('жинтэй ч асуултгүй хэсэг байхад хөшүүрэг нь current-ийн хуваарьтай таарна', () => {
  // DRAFT: жин 20, мөр 0 (админ жинг өгчихөөд асуултаа оруулаагүй).
  // `current` нь түүнийг хуваарьт ОРУУЛАХГҮЙ тул хөшүүрэг ч оруулах ёсгүй.
  const draft: Schema = JSON.parse(JSON.stringify(SCHEMA));
  draft.parts[0]!.sections.push({
    id: 's-draft', code: 'DRAFT', title: 'DRAFT', weight: 20,
    groups: [{ id: 's-draft-g', title: '', items: [] }],
  });

  const self = fill(2);
  const plan = buildLevelUpPlan(draft, { self, senior: null });
  const part = plan.parts.find((p) => p.weighted)!;
  const heavy = part.sections.find((s) => s.code === 'HEAVY')!;

  // Хуваарь нь 100 (HEAVY 80 + LIGHT 20), 120 БИШ.
  assert.equal(heavy.leverage, 5);
  // Нэг мөр ахиулахад НИЙТ хувь үнэхээр 5 pp өсөхийг тулгаж шалгана.
  const before = scoreAssessment(draft, { self, senior: null }).parts[0]!.overallPct!;
  const oneUp: Answers = { ...self, 's-heavy-g-1': 3 };
  const after = scoreAssessment(draft, { self: oneUp, senior: null }).parts[0]!.overallPct!;
  assert.ok(Math.abs(after - before - heavy.leverage) < 1e-9, `${after - before} ≠ ${heavy.leverage}`);
});

test('roundPct дамжуулбал band нь БӨӨРӨНХИЙЛСӨН утган дээр хуваарилагдана', () => {
  // 4 оноот шатлалд 2.6/4 = 65% … band-ын ирмэгийг зохиомлоор барихын тулд
  // roundPct-ээр 90 болгож TOP руу түлхэнэ — өөрөөр хэлбэл band нь
  // roundPct-ийн ГАРАЛТААС хамаарч байгааг батална.
  const self = fill(2);
  const raw = buildLevelUpPlan(SCHEMA, { self, senior: null }).parts[0]!.overall!;
  assert.equal(raw.current, 50);
  assert.equal(raw.currentLevel?.code, 'MID');

  const rounded = buildLevelUpPlan(SCHEMA, { self, senior: null }, { roundPct: () => 90 })
    .parts[0]!.overall!;
  assert.equal(rounded.current, 90);
  assert.equal(rounded.currentLevel?.code, 'TOP');
  assert.equal(rounded.atTopLevel, true);
  assert.deepEqual(rounded.steps, []);
});

test('нэг мөр олон алхам авбал НЭГ бүлэгт нэгдэнэ (давхардахгүй)', () => {
  // HEAVY бүх мөр 1/4, LIGHT бүх мөр 4/4 → pct = 80×25 + 20×100 = 40%.
  // MID (50) хүртэл 10 pp; HEAVY-ийн нэг алхам 5 pp тул ХОЁР алхам хэрэгтэй —
  // нэг мөрд хоёр алхам (1→2→3) унаж болзошгүй.
  const self = { ...fill(1, 's-heavy'), ...fill(4, 's-light') };
  const { overall } = skillPlan(self);
  assert.equal(overall.current, 40);

  // Нэг мөр хоёр удаа тоологдож болохгүй: нийт itemCount нь HEAVY-ийн мөрийн
  // тооноос хэтрэхгүй.
  const heavyItems = overall.steps
    .filter((s) => s.code === 'HEAVY')
    .reduce((n, s) => n + s.itemCount, 0);
  assert.ok(heavyItems <= 4, `HEAVY-д 4 мөр байхад ${heavyItems} тоологдов`);
  // Бүлэг бүрийн (from → to) хос давтагдахгүй.
  const keys = overall.steps.map((s) => `${s.code}|${s.from.value}|${s.to.value}`);
  assert.equal(new Set(keys).size, keys.length);
});
