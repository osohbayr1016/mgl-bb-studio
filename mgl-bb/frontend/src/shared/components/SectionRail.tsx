import { Fragment, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';

/**
 * Хуудасны хэсгийн зам — олон очиртой хуудсанд хэвтээ гүйлгэдэг табын мөрийг
 * орлоно.
 *
 * Товчийн жор нь `SettingsShell.tsx:115-129`-ээс ЯГ хуулагдсан (variant,
 * size, `aria-current`, `text-muted-foreground` — нэг ч тэмдэгтээр зөрөхгүй)
 * тул гурван сэдэв (.light / .dark / «Дундаж» .dim) дээр аль хэдийн
 * батлагдсан контрасттай.  ГАНЦ ЗОРИУДЫН ЗӨРҮҮ:
 *
 *   SettingsShell:  `-mx-1 flex gap-1 overflow-x-auto …`   ← хэвтээ гүйлгэлт
 *   SectionRail:    `flex flex-wrap gap-1 …`               ← мөр дамжина
 *
 * Энэ нь энэ компонентын бүх учир шалтгаан: `overflow-x` ХААНА Ч алга, тиймээс
 * шошго хэчнээн урт байсан ч (монгол «Хөгжлийн төлөвлөгөө» = 19 тэмдэгт)
 * дараагийн мөрөнд буугаад хэвтээ гүйлгэлт үүсэх БОЛОМЖГҮЙ.
 *
 * ⚠️ Эдгээр нь жирийн `<Button>` бөгөөд Radix `Tabs`-ийн React дэд модны ГАДНА
 *    амьдарна.  `TabsTrigger` болгож «сайжруулбал» контекстийн алдаа өгнө.
 *    Хандалт нь `<nav>` + `aria-current` (SettingsShell-ийн урьдчилсан жишиг).
 */
export interface SectionRailItem {
  /** Хэсгийн тогтвортой түлхүүр — ихэвчлэн `?tab=` slug. */
  value: string;
  label: string;
  /** lg-ээс доош гарах богино шошго; өгөөгүй бол `label`. */
  shortLabel?: string;
  icon?: LucideIcon;
  /** Бүлгийн гарчиг.  ⚠️ Нэг бүлгийн элементүүд ЗААВАЛ зэрэгцээ байрлана. */
  group?: string;
  /** Баруун захын слот — тоолуур эсвэл анхааруулгын тэмдэг. */
  badge?: ReactNode;
}

interface SectionRailProps {
  /** Дуудагч эрхээр нь аль хэдийн шүүсэн байна. */
  items: SectionRailItem[];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

export function SectionRail({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
}: SectionRailProps) {
  // Ганцхан бүлэг үлдсэн үед (ж: цэвэрлэгчид 2 хэсэг) гарчиг нь мэдээлэл биш
  // дуу чимээ — огт зурахгүй.  Тусдаа код зам үүсэхгүй, зөвхөн энэ boolean.
  const showCaptions = new Set(items.map((i) => i.group).filter(Boolean)).size > 1;

  return (
    <nav aria-label={ariaLabel} className={cn('lg:w-56 lg:shrink-0', className)}>
      {/* Утсан дээр наалдамхай — урт маягтын (PGP) дундаас ч хэсэг солино.
          `-mx-4 px-4` нь `<main>`-ийн `p-4`-ийг нөхөж ирмэг хүртэл сунана;
          lg дээр тэр бүхэн reset хийгдээд энгийн наалдамхай багана болно. */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur lg:top-4 lg:z-auto lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
        <div className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap lg:gap-0.5">
          {items.map((item, i) => {
            const Icon = item.icon;
            const active = item.value === value;
            // Гарчгийг «өмнөх элементээс өөр бүлэг» гэдгээр гаргана — рендэрийн
            // явцад хувьсагч өөрчлөхгүй (react-hooks/immutability).
            const caption =
              showCaptions && item.group && item.group !== items[i - 1]?.group ? item.group : null;

            return (
              <Fragment key={item.value}>
                {caption && (
                  <div className="text-label hidden px-3 pt-4 pb-1 text-muted-foreground first:pt-0 lg:block">
                    {caption}
                  </div>
                )}
                <Button
                  type="button"
                  variant={active ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onValueChange(item.value)}
                  className={cn(
                    'shrink-0 justify-start gap-2 lg:w-full',
                    !active && 'text-muted-foreground',
                  )}
                >
                  {/* Дүрс нь lg-ээс доош нуугдана — нарийн дэлгэц дээр өргөнийг
                      монгол шошгонд өгнө. */}
                  {Icon && <Icon className="hidden h-4 w-4 shrink-0 lg:block" aria-hidden />}
                  <span className="lg:hidden">{item.shortLabel ?? item.label}</span>
                  <span className="hidden lg:inline">{item.label}</span>
                  {item.badge && <span className="ml-auto shrink-0">{item.badge}</span>}
                </Button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
