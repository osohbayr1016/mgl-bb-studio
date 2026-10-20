import type { ComponentType, HTMLAttributes } from 'react';
import * as FastMarqueeNs from 'react-fast-marquee';
import type { MarqueeProps as FastMarqueeProps } from 'react-fast-marquee';

import { cn } from '@/shared/lib/utils';

/**
 * ⚠️ CJS interop — `import FastMarquee from 'react-fast-marquee'` гэж БҮҮ бич.
 *
 * `react-fast-marquee@1.6.5` нь ЗӨВХӨН CJS (`main` талбартай, `module`/
 * `exports` үгүй).  Rolldown түүнийг `__toESM(require_rfm(), 1)` гэж боодог
 * бөгөөд тэр сүүлийн `1` (isNodeMode) нь туслахыг `__esModule` тугийг ҮЛ
 * ХАЙХРАН `target.default = mod` гэж БҮТЭН модулийг тавихад хүргэдэг.  Үр
 * дүнд default import нь `{__esModule: true, default: ForwardRef}` объект
 * болж, React «element type is invalid … got: object» (#130) шидэж, аппын
 * алдааны хилээр БҮХ хуудсыг унагана.
 *
 * ⚠️ Энэ нь ЗӨВХӨН хөтөч дээр илэрдэг: `tsc`, `eslint`, `vite build`
 * гурвуулаа цэвэр өнгөрдөг, Node дээр `require(...).default` нь ХҮЧИНТЭЙ
 * forwardRef компонент байдаг.  2026-08-06-нд production унасан.
 *
 * Тиймээс намespace-ээр импортлож, боолтыг гараар тайлна.  ForwardRef
 * компонент нь `{$$typeof, render}` түлхүүртэй байдаг тул `default`
 * түлхүүрийн БАЙГАА эсэхээр давхар боолтыг ялгана.
 */
const FastMarquee = ((): ComponentType<FastMarqueeProps> => {
  const ns = FastMarqueeNs as unknown as Record<string, unknown>;
  const inner = ns.default as Record<string, unknown> | undefined;
  const unwrapped =
    inner && typeof inner === 'object' && 'default' in inner ? inner.default : (inner ?? ns);
  return unwrapped as ComponentType<FastMarqueeProps>;
})();

/**
 * Тасралтгүй гүйдэг зурвас (ticker).  Kibo UI-ийн `marquee`-г
 * (https://www.kibo-ui.com/r/marquee.json) төслийн хэвшилд тааруулав.
 *
 * Хөрвүүлэлт: `"use client"` устгав (Vite SPA, Next.js биш) ·
 * `flex-shrink-0` → `shrink-0`.  Өнгө нь бүхэлдээ семантик токен дээр
 * (`from-background`) тул `eslint.tokens` цэвэр гарсан — өөрчлөх зүйлгүй.
 *
 * ХЭРЭГЛЭЭ:
 *   <Marquee>
 *     <MarqueeFade side="left" />
 *     <MarqueeContent speed={28} gradient={false}>
 *       {items.map((x) => <MarqueeItem key={x.id}>…</MarqueeItem>)}
 *     </MarqueeContent>
 *     <MarqueeFade side="right" />
 *   </Marquee>
 *
 * ⚠️ ХҮРТЭЭМЖ: `react-fast-marquee` нь `prefers-reduced-motion`-ыг ӨӨРӨӨ
 * хүндэтгэдэггүй.  Хөдөлгөөн мэдрэмтгий хэрэглэгчид зориулж дуудагч тал
 * `useReducedMotion()`-оор шалгаад `play={false}` дамжуулах ҮҮРЭГТЭЙ —
 * эс бөгөөс vestibular эмгэгтэй хүнд байнга хөдөлж буй текст үзүүлнэ.
 */

export type MarqueeProps = HTMLAttributes<HTMLDivElement>;

export const Marquee = ({ className, ...props }: MarqueeProps) => (
  <div className={cn('relative w-full overflow-hidden', className)} {...props} />
);

export type MarqueeContentProps = FastMarqueeProps;

export const MarqueeContent = ({
  loop = 0,
  autoFill = true,
  pauseOnHover = true,
  ...props
}: MarqueeContentProps) => (
  <FastMarquee autoFill={autoFill} loop={loop} pauseOnHover={pauseOnHover} {...props} />
);

export type MarqueeFadeProps = HTMLAttributes<HTMLDivElement> & {
  side: 'left' | 'right';
};

export const MarqueeFade = ({ className, side, ...props }: MarqueeFadeProps) => (
  <div
    className={cn(
      'absolute top-0 bottom-0 z-10 h-full w-24 from-background to-transparent',
      side === 'left' ? 'left-0 bg-gradient-to-r' : 'right-0 bg-gradient-to-l',
      className,
    )}
    {...props}
  />
);

export type MarqueeItemProps = HTMLAttributes<HTMLDivElement>;

export const MarqueeItem = ({ className, ...props }: MarqueeItemProps) => (
  <div className={cn('mx-2 shrink-0 object-contain', className)} {...props} />
);
