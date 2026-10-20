import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';
import { PROJECT_CATEGORIES, type ProjectCategory } from '@/shared/lib/project-categories';
import { BA_SECTIONS } from '@/features/projects/team-reports/ba/template';
import { BB_SECTIONS } from '@/features/projects/team-reports/bb/template';
import { HAS_SECTIONS } from '@/features/projects/team-reports/has/template';
import { CBU_SECTIONS } from '@/features/projects/team-reports/cbu/template';
import { TSAH_SECTIONS } from '@/features/projects/team-reports/tsah/template';
import { HD_SECTIONS } from '@/features/projects/team-reports/hd/template';
import { AU_SECTIONS } from '@/features/projects/team-reports/au/template';
import type { SectionDef } from '@/features/projects/team-reports/types';
import { TeamFormTemplateEditor } from '@/features/projects/team-reports/TeamFormTemplateEditor';
import type { ProjectWithProgress } from '@/shared/types';
import { DesktopOnlyNotice } from '@/shared/components/DesktopOnlyNotice';

/* =============================================================
 * Багийн загвар admin page — full-screen sidebar + editor.
 * The editor body lives in a reusable component so the same
 * editing UX shows up inside each team's report panel via a
 * dialog (see TeamReportShell).
 * ============================================================= */

const MANAGER_TIER = new Set(['admin', 'senior']);

const VISIBLE_CATEGORIES: ProjectCategory[] = ['AZ', 'ET', 'EZ', 'IZ'];

const TEAMS: Array<{
  code: string;
  labelKey: string;
  sections: readonly SectionDef<Record<string, unknown>>[];
}> = [
  {
    code: 'BA',
    labelKey: 'teamFormTemplatesPage.teamBA',
    sections: BA_SECTIONS as readonly SectionDef<Record<string, unknown>>[],
  },
  {
    code: 'BB',
    labelKey: 'teamFormTemplatesPage.teamBB',
    sections: BB_SECTIONS as readonly SectionDef<Record<string, unknown>>[],
  },
  {
    code: 'HAS',
    labelKey: 'teamFormTemplatesPage.teamHAS',
    sections: HAS_SECTIONS as readonly SectionDef<Record<string, unknown>>[],
  },
  {
    code: 'TSBU',
    labelKey: 'teamFormTemplatesPage.teamTSBU',
    sections: CBU_SECTIONS as readonly SectionDef<Record<string, unknown>>[],
  },
  {
    code: 'TSAH',
    labelKey: 'teamFormTemplatesPage.teamTSAH',
    sections: TSAH_SECTIONS as readonly SectionDef<Record<string, unknown>>[],
  },
  {
    code: 'HD',
    labelKey: 'teamFormTemplatesPage.teamHD',
    sections: HD_SECTIONS as readonly SectionDef<Record<string, unknown>>[],
  },
  {
    code: 'AU',
    labelKey: 'teamFormTemplatesPage.teamAU',
    sections: AU_SECTIONS as readonly SectionDef<Record<string, unknown>>[],
  },
];

export default function TeamFormTemplatesPage() {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const canManage = !!user && MANAGER_TIER.has(user.role);

  const [searchParams] = useSearchParams();
  const deepLinkedId = (() => {
    const raw = searchParams.get('project');
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  })();

  const [activeCategories, setActiveCategories] = useState<Set<ProjectCategory>>(
    new Set(VISIBLE_CATEGORIES),
  );
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(deepLinkedId);
  const [activeTeamCode, setActiveTeamCode] = useState<string>(TEAMS[0]?.code ?? 'BA');

  const projectsQuery = useApiQuery<{ projects: ProjectWithProgress[] }>(
    ['/projects', 'tfp-list'] as const,
    '/projects',
  );
  const projects = projectsQuery.data?.projects ?? [];

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (!p.category) return false;
      return activeCategories.has(p.category as ProjectCategory);
    });
  }, [projects, activeCategories]);

  const uncategorizedCount = projects.filter((p) => !p.category).length;
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  useEffect(() => {
    if (selectedProjectId === null) return;
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project || !project.category) return;
    const cat = project.category as ProjectCategory;
    if (!VISIBLE_CATEGORIES.includes(cat)) return;
    setActiveCategories((prev) => (prev.has(cat) ? prev : new Set([...prev, cat])));
  }, [selectedProjectId, projects]);

  useEffect(() => {
    if (filteredProjects.length === 0) {
      setSelectedProjectId(null);
      return;
    }
    if (selectedProjectId === null || !filteredProjects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(filteredProjects[0]?.id ?? null);
    }
  }, [filteredProjects, selectedProjectId]);

  const activeTeam = TEAMS.find((t) => t.code === activeTeamCode) ?? TEAMS[0]!;

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col">
      <DesktopOnlyNotice feature={t('teamFormTemplatesPage.feature')} />
      <header className="bg-card border-b px-4 py-3 flex items-center gap-3">
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> {t('teamFormTemplatesPage.home')}
        </Link>
        <h1 className="text-base font-semibold">{t('teamFormTemplatesPage.title')}</h1>
      </header>

      <div className="bg-card/60 border-b px-4 py-2 flex items-center gap-1 overflow-x-auto">
        {VISIBLE_CATEGORIES.map((code) => {
          const def = PROJECT_CATEGORIES[code];
          const on = activeCategories.has(code);
          return (
            <button
              key={code}
              type="button"
              onClick={() =>
                setActiveCategories((prev) => {
                  const next = new Set(prev);
                  if (next.has(code)) next.delete(code);
                  else next.add(code);
                  return next;
                })
              }
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium border whitespace-nowrap',
                on
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'bg-card text-muted-foreground border-transparent hover:bg-muted/60 hover:text-foreground',
              )}
              title={pickLocalized(lang, def.name_mn, def.name_en)}
            >
              {code} · {pickLocalized(lang, def.name_mn, def.name_en)}
            </button>
          );
        })}
        {uncategorizedCount > 0 && (
          <span className="ml-auto text-micro text-muted-foreground italic">
            {t('teamFormTemplatesPage.uncategorizedCount', { count: uncategorizedCount })}
          </span>
        )}
      </div>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-72 border-r bg-card/60 overflow-y-auto">
          {projectsQuery.isLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-4 justify-center">
              <Loader2 className="w-3 h-3 animate-spin" /> {t('common.loading')}
            </div>
          ) : filteredProjects.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-3 py-4">
              {t('teamFormTemplatesPage.noProjectsInCategory')}
            </p>
          ) : (
            <ul className="p-2 space-y-1">
              {filteredProjects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedProjectId(p.id)}
                    className={cn(
                      'w-full text-left px-2.5 py-2 rounded-md text-sm transition-colors',
                      selectedProjectId === p.id
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'hover:bg-muted/60 border border-transparent',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="flex-1 truncate font-medium">{p.name}</span>
                      {p.category && (
                        <Badge variant="outline" className="text-micro py-0 px-1.5 flex-shrink-0">
                          {p.category}
                        </Badge>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="flex-1 overflow-y-auto">
          {selectedProject === null ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              {t('teamFormTemplatesPage.selectProjectHint')}
            </div>
          ) : (
            <div>
              <div className="bg-card/40 border-b px-4 py-2 flex items-center gap-1 overflow-x-auto">
                {TEAMS.map((team) => (
                  <button
                    key={team.code}
                    type="button"
                    onClick={() => setActiveTeamCode(team.code)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium border whitespace-nowrap',
                      activeTeamCode === team.code
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'bg-card text-muted-foreground border-transparent hover:bg-muted/60 hover:text-foreground',
                    )}
                    title={t(team.labelKey)}
                  >
                    {team.code}
                  </button>
                ))}
              </div>
              <div className="p-4 max-w-4xl mx-auto">
                <TeamFormTemplateEditor
                  key={`${selectedProject.id}-${activeTeam.code}`}
                  projectId={selectedProject.id}
                  teamCode={activeTeam.code}
                  sections={activeTeam.sections}
                  canManage={canManage}
                  heading={
                    <>
                      <h2 className="text-lg font-semibold">
                        {selectedProject.name} · {activeTeam.code} {t(activeTeam.labelKey)}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {t('teamFormTemplatesPage.editorHint')}
                      </p>
                    </>
                  }
                />
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
