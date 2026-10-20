#!/usr/bin/env node
/**
 * BIM леджерийн БИЧИХ ГАРЦЫГ НЭГ ФАЙЛД ХААХ баталгаа.
 *
 * `bim_artifacts` · `bim_sessions` · `revit_transactions` ·
 * `revit_element_touches` · `learning_events` (миграц 0201–0210) руу
 * `INSERT` хийх нь ЗӨВХӨН `src/lib/bimEvents.ts`-д зөвшөөрөгдөнө.
 *
 * ⚠️ Мөн 0206-ын append-only trigger-ээс болж эдгээрийн (`bim_sessions`-оос
 *    бусад) `UPDATE` нь АЖИЛЛАХ ҮЕД `RAISE(ABORT)` өгнө.  Тиймээс UPDATE-ыг
 *    бас барина — production дээр биш, ЭНД унасан нь хямд.
 *
 * ⚠️ ҮНЭНЧ БАЙ: энэ репод lint нь ажиллах үеийн хяналт БИШ.  Хоёр GitHub
 *    workflow хоёулаа унадаг, `wrangler deploy` нь typecheck хийдэггүй,
 *    frontend `lint` нь ~139 өмнөх алдаатай.  Тиймээс энэ скрипт нь
 *    ЗӨВЛӨХ ба ижил шалгалт `src/lib/bimEvents.test.ts`-д ДАВХАР бичигдсэн
 *    (`npm test` нь бодитоор ажилладаг цорын ганц гарц).  Жинхэнэ хяналт
 *    нь DB түвшний CHECK/trigger.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ALLOWED = 'src/lib/bimEvents.ts';

const TABLES = [
  'bim_artifacts',
  'bim_sessions',
  'revit_transactions',
  'revit_element_touches',
  'learning_events',
];
/** `bim_sessions` нь ХУВЬСДАГ хэмжээс — 0206-д ороогүй, UPDATE зөвшөөрөгдөнө. */
const IMMUTABLE = TABLES.filter((t) => t !== 'bim_sessions');

const INSERT_RE = new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+(${TABLES.join('|')})\\b`, 'i');
const UPDATE_RE = new RegExp(`UPDATE\\s+(${IMMUTABLE.join('|')})\\b`, 'i');

const badInsert = [];
const badUpdate = [];

(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!p.endsWith('.ts')) continue;
    const rel = p.replace(/\\/g, '/');
    if (rel.endsWith('.test.ts')) continue;
    const text = readFileSync(p, 'utf8');
    if (!rel.endsWith(ALLOWED) && INSERT_RE.test(text)) badInsert.push(rel);
    if (UPDATE_RE.test(text)) badUpdate.push(rel);
  }
})(SRC);

let failed = false;

if (badInsert.length) {
  failed = true;
  console.error(`BIM хүснэгтэд ГАДНААС INSERT хийсэн файл:\n  ${badInsert.join('\n  ')}`);
  console.error(`Бүх бичилт ${ALLOWED}-ийн writeBimBatch()/insertArtifact()-ээр дамжина.`);
}

if (badUpdate.length) {
  failed = true;
  console.error(
    `Append-only хүснэгтэд UPDATE бичсэн файл (0206-ын trigger таслана):\n  ${badUpdate.join('\n  ')}`,
  );
}

if (failed) process.exit(1);

console.log('✔ BIM леджерийн бичих гарц нэг файлд хаалттай (5 хүснэгт)');
