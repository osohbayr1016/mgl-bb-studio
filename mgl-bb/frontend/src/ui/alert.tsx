import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/shared/lib/utils';

/**
 * Мэдэгдлийн тууз — хадгалалтын үр дүн, анхааруулга, алдаа.
 *
 * ЯАГААД ЭНЭ ФАЙЛ ХЭРЭГТЭЙ ВЭ: апп даяар 49 файлд `bg-destructive/15 … border`
 * маягийн тууз ГАРААР бичигдсэн байсан ба тэдгээрийн зөвхөн 5-д нь `role`
 * байсан. Өөрөөр хэлбэл хадгалалт амжилтгүй болохыг дэлгэц уншигч ОГТ
 * дуулгадаггүй байв. Энд `role="alert"` нь үндсэн бүрхүүлд шингэсэн тул
 * дуудагч мартах боломжгүй.
 *
 * ⚠️ ТОКЕНЫ ЗӨРҮҮ (реестрийн стандарт хувилбараас): shadcn-ий эх хувилбар
 * `text-destructive` хэрэглэдэг. Энэ репод тэр нь ЗӨВ БИШ —
 * `scripts/check-contrast.mjs` нь `destructive`-ийг SOFT (зөвхөн мэдээлэл)
 * гэж, `destructive-ink`-ийг INK (4.5:1 хатуу шалгалт, өөрийн /10 будалт
 * дээр ч мөн) гэж ангилдаг. `--destructive-ink` яг үүний тулд үүссэн:
 * `text-destructive` нь харанхуй горимд `--card` дээр 2.82:1 байсан.
 *
 * `success` нь INK жагсаалтад байгаа тул `text-success` шууд зөв.
 */
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-body has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground',
        destructive:
          'border-destructive/20 bg-destructive/10 text-destructive-ink *:data-[slot=alert-description]:text-destructive-ink/90',
        success:
          'border-success/20 bg-success/10 text-success *:data-[slot=alert-description]:text-success/90',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant ?? 'default'}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-body text-muted-foreground col-start-2 grid justify-items-start gap-1 [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
