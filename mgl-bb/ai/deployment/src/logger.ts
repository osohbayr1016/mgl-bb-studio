/**
 * MGL AI · БҮТЭЦТЭЙ ЛОГ, ЭРГЭЛТТЭЙ (Session B §31).
 *
 *   logs/<category>.log         одоогийн
 *   logs/<category>.1.log …N    эргэсэн
 *
 * ⚠️ ДИСК ХЯЗГААРГҮЙ ӨСӨХГҮЙ.  `runtime.log` (start.ps1) нь өнөөдөр
 *    хязгааргүй — 6 сарын дараа GB.  Энд файл бүр `maxBytes`, `maxFiles`.
 *
 * ⚠️ БҮХ МӨР REDACT-ЛАГДАНА.  Лог нь диагностик багц руу орох тул JWT,
 *    `x-mglai-secret`, `Bearer` бичигдэхээс ӨМНӨ л хасагдана — «экспорт
 *    хийхдээ цэвэрлэнэ» гэдэг нь нэг өдөр мартагдана.
 *
 * ⚠️ СИНХРОН `appendFileSync`.  Лог нь runtime унахын ӨМНӨХ сүүлийн мөрийг
 *    барих ёстой; async бичилт нь `process.exit` дээр алдагдана.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { redactText } from './telemetry.ts';

export const LOG_CATEGORIES = [
  'supervisor',
  'runtime',
  'updater',
  'model',
  'knowledge',
  'auth',
  'revit',
  'telemetry',
  'feedback',
  'health',
] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  cat: LogCategory;
  msg: string;
  data?: Record<string, unknown>;
}

export interface LoggerOptions {
  dir: string;
  category: LogCategory;
  /** Өгөгдмөл 2 MB. */
  maxBytes?: number;
  /** Өгөгдмөл 5 (одоогийн + 4 эргэсэн). */
  maxFiles?: number;
  /** Тест/консол — файлын оронд. */
  sink?: (entry: LogEntry) => void;
  now?: () => string;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  readonly file: string;
}

function rotate(file: string, maxFiles: number): void {
  // .N-1 → .N, …, .1 → .2, current → .1
  const base = file.replace(/\.log$/, '');
  const last = `${base}.${maxFiles - 1}.log`;
  if (existsSync(last)) unlinkSync(last);
  for (let i = maxFiles - 2; i >= 1; i--) {
    const from = `${base}.${i}.log`;
    if (existsSync(from)) renameSync(from, `${base}.${i + 1}.log`);
  }
  if (existsSync(file)) renameSync(file, `${base}.1.log`);
}

function scrubData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = typeof v === 'string' ? redactText(v) : v;
  }
  return out;
}

export function createLogger(opts: LoggerOptions): Logger {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const maxFiles = Math.max(2, opts.maxFiles ?? 5);
  const file = join(opts.dir, `${opts.category}.log`);
  const now = opts.now ?? (() => new Date().toISOString());

  const write = (level: LogLevel, msg: string, data?: Record<string, unknown>): void => {
    const entry: LogEntry = { ts: now(), level, cat: opts.category, msg: redactText(msg) };
    const d = scrubData(data);
    if (d) entry.data = d;
    if (opts.sink) {
      opts.sink(entry);
      return;
    }
    try {
      mkdirSync(opts.dir, { recursive: true });
      let size = 0;
      try {
        size = statSync(file).size;
      } catch {
        size = 0;
      }
      if (size >= maxBytes) rotate(file, maxFiles);
      appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // Лог бичиж чадахгүй нь програмыг унагаах ёсгүй.
    }
  };

  return {
    file,
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}

/** Файлын СҮҮЛИЙН N мөрийг уншина (диагностик) — бүтэн файлыг санах ойд авахгүй. */
export function tailLines(file: string, n: number, readFileImpl: (p: string) => string): string[] {
  let text: string;
  try {
    text = readFileImpl(file);
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.slice(-n).map(redactText);
}
