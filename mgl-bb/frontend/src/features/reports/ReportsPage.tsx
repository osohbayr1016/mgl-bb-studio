import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileBarChart2 } from 'lucide-react';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { useLanguage } from '@/shared/i18n';
import { todayUB } from '@/shared/lib/time';
import { REPORT_WINDOWS, type ReportWindow } from './types';
import { isIsoDate } from './lib/windows';
import { PeriodSelector } from './components/PeriodSelector';
import { OverviewTab } from './components/OverviewTab';
import { EmployeeTab } from './components/EmployeeTab';
import { TeamsTab } from './components/TeamsTab';
import { SnapshotsTab } from './components/SnapshotsTab';
import { RepairProjectsTab } from './components/RepairProjectsTab';
import { NonProjectWorkTab } from './components/NonProjectWorkTab';
import { TaskTimeTab } from './components/TaskTimeTab';
import { ManagementLogsTab } from './components/ManagementLogsTab';

const TABS = ['overview', 'employee', 'teams', 'snapshots', 'repair', 'nonproject', 'tasktime', 'mgmt'] as const;
type Tab = (typeof TABS)[number];

function parseRepairKey(raw: string | null): string | null {
  const m = /^(?:([pr]):)?(\d+)$/.exec((raw ?? '').trim());
  if (!m || Number(m[2]) <= 0) return null;
  return `${m[1] ?? 'r'}:${Number(m[2])}`;
}

/**
 * «Тайлан» — админд зориулсан ажилтан/багийн гүйцэтгэлийн тайлан.
 *
 * URL нь бүтэн төлөв: `?tab=&window=&anchor=&user=&team=&rp=&mu=` — хуваалцаж,
 * сэргээж ачаалж, глобал хайлтаас үсэрч болно.  Route нь
 * `ProtectedRoute allowedRoles={['admin']}` ард — хуудас өөрөө ролио шалгахгүй.
 *
 * Тоо бүр `/api/reports/*`-ээс; байрын түүх өдөр бүрийн snapshot-оос
 * (`lib/employeeSnapshot.ts`), бусад нь ledger-ээс live.
 */
export default function ReportsPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useTabParam(TABS, 'overview');
  const [sp, setSp] = useSearchParams();

  const today = todayUB();
  const windowRaw = sp.get('window');
  const window: ReportWindow = (REPORT_WINDOWS as readonly string[]).includes(windowRaw ?? '') ? (windowRaw as ReportWindow) : '7d';
  const anchorRaw = sp.get('anchor');
  const anchor = isIsoDate(anchorRaw) && anchorRaw <= today ? anchorRaw : today;
  const userRaw = Number(sp.get('user'));
  const userId = Number.isFinite(userRaw) && userRaw > 0 ? userRaw : null;
  const teamRaw = Number(sp.get('team'));
  const teamId = Number.isFinite(teamRaw) && teamRaw > 0 ? teamRaw : null;
  // `rp` = сонгосон засварын зорилт: `r:<repair_projects.id>` | `p:<projects.id>`
  // (хоёр id-ийн орон зай давхцдаг); хуучин цэвэр тоо = дотоод ажил.
  const repairKey = parseRepairKey(sp.get('rp'));
  // `mu` = «Менежментийн багийн тайлан»-д нээсэн гишүүн.
  const muRaw = Number(sp.get('mu'));
  const mgmtUser = Number.isFinite(muRaw) && muRaw > 0 ? muRaw : null;

  const patch = useCallback(
    (changes: Record<string, string | null>, opts: { replace?: boolean } = { replace: true }) => {
      setSp(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v == null || v === '') p.delete(k);
            else p.set(k, v);
          }
          return p;
        },
        { replace: opts.replace ?? true },
      );
    },
    [setSp],
  );

  const setWindow = (w: ReportWindow) => patch({ window: w === '7d' ? null : w });
  const setAnchor = (d: string) => patch({ anchor: d === today ? null : d });
  const pickUser = (id: number) => patch({ user: String(id), tab: 'employee' }, { replace: false });
  const setTeam = (id: number | null) => patch({ team: id == null ? null : String(id) });
  const pickRepair = (key: string | null) => patch({ rp: key }, { replace: false });
  const pickMgmt = (id: number | null) => patch({ mu: id == null ? null : String(id) }, { replace: false });

  return (
    <PageContainer>
      <PageHeader
        title={t('reportsPage.title')}
        description={tab === 'mgmt' ? undefined : t('reportsPage.description')}
        icon={FileBarChart2}
        actions={tab !== 'snapshots' && tab !== 'repair' && tab !== 'nonproject' && !(tab === 'mgmt' && mgmtUser == null) ? <PeriodSelector window={window} anchor={anchor} onWindow={setWindow} onAnchor={setAnchor} /> : undefined}
      />

      <KeepAliveTabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-3">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-[orientation=horizontal]/tabs:h-auto">
          <TabsTrigger value="overview" className="h-auto flex-none py-1.5">
            {t('reportsPage.tabOverview')}
          </TabsTrigger>
          <TabsTrigger value="employee" className="h-auto flex-none py-1.5">
            {t('reportsPage.tabEmployee')}
          </TabsTrigger>
          <TabsTrigger value="teams" className="h-auto flex-none py-1.5">
            {t('reportsPage.tabTeams')}
          </TabsTrigger>
          <TabsTrigger value="snapshots" className="h-auto flex-none py-1.5">
            {t('reportsPage.tabSnapshots')}
          </TabsTrigger>
          <TabsTrigger value="repair" className="h-auto flex-none py-1.5">
            {t('reportsPage.tabRepair')}
          </TabsTrigger>
          <TabsTrigger value="nonproject" className="h-auto flex-none py-1.5">
            {t('reportsPage.tabNonProject')}
          </TabsTrigger>
          <TabsTrigger value="tasktime" className="h-auto flex-none py-1.5">
            {t('reportsPage.tabTaskTime')}
          </TabsTrigger>
          <TabsTrigger value="mgmt" className="h-auto flex-none py-1.5">
            {t('reportsPage.tabManagement')}
          </TabsTrigger>
        </TabsList>

        <KeepAliveTabsPanel value="overview">
          <div id="sec-reports-overview" className="scroll-mt-24">
            <OverviewTab window={window} anchor={anchor} onPick={pickUser} />
          </div>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="employee">
          <EmployeeTab userId={userId} onPick={(id) => patch({ user: String(id) })} window={window} anchor={anchor} />
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="teams">
          <div id="sec-reports-teams" className="scroll-mt-24">
            <TeamsTab window={window} anchor={anchor} teamId={teamId} onTeam={setTeam} onPick={pickUser} />
          </div>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="snapshots">
          <SnapshotsTab userId={userId} onPick={(id) => patch({ user: String(id) })} />
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="repair">
          <div id="sec-reports-repair" className="scroll-mt-24">
            <RepairProjectsTab rid={repairKey} onPick={pickRepair} />
          </div>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="nonproject">
          <div id="sec-reports-nonproject" className="scroll-mt-24">
            <NonProjectWorkTab />
          </div>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="tasktime">
          <div id="sec-reports-tasktime" className="scroll-mt-24">
            <TaskTimeTab window={window} anchor={anchor} />
          </div>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="mgmt">
          <ManagementLogsTab window={window} anchor={anchor} memberId={mgmtUser} onMember={pickMgmt} />
        </KeepAliveTabsPanel>
      </KeepAliveTabs>
    </PageContainer>
  );
}
