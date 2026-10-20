// Run with:  node --test src/lib/quoteTranslate.test.ts   (Node ≥ 22.18 / 24 strips types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// Апп-ын эх код нь өргөтгөлгүй импорт бичдэг (`from '../routes/quotes'`) —
// Worker-ийн bundler (esbuild) болон tsc-ийн "Bundler" moduleResolution үүнийг
// шийддэг; Node-ийн ESM loader шийддэггүй.  tsconfig-д
// `allowImportingTsExtensions` асаагаагүй тул эх кодыг `.ts`-тэй бичих ч
// боломжгүй.  Тиймээс ЗӨВХӨН тестийн хүрээнд өргөтгөлгүй, харьцангуй импортыг
// `.ts` руу буулгана (webPush.test.ts-ийн ижил хэв маяг).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

// Дээрх hook-ийн ДАРАА ачаалагдах ёстой тул динамик импорт (static import нь
// модулийн биеийг ажиллуулахаас өмнө шийдэгддэг).
const {
  QUOTE_MN_EN_DICT,
  applyTranslations,
  collectTranslatables,
  hasCyrillic,
  needsAiTranslation,
  translateFreeText,
} = await import('./quoteTranslate.ts');

/* ------------------------------------------------------------------ */
/*  Туршилтын жижиг дэвтэр — routes/quotes.ts-ийн WorkbookDoc хэлбэрээр */
/* ------------------------------------------------------------------ */

/** Тест бүр ЦЭВЭР хуулбар авна — applyTranslations эх дэвтрийг хөндөх ёсгүй
 *  ч, тест хооронд хуваалцсан объект зөрчил нуух эрсдэлтэй. */
function sampleWorkbook() {
  return {
    sheets: [
      {
        id: 'main',
        name: 'Нэгтгэл',
        rows: 10,
        cols: 12,
        merges: [],
        anchors: {},
        cells: {
          // Загварын тогтмол мөрүүд — толиноос
          A1: { v: 'БАРИЛГА БАЙГУУЛАМЖ БАРИХ ЗУРАГ ТӨСӨЛ БОЛОВСРУУЛАХ ХЯНАЛТЫН ТӨСӨВ' },
          A2: { v: 'Барилгын нэр' },
          A3: { v: 'ДҮН' },
          // Чөлөөт бичвэр — AI-д явна
          B2: { v: 'Номин цамхаг' },
          I2: { v: '  Түр тайлбар  ' }, // зай хадгалагдах ёстой
          // Кирилгүй / тоон — огт хөндөгдөхгүй
          C2: { v: 'B1-B2' },
          D2: { v: 12345 },
          B4: { v: 'BMS' },
          // Dropdown-ууд — утга ба сонголт хоёул толиноос
          E2: { v: 'м²', choices: ['м²', 'га', 'цооног', 'тм', 'ш'] },
          G2: { v: '', choices: ['Бага төвөгшилтэй', 'Дунд төвөгшилтэй'] },
          // Томьёоны литералууд
          H2: { f: '=TARIF(D2;"Өндөр төвөгшилтэй")', fmt: '#,##0' },
          A4: {
            f: '="Тайлбар: Хяналтын төсвийн нийт дүн ₮"&TEXT(Z20)&" /"&USGEER(Z20)&" төгрөг/ болно."',
          },
          J2: { f: '="Багана ""А"" дүн"' }, // давхар хашилт хадгалагдана
          K2: { f: '="Хуудас2!A1 гэж бичнэ"' }, // литерал ДОТОРХ нэр rename-д ӨРТӨХГҮЙ
          // Хөндлөн хуудасны лавлагаа — нэрийг дагаж солигдоно
          F4: { f: '=Хуудас2!G14+5' },
          // Кирилгүй томьёо — байгаагаараа
          F5: { f: '=IF(F4>4.5; 1+(F4-4.5)*0.05; 1)' },
        },
        addons: {
          baseCol: 10,
          headerRow: 2,
          firstRow: 3,
          lastRow: 7,
          items: [{ key: 'bms', label: 'BMS /ЗТАҮ*6%/', pct: 6 }],
          lines: {
            baseRef: 'Z17',
            totalRef: 'Z20',
            items: [{ key: 'discount', label: 'ХӨНГӨЛӨЛТ', pct: 10, sign: -1 }],
          },
          costLines: {
            baseRef: 'Z9',
            sumRef: 'Z17',
            labelCol: 1,
            qtyCol: 3,
            unitCol: 4,
            priceCol: 9,
            items: [
              { key: 'geology', label: 'Инженер геологийн судалгаа', kind: 'qty', unit: 'цооног' },
            ],
          },
          sections: {
            baseCol: 17,
            headerRow: 2,
            firstRow: 3,
            lastRow: 7,
            sumRow: 8,
            items: [{ key: 'ba', label: 'Барилга архитектур', code: 'BA', pct: 30 }],
          },
        },
      },
      {
        id: 's2',
        name: 'Хуудас2',
        rows: 5,
        cols: 5,
        merges: [],
        anchors: {},
        cells: { A1: { v: 'Инженер геологи дэд тооцоо' } },
      },
    ],
    activeSheet: 0,
    anchors: { total: { sheet: 'main', ref: 'Z20' } },
  };
}

/* ------------------------------------------------------------------ */
/*  Кирилл илрүүлэлт                                                   */
/* ------------------------------------------------------------------ */

test('hasCyrillic: кирилтэй мөрийг л таньж, BMS/B1-B2/тоог алгасна', () => {
  assert.equal(hasCyrillic('Барилгын нэр'), true);
  assert.equal(hasCyrillic('м²'), true); // «м» нь кирилл үсэг
  assert.equal(hasCyrillic('BMS'), false);
  assert.equal(hasCyrillic('B1-B2'), false);
  assert.equal(hasCyrillic('12345'), false);
  assert.equal(hasCyrillic('=SUM(A1:B9)*10%'), false);
  assert.equal(hasCyrillic(''), false);
});

test('needsAiTranslation: тольд буй мөр AI-д ЯВАХГҮЙ, чөлөөт кирилл мөр явна', () => {
  assert.equal(needsAiTranslation('ДҮН'), false); // толинд бий
  assert.equal(needsAiTranslation('  ДҮН  '), false); // trim хийж хайна
  assert.equal(needsAiTranslation('Номин цамхаг'), true);
  assert.equal(needsAiTranslation('BMS'), false);
  assert.equal(needsAiTranslation('   '), false);
});

test('толь: тайлбарын литералын ТӨГСГӨЛИЙН зай утгын нэг хэсэг (MNT 123 гэж уншигдана)', () => {
  assert.ok(QUOTE_MN_EN_DICT['Тайлбар: Хяналтын төсвийн нийт дүн ₮']?.endsWith('MNT '));
  assert.equal(QUOTE_MN_EN_DICT['төгрөг/ болно.'], 'tugriks/.');
});

/* ------------------------------------------------------------------ */
/*  «Дүн үсгээр» мөрийн БҮХ хувилбар — түүхэн snapshot-ууд ч орно      */
/* ------------------------------------------------------------------ */

/**
 * Санал бүр `sheet_json`-оо ҮҮСГЭХ ҮЕДЭЭ snapshot авдаг тул загварыг зассан ч
 * ХУУЧИН саналууд өөрсдийн бичвэрээ мөнхөд авч явна. Тиймээс тайлбарын мөрийн
 * бүх түүхэн хувилбар тольд ҮЛДЭХ ЁСТОЙ — аль нэгийг хасвал тэр үеийн
 * саналуудын англи хуулбар AI-д унаж, мөнгөн дүнгийн өмнөх зай алдагдана
 * («MNT978,161,095») эсвэл мөр монголоороо үлдэнэ.
 */
const NOTE_PREFIXES = [
  'Тайлбар: Зураг төсөл боловсруулах ажлын нийт дүн ₮', // 0186-аас хойш
  'Тайлбар: Эскиз зураг боловсруулах ажлын нийт дүн ₮', // 0185 ба өмнөх
  'Тайлбар: Хяналтын төсвийн нийт дүн ₮', // хамгийн анхных
  'Тайлбар:  Зураг төсөл боловсруулах ажлын үнийн дүн ₮', // энгийн загвар (0130)
];

test('толь: тайлбарын БҮХ түүхэн хувилбар байгаа ба «MNT »-ээр (зайтай) төгсдөг', () => {
  for (const mn of NOTE_PREFIXES) {
    const en = QUOTE_MN_EN_DICT[mn];
    assert.ok(en !== undefined, `толинд алга: ${JSON.stringify(mn)}`);
    // ⚠️ Зай нь утгын нэг хэсэг — монгол түлхүүр «₮»-ээр төгсөж зайгүй тул
    // англи талын зай ЗӨВХӨН эндээс ирнэ.
    assert.ok(en.endsWith('MNT '), `«MNT »-ээр төгсөх ёстой: ${JSON.stringify(en)}`);
    assert.equal(hasCyrillic(en), false, `англи утга кириллтэй: ${JSON.stringify(en)}`);
    assert.equal(needsAiTranslation(mn), false, `AI руу унаж байна: ${JSON.stringify(mn)}`);
  }
});

test('тайлбарын мөр: хувилбар бүр БҮТЭН англи өгүүлбэр болж, кирилл үлдэхгүй', () => {
  for (const mn of NOTE_PREFIXES) {
    const wb = sampleWorkbook();
    const main = wb.sheets[0];
    assert.ok(main);
    main.cells.A4 = {
      f: `="${mn}"&TEXT(Z20)&" /"&USGEER(Z20)&" төгрөг/ болно."`,
    };
    // AI-г ЗОРИУД хоосон өгнө — толь дангаараа хангалттай байх ёстой.
    const out = applyTranslations(wb, new Map());
    const got = out.sheets[0]?.cells.A4?.f ?? '';

    assert.equal(hasCyrillic(got), false, `кирилл үлдсэн: ${got}`);
    // TEXT/USGEER/лавлагаа ХЭВЭЭР — зөвхөн литерал солигдоно.
    assert.ok(got.includes('&TEXT(Z20)&'), got);
    assert.ok(got.includes('&USGEER(Z20)&'), got);
    assert.ok(got.endsWith('" tugriks/."'), got);
    // «MNT» ба тооны хооронд ЗАЙ — эс бөгөөс «MNT978,161,095» болно.
    assert.ok(/MNT "&TEXT\(Z20\)/.test(got), `MNT-ийн дараах зай алга: ${got}`);
  }
});

test('ИХЭР ХАМГААЛАЛТ: загвар үүсгэгчийн томьёоны кирилл литерал БҮР тольд байна', () => {
  // CLAUDE.md: «толины түлхүүрүүд генераторын мөрүүдтэй БАЙТ-ААРАА ижил байх
  // ЁСТОЙ» — үүнийг өмнө нь ЮУ Ч шалгадаггүй байсан тул 2026-08 сард
  // «Хяналтын төсвийн нийт дүн» → «Эскиз зураг боловсруулах…» болж чимээгүй
  // зөрөөд, англи хуулбар дээр тэр мөр орчуулагдахаа больсон.
  const generators = [
    '../../scripts/gen-control-budget-template.mjs',
    '../../scripts/gen-default-quote-template.mjs',
  ];
  let checked = 0;
  for (const rel of generators) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    // `f: \`=…\`` хэлбэрийн томьёо → доторх "…" литералууд
    for (const f of src.matchAll(/f:\s*`=([^`]*)`/g)) {
      for (const lit of (f[1] ?? '').matchAll(/"((?:[^"]|"")*)"/g)) {
        const core = (lit[1] ?? '').replace(/""/g, '"').trim();
        if (core === '' || !hasCyrillic(core)) continue;
        checked += 1;
        assert.ok(
          QUOTE_MN_EN_DICT[core] !== undefined,
          `${rel}-ийн томьёоны литерал QUOTE_MN_EN_DICT-д алга: ${JSON.stringify(core)}`,
        );
      }
    }
  }
  // Регрессийн хамгаалалт: regex эвдэрч 0 литерал олбол тест «дэмий ногоон»
  // болно — тиймээс наад зах нь дөрвийг шалгасан байх ёстой.
  assert.ok(checked >= 4, `зөвхөн ${checked} литерал шалгагдав — regex эвдэрсэн байж магадгүй`);
});

/* ------------------------------------------------------------------ */
/*  Цуглуулах — зөвхөн толинд БАЙХГҮЙ чөлөөт мөрүүд                    */
/* ------------------------------------------------------------------ */

test('collectTranslatables: толь/кирилгүй/тусгай нэрсийг алгасаж чөлөөт мөрүүдийг л буцаана', () => {
  const got = [...collectTranslatables(sampleWorkbook())].sort();
  assert.deepEqual(
    got,
    [
      'Багана "А" дүн', // томьёоны литерал, escape ТАЙЛСАН хэлбэрээр
      'Инженер геологи дэд тооцоо',
      'Номин цамхаг',
      'Түр тайлбар', // trim хийгдсэн
      'Хуудас2!A1 гэж бичнэ',
    ].sort(),
  );
});

/* ------------------------------------------------------------------ */
/*  Хэрэглэх — толь + AI, дутууг монголоор үлдээх                      */
/* ------------------------------------------------------------------ */

const AI_MAP = new Map([
  ['Номин цамхаг', 'Nomin Tower'],
  ['Түр тайлбар', 'Temporary note'],
  ['Багана "А" дүн', 'Column "A" total'],
  ['Хуудас2!A1 гэж бичнэ', 'Type Хуудас2!A1'],
  // «Инженер геологи дэд тооцоо»-г ЗОРИУД алгассан — dropout тест
]);

test('applyTranslations: толины мөр, dropdown, addons шошго, хуудасны нэр бүгд хөрвөнө', () => {
  const wb = applyTranslations(sampleWorkbook(), AI_MAP);
  const main = wb.sheets[0];
  assert.ok(main);

  // Нүдний литерал утгууд
  assert.equal(
    main.cells.A1?.v,
    'CONTROL BUDGET FOR THE DEVELOPMENT OF DESIGN DOCUMENTATION FOR BUILDINGS AND STRUCTURES',
  );
  assert.equal(main.cells.A2?.v, 'Building name');
  assert.equal(main.cells.A3?.v, 'SUBTOTAL');
  assert.equal(main.cells.B2?.v, 'Nomin Tower');
  // Эхлэл/төгсгөлийн зай хадгалагдана
  assert.equal(main.cells.I2?.v, '  Temporary note  ');
  // Кирилгүй нүд огт өөрчлөгдөхгүй
  assert.equal(main.cells.C2?.v, 'B1-B2');
  assert.equal(main.cells.D2?.v, 12345);
  assert.equal(main.cells.B4?.v, 'BMS');

  // Dropdown: утга + сонголтууд
  assert.equal(main.cells.E2?.v, 'm²');
  assert.deepEqual(main.cells.E2?.choices, ['m²', 'ha', 'borehole', 'lin.m', 'pcs']);
  assert.deepEqual(main.cells.G2?.choices, ['Low complexity', 'Medium complexity']);

  // addons шошгууд (items / lines / costLines / sections) — бусад талбар хэвээр
  const addons = main.addons as {
    items: { label: string }[];
    lines: { items: { label: string }[] };
    costLines: { items: { label: string; unit?: string }[] };
    sections: { items: { label: string; code?: string }[] };
  };
  assert.equal(addons.items[0]?.label, 'BMS /design fee×6%/');
  assert.equal(addons.lines.items[0]?.label, 'DISCOUNT');
  assert.equal(addons.costLines.items[0]?.label, 'Geotechnical investigation');
  assert.equal(addons.costLines.items[0]?.unit, 'цооног'); // unit ХӨНДӨГДӨХГҮЙ (spec)
  assert.equal(addons.sections.items[0]?.label, 'Architecture');
  assert.equal(addons.sections.items[0]?.code, 'BA');

  // Хуудасны нэрс
  assert.equal(main.name, 'Summary');
  assert.equal(wb.sheets[1]?.name, 'Sheet2');
  // anchors нь хуудасны ID-гаар заадаг тул хэвээр
  assert.deepEqual(wb.anchors, { total: { sheet: 'main', ref: 'Z20' } });
});

test('applyTranslations: томьёонд зөвхөн "..." литерал орчуулагдаж, лавлагаа нэрээ дагана', () => {
  const wb = applyTranslations(sampleWorkbook(), AI_MAP);
  const main = wb.sheets[0];
  assert.ok(main);

  // TARIF-ийн төвөгшлийн литерал — толиноос (tariffLookup-ийн англи түлхүүртэй хос)
  assert.equal(main.cells.H2?.f, '=TARIF(D2;"High complexity")');
  // Тайлбарын томьёо — литерал бүр тольд, TEXT/USGEER/лавлагаа хэвээр
  assert.equal(
    main.cells.A4?.f,
    '="Note: The grand total of this control budget is MNT "&TEXT(Z20)&" /"&USGEER(Z20)&" tugriks/."',
  );
  // Давхар хашилт escape хэвээр
  assert.equal(main.cells.J2?.f, '="Column ""A"" total"');
  // Хөндлөн лавлагаа: Хуудас2 → Sheet2 (нэр солигдоход томьёо дагана)
  assert.equal(main.cells.F4?.f, '=Sheet2!G14+5');
  // Литерал ДОТОРХ «Хуудас2!A1» rename-д ӨРТӨӨГҮЙ — зөвхөн орчуулагдсан
  assert.equal(main.cells.K2?.f, '="Type Хуудас2!A1"');
  // Кирилгүй томьёо яг хэвээр
  assert.equal(main.cells.F5?.f, '=IF(F4>4.5; 1+(F4-4.5)*0.05; 1)');
});

test('AI мөр алгасвал (dropout) тухайн нүд МОНГОЛООРОО үлдэнэ — хоосрохгүй', () => {
  const wb = applyTranslations(sampleWorkbook(), AI_MAP);
  // AI_MAP-д «Инженер геологи дэд тооцоо» байхгүй → эх монголоороо
  assert.equal(wb.sheets[1]?.cells.A1?.v, 'Инженер геологи дэд тооцоо');

  // AI огт хариу өгөөгүй (хоосон map) үед ч толь ажиллаж, чөлөөт мөр монголоор
  const bare = applyTranslations(sampleWorkbook(), new Map());
  assert.equal(bare.sheets[0]?.cells.A3?.v, 'SUBTOTAL'); // толь хэвээр
  assert.equal(bare.sheets[0]?.cells.B2?.v, 'Номин цамхаг'); // fallback = эх
});

test('applyTranslations: эх дэвтрийг ХӨНДӨХГҮЙ (шинэ объект буцаана)', () => {
  const src = sampleWorkbook();
  const out = applyTranslations(src, AI_MAP);
  assert.notEqual(out, src);
  assert.equal(src.sheets[0]?.cells.A3?.v, 'ДҮН');
  assert.equal(src.sheets[0]?.name, 'Нэгтгэл');
  assert.equal(src.sheets[0]?.cells.H2?.f, '=TARIF(D2;"Өндөр төвөгшилтэй")');
});

test('translateFreeText: толь → AI → эх монгол гэсэн дарааллаар', () => {
  assert.equal(translateFreeText('ДҮН', new Map()), 'SUBTOTAL');
  assert.equal(translateFreeText('Номин цамхаг', AI_MAP), 'Nomin Tower');
  assert.equal(translateFreeText('Огт мэдэгдэхгүй мөр', new Map()), 'Огт мэдэгдэхгүй мөр');
  assert.equal(translateFreeText('BMS', AI_MAP), 'BMS');
});

/* ------------------------------------------------------------------ */
/*  Хуудасны нэрийн лавлагаа — хөдөлгүүртэй ИЖИЛ танилт                 */
/* ------------------------------------------------------------------ */

/** «Хуудас2» гэсэн хоёр дахь хуудастай, түүн рүү ЯНЗ БҮРЭЭР лавласан дэвтэр. */
function refWorkbook(formulas: Record<string, string>, extraSheets: unknown[] = []) {
  return {
    sheets: [
      {
        id: 'main',
        name: 'Нэгтгэл',
        rows: 5,
        cols: 5,
        merges: [],
        anchors: {},
        cells: Object.fromEntries(Object.entries(formulas).map(([r, f]) => [r, { f }])),
      },
      { id: 's2', name: 'Хуудас2', rows: 3, cols: 3, merges: [], anchors: {}, cells: {} },
      ...extraSheets,
    ],
    activeSheet: 0,
    anchors: {},
  } as never;
}

test('хуудасны нэр солиход ТОМ/ЖИЖИГ үсэг, зай ялгалгүй лавлагаа дагана', () => {
  // Хөдөлгүүр хуудсыг `trim().toLowerCase()`-ээр олдог (formula/index.ts,
  // lib/workbook.ts), tokenizer нэр ба `!`-ийн хооронд зай зөвшөөрдөг — PM
  // гараар ийм хэлбэрээр бичсэн байхад англи хуулбар эвдэрч болохгүй.
  const wb = applyTranslations(
    refWorkbook({
      A1: '=Хуудас2!G14',
      A2: '=хуудас2!G14',        // жижиг үсгээр
      A3: '=ХУУДАС2!G14',        // том үсгээр
      A4: '=Хуудас2 !G14',       // `!`-ийн өмнө зай
      A5: "='Хуудас2'!G14",      // хашилттай
      B1: "=' Хуудас2 '!G14",    // хашилттай + дотор зай (хөдөлгүүр trim хийдэг)
      B2: '=Нэгтгэл!A1+Хуудас2!B2', // хоёр нэр нэг томьёонд
    }),
    new Map(),
  );
  const c = (wb.sheets[0] as { cells: Record<string, { f?: string }> }).cells;
  assert.equal(c.A1?.f, '=Sheet2!G14');
  assert.equal(c.A2?.f, '=Sheet2!G14');
  assert.equal(c.A3?.f, '=Sheet2!G14');
  assert.equal(c.A4?.f, '=Sheet2!G14'); // зай ЗАЛГИГДСАН
  assert.equal(c.A5?.f, '=Sheet2!G14');
  assert.equal(c.B1?.f, '=Sheet2!G14');
  assert.equal(c.B2?.f, '=Summary!A1+Sheet2!B2');
});

test('нэр солиход ДАВХАРДАЛ үүсгэхгүй (өөр хуудас тэр нэрийг эзэмшсэн бол)', () => {
  // «Хуудас2» → «Sheet2» боловч латин нэртэй «Sheet2» хуудас аль хэдийн бий:
  // давхардвал хөндлөн лавлагаа ЧИМЭЭГҮЙ буруу хуудас руу холбогдоно.
  const wb = applyTranslations(
    refWorkbook({ A1: '=Хуудас2!G14' }, [
      { id: 's3', name: 'Sheet2', rows: 3, cols: 3, merges: [], anchors: {}, cells: {} },
    ]),
    new Map(),
  );
  const names = (wb.sheets as { name: string }[]).map((s) => s.name);
  assert.deepEqual(names, ['Summary', 'Sheet22', 'Sheet2']);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
  const c = (wb.sheets[0] as { cells: Record<string, { f?: string }> }).cells;
  assert.equal(c.A1?.f, '=Sheet22!G14'); // ӨӨРИЙН хуудас руугаа заасаар
});

test('addons spec-ийн priceFormula-д хуудасны шинэ нэр тусна', () => {
  // Унтраасан зардлын мөрийг цэснээс дахин асаахад энэ томьёо нүдэнд ШУУД
  // бичигддэг (frontend lib/addons.ts) — хуучирсан нэр үлдвэл #ТОМЬЁО!
  const src = {
    sheets: [
      {
        id: 'main',
        name: 'Нэгтгэл',
        rows: 3,
        cols: 3,
        merges: [],
        anchors: {},
        cells: {},
        addons: {
          baseCol: 10,
          items: [{ key: 'bms', label: 'BMS /ЗТАҮ*6%/', pct: 6 }],
          costLines: {
            items: [
              {
                key: 'geology',
                label: 'Инженер геологийн судалгаа',
                kind: 'qty',
                unit: 'цооног',
                priceFormula: '=Хуудас2!G14',
              },
            ],
          },
        },
      },
      { id: 's2', name: 'Хуудас2', rows: 3, cols: 3, merges: [], anchors: {}, cells: {} },
    ],
    activeSheet: 0,
    anchors: {},
  } as never;
  const wb = applyTranslations(src, new Map());
  const spec = (wb.sheets[0] as { addons: { costLines: { items: Record<string, string>[] } } })
    .addons;
  assert.equal(spec.costLines.items[0]?.priceFormula, '=Sheet2!G14');
  assert.equal(spec.costLines.items[0]?.label, 'Geotechnical investigation');
  assert.equal(spec.costLines.items[0]?.unit, 'цооног'); // unit нь энэ давхаргад хөндөгдөхгүй
});

test('`null` нүд алдаа өгөхгүй, ЯГ хэвээрээ дамжина', () => {
  // Хадгалагдсан дэвтэрт ийм нүд таардаг (сервер JSON-ыг түүхийгээр хадгалдаг;
  // хөдөлгүүр ч `if (!cell) continue` гэж хамгаалдаг). Орчуулга шидвэл AI-гаа
  // зарцуулсны эцэст админд хоосон 500 очно.
  const wb = {
    sheets: [
      {
        id: 'a',
        name: 'Нэгтгэл',
        rows: 2,
        cols: 2,
        merges: [],
        anchors: {},
        cells: { A1: null, A2: { v: 'ДҮН' } },
      },
    ],
    activeSheet: 0,
    anchors: {},
  } as never;
  const out = applyTranslations(wb, new Map());
  const cells = (out.sheets[0] as { cells: Record<string, unknown> }).cells;
  assert.equal(cells.A1, null); // хэвээрээ — хаягдаагүй
  assert.deepEqual(cells.A2, { v: 'SUBTOTAL' });
  assert.deepEqual(collectTranslatables(wb), []);
});

/* ------------------------------------------------------------------ */
/*  Баримтын доод ТАЙЛБАРЫН төлөв (`SheetDoc.notes`)                    */
/* ------------------------------------------------------------------ */

/**
 * Тайлбарууд 2026-08-24-нөөс хойш хуудасны агуулгаас ДИНАМИКААР угсрагддаг
 * (`frontend/src/features/quotes/lib/quoteNotes.ts`) тул `QUOTE_MN_EN_DICT`-ийн
 * БҮТЭН-МӨРИЙН түлхүүрт таарахаа больсон. Frontend монгол↔англи хосыг хуудсанд
 * (`notes.i18n`) хамт хадгалж, `POST /:id/translate` түүнийг AI-гаас ДЭЭГҮҮР
 * тавьдаг. Энэ тест нь `applyTranslations`-ийн ТӨЛӨВ дээрх талыг барина.
 */
test('notes: `i18n` давхарга англи хуулбараас ХАЯГДАЖ, `text` нь орчуулагдана', () => {
  const wb = {
    sheets: [
      {
        id: 'a',
        name: 'Нэгтгэл',
        rows: 2,
        cols: 2,
        merges: [],
        anchors: {},
        cells: { A1: { v: 'ДҮН' } },
        notes: {
          off: ['geology'],
          text: { addons: 'ДҮН' },
          i18n: { 'зарим монгол өгүүлбэр': 'some english sentence' },
        },
      },
    ],
    activeSheet: 0,
    anchors: {},
  } as never;
  const out = applyTranslations(wb, new Map()) as unknown as {
    sheets: { notes?: { on?: string[]; off?: string[]; text?: Record<string, string>; i18n?: unknown } }[];
  };
  const notes = out.sheets[0]?.notes;
  // `i18n` нь МН→EN зураглал — англи хуудсан дээр утгагүй бөгөөд `syncNotes` ч
  // тэнд бичдэггүй. Үлдээвэл англи баримт хуучин монгол түлхүүрүүдээ дагуулна.
  assert.equal(notes?.i18n, undefined);
  // Түлхүүрүүд орчуулагдах ЁСГҮЙ (тэдгээр нь `NOTE_RULES`-ийн ID).
  assert.deepEqual(notes?.off, ['geology']);
  // PM-ийн гараар бичсэн бичвэр нь ЧӨЛӨӨТ текст — толь/AI-аар явна, эс бөгөөс
  // англи баримт нээгдэхэд `syncNotes` тэр МОНГОЛ бичвэрийг нүдэнд буцааж бичнэ.
  assert.deepEqual(notes?.text, { addons: 'SUBTOTAL' });
});

test('notes: `text` доторх чөлөөт мөр AI-ийн жагсаалтад ЦУГЛАРНА', () => {
  const wb = {
    sheets: [
      {
        id: 'a',
        name: 'Нэгтгэл',
        rows: 1,
        cols: 1,
        merges: [],
        anchors: {},
        cells: {},
        notes: { text: { addons: 'Онцгой нөхцөлөөр тооцов' } },
      },
    ],
    activeSheet: 0,
    anchors: {},
  } as never;
  assert.deepEqual(collectTranslatables(wb), ['Онцгой нөхцөлөөр тооцов']);
});
