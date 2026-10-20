// Run with:  node --test src/lib/qtoNormalize.test.ts   (Node ≥ 22.18 / 24 strips types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRawName,
  normalizeRun,
  buildAliasIndex,
  type AliasRow,
} from './qtoNormalize.ts';

test('normalizeRawName: strips STEEL/ prefix and lowercases grades', () => {
  assert.equal(normalizeRawName('STEEL/Q235B'), 'q235b');
  assert.equal(normalizeRawName('Q355B'), 'q355b');
  assert.equal(normalizeRawName('  C245 '), 'c245');
});

test('normalizeRawName: unifies separators (*, X, х, -, space) between digits to x', () => {
  assert.equal(normalizeRawName('RHS 200X200X5.0'), 'rhs200x200x5');
  assert.equal(normalizeRawName('RHS200*200*6.3'), 'rhs200x200x6.3');
  assert.equal(normalizeRawName('HI300-8-10*200'), 'hi300x8x10x200');
  assert.equal(normalizeRawName('CHS140X5'), 'chs140x5');
  assert.equal(normalizeRawName('L40X3'), 'l40x3');
  assert.equal(normalizeRawName('L80*6'), 'l80x6');
});

test('normalizeRawName: drops the separator at a name→dimension (letter↔digit) boundary', () => {
  // КРУГ-30 and a hypothetical Круг-30 must collapse to the same key as Круг30.
  assert.equal(normalizeRawName('КРУГ-30'), 'круг30');
  assert.equal(normalizeRawName('Круг30'), 'круг30');
  assert.equal(normalizeRawName('Круг24'), 'круг24');
});

test('normalizeRawName: strips trailing .0 but keeps real decimals', () => {
  assert.equal(normalizeRawName('PL10.07*143'), 'pl10.07x143');
  assert.equal(normalizeRawName('RHS50*100*3'), 'rhs50x100x3');
  assert.equal(normalizeRawName('200x5.0'), '200x5');
});

test('normalizeRawName: is idempotent', () => {
  for (const s of ['RHS 200X200X5.0', 'STEEL/Q235B', 'КРУГ-30', 'HI300-8-10*200']) {
    assert.equal(normalizeRawName(normalizeRawName(s)), normalizeRawName(s));
  }
});

const ALIAS_ROWS: AliasRow[] = [
  { raw_norm: 'q235b', dimension: 'material', catalog_id: 2, canonical_code: 'Q235B', category: 'steel' },
  { raw_norm: 'q355b', dimension: 'material', catalog_id: 1, canonical_code: 'Q355B', category: 'steel' },
  { raw_norm: 'c245', dimension: 'material', catalog_id: 4, canonical_code: 'C245', category: 'steel' },
  { raw_norm: 'rhs200x200x5', dimension: 'type', catalog_id: 9, canonical_code: 'RHS200x200x5.0', category: 'rhs' },
];

test('buildAliasIndex: keys by dimension + raw_norm', () => {
  const idx = buildAliasIndex(ALIAS_ROWS);
  assert.equal(idx.get('material:q235b')?.canonical_code, 'Q235B');
  assert.equal(idx.get('type:rhs200x200x5')?.catalog_id, 9);
  assert.equal(idx.get('material:nope'), undefined);
});

test('normalizeRun: maps known materials and types, copies quantities', () => {
  const idx = buildAliasIndex(ALIAS_ROWS);
  const summary = {
    materials: [{ material: 'STEEL/Q235B', volume_m3: 15.7, mass_kg: 123642.36, count: 9092 }],
    types: [{ type_name: 'RHS 200X200X5.0', cls: 'IfcColumn', count: 12, volume_m3: 1.2, mass_kg: 9400 }],
  };
  const { lines, unmapped } = normalizeRun(summary, idx);

  assert.equal(unmapped.length, 0);
  assert.equal(lines.length, 2);

  const mat = lines.find((l) => l.dimension === 'material')!;
  assert.equal(mat.mapped, 1);
  assert.equal(mat.catalog_id, 2);
  assert.equal(mat.canonical_code, 'Q235B');
  assert.equal(mat.category, 'steel');
  assert.equal(mat.cls, null);
  assert.equal(mat.raw_name, 'STEEL/Q235B');
  assert.equal(mat.count, 9092);
  assert.equal(mat.mass_kg, 123642.36);

  const typ = lines.find((l) => l.dimension === 'type')!;
  assert.equal(typ.mapped, 1);
  assert.equal(typ.canonical_code, 'RHS200x200x5.0');
  assert.equal(typ.cls, 'IfcColumn');
});

test('normalizeRun: flags unmapped names (mapped=0, null catalog) and lists them', () => {
  const idx = buildAliasIndex(ALIAS_ROWS);
  const summary = {
    materials: [{ material: 'UNKNOWN-GRADE', volume_m3: 1, mass_kg: 1, count: 1 }],
    types: [{ type_name: 'CC200-3-20-70', cls: 'IfcMember', count: 5, volume_m3: null, mass_kg: 50 }],
  };
  const { lines, unmapped } = normalizeRun(summary, idx);

  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.mapped === 0));
  assert.ok(lines.every((l) => l.catalog_id === null && l.canonical_code === null));
  assert.deepEqual(
    unmapped.sort((a, b) => a.raw_name.localeCompare(b.raw_name)),
    [
      { dimension: 'type', raw_name: 'CC200-3-20-70' },
      { dimension: 'material', raw_name: 'UNKNOWN-GRADE' },
    ].sort((a, b) => a.raw_name.localeCompare(b.raw_name)),
  );
});

test('normalizeRun: tolerates missing materials/types arrays', () => {
  const idx = buildAliasIndex(ALIAS_ROWS);
  const { lines, unmapped } = normalizeRun({}, idx);
  assert.equal(lines.length, 0);
  assert.equal(unmapped.length, 0);
});
