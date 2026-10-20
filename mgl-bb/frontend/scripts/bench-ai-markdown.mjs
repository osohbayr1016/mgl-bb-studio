/**
 * MGL AI · УРСГАЛЫН MARKDOWN-Ы ГҮЙЦЭТГЭЛИЙН ХЭМЖИЛТ (§24, §42).
 *
 *   node scripts/bench-ai-markdown.mjs        (frontend/ хавтаснаас)
 *
 * ⚠️ ЯАГААД ЭНЭ ХЭМЖИЛТ ХЭРЭГТЭЙ ВЭ.  §24 нь «avoid repeatedly
 *    rebuilding the entire Markdown component tree for every character»
 *    гэж шаарддаг ба §42 нь ӨМНӨ/ДАРАА-г ХЭМЖИХИЙГ шаарддаг.  Энэ
 *    скрипт нь хоёуланг нэг дор хийнэ:
 *
 *      ХУУЧИН зан төлөв : токен бүрд БҮХ хариултыг дахин задлах
 *      ШИНЭ зан төлөв   : тогтсон угтварыг кэшлэж, ЗӨВХӨН сүүлийн
 *                         блокыг дахин задлах
 *
 * ⚠️ ЭНЭ НЬ ХӨТЧИЙН РЕНДЕРИЙГ ХЭМЖИХГҮЙ.  Тэр нь ТУСДАА ялалт
 *    (`memo` + блокын тогтмол лавлагаа).  Энд зөвхөн ЗАДЛАН
 *    ШИНЖИЛГЭЭНИЙ зардлыг хэмжинэ — тэр нь UI урсгалын гол утас дээр
 *    ажилладаг тул шууд гацалт болдог.
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'features', 'mgl-ai', 'lib');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : LIB;
      const asFile = join(base, `${specifier}.ts`);
      if (existsSync(asFile)) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(`${specifier}/index.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const MD = await import(pathToFileURL(join(LIB, 'markdown.ts')).href);
const { parseBlocks, parseStreaming, emptyStreamCache } = MD;

/**
 * ⚠️ БОДИТ ХЭЛБЭРТЭЙ ХАРИУЛТ.  Хиймэл «lorem ipsum» нь буруу зураг
 *    өгнө: кирилл нь илүү урт, хүснэгт/жагсаалт нь илүү үнэтэй.
 */
function buildAnswer(sections) {
  const out = ['# Барилгын гүйцэтгэлийн тайлангийн бүтэц', ''];
  for (let i = 1; i <= sections; i++) {
    out.push(`## ${i}. Хэсэг — норматив шаардлага`, '');
    out.push(
      `Энэ хэсэгт **БНбД 21-01-0${(i % 9) + 1}**-ын дагуу тавигдах шаардлагыг ` +
        `тайлбарлав [${(i % 5) + 1}]. Гүйцэтгэлийн хувь нь \`progress_entries\` ` +
        'хүснэгтээс тооцогдоно.',
      '',
    );
    out.push('- Эхний шаардлага, дэлгэрэнгүй тайлбартай', '- Хоёр дахь шаардлага', '');
    if (i % 3 === 0) {
      out.push('| Заалт | Утга | Тайлбар |', '| --- | ---: | --- |');
      out.push(`| ${i}.1 | ${i * 10} м² | заавал |`, `| ${i}.2 | ${i * 5} м | зөвлөмж |`, '');
    }
  }
  return out.join('\n');
}

/** Токеныг ойролцоолно — кирилл нь ~2.2 тэмдэгт/токен. */
const CHARS_PER_TOKEN = 3;

function measure(label, answer, fn) {
  const steps = Math.ceil(answer.length / CHARS_PER_TOKEN);
  const t0 = performance.now();
  fn(answer, steps);
  const ms = performance.now() - t0;
  return { label, ms, steps, perStepMs: ms / steps };
}

function naive(answer, steps) {
  // ХУУЧИН: токен бүрд БҮХ баримтыг дахин задална.
  for (let i = 1; i <= steps; i++) {
    parseBlocks(answer.slice(0, i * CHARS_PER_TOKEN));
  }
}

function cached(answer, steps) {
  // ШИНЭ: тогтсон угтварыг кэшлэнэ.
  let cache = emptyStreamCache();
  for (let i = 1; i <= steps; i++) {
    const r = parseStreaming(answer.slice(0, i * CHARS_PER_TOKEN), cache);
    cache = r.cache;
  }
}

console.log('\nMGL AI · урсгалын markdown-ы зардал\n');
console.log('  хэмжээ        токен     ХУУЧИН(бүтнээр)      ШИНЭ(кэштэй)      хурдсалт');
console.log('  ' + '-'.repeat(74));

const rows = [];
for (const sections of [4, 10, 20, 40]) {
  const answer = buildAnswer(sections);
  // Дулаацуулах гүйлт — JIT-ийн нөлөөг арилгана.
  naive(answer.slice(0, 400), 20);
  cached(answer.slice(0, 400), 20);

  const a = measure('naive', answer, naive);
  const b = measure('cached', answer, cached);
  rows.push({ sections, chars: answer.length, ...{ naive: a, cached: b } });
  const speedup = a.ms / b.ms;
  console.log(
    `  ${String(answer.length).padStart(6)} тэмдэгт ` +
      `${String(a.steps).padStart(6)}   ` +
      `${a.ms.toFixed(0).padStart(8)} мс (${a.perStepMs.toFixed(3)}/токен)   ` +
      `${b.ms.toFixed(0).padStart(6)} мс (${b.perStepMs.toFixed(3)}/токен)   ` +
      `×${speedup.toFixed(1)}`,
  );
}

/**
 * ⚠️ ХАМГИЙН ЧУХАЛ МӨР: ЗАРДАЛ НЬ ХАРИУЛТЫН УРТААС ХАМААРАХГҮЙ БАЙХ.
 *
 *    Хуучин зан төлөвт нэг токены зардал нь хариулт уртсах тусам
 *    ӨСДӨГ (O(n) задлан шинжилгээ × n токен = O(n²)).  Тэр нь яг
 *    «хариулт урт болох тусам хөтөч улам гацдаг» гэсэн гомдол.
 *    Кэштэй хувилбарт нэг токены зардал ТОГТМОЛ байх ёстой.
 */
const first = rows[0];
const last = rows[rows.length - 1];
const naiveGrowth = last.naive.perStepMs / first.naive.perStepMs;
const cachedGrowth = last.cached.perStepMs / first.cached.perStepMs;

console.log('');
console.log(
  `  Нэг токены зардлын ӨСӨЛТ (${first.chars} → ${last.chars} тэмдэгт):`,
);
console.log(`    ХУУЧИН  ×${naiveGrowth.toFixed(1)}   ← хариулт уртсах тусам УДААШИРНА`);
console.log(`    ШИНЭ    ×${cachedGrowth.toFixed(1)}   ← тогтмолд ойр байх ёстой`);
console.log('');

if (cachedGrowth > naiveGrowth) {
  console.error('  ✗ РЕГРЕСС: кэштэй хувилбар нь илүү муу масштаблагдаж байна.');
  process.exit(1);
}
console.log('  ✓ Кэштэй хувилбар нь илүү сайн масштаблагдаж байна.\n');
