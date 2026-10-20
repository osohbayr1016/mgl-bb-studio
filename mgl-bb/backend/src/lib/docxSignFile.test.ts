// .docx байт дээрх гарын үсэг — ZIP дахин бичигч (`zipPatch.ts`), PNG бэлтгэгч
// (`pngCrop.ts`), бүтэн урсгал (`docxSignFile.ts`).  Бодит Word-оор нээх
// шалгалт (20 RFI, 2026-10-01) нь репогоос гадуур; энд бүтцийн инвариантууд.
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

const zp = await import('./zipPatch.ts');
const zr = await import('./zipRead.ts');
const png = await import('./pngCrop.ts');
const dsf = await import('./docxSignFile.ts');
const ds = await import('./docxSign.ts');

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Хоосон ZIP (зөвхөн EOCD) — `rewriteZip`-ээр бичлэг нэмж туршилтын .docx угсарна. */
function emptyZip(): Uint8Array {
  const z = new Uint8Array(22);
  new DataView(z.buffer).setUint32(0, 0x06054b50, true);
  return z;
}

async function makeZip(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  return zp.rewriteZip(emptyZip(), {
    add: Object.entries(files).map(([name, v]) => ({ name, data: typeof v === 'string' ? enc.encode(v) : v })),
    now: new Date('2026-10-01T00:00:00Z'),
  });
}

/** Бичлэг бүрийн CRC-г төв лавлахтай тулгана (бие даасан шалгагч). */
async function verifyZip(bytes: Uint8Array): Promise<string[]> {
  const names: string[] = [];
  for (const e of zr.listZipEntries(bytes)) {
    const data = await zr.readZipEntry(bytes, e.name);
    assert.ok(data, e.name);
    assert.equal(data.length, e.size, `${e.name} size`);
    names.push(e.name);
  }
  // CRC — төв лавлахаас уншина.
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  let p = v.getUint32(eocd + 16, true);
  for (let i = 0; i < v.getUint16(eocd + 10, true); i++) {
    const crc = v.getUint32(p + 16, true);
    const nameLen = v.getUint16(p + 28, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const data = (await zr.readZipEntry(bytes, name))!;
    assert.equal(zp.crc32(data), crc, `${name} crc`);
    assert.equal(v.getUint16(p + 8, true) & 0x8, 0, `${name}: data descriptor bit cleared`);
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return names;
}

test('crc32: мэдэгдэж буй утгууд', () => {
  assert.equal(zp.crc32(enc.encode('')), 0);
  assert.equal(zp.crc32(enc.encode('123456789')), 0xcbf43926);
});

test('rewriteZip: солих / нэмэх / хасах — өөрчлөгдөөгүй бичлэг шахалтаараа хуулагдана', async () => {
  const src = await makeZip({ 'a.txt': 'alpha '.repeat(200), 'b.txt': 'beta', 'c.txt': 'gamma' });
  assert.deepEqual(await verifyZip(src), ['a.txt', 'b.txt', 'c.txt']);
  const before = zr.listZipEntries(src).find((e) => e.name === 'a.txt')!;
  const out = await zp.rewriteZip(src, {
    replace: new Map([['b.txt', enc.encode('BETA-2')]]),
    add: [{ name: 'd.png', data: new Uint8Array([1, 2, 3]), compress: false }],
    remove: new Set(['c.txt']),
  });
  assert.deepEqual(await verifyZip(out), ['a.txt', 'b.txt', 'd.png']);
  assert.equal(dec.decode((await zr.readZipEntry(out, 'b.txt'))!), 'BETA-2');
  assert.deepEqual([...(await zr.readZipEntry(out, 'd.png'))!], [1, 2, 3]);
  const after = zr.listZipEntries(out).find((e) => e.name === 'a.txt')!;
  assert.equal(after.compressedSize, before.compressedSize, 'a.txt дахин шахагдаагүй');
  await assert.rejects(zp.rewriteZip(src, { replace: new Map([['zzz', enc.encode('x')]]) }));
  await assert.rejects(zp.rewriteZip(src, { add: [{ name: 'a.txt', data: enc.encode('x') }] }));
});

/* ------------------------------------------------------------------ */
/*  PNG                                                                 */
/* ------------------------------------------------------------------ */

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  void w.write(data);
  void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, zp.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGB 8 бит, мөр бүр өөр шүүлтүүртэй (Sub/Up/Avg/Paeth-ийг шалгана). */
async function makeRgbPng(w: number, h: number, ink: (x: number, y: number) => boolean): Promise<Uint8Array> {
  const stride = w * 3;
  const plain: Uint8Array[] = [];
  for (let y = 0; y < h; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < w; x++) {
      const v = ink(x, y) ? 20 : 255;
      row.set([v, v, v], x * 3);
    }
    plain.push(row);
  }
  const raw = new Uint8Array(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    const ft = y % 5;
    raw[y * (1 + stride)] = ft;
    const cur = plain[y]!;
    const prev = y > 0 ? plain[y - 1]! : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? cur[i - 3]! : 0;
      const b = prev[i]!;
      const c = i >= 3 ? prev[i - 3]! : 0;
      let pred = 0;
      if (ft === 1) pred = a;
      else if (ft === 2) pred = b;
      else if (ft === 3) pred = (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (1 + stride) + 1 + i] = (cur[i]! - pred) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', await zlib(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

test('prepareSignaturePng: бэхний хүрээгээр (+3 px) тайрч, цаасыг тунгалаг болгоно', async () => {
  // 80×60 цагаан, 30..39 × 20..24 хэсэгт бэх.
  const src = await makeRgbPng(80, 60, (x, y) => x >= 30 && x < 40 && y >= 20 && y < 25);
  const r = await png.prepareSignaturePng(src);
  assert.ok(r);
  assert.equal(r.cropped, true);
  assert.equal(r.width, 16);
  assert.equal(r.height, 11);
  assert.deepEqual(ds.imageInfo(r.bytes), { ext: 'png', width: 16, height: 11 });
  // Үр дүнг дахин задлахад: булан (цаас) тунгалаг, төв (бэх) бүдэг биш.
  const again = await png.prepareSignaturePng(r.bytes);
  assert.ok(again);
  assert.equal(again.cropped, false, 'дахин тайрах зүйлгүй');
});

test('prepareSignaturePng: бэх бараг бүтэн зураг бол тайрахгүй, бэхгүй/PNG биш бол null', async () => {
  const full = await makeRgbPng(10, 10, () => true);
  const r = await png.prepareSignaturePng(full);
  assert.ok(r);
  assert.equal(r.cropped, false);
  assert.equal(r.width, 10);
  assert.equal(await png.prepareSignaturePng(await makeRgbPng(10, 10, () => false)), null);
  assert.equal(await png.prepareSignaturePng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), null);
});

/* ------------------------------------------------------------------ */
/*  Бүтэн урсгал                                                        */
/* ------------------------------------------------------------------ */

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/><w:gridCol w:w="2000"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Албан тушаал</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Овог нэр</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Гарын үсэг (Signature)</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Огноо</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Архитектор</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Б.Эрдэнэжин</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>26.10.01</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Захирал</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Б.Билгүүн</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`;
const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

test('stampDocx: нүдэнд зураг + медиа + rels + content type; дахин уншихад erp; огноо хүснэгтийн хэлбэрээр', async () => {
  const docx = await makeZip({ '[Content_Types].xml': CT, 'word/document.xml': DOCUMENT, 'word/_rels/document.xml.rels': RELS });
  const a = await dsf.analyzeDocx(docx);
  assert.ok(a.ok);
  assert.equal(a.slots.length, 2);
  const director = a.slots.find((s) => s.approver)!;
  const sig = (await png.prepareSignaturePng(await makeRgbPng(60, 30, (x, y) => x > 5 && x < 50 && y > 8 && y < 20)))!;
  const r = await dsf.stampDocx(docx, {
    slotKey: director.key,
    image: { bytes: sig.bytes, info: ds.imageInfo(sig.bytes)! },
    mark: 'mgl-sign-unit01',
    descr: 'MGL ERP · Б.Билгүүн',
    fill: { name: 'Б.Билгүүн', position: 'Захирал', ymd: '2026-10-01' },
  });
  assert.ok(r.ok);
  assert.deepEqual(r.filled, [{ field: 'date', text: '26.10.01' }], 'нэр/албан тушаал аль хэдийн бий; огноо YY.MM.DD');
  const names = await verifyZip(r.bytes);
  assert.ok(names.includes('word/media/mgl-sign-unit01.png'));
  const rels = dec.decode((await zr.readZipEntry(r.bytes, 'word/_rels/document.xml.rels'))!);
  assert.match(rels, /Target="media\/mgl-sign-unit01.png"/);
  const ct = dec.decode((await zr.readZipEntry(r.bytes, '[Content_Types].xml'))!);
  assert.match(ct, /Extension="png"/);
  const xml = dec.decode((await zr.readZipEntry(r.bytes, 'word/document.xml'))!);
  assert.match(xml, /xmlns:wp=/, 'wp namespace нэмэгдсэн');
  const after = await dsf.analyzeDocx(r.bytes);
  assert.ok(after.ok);
  assert.equal(after.slots.find((s) => s.key === director.key)!.state, 'erp');
  assert.equal(after.slots.find((s) => !s.approver)!.state, 'empty');

  // Дүүрсэн нүд рүү дахин → SLOT_NOT_EMPTY, байхгүй түлхүүр → SLOT_NOT_FOUND, Word биш → NOT_DOCX.
  const again = await dsf.stampDocx(r.bytes, {
    slotKey: director.key,
    image: { bytes: sig.bytes, info: ds.imageInfo(sig.bytes)! },
    mark: 'mgl-sign-unit02',
    descr: '',
    fill: {},
  });
  assert.deepEqual(again, { ok: false, reason: 'SLOT_NOT_EMPTY' });
  const missing = await dsf.stampDocx(r.bytes, {
    slotKey: 't9r9c9',
    image: { bytes: sig.bytes, info: ds.imageInfo(sig.bytes)! },
    mark: 'mgl-sign-unit03',
    descr: '',
    fill: {},
  });
  assert.deepEqual(missing, { ok: false, reason: 'SLOT_NOT_FOUND' });
  assert.deepEqual(await dsf.analyzeDocx(enc.encode('not a zip')), { ok: false, reason: 'NOT_DOCX' });
});
