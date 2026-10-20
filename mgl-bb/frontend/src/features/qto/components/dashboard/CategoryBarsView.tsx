import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Card, CardContent } from '@/ui/card';

import { fmtNum } from '../../lib/pivots';
import { TypeMarkBadge } from './CategoryCard';
import type { DashViewCard } from './CategoryCard';

const EXPANDED_TYPES = 10;

/**
 * Bars view — категориудын жагссан баарууд; мөр дарахад тухайн категорийн
 * топ-10 төрөл доор нь нимгэн баараар дэлгэгдэнэ (баарууд категори дотроо
 * масштаблагдана). Өнгө зөвхөн баар/icon дээр — тоо үргэлж text token.
 */
export function CategoryBarsView({ cards }: { cards: DashViewCard[] }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<Set<string>>(new Set());

  const maxCount = cards.reduce((m, c) => Math.max(m, c.cat.count), 0);
  const totalCount = cards.reduce((s, c) => s + c.cat.count, 0);

  const toggle = (key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <div className="space-y-0.5">
          {cards.map(({ cat, types }) => {
            const isOpen = open.has(cat.key);
            const share =
              totalCount > 0
                ? ((cat.count / totalCount) * 100).toLocaleString('en-US', {
                    maximumFractionDigits: 1,
                  })
                : '0';
            const shown = types.slice(0, EXPANDED_TYPES);
            const maxTypeCount = shown.reduce((m, tp) => Math.max(m, tp.count), 0);
            const { Icon } = cat;
            return (
              <div key={cat.key}>
                <button
                  type="button"
                  onClick={() => toggle(cat.key)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                >
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                      isOpen && 'rotate-90',
                    )}
                  />
                  <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: cat.color }} />
                  <span className="w-44 shrink-0 truncate text-sm">{cat.label}</span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        backgroundColor: cat.color,
                        width: `${maxCount > 0 ? (cat.count / maxCount) * 100 : 0}%`,
                      }}
                    />
                  </span>
                  <span className="w-28 shrink-0 text-right font-mono text-xs tabular-nums">
                    {fmtNum(cat.count, 0)} · {share}%
                  </span>
                </button>

                {isOpen && shown.length > 0 && (
                  <div className="mb-1.5 mt-0.5 space-y-1 pl-12 pr-2">
                    {shown.map((tp) => (
                      <div
                        key={`${tp.family} ${tp.type_name}`}
                        className="grid grid-cols-[minmax(0,45%)_1fr_auto] items-center gap-2"
                      >
                        <span
                          className="flex min-w-0 items-center text-xs text-muted-foreground"
                          title={`${tp.type_mark ? `[${tp.type_mark}] ` : ''}${tp.family || t('qtoPage.noFamily')} · ${tp.type_name || t('qtoPage.noType')}`}
                        >
                          <TypeMarkBadge mark={tp.type_mark} />
                          <span className="truncate">
                            {tp.type_name || tp.family || t('qtoPage.noType')}
                          </span>
                        </span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              backgroundColor: cat.color,
                              width: `${maxTypeCount > 0 ? (tp.count / maxTypeCount) * 100 : 0}%`,
                            }}
                          />
                        </span>
                        <span className="font-mono text-xs tabular-nums">
                          {fmtNum(tp.count, 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
