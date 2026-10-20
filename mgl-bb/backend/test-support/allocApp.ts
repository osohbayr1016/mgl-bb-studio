// Таскийн хуваарилалтын HTTP тестийн ЦАГ: бодит Hono router-ууд + бодит миграц (allocHarness) дээр `app.request()`.
// Шинэ тестүүд (gate, admin, reweight, conversion, audit) энэ ганц туслахыг хуваалцана.
import { Hono } from 'hono';
import { actorOf, type makeDb } from './allocHarness.ts';

export const CONTRACT_HEADER = 'x-task-alloc-contract';

export interface Reply {
  status: number;
  json: any;
  headers: Headers;
}

export async function makeApp(h: ReturnType<typeof makeDb>) {
  const taskAllocations = (await import('../src/routes/taskAllocations.ts')).default;
  const taskAllocAdmin = (await import('../src/routes/taskAllocAdmin.ts')).default;
  const tasksRoute = (await import('../src/routes/tasks.ts')).default;
  const taskTimerRoute = (await import('../src/routes/taskTimer.ts')).default;
  const progressRoute = (await import('../src/routes/progress.ts')).default;
  const componentsRoute = (await import('../src/routes/components.ts')).default;
  const drawingsRoute = (await import('../src/routes/drawings.ts')).default;
  const blocksRoute = (await import('../src/routes/blocks.ts')).default;

  const env = { DB: h.d1 } as unknown as Record<string, unknown>;
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/tasks', taskAllocAdmin as never);
  app.route('/api/tasks', taskAllocations as never);
  app.route('/api/tasks', tasksRoute as never);
  app.route('/api/task-timer', taskTimerRoute as never);
  app.route('/api/progress', progressRoute as never);
  app.route('/api/components', componentsRoute as never);
  app.route('/api/drawings', drawingsRoute as never);
  app.route('/api/blocks', blocksRoute as never);
  const exec = { waitUntil: () => undefined, passThroughOnException: () => undefined };

  /** `contract`: undefined → '1' (одоогийн клиент); null → толгой илгээхгүй (хуучин клиент); string → яг тэр утга. */
  const call = async (
    userId: number,
    method: string,
    path: string,
    body?: unknown,
    opts: { contract?: string | null; headers?: Record<string, string> } = {},
  ): Promise<Reply> => {
    const contract = opts.contract === undefined ? '1' : opts.contract;
    const res = await app.request(
      `http://x${path}`,
      {
        method,
        headers: {
          'x-test-user': JSON.stringify(actorOf(userId)),
          ...(contract !== null ? { [CONTRACT_HEADER]: contract } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(opts.headers ?? {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      env as never,
      exec as never,
    );
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  };
  return { app, req: call };
}
