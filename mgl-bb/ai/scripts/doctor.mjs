#!/usr/bin/env node
/**
 * `npm run ai:doctor` — ЭНЭ МАШИН MGL AI-Г АЖИЛЛУУЛЖ ЧАДАХ УУ.
 *
 * ⚠️ ХЭМЖИНЭ, ТААМАГЛАХГҮЙ.  Ажилтны 40 машин ижил биш — «RTX 3070 байгаа
 *    гэж үзье» гэсэн таамаг нь GPU-гүй машин дээр чимээгүй унана.
 *
 * ⚠️ ЭНЭ СКРИПТ ЮУ Ч ТАТАХГҮЙ, ЮУ Ч ӨӨРЧЛӨХГҮЙ.  Зөвхөн уншиж, тайлагнана.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { detectHardware, planVariant } from '../runtime/src/hardware.ts';
import { loadConfig, serverBinaryName, RUNTIME_VERSION } from '../runtime/src/config.ts';
import { ModelManager } from '../runtime/src/modelManager.ts';

const OK = '✔';
const WARN = '!';
const BAD = '✖';

function line(mark, label, detail) {
  process.stdout.write(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

const cfg = loadConfig();
const hw = await detectHardware();
const plan = planVariant(hw);

process.stdout.write(`\nMGL AI · оношилгоо (runtime ${RUNTIME_VERSION})\n\n`);

process.stdout.write('Төхөөрөмж\n');
line(OK, 'CPU', `${hw.cpu} · ${hw.cpuCores} thread`);
line(hw.ramMb >= 16000 ? OK : hw.ramMb >= 8000 ? WARN : BAD, 'RAM', `${hw.ramMb} MB (сул ${hw.freeRamMb} MB)`);
if (hw.gpu === null) {
  // ⚠️ «Илрээгүй» нь «байхгүй» гэсэн үг БИШ — nvidia-smi байхгүй байж болно.
  line(WARN, 'GPU', 'NVIDIA GPU илрээгүй (nvidia-smi олдсонгүй). CPU дээр ажиллана.');
} else {
  line(hw.vramMb >= 6000 ? OK : WARN, 'GPU', `${hw.gpu} · ${hw.vramMb} MB VRAM · CUDA ${hw.cuda ?? '?'}`);
}

process.stdout.write('\nТөлөвлөгөө\n');
line(plan.viable ? OK : BAD, plan.runtimeVariant, plan.reason);
line(OK, 'контекст', `${plan.contextTokens} токен`);
line(OK, 'GPU давхарга', plan.gpuLayers === -1 ? 'бүгд' : String(plan.gpuLayers));

process.stdout.write('\nСуулгац\n');
line(existsSync(cfg.dataDir) ? OK : WARN, 'өгөгдлийн хавтас', cfg.dataDir);
line(existsSync(cfg.secretFile) ? OK : WARN, 'суулгацын нууц', existsSync(cfg.secretFile) ? 'бий' : 'сервер эхлэхэд үүснэ');

const binPath = join(cfg.binDir, serverBinaryName());
line(
  existsSync(binPath) ? OK : WARN,
  'llama-server',
  existsSync(binPath) ? binPath : 'олдсонгүй — «npm run ai:setup» ажиллуулна уу',
);

const manager = new ModelManager({
  modelsDir: cfg.modelsDir,
  stateFile: cfg.stateFile,
  controlPlane: cfg.controlPlaneUrl,
});
const state = await manager.reconcile();
const active = await manager.activeModel();

if (state.installed.length === 0) {
  line(WARN, 'загвар', 'нэг ч суулгаагүй — MGL AI нь ХАЙЛТЫН горимд ажиллана');
} else {
  for (const m of state.installed) {
    const mark = m.releaseUid === state.active ? OK : ' ';
    const mb = Math.round(m.bytes / 1024 / 1024);
    line(mark, m.version, `${m.runtimeVariant} · ${m.quantization ?? '?'} · ${mb} MB`);
  }
}
line(active ? OK : WARN, 'идэвхтэй загвар', active ? active.version : 'байхгүй');
line(state.previous ? OK : ' ', 'буцах хувилбар', state.previous ?? 'байхгүй');

process.stdout.write('\nХяналтын хавтгай\n');
line(OK, 'хаяг', cfg.controlPlaneUrl);
try {
  const res = await fetch(`${cfg.controlPlaneUrl}/api/mgl-ai/health`, {
    signal: AbortSignal.timeout(6000),
  });
  // 401 нь ЭРҮҮЛ хариу: сервер ажиллаж байна, зүгээр л токен алга.
  line(res.status === 401 || res.ok ? OK : WARN, 'холболт', `HTTP ${res.status}`);
} catch (err) {
  // ⚠️ Node-ийн fetch нь AAAA бичлэгийг эхэлж оролддог.  Эвдэрсэн IPv6-тай
  //    машин дээр (ULA хаяг + буруу default route) энэ нь timeout болдог
  //    хэдий ч IPv4-ээр сервер БҮРЭН хүрдэг.  Тиймээс timeout-ыг «сервер
  //    унасан» гэж бүү тайлбарла — `curl -4` -ээр тулгаж шалга.
  const ipv6Hint = /timeout|aborted/i.test(err.message)
    ? '  (IPv6 эвдэрсэн байж болзошгүй — `curl -4 <хаяг>` -ээр шалгана уу)'
    : '';
  line(WARN, 'холболт', `хүрсэнгүй (${err.message}) — офлайн горимд ажиллана${ipv6Hint}`);
}

process.stdout.write('\nЛокал үйлчилгээ\n');
try {
  const res = await fetch(`http://127.0.0.1:${cfg.port}/health`, { signal: AbortSignal.timeout(1500) });
  const body = await res.json();
  line(OK, 'ажиллаж байна', `порт ${cfg.port} · v${body.version}`);
} catch {
  line(WARN, 'ажиллахгүй байна', `«npm run ai:dev» ажиллуулна уу (порт ${cfg.port})`);
}

const diskMb = Math.round((await manager.diskUsageBytes()) / 1024 / 1024);
process.stdout.write(`\nДиск: загваруудад ${diskMb} MB\n\n`);
