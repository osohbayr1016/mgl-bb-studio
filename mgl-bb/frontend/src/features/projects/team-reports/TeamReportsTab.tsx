import { useMemo } from 'react';
import { FileText, ListChecks, Wrench, Flame, ClipboardList, Building2 } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Tabs, TabsContent, TabsTrigger } from '@/ui/tabs';
import { teamChipClass } from '@/shared/lib/team-colors';
import { TeamRadixTabsStrip, type TeamChipItem } from '@/shared/components/TeamTabsStrip';
import type { ProjectTeamShare } from '@/shared/types';
import type { TeamReportResource } from '@/features/projects/team-reports/types';
import { NormPanel } from '@/features/projects/team-reports/norm/NormPanel';
import { ProjectSectionPanel } from '@/features/projects/team-reports/project-sections/ProjectSectionPanel';
import { ExternalAgencyPanel } from '@/features/projects/team-reports/project-sections/ExternalAgencyPanel';
import { GENERAL_SECTIONS } from '@/features/projects/team-reports/project-sections/generalTemplate';
import { ROOMS_SECTIONS } from '@/features/projects/team-reports/project-sections/roomsTemplate';
import { FIRE_SECTIONS } from '@/features/projects/team-reports/project-sections/fireTemplate';
import { BaPanel } from '@/features/projects/team-reports/ba/BaPanel';
import { BbPanel } from '@/features/projects/team-reports/bb/BbPanel';
import { HasPanel } from '@/features/projects/team-reports/has/HasPanel';
import { CbuPanel } from '@/features/projects/team-reports/cbu/CbuPanel';
import { TsahPanel } from '@/features/projects/team-reports/tsah/TsahPanel';
import { HdPanel } from '@/features/projects/team-reports/hd/HdPanel';
import { AuPanel } from '@/features/projects/team-reports/au/AuPanel';
import { IzPanel } from '@/features/projects/team-reports/iz/IzPanel';

/* =============================================================
 * Outer wrapper for the per-team explanatory note.
 * -------------------------------------------------------------
 * Each project has one or more disciplines assigned via
 * `team_shares`. We expose one sub-tab per assigned team; the
 * BA team has a real questionnaire today, the rest fall through
 * to a placeholder card so the surface tells the user the
 * template hasn't been wired up yet rather than 404-ing.
 *
 * The list-of-reports query gives us a quick "filled / empty"
 * badge on each sub-tab so editors can spot which teams still
 * need work without opening each one.
 * ============================================================= */

interface TeamReportsTabProps {
  projectId: number;
  teamShares: ProjectTeamShare[];
  readOnly?: boolean;
}

interface TeamReportsListResponse {
  reports: TeamReportResource[];
}

// Per-team plug-in registry. Add entries here as new disciplines
// get a real questionnaire. Anything missing renders a placeholder.
const IMPLEMENTED_TEAMS: Record<string, true | undefined> = {
  BA: true,
  BB: true,
  HAS: true,
  TSBU: true,
  TSAH: true,
  HD: true,
  AU: true,
  IZ: true,
};

/* Project-level (баг бус) tab-ууд: Норм дүрэм, Техникийн өрөө, Галын
 * аюулгүй байдал. Багийн chip strip-ийн `trailing` slot-д орох ба ижил
 * Radix Tabs context хуваалцана. */
const PROJECT_TAB_TRIGGER_CLS =
  'flex-none h-auto gap-1.5 px-2 py-1 rounded-md border border-border/40 bg-background/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary/30 transition-colors';

function ProjectTabTriggers() {
  return (
    <>
      <TabsTrigger value="GENERAL" title="Үндэслэл, байршил, ангилал" className={PROJECT_TAB_TRIGGER_CLS}>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
          <ClipboardList className="size-3.5" /> Үндэслэл, ангилал
        </span>
      </TabsTrigger>
      <TabsTrigger value="NORM" title="Норм дүрэм" className={PROJECT_TAB_TRIGGER_CLS}>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
          <ListChecks className="size-3.5" /> Норм дүрэм
        </span>
      </TabsTrigger>
      <TabsTrigger value="ROOMS" title="Техникийн өрөө ба нөөц тэжээл" className={PROJECT_TAB_TRIGGER_CLS}>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
          <Wrench className="size-3.5" /> Техникийн өрөө
        </span>
      </TabsTrigger>
      <TabsTrigger value="FIRE" title="Галын аюулгүй байдал" className={PROJECT_TAB_TRIGGER_CLS}>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
          <Flame className="size-3.5" /> Галын аюулгүй байдал
        </span>
      </TabsTrigger>
      <TabsTrigger value="EXTORG" title="Гадны байгууллагууд" className={PROJECT_TAB_TRIGGER_CLS}>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
          <Building2 className="size-3.5" /> Гадны байгууллага
        </span>
      </TabsTrigger>
    </>
  );
}

function ProjectTabContents({ projectId, readOnly }: { projectId: number; readOnly: boolean }) {
  return (
    <>
      <TabsContent value="GENERAL" className="space-y-4">
        <ProjectSectionPanel
          projectId={projectId}
          code="GENERAL"
          title="Үндэслэл, байршил, ангилал"
          badge="ҮА"
          sections={GENERAL_SECTIONS}
          readOnly={readOnly}
        />
      </TabsContent>
      <TabsContent value="NORM" className="space-y-4">
        <NormPanel projectId={projectId} readOnly={readOnly} />
      </TabsContent>
      <TabsContent value="ROOMS" className="space-y-4">
        <ProjectSectionPanel
          projectId={projectId}
          code="ROOMS"
          title="Техникийн өрөө ба нөөц тэжээл"
          badge="ТӨ"
          sections={ROOMS_SECTIONS}
          readOnly={readOnly}
        />
      </TabsContent>
      <TabsContent value="FIRE" className="space-y-4">
        <ProjectSectionPanel
          projectId={projectId}
          code="FIRE"
          title="Галын аюулгүй байдал"
          badge="ГА"
          sections={FIRE_SECTIONS}
          readOnly={readOnly}
        />
      </TabsContent>
      <TabsContent value="EXTORG" className="space-y-4">
        <ExternalAgencyPanel projectId={projectId} readOnly={readOnly} />
      </TabsContent>
    </>
  );
}

export function TeamReportsTab({ projectId, teamShares, readOnly = false }: TeamReportsTabProps) {
  // Build the sub-tab list from this project's team_shares so we don't
  // surface disciplines that aren't actually working on this project.
  // Dedup by team_code in case the project has stale duplicate rows.
  const teams = useMemo(() => {
    const seen = new Set<string>();
    return teamShares
      .filter((s) => {
        const code = (s.team_code ?? '').toUpperCase();
        if (!code || seen.has(code)) return false;
        seen.add(code);
        return true;
      })
      .map((s) => ({
        code: (s.team_code ?? '').toUpperCase(),
        name_mn: s.team_name_mn,
        share: s.share_percent,
      }));
  }, [teamShares]);

  // Project has no team_shares yet → no team sub-tabs, but the project-level
  // "Норм дүрэм" tab is still reachable (it isn't tied to a team).
  if (teams.length === 0) {
    return (
      <Tabs defaultValue="NORM" className="space-y-4">
        <TeamRadixTabsStrip teams={[]} trailing={<ProjectTabTriggers />} />
        <ProjectTabContents projectId={projectId} readOnly={readOnly} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Тайлбар бичиг
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Энэ төсөлд аль нэгэн баг хуваарилагдаагүй байна. Эхлээд төслийн хувиар (Team shares)
              дор багуудаа нэмнэ үү — тэгээд багийн тайлбар бичиг бөглөх боломжтой болно.
            </p>
          </CardContent>
        </Card>
      </Tabs>
    );
  }

  // Pick a default sub-tab: BA if it's in this project, otherwise the
  // first share. Falls back to the very first team alphabetically when
  // BA isn't around so the surface is always non-empty.
  const defaultTeam = teams.find((t) => t.code === 'BA')?.code ?? teams[0]!.code;

  return (
    <ReportsList projectId={projectId}>
      {(filled) => {
        // Project the dedup'd team list into the shared chip shape.
        // We only attach the fill indicator for disciplines whose
        // template is actually implemented — placeholders shouldn't
        // claim a state they can't reach.
        const items: TeamChipItem[] = teams.map((t) => ({
          code: t.code,
          name: t.name_mn,
          indicator:
            IMPLEMENTED_TEAMS[t.code] === true
              ? filled.has(t.code)
                ? 'filled'
                : 'empty'
              : undefined,
        }));
        return (
          <Tabs defaultValue={defaultTeam} className="space-y-4">
            <TeamRadixTabsStrip teams={items} trailing={<ProjectTabTriggers />} />

            {teams.map((t) => (
              <TabsContent key={t.code} value={t.code} className="space-y-4">
                {IMPLEMENTED_TEAMS[t.code] === true ? (
                  <TeamPanel teamCode={t.code} projectId={projectId} readOnly={readOnly} />
                ) : (
                  <PlaceholderPanel teamCode={t.code} teamNameMn={t.name_mn} />
                )}
              </TabsContent>
            ))}

            {/* Project-level (баг бус) — Норм дүрэм, Техникийн өрөө, Галын аюулгүй байдал. */}
            <ProjectTabContents projectId={projectId} readOnly={readOnly} />
          </Tabs>
        );
      }}
    </ReportsList>
  );
}

/** Routes each team's sub-tab to its specific panel. New teams get a
 *  new case here once their template + document are written. */
function TeamPanel({
  teamCode,
  projectId,
  readOnly,
}: {
  teamCode: string;
  projectId: number;
  readOnly: boolean;
}) {
  if (teamCode === 'BA') return <BaPanel projectId={projectId} readOnly={readOnly} />;
  if (teamCode === 'BB') return <BbPanel projectId={projectId} readOnly={readOnly} />;
  if (teamCode === 'HAS') return <HasPanel projectId={projectId} readOnly={readOnly} />;
  if (teamCode === 'TSBU') return <CbuPanel projectId={projectId} readOnly={readOnly} />;
  if (teamCode === 'TSAH') return <TsahPanel projectId={projectId} readOnly={readOnly} />;
  if (teamCode === 'HD') return <HdPanel projectId={projectId} readOnly={readOnly} />;
  if (teamCode === 'AU') return <AuPanel projectId={projectId} readOnly={readOnly} />;
  if (teamCode === 'IZ') return <IzPanel projectId={projectId} readOnly={readOnly} />;
  // Unreachable under IMPLEMENTED_TEAMS but kept as a defensive default
  // so the surface degrades gracefully instead of crashing.
  return <PlaceholderPanel teamCode={teamCode} teamNameMn={null} />;
}

function PlaceholderPanel({
  teamCode,
  teamNameMn,
}: {
  teamCode: string;
  teamNameMn: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Badge variant="outline" className={teamChipClass(teamCode)}>
            {teamCode}
          </Badge>
          {teamNameMn ?? teamCode} — Тайлбар бичиг
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {teamCode} багийн тайлбар бичгийн загвар одоогоор тодорхойлогдоогүй байна. Зураг төслийн
          ажил эхэлсний дараа энд тус багийн асуумж нэмэгдэх болно.
        </p>
      </CardContent>
    </Card>
  );
}

/** Renders children with a Set of team_codes that have been filled in
 *  (i.e. at least one save). Used to badge the sub-tab triggers. */
function ReportsList({
  projectId,
  children,
}: {
  projectId: number;
  children: (filled: Set<string>) => React.ReactNode;
}) {
  const q = useApiQuery<TeamReportsListResponse>(
    ['/projects/team-reports', projectId] as const,
    `/projects/${projectId}/team-reports`,
  );
  const filled = useMemo(() => {
    const s = new Set<string>();
    for (const r of q.data?.reports ?? []) s.add(r.team_code.toUpperCase());
    return s;
  }, [q.data]);
  return <>{children(filled)}</>;
}
