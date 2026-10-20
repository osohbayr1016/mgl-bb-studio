/**
 * Үнийн саналын ЖАГСААЛТ — `/app/quotes`.
 *
 * Хөнгөн жагсаалт (`GET /api/quotes` нь `sheet_json` буцаадаггүй) тул энд
 * томьёоны хөдөлгүүр огт ажиллахгүй: НИЙТ ҮНЭ нь серверт кэшлэгдсэн
 * `total_amount` (засварлагч хадгалах бүрд `anchors.total` нүднээс бичдэг).
 * Тиймээс жагсаалт хэдэн зуун баримттай байсан ч хямд.
 *
 * «Шинэ санал» нь саналын ТӨРЛИЙГ сонгуулна (`lib/quoteVariants`-ийн 4 зүйлт
 * каталог: ажлын зураг / эскиз / интерьер / зохиогчийн хяналт). Сонголт нь
 * ОЛОН — нэг санал ихэвчлэн хэд хэдэн ажлыг хамардаг — тул `Select` биш
 * checkbox бүлэг (`VariantPicker`).
 *
 * ⚠️ Төрөл нь зөвхөн АНГИЛАЛ: хуудсыг өөрчилдөггүй. Хуудсыг өөрчилдөг
 * механизм (template-ийн `variants` → `hiddenRows`) сервер талд ХЭВЭЭР байгаа
 * ба төрлийн түлхүүр загварын хувилбартай давхацвал ажиллана — одоогийн
 * «Хяналтын төсөв» загварт тийм давхцал БАЙХГҮЙ. Тиймээс энд загвар татах нь
 * зөвхөн `template_id`-г мэдэхийн тулд.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileDown,
  FileSpreadsheet,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  TrendingUp,
} from 'lucide-react';

import { downloadPdf } from '@/shared/api/client';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { EmptyState } from '@/shared/components/EmptyState';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { formatTimeAgo } from '@/shared/lib/formatting';
import { useApiQuery } from '@/shared/api/useApi';
import type { ProjectOption } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';

import {
  QUOTES_FUNNEL_KEY,
  QUOTES_LIST_KEY,
  TEMPLATES_KEY,
  quoteListKey,
  createQuote,
  deleteQuote,
  listQuotes,
  listTemplates,
} from './api/quotes';
import { QUOTE_STATUSES, type QuoteListItem, type QuoteStatus } from './types/quotes';
import { QuoteFunnelCard } from './components/QuoteFunnelCard';
import { QuoteStatusBadge } from './components/QuoteStatusBadge';
import { QUOTE_STATUS_LABEL, canPrintQuote } from './lib/quoteStatus';
import {
  DEFAULT_VARIANT_KEY,
  parseVariantKeys,
  variantLabel,
  type QuoteVariantKey,
} from './lib/quoteVariants';
import { QuickAddQuoteDialog } from './components/QuickAddQuoteDialog';
import { QuoteStatusDialog } from './components/QuoteStatusDialog';
import { VariantPicker } from './components/VariantPicker';

/** `Select` нь '' утгыг зөвшөөрдөггүй тул «төсөлгүй»-г sentinel-ээр илэрхийлнэ. */
const NO_PROJECT = 'none';

/** Татах файлын нэрэнд аюулгүй суурь. */
function fileBase(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'quote';
}

/**
 * `embedded` — «Үнийн санал» нэгдсэн хуудасны (`QuotesPage`) таб дотор рендэрлэх
 * горим. Тэр бүрхүүл нь өөрийн `PageHeader`-тэй тул энд гарчгийг ДАВХАРДУУЛАХГҮЙ,
 * зөвхөн үйлдлийн товчнуудыг баруун талд эгнүүлнэ.
 */
export default function QuoteListPage({ embedded = false }: { embedded?: boolean }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Юүлүүрийн хугацааны муж — хоосон = бүх хугацаа. `doc_date`-ээр шүүгддэг
  // (баримтын огноо), тиймээс буцаан бүртгэсэн өнгөрсөн оны санал өөрийн
  // жилдээ орно.
  const [range, setRange] = useState({ from: '', to: '' });
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all');

  const { data, isLoading } = useQuery({
    queryKey: quoteListKey(statusFilter),
    queryFn: () => listQuotes(100, statusFilter === 'all' ? null : statusFilter),
  });
  const quotes: QuoteListItem[] = data ?? [];

  const [statusQuote, setStatusQuote] = useState<QuoteListItem | null>(null);

  const removeMutation = useMutation({
    mutationFn: (id: number) => deleteQuote(id),
    // Жагсаалтын БҮХ шүүлтүүр + юүлүүрийн тоо хоёулаа хоцордог.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUOTES_LIST_KEY });
      qc.invalidateQueries({ queryKey: QUOTES_FUNNEL_KEY });
    },
    onError: (err) =>
      toast.error(t('quotes.deleteFailed'), err instanceof Error ? err.message : undefined),
  });

  const [pdfId, setPdfId] = useState<number | null>(null);

  const handlePdf = async (q: QuoteListItem) => {
    if (pdfId !== null) return;
    setPdfId(q.id);
    try {
      await downloadPdf(`/quotes/${q.id}/pdf`, `${fileBase(q.title)}.pdf`);
    } catch (err) {
      toast.error(t('quotes.err.pdf'), err instanceof Error ? err.message : undefined);
    } finally {
      setPdfId(null);
    }
  };

  const handleDelete = async (q: QuoteListItem) => {
    const ok = await confirmDialog({
      description: t('quotes.confirmDelete'),
      variant: 'destructive',
      confirmText: t('common.delete'),
    });
    if (ok) removeMutation.mutate(q.id);
  };

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <QuickAddQuoteDialog />
      <NewQuoteDialog />
    </div>
  );

  return (
    <PageContainer>
      {embedded ? (
        <div className="flex flex-wrap justify-end">{actions}</div>
      ) : (
        <PageHeader title={t('quotes.pageTitle')} icon={FileSpreadsheet} actions={actions} />
      )}

      <div className="mb-4 space-y-4">
        <QuoteFunnelCard from={range.from} to={range.to} onRangeChange={setRange} />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-micro text-muted-foreground">{t('quotes.col.status')}</span>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as QuoteStatus | 'all')}
          >
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('quotes.filter.allStatuses')}</SelectItem>
              {QUOTE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(QUOTE_STATUS_LABEL[s])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div role="status" className="py-16 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : quotes.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title={t('quotes.empty')} />
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('quotes.col.title')}</TableHead>
                  <TableHead>{t('quotes.col.client')}</TableHead>
                  <TableHead>{t('quotes.col.type')}</TableHead>
                  <TableHead>{t('quotes.col.status')}</TableHead>
                  <TableHead>{t('quotes.col.date')}</TableHead>
                  <TableHead className="text-right">{t('quotes.col.total')}</TableHead>
                  <TableHead className="text-right">{t('quotes.col.contract')}</TableHead>
                  <TableHead>{t('quotes.col.author')}</TableHead>
                  <TableHead>{t('quotes.col.updated')}</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => (
                  <TableRow
                    key={q.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() => navigate(`/app/quotes/${q.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/app/quotes/${q.id}`);
                      }
                    }}
                  >
                    <TableCell className="font-medium">
                      {q.title || '—'}
                      {/* Орчуулсан (англи) хувилбарын тэмдэг. */}
                      {q.lang === 'en' && (
                        <Badge variant="outline" className="ml-1.5 align-middle">
                          {t('quotes.badge.en')}
                        </Badge>
                      )}
                      {/* Холбоотой төсөл — 0168-аас өмнө `project_id` үргэлж
                          NULL бичигддэг байсан тул хуучин мөрүүд хоосон. */}
                      {q.project_name && (
                        <span className="block truncate text-micro font-normal text-muted-foreground">
                          {q.project_name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {q.client_name || '—'}
                    </TableCell>
                    {/* Нэг санал олон төрөл хамарч болно — шошго тус бүрээр. */}
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {parseVariantKeys(q.variant_key).map((key) => (
                          <Badge key={key} variant="secondary" className="whitespace-nowrap">
                            {variantLabel(t, key)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={q.status} />
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">
                      {q.doc_date || '—'}
                    </TableCell>
                    {/* «—» нь «0 төгрөг» БИШ, «дүн бүртгэгдээгүй» гэсэн үг:
                        `total_amount` нь браузераар нээгээгүй санал дээр NULL. */}
                    <TableCell className="text-right font-medium tabular-nums">
                      {q.total_amount === null
                        ? '—'
                        : Math.round(q.total_amount).toLocaleString('mn-MN')}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {q.contract_amount === null
                        ? '—'
                        : Math.round(q.contract_amount).toLocaleString('mn-MN')}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {q.created_by_name || '—'}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                      {formatTimeAgo(q.updated_at, lang)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title={t('common.actions')}
                            aria-label={t('common.actions')}
                          >
                            {pdfId === q.id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <MoreHorizontal />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* ⚠️ Англи хувилбарт төлөв солихыг САНААТАЙГААР
                              хаасан: юүлүүр орчуулгыг хасдаг тул тэнд тавьсан
                              ялалт хаана ч харагдахгүй. Хэлцлийн төлөв нь эх
                              монгол саналынх (сервер ч мөн 400 буцаана). */}
                          {q.source_quote_id === null && (
                            <DropdownMenuItem onSelect={() => setStatusQuote(q)}>
                              <TrendingUp />
                              {t('quotes.action.changeStatus')}
                            </DropdownMenuItem>
                          )}
                          {/* Дэвтэргүй (буцаан бүртгэсэн) мөрд PDF нь хоосон
                              A4 гаргана — товчийг огт харуулахгүй. */}
                          {canPrintQuote(q.source) && (
                            <DropdownMenuItem onSelect={() => void handlePdf(q)}>
                              <FileDown />
                              {t('quotes.action.pdf')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => void handleDelete(q)}
                          >
                            <Trash2 />
                            {t('common.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <QuoteStatusDialog
        quote={statusQuote}
        open={statusQuote !== null}
        onOpenChange={(next) => !next && setStatusQuote(null)}
      />
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  «Шинэ санал» диалог                                                 */
/* ------------------------------------------------------------------ */

function NewQuoteDialog() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  /** Дор хаяж нэг төрөл — `VariantPicker` сүүлчийнхийг авахыг зөвшөөрөхгүй. */
  const [variantKeys, setVariantKeys] = useState<QuoteVariantKey[]>([DEFAULT_VARIANT_KEY]);
  const [title, setTitle] = useState('');
  /** '' = төсөлгүй. Select нь хоосон утга зөвшөөрдөггүй тул sentinel хэрэглэв. */
  const [projectId, setProjectId] = useState(NO_PROJECT);

  // Төсөлтэй холбох нь юүлүүрийн «ямар санал ямар төсөл болов» гэсэн холбоог
  // үүсгэдэг. 0168-аас өмнө сервер `project_id`-г үл тоомсорлож ҮРГЭЛЖ NULL
  // бичдэг байсан тул хуучин мөрүүд бүгд холбоосгүй.
  const projectsQuery = useApiQuery<{ projects: ProjectOption[] }>('/projects', {
    enabled: open,
    retry: false,
  });
  const projects = projectsQuery.data?.projects ?? [];

  // Загварыг зөвхөн `template_id`-ийн төлөө татна (төрөл нь загвараас
  // хамаардаггүй болсон). Диалог нээгдсэн үед л.
  const templatesQuery = useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: listTemplates,
    enabled: open,
  });
  const templates = templatesQuery.data ?? [];
  const defaultTemplate = templates.find((x) => x.is_default === 1) ?? templates[0] ?? null;
  const templateId = defaultTemplate ? defaultTemplate.id : null;

  const mutation = useMutation({
    mutationFn: () =>
      createQuote({
        ...(templateId !== null ? { template_id: templateId } : {}),
        variant_keys: [...variantKeys],
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(projectId !== NO_PROJECT ? { project_id: Number(projectId) } : {}),
      }),
    onSuccess: (quote) => {
      qc.invalidateQueries({ queryKey: QUOTES_LIST_KEY });
      qc.invalidateQueries({ queryKey: QUOTES_FUNNEL_KEY });
      setOpen(false);
      setTitle('');
      setVariantKeys([DEFAULT_VARIANT_KEY]);
      setProjectId(NO_PROJECT);
      navigate(`/app/quotes/${quote.id}`);
    },
    onError: (err) =>
      toast.error(t('quotes.createFailed'), err instanceof Error ? err.message : undefined),
  });

  const busy = mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) {
          setTitle('');
          setVariantKeys([DEFAULT_VARIANT_KEY]);
          setProjectId(NO_PROJECT);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          {t('quotes.new')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('quotes.newDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <VariantPicker
            id="quote-variants"
            value={variantKeys}
            onChange={setVariantKeys}
            disabled={busy}
          />

          <div className="space-y-2">
            <Label htmlFor="quote-title">{t('quotes.field.title')}</Label>
            <Input
              id="quote-title"
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) mutation.mutate();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="quote-project">{t('quotes.field.project')}</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={busy}>
              <SelectTrigger id="quote-project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>{t('quotes.field.noProject')}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" disabled={busy} onClick={() => mutation.mutate()}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            {t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
