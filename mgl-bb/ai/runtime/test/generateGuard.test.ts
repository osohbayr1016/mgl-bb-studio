/**
 * MGL AI runtime · `/generate`-ИЙН ХАМГААЛАЛТУУД — ИНТЕГРАЦЫН ТЕСТ.
 *
 * Run with:  node --test runtime/test/generateGuard.test.ts
 *
 * ⚠️ ЯАГААД STUB ХӨДӨЛГҮҮР ВЭ.  Жинхэнэ загвар давталтад орох нь
 *    МАГАДЛАЛТАЙ (хэмжсэн: буруу тохиргоотой үед 13%).  Тестийг тэр
 *    магадлал дээр барих нь тогтворгүй — CI санамсаргүй улаан болно.
 *    Тиймээс давталтыг ЗОРИУД үүсгэдэг хөдөлгүүрээр хамгаалалтын
 *    ЛОГИКИЙГ шалгана; загварын зан төлөвийг тусад нь, амьд хэмжилтээр
 *    баталгаажуулсан (тайланг үз).
 *
 * ⚠️ ЭНЭ ФАЙЛ `server.ts`-ИЙН ГЭРЭЭГ ШАЛГАНА, ХУУЛБАРЫГ БИШ.  Доорх
 *    туслах нь `/generate`-ийн урсгалын бүтцийг давтдаг тул эх кодоос
 *    хамгаалалт УСТВАЛ энэ тест унахгүй — тиймээс эх кодыг ЧУУЛГАН
 *    шалгах тестүүдийг мөн нэмэв.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import { StreamingRepetitionGuard } from '../src/repetition.ts';
import type {
  GenerateChunk,
  GenerateRequest,
  EngineInfo,
  EngineHealth,
  InferenceEngine,
} from '../src/engine/InferenceEngine.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/* ================================================================== */
/*  ДАВТАЛТАД ОРДОГ ХӨДӨЛГҮҮР                                          */
/* ================================================================== */

/** «Төгсгөлгүй давталт»-ыг ЗОРИУД үүсгэнэ — жинхэнэ гажгийн загвар. */
class LoopingEngine implements InferenceEngine {
  aborted = false;
  ranToCompletion = false;
  emitted = 0;
  readonly phrase: string;
  readonly lead: string;

  constructor(phrase = 'үндэслэл, төлөвлөгөөний ', lead = 'Барилгын захиалагч нь дараах үүрэгтэй. ') {
    this.phrase = phrase;
    this.lead = lead;
  }

  info(): EngineInfo {
    return {
      engine: 'looping-test',
      runtimeVariant: 'test',
      modelVersion: 'test',
      quantization: 'Q4_K_M',
      contextTokens: 8192,
      loaded: true,
    } as EngineInfo;
  }
  async health(): Promise<EngineHealth> {
    return { ok: true, loaded: true, detail: 'test', uptimeMs: 1 } as EngineHealth;
  }
  async load(): Promise<void> {}
  async unload(): Promise<void> {}

  async *generate(req: GenerateRequest): AsyncGenerator<GenerateChunk> {
    /**
     * ⚠️ ЗОГСОЛТЫГ ХОЁР ЗАМААР ХЭМЖИНЭ, ЯГ ЖИНХЭНЭ ХӨДӨЛГҮҮРИЙН АДИЛ.
     *
     *    `LlamaCppEngine`-д `break` хийхэд генератор ХААГДАЖ, түүний
     *    `finally` нь `reader.cancel()` дуудан llama-server-ийн урсгалыг
     *    таслана; мөн `controller.abort()` нь fetch-ийг цуцална.  Өөрөөр
     *    хэлбэл зогсолт нь `signal` ШАЛГАХААС бус ГЕНЕРАТОР ХААГДАХААС
     *    болж болно.  Тестийн stub тэр хоёуланг нь загварчлах ёстой,
     *    эс тэгвэл «зогссон эсэх»-ийг буруу хэмжинэ.
     */
    try {
      yield { type: 'token', text: this.lead };
      // ⚠️ 5000 хүртэл — хамгаалалт ажиллахгүй бол тест мөнхөд гүйхгүй.
      for (let i = 0; i < 5000; i++) {
        if (req.signal?.aborted) return;
        this.emitted += 1;
        yield { type: 'token', text: this.phrase };
      }
      this.ranToCompletion = true;
      yield {
        type: 'done',
        stopReason: 'length',
        usage: { promptTokens: 10, completionTokens: 5000 },
      };
    } finally {
      // Генератор эрт хаагдсан эсвэл signal цуцлагдсан — хоёулаа «зогссон».
      this.aborted = !this.ranToCompletion;
    }
  }
}

/** Хэвийн, давтагдахгүй хариулт үүсгэнэ. */
class NormalEngine implements InferenceEngine {
  info(): EngineInfo {
    return {
      engine: 'normal-test',
      runtimeVariant: 'test',
      modelVersion: 'test',
      quantization: 'Q4_K_M',
      contextTokens: 8192,
      loaded: true,
    } as EngineInfo;
  }
  async health(): Promise<EngineHealth> {
    return { ok: true, loaded: true, detail: 'test', uptimeMs: 1 } as EngineHealth;
  }
  async load(): Promise<void> {}
  async unload(): Promise<void> {}
  async *generate(): AsyncGenerator<GenerateChunk> {
    for (const t of [
      'Барилгын захиалагч нь зураг төслийг батлуулах, ',
      'улсын экспертиз хийлгэх, ',
      'барилга угсралтын ажлын чанарт хяналт тавих, ',
      'ашиглалтад хүлээн авах үүрэгтэй.',
    ]) {
      yield { type: 'token', text: t };
    }
    yield { type: 'done', stopReason: 'stop', usage: { promptTokens: 10, completionTokens: 40 } };
  }
}

/* ================================================================== */
/*  `/generate`-ИЙН УРСГАЛЫН БҮТЭЦ                                     */
/* ================================================================== */

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

function startGenerate(engine: InferenceEngine): Promise<Server> {
  const server = createServer(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    const started = Date.now();
    let firstTokenMs: number | null = null;
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const controller = new AbortController();
    const repGuard = new StreamingRepetitionGuard();
    let repetitionTripped = false;

    send('start', { engine: engine.info(), at: started });
    try {
      for await (const chunk of engine.generate({ turns: [], maxTokens: 900, signal: controller.signal })) {
        if (chunk.type === 'token') {
          firstTokenMs ??= Date.now() - started;
          send('token', { text: chunk.text });
          const verdict = repGuard.push(chunk.text);
          if (verdict.repeating) {
            repetitionTripped = true;
            controller.abort();
            break;
          }
        } else if (chunk.type === 'done') {
          send('done', {
            stop_reason: repetitionTripped ? 'repetition' : chunk.stopReason,
            repetition: repetitionTripped
              ? { cycle_words: repGuard.verdict.cycleWords, repeats: repGuard.verdict.repeats }
              : null,
          });
        }
      }
    } finally {
      if (repetitionTripped) {
        send('done', {
          stop_reason: 'repetition',
          repetition: { cycle_words: repGuard.verdict.cycleWords, repeats: repGuard.verdict.repeats },
        });
      }
      res.end();
    }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function readSse(port: number): Promise<Frame[]> {
  const res = await fetch(`http://127.0.0.1:${port}/generate`, { method: 'POST' });
  const frames: Frame[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) frames.push({ event, data: JSON.parse(data) as Record<string, unknown> });
    }
  }
  return frames;
}

/* ================================================================== */

test('ТӨГСГӨЛГҮЙ ДАВТАЛТ баригдаж, ҮҮСГЭЛТ ЗОГСОНО', async () => {
  const engine = new LoopingEngine();
  const server = await startGenerate(engine);
  const { port } = server.address() as AddressInfo;
  try {
    const frames = await readSse(port);
    const done = frames.find((f) => f.event === 'done');
    assert.ok(done, '`done` ирсэнгүй — UI мөнхөд хүлээнэ');
    assert.equal(done.data.stop_reason, 'repetition');
    assert.ok(done.data.repetition, 'давталтын мэдээлэл дутуу');

    // ⚠️ ХАМГИЙН ЧУХАЛ БАТАЛГАА: үүсгэлт ҮНЭХЭЭР зогссон.  «Нуусан»
    //    шийдэл нь 5000 токеныг гүйцэд үүсгэнэ (§7).
    assert.equal(engine.aborted, true, 'үүсгэлт зогсоогүй — зөвхөн нуугдсан');
    assert.ok(engine.emitted < 400, `${engine.emitted} токен үүсгэв — хэт орой зогсов`);
  } finally {
    server.close();
  }
});

test('ХЭВИЙН хариулт хөндөгдөхгүй (худал эерэг байхгүй)', async () => {
  const server = await startGenerate(new NormalEngine());
  const { port } = server.address() as AddressInfo;
  try {
    const frames = await readSse(port);
    const done = frames.find((f) => f.event === 'done');
    assert.equal(done?.data.stop_reason, 'stop', 'хэвийн хариулт давталт гэж баригдав');
    const text = frames
      .filter((f) => f.event === 'token')
      .map((f) => String(f.data.text))
      .join('');
    assert.ok(text.includes('ашиглалтад хүлээн авах'), 'хариулт бүтэн ирсэнгүй');
  } finally {
    server.close();
  }
});

test('давталт илэрсэн ч `done` ЗААВАЛ илгээгдэнэ', async () => {
  // ⚠️ `break` хийсний дараа хөдөлгүүрийн `done` салаа ХҮРЭХГҮЙ.  Тэр
  //    үед `done` илгээхгүй орхивол хөтөч мөнхөд «ажиллаж байна» гэж
  //    үзнэ — spinner хэзээ ч зогсохгүй.
  const server = await startGenerate(new LoopingEngine());
  const { port } = server.address() as AddressInfo;
  try {
    const frames = await readSse(port);
    assert.equal(frames.filter((f) => f.event === 'done').length, 1, '`done` тоо буруу');
  } finally {
    server.close();
  }
});

test('server.ts нь ЭЦСИЙН finish() шалгалттай (48-тэмдэгтийн цоорхой)', () => {
  /**
   * ⚠️ БОДИТ ЦООРХОЙ БАЙСАН.  Урсгалын хамгаалагч 48 тэмдэгт тутамд Л
   *    шалгадаг тул сүүлийн хэсэгт босгыг давсан давталт мөлхөж гардаг
   *    байв — 24 амьд гүйлтийн 1 нь `stop_reason: 'length'` гэж
   *    мэдээлэгдэж, програм түүнийг ЗӨВ хариулт гэж хадгалах байлаа.
   */
  const src = readFileSync(join(SRC, 'server.ts'), 'utf8');
  assert.ok(src.includes('repGuard.finish()'), 'эцсийн шалгалт устсан — давталт мөлхөж гарна');
});

/* ================================================================== */
/*  ЭХ КОДЫН ГЭРЭЭ — дээрх туслах нь логикийг ДАВТДАГ тул заавал        */
/* ================================================================== */

test('server.ts нь давталтын хамгаалалтыг АГУУЛСАН хэвээр', () => {
  const src = readFileSync(join(SRC, 'server.ts'), 'utf8');
  assert.ok(src.includes('StreamingRepetitionGuard'), 'хамгаалалт устсан');
  assert.ok(src.includes('controller.abort()'), 'үүсгэлтийг зогсоохоо больжээ');
  assert.ok(src.includes("'repetition'"), 'зогсох шалтгаан мэдээлэгдэхээ больжээ');
  assert.ok(src.includes('context_overflow'), 'контекстын төсвийн шалгалт устсан');
  assert.ok(src.includes('generateTimeoutMs'), 'хатуу хугацааны хязгаар устсан');
});

test('server.ts нь temperature-ийг ХАТУУ БИЧИХГҮЙ (preset дарагдахгүй)', () => {
  // ⚠️ ЯГ ЭНЭ АЛДАА БАЙСАН: `body.temperature ?? 0.3` нь клиент утга
  //    илгээдэггүй тул хүсэлт бүрийг 0.3 болгож, хөдөлгүүрийн албан
  //    ёсны preset-ийг ЧИМЭЭГҮЙ дардаг байв.
  const src = readFileSync(join(SRC, 'server.ts'), 'utf8');
  assert.equal(/temperature:\s*(?:typeof[^\n]*?:\s*)?0\.\d/.test(src), false, 'temperature дахин хатуу бичигдэв');
});

test('LlamaCppEngine нь түүвэрлэлтийг preset-ээс авдаг хэвээр', () => {
  const src = readFileSync(join(SRC, 'engine', 'LlamaCppEngine.ts'), 'utf8');
  assert.ok(src.includes('presetFor'), 'preset хэрэглэгдэхээ больжээ');
  assert.ok(src.includes("put('top_k'"), 'top_k илгээгдэхээ больжээ');
  assert.ok(src.includes("put('min_p'"), 'min_p илгээгдэхээ больжээ');
  assert.ok(src.includes("put('presence_penalty'"), 'presence_penalty илгээгдэхээ больжээ');
  assert.equal(/temperature:\s*req\.temperature\s*\?\?\s*0\.\d/.test(src), false, 'хуучин хатуу утга буцаж ирэв');
});
