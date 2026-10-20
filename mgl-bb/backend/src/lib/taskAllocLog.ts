/**
 * ТАСКИЙН ХУВААРИЛТЫН БҮТЭЦТЭЙ ЛОГ (2026-10-05) — `wrangler tail` / Logpush-д ЯГ НЭГ JSON мөр.
 *
 * Зарчим: ИДЕНТИФАЙЕР л (task, allocation, actor, revision, request_id, код).  Нэр, тайлбар, дуусгах асуултын хариулт,
 * зургийн холбоос, токен, имэйл ХЭЗЭЭ Ч орохгүй — `sanitize` нь зөвшөөрөгдсөн түлхүүрүүдийг л авч, мөр бүрийг бүхэл,
 * богино утга болгоно.  Мутаци бүрийн үр дүн (амжилт, replay, татгалзал) болон хаалганы татгалзал (423/426) энд.
 *
 * Корреляцийн ID: `X-Request-Id` (клиентийн, `[A-Za-z0-9._-]{8,64}`) эсвэл серверийн UUID — хариуны ижил толгойд буцна.
 */

export type AllocLogEvent =
  | 'op' // managed мутаци (split/progress/release/retake/correct/restore)
  | 'gate_block' // 423/426
  | 'state_change' // идэвхжүүлэлтийн төлөв
  | 'conversion' // хуучин өгөгдлийн хөрвүүлэлт
  | 'reweight' // жингийн дараах оноо дахин тооцоо
  | 'audit' // инвариант аудит
  | 'post_commit'; // commit-ийн дараах үр дагавар

export interface AllocLogFields {
  evt: AllocLogEvent;
  op?: string;
  correlation_id?: string | null;
  task_id?: number | null;
  allocation_id?: number | null;
  actor_id?: number | null;
  owner_id?: number | null;
  project_id?: number | null;
  rev_before?: number | null;
  rev_after?: number | null;
  contract?: number;
  client_contract?: string | null;
  state?: string;
  request_id?: string | null;
  conversion_id?: string | null;
  result?: 'ok' | 'replayed' | 'fail';
  code?: string | null;
  status?: number | null;
  ms?: number | null;
  count?: number | null;
}

const ALLOWED = new Set<string>([
  'evt', 'op', 'correlation_id', 'task_id', 'allocation_id', 'actor_id', 'owner_id', 'project_id', 'rev_before',
  'rev_after', 'contract', 'client_contract', 'state', 'request_id', 'conversion_id', 'result', 'code', 'status', 'ms',
  'count',
]);

/** Зөвшөөрөгдсөн түлхүүрүүд л, утга нь бүхэл тоо / ≤ 80 тэмдэгт мөр / null. */
export function sanitizeLogFields(f: AllocLogFields): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(f as unknown as Record<string, unknown>)) {
    if (!ALLOWED.has(k) || v === undefined) continue;
    if (v === null) out[k] = null;
    else if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : null;
    else if (typeof v === 'string') out[k] = v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80);
  }
  return out;
}

export type LogSink = (line: string) => void;
let sink: LogSink = (line) => console.log(line);

/** Тестэд лог барих. */
export function setAllocLogSink(next: LogSink | null): void {
  sink = next ?? ((line) => console.log(line));
}

export function logTaskAlloc(fields: AllocLogFields): void {
  try {
    sink(JSON.stringify({ svc: 'task-alloc', ...sanitizeLogFields(fields) }));
  } catch {
    // Лог хэзээ ч мутацийг унагаахгүй.
  }
}

const CORRELATION_RE = /^[A-Za-z0-9._-]{8,64}$/;

export function correlationIdOf(header: string | null | undefined): string {
  return header && CORRELATION_RE.test(header) ? header : crypto.randomUUID();
}

/** Мутацийн үр дүнгийн ЦЭВЭР тайлан (route + тестэд). */
export function opResultFields(r: {
  ok: boolean;
  replayed?: boolean;
  status?: number;
  code?: string;
  revisionAfter?: number | null;
}): Pick<AllocLogFields, 'result' | 'status' | 'code' | 'rev_after'> {
  if (r.ok) return { result: r.replayed ? 'replayed' : 'ok', status: 200, code: null, rev_after: r.revisionAfter ?? null };
  return { result: 'fail', status: r.status ?? null, code: r.code ?? null, rev_after: null };
}
