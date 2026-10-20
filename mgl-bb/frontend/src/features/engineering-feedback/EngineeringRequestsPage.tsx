/**
 * «Програмын хүсэлтүүд» — Revit add-in ба ERP-ээс ирсэн алдаа / сайжруулалт / асуултын inbox.
 *
 * ⚠️ ЗӨВХӨН баталгаажсан Software Engineer reviewer (Өсөхбаяр): хуудас `useEfCapabilities().canReview`-ээр
 * хаагдана (ачаалж байхад агуулга харуулахгүй), сервер бүх `/inbox*` замыг эрхгүй хүнд 404-өөр хаадаг —
 * admin эрх ганцаараа энэ хуудсыг НЭЭХГҮЙ.  Шүүлтүүр нь хуудасны төлөв; сонгосон хүсэлт `?id=` (мэдэгдлийн
 * холбоос, PageTransition-ийг давна).  Үндсэн урсгал: хүсэлт → оношилгоо → засвар → хувилбар → дахин шалгалт.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Filter, Inbox, LifeBuoy, Loader2, Paperclip, Search, ShieldOff } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Skeleton } from '@/ui/skeleton';
import { Switch } from '@/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { cn } from '@/shared/lib/utils';
import { formatDateTime } from '@/shared/lib/time';
import { downloadInboxCsv, efKeys, fetchInbox, fetchInboxCount, type EfInboxFilter, type EfInboxItem } from './api';
import { EF_PRIORITIES, EF_SOURCES, EF_STATUS_ORDER, EF_TYPES, PRIORITY_TONE, priorityKey, sourceKey, STATUS_TONE, statusKey, typeKey } from './labels';
import { InboxDetail } from './inbox/InboxDetail';
import { useEfCapabilities } from './useEfCapabilities';
import { errorText } from './upload';

const ALL = '__all';
const PAGE_SIZE = 25;
const REVIT_YEARS = ['2024', '2025', '2026', '2027'];

export default function EngineeringRequestsPage() {
  const { t } = useLanguage();
  const caps = useEfCapabilities();

  if (caps.loading) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (!caps.canReview) {
    // Эрхгүй хүнд inbox байгаа эсэхийг ч илчлэхгүй — «олдсонгүй» хэлбэр (сервер ч 404).
    return (
      <PageContainer>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground" data-testid="ef-inbox-denied">
            <ShieldOff className="h-8 w-8" aria-hidden />
            {t('engFeedback.inboxNotAvailable')}
          </CardContent>
        </Card>
      </PageContainer>
    );
  }
  return <Inner />;
}

function Inner() {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('open');
  const [type, setType] = useState<string>(ALL);
  const [source, setSource] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);
  const [year, setYear] = useState<string>(ALL);
  const [unread, setUnread] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [build, setBuild] = useState('');
  const [addinVersion, setAddinVersion] = useState('');
  const [addinHash, setAddinHash] = useState('');
  const [toolId, setToolId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const filter: EfInboxFilter = useMemo(
    () => ({
      q: search.trim() || undefined,
      status: status === ALL ? undefined : status,
      type: type === ALL ? undefined : type,
      source: source === ALL ? undefined : source,
      priority: priority === ALL ? undefined : priority,
      revit_year: year === ALL ? undefined : year,
      unread: unread ? '1' : undefined,
      revit_build: build.trim() || undefined,
      addin_version: addinVersion.trim() || undefined,
      addin_sha256: addinHash.trim().toLowerCase() || undefined,
      tool_id: toolId.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
      page,
      page_size: PAGE_SIZE,
    }),
    [search, status, type, source, priority, year, unread, build, addinVersion, addinHash, toolId, from, to, page],
  );

  const list = useQuery({
    queryKey: efKeys.inbox(filter),
    queryFn: () => fetchInbox(filter),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const count = useQuery({ queryKey: efKeys.count, queryFn: fetchInboxCount, refetchInterval: 60_000, refetchOnWindowFocus: true });

  const setFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const select = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('id', id);
      else next.delete('id');
      return next;
    });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await downloadInboxCsv(filter);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `engineering-requests-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      toast.error(t('engFeedback.exportFailed'), errorText(err, ''));
    } finally {
      setExporting(false);
    }
  };

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainer>
      <PageHeader
        title={t('pageTitle.engineeringRequests')}
        description={t('engFeedback.inboxDescription')}
        icon={LifeBuoy}
        meta={
          count.data ? (
            <div className="flex gap-2">
              <Badge variant="outline" data-testid="ef-count-open">
                {t('engFeedback.countOpen', { n: count.data.open })}
              </Badge>
              {count.data.unread > 0 && (
                <Badge className="bg-primary text-primary-foreground" data-testid="ef-count-unread">
                  {t('engFeedback.countUnread', { n: count.data.unread })}
                </Badge>
              )}
            </div>
          ) : null
        }
        actions={
          <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {t('engFeedback.exportCsv')}
          </Button>
        }
      />

      {/* Утсан дээр хүсэлт сонгосон үед шүүлтүүр нуугдана — дэлгэрэнгүй шууд дээд талд гарна. */}
      <Card className={cn(selectedId && 'hidden xl:block')}>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setFilter(setSearch)(e.target.value)}
                placeholder={t('engFeedback.searchPlaceholder')}
                className="pl-8"
                data-testid="ef-search"
              />
            </div>
            <FilterSelect value={status} onChange={setFilter(setStatus)} label={t('engFeedback.fieldStatus')} testId="ef-filter-status">
              <SelectItem value="open">{t('engFeedback.statusOpen')}</SelectItem>
              <SelectItem value={ALL}>{t('engFeedback.statusAll')}</SelectItem>
              {EF_STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(statusKey(s))}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect value={type} onChange={setFilter(setType)} label={t('engFeedback.fieldType')}>
              <SelectItem value={ALL}>{t('engFeedback.anyType')}</SelectItem>
              {EF_TYPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(typeKey(s))}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect value={source} onChange={setFilter(setSource)} label={t('engFeedback.fieldSource')}>
              <SelectItem value={ALL}>{t('engFeedback.anySource')}</SelectItem>
              {EF_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(sourceKey(s))}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect value={priority} onChange={setFilter(setPriority)} label={t('engFeedback.fieldPriority')}>
              <SelectItem value={ALL}>{t('engFeedback.anyPriority')}</SelectItem>
              {EF_PRIORITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(priorityKey(s))}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect value={year} onChange={setFilter(setYear)} label={t('engFeedback.revitYear')} testId="ef-filter-year">
              <SelectItem value={ALL}>{t('engFeedback.anyYear')}</SelectItem>
              {REVIT_YEARS.map((y) => (
                <SelectItem key={y} value={y}>
                  Revit {y}
                </SelectItem>
              ))}
            </FilterSelect>
            <label className="inline-flex items-center gap-2 text-sm">
              <Switch checked={unread} onCheckedChange={setFilter(setUnread)} />
              {t('engFeedback.unreadOnly')}
            </label>
            <Button variant="ghost" size="sm" onClick={() => setAdvanced((a) => !a)}>
              <Filter className="h-4 w-4" aria-hidden />
              {t('engFeedback.moreFilters')}
            </Button>
          </div>
          {advanced && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Input value={build} onChange={(e) => setFilter(setBuild)(e.target.value)} placeholder={t('engFeedback.revitBuild')} />
              <Input value={addinVersion} onChange={(e) => setFilter(setAddinVersion)(e.target.value)} placeholder={t('engFeedback.addinVersion')} />
              <Input value={addinHash} onChange={(e) => setFilter(setAddinHash)(e.target.value)} placeholder={t('engFeedback.addinHash')} />
              <Input value={toolId} onChange={(e) => setFilter(setToolId)(e.target.value)} placeholder={t('engFeedback.fieldTool')} />
              <Input type="date" value={from} onChange={(e) => setFilter(setFrom)(e.target.value)} aria-label={t('engFeedback.dateFrom')} />
              <Input type="date" value={to} onChange={(e) => setFilter(setTo)(e.target.value)} aria-label={t('engFeedback.dateTo')} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Card className={cn(selectedId && 'hidden xl:block')}>
          <CardContent className="p-0">
            {list.isPending ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : list.isError ? (
              <p className="p-6 text-sm text-destructive-ink">{errorText(list.error, t('engFeedback.loadFailed'))}</p>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8" aria-hidden />
                {t('engFeedback.inboxEmpty')}
              </div>
            ) : (
              <ul className="divide-y divide-border" data-testid="ef-inbox-list">
                {items.map((it) => (
                  <InboxRow key={it.id} item={it} active={selectedId === it.id} onClick={() => select(it.id)} />
                ))}
              </ul>
            )}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  {t('engFeedback.prevPage')}
                </Button>
                <span className="text-muted-foreground">
                  {page} / {pages} · {total}
                </span>
                <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                  {t('engFeedback.nextPage')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className={cn(!selectedId && 'hidden xl:block')}>
          {selectedId ? (
            <InboxDetail key={selectedId} id={selectedId} onBack={() => select(null)} onSelect={(id) => select(id)} />
          ) : (
            <Card>
              <CardContent className="py-20 text-center text-sm text-muted-foreground">{t('engFeedback.pickOne')}</CardContent>
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function FilterSelect({
  value,
  onChange,
  label,
  testId,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-auto min-w-[8rem]" aria-label={label} data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

function InboxRow({ item, active, onClick }: { item: EfInboxItem; active: boolean; onClick: () => void }) {
  const { t } = useLanguage();
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn('flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/50', active && 'bg-muted')}
        data-testid="ef-inbox-row"
      >
        <div className="flex items-center gap-2">
          {item.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={t('engFeedback.unread')} />}
          <span className="font-mono text-xs text-muted-foreground">{item.display_number}</span>
          <Badge variant="outline" className={cn('border', STATUS_TONE[item.status])}>
            {t(statusKey(item.status))}
          </Badge>
          {item.priority !== 'normal' && (
            <Badge variant="outline" className={cn('border', PRIORITY_TONE[item.priority])}>
              {t(priorityKey(item.priority))}
            </Badge>
          )}
          <span className="ml-auto text-micro text-muted-foreground">{formatDateTime(item.submitted_at)}</span>
        </div>
        <span className={cn('line-clamp-2 text-sm', item.unread ? 'font-semibold' : 'font-medium')}>{item.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-micro text-muted-foreground">
          <span>{item.submitter_name || item.submitter_username || '—'}</span>
          <span>· {t(typeKey(item.type))}</span>
          <span>· {item.tool_id || t(sourceKey(item.source))}</span>
          {item.revit_year && <span>· Revit {item.revit_year}</span>}
          {item.addin_version && <span>· {item.addin_version}</span>}
          {item.attachment_count > 0 && (
            <span className="inline-flex items-center gap-0.5">
              · <Paperclip className="h-3 w-3" aria-hidden />
              {item.attachment_count}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
