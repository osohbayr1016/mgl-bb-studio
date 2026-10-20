/**
 * /app/admin/email — Gmail хайрцгуудын удирдлага (admin-tier).
 *
 * Workspace хайрцгийг хаягаар нь шууд нэмнэ (service account + domain-wide
 * delegation — нэвтрэх шаардлагагүй).  Энгийн @gmail-ийг "Холбох" товчоор
 * Google consent рүү шилжүүлж OAuth-оор холбоно.  Хайрцаг бүрд холболтыг
 * шалгах (Test), идэвх асаах/унтраах, устгах боломжтой.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mail,
  Plus,
  RefreshCw,
  Loader2,
  Trash2,
  PlugZap,
  CheckCircle2,
  AlertTriangle,
  Link2,
  History,
} from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import {
  createAccount,
  deleteAccount,
  updateAccount,
  testAccount,
  startOAuth,
  syncNow,
  backfill,
} from '@/features/email/api/email';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import type { EmailAccount } from '@/features/email/types/email';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/EmptyState';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Badge } from '@/ui/badge';
import { Checkbox } from '@/ui/checkbox';
import { toast } from '@/shared/components/Toast';
import { formatDate } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { brand } from '@/shared/config/brand';
import { EmailAccountTeamsEditor } from '@/features/email/components/EmailAccountTeamsEditor';

export default function EmailAccountsAdminPage() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading } = useApiQuery<{ accounts: EmailAccount[] }>('/email/accounts');
  const accounts = data?.accounts ?? [];

  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [oauthAddress, setOauthAddress] = useState('');
  const [testingId, setTestingId] = useState<number | null>(null);

  // Surface the OAuth callback redirect result once, then clean the URL.
  useEffect(() => {
    if (!searchParams.has('connected')) return;
    const ok = searchParams.get('connected') === '1';
    if (ok) toast.success(t('emailAccountsAdminPage.gmailConnected'));
    else
      toast.error(
        t('emailAccountsAdminPage.connectError', {
          error: searchParams.get('error') ?? t('emailAccountsAdminPage.unknown'),
        }),
      );
    searchParams.delete('connected');
    searchParams.delete('error');
    setSearchParams(searchParams, { replace: true });
    qc.invalidateQueries({ queryKey: ['/email/accounts'] });
  }, [searchParams, setSearchParams, qc]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['/email/accounts'] });

  const addWorkspace = useMutation({
    mutationFn: () => createAccount({ address: newAddress.trim(), label: newLabel.trim() }),
    onSuccess: () => {
      toast.success(t('emailAccountsAdminPage.accountAdded'));
      setNewAddress('');
      setNewLabel('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connectGmail = useMutation({
    mutationFn: () => startOAuth(oauthAddress.trim()),
    onSuccess: (res) => {
      window.location.href = res.url; // → Google consent
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: (a: EmailAccount) => updateAccount(a.id, { is_active: a.is_active !== 1 }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteAccount(id),
    onSuccess: () => {
      toast.success(t('emailAccountsAdminPage.accountDeleted'));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: () => syncNow(),
    onSuccess: (res) => {
      const stored = res.results.reduce((n, r) => n + r.stored, 0);
      const errs = res.results.filter((r) => r.error);
      toast.success(
        errs.length
          ? t('emailAccountsAdminPage.syncDoneWithErrors', { count: stored, errors: errs.length })
          : t('emailAccountsAdminPage.syncDone', { count: stored }),
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [backfillDays, setBackfillDays] = useState('180');
  const backfillMut = useMutation({
    mutationFn: () => backfill(Number(backfillDays)),
    onSuccess: (res) => {
      const stored = res.results.reduce((n, r) => n + r.stored, 0);
      const truncated = res.results.some((r) => r.truncated);
      toast.success(
        truncated
          ? t('emailAccountsAdminPage.deepSyncDoneTruncated', { count: stored })
          : t('emailAccountsAdminPage.deepSyncDone', { count: stored }),
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runTest = async (id: number) => {
    setTestingId(id);
    try {
      const res = await testAccount(id);
      if (res.ok)
        toast.success(
          t('emailAccountsAdminPage.connectionOk', { email: res.emailAddress ?? '' }),
        );
      else
        toast.error(
          t('emailAccountsAdminPage.connectionFailed', {
            error: res.error ?? t('emailAccountsAdminPage.unknown'),
          }),
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('emailAccountsAdminPage.testFailed'));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('emailAccountsAdminPage.title')}
        eyebrow={t('emailAccountsAdminPage.eyebrow')}
        icon={Mail}
        description={t('emailAccountsAdminPage.description')}
        backTo="/app/mail"
        backLabel={t('emailAccountsAdminPage.backToTriage')}
        actions={
          <Button onClick={() => sync.mutate()} disabled={sync.isPending} variant="outline">
            {sync.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t('emailAccountsAdminPage.syncNow')}
          </Button>
        }
      />

      {/* Deep sync — pull older mail over a chosen window */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <History className="h-4 w-4 text-primary" /> {t('emailAccountsAdminPage.deepSync')}
          </div>
          <p className="min-w-[180px] flex-1 text-xs text-muted-foreground">
            {t('emailAccountsAdminPage.deepSyncHint')}
          </p>
          <div className="w-[120px]">
            <Select value={backfillDays} onValueChange={setBackfillDays}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="30">{t('emailAccountsAdminPage.months1')}</SelectItem>
                <SelectItem value="90">{t('emailAccountsAdminPage.months3')}</SelectItem>
                <SelectItem value="180">{t('emailAccountsAdminPage.months6')}</SelectItem>
                <SelectItem value="365">{t('emailAccountsAdminPage.year1')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => backfillMut.mutate()} disabled={backfillMut.isPending}>
            {backfillMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <History className="h-4 w-4" />
            )}
            {t('emailAccountsAdminPage.runDeepSync')}
          </Button>
        </CardContent>
      </Card>

      {/* Add forms */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Plus className="h-4 w-4 text-primary" /> {t('emailAccountsAdminPage.addWorkspace')}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('emailAccountsAdminPage.addWorkspaceHint')}
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('emailAccountsAdminPage.emailAddress')}</Label>
              <Input
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder={brand().contactEmail}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('emailAccountsAdminPage.nameOptional')}</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t('emailAccountsAdminPage.generalMailboxPlaceholder')}
              />
            </div>
            <Button
              onClick={() => addWorkspace.mutate()}
              disabled={addWorkspace.isPending || !newAddress.trim()}
              className="w-full"
            >
              {addWorkspace.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('emailAccountsAdminPage.addWorkspace')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Link2 className="h-4 w-4 text-primary" /> {t('emailAccountsAdminPage.connectGmail')}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('emailAccountsAdminPage.connectGmailHint')}
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('emailAccountsAdminPage.emailAddress')}</Label>
              <Input
                value={oauthAddress}
                onChange={(e) => setOauthAddress(e.target.value)}
                // ⚠️ Хуучин `name@gmail.com` нь ГАЗАР ТӨӨРҮҮЛДЭГ байв: @mglenc.com
                // хайрцгууд ч ЯГ ЭНЭ картаар холбогддог (продакшнд бүх мөр
                // `auth_type='oauth'`, delegation тохируулаагүй), гэтэл админ
                // үүнийг «зөвхөн хувийн Gmail-д» гэж уншаад зүүн карт руу
                // ордог, тэндээс «хаяг аль хэдийн бүртгэгдсэн» гэсэн мухардал.
                placeholder="name@mglenc.com"
                className="font-mono text-sm"
              />
            </div>
            <Button
              onClick={() => connectGmail.mutate()}
              disabled={connectGmail.isPending || !oauthAddress.trim()}
              variant="outline"
              className="w-full"
            >
              {connectGmail.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlugZap className="h-4 w-4" />
              )}
              {t('emailAccountsAdminPage.connectViaGoogle')}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Accounts list */}
      {isLoading ? (
        <div className="py-10 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={t('emailAccountsAdminPage.noAccounts')}
          description={t('emailAccountsAdminPage.noAccountsHint')}
        />
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="py-3 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                <Checkbox
                  checked={a.is_active === 1}
                  onCheckedChange={() => toggleActive.mutate(a)}
                  aria-label={t('emailAccountsAdminPage.activeLabel')}
                />
                <div className="min-w-[200px] flex-1">
                  <div className="font-mono text-sm font-medium flex items-center gap-2">
                    {a.address}
                    <Badge variant="outline" className="text-micro">
                      {a.auth_type === 'workspace' ? 'Workspace' : 'OAuth'}
                    </Badge>
                    {a.is_active !== 1 && (
                      <Badge variant="outline" className="text-micro text-muted-foreground">
                        {t('emailAccountsAdminPage.inactive')}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {a.label ? `${a.label} · ` : ''}
                    {a.last_synced_at
                      ? t('emailAccountsAdminPage.lastSynced', {
                          date: formatDate(new Date(a.last_synced_at)),
                        })
                      : t('emailAccountsAdminPage.notSyncedYet')}
                  </div>
                  {a.last_sync_error && (
                    <div className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="truncate">{a.last_sync_error}</span>
                    </div>
                  )}
                  {a.auth_type === 'oauth' && a.is_active !== 1 && (
                    <div className="text-xs text-warning mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {t('emailAccountsAdminPage.connectionIncomplete')}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runTest(a.id)}
                    disabled={testingId === a.id}
                  >
                    {testingId === a.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    {t('emailAccountsAdminPage.test')}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn('h-8 w-8 text-muted-foreground hover:text-destructive')}
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          description: t('emailAccountsAdminPage.deleteConfirm', {
                            address: a.address,
                          }),
                          variant: 'destructive',
                        })
                      )
                        remove.mutate(a.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                </div>
                <EmailAccountTeamsEditor account={a} onSaved={invalidate} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
