#!/usr/bin/env node
/**
 * MGL AI · СУУЛГАЦЫН ХЭСГҮҮДИЙГ НИЙТЛЭХ (§16, §19, §36).
 *
 *   node scripts/publish-installer.mjs --pack-runtime
 *   node scripts/publish-installer.mjs --installer <зам> --version 1.0.0
 *   node scripts/publish-installer.mjs --components components.local.json
 *   … + `--apply` (эс тэгвэл зөвхөн ТУШААЛЫГ хэвлэнэ)
 *
 * ⚠️ ХОЁР ӨӨР BUCKET, ХОЁР ӨӨР ШАЛТГААН.  Энэ ялгаа нь бүхэл суулгацын
 *    аюулгүй байдлын загварыг тодорхойлдог:
 *
 *      MEDIA_BUCKET  (НИЙТИЙН, нэвтрэлтгүй)
 *        node · llama.cpp · runtime-code · components.json
 *        Эдгээр нь нээлттэй эхийн дахин түгээгддэг файл ба БИДНИЙ
 *        бичсэн код.  Нийтэд байснаар СУУЛГАГЧ ЯМАР Ч ИТГЭМЖЛЭЛГҮЙ
 *        ажиллана — тэр нь §4-ийн «no API key, no password» шаардлагыг
 *        биелүүлэх ЦОРЫН ГАНЦ зам.
 *
 *      MEETING_BUCKET (ХУВИЙН, нэвтрэлттэй)
 *        суулгагчийн .exe · загварын жин · адаптер
 *        Загварын жин нь лицензтэй артефакт; нийтэд тавих нь арилжааны
 *        дахин түгээлт болно (`license_cleared` хаалганы утга учир).
 *
 * ⚠️ `/media/:key` НЬ ЯГ НЭГ СЕГМЕНТ ТААРУУЛДАГ (репогийн мэдэгдэж буй
 *    зан төлөв).  Тиймээс нийтийн түлхүүрт «/» БАЙЖ БОЛОХГҮЙ —
 *    `mgl-ai/node.zip` нь 404 өгнө, `mgl-ai-node.zip` нь ажиллана.
 *    Энэ файлын бүх нийтийн түлхүүр ХАВТСАНГҮЙ байгаа нь тэр учраас.
 *
 * ⚠️ ӨГӨГДМӨЛӨӨР ЮУ Ч ХИЙХГҮЙ.  `--apply` байхгүй бол зөвхөн тушаал ба
 *    SQL-ийг хэвлэнэ.  Прод руу түлхэх нь хүний шийдвэр байх ёстой —
 *    ялангуяа wrangler-ийн OAuth токен дунд нь унтардаг (санах ой).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AI_DIR = dirname(HERE);
const REPO = dirname(AI_DIR);
const DIST = join(AI_DIR, 'dist');

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const APPLY = argv.includes('--apply');

/** ⚠️ `--config wrangler.toml` нь ЗААВАЛ — репогийн үндэс дэх стрэй `wrangler.jsonc`-ээс сэргийлнэ. */
const WRANGLER_CFG = join(REPO, 'backend', 'wrangler.toml');
/**
 * ⚠️ BUCKET-ИЙН НЭР = `backend/wrangler.toml`-ИЙН `bucket_name`.  2026-09-16
 *    хүртэл энд `mgl-media` / `mgl-meetings` гэсэн ХУДАЛ нэр байсан тул
 *    `--apply` нь байхгүй bucket руу бичих гэж унадаг байв — суулгагч
 *    хэзээ ч нийтлэгдээгүйн нэг шалтгаан.
 */
const PUBLIC_BUCKET = 'mgl-progress-media';   // wrangler.toml MEDIA_BUCKET
const PRIVATE_BUCKET = 'mgl-meeting-audio';  // wrangler.toml MEETING_BUCKET

/**
 * ⚠️ НИЙТИЙН ХАЯГ НЬ WORKER-ИЙН `/media/:key`, r2.dev БИШ.  `pub-mgl-media.r2.dev`
 *    гэсэн хост хэзээ ч байгаагүй (r2.dev нийтийн хандалт энэ bucket-д
 *    асаагаагүй, 401 буцаана).  `/media` нь аль хэдийн нэвтрэлтгүй нийтийн
 *    зам тул ШИНЭ гадаргуу нэмэхгүй.  Хувилбартай түлхүүр (`…-1.0.1.zip`)
 *    нь immutable кэштэй зохицно; манифест нь тогтмол нэртэй тул
 *    `bootstrap.ps1` түүнийг query string-ээр кэш тойрч татна.
 */
const PUBLIC_MEDIA_BASE = 'https://mgl-progress-api.mglenc-design.workers.dev/media';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(cmd, args) {
  const line = `${cmd} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
  if (!APPLY) {
    console.log(`  $ ${line}`);
    return;
  }
  console.log(`  $ ${line}`);
  execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
}

/* ================================================================== */
/*  1. RUNTIME КОДЫГ БАГЛАХ                                            */
/* ================================================================== */

/**
 * ⚠️ ЮУГ ОРУУЛАХ, ЮУГ ОРУУЛАХГҮЙ.
 *
 *    ОРНО    : runtime/src · retrieval/src · knowledge/schema.sql ·
 *              package.json · tsconfig.json
 *    ОРОХГҮЙ : node_modules · тест · сургалтын өгөгдөл · датасет ·
 *              evaluation · data-train-files
 *
 *    Датасет нь хэдэн зуун MB бөгөөд ажилтны машинд ХЭРЭГГҮЙ (норм нь
 *    ТУСДАА `knowledge` багцаар ирдэг, §16).  Тестүүд нь ажиллуулагдахгүй
 *    тул зөвхөн жин нэмнэ.
 */
const RUNTIME_INCLUDE = [
  'package.json',
  'tsconfig.json',
  'runtime/src',
  'retrieval/src',
  // Session B — server.ts нь deployment/src/agent.ts-ийг импортолдог: ОРХИВОЛ багцалсан runtime АСАХГҮЙ.
  'deployment/src',
  'deployment/bin',
  'knowledge/schema.sql',
];

function collect(base, rel, out) {
  const abs = join(base, rel);
  if (!existsSync(abs)) return;
  const st = statSync(abs);
  if (st.isFile()) {
    out.push(rel.replace(/\\/g, '/'));
    return;
  }
  for (const name of readdirSync(abs)) {
    // ⚠️ Тестийн файл ХЭЗЭЭ Ч багцад орохгүй — ажилтны машинд ажиллахгүй.
    if (name.endsWith('.test.ts')) continue;
    collect(base, join(rel, name), out);
  }
}

function packRuntime() {
  mkdirSync(DIST, { recursive: true });
  const files = [];
  for (const r of RUNTIME_INCLUDE) collect(AI_DIR, r, files);
  if (files.length === 0) throw new Error('runtime багцад оруулах файл олдсонгүй.');

  const version = String(flag('runtime-version', readPkgVersion()));
  const zip = join(DIST, `mgl-ai-runtime-${version}.zip`);

  /**
   * ⚠️ POWERSHELL-ИЙН `Compress-Archive` — гуравдагч хамаарал БИШ.
   *    `zip` нь Windows дээр байхгүй; Node-д zip бичигч суулгах нь
   *    `ai/`-д шинэ хамаарал нэмнэ.  Compress-Archive нь Windows бүрд
   *    байдаг ба `Expand-Archive` нь суулгагчийн талд түүнийг задална —
   *    хос нь БҮРЭН.
   */
  /**
   * ⚠️ ЭХЛЭЭД ЦЭВЭР ХАВТАС РУУ ХУУЛНА, ДАРАА НЬ ШАХНА.
   *
   *    Эхний хувилбар нь `Compress-Archive`-д ХАВТСУУДЫГ шууд өгдөг
   *    байсан — тэгснээр замын бүтэц хадгалагдана, ГЭВЧ шүүлт
   *    АЖИЛЛААГҮЙ: `runtime/test`, `retrieval/test`-ийн 10 тестийн файл
   *    багцад ОРСОН (задалж шалгахад баригдсан).  Тайлбар нь «тест
   *    орохгүй» гэж бичсэн атлаа код нь эсрэгээр ажиллаж байсан — тэр нь
   *    зүгээр баримтын алдаанаас ДОР, учир нь дараагийн хүн итгэнэ.
   *
   *    Одоо: `collect()`-ийн шүүсэн жагсаалтыг ЯГ хуулж, тэр хавтсыг
   *    шахна.  Замын бүтэц хадгалагдана, тест ОРОХГҮЙ.
   */
  const stage = join(DIST, 'runtime-stage');
  rmSync(stage, { recursive: true, force: true });
  for (const rel of files) {
    const src = join(AI_DIR, rel);
    const dst = join(stage, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }

  /**
   * ⚠️ `@mgl/mglai-common` — БАГЦАД ЗААВАЛ ОРНО (2026-09-16).
   *
   *    `runtime/src/{server,turn}.ts` ба `deployment/src/*` нь
   *    `@mgl/mglai-common/...` гэж импортолдог; репод тэр нь
   *    `ai/node_modules/@mgl/mglai-common → packages/mglai-common` symlink
   *    (`file:` хамаарал).  Багцад node_modules байхгүй тул ажилтны PC дээр
   *    runtime «Cannot find package '@mgl/mglai-common'» гэж ЭХЛЭХГҮЙ байв —
   *    1.0.0 багц яг ингэж эвдэрхий байсан (шалгаж баталсан).
   *
   * ⚠️ `.ts`-ИЙГ ШУУД ХУУЛЖ БОЛОХГҮЙ — JS БОЛГОЖ ЭМИТЛЭНЭ.  Node нь
   *    `node_modules/` ДОТОРХ файлд type stripping хийхээс ТАТГАЛЗДАГ
   *    (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, хэмжсэн 2026-09-16);
   *    репод symlink-ийн realpath нь `packages/…` тул л ажилладаг.  Тиймээс
   *    багцад `tsc`-ээр (шалгалтгүй, зөвхөн эмит; `.ts` → `.js` импортын
   *    өргөтгөл дахин бичигдэнэ) цэвэр JS тавьж, `exports`-ыг `.js` болгоно.
   */
  const commonSrc = join(REPO, 'packages', 'mglai-common');
  const commonDst = join(stage, 'node_modules', '@mgl', 'mglai-common');
  const commonPkgPath = join(commonSrc, 'package.json');
  if (!existsSync(commonPkgPath) || !existsSync(join(commonSrc, 'src', 'index.ts'))) {
    throw new Error('packages/mglai-common олдсонгүй — багц ажиллахгүй.');
  }
  const tsc = join(AI_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) throw new Error('ai/node_modules/typescript алга — `cd ai && npm install`.');
  const tsFiles = [];
  collect(commonSrc, 'src', tsFiles);
  execFileSync(
    process.execPath,
    [
      tsc,
      '--noEmit', 'false', '--noCheck', '--declaration', 'false',
      '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'nodenext',
      '--lib', 'ES2023,DOM',
      '--allowImportingTsExtensions', '--rewriteRelativeImportExtensions', '--verbatimModuleSyntax',
      '--skipLibCheck', '--rootDir', join(commonSrc, 'src'), '--outDir', join(commonDst, 'src'),
      ...tsFiles.map((f) => join(commonSrc, f)),
    ],
    { stdio: 'inherit' },
  );
  const commonPkg = JSON.parse(readFileSync(commonPkgPath, 'utf8'));
  for (const k of Object.keys(commonPkg.exports ?? {})) {
    commonPkg.exports[k] = String(commonPkg.exports[k]).replace(/\.ts$/, '.js');
  }
  delete commonPkg.scripts;
  writeFileSync(join(commonDst, 'package.json'), JSON.stringify(commonPkg, null, 2) + String.fromCharCode(10), 'utf8');
  const emitted = [];
  collect(commonDst, 'src', emitted);
  if (!emitted.some((f) => f.endsWith('.js'))) throw new Error('mglai-common эмит хоосон.');
  for (const rel of ['package.json', ...emitted]) files.push(`node_modules/@mgl/mglai-common/${rel}`);

  /**
   * ⚠️ Session B (P0-6): багц доторх package.json-ийн `version` = манифестын
   *    runtime-code хувилбар.  Runtime нь /info-д ЭНЭ файлаас «ажиллаж буй
   *    хувилбар»-аа хэлдэг; `--runtime-version`-оор өөр дугаар өгөөд файлыг
   *    хөндөхгүй бол шинэчлэлт бүр VERSION_MISMATCH-аар буцна.
   */
  const pkgPath = join(stage, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + String.fromCharCode(10), 'utf8');

  const ps = [
    '-NoProfile',
    '-Command',
    `$ErrorActionPreference='Stop';` +
      `if (Test-Path '${zip}') { Remove-Item '${zip}' -Force };` +
      `Compress-Archive -Path (Join-Path '${stage}' '*') -DestinationPath '${zip}' -CompressionLevel Optimal`,
  ];
  execFileSync('powershell', ps, { stdio: 'inherit' });
  rmSync(stage, { recursive: true, force: true });

  const bytes = statSync(zip).size;
  const digest = sha256(zip);
  console.log(`\n  runtime-code ${version}`);
  console.log(`    ${zip}`);
  console.log(`    ${bytes} байт · sha256 ${digest}\n`);
  return { component: 'runtime-code', version, path: zip, bytes, sha256: digest, public: true };
}

function readPkgVersion() {
  try {
    return JSON.parse(readFileSync(join(AI_DIR, 'package.json'), 'utf8')).version ?? '1.0.0';
  } catch {
    return '1.0.0';
  }
}

/* ================================================================== */
/*  2. НИЙТЛЭХ                                                         */
/* ================================================================== */

function publicKey(component, version, ext) {
  // ⚠️ ХАВТСАНГҮЙ — `/media/:key` нь нэг сегмент Л таарна.
  return `mgl-ai-${component}-${version}.${ext}`;
}

/**
 * ⚠️ WRANGLER 300 MiB-ЭЭС ТОМ ОБЪЕКТ БАЙРШУУЛДАГГҮЙ (`MAX_UPLOAD_SIZE_BYTES`,
 *    хэмжсэн 2026-09-16), харин llama.cpp-ийн CUDA build нь cuBLAS-тайгаа
 *    ~650 MB.  Тиймээс `components.local.json`-д `paths: [...]` өгвөл хэсэг
 *    бүр `mgl-ai-<comp>-<ver>.part<N>.zip` болж, манифестад `parts` орно;
 *    `bootstrap.ps1` бүх хэсгийг нэг хавтас руу задалж, `*.split.NNN`
 *    файлыг нийлүүлнэ (`scripts/split-file.mjs`).  Хэсэг бүр ӨӨРИЙН SHA-тай.
 */
function uploadPublic(item, partIndex = 0) {
  const ext = item.path.endsWith('.zip') ? 'zip' : 'bin';
  const key = partIndex > 0 ? publicKey(item.component, `${item.version}.part${partIndex}`, ext) : publicKey(item.component, item.version, ext);
  run('npx', [
    '-y',
    'wrangler@latest',
    'r2',
    'object',
    'put',
    `${PUBLIC_BUCKET}/${key}`,
    '--file',
    item.path,
    '--config',
    WRANGLER_CFG,
    '--remote',
  ]);
  return key;
}

function uploadPrivate(item) {
  // ⚠️ Суулгагчийн .exe нь ХУВИЙН bucket-д — нийтийн `/media/:key` нь
  //    нэвтрэлтгүй бөгөөд компанийн суулгагч тэнд байх ёсгүй.
  const key = `mgl-ai/installer/MGL-AI-Setup-${item.version}.exe`;
  run('npx', [
    '-y',
    'wrangler@latest',
    'r2',
    'object',
    'put',
    `${PRIVATE_BUCKET}/${key}`,
    '--file',
    item.path,
    '--config',
    WRANGLER_CFG,
    '--remote',
  ]);
  return key;
}

function sqlInsert(component, version, url, sha, bytes, note) {
  return (
    `INSERT INTO ai_runtime_installers (component, version, platform, url, sha256, bytes, channel, is_active, release_note) ` +
    `VALUES ('${component}', '${version}', 'win-x64', '${url}', '${sha}', ${bytes}, 'stable', 1, '${note.replace(/'/g, "''")}') ` +
    `ON CONFLICT (component, platform, version) DO UPDATE SET url=excluded.url, sha256=excluded.sha256, ` +
    `bytes=excluded.bytes, is_active=1;`
  );
}

/* ================================================================== */

async function main() {
  const items = [];

  if (argv.includes('--pack-runtime')) items.push(packRuntime());

  const installerPath = flag('installer');
  if (typeof installerPath === 'string') {
    const p = resolve(installerPath);
    items.push({
      component: 'installer',
      version: String(flag('version', '1.0.0')),
      path: p,
      bytes: statSync(p).size,
      sha256: sha256(p),
      public: false,
    });
  }

  /**
   * ⚠️ NODE ба LLAMA.CPP-ИЙГ ЭНЭ СКРИПТ ТАТАХГҮЙ.  Тэдгээр нь гуравдагч
   *    талын хоёртын файл; тэднийг ХҮН нэг удаа шалгаж, гараар тавих нь
   *    зөв (`ai/registry/LICENSES.md`-ийн ижил шалтгаан).  Энэ скрипт
   *    зөвхөн ТАВИГДСАН файлыг байрлуулж, checksum-ыг бүртгэнэ.
   */
  const extra = flag('components');
  if (typeof extra === 'string') {
    const list = JSON.parse(readFileSync(resolve(extra), 'utf8'));
    for (const c of list) {
      const paths = Array.isArray(c.paths) ? c.paths.map((x) => resolve(x)) : [resolve(c.path)];
      const parts = paths.map((p) => ({ path: p, bytes: statSync(p).size, sha256: sha256(p) }));
      items.push({
        component: c.component,
        version: c.version,
        path: parts[0].path,
        bytes: parts.reduce((n, x) => n + x.bytes, 0),
        sha256: parts[0].sha256,
        parts: parts.length > 1 ? parts : null,
        public: true,
      });
    }
  }

  if (items.length === 0) {
    console.log(
      '\n  Юу ч нийтлэх зүйл заагаагүй.\n' +
        '    --pack-runtime                       runtime кодыг баглана\n' +
        '    --installer <зам> --version 1.0.0    суулгагчийг бүртгэнэ\n' +
        '    --components <json>                  node / llama.cpp архивууд\n' +
        '    --apply                              ҮНЭХЭЭР гүйцэтгэнэ\n' +
        '    --register                           (--apply-тай) D1 мөрүүдийг ч бичнэ\n',
    );
    return;
  }

  console.log(APPLY ? '\n  === НИЙТЛЭЖ БАЙНА ===\n' : '\n  === ХУУРАМЧ ГҮЙЛТ (--apply нэмбэл гүйцэтгэнэ) ===\n');

  const manifest = { generated_at: new Date().toISOString(), components: {} };
  const sql = [];
  const mediaBase = String(flag('media-base', PUBLIC_MEDIA_BASE));

  for (const item of items) {
    if (item.public && item.parts) {
      const parts = item.parts.map((part, i) => {
        const key = uploadPublic({ ...item, path: part.path }, i + 1);
        return { url: `${mediaBase.replace(/\/+$/, '')}/${key}`, sha256: part.sha256, bytes: part.bytes };
      });
      manifest.components[item.component] = { version: item.version, parts, bytes: item.bytes };
      // D1 мөр нь мэдээллийн зориулалттай (fleet нь зөвхөн `runtime-code`-ыг уншдаг):
      // 1-р хэсгийн url/sha, бүх хэсгийн sha нь release_note-д.
      sql.push(
        sqlInsert(
          item.component,
          item.version,
          parts[0].url,
          parts[0].sha256,
          item.bytes,
          `public component, ${parts.length} parts: ${parts.map((p) => p.sha256.slice(0, 12)).join(' ')}`,
        ),
      );
    } else if (item.public) {
      const key = uploadPublic(item);
      const url = `${mediaBase.replace(/\/+$/, '')}/${key}`;
      manifest.components[item.component] = {
        version: item.version,
        url,
        sha256: item.sha256,
        bytes: item.bytes,
      };
      sql.push(sqlInsert(item.component, item.version, url, item.sha256, item.bytes, 'public component'));
    } else {
      const key = uploadPrivate(item);
      sql.push(sqlInsert(item.component, item.version, key, item.sha256, item.bytes, 'private installer'));
    }
  }

  /**
   * ⚠️ МАНИФЕСТЫГ НЭГТГЭЖ БИЧНЭ, ДАРЖ БИШ.  Энэ гүйлт зөвхөн
   *    `runtime-code`-ыг шинэчилж байхад `node`, `llama-*` мөрүүд
   *    АЛГА БОЛВОЛ суулгагч дараагийн машин дээр «manifest is missing
   *    component 'node'» гэж унана.
   */
  const manifestPath = join(DIST, 'mgl-ai-components.json');
  let merged = { components: {} };
  if (existsSync(manifestPath)) {
    try {
      merged = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      merged = { components: {} };
    }
  }
  merged.generated_at = manifest.generated_at;
  merged.components = { ...(merged.components ?? {}), ...manifest.components };
  mkdirSync(DIST, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(merged, null, 2), 'utf8');

  if (Object.keys(manifest.components).length > 0) {
    console.log('\n  Манифестыг байршуулах:');
    run('npx', [
      '-y',
      'wrangler@latest',
      'r2',
      'object',
      'put',
      `${PUBLIC_BUCKET}/mgl-ai-components.json`,
      '--file',
      manifestPath,
      '--content-type',
      'application/json',
      '--config',
      WRANGLER_CFG,
      '--remote',
    ]);
  }

  /**
   * `--register` (зөвхөн `--apply`-тай хамт): D1 мөрүүдийг энд шууд бичнэ —
   * эс тэгвэл гараар хуулж ажиллуулах тушаалуудыг хэвлэнэ.  Мөр бүр
   * `ON CONFLICT … DO UPDATE` тул дахин ажиллуулахад аюулгүй.
   */
  const REGISTER = argv.includes('--register');
  if (REGISTER && APPLY && sql.length > 0) {
    // ⚠️ `--file`, `--command` БИШ: `run()` нь Windows дээр shell-ээр дамжуулдаг
    //    тул хоосон зайтай SQL хэсэглэгдэнэ.  Файл нь quoting-гүй, нэг дуудлага.
    const sqlPath = join(DIST, 'register-installers.sql');
    writeFileSync(sqlPath, sql.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
    console.log('\n  D1 бүртгэл:\n');
    run('npx', ['wrangler', 'd1', 'execute', 'mgl-progress-db-v3', '--remote', '--config', WRANGLER_CFG, '--file', sqlPath]);
  } else {
    console.log('\n  D1 бүртгэл (backend/ хавтаснаас ажиллуулна):\n');
    for (const line of sql) {
      console.log(
        `  npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "${line.replace(/"/g, '\\"')}"`,
      );
    }
  }
  console.log(`\n  Манифест: ${manifestPath}\n`);
  console.log(`  Локал шалгалт:\n    powershell -ExecutionPolicy Bypass -File ${join(REPO, 'installer', 'bootstrap.ps1')} -ManifestUrl "file:///${manifestPath.replace(/\\/g, '/')}"\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
