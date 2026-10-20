import type { ComponentProps, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { PolishableTextarea } from '@/ui/PolishableTextarea';

/**
 * «Баримт» горимын засварлагчийн барилгын хэсгүүд (эзний хүсэлт 2026-09-25).
 *
 * Засварлагч нь хэвлэгдэх баримттай (`AsrDocument.tsx`) ИЖИЛ хэлбэртэй: хар
 * хүрээтэй хүснэгт, хар-хөх шошгын нүд, налуу бичвэр.  Инженер Word-ийн
 * хүснэгтэд бичиж байгаа мэт нүдэн дээр нь шууд дарж бөглөнө.
 *
 * Гэхдээ ХЭВЛЭХ баримтын CSS-ийг (`asrPrintStyles.ts`) ДАХИН АШИГЛААГҮЙ —
 * тэр нь цаасны тогтмол өргөнтэй (171.9мм) бөгөөд утсанд багтахгүй.  Энд:
 *
 *   • Семантик токен (`bg-card`, `border-foreground`) — харанхуй горимд ч
 *     доторх `SignatureCapture`, `AsrRecorder` зэрэг токентой компонентууд
 *     зөв харагдана (цагаан цаасан дээр харанхуй горимын цайвар текст гарах
 *     асуудал үүсэхгүй).
 *   • 640px-ээс доош хүснэгтийн 4 багана НЭГ багана болж эвхэгдэнэ: шошго нь
 *     нүдний дээд тууз, утга нь доор — хуруугаар дарахад ≥44px.
 *   • Хүснэгтийн зураас = grid-ийн 1px `gap` + дэвсгэр өнгө (нүд бүр
 *     `bg-card`), тиймээс span-тай нүдэнд ч давхар зураас гардаггүй.
 */

/** Цаас — дэлгэц дээрх A4 хуудас. */
export function DocPaper({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[210mm] bg-card px-3 py-4 text-card-foreground shadow-sm ring-1 ring-border sm:px-10 sm:py-9">
      {children}
    </div>
  );
}

/**
 * MGL E&C лого — баримтын толгойн баруун талд (хэвлэлтийн `.asr-logo`-ийн
 * дэлгэцийн ихэр).  `logo.svg`-ийн 76% нь хоосон зай тул зургийг томсгоод
 * сөрөг зайгаар тайрна — тоо нь `asrPrintStyles.ts`-ийн LOGO_* (ink 455×349 /
 * viewBox 1920×1080).
 */
export function DocLogo({ inkHeightPx = 44 }: { inkHeightPx?: number }) {
  const imgH = (inkHeightPx * 1080) / 349;
  const imgW = (imgH * 1920) / 1080;
  const inkW = (inkHeightPx * 455) / 349;
  return (
    <div className="shrink-0 overflow-hidden leading-none" style={{ width: inkW, height: inkHeightPx }}>
      <img
        src="/logo.svg"
        alt="MGL E&C"
        className="block max-w-none opacity-55 dark:invert"
        style={{
          width: imgW,
          height: imgH,
          margin: `${-(imgH - inkHeightPx) / 2}px ${-(imgW - inkW) / 2}px`,
        }}
      />
    </div>
  );
}

/** Хар хүрээтэй хүснэгт.  Десктоп дээр 22 / 30 / 20 / 28 (хэвлэлтийн ижил). */
export function DocGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-px border-2 border-foreground/80 bg-foreground/35',
        'sm:grid-cols-[22fr_30fr_20fr_28fr]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Хар-хөх шошгын нүд: монгол шошго + налуу англи дэд шошго. */
export function DocLabel({
  mn,
  en,
  hint,
  className,
}: {
  mn: string;
  en?: string;
  /** Шошгын доорх налуу тайлбар — талбарт юу бичихийг заана (хаалтыг компонент нэмнэ). */
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-baseline gap-x-1.5 bg-brand-navy px-3 py-1.5 text-white sm:flex-col sm:items-start sm:justify-center sm:gap-0 sm:py-2',
        className,
      )}
    >
      <span className="text-micro font-semibold leading-tight">{mn}</span>
      {/* `text-label` нь base давхаргад `uppercase` авдаг — баримтын горимд ТОМ
          үсэг хэрэггүй (эзэн 2026-09-30), тиймээс `normal-case`. */}
      {en && (
        <span className="text-label normal-case italic leading-tight tracking-normal opacity-70">
          ({en})
        </span>
      )}
      {/* «Тайлбар»-аас (12px, тод) ЖИЖИГ: 11px, энгийн жин, хаалтанд. */}
      {hint && (
        <span className="basis-full text-label font-normal normal-case italic leading-snug tracking-normal opacity-80 sm:mt-0.5 sm:basis-auto">
          ({hint})
        </span>
      )}
    </div>
  );
}

/** Утгын нүд.  `span` = 3 бол десктоп дээр гурван баганыг эзэлнэ. */
export function DocCell({
  children,
  span,
  className,
}: {
  children: ReactNode;
  span?: 3;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col justify-center bg-card',
        span === 3 && 'sm:col-span-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Зөвхөн уншигдах утга (төслийн мэдээлэл гэх мэт). */
export function DocValue({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <div
      className={cn(
        'min-h-10 break-words px-3 py-2 text-sm whitespace-pre-wrap',
        strong && 'font-semibold',
      )}
    >
      {children}
    </div>
  );
}

/**
 * Хүрээгүй оролт — нүд өөрөө талбар.  `text-base` утсанд ЗААВАЛ (iOS нь
 * 16px-ээс жижиг талбарт дарахад хуудсыг томруулдаг).
 */
export function DocInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      {...props}
      className={cn(
        'h-11 w-full min-w-0 bg-transparent px-3 text-base outline-none transition-colors',
        'placeholder:text-muted-foreground/70 focus:bg-primary/5 sm:h-10 sm:text-sm',
        'disabled:cursor-default read-only:cursor-default',
        className,
      )}
    />
  );
}

/**
 * Хүрээгүй, өөрөө өсдөг бичих талбар (налуу — баримтын хэлбэр).  «Сайжруулах»
 * AI товч нь зөвхөн засах горимд.
 *
 * ⚠️ `disabled` БИШ `readOnly`: disabled textarea нь `opacity-50` болж
 *    батлагдсан тайлан бүдэг харагдана, мөн текстийг хуулж авах боломжгүй.
 */
export function DocText({
  readOnly,
  className,
  aiPolish = true,
  ...props
}: Omit<ComponentProps<typeof PolishableTextarea>, 'disabled'> & { readOnly?: boolean }) {
  return (
    <div className={cn('pb-1 pr-2', readOnly && 'pb-0')}>
      <PolishableTextarea
        {...props}
        autoGrow
        readOnly={readOnly}
        aiPolish={aiPolish && !readOnly}
        className={cn(
          'min-h-[3.25rem] rounded-none border-0 bg-transparent px-3 py-2.5 italic shadow-none',
          'focus-visible:bg-primary/5 focus-visible:ring-0 dark:bg-transparent',
          'placeholder:not-italic placeholder:text-muted-foreground/70',
          className,
        )}
      />
    </div>
  );
}

/** Хуруугаар дарах чагт (CSS хайрцаг — хэвлэлтийн `.asr-cb`-ийн дэлгэцийн ихэр). */
export function DocCheck({
  on,
  disabled,
  onToggle,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'h-auto min-h-10 justify-start gap-2 px-2 py-1.5 font-normal whitespace-normal disabled:opacity-100',
        'pointer-coarse:h-auto pointer-coarse:min-h-11',
        on ? 'font-semibold text-foreground' : 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-[3px] border transition-colors',
          on
            ? 'border-brand-navy bg-brand-navy text-white dark:border-primary dark:bg-primary dark:text-primary-foreground'
            : 'border-foreground/50 bg-card',
        )}
      >
        {on && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="text-left">{children}</span>
    </Button>
  );
}

/** Чагтын мөр — нүдний дотор боож байрлуулна. */
export function DocChecks({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-x-1 gap-y-0.5 px-1.5 py-1">{children}</div>;
}

/** Блокийн хар-хөх тууз («Ажлын тайлан · Work report»). */
export function DocBand({ mn, en, children }: { mn: string; en?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 bg-brand-navy px-3 py-2 text-white">
      <span className="text-section font-semibold">{mn}</span>
      {en && <span className="text-label normal-case italic tracking-normal opacity-70">{en}</span>}
      {children && <span className="ml-auto">{children}</span>}
    </div>
  );
}

/** Хар хүрээтэй бие даасан блок (ажлын тайлан, улаан дэвтэр, зургийн хуудас). */
export function DocBlock({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn('mt-4 scroll-mt-4 border-2 border-foreground/80 bg-card', className)}
    >
      {children}
    </section>
  );
}

/** Ажлын тайлангийн биеийн тод-налуу дэд гарчиг. */
export function DocHead({ mn, en, hint }: { mn: string; en?: string; hint?: string }) {
  return (
    <div className="px-3 pt-3">
      <div className="text-sm">
        <span className="font-bold italic text-brand-navy dark:text-primary">{mn}:</span>{' '}
        {en && (
          <span className="text-label normal-case italic tracking-normal text-muted-foreground">{en}</span>
        )}
      </div>
      {hint && <p className="text-micro text-muted-foreground">{hint}</p>}
    </div>
  );
}
