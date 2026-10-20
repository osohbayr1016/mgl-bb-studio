#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { once } from 'node:events';
import { arch, platform } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, serverBinaryName } from '../runtime/src/config.ts';

const LLAMA_BUILD = 'b11382';
const LLAMA_RELEASE_BASE = 'https://github.com/ggml-org/llama.cpp/releases/download/' + LLAMA_BUILD + '/';
const MODEL = {
  name: 'Qwen3-8B-Q4_K_M.gguf',
  bytes: 5027784512,
  sha256: '120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4',
  url: 'https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/a6adef130ffb23ddaf1a62fec9dced968c9bc482/Qwen3-8B-Q4_K_M.gguf?download=true',
};

const ASSETS = {
  'darwin-arm64': {
    name: 'llama-b11382-bin-macos-arm64.tar.gz',
    sha256: 'c2540b6515cf508c270815b494ff3f228818165fe7dcdac73f643e4f10bde2e6',
  },
  'darwin-x64': {
    name: 'llama-b11382-bin-macos-x64.tar.gz',
    sha256: '37355fefe4fd208172746872e173f10e19d945ac35da01a209d9518e6ba39c13',
  },
  'linux-x64': {
    name: 'llama-b11382-bin-ubuntu-x64.tar.gz',
    sha256: '34407d59947ed4ab35fe4ab2db5f61bb4d5aedfe25e6a72f702f3ae9758a396d',
  },
  'linux-arm64': {
    name: 'llama-b11382-bin-ubuntu-arm64.tar.gz',
    sha256: 'f4ac1827e58e3df1c7f4657acc03352be4f8ad85b8abddc23741cd7bb3730cee',
  },
  'win32-x64': {
    name: 'llama-b11382-bin-win-cpu-x64.zip',
    sha256: '40d55282382909be50d27a3e182885860c28ff148e4d952beca7aaad91504051',
  },
  'win32-arm64': {
    name: 'llama-b11382-bin-win-cpu-arm64.zip',
    sha256: 'd599c476541d9ac4c929483e6150b6a906d0c6bd21ac739eb30d6cb6d4faaded',
  },
};

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const skipEngine = args.has('--skip-engine');
const skipModel = args.has('--skip-model');
const noStart = args.has('--no-start');
const cfg = loadConfig();
const metaFile = join(cfg.dataDir, 'portable-install.json');

function say(s) {
  process.stdout.write('[mgl-ai install] ' + s + '\n');
}

async function sha256File(path) {
  const h = createHash('sha256');
  const rs = createReadStream(path);
  for await (const chunk of rs) h.update(chunk);
  return h.digest('hex');
}

async function fileIsVerified(path, bytes, sha256) {
  if (!existsSync(path)) return false;
  if (bytes && statSync(path).size !== bytes) return false;
  const meta = readMeta();
  if (meta.files && meta.files[path] === sha256) return true;
  say('Verifying existing file: ' + basename(path));
  return (await sha256File(path)) === sha256;
}

function readMeta() {
  try {
    return JSON.parse(requireText(metaFile));
  } catch {
    return { files: {} };
  }
}

function requireText(path) {
  return readFileSync(path, 'utf8');
}

function writeMeta(path, sha256) {
  let meta = readMeta();
  if (!meta || typeof meta !== 'object') meta = {};
  if (!meta.files || typeof meta.files !== 'object') meta.files = {};
  meta.llama_build = LLAMA_BUILD;
  meta.model = MODEL.name;
  meta.updated_at = new Date().toISOString();
  meta.files[path] = sha256;
  mkdirSync(dirname(metaFile), { recursive: true });
  writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

async function downloadVerified(url, outFile, expectedBytes, expectedSha, label) {
  mkdirSync(dirname(outFile), { recursive: true });
  if (!force && await fileIsVerified(outFile, expectedBytes, expectedSha)) {
    say(label + ' already installed.');
    return;
  }

  const part = outFile + '.part';
  let offset = existsSync(part) ? statSync(part).size : 0;
  if (expectedBytes && offset > expectedBytes) {
    rmSync(part, { force: true });
    offset = 0;
  }

  let response = await fetch(url, {
    redirect: 'follow',
    headers: offset > 0 ? { Range: 'bytes=' + offset + '-' } : {},
  });
  if (offset > 0 && response.status !== 206) {
    rmSync(part, { force: true });
    offset = 0;
    response = await fetch(url, { redirect: 'follow' });
  }
  if (!response.ok || !response.body) {
    throw new Error(label + ' download failed: HTTP ' + response.status + ' ' + response.statusText);
  }

  const ws = createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' });
  let downloaded = offset;
  let lastPct = -1;
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      if (!ws.write(chunk)) await once(ws, 'drain');
      downloaded += chunk.length;
      if (expectedBytes) {
        const pct = Math.floor(downloaded * 100 / expectedBytes);
        if (pct !== lastPct && (pct % 2 === 0 || pct === 100)) {
          lastPct = pct;
          process.stdout.write('\r[mgl-ai install] ' + label + ' ' + pct + '%');
        }
      }
    }
  } finally {
    ws.end();
    await once(ws, 'finish');
  }
  process.stdout.write('\n');

  if (expectedBytes && statSync(part).size !== expectedBytes) {
    throw new Error(label + ' size mismatch: expected ' + expectedBytes + ', got ' + statSync(part).size);
  }
  say('Verifying SHA-256 for ' + label + '...');
  const actual = await sha256File(part);
  if (actual !== expectedSha) {
    rmSync(part, { force: true });
    throw new Error(label + ' checksum mismatch. Expected ' + expectedSha + ', got ' + actual);
  }
  rmSync(outFile, { force: true });
  renameSync(part, outFile);
  writeMeta(outFile, expectedSha);
}

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) walkFiles(path, out);
    // Symlinks matter: the macOS/Linux llama.cpp archives ship libllama-common.0.dylib
    // (or .so.0) as a link to the versioned file, and llama-server loads the SHORT name.
    else if (name.isFile() || name.isSymbolicLink()) out.push(path);
  }
  return out;
}

function extractArchive(archive, stage) {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const r = spawnSync('tar', ['-xf', archive, '-C', stage], { stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    throw new Error('Could not extract ' + archive + '. Install a tar-compatible extractor and retry.');
  }
}

async function installEngine() {
  const key = platform() + '-' + arch();
  const asset = ASSETS[key];
  if (!asset) {
    throw new Error('Unsupported platform for automatic llama.cpp install: ' + key + '. Use --skip-engine and place ' + serverBinaryName() + ' in ' + cfg.binDir);
  }

  mkdirSync(cfg.binDir, { recursive: true });
  const serverPath = join(cfg.binDir, serverBinaryName());
  const stampPath = join(cfg.binDir, '.portable-' + LLAMA_BUILD + '-' + key);
  if (!force && existsSync(serverPath) && existsSync(stampPath)) {
    say('llama.cpp ' + LLAMA_BUILD + ' already installed.');
    return;
  }

  const tempDir = join(cfg.dataDir, 'tmp-portable');
  mkdirSync(tempDir, { recursive: true });
  const archive = join(tempDir, asset.name);
  await downloadVerified(
    LLAMA_RELEASE_BASE + asset.name,
    archive,
    null,
    asset.sha256,
    'llama.cpp ' + LLAMA_BUILD,
  );

  const stage = join(tempDir, 'llama-stage');
  extractArchive(archive, stage);
  const files = walkFiles(stage);
  for (const src of files) {
    const dst = join(cfg.binDir, basename(src));
    if (lstatSync(src).isSymbolicLink()) {
      rmSync(dst, { force: true });
      symlinkSync(readlinkSync(src), dst);
      continue;
    }
    copyFileSync(src, dst);
    if (platform() !== 'win32' && basename(src) === 'llama-server') chmodSync(dst, 0o755);
  }

  if (!existsSync(serverPath)) {
    throw new Error('Archive extracted, but ' + serverBinaryName() + ' was not found in ' + cfg.binDir);
  }
  writeFileSync(stampPath, LLAMA_BUILD + '\n', 'utf8');
  rmSync(stage, { recursive: true, force: true });
  rmSync(archive, { force: true });
  say('llama.cpp installed: ' + serverPath);
}

async function installModel() {
  mkdirSync(cfg.modelsDir, { recursive: true });
  const path = join(cfg.modelsDir, MODEL.name);
  await downloadVerified(MODEL.url, path, MODEL.bytes, MODEL.sha256, MODEL.name);
  say('Model installed: ' + path);
}

function startRuntime() {
  const runtimeScript = fileURLToPath(new URL('./portable-runtime.mjs', import.meta.url));
  say('Starting local runtime...');
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', runtimeScript, 'start'],
    { stdio: 'inherit', env: process.env },
  );
  if (r.error || r.status !== 0) {
    throw new Error(
      'Files were installed, but the local runtime could not start. Retry with: npm run ai:start:portable',
    );
  }
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    throw new Error('Node.js 22+ is required. Current: ' + process.version);
  }
  mkdirSync(cfg.dataDir, { recursive: true });
  say('Platform: ' + platform() + ' ' + arch());
  say('Data dir: ' + cfg.dataDir);
  if (!skipEngine) await installEngine();
  if (!skipModel) await installModel();
  if (!noStart) startRuntime();
  say(noStart ? 'Installed. Runtime start skipped (--no-start).' : 'Ready. Local runtime is running.');
  say('Ask a question with: npm run ai:chat -- "Асуултаа энд бич"');
}

main().catch((err) => {
  console.error('\n[mgl-ai install] FAILED: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
