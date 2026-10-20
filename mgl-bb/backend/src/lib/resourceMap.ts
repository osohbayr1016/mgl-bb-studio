// Revit QTO fact мөрийг шифр каталог руу буулгах түлхүүрүүд.
//
// Цэвэр, хамааралгүй (qtoNormalize.ts-ийн normalizeRawName-ийг л ашиглана) тул
// Worker-т шууд bundle-лагдана. Phase 1-д зөвхөн түлхүүр тооцоолол + confirmed
// alias lookup хэрэглэгдэнэ; Phase 2 (шифр ангилал: admin queue + Claude MCP
// саналууд) ижил түлхүүрүүд дээр суурилна — spec: docs/superpowers/specs/
// 2026-07-03-revit-qto-integration-design.md.

import { normalizeRawName } from './qtoNormalize';

export type ResourceKeyKind = 'combo' | 'material';

/**
 * Fact мөрийн үндсэн (combo) түлхүүр: category|type|material — хэсэг бүр
 * normalizeRawName-аар норчлогдоно. Хоосон хэсэг хоосон сегмент хэвээр үлдэж
 * түлхүүрийн хэлбэр тогтвортой байна:
 *   'Structural Framing','RHS200X200X5','STEEL/Q235B' -> 'structuralframing|rhs200x200x5|q235b'
 *   'Walls','','Бетон B25'                            -> 'walls||бетонb25'
 */
export function normalizeFactKey(category: string, typeName: string, material: string): string {
  return [category, typeName, material].map((s) => normalizeRawName(s ?? '')).join('|');
}

/** material тэнхлэгийн fallback түлхүүр; материалгүй мөрөнд null. */
export function normalizeMaterialKey(material: string): string | null {
  const norm = normalizeRawName(material ?? '');
  return norm === '' ? null : norm;
}

export interface ResourceAliasRow {
  raw_norm: string;
  key_kind: ResourceKeyKind;
  resource_code: string;
}

export type ResourceAliasIndex = Map<string, string>;

const indexKey = (kind: ResourceKeyKind, rawNorm: string): string => `${kind}:${rawNorm}`;

/**
 * Confirmed alias мөрүүдээс lookup index барина. Дуудагч глобал (project_id NULL)
 * мөрүүдийг ЭХЭНД эрэмбэлж өгвөл төслийн override сүүлд бичигдэж ялна
 * (qtoNormalize.buildAliasIndex-тэй ижил дүрэм).
 */
export function buildResourceAliasIndex(rows: ResourceAliasRow[]): ResourceAliasIndex {
  const idx: ResourceAliasIndex = new Map();
  for (const r of rows) idx.set(indexKey(r.key_kind, r.raw_norm), r.resource_code);
  return idx;
}

/** combo эхэлж, дараа нь material fallback — эхний оносон код эсвэл null. */
export function resolveResourceCode(
  idx: ResourceAliasIndex,
  comboKey: string,
  materialKey: string | null,
): string | null {
  const combo = idx.get(indexKey('combo', comboKey));
  if (combo) return combo;
  if (materialKey) {
    const mat = idx.get(indexKey('material', materialKey));
    if (mat) return mat;
  }
  return null;
}
