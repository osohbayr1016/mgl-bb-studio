import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

interface PageHeaderProps {
  title: string;
  /** Дээд талын жижиг том үсгээр бичсэн kicker. */
  eyebrow?: string;
  description?: string;
  /** Гарчгийн зүүн талд гарах icon. */
  icon?: LucideIcon;
  /** Заасан бол гарчгийн дээр ArrowLeft буцах холбоос гарна. */
  backTo?: string;
  backLabel?: string;
  /** Гарчгийн хажууд гарах Badge / тоолуур зэрэг. */
  meta?: ReactNode;
  /** Баруун талд байрлах товчлууруудын мөр. */
  actions?: ReactNode;
  /**
   * Доод зааглах зураасыг арилгана. Толгойн шууд доор таб зурвас ирдэг
   * хуудсуудад — эс бөгөөс хоёр зэрэгцээ зураас гарна.
   */
  bare?: boolean;
  className?: string;
}

/**
 * Дотоод staff/admin хуудсуудын НЭГДСЭН гарчгийн блок.
 *
 * Аппад өмнө нь 11 өөр `<h1>` загвар байсан бөгөөд энэ компонент 53
 * хуудасны 16-д л хэрэглэгдэж байв. Хуудас бүр ЯГ НЭГ `<h1>` агуулах
 * ёстой бөгөөд тэр нь эндээс гарна — `Layout`-ийн header дэх гарчиг нь
 * зориудаар `<p>` (Layout.tsx-ийн тайлбарыг үзнэ үү).
 *
 * Типографи нь `index.css`-ийн шатлалаас: `text-label` (eyebrow),
 * `text-title` (h1), `text-body` (тайлбар), `text-micro` (буцах холбоос).
 * Гараар хэмжээ бичихгүй. Serif display фонт ашиглахгүй — серифийг
 * public/client бренд дуу хоолойд үлдээнэ.
 *
 * `backTo` нь аппад тархсан 28 гараар бичсэн `<ArrowLeft>` буцах
 * холбоосыг орлоно — тэдгээр нь тус бүр өөр хэмжээ, зайтай байв.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  icon: Icon,
  backTo,
  backLabel,
  meta,
  actions,
  bare,
  className,
}: PageHeaderProps) {
  const { t } = useLanguage();
  const resolvedBackLabel = backLabel ?? t('common.back');
  return (
    <div className={cn('space-y-3', className)}>
      {backTo && (
        <Link
          to={backTo}
          className="text-micro inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {resolvedBackLabel}
        </Link>
      )}

      <div
        className={cn(
          'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4',
          !bare && 'border-b border-border pb-5',
        )}
      >
        <div className="min-w-0">
          {eyebrow && <div className="text-label text-muted-foreground">{eyebrow}</div>}
          <h1 className="text-title mt-1 flex min-w-0 items-center gap-2 text-foreground">
            {Icon && <Icon className="h-5 w-5 shrink-0 text-primary-ink" aria-hidden />}
            <span className="truncate">{title}</span>
            {/* `meta` нь truncate-ийн ГАДНА: төлөв/тоолуур нь гарчиг урт
                байсан ч таслагдах ёсгүй. */}
            {meta && <span className="flex shrink-0 items-center gap-1.5">{meta}</span>}
          </h1>
          {description && <p className="text-body mt-1 text-muted-foreground">{description}</p>}
        </div>

        {actions && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
