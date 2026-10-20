#!/usr/bin/env node
/**
 * `npm run ai:ingest:norm -- <хавтас> [<хавтас> …] [--db <зам>] [--verify] [--strict]`
 *
 * Бэлтгэсэн НОРМАТИВ багцуудыг ажилтны PC дээрх ЛОКАЛ мэдлэгийн санд оруулна.
 *
 * ⚠️ ЭНЭ НЬ `ai:ingest`-ТЭЙ ӨӨР ХЭРЭГСЭЛ.  `ai:ingest` нь түүхий .txt/.docx-ыг
 *    Cloudflare D1 руу илгээдэг (эрхийн метадата, компанийн баримт).  Энэ нь
 *    §11-ийн ЛОКАЛ RAG сан руу бүтэцтэй багц оруулна — D1 РУУ ЮУ Ч ЯВАХГҮЙ.
 *
 * ⚠️ ЭНЭ НЬ СУРГАЛТ БИШ (§16).  Загварын жин ХӨНДӨГДӨХГҮЙ.
 *
 * ⚠️ ОЛОН ХАВТАС АВНА.  Схемийн хувилбар өөрчлөгдөхөд сан ДАХИН БАРИГДДАГ
 *    (`db.ts` — сан нь бүхэлдээ дериватив) тул бүх багцыг НЭГ командаар
 *    буцааж оруулах боломжтой байх ёстой.  Эс тэгвэл ажилтан нэгийг нь
 *    мартаж, «тэр норм алга болжээ» гэсэн байдалд орно.
 *
 * ЖИШЭЭ:
 *    npm run ai:ingest:norm -- ai/data-train-files/* --verify
 */
import { resolve, basename } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { loadConfig } from '../runtime/src/config.ts';
import { openKnowledgeDbEx } from '../retrieval/src/db.ts';
import { ingestDataset } from '../retrieval/src/ingest.ts';

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help') {
  process.stdout.write(
    '\nХэрэглээ:  npm run ai:ingest:norm -- <хавтас> [<хавтас> …] [--db <зам>] [--verify] [--strict]\n' +
      '           npm run ai:ingest:norm -- --all            (data-train-files доторх бүгд)\n\n',
  );
  process.exit(argv.length === 0 ? 1 : 0);
}

const cfg = loadConfig();
const dbIdx = argv.indexOf('--db');
const dbPath = dbIdx === -1 ? cfg.knowledgeDb : resolve(argv[dbIdx + 1] ?? cfg.knowledgeDb);
const verify = argv.includes('--verify');
// GAP-025: аль ч бүртгэлд байхгүй баталгаажилтын төлөв → exit 1 (CI/lint хаалга).
const strict = argv.includes('--strict');

/** `--all` → `ai/data-train-files/` доторх бүх дэд хавтас. */
function expandTargets() {
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--db');
  if (!argv.includes('--all')) return positional.map((p) => resolve(p));

  const root = resolve(new URL('../data-train-files', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  if (!existsSync(root)) {
    process.stderr.write(`\n  ✖ Хавтас олдсонгүй: ${root}\n\n`);
    process.exit(1);
  }
  return readdirSync(root)
    .map((d) => resolve(root, d))
    .filter((p) => statSync(p).isDirectory());
}

const targets = expandTargets();
if (targets.length === 0) {
  process.stderr.write('\n  ✖ Оруулах хавтас заагаагүй байна.\n\n');
  process.exit(1);
}

process.stdout.write('\nMGL AI · норматив багц шингээх (ЛОКАЛ, D1 БИШ)\n');
process.stdout.write(`  сан: ${dbPath}\n\n`);

const { db, rebuilt } = openKnowledgeDbEx({ path: dbPath });

// ⚠️ ДАХИН БАРИЛТЫГ ЧИМЭЭГҮЙ ӨНГӨРӨӨХГҮЙ.  Схем хуучирвал сан
//    цэвэрлэгддэг — өмнө шингээсэн БУСАД багц мөн устсан.
if (rebuilt) {
  process.stdout.write(
    '  ! Схем шинэчлэгдсэн тул сан ДАХИН БАРИГДЛАА.  Өмнө нь шингээсэн\n' +
      '    БҮХ багцыг дахин оруулна уу (`--all` туг үүнийг хийнэ).\n\n',
  );
}

let ok = 0;
let failed = 0;

for (const folder of targets) {
  const name = basename(folder);
  if (!existsSync(folder)) {
    process.stdout.write(`  ✖ ${name}\n     хавтас олдсонгүй\n`);
    failed += 1;
    continue;
  }
  try {
    const c = ingestDataset(db, folder);
    const kinds = Object.entries(c.rulesByKind)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ');
    process.stdout.write(`  ✔ ${c.document}  [${c.profile}]\n`);
    process.stdout.write(`     хэсэг ${c.chunks} · дүрэм ${c.rules} (${kinds})\n`);
    process.stdout.write(`     alias ${c.aliases} · тест ${c.tests} QA · ${c.cases} тооцоо\n`);
    // ⚠️ БАТАЛГААЖААГҮЙ МӨРИЙГ ИЛ ЗАРЛАНА.  Тэд ХАЙГДАНА ч ГҮЙЦЭТГЭГДЭХГҮЙ.
    if (c.unverifiedRules > 0) {
      process.stdout.write(
        `     ! ${c.unverifiedRules} дүрэм «needs_human_review» — хайгдана, ГЭВЧ\n` +
          '       эрх бүхий хариу болж ГҮЙЦЭТГЭГДЭХГҮЙ (rules.ts-ийн хаалга).\n',
      );
    }
    for (const w of c.warnings) process.stdout.write(`     ! ${w}\n`);
    // GAP-025: баталгаажилтын төлөв бүр ГУРВАН ангийн аль нэгэнд — танигдаагүй нь ХААЛТТАЙ
    //    (гүйцэтгэгдэхгүй) ч ЧИМЭЭГҮЙ биш: энд тайлагнана, `--strict`-д унана.
    const va = c.verification;
    const nonExec = Object.entries(va.statuses).filter(([, v]) => v.class === 'non_executable');
    if (nonExec.length > 0) {
      process.stdout.write(`     · гүйцэтгэгдэхгүй (бүртгэлтэй) төлөв: ${nonExec.map(([k, v]) => `${k} ×${v.rows}`).join(', ')}\n`);
    }
    if (va.unknown.length > 0) {
      process.stdout.write(
        `     ✖ ТАНИГДААГҮЙ баталгаажилтын төлөв: ${va.unknown.map((k) => `«${k}» ×${va.statuses[k].rows}`).join(', ')}\n` +
          '       → эрх бүхий БИШ (хаалттай); rules.ts-ийн EXECUTABLE_VERIFICATION эсвэл\n' +
          '         KNOWN_NON_EXECUTABLE_VERIFICATION-д шалтгаантай нь бүртгэ.\n',
      );
      if (strict) process.exitCode = 1;
    }
    if (va.markedUsableNonExecutable.rows > 0) {
      process.stdout.write(
        `     ! ${va.markedUsableNonExecutable.rows} мөр usable_for_current_compliance=true атлаа төлөв нь гүйцэтгэгдэхгүй` +
          ` (${va.markedUsableNonExecutable.statuses.join(', ')}) — багцын туг төлөвийг ДЭЭШЛҮҮЛЭХГҮЙ, хүний хяналтад.\n`,
      );
    }
    ok += 1;
  } catch (err) {
    process.stdout.write(`  ✖ ${name}\n     ${err instanceof Error ? err.message : String(err)}\n`);
    failed += 1;
  }
}

if (verify) {
  const one = (sql) => db.prepare(sql).get();
  const chunk = one('SELECT COUNT(*) AS n FROM ai_chunks');
  const fts = one('SELECT COUNT(*) AS n FROM ai_chunks_fts');
  const rule = one('SELECT COUNT(*) AS n FROM ai_rules');
  const docs = one('SELECT COUNT(*) AS n FROM ai_documents');
  process.stdout.write(
    `\n  шалгалт:  баримт ${docs.n} · хэсэг ${chunk.n} · fts ${fts.n} · дүрэм ${rule.n}\n`,
  );
  // ⚠️ FTS ба үндсэн хүснэгтийн тоо ЗӨРВӨЛ индекс хэсэгчилсэн — тэр нь
  //    «зарим норм хайлтад огт олдохгүй» гэсэн ЧИМЭЭГҮЙ алдаа.
  if (chunk.n !== fts.n) {
    process.stderr.write('  ✖ FTS индекс ба хэсгийн тоо ЗӨРЖ БАЙНА — индекс дутуу.\n');
    process.exitCode = 1;
  }
  const orphan = one(
    'SELECT COUNT(*) AS n FROM ai_rules r LEFT JOIN ai_chunks c ON c.chunk_id = r.chunk_id WHERE c.chunk_id IS NULL',
  );
  if (orphan.n > 0) {
    process.stderr.write(`  ✖ ${orphan.n} дүрэм эх хэсэггүй — эшлэл гаргаж чадахгүй.\n`);
    process.exitCode = 1;
  }
}

db.close();
process.stdout.write(`\n  ${ok} амжилттай, ${failed} алдаа\n`);
process.stdout.write('\n  Дараа нь:  npm run ai:eval:norm\n\n');
if (failed > 0) process.exitCode = 1;
