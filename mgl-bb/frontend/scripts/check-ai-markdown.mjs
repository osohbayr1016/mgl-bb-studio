/**
 * MGL AI · MARKDOWN + УРСГАЛЫН ГҮЙЦЭТГЭЛИЙН ШАЛГАЛТ (§21–§25).
 *
 *   node scripts/check-ai-markdown.mjs        (frontend/ хавтаснаас)
 *
 * ── ЯАГААД ЭНЭ ХЭЛБЭРЭЭР ВЭ ────────────────────────────────────────────────
 * Репод frontend тест байхгүй (CLAUDE.md) тул `check-ai-stream.mjs`-ийн
 * жишгээр гараар ажиллуулдаг шалгагч.  `registerHooks` нь өргөтгөлгүй
 * импортыг шийднэ.
 *
 * ── ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ ───────────────────────────────────────────────
 * ХОЁР инвариант, хоёулаа хэрэглэгчид ШУУД харагддаг:
 *
 *   1. ТҮҮХИЙ MARKDOWN ХЭЗЭЭ Ч ГАРАХГҮЙ.  `**`, `##`, `|` нь текст болж
 *      харагдвал хариулт мэргэжлийн бус, уншихад хэцүү болно (§22).
 *
 *   2. УРСГАЛ ДУНДУУР ДАХИН ЗАДЛАН ШИНЖИЛГЭЭ ХЯЗГААРЛАГДСАН БАЙХ (§24).
 *      Токен бүрд 20 KB задлах нь §23-ийн «render storm»-ыг задлан
 *      шинжилгээний талаас давтана.  Энд түүнийг ХЭМЖИНЭ: тогтсон
 *      блокуудын ЛАВЛАГАА нь токен хооронд ӨӨРЧЛӨГДӨХГҮЙ байх ёстой —
 *      яг тэр нь React-ийн `memo`-г ажиллуулдаг.
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'features', 'mgl-ai', 'lib');

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

const MD = await import(pathToFileURL(join(LIB, 'markdown.ts')).href);
const FB = await import(pathToFileURL(join(LIB, 'frameBatch.ts')).href);

const { parseBlocks, parseInline, parseStreaming, emptyStreamCache, safeHref } = MD;
const { createFrameScheduler, isImmediateEvent } = FB;

let passed = 0;
let failed = 0;
const failures = [];

function scenario(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
  }
}

/** Задлагдсан модоос ХАРАГДАХ текстийг гаргана — түүхий тэмдэгт үлдсэн эсэхийг барих. */
function visibleText(nodes) {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return n.v;
        case 'code':
          return n.v;
        case 'cite':
          return String(n.n);
        case 'strong':
        case 'em':
        case 'link':
          return visibleText(n.c);
        default:
          return '';
      }
    })
    .join('');
}

function blockText(b) {
  switch (b.t) {
    case 'heading':
    case 'para':
    case 'quote':
      return visibleText(b.inline);
    case 'list':
      return b.items.map((i) => visibleText(i.inline)).join('\n');
    case 'code':
      return b.v;
    case 'table':
      return [
        b.head.map(visibleText).join(' '),
        ...b.rows.map((r) => r.map(visibleText).join(' ')),
      ].join('\n');
    default:
      return '';
  }
}

console.log('\nMGL AI · markdown + урсгалын шалгалт\n');

/* ================================================================== */
/*  1. ТҮҮХИЙ ТЭМДЭГТ ХЭЗЭЭ Ч ГАРАХГҮЙ (§22)                           */
/* ================================================================== */

scenario('тод текст: `**` тэмдэгт ХАРАГДАХГҮЙ', () => {
  const [b] = parseBlocks('Энэ бол **маш чухал** заалт.');
  assert.equal(b.block.t, 'para');
  const txt = blockText(b.block);
  assert.ok(!txt.includes('**'), `түүхий ** үлдсэн: ${txt}`);
  assert.ok(txt.includes('маш чухал'));
  assert.equal(b.block.inline.some((n) => n.t === 'strong'), true);
});

scenario('гарчиг: `##` тэмдэгт ХАРАГДАХГҮЙ', () => {
  const [b] = parseBlocks('## Галын аюулгүй байдал');
  assert.equal(b.block.t, 'heading');
  assert.equal(b.block.level, 2);
  assert.equal(blockText(b.block), 'Галын аюулгүй байдал');
});

scenario('жагсаалт: `-` тэмдэгт ХАРАГДАХГҮЙ', () => {
  const [b] = parseBlocks('- нэг\n- хоёр\n- гурав');
  assert.equal(b.block.t, 'list');
  assert.equal(b.block.ordered, false);
  assert.equal(b.block.items.length, 3);
  assert.ok(!blockText(b.block).includes('- '));
});

scenario('дугаартай жагсаалт нь дугаараа ХАДГАЛНА', () => {
  const [b] = parseBlocks('3. гурав\n4. дөрөв');
  assert.equal(b.block.ordered, true);
  assert.equal(b.block.start, 3);
  assert.equal(b.block.items.length, 2);
});

scenario('хүснэгт: `|` тэмдэгт ХАРАГДАХГҮЙ', () => {
  const src = '| Заалт | Утга |\n| --- | ---: |\n| 4.21.3 | 4.5 м |';
  const [b] = parseBlocks(src);
  assert.equal(b.block.t, 'table');
  assert.equal(b.block.head.length, 2);
  assert.equal(b.block.rows.length, 1);
  assert.equal(b.block.align[1], 'right');
  assert.ok(!blockText(b.block).includes('|'));
});

scenario('ГАНЦ | бүхий мөр нь хүснэгт БИШ (заагч мөр шаардана)', () => {
  // ⚠️ Энэ нь бодит эрсдэл: «C:\\folder | файл» гэх мэт мөрийг хүснэгт
  //    гэж уншвал хариулт эвдэрнэ.
  const [b] = parseBlocks('Зам нь C:\\MglAi | файл руу очно.');
  assert.equal(b.block.t, 'para');
});

scenario('кодын блок нь ``` тэмдэггүйгээр гарна', () => {
  const [b] = parseBlocks('```sql\nSELECT 1;\n```');
  assert.equal(b.block.t, 'code');
  assert.equal(b.block.lang, 'sql');
  assert.equal(b.block.v, 'SELECT 1;');
  assert.equal(b.block.open, false);
});

scenario('ХААГДААГҮЙ кодын блок нь АЛДАА БИШ (урсгал дундуур)', () => {
  const [b] = parseBlocks('```python\nx = 1');
  assert.equal(b.block.t, 'code');
  assert.equal(b.block.open, true, 'хаагдаагүйг тэмдэглэх ёстой');
  assert.equal(b.block.v, 'x = 1');
});

scenario('мөрийн код `…` нь ард ` үлдээхгүй', () => {
  const [b] = parseBlocks('`--fit-target` тугийг ашиглана.');
  const txt = blockText(b.block);
  assert.ok(!txt.includes('`'), txt);
  assert.ok(txt.includes('--fit-target'));
});

scenario('ишлэл `>` тэмдэггүйгээр гарна', () => {
  const [b] = parseBlocks('> Барилгын норм заавал мөрдөгдөнө.');
  assert.equal(b.block.t, 'quote');
  assert.ok(!blockText(b.block).startsWith('>'));
});

/* ================================================================== */
/*  2. ЭШЛЭЛ (§21)                                                     */
/* ================================================================== */

scenario('эшлэл [3] нь ТУСДАА зангилаа, текст БИШ', () => {
  const nodes = parseInline('Гарц хоёроос доошгүй [3] байна.');
  const cite = nodes.find((n) => n.t === 'cite');
  assert.ok(cite, 'эшлэлийн зангилаа байх ёстой');
  assert.equal(cite.n, 3);
});

scenario('холбоос [текст](хаяг) нь зөв задарна', () => {
  const nodes = parseInline('[МУБИС](https://example.com) руу оч.');
  const link = nodes.find((n) => n.t === 'link');
  assert.ok(link);
  assert.equal(link.href, 'https://example.com');
});

scenario('АЮУЛТАЙ схем нь холбоос БОЛОХГҮЙ (javascript:)', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,<script>'), null);
  assert.equal(safeHref('https://ok.example'), 'https://ok.example');
  const nodes = parseInline('[дар](javascript:alert(1))');
  assert.equal(nodes.some((n) => n.t === 'link'), false, 'аюултай холбоос үүсэх ёсгүй');
});

/* ================================================================== */
/*  3. МОНГОЛ ХЭЛНИЙ ОНЦЛОГ                                            */
/* ================================================================== */

scenario('танигч доторх `_` нь налуу БОЛОХГҮЙ (`user_id`)', () => {
  const nodes = parseInline('Талбар нь user_id ба project_id.');
  assert.equal(nodes.some((n) => n.t === 'em'), false);
  assert.ok(visibleText(nodes).includes('user_id'));
});

scenario('кирилл тод текст зөв ажиллана', () => {
  const nodes = parseInline('**БНбД 21-01-02** -ын дагуу');
  const strong = nodes.find((n) => n.t === 'strong');
  assert.ok(strong);
  assert.equal(visibleText(strong.c), 'БНбД 21-01-02');
});

/* ================================================================== */
/*  4. УРСГАЛЫН КЭШ — ГҮЙЦЭТГЭЛИЙН ГОЛ ИНВАРИАНТ (§24)                */
/* ================================================================== */

scenario('тогтсон блокуудын ЛАВЛАГАА токен хооронд ӨӨРЧЛӨГДӨХГҮЙ', () => {
  const full =
    '## Гарчиг\n\nЭхний догол мөр.\n\nХоёр дахь догол мөр.\n\nГурав дахь догол мөр байна';
  let cache = emptyStreamCache();
  let prevStable = null;
  let sameRefCount = 0;
  let steps = 0;

  for (let i = 1; i <= full.length; i += 7) {
    const r = parseStreaming(full.slice(0, i), cache);
    cache = r.cache;
    steps += 1;
    if (prevStable !== null && cache.stableBlocks.length > 0) {
      const n = Math.min(prevStable.length, cache.stableBlocks.length);
      for (let k = 0; k < n; k++) {
        // ⚠️ ЛАВЛАГААНЫ ТЭНЦҮҮ — React-ийн `memo` ЯГ ҮҮГЭЭР ажилладаг.
        assert.equal(
          prevStable[k],
          cache.stableBlocks[k],
          `тогтсон блок ${k} дахин үүссэн — memo ажиллахаа болино`,
        );
        sameRefCount += 1;
      }
    }
    prevStable = cache.stableBlocks;
  }
  assert.ok(steps > 5);
  assert.ok(sameRefCount > 0, 'тогтсон блок огт үүсээгүй — кэш ажиллаагүй');
});

scenario('урсгалын эцсийн үр дүн нь бүтэн задлан шинжилгээтэй ТААРНА', () => {
  const full = '# Гарчиг\n\n- нэг\n- хоёр\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nТөгсгөл.';
  let cache = emptyStreamCache();
  let blocks = [];
  for (let i = 1; i <= full.length; i += 3) {
    const r = parseStreaming(full.slice(0, i), cache);
    cache = r.cache;
    blocks = r.blocks;
  }
  const direct = parseBlocks(full);
  assert.equal(blocks.length, direct.length, 'блокын тоо таарах ёстой');
  for (let k = 0; k < direct.length; k++) {
    assert.deepEqual(
      blockText(blocks[k].block),
      blockText(direct[k].block),
      `блок ${k} зөрлөө`,
    );
  }
});

scenario('текст БОГИНОСВОЛ кэш хаягдана (answer.reset)', () => {
  const long = 'Нэг догол.\n\nХоёр догол.\n\nГурав.';
  let { cache } = parseStreaming(long, emptyStreamCache());
  assert.ok(cache.stableBlocks.length > 0);
  const r = parseStreaming('Шинэ', cache);
  assert.equal(r.cache.stableBlocks.length, 0, 'богиносоход кэш тэглэгдэх ёстой');
  assert.equal(r.blocks.length, 1);
});

scenario('НЭЭЛТТЭЙ кодын блок нь тогтсон хилээс ГАДНА үлдэнэ', () => {
  // ⚠️ ``` дотор хоосон мөр байж болно; түүнийг блокын хил гэж үзвэл
  //    кодын блок ХОЁР хуваагдана.
  const src = 'Тайлбар.\n\n```js\nconst a = 1;\n\nconst b = 2;';
  const { blocks } = parseStreaming(src, emptyStreamCache());
  const codes = blocks.filter((b) => b.block.t === 'code');
  assert.equal(codes.length, 1, `кодын блок ${codes.length} ширхэг болов`);
  assert.ok(codes[0].block.v.includes('const b = 2;'));
});

/* ================================================================== */
/*  5. ТОКЕНЫ БАГЦЛАЛТ (§23)                                           */
/* ================================================================== */

scenario('олон токен НЭГ л flush үүсгэнэ', () => {
  let flushes = 0;
  const queue = [];
  const s = createFrameScheduler({
    flush: () => {
      flushes += 1;
    },
    raf: (cb) => {
      queue.push(cb);
      return queue.length;
    },
    caf: () => {},
  });
  for (let i = 0; i < 100; i++) s.schedule();
  assert.equal(flushes, 0, 'кадр ирэхээс өмнө flush болох ёсгүй');
  assert.equal(queue.length, 1, '100 токенд НЭГ кадр товлогдох ёстой');
  queue[0]();
  assert.equal(flushes, 1);
  s.cancel();
});

scenario('flushNow нь товлогдсон кадрыг ЦУЦАЛЖ шууд ажиллана', () => {
  let flushes = 0;
  let cancelled = 0;
  const queue = [];
  const s = createFrameScheduler({
    flush: () => {
      flushes += 1;
    },
    raf: (cb) => {
      queue.push(cb);
      return queue.length;
    },
    caf: () => {
      cancelled += 1;
    },
  });
  s.schedule();
  s.flushNow();
  assert.equal(flushes, 1);
  assert.equal(cancelled, 1);
  // Хоосон дээр flushNow нь ЮУ Ч хийхгүй — давхар рендер үүсгэхгүй.
  s.flushNow();
  assert.equal(flushes, 1);
  s.cancel();
});

scenario('cancel-ийн дараа товлогдсон flush ажиллахгүй', () => {
  let flushes = 0;
  const queue = [];
  const s = createFrameScheduler({
    flush: () => {
      flushes += 1;
    },
    raf: (cb) => {
      queue.push(cb);
      return queue.length;
    },
    caf: () => {},
  });
  s.schedule();
  s.cancel();
  queue[0]();
  assert.equal(flushes, 0, 'цуцлагдсаны дараа flush болох ЁСГҮЙ');
});

scenario('токен БИШ үйл явдал нь НЭН ДАРУЙ (§26)', () => {
  assert.equal(isImmediateEvent('token'), false);
  assert.equal(isImmediateEvent('heartbeat'), false);
  assert.equal(isImmediateEvent('source.found'), true);
  assert.equal(isImmediateEvent('generation.started'), true);
  assert.equal(isImmediateEvent('failed'), true);
  assert.equal(isImmediateEvent('stage.completed'), true);
});

scenario('CRLF мөрийн төгсгөл нь бүтцийг ЭВДЭХГҮЙ', () => {
  // ⚠️ БОДИТ АЛДАА (2026-09-09): JS-ийн `.` нь ``-ыг тааруулдаггүй тул
  //    `# Гарчиг` нь гарчиг гэж танигдалгүй ЭНГИЙН ТЕКСТ болж,
  //    хэрэглэгчид `#` тэмдэгт харагдаж байсан.
  const CR = String.fromCharCode(13);
  const src = `# Гарчиг${CR}
${CR}
1. Нэг${CR}
2. Хоёр${CR}
`;
  const blocks = parseBlocks(src);
  assert.deepEqual(blocks.map((b) => b.block.t), ['heading', 'list']);
  assert.equal(blocks[1].block.ordered, true);
  assert.equal(blocks[1].block.items.length, 2);
  assert.ok(!blockText(blocks[0].block).includes('#'));
});

/* ================================================================== */
/*  6. БОДИТ ХАРИУЛТЫН ХЭЛБЭР                                          */
/* ================================================================== */

scenario('бодит нормын хариулт бүрэн задарна', () => {
  const answer = [
    '## Эвакуацын гарцын шаардлага',
    '',
    'Олон нийтийн барилгад **хоёроос доошгүй** эвакуацын гарц шаардлагатай [1].',
    '',
    '### Тооцоолол',
    '',
    '| Талбай | Гарцын тоо |',
    '| --- | ---: |',
    '| 300 м²-аас бага | 1 |',
    '| 300 м²-аас их | 2 |',
    '',
    '1. Гарцын өргөн 1.2 м-ээс багагүй',
    '2. Хаалга нь `гадагш` нээгдэнэ',
    '',
    '> Эх сурвалж: БНбД 21-01-02.',
  ].join('\n');

  const blocks = parseBlocks(answer);
  const kinds = blocks.map((b) => b.block.t);
  assert.deepEqual(kinds, ['heading', 'para', 'heading', 'table', 'list', 'quote']);

  const all = blocks.map((b) => blockText(b.block)).join('\n');
  for (const raw of ['##', '**', '| ---', '> ', '`']) {
    assert.ok(!all.includes(raw), `түүхий «${raw}» үлдлээ`);
  }
  const para = blocks[1].block;
  assert.ok(para.inline.some((n) => n.t === 'cite' && n.n === 1), 'эшлэл алдагдав');
});

/* ================================================================== */

console.log(`\n  ${passed} тэнцсэн · ${failed} унасан\n`);
if (failed > 0) {
  for (const f of failures) {
    console.error(`\n✗ ${f.name}\n${f.err.stack ?? f.err.message}`);
  }
  process.exit(1);
}
