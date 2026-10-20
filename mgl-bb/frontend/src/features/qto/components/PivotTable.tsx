import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Progress } from '@/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';

import {
  buildTree,
  fmtNum,
  shareBase,
  type Metrics,
  type PivotField,
  type PivotNode,
  type PivotSourceRow,
} from '../lib/pivots';

/** i18n keys for the "(no value)" fallback per group field. */
const EMPTY_LABEL_KEY: Record<PivotField, string> = {
  category: 'qtoPage.noCategory',
  family: 'qtoPage.noFamily',
  type_name: 'qtoPage.noType',
  level: 'qtoPage.noLevel',
  material: 'qtoPage.noMaterial',
  file: 'qtoPage.noFile',
  discipline: 'qtoPage.discOTHER',
};

interface VisibleRow {
  node: PivotNode;
  hasChildren: boolean;
}

/**
 * Expandable tree table over the aggregated fact rows: one tree level per
 * entry in `fields`, five summed metrics per row, share-of-total percentage
 * on the top level. `withBars` renders the top-level share as a Progress bar
 * (Самбар); `shareMetric` overrides the auto-picked share base; `comparator`
 * overrides the default heaviest-first ordering (depth-aware — Самбарын
 * Table горимын эрэмбэ), absent = buildTree-гийн compareNodes хэвээр.
 */
export function PivotTable({
  facts,
  fields,
  withBars = false,
  shareMetric,
  comparator,
}: {
  facts: PivotSourceRow[];
  fields: PivotField[];
  withBars?: boolean;
  shareMetric?: keyof Metrics;
  comparator?: (a: PivotNode, b: PivotNode, depth: number) => number;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tree = useMemo(() => {
    const built = buildTree(facts, fields);
    if (comparator) {
      const sortDeep = (nodes: PivotNode[], depth: number): void => {
        nodes.sort((a, b) => comparator(a, b, depth));
        for (const n of nodes) sortDeep(n.children, depth + 1);
      };
      sortDeep(built.roots, 0);
    }
    return built;
  }, [facts, fields, comparator]);
  const base =
    shareMetric && tree.totals[shareMetric] > 0 ? shareMetric : shareBase(tree.totals);
  const grandTotal = tree.totals[base];

  const visible = useMemo(() => {
    const rows: VisibleRow[] = [];
    const walk = (nodes: PivotNode[]) => {
      for (const node of nodes) {
        const hasChildren = node.children.length > 0;
        rows.push({ node, hasChildren });
        if (hasChildren && expanded.has(node.key)) walk(node.children);
      }
    };
    walk(tree.roots);
    return rows;
  }, [tree, expanded]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('qtoPage.colName')}</TableHead>
            <TableHead className="text-right">{t('qtoPage.colCount')}</TableHead>
            <TableHead className="text-right">{t('qtoPage.colLength')}</TableHead>
            <TableHead className="text-right">{t('qtoPage.colArea')}</TableHead>
            <TableHead className="text-right">{t('qtoPage.colVolume')}</TableHead>
            <TableHead className="text-right">{t('qtoPage.colMass')}</TableHead>
            <TableHead className="text-right">{t('qtoPage.colShare')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map(({ node, hasChildren }) => {
            const isOpen = expanded.has(node.key);
            const sharePct =
              node.depth === 0 && grandTotal > 0 ? (node.metrics[base] / grandTotal) * 100 : null;
            const share =
              sharePct != null
                ? `${sharePct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
                : '';
            return (
              <TableRow
                key={node.key}
                className={cn(hasChildren && 'cursor-pointer', node.depth > 0 && 'bg-muted/20')}
                onClick={hasChildren ? () => toggle(node.key) : undefined}
              >
                <TableCell>
                  <span
                    className="flex items-center gap-1"
                    style={{ paddingLeft: `${node.depth * 1.25}rem` }}
                  >
                    {hasChildren ? (
                      <ChevronRight
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                          isOpen && 'rotate-90',
                        )}
                      />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span
                      className={cn(
                        'max-w-[22rem] truncate',
                        node.depth === 0 ? 'font-medium' : 'text-muted-foreground',
                      )}
                    >
                      {node.value || t(EMPTY_LABEL_KEY[node.field])}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtNum(node.metrics.count, 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtNum(node.metrics.length_m)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtNum(node.metrics.area_m2)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtNum(node.metrics.volume_m3)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtNum(node.metrics.mass_kg)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {withBars && sharePct != null ? (
                    <span className="flex items-center justify-end gap-2">
                      <Progress value={sharePct} className="h-1.5 w-24 shrink-0" />
                      <span className="w-12 text-right">{share}</span>
                    </span>
                  ) : (
                    share
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className="font-medium">
            <TableCell>{t('qtoPage.total')}</TableCell>
            <TableCell className="text-right tabular-nums">
              {fmtNum(tree.totals.count, 0)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {fmtNum(tree.totals.length_m)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {fmtNum(tree.totals.area_m2)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {fmtNum(tree.totals.volume_m3)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {fmtNum(tree.totals.mass_kg)}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
