/**
 * Ирцийн журмын БАЙНГЫН анхааруулга — «гарах бүртгэлээ заавал хийнэ үү».
 *
 * Энэ нь эвент биш ДҮРЭМ тул түр зуурын алдаа/амжилтын мөрөөс дээр,
 * хуудас нээгдэх бүрд харагдана (хаагдахгүй).  Текст нь migration 0198-ийн
 * мэдэгдэл болон `attendancePage.clockOutNotice` түлхүүртэй ЯГ ижил —
 * ажилтан bell дээрээ уншсан үгээ ирцийн хуудсан дээрээ дахин олно.
 *
 * `@/ui/alert`-ыг ЗОРИУДААР ашиглаагүй: репо даяар нэг л файл түүнийг
 * импортолдог бөгөөд түүний token дүрэм (`text-destructive-ink`) нь
 * `check-contrast.mjs`-ийн амьд бүдрэлт.  Доорх amber хос нь
 * `WorkerAttendancePage`-д аль хэдийн шалгарсан.
 */
import { Megaphone } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';

interface Props {
  /** Global search-ийн `?section=` зангуу (зөвхөн Ирц хуудсанд). */
  id?: string;
}

export default function ClockOutRuleNotice({ id }: Props) {
  const { t } = useLanguage();

  return (
    <div
      id={id}
      className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 scroll-mt-24"
    >
      <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
          {t('attendancePage.clockOutNoticeTitle')}
        </p>
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
          {t('attendancePage.clockOutNotice')}
        </p>
      </div>
    </div>
  );
}
