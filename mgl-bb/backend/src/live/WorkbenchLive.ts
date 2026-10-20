/**
 * WorkbenchLive — System Workbench-ийн амьд урсгалын ГАНЦ өрөө (Durable Object,
 * `idFromName('workbench:live')`).
 *
 *   isolate-ууд ──POST /ingest (≤1/сек багц, үзэгчгүй үед ≤1/10 сек probe)──▶ DO
 *   DO ──WebSocket broadcast──▶ админы хуудас(ууд)
 *
 * ⚠️ Зөвхөн ТЭЭВЭР, ЮУ Ч ХАДГАЛАХГҮЙ (storage бичилт 0).  Сүүлийн `RING` үйл
 *    явдал санах ойд л — шинээр холбогдсон хуудсанд «hello»-оор өгнө; DO
 *    hibernation-оор санах ойгоос гарвал хоосроно, энэ нь зөв (түүх биш, амьд
 *    харагдац).
 * ⚠️ Нэвтрэлтийг Worker хийсэн (`routes/devWorkbench.ts` `/workbench-live`) —
 *    DO руу гаднаас шууд хандах зам байхгүй.
 *
 * Hibernation API + `setWebSocketAutoResponse('ping'→'pong')` — клиентийн
 * keep-alive DO-г СЭРЭЭХГҮЙ.
 */

const RING = 200;
const MAX_INGEST_EVENTS = 200;
const ISOLATE_TTL_MS = 60_000;

export class WorkbenchLive {
  private readonly state: DurableObjectState;
  private ring: unknown[] = [];
  private isolates = new Map<string, number>();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') return this.upgrade(request);
    if (url.pathname === '/ingest' && request.method === 'POST') return this.ingest(request);
    return new Response('Not found', { status: 404 });
  }

  private liveIsolates(now: number): number {
    for (const [id, seen] of this.isolates) {
      if (now - seen > ISOLATE_TTL_MS) this.isolates.delete(id);
    }
    return this.isolates.size;
  }

  private upgrade(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }
    if (!request.headers.get('X-Live-User')) return new Response('Unauthorized', { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    const now = Date.now();
    try {
      server.send(
        JSON.stringify({
          type: 'hello',
          now,
          recent: this.ring,
          isolates: this.liveIsolates(now),
          watchers: this.state.getWebSockets().length,
        }),
      );
    } catch {
      /* аль хэдийн хаагдсан */
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private async ingest(request: Request): Promise<Response> {
    let body: { iso?: unknown; events?: unknown } | null = null;
    try {
      body = (await request.json()) as { iso?: unknown; events?: unknown };
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }
    const events = Array.isArray(body?.events) ? body.events.slice(-MAX_INGEST_EVENTS) : [];
    const iso = typeof body?.iso === 'string' ? body.iso.slice(0, 12) : '';
    const now = Date.now();
    if (iso) this.isolates.set(iso, now);

    const sockets = this.state.getWebSockets();
    if (events.length > 0) {
      this.ring.push(...events);
      if (this.ring.length > RING) this.ring.splice(0, this.ring.length - RING);
    }
    if (sockets.length > 0 && events.length > 0) {
      const payload = JSON.stringify({
        type: 'events',
        now,
        iso,
        isolates: this.liveIsolates(now),
        watchers: sockets.length,
        events,
      });
      for (const ws of sockets) {
        try {
          ws.send(payload);
        } catch {
          /* хаагдсан сокет — hibernation өөрөө цэвэрлэнэ */
        }
      }
    }
    return Response.json({ watchers: sockets.length });
  }

  async webSocketMessage(): Promise<void> {
    // Клиент юу ч бичихгүй ('ping' нь auto-response-оор DO-г сэрээлгүй хариулагдана).
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}
