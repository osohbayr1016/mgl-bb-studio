import type { Env } from '../types';
import { createNotification } from './notify';
import type { NotificationType } from '../types';

/**
 * Захиалагчид харагдах өөрчлөлтийг БҮРТГЭЭД шууд түлхнэ.
 *
 * Хоёр алхам, дараалал нь ЧУХАЛ:
 *   1. `client_events`-т мөр бичнэ — энэ бол ҮНЭН.  Офлайн байсан захиалагч
 *      дараа нь `since_id`-аар гүйцээж татна.
 *   2. `ClientRoom` DO руу түлхнэ — энэ бол зөвхөн ХУРД.  Амжилтгүй болбол
 *      юу ч эвдрэхгүй: клиент дараагийн ачаалалт дээр өөрчлөлтөө харна.
 *
 * Бүх алдааг залгина — мэдэгдэл гол үйлдлийг (тайлан гаргах, зураг өгөх)
 * ХЭЗЭЭ Ч унагааж болохгүй.  `lib/notify.ts`-ийн загвартай ижил.
 */

export type ClientEventKind =
  | 'progress'
  | 'deliverable'
  | 'report'
  | 'asr'
  | 'document'
  | 'message'
  | 'submission_reviewed'
  | 'notice'
  /* RFI/CR гарын үсэг — хүсэлт / цуцлалт / зурав (routes/correspondenceSignature.ts). */
  | 'signature';

export interface ClientEventRow {
  id: number;
  project_id: number;
  kind: string;
  ref_id: number | null;
  title_mn: string;
  created_at: string;
}

/** Тухайн төслийн WebSocket өрөө. */
function room(env: Env, projectId: number) {
  return env.CLIENT_ROOM?.get(env.CLIENT_ROOM.idFromName(`project:${projectId}`));
}

export async function emitClientEvent(
  env: Env,
  projectId: number,
  kind: ClientEventKind,
  titleMn: string,
  refId?: number | null,
  actorUserId?: number | null,
): Promise<ClientEventRow | null> {
  let row: ClientEventRow | null = null;
  try {
    row = await env.DB.prepare(
      `INSERT INTO client_events (project_id, kind, ref_id, title_mn, actor_user_id)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id, project_id, kind, ref_id, title_mn, created_at`,
    )
      .bind(projectId, kind, refId ?? null, titleMn, actorUserId ?? null)
      .first<ClientEventRow>();
  } catch (err) {
    console.error('[client-events] бичилт амжилтгүй', err);
    return null;
  }

  if (row) await broadcastClientEvent(env, projectId, row);
  return row;
}

/** DO руу түлхэх — зөвхөн хурдны төлөө, алдаа нь чухал биш. */
export async function broadcastClientEvent(
  env: Env,
  projectId: number,
  event: ClientEventRow,
): Promise<void> {
  try {
    const stub = room(env, projectId);
    if (!stub) return;
    await stub.fetch('https://client-room/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch (err) {
    console.warn('[client-events] түлхэлт амжилтгүй', err);
  }
}

/**
 * Тухайн төслийн эрхтэй БҮХ захиалагчийн холбоо барих хүн рүү мэдэгдэл.
 *
 * Хоёр эх сурвалжийг зэрэг уншина (`lib/clientAccess.ts`-тэй ижил шалтгаан):
 * шинэ `project_client_access` → `client_contacts`, хуучин `project_members`.
 */
export async function notifyProjectClients(
  env: Env,
  projectId: number,
  type: NotificationType,
  title: string,
  body?: string | null,
  link?: string | null,
  excludeUserId?: number,
): Promise<number> {
  const ids = new Set<number>();

  try {
    const { results } = await env.DB.prepare(
      `SELECT cc.user_id AS user_id
         FROM project_client_access pca
         JOIN client_contacts cc ON cc.org_id = pca.org_id
         JOIN users u ON u.id = cc.user_id AND u.status = 'active'
        WHERE pca.project_id = ? AND pca.revoked_at IS NULL`,
    )
      .bind(projectId)
      .all<{ user_id: number }>();
    for (const r of results) ids.add(r.user_id);
  } catch {
    /* migration ороогүй DB — хуучин эх сурвалж дээр үргэлжилнэ */
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT pm.user_id AS user_id
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id AND u.status = 'active' AND u.role = 'client'
        WHERE pm.project_id = ?`,
    )
      .bind(projectId)
      .all<{ user_id: number }>();
    for (const r of results) ids.add(r.user_id);
  } catch {
    /* ignore */
  }

  if (excludeUserId !== undefined) ids.delete(excludeUserId);

  await Promise.all([...ids].map((id) => createNotification(env.DB, id, type, title, body, link)));
  return ids.size;
}
