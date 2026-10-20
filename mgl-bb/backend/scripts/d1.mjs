/**
 * `wrangler d1 …` -ийн нимгэн бүрхүүл: өгөгдлийн сангийн НЭРИЙГ
 * `wrangler.toml`-оос уншиж өөрөө оруулна.
 *
 * Яагаад скрипт хэрэгтэй вэ: npm script дотор команд орлуулалт (`$(…)`) нь
 * Windows дээр ажилладаггүй тул нэрийг гаднаас нь шахах боломжгүй.  Node
 * бүрхүүл нь Windows/macOS/Linux гурвуулан дээр ижил ажиллана.
 *
 * Хэрэглээ (эхний аргумент нь d1-ийн дэд команд):
 *   node scripts/d1.mjs migrations apply --local
 *   node scripts/d1.mjs execute --local --file=./migrations/0001_init.sql
 *   node scripts/d1.mjs export --remote --output=backup.sql
 *
 * `--config wrangler.toml`-ыг ҮРГЭЛЖ өөрөө нэмнэ: репогийн үндэсд байгаа
 * `wrangler.jsonc` нь ӨӨР worker зарладаг бөгөөд wrangler-ийн config хайлт
 * түүнийг сонгож авах эрсдэлтэй (CLAUDE.md-д тэмдэглэсэн).
 */
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wranglerNames } from './wranglerNames.mjs';

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const [subcommand, ...rest] = process.argv.slice(2);

if (!subcommand) {
  console.error('Хэрэглээ: node scripts/d1.mjs <дэд-команд> [аргументууд…]');
  console.error('Жишээ:   node scripts/d1.mjs migrations apply --local');
  process.exit(1);
}

const { databaseName } = wranglerNames();

/* `migrations apply` гэх мэт хоёр үгтэй дэд командыг зөв байрлуулна:
   wrangler нь `d1 migrations apply <DB>` гэж хүлээдэг, `d1 migrations <DB> apply` биш. */
const twoWord = subcommand === 'migrations' && rest.length > 0;
const head = twoWord ? [subcommand, rest[0]] : [subcommand];
const tail = twoWord ? rest.slice(1) : rest;

const args = [
  'wrangler',
  'd1',
  ...head,
  databaseName,
  ...tail,
  ...(tail.includes('--config') ? [] : ['--config', 'wrangler.toml']),
];

/** Windows дээр `npx` нь `.cmd` тул `shell: true` заавал хэрэгтэй; тэгэхээр
 *  wrangler-т очих аргументуудыг ӨӨРСДӨӨ хашилтлана.  Эс бөгөөс
 *  `--command "SELECT 1"` гэсэн зай агуулсан аргумент хоёр хэсэг болж
 *  хуваагдаж, wrangler «Unknown argument: 1» гэж унана. */
function shellQuote(arg) {
  if (!/[\s"']/.test(arg)) return arg;
  // POSIX: нэг хашилт доторх `'`-ыг хаагаад, escape хийж, дахин нээнэ → '\''
  return process.platform === 'win32'
    ? `"${arg.replace(/"/g, '\\"')}"`
    : `'${arg.replace(/'/g, "'\\''")}'`;
}

console.log(`→ npx ${args.join(' ')}`);
const res = spawnSync('npx', args.map(shellQuote), {
  cwd: backendDir,
  stdio: 'inherit',
  shell: true,
});
process.exit(res.status ?? 1);
