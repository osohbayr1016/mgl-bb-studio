import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalize(value[k])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function sha256Value(value) {
  return sha256Text(canonicalJson(value));
}

export function sha256File(file) {
  if (!file || !fs.existsSync(file)) return null;
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function repoRoot(importMetaUrl) {
  const here = path.dirname(new URL(importMetaUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  return path.resolve(here, '..', '..', '..', '..');
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
