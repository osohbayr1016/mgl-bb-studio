import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

/**
 * Эрэмбэлэгддэг хүснэгтийн толгой нүд — дарахад чиглэл (өсөх/буурах) солигдоно.
 *
 * ⚠️ Түлхүүрийн төрлөөр НЭРВЭГДСЭН (generic): анх зөвхөн «Хураангуй» табын
 *    `SummarySortKey`-д зориулж бичигдсэн байсныг «Ажлын цаг» таб мөн
 *    хуваалцахад нь өргөтгөв.  Дуудагч тал нь `sort`/`onSort`-оос түлхүүрээ
 *    автоматаар гаргана — хуучин дуудагчид өөрчлөлтгүй ажиллана.
 */
export default function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className,
  align = 'center',
}: {
  label: string;
  sortKey: K;
  sort: { key: K; dir: 'asc' | 'desc' };
  onSort: (key: K) => void;
  className?: string;
  align?: 'center' | 'left';
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={cn(
        'px-2 py-2 font-medium border-b border-border cursor-pointer select-none hover:bg-muted/60 transition-colors',
        align === 'left' ? 'text-left' : 'text-center',
        className,
      )}
    >
      <span
        className={cn('inline-flex items-center gap-1', align === 'center' && 'justify-center')}
      >
        {label}
        <Icon className={cn('h-3 w-3', active ? 'text-primary' : 'text-muted-foreground/50')} />
      </span>
    </th>
  );
}
