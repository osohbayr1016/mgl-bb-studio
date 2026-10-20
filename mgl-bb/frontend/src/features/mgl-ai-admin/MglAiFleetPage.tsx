import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Card } from '@/ui/card';
import { Input } from '@/ui/input';
import { apiFetch } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';
import { useTabParam } from '@/shared/hooks/useTabParam';

/**
 * MGL AI · ФЛОТ · АЛДААНЫ INBOX · РЕЛИЗ (Session B §39 — минимал, ажиллах хуудас).
 *
 * Гурван таб, бүгд `/api/mgl-ai/admin/*` (routes/mglAiFleet.ts):
 *   fleet     — ажилтны PC-ийн суулгацууд: хувилбар, health, суваг (override)
 *   failures  — 👎 → алдааны нэр дэвшигч: төлөв, ариутгал, регресс/SFT
 *   releases  — релизийн манифест: CANDIDATE → APPROVED → CANARY → STABLE
 *
 * ⚠️ ХАРАГДАЦ ГОЛ БИШ — ажиллах эсэх гол.  Хүснэгтийн загвар, шүүлт, хайлт нь
 *    P2.  Frontend role шалгалт нь UX — жинхэнэ хаалга `requireAdmin()`.
 * ⚠️ Таб нь `useTabParam` (глобал хайлтын дүрэм) — `useState` руу буцаахгүй.
 */

const TABS = ['fleet', 'failures', 'releases'] as const;
type Tab = (typeof TABS)[number];

interface Device {
  installation_id: string;
  full_name: string | null;
  channel: string;
  channel_override: string | null;
  telemetry_level: string;
  telemetry_level_override: string | null;
  hardware_class: string | null;
  hardware_json: string;
  versions_json: string;
  release_id: string | null;
  last_known_good_release: string | null;
  health_status: string | null;
  health_reasons_json: string;
  heartbeat_count: number;
  last_seen_at: string;
}
interface FleetPayload {
  devices: Device[];
  summary: { total: number; online: number; byHealth: Record<string, number>; byRuntimeVersion: Record<string, number> };
}

interface Failure {
  failure_uid: string;
  full_name: string | null;
  reason_code: string;
  question_text: string | null;
  answer_text: string | null;
  corrected_answer: string | null;
  redaction_status: string;
  versions_json: string;
  status: string;
  recommended_route: string | null;
  admin_notes: string | null;
  created_at: string;
}
interface FailuresPayload {
  failures: Failure[];
  counts: Record<string, number>;
}

interface Manifest {
  release_id: string;
  channel: string;
  status: string;
  manifest_json: string;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

const FAILURE_NEXT: Record<string, string[]> = {
  NEW: ['TRIAGED', 'DATA_ISSUE', 'RETRIEVAL_ISSUE', 'CALCULATION_ISSUE', 'MODEL_BEHAVIOR', 'CITATION_ISSUE', 'UI_ISSUE', 'REJECTED'],
  TRIAGED: ['DATA_ISSUE', 'RETRIEVAL_ISSUE', 'CALCULATION_ISSUE', 'MODEL_BEHAVIOR', 'CITATION_ISSUE', 'UI_ISSUE', 'RESOLVED', 'REJECTED'],
  DATA_ISSUE: ['APPROVED_REGRESSION', 'RESOLVED', 'REJECTED', 'TRIAGED'],
  RETRIEVAL_ISSUE: ['APPROVED_REGRESSION', 'RESOLVED', 'REJECTED', 'TRIAGED'],
  CALCULATION_ISSUE: ['APPROVED_REGRESSION', 'RESOLVED', 'REJECTED', 'TRIAGED'],
  CITATION_ISSUE: ['APPROVED_REGRESSION', 'RESOLVED', 'REJECTED', 'TRIAGED'],
  MODEL_BEHAVIOR: ['APPROVED_SFT', 'APPROVED_REGRESSION', 'RESOLVED', 'REJECTED', 'TRIAGED'],
  UI_ISSUE: ['RESOLVED', 'REJECTED', 'TRIAGED'],
  APPROVED_REGRESSION: ['RESOLVED', 'APPROVED_SFT'],
  APPROVED_SFT: ['RESOLVED'],
  RESOLVED: [],
  REJECTED: ['NEW'],
};

const MANIFEST_NEXT: Record<string, string[]> = {
  CANDIDATE: ['APPROVED', 'ARCHIVED'],
  APPROVED: ['CANARY', 'ROLLED_BACK', 'ARCHIVED'],
  CANARY: ['STABLE', 'ROLLED_BACK'],
  STABLE: ['ROLLED_BACK', 'ARCHIVED'],
  ROLLED_BACK: ['ARCHIVED'],
  ARCHIVED: [],
};

function json<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function healthColor(s: string | null): string {
  if (s === 'READY') return 'text-emerald-600 dark:text-emerald-400';
  if (s === 'DEGRADED' || s === 'UPDATING') return 'text-amber-600 dark:text-amber-400';
  if (s === 'REPAIR_REQUIRED') return 'text-rose-600 dark:text-rose-400';
  return 'text-muted-foreground';
}

export default function MglAiFleetPage() {
  const { user } = useAuth();
  const [tab, setTab] = useTabParam(TABS, 'fleet');
  const [error, setError] = useState<string | null>(null);

  if (user && user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card className="p-6 text-sm text-muted-foreground">Энэ хуудас зөвхөн админд нээлттэй.</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">MGL AI · суулгац ба сайжруулалт</h1>
        <div className="ml-auto flex gap-1">
          {TABS.map((t) => (
            <Button key={t} type="button" size="sm" variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t as Tab)}>
              {t === 'fleet' ? 'Флот' : t === 'failures' ? 'Алдаанууд' : 'Релиз'}
            </Button>
          ))}
        </div>
      </div>
      {error && <Card className="border-rose-300 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</Card>}
      {tab === 'fleet' && <FleetTab onError={setError} />}
      {tab === 'failures' && <FailuresTab onError={setError} />}
      {tab === 'releases' && <ReleasesTab onError={setError} />}
    </div>
  );
}

/* ================================================================== */

function FleetTab({ onError }: { onError: (m: string | null) => void }) {
  const [data, setData] = useState<FleetPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiFetch<FleetPayload>('/mgl-ai/admin/fleet'));
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setOverride(id: string, field: 'channel_override' | 'telemetry_level_override', value: string) {
    try {
      await apiFetch(`/mgl-ai/admin/fleet/${encodeURIComponent(id)}`, { method: 'PATCH', data: { [field]: value === '' ? null : value } });
      await load();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  const s = data?.summary;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {s && (
          <>
            <Badge variant="outline">нийт {s.total}</Badge>
            <Badge variant="outline">онлайн {s.online}</Badge>
            {Object.entries(s.byHealth).map(([k, n]) => (
              <Badge key={k} variant="outline" className={healthColor(k)}>
                {k} {n}
              </Badge>
            ))}
            {Object.entries(s.byRuntimeVersion).map(([k, n]) => (
              <Badge key={k} variant="secondary">
                runtime {k} × {n}
              </Badge>
            ))}
          </>
        )}
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="size-3.5" aria-hidden /> Шинэчлэх
        </Button>
      </div>
      {data && data.devices.length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">
          Суулгац бүртгэгдээгүй байна. Ажилтны PC дээрх runtime нь ERP-тэй хосолсны дараа 2 минутын дотор heartbeat илгээнэ.
        </Card>
      )}
      {data?.devices.map((d) => {
        const versions = json<Record<string, string>>(d.versions_json, {});
        const hw = json<{ gpu?: string | null; vramMb?: number | null; ramMb?: number }>(d.hardware_json, {});
        const reasons = json<string[]>(d.health_reasons_json, []);
        return (
          <Card key={d.installation_id} className="space-y-2 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{d.full_name ?? '—'}</span>
              <span className={`font-medium ${healthColor(d.health_status)}`}>{d.health_status ?? 'UNKNOWN'}</span>
              <Badge variant="outline">{d.hardware_class ?? '?'}</Badge>
              <span className="text-muted-foreground">
                {hw.gpu ?? 'GPU ?'} · {hw.vramMb ?? '?'} MB VRAM · {hw.ramMb ?? '?'} MB RAM
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {d.last_seen_at} · {d.heartbeat_count} hb
              </span>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {Object.entries(versions).map(([k, v]) => (
                <Badge key={k} variant="secondary">
                  {k} {v ?? '—'}
                </Badge>
              ))}
              {d.last_known_good_release && <Badge variant="outline">LKG {d.last_known_good_release}</Badge>}
            </div>
            {reasons.length > 0 && <div className="text-xs text-rose-600 dark:text-rose-300">{reasons.join(', ')}</div>}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">суваг: {d.channel}</span>
              <select
                className="rounded border bg-background px-1 py-0.5"
                value={d.channel_override ?? ''}
                onChange={(e) => void setOverride(d.installation_id, 'channel_override', e.target.value)}
              >
                <option value="">override үгүй</option>
                <option value="stable">stable</option>
                <option value="canary">canary</option>
                <option value="admin">admin</option>
              </select>
              <span className="text-muted-foreground">телеметри: {d.telemetry_level}</span>
              <select
                className="rounded border bg-background px-1 py-0.5"
                value={d.telemetry_level_override ?? ''}
                onChange={(e) => void setOverride(d.installation_id, 'telemetry_level_override', e.target.value)}
              >
                <option value="">override үгүй</option>
                <option value="MINIMAL">MINIMAL</option>
                <option value="QUALITY">QUALITY</option>
                <option value="DEBUG">DEBUG (түр)</option>
              </select>
              <span className="ml-auto font-mono text-muted-foreground">{d.installation_id}</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ================================================================== */

function FailuresTab({ onError }: { onError: (m: string | null) => void }) {
  const [data, setData] = useState<FailuresPayload | null>(null);
  const [filter, setFilter] = useState<string>('NEW');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<FailuresPayload>(`/mgl-ai/admin/failures?status=${filter}`));
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    }
  }, [filter, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(uid: string, path: string, body: Record<string, unknown> = {}) {
    setBusy(uid);
    try {
      await apiFetch(`/mgl-ai/admin/failures/${encodeURIComponent(uid)}/${path}`, { method: 'POST', data: body });
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy('sync');
    try {
      const r = await apiFetch<{ created: number }>('/mgl-ai/admin/failures/sync', { method: 'POST', data: {} });
      onError(r.created > 0 ? null : 'Шинэ 👎 санал алга.');
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {Object.keys(FAILURE_NEXT).map((s) => (
          <Button key={s} type="button" size="sm" variant={filter === s ? 'default' : 'outline'} onClick={() => setFilter(s)}>
            {s} {data?.counts[s] ? `(${data.counts[s]})` : ''}
          </Button>
        ))}
        <Button type="button" size="sm" variant="secondary" className="ml-auto" disabled={busy === 'sync'} onClick={() => void sync()}>
          👎 саналаас татах
        </Button>
      </div>
      {data && data.failures.length === 0 && <Card className="p-4 text-sm text-muted-foreground">Энэ төлөвт мөр алга.</Card>}
      {data?.failures.map((f) => {
        const versions = json<Record<string, string | null>>(f.versions_json, {});
        return (
          <Card key={f.failure_uid} className="space-y-2 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{f.reason_code}</Badge>
              <Badge variant="outline">{f.status}</Badge>
              <Badge variant={f.redaction_status === 'RAW' ? 'destructive' : 'secondary'}>{f.redaction_status}</Badge>
              {f.recommended_route && <span className="text-xs text-muted-foreground">зөвлөмж: {f.recommended_route}</span>}
              <span className="ml-auto text-xs text-muted-foreground">
                {f.full_name ?? '—'} · {f.created_at}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {Object.entries(versions)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <Badge key={k} variant="secondary">
                    {k} {v}
                  </Badge>
                ))}
            </div>
            {f.question_text && <p className="whitespace-pre-wrap text-xs"><span className="text-muted-foreground">Асуулт: </span>{f.question_text}</p>}
            {f.answer_text && <p className="line-clamp-4 whitespace-pre-wrap text-xs"><span className="text-muted-foreground">Хариулт: </span>{f.answer_text}</p>}
            {f.corrected_answer && <p className="whitespace-pre-wrap text-xs"><span className="text-muted-foreground">Залруулга: </span>{f.corrected_answer}</p>}
            <div className="flex flex-wrap items-center gap-1">
              {(FAILURE_NEXT[f.status] ?? []).map((to) => (
                <Button key={to} type="button" size="sm" variant="outline" disabled={busy === f.failure_uid} onClick={() => void act(f.failure_uid, 'status', { status: to })}>
                  → {to}
                </Button>
              ))}
              {f.redaction_status === 'RAW' && (
                <Button type="button" size="sm" variant="secondary" disabled={busy === f.failure_uid} onClick={() => void act(f.failure_uid, 'redact')}>
                  Ариутгах
                </Button>
              )}
              {f.redaction_status !== 'RAW' && f.status !== 'NEW' && f.status !== 'REJECTED' && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy === f.failure_uid}
                  onClick={() =>
                    void act(f.failure_uid, 'regression', {
                      target: f.status === 'MODEL_BEHAVIOR' ? 'MODEL_BEHAVIOR' : 'NORM',
                      expected: { note: 'admin-ийн тодорхойлолт хүлээгдэж байна', corrected_answer: f.corrected_answer },
                    })
                  }
                >
                  Регресс нэр дэвшүүлэх
                </Button>
              )}
              {(f.status === 'MODEL_BEHAVIOR' || f.status === 'APPROVED_SFT') && f.redaction_status !== 'RAW' && f.corrected_answer && (
                <Button type="button" size="sm" variant="secondary" disabled={busy === f.failure_uid} onClick={() => void act(f.failure_uid, 'sft')}>
                  SFT нэр дэвшүүлэх
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ================================================================== */

function ReleasesTab({ onError }: { onError: (m: string | null) => void }) {
  const [rows, setRows] = useState<Manifest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ release_id: '', model_release_uid: '', adapter_release_uid: '', knowledge_pack_id: '', norm_registry_version: '', runtime_code_version: '', min_runtime_version: '', notes: '' });

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ manifests: Manifest[] }>('/mgl-ai/admin/releases/manifests');
      setRows(r.manifests);
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy('create');
    try {
      const data: Record<string, unknown> = { release_id: form.release_id.trim() };
      if (form.model_release_uid.trim()) data.model_release_uid = form.model_release_uid.trim();
      if (form.adapter_release_uid.trim()) data.adapter_release_uid = form.adapter_release_uid.trim();
      if (form.knowledge_pack_id.trim()) data.knowledge_pack_id = Number(form.knowledge_pack_id);
      if (form.norm_registry_version.trim()) data.norm_registry_version = form.norm_registry_version.trim();
      if (form.runtime_code_version.trim()) data.runtime_code_version = form.runtime_code_version.trim();
      if (form.min_runtime_version.trim()) data.min_runtime_version = form.min_runtime_version.trim();
      if (form.notes.trim()) data.notes = form.notes.trim();
      await apiFetch('/mgl-ai/admin/releases/manifests', { method: 'POST', data });
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function move(releaseId: string, status: string) {
    setBusy(releaseId);
    try {
      await apiFetch(`/mgl-ai/admin/releases/manifests/${encodeURIComponent(releaseId)}/status`, { method: 'POST', data: { status } });
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const field = (k: keyof typeof form, ph: string) => (
    <Input value={form[k]} placeholder={ph} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="h-8 text-xs" />
  );

  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3 text-sm">
        <div className="font-medium">Нэр дэвшигч манифест угсрах (бүртгэлийн мөрүүдээс)</div>
        <div className="grid gap-2 md:grid-cols-4">
          {field('release_id', 'release_id (mgl-ai-2026.09.11.001)')}
          {field('model_release_uid', 'загварын release_uid')}
          {field('adapter_release_uid', 'адаптерын release_uid')}
          {field('knowledge_pack_id', 'мэдлэгийн багц id')}
          {field('norm_registry_version', 'нормын бүртгэл (nr-18)')}
          {field('runtime_code_version', 'runtime-code хувилбар')}
          {field('min_runtime_version', 'min runtime')}
          {field('notes', 'тэмдэглэл')}
        </div>
        <Button type="button" size="sm" disabled={busy === 'create' || !form.release_id.trim()} onClick={() => void create()}>
          CANDIDATE үүсгэх
        </Button>
      </Card>
      {rows.length === 0 && <Card className="p-4 text-sm text-muted-foreground">Манифест байхгүй.</Card>}
      {rows.map((m) => {
        const man = json<{ components?: Record<string, { version: string }> }>(m.manifest_json, {});
        return (
          <Card key={m.release_id} className="space-y-2 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{m.release_id}</span>
              <Badge variant={m.status === 'STABLE' ? 'default' : 'outline'}>{m.status}</Badge>
              <Badge variant="secondary">{m.channel}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">
                {m.created_by_name ?? '—'} · {m.created_at}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {Object.entries(man.components ?? {}).map(([k, v]) => (
                <Badge key={k} variant="secondary">
                  {k} {v.version}
                </Badge>
              ))}
            </div>
            {m.notes && <p className="text-xs text-muted-foreground">{m.notes}</p>}
            <div className="flex flex-wrap gap-1">
              {(MANIFEST_NEXT[m.status] ?? []).map((to) => (
                <Button key={to} type="button" size="sm" variant={to === 'ROLLED_BACK' ? 'destructive' : 'outline'} disabled={busy === m.release_id} onClick={() => void move(m.release_id, to)}>
                  → {to}
                </Button>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
