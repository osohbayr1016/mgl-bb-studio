/**
 * /app/mail — Gmail-style 3-pane inbox (folder rail · conversation list ·
 * reading pane).  Feeds the same correspondence ledger as before: the reading
 * pane's «Ангилах» opens the unchanged ClassifyDialog.  Admin-tier only.
 *
 * Conversations are grouped by Gmail thread_id (GET /email/threads); the flat
 * GET /email/messages endpoint is kept intact for the singleton fallback and
 * the ClassifyDialog's own message fetch.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Menu, Pencil } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { syncNow } from '@/features/email/api/email';
import type {
  AliasListResponse,
  ComposeDraft,
  EmailAccount,
  EmailThreadListItem,
  ThreadListResponse,
} from '@/features/email/types/email';
import { Button } from '@/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/ui/sheet';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { FolderRail } from './components/FolderRail';
import { MessageList } from './components/MessageList';
import { ReadingPane } from './components/ReadingPane';
import { ClassifyDialog } from './components/ClassifyDialog';
import { ComposeWindow } from './components/ComposeWindow';
import { useMailMutations } from './hooks/useMailMutations';

type TriagedFilter = '0' | 'all';
type DirectionFilter = 'all' | 'in' | 'out';

/**
 * Хавтасны түлхүүрүүд — `?folder=` параметрийн утгууд.
 *
 * Хавтас нь үнэндээ (`triaged`, `direction`) ХОСООС бүрддэг ч URL-д хос
 * биш НЭГ утга сууна: глобал хайлтын гүн холбоосын бай, `shared/lib/
 * search/sections.ts`-тэй ижил байлгана.  `FolderRail` нь хосоороо
 * ярьсаар байх тул энд хоёр тийш нь хөрвүүлнэ.
 */
const MAIL_FOLDERS = ['untriaged', 'inbox', 'sent', 'all'] as const;
type MailFolder = (typeof MAIL_FOLDERS)[number];

const FOLDER_FILTERS: Record<
  MailFolder,
  { triaged: TriagedFilter; direction: DirectionFilter }
> = {
  untriaged: { triaged: '0', direction: 'all' },
  inbox: { triaged: 'all', direction: 'in' },
  sent: { triaged: 'all', direction: 'out' },
  all: { triaged: 'all', direction: 'all' },
};

/** (`triaged`, `direction`) хосыг хавтасны түлхүүр рүү буцаана. */
function folderKeyOf(triaged: TriagedFilter, direction: DirectionFilter): MailFolder {
  return (
    MAIL_FOLDERS.find(
      (k) =>
        FOLDER_FILTERS[k].triaged === triaged && FOLDER_FILTERS[k].direction === direction,
    ) ?? 'untriaged'
  );
}

export default function MailInboxPage() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Filters
  const [folder, setFolder] = useTabParam(MAIL_FOLDERS, 'untriaged', 'folder');
  const { triaged, direction } = FOLDER_FILTERS[folder];
  const [accountId, setAccountId] = useState('all');
  const [addr, setAddr] = useState('all');
  const [cat, setCat] = useState<'all' | 'convo' | 'promo'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Selection / dialogs
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [compose, setCompose] = useState<{
    open: boolean;
    minimized: boolean;
    draft: ComposeDraft | null;
    /** Bumped per new draft so ComposeWindow remounts and re-seeds its fields. */
    key: number;
  }>({ open: false, minimized: false, draft: null, key: 0 });
  const [classifyMessageId, setClassifyMessageId] = useState<number | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const openCompose = (draft: ComposeDraft | null = null) =>
    setCompose((c) => ({ open: true, minimized: false, draft, key: c.key + 1 }));
  const closeCompose = () => setCompose((c) => ({ ...c, open: false, minimized: false, draft: null }));

  const clearSel = () => setCheckedKeys(new Set());
  const onFolder = (tr: TriagedFilter, dir: DirectionFilter) => {
    setFolder(folderKeyOf(tr, dir));
    setPage(1);
    clearSel();
    setRailOpen(false);
  };
  const onAccount = (v: string) => {
    setAccountId(v);
    setAddr('all');
    setPage(1);
    clearSel();
  };
  const onAddr = (v: string) => {
    setAddr(v);
    setPage(1);
    clearSel();
  };
  const onCat = (v: 'all' | 'convo' | 'promo') => {
    setCat(v);
    setPage(1);
    clearSel();
  };
  const onSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const onPage = (p: number) => {
    setPage(p);
    clearSel();
  };

  // Reference data
  const { data: accountsData } = useApiQuery<{ accounts: EmailAccount[] }>('/email/accounts');
  const accounts = accountsData?.accounts ?? [];
  // Идэвхтэй хайрцгийн сүүлийн синк амжилтгүй бол ЭНД харуулна.  Илгээх
  // товч дарж 502 авахаас өмнө шалтгааныг нь харах ёстой — 2026-08-24-ны
  // акаунт шилжилтийн дараа хоёр хайрцаг 2 долоо хоног чимээгүй унтарсан.
  const brokenAccounts = accounts.filter((a) => a.is_active === 1 && a.last_sync_error);
  const { data: projectsData } = useApiQuery<{ projects: { id: number; name: string }[] }>(
    '/email/projects',
  );
  const projects = projectsData?.projects ?? [];
  const { data: triageData } = useApiQuery<{ count: number }>('/email/triage-count');
  const triageCount = triageData?.count ?? 0;

  const aliasEndpoint = useMemo(
    () => `/email/aliases${accountId !== 'all' ? `?account_id=${accountId}` : ''}`,
    [accountId],
  );
  const { data: aliasData } = useApiQuery<AliasListResponse>(
    ['/email/aliases', accountId],
    aliasEndpoint,
  );
  const aliases = aliasData?.aliases ?? [];

  // Thread list
  const endpoint = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('triaged', triaged);
    if (direction !== 'all') sp.set('direction', direction);
    if (accountId !== 'all') sp.set('account_id', accountId);
    if (addr !== 'all') sp.set('addr', addr);
    if (cat !== 'all') sp.set('cat', cat);
    if (search.trim()) sp.set('q', search.trim());
    if (page > 1) sp.set('page', String(page));
    return `/email/threads?${sp.toString()}`;
  }, [triaged, direction, accountId, addr, cat, search, page]);

  const { data, isLoading, isFetching } = useApiQuery<ThreadListResponse>(
    ['/email/threads', triaged, direction, accountId, addr, cat, search.trim(), page],
    endpoint,
    { refetchOnWindowFocus: true, placeholderData: (prev) => prev },
  );

  // 2026-09-11 (D1 аудит): жагсаалтыг минут тутам ШУУД дахин татахын оронд
  // (нэг удаад 74 000 D1 мөр) 1 мөртэй `/email/inbox-version`-ийг шалгаж,
  // шинэ захиа ирсэн үед л (хувилбар өөрчлөгдвөл) thread + triage-count
  // query-г хүчингүй болгоно.  Захиа зөвхөн 2 минутын cron-оор нэмэгддэг тул
  // хэрэглэгчийн хувьд шинэчлэлтийн хоцролт ӨМНӨХТЭЙ ижил.
  const { data: versionData } = useApiQuery<{ version: string }>(
    ['/email/inbox-version'],
    '/email/inbox-version',
    { refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 30_000 },
  );
  const seenVersion = useRef<string | null>(null);
  useEffect(() => {
    const v = versionData?.version;
    if (v === undefined) return;
    if (seenVersion.current !== null && seenVersion.current !== v) {
      qc.invalidateQueries({ queryKey: ['/email/threads'] });
      qc.invalidateQueries({ queryKey: ['/email/triage-count'] });
    }
    seenVersion.current = v;
  }, [versionData?.version, qc]);
  const threads = data?.threads ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const selectedItem = useMemo(
    () => threads.find((th) => th.thread_key === selectedThreadKey) ?? null,
    [threads, selectedThreadKey],
  );
  const selectedItems = useMemo(
    () => threads.filter((th) => checkedKeys.has(th.thread_key)),
    [threads, checkedKeys],
  );

  const { setRead, remove } = useMailMutations();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/email/threads'] });
    qc.invalidateQueries({ queryKey: ['/email/triage-count'] });
  };

  const sync = useMutation({
    mutationFn: () => syncNow(),
    onSuccess: (res) => {
      const stored = res.results.reduce((n, r) => n + r.stored, 0);
      toast.success(t('mailTriagePage.syncDone', { count: stored }));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Handlers
  const openThread = (item: EmailThreadListItem) => {
    setSelectedThreadKey(item.thread_key);
    if (item.unread_count > 0) setRead.mutate({ items: [item], read: true });
  };
  const toggleCheck = (item: EmailThreadListItem) =>
    setCheckedKeys((s) => {
      const n = new Set(s);
      if (n.has(item.thread_key)) n.delete(item.thread_key);
      else n.add(item.thread_key);
      return n;
    });
  const toggleAll = () => {
    if (threads.length > 0 && threads.every((th) => checkedKeys.has(th.thread_key))) clearSel();
    else setCheckedKeys(new Set(threads.map((th) => th.thread_key)));
  };
  const toggleRead = (item: EmailThreadListItem) =>
    setRead.mutate({ items: [item], read: item.unread_count === 0 });
  const deleteThread = async (item: EmailThreadListItem) => {
    if (
      await confirmDialog({ description: t('mailTriagePage.deleteConfirm'), variant: 'destructive' })
    ) {
      if (selectedThreadKey === item.thread_key) setSelectedThreadKey(null);
      setCheckedKeys((s) => {
        const n = new Set(s);
        n.delete(item.thread_key);
        return n;
      });
      remove.mutate([item]);
    }
  };
  const bulkRead = () => {
    setRead.mutate({ items: selectedItems, read: true });
    clearSel();
  };
  const bulkUnread = () => {
    setRead.mutate({ items: selectedItems, read: false });
    clearSel();
  };
  const bulkDelete = async () => {
    if (
      await confirmDialog({
        description: t('mailInbox.deleteSelectedConfirm', { count: selectedItems.length }),
        variant: 'destructive',
      })
    ) {
      const keys = new Set(selectedItems.map((i) => i.thread_key));
      if (selectedThreadKey && keys.has(selectedThreadKey)) setSelectedThreadKey(null);
      remove.mutate(selectedItems);
      clearSel();
    }
  };

  const railProps = {
    triaged,
    direction,
    accountId,
    addr,
    cat,
    accounts,
    aliases,
    triageCount,
    syncing: sync.isPending,
    onCompose: () => {
      openCompose();
      setRailOpen(false);
    },
    onSync: () => sync.mutate(),
    onFolder,
    onAccount,
    onAddr,
    onCat,
  };

  const readingProps = {
    item: selectedItem,
    onClassify: (messageId: number) => setClassifyMessageId(messageId),
    onCompose: (draft: ComposeDraft) => openCompose(draft),
    onDelete: deleteThread,
    onClose: () => setSelectedThreadKey(null),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Mobile top bar */}
      {!isDesktop && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setRailOpen(true)}
            aria-label={t('mailInbox.folders')}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="text-sm font-semibold">{t('nav.mail')}</span>
          <Button size="sm" className="ml-auto" onClick={() => openCompose()}>
            <Pencil className="h-4 w-4" /> {t('mailInbox.compose')}
          </Button>
        </div>
      )}

      {brokenAccounts.map((a) => (
        <div
          key={a.id}
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {t('mailInbox.accountBroken', { address: a.address, error: a.last_sync_error ?? '' })}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to="/app/admin/email">{t('mailInbox.accountBrokenAction')}</Link>
          </Button>
        </div>
      ))}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {isDesktop && (
          <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border/60 bg-card/40">
            <FolderRail {...railProps} />
          </aside>
        )}

        <div
          className={cn(
            'flex min-h-0 flex-col border-r border-border/60',
            isDesktop ? 'w-96 shrink-0 xl:w-[26rem]' : 'flex-1',
          )}
        >
          <MessageList
            items={threads}
            isLoading={isLoading}
            isFetching={isFetching}
            total={total}
            page={page}
            totalPages={totalPages}
            selectedThreadKey={selectedThreadKey}
            checkedKeys={checkedKeys}
            search={search}
            hasAccounts={accounts.length > 0}
            onSearch={onSearch}
            onOpen={openThread}
            onToggleCheck={toggleCheck}
            onToggleRead={toggleRead}
            onDeleteThread={deleteThread}
            onToggleAll={toggleAll}
            onBulkRead={bulkRead}
            onBulkUnread={bulkUnread}
            onBulkDelete={bulkDelete}
            onClearSelection={clearSel}
            onPage={onPage}
          />
        </div>

        {isDesktop && (
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <ReadingPane {...readingProps} />
          </section>
        )}
      </div>

      {/* Mobile: rail in a left Sheet */}
      {!isDesktop && (
        <Sheet open={railOpen} onOpenChange={setRailOpen}>
          <SheetContent side="left" className="w-72 max-w-[85vw] p-0">
            <SheetTitle className="sr-only">{t('mailInbox.folders')}</SheetTitle>
            <FolderRail {...railProps} />
          </SheetContent>
        </Sheet>
      )}

      {/* Mobile: reading pane in a right Sheet */}
      {!isDesktop && (
        <Sheet
          open={!!selectedThreadKey}
          onOpenChange={(o) => {
            if (!o) setSelectedThreadKey(null);
          }}
        >
          <SheetContent
            side="right"
            showCloseButton={false}
            className="w-full max-w-full p-0 sm:max-w-full"
          >
            <SheetTitle className="sr-only">
              {selectedItem?.latest_subject || t('mailTriagePage.noSubject')}
            </SheetTitle>
            <ReadingPane {...readingProps} />
          </SheetContent>
        </Sheet>
      )}

      {/* Classify dialog (unchanged) */}
      {classifyMessageId !== null && (
        <ClassifyDialog
          messageId={classifyMessageId}
          projects={projects}
          onClose={() => setClassifyMessageId(null)}
          onDone={() => {
            setClassifyMessageId(null);
            invalidate();
          }}
        />
      )}

      {/* Compose window (docked, Gmail-style) */}
      <ComposeWindow
        key={compose.key}
        open={compose.open}
        minimized={compose.minimized}
        accounts={accounts}
        projects={projects}
        draft={compose.draft}
        onClose={closeCompose}
        onMinimize={() => setCompose((c) => ({ ...c, minimized: !c.minimized }))}
        onSent={() => {
          closeCompose();
          invalidate();
        }}
      />
    </div>
  );
}
