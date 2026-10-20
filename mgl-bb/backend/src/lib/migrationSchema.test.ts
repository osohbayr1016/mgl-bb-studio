/**
 * МИГРАЦЫН ФОЛДЕРЫН БҮТЦИЙН ХАМГААЛАЛТ.
 *
 * Run with:  node --test src/lib/migrationSchema.test.ts
 *
 * ⚠️ ЯАГААД ЭНЭ ТЕСТ ОРШИН БАЙНА ВЭ (2026-08-28).  Хоёр сесс ЗЭРЭГ ажиллаж,
 *    хоёулаа `assistant_examples`-д `reviewed_at` багана нэмсэн:
 *      0214_assistant_review.sql        ALTER TABLE assistant_examples ADD COLUMN reviewed_at TEXT
 *      0215_assistant_trust_taxonomy.sql ALTER TABLE assistant_examples ADD COLUMN reviewed_at TEXT
 *    `wrangler d1 migrations apply` нь ХҮЛЭЭГДЭЖ БУЙ файл БҮРИЙГ дараалан
 *    ажиллуулдаг тул энэ нь `duplicate column name: reviewed_at` -ээр
 *    ПРОДАКШНД унах байсан — 0211..0214 орсны ДАРАА, өөрөөр хэлбэл
 *    ХАГАС ХЭРЭГЖСЭН төлөвт.  Түүнийг зөвхөн ГАРААР хийсэн аудит барьсан.
 *
 *    Тайлбар хуучирдаг, аудит бүрэн бус байдаг, тест хуучирдаггүй.
 *
 * ⚠️ ЭНЭ ТЕСТ НЬ REPLAY БИШ.  Бүх миграцыг ажиллуулах боломжгүй: `0021`,
 *    `0022`, `0024`, `0025` нь 1 байтын ХООСОН файл (репо сэргээх үед
 *    алдагдсан) бөгөөд `0023`/`0026` нь тэдгээрийн үүсгэх ёстой байсан
 *    хүснэгтүүдийг иш татдаг.  Тиймээс энд ЗӨВХӨН статик, дараалалд
 *    хамаарах инвариантуудыг шалгана.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/** Мөрийн (`--`) тайлбарыг хасна.  Блок тайлбар энэ репод хэрэглэгддэггүй. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

interface Statement {
  file: string;
  kind: 'create' | 'drop' | 'add';
  table: string;
  column?: string;
}

/**
 * Миграцуудыг ФАЙЛЫН НЭРЭЭР эрэмбэлж (wrangler яг тэгдэг) хүснэгтийн
 * амьдралд нөлөөлөх statement-үүдийг цуглуулна.
 */
function collectStatements(): { files: string[]; statements: Statement[] } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const statements: Statement[] = [];
  for (const file of files) {
    const sql = stripComments(readFileSync(join(MIGRATIONS, file), 'utf8'));

    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?/gi,
    )) {
      statements.push({ file, kind: 'create', table: m[1]! });
    }
    for (const m of sql.matchAll(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?/gi,
    )) {
      statements.push({ file, kind: 'drop', table: m[1]! });
    }
    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+ADD\s+(?:COLUMN\s+)?["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?/gi,
    )) {
      statements.push({ file, kind: 'add', table: m[1]!, column: m[2]! });
    }
  }
  return { files, statements };
}

/* ================================================================== */

test('нэг багана НЭГ хүснэгтэд ХОЁР УДАА нэмэгддэггүй', () => {
  // ⚠️ SQLite-ийн `ALTER TABLE ... ADD COLUMN` нь `IF NOT EXISTS`-ыг
  //    ДЭМЖДЭГГҮЙ — давхардал нь ЗААВАЛ `duplicate column name` алдаа болно.
  // ⚠️ Хүснэгтийг ДАХИН БАРИХ (path B) нь хууль ёсны: `CREATE TABLE` /
  //    `DROP TABLE` тааралдвал тухайн хүснэгтийн багануудыг ТЭГЛЭНЭ,
  //    улмаар дараа нь ижил нэрийг дахин нэмэх нь ЗӨВ болно.
  const { statements } = collectStatements();
  const columns = new Map<string, Map<string, string>>(); // table -> column -> file
  const dupes: string[] = [];

  for (const s of statements) {
    if (s.kind === 'create' || s.kind === 'drop') {
      columns.set(s.table, new Map());
      continue;
    }
    let known = columns.get(s.table);
    if (!known) {
      known = new Map();
      columns.set(s.table, known);
    }
    const prev = known.get(s.column!);
    if (prev) {
      dupes.push(`${s.table}.${s.column} — ${prev} ба ${s.file} ХОЁУЛАА нэмнэ`);
    } else {
      known.set(s.column!, s.file);
    }
  }

  assert.deepEqual(
    dupes,
    [],
    'ХОЁР миграц ижил баганыг нэмж байна — `migrations apply` ХАГАС ' +
      'ХЭРЭГЖСЭН төлөвт унана:\n  ' + dupes.join('\n  '),
  );
});

test('миграцын дугаар давхардвал ЗӨВХӨН мэдэгдэж буй түүхэн жагсаалтад байна', () => {
  // ⚠️ Репод УРЬД НЬ давхардсан зургаан дугаар бий (0002, 0060, 0080, 0110,
  //    0120, 0121) — тэдгээр нь ХЭРЭГЖСЭН тул засах боломжгүй.  ШИНЭ
  //    давхардал нэмэгдвэл энэ тест барина: хоёр агент нэг дугаар авах нь
  //    зэрэгцээ ажиллагааны хамгийн түгээмэл мөргөлдөөн.
  // ⚠️ CLAUDE.md нь ЗУРГААГ (0002, 0060, 0080, 0110, 0120, 0121) жагсаадаг —
  //    БОДИТ тоо нь НАЙМ.  `0173` ба `0176` нь баримтжуулаагүй байсныг ЭНЭ
  //    ТЕСТ анх удаа илрүүлэв (2026-08-28).  Хоёулаа аль хэдийн ХЭРЭГЖСЭН
  //    тул засах боломжгүй — түүхэн баримт болгон бүртгэв.
  // ⚠️ `0211` нь 2026-08-31-нд нэмэгдэв: `0211_asr_only_projects.sql`
  //    (зохиогчийн хяналтын төсөл) нь ПРОДАКШНД АЛЬ ХЭДИЙН ХЭРЭГЖИЖ
  //    `d1_migrations`-д тэр НЭРЭЭР бүртгэгдсэн байсан тул дугаарыг нь
  //    солих боломжгүй — нэр солиход дахин хэрэгжиж «duplicate column
  //    name: asr_only» гэж унана.  Хосолсон `0211_user_tokens_valid_from.sql`
  //    нь ХЭРЭГЖЭЭГҮЙ хэвээр; файлын нэр өөр тул хоёулаа дарааллаараа
  //    хэрэгжинэ (`asr` < `user` тул ЗХ-ийнх эхэлнэ).
  const KNOWN_DUPLICATE_PREFIXES = new Set([
    '0002', '0060', '0080', '0110', '0120', '0121', '0173', '0176', '0211',
  ]);
  const { files } = collectStatements();
  const byPrefix = new Map<string, string[]>();
  for (const f of files) {
    const prefix = f.slice(0, 4);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), f]);
  }
  const unexpected = [...byPrefix.entries()]
    .filter(([prefix, list]) => list.length > 1 && !KNOWN_DUPLICATE_PREFIXES.has(prefix))
    .map(([prefix, list]) => `${prefix}: ${list.join(', ')}`);

  assert.deepEqual(unexpected, [], `ШИНЭ дугаарын давхардал: ${unexpected.join(' | ')}`);
});

test('миграц бүр D1-ийн ТЭЭВРИЙН ДҮРМИЙГ дагана', () => {
  // ⚠️ 2026-08-27-нд хаягдах алсын D1 дээр ХЭМЖСЭН: `wrangler d1 migrations
  //    apply` нь файлыг `d1_migrations`-ийн INSERT-тэй залгаад НЭГ
  //    `--command` болгож D1-ийн `/query` руу илгээдэг.  Тэр задлагч нь
  //      (1) блок тайлбарыг (slash-star) ОЙЛГОДОГГҮЙ,
  //      (2) мөрөн ДОТОРХ `;`-ээр хуваадаг,
  //      (3) нэг дуудлагад хэт олон statement байвал унадаг (5/7/8/9 ✅).
  //    Мөрийн (`--`) тайлбар доторх `;` нь АЮУЛГҮЙ — хэрэгжсэн 190 миграцын
  //    84 нь тэгсэн.
  //
  // ⚠️ ЗӨВХӨН ШИНЭ файлуудад.  Хэрэгжсэн миграцыг засах нь продакшн дээр
  //    ЧИМЭЭГҮЙ no-op тул хуучин зөрчлийг «засах» нь утгагүй; тэднийг
  //    түүхэн баримт болгон ҮЛДЭЭНЭ.
  const FIRST_GUARDED = '0211';
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && f.slice(0, 4) >= FIRST_GUARDED)
    .sort();

  const problems: string[] = [];
  for (const f of files) {
    const raw = readFileSync(join(MIGRATIONS, f), 'utf8');
    if (raw.includes('/*')) problems.push(`${f}: блок тайлбар (/*) — задлагч ойлгохгүй`);

    const stripped = stripComments(raw);
    const statementCount = stripped.split(';').filter((s) => s.trim().length > 0).length;
    if (statementCount > 9) {
      problems.push(`${f}: ${statementCount} statement (дээд тал нь 9)`);
    }
  }

  assert.deepEqual(problems, [], `Тээврийн дүрэм зөрчсөн:\n  ${problems.join('\n  ')}`);
});

test('миграцын фолдер хоосон биш, дугаарлалт өсөж байна', () => {
  const { files } = collectStatements();
  assert.ok(files.length > 200, `хэт цөөн миграц: ${files.length}`);
  const numbered = files.filter((f) => /^\d{4}_/.test(f));
  assert.equal(numbered.length, files.length, 'дугааргүй миграцын файл байна');
});
