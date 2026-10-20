/**
 * Төслийн байршил · Google Maps холбоосын дүрмийн шалгалт.
 *
 *   node scripts/check-maps-link.mjs        (frontend/ хавтаснаас)
 *
 * `src/shared/lib/mapsLink.ts` — href үүсгэх эрэмбэ (пин → холбоос →
 * хаяг), Google Maps-ийн бүх түгээмэл холбоосын хэлбэрээс координат
 * задлах, богино холбоосыг таних, хаягийн бичвэр доторх холбоосыг олох.
 * Frontend-д vitest байхгүй тул бусад `check-*.mjs`-ийн адил node-оор.
 */
import assert from 'node:assert/strict';

const M = await import('../src/shared/lib/mapsLink.ts');
const {
  parseMapsCoords,
  extractMapsUrl,
  isMapsUrl,
  isShortMapsHost,
  projectMapsHref,
  projectDirectionsHref,
  locationDisplayText,
  mapsSearchHref,
} = M;

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};
const near = (p, lat, lng) => {
  assert.ok(p, 'coords expected');
  assert.ok(Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lng - lng) < 1e-6, `${p.lat},${p.lng} ≠ ${lat},${lng}`);
};

console.log('parseMapsCoords');
ok('place share: !3d!4d beats /@ camera', () => {
  near(
    parseMapsCoords(
      'https://www.google.com/maps/place/Blue+Sky+Tower/@47.9150,106.9200,17z/data=!3m1!4b1!4m6!3m5!1s0x5d9692f5e64a2f5f:0x1!8m2!3d47.9142!4d106.9231!16s%2Fg%2F1',
    ),
    47.9142,
    106.9231,
  );
});
ok('last !3d!4d pair wins (nested place data)', () => {
  near(parseMapsCoords('https://www.google.com/maps/dir/data=!4m6!3d47.1!4d106.1!3d47.92!4d106.92'), 47.92, 106.92);
});
ok('/maps/@lat,lng,zoom (camera only)', () => {
  near(parseMapsCoords('https://www.google.com/maps/@47.9184,106.9177,15z'), 47.9184, 106.9177);
});
ok('maps.google.com/?q=lat,lng', () => {
  near(parseMapsCoords('https://maps.google.com/?q=47.9184,106.9177'), 47.9184, 106.9177);
});
ok('?q=loc:lat,lng', () => {
  near(parseMapsCoords('https://maps.google.com/maps?q=loc:47.9184,106.9177&z=16'), 47.9184, 106.9177);
});
ok('search/?api=1&query=lat,lng (our own href round-trips)', () => {
  near(parseMapsCoords(mapsSearchHref({ lat: 47.926706, lng: 106.918259 })), 47.926706, 106.918259);
});
ok('dir/?api=1&destination=lat,lng', () => {
  near(parseMapsCoords('https://www.google.com/maps/dir/?api=1&destination=47.9,106.9'), 47.9, 106.9);
});
ok('?ll= and ?center=', () => {
  near(parseMapsCoords('https://maps.google.com/maps?ll=47.9,106.9&z=15'), 47.9, 106.9);
  near(parseMapsCoords('https://www.google.com/maps?center=47.9,106.9'), 47.9, 106.9);
});
ok('DMS place name + /@ falls back to the camera', () => {
  near(
    parseMapsCoords(
      "https://www.google.com/maps/place/47%C2%B055'06.1%22N+106%C2%B055'03.7%22E/@47.918361,106.917694,17z",
    ),
    47.918361,
    106.917694,
  );
});
ok('geo: URI (Android share)', () => {
  near(parseMapsCoords('geo:47.9184,106.9177?q=47.9184,106.9177(Site)'), 47.9184, 106.9177);
});
ok('plain "lat, lng" text', () => {
  near(parseMapsCoords('47.9184, 106.9177'), 47.9184, 106.9177);
  near(parseMapsCoords(' -33.8688,151.2093 '), -33.8688, 151.2093);
});
ok('short link has no coords → null (server resolves)', () => {
  assert.equal(parseMapsCoords('https://maps.app.goo.gl/k5C6fgufWn5HcUmq5?g_st=ac'), null);
});
ok('address search link has no coords → null', () => {
  assert.equal(parseMapsCoords('https://www.google.com/maps/search/?api=1&query=Ulaanbaatar+SBD'), null);
});
ok('out-of-range / (0,0) / garbage → null', () => {
  assert.equal(parseMapsCoords('https://www.google.com/maps/@95.0,200.0,15z'), null);
  assert.equal(parseMapsCoords('https://maps.google.com/?q=0,0'), null);
  assert.equal(parseMapsCoords('Улаанбаатар хот, Хан-Уул дүүрэг'), null);
  assert.equal(parseMapsCoords(''), null);
  assert.equal(parseMapsCoords(null), null);
});
ok('a project id-like "12, 3" is NOT coords when lat is fine but text has more', () => {
  // «11-р хороолол-4 /14193 бүсчлэлд/» гэх мэт хаяг хэзээ ч хос тоо биш.
  assert.equal(parseMapsCoords('Улаанбаатар хот, 11-р хороолол-4 /14193/'), null);
});

console.log('isMapsUrl / isShortMapsHost / extractMapsUrl');
ok('google maps hosts', () => {
  assert.equal(isMapsUrl('https://www.google.com/maps/place/x/@47.9,106.9,17z'), true);
  assert.equal(isMapsUrl('https://maps.google.com/?q=47.9,106.9'), true);
  assert.equal(isMapsUrl('https://www.google.mn/maps/@47.9,106.9,15z'), true);
  assert.equal(isMapsUrl('https://maps.app.goo.gl/AbC12'), true);
  assert.equal(isMapsUrl('https://goo.gl/maps/AbC12'), true);
  assert.equal(isMapsUrl('https://g.co/kgs/abc'), true);
});
ok('non-maps URLs rejected', () => {
  assert.equal(isMapsUrl('https://www.google.com/search?q=maps'), false);
  assert.equal(isMapsUrl('https://evil.com/maps/@47.9,106.9'), false);
  assert.equal(isMapsUrl('https://notgoogle.com/maps'), false);
  assert.equal(isMapsUrl('https://google.com.evil.com/maps'), false);
  assert.equal(isMapsUrl('javascript:alert(1)'), false);
  assert.equal(isMapsUrl('Улаанбаатар'), false);
});
ok('short hosts', () => {
  assert.equal(isShortMapsHost('maps.app.goo.gl'), true);
  assert.equal(isShortMapsHost('GOO.GL'), true);
  assert.equal(isShortMapsHost('www.google.com'), false);
});
ok('extractMapsUrl finds the link inside address text, strips trailing punctuation', () => {
  assert.equal(
    extractMapsUrl('Хан-Уул дүүрэг, 15-р хороо. https://maps.app.goo.gl/AbC12.'),
    'https://maps.app.goo.gl/AbC12',
  );
  assert.equal(extractMapsUrl('https://www.google.com/maps/@47.9,106.9,15z'), 'https://www.google.com/maps/@47.9,106.9,15z');
  assert.equal(extractMapsUrl('см. https://example.com/page'), null);
  assert.equal(extractMapsUrl('Улаанбаатар хот, Сүхбаатар дүүрэг'), null);
});

console.log('projectMapsHref / projectDirectionsHref');
ok('pin beats everything', () => {
  const r = projectMapsHref({ location: 'https://maps.app.goo.gl/x', latitude: 47.926705622280764, longitude: 106.91825870089349 });
  assert.equal(r.kind, 'pin');
  assert.equal(r.href, 'https://www.google.com/maps/search/?api=1&query=47.926706%2C106.918259');
  assert.equal(
    projectDirectionsHref({ latitude: 47.926705622280764, longitude: 106.91825870089349 }),
    'https://www.google.com/maps/dir/?api=1&destination=47.926706%2C106.918259',
  );
});
ok('pasted link (no pin) opens verbatim', () => {
  const r = projectMapsHref({ location: 'ХУД https://maps.app.goo.gl/AbC12', latitude: null, longitude: null });
  assert.deepEqual(r, { href: 'https://maps.app.goo.gl/AbC12', kind: 'link' });
  // directions from a long link with coords → coords; from a short one → the link itself
  assert.equal(
    projectDirectionsHref({ location: 'https://www.google.com/maps/@47.9,106.9,15z' }),
    'https://www.google.com/maps/dir/?api=1&destination=47.9%2C106.9',
  );
  assert.equal(projectDirectionsHref({ location: 'https://maps.app.goo.gl/AbC12' }), 'https://maps.app.goo.gl/AbC12');
});
ok('address only → Google search (production row shape)', () => {
  const loc = 'Улаанбаатар хот, Хан-Уул дүүрэг, 8-р хороо, Наадамчдын гудамж';
  const r = projectMapsHref({ location: loc, latitude: null, longitude: null });
  assert.equal(r.kind, 'address');
  assert.equal(r.href, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`);
  assert.equal(projectDirectionsHref({ location: loc }), `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc)}`);
});
ok('nothing stored → null (no button)', () => {
  assert.equal(projectMapsHref({ location: null, latitude: null, longitude: null }), null);
  assert.equal(projectMapsHref({ location: '   ' }), null);
  assert.equal(projectDirectionsHref({}), null);
});
ok('invalid stored coords fall through to the address', () => {
  const r = projectMapsHref({ location: 'Улаанбаатар', latitude: 0, longitude: 0 });
  assert.equal(r.kind, 'address');
});

console.log('locationDisplayText');
ok('hides the raw URL, keeps the human part', () => {
  assert.equal(locationDisplayText('Хан-Уул, 15-р хороо https://maps.app.goo.gl/AbC12'), 'Хан-Уул, 15-р хороо');
  assert.equal(locationDisplayText('https://maps.app.goo.gl/AbC12'), '');
  assert.equal(locationDisplayText('Улаанбаатар хот, СБД'), 'Улаанбаатар хот, СБД');
  assert.equal(locationDisplayText(null), '');
});

console.log(`\ncheck-maps-link: ${n} scenarios OK`);
