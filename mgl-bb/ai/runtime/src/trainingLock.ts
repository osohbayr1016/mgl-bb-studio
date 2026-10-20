/**
 * СУРГАЛТЫН ТҮГЖЭЭ — нэг GPU дээр инференс ба QLoRA зэрэг ажиллахаас хамгаална (§2).
 *
 * ⚠️ ЯАГААД.  Хөгжүүлэгчийн машин нь СУРГАЛТЫН ба ӨӨРИЙН ИНФЕРЕНСИЙН хост хоёулаа.
 *    QLoRA-гийн хэмжсэн оргил 7.6 GB, llama-server 5.7 GB — 8 GB-д ХОЁУЛАА багтахгүй.
 *    Windows нь OOM өгөхийн оронд «shared GPU memory» руу халина: сургалт 10 дахин
 *    удааширч, чат нь хэрэглэгчийн нүдэн дээр зогсонги болно.  ХОЁУЛАА эвдэрнэ.
 *
 *    Сургалт (`ai/training/train_lora.py`) эхлэхдээ `<dataDir>/training.lock`-д
 *    `{pid, run, since}` бичиж, дуусахдаа устгана.  Runtime нь llama-server АЧААЛАХААС
 *    ӨМНӨ энэ файлыг шалгаж, pid амьд бол ТОДОРХОЙ алдаагаар татгалзана — хөтөч
 *    «локал загвар түр зогссон, сургалт явагдаж байна» гэж харуулна, VRAM-д халдахгүй.
 *
 * ⚠️ Хоцорсон түгжээ (сургалт crash болж файл үлдсэн) нь ХААХГҮЙ — pid амьд эсэхийг
 *    `process.kill(pid, 0)`-оор шалгана; үхсэн pid = түгжээ хүчингүй.
 */
import { existsSync, readFileSync } from 'node:fs';

export interface TrainingLock {
  pid: number;
  run: string;
  since: string;
}

export function readTrainingLock(path: string): TrainingLock | null {
  if (!existsSync(path)) return null;
  let parsed: Partial<TrainingLock>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<TrainingLock>;
  } catch {
    return null;
  }
  const pid = Number(parsed.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
  } catch {
    return null; // процесс үхсэн — хоцорсон түгжээ
  }
  return { pid, run: String(parsed.run ?? '?'), since: String(parsed.since ?? '?') };
}

export const TRAINING_LOCK_MESSAGE = (l: TrainingLock): string =>
  `TRAINING_IN_PROGRESS: локал загварыг ачаалахгүй — GPU дээр QLoRA сургалт «${l.run}» явагдаж байна (pid ${l.pid}, ${l.since}-аас). ` +
  'Сургалт дуусахад автоматаар сэргэнэ; яаралтай бол `npm run ai:train:stop -- -RunName <нэр>`.';
