/**
 * 03 — Материал.  Бидний захиалагчид ГАРГАЖ ӨГСӨН бүхэн нэг дор:
 *
 *   1. Гүйцэтгэлийн тайлан — зөвхөн `issued` (ноорог хэзээ ч гарахгүй).
 *      Харах (хэвлэх хуудас) / PDF / Word.
 *   2. Нийтэлсэн материал — `client_publications`-д амьд мөр (backend
 *      `routes/clientPortal.ts` шүүнэ, UI давхардуулахгүй).  Тайлан хэсэгт
 *      аль хэдийн байгаа `perf_report` нийтлэлийг энд ДАВХАРДУУЛАХГҮЙ.
 *
 * Хуучин «Тайлан» таб энд нэгдсэн (`?tab=report` → энэ хэсэг).
 */
import { useState } from 'react';
import { ChevronDown, Download, ExternalLink, FileText, Loader2 } from 'lucide-react';

import { Button } from '@/ui/button';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import type { PerformanceReportListResponse } from '@/features/performance-reports/types/performanceReport';
import { formatPeriodRange } from '@/features/performance-reports/lib/formatPeriod';

import type { ClientMaterial } from '../portalApi';
import {
  EmptyState,
  ErrorState,
  LiveIndicator,
  SectionHeader,
  SkeletonBar,
  SubHeader,
  Tag,
} from '../components/primitives';
import { useDownloader } from '../hooks/useDownloader';
import { formatBytes } from '../lib/clientFormat';
import { MATERIAL_KIND_LABEL, countLabel } from '../lib/labels';

export function MaterialsTab({ projectId, live }: { projectId: number; live: boolean }) {
  const { t } = useLanguage();

  const materialsQuery = useApiQuery<{ materials: ClientMaterial[] }>(
    `/client/projects/${projectId}/materials`,
  );
  const reportsQuery = useApiQuery<PerformanceReportListResponse>(
    ['/projects', projectId, 'performance-reports'] as const,
    `/projects/${projectId}/performance-reports`,
  );

  const issued = (reportsQuery.data?.reports ?? [])
    .filter((r) => r.status === 'issued')
    .sort((a, b) => b.report_no - a.report_no);
  const issuedIds = new Set(issued.map((r) => r.id));
  const materials = (materialsQuery.data?.materials ?? []).filter(
    (m) => !(m.kind === 'perf_report' && issuedIds.has(m.ref_id)),
  );

  return (
    <div className="flex flex-col gap-16 pt-10 md:gap-20 md:pt-14">
      <SectionHeader
        index="03"
        eyebrow={t('clientRoom.nav.materials')}
        title={t('clientRoom.materials.title')}
        description={t('clientRoom.materials.description')}
        aside={<LiveIndicator live={live} />}
      />

      <ReportsSection
        projectId={projectId}
        reports={issued}
        loading={reportsQuery.isLoading}
        failed={reportsQuery.isError}
      />

      <PublicationsSection
        materials={materials}
        loading={materialsQuery.isLoading}
        error={materialsQuery.error?.message ?? null}
        retrying={materialsQuery.isFetching}
        onRetry={() => void materialsQuery.refetch()}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Гүйцэтгэлийн тайлан                                                */
/* ------------------------------------------------------------------ */

function ReportsSection({
  projectId,
  reports,
  loading,
  failed,
}: {
  projectId: number;
  reports: PerformanceReportListResponse['reports'];
  loading: boolean;
  failed: boolean;
}) {
  const { t } = useLanguage();
  const { busyKey, download } = useDownloader();

  // Тайлан татагдаж чадаагүй (эрхгүй г.м.) бол хэсгийг чимээгүй нуухгүй —
  // гэхдээ бүтэн алдааны хайрцаг ч биш, нэг мөр.
  return (
    <section aria-labelledby="client-reports-title">
      <SubHeader
        title={<span id="client-reports-title">{t('clientRoom.materials.reportsTitle')}</span>}
        meta={reports.length > 0 ? String(reports.length).padStart(2, '0') : undefined}
      />
      {loading ? (
        <div className="flex flex-col gap-3 py-6">
          <SkeletonBar className="h-14" />
          <SkeletonBar className="h-14" />
        </div>
      ) : failed ? (
        <p className="py-8 text-sm text-muted-foreground">{t('clientRoom.materials.reportsFailed')}</p>
      ) : reports.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">{t('clientRoom.materials.reportsEmpty')}</p>
      ) : (
        <ul className="divide-y divide-foreground/10 border-b border-foreground/10">
          {reports.map((r) => {
            const period = formatPeriodRange(r.period_start, r.period_end, ' — ');
            const no = String(r.report_no).padStart(2, '0');
            const pdfUrl = `/projects/${projectId}/performance-reports/${r.id}/pdf`;
            const docxUrl = `/projects/${projectId}/performance-reports/${r.id}/docx`;
            return (
              <li
                key={r.id}
                className="grid gap-4 py-6 md:grid-cols-12 md:items-center md:gap-8"
                data-testid="client-report-row"
              >
                <div className="flex items-baseline gap-4 md:col-span-3">
                  <span className="font-display text-2xl font-light text-muted-foreground">№</span>
                  <span className="font-display text-5xl font-light leading-none tabular-nums tracking-[-0.04em] text-foreground">
                    {no}
                  </span>
                </div>
                <div className="min-w-0 md:col-span-5">
                  {period ? <p className="text-base text-foreground">{period}</p> : null}
                  {r.issued_at ? (
                    <p className="mt-1 font-mono text-micro tabular-nums text-muted-foreground">
                      {t('clientRoom.materials.issuedOn', { date: formatDate(r.issued_at) })}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-4 md:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-none border-foreground/25 bg-transparent"
                    onClick={() =>
                      window.open(
                        `/reports/project/${projectId}/performance-report/${r.id}/print`,
                        '_blank',
                        'noopener',
                      )
                    }
                  >
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t('clientRoom.materials.view')}
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-none bg-foreground text-background hover:bg-foreground/85"
                    disabled={busyKey !== null}
                    onClick={() => void download(pdfUrl, `GT_${no}.pdf`)}
                  >
                    {busyKey === pdfUrl ? (
                      <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-none border-foreground/25 bg-transparent"
                    disabled={busyKey !== null}
                    onClick={() => void download(docxUrl, `GT_${no}.docx`)}
                  >
                    {busyKey === docxUrl ? (
                      <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    Word
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Нийтэлсэн материал                                                 */
/* ------------------------------------------------------------------ */

function PublicationsSection({
  materials,
  loading,
  error,
  retrying,
  onRetry,
}: {
  materials: ClientMaterial[];
  loading: boolean;
  error: string | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useLanguage();
  const [kind, setKind] = useState<string>('all');
  const kinds = Array.from(new Set(materials.map((m) => m.kind)));
  // Идэвхтэй шүүлтүүрийн төрөл алга болсон бол (нийтлэл цуцлагдсан) — бүгд.
  const activeKind = kind === 'all' || kinds.includes(kind) ? kind : 'all';
  const shown = activeKind === 'all' ? materials : materials.filter((m) => m.kind === activeKind);
  const { busyKey, download } = useDownloader();

  return (
    <section aria-labelledby="client-publications-title">
      <SubHeader
        title={<span id="client-publications-title">{t('clientRoom.materials.publishedTitle')}</span>}
        meta={materials.length > 0 ? String(materials.length).padStart(2, '0') : undefined}
      />

      {kinds.length > 1 ? (
        <div
          role="group"
          aria-label={t('clientRoom.materials.filterLabel')}
          className="mt-5 flex flex-wrap gap-2"
        >
          {['all', ...kinds].map((k) => {
            const key = k === 'all' ? 'clientRoom.kind.all' : MATERIAL_KIND_LABEL[k];
            const active = activeKind === k;
            return (
              <Button
                key={k}
                variant="outline"
                size="xs"
                aria-pressed={active}
                onClick={() => setKind(k)}
                className={cn(
                  'h-8 rounded-none px-3 font-mono text-label uppercase tracking-[0.12em]',
                  active
                    ? 'border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background'
                    : 'border-foreground/20 bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground',
                )}
              >
                {key ? t(key) : k}
              </Button>
            );
          })}
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-3 py-6">
          <SkeletonBar className="h-24" />
          <SkeletonBar className="h-24" />
        </div>
      ) : error ? (
        <ErrorState className="mt-6" message={error} onRetry={onRetry} retrying={retrying} />
      ) : materials.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={t('clientRoom.materials.empty')}
          body={t('clientRoom.materials.emptyBody')}
        />
      ) : (
        <ul className="mt-2 divide-y divide-foreground/10 border-b border-foreground/10" data-testid="client-materials">
          {shown.map((m) => (
            <MaterialRow key={m.id} material={m} busyKey={busyKey} onDownload={download} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MaterialRow({
  material: m,
  busyKey,
  onDownload,
}: {
  material: ClientMaterial;
  busyKey: string | null;
  onDownload: (url: string, name: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const kindKey = MATERIAL_KIND_LABEL[m.kind];
  const totalBytes = m.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  const panelId = `material-${m.id}-files`;

  return (
    <li className="grid gap-4 py-7 md:grid-cols-12 md:gap-8">
      <div className="font-mono text-micro tabular-nums text-muted-foreground md:col-span-2 md:pt-1">
        {formatDate(m.published_at)}
      </div>
      <div className="min-w-0 md:col-span-7">
        <Tag>{kindKey ? t(kindKey) : m.kind}</Tag>
        <h4 className="mt-3 font-display text-2xl font-light leading-snug tracking-[-0.02em] text-foreground">
          {m.title_mn}
        </h4>
        {m.note ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{m.note}</p> : null}

        {m.files.length > 0 ? (
          <div className="mt-4">
            <Button
              variant="link"
              size="sm"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={panelId}
              className="h-auto pointer-coarse:h-auto gap-1.5 px-0 has-[>svg]:px-0 text-body text-foreground"
            >
              <ChevronDown
                className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
                strokeWidth={1.5}
              />
              {open
                ? t('clientRoom.materials.hideFiles')
                : countLabel(t, 'clientRoom.materials.showFiles', m.files.length)}
              {totalBytes > 0 ? (
                <span className="font-mono text-micro text-muted-foreground">· {formatBytes(totalBytes)}</span>
              ) : null}
            </Button>
            {open ? (
              <ul id={panelId} className="mt-3 divide-y divide-foreground/10 border-y border-foreground/10">
                {m.files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                    <span className="min-w-0 flex-1 truncate text-body text-foreground" title={f.name}>
                      {f.name}
                    </span>
                    <span className="shrink-0 font-mono text-micro tabular-nums text-muted-foreground">
                      {formatBytes(f.size)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 rounded-none"
                      disabled={busyKey === f.url}
                      aria-label={`${t('clientRoom.materials.download')} — ${f.name}`}
                      onClick={() => void onDownload(f.url, f.name)}
                    >
                      {busyKey === f.url ? (
                        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="md:col-span-3 md:text-right">
        {m.download_url ? (
          <Button
            size="sm"
            className="rounded-none bg-foreground text-background hover:bg-foreground/85"
            disabled={busyKey === m.download_url}
            onClick={() => void onDownload(m.download_url!, `${m.title_mn}.pdf`)}
          >
            {busyKey === m.download_url ? (
              <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t('clientRoom.materials.download')}
          </Button>
        ) : m.files.length === 1 && m.files[0] ? (
          <Button
            size="sm"
            className="rounded-none bg-foreground text-background hover:bg-foreground/85"
            disabled={busyKey === m.files[0].url}
            onClick={() => void onDownload(m.files[0]!.url, m.files[0]!.name)}
          >
            {busyKey === m.files[0].url ? (
              <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t('clientRoom.materials.download')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export default MaterialsTab;
