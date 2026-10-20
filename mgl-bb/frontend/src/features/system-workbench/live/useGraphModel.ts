import { useEffect, useMemo, useRef, useState } from 'react';
import { WORKBENCH_NODES } from '../topology';
import type { GraphNode, LiveGraphHandle } from '../components/LiveGraph';
import { computeLayout } from './layout';
import { domainFor, eventRoute } from './routeMap';
import type { LiveSnapshot, useLiveTraffic } from './useLiveTraffic';

/**
 * Амьд графын загвар — System Workbench хуудас ба компанийн TV-ийн «Систем»
 * кадр ХОЁУЛАА энийг хэрэглэнэ (нэг дүрэм, хоёр харагдац).
 *
 *   • topology + амьд урсгалд гарсан танигдаагүй route-ууд (`route:` динамик зангилаа)
 *   • ирсэн багц бүрийг анхны цагийн зайг нь хадгалан бөөм болгож тоглуулна
 *   • зангилаа тус бүрийн 60 секундын хүсэлтийн тоо (секунд тутам)
 */

const MAX_DYNAMIC = 14;

type Live = Pick<ReturnType<typeof useLiveTraffic>, 'subscribe' | 'getWindow'> & { snapshot: LiveSnapshot };

export function useGraphModel(live: Live) {
  const graph = useRef<LiveGraphHandle>(null);
  const [dynamicIds, setDynamicIds] = useState<string[]>([]);
  const dynamicRef = useRef<string[]>([]);
  const { subscribe, getWindow, snapshot } = live;

  const positions = useMemo(() => computeLayout(dynamicIds), [dynamicIds]);

  const nodes = useMemo<GraphNode[]>(
    () => [
      ...WORKBENCH_NODES.map((n) => ({ id: n.id, label: n.label, subtitle: n.subtitle, kind: n.kind })),
      ...dynamicIds.map((id) => ({
        id,
        label: id.replace(/^route:/, ''),
        subtitle: 'unmapped route',
        kind: 'domain' as const,
        dynamic: true,
      })),
    ],
    [dynamicIds],
  );

  /** Ирсэн багцыг графаар тоглуулна — анхны цагийн зайг хадгалан тараана. */
  useEffect(
    () =>
      subscribe((events) => {
        const base = events[0]?.t ?? 0;
        const fresh: string[] = [];
        for (const ev of events) {
          const domain = domainFor(ev);
          if (domain?.startsWith('route:') && !dynamicRef.current.includes(domain) && !fresh.includes(domain)) {
            if (dynamicRef.current.length + fresh.length < MAX_DYNAMIC) fresh.push(domain);
          }
          const delay = Math.min(1200, Math.max(0, ev.t - base));
          // Шинэ динамик зангилаа байрлалаа авсны дараа тоглоно.
          graph.current?.play(ev, domain ?? '', fresh.length ? delay + 60 : delay);
        }
        if (fresh.length) {
          dynamicRef.current = [...dynamicRef.current, ...fresh];
          setDynamicIds(dynamicRef.current);
        }
      }),
    [subscribe],
  );

  /** Зангилаа тус бүрийн 60 секундын хүсэлт — секунд тутам нэг удаа. */
  const hits = useMemo(() => {
    const out = new Map<string, number>();
    const since = Date.now() - 60_000;
    const w = getWindow();
    for (let i = w.length - 1; i >= 0; i--) {
      const ev = w[i]!;
      if (ev.t < since) break;
      for (const id of new Set(eventRoute(ev, domainFor(ev) ?? ''))) out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
    // `snapshot` нь секунд тутмын tick — цонх ref учраас түүгээр дахин тооцно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, getWindow]);

  return { graph, nodes, positions, hits };
}
