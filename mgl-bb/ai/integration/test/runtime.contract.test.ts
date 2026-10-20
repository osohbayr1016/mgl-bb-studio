/**
 * MGL AI · ЛОКАЛ RUNTIME API — ГЭРЭЭНИЙ ТЕСТ (Session D §16, §26).
 *
 * ⚠️ ЖИНХЭНЭ СЕРВЕР, ХУУРАМЧ БИШ.  `buildState` + `createRuntimeServer`-ийг
 *    (`ai/runtime/src/server.ts`) түр `MGLAI_DATA_DIR` дээр, `MGLAI_ENGINE=echo`
 *    хүчээр асаана.  GPU, загвар, интернэт ХЭРЭГГҮЙ — тиймээс энэ тест
 *    release gate-ийн `--fast` горимд ч ажиллана.
 *
 * ⚠️ ЮУГ ШАЛГАДАГ / ШАЛГАДАГГҮЙ.  Хариуны ХЭЛБЭР (`contracts/runtimeApi.ts`)
 *    ба нууцын хил (§26) — өөр юу ч биш.  «Хариулт зөв үү» гэдэг нь
 *    Session A/C-ийн GOLD suite; энэ файл түүнийг давхардуулахгүй.
 *
 * ⚠️ `/norm` нь энд 503 (мэдлэг суулгаагүй).  Хөгжүүлэгчийн машин дээр
 *    `%LOCALAPPDATA%\MglAi\knowledge\knowledge.sqlite` байвал түүнийг ТҮР
 *    хавтас руу хуулж 200-ийн хэлбэрийг ч шалгана; байхгүй бол тэр тест
 *    `skip` — «давлаа» гэж ХУДЛАА хэлэхгүй.
 */
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

import { checkShape, type Spec } from '../src/contracts/shape.ts';
import * as C from '../src/contracts/runtimeApi.ts';
import { startEchoRuntime, SECRET, type EchoRuntime } from './helpers/echoRuntime.ts';

let rt: EchoRuntime;
let base: string;
let knowledgeCopied = false;

before(async () => {
  rt = await startEchoRuntime();
  base = rt.base;
  knowledgeCopied = rt.knowledgeCopied;
});

after(async () => {
  await rt.close();
});

const H = () => rt.headers;
const shape = (v: unknown, spec: Spec, label: string) => {
  const issues = checkShape(v, spec);
  assert.deepEqual(issues, [], `${label}: ${issues.join(' | ')}`);
};

test('GET /health — нэвтрэлтгүй, загварын мэдээлэл ГАРАХГҮЙ', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  shape(body, C.HEALTH, '/health');
  const txt = JSON.stringify(body);
  for (const leak of ['engine', 'model', 'hardware', 'gpu', 'cpu']) {
    assert.ok(!txt.toLowerCase().includes(`"${leak}`), `/health нь ${leak} задруулж байна`);
  }
});

test('нэвтрэлтгүй /info → 401 гэрээний хэлбэртэй', async () => {
  const res = await fetch(`${base}/info`);
  assert.equal(res.status, 401);
  shape(await res.json(), C.UNAUTHORIZED, '/info 401');
});

test('буруу нууц → 401, ЗӨВ нууцыг хариунд буцаахгүй', async () => {
  const res = await fetch(`${base}/info`, { headers: { 'x-mglai-secret': 'wrong' } });
  assert.equal(res.status, 401);
  assert.ok(!(await res.text()).includes(SECRET));
});

test('GET /info — FE RuntimeInfo + B version хэлбэр', async () => {
  const res = await fetch(`${base}/info`, { headers: H() });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  shape(body, C.INFO, '/info');
  shape(body.update, C.UPDATE_STATUS, '/info.update');
  // echo хөдөлгүүр ӨӨРИЙГӨӨ нэрлэнэ — «хуурамч AI endpoint биш» дүрэм.
  assert.equal((body.engine as { engine: string }).engine, 'echo');
});

test('GET /update/status — UpdateStatus twin', async () => {
  const res = await fetch(`${base}/update/status`, { headers: H() });
  assert.equal(res.status, 200);
  shape(await res.json(), C.UPDATE_STATUS, '/update/status');
});

test('GET /metrics — диагностик хэлбэр; gpu null нь 0 биш', async () => {
  const res = await fetch(`${base}/metrics`, { headers: H() });
  assert.equal(res.status, 200);
  shape(await res.json(), C.METRICS, '/metrics');
});

test('POST /norm/info + /norm — мэдлэг суулгаагүй бол ИЛ 503, чимээгүй хоосон биш', async (t) => {
  const info = await fetch(`${base}/norm/info`, { headers: H() });
  assert.equal(info.status, 200);
  const infoBody = (await info.json()) as { installed: boolean };
  if (knowledgeCopied) {
    shape(infoBody, C.NORM_INFO_INSTALLED, '/norm/info (installed)');
  } else {
    shape(infoBody, C.NORM_INFO_NOT_INSTALLED, '/norm/info (not installed)');
    const res = await fetch(`${base}/norm`, { method: 'POST', headers: H(), body: JSON.stringify({ query: 'захиалагчийн үүрэг' }) });
    assert.equal(res.status, 503, 'мэдлэггүй /norm нь 503 байх ЁСТОЙ — FE not_installed, B NORM_NOT_INSTALLED');
    shape(await res.json(), C.NORM_NOT_INSTALLED, '/norm 503');
    t.diagnostic('knowledge.sqlite энэ машинд байхгүй — /norm 200-ийн хэлбэр ШАЛГАГДААГҮЙ');
  }
});

test('POST /norm → 200 хэлбэр (хөгжүүлэгчийн сан байвал)', { skip: !knowledgeCopied && 'knowledge.sqlite алга' }, async () => {
  const res = await fetch(`${base}/norm`, {
    method: 'POST',
    headers: H(),
    body: JSON.stringify({ query: 'Барилгын захиалагчийн үүрэг', audience: 'employee', evidence_limit: 5 }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  shape(body, C.NORM_ANSWER, '/norm 200');
  if (body.citation) shape(body.citation, C.NORM_CITATION, '/norm.citation');
  for (const [i, e] of (body.evidence as unknown[]).entries()) shape(e, C.NORM_EVIDENCE_ITEM, `/norm.evidence[${i}]`);
  assert.ok(C.NORM_STATUSES.includes(body.status as never));
});

test('POST /norm хоосон query → 400', { skip: !knowledgeCopied && 'knowledge.sqlite алга' }, async () => {
  const res = await fetch(`${base}/norm`, { method: 'POST', headers: H(), body: JSON.stringify({ query: '' }) });
  assert.equal(res.status, 400);
});

test('POST /generate — SSE фрэймүүд гэрээний хэлбэртэй, done ЗААВАЛ ирнэ', async () => {
  const res = await fetch(`${base}/generate`, {
    method: 'POST',
    headers: H(),
    body: JSON.stringify({
      turns: [
        { role: 'system', content: 'Та MGL AI.' },
        { role: 'user', content: 'Сайн байна уу?' },
      ],
      max_tokens: 64,
      response_language: 'mn-Cyrl',
    }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const text = await res.text();
  const frames = text
    .split('\n\n')
    .filter((f) => f.trim().length > 0)
    .map((f) => {
      let event = 'message';
      let data = '';
      for (const line of f.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
  const events = frames.map((f) => f.event);
  for (const ev of events) assert.ok((C.GENERATE_EVENTS as readonly string[]).includes(ev), `танигдахгүй SSE event: ${ev}`);
  assert.equal(events[0], 'start');
  assert.equal(events.at(-1), 'done');
  assert.ok(events.includes('token'));
  for (const f of frames) {
    if (f.event === 'start') shape(f.data, C.GENERATE_START, 'start');
    if (f.event === 'token') shape(f.data, C.GENERATE_TOKEN, 'token');
    if (f.event === 'heartbeat') shape(f.data, C.GENERATE_HEARTBEAT, 'heartbeat');
    if (f.event === 'done') shape(f.data, C.GENERATE_DONE, 'done');
    if (f.event === 'error') shape(f.data, C.GENERATE_ERROR, 'error');
  }
});

test('POST /generate хоосон turns → 400', async () => {
  const res = await fetch(`${base}/generate`, { method: 'POST', headers: H(), body: JSON.stringify({ turns: [] }) });
  assert.equal(res.status, 400);
});

test('POST /generate — контекст хэтэрвэл 413 context_overflow (таслахгүй)', async () => {
  const res = await fetch(`${base}/generate`, {
    method: 'POST',
    headers: H(),
    body: JSON.stringify({ turns: [{ role: 'user', content: 'ө'.repeat(40_000) }] }),
  });
  assert.equal(res.status, 413);
  shape(await res.json(), C.GENERATE_OVERFLOW, '/generate 413');
});

test('танигдахгүй зам → 404 JSON', async () => {
  const res = await fetch(`${base}/nope`, { headers: H() });
  assert.equal(res.status, 404);
  shape(await res.json(), { error: 'string' }, '404');
});

/* ------------------------------------------------------------------ */
/*  Session B — /deploy/* (merge хийгдсэн бол)                         */
/* ------------------------------------------------------------------ */

test('GET /deploy/health — B HealthReport хэлбэр (B merge хийгдсэн бол)', async (t) => {
  const res = await fetch(`${base}/deploy/health`, { headers: H() });
  if (res.status === 404) return t.skip('B /deploy/* merge хийгдээгүй');
  if (res.status === 503) return t.skip('deployment agent идэвхгүй (DEPLOY_AGENT_UNAVAILABLE)');
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  shape(body, C.DEPLOY_HEALTH, '/deploy/health');
  // §17 — нэг boolean биш, тал бүр тусдаа
  assert.equal(Object.keys(body.facets as object).length, C.DEPLOY_FACETS.length);
});

test('GET /deploy/state — mgl-ai-installed/1 (B merge хийгдсэн бол)', async (t) => {
  const res = await fetch(`${base}/deploy/state`, { headers: H() });
  if (res.status === 404 || res.status === 503) return t.skip('B /deploy/* алга');
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  shape(body, C.DEPLOY_STATE, '/deploy/state');
  // §16 — installationId нь хардвераас гардаггүй санамсаргүй UUID
  assert.match((body.installed as { installationId: string }).installationId, /^ins_[0-9a-f-]{36}$/);
});

test('/deploy/* нэвтрэлт шаардана (B merge хийгдсэн бол)', async (t) => {
  const res = await fetch(`${base}/deploy/health`);
  if (res.status === 404) return t.skip('B /deploy/* алга');
  assert.equal(res.status, 401);
});
