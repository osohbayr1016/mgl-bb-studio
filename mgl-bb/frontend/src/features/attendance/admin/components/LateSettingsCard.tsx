import { CheckCircle2, RefreshCw, Timer } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import type { AttendanceSettingsState } from '@/features/attendance/admin/hooks/useAttendanceSettings';

/** Хоцролтын тохиргоо — admin-only.  `attSettings === null` бол
 *  хэрэглэгчийн эрх хүрэхгүй байна гэж үзээд card-ыг нуудаг. */
export default function LateSettingsCard({ settings }: { settings: AttendanceSettingsState }) {
  const { t } = useLanguage();
  const {
    attSettings,
    graceInput,
    setGraceInput,
    penaltyInput,
    setPenaltyInput,
    lunchEnabled,
    setLunchEnabled,
    lunchStartInput,
    setLunchStartInput,
    lunchEndInput,
    setLunchEndInput,
    savingSettings,
    saveAttSettings,
  } = settings;

  if (!attSettings) return null;

  return (
    <Card id="sec-att-admin-late" className="border-border bg-card/60 backdrop-blur scroll-mt-24">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Timer className="h-4 w-4 text-primary" />
          {t('attendanceAdminPage.lateSettings')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="grace-input" className="text-xs">
              {t('attendanceAdminPage.graceLabel')}
            </Label>
            <Input
              id="grace-input"
              type="number"
              min={0}
              max={60}
              value={graceInput}
              onChange={(e) => setGraceInput(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('attendanceAdminPage.graceHelp')}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="penalty-input" className="text-xs">
              {t('attendanceAdminPage.penaltyLabel')}
            </Label>
            <Input
              id="penalty-input"
              type="number"
              min={0}
              max={100_000}
              value={penaltyInput}
              onChange={(e) => setPenaltyInput(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('attendanceAdminPage.penaltyHelp')}
            </p>
          </div>
        </div>
        {/* Цайны цагийн тохиргоо — ажилласан цагаас давхцлаар хасна. */}
        <div className="space-y-3 border-t border-border/60 pt-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={lunchEnabled}
              onChange={(e) => setLunchEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-sm font-medium">
              {t('attendanceAdminPage.lunchEnabledLabel')}
            </span>
          </label>
          <p className="text-[11px] text-muted-foreground">{t('attendanceAdminPage.lunchHelp')}</p>
          {lunchEnabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lunch-start" className="text-xs">
                  {t('attendanceAdminPage.lunchStartLabel')}
                </Label>
                <Input
                  id="lunch-start"
                  type="time"
                  value={lunchStartInput}
                  onChange={(e) => setLunchStartInput(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lunch-end" className="text-xs">
                  {t('attendanceAdminPage.lunchEndLabel')}
                </Label>
                <Input
                  id="lunch-end"
                  type="time"
                  value={lunchEndInput}
                  onChange={(e) => setLunchEndInput(e.target.value)}
                  className="tabular-nums"
                />
              </div>
            </div>
          )}
        </div>
        {attSettings.note && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">{attSettings.note}</p>
        )}
        <div className="flex justify-end">
          <Button onClick={saveAttSettings} disabled={savingSettings} className="gap-1.5" size="sm">
            {savingSettings ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {t('common.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
