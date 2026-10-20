#!/usr/bin/env node
/**
 * Үнийн саналын ҮНДСЭН ЗАГВАРЫГ (default template) үүсгэж
 * `backend/migrations/0130_quote_default_template.sql` болгон бичнэ.
 *
 *   node backend/scripts/gen-default-quote-template.mjs
 *
 * Загвар нь MGL-ийн бодит Excel үнийн саналын бүтцийг яг давтана
 * (2026.06.22 «16 давхар үйлчилгээтэй орон сууц», 2026.07.03 «ТОП ДОНЖ ХХК»):
 * гарчиг → бүлгийн толгой → 13 баганат хүснэгт → нийлбэрийн блок → АЗ-ийн
 * 7 хэсгийн жагсаалт → тайлбар (дүн үсгээр) → гарын үсэг.
 *
 * Мөрүүд нь ХООСОН боловч ТОМЬЁО нь бүрэн тавигдсан: PM зөвхөн нэр, давхар,
 * талбай, төвөгшлөө бичихэд тариф каталогоос өөрөө татагдаж, бүх дүн
 * тооцоологдоно. Тэрнээс хойш хуудас бүрэн чөлөөтэй — мөр нэмэх, томьёо
 * өөрчлөх, багана нэмэх бүгд боломжтой.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '0130_quote_default_template.sql',
);

/* ------------------------------------------------------------------ */
/*  Туслахууд                                                          */
/* ------------------------------------------------------------------ */

/** 0-ээс эхэлсэн (r,c) → A1 хэлбэрийн хаяг. */
function ref(r, c) {
  let name = '';
  let n = c;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${name}${r + 1}`;
}

const cells = {};
const merges = [];

/** Нүд тавих. `cell` нь {v|f, fmt, s}. */
function put(r, c, cell) {
  cells[ref(r, c)] = cell;
}

/** Мөрийн хэсгийг нэгтгээд зүүн дээд нүдэнд утга тавина. */
function span(r, c1, c2, cell) {
  if (c2 > c1) merges.push({ r, c: c1, rs: 1, cs: c2 - c1 + 1 });
  put(r, c1, cell);
}

/**
 * Төвөгшлийн dropdown-ийн сонголтууд. `tariffLookup.normalizeComplexity` нь
 * эдгээрийг түлхүүр үгээр (бага/дунд/өндөр/онцгой) таана.
 */
const COMPLEXITY_CHOICES = [
  // ⚠️ «Барилгын ажлын зөвшөөрөл шаардлагагүй» нь СОНГОЛТООС хасагдсан
  // (хэрэглэгчийн шийдвэр 2026-07-24) — практикт хэрэглэгддэггүй. Тарифын
  // каталогт (`zovshoorolgui`, 50-400 м²) хэвээр байгаа тул гараар бичсэн
  // эсвэл хуучин саналд сонгогдсон бол `TARIF()` хэвийн ажиллана.
  'Бага төвөгшилтэй',
  'Дунд төвөгшилтэй',
  'Өндөр төвөгшилтэй',
  'Онцгой төвөгшилтэй',
];

const B = { border: true };
const HDR = { bold: true, align: 'center', bg: 'header', border: true, wrap: true };
const GRP = { bold: true, align: 'center', bg: 'group', border: true, wrap: true };
const LBL = { align: 'left', border: true };
const LBL_R = { bold: true, align: 'right', border: true };
const LBL_R_PLAIN = { align: 'right', border: true };
const NUM = { align: 'right', border: true };
const TOTAL = { bold: true, align: 'right', border: true, color: 'danger' };

/* Багана: 0=Д/д 1=Нэр 2=Давхар 3=Давхрын талбай 4=Нийт талбай 5=Төвөгшил
   6=м² үнэ 7=Зураг төслийн үнэ 8=Усаар гал 4% 9=Галын автоматик 6%
   10=Хөргөлт 5% 11=Газар хөдлөлт 10% 12=Нийт */
const COLS = 13;
const C = {
  no: 0, name: 1, floors: 2, floorArea: 3, area: 4, cx: 5,
  rate: 6, base: 7, water: 8, fire: 9, cool: 10, quake: 11, total: 12,
};

/* ------------------------------------------------------------------ */
/*  1. Гарчиг                                                          */
/* ------------------------------------------------------------------ */

span(0, 0, COLS - 1, {
  v: 'БАРИЛГЫН ЗАГВАР ЗУРАГ БОЛОН АЖЛЫН ЗУРАГ БОЛОВСРУУЛАХ ҮНИЙН САНАЛ',
  s: { bold: true, align: 'center', wrap: true },
});

/* ------------------------------------------------------------------ */
/*  2. Бүлгийн толгой (эх сурвалжийн заалт)                            */
/* ------------------------------------------------------------------ */

span(1, C.floorArea, C.base, {
  v: 'Зураг төсөл боловсруулах үнийг «Зураг төслийн ажлын жишиг үнэ» БД 81-16-20/2020-ийг үндэслэн тооцов.',
  s: GRP,
});
span(1, C.water, C.quake, {
  v: '*БД 81-16-20/2020-4.19, 4.21 дагуу технологийн өндөр шаардлагатай барилгад нэмж тооцно.',
  s: GRP,
});
// Д/д, Нэр, Давхар, Нийт баганууд толгойн 2 мөрийг эзэлнэ.
for (const c of [C.no, C.name, C.floors, C.total]) merges.push({ r: 1, c, rs: 2, cs: 1 });

/* ------------------------------------------------------------------ */
/*  3. Баганын толгой                                                  */
/* ------------------------------------------------------------------ */

put(1, C.no, { v: 'Д/д', s: HDR });
put(1, C.name, { v: 'Барилгын нэр', s: HDR });
put(1, C.floors, { v: 'Барилгын давхар', s: HDR });
put(1, C.total, { v: 'Нийт зураг төслийн ажлын үнэ /төг/', s: HDR });

put(2, C.floorArea, { v: 'Давхрын талбай/ м²', s: HDR });
put(2, C.area, { v: 'Нийт талбай/ м²', s: HDR });
put(2, C.cx, { v: 'Барилгын төвөгшил', s: HDR });
put(2, C.rate, { v: 'м² үнэ /төг/', s: HDR });
put(2, C.base, { v: 'Зураг төслийн ажлын үнэ /төг/', s: HDR });
put(2, C.water, { v: 'Усаар гал унтраах систем 4%', s: HDR });
put(2, C.fire, { v: 'Галын автоматик 6%', s: HDR });
put(2, C.cool, { v: 'Хөргөлт 5%', s: HDR });
put(2, C.quake, { v: '8 балл газар хөдлөлтийн итгэлцүүр 10%', s: HDR });

/* ------------------------------------------------------------------ */
/*  4. Өгөгдлийн мөрүүд (3 ш, хоосон боловч томьёотой)                 */
/* ------------------------------------------------------------------ */

const FIRST_DATA = 3;
const DATA_ROWS = 3;
const LAST_DATA = FIRST_DATA + DATA_ROWS - 1;

for (let i = 0; i < DATA_ROWS; i += 1) {
  const r = FIRST_DATA + i;
  const A = (c) => ref(r, c); // тухайн мөрийн нүдний хаяг

  put(r, C.no, { v: i + 1, s: { align: 'center', border: true } });
  put(r, C.name, { v: '', s: LBL });
  put(r, C.floors, { v: '', s: { align: 'center', border: true } });
  put(r, C.floorArea, { v: '', fmt: '#,##0', s: NUM });
  // Нийт талбай нь DEFAULT-аар Давхрын талбайтай тэнцүү (`=D`). Нэг давхар
  // барилгад автоматаар таарна; олон давхар бол PM энэ нүдийг засаж бүтэн тоог
  // (эсвэл `=D4*15` мэт томьёо) бичнэ — тэр үед формулыг литерал дарж бичнэ.
  put(r, C.area, { f: `=${A(C.floorArea)}`, fmt: '#,##0', s: NUM });
  // Төвөгшил: DROPDOWN — PM жагсаалтаас сонгоно (чөлөөт бичлэг биш). Хадгалагдах
  // утга нь текст хэвээр тул TARIF() ямар ч өөрчлөлтгүй ажиллана.
  put(r, C.cx, {
    v: '',
    choices: COMPLEXITY_CHOICES,
    s: { align: 'center', border: true, wrap: true },
  });
  // Тариф каталогоос: талбайг ДЭЭШ бөөрөнхийлж Хүснэгт 9-өөс уншина.
  put(r, C.rate, { f: `=TARIF(${A(C.area)};${A(C.cx)})`, fmt: '#,##0', s: NUM });
  put(r, C.base, { f: `=${A(C.area)}*${A(C.rate)}`, fmt: '#,##0', s: NUM });
  put(r, C.water, { f: `=${A(C.base)}*4%`, fmt: '#,##0', s: NUM });
  put(r, C.fire, { f: `=${A(C.base)}*6%`, fmt: '#,##0', s: NUM });
  put(r, C.cool, { f: `=${A(C.base)}*5%`, fmt: '#,##0', s: NUM });
  put(r, C.quake, { f: `=${A(C.base)}*10%`, fmt: '#,##0', s: NUM });
  put(r, C.total, {
    f: `=${A(C.base)}+${A(C.water)}+${A(C.fire)}+${A(C.cool)}+${A(C.quake)}`,
    fmt: '#,##0',
    s: NUM,
  });
}

/* ------------------------------------------------------------------ */
/*  5. Нийлбэрийн блок                                                 */
/* ------------------------------------------------------------------ */

const R_SUM = LAST_DATA + 1; // Нийт ажлын зургийн үнийн дүн
const R_SKETCH = R_SUM + 1; // Эскиз 15%
const R_INDEX = R_SKETCH + 1; // Үнийн индекс 25%
const R_DUN = R_INDEX + 1; // ДҮН
const R_MGMT = R_DUN + 1; // Менежмент 2%
const R_VAT = R_MGMT + 1; // НӨАТ 10%
const R_TOTAL = R_VAT + 1; // НИЙТ ҮНЭ
const R_LAST_DISC = R_TOTAL + 1; // 7 дахь хэсэг

span(R_SUM, C.no, C.quake, {
  v: 'Нийт ажлын зургийн үнийн дүн',
  s: { bold: true, align: 'right', bg: 'group', border: true },
});
put(R_SUM, C.total, {
  f: `=SUM(${ref(FIRST_DATA, C.total)}:${ref(LAST_DATA, C.total)})`,
  fmt: '#,##0',
  s: { bold: true, align: 'right', bg: 'group', border: true },
});

span(R_SKETCH, C.no, C.quake, {
  v: 'Загвар /эскиз/ зураг нь нийт ажлын зургийн үнийн дүнгийн 15%-р тооцогдоно',
  s: LBL,
});
put(R_SKETCH, C.total, { f: `=${ref(R_SUM, C.total)}*15%`, fmt: '#,##0', s: NUM });

span(R_INDEX, C.no, C.quake, {
  v: 'Хэрэглэгчийн үнийн индекс 60%-р хөнгөлөгдөж ороод 25%-р тооцно',
  s: LBL,
});
put(R_INDEX, C.total, { f: `=${ref(R_SUM, C.total)}*25%`, fmt: '#,##0', s: NUM });

/* --- АЗ-ийн жагсаалт (зүүн) + дүнгийн шат (баруун) --- */

span(R_DUN, C.no, C.rate, {
  v: 'Барилгын ажлын зураг төслийн үнэ /АЗ/',
  s: { bold: true, align: 'center', bg: 'group', border: true },
});
span(R_DUN, C.base, C.quake, { v: 'ДҮН:', s: LBL_R });
put(R_DUN, C.total, {
  f: `=${ref(R_SUM, C.total)}+${ref(R_SKETCH, C.total)}+${ref(R_INDEX, C.total)}`,
  fmt: '#,##0',
  s: { bold: true, align: 'right', border: true },
});

const DISCIPLINES = [
  ['1. Барилга архитектур', '4. Цэвэр бохир ус'],
  ['2. Барилга бүтэц', '5. Цахилгаан хангамж'],
  ['3. Халаалт агаар сэлгэлт', '6. Холбоо дохиолол'],
  ['', '7. Галын автоматик'],
];
DISCIPLINES.forEach(([left, right], i) => {
  const r = R_MGMT + i;
  span(r, C.no, C.floorArea, { v: left, s: LBL });
  span(r, C.area, C.rate, { v: right, s: LBL });
});

span(R_MGMT, C.base, C.quake, { v: 'МЕНЕЖМЕНТ /2%/:', s: LBL_R_PLAIN });
put(R_MGMT, C.total, { f: `=${ref(R_DUN, C.total)}*2%`, fmt: '#,##0', s: NUM });

span(R_VAT, C.base, C.quake, { v: 'НӨАТ 10%:', s: LBL_R_PLAIN });
put(R_VAT, C.total, { f: `=${ref(R_DUN, C.total)}*10%`, fmt: '#,##0', s: NUM });

span(R_TOTAL, C.base, C.quake, {
  v: 'НИЙТ ҮНЭ:',
  s: { bold: true, align: 'right', border: true, color: 'danger' },
});
put(R_TOTAL, C.total, {
  f: `=${ref(R_DUN, C.total)}+${ref(R_MGMT, C.total)}+${ref(R_VAT, C.total)}`,
  fmt: '#,##0',
  s: TOTAL,
});

span(R_LAST_DISC, C.base, C.quake, { v: '', s: B });
put(R_LAST_DISC, C.total, { v: '', s: B });

/* ------------------------------------------------------------------ */
/*  6. Тайлбар (дүн үсгээр) + гарын үсэг                               */
/* ------------------------------------------------------------------ */

const R_NOTE = R_LAST_DISC + 2;
span(R_NOTE, C.no, COLS - 1, {
  f: `="Тайлбар:  Зураг төсөл боловсруулах ажлын үнийн дүн ₮"&TEXT(${ref(R_TOTAL, C.total)})&" /"&USGEER(${ref(R_TOTAL, C.total)})&" төгрөг/ болно."`,
  s: { align: 'left', wrap: true },
});

const R_SIGN = R_NOTE + 2;
span(R_SIGN, C.no, C.cx, { v: 'БОЛОВСРУУЛСАН:', s: { bold: true, align: 'left' } });
span(R_SIGN + 2, C.no, C.cx, { v: '«Эм Жи Эл И Эн Си» ХХК-ийн', s: { align: 'left' } });
span(R_SIGN + 3, C.no, C.cx, { v: 'Төслийн менежер:', s: { align: 'left' } });
span(R_SIGN + 3, C.rate, C.quake, { v: '..................................', s: { align: 'center' } });

const ROWS = R_SIGN + 5;

/* ------------------------------------------------------------------ */
/*  Хуудас + хувилбарууд                                               */
/* ------------------------------------------------------------------ */

const sheet = {
  rows: ROWS,
  cols: COLS,
  colWidths: [40, 190, 80, 85, 85, 120, 85, 125, 100, 95, 90, 110, 135],
  merges,
  cells,
  anchors: {
    total: ref(R_TOTAL, C.total),
    subtotal: ref(R_DUN, C.total),
    title: ref(0, 0),
  },
  /**
   * «Нэмэгдэл» цэсийн тодорхойлолт (`frontend/src/features/quotes/lib/addons.ts`).
   * Инвариант: нэмэгдэл багана нь `baseCol` (Зураг төслийн ажлын үнэ)-ийн яг
   * баруун талд дараалан, «Нийт үнэ» нь тэдгээрийн дараа.
   * ⚠️ `key` нь `STANDARD_ADDONS`-той таарах ёстой.
   */
  addons: {
    baseCol: C.base,
    headerRow: 2,
    groupRow: 1,
    firstRow: FIRST_DATA,
    lastRow: LAST_DATA,
    items: [
      { key: 'water', label: 'Усаар гал унтраах систем 4%', pct: 4 },
      { key: 'fire', label: 'Галын автоматик 6%', pct: 6 },
      { key: 'cool', label: 'Хөргөлт 5%', pct: 5 },
      { key: 'quake', label: '8 балл газар хөдлөлтийн итгэлцүүр 10%', pct: 10 },
    ],
  },
};

/**
 * Хувилбарууд. `hiddenRows` нь энэ хувилбарт хамааралгүй мөрүүд — шинэ санал
 * үүсгэхэд агуулга нь цэвэрлэгдэнэ (мөр өөрөө үлдэнэ, ингэснээр томьёоны
 * лавлагаа эвдэрдэггүй).
 *
 * «Зохиогчийн хяналт» нь эскиз/индексийн мөргүй, оронд нь ажлын зургийн
 * дүнгийн 50%-иар тооцогддог (2026.07.03-ны ТОП ДОНЖ-ийн саналын дагуу) —
 * PM тэр хоёр мөрийг засаад ашиглана.
 */
const variants = [
  {
    key: 'design',
    label: 'Ажлын зураг',
    titleTemplate: '{{object}}-НЫ БАРИЛГЫН ЗАГВАР ЗУРАГ БОЛОН АЖЛЫН ЗУРАГ БОЛОВСРУУЛАХ ҮНИЙН САНАЛ',
    hiddenRows: [],
  },
  {
    key: 'supervision',
    label: 'Зохиогчийн хяналт',
    titleTemplate: '{{object}}-НЫ БАРИЛГЫН ЗОХИОГЧИЙН ХЯНАЛТЫН ҮНИЙН САНАЛ',
    hiddenRows: [R_SKETCH, R_INDEX],
  },
];

/* ------------------------------------------------------------------ */
/*  SQL                                                                */
/* ------------------------------------------------------------------ */

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const sql = `-- ⚙️ АВТОМАТААР ҮҮСГЭСЭН — ГАРААР БҮҮ ЗАС.
-- Дахин үүсгэх:  node backend/scripts/gen-default-quote-template.mjs
--
-- Үнийн саналын үндсэн загвар (default template). Бүтэц нь MGL-ийн бодит
-- Excel үнийн саналуудыг давтана; мөрүүд хоосон боловч томьёо бүрэн тавигдсан.
-- Тариф нь TARIF(нийт талбай; төвөгшил) -ээр quote_tariffs каталогоос татагдана.
--
-- Anchor: total=${sheet.anchors.total} · subtotal=${sheet.anchors.subtotal} · title=${sheet.anchors.title}
-- Хэмжээ: ${ROWS} мөр × ${COLS} багана, ${Object.keys(cells).length} нүд, ${merges.length} merge.

-- ⚠️ НЭРЭЭР нь солино (is_default-аар БИШ). Өмнө нь \`WHERE is_default = 1\`
-- байсан нь дахин ажиллуулах бүрд ӨӨР загварыг (жишээ нь Хяналтын төсвийг)
-- устгаад энэ загварын хуучин мөрийг үлдээж давхардал үүсгэдэг байв.
DELETE FROM quote_templates WHERE name = 'БД 81-16-20 үндсэн загвар';

-- Хяналтын төсөв (0131) нь ҮНДСЭН загвар; энэ нь сонголтын нэг хувилбар.
INSERT INTO quote_templates (name, version, is_default, sheet_json, variants_json)
VALUES (
  ${q('БД 81-16-20 үндсэн загвар')},
  1,
  (SELECT CASE WHEN EXISTS (SELECT 1 FROM quote_templates WHERE is_default = 1) THEN 0 ELSE 1 END),
  ${q(JSON.stringify(sheet))},
  ${q(JSON.stringify(variants))}
);
`;

writeFileSync(OUT, sql, 'utf8');
console.log(
  `✔ ${OUT}\n  ${ROWS} мөр × ${COLS} багана · ${Object.keys(cells).length} нүд · ${merges.length} merge\n  anchors: ${JSON.stringify(sheet.anchors)}`,
);
