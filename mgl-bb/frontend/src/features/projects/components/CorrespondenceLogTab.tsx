/**
 * CorrespondenceLogTab — И-мэйл бүртгэл (CR/RFI/OL/MR).
 *
 * Per-project ledger of emails exchanged between staff and the client.
 * Rendered in ProjectDetailPage (mail tab) and DocumentsPage (correspondence tab).
 */
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import type { CorrespondenceEntry } from '@/shared/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import {
  Mail,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  AlertCircle,
  Search,
  X,
  Send,
  PenLine,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { useLanguage } from '@/shared/i18n';
import { CorrespondenceFormDialog } from '@/features/projects/components/CorrespondenceFormDialog';
import { CorrespondenceSendDialog } from '@/features/projects/components/CorrespondenceSendDialog';
import { getCorrespondenceSendOptions } from '@/features/projects/components/correspondenceSendApi';
import { CorrespondenceTable } from '@/features/projects/components/CorrespondenceTable';
import { CorrespondenceSignDialog } from '@/features/projects/components/CorrespondenceSignDialog';
import {
  cancelCorrespondenceSignature,
  downloadCorrespondencePdf,
  requestCorrespondenceSignature,
} from '@/features/projects/components/correspondenceSignatureApi';
import { toast } from '@/shared/components/Toast';
import {
  CORRESPONDENCE_DOC_TYPES,
  DOC_TYPE_LABEL_KEYS,
  DOC_TYPE_SHORT,
  DOC_TYPE_TONE,
  type CorrespondenceDocType,
} from '@/features/projects/components/correspondenceConstants';

type ListResponse = { entries: CorrespondenceEntry[]; can_write: boolean; can_sign?: boolean };
type DirectionFilter = 'all' | 'sent' | 'received';
type SortDir = 'desc' | 'asc';
type DocFilter = 'all' | CorrespondenceDocType;

export default function CorrespondenceLogTab({ projectId }: { projectId: number }) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<CorrespondenceEntry[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  /** Захиалагч (role=client) — `sign_status = 'pending'` мөрөнд гарын үсэг зурна. */
  const [canSign, setCanSign] = useState(false);
  const [signing, setSigning] = useState<CorrespondenceEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CorrespondenceEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [canSendMail, setCanSendMail] = useState(false);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [docFilter, setDocFilter] = useState<DocFilter>('all');

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ListResponse>(`/correspondence/projects/${projectId}`);
      setEntries(res.entries);
      setCanWrite(!!res.can_write);
      setCanSign(!!res.can_sign);
      if (res.can_write) {
        getCorrespondenceSendOptions(projectId)
          .then((opts) => setCanSendMail(opts.can_send))
          .catch(() => setCanSendMail(false));
      } else {
        setCanSendMail(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('correspondenceLogTab.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [projectId]);

  const counts = useMemo(() => {
    let sent = 0,
      received = 0;
    for (const e of entries) {
      if (e.direction === 'sent') sent += 1;
      else if (e.direction === 'received') received += 1;
    }
    return { all: entries.length, sent, received };
  }, [entries]);

  const visibleEntries = useMemo(() => {
    let list = entries;
    if (directionFilter !== 'all') list = list.filter((e) => e.direction === directionFilter);
    if (docFilter !== 'all') list = list.filter((e) => e.doc_type === docFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.subject.toLowerCase().includes(q) ||
          (e.from_email ?? '').toLowerCase().includes(q) ||
          (e.to_email ?? '').toLowerCase().includes(q) ||
          (e.cc_emails ?? '').toLowerCase().includes(q) ||
          (e.body ?? '').toLowerCase().includes(q) ||
          (e.author_name ?? '').toLowerCase().includes(q),
      );
    }
    if (sortDir === 'asc') {
      list = [...list].sort((a, b) => {
        if (a.log_date !== b.log_date) return a.log_date.localeCompare(b.log_date);
        return a.id - b.id;
      });
    }
    return list;
  }, [entries, directionFilter, docFilter, search, sortDir]);

  /** Хүлээгдэж буй гарын үсгийн хүсэлт — захиалагчийн банерын тоо. */
  const pendingForClient = useMemo(
    () => (canSign ? entries.filter((e) => e.sign_status === 'pending') : []),
    [entries, canSign],
  );

  const onRequestSignature = async (entry: CorrespondenceEntry) => {
    if (!(await confirmDialog({ description: t('correspondenceSign.requestConfirm') }))) return;
    try {
      await requestCorrespondenceSignature(entry.id);
      toast.success(t('correspondenceSign.requestedToast'));
      refresh();
    } catch (e) {
      toast.error(t('correspondenceSign.requestFailed'), e instanceof Error ? e.message : undefined);
    }
  };

  const onCancelSignature = async (entry: CorrespondenceEntry) => {
    if (!(await confirmDialog({ description: t('correspondenceSign.cancelConfirm') }))) return;
    try {
      await cancelCorrespondenceSignature(entry.id);
      refresh();
    } catch (e) {
      toast.error(t('correspondenceSign.cancelFailed'), e instanceof Error ? e.message : undefined);
    }
  };

  const onDownloadPdf = async (entry: CorrespondenceEntry) => {
    try {
      await downloadCorrespondencePdf(entry);
    } catch (e) {
      toast.error(t('correspondenceSign.pdfFailed'), e instanceof Error ? e.message : undefined);
    }
  };

  const signActions = {
    canWrite,
    canSign,
    onSign: (e: CorrespondenceEntry) => setSigning(e),
    onRequestSignature,
    onCancelSignature,
    onDownloadPdf,
    onChanged: refresh,
  };

  const onDelete = async (id: number) => {
    if (!(await confirmDialog({ description: t('correspondenceLogTab.deleteConfirm'), variant: 'destructive' }))) return;
    try {
      await apiFetch(`/correspondence/${id}`, { method: 'DELETE' });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('correspondenceLogTab.deleteFailed'));
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-primary" />
            {t('correspondenceLogTab.title')}
            {entries.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {entries.length}
              </Badge>
            )}
          </CardTitle>
          {canWrite && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setShowSend(true)}
                disabled={!canSendMail}
                title={!canSendMail ? t('correspondenceLogTab.noMailboxConfigured') : undefined}
              >
                <Send className="h-3.5 w-3.5" /> {t('correspondenceLogTab.send')}
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> {t('correspondenceLogTab.newEntry')}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {error && (
            <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}
          {!loading && pendingForClient.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-sm"
              data-testid="sign-pending-banner"
            >
              <PenLine className="h-4 w-4 shrink-0" />
              <span className="flex-1">
                {t('correspondenceSign.pendingBanner', { count: pendingForClient.length })}
              </span>
              <Button size="sm" className="h-7 gap-1.5" onClick={() => setSigning(pendingForClient[0] ?? null)}>
                <PenLine className="h-3.5 w-3.5" /> {t('correspondenceSign.signButton')}
              </Button>
            </div>
          )}
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{t('correspondenceLogTab.empty')}</p>
              {canWrite && <p className="text-xs mt-1">{t('correspondenceLogTab.emptyHint')}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <CorrespondenceFilters
                directionFilter={directionFilter}
                docFilter={docFilter}
                search={search}
                counts={counts}
                onDirectionChange={setDirectionFilter}
                onDocFilterChange={setDocFilter}
                onSearchChange={setSearch}
              />
              {visibleEntries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  {search.trim()
                    ? t('correspondenceLogTab.noSearchResults')
                    : directionFilter === 'sent'
                      ? t('correspondenceLogTab.noSent')
                      : directionFilter === 'received'
                        ? t('correspondenceLogTab.noReceived')
                        : t('correspondenceLogTab.noEntries')}
                </div>
              ) : (
                <CorrespondenceTable
                  entries={visibleEntries}
                  canWrite={canWrite}
                  sortDir={sortDir}
                  onToggleSort={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                  onEdit={(e) => {
                    setEditing(e);
                    setShowForm(true);
                  }}
                  onDelete={onDelete}
                  sign={signActions}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CorrespondenceSendDialog
        open={showSend}
        projectId={projectId}
        onClose={() => setShowSend(false)}
        onSent={() => {
          setShowSend(false);
          refresh();
        }}
      />

      <CorrespondenceSignDialog
        open={signing !== null}
        entry={signing}
        onClose={() => setSigning(null)}
        onSigned={() => {
          setSigning(null);
          refresh();
        }}
      />

      <CorrespondenceFormDialog
        open={showForm}
        projectId={projectId}
        editing={editing}
        onClose={() => {
          setShowForm(false);
          setEditing(null);
        }}
        onSaved={() => {
          setShowForm(false);
          setEditing(null);
          refresh();
        }}
      />
    </>
  );
}

function CorrespondenceFilters({
  directionFilter,
  docFilter,
  search,
  counts,
  onDirectionChange,
  onDocFilterChange,
  onSearchChange,
}: {
  directionFilter: DirectionFilter;
  docFilter: DocFilter;
  search: string;
  counts: { all: number; sent: number; received: number };
  onDirectionChange: (v: DirectionFilter) => void;
  onDocFilterChange: (v: DocFilter) => void;
  onSearchChange: (v: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <DirectionPill
          active={directionFilter === 'all'}
          onClick={() => onDirectionChange('all')}
          label={t('correspondenceLogTab.filterAll')}
          count={counts.all}
          tone="neutral"
        />
        <DirectionPill
          active={directionFilter === 'received'}
          onClick={() => onDirectionChange('received')}
          label={t('correspondenceLogTab.received')}
          count={counts.received}
          icon={<ArrowDownLeft className="h-3 w-3" />}
          tone="received"
        />
        <DirectionPill
          active={directionFilter === 'sent'}
          onClick={() => onDirectionChange('sent')}
          label={t('correspondenceLogTab.sent')}
          count={counts.sent}
          icon={<ArrowUpRight className="h-3 w-3" />}
          tone="sent"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onDocFilterChange('all')}
          className={cn(
            'px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors',
            docFilter === 'all'
              ? 'bg-foreground/10 text-foreground border-foreground/30'
              : 'border-transparent text-muted-foreground hover:bg-muted/60',
          )}
        >
          {t('correspondenceLogTab.allDocTypes')}
        </button>
        {CORRESPONDENCE_DOC_TYPES.map((dt) => (
          <button
            key={dt}
            type="button"
            onClick={() => onDocFilterChange(dt)}
            title={t(DOC_TYPE_LABEL_KEYS[dt])}
            className={cn(
              'px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors',
              docFilter === dt ? DOC_TYPE_TONE[dt] : 'border-transparent text-muted-foreground hover:bg-muted/60',
            )}
          >
            {DOC_TYPE_SHORT[dt]}
          </button>
        ))}
      </div>
      <div className="relative ml-auto flex-1 min-w-[180px] max-w-sm">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('correspondenceLogTab.searchPlaceholder')}
          className="pl-8 pr-8 h-8 text-xs"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={t('correspondenceLogTab.clearSearch')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function DirectionPill({
  active,
  onClick,
  label,
  count,
  icon,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: React.ReactNode;
  tone: 'neutral' | 'sent' | 'received';
}) {
  const activeCls =
    tone === 'sent'
      ? 'bg-primary/15 text-primary border-primary/40'
      : tone === 'received'
        ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-400'
        : 'bg-foreground/10 text-foreground border-foreground/30';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
        active
          ? activeCls
          : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {icon}
      {label}
      <Badge
        variant="outline"
        className={cn(
          'h-4 px-1.5 text-[10px] tabular-nums',
          active && 'border-current text-current bg-transparent',
        )}
      >
        {count}
      </Badge>
    </button>
  );
}
