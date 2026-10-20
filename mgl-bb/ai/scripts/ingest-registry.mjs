#!/usr/bin/env node
/**
 * `npm run ai:ingest:registry [-- --db <зам>]`
 *
 * L0 НОРМЫН БҮРТГЭЛИЙГ (ai/norm-dataset/registry) + L1 СЭДВИЙН ЧИГЛҮҮЛЭГЧИЙГ (ai/norm-dataset/router,
 * registry/cdc-2025 — 2025 оны бүртгэлийн 524 мөр, 41 сэдэв, өндөр барилгын давхарга) ажилтны локал
 * мэдлэгийн санд оруулна.  L1 файл байхгүй бол зөвхөн L0 (хуучин зан төлөв).
 *
 * ⚠️ `ai:ingest:norm`-оос ТУСДАА, ЗОРИУД.  Багц шингээлт нь баримт тус бүрээр явдаг ба
 *    ГИГАБАЙТ багц шаарддаг; бүртгэл нь git-д байгаа хэдэн зуун мөр — ямар ч багцгүй
 *    машин дээр ч ажиллана («заалт байхгүй ч холбоос зөв»).  Идемпотент: бүхэлд нь
 *    цэвэрлээд дахин бичнэ.  Схемийн хувилбар ХӨНДӨГДӨХГҮЙ (шинэ хүснэгт л).
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadConfig } from '../runtime/src/config.ts';
import { openKnowledgeDbEx } from '../retrieval/src/db.ts';
import { ingestRegistry } from '../retrieval/src/registry.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', 'norm-dataset');
const argv = process.argv.slice(2);
const dbIdx = argv.indexOf('--db');
const cfg = loadConfig();
const dbPath = dbIdx === -1 ? cfg.knowledgeDb : resolve(argv[dbIdx + 1] ?? cfg.knowledgeDb);
const l1 = {
  registry: join(ROOT, 'registry', 'cdc-2025', 'registry_with_verified_delta.jsonl'),
  catalog: join(ROOT, 'router', 'topic_catalog.json'),
  aliases: join(ROOT, 'router', 'topic_aliases.jsonl'),
  assignments: join(ROOT, 'router', 'document_topic_assignments.jsonl'),
  overlays: join(ROOT, 'router', 'building_overlays.json'),
  packageMeta: join(ROOT, 'router', 'PACKAGE.json'),
};
const hasL1 = Object.values(l1).every((p) => existsSync(p));
const paths = {
  norms: join(ROOT, 'registry', 'norms.jsonl'),
  references: join(ROOT, 'registry', 'references.jsonl'),
  taxonomy: join(ROOT, 'taxonomy', 'team_topic_map.json'),
  ...(hasL1 ? { l1 } : {}),
};
for (const p of [paths.norms, paths.references, paths.taxonomy]) {
  if (!existsSync(p)) {
    process.stderr.write(`\n  ✖ Байхгүй: ${p}\n    Эхлээд:  node ai/norm-dataset/tools/build-registry.mjs\n\n`);
    process.exit(1);
  }
}
process.stdout.write('\nMGL AI · L0 нормын бүртгэл шингээх (ЛОКАЛ, D1 БИШ)\n');
process.stdout.write(`  сан: ${dbPath}\n`);
const { db, rebuilt } = openKnowledgeDbEx({ path: dbPath });
if (rebuilt) process.stdout.write('  ! Схем шинэчлэгдсэн тул сан ДАХИН БАРИГДЛАА — багцуудыг `ai:ingest:norm -- --all`-аар буцааж оруулна уу.\n');
const c = ingestRegistry(db, paths);
process.stdout.write(`  ✔ норм ${c.norms} (${Object.entries(c.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')}) · нэр томьёо ${c.terms} · хамаарал ${c.references}\n\n`);
