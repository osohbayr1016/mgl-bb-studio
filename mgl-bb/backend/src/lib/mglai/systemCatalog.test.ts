/**
 * MGL AI · СИСТЕМИЙН КАТАЛОГ — ХУУЧИРСАН ЭСЭХ (§15).
 *
 * Run with:  node --test src/lib/mglai/systemCatalog.test.ts
 *
 * ⚠️ `systemCatalog.generated.ts` нь frontend-ийн NAV_ITEMS + APP_SECTIONS-оос
 *    үүсдэг.  Цэс өөрчлөгдөөд каталог дахин үүсгэгдээгүй бол AI хуучин
 *    хуудсыг «байна» гэж хэлнэ — энэ тест түүнийг барина.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const HERE = dirname(fileURLToPath(import.meta.url));
const { SYSTEM_PAGES } = await import('./systemCatalog.generated.ts');

test('каталог frontend-тэй ижил (gen-system-catalog --check)', () => {
  const r = spawnSync(process.execPath, [resolve(HERE, '../../../scripts/gen-system-catalog.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});

test('каталог: хуудас бүр зам, монгол нэр, рольтой; захиалагчид админы хуудас байхгүй', () => {
  assert.ok(SYSTEM_PAGES.length >= 15, `${SYSTEM_PAGES.length} хуудас`);
  for (const p of SYSTEM_PAGES) {
    assert.ok(p.path.startsWith('/app'), p.path);
    assert.ok(p.labelMn.length > 0 && !p.labelMn.startsWith('nav.'), `${p.path}: орчуулгагүй шошго ${p.labelMn}`);
    assert.ok(p.roles.length > 0, `${p.path}: рольгүй`);
  }
  const client = SYSTEM_PAGES.filter((p) => p.roles.includes('client')).map((p) => p.path);
  assert.ok(!client.includes('/app/users'), 'захиалагч хэрэглэгчийн удирдлагыг харахгүй');
  assert.ok(!client.includes('/app/quotes'), 'захиалагч үнийн саналыг харахгүй');
  assert.ok(client.includes('/app/projects'));
});
