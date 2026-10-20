#!/usr/bin/env node
/**
 * Файлыг байтаар N хэсэгт хуваана: `<name>.split.001`, `.split.002`, …
 *
 *   node scripts/split-file.mjs <файл> <хэсгийн хэмжээ MB> [гаралтын хавтас]
 *
 * ⚠️ ЯАГААД: wrangler нь 300 MiB-ээс том R2 объект байршуулдаггүй, харин
 *    llama.cpp CUDA build-ийн `cublasLt64_12.dll` (473 MB) нь ганцаараа
 *    зипэндээ ч 327 MB.  `installer/bootstrap.ps1`-ийн `Expand-Component`
 *    нь `*.split.NNN` файлуудыг нэрээр нь эрэмбэлж буцааж нийлүүлдэг.
 *    Хэсгүүд нь зип ДОТОР явдаг тул SHA-256 нь зип бүрд, файлын өөрийнх нь
 *    бүрэн бүтэн байдал нь нийлүүлсний дараа llama-server ажиллах эсэхээр
 *    (bootstrap-ийн health алхам) баталгаажна.
 */
import { closeSync, openSync, readSync, writeSync, statSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const [, , file, mbArg, outDir = '.'] = process.argv;
if (!file || !mbArg) {
  console.error('usage: split-file.mjs <file> <partSizeMB> [outDir]');
  process.exit(2);
}
const partSize = Math.floor(Number(mbArg) * 1024 * 1024);
const total = statSync(file).size;
mkdirSync(outDir, { recursive: true });
const fd = openSync(file, 'r');
const buf = Buffer.alloc(8 * 1024 * 1024);
let offset = 0;
let index = 0;
while (offset < total) {
  index++;
  const out = join(outDir, `${basename(file)}.split.${String(index).padStart(3, '0')}`);
  const ofd = openSync(out, 'w');
  let written = 0;
  while (written < partSize && offset < total) {
    const n = readSync(fd, buf, 0, Math.min(buf.length, partSize - written), offset);
    if (n === 0) break;
    writeSync(ofd, buf, 0, n);
    written += n;
    offset += n;
  }
  closeSync(ofd);
  console.log(`${out}  ${written} bytes`);
}
closeSync(fd);
