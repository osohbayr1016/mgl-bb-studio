import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';

/**
 * Generic AI helpers — endpoints that wrap Workers AI for
 * user-initiated text utilities.
 *
 * Currently exposes one route:
 *
 *   POST /api/ai/refine-mongolian
 *     Polishes a single block of Mongolian text — spelling,
 *     punctuation, dotted-i / soft-sign mistakes, basic grammar.
 *     Wired to the `PolishableTextarea` component on the
 *     frontend, which calls it on demand when the user clicks
 *     "Сайжруулах" beside any textarea.
 *
 * Auth: the parent `authMiddleware` (mounted in `index.ts` at
 * `/api/*`) guarantees `c.var.user` is set — we don't gate by
 * role because polishing one's own typed text isn't sensitive.
 *
 * Cost shape: each call hits `@cf/meta/llama-3.1-8b-instruct`
 * with a Mongolian editor system prompt + the user's text. No
 * caching (one-shot, user-initiated) and no `waitUntil` (the
 * frontend needs the result inline to swap the textarea).
 */

const ai = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const MIN_TEXT_LENGTH = 1;
const MAX_TEXT_LENGTH = 4000;

const SYSTEM_PROMPT =
  'Чи бол Монгол хэлний редактор. Хэрэглэгчийн өгсөн текстийн зөв бичих ёс, ' +
  'цэг таслал, дүрмийн алдааг л засна. Утга, бүтэц, өгүүлэх хэлбэрийг ' +
  'өөрчилж болохгүй. Техник нэр томьёог хэвээр үлдээнэ. Зөвхөн засаж ' +
  'дууссан текстийг буцаа — оршил, тайлбар, тэмдэглэл бичих хэрэггүй.';

ai.post('/refine-mongolian', async (c) => {
  let body: { text?: unknown };
  try {
    body = await c.req.json<{ text?: unknown }>();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Trim before length-checking so the editor doesn't get charged
  // for surrounding whitespace and the no-op short-circuit is fair.
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < MIN_TEXT_LENGTH) {
    return c.json({ error: 'Хоосон текст илгээгдсэн.' }, 400);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return c.json({ error: `Текст хэт урт байна (хязгаар: ${MAX_TEXT_LENGTH} тэмдэгт).` }, 400);
  }

  try {
    const result = (await c.env.AI.run(AI_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      // Generous ceiling: editing rarely expands text more than 1.25×,
      // but tokenisation of Cyrillic + soft-sign sequences runs hotter
      // than ASCII, so leave headroom.
      max_tokens: 1200,
    } as AiTextGenerationInput)) as AiTextGenerationOutput;

    const refined = (
      typeof result === 'object' && result && 'response' in result
        ? String((result as { response?: unknown }).response ?? '')
        : ''
    ).trim();

    if (!refined) {
      return c.json({ error: 'AI хариу буцаасангүй.' }, 502);
    }

    return c.json({ refined });
  } catch (err) {
    console.error('[ai.refine-mongolian] AI.run failed:', err);
    return c.json({ error: 'AI дуудлага амжилтгүй.' }, 502);
  }
});

export default ai;
