/**
 * asrSafety.ts — Зохиогчийн хяналтын ӨМНӨХ ХАБ-ын танилцсан баталгаа.
 *
 * `/api/author-supervision`-ы ХОЁР ДАХЬ mount (`index.ts`, үндсэн
 * `authorSupervision.ts`-ээс ӨМНӨ).  Тусдаа файл байгаа шалтгаан: үндсэн
 * файлыг өөр ажил зэрэг засдаг тул энэ урсгал бүхэлдээ нэг газар,
 * `/:id`-ээс өмнө бүртгэгдсэн `/safety` замуудтай байх нь давхцалгүй.
 *
 *   GET  /safety                     — харуулах бичвэр + хувилбар + hash
 *   POST /safety/acknowledgements    — уншсан + чагт + гарын үсэг → мөр
 *   POST /projects/:projectId        — ХААЛТ (middleware): биед хүчинтэй
 *                                      `safety_ack_id` байхгүй бол 403
 *                                      `SAFETY_ACK_REQUIRED`; амжилттай
 *                                      үүсмэгц баталгааг тайлантай холбоно.
 *                                      Зөвхөн `report_type = 'site'` (Талбайн
 *                                      хяналт, өгөгдмөл) — цахим/оффис уулзалт,
 *                                      зургийн өөрчлөлтөд хаалт үгүй (0362).
 *
 * ⚠️ Хаалт нь `authorSupervision.ts`-ийн create handler-ийг ХӨНДӨХГҮЙ: Hono
 *    ижил замын handler-уудыг бүртгэсэн дарааллаар залгадаг тул энд
 *    `await next()` хийвэл үндсэн handler ажиллана.  `c.req.json()` нь
 *    биеийг кэшлэдэг тул доорх handler дахин уншиж чадна.
 */

import { Hono } from 'hono';
import {
  ASR_SAFETY_CONTENT,
  ackProblem,
  asrSafetyContentHash,
  validateAckBody,
  type AsrSafetyAckBody,
  type AsrSafetyAckRow,
} from '../lib/asrSafety';
import {
  DEFAULT_ASR_REPORT_TYPE,
  parseAsrReportType,
  requiresSafetyAck,
} from '../lib/asrReportType';
import type { Env, AppVariables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** `authorSupervision.ts`-ийн `ASR_ROLES`-ийн толь — тэндээс export хийвэл
 *  тэр файлыг хөндөнө; цагаан жагсаалт хэвээр (шинэ дүр өгөгдмөлөөр хаалттай). */
const ASR_ROLES = new Set(['admin', 'engineer', 'architect', 'senior']);

/** Hash-ийг хүсэлт бүрд дахин бодохгүй — бичвэр модулийн тогтмол. */
let cachedHash: Promise<string> | null = null;
function currentHash(): Promise<string> {
  cachedHash ??= asrSafetyContentHash(ASR_SAFETY_CONTENT);
  return cachedHash;
}

router.get('/safety', async (c) => {
  const user = c.get('user');
  if (!ASR_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const hash = await currentHash();
  return c.json({ content: ASR_SAFETY_CONTENT, hash });
});

router.post('/safety/acknowledgements', async (c) => {
  const user = c.get('user');
  if (!ASR_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<AsrSafetyAckBody>().catch((): AsrSafetyAckBody => ({}));
  const hash = await currentHash();
  let v = validateAckBody(body, user.sub, { version: ASR_SAFETY_CONTENT.version, hash });
  /**
   * `SIGNATURE_NOT_OWNED` — зураг нь өөрийнх нь upload биш.  Гэхдээ 2026-09-23-аас
   * цонх нь ПРОФАЙЛЫН гарын үсгийг («Гарын үсэг ашиглах») санал болгодог бөгөөд
   * тэр мөрийг админ оруулсан бол түлхүүр нь админы `<sub>-` угтвартай байж
   * болно.  Тиймээс ЯГ тэр хэрэглэгчийн `users.signature_url`-тэй тэнцэж байвал
   * зөвшөөрнө — өөр хүний зургийг залгах зам нээгдэхгүй (тэнцүү байх ёстой).
   */
  if (!v.ok && v.code === 'SIGNATURE_NOT_OWNED') {
    const own = await c.env.DB.prepare('SELECT signature_url FROM users WHERE id = ?')
      .bind(user.sub)
      .first<{ signature_url: string | null }>();
    if (own?.signature_url && own.signature_url === body.signature_url) {
      v = validateAckBody(
        { ...body, signature_url: `/media/${user.sub}-safety-profile` },
        user.sub,
        { version: ASR_SAFETY_CONTENT.version, hash },
      );
      if (v.ok) v = { ...v, signatureUrl: own.signature_url };
    }
  }
  if (!v.ok) return c.json({ error: v.error, code: v.code }, v.status);

  if (v.projectId != null) {
    const p = await c.env.DB.prepare('SELECT 1 AS x FROM projects WHERE id = ?')
      .bind(v.projectId)
      .first<{ x: number }>();
    if (!p) return c.json({ error: 'Project not found', code: 'BAD_PROJECT' }, 404);
  }

  const acknowledgedAt = new Date().toISOString();
  const res = await c.env.DB.prepare(
    `INSERT INTO asr_safety_acknowledgements
       (user_id, project_id, content_version, content_hash, signature_url, acknowledged_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(user.sub, v.projectId, ASR_SAFETY_CONTENT.version, hash, v.signatureUrl, acknowledgedAt)
    .run();

  return c.json(
    {
      acknowledgement: {
        id: Number(res.meta.last_row_id),
        acknowledged_at: acknowledgedAt,
        content_version: ASR_SAFETY_CONTENT.version,
      },
    },
    201,
  );
});

/**
 * Хаалт.  Дараалал:
 *   1. `client_uuid` аль хэдийн байвал → idempotent дахин илгээлт, хаалт
 *      ҮГҮЙ (тайлан аль хэдийн үүссэн, баталгаа нь холбогдсон).
 *   2. `safety_ack_id` мөр нь ЭНЭ хэрэглэгчийнх, ХЭРЭГЛЭЭГҮЙ, 24 цагийн
 *      дотор, төслийн зөрүүгүй → үндсэн handler руу.
 *   3. Үндсэн handler 201 буцаавал баталгааг `client_uuid`-аар олдсон
 *      шинэ тайлантай холбоно (`report_id` UNIQUE partial index — нэг
 *      баталгаа хоёр тайланд орохгүй).
 */
router.post('/projects/:projectId', async (c, next) => {
  const user = c.get('user');
  const projectId = Number(c.req.param('projectId'));
  const body = await c.req
    .json<{ client_uuid?: unknown; safety_ack_id?: unknown; report_type?: unknown }>()
    .catch(() => ({}) as { client_uuid?: unknown; safety_ack_id?: unknown; report_type?: unknown });

  const clientUuid = typeof body.client_uuid === 'string' ? body.client_uuid.trim() : '';
  if (clientUuid) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM author_supervision_reports WHERE client_uuid = ?',
    )
      .bind(clientUuid)
      .first<{ id: number }>();
    if (existing) return next();
  }

  /*
   * Тайлангийн төрөл (0362): ХАБ-ын баталгаа ЗӨВХӨН талбайн хяналтад (эзний
   * шийдвэр 2026-09-29).  Танигдахгүй утгыг энд шийдэхгүй — үндсэн handler
   * 400 буцаана; ирээгүй бол өгөгдмөл `site` → хаалт хэвээр (хуучин клиент).
   */
  const parsedType = parseAsrReportType(body.report_type);
  const reportType = parsedType.ok ? (parsedType.type ?? DEFAULT_ASR_REPORT_TYPE) : null;
  if (reportType === null) return next();
  const gated = requiresSafetyAck(reportType);

  const ackId = Number(body.safety_ack_id);
  const row = Number.isInteger(ackId) && ackId > 0
    ? await c.env.DB.prepare(
        `SELECT id, user_id, project_id, acknowledged_at, report_id
           FROM asr_safety_acknowledgements WHERE id = ?`,
      )
        .bind(ackId)
        .first<AsrSafetyAckRow>()
    : null;

  const problem = ackProblem(row, { userSub: user.sub, projectId, nowMs: Date.now() });
  /*
   * Талбайн бус төрөл: баталгаагүй ч үүснэ.  Гэхдээ хүчинтэй баталгаа ирсэн
   * бол (талбайн хяналт гэж эхлээд засварлагчид төрлөө сольсон ноорог)
   * тайлантай ХОЛБОНО — дараа нь буцаад «Талбайн хяналт» болгоход
   * `PATCH /:id` тэр холбоосоор зөвшөөрнө.
   */
  if (!gated) {
    await next();
    if (!problem && c.res.status === 201 && clientUuid) {
      await c.env.DB.prepare(
        `UPDATE asr_safety_acknowledgements
            SET report_id = (SELECT id FROM author_supervision_reports WHERE client_uuid = ?),
                used_at = ?
          WHERE id = ? AND report_id IS NULL`,
      )
        .bind(clientUuid, new Date().toISOString(), ackId)
        .run();
    }
    return;
  }
  if (problem) {
    console.warn(`[asr-safety] create blocked user=${user.sub} project=${projectId} ack=${ackId || '-'} reason=${problem}`);
    return c.json(
      {
        error: 'Тайлан үүсгэхийн өмнө ХАБ-ын мэдээлэлтэй танилцаж гарын үсгээ зурна уу.',
        code: 'SAFETY_ACK_REQUIRED',
      },
      403,
    );
  }

  await next();

  if (c.res.status === 201 && clientUuid) {
    await c.env.DB.prepare(
      `UPDATE asr_safety_acknowledgements
          SET report_id = (SELECT id FROM author_supervision_reports WHERE client_uuid = ?),
              used_at = ?
        WHERE id = ? AND report_id IS NULL`,
    )
      .bind(clientUuid, new Date().toISOString(), ackId)
      .run();
  }
});

export default router;
