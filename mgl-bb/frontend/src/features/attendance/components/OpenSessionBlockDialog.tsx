/**
 * «Ирэх бүртгэл хийх боломжгүй» цонх.
 *
 * Ажилтан өмнөх өдөр гарах бүртгэлээ хийгээгүй бол ирэх бүртгэл нь сервер
 * дээр 409 (`code: 'OPEN_PRIOR_SESSION'`) авна.  Тэр үед улаан мөр биш,
 * ЗААВАЛ энэ цонх гарна — хаалт нь түр зуурын алдаа биш, ажилтан хүн рүү
 * очиж шийдвэрлүүлэх ёстой зүйл тул анзаарагдахгүй өнгөрөх ёсгүй.
 *
 * `confirmDialog` (shared/components/ConfirmDialog) тохирохгүй: тэр үргэлж
 * Цуцлах + Тийм гэсэн хоёр товч зурдаг бөгөөд энд сонголт байхгүй.
 */
import { AlertCircle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import type { BlockedOpenSession } from '@/features/attendance/openSessionBlock';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Хаалт үүсгэсэн бүртгэл — мэдэгдэж байвал огноог нь харуулна. */
  session?: BlockedOpenSession | null;
}

export default function OpenSessionBlockDialog({ open, onOpenChange, session }: Props) {
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `mobileFullScreen={false}` — жижиг мэдэгдлийн цонх утсан дээр ч
          бүтэн дэлгэц болохгүй, төвдөө байна (`ui/dialog.tsx`-ийн заавар). */}
      <DialogContent className="sm:max-w-md" mobileFullScreen={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            {t('attendancePage.blockedTitle')}
          </DialogTitle>
          <DialogDescription className="whitespace-pre-line leading-relaxed">
            {t('attendancePage.blockedBody')}
          </DialogDescription>
        </DialogHeader>

        {/* Аль өдрийнх нь хаагдаагүйг заавал хэлнэ — ажилтан менежментийн
            багт очихдоо огноогоо мэдэж очих ёстой. */}
        {session && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground">
            {t('attendancePage.blockedSince', { date: session.date })}
          </p>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} className="w-full">
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
