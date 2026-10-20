/**
 * MGL AI · HEALTH / ДИАГНОСТИК CLI (Session B §11, §30, §32).
 *
 *   node deployment/bin/health.ts                хөнгөн тайлан (JSON)
 *   node deployment/bin/health.ts --full         + загвар ачаалж 8 токен үүсгэнэ (эхний ажиллуулалт / repair)
 *   node deployment/bin/health.ts --diagnostics  диагностикийн багц → diagnostics/<огноо>.json
 *
 * Runtime-ийн НИЙТИЙН `/deploy/*` гарцаар ажиллана (суулгацын нууц `secret.txt`-ээс),
 * тиймээс bootstrap.ps1 / repair нь `Invoke-WebRequest`-ийн оронд үүнийг дуудаж
 * ижил тайлан авна.  Exit код: 0 READY/DEGRADED · 2 REPAIR_REQUIRED · 3 runtime алга.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveLayout, ensureLayout } from '../src/layout.ts';
import { applyInstallEnv } from '../src/installEnv.ts';

applyInstallEnv();
const layout = resolveLayout();
await ensureLayout(layout);
const port = Number(process.env.MGLAI_PORT ?? 39217);
const base = `http://127.0.0.1:${port}`;
const arg = process.argv.slice(2).find((a) => a.startsWith('--') && a !== '--data-dir') ?? '';

let secret = '';
try {
  secret = (await readFile(join(layout.root, 'secret.txt'), 'utf8')).trim();
} catch {
  /* нууцгүй — runtime асаагүй байж болно */
}
const headers = { 'x-mglai-secret': secret };

async function get(path: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

if (arg === '--diagnostics') {
  const r = await get('/deploy/diagnostics', 30_000);
  if (r.status === 0) {
    process.stderr.write('runtime ажиллахгүй байна — диагностик авах боломжгүй (логуудыг гараар хавсаргана уу).\n');
    process.exit(3);
  }
  const file = join(layout.diagnostics, `mgl-ai-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(r.body, null, 2), 'utf8');
  process.stdout.write(`${file}\n`);
  process.exit(r.status === 200 ? 0 : 2);
}

const full = arg === '--full';
const r = await get(`/deploy/health${full ? '?full=1' : ''}`, full ? 180_000 : 30_000);
if (r.status === 0) {
  process.stdout.write(JSON.stringify({ status: 'REPAIR_REQUIRED', reasonCodes: ['RUNTIME_NOT_RUNNING'] }) + '\n');
  process.exit(3);
}
process.stdout.write(`${JSON.stringify(r.body)}\n`);
const status = (r.body as { status?: string } | null)?.status;
process.exit(status === 'READY' || status === 'DEGRADED' || status === 'UPDATING' ? 0 : 2);
