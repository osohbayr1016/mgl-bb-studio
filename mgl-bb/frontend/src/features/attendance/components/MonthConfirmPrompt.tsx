/**
 * Сарын эхний «ирцээ баталгаажуулна уу» цонх (2026-10-01, эзний хүсэлт).
 *
 * Шинэ сар эхэлмэгц өмнөх сарын ирцээ «Батлах» эсвэл «Зөрчилтэй» гэж
 * хариулаагүй ажилтанд гарна; «Ирцээ шалгах» нь Ирц хуудасны «Миний сарын
 * ирц» карт руу үсрүүлнэ (батлах товчнууд тэнд — хүн ирцээ ХАРЖ байж батална).
 * Хариулмагц (`MyDailyAttendanceCard` нь due query-г invalidate хийдэг)
 * сануулга бүрмөсөн алга болно.  Түүнээс өмнө:
 *   • ирсэн бүртгэл хийх БҮРД гарна (`announceClockIn`);
 *   • аппыг шинэ таб/өдөрт нээх бүрд нэг удаа гарна — «Дараа» нь зөвхөн тэр
 *     табын тэр өдрийнхийг хаана (sessionStorage).
 *
 * Хэнд гарах нь СЕРВЕРИЙН шийдвэр (`GET /attendance-confirmations/due` —
 * roster, ажилд орсон огноо, хариулт).  Энд зөвхөн хандах эрхгүй ролиудыг
 * (клиент, цэвэрлэгч, CEO) дуудлагаас өмнө тасална.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarCheck } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { isCeo } from '@/shared/lib/ceo';
import { isWorkerRole } from '@/shared/lib/roles';
import { todayUB } from '@/shared/lib/time';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import {
  CLOCKED_IN_EVENT,
  MONTH_CONFIRM_DUE_KEY,
  monthlySectionHref,
  monthLabel,
  type MonthConfirmDue,
} from '@/features/attendance/monthConfirm';

function readDismissed(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDismissed(key: string, day: string): void {
  try {
    sessionStorage.setItem(key, day);
  } catch {
    /* хувийн цонх / хориглосон storage — дараагийн рендерт state хангана */
  }
}

export default function MonthConfirmPrompt() {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const eligible =
    !!user && user.role !== 'client' && !isWorkerRole(user.role) && !isCeo(user);
  const { data } = useApiQuery<MonthConfirmDue>(
    MONTH_CONFIRM_DUE_KEY,
    '/attendance-confirmations/due',
    { enabled: eligible, retry: false, staleTime: 5 * 60_000 },
  );

  // Хаасан өдрийг state-д ч барина — storage хориглогдсон үед ч цонх хаагдана.
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  // Ирсэн бүртгэл хийсэн даруйд өнөөдөр хаасан ч дахин гаргана.
  const [forced, setForced] = useState(false);

  useEffect(() => {
    const onClockIn = () => {
      setForced(true);
      void queryClient.invalidateQueries({ queryKey: MONTH_CONFIRM_DUE_KEY });
    };
    window.addEventListener(CLOCKED_IN_EVENT, onClockIn);
    return () => window.removeEventListener(CLOCKED_IN_EVENT, onClockIn);
  }, [queryClient]);

  const month = eligible ? (data?.due?.month ?? null) : null;
  const changed = data?.due?.reason === 'changed';
  if (!month || !user) return null;

  // «Дараа» нь тэр шалтгааных л — хариултгүй сарын сануулгыг хаасан ч «өөрчлөгдсөн» сануулга тэр өдөр гарна.
  const storageKey = `mgl:month-confirm-dismissed:${user.id}:${month}${changed ? ':changed' : ''}`;
  const today = todayUB();
  const dismissedOn = dismissed[storageKey] ?? readDismissed(storageKey);
  const open = forced || dismissedOn !== today;
  const label = monthLabel(month, lang);

  const dismiss = () => {
    writeDismissed(storageKey, today);
    setDismissed((prev) => ({ ...prev, [storageKey]: today }));
    setForced(false);
  };

  const review = () => {
    dismiss();
    navigate(monthlySectionHref(month));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      {/* Жижиг мэдэгдлийн цонх — утсан дээр ч бүтэн дэлгэц болохгүй. */}
      <DialogContent className="sm:max-w-md" mobileFullScreen={false}>
        {/* Утсан дээр ч зүүн тэгш — дүрс гарчгийн мөрөнд наалдаж үлдэнэ. */}
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 shrink-0 text-primary" />
            {t(changed ? 'monthConfirm.changedTitle' : 'monthConfirm.title', { month: label })}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t(changed ? 'monthConfirm.changedBody' : 'monthConfirm.body', { month: label })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="leading-relaxed">{t('monthConfirm.dispute')}</p>
        </div>

        <p className="text-xs text-muted-foreground">{t('monthConfirm.persist')}</p>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={dismiss}>
            {t('monthConfirm.later')}
          </Button>
          <Button onClick={review} className="gap-1.5">
            {t('monthConfirm.review')}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
