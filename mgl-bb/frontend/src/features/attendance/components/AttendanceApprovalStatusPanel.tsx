import { useMemo, useState } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { Card, CardHeader, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { ClipboardCheck, CheckCircle2, AlertTriangle, Clock, Loader2, ChevronDown } from 'lucide-react';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';

/** Хамгийн эрт батлагдах сар — backend-ийн EARLIEST_MONTH-тэй ижил. */
const EARLIEST_MONTH = '2026-06';

interface ApprovalOverviewRow {
  user_id: number;
  full_name: string;
  employee_id: string | null;
  profile_image: string | null;
  status: 'confirmed' | 'disputed' | 'requested' | null;
  response_note: string | null;
  responded_at: string | null;
  /** 0403 — хариулсны дараа ирц засагдсан; ажилтан дахин батлах ёстой. */
  changed_since_answer?: boolean;
}

/** Одоогийн UB сар 'YYYY-MM' (naive new Date() биш, UB timezone-оор). */
function ubMonthNow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}`;
}

/** Өмнөх сар 'YYYY-MM'. */
function prevMonth(month: string): string {
  let y = Number(month.slice(0, 4));
  let m = Number(month.slice(5, 7)) - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Админ/ахлах: ажилтан бүрийн тухайн САРЫН өөрийн батлалтын төлөв (read-only).
 * Батлагдсан / Зөрчилтэй / Батлаагүй.  Хуучин "хүсэлт явуулах" панелийг орлоно.
 * Daily-grid (Тайлан) таб дотор байрлана.
 */
export default function AttendanceApprovalStatusPanel() {
  const { t } = useLanguage();
  // Сүүлийн ДУУССАН сар (одоогийн сарын өмнөх), 2026-06-аас багагүй — default.
  const latestCompleted = useMemo(() => {
    const p = prevMonth(ubMonthNow());
    return p < EARLIEST_MONTH ? EARLIEST_MONTH : p;
  }, []);
  // Read-only самбар тул явагдаж буй сарыг ч сонгож болно (бүгд "Батлаагүй"
  // харагдана — байх ёстой байдал).
  const currentMonth = useMemo(() => {
    const cur = ubMonthNow();
    return cur < EARLIEST_MONTH ? EARLIEST_MONTH : cur;
  }, []);
  const [month, setMonth] = useState(latestCompleted);
  // Урт жагсаалт тул анхнаасаа эвхэгдсэн — толгойн гарчиг дээр дарж дэлгэнэ.
  const [open, setOpen] = useState(false);

  const query = useApiQuery<{ month: string; rows: ApprovalOverviewRow[] }>(
    ['/attendance-confirmations/overview', month],
    `/attendance-confirmations/overview?month=${month}`,
    { retry: false },
  );
  const rows = query.data?.rows ?? [];

  const counts = useMemo(() => {
    let approved = 0;
    let disputed = 0;
    let notApproved = 0;
    for (const r of rows) {
      if (r.status === 'confirmed') approved += 1;
      else if (r.status === 'disputed') disputed += 1;
      else notApproved += 1;
    }
    return { approved, disputed, notApproved };
  }, [rows]);

  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex flex-wrap items-center gap-2 text-base leading-none font-semibold text-left transition-colors hover:text-primary"
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                open ? '' : '-rotate-90',
              )}
            />
            <ClipboardCheck className="h-4 w-4 text-primary" />
            {t('attendanceApproval.title')}
            <span className="flex items-center gap-1.5 ml-1">
              <Badge
                variant="outline"
                className="text-micro bg-success/10 text-success border-success/30"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {counts.approved}
              </Badge>
              <Badge
                variant="outline"
                className="text-micro bg-danger/10 text-danger border-danger/30"
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                {counts.disputed}
              </Badge>
              <Badge variant="outline" className="text-micro bg-muted text-muted-foreground">
                <Clock className="h-3 w-3 mr-1" />
                {counts.notApproved}
              </Badge>
            </span>
          </button>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">{t('attendanceApproval.month')}</Label>
            <Input
              type="month"
              value={month}
              min={EARLIEST_MONTH}
              max={currentMonth}
              onChange={(e) => setMonth(e.target.value || latestCompleted)}
              className="h-8 w-auto text-sm"
            />
          </div>
        </div>
      </CardHeader>
      {open && (
      <CardContent className="p-0">
        {query.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t('attendanceApproval.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">
                    {t('attendanceApproval.employee')}
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    {t('attendanceApproval.statusCol')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id} className="border-b border-border/30">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDisplayName(r.full_name)}</td>
                    <td className="px-3 py-2">
                      {r.status === 'confirmed' ? (
                        <Badge
                          variant="outline"
                          className="text-micro bg-success/10 text-success border-success/30"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {t('attendanceApproval.approved')}
                        </Badge>
                      ) : r.status === 'disputed' ? (
                        <Badge
                          variant="outline"
                          className="text-micro bg-danger/10 text-danger border-danger/30"
                          title={r.response_note ?? ''}
                        >
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {t('attendanceApproval.disputed')}
                          {r.response_note ? ` — ${r.response_note}` : ''}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-micro bg-muted text-muted-foreground">
                          {t('attendanceApproval.notApproved')}
                        </Badge>
                      )}
                      {r.changed_since_answer && (
                        <Badge
                          variant="outline"
                          className="ml-1.5 text-micro bg-warning/10 text-warning border-warning/30"
                          title={t('attendanceApproval.changedTitle')}
                        >
                          {t('attendanceApproval.changed')}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}
