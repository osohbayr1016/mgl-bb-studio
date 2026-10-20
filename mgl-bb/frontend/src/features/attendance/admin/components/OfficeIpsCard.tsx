import { Globe, MonitorSmartphone, Plus, ToggleLeft, ToggleRight, Trash2, Wifi, WifiOff } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import type { AttendanceSettingsState } from '@/features/attendance/admin/hooks/useAttendanceSettings';
import type { OfficeIpsState } from '@/features/attendance/admin/hooks/useOfficeIps';

/** Оффисын IP жагсаалт + «бүх төхөөрөмжөөс зөвшөөрөх» master toggle. */
export default function OfficeIpsCard({
  ips,
  settings,
}: {
  ips: OfficeIpsState;
  settings: AttendanceSettingsState;
}) {
  const { t } = useLanguage();
  const { officeIps, setShowAddIp, deleteIp, toggleIp } = ips;
  const { attSettings, savingSettings, setRequireOfficeIp, setDeviceHwMatch } = settings;
  // Backend хуучин бол талбар байхгүй → өгөгдмөл асаалттай гэж үзнэ.
  const hwMatch = attSettings?.device_hw_match ?? true;

  return (
    <Card id="sec-att-admin-ips" className="border-border bg-card/60 backdrop-blur scroll-mt-24">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-primary" />
            {t('attendanceAdminPage.officeIps')}
          </CardTitle>
          <Button size="sm" className="gap-1.5" onClick={() => setShowAddIp(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('attendanceAdminPage.addIp')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Master toggle — оффисын IP шалгалтыг бүхэлд нь унтраах.
            ON (асаалттай) = бүх төхөөрөмжөөс зөвшөөрнө = require_office_ip=false. */}
        {attSettings && (
          <div
            className={`mb-4 flex items-start gap-3 rounded-lg border p-3 ${
              attSettings.require_office_ip
                ? 'border-border/60 bg-muted/20'
                : 'border-warning/30 bg-warning/10'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t('attendanceAdminPage.allowAnyDeviceLabel')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {attSettings.require_office_ip
                  ? t('attendanceAdminPage.allowAnyDeviceHintOff')
                  : t('attendanceAdminPage.allowAnyDeviceHintOn')}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              disabled={savingSettings}
              aria-label={t('attendanceAdminPage.allowAnyDeviceLabel')}
              onClick={() => setRequireOfficeIp(!attSettings.require_office_ip)}
            >
              {!attSettings.require_office_ip ? (
                <ToggleRight className="h-5 w-5 text-warning" />
              ) : (
                <ToggleLeft className="h-5 w-5 text-muted-foreground" />
              )}
            </Button>
          </div>
        )}

        {/* Ижил компьютерийн шинэ браузерыг автоматаар таних (attendance_devices, 0328).
            ON = Chrome → Edge / PWA / storage цэвэрлэсэн үед техник хангамжийн
            профайл таарвал admin reset-гүй холбогдоно.  OFF = зөвхөн яг таарсан браузер. */}
        {attSettings && (
          <div
            className={`mb-4 flex items-start gap-3 rounded-lg border p-3 ${
              hwMatch ? 'border-border/60 bg-muted/20' : 'border-warning/30 bg-warning/10'
            }`}
          >
            <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t('attendanceAdminPage.deviceHwMatchLabel')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {hwMatch
                  ? t('attendanceAdminPage.deviceHwMatchHintOn')
                  : t('attendanceAdminPage.deviceHwMatchHintOff')}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              disabled={savingSettings}
              aria-label={t('attendanceAdminPage.deviceHwMatchLabel')}
              onClick={() => setDeviceHwMatch(!hwMatch)}
            >
              {hwMatch ? (
                <ToggleRight className="h-5 w-5 text-emerald-500" />
              ) : (
                <ToggleLeft className="h-5 w-5 text-warning" />
              )}
            </Button>
          </div>
        )}

        {officeIps.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Globe className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm mb-3">{t('attendanceAdminPage.noIpsRegistered')}</p>
            <p className="text-xs text-muted-foreground">{t('attendanceAdminPage.noIpsHelp')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {officeIps.map((ip) => (
              <div
                key={ip.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/60 hover:bg-muted/30 transition-colors"
              >
                <div
                  className={`h-9 w-9 rounded-full flex items-center justify-center ${
                    ip.is_active ? 'bg-emerald-500/10' : 'bg-muted'
                  }`}
                >
                  {ip.is_active ? (
                    <Wifi className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{ip.label}</p>
                  <code className="text-xs text-muted-foreground font-mono">{ip.ip_address}</code>
                </div>
                <Badge
                  variant="outline"
                  className={
                    ip.is_active
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                      : 'bg-muted text-muted-foreground'
                  }
                >
                  {ip.is_active
                    ? t('attendanceAdminPage.active')
                    : t('attendanceAdminPage.inactive')}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => toggleIp(ip.id)}
                >
                  {ip.is_active ? (
                    <ToggleRight className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteIp(ip.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
