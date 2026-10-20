import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/shared/lib/utils';
import { teamHex } from '@/shared/lib/team-colors';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { DonutChart, type DonutSlice } from './DonutChart';
import { TeamPanel } from './TeamPanel';
import { ProjectPanel } from './ProjectPanel';
import type { AllocationModel } from '../lib/allocation';
import {
  buildPrimaryProjectMap,
  buildProjectPalette,
  isSpanAverage,
  isWorkforceTeam,
  projectHref,
  shortProjectLabel,
  splitCompanyByPrimary,
  summarizeWorkforce,
} from '../lib/allocation';
import { IDLE_COLOR } from '../lib/donut';
import { OTHERS_COLOR, PROJECT_PALETTE } from '../lib/projectColors';
import { projectRoster, teamRoster } from '../lib/roster';
import { useRosterContext } from '../lib/useRoster';

/**
 * «Тойм» — хуудасны ӨГӨГДМӨЛ таб.
 *
 * 2026-09-17 (эзний хүсэлт): ХОЁР донат — хүн хүч БАГААР · хүн хүч
 * ТӨСЛӨӨР — зүүн талд зэрэгцээ; баруун талд НЭГ суурин самбар, аль
 * донатын зүсэм дээр дарснаас хамаарч ээлжлэн бөглөгдөнө:
 *
 *   • Багаар: зүсэм = баг (бүх идэвхтэй гишүүн).  Hover → тэр багийн
 *     гишүүдийн нэрс (`teamRoster`).  ДАРВАЛ → багийн профайл
 *     (`/app/teams/:id`).
 *   • Төслөөр: зүсэм = төсөл (хүн бүр ЯГ НЭГ удаа, үндсэн төслөөрөө),
 *     сүүлд нь саарал «төсөлгүй».  Hover → багаар бүлэглэсэн нэрс
 *     (`projectRoster`).  ДАРВАЛ → `ProjectPanel`: энэ төсөл дээр АЛЬ
 *     БАГААС ХЭДЭН ХҮН — багийн донат + тууз + нэрс.
 *
 * («Төслөөр» донат 2026-09-16-нд нэг удаа хасагдаж, `ProjectTeamsDialog`
 * цонхтой байсан; одоо буцаж ирсэн боловч цонх БИШ — `TeamPanel`-тай ижил
 * баруун талын самбар, эзний «матриц шиг баруун талд жижиг хэсэг» дүрэм.)
 *
 * Менежментийн баг (`MGMT`) хоёр донатад ч ОРОХГҮЙ; хоёр донатын голд
 * НИЙТ АЖИЛТАН (хүн хүч, менежментгүй); зүсэм дээрх жижиг тоо ХЭРЭГГҮЙ.
 * Нэг зүйл л сонгогдоно — төсөл дарвал багийн сонголт арилна, эсрэгээр ч.
 *
 * Бүх тоо `buildAllocationModel`-оос — Багаар табтай нэг эх сурвалж тул
 * зөрөхгүй.  Хэмжүүр нь үргэлж ИРЦ (2026-09-24-нөөс сэлгүүргүй).
 */
export function OverviewTab({ model }: { model: AllocationModel }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [openProjectId, setOpenProjectId] = useState<number | null>(null);

  const colorOfProject = useMemo(
    () => buildProjectPalette(model, PROJECT_PALETTE, OTHERS_COLOR),
    [model],
  );

  const workforceTeams = useMemo(
    () => model.byTeam.filter((r) => isWorkforceTeam(r.entity.code)),
    [model.byTeam],
  );

  // Менежментийн гишүүдийн id — төслийн донатаас хасахад хэрэгтэй
  // (`buildPrimaryProjectMap` компанийн бүх хүнийг хамардаг).
  const managementIds = useMemo(() => {
    const ids = new Set<number>();
    for (const row of model.byTeam) {
      if (isWorkforceTeam(row.entity.code)) continue;
      for (const p of row.entity.idle_members) ids.add(p.user_id);
      for (const cell of row.cells) for (const m of cell.members) ids.add(m.user_id);
    }
    return ids;
  }, [model.byTeam]);

  const wf = useMemo(() => summarizeWorkforce(model), [model]);

  // Үндсэн төсөл — нэрсийн мөр бүрийн «хамгийн том төсөл» + эрэмбэ.
  const primaryAll = useMemo(() => buildPrimaryProjectMap(model), [model]);
  const primary = useMemo(() => {
    const out = new Map<number, number>();
    for (const [userId, projectId] of primaryAll) {
      if (!managementIds.has(userId)) out.set(userId, projectId);
    }
    return out;
  }, [primaryAll, managementIds]);
  const roster = useRosterContext(model, primaryAll, colorOfProject);

  // Багийн донат = БҮХ идэвхтэй гишүүн (ажилтай эсэхээс үл хамааран).
  // Нэрс: хүн бүр үндсэн төслөөрөө нэг удаа + төсөлгүй.
  // Донат + самбарын заавар хоёулаа ГИШҮҮНТЭЙ багуудыг л харуулна.
  const staffedTeams = useMemo(
    () => workforceTeams.filter((r) => r.entity.member_count > 0),
    [workforceTeams],
  );
  const teamSlices: DonutSlice[] = useMemo(
    () =>
      staffedTeams.map((r) => ({
        key: r.entity.id,
        code: r.entity.code,
        label: pickLocalized(lang, r.entity.name_mn, r.entity.name_en),
        value: r.entity.member_count,
        color: teamHex(r.entity.code),
        roster: teamRoster(roster, r),
        href: `/app/teams/${r.entity.id}`,
      })),
    [staffedTeams, lang, roster],
  );

  // Төслийн донат = хүн бүр ЯГ НЭГ удаа, үндсэн төслөөрөө; төсөлгүй нь
  // саарал.  Зүсмүүдийн нийлбэр = хүн хүчний нийт ажилтан (багийн донаттай
  // ижил гол).  Hover → багаар бүлэглэсэн нэрс (энэ төсөл дээрх БҮХ хүн —
  // самбар «нэрс N» гэж зөрүүг ил хэлнэ); дарвал → баруун талын самбар.
  const staffedProjects = useMemo(() => {
    // Мужаар: төсөл бүрийн өдрийн дундаж хүн (`lib/allocation.ts`).
    const counts = splitCompanyByPrimary(primary, model);
    return model.byProject
      .filter((r) => (counts.get(r.entity.id) ?? 0) > 0)
      .map((r) => ({
        row: r,
        value: counts.get(r.entity.id) ?? 0,
        color: colorOfProject(r.entity.id),
      }))
      .sort((a, b) => b.value - a.value || a.row.entity.name.localeCompare(b.row.entity.name));
  }, [model, primary, colorOfProject]);
  const projectSlices: DonutSlice[] = useMemo(() => {
    const spanAvg = isSpanAverage(model);
    const slices: DonutSlice[] = staffedProjects.map((p) => ({
      key: p.row.entity.id,
      label: shortProjectLabel(p.row.entity.name),
      value: p.value,
      color: p.color,
      roster: projectRoster(roster, p.row),
      href: projectHref(p.row.entity),
      hint: `${
        spanAvg
          ? t('teams.avgPersonCount', { count: p.row.people })
          : `${t('teams.personCount', { count: p.row.people })} ${t('teams.primaryHintTotal')}`
      } · ${t('teams.teamCount', { count: p.row.partners })} · ${t('teams.projectClickHint')}`,
    }));
    // Дундаж горимд «төсөлгүй» = ажилтан − өдрийн дундаж идэвхтэй (бутархай).
    const idle = spanAvg
      ? Math.round(wf.idle * 10) / 10
      : wf.headcount - primary.size;
    if (idle > 0) {
      slices.push({
        key: '__idle',
        label: t('teams.legendIdle'),
        value: idle,
        color: IDLE_COLOR,
        muted: true,
        hint: wf.idleByTeam.map((x) => `${x.code} ${x.idle}`).join(' · '),
      });
    }
    return slices;
  }, [staffedProjects, roster, primary.size, t, wf, model]);

  const openProjectRow = useMemo(
    () =>
      openProjectId == null
        ? null
        : (model.byProject.find((r) => r.entity.id === openProjectId) ?? null),
    [model.byProject, openProjectId],
  );

  return (
    <div
      id="sec-teams-overview"
      /* Нарийн дэлгэц: `auto-rows-max` — тогтмол өндөртэй grid-д auto мөр
         нь `min-h-0` картыг агуулгаас доош хумьдаг (хэмжсэн: донат хагас
         тасарч байв); max-content мөрөөр карт бүтэн, хуудас гүйлгэгдэнэ.
         Өргөн дэлгэц: зүүн карт, баруун 330px самбар. */
      className="grid h-full min-h-0 w-full scroll-mt-24 gap-3 overflow-y-auto p-3 max-lg:auto-rows-max sm:p-4 lg:grid-cols-[minmax(0,1fr)_330px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden"
    >
      {/* Зүүн тал: хоёр донат зэрэгцээ (нарийн дэлгэц дээр дор дороо). */}
      <div className="grid min-h-0 gap-3 max-lg:auto-rows-max md:grid-cols-2 lg:h-full lg:grid-rows-[minmax(0,1fr)]">
        <ChartCard
          title={t('teams.overviewByTeam')}
          subtitle={`${t('teams.overviewByTeamDesc')} · ${t('teams.rosterHover')} · ${t('teams.teamClickHint')}`}
          className="min-h-0 lg:h-full"
        >
          <DonutChart
            slices={teamSlices}
            size={200}
            legend="bottom"
            center={{ value: wf.headcount, label: t('teams.detailMembers') }}
            legendMax={20}
            emptyLabel={t('teams.emptyMatrix')}
            className="mx-auto max-w-md pt-2"
            onSelect={(s) => {
              if (typeof s.key === 'number') navigate(`/app/teams/${s.key}`);
            }}
          />
        </ChartCard>

        <ChartCard
          title={t('teams.overviewByProject')}
          subtitle={`${t('teams.metricActive')} · ${
            isSpanAverage(model)
              ? t('teams.spanAvgNote', { days: model.activeDays })
              : t('teams.primaryRule')
          } · ${t('teams.projectClickHint')}`}
          className="min-h-0 lg:h-full"
        >
          <DonutChart
            slices={projectSlices}
            size={200}
            legend="bottom"
            center={{ value: wf.headcount, label: t('teams.detailMembers') }}
            legendMax={30}
            emptyLabel={t('teams.emptyMatrix')}
            className="mx-auto max-w-md pt-2"
            onSelect={(s) => {
              if (typeof s.key === 'number') setOpenProjectId(s.key);
            }}
          />
        </ChartCard>
      </div>

      {/* Нарийн дэлгэц дээр самбар доошоо буудаг.
          Төсөл сонгогдсон бол төслийн самбар, эс бөгөөс багийн (заавартай). */}
      <div className="min-h-0 max-lg:h-[38dvh]">
        {openProjectId != null ? (
          <ProjectPanel
            row={openProjectRow}
            projects={staffedProjects}
            model={model}
            roster={roster}
            onSelect={setOpenProjectId}
          />
        ) : (
          <TeamPanel
            row={null}
            teams={staffedTeams}
            model={model}
            roster={roster}
            onSelect={() => {}}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ChartCard({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn('flex min-h-0 flex-col rounded-xl border border-border bg-card p-4', className)}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
    </section>
  );
}
