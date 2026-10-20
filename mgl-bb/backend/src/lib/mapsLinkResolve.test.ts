import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMapsShortLink, isAllowedHop, MAX_HOPS } from './mapsLinkResolve.ts';

type Row = { status: number; location?: string; body?: string };

/** Хуурамч fetch: хаяг → (status, Location). Бие хэзээ ч уншигдахгүй. */
function fakeFetch(table: Record<string, Row>) {
  const calls: string[] = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal(init.redirect, 'manual');
    const row = table[url];
    if (!row) return new Response('nope', { status: 404 });
    const headers = new Headers();
    if (row.location) headers.set('location', row.location);
    return new Response(row.body ?? null, { status: row.status, headers });
  };
  return { impl, calls };
}

const LONG = 'https://www.google.com/maps/place/X/@47.91,106.92,17z/data=!3d47.9142!4d106.9231';

test('follows maps.app.goo.gl → long place URL (final 200 = success)', async () => {
  const { impl, calls } = fakeFetch({
    'https://maps.app.goo.gl/AbC12?g_st=ac': { status: 302, location: LONG },
    [LONG]: { status: 200, body: '<html>…</html>' },
  });
  const r = await resolveMapsShortLink('https://maps.app.goo.gl/AbC12?g_st=ac', impl);
  assert.deepEqual(r, { ok: true, url: LONG, hops: 1 });
  assert.equal(calls.length, 2);
});

test('MEASURED place share: ?q=name&ftid → 3 hops → 200; URL returned as-is (no coords invented)', async () => {
  const q = 'https://maps.google.com/?q=Tokyo+St+Fito&ftid=0x5d9693d8f26f8879:0xfe2dea6dd982edc8&entry=gps';
  const q2 = 'https://maps.google.com/maps?q=Tokyo+St+Fito&ftid=0x5d9693d8f26f8879:0xfe2dea6dd982edc8&entry=gps';
  const q3 = 'https://www.google.com/maps?q=Tokyo+St+Fito&ftid=0x5d9693d8f26f8879:0xfe2dea6dd982edc8&entry=gps';
  const { impl, calls } = fakeFetch({
    'https://maps.app.goo.gl/dL8RGdYRwEeswZF76?g_st=ic': { status: 302, location: q },
    [q]: { status: 302, location: q2 },
    [q2]: { status: 302, location: q3 },
    [q3]: { status: 200, body: '<meta content="…staticmap?center=47.91%2C106.88" property="og:image">' },
  });
  const r = await resolveMapsShortLink('https://maps.app.goo.gl/dL8RGdYRwEeswZF76?g_st=ic', impl);
  assert.deepEqual(r, { ok: true, url: q3, hops: 3 });
  assert.equal(calls.length, 4);
});

test('goo.gl/maps two-hop chain ending in ?q=lat,lng', async () => {
  const { impl } = fakeFetch({
    'https://goo.gl/maps/xyz': { status: 301, location: 'https://maps.app.goo.gl/xyz' },
    'https://maps.app.goo.gl/xyz': { status: 302, location: 'https://maps.google.com/?q=47.9,106.9' },
    'https://maps.google.com/?q=47.9,106.9': { status: 200 },
  });
  const r = await resolveMapsShortLink('https://goo.gl/maps/xyz', impl);
  assert.deepEqual(r, { ok: true, url: 'https://maps.google.com/?q=47.9,106.9', hops: 2 });
});

test('relative Location is resolved against the current hop', async () => {
  const { impl, calls } = fakeFetch({
    'https://maps.app.goo.gl/rel': { status: 302, location: '/maps/@47.9,106.9,15z' },
  });
  const r = await resolveMapsShortLink('https://maps.app.goo.gl/rel', impl);
  // maps.app.goo.gl/maps/… нь богино хост хэвээр — 404 → UPSTREAM, гэхдээ
  // хоп нь хүснэгтэд байхгүй тул зөв хаягаар асуусан эсэхийг л шалгана.
  assert.equal(r.ok, false);
  assert.equal(calls[1], 'https://maps.app.goo.gl/maps/@47.9,106.9,15z');
});

test('consent.google.com interstitial: takes ?continue= without fetching the consent page', async () => {
  const { impl, calls } = fakeFetch({
    'https://maps.app.goo.gl/eu': {
      status: 302,
      location: `https://consent.google.com/m?continue=${encodeURIComponent(LONG)}&gl=DE`,
    },
    [LONG]: { status: 200 },
  });
  const r = await resolveMapsShortLink('https://maps.app.goo.gl/eu', impl);
  assert.deepEqual(r, { ok: true, url: LONG, hops: 2 });
  assert.deepEqual(calls, ['https://maps.app.goo.gl/eu', LONG]);
});

test('already-long URL: one fetch, returned unchanged', async () => {
  const { impl, calls } = fakeFetch({ [LONG]: { status: 200 } });
  const r = await resolveMapsShortLink(LONG, impl);
  assert.deepEqual(r, { ok: true, url: LONG, hops: 0 });
  assert.equal(calls.length, 1);
});

test('SSRF: non-Google start host is refused before any fetch', async () => {
  const { impl, calls } = fakeFetch({});
  for (const bad of [
    'https://evil.com/maps/@1,2',
    'https://google.com.evil.com/maps',
    'http://127.0.0.1:3000/api/projects',
    'ftp://maps.app.goo.gl/x',
    'not a url',
  ]) {
    const r = await resolveMapsShortLink(bad, impl);
    assert.equal(r.ok, false, bad);
  }
  assert.equal(calls.length, 0);
});

test('SSRF: a redirect that leaves Google is refused and not followed', async () => {
  const { impl, calls } = fakeFetch({
    'https://maps.app.goo.gl/bad': { status: 302, location: 'https://169.254.169.254/latest/meta-data' },
  });
  const r = await resolveMapsShortLink('https://maps.app.goo.gl/bad', impl);
  assert.deepEqual(r, { ok: false, code: 'NOT_MAPS_HOST', url: 'https://169.254.169.254/latest/meta-data' });
  assert.equal(calls.length, 1);
});

test('hop cap', async () => {
  const table: Record<string, Row> = {};
  for (let i = 0; i < MAX_HOPS + 2; i++) {
    table[`https://maps.app.goo.gl/h${i}`] = { status: 302, location: `https://maps.app.goo.gl/h${i + 1}` };
  }
  const { impl, calls } = fakeFetch(table);
  const r = await resolveMapsShortLink('https://maps.app.goo.gl/h0', impl);
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, 'TOO_MANY_HOPS');
  assert.equal(calls.length, MAX_HOPS);
});

test('short link answering 200 with no Location → UPSTREAM (never guesses)', async () => {
  const { impl } = fakeFetch({ 'https://maps.app.goo.gl/html': { status: 200 } });
  const r = await resolveMapsShortLink('https://maps.app.goo.gl/html', impl);
  assert.deepEqual(r, { ok: false, code: 'UPSTREAM', url: 'https://maps.app.goo.gl/html' });
});

test('long URL answering 5xx → UPSTREAM', async () => {
  const { impl } = fakeFetch({ [LONG]: { status: 503 } });
  const r = await resolveMapsShortLink(LONG, impl);
  assert.deepEqual(r, { ok: false, code: 'UPSTREAM', url: LONG });
});

test('network failure → UPSTREAM', async () => {
  const r = await resolveMapsShortLink('https://maps.app.goo.gl/x', async () => {
    throw new Error('ECONNRESET');
  });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, 'UPSTREAM');
});

test('isAllowedHop host table', () => {
  assert.equal(isAllowedHop(new URL('https://www.google.mn/maps')), true);
  assert.equal(isAllowedHop(new URL('https://consent.google.com/m')), true);
  assert.equal(isAllowedHop(new URL('https://g.co/kgs/x')), true);
  assert.equal(isAllowedHop(new URL('https://googleusercontent.com/x')), false);
  assert.equal(isAllowedHop(new URL('https://maps.example.com/')), false);
});
