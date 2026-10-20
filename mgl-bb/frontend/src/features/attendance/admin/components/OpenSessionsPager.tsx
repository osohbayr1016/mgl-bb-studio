import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import type { OpenSessionsState } from '@/features/attendance/admin/hooks/useOpenSessions';

/** «Хаагдаагүй» табын хуудаслалтын мөр — жагсаалт ба Excel хүснэгт хоёулаа
 *  хуваалцана (хоёр хувилбар нь ижил хуудсан дээр байх ёстой). */
export default function OpenSessionsPager({ open }: { open: OpenSessionsState }) {
  const { t } = useLanguage();
  const { filteredOpenSessions, openPageCount, openPageSafe, setOpenPage } = open;

  if (openPageCount <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-2 pt-3 no-print">
      <span className="text-xs text-muted-foreground tabular-nums">
        {t('attendanceAdminPage.openPageInfo', {
          page: openPageSafe + 1,
          pages: openPageCount,
          total: filteredOpenSessions.length,
        })}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={openPageSafe <= 0}
          onClick={() => setOpenPage((p) => Math.max(0, p - 1))}
        >
          {t('attendanceAdminPage.prevPage')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={openPageSafe >= openPageCount - 1}
          onClick={() => setOpenPage((p) => Math.min(openPageCount - 1, p + 1))}
        >
          {t('attendanceAdminPage.nextPage')}
        </Button>
      </div>
    </div>
  );
}
