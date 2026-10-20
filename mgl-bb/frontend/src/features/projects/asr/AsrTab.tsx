import { useCallback, useState } from 'react';
import { HardHat, Loader2, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { toast } from '@/shared/components/Toast';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { todayUB } from '@/shared/lib/time';
import { Button } from '@/ui/button';
import { useAsrDelete, useAsrDetail, useAsrInvalidate, useAsrList } from './api';
import { AsrProjectBoard } from '@/features/asr/board/AsrProjectBoard';
import { AsrEditorShell } from './AsrEditorShell';
import { newLocalAsrEntry, type AsrReport } from './types';
import { useAsrSafetyGate } from './useAsrSafetyGate';

const ASR_TAB_RANGE_PARAMS = ['asr_from', 'asr_to'] as const;

/**
 * «Зохиогчийн хяналт» таб — тухайн төслийн талбайн хяналтын тайлангийн
 * бүртгэл.  Word загварыг (ASR .docx) орлоно.
 *
 * Энэ таб `KeepAliveTabsPanel` дотор БИШ, энгийн `TabsContent` дотор
 * рендерлэгдэнэ: KeepAlive нь нэг удаа mount болсны дараа хэзээ ч
 * unmount болдоггүй тул 10-20 декодлогдсон зураг утасны санах ойд
 * үлдэж OOM-д хувь нэмэр болно.  Ноорог localStorage-д хадгалагддаг
 * тул unmount болоход өгөгдөл алдагдахгүй.
 */
export default function AsrTab({
  projectId,
  canCreate = true,
}: {
  projectId: number;
  canCreate?: boolean;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, isError, error, refetch } = useAsrList(projectId);
  const invalidate = useAsrInvalidate(projectId);

  /**
   * ХАДГАЛААГҮЙ шинэ тайлан — зөвхөн санах ойд.
   *
   * ⚠️ «Шинэ тайлан» дарахад сервер рүү ЮУ Ч явахгүй (эзний шийдвэр
   *    2026-09-04): бодлоо өөрчилсөн хэрэглэгч жагсаалтад хоосон ноорог
   *    үлдээх ёсгүй.  Бодит мөр «Хадгалах» дарах агшинд үүснэ.
   */
  const [draft, setDraft] = useState<AsrReport | null>(null);

  // Мэдэгдлийн линк `?tab=asr&asr=<id>` — тухайн тайланг шууд нээнэ.
  // Эхний утгыг URL-аас mount дээр л уншина; effect дотор setState хийвэл
  // шат дараалсан render үүсгэнэ.
  /** Энэ удаад анх үүссэн тайлан — засварлагч дээрээ нээгдэнэ. */
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(() => {
    const v = Number(new URLSearchParams(window.location.search).get('asr'));
    return Number.isFinite(v) && v > 0 ? v : null;
  });

  const teamOptions = data?.teams ?? [];
  const isAdmin = user?.role === 'admin';

  const closeEditor = useCallback(() => {
    setOpenId(null);
    if (searchParams.has('asr')) {
      const next = new URLSearchParams(searchParams);
      next.delete('asr');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // «Шинэ тайлан»-гийн хаалга: төрөл → (Талбайн хяналт бол) ХАБ-ын мэдээлэл +
  // гарын үсэг (`AsrSafetyDialog`; сервер `POST /projects/:id`-д шаардана).
  const safety = useAsrSafetyGate();
  const onNew = () =>
    safety.request(projectId, ({ reportType, safetyAckId }) => {
      setDraft(
        newLocalAsrEntry({
          projectId,
          authorId: user?.id ?? null,
          authorName: user?.full_name ?? null,
          authorSignatureUrl: user?.signature_url ?? null,
          reportDate: todayUB(),
          safetyAckId,
          reportType,
        }),
      );
    });

  // Жагсаалтын мөрөнд баг тус бүрийн «Ажлын тайлан» (child мөрүүд) ирдэггүй —
  // `team_codes` гэсэн group_concat л ирнэ.  Тиймээс засварлагчийг нээхдээ
  // дэлгэрэнгүйг тусад нь татна.
  const detail = useAsrDetail(openId);
  const openEntry = detail.data?.entry ?? null;

  // Админ жагсаалтаас шууд устгана (буруу / давхардсан бүртгэл цэвэрлэх).
  // Backend-ийн DELETE gate нь эцсийн шийдэгч — энэ бол зөвхөн товч.
  const del = useAsrDelete();
  const onDelete = async (row: AsrReport) => {
    const description =
      row.status === 'draft'
        ? t('asr.deleteConfirm')
        : t('asr.deleteConfirmFinal', { docNo: row.doc_no ?? '' });
    if (!(await confirmDialog({ description, variant: 'destructive' }))) return;
    try {
      await del.mutateAsync({ id: row.id });
      if (openId === row.id) setOpenId(null);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('asr.loadFailed'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    // ⚠️ Өмнө нь энд `EmptyState title={t('asr.loadFailed')}` байсан — статус
    // ямар ч байсан ЯГ НЭГ хэллэг харуулдаг, дахин оролдох товчгүй.  403
    // (эрхгүй), 404 (төсөл устсан), сүлжээ тасарсан — бүгд «Тайлангуудыг
    // ачаалж чадсангүй» болж, хэрэглэгч юу болсныг мэдэх ямар ч арга
    // байхгүй байв.  `ErrorState` нь статусаар нь ялгаж, серверийн жинхэнэ
    // мессежийг хавсаргаж, `refetch` санал болгоно.
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('asr.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('asr.subtitle')}</p>
        </div>
        {data?.can_write && canCreate && (
          <Button type="button" className="w-full gap-2 sm:w-auto" onClick={onNew}>
            <Plus className="h-4 w-4" />
            {t('asr.new')}
          </Button>
        )}
      </div>

      {/* Гурав дахь «бүртгэлийн гадаргуу» болохоос сэргийлж ялгааг ил бичнэ —
          Явцын мэдээ / И-мэйл бүртгэлтэй хольж ойлгохоос сэргийлнэ. */}
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        {t('asr.vsProgressNote')}
      </p>

      {/* Хугацаа, «хэн хэзээ явсан», багаар, тайлангууд — `/app/asr?project=`-тэй
          ИЖИЛ самбар.  URL параметр нь `asr_from`/`asr_to`: төслийн хуудасны
          бусад табууд ижил URL-ийг хуваалцдаг. */}
      <AsrProjectBoard
        projectId={projectId}
        entries={data?.entries ?? []}
        teams={teamOptions}
        isAdmin={isAdmin}
        onOpen={(row) => setOpenId(row.id)}
        onDelete={isAdmin ? onDelete : undefined}
        rangeParams={ASR_TAB_RANGE_PARAMS}
        empty={
          <EmptyState icon={HardHat} title={t('asr.empty')} description={t('asr.emptyHint')} />
        }
      />

      {safety.element}

      {openEntry && (
        <AsrEditorShell
          key={openEntry.id}
          projectId={projectId}
          entry={openEntry}
          teamOptions={teamOptions}
          // Батлах эрхийг мөрийн түвшинд сервер шийднэ (тайланд орсон
          // багийн senior эсэх) — жагсаалтын ерөнхий тугийг ашиглахгүй.
          canReview={detail.data?.can_review ?? false}
          currentUserId={user?.id ?? null}
          isAdmin={isAdmin}
          open
          // Анх үүссэн тайлан засварлагч дээрээ үлдэнэ («Баримт» руу шидэхгүй).
          initialMode={openEntry.id === createdId ? 'edit' : undefined}
          onClose={closeEditor}
          onChanged={invalidate}
        />
      )}

      {/* ХАДГАЛААГҮЙ ноорог.  `key` нь `client_uuid` — дараалсан хоёр «Шинэ
          тайлан» дээр өмнөх маягтын төлөв үлдэхээс сэргийлнэ. */}
      {draft && (
        <AsrEditorShell
          key={`draft-${draft.client_uuid}`}
          projectId={projectId}
          entry={draft}
          teamOptions={teamOptions}
          canReview={false}
          currentUserId={user?.id ?? null}
          isAdmin={isAdmin}
          open
          onClose={() => setDraft(null)}
          onChanged={invalidate}
          onCreated={(id) => {
            setDraft(null);
            invalidate();
            setCreatedId(id);
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}
