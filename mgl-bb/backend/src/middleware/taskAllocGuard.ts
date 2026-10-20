/**
 * Таскийн хуваарилалтын хаалга — Hono давхарга (цэвэр дүрэм: `lib/taskAllocGate.ts`).
 *
 *   • `taskAllocContract`     — router бүхэлд: корреляцийн ID + гэрээний толгойнууд; НЭВТРЭЛТ шаардагдахгүй биш
 *                               (authMiddleware аль хэдийн ажилласан).  GET-д толгой л нэмнэ; POST/PUT/PATCH/DELETE-д
 *                               426/423-ыг ХЭРЭГЖҮҮЛНЭ.
 *   • `enforceManagedTaskWrite` — managed БИШ таск руу чиглэсэн мутацийг (хуучин зам) ХӨНДӨХГҮЙ, managed таскийнхыг
 *                               ижил хаалгаар (timer start/void/restore, claim).
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { AppVariables, Env } from '../types';
import {
  TASK_ALLOC_CONTRACT,
  TASK_ALLOC_CONTRACT_HEADER,
  contractHeaders,
  convertedPartBody,
  decideManagedWrite,
  isManagedTask,
  loadGate,
  parseClientContract,
  retiredIntoRoot,
  verdictBody,
  verdictHeaders,
} from '../lib/taskAllocGate';
import { correlationIdOf, logTaskAlloc } from '../lib/taskAllocLog';

type Ctx = { Bindings: Env; Variables: AppVariables };

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const taskAllocContract: MiddlewareHandler<Ctx> = async (c, next) => {
  const correlation = correlationIdOf(c.req.header('X-Request-Id'));
  const gate = await loadGate(c.env.DB);
  c.set('allocCorrelationId', correlation);
  c.set('allocState', gate.state);
  if (!READ_METHODS.has(c.req.method)) {
    const client = parseClientContract(c.req.header(TASK_ALLOC_CONTRACT_HEADER));
    const verdict = decideManagedWrite(gate, client);
    if (!verdict.ok) {
      logTaskAlloc({
        evt: 'gate_block',
        op: `${c.req.method} ${c.req.path.replace(/\d+/g, ':n')}`,
        correlation_id: correlation,
        actor_id: (c.get('user') as { sub?: number } | undefined)?.sub ?? null,
        contract: TASK_ALLOC_CONTRACT,
        client_contract: client.kind === 'ok' ? String(client.version) : client.kind === 'invalid' ? client.raw : null,
        state: gate.state,
        result: 'fail',
        status: verdict.status,
        code: verdict.code,
      });
      return c.json(verdictBody(verdict), verdict.status, { ...verdictHeaders(verdict, gate.state), 'X-Request-Id': correlation });
    }
  }
  await next();
  for (const [k, v] of Object.entries(contractHeaders(gate.state))) c.res.headers.set(k, v);
  c.res.headers.set('X-Request-Id', correlation);
};

/**
 * Managed таск руу чиглэсэн ГАНЦ бичих үйлдэл (timer start, claim, session void/restore) — managed БИШ таскт `null`
 * (хуучин зан төлөв хэвээр).  Блоклосон бол бэлэн `Response` буцаана.
 */
export async function enforceManagedTaskWrite(c: Context<Ctx>, taskId: number): Promise<Response | null> {
  // Нэгтгэгдсэн хэсэг (хөрвүүлэлт, 0385): идэвхжүүлэлтийн төлөвөөс үл хамааран хаалттай — root руу чиглүүлнэ.
  const into = await retiredIntoRoot(c.env.DB, taskId);
  if (into !== null) return c.json(convertedPartBody(taskId, null, into), 409, contractHeaders());
  if (!(await isManagedTask(c.env.DB, taskId))) return null;
  const gate = await loadGate(c.env.DB);
  const client = parseClientContract(c.req.header(TASK_ALLOC_CONTRACT_HEADER));
  const verdict = decideManagedWrite(gate, client);
  if (verdict.ok) return null;
  logTaskAlloc({
    evt: 'gate_block',
    op: `${c.req.method} ${c.req.path.replace(/\d+/g, ':n')}`,
    correlation_id: correlationIdOf(c.req.header('X-Request-Id')),
    task_id: taskId,
    actor_id: (c.get('user') as { sub?: number } | undefined)?.sub ?? null,
    contract: TASK_ALLOC_CONTRACT,
    client_contract: client.kind === 'ok' ? String(client.version) : client.kind === 'invalid' ? client.raw : null,
    state: gate.state,
    result: 'fail',
    status: verdict.status,
    code: verdict.code,
  });
  return c.json(verdictBody(verdict), verdict.status, verdictHeaders(verdict, gate.state));
}
