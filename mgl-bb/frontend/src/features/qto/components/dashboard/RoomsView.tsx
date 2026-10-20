import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Card, CardContent } from '@/ui/card';
import { fmtNum } from '../../lib/pivots';

import type { QtoDashboardRoomRow } from '../../lib/types';

/**
 * Өрөөний ведомость (0120) — давхараар бүлэглэсэн задаргаа. Интерьер заслын
 * төсөв (шал/хана/таазны өнгөлгөө) өрөөгөөр м²-ээр бодогддог тул давхар →
 * өрөө → талбай гэсэн мөчир. Toolbar-ийн хайлт (query) дугаар/нэр дээр шүүнэ.
 */
export function RoomsView({
  rooms,
  query,
  truncated,
}: {
  rooms: QtoDashboardRoomRow[];
  query: string;
  truncated: boolean;
}) {
  const { t } = useLanguage();
  const [openLevels, setOpenLevels] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rooms.filter(
          (r) =>
            r.number.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
        )
      : rooms;
    const byLevel = new Map<string, { rooms: QtoDashboardRoomRow[]; area: number }>();
    for (const r of filtered) {
      const key = r.level || t('qtoPage.noLevel');
      let g = byLevel.get(key);
      if (!g) {
        g = { rooms: [], area: 0 };
        byLevel.set(key, g);
      }
      g.rooms.push(r);
      g.area += r.area_m2 ?? 0;
    }
    return [...byLevel.entries()]
      .map(([level, g]) => ({ level, ...g }))
      .sort((a, b) => a.level.localeCompare(b.level, undefined, { numeric: true }));
  }, [rooms, query, t]);

  const totalArea = useMemo(
    () => groups.reduce((s, g) => s + g.area, 0),
    [groups],
  );
  const totalRooms = useMemo(
    () => groups.reduce((s, g) => s + g.rooms.length, 0),
    [groups],
  );

  const toggle = (level: string) => {
    setOpenLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  if (rooms.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t('qtoPage.roomsEmpty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-sm font-medium">
            {t('qtoPage.roomsTitle')}{' '}
            <span className="text-muted-foreground">({fmtNum(totalRooms, 0)})</span>
          </span>
          <span className="font-mono text-sm tabular-nums">
            {fmtNum(totalArea, 1)} {t('qtoPage.roomsAreaUnit')}
          </span>
        </div>

        <div className="divide-y">
          {groups.map((g) => {
            const isOpen = openLevels.has(g.level);
            return (
              <div key={g.level}>
                <button
                  type="button"
                  onClick={() => toggle(g.level)}
                  className="flex w-full items-center gap-2 py-2 text-left transition-colors hover:bg-muted/40"
                >
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                      isOpen && 'rotate-90',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {g.level}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtNum(g.rooms.length, 0)} {t('qtoPage.roomsCountUnit')}
                  </span>
                  <span className="w-28 shrink-0 text-right font-mono text-xs tabular-nums">
                    {fmtNum(g.area, 1)} {t('qtoPage.roomsAreaUnit')}
                  </span>
                </button>

                {isOpen && (
                  <div className="mb-1.5 space-y-0.5 pl-12 pr-2">
                    {g.rooms.map((r, i) => (
                      <div
                        key={`${r.run_id}-${r.number}-${i}`}
                        className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-2 text-xs"
                      >
                        <span className="font-mono text-muted-foreground">
                          {r.number || '—'}
                        </span>
                        <span className="truncate">{r.name || '—'}</span>
                        <span className="font-mono tabular-nums">
                          {fmtNum(r.area_m2, 1)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {truncated && (
          <p className="mt-3 text-xs text-warning-foreground">
            {t('qtoPage.roomsTruncated')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
