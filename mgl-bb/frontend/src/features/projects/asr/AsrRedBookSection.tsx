import { useRef, useState } from 'react';
import { BookMarked, Camera, Check, ImagePlus, Loader2, RefreshCw, Undo2, X } from 'lucide-react';
import { mediaUrl, uploadFile } from '@/shared/api/client';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { downscaleImage, UnsupportedImageError } from '@/shared/lib/imageDownscale';
import { formatDateTime } from '@/shared/lib/time';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import {
  useAsrRedBookAbsent,
  useAsrRedBookPhoto,
  useAsrRedBookRevoke,
  useAsrRedBookVerify,
} from './api';
import { AsrRedBookBadge } from './AsrStatusBadge';
import {
  isAsrPersisted,
  isRedBookAbsent,
  redBookStatusOf,
  type AsrReport,
  type AsrReportType,
} from './types';

/**
 * «Улаан дэвтэр» — талбайн ажлын журнал дээрх гарын үсгийн баталгаа
 * (миграц 0279).  Тайлангийн draft → submitted → approved мөчлөгөөс
 * ТУСДАА амьдардаг:
 *
 *   зураггүй → «Гарын үсэг дутуу» → зураг хавсаргана → «Гарын үсэг
 *   зурагдсан» → эрх бүхий хүн баталгаажуулна → «Улаан дэвтэр
 *   баталгаажсан».
 *
 * ⚠️ Маягтын `form` төлөвт ОРДОГГҮЙ, autosave-аар ЯВДАГГҮЙ.  Зураг нь
 *    `PATCH /:id/red-book`-оор ШУУД серверт очно, учир нь гарын үсэг
 *    ихэвчлэн тайлан илгээгдсэний ДАРАА нөхөгддөг бөгөөд тэр үед
 *    ердийн `PATCH /:id` зохиогчид хаалттай.  Тиймээс энэ хэсэг
 *    `readOnly`-г ДАГАДАГГҮЙ — өөрийн эрхийн дүрэмтэй (`canAttach`).
 *
 * Хадгалаагүй тайлан дээр (`id === 0`) хавсаргах газар байхгүй — тиймээс
 * зураг / «байгаагүй» дарагдмагц `ensureSaved` тайланг ЭХЛЭЭД үүсгэнэ
 * (`doSubmit`-ийн ижил silent зам), дараа нь улаан дэвтрийг бичээд
 * `onCreated`-оор засварлагчийг бодит мөр рүү шилжүүлнэ (эзэн 2026-09-30:
 * «анх үүсгэхдээ ч шууд оруулдаг болго»).  `ensureSaved` өгөөгүй бол хуучин
 * зан төлөв: «хадгалсны дараа» сануулга л.
 *
 * 0366 (эзэн 2026-09-30): ТАЛБАЙН ХЯНАЛТЫГ зураггүйгээр илгээх / батлахгүй —
 * «Талбай дээр улаан дэвтэр байгаагүй» чагтыг тэмдэглэсэн үед л болно
 * (`redBookGap`, серверийн ихэр `lib/asrRedBook.ts`).  Илгээгдсэн тайлан дээр
 * улаан дэвтрийг ХООСОН болгох (зураг устгах, чагтыг болих) зам хаалттай —
 * сервер 409, энд товчийг нь л нууна; зураг СОЛИХ чөлөөтэй.
 */
export function AsrRedBookSection({
  entry,
  reportType,
  canAttach,
  canReview,
  onChanged,
  ensureSaved,
  onCreated,
}: {
  entry: AsrReport;
  /** Засварлагчийн одоогийн төрөл — зөвхөн `site`-д заавал (0366). */
  reportType: AsrReportType;
  /** Зохиогч эсвэл админ — серверийн `PATCH /:id/red-book` gate-ийн тусгал. */
  canAttach: boolean;
  /** `can_review` — баталгаажуулах/цуцлах эрх. */
  canReview: boolean;
  /** Сервер өөрчлөгдлөө — дуудагч дэлгэрэнгүйг дахин татна. */
  onChanged: (id: number) => void;
  /** Хадгалаагүй тайланг үүсгээд id буцаана (`null` = бүтсэнгүй). */
  ensureSaved?: () => Promise<number | null>;
  /** Шинээр үүссэн тайлан — дуудагч засварлагчийг бодит мөр рүү шилжүүлнэ. */
  onCreated?: (id: number) => void;
}) {
  const { t } = useLanguage();
  const persisted = isAsrPersisted(entry);
  /** Хадгалаагүй ч гэсэн хавсаргаж болно — дарахад тайлан эхлээд үүснэ. */
  const canCreate = !persisted && !!ensureSaved;
  const usable = persisted || canCreate;
  const status = redBookStatusOf(entry);
  const verified = status === 'verified';
  const required = reportType === 'site';
  const absent = isRedBookAbsent(entry.red_book_absent);
  /** Илгээгдсэн/батлагдсан талбайн тайлан — улаан дэвтрийг хоосон болгохгүй. */
  const locked = required && (entry.status === 'submitted' || entry.status === 'approved');

  const photo = useAsrRedBookPhoto();
  const markAbsent = useAsrRedBookAbsent();
  const verify = useAsrRedBookVerify();
  const revoke = useAsrRedBookRevoke();
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [creating, setCreating] = useState(false);
  const busy =
    creating ||
    uploading ||
    photo.isPending ||
    markAbsent.isPending ||
    verify.isPending ||
    revoke.isPending;
  const fail = (err: unknown, fallback: string) =>
    toast.error(err instanceof Error ? err.message : fallback);

  /** Хадгалагдсан бол тэр id; эс бөгөөс тайланг ЭХЛЭЭД үүсгэнэ. */
  const resolveId = async (): Promise<number | null> => {
    if (persisted) return entry.id;
    if (!ensureSaved) return null;
    setCreating(true);
    try {
      const id = await ensureSaved();
      if (id == null) toast.error(t('asr.saveFailed'));
      return id;
    } finally {
      setCreating(false);
    }
  };
  /** Мутацийн ДАРАА: дэлгэрэнгүйг шинэчилж, шинэ тайланд засварлагчийг шилжүүлнэ. */
  const done = (id: number) => {
    onChanged(id);
    if (!persisted) onCreated?.(id);
  };

  const attach = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !usable) return;
    setUploading(true);
    try {
      const small = await downscaleImage(file);
      const id = await resolveId();
      if (id == null) return;
      const url = await uploadFile(small);
      await photo.mutateAsync({ id, photo_url: url });
      done(id);
    } catch (err) {
      if (err instanceof UnsupportedImageError) toast.error(t('asr.unsupportedImage'));
      else fail(err, t('asr.saveFailed'));
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ description: t('asr.redBookRemoveConfirm') }))) return;
    try {
      await photo.mutateAsync({ id: entry.id, photo_url: null });
      onChanged(entry.id);
    } catch (err) {
      fail(err, t('asr.saveFailed'));
    }
  };

  const toggleAbsent = async (next: boolean) => {
    try {
      const id = await resolveId();
      if (id == null) return;
      await markAbsent.mutateAsync({ id, absent: next });
      done(id);
    } catch (err) {
      fail(err, t('asr.saveFailed'));
    }
  };

  const doVerify = async () => {
    if (!(await confirmDialog({ description: t('asr.redBookVerifyConfirm') }))) return;
    try {
      await verify.mutateAsync({ id: entry.id });
      toast.success(t('asr.redBookVerifiedToast'));
      onChanged(entry.id);
    } catch (err) {
      fail(err, t('asr.saveFailed'));
    }
  };

  const doRevoke = async () => {
    if (
      !(await confirmDialog({ description: t('asr.redBookRevokeConfirm'), variant: 'destructive' }))
    )
      return;
    try {
      await revoke.mutateAsync({ id: entry.id });
      onChanged(entry.id);
    } catch (err) {
      fail(err, t('asr.saveFailed'));
    }
  };

  // Ноорог дээр баталгаажуулах утгагүй (сервер 409) — товчийг ч гаргахгүй.
  const canVerify = canReview && persisted && entry.status !== 'draft';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AsrRedBookBadge status={status} />
        {verified && (
          <span className="min-w-0 break-words text-xs text-muted-foreground">
            {t('asr.redBookVerifiedBy')}:{' '}
            <span className="text-foreground">{entry.red_book_verifier_name ?? '—'}</span>
            {entry.red_book_verified_at && (
              <span className="tabular-nums"> · {formatDateTime(entry.red_book_verified_at)}</span>
            )}
          </span>
        )}
      </div>

      {/* Сануулга — зураг ирэх хүртэл харагдана.  Тайлан батлагдсан ч
          үлдэнэ: дутуу нь дутуу хэвээр. */}
      {status === 'missing' && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
          <BookMarked className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0">
            {required ? t('asr.redBookRequiredReminder') : t('asr.redBookReminder')}
            {!usable && (
              <span className="block text-muted-foreground">{t('asr.redBookSaveFirst')}</span>
            )}
          </span>
        </div>
      )}

      {/* Файл сонгогч — хавсаргах БА солих хоёулаа эндээс (зураг байхад ч
          render-лэгдэнэ, эс бөгөөс «солих» товч дарах input олдохгүй). */}
      {canAttach && usable && !verified && (
        <>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void attach(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void attach(e.target.files);
              e.target.value = '';
            }}
          />
        </>
      )}

      {entry.red_book_photo_url && (
        <figure className="relative overflow-hidden rounded-lg border bg-muted">
          <img
            src={mediaUrl(entry.red_book_photo_url)}
            alt=""
            loading="lazy"
            className={'max-h-72 w-full object-contain' + (uploading ? ' opacity-50' : '')}
          />
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </figure>
      )}

      {/* Зураг байгаа үед: ШУУД солих (устгаад дахин оруулах шаардлагагүй —
          сервер `PATCH /:id/red-book` шинэ URL-аар дарж бичнэ) эсвэл устгах.
          2026-09-30 хүртэл зөвхөн буланд жижиг «X» байсан тул ажилтан солих
          аргаа олдоггүй байв. */}
      {canAttach && persisted && !verified && entry.red_book_photo_url && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {t('asr.photoReplaceCamera')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            disabled={busy}
            onClick={() => galleryRef.current?.click()}
          >
            <RefreshCw className="h-4 w-4" /> {t('asr.photoReplace')}
          </Button>
          {/* Илгээгдсэн талбайн тайлангаас устгаж хоосон үлдээхгүй — солино (сервер 409). */}
          {!locked && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              <X className="h-3.5 w-3.5" /> {t('asr.photoRemove')}
            </Button>
          )}
        </div>
      )}

      {canAttach && usable && !verified && !entry.red_book_photo_url && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {t('asr.camera')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            disabled={busy}
            onClick={() => galleryRef.current?.click()}
          >
            <ImagePlus className="h-4 w-4" /> {t('asr.gallery')}
          </Button>
        </div>
      )}

      {/* «Талбай дээр улаан дэвтэр байгаагүй» (0366) — зөвхөн талбайн хяналт,
          зураггүй үед.  Тэмдэглэсэн бол зураггүйгээр илгээж / батлуулж болно. */}
      {required && usable && !entry.red_book_photo_url && (
        <label
          className={
            'flex items-start gap-2.5 rounded-lg border p-3 text-sm' +
            (absent ? ' border-foreground/20 bg-muted/50' : '')
          }
        >
          <Checkbox
            checked={absent}
            // Илгээгдсэн тайлан дээр зураггүй үед болиулахгүй (сервер 409).
            disabled={!canAttach || busy || (absent && locked)}
            onCheckedChange={(v) => void toggleAbsent(v === true)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="font-medium">{t('asr.redBookAbsentCheck')}</span>
            <span className="block text-xs text-muted-foreground">
              {absent && locked ? t('asr.redBookAbsentLocked') : t('asr.redBookAbsentHint')}
            </span>
          </span>
        </label>
      )}

      {canVerify && !verified && (
        <Button
          type="button"
          size="sm"
          className="w-full gap-2"
          // Зураггүй бол сервер 400 өгнө — товчийг идэвхгүй болгож шалтгааныг доор нь хэлнэ.
          disabled={busy || !entry.red_book_photo_url}
          onClick={() => void doVerify()}
        >
          {verify.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {t('asr.redBookVerify')}
        </Button>
      )}
      {canVerify && !verified && !entry.red_book_photo_url && (
        <p className="text-xs text-muted-foreground">{t('asr.redBookVerifyNeedsPhoto')}</p>
      )}
      {canVerify && verified && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          disabled={busy}
          onClick={() => void doRevoke()}
        >
          <Undo2 className="h-3.5 w-3.5" /> {t('asr.redBookRevoke')}
        </Button>
      )}
    </div>
  );
}
