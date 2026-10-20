#!/usr/bin/env node
/**
 * shadcn/shadcnblocks-ийн блокийг ТӨСЛИЙН ФАЙЛЫГ ЭВДЭЛГҮЙГЭЭР нэмнэ.
 *
 *   npm run ui:add -- @shadcnblocks/banner1
 *   npm run ui:add -- @shadcn/accordion @shadcnblocks/hero125
 *
 * ── Яагаад хэрэгтэй вэ? ────────────────────────────────────────────────────
 * `npx shadcn add <блок>` нь блокийн `registryDependencies`-ийг ДАГУУЛЖ татдаг
 * (ихэвчлэн `utils`, `button`, `aspect-ratio`). Эдгээр нь энэ репод АЛЬ ХЭДИЙН
 * байгаа бөгөөд төслийн онцлогт тааруулж ЗАСАГДСАН. Реестрийн стандарт
 * хувилбараар дарж бичих нь чимээгүй, гэхдээ хүнд хохирол учруулна — 2026-07-30-нд
 * `--dry-run` дээр илэрсэн бодит жишээ:
 *   • `src/shared/lib/utils.ts` — `extendTailwindMerge`-ээр типографийн
 *     классуудыг (`text-title/body/…`) `font-size` бүлэгт бүртгэсэн 34 мөр нь
 *     энгийн `twMerge` болж 6 мөр болно. Үр дүнд `cn("text-body text-muted-
 *     foreground")` → `"text-muted-foreground"`, өөрөөр хэлбэл ХЭМЖЭЭНИЙ класс
 *     чимээгүй устана. `cn()` аппад 1,500+ газар дуудагддаг тул типографийн
 *     шатлал бүхэлдээ эвдэрнэ — build ч, lint ч УНАХГҮЙ.
 *   • `src/ui/button.tsx` — `motion-safe:active:scale-[0.97]` алга болно.
 *
 * ── Шийдэл ─────────────────────────────────────────────────────────────────
 * `shadcn add --path <түр хавтас>` нь БҮХ файлыг тэр хавтсанд буулгаж, байгаа
 * файлд огт хүрдэггүй (элсэн хайрцагт баталсан). Тиймээс:
 *   1) түр хавтсанд буулгана,
 *   2) реестрийн мета-өгөгдлөөс файл бүрийн ТӨРЛИЙГ уншиж очих газрыг тогтооно,
 *   3) ЗӨВХӨН байхгүй файлыг байрлуулна — байгааг нь ХЭЗЭЭ Ч дарж бичихгүй,
 *      зөвхөн «алгасав» гэж мэдээлнэ,
 *   4) түр хавтсыг устгана.
 *
 * Дарж бичих шаардлагатай бол ГАРААР, зөрүүг нь хараад хий — энэ скрипт
 * зориудаар тийм сонголт өгөхгүй.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'src', '__incoming__');

/**
 * ⚠️ Windows дээр `npx` бол `.cmd` бөгөөд Node 24 нь түүнийг `shell: false`-оор
 * ажиллуулахыг ХОРИГЛОДОГ (CVE-2024-27980-ийн дараах хамгаалалт) — тиймээс
 * shell ЗААВАЛ хэрэгтэй. Shell нь аргументыг escape хийдэггүй тул (DEP0190)
 * реестрийн нэрийг ХАТУУ ЗАГВАРААР шалгаж, командын тарилгыг хаана.
 */
const SHELL = process.platform === 'win32';
const ITEM_RE = /^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/;

const items = process.argv.slice(2).filter(Boolean);
if (items.length === 0) {
  console.error('Хэрэглээ: npm run ui:add -- @shadcnblocks/banner1 [@shadcn/accordion ...]');
  process.exit(1);
}
const bad = items.filter((i) => !ITEM_RE.test(i));
if (bad.length > 0) {
  console.error(`Реестрийн нэр буруу: ${bad.join(', ')}
@бүртгэл/нэр хэлбэртэй байх ёстой.`);
  process.exit(1);
}

/** `components.json`-ы alias-аас файлын ТӨРӨЛ бүрийн очих хавтсыг гаргана. */
function destDirs() {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'components.json'), 'utf8'));
  const a = cfg.aliases ?? {};
  // `@/shared/components` → `src/shared/components`
  const toDir = (alias, fallback) =>
    join(ROOT, 'src', String(alias ?? fallback).replace(/^@\//, ''));
  return {
    'registry:ui': toDir(a.ui, '@/ui'),
    'registry:block': toDir(a.components, '@/components'),
    'registry:component': toDir(a.components, '@/components'),
    'registry:hook': toDir(a.hooks, '@/hooks'),
    'registry:lib': toDir(a.lib, '@/lib'),
  };
}

/** Реестрээс файлын нэр → төрлийн зураглалыг татна (`shadcn view`, JSON). */
function fileTypes(item) {
  const out = execFileSync('npx', ['shadcn@latest', 'view', item], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: SHELL,
  });
  const json = JSON.parse(out.slice(out.indexOf('[')));
  const map = new Map();
  for (const entry of json) {
    for (const f of entry.files ?? []) {
      // `block/banner1/banner1.tsx` → `banner1.tsx`
      map.set(f.path.split(/[\\/]/).pop(), f.type);
    }
  }
  return map;
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

let placed = 0;
let skipped = 0;
try {
  // ⚠️ `--path` нь бүх файлыг STAGE рүү чиглүүлнэ — байгаа файл хөндөгдөхгүй тул
  // «дарж бичих үү?» гэсэн асуулт ч гарахгүй (`-y` найдвартай ажиллана).
  execFileSync('npx', ['shadcn@latest', 'add', ...items, '--path', 'src/__incoming__', '-y'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: SHELL,
  });

  const dirs = destDirs();
  const types = new Map();
  for (const item of items) {
    for (const [name, type] of fileTypes(item)) types.set(name, type);
  }

  for (const name of readdirSync(STAGE)) {
    const type = types.get(name);
    let dir = dirs[type];
    if (!dir) {
      // ⚠️ `shadcn view <блок>` нь ЗӨВХӨН тухайн блокийн файлыг буцаадаг —
      // `registryDependencies`-ээр дуудагдсан `utils`/`button` зэрэг нь энд
      // ОРДОГГҮЙ тул төрөл нь тодорхойгүй үлдэнэ. Эдгээр нь бараг үргэлж
      // репод аль хэдийн байдаг файлууд. Тиймээс нэрээр нь бүх зорилтот
      // хавтсаас хайж, олдвол «байгаа» гэж үзээд алгасна.
      const hit = Object.values(dirs).find((d) => existsSync(join(d, name)));
      if (hit) {
        rmSync(join(STAGE, name), { force: true });
        console.log(`  ⏭  ${name} — БАЙГАА, хөндөөгүй (${join(hit, name).replace(ROOT, '.')})`);
        skipped += 1;
        continue;
      }
      console.log(`  ?  ${name} — төрөл нь тодорхойгүй, ГАРААР байрлуул (STAGE-д үлдээв)`);
      continue;
    }
    const dest = join(dir, name);
    if (existsSync(dest)) {
      console.log(`  ⏭  ${name} — БАЙГАА, хөндөөгүй (${dest.replace(ROOT, '.')})`);
      skipped += 1;
      continue;
    }
    mkdirSync(dir, { recursive: true });
    renameSync(join(STAGE, name), dest);
    console.log(`  ✔  ${name} → ${dest.replace(ROOT, '.')}`);
    placed += 1;
  }
} finally {
  // Үлдсэн файл байвал хэрэглэгчид харагдана; хоосон бол ул мөргүй арилна.
  const left = existsSync(STAGE) ? readdirSync(STAGE) : [];
  if (left.length === 0) rmSync(STAGE, { recursive: true, force: true });
  else console.log(`\n  STAGE-д ${left.length} файл үлдсэн: src/__incoming__/`);
}

console.log(`\n${placed} файл нэмэгдэж, ${skipped} нь байсан тул алгасагдав.`);
if (skipped > 0) {
  console.log('Алгасагдсаныг шинэчлэх шаардлагатай бол ГАРААР, зөрүүг нь хараад хий:');
  console.log(`  npx shadcn@latest add ${items[0]} --dry-run --diff`);
}
