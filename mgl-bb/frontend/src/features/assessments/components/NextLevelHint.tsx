/**
 * «Дараагийн түвшин хүртэл хэдэн хувь дутуу вэ» гэдгийг харуулах жижиг
 * хэсгүүд — ажилтны ӨӨРИЙН үр дүн харуулдаг хоёр газар (профайлын
 * `MyAssessmentsSection` ба `MyResultChartsPage`) хоёулаа эндээс авна.
 *
 * ⚠️ ЭНЭ ФАЙЛ ЗӨВХӨН ӨӨРИЙН ӨГӨГДӨЛД ЗОРИУЛАГДСАН.  Хэрэглэгч `/assessments/
 *    my/results`-ээс ирсэн (өөрийн) утгыг л энд дамжуулна.  Админы
 *    (`/rounds/:id/results`) өгөгдлийг энд оруулах нь ажилтны дэлгэц дээр
 *    бусдын хувийг гаргах эрсдэлтэй — админ талд өөрийн бүрэн бүрэлдэхүүн
 *    (`admin/PartResultCard` г.м.) байгаа, түүнийг ашигла.
 */
import { useLanguage } from '@/shared/i18n';
import { Progress } from '@/ui/progress';

/**
 * «<Дараагийн түвшин> түвшинд хүрэхэд X% дутуу» мөр, сонголтоор явцын шугамтай.
 *
 * Хамгийн дээд түвшинд хүрсэн үед (`nextLabel` null) зөрүүг 0% гэж харуулбал
 * «дутуу байна» гэж уншигдана — оронд нь тусдаа магтаалын мөр гарна.
 */
export function NextLevelHint({
  pct,
  nextLabel,
  nextMinPct,
  pctToNext,
  showBar,
}: {
  pct: number | null;
  nextLabel: string | null;
  nextMinPct: number | null;
  pctToNext: number | null;
  showBar?: boolean;
}) {
  const { t } = useLanguage();
  if (pct === null) return null;

  if (!nextLabel || pctToNext === null) {
    return (
      <p className="mt-1 text-micro font-medium text-success">{t('assessments.atTopLevel')}</p>
    );
  }

  return (
    <div className="mt-1 space-y-1">
      {showBar && nextMinPct !== null && nextMinPct > 0 && (
        <Progress value={Math.min(100, (pct / nextMinPct) * 100)} className="h-1.5" />
      )}
      <p className="text-micro text-muted-foreground">
        {t('assessments.toNextLevel', { level: nextLabel, pct: pctToNext.toFixed(1) })}
      </p>
    </div>
  );
}

/**
 * Зан чанарын (weighted:false) хэсгийн хувилбар — ХУВЬ биш, 1.0–5.0 дундаж.
 *
 * ⚠️ Тусдаа компонент байгаагийн шалтгаан (I5): зан чанарын үнэлгээ нь
 *    `BEHAVIOR_BANDS` дээр суурилсан огт өөр систем.  Түүнийг хувиар
 *    илэрхийлбэл ажилтан өөрийгөө буруу үнэлнэ, тиймээс нэг компонентод
 *    хоёуланг нь «нэгтгэх» гэж бүү оролд.
 */
export function NextBandHint({
  mean,
  nextBandLabel,
  meanToNext,
}: {
  mean: number | null | undefined;
  nextBandLabel: string | null | undefined;
  meanToNext: number | null | undefined;
}) {
  const { t } = useLanguage();
  if (mean == null) return null;

  if (!nextBandLabel || meanToNext == null) {
    return (
      <p className="mt-1 text-micro font-medium text-success">{t('assessments.atTopLevel')}</p>
    );
  }

  return (
    <p className="mt-1 text-micro text-muted-foreground">
      {t('assessments.toNextBand', { band: nextBandLabel, delta: meanToNext.toFixed(1) })}
    </p>
  );
}
