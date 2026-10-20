import { Link } from 'react-router-dom';
import { FolderKanban, HardHat, Users, Wrench } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName, formatProjectShortName } from '@/shared/lib/formatting';
import type { ProductivityAsr, ProductivityMember, ProductivityProject } from './types';

/**
 * Хугацаанд багийн гишүүд аль төсөл дээр ажилласан — ирцийн сонголт, таскийн
 * тайлан, засварын цаг.  Засварын (дотоод ажлын) төсөл нь Projects хуудасгүй
 * тул холбоосгүй, 🔧 тэмдэгтэй (Багууд хуудастай ижил).
 */
export function ProjectsCard({
  projects,
  members,
}: {
  projects: ProductivityProject[];
  members: ProductivityMember[];
}) {
  const { t } = useLanguage();
  const nameOf = new Map(members.map((m) => [m.user_id, formatDisplayName(m.full_name)]));
  const max = Math.max(1, ...projects.map((p) => p.people));
  return (
    <section id="sec-team-projects-period" className="scroll-mt-24 rounded-xl border border-border/60 bg-card">
      <header className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
        <FolderKanban className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{t('teamProductivity.projectsTitle')}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{projects.length}</span>
      </header>
      {projects.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t('teamProductivity.projectsEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border/40" data-testid="tp-projects">
          {projects.map((p) => {
            const label = formatProjectShortName(p.name);
            const who = p.member_ids.map((id) => nameOf.get(id) ?? `#${id}`).join(', ');
            return (
              <li key={p.project_id} className="px-4 py-2" title={`${p.name}\n${who}`}>
                <div className="flex items-center gap-2">
                  {p.kind === 'repair' ? (
                    <span className="flex min-w-0 flex-1 items-center gap-1 text-sm">
                      <Wrench className="h-3.5 w-3.5 shrink-0 text-warning" aria-label={t('teams.repairTag')} />
                      <span className="truncate">{label}</span>
                    </span>
                  ) : (
                    <Link
                      to={`/app/projects/${p.project_id}`}
                      className="min-w-0 flex-1 truncate text-sm hover:text-primary hover:underline"
                    >
                      {label}
                    </Link>
                  )}
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {p.people}
                    <span className="text-label font-normal normal-case tracking-normal">· {t('teamProductivity.personDays', { n: p.person_days })}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted" aria-hidden>
                  <div
                    className={cn('h-full rounded-full', p.kind === 'repair' ? 'bg-warning/60' : 'bg-primary/60')}
                    style={{ width: `${(p.people / max) * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Хугацааны зохиогчийн хяналтын тайлангууд — багийн гишүүн бичсэн, эсвэл «Хяналтаар явсан»-д энэ баг. */
export function AsrCard({ asr }: { asr: ProductivityAsr[] }) {
  const { t } = useLanguage();
  return (
    <section id="sec-team-asr-period" className="scroll-mt-24 rounded-xl border border-border/60 bg-card">
      <header className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
        <HardHat className="h-4 w-4 text-warning" />
        <h3 className="text-sm font-semibold">{t('teamProductivity.asrTitle')}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{asr.length}</span>
      </header>
      {asr.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t('teamProductivity.asrEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border/40" data-testid="tp-asr">
          {asr.map((r) => (
            <li key={r.id} className="px-4 py-2">
              <Link
                to={`/app/asr/${r.id}`}
                className="flex items-center gap-2 text-sm hover:text-primary"
                title={r.project_name}
              >
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.doc_no ?? `#${r.id}`}</span>
                <span className="min-w-0 flex-1 truncate">{formatProjectShortName(r.project_name)}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{r.report_date}</span>
              </Link>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-label font-normal normal-case tracking-normal text-muted-foreground">
                <span>{formatDisplayName(r.author_name)}</span>
                {!r.by_member && <span className="text-info">{t('teamProductivity.asrOtherAuthor')}</span>}
                {r.team_included && <span>· {t('teamProductivity.asrTeamIncluded')}</span>}
                <span>· {r.status === 'approved' ? t('teamProductivity.asrApproved') : t('teamProductivity.asrSubmitted')}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
