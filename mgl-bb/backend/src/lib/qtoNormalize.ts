// QTO material-name normalizer.
//
// Pure, dependency-free (so it unit-tests under `node --test` and bundles into
// the Worker untouched). Turns the messy raw material/profile strings stored in
// qto_runs.summary_json (materials[] / types[]) into canonical quantity_line
// rows by looking each name up in the material_alias table, flagging anything
// it can't map. The matching key is produced by normalizeRawName, which is used
// BOTH when seeding material_alias.raw_norm and at normalize time — so variants
// that differ only in case / separator / script collapse to the same lookup.

export type Dimension = 'material' | 'type';

/**
 * Canonical lookup key for a raw material/profile string. Collapses the noise
 * seen in real models (МАКС): STEEL/ prefixes, mixed `*` / `X` / Cyrillic `х`
 * / `-` / space separators, Latin-vs-Cyrillic case, and trailing `.0` decimals.
 *
 *   'RHS 200X200X5.0' -> 'rhs200x200x5'
 *   'STEEL/Q235B'     -> 'q235b'
 *   'КРУГ-30'         -> 'круг30'
 *   'HI300-8-10*200'  -> 'hi300x8x10x200'
 */
export function normalizeRawName(input: string): string {
  let t = input.trim().toLowerCase();

  // Drop a leading material-class prefix like "STEEL/".
  t = t.replace(/^steel\//, '');

  // Fold every multiplication separator to a single Latin 'x':
  // Cyrillic х (U+0445), × (U+00D7), and *.
  t = t.replace(/[х×*]/g, 'x');

  // A '-' acting as a separator between two alphanumerics is also a multiply.
  t = t.replace(/(?<=[0-9a-zа-яё])-(?=[0-9a-zа-яё])/g, 'x');

  // Whitespace inside a designation is noise.
  t = t.replace(/\s+/g, '');

  // Collapse any run of separators that resulted from the folds above.
  t = t.replace(/x{2,}/g, 'x');

  // A separator at a name↔dimension boundary (letter next to digit) is just
  // glue — remove it so 'круг-30' and 'круг30' are the same key, while keeping
  // the digit↔digit separators that actually carry section dimensions.
  t = t.replace(/([a-zа-яё])x(?=[0-9])/g, '$1');
  t = t.replace(/([0-9])x(?=[a-zа-яё])/g, '$1');

  // Trailing ".0" is the same nominal value as the integer (5.0 == 5); a real
  // fractional part (6.3, 10.07) is preserved.
  t = t.replace(/(\d)\.0(?![0-9])/g, '$1');

  return t;
}

export interface AliasEntry {
  catalog_id: number;
  canonical_code: string;
  category: string | null;
}

/** A material_alias row joined to its material_catalog code/category. */
export interface AliasRow extends AliasEntry {
  raw_norm: string;
  dimension: Dimension;
}

export type AliasIndex = Map<string, AliasEntry>;

const indexKey = (dimension: Dimension, rawNorm: string): string => `${dimension}:${rawNorm}`;

/** Build the in-memory lookup the normalizer consults, keyed by dimension +
 *  raw_norm. Later rows win on collision (callers should order global aliases
 *  before project-scoped overrides so the project override takes precedence). */
export function buildAliasIndex(rows: AliasRow[]): AliasIndex {
  const idx: AliasIndex = new Map();
  for (const r of rows) {
    idx.set(indexKey(r.dimension, r.raw_norm), {
      catalog_id: r.catalog_id,
      canonical_code: r.canonical_code,
      category: r.category,
    });
  }
  return idx;
}

// Only the fields the normalizer reads off QtoSummary (qtoTypes.ts). Kept loose
// on purpose — older saved runs may omit types[]/mass_kg.
export interface NormalizeMaterialRow {
  material: string;
  volume_m3?: number | null;
  mass_kg?: number | null;
  count?: number | null;
}
export interface NormalizeTypeRow {
  type_name: string;
  cls?: string | null;
  volume_m3?: number | null;
  mass_kg?: number | null;
  count?: number | null;
}
export interface NormalizeSummary {
  materials?: NormalizeMaterialRow[];
  types?: NormalizeTypeRow[];
}

/** A row ready to INSERT into quantity_line (minus project_id / qto_run_id,
 *  which the route supplies). */
export interface QuantityLineInput {
  dimension: Dimension;
  raw_name: string;
  catalog_id: number | null;
  canonical_code: string | null;
  category: string | null;
  cls: string | null;
  count: number;
  volume_m3: number | null;
  mass_kg: number | null;
  mapped: 0 | 1;
}

export interface UnmappedName {
  dimension: Dimension;
  raw_name: string;
}

export interface NormalizeResult {
  lines: QuantityLineInput[];
  unmapped: UnmappedName[];
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const intCount = (v: unknown): number => {
  const n = num(v);
  return n == null ? 0 : Math.round(n);
};

/**
 * Normalize one QTO run's summary into quantity_line rows. Materials and types
 * are normalized as independent axes (summary_json carries no material×type×
 * storey cross-product); `dimension` records which axis a row came from.
 * Unmapped names are still emitted (mapped=0, null catalog) AND collected in
 * `unmapped` for review.
 */
export function normalizeRun(summary: NormalizeSummary, aliasIndex: AliasIndex): NormalizeResult {
  const lines: QuantityLineInput[] = [];
  const unmapped: UnmappedName[] = [];
  const seenUnmapped = new Set<string>();

  const handle = (
    dimension: Dimension,
    rawName: string,
    cls: string | null,
    count: number,
    volume_m3: number | null,
    mass_kg: number | null,
  ): void => {
    const hit = aliasIndex.get(indexKey(dimension, normalizeRawName(rawName)));
    lines.push({
      dimension,
      raw_name: rawName,
      catalog_id: hit?.catalog_id ?? null,
      canonical_code: hit?.canonical_code ?? null,
      category: hit?.category ?? null,
      cls,
      count,
      volume_m3,
      mass_kg,
      mapped: hit ? 1 : 0,
    });
    if (!hit) {
      const uk = `${dimension}:${rawName}`;
      if (!seenUnmapped.has(uk)) {
        seenUnmapped.add(uk);
        unmapped.push({ dimension, raw_name: rawName });
      }
    }
  };

  for (const m of summary.materials ?? []) {
    if (!m || typeof m.material !== 'string') continue;
    handle('material', m.material, null, intCount(m.count), num(m.volume_m3), num(m.mass_kg));
  }
  for (const t of summary.types ?? []) {
    if (!t || typeof t.type_name !== 'string') continue;
    handle(
      'type',
      t.type_name,
      typeof t.cls === 'string' ? t.cls : null,
      intCount(t.count),
      num(t.volume_m3),
      num(t.mass_kg),
    );
  }

  return { lines, unmapped };
}
