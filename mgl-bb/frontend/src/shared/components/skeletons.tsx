import { Skeleton } from '@/ui/skeleton';
import { cn } from '@/shared/lib/utils';

/**
 * Ачаалалтын жорууд — «эргэдэг дугуй»-г орлоно.
 *
 * ХЭЗЭЭ SKELETON, ХЭЗЭЭ SPINNER (ялгах дүрэм):
 *  · Тухайн блокийн БАЙРЛАЛ, ХЭМЖЭЭ урьдчилан мэдэгдэж байвал → skeleton.
 *    Ингэснээр өгөгдөл ирэхэд агуулга үсрэхгүй.
 *  · Хэрэглэгчийн эхлүүлсэн ҮЙЛДЭЛ (хадгалах, илгээх, хөрвүүлэх) →
 *    spinner. Товчны доторх `<Loader2 className="animate-spin" />` ХЭВЭЭР.
 *  · Хэмжээ нь өгөгдлөөс хамаардаг тодорхойгүй блок → spinner.
 *
 * Жор бүр бодит бүрэлдэхүүний ГЕОМЕТРИЙГ давтана — эс тэгвэл skeleton нь
 * spinner-ээс ялгаагүй, зөвхөн илүү чимэглэлтэй болно.
 */

/** Хүснэгтийн ачаалалт. Мөрийн өндөр `DataTable`-ийн өтгөн мөртэй тааруулсан. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn('w-full', className)} aria-hidden>
      <div className="flex h-10 items-center gap-3 border-b border-border px-2">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className={cn('h-3', i === 0 ? 'w-[28%]' : 'w-[14%]')} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-8 items-center gap-3 border-b border-border/60 px-2">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton
              key={c}
              className={cn(
                'h-3',
                c === 0 ? 'w-[28%]' : 'w-[14%]',
                // Бага зэрэг хэлбэлзүүлбэл жинхэнэ өгөгдөл шиг харагдана.
                (r + c) % 3 === 0 && 'opacity-70',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Метрик мөр — `StatTile`-уудын өмнөх ачаалалт. */
export function StatRowSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4', className)}
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card px-3 py-2.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="mt-2 h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Картан сүлжээ — төслийн/багийн жагсаалт мэт. */
export function CardGridSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="mt-1.5 h-2.5 w-2/5" />
            </div>
          </div>
          <Skeleton className="mt-4 h-1.5 w-full rounded-full" />
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-4 w-14 rounded-full" />
            <Skeleton className="h-4 w-10 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Босоо жагсаалт — мэдэгдэл, түүх, тайлбар мэт. */
export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="mt-2 h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Маягтын ачаалалт — `Field`-ийн `space-y-1.5` хэмнэлийг давтана. */
export function FormSkeleton({ fields = 4, className }: { fields?: number; className?: string }) {
  return (
    <div className={cn('space-y-4', className)} aria-hidden>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}

/**
 * Бүхэл хуудсын ачаалалт — маршрутын Suspense fallback-д.
 * `PageHeader` + агуулгын геометрийг давтана.
 */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('space-y-6', className)}
      role="status"
      aria-busy="true"
      aria-label="Ачаалж байна"
    >
      <div className="border-b border-border pb-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-6 w-64" />
        <Skeleton className="mt-2 h-3 w-96 max-w-full" />
      </div>
      <StatRowSkeleton />
      <TableSkeleton />
    </div>
  );
}
