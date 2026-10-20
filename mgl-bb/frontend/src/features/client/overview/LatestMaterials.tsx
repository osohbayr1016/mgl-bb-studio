/**
 * Тоймын доод хэсэг — хамгийн сүүлд гаргасан 3 материал.  «Материал»
 * хэсэгтэй ИЖИЛ query түлхүүр (`/client/projects/:id/materials`) тул нэмэлт
 * хүсэлтгүй, realtime шинэчлэлт хоёуланд зэрэг тусна.
 */
import { ArrowRight, Download, Loader2 } from 'lucide-react';

import { Button } from '@/ui/button';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/time';

import type { ClientDashboardTab } from '../client-dashboard.types';
import type { ClientMaterial } from '../portalApi';
import { Eyebrow, SkeletonBar, SubHeader } from '../components/primitives';
import { useDownloader } from '../hooks/useDownloader';
import { MATERIAL_KIND_LABEL, countLabel } from '../lib/labels';

export function LatestMaterials({
  projectId,
  onNavigate,
}: {
  projectId: number;
  onNavigate: (tab: ClientDashboardTab) => void;
}) {
  const { t } = useLanguage();
  const query = useApiQuery<{ materials: ClientMaterial[] }>(`/client/projects/${projectId}/materials`);
  const latest = (query.data?.materials ?? []).slice(0, 3);
  const { busyKey, download } = useDownloader();

  return (
    <section aria-labelledby="client-latest-title">
      <SubHeader
        title={<span id="client-latest-title">{t('clientRoom.latest.title')}</span>}
        action={
          <Button
            variant="link"
            size="sm"
            onClick={() => onNavigate('materials')}
            className="h-auto pointer-coarse:h-auto gap-1.5 px-0 has-[>svg]:px-0 text-body text-foreground"
          >
            {t('clientRoom.latest.all')}
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Button>
        }
      />
      {query.isLoading ? (
        <div className="grid gap-6 py-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonBar key={i} className="h-40" />
          ))}
        </div>
      ) : latest.length === 0 ? (
        <p className="py-10 text-sm text-muted-foreground">{t('clientRoom.latest.empty')}</p>
      ) : (
        <div className="md:grid md:grid-cols-3">
          {latest.map((m) => {
            const single = m.download_url
              ? { url: m.download_url, name: `${m.title_mn}.pdf` }
              : m.files.length === 1 && m.files[0]
                ? { url: m.files[0].url, name: m.files[0].name }
                : null;
            const kindKey = MATERIAL_KIND_LABEL[m.kind];
            return (
              <article
                key={m.id}
                className="flex flex-col justify-between gap-10 border-b border-foreground/10 py-6 md:border-b-0 md:border-r md:px-6 md:first:pl-0 md:last:border-r-0"
              >
                <div>
                  <Eyebrow>{kindKey ? t(kindKey) : m.kind}</Eyebrow>
                  <h4 className="mt-4 font-display text-xl font-light leading-snug tracking-[-0.015em] text-foreground md:text-2xl">
                    {m.title_mn}
                  </h4>
                  <p className="mt-2 font-mono text-micro tabular-nums text-muted-foreground">
                    {formatDate(m.published_at)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-micro text-muted-foreground">
                    {m.files.length > 0 ? countLabel(t, 'clientRoom.files', m.files.length) : ''}
                  </span>
                  {single ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyKey === single.url}
                      onClick={() => void download(single.url, single.name)}
                      className="rounded-none border-foreground/25 bg-transparent"
                    >
                      {busyKey === single.url ? (
                        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                      )}
                      {t('clientRoom.materials.download')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onNavigate('materials')}
                      className="rounded-none border-foreground/25 bg-transparent"
                    >
                      {t('clientRoom.latest.open')}
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
