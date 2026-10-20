import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import type { OfficeIp } from '@/shared/types';
import type { AdminFeedback } from '@/features/attendance/admin/hooks/useAdminFeedback';

/** Suggest a /24 CIDR for an IPv4 address — matches typical office DHCP scope. */
export const ipv4ToCidr24 = (ip: string): string => {
  const m = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  return m ? `${m[1]}.0/24` : ip;
};

/** Оффисын IP жагсаалт + нэмэх/устгах/идэвхжүүлэх. */
export function useOfficeIps(feedback: AdminFeedback) {
  const { t } = useLanguage();
  const { setError, setSuccess } = feedback;

  const [showAddIp, setShowAddIp] = useState(false);
  const [newIpLabel, setNewIpLabel] = useState('');
  const [newIpAddress, setNewIpAddress] = useState('');
  const [myIp, setMyIp] = useState<string | null>(null);

  const officeIpsQuery = useApiQuery<{ ips: OfficeIp[] }>('/office-ips');
  const officeIps = officeIpsQuery.data?.ips ?? [];

  const loadIps = useCallback(() => {
    officeIpsQuery.refetch();
  }, [officeIpsQuery]);

  // Admin's own current IP — read once from /attendance/my-status. We
  // don't really need this in TanStack cache so a small `useEffect` is
  // fine here.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ client_ip?: string }>('/attendance/my-status')
      .then((st) => {
        if (cancelled) return;
        if (st.client_ip && st.client_ip !== 'unknown') setMyIp(st.client_ip);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addIp = async () => {
    if (!newIpLabel || !newIpAddress) return;
    try {
      await apiFetch('/office-ips', { data: { label: newIpLabel, ip_address: newIpAddress } });
      setShowAddIp(false);
      setNewIpLabel('');
      setNewIpAddress('');
      setSuccess(t('attendanceAdminPage.ipAdded'));
      loadIps();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const deleteIp = async (id: number) => {
    try {
      await apiFetch(`/office-ips/${id}`, { method: 'DELETE' });
      loadIps();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const toggleIp = async (id: number) => {
    try {
      await apiFetch(`/office-ips/${id}/toggle`, { method: 'PATCH' });
      loadIps();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return {
    officeIps,
    isLoading: officeIpsQuery.isLoading,
    myIp,
    showAddIp,
    setShowAddIp,
    newIpLabel,
    setNewIpLabel,
    newIpAddress,
    setNewIpAddress,
    addIp,
    deleteIp,
    toggleIp,
  };
}

export type OfficeIpsState = ReturnType<typeof useOfficeIps>;
