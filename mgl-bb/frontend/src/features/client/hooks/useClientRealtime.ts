import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { resolveApiHost } from '@/shared/api/apiHost';
import { fetchEventsSince, type ClientEvent } from '../portalApi';

/**
 * Захиалагчийн порталын РЕАЛТАЙМ суваг.
 *
 * ⚠️ WebSocket бол зөвхөн ТЭЭВЭР.  Үнэн нь сервер талын `client_events`
 *    хүснэгтэд.  Тиймээс:
 *      • холбогдох бүрд `since_id`-аас хойшхыг REST-ээр ГҮЙЦЭЭЖ татна,
 *      • сокет тасарсан хугацааны өөрчлөлт алдагдахгүй,
 *      • сокет огт холбогдохгүй байсан ч (корпорацийн proxy WebSocket-ийг
 *        хаадаг нь элбэг) портал ажилласаар байна — зөвхөн шинэчлэлт нь
 *        хуудас нээх мөчид ирнэ.
 *
 * Дахин холболт нь экспоненциал ухралттай (1с → 30с).  Хуудас нуугдсан үед
 * шинээр холбохыг оролдохгүй — таб идэвхжихэд л сэргэнэ.
 *
 * 2026-09-23: (1) үйл явдлыг `id`-аар ДАВХАРДАЛГҮЙ нэгтгэнэ — REST гүйцээлт
 *    ба сокетын мессеж давхцах, эсвэл эхний татлага хоёр удаа ирэх үед
 *    «Сүүлийн шинэчлэлт»-д ижил мөр давтагддаг байв (dev StrictMode дээр
 *    8 үйл явдал 16 болж харагдсан).  (2) `closed` туг + сокет нь effect-ийн
 *    ӨӨРИЙН хувьсагч — өмнө нь ref байсан тул хуучин effect-ийн хүлээгдэж буй
 *    татлага шинэ effect-ийн `false` утгыг харж хоёр дахь сокет нээдэг байв.
 */

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;
const KEEP = 100;

export interface ClientRealtimeState {
  connected: boolean;
  /** Энэ сесс дэх сүүлийн 100 өөрчлөлт (id өсөх дарааллаар — хамгийн шинэ нь төгсгөлд). */
  events: ClientEvent[];
}

/** id-аар давхардалгүй нэгтгэж, өсөх дарааллаар сүүлийн `KEEP`-ийг үлдээнэ. */
function mergeEvents(prev: ClientEvent[], incoming: ClientEvent[]): ClientEvent[] {
  const byId = new Map<number, ClientEvent>();
  for (const e of prev) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-KEEP);
}

export function useClientRealtime(projectId: number | null): ClientRealtimeState {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<ClientEvent[]>([]);
  const lastIdRef = useRef(0);

  useEffect(() => {
    if (projectId == null) return;

    // Энэ effect-ийн ӨӨРИЙН төлөв — цэвэрлэгдсэний дараа ирэх хариу, мессеж,
    // дахин холболт юу ч хийхгүй.
    let closed = false;
    let socket: WebSocket | null = null;
    lastIdRef.current = 0;
    // ⚠️ Энд `setEvents([])` дуудахгүй (`react-hooks/set-state-in-effect`).
    //    Шаардлагагүй ч: дуудагч `ClientProjectRoom` нь `key={project.id}`-тэй
    //    тул төсөл солиход бүхэлдээ дахин mount хийгдэж, төлөв аль хэдийн
    //    хоосон эхэлнэ.

    let backoff = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: [`/client/projects/${projectId}/materials`] });
      void qc.invalidateQueries({ queryKey: [`/client/submissions?project_id=${projectId}`] });
      void qc.invalidateQueries({ queryKey: ['/client/projects'] });
      // Нээсэн Drive баримт (0327) — `document` үйл явдал; түлхүүр нь
      // features/projects/drive/api.ts-ийн `['project-drive', 'client', id, …]`.
      void qc.invalidateQueries({ queryKey: ['project-drive', 'client', projectId] });
      // Гарын үсгийн хүсэлт/зурсан (`signature` үйл явдал) — тоймын «Таны
      // анхаарал» самбар ба навигацын тоолуур (ClientDashboardPage).
      void qc.invalidateQueries({ queryKey: ['/correspondence/projects', projectId] });
      // Тайлан гарах/нийтлэгдэх — «Материал» хэсгийн тайлангийн жагсаалт.
      void qc.invalidateQueries({ queryKey: ['/projects', projectId, 'performance-reports'] });
    };

    /** Сокет тасарсан хугацаанд болсон бүхнийг гүйцээж татна. */
    const catchUp = async () => {
      try {
        const res = await fetchEventsSince(projectId, lastIdRef.current);
        if (closed) return;
        if (res.events.length > 0) {
          lastIdRef.current = Math.max(lastIdRef.current, res.last_id);
          setEvents((prev) => mergeEvents(prev, res.events));
          invalidate();
        } else if (lastIdRef.current === 0) {
          lastIdRef.current = res.last_id;
        }
      } catch {
        /* сүлжээний алдаа — дараагийн холболт дээр дахин оролдоно */
      }
    };

    const connect = () => {
      if (closed) return;
      if (typeof document !== 'undefined' && document.hidden) {
        reconnectTimer = setTimeout(connect, 5000);
        return;
      }

      const token = localStorage.getItem('auth_token') ?? '';
      const wsBase = resolveApiHost().replace(/^http/, 'ws');
      const url = `${wsBase}/api/client/ws?project_id=${projectId}${
        token ? `&t=${encodeURIComponent(token)}` : ''
      }`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        return;
      }
      socket = ws;

      ws.onopen = () => {
        if (closed) return;
        backoff = 1000;
        setConnected(true);
        void catchUp();
        pingTimer = setInterval(() => {
          try {
            ws.send(JSON.stringify({ type: 'ping' }));
          } catch {
            /* хаагдсан сокет */
          }
        }, PING_MS);
      };

      ws.onmessage = (ev) => {
        if (closed) return;
        let msg: { type?: string; event?: ClientEvent } | null = null;
        try {
          msg = JSON.parse(String(ev.data)) as { type?: string; event?: ClientEvent };
        } catch {
          return;
        }
        if (msg?.type !== 'event' || !msg.event) return;
        const incoming = msg.event;
        lastIdRef.current = Math.max(lastIdRef.current, incoming.id);
        setEvents((prev) => mergeEvents(prev, [incoming]));
        invalidate();
      };

      const scheduleReconnect = () => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        // Цэвэрлэгдсэн effect-ийн сокет хаагдах нь шинэ effect-ийн «холбогдсон»
        // төлөвийг ДАРАХ ёсгүй.
        if (closed) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };

      ws.onclose = scheduleReconnect;
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    };

    // Эхний ачаалалт дээр урсгалын байрлалыг тогтооно, дараа нь холбоно.
    void catchUp().then(connect);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
      setConnected(false);
    };
  }, [projectId, qc]);

  // ⚠️ `lastIdRef.current`-ийг ЭНД буцаахгүй: ref-ийг рендерийн үед унших нь
  //    `react-hooks/refs`-ийн алдаа бөгөөд утга нь дахин рендер төрүүлдэггүй
  //    учир хэрэглэгчид ХУДАЛ мэдээлэл өгнө.  Урсгалын байрлал зөвхөн энэ
  //    hook-ийн дотоод хэрэг.
  return { connected, events };
}
