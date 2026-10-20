/**
 * MGL AI · ХАРДВЕРИЙН АНГИЛАЛ (Session B §10).
 *
 * `ai/runtime/src/hardware.ts` ХЭМЖДЭГ (`detectHardware`), энэ файл
 * АНГИЛДАГ.  Хэмжилтийг дахин бичихгүй — `HardwareProfile`-ыг type-only
 * импортолж, цэвэр функцээр ангилна.
 *
 * ⚠️ VRAM `null` = «МЭДЭХГҮЙ», «GPU байхгүй» БИШ (hardware.ts-ийн дүрэм).
 *    Мэдэхгүй бол CPU_FALLBACK — удаан ч ажиллана.  UNSUPPORTED гэж
 *    хэлэх нь зөвхөн RAM/архитектур хүрэлцэхгүй үед.
 *
 * ⚠️ БОСГО НЬ 8B Q4_K_M-ИЙН ХЭМЖСЭН ТООНООС (6541 MiB ачаалагдсан VRAM,
 *    CLAUDE.md).  4B-д тохирох босгыг planVariant аль хэдийн барьдаг;
 *    энэ ангилал нь ФЛОТЫН ТАЙЛАН ба манифестын `meta.minHardwareClass`
 *    шалгалтад — llama-server-ийн аргументыг энэ файл ШИЙДДЭГГҮЙ
 *    (`perfProfile.ts`-ийн ажил, түүнийг хөндөхгүй).
 *
 * ⚠️ ЗӨВХӨН ТЕХНИКИЙН НИЙЦТЭЙ БАЙДЛЫН МЭДЭЭЛЭЛ (§10, §16).  Хэрэглэгчийн
 *    нэр, хостын нэр, сүлжээний хаяг энд ОРОХГҮЙ — `fleetSummary` нь
 *    флот руу явах ЦОРЫН ГАНЦ хардверийн зураг.
 */
import type { HardwareProfile } from '../../runtime/src/hardware.ts';

export const HARDWARE_CLASSES = [
  'HIGH_GPU',
  'STANDARD_8GB_GPU',
  'LOW_GPU',
  'CPU_FALLBACK',
  'UNSUPPORTED',
] as const;
export type HardwareClass = (typeof HARDWARE_CLASSES)[number];

export function isHardwareClass(v: unknown): v is HardwareClass {
  return typeof v === 'string' && (HARDWARE_CLASSES as readonly string[]).includes(v);
}

/** Доод RAM — 8B Q4 нь CPU-д ~5 GB жин + KV, Windows өөрөө 3-4 GB. */
export const MIN_RAM_MB = 8000;

export interface HardwareClassification {
  hardwareClass: HardwareClass;
  reason: string;
  /** Манифестын `meta.minHardwareClass`-тай харьцуулах эрэмбэ (их = сайн). */
  rank: number;
}

const RANK: Record<HardwareClass, number> = {
  UNSUPPORTED: 0,
  CPU_FALLBACK: 1,
  LOW_GPU: 2,
  STANDARD_8GB_GPU: 3,
  HIGH_GPU: 4,
};

export function classifyHardware(
  hw: Pick<HardwareProfile, 'arch' | 'ramMb' | 'vramMb' | 'gpu'>,
): HardwareClassification {
  if (hw.arch !== 'x64' && hw.arch !== 'arm64') {
    return { hardwareClass: 'UNSUPPORTED', reason: `архитектур ${hw.arch}`, rank: 0 };
  }
  if (hw.ramMb < MIN_RAM_MB) {
    return { hardwareClass: 'UNSUPPORTED', reason: `RAM ${hw.ramMb} MB < ${MIN_RAM_MB} MB`, rank: 0 };
  }
  if (hw.vramMb === null) {
    return {
      hardwareClass: 'CPU_FALLBACK',
      reason: 'NVIDIA GPU илрээгүй (мэдэхгүй ≠ байхгүй) — CPU дээр',
      rank: 1,
    };
  }
  if (hw.vramMb >= 11000) return { hardwareClass: 'HIGH_GPU', reason: `VRAM ${hw.vramMb} MB`, rank: 4 };
  if (hw.vramMb >= 7500) {
    return { hardwareClass: 'STANDARD_8GB_GPU', reason: `VRAM ${hw.vramMb} MB`, rank: 3 };
  }
  if (hw.vramMb >= 3500) return { hardwareClass: 'LOW_GPU', reason: `VRAM ${hw.vramMb} MB`, rank: 2 };
  return { hardwareClass: 'CPU_FALLBACK', reason: `VRAM ${hw.vramMb} MB хэт бага — CPU`, rank: 1 };
}

export function meetsHardwareClass(have: HardwareClass, min: HardwareClass): boolean {
  return RANK[have] >= RANK[min];
}

/**
 * Флот руу явах хардверийн зураг — ЗӨВХӨН нийцтэй байдалд хэрэгтэй талбар.
 * ⚠️ `cpu` нь загварын мөр («i7-12700KF») — хувийн мэдээлэл биш, гэхдээ
 *    128 тэмдэгтээр таслана.  Хостын нэр ЭНД ОРОХГҮЙ.
 */
export function fleetHardwareSummary(hw: HardwareProfile): {
  os: string;
  arch: string;
  cpu: string;
  cpuPhysicalCores: number;
  ramMb: number;
  gpu: string | null;
  vramMb: number | null;
  cuda: string | null;
  isLaptop: boolean | null;
  hardwareClass: HardwareClass;
} {
  return {
    os: hw.os.slice(0, 64),
    arch: hw.arch,
    cpu: hw.cpu.slice(0, 128),
    cpuPhysicalCores: hw.cpuPhysicalCores,
    ramMb: hw.ramMb,
    gpu: hw.gpu?.slice(0, 128) ?? null,
    vramMb: hw.vramMb,
    cuda: hw.cuda?.slice(0, 32) ?? null,
    isLaptop: hw.isLaptop,
    hardwareClass: classifyHardware(hw).hardwareClass,
  };
}
