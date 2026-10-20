import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

/* =============================================================
 * ConnectionError
 *
 * `BrandLoader`-ийн ХОС.  Аль нэг нь заавал төгсгөлтэй байх ёстой:
 * `BrandLoader` нь «хүлээж байна», энэ нь «хүлээхээ больсон».
 *
 * ЯАГААД ЭНЭ БАЙДАГ ВЭ (2026-08-24): өмнө нь сессийн шалгалт
 * (`/auth/me`) хугацааны хязгааргүй байсан тул сервер хариу өгөхгүй
 * бол `ProtectedRoute` нь `BrandLoader`-ийг МӨНХӨД үзүүлдэг байв —
 * хэрэглэгчид «сайт нээгдэхгүй байна» гэж мэдрэгддэг, refresh хийхээс
 * өөр гарц байхгүй, ямар алдаа болсныг ч мэдэхгүй.
 *
 * ⚠️ Энэ бүрэлдэхүүн нь ЗОРИУДААР хамааралгүй: зөвхөн `useLanguage`
 *    (i18n нь аль хэдийн ачаалагдсан, синхрон) + Tailwind.  API дуудлага
 *    ч үгүй, router ч үгүй, UI kit-ийн primitive ч үгүй — сүлжээ унасан
 *    үед гарч ирэх дэлгэц өөрөө сүлжээнээс хамаарч болохгүй.
 * ============================================================= */

export function ConnectionError({
  detail,
  onRetry,
  className,
}: {
  /** `ApiNetworkError.message` — жишээ нь «Сервер 7 секундэд хариу өгсөнгүй». */
  detail?: string | null;
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center min-h-screen gap-4 bg-background px-6 text-center',
        className,
      )}
      role="alert"
    >
      <img
        src="/loading.svg"
        alt=""
        aria-hidden="true"
        className="w-48 max-w-[60vw] h-auto opacity-40 grayscale select-none"
        draggable={false}
      />
      <h1 className="text-lg font-semibold text-foreground">{t('connectionError.title')}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t('connectionError.body')}</p>
      {detail ? (
        <p className="max-w-md text-xs text-muted-foreground/70">
          {t('connectionError.detail', { detail })}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {t('connectionError.retry')}
      </button>
    </div>
  );
}
