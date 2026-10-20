import { Globe, Plus, Shield } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { ipv4ToCidr24, type OfficeIpsState } from '@/features/attendance/admin/hooks/useOfficeIps';

/** Оффисын IP нэмэх dialog (өөрийн IP / дэд сүлжээг санал болгоно). */
export default function AddIpDialog({ ips }: { ips: OfficeIpsState }) {
  const { t } = useLanguage();
  const {
    showAddIp,
    setShowAddIp,
    newIpLabel,
    setNewIpLabel,
    newIpAddress,
    setNewIpAddress,
    myIp,
    addIp,
  } = ips;

  return (
    <Dialog open={showAddIp} onOpenChange={setShowAddIp}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            {t('attendanceAdminPage.addIpTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t('common.name')}</Label>
            <Input
              placeholder={t('attendanceAdminPage.ipLabelPlaceholder')}
              value={newIpLabel}
              onChange={(e) => setNewIpLabel(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('attendanceAdminPage.ipOrCidr')}</Label>
            <Input
              placeholder={t('attendanceAdminPage.ipAddressPlaceholder')}
              value={newIpAddress}
              onChange={(e) => setNewIpAddress(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('attendanceAdminPage.cidrHelp1')}
              <br />
              <span className="font-medium">{t('attendanceAdminPage.example')}:</span>{' '}
              <code>138.252.29.0/24</code> = {t('attendanceAdminPage.cidrHelp2')}
            </p>
          </div>

          {myIp && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="text-xs">
                {t('attendanceAdminPage.yourCurrentIp')}:{' '}
                <code className="font-mono font-semibold">{myIp}</code>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1"
                  onClick={() => setNewIpAddress(myIp)}
                >
                  {t('attendanceAdminPage.useThisIp')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[11px] gap-1"
                  onClick={() => setNewIpAddress(ipv4ToCidr24(myIp))}
                >
                  {t('attendanceAdminPage.useSubnet', { cidr: ipv4ToCidr24(myIp) })}
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
            <Shield className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
            <span>{t('attendanceAdminPage.ipSecurityNote')}</span>
          </div>
          <Button onClick={addIp} disabled={!newIpLabel || !newIpAddress} className="w-full gap-2">
            <Plus className="h-4 w-4" />
            {t('common.add')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
