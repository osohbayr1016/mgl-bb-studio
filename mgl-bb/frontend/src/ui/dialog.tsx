'use client';

import * as React from 'react';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  mobileFullScreen = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /**
   * Mobile (<sm) дээр dialog-г full-screen sheet болгож харуулна. Default `true`.
   * Жижиг confirm dialog-уудад `false` болгож centered modal-аар үлдээж болно.
   * Desktop (≥sm) дээрх харагдац ямар ч тохиолдолд адил.
   */
  mobileFullScreen?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-mobile-full={mobileFullScreen ? '' : undefined}
        className={cn(
          mobileFullScreen
            ? [
                /* Mobile (<sm): full-screen sheet sliding from bottom.
                 *
                 * ⚠️ `overflow-y-auto` нь ЗААВАЛ байх ёстой.  Урьд нь энд ямар ч
                 * `overflow`/`max-h` байгаагүй тул 640px дэлгэц дээр 608px-ээс
                 * урт агуулга дэлгэцийн ГАДНА зурагдаж, Radix нь `body`-г
                 * түгждэг учир баримт ч гүйлгэгдэхгүй байв — өөрөөр хэлбэл
                 * халисан хэсэг (үргэлж хамгийн доод хүүхэд = «Хадгалах» товч)
                 * таслагдсан ч биш, гүйлгэгдэх ч биш, ЗҮГЭЭР ХҮРШГҮЙ байсан.
                 * 53 диалогийн 46 нь өөрсдөө гүйлгэгч тавиагүй тул үүнийг
                 * примитив дээр өгөгдмөлөөр шийдэв.
                 *
                 * `overflow-x-hidden` мөн тодорхой: нэг тэнхлэг `visible` биш
                 * бол нөгөө нь автоматаар `auto` болдог тул үүнгүйгээр хөндлөн
                 * гүйлгэлт чимээгүй нээгдэнэ.
                 */
                'fixed inset-0 z-50 flex flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-contain bg-background outline-none',
                // `p-4` эхэлж бичигдэнэ — twMerge-д pt/pb нь түүнээс тусдаа
                // бүлэг тул гурвуулаа хүчинтэй үлдэнэ (p-4 нь зөвхөн зүүн/баруун).
                'p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))]',
                'data-[state=closed]:animate-out data-[state=open]:animate-in',
                'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
                'duration-200',
                /* sm:+ → centered modal.
                 *
                 * ⚠️ `sm:grid` БАЙСАН нь занга байв: media query дотор байгаа тул
                 * хэрэглэгчийн өгсөн угтваргүй `flex`-ийг дардаг, `display:grid`
                 * дор `flex-1` утгагүй болж, доторх `flex-1 min-h-0
                 * overflow-y-auto` гүйлгэгч чимээгүй үхдэг.  Гурван хуудас яг
                 * үүнээс болж ≥640px дээр эвдэрсэн байсан.  `DialogHeader`/
                 * `DialogFooter` хоёул flex контейнер тул grid-ийн семантикаас
                 * хамааралгүй — `sm:flex sm:flex-col` бүрэн орлоно.
                 *
                 * `sm:max-w-[calc(100%-2rem)]`-ыг хассан: twMerge нь мөрийн
                 * төгсгөлийн `sm:max-w-lg`-ээр дарагдуулдаг тул үхмэл байсан.
                 */
                'sm:fixed sm:inset-auto sm:top-[50%] sm:left-[50%] sm:flex sm:flex-col sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:w-full sm:translate-x-[-50%] sm:translate-y-[-50%] sm:gap-4 sm:overflow-y-auto sm:overflow-x-hidden sm:rounded-lg sm:border sm:bg-background sm:p-6 sm:shadow-lg sm:max-w-lg',
                'sm:data-[state=closed]:fade-out-0 sm:data-[state=open]:fade-in-0',
                'sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95',
                'sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0',
              ]
            : 'fixed top-[50%] left-[50%] z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] flex-col translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className={cn(
              // 44px хүрэх талбай (WCAG 2.5.5) — өмнө нь 16px хэмжээтэй нүцгэн
              // икон байсан, аппын хамгийн жижиг хүрэх бай.
              'grid size-8 place-items-center rounded-md opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none pointer-coarse:size-11 data-[state=open]:bg-accent data-[state=open]:text-muted-foreground',
              "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
              mobileFullScreen
                ? // ⚠️ Утсан дээр `fixed`, `absolute` БИШ: бүрхүүл нь одоо
                  // гүйлгэгч учраас `absolute` бол агуулгын хамт гүйж алга
                  // болно — гар утсанд Escape товч, дарах overlay ч байхгүй
                  // тул хаах товч нь ЦОРЫН ГАНЦ гарц.  `fixed` нь layout
                  // viewport-д бэхлэгддэг ба бүрхүүл нь яг `inset-0` тул
                  // харагдах байрлал өөрчлөгдөхгүй.
                  'fixed right-3 top-[max(0.75rem,calc(env(safe-area-inset-top)+0.25rem))] z-10 sm:absolute sm:right-4 sm:top-4'
                : 'absolute right-4 top-4',
            )}
          >
            <XIcon />
            <span className="sr-only">{t('common.close')}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/**
 * Mobile full-screen dialog дотор урт form/контентод хэрэглэх scrollable body wrapper.
 * Desktop дээр энгийн block — `sm:flex-none sm:overflow-visible`.
 */
function DialogScrollableBody({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-scrollable-body"
      className={cn(
        // `min-h-0` заавал: flex хүүхдийн `min-height` өгөгдмөл нь `auto` тул
        // үүнгүйгээр `flex-1` агуулгын өндрөөс доош хумигдаж чадахгүй бөгөөд
        // гүйлгэгч хэзээ ч ажиллахгүй.  (Магадгүй яг үүнээс болж энэ
        // компонентыг нэг ч хэрэглэгч авч ашиглаагүй.)
        'min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain sm:flex-none sm:overflow-visible',
        className,
      )}
      {...props}
    />
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{t('common.close')}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogScrollableBody,
  DialogTitle,
  DialogTrigger,
};
