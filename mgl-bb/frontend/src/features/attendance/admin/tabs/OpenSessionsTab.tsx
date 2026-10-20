import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import type { AttendanceSession } from '@/shared/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import type { OpenSessionsState } from '@/features/attendance/admin/hooks/useOpenSessions';
import OpenSessionsFilters from '@/features/attendance/admin/components/OpenSessionsFilters';
import OpenSessionsList from '@/features/attendance/admin/components/OpenSessionsList';
import OpenSessionsTable from '@/features/attendance/admin/components/OpenSessionsTable';
import BulkCloseDialog from '@/features/attendance/admin/components/BulkCloseDialog';

/** «Хаагдаагүй» таб — гарах цаг бүртгээгүй өмнөх өдрүүдийн session-ууд. */
export default function OpenSessionsTab({
  open,
  onFixClockOut,
}: {
  open: OpenSessionsState;
  onFixClockOut: (s: AttendanceSession) => void;
}) {
  const { t } = useLanguage();
  const { openSessions, filteredOpenSessions, openView, openTotal, openTruncated } = open;

  return (
    <>
      <Card id="sec-att-admin-open" className="border-border bg-card/60 backdrop-blur scroll-mt-24">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" />
            {t('attendanceAdminPage.openSessionsTitle', { count: openTotal })}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t('attendanceAdminPage.openSessionsHint')}
          </p>
          {/* Server тал хязгаартай.  Хэвлэсэн баримтыг сениорт «таны багийн
              бүх өр» гэж өгдөг тул дутуу байвал ЗААВАЛ хэлнэ. */}
          {openTruncated && (
            <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t('attendanceAdminPage.openTruncated', {
                shown: openSessions.length,
                total: openTotal,
              })}
            </p>
          )}
          <OpenSessionsFilters open={open} />
        </CardHeader>
        <CardContent>
          {openSessions.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('attendanceAdminPage.openEmpty')}
            </p>
          ) : filteredOpenSessions.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('attendanceAdminPage.openNoMatch')}
            </p>
          ) : openView === 'table' ? (
            <OpenSessionsTable open={open} onFixClockOut={onFixClockOut} />
          ) : (
            <OpenSessionsList open={open} onFixClockOut={onFixClockOut} />
          )}
        </CardContent>
      </Card>

      <BulkCloseDialog open={open} />
    </>
  );
}
