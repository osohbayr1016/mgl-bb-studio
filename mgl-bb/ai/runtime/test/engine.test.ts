/**
 * MGL AI runtime · ХӨДӨЛГҮҮР — ТЕСТ.
 *
 * Run with:  node --test runtime/test/engine.test.ts
 *
 * ⚠️ ХАМГИЙН ЧУХАЛ ТЕСТ нь «ТӨЛБӨРТЭЙ API РУУ ЗАЛГАХГҮЙ» — тэр нь эх
 *    кодыг grep-дэж барина.  Тайлбар хуучирдаг, тест хуучирдаггүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EchoEngine } from '../src/engine/EchoEngine.ts';
import { estimateTokens, flattenTurns } from '../src/engine/InferenceEngine.ts';
import { planVariant, meetsRequirements, type HardwareProfile } from '../src/hardware.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/* ================================================================== */
/*  1. ТӨЛБӨРТЭЙ ИНФЕРЕНС ХОРИГЛОХ — эдийн засгийн гол шаардлага       */
/* ================================================================== */

/** `src/` доорх бүх .ts файлыг цуглуулна. */
function allSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allSources(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('локал runtime нь ТӨЛБӨРТЭЙ LLM API руу ХЭЗЭЭ Ч залгахгүй', () => {
  // §3: «Core inference must have NO per-token fee.»
  const banned = [
    'api.anthropic.com',
    'api.openai.com',
    'generativelanguage.googleapis.com',
    'api.groq.com',
    'api.together.xyz',
    'openrouter.ai',
    'api.mistral.ai',
    'api.cohere.',
    'api.cloudflare.com/client/v4/accounts', // Workers AI REST
    '@cf/meta/',
    '@cf/qwen/',
  ];

  const offenders: string[] = [];
  for (const file of allSources(SRC)) {
    const text = readFileSync(file, 'utf8');
    // Тайлбар мөрийг хасна — «бид эднийг дуудахгүй» гэсэн ТАЙЛБАР нь
    // зөрчил биш.
    const code = text
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n');
    for (const host of banned) {
      if (code.includes(host)) offenders.push(`${file}: ${host}`);
    }
  }
  assert.deepEqual(offenders, [], `Төлбөртэй инференсийн хаяг олдлоо:\n${offenders.join('\n')}`);
});

test('llama.cpp хөдөлгүүр нь ЗӨВХӨН 127.0.0.1 рүү залгана', () => {
  const src = readFileSync(join(SRC, 'engine', 'LlamaCppEngine.ts'), 'utf8');
  const urls = [...src.matchAll(/https?:\/\/[^\s'"`$}]+/g)].map((m) => m[0]);
  const external = urls.filter((u) => !u.startsWith('http://127.0.0.1'));
  assert.deepEqual(external, [], `Гадаад хаяг: ${external.join(', ')}`);
  // Хост нь ХАТУУ бичигдсэн байх ёстой — тохируулах боломжтой болгох нь
  // сүлжээнд ил гаргах эрсдэл.
  //
  // ⚠️ 2026-09-09-ЭЭС ТУШААЛЫН МӨР `perfProfile.ts`-Д УГСАРНА.  Тестийг
  //    тэр файл руу ЗӨӨВ, БОЛИУЛААГҮЙ — «хост нь хатуу бичигдсэн» гэсэн
  //    инвариант нь хаана угсрагдаж байгаагаас үл хамааран хүчинтэй.
  const argsSrc = readFileSync(join(SRC, 'perfProfile.ts'), 'utf8');
  assert.ok(
    argsSrc.includes("'--host', '127.0.0.1'"),
    'buildLlamaArgs нь хостыг ХАТУУ 127.0.0.1 гэж бичих ёстой',
  );
  // Хөдөлгүүр нь тушаалын мөрөө өөрөө угсрахаа болив — угсрагчийг Л дуудна.
  assert.ok(src.includes('buildLlamaArgs('));
});

/* ================================================================== */
/*  2. EchoEngine — гэрээ                                              */
/* ================================================================== */

test('Echo нь ЗААВАЛ done-оор дуусна', async () => {
  const e = new EchoEngine();
  const kinds: string[] = [];
  for await (const c of e.generate({ turns: [{ role: 'user', content: 'сайн уу' }] })) {
    kinds.push(c.type);
  }
  assert.equal(kinds.at(-1), 'done');
});

test('Echo нь ӨӨРИЙГӨӨ ЗАРЛАНА — хуурамч дүр эсгэхгүй', async () => {
  const e = new EchoEngine();
  let text = '';
  for await (const c of e.generate({ turns: [{ role: 'user', content: 'хэдэн төсөл вэ' }] })) {
    if (c.type === 'token') text += c.text;
  }
  assert.ok(text.includes('загвар'), 'загвар суугаагүйг хэлэх ёстой');
  assert.ok(text.includes('суугаагүй'));
  assert.equal(e.info().engine, 'echo');
});

test('Echo нь нотолгоог жагсааж, ЭШЛЭЛ гаргана', async () => {
  const body = [
    '<<<MGLAI-EVIDENCE>>>',
    '[1] id=c-1 баримт=BNBD-21-01 хуудас=17',
    'гарчиг: Галын аюулгүй байдал',
    'Гарц хоёроос доошгүй.',
    '---',
    '<<<END-MGLAI-EVIDENCE>>>',
    '',
    'Асуулт: хэдэн гарц вэ',
  ].join('\n');

  const e = new EchoEngine();
  let text = '';
  for await (const c of e.generate({ turns: [{ role: 'user', content: body }] })) {
    if (c.type === 'token') text += c.text;
  }
  assert.ok(text.includes('id=c-1'));
  assert.ok(text.includes('Галын аюулгүй байдал'));
  // `confidence.ts`-ийн `extractCitationIds` нь [n]-ийг уншина.
  assert.ok(/\[1\]/.test(text));
});

test('Echo нь нотолгоогүй үед ҮНЭНИЙГ хэлнэ, зохиохгүй', async () => {
  const e = new EchoEngine();
  let text = '';
  for await (const c of e.generate({ turns: [{ role: 'user', content: 'Асуулт: гал' }] })) {
    if (c.type === 'token') text += c.text;
  }
  assert.ok(text.includes('олдсонгүй'));
});

test('Echo нь цуцлалтыг хүндэтгэнэ', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const e = new EchoEngine();
  const chunks: string[] = [];
  for await (const c of e.generate({
    turns: [{ role: 'user', content: 'урт асуулт' }],
    signal: ctrl.signal,
  })) {
    chunks.push(c.type);
  }
  assert.equal(chunks.at(-1), 'done');
});

test('load нь ИДЕМПОТЕНТ', async () => {
  const e = new EchoEngine();
  await e.load();
  const first = (await e.health()).uptimeMs;
  await e.load();
  assert.equal(e.info().loaded, true);
  assert.ok(first !== null);
});

/* ================================================================== */
/*  3. Токены таамаг                                                   */
/* ================================================================== */

test('кирилл нь латинаас ИЛҮҮ токен иднэ гэж тооцно', () => {
  const mn = estimateTokens('барилгын ажлын зураг');
  const en = estimateTokens('construction working drawing');
  // Урт нь ойролцоо ч кирилл нь илүү токен — BPE нь латинд оновчтой.
  assert.ok(mn > en, `mn=${mn} en=${en}`);
});

test('flattenTurns нь ТУСЛАХ-аар төгсөнө', () => {
  const s = flattenTurns([
    { role: 'system', content: 'дүрэм' },
    { role: 'user', content: 'асуулт' },
  ]);
  assert.ok(s.endsWith('ТУСЛАХ:'));
  assert.ok(s.includes('СИСТЕМ: дүрэм'));
});

/* ================================================================== */
/*  4. Төхөөрөмжийн төлөвлөлт                                          */
/* ================================================================== */

function hw(over: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    os: 'win32 10.0.26200',
    arch: 'x64',
    cpu: 'Intel Core i7-12700KF',
    cpuCores: 20,
    // ⚠️ 12 физик / 20 логик — i7-12700KF-ийн БОДИТ тоо (8 P + 4 E).
    //    Урсгалын төлөвлөлт нь ФИЗИК цөмөөс гардаг тул хоёрыг ялгах нь
    //    тестэд ч чухал.
    cpuPhysicalCores: 12,
    ramMb: 21504,
    freeRamMb: 9000,
    gpu: 'NVIDIA GeForce RTX 3070',
    vramMb: 8192,
    vramFreeMb: 7800,
    cuda: '12.4',
    isLaptop: false,
    onBattery: false,
    detectedAt: '2026-09-08T00:00:00Z',
    ...over,
  };
}

test('лавлагааны машин (RTX 3070, 8 GB) нь бүх давхаргыг GPU-д тавина', () => {
  const p = planVariant(hw());
  assert.equal(p.viable, true);
  assert.equal(p.gpuLayers, -1);
  assert.equal(p.contextTokens, 8192);
});

test('6 GB VRAM нь бүх давхарга ГЭХДЭЭ 4K контекст', () => {
  const p = planVariant(hw({ vramMb: 6144 }));
  assert.equal(p.gpuLayers, -1);
  assert.equal(p.contextTokens, 4096);
});

test('4 GB VRAM нь ХЭСЭГЧИЛСЭН буулгалт', () => {
  const p = planVariant(hw({ vramMb: 4096 }));
  assert.equal(p.gpuLayers, 20);
});

test('GPU ИЛРЭЭГҮЙ нь «ажиллахгүй» ГЭСЭН ҮГ БИШ — CPU дээр ажиллана', () => {
  const p = planVariant(hw({ gpu: null, vramMb: null, cuda: null }));
  assert.equal(p.viable, true);
  assert.equal(p.gpuLayers, 0);
  assert.ok(p.reason.includes('CPU'));
});

test('RAM хүрэлцэхгүй машин нь echo рүү унана', () => {
  const p = planVariant(hw({ ramMb: 4096, vramMb: null, gpu: null }));
  assert.equal(p.viable, false);
  assert.equal(p.runtimeVariant, 'echo');
});

test('релизийн доод шаардлага шалгагдана', () => {
  assert.equal(meetsRequirements(hw(), { minVramMb: 6000, minRamMb: 16000 }).ok, true);
  assert.equal(meetsRequirements(hw({ vramMb: 4096 }), { minVramMb: 6000 }).ok, false);
  assert.equal(meetsRequirements(hw({ ramMb: 8000 }), { minRamMb: 16000 }).ok, false);
});

test('VRAM МЭДЭГДЭХГҮЙ бол VRAM шаардлага ХОРИГЛОХГҮЙ', () => {
  // «Илрээгүй» нь «байхгүй» гэсэн үг биш — CPU зам үлдэнэ.
  assert.equal(meetsRequirements(hw({ vramMb: null }), { minVramMb: 6000 }).ok, true);
});

/* ================================================================== */
/*  5. ХЭРЭГСЛИЙН ҮР ДҮН — 2026-09-08-ны регрессийн хамгаалалт          */
/* ================================================================== */

test('Echo нь ERP-ийн хэрэгслийн үр дүнг ХАРУУЛНА', async () => {
  // ⚠️ РЕГРЕСС: өмнө нь Echo зөвхөн нотолгоо хайдаг байсан тул
  //    `list_projects` бодит өгөгдөл авчирсан ч «эх сурвалж олдсонгүй»
  //    гэж хариулдаг байв — дутуу биш, ТӨӨРӨГДҮҮЛЭХ хариу.
  const body = [
    '<<<MGLAI-TOOLS>>>',
    'огноо: 2026-09-08',
    'list_projects: {"total_visible":12,"returned":12}',
    '<<<END-MGLAI-TOOLS>>>',
    '',
    'Асуулт: Манай хэдэн төсөл байна?',
  ].join('\n');

  const e = new EchoEngine();
  let text = '';
  for await (const c of e.generate({ turns: [{ role: 'user', content: body }] })) {
    if (c.type === 'token') text += c.text;
  }
  assert.ok(text.includes('list_projects'), 'хэрэгслийн нэр алга');
  assert.ok(text.includes('12'), 'бодит тоо алга');
  assert.ok(text.includes('2026-09-08'), 'огноо алга');
  // ⚠️ ХАМГИЙН ЧУХАЛ: өгөгдөл ирсэн атал «олдсонгүй» гэж хэлж БОЛОХГҮЙ.
  assert.equal(
    text.includes('тохирох баталгаажсан эх сурвалж олдсонгүй'),
    false,
    'өгөгдөл ирсэн атал «олдсонгүй» гэж хэлсэн',
  );
});

test('Echo нь хэрэгсэл БА нотолгоо хоёуланг зэрэг харуулна', async () => {
  const body = [
    '<<<MGLAI-TOOLS>>>',
    'огноо: 2026-09-08',
    'get_upcoming_deadlines: {"count":3}',
    '<<<END-MGLAI-TOOLS>>>',
    '',
    '<<<MGLAI-EVIDENCE>>>',
    '[1] id=c-1 баримт=BNBD-21-01 хуудас=17',
    'гарчиг: Галын аюулгүй байдал',
    'Гарц хоёроос доошгүй.',
    '---',
    '<<<END-MGLAI-EVIDENCE>>>',
    '',
    'Асуулт: хугацаа ба гарц',
  ].join('\n');

  const e = new EchoEngine();
  let text = '';
  for await (const c of e.generate({ turns: [{ role: 'user', content: body }] })) {
    if (c.type === 'token') text += c.text;
  }
  assert.ok(text.includes('get_upcoming_deadlines'));
  assert.ok(text.includes('Галын аюулгүй байдал'));
  assert.ok(/\[1\]/.test(text), 'эшлэлийн дугаар алга');
});

test('хэрэгсэл ирсэн ч норм олдоогүйг ЗӨВ ялгаж хэлнэ', async () => {
  const body = [
    '<<<MGLAI-TOOLS>>>',
    'огноо: 2026-09-08',
    'list_projects: {"total_visible":5}',
    '<<<END-MGLAI-TOOLS>>>',
    '',
    'Асуулт: хэдэн төсөл',
  ].join('\n');
  const e = new EchoEngine();
  let text = '';
  for await (const c of e.generate({ turns: [{ role: 'user', content: body }] })) {
    if (c.type === 'token') text += c.text;
  }
  assert.ok(text.includes('ERP-ийн бүртгэлээс'), 'ялгаж хэлээгүй');
});
