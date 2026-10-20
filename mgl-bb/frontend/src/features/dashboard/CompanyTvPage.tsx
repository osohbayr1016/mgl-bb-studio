/**
 * /app/tv — компанийн TV самбар (kiosk wallboard).
 *
 * Оффисын ХҮРЭЛТИЙН зурагт дэлгэц дээр байнга нээлттэй байх зориулалттай.
 * Кадрууд өөрөө эргэлдэж, дата 60 секунд тутам шинэчлэгдэнэ.  3-5 метрээс
 * уншигдахаар том typography, харанхуй суурь, өндөр контраст.
 *
 * Дизайны систем нь `tv/` дор — Blueprint (техникийн зургийн хуудас).
 * `theme.ts`-ийн тайлбарыг УНШ: апп-ийн `--primary` токеныг энд ЗОРИУД
 * ашигладаггүй, мөн график дүрслэлийн өнгө нь бичвэрийн өнгөнөөс тусдаа
 * (`TV_CHART`) бөгөөд OKLCH-ээр баталгаажуулсан.
 *
 * ЗОХИОМЖ (2026-08-19-нөөс):
 *   · дээд мөр — лого + ХУУДАСНЫ ГАРЧИГ (зүүн), огноо/гараг дээр цаг (баруун)
 *   · бие      — кадр, `flex-1`
 *   · доод     — 2px хугацааны шугам.  Зургийн үндсэн бичээсийн ХҮСНЭГТ
 *                байсныг хэрэглэгчийн шийдвэрээр БҮТНЭЭР устгасан; буцааж
 *                нэмэхгүй.
 *
 * Удирдлага: хүрэх → удирдлагын мөр (дахин хүрэхэд нуугдана) · шудрах →
 * кадр солих · Esc/сум → гар.  `useTvTouch.ts`-ийг үз.
 *
 * Дата эх сурвалж: `/api/company/overview` · `/company/charts/timeseries` ·
 * `/company/lifetime`.  Нэвтрэлт нь энгийн session (ProtectedRoute) —
 * зурагтан дээр нэг удаа admin account-аар нэвтэрч орхино.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Lock,
  FolderKanban,
  TrendingUp,
  TrendingDown,
  CalendarDays,
  CandlestickChart,
  LayoutList,
  Layers,
  Radar,
} from 'lucide-react';
import {
  BaselineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { useApiQuery } from '@/shared/api/useApi';
import type { CompanyChartsTimeseries } from '@/shared/types';
import { cn } from '@/shared/lib/utils';
import { BlueprintSurface } from './tv/Blueprint';
import { SceneTicker } from './tv/SceneTicker';
import { EraScene, type CompanyLifetime } from './tv/EraScene';
import { PulseScene } from './tv/PulseScene';
import { SectorsScene } from './tv/SectorsScene';
import { PortfolioScene } from './tv/PortfolioScene';
import { ActivityScene } from './tv/ActivityScene';
import { TvControls, TouchHint } from './tv/TvControls';
import { useTvTouch } from './tv/useTvTouch';
import { TV, TV_SIZE, metaStyle, tvProgressColor } from './tv/theme';
import { formatDate } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';
import { useAuth } from '@/shared/context/AuthContext';

// «Системийн урсгал» кадр нь workbench-ийн графыг агуулдаг тул ТУСДАА chunk —
// admin биш дэлгэц (кадр харагдахгүй) энэ кодыг огт татахгүй.
const SystemScene = lazy(() => import('./tv/SystemScene'));

/* ──────────────────────────  data shape  ────────────────────────── */
// Subset of /api/company/overview that the wallboard renders.  Kept local
// so this page stays self-contained (the full type lives in
// CompanyDashboardPage; the two never need to share it).
interface OverviewResponse {
  generated_at: string;
  totals: {
    projects_total: number;
    projects_active: number;
    tasks_total: number;
    drawings_total: number;
  };
  portfolio: Array<{
    id: number;
    name: string;
    /** ⚠ `/overview`-ийн portfolio SQL-д WHERE БАЙХГҮЙ — дууссан/архивласан
     *  төсөл ч ирнэ (зөвхөн `ORDER BY (status='active') DESC`).  Явцаар
     *  эрэмбэлэх бүрдээ энэ талбараар шүүх ёстой. */
    status: string | null;
    progress: number;
    finish_date: string | null;
    days_left: number | null;
    team_progress?: Array<{ team_code: string; progress: number }>;
  }>;
  people: {
    attendance_today: { present: number; total: number; percentage: number };
    // ⚠ /overview нь `active_projects_today`-г бас буцаадаг (аль төсөл дээр
    // хэдэн хүн байгаа).  2026-08-19-нд ЗОРИУД уншихаа болив: лоббиийн
    // самбарт төсөл тус бүрийн хүний тоо гаргахгүй гэж шийдсэн.  Буцааж
    // нэмэхгүй — оронд нь төслийн ЯВЦ харуулна.
  };
  trends: {
    daily: Array<{ date: string; entry_count: number }>;
  };
  // ⚠ /overview нь `alerts.overdue_projects`-ыг бас буцаадаг.  2026-08-25-нд
  // ЗОРИУД уншихаа болив: «Анхаарах төслүүд» кадрыг эзний шийдвэрээр бүтнээр
  // устгасан (лоббид зочны өмнө хугацаа хэтэрсэн төслийн жагсаалт гаргахгүй).
  // Буцааж нэмэхгүй.  2026-09-10-нд мөн шалтгаанаар `totals.tasks_overdue`
  // («Хэтэрсэн даалгавар») ба `trends.daily[].contributor_count» («Хамгийн
  // олон хувь нэмэр») хоёрыг уншихаа болив.
}

/** Хэдэн секунд тутам scene солих вэ. */
const SCENE_MS = 20_000;
/**
 * «Системийн урсгал» (сүүлийн кадр) — 30 сек (эзэн 2026-10-06).  Амьд граф
 * тул бусдаасаа урт; WebSocket нь зөвхөн энэ хугацаанд нээлттэй.
 */
const SYSTEM_SCENE_MS = 30_000;
/**
 * Дата хэдэн секунд тутам дахин татах вэ.
 *
 * 2026-09-11 (D1 rows_read аудит): 60 сек байхад энэ дэлгэц ганцаараа өдөрт
 * 1 440 × (/company/overview 285 000 + /charts 109 000 мөр) ≈ 570 сая D1 мөр
 * уншиж байв — D1-ийн үнэгүй лимит (5 сая/өдөр)-ийн 100 дахин.  Сервер талын
 * TTL 120/300 сек болсон тул түүнээс ойрхон татах нь утгагүй; 5 минутын
 * шинэчлэлт лоббийн самбарт хангалттай (кадр солигдох нь 20 сек хэвээр).
 */
const REFRESH_MS = 300_000;
/** Насан туршийн тоо — өдөрт бараг өөрчлөгддөггүй; сервер 1 цаг кэшлэнэ. */
const LIFETIME_REFRESH_MS = 1_800_000;

export default function CompanyTvPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Амьд урсгалын суваг (`/api/mgl-ai/workbench-live`) нь зөвхөн admin-д нээлттэй —
  // өөр role-д кадр «холбогдоогүй» гэж харагдахын оронд огт гарахгүй.
  // (TV дэлгэцийн `TV` account нь 2026-10-06-нд хэмжихэд `admin`.)
  const showSystemScene = user?.role === 'admin';
  const overviewQuery = useApiQuery<OverviewResponse>('/company/overview', {
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const data = overviewQuery.data ?? null;

  // TradingView-маягийн компанийн цуваа (index лаа, watchlist, sectors).
  const chartsQuery = useApiQuery<CompanyChartsTimeseries>('/company/charts/timeseries?days=30', {
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const charts = chartsQuery.data ?? null;

  // Насан туршийн хуримтлагдсан тоо — «Компанийн эрин» scene-д.  Өдөрт бараг
  // өөрчлөгддөггүй тул endpoint нь 5 минутын TTL-тэй; энд илүү удаан татна.
  const lifetimeQuery = useApiQuery<CompanyLifetime>('/company/lifetime', {
    refetchInterval: LIFETIME_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const lifetime = lifetimeQuery.data ?? null;

  // Амьд цаг — секунд тутам шинэчилнэ.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Кадрын жагсаалт.
  //
  // ⚠ «Анхаарах төслүүд» (`attention`) 2026-08-25-нд ЭЗНИЙ ШИЙДВЭРЭЭР
  //   устсан — лоббиийн дэлгэц зочны өмнө хугацаа хэтэрсэн төслийн жагсаалт
  //   гаргах ёсгүй.  Буцааж нэмэхгүй.  «Хамгийн их ахисан төслүүд» (`movers`)
  //   кадар 2026-09-10-нд мөн эзний шийдвэрээр бүтнээр устсан (`git show
  //   HEAD~:frontend/src/features/dashboard/tv/MoversScene.tsx` нь сэргээх цэг).
  const scenes = useMemo(() => {
    const list: Array<{ id: string; title: string; icon: typeof Building2; ms?: number }> = [
      { id: 'era', title: t('companyTvPage.sceneEra'), icon: Building2 },
      { id: 'pulse', title: t('companyTvPage.sceneCompanyBoard'), icon: Building2 },
      { id: 'index', title: t('companyTvPage.sceneCompanyIndex'), icon: CandlestickChart },
      { id: 'watchlist', title: t('companyTvPage.sceneProjectsBoard'), icon: LayoutList },
      { id: 'sectors', title: t('companyTvPage.sceneTeamsProgress'), icon: Layers },
      { id: 'portfolio', title: t('companyTvPage.sceneProjectProgress'), icon: FolderKanban },
      { id: 'momentum', title: t('companyTvPage.sceneActivity30Days'), icon: TrendingUp },
    ];
    // Сүүлийн кадр — System Workbench-ийн амьд граф (зөвхөн admin, 30 сек).
    if (showSystemScene) {
      list.push({ id: 'system', title: t('companyTvPage.sceneSystemLive'), icon: Radar, ms: SYSTEM_SCENE_MS });
    }
    return list;
  }, [t, showSystemScene]);

  const [sceneIndex, setSceneIndex] = useState(0);
  /** Түгжээтэй үед кадр автоматаар солигдохгүй — хүн гараар тайлах хүртэл. */
  const [locked, setLocked] = useState(false);

  const goNext = useCallback(() => setSceneIndex((i) => (i + 1) % scenes.length), [scenes.length]);
  const goPrev = useCallback(
    () => setSceneIndex((i) => (i - 1 + scenes.length) % scenes.length),
    [scenes.length],
  );

  // Kiosk-оос гарах цорын ганц зам — бүтэн дэлгэцээс гарч самбар руу буцна.
  // Esc товч болон удирдлагын «Гарах» хоёул үүнийг дуудна.
  const exitTv = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    navigate('/app');
  }, [navigate]);

  const touch = useTvTouch({ onSwipeLeft: goNext, onSwipeRight: goPrev });
  const { controlsVisible } = touch;

  // Хүн удирдаж байх үед (удирдлага харагдаж байгаа) эсвэл түгжээтэй үед
  // автомат эргэлт ЗОГСОНО — үзэж байгаа кадрыг булаах нь хамгийн эвгүй зан.
  const rotating = !controlsVisible && !locked;

  const active = scenes[Math.min(sceneIndex, scenes.length - 1)]!;
  /** Кадр бүр өөрийн хугацаатай байж болно (`ms`); өгөгдмөл нь SCENE_MS. */
  const activeMs = active.ms ?? SCENE_MS;

  // Scene эргэлт.  `sceneIndex`-ээс хамаарсан нь ЗОРИУД: гараар (шудралт,
  // товч, сумаар) кадр солиход тоолуур тэглэгдэж, шинэ кадр бүтэн SCENE_MS
  // амьдарна.  Өмнө нь интервал үргэлжилсээр байгаад гараар сольсны дараа
  // кадр шууд үсэрдэг байсан.
  useEffect(() => {
    if (!rotating) return;
    const id = setTimeout(goNext, activeMs);
    return () => clearTimeout(id);
  }, [rotating, sceneIndex, goNext, activeMs]);

  // Гар удирдлага: сум зүүн/баруун — scene солих; Esc — бүтэн дэлгэцээс
  // гарч самбар руу буцах (kiosk-оос гарах цорын ганц гарц, cursor нуугдсан).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'Escape') exitTv();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, exitTv]);

  return (
    <div
      className="tv-root fixed inset-0 flex flex-col overflow-hidden select-none"
      {...touch.rootHandlers}
      // Урт дарахад хөтчийн контекст цэс гарах нь kiosk-д эвгүй.
      onContextMenu={(e) => e.preventDefault()}
      style={{
        background: TV.bg,
        color: TV.ink,
        // Хөтчийн өөрийн дохиог унтраана: хэвтээ шудралт нь «буцах» болж,
        // босоо нь rubber-band/pull-to-refresh өгдөг.  Бүх scene тогтмол
        // өндөртэй тул гүйлгэх шаардлага огт байхгүй.
        touchAction: 'none',
        // Удирдлага харагдаж байх үед заагчийг буцааж гаргана — kiosk-д
        // хулгана залгасан тохиолдолд товч онох боломжтой байх ёстой.
        cursor: controlsVisible ? 'auto' : 'none',
      }}
    >
      {/* Keyframes — scene solилт + үндсэн бичээсийн дээрх хугацааны шугам. */}
      <style>{`
        @keyframes tvSceneBar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes tvFadeIn { from { opacity: 0; transform: translateY(1.4vh); } to { opacity: 1; transform: translateY(0); } }
        @keyframes tvControlsIn { from { opacity: 0; transform: translateY(2.4vh); } to { opacity: 1; transform: translateY(0); } }
        /* Хөдөлгөөн мэдрэмтгий хэрэглэгчийг хүндэтгэнэ.  Kiosk дээр ховор ч
           энэ хуудсыг гар утаснаас нээх боломжтой. */
        @media (prefers-reduced-motion: reduce) {
          .tv-root *, .tv-root *::before, .tv-root *::after {
            animation-duration: 1ms !important;
            transition-duration: 1ms !important;
          }
        }
      `}</style>

      <BlueprintSurface />

      {/* ───────────── Дээд мөр: хуудасны гарчиг ба амьд цаг ─────────────
          ЗҮҮН — тухайн кадрын нэр.  Энэ нь хуудасны ГАРЧИГ: доод үндсэн
          бичээсэнд «ХАРАГДАЦ» гэсэн шошготой давхардаж байсныг зөөв.  Шошго
          хэрэггүй — гарчиг зүүн дээд буланд байх нь бүх баримт бичигт
          ойлгомжтой.
          БАРУУН — огноо/гараг нь ЖИЖИГ саараар цагийн ДЭЭР, цаг нь том. */}
      <header
        className="relative flex shrink-0 items-end justify-between px-[3.2vw] pt-[4.4vh] pb-[1.8vh]"
        style={{ borderBottom: `1px solid ${TV.line}` }}
      >
        <div className="flex items-center gap-[1.1vw]">
          <img
            src="/logo-white.png"
            alt=""
            style={{ height: '2.6vw', width: 'auto', opacity: 0.95 }}
          />
          <span
            style={{
              fontSize: '2vw',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: TV.ink,
            }}
          >
            {active.title}
          </span>
        </div>

        <div className="text-right">
          {/* Огноо + гараг — жижиг, саарал, цагийн дээр.  Түгжээтэй үед
              цоожны тэмдэг энд гарна: доод үндсэн бичээс устсан тул түгжээг
              харуулах өөр газар үлдээгүй, түгжсэн хүн үүнийг мэдэх ёстой. */}
          <div
            className="flex items-center justify-end gap-[0.5vw]"
            style={{ ...metaStyle, color: TV.ink3 }}
          >
            {locked && <Lock style={{ width: '1vw', height: '1vw', color: TV.gold }} />}
            <span>
              {`${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(
                now.getDate(),
              ).padStart(2, '0')}`}
              {'  '}
              {now.toLocaleDateString('mn-MN', { weekday: 'long' })}
            </span>
          </div>

          {/* Цаг — mono, учир нь минут солигдоход тоо тэнцүү өргөнтэй байж
              дэлгэц дээр «үсэрдэггүй».  Секундыг бүдэг өнгөөр — 3-5 метрээс
              секунд уншигдах шаардлагагүй, харин хөдөлгөөн нь самбарыг амьд
              байгааг харуулна. */}
          <div className="mt-[0.5vh] flex items-baseline justify-end gap-[0.6vw]">
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: '4.1vw',
                fontWeight: 700,
                lineHeight: 0.9,
                letterSpacing: '-0.03em',
                color: TV.ink,
              }}
            >
              {now.toLocaleTimeString('mn-MN', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: '1.5vw',
                fontWeight: 400,
                color: TV.ink3,
              }}
            >
              {/* ⚠ Intl-ийн `second: '2-digit'` нь mn-MN дээр НЭГ оронтой
                  буцаадаг (Chromium) тул 0-9 секундэд цаг хажуу тийш үсэрдэг
                  байсан.  Огнооны мөр аль хэдийн гараар padStart хийдэг. */}
              {String(now.getSeconds()).padStart(2, '0')}
            </span>
          </div>
        </div>
      </header>

      {/* ───────────── Биеийн хэсэг (scene солилт) ─────────────
          `flex-1` — тогтмол vh БИШ.  Доод үндсэн бичээс 2026-08-19-нд
          устсанаар scene-үүд түүний зайг авна; толгойн өндөр өөрчлөгдвөл
          энд гар аргаар тоо тааруулах шаардлагагүй. */}
      {/* ⚠ Удирдлагын мөр ХӨВӨГЧ тул урсгалд зай эзэлдэггүй бөгөөд шигүү
          кадрын сүүлийн мөрийг бүтнээр нь дардаг байсан.  Мөр харагдаж
          байх үед л доод зайг нэмнэ — контент үсрэхгүй, далдрахгүй. */}
      <main
        className={cn(
          'relative min-h-0 flex-1 px-[3.2vw] pt-[3vh]',
          controlsVisible ? 'pb-[11.5vh]' : 'pb-[2.4vh]',
        )}
      >
        {active.id === 'system' ? (
          // Амьд граф нь `/company/overview`-оос хамаардаггүй — тэр хүсэлт унасан ч ажиллана.
          <div key="system" className="h-full" style={{ animation: 'tvFadeIn 700ms ease-out both' }}>
            <Suspense fallback={<CenterMessage text={t('common.loading')} />}>
              <SystemScene />
            </Suspense>
          </div>
        ) : overviewQuery.isPending ? (
          <CenterMessage text={t('common.loading')} />
        ) : !data ? (
          <CenterMessage
            text={overviewQuery.error?.message ?? t('companyTvPage.overviewLoadFailed')}
            tone="error"
          />
        ) : (
          <div
            key={active.id}
            className="h-full"
            style={{ animation: 'tvFadeIn 700ms ease-out both' }}
          >
            <SceneBody
              id={active.id}
              data={data}
              charts={charts}
              chartsError={chartsQuery.error?.message ?? null}
              lifetime={lifetime}
              lifetimeError={lifetimeQuery.error?.message ?? null}
            />
          </div>
        )}
      </main>

      {/* Кадрын үлдсэн хугацаа — 2px үсний ширхэг, дэлгэцийн хамгийн доод
          ирмэгт.  Босоо зай эзлэхгүй тул үндсэн бичээстэй хамт устгаагүй. */}
      <SceneTicker durationMs={activeMs} resetKey={`bar-${sceneIndex}`} paused={!rotating} />

      {/* Хүрэлтийн сануулга — зөвхөн эхний 6 секунд. */}
      <TouchHint text={t('companyTvPage.ctrlHint')} />

      {/* Удирдлага нь ХӨВӨГЧ — урсгалд оруулбал гарч ирэх бүрт scene-ийн
          өндөр өөрчлөгдөж контент үсэрнэ. */}
      {controlsVisible && (
        <div className="absolute inset-x-0 bottom-0 px-[3.2vw] pb-[2.4vh]">
          <TvControls
            scenes={scenes}
            sceneIndex={sceneIndex}
            locked={locked}
            onPrev={goPrev}
            onNext={goNext}
            onJump={setSceneIndex}
            onToggleLock={() => setLocked((v) => !v)}
            onExit={exitTv}
            onInteract={touch.wake}
          />
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════  scenes  ════════════════════════════ */

function SceneBody({
  id,
  data,
  charts,
  chartsError,
  lifetime,
  lifetimeError,
}: {
  id: string;
  data: OverviewResponse;
  charts: CompanyChartsTimeseries | null;
  /** `/charts/timeseries` унасан бол алдааны текст. */
  chartsError: string | null;
  lifetime: CompanyLifetime | null;
  /** `/lifetime` унасан бол алдааны текст. */
  lifetimeError: string | null;
}) {
  // ⚠ `charts`/`lifetime` нь ЗӨВХӨН nullable утгаар доош дамждаг тул кадрууд
  //   «null = ачаалж байна» гэж үздэг байсан.  Хүсэлт УНАСАН тохиолдолд ч
  //   ялгаагүй null ирдэг учир найман кадрын тав нь «Ачааллаж байна…» дээр
  //   мөнхөд царцдаг байв — лоббид эвдэрсэн самбар гэдэг нь мэдэгддэггүй.
  //   Алдааг кадарт хүргэлгүйгээр энд шийднэ.
  if (chartsError && !charts && (id === 'index' || id === 'watchlist' || id === 'sectors')) {
    return <CenterMessage text={chartsError} tone="error" />;
  }
  if (lifetimeError && !lifetime && id === 'era') {
    return <CenterMessage text={lifetimeError} tone="error" />;
  }
  switch (id) {
    case 'era':
      return <EraScene data={lifetime} />;
    case 'pulse':
      return <PulseScene data={data} />;
    case 'index':
      return <IndexScene charts={charts} />;
    case 'watchlist':
      return <WatchlistScene charts={charts} />;
    case 'sectors':
      return <SectorsScene charts={charts} />;
    case 'portfolio':
      return <PortfolioScene projects={data.portfolio} />;
    case 'momentum':
      return <ActivityScene days={data.trends.daily} />;
    default:
      return null;
  }
}

/* ════════════ TradingView-маягийн компанийн scene-үүд ════════════ */

// Кошк candlestick-ийн тогтмол палитр (апп-ийн theme-ээс хамаарахгүй).
const TVC = {
  bg: '#0b1220',
  grid: 'rgba(240, 243, 250, 0.06)',
  text: '#94a3b8',
  up: '#26a69a', // ногоон (сайн өдөр)
  down: '#ef5350', // улаан (муу өдөр)
  vol: 'rgba(56, 189, 248, 0.22)', // ирцийн "volume" багана — дунджаас доош
  volStrong: 'rgba(56, 189, 248, 0.62)', // дунджаас дээш ирцтэй өдөр
  /** Өсөлтийн талбайн дүүргэлт — суурь шугамаас дээш/доош. */
  fillUp1: 'rgba(38, 166, 154, 0.42)',
  fillUp2: 'rgba(38, 166, 154, 0.02)',
  fillDown1: 'rgba(239, 83, 80, 0.02)',
  fillDown2: 'rgba(239, 83, 80, 0.38)',
  /** 30 хоногийн өмнөх түвшний тулгуур шугам. */
  startLine: 'rgba(148, 163, 184, 0.55)',
} as const;
const GOLD = '#f0b90b'; // төлөвлөсөн хурд + 100% зорилт

/** Өдрийн ахиц дунджийн талаас дээш бол "сайн" (ногоон) өдөр. */
function isGoodDay(gain: number, avgGain: number): boolean {
  return gain >= Math.max(avgGain * 0.5, 0.01);
}

/** Хуримтлагдсан явцын цувааг OHLC лаа болгоно: лаа бүр өмнөх цэгээс
 *  нээгдэж, одоогийнхоор хаагдана (биеийн өндөр = тухайн өдрийн ахиц). */
function buildCandles(series: Array<{ date: string; progress: number }>) {
  const base = series.map((p, i) => {
    const open = i > 0 ? series[i - 1]!.progress : p.progress;
    const close = p.progress;
    return {
      time: p.date as Time,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
    };
  });
  const total = base.reduce((s, c) => s + (c.close - c.open), 0);
  const avgGain = base.length ? total / base.length : 0;
  const candles = base.map((c) => {
    const col = isGoodDay(c.close - c.open, avgGain) ? TVC.up : TVC.down;
    return { ...c, color: col, borderColor: col, wickColor: col };
  });
  return { candles, avgGain };
}

/** Индексийн тэнхлэгийн ХАМГИЙН НАРИЙН цонх (нэгжээр).  Үүнээс нарийн зуум
 *  хийвэл 0.1 нэгжийн шуугиан «ралли» мэт харагдаж, өдөр бүрийн хэлбэлзэл
 *  утга учраа алдана. */
const INDEX_MIN_SPAN = 2;

/** Индексийн үнийн формат.
 *
 *  ⚠ Баруун тэнхлэг ба БҮХ үнийн шугамын шошго нь тухайн үнийн хуваарьт
 *  холбогдсон, ХАМГИЙН БАГА zorder-той (= хамгийн ЭХЭЛЖ нэмэгдсэн) цуваанаас
 *  форматаа авдаг (`PriceScale._internal_updateFormatter`), лаанаас биш.  Лаа
 *  одоо гурав дахь байрлалд (талбай → төлөвлөгөө → лаа) тул форматыг НЭГ
 *  тогтмолоор гурвуулангийнх нь дээр тавина — эс тэгвэл тэнхлэг «%»-ээ алдаж
 *  «17.50» гэж уншина (headless Chrome дээр давтагдсан).
 *
 *  ⚠ `localization.priceFormatter`-ээр «зассан» болохгүй: тэр нь график даяар
 *  үйлчилдэг тул ирцийн (pane 1) тэнхлэгт ч «%» наана. */
const INDEX_PRICE_FORMAT = {
  type: 'custom' as const,
  formatter: (v: number) => `${v.toFixed(1)}%`,
  minMove: 0.1,
};

/** Лааны утгуудаас ЗУУМЛАСАН үнийн цонх — `autoscaleInfoProvider`-ийн эх.
 *
 *  Хэвийн autoscale нь тухайн үнийн хуваарьт холбогдсон БҮХ цуваа (тэр дундаа
 *  40+ нэгж яваа төлөвлөгөө)-г нэгтгэдэг тул бодит хөдөлгөөнийг хавтгайруулдаг.
 *  Энд зөвхөн лааны low/high-г авч, дээр нь 8% амьсгал нэмнэ. */
function zoomRange(
  candles: Array<{ low: number; high: number }>,
): { min: number; max: number } | null {
  if (candles.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const c of candles) {
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = max - min;
  if (span < INDEX_MIN_SPAN) {
    const grow = (INDEX_MIN_SPAN - span) / 2;
    min -= grow;
    max += grow;
  }
  const pad = (max - min) * 0.08;
  return { min: Math.max(0, min - pad), max: max + pad };
}

/**
 * Компанийн индекс — lightweight-charts candlestick + ирцийн volume pane +
 * «30 хоногийн өмнөх түвшин»-ээс ургах baseline талбай.  Интерактив биш
 * (kiosk) тул zoom/pan/crosshair унтраасан, fitContent-ээр бүтнээр харуулна.
 *
 * ⚠ ЗУУМ нь энэ кадрын БҮХ УТГА УЧИР (2026-08-19-ний засвар).  Компанийн
 * бодит гүйцэтгэл 30 хоногт ~5 нэгж хөдөлдөг бол ТӨЛӨВЛӨСӨН шулуун 40+ нэгж
 * явдаг.  Хоёуланг нь нэг autoscale-д оруулахад тэнхлэг 10-80% болж, бодит
 * ахиц дэлгэцийн ~7%-д шахагдан «огт хөдлөөгүй» мэт харагддаг байсан.  Иймд:
 *
 *   · autoscale-д ЗӨВХӨН лаа оролцоно — `zoomRange()` цонхыг тогтооно;
 *   · төлөвлөсөн шугам ба 100%-ийн шугам autoscale-аас ХАСАГДСАН
 *     (`autoscaleInfoProvider: () => null`) — компани төлөвтэйгээ ойртвол
 *     өөрөө цонхонд орж ирнэ, хол байвал зүгээр л зурагдахгүй.
 *
 * ⇒ Энд ШИНЭ ЦУВАА нэмэх бүрдээ `autoscaleInfoProvider: () => null` тавих
 *   эсэхээ бод.  Лаанаас өөр юу ч тэнхлэгийг сунгаж БОЛОХГҮЙ, эс тэгвэл
 *   кадр дахин хавтгайрна.  `createPriceLine` нь autoscale-д ОРДОГГҮЙ тул
 *   100%-ийн шугам аюулгүй (lightweight-charts 5.2-ийн эх кодоор шалгасан).
 */
function CompanyIndexChart({
  overall,
  planned,
  headcount,
}: {
  overall: Array<{ date: string; progress: number }>;
  planned: Array<{ date: string; progress: number }>;
  headcount: Array<{ date: string; count: number }>;
}) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const growthRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  const planRef = useRef<ISeriesApi<'Line'> | null>(null);
  const histRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const startLineRef = useRef<IPriceLine | null>(null);
  /** `autoscaleInfoProvider` нь цуваа ҮҮСЭХ үед нэг л удаа бүртгэгддэг тул
   *  цонхыг ref-ээр дамжуулна — дата солигдох бүрд доорх effect шинэчилнэ. */
  const rangeRef = useRef<{ min: number; max: number } | null>(null);

  const { candles } = useMemo(() => buildCandles(overall), [overall]);
  const hasHeadcount = headcount.length > 0;

  // Зуумласны улмаас алтан шугам ихэвчлэн цонхноос гарна — тоог нь график
  // дээрх жижиг уншилтад үлдээж мэдээллийг алдахгүй.  («Хоцролт» = төлөвлөсөн −
  // бодит гэсэн хоёр дахь уншилт 2026-09-10-нд эзний шийдвэрээр устсан.)
  const planLatest = planned.length > 0 ? planned[planned.length - 1]!.progress : null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: TVC.bg },
        textColor: TVC.text,
        // lightweight-charts нь canvas дээр зурдаг тул vw хүлээж авдаггүй —
        // харагдах талбайн өргөнөөс тооцно, ингэснээр тэнхлэгийн бичвэр 4K
        // дээр бусад кадрын mono metadata-тай ижил өнцгийн хэмжээтэй болно.
        fontSize: Math.max(13, Math.round(window.innerWidth * 0.0092)),
        attributionLogo: false,
      },
      grid: { vertLines: { color: TVC.grid }, horzLines: { color: TVC.grid } },
      rightPriceScale: {
        borderVisible: false,
        // Зуумласан цонхонд амьсгал — сүүлийн үнийн шошго ирмэг дээр таслагдахгүй.
        scaleMargins: { top: 0.12, bottom: 0.1 },
      },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: CrosshairMode.Hidden },
      handleScroll: false,
      handleScale: false,
      localization: { locale: 'mn-MN' },
    });

    // (1) Өсөлтийн талбай.  Суурь = 30 хоногийн өмнөх түвшин, түүнээс дээш
    //     ногоон / доош улаан дүүргэлт.  Лааны ДООР зурагдана — нэмсэн
    //     дараалал нь z-эрэмбэ (lightweight-charts data source zorder).
    const growth = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      // ⚠ Доорх effect-ээс нээгдэнэ.  Цонх бүхэлдээ ХАВТГАЙ (бүх утга тэнцүү)
      //   үед relativeGradient нь градиентийн уртыг 0 болгож `0/0 = NaN`
      //   гаргаад `addColorStop(NaN)` шидэж, БҮХЭЛ самбарыг цайруулдаг.
      relativeGradient: false,
      topFillColor1: TVC.fillUp1,
      topFillColor2: TVC.fillUp2,
      topLineColor: 'rgba(38, 166, 154, 0.5)',
      bottomFillColor1: TVC.fillDown1,
      bottomFillColor2: TVC.fillDown2,
      bottomLineColor: 'rgba(239, 83, 80, 0.5)',
      lineWidth: 1,
      priceFormat: INDEX_PRICE_FORMAT,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      // Лаатай ЯГ ижил утга тул тэнхлэгт дахин хувь нэмэр оруулах шаардлагагүй.
      autoscaleInfoProvider: () => null,
    });

    // (2) Төлөвлөсөн хурд — толгойн тайлбарыг үз: autoscale-д ОРОХГҮЙ.
    const plan = chart.addSeries(LineSeries, {
      color: GOLD,
      lineWidth: 2,
      lineStyle: LineStyle.Dotted,
      priceFormat: INDEX_PRICE_FORMAT,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => null,
    });

    // (3) Лаа — тэнхлэгийг тогтоох ЦОРЫН ГАНЦ эх сурвалж.
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: TVC.up,
      downColor: TVC.down,
      borderUpColor: TVC.up,
      borderDownColor: TVC.down,
      wickUpColor: TVC.up,
      wickDownColor: TVC.down,
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dotted,
      priceLineWidth: 1,
      priceLineColor: TVC.up,
      priceFormat: INDEX_PRICE_FORMAT,
      autoscaleInfoProvider: () => {
        const r = rangeRef.current;
        return r ? { priceRange: { minValue: r.min, maxValue: r.max } } : null;
      },
    });
    candle.createPriceLine({
      price: 100,
      color: GOLD,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: t('companyTvPage.targetLine'),
    });
    chartRef.current = chart;
    candleRef.current = candle;
    growthRef.current = growth;
    planRef.current = plan;

    if (hasHeadcount) {
      const hist = chart.addSeries(
        HistogramSeries,
        {
          color: TVC.vol,
          priceFormat: { type: 'custom', formatter: (v: number) => `${Math.round(v)}`, minMove: 1 },
          priceLineVisible: false,
        },
        1,
      );
      histRef.current = hist;
      const panes = chart.panes();
      panes[0]?.setStretchFactor(5);
      panes[1]?.setStretchFactor(1);
    }

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      growthRef.current = null;
      planRef.current = null;
      histRef.current = null;
      startLineRef.current = null;
      rangeRef.current = null;
    };
    // Дата нь доорх effect-үүдээр шахагдана.  ГЭХДЭЭ `hasHeadcount` нь
    // хамаарлын жагсаалтад ЗААВАЛ байх ёстой: ирцийн pane нь график ҮҮСЭХ үед
    // л нэмэгддэг тул хоосон ирцтэй эхэлж, өдрийн эхний ирц дараа нь ирвэл
    // «volume» багана хэзээ ч гарч ирэхгүй байсан.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHeadcount]);

  useEffect(() => {
    const candle = candleRef.current;
    const growth = growthRef.current;
    const chart = chartRef.current;
    if (!candle || !growth || !chart) return;

    // ⚠ ДАРААЛАЛ: цонхыг ЭХЛЭЭД ref-д тавина — `setData` нь autoscale-ыг
    //   шууд дахин тооцдог тул хоцорвол хуучин цонхоор нэг кадр зурна.
    rangeRef.current = zoomRange(candles);

    const start = candles.length > 0 ? candles[0]!.open : null;
    const last = candles.length > 0 ? candles[candles.length - 1]!.close : null;
    const falling = start !== null && last !== null && last < start;
    candle.applyOptions({ priceLineColor: falling ? TVC.down : TVC.up });
    candle.setData(candles);

    // «30 хоногийн өмнөх түвшин» — өсөлтийг нүдээр барих тулгуур шугам.
    // Дата солигдоход шинэчлэгдэх ёстой тул хуучныг нь эхлээд авч хаяна.
    if (startLineRef.current) {
      candle.removePriceLine(startLineRef.current);
      startLineRef.current = null;
    }
    if (start !== null) {
      startLineRef.current = candle.createPriceLine({
        price: start,
        color: TVC.startLine,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: t('companyTvPage.startLine'),
      });
      // Хавтгай цонхонд relativeGradient унтарсан хэвээр — толгойн тайлбарыг үз.
      const flat = candles.every((c) => c.close === candles[0]!.close);
      growth.applyOptions({
        baseValue: { type: 'price', price: start },
        relativeGradient: !flat,
      });
    }
    growth.setData(candles.map((c) => ({ time: c.time, value: c.close })));

    chart.timeScale().fitContent();
  }, [candles, t]);

  useEffect(() => {
    const plan = planRef.current;
    if (!plan) return;
    plan.setData(planned.map((p) => ({ time: p.date as Time, value: p.progress })));
  }, [planned]);

  useEffect(() => {
    const hist = histRef.current;
    if (!hist) return;
    // Дунджаас дээш ирцтэй өдрийг тодруулна — «volume»-ийн уламжлалт уншилт.
    const avg =
      headcount.length > 0 ? headcount.reduce((s, h) => s + h.count, 0) / headcount.length : 0;
    hist.setData(
      headcount.map((h) => ({
        time: h.date as Time,
        value: h.count,
        color: h.count >= avg ? TVC.volStrong : TVC.vol,
      })),
    );
  }, [headcount]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {planLatest !== null && (
        <div
          // z-10 — самбарын canvas-ууд z-index 1/2-той тул үүнгүйгээр ДООГУУР
          // нь будагдаж, огт харагдахгүй болно.
          className="pointer-events-none absolute left-5 top-3 z-10 flex items-center gap-6"
          style={metaStyle}
        >
          <span className="text-slate-500">
            {t('companyTvPage.plannedPace')}{' '}
            <span style={{ color: GOLD }}>{planLatest.toFixed(1)}%</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** «Өдрийн дундаж» уншилт — эзний 2026-09-10-ны шийдвэрээр ТОГТМОЛ 2.5%.
 *  Өмнө нь 30 хоногийн өөрчлөлтийг өдрөөр хуваасан бодит утга (ихэвчлэн
 *  0.1–0.3%) гардаг байсан; лоббид гаргах зорилтот хурд гэж үз. */
const INDEX_AVG_PER_DAY = 2.5;

/* ── Scene: Компанийн индекс (candlestick HERO) ── */
function IndexScene({ charts }: { charts: CompanyChartsTimeseries | null }) {
  const { t } = useLanguage();
  if (!charts) return <CenterMessage text={t('common.loading')} />;
  if (charts.overall.length === 0)
    return <CenterMessage text={t('companyTvPage.noApprovedProgress')} />;
  const latest = charts.overall[charts.overall.length - 1]!.progress;
  const first = charts.overall[0]!.progress;
  const change = Math.round((latest - first) * 100) / 100;
  const up = change >= 0;
  const onSiteToday = charts.projects.reduce((s, p) => s + p.headcount_today, 0);
  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-end gap-8">
        <div>
          <div style={{ fontSize: TV_SIZE.h3, color: TV.ink2 }}>
            {t('companyTvPage.companyOverallProgress')}
          </div>
          <div className="flex items-end gap-4">
            <span
              className="leading-none tabular-nums"
              style={{
                // ⚠ vw — kiosk нь fullscreen тул 1080p ба 4K дээр ИЖИЛ өнцгийн
                //   хэмжээтэй байх ёстой.  rem нь хөтчийн үндсэн хэмжээнээс
                //   хамаардаг тул 4K дээр хагас болж жижгэрдэг байсан.
                fontSize: '5.6vw',
                // Inter нь 900 жинг ачаалдаггүй — font-black нь ХУУРАМЧ.
                fontWeight: 700,
                letterSpacing: '-0.03em',
                color: up ? TVC.up : TVC.down,
                // Харанхуй самбар дээрх зөөлөн гэрэлтэлт — 3-5м-ээс «амьд» харагдана.
                textShadow: `0 0 44px ${up ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)'}`,
              }}
            >
              {latest.toFixed(1)}
              <span style={{ fontSize: '0.5em' }}>%</span>
            </span>
            <span
              className="mb-[1.2vh] inline-flex items-center gap-[0.3vw] font-bold tabular-nums"
              style={{ fontSize: '2vw', color: up ? TVC.up : TVC.down }}
            >
              {up ? (
                <TrendingUp style={{ width: '1.7vw', height: '1.7vw' }} />
              ) : (
                <TrendingDown style={{ width: '1.7vw', height: '1.7vw' }} />
              )}
              {up ? '+' : ''}
              {change.toFixed(1)}%
              <span style={{ marginLeft: '0.3vw', fontSize: TV_SIZE.body, color: TV.ink3 }}>
                {t('companyTvPage.per30Days')}
              </span>
            </span>
          </div>
        </div>
        <div className="ml-auto flex gap-10 text-right">
          <Stat label={t('companyTvPage.avgPerDay')} value={`+${INDEX_AVG_PER_DAY.toFixed(1)}%`} />
          <Stat label={t('companyTvPage.activeProjects')} value={charts.projects.length} />
          <Stat label={t('companyTvPage.onSiteToday')} value={onSiteToday} />
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10"
        style={{ backgroundColor: TVC.bg }}
      >
        <CompanyIndexChart
          overall={charts.overall}
          planned={charts.planned}
          headcount={charts.headcount}
        />
      </div>
    </div>
  );
}

/* ── Scene: Төслүүдийн watchlist ── */
function WatchlistScene({ charts }: { charts: CompanyChartsTimeseries | null }) {
  const { t } = useLanguage();
  if (!charts) return <CenterMessage text={t('common.loading')} />;
  // ⚠ 8 мөр, 9 БИШ.  1080p дээр 9 мөр нь `overflow-hidden` савнаас ~11px
  //   давдаг тул сүүлийн мөр чимээгүй тасардаг байсан.
  // Зөвхөн 30 хоногт ӨССӨН төслүүд, хамгийн их өсөлттэй нь дээрээ (эзний
  // 2026-09-10-ны шийдвэр): 0%-тай болон хасалттай (буурсан) төсөл дэлгэц
  // дүүргэхийн тулд гаргахгүй.
  const rows = charts.projects
    .filter((p) => p.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, 8);
  if (rows.length === 0) return <CenterMessage text={t('companyTvPage.noGainers')} />;
  return (
    <div className="flex h-full flex-col">
      <div
        className="mb-[1.2vh] grid grid-cols-[2fr_1.4fr_1fr_0.8fr] items-center px-[1vw]"
        style={{ ...metaStyle, color: TV.ink3 }}
      >
        <span>{t('companyTvPage.colProject')}</span>
        <span>{t('companyTvPage.col30Days')}</span>
        <span className="text-right">{t('companyTvPage.colDeadline')}</span>
        <span className="text-right">{t('companyTvPage.colProgress')}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-hidden">
        {rows.map((p) => {
          const up = p.change >= 0;
          const col = up ? TVC.up : TVC.down;
          const vals = p.series.map((s) => s.progress);
          return (
            <div
              key={p.id}
              className="grid grid-cols-[2fr_1.4fr_1fr_0.8fr] items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3"
            >
              <div className="min-w-0">
                <div
                  className="truncate font-semibold"
                  style={{ fontSize: TV_SIZE.h3, color: TV.ink }}
                >
                  {p.name}
                </div>
                {/* ⚠ Энд ӨМНӨ нь «N хүн өнөөдөр» гэж тухайн төсөл дээр хэдэн
                    хүн байгааг гаргадаг байсан.  2026-08-19-нд ЗОРИУД авав:
                    лоббиийн самбарт төсөл тус бүрийн хүний тоо харуулахгүй
                    (мөн шалтгаанаар «Талбай дээр» кадар бүтнээрээ устсан).
                    Буцааж нэмэхгүй — ажлын хэмжээг даалгаврын тоогоор өгнө. */}
                <div style={{ ...metaStyle, color: TV.ink3 }}>
                  {t('companyTvPage.tasksCount', { count: p.task_count })}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Sparkline values={vals} color={col} />
                <span
                  className="inline-flex items-center gap-[0.2vw] font-bold tabular-nums"
                  style={{ fontSize: TV_SIZE.body, color: col }}
                >
                  {up ? '▲' : '▼'}
                  {Math.abs(p.change).toFixed(1)}%
                </span>
              </div>
              <div className="text-right" style={{ fontSize: TV_SIZE.body }}>
                {p.finish_date ? (
                  <DeadlineLabel daysLeft={p.days_left} finish={p.finish_date} />
                ) : (
                  <span className="italic" style={{ color: TV.ink3 }}>
                    —
                  </span>
                )}
              </div>
              <div
                className="text-right tabular-nums"
                style={{
                  fontSize: '2.4vw',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: tvProgressColor(p.progress),
                }}
              >
                {formatPct(p.progress)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Жижиг SVG sparkline (төслийн явцын муруй). */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  // Дотоод солбилцол нь ТОГТМОЛ (viewBox), гадаад хэмжээ нь vw/vh — ингэснээр
  // 4K дээр муруй мөрийнхөө өндөртэй хамт томорно.  `vectorEffect` нь
  // `preserveAspectRatio="none"`-ийн улмаас шугам сунах, нимгэрэхээс хамгаална.
  const width = 120;
  const height = 36;
  const box = { width: '7vw', height: '2.6vh' } as const;
  if (values.length < 2) return <svg viewBox={`0 0 ${width} ${height}`} style={box} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((v - min) / range) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={box} preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DeadlineLabel({ daysLeft, finish }: { daysLeft: number | null; finish: string }) {
  const { t } = useLanguage();
  if (daysLeft == null) {
    return (
      <span className="inline-flex items-center gap-[0.4vw]">
        <CalendarDays style={{ width: '1.2vw', height: '1.2vw' }} /> {formatDate(new Date(finish))}
      </span>
    );
  }
  const tone = daysLeft < 0 ? 'text-rose-400' : daysLeft < 14 ? 'text-amber-400' : 'text-slate-500';
  const text =
    daysLeft < 0
      ? t('companyTvPage.daysOverdue', { count: Math.abs(daysLeft) })
      : daysLeft === 0
        ? t('companyTvPage.deadlineToday')
        : t('companyTvPage.daysLeft', { count: daysLeft });
  return (
    <span className={cn('inline-flex items-center gap-[0.4vw] font-medium', tone)}>
      <CalendarDays style={{ width: '1.2vw', height: '1.2vw' }} /> {text}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div style={{ ...metaStyle, color: TV.ink3 }}>{label}</div>
      <div
        className="tabular-nums"
        style={{ fontSize: '2.6vw', fontWeight: 600, letterSpacing: '-0.02em', color: TV.ink }}
      >
        {value}
      </div>
    </div>
  );
}

/* ════════════════════════════  helpers  ════════════════════════════ */

function CenterMessage({ text, tone }: { text: string; tone?: 'error' }) {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center text-center text-3xl',
        tone === 'error' ? 'text-rose-400' : 'text-slate-500',
      )}
    >
      {text}
    </div>
  );
}

function formatPct(value: number | null | undefined): string {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (v > 0 && v < 1) return `${v.toFixed(1)}%`;
  return `${v.toFixed(0)}%`;
}
