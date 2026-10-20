/**
 * fetch-r2-inventory — R2 bucket-ийн ИНВЕНТОРЫГ (түлхүүр, хэмжээ, огноо) татаж
 * JSON файлд хадгална.  ЗӨВХӨН УНШИНА.
 *
 *   MGL_TOKEN=<admin JWT> node scripts/cleanup/fetch-r2-inventory.mjs \
 *       [--host=https://mgl-progress-api.mglenc-design.workers.dev] \
 *       [--bucket=media|meeting|both] [--out=<хавтас>]
 *
 * Эх сурвалж нь Worker-ийн `GET /api/storage/inventory` (admin-only,
 * routes/storageAudit.ts) — `wrangler r2 object`-д `list` байдаггүй.  Токеныг
 * `POST /api/auth/login`-оор авч `MGL_TOKEN`-д өгнө (эсвэл `--user=…`
 * `--password=…` — нууц үг терминалын түүхэнд үлдэх тул env-ийг илүүд үз).
 *
 * R2 `list` = Class A үйлдэл, 1 000 объект/хуудас → 15 000 объект ≈ 15 үйлдэл.
 * Гаралт: `<out>/r2-inventory-<bucket>.json` = { bucket, fetchedAt, objects[] }.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, writeJson, fmtBytes } from './lib.mjs';

const { flags } = parseArgs();
const host = String(flags.host ?? 'https://mgl-progress-api.mglenc-design.workers.dev').replace(/\/$/, '');
const which = String(flags.bucket ?? 'both');
const outDir = String(flags.out ?? 'cleanup-out');
mkdirSync(outDir, { recursive: true });

let token = process.env.MGL_TOKEN ?? '';
if (!token && flags.user && flags.password) {
  const r = await fetch(`${host}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: flags.user, password: flags.password }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  token = (await r.json()).token;
}
if (!token) throw new Error('MGL_TOKEN (admin JWT) эсвэл --user/--password хэрэгтэй');

async function fetchBucket(bucket) {
  const objects = [];
  let cursor = null;
  let pages = 0;
  do {
    const url = new URL(`${host}/api/storage/inventory`);
    url.searchParams.set('bucket', bucket);
    if (cursor) url.searchParams.set('cursor', cursor);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`inventory ${bucket} ${r.status}: ${await r.text()}`);
    const j = await r.json();
    objects.push(...j.objects);
    cursor = j.cursor;
    pages++;
    process.stdout.write(`\r${bucket}: ${objects.length} объект (${pages} хуудас)`);
  } while (cursor);
  process.stdout.write('\n');
  const bytes = objects.reduce((s, o) => s + o.size, 0);
  const file = join(outDir, `r2-inventory-${bucket}.json`);
  writeJson(file, { bucket, host, fetchedAt: new Date().toISOString(), objects });
  console.log(`${bucket}: ${objects.length} объект, ${fmtBytes(bytes)} → ${file}`);
}

for (const b of which === 'both' ? ['media', 'meeting'] : [which]) await fetchBucket(b);
