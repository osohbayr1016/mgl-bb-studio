import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CheckCircle2,
  Copy,
  Download,
  FileUp,
  Loader2,
  Plus,
  Send,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { apiFetch, downloadPdf, uploadClientFile } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { formatDateTime } from '@/shared/lib/time';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { cn } from '@/shared/lib/utils';
import { apiRelative } from '@/features/client/hooks/useDownloader';

/**
 * «Захиалагч» таб (ажилтны тал) — гурван хэсэг:
 *
 *   1. ЭРХ        — аль байгууллага энэ төслийг харах вэ, ямар түвшинтэй вэ.
 *   2. ИРСЭН      — захиалагчийн илгээсэн материалыг хүлээж авах / буцаах.
 *   3. НИЙТЛЭЛ    — гаргасан зургийн багц үүсгэх, гаргах, нийтлэх.
 *
 * ⚠️ Нийтлээгүй зүйл захиалагчид ХЭЗЭЭ Ч харагдахгүй.  Тиймээс «нийтлэх»
 *    товч бол ганц хаалга — түүнийг дарах хүртэл ноорог ч, гарсан багц ч
 *    порталд гарахгүй.
 */

interface OrgRow {
  id: number;
  name: string;
  status: string;
  contact_count: number;
  project_count: number;
}

/** Хүлээн авсан материалыг автоматаар хуулах цэг (миграц 0267). */
interface IntakeRow {
  archive_id: number | null;
  folder_id: number | null;
  archive_name: string | null;
  folder_name: string | null;
}

interface AccessRow {
  id: number;
  org_id: number;
  org_name: string;
  access_level: 'viewer' | 'contributor' | 'approver';
  granted_at: string;
  revoked_at: string | null;
  contact_count: number;
}

interface SubmissionRow {
  id: number;
  ref_no: string;
  title: string;
  status: 'submitted' | 'accepted' | 'rejected';
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  template_name: string;
  submitted_by_name: string | null;
  org_name: string | null;
  file_count: number;
}

interface DeliverableRow {
  id: number;
  title: string;
  discipline: string | null;
  rev: string;
  status: 'draft' | 'issued' | 'superseded';
  issued_at: string | null;
  file_count: number;
  published: number;
}

const LEVEL_LABEL: Record<string, string> = {
  viewer: 'Зөвхөн үзэх',
  contributor: 'Материал илгээж болно',
  approver: 'Зөвшөөрөл өгч болно',
};

const DISCIPLINES = ['BA', 'BB', 'HAS', 'TSBU', 'TSAH', 'HD', 'AU', 'EZ', 'IZ', 'GT'];

export function ClientPortalTab({ projectId, isAdmin }: { projectId: number; isAdmin: boolean }) {
  return (
    <div className="space-y-4">
      <AccessSection projectId={projectId} isAdmin={isAdmin} />
      <InboxSection projectId={projectId} isAdmin={isAdmin} />
      <DeliverableSection projectId={projectId} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  1. Эрх                                                             */
/* ------------------------------------------------------------------ */

function AccessSection({ projectId, isAdmin }: { projectId: number; isAdmin: boolean }) {
  const qc = useQueryClient();
  const key = `/client-admin/projects/${projectId}/access`;
  const accessQuery = useApiQuery<{ access: AccessRow[]; intake: IntakeRow }>(key);
  const orgsQuery = useApiQuery<{ orgs: OrgRow[] }>('/client-admin/orgs', { enabled: isAdmin });

  const [orgId, setOrgId] = useState('');
  const [level, setLevel] = useState('viewer');
  const [newOrg, setNewOrg] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = accessQuery.data?.access ?? [];
  const reload = () => {
    void qc.invalidateQueries({ queryKey: [key] });
    void qc.invalidateQueries({ queryKey: ['/client-admin/orgs'] });
  };

  const grant = async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      await apiFetch(`/client-admin/projects/${projectId}/access`, {
        method: 'POST',
        data: { org_id: Number(orgId), access_level: level },
      });
      toast.success('Эрх олголоо — одоо доороос хүмүүсээ урина уу');
      // `orgId`-г ЦЭВЭРЛЭХГҮЙ: доорх `ContactManager` нь сонгосон байгууллагаас
      // хамаардаг тул цэвэрлэвэл эрх нээсний дараа урих хэсэг алга болдог байв.
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Алдаа');
    } finally {
      setBusy(false);
    }
  };

  const createOrg = async () => {
    const name = newOrg.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ id: number }>('/client-admin/orgs', {
        method: 'POST',
        data: { name },
      });
      setNewOrg('');
      setOrgId(String(res.id));
      reload();
      toast.success('Байгууллага үүслээ');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Алдаа');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: AccessRow) => {
    const ok = await confirmDialog({
      title: 'Эрхийг хаах уу?',
      description: `${row.org_name} энэ төслийг харахаа болино.`,
      confirmText: 'Хаах',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiFetch(`/client-admin/projects/${projectId}/access/${row.org_id}`, {
        method: 'DELETE',
      });
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Алдаа');
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold">
          <Building2 className="h-4 w-4" strokeWidth={1.75} />
          Захиалагчийн эрх
        </h3>

        {rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Энэ төслийг харах эрхтэй захиалагч алга.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{r.org_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {LEVEL_LABEL[r.access_level]} · {r.contact_count} хүн
                    {r.revoked_at ? ` · хаагдсан ${formatDateTime(r.revoked_at)}` : ''}
                  </p>
                </div>
                {isAdmin && !r.revoked_at ? (
                  <Button size="sm" variant="ghost" onClick={() => void revoke(r)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {isAdmin ? (
          <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1 space-y-1">
                <Label className="text-[11px]">Байгууллага</Label>
                <Select value={orgId} onValueChange={setOrgId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Сонгох" />
                  </SelectTrigger>
                  <SelectContent>
                    {(orgsQuery.data?.orgs ?? []).map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[10rem] space-y-1">
                <Label className="text-[11px]">Түвшин</Label>
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LEVEL_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={!orgId || busy} onClick={() => void grant()}>
                <Plus className="h-4 w-4" />
                Эрх нээх
              </Button>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-[11px]">Шинэ байгууллага</Label>
                <Input
                  value={newOrg}
                  placeholder="«МАКС ӨРГӨӨ» ХХК"
                  onChange={(e) => setNewOrg(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                disabled={!newOrg.trim() || busy}
                onClick={() => void createOrg()}
              >
                Үүсгэх
              </Button>
            </div>

            {orgId ? (
              <ContactManager orgId={Number(orgId)} projectId={projectId} onChanged={reload} />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Байгууллагын холбоо барих хүмүүс + урилгын холбоос. */
function ContactManager({
  orgId,
  projectId,
  onChanged,
}: {
  orgId: number;
  /** Урилгын имэйлд төслийн нэрийг дурдахад л хэрэглэгдэнэ. */
  projectId: number;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const key = `/client-admin/orgs/${orgId}`;
  const query = useApiQuery<{
    contacts: {
      id: number;
      user_id: number;
      full_name: string;
      email: string | null;
      accepted_at: string | null;
    }[];
  }>(key);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState<string | null>(null);
  // Урилгыг имэйлээр ШУУД илгээх (2026-09-18, lib/clientInviteMail.ts) — өгөгдмөл
  // асаалттай; унавал холбоос хэвээр харагдана, админ гараар явуулна.
  const [sendEmail, setSendEmail] = useState(true);
  const [mailState, setMailState] = useState<{ sent: boolean; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!fullName.trim() || !email.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{
        invite_url: string | null;
        email_sent?: boolean;
        email_error?: string | null;
      }>(`/client-admin/orgs/${orgId}/contacts`, {
        method: 'POST',
        data: {
          full_name: fullName.trim(),
          email: email.trim(),
          send_email: sendEmail,
          project_id: projectId,
        },
      });
      setInvite(res.invite_url);
      setMailState(
        res.invite_url ? { sent: res.email_sent === true, error: res.email_error ?? null } : null,
      );
      if (res.email_sent) toast.success(`Урилга ${email.trim()} руу илгээгдлээ`);
      setFullName('');
      setEmail('');
      void qc.invalidateQueries({ queryKey: [key] });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Алдаа');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t pt-2">
      <p className="text-[11px] font-medium text-muted-foreground">Холбоо барих хүмүүс</p>
      <ul className="space-y-1">
        {(query.data?.contacts ?? []).map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-[12px]">
            <span className="truncate">{c.full_name}</span>
            <span className="truncate text-muted-foreground">{c.email}</span>
            {c.accepted_at ? (
              <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
            ) : (
              <span className="shrink-0 text-[10px] text-amber-600">урилга хүлээгдэж буй</span>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="h-8 min-w-[9rem] flex-1"
          placeholder="Нэр"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <Input
          className="h-8 min-w-[11rem] flex-1"
          placeholder="и-мэйл"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !fullName.trim() || !email.trim()}
          onClick={() => void add()}
        >
          <Send className="h-3.5 w-3.5" />
          Урих
        </Button>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          className="h-3.5 w-3.5"
          checked={sendEmail}
          onChange={(e) => setSendEmail(e.target.checked)}
          disabled={busy}
        />
        Урилгыг имэйлээр шууд илгээх
      </label>

      {invite ? (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{invite}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(invite);
              toast.success('Холбоос хуулагдлаа');
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
      {invite ? (
        <p
          className={cn(
            'text-[11px]',
            mailState?.sent
              ? 'text-emerald-700'
              : mailState?.error
                ? 'text-amber-700'
                : 'text-muted-foreground',
          )}
        >
          {mailState?.sent
            ? 'Урилга имэйлээр илгээгдлээ. Холбоос 7 хоног хүчинтэй, нэг удаа ажиллана.'
            : mailState?.error
              ? `Имэйл илгээгдсэнгүй (${mailState.error}) — холбоосыг өөрөө явуулна уу. 7 хоног хүчинтэй, нэг удаа ажиллана.`
              : 'Энэ холбоосыг захиалагч руу и-мэйлээр илгээнэ үү. 7 хоног хүчинтэй, нэг удаа ажиллана.'}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Ирсэн материал                                                  */
/* ------------------------------------------------------------------ */

/**
 * «Хүлээн авмагц хаашаа архивлах вэ» — миграц 0267.
 *
 * ⚠️ Энд ЗӨВХӨН СОНГОНО, архив ч хавтас ч ҮҮСГЭХГҮЙ.  2026-09-03-нд эзэн
 *    төслөөс автоматаар хавтас үүсэхийг болиулсан бөгөөд энэ хэсэг тэр
 *    шийдвэрийг эргүүлэхгүй байх ёстой.  Архив нь `Баримт бичиг` хуудсан
 *    дээр гараар үүснэ.
 */
function IntakeTarget({ projectId, intake }: { projectId: number; intake: IntakeRow }) {
  const qc = useQueryClient();
  const archivesQuery = useApiQuery<{ archives: { id: number; name: string }[] }>(
    '/documents/archives',
  );
  const [archiveId, setArchiveId] = useState(
    intake.archive_id === null ? 'none' : String(intake.archive_id),
  );
  const [folderId, setFolderId] = useState(
    intake.folder_id === null ? 'root' : String(intake.folder_id),
  );
  const [busy, setBusy] = useState(false);

  const hasArchive = archiveId !== 'none';
  // Зөвхөн сонгосон архивын ҮНДЭСНИЙ хавтсуудыг санал болгоно — гүн модыг
  // энд давтах нь Explorer-ийг хоёр дахь удаа бичихтэй адил.
  const foldersQuery = useApiQuery<{ folders: { id: number; name: string }[] }>(
    `/documents/browse?archive_id=${archiveId}`,
    { enabled: hasArchive },
  );

  const save = async (nextArchive: string, nextFolder: string) => {
    setBusy(true);
    try {
      await apiFetch(`/client-admin/projects/${projectId}/intake`, {
        method: 'PUT',
        data: {
          archive_id: nextArchive === 'none' ? null : Number(nextArchive),
          folder_id: nextFolder === 'root' ? null : Number(nextFolder),
        },
      });
      void qc.invalidateQueries({ queryKey: [`/client-admin/projects/${projectId}/access`] });
      toast.success(nextArchive === 'none' ? 'Автомат архивлалт унтраалаа' : 'Хадгаллаа');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Алдаа');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-md border border-dashed p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium">Хүлээн авмагц архивлах:</span>
        <Select
          value={archiveId}
          onValueChange={(v) => {
            setArchiveId(v);
            setFolderId('root');
            void save(v, 'root');
          }}
          disabled={busy}
        >
          <SelectTrigger className="h-8 w-[220px] text-[12px]">
            <SelectValue placeholder="Архив" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Автоматаар хуулахгүй —</SelectItem>
            {(archivesQuery.data?.archives ?? []).map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasArchive ? (
          <Select
            value={folderId}
            onValueChange={(v) => {
              setFolderId(v);
              void save(archiveId, v);
            }}
            disabled={busy}
          >
            <SelectTrigger className="h-8 w-[200px] text-[12px]">
              <SelectValue placeholder="Хавтас" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="root">Архивын үндэс</SelectItem>
              {(foldersQuery.data?.folders ?? []).map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {hasArchive
          ? 'Ажилтан «Хүлээн авах» дармагц файлууд энэ архивт өөрөө нэмэгдэнэ. Байт нь хуулагдахгүй — архивын мөр хаалттай файлыг заана.'
          : 'Сонгоогүй бол хүлээн авсан материал архивт хуулагдахгүй, зөвхөн энэ жагсаалтад үлдэнэ.'}
      </p>
    </div>
  );
}

function InboxSection({ projectId, isAdmin }: { projectId: number; isAdmin: boolean }) {
  const qc = useQueryClient();
  const key = `/client-admin/submissions?project_id=${projectId}`;
  const query = useApiQuery<{ submissions: SubmissionRow[] }>(key);
  const rows = query.data?.submissions ?? [];
  // `AccessSection` аль хэдийн татсан query — TanStack кэшээс шууд ирнэ.
  const accessQuery = useApiQuery<{ access: AccessRow[]; intake: IntakeRow }>(
    `/client-admin/projects/${projectId}/access`,
  );
  const intake = accessQuery.data?.intake;
  const [note, setNote] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const review = async (row: SubmissionRow, decision: 'accept' | 'reject') => {
    setBusy(row.id);
    try {
      const res = await apiFetch<{ archived: number | null }>(
        `/client-admin/submissions/${row.id}/${decision}`,
        { method: 'POST', data: { review_note: note[row.id] ?? '' } },
      );
      void qc.invalidateQueries({ queryKey: [key] });
      if (decision === 'reject') {
        toast.success('Буцаалаа');
      } else if (res.archived === null) {
        // Зорилтот архив тохируулаагүй, эсвэл устсан архив руу заасан.
        // Хүлээн авалт хүчинтэй — зөвхөн хуулалт хийгдээгүй.
        toast.success('Хүлээн авлаа — архивлах цэг тохируулаагүй');
      } else {
        toast.success(`Хүлээн авлаа — архивт ${res.archived} файл хууллаа`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Алдаа');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold">
          <Upload className="h-4 w-4" strokeWidth={1.75} />
          Захиалагчаас ирсэн
          {rows.filter((r) => r.status === 'submitted').length > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
              {rows.filter((r) => r.status === 'submitted').length}
            </span>
          ) : null}
        </h3>

        {isAdmin && intake ? <IntakeTarget projectId={projectId} intake={intake} /> : null}

        {rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Одоогоор материал ирээгүй байна.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{r.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.ref_no} · {r.template_name} · {r.org_name ?? r.submitted_by_name} ·{' '}
                      {formatDateTime(r.submitted_at)} · {r.file_count} файл
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px]',
                      r.status === 'submitted'
                        ? 'bg-amber-50 text-amber-700'
                        : r.status === 'accepted'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-red-50 text-red-700',
                    )}
                  >
                    {r.status === 'submitted'
                      ? 'Хүлээгдэж буй'
                      : r.status === 'accepted'
                        ? 'Хүлээн авсан'
                        : 'Буцаасан'}
                  </span>
                </div>

                <SubmissionFiles submissionId={r.id} />

                {r.status === 'submitted' ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Textarea
                      rows={1}
                      className="min-w-[12rem] flex-1"
                      placeholder="Тайлбар (буцаахад заавал)"
                      value={note[r.id] ?? ''}
                      onChange={(e) => setNote((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      disabled={busy === r.id}
                      onClick={() => void review(r, 'accept')}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Хүлээн авах
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === r.id}
                      onClick={() => void review(r, 'reject')}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Буцаах
                    </Button>
                  </div>
                ) : r.review_note ? (
                  <p className="text-[11px] text-muted-foreground">{r.review_note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SubmissionFiles({ submissionId }: { submissionId: number }) {
  const query = useApiQuery<{
    files: { id: number; canonical_name: string; original_name: string; url: string }[];
  }>(`/client/submissions/${submissionId}/files`);
  const files = query.data?.files ?? [];
  if (files.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {files.map((f) => (
        <li key={f.id}>
          <button
            type="button"
            className="text-left text-[11px] text-primary hover:underline"
            // Backend `/api/client-files/…` гэж `/api`-тай буцаадаг, `downloadPdf`
            // өөрөө `/api` угтварладаг — шууд дамжуулбал `/api/api/…` 404.
            onClick={() =>
              void downloadPdf(apiRelative(f.url), f.canonical_name).catch((err: unknown) =>
                toast.error(err instanceof Error ? err.message : 'Татаж чадсангүй'),
              )
            }
          >
            <Download className="mr-1 inline h-3 w-3" />
            {f.canonical_name}
            {f.original_name !== f.canonical_name ? (
              <span className="ml-1 text-muted-foreground">(анх: {f.original_name})</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  3. Гаргасан зургийн багц + нийтлэл                                 */
/* ------------------------------------------------------------------ */

function DeliverableSection({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const key = `/client-admin/projects/${projectId}/deliverables`;
  const query = useApiQuery<{ deliverables: DeliverableRow[] }>(key);
  const rows = query.data?.deliverables ?? [];
  const inputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [rev, setRev] = useState('0');
  const [files, setFiles] = useState<{ key: string; name: string; size: number; type: string }[]>(
    [],
  );
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = () => void qc.invalidateQueries({ queryKey: [key] });

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        Array.from(list).map(async (file) => ({
          key: await uploadClientFile(file),
          name: file.name,
          size: file.size,
          type: file.type || '',
        })),
      );
      setFiles((prev) => [...prev, ...uploaded]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Байршуулж чадсангүй');
    } finally {
      setUploading(false);
    }
  };

  const create = async () => {
    if (!title.trim() || files.length === 0) return;
    setBusy(true);
    try {
      await apiFetch(`/client-admin/projects/${projectId}/deliverables`, {
        method: 'POST',
        data: { title: title.trim(), discipline: discipline || null, rev, files },
      });
      setTitle('');
      setFiles([]);
      setRev('0');
      reload();
      toast.success('Багц үүслээ (ноорог)');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Алдаа');
    } finally {
      setBusy(false);
    }
  };

  const issue = async (row: DeliverableRow) => {
    await apiFetch(`/client-admin/deliverables/${row.id}/issue`, { method: 'POST' });
    reload();
    toast.success('Багц гарлаа');
  };

  const publish = async (row: DeliverableRow) => {
    await apiFetch(`/client-admin/projects/${projectId}/publications`, {
      method: 'POST',
      data: { kind: 'deliverable', ref_id: row.id, title_mn: row.title },
    });
    reload();
    toast.success('Захиалагчид нийтлэгдлээ');
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold">
          <FileUp className="h-4 w-4" strokeWidth={1.75} />
          Гаргасан зургийн багц
        </h3>

        {rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Багц үүсгээгүй байна.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {r.title}
                    {r.discipline ? ` · ${r.discipline}` : ''} · Rev {r.rev}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.status === 'draft'
                      ? 'Ноорог'
                      : r.status === 'issued'
                        ? `Гарсан ${r.issued_at ? formatDateTime(r.issued_at) : ''}`
                        : 'Хуучирсан'}
                    {' · '}
                    {r.file_count} файл
                    {r.published ? ' · нийтэлсэн' : ''}
                  </p>
                </div>
                {r.status === 'draft' ? (
                  <Button size="sm" variant="outline" onClick={() => void issue(r)}>
                    Гаргах
                  </Button>
                ) : null}
                {r.status !== 'draft' && !r.published ? (
                  <Button size="sm" onClick={() => void publish(r)}>
                    Нийтлэх
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-lg bg-muted/40 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1 space-y-1">
              <Label className="text-[11px]">Багцын нэр</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="min-w-[7rem] space-y-1">
              <Label className="text-[11px]">Чиглэл</Label>
              <Select value={discipline} onValueChange={setDiscipline}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {DISCIPLINES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-20 space-y-1">
              <Label className="text-[11px]">Rev</Label>
              <Input value={rev} onChange={(e) => setRev(e.target.value)} />
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void pick(e.target.files).finally(() => {
                  if (inputRef.current) inputRef.current.value = '';
                });
              }}
            />
            <Button
              variant="outline"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
              Файл нэмэх ({files.length})
            </Button>
            <Button
              disabled={!title.trim() || files.length === 0 || busy}
              onClick={() => void create()}
            >
              <Plus className="h-4 w-4" />
              Багц үүсгэх
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Багц эхлээд НООРОГ болно. «Гаргах» → «Нийтлэх» гэсэн хоёр алхмын дараа л захиалагч татаж
            авна.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default ClientPortalTab;
