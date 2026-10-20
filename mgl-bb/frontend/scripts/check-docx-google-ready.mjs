/**
 * «Эх файлыг нээх» — .docx-ийг Google дээр Word-той ижил харагдахаар засах дүрмийн шалгалт.
 *
 *   node scripts/check-docx-google-ready.mjs        (frontend/ хавтаснаас)
 *
 * `src/features/projects/drive/docxGoogleReady.ts`.  Жишээнүүд нь прод дээрх RFI-ийн хэлбэрийг
 * дууриасан: «사각형 20» нуусан navy тэгш өнцөгт (AlternateContent: DrawingML hidden + VML
 * visibility:hidden), Google-оор дамжсан файлын ил болсон бүрхэвч (wps + зургийн fallback),
 * Heading2 + numId=0 «Гарчиг».  ФОНТ: 2026-10-05 эзний шийдвэр — AGFutura Mon / Poppins / тема фонт
 * бүгд Arial (Google-д латин Poppins + кирилл Arial холилддогийг арилгана); Symbol/Wingdings
 * тэмдэгт-фонт хэвээр.  (10-01-ний «фонт хөндөхгүй» шийдвэр ДАРАГДСАН.)
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVE = join(HERE, '..', 'src', 'features', 'projects', 'drive');

// docxGoogleReady.ts нь './docxAutoText' гэж өргөтгөлгүй импортолдог (Vite-ийн хэв маяг).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : DRIVE;
      if (existsSync(join(base, `${specifier}.ts`))) return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const G = await import(pathToFileURL(join(DRIVE, 'docxGoogleReady.ts')).href);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';
const SECT = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>';
const doc = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}${SECT}</w:body></w:document>`;
const hdr = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${NS}>${body}</w:hdr>`;
const AG = '<w:rFonts w:ascii="AGFutura Mon" w:hAnsi="AGFutura Mon"/>';
const run = (text, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (inner, pPr = '<w:pPr><w:spacing w:after="0"/></w:pPr>') => `<w:p>${pPr}${inner}</w:p>`;
const cell = (fill, inner) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
const table = (...cells) => `<w:tbl><w:tblPr/><w:tr>${cells.join('')}</w:tr></w:tbl>`;

/** Хуудаснаас том navy тэгш өнцөгт — `hidden` сонголттой, бусад шинжийг солих боломжтой. */
function bigRect({ hidden = true, behind = '0', text = '', alpha = false, cx = 9490841, cy = 13245728, picture = false } = {}) {
  const docPr = `<wp:docPr id="20" name="사각형 20"${hidden ? ' hidden="1"' : ''}/>`;
  const graphic = picture
    ? '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId9" xmlns:r="x"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic>'
    : `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:spPr><a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="tx2">${alpha ? '<a:alpha val="40000"/>' : ''}<a:lumMod val="50000"/></a:schemeClr></a:solidFill></wps:spPr><wps:txbx><w:txbxContent><w:p>${text ? run(text) : ''}</w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic>`;
  const drawing = `<w:drawing><wp:anchor distT="0" distB="0" simplePos="0" relativeHeight="251678720" behindDoc="${behind}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>-906517</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>-3603493</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:wrapNone/>${docPr}${graphic}</wp:anchor></w:drawing>`;
  const vml = `<w:pict><v:rect id="사각형 20" style="position:absolute;margin-left:-71.4pt;width:747.3pt;height:1042.95pt;z-index:251678720${hidden ? ';visibility:hidden' : ''}" fillcolor="#0f243e"/></w:pict>`;
  return `<w:r><w:rPr><w:noProof/></w:rPr><mc:AlternateContent><mc:Choice Requires="wps">${drawing}</mc:Choice><mc:Fallback>${vml}</mc:Fallback></mc:AlternateContent></w:r>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:basedOn w:val="ListParagraph"/><w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="240"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Hanging"><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="3"/></w:numPr><w:ind w:left="709" w:hanging="709"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Chars"><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="3"/></w:numPr><w:ind w:leftChars="200" w:left="400"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Plain"><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="300"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="AgStyle"><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="AGFutura Mon" w:hAnsi="AGFutura Mon"/></w:rPr></w:style>
</w:styles>`;
const FONT_TABLE = (alt) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts ${NS}><w:font w:name="Arial"/><w:font w:name="AGFutura Mon">${alt ? `<w:altName w:val="${alt}"/>` : ''}<w:family w:val="swiss"/></w:font><w:font w:name="Wingdings"/></w:fonts>`;

const styles = G.parseParaStyles(STYLES);
const PAGE = G.pageSizeOf(doc(''));
const ctx = (over = {}) => ({ page: PAGE, styles, ...over });
const part = (xml, over) => G.googleReadyPartXml(xml, ctx(over));

/** Текст → тэр run-ий rPr. */
function rPrOf(xml, text) {
  for (const m of xml.matchAll(/<w:r(?:\s[^>]*)?>((?:(?!<w:r[\s>])[\s\S])*?)<\/w:r>/g)) {
    if (m[1].includes(`>${text}</w:t>`)) return /^<w:rPr>[\s\S]*?<\/w:rPr>/.exec(m[1])?.[0] ?? '';
  }
  throw new Error(`run not found: ${text}`);
}

function assertBalanced(xml) {
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[0].startsWith('<?') || m[3] === '/') continue;
    if (m[1] === '/') assert.equal(stack.pop(), m[2]);
    else stack.push(m[2]);
  }
  assert.equal(stack.length, 0);
}

console.log('фонт → Arial (2026-10-05 эзний шийдвэр)');

const ARIAL = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';

ok('AGFutura Mon, Poppins, тема фонт → Arial; eastAsia, 90% шахалт, хэмжээ хэвээр', () => {
  const x = doc(
    para(
      run('Зургийн шифр:', `<w:rPr><w:rFonts w:ascii="AGFutura Mon" w:eastAsia="BatangChe" w:hAnsi="AGFutura Mon"/><w:b/><w:w w:val="90"/><w:sz w:val="18"/></w:rPr>`) +
        run('Мэдээлэл', '<w:rPr><w:rFonts w:ascii="Poppins" w:cs="Poppins" w:eastAsia="Poppins" w:hAnsi="Poppins"/></w:rPr>') +
        run('Тема', '<w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/></w:rPr>'),
    ),
  );
  const r = part(x);
  assert.equal(
    rPrOf(r.xml, 'Зургийн шифр:'),
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="BatangChe"/><w:b/><w:w w:val="90"/><w:sz w:val="18"/></w:rPr>',
  );
  assert.equal(rPrOf(r.xml, 'Мэдээлэл'), '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Poppins"/></w:rPr>');
  assert.equal(rPrOf(r.xml, 'Тема'), `<w:rPr>${ARIAL}</w:rPr>`);
  assert.ok(!/AGFutura|asciiTheme/.test(r.xml));
  assert.deepEqual(r.stats, { hidden: 0, covers: 0, indents: 0, fonts: 3 });
});

ok('тэмдэгт-фонт (Wingdings, Symbol, MS Gothic) хэвээр; шууд Arial хэвээр (байт-ижил)', () => {
  const x = doc(
    para(
      run('☐', '<w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr>') +
        run('þ', '<w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings" w:hint="default"/></w:rPr>') +
        run('·', '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>') +
        run('Arial', `<w:rPr>${ARIAL}</w:rPr>`),
    ),
  );
  const r = part(x);
  assert.equal(r.xml, x);
  assert.equal(r.stats.fonts, 0);
});

const CT_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';

ok('загвар: docDefaults, стиль, дугаарлалт → Arial; фонтгүй docDefaults-д Arial нэмэгдэнэ', () => {
  const src = zipSync({
    '[Content_Types].xml': strToU8(CT_EMPTY),
    'word/document.xml': strToU8(doc(para(run('Hello')))),
    'word/styles.xml': strToU8(STYLES),
    'word/numbering.xml': strToU8(
      `<?xml version="1.0"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl><w:lvl w:ilvl="1"><w:rPr><w:rFonts w:ascii="AGFutura Mon" w:hAnsi="AGFutura Mon"/></w:rPr></w:lvl></w:abstractNum></w:numbering>`,
    ),
  });
  const r = G.prepareDocxForGoogle(src);
  assert.equal(r.changed, true);
  const files = unzipSync(r.bytes);
  const st = strFromU8(files['word/styles.xml']);
  assert.ok(!/Malgun|AGFutura/.test(st));
  assert.ok(st.includes(`<w:rPrDefault><w:rPr>${ARIAL}</w:rPr></w:rPrDefault>`));
  const num = strFromU8(files['word/numbering.xml']);
  assert.ok(num.includes('w:ascii="Symbol"'));
  assert.ok(!num.includes('AGFutura'));

  const bare = STYLES.replace(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/, '<w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault>');
  const r2 = G.prepareDocxForGoogle(
    zipSync({ '[Content_Types].xml': strToU8(CT_EMPTY), 'word/document.xml': strToU8(doc(para(run('Hello')))), 'word/styles.xml': strToU8(bare) }),
  );
  assert.ok(strFromU8(unzipSync(r2.bytes)['word/styles.xml']).includes(`<w:rPrDefault><w:rPr>${ARIAL}<w:sz w:val="20"/></w:rPr></w:rPrDefault>`));
});

console.log('нуусан / бүрхэх хэлбэр');

ok('нуусан navy тэгш өнцөгт (DrawingML hidden + VML fallback) бүхэлдээ устана; бичвэр хэвээр', () => {
  const x = doc(para(bigRect() + run('1. Баримт бичиг', `<w:rPr>${AG}</w:rPr>`)));
  const r = part(x);
  assert.equal(r.stats.hidden, 1);
  assert.ok(!r.xml.includes('mc:AlternateContent') && !r.xml.includes('사각형'));
  assert.ok(r.xml.includes('<w:r><w:rPr><w:noProof/></w:rPr></w:r>'));
  assert.ok(r.xml.includes('>1. Баримт бичиг</w:t>'));
  assertBalanced(r.xml);
});

ok('Google-оор ил болсон бүрхэвч (hidden-гүй, хуудаснаас том, өмнө, бичвэргүй) устана', () => {
  const r = part(doc(para(bigRect({ hidden: false }))));
  assert.equal(r.stats.covers, 1);
  assert.ok(!r.xml.includes('mc:AlternateContent'));
});

ok('бүрхэвч биш — ард (behindDoc=1), бичвэртэй, тунгалаг, жижиг, зураг (picture) бол хэвээр', () => {
  for (const opts of [{ behind: '1' }, { text: 'ANNEX' }, { alpha: true }, { cx: 3000000, cy: 3000000 }, { picture: true }]) {
    const x = doc(para(bigRect({ hidden: false, ...opts })));
    assert.equal(part(x).xml, x, JSON.stringify(opts));
  }
});

ok('ил хөвөгч лого (header) ба нуусан INLINE зураг хөндөгдөхгүй', () => {
  const logo = '<w:r><w:drawing><wp:anchor behindDoc="1" simplePos="0"><wp:extent cx="684530" cy="523240"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="13" name="Picture 13"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"/></a:graphic></wp:anchor></w:drawing></w:r>';
  const inlineHidden = '<w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="5" name="x" hidden="1"/></wp:inline></w:drawing></w:r>';
  const x = hdr(para(logo + run('Мэдээлэл тодруулгын хүсэлт')) + para(inlineHidden));
  assert.equal(part(x).xml, x);
});

ok('ганц VML (AlternateContent-гүй) visibility:hidden + absolute → устана; харагдах VML хэвээр', () => {
  const hiddenVml = '<w:r><w:pict><v:rect style="position:absolute;width:10pt;height:10pt;visibility:hidden"/></w:pict></w:r>';
  const shownVml = '<w:r><w:pict><v:rect style="position:absolute;width:10pt;height:10pt"/></w:pict></w:r>';
  const r = part(doc(para(hiddenVml + shownVml)));
  assert.equal(r.stats.hidden, 1);
  assert.ok(r.xml.includes('<w:pict><v:rect style="position:absolute;width:10pt;height:10pt"/></w:pict>'));
  assert.ok(!r.xml.includes('visibility:hidden'));
});

ok('хуудасны хэмжээ sectPr-ээс (EMU)', () => {
  assert.deepEqual(G.pageSizeOf(doc('')), { w: 11906 * 635, h: 16838 * 635 });
  assert.deepEqual(G.pageSizeOf('<w:document/>'), { w: 11906 * 635, h: 16838 * 635 });
  // Letter хуудас: A4-ийн хэмжээтэй тэгш өнцөгт letter-ээс том — бүрхэвч.
  const letter = G.pageSizeOf('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>');
  assert.equal(letter.w, 12240 * 635);
});

console.log('numId=0 догол шилжилт (Google дугаарлалтын hanging-ийг буруу хэрэглэдэг)');

const pPrOf = (xml) => /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml)?.[0];

ok('Heading2 + numId=0 + шууд left=450 → firstLine=0 нэмэгдэнэ («Гарчиг» мөр)', () => {
  const x = doc(
    para(
      run('А9 блок барилгын'),
      '<w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr><w:spacing w:after="0"/><w:ind w:left="450"/><w:rPr><w:b w:val="0"/></w:rPr></w:pPr>',
    ),
  );
  const r = part(x);
  assert.equal(r.stats.indents, 1);
  assert.equal(
    pPrOf(r.xml),
    '<w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr><w:spacing w:after="0"/><w:ind w:left="450" w:firstLine="0"/><w:rPr><w:b w:val="0"/></w:rPr></w:pPr>',
  );
});

ok('шууд ind-гүй → загварын гинжийн left (720) + firstLine=0, CT_PPr-ийн дараалалд (spacing → ind → jc)', () => {
  const x = doc(para(run('x'), '<w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:numId w:val="0"/></w:numPr><w:spacing w:after="0"/><w:jc w:val="both"/></w:pPr>'));
  assert.equal(
    pPrOf(part(x).xml),
    '<w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:numId w:val="0"/></w:numPr><w:spacing w:after="0"/><w:ind w:left="720" w:firstLine="0"/><w:jc w:val="both"/></w:pPr>',
  );
});

ok('загварын өөрийн hanging-ийг хуулна; шууд hanging/firstLine байвал хөндөхгүй', () => {
  const a = doc(para(run('a'), '<w:pPr><w:pStyle w:val="Hanging"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr>'));
  assert.match(pPrOf(part(a).xml), /<w:ind w:left="709" w:hanging="709"\/>/);
  const b = doc(para(run('b'), '<w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:numId w:val="0"/></w:numPr><w:ind w:left="450" w:hanging="200"/></w:pPr>'));
  assert.equal(part(b).xml, b);
});

ok('хөндөхгүй: numId≠0, загварт дугаарлалт байхгүй, тэмдэгтийн нэгж (leftChars)', () => {
  for (const pPr of [
    '<w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr>',
    '<w:pPr><w:pStyle w:val="Plain"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr>',
    '<w:pPr><w:pStyle w:val="Chars"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr>',
  ]) {
    const x = doc(para(run('x'), pPr));
    assert.equal(part(x).xml, x, pPr);
  }
});

ok('догол шилжилт засахад догол мөрийн тэмдгийн фонт Arial болно', () => {
  const x = doc(para(run('x'), `<w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:numId w:val="0"/></w:numPr><w:rPr>${AG}</w:rPr></w:pPr>`));
  const r = part(x);
  assert.equal(r.stats.indents, 1);
  assert.equal(
    pPrOf(r.xml),
    `<w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:numId w:val="0"/></w:numPr><w:ind w:left="720" w:firstLine="0"/><w:rPr>${ARIAL}</w:rPr></w:pPr>`,
  );
});

console.log('.docx бүхэлдээ');

const TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;
const NAVY = '0F243E';
function makeDocx({ body, header = para(run('Мэдээлэл тодруулгын хүсэлт', `<w:rPr>${AG}<w:b/></w:rPr>`)), alt = 'Calibri' }) {
  return zipSync({
    '[Content_Types].xml': strToU8(TYPES),
    'word/document.xml': strToU8(doc(body)),
    'word/header1.xml': strToU8(hdr(header)),
    'word/styles.xml': strToU8(STYLES),
    'word/fontTable.xml': strToU8(FONT_TABLE(alt)),
    'word/media/image1.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
  });
}
const rfiBody =
  table(cell(NAVY, para(run('Хүсэлт гаргасан огноо:', `<w:rPr>${AG}<w:b/></w:rPr>`))), cell(null, para(run('■', `<w:rPr>${AG}<w:highlight w:val="black"/></w:rPr>`) + run(' БА', `<w:rPr>${AG}</w:rPr>`)))) +
  para(bigRect() + run('1. Баримт бичиг', `<w:rPr>${AG}</w:rPr>`));

ok('RFI: navy бичвэр цагаан, checkbox (хар highlight) хэвээр, нуусан хэлбэр алга; бүх фонт Arial (header, styles ч)', () => {
  const src = makeDocx({ body: rfiBody });
  const r = G.prepareDocxForGoogle(src);
  assert.equal(r.changed, true);
  assert.equal(r.stats.hidden, 1);
  assert.equal(r.whitened, 2, 'navy нүдний run + түүний догол мөрийн тэмдэг');
  const files = unzipSync(r.bytes);
  const orig = unzipSync(src);
  const d = strFromU8(files['word/document.xml']);
  assert.equal(rPrOf(d, 'Хүсэлт гаргасан огноо:'), `<w:rPr>${ARIAL}<w:b/><w:color w:val="FFFFFF"/></w:rPr>`);
  assert.ok(!/<w:color/.test(rPrOf(d, '■')), 'хар highlight дээрх auto «■» — Word хар зурдаг');
  assert.equal(rPrOf(d, ' БА'), `<w:rPr>${ARIAL}</w:rPr>`);
  assert.ok(!d.includes('mc:AlternateContent') && !d.includes('사각형'));
  for (const name of ['word/document.xml', 'word/header1.xml', 'word/styles.xml']) {
    assert.ok(!/AGFutura|Malgun|Poppins/.test(strFromU8(files[name])), `${name}: Arial-аас бусад фонт алга`);
  }
  for (const name of ['word/fontTable.xml', 'word/media/image1.png']) {
    assert.deepEqual([...files[name]], [...orig[name]], `${name} байт-ижил`);
  }
  assert.deepEqual(Object.keys(files), ['[Content_Types].xml', 'word/document.xml', 'word/header1.xml', 'word/styles.xml', 'word/fontTable.xml', 'word/media/image1.png']);
});

ok('Google-оор дамжсан RFI: ил бүрхэвч алга; Poppins → Arial (header ч)', () => {
  const poppins = '<w:rPr><w:rFonts w:ascii="Poppins" w:cs="Poppins" w:eastAsia="Poppins" w:hAnsi="Poppins"/><w:b w:val="1"/></w:rPr>';
  const src = makeDocx({ body: para(bigRect({ hidden: false }) + run('Хүсэлт гаргасан огноо:', poppins) + run('(Issued date)', poppins)), header: para(run('Doc No: 260930', poppins)) });
  const r = G.prepareDocxForGoogle(src);
  assert.equal(r.stats.covers, 1);
  const files = unzipSync(r.bytes);
  const d = strFromU8(files['word/document.xml']);
  assert.ok(!d.includes('mc:AlternateContent'));
  assert.equal(rPrOf(d, '(Issued date)'), '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Poppins"/><w:b w:val="1"/></w:rPr>');
  assert.ok(!/w:ascii="Poppins"/.test(strFromU8(files['word/header1.xml'])));
});

ok('зөвхөн AGFutura / Poppins (navy бичвэр, нуусан хэлбэргүй) → changed=true (фонт → Arial)', () => {
  const src = makeDocx({
    body: para(run('Мэдээлэл тодруулгын хүсэлт', `<w:rPr>${AG}</w:rPr>`) + run('Request', '<w:rPr><w:rFonts w:ascii="Poppins" w:hAnsi="Poppins"/></w:rPr>')),
  });
  const r = G.prepareDocxForGoogle(src);
  assert.equal(r.changed, true);
  assert.ok(r.stats.fonts >= 2);
});

ok('дахин засахад өөрчлөлтгүй (idempotent) — ЭХ байт буцна', () => {
  const once = G.prepareDocxForGoogle(makeDocx({ body: rfiBody }));
  const twice = G.prepareDocxForGoogle(once.bytes);
  assert.equal(twice.changed, false);
  assert.equal(twice.bytes, once.bytes);
});

ok('засах зүйлгүй .docx → changed=false, ЭХ байт (шинэ хувилбар үүсэхгүй)', () => {
  const src = zipSync({ '[Content_Types].xml': strToU8(TYPES), 'word/document.xml': strToU8(doc(para(run('Hello', `<w:rPr>${ARIAL}</w:rPr>`)))) });
  const r = G.prepareDocxForGoogle(src);
  assert.equal(r.changed, false);
  assert.equal(r.bytes, src);
});

console.log(`\n${n} шалгалт амжилттай.`);
