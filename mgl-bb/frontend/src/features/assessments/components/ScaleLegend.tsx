/**
 * Онооны шатлалын (1–5) тайлбар — бөглөх хуудасны хамгийн дээд хэсэгт наалдана.
 *
 * Хэрэглэгчийн гол шаардлага: «хэдийн тоо юу гэсэн үг вэ гэдэг асуулт бүрийн
 * хамгийн дээд хэсэгт нь харагддаг байх». Тиймээс `position: sticky, top-0` —
 * хуудсыг доош гүйлгэхэд ч тайлбар дэлгэц дээр үлдэнэ.
 *
 * ⚠️ Наалдац нь ХАМГИЙН ОЙРЫН гүйлгэдэг эцгээс хамаарна. Аппын гүйлгэдэг
 *    контейнер бол `Layout`-ийн `<main id="main-content">` (overflow-y-auto)
 *    тул энэ блокийг `overflow-hidden` бүхий анимэйшны контейнер ДОТОР
 *    байрлуулж БОЛОХГҮЙ — тэнд sticky үхнэ (AssessmentFillPage-ийн тайлбарыг үз).
 *
 * Жижиг дэлгэц дээр эвхэгддэг (анхдагчаар нээлттэй), учир нь 5 мөр тайлбар
 * утсан дээр дэлгэцийн талыг эзэлнэ.
 */
import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { AssessmentScale } from '../types';
import { sortedScaleOptions } from '../lib/scaleDisplay';

interface Props {
  scale: AssessmentScale;
  /**
   * `true` (анхдагч) — `<main>`-ын хэвтээ padding-ийг сөрөг margin-аар цуцалж
   * дэлгэцийн хоёр ирмэг хүртэл сунгана. Card дотор хэрэглэхэд `false`.
   */
  bleed?: boolean;
  className?: string;
}

/**
 * Оноо өсөх тусам тодрох чип. `opt.value`-ээр тооцно (индексээр биш).
 */
const CHIPS = [
  'bg-muted text-muted-foreground border-border',
  'bg-primary/15 text-primary border-primary/25',
  'bg-primary/30 text-primary border-primary/35',
  'bg-primary/55 text-primary-foreground border-primary/50',
  'bg-primary text-primary-foreground border-primary',
] as const;

function chipClass(value: number, lo: number, hi: number): string {
  if (hi <= lo) return CHIPS[CHIPS.length - 1];
  const ratio = (value - lo) / (hi - lo);
  const slot = Math.min(CHIPS.length - 1, Math.round(ratio * (CHIPS.length - 1)));
  return CHIPS[slot];
}

export function ScaleLegend({ scale, bleed = true, className }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(true);
  const options = sortedScaleOptions(scale);
  const lo = options[0]?.value ?? scale.min;
  const hi = options[options.length - 1]?.value ?? scale.max;

  if (options.length === 0) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        'sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur',
        // `<main>` нь p-4 / lg:p-7 — түүнийг яг цуцална.
        bleed && '-mx-4 px-4 lg:-mx-7 lg:px-7',
        className,
      )}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <Info className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-label font-semibold text-foreground">
            {scale.label || t('assessments.scaleLegendTitle')}
          </span>
          <span className="hidden text-micro text-muted-foreground sm:inline">
            {t('assessments.scaleRange', { min: scale.min, max: scale.max })}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
        <span className="sr-only">{t('assessments.scaleLegendToggle')}</span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <dl className="grid grid-cols-1 gap-1.5 pb-2 sm:grid-cols-2 lg:grid-cols-5">
          {options.map((opt) => (
            <div
              key={opt.value}
              className="flex items-start gap-2 rounded-md border border-border/60 bg-card/60 p-2"
            >
              <dt
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold tabular-nums',
                  chipClass(opt.value, lo, hi),
                )}
              >
                {opt.value}
              </dt>
              <dd className="min-w-0">
                <span className="block text-label font-semibold leading-tight text-foreground">
                  {opt.label}
                </span>
                {opt.caption && (
                  <span className="mt-0.5 block text-micro leading-snug text-muted-foreground">
                    {opt.caption}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default ScaleLegend;
