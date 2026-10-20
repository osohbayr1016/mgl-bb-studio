import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';
import { useForceLightTheme } from '@/shared/hooks/useForceLightTheme';
import { INTER_TIGHT_HREF, useWebFont } from '@/shared/hooks/useWebFont';
import { brand } from '@/shared/config/brand';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

import { Eyebrow } from './components/primitives';
import { LanguageToggle } from './shell/ClientHeader';

/**
 * Захиалагчийн урилгыг хүлээж авах хуудас — `/client/invite/:token`
 * (мөн `/client/reset/:token` — нууц үг сэргээх).
 *
 * ⚠️ Нэвтрээгүй хүн ирдэг тул `ProtectedRoute`-ЫН ГАДНА байрлана.  Токен нь
 *    серверийн KV дэх НЭГ УДААГИЙН түлхүүр (`lib/clientInvite.ts`); хүчинтэй
 *    эсэхийг `POST /api/auth/client/invite-info` шалгана — тэр зам
 *    `middleware/auth.ts`-ийн нээлттэй жагсаалтад бий.
 *
 * Нууц үг тохируулмагц СЕРВЕР шууд сесс өгдөг тул дахин нэвтрэх дэлгэц
 * харуулахгүй — захиалагч жилд хэдхэн удаа ордог хүн, нэмэлт алхам бүр
 * бидэн рүү залгах шалтгаан болно.
 *
 * 2026-09-23: порталын шинэ дизайнтай нэг хэлээр (editorial хоёр багана)
 * дахин зурсан; логик хэвээр.
 */

interface InviteInfo {
  kind: 'invite' | 'reset';
  full_name: string;
  username: string;
  email: string | null;
  org_name: string | null;
}

const FIELD = 'h-11 rounded-none border-foreground/25 bg-background shadow-none focus-visible:border-foreground';

export default function ClientInvitePage() {
  useForceLightTheme();
  useWebFont(INTER_TIGHT_HREF);

  const { t } = useLanguage();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { checkAuth } = useAuth();
  const b = brand();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Урилга шалгах үеийн алдаа (серверийн мессеж) — маягтын алдаанаас тусдаа. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<InviteInfo>('/auth/client/invite-info', { method: 'POST', data: { token } })
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async () => {
    if (password.length < 8) {
      setError(t('clientRoom.invite.tooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('clientRoom.invite.mismatch'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ token: string }>('/auth/client/accept', {
        method: 'POST',
        data: { token, password },
      });
      localStorage.setItem('auth_token', res.token);
      await checkAuth();
      navigate('/client', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('clientRoom.invite.error'));
    } finally {
      setSaving(false);
    }
  };

  const strength = Math.min(4, Math.floor(password.length / 3));

  return (
    <div className="light client-dashboard-root flex min-h-screen flex-col bg-background font-sans text-foreground antialiased lg:grid lg:grid-cols-2">
      {/* Зүүн: editorial мэндчилгээ */}
      <section className="flex flex-col justify-between gap-16 border-b border-foreground/10 px-6 py-8 sm:px-10 lg:border-b-0 lg:border-r lg:px-14 lg:py-12">
        <div className="flex items-center justify-between gap-4">
          <span className="font-display text-lg font-semibold tracking-[-0.02em]">{b.name}</span>
          <LanguageToggle />
        </div>
        <div>
          <Eyebrow index="00">{t('clientRoom.portalLabel')}</Eyebrow>
          <h1 className="mt-8 font-display text-[clamp(3rem,7vw,6rem)] font-light leading-[0.92] tracking-[-0.045em]">
            {info?.kind === 'reset' ? t('clientRoom.invite.reset') : t('clientRoom.invite.welcome')}
          </h1>
          <p className="mt-8 max-w-md text-base leading-relaxed text-muted-foreground">
            {t('clientRoom.invite.lead')}
          </p>
        </div>
        <p className="font-mono text-label uppercase tracking-[0.14em] text-muted-foreground">
          {b.legalNameEn}
        </p>
      </section>

      {/* Баруун: маягт */}
      <section className="flex flex-1 items-center px-6 py-12 sm:px-10 lg:px-14">
        <div className="w-full max-w-md">
          {loading ? (
            <div className="flex h-40 items-center gap-3 text-muted-foreground" aria-busy>
              <Loader2 className="h-5 w-5 motion-safe:animate-spin" />
              <span className="text-sm">{t('clientRoom.loading')}</span>
            </div>
          ) : info ? (
            <form
              className="flex flex-col gap-8"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="border-t border-foreground pt-5">
                <p className="text-xl leading-snug text-foreground">{info.full_name}</p>
                {info.org_name ? <p className="mt-1 text-sm text-muted-foreground">{info.org_name}</p> : null}
                <p className="mt-4 font-mono text-micro text-muted-foreground">
                  {t('clientRoom.invite.username')} · <span className="text-foreground">{info.username}</span>
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="invite-password"
                  className="font-mono text-label uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {t('clientRoom.invite.newPassword')}
                </Label>
                <div className="relative">
                  <Input
                    id="invite-password"
                    type={reveal ? 'text' : 'password'}
                    value={password}
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${FIELD} pr-11`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setReveal((v) => !v)}
                    aria-label={reveal ? t('clientRoom.invite.hidePassword') : t('clientRoom.invite.showPassword')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-none"
                  >
                    {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <div aria-hidden className="mt-1 grid grid-cols-4 gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={i <= strength ? 'h-0.5 bg-foreground' : 'h-0.5 bg-foreground/15'}
                    />
                  ))}
                </div>
                <p className="text-micro text-muted-foreground">{t('clientRoom.invite.passwordHint')}</p>
              </div>

              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="invite-confirm"
                  className="font-mono text-label uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {t('clientRoom.invite.confirm')}
                </Label>
                <Input
                  id="invite-confirm"
                  type={reveal ? 'text' : 'password'}
                  value={confirm}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                  className={FIELD}
                />
              </div>

              {error ? (
                <p role="alert" className="text-body text-danger">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                size="lg"
                disabled={saving}
                className="h-12 rounded-none bg-foreground text-background hover:bg-foreground/85"
              >
                {saving ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : null}
                {t('clientRoom.invite.submit')}
                {saving ? null : <ArrowRight className="h-4 w-4" strokeWidth={1.5} />}
              </Button>
            </form>
          ) : (
            <div className="flex flex-col gap-6 border-t border-foreground pt-6">
              <h2 className="font-display text-3xl font-light tracking-[-0.025em]">
                {t('clientRoom.invite.invalidTitle')}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {loadError || t('clientRoom.invite.invalidBody')}
              </p>
              <Button
                variant="outline"
                onClick={() => navigate('/login')}
                className="w-fit rounded-none border-foreground/30 bg-transparent"
              >
                {t('clientRoom.invite.toLogin')}
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
