import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asrProjectId, asrProjectName } from './asrProjectName.ts';

test('ангиллын дагаврыг хасна (_ / зай / зураас)', () => {
  assert.equal(asrProjectName('MGL-240506_FURNITURE LAND_ZA'), 'MGL-240506_FURNITURE LAND');
  assert.equal(asrProjectName('MGL-250828 Талбайн теннисний спортын ордон IZ'), 'MGL-250828 Талбайн теннисний спортын ордон');
  assert.equal(asrProjectName('MGL-251006 EVERGREEN-AZ'), 'MGL-251006 EVERGREEN');
  assert.equal(asrProjectName('MGL-251222-МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ_ZA'), 'MGL-251222-МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ');
  assert.equal(asrProjectName('MGL-251212_SKYLAND_EZ'), 'MGL-251212_SKYLAND');
});

test('дагаваргүй / наалдсан / дунд байгааг хөндөхгүй', () => {
  assert.equal(asrProjectName('MGL-260501_44 давхар орон сууц'), 'MGL-260501_44 давхар орон сууц');
  assert.equal(asrProjectName('MGL-260804 Хүй долоон худаг-Стадион'), 'MGL-260804 Хүй долоон худаг-Стадион');
  assert.equal(asrProjectName('PIZZA'), 'PIZZA');
  assert.equal(asrProjectName('ZA_Засвар'), 'ZA_Засвар');
  assert.equal(asrProjectName('ZA'), 'ZA');
  assert.equal(asrProjectName(''), '');
});

test('asrProjectId — Doc. No./файлын нэрийн PROJECT-ID (шифр БИШ, 2026-09-28)', () => {
  assert.equal(asrProjectId('MGL-251006_EVERGREEN'), 'MGL-251006');
  assert.equal(asrProjectId('MGL-251006_EVERGREEN_ZA'), 'MGL-251006');
  assert.equal(asrProjectId('MGL-260925-ABC-AZ'), 'MGL-260925');
  assert.equal(asrProjectId('mgl-240506 FURNITURE LAND_ZA'), 'MGL-240506');
  // Кодгүй нэр — ангиллын дагаваргүй нэр өөрөө, зай → зураас.
  assert.equal(asrProjectId('LUXWOOD'), 'LUXWOOD');
  assert.equal(asrProjectId('Luxwood засвар'), 'Luxwood-засвар');
  assert.equal(asrProjectId(''), 'PROJECT-ID');
  assert.equal(asrProjectId(null), 'PROJECT-ID');
});
