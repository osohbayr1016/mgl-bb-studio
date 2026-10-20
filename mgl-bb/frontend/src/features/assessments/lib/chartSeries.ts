import { useTheme } from '@/shared/context/ThemeContext';

import { SIDE_COLORS } from './score';

export const BENCHMARK_DASH = '6 4';

export type SeriesKey = 'self' | 'senior' | 'average' | 'benchmark';

/**
 * ГЭРЭЛ ба ХАРАНХУЙ горимд ТУСДАА алхам — автомат урвуулалт БИШ.
 *
 * Шалтгаан: «Ахлагчийн үнэлгээ» нь гүн navy (`#17509A`). Тэр өнгө цагаан
 * дэвсгэр дээр 5.4:1 боловч харанхуй карт дээр (`--card: 240 6% 10%`) ердөө
 * 2.2:1 — өөрөөр хэлбэл харагдахаа болино. Тиймээс горим тус бүрд өөрийн
 * алхмыг сонгосон: гэрэлд гүнзгий, харанхуйд өргөгдсөн.
 *
 * Хэмжигдсэн (skill `dataviz`-ийн `validate_palette.js`, all-pairs):
 *   гэрэл  — гурван үндсэн цуваа: lightness / chroma / CVD / normal-vision
 *            БҮГД PASS, хамгийн муу хос ΔE 24.0 (normal).
 *   харанхуй — CVD ΔE 19.7 · normal 21.3 · contrast бүгд ≥3:1 PASS.
 *
 * `benchmark` (Багийн дундаж) нь ЗОРИУД саарал, зориуд ухарсан: тэр нь
 * харьцуулах жишиг болохоос биш дөрөв дэх «ангилал» биш. Тиймээс chroma
 * шалгуурыг санаатай зөрчинө — оронд нь ТАСАРХАЙ зураас (`BENCHMARK_DASH`)
 * ба хамгийн нимгэн зузаан гэсэн хоёр нэмэлт суваг түүнийг таниулна.
 */
const LIGHT_SERIES_COLORS: Record<SeriesKey, string> = {
  ...SIDE_COLORS,
  benchmark: '#B4BDC7',
};

const DARK_SERIES_COLORS: Record<SeriesKey, string> = {
  self: '#9FC9E8',
  senior: '#3D82D6',
  average: '#D9A02F',
  benchmark: '#5F6B7A',
};

/**
 * ДУНДАЖ (dim) горим — гуравдахь бие даасан алхам, урвуулалт ч, ойролцоолол ч БИШ.
 *
 * Шалтгаан нь дээрх хоёртой ижил: гадаргуу нь `#44464B` (L* 29.8, саарал).
 * Харанхуйн алхмуудаас `senior` (#3D82D6) энд 2.41:1, `benchmark`
 * (#5F6B7A) 1.74:1 — хоёулаа 3:1-ийг унаж дэвсгэртэйгээ нийлнэ.
 * Гурвуулаа тэр чигтээ өргөгдсөн: `self` цайвар хөх, `senior` гүн хөх
 * гэсэн ЭРЭМБЭ хэвээр (`SIDE_COLORS`-той нийцнэ), зөвхөн шинэ гадаргууны
 * 3:1-ийн шалнаас дээш зөөгдсөн.
 *
 * Хэмжигдсэн (surface #44464B, ΔE2000 + Brettel CVD, гурван өнгөт цуваа,
 * all-pairs): CVD ΔE 21.9 · normal 23.7 · contrast бүгд ≥3:1 (3.35–7.72)
 * — PASS.  Хуучин хөх гадаргуу дээр 20.4 / 23.8 байсан, өөрөөр хэлбэл
 * чанарын алдагдал байхгүй.
 *
 * ⚠ 2026-08-10: `benchmark` нь ДУЛААН саараал (#A2998E) байснаа ТӨВИЙГ
 * САХИСАН саарал болов.  Дулаан болгосон УЧИР ШАЛТГААН нь «хүйтэн саарал
 * нь ХӨХ гадаргуу дээр дөрөв дэх хөх цуваа мэт харагдана» байсан — гадаргуу
 * саарал болсноор тэр эрсдэл АРИЛЖ, оронд нь эсрэгээрээ болов: гадаргуутай
 * ижил өнгөгүй тул түүнийг зөвхөн ГЭРЭЛТҮҮЛЭГ салгана (L* 68.0 vs 29.8,
 * 3.86:1).  Дулаан беж өнгө нь саарал хуудсан дээр эзэнгүй толбо мэт
 * харагдах тул хассан.  Chroma шалгуурыг зөрчсөн хэвээр (зориуд — тэр нь
 * жишиг болохоос дөрөв дэх ангилал биш); тасархай зураас (`BENCHMARK_DASH`)
 * ба хамгийн нимгэн зузаан түүнийг таниулна.
 */
const DIM_SERIES_COLORS: Record<SeriesKey, string> = {
  self: '#D3ECFD',
  senior: '#5A9CF2',
  average: '#F2B740',
  benchmark: '#A2A6AE',
};

/** React-гүй хэрэглэгчдэд (Excel export г.м.) — гэрэл горимын суурь утгууд. */
export const SERIES_COLORS = LIGHT_SERIES_COLORS;

export const BENCHMARK_COLOR = LIGHT_SERIES_COLORS.benchmark;

/**
 * Идэвхтэй горимын цувааны өнгө.
 *
 * `chartImage.ts`-ийн SVG→PNG хөрвүүлэлт нь `getComputedStyle`-аар бодогдсон
 * утгыг уншдаг тул Excel-д гарах зураг ч мөн адил зөв горимын өнгөтэй гарна.
 */
export function useSeriesColors(): Record<SeriesKey, string> {
  const { resolved } = useTheme();
  if (resolved === 'dark') return DARK_SERIES_COLORS;
  if (resolved === 'dim') return DIM_SERIES_COLORS;
  return LIGHT_SERIES_COLORS;
}

export function fmtDelta(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
  return `${sign}${Math.abs(v).toFixed(1)}`;
}

/** Легендийн эгнээний X байрлалуудыг бодно; дүүрвэл доош шилжинэ. */
export function packLegend(
  widths: number[],
  startX: number,
  _rowY: number,
  _rowH: number,
  maxWidth: number,
): { xs: number[]; rows: number; marginTop: number; levelsRowY: number } {
  const xs: number[] = [];
  let x = startX;
  let rows = 1;
  for (const width of widths) {
    if (x + width > maxWidth && x > startX) {
      rows += 1;
      x = startX;
    }
    xs.push(x);
    x += width;
  }
  const marginTop = 44 + (rows - 1) * 16;
  const levelsRowY = 13 + rows * 16 + 1;
  return { xs, rows, marginTop, levelsRowY };
}
