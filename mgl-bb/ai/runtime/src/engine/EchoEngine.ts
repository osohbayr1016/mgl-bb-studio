/**
 * MGL AI · ECHO ХӨДӨЛГҮҮР — ЗАГВАРГҮЙ, ДЕТЕРМИНИСТ.
 *
 * ⚠️ ЭНЭ НЬ ХУУРАМЧ AI ENDPOINT БИШ.  Ялгаа нь: хуурамч endpoint нь
 *    бодит загвар ажиллаж байгаа мэт дүр эсгэдэг.  Энэ хөдөлгүүр нь
 *    хариу бүрдээ ӨӨРИЙГӨӨ нэрлэж, «MGL AI-ийн загвар суулгаагүй байна»
 *    гэдгийг МОНГОЛООР хэлнэ.  Зорилго нь ГУРАВ:
 *
 *      1. ТЕСТ ба CI — GPU, гигабайт татаж авалтгүйгээр бүх хоолойг
 *         (эрх → шүүлт → prompt → урсгал → санал хүсэлт) төгсгөл хүртэл
 *         ажиллуулна.
 *      2. ПЕРВЫЙ АЖИЛЛУУЛАЛТ — ажилтан суулгамагц чат нээгдэж, юу дутуу
 *         байгааг ил хэлнэ.  Хоосон дэлгэц эсвэл 500 алдаанаас хамаагүй
 *         дээр.
 *      3. ХЯЗГААРЫН ЗАН ТӨЛӨВ — загвар унасан үед систем нь БҮТЭН
 *         унахгүй, харин хайлт+хэрэгслийн хариу үлдэнэ.
 *
 * ⚠️ ЭНЭ ХӨДӨЛГҮҮР ТООЦООЛОЛ ХИЙХГҮЙ, ДҮРЭМ ЗОХИОХГҮЙ.  Түүнд өгсөн
 *    нотолгоог ЖАГСААЖ, эх сурвалжийг нь заана — өөрөөр хэлбэл `retrieval
 *    only` горим.  Тэр нь ҮНЭН бөгөөд ашигтай хариу, зохиомол биш.
 */
import type {
  EngineHealth,
  EngineInfo,
  GenerateChunk,
  GenerateRequest,
  InferenceEngine,
} from './InferenceEngine.ts';
import { estimateTokens } from './InferenceEngine.ts';

const NOTICE_MN =
  'MGL AI-ийн хэлний загвар энэ компьютерт хараахан суугаагүй байна. ' +
  'Тиймээс би одоогоор ЗӨВХӨН олдсон эх сурвалж, хэрэгслийн үр дүнг шууд ' +
  'дамжуулж байна — өгүүлбэр зохиохгүй, тооцоо хийхгүй.';

/** Хайрцаглагдсан нотолгооноос эшлэлийн мөрүүдийг гаргаж авна. */
function extractEvidenceLines(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^\[(\d{1,2})\] (id=\S+.*)$/gm)) {
    out.push(`[${m[1]}] ${m[2]}`);
  }
  return out;
}

/** «гарчиг: ...» мөрүүд. */
function extractTitles(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^гарчиг: (.+)$/gm)) out.push(m[1]!.trim());
  return out;
}

/**
 * ХЭРЭГСЛИЙН ҮР ДҮНГИЙН хайрцгийг задлана.
 *
 * ⚠️ ЯАГААД ЭНЭ ФУНКЦ ОРШИН БАЙНА (2026-09-08).  Өмнө нь Echo нь ЗӨВХӨН
 *    нотолгоог хардаг байсан тул `list_projects` бодит өгөгдөл авчирсан ч
 *    хариу нь «эх сурвалж олдсонгүй» гэж гардаг байв.  Тэр нь дутуу биш,
 *    ТӨӨРӨГДҮҮЛЭХ хариу — өгөгдөл авчирсан мөртлөө «алга» гэж хэлж байсан.
 */
function extractToolBlock(text: string): { asOf: string | null; lines: string[] } {
  const start = text.indexOf('<<<MGLAI-TOOLS>>>');
  const end = text.indexOf('<<<END-MGLAI-TOOLS>>>');
  if (start === -1 || end === -1 || end < start) return { asOf: null, lines: [] };

  const body = text.slice(start + '<<<MGLAI-TOOLS>>>'.length, end).trim();
  const rows = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  let asOf: string | null = null;
  const lines: string[] = [];
  for (const r of rows) {
    if (r.startsWith('огноо:')) {
      asOf = r.slice('огноо:'.length).trim() || null;
      continue;
    }
    lines.push(r);
  }
  return { asOf, lines };
}

export class EchoEngine implements InferenceEngine {
  #loadedAt: number | null = null;
  readonly #variant: string;

  constructor(variant = 'echo') {
    this.#variant = variant;
  }

  async load(): Promise<void> {
    // Идемпотент — хоёр удаа дуудахад төлөв өөрчлөгдөхгүй.
    this.#loadedAt ??= Date.now();
  }

  async unload(): Promise<void> {
    this.#loadedAt = null;
  }

  info(): EngineInfo {
    return {
      engine: 'echo',
      runtimeVariant: this.#variant,
      modelVersion: null,
      artifact: null,
      quantization: null,
      contextTokens: 4096,
      loaded: this.#loadedAt !== null,
    };
  }

  async health(): Promise<EngineHealth> {
    return {
      ok: true,
      loaded: this.#loadedAt !== null,
      detail: 'echo — загвар суулгаагүй, эх сурвалжийг шууд дамжуулна',
      uptimeMs: this.#loadedAt === null ? null : Date.now() - this.#loadedAt,
    };
  }

  async *generate(req: GenerateRequest): AsyncIterable<GenerateChunk> {
    await this.load();

    const lastUser = [...req.turns].reverse().find((t) => t.role === 'user');
    const body = lastUser?.content ?? '';
    const evidence = extractEvidenceLines(body);
    const titles = extractTitles(body);
    const tools = extractToolBlock(body);

    const lines: string[] = [NOTICE_MN, ''];

    // ── ERP-ийн АМЬД өгөгдөл ЭХЛЭЭД ────────────────────────────────
    // ⚠️ Энэ блок нь хэрэглэгчийн асуултын БОДИТ хариу байх нь олонтаа
    //    («хэдэн төсөл байна»).  Түүнийг доор нуух нь утгагүй.
    if (tools.lines.length > 0) {
      lines.push(`ERP-ийн өгөгдөл${tools.asOf ? ` (${tools.asOf})` : ''}:`);
      for (const l of tools.lines) lines.push(`  ${l}`);
      lines.push('');
    }

    if (evidence.length > 0) {
      lines.push('Олдсон эх сурвалж:');
      evidence.forEach((e, i) => {
        const title = titles[i];
        lines.push(`  ${e}${title ? ` — ${title}` : ''}`);
      });
      lines.push('');
      // ⚠️ Эшлэлийн дугаарыг бичих нь `confidence.ts`-ийн
      //    `extractCitationIds`-д зориулсан — эшлэлийн хоолой Echo дээр ч
      //    төгсгөл хүртэл ажиллана.
      lines.push(`Эшлэл: ${evidence.map((_, i) => `[${i + 1}]`).join(' ')}`);
    } else if (tools.lines.length === 0) {
      // ⚠️ ЗӨВХӨН хоёулаа хоосон үед л «олдсонгүй» гэж хэлнэ.  Хэрэгслийн
      //    үр дүн ирсэн атал «олдсонгүй» гэж хэлэх нь ХУДАЛ.
      lines.push('Энэ асуултад тохирох баталгаажсан эх сурвалж олдсонгүй.');
    } else {
      lines.push('Норм, стандартын эх сурвалж олдсонгүй — дээрх нь ERP-ийн бүртгэлээс.');
    }

    const text = lines.join('\n');

    // Токеноор урсгана — frontend-ийн streaming зам жинхэнэ хөдөлгүүртэй
    // ижилхэн ажиллана.
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      if (req.signal?.aborted) {
        yield { type: 'done', stopReason: 'aborted', usage: { promptTokens: null, completionTokens: null } };
        return;
      }
      yield { type: 'token', text: piece };
    }

    yield {
      type: 'done',
      stopReason: 'stop',
      usage: {
        promptTokens: estimateTokens(req.turns.map((t) => t.content).join('\n')),
        completionTokens: estimateTokens(text),
      },
    };
  }
}
