/**
 * MGL AI · ТӨХӨӨРӨМЖИЙН ИЛРҮҮЛЭЛТ (§37).
 *
 * ⚠️ ХЭМЖИНЭ, ТААМАГЛАХГҮЙ.  Ажилтны машинууд ижил биш: заримд нь GPU
 *    огт байхгүй, заримд нь 6 GB, лавлагааны машин 8 GB.  «Бүгд RTX 3070
 *    байна» гэж таамаглах нь VRAM хүрэлцэхгүй машин дээр чимээгүй
 *    унана эсвэл системийг зогсоотол хуудаслана.
 *
 * ⚠️ NVIDIA-ГААС ГАДНА GPU БАЙХАД: `nvidia-smi` олдохгүй бол VRAM `null`
 *    болно — тэр нь «GPU байхгүй» ГЭСЭН ҮГ БИШ, «мэдэхгүй» гэсэн үг.
 *    Шийдвэр гаргагч (`recommendVariant`) хоёрыг ЯЛГАНА.
 */
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface HardwareProfile {
  os: string;
  arch: string;
  cpu: string;
  /** ЛОГИК урсгалын тоо (`os.cpus().length`). */
  cpuCores: number;
  /**
   * ФИЗИК цөмийн тоо.
   *
   * ⚠️ ЭНЭ НЬ `cpuCores`-ООС ӨӨР бөгөөд ялгаа нь ЧУХАЛ (§10).
   *    i7-12700KF нь 12 физик (8 P + 4 E) / 20 логик.  Hyper-threading-
   *    ийн хос урсгал нь ижил гүйцэтгэх нэгжийг хуваалцдаг тул
   *    llama.cpp-ийн матрицын үржвэрт ХУРД НЭМДЭГГҮЙ — харин 20 урсгал
   *    ачаалах нь хөтөч, DWM-д цаг үлдээхгүй.  Тиймээс урсгалын
   *    төлөвлөлт нь ФИЗИК цөмөөс гарна.
   *
   * ⚠️ Илрүүлж чадаагүй бол `logical / 2` гэж ойролцоолно — тэр нь
   *    HT-тэй машинд зөв, HT-гүй машинд БАГА тал руу алдана (аюулгүй).
   */
  cpuPhysicalCores: number;
  ramMb: number;
  freeRamMb: number;
  /** `null` = илрүүлж чадсангүй (GPU байхгүй гэсэн үг БИШ). */
  gpu: string | null;
  vramMb: number | null;
  /** Хэмжилтийн үеийн ЧӨЛӨӨТ VRAM.  `null` = мэдэхгүй. */
  vramFreeMb: number | null;
  cuda: string | null;
  /**
   * Зөөврийн компьютер эсэх (§29).  `null` = тодорхойгүй.
   *
   * ⚠️ БАТЕРЕЙ БАЙГААГААР ТАНИНА.  Төгс бус (батерейтай tablet-PC,
   *    UPS-тай суурин машин) ч практикт найдвартай бөгөөд ямар ч
   *    нэмэлт эрх шаардахгүй.
   */
  isLaptop: boolean | null;
  /** Яг одоо БАТЕРЕЙ дээр ажиллаж байгаа эсэх (§29).  `null` = мэдэхгүй. */
  onBattery: boolean | null;
  detectedAt: string;
}

async function nvidia(): Promise<{
  gpu: string;
  vramMb: number;
  vramFreeMb: number | null;
  cuda: string | null;
} | null> {
  try {
    const { stdout } = await exec(
      'nvidia-smi',
      [
        '--query-gpu=name,memory.total,driver_version,memory.free',
        '--format=csv,noheader,nounits',
      ],
      { timeout: 5000, windowsHide: true },
    );
    const line = stdout.trim().split('\n')[0];
    if (!line) return null;
    const [name, mem, driver, free] = line.split(',').map((s) => s.trim());
    const vramMb = Number(mem);
    const vramFreeMb = Number(free);
    if (!name || !Number.isFinite(vramMb)) return null;

    let cuda: string | null = driver ?? null;
    try {
      const v = await exec('nvidia-smi', ['--query', '--display=COMPUTE'], {
        timeout: 5000,
        windowsHide: true,
      });
      const m = v.stdout.match(/CUDA Version\s*:\s*([\d.]+)/i);
      if (m) cuda = m[1]!;
    } catch {
      // драйверын хувилбар үлдэнэ
    }
    return { gpu: name, vramMb, vramFreeMb: Number.isFinite(vramFreeMb) ? vramFreeMb : null, cuda };
  } catch {
    return null;
  }
}

/**
 * ФИЗИК цөм + батерейн төлөв — ГАНЦ PowerShell дуудлагаар.
 *
 * ⚠️ ГУРВАН ТУСДАА ДУУДЛАГА БИШ.  PowerShell-ийн процесс асаах зардал
 *    нь ~400 мс тул гурав дахин асаах нь эхлэлтийг секундээр уртасгана.
 *    Нэг скриптээс JSON буцаана.
 *
 * ⚠️ АЛДАА ГАРВАЛ БҮГД `null` — «мэдэхгүй».  0 эсвэл false гэж бичих нь
 *    ХУДАЛ баримт болж, түүн дээр тулгуурласан профайлын сонголт
 *    буруу гарна.
 *
 * ⚠️ `Win32_Battery` нь ЗӨӨВРИЙН машиныг таних цорын ганц найдвартай,
 *    эрх шаардахгүй арга.  `BatteryStatus`-ийн 2 нь «AC-д залгаатай»
 *    (WMI-ийн баримтжуулсан утга); бусад нь цэнэг зарж байна гэсэн үг.
 */
async function windowsFacts(): Promise<{
  physicalCores: number | null;
  isLaptop: boolean | null;
  onBattery: boolean | null;
}> {
  if (os.platform() !== 'win32') {
    return { physicalCores: null, isLaptop: null, onBattery: null };
  }
  try {
    const script = [
      '$c = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum;',
      '$b = @(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue);',
      '$st = if ($b.Count -gt 0) { $b[0].BatteryStatus } else { $null };',
      '[pscustomobject]@{ cores = $c; hasBattery = ($b.Count -gt 0); status = $st } | ConvertTo-Json -Compress',
    ].join(' ');
    const { stdout } = await exec('powershell', ['-NoProfile', '-Command', script], {
      timeout: 12_000,
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout.trim()) as {
      cores: number | null;
      hasBattery: boolean;
      status: number | null;
    };
    const cores = Number(parsed.cores);
    return {
      physicalCores: Number.isFinite(cores) && cores > 0 ? cores : null,
      isLaptop: parsed.hasBattery,
      // BatteryStatus 2 = AC-д залгаатай.  Батерей огт байхгүй бол `false`.
      onBattery: parsed.hasBattery ? parsed.status !== 2 : false,
    };
  } catch {
    return { physicalCores: null, isLaptop: null, onBattery: null };
  }
}

export async function detectHardware(): Promise<HardwareProfile> {
  const cpus = os.cpus();
  // ⚠️ ЗЭРЭГЦЭЭ — эхлэлтийн хугацаа нь удаан хоёрынхоос Л хамаарна.
  const [gpu, win] = await Promise.all([nvidia(), windowsFacts()]);

  return {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpu: cpus[0]?.model.trim() ?? 'unknown',
    cpuCores: cpus.length,
    // ⚠️ Илрүүлж чадаагүй бол логикийн ТАЛ — HT-тэй машинд зөв, HT-гүйд
    //    бага тал руу алдана (илүү аюулгүй чиглэл).
    cpuPhysicalCores: win.physicalCores ?? Math.max(1, Math.round(cpus.length / 2)),
    ramMb: Math.round(os.totalmem() / 1024 / 1024),
    freeRamMb: Math.round(os.freemem() / 1024 / 1024),
    gpu: gpu?.gpu ?? null,
    vramMb: gpu?.vramMb ?? null,
    vramFreeMb: gpu?.vramFreeMb ?? null,
    cuda: gpu?.cuda ?? null,
    isLaptop: win.isLaptop,
    onBattery: win.onBattery,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * ЯГ ОДООГИЙН нөөцийн байдал — хямд, давтан дуудагдана (§28, §29).
 *
 * ⚠️ `detectHardware`-ийг ДАВТАН ДУУДАХГҮЙ.  Тэр нь PowerShell асаадаг
 *    (~400 мс) тул диагностикийн самбар 2 секунд тутам дуудвал өөрөө
 *    ачаалал үүсгэнэ.  Энэ нь зөвхөн nvidia-smi (нэг дуудлага, ~15 мс).
 */
export async function sampleGpu(): Promise<{
  utilPct: number | null;
  vramUsedMb: number | null;
  vramFreeMb: number | null;
} | null> {
  try {
    const { stdout } = await exec(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used,memory.free', '--format=csv,noheader,nounits'],
      { timeout: 4000, windowsHide: true },
    );
    const [u, used, free] = stdout
      .trim()
      .split('\n')[0]!
      .split(',')
      .map((s) => Number(s.trim()));
    return {
      utilPct: Number.isFinite(u) ? u! : null,
      vramUsedMb: Number.isFinite(used) ? used! : null,
      vramFreeMb: Number.isFinite(free) ? free! : null,
    };
  } catch {
    return null;
  }
}

export interface VariantPlan {
  runtimeVariant: string;
  /** GPU руу буулгах давхарга.  0 = зөвхөн CPU. */
  gpuLayers: number;
  contextTokens: number;
  reason: string;
  /** Ажиллах уу, эсвэл огт зөвлөхгүй юу. */
  viable: boolean;
}

/**
 * ⚠️ ЦЭВЭР ФУНКЦ — тестлэгдэнэ.  Төхөөрөмжөөс хамааран ямар хувилбар
 *    ажиллуулахыг шийднэ.
 *
 * Тоонуудын үндэслэл (4B Q4_K_M ≈ 2.5 GB жин):
 *   • 8 GB VRAM  — бүх давхарга GPU-д, 8K контекст тохирно.
 *   • 6 GB VRAM  — бүх давхарга багтана, гэвч KV кэшид зай бага → 4K.
 *   • 4 GB VRAM  — хэсэгчилсэн буулгалт, 4K.
 *   • GPU байхгүй — CPU дээр ажиллана, удаан ч ажиллана (i7-12700KF нь
 *     12 цөмтэй).  «Ажиллахгүй» гэж хэлэх нь буруу байх байсан.
 *   • 8 GB-аас бага RAM — CPU-д ч багтахгүй.
 */
export function planVariant(hw: HardwareProfile): VariantPlan {
  const ctxBig = 8192;
  const ctxSmall = 4096;

  if (hw.ramMb < 8000) {
    return {
      runtimeVariant: 'echo',
      gpuLayers: 0,
      contextTokens: ctxSmall,
      reason: `RAM ${hw.ramMb} MB — 4B загварт хүрэлцэхгүй (доод тал нь 8 GB).`,
      viable: false,
    };
  }

  if (hw.vramMb === null) {
    return {
      runtimeVariant: 'employee-4b-q4',
      gpuLayers: 0,
      contextTokens: ctxSmall,
      // ⚠️ «GPU илрээгүй» ба «GPU байхгүй» хоёрыг ялгаж хэлнэ.
      reason:
        'NVIDIA GPU илрээгүй (nvidia-smi олдсонгүй). CPU дээр ажиллана — удаан боловч ажиллана.',
      viable: true,
    };
  }

  if (hw.vramMb >= 7500) {
    return {
      runtimeVariant: 'employee-4b-q4',
      gpuLayers: -1,
      contextTokens: ctxBig,
      reason: `VRAM ${hw.vramMb} MB — бүх давхарга GPU дээр, 8K контекст.`,
      viable: true,
    };
  }

  if (hw.vramMb >= 5500) {
    return {
      runtimeVariant: 'employee-4b-q4',
      gpuLayers: -1,
      contextTokens: ctxSmall,
      reason: `VRAM ${hw.vramMb} MB — бүх давхарга багтана, KV кэшид зай багатай тул 4K.`,
      viable: true,
    };
  }

  if (hw.vramMb >= 3500) {
    return {
      runtimeVariant: 'employee-4b-q4',
      gpuLayers: 20,
      contextTokens: ctxSmall,
      reason: `VRAM ${hw.vramMb} MB — хэсэгчилсэн буулгалт (20 давхарга).`,
      viable: true,
    };
  }

  return {
    runtimeVariant: 'employee-4b-q4',
    gpuLayers: 0,
    contextTokens: ctxSmall,
    reason: `VRAM ${hw.vramMb} MB хэт бага — зөвхөн CPU.`,
    viable: true,
  };
}

/** Релизийн доод шаардлагыг хангаж байгаа эсэх. */
export function meetsRequirements(
  hw: HardwareProfile,
  req: { minVramMb?: number | null; minRamMb?: number | null },
): { ok: boolean; reason: string } {
  if (req.minRamMb && hw.ramMb < req.minRamMb) {
    return { ok: false, reason: `RAM ${hw.ramMb} MB < шаардлагатай ${req.minRamMb} MB` };
  }
  if (req.minVramMb) {
    // ⚠️ VRAM мэдэгдэхгүй бол ХОРИГЛОХГҮЙ — CPU дээр ажиллах зам бий.
    if (hw.vramMb !== null && hw.vramMb < req.minVramMb) {
      return { ok: false, reason: `VRAM ${hw.vramMb} MB < шаардлагатай ${req.minVramMb} MB` };
    }
  }
  return { ok: true, reason: 'тохирно' };
}
