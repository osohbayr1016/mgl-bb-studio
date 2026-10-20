#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig } from '../runtime/src/config.ts';

const cfg = loadConfig();
const base = 'http://127.0.0.1:' + cfg.port;
const secretFile = cfg.secretFile;

const SYSTEM = [
  'Та MGL AI-ийн локал хөгжүүлэгчийн консолоор ажиллаж байна.',
  'Монгол хэлээр ойлгомжтой, мэргэжлийн, товч боловч хангалттай хариул.',
  'Архитектур, барилга, инженерчлэлийн асуултад мэдэхгүй зүйлээ зохиож болохгүй.',
  'Норм, заалт, тоо баримтын эх сурвалж локал контекстэд өгөөгүй бол яг таг эшлэл зохиож болохгүй.',
  'Энэ консоль нь загварын inference-ийг шууд шалгах зориулалттай; ERP tool/RAG контекст автоматаар нэмэгдэхгүй.',
].join(' ');

async function ensureRuntime() {
  try {
    const r = await fetch(base + '/health', { signal: AbortSignal.timeout(2000) });
    if (r.ok) return;
  } catch {}
  const runtimeScript = fileURLToPath(new URL('./portable-runtime.mjs', import.meta.url));
  const r = spawnSync(process.execPath, ['--experimental-strip-types', runtimeScript, 'start'], {
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('Could not start MGL AI runtime.');
}

function secret() {
  if (!existsSync(secretFile)) throw new Error('Runtime secret is missing: ' + secretFile);
  return readFileSync(secretFile, 'utf8').trim();
}

async function info(sec) {
  const r = await fetch(base + '/info', { headers: { 'X-MglAi-Secret': sec } });
  if (!r.ok) throw new Error('/info failed: HTTP ' + r.status + ' ' + await r.text());
  return r.json();
}

async function generate(sec, turns) {
  const r = await fetch(base + '/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MglAi-Secret': sec,
    },
    body: JSON.stringify({ turns, max_tokens: 900 }),
  });
  if (!r.ok || !r.body) throw new Error('/generate failed: HTTP ' + r.status + ' ' + await r.text());

  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  for await (const chunk of r.body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (;;) {
      const idx = buffer.indexOf('\n\n');
      if (idx < 0) break;
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === 'token') {
        const text = String(payload.text || '');
        answer += text;
        process.stdout.write(text);
      } else if (event === 'error') {
        throw new Error(payload.message || 'generation failed');
      } else if (event === 'done' && payload.stop_reason === 'repetition') {
        process.stdout.write('\n[warning: repetition guard stopped this answer]');
      }
    }
  }
  process.stdout.write('\n');
  return answer.trim();
}

await ensureRuntime();
const sec = secret();
const meta = await info(sec);
if (meta && meta.engine && meta.engine.engine === 'echo') {
  console.error('MGL AI is running in EchoEngine mode. Install the Qwen model first: npm run ai:install:portable');
  process.exit(1);
}

const once = process.argv.slice(2).join(' ').trim();
const history = [{ role: 'system', content: SYSTEM }];

async function ask(q) {
  history.push({ role: 'user', content: q });
  const answer = await generate(sec, history);
  history.push({ role: 'assistant', content: answer });
  while (history.length > 11) history.splice(1, 2);
}

if (once) {
  await ask(once);
} else {
  const rl = createInterface({ input, output });
  console.log('MGL AI local chat. Type /exit to quit.');
  for (;;) {
    const q = (await rl.question('\nYou > ')).trim();
    if (!q) continue;
    if (q === '/exit' || q === '/quit') break;
    process.stdout.write('MGL AI > ');
    await ask(q);
  }
  rl.close();
}
