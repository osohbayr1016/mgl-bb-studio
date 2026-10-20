/**
 * ClientRoom — төсөл тус бүрийн WebSocket өрөө (Durable Object).
 *
 * Эзний шийдвэр (2026-09-07): захиалагчийн порталын өөрчлөлт нь polling биш,
 * ЖИНХЭНЭ realtime байх.  Тиймээс төсөл бүрд нэг DO өрөө:
 *
 *     env.CLIENT_ROOM.get(env.CLIENT_ROOM.idFromName('project:' + id))
 *
 * ⚠️ WebSocket бол зөвхөн ТЭЭВЭР.  Үнэн нь D1-ийн `client_events` хүснэгтэд
 *    байна.  Захиалагч офлайн байхад болсон өөрчлөлт алдагдаж болохгүй тул
 *    дахин холбогдоход `GET /api/client/events?since_id=` -ээр гүйцээж татна.
 *    Тиймээс энэ DO нь өөрөө ЮУ Ч ХАДГАЛАХГҮЙ — хадгалбал D1-тэй зөрөх
 *    хоёр дахь үнэн үүснэ.
 *
 * Hibernation API ашиглана (`state.acceptWebSocket`) — сул зогсож буй өрөө
 * санах ойгоос гарна, тиймээс 24 төсөл × хэдэн захиалагч байнга холбогдсон ч
 * төлбөр нь бараг тэг.  Энэ загварыг устгасан `backend/src/chat/ChatRoom.ts`
 * (git: 1186c80^) -оос авсан.
 *
 * Нэвтрэлтийг Worker давхарга АЛЬ ХЭДИЙН хийсэн байна: `/api/client/ws` нь
 * токеныг шалгаад, төслийн эрхийг `lib/clientAccess.ts`-ээр баталгаажуулаад
 * л энд дамжуулдаг.  DO нь толгойгоор ирсэн хэрэглэгчийг ИТГЭНЭ — гаднаас
 * шууд DO руу хандах зам байхгүй.
 */

interface AttachedSession {
  userId: number;
  role: string;
  name: string;
  projectId: number;
}

/** Захиалагч руу түлхэх мессежийн бүрхүүл. */
export interface ClientRoomEvent {
  id: number;
  project_id: number;
  kind: string;
  ref_id: number | null;
  title_mn: string;
  created_at: string;
}

const MAX_PAYLOAD_BYTES = 16_384;

export class ClientRoom {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/ws')) return this.upgrade(request);
    if (url.pathname.endsWith('/broadcast')) return this.broadcastFromWorker(request);
    if (url.pathname.endsWith('/stats')) {
      return Response.json({ sockets: this.state.getWebSockets().length });
    }
    return new Response('Not found', { status: 404 });
  }

  /* ---------------- WebSocket холболт ---------------- */

  private upgrade(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const session: AttachedSession = {
      userId: Number(request.headers.get('X-User-Id') ?? 0),
      role: request.headers.get('X-User-Role') ?? '',
      name: request.headers.get('X-User-Name') ?? '',
      projectId: Number(request.headers.get('X-Project-Id') ?? 0),
    };
    if (!session.userId || !session.projectId) {
      return new Response('Unauthorized', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.state.acceptWebSocket(server);
    server.serializeAttachment(session);

    // Клиент энэ мессежийг хүлээж аваад REST-ээр `since_id`-аас хойшхыг
    // гүйцээж татна — холболт тасарсан хугацааны өөрчлөлт алдагдахгүй.
    try {
      server.send(JSON.stringify({ type: 'hello', project_id: session.projectId }));
    } catch {
      /* сокет аль хэдийн хаагдсан бол алгасна */
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---------------- Worker-ээс ирэх түлхэлт ---------------- */

  private async broadcastFromWorker(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }
    const payload = JSON.stringify({ type: 'event', event: body });
    if (payload.length > MAX_PAYLOAD_BYTES) {
      return new Response('Payload too large', { status: 413 });
    }
    const sent = this.broadcast(payload);
    return Response.json({ ok: true, sent });
  }

  /* ---------------- Hibernation callbacks ---------------- */

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string') return;
    // Клиент энд ЮУ Ч бичихгүй — бүх бичилт REST-ээр явна (тэнд эрх, хязгаар,
    // бүртгэл бүгд бий).  Цорын ганц зөвшөөрөгдсөн зүйл нь холболтоо амьд
    // байлгах ping.
    let parsed: { type?: string } | null = null;
    try {
      parsed = JSON.parse(data) as { type?: string };
    } catch {
      return;
    }
    if (parsed?.type === 'ping') {
      try {
        ws.send(JSON.stringify({ type: 'pong' }));
      } catch {
        /* ignore */
      }
    }
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

  /* ---------------- Туслах ---------------- */

  private broadcast(payload: string): number {
    let sent = 0;
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
        sent += 1;
      } catch {
        /* hibernation-safe: илгээх алдааг залгина */
      }
    }
    return sent;
  }
}
