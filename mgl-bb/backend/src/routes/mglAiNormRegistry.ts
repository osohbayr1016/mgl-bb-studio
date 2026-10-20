/**
 * MGL AI · НОРМЫН БҮРТГЭЛИЙН ТАНИХ ТЭМДЭГ — `GET /api/mgl-ai/norm-registry` (Session D §8/§14).
 *
 * ⚠️ ШИНЭ ҮНЭН БИШ.  Session A-ийн үүсгэсэн `norm/generated/manifest.generated.ts`
 *    (`ai:norm:generate`, баримт бүрийн `datasetSha256` = ingest-тэй ИЖИЛ `datasetIdentity()`)-ыг
 *    wire хэлбэрээр л гаргана.  Ажилтны PC-ийн deployment агент үүнийг `/norm/info`-тэй тулгаж
 *    (`packages/mglai-common normIdentity.compareDatasetIdentity`) `NORM_DATA_VERSION_MISMATCH`
 *    гэж health-д гаргана — Worker-ийн `norm/drift.ts` нь ээлж бүрийн ижил тулгалт.
 *
 * ⚠️ `routes/mglAi.ts`-ээс ГАДУУР (нэгтгэлийн халуун файл) — `index.ts`-д нэг мөр mount.
 *    `/api/*` тул authMiddleware-ийн ард; `client`/`worker` scope-д ОРООГҮЙ (өгөгдмөлөөр хаалттай).
 */
import { Hono } from 'hono';

import type { AppVariables, Env } from '../types';
import { NORM_REGISTRY_MANIFEST } from '../lib/mglai/norm/generated/manifest.generated';
import { NORM_IDENTITY_SCHEMA, identityLines, fingerprintFromHex, toWire, type NormDocumentIdentity } from '@mgl/mglai-common/normIdentity';

export const mglAiNormRegistry = new Hono<{ Bindings: Env; Variables: AppVariables }>();

export function registryIdentities(): NormDocumentIdentity[] {
  return NORM_REGISTRY_MANIFEST.documents.map((d) => ({
    documentId: d.documentId,
    documentCode: d.documentCode,
    datasetId: d.datasetId,
    datasetVersion: d.datasetVersion,
    datasetSha256: d.datasetSha256,
  }));
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

mglAiNormRegistry.get('/norm-registry', async (c) => {
  const docs = registryIdentities();
  const fingerprint = fingerprintFromHex('rf1', await sha256Hex(identityLines(docs)));
  return c.json({
    schema: NORM_IDENTITY_SCHEMA,
    registry_version: fingerprint,
    manifest_version: NORM_REGISTRY_MANIFEST.version,
    generator_version: NORM_REGISTRY_MANIFEST.generatorVersion,
    documents: toWire(docs).map((w, i) => ({ ...w, content_sha256: NORM_REGISTRY_MANIFEST.documents[i]!.contentSha256 })),
  });
});
