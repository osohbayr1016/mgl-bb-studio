import { useCallback, useMemo, useState } from 'react';
import { Building2, Plus, Loader2 } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { Button } from '@/ui/button';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import { cn } from '@/shared/lib/utils';
import { todayUB } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { DateNavigator } from './components/DateNavigator';
import { useTeamAdminDialogs } from './components/TeamAdminDialogs';
import { AllocationTeamView } from './components/AllocationTeamView';
import { OverviewTab } from './components/OverviewTab';
import { MyTeamRedirect } from './MyTeamRedirect';
import { seesAllTeams } from './lib/teamAccess';
import {
  ALLOC_RANGES,
  ALLOC_RANGE_DAYS,
  buildAllocationModel,
  type AllocRange,
  type AllocationResponse,
} from './lib/allocation';

// Хуучин `?tab=today` / `?tab=matrix` / `?tab=leaderboard` холбоос
// `useTabParam`-аар өгөгдмөл руу чимээгүй буудаг.  «Эрэмбэ» таб (2026-09-25)
// эзний хүсэлтээр 2026-09-28-нд хасагдсан.
const TABS = ['byTeam', 'overview'] as const;

/**
 * Багууд — «хүн хүчний хуваарилалтын самбар».
 *
 * Хуудас ХОЁР л асуултад хариулахаар зохиогдсон:
 *   1. Аль багийн хэдэн гишүүн аль төсөл дээр ажиллаж байна вэ?
 *   2. Аль төсөл дээр аль багаас хэдэн хүн ажиллаж байна вэ?
 *
 * 2026-09-14 — ГРАФИК-ТӨВТЭЙ болгов.  Эзний хүсэлт: «дугуй диаграм, график
 * хараад л бүх мэдээллийг авдаг байх; олон нэр, текст биш».  Судалгаа
 * (бодит өгөгдөл дээр дэлгэцийн зураг авч хэмжсэн):
 *   • «Матриц» өгөгдмөл таб = 96 нүдтэй ТООНЫ хүснэгт + хажууд нь 5
 *     догол мөрийн «Хэрхэн унших вэ» заавар — заавар шаарддаг хуудас
 *     бол өөрөө асуудал;
 *   • «Багаар» = ганц тууз график (бүх баг ~100% дүүрэн тул юу ч хэлэхгүй)
 *     + 11 карт × 12 мөр текст; «Төслөөр» = нэг тоог тууз/чип/аватараар
 *     3 удаа давтсан, харин ЯВЦ огт байхгүй; «Өнөөдөр» = 40 нэрийн
 *     жагсаалт, ирцийн тоо API-д байсан ч харагддаггүй.
 *   • Толгойн 5 KPI нь 10px текст — хуудасны хамгийн чухал тоо хамгийн жижиг.
 *
 * Одоо ХОЁР таб (2026-09-16: «Төслөөр» таб, Тоймын 4 KPI + «Төслийн явц»
 * график эзний хүсэлтээр хасагдсан; 2026-09-24: «Өнөөдөр» ба «Матриц» табууд
 * хасагдсан), өгөгдмөл нь «Багаар» (2026-09-18):
 *   Багаар   — баг бүр нэг донат-карт (хүмүүс аль төсөл дээр);
 *   Тойм     — хүн хүч багаар / төслөөр донат; зүсэм дээр дарвал баруун
 *              талын самбарт (`TeamPanel` / `ProjectPanel`).
 * Хоёр таб нэг `buildAllocationModel`-оос уншдаг тул тоо зөрөхгүй.
 *
 * 2026-09-24: «Хуваарилалт / Ирц» хэмжүүрийн сэлгүүр хасагдсан — хуудас
 * үргэлж ИРЦЭЭР (ирц бүртгүүлэхдээ сонгосон төсөл) харуулна.
 *
 * 2026-09-30: энэ самбар ЗӨВХӨН admin/senior-д.  Бусад ажилтан `/app/teams`
 * дээр өөрийн багийн дэлгэрэнгүй хуудас руу шууд орно (`MyTeamRedirect`).
 *
 * ⚠️ ХУУДАС ӨӨРӨӨ ГҮЙЛГЭГДЭХГҮЙ (эзний гомдол 2026-09-03: «заавал доошоо
 * гүйлгээд байгааг нь арилга, бүх мэдээллийг шууд аваад бай»).  Тиймээс:
 *   • `/app/teams` нь `FULL_BLEED_ROUTES`-д — `<main>` нь `overflow-hidden`,
 *     өндрийг хуудас өөрөө хуваарилна;
 *   • гүйлгэлт хэрэгтэй бол зөвхөн тухайн ХАЙРЦАГ дотроо гүйлгэнэ.
 */
export default function TeamsPage() {
  const { user } = useAuth();
  if (!user) return null; // ProtectedRoute нэвтрээгүй хүнийг энд оруулдаггүй
  // Энгийн ажилтан бүх багийн самбарыг харахгүй — өөрийн багийн хуудас руу орно.
  // Хуваарилалтын өгөгдлийг (`/teams/allocation`) сервер ч зөвхөн admin/senior-д өгнө.
  return seesAllTeams(user.role) ? <TeamsBoard /> : <MyTeamRedirect />;
}

function TeamsBoard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isAdmin = seesAllTeams(user?.role);

  const today = todayUB();
  const [date, setDate] = useState(today);
  // Өгөгдмөл: бүгдэд «Багаар» (2026-09-18).
  const [tab, setTab] = useTabParam(TABS, 'byTeam');
  // Муж (өдөр / 7 хоног / сар / 3 сар / 6 сар) — сонгосон огноогоор төгсөнө.
  // Мужаар тоо бүр ажлын өдрийн ДУНДАЖ хүн (2026-09-18, `lib/allocation.ts`).
  const [range, setRange] = useState<AllocRange>('day');

  const allocationQuery = useApiQuery<AllocationResponse>(
    ['/teams/allocation', date, range],
    `/teams/allocation?date=${date}&range=${range}`,
  );

  // Хэмжүүр нь үргэлж ИРЦ — толгойн тайлбарыг үз.
  const model = useMemo(
    () => buildAllocationModel(allocationQuery.data),
    [allocationQuery.data],
  );

  const refetchAll = useCallback(async () => {
    await allocationQuery.refetch();
  }, [allocationQuery]);

  const admin = useTeamAdminDialogs(refetchAll);
  const loading = allocationQuery.isLoading;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Толгой: гурван мөр, бүгд shrink-0 ── */}
      <header className="shrink-0 border-b border-border bg-background/95 px-4 py-2 backdrop-blur-sm sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-primary" />
            <h1 className="truncate text-sm font-semibold sm:text-base">{t('teams.title')}</h1>
          </div>
          <DateNavigator
            date={date}
            today={today}
            onChange={setDate}
            stepDays={ALLOC_RANGE_DAYS[range]}
            from={range !== 'day' ? allocationQuery.data?.from : undefined}
          />
          <RangeToggle range={range} onChange={setRange} />
          {model.spanDays != null && model.activeDays > 0 && (
            <span
              className="text-[11px] text-muted-foreground"
              title={t('teams.spanAvgNote', { days: model.activeDays })}
            >
              {t('teams.spanAvgBadge', { days: model.activeDays })}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {isAdmin && (
              <Button size="sm" onClick={admin.openCreate}>
                <Plus className="mr-1 h-3.5 w-3.5" /> {t('teams.addTeam')}
              </Button>
            )}
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <KeepAliveTabs
          value={tab}
          onValueChange={(v) => setTab(v as (typeof TABS)[number])}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="shrink-0 border-b border-border px-4 py-1.5 sm:px-5">
            <TabsList className="h-8 w-full max-w-2xl">
              <TabsTrigger value="byTeam" className="text-xs">
                {t('teams.tabByTeam')}
              </TabsTrigger>
              <TabsTrigger value="overview" className="text-xs">
                {t('teams.tabOverview')}
              </TabsTrigger>
            </TabsList>
          </div>

          <KeepAliveTabsPanel value="overview" className="min-h-0 flex-1 data-[state=active]:flex">
            <OverviewTab model={model} />
          </KeepAliveTabsPanel>

          <KeepAliveTabsPanel value="byTeam" className="min-h-0 flex-1 data-[state=active]:flex">
            <div id="sec-teams-by-team" className="min-h-0 w-full flex-1">
              <AllocationTeamView model={model} />
            </div>
          </KeepAliveTabsPanel>
        </KeepAliveTabs>
      )}

      {isAdmin && admin.dialogs}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Мужийн сэлгүүр — ирцийн хэмжүүрийг хэдэн өдрөөр нэгтгэх вэ (2026-09-17).
 * «Өдөр» = зөвхөн сонгосон огноо; бусад нь тэр огноогоор ТӨГСДӨГ муж, тоо
 * нь тэр мужийн ажлын өдрийн ДУНДАЖ хүн (2026-09-18).
 */
function RangeToggle({
  range,
  onChange,
}: {
  range: AllocRange;
  onChange: (next: AllocRange) => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-border bg-card p-0.5"
      title={t('teams.rangeHelp')}
    >
      {ALLOC_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={cn(
            'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
            range === r
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(`teams.range_${r}`)}
        </button>
      ))}
    </div>
  );
}

