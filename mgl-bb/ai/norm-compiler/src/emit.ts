/**
 * Хөрвүүлсэн баримтыг ДЕТЕРМИНИСТ TS файл болгоно.
 *
 * ⚠️ Гаралт байт бүрээрээ давтагдах ёстой (`--check` нь файлыг байтаар
 *    тулгадаг): огноо, санамсаргүй утга, объектын түлхүүрийн эрэмбийн
 *    зөрүү — аль нь ч БАЙХГҮЙ.  `contentSha256` нь канон JSON-ы хэш тул
 *    үүсгэсэн файлыг гараар засахад манифест таарахаа болино.
 */
import { createHash } from 'node:crypto';
import type { CompiledDocument, RegistryManifest, RegistryManifestEntry } from './model.ts';

export const REGISTRY_MANIFEST_VERSION = 1;
export const GENERATOR_VERSION = 'mgl-norm-compiler/1';

/** Түлхүүрийг эрэмбэлсэн канон JSON — хэш ба файлын агуулга хоёулаа үүгээр. */
export function canonicalJson(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeys(value), null, indent);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function contentSha256(doc: CompiledDocument): string {
  return createHash('sha256').update(canonicalJson(doc, 0)).digest('hex');
}

export function constName(doc: CompiledDocument): string {
  return `NORM_DOC_${doc.documentId.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

export function fileName(doc: CompiledDocument): string {
  return `${doc.documentId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.generated.ts`;
}

export function emitDocument(doc: CompiledDocument): string {
  const header = [
    '/**',
    ' * ⚠️ ҮҮСГЭСЭН ФАЙЛ — ГАРААР ЗАСАХГҮЙ.',
    ` *    ${doc.documentCode} · багц ${doc.datasetId}@${doc.datasetVersion} · dataset sha256 ${doc.datasetSha256}`,
    ` *    Дахин үүсгэх: cd ai && npm run ai:norm:generate   (шалгах: -- --check)`,
    ` *    Үүсгэгч: ${GENERATOR_VERSION} · адаптер: ${doc.generatorVersion}`,
    ' */',
    "import type { CompiledDocument } from '../registryTypes';",
    '',
  ].join('\n');
  return `${header}export const ${constName(doc)}: CompiledDocument = ${canonicalJson(doc)} as const satisfies CompiledDocument;\n`;
}

export function buildManifest(docs: readonly CompiledDocument[]): RegistryManifest {
  const documents: RegistryManifestEntry[] = [...docs]
    .sort((a, b) => a.documentId.localeCompare(b.documentId))
    .map((d) => ({
      documentId: d.documentId,
      documentCode: d.documentCode,
      datasetId: d.datasetId,
      datasetVersion: d.datasetVersion,
      datasetSha256: d.datasetSha256,
      sourceSha256: d.sourceSha256,
      generatorVersion: d.generatorVersion,
      contentSha256: contentSha256(d),
      counts: { rules: d.rules.length, formulas: d.formulas.length, clauses: d.clauses.length, cases: d.cases.length },
    }));
  return { version: REGISTRY_MANIFEST_VERSION, generatorVersion: GENERATOR_VERSION, documents };
}

export function emitManifest(docs: readonly CompiledDocument[]): string {
  const sorted = [...docs].sort((a, b) => a.documentId.localeCompare(b.documentId));
  const imports = sorted.map((d) => `import { ${constName(d)} } from './${fileName(d).replace(/\.ts$/, '')}';`).join('\n');
  const list = sorted.map((d) => `  ${constName(d)},`).join('\n');
  return [
    '/**',
    ' * ⚠️ ҮҮСГЭСЭН ФАЙЛ — ГАРААР ЗАСАХГҮЙ.  cd ai && npm run ai:norm:generate',
    ' *    Бүртгэлийн манифест: баримт бүрийн багцын SHA-256 + хөрвүүлсэн агуулгын SHA-256.',
    ' */',
    "import type { CompiledDocument, RegistryManifest } from '../registryTypes';",
    imports,
    '',
    `export const NORM_REGISTRY_MANIFEST: RegistryManifest = ${canonicalJson(buildManifest(docs))};`,
    '',
    'export const NORM_REGISTRY_DOCUMENTS: readonly CompiledDocument[] = [',
    list,
    '];',
    '',
  ].join('\n');
}
