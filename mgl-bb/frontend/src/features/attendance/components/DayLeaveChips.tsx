import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { DailyAttendanceRow } from '@/shared/types';
import { LEAVE_TYPE_META } from '@/features/attendance/admin/constants';
import { LEAVE_TYPE_TONE } from '@/shared/lib/status-colors';

const PAID_TONE = 'border-success/30 bg-success/10 text-success';

/**
 * «Бусад» төрлийн чөлөөний нэр хэвээр, өнгө нь цалингаар: цалинтай → ногоон,
 * цалингүй → улбар шар («Цалингүй» chip-тэй ижил).  `is_paid` NULL (хуучин
 * бичлэг) нь цалинтай — backend цагийн бодолт (`paidMinutes`) цалингүйгээс
 * бусдыг цалинтай гэж тооцдогтой ижил.  `undefined` = `is_paid`-гүй хуучин API,
 * тэр үед мэдэхгүй тул хуучин саарал өнгө хэвээр.
 */
function leaveChipTone(type: string, isPaid: number | null | undefined, fallback: string): string {
  if (type !== 'other' || isPaid === undefined) return fallback;
  return isPaid === 0 ? LEAVE_TYPE_TONE.unpaid : PAID_TONE;
}

/**
 * Ирцийн өдрийн хүснэгтийн «Чөлөө» нүд — тухайн өдрийн БҮХ чөлөө (`leave_parts`).
 * Нэг өдөр хоёр чөлөөтэй хүнд (08:30–12:00 + 12:00–17:30) өмнө нь зөвхөн
 * эхнийх нь харагддаг байв.  Хуучин API (`leave_parts`-гүй) бол `leave_type`.
 * Ажилтны «Миний сарын ирц» ба админы Тайлан grid хоёулаа үүнийг хэрэглэнэ.
 */
export default function DayLeaveChips({
  row: r,
  chipClassName,
}: {
  row: DailyAttendanceRow;
  /** Үсгийн хэмжээ — хоёр хүснэгт өөр (`text-micro` / `text-[10px]`). */
  chipClassName: string;
}) {
  const { t } = useLanguage();
  if (!r.is_on_leave) return null;
  const parts =
    r.leave_parts && r.leave_parts.length > 0
      ? r.leave_parts
      : r.leave_type
        ? [
            {
              leave_id: 0,
              leave_type: r.leave_type,
              is_paid: undefined,
              reason: r.leave_reason,
              start_time: '',
              end_time: '',
            },
          ]
        : [];
  if (parts.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-0.5">
      {parts.map((p, i) => {
        const meta = LEAVE_TYPE_META[p.leave_type];
        const Icon = meta.icon;
        const label = t(meta.labelKey);
        const window = p.start_time && p.end_time ? `${p.start_time}–${p.end_time}` : null;
        const title = [window ? `${label} · ${window}` : label, p.reason].filter(Boolean).join('\n');
        return (
          <span
            key={`${p.leave_id}-${i}`}
            className={cn(
              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 whitespace-nowrap',
              chipClassName,
              leaveChipTone(p.leave_type, p.is_paid, meta.tone),
            )}
            title={title}
          >
            <Icon className="h-3 w-3" />
            {label}
            {parts.length > 1 && window && (
              <span className="tabular-nums opacity-80">{window}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
