/**
 * MGL AI deployment · FIXTURE RUNTIME (P0-1 интеграцийн тест).
 *
 * Бодит runtime-ийн НИЙТИЙН гэрээний хамгийн жижиг хуулбар — `/health`, `/info`,
 * `/deploy/health`, `POST /generate`, `POST /shutdown`.  Загвар, llama-server,
 * VRAM БАЙХГҮЙ: 40 мс-д асна, тестүүд секундээр биш мс-ээр хэмжигдэнэ.
 *
 * Хувилбарын хавтас нь бодит суулгацтай ИЖИЛ бүтэцтэй:
 *   versions/<v>/runtime/src/server.ts   ← энэ файлын хуулбар (супервайзер ЭНД заана)
 *   versions/<v>/package.json            ← `version` = ажиллаж буй код гэж /info хэлнэ
 *   versions/<v>/fixture.json            ← зан төлөв: ok | no_start | wrong_version | health_fail | crash_on_generate
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const fx = JSON.parse(readFileSync(join(root, 'fixture.json'), 'utf8')) as { mode: string; reportVersion?: string | null };
const port = Number(process.env.FAKE_PORT ?? 39250);

if (fx.mode === 'no_start') {
  process.stderr.write('fixture: no_start\n');
  process.exit(1);
}

const running = { runtime: fx.mode === 'wrong_version' && fx.reportVersion ? fx.reportVersion : pkg.version };

const server = createServer((req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const url = req.url ?? '/';
  if (url === '/health') return send(200, { service: 'mgl-ai-runtime', version: pkg.version, ok: true });
  if (url === '/info') return send(200, { service: 'mgl-ai-runtime', runtime_version: pkg.version, deployment: { running, versions: {}, installation_id: 'ins_fixture' } });
  if (url.startsWith('/deploy/health')) {
    return send(200, fx.mode === 'health_fail' ? { status: 'REPAIR_REQUIRED', reasonCodes: ['FIXTURE_HEALTH_FAIL'] } : { status: 'READY', reasonCodes: [] });
  }
  if (url === '/generate' && req.method === 'POST') {
    if (fx.mode === 'crash_on_generate') {
      process.stderr.write('fixture: crash on generate\n');
      setTimeout(() => process.exit(3), 10);
      return;
    }
    return send(200, { text: 'ok' });
  }
  if (url === '/shutdown' && req.method === 'POST') {
    send(200, { ok: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }
  send(404, { error: 'no' });
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
