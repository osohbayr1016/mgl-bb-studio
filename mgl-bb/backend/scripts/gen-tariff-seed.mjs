#!/usr/bin/env node
// migrations/0026_pricing_table9_v2.sql → migrations/0129_quote_tariffs_seed.sql
//
//   node backend/scripts/gen-tariff-seed.mjs
//
// БД 81-16-20/2020, заалт 4.20, Хүснэгт 9-ийн тарифыг хуучин `pricing_rates`
// хүснэгтийн seed-ээс уншаад Үнийн санал v2-ийн `quote_tariffs` руу хөрвүүлнэ.
//
// ⚠️ ШАТЛАЛЫН ДАХИН ТАЙЛБАРЛАЛТ (энэ script-ийн ГОЛ УТГА УЧИР)
// 0026 нь өөрийгөө «row-label-as-LOWER-bound» гэж тайлбарласан ба tuple нь
//   (complexity_id, min_area, max_area, unit, price_per_unit, source)
// хэлбэртэй. Тэнд `min_area` нь үнэндээ БД-ийн хүснэгтийн МӨРИЙН ШОШГО
// (50, 80, 100, 200, …, 1000, 1500, 2000, …). MGL-ийн PM-ууд бодит дээр энэ
// шошгыг шатлалын ДЭЭД хязгаар болгон хэрэглэдэг — талбайгаа дараагийн шошго
// хүртэл ДЭЭШ бөөрөнхийлдөг. Тиймээс:
//
//     quote_tariffs.area_max := 0026-ийн min_area   (мөрийн шошго)
//     quote_tariffs.rate     := 0026-ийн price_per_unit
//     0026-ийн max_area      := ҮЛ ТООМСОРЛОНО
//
// Хайлт: complexity таарсан мөрүүдээс `area_max >= талбай` нөхцөлийг хангах
// ХАМГИЙН БАГА area_max. Энэ конвенцийг MGL-ийн бодит 5 үнийн саналын тоогоор
// баталсан — доорх CHECKS массив нь тэр 5 тоо. Таарахгүй бол script алдаа шидэж
// зогсоно (seed үүсэхгүй).
//
// INSERT OR IGNORE ((area_max, complexity) PK дээр) тул idempotent; тарифын
// шинэчлэл = шинэ NNNN_quote_tariffs_seed_vN.sql (append-only дүрэм).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = join(here, '..', 'migrations', '0026_pricing_table9_v2.sql');
const outPath = join(here, '..', 'migrations', '0129_quote_tariffs_seed.sql');

/** 0026-ийн complexity_id → quote_tariffs.complexity код (БАТАЛГААЖСАН). */
const COMPLEXITY_BY_ID = {
  1: 'baga',
  2: 'dund',
  3: 'ondor',
  4: 'zovshoorolgui',
  5: 'ontsgoi',
};

/** Эрэмбэлэхэд ашиглах дараалал (гаралтыг тогтвортой болгоно). */
const COMPLEXITY_ORDER = ['zovshoorolgui', 'baga', 'dund', 'ondor', 'ontsgoi'];

/** quote_tariffs.source_ref-ийн монгол каноник утга (0128-ийн DEFAULT-тай ижил). */
const SOURCE_REF = 'БД 81-16-20/2020 4.20 Хүснэгт 9';

/**
 * Батлагдсан шалгалтууд — MGL-ийн бодит үнийн саналаас гарсан тоонууд.
 * [талбай, төвөгшил, хүлээгдэх тариф]
 */
const CHECKS = [
  [1200, 'ondor', 25161],
  [8400, 'ondor', 19924],
  [17196, 'dund', 16105],
  [37440, 'ontsgoi', 20042],
  [27550, 'ontsgoi', 20550],
];

/**
 * ⚠️ КАТАЛОГИЙН ДЭЭД ШАТЛАЛ — САНААТАЙ ЦЭГЛЭВ.
 *
 * Хүснэгт 9 нь төвөгшил тус бүрийн ХАМГИЙН ТОМ шошгоор тасардаг: цаашид үнэ
 * НИЙТЛЭГДЭЭГҮЙ. Энэ массив ХОЁР зүйлийг цэглэнэ:
 *
 *   1. Дээд шатлалын ЯГ ХАНШ (`expected` тоо). Ажиллах үед `makeTariffFn` нь
 *      таазаас давсан талбайг ЭНЭ ханшаар тооцдог (MGL-ийн шийдвэр,
 *      2026-08-19: «50,000 ч бай, 60,000 ч бай бүгд 50,000-ын ханшаар»), тул
 *      эдгээр тоо өөрчлөгдвөл БҮХ том төслийн үнэ өөрчлөгдөнө.
 *   2. Тааз хаана байгаа (`expected === null` = ДАТА-д мөр байхгүй). Ханшийг
 *      үргэлжлүүлэх дүрэм нь ДАТА биш КОД дээр байдаг —
 *      `frontend/src/features/quotes/lib/tariffLookup.ts` (шалтгааныг тэнд үз).
 *      Энэ seed-д «хязгааргүй» sentinel мөр НЭМЭХГҮЙ.
 *
 * ⚠️ 2026-08-19 хүртэл ЭНЭ ШАЛГАЛТ ОГТ БАЙГААГҮЙ: хамгийн том сорьц нь
 * 37,440 м² буюу 50,000-ын таазаас доогуур байсан тул 54,060 м²-ийн бодит
 * эвдрэл хэн нэгний шийдвэргүйгээр нийлүүлэгдсэн.
 */
const CEILING_CHECKS = [
  // Дээд шатлалын ханш — clamp-ийн ГАРАЛТ. Өөрчлөгдвөл үнэ өөрчлөгдөнө.
  [50000, 'ontsgoi', 19496],
  [50000, 'ondor', 16963],
  [40000, 'dund', 9545],
  [15000, 'baga', 14403],
  [400, 'zovshoorolgui', 30529],
  // Тааз — ДАТА-д цаашид мөр байхгүй (сунгалт нь кодод).
  [50001, 'ontsgoi', null],
  [54060, 'ontsgoi', null], // ← бодит эвдрэлийн тохиолдол (2026-08-19)
  [50001, 'ondor', null],
  [40001, 'dund', null],
  [15001, 'baga', null],
  [401, 'zovshoorolgui', null],
];

const ALL_CHECKS = [...CHECKS, ...CEILING_CHECKS];

/* ---------------------------------------------------------------- */
/*  1) 0026-ийн tuple-уудыг regex-ээр унших                           */
/* ---------------------------------------------------------------- */

const sql = readFileSync(srcPath, 'utf8');

// (complexity_id, min_area, max_area, 'unit', price_per_unit, 'source')
// max_area нь тоо эсвэл NULL байж болно — үл тоомсорлоно.
const TUPLE_RE =
  /\(\s*(\d+)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(?:NULL|\d+(?:\.\d+)?)\s*,\s*'[^']*'\s*,\s*(\d+(?:\.\d+)?)\s*,\s*'[^']*'\s*\)/g;

/** @type {{ area_max: number, complexity: string, rate: number }[]} */
const rows = [];
const seen = new Set();

for (const m of sql.matchAll(TUPLE_RE)) {
  const complexityId = Number(m[1]);
  const areaMax = Number(m[2]); // ← 0026-ийн min_area = мөрийн шошго = ДЭЭД хязгаар
  const rate = Math.round(Number(m[3]));

  const complexity = COMPLEXITY_BY_ID[complexityId];
  if (!complexity) {
    throw new Error(`Тодорхойгүй complexity_id=${complexityId}: ${m[0]}`);
  }
  if (!Number.isFinite(areaMax) || areaMax <= 0) {
    throw new Error(`Буруу area_max=${m[2]}: ${m[0]}`);
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Буруу rate=${m[3]}: ${m[0]}`);
  }

  const key = `${complexity}:${areaMax}`;
  if (seen.has(key)) {
    throw new Error(`Давхардсан (area_max, complexity) хос: ${key}`);
  }
  seen.add(key);
  rows.push({ area_max: areaMax, complexity, rate });
}

if (rows.length === 0) {
  throw new Error(`${srcPath}: нэг ч tuple олдсонгүй — regex эсвэл эх файл өөрчлөгдсөн үү?`);
}

rows.sort((a, b) => {
  const ci = COMPLEXITY_ORDER.indexOf(a.complexity) - COMPLEXITY_ORDER.indexOf(b.complexity);
  return ci !== 0 ? ci : a.area_max - b.area_max;
});

/* ---------------------------------------------------------------- */
/*  2) ӨӨРИЙН ШАЛГАЛТ — таарахгүй бол seed үүсэхгүй                   */
/* ---------------------------------------------------------------- */

/** SQL хайлтын яг ижил логик: complexity таарна AND area_max >= талбай → хамгийн бага area_max. */
function tarif(area, complexity) {
  let best = null;
  for (const r of rows) {
    if (r.complexity !== complexity) continue;
    if (r.area_max < area) continue;
    if (best === null || r.area_max < best.area_max) best = r;
  }
  return best;
}

const failures = [];
for (const [area, complexity, expected] of ALL_CHECKS) {
  const hit = tarif(area, complexity);
  if (expected === null) {
    // Каталогийн дээд хязгаараас дээш — мөр ОЛДОХ ЁСГҮЙ.
    if (hit) {
      failures.push(
        `TARIF(${area}, '${complexity}') -> ${hit.rate} (area_max=${hit.area_max}), хүлээсэн: мөр ОЛДОХГҮЙ`,
      );
    } else {
      console.log(`  ✓ TARIF(${area}, '${complexity}') = мөргүй (каталогийн дээд хязгаар)`);
    }
  } else if (!hit) {
    failures.push(`TARIF(${area}, '${complexity}') → мөр олдсонгүй (хүлээсэн ${expected})`);
  } else if (hit.rate !== expected) {
    failures.push(
      `TARIF(${area}, '${complexity}') → ${hit.rate} (area_max=${hit.area_max}), хүлээсэн ${expected}`,
    );
  } else {
    console.log(`  ✓ TARIF(${area}, '${complexity}') = ${hit.rate}  [area_max=${hit.area_max}]`);
  }
}

if (failures.length > 0) {
  throw new Error(
    `Тарифын шалгалт УНАЛАА (${failures.length}/${ALL_CHECKS.length}) — seed үүсгэхгүй:\n  ` +
      failures.join('\n  '),
  );
}

/* ---------------------------------------------------------------- */
/*  3) SQL үүсгэх                                                     */
/* ---------------------------------------------------------------- */

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (Number.isInteger(v) ? String(v) : String(v));

const CHUNK = 50;
const statements = [];
for (let i = 0; i < rows.length; i += CHUNK) {
  const values = rows
    .slice(i, i + CHUNK)
    .map((r) => `  (${num(r.area_max)}, ${q(r.complexity)}, ${num(r.rate)}, ${q(SOURCE_REF)})`)
    .join(',\n');
  statements.push(
    `INSERT OR IGNORE INTO quote_tariffs (area_max, complexity, rate, source_ref) VALUES\n${values};`,
  );
}

const byComplexity = COMPLEXITY_ORDER.map((c) => {
  const list = rows.filter((r) => r.complexity === c);
  if (list.length === 0) return null;
  const min = list[0].area_max;
  const max = list[list.length - 1].area_max;
  return `${c}: ${list.length} мөр (area_max ${min}–${max})`;
}).filter(Boolean);

const header = `-- ⚙️ АВТОМАТААР ҮҮСГЭСЭН ФАЙЛ — ГАРААР БҮҮ ЗАСВАРЛА.
-- Үүсгэх: node backend/scripts/gen-tariff-seed.mjs
--
-- Эх сурвалж: migrations/0026_pricing_table9_v2.sql (pricing_rates seed),
--             БД 81-16-20/2020, заалт 4.20, Хүснэгт 9.
-- Нийт ${rows.length} мөр:
${byComplexity.map((s) => `--   • ${s}`).join('\n')}
--
-- ⚠️ ШАТЛАЛ: 0026-ийн \`min_area\` (БД-ийн хүснэгтийн МӨРИЙН ШОШГО) нь энд
-- \`area_max\` буюу шатлалын ДЭЭД хязгаар болж хөрвөв — MGL-ийн PM-ууд талбайг
-- дараагийн шошго хүртэл ДЭЭШ бөөрөнхийлдөг (1,200 м² → 1500-ын мөр → 25,161 ₮).
-- 0026-ийн \`max_area\` баганыг үл тоомсорлосон. Хөрвүүлэлтийг script нь MGL-ийн
-- бодит 5 үнийн саналын тоогоор ШАЛГАСАН (1200/өндөр, 8400/өндөр, 17196/дунд,
-- 37440/онцгой, 27550/онцгой) — таараагүй бол энэ файл үүсэхгүй.
--
-- INSERT OR IGNORE ((area_max, complexity) PK) тул давтан ажиллуулахад аюулгүй;
-- тарифын шинэчлэл = шинэ seed migration (append-only).

`;

writeFileSync(outPath, header + statements.join('\n\n') + '\n', 'utf8');
console.log(`OK: ${outPath} — ${rows.length} мөр, ${statements.length} statement`);
