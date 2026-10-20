/**
 * MGL AI · ИНЖЕНЕРИЙН ENTITY ГАРГАЛТ (P0-4) — `normEntities.ts`-ийн ДЭЭР давхарлана.
 *
 * `normEntities.ts` нь g / Q / S / H / ΔP / t° / В-ангилал гаргадаг (тестээр
 * хаагдсан).  Энэ модуль нь тэдгээрийг ХЭВЭЭР авч, дээр нь:
 *
 *   • ШОШГОТОЙ даралт — «аппаратын даралт 200 кПа» нь P1 (аппарат), харин
 *     «тэсрэлтийн илүүдэл даралт 7 кПа» / «ΔP=8 кПа» нь ΔP.  Өмнө нь ямар ч
 *     кПа тоо ΔP болдог байв (GOLD-B08-ыг өрөөний ангилал руу аваачих эрсдэл).
 *   • Эзлэхүүн (м³): аппаратын V ба өрөөний геометр эзлэхүүн — контекстоор.
 *   • «Тоног төхөөрөмжийн эзлэхүүнийг тооцох боломжгүй» гэсэн ТУГ (4.4-ийн нөөц).
 *   • Орчин (medium): хий / хялбар авалцан асах шингэн(ий уур) / шатамхай
 *     шингэн / тоос / хивэгдэс — өрөөний А/Б дүрмийн enum нөхцөлд.
 *   • Хаалтын нөхцөл (4.2): гараар / автомат, нөөцтэй эсэх, ажиллагаагүй болох
 *     магадлал.
 *   • АСУУЛТЫН ЗОРИЛТ (asks): ангилал / g / Q≥0.64gH² нөхцөл / зай / Va /
 *     чөлөөт эзлэхүүн / хаах хугацаа — дүрмийн ГЭР БҮЛ сонгоход (selector.ts).
 *   • Явцуу баримтын код (каталогоос хамааралгүй, `normalize.ts`-ийн хос).
 *
 * ⚠️ ТААМАГЛАХГҮЙ: олдоогүй утга `undefined`; asks-ийн туг нь асуултын үгээс.
 */
import { extractNormEntities, type NormEntities } from '../normEntities';

export type Medium = 'flammable_gas' | 'flammable_liquid_vapor' | 'flammable_liquid' | 'combustible_dust' | 'combustible_fiber';

export interface EngineeringEntities extends NormEntities {
  /** Аппаратын (үнэмлэхүй) даралт, кПа — Va=0.01·P1·V-ийн оролт. */
  apparatusPressureKpa?: number;
  /** Аппаратын эзлэхүүн, м³. */
  apparatusVolumeM3?: number;
  /** Өрөөний геометр (нийт) эзлэхүүн, м³. */
  geometricVolumeM3?: number;
  /** Ямар ч м³ тоо — контекстгүй үед. */
  volumeM3?: number;
  /** «тоног төхөөрөмжийн эзлэхүүнийг тооцох/тодорхойлох боломжгүй». */
  equipmentVolumeUnknown: boolean;
  medium: Medium[];
  /** 4.2 — хаалтын нөхцөл. */
  manualShutoff?: boolean;
  redundantShutoff?: boolean;
  failureProbabilityPerYear?: number;
  /** Явцуу нэрлэсэн баримтын код(ууд), каноник хэлбэрээр («БД 21-101-12»). */
  documentCodes: string[];
  asks: {
    category: boolean;
    specificFireLoad: boolean;
    upgradeCondition: boolean;
    spacing: boolean;
    apparatusGasVolume: boolean;
    freeVolume: boolean;
    shutoffTime: boolean;
    /** «нэмэлт шалгалт», «дараа нь юу шалгах» — follow-up тугийг ил хүсэв. */
    followup: boolean;
  };
}

const num = (s: string): number | undefined => {
  // «24,000» = мянгат (яг 3 орон), «1,5» = аравтын — normEntities.ts / validator.ts-ийн ижил дүрэм.
  const compact = s.replace(/[\s\u00A0]/g, '');
  const cleaned = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(compact) ? compact.replace(/,/g, '') : compact.replace(',', '.');
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : undefined;
};

const DOC_CODE_RE = /(?<![\p{L}])(БНбД|BNbD|BNBD|БД|BD|УББ|UBB|MNS|СНиП|SNiP|SNIP)\s*[-–]?\s*(\d{2}[-–]\d{2,3}[-–]\d{2}(?:[-–]\d{2})?|II[-–]\d{2}[-–]\d{2}\*?)/giu;

export function canonicalDocCode(prefix: string, digits: string): string {
  const u = prefix.toUpperCase();
  const p = u === 'BD' || u === 'БД' ? 'БД' : u === 'UBB' || u === 'УББ' ? 'УББ' : u === 'BNBD' || u === 'БНБД' ? 'БНбД' : u === 'SNIP' || u === 'СНИП' ? 'СНиП' : prefix;
  return `${p} ${digits.replace(/–/g, '-')}`;
}

export function extractDocumentCodes(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DOC_CODE_RE)) {
    const code = canonicalDocCode(m[1]!, m[2]!);
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/** кПа-тай тоо бүрийг зүүн 48 тэмдэгтийн контексттэй нь. */
function kpaSites(q: string): { value: number; left: string }[] {
  const out: { value: number; left: string }[] = [];
  for (const m of q.matchAll(/([\d\s.,]+?)\s*(?:кПа|kPa|кпа)/giu)) {
    const v = num(m[1] ?? '');
    if (v === undefined) continue;
    out.push({ value: v, left: q.slice(Math.max(0, (m.index ?? 0) - 48), m.index ?? 0).toLowerCase() });
  }
  return out;
}

function m3Sites(q: string): { value: number; left: string }[] {
  const out: { value: number; left: string }[] = [];
  for (const m of q.matchAll(/([\d\s.,]+?)\s*(?:м³|м3|m³|m3|куб\.?\s*м)(?![\p{L}])/giu)) {
    const v = num(m[1] ?? '');
    if (v === undefined) continue;
    out.push({ value: v, left: q.slice(Math.max(0, (m.index ?? 0) - 64), m.index ?? 0).toLowerCase() });
  }
  return out;
}

const DELTA_P_CTX = /илүүдэл|тэсрэл|δp|δр|delta\s*p|overpressure|iluudel|tesrel/u;
const APPARATUS_CTX = /аппарат|apparat|apparatus|савны|сав\b|vessel|танк|tank|шугам|хоолой|pipe/u;
const GEOMETRIC_CTX = /геометр|geometr|нийт\s+(?:эзлэхүүн|багтаамж)|өрөөний\s+(?:нийт\s+)?(?:эзлэхүүн|багтаамж)|room\s+volume|uruunii/u;

export function extractEngineeringEntities(question: string): EngineeringEntities {
  const q = question ?? '';
  const base = extractNormEntities(q);
  const lower = q.toLowerCase();
  const out: EngineeringEntities = {
    ...base,
    equipmentVolumeUnknown: false,
    medium: [],
    documentCodes: extractDocumentCodes(q),
    asks: {
      category: false,
      specificFireLoad: false,
      upgradeCondition: false,
      spacing: false,
      apparatusGasVolume: false,
      freeVolume: false,
      shutoffTime: false,
      followup: false,
    },
  };

  // ── Даралт: ΔP vs аппаратын P1 ───────────────────────────────────
  {
    const sites = kpaSites(q);
    let deltaP: number | undefined;
    let p1: number | undefined;
    for (const s of sites) {
      if (DELTA_P_CTX.test(s.left)) {
        if (deltaP === undefined) deltaP = s.value;
      } else if (APPARATUS_CTX.test(s.left)) {
        if (p1 === undefined) p1 = s.value;
      } else if (deltaP === undefined) {
        // Шошгогүй — өрөөний ангиллын асуултад ΔP гэж үзнэ (хуучин зан төлөв),
        // харин аппаратын үг өгүүлбэрт байвал P1.
        if (APPARATUS_CTX.test(lower)) p1 = p1 ?? s.value;
        else deltaP = s.value;
      }
    }
    if (deltaP !== undefined) {
      out.deltaPKpa = deltaP;
    } else {
      delete out.deltaPKpa;
    }
    if (p1 !== undefined) {
      out.apparatusPressureKpa = p1;
      out.trace.push(`P1=${p1} кПа (аппарат)`);
    }
  }

  // ── Эзлэхүүн, м³ ─────────────────────────────────────────────────
  {
    const sites = m3Sites(q);
    for (const s of sites) {
      if (APPARATUS_CTX.test(s.left) && out.apparatusVolumeM3 === undefined) {
        out.apparatusVolumeM3 = s.value;
        out.trace.push(`V=${s.value} м³ (аппарат)`);
      } else if (GEOMETRIC_CTX.test(s.left) && out.geometricVolumeM3 === undefined) {
        out.geometricVolumeM3 = s.value;
        out.trace.push(`V_geo=${s.value} м³`);
      }
    }
    const first = sites[0];
    if (first !== undefined) out.volumeM3 = first.value;
    // Аппаратын даралт байгаа ч м³ шошгогүй бол — тэр м³ нь аппаратынх.
    if (out.apparatusVolumeM3 === undefined && out.apparatusPressureKpa !== undefined && first !== undefined) {
      out.apparatusVolumeM3 = first.value;
      out.trace.push(`V=${first.value} м³ (аппарат, шошгогүй)`);
    }
    // Чөлөөт эзлэхүүний асуултад шошгогүй м³ нь геометр эзлэхүүн.
    if (out.geometricVolumeM3 === undefined && first !== undefined && /чөлөөт|free\s+volume|chuluut/u.test(lower) && out.apparatusPressureKpa === undefined) {
      out.geometricVolumeM3 = first.value;
      out.trace.push(`V_geo=${first.value} м³ (шошгогүй)`);
    }
  }

  out.equipmentVolumeUnknown =
    /(тоног\s+төхөөрөмж|tonog\s+tukhuurumj|equipment)[^.?!]{0,80}(боломжгүй|мэдэгдэхгүй|тодорхойгүй|bolomjgui|unknown|cannot)/u.test(lower) ||
    /(боломжгүй|мэдэгдэхгүй|тодорхойгүй)[^.?!]{0,40}(тоног\s+төхөөрөмж)/u.test(lower);

  // ── Орчин ─────────────────────────────────────────────────────────
  if (/шатамхай\s+хий|shatamkhai\s+khii|flammable\s+gas/u.test(lower)) out.medium.push('flammable_gas');
  if (/хялбар\s+авалцан\s+асах\s+шингэн|уурын|уур\b|vapou?r|khyalbar\s+avaltsan/u.test(lower)) out.medium.push('flammable_liquid_vapor');
  if (/шатамхай\s+шингэн|shatamkhai\s+shingen|combustible\s+liquid|flammable\s+liquid(?!\s+vapou?r)/u.test(lower)) out.medium.push('flammable_liquid');
  if (/тоос|toos|dust/u.test(lower)) out.medium.push('combustible_dust');
  if (/хивэгдэс|khivegdes|fib(?:er|re)/u.test(lower)) out.medium.push('combustible_fiber');

  // ── 4.2 хаалт ─────────────────────────────────────────────────────
  if (/гараар\s+хаа|garaar\s+khaa|manual/u.test(lower)) out.manualShutoff = true;
  if (/автомат|avtomat|automatic/u.test(lower) && out.manualShutoff !== true) out.manualShutoff = false;
  if (/нөөц\s*системгүй|нөөцгүй|nuuts\s*sistemgui|no\s+redundan|without\s+redundan/u.test(lower)) out.redundantShutoff = false;
  else if (/нөөц(?:тэй|\s+систем|\s+хангалттай)|redundan/u.test(lower)) out.redundantShutoff = true;
  {
    const m = /магадлал[^.?!\d]{0,30}([\d.,]+)\s*(?:\/\s*жил|жилд)?|probability[^.?!\d]{0,30}([\d.,]+)/iu.exec(q);
    // ⚠️ `num('')` = 0 — таарахгүй асуулт бүрд магадлал 0 гэж бичигдэж, хөдөлгүүрийн «инженерийн дохио» ХУДАЛ асдаг
    //    байв («Хатаалгын өрөөнд ГУАТ хэрэгтэй юу?» → g төлөвөөр В3; хэмжсэн 2026-09-18).
    const v = m ? num(m[1] ?? m[2] ?? '') : undefined;
    if (m && v !== undefined) out.failureProbabilityPerYear = v;
  }

  // ── Асуултын зорилт ───────────────────────────────────────────────
  // «ангилал» → «ангиллыг», «ангиллын», «ангилалд» — эгшиг гээгддэг тул язгуураар.
  out.asks.category = /ангил(?:а?л)|angil(?:a?l)|categor(?:y|ies)/u.test(lower);
  // «ачааллыг бод» — залгаварт эгшиг гээгддэг (ачаалал → ачаалл-ыг) тул язгуураар.
  out.asks.specificFireLoad = /хувийн\s+галын\s+ачаал\p{L}*[^.?!]{0,40}(хэд|яаж|бод|тооц|g\b)|(?:g\s+хэд|g\s*=\s*\?|g-г\s+бод|g\s+хэд вэ)|specific\s+fire\s+load[^.?!]{0,30}(what|calculate)|khuviin\s+galyn\s+achaalal[^.?!]{0,30}khed/u.test(lower);
  out.asks.upgradeCondition = /0[.,]64|4\.20|нөхцөл\s+биел|nukhtsul\s+biel|дээд\s+ангилал|upgrade|q\s*[≥>]=?\s*0/u.test(lower);
  out.asks.spacing = /зай(?:\s|н|г|-|$)|spacing|distance|хоорондын/u.test(lower);
  out.asks.apparatusGasVolume = /v[ₐa]\b|v_a\b|вa\b|аппаратаас\s+гарах|хийн\s+эзлэхүүн|gas\s+volume/u.test(lower) || (out.apparatusPressureKpa !== undefined && /эзлэхүүн|volume/u.test(lower));
  out.asks.freeVolume = /чөлөөт\s+(?:эзлэхүүн|багтаамж)|free\s+(?:room\s+)?volume|chuluut/u.test(lower);
  out.asks.shutoffTime = /хаах\s+хугацаа|хаах\s+хугацааг|closure\s+time|shutoff|khaakh\s+khugatsaa/u.test(lower);
  out.asks.followup = /нэмэлт\s+(?:ямар\s+)?шалгалт|дараа\s+нь\s+(?:юу|ямар)|нэмэлт\s+өгөгдөл|эцсийн\s+ангилл|follow[- ]?up|additional\s+check/u.test(lower);

  return out;
}
