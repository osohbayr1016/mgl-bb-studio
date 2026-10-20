/**
 * `wrangler.toml`-оос нөөцийн НЭРСИЙГ уншина.
 *
 * Урьд нь `mgl-progress-db`, `mgl-progress-media` гэсэн нэрс `package.json`-ы
 * долоон скрипт болон хоёр туслах скриптэд ШУУД бичигдсэн байсан.  Шинэ
 * компанид суулгахад тэдгээрийг бүгдийг нь гараар олж засах шаардлагатай
 * болдог байв — нэгийг нь мартвал скрипт ЧИМЭЭГҮЙ буруу (эсвэл байхгүй)
 * өгөгдлийн сан руу заана.
 *
 * Одоо `wrangler.toml` нь ГАНЦ эх сурвалж.  Энэ файл нь бүрэн TOML задлагч
 * БИШ — зөвхөн хэрэгтэй хэдэн түлхүүрийг уншина, тиймээс гуравдагч сан
 * шаардахгүй (backend нь runtime dependency-гүй байлгах бодлоготой).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(backendDir, 'wrangler.toml');

/** Тайлбар (`#`) хассан мөрүүд — `# database_name = "..."` мэхлэхээс сэргийлнэ. */
function significantLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

/**
 * `key = "value"` хэлбэрийн ЭХНИЙ таарцыг буцаана.  `afterLine` өгвөл түүнээс
 * ХОЙШ хайна — ижил түлхүүр (`bucket_name`) хэд хэдэн блокт давтагддаг.
 */
function readKey(lines, key, fromIndex = 0) {
  const re = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`);
  for (let i = fromIndex; i < lines.length; i += 1) {
    const m = re.exec(lines[i]);
    if (m) return { value: m[1], index: i };
  }
  return null;
}

/** `binding = "NAME"` мөрийн индекс — тухайн блокийн эхлэлийг олоход. */
function indexOfBinding(lines, binding) {
  const re = new RegExp(`^binding\\s*=\\s*"${binding}"`);
  return lines.findIndex((l) => re.test(l));
}

let cached = null;

/**
 * @returns {{workerName: string, databaseName: string, databaseId: string, mediaBucket: string, meetingBucket: string}}
 */
export function wranglerNames() {
  if (cached) return cached;

  const lines = significantLines(readFileSync(configPath, 'utf8'));

  const worker = readKey(lines, 'name');
  const db = readKey(lines, 'database_name');
  // miniflare нь локал D1 файлыг sha256(database_id)-аар нэрлэдэг —
  // scripts/cleanup/lib.mjs prod хуулбарыг олоход хэрэглэнэ.
  const dbId = readKey(lines, 'database_id');

  const mediaAt = indexOfBinding(lines, 'MEDIA_BUCKET');
  const meetingAt = indexOfBinding(lines, 'MEETING_BUCKET');
  const media = mediaAt >= 0 ? readKey(lines, 'bucket_name', mediaAt) : null;
  const meeting = meetingAt >= 0 ? readKey(lines, 'bucket_name', meetingAt) : null;

  if (!db) {
    throw new Error(
      `wrangler.toml дотор database_name олдсонгүй (${configPath}).  ` +
        '[[d1_databases]] блок байгаа эсэхийг шалгана уу.',
    );
  }

  cached = {
    workerName: worker?.value ?? 'worker',
    databaseName: db.value,
    databaseId: dbId?.value ?? '',
    mediaBucket: media?.value ?? '',
    meetingBucket: meeting?.value ?? '',
  };
  return cached;
}

/* CLI горим:  node scripts/wranglerNames.mjs databaseName  →  нэрийг хэвлэнэ.
   npm скриптүүдэд команд орлуулалт (`$(…)`) Windows дээр ажилладаггүй тул
   `scripts/d1.mjs` / `scripts/r2.mjs` эдгээрийг import хийж хэрэглэнэ. */
if (process.argv[1] && process.argv[1].endsWith('wranglerNames.mjs')) {
  const key = process.argv[2] ?? 'databaseName';
  const names = wranglerNames();
  if (!(key in names)) {
    console.error(`Танихгүй түлхүүр: ${key}.  Боломжтой: ${Object.keys(names).join(', ')}`);
    process.exit(1);
  }
  process.stdout.write(names[key]);
}
