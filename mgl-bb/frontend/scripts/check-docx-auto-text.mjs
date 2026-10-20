/**
 * .docx-ийн navy дэвсгэр дээрх «Автомат» текстийг цагаан болгох дүрмийн шалгалт.
 *
 *   node scripts/check-docx-auto-text.mjs        (frontend/ хавтаснаас)
 *
 * `src/features/projects/drive/docxAutoText.ts` — хуудсан доторх Word харагдац ба
 * «Google Docs болгох» хоёулаа үүнийг хэрэглэнэ.  Жишээнүүд нь прод дээрх RFI
 * загварын хэлбэрийг дууриасан (navy нүд `w:fill="0F243E"`, өнгөгүй run;
 * Google-оор дамжсан файлын ил `000000`; хар highlight дээрх «□» checkbox).
 * Бодит 3 RFI файл дээр (2026-09-30, scratchpad) Word-оор PDF гаргаж
 * пикселээр харьцуулсан: Word-ийн загвар өөрчлөгдөөгүй, navy нүдний бүх текст цагаан.
 */
import assert from 'node:assert/strict';
import { unzipSync, zipSync } from 'fflate';

const M = await import('../src/features/projects/drive/docxAutoText.ts');

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const doc = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}</w:body></w:document>`;
const cell = (fill, inner) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${
    fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}" w:themeFill="text2" w:themeFillShade="80"/>` : ''
  }</w:tcPr>${inner}</w:tc>`;
const table = (...cells) => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tr>${cells.join('')}</w:tr></w:tbl>`;
const run = (text, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs) => `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${runs.join('')}</w:p>`;
const NAVY = '0F243E';
const WHITE_TAG = '<w:color w:val="FFFFFF"/>';

const EMPTY_STYLES = M.parseStyles('');
const fix = (xml, styles = EMPTY_STYLES) => M.fixPartXml(xml, styles);

/** Текст → тэр run-ий `w:color` (байхгүй бол null). */
function colorOfText(xml, text) {
  // Хамгийн ДОТОРХ run (text box-ийг агуулсан гадна run-ийг алгасна).
  const re = /<w:r(?:\s[^>]*)?>((?:(?!<w:r[\s>])[\s\S])*?)<\/w:r>/g;
  for (const m of xml.matchAll(re)) {
    if (m[1].includes(`>${text}</w:t>`)) {
      const c = /<w:color w:val="([^"]+)"/.exec(m[1].replace(/<w:rPrChange[\s\S]*?<\/w:rPrChange>/g, ''));
      return c ? c[1] : null;
    }
  }
  throw new Error(`run not found: ${text}`);
}

/** Тагуудын тэнцвэр — оруулсан элементүүд XML-ийг эвдээгүй. */
function assertBalanced(xml) {
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[0].startsWith('<?')) continue;
    if (m[3] === '/') continue;
    if (m[1] === '/') assert.equal(stack.pop(), m[2]);
    else stack.push(m[2]);
  }
  assert.equal(stack.length, 0);
}

/** Өнгийг хасахад эх бичвэртэй ИЖИЛ (өөр юу ч өөрчлөгдөөгүй). */
function assertOnlyColor(before, after) {
  const strip = (s) =>
    s
      .replace(/<w:color w:val="[^"]*"[^>]*\/>/g, '')
      .replace(/<w:rPr><\/w:rPr>/g, '')
      .replace(/<w:pPr><\/w:pPr>/g, '')
      .replace(/<w:rPr\/>/g, '')
      .replace(/<w:pPr\/>/g, '')
      .replace(/<w:p><\/w:p>/g, '<w:p/>');
  assert.equal(strip(after), strip(before));
}

console.log('өнгө');
ok('isDarkFill: navy бараан, цайвар саарал / Accent1 5B9BD5 биш', () => {
  assert.equal(M.isDarkFill('0F243E'), true);
  assert.equal(M.isDarkFill('17365D'), true);
  assert.equal(M.isDarkFill('D9D9D9'), false);
  assert.equal(M.isDarkFill('5B9BD5'), false);
  assert.equal(M.isDarkFill('FFFFFF'), false);
});

console.log('RFI хэлбэр');
ok('navy нүдний өнгөгүй текст → цагаан; цагаан нүд хөндөгдөхгүй', () => {
  const xml = doc(
    table(
      cell(NAVY, para(run('Хүсэлт гаргасан огноо', '<w:rPr><w:b/><w:sz w:val="18"/></w:rPr>'), run('(Issued date)'))),
      cell(null, para(run('2026-09-30', '<w:rPr><w:sz w:val="18"/></w:rPr>'))),
      cell('D9D9D9', para(run('саарал'))),
    ),
  );
  const r = fix(xml);
  assert.equal(colorOfText(r.xml, 'Хүсэлт гаргасан огноо'), 'FFFFFF');
  assert.equal(colorOfText(r.xml, '(Issued date)'), 'FFFFFF');
  assert.equal(colorOfText(r.xml, '2026-09-30'), null);
  assert.equal(colorOfText(r.xml, 'саарал'), null);
  assertBalanced(r.xml);
  assertOnlyColor(xml, r.xml);
});

ok('w:color нь CT_RPr-ийн дараалалд (w:sz-ээс өмнө), шрифт хэвээр', () => {
  const xml = doc(table(cell(NAVY, para(run('A', '<w:rPr><w:rFonts w:ascii="AGFutura Mon"/><w:b/><w:sz w:val="18"/><w:lang w:val="mn-MN"/></w:rPr>')))));
  const r = fix(xml);
  assert.match(r.xml, /<w:rFonts w:ascii="AGFutura Mon"\/><w:b\/><w:color w:val="FFFFFF"\/><w:sz w:val="18"\/>/);
});

ok('ил «auto» өнгө солигдоно; Google-оор дамжсан ил 000000 → цагаан', () => {
  const xml = doc(
    table(
      cell(NAVY, para(run('auto', '<w:rPr><w:color w:val="auto"/></w:rPr>'), run('google', '<w:rPr><w:color w:val="000000" w:themeColor="text1"/></w:rPr>'))),
    ),
  );
  const r = fix(xml);
  assert.equal(colorOfText(r.xml, 'auto'), 'FFFFFF');
  assert.equal(colorOfText(r.xml, 'google'), 'FFFFFF');
  assert.ok(!r.xml.includes('themeColor="text1"'), 'хуучин theme өнгө үлдэхгүй');
});

ok('уншигдах ил өнгө (улаан, цагаан) хэвээр', () => {
  const xml = doc(table(cell(NAVY, para(run('red', '<w:rPr><w:color w:val="FF0000"/></w:rPr>'), run('dark red', '<w:rPr><w:color w:val="C00000"/></w:rPr>')))));
  const r = fix(xml);
  assert.equal(r.changed, 1, 'зөвхөн догол мөрийн тэмдэг');
  assert.equal(colorOfText(r.xml, 'red'), 'FF0000');
  assert.equal(colorOfText(r.xml, 'dark red'), 'C00000');
});

ok('highlight дэвсгэр биш (Word-оор хэмжсэн): хар highlight дээрх «□» (ил ба auto) хөндөгдөхгүй', () => {
  // RFI-ийн сонгосон checkbox: хар highlight + «□» → Word дээр бүтэн хар дөрвөлжин.
  const xml = doc(
    para(
      run('□', '<w:rPr><w:color w:val="000000"/><w:highlight w:val="black"/></w:rPr>'),
      run('■', '<w:rPr><w:highlight w:val="black"/></w:rPr>'),
      run('hl-auto', '<w:rPr><w:highlight w:val="darkBlue"/></w:rPr>'),
    ),
  );
  const r = fix(xml);
  assert.equal(r.changed, 0);
  assert.equal(colorOfText(r.xml, '□'), '000000');
  assert.equal(colorOfText(r.xml, '■'), null);
  assert.equal(colorOfText(r.xml, 'hl-auto'), null);
});

ok('navy нүдэн доторх highlight-тэй auto бичвэр → цагаан (Word нүдийг дагадаг); ил хар хэвээр', () => {
  const xml = doc(
    table(
      cell(
        NAVY,
        para(
          run('hl-in-navy', '<w:rPr><w:highlight w:val="yellow"/></w:rPr>'),
          run('black-hl-in-navy', '<w:rPr><w:color w:val="000000"/><w:highlight w:val="black"/></w:rPr>'),
        ),
      ),
    ),
  );
  const r = fix(xml);
  assert.equal(colorOfText(r.xml, 'hl-in-navy'), 'FFFFFF');
  assert.equal(colorOfText(r.xml, 'black-hl-in-navy'), '000000');
});

ok('rPr-гүй run, догол мөрийн бараан shd', () => {
  const xml = doc(`<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="17365D"/></w:pPr><w:r><w:t>band</w:t></w:r></w:p>`);
  const r = fix(xml);
  assert.equal(colorOfText(r.xml, 'band'), 'FFFFFF');
  assert.match(r.xml, /<w:r><w:rPr><w:color w:val="FFFFFF"\/><\/w:rPr><w:t>band/);
  assertBalanced(r.xml);
});

ok('хоосон navy нүд: догол мөрийн тэмдэг цагаан (Google дээр бичихэд цагаан)', () => {
  const xml = doc(table(cell(NAVY, '<w:p/>'), cell(NAVY, '<w:p><w:r><w:t>x</w:t></w:r></w:p>'), cell(NAVY, '<w:p><w:pPr/></w:p>')));
  const r = fix(xml);
  assert.ok(r.xml.includes(`<w:p><w:pPr><w:rPr>${WHITE_TAG}</w:rPr></w:pPr></w:p>`));
  assert.ok(r.xml.includes(`<w:p><w:pPr><w:rPr>${WHITE_TAG}</w:rPr></w:pPr><w:r>`));
  assertBalanced(r.xml);
  assertOnlyColor(xml, r.xml);
});

ok('pPr доторх rPr ба sectPr-ийн өмнөх байрлал', () => {
  const xml = doc(
    table(
      cell(NAVY, '<w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:b/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:t>m1</w:t></w:r></w:p>'),
      cell(NAVY, '<w:p><w:pPr><w:jc w:val="left"/><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:pPr></w:p>'),
    ),
  );
  const r = fix(xml);
  assert.ok(r.xml.includes(`<w:rPr><w:b/>${WHITE_TAG}<w:sz w:val="18"/></w:rPr></w:pPr>`));
  assert.ok(r.xml.includes(`<w:jc w:val="left"/><w:rPr>${WHITE_TAG}</w:rPr><w:sectPr>`));
  assertBalanced(r.xml);
});

ok('үүрлэсэн хүснэгт: дэвсгэргүй дотоод нүд гадна navy-г өвлөнө, цагаан нүд үгүй', () => {
  const inner = table(cell(null, para(run('inherit'))), cell('FFFFFF', para(run('own white'))));
  const xml = doc(table(cell(NAVY, inner + '<w:p/>')));
  const r = fix(xml);
  assert.equal(colorOfText(r.xml, 'inherit'), 'FFFFFF');
  assert.equal(colorOfText(r.xml, 'own white'), null);
});

ok('navy нүдэн доторх text box — дэвсгэр тодорхойгүй тул хөндөхгүй', () => {
  const box = `<w:r><w:drawing><wps:txbx><w:txbxContent>${para(run('in box'))}</w:txbxContent></wps:txbx></w:drawing></w:r>`;
  const xml = doc(table(cell(NAVY, `<w:p>${box}</w:p>`)));
  const r = fix(xml);
  assert.equal(colorOfText(r.xml, 'in box'), null);
});

ok('rPrChange доторх хуучин rPr ба өнгө тооцогдохгүй', () => {
  const xml = doc(
    table(cell(NAVY, para(run('tracked', '<w:rPr><w:b/><w:rPrChange w:id="1"><w:rPr><w:color w:val="FF0000"/></w:rPr></w:rPrChange></w:rPr>')))),
  );
  const r = fix(xml);
  assert.equal(colorOfText(r.xml, 'tracked'), 'FFFFFF');
  assert.ok(r.xml.includes(`<w:b/>${WHITE_TAG}<w:rPrChange`));
  assertBalanced(r.xml);
});

console.log('загвар (styles.xml)');
ok('загварын өнгө / хүснэгтийн загварын нүдний дэвсгэр / docDefaults', () => {
  const styles = M.parseStyles(
    `<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:color w:val="auto"/></w:rPr></w:rPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>` +
      `<w:style w:type="table" w:styleId="NavyGrid"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="1F3864"/></w:tcPr>` +
      `<w:tblStylePr w:type="firstRow"><w:rPr><w:color w:val="FFFF00"/></w:rPr></w:tblStylePr></w:style></w:styles>`,
  );
  const xml = doc(
    `<w:tbl><w:tblPr><w:tblStyle w:val="NavyGrid"/></w:tblPr><w:tr>` +
      cell(null, `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>styled red</w:t></w:r></w:p>` + para(run('style navy'))) +
      `</w:tr></w:tbl>`,
  );
  const r = fix(xml, styles);
  assert.equal(colorOfText(r.xml, 'styled red'), null, 'загварын улаан — уншигдана');
  assert.equal(colorOfText(r.xml, 'style navy'), 'FFFFFF', 'хүснэгтийн загварын navy нүд');
});

console.log('аюулгүй байдал');
ok('өөрчлөлтгүй бол ЭХ мөр, 2 дахь засвар 0 (idempotent)', () => {
  const plain = doc(table(cell(null, para(run('x')))));
  const r0 = fix(plain);
  assert.equal(r0.changed, 0);
  assert.equal(r0.xml, plain);
  const once = fix(doc(table(cell(NAVY, para(run('y'))))));
  assert.ok(once.changed > 0);
  assert.equal(fix(once.xml).changed, 0);
});

ok('эвдэрсэн XML (хаагдаагүй `<`) — хөндөхгүй', () => {
  const bad = doc(table(cell(NAVY, para(run('z'))))) + '<w:p';
  const r = fix(bad);
  assert.equal(r.changed, 0);
  assert.equal(r.xml, bad);
});

console.log('.docx (ZIP)');
ok('зөвхөн текстийн хэсэг солигдоно; нэр, дараалал, зураг байт-ижил', () => {
  const enc = new TextEncoder();
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]);
  const docXml = doc(table(cell(NAVY, para(run('Doc No'))), cell(null, para(run('v')))));
  const src = zipSync({
    '[Content_Types].xml': enc.encode('<Types/>'),
    '_rels/.rels': enc.encode('<Relationships/>'),
    'word/document.xml': enc.encode(docXml),
    'word/styles.xml': enc.encode(`<w:styles ${NS}/>`),
    'word/header1.xml': enc.encode(`<w:hdr ${NS}>${para(run('hdr'))}</w:hdr>`),
    'word/media/image1.png': png,
  });
  const r = M.fixDocxBytes(src);
  assert.deepEqual(r.parts, ['word/document.xml']);
  const out = unzipSync(r.bytes);
  assert.deepEqual(Object.keys(out), ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/header1.xml', 'word/media/image1.png']);
  assert.deepEqual(out['word/media/image1.png'], png);
  const dec = new TextDecoder();
  assert.equal(dec.decode(out['word/header1.xml']), `<w:hdr ${NS}>${para(run('hdr'))}</w:hdr>`);
  assert.equal(colorOfText(dec.decode(out['word/document.xml']), 'Doc No'), 'FFFFFF');
});

ok('засах зүйлгүй .docx-д ЭХ байт (дахин ZIP-лэхгүй)', () => {
  const enc = new TextEncoder();
  const src = zipSync({ 'word/document.xml': enc.encode(doc(para(run('plain')))) });
  const r = M.fixDocxBytes(src);
  assert.equal(r.changed, 0);
  assert.equal(r.bytes, src);
});

console.log(`\n${n} checks passed`);
