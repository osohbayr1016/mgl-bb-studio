#!/usr/bin/env node
/**
 * `npm run ai:ingest:l2 -- <documents/<Doc>> [--db <зам>]`
 *
 * L2 ЗААЛТЫН ТАЙЛБАРЫГ (documents/<Doc>/l2/*.jsonl, `tools/build-l2.mjs`-ээр үүссэн) ажилтны локал мэдлэгийн
 * санд оруулна — ЗӨВХӨН `ai_norm_explanations` хүснэгт; хэсэг (`ai_chunks`), дүрэм, FTS ХӨНДӨГДӨХГҮЙ, схемийн
 * хувилбар өсөхгүй.  Идемпотент: тухайн баримтын хуучин тайлбарыг устгаад дахин бичнэ.
 *
 * ⚠️ Багц (pack) нь санд аль хэдийн шингэсэн байх ёстой — тайлбар нь хэсгийн `chunk_id`-аар л олддог.
 *    `ai:ingest:norm -- <pack>` дахин ажиллуулбал L2 автоматаар хамт орно (ingest.ts).
 */
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig } from '../runtime/src/config.ts';
import { openKnowledgeDbEx } from '../retrieval/src/db.ts';
import { ingestExplanations, explanationCounts } from '../retrieval/src/explain.ts';

const argv = process.argv.slice(2);
const dbIdx = argv.indexOf('--db');
const cfg = loadConfig();
const dbPath = dbIdx === -1 ? cfg.knowledgeDb : resolve(argv[dbIdx + 1] ?? cfg.knowledgeDb);
const docDir = argv.find((a, i) => !a.startsWith('--') && (i === 0 || argv[i - 1] !== '--db'));
if (!docDir) {
  process.stderr.write('Хэрэглээ: ai:ingest:l2 -- <documents/<Doc>> [--db <зам>]\n');
  process.exit(1);
}
const l2 = existsSync(join(resolve(docDir), 'l2', 'clause_explanations.jsonl')) ? join(resolve(docDir), 'l2') : resolve(docDir);
if (!existsSync(join(l2, 'clause_explanations.jsonl'))) {
  process.stderr.write(`l2/clause_explanations.jsonl олдсонгүй: ${docDir} — эхлээд node norm-dataset/tools/build-l2.mjs <doc>\n`);
  process.exit(1);
}
const { db } = openKnowledgeDbEx({ path: dbPath });
const r = ingestExplanations(db, l2);
const all = explanationCounts(db);
process.stdout.write(`L2 → ${dbPath}\n  ${r.doc_id}: заалт ${r.clauses} · хэсэг ${r.sections} · баримт ${r.document} · хүснэгт ${r.tables} · томьёо ${r.formulas} · холбоос ${r.links} · хэсэггүй chunk_id ${r.orphan_chunk_ids} · HUMAN_VERIFIED ${r.human_verified}\n  санд нийт: баримт ${all?.documents ?? 0}, заалтын тайлбар ${all?.clauses ?? 0} (AUTO_DRAFT ${all?.auto_draft ?? 0} / HUMAN_VERIFIED ${all?.human_verified ?? 0})\n`);
db.close();
