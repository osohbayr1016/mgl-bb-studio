import {
  AlertTriangle,
  BarChart3,
  CalendarRange,
  ClipboardList,
  Clock,
  Globe,
  MapPin,
  Timer,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { TabsList, TabsTrigger } from '@/ui/tabs';

/** Табны толгой дээрх тоолуурын bubble. */
function Count({ value, className }: { value: number; className: string }) {
  if (value <= 0) return null;
  return (
    <span
      className={`ml-1 inline-flex h-4 min-w-4 px-1 items-center justify-center rounded-full text-[9px] font-bold ${className}`}
    >
      {value}
    </span>
  );
}

/** Ирцийн самбарын 8 таб.  grid-cols-N нь TabsTrigger-ийн ТООТОЙ таарч байх ёстой.
 *
 *  ⚠️ `TabsTrigger` нь `whitespace-nowrap`-тай (ui/tabs.tsx) тул нүд нь
 *     шошгоосоо нарийсвал текст хөршийнхөө дээгүүр ГАРНА — таслагдахгүй.
 *     8 дахь таб нэмэгдэхэд нарийн дэлгэц дээр яг тэр болох тул `sm:` -ээс
 *     доош ХОЁР мөр болгов (4×2). */
export default function AttendanceAdminTabsList({
  openCount,
  leavePendingCount,
  oooPendingCount,
}: {
  openCount: number;
  leavePendingCount: number;
  oooPendingCount: number;
}) {
  const { t } = useLanguage();
  return (
    <TabsList className="grid w-full grid-cols-4 sm:grid-cols-8 max-w-6xl">
      <TabsTrigger value="today" className="gap-1.5 text-xs">
        <Clock className="h-3.5 w-3.5" /> {t('attendanceAdminPage.tabToday')}
      </TabsTrigger>
      <TabsTrigger value="open" className="gap-1.5 text-xs relative">
        <AlertTriangle className="h-3.5 w-3.5" /> {t('attendanceAdminPage.tabOpen')}
        <Count value={openCount} className="bg-warning text-warning-foreground" />
      </TabsTrigger>
      <TabsTrigger value="reports" className="gap-1.5 text-xs">
        <BarChart3 className="h-3.5 w-3.5" /> {t('attendanceAdminPage.tabReports')}
      </TabsTrigger>
      <TabsTrigger value="summary" className="gap-1.5 text-xs">
        <ClipboardList className="h-3.5 w-3.5" /> {t('attendanceAdminPage.tabSummary')}
      </TabsTrigger>
      <TabsTrigger value="leaves" className="gap-1.5 text-xs relative">
        <CalendarRange className="h-3.5 w-3.5" /> {t('attendanceAdminPage.tabLeaves')}
        <Count value={leavePendingCount} className="bg-yellow-500 text-white" />
      </TabsTrigger>
      <TabsTrigger value="outofoffice" className="gap-1.5 text-xs relative">
        <MapPin className="h-3.5 w-3.5" /> {t('attendanceAdminPage.tabOutOfOffice')}
        <Count value={oooPendingCount} className="bg-teal-500 text-white" />
      </TabsTrigger>
      <TabsTrigger value="shifts" className="gap-1.5 text-xs">
        <Timer className="h-3.5 w-3.5" /> {t('attendanceAdminPage.tabShifts')}
      </TabsTrigger>
      <TabsTrigger value="ips" className="gap-1.5 text-xs">
        <Globe className="h-3.5 w-3.5" /> {t('attendanceAdminPage.tabIps')}
      </TabsTrigger>
    </TabsList>
  );
}
