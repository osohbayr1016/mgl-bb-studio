/**
 * БАРИМТЫН ДООД ТАЙЛБАРЫН РЕГРЕСС ШАЛГАЛТ.
 *
 *   node scripts/check-quote-notes.mjs        (frontend/ хавтаснаас)
 *
 * ── Яагаад ЭНЭ хэлбэрээр вэ? ───────────────────────────────────────────────
 * Репод frontend тест ХАРААХАН БАЙХГҮЙ (CLAUDE.md), гэвч `lib/quoteNotes.ts`
 * нь захиалагч руу явах баримтын БИЧВЭРИЙГ бичдэг — улсын стандартын эшлэл,
 * хувь, талбайн хэмжээ. Тэнд гарсан регресс нь ЧИМЭЭГҮЙ: PDF нь хэвийн
 * харагдсаар атлаа хийгээгүй ажлыг үнэлсэн мэт бичигдэнэ. Тиймээс `nav-matrix`
 * скриптийн жишгээр гараар ажиллуулдаг шалгагч болгов — vitest суулгах шаардлага
 * үүсгэхгүй.
 *
 * Шалгалт нь ХИЙСВЭР өгөгдөл дээр БИШ, PRODUCTION-Д ХЭРЭГЖСЭН ЗАГВАРЫН
 * `sheet_json` дээр ажиллана (`backend/migrations/0185_*.sql`) — мөрийн
 * дугаарын арифметик, merge, USGEER-ийн томьёо бүгд бодитоор шалгагдана.
 *
 * ⚠️ Node-ийн ESM loader нь өргөтгөлгүй импортыг шийддэггүй (эх код `from
 * './sheetOps'` гэж бичдэг, tsc/rolldown нь Bundler горимоор шийддэг). Тиймээс
 * `backend/src/lib/webPush.test.ts`-ийн жишгээр resolve hook тавина.
 */
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'features', 'quotes', 'lib');
const MIGRATION = join(
  HERE,
  '..',
  '..',
  'backend',
  'migrations',
  '0185_control_budget_full_width_and_notes.sql',
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : LIB;
      const asFile = join(base, `${specifier}.ts`);
      if (existsSync(asFile)) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(`${specifier}/index.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const N = await import(pathToFileURL(join(LIB, 'quoteNotes.ts')).href);
const S = await import(pathToFileURL(join(LIB, 'signatureBlock.ts')).href);
const A = await import(pathToFileURL(join(LIB, 'addons.ts')).href);
const SQ = await import(pathToFileURL(join(LIB, 'scopeQuote.ts')).href);

/* ------------------------------------------------------------------ */
/*  Хэрэгжсэн загварын sheet_json-ыг migration-аас гаргаж авах          */
/* ------------------------------------------------------------------ */

function templateSheet() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const marker = /sheet_json\s*=\s*'/.exec(sql);
  assert.ok(marker, 'migration дотроос sheet_json олдсонгүй');
  let i = marker.index + marker[0].length;
  let out = '';
  for (; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      if (sql[i + 1] === "'") {
        out += "'"; // SQL-ийн давхар хашилт = нэг хашилт
        i += 1;
        continue;
      }
      break;
    }
    out += ch;
  }
  return JSON.parse(out).sheets[0];
}

const RAW = templateSheet();
const base = () => structuredClone(RAW);

const ref = (r, c) => {
  let n = c;
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${name}${r + 1}`;
};

/** Блокийн ХАРАГДАХ (хоосон биш) бичвэрүүд. */
const notes = (sheet, group) => {
  const b = N.findNoteBlocks(sheet).find((x) => x.group === group);
  if (!b) return null;
  return b.rows
    .map((r) => {
      const c = sheet.cells[ref(r, b.textCol)];
      return c && !c.f && typeof c.v === 'string' ? c.v : '';
    })
    .filter((t) => t !== '');
};

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✘ ${name}\n      ${err.message}`);
  }
};

console.log('Тайлбарын блок — 0185 загвар дээр:');

check('блок таних: BD 22..26, материал 27..29, USGEER (30) хөндөгдөхгүй', () => {
  const blocks = N.findNoteBlocks(base());
  assert.equal(blocks.length, 2);
  const bd = blocks.find((b) => b.group === 'bd');
  const mat = blocks.find((b) => b.group === 'material');
  assert.deepEqual(bd.rows, [22, 23, 24, 25, 26]);
  assert.deepEqual(mat.rows, [27, 28, 29]);
  assert.equal(bd.textCol, 2);
  // «Тайлбар:» гэж ЭХЭЛДЭГ ТОМЬЁОТОЙ (USGEER) мөр блокт орох ЁСГҮЙ.
  assert.ok(!bd.rows.includes(30) && !mat.rows.includes(30));
});

check('шинэ санал (тоо хэмжээ хоосон): зөвхөн 4.19-ийн өгүүлбэр үлдэнэ', () => {
  const sh = N.syncNotes(base(), 'mn');
  const bd = notes(sh, 'bd');
  assert.equal(bd.length, 1, JSON.stringify(bd));
  assert.ok(bd[0].includes('төсвийн 8%'));
  assert.ok(!bd.some((t) => /81-117-13|81-103-21|3\.5\.1/.test(t)));
  assert.deepEqual(notes(sh, 'material'), ['БД 81-16-20 Зураг төслийн ажлын жишиг үнэ']);
});

check('«Төсөв» нэмэгдэл унтраахад «төсвийн 8%» өгүүлбэрээс хасагдана', () => {
  let sh = N.syncNotes(base(), 'mn');
  sh = N.syncNotes(A.removeAddon(sh, 'tosov'), 'mn');
  const bd = notes(sh, 'bd');
  assert.ok(!bd[0].includes('төсвийн'), bd[0]);
  assert.ok(bd[0].includes('"BMS" системийн 6%'));
});

check('нэмэгдлийн ХУВЬ өөрчлөхөд өгүүлбэр дагана (6% → 7%)', () => {
  let sh = N.syncNotes(base(), 'mn');
  sh = N.syncNotes(A.setAddonPct(sh, 'bms', 7), 'mn');
  assert.ok(notes(sh, 'bd')[0].includes('"BMS" системийн 7%'));
});

check('тоо хэмжээ бөглөхөд гурван өгүүлбэр + материал буцаж орно', () => {
  const sh = base();
  const cl = sh.addons.costLines;
  const sumRow = 16; // Z17
  const rowOf = (k) => sumRow - cl.items.length + cl.items.findIndex((x) => x.key === k);
  const put = (r, c, v) => {
    sh.cells[ref(r, c)] = { ...(sh.cells[ref(r, c)] ?? {}), v };
  };
  put(rowOf('masterplan'), cl.qtyCol, 80);
  put(rowOf('geology'), cl.qtyCol, 12);
  put(rowOf('topography'), cl.qtyCol, 80);
  put(3, 5, 12); // эхний барилгын өндөр 12м → 4.21.3-ын итгэлцүүр ажиллана
  const out = N.syncNotes(sh, 'mn');
  const bd = notes(out, 'bd');
  assert.equal(bd.length, 5, JSON.stringify(bd, null, 1));
  assert.ok(bd[0].includes('4.21.3'));
  assert.ok(bd[2].includes('80га талбайн'), bd[2]);
  assert.equal(notes(out, 'material').length, 3);
});

check('өндөр 4,5м-ээс доош бол 4.21.3-ын өгүүлбэр гарахгүй', () => {
  const sh = base();
  sh.cells[ref(3, 5)] = { v: 3.6 };
  assert.ok(!notes(N.syncNotes(sh, 'mn'), 'bd').some((t) => t.includes('4.21.3')));
});

check('toggleNote: хүчээр асаах → буцаахад төлөв ЦЭВЭР арилна', () => {
  let sh = N.syncNotes(base(), 'mn');
  sh = N.toggleNote(sh, 'geology', 'mn');
  assert.ok(notes(sh, 'bd').some((t) => t.includes('81-117-13')));
  assert.deepEqual(sh.notes.on, ['geology']);
  sh = N.toggleNote(sh, 'geology', 'mn');
  assert.ok(!notes(sh, 'bd').some((t) => t.includes('81-117-13')));
  assert.equal(sh.notes?.on, undefined);
});

check('БҮГДИЙГ унтраахад хэвлэмэл ХООСОН — DEFAULT_BD_NOTES руу УНАХГҮЙ', () => {
  let sh = N.syncNotes(base(), 'mn');
  for (const r of N.NOTE_RULES) {
    if (N.isNoteActive(sh, r.key)) sh = N.toggleNote(sh, r.key, 'mn');
  }
  assert.deepEqual(notes(sh, 'bd'), []);
  const blk = S.detectSignatureBlock(sh, undefined, { lang: 'mn' });
  assert.deepEqual(blk.bdNotes, [], JSON.stringify(blk.bdNotes));
  assert.deepEqual(blk.materialNotes, []);
  // ⚠️ Шошгын мөр уствал `mode='bd'` эхлэхгүй болж БҮХ тайлбар алга болно.
  assert.equal(N.findNoteBlocks(sh).length, 2, 'шошгын мөр устсан');
});

/** «Тайлбар:» блок ОГТ БАЙХГҮЙ хуудас — 0185-аас өмнөх загвараар үүссэн санал. */
const blockless = () => {
  const sh = base();
  for (const k of Object.keys(sh.cells)) {
    const r = Number(/^[A-Z]+(\d+)$/.exec(k)[1]) - 1;
    if (r >= 21 && r <= 29) delete sh.cells[k];
  }
  return sh;
};

/* ⚠️⚠️ ЭНЭ ХОЁР ШАЛГАЛТ НЬ БОДИТ АЛДААНААС ТӨРСӨН (санал №51, 2026-08-24).
 *
 * `detectSignatureBlock` нь блок олдоогүй үед ХАТУУ БИЧСЭН таван өгүүлбэр
 * (`DEFAULT_BD_NOTES`) руу уначихдаг байв. 0185-аас ӨМНӨХ загвараар үүссэн
 * санал бүрийн хуудсанд тэр блок БАЙДАГГҮЙ тул нөөц нь ПРАКТИКТ ГОЛ ЗАМ болж,
 * «Төсөв» нэмэгдлийг унтраасан, геологи·топографи огт хийхгүй санал дээр ч
 * «төсвийн 8% нэмж тооцов», «БД 81-117-13 …», «БД 81-103-21 …» гэж хэвлэсээр
 * байв. Одоо нөөц нь ижил ДҮРМЭЭР гаргагдана. */
check('блокгүй ХУУЧИН санал: хэвлэмэл нь ДҮРМЭЭР гарна, хатуу нөөц БИШ', () => {
  const blk = S.detectSignatureBlock(blockless(), undefined, { lang: 'mn' });
  assert.equal(blk.bdNotes.length, 1, JSON.stringify(blk.bdNotes, null, 1));
  assert.ok(blk.bdNotes[0].includes('4.19'));
  assert.ok(!blk.bdNotes.some((t) => /81-117-13|81-103-21|3\.5\.1|4\.21\.3/.test(t)));
  assert.deepEqual(blk.materialNotes, ['БД 81-16-20 Зураг төслийн ажлын жишиг үнэ']);
});

check('санал №51-ийн хэлбэр: төсөв унтраасан + геологи/топографи байхгүй', () => {
  // №51: addons = bms·water·fire·cool·quake (ТӨСӨВГҮЙ),
  //      costLines = sketch·landscape, тайлбарын блок ОГТ БАЙХГҮЙ.
  let sh = A.removeAddon(blockless(), 'tosov');
  for (const k of ['masterplan', 'geology', 'topography', 'emergency', 'expertise']) {
    sh = A.removeCostLine(sh, k);
  }
  const blk = S.detectSignatureBlock(sh, undefined, { lang: 'mn' });
  assert.equal(blk.bdNotes.length, 1, JSON.stringify(blk.bdNotes, null, 1));
  assert.ok(!blk.bdNotes[0].includes('төсвийн'), blk.bdNotes[0]);
  assert.ok(blk.bdNotes[0].includes('8 балл газар хөдлөлтийн итгэлцүүрийн 10%'));
  // Ашигласан материалаас геологи·геодезийн стандарт хасагдсан байх ЁСТОЙ.
  assert.deepEqual(blk.materialNotes, ['БД 81-16-20 Зураг төслийн ажлын жишиг үнэ']);
  // Англи хуулбар мөн адил — хэвлэмэл нь `lang`-аар шууд гаргадаг.
  const en = S.detectSignatureBlock(sh, undefined, { lang: 'en' });
  assert.ok(en.bdNotes[0].startsWith('Pursuant to BD 81-16-20 cl. 4.19'), en.bdNotes[0]);
  assert.ok(!en.bdNotes[0].includes('cost estimate'));
  assert.equal(en.noteLabel, 'Note:');
});

check('блокгүй хуудсан дээр ч цэсний унтраалт цаасан дээр ҮЙЛЧИЛНЭ', () => {
  // Төлөв нь мөрөнд БИШ, `sheet.notes`-д түлхүүрээр хадгалагддаг тул хуучин
  // хуудсанд мөр оруулахгүйгээр удирдана.
  const sh = N.toggleNote(blockless(), 'addons', 'mn');
  assert.deepEqual(sh.notes.off, ['addons']);
  assert.deepEqual(S.detectSignatureBlock(sh, undefined, { lang: 'mn' }).bdNotes, []);
});

check('гар бичвэр + өөрийн тайлбар: нэмэх / хадгалагдах / цуцлах', () => {
  const custom = 'Үнийн санал 30 хоног хүчинтэй.';
  let sh = N.syncNotes(base(), 'mn');
  sh = N.setNoteText(
    sh,
    'addons',
    'БД-81-16-20-ийн 4.19-ийг үндэслэн ТУСГАЙ нөхцөлөөр тооцов.',
    'mn',
  );
  assert.ok(notes(sh, 'bd')[0].includes('ТУСГАЙ'));
  sh = N.syncNotes(sh, 'mn');
  assert.ok(notes(sh, 'bd')[0].includes('ТУСГАЙ'), 'дахин sync хийхэд гар бичвэр устав');
  sh = N.addCustomNote(sh, 'bd', custom, 'mn');
  sh = N.syncNotes(sh, 'mn');
  assert.deepEqual(N.customNotes(sh), [{ group: 'bd', text: custom }]);
  sh = N.setNoteText(sh, 'addons', '', 'mn');
  assert.ok(notes(sh, 'bd')[0].includes('төсвийн 8%'), 'автомат руу буцаагүй');
  sh = N.removeCustomNote(sh, 'bd', custom, 'mn');
  assert.deepEqual(N.customNotes(sh), []);
});

check('syncNotes идемпотент (autosave дэмий хөдлөхгүй)', () => {
  const once = N.syncNotes(base(), 'mn');
  assert.equal(N.syncNotes(once, 'mn'), once);
});

check('орчуулгын давхарга: МН→EN хос бичигдэнэ, англи хуудсанд бичигдэхгүй', () => {
  const sh = N.syncNotes(base(), 'mn');
  const mn = notes(sh, 'bd')[0];
  assert.ok(sh.notes.i18n[mn]?.includes('cost estimate'), JSON.stringify(sh.notes.i18n));
  assert.equal(N.syncNotes(base(), 'en').notes?.i18n, undefined);
});

check('мөр устгахад merge, USGEER-ийн томьёо, anchor бүрэн бүтэн', () => {
  const before = RAW.rows;
  const sh = N.syncNotes(base(), 'mn');
  assert.equal(sh.rows, before - 6, `${before} → ${sh.rows}`);
  const usg = Object.values(sh.cells).find((c) => c?.f?.includes('USGEER('));
  assert.ok(usg, 'USGEER мөр алга болжээ');
  assert.ok(usg.f.includes('Z20'), usg.f);
  for (const b of N.findNoteBlocks(sh)) {
    for (const r of b.rows) {
      const m = sh.merges.find((x) => x.r === r && x.c === b.textCol);
      assert.ok(m && m.cs === sh.cols - b.textCol, `merge дутуу: мөр ${r}`);
    }
    const lm = sh.merges.find((x) => x.r === b.labelRow && x.c === 0);
    assert.ok(lm && lm.cs === b.textCol, 'шошгын merge дутуу');
  }
});

/* ------------------------------------------------------------------ */
/*  ГЭРЭЭНИЙ ХАМРАХ ХҮРЭЭНИЙ ТАЙЛБАР                                    */
/* ------------------------------------------------------------------ */

/* ⚠️ БОДИТ АЛДААНААС ТӨРСӨН (2026-08-24): «Дээрх үнийн санал нь ЭСКИЗ зургийн
 * … ажлын зургийн гэрээг мөн манайхаар байгуулбал ХӨНГӨЛНӨ» гэсэн өгүүлбэр нь
 * загварт ХАТУУ бичигдсэн тул АЖЛЫН ЗУРГИЙН бүрэн санал дээр ч гарч, аль хэдийн
 * үнэд орсон ажлыг дахин гэрээлбэл хөнгөлнө гэж амладаг байв. */
console.log('\nГэрээний хамрах хүрээний тайлбар:');

const wbOf = (sheet) => ({ sheets: [sheet], activeSheet: 0, anchors: {} });

check('бүрэн санал: эскиз + ажлын зураг, ХӨНГӨЛӨЛТ амлахгүй', () => {
  const sh = N.syncNotes(base(), 'mn');
  const want = 'Дээрх үнийн санал нь эскиз болон ажлын зураг төслийн ажлын үнийн санал болно.';
  assert.equal(S.detectSignatureBlock(sh, undefined, { lang: 'mn' }).contractNote, want);
  // Хуудасны МӨР нь мөн шинэчлэгдсэн байх ёстой (засварлагч + Excel).
  const at = N.findContractRow(sh);
  assert.ok(at, 'гэрээний мөр олдсонгүй');
  assert.equal(sh.cells[ref(at.r, at.c)].v, want);
  assert.ok(sh.notes.i18n[want]?.startsWith('This quotation covers'), JSON.stringify(sh.notes.i18n));
});

check('эскиз хасагдсан санал: зөвхөн ажлын зургийн үнийн санал', () => {
  const sh = N.syncNotes(A.removeCostLine(base(), 'sketch'), 'mn');
  assert.equal(
    S.detectSignatureBlock(sh, undefined, { lang: 'mn' }).contractNote,
    'Дээрх үнийн санал нь ажлын зураг төслийн ажлын үнийн санал болно.',
  );
});

check('хэсэгчилсэн (зөвхөн эскиз) санал: ХӨНГӨЛӨЛТИЙН амлалт ГАРНА', () => {
  const wb = SQ.applyScope(wbOf(base()), ['sketch'], 'mn');
  const sh = wb.sheets[0];
  const blk = S.detectSignatureBlock(sh, undefined, { lang: 'mn' });
  assert.ok(blk.contractNote.startsWith('Дээрх үнийн санал нь эскиз зургийн ажлын үнийн санал болно.'), blk.contractNote);
  assert.ok(blk.contractNote.includes('нэмэлт хөнгөлөлт үзүүлэх боломжтой.'), blk.contractNote);
  // Англи хуулбар нь AI-гүйгээр ДЕТЕРМИНИСТ (i18n давхарга).
  const en = S.detectSignatureBlock(sh, undefined, { lang: 'en' }).contractNote;
  assert.ok(en.startsWith('This quotation covers the concept design works.'), en);
  assert.ok(en.includes('additional discount'), en);
});

/* ⚠️⚠️ ДООРХ БЛОК НЬ БОДИТ АЛДААНААС ТӨРСӨН (хэрэглэгчийн илрүүлэлт 2026-08-25).
 *
 * Гэрээний өгүүлбэр нь 2026-08-24-нөөс хойш ДҮРМЭЭР гаргагддаг болсон —
 * `detectSignatureBlock` нь хуудсыг ОГТ уншдаггүй. Гэтэл цэсэнд түүнийг
 * УНТРААХ мөр байгаагүй тул PM-ийн ганц зам нь хуудсан дээрх нүдийг устгах
 * байв — тэр нь `sheet.notes`-д огт буудаггүй учир засварлагч дээр алга
 * болсон өгүүлбэр ХЭВЛЭХ ба PDF дээр ХЭВЭЭР гарсаар байв.
 *
 * ⇒ Хуудсан дээрх засвар ба цэсний унтраалт ХОЁУЛАА төлөв болж бичигдэнэ. */

/** SheetGrid-ийн Delete товч — нүдний бичвэрийг цэвэрлэнэ. */
const clearCell = (sheet, r, c) => {
  const next = structuredClone(sheet);
  const k = ref(r, c);
  next.cells[k] = { ...(next.cells[k] ?? {}), f: undefined, v: '' };
  return next;
};

check('ХУУДСАН ДЭЭРЭЭС устгахад ХЭВЛЭМЭЛ дагана (captureContractEdit)', () => {
  const sh = N.syncNotes(base(), 'mn');
  const at = N.findContractRow(sh);
  assert.ok(at, 'гэрээний мөр олдсонгүй');
  // ЗАСВАРЛАГЧГҮЙ бол алдаа хэвээр — энэ нь хуучин зан төлөв:
  const naive = clearCell(sh, at.r, at.c);
  assert.notEqual(S.detectSignatureBlock(naive, undefined, { lang: 'mn' }).contractNote, '');
  // `handleSheetChange`-ийн хоолойгоор өнгөрвөл төлөв болж бичигдэнэ:
  const captured = N.captureContractEdit(sh, naive, 'mn');
  assert.deepEqual(captured.notes.off, ['contract']);
  assert.equal(S.detectSignatureBlock(captured, undefined, { lang: 'mn' }).contractNote, '');
  // Дахин нээхэд (syncNotes) ЭРГЭЖ ГАРАХГҮЙ.
  const reopened = N.syncNotes(captured, 'mn');
  assert.equal(S.detectSignatureBlock(reopened, undefined, { lang: 'mn' }).contractNote, '');
  assert.equal(N.findContractRow(reopened), null);
  // Англи хуулбар дээр ч мөн адил (төлөв нь ТҮЛХҮҮРЭЭР дагадаг).
  assert.equal(S.detectSignatureBlock(captured, undefined, { lang: 'en' }).contractNote, '');
});

check('цэснээс унтраах → мөр хоосорно, ХЭВЛЭМЭЛЭЭС арилна', () => {
  const sh = N.syncNotes(base(), 'mn');
  const off = N.toggleContractNote(sh, 'mn');
  assert.deepEqual(off.notes.off, ['contract']);
  assert.equal(N.findContractRow(off), null, 'хуудсан дээр өгүүлбэр үлдэв');
  assert.equal(S.detectSignatureBlock(off, undefined, { lang: 'mn' }).contractNote, '');
  // Мөрийг УСТГААГҮЙ — доорх гарын үсгийн блок байрандаа хэвээр.
  assert.equal(off.rows, sh.rows, 'мөрийн тоо өөрчлөгдөв');
});

check('дахин асаахад мөр нь ЯГ БАЙРАНДАА сэргэнэ (эргэх боломжтой)', () => {
  const sh = N.syncNotes(base(), 'mn');
  const at = N.findContractRow(sh);
  const back = N.toggleContractNote(N.toggleContractNote(sh, 'mn'), 'mn');
  assert.equal(back.notes?.off, undefined);
  const at2 = N.findContractRow(back);
  assert.ok(at2, 'мөр сэргээгүй');
  assert.deepEqual(at2, at, 'мөр өөр байрлалд сэргэв');
  assert.equal(back.rows, sh.rows);
  assert.equal(
    S.detectSignatureBlock(back, undefined, { lang: 'mn' }).contractNote,
    'Дээрх үнийн санал нь эскиз болон ажлын зураг төслийн ажлын үнийн санал болно.',
  );
  // Бүтэн өргөний merge-ээ хадгалсан байх ЁСТОЙ.
  assert.ok(
    back.merges.some((m) => m.r === at2.r && m.c === 0 && m.rs === 1 && m.cs === back.cols),
    'merge сэргээгүй',
  );
});

check('хуудсан дээр ГАРААР засахад бичвэр төлөвт хадгалагдана', () => {
  const mine = 'Дээрх үнийн санал нь урьдчилсан тооцоо болно.';
  const sh = N.syncNotes(base(), 'mn');
  const at = N.findContractRow(sh);
  const edited = structuredClone(sh);
  edited.cells[ref(at.r, at.c)] = { ...edited.cells[ref(at.r, at.c)], v: mine };
  const captured = N.captureContractEdit(sh, edited, 'mn');
  assert.equal(captured.notes.text.contract, mine);
  assert.equal(S.detectSignatureBlock(captured, undefined, { lang: 'mn' }).contractNote, mine);
  // Дахин sync хийхэд гар бичвэр УСТАХГҮЙ.
  assert.equal(
    S.detectSignatureBlock(N.syncNotes(captured, 'mn'), undefined, { lang: 'mn' }).contractNote,
    mine,
  );
});

check('хамрах хүрээ өөрчлөгдөхөд өгүүлбэр ХӨЛДӨХГҮЙ (гар засвар гэж үзэхгүй)', () => {
  // «Эскиз» зардлын мөрийг хасахад өгүүлбэр өөрчлөгдөнө. Энэ нь PM-ийн ГАР
  // засвар БИШ тул `notes.text`-д хадгалагдах ЁСГҮЙ — эс бөгөөс дараа нь
  // хамрах хүрээ өөрчлөгдөхөд өгүүлбэр дагахаа болино.
  const sh = N.syncNotes(base(), 'mn');
  const next = N.syncNotes(A.removeCostLine(sh, 'sketch'), 'mn');
  const captured = N.captureContractEdit(sh, next, 'mn');
  assert.equal(captured.notes?.text?.contract, undefined, JSON.stringify(captured.notes));
  assert.equal(
    S.detectSignatureBlock(captured, undefined, { lang: 'mn' }).contractNote,
    'Дээрх үнийн санал нь ажлын зураг төслийн ажлын үнийн санал болно.',
  );
});

check('АЛЬ ХЭДИЙН устгаж хадгалсан санал: дахин нээхэд ӨӨРӨӨ засагдана', () => {
  /* Хэрэглэгчийн бодит тохиолдол (2026-08-25): мөрийг устгаад ХАДГАЛСАН тул
   * `sheet.notes`-д ямар ч төлөв үлдээгүй — гэвч PDF нь өгүүлбэрээ дүрмээр
   * гаргасаар байв. Тайлбарын БЛОКТОЙ баримт дээр мөрийн эзгүйрэл нь
   * эргэлзээгүй тул `syncNotes` (баримт нээхэд ажилладаг) түүнийг унтраана. */
  const sh = N.syncNotes(base(), 'mn');
  const at = N.findContractRow(sh);
  const broken = clearCell(sh, at.r, at.c);
  delete broken.notes; // хадгалагдсан баримт — төлөв огт байхгүй
  const opened = N.syncNotes(broken, 'mn');
  assert.deepEqual(opened.notes.off, ['contract']);
  assert.equal(S.detectSignatureBlock(opened, undefined, { lang: 'mn' }).contractNote, '');
  // Идемпотент — дараагийн нээлт autosave хөдөлгөхгүй.
  assert.equal(N.syncNotes(opened, 'mn'), opened);
  // Цэснээс буцааж асаах боломжтой хэвээр.
  const back = N.toggleContractNote(opened, 'mn');
  assert.ok(N.findContractRow(back), 'буцааж асаахад мөр сэргэсэнгүй');
  assert.notEqual(S.detectSignatureBlock(back, undefined, { lang: 'mn' }).contractNote, '');
});

check('блокгүй ХУУЧИН санал: мөр байхгүй ч ЧИМЭЭГҮЙ унтраахгүй', () => {
  // Тэдний хуудсанд эх бичвэр байсан эсэхийг мэдэх аргагүй тул автомат
  // унтраалт ХҮРЭХГҮЙ — хэвлэмэл дүрмээрээ гарсаар байна.
  const sh = blockless();
  for (const [k, c] of Object.entries(sh.cells)) {
    if (c && !c.f && typeof c.v === 'string' && N.isContractNoteText(c.v)) delete sh.cells[k];
  }
  assert.equal(N.findContractRow(sh), null);
  const opened = N.syncNotes(sh, 'mn');
  assert.equal(opened.notes?.off, undefined, JSON.stringify(opened.notes));
  assert.notEqual(S.detectSignatureBlock(opened, undefined, { lang: 'mn' }).contractNote, '');
  // Гэхдээ цэснээс унтраах нь тэнд ч ажиллана.
  const off = N.toggleContractNote(opened, 'mn');
  assert.equal(S.detectSignatureBlock(off, undefined, { lang: 'mn' }).contractNote, '');
});

check('гэрээний тайлбар: sync ИДЕМПОТЕНТ, мөр давхардахгүй', () => {
  const once = N.syncNotes(base(), 'mn');
  assert.equal(N.syncNotes(once, 'mn'), once);
  const rows = Object.entries(once.cells).filter(
    ([, c]) => !c?.f && typeof c?.v === 'string' && N.isContractNoteText(c.v),
  );
  assert.equal(rows.length, 1, JSON.stringify(rows));
});

if (failed > 0) {
  console.error(`\n${failed} шалгалт УНАВ`);
  process.exit(1);
}
console.log('\nБүх шалгалт өнгөрлөө.');
