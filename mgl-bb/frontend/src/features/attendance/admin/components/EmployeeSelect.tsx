import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import type { StaffOption } from '@/features/attendance/admin/hooks/useStaffOptions';

/** Ажилтан сонгох талбар — ирц нөхөх / чөлөө бүртгэх диалогуудад нийтлэг. */
export default function EmployeeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: StaffOption[];
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{t('attendanceAdminPage.employee')}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t('attendanceAdminPage.manualSelectUser')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((u) => (
            <SelectItem key={u.id} value={String(u.id)}>
              {formatDisplayName(u.full_name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
