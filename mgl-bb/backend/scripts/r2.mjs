/**
 * `wrangler r2 object put …` -ийн нимгэн бүрхүүл: bucket-ийн НЭРИЙГ
 * `wrangler.toml`-оос уншиж өөрөө оруулна.  `scripts/d1.mjs`-тэй ижил
 * шалтгаан — npm script дотор команд орлуулалт Windows дээр ажиллахгүй.
 *
 * Хэрэглээ:
 *   node scripts/r2.mjs put media <түлхүүр> --file=<зам> [--content-type=…] [--remote|--local]
 *
 * `media` / `meeting` нь `wrangler.toml`-ийн MEDIA_BUCKET / MEETING_BUCKET
 * binding-үүдийг заана.
 */
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wranglerNames } from './wranglerNames.mjs';

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const [action, which, key, ...rest] = process.argv.slice(2);

if (action !== 'put' || !which || !key) {
  console.error('Хэрэглээ: node scripts/r2.mjs put <media|meeting> <түлхүүр> --file=<зам> [...]');
  process.exit(1);
}

const names = wranglerNames();
const bucket = which === 'media' ? names.mediaBucket : which === 'meeting' ? names.meetingBucket : '';

if (!bucket) {
  console.error(
    `wrangler.toml дотор '${which}' bucket олдсонгүй.  ` +
      'MEDIA_BUCKET / MEETING_BUCKET binding-үүдийг шалгана уу.',
  );
  process.exit(1);
}

const args = ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, ...rest];
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
