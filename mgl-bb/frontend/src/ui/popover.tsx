import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '@/shared/lib/utils';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, collisionPadding = 12, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // Radix-ийн өгөгдмөл нь 0 — өөрөөр хэлбэл popover нь дэлгэцийн
      // ФИЗИК ирмэгт нааж байрлана.  `viewport-fit=cover` асаалттай тул тэр нь
      // notch-ийн ард эсвэл home indicator-ын дээр гарна.
      collisionPadding={collisionPadding}
      className={cn(
        /* ⚠️ `max-w` + `max-h` + `overflow` гурвуулаа заавал.
         *
         * `max-w-[calc(100vw-2rem)]` нь twMerge-д `w-*`-ээс ТУСДАА бүлэг тул
         * хэрэглэгчийн `w-72`/`w-80`-ыг УСТГАХГҮЙ, зөвхөн хязгаарлана — 9
         * popover-ын бүгдийг нэг мөрөөр багтаана (`w-80` = 320px нь 360px
         * дэлгэцийн 89%, 320px дэлгэцэд 100%).
         *
         * `--radix-popover-content-available-height`-ыг Radix үргэлж
         * тооцоолж өгдөг (`visualViewport`-д тулгуурлана тул гар гарахад ч
         * зөв) — примитив нь түүнийг уншиж ч байгаагүй, улмаас урт агуулга
         * дэлгэцийн доор гүйлгэгдэхгүйгээр гарч байсан. */
        'z-50 w-72 max-w-[calc(100vw-2rem)] max-h-(--radix-popover-content-available-height) overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
