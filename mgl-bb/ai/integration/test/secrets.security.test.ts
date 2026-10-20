/**
 * MGL AI · НУУЦЫН ХИЛ — SECURITY ангиллын тест (Session D §26).
 *
 * ⚠️ Session C-ийн red-team-ийг ДАВХАРДУУЛАХГҮЙ.  Энд зөвхөн ИНТЕГРАЦЫН
 *    гоожилт: суулгацын нууц ба хослосон ERP токен нь runtime-ийн уншигдах
 *    гарц бүрээс ГАРАХГҮЙ.  Sentinel утгаар — бодит нууц энд ХЭЗЭЭ Ч орохгүй.
 */
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

import { startEchoRuntime, SECRET, type EchoRuntime } from './helpers/echoRuntime.ts';

const ERP_TOKEN_SENTINEL =
  'eyJhbGciOiJIUzI1NiJ9.' +
  Buffer.from(JSON.stringify({ sub: 4242, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') +
  '.SENTINEL-ERP-SIGNATURE';

let rt: EchoRuntime;
before(async () => {
  rt = await startEchoRuntime({ copyKnowledge: false });
});
after(async () => {
  await rt.close();
});

test('§26 — суулгацын нууц, ERP токен ямар ч хариунд ГАРАХГҮЙ', async () => {
  // Хослоод (ERP токен хадгалуулаад) дараа нь бүх уншигдах гарцыг шүүнэ.
  const pair = await fetch(`${rt.base}/pair`, { method: 'POST', headers: rt.headers, body: JSON.stringify({ token: ERP_TOKEN_SENTINEL }) });
  assert.equal(pair.status, 200);
  const paths = ['/health', '/info', '/metrics', '/update/status', '/norm/info'];
  for (const p of paths) {
    const txt = await (await fetch(`${rt.base}${p}`, { headers: rt.headers })).text();
    assert.ok(!txt.includes(SECRET), `${p} нь суулгацын нууцыг задруулж байна`);
    assert.ok(!txt.includes('SENTINEL-ERP-SIGNATURE'), `${p} нь ERP токеныг задруулж байна`);
    assert.ok(!txt.includes(ERP_TOKEN_SENTINEL), `${p} нь ERP токеныг задруулж байна`);
  }
  const info = (await (await fetch(`${rt.base}/info`, { headers: rt.headers })).json()) as { paired: boolean };
  assert.equal(info.paired, true, '/pair-ийн дараа paired=true');
});

