#!/usr/bin/env node
/**
 * `npm run ai:benchmark` — ХЭМЖИНЭ, ЗОХИОХГҮЙ (§40).
 *
 * ⚠️ ЭНЭ СКРИПТИЙН ГАРАЛТААС ГАДУУР ГҮЙЦЭТГЭЛИЙН ТОО БАРИМТАД БИЧИХИЙГ
 *    ХОРИГЛОНО.  «Эхний токен 1 секундээс бага» гэдэг нь ХЭМЖИГДТЭЛ
 *    ЗӨВХӨН ЗОРИЛТ.  Үр дүн нь төхөөрөмжийн хурууны хээтэйгээ хамт
 *    `ai/evaluation/benchmarks/` -д хадгалагдана — өөр машин дээрх тоог
 *    энэ машинд хамааруулах нь худал болно.
 */
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState, runBenchmark } from '../runtime/src/server.ts';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'evaluation', 'benchmarks');
mkdirSync(OUT_DIR, { recursive: true });

const maxTokens = Number(process.argv[2] ?? 128);
const state = await buildState();

process.stdout.write('\nMGL AI · гүйцэтгэлийн хэмжилт\n');
process.stdout.write(`  хөдөлгүүр: ${state.engine.info().engine} — ${state.engineReason}\n\n`);

const result = await runBenchmark(state, maxTokens);
await state.engine.unload();

const pad = (k) => `  ${k}`.padEnd(22);
process.stdout.write(`${pad('хөдөлгүүр')}${result.engine}\n`);
process.stdout.write(`${pad('хувилбар')}${result.runtime_variant} · ${result.model_version ?? '—'}\n`);
process.stdout.write(`${pad('quantization')}${result.quantization ?? '—'}\n`);
process.stdout.write(`${pad('контекст')}${result.context_tokens}\n`);
process.stdout.write(`${pad('GPU')}${result.hardware.gpu ?? 'илрээгүй'}\n`);
process.stdout.write(`${pad('ачаалалт')}${result.load_ms} мс\n`);
process.stdout.write(`${pad('эхний токен')}${result.first_token_ms ?? '—'} мс\n`);
process.stdout.write(`${pad('нийт')}${result.total_ms} мс\n`);
process.stdout.write(`${pad('токен')}${result.tokens}\n`);
process.stdout.write(`${pad('токен/сек')}${result.tokens_per_sec ?? '—'}\n`);

// ⚠️ Файлын нэрэнд ХӨДӨЛГҮҮР орно — echo-гийн «0 мс» нь llama.cpp-ийн
//    хэмжилттэй ХОЛИЛДОХ ЁСГҮЙ.
const stamp = result.measured_at.replace(/[:.]/g, '-');
const file = join(OUT_DIR, `${result.engine}-${result.runtime_variant}-${stamp}.json`);
writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');

process.stdout.write(`\n  → ${file}\n`);
if (result.engine === 'echo') {
  process.stdout.write(
    '\n  ⚠️ ЭНЭ НЬ ECHO ХӨДӨЛГҮҮРИЙН ТОО — жинхэнэ загварын гүйцэтгэл БИШ.\n' +
      '     Баримтад бичихээс өмнө загвар суулгаад ДАХИН хэмж.\n',
  );
}
const count = readdirSync(OUT_DIR).filter((f) => f.endsWith('.json')).length;
process.stdout.write(`  (нийт ${count} хэмжилт хадгалагдсан)\n\n`);
