/**
 * MGL AI · ТЕХНИКИЙН ТОВЧЛОЛЫН БАТЛАГДСАН НЭР ТОМЬЁО (NORM-INTEL v3).
 *
 * ⚠️ ЭНЭ БОЛ НОРМЫН БАРИМТЫН САН БИШ.  Зөвхөн тогтвортой, ТОО ХЭМЖЭЭГҮЙ инженерийн нэр томьёоны утга:
 *    «EI» гэж юу гэсэн үг вэ.  Тоо, босго, шаардлага (ж. «EI60 хэрэгтэй») ЭНД ХЭЗЭЭ Ч байхгүй.
 *
 * ⚠️ ЯАГААД.  Хэмжсэн (2026-10-04): загвар «EI = Equivalent Impact» гэж техникийн товчлолыг ЗОХИОЖ тайлбарласан.
 *    Товчлолын тайлбар нь батлагдсан нэр томьёо эсвэл баталгаатай нотолгоонд л байж болно; танигдаагүй
 *    товчлолд ямар ч «задлал» хориотой (`normIntel.ts validateNormIntel` → TERMINOLOGY_INVENTED).
 *
 * ⚠️ `keys` — зөвшөөрөгдсөн тайлбарт байх ёстой КИРИЛЛ/латин ЖИЖИГ үсгийн хэсэг; задлал тэдгээрийн аль нэгийг агуулбал зөв.
 */
import type { NormTerminologyEntry } from '@mgl/mglai-common/normIntel';

interface Approved {
  keys: string[];
  definitionMn: string;
  definitionEn: string;
}

/** Хуурамч задлалыг барих ЗААВАЛ нэр томьёо; нийтлэг, тогтсон утгатай товчлолууд. */
const APPROVED: Record<string, Approved> = {
  EI: {
    keys: ['бүрэн бүтэн', 'дулаан тусгаарл', 'дулаан дамжуул', 'эсэргүүц', 'тэсвэр', 'integrity', 'insulation', 'fire resistance'],
    definitionMn: 'галын эсэргүүцлийн ангилал: хаалт галын үед бүрэн бүтэн байх (E) ба нөгөө талдаа дулаан дамжуулахгүй байх (I) чадвараа хадгалах хугацааг илэрхийлнэ',
    definitionEn: 'a fire-resistance classification: how long a barrier keeps its integrity (E) and insulation (I) in a fire',
  },
  REI: {
    keys: ['ачаалал', 'бүрэн бүтэн', 'дулаан тусгаарл', 'эсэргүүц', 'тэсвэр', 'load', 'integrity', 'insulation'],
    definitionMn: 'галын эсэргүүцлийн ангилал: ачаалал даах (R), бүрэн бүтэн байх (E), дулаан тусгаарлах (I) чадвараа хадгалах хугацаа',
    definitionEn: 'a fire-resistance classification covering load-bearing (R), integrity (E) and insulation (I)',
  },
  EW: {
    keys: ['цацрал', 'бүрэн бүтэн', 'эсэргүүц', 'радиац', 'radiation', 'integrity'],
    definitionMn: 'галын эсэргүүцлийн ангилал: бүрэн бүтэн байх (E) ба дулааны цацралыг хязгаарлах (W) чадвар',
    definitionEn: 'a fire-resistance classification: integrity (E) and limited radiation (W)',
  },
  ГУАТ: {
    keys: ['гал унтраах', 'автомат'],
    definitionMn: 'гал унтраах автомат төхөөрөмж',
    definitionEn: 'automatic fire-extinguishing system',
  },
  ГМДХ: {
    keys: ['галын дохиол', 'дохиоллын', 'хэрэгсэл'],
    definitionMn: 'галын дохиоллын хэрэгсэл',
    definitionEn: 'fire alarm system',
  },
};

/** Асуултад байвч ХУРААХГҮЙ нийтлэг товчлолууд — баримтын код, байгууллага. */
const IGNORE = new Set(['MNS', 'BNBD', 'UBB', 'SNIP', 'MCIS', 'ERP', 'AI', 'BIM', 'RFI', 'PDF', 'ГОСТ', 'MGL', 'EN', 'ISO', 'ASR', 'DASR', 'AZ', 'ZA', 'ET', 'EZ', 'IZ', 'ХБИ', 'БНБД', 'МНС', 'УББ']);

/**
 * Асуулт доторх техникийн товчлолууд.  Батлагдсан нь тайлбартай; ТАНИГДААГҮЙ (ж. IDA) нь `keys: []` —
 * хариултад түүнд ямар ч «задлал» бичихийг хориглоно.
 */
export function terminologyFor(question: string): NormTerminologyEntry[] {
  const out: NormTerminologyEntry[] = [];
  const seen = new Set<string>();
  const add = (abbr: string): void => {
    const key = abbr.toUpperCase();
    if (seen.has(key) || IGNORE.has(key)) return;
    seen.add(key);
    const a = APPROVED[key];
    out.push({ abbr: key, keys: a ? a.keys : [], definitionMn: a ? a.definitionMn : null });
  };
  // Латин: EI, EI60, REI90, IDA2 — үсгийн хэсэг
  for (const m of (question ?? '').matchAll(/(?<![\p{L}\d])([A-Z]{2,5})(?:\s?\d{1,3})?(?![\p{L}])/gu)) add(m[1]!);
  // Кирилл том үсгийн товчлол: ГУАТ, ГМДХ
  for (const m of (question ?? '').matchAll(/(?<![\p{L}])([А-ЯӨҮ]{3,5})(?![\p{L}])/gu)) add(m[1]!);
  return out;
}

export function approvedDefinition(abbr: string, lang: 'mn-Cyrl' | 'en'): string | null {
  const a = APPROVED[abbr.toUpperCase()];
  if (!a) return null;
  return lang === 'en' ? a.definitionEn : a.definitionMn;
}

/** Батлагдсан тайлбартай товчлолууд (хариултын детерминист хэсэгт). */
export function approvedTerminology(question: string, lang: 'mn-Cyrl' | 'en'): { abbr: string; definition: string }[] {
  const out: { abbr: string; definition: string }[] = [];
  for (const t of terminologyFor(question)) {
    const d = approvedDefinition(t.abbr, lang);
    if (d) out.push({ abbr: t.abbr, definition: d });
  }
  return out;
}
