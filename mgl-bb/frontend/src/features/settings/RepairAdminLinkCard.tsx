import { Link } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';

export function RepairAdminLinkCard() {
  const { t } = useLanguage();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-primary-ink" aria-hidden />
          {t('repair.adminTabTitle')}
        </CardTitle>
        <CardDescription>{t('repair.adminTabSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link to="/app/approvals?view=repair">{t('settingsPage.openRepairAdmin')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
