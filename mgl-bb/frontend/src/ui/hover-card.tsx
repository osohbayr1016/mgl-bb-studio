/**
 * HoverCard — хулгана тогтоход нээгддэг УНШИХ зориулалттай хөзөр.
 *
 * `Popover`-оос ялгаатай нь: дарж нээдэггүй, хулганы «санаа» (openDelay)
 * -аар нээгдэж, гараа авахад өөрөө хаагдана.  Тиймээс ЗӨВХӨН уншихад —
 * дотор нь товч, талбар байрлуулбал хэрэглэгч тийш нь хүрэх гэж хулганаа
 * хөдөлгөхөд хөзөр хаагдаж, дарагдахгүй.  Үйлдэлтэй бол `Popover` ашигла.
 *
 * ⚠️ Хүрэлцэх (touch) төхөөрөмж дээр hover ГЭЖ БАЙХГҮЙ — Radix нь
 *    HoverCard-ыг тэнд огт нээхгүй.  Гар утсанд мэдээллийг өөр замаар
 *    (мөрөн дээр дарж дэлгэрэнгүй рүү орох) хүргэх нь дуудагч талын үүрэг.
 *
 * Контентын хэмжээ/гүйлгэлтийн дүрэм нь `popover.tsx`-тэй ЯГ ИЖИЛ —
 * тэндхийн тайлбарыг үз (max-w + max-h + overflow гурвуулаа заавал).
 */
import * as React from 'react';
import { HoverCard as HoverCardPrimitive } from 'radix-ui';

import { cn } from '@/shared/lib/utils';

const HoverCard = HoverCardPrimitive.Root;
const HoverCardTrigger = HoverCardPrimitive.Trigger;

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = 'center', sideOffset = 6, collisionPadding = 12, ...props }, ref) => (
  <HoverCardPrimitive.Portal>
    <HoverCardPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        'z-50 w-80 max-w-[calc(100vw-2rem)] max-h-(--radix-hover-card-content-available-height) overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-xl outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    />
  </HoverCardPrimitive.Portal>
));
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;

export { HoverCard, HoverCardTrigger, HoverCardContent };
