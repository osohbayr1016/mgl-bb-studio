import { BadgeCheck, CircleHelp, ShieldQuestion, FileSearch } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { useLanguage } from '@/shared/i18n';
import type { ConfidenceState } from '@mgl/mglai-common/turn';

/**
 * Итгэлийн ТӨЛӨВ — ТОО БИШ (§27).
 *
 * ⚠️ «97.3% итгэлтэй» гэсэн тоо нь калибровкогүй LLM-ийн хувьд утгагүй
 *    бөгөөд хэрэглэгчийг ТӨӨРӨГДҮҮЛНЭ.  Мэргэжлийн нормын хариултад
 *    эх сурвалж нь загварын итгэлээс ЧУХАЛ — тиймээс энэ chip нь
 *    «хэдэн хувь» биш «ямар нотолгоотой» гэдгийг хэлнэ.
 */
const CONFIG: Record<
  ConfidenceState,
  { icon: typeof BadgeCheck; mn: string; en: string; cls: string; hintMn: string }
> = {
  verified: {
    icon: BadgeCheck,
    mn: 'Баталгаажсан',
    en: 'Verified',
    cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    hintMn: 'Баталгаажсан заалтад тулгуурласан хариу.',
  },
  supported: {
    icon: FileSearch,
    mn: 'Нотолгоотой',
    en: 'Supported',
    cls: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    hintMn: 'Эх сурвалж эсвэл амьд ERP өгөгдөлд тулгуурласан.',
  },
  uncertain: {
    icon: ShieldQuestion,
    mn: 'Эргэлзээтэй',
    en: 'Uncertain',
    cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    hintMn:
      'Эх сурвалж нь албан ёсоор баталгаажаагүй, эсвэл зөрчилтэй. Шийдвэр гаргахын өмнө эх баримтыг шалгана уу.',
  },
  insufficient: {
    icon: CircleHelp,
    mn: 'Нотолгоо хүрэлцэхгүй',
    en: 'Insufficient evidence',
    cls: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    hintMn: 'Баталгаажсан эх сурвалж олдсонгүй. Энэ хариултад найдаж болохгүй.',
  },
};

export function ConfidenceChip({ state }: { state: ConfidenceState }) {
  const { lang } = useLanguage();
  const cfg = CONFIG[state];
  const Icon = cfg.icon;
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[11px] font-medium ${cfg.cls}`}
      title={cfg.hintMn}
    >
      {/* ⚠️ ДҮРС БА ШОШГЫГ ТУСГААРЛАНА (§13).  `gap-1` нь зөвхөн ХАРАГДАЦ —
          DOM-оос текст хуулахад `<svg>` ба шошго наалдаж «svgНотолгоо
          хүрэлцэхгүй» гэж гардаг байв (хэрэглэгч мэдээлсэн).  `<span>`
          болон ил зай нь хуулах үед хил үүсгэнэ. */}
      <Icon className="size-3 shrink-0" aria-hidden focusable="false" />{' '}
      <span>{lang === 'en' ? cfg.en : cfg.mn}</span>
    </Badge>
  );
}
