/**
 * MGL AI · ХОС ФАЙЛУУДЫН ЭХ КОДЫГ УНШИХ ТУСЛАХ (Session D §8).
 *
 * Репод «shared package» БАЙХГҮЙ (CLAUDE.md: NotificationType-ийн заншил —
 * хосыг гараар барина).  Тиймээс drift-ийг ЭХ КОДООС regex-ээр гаргаж
 * тулгана.  Энэ нь хэврэг мэт боловч ЗОРИУД: тухайн тогтмолыг импортлох нь
 * «код өөрчлөгдөхөд тест ч өөрчлөгдөж» зөрүүг нуудаг; текстээс уншвал
 * хоёр тал ТУС ТУСДАА зарласан утга л харьцуулагдана.
 *
 * ⚠️ Файл байхгүй бол `null` — хараахан merge хийгдээгүй сессийн (B/C)
 *    файлууд `skip` болно, «давлаа» гэж бичигдэхгүй.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * Репогийн үндэс — `ai/integration/src/contracts` → 4 дээш.
 *
 * `MGL_AI_REPO=<зам>` нь ӨӨР checkout-ыг (жишээ нь Session B-ийн worktree)
 * merge ХИЙЛГҮЙГЭЭР шалгах боломж (§33): drift/compat тестүүд тэр tree-ийн
 * эх кодыг уншина.  Runtime-ийн гэрээний тест нь ҮРГЭЛЖ энэ tree-ийн серверийг
 * асаана — өөр tree-ийн кодыг ажиллуулахгүй.
 */
export const REPO = process.env.MGL_AI_REPO ? resolve(process.env.MGL_AI_REPO) : resolve(HERE, '..', '..', '..', '..');

export const P = {
  aiPackage: join(REPO, 'ai', 'package.json'),
  registryModels: join(REPO, 'ai', 'registry', 'models.json'),
  runtimeConfig: join(REPO, 'ai', 'runtime', 'src', 'config.ts'),
  runtimeServer: join(REPO, 'ai', 'runtime', 'src', 'server.ts'),
  runtimeUpdater: join(REPO, 'ai', 'runtime', 'src', 'updater.ts'),
  retrievalPipeline: join(REPO, 'ai', 'retrieval', 'src', 'pipeline.ts'),
  knowledgeSchema: join(REPO, 'ai', 'knowledge', 'schema.sql'),
  datasetIdentity: join(REPO, 'ai', 'retrieval', 'src', 'datasetIdentity.ts'),
  deploymentManifest: join(REPO, 'ai', 'deployment', 'src', 'manifest.ts'),
  deploymentNormProviders: join(REPO, 'ai', 'deployment', 'src', 'normProviders.ts'),
  deploymentHealth: join(REPO, 'ai', 'deployment', 'src', 'health.ts'),
  e2eLib: join(REPO, 'ai', 'evaluation', 'lib', 'e2e.mjs'),
  beVersion: join(REPO, 'backend', 'src', 'lib', 'mglai', 'version.ts'),
  beLocalNorm: join(REPO, 'backend', 'src', 'lib', 'mglai', 'localNorm.ts'),
  beRoutes: join(REPO, 'backend', 'src', 'routes', 'mglAi.ts'),
  beRegistryTypes: join(REPO, 'backend', 'src', 'lib', 'mglai', 'norm', 'registryTypes.ts'),
  beRegistryManifest: join(REPO, 'backend', 'src', 'lib', 'mglai', 'norm', 'generated', 'manifest.generated.ts'),
  // Хөтчийн runtime-удирдлага (probe/pair/порт) — хэвээр frontend-д.
  feRuntime: join(REPO, 'frontend', 'src', 'features', 'mgl-ai', 'lib', 'runtime.ts'),
  feApiHost: join(REPO, 'frontend', 'src', 'shared', 'api', 'apiHost.ts'),
  // ⚠️ Session R (R3): ээлжийн хөдөлгүүр, төрөл, validator, runtime-ийн утсан төрөл — бүгд
  //    `packages/mglai-common/src/turn` руу НҮҮСЭН (хөтөч · runtime · Revit нэг зам).  Хуучин
  //    frontend хуулбарууд устсан; drift/compat нь одоо КАНОН эхийг уншина.
  feTypes: join(REPO, 'packages', 'mglai-common', 'src', 'turn', 'types.ts'),
  feOrchestrator: join(REPO, 'packages', 'mglai-common', 'src', 'turn', 'engine.ts'),
  feValidator: join(REPO, 'packages', 'mglai-common', 'src', 'turn', 'validator.ts'),
  pkgRuntimeTypes: join(REPO, 'packages', 'mglai-common', 'src', 'turn', 'runtimeTypes.ts'),
  beTrustedFacts: join(REPO, 'backend', 'src', 'lib', 'mglai', 'trustedFacts.ts'),
} as const;

export function readSource(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** `export const NAME = [ 'a', 'b', … ] as const` → ['a','b'] */
export function constStringArray(src: string, name: string): string[] | null {
  const m = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) return null;
  return [...m[1]!.matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]!);
}

/** `new Set(['a','b'])` → ['a','b'] */
export function constStringSet(src: string, name: string): string[] | null {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*new Set(?:<[^>]+>)?\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) return null;
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

/** `export const NAME = 'value'` → 'value' */
export function constString(src: string, name: string): string | null {
  const m = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*(?::\\s*\\w+)?\\s*=\\s*'([^']+)'`));
  return m ? m[1]! : null;
}

/** TS union `type X = | 'a' | 'b'` эсвэл `phase: 'a' | 'b'` → ['a','b'] */
export function unionLiterals(src: string, anchor: RegExp): string[] | null {
  const m = src.match(anchor);
  if (!m) return null;
  // Гишүүнчлэлийн дараах эхний `;`-ээр таслах.
  const tail = src.slice(m.index! + m[0].length);
  const body = tail.slice(0, tail.search(/;|\n\s*\n/));
  return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

/** `interface Name { … }` блок доторх `key:` нэрс (үүрлэсэн блок орохгүй). */
export function interfaceKeys(src: string, name: string): string[] | null {
  const m = src.match(new RegExp(`interface\\s+${name}\\b[^{]*\\{`));
  if (!m) return null;
  let depth = 1;
  let i = m.index! + m[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
  }
  const body = src.slice(start, i - 1);
  const keys: string[] = [];
  let d = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (d === 0) {
      const km = trimmed.match(/^(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/);
      if (km) keys.push(km[1]!);
    }
    for (const ch of trimmed) {
      if (ch === '{') d++;
      else if (ch === '}') d--;
    }
  }
  return keys;
}
