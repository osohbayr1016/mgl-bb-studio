/**
 * Staff sign-in — company cover video background with a centred glass card.
 */
import { Link } from 'react-router-dom';
import { useLanguage } from '@/shared/i18n';
import { useBrand } from '@/shared/config/useBrand';
import { LIGHTFALL_ACCENT } from '@/features/landing/lightfallTheme';
import { ArrowLeft } from 'lucide-react';
import LoginVideoBackground from './LoginVideoBackground';
import LoginFormCard from './LoginFormCard';

export default function LoginPage() {
  const { t, lang, setLang } = useLanguage();
  const brandCfg = useBrand();

  return (
    <div className="relative flex min-h-dvh w-full flex-col overflow-hidden font-sans text-white antialiased bg-[#05060c]">
      <LoginVideoBackground />

      <header className="relative z-10 flex shrink-0 items-center justify-between gap-4 px-4 py-4 sm:px-6 md:px-8">
        <Link to="/" className="flex items-center gap-2 font-mono text-white">
          <span className="text-base font-bold tracking-[0.25em] sm:text-lg">{brandCfg.nameShort}</span>
          <span className="hidden text-[10px] uppercase tracking-[0.22em] text-white/45 sm:inline">
            {brandCfg.taglineEn}
          </span>
        </Link>

        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/50 md:flex">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: LIGHTFALL_ACCENT, boxShadow: `0 0 8px ${LIGHTFALL_ACCENT}` }}
              aria-hidden
            />
            {t('loginSystemsNormal')}
          </div>
          <span className="hidden h-4 w-px bg-white/15 md:block" aria-hidden />
          <div
            className="flex items-center gap-2 font-mono text-xs font-medium"
            role="group"
            aria-label={t('loginPage.languageGroup')}
          >
            <button
              type="button"
              onClick={() => setLang('mn')}
              aria-pressed={lang === 'mn'}
              className={
                'uppercase tracking-wider transition-colors ' +
                (lang === 'mn' ? 'text-white' : 'text-white/40 hover:text-white')
              }
            >
              MN
            </button>
            <span className="text-white/25" aria-hidden>
              ·
            </span>
            <button
              type="button"
              onClick={() => setLang('en')}
              aria-pressed={lang === 'en'}
              className={
                'uppercase tracking-wider transition-colors ' +
                (lang === 'en' ? 'text-white' : 'text-white/40 hover:text-white')
              }
            >
              EN
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-6 sm:px-6">
        <LoginFormCard />
      </main>

      <footer className="relative z-10 flex shrink-0 flex-col gap-2 px-4 py-4 font-mono text-[11px] text-white/40 sm:flex-row sm:items-center sm:justify-between sm:px-6 md:px-8">
        <Link to="/" className="inline-flex items-center gap-1.5 transition-colors hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('loginBackToSite')}
        </Link>
        <span className="uppercase tracking-[0.18em]">
          © {new Date().getFullYear()} {brandCfg.legalNameEn} · {t('loginRightsReserved')}
        </span>
      </footer>
    </div>
  );
}
