import { Bell, BellOff, BellRing, Loader2, Smartphone } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { usePushSubscription } from '@/shared/hooks/usePushSubscription';

/**
 * Тохиргоо хуудсан дахь push мэдэгдлийн хяналт.
 *
 * Зөвшөөрлийг ЗӨВХӨН эндээс (хэрэглэгчийн товшилтоор) асууна — mount дээр
 * автоматаар асуухыг NotificationsManager-ээс зориуд хассан.
 */
export function PushNotificationsCard() {
  const { t } = useLanguage();
  const { state, busy, error, subscribe, unsubscribe } = usePushSubscription();

  const body = (() => {
    switch (state) {
      case 'unsupported':
        return { text: t('notifications.pushUnsupported'), action: null };
      case 'ios-needs-install':
        return { text: t('notifications.pushNeedsInstall'), action: null };
      case 'denied':
        return { text: t('notifications.pushDenied'), action: null };
      case 'subscribed':
        return {
          text: t('notifications.pushEnabled'),
          action: (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void unsubscribe()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <BellOff className="size-4" />}
              {t('notifications.pushDisable')}
            </Button>
          ),
        };
      default:
        return {
          text: t('notifications.pushEnableBody'),
          action: (
            <Button size="sm" disabled={busy} onClick={() => void subscribe()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
              {t('notifications.pushEnableAction')}
            </Button>
          ),
        };
    }
  })();

  const Icon = state === 'subscribed' ? BellRing : state === 'ios-needs-install' ? Smartphone : Bell;

  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          {t('notifications.pushEnableTitle')}
        </CardTitle>
        <CardDescription>{body.text}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {body.action}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </CardContent>
    </Card>
  );
}
