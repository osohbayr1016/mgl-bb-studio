/**
 * MGL AI · ГЭРЭЭНИЙ ХЭЛБЭР ШАЛГАГЧ (Session D).
 *
 * ⚠️ ХАМААРАЛГҮЙ, ЗОРИУД.  zod/ajv нэмэх нь `ai/package.json`-д мөр нэмнэ —
 *    тэр файл нь A/B/D гурвуулаа хүрдэг ХАМГИЙН ӨНДӨР эрсдэлтэй файл.
 *    Хэлбэрийн шалгалтад 60 мөр хангалттай.
 *
 * ⚠️ ХЭЛБЭР шалгана, УТГА биш.  «status нь 4 утгын нэг» гэдэг нь гэрээ;
 *    «status нь verified байх ёстой» гэдэг нь GOLD suite (Session A/C).
 *    Энэ файл хоёр дахийг ХЭЗЭЭ Ч хийхгүй.
 *
 * Spec хэл:
 *   'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'any'
 *   'string|null'            — хоёрын аль нэг
 *   'string?'                — талбар БАЙХГҮЙ байж болно (undefined); байвал string
 *   ['string']               — string-ийн массив
 *   { a: 'string', … }       — үүрлэсэн объект (ИЛҮҮ талбарыг зөвшөөрнө)
 *   { $enum: ['a','b'] }     — тогтмол утгын олонлог
 */

export type Spec = string | Spec[] | { [k: string]: Spec } | { $enum: readonly (string | number | boolean | null)[] };

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function matchesPrimitive(v: unknown, t: string): boolean {
  if (t === 'any') return true;
  return typeOf(v) === t;
}

/** Зөрчлийн жагсаалт — хоосон = хэлбэр таарсан. */
export function checkShape(value: unknown, spec: Spec, path = '$'): string[] {
  const out: string[] = [];

  if (typeof spec === 'string') {
    const optional = spec.endsWith('?');
    const s = optional ? spec.slice(0, -1) : spec;
    if (value === undefined) {
      if (!optional) out.push(`${path}: дутуу (хүлээсэн ${s})`);
      return out;
    }
    const alts = s.split('|');
    if (!alts.some((t) => matchesPrimitive(value, t))) {
      out.push(`${path}: ${typeOf(value)} (хүлээсэн ${s})`);
    }
    return out;
  }

  if (Array.isArray(spec)) {
    if (!Array.isArray(value)) {
      out.push(`${path}: ${typeOf(value)} (хүлээсэн array)`);
      return out;
    }
    const item = spec[0];
    if (item !== undefined) value.forEach((v, i) => out.push(...checkShape(v, item, `${path}[${i}]`)));
    return out;
  }

  if ('$enum' in spec && Array.isArray(spec.$enum)) {
    if (!spec.$enum.includes(value as never)) {
      out.push(`${path}: ${JSON.stringify(value)} ∉ {${spec.$enum.map((e) => JSON.stringify(e)).join(', ')}}`);
    }
    return out;
  }

  if (typeOf(value) !== 'object') {
    out.push(`${path}: ${typeOf(value)} (хүлээсэн object)`);
    return out;
  }
  const rec = value as Record<string, unknown>;
  for (const [k, sub] of Object.entries(spec as Record<string, Spec>)) {
    out.push(...checkShape(rec[k], sub, `${path}.${k}`));
  }
  return out;
}

export function assertShape(value: unknown, spec: Spec, label: string): void {
  const issues = checkShape(value, spec);
  if (issues.length > 0) {
    throw new Error(`${label} — гэрээний хэлбэр зөрчигдөв:\n  ${issues.join('\n  ')}`);
  }
}
