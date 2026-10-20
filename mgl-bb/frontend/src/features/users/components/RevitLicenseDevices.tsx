import { useState } from 'react';
import { Ban, CheckCircle2, Cpu, KeyRound, Loader2, RotateCcw, ShieldAlert, ShieldCheck, Undo2 } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { formatDateTime } from '@/shared/lib/time';
import { toast } from '@/shared/components/Toast';
import { useLanguage, type TranslationKey } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';

/**
 * Revit add-in-ий ЛИЦЕНЗИЙН компьютерууд (1.10, migration 0374 + 0375) — Хэрэглэгчид →
 * «Төхөөрөмж» цонхонд.  `GET /api/revit/license/admin/users/:id/devices` (admin).
 *
 * Компьютер бүр TPM / CNG дахь ӨӨРИЙН түлхүүртэй (ECDSA P-256) — сервер зөвхөн нийтийн хагасыг
 * хадгалж, лиценз / session авах бүрд нэг удаагийн challenge-д гарын үсэг зуруулдаг.  Add-in зөвхөн
 * ажилтны ирц бүртгүүлдэг ажлын компьютер дээр (техник шинжээр тулгаж) ажиллана.  Энд admin:
 *   • таараагүй / хязгаар хэтэрсэн ШИНЭ компьютерыг зөвшөөрөх (`pending` → `approved`)
 *   • компьютерыг ХААХ (түлхүүр хэвээр, оролдлого бүртгэгдэнэ) эсвэл ЦУЦЛАХ (түлхүүр УСТНА —
 *     алдагдсан / солигдсон төхөөрөмж)
 *   • «Яагаад ажиллахгүй байна вэ?» — сүүлийн татгалзал, аюулгүй байдлын үйл явдлууд
 * Компьютерын НЭР, MachineGuid, түлхүүр өөрөө харагдахгүй — зөвхөн GPU · цөм · дэлгэц, богино кодууд.
 */
type DeviceStatus = 'auto' | 'approved' | 'blocked' | 'pending' | 'revoked';

interface RevitDeviceRow {
  id: number;
  short_id: string;
  hw: string;
  status: DeviceStatus | string;
  last_result: string | null;
  matches_work_pc: boolean;
  addin_version: string | null;
  revit_year: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_lease_at: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  security_level: 'tpm' | 'software' | 'legacy' | string;
  key_short_id: string | null;
  enrolled_at: string | null;
  last_proof_at: string | null;
}

interface RevitDevicesResponse {
  devices: RevitDeviceRow[];
  work_pcs: Array<{ id: number; hw: string; last_seen_at: string | null }>;
  lease_ttl_hours: number;
  /** null = хязгааргүй (өгөгдмөл). */
  max_devices: number | null;
  device_key_policy: 'optional' | 'required';
}

interface SecurityEvent {
  id: number;
  at: string;
  event: string;
  device_short: string | null;
  detail: string | null;
  addin_version: string | null;
  ip: string | null;
}

const RESULT_KEYS = new Set([
  'ok_match',
  'ok_approved',
  'ok_account',
  'NOT_WORK_PC',
  'NO_WORK_PC_PROFILE',
  'NO_HW_PROFILE',
  'DEVICE_BLOCKED',
  'USER_INACTIVE',
  'ROLE_NOT_ALLOWED',
  'DEVICE_PENDING',
  'DEVICE_REVOKED',
  'DEVICE_LIMIT_REACHED',
  'DEVICE_PROOF_REQUIRED',
  'DEVICE_PROOF_INVALID',
  'DEVICE_KEY_REQUIRED',
  'DEVICE_NOT_ENROLLED',
  'DEVICE_KEY_MISMATCH',
  'DEVICE_KEY_WEAK',
  'ADDIN_UPDATE_REQUIRED',
  'ADDIN_VERSION_BLOCKED',
  'REVIT_LICENSES_DISABLED',
]);

function resultKey(r: string | null): TranslationKey {
  return (r && RESULT_KEYS.has(r)
    ? `revitLicense.result.${r}`
    : 'revitLicense.result.unknown') as TranslationKey;
}

const EVENT_KEYS = new Set([
  'enroll_pending',
  'enroll_auto',
  'enroll_rejected',
  'device_approved',
  'device_blocked',
  'device_revoked',
  'device_reset',
  'proof_failed',
  'challenge_denied',
  'unknown_device',
  'blocked_device_attempt',
  'license_issued',
  'license_denied',
  'legacy_license',
  'legacy_token_used',
  'legacy_token_denied',
  'version_blocked',
  'user_inactive',
  'device_limit_reached',
  'policy_changed',
  'security_check_failed',
]);

export function RevitLicenseDevices({ userId }: { userId: number }) {
  const { t } = useLanguage();
  const [busyId, setBusyId] = useState<number | null>(null);
  const query = useApiQuery<RevitDevicesResponse>(
    ['revit-license-devices', userId],
    `/revit/license/admin/users/${userId}/devices`,
    { enabled: userId > 0 },
  );
  const events = useApiQuery<{ events: SecurityEvent[] }>(
    ['revit-license-events', userId],
    `/revit/license/admin/events?user_id=${userId}&limit=15`,
    { enabled: userId > 0 },
  );

  const setStatus = async (row: RevitDeviceRow, status: DeviceStatus) => {
    setBusyId(row.id);
    try {
      await apiFetch(`/revit/license/admin/devices/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      toast.success(t(`revitLicense.saved.${status}` as TranslationKey));
      await Promise.all([query.refetch(), events.refetch()]);
    } catch (err) {
      toast.error(t('revitLicense.saveFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  const devices = query.data?.devices ?? [];
  const workPcs = query.data?.work_pcs ?? [];

  return (
    <section className="space-y-2" aria-labelledby="revit-license-devices-title">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <h3 id="revit-license-devices-title" className="text-sm font-semibold text-foreground">
          {t('revitLicense.title')}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">{t('revitLicense.desc')}</p>

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('common.loading')}
        </div>
      ) : query.error ? (
        <p className="text-xs text-destructive">{t('revitLicense.loadFailed')}</p>
      ) : (
        <>
          <p className="text-micro text-muted-foreground">
            {workPcs.length > 0
              ? t('revitLicense.workPcs', { list: workPcs.map((w) => w.hw).join(' / ') })
              : t('revitLicense.noWorkPc')}
          </p>
          {query.data && (
            <p className="text-micro text-muted-foreground">
              {t('revitLicense.limits', {
                n: query.data.max_devices ? String(query.data.max_devices) : t('revitLicense.unlimited'),
                policy: query.data.device_key_policy,
              })}
            </p>
          )}
          {devices.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('revitLicense.none')}</p>
          ) : (
            <ul className="space-y-2">
              {devices.map((d) => {
                const ok = (d.last_result ?? '').startsWith('ok_');
                const weak = d.security_level !== 'tpm';
                return (
                  <li key={d.id} className="rounded-lg border border-border/60 bg-muted/20 p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-foreground">{d.short_id}</span>
                      {d.status === 'approved' && <Badge variant="secondary">{t('revitLicense.status.approved')}</Badge>}
                      {d.status === 'blocked' && <Badge variant="destructive">{t('revitLicense.status.blocked')}</Badge>}
                      {d.status === 'revoked' && <Badge variant="destructive">{t('revitLicense.status.revoked')}</Badge>}
                      {d.status === 'pending' && <Badge variant="outline">{t('revitLicense.status.pending')}</Badge>}
                      {d.matches_work_pc && <Badge variant="outline">{t('revitLicense.matchesWorkPc')}</Badge>}
                      <Badge variant={weak ? 'outline' : 'secondary'} className="gap-1">
                        {weak ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                        {t(`revitLicense.security.${d.security_level}` as TranslationKey)}
                      </Badge>
                      <span className={ok ? 'text-success' : 'text-muted-foreground'}>
                        {t(resultKey(d.last_result))}
                      </span>
                    </div>
                    <div className="mt-1 break-words text-muted-foreground">{d.hw}</div>
                    <div className="mt-0.5 text-micro text-muted-foreground">
                      {t('revitLicense.lastSeen', { date: formatDateTime(d.last_seen_at) })}
                      {d.revit_year ? ` · Revit ${d.revit_year}` : ''}
                      {d.addin_version ? ` · v${d.addin_version}` : ''}
                      {d.decided_by_name ? ` · ${t('revitLicense.decidedBy', { name: d.decided_by_name })}` : ''}
                    </div>
                    {d.key_short_id && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-micro text-muted-foreground">
                        <KeyRound className="h-3 w-3" />
                        <span className="font-mono">{t('revitLicense.keyId', { id: d.key_short_id })}</span>
                        {d.enrolled_at && <span>{t('revitLicense.enrolledAt', { date: formatDateTime(d.enrolled_at) })}</span>}
                        <span>
                          {d.last_proof_at
                            ? t('revitLicense.lastProof', { date: formatDateTime(d.last_proof_at) })
                            : t('revitLicense.neverProof')}
                        </span>
                        {d.last_lease_at && <span>{t('revitLicense.lastLease', { date: formatDateTime(d.last_lease_at) })}</span>}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {d.status !== 'approved' && d.status !== 'revoked' && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyId === d.id}
                          onClick={() => void setStatus(d, 'approved')}>
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                          {t('revitLicense.approve')}
                        </Button>
                      )}
                      {d.status !== 'blocked' && d.status !== 'revoked' && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyId === d.id}
                          onClick={() => void setStatus(d, 'blocked')}>
                          <Ban className="mr-1 h-3.5 w-3.5" />
                          {t('revitLicense.block')}
                        </Button>
                      )}
                      {d.status !== 'revoked' && d.key_short_id && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyId === d.id}
                          onClick={() => void setStatus(d, 'revoked')}>
                          <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                          {t('revitLicense.revoke')}
                        </Button>
                      )}
                      {(d.status === 'revoked' || d.status === 'blocked' || d.status === 'approved') && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busyId === d.id}
                          onClick={() => void setStatus(d, 'pending')}>
                          <Undo2 className="mr-1 h-3.5 w-3.5" />
                          {t('revitLicense.pending')}
                        </Button>
                      )}
                      {d.status !== 'auto' && d.status !== 'revoked' && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busyId === d.id}
                          onClick={() => void setStatus(d, 'auto')}>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          {t('revitLicense.reset')}
                        </Button>
                      )}
                      {busyId === d.id && <Loader2 className="h-3.5 w-3.5 animate-spin self-center text-muted-foreground" />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-1 pt-1">
            <h4 className="text-xs font-semibold text-foreground">{t('revitLicense.events.title')}</h4>
            {events.isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (events.data?.events ?? []).length === 0 ? (
              <p className="text-micro text-muted-foreground">{t('revitLicense.events.none')}</p>
            ) : (
              <ul className="space-y-0.5">
                {(events.data?.events ?? []).map((e) => (
                  <li key={e.id} className="text-micro text-muted-foreground">
                    <span className="tabular-nums">{formatDateTime(e.at)}</span>{' '}
                    {EVENT_KEYS.has(e.event) ? t(`revitLicense.event.${e.event}` as TranslationKey) : e.event}
                    {e.device_short ? <span className="font-mono"> · {e.device_short}</span> : null}
                    {e.addin_version ? ` · v${e.addin_version}` : ''}
                    {e.detail ? ` · ${e.detail}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
