/**
 * ЗОХИОГЧИЙН ХЯНАЛТЫН ЗУРГИЙН АВТОМАТ ТЭМДГИЙН ШАЛГАЛТ.
 *
 *   node scripts/check-asr-photo-stamp.mjs        (frontend/ хавтаснаас)
 *
 * `shared/lib/exifDate.ts` (EXIF DateTimeOriginal задлагч) ба
 * `features/projects/asr/photoStamp.ts` (огноо + төслийн тэмдгийн бичвэр)
 * хоёр ЦЭВЭР модуль — `check-quote-notes.mjs`-ийн жишгээр Node дээр шууд
 * ачаалж шалгана.  Хоёулаа ХЭВЛЭГДЭХ баримтын бичвэрийг тодорхойлдог тул
 * регресс нь чимээгүй: зураг хэвийн харагдсаар атлаа буруу огноо гарна.
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : SRC;
      const asFile = join(base, `${specifier}.ts`);
      if (existsSync(asFile)) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(`${specifier}/index.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const E = await import(pathToFileURL(join(SRC, 'shared', 'lib', 'exifDate.ts')).href);
const P = await import(
  pathToFileURL(join(SRC, 'features', 'projects', 'asr', 'photoStamp.ts')).href
);

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  Синтетик JPEG + EXIF үүсгэгч                                        */
/* ------------------------------------------------------------------ */

/**
 * SOI + APP1(Exif) + EOI.  TIFF: IFD0 = {0x0132 DateTime, 0x8769 ExifIFD},
 * ExifIFD = {0x9003 DateTimeOriginal}.  Хоёр байт дарааллыг хоёуланг гаргана.
 */
function jpegWithExif({ original, ifd0DateTime, littleEndian = true, dropOriginal = false }) {
  const le = littleEndian;
  const bytes = [];
  const u16 = (v) => (le ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v) =>
    le
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]
      : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

  // TIFF блок (offset нь TIFF толгойноос)
  const tiff = [];
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(0x2a), ...u32(8));
  // IFD0 @8: 2 entry → 8 + 2 + 24 + 4 = 38 → ExifIFD @38
  const ifd0Entries = 2;
  const exifIfdAt = 8 + 2 + ifd0Entries * 12 + 4;
  const exifEntries = dropOriginal ? 0 : 1;
  const dataAt = exifIfdAt + 2 + exifEntries * 12 + 4;
  const dtAt = dataAt; // IFD0 DateTime мөр
  const dtoAt = dataAt + 20; // DateTimeOriginal мөр
  tiff.push(...u16(ifd0Entries));
  tiff.push(...u16(0x0132), ...u16(2), ...u32(20), ...u32(dtAt));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfdAt));
  tiff.push(...u32(0));
  assert.equal(tiff.length, exifIfdAt);
  tiff.push(...u16(exifEntries));
  if (!dropOriginal) tiff.push(...u16(0x9003), ...u16(2), ...u32(20), ...u32(dtoAt));
  tiff.push(...u32(0));
  assert.equal(tiff.length, dataAt);
  tiff.push(...ascii(ifd0DateTime.padEnd(19, ' ')), 0);
  tiff.push(...ascii((original ?? '').padEnd(19, ' ')), 0);

  const app1 = [...ascii('Exif'), 0, 0, ...tiff];
  const len = app1.length + 2;
  bytes.push(0xff, 0xd8);
  bytes.push(0xff, 0xe1, len >> 8, len & 0xff, ...app1);
  // Дундаа өөр сегмент ч байсан парсер зогсохгүй — DQT-ийн дүр.
  bytes.push(0xff, 0xdb, 0x00, 0x04, 0x00, 0x00);
  bytes.push(0xff, 0xda, 0x00, 0x02); // SOS — үүнээс цааш уншихгүй
  bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes);
}

console.log('exifDate.ts');

check('DateTimeOriginal (little-endian) уншина', () => {
  const b = jpegWithExif({ original: '2026:09:21 14:35:09', ifd0DateTime: '2026:09:22 08:00:00' });
  assert.equal(E.parseExifTakenAt(b), '2026-09-21T14:35:09');
});

check('DateTimeOriginal (big-endian) уншина', () => {
  const b = jpegWithExif({
    original: '2026:03:05 07:01:59',
    ifd0DateTime: '2026:03:06 00:00:00',
    littleEndian: false,
  });
  assert.equal(E.parseExifTakenAt(b), '2026-03-05T07:01:59');
});

check('DateTimeOriginal алга → IFD0 DateTime руу унана', () => {
  const b = jpegWithExif({ ifd0DateTime: '2025:12:31 23:59:00', dropOriginal: true });
  assert.equal(E.parseExifTakenAt(b), '2025-12-31T23:59:00');
});

check('ArrayBuffer ч, Uint8Array ч авна', () => {
  const b = jpegWithExif({ original: '2026:09:21 14:35:09', ifd0DateTime: '2026:09:21 14:35:09' });
  assert.equal(E.parseExifTakenAt(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), '2026-09-21T14:35:09');
});

check('тохируулаагүй камерын огноо (2000, 1970) хаягдана → null', () => {
  const b = jpegWithExif({ original: '2000:01:01 00:00:00', ifd0DateTime: '1970:01:01 00:00:00' });
  assert.equal(E.parseExifTakenAt(b), null);
});

check('ирээдүйн огноо хаягдана', () => {
  assert.equal(E.normalizeTakenAt('2099-01-01T00:00'), null);
  assert.equal(E.normalizeTakenAt('2026-09-21T14:35', new Date(2026, 8, 21, 15)), '2026-09-21T14:35');
});

check('JPEG биш / EXIF-гүй / эвдэрсэн байт → null, шидэхгүй', () => {
  assert.equal(E.parseExifTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null); // PNG
  assert.equal(E.parseExifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0, 0, 0xff, 0xd9])), null);
  assert.equal(E.parseExifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45, 0x78])), null);
  assert.equal(E.parseExifTakenAt(new Uint8Array(0)), null);
  // Урт нь файлаас хальсан APP1 — offset-ууд гадагш заана
  const b = jpegWithExif({ original: '2026:09:21 14:35:09', ifd0DateTime: '2026:09:21 14:35:09' });
  assert.equal(E.parseExifTakenAt(b.slice(0, 40)), null);
});

check('normalizeTakenAt хэлбэрийг хатуу шалгана', () => {
  assert.equal(E.normalizeTakenAt('2026-09-21 14:35'), null);
  assert.equal(E.normalizeTakenAt('2026-13-21T14:35'), null);
  assert.equal(E.normalizeTakenAt('2026-09-21T24:00'), null);
  assert.equal(E.normalizeTakenAt(42), null);
  assert.equal(E.normalizeTakenAt('2026-09-21T14:35:60'), null);
  assert.equal(E.normalizeTakenAt('2026-09-21T14:35:6'), null);
  // Секунд сонголттой: хуучин (2026-09-25-аас өмнөх) утга хүчинтэй хэвээр.
  assert.equal(E.normalizeTakenAt('2026-09-21T14:35:07', new Date(2026, 8, 22)), '2026-09-21T14:35:07');
  assert.equal(E.normalizeTakenAt('2026-09-21T14:35', new Date(2026, 8, 22)), '2026-09-21T14:35');
});

check('localTakenAt локал цагаар форматлана', () => {
  assert.equal(E.localTakenAt(new Date(2026, 8, 3, 7, 5, 4)), '2026-09-03T07:05:04');
  assert.equal(E.localTakenAt(new Date(NaN)), null);
});

console.log('photoStamp.ts');

check('taken_at байвал огноо + цаг:минут:секунд, төслийн НЭР', () => {
  const s = P.photoStamp(
    { reportDate: '2026-09-20', shifr: 'MEC-25-21', projectName: 'Хүй долоон худаг', seq: 12 },
    { url: '/media/x.jpg', name: 'x.jpg', taken_at: '2026-09-21T14:35:09' },
  );
  assert.deepEqual(s, { when: '2026.09.21 14:35:09', project: 'Хүй долоон худаг' });
  assert.equal(P.photoStampLine(s), '2026.09.21 14:35:09 · Хүй долоон худаг');
});

check('секундгүй ХУУЧИН taken_at → цаг:минут', () => {
  const s = P.photoStamp(
    { reportDate: '2026-09-20', shifr: 'MEC-25-21', projectName: 'X', seq: 12 },
    { url: '/media/x.jpg', name: 'x.jpg', taken_at: '2026-09-21T14:35' },
  );
  assert.deepEqual(s, { when: '2026.09.21 14:35', project: 'X' });
});

check('ХУУЧИН зураг (taken_at алга) → тайлангийн огноо, цаггүй', () => {
  const s = P.photoStamp(
    { reportDate: '2026-09-20', shifr: 'MEC-25-21', projectName: 'X', seq: null },
    { url: '/media/x.jpg', name: 'x.jpg' },
  );
  assert.deepEqual(s, { when: '2026.09.20', project: 'X' });
});

check('төслийн нэргүй → шифр нөөц', () => {
  const s = P.photoStamp(
    { reportDate: '2026-09-20', shifr: 'MEC-25-21', projectName: '  ', seq: null },
    { url: '/media/x.jpg', name: 'x.jpg', taken_at: null },
  );
  assert.deepEqual(s, { when: '2026.09.20', project: 'MEC-25-21' });
});

check('юу ч мэдэгдэхгүй → хоосон мөрүүд (давхарга гарахгүй)', () => {
  const s = P.photoStamp(
    { reportDate: null, shifr: null, projectName: null, seq: null },
    { url: '/media/x.jpg', name: 'x.jpg' },
  );
  assert.deepEqual(s, { when: '', project: '' });
  assert.equal(P.photoStampLine(s), '');
});

check('formatTakenAt / asrDocNoOf', () => {
  assert.equal(P.formatTakenAt('2026-09-21T14:35'), '2026.09.21 14:35');
  assert.equal(P.formatTakenAt('2026-09-21T14:35:09'), '2026.09.21 14:35:09');
  assert.equal(P.formatTakenAt('2026-09-21'), '2026.09.21');
  assert.equal(P.formatTakenAt('garbage'), '');
  assert.equal(P.formatTakenAt(undefined), '');
  // Товчлол 2026-09-28-наас DASR (миграц 0355, `lib/asrNo.ts` formatAsrDocNo ихэр).
  assert.equal(P.asrDocNoOf(7), 'DASR-007');
  assert.equal(P.asrDocNoOf(null), '');
});

console.log(`\n${passed} шалгалт амжилттай.`);
