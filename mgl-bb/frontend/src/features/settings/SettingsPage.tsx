import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/shared/i18n';
import { apiFetch, mediaUrl, uploadFile } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';
import { formatDisplayName } from '@/shared/lib/formatting';
import { useTheme, type Theme } from '@/shared/context/ThemeContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { ModulesCard } from './ModulesCard';
import { Alert, AlertDescription } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { SettingsShell, type SettingsSection } from '@/shared/components/SettingsShell';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { PushNotificationsCard } from '@/features/notifications/PushNotificationsCard';
import { RepairAdminLinkCard } from '@/features/settings/RepairAdminLinkCard';
import { TickerAdminCard } from '@/features/ticker/TickerAdminCard';
import {
  Settings,
  Lock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sun,
  Moon,
  Contrast,
  Monitor,
  Bell,
  User,
  Image as ImageIcon,
  Trash2,
  Upload,
  CalendarDays,
  Stamp,
  Plus, Blocks, Wrench, Megaphone } from 'lucide-react';
import type { Holiday } from '@/shared/types';
import { cn } from '@/shared/lib/utils';
import { brand } from '@/shared/config/brand';

const THEME_OPTIONS: { value: Theme; labelKey: string; icon: React.ReactNode }[] = [
  { value: 'dark', labelKey: 'settingsPage.themeDark', icon: <Moon className="h-4 w-4" /> },
  { value: 'dim', labelKey: 'settingsPage.themeDim', icon: <Contrast className="h-4 w-4" /> },
  { value: 'light', labelKey: 'settingsPage.themeLight', icon: <Sun className="h-4 w-4" /> },
  { value: 'system', labelKey: 'settingsPage.themeSystem', icon: <Monitor className="h-4 w-4" /> },
];

export default function SettingsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError(t('settingsPage.passwordMismatch'));
      return;
    }
    if (newPassword.length < 6) {
      setError(t('settingsPage.passwordTooShort'));
      return;
    }

    setLoading(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        data: { current_password: currentPassword, new_password: newPassword },
      });
      setSuccess(t('settingsPage.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsPage.passwordChangeFailed'));
    } finally {
      setLoading(false);
    }
  };

  const role = user?.role ?? null;

  // ⚠️ Хэсгүүд нь БҮГД үргэлж рендэрлэгдэнэ — `SettingsShell` нь тэднийг
  // хэзээ ч unmount хийхгүй. `HolidaysCard`-ийн бөглөж буй ноорог болон
  // `BrandLogoCard`/`PushNotificationsCard`-ийн татсан төлөв үүнээс
  // хамаарна (SettingsShell.tsx-ийн тайлбарыг үз).
  // `useMemo` ЗОРИУДААР БАЙХГҮЙ: агуулга нь `error`/`success`/талбаруудын
  // утгыг барьдаг тул хамаарал нь товчлуур дарах бүрд өөрчлөгдөнө — мемо нь
  // ямар ч ашиггүй байх байсан. Оронд нь `SettingsShell` нь id-уудын мөрөөр
  // тогтвортой байдлаа хангадаг.
  const sections: SettingsSection[] = [
    {
      id: 'settings-account',
      label: t('settingsPage.navAccount'),
      icon: User,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('settingsPage.userInfoTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-body flex justify-between">
              <span className="text-muted-foreground">{t('settingsPage.usernameLabel')}</span>
              <span className="font-medium text-foreground">{user?.username}</span>
            </div>
            <div className="text-body flex justify-between">
              <span className="text-muted-foreground">{t('settingsPage.fullNameLabel')}</span>
              <span className="font-medium text-foreground">
                {formatDisplayName(user?.full_name)}
              </span>
            </div>
            <div className="text-body flex justify-between">
              <span className="text-muted-foreground">{t('settingsPage.roleLabel')}</span>
              <span className="font-medium text-foreground capitalize">{user?.role}</span>
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'settings-appearance',
      label: t('settingsPage.navAppearance'),
      icon: Sun,
      content: (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sun className="h-5 w-5 text-primary-ink" aria-hidden />
              {t('settingsPage.appearanceTitle')}
            </CardTitle>
            <CardDescription>{t('settingsPage.appearanceDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {THEME_OPTIONS.map((opt) => {
                const active = theme === opt.value;
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    variant="outline"
                    aria-pressed={active}
                    onClick={() => setTheme(opt.value)}
                    className={cn(
                      'h-auto min-w-[90px] flex-1 flex-col gap-2 px-4 py-3 font-medium',
                      active
                        ? 'border-primary bg-primary/10 text-primary-ink hover:bg-primary/15'
                        : 'text-muted-foreground hover:border-primary/50 hover:text-foreground',
                    )}
                  >
                    {opt.icon}
                    {t(opt.labelKey)}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'settings-notifications',
      label: t('settingsPage.navNotifications'),
      icon: Bell,
      // Push мэдэгдэл — апп хаалттай үед ч мэдэгдэл авах эсэх.
      content: <PushNotificationsCard />,
    },
    {
      id: 'settings-branding',
      label: t('settingsPage.navBranding'),
      icon: ImageIcon,
      // Brand logo + КОМПАНИЙН ТАМГА — хоёулаа /api/settings/branding
      // дээрх нэг мөрөнд амьдардаг байгууллагын хэмжээний тохиргоо тул
      // нэг хэсэгт зэрэгцэнэ.
      content: (
        <div className="space-y-4">
          <BrandLogoCard role={role} />
          <CompanyStampCard role={role} />
        </div>
      ),
    },
    {
      id: 'settings-holidays',
      label: t('settingsPage.navHolidays'),
      icon: CalendarDays,
      // Баярын / ажлын бус өдрүүд — төслийн графикийн өнгөнд ашиглагдана.
      content: <HolidaysCard role={role} />,
    },
    // Модулийн лиценз — ЗӨВХӨН админд.  Өөр компанид зарахдаа энэ хуудсаар
    // ямар хэсгүүд нээлттэй байхыг тодорхойлно (`shared/config/modules.ts`).
    ...(role && ADMIN_TIER.has(role)
      ? [
          {
            id: 'settings-modules',
            label: 'Модулиуд',
            icon: Blocks,
            content: <ModulesCard />,
          },
          {
            id: 'settings-repair',
            label: t('repair.adminTabTitle'),
            icon: Wrench,
            content: <RepairAdminLinkCard />,
          },
          // Толгойн гүйдэг мэдээ — 2026-09-18 хүртэл sidebar-ын тусдаа
          // `/app/admin/ticker` хуудас байсан; эзний хүсэлтээр энд нүүсэн.
          {
            id: 'settings-ticker',
            label: t('tickerAdmin.title'),
            icon: Megaphone,
            content: <TickerAdminCard />,
          },
        ]
      : []),
    {
      id: 'settings-security',
      label: t('settingsPage.navSecurity'),
      icon: Lock,
      content: (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary-ink" aria-hidden />
              {t('settingsPage.changePasswordTitle')}
            </CardTitle>
            <CardDescription>{t('settingsPage.changePasswordDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {success && (
                <Alert variant="success">
                  <CheckCircle2 aria-hidden />
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label>{t('settingsPage.currentPasswordLabel')}</Label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('settingsPage.newPasswordLabel')}</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('settingsPage.confirmPasswordLabel')}</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="bg-background/50"
                />
              </div>

              <Button
                type="submit"
                className="w-full shadow-lg shadow-primary/20"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="mr-2 h-4 w-4" />
                )}
                {t('settingsPage.changePasswordTitle')}
              </Button>
            </form>
          </CardContent>
        </Card>
      ),
    },
  ];

  return (
    <SettingsShell
      icon={Settings}
      title={t('settings')}
      description={t('settingsPage.headerDescription')}
      sections={sections}
    />
  );
}

/* =============================================================
 * КОМПАНИЙН ТАМГА — Гүйцэтгэлийн тайлангийн «Баталгаажуулалт» хуудас.
 * -------------------------------------------------------------
 * Логотой ЯГ ижил байгууллагын хэмжээний тохиргоо
 * (`app_settings.report_stamp_url`, migration 0197).
 *
 * ⚠️ Яагаад ХЭРЭГЛЭГЧИЙН профайл БИШ вэ: тамга компанийнх, гарын үсэг
 * хүнийх.  Migration 0173 тамгыг хэрэглэгч бүрт өгсөн бөгөөд тайлангийн
 * код «ажилтанд тамга байхгүй бол ЗАХИРЛЫНХЫГ ав» гэж нөхдөг байсан —
 * гэтэл production дээр захирлын мөр хоосон, бүх компанид ганцхан хүн
 * тамгатай байсан тул тамга ХЭЗЭЭ Ч гардаггүй байв.  Нэг байгууллагад
 * нэг тамга гэдэг нь бодит байдал бөгөөд бөглөх цэг нь ч нэг байх ёстой.
 *
 * (`users.stamp_url` хэвээр — үнийн санал ба ASR түүнийг уншсаар байна.)
 * ============================================================= */
function CompanyStampCard({ role }: { role: string | null }) {
  const { t } = useLanguage();
  const canEdit = !!role && ADMIN_TIER.has(role);
  /** `/media/<key>` хэлбэрийн ТҮҮХИЙ утга (backend-д яг ийм байдлаар очно). */
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'upload' | 'clear' | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancel = false;
    apiFetch<{ stamp_url: string | null }>('/settings/branding')
      .then((r) => {
        if (!cancel) setStampUrl(r.stamp_url);
      })
      .catch(() => {
        /* keep null */
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const handleUpload = async (file: File) => {
    setError('');
    setSuccess('');
    setBusy('upload');
    try {
      const next = await uploadFile(file);
      /* ⚠️ ЗӨВХӨН `stamp_url` илгээнэ.  Route нь заагаагүй талбарт
         хүрэхгүй тул лого хэвээр үлдэнэ (`routes/settings.ts`). */
      await apiFetch('/settings/branding', { method: 'PUT', data: { stamp_url: next } });
      setStampUrl(next);
      setSuccess(t('settingsPage.stampSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleClear = async () => {
    if (
      !(await confirmDialog({
        description: t('settingsPage.stampClearConfirm'),
        variant: 'destructive',
      }))
    )
      return;
    setError('');
    setSuccess('');
    setBusy('clear');
    try {
      await apiFetch('/settings/branding', { method: 'PUT', data: { stamp_url: '' } });
      setStampUrl(null);
      setSuccess(t('settingsPage.stampCleared'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.deleteFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stamp className="h-5 w-5 text-primary-ink" aria-hidden />
          {t('settingsPage.stampTitle')}
        </CardTitle>
        <CardDescription>{t('settingsPage.stampDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert variant="success">
            <CheckCircle2 aria-hidden />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-4">
          {/* Цагаан дэвсгэр — тамга ихэвчлэн хөх/улаан бэхтэй, ил тод PNG
              тул бараан дэвсгэр дээр уншигдахгүй. */}
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : stampUrl ? (
              /* ⚠️ `mediaUrl()` ЗААВАЛ: хадгалагдсан утга нь `/media/<key>`
                 бөгөөд Pages домэйн дээр дан замаар үлдээвэл SPA fallback
                 (index.html) буцаж зураг эвдэрнэ. */
              <img
                src={mediaUrl(stampUrl)}
                alt="stamp"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="px-1 text-center text-micro text-muted-foreground">
                {t('settingsPage.stampEmpty')}
              </span>
            )}
          </div>
          {canEdit ? (
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
              >
                {busy === 'upload' ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t('common.saving')}
                  </>
                ) : (
                  <>
                    <Upload className="mr-1.5 h-4 w-4" /> {t('settingsPage.changeStamp')}
                  </>
                )}
              </Button>
              {stampUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  disabled={busy !== null}
                  className="text-destructive-ink hover:text-destructive-ink"
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> {t('common.delete')}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-micro text-muted-foreground italic">
              {t('settingsPage.adminOnlyStamp')}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* =============================================================
 * Brand-logo upload card.
 * -------------------------------------------------------------
 * Single firm-wide setting at /api/settings/branding.  Admin tier
 * sees the upload + clear controls; everyone else sees a read-only
 * preview so non-admins know what's currently in play.
 * ============================================================= */
const ADMIN_TIER = new Set(['admin']);

function BrandLogoCard({ role }: { role: string | null }) {
  const { t } = useLanguage();
  const canEdit = !!role && ADMIN_TIER.has(role);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'upload' | 'clear' | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancel = false;
    apiFetch<{ logo_url: string | null }>('/settings/branding')
      .then((r) => {
        if (!cancel) setLogoUrl(r.logo_url);
      })
      .catch(() => {
        /* keep null */
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const handlePick = () => fileRef.current?.click();

  const handleUpload = async (file: File) => {
    setError('');
    setSuccess('');
    setBusy('upload');
    try {
      const next = await uploadFile(file);
      await apiFetch('/settings/branding', {
        method: 'PUT',
        data: { logo_url: next },
      });
      setLogoUrl(next);
      setSuccess(t('settingsPage.logoSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleClear = async () => {
    if (
      !(await confirmDialog({
        description: t('settingsPage.logoClearConfirm'),
        variant: 'destructive',
      }))
    )
      return;
    setError('');
    setSuccess('');
    setBusy('clear');
    try {
      await apiFetch('/settings/branding', {
        method: 'PUT',
        data: { logo_url: '' },
      });
      setLogoUrl(null);
      setSuccess(t('settingsPage.logoCleared'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.deleteFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary-ink" aria-hidden />
          {t('settingsPage.logoTitle')}
        </CardTitle>
        <CardDescription>{t('settingsPage.logoDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert variant="success">
            <CheckCircle2 aria-hidden />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-4">
          <div className="flex h-24 w-32 items-center justify-center overflow-hidden rounded-md border border-border bg-[#0d2a4a]">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-white/50" />
            ) : logoUrl ? (
              <img src={logoUrl} alt="logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-micro font-mono text-white/60">{brand().name}</span>
            )}
          </div>
          {canEdit ? (
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                  e.target.value = '';
                }}
              />
              <Button type="button" size="sm" onClick={handlePick} disabled={busy !== null}>
                {busy === 'upload' ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t('common.saving')}
                  </>
                ) : (
                  <>
                    <Upload className="mr-1.5 h-4 w-4" /> {t('settingsPage.changeLogo')}
                  </>
                )}
              </Button>
              {logoUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  disabled={busy !== null}
                  className="text-destructive-ink hover:text-destructive-ink"
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> {t('common.delete')}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-micro text-muted-foreground italic">
              {t('settingsPage.adminOnlyLogo')}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* =============================================================
 * Баярын / ажлын бус өдрүүдийн карт.
 * -------------------------------------------------------------
 * Компанийн нэгдсэн календарь (/api/holidays).  Admin tier нэмэх /
 * устгах боломжтой; бусад нь зөвхөн жагсаалтыг уншина.  Энэ өдрүүд
 * төслийн "Графикууд" tab-ийн өдрийн лаа өнгөнд (амралт/баяр дээр явц
 * гараагүй бол улбар шар) нөлөөлнө.
 * ============================================================= */
function HolidaysCard({ role }: { role: string | null }) {
  const { t } = useLanguage();
  const canEdit = !!role && ADMIN_TIER.has(role);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    apiFetch<{ holidays: Holiday[] }>('/holidays')
      .then((r) => setHolidays(r.holidays))
      .catch(() => {
        /* keep current */
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    setError('');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError(t('settingsPage.holidayDateRequired'));
      return;
    }
    if (!name.trim()) {
      setError(t('settingsPage.holidayNameRequired'));
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/holidays', { data: { date, name: name.trim() } });
      setDate('');
      setName('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/holidays/${id}`, { method: 'DELETE' });
      setHolidays((prev) => prev.filter((h) => h.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.deleteFailed'));
    }
  };

  const fmtDate = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('mn-MN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'UTC',
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary-ink" aria-hidden />
          {t('settingsPage.holidaysTitle')}
        </CardTitle>
        <CardDescription>{t('settingsPage.holidaysDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-micro">{t('settingsPage.holidayDateLabel')}</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-40 bg-background/50 tabular-nums"
              />
            </div>
            <div className="min-w-[160px] flex-1 space-y-1">
              <Label className="text-micro">{t('settingsPage.holidayNameLabel')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('settingsPage.holidayNamePlaceholder')}
                className="bg-background/50"
              />
            </div>
            <Button type="button" size="sm" onClick={handleAdd} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t('common.add')}
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : holidays.length === 0 ? (
          <p className="text-micro py-2 text-muted-foreground italic">
            {t('settingsPage.holidaysEmpty')}
          </p>
        ) : (
          <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                <span className="text-micro w-32 shrink-0 tabular-nums text-muted-foreground">
                  {fmtDate(h.date)}
                </span>
                <span className="text-body flex-1 truncate text-foreground">{h.name}</span>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(h.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive-ink"
                    title={t('common.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!canEdit && (
          <p className="text-micro text-muted-foreground italic">
            {t('settingsPage.adminOnlyHolidays')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
