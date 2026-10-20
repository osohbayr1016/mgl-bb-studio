/**
 * ⚠️ ҮҮСГЭСЭН ФАЙЛ — ГАРААР ЗАСАХГҮЙ.  cd ai && npm run ai:norm:generate
 *    Бүртгэлийн манифест: баримт бүрийн багцын SHA-256 + хөрвүүлсэн агуулгын SHA-256.
 */
import type { CompiledDocument, RegistryManifest } from '../registryTypes';
import { NORM_DOC_BD_21_101_12_2012 } from './bd-21-101-12-2012.generated';

export const NORM_REGISTRY_MANIFEST: RegistryManifest = {
  "documents": [
    {
      "contentSha256": "970ff73fc897ce8d37e4c18c858a5f2ecb91cb5fec3a2ee03cb4892b0b5dc302",
      "counts": {
        "cases": 14,
        "clauses": 80,
        "formulas": 38,
        "rules": 27
      },
      "datasetId": "mgl-ai-bd-21-101-12",
      "datasetSha256": "0f0c659df63f8f592f2a8153b7bf09933a3da1a4419c8093c68c386e6f428813",
      "datasetVersion": "0.2.0",
      "documentCode": "БД 21-101-12",
      "documentId": "BD-21-101-12-2012",
      "generatorVersion": "bd-21-101-12/1",
      "sourceSha256": "22291830d0b83bb34116e157f1fa2a8450b20c82eed3571429b9adfbf49f07f1"
    }
  ],
  "generatorVersion": "mgl-norm-compiler/1",
  "version": 1
};

export const NORM_REGISTRY_DOCUMENTS: readonly CompiledDocument[] = [
  NORM_DOC_BD_21_101_12_2012,
];
