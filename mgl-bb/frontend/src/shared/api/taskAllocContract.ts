/**
 * ТАСКИЙН ХУВААРИЛАЛТЫН ГЭРЭЭ — клиентийн тал (2026-10-05).  Backend: `backend/src/lib/taskAllocGate.ts` (ихэр).
 *
 * Сервер managed мутаци бүрд (хуваах, хувь, буцаах, дахин авах, засах, сэргээх, managed таск дээр цаг эхлүүлэх)
 * хоёр ТУСДАА хаалга шалгана — frontend нуух нь хамгаалалт БИШ:
 *
 *   426 CONTRACT_UPGRADE_REQUIRED — клиентийн гэрээ (энэ файлын `TASK_ALLOC_CONTRACT`) хуучин/толгойгүй.  Хуучин PWA, кэштэй
 *       bundle энэ нөхцөлд managed таск руу ХЭЗЭЭ Ч бичихгүй; хэрэглэгчид «Шинэчлэх» гарна.
 *   423 TASK_ALLOC_{PAUSED|DISABLED|UNCONFIGURED} — удирдлагын идэвхжүүлэлтийн төлөв.  Унших хэвээр, бичих хаалттай.
 *
 * Гэрээ нь `apiFetch`-ийн БҮХ хүсэлтэд явна (managed замыг тусад нь жагсаавал нэгийг нь мартаж чимээгүй 426 болно).
 * Хариуны `X-Task-Alloc-State` толгойг хаа ч ирсэн энд цуглуулж, UI (баннер, идэвхгүй товч) нэг store-оос уншина.
 *
 * Энэ файл React-гүй: `client.ts` модулийн түвшинд дуудна; React тал `useSyncExternalStore`-оор уншина.
 */

/** Одоогийн гэрээний хувилбар.  Нийцгүй өөрчлөлт бүрд backend-тэй ХАМТ өсгөнө. */
export const TASK_ALLOC_CONTRACT = 1;
export const TASK_ALLOC_CONTRACT_HEADER = 'X-Task-Alloc-Contract';
export const TASK_ALLOC_STATE_HEADER = 'X-Task-Alloc-State';

export type TaskAllocState = 'enabled' | 'paused' | 'disabled';

/** Бичих боломжгүй болсон шалтгаан — баннерын төрөл. */
export type GateBlockKind = 'client_older' | 'server_older' | 'paused' | 'disabled' | 'unconfigured';

export interface GateBlock {
  kind: GateBlockKind;
  /** Серверийн хүнд уншигдах тайлбар (Монгол). */
  message: string;
  at: number;
}

export interface TaskAllocGateSnapshot {
  /** Сүүлд харсан идэвхжүүлэлтийн төлөв; хараахан харагдаагүй бол null (сервер шийднэ). */
  state: TaskAllocState | null;
  block: GateBlock | null;
}

/**
 * Хаалттай (paused/disabled) төлөвийн «сүүлд харсан» лавлагаа ЗӨВХӨН хуурамч түгжээнээс хамгаална: `X-Task-Alloc-State`-ийг
 * зөвхөн allocation/admin замууд ялгаруулдаг тул удирдлага дахин идэвхжүүлсний дараа ч (өөр замаар ажиллаж буй) хуудас
 * хуучин «paused»-ыг барьж үлдэж болно.  Тиймээс түгжээ энэ хугацааны дараа өөрөө суларч (state → null), дараагийн бичилтийг
 * СЕРВЕР шийднэ (дахин 423 бол баннер/түгжээ буцаж ирнэ).
 */
export const LOCK_TTL_MS = 60_000;
let lockTtlMs = LOCK_TTL_MS;
let lockTimer: ReturnType<typeof setTimeout> | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: TaskAllocGateSnapshot = { state: null, block: null };

function emit(): void {
  for (const l of listeners) l();
}

function clearLockTimer(): void {
  if (lockTimer !== null) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
}

function update(next: TaskAllocGateSnapshot): void {
  if (next.state === snapshot.state && next.block === snapshot.block) return;
  snapshot = next;
  // Түгжигдсэн төлөвийг ЦАГААР хязгаарлана (дээрх тайлбар).  Төлөв солигдох бүрд таймер шинээр эхэлнэ.
  clearLockTimer();
  if (next.state !== null && next.state !== 'enabled') {
    const armed = next.state;
    lockTimer = setTimeout(() => {
      lockTimer = null;
      if (snapshot.state === armed) update({ state: null, block: snapshot.block });
    }, lockTtlMs);
    (lockTimer as { unref?: () => void }).unref?.();
  }
  emit();
}

export const taskAllocGateStore = {
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  getSnapshot(): TaskAllocGateSnapshot {
    return snapshot;
  },
};

export function parseState(v: string | null | undefined): TaskAllocState | null {
  return v === 'enabled' || v === 'paused' || v === 'disabled' ? v : null;
}

/**
 * Хариу бүрийн толгойноос төлөвийг цуглуулна.  Төлөв `enabled` болсон бол хуучин `paused/disabled` блок цэвэрлэгдэнэ
 * (удирдлага идэвхжүүллээ — хэрэглэгч хуудсаа дахин ачаалахгүйгээр үргэлжлүүлнэ).
 */
export function observeGateHeaders(headers: Pick<Headers, 'get'>): void {
  let block = snapshot.block;
  // «Сервер хуучин» (клиент шинэ) — сервер бидний гэрээнд хүрсэн (≥) хариу өгсөн бол арилна.
  const serverContract = Number(headers.get(TASK_ALLOC_CONTRACT_HEADER));
  if (block && block.kind === 'server_older' && Number.isInteger(serverContract) && serverContract >= TASK_ALLOC_CONTRACT) block = null;
  const state = parseState(headers.get(TASK_ALLOC_STATE_HEADER));
  if (state === null) {
    if (block !== snapshot.block) update({ state: snapshot.state, block });
    return;
  }
  if (state === 'enabled' && block && (block.kind === 'paused' || block.kind === 'disabled' || block.kind === 'unconfigured')) {
    block = null;
  }
  update({ state, block });
}

const BLOCK_CODES: Record<string, GateBlockKind> = {
  TASK_ALLOC_PAUSED: 'paused',
  TASK_ALLOC_DISABLED: 'disabled',
  TASK_ALLOC_UNCONFIGURED: 'unconfigured',
};

/** 426/423 хариуг баннер болгоно.  Бусад статус/код → юу ч хийхгүй (false). */
export function observeGateBlock(status: number, payload: unknown): boolean {
  if (status !== 426 && status !== 423) return false;
  const p = (payload ?? {}) as { error?: unknown; message?: unknown; direction?: unknown; state?: unknown };
  const code = typeof p.error === 'string' ? p.error : '';
  const message = typeof p.message === 'string' ? p.message : '';
  let kind: GateBlockKind | null = null;
  if (status === 426 && code === 'CONTRACT_UPGRADE_REQUIRED') kind = p.direction === 'server_older' ? 'server_older' : 'client_older';
  else if (status === 423) kind = BLOCK_CODES[code] ?? null;
  if (kind === null) return false;
  const state = parseState(typeof p.state === 'string' ? p.state : null) ?? snapshot.state;
  update({ state, block: { kind, message, at: Date.now() } });
  return true;
}

export function dismissGateBlock(): void {
  // Хэрэглэгч баннерыг хаасан — хуучин «paused» түгжээг ч суллана; дараагийн бичилтийг сервер шийднэ.
  if (snapshot.block !== null || (snapshot.state !== null && snapshot.state !== 'enabled')) update({ state: null, block: null });
}

/** Бичих боломжтой эсэх (мэдэгдэхгүй бол «боломжтой» — шийдвэр серверийнх). */
export const isGateWritable = (s: TaskAllocGateSnapshot): boolean => s.state === null || s.state === 'enabled';

/**
 * Гэрээний толгойг ямар хүсэлтэд явуулах вэ.  Толгой нь cross-origin хүсэлтэд CORS preflight үүсгэдэг тул БҮХ хүсэлтэд
 * явуулбал шинэ Pages + хуучин Worker (rollback, эсвэл deploy-ийн завсар) үед ХУДАЛДАХ ЭЦСИЙН апп бүхэлдээ унана.
 * Сервер толгойг ЗӨВХӨН managed мутаци дээр шалгадаг (middleware/taskAllocGuard.ts), тиймээс яг тэдгээрт л явуулна:
 *   POST|PUT|PATCH|DELETE  /tasks/:id/allocation[/…]  /tasks/:id/claim  /tasks/alloc-admin/…  /task-timer/…
 * Унших (GET) хүсэлт, бусад бүх модуль толгойгүй — хуучин Worker-тэй ч ажиллана.
 */
const CONTRACT_PATHS = [
  /^\/tasks\/\d+\/allocation(?:\/|$)/,
  /^\/tasks\/\d+\/claim$/,
  /^\/tasks\/alloc-admin(?:\/|$)/,
  /^\/task-timer(?:\/|$)/,
];

export function needsAllocContractHeader(endpoint: string, method: string): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  const path = endpoint.split('?')[0] ?? endpoint;
  return CONTRACT_PATHS.some((re) => re.test(path));
}

/** Тестэд: store-ыг эхний төлөвт буцаана. */
export function resetTaskAllocGateForTests(ttlMs: number = LOCK_TTL_MS): void {
  clearLockTimer();
  lockTtlMs = ttlMs;
  snapshot = { state: null, block: null };
  emit();
}
