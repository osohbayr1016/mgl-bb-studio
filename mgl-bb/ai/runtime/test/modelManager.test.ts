/**
 * MGL AI runtime · ЗАГВАРЫН МЕНЕЖЕР — ТЕСТ.
 *
 * Run with:  node --test runtime/test/modelManager.test.ts
 *
 * ⚠️ ГОЛ АМЛАЛТУУД (§37, §38, §48):
 *      • checksum тохирохгүй артефакт СУУЛГАГДАХГҮЙ, файл УСТГАГДАНА
 *      • checksum-гүй артефакт ТАТАГДАХГҮЙ
 *      • идэвхтэй хувилбар дээр ДАРЖ БИЧИХГҮЙ, буцах хувилбар ҮЛДЭНЭ
 *      • тасарсан татаж авалт БҮТЭН загвар мэт харагдахгүй
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { ModelManager, type ReleaseManifestEntry } from '../src/modelManager.ts';

async function tempManager() {
  const dir = await mkdtemp(join(tmpdir(), 'mglai-test-'));
  const manager = new ModelManager({
    modelsDir: join(dir, 'models'),
    stateFile: join(dir, 'state.json'),
    controlPlane: 'http://127.0.0.1:1',
  });
  return { dir, manager };
}

const BODY = Buffer.from('GGUF-ийн оронд туршилтын байтууд');
const GOOD_SHA = createHash('sha256').update(BODY).digest('hex');

function entry(over: Partial<ReleaseManifestEntry> = {}): ReleaseManifestEntry {
  return {
    release_uid: 'rel_test_1',
    version: '1.0.0',
    runtime_variant: 'employee-4b-q4',
    base_model: 'test',
    quantization: 'Q4_K_M',
    runtime: 'llama.cpp',
    context_tokens: 4096,
    artifact_url: 'https://example.invalid/model.gguf',
    artifact_bytes: BODY.length,
    artifact_sha256: GOOD_SHA,
    min_vram_mb: null,
    min_ram_mb: null,
    channel: 'stable',
    build_commit: null,
    ...over,
  };
}

/** `fetch`-ийг түр орлуулна — сүлжээгүйгээр татаж авалтыг хэмжинэ. */
function stubFetch(body: Buffer, ok = true) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(ok ? new Blob([body as unknown as BlobPart]).stream() : null, {
      status: ok ? 200 : 500,
      headers: { 'content-length': String(body.length) },
    })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/* ================================================================== */
/*  1. Checksum — хорлогдсон артефактын хамгаалалт                     */
/* ================================================================== */

test('SHA-256 тохирвол суулгана', async () => {
  const { dir, manager } = await tempManager();
  const restore = stubFetch(BODY);
  try {
    const installed = await manager.install(entry(), 'token');
    assert.equal(installed.sha256, GOOD_SHA);
    assert.equal(installed.bytes, BODY.length);
    const state = await manager.readState();
    assert.equal(state.installed.length, 1);
    // ⚠️ Суулгасан нь ИДЭВХЖСЭН гэсэн үг БИШ.
    assert.equal(state.active, null);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('SHA-256 ТОХИРОХГҮЙ бол суулгахгүй, файл УСТГАНА', async () => {
  const { dir, manager } = await tempManager();
  const restore = stubFetch(Buffer.from('өөр агуулга'));
  try {
    await assert.rejects(
      () => manager.install(entry(), 'token'),
      /SHA-256 тохирохгүй/,
    );
    // Дискэн дээр ЮУ Ч үлдээгүй байх ёстой — .part ч, .gguf ч.
    const files = await readdir(join(dir, 'models')).catch(() => [] as string[]);
    assert.deepEqual(files, []);
    const state = await manager.readState();
    assert.equal(state.installed.length, 0);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('checksum-ГҮЙ артефактыг ТАТАХГҮЙ', async () => {
  const { dir, manager } = await tempManager();
  let fetched = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetched = true;
    return new Response(null);
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => manager.install(entry({ artifact_sha256: null }), 'token'),
      /SHA-256 байхгүй/,
    );
    // ⚠️ Татаж ч эхлээгүй байх ёстой.
    assert.equal(fetched, false, 'checksum-гүй артефактыг татаж эхэлсэн');
  } finally {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  }
});

test('хаяггүй артефакт ТАТАГДАХГҮЙ', async () => {
  const { dir, manager } = await tempManager();
  try {
    await assert.rejects(() => manager.install(entry({ artifact_url: null }), 't'), /хаяг байхгүй/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ================================================================== */
/*  2. Идэвхжүүлэлт ба буцаалт                                         */
/* ================================================================== */

test('идэвхжүүлэхэд хуучин нь БУЦАХ хувилбар болж үлдэнэ', async () => {
  const { dir, manager } = await tempManager();
  const restoreA = stubFetch(BODY);
  await manager.install(entry({ release_uid: 'rel_a', version: '1.0.0' }), 't');
  restoreA();

  const bodyB = Buffer.from('хоёр дахь хувилбар');
  const restoreB = stubFetch(bodyB);
  await manager.install(
    entry({
      release_uid: 'rel_b',
      version: '1.1.0',
      artifact_sha256: createHash('sha256').update(bodyB).digest('hex'),
      artifact_bytes: bodyB.length,
    }),
    't',
  );
  restoreB();

  try {
    await manager.activate('rel_a');
    let s = await manager.readState();
    assert.equal(s.active, 'rel_a');
    assert.equal(s.previous, null);

    await manager.activate('rel_b');
    s = await manager.readState();
    assert.equal(s.active, 'rel_b');
    // ⚠️ §38 — буцах хувь ҮЛДЭНЭ.
    assert.equal(s.previous, 'rel_a');

    // Хоёр файл ХОЁУЛАА дискэн дээр — дарж бичээгүй.
    const files = await readdir(join(dir, 'models'));
    assert.equal(files.filter((f) => f.endsWith('.gguf')).length, 2);

    const rolled = await manager.rollback();
    assert.equal(rolled.active, 'rel_a');
    assert.equal(rolled.previous, 'rel_b');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('суулгаагүй хувилбарыг идэвхжүүлэхгүй', async () => {
  const { dir, manager } = await tempManager();
  try {
    await assert.rejects(() => manager.activate('rel_yohgui'), /суулгагдаагүй/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('буцах хувилбаргүй үед rollback татгалзана', async () => {
  const { dir, manager } = await tempManager();
  try {
    await assert.rejects(() => manager.rollback(), /Буцах хувилбар байхгүй/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ================================================================== */
/*  3. Тэсвэрлэлт                                                      */
/* ================================================================== */

test('эвдэрсэн state.json нь МЕНЕЖЕРИЙГ УНАГААХГҮЙ', async () => {
  const { dir, manager } = await tempManager();
  await writeFile(join(dir, 'state.json'), '{ энэ бол JSON биш', 'utf8');
  try {
    const s = await manager.readState();
    // ⚠️ АДАПТЕР, МЭДЛЭГИЙН ТАЛБАРУУД БАС ХООСОН байх ёстой.  Тэднийг
    //    `undefined` үлдээх нь `state.adapters.filter(...)` дээр унана —
    //    яг тэр «эвдэрсэн state нь менежерийг унагаана» гэсэн гажиг.
    assert.deepEqual(s, {
      active: null,
      previous: null,
      installed: [],
      adapters: [],
      activeAdapter: null,
      previousAdapter: null,
      candidateAdapter: null,
      knowledge: [],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('гараар устгасан файл нь reconcile-д цэвэрлэгдэнэ', async () => {
  const { dir, manager } = await tempManager();
  const restore = stubFetch(BODY);
  const installed = await manager.install(entry(), 't');
  restore();
  await manager.activate(installed.releaseUid);

  await rm(installed.path, { force: true });

  try {
    const s = await manager.reconcile();
    assert.equal(s.installed.length, 0);
    // ⚠️ Байхгүй файлыг идэвхтэй гэж үлдээх нь ачаалалтыг унагаана.
    assert.equal(s.active, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prune нь ИДЭВХТЭЙ ба БУЦАХ хувилбарыг устгахгүй', async () => {
  const { dir, manager } = await tempManager();

  for (const [uid, txt] of [
    ['rel_1', 'нэг'],
    ['rel_2', 'хоёр'],
    ['rel_3', 'гурав'],
  ] as const) {
    const b = Buffer.from(txt);
    const restore = stubFetch(b);
    await manager.install(
      entry({
        release_uid: uid,
        version: uid,
        artifact_sha256: createHash('sha256').update(b).digest('hex'),
        artifact_bytes: b.length,
      }),
      't',
    );
    restore();
  }

  try {
    await manager.activate('rel_1');
    await manager.activate('rel_2');
    // active=rel_2, previous=rel_1

    await manager.prune(0);
    const s = await manager.readState();
    const uids = s.installed.map((m) => m.releaseUid).sort();
    assert.ok(uids.includes('rel_1'), 'буцах хувилбар устсан');
    assert.ok(uids.includes('rel_2'), 'идэвхтэй хувилбар устсан');
    assert.equal(uids.includes('rel_3'), false, 'хамгаалалтгүй хувилбар үлдсэн');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('төлөв нь диск дээр уншигдахуйц JSON-оор үлдэнэ', async () => {
  const { dir, manager } = await tempManager();
  const restore = stubFetch(BODY);
  await manager.install(entry(), 't');
  restore();
  try {
    const raw = await readFile(join(dir, 'state.json'), 'utf8');
    const parsed = JSON.parse(raw) as { installed: unknown[] };
    assert.equal(parsed.installed.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
