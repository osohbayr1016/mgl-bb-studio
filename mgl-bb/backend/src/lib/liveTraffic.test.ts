import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  liveSource,
  normalizeLivePath,
  shouldRecord,
  recordLive,
  armLiveTraffic,
  __resetLiveTrafficForTest,
  LIVE_WS_PATH,
  type LiveEvent,
} from './liveTraffic.ts';

function ev(p = '/api/projects'): LiveEvent {
  return { t: Date.now(), k: 'http', m: 'GET', p, s: 200, ms: 5, q: 1, r: 10, w: 0, u: 1, role: 'admin', c: null, ch: null };
}

/** DO-гийн хуурамч namespace — ирсэн багц бүрийг тоолж, `watchers`-ыг буцаана. */
function fakeEnv(watchers: number) {
  const batches: LiveEvent[][] = [];
  const ns = {
    idFromName: (n: string) => n,
    get: () => ({
      fetch: async (_url: string, init: { body: string }) => {
        batches.push((JSON.parse(init.body) as { events: LiveEvent[] }).events);
        return new Response(JSON.stringify({ watchers }));
      },
    }),
  };
  return { env: { WORKBENCH_LIVE: ns as unknown as DurableObjectNamespace }, batches };
}

function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  return { ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) }, drain: () => Promise.all(pending) };
}

beforeEach(() => __resetLiveTrafficForTest());

test('normalizeLivePath — id, түлхүүр, query хасагдана', () => {
  assert.equal(normalizeLivePath('/api/projects/41/tasks?t=secret'), '/api/projects/:id/tasks');
  assert.equal(normalizeLivePath('/api/projects/41/drive/files/1_meagvM8pDUbbJwAthl1s1HZx46dfnN5'), '/api/projects/:id/drive/files/:key');
  assert.equal(normalizeLivePath('/media/12-1759000000000-ab12.png'), '/media/:key');
  assert.equal(normalizeLivePath('/api/x/0a1b2c3d4e5f6a7b8c9d'), '/api/x/:key');
  assert.equal(normalizeLivePath('/api/teams/mine'), '/api/teams/mine');
});

test('liveSource — Revit add-in-ийг UA эсвэл токены зорилгоор таньна, бусад нь null', () => {
  assert.equal(liveSource('MglRevitAddin/1.23.0'), 'revit');
  assert.equal(liveSource('MglRevitAddin-FamilyHub/0.1'), 'revit');
  assert.equal(liveSource('Mozilla/5.0 (Windows NT 10.0) Chrome/153'), null);
  assert.equal(liveSource(undefined), null);
  assert.equal(liveSource('Mozilla/5.0 MglRevitAddin'), null, 'UA угтвар л тоологдоно');
  assert.equal(liveSource(null, 'revit'), 'revit');
  assert.equal(liveSource('Mozilla/5.0', 'revit-refresh'), 'revit');
  assert.equal(liveSource('Mozilla/5.0', 'mcp'), null, 'mcp токен нь Claude-ийнх ч байж болно');
});

test('shouldRecord — preflight ба live сувгийн гар барилт бүртгэгдэхгүй', () => {
  assert.equal(shouldRecord('OPTIONS', '/api/projects'), false);
  assert.equal(shouldRecord('GET', LIVE_WS_PATH), false);
  assert.equal(shouldRecord('GET', '/api/projects'), true);
});

test('үзэгчгүй: олон хүсэлтэд ЗӨВХӨН нэг probe, бусад нь хаягдана', async () => {
  const { env, batches } = fakeEnv(0);
  const { ctx, drain } = fakeCtx();
  for (let i = 0; i < 50; i++) recordLive(env, ctx, ev());
  await drain();
  assert.equal(batches.length, 1);
  assert.equal(batches[0]!.length, 1);
});

test('зэвсэглэсэн: олон хүсэлт НЭГ багцаар явна', async () => {
  const { env, batches } = fakeEnv(1);
  const { ctx, drain } = fakeCtx();
  armLiveTraffic();
  for (let i = 0; i < 30; i++) recordLive(env, ctx, ev(`/api/p${i}`));
  await drain();
  assert.equal(batches.length, 1);
  assert.equal(batches[0]!.length, 30);
});

test('binding байхгүй бол юу ч хийхгүй', async () => {
  const { ctx, drain } = fakeCtx();
  recordLive({}, ctx, ev());
  await drain();
});
