/**
 * MGL AI · СУУЛГАЦЫН ОРЧИН (bootstrap.ps1 → `state/runtime-env.json`).
 *
 * Task Scheduler-ийн даалгаварт машины орчны хувьсагч байдаггүй; суулгацын үед
 * сонгосон порт / өгөгдлийн хавтас / echo хөдөлгүүрийг bootstrap энэ файлд бичиж,
 * `bin/supervise.ts` · `bin/health.ts` · `bin/update.ts` гурвуулаа ЭНД уншина.
 *
 *   давуу эрх: --data-dir <зам> (аргумент) > MGLAI_DATA_DIR (орчин) > өгөгдмөл root
 *   дараа нь: <root>/state/runtime-env.json-ийн MGLAI_* түлхүүрүүд (орчинд байхгүй бол)
 *
 * ⚠️ Зөвхөн `MGLAI_*` түлхүүр — дурын орчин тарихгүй.  Файл байхгүй = өгөгдмөл суулгац.
 * ⚠️ `--data-dir`-ийг bootstrap нь ЗӨВХӨН custom root (acceptance harness) үед дамжуулна;
 *    ажилтны суулгац өгөгдмөл root тул аргументгүй.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveLayout } from './layout.ts';

export function applyInstallEnv(argv: readonly string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const i = argv.indexOf('--data-dir');
  if (i >= 0 && argv[i + 1]) env.MGLAI_DATA_DIR = argv[i + 1];
  const root = env.MGLAI_DATA_DIR ?? resolveLayout().root;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(join(root, 'state', 'runtime-env.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
  const applied: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^MGLAI_[A-Z_]+$/.test(k) || typeof v !== 'string') continue;
    if (env[k] === undefined) env[k] = v;
    applied[k] = env[k]!;
  }
  return applied;
}
