import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { apiFetch, ApiError } from '@/shared/api/client';
import { isWorkerRole, WORKER_HOME } from '@/shared/lib/roles';
import { LIGHTFALL_ACCENT } from '@/features/landing/lightfallTheme';
import type { AuthResponse, LoginRequest } from '@/shared/types';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';

export default function LoginFormCard() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await apiFetch<AuthResponse & { token?: string }>('/auth/login', {
        data: { username, password } as LoginRequest,
      });
      if (data.token) localStorage.setItem('auth_token', data.token);
      setUser(data.user);
      navigate(
        data.user?.role === 'client'
          ? '/client'
          : isWorkerRole(data.user?.role)
            ? WORKER_HOME
            : '/app',
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'office_network_required') {
        setError(t('loginOfficeNetworkRequired'));
      } else {
        setError(err instanceof Error ? err.message : t('loginError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#070812]/75 p-6 shadow-[0_28px_90px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:p-8">
      <div
        className="mb-6 h-[3px] w-12 rounded-full"
        style={{ background: `linear-gradient(90deg, ${LIGHTFALL_ACCENT}, transparent)` }}
        aria-hidden
      />
      <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('loginHeading')}</h1>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4 sm:mt-8 sm:gap-5">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-2">
          <label
            htmlFor="username"
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50"
          >
            {t('email')}
          </label>
          <input
            id="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            className="h-11 rounded-xl border border-white/12 bg-white/[0.04] px-3 text-base text-white placeholder:text-white/35 outline-none transition-colors focus:border-[#5227FF] focus:ring-2 focus:ring-[#5227FF]/40 sm:h-12 sm:text-sm"
          />
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="password"
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50"
            >
              {t('password')}
            </label>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="text-xs font-medium text-white/50 underline-offset-4 transition-colors hover:text-[#A6C8FF] hover:underline"
            >
              {t('loginForgot')}
            </a>
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3 pr-11 text-base text-white placeholder:text-white/35 outline-none transition-colors focus:border-[#5227FF] focus:ring-2 focus:ring-[#5227FF]/40 sm:h-12 sm:text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? t('loginHidePassword') : t('loginShowPassword')}
              className="absolute right-1.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{ backgroundColor: LIGHTFALL_ACCENT }}
          className="group mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold tracking-wide text-white shadow-[0_10px_30px_-10px_rgba(82,39,255,0.6)] transition-all hover:brightness-110 hover:shadow-[0_12px_34px_-8px_rgba(82,39,255,0.75)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5227FF]/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05060c] disabled:opacity-60 sm:h-12"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('login')}
          {!submitting && (
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          )}
        </button>
      </form>

      <p className="mt-6 border-t border-white/10 pt-4 text-xs leading-relaxed text-white/50 sm:mt-8 sm:pt-5">
        {t('loginHelp')}
      </p>
    </div>
  );
}
