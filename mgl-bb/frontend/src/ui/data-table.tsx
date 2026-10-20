import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { TableSkeleton } from '@/shared/components/skeletons';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import {
  useTableSort,
  type DataTableColumn,
  type SortState,
} from '@/ui/use-table-sort';

export type { DataTableColumn, SortState, SortDir } from '@/ui/use-table-sort';

interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  /** `undefined` = хараахан ачаалагдаагүй (`isLoading`-той хамт хэрэглэнэ). */
  rows: Row[] | undefined;
  rowKey: (row: Row) => string | number;
  onRowClick?: (row: Row) => void;

  /* ---- эрэмбэ ---- */
  defaultSort?: SortState | null;
  /** Гаднаас удирдах (URL/localStorage-д хадгалах) тохиолдолд. */
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;

  /* ---- төлөвүүд ---- */
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Хоосон үеийн блок. Өгөхгүй бол ерөнхий `EmptyState`. */
  empty?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;

  /** Хүснэгтийн дээр гарах хайлт/шүүлтүүрийн мөр. */
  toolbar?: React.ReactNode;
  /** Хүснэгтийн доор гарах хуудаслалт/нийлбэр. */
  footer?: React.ReactNode;

  /**
   * Толгойг наалдуулна. ЭНЭ НЬ ӨӨРИЙН ГҮЙЛГЭХ ХҮРЭЭ ҮҮСГЭНЭ (`maxHeight`)
   * — өөрөөр ажиллуулах боломжгүй: хэвтээ халилтад шаардагдах
   * `overflow-x: auto` нь CSS-ийн дагуу `overflow-y`-г бас `auto` болгож,
   * `position: sticky` хуудасны биш ТЭР хүрээний хувьд ажилладаг.
   * Тиймээс энэ хүснэгт `Layout`-ийн `useScrollRestoration`-оос гарна —
   * зөвхөн урт, тогтмол өндөртэй жагсаалтад ашигла.
   */
  stickyHeader?: boolean;
  /** `stickyHeader` үед гүйлгэх хүрээний өндөр. */
  maxHeight?: string;

  /** Мобайл дээр ч хүснэгт хэвээр (карт болгохгүй). Ховор. */
  disableMobileCards?: boolean;

  className?: string;
  tableClassName?: string;
}

function alignClass(col: { align?: 'left' | 'center' | 'right'; numeric?: boolean }) {
  const a = col.align ?? (col.numeric ? 'right' : 'left');
  return a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
}

/**
 * Аппын НЭГДСЭН өгөгдлийн хүснэгт.
 *
 * Өмнө нь хүснэгт 5 өөр аргаар баригдаж байсан (shadcn `Table` 14 файлд,
 * `ResponsiveTable` 1-д, түүхий `<table>` 23 файлд, картан сүлжээ,
 * тусгай spreadsheet), эрэмбэ 8 удаа тус тусад бичигдсэн, эрэмбэлэгдэх
 * `<TableHead onClick>` нэг ч байгаагүй.
 *
 * `ui/table.tsx`-ийн `Table`-ыг ЗОРИУДААР ХЭРЭГЛЭХГҮЙ: тэр нь агуулгаа
 * `overflow-x-auto` div-д ороодог тул наалдсан толгой хуудасны биш тэр
 * div-ийн хувьд ажиллана. Энд wrapper-ээ өөрөө эзэмшинэ; `TableHeader` /
 * `TableBody` / `TableRow` / `TableHead` / `TableCell` нь хэвээр
 * хэрэглэгдэнэ тул `ui/table.tsx` хөндөгдөхгүй.
 *
 * Мобайлд (`md`-ээс доош) хүснэгт биш КАРТАН БАГЦ болно — 23 файл
 * responsive prefix огт байхгүйгээр хүснэгт үзүүлж, `<main>`-ий
 * `overflow-x-hidden`-д таслагдаж байсныг энэ засна.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  defaultSort,
  sort: sortProp,
  onSortChange,
  isLoading,
  error,
  onRetry,
  empty,
  emptyTitle,
  emptyDescription,
  toolbar,
  footer,
  stickyHeader,
  maxHeight = '70vh',
  disableMobileCards,
  className,
  tableClassName,
}: DataTableProps<Row>) {
  const visible = React.useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const { sort, toggle, sorted } = useTableSort(rows, visible, {
    defaultSort,
    value: sortProp,
    onChange: onSortChange,
  });

  /* ---------- төлөвүүд: алдаа > ачаалалт > хоосон ---------- */
  if (error) {
    return (
      <div className={className}>
        {toolbar}
        <ErrorState error={error} onRetry={onRetry} compact />
      </div>
    );
  }
  if (isLoading || rows === undefined) {
    return (
      <div className={className}>
        {toolbar}
        <TableSkeleton columns={Math.min(visible.length || 4, 6)} />
      </div>
    );
  }
  const data = sorted ?? rows;
  if (data.length === 0) {
    return (
      <div className={className}>
        {toolbar}
        {empty ?? (
          <EmptyState
            icon={Inbox}
            title={emptyTitle ?? '—'}
            description={emptyDescription}
            compact
          />
        )}
      </div>
    );
  }

  const interactive = Boolean(onRowClick);

  return (
    <div className={className}>
      {toolbar}

      {/* ---------- Мобайл: картан багц ---------- */}
      {!disableMobileCards && (
        <div className="flex flex-col gap-2 md:hidden">
          {data.map((row) => {
            const key = rowKey(row);
            const cells = visible.filter((c) => !c.hideOnMobile);
            return (
              <div
                key={key}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                onClick={interactive ? () => onRowClick?.(row) : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick?.(row);
                        }
                      }
                    : undefined
                }
                className={cn(
                  'rounded-lg border border-border bg-card p-3',
                  interactive &&
                    'cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                )}
              >
                <dl className="flex flex-col gap-1.5">
                  {cells.map((col) => (
                    <div key={col.id} className="flex items-baseline justify-between gap-3">
                      <dt className="text-label shrink-0 text-muted-foreground">
                        {col.mobileLabel ?? col.header}
                      </dt>
                      <dd
                        className={cn(
                          'text-micro min-w-0 text-right text-foreground',
                          col.numeric && 'tabular-nums',
                        )}
                      >
                        {col.cell(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- Десктоп: хүснэгт ---------- */}
      <div
        className={cn(
          'relative w-full overflow-x-auto',
          disableMobileCards ? 'block' : 'hidden md:block',
          stickyHeader && 'overflow-y-auto',
        )}
        style={stickyHeader ? { maxHeight } : undefined}
      >
        <table className={cn('text-micro w-full caption-bottom', tableClassName)}>
          <TableHeader className={cn(stickyHeader && 'sticky top-0 z-10 bg-card')}>
            <TableRow>
              {visible.map((col) => {
                const sortable = Boolean(col.sortValue);
                const active = sort?.id === col.id;
                const SortIcon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <TableHead
                    key={col.id}
                    aria-sort={
                      !sortable
                        ? undefined
                        : active
                          ? sort.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                    }
                    className={cn(
                      'text-label text-muted-foreground',
                      alignClass(col),
                      col.width,
                      col.headClassName,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggle(col.id)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                          active && 'text-foreground',
                        )}
                      >
                        {col.header}
                        <SortIcon
                          className={cn('size-3', active ? 'opacity-100' : 'opacity-40')}
                          aria-hidden
                        />
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow
                key={rowKey(row)}
                onClick={interactive ? () => onRowClick?.(row) : undefined}
                className={cn(interactive && 'cursor-pointer')}
              >
                {visible.map((col) => (
                  <TableCell
                    key={col.id}
                    className={cn(alignClass(col), col.numeric && 'tabular-nums', col.className)}
                  >
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>

      {footer}
    </div>
  );
}
