/**
 * Илүү цаг — ЗӨВХӨН МЭДЭЭЛЛИЙН карт (read-only), ирцийн хуудсан дээр.
 *
 * Түүх: 2026-08-10-нд (commit 65031ee + migration 0171) илүү цагийн хүсэлтийн
 * функц UI/API/хүснэгт гурвуулаа бүрмөсөн хасагдсан.  2026-08-12-нд sidebar-ын
 * «Илүү цаг» мөр ба `/app/overtime` хуудас нь ч хасагдсан — журмын мэдэгдэл нь
 * ЗӨВХӨН ЭНЭ КАРТААР, `/app/attendance` дээр л үлдэнэ.
 *
 * Тиймээс энэ файл зориуд:
 *   - ямар ч `apiFetch` дуудлагагүй (`/api/overtime` сервер дээр байхгүй),
 *   - ямар ч form / dialog / «Шинэ хүсэлт» товчгүй,
 *   - ямар ч state-гүй — цэвэр статик текст.
 *
 * Хэрэв хэзээ нэгэн цагт хүсэлтийн урсгалыг эргүүлж авчрах бол backend
 * (routes/overtime.ts + overtime_requests хүснэгт) -ийг эхлээд сэргээнэ.
 * Тэрийг git-ээс: `git show 65031ee^:backend/src/routes/overtime.ts`.
 */
import { Zap, FileText, ClipboardCheck, Info } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { useLanguage } from '@/shared/i18n';

export default function MyOvertimeCard() {
  const { t } = useLanguage();

  return (
    <Card id="sec-attendance-overtime" className="border-border bg-card/60 backdrop-blur scroll-mt-24">
      <CardHeader className="pb-3 flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center flex-wrap gap-2 text-base min-w-0">
          <Zap className="h-4 w-4 shrink-0 text-warning" />
          {t('myOvertimeCard.title')}
          <Badge
            variant="outline"
            className="text-micro bg-warning/10 text-warning border-warning/30"
          >
            {t('myOvertimeCard.badge')}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* 1-р мөр — журмын гол өөрчлөлт.  Анхаарал татахын тулд шар хүрээтэй. */}
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-3 flex items-start gap-3">
          <FileText className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
          <p className="text-sm text-foreground leading-relaxed">
            {t('myOvertimeCard.noticeWritten')}
          </p>
        </div>
        {/* 2-3-р мөр — ажилтны хийх үйлдэл ба бүртгэлийн болзол. */}
        <div className="mt-3 flex items-start gap-3 px-3">
          <ClipboardCheck className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t('myOvertimeCard.noticeForm')}
          </p>
        </div>
        <div className="mt-3 flex items-start gap-3 px-3">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t('myOvertimeCard.noticeRecord')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
