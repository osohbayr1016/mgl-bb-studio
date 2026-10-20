#!/usr/bin/env node
/**
 * `npm run ai:setup` — llama.cpp-ийн `llama-server` хоёртын файлыг суулгана.
 *
 * ⚠️ ЭНЭ СКРИПТ ЗАГВАР ТАТАХГҮЙ.  Загвар нь `ai:model -- pull`-аар, БИДНИЙ
 *    манифестаас, checksum шалгаж татагдана.  Хоёрыг ялгасан нь зориуд:
 *    хоёртын файл нь нээлттэй эхийн хэрэгсэл, загвар нь эрхээр
 *    хамгаалагдсан артефакт.
 *
 * ⚠️ ЯАГААД АВТОМАТААР ТАТАХГҮЙ ВЭ.  llama.cpp-ийн release нь GitHub дээр
 *    бөгөөд CUDA хувилбар нь драйверын хувилбараас хамаарна.  Буруу build
 *    татах нь «GPU ажиллахгүй» гэсэн оношлоход хэцүү алдаа өгнө.  Тиймээс
 *    энэ скрипт нь ЯГ ЮУ хэрэгтэйг хэлж, файлыг хаана тавихыг зааж өгнө —
 *    сохроор татахгүй.  Нэг удаагийн ажил, 20 машин.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, serverBinaryName } from '../runtime/src/config.ts';
import { detectHardware } from '../runtime/src/hardware.ts';

const cfg = loadConfig();
const hw = await detectHardware();

mkdirSync(cfg.binDir, { recursive: true });
mkdirSync(cfg.modelsDir, { recursive: true });

const bin = join(cfg.binDir, serverBinaryName());

process.stdout.write('\nMGL AI · хөдөлгүүрийн суулгац\n\n');

if (existsSync(bin)) {
  process.stdout.write(`  ✔ llama-server аль хэдийн байна:\n     ${bin}\n\n`);
  process.stdout.write('  Дараа нь:  npm run ai:model -- pull\n\n');
  process.exit(0);
}

const cuda = hw.cuda !== null;
const build = cuda ? 'cuda' : 'cpu';

process.stdout.write(`  Төхөөрөмж: ${hw.gpu ?? 'GPU илрээгүй'}${cuda ? ` · CUDA ${hw.cuda}` : ''}\n`);
process.stdout.write(`  Хэрэгтэй build: llama.cpp · win-${build}-x64\n\n`);

process.stdout.write('  АЛХАМУУД\n');
process.stdout.write('  1. https://github.com/ggml-org/llama.cpp/releases -ээс хамгийн\n');
process.stdout.write(`     сүүлийн ${cuda ? '`llama-*-bin-win-cuda-*-x64.zip`' : '`llama-*-bin-win-cpu-x64.zip`'} -г тат.\n`);
if (cuda) {
  process.stdout.write('     ⚠️ CUDA build-ийн хувилбар нь драйвертайгаа тохирох ёстой.\n');
  process.stdout.write('        `cudart-llama-bin-win-*.zip` -ийг МӨН задлаад хамт тавь.\n');
}
process.stdout.write('  2. Задлаад БҮХ .exe / .dll файлыг дараах хавтас руу хуул:\n');
process.stdout.write(`     ${cfg.binDir}\n`);
process.stdout.write('  3. Шалга:  npm run ai:doctor\n');
process.stdout.write('  4. Загвар тат:  npm run ai:model -- pull\n\n');

process.stdout.write('  ⚠️ Хоёртын файлыг дурын эх сурвалжаас БҮҮ тат — зөвхөн\n');
process.stdout.write('     llama.cpp-ийн албан ёсны release хуудаснаас.\n\n');

process.exit(1);
