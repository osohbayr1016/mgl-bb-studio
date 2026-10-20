/**
 * MGL AI · ГҮЙЦЭТГЭЛИЙН ПРОФАЙЛЫН ТЕСТ (§7–§13).
 *
 * ⚠️ ЭНЭ ТЕСТ НЬ GPU-ГҮЙГЭЭР АЖИЛЛАНА.  `planLaunch` нь ЦЭВЭР функц тул
 *    аль ч машин дээр «6 GB картан дээр юу болох вэ», «зөөврийн
 *    компьютер дээр юу болох вэ» гэдгийг ХЭМЖИЖ болно — тэр нь §43-ийн
 *    «сул төхөөрөмж дээр тест» шаардлагыг хангах ЦОРЫН ГАНЦ бодит арга
 *    (бидэнд 6 GB карт байхгүй).
 *
 * ⚠️ ХАМГИЙН ЧУХАЛ БАТАЛГАА: VRAM-ЫН НӨӨЦ.  Бүх хувилбарт төлөвлөсөн
 *    оргил нь картын хэмжээнээс НӨӨЦИЙН ХЭМЖЭЭГЭЭР бага байх ёстой.
 *    Энэ баталгаа унавал «компьютер хөшиж байна» гэсэн гажиг ЭРГЭЖ ИРНЭ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  autoProfile,
  buildLlamaArgs,
  isPerfProfile,
  kvBytesPerToken,
  planLaunch,
  planThreads,
  PERF_PROFILES,
  type PerfProfile,
} from '../src/perfProfile.ts';
import type { HardwareProfile } from '../src/hardware.ts';

/** Лавлагааны машин — i7-12700KF · 21 GB RAM · RTX 3070 8 GB. */
function hw(over: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    os: 'win32 10.0.26200',
    arch: 'x64',
    cpu: '12th Gen Intel(R) Core(TM) i7-12700KF',
    cpuCores: 20,
    cpuPhysicalCores: 12,
    ramMb: 21504,
    freeRamMb: 9000,
    gpu: 'NVIDIA GeForce RTX 3070',
    vramMb: 8192,
    vramFreeMb: 7800,
    cuda: '12.4',
    isLaptop: false,
    onBattery: false,
    detectedAt: '2026-09-09T00:00:00Z',
    ...over,
  };
}

/** Qwen3-8B-Q4_K_M — хэмжигдсэн бодит хэмжээ (5 027 784 512 байт). */
const QWEN8B = {
  bytesOnDisk: 5_027_784_512,
  kvBytesPerTokenF16: 147_456,
  artifactName: 'Qwen3-8B-Q4_K_M.gguf',
};
const QWEN4B = {
  bytesOnDisk: 2_497_281_120,
  kvBytesPerTokenF16: 147_456,
  artifactName: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
};

/* ================================================================== */
/*  1. VRAM-ЫН НӨӨЦ — ГОЛ БАТАЛГАА                                     */
/* ================================================================== */

test('VRAM-ын нөөц: бүх профайл дээр оргил нь картад багтана', () => {
  for (const profile of PERF_PROFILES) {
    const plan = planLaunch({
      hardware: hw(),
      profile,
      model: QWEN8B,
      desiredContextTokens: 8192,
    });
    assert.ok(plan.viable, `${profile}: ажиллах ёстой`);
    assert.ok(plan.estimatedVramPeakMb !== null, `${profile}: оргил тооцоологдох ёстой`);
    assert.ok(
      plan.estimatedVramPeakMb! < 8192,
      `${profile}: оргил ${plan.estimatedVramPeakMb} MiB нь 8192-оос БАГА байх ёстой`,
    );
    // ⚠️ ХАМГИЙН БАГА НӨӨЦ 1 GB.  Үүнээс бага бол WDDM зөөлт эхэлнэ.
    assert.ok(
      plan.vramHeadroomMb! >= 1000,
      `${profile}: нөөц ${plan.vramHeadroomMb} MiB нь дор хаяж 1000 байх ёстой`,
    );
  }
});

test('VRAM-ын нөөц: balanced нь хуучин хэмжигдсэн 7505 MiB-ээс МЭДЭГДЭХҮЙЦ бага', () => {
  const plan = planLaunch({
    hardware: hw(),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  // 2026-09-09-нд ХЭМЖИГДСЭН хуучин оргил: 7505 MiB (нөөц 687 MiB).
  assert.ok(
    plan.estimatedVramPeakMb! <= 6600,
    `хуучин 7505 MiB-ээс мэдэгдэхүйц бага байх ёстой, гарсан ${plan.estimatedVramPeakMb}`,
  );
});

test('eco нь balanced-ээс ИЛҮҮ их нөөц үлдээнэ', () => {
  const eco = planLaunch({
    hardware: hw(),
    profile: 'eco',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  const bal = planLaunch({
    hardware: hw(),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  assert.ok(
    eco.vramHeadroomMb! > bal.vramHeadroomMb!,
    `eco нөөц ${eco.vramHeadroomMb} > balanced ${bal.vramHeadroomMb} байх ёстой`,
  );
});

test('6 GB карт: 8B загвар нь хэсэгчилсэн буулгалт руу орж, УНАХГҮЙ', () => {
  const plan = planLaunch({
    hardware: hw({ vramMb: 6144, vramFreeMb: 5900 }),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  assert.ok(plan.viable, '6 GB карт дээр ажиллах ёстой (удаан ч ажиллана)');
  // 4.8 GB жин + 1.8 GB нөөц > 6 GB тул бүх давхарга багтахгүй.
  // ⚠️ Давхаргын ТООГ бид таамаглахгүй — llama.cpp `--fit-target`-аар
  //    өөрөө тааруулна.  Тестийн баталгаа нь «бүгдийг оруулаагүй» +
  //    «нөөц зааж өгсөн» хоёр.
  assert.equal(plan.gpuLayers, 'auto', 'давхаргыг llama.cpp-д даатгах ёстой');
  assert.equal(plan.fitTargetMb, 1800, 'balanced-ийн нөөц дамжих ёстой');
  assert.ok(plan.notices.length > 0, 'хэрэглэгчид буултыг ХЭЛЭХ ёстой');
});

test('6 GB карт: 4B загвар нь бүрэн GPU дээр багтана', () => {
  const plan = planLaunch({
    hardware: hw({ vramMb: 6144, vramFreeMb: 5900 }),
    profile: 'balanced',
    model: QWEN4B,
    desiredContextTokens: 8192,
  });
  assert.equal(plan.gpuLayers, -1, '4B нь 6 GB картад бүрэн багтах ёстой');
  assert.ok(plan.estimatedVramPeakMb! < 6144 - 1500);
});

test('GPU байхгүй: CPU дээр ажиллана, УНАХГҮЙ (§14-ийн gracious fallback)', () => {
  const plan = planLaunch({
    hardware: hw({ vramMb: null, vramFreeMb: null, gpu: null, cuda: null }),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  assert.ok(plan.viable);
  assert.equal(plan.gpuLayers, 0);
  assert.equal(plan.estimatedVramPeakMb, null, 'GPU байхгүйд VRAM тооцоо БАЙХГҮЙ');
  assert.ok(plan.notices.some((n) => n.includes('CPU')));
});

test('RAM хүрэлцэхгүй: viable=false, шалтгаан нь ТОДОРХОЙ', () => {
  const plan = planLaunch({
    hardware: hw({ ramMb: 4096, vramMb: null, gpu: null }),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  assert.equal(plan.viable, false);
  assert.match(plan.reason, /RAM/);
});

/* ================================================================== */
/*  2. CPU УРСГАЛ (§10)                                                */
/* ================================================================== */

test('CPU урсгал: БҮХ цөмийг ХЭЗЭЭ Ч авахгүй', () => {
  for (const cores of [4, 6, 8, 12, 16, 24]) {
    for (const profile of PERF_PROFILES) {
      const { threads } = planThreads(cores, cores * 2, profile, false);
      assert.ok(threads >= 2, `${cores} цөм / ${profile}: дор хаяж 2`);
      assert.ok(
        threads <= Math.max(2, cores - 2),
        `${cores} цөм / ${profile}: ${threads} нь цөм−2-оос ихгүй байх ёстой`,
      );
    }
  }
});

test('CPU урсгал: ГАНЦ ТОО ХАТУУ БИЧИГДЭЭГҮЙ — машинаас хамаарна (§10)', () => {
  const small = planThreads(4, 8, 'balanced', false).threads;
  const big = planThreads(16, 32, 'balanced', false).threads;
  assert.notEqual(small, big, 'өөр машин өөр тоо гаргах ёстой');
  assert.ok(big > small);
});

test('CPU урсгал: бүрэн GPU буулгалт дээр цөөхөн урсгал хангалттай', () => {
  const gpu = planThreads(12, 20, 'balanced', true).threads;
  const cpu = planThreads(12, 20, 'balanced', false).threads;
  assert.ok(gpu < cpu, 'GPU дээр CPU урсгал бага байх ёстой');
  assert.ok(gpu <= 4);
});

test('eco < balanced < performance гэсэн урсгалын дараалал', () => {
  const t = (p: PerfProfile) => planThreads(12, 20, p, false).threads;
  assert.ok(t('eco') < t('balanced'));
  assert.ok(t('balanced') < t('performance'));
});

/* ================================================================== */
/*  3. ПРОЦЕССЫН ЗЭРЭГЛЭЛ (§9)                                         */
/* ================================================================== */

test('ЗЭРЭГЛЭЛ: realtime/high РУУ ХЭЗЭЭ Ч ТАВИХГҮЙ (§9)', () => {
  for (const profile of PERF_PROFILES) {
    const plan = planLaunch({
      hardware: hw(),
      profile,
      model: QWEN8B,
      desiredContextTokens: 8192,
    });
    assert.ok(plan.llamaPriority <= 0, `${profile}: llama priority ${plan.llamaPriority} ≤ 0`);
    assert.ok(
      plan.processPriority === 'below_normal' || plan.processPriority === 'normal',
      `${profile}: процессын зэрэглэл нь below_normal | normal Л байна`,
    );
  }
});

test('ЗЭРЭГЛЭЛ: өгөгдмөл (balanced) нь интерактив програмд зам тавина', () => {
  const plan = planLaunch({
    hardware: hw(),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  assert.equal(plan.processPriority, 'below_normal');
  assert.equal(plan.llamaPriority, -1);
});

/* ================================================================== */
/*  4. АВТОМАТ СОНГОЛТ (§13, §29)                                      */
/* ================================================================== */

test('автомат профайл: суурин + том карт → balanced', () => {
  assert.equal(autoProfile(hw()), 'balanced');
});

test('автомат профайл: батерей дээр → eco (§29)', () => {
  assert.equal(autoProfile(hw({ isLaptop: true, onBattery: true })), 'eco');
});

test('автомат профайл: зөөврийн компьютер (цэнэглэж байгаа ч) → eco', () => {
  assert.equal(autoProfile(hw({ isLaptop: true, onBattery: false })), 'eco');
});

test('автомат профайл: бага VRAM → eco (нөөц үлдээх нь чухал)', () => {
  assert.equal(autoProfile(hw({ vramMb: 4096 })), 'eco');
});

test('автомат профайл: ХЭЗЭЭ Ч performance-ыг өөрөө сонгохгүй (§13)', () => {
  const cases = [hw(), hw({ vramMb: 24_576 }), hw({ ramMb: 65_536, vramMb: 16_384 })];
  for (const h of cases) {
    assert.notEqual(autoProfile(h), 'performance', 'performance нь ЗӨВХӨН хэрэглэгчийн сонголт');
  }
});

/* ================================================================== */
/*  5. ТУШААЛЫН МӨР — ЗӨВХӨН ДЭМЖИГДСЭН ТУГ (§12)                      */
/* ================================================================== */

/**
 * ⚠️ ЭНЭ ЖАГСААЛТ НЬ `llama-server --help` (b10850)-ЭЭС ГАРСАН.
 *    Энд байхгүй туг гарвал llama-server ЭХЛЭХГҮЙ УНАНА ба «MGL AI
 *    ажиллахгүй байна» гэсэн оношлоход хэцүү байдал үүснэ.
 */
const SUPPORTED_FLAGS = new Set([
  '--model',
  '--host',
  '--port',
  '--ctx-size',
  '--n-gpu-layers',
  '--parallel',
  '--cache-reuse',
  '--threads',
  '--threads-batch',
  '--batch-size',
  '--ubatch-size',
  '--cache-type-k',
  '--cache-type-v',
  '--flash-attn',
  '--prio',
  '--poll',
  '--no-webui',
  '--metrics',
  '--lora',
  // ⚠️ `--fit-target` нь llama.cpp b10850-ийн `-fitt` — «төхөөрөмж
  //    тутамд ҮЛДЭЭХ нөөц, MiB».  Энэ бол VRAM-ын нөөцийг llama.cpp-ийн
  //    өөрийнх нь нягтлан бодох бүртгэлд хүргэх зам.
  '--fit-target',
]);

test('тушаалын мөр: зөвхөн БОДИТ дэмжигдсэн туг (§12)', () => {
  const plan = planLaunch({
    hardware: hw(),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  const args = buildLlamaArgs({
    modelPath: 'C:/x/model.gguf',
    port: 39218,
    plan,
    loraPath: 'C:/x/a.adapter.gguf',
    metrics: true,
  });
  for (const a of args) {
    if (a.startsWith('--')) {
      assert.ok(SUPPORTED_FLAGS.has(a), `${a} нь llama-server --help дээр БАЙХГҮЙ`);
    }
  }
});

test('тушаалын мөр: host нь ҮРГЭЛЖ 127.0.0.1 (аюулгүй байдлын 1-р давхарга)', () => {
  const plan = planLaunch({
    hardware: hw(),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  const args = buildLlamaArgs({ modelPath: 'm.gguf', port: 39218, plan });
  const i = args.indexOf('--host');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], '127.0.0.1');
});

test('тушаалын мөр: адаптергүй бол --lora ОГТ БАЙХГҮЙ', () => {
  const plan = planLaunch({
    hardware: hw(),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  const args = buildLlamaArgs({ modelPath: 'm.gguf', port: 39218, plan, loraPath: null });
  assert.equal(args.includes('--lora'), false);
});

test('тушаалын мөр: --poll 0 (эргэлдэж хүлээхгүй)', () => {
  const plan = planLaunch({
    hardware: hw(),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  const args = buildLlamaArgs({ modelPath: 'm.gguf', port: 39218, plan });
  const i = args.indexOf('--poll');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], '0');
});

/* ================================================================== */
/*  6. KV КЭШ                                                          */
/* ================================================================== */

test('KV: 8 GB картан дээр q8_0 (нөөц чөлөөлөх)', () => {
  const plan = planLaunch({
    hardware: hw(),
    profile: 'balanced',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  assert.equal(plan.kvCacheType, 'q8_0');
  assert.equal(plan.flashAttention, true, 'q8_0 KV нь flash attention шаардана');
});

test('KV: танихгүй загварт `null` — таамаглаж худал тоо гаргахгүй', () => {
  assert.equal(kvBytesPerToken('LlamaXYZ-70B.gguf'), null);
  assert.equal(kvBytesPerToken(null), null);
  // ⚠️ 107 000 нь ХЭМЖИГДСЭН утга (онолын 147 456 биш).  Дэлгэрэнгүйг
  //    `KNOWN_KV_BYTES_PER_TOKEN`-ийн тайлбараас үз.
  assert.equal(kvBytesPerToken('Qwen3-8B-Q4_K_M.gguf'), 107_000);
});

test('isPerfProfile нь дурын мөрийг хүлээж авахгүй', () => {
  assert.equal(isPerfProfile('balanced'), true);
  assert.equal(isPerfProfile('turbo'), false);
  assert.equal(isPerfProfile(null), false);
  assert.equal(isPerfProfile(3), false);
});

/* ================================================================== */
/*  7. КОНТЕКСТЫН БУУЛТ                                                */
/* ================================================================== */

test('контекст багасвал ХЭРЭГЛЭГЧИД ХЭЛНЭ (чимээгүй буулт БАЙХГҮЙ)', () => {
  const plan = planLaunch({
    hardware: hw({ vramMb: 8192 }),
    profile: 'eco',
    model: QWEN8B,
    desiredContextTokens: 8192,
  });
  if (plan.contextTokens < 8192) {
    assert.ok(
      plan.notices.some((n) => n.includes('контекст')),
      'контекст багассаныг мэдэгдэх ЁСТОЙ',
    );
  }
});

test('контекст нь хүссэнээс ХЭЗЭЭ Ч ИХ болохгүй', () => {
  const plan = planLaunch({
    hardware: hw({ vramMb: 24_576 }),
    profile: 'performance',
    model: QWEN4B,
    desiredContextTokens: 4096,
  });
  assert.ok(plan.contextTokens <= 4096);
});
