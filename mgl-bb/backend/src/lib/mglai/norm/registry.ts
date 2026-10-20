/**
 * Хөрвүүлсэн бүртгэлийн ИНДЕКС — үүсгэсэн файлуудыг уншиж, код/alias-аар
 * баримт, id-аар дүрэм/томьёо/хэсэг олно.  ЗӨВХӨН уншина.
 */
import type { CompiledClause, CompiledDocument, CompiledFormula, CompiledRule, RegistryManifest } from './registryTypes';
import { NORM_REGISTRY_DOCUMENTS, NORM_REGISTRY_MANIFEST } from './generated/manifest.generated';
import { fold } from './text';

export interface NormRegistry {
  manifest: RegistryManifest;
  documents: readonly CompiledDocument[];
  /** Баримтыг кодоор/alias-аар ол — «БД 21-101-12», «BD 21-101-12», «21-101-12». */
  byCode: (code: string) => CompiledDocument | null;
  byId: (documentId: string) => CompiledDocument | null;
  rule: (ruleId: string) => { doc: CompiledDocument; rule: CompiledRule } | null;
  formula: (formulaId: string) => { doc: CompiledDocument; formula: CompiledFormula } | null;
  clause: (chunkId: string) => { doc: CompiledDocument; clause: CompiledClause } | null;
}

export function buildRegistry(documents: readonly CompiledDocument[] = NORM_REGISTRY_DOCUMENTS, manifest: RegistryManifest = NORM_REGISTRY_MANIFEST): NormRegistry {
  const codeIndex = new Map<string, CompiledDocument>();
  const ruleIndex = new Map<string, { doc: CompiledDocument; rule: CompiledRule }>();
  const formulaIndex = new Map<string, { doc: CompiledDocument; formula: CompiledFormula }>();
  const clauseIndex = new Map<string, { doc: CompiledDocument; clause: CompiledClause }>();
  for (const d of documents) {
    for (const a of [d.documentCode, ...d.codeAliases]) codeIndex.set(fold(a), d);
    for (const r of d.rules) ruleIndex.set(r.ruleId, { doc: d, rule: r });
    for (const f of d.formulas) formulaIndex.set(f.formulaId, { doc: d, formula: f });
    for (const c of d.clauses) clauseIndex.set(c.chunkId, { doc: d, clause: c });
  }
  return {
    manifest,
    documents,
    byCode: (code) => codeIndex.get(fold(code)) ?? null,
    byId: (id) => documents.find((d) => d.documentId === id) ?? null,
    rule: (id) => ruleIndex.get(id) ?? null,
    formula: (id) => formulaIndex.get(id) ?? null,
    clause: (id) => clauseIndex.get(id) ?? null,
  };
}

let cached: NormRegistry | null = null;
export function normRegistry(): NormRegistry {
  if (cached === null) cached = buildRegistry();
  return cached;
}
