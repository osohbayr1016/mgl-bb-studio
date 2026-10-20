import { Fragment, useState } from 'react';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import type { CorrespondenceEntry } from '@/shared/types';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Paperclip,
  Pencil,
  Trash2,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronDown,
  PenLine,
  FileDown,
  FileSignature,
  Lock,
  Undo2,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatDate } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';
import { CorrespondenceDetail } from '@/features/projects/components/CorrespondenceDetail';
import {
  DOC_TYPE_LABEL_KEYS,
  DOC_TYPE_SHORT,
  DOC_TYPE_TONE,
  SIGN_STATUS_LABEL_KEYS,
  SIGN_STATUS_TONE,
  isSignableDocType,
} from '@/features/projects/components/correspondenceConstants';

/** Гарын үсгийн үйлдлүүд — ажилтан (хүсэлт/цуцлах/PDF) ба захиалагч (зурах). */
export interface CorrespondenceSignActions {
  /** Ажилтан (бичих эрхтэй): хүсэлт тавих / цуцлах. */
  canWrite: boolean;
  /** Захиалагч: `sign_status = 'pending'` мөрөнд «Гарын үсэг зурах». */
  canSign: boolean;
  onSign: (e: CorrespondenceEntry) => void;
  onRequestSignature: (e: CorrespondenceEntry) => void;
  onCancelSignature: (e: CorrespondenceEntry) => void;
  onDownloadPdf: (e: CorrespondenceEntry) => void;
  onChanged?: () => void;
}

export function CorrespondenceTable({
  entries,
  canWrite,
  sortDir,
  onToggleSort,
  onEdit,
  onDelete,
  sign,
}: {
  entries: CorrespondenceEntry[];
  canWrite: boolean;
  sortDir: 'desc' | 'asc';
  onToggleSort: () => void;
  onEdit: (e: CorrespondenceEntry) => void;
  onDelete: (id: number) => void;
  sign: CorrespondenceSignActions;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Захиалагчид ч үйлдлийн багана бий (гарын үсэг зурах / PDF).
  const showActions = canWrite || sign.canSign;
  const colCount = showActions ? 10 : 9;

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full table-fixed min-w-[860px] text-[12px] align-top">
        <colgroup>
          <col className="w-[5%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col />
          <col className="w-[8%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[6%]" />
          {showActions && <col className={sign.canSign ? 'w-[12%]' : 'w-[9%]'} />}
        </colgroup>
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-center font-medium">№</th>
            <th className="px-2 py-2 text-left font-medium">{t('correspondenceLogTab.colDirection')}</th>
            <th className="px-2 py-2 text-left font-medium">{t('correspondenceLogTab.colType')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('correspondenceLogTab.colSubject')}</th>
            <th className="px-2 py-2 text-left font-medium">
              <button
                type="button"
                onClick={onToggleSort}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                title={
                  sortDir === 'desc'
                    ? t('correspondenceLogTab.sortNewToOld')
                    : t('correspondenceLogTab.sortOldToNew')
                }
              >
                {t('correspondenceLogTab.colDate')}
                {sortDir === 'desc' ? (
                  <ArrowDown className="h-3 w-3" />
                ) : (
                  <ArrowUp className="h-3 w-3" />
                )}
              </button>
            </th>
            <th className="px-3 py-2 text-left font-medium">{t('correspondenceLogTab.colSender')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('correspondenceLogTab.colRecipient')}</th>
            <th className="px-3 py-2 text-left font-medium">CC / BCC</th>
            <th className="px-2 py-2 text-left font-medium">{t('correspondenceLogTab.colGmailImage')}</th>
            {showActions && <th className="px-2 py-2" />}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => {
            const sent = entry.direction === 'sent';
            const DirIcon = sent ? ArrowUpRight : ArrowDownLeft;
            const isOpen = expanded.has(entry.id);
            const author =
              entry.author_name ?? t('correspondenceLogTab.userFallback', { id: entry.author_id });
            const dateStr = formatDate(new Date(entry.log_date + 'T00:00:00'));
            const attachmentHref = entry.attachment_url
              ? entry.attachment_url.startsWith('/')
                ? `${MEDIA_BASE_URL}${entry.attachment_url}`
                : entry.attachment_url
              : null;
            const signable = isSignableDocType(entry.doc_type);
            const signStatus = entry.sign_status ?? 'none';
            const signed = signStatus === 'signed';
            return (
              <Fragment key={entry.id}>
                <tr
                  className={cn(
                    'border-t border-border/40 cursor-pointer hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isOpen && 'bg-muted/30',
                  )}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(entry.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(entry.id);
                    }
                  }}
                >
                  <td className="px-2 py-2 align-top text-[11px] text-muted-foreground tabular-nums">
                    <div className="flex items-center gap-1">
                      {isOpen ? (
                        <ChevronDown className="h-3 w-3 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0" />
                      )}
                      {idx + 1}
                    </div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-5 px-1.5 text-[10px] font-medium gap-1 whitespace-nowrap',
                        sent
                          ? 'border-primary/30 text-primary bg-primary/5'
                          : 'border-emerald-500/30 text-emerald-600 bg-emerald-500/5',
                      )}
                    >
                      <DirIcon className="h-3 w-3" />
                      {sent ? t('correspondenceLogTab.sent') : t('correspondenceLogTab.received')}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 align-top">
                    {entry.doc_type ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-5 px-1.5 text-[10px] font-semibold',
                          DOC_TYPE_TONE[entry.doc_type],
                        )}
                        title={t(DOC_TYPE_LABEL_KEYS[entry.doc_type])}
                      >
                        {DOC_TYPE_SHORT[entry.doc_type]}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground/50 text-[11px]">—</span>
                    )}
                    {entry.ref_no && (
                      <div
                        className="text-[10px] text-muted-foreground mt-0.5 truncate"
                        title={entry.ref_no}
                      >
                        {entry.ref_no}
                      </div>
                    )}
                    {signable && signStatus !== 'none' && (
                      <Badge
                        variant="outline"
                        data-testid={`sign-status-${entry.id}`}
                        className={cn(
                          'mt-1 h-5 px-1.5 text-[10px] font-medium gap-1 whitespace-nowrap',
                          SIGN_STATUS_TONE[signStatus],
                        )}
                      >
                        {signed ? <Lock className="h-3 w-3" /> : <FileSignature className="h-3 w-3" />}
                        {t(SIGN_STATUS_LABEL_KEYS[signStatus])}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-foreground truncate flex items-center gap-1.5" title={entry.subject}>
                      {entry.signature_url && (
                        <PenLine className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <span className="truncate">{entry.subject}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground/70 truncate">{author}</div>
                  </td>
                  <td className="px-2 py-2 align-top text-[11px] tabular-nums whitespace-nowrap">
                    {dateStr}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {entry.from_email ? (
                      <div
                        className="font-mono text-[11px] truncate text-foreground/85"
                        title={entry.from_email}
                      >
                        {entry.from_email}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60 italic text-[11px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {entry.to_email ? (
                      <div
                        className="font-mono text-[11px] truncate text-foreground/85"
                        title={entry.to_email}
                      >
                        {entry.to_email}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60 italic text-[11px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {entry.cc_emails ? (
                      <div
                        className="font-mono text-[11px] truncate text-foreground/75"
                        title={entry.cc_emails}
                      >
                        {entry.cc_emails}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60 italic text-[11px]">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                    {attachmentHref ? (
                      <a
                        href={attachmentHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        title={t('correspondenceLogTab.openGmailScreenshot')}
                      >
                        <Paperclip className="h-3 w-3" /> {t('correspondenceLogTab.image')}
                      </a>
                    ) : (
                      <span className="text-muted-foreground/60 italic text-[11px]">—</span>
                    )}
                  </td>
                  {showActions && (
                    <td
                      className="px-2 py-2 align-top text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-0.5">
                        {/* Захиалагч: хүлээгдэж буй RFI/CR-д «Гарын үсэг зурах». */}
                        {sign.canSign && signable && signStatus === 'pending' && (
                          <Button
                            size="sm"
                            className="h-7 gap-1 px-2 text-[11px]"
                            onClick={() => sign.onSign(entry)}
                            data-testid={`sign-button-${entry.id}`}
                          >
                            <PenLine className="h-3.5 w-3.5" />
                            {t('correspondenceSign.signShort')}
                          </Button>
                        )}
                        {/* PDF — RFI/CR бүрт (ажилтан ч, захиалагч ч). */}
                        {signable && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => sign.onDownloadPdf(entry)}
                            title={t('correspondenceSign.downloadPdf')}
                            data-testid={`pdf-button-${entry.id}`}
                          >
                            <FileDown className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {/* Ажилтан: хүсэлт тавих / цуцлах — signed үед юу ч алга. */}
                        {canWrite && signable && signStatus === 'none' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-primary"
                            onClick={() => sign.onRequestSignature(entry)}
                            title={t('correspondenceSign.requestButton')}
                            data-testid={`request-sign-${entry.id}`}
                          >
                            <FileSignature className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canWrite && signable && signStatus === 'pending' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-amber-600"
                            onClick={() => sign.onCancelSignature(entry)}
                            title={t('correspondenceSign.cancelButton')}
                            data-testid={`cancel-sign-${entry.id}`}
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {/* Гарын үсэгтэй бичгийн агуулга түгжигдсэн — засах товч алга. */}
                        {canWrite && !signed && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => onEdit(entry)}
                            title={t('common.edit')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canWrite && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => onDelete(entry.id)}
                            title={t('common.delete')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                {isOpen && (
                  <tr className="bg-muted/20">
                    <td colSpan={colCount} className="px-3 pb-3 pt-0">
                      <CorrespondenceDetail
                        entry={entry}
                        author={author}
                        dateStr={dateStr}
                        attachmentHref={attachmentHref}
                        sign={sign}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
