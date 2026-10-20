/**
 * «Баримт бичиг» → Word баримтыг урьдчилан харах цонхны «Гарын үсэг» самбар
 * (эзний хүсэлт 2026-10-01): ажилтан профайлын гарын үсгээрээ НЭГ товчоор
 * зурна, дараа нь захирал НЭГ товчоор батална.  Гарын үсэг Word ФАЙЛ ДЭЭР
 * суугаад Drive-д ижил файлын шинэ хувилбар болно (backend
 * `routes/driveSigning.ts`), тиймээс зурсны дараа зүүн талын харагдац дахин
 * ачаалагдаж гарын үсэг баримт дээр шууд харагдана.
 *
 * Шинэ цэс НЭМЭЭГҮЙ (эзний санаа зовнил): бүх зүйл одоо байгаа «Баримт
 * бичиг» цонхонд; захиралд мэдэгдэл + хяналтын самбарын зурвас очно.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BadgeCheck,
  BellRing,
  CheckCircle2,
  Clock3,
  History,
  Info,
  Link2,
  Loader2,
  PenLine,
  Printer,
  RefreshCw,
  Send,
  Undo2,
  UserRoundPen,
  XCircle,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { ApiError, apiFetch, mediaUrl } from '@/shared/api/client';
import { SignatureCapture } from '@/shared/components/SignatureCapture';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import type { DriveScope } from '../types';
import {
  approveDocument,
  askSignature,
  cancelRequest,
  createSignLink,
  downloadSignedFile,
  fetchSignLinks,
  fetchSigning,
  pendingSignaturesKey,
  requestApproval,
  returnDocument,
  revokeSignLink,
  signLinksKey,
  signSlot,
  signingKey,
} from './api';
import { DriveSignLinkDialog, LiveStatus, type CreateLinkBody } from './DriveSignLinkDialog';
import { awaitingClient, type ClientSignState, type SignLinkView, type SignSlotView, type SigningState } from './types';

/** Амьд (хүлээгдэж буй / зурж буй) link бүхий үед ажилтны цонх ингэж ойрхон асууна — «бодит цаг». */
const LIVE_POLL_MS = 3_000;
/** Амьд link-гүй үед ч бусад хүн (ажилтан, захирал) зурвал цонх шинэчлэгдэнэ. */
const IDLE_POLL_MS = 20_000;

/** Энэ төлөвт баримт дээр хамгийн сүүлд суусан гарын үсгийн үйл явдал (сервер `signingVersion`-ийн ихэр). */
function knownVersion(s: SigningState | undefined): number {
  if (!s) return 0;
  let v = 0;
  for (const h of s.history) if (h.action !== 'ask' && h.id > v) v = h.id;
  return v;
}

type Translate = ReturnType<typeof useLanguage>['t'];

/** Серверийн алдааны код → хэрэглэгчид ойлгомжтой мессеж. */
function errorMessage(t: Translate, err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  const known: Record<string, string> = {
    STALE_FILE: 'docSign.errStale',
    BUSY: 'docSign.errBusy',
    NO_SIGNATURE: 'docSign.errNoSignature',
    SIGNATURE_FORMAT: 'docSign.errSignatureFormat',
    NOT_EMPTY: 'docSign.errNotEmpty',
    SLOT_NOT_EMPTY: 'docSign.errNotEmpty',
    APPROVER_ONLY: 'docSign.errApproverOnly',
    NAME_MISMATCH: 'docSign.errNameMismatch',
    CLIENT: 'docSign.errClient',
    ALREADY_PENDING: 'docSign.errAlreadyPending',
    ALREADY_ASKED: 'docSign.errAlreadyAsked',
    NO_APPROVER_SLOT: 'docSign.errNoApproverSlot',
    DELEGATION_REQUIRED: 'docSign.errDrive',
    PERMISSION_DENIED: 'docSign.errDrive',
  };
  if (code && known[code]) return t(known[code]);
  return err instanceof Error && err.message ? err.message : t('docSign.errGeneric');
}

export function DriveSigningPanel({
  scope,
  id,
  fileId,
  onDocumentChanged,
  onPrint,
  linkDialogRequest = 0,
}: {
  scope: DriveScope;
  id: number;
  fileId: string;
  /** Баримт Drive дээр шинэчлэгдсэн (гарын үсэг суусан) — харагдацыг дахин ачаална. */
  onDocumentChanged: () => void;
  onPrint: () => void;
  /** Файлын толгойн «Гарын үсгийн link» товч — тоо өсөх бүрд link цонх нээгдэнэ. */
  linkDialogRequest?: number;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const { user, checkAuth } = useAuth();
  const key = signingKey(scope, id, fileId);
  const q = useQuery({ queryKey: key, queryFn: () => fetchSigning(scope, id, fileId), retry: false });
  const [requestApprovalChecked, setRequestApprovalChecked] = useState(true);
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [savingSignature, setSavingSignature] = useState(false);

  const afterChange = (next: SigningState, documentChanged: boolean) => {
    qc.setQueryData(key, next);
    void qc.invalidateQueries({ queryKey: ['project-drive', scope, id, 'signing-statuses'] });
    void qc.invalidateQueries({ queryKey: pendingSignaturesKey });
    if (documentChanged) onDocumentChanged();
  };

  const onError = (err: unknown) => {
    toast.error(t('docSign.failed'), errorMessage(t, err));
    const code = err instanceof ApiError ? err.code : undefined;
    if (code === 'STALE_FILE' || code === 'NOT_EMPTY' || code === 'SLOT_NOT_EMPTY') {
      void q.refetch();
      onDocumentChanged();
    }
  };

  const sign = useMutation({
    mutationFn: (v: { slot: SignSlotView; confirm: boolean }) =>
      signSlot(scope, id, fileId, {
        slot_key: v.slot.key,
        base_modified_time: q.data?.file.modified_time ?? '',
        request_approval: requestApprovalChecked && (q.data?.can_request ?? false),
        confirm_name_mismatch: v.confirm,
      }),
    onSuccess: (next) => {
      toast.success(next.requested ? t('docSign.signedAndRequested') : t('docSign.signed'));
      afterChange(next, true);
    },
    onError,
  });

  const approve = useMutation({
    mutationFn: (slotKey: string | undefined) =>
      approveDocument(scope, id, fileId, { base_modified_time: q.data?.file.modified_time ?? '', slot_key: slotKey }),
    onSuccess: (next) => {
      // CR: манай тал баталсан ч захиалагч зураагүй бол «Батлагдсан» биш (2026-10-19).
      toast.success(awaitingClient(next.request?.status, next.client_sign) ? t('docSign.approvedClientPending') : t('docSign.approved'));
      afterChange(next, true);
    },
    onError,
  });

  const request = useMutation({
    mutationFn: () => requestApproval(scope, id, fileId),
    onSuccess: (next) => {
      toast.success(t('docSign.requestSent'));
      afterChange(next, false);
    },
    onError,
  });

  const giveBack = useMutation({
    mutationFn: (note: string) => returnDocument(scope, id, fileId, note),
    onSuccess: (next) => {
      toast.success(t('docSign.returned'));
      setReturning(false);
      setReturnNote('');
      afterChange(next, false);
    },
    onError,
  });

  const cancel = useMutation({
    mutationFn: () => cancelRequest(scope, id, fileId),
    onSuccess: (next) => afterChange(next, false),
    onError,
  });

  const ask = useMutation({
    mutationFn: (slot: SignSlotView) => askSignature(scope, id, fileId, slot.key),
    onSuccess: (next, slot) => {
      toast.success(t('docSign.askSent', { name: slot.ask_user?.name ?? '' }));
      afterChange(next, false);
    },
    onError,
  });

  /** Нээлттэй link цонх; `initialKey` — мөрөөс нээсэн бол тэр мөр урьдчилан сонгогдоно. */
  const [linkDialog, setLinkDialog] = useState<{ initialKey: string | null; n: number } | null>(null);
  const [createdLinkId, setCreatedLinkId] = useState<number | null>(null);
  const openLinkDialog = (initialKey: string | null) => {
    setCreatedLinkId(null);
    setLinkDialog((prev) => ({ initialKey, n: (prev?.n ?? 0) + 1 }));
  };
  // Толгойн товч — самбар ачаалагдсаны ДАРАА нээнэ (мөрүүд хэрэгтэй); нэг хүсэлтэд нэг удаа.
  // 0-оос эхэлнэ: товч дарахад самбар ШИНЭЭР mount болж тоо аль хэдийн 1 байдаг (эцэг самбарыг
  // хаахад тоог 0 болгоно — дахин нээхэд цонх өөрөө гарч ирэхгүй).
  const handledRequest = useRef(0);
  useEffect(() => {
    if (!q.data || linkDialogRequest === handledRequest.current) return;
    handledRequest.current = linkDialogRequest;
    if (q.data.can_manage_links) openLinkDialog(null);
  }, [linkDialogRequest, q.data]);

  // Гаднын link-үүд + бодит цагийн «хувилбар» — зөвхөн D1, Drive руу дуудахгүй.
  const linksKey = signLinksKey(scope, id, fileId);
  const linksQ = useQuery({
    queryKey: linksKey,
    queryFn: () => fetchSignLinks(scope, id, fileId),
    retry: false,
    // Таб руу буцмагц шууд асууна (гаднын хүн энэ хооронд зурсан байж болно) — нэг мөрийн D1 уншилт.
    staleTime: 0,
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const live = query.state.data?.links.some((l) => l.status === 'pending' || l.status === 'signing');
      return live ? LIVE_POLL_MS : IDLE_POLL_MS;
    },
  });

  // Өөр хүн (гаднын зурагч, хамт олон, захирал) зурвал баримт + самбарыг дахин ачаална.
  // Өөрийн үйлдлийн хариу (`afterChange`) аль хэдийн шинэ төлөвтэй тул давхар ачаалахгүй.
  const reloadedFor = useRef(0);
  const serverVersion = linksQ.data?.version ?? 0;
  const localVersion = knownVersion(q.data);
  useEffect(() => {
    if (!q.data || serverVersion <= localVersion || reloadedFor.current >= serverVersion) return;
    reloadedFor.current = serverVersion;
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ['project-drive', scope, id, 'signing-statuses'] });
    onDocumentChanged();
  }, [serverVersion, localVersion, q, qc, scope, id, onDocumentChanged]);

  // Гаднын хүн зурсан агшинд мэдэгдэнэ (өмнөх асуулгад хүлээгдэж байсан link).
  const prevLinks = useRef<Map<number, SignLinkView['status']> | null>(null);
  useEffect(() => {
    const links = linksQ.data?.links;
    if (!links) return;
    const prev = prevLinks.current;
    if (prev) {
      for (const l of links) {
        const before = prev.get(l.id);
        if (l.status === 'signed' && (before === 'pending' || before === 'signing')) {
          toast.success(t('docSign.linkSignedToast', { name: l.signed_name ?? '' }), l.role_label);
        }
      }
    }
    prevLinks.current = new Map(links.map((l) => [l.id, l.status]));
  }, [linksQ.data, t]);

  const liveLinkFor = (slotKey: string): SignLinkView | null =>
    linksQ.data?.links.find((l) => l.slot_key === slotKey && (l.status === 'pending' || l.status === 'signing')) ?? null;

  const createLink = async (body: CreateLinkBody): Promise<string> => {
    const res = await createSignLink(scope, id, fileId, {
      ...body,
      // «Захиалагч хүлээн авсан» мөр нэмэх нь баримтыг өөрчилнө — харсан хувилбараас хойш засагдсан бол 409.
      base_modified_time: body.add_client_row ? (q.data?.file.modified_time ?? null) : undefined,
    });
    setCreatedLinkId(res.link?.id ?? null);
    await qc.invalidateQueries({ queryKey: linksKey });
    void qc.invalidateQueries({ queryKey: ['project-drive', scope, id, 'signing-statuses'] });
    if (body.add_client_row) {
      // Мөр нэмэгдэж Drive-д шинэ хувилбар болсон — самбар, харагдацыг шинэчилнэ.
      void q.refetch();
      onDocumentChanged();
    }
    return res.url;
  };

  const revokeLink = useMutation({
    mutationFn: (link: SignLinkView) => revokeSignLink(scope, id, link.id),
    onSuccess: () => {
      toast.success(t('docSign.linkRevoked'));
      void qc.invalidateQueries({ queryKey: linksKey });
      void qc.invalidateQueries({ queryKey: ['project-drive', scope, id, 'signing-statuses'] });
    },
    onError,
  });

  const startRevoke = async (link: SignLinkView) => {
    const ok = await confirmDialog({
      title: t('docSign.linkRevokeTitle'),
      description: t('docSign.linkRevokeBody', { role: link.role_label }),
      confirmText: t('docSign.linkRevoke'),
    });
    if (ok) revokeLink.mutate(link);
  };

  const busy = sign.isPending || approve.isPending || request.isPending || giveBack.isPending || cancel.isPending;

  if (q.isPending) {
    return (
      <PanelShell>
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('docSign.loading')}
        </div>
      </PanelShell>
    );
  }
  if (q.isError) {
    return (
      <PanelShell>
        <p className="text-sm text-muted-foreground">{errorMessage(t, q.error)}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void q.refetch()}>
          <RefreshCw className="h-4 w-4" /> {t('common.retry')}
        </Button>
      </PanelShell>
    );
  }

  const s = q.data;
  const signatureUrl = user?.signature_url ?? s.me.profile_signature_url;
  const hasSignature = !!signatureUrl;
  const pending = s.request?.status === 'pending';
  const approveSlot = s.default_approve_slot ? s.slots.find((x) => x.key === s.default_approve_slot) : undefined;

  const saveProfileSignature = async (url: string | null) => {
    setSavingSignature(true);
    try {
      await apiFetch('/auth/profile', { method: 'PATCH', data: { signature_url: url } });
      await checkAuth();
      await q.refetch();
      if (url) toast.success(t('docSign.profileSignatureSaved'));
    } catch (err) {
      toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setSavingSignature(false);
    }
  };

  const startSign = async (slot: SignSlotView) => {
    if (!hasSignature) {
      toast.warn(t('docSign.errNoSignature'));
      return;
    }
    if (slot.needs_name_confirm) {
      const ok = await confirmDialog({
        title: t('docSign.nameConfirmTitle'),
        description: t('docSign.nameConfirmBody', { name: slot.name, role: slot.role }),
        confirmText: t('docSign.nameConfirmButton'),
      });
      if (!ok) return;
      sign.mutate({ slot, confirm: true });
      return;
    }
    sign.mutate({ slot, confirm: false });
  };

  const startApprove = async () => {
    if (!hasSignature) {
      toast.warn(t('docSign.errNoSignature'));
      return;
    }
    const unsigned = s.slots.filter((x) => !x.approver && !x.client && x.state === 'empty').length;
    const ok = await confirmDialog({
      title: t('docSign.approveConfirmTitle'),
      description:
        unsigned > 0
          ? t('docSign.approveConfirmBodyMissing', { n: unsigned, file: s.file.name })
          : t('docSign.approveConfirmBody', { file: s.file.name }),
      confirmText: t('docSign.approveButton'),
    });
    if (!ok) return;
    approve.mutate(s.default_approve_slot ?? undefined);
  };

  const groups = [...new Set(s.slots.map((x) => x.group))];

  return (
    <PanelShell>
      <StatusLine
        state={s}
        clientLinkLive={linksQ.data?.links.some((l) => l.status === 'pending' || l.status === 'signing') ?? false}
      />

      {s.request?.status === 'returned' && s.request.decision_note && (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs text-foreground">
          <div className="flex items-center gap-1.5 font-medium">
            <Undo2 className="h-3.5 w-3.5 text-danger" /> {t('docSign.returnedBy', { name: s.request.decided_by?.name ?? '' })}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{s.request.decision_note}</p>
        </div>
      )}

      {s.changed_since_signing && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-muted/60 p-2 text-micro text-muted-foreground">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" /> {t('docSign.changedSinceSigning')}
        </p>
      )}

      {!s.supported ? (
        <UnsupportedNote reason={s.reason} />
      ) : (
        <>
          {/* DASR-ын «Гарын үсгийн link»-тэй адил — захиалагчид (гаднын хүнд) зуруулах (admin). */}
          {s.can_manage_links && (s.slots.some((x) => x.can_link) || s.client_row_addable) && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={() => openLinkDialog(null)}
              data-testid="doc-sign-open-links"
            >
              <Link2 className="h-4 w-4" /> {t('docSign.linkPanelButton')}
            </Button>
          )}
          {/* Гарын үсгийн мөрүүд — баримтын дарааллаар, хэсгээр бүлэглэв. */}
          <div className="mt-3 space-y-3">
            {groups.map((g) => (
              <ul key={g} className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border">
                {s.slots
                  .filter((x) => x.group === g)
                  .map((slot) => (
                    <SlotRow
                      key={slot.key}
                      slot={slot}
                      isApprover={s.me.is_approver}
                      busy={busy}
                      signingKey={sign.isPending ? sign.variables?.slot.key : null}
                      askingKey={ask.isPending ? ask.variables?.key : null}
                      onSign={() => void startSign(slot)}
                      onAsk={() => ask.mutate(slot)}
                      link={liveLinkFor(slot.key)}
                      linksAvailable={linksQ.isSuccess && s.can_manage_links === true}
                      revoking={revokeLink.isPending && revokeLink.variables?.slot_key === slot.key}
                      onLink={() => {
                        setCreatedLinkId(null);
                        openLinkDialog(slot.key);
                      }}
                      onRevokeLink={(l) => void startRevoke(l)}
                    />
                  ))}
              </ul>
            ))}
          </div>

          {/* Миний гарын үсэг — профайлынх; байхгүй бол энд шууд үүсгэнэ. */}
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-xs font-medium text-foreground">{t('docSign.mySignature')}</div>
            {hasSignature ? (
              <div className="mt-2 flex items-center gap-3">
                <div className="rounded-md border border-border bg-white p-1.5">
                  <img src={mediaUrl(signatureUrl)} alt={t('common.signature')} className="h-10 max-w-[140px] object-contain" />
                </div>
                <div className="min-w-0 text-micro text-muted-foreground">
                  <div>{t('docSign.profileSignatureInUse')}</div>
                  <Link to="/app/profile" className="text-primary underline-offset-2 hover:underline">
                    {t('docSign.changeInProfile')}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-micro text-muted-foreground">{t('docSign.noProfileSignature')}</p>
                <SignatureCapture value={null} onChange={(url) => void saveProfileSignature(url)} disabled={savingSignature} />
              </div>
            )}
          </div>

          {/* Захиралд илгээх — зурахтай хамт (өгөгдмөл) эсвэл тусад нь. */}
          {!s.me.is_approver && s.approver && (
            <div className="mt-3 space-y-2">
              {s.can_request && (
                <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground">
                  <Checkbox
                    checked={requestApprovalChecked}
                    onCheckedChange={(v) => setRequestApprovalChecked(v === true)}
                    className="mt-0.5"
                    data-testid="doc-sign-request-checkbox"
                  />
                  <span>{t('docSign.requestWithSign', { name: s.approver.name })}</span>
                </label>
              )}
              {s.can_request && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => request.mutate()}
                  data-testid="doc-sign-request"
                >
                  {request.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t('docSign.requestOnly', { name: s.approver.name })}
                </Button>
              )}
              {pending && s.request?.requested_by?.id === s.me.id && (
                <Button size="sm" variant="ghost" className="w-full text-muted-foreground" disabled={busy} onClick={() => cancel.mutate()}>
                  <XCircle className="h-4 w-4" /> {t('docSign.cancelRequest')}
                </Button>
              )}
            </div>
          )}

          {/* Захирлын хэсэг. */}
          {s.me.is_approver && (
            <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="doc-sign-director">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <BadgeCheck className="h-4 w-4 text-primary" /> {t('docSign.directorTitle')}
              </div>
              {pending && s.request?.requested_by && (
                <p className="mt-1 text-micro text-muted-foreground">
                  {t('docSign.requestedBy', { name: s.request.requested_by.name, at: formatDateTime(s.request.created_at) })}
                </p>
              )}
              {s.request?.status === 'approved' && !approveSlot ? (
                <p className="mt-1 flex items-center gap-1 text-micro text-success" data-testid="doc-sign-director-done">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t('docSign.directorDone', { at: s.request.decided_at ? formatDateTime(s.request.decided_at) : '' })}
                </p>
              ) : approveSlot ? (
                <p className="mt-1 text-micro text-muted-foreground">
                  {t('docSign.approveTarget', { role: approveSlot.role || t('docSign.approverRow') })}
                </p>
              ) : (
                <p className="mt-1 text-micro text-muted-foreground">{t('docSign.noApproveSlot')}</p>
              )}
              <div className={cn('mt-2 flex flex-wrap gap-2', !approveSlot && !pending && 'hidden')}>
                <Button size="sm" disabled={busy || !approveSlot} onClick={() => void startApprove()} data-testid="doc-sign-approve">
                  {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                  {t('docSign.approveButton')}
                </Button>
                {pending && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setReturning((v) => !v)}>
                    <Undo2 className="h-4 w-4" /> {t('docSign.returnButton')}
                  </Button>
                )}
              </div>
              {returning && (
                <div className="mt-2 space-y-2">
                  <Label htmlFor="doc-sign-return-note" className="text-xs">
                    {t('docSign.returnNoteLabel')}
                  </Label>
                  <Textarea
                    id="doc-sign-return-note"
                    rows={3}
                    value={returnNote}
                    onChange={(e) => setReturnNote(e.target.value)}
                    placeholder={t('docSign.returnNotePlaceholder')}
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy || returnNote.trim() === ''}
                    onClick={() => giveBack.mutate(returnNote.trim())}
                  >
                    {giveBack.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                    {t('docSign.returnSend')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-4 space-y-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" className="w-full" onClick={onPrint} data-testid="doc-sign-print">
          <Printer className="h-4 w-4" /> {t('docSign.printPdf')}
        </Button>
        <p className="flex items-start gap-1.5 text-micro text-muted-foreground">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" /> {t('docSign.savedInDriveNote')}
        </p>
      </div>

      {s.history.length > 0 && <HistoryList items={s.history} />}

      {linkDialog && (
        <DriveSignLinkDialog
          key={`${linkDialog.initialKey ?? 'all'}-${linkDialog.n}`}
          open
          fileName={s.file.name}
          slots={s.slots.filter((x) => x.can_link === true)}
          initialSlotKey={linkDialog.initialKey}
          clientRowAddable={s.client_row_addable === true}
          links={linksQ.data?.links ?? []}
          live={createdLinkId != null ? (linksQ.data?.links.find((l) => l.id === createdLinkId) ?? null) : null}
          onClose={() => setLinkDialog(null)}
          onCreate={createLink}
          onRevoke={(l) => void startRevoke(l)}
          onDownload={(l) => downloadSignedFile(scope, id, l.id, s.file.name)}
        />
      )}
    </PanelShell>
  );
}

function PanelShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <section className="flex flex-col" aria-label={t('docSign.title')} data-testid="doc-sign-panel">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <PenLine className="h-4 w-4 text-primary" /> {t('docSign.title')}
      </h3>
      {children}
    </section>
  );
}

function StatusLine({ state, clientLinkLive }: { state: SigningState; clientLinkLive: boolean }) {
  const { t } = useLanguage();
  const r = state.request;
  const client = state.client_sign ?? null;
  if (r?.status === 'approved') {
    const at = r.decided_at ? formatDateTime(r.decided_at) : '';
    // CR: захирал баталсан ч захиалагч баталгаажуулж гарын үсэг зураагүй — «Батлагдсан» биш.
    if (client && awaitingClient(r.status, client)) {
      return (
        <>
          <StatusChip tone="warning" icon={<UserRoundPen className="h-3.5 w-3.5" />} state="client-missing">
            {t('docSign.statusClientMissing')}
          </StatusChip>
          <p className="mt-1 flex items-center gap-1 text-micro text-muted-foreground" data-testid="doc-sign-our-approved">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
            {t('docSign.statusOurApproved', { name: r.decided_by?.name ?? '', at })}
          </p>
          <ClientHint client={client} linkLive={clientLinkLive} canManageLinks={state.can_manage_links === true} />
        </>
      );
    }
    return (
      <>
        <StatusChip tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} state="approved">
          {t('docSign.statusApproved', { name: r.decided_by?.name ?? '', at })}
        </StatusChip>
        {client?.required && (
          <p className="mt-1 flex items-center gap-1 text-micro text-success" data-testid="doc-sign-client-signed">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {t('docSign.statusClientSigned')}
          </p>
        )}
      </>
    );
  }
  // Захирал хараахан батлаагүй — захиалагчийн тал ч дутуу бол тусад нь сануулна.
  const clientWaiting =
    client?.required && !client.complete ? (
      <p className="mt-1 flex items-center gap-1 text-micro text-muted-foreground" data-testid="doc-sign-client-waiting">
        <UserRoundPen className="h-3.5 w-3.5 shrink-0" />
        {client.total > 1 ? t('docSign.statusClientCount', { signed: client.signed, total: client.total }) : t('docSign.statusClientWaiting')}
      </p>
    ) : null;
  if (r?.status === 'pending') {
    return (
      <>
        <StatusChip tone="warning" icon={<Clock3 className="h-3.5 w-3.5" />} state="pending">
          {t('docSign.statusPending', { name: r.approver?.name ?? '' })}
        </StatusChip>
        {clientWaiting}
      </>
    );
  }
  if (r?.status === 'returned') {
    return (
      <>
        <StatusChip tone="danger" icon={<Undo2 className="h-3.5 w-3.5" />} state="returned">
          {t('docSign.statusReturned')}
        </StatusChip>
        {clientWaiting}
      </>
    );
  }
  // Захиалагчийн мөр ERP-ийн гарын үсгийн тоонд орохгүй — тэнд манайхан зурдаггүй.
  const ours = state.slots.filter((x) => !x.client);
  const signed = ours.filter((x) => x.state !== 'empty').length;
  if (ours.length > 0) {
    return (
      <>
        <StatusChip tone="neutral" icon={<PenLine className="h-3.5 w-3.5" />} state="count">
          {t('docSign.statusCount', { signed, total: ours.length })}
        </StatusChip>
        {clientWaiting}
      </>
    );
  }
  return null;
}

/** Захиалагчийн гарын үсэг дутуу үед — хэд дутуу, дараа нь юу хийх вэ. */
function ClientHint({ client, linkLive, canManageLinks }: { client: ClientSignState; linkLive: boolean; canManageLinks: boolean }) {
  const { t } = useLanguage();
  const next = linkLive
    ? t('docSign.statusClientLinkSent')
    : client.missing_row
      ? canManageLinks
        ? t('docSign.statusClientHintNoRow')
        : `${t('docSign.statusClientHint')} ${t('docSign.statusClientHintAdmin')}`
      : canManageLinks
        ? t('docSign.statusClientHint')
        : `${t('docSign.statusClientHint')} ${t('docSign.statusClientHintAdmin')}`;
  return (
    <div className="mt-1.5 rounded-md border border-warning/30 bg-warning/5 p-2 text-micro text-foreground" data-testid="doc-sign-client-hint">
      {client.total > 1 && (
        <div className="font-medium">{t('docSign.statusClientCount', { signed: client.signed, total: client.total })}</div>
      )}
      <div className="flex items-start gap-1 text-muted-foreground">
        {linkLive ? <Link2 className="mt-px h-3 w-3 shrink-0 text-primary" /> : <Info className="mt-px h-3 w-3 shrink-0" />}
        <span>{next}</span>
      </div>
    </div>
  );
}

function StatusChip({
  tone,
  icon,
  state,
  children,
}: {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  icon: ReactNode;
  /** E2E/тестэд — approved | client-missing | pending | returned | count. */
  state?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
        tone === 'success' && 'bg-success/15 text-success',
        tone === 'warning' && 'bg-warning/15 text-warning',
        tone === 'danger' && 'bg-danger/15 text-danger',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
      )}
      data-testid="doc-sign-status"
      data-state={state}
    >
      {icon}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function SlotRow({
  slot,
  isApprover,
  busy,
  signingKey: activeKey,
  askingKey,
  onSign,
  onAsk,
  link,
  linksAvailable,
  revoking,
  onLink,
  onRevokeLink,
}: {
  slot: SignSlotView;
  isApprover: boolean;
  busy: boolean;
  signingKey: string | null | undefined;
  askingKey: string | null | undefined;
  onSign: () => void;
  onAsk: () => void;
  /** Энэ мөрийн амьд (хүлээгдэж буй / зурж буй) гаднын link. */
  link: SignLinkView | null;
  /** Worker link-ийн замтай (0397) — хуучин worker дээр товч харагдахгүй. */
  linksAvailable: boolean;
  revoking: boolean;
  onLink: () => void;
  onRevokeLink: (link: SignLinkView) => void;
}) {
  const { t } = useLanguage();
  const who = [slot.position, slot.name].filter(Boolean).join(' · ');
  const spinning = activeKey === slot.key;
  // Өөр хүний нэр бичигдсэн, тэр нь бүртгэлтэй ажилтан бол «зурах» биш «хүсэх» — андуурч
  // бусдын мөрөнд зурахаас сэргийлнэ.  Нэр нь хэнд ч таарахгүй (алдаатай бичсэн) бол
  // баталгаажуулалттайгаар зурж болно.
  const otherPersonsRow = slot.needs_name_confirm && slot.ask_user !== null;
  const showSign = slot.state === 'empty' && !slot.approver && slot.can_sign && !otherPersonsRow;
  // Гаднын хүнд (захиалагч, зөвлөх) login-гүй link — хоосон, батлах биш мөр; өөрийн нэртэй мөрөнд биш.
  const canLink = linksAvailable && slot.can_link === true;
  return (
    <li className={cn('p-2.5', slot.mine && slot.state === 'empty' && 'bg-primary/5')} data-testid="doc-sign-slot" data-slot-key={slot.key}>
      <div className="flex items-center gap-1.5 text-label text-muted-foreground">
        <span className="min-w-0 truncate">{slot.role || t('docSign.signatureRow')}</span>
        {slot.approver && (
          <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-label normal-case tracking-normal text-primary">
            {t('docSign.approverTag')}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-sm text-foreground">{who || <span className="text-muted-foreground">{t('docSign.emptyName')}</span>}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {slot.state === 'erp' && (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {slot.signer?.action === 'external'
              ? t('docSign.signedViaLink', { name: slot.signer.name, at: formatDateTime(slot.signer.at) })
              : slot.signer
                ? t(slot.signer.action === 'approve' ? 'docSign.approvedBy' : 'docSign.signedBy', {
                    name: slot.signer.name,
                    at: formatDateTime(slot.signer.at),
                  })
                : t('docSign.signedInSystem')}
          </span>
        )}
        {slot.state === 'other' && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('docSign.signedManually')}
          </span>
        )}
        {/* Захирлын «Батлах» нь ЗӨВХӨН доорх «Захирлын хэсэг»-т (Буцаахтай хамт) — мөрөнд давхардуулахгүй. */}
        {showSign && (
          <Button
            size="sm"
            variant={slot.mine || slot.name === '' ? 'default' : 'outline'}
            disabled={busy}
            onClick={onSign}
            data-testid="doc-sign-slot-sign"
          >
            {spinning ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
            {t('docSign.signButton')}
          </Button>
        )}
        {slot.state === 'empty' && slot.approver && !isApprover && !canLink && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" /> {t('docSign.waitingDirector')}
          </span>
        )}
        {slot.state === 'empty' && slot.client && !link && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="doc-sign-slot-client">
            <Info className="h-3.5 w-3.5" /> {t('docSign.clientSigns')}
          </span>
        )}
        {canLink && !link && (
          <Button
            size="sm"
            variant={slot.client ? 'default' : 'ghost'}
            disabled={busy}
            onClick={onLink}
            data-testid="doc-sign-slot-link"
            title={t('docSign.linkButtonHint')}
          >
            <Link2 className="h-4 w-4" /> {slot.client ? t('docSign.linkButtonClient') : t('docSign.linkButton')}
          </Button>
        )}
        {slot.state === 'empty' && !slot.approver && slot.ask_user && !slot.mine && (
          <Button size="sm" variant="ghost" disabled={busy || askingKey === slot.key} onClick={onAsk} data-testid="doc-sign-slot-ask">
            {askingKey === slot.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            {t('docSign.askButton', { name: slot.ask_user.name })}
          </Button>
        )}
      </div>
      {link && (
        <div className="mt-1.5 rounded-md border border-border bg-muted/30 p-2" data-testid="doc-sign-slot-link-live">
          <div className="flex items-center gap-1 text-micro font-medium text-foreground">
            <Link2 className="h-3 w-3 text-primary" /> {t('docSign.linkPendingFor', { role: link.role_label })}
          </div>
          <div className="mt-1">
            <LiveStatus live={link} compact />
          </div>
          {link.status === 'pending' && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={onLink}>
                <Link2 className="h-3.5 w-3.5" /> {t('docSign.linkNew')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                disabled={busy || revoking}
                onClick={() => onRevokeLink(link)}
              >
                {revoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                {t('docSign.linkRevoke')}
              </Button>
            </div>
          )}
        </div>
      )}
      {showSign && slot.needs_name_confirm && (
        <p className="mt-1 flex items-start gap-1 text-micro text-muted-foreground">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-warning" /> {t('docSign.otherNameHint', { name: slot.name })}
        </p>
      )}
    </li>
  );
}

function UnsupportedNote({ reason }: { reason: SigningState['reason'] }) {
  const { t } = useLanguage();
  const key =
    reason === 'NOT_DOCX' ? 'docSign.unsupportedNotDocx' : reason === 'TOO_LARGE' ? 'docSign.unsupportedTooLarge' : 'docSign.unsupportedNoSlots';
  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="doc-sign-unsupported">
      <div className="flex items-start gap-1.5">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>{t(key)}</span>
      </div>
    </div>
  );
}

function HistoryList({ items }: { items: SigningState['history'] }) {
  const { t } = useLanguage();
  return (
    <details className="mt-3 text-xs" data-testid="doc-sign-history">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-muted-foreground hover:text-foreground">
        <History className="h-3.5 w-3.5" /> {t('docSign.history', { n: items.length })}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {items.map((h) => (
          <li key={h.id} className="text-muted-foreground">
            <span className="tabular-nums">{formatDateTime(h.created_at)}</span> ·{' '}
            <span className="text-foreground">{h.user?.name ?? '—'}</span>{' '}
            {h.action === 'approve'
              ? t('docSign.histApprove')
              : h.action === 'ask'
                ? t('docSign.histAsk', { name: h.target?.name ?? '' })
                : h.action === 'external'
                  ? t('docSign.histExternal', { name: h.external_name ?? '' })
                  : h.action === 'add_client_row'
                    ? t('docSign.histAddClientRow')
                    : t('docSign.histSign')}
            {h.slot_role && h.action !== 'ask' ? <span> ({h.slot_role})</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
