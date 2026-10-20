import * as React from 'react';
import { cn } from '@/shared/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ui/table';

export type ResponsiveColumn<Row> = {
  id: string;
  header: React.ReactNode;
  cell: (row: Row) => React.ReactNode;
  hideOnMobile?: boolean;
  className?: string;
  headClassName?: string;
  align?: 'left' | 'center' | 'right';
};

export type ResponsiveTableProps<Row> = {
  columns: ResponsiveColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  onRowClick?: (row: Row) => void;
  mobileCard?: (row: Row) => React.ReactNode;
  empty?: React.ReactNode;
  /** Wrapper className applied to BOTH mobile + desktop containers. */
  className?: string;
  /** className applied only to the desktop <Table>. */
  tableClassName?: string;
  /** className applied only to mobile card list wrapper. */
  mobileListClassName?: string;
  /** Каадэлд авах label-ыг тодорхой болгох (default: column.header). */
  labels?: Record<string, React.ReactNode>;
};

function alignClass(align: ResponsiveColumn<unknown>['align']) {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

/**
 * Mobile-д card stack, md:+ дээр classic table болж рендердэг responsive хүснэгт.
 *
 * - `mobileCard` дамжуулбал mobile рендерийг бүхэлд нь түүнд даатгана.
 * - Эс бөгөөс `hideOnMobile` биш column бүрийг `label : value` жагсаалт болгож харуулна.
 */
export function ResponsiveTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  mobileCard,
  empty,
  className,
  tableClassName,
  mobileListClassName,
  labels,
}: ResponsiveTableProps<Row>) {
  const visibleMobileColumns = columns.filter((c) => !c.hideOnMobile);

  if (rows.length === 0 && empty !== undefined) {
    return <div className={className}>{empty}</div>;
  }

  return (
    <div className={className}>
      {/* Mobile: card stack */}
      <div className={cn('md:hidden flex flex-col gap-2', mobileListClassName)}>
        {rows.map((row) => {
          const key = rowKey(row);
          const interactive = !!onRowClick;
          const handleClick = interactive ? () => onRowClick!(row) : undefined;
          const handleKey = interactive
            ? (e: React.KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRowClick!(row);
                }
              }
            : undefined;
          const cardContent = mobileCard ? (
            mobileCard(row)
          ) : (
            <dl className="flex flex-col gap-1.5">
              {visibleMobileColumns.map((col) => (
                <div
                  key={col.id}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <dt className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                    {labels?.[col.id] ?? col.header}
                  </dt>
                  <dd className={cn('min-w-0 text-right text-foreground', alignClass(col.align))}>
                    {col.cell(row)}
                  </dd>
                </div>
              ))}
            </dl>
          );
          return (
            <div
              key={key}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={handleClick}
              onKeyDown={handleKey}
              className={cn(
                'rounded-lg border border-border bg-card p-3 shadow-sm',
                interactive &&
                  'cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              )}
            >
              {cardContent}
            </div>
          );
        })}
      </div>

      {/* Desktop: classic table */}
      <div className="hidden md:block">
        <Table className={tableClassName}>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  className={cn(alignClass(col.align), col.headClassName)}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const key = rowKey(row);
              const interactive = !!onRowClick;
              return (
                <TableRow
                  key={key}
                  onClick={interactive ? () => onRowClick!(row) : undefined}
                  className={cn(interactive && 'cursor-pointer')}
                >
                  {columns.map((col) => (
                    <TableCell
                      key={col.id}
                      className={cn(alignClass(col.align), col.className)}
                    >
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
