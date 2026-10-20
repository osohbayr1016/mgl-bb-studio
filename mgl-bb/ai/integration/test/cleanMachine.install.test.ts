/**
 * MGL AI · ЦЭВЭР МАШИНЫ ТААМАГЛАЛЫН АУДИТ — INSTALLATION ангилал (Session D §24).
 *
 * Хөгжүүлэгчийн машинаас санамсаргүй хамаарлыг эх кодоос барина:
 *   • абсолют зам / хэрэглэгчийн нэр (`C:\Users\<name>`, `/c/Users/<name>`)
 *   • хуучин хувийн Cloudflare акаунтын нэр (`anandoctane`)
 *   • `npm ci`-д lockfile зөрчил (шинэ машин суулгаж чадахгүй)
 *
 * ⚠️ Зөвхөн ХӨГЖҮҮЛЭЛТИЙН (training) хавтас дахь хатуу замыг WARNING гэж
 *    ангилна — тэр код ажилтны PC-д тархдаггүй.  Runtime, installer,
 *    deployment, backend, frontend дахь нь BLOCKING.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

import { REPO } from '../src/contracts/sources.ts';

const SKIP_DIRS = new Set(['node_modules', '.venv', '.llama.cpp', 'data-train-files', 'dist', 'reports', 'benchmarks', 'baselines', '.git', 'checkpoints']);
const EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.ps1', '.py', '.cmd', '.json', '.toml']);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    // ⚠️ Тестийн fixture (`*.test.ts`, `fixtures.ts`) нь «C:/Users/bat» гэх мэт ЖИШЭЭ зам агуулж болно —
    //    тархдаг код биш (B-ийн health/telemetry тест дээр хэмжсэн худал эерэг).
    else if ([...EXT].some((e) => name.endsWith(e)) && !/\.test\.[cm]?[jt]s$/.test(name) && name !== 'fixtures.ts') yield p;
  }
}

const SHIPPED = [
  join(REPO, 'ai', 'runtime'),
  join(REPO, 'ai', 'retrieval'),
  join(REPO, 'ai', 'deployment'),
  join(REPO, 'ai', 'scripts'),
  join(REPO, 'installer'),
  join(REPO, 'backend', 'src', 'lib', 'mglai'),
  join(REPO, 'backend', 'src', 'routes', 'mglAi.ts'),
  join(REPO, 'frontend', 'src', 'features', 'mgl-ai'),
];
const DEV_ONLY = [join(REPO, 'ai', 'training'), join(REPO, 'ai', 'evaluation'), join(REPO, 'ai', 'norm-compiler')];

const ABS_PATH = /(?:[A-Z]:\\{1,2}Users\\{1,2}|\/c\/Users\/|[A-Z]:\/Users\/)([A-Za-z0-9._-]+)/g;
const OLD_ACCOUNT = /anandoctane/i;

function scan(roots: string[]): { file: string; line: number; hit: string }[] {
  const hits: { file: string; line: number; hit: string }[] = [];
  for (const root of roots) {
    let files: string[];
    try {
      files = statSync(root).isDirectory() ? [...walk(root)] : [root];
    } catch {
      continue; // хараахан merge хийгдээгүй хавтас (ai/deployment)
    }
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((ln, i) => {
        // Тайлбар мөр дэх «жишээ» замыг тоолохгүй — зөвхөн код/өгөгдөл.
        const stripped = ln.replace(/^\s*(\/\/|\*|#|--).*$/, '');
        for (const m of stripped.matchAll(ABS_PATH)) hits.push({ file: relative(REPO, f), line: i + 1, hit: m[0] });
        if (OLD_ACCOUNT.test(stripped)) hits.push({ file: relative(REPO, f), line: i + 1, hit: 'anandoctane (хуучин хувийн акаунт)' });
      });
    }
  }
  return hits;
}

test('ТАРХДАГ код: абсолют хөгжүүлэгчийн зам, хуучин акаунт БАЙХГҮЙ', () => {
  const hits = scan(SHIPPED);
  assert.deepEqual(hits, [], hits.map((h) => `${h.file}:${h.line} ${h.hit}`).join('\n'));
});

test('ХӨГЖҮҮЛЭЛТИЙН код: хатуу зам байвал WARNING (тархдаггүй)', (t) => {
  const hits = scan(DEV_ONLY);
  for (const h of hits) t.diagnostic(`warning ${h.file}:${h.line} ${h.hit}`);
  if (hits.length > 0) console.warn(`  ⚠ ${hits.length} хатуу зам (dev-only): ${hits.map((h) => `${h.file}:${h.line}`).join(', ')}`);
});

for (const pkg of ['ai', 'backend', 'frontend']) {
  test(`${pkg}/: package-lock.json нь package.json-той нийцтэй (npm ci ажиллана)`, { timeout: 120_000 }, () => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    let out = '';
    let code = 0;
    try {
      out = execFileSync(npm, ['ci', '--dry-run', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: join(REPO, pkg),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      code = e.status ?? 1;
      out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    }
    const missing = [...out.matchAll(/Missing: ([^\n]+)/g)].map((m) => m[1]!).slice(0, 5);
    assert.equal(
      code,
      0,
      `${pkg}/: \`npm ci\` шинэ машин дээр УНАНА — lockfile зөрчил${missing.length ? `: ${missing.join('; ')} …` : ''}.  ` +
        'Засвар: тухайн хавтсанд `npm install` ажиллуулж lockfile-ыг коммитлох (эзэн: тухайн package-ийн сүүлд dependency нэмсэн хүн).',
    );
  });
}
