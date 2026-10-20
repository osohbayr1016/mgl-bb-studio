import { CalendarDays } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { formatHours } from '@/features/attendance/admin/utils/format';

type DailyRow = {
  date: string;
  employees_present: number;
  avg_hours: number;
  total_hours: number;
};

/** Өдөр тутмын задаргаа (ирсэн хүн / дундаж цаг / нийт цаг).
 *
 *  ⚠️ Энэ хүснэгт нь `GET /api/attendance/report`-оос СЕРВЕР ТАЛД аль хэдийн
 *  нэгтгэгдэж ирдэг (өдөр бүрээр `COUNT(DISTINCT user_id)` / `SUM(hours_worked)`),
 *  тул багаар нь буцааж задлах боломжгүй — багийн шүүлт үүнд НӨЛӨӨЛӨХГҮЙ.
 *  Мөн цагийн хүснэгтээс өөр хэмжигдэхүүн (түүхий `hours_worked`, цайны хасалтгүй)
 *  тул grid-ээс дахин тооцоолж «шүүсэн» болгох нь тоог өөрчилнө.  Иймд шүүлт
 *  идэвхтэй үед үүнийг ЧИМЭЭГҮЙ орхихын оронд ил тайлбарлана. */
export default function ReportDailyBreakdown({
  rows,
  teamFiltered = false,
}: {
  rows: DailyRow[];
  /** Багийн шүүлт идэвхтэй эсэх — зөвхөн анхааруулга харуулахад. */
  teamFiltered?: boolean;
}) {
  const { t } = useLanguage();
  if (rows.length === 0) return null;

  return (
    <Card id="sec-att-admin-daily" className="border-border bg-card/60 backdrop-blur scroll-mt-24">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4 text-primary" />
          {t('attendanceAdminPage.dailyBreakdown')}
        </CardTitle>
        {teamFiltered && (
          <p className="text-xs text-muted-foreground pt-1">
            {t('attendanceAdminPage.dailyBreakdownAllTeams')}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 px-3 font-medium">
                  {t('attendanceAdminPage.colDate')}
                </th>
                <th className="text-right py-2 px-3 font-medium">
                  {t('attendanceAdminPage.employee')}
                </th>
                <th className="text-right py-2 px-3 font-medium">
                  {t('attendanceAdminPage.avgHours')}
                </th>
                <th className="text-right py-2 px-3 font-medium">
                  {t('attendanceAdminPage.totalHours')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.date} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="py-2.5 px-3 font-medium">{d.date}</td>
                  <td className="py-2.5 px-3 text-right">{d.employees_present}</td>
                  <td className="py-2.5 px-3 text-right">{formatHours(d.avg_hours)}</td>
                  <td className="py-2.5 px-3 text-right font-semibold">
                    {formatHours(d.total_hours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
