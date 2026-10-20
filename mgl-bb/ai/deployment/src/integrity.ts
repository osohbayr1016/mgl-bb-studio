/**
 * MGL AI · ФАЙЛЫН БҮРЭН БҮТЭН БАЙДАЛ (Session B §6, §34).
 *
 * ⚠️ ХЭШИЙГ УРСГАЛААР БОДНО.  5 GB GGUF-ийг `readFile` хийх нь санах ойд
 *    5 GB — ажилтны 16 GB машин дээр Revit нээлттэй байхад тэр нь
 *    хуудаслалт.  `createReadStream` + `hash.update` нь тогтмол санах ой.
 *
 * ⚠️ ХЭШ ТААРАХГҮЙ = ФАЙЛ УСТГАГДАНА, «ашиглах уу?» гэсэн асуулт БАЙХГҮЙ.
 *    `verifyOrDelete` нь тэр дүрмийг нэг газар барина.
 *
 * ⚠️ АТОМ БИЧИЛТ: `writeJsonAtomic` нь `.tmp` → `rename`.  Windows дээр
 *    `rename` нь ижил эзлэхүүн дотор атом; тасарсан бичилт хэзээ ч хагас
 *    JSON үлдээхгүй (тэр нь `installed.json`-ыг эвдэж бүх суулгацыг
 *    «мэдэхгүй» төлөвт оруулах байсан).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve());
  });
  return hash.digest('hex');
}

export type VerifyResult =
  | { ok: true; sha256: string }
  | { ok: false; code: 'SHA_MISMATCH' | 'FILE_MISSING'; expected: string; actual: string | null };

export async function verifyFile(path: string, expectedSha256: string): Promise<VerifyResult> {
  const expected = expectedSha256.toLowerCase();
  let actual: string;
  try {
    actual = await sha256File(path);
  } catch {
    return { ok: false, code: 'FILE_MISSING', expected, actual: null };
  }
  if (actual !== expected) return { ok: false, code: 'SHA_MISMATCH', expected, actual };
  return { ok: true, sha256: actual };
}

/** Таарахгүй бол УСТГАНА — «дараа шалгана» гэсэн зам байхгүй. */
export async function verifyOrDelete(path: string, expectedSha256: string): Promise<VerifyResult> {
  const r = await verifyFile(path, expectedSha256);
  if (!r.ok && r.code === 'SHA_MISMATCH') await rm(path, { force: true });
  return r;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
