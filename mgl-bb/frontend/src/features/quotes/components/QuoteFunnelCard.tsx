/**
 * Борлуулалтын юүлүүр — «хэдэн санал ҮҮСГЭЖ, хэдийг нь явуулж, хэдийг нь
 * гэрээ болгов — ямар дүнгээр».
 *
 * Хоёр ӨӨР суурьтай тоо зэрэг гарна, тэднийг бүү хутга:
 *   • «Нийт үүсгэсэн» (`totals.created_*`) — НООРОГ ХАМТ, бүртгэгдсэн БҮХ санал.
 *     «Бид нийт хэдэн санал, хэдэн төгрөгний ажил бэлтгэв» гэдэгт хариулна.
 *   • «Явуулсан» (`totals.sent_*`, win-rate) — ноорогийг ЗОРИУД хасна, эс
 *     бөгөөс хагас бэлэн ноорог амжилтын хувийг хиймлээр бууруулна.
 * Ноорог дээрээ гацсан ажлын хэмжээ нь тэдгээрийн ЗӨРӨӨ.
 *
 * ⚠️ ХАМГИЙН ЧУХАЛ ЗҮЙЛ: МӨНГӨН ДҮНГ ХЭЗЭЭ Ч ДАНГААР НЬ БҮҮ ХАРУУЛ.
 *    `total_amount` нь клиентийн тооцоолсон КЭШ (migration 0128) — санал
 *    браузераар нэг ч удаа нээгдээгүй бол NULL. Сервер тэднийг нийлбэрт
 *    ОРУУЛДАГГҮЙ, оронд нь `amount_missing_count`-оор тоолж буцаадаг.
 *    Хэрэв UI зөвхөн нийлбэрийг харуулбал «нийт 1.2 тэрбумын санал явуулсан»
 *    гэсэн тоо бодит дүнгээс чимээгүйхэн бага гарч, хэн ч анзаарахгүй.
 *    Тиймээс дүн бүрийн доор «X/Y санал дүн бүртгэгдсэн» гэсэн хамрах хүрээ
 *    ҮРГЭЛЖ гарна. Энэ мөрийг «эмх замбараагүй» гэж бүү устга.
 */
import { useQuery } from '@tanstack/react-query';
import { Loader2, TrendingUp } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

import { getQuoteFunnel, quoteFunnelKey } from '../api/quotes';
import { QUOTE_STATUS_LABEL } from '../lib/quoteStatus';
import type { QuoteFunnelBucket } from '../types/quotes';

/** ₮ дүн — жагсаалтын нүдтэй ижил хэв маяг (бүхэл, mn-MN бүлэглэлт). */
const fmtAmount = (v: number): string => Math.round(v).toLocaleString('mn-MN');

export function QuoteFunnelCard({
  from,
  to,
  onRangeChange,
}: {
  from: string;
  to: string;
  onRangeChange: (next: { from: string; to: string }) => void;
}) {
  const { t } = useLanguage();

  const { data, isLoading } = useQuery({
    queryKey: quoteFunnelKey(from || undefined, to || undefined),
    queryFn: () => getQuoteFunnel({ from: from || undefined, to: to || undefined }),
  });

  const totals = data?.totals;
  const winRate = totals?.win_rate;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary" />
          {t('quotes.funnel.title')}
        </CardTitle>
        <CardDescription>{t('quotes.funnel.hint')}</CardDescription>

        <div className="flex flex-wrap items-end gap-3 pt-2">
          <div className="space-y-1">
            <Label htmlFor="funnel-from" className="text-micro">
              {t('quotes.funnel.from')}
            </Label>
            <Input
              id="funnel-from"
              type="date"
              value={from}
              className="h-8 w-[150px]"
              onChange={(e) => onRangeChange({ from: e.target.value, to })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="funnel-to" className="text-micro">
              {t('quotes.funnel.to')}
            </Label>
            <Input
              id="funnel-to"
              type="date"
              value={to}
              className="h-8 w-[150px]"
              onChange={(e) => onRangeChange({ from, to: e.target.value })}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading || !data || !totals ? (
          <div role="status" className="py-8 text-center text-muted-foreground">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            <span className="sr-only">{t('common.loading')}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── ТОО ШИРХЭГ ── */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* «Нийт үүсгэсэн» нь ноорог ХАМТ — «Явуулсан» нь ноороггүй.
                  Хоёулаа зэрэг гарснаар тэдгээрийн ЗӨРӨӨ (хэдэн санал
                  ноорог дээрээ гацсан) өөрөө уншигдана. */}
              <Stat
                label={t('quotes.funnel.createdTotal')}
                value={String(totals.created_total)}
                hint={t('quotes.funnel.createdTotalHint')}
              />
              <Stat
                label={t('quotes.funnel.sentTotal')}
                value={String(totals.sent_total)}
                hint={t('quotes.funnel.sentTotalHint')}
              />
              <Stat label={t('quotes.funnel.won')} value={String(totals.won_count)} />
              <Stat
                label={t('quotes.funnel.winRate')}
                value={
                  winRate === null || winRate === undefined ? '—' : `${(winRate * 100).toFixed(1)}%`
                }
                emphasis
              />
            </div>

            {/* ── МӨНГӨН ДҮН ── */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label={t('quotes.funnel.createdAmount')}
                value={fmtAmount(totals.created_amount)}
                hint={t('quotes.funnel.createdTotalHint')}
                warn={coverageHint(t, totals.created_total, totals.created_amount_missing_count)}
              />
              <Stat
                label={t('quotes.funnel.quotedAmount')}
                value={fmtAmount(totals.quoted_amount)}
                warn={coverageHint(t, totals.sent_total, totals.quoted_amount_missing_count)}
              />
              <Stat
                label={t('quotes.funnel.contractedAmount')}
                value={fmtAmount(totals.contracted_amount)}
                warn={coverageHint(t, totals.won_count, totals.contracted_amount_missing_count)}
              />
            </div>

            {/* ── Шат тус бүр (тоо + дүн) ── */}
            {/* `overflow-hidden` — доод «Нийт» мөр дэвсгэртэй тул үүнгүйгээр
                өнгө нь дугуй буланг давж, өнцөг үүсгэнэ. */}
            <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border">
              {data.buckets.map((b) => (
                <BucketRow key={b.status} bucket={b} />
              ))}
              {/* Жагсаалтын хаалт: шатууд НИЙЛЭЭД хэд болохыг харуулна.
                  ⚠️ Сервер энэ нийлбэрийг шатуудаас БИШ, түүхий мөрөөс
                  тооцдог тул танихгүй статустай мөр байвал энэ мөр дээрх
                  шатуудын нийлбэрээс их гарна — тэр ЗӨРӨӨ нь дохио. */}
              <li className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {t('quotes.funnel.bucketTotal')}
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                  {t('quotes.funnel.countUnit', { count: totals.created_total })}
                </span>
                <span className="w-36 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                  {fmtAmount(totals.created_amount)}
                </span>
                {totals.created_amount_missing_count > 0 && (
                  <span className="shrink-0 text-micro text-warning">
                    {t('quotes.funnel.missingShort', {
                      count: totals.created_amount_missing_count,
                    })}
                  </span>
                )}
              </li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * «X/Y санал дүн бүртгэгдсэн» — дутууг ил гаргах мөр.
 * Бүгд бүртгэгдсэн бол мөр огт гарахгүй (шуугиан нэмэхгүй).
 */
function coverageHint(
  t: (key: string, vars?: Record<string, string | number>) => string,
  total: number,
  missing: number,
): string | undefined {
  if (missing <= 0) return undefined;
  return t('quotes.funnel.amountCoverage', { withAmount: total - missing, total, missing });
}

/**
 * `hint` ба `warn` нь ХОЁР ӨӨР зүйл, зориуд тусдаа:
 *   • `hint` — тайлбар («Ноорог хамт»), саарал. Анхаарал татах ёсгүй.
 *   • `warn` — ӨГӨГДЛИЙН ДУТАГДАЛ («12 санал дүнгүй»), шар. Файлын толгойд
 *     бичсэнээр энэ мөр нь мөнгөн дүнгийн хамрах хүрээг ил гаргах ҮҮРЭГТЭЙ.
 * Хоёуланг нэг өнгөөр гаргавал жинхэнэ анхааруулга тайлбарын дунд живнэ.
 */
function Stat({
  label,
  value,
  hint,
  warn,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="text-micro text-muted-foreground">{label}</p>
      <p
        className={
          emphasis
            ? 'text-title font-semibold tabular-nums text-primary'
            : 'text-lg font-semibold tabular-nums text-foreground'
        }
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-micro text-muted-foreground">{hint}</p>}
      {warn && <p className="mt-0.5 text-micro text-warning">{warn}</p>}
    </div>
  );
}

function BucketRow({ bucket }: { bucket: QuoteFunnelBucket }) {
  const { t } = useLanguage();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {t(QUOTE_STATUS_LABEL[bucket.status])}
      </span>
      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
        {t('quotes.funnel.countUnit', { count: bucket.count })}
      </span>
      <span className="w-36 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
        {fmtAmount(bucket.amount_sum)}
      </span>
      {bucket.amount_missing_count > 0 && (
        <span className="shrink-0 text-micro text-warning">
          {t('quotes.funnel.missingShort', { count: bucket.amount_missing_count })}
        </span>
      )}
    </li>
  );
}
