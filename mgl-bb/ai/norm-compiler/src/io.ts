/** Файл унших туслахууд — хөрвүүлэгч ба тест хоёулаа хэрэглэнэ. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Row = Record<string, unknown>;

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function readJsonl(path: string): Row[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Row);
}

export function has(folder: string, file: string): boolean {
  return existsSync(join(folder, file));
}

export const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
