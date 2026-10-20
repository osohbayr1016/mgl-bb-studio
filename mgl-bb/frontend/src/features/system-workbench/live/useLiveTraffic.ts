import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveApiHost } from '@/shared/api/apiHost';
import type { LiveEvent } from './routeMap';

/**
 * System Workbench-ийн амьд суваг — `GET /api/mgl-ai/workbench-live` WebSocket.
 *
 * Зардлын дүрэм: таб далд болмогц `HIDDEN_CLOSE_MS`-ийн дараа сокетыг ХААНА —
 * DO үзэгчгүй болж, isolate-ууд урсгал түлхэхээ болино (backend `lib/liveTraffic.ts`).
 * Буцаж харагдахад дахин холбогдоно.  Keep-alive нь `'ping'` тэмдэгт мөр —
 * DO auto-response-оор DO-г сэрээлгүй хариулна.
 */

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'sleeping' | 'denied';

export interface LiveSnapshot {
  /** Сүүлийн 60 секундын тоо. */
  rpm: number;
  qpm: number;
  readPm: number;
  writePm: number;
  errorsPm: number;
  p95: number;
  cacheHitPct: number;
  /** Сүүлийн 60 секунд, секунд тутмын хүсэлт / D1 query. */
  series: number[];
  dbSeries: number[];
  isolates: number;
  watchers: number;
  colos: string[];
  total: number;
}

const WINDOW_MS = 5 * 60_000;
const WINDOW_CAP = 5000;
const FEED_CAP = 160;
const PING_MS = 25_000;
const HIDDEN_CLOSE_MS = 20_000;
const MAX_BACKOFF = 30_000;

const EMPTY: LiveSnapshot = {
  rpm: 0, qpm: 0, readPm: 0, writePm: 0, errorsPm: 0, p95: 0, cacheHitPct: 0,
  series: new Array(60).fill(0), dbSeries: new Array(60).fill(0),
  isolates: 0, watchers: 0, colos: [], total: 0,
};

type Listener = (events: LiveEvent[]) => void;

function isLiveEvent(x: unknown): x is LiveEvent {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return typeof e.t === 'number' && typeof e.p === 'string' && typeof e.s === 'number';
}

function summarize(events: LiveEvent[], now: number, meta: { isolates: number; watchers: number; total: number }): LiveSnapshot {
  const since = now - 60_000;
  const series = new Array<number>(60).fill(0);
  const dbSeries = new Array<number>(60).fill(0);
  let rpm = 0, qpm = 0, readPm = 0, writePm = 0, errorsPm = 0, cache = 0, cacheable = 0;
  const durations: number[] = [];
  const colos = new Set<string>();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.t < since) break;
    rpm++;
    qpm += e.q;
    readPm += e.r;
    writePm += e.w;
    if (e.s >= 500 || (e.s >= 400 && e.s !== 401 && e.s !== 404)) errorsPm++;
    if (e.k === 'http' && !e.p.startsWith('/media/')) {
      cacheable++;
      if (e.ch === 'MEM' || e.ch === 'HIT') cache++;
    }
    durations.push(e.ms);
    if (e.c) colos.add(e.c);
    const bucket = 59 - Math.min(59, Math.floor((now - e.t) / 1000));
    series[bucket]! += 1;
    dbSeries[bucket]! += e.q;
  }
  durations.sort((a, b) => a - b);
  const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]! : 0;
  return {
    rpm, qpm, readPm, writePm, errorsPm, p95,
    cacheHitPct: cacheable ? Math.round((cache / cacheable) * 100) : 0,
    series, dbSeries, colos: [...colos].sort(), ...meta,
  };
}

export interface LiveTrafficOptions {
  /**
   * Холбогдох үед DO-ийн «hello»-оор ирсэн сүүлийн N хүсэлтийг графаар шууд
   * тоглуулна (≈120 мс зайтай) — богино хугацаанд нээгддэг харагдац (TV-ийн кадр)
   * эхний секундуудад хоосон харагдахгүй.  0 = тоглуулахгүй (хуудасны өгөгдмөл).
   */
  replayRecent?: number;
}

export function useLiveTraffic(paused: boolean, options: LiveTrafficOptions = {}) {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(EMPTY);
  const windowRef = useRef<LiveEvent[]>([]);
  const listeners = useRef(new Set<Listener>());
  const meta = useRef({ isolates: 0, watchers: 0, total: 0 });
  const pausedRef = useRef(paused);
  const replayRef = useRef(options.replayRecent ?? 0);
  useEffect(() => {
    pausedRef.current = paused;
    replayRef.current = options.replayRecent ?? 0;
  }, [paused, options.replayRecent]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  /** Цонхны үйл явдлууд (inspector-д). */
  const getWindow = useCallback(() => windowRef.current, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;
    let backoff = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const ingest = (events: LiveEvent[], animate: boolean) => {
      if (!events.length) return;
      const now = Date.now();
      const w = windowRef.current;
      w.push(...events);
      const cutoff = now - WINDOW_MS;
      let drop = 0;
      while (drop < w.length && w[drop]!.t < cutoff) drop++;
      if (w.length - drop > WINDOW_CAP) drop = w.length - WINDOW_CAP;
      if (drop) w.splice(0, drop);
      meta.current.total += events.length;
      if (pausedRef.current) return;
      setFeed((prev) => [...events.slice().reverse(), ...prev].slice(0, FEED_CAP));
      if (animate) for (const fn of listeners.current) fn(events);
    };

    const stopPing = () => {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
    };

    const connect = () => {
      if (closed || socket) return;
      if (document.hidden) {
        setStatus('sleeping');
        return;
      }
      const token = localStorage.getItem('auth_token') ?? '';
      const url = `${resolveApiHost().replace(/^http/, 'ws')}/api/mgl-ai/workbench-live${token ? `?t=${encodeURIComponent(token)}` : ''}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        schedule();
        return;
      }
      socket = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        backoff = 1000;
        setStatus('live');
        pingTimer = setInterval(() => {
          try {
            ws.send('ping');
          } catch {
            /* хаагдсан */
          }
        }, PING_MS);
      };
      ws.onmessage = (msg) => {
        if (typeof msg.data !== 'string' || msg.data === 'pong') return;
        let data: { type?: string; events?: unknown; recent?: unknown; isolates?: unknown; watchers?: unknown };
        try {
          data = JSON.parse(msg.data) as typeof data;
        } catch {
          return;
        }
        if (typeof data.isolates === 'number') meta.current.isolates = data.isolates;
        if (typeof data.watchers === 'number') meta.current.watchers = data.watchers;
        if (data.type === 'hello' && Array.isArray(data.recent)) {
          const fresh = data.recent.filter(isLiveEvent).filter((e) => e.t > Date.now() - WINDOW_MS);
          ingest(fresh, false);
          const replay = replayRef.current;
          if (replay > 0 && fresh.length && !pausedRef.current) {
            // Хуулбар л — цонх/статистикт хоёр дахин орохгүй, зөвхөн бөөм.
            const tail = fresh.slice(-replay);
            const start = Date.now();
            const staged = tail.map((e, i) => ({ ...e, t: start + i * 120 }));
            for (const fn of listeners.current) fn(staged);
          }
        } else if (data.type === 'events' && Array.isArray(data.events)) {
          ingest(data.events.filter(isLiveEvent).sort((a, b) => a.t - b.t), true);
        }
      };
      ws.onclose = (ev) => {
        stopPing();
        socket = null;
        if (closed) return;
        // Гар барилт 401/403-аар унавал браузер 1006 өгдөг — нээгдээгүй + олон
        // удаа унавал «эрхгүй» гэж үзэж хойшлуулалтыг дээд хэмжээнд хүргэнэ.
        if (!opened && backoff >= 8000) setStatus('denied');
        if (document.hidden) {
          setStatus('sleeping');
          return;
        }
        if (ev.code !== 1000 || opened) schedule();
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    };

    function schedule() {
      if (closed) return;
      setStatus((s) => (s === 'denied' ? s : 'reconnecting'));
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }

    const onVisibility = () => {
      if (document.hidden) {
        if (hiddenTimer) clearTimeout(hiddenTimer);
        hiddenTimer = setTimeout(() => {
          setStatus('sleeping');
          stopPing();
          try {
            socket?.close(1000, 'hidden');
          } catch {
            /* ignore */
          }
          socket = null;
        }, HIDDEN_CLOSE_MS);
      } else {
        if (hiddenTimer) clearTimeout(hiddenTimer);
        hiddenTimer = null;
        if (!socket) {
          backoff = 1000;
          setStatus('connecting');
          connect();
        }
      }
    };

    connect();
    document.addEventListener('visibilitychange', onVisibility);
    const tick = setInterval(() => {
      if (!document.hidden) setSnapshot(summarize(windowRef.current, Date.now(), meta.current));
    }, 1000);

    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(tick);
      stopPing();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      try {
        socket?.close(1000, 'unmount');
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { status, feed, snapshot, subscribe, getWindow };
}
