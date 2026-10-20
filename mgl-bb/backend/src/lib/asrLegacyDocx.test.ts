/**
 * `lib/zipRead.ts` + `lib/asrLegacyDocx.ts` — хуучин Word тайланг унших.
 *
 * Эх сурвалж нь репогийн үндсэн дэх БОДИТ загвар `YYMMDD_PROJECT ID_ASR_BA_001.docx`
 * (ажилтнуудын бөглөдөг байсан яг тэр файл).  Хоосон загвар → бүх утга null;
 * дараа нь тэр XML-ийг Word-ийн бөглөдөг аргаар (текст солих, ☐ sym-ийг ☒
 * болгох) өөрчилж, дахин ZIP-лээд бүрэн замаар уншина.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { listZipEntries, readZipText, readZipEntry } = await import('./zipRead.ts');
const { parseAsrDocumentXml, parseAsrDocx, extractDocxImages, findDate } = await import('./asrLegacyDocx.ts');

const TEMPLATE = path.resolve(import.meta.dirname, '../../../YYMMDD_PROJECT ID_ASR_BA_001.docx');
const templateBytes = new Uint8Array(fs.readFileSync(TEMPLATE));

/* ---------------- zipRead ---------------- */

test('zip: загварын бичлэгүүдийг жагсаана, deflate-raw задална', async () => {
  const entries = listZipEntries(templateBytes);
  assert.ok(entries.some((e) => e.name === 'word/document.xml'));
  const doc = await readZipText(templateBytes, 'word/document.xml');
  assert.ok(doc && doc.startsWith('<?xml'));
  assert.ok(doc.includes('Хяналтаар явсан'));
  // method 0 (store) бичлэг — PNG лого
  const png = await readZipEntry(templateBytes, 'word/media/image1.png');
  assert.ok(png && png.length === 5167);
  assert.equal(await readZipText(templateBytes, 'word/nope.xml'), null);
});

test('zip: ZIP биш байт → алдаа', () => {
  assert.throws(() => listZipEntries(new Uint8Array([1, 2, 3, 4])), /EOCD/);
});

/* ---------------- ЦЭВЭР задлан ---------------- */

const documentXml = (await readZipText(templateBytes, 'word/document.xml'))!;
const headerXml = (await readZipText(templateBytes, 'word/header1.xml'))!;

test('хоосон загвар: бүх утга null / хоосон', () => {
  const p = parseAsrDocumentXml(documentXml, headerXml);
  assert.equal(p.project_name, null);
  assert.equal(p.report_date, null);
  assert.equal(p.shifr, null);
  assert.deepEqual(p.doc_types, []);
  assert.deepEqual(p.visited_teams, []);
  assert.deepEqual(p.work_report_teams, []);
  assert.equal(p.work_note, null);
  assert.equal(p.description, null);
  // Загварын «Б.Билгүүн / MGL ENC Захирал» нь урьдчилан бичсэн утга — тэр хэвээр гарна.
  assert.match(p.checked_by ?? '', /Билгүүн/);
  assert.equal(p.sig_arch_name, null);
  assert.equal(p.header_doc_no, null);
  assert.equal(p.header_date, null);
  assert.deepEqual(p.photo_rids, []);
});

/**
 * Нүдний догол мөрийг Word-ийн бөглөдөг аргаар солино: `<w:t>` бүхий эхний
 * run-ийг өгсөн текстээр, нүдний хүрээнд.
 */
function fillCellAfterLabel(xml: string, label: string, text: string, offset = 1): string {
  const rows = xml.split('<w:tr ');
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]!.split('<w:tc>');
    const firstText = (cells[1] ?? '').replace(/<[^>]+>/g, '');
    if (!firstText.trim().startsWith(label)) continue;
    const idx = 1 + offset;
    const cell = cells[idx]!;
    // хоосон нүд: </w:pPr></w:p> → run нэмнэ; текстэй бол эхний <w:t> солино
    const filled = /<w:t(?: [^>]*)?>[^<]*<\/w:t>/.test(cell)
      ? cell.replace(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/, `<w:t xml:space="preserve">${text}</w:t>`)
      : cell.replace(/<\/w:pPr><\/w:p>/, `</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`);
    cells[idx] = filled;
    rows[i] = cells.join('<w:tc>');
    return rows.join('<w:tr ');
  }
  throw new Error(`label not found: ${label}`);
}

function checkSymAfterText(xml: string, labelText: string): string {
  // ` БА` гэх мэт шошгын ӨМНӨХ хамгийн ойрын F06F sym-ийг F0FE болгоно.
  const at = xml.search(new RegExp(`<w:t(?: [^>]*)?>[ ]*${labelText}</w:t>`));
  assert.ok(at > 0, `label ${labelText}`);
  const before = xml.lastIndexOf('w:char="F06F"', at);
  assert.ok(before > 0);
  return `${xml.slice(0, before)}w:char="F0FE"${xml.slice(before + 'w:char="F06F"'.length)}`;
}

function filledXml(): string {
  let x = documentXml;
  x = fillCellAfterLabel(x, 'Төслийн нэр', 'EVERGREEN орон сууц');
  // Word огноог «20|2|6|.|__|.|__» гэсэн тасархай run-уудаар бичсэн — хоёр «__»-г солино.
  x = x.replace('<w:t>__</w:t>', '<w:t>05</w:t>').replace('<w:t>__</w:t>', '<w:t>19</w:t>');
  x = fillCellAfterLabel(x, 'Шифр', 'MEC-25/21');
  x = fillCellAfterLabel(x, 'Тайлбар', 'Суурийн арматур шалгав.&#10;Хоёр дахь мөр');
  x = checkSymAfterText(x, 'Явц');
  x = checkSymAfterText(x, 'Ажлын зураг');
  x = checkSymAfterText(x, 'БА');
  x = checkSymAfterText(x, 'ХАС');
  x = fillCellAfterLabel(x, 'Архитектор, Инженер', 'Б.Батаа');
  x = fillCellAfterLabel(x, 'Архитектор, Инженер', '2026.05.19', 3);
  x = fillCellAfterLabel(x, 'Талбайн Инженер', 'Д.Дорж');
  // «Ажлын тайлан» шошгын мөрийн ДАРААХ мөр = багийн 8 checkbox; 2 (ББ) ба 8 (АУ)-ыг тэмдэглэнэ.
  const labelAt = x.search(/<w:t(?: [^>]*)?>Ажлын тайлан<\/w:t>/);
  const labelRowEnd = x.indexOf('</w:tr>', labelAt);
  const rowStart = x.indexOf('<w:tr ', labelRowEnd);
  const rowEnd = x.indexOf('</w:tr>', rowStart);
  let row = x.slice(rowStart, rowEnd);
  let n = 0;
  row = row.replace(/w:char="F06F"/g, (m) => {
    n++;
    return n === 2 || n === 8 ? 'w:char="F0FE"' : m;
  });
  assert.equal(n, 8);
  x = x.slice(0, rowStart) + row + x.slice(rowEnd);
  // Их бие: дараагийн мөрийн нэг нүд.
  const bodyStart = x.indexOf('<w:tr ', rowEnd);
  const bodyEnd = x.indexOf('</w:tr>', bodyStart);
  let body = x.slice(bodyStart, bodyEnd);
  body = body.replace(
    /<\/w:pPr><\/w:p>/,
    '</w:pPr><w:r><w:t>ББ: багана 3-р давхар шалгав.</w:t></w:r></w:p><w:p><w:r><w:t>АУ: самбар угсрав.</w:t></w:r></w:p>',
  );
  x = x.slice(0, bodyStart) + body + x.slice(bodyEnd);
  // Зургийн мөрөнд blip.
  const photoAt = x.indexOf('<w:tr ', x.indexOf('Шалгасан'));
  const photoEnd = x.indexOf('</w:tr>', photoAt);
  let photo = x.slice(photoAt, photoEnd);
  photo = photo.replace(
    /<\/w:pPr><\/w:p>/,
    '</w:pPr><w:r><w:drawing><a:blip r:embed="rId50"/></w:drawing><w:drawing><a:blip r:embed="rId51"/></w:drawing></w:r></w:p>',
  );
  x = x.slice(0, photoAt) + photo + x.slice(photoEnd);
  return x;
}

test('бөглөсөн загвар: огноо, шифр, төрөл, багууд, тайлбар, ажлын тайлан, гарын үсэг, зураг', () => {
  const p = parseAsrDocumentXml(filledXml(), headerXml.replace('…..', '05').replace('….', '19').replace('.....', 'BB_001'));
  assert.equal(p.project_name, 'EVERGREEN орон сууц');
  assert.equal(p.report_date, '2026-05-19');
  assert.equal(p.shifr, 'MEC-25/21');
  assert.deepEqual(p.doc_types, ['progress', 'drawing']);
  assert.deepEqual(p.visited_teams.sort(), ['BA', 'HAS']);
  assert.equal(p.description, 'Суурийн арматур шалгав.\nХоёр дахь мөр');
  assert.deepEqual(p.work_report_teams, ['BB', 'AU']);
  assert.equal(p.work_note, 'ББ: багана 3-р давхар шалгав.\nАУ: самбар угсрав.');
  assert.equal(p.sig_arch_name, 'Б.Батаа');
  assert.equal(p.sig_arch_date, '2026-05-19');
  assert.equal(p.sig_site_name, 'Д.Дорж');
  assert.deepEqual(p.photo_rids, ['rId50', 'rId51']);
  assert.equal(p.header_date, '2026-05-19');
  assert.equal(p.header_doc_no, 'LUXWOOD_ASR_BB_001');
});

test('хүн sym солихгүй ☒ / x бичсэн ч танигдана', () => {
  let x = documentXml;
  x = x.replace(/<w:t(?: [^>]*)?>\s*Тайлан<\/w:t>/, '<w:t>☒ Тайлан</w:t>');
  // ББ нүдний sym-ийг устгаад "x ББ" бичнэ
  const at = x.search(/<w:t(?: [^>]*)?>\s*ББ<\/w:t>/);
  const symStart = x.lastIndexOf('<w:sym ', at);
  const symEnd = x.indexOf('/>', symStart) + 2;
  x = `${x.slice(0, symStart)}${x.slice(symEnd)}`.replace(/<w:t(?: [^>]*)?>\s*ББ<\/w:t>/, '<w:t>x ББ</w:t>');
  const p = parseAsrDocumentXml(x, null);
  // «Тайлан» нүдэнд ☐ sym ХЭВЭЭР + ☒ текст: sym давамгайлна → тэмдэглэгдээгүй
  assert.deepEqual(p.doc_types, []);
  assert.deepEqual(p.visited_teams, ['BB']);
});

test('findDate хэлбэрүүд', () => {
  assert.equal(findDate('2026.05.19'), '2026-05-19');
  assert.equal(findDate('2026/5/9'), '2026-05-09');
  assert.equal(findDate('Огноо: 2025-12-01 г.'), '2025-12-01');
  assert.equal(findDate('2026.__.__'), null);
  assert.equal(findDate('2026.13.01'), null);
  assert.equal(findDate(null), null);
});

/* ---------------- бүтэн зам: дахин ZIP-лээд унших ---------------- */

/** Хамгийн энгийн ZIP бичигч (store + deflate холимог) — тестийн зориулалттай. */
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function writeZip(files: { name: string; data: Uint8Array; deflate: boolean }[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const payload = f.deflate ? zlib.deflateRawSync(f.data) : Buffer.from(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(f.data), 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(f.deflate ? 8 : 0, 10);
    cen.writeUInt32LE(crc32(f.data), 16);
    cen.writeUInt32LE(payload.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, name]));
    parts.push(local, name, payload);
    offset += local.length + name.length + payload.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, eocd]));
}

test('бүтэн зам: бөглөсөн docx → parseAsrDocx + extractDocxImages', async () => {
  const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rId50" Type="x/image" Target="media/image7.png"/><Relationship Target="media/image8.jpeg" Type="x/image" Id="rId51"/><Relationship Id="rId52" Type="x/image" Target="media/image9.emf"/></Relationships>`;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 9, 9]);
  const zip = writeZip([
    { name: 'word/document.xml', data: new TextEncoder().encode(filledXml()), deflate: true },
    { name: 'word/header1.xml', data: new TextEncoder().encode(headerXml), deflate: true },
    { name: 'word/_rels/document.xml.rels', data: new TextEncoder().encode(rels), deflate: false },
    { name: 'word/media/image7.png', data: png, deflate: false },
    { name: 'word/media/image8.jpeg', data: jpg, deflate: true },
  ]);
  const p = await parseAsrDocx(zip);
  assert.equal(p.report_date, '2026-05-19');
  assert.equal(p.shifr, 'MEC-25/21');
  const images = await extractDocxImages(zip, [...p.photo_rids, 'rId52', 'rId99']);
  assert.equal(images.length, 2);
  assert.equal(images[0]!.mime, 'image/png');
  assert.deepEqual([...images[0]!.bytes], [...png]);
  assert.equal(images[1]!.mime, 'image/jpeg');
  assert.equal(images[1]!.name, 'image8.jpeg');
  assert.deepEqual([...images[1]!.bytes], [...jpg]);
});
