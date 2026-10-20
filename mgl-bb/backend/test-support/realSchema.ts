// REAL-SCHEMA тестийн суурь (2026-10-05): хуучин `allocHarness.makeDb` нь users/projects/tasks хүснэгтийг ГАРААР бичсэн
// хялбаршуулсан хуулбар.  Энэ нь репогийн БҮХ миграцыг (0001…) дарааллаар нь `node:sqlite` дээр ажиллуулж ПРОД-д ойр схем
// (CHECK, UNIQUE, индекс, бодит users/projects/user_points) үүсгэнэ.
//
// ⚠️ Миграцийн хавтас нь схем БИШ (CLAUDE.md): 0021/0022/0024/0025 хоосон, `project_threads` байхгүй, 0348/0349/0353 нь
// `projects.category`-г хүлээдэг.  Тиймээс миграц бүрийг ЭХЛЭЭД бүтнээр, унавал statement-ээр нь ажиллуулж, унасан
// statement-үүдийг `skipped`-д тэмдэглэнэ — прод-той тэнцүү ГЭЖ ХЭЛЭХГҮЙ, харин allocation кодын ашигладаг хүснэгт/баганыг
// бодитоор шалгах «ойр» схем.  Хэрэглэгч: `upgrade` тест (0376–0380 өмнө → 0383 → 0384), аудитор, миграцын дахин ажиллалт.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

export interface RealSchemaOptions {
  /** Энэ нэрээс (файлын нэрийн угтвар, жишээ '0375') ХҮРТЭЛХ миграцыг л ажиллуулна. */
  upTo?: string;
  /** Энэ нэрээс ӨМНӨ биш (оруулан) миграц ажиллуулахгүй — upgrade-ийн дараагийн алхамд. */
  exclude?: readonly string[];
  /** FOREIGN KEY хэрэгжүүлэх (прод `PRAGMA foreign_keys = 1`). */
  foreignKeys?: boolean;
}

export interface RealSchema {
  sqlite: DatabaseSync;
  /** Ажиллуулсан файлууд. */
  applied: string[];
  /** Унасан statement-үүд (файл: алдаа) — мэдэгдэж буй бүртгэлтэй тулгана. */
  skipped: string[];
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export function readMigration(file: string): string {
  return readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8');
}

/** Нэг миграцыг ажиллуулна: эхлээд бүтнээр, унавал statement-ээр.  Унасан statement-үүдийг буцаана. */
export function applyMigrationTolerant(sqlite: DatabaseSync, file: string): string[] {
  const sql = readMigration(file);
  try {
    sqlite.exec(sql);
    return [];
  } catch {
    const failed: string[] = [];
    for (const part of sql.split(/;\s*\n/)) {
      if (!part.trim()) continue;
      try {
        sqlite.exec(part);
      } catch (e) {
        failed.push(`${file}: ${String((e as Error).message).slice(0, 100)}`);
      }
    }
    return failed;
  }
}

/**
 * Миграцыг ЯГ ТЭР ХЭЛБЭРЭЭР ажиллуулна (толерантгүй) — allocation-ийн 0376–0384 нь схем нэмэлт тул ЗААВАЛ цэвэр
 * ажиллах ёстой; унавал тест унана.
 */
export function applyMigrationStrict(sqlite: DatabaseSync, file: string): void {
  sqlite.exec(readMigration(file));
}

export function makeRealSchema(opts: RealSchemaOptions = {}): RealSchema {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = OFF');
  const applied: string[] = [];
  const skipped: string[] = [];
  const exclude = new Set(opts.exclude ?? []);
  for (const f of migrationFiles()) {
    if (opts.upTo && f.slice(0, opts.upTo.length) > opts.upTo) continue;
    if (exclude.has(f)) continue;
    skipped.push(...applyMigrationTolerant(sqlite, f));
    applied.push(f);
  }
  if (opts.foreignKeys) sqlite.exec('PRAGMA foreign_keys = ON');
  return { sqlite, applied, skipped };
}

/** `PRAGMA table_info` → багана нэрс. */
export function columnsOf(sqlite: DatabaseSync, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

export function indexesOf(sqlite: DatabaseSync, table: string): string[] {
  return (sqlite.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((i) => i.name).sort();
}

/** Схемийн хурууны хээ: хүснэгт + багана + индекс (нэр, UNIQUE, partial) — `clean` ↔ `upgrade` тэнцүү эсэхийг шалгана. */
export function schemaFingerprint(sqlite: DatabaseSync, tables: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of tables) {
    const cols = (sqlite.prepare(`PRAGMA table_info(${t})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>).map((c) => `${c.name}:${c.type}:${c.notnull}:${String(c.dflt_value)}:${c.pk}`);
    const idx = (sqlite.prepare(`PRAGMA index_list(${t})`).all() as Array<{ name: string; unique: number; partial: number }>)
      .filter((i) => !i.name.startsWith('sqlite_autoindex'))
      .map((i) => {
        const info = (sqlite.prepare(`PRAGMA index_xinfo(${i.name})`).all() as Array<{ name: string | null; desc: number; key: number }>)
          .filter((x) => x.key === 1)
          .map((x) => `${x.name}${x.desc ? ' DESC' : ''}`);
        return `${i.name}|u${i.unique}|p${i.partial}|${info.join(',')}`;
      })
      .sort();
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(t) as { sql: string } | undefined;
    out[t] = { cols, idx, checks: (row?.sql.match(/CHECK\s*\(/gi) ?? []).length };
  }
  return out;
}
