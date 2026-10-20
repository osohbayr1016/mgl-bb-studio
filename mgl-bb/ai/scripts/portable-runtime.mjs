#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { totalmem } from 'node:os';
import { loadConfig } from '../runtime/src/config.ts';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ENTRY = resolve(HERE, '..', 'runtime', 'src', 'server.ts');
const cfg = loadConfig();
const pidFile = join(cfg.dataDir, 'portable-runtime.pid');
const logFile = join(cfg.dataDir, 'runtime.log');
const errFile = join(cfg.dataDir, 'runtime.err.log');
const cmd = process.argv[2] || 'start';

function envForRuntime() {
  const env = { ...process.env };
  const model = join(cfg.modelsDir, 'Qwen3-8B-Q4_K_M.gguf');
  // Small-RAM Apple Silicon (8 GB): the 8B model does not fit Metal's budget and is unusable on CPU
  // (measured: Metal OutOfMemory; ~4 tok/s prompt on CPU). Prefer the 4B dev model when present.
  const small = join(cfg.modelsDir, 'Qwen3-4B-Q4_K_M.gguf');
  const smallMac = process.platform === 'darwin' && process.arch === 'arm64' && totalmem() < 12 * 1024 ** 3;
  if (!env.MGLAI_MODEL_PATH && smallMac && existsSync(small)) env.MGLAI_MODEL_PATH = small;
  if (!env.MGLAI_MODEL_PATH && existsSync(model)) env.MGLAI_MODEL_PATH = model;
  return env;
}

async function healthy() {
  try {
    const r = await fetch('http://127.0.0.1:' + cfg.port + '/health', { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

function readPid() {
  try {
    const n = Number(readFileSync(pidFile, 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await healthy()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function start() {
  mkdirSync(cfg.dataDir, { recursive: true });
  if (await healthy()) {
    console.log('MGL AI already running at http://127.0.0.1:' + cfg.port);
    return;
  }
  const old = readPid();
  if (old && pidAlive(old)) {
    console.log('Process ' + old + ' exists but health is not ready. Check ' + logFile);
    process.exitCode = 1;
    return;
  }

  // spawn() needs OPEN file descriptors: a WriteStream has fd=null until its async
  // open completes, which Node rejects with ERR_INVALID_ARG_VALUE.
  const out = openSync(logFile, 'a');
  const err = openSync(errFile, 'a');
  const child = spawn(process.execPath, ['--experimental-strip-types', ENTRY], {
    cwd: resolve(HERE, '..'),
    detached: true,
    stdio: ['ignore', out, err],
    env: envForRuntime(),
  });
  writeFileSync(pidFile, String(child.pid) + '\n', 'utf8');
  child.unref();
  closeSync(out);
  closeSync(err);

  if (await waitForHealth()) {
    console.log('MGL AI started. pid=' + child.pid + ' port=' + cfg.port);
    return;
  }
  console.error('MGL AI did not become healthy. Logs: ' + logFile + ' and ' + errFile);
  process.exitCode = 1;
}

async function stop() {
  const pid = readPid();
  if (!pid) {
    console.log('MGL AI is not running (no pid file).');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
  const end = Date.now() + 10000;
  while (Date.now() < end && pidAlive(pid)) await new Promise((r) => setTimeout(r, 250));
  if (pidAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  rmSync(pidFile, { force: true });
  console.log('MGL AI stopped.');
}

async function status() {
  const pid = readPid();
  const ok = await healthy();
  console.log('MGL AI');
  console.log('  health : ' + (ok ? 'READY' : 'DOWN'));
  console.log('  url    : http://127.0.0.1:' + cfg.port);
  console.log('  pid    : ' + (pid || '-'));
  console.log('  data   : ' + cfg.dataDir);
  console.log('  log    : ' + logFile);
  const model = join(cfg.modelsDir, 'Qwen3-8B-Q4_K_M.gguf');
  console.log('  model  : ' + (existsSync(model) ? model + ' (' + (statSync(model).size / 1024 / 1024 / 1024).toFixed(2) + ' GiB)' : 'missing'));
}

async function foreground() {
  const child = spawn(process.execPath, ['--experimental-strip-types', ENTRY], {
    cwd: resolve(HERE, '..'),
    stdio: 'inherit',
    env: envForRuntime(),
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code || 0);
  });
}

if (cmd === 'start') await start();
else if (cmd === 'stop') await stop();
else if (cmd === 'restart') { await stop(); await start(); }
else if (cmd === 'status') await status();
else if (cmd === 'foreground' || cmd === 'run') await foreground();
else {
  console.error('Usage: portable-runtime.mjs <start|stop|restart|status|foreground>');
  process.exit(2);
}
