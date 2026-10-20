/**
 * ТАСКИЙН ХУВААРИЛТЫН ИДЭВХЖҮҮЛЭЛТ + НЭГЖИЙН ГЭРЭЭ (2026-10-05, migration 0384).
 *
 * Хоёр ТУСДАА хаалга — ХОЁУЛАА сервер дээр, frontend нуух нь хамгаалалт БИШ:
 *
 *   1. ИДЭВХЖҮҮЛЭЛТИЙН ТӨЛӨВ (`app_settings['task_alloc.state']`):
 *        disabled — managed хуваарилалт ХААЛТТАЙ: шинэ managed мутаци (хуваах, хувь, буцаах, дахин авах, засах, сэргээх,
 *                   managed таск дээр цаг эхлүүлэх) 423.  Унших, түүх, хуучин (managed биш) таскийн ердийн ажил ХЭВЭЭР.
 *        enabled  — ажиллана.
 *        paused   — ОСЛЫН түгжээ: унших ХЭВЭЭР, бүх managed мутаци 423 (түүх, оноо, цаг устахгүй).
 *      Тохируулагдаагүй / танигдахгүй утга = `paused` (хамгийн хязгаарлагдмал бөгөөд унших боломжтой — FAIL-SAFE).
 *      Админы үйлдлүүд (төлөв солих, хуучин өгөгдөл хөрвүүлэх, аудит) энэ хаалгаас ЧӨЛӨӨТЭЙ — release-ийн дараалал
 *      «paused үед хөрвүүлж, дараа нь идэвхжүүлнэ» гэж шаарддаг.
 *
 *   2. КЛИЕНТИЙН ГЭРЭЭ (`X-Task-Alloc-Contract` хүсэлтийн толгой): managed мутаци бүр клиентийн дэмждэг гэрээний хувилбарыг
 *      илгээх ёстой.  Толгойгүй / хуучин → 426 (хуучин PWA, кэштэй bundle, хуучин Revit add-in хуучин семантикаар
 *      managed таск руу бичихгүй).  Хариу бүр `X-Task-Alloc-Contract` (одоогийн хувилбар) + `X-Task-Alloc-State` тээнэ.
 *
 * Шалгалтын дараалал: 426 (клиент төлөвийн утгыг ойлгож чадахгүй) → 423 (төлөв).
 *
 * Энэ файл D1-ээс `app_settings`-ийн НЭГ мөр л уншина.  Цэвэр хэсэг (`parse*`, `decide*`) тестэд.
 */

/** Одоогийн нэгжийн гэрээний хувилбар.  Нийцгүй өөрчлөлт бүрд өсгөнө (frontend `api.ts`-ийн ихэр). */
export const TASK_ALLOC_CONTRACT = 1;
/** Хамгийн бага дэмжигдэх хувилбар — үүнээс доош клиент 426. */
export const TASK_ALLOC_MIN_CONTRACT = 1;

export const TASK_ALLOC_CONTRACT_HEADER = 'X-Task-Alloc-Contract';
export const TASK_ALLOC_STATE_HEADER = 'X-Task-Alloc-State';
export const TASK_ALLOC_STATE_KEY = 'task_alloc.state';

export const TASK_ALLOC_STATES = ['disabled', 'enabled', 'paused'] as const;
export type TaskAllocState = (typeof TASK_ALLOC_STATES)[number];

export function parseTaskAllocState(v: unknown): TaskAllocState | null {
  return typeof v === 'string' && (TASK_ALLOC_STATES as readonly string[]).includes(v) ? (v as TaskAllocState) : null;
}

export interface GateSnapshot {
  state: TaskAllocState;
  /** `false` = мөр байхгүй / буруу утга (fail-safe `paused`). */
  configured: boolean;
  updatedAt: string | null;
  updatedBy: number | null;
}

export async function loadGate(db: D1Database): Promise<GateSnapshot> {
  try {
    const row = await db
      .prepare('SELECT value, updated_at, updated_by FROM app_settings WHERE key = ?')
      .bind(TASK_ALLOC_STATE_KEY)
      .first<{ value: string; updated_at: string | null; updated_by: number | null }>();
    const state = parseTaskAllocState(row?.value);
    if (!row || state === null) return { state: 'paused', configured: false, updatedAt: null, updatedBy: null };
    return { state, configured: true, updatedAt: row.updated_at, updatedBy: row.updated_by };
  } catch (err) {
    // `app_settings` уншигдахгүй бол (D1 алдаа) ХЭЗЭЭ Ч «enabled» гэж үзэхгүй.
    console.error('[task-alloc-gate] state read failed → paused', err);
    return { state: 'paused', configured: false, updatedAt: null, updatedBy: null };
  }
}

/* ------------------------------------------------------------------ */
/*  Клиентийн гэрээ                                                     */
/* ------------------------------------------------------------------ */

export type ClientContract =
  | { kind: 'missing' }
  | { kind: 'invalid'; raw: string }
  | { kind: 'ok'; version: number };

/** Хувилбар = бүхэл ≥ 1 ('1', '2').  Зай, бутархай, хасах тэмдэг, '1.0', 'v1' бүгд invalid. */
export function parseClientContract(raw: string | null | undefined): ClientContract {
  if (raw === null || raw === undefined || raw.trim() === '') return { kind: 'missing' };
  const t = raw.trim();
  if (!/^[0-9]{1,6}$/.test(t)) return { kind: 'invalid', raw: t.slice(0, 32) };
  const version = Number(t);
  if (version < 1) return { kind: 'invalid', raw: t };
  return { kind: 'ok', version };
}

export type GateBlockCode =
  | 'CONTRACT_UPGRADE_REQUIRED'
  | 'TASK_ALLOC_PAUSED'
  | 'TASK_ALLOC_DISABLED'
  | 'TASK_ALLOC_UNCONFIGURED';

export type GateVerdict =
  | { ok: true }
  | { ok: false; status: 426 | 423; code: GateBlockCode; message: string; extra: Record<string, unknown> };

/**
 * Managed мутацийн шийдвэр (цэвэр).  `admin` нь ЗӨВХӨН тусгай admin замуудад (энд дуудагдахгүй) — энгийн managed
 * мутаци админд ч гэсэн ижил хаагдана: «paused» нь админыг хүртэл нэгэн адил зогсооно (тэр өөрөө төлөв солино).
 */
export function decideManagedWrite(gate: GateSnapshot, client: ClientContract): GateVerdict {
  const ctx = { contract: TASK_ALLOC_CONTRACT, min_contract: TASK_ALLOC_MIN_CONTRACT, state: gate.state };
  if (client.kind !== 'ok' || client.version < TASK_ALLOC_MIN_CONTRACT) {
    return {
      ok: false,
      status: 426,
      code: 'CONTRACT_UPGRADE_REQUIRED',
      message: 'Таны хуудас хуучирсан байна — хуудсаа шинэчилнэ үү (Ctrl+Shift+R эсвэл «Шинэчлэх» товч). Хуучин хуудсаар ажлын хуваарилалт хадгалахгүй.',
      extra: {
        ...ctx,
        received: client.kind === 'ok' ? String(client.version) : client.kind === 'invalid' ? client.raw : null,
      },
    };
  }
  if (client.version > TASK_ALLOC_CONTRACT) {
    // Клиент СЕРВЕРЭЭС ШИНЭ (frontend түрүүлж deploy хийгдсэн) — сервер ойлгохгүй семантикаар бичихгүй.
    return {
      ok: false,
      status: 426,
      code: 'CONTRACT_UPGRADE_REQUIRED',
      message: 'Сервер шинэчлэгдэж дуусаагүй байна — хэдэн минутын дараа дахин оролдоно уу.',
      extra: { ...ctx, received: String(client.version), direction: 'server_older' },
    };
  }
  if (gate.state === 'enabled') return { ok: true };
  if (gate.state === 'disabled') {
    return {
      ok: false,
      status: 423,
      code: 'TASK_ALLOC_DISABLED',
      message: 'Таскийн хуваарилалт одоогоор идэвхжээгүй байна.',
      extra: ctx,
    };
  }
  return {
    ok: false,
    status: 423,
    code: gate.configured ? 'TASK_ALLOC_PAUSED' : 'TASK_ALLOC_UNCONFIGURED',
    message: 'Таскийн хуваарилалт түр түгжигдсэн байна — харах боломжтой, засах боломжгүй. Удирдлагаас асууна уу.',
    extra: ctx,
  };
}

/** Хариу бүрийн гэрээний толгойнууд. */
export function contractHeaders(state?: TaskAllocState): Record<string, string> {
  const h: Record<string, string> = { [TASK_ALLOC_CONTRACT_HEADER]: String(TASK_ALLOC_CONTRACT) };
  if (state) h[TASK_ALLOC_STATE_HEADER] = state;
  return h;
}

/** 426-д RFC 7231-ийн шаардлагаар `Upgrade` толгой ЗААВАЛ. */
export function verdictHeaders(v: Extract<GateVerdict, { ok: false }>, state: TaskAllocState): Record<string, string> {
  return {
    ...contractHeaders(state),
    ...(v.status === 426 ? { Upgrade: `MGL-Task-Alloc/${TASK_ALLOC_CONTRACT}` } : {}),
    'Cache-Control': 'no-store',
  };
}

export function verdictBody(v: Extract<GateVerdict, { ok: false }>): { error: GateBlockCode; message: string } & Record<string, unknown> {
  return { error: v.code, message: v.message, ...v.extra };
}

/** Таск managed эсэх (`task_roots` мөр). */
export async function isManagedTask(db: D1Database, taskId: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM task_roots WHERE task_id = ?').bind(taskId).first();
  return !!row;
}

/**
 * Хуучин бүлгийг хөрвүүлэхэд (migration 0385) root-д НЭГТГЭГДСЭН хэсэг таск — жин 0, түүх хэвээр.  Тэр дээр хувь бичих,
 * цаг эхлүүлэх, засах нь root-ийн тоог давхар хийх тул ХААЛТТАЙ.  Буцаах: root-ийн task id (нэгтгэгдсэн бол), эс бол null.
 * Хүснэгт хараахан байхгүй (0385 хэрэгжээгүй) орчинд null.
 */
export async function retiredIntoRoot(db: D1Database, taskId: number): Promise<number | null> {
  try {
    const row = await db
      .prepare(
        `SELECT c.root_task_id AS root FROM task_conversion_members m
           JOIN task_conversions c ON c.id = m.conversion_id
          WHERE m.task_id = ? AND m.role = 'retired' AND c.status = 'applied'`,
      )
      .bind(taskId)
      .first<{ root: number }>();
    return row?.root ?? null;
  } catch {
    return null;
  }
}

/** `retiredIntoRoot`-ийн олон таскийн хувилбар (chunk ≤ 90 bind).  Нэгтгэгдсэн хэсэг тус бүрийн root-ийг буцаана. */
export async function retiredIntoRootMany(db: D1Database, taskIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const ids = [...new Set(taskIds.filter((n) => Number.isInteger(n) && n > 0))];
  try {
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const { results } = await db
        .prepare(
          `SELECT m.task_id AS task_id, c.root_task_id AS root FROM task_conversion_members m
             JOIN task_conversions c ON c.id = m.conversion_id
            WHERE m.role = 'retired' AND c.status = 'applied' AND m.task_id IN (${chunk.map(() => '?').join(',')})`,
        )
        .bind(...chunk)
        .all<{ task_id: number; root: number }>();
      for (const r of results ?? []) out.set(Number(r.task_id), Number(r.root));
    }
  } catch {
    return new Map();
  }
  return out;
}

/**
 * Managed таск дээр хуучин «root-ийн хувь бичих» зам (вэб, /bulk, Revit add-in) хаалттай — 409 `MANAGED_ROOT`.
 * `retryable: false` — ижил хүсэлтийг дахин илгээх нь ХЭЗЭЭ Ч амжихгүй (add-in-ий офлайн дараалал үүгээр танина).
 */
export const MANAGED_ROOT_MESSAGE =
  'Энэ таск хуваарилагдсан — өөрийн хэсгийн хувийг «Миний ажлууд»-аас бөглөнө үү (бүх таскийн хувь олон хүний хэсгийн нийлбэр).';

export function managedRootBody(taskId: number, projectId: number | null): Record<string, unknown> {
  return {
    error: 'MANAGED_ROOT',
    message: MANAGED_ROOT_MESSAGE,
    managed: true,
    retryable: false,
    task_id: taskId,
    project_id: projectId,
    contract: TASK_ALLOC_CONTRACT,
    open_url: projectId ? `/app/projects/${projectId}?task=${taskId}` : `/app/my-tasks`,
  };
}

export const CONVERTED_PART_MESSAGE =
  'Энэ хэсэг үндсэн ажилд нэгтгэгдсэн — явц, цагийг үндсэн ажил дээр бүртгэнэ (түүх хэвээр хадгалагдсан).';

/** Нэгтгэгдсэн хэсэг дээрх бичих үйлдлийн 409 — үндсэн ажил руу чиглүүлнэ (`retryable: false`). */
export function convertedPartBody(taskId: number, projectId: number | null, rootTaskId: number): Record<string, unknown> {
  return {
    error: 'CONVERTED_PART',
    message: CONVERTED_PART_MESSAGE,
    managed: true,
    retryable: false,
    task_id: taskId,
    root_task_id: rootTaskId,
    project_id: projectId,
    contract: TASK_ALLOC_CONTRACT,
    open_url: projectId ? `/app/projects/${projectId}?task=${rootTaskId}` : `/app/my-tasks`,
  };
}
