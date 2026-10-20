import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Типографийн шатлалын utility-үүдийг tailwind-merge-д `font-size` бүлэг
 * гэж бүртгэнэ.
 *
 * ЯАГААД ЗААВАЛ ХЭРЭГТЭЙ ВЭ: tailwind-merge нь өөрийн танихгүй `text-*`
 * классыг ӨНГӨ гэж ангилдаг. Тиймээс бүртгэлгүй бол:
 *
 *   twMerge('text-body text-muted-foreground')  ->  'text-muted-foreground'
 *   twMerge('text-title text-danger')           ->  'text-danger'
 *
 * — өөрөөр хэлбэл хэмжээ/жингийн класс ЧИМЭЭГҮЙ УСТДАГ. `cn()` нь аппад
 * 1,500+ газар дуудагддаг, `text-muted-foreground` дангаараа 1,432 удаа
 * хэрэглэгддэг тул бүртгэлгүйгээр типографийн шатлал бүхэлдээ ажиллахгүй.
 *
 * Бүртгэсний дараа (батлагдсан, tailwind-merge@3.5):
 *   'text-body text-muted-foreground'  ->  хоёулаа үлдэнэ
 *   'text-xs text-body'                ->  'text-body'      (зөв зөрчил шийдэл)
 *   'text-body text-[11px]'            ->  'text-[11px]'
 *
 * Шинэ type utility нэмэх бол `index.css`-ийн `@theme` дэх `--text-*`
 * тодорхойлолт БОЛОН доорх жагсаалт ХОЁУЛАНД нь нэмнэ.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['title', 'section', 'body', 'metric', 'label', 'micro'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
