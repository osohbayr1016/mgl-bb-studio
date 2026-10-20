/**
 * Level (Intern → Expert) нэрийг өнгөт badge болгож харуулна.
 *
 * Өнгө нь схемийн `AssessmentLevelBand.color` — Tailwind класс биш **түүхий
 * hex** тул inline style-аар хэрэглэнэ (график, Excel-тэй ижил өнгө байхын
 * тулд схем дээр төвлөрүүлсэн). Дэвсгэр/хүрээг alpha-тайгаар авснаар dark,
 * light хоёуланд уншигдана.
 *
 * ⚠️ Энэ badge зөвхөн ТЕКСТ харуулна — ажилтанд тоо, хувь харуулахгүй гэсэн
 *    дүрэм (docs/dev/assessments-spec.md §3) энд ч мөрдөгдөнө.
 */
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

/**
 * `AssessmentLevelBand` энэ хэлбэрийг бүрэн хангана, гэхдээ `/my/results`-ээс
 * ирдэг задалсан (`level_code` / `level_label` / `level_color`) хэлбэрийг ч
 * дамжуулж чадахаар сул тодорхойлов.
 */
export interface LevelBadgeLevel {
  code?: string | null;
  label?: string | null;
  color?: string | null;
}

interface Props {
  level: LevelBadgeLevel | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

const BASE =
  'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap';

const SIZES = {
  sm: 'px-2 py-0.5 text-micro',
  md: 'px-2.5 py-1 text-label',
} as const;

/** `#rrggbb` эсэхийг шалгана — буруу утга inline style-д орохоос сэргийлнэ. */
function isHex(color: string | null | undefined): color is string {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
}

export function LevelBadge({ level, size = 'md', className }: Props) {
  const { t } = useLanguage();
  const label = level?.label || level?.code;

  // Үнэлгээ дуусаагүй / тал бөглөөгүй үед level гарахгүй.
  if (!label) {
    return (
      <span className={cn(BASE, SIZES[size], 'border-border bg-muted text-muted-foreground', className)}>
        {t('assessments.levelPending')}
      </span>
    );
  }

  if (!isHex(level?.color)) {
    return (
      <span className={cn(BASE, SIZES[size], 'border-primary/30 bg-primary/10 text-primary', className)}>
        {label}
      </span>
    );
  }

  const color = level.color;
  return (
    <span
      className={cn(BASE, SIZES[size], className)}
      style={{
        color,
        // 0x22 ≈ 13%, 0x55 ≈ 33% — dark горимд ч дэвсгэр нь дэндүү тод болохгүй.
        backgroundColor: `${color}22`,
        borderColor: `${color}55`,
      }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export default LevelBadge;
