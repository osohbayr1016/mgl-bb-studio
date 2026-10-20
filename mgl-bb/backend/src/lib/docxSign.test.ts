// Word (.docx) гарын үсгийн нүд олох / суулгах — цэвэр XML функцууд.
// Бодит 40 RFI (прод R2, 2026-10-01) дээр хэмжсэн хоёр хэлбэрийг жижиг
// синтетик XML-ээр давтана: «багана» (MGL загвар) ба «мөрөн дотор» (зөвлөхийн маягт).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const d = await import('./docxSign.ts');

/* ------------------------------------------------------------------ */
/*  XML бүтээгч                                                         */
/* ------------------------------------------------------------------ */

type CellSpec = { text?: string; span?: number; vMerge?: 'restart' | 'continue'; drawing?: string; width?: number; mark?: string; fill?: string; extraP?: string };

function cell(c: CellSpec): string {
  const pr: string[] = [];
  if (c.width) pr.push(`<w:tcW w:w="${c.width}" w:type="dxa"/>`);
  if (c.span && c.span > 1) pr.push(`<w:gridSpan w:val="${c.span}"/>`);
  if (c.vMerge === 'restart') pr.push('<w:vMerge w:val="restart"/>');
  if (c.vMerge === 'continue') pr.push('<w:vMerge/>');
  if (c.fill) pr.push(`<w:shd w:val="clear" w:fill="${c.fill}"/>`);
  const run = c.text
    ? `<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${c.text}</w:t></w:r>`
    : '<w:r><w:rPr><w:rtl w:val="0"/></w:rPr></w:r>';
  return `<w:tc><w:tcPr>${pr.join('')}</w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="exact"/><w:jc w:val="center"/>${c.mark ?? ''}</w:pPr>${run}${c.drawing ?? ''}</w:p>${c.extraP ?? ''}</w:tc>`;
}

function row(cells: CellSpec[], trPr = '<w:trPr><w:trHeight w:val="600" w:hRule="atLeast"/></w:trPr>'): string {
  return `<w:tr>${trPr}${cells.map(cell).join('')}</w:tr>`;
}

function table(grid: number[], rows: string[]): string {
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid
    .map((w) => `<w:gridCol w:w="${w}"/>`)
    .join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

const DOC_OPEN =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>';
const DOC_CLOSE = '<w:sectPr/></w:body></w:document>';

/** MGL-ийн RFI-ийн «Хариу илгээсэн» хүснэгт (EVGR-020-ийн хэлбэр). */
function evgrTable(opts: { dirName?: string; replierName?: string; prepMark?: string } = {}): string {
  const grid = [446, 1134, 1071, 1582, 2692, 2034, 1026];
  return table(grid, [
    row([{ text: '1' }, { text: 'Хариу (Response) :', span: 6 }]),
    row([{ text: 'Хариу илгээсэн: (Replied by)', span: 2, vMerge: 'restart' }, { text: 'Албан тушаал: (Position)' }, { text: 'Овог нэр: (Full name)' }, { text: 'Хариу өгсөн хаяг: (Revision submition mail)' }, { text: 'Гарын үсэг (Signature)' }, { text: 'Огноо: (Date)' }]),
    row([{ span: 2, vMerge: 'continue' }, { text: 'Архитектор' }, { text: opts.replierName ?? 'Б.Эрдэнэжин' }, { text: 'pm@mglenc.com' }, {}, { text: '2026.09.30' }]),
    row([{ text: 'Бэлтгэсэн: (Prepared by)', span: 2 }, { text: 'Төслийн менежер' }, { mark: opts.prepMark }, { text: 'WECHAT' }, {}, { mark: opts.prepMark }]),
    row(
      [{ text: 'Хянасан: (Approved by)', span: 2 }, { text: 'Захирал' }, { text: opts.dirName ?? 'Б.Билгүүн' }, { text: 'bilguun@mglenc.com' }, {}, { text: '2026.09.30' }],
      '<w:trPr><w:trHeight w:val="500" w:hRule="exact"/></w:trPr>',
    ),
  ]);
}

/**
 * ORSH-RFI-007 (прод, 2026-10-05) — Word-ийн үүсгэсэн 15 twip-ийн НАРИЙН сүлжээний
 * багана (index 4): толгойн «Гарын үсэг» [4,6) = нарийн + гарын үсэг, доорх мөрийн
 * «Ирсэн хаяг» [3,5) = хаяг + нарийн.  Баганын тоогоор хэмжихэд хаяг ч, гарын үсэг ч
 * 1 багана давхцаж хаягийн нүд ялдаг байв.
 */
function slimGridTable(opts: { addrDrawing?: string; mergedRow?: boolean } = {}): string {
  const grid = [2010, 1646, 1515, 1425, 15, 1410, 1945];
  const body = (pos: string, name: string, addr: string): CellSpec[] => [
    { text: pos },
    { text: name },
    { text: addr, span: 2, drawing: opts.addrDrawing },
    {},
    { text: '2026.10.05' },
  ];
  return table(grid, [
    row([{ text: 'Хариу (Response) :', span: 7 }]),
    row([
      { text: 'Хариу илгээсэн: (Replied by)', vMerge: 'restart' },
      { text: 'Албан тушаал: (Position)' },
      { text: 'Овог нэр: (Full name)' },
      { text: 'Ирсэн хаяг: (Sent address)' },
      { text: 'Гарын үсэг: (Signature)', span: 2 },
      { text: 'Огноо: (Date)' },
    ]),
    row([{ vMerge: 'continue' }, ...body('ББ-ийн ахлан инженер', 'Б.Батзориг', 'projectmanager@ mglenc.com')]),
    opts.mergedRow
      ? // Гарын үсгийн нүдийг хаягтай нэгтгэсэн мөр — хайрцаг биш.
        row([{ vMerge: 'continue' }, { text: 'Төслийн менежер' }, { text: 'М.Монголжин' }, { text: 'projectmanager@mglenc.com', span: 3 }, { text: '2026.10.05' }])
      : row([{ vMerge: 'continue' }, ...body('Төслийн менежер', 'М.Монголжин', 'projectmanager@ mglenc.com')]),
    row([{ text: 'Батласан: (Approved by )' }, ...body('Захирал', 'Б.Билгүүн', 'bilguun@ mglenc.com')]),
  ]);
}

/** Зөвлөхийн маягт — шошготой нүд өөрөө хайрцаг (FURNITURE LAND RFI-ийн хэлбэр). */
function inlineTable(): string {
  return table([1600, 1500, 1500, 1600, 1500, 1500], [
    row([{ text: 'Issued by: Хүргүүлсэн:', span: 2 }, { span: 2 }, { text: 'Date(YYYY/MM/DD): Өдөр:' }, {}]),
    row([
      { text: 'Prepared by: Бэлтгэсэн:', vMerge: 'restart' },
      {},
      { text: 'Signature/ Гарын үсэг', vMerge: 'restart' },
      { text: 'Approved by: Баталсан:', vMerge: 'restart' },
      { text: 'Э.Цогтбат' },
      { text: 'Signature/ Гарын үсэг', vMerge: 'restart' },
    ]),
    row([{ vMerge: 'continue' }, { text: 'Name/ Нэр' }, { vMerge: 'continue' }, { vMerge: 'continue' }, { text: 'Name/ Нэр' }, { vMerge: 'continue' }]),
  ]);
}

/**
 * MGL-WT-CR-002 (прод, 2026-10-12) — Өөрчлөлтийн хүсэлтийн (CR) загвар: хар-хөх (#0F243E)
 * толгой мөр «Гарын үсэг: (Sign)», «Овог нэр: (Perpared by)» — хаалтан доторх англи
 * тайлбар нь «Signature» биш тул өмнө нь баганын толгой танигдаагүй, мөрөн дотрох хэлбэрт
 * унаж гарын үсэг толгой нүдэнд (хар бэх хар-хөх дэвсгэр дээр) суудаг байв.  Доор нь
 * «Захиалагчаас баталасан: (Approved by client)» блок.  Сүлжээ нь Word шиг ХОЁР ДАВХАР
 * (32 багана, хүснэгт 16-г ашиглана).
 */
function crTable(opts: { headDrawing?: string; headExtraP?: string } = {}): string {
  const half = [2430, 810, 450, 195, 1515, 450, 105, 360, 510, 390, 330, 660, 510, 300, 540, 450];
  const NAVY = '0F243E';
  const person = (pos: string, name: string, mail: string): CellSpec[] => [
    { text: pos, span: 3 },
    { text: name },
    { text: mail, span: 4 },
    { span: 3 },
    { text: '2026/10/09', span: 4 },
  ];
  return table([...half, ...half], [
    row([{ text: 'Өөрчлөлт/Шалтгаан: (Revision Change/Reason)' }, { text: 'парапет өндөр нэмэгдэж 1.8 болсон', span: 15 }]),
    row([
      { text: 'Хариу илгээсэн: (Replied by)', vMerge: 'restart', fill: NAVY },
      { text: 'Албан тушаал: (Position)', span: 3, fill: NAVY },
      { text: 'Овог нэр: (Perpared by)', fill: NAVY },
      { text: 'Хариу өгсөн хаяг: (Revision submition mail)', span: 4, fill: NAVY },
      { text: 'Гарын үсэг: (Sign)', span: 3, fill: NAVY, drawing: opts.headDrawing, extraP: opts.headExtraP },
      { text: 'Огноо: (Date)', span: 4, fill: NAVY },
    ]),
    row([{ vMerge: 'continue', fill: NAVY }, ...person('Бүтээцийн инженер', 'Д.Далайбуян', 'structure@ mglenc.com')]),
    row([{ vMerge: 'continue', fill: NAVY }, ...person('Төслийн менежер', 'М.Монголжин', 'Projectmanager @mglenc.com')]),
    row([{ text: 'Хянасан (Approved by:)', fill: NAVY }, ...person('Захирал', 'Б.Билгүүн', 'bilguun@ mglenc.com')]),
    row([
      { text: 'Захиалагчаас баталасан: (Approved by client)', vMerge: 'restart', fill: NAVY },
      { text: 'Албан тушаал: (Position)', span: 3, fill: NAVY },
      { text: 'Овог нэр: (Perpared by)', fill: NAVY },
      { text: 'Гарын үсэг: (Sign)', span: 7, fill: NAVY },
      { text: 'Огноо: (Date)', span: 4, fill: NAVY },
    ]),
    row([{ vMerge: 'continue', fill: NAVY }, { span: 3 }, {}, { span: 7 }, { span: 4 }]),
  ]);
}

/** Google Docs (Office горим) дахин хадгалсны дараах манай гарын үсэг — `mgl-sign-…` нэр «image2.png» болсон, descr үлдсэн. */
const GOOGLE_RESAVED_STAMP =
  '<w:r w:rsidDel="00000000"><w:rPr><w:color w:val="ffffff"/></w:rPr><w:drawing><wp:inline distB="0" distT="0" distL="0" distR="0"><wp:extent cx="234775" cy="486000"/><wp:docPr descr="MGL ERP · Мөнхбат Монголжин · Төслийн менежер · 2026-10-12T00:36:15.815Z" id="19" name="image2.png"/></wp:inline></w:drawing></w:r>';

function doc(...parts: string[]): string {
  return `${DOC_OPEN}<w:p><w:r><w:t>Мэдээлэл тодруулгын хүсэлт</w:t></w:r></w:p>${parts.join('<w:p/>')}${DOC_CLOSE}`;
}

/* ------------------------------------------------------------------ */
/*  Таних                                                               */
/* ------------------------------------------------------------------ */

test('parseTables: сүлжээний багана, gridSpan, vMerge, өргөн', () => {
  const tables = d.parseTables(doc(evgrTable()));
  assert.equal(tables.length, 1);
  const t = tables[0]!;
  assert.deepEqual(t.grid, [446, 1134, 1071, 1582, 2692, 2034, 1026]);
  const hdr = t.rows[1]!;
  assert.equal(hdr.cells[0]!.c0, 0);
  assert.equal(hdr.cells[0]!.c1, 2);
  assert.equal(hdr.cells[0]!.vMerge, 'restart');
  assert.equal(hdr.cells[4]!.text, 'Гарын үсэг (Signature)');
  assert.equal(hdr.cells[4]!.c0, 5);
  assert.equal(hdr.cells[4]!.widthTwips, 2034);
  assert.equal(t.rows[2]!.cells[0]!.vMerge, 'continue');
});

test('findSignatureSlots: багана хэлбэр — үүрэг өвлөгдөнө, захирлын мөр батлагч', () => {
  const slots = d.findSignatureSlots(d.parseTables(doc(evgrTable())));
  assert.equal(slots.length, 3);
  const [a, b, c] = slots;
  assert.equal(a!.role, 'Хариу илгээсэн: (Replied by)');
  assert.equal(a!.position, 'Архитектор');
  assert.equal(a!.name, 'Б.Эрдэнэжин');
  assert.equal(a!.date, '2026.09.30');
  assert.equal(a!.approver, false);
  assert.equal(a!.state, 'empty');
  assert.equal(a!.pattern, 'column');
  assert.equal(b!.role, 'Бэлтгэсэн: (Prepared by)');
  assert.equal(b!.name, '');
  assert.equal(b!.approver, false);
  assert.equal(c!.role, 'Хянасан: (Approved by)');
  assert.equal(c!.approver, true);
  assert.equal(new Set(slots.map((s) => s.key)).size, 3);
  assert.ok(slots.every((s) => s.group === a!.group));
});

test('findSignatureSlots: нарийн сүлжээний багана — хайрцаг нь «Ирсэн хаяг» биш, гарын үсгийн нүд', () => {
  const slots = d.findSignatureSlots(d.parseTables(doc(slimGridTable())));
  assert.equal(slots.length, 3);
  for (const s of slots) {
    assert.equal(s.box.c0, 5, `${s.name}: гарын үсгийн нүд [5,6)`);
    assert.equal(s.box.c1, 6);
    assert.equal(s.box.text, '', 'хаягийн бичвэртэй нүд хайрцаг болохгүй');
    assert.equal(s.state, 'empty');
    assert.equal(s.dateCell?.text, '2026.10.05');
  }
  assert.deepEqual(
    slots.map((s) => [s.position, s.name, s.approver]),
    [
      ['ББ-ийн ахлан инженер', 'Б.Батзориг', false],
      ['Төслийн менежер', 'М.Монголжин', false],
      ['Захирал', 'Б.Билгүүн', true],
    ],
  );
});

test('findSignatureSlots: гарын үсгийн нүдийг хаягтай нэгтгэсэн мөр хайрцаг болохгүй, бусад мөр хэвээр', () => {
  const slots = d.findSignatureSlots(d.parseTables(doc(slimGridTable({ mergedRow: true }))));
  assert.deepEqual(
    slots.map((s) => s.name),
    ['Б.Батзориг', 'Б.Билгүүн'],
  );
});

test('findSignatureSlots: «Хянасан» нь захирал биш албан тушаалтай бол энгийн мөр', () => {
  const xml = doc(
    table([1500, 1500, 1500, 1500, 1500], [
      row([{ text: 'Бэлтгэсэн:' }, { text: 'Албан тушаал' }, { text: 'Овог нэр' }, { text: 'Гарын үсэг' }, { text: 'Огноо' }]),
      row([{ text: 'Хянасан:' }, { text: 'Ахлах инженер' }, { text: 'Б.Бат' }, {}, {}]),
      row([{ text: 'Баталсан:' }, {}, {}, {}, {}]),
    ]),
  );
  const slots = d.findSignatureSlots(d.parseTables(xml));
  assert.equal(slots.length, 2);
  assert.equal(slots[0]!.approver, false, 'Хянасан + Ахлах инженер');
  assert.equal(slots[1]!.approver, true, 'Баталсан + албан тушаал хоосон');
});

test('findSignatureSlots: мөрөн дотрох хэлбэр — шошготой нүд хайрцаг, нэрийн тайлбар хасагдана', () => {
  const slots = d.findSignatureSlots(d.parseTables(doc(inlineTable())));
  assert.equal(slots.length, 2);
  const [prep, appr] = slots;
  assert.equal(prep!.pattern, 'inline');
  assert.equal(prep!.role, 'Prepared by: Бэлтгэсэн:');
  assert.equal(prep!.name, '');
  assert.equal(prep!.approver, false);
  assert.equal(appr!.role, 'Approved by: Баталсан:');
  assert.equal(appr!.name, 'Э.Цогтбат');
  assert.equal(appr!.approver, true);
  // vMerge-ийн доод мөр тусдаа нүд болохгүй.
  assert.ok(slots.every((s) => s.row === 1));
});

test('findSignatureSlots: гараар оруулсан зураг = other, манай тэмдэг = erp', () => {
  const manual = '<w:r><w:drawing><wp:anchor><wp:docPr id="30" name="Picture 30"/></wp:anchor></w:drawing></w:r>';
  const ours = '<w:r><w:drawing><wp:inline><wp:docPr id="31" name="mgl-sign-abc123" descr="x"/></wp:inline></w:drawing></w:r>';
  const xml = doc(
    table([1500, 1500, 1500, 1500], [
      row([{ text: 'Албан тушаал' }, { text: 'Овог нэр' }, { text: 'Гарын үсэг' }, { text: 'Огноо' }]),
      row([{ text: 'Инженер' }, { text: 'Л.Сайнбаяр' }, { drawing: manual }, {}]),
      row([{ text: 'Захирал' }, { text: 'Б.Билгүүн' }, { drawing: ours }, {}]),
    ]),
  );
  const slots = d.findSignatureSlots(d.parseTables(xml));
  assert.equal(slots[0]!.state, 'other');
  assert.equal(slots[1]!.state, 'erp');
  assert.equal(slots[1]!.mark, 'mgl-sign-abc123');
});

test('findSignatureSlots: «гарын үсэг» гэж дурдсан урт өгүүлбэр толгой болохгүй', () => {
  const xml = doc(
    table([3000, 3000], [
      row([{ text: 'Энэ баримтад захиалагч гарын үсэг зурж баталгаажуулсны дараа ажил эхэлнэ.' }, {}]),
      row([{ text: 'a' }, { text: 'b' }]),
    ]),
  );
  assert.equal(d.findSignatureSlots(d.parseTables(xml)).length, 0);
});

/* ------------------------------------------------------------------ */
/*  Нэр, огноо                                                          */
/* ------------------------------------------------------------------ */

test('personNameMatches: «Б.Эрдэнэжин» ↔ «Батбаяр Эрдэнэжин», латин username, урвуу дараалал', () => {
  const user = { full_name: 'Батбаяр Эрдэнэжин', username: 'B.Erdenejin' };
  assert.equal(d.personNameMatches('Б.Эрдэнэжин', user), true);
  assert.equal(d.personNameMatches('Б. Эрдэнэжин', user), true);
  assert.equal(d.personNameMatches('Эрдэнэжин Б.', user), true);
  assert.equal(d.personNameMatches('Эрдэнэжин', user), true);
  assert.equal(d.personNameMatches('B.Erdenejin', user), true);
  assert.equal(d.personNameMatches('Батбаяр Эрдэнэжин', user), true);
  assert.equal(d.personNameMatches('Д.Эрдэнэжин', user), false, 'эцгийн нэрийн үсэг өөр');
  assert.equal(d.personNameMatches('Б.Билгүүн', user), false);
  assert.equal(d.personNameMatches('', user), false);
  assert.equal(d.personNameMatches('Б.Билгүүн', { full_name: 'Бат-Өлзий Билгүүн', username: 'B.Bilguun' }), true);
  assert.equal(d.personNameMatches('Ц.Эрдэнэболд Name/ Нэр', { full_name: 'Цогт Эрдэнэболд' }), true);
});

test('shortPersonName: «Овог Нэр» → «О.Нэр»', () => {
  assert.equal(d.shortPersonName('Бат-Өлзий Билгүүн'), 'Б.Билгүүн');
  assert.equal(d.shortPersonName('Мөнхбат  Монголжин'), 'М.Монголжин');
  assert.equal(d.shortPersonName('Билгүүн'), 'Билгүүн');
  assert.equal(d.shortPersonName(''), '');
});

test('detectDateStyle + formatDocDate: хүснэгтийн бусад огнооны хэлбэрийг дуурайна', () => {
  assert.equal(d.detectDateStyle(['', '2026.09.30']), 'YYYY.MM.DD');
  assert.equal(d.detectDateStyle(['26.10.01']), 'YY.MM.DD');
  assert.equal(d.detectDateStyle(['2026/09/16']), 'YYYY/MM/DD');
  assert.equal(d.detectDateStyle([]), 'YYYY.MM.DD');
  assert.equal(d.formatDocDate('2026-10-01', 'YYYY.MM.DD'), '2026.10.01');
  assert.equal(d.formatDocDate('2026-10-01', 'YY.MM.DD'), '26.10.01');
  assert.equal(d.formatDocDate('2026-10-01', 'YYYY/MM/DD'), '2026/10/01');
});

/* ------------------------------------------------------------------ */
/*  Зураг                                                               */
/* ------------------------------------------------------------------ */

test('imageInfo: PNG ба JPEG-ийн хэмжээ, бусад → null', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, 500);
  new DataView(png.buffer).setUint32(20, 160);
  assert.deepEqual(d.imageInfo(png), { ext: 'png', width: 500, height: 160 });
  // SOI, APP0(len 16), SOF0(len 17: precision 8, h=120, w=300)
  const jpg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x78, 0x01, 0x2c,
    0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  assert.deepEqual(d.imageInfo(jpg), { ext: 'jpeg', width: 300, height: 120 });
  assert.equal(d.imageInfo(new TextEncoder().encode('RIFF....WEBPVP8 ')), null);
});

test('signatureExtent: хэлбэрээр өндөр, хайрцгийн өргөнд багтана', () => {
  const wide = d.signatureExtent({ width: 500, height: 160 }, 2034);
  assert.equal(wide.cy, 10 * 36_000);
  const mid = d.signatureExtent({ width: 300, height: 200 }, 2034);
  assert.equal(mid.cy, 11.5 * 36_000);
  const square = d.signatureExtent({ width: 428, height: 408 }, 2034);
  assert.equal(square.cy, 13.5 * 36_000);
  const tall = d.signatureExtent({ width: 157, height: 325 }, 2034);
  assert.equal(tall.cy, 13.5 * 36_000);
  // Нарийн хайрцаг → өргөн нь хайрцагт багтаж, өндөр жигд багасна.
  const narrow = d.signatureExtent({ width: 1000, height: 100 }, 1000);
  assert.ok(narrow.cx <= (1000 - 240) * 635 + 1);
  assert.ok(Math.abs(narrow.cx / narrow.cy - 10) < 0.05);
});

/* ------------------------------------------------------------------ */
/*  OOXML туслахууд                                                     */
/* ------------------------------------------------------------------ */

test('setPPrChild: байгааг солино, байхгүйг схемийн дарааллаар оруулна', () => {
  const inner = '<w:pStyle w:val="1"/><w:ind w:left="0"/><w:rPr><w:b/></w:rPr>';
  const withSpacing = d.setPPrChild(inner, 'spacing', '<w:spacing w:after="0"/>');
  assert.equal(withSpacing, '<w:pStyle w:val="1"/><w:spacing w:after="0"/><w:ind w:left="0"/><w:rPr><w:b/></w:rPr>');
  const withJc = d.setPPrChild(withSpacing, 'jc', '<w:jc w:val="center"/>');
  assert.equal(
    withJc,
    '<w:pStyle w:val="1"/><w:spacing w:after="0"/><w:ind w:left="0"/><w:jc w:val="center"/><w:rPr><w:b/></w:rPr>',
  );
  assert.equal(d.setPPrChild('<w:jc w:val="left"/>', 'jc', '<w:jc w:val="center"/>'), '<w:jc w:val="center"/>');
  assert.equal(d.setPPrChild('', 'jc', '<w:jc w:val="center"/>'), '<w:jc w:val="center"/>');
});

test('addImageRelationship + ensureImageContentType: давхардалгүй id, Default нэг л удаа', () => {
  const rels =
    '<?xml version="1.0"?><Relationships xmlns="x"><Relationship Id="rId1" Type="t" Target="styles.xml"/><Relationship Id="rIdMglSign1" Type="t" Target="media/a.png"/></Relationships>';
  const r = d.addImageRelationship(rels, 'media/mgl-sign-x.png');
  assert.equal(r.rid, 'rIdMglSign2');
  assert.match(r.xml, /<Relationship Id="rIdMglSign2" Type="[^"]+\/image" Target="media\/mgl-sign-x.png"\/><\/Relationships>$/);
  const ct = '<Types xmlns="x"><Default Extension="xml" ContentType="application/xml"/></Types>';
  const ct2 = d.ensureImageContentType(ct, 'png');
  assert.match(ct2, /<Default Extension="png" ContentType="image\/png"\/><\/Types>$/);
  assert.equal(d.ensureImageContentType(ct2, 'png'), ct2);
  const ctJpg = '<Types><Default Extension="jpg" ContentType="image/jpeg"/></Types>';
  assert.equal(d.ensureImageContentType(ctJpg, 'jpeg'), ctJpg);
});

test('ensureRootNamespaces: wp/r зарлаагүй бол нэмнэ, байвал хөндөхгүй', () => {
  const bare = '<w:document xmlns:w="w"><w:body/></w:document>';
  const fixed = d.ensureRootNamespaces(bare);
  assert.match(fixed, /xmlns:wp="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/wordprocessingDrawing"/);
  assert.match(fixed, /xmlns:r="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships"/);
  assert.equal(d.ensureRootNamespaces(fixed), fixed);
});

/* ------------------------------------------------------------------ */
/*  Суулгах                                                             */
/* ------------------------------------------------------------------ */

function stampFirst(xml: string, pick: (s: import('./docxSign.ts').SignSlot) => boolean, fill = {}) {
  const slots = d.findSignatureSlots(d.parseTables(xml));
  const slot = slots.find(pick)!;
  return {
    slot,
    res: d.stampDocumentXml(xml, slots, {
      slot,
      rid: 'rIdMglSign1',
      docPrId: d.nextDocPrId(xml),
      mark: 'mgl-sign-test1',
      descr: 'MGL ERP · Б.Эрдэнэжин · 2026-10-01',
      ext: 'png',
      cx: 700_000,
      cy: 396_000,
      fill,
    }),
  };
}

test('stampDocumentXml (багана): зураг ЗӨВХӨН тэр нүдэнд, бусад хэсэг байт-ижил, дахин уншихад erp', () => {
  const xml = doc(evgrTable());
  const { slot, res } = stampFirst(xml, (s) => s.name === 'Б.Эрдэнэжин');
  assert.deepEqual(res.filled, [], 'бөглөх нүд хоосон биш (нэр, огноо бичигдсэн)');
  // Хайрцгийн өмнөх хэсэг өөрчлөгдөөгүй.
  assert.equal(res.xml.slice(0, slot.box.start), xml.slice(0, slot.box.start));
  const after = d.findSignatureSlots(d.parseTables(res.xml));
  const same = after.find((s) => s.key === slot.key)!;
  assert.equal(same.state, 'erp');
  assert.equal(same.mark, 'mgl-sign-test1');
  assert.equal(after.filter((s) => s.state === 'erp').length, 1);
  // Гарын үсгийн догол мөр: exact → auto, голлосон, r:embed зөв.
  const box = res.xml.slice(same.box.start, same.box.end);
  assert.match(box, /<w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"\/>/);
  assert.doesNotMatch(box, /lineRule="exact"/);
  assert.match(box, /<a:blip r:embed="rIdMglSign1"\/>/);
  assert.match(box, /<wp:extent cx="700000" cy="396000"\/>/);
});

test('stampDocumentXml: ЗӨВХӨН хоосон нэр/албан тушаал/огноог бөглөнө, rPr хөрш мөрөөс', () => {
  const xml = doc(evgrTable());
  const { slot, res } = stampFirst(xml, (s) => s.role.startsWith('Бэлтгэсэн'), {
    name: 'М.Монголжин',
    position: 'ДАРАХГҮЙ',
    date: '2026.10.01',
  });
  assert.deepEqual(
    res.filled.map((f) => f.field).sort(),
    ['date', 'name'],
    'албан тушаал аль хэдийн бичигдсэн тул хөндөхгүй',
  );
  const after = d.findSignatureSlots(d.parseTables(res.xml)).find((s) => s.key === slot.key)!;
  assert.equal(after.name, 'М.Монголжин');
  assert.equal(after.position, 'Төслийн менежер');
  assert.equal(after.date, '2026.10.01');
  const nameCell = res.xml.slice(after.nameCell!.start, after.nameCell!.end);
  // Фонт ҮРГЭЛЖ Arial (2026-10-05) — хөрш мөрийн хэмжээ (sz 18) хэвээр.
  assert.match(nameCell, /<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"\/><w:sz w:val="18"\/><\/w:rPr><w:t xml:space="preserve">М.Монголжин<\/w:t><\/w:r>/);
});

test('stampDocumentXml: хоосон нүдний догол мөрийн тэмдгийн формат түрүүлнэ (Word шиг), засварын тэмдэглэгээгүй', () => {
  // RFI загварын хоосон нүд: бичвэргүй ч догол мөрийн тэмдэг AGFutura Mon · 90% хэлбэртэй.
  // Хөрш мөрийн бичвэр (sz 18) биш, ЭНЭ формат (фонтоо Arial болгож) авна; ins/rPrChange/pPrChange хөндөгдөхгүй.
  const prepMark =
    '<w:rPr><w:ins w:id="5" w:author="A" w:date="2026-01-01T00:00:00Z"/><w:rFonts w:ascii="AGFutura Mon" w:hAnsi="AGFutura Mon"/><w:w w:val="90"/><w:sz w:val="20"/>' +
    '<w:rPrChange w:id="6" w:author="A" w:date="2026-01-01T00:00:00Z"><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrChange></w:rPr>' +
    '<w:pPrChange w:id="7" w:author="A" w:date="2026-01-01T00:00:00Z"><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange>';
  const xml = doc(evgrTable({ prepMark }));
  const { slot, res } = stampFirst(xml, (s) => s.role.startsWith('Бэлтгэсэн'), { name: 'М.Монголжин', date: '2026.10.01' });
  assert.deepEqual(res.filled.map((f) => f.field).sort(), ['date', 'name']);
  const after = d.findSignatureSlots(d.parseTables(res.xml)).find((s) => s.key === slot.key)!;
  // AGFutura Mon → Arial (2026-10-05); 90% шахалт, хэмжээ хэвээр.  Догол мөрийн тэмдэг (prepMark) өөрөө хөндөгдөхгүй.
  const want = '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:w w:val="90"/><w:sz w:val="20"/></w:rPr>';
  for (const [c, text] of [[after.nameCell!, 'М.Монголжин'], [after.dateCell!, '2026.10.01']] as const) {
    const cellXml = res.xml.slice(c.start, c.end);
    assert.ok(cellXml.includes(`${want}<w:t xml:space="preserve">${text}</w:t></w:r>`), cellXml);
    // Догол мөрийн тэмдэг (засварын тэмдэглэгээтэй нь) өөрчлөгдөөгүй, rPr тэнцвэртэй.
    assert.ok(cellXml.includes(prepMark));
    assert.equal(cellXml.split('<w:rPr>').length, cellXml.split('</w:rPr>').length);
  }
  // Тэмдэггүй нүд (албан тушаал бичигдсэн) хэвээр; хөрш мөрөөс уншдаг fallback өмнөх тестэд.
  assert.equal(after.position, 'Төслийн менежер');
});

test('stampDocumentXml (нарийн сүлжээ): зураг гарын үсгийн нүдэнд, хаягийн нүд хөндөгдөхгүй', () => {
  const xml = doc(slimGridTable());
  const { slot, res } = stampFirst(xml, (s) => s.name === 'М.Монголжин');
  assert.deepEqual(res.removed, []);
  const after = d.findSignatureSlots(d.parseTables(res.xml)).find((s) => s.key === slot.key)!;
  assert.equal(after.state, 'erp');
  assert.equal(after.box.c0, 5);
  const row = d.parseTables(res.xml)[0]!.rows[after.row]!;
  const addr = row.cells.find((c) => c.c0 === 3)!;
  assert.equal(addr.hasDrawing, false);
  assert.equal(addr.text, 'projectmanager@ mglenc.com');
});

test('stampDocumentXml: өмнө нь хаягийн нүдэнд буруу суусан МАНАЙ зураг устна, хүний зураг үлдэнэ', () => {
  const stray = '<w:r w:rsidR="00AB12CD"><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline><wp:docPr id="40" name="mgl-sign-stray01" descr="x"/></wp:inline></w:drawing></w:r>';
  const xml = doc(slimGridTable({ addrDrawing: stray }));
  const before = d.findSignatureSlots(d.parseTables(xml));
  assert.ok(before.every((s) => s.state === 'empty'), 'буруу нүдэн дэх зураг хайрцгийн төлөвт нөлөөлөхгүй');
  const { slot, res } = stampFirst(xml, (s) => s.name === 'М.Монголжин');
  assert.deepEqual(res.removed, ['mgl-sign-stray01'], 'зөвхөн ЭНЭ мөрийнх');
  const tables = d.parseTables(res.xml);
  const row = tables[0]!.rows[slot.row]!;
  const addr = row.cells.find((c) => c.c0 === 3)!;
  assert.equal(addr.hasDrawing, false);
  assert.equal(addr.text, 'projectmanager@ mglenc.com', 'хаягийн бичвэр хэвээр');
  // Бусад мөрийн буруу зураг (тэр хүн дахин зурах үед цэвэрлэгдэнэ) хөндөгдөөгүй.
  assert.equal(res.xml.split('mgl-sign-stray01').length - 1, 2);
  const after = d.findSignatureSlots(d.parseTables(res.xml)).find((s) => s.key === slot.key)!;
  assert.equal(after.mark, 'mgl-sign-test1');

  // Тэмдэггүй (хүний оруулсан) зураг хөндөгдөхгүй.
  const manual = '<w:r><w:drawing><wp:anchor><wp:docPr id="41" name="Picture 41"/></wp:anchor></w:drawing></w:r>';
  const xml2 = doc(slimGridTable({ addrDrawing: manual }));
  const r2 = stampFirst(xml2, (s) => s.name === 'М.Монголжин').res;
  assert.deepEqual(r2.removed, []);
  assert.equal(r2.xml.split('name="Picture 41"').length - 1, 3);
});

test('stampDocumentXml (мөрөн дотор): нэг мөрийн нөгөө хайрцаг дахь манай гарын үсэг үлдэнэ', () => {
  const xml = doc(inlineTable());
  const first = stampFirst(xml, (s) => s.approver).res.xml;
  const slots = d.findSignatureSlots(d.parseTables(first));
  const prep = slots.find((s) => !s.approver)!;
  const res = d.stampDocumentXml(first, slots, {
    slot: prep,
    rid: 'rIdMglSign2',
    docPrId: d.nextDocPrId(first),
    mark: 'mgl-sign-test2',
    descr: '',
    ext: 'png',
    cx: 700_000,
    cy: 396_000,
    fill: {},
  });
  assert.deepEqual(res.removed, []);
  const after = d.findSignatureSlots(d.parseTables(res.xml));
  assert.deepEqual(after.map((s) => s.mark).sort(), ['mgl-sign-test1', 'mgl-sign-test2']);
});

test('stampDocumentXml: «exact» өндөртэй мөр → «atLeast» (зураг тайрагдахгүй)', () => {
  const xml = doc(evgrTable());
  const { slot, res } = stampFirst(xml, (s) => s.approver);
  const rowXml = res.xml.slice(slot.rowSpan.start, slot.rowSpan.end + 4000);
  assert.match(rowXml, /<w:trHeight w:val="500" w:hRule="atLeast"\/>/);
});

test('stampDocumentXml (мөрөн дотор): шошгоны доор шинэ догол мөр, хоосон нэр бөглөгдөнө', () => {
  const xml = doc(inlineTable());
  const { slot, res } = stampFirst(xml, (s) => !s.approver, { name: 'Т.Тест' });
  assert.deepEqual(res.filled, [{ field: 'name', text: 'Т.Тест' }]);
  const after = d.findSignatureSlots(d.parseTables(res.xml)).find((s) => s.key === slot.key)!;
  assert.equal(after.state, 'erp');
  const box = res.xml.slice(after.box.start, after.box.end);
  assert.match(box, /Signature\/ Гарын үсэг<\/w:t><\/w:r><\/w:p><w:p><w:pPr>/);
});

test('stampDocumentXml: дүүрсэн нүд рүү суулгахыг хориглоно', () => {
  const ours = '<w:r><w:drawing><wp:inline><wp:docPr id="31" name="mgl-sign-abc" descr="x"/></wp:inline></w:drawing></w:r>';
  const xml = doc(
    table([1500, 1500, 1500], [
      row([{ text: 'Албан тушаал' }, { text: 'Гарын үсэг' }, { text: 'Огноо' }]),
      row([{ text: 'Захирал' }, { drawing: ours }, {}]),
    ]),
  );
  const slots = d.findSignatureSlots(d.parseTables(xml));
  assert.throws(() =>
    d.stampDocumentXml(xml, slots, {
      slot: slots[0]!,
      rid: 'r',
      docPrId: 1,
      mark: 'mgl-sign-x',
      descr: '',
      ext: 'png',
      cx: 1,
      cy: 1,
      fill: {},
    }),
  );
});

test('nextDocPrId: хамгийн их id + 1', () => {
  assert.equal(d.nextDocPrId('<wp:docPr id="3" name="a"/><wp:docPr id="21" name="b"/>'), 22);
  assert.equal(d.nextDocPrId('<w:body/>'), 1);
});

/* ------------------------------------------------------------------ */
/*  CR загвар (MGL-WT-CR-002, 2026-10-12)                               */
/* ------------------------------------------------------------------ */

test('findSignatureSlots (CR): «(Sign)», «(Perpared by)» тайлбартай толгой багана болж танигдана, толгой нүд хайрцаг биш', () => {
  const slots = d.findSignatureSlots(d.parseTables(doc(crTable())));
  assert.deepEqual(
    slots.map((s) => [s.key, s.pattern, s.position, s.name, s.date, s.approver, s.client]),
    [
      ['t0r2c9', 'column', 'Бүтээцийн инженер', 'Д.Далайбуян', '2026/10/09', false, false],
      ['t0r3c9', 'column', 'Төслийн менежер', 'М.Монголжин', '2026/10/09', false, false],
      ['t0r4c9', 'column', 'Захирал', 'Б.Билгүүн', '2026/10/09', true, false],
      ['t0r6c5', 'column', '', '', '', false, true],
    ],
  );
  for (const s of slots) {
    assert.equal(s.box.text, '', `${s.key}: хайрцаг хоосон нүд (толгойн «Гарын үсэг: (Sign)» биш)`);
    assert.equal(s.box.darkFill, false);
  }
  assert.equal(slots[0]!.role, 'Хариу илгээсэн: (Replied by)');
  assert.equal(slots[1]!.role, 'Хариу илгээсэн: (Replied by)', 'vMerge-ийн доорх мөр үүргийг өвлөнө');
  assert.equal(slots[2]!.role, 'Хянасан (Approved by:)');
  assert.equal(slots[3]!.role, 'Захиалагчаас баталасан: (Approved by client)');
  assert.notEqual(slots[3]!.group, slots[0]!.group, 'захиалагчийн блок тусдаа бүлэг');
  // Хар-хөх толгой нүд танигдана.
  const head = d.parseTables(doc(crTable()))[0]!.rows[1]!.cells[4]!;
  assert.equal(head.text, 'Гарын үсэг: (Sign)');
  assert.equal(head.darkFill, true);
});

test('findSignatureSlots: ойлгогдоогүй баганын толгой нь мөрөн дотрох хайрцаг болж ХЭЗЭЭ Ч унахгүй', () => {
  // «Гарын үсэг ба тамга» цэвэр шошго биш тул багана хэлбэр танигдахгүй; үүрэг ба гарын
  // үсгийн хооронд «Албан тушаал» толгой байгаа тул энэ нь баганын толгой мөр — 0 мөр.
  const xml = doc(
    table([1500, 1500, 1500, 1500], [
      row([{ text: 'Хариу илгээсэн: (Replied by)' }, { text: 'Албан тушаал: (Position)' }, { text: 'Гарын үсэг ба тамга' }, { text: 'Огноо: (Date)' }]),
      row([{}, { text: 'Архитектор' }, {}, { text: '2026.10.12' }]),
    ]),
  );
  assert.deepEqual(d.findSignatureSlots(d.parseTables(xml)), []);
  // Зөвлөхийн мөрөн дотрох маягт хэвээр танигдана (хоосон «Name/ Нэр» тайлбар хориглохгүй).
  assert.equal(d.findSignatureSlots(d.parseTables(doc(inlineTable()))).length, 2);
});

test('findSignatureSlots: бараан дүүргэлттэй мөрөн дотрох шошго хайрцаг болохгүй', () => {
  const xml = doc(
    table([1600, 1600, 1600], [
      row([{ text: 'Prepared by: Бэлтгэсэн:' }, { text: 'Э.Цогтбат' }, { text: 'Signature/ Гарын үсэг', fill: '1F3864' }]),
    ]),
  );
  assert.deepEqual(d.findSignatureSlots(d.parseTables(xml)), []);
  // Цайвар дүүргэлт (саарал) хэвээр хайрцаг.
  const light = doc(
    table([1600, 1600, 1600], [
      row([{ text: 'Prepared by: Бэлтгэсэн:' }, { text: 'Э.Цогтбат' }, { text: 'Signature/ Гарын үсэг', fill: 'D9D9D9' }]),
    ]),
  );
  assert.equal(d.findSignatureSlots(d.parseTables(light)).length, 1);
});

test('stampDocumentXml (CR): толгойд буруу суусан манай гарын үсэг (Google тэмдгийг устгасан ч) устна, гарын үсэг өөрийн мөрөнд', () => {
  // 2026-10-12-ний бодит байдал: өмнөх хувилбар толгой нүдэнд ШИНЭ догол мөр нэмж зурсан,
  // дараа нь Google дахин хадгалж docPr-ийн нэрийг «image2.png» болгосон, хоосон run нэмсэн.
  const headExtraP =
    '<w:p w:rsidR="00000000" w14:paraId="000000B0"><w:pPr><w:spacing w:after="40" w:before="40" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:color w:val="ffffff"/></w:rPr></w:pPr>' +
    `${GOOGLE_RESAVED_STAMP}<w:r><w:rPr><w:color w:val="FFFFFF"/><w:rtl w:val="0"/></w:rPr></w:r></w:p>`;
  const xml = doc(crTable({ headExtraP }));
  const before = d.findSignatureSlots(d.parseTables(xml));
  assert.equal(before.length, 4);
  assert.ok(before.every((s) => s.state === 'empty'), 'толгой дахь буруу зураг ямар ч мөрийг «зурагдсан» болгохгүй');

  const { slot, res } = stampFirst(xml, (s) => s.name === 'М.Монголжин');
  assert.deepEqual(res.removed, ['image2.png']);
  const tables = d.parseTables(res.xml);
  const head = tables[0]!.rows[1]!.cells[4]!;
  assert.equal(head.hasDrawing, false, 'толгой нүдэнд зураг үлдээгүй');
  assert.equal(head.text, 'Гарын үсэг: (Sign)', 'толгойн бичвэр хэвээр');
  const headXml = res.xml.slice(head.start, head.end);
  assert.equal(headXml.match(/<w:p[\s>]/g)?.length, 1, 'бидний нэмсэн хоосон догол мөр ч арилсан');
  const after = d.findSignatureSlots(tables);
  const mine = after.find((s) => s.key === slot.key)!;
  assert.equal(mine.key, 't0r3c9');
  assert.equal(mine.state, 'erp');
  assert.equal(mine.mark, 'mgl-sign-test1');
  assert.deepEqual(
    after.filter((s) => s.state !== 'empty').map((s) => s.key),
    ['t0r3c9'],
  );

  // Хүний оруулсан (тэмдэг ч, ERP descr ч үгүй) толгойн зураг хөндөгдөхгүй.
  const manual = '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="7" name="Logo"/></wp:inline></w:drawing></w:r></w:p>';
  const r2 = stampFirst(doc(crTable({ headExtraP: manual })), (s) => s.name === 'М.Монголжин').res;
  assert.deepEqual(r2.removed, []);
  assert.equal(r2.xml.split('name="Logo"').length - 1, 1);
});

test('findSignatureSlots: Google тэмдгийг устгасан ERP гарын үсэг = erp (descr-тэй), хүний зураг = other', () => {
  const t = (drawing: string) =>
    doc(
      table([1500, 1500, 1500], [
        row([{ text: 'Албан тушаал' }, { text: 'Гарын үсэг' }, { text: 'Огноо' }]),
        row([{ text: 'Захирал' }, { drawing }, {}]),
      ]),
    );
  const [erp] = d.findSignatureSlots(d.parseTables(t(GOOGLE_RESAVED_STAMP)));
  assert.equal(erp!.state, 'erp');
  assert.equal(erp!.mark, null);
  assert.match(erp!.erpDescr ?? '', /^MGL ERP · Мөнхбат Монголжин/);
  const [other] = d.findSignatureSlots(d.parseTables(t('<w:r><w:drawing><wp:inline><wp:docPr id="3" name="Picture 3" descr="scan"/></wp:inline></w:drawing></w:r>')));
  assert.equal(other!.state, 'other');
  assert.equal(other!.erpDescr, null);
});

test('parseErpDescr: нэр + агшин; бүтэц таарахгүй бол null', () => {
  assert.deepEqual(d.parseErpDescr('MGL ERP · Мөнхбат Монголжин · Төслийн менежер · 2026-10-12T00:36:15.815Z'), {
    name: 'Мөнхбат Монголжин',
    at: '2026-10-12T00:36:15.815Z',
  });
  assert.deepEqual(d.parseErpDescr('MGL ERP · Б.Бат · 2026-10-12T01:00:00.000Z'), { name: 'Б.Бат', at: '2026-10-12T01:00:00.000Z' });
  assert.equal(d.parseErpDescr('MGL ERP · Б.Бат'), null);
  assert.equal(d.parseErpDescr('scan · Б.Бат · 2026-10-12T01:00:00.000Z'), null);
  assert.equal(d.parseErpDescr('MGL ERP · Б.Бат · not-a-date'), null);
});
