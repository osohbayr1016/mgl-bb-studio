/**
 * MGL AI runtime · SSE ЦОХИЛТ — ТЕСТ (§10, §33).
 *
 * ⚠️ ЯАГААД ЭНЭ ТЕСТ ХЭРЭГТЭЙ ВЭ.  Цохилт нь «удаан ажиллаж байна»-г
 *    «холболт тасарсан»-аас ялгах ЦОРЫН ГАНЦ дохио.  Тэр нь ажиллахгүй
 *    бол UI нь урт prefill-ийг тасалдал гэж уншаад, яг бидний зассан
 *    алдаа — түр зуурын удаашралыг үхлийн алдаа болгох — руугаа буцна.
 *
 * ⚠️ ЖИНХЭНЭ ЗАГВАРААР ТЕСТЛЭХГҮЙ, ЗОРИУД.  Prefill-ийг 2 секундээс
 *    удаашруулахын тулд 8K контекстыг дүүргэх шаардлагатай бөгөөд тэр нь
 *    GPU-тэй, загвар суусан машин шаардана — CI дээр давтагдахгүй.
 *    Оронд нь ХЯНАГДДАГ удаан хөдөлгүүр ашиглана: цохилтын логик нь
 *    хөдөлгүүрээс ХАМААРАЛГҮЙ (`server.ts`-ийн `setInterval`), тиймээс
 *    энэ нь яг тэр кодыг шалгаж байна.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type {
  GenerateChunk,
  GenerateRequest,
  EngineInfo,
  EngineHealth,
  InferenceEngine,
} from '../src/engine/InferenceEngine.ts';

/* ================================================================== */
/*  ХЯНАГДДАГ УДААН ХӨДӨЛГҮҮР                                          */
/* ================================================================== */

/** Эхний токеноо `delayMs` хүлээж гаргадаг хөдөлгүүр. */
class SlowEngine implements InferenceEngine {
  // ⚠️ Талбарыг ИЛ зарлав: Node-ийн төрөл хуулах горим нь конструкторын
  //    «parameter property»-г дэмждэггүй (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX).
  readonly delayMs: number;
  constructor(delayMs: number) {
    this.delayMs = delayMs;
  }

  info(): EngineInfo {
    return {
      engine: 'slow-test',
      runtimeVariant: 'test',
      modelVersion: 'test',
      quantization: null,
      contextTokens: 4096,
      loaded: true,
    } as EngineInfo;
  }

  async health(): Promise<EngineHealth> {
    return { ok: true, loaded: true, detail: 'test', uptimeMs: 1 } as EngineHealth;
  }

  async load(): Promise<void> {}
  async unload(): Promise<void> {}

  async *generate(req: GenerateRequest): AsyncGenerator<GenerateChunk> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (req.signal?.aborted) return;
    yield { type: 'token', text: 'сайн' };
    yield {
      type: 'done',
      stopReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1 },
    };
  }
}

/* ================================================================== */
/*  SSE ХАРИУГ УНШИХ                                                   */
/* ================================================================== */

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

async function readSse(url: string, body: unknown): Promise<Frame[]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  });
  assert.equal(res.ok, true, `SSE хариу ${res.status}`);
  assert.ok(res.body, 'SSE бие алга');

  const frames: Frame[] = [];
  const reader = res.body.getReader();
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
      if (data.length === 0) continue;
      frames.push({ event, data: JSON.parse(data) as Record<string, unknown> });
    }
  }
  return frames;
}

/**
 * `server.ts`-ийн `/generate` салааг ЯГ ТЭР бүтэцтэйгээр давтана.
 *
 * ⚠️ Бүтэн `createRuntimeServer`-ыг ашиглаагүй нь ЗОРИУД: тэр нь
 *    `ModelManager`, `detectHardware`, диск дээрх нууц зэрэг бодит
 *    орчин шаардана.  Энд шалгагдах зүйл нь ЦОХИЛТЫН ТАЙМЕР бөгөөд
 *    түүний логик доор бүрэн давтагдсан.  Хэрэв `server.ts` дээрх
 *    цохилтыг устгавал энэ тест УНАХГҮЙ тул `heartbeat` мөрийг эх
 *    кодоос ЧУУЛГАН шалгах тестийг ч доор нэмэв.
 */
function startFakeGenerate(engine: InferenceEngine, heartbeatMs: number): Promise<Server> {
  const server = createServer(async (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const started = Date.now();
    let firstTokenMs: number | null = null;
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('start', { engine: engine.info(), at: started });

    const heartbeat = setInterval(() => {
      if (firstTokenMs !== null) return;
      send('heartbeat', { stage: 'generation', elapsed_ms: Date.now() - started });
    }, heartbeatMs);
    heartbeat.unref?.();

    try {
      for await (const chunk of engine.generate({ turns: [], maxTokens: 8 })) {
        if (chunk.type === 'token') {
          if (firstTokenMs === null) {
            firstTokenMs = Date.now() - started;
            clearInterval(heartbeat);
          }
          send('token', { text: chunk.text });
        } else if (chunk.type === 'done') {
          send('done', { stop_reason: chunk.stopReason, first_token_ms: firstTokenMs });
        }
      }
    } finally {
      clearInterval(heartbeat);
    }
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ================================================================== */

test('удаан prefill дээр ЦОХИЛТ ирнэ (§10)', async () => {
  const server = await startFakeGenerate(new SlowEngine(700), 200);
  const { port } = server.address() as AddressInfo;
  try {
    const frames = await readSse(`http://127.0.0.1:${port}/generate`, { turns: [] });
    const beats = frames.filter((f) => f.event === 'heartbeat');
    assert.ok(beats.length >= 2, `цохилт ${beats.length} ирэв, 2-оос олон байх ёстой`);
    // ⚠️ Цохилт нь өнгөрсөн хугацааг ҮНЭНЭЭР дамжуулна — UI түүгээр
    //    «амьд» гэдгийг шийднэ.
    for (const b of beats) {
      assert.equal(b.data.stage, 'generation');
      assert.ok(typeof b.data.elapsed_ms === 'number' && b.data.elapsed_ms >= 0);
    }
  } finally {
    server.close();
  }
});

test('ЭХНИЙ ТОКЕН гармагц цохилт ЗОГСОНО — SSE дэмий дүүрэхгүй', async () => {
  const server = await startFakeGenerate(new SlowEngine(500), 150);
  const { port } = server.address() as AddressInfo;
  try {
    const frames = await readSse(`http://127.0.0.1:${port}/generate`, { turns: [] });
    const firstTokenIdx = frames.findIndex((f) => f.event === 'token');
    assert.ok(firstTokenIdx >= 0, 'токен ирсэнгүй');
    const beatsAfter = frames.slice(firstTokenIdx).filter((f) => f.event === 'heartbeat');
    assert.equal(beatsAfter.length, 0, 'эхний токены ДАРАА цохилт үргэлжилсэн');
  } finally {
    server.close();
  }
});

test('ХУРДАН хариу дээр цохилт ОГТ гарахгүй', async () => {
  const server = await startFakeGenerate(new SlowEngine(10), 2000);
  const { port } = server.address() as AddressInfo;
  try {
    const frames = await readSse(`http://127.0.0.1:${port}/generate`, { turns: [] });
    assert.equal(frames.filter((f) => f.event === 'heartbeat').length, 0);
    assert.ok(frames.some((f) => f.event === 'token'));
  } finally {
    server.close();
  }
});

/* ================================================================== */
/*  ЭХ КОДЫН ГЭРЭЭ                                                     */
/* ================================================================== */

test('server.ts нь /generate дээр ЦОХИЛТ илгээсэн хэвээр байна', async () => {
  // ⚠️ Дээрх тестүүд нь логикийг давтдаг тул `server.ts`-ээс цохилтыг
  //    устгавал тэд УНАХГҮЙ.  Энэ тест нь тэр цоорхойг хаана — тайлбар
  //    хуучирдаг, тест хуучирдаггүй.
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts'),
    'utf8',
  );
  assert.ok(src.includes("send('heartbeat'"), '/generate дээр цохилт илгээхээ больжээ');
  assert.ok(src.includes('clearInterval(heartbeat)'), 'цохилтын таймер цэвэрлэгдэхгүй байна');
});
