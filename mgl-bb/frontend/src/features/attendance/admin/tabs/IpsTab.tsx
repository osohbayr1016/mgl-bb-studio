import type { AttendanceSettingsState } from '@/features/attendance/admin/hooks/useAttendanceSettings';
import type { OfficeIpsState } from '@/features/attendance/admin/hooks/useOfficeIps';
import LateSettingsCard from '@/features/attendance/admin/components/LateSettingsCard';
import OfficeIpsCard from '@/features/attendance/admin/components/OfficeIpsCard';
import AddIpDialog from '@/features/attendance/admin/components/AddIpDialog';

/** «IP / Тохиргоо» таб — хоцролт+цайны цаг, оффисын IP жагсаалт. */
export default function IpsTab({
  settings,
  ips,
}: {
  settings: AttendanceSettingsState;
  ips: OfficeIpsState;
}) {
  return (
    <>
      <LateSettingsCard settings={settings} />
      <OfficeIpsCard ips={ips} settings={settings} />
      <AddIpDialog ips={ips} />
    </>
  );
}
