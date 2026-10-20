/**
 * «Ростер» самбар — судалгааны оролцогчийн жагсаалтыг ЗАСВАРЛАХ (зөвхөн admin).
 *
 * 2026-08-19-д нэмэгдсэн.  Үүнээс ӨМНӨ жагсаалтыг үүсгэсний дараа засах ямар
 * ч гарц UI-д БАЙГААГҮЙ — сервер тал `PUT /rounds/:id/participants` байсан ч
 * түүнийг дуудах нэг ч дуудагч frontend-д хэзээ ч байгаагүй.  Тиймээс админд
 * хоёрхон сонголт байв: буруу хүнийг үүрд үлдээх, эсвэл РАУНДЫГ БҮХЭЛД НЬ
 * устгах (илгээсэн бүх үнэлгээ хамт цаасддаг).
 *
 * Хоёр блок:
 *   1. ДУТУУ  — хамрах хүрээнд тохирох ч бүртгэгдээгүй (шинэ ажилтан).
 *               «Нэмэх» дархад бүртгэж, мэдэгдэл явуулна.
 *   2. ХУУЧИРСАН — бүртгэлтэй ч байх ёсгүй болсон (ажлаас гарсан, эрх нь
 *               тохирохгүй, хамрах хүрээнээс гарсан).  Мөр бүр дээр «Хасах».
 *
 * Хоёулаа хоосон бол самбар ОГТ гарахгүй — өдөр тутмын дэлгэцийг бохирдуулахгүй.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, UserPlus, UserRoundX } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';

import {
  addRoundParticipant,
  assessmentKeys,
  fetchRoundCandidates,
  removeRoundParticipant,
  syncRoundParticipants,
  type RosterStale,
  type RosterStaleReason,
} from '../api';

export interface RosterPanelProps {
  roundId: number;
}

export function RosterPanel({ roundId }: RosterPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  /** Аль мөр дээр ажил явж байна вэ — мөр тус бүрийн товчийг л түгжинэ. */
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  const query = useQuery({
    queryKey: assessmentKeys.candidates(roundId),
    queryFn: () => fetchRoundCandidates(roundId),
  });

  /** Жагсаалт өөрчлөгдөхөд аудит БА тайлан хоёулаа дахин уншигдана. */
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.candidates(roundId) });
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.roundResults(roundId) });
    void queryClient.invalidateQueries({ queryKey: assessmentKeys.rounds });
  };

  const syncMutation = useMutation({
    mutationFn: () => syncRoundParticipants(roundId),
    onSuccess: (res) => {
      refresh();
      toast.success(t('assessments.rosterSynced', { count: res.added }));
    },
    onError: () => toast.error(t('assessments.rosterSyncFailed')),
  });

  const addMutation = useMutation({
    mutationFn: (userId: number) => addRoundParticipant(roundId, userId),
    onSuccess: () => {
      refresh();
      toast.success(t('assessments.rosterAdded'));
    },
    onError: () => toast.error(t('assessments.rosterSyncFailed')),
    onSettled: () => setBusyUserId(null),
  });

  const removeMutation = useMutation({
    mutationFn: (row: RosterStale) => removeRoundParticipant(roundId, row.user_id),
    onSuccess: (res, row) => {
      refresh();
      // Илгээсэн хариулт үлдсэн бол ил хэлнэ — «бүрэн хассан» гэж хуурахгүй.
      //
      // ⚠️ ГЭХДЭЭ зөвхөн ИДЭВХТЭЙ хүнд.  Идэвхгүй болсон хүний өгөгдөл
      //    DB-д үлдэх ч уншихдаа шүүгдэж тайланд ГАРАХГҮЙ тул түүнд
      //    «тайланд үлдэнэ» гэж хэлэх нь худал болно.
      if (res.kept_submitted > 0 && row.user_status === 'active') {
        toast.warn(t('assessments.rosterKeptSubmitted', { count: res.kept_submitted }));
      } else {
        toast.success(t('assessments.rosterRemoved'));
      }
    },
    onError: () => toast.error(t('assessments.rosterRemoveFailed')),
    onSettled: () => setBusyUserId(null),
  });

  const data = query.data;
  if (!data) return null;
  // Хаагдсан ээлжийн түүхэн жагсаалтыг хөндөхгүй.
  if (data.round_status === 'closed') return null;
  if (!data.missing.length && !data.stale.length) return null;

  const reasonLabel: Record<RosterStaleReason, string> = {
    inactive: t('assessments.rosterReasonInactive'),
    role: t('assessments.rosterReasonRole'),
    out_of_cohort: t('assessments.rosterReasonOutOfCohort'),
    excluded: t('assessments.rosterReasonExcluded'),
  };

  const handleRemove = async (row: RosterStale) => {
    const ok = await confirmDialog({
      title: t('assessments.rosterRemoveTitle'),
      description:
        // Идэвхгүй хүний өгөгдөл аль хэдийн тайлангаас шүүгдсэн тул түүнд
        // «илгээсэн хариулт үлдэнэ» гэсэн сануулга хамаарахгүй.
        row.submitted_count > 0 && row.user_status === 'active'
          ? t('assessments.rosterRemoveConfirmSubmitted', { name: row.full_name })
          : t('assessments.rosterRemoveConfirm', { name: row.full_name }),
      variant: 'destructive',
    });
    if (!ok) return;
    setBusyUserId(row.user_id);
    removeMutation.mutate(row);
  };

  return (
    <Card className="border-amber-500/40">
      <CardContent className="space-y-5 p-4">
        {/* -------------------------------------------------- Дутуу хүмүүс */}
        {data.missing.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <UserPlus className="size-4 text-amber-600" aria-hidden />
                <span className="text-body font-medium">
                  {t('assessments.rosterPending', { count: data.missing.length })}
                </span>
              </div>
              <Button
                size="sm"
                disabled={syncMutation.isPending}
                onClick={() => syncMutation.mutate()}
              >
                {syncMutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('assessments.rosterSync')}
              </Button>
            </div>
            <p className="text-micro text-muted-foreground">
              {t('assessments.rosterPendingHint')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.missing.map((m) => (
                <Button
                  key={m.user_id}
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-xs"
                  disabled={busyUserId === m.user_id || syncMutation.isPending}
                  onClick={() => {
                    setBusyUserId(m.user_id);
                    addMutation.mutate(m.user_id);
                  }}
                >
                  {busyUserId === m.user_id ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  ) : (
                    <UserPlus className="size-3" aria-hidden />
                  )}
                  {formatDisplayName(m.full_name)}
                  {m.team_code && (
                    <span className="text-muted-foreground">· {m.team_code}</span>
                  )}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* ---------------------------------------------- Хуучирсан бүртгэл */}
        {data.stale.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600" aria-hidden />
              <span className="text-body font-medium">
                {t('assessments.rosterStale', { count: data.stale.length })}
              </span>
            </div>
            <p className="text-micro text-muted-foreground">{t('assessments.rosterStaleHint')}</p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {data.stale.map((row) => (
                <li
                  key={row.user_id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{formatDisplayName(row.full_name)}</span>
                  <Badge variant="outline" className="text-xs">
                    {reasonLabel[row.reason]}
                  </Badge>
                  {row.team_code && (
                    <span className="text-micro text-muted-foreground">{row.team_code}</span>
                  )}
                  {row.submitted_count > 0 && row.user_status === 'active' && (
                    <span className="text-micro text-muted-foreground">
                      {t('assessments.rosterSubmittedNote', { count: row.submitted_count })}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={busyUserId === row.user_id}
                    onClick={() => void handleRemove(row)}
                  >
                    {busyUserId === row.user_id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <UserRoundX className="size-4 text-destructive" aria-hidden />
                    )}
                    {t('assessments.rosterRemove')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RosterPanel;
